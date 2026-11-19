const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function ({a, base, check, q, invoke, post, out}) {
 const suffix = Date.now().toString(36);
 const products = [];
 for (let index = 0; index < 20; index++) {
  const product = await invoke('importProduct', {sku:'QA_OFL_HOLD_' + suffix + '_' + index,
   productName:'Disposable held product ' + suffix + ' ' + index, mrp:String(10 + index), listPrice:String(10 + index), unit:'Nos'});
  products.push(product.productId);
 }
 check('offline held-bill fixture has twenty distinct products', new Set(products).size === 20 && products.every(Boolean));
 for (const layout of ['normal','advanced']) {
  const terminalId = 'QA_OFL_HOLD_' + suffix + '_' + layout;
  await post('PosTerminals','createTerminal', {terminalId, terminalName:'Disposable held-bill reconnect ' + layout,
   facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  const session = await invoke('open', {terminalId,openingCash:'0'});
  const source = await invoke('cart', {sessionId:session.sessionId,reuseOpenCart:false});
  for (const productId of products.slice(0,5))
   await invoke('add', {transactionId:source.transactionId,productId,quantity:'1',taxOn:'N'});
  const context = await a.c.browser().newContext({viewport:{width:1366,height:768}});
  const signedIn = await context.request.get(base + '/apps/zenith/pos/Dashboard',
   {headers:{Authorization:'Basic ' + Buffer.from('pos.qa:moqui').toString('base64')}});
  check(layout + ' test terminal has its own authenticated browser session',signedIn.ok() && !signedIn.url().includes('/Login'));
  const page = await context.newPage();
  await context.route('**/Terminal/syncOfflineHeldBills',route => route.abort('internetdisconnected'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const readState = waitForDraft => new Promise((resolve,reject) => {
   const request = indexedDB.open('ZenithPosOffline-POS_QA_A');
   request.onerror = () => reject(request.error);
   request.onsuccess = () => {
    const read = request.result.transaction('state').objectStore('state').getAll();
    read.onsuccess = () => {
     request.result.close();
     resolve(waitForDraft ? read.result.some(row => row.key.startsWith('draft:') && row.value?.items) : read.result);
    };
    read.onerror = () => reject(read.error);
   };
  });
  const state = () => page.evaluate(readState);
  const goOffline = async () => {
   await context.setOffline(true);
   await page.locator('#pos-connection-status').filter({hasText:/^Offline$/}).waitFor();
   await page.waitForFunction(readState,true);
  };
  const held = async () => (await state()).find(row => row.key.startsWith('holds:'))?.value || [];
  const visible = () => page.locator('.pos-cart tbody tr:has(.aj-qi)').evaluateAll(rows => rows.map(row => ({
   name:row.children[1].querySelector('div').textContent,qty:Number(row.querySelector('.aj-qi').value),price:Number(row.querySelector('.aj-p').value)
  })));
  let firstAcknowledgement = true, sent;
  try {
   await page.goto(base + '/apps/zenith/pos/Terminal?sessionId=' + session.sessionId + '&transactionId=' + source.transactionId + '&taxOn=N', {waitUntil:'commit'});
   await page.waitForFunction(id => !!window._posOffline?.lookup(id),products[19]);
   await page.locator('.nb-modes__btn').click();
   await page.locator('[data-pos-layout="' + layout + '"]').click();
   await page.evaluate(() => window._posRefreshCart());
   await goOffline();
   await context.setOffline(false);
   await page.waitForFunction(() => !window._posOffline.active());
   await page.locator('#pos-held-wrap > button.is-empty').waitFor();
   const nativeHold = page.waitForResponse(response => response.url().endsWith('/ajaxCart') &&
    new URLSearchParams(response.request().postData() || '').get('action') === 'holdSale');
   await page.locator('#pos-hold').click();
   const nativeHeld = await (await nativeHold).json();
   check(layout + ' reconnect with an untouched cart uses online Hold directly',nativeHeld.success && !(await held()).length);
   await page.locator('#pos-held-wrap summary').click();
   await page.locator('#pos-held-wrap form[action$="/recallSale"] button').click();
   await page.waitForFunction(() => document.querySelectorAll('.aj-qi').length === 5);
   await goOffline();
   await page.evaluate(ids => ids.forEach(id => window._posOffline.add(id)),products.slice(5));
   await page.locator('.aj-qi').last().waitFor();
   await page.locator('.aj-qi').first().fill('3');
   await page.locator('.aj-p').nth(1).fill('17.25');
   const expected = await visible();
   check(layout + ' offline cart contains five server lines plus fifteen new lines before Hold',expected.length === 20);
   // Enter/form submission and the Hold button must use the same full device snapshot.
   await page.locator('#pos-hold').evaluate(button => button.form.requestSubmit());
   await page.waitForFunction(() => !document.querySelector('.aj-qi'));
   const firstHeld = (await held())[0];
   check(layout + ' offline Hold form saves all twenty lines in device storage',firstHeld.items.length === 20);
   await page.evaluate(id => window._posOffline.add(id),products[0]);
   await page.locator('.aj-qi').fill('2');
   await page.locator('#pos-held-wrap summary').click();
   await page.locator('#pos-held-wrap [data-recall]').click();
   await page.waitForFunction(() => document.querySelectorAll('.aj-qi').length === 20);
   assert.deepEqual(await visible(),expected);
   check(layout + ' recalling twenty lines automatically holds the current cart',(await held()).length === 1 && (await held())[0].items[0].qty === 2);
   await page.locator('#pos-hold').click();
   await page.waitForFunction(() => !document.querySelector('.aj-qi'));
   check(layout + ' a new hold gets its own acknowledgement identity',
    (await held()).find(bill => bill.items.length === 20).draftId !== firstHeld.draftId);
   await page.locator('#pos-held-wrap summary').click();
   check(layout + ' device held list uses the existing menu and newest-first order',
    (await page.locator('#pos-held-wrap .nb-held__item').first().innerText()).includes('20 items') &&
    await page.locator('#posOfflineDialog').count() === 0 && await page.locator('.pos-reference-payments button').count() === 6);
   if (layout === 'normal') {
    const config = (await state()).find(row => row.key.startsWith('config:')).value;
    await page.evaluate(({bill,userId,terminalId}) => new Promise((resolve,reject) => {
     const request = indexedDB.open('ZenithPosOffline-POS_QA_A');
     request.onerror = () => reject(request.error);
     request.onsuccess = () => {
      const txn = request.result.transaction('queue','readwrite');
      txn.objectStore('queue').add({...bill,version:2,offlineId:'QA-PRIOR-SESSION-SALE',sessionId:'QA-ENDED-SESSION',
       terminalId,userId,organizationPartyId:'POS_QA_A',ts:new Date().toISOString(),total:10,taxAmount:0,
       paymentMethod:'Cash',payments:[{method:'Cash',amount:10}]});
      txn.oncomplete = () => { request.result.close(); resolve(); };
      txn.onerror = () => reject(txn.error);
     };
    }),{bill:(await held())[0],userId:config.userId,terminalId});
   }
   await page.screenshot({path:path.join(out,'offline-held-' + layout + '.png')});
   await context.route('**/Terminal/syncOfflineHeldBills', async route => {
    sent = route.request().postDataJSON();
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({response}); return; }
    const body = await response.json();
    if (firstAcknowledgement && body.syncedIds?.length === 2) {
     firstAcknowledgement = false;
     await route.fulfill({status:503,contentType:'application/json',body:'{}'});
    } else await route.fulfill({response,json:body});
   });
   const interrupted = page.waitForResponse(response => response.url().endsWith('/syncOfflineHeldBills') && response.status() === 503);
   await context.setOffline(false);
   await interrupted;
   check(layout + ' lost acknowledgement retains both full device-held bills',(await held()).length === 2 && (await held()).some(bill => bill.items.length === 20));
   const serverItems = q("SELECT product_id,quantity,unit_price FROM pos_transaction_item WHERE transaction_id='" + source.transactionId + "'");
   check(layout + ' reconnect restores all twenty lines into the original five-line server draft',serverItems.length === 20 && serverItems.some(item => Number(item.unit_price) === 17.25) && serverItems.some(item => Number(item.quantity) === 3));
   check(layout + ' syncing a held bill creates no payment or issued bill number',
    q("SELECT transaction_number,status_id FROM pos_transaction WHERE transaction_id='" + source.transactionId + "'")[0].status_id === 'PtHeld' &&
    !q("SELECT transaction_number FROM pos_transaction WHERE transaction_id='" + source.transactionId + "'")[0].transaction_number &&
    q("SELECT payment_id FROM pos_payment WHERE transaction_id='" + source.transactionId + "'").length === 0);
   const acknowledged = page.waitForResponse(response => response.url().endsWith('/syncOfflineHeldBills') && response.ok());
   await page.reload({waitUntil:'commit'});
   await acknowledged;
   await page.waitForFunction(() => window._posOffline && !window._posOffline.active());
   await page.locator('#pos-held-wrap summary').waitFor();
   await page.locator('#pos-held-wrap summary').click();
   const recovered = page.locator('#pos-held-wrap form[action$="/recallSale"] .nb-held__item').filter({hasText:'20 items'});
   check(layout + ' a synced hold uses the original online row',!(await recovered.innerText()).includes('this device'));
   await recovered.click();
   await page.waitForFunction(() => document.querySelectorAll('.aj-qi').length === 20);
   assert.deepEqual(await visible(),expected);
   check(layout + ' reload and online recall preserve every product quantity and custom rate',true);
   if (layout === 'normal') check('a prior-session sale stays queued while the current held bill is recalled online',
    (await page.evaluate(() => window._posOffline.getQueue())).some(sale => sale.offlineId === 'QA-PRIOR-SESSION-SALE'));
   const {moquiSessionToken, ...withoutToken} = sent;
   const replay = await a.c.request.post(base + '/apps/zenith/pos/Terminal/syncOfflineHeldBills',
    {data:{...withoutToken,moquiSessionToken:a.t}});
   check(layout + ' held-bill retry is accepted',replay.ok(),{status:replay.status()});
   const result = await replay.json();
   check(layout + ' retransmission acknowledges held bills without duplicating them',result.syncedIds.length === 2 &&
    Number(q("SELECT count(*) AS n FROM pos_held_transaction WHERE session_id='" + session.sessionId + "'")[0].n) === 3);
   const missingToken = await a.c.request.post(base + '/apps/zenith/pos/Terminal/syncOfflineHeldBills',{data:withoutToken});
   check(layout + ' held-bill synchronization requires CSRF',[401,403].includes(missingToken.status()));
   await page.locator('#pos-hold').click();
   await page.waitForFunction(() => !document.querySelector('.aj-qi'));
   await page.locator('#pos-held-wrap summary').click();
   await page.locator('#pos-held-wrap .nb-held__item').filter({hasText:'20 items'}).click();
   await page.waitForFunction(() => document.querySelectorAll('.aj-qi').length === 20);
   assert.deepEqual(await visible(),expected);
   check(layout + ' subsequent online Hold and Recall retain all twenty lines',true);
   if (layout === 'normal') {
    const snapshot = await (await post('Terminal','ajaxCart',{action:'refresh',sessionId:session.sessionId,transactionId:source.transactionId})).json();
    const original = q("SELECT product_id,quantity,unit_price FROM pos_transaction_item WHERE transaction_id='" + source.transactionId + "' ORDER BY item_seq_id");
    const invalid = {...withoutToken.heldBills.find(bill => bill.items.length === 20),offlineId:'REJECT-' + suffix,
     sourceRevision:snapshot.sourceRevision};
    invalid.items = invalid.items.map((item,index) => index === 19 ? {...item,productId:'POS_QA_B_P18'} : item);
    const rejected = await a.c.request.post(base + '/apps/zenith/pos/Terminal/syncOfflineHeldBills',
     {data:{...withoutToken,moquiSessionToken:a.t,heldBills:[invalid]}});
    const rejectedBody = await rejected.json();
    check('a rejected line rolls back the whole held-bill import',rejectedBody.failures?.length === 1 && !rejectedBody.syncedIds?.length);
    assert.deepEqual(q("SELECT product_id,quantity,unit_price FROM pos_transaction_item WHERE transaction_id='" + source.transactionId + "' ORDER BY item_seq_id"),original);
    check('a failed held-bill import leaves all twenty existing server lines intact',true);
   }
   await goOffline();
   await page.locator('.aj-qi').first().fill('4');
   await context.setOffline(false);
   await page.waitForFunction(() => !window._posOffline.active());
   const serverSmallBill = page.locator('#pos-held-wrap form[action$="/recallSale"] button').filter({hasText:'1 item'});
   await page.locator('#pos-held-wrap summary').click();
   await serverSmallBill.click();
   await page.waitForFunction(() => document.querySelectorAll('.aj-qi').length === 1 && !window._posOffline.active());
   check(layout + ' online recall automatically saves the modified offline cart with every line',
    q("SELECT quantity FROM pos_transaction_item WHERE transaction_id='" + source.transactionId + "'").length === 20 &&
    q("SELECT quantity FROM pos_transaction_item WHERE transaction_id='" + source.transactionId + "'").some(item => Number(item.quantity) === 4));
   await page.screenshot({path:path.join(out,'reconnected-held-' + layout + '.png')});
  } catch (error) {
   console.error(JSON.stringify({layout,errors,visibleLines:(await visible()).length,savedLines:(await held()).map(bill => bill.items.length),
    connection:await page.locator('#pos-connection-status').textContent()}));
   await page.screenshot({path:path.join(out,'held-reconnect-failure-' + layout + '.png')});
   throw error;
  } finally {
   await context.setOffline(false); await context.close();
   const rows = q("SELECT held_id FROM pos_held_transaction WHERE session_id='" + session.sessionId + "' AND status_id='PhHeld'");
   for (const row of rows) {
    const recalled = await invoke('recall',{heldId:row.held_id,sessionId:session.sessionId});
    await invoke('void',{transactionId:recalled.transactionId});
   }
   for (const row of q("SELECT transaction_id FROM pos_transaction WHERE session_id='" + session.sessionId + "' AND status_id='PtCreated'"))
    await invoke('void',{transactionId:row.transaction_id});
   await invoke('close',{sessionId:session.sessionId,closingCash:'0'});
  }
 }
};
