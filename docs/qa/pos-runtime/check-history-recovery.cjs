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

        await history.getByRole('button',{name:'Filter',exact:true}).click();
        const form = history.locator('#hist-filter-form');
        const fromDate = form.getByRole('textbox',{name:'From Date',exact:true});
        const toDate = form.getByRole('textbox',{name:'To Date',exact:true});
        const fromTime = form.getByRole('textbox',{name:'From Time',exact:true});
        const toTime = form.getByRole('textbox',{name:'To Time',exact:true});
        const fromCalendar = form.getByLabel('Pick from date',{exact:true});
        const toCalendar = form.getByLabel('Pick to date',{exact:true});
        const apply = form.getByRole('button',{name:'Apply',exact:true});
        const alert = form.getByRole('alert');

        calls = [];
        const today = await toCalendar.getAttribute('max');
        for (const [digit, expected] of [
            ['2',/^2$/], ['2',/^22-?$/], ['1',/^22-1$/], ['1',/^22-11-?$/],
            ['2',/^22-11-2$/], ['0',/^22-11-20$/], ['2',/^22-11-202$/], ['6',/^22-11-2026$/]
        ]) {
            await fromDate.pressSequentially(digit);
            assert.match(await fromDate.inputValue(),expected,'date separates as each digit is typed');
        }
        await fromDate.fill('');
        await fromDate.pressSequentially('221');
        await fromDate.press('Backspace');
        await fromDate.press('Backspace');
        assert.equal((await fromDate.inputValue()).replace(/-/g,''),'2','Backspace crosses the date separator');
        await fromDate.pressSequentially('2112026');
        assert.equal(await fromDate.inputValue(),'22-11-2026','typing resumes from the deletion caret');
        await fromDate.press('Home');
        await fromDate.press('ArrowRight');
        await fromDate.press('Shift+ArrowRight');
        await fromDate.press('1');
        assert.equal(await fromDate.inputValue(),'21-11-2026','replacing a day digit preserves month and year');
        assert.ok(await fromDate.evaluate(input=>input.selectionStart<=3),'editing the day keeps the caret by the day');
        await fromDate.evaluate(input=>input.setSelectionRange(3,3));
        await fromDate.press('Backspace');
        assert.equal((await fromDate.inputValue()).replace(/-/g,''),'2112026','Backspace after the hyphen removes the preceding digit');
        await fromDate.press('1');
        assert.equal(await fromDate.inputValue(),'21-11-2026','the deleted day digit can be retyped in place');

        // Insert a complete clipboard value in one edit, without touching the OS clipboard.
        async function pasteInto(field, text) {
            await field.press('ControlOrMeta+a');
            await field.evaluate((input, value) => {
                const transfer = new DataTransfer();
                transfer.setData('text/plain',value);
                const paste = new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
                if (input.dispatchEvent(paste)) {
                    input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');
                    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:value}));
                }
            },text);
            await field.press('Tab');
        }
        await pasteInto(fromDate,'2015-03-12');
        assert.equal(await fromDate.inputValue(),'12-03-2015','pasted ISO date keeps the original year');
        await pasteInto(toDate,'12/03/2015');
        assert.equal(await toDate.inputValue(),'12-03-2015','pasted day-first date is normalized');
        for (const calendar of [fromCalendar,toCalendar]) {
            assert.equal(await calendar.inputValue(),'2015-03-12');
            assert.equal(await calendar.getAttribute('min'),'0001-01-01','equal endpoints allow earlier years');
            assert.equal(await calendar.getAttribute('max'),today,'equal endpoints allow later years up to today');
        }
        await toCalendar.fill('2000-01-01');
        assert.equal(await toDate.inputValue(),'01-01-2000');
        assert.equal(await alert.isVisible(),false,'editing either end allows temporarily reversed dates');
        await apply.click();
        assert.ok(await alert.isVisible(),'Apply rejects a reversed date range');
        assert.equal(calls.length,0,'invalid range does not reach the history service');

        for (const invalid of ['2012-02-30','1/112/2020']) {
            await pasteInto(fromDate,invalid);
            assert.equal(await fromDate.inputValue(),invalid,'an invalid pasted date keeps its original order');
            await apply.click();
            assert.match(await alert.innerText(),/both dates/i);
        }
        await pasteInto(fromDate,'2000-01-01');
        await pasteInto(fromTime,'1:234');
        assert.equal(await fromTime.inputValue(),'1:234','an invalid pasted time keeps its original separator');
        await apply.click();
        assert.match(await alert.innerText(),/24-hour/i);
        assert.equal(calls.length,0,'invalid pasted values cannot turn into an accepted range');

        await fromTime.fill('');
        await fromDate.fill('');
        await toDate.fill('');
        await fromDate.pressSequentially('05112');
        await toDate.pressSequentially('06-11-2020');
        await apply.click();
        assert.ok(await alert.isVisible(), 'a partially typed date displays inline feedback');
        await fromDate.fill('');
        await fromDate.pressSequentially('05112020');
        await fromTime.pressSequentially('09');
        await apply.click();
        assert.ok(await alert.isVisible(), 'a partially typed time displays inline feedback');
        assert.equal(calls.length,0,'incomplete dates and times do not submit history reads');

        await fromTime.fill('');
        await fromTime.pressSequentially('09:30');
        await fromDate.focus();
        await fromDate.press('End');
        for (let digit=0; digit<4; digit++) await fromDate.press('Shift+ArrowLeft');
        await fromDate.pressSequentially('1106');
        await fromDate.press('Tab');
        assert.ok(await toDate.evaluate(input => input === document.activeElement),
            'Tab moves directly from the start date to the end date');
        assert.equal(await fromCalendar.inputValue(),'1106-11-05','all four replacement year digits reach the picker');
        assert.equal(await toCalendar.getAttribute('min'),'0001-01-01');
        assert.equal(await fromCalendar.getAttribute('max'),today);

        failure = 'malformed'; calls = [];
        await toTime.pressSequentially('17');
        await toTime.pressSequentially('4');
        assert.equal(await toTime.inputValue(),'17:4','time separator appears during fast entry');
        await toTime.press('Backspace');
        await toTime.press('Backspace');
        assert.equal((await toTime.inputValue()).replace(/:/g,''),'1','Backspace crosses the time separator');
        await toTime.pressSequentially('745');
        await toTime.evaluate(input=>input.setSelectionRange(2,2));
        await toTime.press('Delete');
        assert.equal((await toTime.inputValue()).replace(/:/g,''),'175','Delete before the colon removes the following digit');
        await toTime.press('4');
        await toTime.press('Enter');
        await history.locator('.hist-bill-row').waitFor();
        assert.equal(await toTime.inputValue(),'17:45','Enter formats the compact time in the active field');
        assert.equal(calls.length,2,'an invalid response retries the read');
        for (const request of calls) {
            assert.deepEqual(
                [request.historyFromDate,request.historyToDate,request.historyFromTime,request.historyToTime],
                ['1106-11-05','2020-11-06','09:30','17:45'],'typed dates and times submit the same range on retry');
        }
        await fromCalendar.fill('2019-04-08');
        await form.getByLabel('Pick from time',{exact:true}).fill('08:15');
        assert.equal(await fromDate.inputValue(),'08-04-2019','calendar selection updates the visible date');
        assert.equal(await fromTime.inputValue(),'08:15','clock selection updates the visible time');
        await history.getByRole('button',{name:'Reset',exact:true}).click();
        await history.locator('.hist-bill-row').waitFor();
        assert.ok(await form.locator('input').evaluateAll(inputs => inputs.every(input => !input.value)),
            'Reset clears text fields and native pickers');
        assert.equal(calls.at(-1).historyFromDate,undefined,'Reset requests unfiltered history');

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
