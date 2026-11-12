const assert = require('node:assert/strict');
const path = require('node:path');
const playwright = require('playwright');

// Real browser/production script; only the read endpoint is fault-injected.
(async () => {
    const engine = process.env.POS_QA_HISTORY_BROWSER || 'chromium';
    const browser = await playwright[engine].launch({headless:true,...(engine === 'chromium' ? {executablePath:process.env.POS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {})});
    try {
        const page = await browser.newPage();
        const terminal = 'http://127.0.0.1:18084/apps/zenith/pos/Terminal';
        const bill = {txId:'QA-HISTORY',billNo:'QA-HISTORY',grand:100,date:'05/11/2026 10:00 am',customer:'Synthetic',itemCount:1,payments:[]};
        let calls = [], failure = 'transient';
        await page.route(terminal, route => route.fulfill({contentType:'text/html',body:'<button id="pos-history-btn">History</button><div class="pos-cart" style="height:400px"></div><form id="cartInlineAddForm"><input name="sessionId" value="QA-SESSION"><input name="moquiSessionToken" value="QA-CSRF"></form>'}));
        await page.route(terminal+'.qvt?*',route=>route.fulfill({contentType:'text/html',body:'<p>Sign in required</p>'}));
        await page.route(terminal + '/ajaxCart', async route => {
            const params = Object.fromEntries(new URLSearchParams(route.request().postData()));
            calls.push(params);
            assert.equal(params.action, 'billHistory', 'recovery only reads history');
            assert.equal(params.sessionId, 'QA-SESSION');
            assert.equal(params.moquiSessionToken, 'QA-CSRF');
            if (failure === 'transient') { failure = ''; return route.fulfill({status:503,contentType:'text/html',body:'Temporarily unavailable'}); }
            if (failure === 'persistent') return route.abort('connectionfailed');
            if (failure === 'malformed') { failure = ''; return route.fulfill({contentType:'text/html',body:'Upstream error'}); }
            if (failure === 'auth') return route.fulfill({status:401,contentType:'text/html',body:'Sign in'});
            if (failure === 'denied') return route.fulfill({json:{success:false,error:'Access denied to this terminal.'}});
            return route.fulfill({json:{success:true,total:1,bills:[bill]}});
        });
        await page.goto(terminal);
        await page.addScriptTag({path:path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js')});
        await page.evaluate(() => {window.moqui={webrootVue:{moquiSessionToken:'STALE-SHELL-TOKEN'}};});
        assert.equal(await page.evaluate(() => navigator.onLine), true);
        await page.locator('#pos-history-btn').click();
        const history = page.getByRole('dialog',{name:'Bill history'});
        await history.locator('.hist-bill-row').waitFor({timeout:3000});
        assert.equal(calls.length, 2, 'one failed read retries once without leaving billing');

        failure = 'persistent'; calls = [];
        await history.getByRole('searchbox').fill('QA-HISTORY');
        await history.getByRole('button',{name:'Retry',exact:true}).waitFor();
        assert.equal(calls.length, 2, 'persistent failures have a bounded retry');
        failure = '';
        await history.getByRole('button',{name:'Retry',exact:true}).click();
        await history.locator('.hist-bill-row').waitFor();
        assert.equal(calls.at(-1).search,'QA-HISTORY','manual retry preserves the search');

        failure = 'persistent';
        await history.getByRole('searchbox').fill('recover on reconnect');
        await history.getByRole('button',{name:'Retry',exact:true}).waitFor();
        failure = '';
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await history.locator('.hist-bill-row').waitFor();

        failure = 'malformed'; calls = [];
        await history.getByRole('button',{name:'Filter',exact:true}).click();
        await history.getByLabel('From Date').fill('2026-11-05');
        await history.getByLabel('To Date').fill('2026-11-05');
        await history.getByRole('button',{name:'Apply Filter'}).click();
        await history.locator('.hist-bill-row').waitFor();
        assert.equal(calls.length,2,'an invalid response retries the read');
        assert.equal(calls.at(-1).historyFromDate,'2026-11-05','retry retains date filters');
        await history.getByRole('button',{name:'Reset',exact:true}).click();
        await history.locator('.hist-bill-row').waitFor();

        failure = 'auth'; calls = [];
        await page.evaluate(() => {window._posOffline = {getQueue:async () => [{total:12,ts:1,paymentMethod:'Cash',items:[{name:'Pending synthetic bill',qty:1}]}]};});
        await history.getByRole('searchbox').fill('auth');
        await history.getByText(/sign in again/i).waitFor();
        assert.equal(calls.length,1,'authentication errors are not retried or called offline');
        assert.equal(await history.getByText(/check your connection/i).count(),0);
        assert.equal(await history.getByText(/PENDING SYNC/).count(),0,'auth refusal does not display cached history');

        failure = 'denied'; calls = [];
        await history.getByRole('searchbox').fill('denied');
        await history.getByText('Access denied to this terminal.',{exact:true}).waitFor();
        assert.equal(calls.length,1,'permission rejection is not retried');

        await page.evaluate(() => {Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});
        failure = 'persistent'; calls = [];
        await history.getByRole('searchbox').fill('');
        await history.getByText('OFFLINE — PENDING SYNC',{exact:true}).waitFor();
        assert.equal(await history.getByRole('button',{name:'Retry',exact:true}).count(),1,'cached pending bills also allow in-place recovery');
        assert.equal(calls.length,1,'offline history uses the device queue without retrying the server');
        await page.evaluate(() => {delete navigator.onLine;});
        failure = '';
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await history.locator('.hist-bill-row').waitFor();

        failure = 'transient'; calls = [];
        await history.getByRole('searchbox').fill('close during retry');
        await page.waitForFunction(() => document.querySelector('#hist-list [role=status]'));
        await page.waitForResponse(r => r.status() === 503);
        await history.locator('#hist-close').click();
        await page.waitForTimeout(500);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        assert.equal(calls.length,1,'closing cancels the scheduled retry and reconnect listener');
        assert.equal(await page.locator('#pos-history-overlay').count(),0);
        console.log('PASS '+engine+' Bill History: bounded recovery, Retry, reconnect, filters, auth/permission isolation, offline queue and close cancellation.');

        await page.route(terminal + '/ajaxCart', route => {
            const params = new URLSearchParams(route.request().postData());
            assert.equal(params.get('action'), 'searchProductsJson');
            assert.equal(params.get('q'), 'water cup');
            return route.fulfill({json:{success:true,products:[{pid:'QA-WATER',name:'Water Cup',price:45}]}});
        });
        await page.clock.install();
        await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
        await page.evaluate(savedBill => {
            window.posOpenCartEditor(savedBill);
            document.getElementById('ced-add').focus();
        }, {...bill,items:[{seq:'01',pid:'QA-TEA',name:'Tea Cup',price:100,qty:1}]});
        const focused = () => page.evaluate(() => document.activeElement.id || document.activeElement.className);
        assert.equal(await focused(), 'ced-add');
        await page.clock.runFor(100);
        assert.equal(await focused(), 'ced-add',
            'opening the editor must not steal focus from product search');
        await page.clock.resume();
        await page.keyboard.insertText('water cup');
        await page.locator('#ced-add-res [data-pid="QA-WATER"]').click();
        assert.match(await page.locator('#ced-rows').innerText(), /Water Cup/);
        console.log('PASS '+engine+' Bill History editor keeps early search input focused and adds the matching product.');
    } finally { await browser.close(); }
})().catch(error => {console.error(error.stack); process.exitCode=1;});
