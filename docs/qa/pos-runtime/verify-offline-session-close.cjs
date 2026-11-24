const path = require('node:path');
module.exports = async function ({a, base, check, q, invoke, post, out}) {
 const terminalId = 'POS_QA_A_CLOSE_' + Date.now();
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Offline close sample counter',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const session = await invoke('open',{terminalId,openingCash:'100'});
 const draft = await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:false});
 await invoke('add',{transactionId:draft.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'Y'});
 const context = await a.c.browser().newContext({storageState:await a.c.storageState(),viewport:{width:1440,height:900},serviceWorkers:'block'});
 const page = await context.newPage();
 let outage = false, loseCloseResponse = true, closeRequests = 0;
 await context.route('**/Terminal/*',async route => {
  if (outage) return route.abort('internetdisconnected');
  if (route.request().url().endsWith('/closeSession')) {
   closeRequests++;
   if (loseCloseResponse) { loseCloseResponse = false; await route.fetch(); return route.abort('failed'); }
  }
  return route.continue();
 });
 async function stored() {
  return page.evaluate(() => new Promise((resolve,reject) => {
   const who = document.getElementById('pos-sync-context').dataset;
   const r = indexedDB.open('ZenithPosOffline-' + encodeURIComponent(who.organization),2);
   r.onsuccess = () => { const d=r.result,t=d.transaction(['state','queue']);let state,queue;
    const s=t.objectStore('state').getAll(),q=t.objectStore('queue').getAll();
    s.onsuccess=()=>state=s.result;q.onsuccess=()=>queue=q.result;
    t.oncomplete=()=>{d.close();resolve({state,queue})};t.onerror=reject; };r.onerror=reject;
  }));
 }
 try {
  await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&transactionId='+draft.transactionId+'&taxOn=Y&salesModeId=RETAIL');
  await page.waitForFunction(()=>window.PosDeferredClose && window._posOffline?.lookup('POS_QA_A_P18'));
  await page.waitForFunction(async id => {
   return new Promise(resolve=>{const r=indexedDB.open('ZenithPosOffline-POS_QA_A',2);r.onsuccess=()=>{const d=r.result,q=d.transaction('state').objectStore('state').get('summary:'+id);q.onsuccess=()=>{d.close();resolve(!!q.result?.value)}};});
  },session.sessionId);
  await page.evaluate(()=>window._posRefreshCart());
  await page.waitForFunction(()=>document.querySelector('.aj-qi'));
  await context.setOffline(true);
  await page.waitForFunction(()=>window._posOffline.active() && document.querySelector('.aj-qi'));
  await page.locator('.aj-qi').fill('2');
  await page.locator('#pos-pay-cash').click();
  await page.locator('#pos-cash-received').fill('250');
  await page.locator('.pos-cash-confirm').click();
  await page.locator('#posPaySave').click();
  await page.locator('#posPayConfirmOverlay').waitFor({state:'hidden'});
  await page.evaluate(()=>window._posAjax('POS_QA_A_P5',200,'Disposable POS A P5'));
  await page.locator('#pos-pay-card').click();
  await page.locator('#posPaySave').click();
  await page.locator('#posPayConfirmOverlay').waitFor({state:'hidden'});
  const saved = (await stored()).queue;
  check('two offline sample bills are durable before closing',saved.length===2,saved);
  check('billing row omits workspace and pending review text',await page.locator('#pos-offline-banner').count()===0);
  await page.locator('.pos-header form[action*="closeSession"] button').click();
  await page.locator('#posCloseSessionOverlay').waitFor();
  check('cached close summary includes cash change and pending card sale',Number(await page.locator('#pos-closing-cash').inputValue())===336,await page.locator('#posCloseSessionOverlay').innerText());
  await page.screenshot({path:path.join(out,'offline-close-cash-review.png')});
  await page.locator('#posCloseSessionOverlay .pos-close-confirm').click();
  await page.locator('#posSessionClosed').waitFor();
  const closed = (await stored()).state.find(r=>r.key==='session-close:'+session.sessionId)?.value;
  check('offline close is committed locally without an internet request',closed?.closingCash==='336.00'&&!closed.syncedAt&&closeRequests===0,closed);
  check('pending bills remain intact after local closure',(await stored()).queue.length===2);
  check('server is left open only for ordered background reconciliation',q("SELECT status_id FROM pos_session WHERE session_id='"+session.sessionId+"'")[0]?.status_id==='PsOpen');
  await page.screenshot({path:path.join(out,'offline-session-closed.png')});
  await page.locator('#posSessionClosed .pos-closed-history').click();
  await page.locator('#pos-history-overlay [data-device-reprint]').first().waitFor();
  check('saved bills remain accessible from the locally closed session',await page.locator('#pos-history-overlay [data-device-reprint]').count()===2);
  await page.locator('#hist-close').click();
  outage=true;
  await context.setOffline(false);
  await page.reload();
  await page.locator('#posSessionClosed').waitFor();
  check('local closure survives reload during a transport outage',(await stored()).queue.length===2);
  await page.goto(base+'/apps/zenith/Contacts/Customers');
  await page.waitForFunction(()=>window.PosDeferredClose);
  check('background reconciliation is available outside billing',await page.locator('#cartInlineAddForm').count()===0);
  outage=false;
  for (let attempt=0;attempt<3&&closeRequests===0;attempt++) await page.evaluate(()=>window.PosDeferredClose.flush());
  check('lost close response retains the durable request',closeRequests===1&&(await stored()).state.some(r=>r.key==='session-close:'+session.sessionId&&!r.value.syncedAt),{closeRequests});
  let after;
  for (let attempt=0;attempt<12;attempt++) {
   await page.waitForTimeout(1000);
   after=await stored();
   if (after.queue.length===0&&after.state.find(r=>r.key==='session-close:'+session.sessionId)?.value.syncedAt) break;
  }
  check('reconnection acknowledges bills before completing the deferred close',after.queue.length===0&&after.state.find(r=>r.key==='session-close:'+session.sessionId)?.value.syncedAt,after);
  const drawer=q("SELECT status_id,closing_cash,expected_cash,cash_difference FROM pos_session WHERE session_id='"+session.sessionId+"'")[0];
  check('server close reconciles the exact cash after importing offline bills',drawer?.status_id==='PsClosed'&&Number(drawer.closing_cash)===336&&Number(drawer.expected_cash)===336&&Number(drawer.cash_difference)===0,drawer);
  check('duplicate retry does not import or charge either bill twice',Number(q("SELECT count(*) AS n FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'")[0].n)===2&&closeRequests===2,{closeRequests});
  const summary=await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId:session.sessionId});
  check('closed session cannot be reopened as a live drawer',!(await summary.json()).success);

  // A different device or an idle timeout may have retired the drawer before its offline bills return.
  const retired=await invoke('open',{terminalId,openingCash:'25'});
  const missing=await invoke('cart',{sessionId:retired.sessionId,reuseOpenCart:false});
  await invoke('add',{transactionId:missing.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'Y'});
  const original=await (await post('Terminal','ajaxCart',{action:'refresh',sessionId:retired.sessionId,transactionId:missing.transactionId,taxOn:'Y'})).json();
  const held=await invoke('cart',{sessionId:retired.sessionId,reuseOpenCart:false});
  await invoke('add',{transactionId:held.transactionId,productId:'POS_QA_A_P5',quantity:'1',taxOn:'Y'});
  await invoke('hold',{transactionId:held.transactionId});
  const paid=await invoke('cart',{sessionId:retired.sessionId,reuseOpenCart:false});
  await invoke('add',{transactionId:paid.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'Y'});
  await invoke('pay',{transactionId:paid.transactionId,paymentMethod:'Cash',amount:'118'});
  await invoke('complete',{transactionId:paid.transactionId});
  await invoke('close',{sessionId:retired.sessionId,closingCash:'589'});
  const before=q("SELECT close_date,last_activity_date FROM pos_session WHERE session_id='"+retired.sessionId+"'")[0];
  check('retirement removed the unpaid cart but preserved the voided held bill',q("SELECT transaction_id FROM pos_transaction WHERE transaction_id='"+missing.transactionId+"'").length===0&&q("SELECT status_id FROM pos_transaction WHERE transaction_id='"+held.transactionId+"'")[0]?.status_id==='PtVoided');
  const newer=await invoke('open',{terminalId,openingCash:'0'});
  const recovered={...saved[0],checkoutAttemptId:null,offlineId:'RECOVER-MISSING-'+Date.now(),sessionId:retired.sessionId,sourceTransactionId:missing.transactionId,sourceRevision:original.sourceRevision,items:[{...saved[0].items[0],productId:'POS_QA_A_P18',qty:1,price:100}],total:118,taxAmount:18,payments:[{method:'Cash',amount:118}],change:0,paymentMethod:'Cash'};
  const recoveredHold={...recovered,offlineId:'RECOVER-HELD-'+Date.now(),sourceTransactionId:held.transactionId,items:[{...recovered.items[0],productId:'POS_QA_A_P5',price:200}],total:210,taxAmount:10,payments:[{method:'Cash',amount:210}]};
  const legacy={offlineId:'RECOVER-LEGACY-'+Date.now(),terminalId,sessionId:retired.sessionId,organizationPartyId:recovered.organizationPartyId,items:[{productId:'POS_QA_A_P18',qty:1,price:100}],taxOn:'Y',total:118,paymentMethod:'Cash',ts:new Date().toISOString()};
  const batch=[recovered,recoveredHold,legacy].map(JSON.stringify);
  const imported=await invoke('offline',{terminalId,transactions:JSON.stringify(batch)});
  check('current and older offline snapshots sync automatically to a retired original drawer',imported.syncedIds?.length===3&&imported.failedCount===0,imported);
  const reconciled=q("SELECT status_id,close_date,last_activity_date,closing_cash,expected_cash,cash_difference FROM pos_session WHERE session_id='"+retired.sessionId+"'")[0];
  check('retired-session recovery keeps the original close time and reconciles its collected cash',reconciled.status_id==='PsClosed'&&reconciled.close_date===before.close_date&&reconciled.last_activity_date===before.last_activity_date&&Number(reconciled.closing_cash)===589&&Number(reconciled.expected_cash)===589&&Number(reconciled.cash_difference)===0,reconciled);
  check('recovering an old drawer does not change the currently open drawer',q("SELECT status_id,opening_cash FROM pos_session WHERE session_id='"+newer.sessionId+"'")[0]?.status_id==='PsOpen');
  const again=await invoke('offline',{terminalId,transactions:JSON.stringify(batch)});
  check('retired-session retries are acknowledged without duplicate bills',again.syncedIds?.length===3&&Number(q("SELECT count(*) AS n FROM pos_transaction WHERE session_id='"+retired.sessionId+"' AND status_id='PtCompleted'")[0].n)===4,again);
  const importedTime=q("SELECT extract(epoch from t.completed_date)*1000 AS completed_ms,extract(epoch from p.payment_date)*1000 AS paid_ms FROM pos_offline_transaction o JOIN pos_transaction t ON t.transaction_id=o.created_transaction_id JOIN pos_payment p ON p.transaction_id=t.transaction_id WHERE o.transaction_data_json LIKE '%"+recovered.offlineId+"%'")[0];
  check('late sync preserves the actual offline sale and payment timestamps',Number(importedTime.completed_ms)===Date.parse(recovered.ts)&&Number(importedTime.paid_ms)===Date.parse(recovered.ts),importedTime);
  const invalid={...recovered,offlineId:'REJECT-TOTAL-'+Date.now(),sourceTransactionId:null,sourceRevision:null,total:119};
  const duplicate={...recovered,offlineId:'REJECT-PAID-'+Date.now(),sourceTransactionId:paid.transactionId};
  const rejectedResponse=await a.c.request.post(base+'/apps/zenith/pos/Terminal/syncOfflineTransactions',{data:{moquiSessionToken:a.t,terminalId,transactions:[invalid,duplicate].map(JSON.stringify)}});
  const rejects=await rejectedResponse.json();
  check('real total mismatches and previously paid sources still require review',rejects.failedCount===2&&!rejects.syncedIds?.length&&rejects.failures?.length===2&&!JSON.stringify(rejects).includes('originRegionGeoId')&&rejects.failures.some(f=>/total differs/.test(f.error))&&rejects.failures.some(f=>/draft changed/.test(f.error)),rejects);
  check('failed recovery rolls back its temporary session and cart changes',q("SELECT status_id,expected_cash FROM pos_session WHERE session_id='"+retired.sessionId+"'")[0]?.status_id==='PsClosed'&&Number(q("SELECT count(*) AS n FROM pos_transaction WHERE session_id='"+retired.sessionId+"' AND status_id='PtCompleted'")[0].n)===4&&Number(q("SELECT count(*) AS n FROM pos_transaction WHERE session_id='"+retired.sessionId+"' AND status_id='PtCreated'")[0].n)===0);
  await invoke('close',{sessionId:newer.sessionId,closingCash:'0'});
 } finally { await context.setOffline(false); await context.close(); }
 await require('./verify-deferred-close-reopen.cjs')({a,base,check,q,invoke,post,out});
};
