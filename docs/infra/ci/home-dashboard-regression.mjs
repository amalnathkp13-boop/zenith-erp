// Read-only checks. Optional HOME_DASH_FIXTURE=1 expects seed/home-dashboard-local.sql.
// Import that fixture on the local demo DB, run with the flag, then apply its exact-id cleanup SQL.
import assert from 'node:assert/strict';
const base = process.env.HOME_DASH_URL || 'http://localhost:8080';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Run against a local verification environment');
const auth = 'Basic ' + Buffer.from(`${process.env.SMOKE_USER || 'john.doe'}:${process.env.SMOKE_PASS || 'moqui'}`).toString('base64');
const route = '/apps/zenith/Dashboard';
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function page(query = '', suffix = '') {
  const response = await fetch(base + route + suffix + query, { headers: { Authorization: auth }, redirect: 'manual' });
  assert.equal(response.status, 200, query);
  const html = await response.text();
  assert(!/Error rendering|Exception running|ScreenRenderException|could not be loaded/.test(html), query);
  const match = html.match(/id="homeDashboard" data-config="([^"]+)"/);
  assert(match, 'Home dashboard rendered');
  return { html, config: JSON.parse(decode(match[1])) };
}
const anonymous = await fetch(base + route, { redirect: 'manual' });
assert([302, 303].includes(anonymous.status), 'Anonymous users are redirected');
assert.match(anonymous.headers.get('location'), /Login/);
const all = await page();
assert.equal(all.config.weekly.cats.length, 7, 'Weekly keeps seven days when the dashboard defaults to Today');
const spa = await page('?showSettings=1', '.qvt');
assert.equal(spa.config.saveUrl, '/apps/zenith/Dashboard/saveDashOrder', 'SPA render suffix is removed from transition URLs');
for (const query of ['?dashDate=invalid', '?dashDate=2026-02-30', '?dashDate=2026-10-07%22%3E%3Cscript%3E']) {
  assert.match((await page(query)).html, /Choose valid dates/);
}
const reversed = await page('?dashDate=2026-10-07&dashDateTo=2026-10-01');
assert.equal(reversed.config.weekly.cats.length, 7);
assert.equal(reversed.config.weekly.sub, '2026-10-01 to 2026-10-07');
const endOnly = await page('?dashDateTo=2026-10-07');
assert.equal(endOnly.config.weekly.cats.length, 7);
assert.equal(endOnly.config.weekly.sub, '2026-10-01 to 2026-10-07');
const long = await page('?dashDate=2025-01-31&dashDateTo=2025-05-31');
assert.deepEqual(long.config.weekly.cats, ['Jan 25', 'Feb 25', 'Mar 25', 'Apr 25', 'May 25']);
const century = await page('?dashDate=1900-01-01&dashDateTo=2026-10-07');
assert(century.config.weekly.cats.length <= 400, 'Long ranges use bounded annual buckets');
const settings = await page('?dashDate=2026-10-07&showSettings=1');
assert(settings.config.customize);
assert.match(settings.html, /showSettings=0/);
assert.match(settings.html, /action="\/apps\/zenith\/Dashboard"/);
for (const destination of ['/apps/zenith/pos/Terminal', '/apps/zenith/Purchase/CreatePurchaseOrder', '/apps/zenith/sales/CreateInvoice', '/apps/zenith/Purchase/CreatePurchaseInvoice', '/apps/zenith/Accounting/AutoBrs', '/apps/zenith/Contacts/FindContact?newContact=1']) {
  assert(all.html.includes(destination), destination);
  const response = await fetch(base + destination, { headers: { Authorization: auth } });
  const html = await response.text();
  assert.equal(response.status, 200, destination);
  assert(!/Error rendering|Exception running|ScreenRenderException/.test(html), destination);
}
if (process.env.HOME_DASH_FIXTURE === '1') {
  const fixtureDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day = await page('?dashDate=' + fixtureDate);
  const values = [...day.html.matchAll(/class="zsc-num">&#8377;([^<]+)/g)].map(match => decode(match[1]));
  assert.deepEqual(values, ['301', '120', '110.25', '100']);
  assert.equal(day.config.weekly.total, 301);
  assert.equal(day.config.hourly.series[0], 100.25);
  assert.equal(day.config.hourly.series[23], 200.75);
  assert.equal(day.config.hourly.total, 301);
  assert(day.html.includes('No due date'));
  assert(!day.html.includes('Due in 999'));
  assert(!day.html.includes('AUDIT_HOME_PPAID'));
  assert(!day.html.includes('AUDIT_HOME_PDRAFT'));
  assert(!day.html.includes('AUDIT_HOME_OTHER'));
  assert(!day.html.includes('AUDIT_HOME_OLD'));
  assert(day.html.includes('Dashboard test product'));
}
console.log('PASS: authentication, date validation/bounds, monthly buckets, filter context, six action destinations' + (process.env.HOME_DASH_FIXTURE === '1' ? ', financial balances, tenant scope and midnight sales.' : '.'));
