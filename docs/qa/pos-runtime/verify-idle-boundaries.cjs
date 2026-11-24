const path=require('node:path');
module.exports=async function({a,base,check,q,invoke,post,out,loggedOutSweep}) {
 await post('PosQaAcceptance','invoke',{op:'idleJobState',paused:'Y'});
 const get=id=>q(`SELECT * FROM pos_session WHERE session_id='${id}'`)[0];
 const financial=id=>({transactions:q(`SELECT * FROM pos_transaction WHERE session_id='${id}'`),expenses:q(`SELECT * FROM pos_expense WHERE session_id='${id}'`),returns:q(`SELECT * FROM pos_return WHERE session_id='${id}'`),counts:q(`SELECT * FROM cash_denomination WHERE session_id='${id}'`)});
 async function clock(id,minutes){const r=await post('PosQaAcceptance','idleClock',{sessionId:id,minutes:String(minutes)});check('controlled idle clock '+minutes+' minutes',(await r.json()).backdated===true);}
 const empty=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const before=financial(empty.sessionId);
 check('POS-03-07 begins with no bill or financial entry',Object.values(before).every(rows=>rows.length===0),before);
 await clock(empty.sessionId,61);
 const result=await loggedOutSweep('pos.qa');
 const closed=get(empty.sessionId),after=financial(empty.sessionId);
 check('POS-03-07 closes the empty session after logout without inventing money',result.closedCount===1&&closed.status_id==='PsClosed'&&closed.closing_cash===null&&closed.expected_cash===null&&closed.cash_difference===null&&Object.values(after).every(rows=>rows.length===0),{result,closed,after});
 const repeated=await loggedOutSweep('pos.qa');
 check('POS-03-07 repeated sweep preserves the single close',repeated.closedCount===0&&get(empty.sessionId).close_date===closed.close_date);
 const active=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const cart=await invoke('cart',{sessionId:active.sessionId});
 await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});
 await invoke('pay',{transactionId:cart.transactionId,paymentMethod:'Cash',amount:'5'});await invoke('complete',{transactionId:cart.transactionId});
 const page=await a.c.newPage();page.setDefaultTimeout(30000);
 try {
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${active.sessionId}&taxOn=N`);
  await page.waitForFunction(()=>typeof window._posCurrentTax==='function');
  await page.waitForLoadState('networkidle');
  for(let reset=0;reset<2;reset++) {
   await clock(active.sessionId,55);
   const old=get(active.sessionId).last_activity_date;
   await page.evaluate(()=>{window.posBoundaryOffset=(window.posBoundaryOffset||0)+31000;if(!window.posBoundaryRealNow){window.posBoundaryRealNow=Date.now.bind(Date);Date.now=()=>window.posBoundaryRealNow()+window.posBoundaryOffset;}});
   const touched=page.waitForResponse(r=>r.url().includes('/Terminal/touchSession')&&new URLSearchParams(r.request().postData()||'').get('activity')==='Y');
   await page.locator('#cartInlineSearch').press(reset?'b':'a');await touched;
   const touch=get(active.sessionId);
   check('POS-03-06 qualifying keyboard input resets server activity '+(reset+1),new Date(touch.last_activity_date)>new Date(old)&&touch.status_id==='PsOpen',{before:old,after:touch.last_activity_date});
   await clock(active.sessionId,5);
   const latest=get(active.sessionId).last_activity_date;
   await a.c.request.get(base+'/apps/zenith/pos/PosSessions');
   await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId:active.sessionId});
   const originalDeadline=await loggedOutSweep('pos.qa');
   check('POS-03-06 original deadline stays open five minutes after input '+(reset+1),originalDeadline.closedCount===0&&get(active.sessionId).status_id==='PsOpen'&&get(active.sessionId).last_activity_date===latest);
  }
 } finally {await page.close();}
 await clock(active.sessionId,61);
 const expired=await loggedOutSweep('pos.qa'),ended=get(active.sessionId);
 check('POS-03-06 reset deadline closes after a full idle hour',expired.closedCount===1&&ended.status_id==='PsClosed'&&ended.closing_cash===null&&ended.expected_cash===null&&ended.cash_difference===null&&Number(ended.total_sales)===5,ended);
 const twice=await loggedOutSweep('pos.qa');
 check('POS-03-06 closes once and preserves its bill and tender',twice.closedCount===0&&get(active.sessionId).close_date===ended.close_date&&q(`SELECT * FROM pos_transaction WHERE transaction_id='${cart.transactionId}' AND status_id='PtCompleted'`).length===1&&Number(q(`SELECT amount FROM pos_payment WHERE transaction_id='${cart.transactionId}'`)[0].amount)===5);
 for(const shell of ['apps','qapps'])for(const [name,id] of [['empty',empty.sessionId],['activity-reset',active.sessionId]]){
  const p=await a.c.newPage();await p.goto(`${base}/${shell}/zenith/pos/EditSession?sessionId=${id}`);
  await p.getByText('Cash not counted',{exact:false}).first().waitFor();
  check(shell+' '+name+' idle-close status survives reload',(await p.locator('body').innerText()).includes('Cash not counted'));
  await p.screenshot({path:path.join(out,`${shell}-idle-${name}-verified.png`),fullPage:true});await p.close();
 }
};
