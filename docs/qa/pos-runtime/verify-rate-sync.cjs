// A pending or failed line edit may never be charged at the previous amount.
module.exports=async function({a,base,check,q,invoke,post,out}){
 const terminalId='POS_QA_RATE_SYNC';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable edit synchronization',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const page=await a.c.newPage();page.setDefaultTimeout(15000);page.on('dialog',d=>d.dismiss());
 await page.addInitScript(()=>{localStorage.setItem('posPrinter','Synthetic QA printer');window.__jobs=[];window.qz=window.__qaQzStub={websocket:{isActive:()=>true},configs:{create:()=>({})},print:(_cfg,data)=>{window.__jobs.push(data);return Promise.resolve();}};});
 let mode='slow',payRequests=0;
 let releaseRejectedRate;
 const rejectRate=new Promise(resolve=>{releaseRejectedRate=resolve;});
 const isCartAction=(request,action)=>request.url().includes('/Terminal/ajaxCart')&&
  new URLSearchParams(request.postData()||'').get('action')===action;
 await page.route('**/Terminal/ajaxCart',async route=>{
  if(!isCartAction(route.request(),'updatePrice'))return route.continue();
  if(mode==='slow'){await new Promise(resolve=>setTimeout(resolve,600));return route.continue();}
  await rejectRate;
  return route.fulfill({contentType:'application/json',body:JSON.stringify({success:false,error:'Synthetic rejected rate save'})});
 });
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/payAndComplete'))payRequests++;});
 const read=id=>q(`SELECT status_id,payable_amount,paid_amount FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 try{
  for(const [index,method] of ['Cash','Card','UPI'].entries()){
   const tx=await invoke('cart',{sessionId:session.sessionId});
   await invoke('add',{transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${tx.transactionId}&taxOn=N`);
   check(method+' rate synchronization uses an isolated printer stub',await page.evaluate(()=>window.qz===window.__qaQzStub));
   await page.locator('.aj-p').fill('73');await page.locator('#pos-pay-'+method.toLowerCase()).click();
   const overlay=page.locator(method==='Cash'?'#posCashTenderOverlay':'#posPayConfirmOverlay');await overlay.waitFor();
   check(method+' confirmation uses the rate saved before opening',(await overlay.innerText()).includes('73'));
   if(method==='Cash')await page.locator('#posCashRecv').fill('73');
   const paid=page.waitForResponse(r=>r.url().includes('/payAndComplete'));
   await page.locator(method==='Cash'?'#posCashConfirm':'#posPayConfOk').click();
   const receipt=await (await paid).json();await page.waitForFunction(()=>window.__jobs.length===1);
   check(method+' checkout waits for a rate typed without Enter',Number(read(tx.transactionId).paid_amount)===73&&Number(read(tx.transactionId).payable_amount)===73&&payRequests===index+1,read(tx.transactionId));
   check(method+' receipt uses the persisted edited rate',Number(receipt.items[0].rate)===73);
  }
  mode='reject';
  // A new cart seeded by a product tap exercises the optimistic queue, rather than the re-entry fallback.
  const add=page.waitForResponse(r=>isCartAction(r.request(),'addItem'));
  await page.locator('.nb-modes summary').click();await page.locator('[data-pos-layout=advanced]').click();
  await page.locator('.pos-product-grid form:has(input[name=productId][value=POS_QA_A_P18]) button').click();
  const rejectedTx=(await (await add).json()).transactionId;
  const sent=page.waitForRequest(request=>isCartAction(request,'updatePrice'));
  const rejected=page.waitForResponse(response=>isCartAction(response.request(),'updatePrice'));
  await page.locator('.aj-p').fill('50');
  await sent;
  await page.locator('#pos-pay-card').click();
  check('checkout does not open confirmation or submit payment while a rate is pending',
   await page.locator('#posPayConfirmOverlay').count()===0&&payRequests===3);
  releaseRejectedRate();
  await rejected;
  await page.waitForFunction(()=>document.querySelector('.aj-p')?.value==='100');
  check('a rejected background rate blocks payment and restores the saved rate',
   await page.locator('#posPayConfirmOverlay').count()===0&&payRequests===3&&read(rejectedTx).status_id==='PtCreated'&&Number(read(rejectedTx).paid_amount)===0,read(rejectedTx));
  if(out)await page.screenshot({path:require('node:path').join(out,'rate-sync-error-blocked.png')});
  await invoke('void',{transactionId:rejectedTx});
  mode='slow';
  const heldTx=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:heldTx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${heldTx.transactionId}&taxOn=N`);
  await page.locator('.aj-p').fill('66');
  await page.locator('#pos-hold').click();
  await page.waitForFunction(()=>document.querySelector('#pos-held-wrap .nb-cnt')?.textContent==='1');
  const held=q(`SELECT held_id,items_json FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld' ORDER BY held_id DESC`)[0];
  check('Hold waits for a typed rate and submits even when rendering replaced its form',read(heldTx.transactionId).status_id==='PtHeld'&&Number(JSON.parse(held.items_json)[0].unitPrice)===66,held);
  await page.keyboard.press('F9');
  await page.locator(`form[action$="/recallSale"]:has(input[name=heldId][value="${held.held_id}"]) button`).click();
  await page.waitForFunction(()=>document.querySelector('.aj-p')?.value==='66');
  check('recalling the held bill preserves that edited rate',read(heldTx.transactionId).status_id==='PtCreated'&&Number(q(`SELECT unit_price FROM pos_transaction_item WHERE transaction_id='${heldTx.transactionId}'`)[0].unit_price)===66);
  await invoke('void',{transactionId:heldTx.transactionId});

 }finally{releaseRejectedRate();await page.close();await invoke('close',{sessionId:session.sessionId,closingCash:'73'});}
};
