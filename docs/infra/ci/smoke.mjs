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
  '/apps/zenith/Crm/Pipeline?period=all',
  '/apps/zenith/Crm/Pipeline?searchText=__qa_no_match__',
  '/apps/zenith/Crm/Activities',
  '/apps/zenith/Crm/Activities?period=all',
  '/apps/zenith/Crm/Segments',
  '/apps/zenith/Crm/Contacts',
  '/apps/zenith/Crm/SourcesCampaigns',
  '/apps/zenith/Crm/Reports',
  '/apps/zenith/Crm/ImportLeads',
  '/apps/zenith/Crm/CrmSettings',
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
  '/qapps/zenith/Crm/Pipeline?period=all',
  '/qapps/zenith/Crm/Pipeline?searchText=__qa_no_match__',
  '/qapps/zenith/Crm/Activities',
  '/qapps/zenith/Crm/Activities?period=all',
  '/qapps/zenith/Crm/Segments',
  '/qapps/zenith/Crm/Contacts',
  '/qapps/zenith/Crm/SourcesCampaigns',
  '/qapps/zenith/Crm/Reports',
  '/qapps/zenith/Crm/ImportLeads',
  '/qapps/zenith/Crm/CrmSettings',
  '/qapps/zenith/Inventory/InventoryDashboard',
  '/qapps/zenith/Inventory/InventoryDashboard?dateMode=all',
  '/qapps/zenith/Inventory/DashboardDetails?listType=movements',
  '/qapps/zenith/Inventory/DashboardDetails?listType=lowstock',
  '/qapps/zenith/Inventory/DashboardDetails?listType=products',
];

const ERR_SIG = /(java\.lang\.|groovy\.lang\.|org\.moqui\.\w+Exception|freemarker\.core|ScreenRenderException|Error rendering|500 Internal Server Error|HTTP Status 500)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CRM_SCREENS = ['Dashboard', 'Leads', 'Pipeline', 'Activities', 'Segments', 'Contacts', 'SourcesCampaigns', 'Reports', 'ImportLeads', 'CrmSettings'];
const CRM_WIDTHS = [390, 768, 1024, 1280, 1440];

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
        if (path.includes('/Crm/Dashboard')) {
          await page.waitForSelector('.zcrm-dashboard-metrics', { timeout: 15000 });
          const count = await page.$$eval('.zcrm-dashboard-metrics .zcrm-metric', cards => cards.length);
          if (count !== 6) throw new Error(`CRM dashboard rendered ${count} metric cards instead of six`);
        }
        if (path.includes('/Crm/Leads')) {
          await page.waitForSelector('.zcrm-lead-metrics', { timeout: 15000 });
          const count = await page.$$eval('.zcrm-lead-metrics .zcrm-metric', cards => cards.length);
          if (count !== 4 || !(await page.$('.zcrm-leads-directory'))) {
            throw new Error('CRM lead metrics or directory did not render');
          }
        }
        if (['Pipeline', 'Activities', 'Segments'].some(screen => path.includes(`/Crm/${screen}`))) {
          await page.waitForSelector('.zcrm-reference-metrics', { timeout: 15000 });
          const count = await page.$$eval('.zcrm-reference-metrics .zcrm-metric', cards => cards.length);
          if (count !== 4) throw new Error(`CRM screen rendered ${count} metric cards instead of four`);
          if (path.includes('/Crm/Pipeline')) {
            await page.waitForSelector('.zcrm-board', { timeout: 15000 });
            const stages = await page.$$eval('.zcrm-board-column', columns => columns.length);
            if (stages < 5) throw new Error(`CRM pipeline rendered only ${stages} open stages`);
            if (path.includes('searchText=__qa_no_match__')) {
              const deals = await page.$$eval('.zcrm-deal-card', cards => cards.length);
              if (deals !== 0) throw new Error('CRM pipeline search did not filter all cards');
            }
          } else if (!(await page.$('.zcrm-reference-list'))) {
            throw new Error('CRM activity or segment list did not render');
          }
          if (path.includes('period=all')) {
            const expected = path.includes('/Crm/Pipeline') ? 'Closing All Time' : 'All time';
            const text = await page.$eval('.zcrm-reference-metrics', element => element.innerText);
            if (!text.includes(expected)) throw new Error(`CRM period filter did not show ${expected}`);
          }
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

  // Custom /qapps tabs must use the SPA router: a document reload blanks the workspace in split-window mode.
  for (const width of [950, 1400]) {
    try {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/qapps/zenith/pos/Dashboard`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('#zq-subnav a[href="/qapps/zenith/pos/DailySummary"]', { timeout: 15000 });
      const documentStart = await page.evaluate(() => performance.timeOrigin);
      await page.click('#zq-subnav a[href="/qapps/zenith/pos/DailySummary"]');
      await page.waitForFunction(() => location.pathname === '/qapps/zenith/pos/DailySummary' &&
        document.querySelector('.q-page h1')?.textContent.trim() === 'Daily Summary', { timeout: 30000 });
      if (await page.evaluate(() => performance.timeOrigin) !== documentStart) throw new Error('tab reloaded the document');
      console.log(`PASS  POS Daily Summary one-click SPA navigation at ${width}px`);
    } catch (error) {
      failures++;
      console.log(`FAIL  POS Daily Summary one-click SPA navigation at ${width}px — ${error.message}`);
    }
  }

  // CRM stays in the existing shell at narrow widths, and one range choice drives
  // every dashboard widget. These checks use the same synthetic staging tenant.
  for (const surface of ['apps', 'qapps']) {
    await page.setViewport({ width: 390, height: 844 });
    for (const screen of CRM_SCREENS) {
      const path = `/${surface}/zenith/Crm/${screen}`;
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.zcrm-page', { timeout: 15000 });
        for (const width of CRM_WIDTHS) {
          await page.setViewport({ width, height: 844 });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
          if (overflow) throw new Error(`horizontal page overflow at ${width}px`);
        }
        console.log(`PASS  CRM ${surface} ${screen} at ${CRM_WIDTHS.join(', ')}px`);
        await page.setViewport({ width: 390, height: 844 });
      } catch (error) {
        failures++;
        console.log(`FAIL  CRM ${surface} ${screen} responsive — ${error.message}`);
      }
    }
    try {
      await page.goto(`${BASE}/${surface}/zenith/Crm/Dashboard?period=week`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => document.body.innerText.includes('Showing: This week'), { timeout: 15000 });
      await page.goto(`${BASE}/${surface}/zenith/Crm/Dashboard?period=today`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => document.body.innerText.includes('Showing: Today'), { timeout: 15000 });
      const activePeriod = await page.evaluate(() => {
        const period = document.querySelector('.zcrm-period');
        const selected = period?.querySelector('.zcrm-period-active');
        return selected?.textContent.trim() || `missing selection: ${period?.outerHTML.slice(0, 900)}`;
      });
      if (activePeriod !== 'Today') throw new Error(`CRM highlighted ${activePeriod} instead of Today`);
      console.log(`PASS  CRM ${surface} dashboard range`);
    } catch (error) {
      failures++;
      console.log(`FAIL  CRM ${surface} dashboard range — ${error.message}`);
    }
  }
  await page.setViewport({ width: 1400, height: 1000 });

  // A disposable write verifies the actual service path, source badge and retry key.
  let sourceSmokeEmail;
  try {
    await page.goto(`${BASE}/apps/zenith/Crm/Leads?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const email = `crm-smoke-${Date.now()}@example.test`;
    const created = await page.evaluate(async email => {
      const form = document.getElementById('NewLeadForm') || document.querySelector('form[name="NewLeadForm"]');
      if (!form) throw new Error('New Lead form is missing');
      const data = new FormData(form);
      data.set('firstName', 'Disposable CRM smoke');
      data.set('email', email);
      data.set('leadSourceId', 'Instagram');
      data.set('sourceDetail', 'CI attribution check');
      data.set('utmSource', 'instagram');
      data.set('externalSubmissionId', `ci:${email}`);
      const result = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
        const html = await response.text();
        result.push({ status: response.status, error: /Possible duplicate|Choose an active lead source|Error rendering|First name is required/.exec(html)?.[0] || '' });
      }
      return result;
    }, email);
    if (created.some(result => result.status !== 200 || result.error)) {
      throw new Error(`create/retry failed: ${JSON.stringify(created)}`);
    }
    await page.goto(`${BASE}/apps/zenith/Crm/Leads?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const rows = await page.$$eval('tr', (tableRows, expected) => tableRows.filter(row => row.textContent.includes(expected)).map(row => row.textContent), email);
    if (rows.length !== 1 || !rows[0].includes('Instagram')) {
      throw new Error(`expected one Instagram lead after retry, found ${rows.length} matching rows`);
    }
    sourceSmokeEmail = email;
    console.log('PASS  CRM source capture and idempotent lead retry');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM source capture and idempotent lead retry — ${error.message}`);
  }

  try {
    if (!sourceSmokeEmail) throw new Error('source lead was not created');
    await page.goto(`${BASE}/apps/zenith/Crm/Reports?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const hrefs = await page.evaluate(() => ({
      original: document.querySelector('a[href*="firstTouchSourceId=Instagram"]')?.href,
      latest: document.querySelector('a[href*="latestTouchSourceId=Instagram"]')?.href,
    }));
    if (!hrefs.original || !hrefs.latest) throw new Error('original or latest source drill-down is missing');
    for (const href of Object.values(hrefs)) {
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
      const present = await page.$$eval('tr', (rows, email) => rows.some(row => row.textContent.includes(email)), sourceSmokeEmail);
      if (!present) throw new Error(`source lead is absent from ${href}`);
    }
    console.log('PASS  CRM original and latest source report drill-down');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM original and latest source report drill-down — ${error.message}`);
  }

  try {
    await page.goto(`${BASE}/apps/zenith/Crm/SourcesCampaigns`, { waitUntil: 'networkidle2', timeout: 60000 });
    const campaignName = `Disposable CRM campaign ${Date.now()}`;
    const posted = await page.evaluate(async name => {
      const form = document.getElementById('NewCampaignForm') || document.querySelector('form[name="NewCampaignForm"]');
      if (!form) throw new Error('New Campaign form is missing');
      const data = new FormData(form);
      data.set('campaignName', name);
      data.set('leadSourceId', 'Instagram');
      data.set('medium', 'social');
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
      return response.status;
    }, campaignName);
    if (posted !== 200) throw new Error(`campaign create returned HTTP ${posted}`);
    await page.goto(`${BASE}/apps/zenith/Crm/SourcesCampaigns`, { waitUntil: 'networkidle2', timeout: 60000 });
    const campaignId = await page.evaluate(name => {
      const options = [...document.querySelectorAll('select[name="trackingCampaignId"] option')];
      return options.find(option => option.textContent.trim() === name)?.value;
    }, campaignName);
    if (!campaignId) throw new Error('new campaign is absent from the tracking-link builder');
    const destination = 'https://example.test/signup?existing=a%26b#section';
    const query = new URLSearchParams({ trackingCampaignId: campaignId, destinationUrl: destination, utmContent: 'autumn offer' });
    await page.goto(`${BASE}/apps/zenith/Crm/SourcesCampaigns?${query}`, { waitUntil: 'networkidle2', timeout: 60000 });
    const tracked = await page.$eval('.zcrm-tracking-url', element => element.textContent.trim());
    const url = new URL(tracked);
    if (url.hash !== '#section' || url.searchParams.get('existing') !== 'a&b' ||
        url.searchParams.get('utm_source') !== 'instagram' ||
        url.searchParams.get('utm_medium') !== 'social' ||
        url.searchParams.get('utm_content') !== 'autumn offer' ||
        url.searchParams.get('crm_campaign_id') !== campaignId || !(await page.$('.zcrm-copy-link'))) {
      throw new Error('tracking URL lost the destination, UTM values or copy action');
    }
    console.log('PASS  CRM campaign tracking URL and copy action');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM campaign tracking URL and copy action — ${error.message}`);
  }

  try {
    await page.goto(`${BASE}/apps/zenith/Crm/Pipeline`, { waitUntil: 'networkidle2', timeout: 60000 });
    const name = `Disposable CRM opportunity ${Date.now()}`;
    const posted = await page.evaluate(async name => {
      const form = document.getElementById('NewOppForm') || document.querySelector('form[name="NewOppForm"]');
      if (!form) throw new Error('New Opportunity form is missing');
      const data = new FormData(form);
      data.set('opportunityName', name);
      data.set('opportunityStageId', 'SoProspecting');
      data.set('estimatedAmount', '100');
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
      return response.status;
    }, name);
    if (posted !== 200) throw new Error(`opportunity create returned HTTP ${posted}`);
    await page.goto(`${BASE}/apps/zenith/Crm/Pipeline?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const cardId = await page.evaluate(name => [...document.querySelectorAll('.zcrm-deal-card')]
      .find(card => card.textContent.includes(name))?.id, name);
    if (!cardId) throw new Error('new opportunity is absent from the board');
    const dealId = cardId.slice('crm-deal-'.length).replace(/(?:_\d+)+$/, '');
    const before = await page.$eval(`#${cardId}`, card => card.closest('.zcrm-board-column')?.id);
    if (!before?.startsWith('crm-stage-SoProspecting')) throw new Error(`new opportunity started in ${before}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.evaluate(id => {
        const card = document.getElementById(id);
        const target = document.querySelector('[id^="crm-stage-SoQualification"]');
        if (!card?.draggable || !target) throw new Error('drag handle or target stage is missing');
        const dataTransfer = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      }, cardId),
    ]);
    await page.goto(`${BASE}/apps/zenith/Crm/Pipeline?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const after = await page.evaluate(name => [...document.querySelectorAll('.zcrm-deal-card')]
      .find(card => card.textContent.includes(name))?.closest('.zcrm-board-column')?.id, name);
    if (!after?.startsWith('crm-stage-SoQualification')) throw new Error(`drag stage did not persist: ${after}`);
    await page.goto(`${BASE}/apps/zenith/Crm/EditOpportunity?salesOpportunityId=${encodeURIComponent(dealId)}`, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!(await page.$eval('body', body => body.innerText.includes('SoProspecting') && body.innerText.includes('SoQualification')))) {
      throw new Error('stage-change history is missing');
    }
    console.log('PASS  CRM pipeline drag, persistence and stage audit');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM pipeline drag, persistence and stage audit — ${error.message}`);
  }

  try {
    await page.goto(`${BASE}/apps/zenith/Crm/Activities`, { waitUntil: 'networkidle2', timeout: 60000 });
    const subject = `Disposable CRM follow-up ${Date.now()}`;
    const posted = await page.evaluate(async subject => {
      const form = document.getElementById('ScheduleActivityForm') || document.querySelector('form[name="ScheduleActivityForm"]');
      if (!form) throw new Error('Schedule Activity form is missing');
      const data = new FormData(form);
      data.set('activityType', 'Task');
      data.set('subject', subject);
      data.set('dueDate', new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '));
      data.set('priority', 'High');
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
      const html = await response.text();
      const match = /could not be converted|CRM write access is required|Error rendering/i.exec(html);
      return { status: response.status, error: match ? html.slice(Math.max(0, match.index - 100), match.index + 500).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') : '' };
    }, subject);
    if (posted.status !== 200 || posted.error) throw new Error(`activity schedule failed: ${JSON.stringify(posted)}`);
    await page.goto(`${BASE}/apps/zenith/Crm/Activities?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const allRow = await page.evaluate(subject => [...document.querySelectorAll('tr')]
      .find(row => row.textContent.includes(subject))?.innerText, subject);
    if (!allRow) throw new Error('new activity is absent from All after scheduling');
    await page.goto(`${BASE}/apps/zenith/Crm/Activities?view=overdue`, { waitUntil: 'networkidle2', timeout: 60000 });
    const detailHref = await page.evaluate(subject => [...document.querySelectorAll('tr')]
      .find(row => row.textContent.includes(subject))?.querySelector('a[href*="ActivityDetail"]')?.href, subject);
    if (!detailHref) throw new Error(`new activity is absent from Overdue; All row was ${allRow.replace(/\s+/g, ' ')}`);
    await page.goto(detailHref, { waitUntil: 'networkidle2', timeout: 60000 });
    const completed = await page.evaluate(async () => {
      const form = document.getElementById('CompleteActivityForm') || document.querySelector('form[name="CompleteActivityForm"]');
      if (!form) throw new Error('Complete Activity form is missing');
      const data = new FormData(form);
      data.set('outcome', 'Contacted');
      data.set('description', 'Disposable staging follow-up completed');
      data.set('durationMinutes', '5');
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
      return response.status;
    });
    if (completed !== 200) throw new Error(`activity completion returned HTTP ${completed}`);
    await page.goto(detailHref, { waitUntil: 'networkidle2', timeout: 60000 });
    const detail = await page.$eval('body', body => body.innerText);
    if (!detail.includes('Completed') || !detail.includes('Outcome: Contacted')) {
      throw new Error('activity completion or outcome did not persist');
    }
    console.log('PASS  CRM overdue activity scheduling and completion');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM overdue activity scheduling and completion — ${error.message}`);
  }

  try {
    await page.goto(`${BASE}/apps/zenith/Crm/ImportLeads`, { waitUntil: 'networkidle2', timeout: 60000 });
    const email = `crm-import-${Date.now()}@example.test`;
    const previewStatus = await page.evaluate(async email => {
      const form = document.getElementById('PreviewLeadCsv') || document.querySelector('form[name="PreviewLeadCsv"]');
      if (!form) throw new Error('CSV preview form is missing');
      const data = new FormData(form);
      data.set('csvText', `FirstName,Email,Source\nDisposable import,${email},Instagram\nInvalid row,bad-email,YouTube`);
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
      return response.status;
    }, email);
    if (previewStatus !== 200) throw new Error(`CSV preview returned HTTP ${previewStatus}`);
    await page.goto(`${BASE}/apps/zenith/Crm/ImportLeads`, { waitUntil: 'networkidle2', timeout: 60000 });
    const preview = await page.$eval('body', body => body.innerText);
    if (!preview.includes('2 rows') || !preview.includes('1 ready') || !preview.includes('1 need attention')) {
      throw new Error('CSV preview did not separate valid and invalid rows');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const committed = await page.evaluate(async () => {
        const form = document.getElementById('CommitLeadCsv') || document.querySelector('form[name="CommitLeadCsv"]');
        if (!form) throw new Error('CSV commit form is missing');
        const response = await fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin' });
        return response.status;
      });
      if (committed !== 200) throw new Error(`CSV commit returned HTTP ${committed}`);
      await page.goto(`${BASE}/apps/zenith/Crm/ImportLeads`, { waitUntil: 'networkidle2', timeout: 60000 });
      const outcome = await page.$eval('body', body => body.innerText);
      if (!outcome.includes('1 imported or already present') || !outcome.includes('1 skipped')) {
        throw new Error(`CSV import result was incorrect on attempt ${attempt + 1}`);
      }
    }
    await page.goto(`${BASE}/apps/zenith/Crm/Leads?period=all`, { waitUntil: 'networkidle2', timeout: 60000 });
    const rows = await page.$$eval('tr', (tableRows, expected) => tableRows.filter(row => row.textContent.includes(expected)).length, email);
    if (rows !== 1) throw new Error(`CSV retry created ${rows} matching leads`);
    console.log('PASS  CRM CSV preview, valid-row import and safe retry');
  } catch (error) {
    failures++;
    console.log(`FAIL  CRM CSV preview, valid-row import and safe retry — ${error.message}`);
  }

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

const interactionChecks = 2 * (CRM_SCREENS.length + 1) + 8;
console.log(`\n${failures === 0 ? 'SMOKE OK' : 'SMOKE FAILED'} — ${PATHS.length + interactionChecks - failures}/${PATHS.length + interactionChecks} render and interaction checks passed.`);
process.exit(failures === 0 ? 0 : 1);
