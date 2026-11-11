const { randomUUID } = require('node:crypto');
const { join } = require('node:path');

module.exports = async ({ foreign, base, check, q, out }) => {
  const page = await foreign.c.newPage();
  const billing = base + '/apps/zenith/kot/KotBilling';
  let note = 'Disposable KOT offline draft ' + randomUUID();
  const terminalId = 'POS_QA_B_TERM1';
  const matchingDrafts = () => q(
    "SELECT kot_id,kot_number,status_id,transaction_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_B'" +
    " AND terminal_id='" + terminalId + "' AND notes LIKE '%" + note + "%'"
  );
  const confirmation = '**/kot/KotBilling/confirmOfflineDraft';
  const drafts = page.locator('#kb-offline');
  const openDrafts = () => page.locator('#kb-offline-open').click();
  const sync = () => drafts.getByRole('button', { name:'Sync', exact:true }).click();
  async function openCounter() {
    await page.goto(billing);
    await page.locator('#kot-terminal-entry select[name=terminalId]').selectOption(terminalId);
    await page.getByRole('button', { name:'Open / Resume Session' }).click();
    await page.locator('#kb-wrap[data-ready=true]').waitFor();
  }
  try {
    await openCounter();
    await page.locator('[data-ot="Take Away"]').click();
    await page.locator('#kb-search').fill('POS_QA_B_P18');
    await page.locator('#kb-suggestions [data-result]').first().click();
    await page.locator('#kb-instr').fill(note);
    await foreign.c.setOffline(true);
    await page.locator('#kb-online.is-offline').waitFor();
    check('KOT checkout and online Hold are disabled while disconnected',
      await page.locator('#kb-bill').isDisabled() && await page.locator('#kb-draft').isDisabled());
    await openDrafts();
    await drafts.getByRole('button', { name:'Save Current Order' }).click();
    await drafts.getByRole('status').filter({ hasText:'Order saved on this device' }).waitFor();
    check('offline KOT save clears the cart and creates no server order',
      await page.locator('#kb-cart tr').count() === 0 && matchingDrafts().length === 0);

    await foreign.c.setOffline(false);
    for (const shell of ['apps','qapps']) {
      await page.goto(base + '/' + shell + '/zenith/kot/OfflineMode');
      const localCounter = page.locator('[data-kot-device-drafts][data-terminal="' + terminalId + '"]');
      await localCounter.getByText('Take Away · 1 item line', { exact:false }).waitFor();
      check(shell + ' Offline Mode reads the same device draft after navigation', await localCounter.isVisible());
    }
    await openCounter();
    await openDrafts();
    await page.route(confirmation, route => route.abort());
    await sync();
    await drafts.getByRole('status').filter({ hasText:'Refresh or retry' }).waitFor();
    const firstSave = matchingDrafts();
    check('failed KOT confirmation keeps the device draft and leaves exactly one unpaid order',
      await drafts.getByRole('button', { name:'Sync', exact:true }).isEnabled() &&
      firstSave.length === 1 && firstSave[0].status_id === 'KotDraft' && !firstSave[0].transaction_id);
    await page.unroute(confirmation);
    await sync();
    await drafts.getByRole('status').filter({ hasText:'synced to Held Orders' }).waitFor();
    check('KOT retry clears the local draft only after confirming the same held order',
      JSON.stringify(matchingDrafts()) === JSON.stringify(firstSave) &&
      await drafts.getByText('No drafts saved on this device for this counter.').isVisible());
    if (out) await page.screenshot({ path:join(out,'kot-offline-draft-synced.png') });
    await drafts.getByRole('button', { name:'View Held Orders' }).click();
    const heldOrder = page.getByRole('dialog', { name:'Bill History' })
      .locator('[data-kot-id="' + firstSave[0].kot_id + '"][data-kot-group="draft"]');
    await heldOrder.getByRole('button', { name:'#KOT ' + firstSave[0].kot_number, exact:true }).click();
    await page.getByRole('dialog', { name:'Held Order' }).getByRole('button', { name:'Resume Order' }).click();
    await page.waitForURL(url => url.searchParams.get('loadDraft') === String(firstSave[0].kot_id));
    const resumedItem = page.locator('#kb-cart tr[data-product="POS_QA_B_P18"]');
    await resumedItem.waitFor();
    check('the synced KOT draft is visible in Bill History and resumes into the cart',
      await resumedItem.count() === 1 && (await page.locator('#kb-instr').inputValue()).includes(note));
    await page.goto(base + '/apps/zenith/kot/OfflineMode');
    check('KOT Offline Mode shows the persisted sync receipt',
      await page.locator('td').getByText(firstSave[0].kot_number, { exact:true }).count() === 1);

    note += ' online hold';
    await openCounter();
    await page.locator('[data-ot="Take Away"]').click();
    await page.locator('#kb-search').fill('POS_QA_B_P18');
    await page.locator('#kb-suggestions [data-result]').first().click();
    await page.locator('#kb-instr').fill(note);
    await page.route('**/kot/KotBilling/saveDraft', async route => {
      await route.fetch();
      await route.abort();
    });
    await page.locator('#kb-draft').click();
    await page.locator('#kb-order-status').getByText('The last order submission could not be confirmed.', {exact:false}).waitFor();
    await openDrafts();
    check('a committed online hold with a lost response cannot be copied to Offline Drafts',
      await drafts.getByRole('button',{name:'Save Current Order'}).isDisabled()&&matchingDrafts().length===1);
  } finally {
    await foreign.c.setOffline(false);
    await page.close();
  }
};
