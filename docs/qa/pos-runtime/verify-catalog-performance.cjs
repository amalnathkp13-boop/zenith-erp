// Read-only catalog boundary checks, using the full acceptance suite's independent DB probe.
module.exports = async function ({a, foreign, base, check, q, invoke}) {
    let session = q("SELECT session_id FROM pos_session WHERE organization_party_id='POS_QA_A' AND status_id='PsOpen' ORDER BY session_id")[0];
    if (!session) session = {session_id:(await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'})).sessionId};
    const sessionId = session.session_id;
    const snapshot = () => JSON.stringify([
        q("SELECT * FROM pos_transaction WHERE organization_party_id='POS_QA_A' ORDER BY transaction_id"),
        q("SELECT * FROM pos_transaction_item WHERE transaction_id IN (SELECT transaction_id FROM pos_transaction WHERE organization_party_id='POS_QA_A') ORDER BY transaction_id,item_seq_id"),
        q("SELECT * FROM pos_payment WHERE transaction_id IN (SELECT transaction_id FROM pos_transaction WHERE organization_party_id='POS_QA_A') ORDER BY payment_id"),
        q("SELECT * FROM asset WHERE owner_party_id='POS_QA_A' ORDER BY asset_id"),
        q("SELECT product_id,mrp_amount,last_updated_stamp FROM product WHERE owner_party_id='POS_QA_A' ORDER BY product_id")
    ]);
    const initialSearch=await a.c.request.get(`${base}/apps/zenith/pos/Terminal?sessionId=${sessionId}&searchTerm=POS_QA_A_P18`);
    const initialHtml=await initialSearch.text();
    check('initial product search retains its offset binding and renders',initialSearch.status()===200&&initialHtml.includes('Results for')&&!/Template Error|gridOffset.*null/.test(initialHtml));
    const before = snapshot();
    async function request(params={},actor=a,shell='apps',token=true) {
        const r=await actor.c.request.post(`${base}/${shell}/zenith/pos/Terminal/productGrid`,{
            form:{sessionId,salesModeId:'RETAIL',...(token?{moquiSessionToken:actor.t}:{}),...params},maxRedirects:0
        });
        let body;try{body=await r.json();}catch{body={};}
        return {r,body};
    }
    for (const shell of ['apps','qapps']) {
        let {r,body}=await request({},a,shell);
        check(shell+' lightweight catalog returns only this organizations products',r.status()===200&&body.success&&body.products.length>0&&body.products.every(x=>!x.productId.startsWith('POS_QA_B')),{status:r.status(),count:body.products?.length});
        check(shell+' catalog is capped at 60 cards and excludes tokens',body.products.length<=60&&!JSON.stringify(body).includes('moquiSessionToken'));
        ({r,body}=await request({catId:'POS_QA_A_CAT'},a,shell));
        check(shell+' category filter includes its member',body.success&&body.products.some(x=>x.productId==='POS_QA_A_P18'));
        ({r,body}=await request({searchTerm:'pos_qa_a_p18'},a,shell));
        check(shell+' catalog search retains case-insensitive product lookup',body.success&&body.products.some(x=>x.productId==='POS_QA_A_P18'));
        ({r,body}=await request({searchTerm:'no-such-disposable-product'},a,shell));
        check(shell+' unmatched search returns an empty bounded page',body.success&&body.products.length===0&&!body.hasMore);
        ({r,body}=await request({salesModeId:'WHOLESALE',searchTerm:'POS_QA_A_P18'},a,shell));
        const expected=q("SELECT price FROM pos_product_mode_price WHERE product_id='POS_QA_A_P18' AND sales_mode_id='WHOLESALE' AND organization_party_id='POS_QA_A'")[0];
        check(shell+' fixed-mode card price agrees with persisted mode pricing',body.success&&body.products.length===1&&!body.products[0].blocked&&Number(body.products[0].price)===Number(expected.price));
        ({r,body}=await request({salesModeId:'WHOLESALE',searchTerm:'POS_QA_A_NOWS'},a,shell));
        check(shell+' missing fixed price remains blocked',body.success&&body.products.length===1&&body.products[0].blocked);
        ({r,body}=await request({organizationPartyId:'POS_QA_B',catId:'POS_QA_B_CAT'},a,shell));
        check(shell+' forged organization/category cannot leak another catalog',body.success&&body.products.every(x=>!x.productId.startsWith('POS_QA_B')));
        ({r,body}=await request({},foreign,shell));
        check(shell+' foreign session is rejected before returning products',r.status()===403&&!body.success&&!body.products,{status:r.status()});
        ({r,body}=await request({salesModeId:'not-an-available-mode'},a,shell));
        check(shell+' unavailable mode cannot expose its prices',r.status()===400&&!body.success);
        ({r,body}=await request({},a,shell,false));
        check(shell+' catalog POST requires the session token',!body.success&&!body.products,{status:r.status()});
        const get=await a.c.request.get(`${base}/${shell}/zenith/pos/Terminal/productGrid?sessionId=${sessionId}`,{maxRedirects:0});
        check(shell+' catalog transition rejects GET',get.status()!==200,{status:get.status()});
    }
    const cashierContext=await a.c.browser().newContext({serviceWorkers:'block'});
    try {
        await cashierContext.request.get(base+'/apps/zenith/pos/Terminal',{
            headers:{Authorization:'Basic '+Buffer.from('pos.cashier.qa:moqui').toString('base64')}
        });
        const cashierPage=await cashierContext.newPage();
        await cashierPage.goto(base+'/apps/zenith/pos/Terminal?sessionId='+sessionId,{waitUntil:'networkidle'});
        const cashier={c:cashierContext,t:await cashierPage.locator('[name=moquiSessionToken]').first().inputValue()};
        const {r,body}=await request({},cashier);
        check('a cashier retains authorized catalog access',r.status()===200&&body.success&&body.products.length>0,{status:r.status()});
    } finally {await cashierContext.close();}
    check('catalog browsing leaves persisted carts, money, prices and stock unchanged',snapshot()===before);
    const cart=await invoke('cart',{sessionId,reuseOpenCart:'false'});
    await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
    await invoke('add',{transactionId:cart.transactionId,productId:'POS_QA_A_P5',quantity:'1',taxOn:'N'});
    const p=await a.c.newPage();
    try {
        await p.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${sessionId}&transactionId=${cart.transactionId}&taxOn=N`,{waitUntil:'networkidle'});
        await p.waitForFunction(()=>typeof window._posRefreshCart==='function');
        await p.evaluate(()=>window._posRefreshCart());
        check('first AJAX hydration creates no duplicate cart rows',await p.locator('.pos-cart tbody tr').count()===2);
        const rapidSaved=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/ajaxCart')&&
            new URLSearchParams(r.request().postData()||'').get('action')==='updateQty'&&
            new URLSearchParams(r.request().postData()||'').get('newQty')==='12');
        const result=await p.evaluate(async()=>{
            const rows=document.querySelectorAll('.pos-cart tbody tr'), input=rows[1].querySelector('.aj-p');
            input.value='207.25';input.focus();
            for(let i=0;i<10;i++)window._posAjax('POS_QA_A_P18',100,'Disposable POS A P18');
            rows[0].querySelectorAll('.aj-q')[1].click();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return {connected:input.isConnected,focused:document.activeElement===input,draft:input.value,
                quantity:Number(document.querySelector('.pos-cart .aj-qi').value)};
        });
        check('rapid additions preserve other line drafts and focus',result.connected&&result.focused&&result.draft==='207.25',result);
        check('a quantity step before the next frame retains every addition',result.quantity===12,result);
        await rapidSaved;
        const stored=q(`SELECT quantity FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}' AND product_id='POS_QA_A_P18'`)[0];
        check('the complete rapid-click quantity is persisted exactly once',Number(stored.quantity)===12,stored);
        await p.evaluate(()=>document.activeElement.blur());
        await p.evaluate(()=>window._posRefreshCart());
        await p.evaluate(()=>{
            window._posAjax('POS_QA_A_P18',100,'Disposable POS A P18');
            document.querySelector('.pos-cash-btn').click();
        });
        await p.locator('.pos-cash-panel').waitFor();
        const payment=await p.evaluate(()=>({cash:Number(document.querySelector('.pos-cash-quick').dataset.amt),panel:true}));
        check('an immediate cash-panel click reads the newly queued total',payment.panel&&payment.cash===1500,payment);
        await p.waitForLoadState('networkidle');
        check('queued cart replies cannot dismiss the cash panel',await p.locator('.pos-cash-panel').count()===1);
        const removal=await p.evaluate(async()=>{
            document.querySelector('.pos-cash-cancel').click();
            const rows=document.querySelectorAll('.pos-cart tbody tr'), input=rows[1].querySelector('.aj-p');
            input.value='209.50';input.focus();rows[0].querySelector('.aj-rm').click();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return {connected:input.isConnected,focused:document.activeElement===input,draft:input.value,
                rows:document.querySelectorAll('.pos-cart tbody tr').length,contents:Array.from(document.querySelectorAll('.pos-cart tbody tr')).map(r=>r.textContent)};
        });
        check('removing another row preserves the remaining price draft while renumbering',removal.connected&&removal.focused&&removal.draft==='209.50'&&removal.rows===1,removal);
        await p.waitForLoadState('networkidle');
        // Start this independent keyboard scenario from the persisted cart. A queued
        // removal repaint can otherwise refocus search between Tab and the digit.
        await p.reload({waitUntil:'networkidle'});
        await p.waitForFunction(()=>typeof window._posRefreshCart==='function');
        await p.evaluate(()=>window._posRefreshCart());
        check('keyboard scenario hydrates the remaining persisted line',await p.locator('.pos-cart tbody tr .aj-qi').count()===1);
        await p.evaluate(()=>document.activeElement.blur());
        await p.keyboard.press('Tab');
        await p.waitForFunction(()=>document.getElementById('posZoneHint')?.textContent.includes('CART LINE')).catch(async error=>{
            const state=await p.evaluate(()=>({focus:document.activeElement.tagName,focusId:document.activeElement.id,
                dialog:!!document.querySelector('[role=dialog]'),hint:document.getElementById('posZoneHint')?.textContent}));
            throw Error('Keyboard cart selection failed: '+JSON.stringify(state)+'; '+error.message);
        });
        await p.keyboard.press('7');
        await p.waitForFunction(()=>document.getElementById('posZoneHint')?.textContent.includes('SET QTY')).catch(async error=>{
            const state=await p.evaluate(()=>({focus:document.activeElement.tagName,focusId:document.activeElement.id,
                hint:document.getElementById('posZoneHint')?.textContent,rows:Array.from(document.querySelectorAll('.pos-cart tbody tr')).map(r=>({visible:!!r.offsetParent,seq:r.querySelector('.aj-q')?.dataset.seq,qty:r.querySelector('.aj-qi')?.value}))}));
            throw Error('Keyboard digit failed: '+JSON.stringify(state)+'; '+error.message);
        });
        const savedQuantity=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/ajaxCart')&&
            new URLSearchParams(r.request().postData()||'').get('action')==='updateQty'&&
            new URLSearchParams(r.request().postData()||'').get('newQty')==='7');
        await p.keyboard.press('Enter');await savedQuantity;
        const keyed=q(`SELECT quantity FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}' AND product_id='POS_QA_A_P5'`)[0];
        check('numeric keyboard entry remains an absolute quantity edit',Number(keyed.quantity)===7,keyed);
    } finally {
        await p.close();
        await invoke('void',{transactionId:cart.transactionId});
    }
};
