// A pending or failed line edit may never be charged at the previous amount.
module.exports=async function({a,base,check,q,invoke,post,out}){
 const terminalId='POS_QA_RATE_SYNC';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable edit synchronization',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const page=await a.c.newPage();page.setDefaultTimeout(15000);page.on('dialog',d=>d.dismiss());
 await page.addInitScript(()=>{localStorage.setItem('posPrinter','Synthetic QA printer');window.__jobs=[];window.qz={websocket:{isActive:()=>true},configs:{create:()=>({})},print:(_cfg,data)=>{window.__jobs.push(data);return Promise.resolve();}};});
 let mode='slow',payRequests=0;
 await page.route('**/Terminal/ajaxCart',async route=>{
  const params=new URLSearchParams(route.request().postData()||'');
  if(params.get('action')!=='updatePrice')return route.continue();
  if(mode==='slow'){await new Promise(resolve=>setTimeout(resolve,600));return route.continue();}
  return route.fulfill({contentType:'application/json',body:JSON.stringify({success:false,error:'Synthetic rejected rate save'})});
 });
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/payAndComplete'))payRequests++;});
 const read=id=>q(`SELECT status_id,payable_amount,paid_amount FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 try{
  for(const [index,method] of ['Cash','Card','UPI'].entries()){
   const tx=await invoke('cart',{sessionId:session.sessionId});
   await invoke('add',{transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${tx.transactionId}&taxOn=N`);
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
  const add=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
  await page.locator('.nb-modes summary').click();await page.locator('[data-pos-layout=advanced]').click();
  await page.locator('.pos-product-grid form:has(input[name=productId][value=POS_QA_A_P18]) button').click();
  const rejectedTx=(await (await add).json()).transactionId;
  await page.locator('.aj-p').fill('50');await page.locator('#pos-pay-card').click();await page.locator('#posPayConfOk').click();
  await page.waitForTimeout(900);
  check('a rejected background rate blocks payment entirely',payRequests===3&&read(rejectedTx).status_id==='PtCreated'&&Number(read(rejectedTx).paid_amount)===0,read(rejectedTx));
  if(out)await page.screenshot({path:require('node:path').join(out,'rate-sync-error-blocked.png')});
  await invoke('void',{transactionId:rejectedTx});
  mode='slow';
  const heldTx=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:heldTx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${heldTx.transactionId}&taxOn=N`);
  await page.locator('.aj-p').fill('66');
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.locator('#pos-hold').click()]);
  const held=q(`SELECT held_id,items_json FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld' ORDER BY held_id DESC`)[0];
  check('Hold waits for a typed rate and submits even when rendering replaced its form',read(heldTx.transactionId).status_id==='PtHeld'&&Number(JSON.parse(held.items_json)[0].unitPrice)===66,held);
  await invoke('recall',{heldId:held.held_id,sessionId:session.sessionId});
  check('recalling the held bill preserves that edited rate',Number(q(`SELECT unit_price FROM pos_transaction_item WHERE transaction_id='${heldTx.transactionId}'`)[0].unit_price)===66);
  await invoke('void',{transactionId:heldTx.transactionId});

 }finally{await page.close();await invoke('close',{sessionId:session.sessionId,closingCash:'73'});}
};
