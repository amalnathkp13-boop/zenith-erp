const {randomUUID}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');

module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 const id=randomUUID().slice(0,8);
 const terminalId='QA_KOT_RECEIPTS_'+id;
 const modeCode='D'+id.toUpperCase();
 const billHeader='QA KOT customer '+id, ticketHeader='QA kitchen ticket '+id, salesHeader='QA daily sales '+id;
 const receiptPath='/zenith/kot/ReceiptConfig';
 const route=(shell,path)=>base+'/'+shell+'/zenith/kot/'+path;
 const kot=(path,form={},actor=a,shell='apps')=>actor.c.request.post(route(shell,path),{
  form:{moquiSessionToken:actor.t,...form},maxRedirects:0
 });
 const printContext=await require('./browser-print-context.cjs')(a.c);
 const page=await printContext.newPage();
 let sessionId;
 try {
  const templates={};
  for(const [shell,printUse,header,width] of [
   ['apps','kotTicket',ticketHeader,'58mm'],['qapps','kotBill',billHeader,'80mm'],['apps','kotSales',salesHeader,'58mm']
  ]) {
   const templateName='QA '+printUse+' '+id;
   await page.goto(base+'/'+shell+receiptPath+'/Templates');
   const form=page.locator('#CreateTemplate');
   await form.getByLabel('Print output').selectOption(printUse);
   await form.getByLabel('Template Name',{exact:true}).fill(templateName);
   await form.getByLabel('Company Name',{exact:true}).fill('QA print company');
   await form.getByLabel('Shop',{exact:true}).selectOption('POS_QA_A_FAC');
   await form.getByLabel('Receipt Width',{exact:true}).selectOption(width);
   await form.getByRole('button',{name:'Create Template',exact:true}).click();
   await page.getByRole('link',{name:new RegExp(templateName)}).click();
   await page.locator('#receiptEditor[data-bound="1"]').waitFor();
   const editor=page.locator('#receiptEditorForm');
   await page.locator('#receiptEditor[data-bound="1"]').waitFor();
   await editor.locator('[name=headerText]').fill(header);
   await editor.locator('[name=isDefault]').selectOption('Y');
   if(printUse==='kotBill'){
    await editor.getByLabel('Show invoice number',{exact:true}).check({timeout:5000});
    await editor.getByLabel('Show daily bill number',{exact:true}).check();
    await editor.getByLabel('Daily bill number label',{exact:true}).fill('Daily receipt:');
    const preview=page.frameLocator('iframe[title="Live receipt preview"]');
    await preview.getByText('Daily receipt:',{exact:true}).waitFor();
    await preview.getByText('Invoice No:',{exact:true}).waitFor();
    await editor.getByLabel('Show invoice number',{exact:true}).uncheck();
    await preview.getByText('Invoice No:',{exact:true}).waitFor({state:'hidden'});
    await editor.getByLabel('Show invoice number',{exact:true}).check();
   }
   await page.frameLocator('iframe[title="Live receipt preview"]').getByText(header,{exact:true}).waitFor();
   const [saved]=await Promise.all([
    page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/updateTemplate')),
    page.locator('button[form=receiptEditorForm]').click()
   ]);
   const row=q(`SELECT template_id,print_use,receipt_width,header_text,is_default FROM pos_receipt_template WHERE template_name='${templateName}' AND organization_party_id='POS_QA_A'`)[0];
   check(shell+' saves the selected KOT print design and its preview',saved.status()===302&&
    row?.print_use===printUse&&row?.header_text===header&&row?.receipt_width===width&&row?.is_default==='Y',row);
   templates[printUse]=row.template_id;
  }
  await page.goto(base+'/apps/zenith/pos/ReceiptConfig/Templates');
  check('KOT designs are absent from ordinary POS Receipts',
   await page.getByText('QA kotTicket '+id,{exact:false}).count()===0&&
   await page.getByText('QA kotBill '+id,{exact:false}).count()===0);
  await post('ReceiptConfig/EditTemplate','updateTemplate',{templateId:templates.kotBill,headerText:'Wrong module'});
  await kot('ReceiptConfig/EditTemplate/updateTemplate',{templateId:templates.kotTicket,headerText:'Wrong organization'},foreign);
  check('wrong-module and foreign edits leave KOT designs unchanged',
   q(`SELECT header_text FROM pos_receipt_template WHERE template_id IN ('${templates.kotBill}','${templates.kotTicket}')`).every(row=>[billHeader,ticketHeader].includes(row.header_text)));

  await post('PosTerminals','createTerminal',{terminalId,terminalName:'QA KOT receipts '+id,facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  ({sessionId}=await invoke('open',{terminalId,openingCash:'0'}));
  await post('SalesMode','createMode',{modeName:'QA discount '+id,modeCode,priceSource:'PpsDiscountMrp',discountPercent:'5'});
  const mode=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id='POS_QA_A' AND mode_code='${modeCode}'`)[0];
  const salesModeId=mode?.sales_mode_id;
  check('QA discount mode exists',!!salesModeId);
  const today=async(actor=a)=> (await (await kot('KotBilling/todaySales',{sessionId},actor)).json());
  const empty=await today();
  check('daily sales report is empty at a fresh counter',empty.success&&empty.report.billCount===0,empty);
  const otherCounter=await kot('KotBilling/todaySales',{sessionId},foreign);
  check('a foreign user cannot read this counter daily sales',
   [401,403].includes(otherCounter.status())||(await otherCounter.json().catch(()=>null))?.success===false);
  await kot('DiscountSettings/saveKotDiscount',{salesModeId,discountPercent:'20'});
  const productId='POS_QA_A_P18';
  const payload={sessionId,itemsJson:JSON.stringify([{productId,quantity:1}]),salesModeId,taxOn:'N',orderType:'Take Away',wantJson:'Y'};
  const quote=await (await kot('KotBilling/cartReceipt',payload)).json();
  check('KOT quote uses its own discount and customer bill design',
   quote.success&&Number(quote.receipt.summary.total)===80&&quote.receipt.store.headerText===billHeader,quote);
  const workspace=(await (await kot('KotBilling/exportOfflineWorkspace',{sessionId})).json()).workspace;
  check('offline KOT caches the selected receipt numbering options',workspace?.receiptOptions?.normal.dailyBillNumberLabel==='Daily receipt:'&&
   workspace.receiptOptions.credit.showDailyBillNumber);
  const draft=await (await kot('KotBilling/saveDraft',payload)).json();
  check('KOT saves the discounted quote in a held order',draft.success&&!!draft.kotId,draft);
  await kot('DiscountSettings/saveKotDiscount',{salesModeId,discountPercent:'40'});
  const savedDiscount=q(`SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KOT_MODE_DISCOUNT_${salesModeId}'`)[0]?.setting_value;
  check('an unpaid KOT prevents changes to the saved mode discount',Number(savedDiscount)===20);
  const paid=await (await kot('KotBilling/checkoutKot',{sessionId,kotId:draft.kotId,paymentMethod:'Cash',cashAmount:'80'})).json();
  check('checkout settles the KOT discount once at its quoted total',paid.success&&!!paid.billNumber,paid);
  const bill=q(`SELECT p.transaction_id,p.payable_amount FROM kitchen_order_ticket k JOIN pos_transaction p USING (transaction_id) WHERE k.kot_id='${draft.kotId}'`)[0];
  check('the saved KOT bill has the discounted amount',Number(bill?.payable_amount)===80);
  const {invoiceId}=await invoke('sync',{transactionId:bill.transaction_id});
  const fiscal=q(`SELECT gst_invoice_number FROM invoice WHERE invoice_id='${invoiceId}'`)[0]?.gst_invoice_number;
  const receipt=async(kind)=> (await (await kot('KotBilling/printRecord',{sessionId,kotId:draft.kotId,kind})).json()).record;
  const orderPrint=await receipt('kot'),billPrint=await receipt('bill');
  check('KOT Order and Bill Print use independent templates with no amounts on the ticket',
   orderPrint?.store?.headerText===ticketHeader&&orderPrint.store.receiptWidth==='58mm'&&!orderPrint.summary&&
   billPrint?.store?.headerText===billHeader&&Number(billPrint.summary.total)===80&&billPrint.bill.number===paid.billNumber);
  const firstDaily=Number(billPrint?.bill?.numbers?.daily);
  check('KOT carries the fiscal invoice and the saved daily bill number separately',
   firstDaily>0&&!!fiscal&&billPrint.bill.numbers.invoice===fiscal&&billPrint.options.showDailyBillNumber&&
   billPrint.options.dailyBillNumberLabel==='Daily receipt:'&&
   Number(q(`SELECT daily_bill_number FROM kitchen_order_ticket WHERE kot_id='${draft.kotId}'`)[0]?.daily_bill_number)===firstDaily,
   billPrint.bill);
  const dineIn=await (await kot('KotBilling/saveDraft',{...payload,orderType:'Dine In',additionalFee:'5.25'})).json();
  check('KOT saves a separate dine-in order',dineIn.success&&!!dineIn.kotId,dineIn);
  const dineInPaid=await (await kot('KotBilling/checkoutKot',{sessionId,kotId:dineIn.kotId,paymentMethod:'Cash',cashAmount:'85'})).json();
  check('KOT finalizes the dine-in order',dineInPaid.success&&!!dineInPaid.billNumber,dineInPaid);
  const secondTicket=q(`SELECT daily_bill_number FROM kitchen_order_ticket WHERE kot_id='${dineIn.kotId}'`)[0];
  const retried=await (await kot('KotBilling/checkoutKot',{sessionId,kotId:dineIn.kotId,paymentMethod:'Cash',cashAmount:'85'})).json();
  check('successive KOT bills increment once and checkout retries keep the same transaction',
   Number(secondTicket?.daily_bill_number)===firstDaily+1&&retried.transactionId===dineInPaid.transactionId);
  const held=await (await kot('KotBilling/saveDraft',payload)).json();
  check('an unpaid held order exists for the counter',held.success&&!!held.kotId,held);
  const report=await today();
  check('daily sales reconciles discounted lines, a held exclusion and the additional fee once',
   report.success&&report.report.billCount===2&&report.report.products.length===1&&
   Number(report.report.products[0].qty)===2&&Number(report.report.products[0].net)===160&&
   Number(report.report.discount)===40&&Number(report.report.additionalFee)===5.25&&
   Number(report.report.roundOff)===-0.25&&Number(report.report.total)===165&&report.report.store.headerText===salesHeader,report);
  await page.goto(route('apps','KotBilling?sessionId='+sessionId+'&loadDraft='+held.kotId));
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  check('today sales sits beside the waiter, close is in the header and last bill is hidden there',
   await page.locator('#kb-today-sales').evaluate(button=>button.previousElementSibling.querySelector('#kb-waiter')!==null)&&
   await page.locator('.kg-header #kb-close-session').isVisible()&&await page.locator('#kb-header-last-bill').isHidden());
  await page.waitForFunction(()=>document.querySelector('#kb-cart tr[data-product]')?.textContent.includes('80.00'));
  const readCart=()=>page.locator('#kb-cart tr[data-product]').evaluateAll(rows=>rows.map(row=>({
   product:row.dataset.product,
   values:Array.from(row.querySelectorAll('input'),input=>input.value)
  })));
  const cartBefore=await readCart();
  await page.evaluate(()=>{window.salesPrintJobs=[];window.PosQzPrint={
   connect:async()=>({printers:{getDefault:async()=>'Synthetic thermal'}}),
   printHtml:async(printer,html)=>window.salesPrintJobs.push({printer,html})
  };});
  await page.locator('#kb-today-sales').click();
  await page.waitForFunction(()=>window.salesPrintJobs.length===1);
  const printed=await page.evaluate(()=>window.salesPrintJobs[0]);
  check('QZ prints the customized 58mm summary without changing the held cart',
   printed.printer==='Synthetic thermal'&&printed.html.includes('data-paper-width="58"')&&printed.html.includes(salesHeader)&&
   printed.html.includes('165.00')&&JSON.stringify(await readCart())===JSON.stringify(cartBefore),printed);
  if(out) await page.screenshot({path:join(out,'kot-list-today-sales.png')});
  await page.locator('.kg-modes summary').click();
  await page.getByRole('button',{name:'Grid View',exact:true}).click();
  check('grid keeps the print button and additional fee visible',
   await page.locator('#kb-today-sales').isVisible()&&await page.locator('#kb-fee').isVisible());
  if(out) await page.screenshot({path:join(out,'kot-grid-today-sales.png')});
  const [clearResponse]=await Promise.all([
   page.waitForResponse(response=>response.url().endsWith('/deleteDraft'),{timeout:10000}),
   page.locator('#kb-clear').click()
  ]);
  const cleared=await clearResponse.json();
  check('Clear Cart confirms deletion on the server',cleared.success,cleared);
  await page.locator('#kb-cart tr[data-product]').first().waitFor({state:'hidden'});
  const heldStatus=()=>q("SELECT status_id FROM kitchen_order_ticket WHERE kot_id='"+held.kotId+"'")[0]?.status_id;
  let status=heldStatus();
  // The transition streams JSON before the outer transaction commits.
  for(let attempt=0;status==='KotDraft'&&attempt<8;attempt++){
   await new Promise(resolve=>setTimeout(resolve,125));
   status=heldStatus();
  }
  check('Clear Cart retires the resumed held bill',status==='KotCancelled',
   {status,kotId:held.kotId,submittedId:new URLSearchParams(clearResponse.request().postData()).get('kotId')});
  const dineInPrint=await (await kot('KotBilling/printRecord',{sessionId,kotId:dineIn.kotId,kind:'bill'},a,'qapps')).json();
  check('finalized KOT print records keep each saved order type',
   billPrint.bill.orderType==='Take Away'&&dineInPrint.record?.bill?.orderType==='Dine In',
   {takeAway:billPrint.bill,dineIn:dineInPrint.record?.bill});
  await page.goto(route('apps','KotBilling?sessionId='+sessionId));
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  await page.evaluate(()=>{
   window.qaPrintHtml=[];
   window.qaPrintWindows=[];
   window.open=()=>{
    const popup=Object.assign(new EventTarget(),{
     closed:false,document:{open(){},write(html){window.qaPrintHtml.push(html);},
      close(){},images:[],fonts:{ready:Promise.resolve()}},
     focus(){},print(){this.dispatchEvent(new Event('afterprint'));},close(){this.closed=true;}
    });
    window.qaPrintWindows.push(popup);
    return popup;
   };
  });
  await page.locator('#kb-history-open').click();
  async function printFromHistory(kotId,name){
   await page.locator('#kb-history-rows [data-kot-id="'+kotId+'"]')
    .getByRole('button',{name:'Reprint',exact:true}).click();
   await page.getByRole('dialog',{name:'Reprint',exact:true}).getByRole('button',{name,exact:true}).click();
  }
  await printFromHistory(draft.kotId,'KOT Print');
  await page.locator('#kb-history-print-status').getByText('Print request opened.').waitFor();
  await printFromHistory(draft.kotId,'Bill Print');
  await page.waitForFunction(()=>window.qaPrintHtml.length===2&&window.qaPrintWindows.every(popup=>popup.closed));
  check('browser prints the configured kitchen ticket and customer bill',
   await page.evaluate(([orderText,billText])=>window.qaPrintHtml[0].includes(orderText)&&
    !window.qaPrintHtml[0].includes(billText)&&window.qaPrintHtml[1].includes(billText)&&
    !window.qaPrintHtml[1].includes(orderText),[ticketHeader,billHeader]));
  check('KOT customer reprint shows both configured numbers with their saved values',await page.evaluate(({invoice,daily})=>{
   const doc=new DOMParser().parseFromString(window.qaPrintHtml[1],'text/html');
   const value=label=>Array.from(doc.querySelectorAll('.meta td')).find(cell=>cell.textContent===label)?.nextElementSibling?.textContent;
   return value('Invoice No:')===invoice&&value('Daily receipt:')===String(daily);
  },{invoice:fiscal,daily:firstDaily}));
  await printFromHistory(dineIn.kotId,'Bill Print');
  await page.waitForFunction(()=>window.qaPrintHtml.length===3&&window.qaPrintWindows.every(popup=>popup.closed));
  check('customer bill reprints show the selected order type',await page.evaluate(()=>{
   const readType=html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    const label=Array.from(doc.querySelectorAll('td')).find(cell=>cell.textContent==='Order Type:');
    return label?.nextElementSibling?.textContent;
   };
   return readType(window.qaPrintHtml[1])==='Take Away'&&readType(window.qaPrintHtml[2])==='Dine In';
  }));
  const pdf=await a.c.request.get(base+'/fop/apps/zenith/kot/ReceiptPdf?transactionId='+bill.transaction_id);
  const pdfBytes=await pdf.body();
  check('KOT customer bill PDF renders',pdf.ok()&&pdfBytes.subarray(0,4).toString()==='%PDF');
  if(out) writeFileSync(join(out,'kot-customized-receipt.pdf'),pdfBytes);
  const dineInPdf=await a.c.request.get(base+'/fop/apps/zenith/kot/ReceiptPdf?transactionId='+dineInPaid.transactionId);
  const dineInPdfBytes=await dineInPdf.body();
  check('Dine-in customer bill PDF renders',dineInPdf.ok()&&dineInPdfBytes.subarray(0,4).toString()==='%PDF');
  if(out) writeFileSync(join(out,'kot-dine-in-receipt.pdf'),dineInPdfBytes);

  const regular=await invoke('cart',{sessionId,reuseOpenCart:'false'});
  await invoke('add',{transactionId:regular.transactionId,productId,quantity:'1',salesModeId,taxOn:'N'});
  const posAmount=q(`SELECT payable_amount FROM pos_transaction WHERE transaction_id='${regular.transactionId}'`)[0]?.payable_amount;
  check('ordinary POS still uses its original discount',Number(posAmount)===95);
  await invoke('pay',{transactionId:regular.transactionId,paymentMethod:'Cash',amount:'95'});
  await invoke('complete',{transactionId:regular.transactionId});
  const normal=(await invoke('receipt',{transactionId:regular.transactionId})).receipt;
  check('ordinary POS prints its own receipt design without a KOT order type',!!normal&&
   normal.store.headerText!==billHeader&&normal.store.headerText!==ticketHeader&&!normal.bill.orderType&&!normal.bill.numbers);

  const returned=await invoke('returnCreate',{sessionId,originalTransactionId:bill.transaction_id,refundMethod:'Cash',
   items:JSON.stringify([{productId,quantity:1,unitPrice:12.5}])});
  await invoke('returnComplete',{returnId:returned.returnId});
  const net=await today();
  check('daily sales excludes ordinary POS and reconciles completed refunds',
   net.success&&net.report.billCount===2&&net.report.returnCount===1&&Number(net.report.total)===152.5&&
   Number(net.report.products[0].qty)===1&&Number(net.report.products[0].net)===147.5,net);

  const sample=mode=>post('PosQaAcceptance','kotTodaySalesFixture',{sessionId,mode});
  try {
   check('the synthetic high-volume fixture was saved',(await (await sample('seed')).json()).success);
   const legacyId='QA_SALES_'+sessionId+'_1';
   const legacy=await (await kot('KotBilling/printRecord',{sessionId,kotId:legacyId,kind:'bill'})).json();
   check('existing KOT bills can show an invoice number and daily number without rewriting the ticket',
    legacy.record?.bill.numbers?.invoice===legacyId&&Number(legacy.record?.bill.numbers?.daily)>0&&
    q(`SELECT daily_bill_number FROM kitchen_order_ticket WHERE kot_id='${legacyId}'`)[0]?.daily_bill_number==null,legacy.record?.bill);
   const large=await today();
   const {text:printedText,columns}=await page.evaluate(report=>{
    const doc=new DOMParser().parseFromString(KitchenPrint.salesHtml(report),'text/html');
    return {text:doc.body.textContent,columns:doc.querySelectorAll('thead th').length};
   },large.report);
   check('the printout consolidates 140 finalized bills, varying rates, voided and cancelled receipts, and a duplicate ticket',
    large.success&&large.report.billCount===140&&large.report.products.length===1&&columns===3&&
    Number(large.report.products[0].qty)===139&&Number(large.report.products[0].net)===3942.5&&
    Number(large.report.total)===3947.5&&printedText.includes('Completed bills: 140')&&
    printedText.includes('3,947.50'),large);
  } finally {
   check('the synthetic high-volume fixture was removed',(await (await sample('clean')).json()).success);
  }

  const toClose=await (await kot('KotBilling/saveDraft',payload)).json();
  check('a new held order belongs to the current session',toClose.success&&
   q("SELECT draft_session_id FROM kitchen_order_ticket WHERE kot_id='"+toClose.kotId+"'")[0]?.draft_session_id===sessionId);
  const drawer=await (await kot('KotBilling/sessionDrawer',{sessionId,drawerAction:'close',closingCash:'247.50'})).json();
  check('closing the counter cancels only the unpaid held order',drawer.success&&
   q("SELECT status_id FROM kitchen_order_ticket WHERE kot_id='"+toClose.kotId+"'")[0]?.status_id==='KotCancelled'&&
   q("SELECT status_id FROM pos_transaction WHERE transaction_id='"+bill.transaction_id+"'")[0]?.status_id==='PtCompleted',drawer);
  const otherTerminal=terminalId+'_2';
  const shopName='QA KOT second shop '+id;
  await post('../Inventory/FindFacility','createFacility',{facilityName:shopName,facilityTypeEnumId:'FcTpRetailStore'});
  const facilityId=q(`SELECT facility_id FROM facility WHERE facility_name='${shopName}' AND owner_party_id='POS_QA_A'`)[0]?.facility_id;
  check('a fresh KOT shop exists for the independent series',!!facilityId);
  await post('PosTerminals','createTerminal',{terminalId:otherTerminal,terminalName:shopName,facilityId,stateCode:'33',isActive:'Y'});
  const otherShop=(await invoke('open',{terminalId:otherTerminal,openingCash:'0'})).sessionId;
  try {
   const secondPayload={...payload,sessionId:otherShop};
   const otherDraft=await (await kot('KotBilling/saveDraft',secondPayload)).json();
   const otherPaid=await (await kot('KotBilling/checkoutKot',{sessionId:otherShop,kotId:otherDraft.kotId,paymentMethod:'Cash',cashAmount:'80'})).json();
   const otherNumber=q(`SELECT daily_bill_number FROM kitchen_order_ticket WHERE kot_id='${otherDraft.kotId}'`)[0]?.daily_bill_number;
   check('a shop with no other KOT bills begins its own sequence at 1',otherPaid.success&&Number(otherNumber)===1,{otherPaid,otherNumber});
   const overnight=await (await kot('KotBilling/saveDraft',{...secondPayload,salesModeId:'RETAIL',
    itemsJson:JSON.stringify([{productId,quantity:1,unitPrice:80,manualPrice:'Y'}])})).json();
   const tomorrow=await (await post('PosQaAcceptance','checkoutKotTomorrow',{sessionId:otherShop,kotId:overnight.kotId})).json();
   const nextDayNumber=q(`SELECT daily_bill_number FROM kitchen_order_ticket WHERE kot_id='${overnight.kotId}'`)[0]?.daily_bill_number;
   check('a bill issued after midnight in the issuing shop starts at 1 again',tomorrow.success&&Number(nextDayNumber)===1,
    {tomorrow,nextDayNumber});
  } finally {
   if(otherShop) await invoke('close',{sessionId:otherShop,closingCash:'160'});
  }
  const nav=await a.c.request.get(route('apps','Tables/goTransactions'),{maxRedirects:0});
  check('KOT Tables opens KOT Transactions without leaving the module',
   nav.status()===302&&new URL(nav.headers().location,base).pathname.endsWith('/zenith/kot/PosTransactions'));
 } finally {
  await printContext.close();
  if(sessionId) await invoke('close',{sessionId,closingCash:'0'});
 }
};
