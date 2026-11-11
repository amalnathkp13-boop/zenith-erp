const { randomUUID } = require('node:crypto');

module.exports = async ({ a, base, q, check, invoke }) => {
  const terminalId = 'POS_QA_A_TERM1';
  const productId = 'POS_QA_A_P18';
  const note = 'KOT offline two tabs ' + randomUUID();
  const first = await a.c.newPage();
  const second = await a.c.newPage();
  const row = page => page.locator('#kb-cart [data-product="' + productId + '"]');
  const total = page => page.locator('#kb-grand').getByText('₹76.00', { exact: true });
  const orders = () => q(
    "SELECT transaction_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A'" +
    " AND terminal_id='" + terminalId + "' AND notes LIKE '%" + note + "%'"
  );
  const addProduct = async page => {
    await page.locator('#kb-search').fill(productId);
    await page.locator('#kb-suggestions [data-result]').filter({ hasText: productId }).first().click();
  };

  try {
    const existing = q("SELECT session_id FROM pos_session WHERE terminal_id='" + terminalId + "' AND status_id='PsOpen'")[0];
    const sessionId = existing?.session_id || (await invoke('open', { terminalId, openingCash: '0' })).sessionId;
    await first.goto(base + '/apps/zenith/kot/KotBilling?sessionId=' + sessionId);
    await first.locator('#kb-wrap[data-offline-ready=true]').waitFor();
    await second.goto(first.url());
    await second.locator('#kb-wrap[data-offline-ready=true]').waitFor();

    await a.c.setOffline(true);
    await first.locator('#kb-online.is-offline').waitFor();
    await second.locator('#kb-online.is-offline').waitFor();
    await first.locator('[data-ot="Take Away"]').click();
    const tax = first.getByRole('switch', { name: 'Tax' });
    if (await tax.getAttribute('aria-checked') === 'true') await tax.click();
    await addProduct(first);
    await row(first).locator('[data-kb-edit=rate]').fill('61');
    await row(first).locator('[data-kb-edit=rate]').press('Enter');
    await row(first).locator('[data-kb-edit=qty]').fill('1.25');
    await row(first).locator('[data-kb-edit=qty]').press('ArrowDown');
    await total(first).waitFor();
    await first.locator('#kb-instr').fill(note);
    await first.locator('#kb-instr').blur();

    check('A second KOT tab does not restore the cart while the first tab owns it', await row(second).count() === 0);
    await addProduct(second);
    await second.locator('#kb-quote-error').getByText(/another tab/).waitFor();
    check('A second KOT tab cannot take payment for its own version of the offline cart',
      await second.locator('#kb-bill').isDisabled() && orders().length === 0);
    second.once('dialog', dialog => dialog.accept());
    await second.locator('#kb-clear').click();
    await first.close();
    await total(second).waitFor();
    check('The remaining tab takes over the exact cart after the first tab closes',
      await second.locator('#kb-instr').inputValue() === note &&
      Number(await row(second).locator('[data-kb-edit=rate]').inputValue()) === 61 &&
      Number(await row(second).locator('[data-kb-edit=qty]').inputValue()) === 1.25);

    await second.locator('#kb-bill').click();
    await second.locator('#kb-payment input[name=cashAmount]:visible').fill('76');
    await second.locator('#kb-payment .pos-cash-confirm').click();
    await second.locator('#kb-print-choice').waitFor();
    check('The recovered KOT cart accepts payment without an online order', orders().length === 0);
    await second.locator('#kb-print-close').click();
    const synced = second.waitForResponse(response => response.url().endsWith('/syncOfflineSale'));
    await a.c.setOffline(false);
    const receipt = await (await synced).json();
    const saved = orders();
    check('The recovered KOT cart syncs to exactly one bill',
      receipt.success && saved.length === 1 && !!saved[0].transaction_id, { error: receipt.error, bills: saved.length });
  } finally {
    await a.c.setOffline(false);
    if (!first.isClosed()) await first.close();
    await second.close();
  }
};
