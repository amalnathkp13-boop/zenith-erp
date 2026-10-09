// Read-only responsive verification. Playwright and local demo credentials are supplied by the caller.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const base=process.env.RESPONSIVE_BASE_URL||'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local runtime required');
const out=process.env.RESPONSIVE_OUTPUT||'tmp/responsiveness/inventory';fs.mkdirSync(out,{recursive:true});
const screens=[
 ['InventoryDashboard','', '.inv-dashboard'],['DashboardDetails','?listType=movements','.inv-detail-content'],['DashboardDetails-lowstock','?listType=lowstock','.inv-detail-content'],['DashboardDetails-products','?listType=products','.inv-detail-content'],
 ['FindProduct','','#productCatalog'],['EditProduct','?productId=PREVIEW_SL_COTTON',null],['CreateCatalogue','','#cataloguesPage'],['CreateCatalogue-members','?productCategoryId=RESP_INV_CAT','#cataloguesPage'],['FindFacility','',null],['EditFacility','?facilityId=PREVIEW_SL_MAIN',null],['FindReceipt','','#receivingStocks'],['ReceiveInventory','?orderId=RESP_INV_PO1','#receivingStockDetail'],['SerialNumbers','','#serialTracking'],['DemandForecast','','#demandForecastPage'],['StockLevels','','#stockLevels'],['StockTransfers','','#stockTransfers'],['NewStockTransfer','',null],['EditStockTransfer','?stockTransferId=PREVIEW_ST_100615',null],['StockAdjustments','','#stockAdjustments'],['EditStockAdjustment','?stockAdjustmentId=RESP_INV_ADJ1','#stockAdjustmentDetail'],['GatePasses','','#gatePassesPage'],['PrintGatePass','?gatePassId=RESP_INV_GP1','#gatePassPrint'],['ExpiryDashboard','','#expiryRisk']
];
(async()=>{const browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());const page=await context.newPage();const results=[],errors=[];page.on('pageerror',e=>errors.push({url:page.url(),error:e.message}));
 await page.goto(base+'/Login',{waitUntil:'domcontentloaded'});await page.locator('#login_form_organizationId').fill(process.env.RESPONSIVE_ORGANIZATION||'LOCALERP');await page.locator('#login_form_username').fill(process.env.SMOKE_USER);await page.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS);await page.locator('#login_form [type=submit]').click();await page.waitForTimeout(800);
 for(const shell of ['apps','qapps'])for(const [name,query,sel] of screens.filter(s=>!process.env.RESPONSIVE_SCREENS||process.env.RESPONSIVE_SCREENS.split(',').includes(s[0]))){
 await page.setViewportSize({width:1440,height:1000});const route=name.replace(/-(lowstock|products|members)$/,'');await page.goto(`${base}/${shell}/zenith/Inventory/${route}${query}`,{waitUntil:'domcontentloaded',timeout:90000});
 if(sel)await page.locator(sel).first().waitFor({timeout:30000});else await page.locator(shell==='apps'?'#content':'.q-page').first().waitFor();await page.waitForTimeout(500);
 const text=await page.locator('body').innerText();if(/Error rendering|Exception running|ScreenRenderException/.test(text))throw Error('Render failure '+name);
 for(const width of [320,390,600,768,900,1024,1280,1440,1920,2560]){
 await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
 const geometry=await page.evaluate(({sel,shell})=>{
 const root=sel?document.querySelector(sel):document.querySelector(shell==='apps'?'#content':'.q-page');const r=root.getBoundingClientRect();
 const isScrolled=e=>{for(let p=e.parentElement;p&&p!==root;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth)return true;}return false;};
 const outside=Array.from(root.querySelectorAll('*')).filter(e=>e.checkVisibility()&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&!isScrolled(e)&&!['svg','path','circle','text','line','defs','linearGradient','stop'].includes(e.tagName)&&!e.closest('.modal:not(.in),.q-dialog,.select2-container,.tt-menu')).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right)}));
 return {scroll:document.documentElement.scrollWidth,root:{left:r.left,right:r.right,width:r.width},outside:outside.slice(0,20)};
 },{sel,shell});results.push({shell,name,width,...geometry});
 if([320,1440].includes(width))await page.screenshot({path:path.join(out,`${shell}-${name}-${width}.png`),fullPage:width>=768});
 }
 console.log(shell,name,'checked');
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors},null,2));
 }
 const failures=results.filter(r=>r.scroll>r.width+1||r.outside.length);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors,failures},null,2));console.log(JSON.stringify({cases:results.length,failures,errors}));await browser.close();if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
