// Compare HR content with the supplied HTML in a real ERP shell at the same content width.
// Usage: HR_QA_URL=http://127.0.0.1:PORT HR_QA_USER=... HR_QA_PASSWORD=... node compare-reference.cjs REFERENCE.html OUTPUT_DIRECTORY
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const base = new URL(process.env.HR_QA_URL);
assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a disposable localhost runtime');
const reference = pathToFileURL(path.resolve(process.argv[2])).href;
const output = path.resolve(process.argv[3]);
const pages = {
  Dashboard: 'dashboard',
  Directory: 'employees',
  Attendance: 'attendance',
  Leave: 'leave',
  Salary: 'payroll',
  Reports: 'reports',
  Settings: 'settings',
};
const widths = [320, 390, 760, 768, 820, 1024, 1180, 1280, 1440, 1920];
const selectors = [
  'h1',
  '.page-title-text p',
  '.btn-primary',
  '.stat-card',
  '.stat-label',
  '.stat-value',
  '.card-title',
  '.data-table th',
  '.attendance-chart',
  '.chart-bar',
  '.donut',
];
const properties = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'borderRadius',
  'padding',
  'gap',
];

async function measure(container) {
  return container.evaluate(
    (root, { selectors, properties }) => {
      const box = root.getBoundingClientRect();
      return selectors.flatMap((selector) => {
        const element = root.querySelector(selector);
        if (!element) return [];
        // Card headings may share a flex item with a longer, data-dependent subtitle.
        // Measure the heading itself instead of that item's stretched text box.
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect =
          selector === '.card-title' ? range.getBoundingClientRect() : element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [
          {
            selector,
            style: properties.map((key) => style[key]),
            x: rect.x - box.x,
            y: rect.y - box.y,
            width: rect.width,
            height: rect.height,
          },
        ];
      });
    },
    { selectors, properties },
  );
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.HR_QA_CHROME });
  try {
    const ctx = await browser.newContext({
      timezoneId: 'Asia/Kolkata',
      locale: 'en-IN',
      serviceWorkers: 'block',
    });
    const ref = await ctx.newPage();
    await ref.goto(reference);
    const fixture = await ref.evaluate(() => ({
      success: true,
      today: HR.today,
      revision: 'visual-qa',
      state: HR.state,
    }));
    const auth = Buffer.from([process.env.HR_QA_USER, process.env.HR_QA_PASSWORD].join(':')).toString(
      'base64',
    );
    const login = await ctx.request.get(new URL('/apps/zenith/Hr/Dashboard', base).href, {
      headers: { Authorization: 'Basic ' + auth },
    });
    assert(login.ok() && !login.url().includes('Login'), 'Sign in to the disposable HR workspace');
    const page = await ctx.newPage();
    // Equal data, including the working date, makes the comparison independent of local fixture contents.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) return route.abort();
      if (url.pathname.endsWith('/readWorkspace')) return route.fulfill({ json: fixture });
      return route.continue();
    });
    const results = [],
      differences = [];
    for (const shell of ['apps', 'qapps']) {
      for (const [route, section] of Object.entries(pages)) {
        await page.goto(new URL('/' + shell + '/zenith/Hr/' + route, base).href, {
          waitUntil: 'domcontentloaded',
        });
        const actual = page.locator('#zc-hr-workspace #page-content');
        await actual.locator('h1').waitFor({ timeout: 25000 });
        await ref.evaluate((section) => HR.navigate(section), section);
        const expected = ref.locator('#page-content');
        assert.equal(await actual.locator('h1').innerText(), await expected.locator('h1').innerText());
        for (const width of widths) {
          await Promise.all([page, ref].map((p) => p.setViewportSize({ width, height: 900 })));
          // Quasar animates its drawer at breakpoints. Measure after the pane settles.
          await page.waitForTimeout(450);
          const box = await actual.boundingBox();
          assert(
            box.x >= -1 && box.x + box.width <= width + 1,
            shell + '/' + route + ' exceeds viewport ' + width,
          );
          await expected.evaluate((root, w) => {
            root.style.width = w + 'px';
          }, box.width);
          const [live, baseline] = await Promise.all([measure(actual), measure(expected)]);
          const label = shell + '/' + route + ' at ' + width;
          for (const sample of baseline) {
            const found = live.find((row) => row.selector === sample.selector);
            if (!found) {
              differences.push({ label, missing: sample.selector });
              continue;
            }
            for (const [i, key] of properties.entries()) {
              if (found.style[i] !== sample.style[i])
                differences.push({
                  label,
                  selector: sample.selector,
                  key,
                  actual: found.style[i],
                  expected: sample.style[i],
                });
            }
            for (const key of ['x', 'width', 'height']) {
              if (Math.abs(found[key] - sample[key]) > 2)
                differences.push({
                  label,
                  selector: sample.selector,
                  key,
                  actual: found[key],
                  expected: sample[key],
                });
            }
            if (section === 'dashboard' && Math.abs(found.y - sample.y) > 2)
              differences.push({
                label,
                selector: sample.selector,
                key: 'y',
                actual: found.y,
                expected: sample.y,
              });
          }
          results.push({ label, measured: live.length, contentWidth: box.width });
          if (shell === 'apps' && section === 'dashboard' && [390, 1440].includes(width))
            await page.screenshot({ path: path.join(output, 'dashboard-' + width + '.png') });
        }
      }
    }
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ results, differences }, null, 2));
    console.log(results.length + ' layouts, ' + differences.length + ' differences. ' + output);
    assert.equal(differences.length, 0, 'Inspect comparison.json for reference deviations');
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
