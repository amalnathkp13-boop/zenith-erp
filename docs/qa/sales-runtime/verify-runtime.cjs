// Run only on a freshly seeded disposable runtime. All credentials below are public demo values.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {chromium}=require('playwright');
const base=process.env.SALES_QA_BASE||'http://127.0.0.1:18083';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Disposable loopback URL required');
const out=process.env.SALES_QA_OUT||path.resolve(__dirname,'../../../../../sales-runtime/verified');
fs.mkdirSync(out,{recursive:true});
const nativeRoot=process.env.SALES_QA_NATIVE_ROOT;
let probeClasses;
if(nativeRoot){
 probeClasses=path.join(out,'db-probe');fs.mkdirSync(probeClasses,{recursive:true});
 cp.execFileSync(path.join(path.dirname(process.env.SALES_QA_JAVA),'javac.exe'),['-d',probeClasses,path.join(__dirname,'SalesDbProbe.java')],{windowsHide:true,timeout:30000});
}
function q(sql){
 if(!/^SELECT /i.test(sql))throw Error('Read-only queries required');
 if(nativeRoot){
  process.env.SALES_QA_DB_URL=process.env.SALES_QA_MEMORY==='true'?'jdbc:h2:tcp://127.0.0.1:19095/mem:sales-qa-sop;IFEXISTS=TRUE':'jdbc:h2:tcp://127.0.0.1:19095/'+path.join(nativeRoot,'runtime/db/h2/'+(process.env.SALES_QA_DATABASE||'sales-qa-final')).replaceAll('\\','/')+';IFEXISTS=TRUE';
  return JSON.parse(cp.execFileSync(process.env.SALES_QA_JAVA,['--class-path',path.join(nativeRoot,'WEB-INF/lib/h2-2.4.240.jar')+path.delimiter+probeClasses,'SalesDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,timeout:30000}));
 }
 const db=cp.execFileSync('docker',['compose','-f',process.env.COMPOSE,'ps','-q','db'],{encoding:'utf8'}).trim();
 if(!db)throw Error('Disposable CI database missing');
 return JSON.parse(cp.execFileSync('docker',['exec',db,'psql','-U','moqui','-d','moqui','-tAc',`SELECT coalesce(json_agg(x),'[]') FROM (${sql}) x`],{encoding:'utf8',timeout:30000}));
}
const report={productionAccess:false,checks:[],pages:[],viewports:[],created:[],failures:[]};
function check(name,ok,evidence){report.checks.push({name,passed:!!ok,evidence});if(report.checks.length%25===0)console.log('Sales acceptance: '+report.checks.length+' checks complete');if(!ok)throw Error(name+' failed: '+JSON.stringify(evidence));}
function rows(table,where){return q(`SELECT * FROM ${table} WHERE ${where}`)}
function count(table,where){return Number(q(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n)}
function inv(id){return rows('invoice',`invoice_id='${id}'`)[0]}
function totals(name,id,taxable,cgst,sgst,igst){const i=inv(id);check(name,Number(i.invoice_total)===taxable+cgst+sgst+igst&&Number(i.total_taxable_amount)===taxable&&Number(i.total_cgst)===cgst&&Number(i.total_sgst)===sgst&&Number(i.total_igst)===igst&&Number(i.total_tax_amount)===cgst+sgst+igst,{invoiceTotal:i.invoice_total,taxable:i.total_taxable_amount,cgst:i.total_cgst,sgst:i.total_sgst,igst:i.total_igst,tax:i.total_tax_amount});}
(async()=>{
 const executable=process.env.SALES_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 for(let attempt=0;;attempt++){
  try{const response=await fetch(base+'/Login');if(response.status<500)break}catch{}
  if(attempt>=30)throw Error('Disposable Sales runtime did not become ready');
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
  const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const admin=await browser.newContext();let r=await admin.request.get(base+'/apps/zenith',{headers:{Authorization:'Basic '+Buffer.from('john.doe:moqui').toString('base64')}});check('fresh demo admin login',r.status()===200,{status:r.status()});
  const adminPage=await admin.newPage();adminPage.setDefaultNavigationTimeout(60000);await adminPage.goto(base+'/apps/zenith/sales/CreateInvoice',{waitUntil:'networkidle'});
  const adminToken=await adminPage.locator('[name=moquiSessionToken]').first().inputValue();
  r=await admin.request.post(base+'/apps/zenith/sales/SalesQaAcceptance/initialize',{form:{moquiSessionToken:adminToken}});let init;try{init=await r.json()}catch{throw Error('Fixture initialization returned HTTP '+r.status())}
  check('fresh synthetic fixtures initialized once',init.initialized===true,init);await admin.close();
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  r=await ctx.request.get(base+'/apps/zenith/sales/FindInvoice',{headers:{Authorization:'Basic '+Buffer.from('sales.qa:moqui').toString('base64')}});check('tenant-scoped QA account login',r.status()===200,{status:r.status()});
  const p=await ctx.newPage();p.setDefaultNavigationTimeout(60000);await p.goto(base+'/apps/zenith/sales/EditInvoice?invoiceId=SALES_QA_INV',{waitUntil:'networkidle'});
  const token=await p.locator('[name=moquiSessionToken]').first().inputValue();
  async function post(screen,transition,data={},shell='apps',csrf=true){const res=await ctx.request.post(`${base}/${shell}/zenith/sales/${screen}/${transition}`,{form:{...(csrf?{moquiSessionToken:token}:{}),...data},maxRedirects:0});check(`${shell} ${screen}/${transition} responds without server failure`,res.status()<500,{status:res.status()});return res;}
  async function invoke(op,data={},expectedError=false){const res=await post('SalesQaAcceptance','invoke',{op,...data});let body;try{body=await res.json()}catch{throw Error(op+' did not return JSON: HTTP '+res.status())};check(op+(expectedError?' is rejected':' succeeds'),expectedError?body.errors?.length>0:!body.errors?.length,{result:body.result,errors:body.errors});return body.result||{};}
  check('Sales seed supplies warranty and commission options',count('enumeration',"enum_type_id='WarrantyType'")===4&&count('enumeration',"enum_type_id='CommissionType'")===4,{});
  check('Sales seed supplies validated challan conversion',count('status_flow_transition',"status_id='DcDraft' AND to_status_id='DcConverted'")===1,{});
  // Exercise the internal mixed-vendor query before billing mutations so runtime
  // API incompatibilities fail immediately instead of hiding in a later list.
  for(const shell of ['apps','qapps'])for(const screen of ['FindOrder','SalesDashboard']){
   const response=await p.goto(`${base}/${shell}/zenith/sales/${screen}`,{waitUntil:'networkidle'});
   const body=await p.locator('body').innerText();
   check(shell+' '+screen+' internal scope query renders cleanly',response.status()===200&&!/Error rendering|ScreenRenderException|HTTP Status 500|No entity found|Ambiguous method|Template Error/.test(body)&&!body.includes('SALES_QA_MIXED_PRIVATE_HEADER'),{status:response.status()});
  }
  const mixedBefore=JSON.stringify(rows('order_header',"order_id='SALES_QA_MIXED_OWN_FIRST'"));
  for(const shell of ['apps','qapps']){
   await post('EditQuotation','convertToOrder',{orderId:'SALES_QA_MIXED_OWN_FIRST'},shell);
   check(shell+' own-first mixed quotation conversion changes no header',JSON.stringify(rows('order_header',"order_id='SALES_QA_MIXED_OWN_FIRST'"))===mixedBefore,{});
  }
  for(const shell of ['apps','qapps']){
   await post('EditOrder','addItem',{orderId:'SALES_QA_FREE_ORDER',productId:'SALES_QA_PROD_A',quantity:'1',unitAmount:'0'},shell);
   const free=rows('order_item',"order_id='SALES_QA_FREE_ORDER'");check(shell+' order explicit zero price remains free',free.length>0&&free.every(x=>Number(x.unit_amount)===0),free.map(x=>({quantity:x.quantity,amount:x.unit_amount})));
  }
  const partial=inv('SALES_QA_CASH');check('synthetic partial-payment baseline is consistent',Number(partial.invoice_total)===1062&&Number(partial.total_tax_amount)===162&&Number(partial.applied_payments_total)===100&&count('payment',"for_invoice_id='SALES_QA_CASH'")===1,{taxable:partial.total_taxable_amount,tax:partial.total_tax_amount,applied:partial.applied_payments_total});
  await post('EditInvoice','markPaidCash',{invoiceId:'SALES_QA_CASH'});
  await post('EditInvoice','markPaidCash',{invoiceId:'SALES_QA_CASH'},'qapps');
  const cash=inv('SALES_QA_CASH'),cashRows=rows('payment',"for_invoice_id='SALES_QA_CASH'");
  check('cash settles remaining tax-inclusive balance once',cashRows.length===2&&cashRows.some(x=>Number(x.amount)===962)&&Number(cash.applied_payments_total)===1062&&Number(cash.unpaid_total)===0,{payments:cashRows.map(x=>({id:x.payment_id,amount:x.amount})),applied:cash.applied_payments_total,status:cash.status_id});
  const quoteBefore=Number(rows('order_header',"order_id='SALES_QA_QUOTE'")[0].grand_total);
  await post('EditQuotation','updateStatus',{orderId:'SALES_QA_QUOTE',statusId:'OrderProposed',grandTotal:'1'});
  check('status update cannot forge an order total',Number(rows('order_header',"order_id='SALES_QA_QUOTE'")[0].grand_total)===quoteBefore,{before:quoteBefore});
  await post('EditQuotation','updateTerms',{orderId:'SALES_QA_QUOTE',orderPartSeqId:'01',vendorPartyId:'SALES_QA_B',customerPartyId:'SALES_QA_CUST_B',validThruDate:'2026-08-01'});
  const terms=rows('order_part',"order_id='SALES_QA_QUOTE'")[0];check('terms cannot transfer the quote to another tenant',terms.vendor_party_id==='SALES_QA_A'&&terms.customer_party_id==='SALES_QA_CUST_A',{vendor:terms.vendor_party_id,customer:terms.customer_party_id});
  const immutable=inv('SALES_QA_ISSUED'),foreign=inv('SALES_QA_FOREIGN');
  for(const shell of ['apps','qapps']){
   for(const [screen,idfield,id,pricefield] of [['EditInvoice','invoiceId','SALES_QA_INV','amount'],['EditCreditNote','invoiceId','SALES_QA_CN','amount'],['EditQuotation','orderId','SALES_QA_QUOTE','unitAmount'],['EditOrder','orderId','SALES_QA_ORDER','unitAmount']]){
    const table=idfield==='invoiceId'?'invoice_item':'order_item',where=`${idfield==='invoiceId'?'invoice_id':'order_id'}='${id}'`,before=count(table,where);
    for(const data of [{quantity:'-1'},{quantity:'0'},{quantity:'abc'},{[pricefield]:'-1'},{discountPercent:'150'},{taxPercentage:'-1'}]){
     // Order items use product tax, not a caller-supplied GST rate.
     if(screen==='EditOrder'&&data.taxPercentage)continue;
     await post(screen,'addItem',{[idfield]:id,productId:'SALES_QA_PROD_A',quantity:'1',[pricefield]:'100',discountPercent:'0',taxPercentage:'18',...data},shell);
     check(`${shell} ${screen} invalid input persists no line`,count(table,where)===before,{input:data,count:count(table,where)});
    }
   }
  }
  await post('EditInvoice','addItem',{invoiceId:'SALES_QA_INV',productId:'SALES_QA_PROD_A',quantity:'10',amount:'100',discountPercent:'10',taxPercentage:'18',description:'Disposable discounted line'});
  totals('discounted intra-state invoice golden', 'SALES_QA_INV',900,81,81,0);
  const draftTaxRows = seq => rows('tax_line_detail',`reference_type='InvoiceItem' AND reference_id='SALES_QA_INV' AND reference_seq_id='${seq}'`);
  const originalTaxIds = draftTaxRows('01').map(row => row.tax_line_detail_id).sort();
  check('discounted line has both GST details',originalTaxIds.length === 2,{ids:originalTaxIds});
  await post('EditInvoice','addItem',{invoiceId:'SALES_QA_INV',quantity:'1',amount:'100',taxPercentage:'18',description:'Disposable removable line'});
  check('new taxable line has GST details',draftTaxRows('02').length === 2,{});
  await post('EditInvoice','deleteItem',{invoiceId:'SALES_QA_INV',invoiceItemSeqId:'02'});
  totals('deleting another item preserves discount and GST','SALES_QA_INV',900,81,81,0);
  check('deletion removes only the deleted line tax rows',draftTaxRows('02').length === 0 &&
    JSON.stringify(draftTaxRows('01').map(row => row.tax_line_detail_id).sort()) === JSON.stringify(originalTaxIds),{});
  await post('EditInvoice','updateItem',{invoiceId:'SALES_QA_INV',invoiceItemSeqId:'01',quantity:'2.5',amount:'100'});
  totals('decimal edit retains omitted discount','SALES_QA_INV',225,20.25,20.25,0);
  await post('EditInvoice','updateItem',{invoiceId:'SALES_QA_INV',invoiceItemSeqId:'01',quantity:'10',amount:'100',discountPercent:'0'});
  totals('explicit zero discount clears prior discount','SALES_QA_INV',1000,90,90,0);
  await post('EditInvoice','updateItem',{invoiceId:'SALES_QA_INV',invoiceItemSeqId:'01',quantity:'10',amount:'100',discountPercent:'100'});
  totals('full discount stores authoritative zero','SALES_QA_INV',0,0,0,0);
  await post('EditInvoice','updateItem',{invoiceId:'SALES_QA_INV',invoiceItemSeqId:'01',quantity:'10',amount:'100',discountPercent:'10'});
  await post('EditInvoice','updateInvoice',{invoiceId:'SALES_QA_INV',placeOfSupplyStateCode:'27'});
  totals('changing draft place of supply retaxes existing lines','SALES_QA_INV',900,0,0,162);
  check('printed tax rows follow changed place of supply',Number(q("SELECT coalesce(sum(tax_amount),0) AS n FROM tax_line_detail WHERE reference_id='SALES_QA_INV' AND tax_name='IGST'")[0].n)===162,{expectedIgst:162});
  await post('EditInvoice','updateInvoice',{invoiceId:'SALES_QA_INV',placeOfSupplyStateCode:'29'});
  totals('restoring local place of supply restores split GST','SALES_QA_INV',900,81,81,0);
  await post('EditInvoice','setReverseCharge',{invoiceId:'SALES_QA_INV',isReverseCharge:'Y'});totals('reverse charge removes seller GST','SALES_QA_INV',900,0,0,0);
  await post('EditInvoice','setReverseCharge',{invoiceId:'SALES_QA_INV',isReverseCharge:'N'});totals('turning reverse charge off restores GST','SALES_QA_INV',900,81,81,0);
  await post('EditCreditNote','addItem',{invoiceId:'SALES_QA_CN',quantity:'2.5',amount:'100',discountPercent:'10',taxPercentage:'18',description:'Disposable credit adjustment'},'qapps');totals('credit note decimal GST','SALES_QA_CN',225,20.25,20.25,0);
  for(const [transition,data] of [['addItem',{quantity:'1',amount:'50'}],['deleteItem',{invoiceItemSeqId:'01'}],['updateItem',{invoiceItemSeqId:'01',quantity:'2',amount:'50'}],['setReverseCharge',{isReverseCharge:'Y'}],['updateInvoice',{statusId:'InvoiceInProcess'}],['updateInvoice',{fromPartyId:'SALES_QA_B',invoiceTotal:'1'}]]){
   await post('EditInvoice',transition,{invoiceId:'SALES_QA_ISSUED',...data});check('issued invoice survives '+transition,JSON.stringify(inv('SALES_QA_ISSUED'))===JSON.stringify(immutable),{id:'SALES_QA_ISSUED'});
  }
  for(const transition of ['addItem','deleteItem','updateInvoice']){await post('EditInvoice',transition,{invoiceId:'SALES_QA_FOREIGN',quantity:'1',amount:'50',invoiceItemSeqId:'01',statusId:'InvoiceCancelled'});check('foreign invoice survives '+transition,JSON.stringify(inv('SALES_QA_FOREIGN'))===JSON.stringify(foreign),{id:'SALES_QA_FOREIGN'});}
  const noCsrf=await post('EditInvoice','addItem',{invoiceId:'SALES_QA_INV',quantity:'1',amount:'1'},'apps',false);check('missing CSRF token denied',noCsrf.status()>=400,{status:noCsrf.status()});
  for(const [date,year] of [['2026-01-15','25-26'],['2026-03-31','25-26'],['2026-04-01','26-27']]){
   const created=await post('CreateInvoice','createInvoice',{toPartyId:'SALES_QA_CUST_A',invoiceDate:date});const id=new URL(created.headers().location).searchParams.get('invoiceId');
   check('backdated invoice financial year '+date,!!id&&inv(id).gst_invoice_number.startsWith('INV/'+year+'/'),{number:id?inv(id).gst_invoice_number:null});report.created.push({type:'backdated draft',id});
  }
  const beforeDuplicate=count('invoice',"from_party_id='SALES_QA_A'");await post('CreateInvoice','createInvoice',{toPartyId:'SALES_QA_CUST_A',gstInvoiceNumber:'SALES_QA_ISSUED'});
  check('manual duplicate invoice number rejected',count('invoice',"from_party_id='SALES_QA_A'")===beforeDuplicate,{before:beforeDuplicate});
  const note=await post('CreateCreditNote','createCreditNote',{originalInvoiceId:'SALES_QA_ISSUED',documentType:'Credit Note',invoiceMessage:'Disposable QA reason',invoiceDate:'2026-01-15'});const noteId=new URL(note.headers().location).searchParams.get('invoiceId');
  check('credit note preserves original, reason and financial year',!!noteId&&inv(noteId).original_invoice_id==='SALES_QA_ISSUED'&&inv(noteId).invoice_message==='Disposable QA reason'&&inv(noteId).gst_invoice_number.startsWith('CN/25-26/'),{id:noteId});report.created.push({type:'credit note',id:noteId});
  await post('EditQuotation','addItem',{orderId:'SALES_QA_QUOTE',productId:'SALES_QA_PROD_A',quantity:'10',unitAmount:'100',discountPercent:'10',taxPercentage:'18',description:'Disposable quote line'});
  function checkQuotedTotal(stage) {
   const header=rows('order_header',"order_id='SALES_QA_QUOTE'")[0], part=rows('order_part',"order_id='SALES_QA_QUOTE'")[0];
   check(stage+' stores discounted total including GST',Number(header.grand_total)===1062 && Number(part.part_total)===1062,{header:header.grand_total,part:part.part_total});
  }
  checkQuotedTotal('quotation');
  await post('EditQuotation','convertToOrder',{orderId:'SALES_QA_QUOTE'});
  checkQuotedTotal('converted order');
  const convertedOrder=rows('order_header',"order_id='SALES_QA_QUOTE'")[0];check('quote converts to order',convertedOrder.status_id==='OrderPlaced'&&convertedOrder.document_type==='SALES_ORDER',{status:convertedOrder.status_id});
  await post('EditOrder','convertToInvoice',{orderId:'SALES_QA_QUOTE'});
  const billed=rows('order_item_billing',"order_id='SALES_QA_QUOTE'");check('converted order is linked to invoice',billed.length===1,{count:billed.length});
  const quoteInvoice=billed[0].invoice_id;totals('quote-to-order-to-invoice retains line discount',quoteInvoice,900,81,81,0);report.created.push({type:'order invoice',id:quoteInvoice});
  await Promise.all([post('EditOrder','convertToInvoice',{orderId:'SALES_QA_QUOTE'}),post('EditOrder','convertToInvoice',{orderId:'SALES_QA_QUOTE'})]);
  check('competing order conversion retries keep one billing link',count('order_item_billing',"order_id='SALES_QA_QUOTE'")===1,{count:count('order_item_billing',"order_id='SALES_QA_QUOTE'")});
  for(const [amount,words] of [['1062.00','Rupees One Thousand Sixty Two Only'],['1234567.89','Rupees Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven and Eighty Nine Paise Only'],['10000000','Rupees One Crore Only']]){const converted=await invoke('words',{amount});check('amount-to-words '+amount,converted.amountInWords===words,{words:converted.amountInWords});}
  await invoke('forecast',{organizationPartyId:'SALES_QA_B'},true);
  // The generic tax dispatcher must preserve RCM and the conversion must retain discounts.
  for(const isReverseCharge of ['N','Y']){
   const result=await invoke('invoice',{organizationPartyId:'SALES_QA_A',customerPartyId:'SALES_QA_CUST_A',isReverseCharge,items:JSON.stringify([{productId:'SALES_QA_PROD_A',quantity:10,unitAmount:100,discountPercent:10}])});report.created.push({type:'invoice',id:result.invoiceId});
   totals('service invoice discount and RCM '+isReverseCharge,result.invoiceId,900,isReverseCharge==='Y'?0:81,isReverseCharge==='Y'?0:81,0);
  }
  const usdResult=await invoke('invoice',{organizationPartyId:'SALES_QA_A',customerPartyId:'SALES_QA_CUST_A',
    currencyUomId:'USD',items:JSON.stringify([{itemDescription:'Disposable fractional amount',quantity:1,unitAmount:10.25}])});
  const usdInvoice=inv(usdResult.invoiceId);
  check('foreign-currency invoice retains its fractional payable',Number(usdInvoice.round_off_amount)===0 &&
    !Number.isInteger(Number(usdInvoice.invoice_total)) && Number(usdInvoice.unpaid_total)===Number(usdInvoice.invoice_total),
    {total:usdInvoice.invoice_total,unpaid:usdInvoice.unpaid_total});
  await invoke('invoice',{organizationPartyId:'SALES_QA_A',customerPartyId:'SALES_QA_CUST_B',items:JSON.stringify([{productId:'SALES_QA_PROD_A',quantity:1,unitAmount:100}])},true);
  await invoke('invoice',{organizationPartyId:'SALES_QA_A',customerPartyId:'SALES_QA_CUST_A',items:JSON.stringify([{productId:'SALES_QA_PROD_B',quantity:1,unitAmount:100}])},true);
  await invoke('serviceItem',{invoiceId:'SALES_QA_ISSUED',productId:'SALES_QA_PROD_A',quantity:'1',unitAmount:'100'},true);
  await invoke('serviceItem',{invoiceId:'SALES_QA_CN',productId:'SALES_QA_PROD_B',quantity:'1',unitAmount:'100'},true);
  await invoke('link',{invoiceId:'SALES_QA_CN'},true);
  await invoke('upi',{invoiceId:'SALES_QA_CN',upiId:'qa@invalid',merchantName:'Disposable QA'},true);
  const qr=await invoke('upi' ,{invoiceId:'SALES_QA_INV',upiId:'qa@invalid',merchantName:'Disposable QA & Test'});const parsed=new URL(qr.upiString);check('UPI amount includes GST and encoded merchant',parsed.searchParams.get('am')==='1062.00'&&parsed.searchParams.get('pn')==='Disposable QA & Test',{amount:parsed.searchParams.get('am'),merchant:parsed.searchParams.get('pn')});
  const link=await invoke('link',{invoiceId:'SALES_QA_INV'}),link2=await invoke('link',{invoiceId:'SALES_QA_INV'});const pl=rows('payment_link',`payment_link_id='${link.paymentLinkId}'`)[0];check('payment links use tax-inclusive total and distinct IDs',Number(pl.amount)===1062&&link.paymentLinkId!==link2.paymentLinkId&&link.paymentUrl!==link2.paymentUrl,{amount:pl.amount,distinct:link.paymentUrl!==link2.paymentUrl});
  await invoke('callback',{externalLinkId:pl.external_link_id,status:'paid',transactionId:'SALES_QA_MOCK'});await invoke('callback',{externalLinkId:pl.external_link_id,status:'paid',transactionId:'SALES_QA_MOCK'});await invoke('callback',{externalLinkId:pl.external_link_id,status:'failed'});
  const settled=inv('SALES_QA_INV');check('payment callback settles once and late failure stays paid',count('payment',"for_invoice_id='SALES_QA_INV'")===1&&Number(settled.applied_payments_total)===1062&&Number(settled.unpaid_total)===0&&settled.status_id==='InvoicePmtRecvd'&&rows('payment_link',`payment_link_id='${link.paymentLinkId}'`)[0].status_id==='PAID',{payments:count('payment',"for_invoice_id='SALES_QA_INV'"),applied:settled.applied_payments_total,status:settled.status_id});
  for(const kind of ['EXPIRED','FUTURE','FOREIGN'])await invoke('claim',{warrantyRegId:'SALES_QA_WR_'+kind,issueDescription:'Disposable claim'},true);
  for(const kind of ['ACTIVE','TODAY']){const claim=await invoke('claim',{warrantyRegId:'SALES_QA_WR_'+kind,issueDescription:'Disposable claim'});check('warranty claim returns real primary key',!!claim.warrantyClaimId&&count('warranty_claim',`claim_id='${claim.warrantyClaimId}'`)===1,{claimId:claim.warrantyClaimId});report.created.push({type:'claim',id:claim.warrantyClaimId});}
  await invoke('register',{warrantyPolicyId:'SALES_QA_POLICY_B',customerPartyId:'SALES_QA_CUST_A',productId:'SALES_QA_PROD_A',purchaseDate:'2026-07-01'},true);
  const commission=await invoke('commission',{orderId:'SALES_QA_ORDER',partyId:'SALES_QA_SALES'});check('commission excludes expired/future/threshold-ineligible structures',Number(commission.commissionAmount)===70,{amount:commission.commissionAmount});report.created.push({type:'commission',id:commission.commissionTxnId});
  await post('EditCommission','updateStructure',{commissionId:'SALES_QA_COMM_VALID',rate:'-1',isActive:'Y'});
  check('negative edited commission persists no change',Number(rows('commission_structure',"commission_id='SALES_QA_COMM_VALID'")[0].rate)===7,{});
  await post('Commissions','createTier',{commissionId:'SALES_QA_COMM_VALID',minAmount:'-1',rate:'10'});
  check('negative commission slab persists no row',count('commission_tier',"commission_id='SALES_QA_COMM_VALID'")===0,{});
  // Exercise the screen's persisted challan fields and its conversion endpoint.
  await post('EditDeliveryChallan','addItem',{challanId:'SALES_QA_DC_A',productId:'SALES_QA_PROD_A',quantity:'2',estimatedValue:'200',description:'Disposable goods',uomId:'UT_kg'});
  check('challan item persisted with its real composite key',count('zenith_dlvry_challan_item',"challan_id='SALES_QA_DC_A'")===1,rows('zenith_dlvry_challan_item',"challan_id='SALES_QA_DC_A'"));
  const converted=await post('EditDeliveryChallan','convertToInvoice',{challanId:'SALES_QA_DC_A'});const dc=rows('zenith_delivery_challan',"challan_id='SALES_QA_DC_A'")[0];check('challan conversion produces linked invoice',!!dc.converted_to_invoice_id&&dc.status_id==='DcConverted',{status:dc.status_id,invoiceId:dc.converted_to_invoice_id,redirect:converted.headers().location});report.created.push({type:'challan invoice',id:dc.converted_to_invoice_id});totals('challan goods tax golden',dc.converted_to_invoice_id,200,18,18,0);
  const invoiceCount=count('invoice',"from_party_id='SALES_QA_A'");await post('EditDeliveryChallan','convertToInvoice',{challanId:'SALES_QA_DC_A'});check('challan reconversion is idempotent',count('invoice',"from_party_id='SALES_QA_A'")===invoiceCount,{count:invoiceCount});
  // Preference and session-cache forgery cannot acquire membership of Tenant B.
  const scopePage=await ctx.newPage();
  for(const org of ['SALES_QA_B','_NA_']){
   await post('SalesQaAcceptance','scope',{org});
   for(const shell of ['apps','qapps'])for(const screen of ['FindInvoice','FindOrder','FindQuotation','FindCreditNote','FindDeliveryChallan','WarrantyPolicies','Commissions','PosSalesRegister']){
    const res=await scopePage.goto(`${base}/${shell}/zenith/sales/${screen}?fromPartyId=SALES_QA_B&vendorPartyId=SALES_QA_B&ownerPartyId=SALES_QA_B&organizationPartyId=SALES_QA_B`,{waitUntil:'networkidle'});const text=await scopePage.locator('.z-sales-page').innerText();check(`${shell} ${screen} denies forged/no active organization`,!text.includes('SALES_QA_FOREIGN')&&!text.includes('QA-DC-B')&&!text.includes('SALES_QA_WR_FOREIGN')&&!text.includes('QA-POS-B')&&!text.includes('SALES_QA_COMM_FOREIGN'),{status:res.status(),org});
   }
   for(const shell of ['apps','qapps']){
    const denied=await ctx.request.get(`${base}/${shell}/zenith/sales/EditCommission?commissionId=SALES_QA_COMM_FOREIGN`);check(shell+' foreign commission details stay hidden',!(await denied.text()).includes('Synthetic Sales QA B'),{org,status:denied.status()});
    await post('EditCommission','updateStructure',{commissionId:'SALES_QA_COMM_FOREIGN',rate:'1',isActive:'N'},shell);
    await post('Commissions','deleteTier',{commissionTierId:'SALES_QA_TIER_FOREIGN'},shell);
    await post('Commissions','createTier',{commissionId:'SALES_QA_COMM_FOREIGN',minAmount:'200',rate:'1'},shell);
    check(shell+' foreign commission and slabs are unchanged',Number(rows('commission_structure',"commission_id='SALES_QA_COMM_FOREIGN'")[0].rate)===99&&count('commission_tier',"commission_id='SALES_QA_COMM_FOREIGN'")===1,{org});
   }
   await post('EditInvoice','updateInvoice',{invoiceId:'SALES_QA_FOREIGN',statusId:'InvoiceCancelled'});check('forged preference cannot mutate foreign invoice',JSON.stringify(inv('SALES_QA_FOREIGN'))===JSON.stringify(foreign),{org});
  }
  await scopePage.close();
  await post('SalesQaAcceptance','scope',{org:'SALES_QA_A'});
  for(const [screen,params] of [['InvoicePrint','invoiceId=SALES_QA_INV'],['CreditNotePrint','invoiceId=SALES_QA_CN'],['OrderPrint','orderId=SALES_QA_ORDER'],['ChallanPrint','challanId=SALES_QA_DC_A']]){
   const pdf=await ctx.request.get(`${base}/fop/apps/zenith/sales/${screen}?${params}`);const bytes=await pdf.body();
   check(screen+' generates a PDF for the synthetic document',pdf.status()===200&&bytes.subarray(0,5).toString()==='%PDF-',{status:pdf.status(),bytes:bytes.length});
   fs.writeFileSync(path.join(out,screen+'.pdf'),bytes);
  }
  const printText=screen=>JSON.parse(cp.execFileSync(process.env.SALES_QA_PYTHON||'python3',[path.join(__dirname,'inspect-pdf.py'),path.join(out,screen+'.pdf'),'--text'],{encoding:'utf8',windowsHide:true,timeout:30000})).text;
  const invoicePrintText=printText('InvoicePrint'),creditPrintText=printText('CreditNotePrint');
  check('InvoicePrint discounted GST and grand total reconcile',invoicePrintText.split('Rs. 81.00 (9%)').length===3&&invoicePrintText.includes('Taxes Rs. 162.00')&&invoicePrintText.includes('Total Rs. 1,062.00')&&!invoicePrintText.includes('1,224.00'),{cgst:81,sgst:81,tax:162,total:1062});
  check('CreditNotePrint discounted GST and round-off reconcile',creditPrintText.split('9% 20.25').length===3&&/TOTALS\s+225\.00\s+20\.25\s+20\.25\s+0\.00/.test(creditPrintText)&&creditPrintText.includes('Round-off (Rs.): 0.50')&&creditPrintText.includes('Total (Rs.) 266.00'),{cgst:20.25,sgst:20.25,roundOff:0.5,total:266});
  const consoleErrors=[];p.on('pageerror',e=>consoleErrors.push(e.message));
  const screens=['PosSalesRegister','EditCommission?commissionId=SALES_QA_COMM_VALID','SalesDashboard','FindQuotation','FindOrder','FindInvoice','FindCreditNote','FindDeliveryChallan','CreateQuotation','CreateOrder','CreateInvoice','CreateCreditNote','CreateDeliveryChallan','WarrantyPolicies','Commissions','SalesForecast','EditInvoice?invoiceId=SALES_QA_INV','EditCreditNote?invoiceId=SALES_QA_CN','EditQuotation?orderId=SALES_QA_QUOTE','EditOrder?orderId=SALES_QA_ORDER','EditDeliveryChallan?challanId=SALES_QA_DC_A'];
  for(const shell of ['apps','qapps'])for(const screen of screens){
   await p.setViewportSize({width:1440,height:1000});const res=await p.goto(`${base}/${shell}/zenith/sales/${screen}`,{waitUntil:'networkidle',timeout:60000});const text=await p.locator('body').innerText();const error=/Error rendering|ScreenRenderException|500 Internal Server Error|HTTP Status 500|java\.lang\.|freemarker\.core/i.test(text);report.pages.push({shell,screen,status:res.status(),error});check(`${shell} ${screen} renders`,res.status()===200&&!error,{status:res.status()});if(screen==='FindInvoice')check(shell+' invoice list excludes credit notes',!(await p.locator('.z-listchrome').innerText()).includes('SALES_QA_CN'),{});if(screen.startsWith('EditDeliveryChallan'))check(shell+' converted challan hides locked goods actions and explains the status lock',(await p.getByText('Add Goods',{exact:true}).count())===0&&text.includes('Status is locked after invoicing, return or cancellation.')&&!text.includes('You have view-only access'),{});
  }
  for(const shell of ['apps','qapps'])for(const width of [1440,800,390,320])for(const screen of ['FindInvoice','CreateInvoice','EditCreditNote?invoiceId=SALES_QA_CN','EditDeliveryChallan?challanId=SALES_QA_DC_A']){
   await p.setViewportSize({width,height:1000});await p.goto(`${base}/${shell}/zenith/sales/${screen}`,{waitUntil:'networkidle',timeout:60000});
   // Close an expanded mobile navigation drawer through its real toggle when present.
   const toggle=p.locator('.q-header .q-toolbar>button:first-child');if(shell==='qapps'&&width<900&&await toggle.count()&&await p.locator('body').evaluate(e=>e.classList.contains('zq-side-open')))await toggle.click();
   const geometry=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,scopeCount:document.querySelectorAll('.z-sales-page').length,overflow:[...document.querySelectorAll('.z-sales-page input,.z-sales-page select,.z-sales-page button')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+2||r.left<-2)&&!x.closest('.z-sales-table,.table-responsive,.q-table__middle,.q-table__container,.table-scroll-wrapper')&&!x.closest('.modal')}).slice(0,6).map(x=>({name:x.name,id:x.id}))}));
   report.viewports.push({shell,screen,width,...geometry});check(`${shell} ${screen} ${width}px has no page overflow`,geometry.document<=width+2&&geometry.scopeCount>0&&geometry.overflow.length===0,{document:geometry.document,viewport:width,controls:geometry.overflow});
   if(screen==='FindInvoice'){
    const action=p.locator('.z-fitlist a').filter({hasText:'View'}).first();
    if(await action.count()){
     await action.scrollIntoViewIfNeeded();
     const visible=await action.evaluate(e=>{const r=e.getBoundingClientRect(),cell=e.closest('td,.td'),c=cell?.getBoundingClientRect();return !!c&&r.left>=c.left-2&&r.right<=c.right+2&&r.left>=-2&&r.right<=innerWidth+2;});
     check(`${shell} ${width}px invoice action remains reachable by table scrolling`,visible);
    }
   }
   if(shell==='qapps'){
    await p.locator('#zq-subnav.show[data-mod="sales"]').waitFor();
    const header=await p.evaluate(()=>{
     const selectors=['.q-header .q-toolbar>button:first-child','#zq-ownerview','#zq-search',
      '#zq-toolbtns .zqtb-history','#zq-toolbtns a[href*="MyPassword"]','#zq-toolbtns [data-control="notifications"]','#zq-toolbtns .zqtb-avatar'];
     const controls=selectors.map(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0?{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null}).filter(Boolean);
     const overlap=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)overlap.push([a.selector,b.selector]);}
     return {controls,overlap,headerBottom:document.querySelector('.q-header').getBoundingClientRect().bottom,subnavTop:document.querySelector('#zq-subnav').getBoundingClientRect().top};
    });
    check(`${screen} ${width}px header controls do not overlap`,header.controls.length>=4&&!header.overlap.length&&header.subnavTop>=header.headerBottom-2,header);
   }
   if(width===390||width===1440)await p.screenshot({path:path.join(out,`${shell}-${screen.split('?')[0]}-${width}.png`),fullPage:true});
  }
  for(const shell of ['apps','qapps']){
   await p.setViewportSize({width:390,height:1000});await p.goto(`${base}/${shell}/zenith/sales/EditCreditNote?invoiceId=SALES_QA_CN`,{waitUntil:'networkidle'});
   await p.getByText('Add Adjustment',{exact:true}).first().click();
   const qty=p.locator('input[name="quantity"]:visible').first();await qty.fill('2.5');
   check(shell+' adjustment form accepts decimal quantity',await qty.evaluate(e=>e.value==='2.5'&&!e.validity.stepMismatch),{value:await qty.inputValue()});
   await qty.focus();await p.keyboard.press('Tab');check(shell+' keyboard moves focus through dialog',await p.evaluate(()=>document.activeElement!==document.body),{focus:true});
   await p.screenshot({path:path.join(out,`${shell}-adjustment-dialog-390.png`),fullPage:true});
  }
  check('no browser JavaScript errors',consoleErrors.length===0,consoleErrors);report.consoleErrors=consoleErrors;
  report.syntheticDocuments=q("SELECT invoice_id,status_id FROM invoice WHERE from_party_id LIKE 'SALES_QA_%' ORDER BY invoice_id");
  await require('./verify-sop.cjs')({ctx,p,post,invoke,q,rows,inv,count,check,base,out,report});
  check('no browser JavaScript errors including supplemental SOP cases',consoleErrors.length===0,consoleErrors);report.consoleErrors=consoleErrors;
  await ctx.close();
 }catch(e){report.failures.push(e.message);throw e}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({checks:report.checks.length,pages:report.pages.length,viewports:report.viewports.length,failures:report.failures,output:out}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
