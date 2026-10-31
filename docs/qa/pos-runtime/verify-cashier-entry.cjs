const path=require('node:path');
module.exports=async function({a,base,check,q,invoke,post,out}){
 const failures=[];const observe=(...args)=>{try{check(...args);}catch(error){failures.push(error.message);}};
 const terminalId='POS_QA_A_ENTRY';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable entry counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const page=await a.c.newPage();page.setDefaultTimeout(15000);page.on('dialog',dialog=>dialog.dismiss());
 let transactionId;
 try{
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&taxOn=N`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window._posAjax==='function');
  await page.locator('.nb-modes summary').click();await page.locator('[data-pos-layout=advanced]').click();
  const response=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
  await page.locator('.pos-product-grid form:has(input[name=productId][value=POS_QA_A_P18]) button').click();
  transactionId=(await (await response).json()).transactionId;
  await page.waitForTimeout(250);
  observe('product selection focuses its editable rate',await page.locator('.aj-p').evaluate(el=>el===document.activeElement));
  await page.locator('.aj-p').fill('80');await page.locator('.aj-p').press('Enter');await page.waitForTimeout(200);
  observe('Enter from rate selects quantity',await page.locator('.aj-qi').evaluate(el=>el===document.activeElement));
  await page.locator('.aj-qi').fill('2');await page.locator('.aj-qi').press('Enter');await page.waitForTimeout(300);
  observe('Enter from quantity returns to search',await page.locator('#cartInlineSearch').evaluate(el=>el===document.activeElement));
  await page.locator('.aj-p').fill('75');await page.locator('#cartInlineSearch').click();await page.waitForTimeout(800);
  const item=()=>q(`SELECT unit_price,quantity,line_total FROM pos_transaction_item WHERE transaction_id='${transactionId}'`)[0];
  observe('a typed rate saves without pressing Enter',Number(item().unit_price)===75&&Number(item().line_total)===150,item());
  observe('lower last-bill strip shows only the last amount',!(await page.locator('#pos-last-completed').innerText()).includes(' / ')&&(await page.locator('#pos-last-completed').innerText()).includes('Last amount'));
  await post('Terminal','ajaxCart',{action:'updatePrice',transactionId,itemSeqId:q(`SELECT item_seq_id FROM pos_transaction_item WHERE transaction_id='${transactionId}'`)[0].item_seq_id,newPrice:'80'});
  await invoke('pay',{transactionId,paymentMethod:'Card',amount:'160'});await invoke('complete',{transactionId});
  const receipt=(await invoke('receipt',{transactionId})).receipt;
  observe('manual selling-rate overrides are not advertised as a discount',Number(receipt.saving)===0,receipt);
  const frozen=()=>JSON.stringify([
   q(`SELECT transaction_id,payable_amount,paid_amount,discount_total,status_id FROM pos_transaction WHERE transaction_id='${transactionId}'`),
   q(`SELECT item_seq_id,unit_price,quantity,line_total FROM pos_transaction_item WHERE transaction_id='${transactionId}' ORDER BY item_seq_id`),
   q(`SELECT payment_id,amount,payment_method FROM pos_payment WHERE transaction_id='${transactionId}' ORDER BY payment_id`),
   q(`SELECT * FROM pos_transaction_amendment WHERE transaction_id='${transactionId}'`)]);
  const saved=frozen();
  await page.evaluate(()=>{window.__reprints=[];window._posPrintReceipt=(...args)=>window.__reprints.push(args);});
  await page.locator('.nb-abtn--history').click();await page.locator(`.hist-bill-row[data-tx-id="${transactionId}"]`).waitFor();
  observe('History rows offer a dedicated Reprint action',await page.locator(`.hist-bill-row[data-tx-id="${transactionId}"] .hist-reprint`).count()===1);
  if(await page.locator('.hist-reprint').count()){
   await page.locator(`.hist-bill-row[data-tx-id="${transactionId}"] .hist-reprint`).click();
   await page.waitForFunction(()=>window.__reprints.length===1);
   observe('History Reprint uses persisted receipt and leaves editor closed',await page.locator('#ced-print').count()===0&&await page.evaluate(()=>Number(window.__reprints[0][4].summary.total)===160));
   if(out)await page.screenshot({path:path.join(out,'bill-history-reprint.png')});
  }
  await page.locator(`.hist-bill-row[data-tx-id="${transactionId}"]`).click();
  observe('bill editor offers Print bill separately from Save and print',await page.locator('#ced-print').count()===1);
  if(await page.locator('#ced-print').count()){
   await page.locator('.ced-price').first().fill('1');
   await page.locator('#ced-print').click();await page.waitForFunction(()=>window.__reprints.length===2);
   observe('Print bill ignores unsaved editor drafts',await page.evaluate(()=>Number(window.__reprints[1][4].items[0].rate)===80));
   observe('reprinting changes no saved bill, tender or amendment',frozen()===saved);
  }
  await page.locator('#ced-cancel').click();
  const discounted=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:discounted.transactionId,productId:'POS_QA_A_P18',unitPrice:'80',quantity:'2',taxOn:'N'});
  const discount=await post('Terminal','ajaxCart',{action:'applyDiscount',transactionId:discounted.transactionId,sessionId:session.sessionId,taxOn:'N',billDiscType:'pct',billDiscValue:'10'});
  observe('an explicit discount saves successfully',(await discount.json()).success);
  await invoke('pay',{transactionId:discounted.transactionId,paymentMethod:'Card',amount:'144'});await invoke('complete',{transactionId:discounted.transactionId});
  const explicit=(await invoke('receipt',{transactionId:discounted.transactionId})).receipt;
  observe('You Saved includes only the explicit discount, without adding a manual-rate difference',Number(explicit.saving)===16&&Number(explicit.summary.total)===144,explicit);

  if(out)await page.screenshot({path:path.join(out,'cashier-entry.png')});
 }finally{await page.close();await invoke('close',{sessionId:session.sessionId,closingCash:'0'});}
 const cashier=await a.c.browser().newContext({javaScriptEnabled:false});
 try{
  const response=await cashier.request.get(`${base}/apps/zenith/Inventory/FindProduct`,{headers:{Authorization:'Basic '+Buffer.from('pos.cashier.qa:moqui').toString('base64')}});
  const html=await response.text();
  observe('cashier initial HTML never contains unauthorized Sales links',!/<a[^>]+class="zs-link"[^>]+data-mod="sales"/.test(html));
 }finally{await cashier.close();}
 if(failures.length)throw Error(failures.join('\n'));
};
