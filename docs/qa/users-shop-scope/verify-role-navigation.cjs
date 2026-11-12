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
        const editor = '/apps/zenith/Settings/RoleEditor';
        const users = '/apps/zenith/Settings/Users';
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
        const saved = await post(editor + '/saveRole', {
            roleName: user, selectionsJson: JSON.stringify({ hr: [routes[0]], inventory: [routes[1], transfers] })
        });
        const roleId = new URL(saved.url()).searchParams.get('userGroupId');
        assert.match(roleId || '', /^ZENITH_ORG_/);
        await post(users + '/createUser', { username: user, userFullName: 'Sample role clerk', newPassword: password, newPasswordVerify: password });
        await adminPage.goto(base + users + '?searchTerm=' + user);
        const userId = await adminPage.locator('tr').filter({ hasText: user }).locator('input[name=userId]').first().inputValue();
        await post(users + '/saveRoles', { userId, selectedRoles: roleId });

        const staff = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await staff.newPage();
        await staff.request.get(base + '/Login');
        const login = await staff.request.post(base + '/Login/login', {
            form: { initialTab: 'login', organizationId: 'POS_QA_A', username: user, password }
        });
        assert.match(new URL(login.url()).pathname, /\/zenith\/(Hr\/MyProfile|Inventory\/StockLevels)$/);
        assert.equal((await (await staff.request.get(base + '/apps/zenith/getSidebarConfiguration')).json()).allowedIds.sort().join(','), '/Hr,/Inventory');
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
            assert.deepEqual(targets, routes.map(route => prefix + route));
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
            console.log('PASS: ' + shell + ' shows and opens only assigned modules and tabs');
        }
        assert.equal((await (await post(qa, { op: 'roleNavigationPlan', planId: 'STARTER' })).json()).planId, 'STARTER');
        assert.deepEqual((await (await staff.request.get(base + '/apps/zenith/getSidebarConfiguration')).json()).allowedIds, ['/Inventory']);
        console.log('PASS: login and plan limits use assigned navigation');
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
