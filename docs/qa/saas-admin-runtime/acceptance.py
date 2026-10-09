#!/usr/bin/env python3
"""Run only against the fresh labelled SaaS Admin stack. No production credentials/data."""
import base64,http.cookiejar,json,os,subprocess,urllib.error,urllib.parse,urllib.request
from pathlib import Path
from datetime import date
assert date(2026,10,1) <= date.today() < date(2026,11,1), "Refresh the documented synthetic period before rerunning outside October 2026"
BASE=os.environ.get('SAASADMIN_QA_BASE','http://127.0.0.1:18087').rstrip('/')
u=urllib.parse.urlsplit(BASE);assert u.scheme=='http' and u.hostname in ('localhost','127.0.0.1') and u.port==18087
OUT=Path(os.environ.get('SAASADMIN_QA_OUT','/tmp/zenith-saas-admin-qa/results'));OUT.mkdir(parents=True,exist_ok=True)
DB='zenith-saas-admin-qa-db-1';assert subprocess.check_output(['docker','inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',DB],text=True).strip()=='zenith-saas-admin-qa'
jar=http.cookiejar.CookieJar();http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));path='/apps/zenith/my-subscription/SaasAdminQa';results=[];token='';user=''
def sql(q):return subprocess.check_output(['docker','exec','-i',DB,'psql','-U','moqui','-d','moqui','-v','ON_ERROR_STOP=1','-Atc',q],text=True).strip()
def login(name):
 global token,user
 jar.clear();user=name
 raw=http.open(urllib.request.Request(BASE+path+'/token',headers={'Authorization':'Basic '+base64.b64encode((name+':moqui').encode()).decode()}),timeout=60).read().decode()
 token=json.loads(raw)["token"]
def request(p,data=None,csrf=True):
 body=None if data is None else urllib.parse.urlencode({**({'moquiSessionToken':token} if csrf else {}),**data},doseq=True).encode()
 try:
  r=http.open(urllib.request.Request(BASE+p,data=body),timeout=60);return r.status,r.read().decode(),r.geturl()
 except urllib.error.HTTPError as e:return e.code,e.read().decode(),e.url

def call(op,data=None):
 status,raw,url=request(path+('/initialize' if op=='initialize' else '/invoke'),{} if op=='initialize' else {'op':op,'input':json.dumps(data or {})})
 try:return json.loads(raw)
 except json.JSONDecodeError:
  if user=='saasadmin.view' and url.endswith('/Dashboard'):return {'errors':['view-only gate']}
  raise AssertionError('QA JSON absent, HTTP '+str(status))


def record(name,ok):
 results.append({'case':name,'passed':bool(ok)});print(('PASS' if ok else 'FAIL')+' '+name,flush=True)
 OUT.joinpath('services-summary.json').write_text(json.dumps({'checks':results},indent=2))
def snapshot():
 return sql("select md5(string_agg(v,'|' order by v)) from (select row_to_json(t)::text v from saas_tenant t union all select row_to_json(s)::text from saas_subscription s union all select row_to_json(i)::text from saas_invoice i union all select row_to_json(p)::text from saas_payment p union all select row_to_json(a)::text from saas_audit_log a union all select row_to_json(u)::text from saas_usage u union all select row_to_json(c)::text from saas_tenant_config c) x")
def denied(name,op,data):
 before=snapshot();r=call(op,data);record(name,bool(r.get('errors')) and snapshot()==before)
def passed(name,op,data):
 r=call(op,data);record(name,not r.get('errors'));
 if r.get('errors'):print(r['errors'],flush=True)
 return r.get('result',{})
from datetime import timedelta
TODAY=date.today();UNTIL=TODAY+timedelta(days=30)
ADMIN='/apps/zenith/saas-admin/PlanAssignments'
assert sql("select count(*) from saas_tenant where tenant_id in ('SAASADMIN_QA_A','SAASADMIN_QA_B','SAASADMIN_QA_T','SAASADMIN_QA_S')")=='4'
login('john.doe');record('fresh fixture initialized',call('initialize').get('initialized'))
security=sql("select md5(string_agg((to_jsonb(x)-'last_updated_stamp')::text,'|' order by user_id)) from user_account x")
financial=sql("select md5(string_agg(row_to_json(x)::text,'|' order by invoice_id)) from invoice x")
invoices=sql("select md5(string_agg(row_to_json(x)::text,'|' order by saas_invoice_id)) from saas_invoice x")
foreign=sql("select md5(string_agg(v,'|' order by v)) from (select row_to_json(t)::text v from saas_tenant t where tenant_id='SAASADMIN_QA_B' union all select row_to_json(s)::text from saas_subscription s where tenant_id='SAASADMIN_QA_B') q")
for shell in ['apps','qapps']:
 status,raw,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments'+('.qvt' if shell=='qapps' else ''))
 record(shell+' real admin screen renders',status==200 and 'ManualPlanAssignmentForm' not in raw and 'Tenant plan assignments' in raw)
 status,raw,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments'+('.qvt' if shell=='qapps' else '')+'?tenantId=SAASADMIN_QA_S')
 record(shell+' selected tenant and required date form render',status==200 and 'ManualPlanAssignmentForm' in raw and 'accessUntil' in raw)
 before=snapshot();status,_,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments/assignManualPlan')
 record(shell+' assignment requires POST',status==405 and before==snapshot())
 before=snapshot();status,_,_=request('/'+shell+'/zenith/saas-admin/PlanAssignments/assignManualPlan',dict(tenantId='SAASADMIN_QA_S',newPlanId='GROWTH',accessUntil=UNTIL.isoformat(),reason='QA'),False)
 record(shell+' assignment requires CSRF',status in (401,403) and before==snapshot())
params=dict(tenantId='SAASADMIN_QA_S',newPlanId='GROWTH',accessUntil=UNTIL.isoformat(),reason='Synthetic manual access')
login('saasadmin.owner')
denied('tenant admin cannot grant own access','assign',dict(params,tenantId='SAASADMIN_QA_A'))
denied('tenant admin cannot grant foreign access','assign',params)
denied('tenant admin cannot run expiry','expire',dict(tenantId='SAASADMIN_QA_A'))
status,raw,_=request(ADMIN);record('tenant admin cannot read platform list',status==403 and 'Disposable SaaS Admin B' not in raw)
before=snapshot();status,raw,_=request(ADMIN+'/assignManualPlan',params);record('tenant admin cannot bypass screen transition',before==snapshot() and (status==403 or 'Only the platform administrator' in raw))
login('john.doe')
for label,p in [('HTML reason rejected',dict(params,reason='<script>invalid</script>')),('invalid date',dict(params,accessUntil='2026-02-30')),('missing date',dict(params,accessUntil='')),('past date',dict(params,accessUntil=(TODAY-timedelta(days=1)).isoformat())),('invalid plan',dict(params,newPlanId='SAASADMIN_QA_MISSING')),('missing tenant',dict(params,tenantId='SAASADMIN_QA_MISSING')),('blank reason',dict(params,reason='  ')),('long reason',dict(params,reason='x'*501))]:denied(label,'assign',p)
sql("update saas_plan set is_active='N' where plan_id='ENTERPRISE'")
denied('inactive plan rejected','assign',dict(params,newPlanId='ENTERPRISE'))
sql("update saas_plan set is_active='Y' where plan_id='ENTERPRISE'")
sql("update saas_tenant set status_id='SaasTenantCancelled' where tenant_id='SAASADMIN_QA_B'")
denied('cancelled tenant requires review','assign',dict(params,tenantId='SAASADMIN_QA_B'))
sql("update saas_tenant set status_id='SaasTenantActive' where tenant_id='SAASADMIN_QA_B'")
# Native write transition, not a bypass of its controller.
status,raw,_=request(ADMIN+'/assignManualPlan',params)
record('admin dated assignment transition',status==200 and 'Plan assigned through' in raw)
record('assignment activates suspended tenant',sql("select status_id||'|'||plan_id from saas_tenant where tenant_id='SAASADMIN_QA_S'")=='SaasTenantActive|GROWTH')
record('one manual active subscription, no gateway billing dates',sql("select count(*) from saas_subscription where tenant_id='SAASADMIN_QA_S' and status_id='SubActive' and billing_cycle='Manual' and auto_renew='N' and amount=0 and start_date=current_date and end_date=current_date+30 and renewal_date is null and trial_end_date is null")=='1')
record('manual pointer targets correct tenant',sql("select count(*) from saas_tenant_config c join saas_subscription s on s.subscription_id=c.config_value and s.tenant_id=c.tenant_id where c.tenant_id='SAASADMIN_QA_S' and c.config_key='MANUAL_PLAN_SUBSCRIPTION'")=='1')
record('old active subscription retired',sql("select status_id||'|'||auto_renew from saas_subscription where subscription_id='SAASADMIN_QA_S'")=='SubExpired|N')
record('audit stores actor, reason and dates',sql("select count(*) from saas_audit_log where tenant_id='SAASADMIN_QA_S' and event_type='MANUAL_PLAN_ASSIGNED' and user_id='EX_JOHN_DOE' and description like '%Synthetic manual access%' and description like '%through %'")=='1')
before=snapshot();passed('same assignment replay','assign',params);record('same assignment creates no duplicates or audit',before==snapshot())
subBefore=sql("select config_value from saas_tenant_config where tenant_id='SAASADMIN_QA_S' and config_key='MANUAL_PLAN_SUBSCRIPTION'")
sql("update saas_subscription set start_date=current_date-5 where subscription_id='"+subBefore+"'")
passed('extend same plan','assign',dict(params,accessUntil=(UNTIL+timedelta(days=1)).isoformat()))
record('same-plan extension preserves start and subscription id',sql("select subscription_id||'|'||(start_date=current_date-5)::text from saas_subscription where subscription_id='"+subBefore+"'")==subBefore+'|true')
# Old invoices stay legally unchanged. No payment or new invoice is fabricated by an access grant.
record('assignment preserves all platform invoices',invoices==sql("select md5(string_agg(row_to_json(x)::text,'|' order by saas_invoice_id)) from saas_invoice x"))
record('assignment creates no payment',sql('select count(*) from saas_payment')=='0')
denied('manual plan cannot use legacy cancellation','cancel',dict(tenantId='SAASADMIN_QA_S',immediate='true'))
denied('manual plan cannot use legacy trial extension','extend',dict(tenantId='SAASADMIN_QA_S'))
denied('manual plan cannot create gateway order','order',dict(saasInvoiceId='SAASADMIN_QA_S'))
# Stale/due records simulate the exact reported expiry regression.
sql("update saas_invoice set status_id='SiOverdue',due_date=current_date-30 where saas_invoice_id='SAASADMIN_QA_S'")
sql("insert into saas_subscription(subscription_id,tenant_id,plan_id,status_id,billing_cycle,start_date,trial_end_date,renewal_date,auto_renew,amount) values ('SAASADMIN_QA_STALE_TRIAL','SAASADMIN_QA_S','GROWTH','SubTrial','Monthly',current_date-40,current_date-1,current_date-1,'Y',999)")
passed('stale trial expiry cannot suspend grant','trial',dict(subscriptionId='SAASADMIN_QA_STALE_TRIAL',tenantId='SAASADMIN_QA_S'))
passed('scheduled trial and manual expiry check','trials',{})
passed('overdue invoice job','overdue',{})
passed('renewal job','renew',{})
record('manual grant survives all three jobs before end date',sql("select status_id from saas_tenant where tenant_id='SAASADMIN_QA_S'")=='SaasTenantActive')
record('old invoice remains overdue, not paid or cancelled',sql("select status_id from saas_invoice where saas_invoice_id='SAASADMIN_QA_S'")=='SiOverdue')
record('manual grant never creates renewal invoice',sql("select count(*) from saas_invoice where tenant_id='SAASADMIN_QA_S'")=='1')
# Repeat trial assignment retires stale trials and changes plan without a payment.
passed('assign trial tenant','assign',dict(params,tenantId='SAASADMIN_QA_T',newPlanId='ENTERPRISE'))
record('trial tenant becomes active',sql("select status_id||'|'||plan_id from saas_tenant where tenant_id='SAASADMIN_QA_T'")=='SaasTenantActive|ENTERPRISE')
record('old trial is retired',sql("select status_id from saas_subscription where subscription_id='SAASADMIN_QA_T'")=='SubExpired')
# Limits cannot be waived by the admin grant. A genuine tenant login remains available.
sql("update user_account set disabled='N' where user_id='SAASADMIN_QA_DISABLED'")
denied('assignment respects lower plan usage','assign',dict(params,tenantId='SAASADMIN_QA_A',newPlanId='STARTER'))
sql("update user_account set disabled='Y' where user_id='SAASADMIN_QA_DISABLED'")
passed('assign owner tenant','assign',dict(params,tenantId='SAASADMIN_QA_A',newPlanId='GROWTH'))
login('saasadmin.owner')
status,raw,_=request('/apps/zenith/my-subscription');record('tenant sees manual dates and no checkout',status==200 and 'assigned by the platform administrator' in raw and 'Pay Now' not in raw and 'CancelDialog-button' not in raw and '>Downgrade<' not in raw)
denied('self plan change cannot undo dated assignment','change',dict(tenantId='SAASADMIN_QA_A',newPlanId='ENTERPRISE'))
status,raw,_=request('/apps/zenith/Contacts/FindContact');record('normal tenant login and included module still render',status==200 and 'Contact' in raw and 'Account Suspended' not in raw)
login('john.doe')
# Last-day access is inclusive. Expiry checks ignore caller-supplied dates and use DB date + locked pointer.
sub=sql("select config_value from saas_tenant_config where tenant_id='SAASADMIN_QA_S' and config_key='MANUAL_PLAN_SUBSCRIPTION'")
sql("update saas_subscription set end_date=current_date where subscription_id='"+sub+"'")
passed('inclusive end date expiry check','expire',dict(tenantId='SAASADMIN_QA_S'))
record('access remains active on selected end date',sql("select status_id from saas_tenant where tenant_id='SAASADMIN_QA_S'")=='SaasTenantActive')
sql("update saas_subscription set end_date=current_date-1 where subscription_id='"+sub+"'")
# Render gate prevents next-day access even before the scheduled job runs.
login('saasadmin.owner');call('suspendedScope')
status,raw,_=request('/apps/zenith/Contacts/FindContact');record('past-dated manual grant blocks module render before cron',status==200 and 'Account Suspended' in raw)
login('john.doe');passed('expire ended manual access','expire',dict(tenantId='SAASADMIN_QA_S'))
record('ended grant and tenant expire together',sql("select t.status_id||'|'||s.status_id from saas_tenant t join saas_subscription s on s.tenant_id=t.tenant_id where s.subscription_id='"+sub+"'")=='SaasTenantSuspended|SubExpired')
before=snapshot();passed('expiry replay','expire',dict(tenantId='SAASADMIN_QA_S'));record('expiry replay is a no-op',before==snapshot())
before=snapshot();denied('unconfirmed legacy payment cannot revive manual expiry','reactivate',dict(tenantId='SAASADMIN_QA_S'));record('expired manual account remains suspended after legacy payment callback',before==snapshot())
passed('extend expired access via new assignment','assign',params)
record('expired tenant restored with exactly one active grant',sql("select count(*) from saas_subscription where tenant_id='SAASADMIN_QA_S' and status_id='SubActive'")=='1' and sql("select status_id from saas_tenant where tenant_id='SAASADMIN_QA_S'")=='SaasTenantActive')
record('user accounts and credentials unchanged after synthetic fixture toggle restore',security==sql("select md5(string_agg((to_jsonb(x)-'last_updated_stamp')::text,'|' order by user_id)) from user_account x"))
record('financial ERP invoices unchanged',financial==sql("select md5(string_agg(row_to_json(x)::text,'|' order by invoice_id)) from invoice x"))
record('unselected tenant subscriptions unchanged',foreign==sql("select md5(string_agg(v,'|' order by v)) from (select row_to_json(t)::text v from saas_tenant t where tenant_id='SAASADMIN_QA_B' union all select row_to_json(s)::text from saas_subscription s where tenant_id='SAASADMIN_QA_B') q"))
if not all(x['passed'] for x in results):raise SystemExit('Acceptance failures; inspect services-summary.json')
