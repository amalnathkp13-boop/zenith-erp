const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'../../..');
const xml=fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenith/ZenithApp.xml'),'utf8');
const inline=[...xml.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const css=name=>fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenithstatic/css/'+name),'utf8');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage({viewport:{width:1366,height:768}});let baseline;
  for(const catalog of [false,true]){
   await page.setContent('<style>.show{display:block!important}'+css('subnav-manager.css')+inline+css('product-catalog.css')+'</style><div id="z-sidebar"><div class="zs-brand">ZcERP</div></div><div id="top"><nav class="navbar">Shared toolbar</nav></div><div id="z-subnav" class="show"><div class="zsub-grp show"><span class="zsub-title">POS</span>'+Array.from({length:25},(_,i)=>'<a class="zsub-tab">Submodule '+i+'</a>').join('')+'</div><button class="zsn-trigger">Customize</button></div>'+(catalog?'<div id="productCatalog">Products</div>':''));
   const geometry=await page.evaluate(()=>{const rect=sel=>document.querySelector(sel).getBoundingClientRect().toJSON();return {brand:getComputedStyle(document.querySelector('.zs-brand')).fontSize,top:rect('#top').height,nav:rect('#z-subnav'),button:rect('.zsn-trigger'),group:rect('.zsub-grp')};});
   assert.ok(geometry.button.top>=geometry.nav.top&&geometry.button.bottom<=geometry.nav.bottom,'Customize stays inside the navigation row');
   assert.ok(geometry.button.left>=geometry.group.right-1,'Customize remains beside the scrolling tabs');
   if(!catalog)baseline=geometry;else assert.deepEqual({brand:geometry.brand,top:geometry.top},{brand:baseline.brand,top:baseline.top},'Product Catalog must not restyle the shared header or branding');
  }
  console.log('PASS shared header identity and fixed subnavigation Customize placement');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
