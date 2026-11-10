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
 session=await invoke('open',{terminalId,openingCash:'100'});
 const page=await a.c.newPage();
 const waiterName='Disposable compact KOT waiter '+Date.now().toString(36);
 await post('Kitchen/WaiterManagement','createWaiter',{waiterName,phone:'0000000000',isActive:'Y'});
 try{
  await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+session.sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  check('KOT Billing uses the full viewport without entering browser fullscreen',await page.locator('#kb-wrap').evaluate(root=>{
   const bounds=root.getBoundingClientRect();
   return !document.fullscreenElement&&bounds.left===0&&bounds.top===0&&bounds.width===innerWidth&&bounds.height===innerHeight
    && Array.from(document.querySelectorAll('#top,#z-sidebar,#z-subnav,#ai-copilot-container')).every(el=>!el.getClientRects().length);
  }));
  check('Default workspace has one search and tax toggle, no permanent catalogue',await page.locator('#kb-search').count()===1&&await page.getByRole('switch',{name:'Tax'}).count()===1&&await page.locator('.kb-catlist,.kb-menu').count()===0);
  await page.locator('#kb-mode').selectOption('RETAIL');
  await page.locator('#kb-waiter').selectOption({label:waiterName});
  await page.locator('[data-ot="Take Away"]').click();
  check('Take Away hides table selection',!await page.locator('#kb-table').isVisible());
  await page.getByRole('switch',{name:'Tax'}).click();
  const search=page.locator('#kb-search');
  const fullscreen=page.locator('#kb-fullscreen'), modes=page.locator('.kg-modes');
  const listMode=modes.getByRole('button',{name:'List View',exact:true});
  const gridMode=modes.getByRole('button',{name:'Grid View',exact:true});
  await modes.locator('summary').click();
  check('Modes is the only layout selector and starts in List View',
   (await modes.getByRole('button').allTextContents()).join('|')==='List View|Grid View'&&
   await listMode.getAttribute('aria-pressed')==='true'&&
   await page.getByRole('button',{name:/^(Grid|List) View/}).count()===2);
  await gridMode.click();
  const card=page.locator('#kb-suggestions [data-result]').filter({hasText:'Disposable POS A P18'});
  await card.waitFor();
  check('Grid View shows a product catalogue with empty search',await search.inputValue()===''&&
   await page.locator('#kb-product-grid .kb-results-grid').isVisible());
  check('Grid keeps the customer in the header and gives the catalogue its own column',
   await page.locator('.kg-header #kb-customer-open').isVisible()&&
   await page.locator('#kb-product-grid').evaluate(panel=>panel.getBoundingClientRect().width>innerWidth*0.4));
  await modes.locator('summary').click();
  check('Grid View is selected in Modes',await gridMode.getAttribute('aria-pressed')==='true');
  await page.locator('.kg-categories button').first().click();
  check('Clicking outside Modes dismisses it',!(await modes.evaluate(el=>el.open)));
  await card.waitFor();
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
  await page.getByRole('button',{name:/^UPI F5$/}).click();
  check('Grid payment buttons open the existing checkout with the selected tender',await page.locator('#kb-payment-method').inputValue()==='UPI');
  await page.locator('#kb-payment-close').click();
  await page.locator('[data-kb-payment="Cash"]').click();
  const cash=page.locator('#kb-cash'), confirmCash=page.locator('.pos-cash-confirm');
  check('Grid Cash opens the POS card with no tender entered',await cash.inputValue()===''&&await confirmCash.isDisabled());
  await cash.fill('50');
  check('Grid underpayment shows the shortfall and blocks confirmation',await confirmCash.isDisabled()&&
   (await page.locator('.pos-cash-change').innerText()).includes('₹50 more needed'));
  await page.locator('.pos-cash-quick[data-amt="100"]').click();
  check('Grid exact quick amount enables confirmation',await confirmCash.isEnabled()&&
   (await page.locator('.pos-cash-change').innerText()).includes('Exact Amount'));
  await page.locator('.pos-cash-quick[data-amt="500"]').click();
  check('Grid quick tender shows change to return',(await page.locator('.pos-cash-change').innerText()).includes('₹400'));
  await page.screenshot({path:path.join(out,'kot-grid-cash-payment.png')});
  await page.locator('.pos-cash-cancel').click();
  await page.locator('#kb-close-session').focus();
  await page.keyboard.press('c');
  const closeDialog=page.locator('#posCloseSessionOverlay');
  await closeDialog.waitFor();
  check('Grid C opens drawer review with opening cash and an unsent-order warning',await closeDialog.getByText('Opening Cash').isVisible()&&
   await closeDialog.getByText('Unsent items will be discarded',{exact:false}).isVisible()&&
   await page.locator('.pos-close-cash').inputValue()==='100.00');
  await page.locator('.pos-close-cancel').click();
  check('Cancelling drawer review retains the open session and cart',await page.locator('#kb-cart tr').count()===1&&
   q("SELECT status_id FROM pos_session WHERE session_id='"+session.sessionId+"'")[0].status_id==='PsOpen');
  check('Grid has no standalone layout button',await page.getByRole('button',{name:/^(Grid|List) View/}).count()===0);
  await modes.locator('summary').click();
  await listMode.click();
  check('List View shows the same cart and quote with a bill summary and no grid controls',
   !await page.locator('#kb-product-grid').isVisible()&&
   await page.getByRole('heading',{name:'Bill Items (1)'}).isVisible()&&
   await page.locator('#kb-list-grand').innerText()==='₹100.00'&&
   await page.locator('#kb-list-type').innerText()==='Take Away'&&
   await page.locator('#kb-list-waiter').innerText()===waiterName&&
   await page.getByRole('button',{name:/^(Grid|List) View/}).count()===0);
  await page.getByRole('button',{name:'Change',exact:true}).click();
  await page.locator('#kb-customer-search').fill('POS_QA_A_CUST_SAME');
  const customer=page.locator('[data-cust-id="POS_QA_A_CUST_SAME"]');
  await customer.waitFor();
  const customerName=await customer.getAttribute('data-cust-name');
  await customer.click();
  check('List View can select a customer from the existing picker',await page.locator('#kb-list-customer').innerText()===customerName);
  await page.getByRole('button',{name:'Change',exact:true}).click();
  await page.locator('#kb-customer-walkin').click();
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
  check('List View shows tax from the shared quote',await page.locator('#kb-list-tax').innerText()==='₹36.00');
  await page.getByRole('switch',{name:'Tax'}).click();
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  await page.screenshot({path:path.join(out,'kot-compact-billing.png')});
  await search.press('Space');
  await page.locator('#kb-payment').waitFor();
  check('Space opens the same blank Cash modal in List View fullscreen',await cash.inputValue()===''&&await confirmCash.isDisabled()&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.locator('.pos-cash-cancel').click();
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
  await cash.fill('250');
  check('List Cash computes change before confirmation',(await page.locator('.pos-cash-change').innerText()).includes('₹50'));
  await page.screenshot({path:path.join(out,'kot-list-cash-payment.png')});
  await cash.press('Enter');
  await page.waitForFunction(()=>window.kotPrints.length===2);
  const kot=q("SELECT kot_id,transaction_id,waiter_name,table_id,notes FROM kitchen_order_ticket WHERE waiter_name='"+waiterName+"' AND transaction_id IS NOT NULL ORDER BY kot_id DESC")[0];
  const tx=q("SELECT transaction_number,payable_amount,change_amount,status_id FROM pos_transaction WHERE transaction_id='"+kot.transaction_id+"'")[0];
  const printed=await page.evaluate(()=>window.kotPrints);
  check('Take Away creates one completed bill and prints both saved documents',tx.status_id==='PtCompleted'&&Number(tx.payable_amount)===200&&!kot.table_id&&kot.notes.includes('Take Away')&&printed[0].includes('KOT #')&&printed[0].includes('No onion')&&printed[1].includes(tx.transaction_number),{kot,tx});
  check('The shared drawer records tender received and change separately',Number(tx.change_amount)===50&&
   Number(q("SELECT amount FROM pos_payment WHERE transaction_id='"+kot.transaction_id+"'")[0].amount)===250);
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
  await page.locator('#kb-history').getByRole('button',{name:'Close',exact:true}).click();
  const foreignClose=await json('sessionDrawer',{drawerAction:'close',closingCash:'300'},foreign);
  check('A foreign organization cannot close the KOT drawer',!foreignClose.data?.success&&
   q("SELECT status_id FROM pos_session WHERE session_id='"+session.sessionId+"'")[0].status_id==='PsOpen');
  await page.locator('#kb-close-session').click();
  await closeDialog.waitFor();
  const review=await closeDialog.innerText();
  check('List drawer review reconciles one bill: ₹100 + ₹250 − ₹50 = ₹300',
   ['Bills Completed','₹200.00','₹100.00','₹250.00','₹50.00','₹300.00','Exact match'].every(text=>review.includes(text))&&
   await page.locator('.pos-close-cash').inputValue()==='300.00');
  await page.screenshot({path:path.join(out,'kot-list-close-session.png')});
  await page.locator('.pos-close-cash').fill('295');
  check('Drawer review shows the actual cash shortage',(await page.locator('.pos-close-diff').innerText()).includes('Short: ₹5.00'));
  await page.locator('.pos-close-confirm').click();
  await page.locator('#kot-terminal-entry').waitFor();
  const closed=q("SELECT status_id,expected_cash,closing_cash,cash_difference FROM pos_session WHERE session_id='"+session.sessionId+"'")[0];
  check('Confirm closes the same drawer and returns to terminal selection',closed.status_id==='PsClosed'&&
   Number(closed.expected_cash)===300&&Number(closed.closing_cash)===295&&Number(closed.cash_difference)===-5,closed);
 }finally{
  await page.close();
  const paid=q("SELECT paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'").reduce((sum,x)=>sum+Number(x.paid_amount),0);
  await invoke('close',{sessionId:session.sessionId,closingCash:String(paid)});
 }
};
