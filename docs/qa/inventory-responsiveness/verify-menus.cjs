// Read-only checks: open row menus and native filters, then cancel without submitting.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const base=process.env.RESPONSIVE_BASE_URL||'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local runtime required');
const out=process.env.RESPONSIVE_OUTPUT||'tmp/responsiveness/inventory-menus';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const page=await context.newPage(),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/Login',{waitUntil:'domcontentloaded'});await page.locator('#login_form_organizationId').fill(process.env.RESPONSIVE_ORGANIZATION||'LOCALERP');await page.locator('#login_form_username').fill(process.env.SMOKE_USER);await page.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS);await page.locator('#login_form [type=submit]').click();await page.waitForTimeout(800);
 for(const shell of (process.env.RESPONSIVE_SHELLS||'apps,qapps').split(','))for(const [screen,menuSelector,actionSelector,filterLabel] of [['FindProduct','.catalog-row-menu','.catalog-open','Find Options'],['StockTransfers','.st-row-menu','.st-row-options a','Filters']].filter(s=>!process.env.RESPONSIVE_SCREENS||process.env.RESPONSIVE_SCREENS.split(',').includes(s[0])))for(const width of (process.env.RESPONSIVE_WIDTHS||'320,768,1440').split(',').map(Number)){
  await page.setViewportSize({width,height:900});await page.goto(`${base}/${shell}/zenith/Inventory/${screen}`,{waitUntil:'domcontentloaded'});await page.locator(menuSelector).last().waitFor();await page.waitForTimeout(250);
  const menu=page.locator(menuSelector).last();await menu.locator('summary').scrollIntoViewIfNeeded();await page.waitForTimeout(250);await menu.locator('summary').click();await page.waitForTimeout(100);
  const geometry=await menu.locator(actionSelector).first().evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,open:e.closest('details').open,hit:!!hit&&(hit===e||e.contains(hit)),obstruction:hit&&!(hit===e||e.contains(hit))?{tag:hit.tagName,id:hit.id,cls:hit.className,text:hit.textContent.slice(0,60)}:null};});results.push({shell,screen,width,control:'last-row menu',...geometry,pass:geometry.left>=-1&&geometry.right<=width+1&&geometry.hit});await menu.locator('summary').click();
  await page.getByRole('button',{name:filterLabel,exact:true}).first().click();const dialog=page.locator(shell==='apps'?'.modal.in':'.q-dialog');await dialog.waitFor();const filter=await dialog.evaluate(e=>{const r=(e.querySelector('.modal-content,.q-card')||e).getBoundingClientRect();return{left:r.left,right:r.right};});results.push({shell,screen,width,control:'native filters',...filter,pass:filter.left>=-1&&filter.right<=width+1});await page.keyboard.press('Escape');
  // Some native Quasar filter panels are persistent. Navigating away dismisses without submitting.
  if(await dialog.isVisible())await page.goto(`${base}/${shell}/zenith/Inventory/${screen}`,{waitUntil:'domcontentloaded'});await dialog.waitFor({state:'hidden'});
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors},null,2));
 }
 const failures=results.filter(r=>!r.pass);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors,failures},null,2));console.log(JSON.stringify({cases:results.length,failures,errors}));await browser.close();if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
