// Open/cancel native dialogs and inspect date controls; no business writes or saved preferences.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const base=process.env.RESPONSIVE_BASE_URL||'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local runtime required');
const out=process.env.RESPONSIVE_OUTPUT||'tmp/responsiveness/inventory-interactions';fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({headless:true}),c=await b.newContext({serviceWorkers:'block'});await c.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());const p=await c.newPage();const results=[],errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/Login',{waitUntil:'domcontentloaded'});await p.locator('#login_form_organizationId').fill(process.env.RESPONSIVE_ORGANIZATION||'LOCALERP');await p.locator('#login_form_username').fill(process.env.SMOKE_USER);await p.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS);await p.locator('#login_form [type=submit]').click();await p.waitForTimeout(800);
 for(const shell of ['apps','qapps']){
 for(const [screen,label,id] of [['FindProduct','New Product','CreateProductDialog'],['FindFacility','New Facility','CreateFacilityDialog'],['CreateCatalogue','New Catalogue','NewCatalogueDialog'],['SerialNumbers','Register Serial','RegisterSerialDialog'],['StockAdjustments','New Adjustment','NewAdjDialog'],['GatePasses','Issue Gate Pass','NewGatePassDialog'],['ExpiryDashboard','Add Expiring Stock','AddExpiryStockDialog'],['ExpiryDashboard','Alert Settings','ExpiryAlertSettingsDialog'],['ExpiryDashboard','Columns','ColumnsDialog']]){
 if(process.env.RESPONSIVE_CONTROLS_ONLY==='1')continue;
 for(const width of [320,768,1440]){
 await p.setViewportSize({width,height:900});await p.goto(`${base}/${shell}/zenith/Inventory/${screen}`,{waitUntil:'domcontentloaded'});await p.waitForTimeout(300);
 const btn=shell==='apps'?p.locator('#'+id+'-button'):p.getByRole('button',{name:label,exact:true});await btn.click();const dialog=p.locator(shell==='apps'?'.modal.in':'.q-dialog');await dialog.waitFor({timeout:10000});
 const geometry=await dialog.evaluate(e=>{const card=e.querySelector('.modal-content,.q-card')||e;const r=card.getBoundingClientRect();const bad=Array.from(card.querySelectorAll('input:not([type=hidden]),select,textarea,button')).filter(n=>n.checkVisibility()&&n.getBoundingClientRect().width>0).filter(n=>{const a=n.getBoundingClientRect();return a.left<r.left-1||a.right>r.right+1}).map(n=>({tag:n.tagName,id:n.id,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}));return{left:r.left,right:r.right,bad};});
 results.push({shell,screen,label,width,...geometry,pass:geometry.left>=-1&&geometry.right<=width+1&&!geometry.bad.length});
 await p.screenshot({path:path.join(out,`dialog-${shell}-${id}-${width}.png`),fullPage:false});
 await p.keyboard.press('Escape');if(await dialog.isVisible()){const close=dialog.getByRole('button',{name:/Close|Cancel/}).first();if(await close.count())await close.click();}await dialog.waitFor({state:'hidden',timeout:10000});
 }
 console.log(shell,screen,label,'dialogs checked');
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors},null,2));
 }
 for(const width of [320,768,1024,1440]){
 await p.setViewportSize({width,height:900});await p.goto(`${base}/${shell}/zenith/Inventory/InventoryDashboard`,{waitUntil:'domcontentloaded'});await p.waitForTimeout(400);
 await p.locator('.inv-date summary').click();const popup=await p.locator('.inv-date form').evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right}});results.push({shell,screen:'InventoryDashboard',label:'Date picker',width,...popup,pass:popup.left>=-1&&popup.right<=width+1});await p.locator('.inv-date summary').click();
 await p.locator('.inv-additional>summary').click();await p.waitForTimeout(500);const additional=await p.locator('.inv-additional').evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}});results.push({shell,screen:'InventoryDashboard',label:'Additional insights',width,...additional,pass:additional.left>=-1&&additional.right<=width+1&&additional.scroll<=additional.client+1});
 }
 }
 const failures=results.filter(r=>!r.pass);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors,failures},null,2));console.log(JSON.stringify({cases:results.length,failures,errors},null,2));await b.close();if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
