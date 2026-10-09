// Local, read-only live-resize checks. No business records or preferences are submitted.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const base=process.env.RESPONSIVE_BASE_URL||'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local runtime required');
const out=process.env.RESPONSIVE_OUTPUT||'tmp/responsiveness/inventory-live-resize';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 const page=await context.newPage(),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/Login');
 await page.locator('#login_form_organizationId').fill(process.env.RESPONSIVE_ORGANIZATION||'LOCALERP');
 await page.locator('#login_form_username').fill(process.env.SMOKE_USER);
 await page.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS);
 await page.locator('#login_form [type=submit]').click();
 await page.waitForURL('**/zenith/**');
 for(const shell of ['apps','qapps']){
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/${shell}/zenith/Inventory/InventoryDashboard`);
  await page.locator('#inventoryOverviewChart svg').waitFor();
  await page.waitForTimeout(300);
  const deferred=await page.locator('.inv-additional .apexcharts-canvas').count();
  results.push({shell,check:'Hidden charts deferred',pass:deferred===0,count:deferred});
  for(const expanded of [false,true]){
   if(expanded){await page.locator('.inv-additional>summary').click();await page.locator('#invPriceChart').scrollIntoViewIfNeeded();await page.locator('#invPriceChart svg').waitFor();}
   for(const width of [1440,1300,1280,1200,1024,901,900,820,768,600,421,420,390,360,320,390,600,900,1024,1280,1440,1920,2560,1440]){
    await page.setViewportSize({width,height:900});
    // Wait on the actual chart geometry; no fixed settling delay can conceal a late resize.
    const fit=await page.evaluate(()=>new Promise(resolve=>{
     const started=performance.now();
     function sample(){
      const charts=[...document.querySelectorAll('[data-inventory-chart]')].filter(e=>e.checkVisibility());
      const fitted=charts.length>0&&charts.every(e=>{const svg=e.querySelector('.apexcharts-svg');return svg&&Math.abs(svg.getBoundingClientRect().width-e.clientWidth)<=2;});
      if(fitted||performance.now()-started>500)resolve({fitted,ms:Math.round(performance.now()-started)});
      else requestAnimationFrame(sample);
     }sample();
    }));
    const layout=await page.evaluate(()=>{
     const visible=e=>e&&e.checkVisibility()&&e.getBoundingClientRect().width>0;
     const toolbar=[...document.querySelectorAll('.q-toolbar>button:first-child,#zq-ownerview,#zq-search,.q-toolbar>button.text-positive,#zq-toolbtns')].filter(visible);
     const overlaps=[];
     for(let i=0;i<toolbar.length;i++)for(let j=i+1;j<toolbar.length;j++){
      const a=toolbar[i].getBoundingClientRect(),b=toolbar[j].getBoundingClientRect();
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([toolbar[i].id||toolbar[i].tagName,toolbar[j].id||toolbar[j].tagName]);
     }
     const outside=toolbar.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}).map(e=>e.id||e.tagName);
     const header=document.querySelector('.q-header'),nav=document.querySelector('#zq-subnav');
     const navClear=!visible(header)||!visible(nav)||nav.getBoundingClientRect().top>=header.getBoundingClientRect().bottom-1;
     const content=document.querySelector('.inv-dashboard').getBoundingClientRect();
     const contentClear=!visible(nav)||content.top+scrollY>=nav.getBoundingClientRect().bottom-1;
     return{overlaps,outside,navClear,contentClear,scroll:document.documentElement.scrollWidth};
    });
    results.push({shell,check:'Live resize',expanded,width,...fit,...layout,pass:fit.fitted&&fit.ms<=200&&!layout.overlaps.length&&!layout.outside.length&&layout.navClear&&layout.contentClear&&layout.scroll<=width+1});
    if(!expanded&&[390,1024,1440].includes(width))await page.screenshot({path:path.join(out,`${shell}-dashboard-${width}.png`),fullPage:true});
   }
   console.log(shell,expanded?'expanded':'collapsed','resize sweep complete');
  }
  // Native controls still work after the rapid resize sequence.
  await page.locator('.inv-date>summary').click();
  results.push({shell,check:'Date controls after resizing',pass:await page.locator('.inv-date input[name=dashDate]').isVisible()});
 }
 const failures=results.filter(r=>!r.pass);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,failures,errors},null,2));
 console.log(JSON.stringify({cases:results.length,maxChartFitMs:Math.max(...results.filter(r=>r.ms!=null).map(r=>r.ms)),failures,errors}));
 await browser.close();if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
