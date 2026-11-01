// Only a fresh, synthetic POS_QA fixture on the dedicated loopback runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const base = process.env.USERS_QA_BASE || 'http://127.0.0.1:18086';
assert.match(base, /^http:\/\/127\.0\.0\.1:18086$/);
const out = process.env.USERS_QA_OUT || path.resolve('output/users-shop-scope');
fs.mkdirSync(out, { recursive: true });
const report = { productionWrites: false, checks: [] };
function check(name, value) { assert.ok(value, name); report.checks.push(name); console.log('PASS: ' + name); }
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.USERS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        if (!process.env.USERS_QA_SKIP_INIT) {
        const bootstrap = await browser.newContext();
        await bootstrap.request.get(base + '/apps/zenith/Contacts/Customers', { headers: { Authorization: 'Basic ' + Buffer.from('john.doe:moqui').toString('base64') } });
        const bp = await bootstrap.newPage(); await bp.goto(base + '/apps/zenith/Contacts/Customers');
        const token = await bp.locator('[name=moquiSessionToken]').first().inputValue();
        const init = await bootstrap.request.post(base + '/apps/zenith/pos/PosQaAcceptance/initialize', { form: { moquiSessionToken: token } });
        check('fresh synthetic fixture initialized', init.status() === 200 && (await init.json()).initialized);
        await bootstrap.close();
        }
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await context.request.get(base + '/apps/zenith/Settings/Users', { headers: { Authorization: 'Basic ' + Buffer.from('pos.qa:moqui').toString('base64') } });
        const page = await context.newPage();
        async function tokenAt(ctx, url = '/apps/zenith/Settings/Users') {
            const r = await ctx.request.get(base + url); const html = await r.text();
            const m = html.match(/name="moquiSessionToken" value="([^"]+)"/) || html.match(/id="z-shopdata"[^>]*data-token="([^"]+)"/);
            const token = m ? m[1] : r.headers()['moquisessiontoken'] || r.headers()['x-csrf-token'];
            assert.ok(token, 'CSRF token available on authorized page'); return token;
        }
        async function post(ctx, route, fields) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(fields)) for (const v of [].concat(value)) params.append(key, v);
            return ctx.request.post(base + route, { data: params.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        }
        let csrf = await tokenAt(context);
        async function probe(op, extra = {}) {
            const r = await post(context, '/apps/zenith/Settings/AccessQa/probe', {moquiSessionToken: csrf, op, ...extra});
            assert.equal(r.status(),200, 'disposable helper ' + op); return r.json();
        }
        check('two-shop fixture prepared in disposable database', (await probe('prepare')).prepared);
        page.on('pageerror', error => { report.pageErrors = [...(report.pageErrors || []), error.message]; });
        for (const shell of ['apps', 'qapps']) {
            const response = await page.goto(`${base}/${shell}/zenith/Settings/Users`);
            check(shell + ' Users renders successfully', response.status() === 200 && await page.locator('.z-users-page h1').innerText() === 'Users');
            check(shell + ' table has four readable columns', await page.locator('.z-users-card').innerText().then(t => ['User','Status','Access roles','Actions'].every(s => t.includes(s))));
            check(shell + ' Add user and Create role available', await page.locator('.z-users-actions').getByText('Add user',{exact:true}).first().isVisible() && await page.locator('.z-users-actions').getByText('Create role',{exact:true}).isVisible());
            check(shell + ' sensitive account actions stay inside menu', await page.getByRole('button',{name:'Disable account',exact:true}).first().isHidden());
            await page.screenshot({path:path.join(out,shell+'-users.png')});
            check(shell+' shared Settings heading is not duplicated on Users', await page.getByText('Settings & Custom Roles',{exact:true}).isHidden());
            await page.locator('input[name=searchTerm]').fill('no-such-synthetic-user');
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await page.waitForLoadState('networkidle');
            check(shell + ' no-results state', await page.locator('.z-users-empty').isVisible());
            await page.goto(`${base}/${shell}/zenith/Settings/RoleEditor`);
            await page.locator('#z-role-save:not([disabled])').waitFor();
            check(shell+' shared Settings heading is not duplicated on role editor', await page.getByText('Settings & Custom Roles',{exact:true}).isHidden());
            check(shell + ' module catalogue loaded from configuration', await page.locator('.z-role-module').count() > 10);
            check(shell + ' no action-level permission matrix', await page.locator('#z-role-editor').innerText().then(t => !/Apply.to.all|Approve permission|Export permission|Full Access|View Only/.test(t)));
            const pos = page.locator('.z-role-module').filter({ has: page.locator('#role-module-pos') });
            await pos.locator('input[type=checkbox]').check();
            check(shell + ' enabling module never grants every submodule', JSON.parse(await page.locator('#z-role-selection').inputValue()).pos === undefined);
            await pos.getByRole('button', { name: 'Customize' }).click();
            await page.locator('#z-role-all-screens').check();
            check(shell + ' select all applies to current module only', Object.keys(JSON.parse(await page.locator('#z-role-selection').inputValue())).join() === 'pos');
            await pos.locator('input[type=checkbox]').uncheck();
            check(shell + ' module off clears stale child selections', await page.locator('#z-role-selection').inputValue() === '{}');
            await page.screenshot({ path: path.join(out, shell + '-role-editor.png') });
        }
        await page.goto(base + '/qapps/zenith/Settings/RoleEditor');
        await page.locator('#z-role-save:not([disabled])').waitFor();
        const catalogue = JSON.parse(await page.locator('#z-role-editor').getAttribute('data-catalogue'));
        const posMod = catalogue.find(m=>m.id==='pos');
        const dashboard = posMod.screens.find(s=>s.id==='/pos/Dashboard');
        assert.ok(dashboard, 'mounted POS Dashboard exists');
        await page.locator('#role-module-pos').check();
        await page.locator('.z-role-module').filter({has:page.locator('#role-module-pos')}).getByRole('button',{name:'Customize'}).click();
        await page.locator('.z-role-screen').nth(posMod.screens.indexOf(dashboard)).locator('input').check();
        const selection = await page.locator('#z-role-selection').inputValue();
        await page.locator('[name=roleName]').fill('Synthetic Dashboard Clerk');
        await Promise.all([page.waitForURL(/userGroupId=ZENITH_ORG_/),page.locator('#z-role-save').click()]);
        const roleId = new URL(page.url()).searchParams.get('userGroupId');
        let state = await probe('inspect');
        const saved = state.roles.find(r=>r.id===roleId);
        check('new role persisted exact selections', saved && saved.selections === selection);
        check('role creation does not assign users', !state.memberships.some(m=>m.role===roleId));
        check('custom entity authorization preserves organization filter', state.entityFilters.every(n=>n===1));
        await page.reload(); await page.locator('#z-role-save:not([disabled])').waitFor();
        check('reopening saved role restores exact selections', await page.locator('#z-role-selection').inputValue() === selection);
        await page.goto(base+'/apps/zenith/Settings/Users');
        check('saved role library renders a usable edit link without template errors', await page.locator('.z-users-role-library a').getAttribute('href').then(h=>new URL(h,base+'/apps/zenith/Settings/Users').searchParams.get('userGroupId')===roleId) && !(await page.locator('.z-users-page').innerText()).includes('FTL stack trace'));
        await page.locator('.z-users-role-library a').click();
        await page.locator('#z-role-save:not([disabled])').waitFor();
        check('saved role opens from Users with restored selections', await page.locator('#z-role-selection').inputValue()===selection);
        csrf = await tokenAt(context);
        await post(context,'/apps/zenith/Settings/RoleEditor/saveRole',{moquiSessionToken:csrf,roleName:'synthetic dashboard clerk',selectionsJson:selection});
        check('case-insensitive duplicate rejected with no extra record', (await probe('inspect')).roles.length===1);
        await post(context,'/apps/zenith/Settings/RoleEditor/saveRole',{moquiSessionToken:csrf,roleName:'Empty role',selectionsJson:'{}'});
        await post(context,'/apps/zenith/Settings/RoleEditor/saveRole',{moquiSessionToken:csrf,roleName:'Invalid screen',selectionsJson:'{"pos":["/pos/Invented"]}'});
        check('empty and forged submodule requests rejected by server', (await probe('inspect')).roles.length===1);
        const orgB = await browser.newContext();
        await orgB.request.get(base+'/apps/zenith/Settings/Users',{headers:{Authorization:'Basic '+Buffer.from('pos.b.qa:moqui').toString('base64')}});
        const tokenB = await tokenAt(orgB);
        await post(orgB,'/apps/zenith/Settings/RoleEditor/saveRole',{moquiSessionToken:tokenB,roleName:'Synthetic Dashboard Clerk',selectionsJson:selection});
        const bResponse = await post(orgB,'/apps/zenith/Settings/AccessQa/probe',{moquiSessionToken:tokenB,op:'inspect'});
        const stateB = await bResponse.json();
        check('same role name allowed in another organization', stateB.roles.length===1 && stateB.roles[0].id!==roleId);
        const foreignEntity = await orgB.request.get(base+'/rest/e1/zenith.erp.base.OrganizationAccessRole/'+roleId,{headers:{'X-CSRF-Token':tokenB}});
        check('tenant admin entity API cannot read another organization role', foreignEntity.status()>=400 || !(await foreignEntity.text()).includes(roleId));
        const foreignEdit = await orgB.request.get(base+'/apps/zenith/Settings/RoleEditor?userGroupId='+roleId);
        check('foreign role cannot be opened', foreignEdit.status()===403);
        await post(orgB,'/apps/zenith/Settings/RoleEditor/saveRole',{moquiSessionToken:tokenB,userGroupId:roleId,roleName:'Foreign overwrite',selectionsJson:selection});
        check('foreign role update cannot alter saved metadata', (await probe('inspect')).roles.find(r=>r.id===roleId).name==='Synthetic Dashboard Clerk');
        const password = 'Qa9!' + crypto.randomUUID();
        await post(context,'/apps/zenith/Settings/Users/createUser',{moquiSessionToken:csrf,username:'scope.qa@example.com',userFullName:'Synthetic scope clerk',newPassword:password,newPasswordVerify:password});
        await page.goto(base+'/apps/zenith/Settings/Users');
        const row = page.locator('tr').filter({has:page.getByText('scope.qa@example.com',{exact:true})});
        const newUserId = await row.locator('input[name=userId]').first().inputValue();
        check('Add user creates real organization-linked account', !!newUserId);
        await post(context,'/apps/zenith/Settings/Users/saveRoles',{moquiSessionToken:csrf,userId:newUserId,selectedRoles:['ZENITH_ALL',roleId]});
        await page.goto(base+'/apps/zenith/Settings/Users?searchTerm=scope.qa&statusFilter=active&roleFilter='+roleId);
        check('name/status/role filters combine', await page.locator('.z-user-email').allTextContents().then(a=>a.length===1 && a[0]==='scope.qa@example.com'));
        await page.locator('button[data-target^="#AssignRoleDialog"]').first().click();
        check('Manage roles reopens with all assigned roles selected', await page.locator('.modal.in select[name=selectedRoles]').evaluate((e,role)=>{const ids=Array.from(e.selectedOptions).map(o=>o.value);return ids.includes(role)&&ids.includes('ZENITH_ALL');},roleId));
        await page.locator('.modal.in .close').first().click();
        const deniedAssign = await post(context,'/apps/zenith/Settings/Users/saveRoles',{moquiSessionToken:csrf,userId:newUserId,selectedRoles:[stateB.roles[0].id]});
        await page.goto(base+'/apps/zenith/Settings/Users?roleFilter='+roleId);
        check('foreign role assignment rejected without changing existing roles', await page.getByText('scope.qa@example.com',{exact:true}).isVisible());
        await post(context,'/apps/zenith/Settings/Users/saveRoles',{moquiSessionToken:csrf,userId:'POS_QA_MANAGER',selectedRoles:['ZENITH_ALL',roleId]});
        check('last organization administrator cannot be removed', (await probe('inspect')).memberships.some(m=>m.userId==='POS_QA_MANAGER' && m.role==='ZENITH_ADMIN'));
        const clerk = await browser.newContext();
        const allowed = await clerk.request.get(base+dashboard.id.replace(/^/,'/apps/zenith'),{headers:{Authorization:'Basic '+Buffer.from('scope.qa@example.com:'+password).toString('base64')}});
        check('assigned role can open selected submodule', allowed.status()===200 && (await allowed.text()).includes('POS Overview'));
        const denied = await clerk.request.get(base+'/apps/zenith/pos/Reports');
        check('unselected submodule never renders its report', denied.status()===403 || new URL(denied.url()).pathname.endsWith('/Dashboard'));
        const foreignModule = await clerk.request.get(base+'/apps/zenith/Inventory/FindProduct');
        check('unselected module cannot expose product data', foreignModule.status()===403 || new URL(foreignModule.url()).pathname.endsWith('/Dashboard'));
        const cToken = await tokenAt(clerk,'/apps/zenith/pos/Dashboard');
        const direct = await clerk.request.get(base+'/rest/e1/zenith.erp.base.OrganizationAccessRole/'+stateB.roles[0].id,{headers:{'X-CSRF-Token':cToken}});
        check('direct entity API cannot read foreign role', direct.status()===403);
        const cp = await clerk.newPage(); await cp.goto(base+'/qapps/zenith/pos/Dashboard');
        await cp.locator('.pos-dash-metric').first().waitFor();
        check('restricted role renders in Quasar shell', await cp.locator('#zq-subnav .zqsub-tab:visible').allTextContents().then(a=>a.length===1 && a[0]==='Dashboard'));
        await cp.close();
        const transition = await post(clerk,'/apps/zenith/Settings/Users/createUser',{moquiSessionToken:cToken,username:'illegal.qa',userFullName:'Illegal user'});
        check('unselected write transition rejected', transition.status()>=400);
        const noCsrf = await post(context,'/apps/zenith/Settings/RoleEditor/saveRole',{roleName:'Missing CSRF',selectionsJson:selection});
        check('role creation rejects missing CSRF', noCsrf.status()>=400);
        let scope = await probe('scope',{facilityId:'POS_QA_A_FAC'});
        check('registered shop list excludes orphan onboarding facilities', scope.shopCount===2);
        check('one shop includes both operators and counters', scope.sessionIds.includes('POS_QA_SCOPE_SESSION1') && scope.sessionIds.includes('POS_QA_SCOPE_SESSION2') && !scope.sessionIds.includes('POS_QA_SCOPE_SESSION3'));
        scope = await probe('scope',{facilityId:'POS_QA_A_FAC2'});
        check('second shop has only its own counter session', scope.sessionIds.includes('POS_QA_SCOPE_SESSION3') && !scope.sessionIds.includes('POS_QA_SCOPE_SESSION1'));
        const switched = await post(context,'/apps/zenith/setActiveShop',{moquiSessionToken:csrf,facilityId:'POS_QA_A_FAC',returnUrl:'/apps/zenith/pos/Dashboard?dashLoc=POS_QA_A_TERM1&dashDate=2026-01-15&chartMode=daily'});
        check('shop switch removes stale counter and keeps date/chart filters', !switched.url().includes('dashLoc=') && switched.url().includes('dashDate=2026-01-15') && switched.url().includes('chartMode=daily'));
        const malformed = await post(context,'/apps/zenith/setActiveShop',{moquiSessionToken:csrf,facilityId:'',returnUrl:'http://[invalid'});
        check('malformed return URL safely falls back locally', malformed.status()===200 && new URL(malformed.url()).pathname==='/apps/zenith/Dashboard');
        for (const [shop,total,orders] of [['POS_QA_A_FAC','30.00','2 Orders'],['POS_QA_A_FAC2','40.00','1 Orders'],['','70.00','3 Orders']]) {
            await post(context,'/apps/zenith/setActiveShop',{moquiSessionToken:csrf,facilityId:shop,returnUrl:'/apps/zenith/pos/Dashboard'});
            await page.goto(base+'/apps/zenith/pos/Dashboard');
            const sales = page.locator('.pos-dash-metric').filter({has:page.getByText('Total Sales',{exact:true})});
            check('dashboard shop '+(shop||'combined')+' totals match database', (await sales.innerText()).includes(total) && (await sales.innerText()).includes(orders));
        }
        await post(context,'/apps/zenith/Settings/Users/editUser',{moquiSessionToken:csrf,userId:newUserId,username:'scope.qa@example.com',userFullName:'Synthetic renamed clerk'});
        await page.goto(base+'/apps/zenith/Settings/Users?searchTerm=renamed');
        check('Edit user persists changed name', await page.getByText('Synthetic renamed clerk',{exact:true}).isVisible());
        await post(context,'/apps/zenith/Settings/Users/disableUser',{moquiSessionToken:csrf,userId:newUserId});
        await page.goto(base+'/apps/zenith/Settings/Users?statusFilter=disabled&searchTerm=scope.qa');
        check('Disable user persists and combines with search', await page.locator('.z-user-status.is-disabled').count()===1);
        await post(context,'/apps/zenith/Settings/Users/enableUser',{moquiSessionToken:csrf,userId:newUserId});
        const csv = await context.request.get(base+'/apps/zenith/Settings/Users/exportUsers');
        check('Export CSV returns organization-scoped user data', csv.status()===200 && (await csv.text()).includes('scope.qa@example.com') && !(await csv.text()).includes('pos.b.qa'));
        for (const shell of ['apps','qapps']) {
            await page.setViewportSize({width:390,height:844});
            await page.goto(base+'/'+shell+'/zenith/Settings/RoleEditor');
            await page.locator('#z-role-save:not([disabled])').waitFor();
            check(shell+' narrow role editor stays within viewport', await page.locator('#z-role-editor').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+2));
            await page.screenshot({path:path.join(out,shell+'-role-mobile.png'),fullPage:true});
        }
        state = await probe('inspect');
        check('issued synthetic bill amounts remain unchanged', JSON.stringify(state.billAmounts.map(Number).sort((a,b)=>a-b))==='[10,20,40]');
        check('no browser JavaScript exceptions during acceptance', !(report.pageErrors || []).length);
        await clerk.close(); await orgB.close(); await context.close();
    } finally {
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
    }
})().catch(error => { console.error(error.message.split('Call log:')[0]); process.exitCode = 1; });
