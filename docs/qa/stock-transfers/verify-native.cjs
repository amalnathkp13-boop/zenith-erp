// Focused stock-transfer smoke test for the disposable native POS QA runtime.
// The runtime is reset and discarded after use; no production host is accepted.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {request} = require('playwright');

const base = process.env.POS_QA_BASE || 'http://127.0.0.1:18084';
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
const root = process.env.POS_QA_NATIVE_ROOT;
const java = process.env.POS_QA_JAVA;
assert(root && java, 'Set POS_QA_NATIVE_ROOT and POS_QA_JAVA');
const out = process.env.POS_QA_OUT || path.join(root, 'stock-transfer-audit');
fs.mkdirSync(out, {recursive: true});
const classes = path.join(out, 'db-probe');
fs.mkdirSync(classes, {recursive: true});
cp.execFileSync(path.join(path.dirname(java), 'javac.exe'),
    ['-d', classes, path.join(__dirname, '..', 'pos-runtime', 'PosDbProbe.java')], {windowsHide: true});
function query(sql) {
    assert.match(sql, /^SELECT /i);
    return JSON.parse(cp.execFileSync(java, ['--class-path',
        path.join(root, 'WEB-INF', 'lib', 'h2-2.4.240.jar') + path.delimiter + classes,
        'PosDbProbe'], {input: sql, encoding: 'utf8', windowsHide: true,
        env: {...process.env, POS_QA_DB_URL: 'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));
}
const quoted = value => "'" + String(value).replaceAll("'", "''") + "'";
const count = (table, where) => Number(query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n);
const balance = (product, facility) => Number(query(`SELECT coalesce(sum(quantity_on_hand_total),0) AS n FROM asset WHERE product_id=${quoted(product)} AND facility_id=${quoted(facility)} AND owner_party_id='POS_QA_A' AND asset_type_enum_id='AstTpInventory'`)[0].n);

(async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
        try { if ((await fetch(base + '/Login')).status < 500) break; } catch {}
        if (attempt === 59) throw Error('Disposable runtime did not start');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const auth = user => 'Basic ' + Buffer.from(user + ':moqui').toString('base64');
    const bootstrap = await request.newContext({extraHTTPHeaders: {Authorization: auth('john.doe')}});
    const writer = await request.newContext({extraHTTPHeaders: {Authorization: auth('pos.qa')}});
    try {
        // Native runtime starts empty; initialize only synthetic POS QA fixtures.
        const start = await bootstrap.get(base + '/apps/zenith/Contacts/Customers');
        const initToken = (await start.text()).match(/name="moquiSessionToken" value="([^"]+)"/)?.[1];
        assert(initToken, 'Bootstrap session token');
        const initialized = await bootstrap.post(base + '/apps/zenith/pos/PosQaAcceptance/initialize',
            {form: {moquiSessionToken: initToken}});
        assert.equal((await initialized.json()).initialized, true, 'Disposable fixtures initialized');

        const catalog = await writer.get(base + '/apps/zenith/Inventory/FindProduct');
        const token = (await catalog.text()).match(/name="moquiSessionToken" value="([^"]+)"/)?.[1];
        assert(token, 'Inventory writer session token');
        const name = 'Disposable transfer receiver ' + Date.now();
        const facilityResponse = await writer.post(base + '/apps/zenith/Inventory/FindFacility/createFacility', {
            form: {moquiSessionToken: token, facilityName: name, facilityTypeEnumId: 'FcTpRetailStore'},
            maxRedirects: 0
        });
        assert(facilityResponse.status() < 400, 'Receiver facility created');
        const receiver = query(`SELECT facility_id FROM facility WHERE facility_name=${quoted(name)} AND owner_party_id='POS_QA_A'`)[0]?.facility_id;
        assert(receiver, 'Receiver belongs to active organization');

        const serviceName = 'Disposable transfer service '+Date.now();
        const productResponse = await writer.post(base + '/apps/zenith/Inventory/FindProduct/createProduct', {
            form: {moquiSessionToken: token, productName: serviceName,
                productTypeEnumId: 'PtService', uqcEnumId:'NOS', mrpAmount: '10', openingStock: '0'}, maxRedirects: 0
        });
        assert(productResponse.status() < 400, 'Service fixture created');
        const service = query(`SELECT product_id FROM product WHERE product_name=${quoted(serviceName)} AND owner_party_id='POS_QA_A'`)[0]?.product_id;
        assert(service, 'Service fixture persisted');

        const remark = 'Disposable transfer check ' + Date.now();
        const created = await writer.post(base + '/apps/zenith/Inventory/NewStockTransfer/createTransfer', {
            form: {moquiSessionToken: token, fromFacilityId: 'POS_QA_A_FAC', toFacilityId: receiver,
                remarks: remark}, maxRedirects: 0
        });
        assert(created.status() < 400, `Transfer creation returned ${created.status()}`);
        const transfer = query(`SELECT stock_transfer_id, status_id FROM stock_transfer WHERE remarks=${quoted(remark)} AND organization_party_id='POS_QA_A'`)[0];
        assert.equal(transfer?.status_id, 'StxDraft');
        const id = transfer.stock_transfer_id;
        const edit = await writer.get(`${base}/apps/zenith/Inventory/EditStockTransfer?stockTransferId=${id}`);
        const editHtml = await edit.text();
        assert.equal(edit.status(), 200);
        assert(editHtml.includes('POS_QA_A_STOCK'), 'Physical product appears in the picker');
        assert(!editHtml.includes(serviceName), 'Service does not appear in the picker');

        const add = (productId, quantity) => writer.post(base + '/apps/zenith/Inventory/EditStockTransfer/addItem', {
            form: {moquiSessionToken: token, stockTransferId: id, productId, quantity}, maxRedirects: 0
        });
        await add(service, '1');
        await add('POS_QA_B_P18', '1');
        assert.equal(count('stock_transfer_item', `stock_transfer_id=${quoted(id)}`), 0,
            'Service and foreign products rejected before a line is stored');
        const senderBefore = balance('POS_QA_A_STOCK', 'POS_QA_A_FAC');
        const receiverBefore = balance('POS_QA_A_STOCK', receiver);
        await add('POS_QA_A_STOCK', '2');
        assert.equal(count('stock_transfer_item', `stock_transfer_id=${quoted(id)}`), 1);
        const action = transition => writer.post(`${base}/apps/zenith/Inventory/EditStockTransfer/${transition}`, {
            form: {moquiSessionToken: token, stockTransferId: id}, maxRedirects: 0
        });
        await action('shipTransfer');
        assert.equal(query(`SELECT status_id FROM stock_transfer WHERE stock_transfer_id=${quoted(id)}`)[0].status_id, 'StxInTransit');
        assert.equal(balance('POS_QA_A_STOCK', 'POS_QA_A_FAC'), senderBefore - 2);
        await action('shipTransfer');
        assert.equal(balance('POS_QA_A_STOCK', 'POS_QA_A_FAC'), senderBefore - 2, 'Ship replay is inert');
        await action('receiveTransfer');
        assert.equal(query(`SELECT status_id FROM stock_transfer WHERE stock_transfer_id=${quoted(id)}`)[0].status_id, 'StxReceived');
        assert.equal(balance('POS_QA_A_STOCK', receiver), receiverBefore + 2);
        await action('receiveTransfer');
        assert.equal(balance('POS_QA_A_STOCK', receiver), receiverBefore + 2, 'Receive replay is inert');
        console.log('PASS stock transfer smoke: physical picker, service/tenant rejection, ship/receive balances, replay safety');
    } finally {
        await writer.dispose();
        await bootstrap.dispose();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
