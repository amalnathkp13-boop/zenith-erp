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

        await assertControlsFit('Desktop');
        await history.getByRole('button', {name: 'Next'}).scrollIntoViewIfNeeded();
        await filter.click();
        await form.getByLabel('From Date').fill('2026-11-04');
        await form.getByLabel('To Date').fill('2026-11-04');
        await form.getByRole('button', {name: 'Apply Filter'}).click();
        await row.waitFor();
        await assertControlsFit('Expanded desktop filters');

        await page.setViewportSize({width: 390, height: 460});
        await assertControlsFit('Short mobile');
        await form.getByRole('button', {name: 'Reset'}).click();
        await row.getByRole('button', {name: 'Reprint'}).scrollIntoViewIfNeeded();
        const search = history.getByRole('searchbox', {name: 'Search bills'});
        assert.ok(await search.evaluate(input => input.getBoundingClientRect().bottom <= innerHeight));
        console.log('PASS Bill History controls fit above a scrollable list on desktop and mobile');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
