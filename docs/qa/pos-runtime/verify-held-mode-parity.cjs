const path = require('node:path');

module.exports = async function ({a, base, check, q, invoke, post, out}) {
 for (const layout of ['normal','advanced']) {
  const terminalId = 'QA_HOLD_PARITY_' + layout + '_' + Date.now();
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable held-bill parity',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  const session = await invoke('open',{terminalId,openingCash:'0'});
  const sources = [];
  for (const productId of ['POS_QA_A_P18','POS_QA_A_P5']) {
   const bill = await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:false});
   await invoke('add',{transactionId:bill.transactionId,productId,quantity:'2',taxOn:'N'});
   await invoke('hold',{transactionId:bill.transactionId});
   sources.push(bill.transactionId);
  }
  const context = await a.c.browser().newContext({storageState:await a.c.storageState(),viewport:{width:1366,height:900},serviceWorkers:'block'});
  const page = await context.newPage();
  const held = () => page.evaluate(async () => {
   const request = indexedDB.open('ZenithPosOffline-POS_QA_A');
   return new Promise((resolve,reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
     const read = request.result.transaction('state').objectStore('state').getAll();
     read.onsuccess = () => {request.result.close();resolve(read.result.filter(row => row.key.startsWith('holds:')).flatMap(row => row.value));};
     read.onerror = () => reject(read.error);
    };
   });
  });
  const waitCache = async n => {
   for (let i=0;i<100;i++) {if ((await held()).filter(bill => bill.sessionId===session.sessionId).length===n) return;await page.waitForTimeout(100);}
   throw Error('Held cache did not reach '+n+': '+JSON.stringify(await held()));
  };
  const count = () => page.locator('#pos-held-wrap .nb-cnt').innerText();
  const offline = async () => {await context.setOffline(true);await page.waitForFunction(() => window._posOffline?.active()&&!window._posOffline.paused());};
  const online = async () => {
   await context.setOffline(false);
   await page.waitForFunction(() => window._posOffline&&!window._posOffline.active());
   // Finish restoring the cart before simulating the next network loss.
   await page.evaluate(async () => {await window._posOffline.sync();await window._posOffline.cacheHeldBills();});
  };
  try {
   await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&taxOn=N');
   await page.waitForFunction(() => !!window._posOffline?.lookup('POS_QA_A_P18'));
   await page.locator('.nb-modes__btn').click();await page.locator('[data-pos-layout="'+layout+'"]').click();
   await waitCache(2);
   check(layout+' caches both online held bills with complete source identities',(await held()).every(bill => bill.serverHeldId&&bill.sourceRevision&&bill.items.length===1));
   check(layout+' keeps the online close path when all held bills are already on the server',!(await page.evaluate(() => window._posOffline.needsDeferredClose())));
   for (let round=0;round<2;round++) {
    await offline();
    check(layout+' online holds retain the same count offline, round '+round,await count()==='2');
    await page.locator('#pos-held-wrap summary').click();
    check(layout+' both cached bills are resumable offline',await page.locator('#pos-held-wrap [data-recall]').count()===2);
    await page.locator('#pos-held-wrap summary').click();
    await online();
    check(layout+' reconnect preserves the same online count and status',await count()==='2'&&await page.locator('#pos-connection-status').textContent()==='Online');
   }
   await offline();await page.locator('#pos-held-wrap summary').click();await page.locator('#pos-held-wrap [data-recall]').first().click();
   await page.locator('.aj-qi').waitFor();await page.locator('.aj-qi').fill('3');await page.locator('.aj-p').fill('55');
   const expected = await page.locator('#posSumTotal').innerText();
   await page.locator('#pos-hold').click();await page.waitForFunction(() => !document.querySelector('.aj-qi'));
   // A response captured before Hold sync must not overwrite its later acknowledgement.
   let captured, releaseOld, staleDone;
   const oldCaptured=new Promise(resolve => {captured=resolve;});
   const oldReleased=new Promise(resolve => {releaseOld=resolve;});
   const staleFinished=new Promise(resolve => {staleDone=resolve;});
   let firstList=true;
   const delayList=async route => {
    const params=new URLSearchParams(route.request().postData()||'');
    if (params.get('action')!=='listHeld'||!firstList) return route.continue();
    firstList=false;
    const response=await route.fetch();captured();await oldReleased;
    await route.fulfill({response});staleDone();
   };
   await context.route('**/Terminal/ajaxCart',delayList);
   await context.route('**/Terminal/syncOfflineHeldBills',async route => {await oldCaptured;await route.continue();});
   try {
    await context.setOffline(false);
    const oldCacheDone=page.evaluate(() => window._posOffline.cacheHeldBills());
    await page.waitForFunction(() => !window._posOffline.active());
    await offline();releaseOld();await staleFinished;await oldCacheDone;
    check(layout+' a delayed server list cannot erase an acknowledged offline hold',
     (await held()).some(bill => bill.serverHeldId&&bill.items.some(item => Number(item.price)===55))&&await count()==='2');
   } finally {
    releaseOld();
    await context.unroute('**/Terminal/ajaxCart',delayList);
    await context.unroute('**/Terminal/syncOfflineHeldBills');
   }
   await online();await waitCache(2);
   check(layout+' reholding an online bill offline replaces the original hold without duplication',
    Number(q("SELECT count(*) AS n FROM pos_held_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PhHeld'")[0].n)===2);
   await page.reload();await page.waitForFunction(() => !!window._posOffline?.lookup('POS_QA_A_P18'));await waitCache(2);
   const paidHold=(await held()).find(bill => bill.items.some(item => Number(item.price)===55));
   await offline();await page.locator('#pos-held-wrap summary').click();
   await page.locator('#pos-held-wrap [data-recall]').filter({hasText:'165.00'}).click();
   await page.locator('.aj-qi').waitFor();
   check(layout+' synced offline hold survives a reload and another disconnect',await count()==='1'&&await page.locator('#posSumTotal').innerText()===expected&&await page.locator('.aj-qi').inputValue()==='3');
   await page.locator('#pos-pay-cash').click();await page.locator('#pos-cash-received').fill('200');await page.locator('.pos-cash-confirm').click();
   await page.getByRole('dialog',{name:'Sale saved on this device'}).waitFor();
   await page.locator('#posOfflineDialog .ofl-cancel').click();
   await online();await page.waitForFunction(async () => !(await window._posOffline.getQueue()).length);await waitCache(1);
   const completed=q("SELECT transaction_id,paid_amount,payable_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'");
   check(layout+' offline recall and payment completes the original bill exactly once',completed.length===1&&sources.includes(completed[0].transaction_id)&&Number(completed[0].payable_amount)===165);
   const stale=await a.c.request.post(base+'/apps/zenith/pos/Terminal/restoreOfflineDraft',{data:{
    terminalId,sessionId:session.sessionId,moquiSessionToken:a.t,draft:{...paidHold,version:2,offlineId:require('node:crypto').randomUUID(),
     organizationPartyId:'POS_QA_A',userId:await page.locator('#pos-offline-user').inputValue(),ts:new Date().toISOString(),total:165,taxAmount:0}}});
   check(layout+' a stale cached hold cannot recreate an already paid bill',(await stale.json()).rejected===true&&
    Number(q("SELECT count(*) AS n FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'")[0].n)===1);
   await offline();
   check(layout+' paid held bill does not reappear on the next disconnect',await count()==='1');
   await page.screenshot({path:path.join(out,'held-mode-parity-'+layout+'.png')});
   await online();
   const denied=await post('Terminal','ajaxCart',{action:'listHeld',sessionId:'POS_QA_B_SESSION'});
   check(layout+' held-bill snapshot rejects an unauthorized session',denied.status()===403);
  } finally {
   await context.setOffline(false);await context.close();
   for (const row of q("SELECT held_id FROM pos_held_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PhHeld'")) {
    const recalled=await invoke('recall',{heldId:row.held_id,sessionId:session.sessionId});await invoke('void',{transactionId:recalled.transactionId});
   }
   for (const row of q("SELECT transaction_id FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCreated'")) await invoke('void',{transactionId:row.transaction_id});
   const summary=await (await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId:session.sessionId})).json();
   await invoke('close',{sessionId:session.sessionId,closingCash:String(summary.expectedCash||0)});
  }
 }
};
