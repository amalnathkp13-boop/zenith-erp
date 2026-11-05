const assert=require('node:assert/strict'),path=require('node:path');
const playwright=require('playwright');

(async()=>{
 const engine=process.env.PRODUCT_QA_BROWSER||'chromium';
 const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 try{
  const page=await browser.newPage();
  const base='http://127.0.0.1:18084/apps/zenith/Inventory';
  let mode='success',posts=[];
  await page.route(base+'/FindProduct',r=>r.fulfill({contentType:'text/html',body:'<form id="CreateProductForm" action="'+base+'/FindProduct/createProduct" data-pe-save="create"><input name="moquiSessionToken" value="QA-CSRF"><input name="productName"><input name="printName"><input name="mrpAmount"><input name="modePricesJson"><label><input data-pe-mode-id="RETAIL"><small data-pe-mode-status></small></label><label><input data-pe-mode-id="WHOLESALE"><small data-pe-mode-status></small></label><p data-pe-status role="status"></p><button>Create Product</button></form>'}));
  await page.route(base+'/EditProduct?*',r=>r.fulfill({contentType:'text/html',body:'<h1>Saved synthetic product</h1>'}));
  await page.route(base+'/FindProduct/createProduct',route=>{
   posts.push({headers:route.request().headers(),body:Object.fromEntries(new URLSearchParams(route.request().postData()))});
   if(mode==='network')return route.abort('connectionfailed');
   if(mode==='error')return route.fulfill({status:500,json:{errors:['Choose a sales mode in your organization.']}});
   if(mode==='validation')return route.fulfill({status:400,json:{validationErrors:[{message:'MRP must contain up to two decimal places.'}]}});
   if(mode==='login')return route.fulfill({status:401,contentType:'text/html',body:'<h1>Sign in</h1>'});
   if(mode==='foreign')return route.fulfill({json:{screenUrl:'https://example.com/EditProduct?productId=QA'}});
   return route.fulfill({json:{screenUrl:base+'/EditProduct?productId=QA-NEW',screenParameters:{productId:'QA-NEW'}}});
  });
  async function open(){
   await page.goto(base+'/FindProduct');
   await page.addScriptTag({path:path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/product-editor.js')});
   const f=page.locator('#CreateProductForm');
   await f.locator('[name=productName]').fill('Synthetic 500ml hing box');
   for(const input of await f.locator('[data-pe-mode-id]').all())await input.fill('4.5');
   return f;
  }
  let form=await open();
  await form.getByRole('button').click();
  await page.waitForURL('**/EditProduct?productId=QA-NEW',{timeout:3000});
  assert.equal(posts.length,1,'confirmed creation navigates without submitting twice');
  assert.equal(posts[0].headers.accept,'application/json');
  assert.equal(posts[0].headers['x-requested-with'],'XMLHttpRequest');
  assert.equal(posts[0].body.mrpAmount,'');
  assert.deepEqual(JSON.parse(posts[0].body.modePricesJson),{RETAIL:'4.5',WHOLESALE:'4.5'});
  for(const [failure,message] of [['error','Choose a sales mode in your organization.'],['validation','MRP must contain up to two decimal places.'],['login',/sign in again/i],['foreign',/could not be saved/i],['network',/Check the product list before retrying/]]){
   mode=failure;posts=[];form=await open();
   await form.getByRole('button').click();
   await form.locator('[data-pe-status][data-error=true]').waitFor();
   const actual=await form.locator('[data-pe-status]').innerText();
   if(typeof message==='string')assert.equal(actual,message);else assert.match(actual,message);
   assert.equal(await form.locator('[name=productName]').inputValue(),'Synthetic 500ml hing box');
   assert.equal(await form.locator('[data-pe-mode-id]').first().inputValue(),'4.5');
   assert.equal(await form.getAttribute('aria-busy'),null);
   assert.equal(posts.length,1,'failed saves never retry writes automatically');
  }
  console.log('PASS '+engine+' product save: structured commit confirmation, decimal mode prices with blank MRP, actionable validation/auth errors, retained entries and no duplicate retry.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
