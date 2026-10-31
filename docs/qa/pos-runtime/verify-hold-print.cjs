// A held draft is never a printer action. QZ is mocked; no workstation device is contacted.
module.exports=async({a,base,check,q,invoke,post})=>{
 const terminalId='POS_QA_A_HOLD_PRINT';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable hold printer counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'}),page=await a.c.newPage();
 await page.addInitScript(`
  window.qaHoldPrinter={connections:0,jobs:0};window.qz={
   websocket:{isActive:()=>false,connect:()=>{qaHoldPrinter.connections++;return Promise.resolve();}},
   printers:{find:()=>Promise.resolve(['Disposable printer'])},configs:{create:()=>({})},
   print:()=>{qaHoldPrinter.jobs++;return Promise.resolve();}};`);
 try{
  for(const [index,taxOn] of ['N','Y','N'].entries()){
   const bill=await invoke('cart',{sessionId:session.sessionId});
   await invoke('add',{transactionId:bill.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:'RETAIL',taxOn});
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${bill.transactionId}&taxOn=${taxOn}`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.qaHoldPrinter&&window.__posKeysBound);
   await page.locator('#pos-hold').waitFor();
   await page.locator('#cartInlineSearch,#pos-search').first().focus();
   await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.keyboard.press('F7')]);
   await page.waitForFunction(()=>window.qaHoldPrinter&&window.__posKeysBound);
   await page.waitForFunction(()=>document.getElementById('pos-hold')?.disabled);
   await page.waitForTimeout(1500); // Includes the old page-load printer probe after Hold.
   const printer=await page.evaluate(()=>window.qaHoldPrinter);
   check('F7 hold '+(index+1)+' never connects to QZ or prints',printer?.connections===0&&printer.jobs===0,printer);
   const saved=q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${bill.transactionId}'`)[0];
   const snapshots=q(`SELECT items_json FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld'`)
       .filter(row=>JSON.parse(row.items_json).some(item=>item.sourceTransactionId===bill.transactionId));
   check('F7 holds the exact draft once',saved.status_id==='PtHeld'&&snapshots.length===1);
  }
 }finally{
  await post('Terminal','closeSession',{sessionId:session.sessionId,closingCash:'0',wantJson:'1'});
  await page.close();
 }
};
