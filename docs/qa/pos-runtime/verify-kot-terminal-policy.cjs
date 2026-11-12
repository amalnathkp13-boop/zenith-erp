const {randomUUID}=require('node:crypto');
module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 const page=await a.c.newPage();
 let sessionId;
 try {
  for(const shell of ['apps','qapps']) {
   await page.goto(base+'/'+shell+'/zenith/kot/KotBilling');
   await page.locator('#kot-terminal-entry').waitFor();
   check(shell+' KOT starts at terminal selection instead of a sessionless cart',await page.locator('#kot-terminal-entry').count()===1&&await page.locator('#kb-search').count()===0);
   check(shell+' terminal gateway uses readable full-size controls',await page.locator('#kot-terminal-entry select').evaluate(el=>el.getBoundingClientRect().height>=40));
   if(out)await page.screenshot({path:require('node:path').join(out,shell+'-kot-terminal-entry.png')});
  }
  const terminalId='POS_QA_KOT_GATE_'+randomUUID().slice(0,8);
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable KOT gateway',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  await page.goto(base+'/apps/zenith/kot/KotBilling');
  await page.locator('#kot-terminal-entry select[name=terminalId]').selectOption(terminalId);
  await page.getByRole('button',{name:'Open / Resume Session'}).click();
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  sessionId=new URL(page.url()).searchParams.get('sessionId');
  check('gateway opens a persisted session on the selected terminal',!!sessionId&&q(`SELECT terminal_id FROM pos_session WHERE session_id='${sessionId}'`)[0]?.terminal_id===terminalId);
  check('payment cannot switch to a different terminal',await page.locator('#kb-payment select[name=sessionId]').count()===0&&await page.locator('#kb-payment input[name=sessionId]').inputValue()===sessionId);
  const route='/apps/zenith/kot/KotBilling/';
  const request=(action,args={},actor=a)=>actor.c.request.post(base+route+action,{maxRedirects:0,form:{moquiSessionToken:actor.t,sessionId,...args}});
  const itemsJson=JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]);
  const before=q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").length;
  await request('createKot',{sessionId:'',itemsJson,orderType:'Take Away'});
  check('a sessionless forged send cannot create an order',q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").length===before);
  const policy=(enabled,actor=a,facilityId='POS_QA_A_FAC')=>actor.c.request.post(base+'/apps/zenith/kot/KitchenDisplay/saveDisplayPolicy',{
   maxRedirects:0,form:{moquiSessionToken:actor.t,facilityId,enabled}});
  const policyState=()=>JSON.stringify(q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KITCHEN_DISPLAY_POS_QA_A_FAC'"));
  const oldPolicy=policyState();
  await policy('N',foreign);
  check('another organization cannot change this shop policy',policyState()===oldPolicy);
  await policy('N');
  check('disable persists for this shop only',q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KITCHEN_DISPLAY_POS_QA_A_FAC'")[0]?.setting_value==='N'&&q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_B' AND setting_key='KITCHEN_DISPLAY_POS_QA_A_FAC'").length===0);
  await page.goto(base+'/qapps/zenith/kot/KitchenDisplay?facilityId=POS_QA_A_FAC');
  await page.locator('#kitchen-display-policy').waitFor();
  check('Kitchen Display shows the saved shop switch and explains print-only billing',await page.locator('#kitchen-display-policy select[name=enabled]').inputValue()==='N'&&await page.getByRole('status').filter({hasText:'Kitchen Display is disabled for this shop.'}).count()===1);
  await page.goto(base+'/apps/zenith/kot/KitchenDisplay?facilityId=POS_QA_A_FAC2');
  await page.locator('#kitchen-display-policy').waitFor();
  check('another shop in the same organization keeps Kitchen Display enabled',await page.locator('#kitchen-display-policy select[name=enabled]').inputValue()==='Y');
  await request('createKot',{itemsJson,orderType:'Take Away'});
  check('an already-open billing tab cannot send after Kitchen Display is disabled',q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").length===before);
  const tx=await invoke('cart',{sessionId});
  await invoke('add',{transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  const deniedSend=await (await post('PosQaAcceptance','invoke',{op:'kitchenSend',posTransactionId:tx.transactionId,items:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}])})).json();
  check('POS service cannot bypass the disabled Kitchen Display',String(JSON.stringify(deniedSend.errors)).includes('Kitchen Display is disabled')&&q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'").length===before,deniedSend);
  await invoke('void',{transactionId:tx.transactionId});
  await page.goto(base+'/qapps/zenith/kot/KotBilling?sessionId='+sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  await page.locator('#kb-search').fill('POS_QA_A_P18');
  await page.locator('#kb-suggestions [data-result]').first().click();
  await page.locator('#kb-grand').getByText('₹118.00').waitFor();
  const sendShortcut=async()=>{
   await page.evaluate(()=>document.activeElement?.blur());
   await page.keyboard.press('Shift');
  };
  const orderStatus=page.locator('#kb-order-status');
  const initialStatus=await orderStatus.textContent();
  await sendShortcut();
  check('disabled shop keeps checkout and Hold available and ignores the send shortcut',
   await orderStatus.textContent()===initialStatus&&await page.locator('[data-kb-payment="Cash"]').isEnabled()&&
   await page.locator('#kb-draft').isEnabled());
  await page.screenshot({path:require('node:path').join(out,'kot-disabled-billing.png')});
  const saved=await (await request('saveDraft',{itemsJson,orderType:'Take Away',taxOn:'N',salesModeId:'RETAIL',wantJson:'Y'})).json();
  check('printed-ticket workflow can hold an order',saved.success&&!!saved.kotId,saved);
  const settled=await (await request('checkoutKot',{kotId:saved.kotId,paymentMethod:'Cash',cashAmount:'100'})).json();
  check('disabled display does not prevent payment',settled.success,settled);
  const order=q(`SELECT status_id,terminal_id,transaction_id FROM kitchen_order_ticket WHERE kot_id='${saved.kotId}'`)[0];
  check('print-only bill completes without waiting for kitchen status',order.status_id==='KotServed'&&order.terminal_id===terminalId);
  for(const kind of ['kot','bill']) check('print-only takeaway retains '+kind+' document',(await (await request('printRecord',{kotId:saved.kotId,kind})).json()).success);
  const legacy=await (await request('saveDraft',{itemsJson,orderType:'Take Away',taxOn:'N',salesModeId:'RETAIL',wantJson:'Y',notes:'Synthetic legacy KOT QA'})).json();
  await post('PosQaAcceptance','legacyKot',{kotId:legacy.kotId});
  await page.goto(base+'/apps/zenith/kot/KotBilling?loadDraft='+legacy.kotId);
  await page.locator('#kot-terminal-entry select[name=terminalId]').selectOption(terminalId);
  await page.getByRole('button',{name:'Open / Resume Session'}).click();
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  check('owner can recover a pre-terminal draft through its old bookmark',await page.locator('#kb-data').getAttribute('data-draftid')===legacy.kotId&&await page.locator('#kb-cart tr').count()===1);
  await request('deleteDraft',{kotId:legacy.kotId});
  const label='DINING_'+randomUUID().slice(0,8);
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_A_FAC',tableNumber:label,seatingCapacity:'4'});
  const tableId=q(`SELECT table_id FROM restaurant_table WHERE table_number='${label}'`)[0].table_id;
  const dinner=await (await request('saveDraft',{itemsJson,orderType:'Dine In',tableId,taxOn:'N',salesModeId:'RETAIL',wantJson:'Y'})).json();
  check('dine-in hold occupies its table while food is served without a display',dinner.success&&q(`SELECT status_id FROM restaurant_table WHERE table_id='${tableId}'`)[0].status_id==='TblOccupied');
  const dinnerBill=await (await request('checkoutKot',{kotId:dinner.kotId,paymentMethod:'UPI'})).json();
  check('after-meal payment completes and releases the table without kitchen updates',dinnerBill.success&&q(`SELECT status_id FROM restaurant_table WHERE table_id='${tableId}'`)[0].status_id==='TblAvailable');
  await policy('Y');
  await request('createKot',{itemsJson,orderType:'Take Away',taxOn:'N'});
  check('enabling display restores sending to kitchen',q(`SELECT kot_id FROM kitchen_order_ticket WHERE terminal_id='${terminalId}' AND status_id='KotNew'`).length===1);
  for (const [shell, grid] of [['apps',false],['qapps',true]]) {
   const note='KOT UI '+randomUUID();
   await page.goto(base+'/'+shell+'/zenith/kot/KotBilling?sessionId='+sessionId);
   await page.locator('#kb-wrap[data-ready=true]').waitFor();
   if(grid) {
    await page.locator('.kg-modes summary').click();
    await page.getByRole('button',{name:'Grid View',exact:true}).click();
   }
   await page.route('**/cartReceipt',route=>route.abort());
   try {
    await page.locator('#kb-search').fill('POS_QA_A_P18');
    await page.locator('#kb-suggestions [data-result]').first().click();
    await page.locator('#kb-quote-error').filter({hasText:/\S/}).waitFor();
    check(shell+' remains online when only the price preview request fails',
     !await page.locator('#kb-online.is-offline').isVisible());
    await page.locator('#kb-instr').fill(note);
    if(!grid) {
     await policy('N');
     await sendShortcut();
     await page.locator('#kb-order-status').filter({hasText:'Kitchen Display is disabled'}).waitFor();
     check('server rejection keeps the order available for retry',await page.locator('#kb-cart tr').count()===1);
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     await page.waitForFunction(()=>document.getElementById('kb-data').dataset.displayEnabled==='false');
     await policy('Y');
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     await page.waitForFunction(()=>document.getElementById('kb-data').dataset.displayEnabled==='true');
    }
    await sendShortcut();
    await page.locator('#kb-order-status').filter({hasText:'sent to the kitchen'}).waitFor();
    check(shell+' sends from '+(grid?'grid':'list')+' when the preview request fails',
     await page.locator('#kb-cart tr').count()===0 &&
     q(`SELECT kot_id FROM kitchen_order_ticket WHERE terminal_id='${terminalId}' AND status_id='KotNew' AND notes LIKE '%${note}%'`).length===1);
    check(shell+' keeps its billing view after sending',await page.locator('#kb-product-grid').isVisible()===grid);
   } finally { await page.unroute('**/cartReceipt'); }
   await page.goto(base+'/'+shell+'/zenith/kot/KitchenDisplay?facilityId=POS_QA_A_FAC');
   await page.getByText(note,{exact:false}).waitFor();
   const ticketSql=`SELECT kot_id,kot_date,status_id,transaction_id FROM kitchen_order_ticket WHERE terminal_id='${terminalId}' AND notes LIKE '%${note}%'`;
   const ticket=q(ticketSql)[0];
   const statuses=grid?['KotPreparing','KotReady','KotServed']:['KotPreparing'];
   for(const statusId of statuses) {
    await a.c.request.post(base+'/'+shell+'/zenith/kot/KitchenDisplay/updateStatus',{
     maxRedirects:0,form:{moquiSessionToken:a.t,kotId:ticket.kot_id,statusId}});
   }
   const status=statuses.at(-1);
   check(shell+' can progress the kitchen ticket before payment',q(ticketSql)[0].status_id===status);
   const changed=await (await request('checkoutKot',{kotId:ticket.kot_id,paymentMethod:'UPI',confirmedTotal:'0.01'})).json();
   await request('checkoutKot',{kotId:ticket.kot_id,paymentMethod:'UPI'},foreign);
   check(shell+' rejects stale totals and foreign checkout without taking payment',
    !changed.success&&changed.error.includes('saved order total changed')&&!q(ticketSql)[0].transaction_id);
   await page.goto(base+'/'+shell+'/zenith/kot/KotBilling?sessionId='+sessionId);
   await page.locator('#kb-wrap[data-ready=true]').waitFor();
   await page.locator('#kb-search').fill('POS_QA_A_P5');
   await page.locator('#kb-suggestions [data-result]').first().click();
   await page.locator('#kb-history-open').click();
   const billButton=page.locator('[data-kb-bill-order="'+ticket.kot_id+'"]');
   const due=Number(await billButton.getAttribute('data-kb-bill-total'));
   await billButton.click();
   const payment=page.locator('#kb-other-payment');
   const method=page.locator('#kb-payment-method');
   const proceed=page.locator('#kb-payment-continue');
   check(shell+' asks which tender to use for an already sent KOT',await method.inputValue()===''&&await proceed.isDisabled());
   await method.selectOption(grid?'Split':'UPI');
   await method.press('Enter');
   if(grid) {
    await payment.locator('[name=cardAmount]').fill('17');
    await page.locator('#kb-payment-close').click();
    await page.locator('#kb-history-open').click();
    await billButton.click();
    await method.selectOption('Split');
    await method.press('Enter');
    check('Reopening checkout discards the abandoned split amounts',await payment.locator('[name=cardAmount]').inputValue()==='0');
    await payment.locator('[name=cardAmount]').fill('50');
    await payment.locator('[name=cardRef]').fill('SAMPLE-CARD');
    await payment.locator('[name=upiAmount]').fill((due-50).toFixed(2));
    await payment.locator('[name=upiRef]').fill('SAMPLE-UPI');
    await payment.locator('button[type=submit]').click();
   }else{
    const confirmUpi=payment.getByRole('button',{name:'Confirm Payment Received',exact:true});
    await confirmUpi.waitFor();
    check('UPI waits for explicit confirmation before settling the sent order',
     await confirmUpi.evaluate(button=>button===document.activeElement)&&!q(ticketSql)[0].transaction_id);
    await page.keyboard.press('Enter');
   }
   await page.locator('#kb-print-choice[open]').waitFor();
   await page.locator('#kb-print-close').click();
   const billed=q(ticketSql)[0];
   const tenders=()=>q(`SELECT payment_method,amount,reference_number FROM pos_payment WHERE transaction_id='${billed.transaction_id}' ORDER BY payment_method`);
   const bill=q(`SELECT transaction_number,payable_amount,status_id FROM pos_transaction WHERE transaction_id='${billed.transaction_id}'`)[0];
   const expected=grid?[['Card',50],['UPI',due-50]]:[['UPI',due]];
   check(shell+' bills the sent KOT at its saved price and preserves kitchen status and the new cart',
    billed.status_id===status&&billed.kot_date===ticket.kot_date&&bill?.status_id==='PtCompleted'&&Number(bill.payable_amount)===due&&
    JSON.stringify(tenders().map(row=>[row.payment_method,Number(row.amount)]))===JSON.stringify(expected)&&
    await page.locator('#kb-cart tr').filter({hasText:'Disposable POS A P5'}).count()===1,{billed,bill,expected});
   if(grid)check('Split persists each digital payment reference',
    JSON.stringify(tenders().map(row=>row.reference_number))===JSON.stringify(['SAMPLE-CARD','SAMPLE-UPI']));
   const retry=await (await request('checkoutKot',{kotId:ticket.kot_id,paymentMethod:'UPI',confirmedTotal:String(due)})).json();
   check(shell+' retry reuses the issued bill without another tender',retry.billNumber===bill.transaction_number&&tenders().length===expected.length);
   await page.locator('#kb-history-open').click();
   await page.locator('#kb-history-rows').getByText(bill.transaction_number,{exact:false}).waitFor();
   check(shell+' no longer offers Bill Out for the paid ticket',await billButton.count()===0);
  }
  const tableStatus=()=>q(`SELECT status_id FROM restaurant_table WHERE table_id='${tableId}'`)[0].status_id;
  const creditPhone='9000000001';
  const creditOrder=await (await request('createKot',{
   itemsJson,orderType:'Dine In',tableId,taxOn:'N',salesModeId:'RETAIL',wantJson:'Y'
  })).json();
  const creditTicket=()=>q(`SELECT status_id,transaction_id FROM kitchen_order_ticket WHERE kot_id='${creditOrder.kotId}'`)[0];
  const advance=statusId=>a.c.request.post(base+'/apps/zenith/kot/KitchenDisplay/updateStatus',{
   maxRedirects:0,form:{moquiSessionToken:a.t,kotId:creditOrder.kotId,statusId}});
  await advance('KotPreparing');
  const credit=await (await request('checkoutKot',{kotId:creditOrder.kotId,paymentMethod:'Credit',
   customerName:'Synthetic KOT credit customer',customerPhone:creditPhone,upfrontAmount:'30',upfrontMethod:'Card',creditDays:'7'})).json();
  const receivable=q(`SELECT is_credit,customer_party_id,payable_amount,paid_amount,credit_days FROM pos_transaction WHERE transaction_id='${creditTicket()?.transaction_id}'`)[0];
  check('Credit checkout preserves the named customer and keeps its table occupied until serving',
   credit.success&&receivable?.is_credit==='Y'&&receivable.customer_party_id==='POSCUST_POS_QA_A_'+creditPhone&&Number(receivable.payable_amount)===100&&
   Number(receivable.paid_amount)===30&&Number(receivable.credit_days)===7&&creditTicket().status_id==='KotPreparing'&&tableStatus()==='TblOccupied',{creditOrder,credit,receivable});
  await advance('KotReady');
  await advance('KotServed');
  check('Serving the last paid dine-in ticket releases its table',creditTicket().status_id==='KotServed'&&tableStatus()==='TblAvailable');
  const posCart=await invoke('cart',{sessionId});
  await invoke('add',{transactionId:posCart.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await invoke('kitchenSend',{posTransactionId:posCart.transactionId,items:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}])});
  check('shared POS send records the terminal so the shop policy follows the ticket',q(`SELECT terminal_id FROM kitchen_order_ticket WHERE transaction_id='${posCart.transactionId}'`)[0]?.terminal_id===terminalId);
  await invoke('void',{transactionId:posCart.transactionId});
  await require('./verify-kot-idle.cjs')({browser:a.c.browser(),base,check,q,sessionId});
 } catch(error) {
  console.error('KOT gateway state',page.url(),(await page.locator('body').innerText()).slice(-1800));
  if(out)await page.screenshot({path:require('node:path').join(out,'kot-gateway-failure.png')});
  throw error;
 } finally {
  await a.c.request.post(base+'/apps/zenith/kot/KitchenDisplay/saveDisplayPolicy',{maxRedirects:0,form:{moquiSessionToken:a.t,facilityId:'POS_QA_A_FAC',enabled:'Y'}});
  await page.close();
  if(sessionId)await invoke('close',{sessionId,closingCash:'100'});
 }
};
