const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const base=process.env.POS_REFERENCE_BASE_URL;
if(base!=='http://127.0.0.1:18085')throw Error('Fresh disposable loopback runtime required');
const out=process.env.POS_REFERENCE_OUTPUT;
if(!out||!process.env.POS_REFERENCE_USERNAME||!process.env.POS_REFERENCE_PASSWORD)throw Error('Disposable output and credentials required');
fs.mkdirSync(out,{recursive:true});
const report={checks:[],layouts:[],pageErrors:[],productionAccess:false};let browser;
function check(name,pass,detail){report.checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});if(!pass)throw Error(name+': '+JSON.stringify(detail));}
function query(sql){const r=spawnSync(process.env.POS_REFERENCE_JAVA,['-cp',process.env.POS_REFERENCE_H2_JAR,path.join(__dirname,'PosReferenceDbProbe.java')],{input:sql,encoding:'utf8',timeout:30000,windowsHide:true});if(r.status!==0)throw Error('SELECT probe failed: '+r.stderr.slice(0,300));return JSON.parse(r.stdout);}
function billing(){const tables=query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='PUBLIC' AND TABLE_NAME IN ('INVOICE','INVOICE_ITEM','PAYMENT','ORDER_HEADER','ORDER_PART','ORDER_ITEM','POS_TRANSACTION','POS_TRANSACTION_ITEM','POS_PAYMENT','POS_SESSION','ACCTG_TRANS','ACCTG_TRANS_ENTRY') ORDER BY TABLE_NAME");check('Independent billing probe includes POS and accounting',tables.length>=10,tables.map(t=>t.table_name));return Object.fromEntries(tables.map(({table_name})=>{const rows=query('SELECT * FROM '+table_name);rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return[table_name,{count:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}]}));}
async function open(page,shell,screen){await page.goto(`${base}/${shell}/zenith/pos/${screen}`,{waitUntil:'networkidle',timeout:90000});await page.locator('#pos-module-nav').waitFor({timeout:60000});}
async function token(page){return page.evaluate(()=>document.querySelector('#confMoquiSessionToken')?.value||document.querySelector('[name=moquiSessionToken]')?.value||window.moqui?.webrootVue?.moquiSessionToken);}
async function hit(locator){await locator.scrollIntoViewIfNeeded();return locator.evaluate(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!h&&(h===e||e.contains(h));});}
(async()=>{try{
 browser=await chromium.launch({headless:true,executablePath:process.env.POS_REFERENCE_CHROME||undefined});
 const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();page.on('pageerror',e=>{report.pageErrors.push({message:e.message,url:new URL(page.url()).pathname,stack:e.stack});console.log(JSON.stringify(report.pageErrors.at(-1)));});
 const login=await context.request.post(base+'/Login/login',{form:{username:process.env.POS_REFERENCE_USERNAME,password:process.env.POS_REFERENCE_PASSWORD},maxRedirects:0,timeout:60000});
 check('Disposable login succeeds',login.status()===302,{status:login.status()});
 await page.goto(base+'/apps/zenith/Contacts/PosUiQa',{waitUntil:'networkidle'});const csrf=await token(page);check('Authenticated CSRF token exists',!!csrf);
 const init=await context.request.post(base+'/apps/zenith/Contacts/PosUiQa/initialize',{form:{moquiSessionToken:csrf}});check('Fresh fixture initialized',init.status()===200&&(await init.json()).initialized===true);
 check('Captured terminal exists before tests',query("SELECT TERMINAL_ID FROM POS_TERMINAL WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length===1);
 report.billingBefore=billing();
 for(const shell of ['qapps','apps']){
   await open(page,shell,'CashEntry');check(`${shell}: new stylesheet loaded`,await page.locator('link[href*="pos-reference.css?v=1"]').count()>0);
   if(shell==='qapps'){
     await page.route('**/pos-reference.css?*',r=>r.abort());await page.reload({waitUntil:'networkidle'});
     const bad=await page.locator('#CashFilter .q-field').first().evaluate(e=>parseFloat(getComputedStyle(e).paddingLeft));check('Latest master shared label reservation reproduced',bad===152,{padding:bad});
     await page.unroute('**/pos-reference.css?*');await page.reload({waitUntil:'networkidle'});
     check('Cash label reservation removed',await page.locator('#CashFilter .q-field').first().evaluate(e=>parseFloat(getComputedStyle(e).paddingLeft))===0);
   }
   const help=page.locator('.pos-reference-help').first();check(`${shell}: help initially collapsed`,!await help.evaluate(e=>e.open));await help.locator('summary').focus();await page.keyboard.press('Enter');check(`${shell}: help expands by keyboard`,await help.evaluate(e=>e.open));await page.keyboard.press('Enter');check(`${shell}: help collapses by keyboard`,!await help.evaluate(e=>e.open));
   for(const [form,type,amount] of [['CashInForm','CashIn','13.25'],['CashOutForm','CashOut','7.50']]){
     await open(page,shell,'CashEntry');const before=query("SELECT CASH_ENTRY_ID FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length;
     await page.locator(`#${form} [name=amount]`).fill(amount);await page.locator(`#${form} [name=description]`).fill(`POS_UI_QA ${shell} ${type}`);
     const submit=page.locator(`#${form} [type=submit]`);check(`${shell}: ${form} submit receives pointer`,await hit(submit));await submit.click();await page.waitForTimeout(500);
     const saved=query(`SELECT AMOUNT,ENTRY_TYPE FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA' AND DESCRIPTION='POS_UI_QA ${shell} ${type}'`);
     check(`${shell}: native ${type} commits exactly one correct row`,saved.length===1&&Number(saved[0].amount)===Number(amount)&&saved[0].entry_type===type&&query("SELECT CASH_ENTRY_ID FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length===before+1,saved);
   }
   await open(page,shell,'CashEntry');await page.locator('#CashFilter [name=searchText]').fill('POS_UI_QA '+shell+' CashIn');await page.locator('#CashFilter [type=submit]').click();await page.waitForTimeout(400);
   const expected=query(`SELECT DESCRIPTION FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA' AND DESCRIPTION='POS_UI_QA ${shell} CashIn'`);
   const filtered=await page.locator('#CashEntryList_table').innerText();check(`${shell}: native search filters persisted rows`,expected.length===1&&filtered.includes(expected[0].description)&&!filtered.includes('POS_UI_QA '+shell+' CashOut'));
   const reset=page.locator('#CashFilter_resetBtn');check(`${shell}: Reset is reachable`,await hit(reset));await reset.click();await page.waitForTimeout(400);check(`${shell}: Reset restores saved rows`,await page.locator('#CashFilter [name=searchText]').inputValue()===''&&(await page.locator('#CashEntryList_table').innerText()).includes('POS_UI_QA '+shell+' CashOut'));
   await page.locator('#CashFilter [name=filterDate]').fill('2026-11-01');await page.locator('#CashFilter [name=filterThruDate]').fill('2026-11-01');await page.locator('#CashFilter [type=submit]').click();await page.waitForTimeout(400);
   const boundaries=await page.locator('#CashEntryList_table').innerText();
   check(`${shell}: user-local DST day includes midnight and final millisecond but excludes next day`,boundaries.includes('POS_UI_QA_BOUNDARY_START')&&boundaries.includes('POS_UI_QA_BOUNDARY_LAST')&&!boundaries.includes('POS_UI_QA_BOUNDARY_NEXT'));
   const stamps=query("SELECT CASH_ENTRY_ID,ENTRY_DATE FROM POS_CASH_ENTRY WHERE CASH_ENTRY_ID IN ('POS_UI_QA_START','POS_UI_QA_NEXT') ORDER BY CASH_ENTRY_ID");
   check(`${shell}: boundary fixture spans a 25-hour DST day`,stamps.length===2&&Math.abs(Date.parse(stamps[1].entry_date)-Date.parse(stamps[0].entry_date))===25*60*60*1000);
   await open(page,shell,'CashEntry');
   const cashBefore=query("SELECT CASH_ENTRY_ID FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length;
   await page.locator('#CashInForm [name=amount]').fill('-1');await page.locator('#CashInForm [type=submit]').click();await page.waitForTimeout(400);check(`${shell}: invalid Cash In creates no row`,query("SELECT CASH_ENTRY_ID FROM POS_CASH_ENTRY WHERE ORGANIZATION_PARTY_ID='POS_UI_QA'").length===cashBefore);
   await open(page,shell,'Kitchen/Tables');await page.locator('#tm-editbtn').waitFor();
   check(`${shell}: unsupported table actions removed`,await page.locator('[onclick*="tmSoon"]').count()===0);
   await page.getByRole('button',{name:'List View',exact:true}).click();await page.locator('.tm-fpill[data-f=reserved]').click();
   check(`${shell}: list status filter matches DB`,await page.locator('.tm-table tbody tr[data-status]:visible').count()===query("SELECT TABLE_ID FROM RESTAURANT_TABLE WHERE FACILITY_ID='POS_UI_QA_FAC' AND STATUS_ID='TblReserved'").length);
   await page.getByRole('button',{name:'Floor View',exact:true}).click();check(`${shell}: floor status filter agrees`,await page.locator('.tm-card:visible').count()===1);
   await page.locator('.tm-card[data-table-id=POS_UI_QA_RESERVED]').click();await page.locator('#tm-editbtn').click();check(`${shell}: selected Delete enabled`,await page.locator('#tm-ebtn-delete').isEnabled());
   await page.locator('.tm-fpill[data-f=available]').click();check(`${shell}: filtering clears hidden selection`,await page.locator('.tm-panel:visible').count()===0&&!await page.locator('#tm-ebtn-delete').isEnabled());
   await page.getByRole('button',{name:'Add Table',exact:true}).first().click();check(`${shell}: real Add Table modal opens`,await page.locator('#tm-addmodal').isVisible());
   await page.locator('#tm-f-num').fill('POS_UI_QA_'+shell);await page.locator('#tm-f-fac').selectOption('POS_UI_QA_FAC');await page.locator('#tm-addsave').click();await page.waitForTimeout(600);
   const created=query(`SELECT TABLE_ID,STATUS_ID FROM RESTAURANT_TABLE WHERE FACILITY_ID='POS_UI_QA_FAC' AND TABLE_NUMBER='POS_UI_QA_${shell}'`);check(`${shell}: Add Table persists independently`,created.length===1&&created[0].status_id==='TblAvailable');
   await page.locator(`.tm-card[data-table-id="${created[0].table_id}"]`).click();await page.locator(`.tm-panel[data-table-id="${created[0].table_id}"] .tm-setlink`).filter({hasText:'Reserved'}).click();await page.waitForTimeout(500);
   check(`${shell}: table status persists`,query(`SELECT STATUS_ID FROM RESTAURANT_TABLE WHERE TABLE_ID='${created[0].table_id}'`)[0].status_id==='TblReserved');
   await page.locator(`.tm-card[data-table-id="${created[0].table_id}"]`).click();await page.locator(`.tm-panel[data-table-id="${created[0].table_id}"] .tm-abtn`).filter({hasText:'Close Table'}).click();await page.waitForTimeout(500);
   check(`${shell}: Close Table persists`,query(`SELECT STATUS_ID FROM RESTAURANT_TABLE WHERE TABLE_ID='${created[0].table_id}'`)[0].status_id==='TblAvailable');
   await page.locator(`.tm-card[data-table-id="${created[0].table_id}"]`).click();await page.locator('#tm-editbtn').click();page.once('dialog',d=>d.accept());await page.locator('#tm-ebtn-delete').click();await page.waitForTimeout(500);
   check(`${shell}: Delete removes captured disposable table`,query(`SELECT TABLE_ID FROM RESTAURANT_TABLE WHERE TABLE_ID='${created[0].table_id}'`).length===0);
   await open(page,shell,'Dashboard');check(`${shell}: dashboard title stays visible`,await page.locator('.pos-reference-header').isVisible());
   const date=page.locator('.pos-reference-dates .zdash-dr summary');await date.click();check(`${shell}: custom dates open`,await page.locator('.zdash-dr-pop').isVisible());check(`${shell}: custom Apply receives pointer`,await hit(page.locator('.zdash-dr-apply')));
   await page.locator('.zdash-dr-pop [name=dashDate]').fill('2026-10-01');await page.locator('.zdash-dr-pop [name=dashDateTo]').fill('2026-10-08');await page.locator('.zdash-dr-apply').click();await page.waitForTimeout(500);
   check(`${shell}: custom Apply submits real date range`,new URL(page.url()).searchParams.get('dashDate')==='2026-10-01'&&new URL(page.url()).searchParams.get('dashDateTo')==='2026-10-08');
   console.log(shell+': cash and table action checks passed');
   for(const screen of ['Dashboard','PosTransactions','PosSessions','PosTerminals','CreditBills','CashEntry','DailySummary','Expenses','Wastage','Stock','Reports','BillAuditReport','ReceiptConfig','Kitchen/Tables']){
     for(const width of [1440,768,390]){
       await page.setViewportSize({width,height:900});await open(page,shell,screen);
       const h=page.locator('.pos-reference-help').first();check(`${shell} ${screen} ${width}: retained help renders collapsed`,await h.count()===1&&!await h.evaluate(e=>e.open));
       if(screen==='Wastage'){
         await page.waitForFunction(()=>document.getElementById('wastage-expiring-root')?.textContent.includes('No perishable products with expiry dates.'),{timeout:15000});
         check(`${shell} ${width}: Wastage loads real empty results rather than a dead loading panel`,(await page.locator('#wastage-expiring-root').innerText()).includes('No perishable products with expiry dates.'));
       }
       const geometry=await h.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height,viewport:innerWidth};});check(`${shell} ${screen} ${width}: compact help inside viewport`,geometry.left>=-1&&geometry.right<=width+1&&geometry.height<85,geometry);report.layouts.push({shell,screen,width,...geometry});
       if(screen==='Dashboard'){await page.locator('.pos-reference-dates .zdash-dr summary').click();check(`${shell} ${width}: custom Apply not covered`,await hit(page.locator('.zdash-dr-apply')));await page.locator('.pos-reference-dates .zdash-dr summary').click();}
       if(screen==='CashEntry'){
         for(const form of ['CashFilter','CashInForm','CashOutForm']){
           const fields=await page.locator(`#${form} input:not([type=hidden])`).evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{width:r.width,left:r.left,right:r.right};}));check(`${shell} ${form} ${width}: inputs remain usable`,fields.length>0&&fields.every(e=>e.width>=70&&e.left>=-1&&e.right<=width+1),fields);
         }
         if(shell==='qapps'){
           const labels=await page.locator('#CashFilter .q-field').evaluateAll(es=>es.map(e=>{const l=e.querySelector('.q-field__label')?.getBoundingClientRect(),i=e.querySelector('input')?.getBoundingClientRect();return !l||!i||l.bottom<=i.top+2;}));check(`${shell} ${width}: filter labels do not collide with inputs`,labels.every(Boolean));
         }
         check(`${shell} ${width}: Cash In submit remains clickable`,await hit(page.locator('#CashInForm [type=submit]')));
         check(`${shell} ${width}: Cash Out submit remains clickable`,await hit(page.locator('#CashOutForm [type=submit]')));
       }
       if(['CashEntry','Dashboard','PosTransactions','PosTerminals','Kitchen/Tables'].includes(screen)&&width!==768){await page.keyboard.press('Control+Home');await page.screenshot({path:path.join(out,`${shell}-${screen.replace('/','-')}-${width}.png`),fullPage:true});}
     }
   }
   await page.setViewportSize({width:1440,height:900});
   for(const [module,route] of [['POS','pos/CashEntry'],['Contacts','Contacts/Customers'],['Sales','sales/SalesDashboard'],['Purchase','Purchase/RfqList']]){
     for(const width of [1440,390]){
       await page.setViewportSize({width,height:420});await page.goto(`${base}/${shell}/zenith/${route}`,{waitUntil:'networkidle',timeout:90000});
       await page.locator('#top').waitFor();await page.keyboard.press('Control+Home');
       const before=await page.locator('#top').evaluate(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height}));
       await page.keyboard.press('Control+End');await page.waitForTimeout(350);
       const after=await page.locator('#top').evaluate(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,scrollY}));
       check(`${shell} ${module} ${width}: shared topbar remains visible while scrolling`,Math.abs(after.top-before.top)<2&&after.top>=-1&&after.height>0,{before,after});
       await page.keyboard.press('Control+Home');await page.waitForTimeout(200);
       check(`${shell} ${module} ${width}: shared topbar returns without a layout jump`,Math.abs((await page.locator('#top').boundingBox()).y-before.top)<2);
       if(shell==='apps'&&width===390){
         const burger=page.locator('#z-side-burger');check(`${module}: mobile navigation receives pointer above the sticky topbar`,await hit(burger));
         await burger.click();check(`${module}: mobile sidebar opens`,await page.locator('body').evaluate(e=>e.classList.contains('z-side-open')));
         await page.locator('#z-side-backdrop').click({position:{x:380,y:200}});
         check(`${module}: mobile sidebar closes`,!await page.locator('body').evaluate(e=>e.classList.contains('z-side-open')));
       }
     }
   }
   await page.setViewportSize({width:1440,height:900});
 }
 report.billingAfter=billing();check('Billing/session/issued invoice state unchanged by UI checks',JSON.stringify(report.billingBefore)===JSON.stringify(report.billingAfter));check('No browser exceptions',report.pageErrors.length===0,report.pageErrors);
}catch(e){report.error=e.message;process.exitCode=1;}finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,layouts:report.layouts.length,failures:report.checks.filter(c=>!c.pass).length,error:report.error}));}})();
