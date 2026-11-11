// Disposable KOT browser and transition checks. Runs only from verify-runtime.cjs.
module.exports = async function verifyKot({a,foreign,base,post,rows,count,check}) {
 const kotSessionId=await require('./kot-test-session.cjs')({a,base});
 const rawPost=post; post=(screen,action,args={},actor)=>rawPost(screen,action,screen==='Kitchen/KotBilling'?{sessionId:kotSessionId,...args}:args,actor);

  const kotRows = () => rows('kitchen_order_ticket', "organization_party_id='POS_QA_A'");
  const before = new Set(kotRows().map(row => row.kot_id));
  const valid = {productId:'POS_QA_A_P18',productName:'Forged menu label',quantity:1};
  for (const payload of [
    'not a list', [], [{...valid,quantity:0}], [{...valid,quantity:-1}],
    [{...valid,quantity:'oops'}], [{...valid,productId:'POS_QA_B_P18'}],
    [{...valid,productId:'MISSING'}], [null]
  ]) {
    for (const action of ['createKot','saveDraft']) {
      await post('Kitchen/KotBilling',action,{itemsJson:JSON.stringify(payload)});
      check(action+' rejects invalid item '+JSON.stringify(payload),kotRows().length===before.size);
    }
  }

  const xss='<img src=x onerror=window.posQaXss=1>';
  const created=await post('Kitchen/KotBilling','createKot',{
    itemsJson:JSON.stringify([{...valid,specialInstructions:xss}]),notes:xss,tableNumber:xss
  });
  const ticket=kotRows().find(row=>!before.has(row.kot_id));
  const ticketItem=ticket&&rows('kot_item',`kot_id='${ticket.kot_id}'`)[0];
  check('KOT stores only an owned product and its canonical name',created.status()<400&&ticket?.status_id==='KotNew'&&ticketItem?.product_name==='Disposable POS A P18'&&Number(ticketItem.quantity)===1,{status:created.status(),ticket,item:ticketItem});
  const kitchen=await a.c.newPage();
  await kitchen.goto(base+'/apps/zenith/pos/Kitchen/KitchenDisplay',{waitUntil:'networkidle'});
  check('Kitchen treats notes, table labels and instructions as text',
    (await kitchen.locator('body').innerText()).includes(xss)&&!await kitchen.evaluate(()=>window.posQaXss));
  await kitchen.close();
  for (const shell of ['apps','qapps']) {
    const old=await a.c.request.get(`${base}/${shell}/zenith/pos/KitchenOrders`);
    const html=await old.text();
    check(shell+' legacy Kitchen Orders renders without a screen error',old.status()===200&&!/Error rendering|ScreenRenderException|HTTP Status 500/.test(html),{status:old.status()});
  }
  await a.c.request.get(`${base}/apps/zenith/pos/KitchenOrders/updateKotStatus?kotId=${ticket.kot_id}&statusId=KotPreparing`,{maxRedirects:0});
  check('legacy GET status link cannot change a kitchen order',rows('kitchen_order_ticket',`kot_id='${ticket.kot_id}'`)[0].status_id==='KotNew');
  const foreignPrint=await post('Kitchen/KotBilling','reprintKot',{kotId:ticket.kot_id},foreign);
  let printDenied=foreignPrint.status()===403;
  if (foreignPrint.status()===200) {
    try { printDenied=!(await foreignPrint.json()).success; } catch (_) { printDenied=false; }
  }
  check('another shop cannot increase the KOT print count',
    printDenied&&Number(rows('kitchen_order_ticket',`kot_id='${ticket.kot_id}'`)[0].print_count)===0,{status:foreignPrint.status()});
  const printPage=await a.c.newPage();
  await printPage.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+kotSessionId,{waitUntil:'networkidle'});
  await printPage.locator('#kb-wrap[data-ready=true]').waitFor();
  await printPage.evaluate(()=>{
    window.__printedHtml='';window.__printCalls=0;
    window.open=()=>({document:{open:()=>{},write:s=>{window.__printedHtml+=s},close:()=>{},images:[]},
      focus:()=>{},print:()=>{window.__printCalls++},close:()=>{}});
  });
  await printPage.locator('#kb-history-open').click();
  const printRow=printPage.locator(`#kb-history-rows [data-kot-id="${ticket.kot_id}"]`);
  await printRow.getByRole('button',{name:'KOT Print',exact:true}).click();
  await printPage.locator('#kb-history-print-status').filter({hasText:'Print request opened.'}).waitFor();
  await printPage.waitForFunction(()=>window.__printedHtml.includes('Disposable POS A P18'));
  check('Print on an existing KOT records one shop-owned reprint and opens the slip',
    Number(rows('kitchen_order_ticket',`kot_id='${ticket.kot_id}'`)[0].print_count)===1&&
    await printPage.evaluate(()=>window.__printedHtml.includes('<td>Disposable POS A P18</td>')&&!window.__printedHtml.includes('KOT #')));
  await printPage.close();

  const ownTable='POS_QA_KOT_A_TABLE_'+Date.now().toString(36);
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_B_FAC',tableNumber:ownTable,seatingCapacity:'4'});
  check('KOT table creation rejects another shops facility',count('restaurant_table',`table_number='${ownTable}'`)===0);
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_A_FAC',tableNumber:ownTable,seatingCapacity:'0'});
  check('KOT table creation rejects zero seats',count('restaurant_table',`table_number='${ownTable}'`)===0);
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_A_FAC',tableNumber:ownTable,seatingCapacity:'4',assignedWaiterId:'forged',statusId:'TblOccupied'});
  check('KOT table creation sets safe defaults and ignores forged assignment',count('restaurant_table',`table_number='${ownTable}' AND facility_id='POS_QA_A_FAC' AND status_id='TblAvailable' AND assigned_waiter_id IS NULL`)===1);
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_A_FAC',tableNumber:ownTable,seatingCapacity:'4'});
  check('KOT table creation rejects duplicate number in a facility',count('restaurant_table',`table_number='${ownTable}' AND facility_id='POS_QA_A_FAC'`)===1);
  const ownTableId=rows('restaurant_table',`table_number='${ownTable}' AND facility_id='POS_QA_A_FAC'`)[0].table_id;
  await post('Kitchen/Tables','updateTableStatus',{tableId:ownTableId,statusId:'TblOccupied'},foreign);
  check('another shop cannot change this table',count('restaurant_table',`table_id='${ownTableId}' AND status_id='TblAvailable'`)===1);
  await post('Kitchen/Tables','updateTableStatus',{tableId:ownTableId,statusId:'TblOccupied'});
  check('table status change persists for its shop',count('restaurant_table',`table_id='${ownTableId}' AND status_id='TblOccupied'`)===1);
  await post('Kitchen/Tables','closeTable',{tableId:ownTableId});
  check('closing a table releases it',count('restaurant_table',`table_id='${ownTableId}' AND status_id='TblAvailable'`)===1);
  const foreignTable='POS_QA_KOT_B_TABLE';
  await post('Kitchen/Tables','createTable',{facilityId:'POS_QA_B_FAC',tableNumber:foreignTable,seatingCapacity:'2'},foreign);
  const menu=await a.c.newPage();
  await menu.goto(base+'/apps/zenith/pos/Kitchen/KotBilling?sessionId='+kotSessionId,{waitUntil:'networkidle'});
  await menu.locator('#kb-wrap[data-ready=true]').waitFor();
  check('KOT removes the table picker from the billing toolbar',await menu.locator('#kb-table-field').count()===0&&await menu.locator('#kb-table').isHidden());
  await menu.locator('.kg-modes summary').click();
  await menu.locator('[data-kb-sales-mode="RETAIL"]').click();
  await menu.locator('#kb-search').fill('POS_QA_A_P18');await menu.locator('#kb-search').press('Enter');
  await menu.locator('#kb-instr').fill('No onion');
  await Promise.all([menu.waitForNavigation({waitUntil:'networkidle'}),menu.locator('#kb-draft').click()]);
  const draft=kotRows().find(row=>!before.has(row.kot_id)&&row.status_id==='KotDraft');
  check('Save as Draft browser action persists one draft',!!draft&&count('kot_item',`kot_id='${draft.kot_id}'`)===1,{draft});
  const foreignDraft=await foreign.c.newPage();
  const deniedDraft=await foreignDraft.goto(base+`/apps/zenith/pos/Kitchen/KotBilling?sessionId=${kotSessionId}&loadDraft=${draft.kot_id}`,{waitUntil:'networkidle'});
  check('another shop cannot load the draft cart',deniedDraft.status()===403&&await foreignDraft.locator('#kb-data').count()===0);
  await foreignDraft.close();
  await menu.goto(base+`/apps/zenith/pos/Kitchen/KotBilling?sessionId=${kotSessionId}&loadDraft=${draft.kot_id}`,{waitUntil:'networkidle'});
  await menu.locator('#kb-wrap[data-ready=true]').waitFor();
  check('Load Draft restores the browser cart',await menu.locator('#kb-badge').innerText()==='Editing Held Order'&&await menu.locator('#kb-cart').innerText().then(x=>x.includes('Disposable POS A P18')));
  await menu.locator('#kb-send').click();
  await menu.locator('#kb-order-status').filter({hasText:'sent to the kitchen'}).waitFor();
  const sent=kotRows().find(row=>!before.has(row.kot_id)&&row.status_id==='KotNew'&&row.kot_id!==ticket.kot_id);
  check('Send to Kitchen replaces the draft and keeps ticket numbers unique',!!sent&&count('kitchen_order_ticket',`kot_id='${draft.kot_id}'`)===0&&sent.kot_number!==ticket.kot_number&&count('kot_item',`kot_id='${sent.kot_id}'`)===1,{sent});
  await menu.close();

  await post('Kitchen/WaiterManagement','createWaiter',{waiterName:'QA KOT waiter',phone:'+91 0000000000',isActive:'Y',organizationPartyId:'POS_QA_B'});
  const waiter=rows('waiter',"waiter_name='QA KOT waiter'")[0];
  check('waiter creation binds to active shop despite forged owner',waiter?.organization_party_id==='POS_QA_A',{waiter});
  await post('Kitchen/WaiterManagement','updateWaiter',{waiterId:waiter.waiter_id,waiterName:'QA KOT waiter edited',phone:'+91 0000000001',isActive:'Y',organizationPartyId:'POS_QA_B'});
  check('waiter edit cannot move ownership',count('waiter',`waiter_id='${waiter.waiter_id}' AND organization_party_id='POS_QA_A' AND waiter_name='QA KOT waiter edited'`)===1);
  await post('Kitchen/WaiterManagement','updateWaiter',{waiterId:waiter.waiter_id,waiterName:'Foreign edit',phone:'0',isActive:'Y'},foreign);
  await post('Kitchen/WaiterManagement','deleteWaiter',{waiterId:waiter.waiter_id},foreign);
  check('another shop cannot edit or delete the waiter',count('waiter',`waiter_id='${waiter.waiter_id}' AND waiter_name='QA KOT waiter edited'`)===1);
  const waiters=await a.c.newPage();
  await waiters.goto(base+'/qapps/zenith/pos/Kitchen/WaiterManagement',{waitUntil:'networkidle'});
  check('Waiter page shows the own waiter without foreign table data',await waiters.locator('body').innerText().then(x=>x.includes('QA KOT waiter edited')&&!x.includes(foreignTable)));
  await waiters.close();
  await post('Kitchen/WaiterManagement','deleteWaiter',{waiterId:waiter.waiter_id});
  check('authorized waiter delete persists',count('waiter',`waiter_id='${waiter.waiter_id}'`)===0);
};
