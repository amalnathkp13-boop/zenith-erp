const path=require('node:path');
module.exports=async function({a,base,check,q,invoke,post,out}){
 const terminalId='POS_QA_A_OFL_'+Date.now();
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable offline counter',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'}),draft=await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:false});
 await invoke('add',{transactionId:draft.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'Y'});
 const context=await a.c.browser().newContext({storageState:await a.c.storageState(),viewport:{width:1366,height:768}});
 await context.route('**/qz-tray@*/qz-tray.js',r=>r.fulfill({contentType:'text/javascript',body:'/* No printer in disposable QA. */'}));
 const page=await context.newPage();page.setDefaultTimeout(20000);
 try{
  await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&transactionId='+draft.transactionId+'&taxOn=Y');
  await page.waitForFunction(()=>window._posOffline?.lookup('POS_QA_A_P18')?.taxRate===18);
  await page.locator('#cartInlineSearch').fill('water ');await page.locator('#cartInlineSearch').press('Space');
  check('spaces within a product query do not trigger cash',await page.locator('#cartInlineSearch').inputValue()==='water  '&&await page.locator('#cartInlineSearch').evaluate(el=>el===document.activeElement));
  await page.locator('#cartInlineSearch').fill('');await page.locator('#cartInlineSearch').press('Space');
  check('empty-search Space also focuses Cash while online',await page.locator('#pos-pay-cash').evaluate(el=>el===document.activeElement));
  // The fixture added this line through the server, so refresh through POS before taking the browser offline.
  const snapshotResponse=page.waitForResponse(response=>response.url().endsWith('/ajaxCart')&&
   new URLSearchParams(response.request().postData()||'').get('action')==='refresh');
  await page.evaluate(()=>window._posRefreshCart());
  const snapshot=await (await snapshotResponse).json();
  check('POS has an authoritative snapshot of the fixture cart before disconnecting',
   snapshot.success&&snapshot.transactionId===draft.transactionId&&!!snapshot.sourceRevision);
  await context.setOffline(true);
  await page.locator('#pos-offline-banner').waitFor();
  check('network loss preserves an editable existing bill instead of pausing it',!await page.evaluate(()=>window._posOffline.paused()));
  check('the original item survives network loss',await page.locator('.ofl-price').count()===1);
  await page.locator('.ofl-price').fill('80');
  await page.locator('.ofl-qi').fill('2');
  check('offline price and quantity edits immediately update tax-inclusive payable',await page.locator('#posSumTotal').textContent()==='₹189.00');
  check('offline side summary matches the editable bill',await page.locator('#pos-side-subtotal').textContent()==='₹160.00'&&await page.locator('#pos-side-tax').textContent()==='₹28.80');
  const controls=await page.locator('.pos-offline-payments button').evaluateAll(buttons=>buttons.map(b=>({text:b.textContent,rect:{top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right},width:innerWidth,height:innerHeight})));
  check('all offline payment and utility controls fit the desktop viewport',controls.length===9&&controls.every(b=>b.rect.top>=0&&b.rect.bottom<=b.height+2&&b.rect.left>=0&&b.rect.right<=b.width+2),controls);
  check('offline Discount stays in the header as a single enabled action',await page.locator('.nb-actionbar #pos-discount:enabled').count()===1&&await page.locator('#pos-discount').count()===1);
  await page.screenshot({path:path.join(out,'offline-editable-bill.png'),fullPage:true});
  await page.locator('.ofl-price').press('Enter');
  check('Enter in rate focuses quantity offline',await page.locator('.ofl-qi').evaluate(el=>el===document.activeElement));
  await page.locator('.ofl-qi').press('Enter');
  check('Enter in quantity returns to product search offline',await page.locator('#cartInlineSearch').evaluate(el=>el===document.activeElement));
  await page.locator('#cartInlineSearch').press('Space');
  check('Space in empty product search focuses Cash',await page.locator('#pos-pay-cash').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Enter');
  check('Enter opens cash with the exact bill amount',await page.locator('#oflReceived').inputValue()==='189.00');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog',{name:'Sale saved on this device'}).waitFor();
  const first=await page.evaluate(async()=>{const q=await window._posOffline.getQueue();return q[0];});
  check('offline sale is durable with source identity and revision',first?.sourceTransactionId===draft.transactionId&&!!first.sourceRevision&&first.items[0].price===80&&first.items[0].qty===2&&first.taxAmount===28.8,first);
  await page.locator('#posOfflineDialog .ofl-cancel').click();
  check('completed offline sale clears the live cart',await page.locator('.ofl-price').count()===0);
  await context.setOffline(false);
  await page.waitForFunction(async()=>!(await window._posOffline.getQueue()).length);
  let saved;
  for(let i=0;i<30;i++){saved=q("SELECT status_id,paid_amount,total_tax_amount,payable_amount FROM pos_transaction WHERE transaction_id='"+draft.transactionId+"'")[0];if(saved.status_id==='PtCompleted')break;await new Promise(r=>setTimeout(r,200));}
  check('reconnection completes the original draft with the collected amounts',saved.status_id==='PtCompleted'&&Number(saved.paid_amount)===189&&Number(saved.total_tax_amount)===28.8,saved);
  const replay=await invoke('offline',{terminalId,transactions:JSON.stringify([JSON.stringify(first)])});
  check('offline checkout retry is acknowledged exactly once',replay.syncedIds?.includes(first.offlineId)&&Number(q("SELECT count(*) AS n FROM pos_offline_transaction WHERE created_transaction_id='"+draft.transactionId+"'")[0].n)===1,replay);
  const noToken=await post('Terminal','syncOfflineTransactions',{terminalId,transactions:JSON.stringify(first)},a,false);
  check('offline replay requires the session CSRF token',[401,403].includes(noToken.status()),{status:noToken.status()});
  await context.setOffline(true);
  await page.evaluate(()=>window._posOffline.add('POS_QA_A_P5'));
  await page.locator('.ofl-mode').selectOption('WHOLESALE');
  check('offline mode changes resolve the cached product price',Number(await page.locator('.ofl-price').inputValue())===90);
  await page.locator('.pos-header form[action*="toggleTax"] button').click();
  check('offline tax off preserves the selected selling price',await page.locator('#posSumTotal').textContent()==='₹90.00');
  await page.locator('#pos-split').click();
  await page.locator('[data-tender=Cash]').fill('40');await page.locator('[data-tender=UPI]').fill('50');
  await page.locator('#oflConfirmPayment').click();
  await page.getByRole('dialog',{name:'Sale saved on this device'}).waitFor();
  const split=(await page.evaluate(()=>window._posOffline.getQueue()))[0];
  check('split checkout records the exact offline payment breakdown',split.payments.length===2&&split.taxOn==='N'&&split.total===90,split);
  await page.locator('#posOfflineDialog .ofl-cancel').click();
  await context.setOffline(false);await page.waitForFunction(async()=>!(await window._posOffline.getQueue()).length);
  let tenders=0;for(let i=0;i<30;i++){tenders=Number(q("SELECT count(*) AS n FROM pos_payment WHERE reference_number='OFFLINE:"+split.offlineId+"'")[0].n);if(tenders===2)break;await new Promise(r=>setTimeout(r,200));}
  check('split offline sync stores both tender rows',tenders===2,{tenders});
  for(const mutation of [{organizationPartyId:'POS_QA_B'},{userId:'ANOTHER_USER'},{terminalId:'POS_QA_B_TERM1'},{items:[{...first.items[0],productId:'POS_QA_B_P18'}]}]){
   const invalid={...first,...mutation,offlineId:'REJECT-'+Date.now()+'-'+Math.random()};
   const result=await invoke('offline',{terminalId,transactions:JSON.stringify([JSON.stringify(invalid)])});
   check('offline replay rejects a changed ownership boundary '+Object.keys(mutation)[0],result.failedCount===1&&!result.syncedIds?.length,result);
  }
  await context.setOffline(true);
  await page.evaluate(()=>window._posOffline.add('POS_QA_A_P18'));
  await page.locator('#pos-discount').click();await page.locator('#oflDiscount').fill('10');await page.locator('#posOfflineDialog button[type=submit]').click();
  check('offline bill discount updates payable with GST',await page.locator('#posSumTotal').textContent()==='₹106.00');
  await page.keyboard.press('F7');await page.waitForFunction(()=>!document.querySelector('.ofl-price'));
  await page.evaluate(()=>window._posOffline.add('POS_QA_A_P5'));await page.locator('.ofl-mode').selectOption('WHOLESALE');
  await page.evaluate(()=>window._posOffline.clearDraft());await page.locator('#pos-offline-holds').click();await page.locator('[data-recall]').click();
  check('offline held bill restores its original mode rate discount and GST',await page.locator('.ofl-mode').inputValue()==='RETAIL'&&await page.locator('.ofl-price').inputValue()==='100'&&await page.locator('#posSumTotal').textContent()==='₹106.00');
  await page.locator('#pos-offline-customer').click();await page.locator('#oflName').fill('Synthetic Offline Customer');await page.locator('#oflPhone').fill('9876543678');await page.locator('#posOfflineDialog button[type=submit]').click();
  await page.locator('#pos-credit').click();await page.locator('#oflConfirmPayment').click();await page.getByRole('dialog',{name:'Sale saved on this device'}).waitFor();
  const credit=(await page.evaluate(()=>window._posOffline.getQueue()))[0];
  check('offline credit retains customer and discounted tax',credit.paymentMethod==='Credit'&&credit.customer.name==='Synthetic Offline Customer'&&credit.total===106&&credit.taxAmount===16.2,credit);
  await page.locator('#oflPrintReceipt').click();
  const printed=await page.locator('#pos-offline-frame').evaluate(f=>f.contentDocument.body.innerText);
  check('offline printable receipt includes supplier customer units tax and outstanding',printed.includes('Synthetic Offline Customer')&&printed.includes('Nos')&&printed.includes('16.20')&&printed.includes('outstanding ₹106.00')&&printed.includes(credit.offlineId),{printed});
  await page.locator('#posOfflineDialog .ofl-cancel').click();
  await context.setOffline(false);await page.waitForFunction(async()=>!(await window._posOffline.getQueue()).length);
  let creditRow;for(let i=0;i<30;i++){creditRow=q("SELECT is_credit,paid_amount,payable_amount FROM pos_transaction WHERE customer_phone='9876543678' AND status_id='PtCompleted' ORDER BY completed_date DESC")[0];if(creditRow)break;await new Promise(r=>setTimeout(r,200));}
  check('offline credit sync creates the receivable without inventing payment',creditRow?.is_credit==='Y'&&Number(creditRow.paid_amount)===0&&Number(creditRow.payable_amount)===106,creditRow);
  const conflict=await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:false});await invoke('add',{transactionId:conflict.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  const before=q("SELECT payable_amount,status_id FROM pos_transaction WHERE transaction_id='"+conflict.transactionId+"'")[0];
  const rejected=await invoke('offline',{terminalId,transactions:JSON.stringify([JSON.stringify({...first,offlineId:'CONFLICT-'+Date.now(),sourceTransactionId:conflict.transactionId,sourceRevision:'stale'})])});
  check('changed server draft is not overwritten by a queued offline sale',rejected.failedCount===1&&JSON.stringify(q("SELECT payable_amount,status_id FROM pos_transaction WHERE transaction_id='"+conflict.transactionId+"'")[0])===JSON.stringify(before),rejected);
  const overpaid={...first,sourceTransactionId:null,sourceRevision:null,offlineId:'CASH-CHANGE-'+Date.now(),change:11,payments:[{method:'Cash',amount:200}]};
  const cashResult=await invoke('offline',{terminalId,transactions:JSON.stringify([JSON.stringify(overpaid)])});
  check('offline cash over-tender imports with an exact change amount',cashResult.syncedIds?.includes(overpaid.offlineId),cashResult);
  let cashRow;for(let i=0;i<30;i++){cashRow=q("SELECT p.amount,t.change_amount FROM pos_payment p JOIN pos_transaction t ON t.transaction_id=p.transaction_id WHERE p.reference_number='OFFLINE:"+overpaid.offlineId+"'")[0];if(cashRow)break;await new Promise(r=>setTimeout(r,200));}
  check('cash received and change remain auditable after sync',Number(cashRow?.amount)===200&&Number(cashRow?.change_amount)===11,cashRow);
  const separateModes={...first,sourceTransactionId:null,sourceRevision:null,offlineId:'TWO-MODES-'+Date.now(),change:0,items:[{...first.items[0],qty:1,price:100,mode:'RETAIL'},{...first.items[0],qty:1,price:100,mode:'WHOLESALE'}],taxAmount:36,total:236,payments:[{method:'Cash',amount:236}]};
  const modeResult=await invoke('offline',{terminalId,transactions:JSON.stringify([JSON.stringify(separateModes)])});
  check('equal-price lines in different modes sync successfully',modeResult.syncedIds?.includes(separateModes.offlineId),modeResult);
  let modeRows=[];for(let i=0;i<30;i++){modeRows=q("SELECT i.sales_mode_id FROM pos_transaction_item i JOIN pos_offline_transaction o ON o.created_transaction_id=i.transaction_id WHERE o.transaction_data_json LIKE '%"+separateModes.offlineId+"%'");if(modeRows.length===2)break;await new Promise(r=>setTimeout(r,200));}
  check('replay keeps separate line modes instead of merging equal-price items',modeRows.length===2&&new Set(modeRows.map(r=>r.sales_mode_id)).size===2,modeRows);
  await page.screenshot({path:path.join(out,'offline-workspace.png')});
 } finally {
  await context.setOffline(false);
  await context.close();
  // Leave no active drawer for the next scenario's no-session landing assertions.
  // These are synthetic tenders only; reconcile this fixture through the real close workflow.
  const summary=await post('Terminal','ajaxCart',{action:'sessionSummary',sessionId:session.sessionId});
  const cash=await summary.json();
  check('offline fixture exposes its final cash reconciliation',summary.ok()&&cash.success&&Number.isFinite(Number(cash.expectedCash)),cash);
  await invoke('close',{sessionId:session.sessionId,closingCash:String(cash.expectedCash)});
  check('offline fixture closes its own session before the next scenario',q("SELECT status_id FROM pos_session WHERE session_id='"+session.sessionId+"'")[0]?.status_id==='PsClosed');
 }
};
