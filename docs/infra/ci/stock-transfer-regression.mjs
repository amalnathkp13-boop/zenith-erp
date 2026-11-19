// Local integration checks: import seed/stock-transfer-local.sql and restart local Moqui first.
// Run with SMOKE_PASS set to the local demo password. No production hosts are accepted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const base=process.env.STOCK_TRANSFER_URL || 'http://localhost:8080';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local verification only');
const database=process.env.STOCK_TRANSFER_DATABASE || 'moqui';
assert(/^[a-z][a-z0-9_]*$/.test(database),'Local database name');
const route='/apps/zenith/Inventory/';
const sql=statement => execFileSync('docker',['exec','zenith-erp-db-1','psql','-U','moqui','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8'}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const row=(table,where)=>JSON.parse(sql(`select row_to_json(t) from (select * from ${table} where ${where}) t`)||'null');
const transfer=id=>row('stock_transfer',`stock_transfer_id=${quote(id)}`);
const line=(id,seq)=>row('stock_transfer_item',`stock_transfer_id=${quote(id)} and transfer_item_seq_id=${quote(seq)}`);
const count=(table,where)=>Number(sql(`select count(*) from ${table} where ${where}`));
const balance=(product,facility,column='quantity_on_hand_total')=>Number(sql(`select coalesce(sum(${column}),0) from asset where product_id=${quote(product)} and facility_id=${quote(facility)} and owner_party_id='STFIX_ORG' and asset_type_enum_id='AstTpInventory'`));
const created=[]; const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS',name);};
async function session(user='stock.transfer.audit') {
 const auth='Basic '+Buffer.from(`${user}:${process.env.SMOKE_PASS || 'moqui'}`).toString('base64');
 const jar=new Map(); let token;
 async function request(path,params) {
  const body=params?new URLSearchParams():null;
  if(params) for(const [key,value] of Object.entries({...params,moquiSessionToken:token})) for(const item of Array.isArray(value)?value:[value]) body.append(key,String(item));
  const response=await fetch(base+path,{redirect:'manual',method:params?'POST':'GET',headers:{...(!jar.size ? {Authorization:auth}:{}),Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body});
  for(const entry of response.headers.getSetCookie()) {const [key,value]=entry.split(';')[0].split('=');jar.set(key,value);}
  const text=await response.text(); token=text.match(/name="moquiSessionToken" value="([^"]+)"/)?.[1] || text.match(/['"]moquiSessionToken['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] || token;
  assert(!/Template Error|Error rendering screen|Exception running actions|Error in screen|Error rendering.*form/i.test(text),'Rendering error: '+path);
  if (!params && response.status===302) {const redirect=new URL(response.headers.get('location'),base);return request(redirect.pathname+redirect.search);}
  return {response,text};
 }
 await request(route+'StockTransfers'); assert(token,'Session token obtained');
 await request('/apps/setPreference',{preferenceKey:'ACTIVE_ORGANIZATION',preferenceValue:user==='stock.transfer.noorg'?'_NA_':'STFIX_ORG'});
 return {request,post:(page,tx,params)=>request(route+page+'/'+tx,params)};
}
const writer=await session();
async function create(params={}) {
 const before=count('stock_transfer',"organization_party_id='STFIX_ORG'");
 const result=await writer.post('NewStockTransfer','createTransfer',{fromFacilityId:'STFIX_A',toFacilityId:'STFIX_B',remarks:'STFIX audit',ewayBillChoice:'N',...params});
 const location=result.response.headers.get('location');
 const id=location && new URL(location,base).searchParams.get('stockTransferId');
 if(id && transfer(id)?.organization_party_id==='STFIX_ORG' && count('stock_transfer',"organization_party_id='STFIX_ORG'")>before) { created.push(id);return id; }
 return null;
}
async function add(id,quantity,params={}) {
 await writer.post('EditStockTransfer','addItem',{stockTransferId:id,productId:'STFIX_P',quantity,...params});
 const rows=JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (select transfer_item_seq_id from stock_transfer_item where stock_transfer_id=${quote(id)} order by transfer_item_seq_id) t`));
 return rows.at(-1)?.transfer_item_seq_id;
}
const ship=id=>writer.post('StockTransfers','shipTransfer',{stockTransferId:id});
const receive=id=>writer.post('StockTransfers','receiveTransfer',{stockTransferId:id});
try {
 for(const choice of ['', 'invalid']) assert.equal(await create({ewayBillChoice:choice}),null);
 const manual=await create({ewayBillChoice:'Y'});await add(manual,'1');
 check('A selected e-way bill survives recalculation below the threshold',()=>{assert.equal(transfer(manual).eway_bill_choice,'Y');assert.equal(transfer(manual).eway_bill_required,'Y');});
 await ship(manual);assert.equal(transfer(manual).status_id,'StxDraft');
 await writer.post('EditStockTransfer','editHeader',{stockTransferId:manual,ewayBillChoice:'N'});
 assert.equal(transfer(manual).eway_bill_required,'N');
 const first=await create({organizationPartyId:'STFIX_OTHER',statusId:'StxReceived',totalValue:'100000',ewayBillRequired:'N'});
 assert(first,'Creation succeeds');
 check('Creation ignores forged owner, status and totals',()=>{const t=transfer(first);assert.equal(t.organization_party_id,'STFIX_ORG');assert.equal(t.status_id,'StxDraft');assert.equal(Number(t.total_value),0);assert.equal(t.transfer_number,first);});
 for(const params of [{toFacilityId:'STFIX_A'},{toFacilityId:'STFIX_FOREIGN'},{fromFacilityId:''}]) assert.equal(await create(params),null);
 check('Same, foreign and missing warehouses rejected',()=>{});
 await ship(first);check('Empty transfer cannot ship',()=>assert.equal(transfer(first).status_id,'StxDraft'));
 for(const quantity of ['0','-1']) await add(first,quantity);
 await add(first,'1',{productId:'STFIX_FOREIGN'});
 await add(first,'1',{productId:'STFIX_SERVICE'});
 check('Invalid quantities, foreign products and services rejected',()=>assert.equal(count('stock_transfer_item',`stock_transfer_id=${quote(first)}`),0));
 const itemPicker=await writer.request(route+'EditStockTransfer?stockTransferId='+first);
 check('Transfer picker offers physical products only',()=>{assert(itemPicker.text.includes('STFIX_P'));assert(!itemPicker.text.includes('STFIX_SERVICE'));});
 const l1=await add(first,'8');const l2=await add(first,'8');
 await ship(first);
 check('Combined duplicate lines cannot overdraw free stock',()=>{assert.equal(transfer(first).status_id,'StxDraft');assert.equal(balance('STFIX_P','STFIX_A'),15);});
 await writer.post('EditStockTransfer','deleteItem',{stockTransferId:first,transferItemSeqId:l2});
 check('Deleting a draft line recomputes totals',()=>assert.equal(Number(transfer(first).total_value),80));
 await writer.post('EditStockTransfer','deleteItem',{stockTransferId:first,transferItemSeqId:l1});
 const seq=await add(first,'7.5',{unitAmount:'0'});
 check('Explicit zero price and fractional quantity retained',()=>{assert.equal(Number(line(first,seq).quantity),7.5);assert.equal(Number(line(first,seq).unit_amount),0);});
 await writer.post('StockTransfers','updateTransfer',{stockTransferId:first,vehicleNumber:' audit van ',statusId:'StxReceived',organizationPartyId:'STFIX_OTHER',totalValue:'999',fromFacilityId:'STFIX_FOREIGN'});
 check('Logistics saves only permitted fields',()=>{const t=transfer(first);assert.equal(t.status_id,'StxDraft');assert.equal(t.organization_party_id,'STFIX_ORG');assert.equal(t.from_facility_id,'STFIX_A');assert.equal(Number(t.total_value),0);assert.equal(t.vehicle_number,'AUDIT VAN');});
 await writer.request('/qapps/zenith/Inventory/StockTransfers/shipTransfer',{stockTransferId:first}); await ship(first);
 check('Shipping moves stock once and preserves reservations',()=>{assert.equal(transfer(first).status_id,'StxInTransit');assert.equal(balance('STFIX_P','STFIX_A'),7.5);assert.equal(balance('STFIX_P','STFIX_A','available_to_promise_total'),5.5);});
 await writer.post('EditStockTransfer','deleteItem',{stockTransferId:first,transferItemSeqId:seq}); await add(first,'1');
 await writer.post('EditStockTransfer','editHeader',{stockTransferId:first,fromFacilityId:'STFIX_B',toFacilityId:'STFIX_A',ewayBillChoice:'N'});
 check('Shipped lines and header cannot be changed',()=>{assert.equal(count('stock_transfer_item',`stock_transfer_id=${quote(first)}`),1);assert.equal(transfer(first).from_facility_id,'STFIX_A');});
 for(const quantityReceived of ['-1','8']) await writer.post('EditStockTransfer','setReceivedQty',{stockTransferId:first,transferItemSeqId:seq,quantityReceived});
 check('Receipt underflow and overage rejected',()=>assert.equal(line(first,seq).quantity_received,null));
 await writer.post('EditStockTransfer','setReceivedQty',{stockTransferId:first,transferItemSeqId:seq,quantityReceived:'6'});
 await writer.request('/qapps/zenith/Inventory/StockTransfers/receiveTransfer',{stockTransferId:first});await receive(first);
 check('Partial receiving moves the actual quantity once',()=>{assert.equal(transfer(first).status_id,'StxReceived');assert.equal(balance('STFIX_P','STFIX_B'),8);assert.equal(Number(line(first,seq).quantity_received),6);});
 check('Asset totals and movement ledger agree',()=>{for(const asset of ['STFIX_A1','STFIX_B1']) assert.equal(Number(sql(`select quantity_on_hand_total from asset where asset_id=${quote(asset)}`)),Number(sql(`select coalesce(sum(quantity_on_hand_diff),0) from asset_detail where asset_id=${quote(asset)}`)));assert.equal(Number(sql(`select sum(quantity_on_hand_diff) from asset_detail where description=${quote('Transfer out '+first)}`)),-7.5);});
 const zero=await create();const zseq=await add(zero,'1');await ship(zero);
 await writer.post('EditStockTransfer','setReceivedQty',{stockTransferId:zero,transferItemSeqId:zseq,quantityReceived:'0'});await receive(zero);
 check('Zero arrival records full transit loss without adding stock',()=>{assert.equal(transfer(zero).status_id,'StxReceived');assert.equal(balance('STFIX_P','STFIX_B'),8);assert.equal(Number(line(zero,zseq).quantity_received),0);});
 const batch=await create();await add(batch,'2',{productId:'STFIX_BATCH',batchNumber:'STFIX-LOT'});await ship(batch);await receive(batch);
 check('Batch identity, expiry and valuation follow the transfer',()=>{assert.equal(balance('STFIX_BATCH','STFIX_A'),6);assert.equal(balance('STFIX_BATCH','STFIX_B'),2);const a=row('asset',"product_id='STFIX_BATCH' and facility_id='STFIX_B'");assert.equal(a.batch_number,'STFIX-LOT');assert.equal(a.expiry_date,'2027-03-01');assert.equal(Number(a.valuation_rate),4);});
 const serial=await create();const sseq=await add(serial,'',{productId:'STFIX_SERIAL',serialNumbers:['STFIX_SN1','STFIX_SN2']});
 await add(serial,'1',{productId:'STFIX_SERIAL',serialNumbers:['STFIX_SN1']});
 check('Serial selection derives quantity and prevents duplicate picks',()=>{assert.equal(Number(line(serial,sseq).quantity),2);assert.equal(count('stock_transfer_item',`stock_transfer_id=${quote(serial)}`),1);});
 await ship(serial);
 check('Shipped serials are unavailable at source',()=>assert.equal(row('product_serial_number',"serial_number_id='STFIX_SN1'").status_id,'SnInTransit'));
 await writer.post('EditStockTransfer','setReceivedQty',{stockTransferId:serial,transferItemSeqId:sseq,quantityReceived:'1'});
 check('Partial serial receipt requires exact arrived units',()=>assert.equal(line(serial,sseq).quantity_received,null));
 await writer.post('EditStockTransfer','setReceivedQty',{stockTransferId:serial,transferItemSeqId:sseq,quantityReceived:'1',receivedSerialNumbers:['STFIX_SN1']}); await receive(serial);
 check('Only arrived serials move; lost units remain unavailable',()=>{assert.equal(balance('STFIX_SERIAL','STFIX_B'),1);const arrived=row('product_serial_number',"serial_number_id='STFIX_SN1'");assert.equal(arrived.facility_id,'STFIX_B');assert.equal(arrived.status_id,'SnInStock');assert.equal(row('product_serial_number',"serial_number_id='STFIX_SN2'").status_id,'SnTransferLost');});
 const a=await create();const b=await create();await add(a,'3');await add(b,'3');await Promise.all([ship(a),ship(b)]);
 check('Concurrent transfers cannot consume the same free stock',()=>{assert.equal([transfer(a).status_id,transfer(b).status_id].filter(s=>s==='StxInTransit').length,1);assert.equal(balance('STFIX_P','STFIX_A'),3.5);assert.equal(balance('STFIX_P','STFIX_A','available_to_promise_total'),1.5);});
 assert.equal(sql("select preference_value from user_preference where user_id='STFIX_USER' and preference_key='ACTIVE_ORGANIZATION'"),'STFIX_ORG','Writer organization after stock checks');
 const viewer=await session('stock.transfer.viewer'); await viewer.post('NewStockTransfer','createTransfer',{fromFacilityId:'STFIX_A',toFacilityId:'STFIX_B',ewayBillChoice:'N'});await viewer.post('StockTransfers','shipTransfer',{stockTransferId:b});
 check('View-only users cannot create or ship',()=>assert.equal(created.length,count('stock_transfer',"organization_party_id='STFIX_ORG'")));
 await writer.post('StockTransfers','deleteTransfer',{stockTransferId:'STFIX_FOREIGN'});
 check('Cross-organization transfer actions are denied even for admin',()=>assert(transfer('STFIX_FOREIGN')));
 const foreign=await writer.request(route+'EditStockTransfer?stockTransferId=STFIX_FOREIGN');assert(!foreign.text.includes('Foreign audit warehouse'));
 assert.equal(sql("select preference_value from user_preference where user_id='STFIX_USER' and preference_key='ACTIVE_ORGANIZATION'"),'STFIX_ORG','Writer organization preserved');
 const noorg=await session('stock.transfer.noorg');const empty=await noorg.request(route+'StockTransfers');assert(!empty.text.includes('STFIX-FOREIGN-TRANSFER'));assert(!empty.text.includes('Transfer audit sender'));
 assert.equal(sql("select preference_value from user_preference where user_id='STFIX_USER' and preference_key='ACTIVE_ORGANIZATION'"),'STFIX_ORG','Other session cannot change writer organization');
 const found=await writer.request(route+'StockTransfers?quickSearch=fractional');
 check('Product search returns scoped transfer matches',()=>{if(!found.text.includes(first))writeFileSync('tmp/stock-transfer-search-failure.html',found.text);assert(found.text.includes(first));assert(!found.text.includes('STFIX-FOREIGN-TRANSFER'));});
 for(const surface of ['apps','qapps']) {const result=await writer.request(`/${surface}/zenith/Inventory/StockTransfers?quickSearch=fractional&pageSize=1&lastStandalone=true&renderMode=${surface==='qapps'?'qvt':'html'}`);assert.equal(result.response.status,200);assert(result.text.includes('TransferListForm'),surface+' list payload');}
 // Rendering the enhanced list must honor the chosen primary sort and retain a stable tie-breaker.
 sql(`update stock_transfer set transfer_date='2099-01-01' where stock_transfer_id=${quote(first)}`);
 const sorted=await writer.request(route+'StockTransfers?pageSize=100&orderByField=-transferDate');
 const sortedTable=sorted.text.match(/<table[^>]*id="TransferListForm_table"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(sortedTable,'Rendered transfer table');
 const ids=[...sortedTable.matchAll(/href="[^"]*\/EditStockTransfer\?stockTransferId=([^"&]+)/g)].map(m=>m[1]);
 check('Date ordering remains primary with stable ID tie-breaker',()=>{assert(ids.length>1);assert(!sortedTable.includes('STFIX_FOREIGN'));assert.equal(ids[0],first);});
 const sortedNumber=await writer.request(route+'StockTransfers?pageSize=100&orderByField=transferNumber');
 const numberTable=sortedNumber.text.match(/<table[^>]*id="TransferListForm_table"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(numberTable,'Rendered transfer table');
 const numbers=[...numberTable.matchAll(/href="[^"]*\/EditStockTransfer\?stockTransferId=([^"&]+)/g)].map(m=>m[1]);
 check('Transfer-number ordering honors the requested direction',()=>assert.deepEqual(numbers,[...numbers].sort()));
 const multiSorted=await writer.request(route+'StockTransfers?pageSize=100&orderByField=transferDate&orderByField=transferNumber');
 const multiTable=multiSorted.text.match(/<table[^>]*id="TransferListForm_table"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(multiTable,'Rendered multi-sort table');
 const multiIds=[...new Set([...multiTable.matchAll(/href="[^"]*\/EditStockTransfer\?stockTransferId=([^"&]+)/g)].map(m=>m[1]))];
 const expectedIds=JSON.parse(sql("select json_agg(stock_transfer_id order by transfer_date,transfer_number,stock_transfer_id desc) from stock_transfer where organization_party_id='STFIX_ORG'"));
 check('Native multi-column sorting accepts repeated parameters',()=>assert.deepEqual(multiIds,expectedIds));
 check('Find Options retains the product quick search',()=>assert(/name="quickSearch"[^>]*value="fractional"/.test(found.text) || /value="fractional"[^>]*name="quickSearch"/.test(found.text)));
 const exported=await writer.request(route+'StockTransfers?quickSearch=fractional&renderMode=csv&pageNoLimit=true');
 check('CSV preserves product search and tenant scope',()=>{assert(exported.text.includes(first));assert(!exported.text.includes('STFIX-FOREIGN-TRANSFER'));});
 check('CSV has a clean eight-column header without page text or action menus',()=>{assert.equal(exported.text.split(/\r?\n/).find(line=>line.trim()),'Transfer #,Date,From,To,Value,E-Way,Status,E-Way Bill & Logistics');assert(!exported.text.includes('<form'));assert(!exported.text.includes('Move stock from'));});
 // Non-legal test markers exercise the existing inter-state branch; no provider is contacted.
 sql("update facility set facility_gstin='29-LOCAL-TEST',gst_state_code='29' where facility_id='STFIX_A'; update facility set facility_gstin='33-LOCAL-TEST',gst_state_code='33' where facility_id='STFIX_B';");
 const interstate=await create();await add(interstate,'0.5');await ship(interstate);
 check('Derived E-Way requirement blocks shipping without logistics',()=>{assert.equal(transfer(interstate).eway_bill_required,'Y');assert.equal(transfer(interstate).status_id,'StxDraft');assert.equal(balance('STFIX_P','STFIX_A'),3.5);});
 const dispatchDetails={stockTransferId:interstate,transporterGstin:'LOCAL-TEST-ONLY',vehicleNumber:'LOCAL-TEST-VAN'};
 await writer.post('StockTransfers','updateTransfer',dispatchDetails);
 await ship(interstate);
 await writer.post('EditStockTransfer','shipTransfer',{...dispatchDetails,ewayBillNumber:'not-an-ebn'});
 check('Logistics alone or a malformed EBN cannot dispatch stock',()=>{assert.equal(transfer(interstate).status_id,'StxDraft');assert.equal(transfer(interstate).eway_bill_number,null);assert.equal(balance('STFIX_P','STFIX_A'),3.5);});
 for(const [shell,suffix] of [['apps',''],['qapps','.qvt']]) {
  const page=await writer.request('/'+shell+'/zenith/Inventory/EditStockTransfer'+suffix+'?stockTransferId='+interstate);
  assert(page.text.includes('https://ewaybillgst.gov.in/') && page.text.includes('Confirm dispatch') && page.text.includes('LOCAL-TEST-VAN'));
 }
 // Local format-only fixture. No bill is issued or sent to a government service.
 const testEbn=String(created.indexOf(interstate)+1).padStart(12,'0');
 await writer.post('EditStockTransfer','shipTransfer',{stockTransferId:interstate,ewayBillNumber:testEbn});
 await ship(interstate);
 check('Dispatch records the supplied EBN and moves the goods once',()=>{assert.equal(transfer(interstate).eway_bill_number,testEbn);assert.equal(balance('STFIX_P','STFIX_A'),3);});
 check('Inter-state invoice remains scoped and unissued',()=>{const t=transfer(interstate);assert.equal(t.status_id,'StxInTransit');assert(t.igst_invoice_id);const invoice=row('invoice',`invoice_id=${quote(t.igst_invoice_id)}`);assert.equal(invoice.from_party_id,'STFIX_ORG');assert.equal(invoice.to_party_id,'STFIX_ORG');assert.equal(invoice.status_id,'InvoiceInProcess');assert.equal(count('invoice_item',`invoice_id=${quote(t.igst_invoice_id)}`),1);});
 const protectedDraft=await create();sql("insert into invoice (invoice_id,invoice_type_enum_id,status_id,from_party_id,to_party_id,invoice_date) values ('STFIX_ISSUED','InvoiceSales','InvoiceSent','STFIX_ORG','STFIX_ORG',CURRENT_TIMESTAMP);");
 sql(`update stock_transfer set igst_invoice_id='STFIX_ISSUED' where stock_transfer_id=${quote(protectedDraft)}`);
 await writer.post('StockTransfers','deleteTransfer',{stockTransferId:protectedDraft});
 check('Deleting a draft cannot cancel a linked issued invoice',()=>{assert(transfer(protectedDraft));assert.equal(row('invoice',"invoice_id='STFIX_ISSUED'").status_id,'InvoiceSent');});
 const manager=await session('stock.transfer.manager');
 const own=await manager.post('NewStockTransfer','createTransfer',{fromFacilityId:'STFIX_A',toFacilityId:'STFIX_B',ewayBillChoice:'N'});
 const managerId=new URL(own.response.headers.get('location'),base).searchParams.get('stockTransferId');
 check('Inventory manager can create within their organization',()=>assert.equal(transfer(managerId)?.organization_party_id,'STFIX_ORG'));created.push(managerId);
 const otherCount=count('stock_transfer',"organization_party_id='STFIX_OTHER'");
 await manager.request('/apps/setPreference',{preferenceKey:'ACTIVE_ORGANIZATION',preferenceValue:'STFIX_OTHER'});
 await manager.post('NewStockTransfer','createTransfer',{fromFacilityId:'STFIX_FOREIGN',toFacilityId:'STFIX_A',ewayBillChoice:'N'});
 check('Forged active organization cannot bypass membership',()=>assert.equal(count('stock_transfer',"organization_party_id='STFIX_OTHER'"),otherCount));
 console.log(JSON.stringify({passed:checks.length,created},null,2));
} finally {
 // Capture exact generated IDs before deleting disposable local fixtures. Keep an audit manifest.
 const fixtureAssets=JSON.parse(sql("select coalesce(json_agg(asset_id),'[]') from asset where owner_party_id in ('STFIX_ORG','STFIX_OTHER')"));
 const details=JSON.parse(sql(`select coalesce(json_agg(asset_detail_id),'[]') from asset_detail where asset_id in (${fixtureAssets.map(quote).join(',')})`));
 const history=JSON.parse(sql("select coalesce(json_agg(history_id),'[]') from serial_number_history where serial_number_id in ('STFIX_SN1','STFIX_SN2','STFIX_SN3')"));
 const invoices=JSON.parse(sql("select coalesce(json_agg(igst_invoice_id),'[]') from stock_transfer where organization_party_id in ('STFIX_ORG','STFIX_OTHER') and igst_invoice_id is not null"));
 const transferIds=JSON.parse(sql("select coalesce(json_agg(stock_transfer_id),'[]') from stock_transfer where organization_party_id in ('STFIX_ORG','STFIX_OTHER')"));
 const manifest={transferIds,fixtureAssets,details,history,invoices,checks};
 const cleanup=[];const del=(table,column,ids)=>{if(ids.length)cleanup.push(`delete from ${table} where ${column} in (${ids.map(quote).join(',')});`);};
 del('serial_number_history','history_id',history);del('stock_transfer_item_serial','stock_transfer_id',transferIds);del('stock_transfer_item','stock_transfer_id',transferIds);del('stock_transfer','stock_transfer_id',transferIds);
 del('invoice_item','invoice_id',invoices);del('invoice','invoice_id',invoices);del('product_serial_number','serial_number_id',['STFIX_SN1','STFIX_SN2','STFIX_SN3']);del('asset_detail','asset_detail_id',details);del('asset','asset_id',fixtureAssets);
 del('product','product_id',['STFIX_P','STFIX_BATCH','STFIX_SERIAL','STFIX_SERVICE','STFIX_FOREIGN']);del('facility','facility_id',['STFIX_A','STFIX_B','STFIX_FOREIGN']);
 for(const table of ['user_preference','user_group_member','user_account'])del(table,'user_id',['STFIX_USER','STFIX_VIEW','STFIX_NOORG','STFIX_MANAGER']);
 del('party_relationship','party_relationship_id',['STFIX_MEMBERSHIP']);
 for(const table of ['party_role','organization','party'])del(table,'party_id',['STFIX_ORG','STFIX_OTHER','STFIX_PERSON']);
 writeFileSync(process.env.STOCK_TRANSFER_MANIFEST || 'tmp/stock-transfer-audit.json',JSON.stringify(manifest,null,2));
 sql('BEGIN;'+cleanup.join('\n')+'COMMIT;');
 console.log('Disposable fixtures removed by captured IDs.');
}
