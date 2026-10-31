// Delayed, failed and empty navigation policy must never flash the full module menu.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{for(const modules of [[],['pos','inventory']]){
  const page=await browser.newPage();await page.route('http://nav.test/**',r=>r.fulfill({contentType:'text/html',body:'<head></head><body><div id="apps-root"></div><div class="q-drawer"><a class="q-item" href="/qapps/zenith/sales/FindInvoice">Sales</a><a class="q-item" href="/qapps/zenith/pos/Dashboard">POS</a></div></body>'}));
  await page.goto('http://nav.test/qapps/zenith/Inventory/FindProduct');
  await page.evaluate(()=>{document.getElementById('apps-root').__vue__={appRootPath:'',navMenuList:[{name:'zenith',subscreens:['sales','pos','inventory','settings','saas-admin'].map(name=>({name}))}],$watch(name,callback){callback(this.navMenuList)},$nextTick(callback){callback()}};window.$={ajax(options){window.policyReply=options.success;window.policyError=options.error;}};});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/saas-menu-filter.js'),'utf8')});
  await page.waitForFunction(()=>typeof window.policyReply==='function');await page.evaluate(()=>window.policyError());await page.waitForTimeout(3500);
  assert.equal(await page.getByText('Sales',{exact:true}).isVisible(),false,'failed config must not reveal modules after 3s');
  await page.evaluate(modules=>window.policyReply({isSaasTenant:true,hasAllAccess:true,navRestricted:true,isAdmin:false,isSuperAdmin:false,modules}),modules);
  assert.equal(await page.getByText('Sales',{exact:true}).isVisible(),false,'all-access plan must retain role restrictions');
  assert.equal(await page.getByText('POS',{exact:true}).isVisible(),modules.includes('pos'));
  const retained=await page.evaluate(()=>document.getElementById('apps-root').__vue__.navMenuList[0].subscreens.map(i=>i.name));
  assert.deepEqual(retained,modules);
  await page.close();
 }
 console.log('PASS navigation stays restricted with delayed/failed config, all-access plans and zero granted modules');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
