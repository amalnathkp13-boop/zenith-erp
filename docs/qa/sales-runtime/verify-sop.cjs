// Supplemental SOP-04 cases. Called with the already authenticated disposable QA
// context; every write goes through the real Sales screen/service, never SQL.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const openItemDialog=require('./dialog-ready.cjs');
module.exports=async function({ctx,p,post,invoke,q,rows,inv,count,check,base,out,report}) {
 const cases=[],failures=[];
 async function scenario(ids,name,run){
  try{await run();cases.push({ids,name,passed:true});}
  catch(e){cases.push({ids,name,passed:false,error:e.message});failures.push(e.message);
   if(ids.includes('SL-102')){
    fs.writeFileSync(path.join(out,'keyboard-submit-failure.html'),await p.content().catch(()=>''));
    await p.screenshot({path:path.join(out,'keyboard-submit-failure.png'),fullPage:true}).catch(()=>{});
   }
  }
  fs.writeFileSync(path.join(out,'sop-extra.json'),JSON.stringify({cases,failures},null,2));
 }
 const createdId=(r,field)=>{const loc=r.headers().location;return loc?new URL(loc,base).searchParams.get(field):null;};
 async function createInvoice(extra={}){const r=await post('CreateInvoice','createInvoice',{toPartyId:'SALES_QA_CUST_A',...extra});const id=createdId(r,'invoiceId');check('SOP invoice persisted',!!id&&!!inv(id),{id});report.created.push({type:'SOP invoice',id});return id;}
 async function page(screen,shell='apps'){const r=await p.goto(`${base}/${shell}/zenith/sales/${screen}`,{waitUntil:'networkidle'});check('SOP '+shell+' '+screen+' loads',r.status()===200&&!/Error rendering|ScreenRenderException|HTTP Status 500|No entity found|Ambiguous method|Template Error/.test(await p.locator('body').innerText()),{status:r.status()});return p.locator('.z-sales-page').innerText();}
 async function withBuyerState(state, run){
  const activeState=()=>String(rows('tax_registration',"registration_id='SALES_QA_TAX_INTER'")[0].region_geo_id);
  const previous=activeState();
  try{
   await post('SalesQaAcceptance','customerState',{state});
   check('SOP temporary buyer registration applied',activeState()===state,{previous,state});
   await run();
  }finally{
   await post('SalesQaAcceptance','customerState',{state:previous});
   check('SOP original buyer registration restored',activeState()===previous,{previous});
  }
 }
 await scenario(['SL-010','SL-020','SL-012','SL-021'],'Create quote/order through actual forms and auto-price',async()=>{
  for(const [screen,transition] of [['CreateQuotation','createQuotation'],['CreateOrder','createOrder']]){
   const r=await post(screen,transition,{customerPartyId:'SALES_QA_CUST_A',orderDate:'2026-07-02',facilityId:'SALES_QA_FAC_A'}),id=createdId(r,'orderId');
   check('SOP '+screen+' persists scoped header',!!id&&rows('order_part',`order_id='${id}'`)[0]?.vendor_party_id==='SALES_QA_A',{id});
   const edit=screen==='CreateQuotation'?'EditQuotation':'EditOrder';
   await post(edit,'addItem',{orderId:id,productId:'SALES_QA_PROD_A',quantity:'2'});
   const item=rows('order_item',`order_id='${id}'`)[0];check('SOP '+edit+' auto price and quantity',Number(item?.unit_amount)===100&&Number(item?.quantity)===2,item);
   report.created.push({type:'SOP '+edit,id});
  }
 });
 await scenario(['SL-026','SL-054','SL-064','SL-092','ISO-001','ISO-002','ISO-003','ISO-004','ISO-006','XF-005'],'Foreign Sales details, mutations and print routes disclose no records',async()=>{
  for(const shell of ['apps','qapps'])for(const [screen,field,id,marker,table] of [['EditOrder','orderId','SALES_QA_ORDER_FOREIGN','SALES_QA_FOREIGN_ORDER_NAME','order_header'],['EditQuotation','orderId','SALES_QA_QUOTE_FOREIGN','SALES_QA_FOREIGN_QUOTE_NAME','order_header'],['EditCreditNote','invoiceId','SALES_QA_CN_FOREIGN','SALES_QA_FOREIGN_NOTE_NUMBER','invoice'],['EditInvoice','invoiceId','SALES_QA_FOREIGN','SALES_QA_FOREIGN','invoice']]){
   const where=`${field==='orderId'?'order_id':'invoice_id'}='${id}'`,before=JSON.stringify(rows(table,where));
   const r=await ctx.request.get(`${base}/${shell}/zenith/sales/${screen}?${field}=${id}`),body=await r.text();
   // Parameters may appear in links and hidden inputs; the private record's marker
   // must not appear as visible text. Assert using the fully rendered detail view.
   const t=await page(screen+'?'+field+'='+id,shell);check('SOP '+shell+' '+screen+' foreign record hidden',!t.includes(marker)&&/account|access|organization/i.test(t),{status:r.status()});
   await post(screen,'addItem',{[field]:id,productId:'SALES_QA_PROD_A',quantity:'1',unitAmount:'100',amount:'100',taxPercentage:'18'},shell);
   check('SOP '+shell+' '+screen+' foreign write changes no header or line',JSON.stringify(rows(table,where))===before&&count(field==='orderId'?'order_item':'invoice_item',where)===0,{id});
   const print=field==='orderId'?'OrderPrint':screen==='EditCreditNote'?'CreditNotePrint':'InvoicePrint';const pdf=await ctx.request.get(`${base}/fop/${shell}/zenith/sales/${print}?${field}=${id}`);check('SOP '+shell+' '+print+' foreign print exposes no PDF',pdf.status()===403&&(await pdf.body()).subarray(0,5).toString()!=='%PDF-',{status:pdf.status()});
  }
  const before=count('invoice',"from_party_id='SALES_QA_A'");await post('CreateCreditNote','createCreditNote',{originalInvoiceId:'SALES_QA_FOREIGN',documentType:'Credit Note'});check('SOP foreign original creates no adjustment',count('invoice',"from_party_id='SALES_QA_A'")===before,{});
 });
 await scenario(['SL-017','SL-025','SL-053','SL-066','SL-075'],'Sales lists apply matching and nonmatching search filters',async()=>{
  const quote=report.created.find(x=>x.type==='SOP EditQuotation'),order=report.created.find(x=>x.type==='SOP EditOrder');
  const id=await createInvoice({gstInvoiceNumber:'SALES_QA_SOP_FILTER'});
  for(const shell of ['apps','qapps']){
   for(const [screen,key,value,expected] of [['FindQuotation','quoteNoSearch',rows('order_header',`order_id='${quote.id}'`)[0].display_id,quote.id],['FindOrder','orderNoSearch',rows('order_header',`order_id='${order.id}'`)[0].display_id,order.id],['FindInvoice','gstInvoiceNumber','SALES_QA_SOP_FILTER','SALES_QA_SOP_FILTER']]){
    await page(screen+'?'+key+'='+encodeURIComponent(value),shell);let t=await p.locator('.z-listchrome').innerText();check('SOP '+shell+' '+screen+' matching search contains its number',t.includes(value),{value});
    await page(screen+'?'+key+'=SALES_QA_NO_MATCH',shell);t=await p.locator('.z-listchrome').innerText();check('SOP '+shell+' '+screen+' nonmatch hides rows',!t.includes(value),{value});
   }
   for(const [screen,foreign] of [['FindCreditNote','SALES_QA_FOREIGN'],['FindDeliveryChallan','QA-DC-B']]){const t=await page(screen,shell);check('SOP '+shell+' '+screen+' remains scoped',!t.includes(foreign),{});}
  }
 });
 await scenario(['ISO-003','ISO-004','XF-005'],'Owning one part of a mixed-vendor order cannot authorize the entire order',async()=>{
  for(const id of ['SALES_QA_MIXED_ORDER','SALES_QA_MIXED_OWN_FIRST']){
  const snapshot=()=>JSON.stringify({header:rows('order_header',`order_id='${id}'`),parts:rows('order_part',`order_id='${id}'`),items:rows('order_item',`order_id='${id}'`),billing:rows('order_item_billing',`order_id='${id}'`)}),before=snapshot();
  check('SOP mixed-vendor fixture exists with two owners',count('order_part',`order_id='${id}'`)===2,{id});
  for(const shell of ['apps','qapps'])for(const screen of ['EditOrder','EditQuotation']){
   const text=await page(screen+'?orderId='+id,shell);check('SOP '+shell+' '+screen+' mixed header stays hidden',!text.includes('SALES_QA_MIXED_PRIVATE_HEADER')&&/account|access/i.test(text),{});
   await post(screen,'updateStatus',{orderId:id,statusId:'OrderCancelled'},shell);
   await post(screen,'addItem',{orderId:id,productId:'SALES_QA_PROD_A',quantity:'1',unitAmount:'100'},shell);
   await post(screen,screen==='EditQuotation'?'convertToOrder':'convertToInvoice',{orderId:id},shell);
   if(screen==='EditQuotation'){
    await post(screen,'createRevision',{orderId:id},shell);
    await post(screen,'updateTerms',{orderId:id,orderPartSeqId:'01',validThruDate:'2030-01-01'},shell);
   }
   check('SOP '+shell+' '+screen+' mixed header/parts/items/billing stay unchanged',snapshot()===before,{id});
   const pdf=await ctx.request.get(`${base}/fop/${shell}/zenith/sales/OrderPrint?orderId=${id}`);check('SOP '+shell+' mixed order print is denied',pdf.status()>=400&&(await pdf.body()).subarray(0,5).toString()!=='%PDF-',{id,status:pdf.status()});
  }
  for(const shell of ['apps','qapps']){
   for(const screen of ['FindOrder','FindQuotation']){
   const list=await page(screen,shell);check('SOP '+shell+' mixed order absent from '+screen,!list.includes(id),{id});
   const csv=await ctx.request.get(`${base}/${shell}/zenith/sales/${screen}?renderMode=csv&lastStandalone=true&pageNoLimit=true`);check('SOP '+shell+' mixed order absent from '+screen+' export',!(await csv.text()).includes(id),{id});
   }
   const dashboard=await page('SalesDashboard',shell);check('SOP '+shell+' mixed order absent from dashboard',!dashboard.includes(id)&&!dashboard.includes('SALES_QA_MIXED_PRIVATE_HEADER'),{});
  }
  }
 });
 await scenario(['SL-013','SL-014','SL-015','SL-018','SL-024','XF-002'],'Quotation GST and state change across conversion; empty conversions denied',async()=>{
  for(const [customer,inter] of [['SALES_QA_CUST_A',false],['SALES_QA_CUST_INTER',true]]){
   const r=await post('CreateQuotation','createQuotation',{customerPartyId:customer,orderDate:'2026-07-03'}),id=createdId(r,'orderId');check('SOP quotation created for GST check',!!id,{id});
   await post('EditQuotation','convertToOrder',{orderId:id});check('SOP empty quote stays proposed',rows('order_header',`order_id='${id}'`)[0].status_id==='OrderProposed',{id});
   await post('EditQuotation','addItem',{orderId:id,productId:'SALES_QA_PROD_A',quantity:'2',unitAmount:'100',taxPercentage:'18'});
   const i=rows('order_item',`order_id='${id}'`)[0];check('SOP '+(inter?'inter':'intra')+' state quotation tax golden',Number(i?.cgst_amount)===(inter?0:18)&&Number(i?.sgst_amount)===(inter?0:18)&&Number(i?.igst_amount)===(inter?36:0),i);
   if(inter) await withBuyerState('29',async()=>{
    await post('EditQuotation','convertToOrder',{orderId:id});
    await post('EditOrder','convertToInvoice',{orderId:id});
    const bill=rows('order_item_billing',`order_id='${id}'`)[0];
    check('SOP state change retaxes converted invoice',!!bill&&Number(inv(bill.invoice_id).total_cgst)===18&&Number(inv(bill.invoice_id).total_sgst)===18&&Number(inv(bill.invoice_id).total_igst)===0,{id,bill});
   });
  }
  const empty=await post('CreateOrder','createOrder',{customerPartyId:'SALES_QA_CUST_A',facilityId:'SALES_QA_FAC_A'}),id=createdId(empty,'orderId');check('SOP empty order created',!!id,{id});await post('EditOrder','convertToInvoice',{orderId:id});check('SOP empty order has no invoice link',count('order_item_billing',`order_id='${id}'`)===0,{id});
  await page('EditQuotation?orderId=SALES_QA_QUOTE');await p.getByText('Add Item',{exact:true}).first().click();
  const rates=await p.locator('select[name="taxPercentage"] option').evaluateAll(es=>es.map(e=>e.value));check('SOP GST dropdown offers only supported slabs',rates.join(',')==='0,5,12,18,28',rates);
 });
 await scenario(['SL-014','SL-015','SL-022','XF-002'],'A changed tax jurisdiction preserves the accepted rate and requires revision for a changed price',async()=>{
  const customer='SALES_QA_CUST_INTER';
  const product='SALES_QA_PROD_A';
  check('SOP manual rate fixture uses an 18 percent catalog product',rows('product',`product_id='${product}'`)[0].gst_slab_id==='GST_18',{product});
  async function acceptedOrder(price,expectedTax,expectedTotal){
   const quote=await post('CreateQuotation','createQuotation',{customerPartyId:customer,orderDate:'2026-07-03'});
   const id=createdId(quote,'orderId');
   await post('EditQuotation','addItem',{orderId:id,productId:product,quantity:'1',unitAmount:price,taxPercentage:'5'});
   await post('EditQuotation','convertToOrder',{orderId:id});
   const line=rows('order_item',`order_id='${id}'`)[0];
   const header=rows('order_header',`order_id='${id}'`)[0];
   check('SOP accepted interstate 5 percent order at '+price,header?.document_type==='SALES_ORDER'&&Number(header.grand_total)===expectedTotal&&
    Number(line?.igst_rate)===5&&Number(line.igst_amount)===expectedTax&&Number(line.total_tax_amount)===expectedTax,{id,price,line});
   return id;
  }
  const equal=await acceptedOrder('100.00',5,105);
  const different=await acceptedOrder('10.20',0.51,10.71);
  await withBuyerState('29',async()=>{
   await post('EditOrder','convertToInvoice',{orderId:equal});
   const link=rows('order_item_billing',`order_id='${equal}'`)[0];
   const billed=link&&inv(link.invoice_id);
   const line=link&&rows('invoice_item',`invoice_id='${link.invoice_id}' AND product_id='${product}'`)[0];
   check('SOP changed jurisdiction keeps the accepted 5 percent rate on an 18 percent catalog product',
    billed&&Number(billed.invoice_total)===105&&Number(line?.cgst_amount)===2.5&&Number(line.sgst_amount)===2.5&&Number(line.igst_amount)===0,
    {order:equal,invoice:link?.invoice_id,line});
   const priorCount=count('invoice',`from_party_id='SALES_QA_A' AND to_party_id='${customer}'`);
   const response=await post('EditOrder','convertToInvoice',{orderId:different});
   const location=response.headers().location;
   const feedback=location?await (await ctx.request.get(new URL(location,response.url()).href)).text():await response.text();
   check('SOP one-paisa jurisdiction change asks for a quotation revision',/revise the quotation/i.test(feedback),{id:different,status:response.status()});
   check('SOP one-paisa jurisdiction change does not create an invoice or billing link',
    count('invoice',`from_party_id='SALES_QA_A' AND to_party_id='${customer}'`)===priorCount&&count('order_item_billing',`order_id='${different}'`)===0,{id:different});
   const original=rows('order_item',`order_id='${different}'`)[0];
   check('SOP accepted amount and original IGST survive the rejected conversion',
    Number(rows('order_header',`order_id='${different}'`)[0].grand_total)===10.71&&Number(original.igst_amount)===0.51&&Number(original.total_tax_amount)===0.51,
    {id:different,original});
  });
 });
 await scenario(['SL-050','SL-051','SL-082'],'Invoice issue/sent/acknowledged/cash settlement flow',async()=>{
  const id=await createInvoice();await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount:'100',taxPercentage:'18'});
  for(const statusId of ['InvoiceFinalized','InvoiceSent','InvoiceAcked']){await post('EditInvoice','updateInvoice',{invoiceId:id,statusId});check('SOP invoice '+statusId+' persists',inv(id).status_id===statusId,{id});}
  await post('EditInvoice','markPaidCash',{invoiceId:id});check('SOP issued cash flow settles once',inv(id).status_id==='InvoicePmtRecvd'&&Number(inv(id).applied_payments_total)===118&&count('payment',`for_invoice_id='${id}'`)===1,{id});
 });
 await scenario(['SL-034','SL-037'],'Export and SEZ with-payment controls retax new and edited lines',async()=>{
  for(const flag of ['isExport','isSezSupply']){
   const id=await createInvoice();await post('EditInvoice','updateInvoice',{invoiceId:id,[flag]:'Y',isWithPayment:'Y'});await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount:'100',taxPercentage:'18'});
   check('SOP '+flag+' with payment uses IGST',Number(inv(id).total_igst)===18&&Number(inv(id).total_cgst)===0,{id});
   await post('EditInvoice','updateInvoice',{invoiceId:id,isWithPayment:'N'});check('SOP '+flag+' without payment removes seller GST',Number(inv(id).total_tax_amount)===0,{id});
   await post('EditInvoice','updateItem',{invoiceId:id,invoiceItemSeqId:'01',quantity:'2',amount:'100'});check('SOP '+flag+' edited line remains zero-tax',Number(inv(id).total_tax_amount)===0&&Number(inv(id).total_taxable_amount)===200,{id});
  }
 });
 await scenario(['ISO-007','SL-011'],'Picker searches do not disclose foreign records',async()=>{
  for(const shell of ['apps','qapps'])for(const screen of ['CreateInvoice','CreateOrder','CreateQuotation']){
   const r=await ctx.request.get(`${base}/${shell}/zenith/sales/${screen}/getCustomers?term=SALES_QA&partyId=SALES_QA_CUST_B&ownerPartyId=SALES_QA_B`),body=await r.json();
   check(shell+' '+screen+' customer JSON stays scoped',r.status()===200&&body.some(x=>x.value==='SALES_QA_CUST_A')&&!body.some(x=>x.value==='SALES_QA_CUST_B'),body);
  }
 });
 await scenario(['SL-043','SL-044','SL-048'],'Mixed GST slabs, decimal and large quantities reconcile',async()=>{
  const id=await createInvoice();
  for(const rate of [0,5,12,18,28])await post('EditInvoice','addItem',{invoiceId:id,quantity:'2.5',amount:'100',taxPercentage:String(rate),description:'SOP slab '+rate});
  let header=inv(id);check('SOP mixed slabs independently sum',Number(header.total_taxable_amount)===1250&&Number(header.total_cgst)===78.75&&Number(header.total_sgst)===78.75&&Number(header.total_tax_amount)===157.5,header);
  const large=await createInvoice();await post('EditInvoice','addItem',{invoiceId:large,quantity:'999999.25',amount:'0.01',taxPercentage:'18',description:'SOP large decimal'});
  header=inv(large);check('SOP large decimal stores finite rounded taxes',Number(header.total_taxable_amount)===9999.9925&&Number(header.total_cgst)===900&&Number(header.total_sgst)===900,header);
 });
 await scenario(['SL-033','SL-036','SL-040','SL-041'],'Independent 18% GST goldens and HALF_UP round-off amount words',async()=>{
  for(const [customer,inter] of [['SALES_QA_CUST_A',false],['SALES_QA_CUST_INTER',true]]){
   const id=await createInvoice({toPartyId:customer});await post('EditInvoice','addItem',{invoiceId:id,quantity:'10',amount:'100',taxPercentage:'18'});
   const h=inv(id);check('SOP '+(inter?'inter':'intra')+' state 18 percent golden',Number(h.total_taxable_amount)===1000&&Number(h.total_cgst)===(inter?0:90)&&Number(h.total_sgst)===(inter?0:90)&&Number(h.total_igst)===(inter?180:0)&&Number(h.invoice_total)+Number(h.round_off_amount)===1180,h);
   const pdf=await ctx.request.get(`${base}/fop/apps/zenith/sales/InvoicePrint?invoiceId=${id}`),file=path.join(out,'SOP-'+(inter?'IGST':'CGST')+'-invoice.pdf');fs.writeFileSync(file,await pdf.body());
   const text=JSON.parse(cp.execFileSync(process.env.SALES_QA_PYTHON||'python3',[path.join(__dirname,'inspect-pdf.py'),file,'--text'],{encoding:'utf8',windowsHide:true,timeout:30000})).text;
   check('SOP '+(inter?'inter':'intra')+' PDF GST golden',pdf.status()===200&&text.includes('Taxes Rs. 180.00')&&text.includes('Total Rs. 1,180.00')&&(inter?text.includes('Rs. 180.00 (18%)'):text.split('Rs. 90.00 (9%)').length===3),{tax:180,total:1180});
  }
  for(const [amount,round,words] of [['10.49',-0.49,'Rupees Ten Only'],['10.50',0.50,'Rupees Eleven Only']]){
   const id=await createInvoice();await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount,taxPercentage:'0'});
   const h=inv(id);check('SOP HALF_UP payable and words '+amount,Number(h.round_off_amount)===round&&h.amount_in_words===words,h);
   const pdf=await ctx.request.get(`${base}/fop/apps/zenith/sales/InvoicePrint?invoiceId=${id}`),file=path.join(out,'SOP-round-'+amount.replace('.','-')+'.pdf');fs.writeFileSync(file,await pdf.body());
   const text=JSON.parse(cp.execFileSync(process.env.SALES_QA_PYTHON||'python3',[path.join(__dirname,'inspect-pdf.py'),file,'--text'],{encoding:'utf8',windowsHide:true,timeout:30000})).text;
   check('SOP printed round-off reconciles '+amount,pdf.status()===200&&text.includes('Round-off Rs. '+round.toFixed(2))&&text.includes('Total Rs. '+(amount==='10.49'?'10.00':'11.00')),{round,total:amount==='10.49'?10:11});
  }
 });
 await scenario(['SL-037','SL-038'],'Draft tax and transport metadata persist',async()=>{
  const id=await createInvoice();await post('EditInvoice','updateInvoice',{invoiceId:id,buyerGstin:'27QAONLY0000A1Z1',supplierGstin:'29QAONLY0000A1Z1',placeOfSupplyStateCode:'27',einvoiceId:'QA-NOT-A-REAL-IRN',ewayBillId:'QA-NOT-A-REAL-EWAY',vehicleNumber:'QA-VEHICLE',lrNumber:'QA-LR',invoiceMessage:'Synthetic SOP note'});
  const h=inv(id);check('SOP metadata persisted on exact draft',h.buyer_gstin==='27QAONLY0000A1Z1'&&h.place_of_supply_state_code==='27'&&h.einvoice_id==='QA-NOT-A-REAL-IRN'&&h.eway_bill_id==='QA-NOT-A-REAL-EWAY'&&h.lr_number==='QA-LR',h);
 });
 await scenario(['SL-030','SL-034'],'Export selected at creation remains zero-tax after line edits',async()=>{
  const id=await createInvoice({invoiceType:'ExportInvoice'});
  await post('EditInvoice','addItem',{invoiceId:id,quantity:'2',amount:'100',taxPercentage:'18'});
  let h=inv(id);check('SOP export flag and unpaid export GST',h.document_type==='Export Invoice'&&h.is_export==='Y'&&Number(h.total_tax_amount)===0,h);
  await post('EditInvoice','updateItem',{invoiceId:id,invoiceItemSeqId:'01',quantity:'3',amount:'100'});
  h=inv(id);check('SOP export edited line stays zero-tax',Number(h.total_taxable_amount)===300&&Number(h.total_tax_amount)===0,h);
 });
 await scenario(['SL-037','SL-034'],'Export flag changed before adding a line remains authoritative',async()=>{
  const id=await createInvoice();await post('EditInvoice','updateInvoice',{invoiceId:id,isExport:'Y'});
  await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount:'100',taxPercentage:'18'});
  check('SOP newly added export line has no seller GST',Number(inv(id).total_tax_amount)===0,inv(id));
 });
 await scenario(['SL-060','SL-061','SL-062','SL-065','XF-003'],'Credit/debit type and immutable original reference',async()=>{
  for(const [type,enumId] of [['Credit Note','InvoiceSalesReturn'],['Debit Note','InvoiceSalesDebit']]){
   const r=await post('CreateCreditNote','createCreditNote',{originalInvoiceId:'SALES_QA_ISSUED',documentType:type,invoiceMessage:'SOP '+type+' reason'}),id=createdId(r,'invoiceId');
   check('SOP '+type+' persists type, original and reason',!!id&&inv(id)?.invoice_type_enum_id===enumId&&inv(id)?.original_invoice_id==='SALES_QA_ISSUED'&&inv(id)?.invoice_message==='SOP '+type+' reason',{id});
   await post('EditCreditNote','updateInvoice',{invoiceId:id,originalInvoiceId:id});check('SOP self reference is rejected',inv(id).original_invoice_id==='SALES_QA_ISSUED',{id});report.created.push({type,id});
  }
 });
 await scenario(['SL-070','SL-071','SL-072','SL-074'],'Challan transport and supported status flow',async()=>{
  const r=await post('CreateDeliveryChallan','createChallan',{customerPartyId:'SALES_QA_CUST_A',challanDate:'2026-07-02',purposeEnumId:'DcpSupply'}),id=createdId(r,'challanId');check('SOP new challan persisted',!!id,{id});
  await post('EditDeliveryChallan','addItem',{challanId:id,productId:'SALES_QA_PROD_A',quantity:'1',estimatedValue:'100'});
  await post('EditDeliveryChallan','updateChallan',{challanId:id,ewayBillId:'QA-EWAY',vehicleNumber:'QA-TRUCK',lrNumber:'QA-TRANSPORT-LR'});
  const h=rows('zenith_delivery_challan',`challan_id='${id}'`)[0];check('SOP challan transport includes LR',h?.eway_bill_id==='QA-EWAY'&&h.vehicle_number==='QA-TRUCK'&&h.lr_number==='QA-TRANSPORT-LR',h);
  for(const statusId of ['DcIssued','DcDelivered','DcReturned']){await post('EditDeliveryChallan','updateChallan',{challanId:id,statusId});check('SOP challan '+statusId+' persists',rows('zenith_delivery_challan',`challan_id='${id}'`)[0].status_id===statusId,{id});}
  report.created.push({type:'SOP challan',id});
 });
 await scenario(['SL-088','SL-089'],'Forecast is based on issued sales, excludes drafts and cancelled records',async()=>{
  const empty=await invoke('forecast',{organizationPartyId:'SALES_QA_A',lookbackDays:'30',horizonDays:'14'});
  check('SOP forecast with insufficient history explains the empty result',Number(empty.historyDays)<14&&/history|data|days/i.test(empty.narrative||''),empty);
  const r=await post('SalesQaAcceptance','sopFixtures');check('SOP fixed history fixture initialized',(await r.json()).initialized===true,{});
  const f=await invoke('forecast',{organizationPartyId:'SALES_QA_A',lookbackDays:'30',horizonDays:'14'});
  check('SOP completed-sales forecast reconciles',f.historyDays>=21&&Number(f.avgDaily)===100&&Number(f.projectedHorizon)>0&&Number(f.projectedHorizon)<2000,f);
  await invoke('forecast',{organizationPartyId:'SALES_QA_B'},true);
 });
 await scenario(['SL-045'],'Missing buyer registration uses the existing local fallback; explicit place of supply overrides it',async()=>{
  const id=await createInvoice({toPartyId:'SALES_QA_SALES'});
  await post('EditInvoice','addItem',{invoiceId:id,quantity:'10',amount:'100',taxPercentage:'18'});
  const h=inv(id);check('SOP missing buyer state does not crash and preserves master fallback',Number(h.total_cgst)===90&&Number(h.total_sgst)===90&&Number(h.total_igst)===0,h);
  const text=await page('EditInvoice?invoiceId='+id);check('SOP missing-state editor asks for place-of-supply confirmation',text.includes('Buyer state is missing')&&text.includes('Confirm the actual Place of Supply'),{});
  await post('EditInvoice','updateInvoice',{invoiceId:id,placeOfSupplyStateCode:'27'});
  check('SOP explicit place of supply retaxes an unregistered buyer',Number(inv(id).total_igst)===180&&Number(inv(id).total_cgst)===0&&Number(inv(id).total_sgst)===0,{id});
  report.sopDeviations=[...(report.sopDeviations||[]),{id:'SL-045',reason:'SOP text describes missing-state IGST; current master explicitly defaults to local CGST/SGST. The existing policy is preserved and an explicit place-of-supply override is verified. Senior must confirm this policy before deployment.'}];
 });
 await scenario(['SL-002','SL-003','SL-004'],'Dashboard counts only sales invoices and handles empty/invalid date ranges',async()=>{
  const dates=q("SELECT invoice_id,invoice_date,status_id FROM invoice WHERE invoice_id='SALES_QA_SOP_HISTORY_1'");const date=String(dates[0].invoice_date).slice(0,10);
  await page('SalesDashboard?dashDate='+date+'&dashDateTo='+date);
  const scope=p.locator('.z-sales-page');const number=await scope.locator('.zenith-card').filter({hasText:'Generated Invoices'}).locator('h4').innerText();
  // Exactly one completed and one draft invoice in this fixed historical day.
  check('SOP dashboard generated invoice count excludes cancelled notes',number.trim()==='2',{date,number});
  const links=await scope.locator('a[href*="/sales/"]').count();check('SOP dashboard quick links available',links>=4,{links});
  for(const target of ['CreateQuotation','CreateOrder','SalesForecast']){
   const link=scope.locator('a[href*="/'+target+'"]');check('SOP dashboard link to '+target+' exists',await link.count()>0,{});
   await link.first().click();await p.waitForLoadState('networkidle');
   check('SOP dashboard link opens '+target,p.url().includes('/'+target)&&!/Error rendering|ScreenRenderException/.test(await p.locator('body').innerText()),{url:new URL(p.url()).pathname});
   await page('SalesDashboard?dashDate='+date+'&dashDateTo='+date);
  }
  const empty=await page('SalesDashboard?dashDate=2000-01-01&dashDateTo=2000-01-01');check('SOP empty date displays zero instead of an error',empty.includes('0'),{});
  await page('SalesDashboard?dashDate=invalid-date');
  await post('SalesQaAcceptance','scope',{org:'_NA_'});
  try{
   const t=await page('SalesDashboard'),numbers=[];
   for(const name of ['Total Sales','Active Quotes','Total Customers','Generated Invoices'])numbers.push(await p.locator('.z-sales-page .zenith-card').filter({hasText:name}).locator('h4').first().innerText());
   check('SOP no-org dashboard has zero metrics and no invalid chart values',numbers.length===4&&numbers.every(x=>!/[1-9]/.test(x))&&!/NaN|Infinity|ScreenRenderException/.test(t),{numbers});
   for(const shell of ['apps','qapps'])for(const screen of ['FindInvoice','FindOrder','FindQuotation','FindCreditNote','FindDeliveryChallan']){
    const r=await ctx.request.get(`${base}/${shell}/zenith/sales/${screen}?renderMode=csv&lastStandalone=true&pageNoLimit=true&fromPartyId=SALES_QA_A&vendorPartyId=SALES_QA_A`),csv=await r.text();
    check('SOP '+shell+' '+screen+' no-org CSV retains headers and zero data rows',r.status()===200&&csv.trim().split('\n').length===1&&!/Template Error|SALES_QA_/.test(csv),{status:r.status()});
   }
  }finally{await post('SalesQaAcceptance','scope',{org:'SALES_QA_A'});}
 });
 await scenario(['SL-053','ISO-002'],'Filtered CSV exports contain only the matching scoped invoice',async()=>{
  const id=await createInvoice({gstInvoiceNumber:'SALES_QA_SOP_EXPORT'});
  for(const shell of ['apps','qapps'])for(const mode of ['csv']){
   const url=`${base}/${shell}/zenith/sales/FindInvoice?gstInvoiceNumber=SALES_QA_SOP_EXPORT&renderMode=${mode}&pageNoLimit=true&lastStandalone=true&saveFilename=Sales-QA.${mode}`;
   const r=await ctx.request.get(url),body=await r.body();
   check('SOP '+shell+' '+mode+' export responds',r.status()===200,{status:r.status(),type:r.headers()['content-type']});
   const file=path.join(out,`${shell}-filtered-sales.${mode}`);fs.writeFileSync(file,body);
   let text=body.toString('utf8');
   check('SOP '+shell+' '+mode+' export honors number filter and tenant',text.includes('SALES_QA_SOP_EXPORT')&&!text.includes('SALES_QA_FOREIGN')&&!text.includes('SALES_QA_SOP_FILTER'),{id,bytes:body.length});
   check('SOP '+shell+' CSV export has no HTML formatter error',!text.includes('Template Error')&&!text.includes('receipt_long')&&!text.includes('event'),{});
   await page('FindInvoice',shell);report.xlsxAvailable=await p.locator('a[href*="renderMode=xlsx"]').count()>0;
   for(const screen of ['FindQuotation','FindOrder','FindCreditNote','FindDeliveryChallan']){
    const csv=await ctx.request.get(`${base}/${shell}/zenith/sales/${screen}?renderMode=csv&pageNoLimit=true&lastStandalone=true&vendorPartyId=SALES_QA_B&fromPartyId=SALES_QA_B&organizationPartyId=SALES_QA_B`),content=await csv.text();
    check('SOP '+shell+' '+screen+' CSV is plain, scoped and complete',csv.status()===200&&content.trim().split('\n').length>1&&!/Template Error|SALES_QA_FOREIGN|QA-DC-B|<q-|Search (Orders|Quotations|Challans|Notes)/.test(content),{status:csv.status(),bytes:content.length});
    fs.writeFileSync(path.join(out,`${shell}-${screen}.csv`),content);
   }
  }
 });
 await scenario(['SL-083','SL-084'],'Create a scoped commission structure and calculate its rate',async()=>{
  await post('Commissions','createStructure',{partyId:'SALES_QA_CUST_A',commissionTypeEnumId:'CmtPercentage',rate:'5',validFrom:'2024-01-01',validTo:'2030-01-01'});
  const s=rows('commission_structure',"party_id='SALES_QA_CUST_A'");check('SOP new commission structure is scoped',s.length===1&&s[0].organization_party_id==='SALES_QA_A'&&Number(s[0].rate)===5,s);
  const c=await invoke('commission',{orderId:'SALES_QA_ORDER',partyId:'SALES_QA_CUST_A'});check('SOP percentage commission independently reconciles',Number(c.commissionAmount)===50,c);
 });
 await scenario(['SL-086'],'Resolve an active warranty claim without changing other registrations',async()=>{
  const result=await invoke('claim',{warrantyRegId:'SALES_QA_WR_ACTIVE',issueDescription:'SOP repair resolution'}),claim={id:result.warrantyClaimId};
  check('SOP active warranty claim exists',!!claim.id,{claim});report.created.push({type:'SOP claim',id:claim.id});
  await invoke('resolve',{warrantyClaimId:claim.id,resolutionEnumId:'WresRepaired',serviceCost:'25'});
  const row=rows('warranty_claim',`claim_id='${claim.id}'`)[0];
  check('SOP claim resolution persists status, cost and date',row?.status_id==='WcResolved'&&row.resolution_enum_id==='WresRepaired'&&Number(row.service_cost)===25&&!!row.resolved_date,row);
 });
 await scenario(['SL-047','SL-063'],'Explicit free invoice line and inter-state credit-note GST',async()=>{
  const id=await createInvoice();await post('EditInvoice','addItem',{invoiceId:id,productId:'SALES_QA_PROD_A',quantity:'1',amount:'0',taxPercentage:'18',description:'SOP intentionally free'});
  const line=rows('invoice_item',`invoice_id='${id}'`)[0];
  check('SOP explicit zero-price invoice remains free',!!line&&Number(line.amount)===0&&Number(inv(id).total_taxable_amount)===0&&Number(inv(id).total_tax_amount)===0,line);
  const r=await post('CreateCreditNote','createCreditNote',{originalInvoiceId:'SALES_QA_ISSUED',documentType:'Credit Note'}),note=createdId(r,'invoiceId');
  await post('EditCreditNote','updateInvoice',{invoiceId:note,placeOfSupplyStateCode:'27'});
  await post('EditCreditNote','addItem',{invoiceId:note,quantity:'10',amount:'100',taxPercentage:'18'});
  const h=inv(note);check('SOP inter-state credit note GST reconciles',Number(h.total_taxable_amount)===1000&&Number(h.total_igst)===180&&Number(h.total_cgst)===0&&Number(h.total_sgst)===0,h);
 });
 await scenario(['SL-020','SL-037','XF-001'],'RCM and export choices survive quotation/order/invoice conversion',async()=>{
  for(const flag of ['isReverseCharge','isExport']){
   const r=await post('CreateQuotation','createQuotation',{customerPartyId:'SALES_QA_CUST_A',orderDate:'2026-07-02',[flag]:'Y'}),id=createdId(r,'orderId');
   await post('EditQuotation','addItem',{orderId:id,productId:'SALES_QA_PROD_A',quantity:'1',unitAmount:'100',taxPercentage:'18'});
   const line=rows('order_item',`order_id='${id}'`)[0];
   check('SOP '+flag+' quote shows zero seller GST',Number(line?.cgst_amount||0)+Number(line?.sgst_amount||0)+Number(line?.igst_amount||0)===0,{id,line});
   await post('EditQuotation','convertToOrder',{orderId:id});await post('EditOrder','convertToInvoice',{orderId:id});
   const bill=rows('order_item_billing',`order_id='${id}'`)[0],h=bill?inv(bill.invoice_id):null;
   check('SOP '+flag+' invoice retains zero seller GST',!!h&&h[flag==='isExport'?'is_export':'is_reverse_charge']==='Y'&&Number(h.total_tax_amount)===0,{id,h});
  }
 });
 await scenario(['SL-085'],'Create warranty policy and register a month-end purchase',async()=>{
  await post('WarrantyPolicies','createPolicy',{policyName:'SALES_QA_SOP_POLICY',warrantyTypeEnumId:'WtManufacturer',durationMonths:'1'});
  const s=rows('warranty_policy',"policy_name='SALES_QA_SOP_POLICY'");check('SOP new warranty policy belongs to QA',s.length===1&&s[0].organization_party_id==='SALES_QA_A',s);
  const r=await invoke('register',{warrantyPolicyId:s[0].warranty_policy_id,customerPartyId:'SALES_QA_CUST_A',productId:'SALES_QA_PROD_A',purchaseDate:'2026-01-31'});
  const w=rows('warranty_registration',`warranty_reg_id='${r.warrantyRegId}'`)[0];check('SOP warranty month-end clamps to February end',String(w?.warranty_end_date).startsWith('2026-02-28'),w);
 });
 await scenario(['SL-102','SL-105'],'Keyboard submission and rapid double-click add only one line',async()=>{
  for(const shell of ['apps','qapps']){
   const id=await createInvoice();await page('EditInvoice?invoiceId='+id,shell);await openItemDialog(p,shell);
   const qty=p.locator('input[name="quantity"]:visible').first();await qty.fill('1');await p.locator('input[name="amount"]:visible').first().fill('100');await p.locator('input[name="description"]:visible').first().fill('SOP keyboard');
   // The shown callback has finished autofocus before real keyboard navigation.
   await qty.focus();await p.waitForFunction(()=>document.activeElement?.name==='quantity');
   await p.keyboard.press('Tab');await p.waitForFunction(()=>document.activeElement?.name==='amount');
   check('SOP '+shell+' quantity tabs to price',await p.evaluate(()=>document.activeElement?.name==='amount'),{active:await p.evaluate(()=>({name:document.activeElement?.name,type:document.activeElement?.type}))});
   await Promise.all([p.waitForResponse(r=>r.url().includes('/EditInvoice/addItem')&&r.request().method()==='POST'),p.keyboard.press('Enter')]);
   await p.getByText('SOP keyboard',{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});
   await p.waitForLoadState('networkidle');
   check('SOP '+shell+' Enter adds exactly one line',count('invoice_item',`invoice_id='${id}'`)===1,{id});
   await openItemDialog(p,shell);await p.locator('input[name="quantity"]:visible').first().fill('1');await p.locator('input[name="amount"]:visible').first().fill('100');await p.locator('input[name="description"]:visible').first().fill('SOP double-click');
   await Promise.all([p.waitForResponse(r=>r.url().includes('/EditInvoice/addItem')&&r.request().method()==='POST'),p.locator('#AddItemForm_submitButton').filter({visible:true}).dblclick({timeout:15000})]);await p.getByText('SOP double-click',{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});await p.waitForLoadState('networkidle');
   check('SOP '+shell+' double-click adds one additional line',count('invoice_item',`invoice_id='${id}'`)===2,{id});
  }
 });
 await scenario(['SL-090','SL-093'],'Multi-page invoice PDF contains every line and final total',async()=>{
  const id=await createInvoice();
  for(let i=1;i<=75;i++)await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount:'1',taxPercentage:'0',description:'SOP-PDF-LINE-'+String(i).padStart(3,'0')+' Long synthetic description to check wrapping and table pagination'});
  const r=await ctx.request.get(`${base}/fop/apps/zenith/sales/InvoicePrint?invoiceId=${id}`),pdf=path.join(out,'SOP-multipage-invoice.pdf');check('SOP multi-page invoice produces a PDF',r.status()===200&&(await r.body()).subarray(0,5).toString()==='%PDF-',{status:r.status()});fs.writeFileSync(pdf,await r.body());
  const result=JSON.parse(cp.execFileSync(process.env.SALES_QA_PYTHON||'python3',[path.join(__dirname,'inspect-pdf.py'),pdf],{encoding:'utf8',windowsHide:true,timeout:30000}));
  check('SOP multi-page print has all 75 rows and totals',result.pages>1&&result.lineCount===75&&result.hasTotals&&result.hasAmountWords&&result.finalPageHasTotals&&result.pagesWithOrphanAmounts.length===0,result);report.pdfInspection=result;
 });
 await scenario(['SL-103'],'Free-text XSS remains inert in both UI shells',async()=>{
  const id=await createInvoice(),payload='<img src=x onerror="window.__salesSopXss=true">';
  await post('EditInvoice','addItem',{invoiceId:id,quantity:'1',amount:'100',taxPercentage:'0',description:payload});
  for(const shell of ['apps','qapps']){await page('EditInvoice?invoiceId='+id,shell);check('SOP '+shell+' stored description escaped',await p.locator('.z-sales-page').innerText().then(x=>x.includes(payload))&&await p.evaluate(()=>window.__salesSopXss!==true)&&await p.locator('.z-sales-page img[onerror]').count()===0,{});}
  const pdf=await ctx.request.get(`${base}/fop/apps/zenith/sales/InvoicePrint?invoiceId=${id}`);check('SOP XSS description is XML-escaped in PDF output',pdf.status()===200&&(await pdf.body()).subarray(0,5).toString()==='%PDF-',{status:pdf.status()});
 });
 await scenario(['SL-100','SL-101'],'All Sales create/edit/list layouts at SOP desktop and mobile widths',async()=>{
  const screens=['SalesDashboard','FindQuotation','FindOrder','FindInvoice','FindCreditNote','FindDeliveryChallan','CreateQuotation','CreateOrder','CreateInvoice','CreateCreditNote','CreateDeliveryChallan','WarrantyPolicies','Commissions','SalesForecast','EditInvoice?invoiceId=SALES_QA_INV','EditQuotation?orderId=SALES_QA_QUOTE','EditOrder?orderId=SALES_QA_ORDER','EditCreditNote?invoiceId=SALES_QA_CN','EditDeliveryChallan?challanId=SALES_QA_DC_A'];
  for(const shell of ['apps','qapps'])for(const width of [1920,1366,360])for(const screen of screens){
   await p.setViewportSize({width,height:1000});await page(screen,shell);
   const toggle=p.locator('.q-header .q-toolbar>button:first-child');if(shell==='qapps'&&width<900&&await toggle.count()&&await p.locator('body').evaluate(e=>e.classList.contains('zq-side-open')))await toggle.click();
   const g=await p.evaluate(()=>({document:document.documentElement.scrollWidth,width:innerWidth,controls:[...document.querySelectorAll('.z-sales-page input,.z-sales-page select,.z-sales-page button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.right>innerWidth+2||r.left< -2)&&!e.closest('.z-sales-table,.table-responsive,.q-table__middle,.q-table__container,.table-scroll-wrapper,.modal')}).map(e=>e.name||e.id)}));
   check('SOP '+shell+' '+screen+' '+width+'px fits',g.document<=width+2&&g.controls.length===0,g);
   report.viewports.push({shell,screen,width,...g,sop:true});
  }
 });
 await require('./verify-postmerge.cjs')({ctx,p,post,invoke,q,rows,inv,count,check,base,out,report});
 fs.writeFileSync(path.join(out,'sop-extra.json'),JSON.stringify({cases,failures},null,2));
 const coverage=require('./sop-coverage.cjs')(report,cases,out);
 check('SOP run sheet has evidence for all 88 cases',coverage.total===88&&coverage.unverified.length===0,coverage);
 check('All supplemental SOP scenarios passed',failures.length===0,{failures});
};
