// Handoff preserves other counters. Use a dedicated cashier rather than assuming
// opening this terminal silently retired every drawer used by earlier scenarios.
module.exports=async({check,q,invoke,post,account})=>{
 const collector=await account('pos.collector.qa');
 const terminalId='POS_QA_COLLECT_'+Date.now().toString(36);
 const terminal2=terminalId+'_2';
 const sessions=[];
 const session=id=>q(`SELECT * FROM pos_session WHERE session_id='${id}'`)[0];
 const payments=id=>q(`SELECT * FROM pos_payment WHERE transaction_id='${id}' ORDER BY payment_id`);
 const bill=id=>q(`SELECT transaction_id,session_id,transaction_number,status_id,payable_amount,paid_amount,change_amount,is_credit FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const collect=(params,reject=false)=>invoke('settle',params,reject,collector);
 const open=async terminalId=>{
  const row=await invoke('open',{terminalId,openingCash:'100'},false,collector);
  sessions.push(row.sessionId);return row;
 };
 const summary=async sessionId=>{
  const response=await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId},collector);
  const data=await response.json();
  check('collecting drawer summary is available',response.status()===200&&data.success,data);
  return data;
 };
 try {
  for(const id of [terminalId,terminal2]) await post('PosTerminals','createTerminal',{
   terminalId:id,terminalName:'Disposable credit collection',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'
  });
  const before=q("SELECT session_id FROM pos_session WHERE operator_party_id='POS_QA_COLLECTOR' AND status_id='PsOpen'");
  check('late collection starts with no open collecting drawer',before.length===0,before);
  const oldShift=await open(terminalId);
  const later=await invoke('cart',{sessionId:oldShift.sessionId},false,collector);
  await invoke('add',{transactionId:later.transactionId,productId:'POS_QA_A_P18',quantity:'1'},false,collector);
  await invoke('pay',{transactionId:later.transactionId,paymentMethod:'Cash',amount:'50'},false,collector);
  await invoke('credit',{transactionId:later.transactionId,customerName:'Synthetic late collection',customerPhone:'0000000001'},false,collector);
  await invoke('close',{sessionId:oldShift.sessionId,closingCash:'150'},false,collector);
  const closed=JSON.stringify(session(oldShift.sessionId));
  const unpaid=JSON.stringify([bill(later.transactionId),payments(later.transactionId)]);
  const fields={transactionId:later.transactionId,paymentMethod:'Cash',amount:'100'};
  await collect(fields,true);
  await collect({...fields,collectionSessionId:oldShift.sessionId},true);
  check('no-drawer and closed-drawer rejections leave the bill and payments unchanged',
   JSON.stringify([bill(later.transactionId),payments(later.transactionId)])===unpaid);

  const newShift=await open(terminalId);
  const other=await open(terminal2);
  check('opening a second counter preserves the collecting drawer',session(newShift.sessionId).status_id==='PsOpen');
  await collect(fields,true);
  await collect({...fields,collectionSessionId:oldShift.sessionId},true);
  check('ambiguous or explicitly closed collecting drawers never record a payment',
   JSON.stringify([bill(later.transactionId),payments(later.transactionId)])===unpaid);
  await invoke('close',{sessionId:other.sessionId,closingCash:'100'},false,collector);
  // Exactly one valid open drawer may be inferred. Cash is attached to it, never
  // the original closed drawer. The received 100 includes 32 change on the 68 due.
  await collect(fields);
  const payment=payments(later.transactionId).find(p=>p.collection_session_id===newShift.sessionId);
  const cash=await summary(newShift.sessionId);
  check('late credit cash belongs to the open collecting drawer and preview',
   payment?.collection_session_id===newShift.sessionId&&Number(cash.expectedCash)===168&&Number(cash.cashReceived)===100&&Number(cash.changeGiven)===32,
   {payment,preview:cash});
  check('credit collection preserves original bill drawer and number',
   bill(later.transactionId).session_id===oldShift.sessionId&&JSON.parse(unpaid)[0].transaction_number===bill(later.transactionId).transaction_number);
  await invoke('close',{sessionId:newShift.sessionId,closingCash:'168'},false,collector);
  check('old closed drawer is unchanged and collecting drawer reconciles',
   JSON.stringify(session(oldShift.sessionId))===closed&&Number(session(oldShift.sessionId).expected_cash)===150&&Number(session(newShift.sessionId).cash_difference)===0);
 } finally {
  for(const id of sessions) if(session(id)?.status_id==='PsOpen') {
   const cash=await summary(id);
   await invoke('close',{sessionId:id,closingCash:String(cash.expectedCash)},false,collector);
  }
  await collector.c.close();
 }
};
