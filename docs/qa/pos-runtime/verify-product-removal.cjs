module.exports = async function ({a, foreign, base, check, q, invoke, post}) {
 const terminalId = 'POS_QA_REMOVE_PRODUCT';
 const categoryId = 'POS_QA_A_CAT';
 const productName = 'Disposable product removal check';
 const inventoryUrl = shell => `${base}/${shell}/zenith/Inventory`;
 const create = async (name, openingStock) => {
  const response = await a.c.request.post(inventoryUrl('apps') + '/FindProduct/createProduct', {
   form: {moquiSessionToken:a.t, productName:name, uqcEnumId:'NOS', mrpAmount:'10', productCategoryId:categoryId, openingStock},
   maxRedirects:0
  });
  const id = new URL(response.headers().location || '/', base).searchParams.get('productId');
  check('creates a disposable product through Inventory', response.status() === 302 && /^\d+$/.test(id || ''), {status:response.status()});
  return id;
 };
 const remove = (id, shell='apps', actor=a, token=true) => actor.c.request.post(inventoryUrl(shell) + '/EditProduct/deleteProduct', {
  form: {productId:id, ...(token ? {moquiSessionToken:actor.t} : {})}, maxRedirects:0
 });
 const product = id => q(`SELECT * FROM product WHERE product_id='${id}'`)[0];
 const details = id => q(`SELECT * FROM asset_detail WHERE product_id='${id}' ORDER BY asset_id, asset_detail_seq_id`);
 const onHand = id => Number(q(`SELECT coalesce(sum(quantity_on_hand_total),0) n FROM asset WHERE product_id='${id}'`)[0].n);
 const revision = () => q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='POS_CATALOG_REVISION'")[0]?.setting_value;
 const id = await create(productName, '1');
 const unused = await create(productName + ' unused', '0');
 const code = product(id).pseudo_id;
 const beforeBlocked = revision();
 await remove(unused, 'apps', foreign);
 await remove(unused, 'apps', a, false);
 check('foreign tenant and missing CSRF cannot remove a product', product(unused).sales_discontinuation_date == null);
 const blocked = await remove(id);
 const blockedLocation = new URL(blocked.headers().location || '/', base);
 check('a stocked product stays active and does not change the POS catalogue revision',
  blockedLocation.pathname.endsWith('/EditProduct') && onHand(id) === 1 &&
  product(id).sales_discontinuation_date == null && revision() === beforeBlocked, {location:blockedLocation.pathname});
 await a.p.goto(blockedLocation.href);
 check('Inventory explains that stock must be zero', (await a.p.locator('body').innerText()).includes('Current stock must be zero'));

 await post('PosTerminals','createTerminal',{terminalId, terminalName:'Disposable product removal terminal',
  facilityId:'POS_QA_A_FAC', organizationPartyId:'POS_QA_A', stateCode:'33', isActive:'Y'});
 const {sessionId} = await invoke('open',{terminalId, openingCash:'0'});
 const {transactionId} = await invoke('cart',{sessionId});
 await invoke('add',{transactionId, productId:id, quantity:'1', taxOn:'N', salesModeId:'RETAIL'});
 await invoke('pay',{transactionId, paymentMethod:'Cash', amount:'10'});
 await invoke('complete',{transactionId});
 const {invoiceId} = await invoke('sync',{transactionId});
 const receiptBefore = (await invoke('receipt',{transactionId})).receipt;
 const issuedRows = () => [
  q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${transactionId}'`),
  q(`SELECT * FROM invoice_item WHERE invoice_id='${invoiceId}'`), details(id)
 ];
 const history = issuedRows();
 check('sale reached zero stock with saved bill, invoice and stock history', onHand(id) === 0 &&
  Boolean(receiptBefore?.items?.length) && history.every(rows => rows.length > 0));

 const lookup = async () => (await a.c.request.get(base+'/apps/zenith/pos/Terminal/lookupProducts?'+new URLSearchParams({term:code}))).json();
 const menu = async () => (await post('Kitchen/KotBilling','searchMenu',{term:code, stockSessionId:sessionId})).json();
 check('active product is selectable by code on both tills',
  (await lookup()).some(p => p.productId === id) && (await menu()).products.some(p => p.id === id));
 const deleteFromScreen = async (productId, shell) => {
  await a.p.goto(inventoryUrl(shell) + '/EditProduct?productId=' + productId);
  const button = a.p.getByRole('button',{name:'Delete Product',exact:true});
  let prompt;
  a.p.once('dialog', dialog => { prompt = dialog.message(); return dialog.accept(); });
  await button.click();
  await a.p.locator('#productCatalog').waitFor();
  check(shell+' Delete Product removes the item from the active catalogue',
   prompt?.includes('Past bills and stock history are kept') && product(productId).sales_discontinuation_date != null);
 };
 await deleteFromScreen(id, 'apps');
 await deleteFromScreen(unused, 'qapps');
 for (const shell of ['apps','qapps']) {
  await a.p.goto(inventoryUrl(shell) + '/FindProduct?catalogSearch=' + encodeURIComponent(productName));
  await a.p.locator('#productCatalog').waitFor();
  check(shell+' product search excludes the retired products',
   !(await a.p.locator('#productCatalog').getByText(productName,{exact:true}).count()) &&
   !(await a.p.locator('#productCatalog').getByText(productName+' unused',{exact:true}).count()));
 }
 check('catalogue revision changes after removal', revision() !== beforeBlocked);
 const receiptAfter = (await invoke('receipt',{transactionId})).receipt;
 check('receipt, invoice lines and stock history are preserved',
  JSON.stringify(receiptBefore) === JSON.stringify(receiptAfter) && JSON.stringify(history) === JSON.stringify(issuedRows()));
 const kotMenu = await menu();
 check('retired product cannot be found by name or barcode at either till',
  !(await lookup()).some(p => p.productId === id) && kotMenu.exactId !== id && !kotMenu.products.some(p => p.id === id));
 const next = await invoke('cart',{sessionId});
 await invoke('add',{transactionId:next.transactionId, productId:unused, quantity:'1', taxOn:'N', salesModeId:'RETAIL'},true);
 check('a stale product ID cannot add a line to a new bill',
  q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${next.transactionId}'`).length === 0);
 await invoke('void',{transactionId:next.transactionId});
 await invoke('close',{sessionId, closingCash:'10'});
};
