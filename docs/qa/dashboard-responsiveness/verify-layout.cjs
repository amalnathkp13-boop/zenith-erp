// Read-only browser verification against a seeded local demo. Never runs against production.
const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const base=process.env.RESPONSIVE_BASE_URL||'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local runtime required');
const out=process.env.RESPONSIVE_OUTPUT||'tmp/responsiveness/dashboard';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext();
 const login=await context.newPage();await login.goto(base+'/Login',{waitUntil:'domcontentloaded'});
 await login.locator('#login_form_organizationId').fill(process.env.RESPONSIVE_ORGANIZATION||'LOCALERP');await login.locator('#login_form_username').fill(process.env.SMOKE_USER);await login.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS);await login.locator('#login_form [type=submit]').click();await login.waitForTimeout(1000);await login.close();
 const page=await context.newPage();const results=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const shell of ['apps','qapps']){
 await page.goto(`${base}/${shell}/zenith/Dashboard`,{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('#homeLayoutStatus').waitFor({state:'attached',timeout:60000});await page.locator('#homeActivityChart svg').waitFor({timeout:30000});await page.waitForTimeout(500);
 for(const width of [320,360,390,600,768,820,1024,1280,1366,1440,1920,2560]){
 await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
 const normal=await page.evaluate(()=>{
 const root=document.querySelector('#homeDashboard');const rr=root.getBoundingClientRect();
 const overflow=Array.from(root.querySelectorAll('*')).filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.checkVisibility()&&r.width&&r.height&&s.position!=='fixed'&&(r.right>innerWidth+1||r.left<-1)}).map(e=>({tag:e.tagName,cls:e.className,id:e.id,r:{left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}}));
 const cramped=Array.from(root.querySelectorAll('.zdh-card,.zsc,.zdh-ocard')).filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({cls:e.className,scroll:e.scrollWidth,client:e.clientWidth}));
 return {scroll:document.documentElement.scrollWidth,root:{left:rr.left,right:rr.right,width:rr.width},overflow,cramped};});
 await page.locator('.zdash-dr summary').click();
 const popup=await page.locator('.zdash-dr-pop').evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,scroll:document.documentElement.scrollWidth}});
 await page.locator('.zdash-dr summary').click();
 results.push({shell,width,...normal,popup});
 if([320,768,1024,1440,1920].includes(width))await page.screenshot({path:path.join(out,`${shell}-${width}.png`),fullPage:width>=768});
 }
 await page.setViewportSize({width:320,height:900});
 await page.waitForTimeout(350);
 await page.locator('.home-title p,.zdh-tn,.zdh-amt,.bh-mv').evaluateAll(es=>es.forEach(e=>e.textContent='LongPreviewLabelOrTotal12345678901234567890'));
 const stress=await page.locator('#homeDashboard').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,document:document.documentElement.scrollWidth,overflow:Array.from(e.querySelectorAll('*')).filter(n=>n.checkVisibility()&&n.scrollWidth>n.clientWidth+1&&!['svg','path','circle','text','line'].includes(n.tagName)).map(n=>({cls:n.className,tag:n.tagName,client:n.clientWidth,scroll:n.scrollWidth}))}));
 results.push({shell,width:320,mode:'long-labels-and-totals',geometry:stress,pass:stress.document<=321&&stress.scroll<=stress.client+1});
 await page.goto(`${base}/${shell}/zenith/Dashboard?showSettings=1`,{waitUntil:'domcontentloaded'});await page.locator('.home-widget-controls').first().waitFor();
 for(const width of [320,768,1024,1440]){
 await page.setViewportSize({width,height:900});await page.waitForTimeout(250);
 // Exercise rendered compact layouts without submitting or changing stored preferences.
 for(const size of ['half','third']){
 await page.locator('.dash-widget').evaluateAll((es,size)=>es.forEach(e=>e.dataset.size=size),size);
 const geometry=await page.locator('.dash-widget').evaluateAll(es=>es.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,client:e.clientWidth,scroll:e.scrollWidth})));
 results.push({shell,width,mode:'customize-'+size,geometry,pass:geometry.every(r=>r.left>=-1&&r.right<=width+1&&r.scroll<=r.client+1)});
 }
 }
 }
 const failures=results.filter(r=>r.mode?!r.pass:r.scroll>r.width+1||r.overflow.length||r.cramped.length||r.popup.left<0||r.popup.right>r.width);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,errors,failures},null,2));
 console.log(JSON.stringify({cases:results.length,failures,errors},null,2));
 await browser.close();
 if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
