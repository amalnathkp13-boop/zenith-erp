const assert = require('node:assert/strict');

module.exports = async ({ a, base, check, q }) => {
  const page = await a.c.newPage();
  const route = '/zenith/kot/PosTerminals';
  const terminalName = 'Disposable POS A terminal 2';
  const userId = 'POS_QA_CASHIER';
  const terminalId = 'POS_QA_A_TERM2';
  const submit = '#AssignTerminalForm button[type=submit]';
  const assignment = () => q("SELECT terminal_id FROM pos_terminal_assignment" +
    " WHERE organization_party_id='POS_QA_A' AND user_id='" + userId + "'")[0]?.terminal_id;
  const original = assignment();
  assert.notEqual(original, terminalId, 'Fixture must begin at another terminal');
  try {
    await page.goto(base + '/qapps' + route);
    const form = page.locator('#AssignTerminalForm');
    const controls = form.getByRole('combobox');
    await controls.nth(0).click();
    await page.getByRole('option', { name: 'pos.cashier.qa', exact: true }).click();
    await controls.nth(1).click();
    await page.getByRole('option', { name: terminalName, exact: true }).click();
    const response = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname.endsWith('/PosTerminals/saveAssignment') ||
        (url.pathname.endsWith('/PosTerminals') && url.searchParams.get('terminalId') === terminalId);
    });
    await page.locator(submit).click();
    const saved = await response;
    await saved.finished();
    check('KOT terminal assignment saves through the Quasar form', assignment() === terminalId,
      {status:saved.status(),path:new URL(saved.url()).pathname});
    await page.goto(base + '/apps' + route);
    const row = page.getByRole('row').filter({ hasText: 'pos.cashier.qa' });
    check('The saved terminal is shown on both KOT shells', (await row.innerText()).includes(terminalName));
    const saveUrl = base + '/apps' + route + '/saveAssignment';
    const otherTerminal = original || '';
    await a.c.request.get(saveUrl, {params:{moquiSessionToken:a.t,userId,terminalId:otherTerminal}});
    await a.c.request.post(saveUrl, {form:{userId,terminalId:otherTerminal}});
    check('Assignment still requires POST and a valid session token', assignment() === terminalId);
  } finally {
    if (assignment() === terminalId) {
      await a.c.request.post(base + '/apps' + route + '/saveAssignment', {
        form:{moquiSessionToken:a.t,userId,terminalId:original || ''}
      });
    }
    await page.close();
  }
};
