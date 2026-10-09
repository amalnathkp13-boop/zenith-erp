// Run only after acceptance-native.py on its fresh synthetic loopback memory DB.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),{chromium}=require('playwright');
if(process.env.SAASADMIN_NATIVE_QA!=='true')throw Error('Disposable opt-in required');
const base='http://127.0.0.1:18085',out=path.resolve(process.env.SAASADMIN_QA_OUT),checks=[];
const java=process.env.SAASADMIN_NATIVE_JAVA,h2=process.env.SAASADMIN_NATIVE_H2,pw=process.env.SAASADMIN_NATIVE_PASSWORD;
if(!pw||!java||!h2)throw Error('Fixture-only environment required');
function q(sql){if(!sql.startsWith('SELECT '))throw Error('Browser probe is read-only');return JSON.parse(cp.execFileSync(java,['-cp',out+path.delimiter+h2,'SaasAdminNativeDb'],{input:sql,encoding:'utf8',windowsHide:true,timeout:30000}));}
function hash(sql){return crypto.createHash('sha256').update(JSON.stringify(q(sql).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');}
function check(name,ok){checks.push({name,passed:!!ok});if(!ok)throw Error(name);}
const financial=()=>Object.fromEntries(['INVOICE','INVOICE_ITEM','PAYMENT','SAAS_INVOICE','SAAS_PAYMENT'].map(t=>[t,hash('SELECT * FROM '+t)]));
const protectedRows=()=>Object.fromEntries(['SAAS_TENANT','SAAS_SUBSCRIPTION','SAAS_TENANT_CONFIG','SAAS_INVOICE','SAAS_AUDIT_LOG'].map(t=>[t,hash("SELECT * FROM "+t+" WHERE TENANT_ID='SAASADMIN_QA_PROTECTED'")]));
(async()=>{let b;const errors=[];try{
 b=await chromium.launch({headless:true,executablePath:process.env.SAASADMIN_NATIVE_CHROME});const c=await b.newContext({viewport:{width:1440,height:1000}});
 await c.request.post(base+'/Login/login',{form:{username:'john.doe',password:pw},maxRedirects:0});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 const before=financial(),protectedBefore=protectedRows(),unselectedBefore=hash("SELECT * FROM SAAS_SUBSCRIPTION WHERE TENANT_ID='SAASADMIN_QA_B'");
 for(const shell of ['apps','qapps']){
  const route=base+'/'+shell+'/zenith/saas-admin/PlanAssignments';
  await p.goto(route+'?tenantId=SAASADMIN_QA_PROTECTED',{waitUntil:'networkidle'});
  check(shell+' protected notice renders',await p.getByText('This organization is protected. Manual assignment and expiry are unavailable.',{exact:true}).isVisible());
  check(shell+' protected assignment form absent',await p.locator('#ManualPlanAssignmentForm').count()===0);
  await p.goto(route+'?tenantId=SAASADMIN_QA_S',{waitUntil:'networkidle'});const f=p.locator('#ManualPlanAssignmentForm');await f.waitFor();
  check(shell+' normal assignment form available',await f.isVisible());
  const end=new Date();end.setUTCDate(end.getUTCDate()+(shell==='apps'?33:34));const iso=end.toISOString().slice(0,10);
  await f.locator('[name=accessUntil]').fill(iso);await f.locator('[name=reason]').fill('Synthetic native UI extension');
  const sent=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/assignManualPlan'));
  await f.locator('[type=submit]').click();const response=await sent;check(shell+' native assignment uses POST',response.status()===200||response.status()===302||response.status()===303);
  check(shell+' actual native submit extends stored end date',q("SELECT END_DATE FROM SAAS_SUBSCRIPTION WHERE SUBSCRIPTION_ID=(SELECT CONFIG_VALUE FROM SAAS_TENANT_CONFIG WHERE TENANT_ID='SAASADMIN_QA_S' AND CONFIG_KEY='MANUAL_PLAN_SUBSCRIPTION')")[0].end_date.startsWith(iso));
  for(const width of [320,375,768,1440]){await p.setViewportSize({width,height:1000});await p.goto(route+'?tenantId=SAASADMIN_QA_S',{waitUntil:'networkidle'});await p.locator('#ManualPlanAssignmentForm').waitFor();check(shell+' '+width+' form and page contained',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.screenshot({path:path.join(out,shell+'-'+width+'.png'),fullPage:true});}
 }
 check('Native browser mutations leave financial tables unchanged',JSON.stringify(before)===JSON.stringify(financial()));
 check('Native browser mutations leave protected organization rows unchanged',JSON.stringify(protectedBefore)===JSON.stringify(protectedRows()));
 check('Native browser mutations leave unselected subscription unchanged',unselectedBefore===hash("SELECT * FROM SAAS_SUBSCRIPTION WHERE TENANT_ID='SAASADMIN_QA_B'"));
 check('No browser JavaScript errors',errors.length===0);
}finally{if(b)await b.close();fs.writeFileSync(path.join(out,'browser-reverification.json'),JSON.stringify({productionAccess:false,checks,errors},null,2));console.log(JSON.stringify({suite:'saas-admin-browser',passed:checks.filter(x=>x.passed).length,failed:checks.filter(x=>!x.passed)}));}})().catch(e=>{console.error(e.message);process.exitCode=1});
