// Run only against the disposable POS QA runtime after verify-runtime.cjs has loaded its fixtures.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {request} = require('playwright');

const base = process.env.POS_QA_BASE || 'http://127.0.0.1:18084';
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/, 'Use a disposable loopback runtime');
const root = process.env.POS_QA_NATIVE_ROOT;
const java = process.env.POS_QA_JAVA;
assert(root && java, 'Set POS_QA_NATIVE_ROOT and POS_QA_JAVA for the disposable H2 runtime');
const out = process.env.POS_QA_OUT || path.join(root, 'category-audit');
fs.mkdirSync(out, {recursive: true});
const classes = path.join(out, 'db-probe');
fs.mkdirSync(classes, {recursive: true});
cp.execFileSync(path.join(path.dirname(java), 'javac.exe'),
    ['-d', classes, path.join(__dirname, 'PosDbProbe.java')], {windowsHide: true});

function query(sql) {
    assert.match(sql, /^SELECT /i, 'Read-only DB probes');
    return JSON.parse(cp.execFileSync(java, ['--class-path',
        path.join(root, 'WEB-INF', 'lib', 'h2-2.4.240.jar') + path.delimiter + classes,
        'PosDbProbe'], {
        input: sql, encoding: 'utf8', windowsHide: true,
        env: {...process.env, POS_QA_DB_URL: 'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}
    }));
}
const quoted = value => "'" + value.replaceAll("'", "''") + "'";
const products = name => query(`SELECT product_id, owner_party_id, product_type_enum_id FROM product WHERE product_name=${quoted(name)}`);
const members = id => query(`SELECT product_category_id FROM product_category_member WHERE product_id=${quoted(id)}`);

(async () => {
    const context = await request.newContext({extraHTTPHeaders: {
        Authorization: 'Basic ' + Buffer.from('pos.qa:moqui').toString('base64')
    }});
    try {
        const response = await context.get(base + '/apps/zenith/Inventory/FindProduct');
        assert.equal(response.status(), 200);
        const catalogHtml = await response.text();
        const categorySelect = catalogHtml.match(/<select\b[^>]*\bname="productCategoryId"[^>]*>([\s\S]*?)<\/select>/)?.[1];
        assert(categorySelect, 'New Product exposes category selection');
        assert(categorySelect.includes('value="POS_QA_A_CAT"'), 'Own category is selectable');
        assert(!categorySelect.includes('value="POS_QA_B_CAT"'), 'Foreign category is hidden');
        const token = catalogHtml.match(/name="moquiSessionToken" value="([^"]+)"/)?.[1];
        assert(token, 'Session token available');
        const run = Date.now().toString(36).toUpperCase();
        const physicalName = 'Disposable physical category item '+run;
        const serviceName = 'Disposable service category item '+run;
        const foreignName = 'Disposable foreign category '+run;
        const form = (productName, productCategoryId, productTypeEnumId = 'PtAsset') => ({
            moquiSessionToken: token, productName, productCategoryId,
            productTypeEnumId, uqcEnumId:'PCS', mrpAmount: '25', openingStock: '0',
            enableBatchTracking: 'N', isGstExempt: 'N'
        });
        await context.post(base + '/apps/zenith/Inventory/FindProduct/createProduct', {
            form: form(foreignName, 'POS_QA_B_CAT'), maxRedirects: 0
        });
        assert.equal(products(foreignName).length, 0, 'Forged foreign category cannot create a product');

        const created = await context.post(base + '/apps/zenith/Inventory/FindProduct/createProduct', {
            form: form(physicalName, 'POS_QA_A_CAT'), maxRedirects: 0
        });
        assert(created.status() < 400, `Create product returned ${created.status()}`);
        const physical = products(physicalName);
        assert.equal(physical.length, 1, 'New product is persisted once');
        assert.equal(physical[0].owner_party_id, 'POS_QA_A');
        assert.deepEqual(members(physical[0].product_id).map(m => m.product_category_id), ['POS_QA_A_CAT']);

        const service = await context.post(base + '/apps/zenith/Inventory/FindProduct/createProduct', {
            form: form(serviceName, 'POS_QA_A_CAT', 'PtService'),
            maxRedirects: 0
        });
        assert(service.status() < 400, `Create service returned ${service.status()}`);
        assert.equal(products(serviceName).length, 1);

        let session = query("SELECT session_id FROM pos_session WHERE organization_party_id='POS_QA_A' AND status_id='PsOpen' ORDER BY session_id DESC")[0]?.session_id;
        if (!session) {
            const opened = await context.post(base + '/apps/zenith/pos/PosQaAcceptance/invoke', {
                form: {moquiSessionToken: token, op: 'open', terminalId: 'POS_QA_A_TERM1', openingCash: '0'}
            });
            session = (await opened.json()).result?.sessionId;
        }
        assert(session, 'Disposable POS session available');
        const catPage = await context.get(`${base}/apps/zenith/pos/Terminal?sessionId=${session}&catId=POS_QA_A_CAT`);
        assert.equal(catPage.status(), 200, 'Category page renders');
        const categoryHtml = await catPage.text();
        assert(categoryHtml.includes('Disposable physical category item'), 'Category includes assigned stock item');
        assert(!categoryHtml.includes('Disposable service category item'), 'Category excludes non-stock service');
        const allPage = await context.get(`${base}/apps/zenith/pos/Terminal?sessionId=${session}`);
        assert.equal(allPage.status(), 200);
        assert((await allPage.text()).includes('Disposable physical category item'),
            'All Items restores assigned stock item');
        console.log('PASS category checks: tenant options, forged category, persistence, physical-only POS grid, All Items');
    } finally {
        await context.dispose();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
