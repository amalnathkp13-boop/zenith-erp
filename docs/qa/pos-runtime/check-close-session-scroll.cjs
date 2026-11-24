// The shared POS/KOT close review must remain usable from the keyboard.
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.POS_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const page = await browser.newPage({viewport:{width:800,height:520}});
        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({path:path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-till-dialogs.js')});
        await page.evaluate(() => PosTillDialogs.openClose({
            sessionId:'QA_SCROLL',
            summary:{billCount:0,totalSales:0,openingCash:0,cashReceived:0,changeGiven:0,expectedCash:0},
            close:() => { throw Error('Test must not close a session'); },
            onClosed:() => {}
        }));
        const dialog = page.locator('#posCloseSessionOverlay');
        const panel = dialog.locator(':scope > div');
        const input = dialog.locator('#pos-closing-cash');
        assert.equal(await input.evaluate(el => document.activeElement === el), true);
        assert.equal(await panel.getAttribute('tabindex'), '0');
        assert.equal(await dialog.getAttribute('role'), 'dialog');
        assert(await panel.evaluate(el => el.scrollHeight > el.clientHeight), 'review must overflow');
        await panel.evaluate(el => { el.scrollTop = 0; });
        const cash = await input.inputValue();
        await input.press('ArrowDown');
        const down = await panel.evaluate(el => el.scrollTop);
        assert(down > 0, 'ArrowDown scrolls the review');
        await input.press('PageDown');
        const pageDown = await panel.evaluate(el => el.scrollTop);
        assert(pageDown > down, 'PageDown scrolls farther');
        await input.press('ArrowUp');
        const up = await panel.evaluate(el => el.scrollTop);
        assert(up < pageDown, 'ArrowUp scrolls back');
        await input.press('PageUp');
        assert(await panel.evaluate(el => el.scrollTop) < up, 'PageUp scrolls back farther');
        assert.equal(await input.inputValue(), cash, 'scroll keys never alter closing cash');
        await input.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.className), 'pos-close-cancel', 'Tab reaches Cancel');
        const beforeButtonScroll = await panel.evaluate(el => el.scrollTop);
        await page.keyboard.press('ArrowUp');
        assert(await panel.evaluate(el => el.scrollTop) < beforeButtonScroll, 'ArrowUp also scrolls from an action button');
        assert.equal(await input.inputValue(), cash, 'button scroll leaves closing cash unchanged');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.className), 'pos-close-confirm', 'Tab reaches Close Session');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Enter');
        await dialog.waitFor({state:'detached'});
        console.log('PASS close-session keyboard scroll and Cancel');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
