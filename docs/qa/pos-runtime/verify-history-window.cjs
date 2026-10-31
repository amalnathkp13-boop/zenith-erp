const path = require('node:path');
const fs = require('node:fs');

module.exports = async function ({a, foreign, base, check, q, invoke, post, out}) {
    const failures = [];
    const observe = (...args) => { try { check(...args); } catch (error) { failures.push(error.message); } };
    const seeded = await post('PosQaAcceptance', 'historySearchFixtures');
    check('disposable history search boundary fixtures initialized', seeded.ok() && (await seeded.json()).prepared);
    check('history search fixture exceeds the old 500-product scan', Number(q("SELECT count(*) AS n FROM product WHERE owner_party_id='POS_QA_A'")[0].n) > 520);
    const terminalId = 'POS_QA_A_HISTORY';
    await post('PosTerminals', 'createTerminal', {terminalId, terminalName:'Disposable history counter',
        facilityId:'POS_QA_A_FAC', organizationPartyId:'POS_QA_A', stateCode:'33', isActive:'Y'});
    const session = await invoke('open', {terminalId, openingCash:'0'});
    const bill = await invoke('cart', {sessionId:session.sessionId, reuseOpenCart:'false'});
    await invoke('add', {transactionId:bill.transactionId, productId:'POS_QA_A_P18', quantity:'1', taxOn:'N'});
    await invoke('add', {transactionId:bill.transactionId, productId:'POS_QA_A_SEARCH_WEIGHT', quantity:'1.25', taxOn:'N'});
    await invoke('pay', {transactionId:bill.transactionId, paymentMethod:'Card', amount:'110'});
    await invoke('complete', {transactionId:bill.transactionId});
    await invoke('sync', {transactionId:bill.transactionId});
    const snapshot = () => JSON.stringify([
        q(`SELECT status_id,transaction_number,subtotal,total_tax_amount,payable_amount,paid_amount FROM pos_transaction WHERE transaction_id='${bill.transactionId}'`),
        q(`SELECT item_seq_id,product_id,quantity,unit_price,line_total FROM pos_transaction_item WHERE transaction_id='${bill.transactionId}' ORDER BY item_seq_id`),
        q(`SELECT payment_id,payment_method,amount FROM pos_payment WHERE transaction_id='${bill.transactionId}' ORDER BY payment_id`)
    ]);
    const before = snapshot();
    const taxable = await invoke('cart', {sessionId:session.sessionId, reuseOpenCart:'false'});
    await invoke('add', {transactionId:taxable.transactionId, productId:'POS_QA_A_P18', quantity:'1', taxOn:'Y'});
    await invoke('pay', {transactionId:taxable.transactionId, paymentMethod:'UPI', amount:'118'});
    await invoke('complete', {transactionId:taxable.transactionId});
    await invoke('sync', {transactionId:taxable.transactionId});
    async function search(term, shell='apps', actor=a, extra={}) {
        const response = await post('Terminal', 'ajaxCart', {action:'searchProductsJson', q:term,
            sessionId:session.sessionId, terminalId, ...extra}, actor, true, shell);
        let data = {}; try { data = await response.json(); } catch {}
        return {response, data};
    }
    for (const shell of ['apps', 'qapps']) {
        for (const [term, id] of [['water cup','WATER'], ['TEA CUP','TEA'], ['SEARCH_WATER','WATER'], ['10%_Cup','LITERAL']]) {
            const {response, data} = await search(term, shell);
            observe(shell+' history finds '+term+' beyond product 500', response.status()===200 && data.success &&
                data.products.some(p=>p.pid==='POS_QA_A_SEARCH_'+id), {status:response.status(), products:data.products});
            observe(shell+' history search stays scoped and bounded for '+term,
                data.products?.length<=10 && data.products.every(p=>!p.pid.startsWith('POS_QA_B')), data);
        }
        const forged = await search('water cup', shell, a, {organizationPartyId:'POS_QA_B'});
        observe(shell+' history ignores a forged organization selector', forged.data.products?.every(p=>!p.pid.startsWith('POS_QA_B')), forged.data);
        const denied = await search('water cup', shell, foreign);
        check(shell+' foreign session history search is denied', denied.response.status()===403 || !denied.data.success);
    }
    const page = await a.c.newPage();
    page.on('dialog', dialog=>dialog.accept());
    try {
        // Reproduce the stale persisted focus state left by the previous implementation.
        await page.addInitScript(()=>{localStorage.setItem('posFocus','1');sessionStorage.setItem('posFS','1');});
        await page.setViewportSize({width:1366,height:600});
        await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${session.sessionId}&taxOn=N`, {waitUntil:'networkidle'});
        await page.waitForFunction(()=>typeof window.posToggleFocus==='function');
        const state = () => page.evaluate(()=>({fullscreen:!!document.fullscreenElement,
            focus:document.body.classList.contains('pos-focus'), pressed:document.getElementById('posFullscreenBtn').getAttribute('aria-pressed')}));
        const initial = await state();
        observe('POS starts outside fullscreen despite saved legacy flags', !initial.fullscreen && !initial.focus && initial.pressed==='false', initial);
        await page.locator('#posFullscreenBtn').click();
        await page.waitForTimeout(350);
        const entered = await state();
        observe('one fullscreen click enters actual browser fullscreen', entered.fullscreen && entered.focus && entered.pressed==='true', entered);
        if (entered.fullscreen) await page.evaluate(()=>document.exitFullscreen());
        else if (entered.focus) await page.locator('#posFullscreenBtn').click();
        await page.waitForTimeout(200);
        const exited = await state();
        observe('native fullscreen exit resets the billing icon and layout', !exited.fullscreen && !exited.focus && exited.pressed==='false', exited);
        await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(new Error('QA denied fullscreen'));});
        await page.locator('#posFullscreenBtn').click();
        await page.waitForTimeout(100);
        const refused = await state();
        check('a refused fullscreen request never leaves a false fullscreen icon', !refused.fullscreen && !refused.focus && refused.pressed==='false', refused);
        await page.evaluate(()=>{delete document.documentElement.requestFullscreen;});

        await page.locator('.nb-abtn--history').click();
        await page.locator(`.hist-bill-row[data-tx-id="${bill.transactionId}"]`).click();
        await page.locator('#ced-add').fill('water cup');
        const water = page.locator('#ced-add-res .ced-pi[data-pid="POS_QA_A_SEARCH_WATER"]');
        const visible = await water.waitFor({state:'visible',timeout:5000}).then(()=>true).catch(()=>false);
        observe('History editor offers the same Water Cup as billing', visible);
        if (visible) {
            await water.click();
            await page.locator('#ced-add').fill('tea cup');
            await page.locator('#ced-add-res .ced-pi[data-pid="POS_QA_A_SEARCH_TEA"]').click();
            check('History editor adds both late-catalog matches to its draft',
                (await page.locator('#ced-rows').innerText()).includes('ZZ History Water Cup') &&
                (await page.locator('#ced-rows').innerText()).includes('ZZ History Tea Cup'));
            if(out)await page.screenshot({path:path.join(out,'history-search-editor.png')});
        }
        await page.locator('#ced-cancel').click();
        check('search and cancelled history edits leave the issued test bill unchanged', snapshot()===before);

        for (const size of [{width:1366,height:600},{width:1024,height:500},{width:390,height:600}]) {
            await page.setViewportSize(size);
            await page.locator('.nb-power').click();
            const dialog = page.locator('#posCloseSessionOverlay > div');
            await dialog.waitFor();
            await dialog.hover();
            await page.mouse.wheel(0,1800);
            await page.waitForTimeout(200);
            const geometry = await page.locator('.pos-close-confirm').evaluate(el=>{const r=el.getBoundingClientRect();
                const panel=el.closest('#posCloseSessionOverlay > div');return {top:r.top,bottom:r.bottom,height:innerHeight,
                    panelScroll:panel.scrollTop,scrollable:panel.scrollHeight>panel.clientHeight};});
            observe('Close Session scroll reaches its buttons at '+size.width+'x'+size.height,
                geometry.top>=0 && geometry.bottom<=size.height && geometry.scrollable && geometry.panelScroll>0, geometry);
            if(out && size.width===1366)await page.screenshot({path:path.join(out,'close-session-scroll.png')});
            if (geometry.top>=0 && geometry.bottom<=size.height) await page.locator('.pos-close-cancel').click();
            else await page.locator('.pos-close-cancel').evaluate(el=>el.click());
        }
        for (const [transactionId, tax, edited] of [[bill.transactionId,'N',false],[taxable.transactionId,'Y',false],[bill.transactionId,'N',true]]) {
            const receipt = (await invoke('receipt', {transactionId})).receipt;
            await page.evaluate(({transactionId,tax,edited,receipt})=>{window.qz=undefined;
                window._posPrintReceipt(transactionId,'QA-RECEIPT',tax,edited,receipt);}, {transactionId,tax,edited,receipt});
            await page.waitForFunction(()=>document.getElementById('pos-receipt-frame')?.contentDocument?.body.innerText.includes('Subtotal'));
            const printed = await page.evaluate(()=>{const doc=document.getElementById('pos-receipt-frame').contentDocument;
                return {text:doc.body.innerText,colors:[...doc.querySelectorAll('td,th,.hdr')].map(el=>getComputedStyle(el).color)};});
            if(out && !edited){
                const preview=await a.c.newPage();await preview.setViewportSize({width:320,height:600});
                await preview.setContent(await page.evaluate(()=>document.getElementById('pos-receipt-frame').contentDocument.documentElement.outerHTML));
                await preview.screenshot({path:path.join(out,'thermal-tax-'+tax+'.png'),fullPage:true});await preview.close();
            }
            check('thermal '+tax+' tax / edited '+edited+' keeps black text and removes clutter',
                !/Total Qty:|Items:|Taxable \(after discount\)|\bUPI\b|\bCard\b/.test(printed.text) &&
                printed.colors.every(color=>color==='rgb(0, 0, 0)'), printed);
            if (transactionId===bill.transactionId) check('thermal quantity keeps each saved unit', printed.text.includes('1 Nos') && printed.text.includes('1.25 kg'), printed);
            if (tax==='Y') check('tax receipt retains tax and payable',printed.text.includes('CGST') && printed.text.includes('SGST') && printed.text.includes('118.00'),printed);
            const pdf = await a.c.request.get(`${base}/fop/apps/zenith/pos/ReceiptPdf?transactionId=${transactionId}`);
            check('receipt PDF renders for tax '+tax,pdf.status()===200 && (pdf.headers()['content-type']||'').includes('pdf'),{status:pdf.status()});
            if(out)fs.writeFileSync(path.join(out,'receipt-tax-'+tax+'.pdf'),await pdf.body());
        }
        await require('./verify-print-routing-browser.cjs')({a,base,sessionId:session.sessionId,
            transactionId:bill.transactionId,receipt:(await invoke('receipt',{transactionId:bill.transactionId})).receipt,check,out});
        check('printer routing tests leave the issued test bill and tenders unchanged',snapshot()===before);
        if (out) await page.screenshot({path:path.join(out,'history-window-regression.png')});
    } finally {
        await page.close();
        await invoke('close', {sessionId:session.sessionId, closingCash:'0'});
    }
    if (failures.length) throw Error(failures.join('\n'));
};
