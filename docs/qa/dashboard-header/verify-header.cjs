// Local browser regressions. Only navigation, filters and unsaved Customize controls are exercised.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.DASHBOARD_BASE_URL || 'http://localhost:8080';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local runtime required');
const output = process.env.DASHBOARD_OUTPUT || 'tmp/dashboard-review/header';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1907, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [], results = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/Login', { timeout: 90000 });
    await page.locator('#login_form_organizationId').fill(process.env.DASHBOARD_ORGANIZATION || 'LOCALERP');
    await page.locator('#login_form_username').fill(process.env.SMOKE_USER || 'john.doe');
    await page.locator('#login_form [name=password]').fill(process.env.SMOKE_PASS || 'moqui');
    await page.locator('#login_form [type=submit]').click();
    await page.waitForURL('**/zenith/**', { timeout: 90000 });
    await context.storageState({ path: path.join(output, 'local-session.json') });
    for (const shell of ['apps', 'qapps']) {
      const root = `${base}/${shell}/zenith/Dashboard`;
      const input = page.locator(shell === 'apps' ? '#z-search-input' : '#zq-search-input');
      const searchResults = page.locator(shell === 'apps' ? '#z-search-results' : '#zq-search-results');
      await page.goto(root, { timeout: 90000 });
      await page.locator('#homeUtilities .home-avatar').waitFor();
      await page.locator('#homeActivityChart svg').waitFor();
      assert.deepEqual(await page.locator('#homePrimaryNav a').allTextContents(), ['Dashboard', 'Sales', 'Purchase', 'Accounting', 'Inventory', 'HR', 'Reports', 'Settings']);
      assert.deepEqual(await page.locator('.home-period').allTextContents(), ['Today', 'This Week', 'This Month', 'This Year']);
      assert.equal((await page.locator('.home-date-label').innerText()).includes('–'), true, 'Dashboard opens with the current week date range');
      assert.equal(await page.getByText('All time', { exact: true }).count(), 0, 'All time is removed from the date controls');
      assert.equal(await page.locator('.zdh-qa a', { hasText: 'New Sales Order' }).getAttribute('href'), `/${shell}/zenith/sales/CreateOrder`);
      assert.equal(await page.locator('.zsc-row .zsc', { hasText: 'Total Receivables' }).getAttribute('href'), `/${shell}/zenith/pos/CreditBills`);
      await page.locator('.zdh-qa a', { hasText: 'New Sales Order' }).click();
      await page.waitForURL('**/sales/CreateOrder');
      await page.goto(root); await page.locator('#homeUtilities').waitFor();
      await page.locator('.zsc-row .zsc', { hasText: 'Total Receivables' }).click();
      await page.waitForURL('**/pos/CreditBills');
      await page.goto(root); await page.locator('#homeUtilities').waitFor();
      for (const width of [320, 390, 600, 768, 900, 1024, 1280, 1440, 1907, 2560]) {
        await page.setViewportSize({ width, height: 1000 });
        await input.fill('stock');
        await searchResults.locator('a').first().waitFor();
        assert((await searchResults.locator(`a[href='/${shell}/zenith/Inventory/StockLevels']`).count()) === 1, 'Stock Levels is indexed');
        const geometry = await page.evaluate(() => {
          const rect = element => element.getBoundingClientRect();
          const visible = element => element.checkVisibility() && rect(element).width > 0;
          const controls = [...document.querySelectorAll('#homeBrand,#homeMenuButton,.q-toolbar>button:first-child,#z-ownerview,#zq-ownerview,#homePrimaryNav,#z-search,#zq-search,#homeUtilities')].filter(visible);
          const overlaps = [];
          controls.forEach((a, i) => controls.slice(i + 1).forEach(b => { const x = rect(a), y = rect(b); if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) overlaps.push([a.id, b.id]); }));
          const outside = controls.filter(e => rect(e).left < -1 || rect(e).right > innerWidth + 1).map(e => e.id);
          const search = document.querySelector('#z-search-results.show,#zq-search-results.show');
          const sr = rect(search), ir = rect(document.querySelector('#z-search-input,#zq-search-input'));
          const hit = document.elementFromPoint(sr.left + 30, sr.top + 20);
          const modules = document.querySelector('#dashAllModules'), mr = rect(modules), dr = rect(document.querySelector('#homeDashboard'));
          const cardsFit = [...modules.querySelectorAll('a')].every(e => rect(e).bottom <= mr.bottom - 12 && rect(e).right <= mr.right - 12);
          return { overlaps, outside, scrollWidth: document.documentElement.scrollWidth, inputWidth: ir.width, popupFits: sr.left >= 0 && sr.right <= innerWidth, popupClickable: search.contains(hit), cardsFit, bottomGap: dr.bottom - mr.bottom, border: getComputedStyle(modules).borderBottomWidth };
        });
        results.push({ shell, width, ...geometry });
        assert.equal(geometry.scrollWidth, width, `${shell} ${width}: document overflow`);
        assert.deepEqual(geometry.overlaps, [], `${shell} ${width}: header overlaps`);
        assert.deepEqual(geometry.outside, [], `${shell} ${width}: header outside viewport`);
        assert(geometry.inputWidth > 30 && geometry.popupFits && geometry.popupClickable, `${shell} ${width}: usable search`);
        assert(geometry.cardsFit && geometry.bottomGap >= 24 && geometry.border === '1px', `${shell} ${width}: module border and bottom spacing`);
        await input.press('Escape');
        await page.locator('.zdash-dr summary').click();
        const dateBounds = await page.locator('.zdash-dr-pop').evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
        assert(dateBounds, `${shell} ${width}: date popup bounds`);
        await page.locator('.zdash-dr summary').click();
        if ([320, 1440, 1907].includes(width)) await page.screenshot({ path: path.join(output, `${shell}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1907, height: 1000 });
      await page.keyboard.press('Control+k');
      assert(await input.evaluate(e => e === document.activeElement), 'Search shortcut focuses input');
      await input.fill('stock'); await input.press('ArrowDown'); await input.press('ArrowDown');
      assert.equal(await searchResults.locator('a.sel').getAttribute('href'), `/${shell}/zenith/Inventory/StockLevels`);
      await input.press('Enter'); await page.waitForURL('**/Inventory/StockLevels');
      await page.locator('#homePrimaryNav').waitFor({ state: 'detached' });
      await page.goto(root); await page.locator('#homeUtilities').waitFor();
      await input.fill('zzzz-no-such-screen');
      assert.equal((await searchResults.innerText()).trim(), 'No matches');
      await input.press('Escape'); assert.equal(await input.inputValue(), '');
      await input.fill('stock'); await searchResults.locator(`a[href='/${shell}/zenith/Inventory/StockTransfers']`).click();
      await page.waitForURL('**/Inventory/StockTransfers');
      await page.goto(root); await page.locator('#homeUtilities').waitFor();
      await input.fill('PLM'); assert.equal(await searchResults.locator('a').count(), 1, 'All Modules entries are searchable');
      await input.press('Escape');
      if (shell === 'qapps') {
        // Re-use the actual sidebar's plan filter to prove hidden modules do not enter search.
        await page.locator('#zq-sidebar [data-match="/Inventory"]').evaluate(e => { e.style.display = 'none'; });
        await input.fill('Stock Levels'); assert.equal(await searchResults.locator('a').count(), 0, 'Hidden module screens are excluded');
        await page.locator('#zq-sidebar [data-match="/Inventory"]').evaluate(e => { e.style.display = ''; });
        await input.press('Escape');
      }
      await page.locator('.zdash-dr summary').click();
      await page.locator('.zdash-dr-pop [name=dashDate]').fill('2025-07-29');
      await page.locator('.zdash-dr-pop [name=dashDateTo]').fill('2025-07-29');
      await page.locator('.zdash-dr-apply').click(); await page.waitForURL('**/*dashDateTo=2025-07-29*');
      await page.locator('.home-date').waitFor(); assert((await page.locator('.home-date').innerText()).includes('29 Jul – 29 Jul 2025'));
      await page.screenshot({ path: path.join(output, `${shell}-date-controls.png`), clip: { x: 1070, y: 70, width: 810, height: 60 } });
      await page.locator('.home-next-range').click(); await page.waitForURL('**/*dashDateTo=2025-07-30*');
      assert.equal(new URL(page.url()).searchParams.get('dashDate'), '2025-07-30');
      await page.goto(root + '?dashDate=2025-12-30&dashDateTo=2026-01-02');
      await page.locator('.home-date').waitFor(); assert((await page.locator('.home-date').innerText()).includes('30 Dec 2025 – 02 Jan 2026'));
      await page.locator('.home-next-range').click(); await page.waitForURL('**/*dashDateTo=2026-01-06*');
      assert.equal(new URL(page.url()).searchParams.get('dashDate'), '2026-01-03');
      for (const [label, mode] of [['Today','today'], ['This Week','week'], ['This Month','month'], ['This Year','year']]) {
        const preset = page.locator('.home-period', { hasText: label });
        const expected = new URL(await preset.getAttribute('href'), page.url());
        await preset.click();
        await page.waitForURL(url => url.searchParams.get('dateMode') === mode);
        await page.locator('.home-period.on', { hasText: label }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('dashDate'), expected.searchParams.get('dashDate'), `${label} updates the start date`);
        assert.equal(new URL(page.url()).searchParams.get('dashDateTo'), expected.searchParams.get('dashDateTo'), `${label} updates the end date`);
      }
      await page.locator('.home-customize').click(); await page.waitForURL('**/*showSettings=1*');
      await page.locator('.home-widget-controls').first().waitFor();
      assert.equal(await page.locator('#homePrimaryNav').count(), 1, 'No duplicate chrome on dashboard reload');
      const selectedRange = new URL(page.url()).searchParams.get('dashDate'); assert(selectedRange, 'Customize preserves date range');
      await page.goto(root); await page.locator('#homeUtilities').waitFor();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footerClear = await page.evaluate(() => {
        const modules = document.querySelector('#dashAllModules').getBoundingClientRect(), footer = document.querySelector('.q-footer,#footer');
        return !footer || !footer.checkVisibility() || footer.getBoundingClientRect().top >= modules.bottom + 24;
      });
      assert(footerClear, 'Footer follows modules with bottom spacing');
      console.log(shell + ': search, dates, Customize, footer and viewport checks passed');
    }
    assert.deepEqual(errors, [], 'No browser errors');
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ viewportChecks: results.length, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
