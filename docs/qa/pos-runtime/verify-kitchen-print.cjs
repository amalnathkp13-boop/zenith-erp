// Real server data/services; browser printing is intercepted, never sent to hardware.
module.exports=async function({a,foreign,base,post,rows,count,check,out}){
 const kotSessionId=await require('./kot-test-session.cjs')({a,base});
 const rawPost=post; post=(screen,action,args={},actor)=>rawPost(screen,action,screen==='Kitchen/KotBilling'?{sessionId:kotSessionId,...args}:args,actor);

 const path=require('node:path');
 const moneyState=()=>JSON.stringify(['pos_transaction','pos_payment','kitchen_order_ticket','kot_item','tax_line_detail'].map(t=>[t,count(t,'1=1')]));
 const items=[{productId:'POS_QA_A_P18',quantity:1},{productId:'POS_QA_A_P5',quantity:1}];
 const before=moneyState();
 let r=await post('Kitchen/KotBilling','cartReceipt',{itemsJson:JSON.stringify(items),notes:'Synthetic print note'}),data=await r.json();
 check('KOT quote uses real mixed-rate GST rather than a fixed five percent',data.success&&Number(data.receipt.summary.subtotal)===300&&Number(data.receipt.summary.tax)===28&&Number(data.receipt.summary.total)===328,data);
 check('customer quote creates no sale, payment, KOT, items or tax rows',moneyState()===before);
 r=await post('Kitchen/KotBilling','cartReceipt',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1,unitPrice:1,productName:'Forged name'}])});data=await r.json();
 check('quote ignores forged prices and labels',data.success&&Number(data.receipt.items[0].rate)===100&&data.receipt.items[0].name==='Disposable POS A P18');
 r=await post('Kitchen/KotBilling','cartReceipt',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:2,unitPrice:80,manualPrice:'Y'}]),taxOn:'N'});data=await r.json();
 check('explicit KOT price edit and tax OFF use the same persisted quote without GST',data.success&&Number(data.receipt.items[0].rate)===80&&Number(data.receipt.summary.subtotal)===160&&Number(data.receipt.summary.tax)===0&&data.receipt.bill.taxOn==='N',data);
 for(const payload of [[],[{productId:'POS_QA_B_P18',quantity:1}],[{productId:'POS_QA_A_P18',quantity:0}]]){
  r=await post('Kitchen/KotBilling','cartReceipt',{itemsJson:JSON.stringify(payload)});check('customer quote rejects invalid items '+JSON.stringify(payload),r.status()===403||!(await r.json()).success);
 }
 const page=await a.c.newPage();
 async function stubPrint(fail=false){await page.evaluate(fail=>{window.__printHtml=[];window.__printCalls=0;window.__printFail=fail;window.open=()=>({closed:false,document:{open(){},write(s){window.__printHtml.push(s);},close(){},images:[],fonts:{ready:Promise.resolve()}},focus(){},print(){if(window.__printFail)throw Error('Synthetic printer unavailable');window.__printCalls++;},close(){this.closed=true;}});},fail);}
 const priorDrafts=rows('kitchen_order_ticket',"organization_party_id='POS_QA_A' AND status_id='KotDraft'");
 await post('Kitchen/KotBilling','saveDraft',{itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:2}]),salesModeId:'RETAIL',orderType:'Take Away',taxOn:'N',notes:'Synthetic resumed quote'});
 const draft=rows('kitchen_order_ticket',"organization_party_id='POS_QA_A' AND status_id='KotDraft'").find(k=>!priorDrafts.some(x=>x.kot_id===k.kot_id));
 check('saved draft preserves the configured price and tax OFF in its receipt snapshot',!!draft&&Number(JSON.parse(draft.order_receipt_json).items[0].rate)===100&&JSON.parse(draft.order_receipt_json).bill.taxOn==='N');
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+kotSessionId+'&loadDraft='+encodeURIComponent(draft.kot_id));await page.locator('#kb-wrap[data-ready=true]').waitFor();
 await page.waitForFunction(()=>document.getElementById('kb-grand').textContent.includes('200.00'));
 const restoredRate=Number(await page.locator('#kb-cart [data-product="POS_QA_A_P18"] .kl-line-rate').innerText());
 const restoredTax=await page.locator('#kb-tax-toggle').getAttribute('aria-checked');
 const restoredType=await page.getByRole('button',{name:'Take Away',exact:true}).getAttribute('aria-pressed');
 const tableVisible=await page.locator('#kb-table').isVisible();
 check('resuming a draft restores its price, tax choice and order type',
  restoredRate===100&&restoredTax==='false'&&restoredType==='true'&&!tableVisible,
  {restoredRate,restoredTax,restoredType,tableVisible});
 await post('Kitchen/KotBilling','deleteDraft',{kotId:draft.kot_id});
 check('draft round trip leaves no sale or payment',moneyState()===before);
 const existing=rows('kitchen_order_ticket',"organization_party_id='POS_QA_A' AND status_id='KotNew'");
 await post('Kitchen/KotBilling','createKot',{itemsJson:JSON.stringify(items),notes:'Saved kitchen note'});
 const kot=rows('kitchen_order_ticket',"organization_party_id='POS_QA_A' AND status_id='KotNew'").find(k=>!existing.some(x=>x.kot_id===k.kot_id));
 check('sent order stores a receipt snapshot without creating a sale',!!kot?.order_receipt_json&&count('pos_transaction','1=1')===JSON.parse(before)[0][1]);
 for(const kind of ['kot','orderBill','view']){r=await post('Kitchen/KotBilling','printRecord',{kotId:kot.kot_id,kind},foreign);check('foreign shop cannot read '+kind+' print data',r.status()===403||!(await r.json()).success);}
 r=await post('Kitchen/KotHistory','printRecord',{kotId:kot.kot_id,kind:'bill'});
 check('History Bill Print does not invent an invoice for an unpaid KOT',!(await r.json()).success);
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+kotSessionId);await page.locator('#kb-history-open').click();await page.locator('#kb-history-status').selectOption('active');
 const card=page.locator('[data-kot-group="active"] .kb-ocard').filter({has:page.locator(`[data-kot-id="${kot.kot_id}"]`)});
 check('active order card has both independent print actions',await card.getByRole('button',{name:'KOT Print',exact:true}).count()===1&&await card.getByRole('button',{name:'Bill Print',exact:true}).count()===1);
 const printCount=()=>Number(rows('kitchen_order_ticket',`kot_id='${kot.kot_id}'`)[0].print_count);
 await stubPrint(true);const pc=printCount();await card.getByRole('button',{name:'KOT Print',exact:true}).click();await page.locator('#zk-print-status').filter({hasText:'Synthetic printer unavailable'}).waitFor();
 check('failed KOT print does not increment its print count',printCount()===pc);
 await stubPrint();await card.getByRole('button',{name:'KOT Print',exact:true}).click();await page.waitForFunction(()=>document.getElementById('zk-print-status')?.textContent.includes('1 print request'));
 check('accepted KOT print increments only its own count once',printCount()===pc+1);
 check('KOT template includes kitchen instructions and omits receipt prices',await page.evaluate(()=>window.__printHtml.join('').includes('Saved kitchen note')&&!window.__printHtml.join('').includes('GRAND TOTAL')));
 await stubPrint();const state=moneyState();await card.getByRole('button',{name:'Bill Print',exact:true}).click();await page.waitForFunction(()=>window.__printCalls===1);
 check('order-card Bill Print reuses saved pricing without writing a sale',moneyState()===state&&printCount()===pc+1&&await page.evaluate(()=>window.__printHtml.join('').includes('328.00')));
 await post('Kitchen/KitchenDisplay','updateStatus',{kotId:kot.kot_id,statusId:'KotCancelled'});
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+kotSessionId);await page.locator('#kb-history-open').click();await page.locator('#kb-history-status').selectOption('completed');
 check('completed order cards retain both print actions',await page.locator(`[data-kot-group="completed"] [data-kot-id="${kot.kot_id}"]`).count()===2);
 async function invoke(op,params){const response=await post('PosQaAcceptance','invoke',{op,...params});const body=await response.json();if(body.errors?.length)throw Error(JSON.stringify(body));return body.result;}
 const terminalId='POS_QA_KITCHEN_PRINT_'+Date.now();
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Synthetic kitchen print terminal',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'}),txn=await invoke('cart',{sessionId:session.sessionId,reuseOpenCart:'false'});
 await invoke('add',{transactionId:txn.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'Y'});
 await invoke('kot',{posTransactionId:txn.transactionId,items:JSON.stringify([items[0]])});
 const linked={kotId:rows('kitchen_order_ticket',`transaction_id='${txn.transactionId}'`)[0].kot_id};
 await invoke('pay',{transactionId:txn.transactionId,paymentMethod:'UPI',amount:'118'});await invoke('complete',{transactionId:txn.transactionId});
 r=await post('Kitchen/KotHistory','printRecord',{kotId:linked.kotId,kind:'bill'});data=await r.json();
 check('linked History bill comes from the real saved receipt',data.success&&Number(data.record.summary.total)===118&&data.record.bill.number===rows('pos_transaction',`transaction_id='${txn.transactionId}'`)[0].transaction_number,{data,transaction:rows('pos_transaction',`transaction_id='${txn.transactionId}'`)[0],linked});
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotHistory');await page.locator('#zk-history-toolbar').waitFor();
 const historyNumber=(await page.locator(`tr:has([data-kitchen-select="${linked.kotId}"]) td`).nth(1).innerText()).trim();
 check('POS-linked KOT without a number shows its stable ID in History',historyNumber===linked.kotId,{historyNumber,linked});
 check('History has live filtered cards and the order and item filters',await page.locator('[data-kitchen-history-count]').count()===4&&await page.locator('[name="filterOrderType"]').count()===1&&await page.locator('[name="filterQuery"]').count()===1);
 check('History rows show item summaries and order type',await page.locator(`[data-kitchen-history-items="${kot.kot_id}"]`).innerText().then(x=>x.includes('Disposable POS A P5'))&&await page.locator(`[data-kitchen-history-type="${kot.kot_id}"]`).innerText()==='Dine In');
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotHistory?filterQuery=P5');await page.locator('#zk-history-toolbar').waitFor();
 check('item search narrows KOT rows and the four counts together',await page.locator('[data-kitchen-select]').count()===1&&await page.locator(`[data-kitchen-select="${kot.kot_id}"]`).count()===1&&(await page.locator('[data-kitchen-history-count]').allTextContents()).map(x=>x.trim()).join(',')==='1,0,0,1');
 await page.goto(base+'/apps/zenith/pos/Kitchen/KotHistory');await page.locator('#zk-history-toolbar').waitFor();
 check('History bulk actions start disabled with zero selected',await page.locator('[data-kitchen-bulk="kot"]').isDisabled()&&await page.locator('[data-kitchen-selected-count]').innerText()==='0 selected');
 await page.locator(`[data-kitchen-select="${kot.kot_id}"]`).check();await page.locator(`[data-kitchen-select="${linked.kotId}"]`).check();
 check('bulk toolbar shows exactly the selected count',await page.locator('[data-kitchen-selected-count]').innerText()==='2 selected');
 await stubPrint();const counts=[printCount(),Number(rows('kitchen_order_ticket',`kot_id='${linked.kotId}'`)[0].print_count)];
 await page.locator('[data-kitchen-bulk="kot"]').click();await page.waitForFunction(()=>document.getElementById('zk-print-status')?.textContent.includes('2 print request'));
 check('bulk KOT printing prints only the two selected records',await page.evaluate(()=>window.__printCalls===2)&&printCount()===counts[0]+1&&Number(rows('kitchen_order_ticket',`kot_id='${linked.kotId}'`)[0].print_count)===counts[1]+1);
 await stubPrint();await page.locator('[data-kitchen-bulk="bill"]').click();await page.waitForFunction(()=>!document.querySelector('[data-kitchen-bulk="bill"]').disabled);
 const bulkStatus=await page.locator('#zk-print-status').innerText();
 check('bulk Bill Print reports missing linkage and prints only the linked bill',bulkStatus.includes('1 selected KOT(s) have no finalized customer bill')&&await page.evaluate(()=>window.__printCalls===1&&window.__printHtml.join('').includes('118.00')),{bulkStatus,prints:await page.evaluate(()=>window.__printCalls)});
 check('History displays acknowledged print counts immediately',Number(await page.locator(`[data-kitchen-print-count="${kot.kot_id}"]`).innerText())===counts[0]+1);
 await page.screenshot({path:path.join(out,'history-print-actions.png')});
 await invoke('close',{sessionId:session.sessionId,closingCash:'0'});await page.close();
};
