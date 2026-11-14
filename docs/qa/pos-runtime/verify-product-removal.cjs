const { randomUUID } = require('node:crypto');

module.exports = async function ({a, foreign, base, check, q, invoke, post}) {
 const terminalId = 'POS_QA_REMOVE_PRODUCT';
 const categoryId = 'POS_QA_A_CAT';
 const productName = 'Disposable product removal check';
 const inventoryUrl = shell => `${base}/${shell}/zenith/Inventory`;
 const submitProduct = (name, openingStock, pseudoId='', shell='apps') =>
  a.c.request.post(inventoryUrl(shell) + '/FindProduct/createProduct', {
   form: {moquiSessionToken:a.t, productName:name, uqcEnumId:'NOS', mrpAmount:'10', productCategoryId:categoryId, openingStock, pseudoId},
   maxRedirects:0
  });
 const create = async (name, openingStock, pseudoId='', shell='apps') => {
  const response = await submitProduct(name, openingStock, pseudoId, shell);
  const id = new URL(response.headers().location || '/', base).searchParams.get('productId');
  check('creates a disposable product through Inventory', response.status() === 302 && /^\d+$/.test(id || ''), {status:response.status()});
  return id;
 };
 const remove = (id, shell='apps', actor=a, token=true) => actor.c.request.post(inventoryUrl(shell) + '/EditProduct/deleteProduct', {
  form: {productId:id, ...(token ? {moquiSessionToken:actor.t} : {})}, maxRedirects:0
 });
 const deleteFromScreen = async (productId, shell) => {
  await a.p.goto(inventoryUrl(shell) + '/EditProduct?productId=' + productId);
  await a.p.locator('#productEditor[data-bound="true"]').waitFor();
  let prompt;
  a.p.once('dialog', dialog => { prompt = dialog.message(); return dialog.accept(); });
  const [response] = await Promise.all([
   a.p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/EditProduct/deleteProduct')),
   a.p.getByRole('button',{name:'Delete Product',exact:true}).click()
  ]);
  check('Delete Product explains that past bills and stock history are kept',
   prompt?.includes('Past bills and stock history are kept'));
  check(shell+' Delete Product returns a structured result',
   response.headers()['content-type']?.includes('application/json'), {status:response.status()});
  return response;
 };
 const product = id => q(`SELECT * FROM product WHERE product_id='${id}'`)[0];
 const details = id => q(`SELECT * FROM asset_detail WHERE product_id='${id}'`).map(row => JSON.stringify(row)).sort();
 const onHand = id => Number(q(`SELECT coalesce(sum(quantity_on_hand_total),0) n FROM asset WHERE product_id='${id}'`)[0].n);
 const revision = () => q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='POS_CATALOG_REVISION'")[0]?.setting_value;
 const code = '00QA-'+randomUUID().slice(0,8);
 const id = await create(productName, '1', code);
 const unused = await create(productName + ' unused', '0');
 const barcodes = productId => q(`SELECT * FROM product_barcode WHERE product_id='${productId}' ORDER BY barcode_id`);
 const oldBarcodes = barcodes(id);
 await submitProduct(productName+' duplicate', '0', code);
 check('the current product reserves its code', oldBarcodes.some(row => row.barcode_value === code) &&
  q(`SELECT product_id FROM product WHERE owner_party_id='POS_QA_A' AND pseudo_id='${code}'`).length === 1);
 const beforeBlocked = revision();
 await remove(unused, 'apps', foreign);
 await remove(unused, 'apps', a, false);
 check('foreign tenant and missing CSRF cannot remove a product', product(unused).sales_discontinuation_date == null);
 const stockWarning = 'Current stock must be zero in every shop and lot before removing this product.';
 for (const shell of ['apps','qapps']) {
  const response = await deleteFromScreen(id, shell);
  const result = await response.json();
  const location = new URL(a.p.url()).pathname;
  const warning = a.p.locator('#productEditor [data-pe-status][data-error="true"]');
  await warning.waitFor();
  check(shell+' a stocked product stays active and does not change the POS catalogue revision',
   !response.ok() && result.errors.includes(stockWarning) && await warning.textContent() === stockWarning &&
   location.endsWith('/EditProduct') &&
   onHand(id) === 1 && product(id).sales_discontinuation_date == null && revision() === beforeBlocked, {location});
 }

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

 const lookup = async term => {
  const response = await post('Terminal','lookupProducts',{term, sessionId, salesModeId:'RETAIL'});
  check('POS product lookup responds successfully', response.ok(), {status:response.status()});
  return response.json();
 };
 const menu = async term => {
  const response = await post('Kitchen/KotBilling','searchMenu',{term, stockSessionId:sessionId, salesModeId:'RETAIL'});
  const result = await response.json().catch(() => null);
  check('KOT menu lookup responds successfully', response.ok() && result?.success, {status:response.status()});
  return result;
 };
 check('active product is selectable by code on both tills',
  (await lookup(code)).some(p => p.productId === id) && (await menu(code)).products.some(p => p.id === id));
 for (const [productId, shell] of [[id,'apps'],[unused,'qapps']]) {
  const response = await deleteFromScreen(productId, shell);
  await a.p.locator('#productCatalog').waitFor();
  const location = new URL(a.p.url()).pathname;
  check(shell+' Delete Product removes the item from the active catalogue',
   response.ok() && location.endsWith('/FindProduct') && product(productId).sales_discontinuation_date != null, {location});
 }
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
 for (const term of [productName, code]) {
  const kotMenu = await menu(term);
  check('retired product cannot be found by name or code at either till',
   !(await lookup(term)).some(p => p.productId === id) && kotMenu.exactId !== id && !kotMenu.products.some(p => p.id === id), {term});
 }
 const replies = await Promise.all([
  submitProduct('Replacement item code A', '0', code),
  submitProduct('Replacement item code B', '0', code, 'qapps')
 ]);
 const replacements = replies.map(response => new URL(response.headers().location || '/',base).searchParams.get('productId')).filter(Boolean);
 check('only one concurrent create can reuse the freed item code', replacements.length === 1, {statuses:replies.map(r => r.status())});
 const replacement = replacements[0];
 const kotMenu = await menu(code);
 const scannedCart = await invoke('cart',{sessionId});
 const scan = await post('Terminal','ajaxCart',{action:'scanAdd',cartSearch:code,sessionId,transactionId:scannedCart.transactionId,taxOn:'N',salesModeId:'RETAIL'});
 check('the reused code resolves to the replacement at both tills', scan.ok() &&
  q(`SELECT product_id FROM pos_transaction_item WHERE transaction_id='${scannedCart.transactionId}'`).map(row => row.product_id).join() === replacement &&
  (await lookup(code)).filter(p => p.productId === replacement || p.productId === id).map(p => p.productId).join() === replacement &&
  kotMenu.exactId === replacement && !kotMenu.products.some(p => p.id === id));
 await invoke('void',{transactionId:scannedCart.transactionId});
 check('reusing the code preserves the original product, barcode and issued history',
  product(id).pseudo_id === code && product(replacement).pseudo_id === code && oldBarcodes.length > 0 &&
  JSON.stringify(barcodes(id)) === JSON.stringify(oldBarcodes) && barcodes(replacement).some(row => row.barcode_value === code) &&
  JSON.stringify(receiptBefore) === JSON.stringify((await invoke('receipt',{transactionId})).receipt) &&
  JSON.stringify(history) === JSON.stringify(issuedRows()));
 await remove(replacement);
 const editTarget = await create('Existing replacement product', '0');
 const edited = await a.c.request.post(inventoryUrl('qapps') + '/EditProduct/updateProduct', {
  form:{moquiSessionToken:a.t,productId:editTarget,pseudoId:code},maxRedirects:0
 });
 check('editing an existing product can also reuse the code after the replacement is removed',
  edited.status() === 302 && product(editTarget).pseudo_id === code && barcodes(editTarget).some(row => row.barcode_value === code));
 const imported = await invoke('importProduct',{sku:code,productName:'Imported replacement product',listPrice:'10'});
 check('importing a reused code updates only the current product', imported.productId === editTarget && product(id).product_name === productName);
 const next = await invoke('cart',{sessionId});
 await invoke('add',{transactionId:next.transactionId, productId:unused, quantity:'1', taxOn:'N', salesModeId:'RETAIL'},true);
 check('a stale product ID cannot add a line to a new bill',
  q(`SELECT * FROM pos_transaction_item WHERE transaction_id='${next.transactionId}'`).length === 0);
 await invoke('void',{transactionId:next.transactionId});
 await invoke('close',{sessionId, closingCash:'10'});
};
