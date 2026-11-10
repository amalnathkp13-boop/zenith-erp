// Synthetic loopback fixture only. Keep real definitions, prices and issued bills intact.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({a,foreign,base,check,q,invoke,post,out,sessionId,account}) => {
 assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
 const removed = () => q("SELECT * FROM pos_sales_mode_org_removal WHERE organization_party_id='POS_QA_A' AND sales_mode_id='EMPLOYEE'").length;
 const history = q("SELECT transaction_id,status_id,transaction_number,payable_amount FROM pos_transaction WHERE status_id='PtCompleted' ORDER BY transaction_id");
 const prices = q("SELECT * FROM pos_product_mode_price WHERE sales_mode_id='EMPLOYEE' ORDER BY product_id");
 const shared = q("SELECT * FROM pos_sales_mode WHERE sales_mode_id='EMPLOYEE'");
 const cashier = await account('pos.cashier.qa');
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE'},cashier);
 check('cashier cannot delete an organization mode',removed()===0);await cashier.c.close();
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE'},a,false);
 check('CSRF-less Delete leaves the mode unchanged',removed()===0);
 await a.c.request.get(base+'/apps/zenith/pos/SalesMode/deleteMode?salesModeId=EMPLOYEE');
 check('GET cannot delete a shared mode',removed()===0);
 // Other workspaces may already have an explicitly configured owned default.
 const retailRemovals = () => q("SELECT * FROM pos_sales_mode_org_removal WHERE sales_mode_id='RETAIL' ORDER BY organization_party_id");
 const retailBefore = retailRemovals();
 await post('SalesMode','deleteMode',{salesModeId:'RETAIL'});
 assert.deepEqual(retailRemovals(),retailBefore);
 check('default Retail cannot be deleted',q("SELECT is_active FROM pos_sales_mode WHERE sales_mode_id='RETAIL'")[0].is_active==='Y');
 const cart = await invoke('cart',{sessionId});
 await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P18',salesModeId:'EMPLOYEE',quantity:'1',taxOn:'N'});
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE'});
 check('shared mode used on an open mixed cart cannot be deleted',removed()===0);
 const held = await invoke('hold',{transactionId:cart.transactionId});
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE'});
 check('shared mode used on a held mixed cart cannot be deleted',removed()===0);
 await invoke('recall',{heldId:held.heldId,sessionId});await invoke('void',{transactionId:cart.transactionId});
 for (const shell of ['apps','qapps']) {
  // Use separate owned definitions so the real Delete is exercised on both renderers.
  const name='Disposable delete '+shell,code='QADEL'+shell.toUpperCase();
  await post('SalesMode','createMode',{modeName:name,modeCode:code,priceSource:'PpsMrp'});
  const id=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id='POS_QA_A' AND mode_code='${code}'`)[0].sales_mode_id;
  await post('SalesMode','deleteMode',{salesModeId:id},foreign);
  check(shell+' foreign organization cannot delete an owned definition',q(`SELECT is_active FROM pos_sales_mode WHERE sales_mode_id='${id}'`)[0].is_active==='Y');
  const p=await a.c.newPage();await p.goto(`${base}/${shell}/zenith/pos/SalesMode`,{waitUntil:'networkidle'});
  const legacyName='Disposable unconfigured legacy';
  let options;
  if (shell==='apps') {
   options=await p.locator('.smode-assign select[name=salesModeId] option').allTextContents();
  } else {
   await p.locator('.smode-assign .q-select').nth(1).click();
   await p.getByRole('option',{name:'Retail',exact:true}).waitFor();
   options=await p.getByRole('option').allTextContents();
   await p.keyboard.press('Escape');
  }
  check(shell+' hides unconfigured shared modes from cards and terminal assignments',
   options.some(text=>text.trim()==='Retail')&&options.some(text=>text.trim()==='Wholesale')&&
   !options.some(text=>text.trim()===legacyName)&&await p.locator('.smode-tile').filter({hasText:legacyName}).count()===0);
  let card=p.locator('.smode-tile').filter({hasText:name});
  await card.locator('.smode-menu summary').click();
  await card.locator('.smode-menu').getByRole('button',{name:'Remove from selected shops',exact:true}).click();
  const picker=card.locator('.smode-shop-dialog');
  await picker.locator('[name=facilityIds][value="POS_QA_A_FAC"]').check();
  await picker.getByRole('button',{name:'Remove from selected shops',exact:true}).click();await p.waitForLoadState('networkidle');
  check(shell+' selected-shop removal remains separate from Delete',q(`SELECT * FROM pos_sales_mode_shop WHERE sales_mode_id='${id}' AND facility_id='POS_QA_A_FAC'`).length===1&&await card.count()===1);
  p.once('dialog',d=>d.dismiss());await card.getByRole('button',{name:'Delete '+name,exact:true}).click();
  check(shell+' cancelling Delete keeps the whole card',await card.count()===1&&q(`SELECT is_active FROM pos_sales_mode WHERE sales_mode_id='${id}'`)[0].is_active==='Y');
  p.once('dialog',d=>d.accept());await card.getByRole('button',{name:'Delete '+name,exact:true}).click();await p.waitForLoadState('networkidle');
  check(shell+' Delete removes the entire card and icon',await p.locator('.smode-tile').filter({hasText:name}).count()===0);
  await post('SalesMode','updateMode',{salesModeId:id,modeName:name,modeCode:code,priceSource:'PpsMrp',isActive:'Y'});
  check(shell+' stale edit cannot resurrect a deleted mode',q(`SELECT is_active FROM pos_sales_mode WHERE sales_mode_id='${id}'`)[0].is_active==='N');
  check(shell+' archived mode absent from assignment and rule options',await p.locator(`option[value="${id}"]`).count()===0);
  await p.reload({waitUntil:'networkidle'});
  check(shell+' deleted mode stays absent after reload',await p.locator('.smode-tile').filter({hasText:name}).count()===0);
  await p.screenshot({path:path.join(out,shell+'-deleted-mode-card.png'),fullPage:true});await p.close();
 }
 // Delete of a shared mode is organization-wide, not a shared-row update or a shop exclusion.
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE',organizationPartyId:'POS_QA_B'});
 check('Delete scopes shared removal to the authenticated organization',removed()===1&&q("SELECT * FROM pos_sales_mode_org_removal WHERE organization_party_id='POS_QA_B'").length===0);
 for (const shell of ['apps','qapps']) {
  const p=await a.c.newPage();await p.goto(`${base}/${shell}/zenith/pos/SalesMode`,{waitUntil:'networkidle'});
  check(shell+' shared Delete removes its full card and all management entries',await p.locator('.smode-tile').filter({hasText:'Employee'}).count()===0&&await p.locator('option[value="EMPLOYEE"]').count()===0&&!(await p.locator('#smode-removed-shops').allTextContents()).join('').includes('Employee'));
  await p.close();
 }
 const b=await foreign.c.request.get(base+'/apps/zenith/pos/SalesMode');
 check('another organization still sees the shared mode',(await b.text()).includes('Employee'));
 assert.deepEqual(q("SELECT * FROM pos_sales_mode WHERE sales_mode_id='EMPLOYEE'"),shared);
 assert.deepEqual(q("SELECT * FROM pos_product_mode_price WHERE sales_mode_id='EMPLOYEE' ORDER BY product_id"),prices);
 assert.deepEqual(q("SELECT transaction_id,status_id,transaction_number,payable_amount FROM pos_transaction WHERE status_id='PtCompleted' ORDER BY transaction_id"),history);
 check('deleting a mode preserves shared definitions, prices and issued bills',true);
 await post('SalesMode','deleteMode',{salesModeId:'EMPLOYEE'});check('repeated Delete is idempotent',removed()===1);
 await post('SalesMode','restoreForShop',{salesModeId:'EMPLOYEE',facilityId:'POS_QA_A_FAC'});
 check('shop Restore cannot resurrect an organization-deleted mode',removed()===1);
 const newTerminal='POS_QA_DELETE_FUTURE';
 await post('PosTerminals','createTerminal',{terminalId:newTerminal,terminalName:'Disposable after mode deletion',facilityId:'POS_QA_A_FAC2',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const s=await invoke('open',{terminalId:newTerminal,openingCash:'0'});
 const p=await a.c.newPage();await p.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${s.sessionId}`,{waitUntil:'networkidle'});
 check('new terminals in other shops also exclude the deleted mode',await p.locator('.nb-modes__item').filter({hasText:'Employee'}).count()===0);await p.close();
 const fresh=await invoke('cart',{sessionId:s.sessionId});
 await invoke('add',{transactionId:fresh.transactionId,productId:'POS_QA_A_P18',salesModeId:'EMPLOYEE',quantity:'1',unitPrice:'80',taxOn:'N'},true);
 check('forged manual-price add cannot reuse the deleted mode',q(`SELECT item_seq_id FROM pos_transaction_item WHERE transaction_id='${fresh.transactionId}'`).length===0);
 await invoke('void',{transactionId:fresh.transactionId});await invoke('close',{sessionId:s.sessionId,closingCash:'0'});
};
