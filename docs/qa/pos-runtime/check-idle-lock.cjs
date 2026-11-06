const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const script = path.resolve(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic/js/pos-idle-lock.js');
const base = 'http://localhost/apps/zenith/pos';

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.POS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    });
    try {
        const page = await browser.newPage();
        let hasPin = true;
        let verified;
        await page.route(base + '/Terminal', route => route.fulfill({
            contentType: 'text/html',
            body: '<input id="scan" aria-label="Product search"><input name="moquiSessionToken" value="qa-token">'
        }));
        await page.route(base + '/PosLock/config?*', route => route.fulfill({ json: { idleMin: 1, hasPin } }));
        await page.route(base + '/PosLock/verify', route => {
            verified = new URLSearchParams(route.request().postData());
            return route.fulfill({ json: { ok: verified.get('credential') === 'cup/2' || verified.get('credential') === '1234' } });
        });
        await page.clock.install();

        async function lock() {
            await page.goto(base + '/Terminal');
            await page.evaluate(() => {
                window.cashierShortcuts = 0;
                // A response event precedes response.json() and arm(). Advancing the
                // fake clock before arm() starts makes the idle boundary nondeterministic.
                const interval = window.setInterval;
                window.qaIdleTimerReady = new Promise(resolve => {
                    window.setInterval = function() {
                        const id = interval.apply(this, arguments);
                        if (arguments[1] === 5000) { window.setInterval = interval; resolve(); }
                        return id;
                    };
                });
                document.addEventListener('keydown', e => {
                    if (e.key === 'F7' || e.key === '/') window.cashierShortcuts++;
                }, true);
            });
            const config = page.waitForResponse(response => response.url().includes('/PosLock/config?_='));
            await page.addScriptTag({ path: script });
            await config;
            await page.evaluate(() => window.qaIdleTimerReady);
            await page.clock.runFor(65_000);
            await page.getByText('Till locked', { exact: true }).waitFor();
        }

        for (const fallback of [true, false]) {
            hasPin = fallback;
            await lock();
            if (fallback) await page.getByRole('button', { name: 'Use password instead' }).click();
            const password = page.locator('#__zpw');
            await password.focus();
            await page.keyboard.type('cup/3');
            await page.keyboard.press('Backspace');
            await page.keyboard.press('2');
            assert.equal(await password.inputValue(), 'cup/2', 'the locked till allows ordinary password editing');
            await page.keyboard.press('F7');
            assert.equal(await page.evaluate(() => window.cashierShortcuts), 0, 'locked keyboard events cannot reach cashier shortcuts');
            await page.keyboard.press('Enter');
            await password.waitFor({ state: 'detached' });
            assert.equal(verified.get('mode'), 'password');
            assert.equal(verified.get('moquiSessionToken'), 'qa-token');
            await page.locator('#scan').press('F7');
            assert.equal(await page.evaluate(() => window.cashierShortcuts), 1, 'cashier shortcuts return after unlock');
        }

        hasPin = true;
        await lock();
        await page.keyboard.type('1234');
        await page.clock.runFor(100);
        await page.getByText('Till locked', { exact: true }).waitFor({ state: 'detached' });
        assert.equal(verified.get('mode'), 'pin');
        console.log('PASS till lock accepts password typing and PIN while blocking billing shortcuts.');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
