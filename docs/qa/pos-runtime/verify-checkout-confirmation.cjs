const path=require('node:path');
module.exports=async function({a,base,check,q,invoke,out}) {
 const session=await invoke('open',{terminalId:'POS_QA_A_TERM2',openingCash:'100'});
 const page=await a.c.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.addInitScript(()=>{
  localStorage.setItem('posPrinter','Disposable QA printer');
  window.qaPrints=0;
  window.qz={websocket:{isActive:()=>true},configs:{create:()=>({})},print:()=>{window.qaPrints++;return Promise.resolve();}};
 });
 let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/payAndComplete'))posts++;});
 const ledger=id=>q(`SELECT status_id,paid_amount,change_amount,transaction_number FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const payments=id=>q(`SELECT payment_method,amount FROM pos_payment WHERE transaction_id='${id}'`);
 try {
  for(const method of ['Cash','Card','UPI']) for(const receiptChoice of ['Save','Save and print']) {
   const cart=await invoke('cart',{sessionId:session.sessionId});await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P18',quantity:'1'});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${cart.transactionId}&taxOn=Y`);
   const button=page.locator('#pos-pay-'+method.toLowerCase());
   const overlay=page.locator('#posCashTenderOverlay,.pos-cash-panel').filter({visible:true});
   const received=overlay.locator('#posCashRecv,.pos-cash-input');
   const confirmCash=overlay.locator('#posCashConfirm,.pos-cash-confirm');
   const before=posts;
   if(method==='Cash') {
    await button.click();await overlay.waitFor();
    check('opening Cash leaves the bill unpaid',posts===before&&ledger(cart.transactionId).status_id!=='PtCompleted'&&payments(cart.transactionId).length===0);
    await overlay.locator('#posCashCancel,.pos-cash-cancel').click();await overlay.waitFor({state:'hidden'});
    check('Cash Cancel preserves the unpaid cart',posts===before&&payments(cart.transactionId).length===0);
    await button.click();await overlay.waitFor();
    await received.fill('100');check('short cash cannot be confirmed',await confirmCash.isDisabled());
    await received.fill('200');await page.screenshot({path:path.join(out,'cash-confirmation-before-payment.png')});
   }
   const today=Number(await page.locator('#pos-today-bills').innerText());
   const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/payAndComplete'));
   if(method==='Cash') await confirmCash.click();
   else if(receiptChoice==='Save') {
    await page.locator('.pos-cart-heading h2').click();
    await page.keyboard.press(method==='Card'?'F3':'F5');
   } else await button.click();
   const receipt=page.locator('#posPayConfirmOverlay');
   check(`${method} confirmation completes through real checkout`,(await (await response).json()).success===true);
   await receipt.waitFor();
   const saved=ledger(cart.transactionId),rows=payments(cart.transactionId);
   check(`${method} Payment Complete displays its issued bill number`,saved.status_id==='PtCompleted'&&!!saved.transaction_number&&
    /Payment Complete/i.test(await receipt.innerText())&&(await receipt.innerText()).includes(saved.transaction_number));
   check(`${method} is saved once before either receipt action`,posts===before+1&&rows.length===1&&rows[0].payment_method===method&&
    Number(rows[0].amount)===(method==='Cash'?200:118)&&Number(saved.change_amount||0)===(method==='Cash'?82:0));
   const options=await receipt.getByRole('button').evaluateAll(buttons=>buttons.map(button=>({title:button.textContent.toLowerCase(),
    background:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color})));
   check(`${method} offers only Save and Save & print`,options.length===2&&options[0].title==='save'&&
    options[1].title==='save & print',options);
   check(`${method} initially focuses Save`,await page.locator('#posPaySave').evaluate(button=>document.activeElement===button));
   await page.keyboard.press('ArrowRight');
   check(`${method} Right focuses Save and print`,await page.locator('#posPaySavePrint').evaluate(button=>document.activeElement===button));
   if(receiptChoice==='Save') {
    await page.keyboard.press('ArrowLeft');
    check(`${method} Left returns to Save`,await page.locator('#posPaySave').evaluate(button=>document.activeElement===button));
   }
   await page.keyboard.press('Enter');
   await receipt.waitFor({state:'hidden'});
   await page.waitForFunction(count=>Number(document.querySelector('#pos-today-bills')?.textContent)===count,today+1);
   if(receiptChoice==='Save and print') await page.waitForFunction(()=>window.qaPrints===1);
   check(`${method} ${receiptChoice} produces the selected print count`,
    await page.evaluate(()=>window.qaPrints)===(receiptChoice==='Save'?0:1));
   check(`${method} ${receiptChoice} cannot submit another tender`,posts===before+1&&payments(cart.transactionId).length===1);
  }
  // Product clicks rebuild the summary; its newly generated digital form must still save exactly once.
  await page.locator('.nb-modes summary').click();
  await page.locator('[data-pos-layout=advanced]').click();
  const added=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&r.request().postData()?.includes('action=add'));
  await page.locator('.pos-product-grid form').filter({has:page.locator('input[name=productId][value=POS_QA_A_P18]')}).locator('button[type=submit]').click();await added;
  const draft=q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${session.sessionId}' AND status_id='PtCreated'`)[0];
  const card=page.locator('#pos-pay-card');await card.waitFor();const before=posts;
  await card.click();await page.locator('#posPayConfirmOverlay').waitFor();
  const completed=ledger(draft.transaction_id);
  check('AJAX-rendered Card saves once and displays its issued bill number',posts===before+1&&completed.status_id==='PtCompleted'&&
   completed.transaction_number&&(await page.locator('#posPayConfirmOverlay').innerText()).includes(completed.transaction_number)&&
   payments(draft.transaction_id).length===1);
  await page.locator('#posPaySave').click();
  check('checkout confirmation has no browser exceptions',errors.length===0,{errors});
 } catch(error) {
  await page.screenshot({path:path.join(out,'checkout-confirmation-failure.png'),fullPage:true});throw error;
 } finally {
  await page.close();
  const totals=q(`SELECT sum(p.amount) AS gross FROM pos_payment p JOIN pos_transaction t ON t.transaction_id=p.transaction_id WHERE t.session_id='${session.sessionId}' AND p.payment_method='Cash'`)[0];
  const change=q(`SELECT sum(change_amount) AS change FROM pos_transaction WHERE session_id='${session.sessionId}'`)[0];
  await invoke('close',{sessionId:session.sessionId,closingCash:String(100+Number(totals.gross||0)-Number(change.change||0))});
 }
};
