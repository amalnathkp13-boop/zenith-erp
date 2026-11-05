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
 const ledger=id=>q(`SELECT status_id,paid_amount,change_amount FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const payments=id=>q(`SELECT payment_method,amount FROM pos_payment WHERE transaction_id='${id}'`);
 try {
  for(const [method,receiptChoice] of [['Cash'],['Card'],['UPI','Save'],['UPI','Save and print']]) {
   const cart=await invoke('cart',{sessionId:session.sessionId});await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P18',quantity:'1'});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${cart.transactionId}&taxOn=Y`);
   const button=page.locator('#pos-pay-'+method.toLowerCase()),overlay=page.locator(method==='Cash'?'#posCashTenderOverlay':'#posPayConfirmOverlay');
   const before=posts;await button.click();await overlay.waitFor();await page.waitForTimeout(350);
   check(`${method} opens confirmation without a payment or issued bill`,posts===before&&ledger(cart.transactionId).status_id!=='PtCompleted'&&payments(cart.transactionId).length===0);
   await overlay.getByRole('button',{name:'Cancel',exact:true}).click();
   check(`${method} Cancel preserves the unpaid cart`,posts===before&&payments(cart.transactionId).length===0&&Number(ledger(cart.transactionId).paid_amount||0)===0);
   await button.click();await overlay.waitFor();
   if(method==='Cash') {
    await overlay.locator('#posCashRecv').fill('100');check('short cash cannot be confirmed',await overlay.locator('#posCashConfirm').isDisabled());
    await overlay.locator('#posCashRecv').fill('200');await page.screenshot({path:path.join(out,'cash-confirmation-before-payment.png')});
   }
   const today=Number(await page.locator('#pos-today-bills').innerText());
   const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/payAndComplete'));
   await overlay.locator(method==='Cash'?'#posCashConfirm':'#posPayConfOk').click();
   if(receiptChoice) {
    await overlay.getByRole('button',{name:receiptChoice,exact:true}).waitFor();
    check('UPI confirmation waits for '+receiptChoice+' before posting payment',posts===before&&payments(cart.transactionId).length===0);
    await overlay.getByRole('button',{name:receiptChoice,exact:true}).click();
   }
   check(`${method} confirmation completes through real checkout`,(await (await response).json()).success===true);
   await page.waitForFunction(count=>Number(document.querySelector('#pos-today-bills')?.textContent)===count,today+1);
   if(receiptChoice==='Save and print') await page.waitForFunction(()=>window.qaPrints===1);
   if(receiptChoice) check('UPI '+receiptChoice+' produces the selected print count',
    await page.evaluate(()=>window.qaPrints)===(receiptChoice==='Save'?0:1));
   const rows=payments(cart.transactionId),saved=ledger(cart.transactionId);
   check(`${method} Confirm submits exactly once with the entered tender`,posts===before+1&&rows.length===1&&rows[0].payment_method===method&&Number(rows[0].amount)===(method==='Cash'?200:118)&&saved.status_id==='PtCompleted'&&Number(saved.change_amount||0)===(method==='Cash'?82:0));
  }
  // Product clicks rebuild the summary; its newly generated digital form must retain the gate.
  await page.locator('.nb-modes summary').click();
  await page.locator('[data-pos-layout=advanced]').click();
  const added=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&r.request().postData()?.includes('action=add'));
  await page.locator('.pos-product-grid form').filter({has:page.locator('input[name=productId][value=POS_QA_A_P18]')}).locator('button[type=submit]').click();await added;
  const card=page.locator('#pos-pay-card');await card.waitFor();const before=posts;
  await card.click();await page.locator('#posPayConfirmOverlay').waitFor();await page.waitForTimeout(350);
  check('AJAX-rendered Card keeps confirmation and sends no premature checkout',posts===before);
  check('AJAX Card confirmation shows the actual payable amount',(await page.locator('#posPayConfirmOverlay').innerText()).includes('118'));
  await page.locator('#posPayConfCancel').click();
  const draft=q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${session.sessionId}' AND status_id='PtCreated'`)[0];
  check('AJAX Card Cancel preserves the current unpaid cart',!!draft&&payments(draft.transaction_id).length===0);
  await invoke('void',{transactionId:draft.transaction_id});
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
