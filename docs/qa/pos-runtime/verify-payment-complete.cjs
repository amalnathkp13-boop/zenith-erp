// Exercise the rendered till with real disposable POS bills and an intercepted print device.
module.exports = async function ({a, base, check, q, invoke, post}) {
 const methods = ['Cash', 'Card', 'UPI', 'Credit', 'Split'];
 const buttonStyles = [
  {label:'save',color:'rgb(23, 70, 128)',background:'rgb(255, 255, 255)'},
  {label:'save & print',color:'rgb(255, 255, 255)',background:'rgb(23, 70, 128)'}
 ];
 for (const [layoutIndex, layout] of ['normal', 'advanced'].entries()) for (const offline of [false, true]) {
  const terminalId = 'POS_QA_COMPLETE_'+Date.now()+'_'+layoutIndex+Number(offline);
  const scenario = layout+' '+(offline?'offline':'online');
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable payment completion '+scenario,
   facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',regionGeoId:'33',stateCode:'33',isActive:'Y'});
  const {sessionId} = await invoke('open',{terminalId,openingCash:'0'});
  const context = await a.c.browser().newContext({storageState:await a.c.storageState(),serviceWorkers:'block',viewport:{width:1366,height:768}});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const checkout = /\/Terminal\/(payAndComplete|splitPayAndComplete|completeCredit)$/;
  let requests=0;
  const offlineIds=[];
  page.on('request',request=>{if(request.method()==='POST'&&checkout.test(new URL(request.url()).pathname)) requests++;});
  await page.route(/qz-tray(?:\.min)?\.js(?:[?#]|$)/i,route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   window.qaReceipts=[];
   localStorage.setItem('posPrinter','Disposable QA printer');
   window.qz={websocket:{isActive:()=>true},configs:{create:()=>({})},print:(_config,receipts)=>{
    window.qaReceipts.push(receipts[0].data);return Promise.resolve();
   }};
   const iframeWindow=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow').get;
   Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{configurable:true,get(){
    const frame=iframeWindow.call(this);
    if(this.id==='pos-offline-frame'&&frame) frame.print=()=>window.qaReceipts.push(this.contentDocument.body.innerText);
    return frame;
   }});
  });
  const queue=()=>page.evaluate(()=>window._posOffline.getQueue());
  const receipt=page.locator('#posPayConfirmOverlay'), save=receipt.locator('#posPaySave'), print=receipt.locator('#posPaySavePrint');
  const buttons={Cash:'#pos-pay-cash',Card:'#pos-pay-card',UPI:'#pos-pay-upi',Credit:'#pos-credit',Split:'#pos-split'};
  const bills=()=>q(`SELECT transaction_id,transaction_number,status_id,paid_amount,is_credit FROM pos_transaction WHERE session_id='${sessionId}' AND status_id='PtCompleted'`);
  try {
   await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${sessionId}&taxOn=N&salesModeId=RETAIL`);
   await page.locator('.nb-modes summary').click();await page.locator(`[data-pos-layout=${layout}]`).click();
   await page.waitForFunction(()=>window._posOffline?.lookup('POS_QA_A_P18')&&typeof window._posAjax==='function');
   if(offline) {
    await context.setOffline(true);
    await page.waitForFunction(()=>window._posOffline.active()&&!window._posOffline.paused());
   }
   for (const [methodIndex,method] of methods.entries()) {
    const step=scenario+' '+method;
    const shouldPrint=(methodIndex+layoutIndex+Number(offline))%2===1;
    const printCount=await page.evaluate(()=>window.qaReceipts.length);
    const requestCount=requests;
    if (offline) await page.evaluate(()=>window._posAjax('POS_QA_A_P18',100,'Disposable POS A P18'));
    else {
     const added=page.waitForResponse(response=>response.url().endsWith('/ajaxCart')&&
      new URLSearchParams(response.request().postData()||'').get('action')==='addItem');
     await page.evaluate(()=>window._posAjax('POS_QA_A_P18',100,'Disposable POS A P18'));
     check(step+' product added to the server cart',(await (await added).json()).success===true);
    }
    await page.locator('.pos-cart .aj-qi').waitFor();
    if(!offline) await page.waitForFunction(()=>document.querySelector('#cartInlineAddForm [name=transactionId]')?.value);
    const txId=await page.locator('#cartInlineAddForm [name=transactionId]').inputValue();
    await page.locator(buttons[method]).click();
    if(method==='Cash') {
     await page.locator('#posCashRecv,#pos-cash-received,.pos-cash-input').filter({visible:true}).fill('100');
     await page.locator('#posCashConfirm,.pos-cash-confirm').filter({visible:true}).click();
    } else if(method==='Credit') {
     await page.locator('#credit-name').fill('Disposable completion customer');
     await page.locator('#credit-phone').fill('91'+String(Date.now()).slice(-8));
     await page.locator('#credit-confirm').click();
    } else if(method==='Split') {
     await page.locator('#pos-split-cash').fill('50');
     await page.locator('#pos-split-card').fill('50');
     await page.locator('.pos-split-confirm').click();
    }
    await receipt.waitFor();
    const completed=offline?(await queue()).find(sale=>!offlineIds.includes(sale.offlineId)):bills().find(bill=>bill.transaction_id===txId);
    const reference=offline?completed?.offlineId:completed?.transaction_number;
    const details=await receipt.innerText();
    check(step+' Payment Complete displays the actual saved bill reference',!!reference&&details.includes(reference)&&/Payment Complete/i.test(details),{reference,details});
    check(step+' persists exactly one bill before either receipt choice',offline?
     requests===requestCount&&(await queue()).length===offlineIds.length+1&&completed.paymentMethod===method:
     requests===requestCount+1&&completed.status_id==='PtCompleted'&&bills().length===methodIndex+1);
    if(offline) offlineIds.push(reference);
    const controls=await receipt.getByRole('button').evaluateAll(buttons=>buttons.map(button=>({label:button.textContent.toLowerCase(),
     color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor})));
    check(step+' uses the shared Save and Save & print styles',JSON.stringify(controls)===JSON.stringify(buttonStyles),controls);
    check(step+' initially focuses Save',await save.evaluate(button=>document.activeElement===button));
    await page.keyboard.press('ArrowRight');
    check(step+' moves right to print',await print.evaluate(button=>document.activeElement===button));
    await page.keyboard.press('ArrowLeft');
    check(step+' moves left to Save',await save.evaluate(button=>document.activeElement===button));
    if(shouldPrint) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');await receipt.waitFor({state:'hidden'});
    if(shouldPrint) await page.waitForFunction(count=>window.qaReceipts.length===count,printCount+1);
    const printed=await page.evaluate(count=>window.qaReceipts.slice(count),printCount);
    check(step+' Enter applies only the selected receipt action',shouldPrint?printed.length===1&&printed[0].includes(reference):printed.length===0,printed.length);
    check(step+' receipt action cannot save or charge twice',offline?
     requests===requestCount&&(await queue()).length===offlineIds.length:
     requests===requestCount+1&&bills().length===methodIndex+1);
    await page.locator('.pos-cart .aj-qi').waitFor({state:'detached'});
   }
   if(offline) {
    await page.evaluate(()=>window.addEventListener('posofflinesynced',()=>{window.qaOfflineSynced=true;},{once:true}));
    const sync=page.waitForResponse(response=>response.url().endsWith('/syncOfflineTransactions')&&
     offlineIds.every(id=>response.request().postData()?.includes(id)));
    await context.setOffline(false);
    const acknowledgement=await (await sync).json();
    check(scenario+' acknowledges every saved offline bill',offlineIds.every(id=>acknowledgement.syncedIds?.includes(id)),acknowledgement);
    await page.waitForFunction(()=>window.qaOfflineSynced===true);
    const imported=q(`SELECT o.transaction_data_json FROM pos_offline_transaction o JOIN pos_transaction t ON t.transaction_id=o.created_transaction_id WHERE t.session_id='${sessionId}' AND t.status_id='PtCompleted'`);
    check(scenario+' synchronizes all five sales exactly once',!(await queue()).length&&bills().length===methods.length&&
     offlineIds.every(id=>imported.filter(row=>JSON.parse(row.transaction_data_json).offlineId===id).length===1),imported.length);
   }
  } finally {
   await context.close();
   await invoke('close',{sessionId,closingCash:'150'});
  }
 }
};
