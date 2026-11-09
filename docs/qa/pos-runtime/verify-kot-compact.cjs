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
  await search.fill('Disposable');
  const gridResults=page.locator('#kb-suggestions');
  await page.waitForFunction(()=>document.querySelectorAll('#kb-suggestions [data-result]').length>=5);
  const columns=await gridResults.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const resultCount=await gridResults.locator('[data-result]').count();
  const activeResult=()=>gridResults.locator('.is-active').getAttribute('data-result');
  for(const [key,index] of [['ArrowRight',1],['ArrowDown',Math.min(columns+1,resultCount-1)],['ArrowLeft',columns],['ArrowUp',0]]) {
   await search.press(key);
   check('Grid '+key+' selects the spatial neighbor',Number(await activeResult())===index);
  }
  await gridResults.locator('[data-result="0"]').focus();
  await page.keyboard.press('ArrowRight');
  check('Grid arrows also move focus between cards',await gridResults.locator('[data-result="1"]').evaluate(el=>el===document.activeElement));
  await search.press('Escape');
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
  await page.locator('#kb-print-choice').waitFor();
  check('Payment waits for the selected print option',await page.evaluate(()=>window.kotPrints.length===0));
  await page.locator('[data-kb-print="both"]').click();
  await page.waitForFunction(()=>window.kotPrints.length===2);
  const kot=q("SELECT kot_id,transaction_id,waiter_name,table_id,notes FROM kitchen_order_ticket WHERE waiter_name='"+waiterName+"' AND transaction_id IS NOT NULL ORDER BY kot_id DESC")[0];
  const tx=q("SELECT transaction_number,payable_amount,status_id FROM pos_transaction WHERE transaction_id='"+kot.transaction_id+"'")[0];
  const printed=await page.evaluate(()=>window.kotPrints);
  check('Take Away saves the bill and Print both opens a name-and-quantity KOT plus the bill',tx.status_id==='PtCompleted'&&Number(tx.payable_amount)===200&&!kot.table_id&&kot.notes.includes('Take Away')&&printed[0].includes('Disposable POS A P18')&&printed[0].includes('class="q">2</td>')&&!printed[0].includes('No onion')&&!printed[0].includes('KOT #')&&printed[1].includes(tx.transaction_number),{kot,tx});
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
  await post(screen,'deleteDraft',{sessionId:session.sessionId,kotId:draft.data.kotId});
  await page.locator('#kb-history-open').click();
  await page.locator('#kb-history').getByText(waiterName,{exact:false}).first().waitFor();
  check('Saved checkout is available in the in-page History',new URL(page.url()).pathname.endsWith('/KotBilling'));
  await page.locator('#kb-history').getByRole('button',{name:'Close',exact:true}).click();
  for(const [view,option] of [['List',listMode],['Grid',gridMode]]) {
   await modes.locator('summary').click();
   await option.click();
   const headers=await page.locator('.kb-otable th:visible').allInnerTexts();
   const rateIndex=headers.findIndex(t=>/^Rate/i.test(t));
   check(view+' puts Rate immediately before Quantity',rateIndex>=0&&rateIndex+1===headers.findIndex(t=>/^(Qty|Quantity)$/i.test(t)),headers);
   await page.keyboard.press('NumpadDivide');
   check(view+' keypad divide focuses product search',await search.evaluate(el=>el===document.activeElement));
   await page.keyboard.type('Disposable POS A P18');
   await card.waitFor();
   await page.keyboard.press('Enter');
   const rate=page.locator('[data-kb-edit="rate"]'), quantity=page.locator('[data-kb-edit="qty"]');
   const allSelected=el=>el===document.activeElement&&el.selectionStart===0&&el.selectionEnd===el.value.length;
   check(view+' Enter selects the entire rate',await rate.evaluate(allSelected));
   await page.keyboard.type('150');
   await page.keyboard.press('ArrowRight');
   check(view+' Right commits the rate and selects the entire quantity',await rate.inputValue()==='150'&&await quantity.evaluate(allSelected));
   await page.keyboard.type('3');
   await page.keyboard.press('ArrowDown');
   check(view+' Down moves from quantity to Cash',await page.locator('[data-kb-payment=Cash]').evaluate(el=>el===document.activeElement));
   await page.keyboard.press('ArrowRight');
   await page.keyboard.press('Enter');
   await page.locator('#kb-payment').waitFor();
   await page.locator('#kb-grand').getByText('₹450.00').waitFor();
   check(view+' Right and Enter select Card',await page.locator('#kb-payment-method').inputValue()==='Card');
   await page.locator('#kb-payment-close').click();
   if(view==='List'){
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#kb-clear').click();
    continue;
   }
   await page.locator('[data-kb-payment=Card]').focus();
   await page.keyboard.press('ArrowLeft');
   await page.keyboard.press('Enter');
   await page.locator('#kb-payment').waitFor();
   await page.getByRole('button',{name:'Confirm and print'}).click();
   await page.locator('#kb-payment').waitFor({state:'hidden'});
   await page.locator('#kb-order-status').filter({hasText:'Saved bill'}).waitFor();
   const lines=q("SELECT i.unit_price,i.quantity,i.manual_price,t.payable_amount FROM pos_transaction_item i JOIN pos_transaction t ON t.transaction_id=i.transaction_id WHERE t.session_id='"+session.sessionId+"' AND t.status_id='PtCompleted' AND i.manual_price='Y'");
   check('Checkout persists the keypad rate and quantity',lines.length===1&&Number(lines[0].unit_price)===150&&Number(lines[0].quantity)===3&&Number(lines[0].payable_amount)===450,lines);
  }
 }finally{
  await page.close();
  const paid=q("SELECT paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'").reduce((sum,x)=>sum+Number(x.paid_amount),0);
  await invoke('close',{sessionId:session.sessionId,closingCash:String(paid)});
 }
};
