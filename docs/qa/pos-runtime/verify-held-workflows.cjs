module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 const terminalId='POS_QA_A_HELD_FLOW';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable held workflow counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',regionGeoId:'33',stateCode:'33',isActive:'Y'});
 // Earlier deletion tests intentionally remove the shared Employee mode. Use an owned
 // custom definition instead of undoing those shop policies or depending on test order.
 await post('SalesMode','createMode',{modeName:'Synthetic held custom',modeCode:'QAHLD',priceSource:'PpsFixedProduct',minOrderAmount:'0',requireCustomer:'N'});
 const customMode=q("SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id='POS_QA_A' AND mode_code='QAHLD'")[0]?.sales_mode_id;
 check('held workflow creates an isolated custom mode',!!customMode);
 await invoke('price',{productId:'POS_QA_A_P18',salesModeId:customMode,price:'80'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const tx=id=>q(`SELECT * FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const page=await a.c.newPage();
 try{
  for(const [saved,next,price] of [['RETAIL','WHOLESALE',100],['WHOLESALE',customMode,90],[customMode,'RETAIL',80]]){
   const bill=await invoke('cart',{sessionId:session.sessionId});
   await invoke('add',{transactionId:bill.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:saved,taxOn:'N'});
   check(saved+' bill stores the selected mode when its first item is added',tx(bill.transactionId).sales_mode_id===saved);
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${bill.transactionId}&salesModeId=${saved}&taxOn=N`,{waitUntil:'networkidle'});
   const held=await invoke('hold',{transactionId:bill.transactionId});
   if (foreign && saved==='RETAIL') {
    const denied=await post('Terminal','ajaxCart',{action:'recallSale',sessionId:session.sessionId,heldId:held.heldId},foreign);
    check('Another organization cannot recall or alter the held draft',denied.status()===403&&tx(bill.transactionId).status_id==='PtHeld');
   }
   const other=await invoke('cart',{sessionId:session.sessionId});
   await invoke('reprice',{transactionId:other.transactionId,salesModeId:next,taxOn:'N'});
   await invoke('add',{transactionId:other.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:next,taxOn:'N'});
   const amount=tx(other.transactionId).payable_amount;
   await invoke('pay',{transactionId:other.transactionId,paymentMethod:'Card',amount:String(amount)});
   await invoke('complete',{transactionId:other.transactionId});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&salesModeId=${next}&taxOn=Y`,{waitUntil:'networkidle'});
   await page.locator('#pos-held-wrap summary').click();
   await page.locator(`form[action$="/recallSale"]:has(input[name=heldId][value="${held.heldId}"]) button`).click();
   await page.waitForFunction(id=>new URL(location.href).searchParams.get('transactionId')===id&&!!document.querySelector('.pos-cart .aj-qi'),bill.transactionId);
   const persisted=tx(bill.transactionId),line=q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${bill.transactionId}'`)[0];
   check(saved+' recalled after '+next+' preserves its saved mode, rate and tax off',persisted.sales_mode_id===saved&&Number(line.unit_price)===price&&Number(persisted.total_tax_amount)===0,{mode:persisted.sales_mode_id,price:line.unit_price,tax:persisted.total_tax_amount});
   check(saved+' recalled client agrees with persisted mode',await page.locator('#cartInlineAddForm [name=salesModeId]').inputValue()===saved);
   if(out&&saved==='RETAIL')await page.screenshot({path:require('node:path').join(out,'recalled-retail.png'),fullPage:true});
   await page.locator('.nb-customer-picker:visible, .nb-customer__change:visible').click();
   const selected=page.waitForResponse(r=>r.url().includes('/setCustomer')&&r.request().method()==='POST');
   await page.locator('.cust-row[data-pid="POS_QA_A_CUST_SAME"]').click();
   const customer=await (await selected).json();
   check(saved+' recalled bill persists selected customer',customer.success&&tx(bill.transactionId).customer_party_id==='POS_QA_A_CUST_SAME',customer);
   await invoke('pay',{transactionId:bill.transactionId,paymentMethod:'UPI',amount:String(price)});
   await invoke('complete',{transactionId:bill.transactionId});
  }
  // A global legacy mode minimum must not opt a shop into an order policy.
  check('shop has no inherited minimum-order policy',q("SELECT * FROM pos_sales_mode_org_config WHERE organization_party_id='POS_QA_A' AND sales_mode_id='WHOLESALE'").length===0);
  const policyBill=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:policyBill.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:'WHOLESALE',taxOn:'N'});
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${policyBill.transactionId}&salesModeId=WHOLESALE&taxOn=N`,{waitUntil:'networkidle'});
  await post('SalesMode','saveOrgRule',{salesModeId:'WHOLESALE',requireCustomer:'N',minOrderAmount:'10000'});
  const deniedMinimum=await post('PosQaAcceptance','invoke',{op:'pay',transactionId:policyBill.transactionId,paymentMethod:'Card',amount:'90'});
  check('explicit shop minimum still blocks an under-limit sale',(await deniedMinimum.json()).errors?.length>0&&Number(tx(policyBill.transactionId).paid_amount)===0);
  await post('SalesMode','saveOrgRule',{salesModeId:'WHOLESALE',requireCustomer:'Y',minOrderAmount:'0'});
  const deniedCustomer=await post('PosQaAcceptance','invoke',{op:'pay',transactionId:policyBill.transactionId,paymentMethod:'Card',amount:'90'});
  check('explicit shop customer requirement remains enforced',(await deniedCustomer.json()).errors?.length>0&&Number(tx(policyBill.transactionId).paid_amount)===0);
  const attached=await post('Terminal','setCustomer',{transactionId:policyBill.transactionId,sessionId:session.sessionId,customerPartyId:'POS_QA_A_CUST_SAME'});
  check('shop customer requirement can be fulfilled',(await attached.json()).success);
  await invoke('pay',{transactionId:policyBill.transactionId,paymentMethod:'Card',amount:'90'});
  await invoke('complete',{transactionId:policyBill.transactionId});
  check('zero shop minimum permits wholesale checkout below 10000',tx(policyBill.transactionId).status_id==='PtCompleted'&&Number(tx(policyBill.transactionId).payable_amount)===90);
  await post('SalesMode','deleteOrgRule',{salesModeId:'WHOLESALE'});
  const heldBill=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:heldBill.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  const held=await invoke('hold',{transactionId:heldBill.transactionId});
  if(foreign){
   const denied=await post('Terminal','closeSession',{sessionId:session.sessionId,closingCash:'0',wantJson:'1'},foreign);
   check('foreign operator cannot close or void another shop held bill',denied.status()===403||!((await denied.text()).includes('"success":true')));
   check('foreign close leaves held draft intact',tx(heldBill.transactionId).status_id==='PtHeld');
  }
  const completed=q(`SELECT transaction_id,paid_amount FROM pos_transaction WHERE session_id='${session.sessionId}' AND status_id='PtCompleted'`);
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&taxOn=N`,{waitUntil:'networkidle'});
  await page.locator('.nb-power').click();
  await page.locator('.pos-close-confirm').waitFor();
  if(out)await page.screenshot({path:require('node:path').join(out,'close-with-held-bill.png'),fullPage:true});
  let closeResult;
  // Read the real server reply before the successful UI navigation discards its body.
  await page.route('**/Terminal/closeSession',async route=>{
   const response=await route.fetch();
   closeResult={status:response.status(),body:await response.text()};
   await route.fulfill({response});
  });
  await Promise.all([page.waitForURL(url=>url.pathname.endsWith('/Terminal')&&url.searchParams.get('sessionId')===session.sessionId,{waitUntil:'networkidle'}),page.locator('.pos-close-confirm').click()]);
  await page.locator('.pos-no-session').waitFor();
  const raw=closeResult.body;let result;try{result=JSON.parse(raw)}catch{}
  check('manual close returns JSON and closes a session containing unpaid held bills',result?.success&&q(`SELECT status_id FROM pos_session WHERE session_id='${session.sessionId}'`)[0].status_id==='PsClosed',{status:closeResult.status,body:raw.slice(0,300)});
  check('closing session voids unpaid held draft and its snapshot',tx(heldBill.transactionId).status_id==='PtVoided'&&q(`SELECT status_id FROM pos_held_transaction WHERE held_id='${held.heldId}'`)[0].status_id==='PhVoided');
  check('closing preserves every completed bill and recorded tender',completed.every(t=>tx(t.transaction_id).status_id==='PtCompleted'&&Number(tx(t.transaction_id).paid_amount)===Number(t.paid_amount)));
  check('closing popup returns to the terminal opening screen without an active cart',new URL(page.url()).pathname.endsWith('/Terminal')&&await page.locator('#OpenSessionForm').isVisible()&&await page.locator('#cartInlineAddForm').count()===0);
  if(out)await page.screenshot({path:require('node:path').join(out,'closed-terminal-opening-screen.png'),fullPage:true});
  const retry=await post('Terminal','closeSession',{sessionId:session.sessionId,closingCash:'0',wantJson:'1'});
  check('duplicate manual close is idempotent',(await retry.json()).success);
  const nativeClose=await post('Terminal','closeSession',{sessionId:session.sessionId,closingCash:'0'});
  check('native close fallback uses the same terminal opening destination',nativeClose.status()===302&&new URL(nativeClose.headers().location,base).pathname.endsWith('/Terminal'));
  const paidSession=await invoke('open',{terminalId,openingCash:'0'});
  const paid=await invoke('cart',{sessionId:paidSession.sessionId});
  await invoke('add',{transactionId:paid.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await invoke('pay',{transactionId:paid.transactionId,paymentMethod:'Card',amount:'10'});
  await invoke('hold',{transactionId:paid.transactionId});
  const refused=await post('Terminal','closeSession',{sessionId:paidSession.sessionId,closingCash:'0',wantJson:'1'});
  const refusal=await refused.json();
  check('partially paid held bill rejects close with useful JSON and no financial changes',refusal.success===false&&!!refusal.error&&tx(paid.transactionId).status_id==='PtHeld'&&Number(tx(paid.transactionId).paid_amount)===10&&q(`SELECT status_id FROM pos_session WHERE session_id='${paidSession.sessionId}'`)[0].status_id==='PsOpen',refusal);
 }finally{
  if(out)await page.screenshot({path:require('node:path').join(out,'held-flow-last.png'),fullPage:true});
  await page.close();
 }
};
