const { randomUUID } = require('node:crypto');
const path = require('node:path');

module.exports = async ({a, base, check, invoke, post, q, out}) => {
  const terminalId = 'POS_QA_LIVE_PRICE_'+randomUUID().slice(0,8);
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable live pricing',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
  const session = await invoke('open', {terminalId, openingCash:'0'});
  const page = await a.c.newPage();
  let transactionId;
  const originalPrice = q("SELECT price FROM pos_product_mode_price WHERE product_id='POS_QA_A_P18' AND sales_mode_id='WHOLESALE'")[0]?.price;
  const updateModePrice = async (id, price) => {
    const response = await a.c.request.post(base+'/apps/zenith/Inventory/EditProduct/updateProduct', {
      maxRedirects:0, form:{productId:id, modePricesJson:JSON.stringify({WHOLESALE:price==null ? null : Number(price).toFixed(2)}), moquiSessionToken:a.t}
    });
    check('inventory change saves the Wholesale rate for '+id, response.status()===302 &&
      response.headers().location?.includes('productSaved=Y'));
  };
  const rates = () => q(`SELECT product_id, unit_price FROM pos_transaction_item WHERE transaction_id='${transactionId}'`);
  const payments = () => q(`SELECT amount FROM pos_payment WHERE transaction_id='${transactionId}'`);
  const search = page.locator('#cartInlineSearch');
  const result = id => page.locator(`#cartSearchDropdown .cart-dd-item[data-pid="${id}"]`);
  const rate = id => page.locator(`.pos-cart tr[data-pos-product="${id}"] .aj-p`);
  const waitForRate = (id, expected) => page.waitForFunction(([id, expected]) =>
    document.querySelector(`.pos-cart tr[data-pos-product="${id}"] .aj-p`)?.value===expected,[id, String(expected)]);
  const pick = async id => {
    await search.fill(id);
    const saved = page.waitForResponse(r => r.url().endsWith('/ajaxCart') &&
      new URLSearchParams(r.request().postData()).get('action')==='addItem');
    await result(id).click();
    return (await saved).json();
  };
  try {
    const loaded = page.waitForResponse(r => r.url().endsWith('/catalogRevision'));
    await page.goto(base+`/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&salesModeId=WHOLESALE&taxOn=N`);
    check('the open terminal obtains a revision from the server', (await (await loaded).json()).success);
    await search.fill('POS_QA_A_P18');
    await result('POS_QA_A_P18').filter({hasText:String(Number(originalPrice ?? 100))}).waitFor();
    await updateModePrice('POS_QA_A_P18',105);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await result('POS_QA_A_P18').filter({hasText:'105'}).waitFor();
    await page.locator('.pos-product-grid input[name=unitPrice][value="105"]').waitFor({state:'attached'});
    check('the same open search and grid refresh to the current Wholesale rate',
      (await result('POS_QA_A_P18').locator('.dd-price').innerText()).trim()==='105');
    transactionId = (await pick('POS_QA_A_P18')).transactionId;
    check('the selected Wholesale override reaches the saved draft', !!transactionId &&
      Number(rates().find(row => row.product_id==='POS_QA_A_P18')?.unit_price)===105);
    await pick('POS_QA_A_P5');
    const manual = page.waitForResponse(r => r.url().endsWith('/ajaxCart') &&
      new URLSearchParams(r.request().postData()).get('action')==='updatePrice');
    await rate('POS_QA_A_P5').fill('87');
    await manual;
    await page.locator('#pos-pay-card').click();
    const confirm = page.locator('#posPayConfirmOverlay');
    await confirm.waitFor();
    await updateModePrice('POS_QA_A_P18',112);
    const review = page.getByRole('alert').filter({hasText:'Product prices changed'});
    await confirm.locator('#posPayConfOk').click();
    await review.waitFor();
    check('a price change during confirmation requires review and writes no tender',
      await review.isVisible() && payments().length===0);
    await waitForRate('POS_QA_A_P18',112);
    check('catalog refresh preserves the cashier’s deliberate rate override',
      Number(rates().find(row => row.product_id==='POS_QA_A_P5')?.unit_price)===87 &&
      await rate('POS_QA_A_P5').inputValue()==='87');
    await page.locator('#pos-pay-card').click();
    await confirm.waitFor();
    check('reopened tender shows the reviewed total', (await confirm.innerText()).includes('199.00'));
    const payment = page.waitForResponse(r => r.url().endsWith('/payAndComplete') && r.request().method()==='POST');
    await confirm.locator('#posPayConfOk').click();
    const response = await payment;
    const data = await response.json();
    check('the refreshed sale completes with the acknowledged revision and one correct payment',
      data.success===true && new URLSearchParams(response.request().postData()).has('catalogRevision') &&
      payments().length===1 && Number(payments()[0].amount)===199);
  } catch (error) {
    if (out) await page.screenshot({path:path.join(out,'live-mode-pricing-failure.png')});
    throw error;
  } finally {
    await page.close();
    if (transactionId && !payments().length) await invoke('void',{transactionId});
    await invoke('close',{sessionId:session.sessionId,closingCash:'0'});
    await updateModePrice('POS_QA_A_P18',originalPrice);
  }
};
