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
  await page.setContent('<div class="pos-cart"><table><tr><td><input class="aj-p" value="150" data-seq="01"></td><td><input class="aj-qi" value="12" data-seq="01"></td></tr></table></div><input id="cartInlineSearch"><div id="cartSearchDropdown" style="display:none"></div><form id="cartInlineAddForm"><input name="moquiSessionToken" value="synthetic"></form>');
  await page.evaluate(()=>{window.pending=[];window.grid=[];window.adds=[];window._gridSearch=q=>window.grid.push(q);window._posAjax=(...args)=>window.adds.push(args);window.fetch=(url,options)=>new Promise(resolve=>pending.push({term:new URLSearchParams(options.body).get('term'),resolve:data=>resolve({ok:true,json:()=>Promise.resolve(data)})}));});
  await page.addScriptTag({content:search});
  await page.addScriptTag({content:"var cart=document.querySelector('.pos-cart');function commitLineInput(){return true;}"+keys});
  await run(page);results.push({name,passed:true});
 }catch(e){results.push({name,passed:false,error:e.message});}finally{await page.close();}}
 const product=[{productId:'SYN_PP5',productName:'PP 5-size',pseudoId:'SYN-5',mrpAmount:10}];
 const request=p=>p.waitForFunction(()=>pending.length>0);
 const reply=(p,n=0)=>p.evaluate(({product,n})=>pending[n].resolve(product),{product,n});
 const shown=p=>p.locator('#cartSearchDropdown').isVisible();
 await test('query preserves trailing space',async p=>{await p.locator('#cartInlineSearch').fill('pp ');await request(p);assert.equal(await p.evaluate(()=>pending[0].term),'pp ');await p.waitForTimeout(650);assert.equal(await p.evaluate(()=>grid.at(-1)),'pp ');});
 await test('clear rejects delayed response and resets grid immediately',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.locator('#cartInlineSearch').fill('');await reply(p);await p.waitForTimeout(50);assert.equal(await shown(p),false);assert.equal(await p.evaluate(()=>grid.at(-1)),'');});
 await test('new input invalidates displayed matches before debounce',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await reply(p);await p.waitForFunction(()=>document.querySelector('.cart-dd-item'));await p.locator('#cartInlineSearch').fill('tea');assert.equal(await shown(p),false);assert.equal(await p.locator('.cart-dd-item').count(),0);});
 await test('older reply cannot replace newer query',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.locator('#cartInlineSearch').fill('tea');await p.waitForFunction(()=>pending.length===2);await p.evaluate(()=>pending[1].resolve([{productId:'SYN_TEA',productName:'Tea Cup',mrpAmount:20}]));await reply(p);await p.waitForTimeout(50);assert.equal(await p.locator('.dd-name').textContent(),'Tea Cup');});
 await test('selection cancels pending lookup and grid timers',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await reply(p);await p.locator('.cart-dd-item').click();await p.waitForTimeout(700);assert.equal(await shown(p),false);assert.equal(await p.evaluate(()=>adds.length),1);assert.deepEqual(await p.evaluate(()=>grid),['']);});
 await test('Escape rejects delayed lookup',async p=>{await p.locator('#cartInlineSearch').fill('pp');await request(p);await p.locator('#cartInlineSearch').press('Escape');await reply(p);await p.waitForTimeout(50);assert.equal(await shown(p),false);});
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
