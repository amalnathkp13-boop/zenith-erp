const path = require('node:path');
module.exports = async function({a, base, check, q, invoke, post, out, terminalId='POS_QA_A_NEXT_BILL'}) {
 await post('PosTerminals', 'createTerminal', {terminalId, terminalName:'Disposable next-bill counter', facilityId:'POS_QA_A_FAC', organizationPartyId:'POS_QA_A', regionGeoId:'33', stateCode:'33', countryGeoId:'IND', isActive:'Y'});
 const session = await invoke('open', {terminalId, openingCash:'0'});
 // Earlier acceptance cases exercise offline storage. Keep this network-race test
 // in its own authenticated context so cached responses cannot bypass its routes.
 const context=await a.c.browser().newContext({storageState:{cookies:await a.c.cookies(),origins:[]},serviceWorkers:'block',viewport:{width:1672,height:941}});
 const page = await context.newPage(); page.setDefaultTimeout(30000);
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 page.on('dialog', async d => {errors.push(d.message());await d.dismiss();});
 // Exercise receipt generation without a physical printer or external QZ service.
 await page.route('**/qz-tray.js', route => route.fulfill({contentType:'application/javascript', body:`window.qz={websocket:{isActive:()=>true},configs:{create:()=>({})},print:(_,data)=>{window.qaReceipts.push(data[0].data);return Promise.resolve()}};`}));
 await page.addInitScript(() => { window.qaReceipts=[]; localStorage.setItem('posPrinter','Disposable QA printer'); });
 try {
  for (const taxOn of ['N','Y']) for (const method of ['Card','UPI','Cash','Split']) {
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&taxOn=${taxOn}`);
   if (method === 'UPI') await page.evaluate(() => { if (!document.body.classList.contains('pos-mode-advanced')) window.posToggleLayout(); });
   const tile = pid => page.locator(`.pos-product-grid form:has(input[name=productId][value=${pid}]) button`);
   const actionReply = action => page.waitForResponse(r => r.request().method()==='POST' && r.url().includes('/ajaxCart') && new URLSearchParams(r.request().postData()||'').get('action')===action);
   let reply=actionReply('addItem'); await tile('POS_QA_A_P18').click();const added=await (await reply).json();check(method+' tax '+taxOn+' first item accepted',added.success,added.error);
   await page.waitForFunction(() => document.querySelector('.pos-cart .aj-qi')?.value==='1');
   const oldId=await page.locator('#cartInlineAddForm [name=transactionId]').inputValue();
   const amount=Number(q(`SELECT payable_amount FROM pos_transaction WHERE transaction_id='${oldId}'`)[0].payable_amount);
   let releaseScreen, screenReady;
   const screenHeld=new Promise(r=>releaseScreen=r), screenSent=new Promise(r=>screenReady=r);
   const delayScreen=async route=>{const response=await route.fetch();screenReady();await screenHeld;await route.fulfill({response});};
   await page.route('**/Terminal.qvt?*',delayScreen);
   const paid=page.waitForResponse(r => r.request().method()==='POST' && /\/(payAndComplete|splitPayAndComplete)$/.test(new URL(r.url()).pathname));
   if (method==='Cash') {
    await page.locator('#pos-pay-cash').click(); await page.locator('.pos-cash-input').fill(String(amount)); await page.locator('.pos-cash-confirm').click();
   } else if (method==='Split') {
    await page.locator('#pos-split').click(); await page.locator('.pos-split-panel [name=cashAmount]').fill(String(amount/2)); await page.locator('.pos-split-panel [name=cardAmount]').fill(String(amount/2)); await page.locator('.pos-split-panel button[type=submit]').click();
   } else {
    await page.locator('#pos-pay-'+method.toLowerCase()).click(); await page.locator('#posPayConfOk').click();
   }
   const payment=await (await paid).json(); check(method+' tax '+taxOn+' checkout succeeds',payment.success,payment.error);
   let screenTimer;
   try { await Promise.race([screenSent,new Promise((_,reject)=>{screenTimer=setTimeout(()=>reject(Error('Checkout screen request did not start: '+errors.join('; '))),30000);})]); }
   finally {clearTimeout(screenTimer);}
   await page.waitForFunction(() => !document.querySelector('.pos-cart .aj-qi') && !document.querySelector('#cartInlineAddForm [name=transactionId]')?.value);
   await page.waitForFunction(() => window.qaReceipts.length===1);
   check(method+' tax '+taxOn+' receipt contains the completed product',await page.evaluate(()=>window.qaReceipts[0].includes('Disposable POS A P18')));
   let release, started; const held=new Promise(r=>release=r), sent=new Promise(r=>started=r);
   const delay=async route=>{if(new URLSearchParams(route.request().postData()||'').get('action')==='addItem'){started();await held;}await route.continue();};
   await page.route('**/Terminal/ajaxCart',delay);
   await page.evaluate(()=>{window.qaOldCartFrames=[];window.qaWatchCart=true;function frame(){if(!window.qaWatchCart)return;if(document.querySelector('.pos-cart tbody')?.textContent.includes('Disposable POS A P18'))window.qaOldCartFrames.push(performance.now());requestAnimationFrame(frame);}requestAnimationFrame(frame);});
   reply=actionReply('addItem'); await tile('POS_QA_A_P5').click(); await sent;
   await page.waitForTimeout(500);
   const pending=await page.locator('.pos-cart tbody').innerText();
   const flashes=await page.evaluate(()=>{window.qaWatchCart=false;return window.qaOldCartFrames.length;});
   const quantityReply=actionReply('updateQty');
   await page.locator('.pos-cart tbody tr:has-text("Disposable POS A P5") .aj-q').last().click();
   release(); await reply; await page.unroute('**/Terminal/ajaxCart',delay);
   await quantityReply;
   check(method+' tax '+taxOn+' first tap never displays the previous bill while response is delayed',flashes===0&&!pending.includes('Disposable POS A P18')&&pending.includes('Disposable POS A P5'),{flashes,pending});
   const newId=await page.locator('#cartInlineAddForm [name=transactionId]').inputValue();
   const newLines=q(`SELECT product_id,quantity FROM pos_transaction_item WHERE transaction_id='${newId}'`);
   check(method+' tax '+taxOn+' next bill persists its own item and queued quantity edit',newId!==oldId&&newLines.length===1&&newLines[0].product_id==='POS_QA_A_P5'&&Number(newLines[0].quantity)===2,{newId,newLines});
   check(method+' tax '+taxOn+' issued bill remains unchanged',q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${oldId}'`)[0].status_id==='PtCompleted'&&q(`SELECT product_id FROM pos_transaction_item WHERE transaction_id='${oldId}'`).length===1);
   const screenReply=page.waitForResponse(r=>r.url().includes('/Terminal.qvt?'));
   releaseScreen();await screenReply;await page.unroute('**/Terminal.qvt?*',delayScreen);
   await page.waitForTimeout(200);
   check(method+' tax '+taxOn+' late checkout screen cannot erase the next cart',await page.locator('#cartInlineAddForm [name=transactionId]').inputValue()===newId&&(await page.locator('.pos-cart tbody').innerText()).includes('Disposable POS A P5'));
   await page.screenshot({path:path.join(out,`next-bill-${method}-${taxOn}.png`)});
   reply=actionReply('clearCart'); await page.evaluate(()=>window._posClearCart()); await reply;
  }
  check('next-bill checkout produces no JavaScript exceptions',errors.length===0,{errors});
  await invoke('close',{sessionId:session.sessionId,closingCash:'0'});
 } catch(error) { console.log('Next-bill diagnostics',await page.evaluate(()=>({receipts:window.qaReceipts?.length,frame:!!document.getElementById('pos-receipt-frame'),cart:document.querySelector('.pos-cart tbody')?.textContent,printer:localStorage.getItem('posPrinter')})),errors);await page.screenshot({path:path.join(out,'next-bill-failure.png'),fullPage:true}); throw error; }
 finally { await context.close(); }
};
