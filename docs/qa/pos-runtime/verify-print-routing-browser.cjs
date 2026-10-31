const path = require('node:path');

module.exports = async function ({a, base, sessionId, transactionId, receipt, check, out}) {
    for (const shell of ['apps', 'qapps']) {
        const page = await a.c.newPage();
        page.setDefaultTimeout(15000);
        // Never contact the workstation's QZ service or send a real printer job.
        await page.route('**/qz-tray@*/qz-tray.js', route => route.fulfill({contentType:'text/javascript', body:'/* Disposable QA uses a mock printer. */'}));
        try {
            if(shell==='qapps'){
                await page.goto(`${base}/qapps/zenith/pos/Dashboard`,{waitUntil:'domcontentloaded'});
                const href=await page.locator('#zq-subnav a[data-match="/pos/Terminal"]').getAttribute('href');
                check('Quasar printing uses its canonical standalone billing link',href==='/apps/zenith/pos/Terminal',{href});
            }
            await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${sessionId}&taxOn=N`, {waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>typeof window._posPrintReceipt==='function' && typeof window.posToggleFocus==='function');
            await page.evaluate(()=>{
                window.qaPrinter = {active:false, connections:0, jobs:[], browser:0, rejectPrint:false};
                const state = window.qaPrinter;
                window.qz = {
                    websocket:{isActive:()=>state.active, connect:()=>{state.connections++;state.active=true;
                        return new Promise(resolve=>{state.allow=()=>{state.active=true;resolve();};});}},
                    printers:{find:()=>Promise.resolve(['Disposable QA printer'])},
                    configs:{create:(name,options)=>({name,options})},
                    print:(config,data)=>{if(state.rejectPrint)return Promise.reject(Error('QA printer unavailable'));
                        state.jobs.push({config,data});return Promise.resolve();}
                };
                // Intercept only browser print; the app still creates and renders its real receipt iframe.
                const observer = new MutationObserver(()=>{
                    const frame = document.getElementById('pos-receipt-frame');
                    if(frame && !frame.dataset.qaPrint){frame.dataset.qaPrint='1';frame.contentWindow.print=()=>{
                        state.browser++;
                        if(document.fullscreenElement)document.exitFullscreen();
                        frame.contentWindow.dispatchEvent(new Event('afterprint'));
                    };}
                });
                observer.observe(document.body,{childList:true});
            });
            await page.locator('#posFullscreenBtn').click();
            await page.waitForFunction(()=>!!document.fullscreenElement);
            const print = (tax='N', edited=false) => page.evaluate(({transactionId,receipt,tax,edited})=>
                { void window._posPrintReceipt(transactionId,'QA-PRINT',tax,edited,receipt); },{transactionId,receipt,tax,edited});
            await print();
            await page.waitForTimeout(1700); // Beyond the original 1.2-second failure window.
            const waiting = await page.evaluate(()=>({connections:qaPrinter.connections,browser:qaPrinter.browser,
                fullscreen:!!document.fullscreenElement,jobs:qaPrinter.jobs.length}));
            check(shell+' slow printer permission preserves fullscreen without browser preview',
                waiting.connections===1 && waiting.browser===0 && waiting.fullscreen && waiting.jobs===0, waiting);
            await page.evaluate(()=>qaPrinter.allow());
            const setup = page.locator('.pos-printer-overlay');
            if(await setup.waitFor({state:'visible',timeout:1000}).then(()=>true).catch(()=>false)){
                await setup.locator('.qz-printer-opt').click();await setup.locator('.qz-save').click();
            }
            await page.waitForFunction(()=>qaPrinter.jobs.length===1);
            await print('Y');await page.waitForFunction(()=>qaPrinter.jobs.length===2);
            await print('N',true);await page.waitForFunction(()=>qaPrinter.jobs.length===3);
            const direct = await page.evaluate(()=>({jobs:qaPrinter.jobs.length,browser:qaPrinter.browser,
                fullscreen:!!document.fullscreenElement,pressed:document.getElementById('posFullscreenBtn').getAttribute('aria-pressed'),
                configuration:qaPrinter.jobs[0].config.options}));
            check(shell+' consecutive tax on/off and revised QZ receipts keep native fullscreen',
                direct.jobs===3 && direct.browser===0 && direct.fullscreen && direct.pressed==='true' && direct.configuration.size.width===80,direct);

            await page.evaluate(()=>qaPrinter.rejectPrint=true);await print();
            const fallback = page.locator('.pos-print-fallback');await fallback.waitFor();
            check(shell+' printer failure offers an explicit fallback without leaving fullscreen',
                await page.evaluate(()=>!!document.fullscreenElement && qaPrinter.browser===0));
            if(out && shell==='apps')await page.screenshot({path:path.join(out,'printer-fullscreen-fallback.png')});
            await page.evaluate(()=>{qaPrinter.active=false;qaPrinter.rejectPrint=false;});
            await fallback.locator('.pos-print-retry').click();
            check(shell+' pending retry disables browser printing to prevent duplicate copies',
                await fallback.locator('.pos-print-browser').isDisabled() && await fallback.locator('.pos-print-cancel').isDisabled());
            await page.evaluate(()=>qaPrinter.allow());await fallback.waitFor({state:'detached'});
            check(shell+' retry sends the same receipt directly and keeps fullscreen',
                await page.evaluate(()=>qaPrinter.jobs.length===4 && qaPrinter.browser===0 && !!document.fullscreenElement));

            await page.evaluate(()=>qaPrinter.rejectPrint=true);await print();await fallback.waitFor();
            await fallback.locator('.pos-print-cancel').click();
            check(shell+' dismissing a print failure never prints or changes fullscreen',
                await page.evaluate(()=>qaPrinter.jobs.length===4 && qaPrinter.browser===0 && !!document.fullscreenElement));
            await print();await fallback.waitFor();await fallback.locator('.pos-print-browser').click();
            await page.waitForFunction(()=>qaPrinter.browser===1 && !document.fullscreenElement);
            check(shell+' only explicit browser fallback opens print once and syncs the fullscreen icon',
                await page.locator('#posFullscreenBtn').getAttribute('aria-pressed')==='false' &&
                await page.evaluate(()=>qaPrinter.jobs.length===4 && qaPrinter.browser===1));
            await page.locator('#posFullscreenBtn').click();await page.waitForFunction(()=>!!document.fullscreenElement);
            await page.evaluate(()=>window.qz=undefined);await print();await fallback.waitFor();
            check(shell+' unavailable QZ never forces the browser out of fullscreen',
                await page.evaluate(()=>qaPrinter.browser===1 && !!document.fullscreenElement));
            await fallback.locator('.pos-print-cancel').click();
            await page.evaluate(()=>document.exitFullscreen());
        } catch(error) {
            if(out)await page.screenshot({path:path.join(out,'printer-'+shell+'-failure.png')});
            throw error;
        } finally { await page.close(); }
    }
};
