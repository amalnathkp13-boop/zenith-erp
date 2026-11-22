const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');

module.exports=async function({base,check,q,invoke,post}) {
 const sessions=[],terminals=[];
 const session=id=>q(`SELECT * FROM pos_session WHERE session_id='${id}'`)[0];
 const txn=id=>q(`SELECT * FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const lines=id=>q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${id}' ORDER BY item_seq_id`);
 async function open(label) {
  const terminalId='QA_IDLE_WORK_'+label+'_'+randomUUID().slice(0,8);
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable idle retained '+label,
   facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  terminals.push(terminalId);
  const opened=await invoke('open',{terminalId,openingCash:'0'});sessions.push(opened.sessionId);
  return {...opened,terminalId};
 }
 async function reopen(terminalId) {
  const opened=await invoke('open',{terminalId,openingCash:'0'});sessions.push(opened.sessionId);return opened;
 }
 async function add(sessionId,productId='POS_QA_A_P18',quantity='1') {
  const bill=await invoke('cart',{sessionId,reuseOpenCart:false});
  await invoke('add',{transactionId:bill.transactionId,productId,quantity,taxOn:'N'});return bill;
 }
 async function expire(sessionId) {
  const clock=await post('PosQaAcceptance','idleClock',{sessionId,minutes:'61'});
  check('retained-work fixture uses an exact disposable idle clock',(await clock.json()).backdated===true);
  return (await post('Terminal','closeIdleSession',{sessionId})).json();
 }
 await post('PosSessions','saveIdlePolicy',{enabled:'Y'});
 try {
  const original=await open('primary');
  const completed=await add(original.sessionId);
  const amount=Number(txn(completed.transactionId).payable_amount);
  await invoke('pay',{transactionId:completed.transactionId,paymentMethod:'Cash',amount:String(amount)});
  await invoke('complete',{transactionId:completed.transactionId});
  // Completion queues invoice sync asynchronously; finish it before the immutable baseline.
  await invoke('sync',{transactionId:completed.transactionId});
  const held=await add(original.sessionId,'POS_QA_A_P5','2');
  const hold=await invoke('hold',{transactionId:held.transactionId});
  const draft=await add(original.sessionId,'POS_QA_A_P18','3');
  const before={completed:txn(completed.transactionId),held:txn(held.transactionId),draft:txn(draft.transactionId),
   heldRecord:q(`SELECT * FROM pos_held_transaction WHERE held_id='${hold.heldId}'`)[0],
   draftLines:lines(draft.transactionId),heldLines:lines(held.transactionId),
   payments:q(`SELECT * FROM pos_payment WHERE transaction_id='${completed.transactionId}' ORDER BY payment_id`)};
  const closed=await expire(original.sessionId);
  const old=session(original.sessionId);
  check('one idle hour closes a drawer containing both open and held unpaid bills',closed.closed===true&&old.status_id==='PsClosed'&&old.close_reason==='IdleUnverifiedCash');
  check('idle closure leaves cash uncounted',old.closing_cash===null&&old.expected_cash===null&&old.cash_difference===null);
  const after={completed:txn(completed.transactionId),held:txn(held.transactionId),draft:txn(draft.transactionId),
    heldRecord:q(`SELECT * FROM pos_held_transaction WHERE held_id='${hold.heldId}'`)[0],
    draftLines:lines(draft.transactionId),heldLines:lines(held.transactionId),
    payments:q(`SELECT * FROM pos_payment WHERE transaction_id='${completed.transactionId}' ORDER BY payment_id`)};
  check('idle closure preserves original draft, held bill, lines, issued bill and tenders exactly',isDeepStrictEqual(after,before),
   Object.fromEntries(Object.keys(before).filter(key=>!isDeepStrictEqual(before[key],after[key])).map(key=>[key,{before:before[key],after:after[key]}])));
  const repeated=await (await post('Terminal','closeIdleSession',{sessionId:original.sessionId})).json();
  check('repeating an idle close does not rewrite its close time',repeated.closed===false&&session(original.sessionId).close_date===old.close_date);
  const older=await post('PosQaAcceptance','idleRetainedClock',{sessionId:original.sessionId});
  check('orphan preservation fixture backdates only its own idle-closed drawer',(await older.json()).backdated===true);
  await invoke('orphanVoid',{olderThanHours:'24'});
  check('nightly orphan cleanup preserves an auto-closed open cart beyond twenty-four hours',
   txn(draft.transactionId).status_id==='PtCreated'&&JSON.stringify(lines(draft.transactionId))===JSON.stringify(before.draftLines));
  const other=await open('other-counter');
  const unrelated=await add(other.sessionId);await invoke('hold',{transactionId:unrelated.transactionId});
  await expire(other.sessionId);
  const incoming=await reopen(original.terminalId);
  check('reopening the same counter recovers both unpaid bills through Hold Bills',
   txn(draft.transactionId).session_id===incoming.sessionId&&txn(draft.transactionId).status_id==='PtHeld'&&
   txn(held.transactionId).session_id===incoming.sessionId&&txn(held.transactionId).status_id==='PtHeld'&&
   Number(q(`SELECT count(*) AS n FROM pos_held_transaction WHERE session_id='${incoming.sessionId}' AND status_id='PhHeld'`)[0].n)===2);
  check('recovery retains every quantity and rate on the original bill identities',
   JSON.stringify(lines(draft.transactionId))===JSON.stringify(before.draftLines)&&JSON.stringify(lines(held.transactionId))===JSON.stringify(before.heldLines));
  check('recovery leaves issued bills and the old drawer cash audit with the old session',
   JSON.stringify(txn(completed.transactionId))===JSON.stringify(before.completed)&&
   JSON.stringify(q(`SELECT * FROM pos_payment WHERE transaction_id='${completed.transactionId}' ORDER BY payment_id`))===JSON.stringify(before.payments)&&
   session(original.sessionId).closing_cash===null);
  check('recovery does not consume another counter retained bill',txn(unrelated.transactionId).session_id===other.sessionId&&session(other.sessionId).status_id==='PsClosed');
  await expire(incoming.sessionId);
  await post('EditSession','reviewIdleCash',{sessionId:incoming.sessionId,closingCash:'0'});
  check('cash review can finish independently of unpaid work',session(incoming.sessionId).close_reason==='IdleReviewed');
  const reviewed=await reopen(original.terminalId);
  check('reopening a reviewed idle drawer recovers its unpaid work exactly once',
   txn(draft.transactionId).session_id===reviewed.sessionId&&txn(held.transactionId).session_id===reviewed.sessionId&&
   Number(q(`SELECT count(*) AS n FROM pos_held_transaction WHERE session_id='${reviewed.sessionId}' AND status_id='PhHeld'`)[0].n)===2);
  for(const qrStatus of ['QpPending','QpConfirmed']) {
   const qrDrawer=await open(qrStatus);const bill=await add(qrDrawer.sessionId);
   const seeded=await post('PosQaAcceptance','idleQrFixture',{transactionId:bill.transactionId,statusId:qrStatus});
   check('disposable pending-payment fixture is available',(await seeded.json()).updated===true);
   const guarded=await expire(qrDrawer.sessionId);
   check('idle closure preserves a drawer with an unfinished QR tender '+qrStatus,!guarded.closed&&guarded.reason==='review_required'&&session(qrDrawer.sessionId).status_id==='PsOpen');
   await post('PosQaAcceptance','idleQrFixture',{transactionId:bill.transactionId,statusId:'QpFailed'});
  }
  const paidDrawer=await open('partial-cash'),partial=await add(paidDrawer.sessionId);
  await invoke('pay',{transactionId:partial.transactionId,paymentMethod:'Cash',amount:'50'});
  const partialBefore=txn(partial.transactionId),guarded=await expire(paidDrawer.sessionId);
  check('unfinished cash still requires cashier review without altering the tender',!guarded.closed&&guarded.reason==='review_required'&&
   session(paidDrawer.sessionId).status_id==='PsOpen'&&JSON.stringify(txn(partial.transactionId))===JSON.stringify(partialBefore)&&
   Number(q(`SELECT count(*) AS n FROM pos_payment WHERE transaction_id='${partial.transactionId}'`)[0].n)===1);
  await invoke('pay',{transactionId:partial.transactionId,paymentMethod:'Cash',amount:String(Number(partialBefore.payable_amount)-50)});
  await invoke('complete',{transactionId:partial.transactionId});
  const legacy=await open('legacy');
  let legacyClock=await post('PosQaAcceptance','idleLegacyClock',{sessionId:legacy.sessionId,minutes:'5'});
  check('legacy fixture clears only its own activity timestamp',(await legacyClock.json()).backdated===true);
  const young=await (await post('Terminal','closeIdleSession',{sessionId:legacy.sessionId})).json();
  check('a legacy drawer without recorded activity still gets a full hour from opening',!young.closed&&young.reason==='still_active');
  legacyClock=await post('PosQaAcceptance','idleLegacyClock',{sessionId:legacy.sessionId,minutes:'61'});
  check('legacy fixture has an opening date older than an hour',(await legacyClock.json()).backdated===true);
  await post('PosSessions','saveIdlePolicy',{enabled:'N'});
  const disabled=await (await post('Terminal','closeIdleSession',{sessionId:legacy.sessionId})).json();
  check('legacy opening-date fallback respects an explicit opt-out',!disabled.closed&&disabled.reason==='disabled'&&session(legacy.sessionId).status_id==='PsOpen');
  await post('PosSessions','saveIdlePolicy',{enabled:'Y'});
  await invoke('idleSweep',{});
  check('an opted-in legacy drawer is found by the sweep using its opening date',session(legacy.sessionId).status_id==='PsClosed'&&
   session(legacy.sessionId).close_reason==='IdleUnverifiedCash'&&session(legacy.sessionId).closing_cash===null);
 } finally {
  // Recover the fixture's own retained bills before manual close, leaving other counters untouched.
  for(const terminalId of terminals) {
   let drawer=q(`SELECT session_id FROM pos_session WHERE terminal_id='${terminalId}' AND status_id='PsOpen'`)[0];
   if(!drawer) drawer=await reopen(terminalId);
   const sessionId=drawer.session_id||drawer.sessionId;
   for(const held of q(`SELECT held_id FROM pos_held_transaction WHERE session_id='${sessionId}' AND status_id='PhHeld'`)) {
    const recalled=await invoke('recall',{heldId:held.held_id,sessionId});await invoke('void',{transactionId:recalled.transactionId});
   }
   for(const bill of q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${sessionId}' AND status_id='PtCreated'`))
    await invoke('void',{transactionId:bill.transaction_id});
   const summary=await (await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId})).json();
   await invoke('close',{sessionId,closingCash:String(summary.expectedCash||0)});
  }
 }
};
