"""Run the existing service suite on the explicitly opted-in fresh loopback H2 fixture.

Postgres acceptance remains mandatory in CI. This adapter translates only fixture SQL
and independently fingerprints all columns through JDBC. It never accesses production.
"""
import hashlib, json, os, re, subprocess
from pathlib import Path

assert os.environ.get('SAASADMIN_NATIVE_QA') == 'true'
HERE = Path(__file__).resolve().parent
JAVA = Path(os.environ['SAASADMIN_NATIVE_JAVA']).resolve()
H2 = Path(os.environ['SAASADMIN_NATIVE_H2']).resolve()
OUT = Path(os.environ['SAASADMIN_QA_OUT']).resolve()
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([str(JAVA.with_name('javac.exe')), '-d', str(OUT), str(HERE/'SaasAdminNativeDb.java')], check=True)

def jdbc(statement):
    result = subprocess.run([str(JAVA), '-cp', str(OUT)+os.pathsep+str(H2), 'SaasAdminNativeDb'],
                            input=statement, text=True, encoding='utf-8', capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)

def fingerprint(selects, omit_stamp=False):
    values=[]
    for statement in selects:
        for row in jdbc(statement):
            if omit_stamp: row.pop('last_updated_stamp', None)
            values.append(json.dumps(row, sort_keys=True, ensure_ascii=False))
    return hashlib.sha256('\n'.join(sorted(values)).encode()).hexdigest()

def native_sql(statement):
    if 'md5(string_agg' in statement:
        if "where tenant_id='SAASADMIN_QA_B'" in statement:
            return fingerprint(["SELECT * FROM SAAS_TENANT WHERE TENANT_ID='SAASADMIN_QA_B'", "SELECT * FROM SAAS_SUBSCRIPTION WHERE TENANT_ID='SAASADMIN_QA_B'"])
        if 'from user_account x' in statement: return fingerprint(['SELECT * FROM USER_ACCOUNT'], True)
        if 'from invoice x' in statement: return fingerprint(['SELECT * FROM INVOICE'])
        if 'from saas_invoice x' in statement: return fingerprint(['SELECT * FROM SAAS_INVOICE'])
        return fingerprint(['SELECT * FROM '+name for name in ['SAAS_TENANT','SAAS_SUBSCRIPTION','SAAS_INVOICE','SAAS_PAYMENT','SAAS_AUDIT_LOG','SAAS_USAGE','SAAS_TENANT_CONFIG']])
    statement=re.sub(r'current_date\s*([+-])\s*(\d+)', lambda m: "DATEADD('DAY',"+('-' if m[1]=='-' else '')+m[2]+',CURRENT_DATE)', statement, flags=re.I)
    rows=jdbc(statement)
    return '\n'.join('|'.join('' if v is None else str(v) for v in row.values()).replace('|TRUE','|true').replace('|FALSE','|false') for row in rows)

source=(HERE/'acceptance.py').read_text(encoding='utf-8')
old="DB='zenith-saas-admin-qa-db-1';assert subprocess.check_output(['docker','inspect','--format','{{ index .Config.Labels \"com.docker.compose.project\" }}',DB],text=True).strip()=='zenith-saas-admin-qa'"
assert source.count(old)==1
source=source.replace(old,"DB='native-disposable-memory'")
source=source.replace("'http://127.0.0.1:18087'", "'http://127.0.0.1:18085'").replace('u.port==18087','u.port==18085')
old="def sql(q):return subprocess.check_output(['docker','exec','-i',DB,'psql','-U','moqui','-d','moqui','-v','ON_ERROR_STOP=1','-Atc',q],text=True).strip()"
assert source.count(old)==1
source=source.replace(old,'sql=native_sql')
extra="""
protected_selects=["SELECT * FROM "+t+" WHERE TENANT_ID='SAASADMIN_QA_PROTECTED'" for t in ['SAAS_TENANT','SAAS_SUBSCRIPTION','SAAS_TENANT_CONFIG','SAAS_INVOICE','SAAS_AUDIT_LOG']]
protected_before=fingerprint(protected_selects)
protected=dict(tenantId='SAASADMIN_QA_PROTECTED',newPlanId='GROWTH',accessUntil=UNTIL.isoformat(),reason='Synthetic protected-org denial')
denied('protected organization assignment denied before any write','assign',protected)
passed('protected organization expiry no-op','expire',dict(tenantId='SAASADMIN_QA_PROTECTED'))
record('protected expiry preserves all tenant subscription config invoice audit rows',fingerprint(protected_selects)==protected_before)
for shell in ['apps','qapps']:
 status,raw,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments'+('.qvt' if shell=='qapps' else '')+'?tenantId=SAASADMIN_QA_PROTECTED')
 record(shell+' protected tenant has notice and no assignment form',status==200 and 'This organization is protected' in raw and 'ManualPlanAssignmentForm' not in raw)
 status,raw,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments/assignManualPlan',protected)
 record(shell+' forged protected-org transition leaves rows unchanged',status==200 and (shell=='qapps' or 'protected' in raw) and fingerprint(protected_selects)==protected_before)
"""
anchor="params=dict(tenantId='SAASADMIN_QA_S',newPlanId='GROWTH',accessUntil=UNTIL.isoformat(),reason='Synthetic manual access')"
assert source.count(anchor)==1
source=source.replace(anchor,anchor+'\n'+extra)
source=source.replace("if not all(x['passed'] for x in results):", "record('protected organization unchanged after lifecycle jobs',fingerprint(protected_selects)==protected_before)\nif not all(x['passed'] for x in results):")
exec(compile(source, str(HERE/'acceptance.py'), 'exec'), {**globals(), '__file__': str(HERE/'acceptance.py')})
