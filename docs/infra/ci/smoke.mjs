// Phase-1 render smoke for the ephemeral staging stack.
//
// Drives a running Moqui (default http://localhost:8080) as the demo admin and asserts a set of
// screens render on BOTH /apps and /qapps with HTTP 200 and no server-error signature in the HTML.
// Exits non-zero if any screen fails, so the CI job goes red. Report-only: it never touches prod.
//
// Usage:  node docs/infra/ci/smoke.mjs  [baseUrl]
// Env:    SMOKE_USER (default john.doe), SMOKE_PASS (default moqui)
//
// Beyond "does it render", the workflow also runs deeper acceptance checks against seeded fixtures
// (docs/infra/ci/seed/isolation.xml):
//   • DONE — org-isolation: as john.doe scoped to CI Tenant A, the contacts page shows Tenant A's
//     contact and NOT Tenant B's (steps "Assert fixtures loaded" + "Org-isolation assert" in
//     .github/workflows/staging-acceptance.yml; DB ground truth gates it so a load failure or a
//     stripped active-org pref fails precisely instead of looking like a leak).
//   • DONE — a MARUTHI-shaped billing no-op smoke (docs/infra/ci/billing.mjs + seed/billing.xml):
//     rings up RETAIL/WHOLESALE/EMPLOYEE cash sales + a split tender on a synthetic MARUTHI-shaped
//     tenant (tax-exclusive, GST 5/12/18%) and asserts the stored per-mode price, per-slab CGST+SGST,
//     whole-rupee rounding, and split-tender reconciliation against a golden baseline via psql.

import puppeteer from 'puppeteer';
import { establishSession } from './session.mjs';

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const USER = process.env.SMOKE_USER || 'john.doe';
const PASS = process.env.SMOKE_PASS || 'moqui';

// Representative smoke set — paths are rendered on both surfaces where it makes sense.
// Keep this small and high-signal; it is a "did the build boot and render", not full coverage.
const PATHS = [
  '/apps/zenith',
  '/apps/zenith/Contacts/ContactsDashboard',
  '/apps/zenith/Contacts/FindContact',
  '/apps/zenith/Crm/Dashboard',
  '/apps/zenith/Crm/Leads',
  '/apps/zenith/Crm/Pipeline',
  '/apps/zenith/Crm/Activities',
  '/apps/zenith/Crm/Segments',
  '/apps/zenith/Dashboard',
  '/apps/zenith/Inventory/InventoryDashboard',
  '/apps/zenith/Inventory/InventoryDashboard?dateMode=all',
  '/apps/zenith/Inventory/DashboardDetails?listType=movements',
  '/apps/zenith/Inventory/DashboardDetails?listType=lowstock',
  '/apps/zenith/Inventory/DashboardDetails?listType=products',
  '/qapps/zenith',
  '/qapps/zenith/Contacts/ContactsDashboard',
  '/qapps/zenith/Contacts/FindContact',
  '/qapps/zenith/Crm/Dashboard',
  '/qapps/zenith/Crm/Leads',
  '/qapps/zenith/Crm/Pipeline',
  '/qapps/zenith/Crm/Activities',
  '/qapps/zenith/Crm/Segments',
  '/qapps/zenith/Inventory/InventoryDashboard',
  '/qapps/zenith/Inventory/InventoryDashboard?dateMode=all',
  '/qapps/zenith/Inventory/DashboardDetails?listType=movements',
  '/qapps/zenith/Inventory/DashboardDetails?listType=lowstock',
  '/qapps/zenith/Inventory/DashboardDetails?listType=products',
];

const ERR_SIG = /(java\.lang\.|groovy\.lang\.|org\.moqui\.\w+Exception|freemarker\.core|ScreenRenderException|Error rendering|500 Internal Server Error|HTTP Status 500)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

let failures = 0;
try {
  const page = await browser.newPage();
  await establishSession(page, BASE, USER, PASS);
  await page.setViewport({ width: 1400, height: 1000 });

  async function checkOnce(path) {
    let status = 0, errSig = false, note = '', snippet = '';
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
      status = resp ? resp.status() : 0;
      await sleep(3000); // let Vue/Quasar and any img-onload bootstraps paint
      if (path.includes('/Crm/')) {
        await page.waitForSelector('.zcrm-page', { timeout: 15000 });
        if (path.includes('/Crm/Dashboard') && await page.$('.zcrm-error')) {
          throw new Error('CRM dashboard returned its data-error state');
        }
      }
      if (path.includes('/Inventory/InventoryDashboard')) {
        await page.waitForSelector('.inv-dashboard', { timeout: 15000 });
        // Guard the approved PR #17 presentation on both ERP surfaces. A KPI
        // without a prior-period comparison correctly has no percentage arrow.
        const presentationOk = await page.evaluate(() => {
          const theme = getComputedStyle(document.querySelector('.inv-dashboard'));
          return theme.getPropertyValue('--primary').trim() === '#7C3AED' &&
            theme.getPropertyValue('--green-text').trim() === '#059669' &&
            theme.getPropertyValue('--red-text').trim() === '#DC2626' &&
            Array.from(document.querySelectorAll('.inv-delta svg')).every(svg => {
              const rect = svg.getBoundingClientRect();
              return rect.width === 14 && rect.height === 14 &&
                ['rgb(5, 150, 105)', 'rgb(220, 38, 38)'].includes(getComputedStyle(svg).color);
            });
        });
        if (!presentationOk) throw new Error('Approved Inventory theme or compact KPI arrow styling changed');
        if (await page.$('#inventoryOverviewChart')) {
          await page.waitForSelector('#inventoryOverviewChart .apexcharts-line-series', { timeout: 15000 });
        } else {
          await page.waitForSelector('.inv-chart-empty', { timeout: 15000 });
        }
      } else if (path.includes('/Inventory/DashboardDetails')) {
        await page.waitForSelector('.inv-detail-content', { timeout: 15000 });
      }
      // Check the VISIBLE body text, not the full HTML — the Quasar SPA's JS bundle legitimately
      // contains exception-class strings and would false-positive against raw HTML.
      const found = await page.evaluate((src) => {
        const t = document.body ? document.body.innerText : '';
        const m = t.match(new RegExp(src, 'i'));
        return m ? t.slice(Math.max(0, m.index - 60), m.index + 140).replace(/\s+/g, ' ') : null;
      }, ERR_SIG.source);
      if (found) { errSig = true; snippet = found; }
    } catch (e) {
      note = 'NAV ERROR: ' + e.message;
    }
    return { ok: status === 200 && !errSig && !note, status, errSig, note, snippet };
  }

  for (const path of PATHS) {
    // Retain one retry for transient navigation failures; the final attempt must satisfy every gate.
    let r = await checkOnce(path);
    if (!r.ok) { await sleep(4000); r = await checkOnce(path); }
    if (!r.ok) failures++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.status || '---'}]${r.errSig ? ' <error>' : ''}  ${path}${r.note ? '  ' + r.note : ''}${r.snippet ? '\n       ↳ ' + r.snippet : ''}`);
  }

  // CRM stays in the existing shell at narrow widths, and one range choice drives
  // every dashboard widget. These checks use the same synthetic staging tenant.
  for (const surface of ['apps', 'qapps']) {
    await page.setViewport({ width: 390, height: 844 });
    for (const screen of ['Dashboard', 'Leads']) {
      const path = `/${surface}/zenith/Crm/${screen}`;
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.zcrm-page', { timeout: 15000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        if (overflow) throw new Error('horizontal page overflow at 390px');
        console.log(`PASS  CRM ${surface} ${screen} mobile`);
      } catch (error) {
        failures++;
        console.log(`FAIL  CRM ${surface} ${screen} mobile — ${error.message}`);
      }
    }
    try {
      await page.goto(`${BASE}/${surface}/zenith/Crm/Dashboard?period=week`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => document.body.innerText.includes('Showing: This week'), { timeout: 15000 });
      console.log(`PASS  CRM ${surface} dashboard range`);
    } catch (error) {
      failures++;
      console.log(`FAIL  CRM ${surface} dashboard range — ${error.message}`);
    }
  }
  await page.setViewport({ width: 1400, height: 1000 });

  // Exercise the two existing date controls, including the legacy form that submits
  // to the module's default screen. These checks are read-only and need no stock data.
  async function clickVisibleControl(selector) {
    // Center the control before clicking: the theme's smooth scroll and the
    // fixed Quasar footer can otherwise leave below-fold controls covered.
    await page.$eval(selector, control => control.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(selector => {
      const control = document.querySelector(selector);
      const rect = control.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === control || control.contains(hit);
    }, { timeout: 15000 }, selector);
    await page.locator(selector).click();
  }
  for (const surface of ['apps', 'qapps']) {
    for (const legacy of [false, true]) {
      const label = `${surface} ${legacy ? 'additional-insights' : 'dashboard'} date Apply`;
      let phase = 'initial render';
      try {
        await page.goto(`${BASE}/${surface}/zenith/Inventory/InventoryDashboard`, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.inv-dashboard', { timeout: 15000 });
        if (legacy) {
          phase = 'open additional insights';
          await clickVisibleControl('details.inv-additional > summary');
          phase = 'open additional-insights date picker';
          await clickVisibleControl('details.zdash-dr > summary');
          await page.waitForSelector('details.zdash-dr[open]', { timeout: 15000 });
        } else {
          await clickVisibleControl('details.inv-date > summary');
        }
        const selector = legacy ? 'form.zdash-dr-pop' : '.inv-date form';
        phase = 'fill From date';
        await page.locator(`${selector} [name="dashDate"]`).fill('2026-10-01');
        phase = 'fill To date';
        await page.locator(`${selector} [name="dashDateTo"]`).fill('2026-10-06');
        phase = 'date Apply button hit target';
        const buttonSelector = `${selector} button[type="submit"]`;
        await clickVisibleControl(buttonSelector);
        phase = 'date parameters in URL';
        await page.waitForFunction(() => new URL(location.href).searchParams.get('dashDate') === '2026-10-01', { timeout: 15000 });
        phase = 'selected date range rendered';
        await page.waitForFunction(() => document.querySelector('.inv-date > summary')?.textContent.includes('2026-10-01 to 2026-10-06'), { timeout: 15000 });
        const validLinks = await page.evaluate(surface => {
          const add = document.querySelector('.inv-header a.inv-primary');
          return !add || new URL(add.href).pathname === `/${surface}/zenith/Inventory/FindProduct`;
        }, surface);
        if (!validLinks) throw new Error('Add New loses the Inventory path after applying dates');
        console.log(`PASS  ${label}`);
      } catch (error) {
        failures++;
        console.log(`FAIL  ${label} (${phase}) — ${error.message}; URL=${page.url()}`);
        console.log('Date-control DOM:', await page.evaluate(() => ({
          additional: document.querySelector('details.inv-additional')?.outerHTML.slice(0, 1200),
          picker: document.querySelector('details.zdash-dr')?.outerHTML,
          form: document.querySelector('form.zdash-dr-pop')?.outerHTML,
          button: (() => { const b = document.querySelector('form.zdash-dr-pop button'); if (!b) return null;
            const r = b.getBoundingClientRect(); return { rect: {x:r.x,y:r.y,width:r.width,height:r.height},
              hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,500),
              form:b.form?.className }; })()
        })));
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'SMOKE OK' : 'SMOKE FAILED'} — ${PATHS.length + 10 - failures}/${PATHS.length + 10} render and interaction checks passed.`);
process.exit(failures === 0 ? 0 : 1);
