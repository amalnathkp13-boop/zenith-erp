const {randomUUID} = require('node:crypto');
const path = require('node:path');

const dbName = 'ZenithPosOffline-POS_QA_A';
function offlineValue({dbName, store, key, value, matchRevision}) {
 return new Promise((resolve,reject) => {
  const request = indexedDB.open(dbName,2);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result;
   const txn = db.transaction(store,value ? 'readwrite' : 'readonly');
   const records = txn.objectStore(store);
   const record = value ? records.put(value) : records.get(key);
   txn.oncomplete = () => {
    db.close();
    resolve(matchRevision ? record.result?.value?.sourceRevision : record.result);
   };
   txn.onabort = txn.onerror = () => { db.close(); reject(txn.error); };
  };
 });
}

module.exports = async function ({a,base,check,q,invoke,post,out}) {
 const terminalId = 'POS_QA_RECONNECT_' + randomUUID().slice(0,8);
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable reconnect checkout',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const retired = await invoke('open',{terminalId,openingCash:'0'});
 await invoke('close',{sessionId:retired.sessionId,closingCash:'0'});
 const session = await invoke('open',{terminalId,openingCash:'0'});
 const {transactionId} = await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:false});
 await invoke('add',{transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:'RETAIL',taxOn:'N'});

 const context = await a.c.browser().newContext({viewport:{width:1366,height:768}});
 const auth = await context.request.get(base+'/apps/zenith/pos/Dashboard',
  {headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
 check('reconnect fixture has a fresh cashier login',auth.ok()&&!auth.url().includes('/Login'));
 await context.addInitScript(() => { window.print = () => {}; });
 const page = await context.newPage();
 const transactions = () => q(`SELECT transaction_id,status_id,payable_amount FROM pos_transaction WHERE session_id='${session.sessionId}'`);
 const payments = () => q(`SELECT amount,reference_number FROM pos_payment WHERE transaction_id='${transactionId}'`);
 const responses = [];
 const olderId = 'QA-RETIRED-TOTAL-' + randomUUID();
 let allowRetry;
 const retryMayComplete = new Promise(resolve => { allowRetry = resolve; });
 let collected = 0;
 try {
  await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&transactionId='+transactionId+'&taxOn=N&salesModeId=RETAIL', {waitUntil:'commit'});
  await page.waitForFunction(() => !!window._posOffline?.lookup('POS_QA_A_P5'));
  await page.evaluate(() => window._posRefreshCart());
  const userId = await page.locator('#pos-offline-user').inputValue();
  const draftKey = 'draft:'+terminalId+':'+userId;
  await context.setOffline(true);
  const status = page.locator('#pos-connection-status');
  await status.filter({hasText:/^Offline$/}).waitFor();
  await page.waitForFunction(offlineValue,{dbName,store:'state',key:draftKey,matchRevision:true});
  await page.locator('.pos-cart .aj-p').fill('137.25');
  await page.locator('.pos-cart .aj-qi').fill('3');
  await page.evaluate(() => window._posOffline.add('POS_QA_A_P5'));
  await page.waitForFunction(() => document.querySelectorAll('.pos-cart .aj-qi').length === 2);
  const beforeReconnect = q(`SELECT quantity FROM pos_transaction_item WHERE transaction_id='${transactionId}'`);
  check('offline edits have not changed the server cart during the outage',beforeReconnect.length===1&&Number(beforeReconnect[0].quantity)===1);
  await page.evaluate(offlineValue,{dbName,store:'queue',value:{version:2,terminalId,userId,organizationPartyId:'POS_QA_A',
   offlineId:olderId,sessionId:retired.sessionId,mode:'RETAIL',taxOn:'N',ts:new Date().toISOString(),
   items:[{productId:'POS_QA_A_P18',mode:'RETAIL',qty:1,price:100}],total:101,taxAmount:0,
   paymentMethod:'Cash',payments:[{method:'Cash',amount:101}]}});

  await page.route('**/Terminal/restoreOfflineDraft',async route => {
   const response = await route.fetch();
   const body = await response.json().catch(() => ({}));
   responses.push(body);
   if (responses.length===1) {
    if (body.transactionId) return route.fulfill({status:503,json:{}});
    return route.fulfill({response});
   }
   await retryMayComplete;
   return route.fulfill({response});
  });
  const restoreResponse = page.waitForResponse(response => response.url().endsWith('/restoreOfflineDraft'));
  await context.setOffline(false);
  const firstStatus = (await restoreResponse).status();
  check('the server restored the active cart before the first reply was lost',firstStatus===503&&responses[0]?.transactionId===transactionId,
   {firstStatus,restored:responses[0]});
  const stillSaved = await page.evaluate(offlineValue,{dbName,store:'state',key:draftKey});
  check('a lost restore acknowledgement keeps the complete local bill until retry',
   stillSaved?.value?.items.length===2&&(await status.textContent()).trim()!=='Online');
  allowRetry();
  await page.evaluate(async () => { await window._posOffline.sync(); await window._posOffline.sync(); });
  await page.waitForFunction(() => window._posOffline && !window._posOffline.active());
  await status.filter({hasText:/^Online$/}).waitFor();
  await page.waitForFunction(id => /total differs/i.test(window._posOffline.reviewReason(id) || ''),olderId);
  const restored = transactions();
  const rows = q(`SELECT product_id,quantity,unit_price FROM pos_transaction_item WHERE transaction_id='${transactionId}'`);
  const edited = rows.find(row => row.product_id==='POS_QA_A_P18');
  check('reconnect retries restore the same unpaid bill with every edit and no duplicate',
   responses.length>=2&&responses.every(response=>response.transactionId===transactionId)&&
   restored.length===1&&restored[0].status_id==='PtCreated'&&rows.length===2&&
   Number(edited?.quantity)===3&&Number(edited?.unit_price)===137.25&&rows.some(row=>row.product_id==='POS_QA_A_P5')&&
   payments().length===0,{responses,restored,rows});
  check('the connected checkout displays both restored lines without a saved-workspace flag',
   await page.locator('.pos-cart .aj-qi').count()===2&&
   !/Saved workspace/.test(await page.locator('body').innerText()));

  await page.locator('.nb-power').click();
  const close = page.locator('#posCloseSessionOverlay');
  await close.locator('.pos-close-confirm').waitFor();
  await close.locator('.pos-close-cancel').click();
  check('Close uses the standard review card with an unpaid cart after reconnect',transactions()[0].status_id==='PtCreated');

  collected = Number(restored[0].payable_amount);
  await page.locator('#pos-pay-cash').click();
  const cash = page.locator('.pos-cash-panel,#posCashTenderOverlay');
  await cash.locator('.pos-cash-input,#posCashRecv').fill(String(collected));
  const onlinePayment = page.waitForResponse(response => response.url().endsWith('/payAndComplete'));
  await cash.locator('.pos-cash-confirm,#posCashConfirm').click();
  const receipt = await (await onlinePayment).json();
  await page.locator('.pos-cart .aj-qi').first().waitFor({state:'detached'});
  const recorded = payments();
  check('the restored cart uses online checkout and records a single exact cash tender',
   receipt.success&&transactions()[0].status_id==='PtCompleted'&&recorded.length===1&&Number(recorded[0].amount)===collected&&
   !String(recorded[0].reference_number||'').startsWith('OFFLINE:')&&await page.locator('#posOfflineDialog').count()===0,
   {collected,recorded});

  let closeResult;
  await page.route('**/Terminal/closeSession',async route => {
   const response = await route.fetch();
   closeResult = await response.json();
   await route.fulfill({response});
  });
  await page.locator('.nb-power').click();
  await close.locator('.pos-close-confirm').waitFor();
  check('the online drawer summary includes the real cash tender',Number(await close.locator('#pos-closing-cash').inputValue())===collected);
  await close.locator('.pos-close-confirm').click();
  await page.locator('.pos-no-session').waitFor();
  const drawer = q(`SELECT status_id,closing_cash,expected_cash FROM pos_session WHERE session_id='${session.sessionId}'`)[0];
  const retained = await page.evaluate(offlineValue,{dbName,store:'queue',key:olderId});
  check('a rejected older-session sale stays queued without blocking current online Close',
   closeResult?.success&&drawer.status_id==='PsClosed'&&Number(drawer.closing_cash)===collected&&
   Number(drawer.expected_cash)===collected&&retained?.sessionId===retired.sessionId&&retained?.total===101,{drawer,retained:!!retained});
  check('the rejected older-session sale did not add a bill to its retired drawer',
   q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${retired.sessionId}'`).length===0);
 } catch (error) {
  allowRetry();
  if (out) await page.screenshot({path:path.join(out,'reconnect-checkout-failure.png')}).catch(() => {});
  throw error;
 } finally {
  await context.setOffline(false);
  await context.close();
  if (q(`SELECT status_id FROM pos_session WHERE session_id='${session.sessionId}'`)[0]?.status_id==='PsOpen') {
   await invoke('close',{sessionId:session.sessionId,closingCash:String(collected)});
  }
 }
};
