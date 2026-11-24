// Local integration checks: import seed/stock-adjustment-local.sql and restart local Moqui first.
// Run with SMOKE_PASS set to the local demo password. No production hosts are accepted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const base=process.env.STOCK_ADJUSTMENT_URL || 'http://127.0.0.1:8082';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local verification only');
const database=process.env.STOCK_ADJUSTMENT_DATABASE || 'moqui_stock_adjustments_review';
assert(/^moqui_stock_adjustments_[a-z0-9_]+$/.test(database),'Dedicated disposable Stock Adjustments database required');
assert(process.env.SMOKE_PASS,'Set SMOKE_PASS to the existing local demo password');
const route='/apps/zenith/Inventory/';
const sql=statement => execFileSync('docker',['exec','zenith-erp-db-1','psql','-U','moqui','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8'}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const row=(table,where)=>JSON.parse(sql(`select row_to_json(t) from (select * from ${table} where ${where}) t`)||'null');
const adjustment=id=>row('stock_adjustment',`stock_adjustment_id=${quote(id)}`);
const line=(id,seq)=>row('stock_adjustment_item',`stock_adjustment_id=${quote(id)} and adjustment_item_seq_id=${quote(seq)}`);
const count=(table,where)=>Number(sql(`select count(*) from ${table} where ${where}`));
const balance=(product,facility,column='quantity_on_hand_total')=>Number(sql(`select coalesce(sum(${column}),0) from asset where product_id=${quote(product)} and facility_id=${quote(facility)} and owner_party_id='SAFIX_ORG' and asset_type_enum_id='AstTpInventory'`));
const created=[]; const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS',name);};
async function session(user='stock.adjustment.audit') {
 const auth='Basic '+Buffer.from(`${user}:${process.env.SMOKE_PASS}`).toString('base64');
 const jar=new Map(); let token;
 async function request(path,params,sendToken=true) {
  const body=params?new URLSearchParams():null;
  if(params) for(const [key,value] of Object.entries({...params,...(sendToken?{moquiSessionToken:token}:{})})) for(const item of Array.isArray(value)?value:[value]) body.append(key,String(item));
  const response=await fetch(base+path,{redirect:'manual',method:params?'POST':'GET',headers:{...(!jar.size ? {Authorization:auth}:{}),Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body});
  for(const entry of response.headers.getSetCookie()) {const [key,value]=entry.split(';')[0].split('=');jar.set(key,value);}
  const text=await response.text(); token=text.match(/name="moquiSessionToken" value="([^"]+)"/)?.[1] || text.match(/['"]moquiSessionToken['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] || token;
  assert(!/Template Error|Error rendering screen|Exception running actions|Error in screen|Error rendering.*form/i.test(text),'Rendering error: '+path);
  if (!params && response.status===302) {const redirect=new URL(response.headers.get('location'),base);return request(redirect.pathname+redirect.search);}
  return {response,text};
 }
 await request(route+'StockAdjustments'); assert(token,'Session token obtained');
 await request('/apps/setPreference',{preferenceKey:'ACTIVE_ORGANIZATION',preferenceValue:user==='stock.adjustment.noorg'?'_NA_':'SAFIX_ORG'});
 return {request,post:(page,tx,params)=>request(route+page+'/'+tx,params)};
}
const writer=await session();
async function create(params={}) {
 const before=count('stock_adjustment',"organization_party_id='SAFIX_ORG'");
 const result=await writer.post('StockAdjustments','createAdjustment',{facilityId:'SAFIX_A',adjustmentType:'PhysicalCount',remarks:'SAFIX audit',...params});
 const location=result.response.headers.get('location');
 const id=location && new URL(location,base).searchParams.get('stockAdjustmentId');
 if(id && adjustment(id)?.organization_party_id==='SAFIX_ORG' && count('stock_adjustment',"organization_party_id='SAFIX_ORG'")>before) {created.push(id);return id;}
 return null;
}
async function add(id,actualQuantity,params={}) {
 await writer.post('EditStockAdjustment','addItem',{stockAdjustmentId:id,productId:'SAFIX_P',actualQuantity,...params});
 const rows=JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (select adjustment_item_seq_id from stock_adjustment_item where stock_adjustment_id=${quote(id)} order by adjustment_item_seq_id) t`));
 return rows.at(-1)?.adjustment_item_seq_id;
}
const approve=(id,reason={shortageReasonCode:'CountDiscrepancy'})=>writer.post('StockAdjustments','approveAdjustment',{stockAdjustmentId:id,...reason});
const apply=id=>writer.post('EditStockAdjustment','applyAdjustment',{stockAdjustmentId:id});
const reopen=id=>writer.post('EditStockAdjustment','reopenAdjustment',{stockAdjustmentId:id});
const remove=(id,seq)=>writer.post('EditStockAdjustment','deleteItem',{stockAdjustmentId:id,adjustmentItemSeqId:seq});
try {
 const first=await create({organizationPartyId:'SAFIX_OTHER',statusId:'AdjApplied',adjustedBy:'SAFIX_VIEW'}); assert(first,'Create redirects to its generated ID');
 check('Creation uses active tenant, draft state and current actor',()=>{const a=adjustment(first);assert.equal(a.organization_party_id,'SAFIX_ORG');assert.equal(a.status_id,'AdjPending');assert.equal(a.adjusted_by,'SAFIX_USER');});
 for(const params of [{facilityId:'SAFIX_FOREIGN'},{facilityId:''},{adjustmentType:'invalid'}]) assert.equal(await create(params),null);
 check('Foreign or missing warehouse and invalid reason rejected',()=>{});
 await approve(first);await apply(first);
 check('Empty draft cannot approve or apply',()=>assert.equal(adjustment(first).status_id,'AdjPending'));
 for(const qty of ['-1','bad','','1.0000001']) await add(first,qty);
 await add(first,'1',{productId:'SAFIX_FOREIGN'});
 check('Invalid counts and foreign products cannot create lines',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(first)}`),0));
 let seq=await add(first,'7.5');assert(seq);
 check('System count sums inventory assets only at the selected warehouse',()=>{assert.equal(Number(line(first,seq).system_quantity),15);assert.equal(Number(line(first,seq).difference_quantity),-7.5);});
 await add(first,'4');check('Duplicate ordinary product count rejected',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(first)}`),1));
 await apply(first);check('Approval is required before stock posting',()=>assert.equal(balance('SAFIX_P','SAFIX_A'),15));
 for (const reason of [{}, {shortageReasonCode:'Unrecognized'}, {shortageReasonCode:'Other',shortageReasonNote:'   '}]) {
  await approve(first,reason);
  assert.equal(adjustment(first).status_id,'AdjPending');
 }
 check('Negative difference requires an allowed reason and an explanation for Others',()=>assert.equal(balance('SAFIX_P','SAFIX_A'),15));
 await writer.request('/qapps/zenith/Inventory/EditStockAdjustment/approveAdjustment',{
  stockAdjustmentId:first,shortageReasonCode:'Other',shortageReasonNote:'  Missing units after recount  '
 });
 check('Approval stores the chosen reason and trimmed explanation',()=>{
  const approved=adjustment(first);
  assert.equal(approved.shortage_reason_code,'Other');
  assert.equal(approved.shortage_reason_note,'Missing units after recount');
 });
 await remove(first,seq);await add(first,'9');
 check('Approved counts cannot be edited or deleted',()=>{assert.equal(adjustment(first).status_id,'AdjApproved');assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(first)}`),1);assert.equal(Number(line(first,seq).actual_quantity),7.5);});
 await Promise.all([apply(first),apply(first)]);
 check('Concurrent apply posts the approved decimal count once',()=>{assert.equal(adjustment(first).status_id,'AdjApplied');assert.equal(balance('SAFIX_P','SAFIX_A'),7.5);assert.equal(balance('SAFIX_P','SAFIX_A','available_to_promise_total'),5.5);});
 check('Ledger totals agree with physical and available stock',()=>{for(const asset of ['SAFIX_A1']) for(const [total,diff] of [['quantity_on_hand_total','quantity_on_hand_diff'],['available_to_promise_total','available_to_promise_diff']]) assert.equal(Number(sql(`select ${total} from asset where asset_id=${quote(asset)}`)),Number(sql(`select coalesce(sum(${diff}),0) from asset_detail where asset_id=${quote(asset)}`)));assert.equal(Number(sql(`select sum(quantity_on_hand_diff) from asset_detail where description like ${quote('Stock adjustment '+first+' (%)')}`)),-7.5);});
 await approve(first);await reopen(first);await remove(first,seq);await add(first,'10');await apply(first);
 check('Applied adjustments cannot be reapproved, reopened, edited or replayed',()=>{assert.equal(adjustment(first).status_id,'AdjApplied');assert.equal(balance('SAFIX_P','SAFIX_A'),7.5);assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(first)}`),1);});
 const reserved=await create();await add(reserved,'1');check('Count below reserved quantity rejected',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(reserved)}`),0));
 const stale=await create();const staleSeq=await add(stale,'8');await approve(stale);
 const fresh=await create();await add(fresh,'9');await approve(fresh);await apply(fresh);await apply(stale);
 check('Stale approved count cannot overwrite newer stock',()=>{assert.equal(adjustment(stale).status_id,'AdjApproved');assert.equal(balance('SAFIX_P','SAFIX_A'),9);});
 await reopen(stale);await remove(stale,staleSeq);const recount=await add(stale,'10');await approve(stale);await apply(stale);
 check('Reopen and recount recovers safely from stale counts',()=>{assert.equal(Number(line(stale,recount).system_quantity),9);assert.equal(balance('SAFIX_P','SAFIX_A'),10);});
 const reason=await create({adjustmentType:'Damage'});await add(reason,'11');check('Damage cannot increase stock',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(reason)}`),0));
 const zero=await create({facilityId:'SAFIX_B'});await add(zero,'0');await approve(zero);await writer.request('/qapps/zenith/Inventory/EditStockAdjustment/applyAdjustment',{stockAdjustmentId:zero});
 check('Explicit zero count removes stock once on qapps transition',()=>assert.equal(balance('SAFIX_P','SAFIX_B'),0));
 const batch=await create();await add(batch,'5',{productId:'SAFIX_BATCH'});await add(batch,'5',{productId:'SAFIX_BATCH',assetId:'SAFIX_A1'});
 check('Batch count requires the owned product and exact existing lot',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(batch)}`),0));
 await add(batch,'5',{productId:'SAFIX_BATCH',assetId:'SAFIX_BATCH1'});await approve(batch);await apply(batch);
 check('Batch count preserves lot, expiry and valuation',()=>{const a=row('asset',"asset_id='SAFIX_BATCH1'");assert.equal(Number(a.quantity_on_hand_total),5);assert.equal(a.batch_number,'SAFIX-LOT');assert.equal(a.expiry_date,'2027-03-01');assert.equal(Number(a.valuation_rate),4);});
 const serial=await create();await add(serial,'2',{productId:'SAFIX_SERIAL'});await add(serial,'1.5',{productId:'SAFIX_SERIAL',countedSerialNumbers:'SAFIX-SN-3'});await add(serial,'2',{productId:'SAFIX_SERIAL',countedSerialNumbers:'SAFIX-SN-1\nSAFIX-SN-2'});
 check('Serial quantities require identities, whole units and reserved inclusion',()=>assert.equal(count('stock_adjustment_item',`stock_adjustment_id=${quote(serial)}`),0));
 await add(serial,'2',{productId:'SAFIX_SERIAL',countedSerialNumbers:'SAFIX-SN-1\nSAFIX-SN-3'});await approve(serial);await apply(serial);
 check('Omitted unreserved serial is written off with audited identity',()=>{assert.equal(balance('SAFIX_SERIAL','SAFIX_A'),2);assert.equal(balance('SAFIX_SERIAL','SAFIX_A','available_to_promise_total'),1);assert.equal(row('product_serial_number',"serial_number_id='SAFIX_SN2'").status_id,'SnScrapped');assert.equal(row('product_serial_number',"serial_number_id='SAFIX_SN3'").status_id,'SnReserved');assert.equal(count('serial_number_history',`reference_id=${quote(serial)}`),1);});
 const restock=await create();await add(restock,'3',{productId:'SAFIX_SERIAL',countedSerialNumbers:'SAFIX-SN-1\nSAFIX-SN-3\nSAFIX-SN-4'});await approve(restock);await apply(restock);
 check('Only identified registered returned serials are restocked',()=>{assert.equal(balance('SAFIX_SERIAL','SAFIX_A'),3);assert.equal(row('product_serial_number',"serial_number_id='SAFIX_SN4'").status_id,'SnInStock');});
 const newstock=await create({adjustmentType:'Opening'});await add(newstock,'2.25',{productId:'SAFIX_NEW'});await approve(newstock,{});await apply(newstock);
 check('Opening count creates a usable inventory asset and posts once',()=>{assert.equal(balance('SAFIX_NEW','SAFIX_A'),2.25);assert.equal(balance('SAFIX_NEW','SAFIX_A','available_to_promise_total'),2.25);assert.equal(row('asset',"product_id='SAFIX_NEW'").status_id,'AstAvailable');});
 const atomic=await create();await add(atomic,'11');await add(atomic,'4',{productId:'SAFIX_BATCH',assetId:'SAFIX_BATCH1'});await approve(atomic);
 sql("update asset set quantity_on_hand_total=6,available_to_promise_total=6 where asset_id='SAFIX_BATCH1'");await apply(atomic);
 check('A stale line rolls back the entire adjustment',()=>{assert.equal(adjustment(atomic).status_id,'AdjApproved');assert.equal(balance('SAFIX_P','SAFIX_A'),10);assert.equal(balance('SAFIX_BATCH','SAFIX_A'),6);});
 const staleSerial=await create();await add(staleSerial,'2',{productId:'SAFIX_SERIAL',countedSerialNumbers:'SAFIX-SN-1\nSAFIX-SN-3'});await approve(staleSerial);
 sql("update product_serial_number set status_id='SnReserved' where serial_number_id='SAFIX_SN1'");await apply(staleSerial);
 check('Serial state changes invalidate previously approved identities',()=>{assert.equal(adjustment(staleSerial).status_id,'AdjApproved');assert.equal(balance('SAFIX_SERIAL','SAFIX_A'),3);});
 const requestCount=count('stock_adjustment',"organization_party_id='SAFIX_ORG'");
 await writer.request(route+'StockAdjustments/createAdjustment');
 await writer.request(route+'StockAdjustments/createAdjustment?facilityId=SAFIX_A&adjustmentType=Opening');
 await writer.request(route+'StockAdjustments/createAdjustment',{facilityId:'SAFIX_A',adjustmentType:'Opening'},false);
 check('GET writes and missing CSRF tokens cannot create adjustments',()=>assert.equal(count('stock_adjustment',"organization_party_id='SAFIX_ORG'"),requestCount));
 const named=await create({newFacilityId:'SAFIX_B',newAdjustmentType:'Opening',facilityId:'SAFIX_A',adjustmentType:'Damage'});
 check('Native create fields override unrelated filter context and return the detail ID',()=>{assert(named);assert.equal(adjustment(named).facility_id,'SAFIX_B');assert.equal(adjustment(named).adjustment_type,'Opening');});
 const viewer=await session('stock.adjustment.viewer');const before=count('stock_adjustment',"organization_party_id='SAFIX_ORG'");await viewer.post('StockAdjustments','createAdjustment',{facilityId:'SAFIX_A',adjustmentType:'Opening'});await viewer.post('StockAdjustments','approveAdjustment',{stockAdjustmentId:reserved});
 check('View-only users cannot create or approve',()=>{assert.equal(count('stock_adjustment',"organization_party_id='SAFIX_ORG'"),before);assert.equal(adjustment(reserved).status_id,'AdjPending');});
 await approve('SAFIX_FOREIGN');await add('SAFIX_FOREIGN','1');
 const foreign=await writer.request(route+'EditStockAdjustment?stockAdjustmentId=SAFIX_FOREIGN');
 check('Foreign adjustments remain inaccessible even to admin',()=>{assert.equal(adjustment('SAFIX_FOREIGN').status_id,'AdjPending');assert(!foreign.text.includes('Foreign adjustment marker'));});
 const noorg=await session('stock.adjustment.noorg');const empty=await noorg.request(route+'StockAdjustments');
 check('No selected organization exposes no warehouses or adjustments',()=>{assert(!empty.text.includes('Foreign adjustment marker'));assert(!empty.text.includes('Adjustment audit sender'));assert(!empty.text.includes(first));});
 const manager=await session('stock.adjustment.manager');await manager.request('/apps/setPreference',{preferenceKey:'ACTIVE_ORGANIZATION',preferenceValue:'SAFIX_OTHER'});await manager.post('StockAdjustments','createAdjustment',{facilityId:'SAFIX_FOREIGN',adjustmentType:'Opening'});
 check('Forged active tenant cannot bypass organization membership',()=>assert.equal(count('stock_adjustment',"organization_party_id='SAFIX_OTHER'"),1));
 for(const surface of ['apps','qapps']) {const page=await writer.request(`/${surface}/zenith/Inventory/StockAdjustments?pageSize=1&lastStandalone=true&renderMode=${surface==='qapps'?'qvt':'html'}`);assert.equal(page.response.status,200);assert(page.text.includes('AdjListForm'));const detail=await writer.request(`/${surface}/zenith/Inventory/EditStockAdjustment?stockAdjustmentId=${first}&lastStandalone=true&renderMode=${surface==='qapps'?'qvt':'html'}`);assert.equal(detail.response.status,200);assert(detail.text.includes('Products in this adjustment'));}
 check('List and detail render on both apps and qapps',()=>{});
 const filtered=await writer.request(route+'StockAdjustments?stockAdjustmentId='+first+'&stockAdjustmentId_op=equals&pageSize=1');
 const table=filtered.text.match(/<table[^>]*id="AdjListForm_table"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(table);
 check('ID filtering and paging use tenant-scoped native results',()=>{assert(table.includes(first));assert(!table.includes(zero));assert(!table.includes('SAFIX_FOREIGN'));});
 const sorted=await writer.request(route+'StockAdjustments?orderByField=adjustmentDate&orderByField=adjustmentType&pageSize=100');
 const sortedTable=sorted.text.match(/<table[^>]*id="AdjListForm_table"[^>]*>([\s\S]*?)<\/table>/)?.[1];assert(sortedTable);
 const actual=[...sortedTable.matchAll(/href="[^"]*\/EditStockAdjustment\?stockAdjustmentId=([^"&]+)/g)].map(m=>m[1]);
 const expected=JSON.parse(sql("select json_agg(stock_adjustment_id order by adjustment_date,adjustment_type,stock_adjustment_id desc) from stock_adjustment where organization_party_id='SAFIX_ORG'"));
 check('Multi-column sorting keeps a stable ID tie-breaker',()=>assert.deepEqual(actual,expected));
 const dialog=await writer.request(route+'StockAdjustments?adjustmentType=Opening');
 check('Create dialog fields do not reuse list filter values',()=>{assert(dialog.text.includes('name="newAdjustmentType"'));assert(dialog.text.includes('name="newFacilityId"'));});

 console.log(JSON.stringify({passed:checks.length,created},null,2));
} finally {
 const ids=JSON.parse(sql("select coalesce(json_agg(stock_adjustment_id),'[]') from stock_adjustment where organization_party_id in ('SAFIX_ORG','SAFIX_OTHER')"));
 const assets=JSON.parse(sql("select coalesce(json_agg(asset_id),'[]') from asset where owner_party_id in ('SAFIX_ORG','SAFIX_OTHER')"));
 const details=JSON.parse(sql(`select coalesce(json_agg(asset_detail_id),'[]') from asset_detail where asset_id in (${assets.map(quote).join(',')})`));
 const history=JSON.parse(sql("select coalesce(json_agg(history_id),'[]') from serial_number_history where serial_number_id in ('SAFIX_SN1','SAFIX_SN2','SAFIX_SN3','SAFIX_SN4')"));
 const cleanup=[];const del=(table,column,values)=>{if(values.length)cleanup.push(`delete from ${table} where ${column} in (${values.map(quote).join(',')});`);};
 del('stock_adjustment_item','stock_adjustment_id',ids);del('stock_adjustment','stock_adjustment_id',ids);del('serial_number_history','history_id',history);
 del('product_serial_number','serial_number_id',['SAFIX_SN1','SAFIX_SN2','SAFIX_SN3','SAFIX_SN4']);del('asset_detail','asset_detail_id',details);del('asset','asset_id',assets);
 del('product','product_id',['SAFIX_P','SAFIX_BATCH','SAFIX_SERIAL','SAFIX_NEW','SAFIX_FOREIGN']);del('facility','facility_id',['SAFIX_A','SAFIX_B','SAFIX_FOREIGN']);
 for(const table of ['user_preference','user_group_member','user_account'])del(table,'user_id',['SAFIX_USER','SAFIX_VIEW','SAFIX_NOORG','SAFIX_MANAGER']);
 del('party_relationship','party_relationship_id',['SAFIX_MEMBERSHIP']);for(const table of ['party_role','organization','party'])del(table,'party_id',['SAFIX_ORG','SAFIX_OTHER','SAFIX_PERSON']);
 writeFileSync(process.env.STOCK_ADJUSTMENT_MANIFEST || 'tmp/stock-adjustment-audit.json',JSON.stringify({ids,assets,details,history,checks},null,2));
 sql('BEGIN;'+cleanup.join('\n')+'COMMIT;');
 assert.equal(count('stock_adjustment',"organization_party_id in ('SAFIX_ORG','SAFIX_OTHER')"),0);assert.equal(count('asset',"owner_party_id in ('SAFIX_ORG','SAFIX_OTHER')"),0);assert.equal(count('party',"party_id in ('SAFIX_ORG','SAFIX_OTHER','SAFIX_PERSON')"),0);
 console.log('Disposable fixtures removed by captured IDs; zero residue verified.');
}
