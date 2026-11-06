// Disposable Moqui/H2 verification only; no production requests or hardware printing.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{chromium,webkit}=require('playwright');
const base=process.env.POS_QA_BASE||'http://127.0.0.1:18084';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=process.env.POS_QA_OUT||path.resolve('output/kitchen-redesign');fs.mkdirSync(out,{recursive:true});
const root=process.env.POS_QA_NATIVE_ROOT,java=process.env.POS_QA_JAVA;assert.ok(root&&java);
const classes=path.join(out,'db-probe');fs.mkdirSync(classes,{recursive:true});cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'PosDbProbe.java')],{windowsHide:true});
function q(sql){assert.match(sql,/^SELECT /);return JSON.parse(cp.execFileSync(java,['-cp',path.join(root,'WEB-INF/lib/h2-2.4.240.jar')+path.delimiter+classes,'PosDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,POS_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));}
const results=[];function check(name,ok,evidence){console.log((ok?'PASS ':'FAIL ')+name);results.push({name,passed:!!ok,...(!ok?{evidence}: {})});if(!ok&&!process.env.POS_QA_COLLECT_FAILURES)throw Error(name+': '+JSON.stringify(evidence));}
(async()=>{for(let i=0;;i++){try{if((await fetch(base+'/Login')).status<500)break;}catch{}if(i>90)throw Error('Disposable runtime unavailable');await new Promise(r=>setTimeout(r,1000));}
const browser=await (process.env.POS_QA_ENGINE==='webkit'?webkit:chromium).launch({headless:true,...(process.env.POS_QA_ENGINE==='webkit'?{}:{executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'})});
try{
 const bootstrap=await browser.newContext();await bootstrap.request.get(base+'/apps/zenith/Contacts/Customers',{headers:{Authorization:'Basic '+Buffer.from('john.doe:moqui').toString('base64')}});const bp=await bootstrap.newPage();await bp.goto(base+'/apps/zenith/Contacts/Customers');const token=await bp.locator('[name=moquiSessionToken]').first().inputValue();
 if(!process.env.POS_QA_SKIP_INIT){const r=await bootstrap.request.post(base+'/apps/zenith/pos/PosQaAcceptance/initialize',{form:{moquiSessionToken:token}});check('fresh synthetic fixture initialized',(await r.json()).initialized);}await bootstrap.close();
 async function actor(user){const c=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await c.route('**/qz-tray@*/qz-tray.js',r=>r.fulfill({contentType:'text/javascript',body:'/* no hardware */'}));await c.request.get(base+'/apps/zenith/pos/Terminal',{headers:{Authorization:'Basic '+Buffer.from(user+':moqui').toString('base64')}});const p=await c.newPage();p.setDefaultTimeout(20000);await p.goto(base+'/apps/zenith/pos/Terminal');return {c,p,t:await p.locator('[name=moquiSessionToken]').first().inputValue()};}
 const a=await actor('pos.qa'),foreign=await actor('pos.b.qa');
 const kotSessionId=await require('./kot-test-session.cjs')({a,base});
 const post=async(screen,transition,params={},who=a,csrf=true,shell='apps')=>who.c.request.post(`${base}/${shell}/zenith/pos/${screen}/${transition}`,{form:{...(csrf?{moquiSessionToken:who.t}:{}),...(screen==='Kitchen/KotBilling'?{sessionId:kotSessionId}:{}),...params},maxRedirects:0});
 if(['tables','workflows','print'].includes(process.env.POS_QA_PHASE)){
  if(process.env.POS_QA_PHASE!=='print')await require('./verify-kitchen-tables.cjs')({a,foreign,base,post,rows:(t,w)=>q(`SELECT * FROM ${t} WHERE ${w}`),count:(t,w)=>Number(q(`SELECT count(*) AS n FROM ${t} WHERE ${w}`)[0].n),check});
  if(['workflows','print'].includes(process.env.POS_QA_PHASE))await require('./verify-kitchen-print.cjs')({a,foreign,base,post,rows:(t,w)=>q(`SELECT * FROM ${t} WHERE ${w}`),count:(t,w)=>Number(q(`SELECT count(*) AS n FROM ${t} WHERE ${w}`)[0].n),check,out});
  if(results.some(x=>!x.passed))process.exitCode=1;return;
 }
 const page=a.p;page.on('pageerror',e=>console.error('PAGE',e.message));
 await page.goto(base+'/apps/zenith/pos/Kitchen/KitchenDisplay');await page.locator('.zk-display').waitFor();
 check('empty state renders without a template error',await page.locator('.zk-empty').count()===1&&await page.locator('.zk-orders').count()===0);
 check('page heading and description are explicit',await page.getByRole('heading',{name:'Kitchen Display',exact:true}).count()===1&&(await page.locator('.zk-heading p').innerText()).includes('Track and manage'));
 check('three live counts start at zero',(await page.locator('[data-kitchen-count]').allTextContents()).join(',')==='0,0,0');
 check('no duplicate module shortcuts',await page.locator('.zk-display a').count()===0);
 await page.screenshot({path:path.join(out,'empty.png')});
 const ids=[];
 for(let i=0;i<3;i++){const before=new Set(q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").map(x=>x.kot_id));const r=await post('Kitchen/KotBilling','createKot',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:2,specialInstructions:'No onion'}]),orderType:'Dine In',tableNumber:String(i+1),notes:i===0?'Synthetic kitchen note':''});assert.ok(r.status()<400);const row=q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").find(x=>!before.has(x.kot_id));assert.ok(row);ids.push(row.kot_id);}
 await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[1],statusId:'KotPreparing'});await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[2],statusId:'KotPreparing'});await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[2],statusId:'KotReady'});
 for(const shell of ['apps']){const r=await a.c.request.get(`${base}/${shell}/zenith/pos/Kitchen/KitchenDisplay?filterStatus=KotNew`);const html=await r.text();check(shell+' filtered render has one order and global status counts',r.status()===200&&html.includes('data-kitchen-count="KotPreparing">1')&&html.includes('data-kitchen-count="KotReady">1')&&(html.match(/data-kot-id=/g)||[]).length===1,{status:r.status(),tail:html.slice(-350)});}
 await page.goto(base+'/apps/zenith/pos/Kitchen/KitchenDisplay');await page.locator('.zk-orders').waitFor();
 check('active cards replace the empty state',await page.locator('.zk-order').count()===3&&await page.locator('.zk-empty').count()===0);
 check('stored item names and instructions are visible',(await page.locator('.zk-items').first().innerText()).includes('Disposable POS A P18')&&(await page.locator('.zk-instruction').first().innerText())==='No onion');
 await page.screenshot({path:path.join(out,'orders-desktop.png')});
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});check('responsive Kitchen content at '+width,await page.locator('.zk-display').evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.width>0;}));const metrics=await page.locator('.zk-metric').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));check('summary cards align at '+width,Math.max(...metrics.map(x=>x.y))-Math.min(...metrics.map(x=>x.y))<2&&Math.max(...metrics.map(x=>x.w))-Math.min(...metrics.map(x=>x.w))<2);}
 await page.screenshot({path:path.join(out,'orders-mobile.png')});await page.setViewportSize({width:1440,height:1000});
 const status=id=>q(`SELECT status_id FROM kitchen_order_ticket WHERE kot_id='${id}'`)[0].status_id;
 const denied=await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[0],statusId:'KotPreparing'},foreign);check('foreign organization cannot change a KOT',denied.status()<500&&status(ids[0])==='KotNew');
 const noToken=await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[0],statusId:'KotPreparing'},a,false);check('status change requires CSRF',noToken.status()>=400&&status(ids[0])==='KotNew');
 await post('Kitchen/KitchenDisplay','updateStatus',{kotId:ids[0],statusId:'KotServed'});check('skipped status changes stay rejected',status(ids[0])==='KotNew');
 for(const [name,next] of [['Start Preparing','KotPreparing'],['Ready','KotReady'],['Served','KotServed']]){await page.goto(base+'/apps/zenith/pos/Kitchen/KitchenDisplay');const card=page.locator(`[data-kot-id="${ids[0]}"]`);await Promise.all([page.waitForNavigation(),card.getByRole('button',{name,exact:true}).click()]);check(name+' persists using the existing workflow',status(ids[0])===next);}
 await page.goto(base+'/qapps/zenith/pos/Kitchen/KitchenDisplay');await page.locator('.zk-display').waitFor();await page.waitForFunction(()=>!document.documentElement.classList.contains('zk-route-pending'));
 check('qapps renders live Kitchen data with the existing shell',await page.locator('#zq-subnav').isVisible()&&await page.locator('.zk-order').count()===2);
 const labels=await page.locator('#kitchen-page-frame [role=tab]').allTextContents();check('KOT submodules preserve the requested labels and order',labels.map(x=>x.trim()).filter(Boolean).join('|')==='KOT Dashboard|Kitchen Display|KOT Billing|Tables|KOT History|Waiters',labels);
 let release;const blocked=new Promise(r=>release=r);let started;const requested=new Promise(r=>started=r);
 await page.route('**/Kitchen/KotBilling.qvt*',async route=>{started();await blocked;await route.continue();});
 const navigation=page.getByRole('tab',{name:'KOT Billing',exact:true}).click({noWaitAfter:true});
 await Promise.race([requested,new Promise((_,reject)=>setTimeout(()=>reject(Error('Kitchen component navigation request was not observed')),10000))]);await page.waitForTimeout(1100);
 check('slow real qapps navigation hides old Kitchen content immediately',!await page.locator('.zk-display').isVisible()&&await page.locator('#zk-route-status').isVisible());
 check('existing global navigation remains visible during loading',await page.locator('#zq-subnav').isVisible());
 await page.screenshot({path:path.join(out,'slow-navigation.png')});release();await navigation;await page.locator('#kot-terminal-entry').waitFor();await page.waitForFunction(()=>!document.documentElement.classList.contains('zk-route-pending'));
 check('qapps replaces child content without retaining a loading mask',await page.locator('#kitchen-page-frame').count()===1&&await page.locator('#zk-route-status').count()===0);
 await page.unroute('**/Kitchen/KotBilling.qvt*');
 for(const [label,selector] of [['Tables','#tm-wrap'],['KOT History','#zk-history-toolbar'],['Waiters','#wf-search'],['KOT Dashboard','#kd-wrap'],['KOT Billing','#kb-wrap']]){
  await page.getByRole('tab',{name:label,exact:true}).click();await page.locator(selector).waitFor();await page.waitForFunction(()=>!document.documentElement.classList.contains('zk-route-pending'));
  check('qapps '+label+' navigation replaces the previous content',await page.locator(selector).isVisible()&&await page.locator('#kitchen-page-frame').count()===1);
 }
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling');await page.locator('#kot-terminal-entry').waitFor();await page.waitForFunction(()=>!document.documentElement.classList.contains('zk-initial-loading'),undefined,{timeout:20000});
 check('KOT Billing direct entry waits for the existing shell',await page.locator('#z-sidebar').isVisible()&&await page.locator('#z-subnav').isVisible()&&await page.locator('#kb-wrap').isVisible());
 await page.screenshot({path:path.join(out,'kot-billing-current-shell.png')});
 const rows=(table,where)=>q(`SELECT * FROM ${table} WHERE ${where}`),count=(table,where)=>Number(q(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n);
 await require('./verify-kitchen-tables.cjs')({a,foreign,base,post,rows,count,check});
 await require('./verify-kitchen-print.cjs')({a,foreign,base,post,rows,count,check,out});
 await require('./verify-kot.cjs')({a,foreign,base,post,rows,count,check});
 await a.c.close();await foreign.c.close();
}finally{await browser.close();fs.writeFileSync(path.join(out,'runtime-results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.passed).length}));if(results.some(x=>!x.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
