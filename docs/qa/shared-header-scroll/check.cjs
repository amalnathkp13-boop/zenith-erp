/* Isolated shared-chrome regression: real Vue/Quasar QHeader reveal, synthetic content only. */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '../../..');
const webroot = process.env.QA_WEBROOT;
assert(webroot, 'Set QA_WEBROOT to the framework screen/webroot directory containing libs/vue and libs/quasar');
const git = process.env.QA_GIT || 'git';
const baseRef = process.env.QA_BASE_REF || 'origin/master';
const out = path.resolve(process.env.QA_OUTPUT || 'shared-header-proof');
fs.mkdirSync(out, { recursive: true });
const assets = 'component/zenith-erp-app/screen/zenithstatic/';
const current = f => fs.readFileSync(path.join(repo, assets, f));
const before = f => execFileSync(git, ['show', baseRef + ':' + assets + f], { cwd: repo });
const routes = [
  'Dashboard', 'Contacts/ContactsDashboard', 'sales/SalesDashboard', 'Purchase/GoodsReceipt',
  'Crm/Leads', 'pos/Dashboard', 'Inventory/InventoryDashboard', 'manufacturing/WorkOrders',
  'Accounting/AcctgDashboard', 'payroll/PayrollRuns', 'expenses/MyExpenses', 'project/Projects',
  'Stores/FindStore', 'tax/TaxDashboard', 'pricing/PricingDashboard', 'barcode/BarcodeDashboard',
  'my-subscription'
];
const widths = [1440, 1200, 1024, 900, 710, 375];
const baseline = { css: before('css/zenith-theme-v4.css'), js: before('js/qapps-nav.js') };
const candidate = { css: current('css/zenith-theme-v4.css'), js: current('js/qapps-nav.js') };
const xml = fs.readFileSync(path.join(repo, 'component/zenith-erp-app/screen/zenith/ZenithApp.xml'), 'utf8');
const baseXml = execFileSync(git, ['show', baseRef + ':component/zenith-erp-app/screen/zenith/ZenithApp.xml'], { cwd: repo, encoding: 'utf8' });
const normalizedXml = s => s.replace(/\r\n/g, '\n').replace(/(theme-v4\.css|qapps-nav\.js)\?v=\d+/g, '$1?v=VERSION');
assert(normalizedXml(xml) === normalizedXml(baseXml), 'XML changes must be asset versions only');
assert.equal((xml.match(/theme-v4\.css\?v=280/g) || []).length, 2, 'Both theme registrations updated');
const bootstrapStyle = baseXml.slice(baseXml.lastIndexOf('<style>', baseXml.indexOf('#z-sidebar{')), baseXml.indexOf('</style>', baseXml.indexOf('#z-sidebar{')) + 8);
const requests = [];
function fixture(variant, bootstrap, cashier) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/vendor/quasar/quasar.min.css"><link rel="stylesheet" href="/theme.css?variant=${variant}">
    <style>@font-face{font-family:'Material Icons';src:url('/zenithstatic/fonts/MaterialIcons-Regular.woff2') format('woff2')}.material-icons{font-family:'Material Icons';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga'}#qa-content{padding:24px}#qa-content .qa-card{height:180px;margin-bottom:20px;padding:24px;background:#fff;border:1px solid #e4dff3;border-radius:12px}</style>
    ${bootstrap ? bootstrapStyle : ''}</head><body>
    <div id="zenith-saas-cfg" data-org-name="UI QA" data-tenant="false" data-pos-only="${cashier}"></div>
    <div id="z-shopdata" data-multishop="false"></div>
    ${bootstrap ? '<div id="z-sidebar">Navigation</div><header id="top"><button id="qa-burger">Menu</button></header><nav id="z-subnav" class="show"><a href="/apps/zenith/pos/CashEntry">Cash entry</a></nav><main id="content"><button id="qa-control">Read-only control</button><div style="height:2600px">Synthetic content</div></main>' :
      '<div id="apps-root"><q-layout view="hHh LpR fFf"><q-header reveal bordered id="top" class="bg-black text-white"><q-toolbar><q-btn dense flat icon="menu"></q-btn><q-space></q-space></q-toolbar></q-header><q-page-container><q-page><main id="qa-content"><button id="qa-control">Read-only control</button>' + Array.from({length:15}, (_,i)=>'<section class="qa-card"><h2>Scroll verification '+(i+1)+'</h2><p>Synthetic UI fixture. No customer or billing data.</p></section>').join('') + '</main></q-page></q-page-container></q-layout></div>'}
    <script src="/vendor/vue/vue.js"></script><script src="/vendor/quasar/quasar.umd.min.js"></script>
    <script>
    function refreshContent(){document.getElementById('${bootstrap ? 'content' : 'qa-content'}').classList.toggle('mysub-wrap',location.pathname.includes('/my-subscription'));}
    ${bootstrap ? '' : "new Vue({el:'#apps-root'});"} refreshContent();
    document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.getAttribute('href')?.startsWith('/qapps/zenith')){e.preventDefault();history.pushState({},'',a.getAttribute('href'));refreshContent();}});
    document.addEventListener('click',function(e){if(e.target.id==='qa-control')document.body.dataset.controlClicked='true';});
    </script><script src="/nav.js?variant=${variant}"></script></body></html>`;
}
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, path: req.url.split('?')[0] });
  const u = new URL(req.url, 'http://127.0.0.1');
  const set = u.searchParams.get('variant') === 'baseline' ? baseline : candidate;
  if (u.pathname === '/theme.css') { res.setHeader('Content-Type', 'text/css'); res.end(set.css); }
  else if (u.pathname === '/nav.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(set.js); }
  else if (/^\/zenithstatic\/fonts\/MaterialIcons(?:Outlined)?-Regular\.woff2$/.test(u.pathname)) { res.setHeader('Content-Type', 'font/woff2'); res.end(current(u.pathname.slice('/zenithstatic/'.length))); }
  else if (/^\/zenithstatic\/img\/zetaerp-[a-z-]+\.svg$/.test(u.pathname)) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(current(u.pathname.slice('/zenithstatic/'.length))); }
  else if (/^\/vendor\/(vue|quasar)\/[a-zA-Z0-9.-]+$/.test(u.pathname)) {
    const f = path.join(webroot, 'libs', u.pathname.slice('/vendor/'.length));
    res.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(f));
  } else if (u.pathname.startsWith('/qapps/zenith') || u.pathname.startsWith('/apps/zenith')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture(u.searchParams.get('variant') || 'candidate', u.pathname.startsWith('/apps/'), u.searchParams.get('cashier') === 'true'));
  } else { res.statusCode = 404; res.end(); }
});
const results = [];
function pass(name) { results.push({ name, pass: true }); }
async function geometry(page) {
  return page.evaluate(() => {
    const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, width: r.width, visible: getComputedStyle(e).display !== 'none' }; };
    return { header: box('.q-header'), tabs: box('#zq-subnav'), content: box('#qa-content'), y: scrollY, padding: parseFloat(getComputedStyle(document.querySelector('.q-page-container')).paddingTop), hidden: document.querySelector('.q-header').classList.contains('q-header--hidden') };
  });
}
async function stable(page, name) {
  await page.waitForFunction(() => {
    const h = document.querySelector('.q-header'), t = document.querySelector('#zq-subnav'), p = document.querySelector('.q-page-container');
    if (!h || !t || !p) return false;
    const hr = h.getBoundingClientRect(), tr = t.getBoundingClientRect(), visible = getComputedStyle(t).display !== 'none';
    return Math.abs(hr.top) < 1 && (!visible || Math.abs(tr.top - hr.bottom) < 1) && parseFloat(getComputedStyle(p).paddingTop) >= hr.height + (visible ? tr.height : 0) - 1;
  }, null, { timeout: 6000 });
  const g = await geometry(page);
  assert(Math.abs(g.header.top) < 1, name + ': header pinned');
  if (g.tabs.visible) assert(Math.abs(g.tabs.top - g.header.bottom) < 1, name + ': joined tabs');
  assert(g.padding >= g.header.height + (g.tabs.visible ? g.tabs.height : 0) - 1, name + ': content reservation');
  pass(name); return g;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/qapps/zenith/pos/Dashboard?variant=baseline');
    await page.waitForSelector('#zq-subnav.show');
    await page.mouse.move(1000, 650); await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector('.q-header').classList.contains('q-header--hidden'));
    await page.waitForFunction(() => document.querySelector('.q-header').getBoundingClientRect().bottom < 0);
    const bad = await geometry(page);
    assert(bad.y > 0 && bad.header.bottom < bad.tabs.top - 20, 'Negative control must reproduce detached tabs');
    await page.screenshot({ path: path.join(out, 'before.png') });
    pass('Unpatched master reproduces the detached header with real QHeader reveal');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of routes) {
        const name = width + ' ' + route;
        await page.goto(origin + '/qapps/zenith/' + route);
        await page.waitForSelector('#zq-subnav', { state: 'attached' });
        await stable(page, name + ' initial');
        await page.mouse.move(width - 60, 650);
        await page.mouse.wheel(0, 650);
        await page.waitForFunction(() => scrollY > 100);
        await page.waitForFunction(() => document.querySelector('.q-header').classList.contains('q-header--hidden'));
        await stable(page, name + ' down');
        for (const delta of [-16, -48, 96, -24]) {
          const previous = await page.evaluate(() => scrollY);
          await page.mouse.wheel(0, delta);
          await page.waitForFunction(y => Math.abs(scrollY - y) > 2, previous);
          const g = await stable(page, name + ' reverse ' + delta);
          assert(g.y > 100, name + ': reverse check must be away from page top');
        }
        if (width === 1440 && route === 'pos/Dashboard') await page.screenshot({ path: path.join(out, 'after.png') });
      }
      console.log('Shared chrome checked at ' + width + 'px');
    }
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(origin + '/qapps/zenith/Contacts/ContactsDashboard');
    await page.waitForSelector('#zq-subnav.show');
    const fullHeight = (await stable(page, 'SPA Contacts desktop')).header.height;
    await page.setViewportSize({ width: 710, height: 800 });
    const wrapped = await stable(page, 'SPA Contacts wraps without reload');
    assert(wrapped.header.height > fullHeight, 'Must exercise real wrapped toolbar');
    await page.locator('.q-header .q-toolbar>button').first().click();
    await page.waitForFunction(() => document.body.classList.contains('zq-side-open'));
    await page.locator('.zqs-link[data-match="/pos"]').click();
    await page.waitForFunction(() => document.querySelector('#zq-subnav').dataset.mod === 'pos');
    const unwrapped = await stable(page, 'SPA Contacts to POS recalculates offset');
    assert(unwrapped.header.height < wrapped.header.height, 'Toolbar must unwrap after module navigation');
    await page.locator('#zq-search-input').fill('Sales');
    assert(await page.locator('#zq-search-results a').count() > 0, 'Module search still opens results'); pass('Module search works');
    await page.locator('#zq-search-input').press('Escape');
    await page.locator('.q-header .q-toolbar>button').first().click();
    await page.waitForFunction(() => document.body.classList.contains('zq-side-open'));
    await page.locator('#zq-side-toggle').click(); await stable(page, 'Sidebar collapse recalculates header');
    await page.evaluate(() => { history.pushState({}, '', '/qapps/zenith/my-subscription'); document.querySelector('#qa-content').classList.add('mysub-wrap'); });
    await page.waitForFunction(() => !document.querySelector('#zq-subnav').classList.contains('show'));
    await stable(page, 'SPA My Subscription hides tabs and reserves wrapped header');
    await page.goto(origin + '/qapps/zenith/pos/Dashboard?cashier=true');
    await page.waitForSelector('#zq-subnav.show');
    const labels = await page.locator('#zq-subnav a').allTextContents();
    assert.deepEqual(labels, ['Dashboard', 'Billing Terminal', 'Transactions', 'Daily Summary', 'Sessions', 'Credit Bills', 'Cash Entry']);
    assert.equal(await page.getByText('Billing Terminal', { exact: true }).getAttribute('href'), '/apps/zenith/pos/Terminal');
    pass('Cashier tab filter and Bootstrap Terminal destination preserved');
    for (const width of [1440, 710, 375]) {
      await page.setViewportSize({ width, height: 800 });
      const captures = [];
      for (const variant of ['baseline', 'candidate']) {
        await page.goto(origin + '/apps/zenith/pos/Terminal?variant=' + variant);
        await page.locator('#qa-control').click();
        assert.equal(await page.locator('body').getAttribute('data-control-clicked'), 'true');
        assert.equal(await page.locator('#zq-subnav').count(), 0);
        captures.push(await page.screenshot());
      }
      assert(captures[0].equals(captures[1]), 'Bootstrap fixture pixels unchanged at ' + width);
      pass('Bootstrap fixture and interactive control unchanged ' + width);
    }
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    assert(requests.every(r => r.method === 'GET'), 'No write requests');
    pass('Zero browser exceptions and zero write requests');
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ scope: 'Isolated real Vue/Quasar shell; not a Moqui end-to-end or billing test', baseRef, cases: results.length, results, writes: 0 }, null, 2));
    console.log(JSON.stringify({ passed: results.length, widths, moduleRoutes: routes.length, writes: 0 }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: e.message, passed: results }, null, 2)); console.error(e); process.exitCode = 1; server.close(); });
