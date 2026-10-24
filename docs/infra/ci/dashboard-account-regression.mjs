// Disposable staging only: verify POS customization, account links and Remember Me.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { establishSession } from './session.mjs';
import { verifyDashboardLayout } from './dashboard-layout-preferences.mjs';

const base = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const url = new URL(base);
assert.equal(url.protocol, 'http:');
assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8080');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await establishSession(page, base, 'john.doe', 'moqui');
  for (const surface of ['apps', 'qapps']) {
    await verifyDashboardLayout(page, base, surface, surface === 'apps' ? join(process.env.RUNNER_TEMP || process.cwd(), 'pos-dashboard-customize-ci.png') : null);
  }

  // The fixture user has no MY_ACCOUNT_USERS membership. Header destinations
  // must open the own-user workspace, without granting access to SimpleScreens.
  const staff = await browser.newPage();
  await staff.setViewport({ width: 1366, height: 900 });
  await establishSession(staff, base, 'citest.a', 'moqui');
  const staffDashboard = `${base}/qapps/zenith/pos/Dashboard`;
  await staff.goto(staffDashboard, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#zq-toolbtns');
  const links = await staff.$$eval('#zq-toolbtns a[href]', nodes => nodes.map(a => ({ label: a.getAttribute('aria-label'), href: a.getAttribute('href') })));
  assert.equal(links.length, 3, 'Quasar header has unexpected account actions');
  for (const label of ['My Password', 'Notifications', 'My account']) {
    const link = links.find(item => item.label === label || item.label?.endsWith(`— ${label}`));
    assert(link, `Missing account action: ${label}`);
    if (label !== 'My Password') assert(link.href.startsWith('/apps/zenith/MyWorkspace?section='));
    const response = await staff.goto(base + link.href, { waitUntil: 'networkidle2' });
    assert.equal(response?.status(), 200, `${label}: HTTP ${response?.status()}`);
    assert(!staff.url().includes('/Login'), `${label}: redirected to login`);
    const body = await staff.$eval('body', node => node.innerText);
    assert(!/not authorized|permission denied|screen render exception/i.test(body), `${label}: authorization/render error`);
    assert(!body.includes("We couldn't load this account activity"), `${label}: account data did not load`);
    await staff.goto(staffDashboard, { waitUntil: 'networkidle2' });
    await staff.waitForSelector('#zq-toolbtns');
  }
  await staff.goto(`${base}/apps/zenith/pos/Dashboard`, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#z-app-toolbtns');
  const appsAccountLinks = await staff.$$eval('#z-app-toolbtns > a[href]', nodes => nodes.map(a => a.getAttribute('href')));
  for (const section of ['notifications', 'account'])
    assert(appsAccountLinks.some(href => href?.includes(`MyWorkspace?section=${section}`)), `/apps header missing ${section}`);
  assert(await staff.$('#z-app-toolbtns #history-menu-link'), '/apps recent pages control is missing');
  assert(await staff.$('#z-app-toolbtns > a[href="/apps/zenith/MyPassword"]'), '/apps password control is missing');
  await staff.goto(staffDashboard, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#zq-toolbtns');
  await staff.screenshot({ path: join(process.env.RUNNER_TEMP || process.cwd(), 'account-toolbar-ci.png') });
  const header = await staff.$eval('#zq-toolbtns', node => {
    const rect = node.getBoundingClientRect();
    const describe = element => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { tag: element.tagName, id: element.id, className: element.className,
        display: style.display, visibility: style.visibility, width: bounds.width, height: bounds.height };
    };
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: innerWidth,
      controls: [...node.children].map(item => item.getAttribute('aria-label')),
      bodyClass: document.body.className,
      ancestors: [node, node.parentElement, node.parentElement?.parentElement, node.closest('.q-header')].filter(Boolean).map(describe),
      toolbars: [...document.querySelectorAll('.q-header .q-toolbar')].map(describe) };
  });
  assert(header.width > 0 && header.x >= 0 && header.x + header.width <= header.viewport,
    `Account controls are outside the viewport: ${JSON.stringify(header)}`);
  assert.equal(header.controls.length, 4, 'Expected only recents, password, notifications and avatar');
  assert.equal(header.controls[0], 'Recent pages');
  await staff.click('#zq-toolbtns [aria-label="Recent pages"]');
  assert(await staff.$eval('body', node => node.innerText.includes('Screen History')), 'Recent pages did not open');
  await staff.reload({ waitUntil: 'networkidle2' });
  assert(await staff.$('#zq-toolbtns [aria-label="Recent pages"]'), 'Recent pages missing after reload');
  console.log('PASS shared account destinations and four-control header for staff');

  // A signed-in user's Contacts tab choices must persist and appear in both shells.
  await staff.goto(`${base}/apps/zenith/Contacts/ContactsDashboard`, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#z-subnav .zsn-trigger:not([disabled])');
  await staff.click('#z-subnav .zsn-trigger');
  await staff.click('.zsn-row[data-id="/Contacts/Vendors"] .zsn-toggle');
  await staff.click('.zsn-row[data-id="/Contacts/Customers"] [data-direction="-1"]');
  await staff.click('.zsn-row[data-id="/Contacts/Customers"] [data-direction="-1"]');
  await staff.click('.zsn-save');
  await staff.waitForFunction(() => !document.querySelector('.zsn-drawer'));
  await staff.reload({ waitUntil: 'networkidle2' });
  await staff.waitForSelector('#z-subnav .zsn-trigger:not([disabled])');
  const appsTabs = await staff.$$eval('#z-subnav .zsub-grp.show .zsub-tab', nodes => nodes.filter(node => !node.hidden).map(node => node.dataset.match));
  assert.equal(appsTabs[0], '/Contacts/Customers', 'Saved Contacts tab order was lost on reload');
  assert(!appsTabs.includes('/Contacts/Vendors'), 'Hidden Contacts tab returned on reload');
  await staff.goto(`${base}/qapps/zenith/Contacts/ContactsDashboard`, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#zq-subnav .zsn-trigger:not([disabled])');
  const qappsTabs = await staff.$$eval('#zq-subnav .zqsub-tab', nodes => nodes.filter(node => !node.hidden).map(node => node.dataset.match));
  assert.equal(qappsTabs[0], '/Contacts/Customers', 'Saved Contacts order did not reach /qapps');
  assert(!qappsTabs.includes('/Contacts/Vendors'), 'Hidden Contacts tab did not reach /qapps');
  await staff.click('#zq-subnav .zsn-trigger');
  await staff.click('.zsn-reset');
  await staff.click('.zsn-save');
  await staff.waitForFunction(() => !document.querySelector('.zsn-drawer'));
  assert(await staff.$eval('#zq-subnav .zqsub-tab[data-match="/Contacts/Vendors"]', node => !node.hidden), 'Reset did not restore the default tab');
  console.log('PASS Contacts tab reorder/hide persistence across both shells and reset');

  // The ERP home dashboard uses the same shell and account toolbar as every module.
  await staff.goto(`${base}/qapps/zenith/Dashboard`, { waitUntil: 'networkidle2' });
  await staff.waitForSelector('#zq-toolbtns');
  const homeLinks = await staff.$$eval('#zq-toolbtns a', nodes => nodes.map(node => ({
    label: node.getAttribute('aria-label'), href: node.getAttribute('href'), width: node.getBoundingClientRect().width,
  })));
  for (const [label, section] of [['Notifications', 'notifications']]) {
    const link = homeLinks.find(item => item.label?.includes(label));
    assert(link?.width > 0 && link.href === `/apps/zenith/MyWorkspace?section=${section}`, `Home ${label} action is unavailable`);
  }
  assert(await staff.$('#zq-toolbtns [aria-label="Recent pages"]'), 'Home recent pages action is unavailable');
  assert(homeLinks.some(item => item.label?.includes('My account') && item.width > 0), 'Home account action is unavailable');
  assert(await staff.$eval('#zq-sidebar', node => node.getBoundingClientRect().width > 0), 'Home dashboard shared sidebar is unavailable');
  assert(await staff.$eval('#zq-subnav', node => node.getBoundingClientRect().height > 0), 'Home dashboard shared module navigation is unavailable');
  assert(!(await staff.$('#homeUtilities')), 'Home dashboard still renders duplicate account utilities');
  console.log('PASS shared home dashboard shell and account utilities');

  const postLogin = async remember => {
    const body = new URLSearchParams({ organizationId: 'CITEST_A', username: 'citest.a', password: 'moqui', rememberMeSubmitted: 'Y' });
    if (remember) body.set('rememberMe', 'true');
    const response = await fetch(`${base}/Login/login`, { method: 'POST', body, redirect: 'manual' });
    assert(response.status >= 300 && response.status < 400, `Login returned ${response.status}`);
    return response.headers.getSetCookie().filter(value => value.startsWith('moquiLoginKey='));
  };
  const rememberCookie = (await postLogin(true)).find(value => /Max-Age=2592000/i.test(value));
  assert(rememberCookie?.includes('HttpOnly') && /Max-Age=2592000/i.test(rememberCookie), 'Remember Me did not issue a persistent HttpOnly key');
  const key = rememberCookie.split(';')[0];
  const resumed = await fetch(`${base}/Login`, { headers: { Cookie: key }, redirect: 'manual' });
  assert(resumed.status >= 300 && resumed.status < 400, 'Remembered key did not resume login');
  assert(resumed.headers.get('location')?.includes('/qapps/zenith/Dashboard'));
  const isClearedKey = value => value.startsWith('moquiLoginKey=;') &&
    (/Max-Age=0/i.test(value) || /Expires=Thu, 01 Jan 1970/i.test(value));
  const forgotten = await postLogin(false);
  assert(forgotten.some(isClearedKey),
    `Unchecked Remember Me did not clear the old browser key: ${JSON.stringify(forgotten.map(value => value.replace(/moquiLoginKey=[^;]*/, 'moquiLoginKey=<redacted>')))}`);
  const invalid = await fetch(`${base}/Login`, { headers: { Cookie: 'moquiLoginKey=invalid' }, redirect: 'manual' });
  assert.equal(invalid.status, 200, 'Invalid key did not return to login');
  assert(invalid.headers.getSetCookie().some(isClearedKey));
  console.log('PASS Remember Me issue/resume/clear/invalid-key cases');
} finally {
  await browser.close();
}
