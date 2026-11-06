const {randomUUID}=require('node:crypto');
module.exports=async function({a,base,check,q,invoke,post,out}) {
 const terminalId='POS_QA_RECOVERY_'+randomUUID().slice(0,8);
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable checkout recovery',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const {sessionId}=await invoke('open',{terminalId,openingCash:'0'});
 let {transactionId}=await invoke('cart',{sessionId});
 const page=await a.c.newPage();
 const payments=()=>q(`SELECT amount FROM pos_payment WHERE transaction_id='${transactionId}'`);
 const lines=()=>q(`SELECT unit_price,quantity,manual_price FROM pos_transaction_item WHERE transaction_id='${transactionId}' ORDER BY item_seq_id`);
 const api=async params=>(await post('Terminal','ajaxCart',{sessionId,transactionId,taxOn:'N',...params})).json();
 const terminal=base+'/apps/zenith/pos/Terminal?sessionId='+sessionId+'&taxOn=N';
 try {
  for(const [productId,quantity,price] of [['POS_QA_A_P18','0.25','240'],['POS_QA_A_P5','4','146'],['POS_QA_A_NOWS','0.75','100'],['POS_QA_A_BREAK','0.2','140']]) {
   await invoke('add',{transactionId,productId,quantity,taxOn:'N'});
   const seq=q(`SELECT item_seq_id FROM pos_transaction_item WHERE transaction_id='${transactionId}' AND product_id='${productId}'`)[0].item_seq_id;
   const selected=await api({action:'setItemMode',itemSeqId:seq,itemMode:'RETAIL'});
   check('selecting a mode does not activate a price lock',selected.success&&
    q(`SELECT manual_price FROM pos_transaction_item WHERE transaction_id='${transactionId}' AND item_seq_id='${seq}'`)[0].manual_price==='N');
   const result=await api({action:'updatePrice',itemSeqId:seq,newPrice:price});
   check('fractional/manual line saves '+productId,result.success);
  }
  const {heldId}=await invoke('hold',{transactionId});
  await post('PosQaAcceptance','idleClock',{sessionId,minutes:'61'});
  const idle=await (await post('Terminal','closeIdleSession',{sessionId})).json();
  check('a long-held bill keeps its session open',!idle.closed&&idle.reason==='held_bill');
  await invoke('recall',{heldId,sessionId});
  const initialRevision=page.waitForResponse(r=>r.url().endsWith('/catalogRevision'));
  await page.goto(terminal);
  check('initial catalog verification succeeds',(await (await initialRevision).json()).success);
  await page.locator('.pos-cart .aj-p').first().waitFor();
  check('recalled bill has editable modes without lock/reset controls',
   await page.locator('.pos-cart select').count()===4&&
   !/[🔒]|Auto \(reset\)/.test(await page.locator('.pos-cart').innerText()));
  const saved=JSON.stringify(lines());
  const duringEdit=await post('PosQaAcceptance','rotateBrowserSession');
  check('browser session renews while a held bill remains on screen',(await duringEdit.json()).rotated);
  a.t=duringEdit.headers()['x-csrf-token'];
  const editReplies=[];
  page.on('response',response=>{
   if(response.url().endsWith('/ajaxCart')&&new URLSearchParams(response.request().postData()||'').get('action')==='updatePrice')editReplies.push(response.status());
  });
  const rate=page.locator('.pos-cart .aj-p').first();
  const editSaved=page.waitForResponse(response=>response.url().endsWith('/ajaxCart')&&response.status()===200&&
   new URLSearchParams(response.request().postData()||'').get('action')==='updatePrice',{timeout:8000});
  await rate.fill('241');
  await editSaved;
  check('a rejected stale-token rate edit recovers once and saves the typed rate',editReplies.join(',')==='401,200'&&Number(lines()[0].unit_price)===241);
  const restored=page.waitForResponse(response=>response.url().endsWith('/ajaxCart')&&
   new URLSearchParams(response.request().postData()||'').get('action')==='updatePrice');
  await rate.fill('240');await restored;
  let failures=0;
  await page.route('**/Terminal/catalogRevision',route=>{
   if(failures++===0)return route.fulfill({status:503,contentType:'text/html',body:'Temporary upstream failure'});
   return route.continue();
  });
  await page.locator('#pos-pay-cash').click();
  const cash=page.locator('.pos-cash-panel,#posCashTenderOverlay');
  await cash.waitFor({timeout:8000});
  check('a transient price-check failure recovers without leaving billing',failures===2&&payments().length===0);
  await cash.locator('.pos-cash-cancel,#posCashCancel').click();
  await page.unroute('**/Terminal/catalogRevision');
  for(const failure of ['unavailable','denied','validation']) {
   let calls=0;
   await page.route('**/Terminal/catalogRevision',route=>{
    calls++;
    return route.fulfill(failure==='validation'?
     {json:{success:false,error:'Synthetic unavailable product price'}}:
     {status:failure==='denied'?403:503,contentType:'text/html',body:'Synthetic refusal'});
   });
   await page.locator('#pos-pay-cash').click();
   await page.getByText(failure==='denied'?'Access to this POS session was denied.':
    failure==='validation'?'Synthetic unavailable product price':'Could not verify product prices. Try again.',{exact:true}).waitFor();
   check('failed verification releases checkout without taking payment: '+failure,
    calls===(failure==='unavailable'?2:1)&&payments().length===0&&JSON.stringify(lines())===saved);
   await page.unroute('**/Terminal/catalogRevision');
   await page.locator('#pos-pay-cash').click();
   await cash.waitFor({timeout:8000});
   await cash.locator('.pos-cash-cancel,#posCashCancel').click();
  }
  const rotated=await post('PosQaAcceptance','rotateBrowserSession');
  check('the disposable browser session rotates its CSRF token',(await rotated.json()).rotated);
  a.t=rotated.headers()['x-csrf-token'];
  await page.locator('#pos-pay-cash').click();
  await cash.waitFor({timeout:8000});
  check('checkout renews a stale form token without losing the held cart',JSON.stringify(lines())===saved&&payments().length===0);
  await cash.locator('.pos-cash-input,#posCashRecv').fill('800');
  const duringTender=await post('PosQaAcceptance','rotateBrowserSession');
  check('browser session can renew while Cash is already open',(await duringTender.json()).rotated);
  a.t=duringTender.headers()['x-csrf-token'];
  const paid=page.waitForResponse(r=>r.url().endsWith('/payAndComplete'));
  await cash.locator('.pos-cash-confirm,#posCashConfirm').click();
  const result=await (await paid).json();
  check('the old held bill completes once at the saved total',result.success&&payments().length===1&&Number(payments()[0].amount)===747);
  await page.locator('.pos-cart .aj-p').waitFor({state:'detached'});
  if(out)await page.screenshot({path:require('node:path').join(out,'held-checkout-recovered.png')});
  const beforeHistory=await post('PosQaAcceptance','rotateBrowserSession');
  check('browser session renews before opening Bill History',(await beforeHistory.json()).rotated);
  a.t=beforeHistory.headers()['x-csrf-token'];
  const historyReplies=[];
  page.on('response',response=>{
   if(response.url().endsWith('/ajaxCart')&&new URLSearchParams(response.request().postData()||'').get('action')==='billHistory')historyReplies.push(response.status());
  });
  await page.locator('#pos-history-btn').click();
  const history=page.getByRole('dialog',{name:'Bill history'});
  await history.locator('.hist-bill-row').first().waitFor({timeout:8000});
  check('Bill History recovers the rotated token without leaving POS',historyReplies.join(',')==='401,200'&&payments().length===1);
  await history.locator('#hist-close').click();
  historyReplies.length=0;
  await page.evaluate(()=>{document.querySelector('#cartInlineAddForm [name=moquiSessionToken]').value='STALE-FORM-TOKEN';});
  await page.locator('#pos-history-btn').click();
  await history.locator('.hist-bill-row').first().waitFor({timeout:8000});
  check('history also repairs an old form when the till already has the current token',historyReplies.join(',')==='401,200');
  await history.locator('#hist-close').click();
  ({transactionId}=await invoke('cart',{sessionId}));
  await invoke('add',{transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await page.goto(terminal);
  await page.locator('#pos-credit').click();
  await page.locator('#credit-name').fill('Disposable recovery customer');
  await page.locator('#credit-phone').fill('9000000087');
  await page.waitForFunction(()=>!document.getElementById('credit-confirm').disabled);
  const duringCredit=await post('PosQaAcceptance','rotateBrowserSession');
  check('browser session renews with Credit open',(await duringCredit.json()).rotated);
  a.t=duringCredit.headers()['x-csrf-token'];
  const credit=page.waitForResponse(r=>r.url().endsWith('/completeCredit')&&r.request().method()==='POST');
  await page.locator('#credit-confirm').click();
  const issued=await credit;
  const row=q(`SELECT status_id,is_credit,payable_amount FROM pos_transaction WHERE transaction_id='${transactionId}'`)[0];
  check('Credit submits with the refreshed token and correct balance',issued.status()===302&&row.status_id==='PtCompleted'&&row.is_credit==='Y'&&Number(row.payable_amount)===100);
 } catch(error) {
  console.error('Checkout recovery browser:',(await page.locator('body').innerText()).slice(-1300));
  if(out)await page.screenshot({path:require('node:path').join(out,'held-checkout-failure.png')});
  throw error;
 } finally {
  await page.close();
  if(q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${transactionId}'`)[0]?.status_id==='PtCreated')await invoke('void',{transactionId});
  await invoke('close',{sessionId,closingCash:'0'});
 }
};
