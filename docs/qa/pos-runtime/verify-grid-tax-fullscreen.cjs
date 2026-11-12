// Verify the real Terminal path with an active, mixed-GST grid cart.
module.exports = async function ({a, foreign, base, check, q, invoke, post}) {
    const terminalId = 'POS_QA_A_GRID_TAX';
    await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable grid tax counter',
        facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
    const session = await invoke('open', {terminalId, openingCash:'0'});
    const {transactionId} = await invoke('cart', {sessionId:session.sessionId});
    const page = await a.c.newPage();
    try {
        for (const productId of ['POS_QA_A_P18', 'POS_QA_A_P5']) {
            await invoke('add', {transactionId, productId, quantity:'2', taxOn:'N', salesModeId:'RETAIL'});
        }
        // Isolate the toggle's request count from the independent initial offline cache export.
        await page.route('**/Terminal/exportPosCatalog', route => route.fulfill({status:503}));
        await page.addInitScript(() => localStorage.setItem('posLayoutMode', 'advanced'));
        await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+
            '&transactionId='+transactionId+'&salesModeId=RETAIL&taxOn=N', {waitUntil:'networkidle'});
        await page.waitForFunction(() => typeof window._posCurrentTax === 'function');
        const fullscreen = page.locator('#posFullscreenBtn');
        await fullscreen.click();
        await page.waitForFunction(() => !!(document.fullscreenElement || document.webkitFullscreenElement) &&
            document.getElementById('posFullscreenBtn').getAttribute('aria-pressed')==='true');
        const resize = await page.evaluate(async () => {
            const root = document.getElementById('pos-terminal-root');
            const icon = document.querySelector('#fsBtnIcon svg');
            const card = document.querySelector('.pos-product-grid button[type=submit]');
            window.posGridTestCard = card;
            window.posGridTestRoot = root;
            const originalStyle = root.getAttribute('style');
            for (let i = 0; i < 12; i++) window.dispatchEvent(new Event('resize'));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {
                iconRetained:icon === document.querySelector('#fsBtnIcon svg'),
                styleRetained:originalStyle === root.getAttribute('style'),
                viewportFit:Math.abs(root.getBoundingClientRect().height-innerHeight) <= 2,
                cardVisible:!!card?.getBoundingClientRect().height
            };
        });
        await page.waitForLoadState('networkidle');
        const requests = [];
        let switching = false;
        page.on('request', request => {
            if (!switching) return;
            const path = new URL(request.url()).pathname;
            const action = new URLSearchParams(request.postData() || '').get('action');
            if (path.endsWith('/toggleTax')) requests.push('HTML toggle');
            if (path.endsWith('/Terminal') && request.redirectedFrom()) requests.push('Terminal redirect');
            if (path.endsWith('/ajaxCart') && ['toggleTax','refresh'].includes(action)) requests.push(action);
        });
        const toggle = page.locator('.nb-tax button');
        const snapshot = () => q(`SELECT total_tax_amount,grand_total FROM pos_transaction WHERE transaction_id='${transactionId}'`)[0];
        async function switchTax(enabled) {
            switching = true;
            const start = Date.now();
            const updated = page.waitForResponse(response => {
                const action = new URLSearchParams(response.request().postData() || '').get('action');
                return response.url().endsWith('/ajaxCart') && ['toggleTax','refresh'].includes(action);
            });
            await toggle.click();
            const response = await updated;
            const payload = await response.json();
            await page.waitForFunction(on => !document.querySelector('.nb-tax button').disabled &&
                window._posCurrentTax() === (on ? 'Y' : 'N'), enabled);
            switching = false;
            return {milliseconds:Date.now()-start, payloadBytes:Buffer.byteLength(JSON.stringify(payload)),
                tax:Number(payload.tax), total:Number(payload.grand)};
        }
        const on = await switchTax(true);
        const storedOn = snapshot();
        const details = q(`SELECT tax_amount FROM tax_line_detail WHERE reference_type='PosTransactionItem' AND reference_id='${transactionId}'`);
        const off = await switchTax(false);
        const storedOff = snapshot();
        const remaining = q(`SELECT tax_amount FROM tax_line_detail WHERE reference_type='PosTransactionItem' AND reference_id='${transactionId}'`);
        const view = await page.evaluate(() => ({
            gridRetained:window.posGridTestCard === document.querySelector('.pos-product-grid button[type=submit]'),
            rootRetained:window.posGridTestRoot === document.getElementById('pos-terminal-root'),
            fullscreen:!!(document.fullscreenElement || document.webkitFullscreenElement),
            state:document.querySelector('.nb-tax button').getAttribute('aria-pressed'),
            quantities:[...document.querySelectorAll('.pos-cart .aj-qi')].map(input => Number(input.value))
        }));
        check('Grid tax round trip preserves persisted mixed GST, quantities and fullscreen',
            on.tax===56 && on.total===656 && Number(storedOn.total_tax_amount)===56 &&
            details.length===4 && details.reduce((sum,row) => sum+Number(row.tax_amount),0)===56 &&
            off.tax===0 && off.total===600 && Number(storedOff.grand_total)===600 && remaining.length===0 &&
            view.gridRetained && view.rootRetained && view.fullscreen && view.state==='false' &&
            view.quantities.join(',')==='2,2', {on,off,storedOn,storedOff,details,view});
        check('Grid tax and fullscreen avoid document reloads, second cart reads and resize rewrites',
            requests.join(',')==='toggleTax,toggleTax' && Object.values(resize).every(Boolean), {requests,resize,on,off});
        const denied = await post('Terminal','ajaxCart',{
            action:'toggleTax',sessionId:session.sessionId,transactionId,taxOn:'Y'
        },foreign);
        check('Another organization cannot toggle this cart or read its totals',
            !(await denied.json().catch(() => ({}))).success && Number(snapshot().total_tax_amount)===0);

        // Lose the reply after the server commits. Billing must require a confirmed retry.
        let releaseReply;
        const holdReply = new Promise(resolve => { releaseReply = resolve; });
        await page.route('**/Terminal/ajaxCart', async route => {
            if (new URLSearchParams(route.request().postData() || '').get('action') !== 'toggleTax') {
                return route.continue();
            }
            try { await route.fetch(); await holdReply; }
            finally { await route.abort(); }
        });
        try {
            await toggle.click();
            check('Tax toggle shows progress while the server response is pending',
                await page.locator('.nb-tax').getAttribute('aria-busy')==='true' &&
                await page.locator('.nb-tax__lbl').innerText()==='Updating tax…' && await toggle.isDisabled());
            await page.locator('.pos-cash-btn').click();
            check('Cash checkout waits for the pending tax result', await page.locator('.pos-cash-panel').count()===0);
        } finally { releaseReply(); }
        await page.waitForFunction(() => !document.querySelector('.nb-tax button').disabled &&
            document.body.textContent.includes('Could not confirm tax mode.'));
        await page.locator('.pos-cash-btn').click();
        check('A lost tax response blocks checkout until the cashier retries',
            await page.locator('.pos-cash-panel').count()===0 &&
            await page.evaluate(() => window._posCurrentTax())==='N' &&
            Number(snapshot().total_tax_amount)===56);
        await page.unroute('**/Terminal/ajaxCart');
        await switchTax(true);
        const retried = q(`SELECT tax_amount FROM tax_line_detail WHERE reference_type='PosTransactionItem' AND reference_id='${transactionId}'`);
        check('Retry confirms the same tax mode without duplicate GST details',
            retried.length===4 && retried.reduce((sum,row) => sum+Number(row.tax_amount),0)===56);
        await fullscreen.click();
        await page.waitForFunction(() => !document.fullscreenElement && !document.webkitFullscreenElement &&
            document.getElementById('posFullscreenBtn').getAttribute('aria-pressed')==='false' &&
            Math.abs(document.getElementById('pos-terminal-root').getBoundingClientRect().height-innerHeight)<=2);
        check('Fullscreen exit restores the billing control and CSS-sized viewport',
            await fullscreen.getAttribute('aria-pressed')==='false' && await page.evaluate(() =>
                Math.abs(document.getElementById('pos-terminal-root').getBoundingClientRect().height-innerHeight)<=2));
    } finally {
        await page.close();
        await invoke('void', {transactionId});
        await invoke('close', {sessionId:session.sessionId, closingCash:'0'});
    }
};
