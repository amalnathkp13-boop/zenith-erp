// Disposable Moqui/H2 only. Creates synthetic search fixtures; stop runtime to destroy them.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{chromium}=require('playwright');
const base=process.env.POS_QA_BASE||'http://127.0.0.1:18084';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=process.env.POS_QA_OUT||path.resolve('output/search-keyboard');fs.mkdirSync(out,{recursive:true});
const root=process.env.POS_QA_NATIVE_ROOT,java=process.env.POS_QA_JAVA;assert.ok(root&&java,'Set disposable POS runtime and Java paths');
const classes=path.join(out,'db-probe');fs.mkdirSync(classes,{recursive:true});cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'PosDbProbe.java')],{windowsHide:true});
function q(sql){assert.match(sql,/^SELECT /);return JSON.parse(cp.execFileSync(java,['-cp',path.join(root,'WEB-INF/lib/h2-2.4.240.jar')+path.delimiter+classes,'PosDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,POS_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));}
const results=[];function check(name,ok,evidence){console.log((ok?'PASS ':'FAIL ')+name);results.push({name,passed:!!ok,...(!ok?{evidence}: {})});}
(async()=>{
 for(let i=0;;i++){try{if((await fetch(base+'/Login')).status<500)break;}catch{}if(i>90)throw Error('Disposable runtime unavailable');await new Promise(r=>setTimeout(r,1000));}
 const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 let sessionId;
 try{
  const bootstrap=await browser.newContext();await bootstrap.request.get(base+'/apps/zenith/Contacts/Customers',{headers:{Authorization:'Basic '+Buffer.from('john.doe:moqui').toString('base64')}});
  const bp=await bootstrap.newPage();await bp.goto(base+'/apps/zenith/Contacts/Customers');const bt=await bp.locator('[name=moquiSessionToken]').first().inputValue();
  if(process.env.POS_QA_SKIP_INITIALIZE!=='true'){const init=await bootstrap.request.post(base+'/apps/zenith/pos/PosQaAcceptance/initialize',{form:{moquiSessionToken:bt}});assert.equal((await init.json()).initialized,true);}await bootstrap.close();
  const context=await browser.newContext({viewport:{width:1366,height:768},serviceWorkers:'block'});
  await context.route('**/qz-tray@*/qz-tray.js',route=>route.fulfill({contentType:'text/javascript',body:'/* no hardware */'}));
  await context.request.get(base+'/apps/zenith/pos/Terminal',{headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>console.error('Browser error:',e.message));await page.goto(base+'/apps/zenith/pos/Terminal');const token=await page.locator('[name=moquiSessionToken]').first().inputValue();
  async function post(screen,transition,params={},shell='apps'){return context.request.post(`${base}/${shell}/zenith/pos/${screen}/${transition}`,{form:{moquiSessionToken:token,...params},maxRedirects:0});}
  async function invoke(op,params={}){const r=await post('PosQaAcceptance','invoke',{op,...params});const b=await r.json();assert.ok(!b.errors?.length,JSON.stringify(b));return b.result||{};}
  assert.equal((await (await post('PosQaAcceptance','seedSearch')).json()).seeded,true);
  sessionId=(await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'})).sessionId;
  const snapshot=()=>JSON.stringify([q("SELECT transaction_id,status_id,payable_amount FROM pos_transaction ORDER BY transaction_id"),q("SELECT payment_id,amount FROM pos_payment ORDER BY payment_id"),q("SELECT product_id,mrp_amount FROM product ORDER BY product_id")]);const before=snapshot();
  for(const shell of ['apps','qapps']){
   const lookup=async term=>{const r=await post('Terminal','lookupProducts',{term},shell);assert.equal(r.status(),200);return r.json();};
   const grid=async(searchTerm,productOffset='0')=>{const r=await post('Terminal','productGrid',{sessionId,salesModeId:'RETAIL',searchTerm,productOffset},shell);const b=await r.json();assert.ok(b.success,JSON.stringify(b));return b;};
   const pp=await lookup('pp ');check(shell+' PP plus space returns a full 60-result page of PP products',pp.length===60&&pp.every(x=>x.productName.toLowerCase().startsWith('pp ')),pp.map(x=>x.productName));
   const short=await lookup('pp');check(shell+' PP name prefixes rank before Appalam infix matches',short.length===60&&short.every(x=>x.productName.toLowerCase().startsWith('pp ')));
   const size=await lookup('pp 05');check(shell+' specific PP size filters correctly',size.length===1&&size[0].productName==='PP 05-size',size);
   const spaced=await lookup(' PP   05');check(shell+' repeated and leading spaces normalize without losing the separator',spaced.length===1&&spaced[0].productName==='PP 05-size',spaced);
   const pct=await lookup('PP 100%');check(shell+' percent is literal',pct.length===1&&pct[0].productName==='PP 100% special',pct);
   const underscore=await lookup('PP 100_');check(shell+' underscore is literal',underscore.length===1&&underscore[0].productName==='PP 100_ special',underscore);
   const code=await lookup('SYN_SEARCH_4');check(shell+' exact item code remains searchable',code.some(x=>x.productId==='POS_QA_SEARCH_4'),code);
   check(shell+' blank lookup is empty',(await lookup(' ')).length===0);
   check(shell+' foreign product stays excluded',!pp.some(x=>x.productId==='POS_QA_SEARCH_FOREIGN'));
   const first=await grid('pp '),second=await grid('pp ','60');
   check(shell+' grid page preserves the space and offers remaining sizes',first.products.length===60&&first.hasMore&&second.products.length===7&&!second.hasMore,{first:first.products.length,second:second.products.length});
   check(shell+' pagination has no skipped or repeated PP products',new Set([...first.products,...second.products].map(x=>x.productId)).size===67&&[...first.products,...second.products].every(x=>x.name.startsWith('PP ')));
   const hist=await (await post('Terminal','ajaxCart',{action:'searchProductsJson',sessionId,q:'pp '},shell)).json();
   check(shell+' history editor uses the same whitespace-aware ranked search',hist.success&&hist.products.length===60&&hist.products.every(x=>x.name.startsWith('PP ')),hist);
  }
  check('search requests leave saved bills, tenders and product prices unchanged',snapshot()===before);
  if(process.env.POS_SEARCH_BASELINE!=='true'){
   // Full qapps SPA currently stalls with pre-change JS too; APIs above cover its server surface.
   for(const shell of ['apps']){
    await page.goto(`${base}/${shell}/zenith/pos/Terminal?sessionId=${sessionId}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window._posAjax==='function',undefined,{timeout:15000});
    await page.evaluate(()=>{if(document.body.classList.contains('pos-mode-normal'))window.posToggleLayout();});
    const input=page.locator('#cartInlineSearch');await input.fill('pp ');
    await page.waitForFunction(()=>document.querySelectorAll('.cart-dd-item').length===60,undefined,{timeout:15000});
    check(shell+' browser lookup lists the PP group',await page.locator('.dd-name').allTextContents().then(x=>x.every(n=>n.startsWith('PP '))));
    await input.fill('');check(shell+' clearing immediately hides dropdown',!(await page.locator('#cartSearchDropdown').isVisible()));
    await input.fill('pp 05');const added=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');await page.locator('.cart-dd-item').filter({hasText:'PP 05-size'}).click();
    await page.waitForFunction(()=>!!document.querySelector('.aj-p'),undefined,{timeout:15000});
    const rate=page.locator('.aj-p').last(),qty=page.locator('.aj-qi').last();
    check(shell+' quantity exposes caret positions',await qty.getAttribute('type')==='text');
    await qty.focus();await qty.evaluate(e=>e.setSelectionRange(0,0));await page.keyboard.press('ArrowLeft');
    check(shell+' quantity left boundary focuses rate',await rate.evaluate(e=>e===document.activeElement&&e.selectionStart===e.value.length));
    const updated=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='updateQty'&&new URLSearchParams(r.request().postData()||'').get('newQty')==='2.5');
    await rate.fill('15');await page.keyboard.press('End');await page.keyboard.press('ArrowRight');
    check(shell+' rate right boundary focuses quantity',await qty.evaluate(e=>e===document.activeElement&&e.selectionStart===0));
    await qty.fill('2.5');await page.keyboard.press('Enter');
    check(shell+' Enter from quantity restores search',await input.evaluate(e=>e===document.activeElement));
    const saved=await updated;assert.ok((await saved.json()).success);await added;
    await page.waitForTimeout(100);
    const current=await invoke('cart',{sessionId,reuseOpenCart:'Y'});
    const tx=await (await post('Terminal','ajaxCart',{sessionId,transactionId:current.transactionId})).json();
    check(shell+' numeric edits persist and compute the decimal line total',tx.success&&tx.items.some(x=>Number(x.price)===15&&Number(x.qty)===2.5),tx);
    await page.screenshot({path:path.join(out,shell+'-search-keyboard.png')});
    const cartId=tx.transactionId;assert.match(cartId,/^[A-Za-z0-9_-]+$/);
    check(shell+' independent DB confirms rate, decimal quantity and line total',q(`SELECT unit_price,quantity,line_total FROM pos_transaction_item WHERE transaction_id='${cartId}'`).some(x=>Number(x.unit_price)===15&&Number(x.quantity)===2.5&&Number(x.line_total)===37.5));await invoke('void',{transactionId:cartId});
   }
  }
  await invoke('close',{sessionId,closingCash:'0'});await context.close();
 }finally{await browser.close();fs.writeFileSync(path.join(out,'search-runtime.json'),JSON.stringify(results,null,2));}
 console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
