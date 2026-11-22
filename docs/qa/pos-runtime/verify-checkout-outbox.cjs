const { randomUUID } = require('node:crypto');
const path = require('node:path');

const checkoutUrl = /\/Terminal\/(?:payAndComplete|splitPayAndComplete|completeCredit)(?:\?|$)/;

module.exports = async function ({a,base,check,q,invoke,post,out}) {
 const suffix = randomUUID().slice(0,8);
 const terminalId = 'QA_OUTBOX_' + suffix;
 const productId = 'POS_QA_A_STOCK';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable checkout outbox',
  facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const {sessionId} = await invoke('open',{terminalId,openingCash:'0'});
 const context = await a.c.browser().newContext({viewport:{width:1366,height:768}});
 const auth = await context.request.get(base+'/apps/zenith/pos/Dashboard',
  {headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
 check('the outbox test uses its own authenticated browser',auth.ok()&&!auth.url().includes('/Login'));
 const page = await context.newPage();
 const errors = [];
 page.on('pageerror',error=>errors.push(error.message));
 let interaction;
 let allowedToSync = false;
 await page.route('**/Terminal/syncOfflineTransactions',route=>allowedToSync?route.continue():route.abort('internetdisconnected'));
 await page.route(checkoutUrl,async route=>{
  const job = interaction;
  if(!job) return route.continue();
  try {
   const params = new URLSearchParams(route.request().postData());
   const staged = await page.evaluate(id=>window._posOffline.getQueue().then(sales=>sales.find(sale=>sale.checkoutAttemptId===id)),
    params.get('checkoutAttemptId'));
   if (job.rejectedAuth) {
    await route.fulfill({status:401,json:{success:false,error:'Sign in again'}});
    job.done({params,staged});
    return;
   }
   let committed;
   if (job.acceptedRemotely) {
    const response = await route.fetch();
    committed = {status:response.status(),body:await response.json()};
   }
   await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    window.dispatchEvent(new Event('offline'));
   });
   await route.abort('internetdisconnected');
   job.done({params,staged,committed});
  } catch(error) {
   await route.abort().catch(()=>{});
   job.done({error});
  }
 });

 const txn = id=>q(`SELECT status_id,transaction_number,checkout_attempt_id,payable_amount,paid_amount,change_amount,is_credit,credit_days
  FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const payments = id=>q(`SELECT payment_method,amount,reference_number FROM pos_payment
  WHERE transaction_id='${id}' ORDER BY payment_id`);
 const completed = ()=>q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${sessionId}' AND status_id='PtCompleted'`);
 const onHand = ()=>Number(q(`SELECT sum(quantity_on_hand_total) AS qty FROM asset WHERE product_id='${productId}'
  AND owner_party_id='POS_QA_A' AND facility_id='POS_QA_A_FAC'`)[0].qty);
 const customerPhone = '701'+Date.now().toString().slice(-7);
 const scenarios = ['Cash','Card','UPI','Split','Credit'].flatMap((method,index)=>
  [false,true].map(acceptedRemotely=>({method,index,acceptedRemotely})));
 scenarios.push({method:'UPI',index:5,rejectedAuth:true});

 async function confirm(method,total) {
  const control = {Cash:'#pos-pay-cash',Card:'#pos-pay-card',UPI:'#pos-pay-upi',Split:'#pos-split',Credit:'#pos-credit'}[method];
  await page.locator(control).click();
  if (method==='Cash') {
   const panel = page.locator('#posCashTenderOverlay,.pos-cash-panel').filter({visible:true});
   await panel.locator('#posCashRecv,.pos-cash-input').fill(String(total+37.5));
   await panel.locator('#posCashConfirm,.pos-cash-confirm').click();
  } else if (method==='Split') {
   await page.locator('#pos-split-cash').fill('25');
   await page.locator('#pos-split-upi').fill(String(total-25));
   await page.locator('#pos-split-upi-ref').fill('OUTBOX-UPI');
   await page.locator('.pos-split-confirm').click();
  } else if (method==='Credit') {
   await page.locator('#credit-name').fill('Disposable credit '+suffix);
   await page.locator('#credit-phone').fill(customerPhone);
   await page.locator('#credit-upfront').fill('20');
   await page.locator('#credit-upfront-method').selectOption('Card');
   await page.locator('#credit-days').fill('7');
   await page.locator('#credit-confirm').click();
  }
 }

 try {
  for(const {method,index,acceptedRemotely=false,rejectedAuth=false} of scenarios) {
   const layout = (index + Number(acceptedRemotely)) % 2 ? 'advanced' : 'normal';
   const label = `${method} ${layout} ${rejectedAuth?'sign-in expired':acceptedRemotely?'lost receipt response':'lost before reaching server'}`;
   const before = completed().length;
   const beforeStock = onHand();
   const {transactionId} = await invoke('cart',{sessionId,reuseOpenCart:false});
   await invoke('add',{transactionId,productId,quantity:'1',salesModeId:'RETAIL',taxOn:'N'});
   const total = Number(txn(transactionId).payable_amount);
   await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+sessionId+'&transactionId='+transactionId+'&taxOn=N&salesModeId=RETAIL',
    {waitUntil:'commit'});
   await page.waitForFunction(()=>typeof window._posCompleteTender==='function'&&!!window._posOffline?.lookup('POS_QA_A_STOCK'));
   await page.locator('.nb-modes__btn').click();
   await page.locator('[data-pos-layout="'+layout+'"]').click();
   await page.evaluate(()=>window._posRefreshCart());
   allowedToSync = false;
   let finish;
   const intercepted = new Promise(resolve=>{finish=resolve;});
   interaction={acceptedRemotely,rejectedAuth,done:finish};
   await confirm(method,total);
   const receipt = page.locator('#posPayConfirmOverlay');
   if (rejectedAuth) await page.getByRole('alert').filter({hasText:'Sign in again to sync it'}).waitFor();
   else await receipt.waitFor();
   const {params,staged,committed,error} = await intercepted;
   interaction = null;
   if(error) throw error;
   const attemptId = params.get('checkoutAttemptId');
   const sent = JSON.parse(params.get('checkoutSnapshot'));
   check(label+' persists the exact checkout before the network call',!!staged&&staged.offlineId===attemptId&&
    staged.checkoutAttemptId===attemptId&&staged.checkoutPendingUntil>0&&staged.sourceTransactionId===transactionId&&
    staged.sourceRevision===params.get('sourceRevision')&&staged.sessionId===sessionId&&staged.terminalId===terminalId&&staged.total===total&&
    JSON.stringify(sent)===JSON.stringify({...staged,checkoutPendingUntil:undefined})&&
    staged.items.length===1&&staged.items[0].productId===productId&&staged.items[0].qty===1,{staged});
   if(acceptedRemotely) check(label+' committed once before losing the reply',committed?.status===200&&
    committed.body.success&&txn(transactionId).checkout_attempt_id===attemptId&&completed().length===before+1);
   else check(label+' reached no payment endpoint in the ERP',!committed&&txn(transactionId).status_id==='PtCreated'&&
    completed().length===before&&payments(transactionId).length===0);
   const local = await page.evaluate(id=>window._posOffline.getQueue().then(sales=>sales.find(sale=>sale.offlineId===id)),attemptId);
   check(label+' retains the exact attempt with the correct acknowledgment state',local?.checkoutAttemptId===attemptId&&
    !local.checkoutPendingUntil&&!local.checkoutReconcileOnly&&staged.sourceRevision===local.sourceRevision&&
    (rejectedAuth?await receipt.count()===0:(await receipt.innerText()).includes(attemptId)&&await page.locator('.pos-cart .aj-qi').count()===0));
   const expected = method==='Cash'?[['Cash',total+37.5]]:method==='Split'?[['Cash',25],['UPI',total-25]]:
    method==='Credit'?[['Card',20]]:[[method,total]];
   check(label+' stores actual tender method, cash change and credit details',
    JSON.stringify(local.payments.map(payment=>[payment.method,payment.amount]).sort())===JSON.stringify(expected.sort())&&
    local.change===(method==='Cash'?37.5:0)&&
    (method!=='Split'||local.payments.some(payment=>payment.reference==='OUTBOX-UPI'))&&
    (method!=='Credit'||local.customer.phone===customerPhone&&local.customer.creditDays===7),{local});
   if (rejectedAuth) {
    const signIn = await context.request.get(base+'/apps/zenith/pos/Dashboard',
     {headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
    check('the original cashier can sign in again',signIn.ok()&&!signIn.url().includes('/Login'));
    allowedToSync = true;
    const acknowledgedOutsideTerminal = page.waitForResponse(response=>response.ok()&&response.url().endsWith('/syncOfflineTransactions'));
    await page.goto(base+'/apps/zenith/pos/Dashboard',{waitUntil:'commit'});
    const replay = await (await acknowledgedOutsideTerminal).json();
    check(label+' syncs on a non-checkout screen once the original cashier signs in',replay.syncedIds.includes(attemptId));
   } else {
    await receipt.locator('#posPaySave').click();
    await receipt.waitFor({state:'hidden'});
    allowedToSync = true;
    await page.evaluate(()=>{delete navigator.onLine;window.dispatchEvent(new Event('online'));});
    await page.waitForFunction(id=>window._posOffline.getQueue().then(sales=>!sales.some(sale=>sale.offlineId===id)),attemptId);
    await page.locator('#pos-connection-status').filter({hasText:/^Online$/}).waitFor();
   }
   const saved = txn(transactionId);
   const rows = payments(transactionId);
   const replay = q(`SELECT created_transaction_id,item_count FROM pos_offline_transaction
    WHERE terminal_id='${terminalId}' AND transaction_data_json LIKE '%${attemptId}%'`);
   check(label+' reconnect acknowledges one bill with the same attempt and exact payment rows',
    completed().length===before+1&&saved.status_id==='PtCompleted'&&!!saved.transaction_number&&saved.checkout_attempt_id===attemptId&&
    Number(saved.payable_amount)===total&&Number(saved.change_amount||0)===(method==='Cash'?37.5:0)&&replay.length===1&&
    replay[0].created_transaction_id===transactionId&&Number(replay[0].item_count)===1&&
    JSON.stringify(rows.map(row=>[row.payment_method,Number(row.amount)]).sort())===JSON.stringify(expected)&&
    (method!=='Split'||rows.some(row=>String(row.reference_number).endsWith('OUTBOX-UPI')))&&
    (method!=='Credit'||saved.is_credit==='Y'&&Number(saved.paid_amount)===20&&Number(saved.credit_days)===7),{saved,rows,replay});
   await invoke('sync',{transactionId});
   await invoke('sync',{transactionId});
   check(label+' posts the tracked unit only once',onHand()===beforeStock-1,{beforeStock,afterStock:onHand()});
  }
  check('checkout outbox browser had no uncaught errors',errors.length===0,{errors});
 } catch(error) {
  if(out) await page.screenshot({path:path.join(out,'checkout-outbox-failure.png'),fullPage:true});
  throw error;
 } finally {
  await context.close();
  const drawer = q(`SELECT COALESCE(SUM(CASE WHEN p.payment_method='Cash' THEN p.amount ELSE 0 END),0) AS amount
   FROM pos_payment p JOIN pos_transaction t ON t.transaction_id=p.transaction_id WHERE t.session_id='${sessionId}'`)[0];
  const change = q(`SELECT COALESCE(SUM(change_amount),0) AS amount FROM pos_transaction WHERE session_id='${sessionId}'`)[0];
  for(const bill of q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${sessionId}' AND status_id='PtCreated'`))
   await invoke('void',{transactionId:bill.transaction_id});
  await invoke('close',{sessionId,closingCash:String(Number(drawer.amount)-Number(change.amount))});
 }
};
