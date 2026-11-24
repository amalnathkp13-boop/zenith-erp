const {randomUUID}=require('node:crypto');
const path=require('node:path');

module.exports=async function({a,base,check,q,invoke,post,out}) {
 for(const [layout,entry] of [['normal','back'],['advanced','default'],['normal','qapps']]) {
  const terminalId='QA_REOPEN_'+randomUUID().slice(0,8);
  let unrelated;
  if(entry==='back') {
   const otherId='QA_REOPEN_OTHER_'+randomUUID().slice(0,8);
   await post('PosTerminals','createTerminal',{terminalId:otherId,terminalName:'Disposable unrelated close retry',
    facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
   unrelated={...(await invoke('open',{terminalId:otherId,openingCash:'0'})),terminalId:otherId};
  }
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable deferred-close reopen',
   facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  const original=await invoke('open',{terminalId,openingCash:'0'});
  const bill=await invoke('cart',{sessionId:original.sessionId});
  await invoke('add',{transactionId:bill.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  const context=await a.c.browser().newContext({storageState:await a.c.storageState(),viewport:{width:1366,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await context.addInitScript(mode=>localStorage.setItem('posLayoutMode',mode),layout);
  const page=await context.newPage();
  let blockSync=false,newSessionId,openRequests=0,holdUnrelated=false,unrelatedStarted=false,releaseUnrelated;
  const unrelatedGate=new Promise(resolve=>releaseUnrelated=resolve);
  await context.route('**/Terminal/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/openSession'))openRequests++;
   if(holdUnrelated&&url.pathname.endsWith('/closeSession')&&
      new URLSearchParams(route.request().postData()||'').get('sessionId')===unrelated?.sessionId) {
    unrelatedStarted=true;await unrelatedGate;return route.continue().catch(()=>{});
   }
   if(blockSync&&/\/(syncOfflineTransactions|closeSession)$/.test(url.pathname))return route.abort('failed');
   return route.continue();
  });
  const drawer=id=>q(`SELECT * FROM pos_session WHERE session_id='${id}'`)[0];
  async function stored() {
   return page.evaluate(()=>new Promise((resolve,reject)=>{
    const org=document.getElementById('pos-sync-context').dataset.organization;
    const request=indexedDB.open('ZenithPosOffline-'+encodeURIComponent(org),2);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
     const db=request.result,tx=db.transaction(['state','queue']);let state,queue;
     const s=tx.objectStore('state').getAll(),q=tx.objectStore('queue').getAll();
     s.onsuccess=()=>state=s.result;q.onsuccess=()=>queue=q.result;
     tx.oncomplete=()=>{db.close();resolve({state,queue})};tx.onerror=()=>reject(tx.error);
    };
   }));
  }
  try {
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${original.sessionId}&transactionId=${bill.transactionId}&taxOn=N`);
   await page.waitForFunction(()=>window.PosDeferredClose&&window._posOffline?.lookup('POS_QA_A_P18'));
   await page.waitForFunction(id=>new Promise(resolve=>{
    const request=indexedDB.open('ZenithPosOffline-POS_QA_A',2);
    request.onsuccess=()=>{const db=request.result,r=db.transaction('state').objectStore('state').get('summary:'+id);
     r.onsuccess=()=>{db.close();resolve(!!r.result?.value)};};
   }),original.sessionId);
   await page.evaluate(()=>window._posRefreshCart());
   await page.locator('.aj-qi').first().waitFor();
   await context.setOffline(true);
   await page.waitForFunction(()=>window._posOffline.active()&&document.querySelector('.aj-qi'));
   await page.locator('#pos-pay-cash').click();
   await page.locator('#pos-cash-received').fill('150');
   await page.locator('.pos-cash-confirm').click();
   await page.locator('#posPaySave').click();
   await page.locator('#posPayConfirmOverlay').waitFor({state:'hidden'});
   check(layout+' deferred-reopen fixture has one durable paid bill',(await stored()).queue.length===1);
   await page.locator('.pos-header form[action*="closeSession"] button').click();
   await page.locator('#pos-closing-cash').fill('100');
   await page.locator('#posCloseSessionOverlay .pos-close-confirm').click();
   await page.locator('#posSessionClosed[open]').waitFor();
   check(layout+' local close is pending while the server drawer is still open',drawer(original.sessionId).status_id==='PsOpen');
   check('Back to counters points directly to terminal selection',
    await page.locator('#posSessionClosed a').getAttribute('href')==='/apps/zenith/pos/Terminal?chooseTerminal=Y');
   blockSync=true;await context.setOffline(false);
   if(entry==='default')await page.goto(base+'/apps/zenith/pos/Terminal');
   else {
    await page.locator('#posSessionClosed a').click();
    if(entry==='qapps')await page.goto(base+'/qapps/zenith/pos/Terminal?chooseTerminal=Y');
   }
   await page.locator('#OpenSessionForm').waitFor();
   check(layout+' '+entry+' entry displays the selector without the old closure popup',await page.locator('#posSessionClosed').count()===0);
   await page.locator('#OpenSessionForm [name=terminalId]').selectOption(terminalId);
   await page.locator('#OpenSessionForm [name=openingCash]').fill('25');
   await page.locator('#OpenSessionForm button[type=submit]').click();
   await page.getByText(/The previous session could not finish closing/).waitFor();
   check('Failed sync keeps the selector ready to retry and never reopens the locally closed shift',
    openRequests===0&&drawer(original.sessionId).status_id==='PsOpen'&&
    await page.locator('#posSessionClosed').count()===0&&(await stored()).queue.length===1);
   if(unrelated) {
    await page.evaluate(()=>window.PosDeferredClose.flush());
    holdUnrelated=true;
    await page.evaluate(async other=>{
     await window.PosDeferredClose.save({...other,closingCash:'0'});
     window.PosDeferredClose.flush();
    },unrelated);
    await new Promise((resolve,reject)=>{
     const deadline=Date.now()+5000;
     const poll=()=>unrelatedStarted?resolve():Date.now()>deadline?reject(Error('Unrelated retry did not start')):setTimeout(poll,20);
     poll();
    });
   }
   blockSync=false;
   if(entry==='qapps') {
    await context.setOffline(true);await context.setOffline(false);
    const deadline=Date.now()+15000;let synced;
    do {
     const local=await stored();
     synced=!!local.state.find(row=>row.key==='session-close:'+original.sessionId)?.value.syncedAt&&
      local.queue.length===0&&drawer(original.sessionId).status_id==='PsClosed';
     if(!synced)await page.waitForTimeout(100);
    }while(!synced&&Date.now()<deadline);
    check('Reconnection automatically syncs bills and closes the old drawer from the selector without a manual sync',
     synced,{session:drawer(original.sessionId).status_id,
      close:(await stored()).state.find(row=>row.key==='session-close:'+original.sessionId)?.value});
   }
   await page.locator('#OpenSessionForm button[type=submit]').click();
   await page.waitForURL(url=>url.searchParams.has('sessionId')&&url.searchParams.get('sessionId')!==original.sessionId);
   newSessionId=new URL(page.url()).searchParams.get('sessionId');
   await page.locator('#cartInlineSearch').waitFor();
   const old=drawer(original.sessionId),fresh=drawer(newSessionId),local=await stored();
   check(layout+' '+entry+' opens a new billing session after automatic reconciliation without the old popup',
    old.status_id==='PsClosed'&&fresh.status_id==='PsOpen'&&Number(fresh.opening_cash)===25&&
    openRequests===1&&await page.locator('#posSessionClosed').count()===0,{old:old.status_id,fresh:fresh.status_id,openRequests});
   check('Reopening preserves the old bill and reconciles its actual closing cash exactly once',
    Number(old.closing_cash)===100&&Number(old.expected_cash)===100&&Number(old.cash_difference)===0&&
    Number(q(`SELECT count(*) AS n FROM pos_transaction WHERE session_id='${original.sessionId}' AND status_id='PtCompleted'`)[0].n)===1&&
    local.queue.length===0&&!!local.state.find(row=>row.key==='session-close:'+original.sessionId)?.value.syncedAt);
   if(unrelated) {
    check('Opening this counter does not wait for an unrelated counter retry',holdUnrelated&&drawer(unrelated.sessionId).status_id==='PsOpen');
    holdUnrelated=false;releaseUnrelated();
    await page.evaluate(()=>window.PosDeferredClose.flush());
   }
   // A lost acknowledgement must not block a new shift when the server is already closed.
   blockSync=true;
   await page.evaluate(id=>new Promise((resolve,reject)=>{
    const who=document.getElementById('pos-sync-context').dataset;
    const request=indexedDB.open('ZenithPosOffline-'+encodeURIComponent(who.organization),2);
    request.onsuccess=()=>{
     const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),r=store.get('session-close:'+id);
     r.onsuccess=()=>{delete r.result.value.syncedAt;r.result.value.error='Disposable lost acknowledgement';store.put(r.result)};
     tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
    };request.onerror=()=>reject(request.error);
   }),original.sessionId);
   await page.goto(base+'/apps/zenith/pos/Terminal?chooseTerminal=Y');
   await page.locator('#OpenSessionForm [name=terminalId]').selectOption(terminalId);
   await page.locator('#OpenSessionForm button[type=submit]').click();
   await page.waitForURL(url=>url.searchParams.get('sessionId')===newSessionId);
   check('An old unsynchronized acknowledgement never blocks an already-retired drawer',await page.locator('#posSessionClosed').count()===0);
   blockSync=false;
   const resumed=await invoke('open',{terminalId,openingCash:'0'});
   check('An active session without a pending close still resumes normally',resumed.sessionId===newSessionId);
   if(out)await page.screenshot({path:path.join(out,'deferred-close-reopened-'+layout+'-'+entry+'.png')});
  } catch(error) {
   if(out)await page.screenshot({path:path.join(out,'deferred-reopen-failure.png'),fullPage:true}).catch(()=>{});
   console.error((await page.locator('body').innerText()).slice(-3500));
   throw error;
  } finally {
   blockSync=false;holdUnrelated=false;releaseUnrelated();await context.setOffline(false);await context.close();
   for(const id of [original.sessionId,newSessionId,unrelated?.sessionId].filter(Boolean))if(drawer(id)?.status_id==='PsOpen')
    await invoke('close',{sessionId:id,closingCash:id===newSessionId?'25':'0'});
  }
 }
};
