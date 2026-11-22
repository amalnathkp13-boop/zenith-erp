const path=require('node:path');
module.exports=async function({a,foreign,base,check,q,invoke,post,out}){
 async function loggedOutSweep(user,op='idleSweepLoggedOut'){
  const context=await a.p.context().browser().newContext();
  await context.request.get(base+'/apps/zenith/Contacts/Customers',{headers:{Authorization:'Basic '+Buffer.from(user+':moqui').toString('base64')}});
  const page=await context.newPage();await page.goto(base+'/apps/zenith/Contacts/Customers');
  const token=await page.locator('[name=moquiSessionToken]').first().inputValue();
  const response=await context.request.post(base+'/apps/zenith/pos/PosQaAcceptance/invoke',{form:{moquiSessionToken:token,op:op}});
  const result=await response.json();await context.close();return result;
 }
 const s=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const t=await invoke('cart',{sessionId:s.sessionId});
 await invoke('add',{transactionId:t.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});
 await invoke('pay',{transactionId:t.transactionId,paymentMethod:'Cash',amount:'5'});await invoke('complete',{transactionId:t.transactionId});
 const backdated=await post('PosQaAcceptance','idleClock',{sessionId:s.sessionId});check('disposable clock moves last activity past one hour',(await backdated.json()).backdated);
 const result=await loggedOutSweep('pos.qa');
 const row=q(`SELECT * FROM pos_session WHERE session_id='${s.sessionId}'`)[0];
 check('background sweep closes an opted-in sold session after authentication logout',result.closedCount===1&&row.status_id==='PsClosed',result);
 check('logout idle close retains money and leaves cash unverified',row.close_reason==='IdleUnverifiedCash'&&row.closing_cash===null&&row.expected_cash===null&&row.cash_difference===null&&Number(row.total_sales)===5&&Number(q(`SELECT amount FROM pos_payment WHERE transaction_id='${t.transactionId}'`)[0].amount)===5);
 const b=await invoke('open',{terminalId:'POS_QA_B_TERM1',openingCash:'100'},false,foreign);
 const bt=await invoke('cart',{sessionId:b.sessionId},false,foreign);
 await invoke('add',{transactionId:bt.transactionId,productId:'POS_QA_B_P18',quantity:'1',unitPrice:'5',taxOn:'N'},false,foreign);
 await invoke('pay',{transactionId:bt.transactionId,paymentMethod:'Cash',amount:'5'},false,foreign);await invoke('complete',{transactionId:bt.transactionId},false,foreign);
 await post('PosQaAcceptance','idleClock',{sessionId:b.sessionId},foreign);
 const secondBody=await loggedOutSweep('pos.b.qa');
 check('new session without an organization opt-in is NOT auto-closed (opt-in gate; no-config != consent)',secondBody.closedCount===0&&q(`SELECT status_id FROM pos_session WHERE session_id='${b.sessionId}'`)[0].status_id==='PsOpen',secondBody);
 check('existing sweep job retains its identity and uses minute-level cadence',q("SELECT cron_expression FROM service_job WHERE job_name='zenith_PosIdleSessionSweep_5min'")[0].cron_expression==='0 * * * * ?');
 for(const shell of ['apps','qapps']){
  const page=await a.c.newPage();await page.goto(`${base}/${shell}/zenith/pos/PosSessions`);
  await page.getByText('Automatic session close',{exact:true}).waitFor();
  if(shell==='apps')await page.locator('#IdleSessionPolicyForm_enabled').selectOption('N');
  else{await page.locator('.q-select').filter({hasText:'Close after 1 hour idle'}).click();await page.getByRole('option',{name:'No (explicit opt-out)',exact:true}).click();}
  const response=page.waitForResponse(r=>r.url().includes('/saveIdlePolicy'));
  await page.getByRole('button',{name:'Save automatic-close policy',exact:true}).click();await response;await page.waitForLoadState('networkidle');
  const config=q("SELECT idle_session_auto_close,daily_bill_numbering FROM pos_org_billing_config WHERE organization_party_id='POS_QA_A'")[0];
  check(`${shell} manager can opt out without changing bill-number settings`,config.idle_session_auto_close==='N'&&config.daily_bill_numbering==='Y');
  await page.screenshot({path:path.join(out,`${shell}-idle-session-policy.png`),fullPage:true});await page.close();
  await post('PosSessions','saveIdlePolicy',{enabled:'Y'});
 }
 await post('PosSessions','saveIdlePolicy',{enabled:'N'});
 const optedOut=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const ot=await invoke('cart',{sessionId:optedOut.sessionId});await invoke('add',{transactionId:ot.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});await invoke('pay',{transactionId:ot.transactionId,paymentMethod:'Cash',amount:'5'});await invoke('complete',{transactionId:ot.transactionId});
 await post('PosQaAcceptance','idleClock',{sessionId:optedOut.sessionId});await loggedOutSweep('pos.qa');
 check('explicit organization opt-out prevents timer closure',q(`SELECT status_id FROM pos_session WHERE session_id='${optedOut.sessionId}'`)[0].status_id==='PsOpen');
 await post('PosSessions','saveIdlePolicy',{enabled:'Y'});await loggedOutSweep('pos.qa');
 const restored=q(`SELECT * FROM pos_session WHERE session_id='${optedOut.sessionId}'`)[0];
 check('manager enabling policy closes an eligible existing sold session with cash unverified',restored.status_id==='PsClosed'&&restored.closing_cash===null&&restored.close_reason==='IdleUnverifiedCash');
 const race=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const rt=await invoke('cart',{sessionId:race.sessionId});await invoke('add',{transactionId:rt.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});await invoke('pay',{transactionId:rt.transactionId,paymentMethod:'Cash',amount:'5'});
 await post('PosQaAcceptance','idleClock',{sessionId:race.sessionId});
 await Promise.all([post('Terminal','closeIdleSession',{sessionId:race.sessionId}),invoke('complete',{transactionId:rt.transactionId})]);
 check('a sale finishing at the idle boundary commits once and keeps its active session open',q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${rt.transactionId}'`)[0].status_id==='PtCompleted'&&q(`SELECT status_id FROM pos_session WHERE session_id='${race.sessionId}'`)[0].status_id==='PsOpen'&&Number(q(`SELECT count(*) AS n FROM pos_payment WHERE transaction_id='${rt.transactionId}'`)[0].n)===1);
 await invoke('close',{sessionId:race.sessionId,closingCash:'105'});
 if(process.env.POS_QA_REAL_SCHEDULER==='true'){
 const automatic=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'100'});
 const at=await invoke('cart',{sessionId:automatic.sessionId});await invoke('add',{transactionId:at.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});await invoke('pay',{transactionId:at.transactionId,paymentMethod:'Cash',amount:'5'});await invoke('complete',{transactionId:at.transactionId});
 await post('PosQaAcceptance','idleClock',{sessionId:automatic.sessionId});
 await loggedOutSweep('pos.qa','idleLogout');
 const resumed=await post('PosQaAcceptance','invoke',{op:'idleJobState',paused:'N'});check('real scheduled worker is enabled in disposable runtime',(await resumed.json()).updated);
 console.log('Waiting for the real anonymous scheduled sweep; no browser close endpoint is called.');
 let automaticRow,deadline=Date.now()+180000;
 do {automaticRow=q(`SELECT * FROM pos_session WHERE session_id='${automatic.sessionId}'`)[0];if(automaticRow.status_id==='PsClosed')break;await new Promise(resolve=>setTimeout(resolve,2000));}while(Date.now()<deadline);
 check('real scheduled job closes the logged-out idle sold session',automaticRow.status_id==='PsClosed'&&automaticRow.close_reason==='IdleUnverifiedCash'&&automaticRow.closing_cash===null&&Number(automaticRow.total_sales)===5,automaticRow);
 check('idle sweep actually ran on the scheduler',Number(q("SELECT count(*) AS n FROM service_job_run WHERE job_name='zenith_PosIdleSessionSweep_5min'")[0].n)>0);
 for(const shell of ['apps','qapps']){const page=await a.c.newPage();await page.goto(`${base}/${shell}/zenith/pos/PosSessions`);await page.getByText('Automatic session close',{exact:true}).waitFor();check(`${shell} session list exposes the unverified auto-close status`,(await page.locator('body').innerText()).includes('Auto-closed'));await page.screenshot({path:path.join(out,`${shell}-auto-session-closed.png`),fullPage:true});await page.close();}
 }

 await require('./verify-idle-boundaries.cjs')({a,base,check,q,invoke,post,out,loggedOutSweep});
 await require('./verify-idle-preserved-work.cjs')({a,base,check,q,invoke,post});
 await require('./verify-idle-live-browser.cjs')({a,base,check,q,invoke,post,out});

};
