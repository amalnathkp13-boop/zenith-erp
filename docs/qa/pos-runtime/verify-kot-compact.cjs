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
 const printContext=await require('./browser-print-context.cjs')(a.c);
 const page=await printContext.newPage();
 const waiterName='Disposable compact KOT waiter '+Date.now().toString(36);
 await post('Kitchen/WaiterManagement','createWaiter',{waiterName,phone:'0000000000',isActive:'Y'});
 try{
  await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+session.sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  const initialToday=Number(await page.locator('#kb-header-today-bills').textContent());
  check('KOT header shows a stationary terminal and bill data without removed controls',
   await page.locator('.kg-header .kg-chip').evaluate(el=>el.tagName==='BUTTON'&&!el.textContent.includes('⌄'))&&
   await page.locator('#kb-header-last-bill').count()===1&&
   await page.locator('.kg-header #kb-customer-open').isHidden()&&
   await page.locator('#kb-display-message').isHidden()&&
   !(await page.locator('.kg-header').innerText()).includes('KOT Mode'));
  const billingUrl=page.url();
  await page.locator('.kg-header .kg-chip').click();
  check('Current terminal button does not navigate',page.url()===billingUrl);
  check('KOT Billing uses the full viewport without entering browser fullscreen',await page.locator('#kb-wrap').evaluate(root=>{
   const bounds=root.getBoundingClientRect();
   return !document.fullscreenElement&&bounds.left===0&&bounds.top===0&&bounds.width===innerWidth&&bounds.height===innerHeight
    && Array.from(document.querySelectorAll('#top,#z-sidebar,#z-subnav,#ai-copilot-container')).every(el=>!el.getClientRects().length);
  }));
  check('Default workspace has one search and tax toggle, no permanent catalogue',await page.locator('#kb-search').count()===1&&await page.getByRole('switch',{name:'Tax'}).count()===1&&await page.locator('.kb-catlist,.kb-menu').count()===0);
  const modes=page.locator('.kg-modes');
  await modes.locator('summary').click();
  check('Modes separates sales choices from Grid and List View',
   await modes.getByRole('group',{name:'Sales mode'}).count()===1&&
   await modes.getByRole('group',{name:'Billing layout'}).count()===1&&
   await modes.locator('[data-kb-view]').count()===2&&
   await modes.locator('[data-kb-sales-mode="RETAIL"]').count()===1);
  await modes.locator('[data-kb-sales-mode="WHOLESALE"]').click();
  check('Modes updates the existing pricing control',await page.locator('#kb-mode').inputValue()==='WHOLESALE'&&
   await modes.locator('[data-kb-sales-mode="WHOLESALE"]').getAttribute('aria-pressed')==='true');
  await modes.locator('summary').click();
  await modes.locator('[data-kb-sales-mode="RETAIL"]').click();
  check('Retail can be restored in Modes',await page.locator('#kb-mode').inputValue()==='RETAIL');
  await page.locator('#kb-waiter').selectOption({label:waiterName});
  await page.locator('[data-ot="Take Away"]').click();
  check('List View has no table picker',await page.locator('#kb-table-field').count()===0&&await page.locator('#kb-table').isHidden());
  const taxSwitch=page.getByRole('switch',{name:'Tax'});
  if(await taxSwitch.getAttribute('aria-checked')==='true')await taxSwitch.click();
  check('List View omits the keypad instructions',await page.locator('#kb-key-help').count()===0);
  const search=page.locator('#kb-search');
  const fullscreen=page.locator('#kb-fullscreen');
  const listMode=modes.getByRole('button',{name:'List View',exact:true});
  const gridMode=modes.getByRole('button',{name:'Grid View',exact:true});
  await modes.locator('summary').click();
  check('Modes is the only layout selector and starts in List View',
   (await modes.locator('[data-kb-view]').allTextContents()).join('|')==='List View|Grid View'&&
   await listMode.getAttribute('aria-pressed')==='true'&&
   await page.getByRole('button',{name:/^(Grid|List) View/}).count()===2);
  await gridMode.click();
  check('Grid View keeps the tax setting and omits the keypad instructions',
   await taxSwitch.getAttribute('aria-checked')==='false'&&await page.locator('#kb-key-help').count()===0);
  check('Grid View has no table picker',await page.locator('#kb-table-field').count()===0&&await page.locator('#kb-table').isHidden());
  check('Grid puts Hold Bills between Tax and History',
   await page.locator('#kb-tax-toggle + #kb-held-open:has(+ #kb-history-open)').isVisible());
  check('Grid checkout has six controls and no Send to KOT button',
   await page.locator('.kb-checkout-actions button:visible').count()===6&&await page.locator('#kb-send').count()===0);
  const card=page.locator('#kb-suggestions [data-result]').filter({hasText:'Disposable POS A P18'});
  await card.waitFor();
  check('Grid View shows a product catalogue with empty search',await search.inputValue()===''&&
   await page.locator('#kb-product-grid .kb-results-grid').isVisible());
  const gridCustomer=page.locator('.kg-header #kb-customer-open');
  check('Grid puts Walk-in Customer in the header and gives the catalogue its own column',
   await gridCustomer.isVisible()&&(await gridCustomer.innerText()).trim()==='Walk-in Customer'&&
   await page.locator('.kb-toolbar #kb-customer-open').count()===0&&
   await page.locator('#kb-product-grid').evaluate(panel=>panel.getBoundingClientRect().width>innerWidth*0.4));
  await gridCustomer.click();
  check('Grid opens the customer picker from the header',await page.getByRole('dialog',{name:'Customer for this bill'}).isVisible());
  await page.locator('#kb-customer-close').click();
  const catalogueRequests=[];
  const recordLookup=request=>{if(request.url().endsWith('/searchMenu'))catalogueRequests.push(request.postData());};
  page.on('request',recordLookup);
  await modes.locator('summary').click();
  await listMode.click();
  await modes.locator('summary').click();
  await gridMode.click();
  await card.waitFor();
  page.off('request',recordLookup);
  check('List to Grid reuses the loaded catalogue page',catalogueRequests.length===0,{requests:catalogueRequests.length});
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
  await page.locator('#kb-history-close').click();
  check('History works in fullscreen',await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.screenshot({path:path.join(out,'kot-grid-fullscreen.png')});
  await fullscreen.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await search.pressSequentially('Disposable POS A P18');
  await page.locator('#kb-suggestions button').filter({hasText:'Disposable POS A P18'}).waitFor();
  check('Spaces within product names stay in search',await search.inputValue()==='Disposable POS A P18'&&!await page.locator('#kb-payment').isVisible());
  await card.click();
  await page.locator('#kb-grand').getByText('₹100.00').waitFor();
  const quantity=page.locator('#kb-cart [data-kb-edit="qty"]');
  await quantity.fill('2');
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  check('Grid recalculates while quantity still has focus',await quantity.evaluate(el=>el===document.activeElement));
  await quantity.fill('1');
  await page.locator('#kb-grand').getByText('₹100.00').waitFor();
  await page.getByRole('button',{name:/^UPI F5$/}).click();
  check('Grid payment buttons open the existing checkout with the selected tender',await page.locator('#kb-payment-method').inputValue()==='UPI');
  check('Grid UPI confirmation has no reference field',await page.locator('#kb-payment [name=referenceNumber]').count()===0);
  const paymentStyle=()=>page.locator('.kb-checkout-actions :is([data-kb-payment],#kb-draft)').evaluateAll(buttons=>
   buttons.map(button=>{
    const style=getComputedStyle(button), icon=getComputedStyle(button,'::before');
    return {fill:style.backgroundColor,icon:icon.maskImage.startsWith('url('),shortcut:getComputedStyle(button.querySelector('kbd')).display!=='none'};
   }));
  const expectedFills=['rgb(224, 245, 239)','rgb(225, 240, 255)','rgb(255, 240, 229)','rgb(240, 232, 255)','rgb(229, 240, 255)','rgb(255, 240, 229)'];
  const gridPaymentStyle=await paymentStyle();
  const upiConfirmType=await page.locator('#posPayConfOk').getAttribute('type');
  check('Grid uses the POS action artwork and UPI confirms directly',
   gridPaymentStyle.length===expectedFills.length&&gridPaymentStyle.every((button,index)=>button.icon&&button.shortcut&&button.fill===expectedFills[index])&&
   upiConfirmType==='submit',{gridPaymentStyle,upiConfirmType});
  await page.screenshot({path:path.join(out,'kot-grid-upi-payment.png')});
  await page.locator('#kb-payment-close').click();
  await page.locator('[data-kb-payment="Cash"]').click();
  const cash=page.locator('#kb-cash'), confirmCash=page.locator('.pos-cash-confirm');
  check('Grid Cash opens the POS card with no tender entered',await cash.inputValue()===''&&await confirmCash.isDisabled());
  await cash.fill('50');
  check('Grid underpayment shows the shortfall and blocks confirmation',await confirmCash.isDisabled()&&
   (await page.locator('.pos-cash-change').innerText()).includes('₹50 more needed'));
  const exactCash=page.locator('.pos-cash-quick[data-amt="100"]'), largerCash=page.locator('.pos-cash-quick[data-amt="500"]');
  const focused=locator=>locator.evaluate(el=>el===document.activeElement);
  await page.keyboard.press('ArrowDown');
  check('Grid Cash Down skips disabled confirmation without changing Received',await focused(exactCash)&&await cash.inputValue()==='50');
  await page.keyboard.press('ArrowRight');
  check('Grid Cash Right moves to the next preset',await focused(largerCash));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  check('Grid exact quick amount enables confirmation',await confirmCash.isEnabled()&&
   await focused(confirmCash)&&
   (await page.locator('.pos-cash-change').innerText()).includes('Exact Amount'));
  await largerCash.click();
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
   await page.locator('#kb-list-subtotal').innerText()==='₹100.00'&&
   await page.locator('#kb-list-round').innerText()==='₹0.00'&&
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
  const codeRequests=[];
  let releaseLookup;
  const lookupReleased=new Promise(resolve=>{releaseLookup=resolve;});
  const interceptLookup=async route=>{
   if(new URLSearchParams(route.request().postData()||'').get('term')==='POS_QA_A_P18'){
    codeRequests.push(route.request());
    await lookupReleased;
   }
   await route.continue().catch(()=>{});
  };
  await page.route('**/searchMenu',interceptLookup);
  const lookupStarted=page.waitForRequest(request=>request.url().endsWith('/searchMenu')&&
   new URLSearchParams(request.postData()||'').get('term')==='POS_QA_A_P18');
  await search.fill('POS_QA_A_P18');
  await lookupStarted;
  await search.press('Enter');
  await search.press('Enter');
  releaseLookup();
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  await page.unroute('**/searchMenu',interceptLookup);
  check('An exact product code increments the existing line',await page.locator('#kb-cart tr').count()===1);
  check('Enter during a pending lookup reuses the request and adds the product once',codeRequests.length===1);
  await quantity.fill('3');
  await page.locator('#kb-list-subtotal').getByText('₹300.00').waitFor();
  check('List recalculates while quantity still has focus',await quantity.evaluate(el=>el===document.activeElement));
  await quantity.fill('2');
  await page.locator('#kb-list-subtotal').getByText('₹200.00').waitFor();
  await page.locator('#kb-instr').fill('No onion');
  await page.locator('#kb-instr').press('Space');
  check('Space in kitchen notes does not open checkout',!await page.locator('#kb-payment').isVisible());
  const taxOnSaved=page.waitForResponse(response=>response.url().endsWith('/saveTaxPreference'));
  await taxSwitch.click();
  await page.locator('#kb-grand').getByText('₹236.00').waitFor();
  check('List View shows tax from the shared quote',await page.locator('#kb-list-tax').innerText()==='₹36.00');
  check('KOT saves the enabled tax preference',(await (await taxOnSaved).json()).success);
  const freshPage=await printContext.newPage();
  try {
   await freshPage.goto(billingUrl);
   await freshPage.locator('#kb-wrap[data-ready=true]').waitFor();
   check('A fresh KOT billing page reads the saved tax preference',
    await freshPage.getByRole('switch',{name:'Tax'}).getAttribute('data-preference')==='Y');
  } finally { await freshPage.close(); }
  const taxOffSaved=page.waitForResponse(response=>response.url().endsWith('/saveTaxPreference'));
  await taxSwitch.click();
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  check('KOT saves the disabled tax preference',(await (await taxOffSaved).json()).success);
  await page.screenshot({path:path.join(out,'kot-compact-billing.png')});
  await search.press('Space');
  await page.locator('#kb-payment').waitFor();
  check('Space opens the same blank Cash modal in List View fullscreen',await cash.inputValue()===''&&await confirmCash.isDisabled()&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.locator('.pos-cash-cancel').click();
  await fullscreen.click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await page.getByRole('button',{name:'Change',exact:true}).click();
  await page.locator('#kb-customer-search').fill('POS_QA_A_CUST_SAME');
  await customer.click();
  await page.locator('#kb-grand').getByText('₹200.00').waitFor();
  await search.press('Space');
  await page.locator('#kb-payment').waitFor();
  check('Checkout keeps the selected entry terminal',await page.locator('input[name=sessionId]').inputValue()===session.sessionId);
  await page.evaluate(()=>{
   window.kotPrints=[];
   window.kotPrintWindows=0;
   window.open=()=>{
    window.kotPrintWindows++;
    let html='';
    const printDoc=document.implementation.createHTMLDocument();
    const popup=new EventTarget();
    return Object.assign(popup,{document:{open(){html='';},write(x){html+=x;},close(){},images:[],
     createElement:tag=>printDoc.createElement(tag),head:printDoc.head,body:printDoc.body},closed:false,focus(){},
     print(){window.kotPrints.push(html);setTimeout(()=>this.dispatchEvent(new Event('afterprint')),0);},
     close(){this.closed=true;}});
   };
  });
  await cash.fill('250');
  check('List Cash computes change before confirmation',(await page.locator('.pos-cash-change').innerText()).includes('₹50'));
  await page.screenshot({path:path.join(out,'kot-list-cash-payment.png')});
  await page.keyboard.press('ArrowDown');
  check('List Cash Down focuses confirmation without changing Received',await focused(confirmCash)&&await cash.inputValue()==='250');
  await page.keyboard.press('Enter');
  await page.locator('#kb-print-choice').waitFor();
  check('Payment waits for the selected print option',await page.evaluate(()=>window.kotPrints.length===0));
  check('The print choice shows the confirmed cash change',await page.locator('#kb-print-summary').getByText('Change given: ₹50.00.',{exact:false}).isVisible());
  check('Payment complete opens focused on Print Bill',await focused(page.locator('[data-kb-print="bill"]')));
  const completion=page.locator('#kb-print-choice');
  check('Payment Complete has no print method selector',
   await completion.getByText('Print via',{exact:true}).count()===0);
  const completionButtons=completion.locator('.kb-print-options button');
  for(const width of [1366,320]){
   await page.setViewportSize({width,height:768});
   const layout=await completionButtons.evaluateAll(buttons=>buttons.map(button=>{
    const box=button.getBoundingClientRect();
    return {label:button.textContent.trim(),top:box.top,left:box.left,right:box.right};
   }));
   check('Payment Complete keeps four ordered actions in one row at '+width+'px',
    layout.map(button=>button.label).join('|')==='Bill Print|KOT Print|Print Both|Save'&&
    layout.every((button,index)=>button.top===layout[0].top&&button.left>=0&&button.right<=width&&
     (index===0||button.left>=layout[index-1].right)),layout);
  }
  await page.setViewportSize({width:1366,height:768});
  const saveButton=completion.getByRole('button',{name:'Save',exact:true});
  await page.keyboard.press('ArrowLeft');
  check('Left wraps from Bill Print to Save',await focused(saveButton));
  await page.keyboard.press('Tab');
  const firstControl=completion.locator(':is(button,select):visible:enabled').first();
  check('Tab from Save wraps to the first control in Payment Complete',await focused(firstControl));
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab from the first control stays in Payment Complete',await focused(saveButton));
  await page.keyboard.press('ArrowRight');
  check('Right wraps from Save to Bill Print',await focused(completionButtons.first()));
  await page.keyboard.press('F10');
  check('Billing shortcuts stay in the completion modal',await completion.isVisible()&&!await page.locator('#kb-history').isVisible());
  const focusStyle=await completionButtons.first().evaluate(button=>{
   const style=getComputedStyle(button);
   return {outline:style.outlineWidth,offset:style.outlineOffset,color:style.outlineColor,duration:style.transitionDuration};
  });
  check('The selected action has a visible blue outline and brief focus animation',
   focusStyle.outline==='2px'&&focusStyle.offset==='2px'&&focusStyle.color==='rgb(37, 99, 235)'&&focusStyle.duration==='0.15s',focusStyle);
  await page.emulateMedia({reducedMotion:'reduce'});
  const reducedDuration=await completionButtons.first().evaluate(button=>getComputedStyle(button).transitionDuration);
  check('Receipt-action focus stops animating for reduced motion',reducedDuration==='0s',reducedDuration);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.screenshot({path:path.join(out,'kot-payment-complete.png')});
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check('Print Right moves to Print both',await focused(page.locator('[data-kb-print="both"]')));
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.waitForFunction(()=>window.kotPrints.length===2);
  await page.locator('#kb-print-choice').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='kb-search');
  const kot=q("SELECT kot_id,transaction_id,waiter_name,table_id,notes FROM kitchen_order_ticket WHERE waiter_name='"+waiterName+"' AND transaction_id IS NOT NULL ORDER BY kot_id DESC")[0];
  const tx=q("SELECT transaction_number,payable_amount,change_amount,status_id,customer_party_id FROM pos_transaction WHERE transaction_id='"+kot.transaction_id+"'")[0];
  const printed=await page.evaluate(()=>window.kotPrints);
  check('Take Away Print both uses one browser window',await page.evaluate(()=>window.kotPrintWindows===1));
  check('KOT header updates its last bill and today count after checkout',
   await page.locator('#kb-header-last-bill').textContent()===tx.transaction_number&&
   Number(await page.locator('#kb-header-today-bills').textContent())===initialToday+1);
  check('Take Away saves the bill and Print both opens a name-and-quantity KOT plus the bill',tx.status_id==='PtCompleted'&&Number(tx.payable_amount)===200&&!kot.table_id&&kot.notes.includes('Take Away')&&printed[0].includes('Disposable POS A P18')&&printed[0].includes('class="q">2</td>')&&!printed[0].includes('No onion')&&!printed[0].includes('KOT #')&&printed[1].includes(tx.transaction_number),{kot,tx});
  check('The cash bill and customer receipt retain the selected customer',tx.customer_party_id==='POS_QA_A_CUST_SAME'&&printed[1].includes(customerName));
  check('The shared drawer records tender received and change separately',Number(tx.change_amount)===50&&
   Number(q("SELECT amount FROM pos_payment WHERE transaction_id='"+kot.transaction_id+"'")[0].amount)===250);
  const replay=await json('checkoutKot',{kotId:kot.kot_id,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'200'});
  check('Retry returns the same paid bill and change without another tender',replay.data?.billNumber===tx.transaction_number&&Number(replay.data.changeAmount)===50&&q("SELECT amount FROM pos_payment WHERE transaction_id='"+kot.transaction_id+"'").length===1,replay);
  const denied=await json('checkoutKot',{kotId:kot.kot_id,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'200'},foreign);
  check('Another organization cannot bill or retry the order',!denied.data?.success,denied);
  const draft=await json('saveDraft',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]),
   salesModeId:'RETAIL',orderType:'Take Away',taxOn:'N',wantJson:'Y'});
  const txs=()=>q("SELECT transaction_id,status_id,paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' ORDER BY transaction_id");
  const beforeFailure=txs();
  const short=await json('checkoutKot',{kotId:draft.data.kotId,sessionId:session.sessionId,paymentMethod:'Cash',cashAmount:'10'});
  check('An underpayment leaves no partial tender or completed sale',!short.data?.success&&JSON.stringify(txs())===JSON.stringify(beforeFailure),short);
  await post(screen,'deleteDraft',{sessionId:session.sessionId,kotId:draft.data.kotId});
  await page.keyboard.press('F10');
  const historyBill=page.locator('#kb-history [data-kb-history-detail]').filter({hasText:tx.transaction_number});
  await historyBill.waitFor();
  await page.waitForFunction(()=>document.activeElement?.matches('#kb-history [data-kb-history-detail]'));
  check('History focuses the latest issued KOT bill in the billing workspace',
   await historyBill.evaluate(el=>el===document.activeElement)&&new URL(page.url()).pathname.endsWith('/KotBilling'));
  await page.keyboard.press('Enter');
  await page.locator('#kb-history-detail [data-edit-quantity]').first().waitFor();
  check('Enter opens the saved bill in the editor without loading it into the sale cart',
   await page.locator('#kb-history-detail-number').innerText()==='#'+tx.transaction_number&&await page.locator('#kb-cart [data-product]').count()===0);
  const billEditor=page.locator('#kb-history-detail');
  const editorLayout=await billEditor.evaluate(dialog=>{
   const bounds=dialog.getBoundingClientRect();
   const actions=Array.from(dialog.querySelectorAll('footer button')).filter(button=>button.getClientRects().length);
   return {fillsWorkspace:bounds.width===innerWidth&&bounds.height===innerHeight,
    actions:actions.map(button=>button.textContent.trim()),title:dialog.querySelector('h2').textContent.trim()};
  });
  check('Selecting an editable KOT bill opens the POS-style billing workspace',
   editorLayout.fillsWorkspace&&editorLayout.title.includes(tx.transaction_number)&&
   editorLayout.actions.join('|')==='Cancel|Print bill|Save & print revised bill',editorLayout);
  await page.keyboard.press('Space');
  const editorPrint=page.locator('#kb-history-detail-reprint');
  check('Space focuses Print bill in the editor',await focused(editorPrint));
  const editQuantity=page.locator('#kb-history-detail [data-edit-quantity]').first();
  await billEditor.getByRole('button',{name:'Increase quantity for Disposable POS A P18'}).click();
  check('Edit Bill shows the new amount before saving',
   await page.locator('#kb-history-detail [data-edit-total]').first().innerText()==='₹300.00'&&
   await page.locator('#kb-history-detail-total').innerText()==='Estimated total ₹300.00');
  await editorPrint.press('Enter');
  await page.waitForFunction(()=>window.kotPrints.length===3);
  check('Print bill uses the saved receipt despite unsaved edits',
   await page.evaluate(()=>window.kotPrints[2]===window.kotPrints[1]&&window.kotPrintWindows===2)&&
   q("SELECT amendment_id FROM pos_transaction_amendment WHERE transaction_id='"+kot.transaction_id+"'").length===0);
  const addItem=page.locator('#kb-history-add');
  await editQuantity.press('Enter');
  check('Enter from the quantity field returns to product search',await focused(addItem));
  await addItem.fill('Disposable POS A NOWS');
  await page.locator('#kb-history-products button').filter({hasText:'POS_QA_A_NOWS'}).waitFor();
  await addItem.fill('POS_QA_A_UNPRICED');
  await page.locator('#kb-history-products button').filter({hasText:'Disposable unpriced item'}).waitFor();
  await addItem.press('Enter');
  const added=page.locator('#kb-history-detail-lines tr').filter({hasText:'Disposable unpriced item'});
  await added.locator('[data-edit-rate]').fill('25');
  check('Name and code search can add an item without a saved rate',
   await added.locator('[data-edit-total]').innerText()==='₹25.00'&&
   await page.locator('#kb-history-detail-total').innerText()==='Estimated total ₹325.00');
  const removeAdded=added.getByRole('button',{name:'Remove Disposable unpriced item'});
  await removeAdded.click();
  check('Removing an added item updates the estimate',
   await page.locator('#kb-history-detail-total').innerText()==='Estimated total ₹300.00');
  await removeAdded.click();
  await page.screenshot({path:path.join(out,'kot-history-pos-editor.png')});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#kb-history-back').click();
  const printActions=historyBill.locator('..');
  await page.waitForFunction(()=>document.activeElement?.matches('#kb-history .is-current [data-kb-history-detail]'));
  await page.keyboard.press('Space');
  const focusedPrint=await page.evaluate(()=>({action:document.activeElement?.dataset.kbHistoryPrint,
   bill:document.activeElement?.closest('.kb-history-row')?.querySelector('[data-kb-history-detail]')?.textContent.trim()}));
  check('Space moves from the bill number to Bill Print',focusedPrint.action==='bill'&&focusedPrint.bill==='#'+tx.transaction_number,focusedPrint);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.kotPrints.length===4);
  await printActions.getByRole('button',{name:'KOT Print'}).click();
  await page.waitForFunction(()=>window.kotPrints.length===5);
  check('History has direct Bill Print and KOT Print actions',
   !await page.locator('#kb-print-choice').isVisible()&&
   await page.evaluate(()=>window.kotPrints[3]===window.kotPrints[1]&&window.kotPrints[4]===window.kotPrints[0]));
  await page.locator('#kb-history-close').click();
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
   check(view+' Enter selects the entire centered rate',await rate.evaluate(el=>
    el===document.activeElement&&el.selectionStart===0&&el.selectionEnd===el.value.length&&getComputedStyle(el).textAlign==='center'));
   await page.keyboard.type('150');
   await page.keyboard.press('Enter');
   check(view+' Enter commits the rate and selects the entire quantity',await rate.inputValue()==='150'&&await quantity.evaluate(allSelected));
   await page.keyboard.type('3');
   await page.keyboard.press('Enter');
   check(view+' Enter commits quantity and returns to search',await quantity.inputValue()==='3'&&
    await search.evaluate(el=>el===document.activeElement));
   await page.keyboard.press('ArrowDown');
   check(view+' Down from empty search moves to Cash',await page.locator('[data-kb-payment=Cash]').evaluate(el=>el===document.activeElement));
   if(view==='List'){
    const layout=await page.locator('#kb-wrap').evaluate(root=>({
     scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,viewportHeight:innerHeight,
     paymentBottom:root.querySelector('.kb-checkout-actions').getBoundingClientRect().bottom,
     searchTop:root.querySelector('#kb-search').getBoundingClientRect().top,
     cartBottom:root.querySelector('.kb-panel').getBoundingClientRect().bottom,
     summaryBottom:root.querySelector('.kl-summary').getBoundingClientRect().bottom,
     sizes:['.kb-toolbar','.kl-workspace','.kl-side','.kl-side>.kl-card','.kl-summary-stack','.kl-summary','#kb-stats','.kb-bottom'].map(selector=>{
      const el=root.querySelector(selector),rect=el.getBoundingClientRect();
      return [selector,rect.top,rect.height,el.scrollHeight,getComputedStyle(el).gridTemplateRows];
     })
    }));
    check('List View keeps the cart and payment row in one viewport',
     layout.scrollHeight<=layout.clientHeight+1&&layout.paymentBottom<=layout.viewportHeight&&
     layout.cartBottom<=layout.searchTop&&layout.summaryBottom<=layout.searchTop,layout);
   }
   await page.keyboard.press('ArrowRight');
   await page.keyboard.press('Enter');
   await page.locator('#kb-payment').waitFor();
   await page.locator('#kb-grand').getByText('₹450.00').waitFor();
   check(view+' Right and Enter select Card',await page.locator('#kb-payment-method').inputValue()==='Card');
   if(view==='List'){
    check('List uses the same POS action artwork, colors and shortcuts as Grid',
     JSON.stringify(await paymentStyle())===JSON.stringify(gridPaymentStyle));
    await page.screenshot({path:path.join(out,'kot-list-card-payment.png')});
    await page.setViewportSize({width:390,height:300});
    const bounds=await page.locator('#kb-payment').evaluate(dialog=>{
     const box=dialog.getBoundingClientRect();
     return {centered:Math.abs((box.left+box.right)/2-innerWidth/2)<=1&&Math.abs((box.top+box.bottom)/2-innerHeight/2)<=1,
      inset:box.left>=12&&box.top>=12&&box.right<=innerWidth-12&&box.bottom<=innerHeight-12,
      scrollable:dialog.scrollHeight>dialog.clientHeight&&getComputedStyle(dialog).overflowY==='auto'};
    });
    check('Card stays centered and scrollable on a short screen',bounds.centered&&bounds.inset&&bounds.scrollable,bounds);
    await page.locator('#kb-payment-close').click();
    check('Cancelling Card leaves the bill and total intact',await page.locator('#kb-grand').innerText()==='₹450.00');
    await page.setViewportSize({width:1366,height:768});
    await page.locator('#kb-clear').click();
    continue;
   }
   const confirmCard=page.locator('#posPayConfOk');
   const cancelCard=page.locator('#kb-payment-close');
   check('Card starts on Confirm Payment Received',await focused(confirmCard));
   await page.keyboard.press('ArrowLeft');
   check('Card Left moves to Cancel',await focused(cancelCard));
   await page.keyboard.press('ArrowRight');
   await page.keyboard.press('Enter');
   await page.locator('#kb-payment').waitFor({state:'hidden'});
   await page.locator('#kb-print-choice').waitFor();
   check('Completed payment is confirmed in the print dialog', (await page.locator('#kb-print-summary').innerText()).includes('is saved.'));
   await page.keyboard.press('ArrowLeft');
   check('Card completion can focus Save with one Left press',await focused(saveButton));
   const printCountBeforeSave=await page.evaluate(()=>window.kotPrints.length);
   await page.keyboard.press('Enter');
   await completion.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.id==='kb-search');
   check('Save returns to billing without printing',
    await page.evaluate(count=>window.kotPrints.length===count,printCountBeforeSave));
   check('Completed payment leaves no message under Add Note',await page.locator('#kb-order-status').isHidden());
   const lines=q("SELECT i.unit_price,i.quantity,i.manual_price,t.transaction_id,t.transaction_number,t.payable_amount,p.payment_method FROM pos_transaction_item i JOIN pos_transaction t ON t.transaction_id=i.transaction_id JOIN pos_payment p ON p.transaction_id=t.transaction_id WHERE t.session_id='"+session.sessionId+"' AND t.status_id='PtCompleted' AND i.manual_price='Y'");
   check('Card checkout persists the keypad rate and quantity',lines.length===1&&lines[0].payment_method==='Card'&&Number(lines[0].unit_price)===150&&Number(lines[0].quantity)===3&&Number(lines[0].payable_amount)===450,lines);
   const cardBill=lines[0];
   await page.locator('#kb-history-open').click();
   await page.locator('#kb-history [data-kb-history-detail]').filter({hasText:cardBill.transaction_number}).click();
   await billEditor.locator('[data-edit-rate]').fill('160');
   await billEditor.locator('[data-edit-rate]').press('Enter');
   check('Enter from the rate field moves to quantity',await focused(billEditor.locator('[data-edit-quantity]')));
   await billEditor.getByRole('button',{name:'Save & print revised bill'}).click();
   const reason=page.locator('#kb-history-edit-reason');
   await reason.waitFor();
   check('Selecting a bill by click opens the same editor and requires an audit reason',await focused(reason)&&
    await reason.getAttribute('required')!==null);
   await reason.fill('Synthetic KOT rate correction');
   await page.locator('#kb-history-revision-save').click();
   await page.waitForFunction(()=>window.kotPrints.length===6);
   const revised=q("SELECT transaction_number,payable_amount FROM pos_transaction WHERE transaction_id='"+cardBill.transaction_id+"'")[0];
   const audit=q("SELECT change_type,reason FROM pos_transaction_amendment WHERE transaction_id='"+cardBill.transaction_id+"'");
   check('Saving a KOT revision audits one change, keeps the number, and prints the saved total',
    revised.transaction_number===cardBill.transaction_number&&Number(revised.payable_amount)===480&&
    audit.length===1&&audit[0].change_type==='PRICE_CHANGE'&&audit[0].reason==='Synthetic KOT rate correction'&&
    await page.evaluate(number=>window.kotPrints[5].includes(number)&&window.kotPrints[5].includes('480.00'),cardBill.transaction_number),
    {revised,audit});
   await page.locator('#kb-history-back').click();
   await page.locator('#kb-history-close').click();
  }
  await modes.locator('summary').click();
  await listMode.click();
  await page.locator('[data-ot="Take Away"]').click();
  await search.fill('Disposable POS A P18');
  await card.waitFor();
  await card.click();
  await page.locator('#kb-grand').getByText('₹100.00').waitFor();
  await page.locator('[data-kb-payment=UPI]').click();
  check('List UPI confirmation has no reference field',await page.locator('#kb-payment [name=referenceNumber]').count()===0);
  await page.locator('#posPayConfOk').click();
  await page.locator('#kb-print-choice').waitFor();
  const upiToast=page.locator('.kb-sale-toast');
  await upiToast.waitFor();
  check('KOT shows the POS-style sale toast after saving UPI and before printing',
   (await upiToast.textContent())==='✔ Sale Complete — '+(await page.locator('#kb-header-last-bill').textContent())+' — ₹100 UPI'&&
   await page.evaluate(()=>window.kotPrints.length===6));
  await page.locator('#kb-print-close').click();
  const upi=q("SELECT p.amount,p.reference_number FROM pos_payment p JOIN pos_transaction t ON t.transaction_id=p.transaction_id WHERE t.session_id='"+session.sessionId+"' AND t.status_id='PtCompleted' AND p.payment_method='UPI'");
  check('One UPI confirmation saves one tender and closing print options skips printing',
   upi.length===1&&Number(upi[0].amount)===100&&!upi[0].reference_number&&
   await page.evaluate(()=>window.kotPrints.length===6)&&!await page.locator('#kb-payment').isVisible(),upi);
  check('List puts Hold Bills between Tax and History',
   await page.locator('#kb-tax-toggle + #kb-held-open:has(+ #kb-history-open)').isVisible());
  check('List checkout has the same six controls as Grid',
   await page.locator('.kb-checkout-actions button:visible').count()===6&&
   await page.locator('.kb-checkout-actions :is(#kb-bill,#kb-send)').count()===0&&
   await page.locator('.kb-checkout-actions [data-kb-payment]:visible').count()===5&&
   await page.locator('.kb-checkout-actions #kb-draft').isVisible());
  const held=await json('saveDraft',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1.25,manualPrice:'Y',unitPrice:120}]),
   salesModeId:'RETAIL',customerPartyId:'POS_QA_A_CUST_SAME',orderType:'Take Away',taxOn:'N',notes:'Held order QA',billingView:'list',wantJson:'Y'});
  check('A named customer and fractional line can be held',held.data?.success,held);
  await page.goto(base+'/apps/zenith/kot/KotBilling?sessionId='+session.sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  await modes.locator('summary').click();
  await gridMode.click();
  await search.fill('POS_QA_A_P18');
  await card.click();
  const holdResponse=page.waitForResponse(response=>response.url().endsWith('/saveDraft'));
  await page.locator('#kb-draft').click();
  const newerHold=await (await holdResponse).json();
  check('A second bill can be held in Grid View',newerHold.success,newerHold);
  await page.locator('#kb-cart tr[data-product]').waitFor({state:'hidden'});
  const holdTag=page.getByRole('status').filter({hasText:/^Bill held$/});
  await holdTag.waitFor();
  check('Holding a bill shows the orange POS confirmation',await holdTag.evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(180, 83, 9)');
  await page.locator('#kb-held-count').getByText('2',{exact:true}).waitFor();
  await modes.locator('summary').click();
  await listMode.click();
  await search.fill('POS_QA_A_P18');
  await card.click();
  await page.locator('#kb-grand').getByText('₹100.00',{exact:true}).waitFor();
  await page.locator('#kb-instr').fill('Autosaved while switching held bills');
  await fullscreen.click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==='kb-wrap');
  await page.keyboard.press('F9');
  const heldBills=page.getByRole('region',{name:'Hold Bills'});
  const rows=heldBills.locator('.nb-held__item');
  await rows.first().waitFor();
  const heldIds=await rows.evaluateAll(visible=>visible.map(row=>row.dataset.kotId));
  check('Hold Bills shows only drafts and puts the latest first',
   JSON.stringify(heldIds)===JSON.stringify([newerHold.kotId,held.data.kotId]),heldIds);
  const autoHoldResponse=page.waitForResponse(response=>response.url().endsWith('/saveDraft'));
  await rows.first().click();
  const autoHold=await (await autoHoldResponse).json();
  await page.waitForURL(url=>url.searchParams.get('loadDraft')===newerHold.kotId);
  await page.locator('#kb-wrap.kg-grid[data-ready=true]').waitFor();
  check('Resuming the Grid hold from List restores Grid View in fullscreen',
   await page.locator('[data-kb-view=grid]').getAttribute('aria-pressed')==='true'&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.keyboard.press('F9');
  await heldBills.locator('[data-kot-id="'+autoHold.kotId+'"]').waitFor();
  check('Switching auto-holds the current cart and puts it first without listing the active bill',
   autoHold.success&&await rows.first().getAttribute('data-kot-id')===autoHold.kotId&&
   await heldBills.locator('[data-kot-id="'+newerHold.kotId+'"]').count()===0&&
   q("SELECT notes FROM kitchen_order_ticket WHERE kot_id='"+autoHold.kotId+"'")[0]?.notes.includes('Autosaved while switching held bills'));
  await page.keyboard.press('Escape');
  await post(screen,'deleteDraft',{sessionId:session.sessionId,kotId:newerHold.kotId});
  await post(screen,'deleteDraft',{sessionId:session.sessionId,kotId:autoHold.kotId});
  let clearPrompt=false;
  const onClearPrompt=dialog=>{clearPrompt=true;return dialog.dismiss();};
  page.on('dialog',onClearPrompt);
  await page.locator('#kb-clear').click();
  page.off('dialog',onClearPrompt);
  check('Clear Cart empties the order without a browser prompt or leaving fullscreen',
   !clearPrompt&&await page.locator('#kb-cart tr[data-product]').count()===0&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await page.keyboard.press('F9');
  await heldBills.locator('[data-kot-id="'+held.data.kotId+'"]').click();
  await page.waitForURL(url=>url.searchParams.get('loadDraft')===held.data.kotId);
  await page.locator('#kb-wrap:not(.kg-grid)[data-ready=true]').waitFor();
  check('Resuming the List hold from Grid restores List View in fullscreen',
   await page.locator('[data-kb-view=list]').getAttribute('aria-pressed')==='true'&&
   await page.evaluate(()=>document.fullscreenElement?.id==='kb-wrap'));
  await fullscreen.click();
  await page.locator('#kb-grand').getByText('₹150.00').waitFor();
  check('Resuming a hold restores the customer, rate and quantity',
   await page.locator('#kb-customer-name').innerText()===customerName&&
   await page.locator('[data-kb-edit=rate]').inputValue()==='120'&&
   await page.locator('[data-kb-edit=qty]').inputValue()==='1.25');
  await page.getByRole('button',{name:'Decrease quantity'}).click();
  check('Decreasing a fractional quantity preserves its fractional part',await page.locator('[data-kb-edit=qty]').inputValue()==='0.25');
  for(const width of [1024,390,320]){
   await page.setViewportSize({width,height:690});
   for(const [view,option] of [['List',listMode],['Grid',gridMode]]){
    await modes.locator('summary').click();
    await option.click();
    if(view==='Grid'&&width<800)await page.locator('#kb-suggestions [data-result]').first().waitFor();
    const layout=await page.locator('#kb-wrap').evaluate(root=>{
     const actions=Array.from(root.querySelectorAll('.kb-checkout-actions button')).filter(button=>button.getClientRects().length);
     const header=root.querySelector('.kg-header'), toolbar=root.querySelector('.kb-toolbar');
     const grid=root.querySelector('#kb-product-grid'), card=grid.querySelector('[data-result]');
     return {width:root.clientWidth,documentWidth:root.scrollWidth,
      headerClear:Array.from(header.children).every(control=>control.getBoundingClientRect().bottom<=toolbar.getBoundingClientRect().top+1),
      searchAboveGrid:root.querySelector('#kb-search').getBoundingClientRect().bottom<=grid.getBoundingClientRect().top,
      cardFits:card&&card.getBoundingClientRect().bottom<=grid.getBoundingClientRect().bottom+1,
      overflow:actions.filter(button=>button.scrollWidth>button.clientWidth+1).map(button=>button.textContent.trim())};
    });
    check(view+' keeps payment controls within the '+width+'px viewport',layout.documentWidth<=layout.width+1&&layout.overflow.length===0,layout);
    if(width<800)check(view+' header and toolbar stay separate at '+width+'px',layout.headerClear,layout);
    if(view==='Grid'&&width<800)check('Grid search stays above a visible catalogue at '+width+'px',layout.searchAboveGrid&&layout.cardFits,layout);
   }
  }
  await page.setViewportSize({width:1366,height:768});
  await modes.locator('summary').click();
  await listMode.click();
  await post(screen,'deleteDraft',{sessionId:session.sessionId,kotId:held.data.kotId});
  await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+session.sessionId);
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  const foreignClose=await json('sessionDrawer',{drawerAction:'close',closingCash:'300'},foreign);
  check('A foreign organization cannot close the KOT drawer',!foreignClose.data?.success&&
   q("SELECT status_id FROM pos_session WHERE session_id='"+session.sessionId+"'")[0].status_id==='PsOpen');
  await page.locator('#kb-close-session').click();
  await closeDialog.waitFor();
  const review=await closeDialog.innerText();
  check('List drawer review reconciles cash separately from the Card bill: ₹100 + ₹250 − ₹50 = ₹300',
   ['Bills Completed','₹100.00','₹250.00','₹50.00','₹300.00','Exact match'].every(text=>review.includes(text))&&
   await page.locator('.pos-close-cash').inputValue()==='300.00');
  await page.screenshot({path:path.join(out,'kot-list-close-session.png')});
  await page.locator('.pos-close-cash').fill('295');
  check('Drawer review shows the actual cash shortage',(await page.locator('.pos-close-diff').innerText()).includes('Short: ₹5.00'));
  await page.locator('.pos-close-confirm').click();
  await page.locator('#kot-terminal-entry').waitFor();
  const closed=q("SELECT status_id,expected_cash,closing_cash,cash_difference FROM pos_session WHERE session_id='"+session.sessionId+"'")[0];
  check('Confirm closes the same drawer and returns to terminal selection',closed.status_id==='PsClosed'&&
   Number(closed.expected_cash)===300&&Number(closed.closing_cash)===295&&Number(closed.cash_difference)===-5,closed);
  const seeded=await post('PosQaAcceptance','seedSearch',{kotExactBarcode:'Y'});
  check('The synthetic catalog has an exact barcode beyond its first page',(await seeded.json()).seeded===true);
  const [firstPage,secondPage]=await Promise.all([0,40].map(offset=>json('searchMenu',{sessionId:'',term:'PP ',offset,salesModeId:'RETAIL'})));
  const products=[...firstPage.data.products,...secondPage.data.products];
  check('KOT preserves exact barcode selection and all spaced-name results across pages',
   firstPage.data.exactId==='POS_QA_SEARCH_64'&&firstPage.data.products.some(product=>product.id===firstPage.data.exactId)&&
   firstPage.data.hasMore&&!secondPage.data.hasMore&&new Set(products.map(product=>product.id)).size===67&&
   products.every(product=>product.name.startsWith('PP ')&&product.id!=='POS_QA_SEARCH_FOREIGN'));
 }finally{
  await printContext.close();
  const paid=q("SELECT paid_amount FROM pos_transaction WHERE session_id='"+session.sessionId+"' AND status_id='PtCompleted'").reduce((sum,x)=>sum+Number(x.paid_amount),0);
  await invoke('close',{sessionId:session.sessionId,closingCash:String(paid)});
 }
};
