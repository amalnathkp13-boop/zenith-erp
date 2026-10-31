const path=require('node:path');
module.exports=async function({a,base,check,q,invoke,post,out}) {
 const terminal='POS_QA_A_LAST_TERM';
 await post('PosTerminals','createTerminal',{terminalId:terminal,terminalName:'Disposable last-bill regression',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',regionGeoId:'33',countryGeoId:'IND',isActive:'Y'});
 const session=await invoke('open',{terminalId:terminal,openingCash:'100'});
 const older=await invoke('cart',{sessionId:session.sessionId});
 await invoke('add',{transactionId:older.transactionId,productId:'POS_QA_A_P18',quantity:'1'});
 const held=await invoke('hold',{transactionId:older.transactionId,holdReason:'Disposable later-completion regression'});
 const newer=await invoke('cart',{sessionId:session.sessionId});
 await invoke('add',{transactionId:newer.transactionId,productId:'POS_QA_A_P5',quantity:'1'});
 const page=await a.c.newPage();page.setDefaultTimeout(60000);await page.setViewportSize({width:1440,height:1000});
 const record=id=>q(`SELECT transaction_id,transaction_number,entry_date,completed_date,payable_amount,paid_amount,status_id FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{errors.push(dialog.message());dialog.dismiss();});
 async function checkout(cart,amount) {
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${cart.transactionId}&taxOn=Y&salesModeId=RETAIL`);
  await page.locator('#pos-pay-cash').click();await page.locator('#posCashRecv').fill(String(amount));
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/payAndComplete'));
  await page.locator('#posCashConfirm').click();check('cashier checkout returns a completed bill',(await (await response).json()).success===true);
  for(let i=0;i<100&&record(cart.transactionId).status_id!=='PtCompleted';i++)await page.waitForTimeout(100);
  const saved=record(cart.transactionId);check('last-bill fixture really completed in the ledger',saved.status_id==='PtCompleted'&&Number(saved.payable_amount)===amount&&Number(saved.paid_amount)===amount);
  await page.waitForFunction(number=>document.getElementById('pos-bill-badge')?.textContent.includes(number),saved.transaction_number);
  check('AJAX checkout refreshes Last bill number and amount',await page.locator('#pos-last-completed').innerText()===`Last amount: ${amount.toFixed(2)}`);
  check('header also shows the most recently completed bill',await page.locator('#pos-bill-badge').innerText()===saved.transaction_number);
  check('completed checkout removes the old cart ID from the refresh URL',!new URL(page.url()).searchParams.has('transactionId'));
  return saved;
 }
 try {
  const first=await checkout(newer,210);
  await invoke('recall',{heldId:held.heldId,sessionId:session.sessionId});
  const last=await checkout(older,118);
  check('the older cart really finishes after the newer cart',last.entry_date<first.entry_date&&last.completed_date>first.completed_date);
  for(const mode of ['normal','advanced']) {
   await page.evaluate(mode=>{if(document.body.classList.contains('pos-mode-normal')!==(mode==='normal'))window.posToggleLayout();},mode);
   check(`${mode} layout preserves Last after an empty-cart render`,await page.locator('#pos-last-completed').innerText()===`Last amount: 118.00`);
  }
  const frozen=JSON.stringify([record(older.transactionId),record(newer.transactionId)]);
  await page.reload();await page.locator('#pos-last-completed').waitFor();
  check('Last uses completion order after refresh',await page.locator('#pos-last-completed').innerText()===`Last amount: 118.00`);
  check('refresh retains an empty new cart with zero payable',await page.locator('.pos-sum-total').innerText().then(text=>/₹0(?:\.00)?\s*$/.test(text)));
  await page.screenshot({path:path.join(out,'last-completed-bill-after-recall.png')});
  await page.locator('#cartInlineSearch').fill('POS_QA_A_P18');
  await page.locator('#cartSearchDropdown .cart-dd-item[data-pid="POS_QA_A_P18"]').waitFor();
  const added=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
  await page.locator('#cartInlineSearch').press('Enter');await added;
  await page.waitForFunction(()=>document.querySelector('#pos-side-item-count')?.innerText==='Subtotal (1 item)');
  check('ordinary AJAX product add preserves the last completed summary',await page.locator('#pos-last-completed').innerText()===`Last amount: 118.00`);
  const draft=q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${session.sessionId}' AND status_id='PtCreated'`)[0];
  check('product after checkout belongs to one new unissued cart',!!draft&&q(`SELECT product_id,quantity FROM pos_transaction_item WHERE transaction_id='${draft.transaction_id}'`).length===1);
  const removed=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='removeItem');
  await page.locator('.pos-cart .aj-rm').click();await removed;
  await page.waitForFunction(()=>document.querySelector('#pos-side-item-count')?.innerText==='Subtotal (0 items)');
  check('ordinary AJAX remove preserves Last on the empty new cart',await page.locator('#pos-last-completed').innerText()===`Last amount: 118.00`);
  await invoke('void',{transactionId:draft.transaction_id});
  check('Last display changes no issued bill number or amount',JSON.stringify([record(older.transactionId),record(newer.transactionId)])===frozen);
  check('last-bill checkout and layout updates have no browser errors',errors.length===0,{errors});
 } catch(error) {
  await page.screenshot({path:path.join(out,'last-bill-failure.png'),fullPage:true,timeout:5000}).catch(()=>{});
  error.message+=`; URL=${page.url()}; body=${(await page.locator('body').innerText({timeout:5000}).catch(()=>'' )).slice(-1200)}`;
  throw error;
 } finally {await page.close();}
};
