// Read-only navigation of the exact disposable POS UI candidate; never point at production.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),{chromium}=require('playwright');
const base=process.env.POS_REFERENCE_BASE_URL,out=process.env.POS_REFERENCE_OUTPUT;
if(base!=='http://127.0.0.1:18085'||!out||process.env.SHARED_HEADER_NATIVE_QA!=='true')throw Error('Explicit disposable loopback opt-in required');
const routes=JSON.parse(fs.readFileSync(path.join(__dirname,'shared-header-routes.json'),'utf8'));
const report={productionAccess:false,routes:routes.length,checks:[],layouts:[],pageErrors:[],blockedRequests:[]};
function check(name,pass,detail){report.checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});if(!pass)console.log('FAIL '+name);}
function query(sql){const p=cp.spawnSync(process.env.POS_REFERENCE_JAVA,['-cp',process.env.POS_REFERENCE_H2_JAR,path.join(__dirname,'PosReferenceDbProbe.java')],{input:sql,encoding:'utf8',timeout:30000,windowsHide:true});if(p.status)throw Error('Independent SELECT failed');return JSON.parse(p.stdout);}
function snapshot(){const tables=query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='PUBLIC' AND TABLE_NAME IN ('INVOICE','INVOICE_ITEM','PAYMENT','ORDER_HEADER','ORDER_PART','ORDER_ITEM','POS_TRANSACTION','POS_TRANSACTION_ITEM','POS_PAYMENT','POS_SESSION','POS_CASH_ENTRY','ACCTG_TRANS','ACCTG_TRANS_ENTRY','TAX_LINE_DETAIL','SAAS_TENANT','SAAS_SUBSCRIPTION','SAAS_INVOICE','SAAS_PAYMENT') ORDER BY TABLE_NAME");if(tables.length<12)throw Error('Incomplete financial snapshot');return Object.fromEntries(tables.map(({table_name:t})=>{const rows=query('SELECT * FROM '+t).map(r=>JSON.stringify(r)).sort();return[t,{rows:rows.length,sha256:crypto.createHash('sha256').update(rows.join('\n')).digest('hex')}]}));}
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{let b;try{
 fs.mkdirSync(out,{recursive:true});b=await chromium.launch({headless:true,executablePath:process.env.POS_REFERENCE_CHROME});const c=await b.newContext();
 const login=await c.request.post(base+'/Login/login',{form:{username:process.env.POS_REFERENCE_USERNAME,password:process.env.POS_REFERENCE_PASSWORD},maxRedirects:0});if(login.status()!==302)throw Error('Fixture login failed');
 // The POS suite initialized this new memory DB; this runner cannot seed or submit business writes.
 if(query("SELECT TERMINAL_ID FROM POS_TERMINAL WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length!==1)throw Error('Synthetic fixture missing');
 report.before=snapshot();
 const p=await c.newPage();p.on('pageerror',e=>report.pageErrors.push({route:new URL(p.url()).pathname,message:e.message}));
 await p.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());if(req.method()!=='GET'&&req.method()!=='HEAD'){report.blockedRequests.push({path:u.pathname,method:req.method()});await r.abort();}else await r.continue();});
 for(const shell of ['apps','qapps'])for(const {module,route} of routes){
  for(const width of [1440,768,320]){try{
   await p.setViewportSize({width,height:360});
   if(width===1440){
    const expected='/'+shell+'/zenith/'+route;
    const response=await p.goto(base+expected,{waitUntil:'networkidle',timeout:60000});
    const rendered=response.status()===200&&new URL(p.url()).pathname===expected&&!/Internal Server Error|Error rendering screen/.test(await p.locator('body').innerText());
    check(shell+' '+module+' renders requested route',rendered,{status:response.status(),actualPath:new URL(p.url()).pathname});
    if(!rendered)break;
   }
   await frames(p);
   await p.locator('#top').waitFor({state:'visible',timeout:20000});await p.evaluate(()=>scrollTo(0,0));await frames(p);
   const before=await p.locator('#top').evaluate(e=>{const r=e.getBoundingClientRect();return{top:r.top,height:r.height,width:r.width,viewport:innerWidth,scrollHeight:document.scrollingElement.scrollHeight};});
   await p.evaluate(()=>scrollTo(0,document.scrollingElement.scrollHeight));await frames(p);await p.waitForTimeout(220);
   const after=await p.locator('#top').evaluate(e=>{const r=e.getBoundingClientRect();return{top:r.top,height:r.height,scrollY,transform:getComputedStyle(e.closest('.q-header')||e).transform};});
   const moved=after.scrollY>1;
   check(shell+' '+module+' '+width+' topbar visible and stable',Math.abs(after.top-before.top)<2&&after.top>=-1&&after.height>0,{before,after});
   // Short native pages are reported explicitly; no artificial page height is injected.
   report.layouts.push({shell,module,route,width,nativePageScrollVerified:moved,scrollY:after.scrollY,headerHeight:after.height});
   await p.evaluate(()=>scrollTo(0,0));await frames(p);check(shell+' '+module+' '+width+' return has no header jump',Math.abs((await p.locator('#top').boundingBox()).y-before.top)<2);
   if(width===320&&shell==='apps'){
    const burger=p.locator('#z-side-burger');if(await burger.isVisible()){
     check(module+' mobile menu receives pointer',await burger.evaluate(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h);}));
     await burger.click();check(module+' mobile sidebar opens',await p.locator('body').evaluate(e=>e.classList.contains('z-side-open')));
     await p.locator('#z-side-backdrop').click({position:{x:310,y:200}});check(module+' mobile sidebar closes',!await p.locator('body').evaluate(e=>e.classList.contains('z-side-open')));
    }
   }
  }catch(e){check(shell+' '+module+' '+width+' runtime verification completed',false,{error:e.message});}}
  console.log(shell+' '+module+': header matrix checked');
 }
 // Compare the focused billing layout against the exact parent theme, not a missing stylesheet.
 const parentTheme=process.env.POS_REFERENCE_PARENT_THEME;
 if(!parentTheme)throw Error('Exact parent theme baseline required');
 const parentCss=fs.readFileSync(parentTheme,'utf8');report.parentThemeSha256=crypto.createHash('sha256').update(parentCss).digest('hex');
 for(const shell of ['apps','qapps']){
  await p.setViewportSize({width:1440,height:900});
  const terminal=base+'/'+shell+'/zenith/pos/Terminal';
  const measure=()=>p.evaluate(()=>({sideOff:document.body.classList.contains('z-side-off'),elements:['#top','.q-header','.z-pos-page'].map(selector=>{const e=document.querySelector(selector);if(!e)return{selector,present:false};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{selector,present:true,top:Math.round(r.top),height:Math.round(r.height),width:Math.round(r.width),position:s.position,display:s.display,transform:s.transform};})}));
  await p.goto(terminal,{waitUntil:'networkidle'});await frames(p);const candidate=await measure();
  await p.route('**/zenith-theme-v4.css?*',r=>r.fulfill({status:200,contentType:'text/css',body:parentCss}));
  await p.reload({waitUntil:'networkidle'});await frames(p);const baseline=await measure();
  check(shell+' focused Terminal layout unchanged by shared theme patch',JSON.stringify(candidate)===JSON.stringify(baseline),{candidate,baseline});
  await p.unroute('**/zenith-theme-v4.css?*');
 }
 // Close the request-producing context before synchronous JDBC probes. A delayed catalog
 // prefetch otherwise reaches the interception callback only while browser.close() runs.
 await c.close();
 report.after=snapshot();check('Read-only navigation leaves financial and subscription state unchanged',JSON.stringify(report.before)===JSON.stringify(report.after));
 // Terminal's automatic catalog read is a POST; every POST is still aborted before dispatch.
 const allowedCatalogReads=['/apps/zenith/pos/Terminal/exportPosCatalog','/qapps/zenith/pos/Terminal/exportPosCatalog'];
 check('Only read-only catalog-prefetch POST attempts; all blocked before dispatch',report.blockedRequests.every(r=>r.method==='POST'&&allowedCatalogReads.includes(r.path)),JSON.parse(JSON.stringify(report.blockedRequests)));
 check('No cross-module JavaScript errors',report.pageErrors.length===0,JSON.parse(JSON.stringify(report.pageErrors)));
}finally{if(b)await b.close();report.failures=report.checks.filter(x=>!x.pass).length;report.scrolledLayouts=report.layouts.filter(x=>x.nativePageScrollVerified).length;fs.writeFileSync(path.join(out,'shared-header-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failures:report.failures,layouts:report.layouts.length,nativeScrollLayouts:report.scrolledLayouts}));if(report.failures)process.exitCode=1;}})().catch(e=>{console.error(e.message);process.exitCode=1});
