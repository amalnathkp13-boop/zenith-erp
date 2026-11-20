const openAudit=require('./client.cjs');
(async()=>{
 const x=await openAudit(),{a,b,admin,q,quote,check}=x;
 const org='AUDIT_QA_A',product='AUDIT_QA_PRODUCT_A',from='AUDIT_QA_FAC_A',to='AUDIT_QA_FAC_A2';
 const count=(table,where)=>Number(q(`SELECT count(*) n FROM ${table} WHERE ${where}`)[0].n);
 const stock=(p=product,f=null)=>Number(q(`SELECT coalesce(sum(quantity_on_hand_total),0) n FROM asset WHERE product_id=${quote(p)} AND owner_party_id=${quote(org)}${f?' AND facility_id='+quote(f):''}`)[0].n);
 const record=(table,idField,id)=>q(`SELECT * FROM ${table} WHERE ${idField}=${quote(id)}`)[0];
 const pass=async(name,op,input)=>{const r=await a.invoke(op,input);check(name,r.httpStatus===200&&!r.errors.length,{response:r});return r.result||{};};
 const unchanged=()=>JSON.stringify(q('SELECT asset_id,quantity_on_hand_total,available_to_promise_total,owner_party_id FROM asset ORDER BY asset_id'));
 const reject=async(name,op,input)=>{const before=unchanged();const r=await a.invoke(op,input);check(name,r.errors.length>0&&!r.errors.some(e=>/Non-JSON|SQL statement|Exception/.test(e))&&unchanged()===before,{response:r});};
 try{
  const initial=JSON.stringify(q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id'));
  const receipt=await pass('Inventory: direct receipt creates one owned stock lot','receipt.create',{productId:product,facilityId:from,quantityAccepted:'10',valuationRate:'8.25'});
  check('Inventory: received QOH and ledger agree',stock()===10&&Number(record('asset','asset_id',receipt.assetId)?.valuation_rate)===8.25);
  for(const quantityAccepted of ['0','-1','bad'])await reject('Inventory: rejects receipt quantity '+quantityAccepted,'receipt.create',{productId:product,facilityId:from,quantityAccepted});
  await reject('Inventory: rejects foreign receipt facility','receipt.create',{productId:product,facilityId:'AUDIT_QA_FAC_B',quantityAccepted:'1'});
  await reject('Inventory: rejects foreign receipt product','receipt.create',{productId:'AUDIT_QA_PRODUCT_B',facilityId:from,quantityAccepted:'1'});
  await reject('Inventory: batch receipt requires a lot number','receipt.create',{productId:'AUDIT_QA_BATCH',facilityId:from,quantityAccepted:'1'});
  await reject('Inventory: batch expiry cannot precede manufacturing','receipt.create',{productId:'AUDIT_QA_BATCH',facilityId:from,quantityAccepted:'1',batchNumber:'AUDITLOT',manufacturingDate:'2026-10-20',expiryDate:'2026-10-19'});
  await pass('Inventory: valid batch receipt preserves lot dates','receipt.create',{productId:'AUDIT_QA_BATCH',facilityId:from,quantityAccepted:'5',batchNumber:'AUDITLOT',manufacturingDate:'2026-10-20',expiryDate:'2027-10-20',valuationRate:'3'});
  check('Inventory: failed receipts preserve existing stock',stock()===10&&stock('AUDIT_QA_BATCH')===5);
  await reject('Transfers: same warehouse rejected','transfer.create',{ewayBillChoice:'N',fromFacilityId:from,toFacilityId:from});
  await reject('Transfers: foreign destination rejected','transfer.create',{ewayBillChoice:'N',fromFacilityId:from,toFacilityId:'AUDIT_QA_FAC_B'});
  const st=await pass('Transfers: own draft persisted','transfer.create',{ewayBillChoice:'N',fromFacilityId:from,toFacilityId:to,organizationPartyId:'AUDIT_QA_B',statusId:'StxReceived'});
  const id=st.stockTransferId;
  if(id){
   check('Transfers: forged owner and status ignored',record('stock_transfer','stock_transfer_id',id)?.organization_party_id===org&&record('stock_transfer','stock_transfer_id',id)?.status_id==='StxDraft');
   await reject('Transfers: empty draft cannot ship','transfer.ship',{stockTransferId:id});
   for(const quantity of ['0','-1'])await reject('Transfers: rejects line quantity '+quantity,'transfer.add',{stockTransferId:id,productId:product,quantity});
   await reject('Transfers: foreign product rejected','transfer.add',{stockTransferId:id,productId:'AUDIT_QA_PRODUCT_B',quantity:'1'});
   await pass('Transfers: valid line persists','transfer.add',{stockTransferId:id,productId:product,quantity:'3',unitAmount:'8.25'});
   await pass('Transfers: shipping debits sender once','transfer.ship',{stockTransferId:id});
   check('Transfers: in-transit state and sender balance agree',record('stock_transfer','stock_transfer_id',id)?.status_id==='StxInTransit'&&stock(product,from)===7&&stock(product,to)===0);
   await reject('Transfers: repeat shipment cannot debit stock twice','transfer.ship',{stockTransferId:id});
   await reject('Transfers: shipped lines cannot be changed','transfer.add',{stockTransferId:id,productId:product,quantity:'1'});
   const foreign=await b.invoke('transfer.receive',{stockTransferId:id});check('Transfers: foreign receiver rejected',foreign.errors.length>0&&stock(product,to)===0);
   await pass('Transfers: receipt credits destination','transfer.receive',{stockTransferId:id});
   check('Transfers: total physical stock conserved',stock()===10&&stock(product,to)===3&&record('stock_transfer','stock_transfer_id',id)?.status_id==='StxReceived');
   await reject('Transfers: repeated receipt cannot duplicate stock','transfer.receive',{stockTransferId:id});
   check('Transfers: repeat operations preserve balances',stock()===10&&stock(product,from)===7&&stock(product,to)===3);
  }
  const over=await pass('Transfers: separate oversell draft can be reviewed','transfer.create',{ewayBillChoice:'N',fromFacilityId:from,toFacilityId:to});
  if(over.stockTransferId){
   await pass('Transfers: pending large line persists before shipment','transfer.add',{stockTransferId:over.stockTransferId,productId:product,quantity:'100'});
   await reject('Transfers: insufficient stock cannot ship','transfer.ship',{stockTransferId:over.stockTransferId});
   check('Transfers: insufficient stock leaves draft and balances intact',stock()===10&&record('stock_transfer','stock_transfer_id',over.stockTransferId)?.status_id==='StxDraft');
  }
  const adj=await pass('Stock adjustment: physical count draft persists','adjustment.create',{facilityId:from,adjustmentType:'PhysicalCount'});
  if(adj.stockAdjustmentId){
   await reject('Stock adjustment: cannot apply before approval','adjustment.apply',{stockAdjustmentId:adj.stockAdjustmentId});
   await reject('Stock adjustment: negative count rejected','adjustment.add',{stockAdjustmentId:adj.stockAdjustmentId,productId:product,actualQuantity:'-1'});
   await pass('Stock adjustment: count line persists','adjustment.add',{stockAdjustmentId:adj.stockAdjustmentId,productId:product,actualQuantity:'6'});
   await pass('Stock adjustment: valid count can be approved','adjustment.approve',{stockAdjustmentId:adj.stockAdjustmentId});
   await pass('Stock adjustment: approved count applied','adjustment.apply',{stockAdjustmentId:adj.stockAdjustmentId});
   check('Stock adjustment: only counted warehouse changed',stock(product,from)===6&&stock(product,to)===3);
   await reject('Stock adjustment: repeat apply rejected','adjustment.apply',{stockAdjustmentId:adj.stockAdjustmentId});
   check('Stock adjustment: repeat leaves stock intact',stock()===9);
  }
  await reject('Serials: ordinary product cannot register serial','serial.register',{productId:product,facilityId:from,serialNumber:'AUDIT-ORDINARY'});
  const serial=await pass('Serials: registration persists own serial','serial.register',{productId:'AUDIT_QA_SERIAL',facilityId:from,serialNumber:'AUDIT-SERIAL-1'});
  await reject('Serials: duplicate registration rejected','serial.register',{productId:'AUDIT_QA_SERIAL',facilityId:from,serialNumber:'AUDIT-SERIAL-1'});
  await reject('Serials: foreign warehouse rejected','serial.register',{productId:'AUDIT_QA_SERIAL',facilityId:'AUDIT_QA_FAC_B',serialNumber:'AUDIT-FOREIGN'});
  if(serial.serialNumberId)await reject('Serials: sale status cannot bypass billing workflow','serial.status',{serialNumberId:serial.serialNumberId,statusId:'SnSold',expectedStatusId:'SnInStock'});
  const catalogue=await pass('Catalogue: own category created','catalogue.create',{categoryName:'Disposable audit catalogue'});
  if(catalogue.productCategoryId){
   await pass('Catalogue: own product can be added','catalogue.add',{productCategoryId:catalogue.productCategoryId,productId:product});
   await reject('Catalogue: foreign product rejected','catalogue.add',{productCategoryId:catalogue.productCategoryId,productId:'AUDIT_QA_PRODUCT_B'});
   await pass('Catalogue: product membership can be removed','catalogue.remove',{productCategoryId:catalogue.productCategoryId,productId:product});
  }
  const gateInput={passTypeEnumId:'GptNrgp',facilityId:from,partyId:'AUDIT_QA_CUST_A',issueDate:'2026-10-20 10:00',vehicleNumber:'AUDIT VEHICLE'};
  const before=count('gate_pass',"organization_party_id='AUDIT_QA_A'");await a.post('Inventory/GatePasses/createGatePass',gateInput);
  check('Gate passes: valid secure form creates own pass',count('gate_pass',"organization_party_id='AUDIT_QA_A'")===before+1);
  const invalidBefore=count('gate_pass',"organization_party_id='AUDIT_QA_A'");await a.post('Inventory/GatePasses/createGatePass',{...gateInput,issueDate:'2026-02-30 10:00'});
  check('Gate passes: impossible date rejected without a pass',count('gate_pass',"organization_party_id='AUDIT_QA_A'")===invalidBefore);
  await a.post('Inventory/GatePasses/createGatePass',gateInput,false);
  check('Gate passes: missing CSRF leaves records unchanged',count('gate_pass',"organization_party_id='AUDIT_QA_A'")===invalidBefore);
  const foreignBefore=count('gate_pass',"organization_party_id='AUDIT_QA_B'");await a.scope('AUDIT_QA_B');
  await a.post('Inventory/GatePasses/createGatePass',{...gateInput,facilityId:'AUDIT_QA_FAC_B',partyId:'AUDIT_QA_CUST_B'});
  check('Gate passes: forged non-member preference cannot create foreign pass',count('gate_pass',"organization_party_id='AUDIT_QA_B'")===foreignBefore);
  const foreignStockBefore=JSON.stringify(q("SELECT asset_id,quantity_on_hand_total FROM asset WHERE owner_party_id='AUDIT_QA_B' ORDER BY asset_id"));
  await a.scope('AUDIT_QA_B');
  await a.post('Inventory/FindReceipt/receiveDirectStock',{productId:'AUDIT_QA_PRODUCT_B',facilityId:'AUDIT_QA_FAC_B',quantityDiff:'2',valuationRate:'1'});
  check('Receiving: forged non-member preference cannot add foreign stock',JSON.stringify(q("SELECT asset_id,quantity_on_hand_total FROM asset WHERE owner_party_id='AUDIT_QA_B' ORDER BY asset_id"))===foreignStockBefore);
  await a.scope('AUDIT_QA_A');
  check('Inventory audit leaves existing financial invoices unchanged',JSON.stringify(q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id'))===initial);
 }catch(error){check('Inventory workflow execution',false,{error:error.stack});}
 finally{await x.finish('inventory-'+(process.env.AUDIT_QA_MODE||'baseline')+'.json');}
})().catch(error=>{console.error(error);process.exitCode=1;});
