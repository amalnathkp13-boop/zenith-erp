const {randomUUID}=require('node:crypto');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');

module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 const id=randomUUID().slice(0,8);
 const terminalId='QA_KOT_RECEIPTS_'+id;
 const modeCode='D'+id.toUpperCase();
 const billHeader='QA KOT customer '+id, ticketHeader='QA kitchen ticket '+id;
 const receiptPath='/zenith/kot/ReceiptConfig';
 const route=(shell,path)=>base+'/'+shell+'/zenith/kot/'+path;
 const kot=(path,form={},actor=a,shell='apps')=>actor.c.request.post(route(shell,path),{
  form:{moquiSessionToken:actor.t,...form},maxRedirects:0
 });
 const page=await a.c.newPage();
 let sessionId;
 try {
  const templates={};
  for(const [shell,printUse,header,width] of [
   ['apps','kotTicket',ticketHeader,'58mm'],['qapps','kotBill',billHeader,'80mm']
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
   const editor=page.locator('#receiptEditorForm');
   await editor.locator('[name=headerText]').fill(header);
   await editor.locator('[name=isDefault]').selectOption('Y');
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
  await kot('DiscountSettings/saveKotDiscount',{salesModeId,discountPercent:'20'});
  const productId='POS_QA_A_P18';
  const payload={sessionId,itemsJson:JSON.stringify([{productId,quantity:1}]),salesModeId,taxOn:'N',orderType:'Take Away',wantJson:'Y'};
  const quote=await (await kot('KotBilling/cartReceipt',payload)).json();
  check('KOT quote uses its own discount and customer bill design',
   quote.success&&Number(quote.receipt.summary.total)===80&&quote.receipt.store.headerText===billHeader,quote);
  const draft=await (await kot('KotBilling/saveDraft',payload)).json();
  check('KOT saves the discounted quote in a held order',draft.success&&!!draft.kotId,draft);
  await kot('DiscountSettings/saveKotDiscount',{salesModeId,discountPercent:'40'});
  const savedDiscount=q(`SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KOT_MODE_DISCOUNT_${salesModeId}'`)[0]?.setting_value;
  check('an unpaid KOT prevents changes to the saved mode discount',Number(savedDiscount)===20);
  const paid=await (await kot('KotBilling/checkoutKot',{sessionId,kotId:draft.kotId,paymentMethod:'Cash',cashAmount:'80'})).json();
  check('checkout settles the KOT discount once at its quoted total',paid.success&&!!paid.billNumber,paid);
  const bill=q(`SELECT p.transaction_id,p.payable_amount FROM kitchen_order_ticket k JOIN pos_transaction p USING (transaction_id) WHERE k.kot_id='${draft.kotId}'`)[0];
  check('the saved KOT bill has the discounted amount',Number(bill?.payable_amount)===80);
  const receipt=async(kind)=> (await (await kot('KotBilling/printRecord',{sessionId,kotId:draft.kotId,kind})).json()).record;
  const orderPrint=await receipt('kot'),billPrint=await receipt('bill');
  check('KOT Order and Bill Print use independent templates with no amounts on the ticket',
   orderPrint?.store?.headerText===ticketHeader&&orderPrint.store.receiptWidth==='58mm'&&!orderPrint.summary&&
   billPrint?.store?.headerText===billHeader&&Number(billPrint.summary.total)===80&&billPrint.bill.number===paid.billNumber);
  await page.goto(route('apps','KotBilling?sessionId='+sessionId));
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  await page.evaluate(()=>{
   window.qaPrintHtml=[];
   window.open=()=>({closed:false,document:{open(){},write(html){window.qaPrintHtml.push(html);},
    close(){},images:[],fonts:{ready:Promise.resolve()}},focus(){},print(){},close(){this.closed=true;}});
  });
  await page.locator('#kb-history-open').click();
  const historyRow=page.locator('#kb-history-rows [data-kot-id="'+draft.kotId+'"]');
  await historyRow.getByRole('button',{name:'KOT Print',exact:true}).click();
  await page.locator('#kb-history-print-status').getByText('Print request opened.').waitFor();
  await historyRow.getByRole('button',{name:'Bill Print',exact:true}).click();
  await page.waitForFunction(()=>window.qaPrintHtml.length===2);
  check('browser prints the configured kitchen ticket and customer bill',
   await page.evaluate(([orderText,billText])=>window.qaPrintHtml[0].includes(orderText)&&
    !window.qaPrintHtml[0].includes(billText)&&window.qaPrintHtml[1].includes(billText)&&
    !window.qaPrintHtml[1].includes(orderText),[ticketHeader,billHeader]));
  const pdf=await a.c.request.get(base+'/fop/apps/zenith/kot/ReceiptPdf?transactionId='+bill.transaction_id);
  const pdfBytes=await pdf.body();
  check('KOT customer bill PDF renders',pdf.ok()&&pdfBytes.subarray(0,4).toString()==='%PDF');
  if(out) writeFileSync(join(out,'kot-customized-receipt.pdf'),pdfBytes);

  const regular=await invoke('cart',{sessionId,reuseOpenCart:'false'});
  await invoke('add',{transactionId:regular.transactionId,productId,quantity:'1',salesModeId,taxOn:'N'});
  const posAmount=q(`SELECT payable_amount FROM pos_transaction WHERE transaction_id='${regular.transactionId}'`)[0]?.payable_amount;
  check('ordinary POS still uses its original discount',Number(posAmount)===95);
  await invoke('pay',{transactionId:regular.transactionId,paymentMethod:'Cash',amount:'95'});
  await invoke('complete',{transactionId:regular.transactionId});
  const normal=(await invoke('receipt',{transactionId:regular.transactionId})).receipt;
  check('ordinary POS prints its own receipt design',!!normal&&normal.store.headerText!==billHeader&&normal.store.headerText!==ticketHeader);

  const nav=await a.c.request.get(route('apps','Tables/goTransactions'),{maxRedirects:0});
  check('KOT Tables opens KOT Transactions without leaving the module',
   nav.status()===302&&new URL(nav.headers().location,base).pathname.endsWith('/zenith/kot/PosTransactions'));
 } finally {
  await page.close();
  if(sessionId) await invoke('close',{sessionId,closingCash:'0'});
 }
};
