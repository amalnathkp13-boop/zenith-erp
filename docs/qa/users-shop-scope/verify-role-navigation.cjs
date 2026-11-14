// Runs against the guarded, disposable users/shop scope runtime only.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:18086';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.USERS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const admin = await browser.newContext();
        const adminPage = await admin.newPage();
        const user = 'role.nav.' + randomUUID().slice(0, 8), password = 'Qa9!' + randomUUID();
        const routes = ['/Hr/MyProfile', '/Inventory/StockLevels'];
        const transfers = '/Inventory/StockTransfers';
        const posBilling = '/pos/Terminal', kotBilling = '/kot/KotBilling';
        const billingFallbacks = ['/pos/PosTransactions', '/kot/PosTransactions'];
        const editor = '/apps/zenith/Settings/RoleEditor';
        const users = '/apps/zenith/Settings/Users';
        const terminals = '/apps/zenith/pos/PosTerminals';
        const qa = '/apps/zenith/Settings/AccessQa/probe';
        const basic = (username) => ({ Authorization: 'Basic ' + Buffer.from(username + ':moqui').toString('base64') });
        async function token(ctx, route) {
            const response = await ctx.request.get(base + route);
            const html = await response.text();
            const match = html.match(/name="moquiSessionToken" value="([^"]+)"/) || html.match(/data-token="([^"]+)"/);
            assert.ok(match, 'Authorized form token: ' + route);
            return match[1];
        }
        if (!process.env.USERS_QA_SKIP_INIT) {
            const bootstrap = await browser.newContext();
            const contacts = '/apps/zenith/Contacts/Customers';
            await bootstrap.request.get(base + contacts, { headers: basic('john.doe') });
            const result = await bootstrap.request.post(base + '/apps/zenith/pos/PosQaAcceptance/initialize', {
                form: { moquiSessionToken: await token(bootstrap, contacts) }
            });
            assert.ok((await result.json()).initialized, 'initialized disposable fixture');
            await bootstrap.close();
        }
        await admin.request.get(base + users, { headers: basic('pos.qa') });
        const csrf = await token(admin, users);
        const post = (route, fields) => admin.request.post(base + route, { form: { moquiSessionToken: csrf, ...fields } });
        assert.equal((await (await post(qa, { op: 'roleNavigationPlan', planId: 'PROFESSIONAL' })).json()).planId, 'PROFESSIONAL');
        const selections = { hr: [routes[0]], inventory: [routes[1], transfers],
            pos: [posBilling, billingFallbacks[0]], kot: [kotBilling, billingFallbacks[1]] };
        const saved = await post(editor + '/saveRole', { roleName: user, selectionsJson: JSON.stringify(selections) });
        const roleId = new URL(saved.url()).searchParams.get('userGroupId');
        assert.match(roleId || '', /^ZENITH_ORG_/);
        await post(users + '/createUser', { username: user, userFullName: 'Sample role clerk', newPassword: password, newPasswordVerify: password });
        await adminPage.goto(base + users + '?searchTerm=' + user);
        const userId = await adminPage.locator('tr').filter({ hasText: user }).locator('input[name=userId]').first().inputValue();
        await post(users + '/saveRoles', { userId, selectedRoles: roleId });
        await post(terminals + '/saveAssignment', { userId, terminalId: 'POS_QA_A_TERM1' });

        const staff = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await staff.newPage();
        await staff.request.get(base + '/Login');
        const login = await staff.request.post(base + '/Login/login', {
            form: { initialTab: 'login', organizationId: 'POS_QA_A', username: user, password }
        });
        assert.match(new URL(login.url()).pathname, /\/zenith\/(Hr\/MyProfile|Inventory\/StockLevels)$/);
        assert.deepEqual((await (await staff.request.get(base + '/apps/zenith/getSidebarConfiguration')).json()).allowedIds.sort(), ['/Hr', '/Inventory', '/kot', '/pos']);
        for (const shell of ['apps', 'qapps']) {
            const prefix = '/' + shell + '/zenith';
            const sidebar = shell === 'apps' ? '#z-sidebar .zs-link' : '#zq-sidebar .zqs-link';
            const tabs = shell === 'apps' ? '#z-subnav .zsub-tab' : '#zq-subnav .zqsub-tab';
            assert.equal((await page.goto(base + prefix + routes[0], { waitUntil: 'domcontentloaded' })).status(), 200);
            await page.locator(sidebar + '[data-match="/Inventory"]:visible').waitFor();
            assert.equal(await page.locator(sidebar + '[data-match="/Inventory"] .material-icons').textContent(),
                'inventory_2', shell + ' custom roles use the original Inventory icon');
            assert.equal(await page.locator(sidebar + '[data-match="/Hr"] .material-icons').textContent(),
                'badge', shell + ' custom roles give HR a module-specific icon');
            const targets = await page.locator(sidebar + ':visible').evaluateAll(links => links.map(link => new URL(link.href).pathname).sort());
            assert.deepEqual(targets, [...routes.map(route => prefix + route), '/apps/zenith' + posBilling,
                prefix + kotBilling].sort());
            await page.locator(sidebar + '[data-match="/Inventory"]').click();
            await page.waitForURL(base + prefix + routes[1]);
            await page.locator(tabs + '[data-match="/Inventory/StockLevels"]:visible').waitFor();
            await page.getByRole('heading', { name: 'Stock Levels', exact: true }).waitFor();
            assert.deepEqual(await page.locator(tabs + ':visible').evaluateAll(links => links.map(link => link.dataset.match).sort()), [routes[1], transfers]);
            await page.locator(tabs + '[data-match="' + transfers + '"]').click();
            await page.waitForURL(base + prefix + transfers);
            await page.getByRole('heading', { level: 3, name: 'Stock Transfers', exact: true }).waitFor();
            const allowed = await staff.request.get(base + prefix + routes[1], { maxRedirects: 0 });
            assert.equal(allowed.status(), 200, shell + ' selected Stock Levels opens');
            const denied = await staff.request.get(base + prefix + '/Inventory/InventoryDashboard', { maxRedirects: 0 });
            assert.equal(denied.status(), 403, shell + ' unselected dashboard is denied');
            await page.goto(base + prefix + '/Inventory/InventoryDashboard');
            await page.waitForURL(base + '/apps/zenith/AccessDenied');
            await page.getByRole('heading', { name: 'Access denied for your user ID' }).waitFor();
            assert.equal(await page.locator('.z-workspace a[href*="InventoryDashboard"]').count(), 0);
            console.log('PASS: ' + shell + ' shows and opens only assigned modules and tabs');
        }
        await page.goto(base + '/qapps/zenith/Inventory/StockLevels');
        await page.waitForFunction(() => !!window.moqui?.webrootVue?.navMenuList?.length);
        await page.evaluate(() => moqui.webrootVue.setUrl('/qapps/zenith/Inventory/InventoryDashboard'));
        await page.waitForURL(base + '/apps/zenith/AccessDenied');
        await page.getByRole('heading', { name: 'Access denied for your user ID' }).waitFor();
        for (const mount of ['pos', 'kot']) {
            const setup = await staff.request.get(base + '/apps/zenith/' + mount + '/PosTerminals', { maxRedirects: 0 });
            assert.equal(setup.status(), 403, mount + ' terminal setup remains owner-only');
        }
        const forbiddenPost = await staff.request.post(base + users + '/saveRoles', { maxRedirects: 0,
            form: { moquiSessionToken: await token(staff, '/apps/zenith/MyPassword'), userId, selectedRoles: roleId } });
        assert.equal(forbiddenPost.status(), 403, 'disallowed actions are forbidden without a redirect');
        const billingUrls = [];
        for (const [index, billing] of [posBilling, kotBilling].entries()) {
            const path = '/apps/zenith' + billing;
            await page.goto(base + path);
            const opened = await staff.request.post(base + path + '/openSession', { maxRedirects: 0,
                form: { moquiSessionToken: await token(staff, '/apps/zenith/MyPassword'),
                    terminalId: 'POS_QA_A_TERM1', openingCash: '0' } });
            assert.match(opened.headers().location || '', /sessionId=/, billing + ' opens a session');
            const billingUrl = new URL(opened.headers().location, base).href;
            billingUrls.push(billingUrl);
            await page.goto(billingUrl);
            const back = page.locator('.nb-back');
            assert.equal(await back.getAttribute('href'), '/apps/zenith' + billingFallbacks[index]);
            assert.equal(await page.getByRole('link', { name: 'Manage counters' }).count(), 0);
            await back.click();
            await page.waitForURL(base + '/apps/zenith' + billingFallbacks[index]);
            const tabs = await page.locator('#z-subnav .zsub-tab:visible').evaluateAll(links => links.map(link => link.dataset.match).sort());
            assert.deepEqual(tabs, [billing, billingFallbacks[index]].sort(), 'tabs exclude withheld and owner-only screens');
            console.log('PASS: ' + billing + ' Back opens an assigned page');
        }
        assert.equal((await (await post(qa, { op: 'roleNavigationPlan', planId: 'STARTER' })).json()).planId, 'STARTER');
        assert.deepEqual((await (await staff.request.get(base + '/apps/zenith/getSidebarConfiguration')).json()).allowedIds.sort(), ['/Inventory', '/kot', '/pos']);
        console.log('PASS: login and plan limits use assigned navigation');
        await post(editor + '/saveRole', { userGroupId: roleId, roleName: user,
            selectionsJson: JSON.stringify({ pos: [posBilling], kot: [kotBilling] }) });
        for (const billingUrl of billingUrls) {
            await page.goto(billingUrl);
            await page.locator('.nb-back').click();
            await page.waitForURL(base + '/apps/zenith/AccessDenied');
            await page.getByRole('heading', { name: 'Access denied for your user ID' }).waitFor();
            const workspaceLinks = await page.locator('.z-workspace-actions a').evaluateAll(links => links.map(link => new URL(link.href).pathname).sort());
            assert.deepEqual(workspaceLinks, [kotBilling, posBilling].map(route => '/apps/zenith' + route));
        }
        console.log('PASS: billing-only roles return to their workspace without granting dashboard access');
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
