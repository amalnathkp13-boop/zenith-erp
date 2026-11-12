module.exports = async function ({a, base, check, q, invoke, post}) {
 const suffix = Date.now().toString(36);
 const name = 'Unpriced QA item ' + suffix;
 const response = await a.c.request.post(base + '/apps/zenith/Inventory/FindProduct/createProduct', {
  form:{moquiSessionToken:a.t, productName:name, uqcEnumId:'NOS', productCategoryId:'POS_QA_A_CAT'},
  maxRedirects:0
 });
 const productId = new URL(response.headers().location || '/', base).searchParams.get('productId');
 check('Inventory creates a product with no price', /^\d+$/.test(productId || '') &&
  q(`SELECT mrp_amount FROM product WHERE product_id='${productId}'`)[0].mrp_amount == null);
 const terminalId = 'POS_QA_PRICE_' + suffix;
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable missing price till',
  facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const {sessionId} = await invoke('open',{terminalId,openingCash:'0'});
 const pos = a.p;
 await pos.goto(base + '/apps/zenith/pos/Terminal?sessionId=' + sessionId + '&salesModeId=RETAIL&taxOn=N');
 const search = pos.locator('#cartInlineSearch');
 await search.fill(name);
 const match = pos.locator('#cartSearchDropdown .cart-dd-item, #cartSearchDropdown .cart-dd-blocked').filter({hasText:name});
 await match.waitFor();
 check('POS makes an unpriced product selectable at ₹0', await match.evaluate(el =>
  el.classList.contains('cart-dd-item') && el.textContent.includes('₹0')));
 await match.click();
 const rate = pos.locator('.aj-p').first();
 await rate.waitFor();
 const lines = () => q(`SELECT transaction_id, unit_price FROM pos_transaction_item WHERE product_id='${productId}'`);
 await pos.waitForFunction(() => !!document.querySelector('.aj-p') && !document.querySelector('.aj-p').dataset.seq.startsWith('t#'));
 const transactionId = lines()[0].transaction_id;
 check('POS keeps a ₹0 line while the cashier enters its rate', Number(lines()[0].unit_price) === 0);
 await invoke('pay',{transactionId,paymentMethod:'Cash',amount:'1'},true);
 await invoke('complete',{transactionId},true);
 const freeState = await (await post('Terminal','freeItemState',{transactionId})).json();
 const approval = await (await post('Terminal','approveFreeItems',{transactionId,expectedFingerprint:freeState.approvalFingerprint,
  reason:'Disposable approval check'})).json();
 check('POS blocks tender and completion for the missing rate',
  freeState.missingPrice && !approval.success && /Enter a price/.test(approval.error) &&
  q(`SELECT payment_id FROM pos_payment WHERE transaction_id='${transactionId}'`).length === 0 &&
  q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${transactionId}'`)[0].status_id === 'PtCreated');
 const updated = pos.waitForResponse(r => r.url().endsWith('/ajaxCart') && r.request().postData()?.includes('action=updatePrice'));
 await rate.fill('25');
 await rate.press('Enter');
 check('POS saves the manually entered rate on the cart only',
  (await (await updated).json()).success && Number(lines()[0].unit_price) === 25);
 await invoke('pay',{transactionId,paymentMethod:'Cash',amount:'25'});
 await invoke('complete',{transactionId});

 const screen = '../kot/KotBilling';
 const quote = async item => (await post(screen,'cartReceipt',{sessionId,itemsJson:JSON.stringify([item]),
  orderType:'Take Away',salesModeId:'RETAIL',taxOn:'N'})).json();
 const item = {productId,quantity:1};
 const pending = await quote(item);
 check('KOT quotes an editable ₹0 placeholder', pending.success && pending.receipt.items[0].pricePending &&
  Number(pending.receipt.items[0].rate) === 0, {error:pending.error});
 const saveDraft = async (entry, existingDraftId) => (await post(screen,'saveDraft',{sessionId,itemsJson:JSON.stringify([entry]),
  orderType:'Take Away',salesModeId:'RETAIL',taxOn:'N',wantJson:'Y',existingDraftId})).json();
 const held = await saveDraft(item, '');
 check('KOT can hold an order while a rate is missing', held.success && Number(held.total) === 0, {error:held.error});
 const tooSoon = await (await post(screen,'checkoutKot',{sessionId,kotId:held.kotId,paymentMethod:'Cash',cashAmount:'1'})).json();
 const print = await (await post(screen,'printRecord',{sessionId,kotId:held.kotId,kind:'orderBill'})).json();
 check('KOT refuses to bill or print an unresolved held order', !tooSoon.success && /Enter a price/.test(tooSoon.error) &&
  !print.success && /Enter a price/.test(print.error));
 const kotContext = await a.c.browser().newContext({storageState:await a.c.storageState()});
 const kot = await kotContext.newPage();
 try {
  await kot.goto(base + '/apps/zenith/kot/KotBilling?sessionId=' + sessionId);
  await kot.locator('#kb-wrap[data-ready=true]').waitFor();
  await kot.locator('[data-ot="Take Away"]').click();
  const kotSearch = kot.locator('#kb-search');
  await kotSearch.fill(name);
  await kot.locator('#kb-suggestions [data-result]').filter({hasText:name}).click();
  const kotRate = kot.getByRole('textbox',{name:'Rate for ' + name});
  await kotRate.waitFor();
  await kot.getByText('Enter a price above ₹0 for ' + name + ' before payment.',{exact:true}).waitFor();
  check('KOT blocks payment with a visible instruction to enter a rate',
   Number(await kotRate.inputValue()) === 0 && await kot.locator('#kb-bill').isDisabled() &&
   /enter a price/i.test(await kot.locator('#kb-quote-error').innerText()));
  await kotRate.fill('30');
  await kotRate.press('Enter');
  await kot.waitForFunction(() => !document.getElementById('kb-bill').disabled);
  const draft = await saveDraft({...item,unitPrice:30,manualPrice:'Y'},held.kotId);
  check('KOT saves a draft with the entered rate', draft.success && Number(draft.total) === 30, {error:draft.error});
  const sale = await (await post(screen,'checkoutKot',{sessionId,kotId:draft.kotId,paymentMethod:'Cash',cashAmount:'30',confirmedTotal:'30'})).json();
  check('KOT bills the entered rate without changing the catalogue', sale.success &&
   q(`SELECT mrp_amount FROM product WHERE product_id='${productId}'`)[0].mrp_amount == null, {error:sale.error});

  await kot.reload();
  await kot.locator('#kb-wrap[data-offline-ready=true]').waitFor();
  await kotContext.setOffline(true);
  await kot.locator('#kb-online.is-offline').waitFor();
  await kot.locator('[data-ot="Take Away"]').click();
  const tax = kot.getByRole('switch',{name:'Tax'});
  if (await tax.getAttribute('aria-checked') === 'true') await tax.click();
  await kotSearch.fill(name);
  await kot.locator('#kb-suggestions [data-result]').filter({hasText:name}).click();
  await kot.getByText('Enter a price above ₹0 for ' + name + ' before payment.',{exact:true}).waitFor();
  check('Cached KOT product also stays at ₹0 with checkout blocked',
   Number(await kotRate.inputValue()) === 0 && await kot.locator('#kb-bill').isDisabled());
  await kotRate.fill('35');
  await kotRate.press('Enter');
  await kot.locator('#kb-bill').click();
  await kot.locator('#kb-payment input[name=cashAmount]:visible').fill('35');
  await kot.locator('#kb-payment .pos-cash-confirm').click();
  await kot.locator('#kb-print-choice').waitFor();
  const synced = kot.waitForResponse(r => r.url().endsWith('/syncOfflineSale'));
  await kotContext.setOffline(false);
  check('KOT syncs the price entered offline', (await (await synced).json()).success);
 } finally {
  await kotContext.close();
 }

 await pos.goto(base + '/apps/zenith/pos/Terminal?sessionId=' + sessionId + '&salesModeId=RETAIL&taxOn=N&freshSale=Y');
 await pos.waitForFunction(id => document.querySelector('#cartInlineSearch')?.dataset.posSearchBound &&
  window._posOffline?.lookup(id), productId);
 try {
  await a.c.setOffline(true);
  await pos.locator('#pos-offline-banner').waitFor();
  check('POS starts the offline test with an empty editable cart',
   await pos.locator('.ofl-price').count() === 0 && !await pos.evaluate(() => window._posOffline.paused()));
  await search.fill(name);
  await match.waitFor();
  check('Offline POS search shows the missing rate as ₹0', (await match.innerText()).includes('₹0'));
  await match.click();
  const offlineRate = pos.locator('.ofl-price');
  await offlineRate.waitFor();
  await pos.locator('#pos-pay-cash').click();
  check('Cached POS product is editable at ₹0 and cannot be checked out at that rate',
   Number(await offlineRate.inputValue()) === 0 && await pos.locator('#oflReceived').count() === 0);
  await offlineRate.fill('40');
  await pos.locator('#pos-pay-cash').click();
  await pos.locator('#oflConfirmPayment').click();
  await pos.getByRole('dialog',{name:'Sale saved on this device'}).waitFor();
  const queued = (await pos.evaluate(() => window._posOffline.getQueue()))[0];
  check('POS queues the offline sale with the cashier rate',
   queued?.items[0].productId === productId && Number(queued.items[0].price) === 40);
  await pos.locator('#posOfflineDialog .ofl-cancel').click();
  const syncResponse = pos.waitForResponse(r => r.url().endsWith('/syncOfflineTransactions'));
  await a.c.setOffline(false);
  const sync = await (await syncResponse).json();
  await pos.waitForFunction(async () => !(await window._posOffline.getQueue()).length);
  check('POS syncs the price entered offline and leaves the catalogue price blank',
   sync.syncedIds?.includes(queued.offlineId) && lines().some(line => Number(line.unit_price) === 40) &&
   q(`SELECT mrp_amount FROM product WHERE product_id='${productId}'`)[0].mrp_amount == null);
 } finally {
  await a.c.setOffline(false);
 }
 await invoke('close',{sessionId,closingCash:'130'});
};
