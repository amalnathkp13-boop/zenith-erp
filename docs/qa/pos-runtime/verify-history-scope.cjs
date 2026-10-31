// Three terminals, two shops, two operators; all records belong to disposable POS_QA organizations.
module.exports=async function({a,foreign,base,check,q,invoke,post,out}) {
 const c=await a.c.browser().newContext({viewport:{width:1366,height:768}});
 await c.request.get(base+'/apps/zenith/pos/Terminal',{headers:{Authorization:'Basic '+Buffer.from('pos.cashier.qa:moqui').toString('base64')}});
 const page=await c.newPage();await page.goto(base+'/apps/zenith/pos/Terminal');
 const cashier={c,p:page,t:await page.locator('[name=moquiSessionToken]').first().inputValue()};
 const ids=['POS_QA_SCOPE_1','POS_QA_SCOPE_2','POS_QA_SCOPE_3'];
 const bills=[],sessions=[];
 const api=async(actor,params)=>{const r=await post('Terminal','ajaxCart',params,actor);return {r,d:await r.json().catch(()=>({success:false}))};};
 async function sale(index,actor,price){
  const session=await invoke('open',{terminalId:ids[index],openingCash:'0'},false,actor);sessions.push({session,actor});
  const tx=await invoke('cart',{sessionId:session.sessionId},false,actor);
  await invoke('add',{transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:String(price),taxOn:'N'},false,actor);
  await invoke('pay',{transactionId:tx.transactionId,paymentMethod:'Card',amount:String(price)},false,actor);
  await invoke('complete',{transactionId:tx.transactionId},false,actor);
  bills.push(tx.transactionId);return {session,tx};
 }
 try {
  for(let i=0;i<3;i++)await post('PosTerminals','createTerminal',{terminalId:ids[i],terminalName:'Disposable scope counter '+(i+1),facilityId:i<2?'POS_QA_A_FAC':'POS_QA_A_FAC2',organizationPartyId:'POS_QA_A',stateCode:'33',countryGeoId:'IND',isActive:'Y'});
  const own=await sale(0,cashier,11),otherCounter=await sale(1,cashier,22),otherShop=await sale(2,a,33);
  const foreignTerminal='POS_QA_SCOPE_B';
  await post('PosTerminals','createTerminal',{terminalId:foreignTerminal,terminalName:'Foreign synthetic scope counter',facilityId:'POS_QA_B_FAC',organizationPartyId:'POS_QA_B',stateCode:'33',isActive:'Y'},foreign);
  const foreignSession=await invoke('open',{terminalId:foreignTerminal,openingCash:'0'},false,foreign);sessions.push({session:foreignSession,actor:foreign});
  const foreignBill=await invoke('cart',{sessionId:foreignSession.sessionId,customerName:'Foreign scope sentinel'},false,foreign);
  await invoke('add',{transactionId:foreignBill.transactionId,productId:'POS_QA_B_P18',unitPrice:'123',quantity:'1',taxOn:'N'},false,foreign);
  await invoke('pay',{transactionId:foreignBill.transactionId,paymentMethod:'Card',amount:'123'},false,foreign);await invoke('complete',{transactionId:foreignBill.transactionId},false,foreign);

  await invoke('close',{sessionId:own.session.sessionId,closingCash:'0'},false,cashier);
  const otherLogin=await sale(0,a,44);
  const history=await api(cashier,{action:'billHistory',sessionId:own.session.sessionId,histLimit:'100'});
  check('cashier history contains only this terminal and login',history.d.success&&history.d.bills.length===1&&history.d.bills[0].txId===own.tx.transactionId,history.d);
  const next=await api(cashier,{action:'billHistory',terminalId:ids[1],histLimit:'100'});
  check('same login on another counter receives that counter only',next.d.success&&next.d.bills.length===1&&next.d.bills[0].txId===otherCounter.tx.transactionId,next.d);
  const empty=await api(cashier,{action:'billHistory',terminalId:ids[2]});
  check('forged shop terminal cannot expose another login history',empty.d.success&&empty.d.bills.length===0,empty.d);
  const foreignHistory=await api(cashier,{action:'billHistory',terminalId:'POS_QA_B_TERM1'});
  check('foreign tenant terminal history is rejected',foreignHistory.r.status()===403||foreignHistory.d.success===false,foreignHistory.d);
  for(const id of [otherLogin.tx.transactionId,otherShop.tx.transactionId]){
   const receipt=await api(cashier,{action:'receiptData',transactionId:id});
   check('cashier cannot reprint another operator bill '+id,receipt.r.status()===403||receipt.d.success===false,receipt.d);
   const pdf=await c.request.get(`${base}/apps/zenith/pos/ReceiptPdf?transactionId=${id}`);
   check('direct PDF denies another operator bill '+id,pdf.status()===403||!(pdf.headers()['content-type']||'').includes('application/pdf'));
   const edit=await api(cashier,{action:'amendBill',editTxId:id,editReason:'Forbidden synthetic probe',editItems:'[]'});
   check('direct amendment denies another operator bill '+id,edit.r.status()===403||edit.d.success===false,edit.d);
  }
  const authorized=await api(cashier,{action:'receiptData',transactionId:own.tx.transactionId});
  check('cashier can reprint their saved bill',authorized.d.success&&Number(authorized.d.summary.total)===11,authorized.d);
  const owner=await api(a,{action:'billHistory',sessionId:otherLogin.session.sessionId});
  check('owner terminal history includes both operators on that terminal',owner.d.success&&owner.d.bills.length===2&&owner.d.bills.every(b=>[own.tx.transactionId,otherLogin.tx.transactionId].includes(b.txId)),owner.d);
  const p=await a.c.newPage();
  try {
   for(const facility of ['', 'POS_QA_A_FAC','POS_QA_A_FAC2']){
    await a.c.request.post(base+'/apps/zenith/setActiveShop',{form:{moquiSessionToken:a.t,facilityId:facility}});
    await p.goto(base+'/apps/zenith/pos/Dashboard');
    check('owner dashboard excludes another organization recent-bill details',!(await p.locator('body').innerText()).includes('Foreign scope sentinel'));
    const where=facility?` AND s.terminal_id IN (SELECT terminal_id FROM pos_terminal WHERE facility_id='${facility}')`:'';
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const start=new Date(today+'T00:00:00+05:30'),end=new Date(start.getTime()+86400000);
    const stamp=d=>d.toISOString().slice(0,19).replace('T',' ');
    const expected=q(`SELECT count(*) AS n,coalesce(sum(t.payable_amount),0) AS amount FROM pos_transaction t JOIN pos_session s ON s.session_id=t.session_id WHERE t.organization_party_id='POS_QA_A' AND t.status_id='PtCompleted' AND t.entry_date >= '${stamp(start)}' AND t.entry_date < '${stamp(end)}'${where}`)[0];
    const metric=p.locator('.pos-dash-metric').filter({has:p.locator('.pos-dash-metric-label', {hasText:'Total Sales'})});
    const amount=Number((await metric.locator('strong').innerText()).replace(/[^\d.]/g,''));
    check('owner dashboard count and value match '+(facility||'All Shops'),amount===Number(expected.amount)&&(await metric.locator('.pos-dash-metric-sub').innerText())===`${expected.n} Orders`,{amount,expected});
   }
   await a.c.request.post(base+'/apps/zenith/setActiveShop',{form:{moquiSessionToken:a.t,facilityId:''}});
   await p.goto(base+'/apps/zenith/pos/Dashboard?dashLoc=POS_QA_B_FAC');
   check('invalid or foreign location yields zero instead of combined sales',await p.locator('.pos-dash-metric').first().locator('strong').innerText()==='₹0.00');
   if(out)await p.screenshot({path:require('node:path').join(out,'owner-shop-scope.png')});
  }finally{await a.c.request.post(base+'/apps/zenith/setActiveShop',{form:{moquiSessionToken:a.t,facilityId:''}});await p.close();}
  for(const shell of ['apps','qapps']){
   const raw=await c.request.get(`${base}/${shell}/zenith/Inventory/FindProduct`);const html=await raw.text();
   if(shell==='apps')check(shell+' embeds cashier allowlist in initial response',html.includes('data-nav-restricted="true"')&&!/<a[^>]+class="zs-link"[^>]+data-mod="sales"/.test(html));
   await page.goto(`${base}/${shell}/zenith/Inventory/FindProduct`);
   if(shell==='qapps')await page.locator('#zq-sidebar').waitFor();
   const navigation=page.locator(shell==='apps'?'#z-subnav':'#zq-subnav');
   await navigation.locator('.zsn-trigger:not([disabled])').waitFor();
   const geometry=await navigation.evaluate(nav=>{const box=node=>node.getBoundingClientRect().toJSON();return {nav:box(nav),strip:box(nav.querySelector('.zsub-grp.show,.zsn-strip')),button:box(nav.querySelector('.zsn-trigger'))};});
   check(shell+' real Bootstrap/Quasar navigation keeps Customize beside the tabs',geometry.button.left>=geometry.strip.right-1&&geometry.button.top>=geometry.nav.top&&geometry.button.bottom<=geometry.nav.bottom,geometry);
   for(const wait of [0,3500]){
    await page.waitForTimeout(wait);
    const forbidden=page.locator(shell==='qapps'?'.zqs-link[data-mod="sales"]':'.zs-link[data-mod="sales"]');
    check(shell+' never displays Sales to cashier after '+wait+'ms',await forbidden.count()===0||!await forbidden.first().isVisible());
   }
  }
 }finally{
  for(const {session,actor} of sessions){if(q(`SELECT status_id FROM pos_session WHERE session_id='${session.sessionId}'`)[0]?.status_id==='PsOpen')await invoke('close',{sessionId:session.sessionId,closingCash:'0'},false,actor);}
  await c.close();
 }
};
