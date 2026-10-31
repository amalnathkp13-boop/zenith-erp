const path=require('node:path');
module.exports=async function({a,foreign,base,check,q,invoke,post,out}) {
 const terminalId='POS_QA_A_CHECKOUT';
 if(!q(`SELECT * FROM pos_terminal WHERE terminal_id='${terminalId}'`).length){
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable checkout QA counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',regionGeoId:'33',stateCode:'33',countryGeoId:'IND',isActive:'Y'});
  check('dedicated checkout counter is created in the test organization',q(`SELECT * FROM pos_terminal WHERE terminal_id='${terminalId}' AND organization_party_id='POS_QA_A'`).length===1);
 }
 const session=await invoke('open',{terminalId,openingCash:'100'});
 const page=await a.c.newPage();page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const cart=await invoke('cart',{sessionId:session.sessionId});
 const tx=()=>q(`SELECT * FROM pos_transaction WHERE transaction_id='${cart.transactionId}'`)[0];
 const lines=()=>q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}' ORDER BY item_seq_id`);
 const api=async(params,actor=a)=>{const r=await post('Terminal','ajaxCart',{sessionId:session.sessionId,transactionId:cart.transactionId,taxOn:'N',...params},actor);let d;try{d=await r.json()}catch{d={success:false}}return {r,d};};
 async function clickAndSettle(selector,action) {
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')===action);
  await page.locator(selector).click();const r=await response;const d=await r.json();check('checkout '+action+' click succeeds',r.status()===200&&d.success,d);
 }
 try {
  await page.setViewportSize({width:1672,height:941});
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&transactionId=${cart.transactionId}&taxOn=N`);
  await page.locator('.pos-checkout-reference').waitFor();
  check('billing header removes technical terminal, cashier badge and duplicate Search control',await page.locator('.nb-cashier,#pos-search-toggle').count()===0&&!(await page.locator('.nb-hrow').innerText()).includes(terminalId));
  await page.locator('.nb-modes summary').click();await page.locator('[data-pos-layout="advanced"]').click();
  check('reference empty cart keeps all tender buttons disabled',await page.locator('.pos-reference-payments button:disabled').count()===8&&await page.locator('#pos-copilot').isEnabled());
  check('counter and Back to POS target registered POS screens',(await page.locator('.nb-counter a').last().getAttribute('href'))==='/apps/zenith/pos/PosTerminals'&&(await page.locator('.nb-back').getAttribute('href'))==='/apps/zenith/pos/Dashboard');
  const stock=await api({action:'cardStock',productIds:'POS_QA_A_STOCK,POS_QA_B_P18'});
  check('card stock is real and excludes foreign products',stock.d.success&&Number(stock.d.stock.POS_QA_A_STOCK.quantity)===Number(q("SELECT sum(quantity_on_hand_total) AS n FROM asset WHERE product_id='POS_QA_A_STOCK' AND owner_party_id='POS_QA_A' AND facility_id='POS_QA_A_FAC'")[0].n)&&!stock.d.stock.POS_QA_B_P18,stock.d);
  const deniedStock=await api({action:'cardStock',productIds:'POS_QA_A_STOCK'},foreign);
  check('foreign operator cannot read this counter stock',deniedStock.r.status()===403||!deniedStock.d.success);
  const product='.pos-product-grid form:has(input[name=productId][value=POS_QA_A_P18]) button';
  await clickAndSettle(product,'addItem');
  check('one product click creates one item at its live price',lines().length===1&&Number(lines()[0].quantity)===1&&Number(lines()[0].unit_price)===100&&Number(tx().total_tax_amount)===0);
  await page.locator('.pos-cart .aj-q').last().waitFor();
  await clickAndSettle('.pos-cart .aj-q:last-of-type','updateQty');
  check('plus quantity and item count update without duplicate lines',lines().length===1&&Number(lines()[0].quantity)===2&&(await page.locator('#pos-cart-count').innerText())==='1');
  const price=page.locator('.pos-cart .aj-p');
  const priceReply=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='updatePrice');
  await price.fill('75.50');await price.press('Enter');await priceReply;
  check('editable rate persists decimals and total',Number(lines()[0].unit_price)===75.5&&Number(tx().subtotal)===151,tx());
  await page.locator('.nb-tax button').click();await page.waitForFunction(()=>document.querySelector('.nb-toggle')?.classList.contains('on'));
  check('tax on recalculates real GST',Number(tx().total_tax_amount)>0,tx());
  await page.locator('.nb-tax button').click();await page.waitForFunction(()=>!document.querySelector('.nb-toggle')?.classList.contains('on'));
  check('tax off removes GST consistently',Number(tx().total_tax_amount)===0&&Number(tx().payable_amount)===151,tx());
  await clickAndSettle('.pos-product-grid form:has(input[name=productId][value=POS_QA_A_P5]) button','addItem');
  await clickAndSettle('.pos-cart tbody tr:has-text("Disposable POS A P5") .aj-rm svg','removeItem');
  check('clicking the trash icon removes only that product',lines().length===1&&lines()[0].product_id==='POS_QA_A_P18'&&Number(tx().subtotal)===151);
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('/');
  await page.locator('#cartInlineSearch').fill('POS_QA_A_P5');
  await page.locator('#cartSearchDropdown .cart-dd-item[data-pid="POS_QA_A_P5"]').waitFor();
  const searchAdded=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
  await page.locator('#cartInlineSearch').press('Enter');await searchAdded;
  await page.waitForFunction(()=>!document.querySelector('.pos-cart-search').classList.contains('is-open'));
  check('search/Enter adds a product and frees the cart toolbar',lines().some(l=>l.product_id==='POS_QA_A_P5')&&await page.locator('#cartInlineSearch').count()===1);
  await clickAndSettle('.pos-cart tbody tr:has-text("Disposable POS A P5") .aj-rm svg','removeItem');
  // Show/cancel each payment path without writing a tender.
  for(const [key,selector] of [['F1','#posDiscountOverlay'],['F4','#posCreditOverlay'],['F6','.pos-split-panel']]) {
   await page.locator('.pos-cart-heading h2').click();await page.keyboard.press(key);await page.locator(selector).waitFor();
   check(key+' opens its labelled action',await page.locator(selector).isVisible());
   if(key==='F6') await page.locator('.pos-split-cancel').click();
   else { const close=page.locator(selector).getByRole('button',{name:/cancel|close/i}).first(); if(await close.count())await close.click();else await page.keyboard.press('Escape'); }
  }
  for(const [key,method] of [['F3','Card'],['F5','UPI']]) {
   await page.locator('.pos-cart-heading h2').click();await page.keyboard.press(key);await page.locator('#posPayConfirmOverlay').waitFor();
   check(key+' opens '+method+' confirmation without payment',(await page.locator('#posPayConfirmOverlay').innerText()).includes(method)&&q(`SELECT * FROM pos_payment WHERE transaction_id='${cart.transactionId}'`).length===0);
   await page.locator('#posPayConfCancel').click();
  }
  await page.locator('.nb-customer-picker').click();await page.locator('#posCustomerOverlay').waitFor();
  check('Walk-in customer opens the existing customer picker',await page.locator('#posCustomerOverlay').isVisible());
  await page.locator('#cust-close').click();
  await page.locator('.nb-abtn--redeem').click();await page.locator('#posCustomerOverlay').waitFor();
  check('Redeem uses the customer and loyalty workflow',await page.locator('#posCustomerOverlay').isVisible());
  await page.locator('#cust-close').click();
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('F10');await page.locator('#pos-history-overlay').waitFor();
  check('F10 opens history with a unique key',await page.locator('#pos-history-overlay').isVisible());
  await page.locator('#hist-close').click();
  // Unpaid clearing rejects cross-tenant and paid drafts, and never issues a number or stock movement.
  const denied=await api({action:'clearCart'},foreign);check('foreign cart clear rejected',denied.r.status()===403||!denied.d.success);
  const csrf=await post('Terminal','ajaxCart',{action:'clearCart',sessionId:session.sessionId,transactionId:cart.transactionId},a,false);
  check('Clear Cart requires CSRF protection',[401,403].includes(csrf.status())&&lines().length===1,{status:csrf.status(),lineCount:lines().length});
  let delayed=false;
  const delayEdit=async route=>{if(new URLSearchParams(route.request().postData()||'').get('action')==='updateQty'){delayed=true;await new Promise(resolve=>setTimeout(resolve,700));}await route.continue();};
  await page.route('**/Terminal/ajaxCart',delayEdit);
  await page.locator('.pos-cart .aj-q').last().click();
  await clickAndSettle('#pos-clear-cart','clearCart');
  await page.unroute('**/Terminal/ajaxCart',delayEdit);
  check('Clear Cart waits for the queued edit before clearing',delayed&&lines().length===0);
  check('Clear Cart removes draft items and tax details, consumes no bill number',lines().length===0&&Number(tx().payable_amount)===0&&!tx().transaction_number&&q(`SELECT * FROM tax_line_detail WHERE reference_type='PosTransactionItem' AND reference_id='${cart.transactionId}'`).length===0);
  await clickAndSettle(product,'addItem');
  await invoke('pay',{transactionId:cart.transactionId,paymentMethod:'Cash',amount:'10'});
  const paidClear=await api({action:'clearCart'});check('recorded deposit prevents Clear Cart',!paidClear.d.success&&lines().length===1&&Number(tx().paid_amount)===10);
  // Complete the small paid draft through existing services; the main suite tests all tender UI commits.
  await invoke('pay',{transactionId:cart.transactionId,paymentMethod:'Cash',amount:'90'});await invoke('complete',{transactionId:cart.transactionId});
  const issued=await api({action:'clearCart'});check('issued bill cannot be cleared',!issued.d.success&&lines().length===1&&tx().status_id==='PtCompleted');
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&taxOn=N`);
  await clickAndSettle(product,'addItem');
  await page.reload({waitUntil:'networkidle'});
  check('resumed server-rendered cart uses the same editable quantity and trash icon',await page.locator('.pos-cart .aj-qi').count()===1&&await page.locator('.pos-cart .aj-rm svg').count()===1&&await page.locator('.pos-cart .pos-cart-uom').count()===0);
  for(const invalid of ['', '0', '-1']) {
   await page.locator('.pos-cart .aj-qi').fill(invalid);await page.locator('.pos-cart .aj-qi').press('Tab');
   check('resumed quantity rejects '+JSON.stringify(invalid)+' without hiding its saved value',(await page.locator('.pos-cart .aj-qi').inputValue())==='1');
  }
  const resumedEdit=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='updateQty');
  await page.locator('.pos-cart .aj-qi').fill('2');await page.locator('.pos-cart .aj-qi').press('Tab');await resumedEdit;
  const resumedId=await page.locator('#cartInlineAddForm input[name=transactionId]').inputValue();
  const resumedLines=q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${resumedId}'`),resumedTxn=q(`SELECT * FROM pos_transaction WHERE transaction_id='${resumedId}'`)[0];
  check('first quantity edit after reload persists through the existing fallback',resumedLines.length===1&&Number(resumedLines[0].quantity)===2&&Number(resumedTxn.subtotal)===200,{resumedLines,resumedTxn});
  for(const size of [{width:1672,height:941},{width:1366,height:768},{width:1024,height:768},{width:800,height:768},{width:390,height:844},{width:320,height:700}]) {
   await page.setViewportSize(size);await page.waitForTimeout(200);
   const g=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth,header:box('.nb-hrow'),actions:box('.nb-actionbar'),catalog:box('.pos-left-panel'),cart:box('#cartScroll'),pay:box('.pos-reference-payments'),toolbar:[...document.querySelectorAll('.nb-actionbar button,.nb-actionbar summary')].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect().toJSON()),quantity:[...document.querySelectorAll('.aj-qi')].map(e=>({value:e.value,width:e.getBoundingClientRect().width})),cards:[...document.querySelectorAll('.pos-product-grid button')].map(e=>e.getBoundingClientRect().toJSON())};});
   check('reference '+size.width+'px header and panels do not overlap',g.scroll<=size.width+2&&g.actions.top>=g.header.bottom-2&&g.cards.every((a,i)=>g.cards.every((b,j)=>i===j||a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1)),g);
   if(size.width>=1024) check('reference '+size.width+'px payment bar fits viewport',g.pay.bottom<=size.height+2&&g.catalog.right<=g.cart.left+2&&g.cart.height>=150,g);
   check('reference '+size.width+'px toolbar controls stay reachable',g.toolbar.every(r=>r.left>=0&&r.right<=size.width+2),g);
   check('reference '+size.width+'px quantities remain legible',g.quantity.length>0&&g.quantity.every(i=>Number(i.value)>0&&i.width>=40),g);
   await page.screenshot({path:path.join(out,'checkout-reference-'+size.width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('F2');await page.locator('.pos-cash-panel').waitFor();
  check('F2 cash Proceed is reachable',await page.locator('.pos-cash-confirm').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
  await page.locator('.pos-cash-cancel').click();
  check('payment shortcuts exist immediately after cancelling Cash',await page.evaluate(()=>['pos-discount','pos-pay-cash','pos-pay-card','pos-credit','pos-pay-upi','pos-split','pos-hold','pos-void'].every(id=>document.getElementById(id))));
  const heldRequest=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/holdSale'));
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('F7');await heldRequest;
  await page.locator('#pos-held-wrap summary').waitFor();
  check('F7 holds the real cart once',q(`SELECT * FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld'`).length===1);
  await page.keyboard.press('F9');await page.locator('.nb-held__item').first().waitFor();
  const recalled=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/recallSale'));
  await page.locator('.nb-held__item').first().click();await recalled;await page.locator('.pos-cart .aj-qi').waitFor();
  check('F9 held picker recalls items',q(`SELECT * FROM pos_held_transaction WHERE session_id='${session.sessionId}' AND status_id='PhHeld'`).length===0);
  const recalledTx=await page.locator('#cartInlineAddForm input[name=transactionId]').inputValue();
  const voided=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/voidSale'));
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('F8');await voided;
  check('F8 void cancels only the open draft',q(`SELECT * FROM pos_transaction WHERE transaction_id='${recalledTx}' AND status_id='PtVoided'`).length===1&&tx().status_id==='PtCompleted');
  await page.locator('.pos-cart-heading h2').click();await page.keyboard.press('c');await page.locator('#posCloseSessionOverlay').waitFor();
  check('C opens exactly one cash-review dialog',await page.locator('#posCloseSessionOverlay').count()===1);
  await page.locator('.pos-close-cancel').click();
  await invoke('close',{sessionId:session.sessionId,closingCash:'200'});
  check('reference checkout produces no JavaScript exceptions',errors.length===0,{errors});
 }catch(error){await page.screenshot({path:path.join(out,'checkout-reference-failure.png'),fullPage:true});throw error;}
 finally{await page.close();}
};
