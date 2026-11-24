module.exports=async function ({a,foreign,base,check,q,invoke,post}) {
 const terminalId='POS_QA_A_LONG_CART';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable long-running cart',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 let {sessionId}=await invoke('open',{terminalId,openingCash:'0'});
 const {transactionId}=await invoke('cart',{sessionId});
 const productId='POS_QA_A_P18';
 const lines=()=>q("SELECT item_seq_id,unit_price FROM pos_transaction_item WHERE transaction_id='"+transactionId+"' ORDER BY item_seq_id");
 const line=()=>lines()[0];
 await invoke('add',{transactionId,productId,quantity:'1',taxOn:'N'});
 const page=await a.c.newPage();
 const terminal=base+'/apps/zenith/pos/Terminal?taxOn=N&sessionId='+sessionId;
 const rate=page.locator('.pos-cart .aj-p');
 const scenario=process.env.POS_QA_RECOVERY_CASE;
 try {
  if(!scenario||scenario==='fresh'){
   await page.goto(terminal+'&freshSale=Y');
   check('Reloading a New Sale link preserves the current draft',!!line()&&await rate.count()===1);
  }
  if(!scenario||scenario==='edit'){
   await page.goto(terminal);
   await page.waitForFunction(()=>typeof window._posCommitEdits==='function');
   let rejected=false;
   await page.route('**/Terminal/ajaxCart',async route=>{
    const form=new URLSearchParams(route.request().postData()||'');
    if(form.get('action')==='updatePrice'&&!rejected){
     rejected=true;
     form.set('itemSeqId','STALE');
     await route.continue({postData:form.toString()});
    }else await route.continue();
   });
   const failed=page.waitForResponse(r=>new URLSearchParams(r.request().postData()||'').get('action')==='updatePrice');
   await rate.fill('63');
   const result=await (await failed).json();
   check('A stale rate edit reaches the real item lookup and is rejected',!result.success&&result.error.includes('Item not found for this bill'));
   await page.getByText(/Item not found for this bill/).first().waitFor();
   await page.waitForFunction(()=>document.querySelector('.pos-cart .aj-p')?.value==='100');
   await rate.fill('70');
   await rate.press('Enter');
   await page.locator('#pos-pay-cash').click();
   await page.locator('.pos-cash-panel').waitFor({timeout:8000});
   check('A subsequent valid edit and Cash proceed without reopening the browser',Number(line().unit_price)===70&&
     (await page.locator('.pos-cash-panel').innerText()).includes('70'));
   await page.locator('.pos-cash-cancel').click();
   let releaseAdd;
   const addGate=new Promise(resolve=>{releaseAdd=resolve;});
   await page.route('**/Terminal/ajaxCart',async route=>{
    if(new URLSearchParams(route.request().postData()||'').get('action')==='addItem') await addGate;
    await route.fallback();
   });
   try {
    const added=page.waitForResponse(r=>new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
    await page.evaluate(id=>window._posAjax(id,100,'Synthetic product'),productId);
    const pending=rate.nth(1);
    await pending.waitFor();
    await pending.fill('88');
    const saved=page.waitForResponse(r=>new URLSearchParams(r.request().postData()||'').get('action')==='updatePrice');
    releaseAdd();
    const addResult=await (await added).json();
    const update=await saved;
    const itemSeq=new URLSearchParams(update.request().postData()).get('itemSeqId');
    check('A rapid rate edit targets the newly saved row for the same product',
      addResult.addedItemSeqId===itemSeq&&(await update.json()).success&&
      lines().map(row=>Number(row.unit_price)).join(',')==='70,88');
    const remove=page.waitForResponse(r=>new URLSearchParams(r.request().postData()||'').get('action')==='removeItem');
    await page.locator('.aj-rm').nth(1).click();
    await remove;
    check('Removing the second rate leaves the first row intact',lines().length===1&&Number(line().unit_price)===70);
   } finally {
    releaseAdd();
   }
  }
  if(!scenario||scenario==='idle'){
   await page.close();
   const savedLines=JSON.stringify(lines());
   const clock=await post('PosQaAcceptance','idleClock',{sessionId,minutes:'61'});
   check('Disposable session clock crossed the one-hour boundary',(await clock.json()).backdated===true);
   const idle=await (await post('Terminal','closeIdleSession',{sessionId})).json();
   check('An idle drawer closes while retaining the unpaid cart and its saved rate',idle.closed&&
     q(`SELECT status_id FROM pos_session WHERE session_id='${sessionId}'`)[0].status_id==='PsClosed'&&
     JSON.stringify(lines())===savedLines,idle);
   const denied=await post('Terminal','ajaxCart',{action:'refresh',recoverDraft:'Y',sessionId},foreign);
   check('Cart recovery rejects a session in another organization',denied.status()===403);
   ({sessionId}=await invoke('open',{terminalId,openingCash:'0'}));
   const recovered=q(`SELECT held_id,items_json FROM pos_held_transaction WHERE session_id='${sessionId}' AND status_id='PhHeld'`)
     .filter(held=>JSON.parse(held.items_json||'[]').some(item=>item.sourceTransactionId===transactionId));
   check('Reopening the counter recovers the original unpaid cart once through Hold Bills',recovered.length===1&&
     q(`SELECT session_id,status_id FROM pos_transaction WHERE transaction_id='${transactionId}'`)[0].session_id===sessionId&&
     JSON.stringify(lines())===savedLines,recovered);
   const heldClock=await post('PosQaAcceptance','idleClock',{sessionId,minutes:'61'});
   check('Disposable held session clock crossed the one-hour boundary',(await heldClock.json()).backdated===true);
   const parked=await (await post('Terminal','closeIdleSession',{sessionId})).json();
   check('The idle policy closes the drawer and preserves a long-held bill',parked.closed&&
     q(`SELECT status_id FROM pos_session WHERE session_id='${sessionId}'`)[0].status_id==='PsClosed'&&
     JSON.stringify(lines())===savedLines,parked);
   ({sessionId}=await invoke('open',{terminalId,openingCash:'0'}));
   const recalled=await invoke('recall',{heldId:recovered[0].held_id,sessionId});
   check('The long-held bill recalls the same saved transaction and rate',recalled.transactionId===transactionId&&
     Number(line().unit_price)===(scenario==='idle'?100:70),recalled);
   await invoke('pay',{transactionId,paymentMethod:'Card',amount:String(Number(line().unit_price))});
   await invoke('complete',{transactionId});
  }
 }finally{
  await page.close();
  if(q(`SELECT status_id FROM pos_session WHERE session_id='${sessionId}'`)[0]?.status_id==='PsOpen')
   await invoke('close',{sessionId,closingCash:'0'});
 }
};
