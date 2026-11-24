const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

const assets = path.resolve(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic');
const bills = Array.from({length: 20}, (_, index) => ({
    txId: String(index), billNo: `QA-${index}`, grand: 100, date: '04/11/2026 10:00 am',
    customer: 'Walk-In', itemCount: 1, payments: [{method: 'Cash'}]
}));

(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.POS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const page = await browser.newPage({viewport: {width: 1536, height: 729}});
        const terminal = 'http://127.0.0.1:18084/apps/zenith/pos/Terminal';
        await page.route(terminal, route => route.fulfill({contentType: 'text/html', body: '<button id="pos-history-btn">History</button>'}));
        await page.route(terminal + '/ajaxCart', route => route.fulfill({json: {success: true, total: 29, bills}}));
        await page.goto(terminal);
        await page.addStyleTag({path: path.join(assets, 'css/zenith-theme-v4.css')});
        await page.addStyleTag({path: path.join(assets, 'css/pos-bill-history.css')});
        await page.addScriptTag({path: path.join(assets, 'js/pos-terminal.js')});
        await page.locator('#pos-history-btn').click();
        const history = page.getByRole('dialog', {name: 'Bill history'});
        const filter = history.getByRole('button', {name: 'Filter'});
        const form = history.locator('#hist-filter-form');
        const row = history.locator('.hist-bill-row').first();
        await row.waitFor();

        async function assertControlsFit(viewport) {
            const geometry = await history.evaluate(dialog => {
                const rect = selector => dialog.querySelector(selector).getBoundingClientRect();
                return {
                    input: rect('#hist-search').bottom,
                    filter: rect('#hist-filter').bottom,
                    results: rect('#hist-list').top,
                    scrollAreas: [...dialog.querySelectorAll('div')].filter(element =>
                        /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).length
                };
            });
            assert.ok(geometry.input <= geometry.results && geometry.filter <= geometry.results && geometry.scrollAreas === 1,
                `${viewport} keeps search and Filter above the results with one scrollbar: ${JSON.stringify(geometry)}`);
        }

        async function assertFilterLayout(viewport) {
            const geometry = await form.evaluate(form => {
                const fields = [...form.querySelectorAll('input[name], input[type="date"], input[type="time"]')]
                    .map(input => input.getBoundingClientRect());
                const scroller = form.closest('#hist-scroll');
                const left = scroller.getBoundingClientRect().left;
                const right = left + scroller.clientWidth;
                const reset = form.querySelector('#hist-filter-reset').getBoundingClientRect();
                const apply = form.querySelector('[type="submit"]').getBoundingClientRect();
                return {
                    fields: form.querySelectorAll('input[name]').length,
                    leftInset: Math.min(...fields.map(rect => rect.left)) - left,
                    rightInset: right - Math.max(...fields.map(rect => rect.right)),
                    buttonInset: right - apply.right,
                    buttonGap: apply.left - reset.right,
                    buttonTopDifference: Math.abs(reset.top - apply.top),
                    actionClearance: Math.min(reset.top, apply.top) - Math.max(...fields.map(rect => rect.bottom)),
                    buttonHeight: Math.min(reset.height, apply.height)
                };
            });
            assert.equal(geometry.fields, 4, `${viewport} shows both date and time ranges`);
            assert.ok(Math.min(geometry.leftInset, geometry.rightInset, geometry.buttonInset) >= 10,
                `${viewport} keeps fields and actions inside the panel gutters: ${JSON.stringify(geometry)}`);
            assert.ok(geometry.buttonGap >= 4 && geometry.buttonTopDifference <= 1 &&
                geometry.actionClearance >= 4 && geometry.buttonHeight >= 32,
                `${viewport} keeps Reset and Apply aligned, separated and easy to select: ${JSON.stringify(geometry)}`);
        }

        await assertControlsFit('Desktop');
        await history.getByRole('button', {name: 'Next'}).scrollIntoViewIfNeeded();
        await filter.click();
        assert.equal(await filter.getAttribute('aria-expanded'), 'true');
        assert.equal(await history.locator('#hist-scroll').evaluate(area => area.scrollTop), 0,
            'Opening the filters from the end of the list reveals the form');
        await form.getByRole('textbox', {name: 'From Date', exact: true}).fill('04-11-2026');
        await form.getByRole('textbox', {name: 'To Date', exact: true}).fill('04-11-2026');
        await form.getByRole('button', {name: 'Apply', exact: true}).click();
        await row.waitFor();
        await assertControlsFit('Expanded desktop filters');
        await assertFilterLayout('Desktop');

        await page.setViewportSize({width: 390, height: 460});
        await assertControlsFit('Short mobile');
        await assertFilterLayout('Short mobile');
        await form.getByRole('button', {name: 'Reset'}).click();
        await row.getByRole('button', {name: 'Reprint'}).scrollIntoViewIfNeeded();
        const search = history.getByRole('searchbox', {name: 'Search bills'});
        assert.ok(await search.evaluate(input => input.getBoundingClientRect().bottom <= innerHeight));
        console.log('PASS Bill History controls fit above a scrollable list on desktop and mobile');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
