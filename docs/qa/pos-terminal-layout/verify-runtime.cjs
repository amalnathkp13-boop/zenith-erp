// Run only after pos-reference/verify-runtime.cjs seeds a fresh disposable runtime.
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.env.POS_REFERENCE_BASE_URL;
const dbUrl = process.env.POS_REFERENCE_DB_URL;
const out = process.env.POS_REFERENCE_OUTPUT;
if (base !== 'http://127.0.0.1:18085' ||
    dbUrl !== 'jdbc:h2:tcp://127.0.0.1:19097/mem:purchase-pricing-qa;IFEXISTS=TRUE' ||
    !out || !process.env.POS_REFERENCE_USERNAME || !process.env.POS_REFERENCE_PASSWORD) {
  throw Error('Fresh disposable loopback runtime and fixture credentials required');
}
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], failures: [], pageErrors: [], productionAccess: false };
function check(name, ok, detail) {
  report.checks.push({ name, passed: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) { report.failures.push(name); throw Error(name + ': ' + JSON.stringify(detail)); }
}
function query(sql) {
  const probe = path.resolve(__dirname, '../pos-reference/PosReferenceDbProbe.java');
  const result = spawnSync(process.env.POS_REFERENCE_JAVA,
    ['-cp', process.env.POS_REFERENCE_H2_JAR, probe],
    { input: sql, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.status !== 0) throw Error('SELECT probe failed: ' + result.stderr.slice(0, 300));
  return JSON.parse(result.stdout);
}
function count(table) { return Number(query(`SELECT COUNT(*) AS n FROM ${table}`)[0].n); }
async function box(page, selector) {
  return page.locator(selector).evaluate(e => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      visible: getComputedStyle(e).display !== 'none' };
  });
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.POS_REFERENCE_CHROME });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const login = await context.request.post(base + '/Login/login', {
      form: { username: process.env.POS_REFERENCE_USERNAME, password: process.env.POS_REFERENCE_PASSWORD },
      maxRedirects: 0 });
    check('Disposable login succeeds', login.status() === 302, login.status());
    const page = await context.newPage();
    page.on('pageerror', e => report.pageErrors.push(e.message));
    await page.goto(base + '/apps/zenith/pos/Terminal', { waitUntil: 'networkidle' });
    const invoiceBefore = count('invoice'), paymentBefore = count('pos_payment');
    const openSession = page.getByRole('button', { name: /Open Session/ });
    if (await openSession.count()) await openSession.click();
    await page.locator('#pos-terminal-root').waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => {
      const main = document.querySelector('.pos-main-layout');
      return main && getComputedStyle(main).minHeight === '254px' &&
        document.querySelector('#pos-terminal-root').clientHeight > 0;
    });
    check('Help starts collapsed', !(await page.locator('#posHelp_terminal').isVisible()));
    check('Normal mode is default', await page.locator('body.pos-mode-normal').count() === 1);
    const search = await box(page, '#cartInlineSearch');
    check('Normal empty-cart product search is in the 720px viewport',
      search.top >= 0 && search.bottom <= 720, search);
    const help = await box(page, '#posHelpBtn_terminal'), actions = await box(page, '.nb-actionbar');
    check('Help control sits within the action bar', help.top >= actions.top && help.bottom <= actions.bottom,
      { help, actions });
    await page.getByRole('button', { name: 'Billing help' }).click();
    check('Billing help opens on request', await page.locator('#posHelp_terminal').isVisible());
    await page.getByRole('button', { name: /Got it/ }).click();
    check('Billing help closes and restores the action',
      !(await page.locator('#posHelp_terminal').isVisible()) &&
      await page.getByRole('button', { name: 'Billing help' }).isVisible());
    await page.screenshot({ path: path.join(out, 'terminal-normal-empty-1280.png') });
    await page.locator('.nb-modes summary').click();
    check('Layout choices live inside Modes',
      await page.getByRole('button', { name: 'Normal billing', exact: true }).isVisible() &&
      await page.getByRole('button', { name: /Advanced billing/ }).isVisible());
    await page.getByRole('button', { name: /Advanced billing/ }).click();
    check('Advanced catalog is visible',
      await page.locator('body.pos-mode-advanced .pos-product-grid').isVisible());
    check('Layout switch returns the terminal header to the top',
      await page.locator('#pos-terminal-root').evaluate(e => e.scrollTop < 2));
    await page.screenshot({ path: path.join(out, 'terminal-advanced-empty-1280.png') });
    check('Mode switching does not add a cart line',
      Number(query("SELECT COUNT(*) AS n FROM pos_transaction_item i JOIN pos_transaction t ON t.transaction_id=i.transaction_id WHERE t.organization_party_id='POS_UI_QA'")[0].n) === 0);
    const tile = page.locator('.pos-product-grid button').filter({ hasText: 'Disposable POS UI item' }).first();
    await tile.waitFor();
    check('Synthetic product tile is enabled and hittable', await tile.isEnabled() && await tile.evaluate(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 80 && r.height > 40 && (hit === e || e.contains(hit));
    }));
    await tile.click();
    await page.locator('.pos-cart tbody tr').filter({ hasText: 'Disposable POS UI item' }).waitFor();
    const cartSql = "SELECT i.quantity FROM pos_transaction_item i JOIN pos_transaction t ON t.transaction_id=i.transaction_id WHERE t.organization_party_id='POS_UI_QA'";
    let lines;
    for (let i = 0; i < 30; i++) {
      lines = query(cartSql);
      if (lines.length === 1 && Number(lines[0].quantity) === 1) break;
      await page.waitForTimeout(200);
    }
    check('Grid click adds exactly one unit to the unpaid cart', lines.length === 1 && Number(lines[0].quantity) === 1, lines);
    await page.locator('.nb-modes summary').click();
    await page.getByRole('button', { name: 'Normal billing', exact: true }).click();
    check('Switching back preserves the cart and reveals search',
      await page.locator('body.pos-mode-normal .pos-cart tbody tr').filter({ hasText: 'Disposable POS UI item' }).count() === 1 &&
      (await box(page, '#cartInlineSearch')).bottom <= 720);
    check('Populated desktop Normal billing has one payment row',
      await page.locator('.pos-paywrap').evaluate(e => getComputedStyle(e).display === 'flex') &&
      (await box(page, '#pos-pay-cash')).width >= 80);
    await page.locator('#cartInlineSearch').fill('POS_UI_QA_ITEM');
    const suggestion = page.locator('#cartSearchDropdown .cart-dd-item').first();
    await suggestion.waitFor({ state: 'visible' });
    await suggestion.click();
    for (let i = 0; i < 30; i++) {
      lines = query(cartSql);
      if (lines.length === 1 && Number(lines[0].quantity) === 2) break;
      await page.waitForTimeout(200);
    }
    check('Normal search adds once without a duplicate request', lines.length === 1 && Number(lines[0].quantity) === 2, lines);
    check('No bill, invoice, or payment is issued by cart-only checks',
      count('invoice') === invoiceBefore && count('pos_payment') === paymentBefore &&
      Number(query("SELECT COUNT(*) AS n FROM pos_transaction WHERE organization_party_id='POS_UI_QA' AND status_id='PtCompleted'")[0].n) === 0);
    await page.setViewportSize({ width: 390, height: 768 });
    check('Narrow Normal layout keeps cart inside viewport',
      (await box(page, '.pos-cart')).width <= 390 &&
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.locator('#cartInlineSearch').scrollIntoViewIfNeeded();
    check('Narrow Normal search remains reachable',
      (await box(page, '#cartInlineSearch')).top >= 0 && (await box(page, '#cartInlineSearch')).top < 768);
    // The shared /qapps POS Billing navigation intentionally links to /apps/Terminal;
    // the cashier terminal itself is the /apps surface. The broader reference suite
    // exercises /qapps navigation and native POS screens separately.
    check('No terminal JavaScript exception', report.pageErrors.length === 0, report.pageErrors);
    await context.close();
  } catch (e) { report.error = e.stack || e.message; process.exitCode = 1; }
  finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(out, 'terminal-layout-checks.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, error: report.error }));
  }
})();
