const { randomUUID } = require('node:crypto');

// Use the real checkout and sync transitions against disposable counter sessions.
module.exports = async function ({a, foreign, base, check, q, invoke, post}) {
 const suffix = randomUUID().slice(0,8);
 const terminalId = 'QA_RECONCILE_'+suffix;
 const trackedProduct = 'POS_QA_A_STOCK';
 const product = 'POS_QA_A_P18';
 const mode = 'RETAIL';
 const terminal = await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable offline reconciliation counter',
  organizationPartyId:'POS_QA_A',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 check('offline reconciliation fixture counter is available',terminal.status()<400);
 const {sessionId} = await invoke('open',{terminalId,openingCash:'0'});
 const txn = id => q(`SELECT * FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const items = id => q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${id}' ORDER BY item_seq_id`);
 const payments = id => q(`SELECT * FROM pos_payment WHERE transaction_id='${id}' ORDER BY payment_id`);
 const sourceState = id => JSON.stringify([txn(id),items(id),payments(id)]);
 const ledger = id => q(`SELECT status_id,created_transaction_id,item_count FROM pos_offline_transaction
  WHERE terminal_id='${terminalId}' AND transaction_data_json LIKE '%${id}%'`);
 const completed = () => q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${sessionId}'
  AND status_id='PtCompleted' ORDER BY transaction_id`);
 const onHand = () => Number(q(`SELECT sum(quantity_on_hand_total) AS quantity FROM asset
  WHERE product_id='${trackedProduct}' AND owner_party_id='POS_QA_A' AND facility_id='POS_QA_A_FAC'`)[0].quantity);
 const line = (productId,qty=1,price=100) => ({productId,qty,price,mode});
 const customer = {name:'Synthetic reconciliation credit '+suffix,phone:'700'+Date.now().toString().slice(-7),creditDays:7};

 async function makeSource(sid=sessionId, actor=a, productId=product) {
  const {transactionId} = await invoke('cart',{sessionId:sid,reuseOpenCart:false},false,actor);
  await invoke('add',{transactionId,productId,quantity:'1',salesModeId:mode,taxOn:'N'},false,actor);
  const response = await post('Terminal','ajaxCart',{action:'refresh',sessionId:sid,transactionId,taxOn:'N'},actor);
  const snapshot = await response.json();
  check('fixture captured the original server revision',snapshot.success&&snapshot.sourceRevision);
  return {sourceTransactionId:transactionId,sourceRevision:snapshot.sourceRevision};
 }

 function makeSale(source, method, saleItems, tenders, options={}) {
  const total = saleItems.reduce((sum,item)=>sum+item.qty*item.price,0)+(options.taxAmount||0);
  return {version:2,offlineId:'OFL-'+randomUUID(),terminalId,sessionId,organizationPartyId:'POS_QA_A',
   userId:'POS_QA_MANAGER',ts:new Date().toISOString(),mode,taxOn:'N',taxAmount:0,total,items:saleItems,
   paymentMethod:method,payments:tenders,change:0,...source,...options};
 }

 async function sync(...sales) {
  const response = await a.c.request.post(`${base}/apps/zenith/pos/Terminal/syncOfflineTransactions`,{
   data:{terminalId,moquiSessionToken:a.t,transactions:sales.map(sale=>JSON.stringify(sale))}});
  check('offline synchronization endpoint returned JSON',response.ok(),{status:response.status()});
  return response.json();
 }

 function tenderValues(rows) {
  return rows.map(row=>[row.payment_method,Number(row.amount)]).sort();
 }

 try {
  const longItems = [line(trackedProduct,2)];
  for(let i=1;i<20;i++) {
   const price=10+i;
   const {productId} = await invoke('importProduct',{sku:`QA_RECON_${suffix}_${i}`,
    productName:`Disposable offline reconciliation product ${suffix} ${i}`,mrp:String(price),listPrice:String(price),unit:'Nos'});
   longItems.push(line(productId,i%3+1,price));
  }
  check('long offline fixture has 20 distinct products',new Set(longItems.map(item=>item.productId)).size===20);
  const cashSubtotal = longItems.reduce((sum,item)=>sum+item.qty*item.price,0);
  const stockBefore = onHand();
  const plans = [
   {name:'Cash',method:'Cash',lines:longItems,tenders:[{method:'Cash',amount:cashSubtotal+37.5}],options:{change:37.5}},
   {name:'Card',method:'Card',lines:[line(product)],tenders:[{method:'Card',amount:118,reference:'CARD-QA'}],options:{taxOn:'Y',taxAmount:18}},
   {name:'UPI from a voided source',method:'UPI',lines:[line(product)],tenders:[{method:'UPI',amount:100,reference:'UPI-QA'}],voided:true},
   {name:'Split',method:'Split',lines:[line(product)],tenders:[{method:'Cash',amount:40},{method:'UPI',amount:60,reference:'SPLIT-QA'}]},
   {name:'Credit without an upfront payment',method:'Credit',lines:[line(product)],tenders:[],options:{customer}},
   {name:'Credit with an upfront payment',method:'Credit',lines:[line(product)],tenders:[{method:'Card',amount:22.5}],options:{customer}}
  ];
  let customerId;
  let otherAttempt;
  for(const plan of plans) {
   const source = await makeSource();
   const sourceId = source.sourceTransactionId;
   if(plan.voided) await invoke('void',{transactionId:sourceId});
   else await invoke('add',{transactionId:sourceId,productId:'POS_QA_A_P5',quantity:'1',salesModeId:mode,taxOn:'N'});
   const unchangedSource = sourceState(sourceId);
   const sale = makeSale(source,plan.method,plan.lines,plan.tenders,plan.options);
   // Cash represents a queue entry from before checkout identities were stored.
   if(plan.method!=='Cash') sale.checkoutAttemptId=sale.offlineId;
   if(plan.method==='Card') otherAttempt=sale.checkoutAttemptId;
   const result = await sync(sale);
   check(plan.name+' is acknowledged automatically',result.syncedIds?.includes(sale.offlineId)&&result.failedCount===0,{result});
   const [record] = ledger(sale.offlineId);
   const recovered = record?.created_transaction_id;
   const saved = recovered&&txn(recovered);
   check(plan.name+' completes a separate bill and preserves its server source',recovered&&recovered!==sourceId&&
    saved.status_id==='PtCompleted'&&!!saved.transaction_number&&record.status_id==='OtSynced'&&
    (saved.checkout_attempt_id||null)===(sale.checkoutAttemptId||null)&&sourceState(sourceId)===unchangedSource);
   const lines = items(recovered).map(item=>[item.product_id,Number(item.quantity),Number(item.unit_price)]).sort();
   const expectedLines = plan.lines.map(item=>[item.productId,item.qty,item.price]).sort();
   check(plan.name+' preserves products, quantities, prices, tax and total',JSON.stringify(lines)===JSON.stringify(expectedLines)&&
    Number(saved.total_tax_amount)===sale.taxAmount&&Number(saved.payable_amount)===sale.total);
   const savedPayments = payments(recovered);
   check(plan.name+' preserves methods, amounts, external references and change',
    JSON.stringify(tenderValues(savedPayments))===JSON.stringify(plan.tenders.map(tender=>[tender.method,tender.amount]).sort())&&
    plan.tenders.filter(tender=>tender.reference).every(tender=>savedPayments.some(row=>row.reference_number?.endsWith(':'+tender.reference)))&&
    Number(saved.change_amount||0)===sale.change);
   if(plan.method==='Credit') {
    check(plan.name+' retains customer, term and actual upfront payment',!!saved.customer_party_id&&
     (!customerId||customerId===saved.customer_party_id)&&saved.is_credit==='Y'&&Number(saved.credit_days)===7&&
     Number(saved.paid_amount||0)===(plan.tenders[0]?.amount||0));
    customerId=saved.customer_party_id;
   }
   const beforeReplay = completed();
   const replay = await sync(sale,sale);
   check(plan.name+' replay is acknowledged without additional bills, ledger rows or tenders',replay.syncedIds?.includes(sale.offlineId)&&
    replay.failedCount===0&&ledger(sale.offlineId).length===1&&JSON.stringify(completed())===JSON.stringify(beforeReplay)&&
    JSON.stringify(payments(recovered))===JSON.stringify(savedPayments));
   if(plan.method==='Cash') {
    await invoke('sync',{transactionId:recovered});
    await invoke('sync',{transactionId:recovered});
    check('long offline sale allocates its two tracked units only once',onHand()===stockBefore-2,
     {stockBefore,stockAfter:onHand()});
   }
  }

  const attempt = randomUUID();
  const source = await makeSource();
  const sourceId = source.sourceTransactionId;
  const tender = [{method:'Card',amount:100,reference:'MATCHED-QA'}];
  const recoveredAttempt = makeSale(source,'Card',[line(product)],tender,{checkoutAttemptId:attempt});
  const completedResponse = await post('Terminal','payAndComplete',{sessionId,transactionId:sourceId,
   checkoutAttemptId:attempt,sourceRevision:source.sourceRevision,checkoutSnapshot:JSON.stringify(recoveredAttempt),
   paymentMethod:'Card',amount:'100',referenceNumber:'MATCHED-QA',salesModeId:mode,taxOn:'N',wantJson:'Y'});
  check('ordinary online Card checkout persists the same attempt identifier',completedResponse.ok()&&
   (await completedResponse.json()).success&&txn(sourceId).checkout_attempt_id===attempt);
  await invoke('sync',{transactionId:sourceId});
  const completedSource = sourceState(sourceId);
  const incorrectAttempt = makeSale(source,'Card',[line(product)],tender,{checkoutAttemptId:otherAttempt});
  const missingAttempt = makeSale(source,'Card',[line(product)],tender);
  const wrongTotal = makeSale(source,'Card',[line(product)],[{method:'Card',amount:101}],{checkoutAttemptId:attempt,total:101});
  const wrongTender = makeSale(source,'UPI',[line(product)],[{method:'UPI',amount:100}],{checkoutAttemptId:attempt});
  const wrongItems = makeSale(source,'Card',[line('POS_QA_A_P5',0.5,200)],tender,{checkoutAttemptId:attempt});
  const wrongReference = makeSale(source,'Card',[line(product)],[{method:'Card',amount:100,reference:'WRONG-QA'}],{checkoutAttemptId:attempt});
  const unproven = [incorrectAttempt,missingAttempt,wrongTotal,wrongTender,wrongItems,wrongReference];
  const beforeProof = completed();
  const result = await sync(recoveredAttempt,...unproven);
  check('checkout acknowledgement requires the exact attempt, total, tender, items and external reference',
   result.syncedIds?.join(',')===recoveredAttempt.offlineId&&result.failedCount===unproven.length&&
   unproven.every(sale=>ledger(sale.offlineId).length===0),{result});
  const retry = await sync(recoveredAttempt);
  check('a matching checkout attempt links the existing bill and never charges or creates it again',
   retry.syncedIds?.includes(recoveredAttempt.offlineId)&&ledger(recoveredAttempt.offlineId).length===1&&
   ledger(recoveredAttempt.offlineId)[0].created_transaction_id===sourceId&&sourceState(sourceId)===completedSource&&
   JSON.stringify(completed())===JSON.stringify(beforeProof)&&payments(sourceId).length===1);
  const changedReplay = await sync({...recoveredAttempt,total:101,payments:[{...tender[0],amount:101}]});
  check('an existing offline ID rejects a replay with a different amount',changedReplay.failedCount===1&&
   !changedReplay.syncedIds?.length&&ledger(recoveredAttempt.offlineId).length===1&&sourceState(sourceId)===completedSource,
   {result:changedReplay});

  const independent = makeSale(source,'UPI',[line('POS_QA_A_P5',0.5,200)],[{method:'UPI',amount:100,reference:'SEPARATE-QA'}],
   {checkoutAttemptId:randomUUID()});
  const independentSync = await sync(independent);
  check('another checkout identity cannot create a second receipt from an already-paid source',
   independentSync.failedCount===1&&!independentSync.syncedIds?.length&&ledger(independent.offlineId).length===0&&
   sourceState(sourceId)===completedSource&&JSON.stringify(completed())===JSON.stringify(beforeProof),{result:independentSync});

  const stale = await makeSource();
  const staleId = stale.sourceTransactionId;
  const staleAttempt = randomUUID();
  const staleSnapshot = makeSale(stale,'Card',[line(product)],tender,{checkoutAttemptId:staleAttempt});
  await invoke('remove',{transactionId:staleId,itemSeqId:items(staleId)[0].item_seq_id});
  await invoke('add',{transactionId:staleId,productId:'POS_QA_A_P5',quantity:'0.5',salesModeId:mode,taxOn:'N'});
  const changedDraft = sourceState(staleId);
  const staleResponse = await post('Terminal','payAndComplete',{sessionId,transactionId:staleId,
   checkoutAttemptId:staleAttempt,sourceRevision:stale.sourceRevision,checkoutSnapshot:JSON.stringify(staleSnapshot),
   paymentMethod:'Card',amount:'100',referenceNumber:'MATCHED-QA',salesModeId:mode,taxOn:'N',wantJson:'Y'});
  const staleReply = staleResponse.status()===200 ? await staleResponse.json() : null;
  check('online checkout rejects a stale snapshot even when the replacement items have the same total',
   staleReply?.success===false&&Number(txn(staleId).payable_amount)===100&&
   !txn(staleId).checkout_attempt_id&&!txn(staleId).invoice_id&&payments(staleId).length===0&&sourceState(staleId)===changedDraft,
   {status:staleResponse.status(),redirect:staleResponse.headers().location,response:staleReply});

  const oldDiscount = Object.fromEntries(q(`SELECT preference_key,preference_value FROM user_preference
   WHERE user_id='POS_QA_A' AND preference_key IN ('POS_DISC_LIMIT','POS_DISC_ROUNDSTEP')`)
   .map(row=>[row.preference_key,row.preference_value]));
  const setRoundStep = roundOffStep => post('DiscountSettings','saveDiscountSettings',{
   roundOffStep,discountLimitPct:oldDiscount.POS_DISC_LIMIT||''});
  try {
   await setRoundStep('10');
   const rounded = await makeSource();
   const roundedId = rounded.sourceTransactionId;
   const update = await post('Terminal','ajaxCart',{action:'updatePrice',sessionId,transactionId:roundedId,
    itemSeqId:items(roundedId)[0].item_seq_id,newPrice:'123',taxOn:'N'});
   check('rounded fallback fixture uses a ₹123 item',(await update.json()).success);
   const setRound = await post('Terminal','ajaxCart',{action:'applyDiscount',sessionId,transactionId:roundedId,taxOn:'N',roundOff:'Y'});
   const roundedCart = await setRound.json();
   check('the configured ₹10 step rounds the online cart down to ₹120',roundedCart.success&&Number(roundedCart.payable)===120);
   const snapshot = await post('Terminal','ajaxCart',{action:'refresh',sessionId,transactionId:roundedId,taxOn:'N'});
   rounded.sourceRevision=(await snapshot.json()).sourceRevision;
   await invoke('add',{transactionId:roundedId,productId:'POS_QA_A_P5',quantity:'1',salesModeId:mode,taxOn:'N'});
   const resultingDraft = sourceState(roundedId);
   const roundedSale = makeSale(rounded,'Card',[line(product,1,123)],[{method:'Card',amount:120}],{
    checkoutAttemptId:randomUUID(),checkoutWasOnline:true,roundOff:-3,total:120});
   const roundedSync = await sync(roundedSale);
   const roundedBill = ledger(roundedSale.offlineId)[0]?.created_transaction_id;
   check('reconciliation retains an already-collected configured round-off without changing the source',
    roundedSync.syncedIds?.includes(roundedSale.offlineId)&&roundedBill&&roundedBill!==roundedId&&
    Number(txn(roundedBill).payable_amount)===120&&Number(txn(roundedBill).round_off)===-3&&
    Number(payments(roundedBill)[0].amount)===120&&sourceState(roundedId)===resultingDraft,{result:roundedSync});
  } finally { await setRoundStep(oldDiscount.POS_DISC_ROUNDSTEP||'0'); }

  const legacy = await makeSource();
  const legacyReceipt = makeSale(legacy,'Card',[line(product)],[{method:'Card',amount:100}]);
  await invoke('pay',{transactionId:legacy.sourceTransactionId,paymentMethod:'Card',amount:'100',referenceNumber:'OFFLINE:'+legacyReceipt.offlineId});
  await invoke('complete',{transactionId:legacy.sourceTransactionId});
  await invoke('sync',{transactionId:legacy.sourceTransactionId});
  const legacySource = sourceState(legacy.sourceTransactionId);
  const legacyAck = await sync(legacyReceipt);
  const [legacyLedger] = ledger(legacyReceipt.offlineId);
  check('an exact legacy payment reference acknowledges the existing bill once without charging again',
   legacyAck.syncedIds?.includes(legacyReceipt.offlineId)&&legacyLedger?.created_transaction_id===legacy.sourceTransactionId&&
   ledger(legacyReceipt.offlineId).length===1&&payments(legacy.sourceTransactionId).length===1&&
   sourceState(legacy.sourceTransactionId)===legacySource,{result:legacyAck});
  const legacySale = makeSale(legacy,'Card',[line(product)],tender,{checkoutAttemptId:randomUUID()});
  const beforeLegacy = completed();
  const legacyResult = await sync(legacySale);
  check('an already-paid legacy bill without stored checkout proof remains for review',
   !txn(legacy.sourceTransactionId).checkout_attempt_id&&legacyResult.failedCount===1&&!legacyResult.syncedIds?.length&&
   ledger(legacySale.offlineId).length===0&&sourceState(legacy.sourceTransactionId)===legacySource&&
   JSON.stringify(completed())===JSON.stringify(beforeLegacy),{result:legacyResult});

  let actor = foreign;
  if(!actor) {
   const c = await a.c.browser().newContext();
   const auth = await c.request.get(base+'/apps/zenith/pos/Dashboard',{
    headers:{Authorization:'Basic '+Buffer.from('pos.b.qa:moqui').toString('base64')}});
   actor={c,t:auth.headers().moquisessiontoken};
   check('foreign disposable organization authenticated',auth.ok()&&!auth.url().includes('/Login'));
  }
  let foreignSessionId;
  try {
   const foreignTerminalId = 'QA_RECON_FOREIGN_'+suffix;
   await post('PosTerminals','createTerminal',{terminalId:foreignTerminalId,terminalName:'Disposable foreign reconciliation counter',
    organizationPartyId:'POS_QA_B',facilityId:'POS_QA_B_FAC',stateCode:'33',isActive:'Y'},actor);
   ({sessionId:foreignSessionId}=await invoke('open',{terminalId:foreignTerminalId,openingCash:'0'},false,actor));
   const foreignSource = await makeSource(foreignSessionId,actor,'POS_QA_B_P18');
   const sourceId = foreignSource.sourceTransactionId;
   const original = sourceState(sourceId);
   const denied = makeSale(foreignSource,'Card',[line(product)],tender);
   const before = completed();
   const result = await sync(denied);
   check('a foreign server source stays intact and its sale remains for review',result.failedCount===1&&
    !result.syncedIds?.length&&ledger(denied.offlineId).length===0&&sourceState(sourceId)===original&&
    JSON.stringify(completed())===JSON.stringify(before),{result});
  } finally {
   if(foreignSessionId) await invoke('close',{sessionId:foreignSessionId,closingCash:'0'},false,actor);
   if(!foreign) await actor.c.close();
  }
 } finally {
  const response = await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId});
  const summary = await response.json();
  check('fixture drawer balance can be reconciled',summary.success&&Number.isFinite(Number(summary.expectedCash)),summary);
  await invoke('close',{sessionId,closingCash:String(summary.expectedCash)});
 }
};
