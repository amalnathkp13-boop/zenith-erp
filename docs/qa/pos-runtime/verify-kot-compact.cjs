const path=require('node:path');
module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 let session;
 const screen='Kitchen/KotBilling';
 const json=async(action,args,actor=a)=>{
  const response=await post(screen,action,{sessionId:session?.sessionId,...args},actor);
  return {status:response.status(),data:await response.json().catch(()=>null)};
 };
 const lookup=await json('searchMenu',{term:'pos a p18',salesModeId:'RETAIL'});
 check('KOT searches the full POS catalogue through a scoped endpoint',lookup.data?.success&&lookup.data.products.some(p=>p.id==='POS_QA_A_P18'),lookup);
 const other=await json('searchMenu',{term:'pos_qa_a_p18',salesModeId:'RETAIL'},foreign);
 check('KOT lookup cannot find another organization’s product',other.data?.success&&other.data.products.length===0,other);
 const catalogue=await json('searchMenu',{term:'',salesModeId:'RETAIL'},foreign);
 check('Browsing the grid only returns products from the active organization',catalogue.data?.success&&
  catalogue.data.products.some(p=>p.id==='POS_QA_B_P18')&&!catalogue.data.products.some(p=>p.id.startsWith('POS_QA_A_')),catalogue);
 const mode=await json('searchMenu',{term:'POS_QA_A_NOWS',salesModeId:'WHOLESALE'});
 check('KOT inherits MRP when a fixed mode has no override',Number(mode.data?.products?.[0]?.price)===50,mode);
 const terminalId='POS_QA_A_KB_'+Date.now().toString(36);
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable KOT checkout',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 session=await invoke('open',{terminalId,openingCash:'0'});
 const page=await a.c.newPage();
 const waiterName='Disposable compact KOT waiter '+Date.now().toString(36);
 await post('Kitchen/WaiterManagement','createWaiter',{waiterName,phone:'0000000000',isActive:'Y'});
 try{
  await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+session.sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  check('Default workspace has one search and tax toggle, no permanent catalogue',await page.locator('#kb-search').count()===1&&await page.getByRole('switch',{name:'Tax'}).count()===1&&await page.locator('.kb-catlist,.kb-menu').count()===0);
  await page.locator('#kb-mode').selectOption('RETAIL');
  await page.locator('#kb-waiter').selectOption({label:waiterName});
  await page.locator('[data-ot="Take Away"]').click();
  check('Take Away hides table selection',!await page.locator('#kb-table').isVisible());
  await page.getByRole('switch',{name:'Tax'}).click();
  const search=page.locator('#kb-search');
  const fullscreen=page.locator('#kb-fullscreen'), view=page.locator('#kb-view-grid');
  await view.click();
  const card=page.locator('#kb-suggestions [data-result]').filter({hasText:'Disposable POS A P18'});
  await card.waitFor();
  check('Grid View shows a product catalogue with empty search',await search.inputValue()===''&&
   await page.locator('#kb-product-grid .kb-results-grid').isVisible());
  await fullscreen.click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==='kb-wrap');
  check('Grid View can enter native fullscreen',await fullscreen.innerText()==='Exit fullscreen'&&await card.isVisible());
  await page.locator('#kb-history-open').click();
  await page.locator('#kb-history').getByRole('button',{name:'Close',exact:true}).click();
  check('History works in fullscreen',await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.screenshot({path:path.join(out,'kot-grid-fullscreen.png')});
  await fullscreen.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await search.pressSequentially('Disposable POS A P18');
  await page.locator('#kb-suggestions button').filter({hasText:'Disposable POS A P18'}).waitFor();
  check('Spaces within product names stay in search',await search.inputValue()==='Disposable POS A P18'&&!await page.locator('#kb-payment').isVisible());
  await card.click();
  await page.locator('#kb-grand').getByText('₹100.00').waitFor();
  await view.click();
  check('Switching to List View keeps the current order',await view.innerText()==='Grid View'&&
   !await page.locator('#kb-product-grid').isVisible()&&await page.getByRole('table',{name:'Current Order'}).isVisible());
  await fullscreen.click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==='kb-wrap');
  check('List View can enter native fullscreen and keep the current order',await page.locator('#kb-cart tr').count()===1);
  await search.fill('POS_QA_A_P18');await search.press('Enter');
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  check('An exact product code increments the existing line',await page.locator('#kb-cart tr').count()===1);
  await page.locator('#kb-instr').fill('No onion');
  await page.locator('#kb-instr').press('Space');
  check('Space in kitchen notes does not open checkout',!await page.locator('#kb-payment').isVisible());
  await page.getByRole('switch',{name:'Tax'}).click();
  await page.locator('#kb-grand').getByText('₹236.00').waitFor();
  await page.getByRole('switch',{name:'Tax'}).click();
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  await page.screenshot({path:path.join(out,'kot-compact-billing.png')});
  await search.press('Space');
  await page.locator('#kb-payment').waitFor();
  check('Space from an empty search opens checkout in fullscreen with exact Cash prefilled',Number(await page.locator('#kb-cash').inputValue())===200&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.locator('#kb-payment-close').click();
  await fullscreen.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await search.press('Space');
  await page.locator('#kb-payment').waitFor();
  check('Checkout keeps the selected entry terminal',await page.locator('input[name=sessionId]').inputValue()===session.sessionId);
  await page.evaluate(()=>{
   window.kotPrints=[];
   window.open=()=>{
    let html='';
    return {document:{open(){html='';},write(x){html+=x;},close(){},images:[]},
     closed:false,focus(){},print(){window.kotPrints.push(html);},close(){this.closed=true;}};
   };
  });
  await page.locator('#kb-cash').press('Enter');
  await page.waitForFunction(()=>window.kotPrints.length===2);
  const kot=q("SELECT kot_id,transaction_id,waiter_name,table_id,notes FROM kitchen_order_ticket WHERE waiter_name='"+waiterName+"' AND transaction_id IS NOT NULL ORDER BY kot_id DESC")[0];
  const tx=q("SELECT transaction_number,payable_amount,status_id FROM pos_transaction WHERE transaction_id='"+kot.transaction_id+"'")[0];
  const printed=await page.evaluate(()=>window.kotPrints);
  check('Take Away creates one completed bill and prints both saved documents',tx.status_id==='PtCompleted'&&Number(tx.payable_amount)===200&&!kot.table_id&&kot.notes.includes('Take Away')&&printed[0].includes('KOT #')&&printed[0].includes('No onion')&&printed[1].includes(tx.transaction_number),{kot,tx});
  const replay=await json('checkoutKot',{kotId:kot.kot_id,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'200'});
  check('Retry returns the same paid bill without another tender',replay.data?.billNumber===tx.transaction_number&&q("SELECT amount FROM pos_payment WHERE transaction_id='"+kot.transaction_id+"'").length===1,replay);
  const denied=await json('checkoutKot',{kotId:kot.kot_id,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'200'},foreign);
  check('Another organization cannot bill or retry the order',!denied.data?.success,denied);
  const draft=await json('saveDraft',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]),
   salesModeId:'RETAIL',orderType:'Take Away',taxOn:'N',wantJson:'Y'});
  const txs=()=>q("SELECT transaction_id,status_id,paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' ORDER BY transaction_id");
  const beforeFailure=txs();
  const short=await json('checkoutKot',{kotId:draft.data.kotId,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'10'});
  check('An underpayment leaves no partial tender or completed sale',!short.data?.success&&JSON.stringify(txs())===JSON.stringify(beforeFailure),short);
  await post(screen,'deleteDraft',{kotId:draft.data.kotId});
  await page.locator('#kb-history-open').click();
  await page.locator('#kb-history').getByText(waiterName,{exact:false}).first().waitFor();
  check('Saved checkout is available in the in-page History',new URL(page.url()).pathname.endsWith('/KotBilling'));
 }finally{
  await page.close();
  const paid=q("SELECT paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'").reduce((sum,x)=>sum+Number(x.paid_amount),0);
  await invoke('close',{sessionId:session.sessionId,closingCash:String(paid)});
 }
};
