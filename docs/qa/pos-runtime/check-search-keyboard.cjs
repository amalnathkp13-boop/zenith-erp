// Browser regression using the production search and cart keyboard handlers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(process.env.POS_SEARCH_SOURCE||path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js'),'utf8');
const search=source.slice(source.indexOf('/* === Cart Inline Search === */'),source.indexOf('/* === Horizontal Resize Splitter'));
const keys=source.slice(source.indexOf("cart.addEventListener('keydown', function(e)"),source.indexOf('// Typeable quantity'));
const results=[];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function test(name,run){const page=await browser.newPage();try{
  await page.setContent(`<div class="pos-product-grid"><form action="Terminal/addItem" data-search-code="SYN-MANGO">
   <input type="hidden" name="productId" value="MANGO01"><input type="hidden" name="unitPrice" value="25"><input type="hidden" name="salesModeId" value="RETAIL">
   <button type="submit"><div title="Mango Juice">Mango Juice</div><div>₹25</div><div class="pos-card-stock" data-product-id="MANGO01">Stock: 30</div></button>
  </form><form action="Terminal/addItem" data-search-code="SYN-BAG" data-price-pending="true">
   <input type="hidden" name="productId" value="BAG01"><input type="hidden" name="unitPrice" value="0"><input type="hidden" name="salesModeId" value="RETAIL">
   <button type="submit"><div title="Paper Bag">Paper Bag</div><div>₹0 · Enter price</div></button>
  </form></div><div class="pos-cart"><table><tr><td><input class="aj-p" value="150" data-seq="01"></td><td><input class="aj-qi" value="12" data-seq="01"></td></tr></table></div><input id="cartInlineSearch"><div id="cartSearchDropdown" style="display:none"></div><form id="cartInlineAddForm"><input name="posOrganizationPartyId" value="SHOP_A"><input name="posTerminalId" value="TILL_A"><input name="sessionId" value="SESSION_A"><input name="salesModeId" value="RETAIL"><input name="moquiSessionToken" value="synthetic"></form>`);
  await page.evaluate(()=>{window.pending=[];window.grid=[];window.adds=[];window.scans=[];window._gridSearch=q=>window.grid.push(q);window._posAjax=(...args)=>window.adds.push(args);window._posScan=code=>window.scans.push(code);window.fetch=(url,options)=>new Promise(resolve=>pending.push({term:new URLSearchParams(options.body).get('term'),resolve:data=>resolve({ok:true,json:()=>Promise.resolve(data)})}));});
  await page.addScriptTag({content:search});
  await page.addScriptTag({content:"var cart=document.querySelector('.pos-cart');function commitLineInput(){return true;}"+keys});
  await run(page);results.push({name,passed:true});
 }catch(e){results.push({name,passed:false,error:e.message});}finally{await page.close();}}
 const product=[{productId:'SYN_PP5',productName:'PP 5-size',pseudoId:'SYN-5',mrpAmount:10}];
 const request=p=>p.waitForFunction(()=>pending.length>0);
 const reply=(p,n=0)=>p.evaluate(({product,n})=>pending[n].resolve(product),{product,n});
 const shown=p=>p.locator('#cartSearchDropdown').isVisible();
 await test('a rendered product appears on the first keystroke before lookup replies',async p=>{
  const field=p.locator('#cartInlineSearch'), row=p.locator('.cart-dd-item');
  for(const query of ['m','SYN-MANGO']){
   await field.fill(query);
   assert.deepEqual(await row.evaluateAll(rows=>rows.map(r=>[r.dataset.pid,r.dataset.name,Number(r.dataset.price)])),[['MANGO01','Mango Juice',25]]);
  }
 });
 await test('a local match needing a manual rate retains its price prompt',async p=>{
  await p.locator('#cartInlineSearch').fill('paper');
  assert.deepEqual(await p.locator('.cart-dd-item .dd-price').allTextContents(),['₹0 · Enter price']);
 });
 await test('a lookup reply between mouse down and up preserves the selected product',async p=>{
  await p.locator('#cartInlineSearch').fill('mango');await request(p);
  await p.locator('.cart-dd-item[data-pid="MANGO01"]').hover();await p.mouse.down();
  await p.evaluate(()=>pending[0].resolve([{productId:'OTHER',productName:'Mango Jam',mrpAmount:15},{productId:'MANGO01',productName:'Mango Juice',mrpAmount:26}]));
  await p.evaluate(()=>new Promise(requestAnimationFrame));await p.mouse.up();
  assert.deepEqual(await p.evaluate(()=>adds.map(([id])=>id)),['MANGO01']);
 });
 await test('fast keyboard selection adds the visible item while an unselected barcode still scans',async p=>{
  const field=p.locator('#cartInlineSearch');
  await field.pressSequentially('Mango');await field.press('ArrowDown');await field.press('Enter');
  await field.pressSequentially('MANGO');await field.press('Enter');
  await field.pressSequentially('8900000000007');await field.press('Enter');
  assert.deepEqual(await p.evaluate(()=>adds.map(([id])=>id)),['MANGO01']);
  assert.deepEqual(await p.evaluate(()=>scans),['MANGO','8900000000007']);
 });
 for(const [change,formKey] of [['sales mode','salesModeId'],['shop','posOrganizationPartyId'],['terminal','posTerminalId'],['session','sessionId'],['catalog revision',null]]) await test('repeat lookup is immediate until a '+change+' change',async p=>{
  const field=p.locator('#cartInlineSearch'), rows=p.locator('.cart-dd-item');
  await field.fill('pp');await request(p);await reply(p);await rows.first().waitFor();
  await field.fill('');await field.fill('pp');
  assert.deepEqual(await rows.evaluateAll(items=>items.map(item=>item.dataset.pid)),['SYN_PP5']);
  if(formKey){
   await field.fill('');
   await p.locator('#cartInlineAddForm [name='+formKey+']').evaluate(el=>{el.value+='-changed';});
   await field.fill('pp');
  }else{
   await field.evaluate(el=>el.dispatchEvent(new CustomEvent('input',{detail:{catalogRefresh:true}})));
  }
  assert.equal(await rows.count(),0,'the old price must disappear before the new lookup replies');
  await p.waitForFunction(()=>pending.length>=2);
  await p.evaluate(()=>pending.at(-1).resolve([{productId:'SYN_PP5',productName:'PP 5-size',mrpAmount:8}]));
  await p.waitForFunction(()=>document.querySelector('.cart-dd-item')?.dataset.price==='8');
  if(['posOrganizationPartyId','posTerminalId','sessionId'].includes(formKey)){
   await p.evaluate(()=>{window._posOffline={active:()=>false,searchSuggestions:()=>[{productId:'OLD',productName:'Mango Juice',pseudoId:'OLD',mrpAmount:40}]};});
   await field.fill('mango');
   assert.equal(await rows.count(),0,'previous terminal tiles and device catalog must be excluded');
  }
 });
 await test('a delayed previous catalog reply cannot overwrite the new price on a repeat search',async p=>{
  const field=p.locator('#cartInlineSearch');
  await field.fill('pp');await request(p);
  await field.evaluate(el=>el.dispatchEvent(new CustomEvent('input',{detail:{catalogRefresh:true}})));
  await p.waitForFunction(()=>pending.length===2);
  await p.evaluate(()=>pending[1].resolve([{productId:'SYN_PP5',productName:'PP 5-size',mrpAmount:8}]));
  await p.waitForFunction(()=>document.querySelector('.cart-dd-item')?.dataset.price==='8');
  await reply(p);
  await field.fill('');await field.fill('pp');
  assert.deepEqual(await p.locator('.cart-dd-item').evaluateAll(items=>items.map(item=>Number(item.dataset.price))),[8]);
 });
 await test('query preserves trailing space',async p=>{await p.locator('#cartInlineSearch').fill('pp ');await request(p);assert.equal(await p.evaluate(()=>pending[0].term),'pp ');await p.waitForTimeout(650);assert.equal(await p.evaluate(()=>grid.at(-1)),'pp ');});
 await test('clear rejects delayed response and resets grid immediately',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.waitForFunction(()=>grid.includes('pp'));await p.locator('#cartInlineSearch').fill('');await reply(p);await p.waitForTimeout(50);assert.equal(await shown(p),false);assert.equal(await p.evaluate(()=>grid.at(-1)),'');});
 await test('new input invalidates displayed matches before debounce',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await reply(p);await p.waitForFunction(()=>document.querySelector('.cart-dd-item'));await p.locator('#cartInlineSearch').fill('tea');assert.equal(await shown(p),false);assert.equal(await p.locator('.cart-dd-item').count(),0);});
 await test('older reply cannot replace newer query',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.locator('#cartInlineSearch').fill('tea');await p.waitForFunction(()=>pending.length===2);await p.evaluate(()=>pending[1].resolve([{productId:'SYN_TEA',productName:'Tea Cup',mrpAmount:20}]));await reply(p);await p.waitForTimeout(50);assert.equal(await p.locator('.dd-name').textContent(),'Tea Cup');});
 await test('selection cancels pending lookup and grid timers',async p=>{
  await p.locator('#cartInlineSearch').fill('pp');await request(p);await reply(p);
  await p.locator('.cart-dd-item').click();
  const afterClick=await p.evaluate(()=>grid.slice());
  await p.waitForTimeout(700);
  assert.equal(await shown(p),false);
  assert.equal(await p.evaluate(()=>adds.length),1);
  assert.deepEqual(await p.evaluate(()=>grid),afterClick);
  assert(afterClick.length===0||afterClick.at(-1)==='');
 });
 await test('Escape rejects delayed lookup',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.locator('#cartInlineSearch').press('Escape');await reply(p);await p.waitForTimeout(50);assert.equal(await shown(p),false);});
 await test('search arrows keep the highlighted result visible and Enter selects it',async p=>{
  await p.locator('#cartSearchDropdown').evaluate(e=>{e.style.maxHeight='100px';e.style.overflowY='auto';});
  await p.locator('#cartInlineSearch').fill('qa');await request(p);
  await p.evaluate(()=>pending[0].resolve(Array.from({length:20},(_,i)=>({productId:'SYN_'+i,productName:'QA product '+i,pseudoId:'QA-'+i,mrpAmount:10}))));
  await p.locator('.cart-dd-item').first().waitFor();
  for(let i=0;i<13;i++)await p.locator('#cartInlineSearch').press('ArrowDown');
  const selected=await p.locator('#cartSearchDropdown').evaluate(e=>{const item=e.children[12],list=e.getBoundingClientRect(),row=item.getBoundingClientRect();return {scroll:e.scrollTop,visible:row.top>=list.top&&row.bottom<=list.bottom,focused:document.activeElement.id==='cartInlineSearch',color:item.style.background};});
  assert(selected.scroll>0&&selected.visible&&selected.focused&&selected.color==='rgb(232, 245, 233)',JSON.stringify(selected));
  for(let i=0;i<12;i++)await p.locator('#cartInlineSearch').press('ArrowUp');
  const first=await p.locator('#cartSearchDropdown').evaluate(e=>{const list=e.getBoundingClientRect(),row=e.firstElementChild.getBoundingClientRect();return {scroll:e.scrollTop,visible:row.top>=list.top&&row.bottom<=list.bottom};});
  assert(first.scroll<selected.scroll&&first.visible,JSON.stringify(first));
  await p.locator('#cartInlineSearch').press('Enter');
  assert.equal(await p.evaluate(()=>adds[0][0]),'SYN_0');
 });
 await test('Up from empty search selects the first bill quantity',async p=>{
  await p.locator('#cartInlineSearch').press('ArrowUp');
  assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-qi');
  assert.equal(await p.locator('.aj-qi').evaluate(e=>e.selectionEnd),2);
 });
 await test('quantity Left at start moves to rate end',async p=>{await p.locator('.aj-qi').focus();await p.locator('.aj-qi').evaluate(e=>e.setSelectionRange(0,0));await p.keyboard.press('ArrowLeft');assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-p');assert.equal(await p.locator('.aj-p').evaluate(e=>e.selectionStart),3);});
 await test('rate Right at end moves to quantity start',async p=>{await p.locator('.aj-p').focus();await p.locator('.aj-p').evaluate(e=>e.setSelectionRange(3,3));await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-qi');assert.equal(await p.locator('.aj-qi').evaluate(e=>e.selectionStart),0);});
 await test('arrows within numbers and selected text retain native behavior',async p=>{await p.locator('.aj-qi').focus();await p.locator('.aj-qi').evaluate(e=>e.setSelectionRange(1,1));await p.keyboard.press('ArrowLeft');assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-qi');assert.equal(await p.locator('.aj-qi').evaluate(e=>e.selectionStart),0);await p.locator('.aj-p').focus();await p.locator('.aj-p').evaluate(e=>e.select());await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-p');});
 await test('Enter rate to quantity to search remains intact',async p=>{await p.locator('.aj-p').press('Enter');assert.equal(await p.evaluate(()=>document.activeElement.className),'aj-qi');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>document.activeElement.id),'cartInlineSearch');});
 for(const editor of ['history','cart-editor']) await test(editor+' preserves spaces and rejects cleared responses',async p=>{
  const cartEditor=editor==='cart-editor';
  await p.setContent(cartEditor?'<input id="ced-add"><div id="ced-add-res"></div>':'<input id="hist-add-search"><div id="hist-add-results"></div>');
  await p.evaluate(()=>{window.lookups=[];window.historyPost=({q})=>new Promise(resolve=>lookups.push({q,resolve}));window.ed=document;window.listEl=document;});
  const start=source.indexOf(cartEditor?"            var addInp = ed.querySelector('#ced-add')":'            var addTimer = null');
  const end=source.indexOf('                }, 300);',start)+'                }, 300);'.length;
  await p.addScriptTag({content:(cartEditor?'':"var addSearch=document.getElementById('hist-add-search'),addResults=document.getElementById('hist-add-results');")+source.slice(start,end)+'\n});'});
  const field=p.locator(cartEditor?'#ced-add':'#hist-add-search');
  await field.fill('pp ');await p.waitForFunction(()=>lookups.length===1,undefined,{timeout:3000});assert.equal(await p.evaluate(()=>lookups[0].q),'pp ');
  await field.fill('');await p.evaluate(()=>lookups[0].resolve({success:true,products:[{pid:'SYN_PP',name:'PP 5-size',price:10}]}));await p.waitForTimeout(20);
  assert.equal(await p.locator(cartEditor?'#ced-add-res':'#hist-add-results').isVisible(),false);
 });
 await browser.close();console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
