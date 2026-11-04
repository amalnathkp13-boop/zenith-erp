// Holding and recalling stay in fullscreen. QZ is mocked so no workstation device is contacted.
module.exports=async({a,base,check,q,invoke,post})=>{
 const terminalId='POS_QA_A_HOLD_PRINT';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable hold printer counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'}),page=await a.c.newPage();
 await page.addInitScript(`
  window.qaHoldPrinter={connections:0,jobs:0};window.qz={
   websocket:{isActive:()=>false,connect:()=>{qaHoldPrinter.connections++;return Promise.resolve();}},
   printers:{find:()=>Promise.resolve(['Disposable printer'])},configs:{create:()=>({})},
   print:()=>{qaHoldPrinter.jobs++;return Promise.resolve();}};`);
 let namedDraft, heldId, closingCash='0';
 try{
  for(const [index,taxOn] of ['N','Y','N'].entries()){
   const bill=await invoke('cart',{sessionId:session.sessionId});
   await invoke('add',{transactionId:bill.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:'RETAIL',taxOn});
   if(index===2){
    namedDraft=bill.transactionId;
    const attached=await post('Terminal','setCustomer',{transactionId:namedDraft,customerPartyId:'POS_QA_A_CUST_SAME',taxOn});
    check('Hold fixture attaches a named customer',(await attached.json()).success);
   }
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${bill.transactionId}&taxOn=${taxOn}`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.qaHoldPrinter&&window.__posKeysBound);
   await page.locator('#pos-hold').waitFor();
   await page.locator('#posFullscreenBtn').click();
   await page.waitForFunction(()=>document.fullscreenElement);
   const previousUrl=page.url();
   if (index % 2) await page.locator('#pos-hold').click();
   else {
    await page.locator('#cartInlineSearch,#pos-search').first().focus();
    await page.keyboard.press('F7');
   }
   await page.waitForFunction(count=>Number(document.querySelector('#pos-held-wrap .nb-cnt')?.textContent)===count,index+1);
   check('Hold keeps native fullscreen and the terminal document',await page.evaluate(()=>!!document.fullscreenElement)&&new URL(page.url()).pathname===new URL(previousUrl).pathname);
   check('Hold removes the previous draft from the URL',!new URL(page.url()).searchParams.has('transactionId'));
   await page.waitForFunction(()=>document.getElementById('pos-hold')?.disabled);
   await page.waitForTimeout(1500); // Allow a deferred printer probe to run, if one was accidentally scheduled.
   const printer=await page.evaluate(()=>window.qaHoldPrinter);
   check('Hold '+(index+1)+' never connects to QZ or prints',printer?.connections===0&&printer.jobs===0,printer);
   const saved=q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${bill.transactionId}'`)[0];
   const snapshots=q(`SELECT held_id,items_json FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld'`)
       .filter(row=>JSON.parse(row.items_json).some(item=>item.sourceTransactionId===bill.transactionId));
   check('Hold saves the exact draft once',saved.status_id==='PtHeld'&&snapshots.length===1);
   if(index===2) heldId=snapshots[0].held_id;
  }
  await page.evaluate(()=>{window.qaRecallDocument=true;});
  await page.keyboard.press('F9');
  await page.locator(`form[action$="/recallSale"]:has(input[name=heldId][value="${heldId}"]) button`).click();
  await page.locator('.pos-cart .aj-qi').waitFor();
  check('Recall restores the selected bill without leaving native fullscreen or navigating',await page.evaluate(id=>
   !!document.fullscreenElement&&window.qaRecallDocument&&document.querySelector('#cartInlineAddForm input[name=transactionId]')?.value===id,namedDraft));
  await page.waitForFunction(()=>document.querySelector('#pos-held-wrap .nb-cnt')?.textContent==='2');
  check('Recall consumes only the selected held record and restores its customer',
   q(`SELECT status_id FROM pos_held_transaction WHERE held_id='${heldId}'`)[0].status_id==='PhRecalled'&&
   (await page.locator('#pos-header-customer-name').textContent()).includes('POS A SAME'));
  const printer=await page.evaluate(()=>window.qaHoldPrinter);
  check('Recalling a bill never connects to QZ or prints',printer.connections===0&&printer.jobs===0,printer);

  await page.locator('#pos-pay-cash').click();
  await page.locator('#posCashRecv,.pos-cash-input').fill('100');
  await page.locator('#posCashConfirm,.pos-cash-confirm').click();
  await page.waitForFunction(()=>document.getElementById('pos-cart-count')?.textContent==='0');
  const issued=q(`SELECT status_id,customer_party_id,payable_amount FROM pos_transaction WHERE transaction_id='${namedDraft}'`)[0];
  closingCash=String(issued.payable_amount);
  check('Completed bill keeps its named customer',issued.status_id==='PtCompleted'&&issued.customer_party_id==='POS_QA_A_CUST_SAME');
  check('Successful checkout shows Walk-in Customer for the next bill',
   (await page.locator('#pos-header-customer-name').textContent())==='Walk-in Customer'&&
   (await page.locator('#pos-cust-name').textContent())==='Walk-in Customer');
 }finally{
  await post('Terminal','closeSession',{sessionId:session.sessionId,closingCash,wantJson:'1'});
  await page.close();
 }
};
