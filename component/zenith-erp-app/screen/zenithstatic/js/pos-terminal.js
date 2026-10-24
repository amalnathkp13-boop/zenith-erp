/* Free-item approval is checked by the server again at every money/save boundary. */
window.PosFreeItems = (function () {
    function endpoint(name) {
        var path = location.pathname.replace(/\/+$/, ''), i = path.indexOf('/zenith/pos/');
        return (i >= 0 ? path.slice(0, i) + '/zenith/pos/Terminal/' : 'Terminal/') + name;
    }
    function api(name, data, token) {
        return fetch(endpoint(name), {method:'POST',credentials:'same-origin',
            body:new URLSearchParams(Object.assign({moquiSessionToken:token}, data))}).then(function (r) {
            if (!r.ok) throw new Error('Approval could not be checked. Reconnect and try again.');
            return r.json();
        });
    }
    function promptApproval(canApprove, items, submit) {
        return new Promise(function (resolve, reject) {
            if (document.getElementById('pos-free-approval')) { reject(new Error('Finish the open approval first.')); return; }
            var previous = document.activeElement, ov = document.createElement('div');
            ov.id = 'pos-free-approval';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-labelledby','pos-free-title');
            ov.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:#17132d99;display:flex;align-items:center;justify-content:center;padding:16px';
            ov.innerHTML = '<form style="background:#fff;color:#172033;border:1px solid #e4ddf4;border-radius:16px;padding:24px;width:440px;max-width:100%;max-height:90vh;overflow:auto;box-shadow:0 16px 50px #17132d44">'
                + '<h2 id="pos-free-title" style="font-size:20px;margin:0 0 12px">Approve free items</h2>'
                + '<p style="font-size:14px">Review these free items. Changes require approval again.</p><ul data-free-items style="font-size:14px;padding-left:20px;max-height:150px;overflow:auto"></ul>'
                + '<label style="display:block">Reason<textarea name="freeReason" required maxlength="500" rows="3" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:10px;border:1px solid #c9bfdc;border-radius:8px;color:#172033;background:#fff"></textarea></label>'
                + (canApprove ? '<p>Your signed-in manager account will be recorded.</p>' : '<label style="display:block">Shop manager PIN<input name="freePin" type="password" inputmode="numeric" autocomplete="off" required maxlength="6" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:10px;border:1px solid #c9bfdc;border-radius:8px;color:#172033;background:#fff"></label>')
                + '<p role="alert" style="color:#b91c1c;font-size:14px"></p><div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" data-cancel style="padding:10px 16px;border:1px solid #d4cce5;border-radius:8px;background:#fff;color:#172033">Cancel</button><button type="submit" style="padding:10px 16px;border:0;border-radius:8px;background:#7c3aed;color:#fff">Approve &amp; continue</button></div></form>';
            document.body.appendChild(ov);var form=ov.querySelector('form'),button=form.querySelector('[type=submit]'),pending=false;
            (items || []).forEach(function(item){var row=document.createElement('li');row.textContent=(item.name || item.product)+' × '+item.quantity;form.querySelector('[data-free-items]').appendChild(row);});
            function close() { form.reset();ov.remove();if(previous && previous.isConnected) previous.focus(); }
            function cancel() { if(pending)return;close();reject(new Error('Free-item approval cancelled. The bill was not submitted.')); }
            ov.querySelector('[data-cancel]').onclick=cancel;
            ov.addEventListener('keydown',function(e){
                if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}
                if(e.key==='Tab'){var nodes=Array.from(form.querySelectorAll('textarea,input,button')).filter(function(n){return !n.disabled;});if(e.shiftKey && document.activeElement===nodes[0]){e.preventDefault();nodes[nodes.length-1].focus();}else if(!e.shiftKey && document.activeElement===nodes[nodes.length-1]){e.preventDefault();nodes[0].focus();}}
            });
            form.onsubmit=function(e){e.preventDefault();e.stopPropagation();if(pending)return;
                var reason=form.elements.freeReason.value.trim();if(!reason){form.elements.freeReason.focus();return;}
                pending=true;button.disabled=true;
                Promise.resolve().then(function(){return submit({reason:reason,managerPin:form.elements.freePin ? form.elements.freePin.value : ''});})
                    .then(function(value){close();resolve(value);}).catch(function(error){pending=false;button.disabled=false;form.querySelector('[role=alert]').textContent=error.message;});
            };
            form.elements.freeReason.focus();
        });
    }
    function ensure(transactionId, token) {
        return api('freeItemState',{transactionId:transactionId},token).then(function(state){
            if(!state.success)throw new Error(state.error || 'Approval could not be checked.');
            if(!state.required)return;
            return promptApproval(state.canApprove,state.freeItems,function(values){
                return api('approveFreeItems',Object.assign({transactionId:transactionId,expectedFingerprint:state.approvalFingerprint},values),token).then(function(result){
                    if(!result.success)throw new Error(result.error || 'Approval failed.');
                });
            });
        });
    }
    function amendmentFetch(url, options, params, token) {
        return fetch(url,options).then(function(response){
            return response.clone().json().then(function(data){
                if(!data.needFreeApproval)return response;
                return api('freeItemState',{transactionId:params.editTxId},token).then(function(state){
                    if(!state.success)throw new Error(state.error || 'Approval could not be checked.');
                    return promptApproval(state.canApprove,data.freeItems,function(values){
                        var revised=Object.assign({},params,{freeItemReason:values.reason,freeItemManagerPin:values.managerPin,freeItemFingerprint:data.approvalFingerprint});
                        return fetch(url,Object.assign({},options,{body:new URLSearchParams(revised)})).then(function(retry){
                            return retry.clone().json().then(function(result){if(!result.success)throw new Error(result.error || 'The edit was not saved.');return retry;});
                        });
                    });
                });
            });
        });
    }
    return {ensure:ensure,amendmentFetch:amendmentFetch};
})();

// Receipt values are plain text. Clone/escape at the HTML boundary, preserving numbers.
window._posReceiptTextData=function receiptText(value){
    if(typeof value==='string')return value.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
    if(Array.isArray(value))return value.map(receiptText);
    if(value&&typeof value==='object'){var result={};Object.keys(value).forEach(function(k){result[k]=receiptText(value[k]);});return result;}
    return value;
};
// Signals to Terminal.xml's legacy inline cart engine (the 7171 IIFE) that the
// optimistic engine in THIS file is present, so it stands down — otherwise on /apps
// both bind a grid-submit handler and every product tap fires TWO addItem POSTs,
// making the cart flicker through optimistic + two server settles ("three states").
window.__posTermJsActive = true;
console.log('[posterm] script loaded v120 — posOpenHistory defined:', (typeof window.posOpenHistory));
/* POS Terminal - external JS for SPA (qapps) - Full AJAX */

/* === Close the SPA left nav drawer when on the POS terminal ===
   On narrow/tablet screens the Quasar nav drawer opens as an overlay and
   covers the POS header (HISTORY, fullscreen, CLOSE), making those buttons
   un-clickable. Collapse it whenever the terminal is present. */
(function closeNavDrawer() {
    // NOTE: offsetParent is always null for position:fixed elements, so it can't
    // be used to test visibility here. Use computed display/visibility/opacity.
    function isShown(el) {
        if (!el) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01;
    }
    function tryClose() {
        if (!document.getElementById('pos-history-btn') && !document.getElementById('pos-history-btn-ns')) return;
        // Quasar overlay/mobile drawer puts a backdrop over the page; clicking it closes the drawer
        var bd = document.querySelector('.q-drawer__backdrop');
        if (bd && isShown(bd)) bd.click();
    }
    // Run a few times while the SPA finishes its initial render/animation
    var n = 0;
    var iv = setInterval(function() { tryClose(); if (++n >= 15) clearInterval(iv); }, 400);
})();

/* === Cross-browser POS optimizations (Safari + Chrome) ===
   - touch-action:manipulation kills the iOS 300ms tap delay + double-tap zoom (snappy billing)
   - -webkit-overflow-scrolling adds momentum scroll on the grid/cart
   - iOS-only (@supports -webkit-touch-callout) bumps inputs to 16px so focusing them
     doesn't auto-zoom the page; desktop Chrome/Safari are unaffected. === */
(function posXBrowser() {
    if (document.getElementById('pos-xbrowser-css')) return;
    var css = ''
        + '.pos-product-grid button,.pos-cat-strip a,.pos-summary button,.pos-summary a,.pos-header button,'
        + '.pos-header a,.pos-cart button,.pos-cart select,.pos-pay-form button,button.aj-q,.aj-pb,.aj-rm,'
        + '.credit-settle-btn,.pos-cash-confirm,.pos-cash-btn,.pos-split-btn,.sm-opt{touch-action:manipulation;}'
        + 'button,a,select,input{-webkit-tap-highlight-color:rgba(0,0,0,0.12);}'
        + '.pos-product-grid,.pos-cart,.pos-cart tbody,.pos-cat-strip,.pos-summary{-webkit-overflow-scrolling:touch;}'
        + 'select.aj-mode{-webkit-appearance:menulist;-moz-appearance:menulist;appearance:menulist;}'
        + '@supports (-webkit-touch-callout:none){'
        +   '.pos-cart input,.pos-cart select,.pos-search-bar input,.pos-cash-input,#cartInlineSearch,'
        +   '.aj-p,.aj-qi,.aj-mode,#credit-name,#credit-phone,#settle-amt,#close-cash-input{font-size:16px !important;}'
        + '}';
    var st = document.createElement('style');
    st.id = 'pos-xbrowser-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
})();

/* === Numeric-only rate (price) inputs ===
   The cart rate field is type="text" (so it can hold decimals like 12.50 and
   not fire the browser's number-spinner), which also lets a user type letters.
   Strip anything that isn't a digit or a single decimal point, in the capture
   phase so it runs before the optimistic price handler. Delegated on document
   so it covers BOTH render paths — the optimistic JS row (.aj-p) and the server
   FreeMarker row (input[name=newPrice]) — and survives every cart re-render. */
(function posNumericRate() {
    function sanitize(v) {
        v = v.replace(/[^0-9.]/g, '');           // drop letters & symbols
        var i = v.indexOf('.');
        if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); // keep only the first dot
        return v;
    }
    document.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'INPUT') return;
        if (!((t.classList && t.classList.contains('aj-p')) || t.name === 'newPrice')) return;
        var clean = sanitize(t.value);
        if (clean !== t.value) t.value = clean; // only reassign on a real change → preserves caret while typing valid input
    }, true);
})();

/* === Browser Back exits the POS to the Quasar app dashboard ===
   The terminal runs on /apps (after a /qapps->/apps redirect), so the native Back
   button retraces the /apps app-chooser ("Choose an Application") + back-office
   dashboard the cashier passed through — confusing. Trap Back: push a sentinel
   history entry on load, and on popstate send the browser to /qapps/zenith (the
   Quasar dashboard) instead. One Back press cleanly exits the POS. /apps-only
   (this script only loads on the terminal). */
(function posBackToQapps() {
    try {
        if (window.__posBackTrap) return;
        window.__posBackTrap = true;
        history.pushState({ posTrap: 1 }, '', location.href);
        window.addEventListener('popstate', function () { location.replace('/qapps/zenith'); });
    } catch (e) { }
})();

/* === Held-bills dropdown escapes the one-row header's horizontal scroll ===
   The header is a single non-wrapping row with overflow-x:auto so it scrolls on
   narrow screens. Per CSS spec, overflow-x:auto forces overflow-y to auto too, so
   the header CLIPS the held-bills <details> panel that opens below it (the picker
   appeared empty/cut off). A plain overflow ancestor does NOT clip a position:fixed
   descendant — so when the held <details> opens, pin its panel as fixed at the
   summary's location; restore on close. /apps-only (scripts are stripped on /qapps,
   but the terminal always runs on /apps). */
(function heldDropdownFix() {
    document.addEventListener('toggle', function (e) {
        var d = e.target;
        if (!d || !d.tagName || d.tagName.toLowerCase() !== 'details') return;
        if (!(d.closest && d.closest('#pos-held-wrap'))) return;
        var panel = null, k = d.children;
        for (var i = 0; i < k.length; i++) { if (k[i].tagName && k[i].tagName.toLowerCase() === 'div') { panel = k[i]; break; } }
        if (!panel) return;
        if (d.open) {
            var sm = d.querySelector('summary');
            var r = sm.getBoundingClientRect();
            panel.style.position = 'fixed';
            panel.style.top = (r.bottom + 4) + 'px';
            panel.style.left = r.left + 'px';
            panel.style.zIndex = '3000';
        } else {
            panel.style.position = ''; panel.style.top = ''; panel.style.left = ''; panel.style.zIndex = '';
        }
    }, true);
})();

/* === Offline Mode: IndexedDB catalog cache + offline cart + sale capture + sync ===
   Self-contained: takes over the cart UI only while navigator is offline; the online
   flow is untouched. _posAjax/_posScan delegate here when offline. === */
window._posOffline = (function() {
    var afScope=document.getElementById('cartInlineAddForm');
    var orgScope=afScope && afScope.querySelector('[name=posOrganizationPartyId]');
    var orgFallback=document.getElementById('pos-offline-org');
    var orgId=orgScope ? orgScope.value : (orgFallback ? orgFallback.value : '');
    // New queues are per organization; verified legacy sales are copied without changing amounts.
    var DBN = 'ZenithPosOffline-'+encodeURIComponent(orgId), DBV = 1, db = null;
    var catalog = {};   // productId -> {productId,name,price,uom,taxCode,barcode}
    var cart = [];
    var booted = false;
    var syncing = false;
    var payPending = false;
    var serverDraftPaused = false;
    function active(){ return !navigator.onLine; }
    function esc(x){ return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
    function f2(x){ return Number(x||0).toFixed(2); }
    function tCtx(){ var af=document.getElementById('cartInlineAddForm'); function v(n){ var el=af&&af.querySelector?af.querySelector('[name='+n+']'):null; return el?el.value:''; } var tEl=document.querySelector('input[name=posTerminalId]'); return { sessionId:v('sessionId'), terminalId: tEl?tEl.value:'' }; }
    function openDB(){ if(!orgId) return Promise.reject(new Error('No active POS organization')); return new Promise(function(res,rej){ var rq=indexedDB.open(DBN,DBV); rq.onupgradeneeded=function(e){ var d=e.target.result; if(!d.objectStoreNames.contains('catalog'))d.createObjectStore('catalog',{keyPath:'productId'}); if(!d.objectStoreNames.contains('queue'))d.createObjectStore('queue',{keyPath:'offlineId'}); }; rq.onsuccess=function(e){db=e.target.result;res(db);}; rq.onerror=function(e){rej(e);}; }); }
    // Copy only sales whose original terminal/session ownership the server verifies.
    // Original values remain in the legacy DB until that exact sale is acknowledged.
    var legacyDb = null, legacyCopied = Object.create(null), recoveryInFlight = null;
    function legacyNotice(show) {
        var notice = document.getElementById('pos-legacy-offline-notice');
        if (!notice && show) {
            notice = document.createElement('div'); notice.id = 'pos-legacy-offline-notice';
            notice.setAttribute('role','status');
            notice.style.cssText = 'padding:10px;margin:8px;border:1px solid #b7791f;background:#fffbeb;color:#744210';
            notice.textContent = 'Older offline sales remain on this device. Verified sales are available in this organization\'s pending queue. Keep this device available for the owner to reconcile any unresolved sales; do not clear browser storage.';
            var parent = document.querySelector('.pos-cart') || document.body;
            parent.parentNode.insertBefore(notice,parent);
        }
        if (notice) notice.hidden = !show;
    }
    function readLegacy() {
        return new Promise(function(resolve,reject) {
            if (legacyDb) { read(); return; }
            var request = indexedDB.open('ZenithPosOffline');
            // Abort creation if this till never had a legacy database.
            request.onupgradeneeded = function() { request.transaction.abort(); };
            request.onerror = function() {
                if (request.error && request.error.name === 'AbortError') resolve([]);
                else reject(new Error('Legacy offline storage could not be read'));
            };
            request.onblocked = function() { reject(new Error('Legacy offline storage is busy')); };
            request.onsuccess = function() { legacyDb = request.result; read(); };
            function read() {
                if (!legacyDb.objectStoreNames.contains('queue')) { resolve([]); return; }
                var transaction = legacyDb.transaction('queue','readonly');
                var rows = transaction.objectStore('queue').getAll();
                rows.onsuccess = function() { resolve(rows.result || []); };
                rows.onerror = function() { reject(new Error('Legacy offline queue could not be read')); };
            }
        });
    }
    function copyVerifiedLegacy(sales) {
        return ensureDb().then(function(database) {
            if (!database) throw new Error('Offline storage unavailable');
            return new Promise(function(resolve,reject) {
                var copied = [], transaction = database.transaction('queue','readwrite');
                var store = transaction.objectStore('queue');
                sales.forEach(function(sale) {
                    var row = Object.assign({},sale,{organizationPartyId:orgId});
                    var existing = store.get(row.offlineId);
                    existing.onsuccess = function() {
                        // Never overwrite a newer or different sale that happens to reuse the id.
                        if (!existing.result) { store.add(row); copied.push({id:row.offlineId,source:JSON.stringify(sale),payload:JSON.stringify(row)}); }
                        else if (JSON.stringify(existing.result) === JSON.stringify(row)) copied.push({id:row.offlineId,source:JSON.stringify(sale),payload:JSON.stringify(row)});
                    };
                });
                transaction.oncomplete = function() { copied.forEach(function(copy) { legacyCopied[copy.id] = copy; }); resolve(copied.length); };
                transaction.onerror = transaction.onabort = function() { reject(new Error('Legacy sales were not copied')); };
            });
        });
    }
    function recoverLegacy() {
        if (recoveryInFlight) return recoveryInFlight;
        recoveryInFlight = readLegacy().then(function(sales) {
            legacyNotice(sales.length > 0);
            if (!sales.length || !navigator.onLine || !orgId) return 0;
            var token = document.querySelector('[name=moquiSessionToken]');
            if (!token || !token.value) return 0;
            var eligible = Object.create(null), batches = [], candidates = sales.filter(function(sale) {
                return sale && sale.offlineId && sale.sessionId && sale.terminalId && (!sale.organizationPartyId || sale.organizationPartyId === orgId);
            });
            for (var i=0;i<candidates.length;i+=200) batches.push(candidates.slice(i,i+200));
            return batches.reduce(function(previous,batch) {
                return previous.then(function() {
                    return fetch('Terminal/resolveLegacyOfflineScope',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({
                        moquiSessionToken:token.value,organizationPartyId:orgId,
                        candidates:JSON.stringify(batch.map(function(sale) { return {offlineId:sale.offlineId,organizationPartyId:sale.organizationPartyId,sessionId:sale.sessionId,terminalId:sale.terminalId}; }))
                    })}).then(function(response) { if (!response.ok) throw new Error('Legacy ownership could not be verified'); return response.json(); })
                    .then(function(result) {
                        if (result.organizationPartyId !== orgId || !Array.isArray(result.eligibleIds)) throw new Error('Organization changed during recovery');
                        result.eligibleIds.forEach(function(id) { if (batch.some(function(sale) { return sale.offlineId === id; })) eligible[id] = true; });
                    });
                });
            },Promise.resolve()).then(function() { return copyVerifiedLegacy(candidates.filter(function(sale) { return eligible[sale.offlineId]; })); });
        }).catch(function() { legacyNotice(true); return 0; });
        return recoveryInFlight.then(function(count) { recoveryInFlight = null; return count; },function(error) { recoveryInFlight = null; throw error; });
    }
    function acknowledgeLegacy(ids,sent) {
        var acknowledged = ids.filter(function(id) {
            return legacyCopied[id] && sent.some(function(sale) { return sale.offlineId === id && JSON.stringify(sale) === legacyCopied[id].payload; });
        });
        if (!legacyDb || !acknowledged.length) return Promise.resolve();
        return new Promise(function(resolve,reject) {
            var transaction = legacyDb.transaction('queue','readwrite'), store = transaction.objectStore('queue');
            acknowledged.forEach(function(id) {
                var current = store.get(id);
                current.onsuccess = function() { if (current.result && JSON.stringify(current.result) === legacyCopied[id].source) store.delete(id); };
            });
            transaction.oncomplete = function() { acknowledged.forEach(function(id) { delete legacyCopied[id]; }); readLegacy().then(function(rows) { legacyNotice(rows.length > 0); }).catch(function() { legacyNotice(true,'Legacy offline storage could not be checked. Keep this device and retry.'); }); resolve(); };
            transaction.onerror = transaction.onabort = function() { reject(new Error('Acknowledged legacy rows remain on the device')); };
        });
    }

    function putCatalog(items){ return new Promise(function(res){ if(!db){res(0);return;} var tx=db.transaction(['catalog'],'readwrite'); var s=tx.objectStore('catalog'); s.clear(); catalog={}; items.forEach(function(p){ s.put(p); catalog[p.productId]=p; }); tx.oncomplete=function(){res(items.length);}; tx.onerror=function(){res(0);}; }); }
    function loadCatalog(){ return new Promise(function(res){ if(!db){res();return;} var tx=db.transaction(['catalog'],'readonly'); var rq=tx.objectStore('catalog').getAll(); rq.onsuccess=function(){ catalog={}; (rq.result||[]).forEach(function(p){catalog[p.productId]=p;}); res(); }; rq.onerror=function(){res();}; }); }
    function cacheCatalog(){ return fetch('Terminal/exportPosCatalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({terminalId:tCtx().terminalId}),credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){ var prods=(d.products||[]).map(function(p){ return {productId:p.productId, name:p.productName||p.productId, price:Number(p.listPrice||0), uom:p.uom||'', taxCode:p.taxCode||'', taxRate:p.taxRate, barcode:p.barcode||''}; }); return putCatalog(prods); }).catch(function(){ return 0; }); }
    // PS-111 (ZE-POS-017): the queue ops can be called BEFORE boot() opened the DB — e.g. opening Bill History
    // right after an offline page load/redirect, within boot's 1.5s delay. Previously getQueue() returned [] when
    // db was null, so the offline-history fallback saw an empty queue and showed "Couldn't load bill history" even
    // though the offline bills were persisted in IndexedDB. ensureDb lazily opens the DB so the persisted queue is
    // ALWAYS readable/writable regardless of boot timing.
    function ensureDb(){ return db ? Promise.resolve(db) : openDB().catch(function(){ return null; }); }
    function enqueue(sale){ return ensureDb().then(function(d){ if(!d) throw new Error('Offline storage unavailable'); return new Promise(function(res,rej){ var tx=d.transaction(['queue'],'readwrite'); tx.objectStore('queue').put(sale); tx.oncomplete=function(){res();}; tx.onerror=function(){rej(new Error('Offline sale could not be saved'));}; }); }); }
    function getQueue(){ return ensureDb().then(function(d){ if(!d) return []; return new Promise(function(res){ var tx=d.transaction(['queue'],'readonly'); var rq=tx.objectStore('queue').getAll(); rq.onsuccess=function(){res(rq.result||[]);}; rq.onerror=function(){res([]);}; }); }); }
    function clearQueue(){ return ensureDb().then(function(d){ if(!d) return; return new Promise(function(res){ var tx=d.transaction(['queue'],'readwrite'); tx.objectStore('queue').clear(); tx.oncomplete=function(){res();}; tx.onerror=function(){res();}; }); }); }
    function toast(msg,bg){ var t=document.createElement('div'); t.textContent=msg; t.style.cssText='position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:9999999;background:'+(bg||'#2e7d32')+';color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,0.3);max-width:90vw;text-align:center'; document.body.appendChild(t); setTimeout(function(){t.remove();},3000); }
    function hasServerDraft(){
        var tx=document.querySelector('#cartInlineAddForm [name=transactionId]');
        return !!((tx&&tx.value)||document.querySelector('.pos-cart .aj-qi'));
    }
    function paused(){ return serverDraftPaused; }
    function banner(show){
        var b=document.getElementById('pos-offline-banner');
        if(!b){
            b=document.createElement('div'); b.id='pos-offline-banner'; b.setAttribute('role','status');
            b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999991;background:#c62828;color:#fff;text-align:center;padding:7px 12px;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
            document.body.appendChild(b);
        }
        b.style.display=show?'block':'none';
        if(!show) return;
        function message(count){
            return (serverDraftPaused?'OFFLINE — current bill is paused. Reconnect to verify items and total before payment.':'OFFLINE — new sales can be saved on this device.')
                +(count?' '+count+' sale(s) queued for sync.':'');
        }
        b.textContent=message(0);
        getQueue().then(function(q){ if(!navigator.onLine && b.style.display!=='none') b.textContent=message(q.length); });
    }
    function pauseServerDraft(){
        if(!serverDraftPaused && hasServerDraft()) serverDraftPaused=true;
        if(serverDraftPaused) banner(true);
        return serverDraftPaused;
    }
    function taxEnabled(){return typeof window._posCurrentTax==='function' ? window._posCurrentTax()!=='N' : true;}
    function taxAmount(it){return taxEnabled() ? Math.round(Number(it.qty)*Number(it.price)*Number(it.taxRate||0))/100 : 0;}
    function payable(){return Math.round(cart.reduce(function(a,it){return a+Number(it.qty)*Number(it.price)+taxAmount(it);},0));}
    function render(){
        if(serverDraftPaused) return;
        var tb=document.querySelector('.pos-cart tbody');
        if(tb){ var h=''; if(!cart.length) h='<tr><td colspan="8" style="text-align:center;padding:40px;color:#aaa;font-size:16px">Offline &mdash; tap products to add items</td></tr>';
            cart.forEach(function(it,i){ h+='<tr style="border-bottom:1px solid #e0e0e0">'
                +'<td style="padding:8px 10px;text-align:center;font-weight:700;color:#777;width:30px">'+(i+1)+'</td>'
                +'<td style="padding:8px 10px"><div style="font-size:14px;font-weight:600;color:#000">'+esc(it.name)+'</div><div style="font-size:11px;color:#555">'+esc(it.productId)+'</div></td>'
                +'<td style="padding:8px;color:#7780a3">Cached</td>'
                +'<td style="padding:8px 10px;text-align:right;color:#000">'+f2(it.price)+'</td>'
                +'<td style="padding:4px;text-align:center"><div style="display:flex;align-items:center;justify-content:center">'
                +'<button data-i="'+i+'" class="ofl-minus" style="width:32px;height:38px;border:2px solid #e53935;background:#fff;font-size:20px;font-weight:bold;cursor:pointer;border-radius:8px 0 0 8px;color:#e53935">-</button>'
                +'<input data-i="'+i+'" class="ofl-qi" type="number" step="any" value="'+Number(it.qty)+'" style="width:52px;height:38px;text-align:center;font-weight:bold;font-size:15px;border-top:2px solid #ccc;border-bottom:2px solid #ccc;border-left:none;border-right:none;box-sizing:border-box;outline:none"/>'
                +'<button data-i="'+i+'" class="ofl-plus" style="width:32px;height:38px;border:2px solid #2e7d32;background:#fff;font-size:20px;font-weight:bold;cursor:pointer;border-radius:0 8px 8px 0;color:#2e7d32">+</button>'
                +'</div>'+(it.uom?'<div style="font-size:11px;color:#e65100;font-weight:700;text-align:center;margin-top:2px">'+esc(it.uom)+'</div>':'')+'</td>'
                +'<td>'+f2(taxAmount(it))+'</td>'
                +'<td style="padding:8px 10px;text-align:right;font-weight:700;color:#000">'+f2(it.qty*it.price+taxAmount(it))+'</td>'
                +'<td style="padding:4px;text-align:center"><button data-i="'+i+'" class="ofl-rm" style="width:30px;height:30px;border:none;background:#e53935;color:#fff;border-radius:6px;cursor:pointer">&#10005;</button></td></tr>'; });
            tb.innerHTML=h; }
        var sm=document.querySelector('.pos-summary');
        if(sm){ var total=payable(); var qty=cart.reduce(function(a,it){return a+Number(it.qty);},0);
            var s='<div class="pos-sum-strip" style="display:flex;justify-content:space-between;font-size:13px;color:#777;margin-bottom:6px"><span style="color:#c62828;font-weight:700">OFFLINE</span><span>Qty: <b>'+qty+'</b></span></div>'
                +'<div class="pos-sum-total" style="background:#c62828;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:16px;font-weight:600">Offline TOTAL</span><span style="font-size:28px;font-weight:800">&#8377;'+f2(total)+'</span></div>';
            if(cart.length){ s+='<div class="pos-paywrap pos-reference-payments pos-offline-payments" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'
                +'<button type="button" class="ofl-pay" id="pos-pay-cash" data-m="Cash" style="padding:clamp(8px,1.4vh,15px) 8px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#4caf50;color:#fff">&#128176; CASH<kbd>F2</kbd></button>'
                +'<button type="button" class="ofl-pay" id="pos-pay-card" data-m="Card" style="padding:clamp(8px,1.4vh,15px) 8px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#2196f3;color:#fff">&#128179; CARD<kbd>F3</kbd></button>'
                +'<button type="button" class="ofl-pay" id="pos-pay-upi" data-m="UPI" style="padding:clamp(8px,1.4vh,15px) 8px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#9c27b0;color:#fff">&#128241; UPI<kbd>F5</kbd></button></div>';
            } else { s+='<div class="pos-paywrap pos-reference-payments" style="justify-content:center;text-align:center;padding:16px;color:#aaa">Offline &mdash; tap products to add items</div>'; }
            sm.innerHTML=s; }
    }
    function add(pid, price){ if(serverDraftPaused){toast('Reconnect to verify the current bill before adding items.','#c62828');return;} var p=catalog[pid]||{}; var pr=Number(price||p.price||0); var ex=cart.find(function(it){return it.productId===pid && Number(it.price)===pr;}); if(ex) ex.qty=Number(ex.qty)+1; else cart.push({productId:pid,name:p.name||pid,price:pr,qty:1,uom:p.uom||'',taxRate:p.taxRate}); render(); }
    function scan(code){ var lc=(code||'').toLowerCase(); var found=null; for(var k in catalog){ var p=catalog[k]; if(p.barcode===code||p.productId===code||(p.name||'').toLowerCase().indexOf(lc)!==-1){found=p;break;} } if(found) add(found.productId,found.price); else toast('Item not in offline catalog','#e53935'); }
    function printReceipt(sale){ var h='<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}body{margin:0;padding:0;font-family:Arial;font-size:12px}.rcpt{width:72mm;margin:0 auto;padding:2mm 3mm;box-sizing:border-box}.c{text-align:center}.r{text-align:right}.b{font-weight:bold}table{width:100%;border-collapse:collapse}td,th{font-size:11px;padding:2px 1px}.sep{border-bottom:1px dashed #000;margin:4px 0}</style></head><body><div class="rcpt">';
        h+='<div class="c b" style="font-size:15px">Offline Receipt</div><div class="c" style="font-size:9px;color:#444">** SAVED OFFLINE &mdash; will sync **</div><div class="sep"></div>';
        h+='<div style="font-size:10px">'+new Date().toLocaleString()+'</div><div class="sep"></div>';
        h+='<table><thead><tr><th style="text-align:left">Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Total</th></tr></thead><tbody>';
        sale.items.forEach(function(it){ h+='<tr><td>'+esc(it.name)+'</td><td class="c">'+it.qty+(it.uom?' '+it.uom:'')+'</td><td class="r">'+f2(it.price)+'</td><td class="r">'+f2(it.qty*it.price)+'</td></tr>'; });
        h+='</tbody></table><div class="sep"></div><div>Tax '+f2(sale.taxAmount||0)+' &middot; Round off '+f2(sale.roundOff||0)+'</div>';
        h+='<table><tr><td class="b" style="font-size:14px">TOTAL</td><td class="r b" style="font-size:14px">&#8377;'+f2(sale.total)+'</td></tr><tr><td>Paid</td><td class="r">'+esc(sale.paymentMethod)+'</td></tr></table>';
        h+='<div class="c b" style="margin-top:6px">Thank You !!</div><div class="c" style="font-size:7px;color:#666;margin-top:4px">Powered by ZetaERP &middot; www.zetaclantech.com</div></div>';
        h+='<script>window.onload=function(){window.print();}<\/script></body></html>';
        var f=document.getElementById('pos-offline-frame'); if(!f){ f=document.createElement('iframe'); f.id='pos-offline-frame'; f.style.cssText='position:fixed;left:-9999px;top:-9999px;width:80mm;height:0;border:none'; document.body.appendChild(f); } var d=f.contentDocument||f.contentWindow.document; d.open(); d.write(h); d.close(); }
    function pay(method){ if(payPending||serverDraftPaused||!cart.length) return; var _fia=document.getElementById('pos-free-item-approval'); if(_fia&&_fia.value==='Y'&&cart.some(function(it){return Number(it.price)<=0;})){toast('Free items need online manager approval. Reconnect to complete this bill.','#c62828');return;} if(taxEnabled() && cart.some(function(it){return it.taxRate==null;})){toast('Tax cache unavailable. Reconnect before completing this sale.','#c62828');return;} var c=tCtx(); var total=payable();
        var sale={ offlineId:'OFL-'+Date.now()+'-'+Math.floor(Math.random()*100000), organizationPartyId:orgId, taxOn:taxEnabled()?'Y':'N', terminalId:c.terminalId, sessionId:c.sessionId, items:cart.map(function(it){return {productId:it.productId,name:it.name,qty:it.qty,price:it.price,uom:it.uom};}), total:total, taxAmount:cart.reduce(function(a,it){return a+taxAmount(it);},0), roundOff:total-cart.reduce(function(a,it){return a+it.qty*it.price+taxAmount(it);},0), paymentMethod:method, ts:new Date().toISOString() };
        payPending=true;
        enqueue(sale).then(function(){
            cart=[];
            try{ render(); banner(true); }
            catch(e){ toast('Sale saved offline. Reload to verify the empty cart.','#c62828'); return; }
            toast('✔ Sale saved offline ('+method+') — will sync when online','#2e7d32');
            try{ printReceipt(sale); }
            catch(e){ toast('Sale saved offline, but receipt could not print. Reprint from history.','#c62828'); }
        },function(){ toast('Sale NOT saved. Keep this cart and retry.','#c62828'); }).finally(function(){payPending=false;}); }
    function removeSynced(ids){ return ensureDb().then(function(d){ if(!d) return; return new Promise(function(res,rej){ var tx=d.transaction(['queue'],'readwrite'); ids.forEach(function(id){tx.objectStore('queue').delete(id);}); tx.oncomplete=function(){res();};tx.onerror=function(){rej(new Error('Queue update failed'));}; }); }); }
    function sync(){ if(syncing) return Promise.resolve(0); syncing=true; return recoverLegacy().then(function(){ return getQueue(); }).then(function(q){ if(!q.length) return 0; var c=tCtx(), af=document.getElementById('cartInlineAddForm'), tk=af&&af.querySelector('[name=moquiSessionToken]'); var body=JSON.stringify({moquiSessionToken:tk?tk.value:'', terminalId:c.terminalId, transactions:q.map(function(s){return JSON.stringify(s);})}); return fetch('Terminal/syncOfflineTransactions',{method:'POST',headers:{'Content-Type':'application/json'},body:body,credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('Sync rejected');return r.json();}).then(function(d){ var ack=Array.isArray(d.syncedIds)?d.syncedIds.filter(function(id){return q.some(function(s){return s.offlineId===id;});}):[]; return removeSynced(ack).then(function(){ return acknowledgeLegacy(ack,q); }).then(function(){ if(q.length>ack.length)toast('Some offline sales remain pending. Review and retry.','#c62828'); return ack.length; }); }); }).catch(function(){return 0;}).then(function(n){syncing=false;return n;}); }
    // Instant local-first reads against the cached master data (no server round-trip)
    function search(term){ var lc=(term||'').toLowerCase().trim(); if(!lc) return []; var out=[]; for(var k in catalog){ var p=catalog[k]; if((p.name||'').toLowerCase().indexOf(lc)!==-1 || (p.barcode||'').toLowerCase().indexOf(lc)===0 || (p.productId||'').toLowerCase()===lc){ out.push(p); if(out.length>=30) break; } } return out; }
    function lookup(pid){ return catalog[pid] || null; }
    function catalogSize(){ var n=0; for(var k in catalog) n++; return n; }
    function boot(){ if(booted || !orgId || location.pathname.indexOf('/pos/Terminal')<0) return; booted=true;
        openDB().then(function(){ return recoverLegacy(); }).then(function(){ return loadCatalog(); }).then(function(){
            if(navigator.onLine){ cacheCatalog(); banner(false); }
            else if(!pauseServerDraft()){ banner(true); render(); }
        }).catch(function(){toast('Offline storage unavailable. Use online checkout.','#c62828');});
        window.addEventListener('offline', function(){ if(!pauseServerDraft()){ banner(true); render(); } });
        window.addEventListener('online', function(){ if(serverDraftPaused){ var b=document.getElementById('pos-offline-banner'); if(b) b.textContent='Reconnecting — verifying the current bill before payment.'; } else banner(false); sync().then(function(nn){ if(nn>0) toast('✔ '+nn+' offline sale(s) synced','#2e7d32'); setTimeout(function(){ try{location.reload();}catch(e){} }, nn>0?1600:300); }); });
        // A visible server draft may contain an in-flight edit. Keep it read-only until
        // the server is reachable again; never turn it into a second offline sale.
        ['click','submit','beforeinput','change'].forEach(function(type){ document.addEventListener(type,function(e){ if(!serverDraftPaused)return; var t=e.target; if(t.closest && t.closest('#pos-terminal-root,.pos-product-grid,.pos-cart,.pos-summary,#cartInlineAddForm')){e.preventDefault();e.stopImmediatePropagation();} },true); });
        document.addEventListener('keydown',function(e){ if(serverDraftPaused && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key==='Enter'||e.key==='/'||/^F[2-9]$/.test(e.key))){e.preventDefault();e.stopImmediatePropagation();} },true);
        // Stale-while-revalidate: refresh the local master-data cache in the background so local reads stay current
        setInterval(function(){ if(navigator.onLine) cacheCatalog(); }, 180000);
        document.addEventListener('click', function(e){ var t=e.target.closest ? (e.target.closest('.ofl-minus,.ofl-plus,.ofl-rm,.ofl-pay') || e.target) : e.target; if(!t.classList) return;
            if(t.classList.contains('ofl-minus')){ var i=+t.dataset.i; cart[i].qty=Number(cart[i].qty)-1; if(cart[i].qty<=0)cart.splice(i,1); render(); }
            else if(t.classList.contains('ofl-plus')){ var i2=+t.dataset.i; cart[i2].qty=Number(cart[i2].qty)+1; render(); }
            else if(t.classList.contains('ofl-rm')){ cart.splice(+t.dataset.i,1); render(); }
            else if(t.classList.contains('ofl-pay')){ pay(t.dataset.m); } });
        document.addEventListener('change', function(e){ if(e.target.classList&&e.target.classList.contains('ofl-qi')){ var i=+e.target.dataset.i; var nq=Number(e.target.value); if(!Number.isFinite(nq)||nq<=0){toast('Quantity must be greater than zero. Use remove to delete a line.','#c62828');} else cart[i].qty=nq; render(); } });
    }
    setTimeout(boot, 1500);
    return { boot:boot, active:active, paused:paused, add:add, scan:scan, sync:sync, clearDraft:function(){cart=[];render();}, render:render, cacheCatalog:cacheCatalog, search:search, lookup:lookup, catalogSize:catalogSize, getQueue:getQueue, recoverLegacy:recoverLegacy };
})();

/* === Product Import screen: manual add + search auto-fill + CSV (external JS, so the
   qvt template compiler never parses HTML-in-script). Auto-wires when #pi-form is present. === */
(function() {
    function piEsc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

    function piTok(){ try{ if(window.moqui&&window.moqui.webrootVue&&window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; }catch(e){} return ''; }
    function piPost(url, params){ var p=new URLSearchParams(); for(var k in params){ p.append(k, params[k]==null?'':params[k]); } p.append('moquiSessionToken', piTok()); return fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p,credentials:'same-origin'}).then(function(r){return r.json();}); }
    function g(id){ return document.getElementById(id); }
    var FIELDS = ['pi-sku','pi-name','pi-description','pi-listPrice','pi-mrp','pi-productTaxCode','pi-reorderPoint','pi-reorderQuantity','pi-expiryDate','pi-unit'];
    function wire(){
        var form = g('pi-form');
        if(!form || form.dataset.piBound) return;
        form.dataset.piBound='1';
        var s=g('pi-search'), results=g('pi-results'), modeEl=g('pi-mode'), resEl=g('pi-result'), sv=g('pi-save');
        var lastProducts=[]; var tmr=null;
        function setMode(sku){ if(!modeEl) return; modeEl.innerHTML = sku ? '<span style="color:#e65100;font-weight:600">✎ Updating existing product (SKU: '+piEsc(sku)+')</span>' : 'Adding a new product'; }
        function fillFrom(pr){ if(!pr) return; g('pi-sku').value=pr.sku; g('pi-name').value=pr.name; g('pi-description').value=pr.description; g('pi-listPrice').value=pr.price; g('pi-mrp').value=pr.price; g('pi-productTaxCode').value=pr.taxCode; g('pi-reorderPoint').value=pr.reorderPoint; g('pi-reorderQuantity').value=pr.reorderQuantity; if(g('pi-expiryDate')) g('pi-expiryDate').value=pr.expiryDate||''; if(g('pi-unit')) g('pi-unit').value=pr.unit||''; setMode(pr.sku); if(results){results.style.display='none';} if(s){s.value='';} if(resEl){resEl.innerHTML='';} }
        if(s){
            s.addEventListener('input', function(){
                clearTimeout(tmr); var q=s.value.trim();
                if(q.length<1){ results.style.display='none'; return; }
                tmr=setTimeout(function(){
                    piPost('ProductImport/searchProductsForImport',{term:q}).then(function(d){
                        lastProducts=(d&&d.products)?d.products:[];
                        if(!lastProducts.length){ results.innerHTML='<div style="padding:10px;color:#999;font-size:13px">No match — fill the fields to add it as new</div>'; results.style.display='block'; return; }
                        var h=''; lastProducts.forEach(function(pr,i){ h+='<div class="pi-opt" data-i="'+i+'" style="padding:9px 11px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;justify-content:space-between;gap:8px"><span><b>'+piEsc(pr.name)+'</b> <span style="color:#999;font-size:12px">'+piEsc(pr.sku)+'</span></span><span style="color:#2e7d32;font-weight:700;white-space:nowrap">'+(pr.price!==''?('₹'+pr.price):'')+'</span></div>'; });
                        results.innerHTML=h; results.style.display='block';
                        results.querySelectorAll('.pi-opt').forEach(function(o){
                            o.addEventListener('mouseover', function(){ o.style.background='#ECE8FB'; });
                            o.addEventListener('mouseout', function(){ o.style.background='#fff'; });
                            o.addEventListener('click', function(){ fillFrom(lastProducts[parseInt(o.dataset.i)]); });
                        });
                    });
                }, 300);
            });
            document.addEventListener('click', function(e){ if(results && e.target!==s && !results.contains(e.target)){ results.style.display='none'; } });
        }
        if(g('pi-sku')){ g('pi-sku').addEventListener('input', function(){ setMode(g('pi-sku').value.trim()); }); }
        if(g('pi-clear')){ g('pi-clear').addEventListener('click', function(){ FIELDS.forEach(function(id){ g(id).value=''; }); setMode(''); if(resEl){resEl.innerHTML='';} if(s){s.value='';} }); }
        if(sv){
            sv.addEventListener('click', function(){
                var name=g('pi-name').value.trim();
                if(!name){ resEl.innerHTML='<span style="color:#e53935">Product Name is required</span>'; g('pi-name').focus(); return; }
                sv.disabled=true; var ot=sv.innerHTML; sv.textContent='Saving...';
                piPost('ProductImport/addSingleProduct',{sku:g('pi-sku').value.trim(), productName:name, description:g('pi-description').value.trim(), listPrice:g('pi-listPrice').value.trim(), mrp:g('pi-mrp').value.trim(), productTaxCode:g('pi-productTaxCode').value.trim(), reorderPoint:g('pi-reorderPoint').value.trim(), reorderQuantity:g('pi-reorderQuantity').value.trim(), expiryDate:(g('pi-expiryDate')?g('pi-expiryDate').value.trim():''), unit:(g('pi-unit')?g('pi-unit').value:'')}).then(function(d){
                    sv.disabled=false; sv.innerHTML=ot;
                    if(d&&d.success){ resEl.innerHTML='<span style="color:#2e7d32;font-weight:700">✔ Product '+(d.created?'added':'updated')+': '+d.name+'</span>'; FIELDS.forEach(function(id){ g(id).value=''; }); setMode(''); }
                    else { resEl.innerHTML='<span style="color:#e53935">'+((d&&d.error)||'Error')+'</span>'; }
                }).catch(function(e){ sv.disabled=false; sv.innerHTML=ot; resEl.innerHTML='<span style="color:#e53935">'+e.message+'</span>'; });
            });
        }
        // CSV bulk import (file read client-side or paste)
        var cf=g('pos-csv-file'), cta=g('pos-csv-text'), cbtn=g('pos-csv-import'), cres=g('pos-csv-result');
        if(cf){ cf.addEventListener('change', function(){ var file=cf.files&&cf.files[0]; if(!file)return; var rd=new FileReader(); rd.onload=function(){ cta.value=rd.result; }; rd.readAsText(file); }); }
        if(cbtn){
            cbtn.addEventListener('click', function(){
                var txt=(cta.value||'').trim(); if(!txt){ cres.innerHTML='<span style="color:#e53935">Choose a CSV file or paste rows first</span>'; return; }
                cbtn.disabled=true; var ot=cbtn.innerHTML; cbtn.textContent='Importing...';
                piPost('ProductImport/importProducts',{csvText:txt}).then(function(d){
                    cbtn.disabled=false; cbtn.innerHTML=ot;
                    if(d&&d.success){ var h='<span style="color:#2e7d32;font-weight:700">✔ Imported/updated '+d.imported+', skipped '+d.skipped+'</span>'; if(d.errors&&d.errors.length){ h+='<div style="color:#e65100;font-size:12px;margin-top:6px">'+d.errors.join('<br>')+'</div>'; } cres.innerHTML=h; }
                    else { cres.innerHTML='<span style="color:#e53935">'+((d&&d.error)||'Import failed')+'</span>'; }
                }).catch(function(e){ cbtn.disabled=false; cbtn.innerHTML=ot; cres.innerHTML='<span style="color:#e53935">'+e.message+'</span>'; });
            });
        }
    }
    setInterval(wire, 600);
})();

/* === Bill History (works with or without an open session) === */
(function() {
    var CTX = { sessionId: '', terminalId: '' };
    function histToken() {
        try { if (window.moqui && window.moqui.webrootVue && window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; } catch(e){}
        var af = document.getElementById('cartInlineAddForm');
        if (af) { var t = af.querySelector('[name=moquiSessionToken]'); if (t && t.value) return t.value; }
        // Start-session screen: no cart form and window.moqui.webrootVue may not be initialised yet,
        // so the token came back EMPTY and the history POST was rejected (non-JSON -> "Couldn't load").
        // Any server-rendered token on the page (e.g. the OpenSessionForm) is valid for this session.
        var any = document.querySelector('[name=moquiSessionToken]');
        if (any && any.value) return any.value;
        return '';
    }
    function histToast(msg, bg) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:999999;padding:18px 36px;border-radius:12px;font-size:20px;font-weight:700;color:#fff;background:'+(bg||'#2e7d32')+';box-shadow:0 6px 32px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;white-space:nowrap;letter-spacing:0.5px';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '1'; }, 30);
        setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 400); }, 3500);
    }
        /* === Bill History Panel === */
        var historyOverlay = null;
        function openBillHistory(search) {
            if (historyOverlay) { historyOverlay.remove(); historyOverlay = null; }
            var ov = document.createElement('div');
            ov.id = 'pos-history-overlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Bill history');
            historyOverlay = ov;
            ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
            var panel = document.createElement('div');
            panel.style.cssText = 'background:#fff;border-radius:16px;width:90vw;max-width:800px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden';
            panel.innerHTML = '<div style="padding:16px 20px;background:#7C3AED;color:#fff;display:flex;justify-content:space-between;align-items:center">'
                + '<span style="font-size:18px;font-weight:700">&#128196; Bill History</span>'
                + '<button id="hist-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0 4px">&times;</button></div>'
                + '<div style="padding:12px 20px;border-bottom:1px solid #e0e0e0">'
                + '<input id="hist-search" type="text" placeholder="Search by bill number, amount, or customer..." value="'+(search||'')+'" style="width:100%;padding:10px 14px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none"/></div>'
                + '<div id="hist-list" style="flex:1;overflow-y:auto;padding:8px 12px"><div style="text-align:center;padding:40px;color:#999">Loading...</div></div>';
            ov.appendChild(panel);
            document.body.appendChild(ov);
            try { var _cs=getComputedStyle(ov); console.log('[posterm] overlay appended inDOM=', document.body.contains(ov), 'w=', ov.offsetWidth, 'h=', ov.offsetHeight, 'z=', _cs.zIndex, 'display=', _cs.display, 'pos=', _cs.position, 'parent=', ov.parentNode && ov.parentNode.tagName); } catch(e){ console.log('[posterm] overlay diag err', e); }
            ov.addEventListener('click', function(ev) { if (ev.target === ov) closeHistory(); });
            panel.querySelector('#hist-close').addEventListener('click', closeHistory);
            var searchInput = panel.querySelector('#hist-search');
            var searchTimer = null;
            searchInput.addEventListener('input', function() {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function() { loadHistoryList(searchInput.value); }, 400);
            });
            searchInput.focus();
            loadHistoryList(search || '');
        }
        function closeHistory() {
            if (historyOverlay) { historyOverlay.remove(); historyOverlay = null; }
        }
        // Absolute URL to the Terminal/ajaxCart endpoint, tolerant of a TRAILING SLASH on the current page
        // URL. The credit-bills / history / settle fetches used a RELATIVE 'Terminal/ajaxCart', which the
        // browser resolves against the page's base dir — so on /apps/zenith/pos/CreditBills/ (a trailing
        // slash, e.g. carried in from the /qapps->/apps bounce or a bookmark) it resolved to
        // .../CreditBills/Terminal/ajaxCart -> 404 -> r.json() throws -> the page showed "Could not load
        // credit bills — please refresh the page" and refreshing never helped (the trailing slash persisted).
        // ZE-POS-0211. Every POS screen using this lives at /<shell>/zenith/pos/<Screen>, so the endpoint is
        // always <shell>/zenith/pos/Terminal/ajaxCart in the SAME shell as the current page.
        function ajaxCartUrl() {
            var path = (location.pathname || '').replace(/\/+$/, '');   // drop trailing slash(es)
            var i = path.indexOf('/zenith/pos/');
            if (i >= 0) return path.slice(0, i) + '/zenith/pos/Terminal/ajaxCart';
            return path.slice(0, path.lastIndexOf('/')) + '/Terminal/ajaxCart';  // fallback: sibling of current screen
        }
        function historyPost(params) {
            if (CTX.sessionId) params.sessionId = CTX.sessionId;
            if (CTX.terminalId) params.terminalId = CTX.terminalId;
            // Start-session screen: no active session, so scope bill history by the terminal chosen
            // in the Open-Session dropdown. Without this an owner/manager who never opened a session
            // sees an empty history (the server can only fall back via the operator's own sessions).
            if (!params.sessionId && !params.terminalId) {
                var _tsel = document.querySelector('.pos-no-session [name=terminalId]') || document.querySelector('[name=terminalId]');
                if (_tsel && _tsel.value) params.terminalId = _tsel.value;
            }
            params.moquiSessionToken = histToken();
            var send = params.action === 'amendBill' ? function(url, options) { return window.PosFreeItems.amendmentFetch(url, options, params, histToken()); } : fetch;
            return send(ajaxCartUrl(), {   // ZE-POS-0211: absolute (was relative 'Terminal/ajaxCart' -> broke on a trailing-slash page URL)
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams(params), credentials: 'same-origin'
            }).then(function(r) { return r.json(); });
        }
        /* === Auto-print a REVISED receipt (with EDITED note) after a bill is amended === */
        function printEditedReceipt(txId, billNo, taxOn) {
            if (!txId) return;
            // On the billing screen, reuse the full QZ/iframe pipeline (silent print when QZ is connected)
            if (typeof window._posPrintReceipt === 'function') {
                try { window._posPrintReceipt(txId, billNo, taxOn || 'Y', true); return; } catch(e) {}
            }
            // Fallback (e.g. no active session): fetch receipt data and browser-print
            historyPost({action:'receiptData', transactionId: txId}).then(function(d) {
                if (!d || !d.success) return;
                histIframePrint(buildHistReceipt(d, taxOn === 'Y'));
            });
        }
        function buildHistReceipt(d, isTax) {
            d=window._posReceiptTextData(d);
            var s = d.store || {}, bi = d.bill || {}, sm = d.summary || {};
            function f2(n) { return Number(n||0).toFixed(2); }
            var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Revised Receipt</title><style>'
                + '@page{size:80mm auto;margin:0}body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000}'
                + '.rcpt{width:72mm;margin:0 auto;padding:2mm 3mm;box-sizing:border-box}'
                + '.c{text-align:center}.r{text-align:right}.b{font-weight:bold}.sep{border-bottom:1px dashed #000;margin:4px 0}.sep2{border-bottom:2px solid #000;margin:4px 0}'
                + 'table{width:100%;border-collapse:collapse}th,td{padding:2px 1px;font-size:11px}th{border-bottom:1px solid #000}.hdr{font-size:8px;color:#666}.tot{font-size:15px;font-weight:bold}</style></head><body><div class="rcpt">';
            h += '<div class="c b" style="font-size:16px;margin:2px 0">' + (s.name || 'Store') + '</div>';
            if (s.address) h += '<div class="c hdr">' + s.address + '</div>';
            if (isTax && s.taxReg) h += '<div class="c hdr">GSTIN: ' + s.taxReg + '</div>';
            h += '<div class="sep"></div>';
            h += '<div class="c b" style="font-size:13px;margin:3px 0">' + (isTax ? 'POS TAX RECEIPT' : 'RECEIPT') + '</div>';
            h += '<div class="c b" style="font-size:12px;margin:3px 0;border:1px dashed #000;padding:3px 2px">** EDITED / REVISED BILL **</div>';
            h += '<div class="c hdr" style="margin-bottom:2px">Reprinted after modification</div>';
            h += '<table><tr><td class="hdr" style="width:30%">POS Bill No:</td><td class="b">' + (bi.number || '') + '</td></tr>';
            h += '<tr><td class="hdr">Date:</td><td>' + (bi.date || '') + '</td></tr>';
            h += '<tr><td class="hdr">Customer:</td><td>' + (bi.customer || 'Walk-In') + '</td></tr></table>';
            h += '<div class="sep2"></div>';
            h += '<table><thead><tr><th style="width:16px">#</th><th style="text-align:left">Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Total</th></tr></thead><tbody>';
            (d.items || []).forEach(function(it, i) {
                var hnm = (it.name||'') + (it.mode && it.mode !== 'Retail' ? ' <span style="font-size:8px;color:#555">['+it.mode+']</span>' : '');
                h += '<tr><td class="c">' + (i+1) + '</td><td>' + hnm + '</td><td class="c">' + (it.qty + (it.uom ? ' ' + it.uom : '')) + '</td><td class="r">' + f2(it.rate) + '</td><td class="r">' + f2(it.total) + '</td></tr>';
            });
            h += '</tbody></table><div class="sep"></div>';
            h += '<table><tr><td>Taxable (after discount)</td><td class="r">' + f2(sm.subtotal) + '</td></tr>';
            if (isTax && Number(sm.tax||0) > 0) h += '<tr><td>Tax</td><td class="r">' + f2(sm.tax) + '</td></tr>';
            h += '</table><div class="sep2"></div>';
            h += '<table><tr><td class="tot">' + (isTax ? 'GRAND TOTAL' : 'TOTAL') + '</td><td class="r tot">' + f2(sm.total) + '</td></tr></table>';
            if (d.isCredit) {
                h += '<div class="sep"></div>';
                h += '<div class="c b" style="border:1px dashed #000;padding:3px 2px;font-size:12px">** ' + (Number(d.outstanding) > 0 ? 'CREDIT / PAY LATER' : 'CREDIT / PAID IN FULL') + ' **</div>';
                h += '<table><tr><td class="b">Amount Due</td><td class="r b">' + f2(d.outstanding) + '</td></tr></table>';
            }
            h += '<div class="c b" style="font-size:13px;margin-top:6px">Thank You !!</div>';
            h += '<div class="c" style="margin-top:6px;font-size:7px;color:#666">Powered by ZetaERP &middot; visit www.zetaclantech.com</div>';
            h += '</div>';
            return h;
        }
        function histIframePrint(html) {
            html += '<script>window.onload=function(){window.print();}<\/script></body></html>';
            var iframe = document.getElementById('pos-hist-receipt-frame');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = 'pos-hist-receipt-frame';
                iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:80mm;height:0;border:none;visibility:hidden';
                document.body.appendChild(iframe);
            }
            var iDoc = iframe.contentDocument || iframe.contentWindow.document;
            iDoc.open(); iDoc.write(html); iDoc.close();
        }
        function loadHistoryList(search) {
            var listEl = document.getElementById('hist-list');
            if (!listEl) return;
            listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#999">Loading...</div>';
            historyPost({action:'billHistory', search:search||''}).then(function(d) {
                if (!d || !d.success || !d.bills || d.bills.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#999">'+(search ? 'No bills match "'+search+'"' : 'No completed bills in this session')+'</div>';
                    return;
                }
                var h = '<div style="font-size:12px;color:#999;padding:4px 8px;margin-bottom:4px">'+d.total+' bill'+(d.total>1?'s':'')+' found</div>';
                d.bills.forEach(function(bill) {
                    var payStr = (bill.payments||[]).map(function(p) { return p.method; }).join(', ');
                    var edited = bill.amendCount > 0 ? '<span style="background:#ff9800;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:6px">EDITED ('+bill.amendCount+')</span>' : '';
                    h += '<div class="hist-bill-row" data-tx-id="'+bill.txId+'" style="padding:12px 14px;border:1px solid #e8e8e8;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:all 0.15s;background:#fafafa" onmouseover="this.style.background=\'#ECE8FB\';this.style.borderColor=\'#CBB8F0\'" onmouseout="this.style.background=\'#fafafa\';this.style.borderColor=\'#e8e8e8\'">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center">'
                        + '<div><span style="font-weight:700;font-size:15px;color:#7C3AED">#'+bill.billNo+'</span>'+edited+'</div>'
                        + '<span style="font-weight:800;font-size:16px;color:#2e7d32">₹'+Number(bill.grand||0).toFixed(2)+'</span></div>'
                        + '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px;color:#777">'
                        + '<span>'+bill.date+'</span>'
                        + '<span>'+bill.customer+' &middot; '+bill.itemCount+' item'+(bill.itemCount>1?'s':'')+' &middot; '+payStr+'</span>'
                        + '</div></div>';
                });
                listEl.innerHTML = h;
                listEl.querySelectorAll('.hist-bill-row').forEach(function(row) {
                    row.addEventListener('click', function() {
                        var txId = row.dataset.txId;
                        var bill = d.bills.find(function(b) { return b.txId === txId; });
                        if (bill) openCartEditor(bill);
                    });
                });
            }).catch(function() {
                // ZE-POS-017: while offline, show the bills saved on THIS device (pending sync) instead of
                // a bare connection error. Falls back to the error only when there is nothing queued.
                var showErr = function() {
                    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828">Couldn&#39;t load bill history &mdash; check your connection and try again.</div>';
                };
                if (window._posOffline && window._posOffline.getQueue) {
                    window._posOffline.getQueue().then(function(q) {
                        if (!q || !q.length) { showErr(); return; }
                        var s = (search || '').toLowerCase();
                        var rows = q.filter(function(x) {
                            if (!s) return true;
                            if (String(x.total || '').indexOf(s) !== -1) return true;
                            if ((x.paymentMethod || '').toLowerCase().indexOf(s) !== -1) return true;
                            return (x.items || []).some(function(it) { return (it.name || '').toLowerCase().indexOf(s) !== -1; });
                        });
                        var h = '<div style="background:#c62828;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;margin-bottom:8px">&#9888; OFFLINE &mdash; ' + q.length + ' bill' + (q.length > 1 ? 's' : '') + ' saved on this device; they sync and get bill numbers when back online</div>';
                        if (!rows.length) h += '<div style="text-align:center;padding:30px;color:#999">No offline bills match "' + search + '"</div>';
                        rows.forEach(function(x) {
                            var when = ''; try { when = new Date(x.ts).toLocaleString(); } catch (e) { when = x.ts || ''; }
                            var n = (x.items || []).reduce(function(a, it) { return a + (Number(it.qty) || 0); }, 0);
                            h += '<div style="padding:12px 14px;border:1px dashed #c62828;border-radius:10px;margin-bottom:8px;background:#fff8f8">'
                                + '<div style="display:flex;justify-content:space-between;align-items:center">'
                                + '<span style="background:#c62828;color:#fff;padding:1px 8px;border-radius:4px;font-size:10px;font-weight:700">OFFLINE &mdash; PENDING SYNC</span>'
                                + '<span style="font-weight:800;font-size:16px;color:#2e7d32">&#8377;' + Number(x.total || 0).toFixed(2) + '</span></div>'
                                + '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px;color:#777">'
                                + '<span>' + when + '</span>'
                                + '<span>' + (x.items || []).length + ' item' + ((x.items || []).length !== 1 ? 's' : '') + ' &middot; qty ' + n + ' &middot; ' + (x.paymentMethod || '') + '</span>'
                                + '</div></div>';
                        });
                        if (listEl) listEl.innerHTML = h;
                    }).catch(showErr);
                } else showErr();
            });
        }
        function openBillDetail(bill) {
            var listEl = document.getElementById('hist-list');
            if (!listEl) return;
            var h = '<div style="padding:8px">';
            h += '<button id="hist-back" style="background:none;border:none;color:#7C3AED;font-size:14px;cursor:pointer;padding:4px 0;font-weight:600">&larr; Back to list</button>';
            h += '<div style="background:#f5f5f5;border-radius:10px;padding:14px;margin-top:8px">';
            h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
                + '<span style="font-size:18px;font-weight:700;color:#7C3AED">Bill #'+bill.billNo+'</span>'
                + '<span style="font-size:11px;color:#999">'+bill.date+'</span></div>';
            h += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
            h += '<thead><tr style="border-bottom:2px solid #ddd"><th style="text-align:left;padding:6px 4px">#</th><th style="text-align:left;padding:6px 4px">Item</th><th style="text-align:right;padding:6px 4px">Rate</th><th style="text-align:center;padding:6px 4px">Qty</th><th style="text-align:right;padding:6px 4px">Total</th><th style="padding:6px 4px"></th></tr></thead><tbody>';
            (bill.items||[]).forEach(function(it, idx) {
                h += '<tr style="border-bottom:1px solid #eee" data-seq="'+it.seq+'" data-tx="'+bill.txId+'">'
                    + '<td style="padding:6px 4px;color:#999">'+(idx+1)+'</td>'
                    + '<td style="padding:6px 4px;font-weight:600">'+it.name+'</td>'
                    + '<td style="padding:6px 4px;text-align:right"><input type="number" class="hist-price" value="'+Number(it.price).toFixed(2)+'" data-seq="'+it.seq+'" style="width:70px;padding:4px;border:1px solid #ccc;border-radius:4px;text-align:right;font-size:13px"/></td>'
                    + '<td style="padding:6px 4px;text-align:center"><input type="number" class="hist-qty" value="'+it.qty+'" data-seq="'+it.seq+'" min="1" style="width:50px;padding:4px;border:1px solid #ccc;border-radius:4px;text-align:center;font-size:13px"/></td>'
                    + '<td style="padding:6px 4px;text-align:right;font-weight:600">₹'+Number(it.total).toFixed(2)+'</td>'
                    + '<td style="padding:6px 4px;text-align:center"><button class="hist-rm" data-seq="'+it.seq+'" style="background:#e53935;color:#fff;border:none;border-radius:4px;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:1">&times;</button></td>'
                    + '</tr>';
            });
            h += '</tbody></table>';
            h += '<div style="margin-top:10px;display:flex;justify-content:space-between;font-size:14px">'
                + '<span>Subtotal: ₹'+Number(bill.subtotal||0).toFixed(2)+' | Tax: ₹'+Number(bill.tax||0).toFixed(2)+'</span>'
                + '<span style="font-weight:800;font-size:16px;color:#2e7d32">Total: ₹'+Number(bill.grand||0).toFixed(2)+'</span></div>';
            h += '<div style="margin-top:6px;font-size:12px;color:#777">Payment: '+(bill.payments||[]).map(function(p) { return p.method+' ₹'+Number(p.amount).toFixed(2); }).join(', ')+'</div>';
            if (Number(bill.refundDue||0) > 0) {
                h += '<div style="margin-top:8px;background:#fff8e1;border:2px solid #f57f17;border-radius:8px;padding:10px;text-align:center;font-weight:800;font-size:15px;color:#e65100">&#8617; REFUND ₹'+Number(bill.refundDue).toFixed(2)+' to the customer<div style="font-size:11px;font-weight:600;color:#bf360c;margin-top:2px">Bill total dropped below the amount already paid</div></div>';
            } else if (Number(bill.balanceDue||0) > 0) {
                h += '<div style="margin-top:8px;background:#ffebee;border:2px solid #c62828;border-radius:8px;padding:10px;text-align:center;font-weight:800;font-size:15px;color:#b71c1c">&#43; COLLECT ₹'+Number(bill.balanceDue).toFixed(2)+' more from the customer<div style="font-size:11px;font-weight:600;color:#7f0000;margin-top:2px">Bill total rose above the amount already paid</div></div>';
            }
            h += '</div>';
            if (bill.amendments && bill.amendments.length > 0) {
                h += '<div style="margin-top:12px;background:#fff3e0;border-radius:10px;padding:12px">';
                h += '<div style="font-weight:700;font-size:13px;color:#e65100;margin-bottom:6px">&#9888; Edit History ('+bill.amendments.length+')</div>';
                bill.amendments.forEach(function(a) {
                    h += '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #ffe0b2">'
                        + '<span style="color:#999">'+a.date+'</span> — '
                        + '<span style="font-weight:600">'+a.type.replace('_',' ')+'</span>: '
                        + a.product+' ['+a.oldVal+' → '+a.newVal+'] — <i>'+a.reason+'</i></div>';
                });
                h += '</div>';
            }
            h += '<div style="margin-top:12px;background:#ECE8FB;border-radius:10px;padding:12px">';
            h += '<div style="font-weight:600;font-size:13px;color:#7C3AED;margin-bottom:6px">&#43; Add Item to Bill</div>';
            h += '<div style="display:flex;gap:6px;align-items:center">';
            h += '<div style="flex:1;position:relative"><input id="hist-add-search" type="text" placeholder="Search product by name or code..." style="width:100%;padding:10px;border:1px solid #CBB8F0;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>';
            h += '<div id="hist-add-results" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-height:200px;overflow-y:auto;margin-top:2px"></div></div>';
            h += '<input id="hist-add-qty" type="number" value="1" min="1" style="width:60px;padding:10px;border:1px solid #CBB8F0;border-radius:6px;font-size:13px;text-align:center;box-sizing:border-box"/>';
            h += '</div></div>';
            h += '<div style="margin-top:12px;background:#e8f5e9;border-radius:10px;padding:12px">';
            h += '<div style="font-weight:600;font-size:13px;color:#2e7d32;margin-bottom:6px">Edit this bill</div>';
            h += '<div style="font-size:12px;color:#666;margin-bottom:8px">Change qty or price above, remove items, or add new items. Enter reason and click Save.</div>';
            h += '<input id="hist-reason" type="text" placeholder="Reason for edit (required)..." style="width:100%;padding:10px;border:1px solid #c8e6c9;border-radius:6px;font-size:13px;box-sizing:border-box;margin-bottom:8px"/>';
            h += '<button id="hist-save-edits" style="width:100%;padding:12px;background:#2e7d32;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">&#10003; Save Changes</button>';
            h += '</div></div>';
            listEl.innerHTML = h;
            listEl.querySelector('#hist-back').addEventListener('click', function() {
                var sv = document.getElementById('hist-search');
                loadHistoryList(sv ? sv.value : '');
            });
            listEl.querySelectorAll('.hist-rm').forEach(function(btn) {
                btn.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    var reason = document.getElementById('hist-reason').value.trim();
                    if (!reason) { histToast('Please enter a reason for the edit', '#e53935'); document.getElementById('hist-reason').focus(); return; }
                    var seq = btn.dataset.seq;
                    btn.disabled = true; btn.textContent = '...';
                    historyPost({action:'amendBill', editTxId:bill.txId, editType:'ITEM_REMOVED', editItemSeqId:seq, editReason:reason}).then(function(r) {
                        if (r && r.success) {
                            histToast('Item removed & recorded — printing revised bill', '#e65100');
                            openBillDetail(r.bill);
                            printEditedReceipt(r.bill.txId, r.bill.billNo, (Number(r.bill.tax) > 0 ? 'Y' : 'N'));
                        } else { histToast(r.error||'Error', '#e53935'); btn.disabled = false; btn.textContent = '×'; }
                    });
                });
            });
            listEl.querySelector('#hist-save-edits').addEventListener('click', function() {
                var reason = document.getElementById('hist-reason').value.trim();
                if (!reason) { histToast('Please enter a reason for the edit', '#e53935'); document.getElementById('hist-reason').focus(); return; }
                var changes = [];
                listEl.querySelectorAll('.hist-qty').forEach(function(inp) {
                    var seq = inp.dataset.seq;
                    var orig = (bill.items||[]).find(function(it) { return it.seq === seq; });
                    if (orig && Number(inp.value) !== Number(orig.qty)) {
                        changes.push({type:'QTY_CHANGE', seq:seq, val:inp.value});
                    }
                });
                listEl.querySelectorAll('.hist-price').forEach(function(inp) {
                    var seq = inp.dataset.seq;
                    var orig = (bill.items||[]).find(function(it) { return it.seq === seq; });
                    if (orig && Number(inp.value).toFixed(2) !== Number(orig.price).toFixed(2)) {
                        changes.push({type:'PRICE_CHANGE', seq:seq, val:inp.value});
                    }
                });
                if (changes.length === 0) { histToast('No changes to save', '#ff9800'); return; }
                var saveBtn = listEl.querySelector('#hist-save-edits');
                saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
                var chain = Promise.resolve(null);
                changes.forEach(function(c) {
                    chain = chain.then(function() {
                        var params = {action:'amendBill', editTxId:bill.txId, editType:c.type, editItemSeqId:c.seq, editReason:reason};
                        if (c.type === 'QTY_CHANGE') params.newQty = c.val;
                        if (c.type === 'PRICE_CHANGE') params.newPrice = c.val;
                        return historyPost(params);
                    });
                });
                chain.then(function(lastResult) {
                    if (lastResult && lastResult.success) {
                        histToast('✔ Bill edited & recorded — printing revised bill', '#2e7d32');
                        openBillDetail(lastResult.bill);
                        printEditedReceipt(lastResult.bill.txId, lastResult.bill.billNo, (Number(lastResult.bill.tax) > 0 ? 'Y' : 'N'));
                    } else {
                        histToast(lastResult?.error||'Error saving', '#e53935');
                        saveBtn.disabled = false; saveBtn.textContent = '✓ Save Changes';
                    }
                });
            });
            var addSearch = listEl.querySelector('#hist-add-search');
            var addResults = listEl.querySelector('#hist-add-results');
            var addTimer = null;
            if (addSearch) addSearch.addEventListener('input', function() {
                clearTimeout(addTimer);
                var q = addSearch.value.trim();
                if (q.length < 1) { addResults.style.display = 'none'; return; }
                addTimer = setTimeout(function() {
                    historyPost({action:'searchProductsJson', q:q}).then(function(d) {
                        if (!d || !d.success || !d.products || d.products.length === 0) {
                            addResults.innerHTML = '<div style="padding:12px;color:#999;font-size:13px">No products found</div>';
                            addResults.style.display = 'block'; return;
                        }
                        var rh = '';
                        d.products.forEach(function(p) {
                            rh += '<div class="hist-prod-item" data-pid="'+p.pid+'" data-name="'+p.name+'" data-price="'+p.price+'" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;transition:background 0.1s" onmouseover="this.style.background=\'#ECE8FB\'" onmouseout="this.style.background=\'#fff\'">'
                                + '<div><div style="font-weight:600;font-size:13px">'+p.name+'</div><div style="font-size:11px;color:#999">'+p.pid+'</div></div>'
                                + '<span style="font-weight:700;color:#2e7d32">₹'+Number(p.price).toFixed(2)+'</span></div>';
                        });
                        addResults.innerHTML = rh;
                        addResults.style.display = 'block';
                        addResults.querySelectorAll('.hist-prod-item').forEach(function(row) {
                            row.addEventListener('click', function() {
                                var reason = document.getElementById('hist-reason').value.trim();
                                if (!reason) { histToast('Please enter a reason first', '#e53935'); document.getElementById('hist-reason').focus(); return; }
                                var pid = row.dataset.pid;
                                var qty = document.getElementById('hist-add-qty').value || '1';
                                addResults.style.display = 'none';
                                addSearch.value = '';
                                row.style.opacity = '0.5';
                                historyPost({action:'amendBill', editTxId:bill.txId, editType:'ITEM_ADDED', addProductId:pid, addQty:qty, editReason:reason}).then(function(r) {
                                    if (r && r.success) {
                                        histToast('✔ Item added & recorded — printing revised bill', '#2e7d32');
                                        openBillDetail(r.bill);
                                        printEditedReceipt(r.bill.txId, r.bill.billNo, (Number(r.bill.tax) > 0 ? 'Y' : 'N'));
                                    } else { histToast(r.error||'Error adding item', '#e53935'); }
                                });
                            });
                        });
                    });
                }, 300);
            });
        }

        /* === Edit an issued bill IN the cart view ===
           Loads a completed bill's items into a cart-styled editor mounted over the .pos-cart
           panel. Editing is entirely client-side (the live open cart is never touched); SAVE diffs
           against the original and submits one atomic server `amendBill` batch (same bill number,
           tracked amendments, tax recompute, refund/collect, revised receipt). No-op for normal
           billing — nothing here runs unless a cashier opens a bill from History to edit. */
        var cartEditorEl = null, cartEditorPrevPos = '';
        function closeCartEditor() {
            var cartEl = document.querySelector('.pos-cart');
            if (cartEditorEl && cartEditorEl.parentNode) cartEditorEl.parentNode.removeChild(cartEditorEl);
            cartEditorEl = null;
            // Stop routing product-grid taps into the (now closed) editor — taps go back to the live cart.
            window.__posCartEditorAddProduct = null;
            if (cartEl) cartEl.style.position = cartEditorPrevPos || '';
        }
        function openCartEditor(bill) {
            closeHistory();
            closeCartEditor();
            var cartEl = document.querySelector('.pos-cart');
            if (!cartEl) { histToast('Cart view not available', '#e53935'); return; }
            // The editor is a light card; force readable colors so the dark-theme rules
            // (body.body--dark .pos-cart table tbody td/input { …!important }) don't bleed in.
            // An #id selector outranks the theme's class selectors.
            if (!document.getElementById('ced-style')) {
                var st = document.createElement('style'); st.id = 'ced-style';
                st.textContent =
                    '#pos-cart-editor table tbody td{color:#222 !important}'
                  + '#pos-cart-editor table tbody td>div{color:#999 !important}'
                  + '#pos-cart-editor table thead th{color:#7C3AED !important;background:#eaf2fb !important}'
                  + '#pos-cart-editor input{background:#fff !important;color:#222 !important}'
                  + '#pos-cart-editor input::placeholder{color:#9aa0a6 !important}'
                  + '#pos-cart-editor .ced-inc,#pos-cart-editor .ced-dec{background:#f5f5f5 !important;color:#222 !important}'
                  + '#pos-cart-editor #ced-add-res{background:#fff !important}'
                  + '#pos-cart-editor .ced-pi div{color:#222 !important}'
                  // Outlined table: blue outer border (matches the editor header) + soft-blue gridlines.
                  + '#pos-cart-editor table{border:1px solid #7C3AED !important}'
                  + '#pos-cart-editor table th,#pos-cart-editor table td{border:1px solid #DCD3F2 !important}'
                  + '#pos-cart-editor table thead th{border-bottom:2px solid #7C3AED !important}';
                document.head.appendChild(st);
            }
            function f2(n) { return Number(n||0).toFixed(2); }
            // Working model — one row per line. Existing lines carry their seq; new lines have seq=null.
            var work = (bill.items || []).map(function(it) {
                var price = Number(it.price)||0, qty = Number(it.qty)||0;
                var taxable = price * qty;
                return { seq: it.seq, pid: it.pid, name: it.name, uom: it.uom || '',
                         price: price, qty: qty,
                         origPrice: price, origQty: qty,
                         taxRate: (taxable > 0 ? (Number(it.tax)||0) / taxable : 0),
                         isNew: false, removed: false };
            });
            cartEditorPrevPos = cartEl.style.position || '';
            cartEl.style.position = 'relative';
            var ed = document.createElement('div');
            cartEditorEl = ed;
            ed.id = 'pos-cart-editor';
            ed.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:900;background:#fff;display:flex;flex-direction:column;box-shadow:-2px 0 0 #7C3AED inset';
            // Block the global terminal keyboard shortcuts while typing in the editor.
            ed.addEventListener('keydown', function(e) { e.stopPropagation(); });
            ed.innerHTML =
                '<div style="background:#7C3AED;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">'
              + '<div><span style="font-size:16px;font-weight:800">&#9998; Editing Bill #'+bill.billNo+'</span>'
              + '<div style="font-size:11px;opacity:0.9;margin-top:2px">Change qty / price, remove items, or <b>tap a product on the left</b> to add it. You will be asked for a reason before saving the revised bill.</div></div>'
              + '<button id="ced-cancel-x" title="Cancel" style="background:rgba(255,255,255,0.18);border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;border-radius:6px;width:34px;height:34px">&times;</button></div>'
              + '<div id="ced-rows" style="flex:1;overflow-y:auto;padding:6px 10px"></div>'
              + '<div style="flex-shrink:0;border-top:1px solid #e0e0e0;background:#f0faf0;padding:8px 12px;position:relative">'
              +   '<div style="display:flex;gap:6px;align-items:center;position:relative">'
              +     '<input id="ced-add" type="text" placeholder="&#43; Add item — search name or code…" autocomplete="off" style="flex:1;padding:9px 12px;border:1px solid #CBB8F0;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>'
              +     '<input id="ced-add-qty" type="number" value="1" min="1" style="width:56px;padding:9px;border:1px solid #CBB8F0;border-radius:6px;font-size:13px;text-align:center;box-sizing:border-box"/>'
              +     '<div id="ced-add-res" style="display:none;position:absolute;bottom:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 -4px 16px rgba(0,0,0,0.15);max-height:200px;overflow-y:auto;margin-bottom:4px"></div>'
              +   '</div>'
              + '</div>'
              + '<div style="flex-shrink:0;border-top:1px solid #e0e0e0;padding:10px 12px;background:#fafafa">'
              +   '<div id="ced-totals" style="font-size:13px;color:#333;margin-bottom:8px"></div>'
              +   '<div style="display:flex;gap:8px">'
              +     '<button id="ced-cancel" style="flex:1;padding:13px;border:2px solid #ccc;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button>'
              +     '<button id="ced-save" style="flex:2;padding:13px;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;background:#2e7d32;color:#fff">&#10003; Save &amp; print revised bill</button>'
              +   '</div>'
              + '</div>'
              + '<div id="ced-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="ced-reason-title" style="display:none;position:absolute;inset:0;z-index:30;background:rgba(20,16,40,.65);align-items:center;justify-content:center;padding:14px">'
              +   '<div style="width:min(440px,100%);background:#fff;border-radius:12px;padding:20px;box-shadow:0 12px 35px rgba(0,0,0,.25)">'
              +     '<h3 id="ced-reason-title" style="margin:0 0 8px;color:#25204d;font-size:18px">Reason for changing this bill</h3>'
              +     '<p style="margin:0 0 12px;color:#5A5273;font-size:13px">The revised bill keeps its original number. Your reason and each price or item change are saved in the audit history.</p>'
              +     '<label for="ced-reason" style="display:block;font-size:13px;font-weight:700;margin-bottom:5px">Reason *</label>'
              +     '<textarea id="ced-reason" maxlength="500" rows="3" placeholder="For example, corrected item price" style="width:100%;box-sizing:border-box;border:1px solid #CBB8F0;border-radius:8px;padding:10px;font:inherit;resize:vertical"></textarea>'
              +     '<div id="ced-reason-error" role="alert" style="min-height:19px;color:#c62828;font-size:12px;margin-top:4px"></div>'
              +     '<div style="display:flex;gap:8px;margin-top:12px"><button id="ced-reason-cancel" type="button" style="flex:1;padding:11px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer">Back</button>'
              +     '<button id="ced-reason-confirm" type="button" style="flex:2;padding:11px;border:0;border-radius:8px;background:#2e7d32;color:#fff;font-weight:700;cursor:pointer">Confirm, save &amp; print</button></div>'
              +   '</div>'
              + '</div>';
            cartEl.appendChild(ed);

            var rowsEl = ed.querySelector('#ced-rows');
            var totalsEl = ed.querySelector('#ced-totals');
            function dirty() {
                for (var i=0;i<work.length;i++){ var w=work[i];
                    if (w.isNew && !w.removed) return true;
                    if (!w.isNew && w.removed) return true;
                    if (!w.isNew && !w.removed && (w.qty!==w.origQty || f2(w.price)!==f2(w.origPrice))) return true;
                }
                return false;
            }
            function renderRows() {
                var h = '<table style="width:100%;border-collapse:collapse;font-size:13px">'
                  + '<thead><tr style="border-bottom:2px solid #ddd;color:#777">'
                  + '<th style="text-align:left;padding:6px 4px;width:22px">#</th>'
                  + '<th style="text-align:left;padding:6px 4px">Item</th>'
                  + '<th style="text-align:right;padding:6px 4px;width:78px">Rate</th>'
                  + '<th style="text-align:center;padding:6px 4px;width:104px">Qty</th>'
                  + '<th style="text-align:right;padding:6px 4px;width:74px">Total</th>'
                  + '<th style="width:30px"></th></tr></thead><tbody>';
                var shown = 0;
                work.forEach(function(w, idx) {
                    var lineTot = w.price * w.qty;
                    if (w.removed) {
                        h += '<tr data-idx="'+idx+'" style="border-bottom:1px solid #f0f0f0;background:#fff5f5;color:#bbb">'
                          + '<td style="padding:6px 4px">&mdash;</td>'
                          + '<td style="padding:6px 4px;text-decoration:line-through">'+w.name+'</td>'
                          + '<td colspan="3" style="padding:6px 4px;text-align:right;font-style:italic;color:#c62828">removed</td>'
                          + '<td style="padding:6px 4px;text-align:center"><button class="ced-undo" data-idx="'+idx+'" title="Undo" style="background:#eee;border:none;border-radius:4px;width:26px;height:26px;cursor:pointer;font-size:14px">&#8634;</button></td></tr>';
                        return;
                    }
                    shown++;
                    var newTag = w.isNew ? ' <span style="background:#2e7d32;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;vertical-align:middle">NEW</span>' : '';
                    h += '<tr data-idx="'+idx+'" style="border-bottom:1px solid #eee">'
                      + '<td style="padding:6px 4px;color:#999">'+shown+'</td>'
                      + '<td style="padding:6px 4px;font-weight:600">'+w.name+newTag+(w.uom?'<div style="font-size:10px;color:#999;font-weight:400">'+w.uom+'</div>':'')+'</td>'
                      + '<td style="padding:6px 4px;text-align:right"><input class="ced-price" data-idx="'+idx+'" type="number" step="0.01" min="0" value="'+f2(w.price)+'" style="width:70px;padding:5px;border:1px solid #ccc;border-radius:4px;text-align:right;font-size:13px"/></td>'
                      + '<td style="padding:6px 4px;text-align:center;white-space:nowrap">'
                      +   '<button class="ced-dec" data-idx="'+idx+'" style="width:26px;height:28px;border:1px solid #bbb;background:#f5f5f5;border-radius:5px;font-size:16px;cursor:pointer;vertical-align:middle">&minus;</button>'
                      +   '<input class="ced-qty" data-idx="'+idx+'" type="number" step="0.001" min="0" value="'+w.qty+'" style="width:46px;padding:5px 2px;border:1px solid #ccc;border-radius:4px;text-align:center;font-size:13px;margin:0 3px;vertical-align:middle"/>'
                      +   '<button class="ced-inc" data-idx="'+idx+'" style="width:26px;height:28px;border:1px solid #bbb;background:#f5f5f5;border-radius:5px;font-size:16px;cursor:pointer;vertical-align:middle">&#43;</button>'
                      + '</td>'
                      + '<td style="padding:6px 4px;text-align:right;font-weight:600">&#8377;'+f2(lineTot)+'</td>'
                      + '<td style="padding:6px 4px;text-align:center"><button class="ced-rm" data-idx="'+idx+'" title="Remove" style="background:#e53935;color:#fff;border:none;border-radius:4px;width:26px;height:26px;cursor:pointer;font-size:15px;line-height:1">&times;</button></td></tr>';
                });
                h += '</tbody></table>';
                if (shown === 0) h += '<div style="text-align:center;color:#c62828;padding:18px;font-size:13px">All items removed — saving will empty this bill.</div>';
                rowsEl.innerHTML = h;
                bindRows();
                renderTotals();
            }
            function renderTotals() {
                var sub = 0, tax = 0, hasNew = false;
                work.forEach(function(w) {
                    if (w.removed) return;
                    var base = w.price * w.qty;
                    sub += base;
                    tax += base * (w.taxRate || 0);
                    if (w.isNew) hasNew = true;
                });
                var est = sub + tax;
                var orig = Number(bill.grand)||0;
                var diff = est - orig;
                var diffStr = diff > 0.005 ? ('<span style="color:#c62828;font-weight:700"> &nbsp;collect ~&#8377;'+f2(diff)+' more</span>')
                            : diff < -0.005 ? ('<span style="color:#7C3AED;font-weight:700"> &nbsp;refund ~&#8377;'+f2(-diff)+'</span>')
                            : '';
                totalsEl.innerHTML = 'Est. subtotal &#8377;'+f2(sub)+' &middot; GST ~&#8377;'+f2(tax)
                  + ' &middot; <b>Est. total ~&#8377;'+f2(est)+'</b>'+diffStr
                  + '<div style="font-size:11px;color:#999;margin-top:2px">Was &#8377;'+f2(orig)+'. '
                  + (hasNew ? 'New items priced at default; ' : '') + 'final GST &amp; total are recomputed when you save.</div>';
            }
            function bindRows() {
                rowsEl.querySelectorAll('.ced-price').forEach(function(inp){ inp.addEventListener('change', function(){ var w=work[+inp.dataset.idx]; var v=Number(inp.value); if(!(v>=0)){ inp.value=f2(w.price); return; } w.price=v; renderTotals(); var tot=inp.closest('tr').querySelector('td:nth-child(5)'); if(tot) tot.innerHTML='&#8377;'+f2(w.price*w.qty); }); });
                rowsEl.querySelectorAll('.ced-qty').forEach(function(inp){ inp.addEventListener('change', function(){ var w=work[+inp.dataset.idx]; var v=Number(inp.value); if(!(v>0)){ inp.value=w.qty; return; } w.qty=v; renderTotals(); var tot=inp.closest('tr').querySelector('td:nth-child(5)'); if(tot) tot.innerHTML='&#8377;'+f2(w.price*w.qty); }); });
                rowsEl.querySelectorAll('.ced-inc').forEach(function(b){ b.addEventListener('click', function(){ var w=work[+b.dataset.idx]; w.qty=Math.round((w.qty+1)*1000)/1000; renderRows(); }); });
                rowsEl.querySelectorAll('.ced-dec').forEach(function(b){ b.addEventListener('click', function(){ var w=work[+b.dataset.idx]; var nv=Math.round((w.qty-1)*1000)/1000; if(nv>0){ w.qty=nv; renderRows(); } }); });
                rowsEl.querySelectorAll('.ced-rm').forEach(function(b){ b.addEventListener('click', function(){ var w=work[+b.dataset.idx]; if(w.isNew){ work.splice(+b.dataset.idx,1); } else { w.removed=true; } renderRows(); }); });
                rowsEl.querySelectorAll('.ced-undo').forEach(function(b){ b.addEventListener('click', function(){ work[+b.dataset.idx].removed=false; renderRows(); }); });
            }
            // Add-item search
            var addInp = ed.querySelector('#ced-add'), addRes = ed.querySelector('#ced-add-res'), addTimer=null;
            addInp.addEventListener('input', function(){
                clearTimeout(addTimer);
                var q = addInp.value.trim();
                if (q.length < 1) { addRes.style.display='none'; return; }
                addTimer = setTimeout(function(){
                    historyPost({action:'searchProductsJson', q:q}).then(function(d){
                        if (!d || !d.success || !d.products || !d.products.length) { addRes.innerHTML='<div style="padding:10px;color:#999;font-size:13px">No products found</div>'; addRes.style.display='block'; return; }
                        var rh='';
                        d.products.forEach(function(pr){ rh += '<div class="ced-pi" data-pid="'+pr.pid+'" data-name="'+(pr.name||'').replace(/"/g,'&quot;')+'" data-price="'+pr.price+'" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center" onmouseover="this.style.background=\'#ECE8FB\'" onmouseout="this.style.background=\'#fff\'"><div><div style="font-weight:600;font-size:13px">'+pr.name+'</div><div style="font-size:11px;color:#999">'+pr.pid+'</div></div><span style="font-weight:700;color:#2e7d32">&#8377;'+f2(pr.price)+'</span></div>'; });
                        addRes.innerHTML=rh; addRes.style.display='block';
                        addRes.querySelectorAll('.ced-pi').forEach(function(row){ row.addEventListener('click', function(){
                            var qy = Number(ed.querySelector('#ced-add-qty').value)||1; if(qy<=0) qy=1;
                            work.push({ seq:null, pid:row.dataset.pid, name:row.dataset.name, uom:'', price:Number(row.dataset.price)||0, qty:qy, origPrice:Number(row.dataset.price)||0, origQty:0, taxRate:0, isNew:true, removed:false });
                            addInp.value=''; addRes.style.display='none'; renderRows();
                        }); });
                    });
                }, 300);
            });
            document.addEventListener('click', function ofc(e){ if(!cartEditorEl){ document.removeEventListener('click', ofc); return; } if(addRes && !addRes.contains(e.target) && e.target!==addInp) addRes.style.display='none'; });

            function doCancel() { if (dirty() && !window.confirm('Discard your unsaved changes to Bill #'+bill.billNo+'?')) return; closeCartEditor(); }
            ed.querySelector('#ced-cancel').addEventListener('click', doCancel);
            ed.querySelector('#ced-cancel-x').addEventListener('click', doCancel);

            function pendingEditOps() {
                // Existing-line changes/removes, then new-item adds. One request saves all
                // operations and either commits the whole revised bill or rolls it all back.
                var ops = [];
                work.forEach(function(w){
                    if (w.isNew || w.removed) return;
                    if (w.qty !== w.origQty) ops.push({type:'QTY_CHANGE', seq:w.seq, newQty:w.qty});
                    if (f2(w.price) !== f2(w.origPrice)) ops.push({type:'PRICE_CHANGE', seq:w.seq, newPrice:w.price});
                });
                work.forEach(function(w){ if (!w.isNew && w.removed) ops.push({type:'ITEM_REMOVED', seq:w.seq}); });
                work.forEach(function(w){ if (w.isNew && !w.removed) ops.push({type:'ITEM_ADDED', productId:w.pid, addQty:w.qty, newPrice:w.price}); });
                return ops;
            }
            var reasonDialog = ed.querySelector('#ced-reason-dialog');
            var reasonInput = ed.querySelector('#ced-reason');
            var reasonError = ed.querySelector('#ced-reason-error');
            ed.querySelector('#ced-save').addEventListener('click', function(){
                var ops = pendingEditOps();
                if (!ops.length) { histToast('No changes to save', '#ff9800'); return; }
                reasonError.textContent = '';
                reasonDialog.style.display = 'flex';
                reasonInput.focus();
            });
            ed.querySelector('#ced-reason-cancel').addEventListener('click', function(){ reasonDialog.style.display='none'; });
            reasonInput.addEventListener('keydown', function(e){ if (e.key==='Escape') reasonDialog.style.display='none'; });
            ed.querySelector('#ced-reason-confirm').addEventListener('click', function(){
                var reason = reasonInput.value.trim();
                if (!reason) { reasonError.textContent='Enter a reason before saving this bill.'; reasonInput.focus(); return; }
                var ops = pendingEditOps();
                if (!ops.length) { reasonDialog.style.display='none'; histToast('No changes to save', '#ff9800'); return; }
                var confirmBtn=ed.querySelector('#ced-reason-confirm');
                confirmBtn.disabled=true; confirmBtn.textContent='Saving…'; reasonError.textContent='';
                historyPost({action:'amendBill', editTxId:bill.txId, editReason:reason, editOps:JSON.stringify(ops)}).then(function(r){
                    if (!r || !r.success || !r.bill) throw new Error(r && r.error ? r.error : 'Could not save bill changes');
                    var revised=r.bill;
                    histToast('Bill #'+revised.billNo+' updated — printing revised bill', '#2e7d32');
                    var rd=Number(revised.refundDue)||0, bd=Number(revised.balanceDue)||0;
                    if (rd>0.005) setTimeout(function(){ histToast('REFUND ₹'+f2(rd)+' to the customer', '#7C3AED'); }, 1200);
                    else if (bd>0.005) setTimeout(function(){ histToast('COLLECT ₹'+f2(bd)+' more from the customer', '#e65100'); }, 1200);
                    printEditedReceipt(revised.txId, revised.billNo, (Number(revised.tax)>0?'Y':'N'));
                    closeCartEditor();
                }).catch(function(err){
                    reasonError.textContent=String(err && err.message ? err.message : err);
                    confirmBtn.disabled=false; confirmBtn.textContent='Confirm, save & print';
                });
            });

            renderRows();
            // While this editor is open, a product tap on the left grid adds the product to THIS
            // bill (the working model) instead of the live cart hidden behind the editor. The grid
            // submit-interceptor (in the cart engine) calls this hook when it is set. Tapping a
            // product already on the bill bumps that line's qty by 1 (a tracked amendment on save).
            window.__posCartEditorAddProduct = function(pid, price, name) {
                if (!pid) return;
                if (reasonDialog.style.display === 'flex') return;
                var ex = null;
                for (var i = 0; i < work.length; i++) { if (!work[i].removed && work[i].pid === pid) { ex = work[i]; break; } }
                if (ex) { ex.qty = Math.round((ex.qty + 1) * 1000) / 1000; }
                else { work.push({ seq: null, pid: pid, name: name || pid, uom: '', price: Number(price) || 0,
                                   qty: 1, origPrice: Number(price) || 0, origQty: 0, taxRate: 0, isNew: true, removed: false }); }
                renderRows();
                histToast('Added ' + (name || pid) + ' to bill', '#2e7d32');
            };
            setTimeout(function(){ var r=ed.querySelector('.ced-price'); if(r) r.focus(); }, 50);
        }
        window.posOpenCartEditor = openCartEditor;

    window.posOpenHistory = function() {
        console.log('[posterm] posOpenHistory FIRED');
        var af = document.getElementById('cartInlineAddForm');
        var sid = af ? ((af.querySelector('[name=sessionId]')||{}).value || '') : '';
        CTX = { sessionId: sid, terminalId: '' };
        openBillHistory('');
    };
    /* Robust History button: bind via document delegation so the click works even if the inline
       onclick is dropped by the SPA shell or the button is (re)rendered after load. Guard prevents double-binding. */
    if (!window.__posHistDelegated) {
        window.__posHistDelegated = true;
        document.addEventListener('click', function(e) {
            var b = (e.target && e.target.closest) ? e.target.closest('#pos-history-btn, #pos-history-btn-ns') : null;
            if (b) { console.log('[posterm] delegation caught history click'); e.preventDefault(); if (typeof window.posOpenHistory === 'function') window.posOpenHistory(); }
        });
    }

    /* === Customer picker: attach a contact (Customer role) to the OPEN bill === */
    function getOpenTxId() {
        var af = document.getElementById('cartInlineAddForm');
        var t = af ? af.querySelector('[name=transactionId]') : document.querySelector('input[name="transactionId"]');
        return t ? (t.value || '') : '';
    }
    function setCustChip(name) {
        ['pos-cust-name', 'pos-header-customer-name'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = (name && name.length) ? name : 'Walk-in Customer';
        });
    }
    function custEscape(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
        });
    }
    function enableTaxBill(transactionId) {
        var source = document.querySelector('form.nb-tax');
        if (!source) { histToast('Tax mode is unavailable. Please use the Tax switch.', '#c62828'); return; }
        var form = document.createElement('form');
        form.method = 'post'; form.action = source.action; form.style.display = 'none';
        source.querySelectorAll('input[name]').forEach(function(input) {
            var hidden = document.createElement('input');
            hidden.type = 'hidden'; hidden.name = input.name;
            hidden.value = input.name === 'transactionId' ? transactionId : input.value;
            form.appendChild(hidden);
        });
        document.body.appendChild(form);
        form.submit();
    }
    function custPost(transition, params) {
        params = params || {};
        if (CTX.sessionId) params.sessionId = CTX.sessionId;
        params.moquiSessionToken = histToken();
        if (typeof window._posCurrentTax === 'function') params.taxOn = window._posCurrentTax();
        return fetch('Terminal/' + transition, {
            method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams(params), credentials: 'same-origin'
        }).then(function(r) {
            if (!r.ok) return {success:false,error:r.status === 401 ? 'Your session expired. Please sign in again.' : 'Could not update the customer.'};
            return r.json();
        }).catch(function() { return {success:false,error:'Could not reach the server. Try again.'}; });
    }
    var customerOverlay = null;
    function closeCustomer() { if (customerOverlay) { customerOverlay.remove(); customerOverlay = null; } }
    function openCustomerPicker() {
        var af = document.getElementById('cartInlineAddForm');
        CTX.sessionId = af ? ((af.querySelector('[name=sessionId]') || {}).value || '') : CTX.sessionId;
        closeCustomer();
        var ov = document.createElement('div'); customerOverlay = ov; ov.id='posCustomerOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Choose customer');
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:6vh';
        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:16px;width:90vw;max-width:560px;max-height:84vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden';
        panel.innerHTML =
            '<div style="padding:14px 18px;background:#7C3AED;color:#fff;display:flex;justify-content:space-between;align-items:center">'
          + '<span style="font-size:17px;font-weight:700">&#128100; Customer for this bill</span>'
          + '<button id="cust-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0 4px">&times;</button></div>'
          + '<div style="padding:12px 18px;border-bottom:1px solid #e0e0e0;display:flex;gap:8px;align-items:center">'
          + '<input id="cust-search" type="text" placeholder="Search name or phone…" autocomplete="off" style="flex:1;padding:11px 14px;border:1px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
          + '<a href="/apps/zenith/Contacts/Customers" target="_blank" rel="noopener" style="white-space:nowrap;padding:11px 14px;border-radius:8px;background:#ECE8FB;color:#7C3AED;border:1px solid #DCD3F2;font-weight:700;font-size:13px;text-decoration:none" title="Add a new customer in Contacts (opens a new tab)">&#43; New</a></div>'
          + '<div style="padding:8px 18px 0"><button id="cust-walkin" type="button" style="width:100%;padding:11px;border:1px dashed #bbb;background:#fafafa;border-radius:8px;font-size:14px;font-weight:700;color:#555;cursor:pointer">&#128694; Walk-In (no customer)</button></div>'
          + '<label style="display:flex;align-items:center;gap:9px;padding:10px 18px;color:#374151;font-size:13px"><input id="cust-tax-bill" type="checkbox" style="width:17px;height:17px;accent-color:#7C3AED"/> Tax bill for selected customer (3-inch receipt)</label>'
          + '<div id="cust-list" style="flex:1;overflow-y:auto;padding:10px 14px 16px"><div style="text-align:center;padding:30px;color:#999">Type a name or phone number to search your customers…</div></div>';
        ov.appendChild(panel); document.body.appendChild(ov);
        ov.addEventListener('click', function(ev) { if (ev.target === ov) closeCustomer(); });
        panel.querySelector('#cust-close').addEventListener('click', closeCustomer);
        panel.querySelector('#cust-tax-bill').checked = typeof window._posCurrentTax === 'function' && window._posCurrentTax() === 'Y';
        panel.querySelector('#cust-walkin').addEventListener('click', function() {
            var tx = getOpenTxId();
            if (!tx) { setCustChip('Walk-In'); closeCustomer(); return; }
            custPost('clearCustomer', {transactionId: tx}).then(function(d) {
                if (!d || !d.success) { histToast((d && d.error) || 'Could not clear customer', '#c62828'); return; }
                if (window._posRefreshCart) window._posRefreshCart();
                setCustChip('Walk-In'); histToast('Customer cleared — Walk-In', '#607d8b'); closeCustomer();
            });
        });
        var si = panel.querySelector('#cust-search'); var t = null;
        si.addEventListener('input', function() { clearTimeout(t); t = setTimeout(function() { loadCustList(si.value); }, 350); });
        si.focus();
        loadCustList('');
    }
    function loadCustList(term) {
        var listEl = document.getElementById('cust-list'); if (!listEl) return;
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#999">Searching…</div>';
        custPost('searchCustomers', {term: term || ''}).then(function(d) {
            if (!d || !d.success) { listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#c62828">Error loading customers</div>'; return; }
            if (!d.customers || !d.customers.length) { listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#999">No customers found. Use “+ New” to add one in Contacts.</div>'; return; }
            var h = '';
            d.customers.forEach(function(c) {
                h += '<div class="cust-row" data-pid="' + custEscape(c.partyId) + '" data-name="' + custEscape(c.name || '') + '" style="padding:12px 14px;border:1px solid #e8e8e8;border-radius:10px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px" onmouseover="this.style.background=\'#e8eaf6\'" onmouseout="this.style.background=\'#fff\'">'
                  + '<span style="font-weight:700;color:#7C3AED">' + custEscape(c.name || c.partyId) + '</span>'
                  + (c.phone ? '<span style="font-size:13px;color:#777;white-space:nowrap">' + custEscape(c.phone) + '</span>' : '')
                  + '</div>';
            });
            listEl.innerHTML = h;
            listEl.querySelectorAll('.cust-row').forEach(function(row) {
                row.addEventListener('click', function() {
                    var tx = getOpenTxId();
                    var pid = row.dataset.pid, nm = row.dataset.name;
                    var wantsTaxBill = document.getElementById('cust-tax-bill').checked;
                    if (!tx && !CTX.sessionId) { histToast('Open a session before selecting a customer', '#e65100'); return; }
                    custPost('setCustomer', {transactionId: tx, customerPartyId: pid}).then(function(d) {
                        if (d && d.success) {
                            if (wantsTaxBill && typeof window._posCurrentTax === 'function' && window._posCurrentTax() !== 'Y') {
                                closeCustomer(); enableTaxBill(d.transactionId || tx); return;
                            }
                            if (!tx && d.transactionId) {
                                var next = new URL(window.location.href);
                                next.searchParams.set('sessionId',CTX.sessionId); next.searchParams.set('transactionId',d.transactionId);
                                next.searchParams.delete('freshSale'); next.searchParams.delete('lastCompletedId');
                                window.location.assign(next.toString()); return;
                            }
                            if (window._posRefreshCart) window._posRefreshCart();
                            setCustChip(d.customer || nm); histToast('Customer: ' + (d.customer || nm), '#7C3AED'); closeCustomer();
                        }
                        else { histToast((d && d.error) || 'Could not set customer', '#c62828'); }
                    });
                });
            });
        });
    }
    window.posOpenCustomer = function() { openCustomerPicker(); };
    if (!window.__posCustDelegated) {
        window.__posCustDelegated = true;
        document.addEventListener('click', function(e) {
            var b = (e.target && e.target.closest) ? e.target.closest('#pos-customer-btn') : null;
            if (b) { e.preventDefault(); if (typeof window.posOpenCustomer === 'function') window.posOpenCustomer(); }
        });
    }

    /* === Credit Bills screen: list outstanding credit bills + settle (partial allowed) === */
    function creditFmt(n) { return Number(n||0).toFixed(2); }
    // credit-bills mockup (ZE-CBILLS): header + 4 stat cards + toolbar + card rows w/ a 3-step progress tracker
    function creditProgress(settled) {
        var G='#10B981',GT='#059669',O='#F59E0B',OT='#D97706',BD='#E5E7EB',MU='#9CA3AF',W='#fff';
        var CK='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var CL='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 8 12 12 15 14"/></svg>';
        function step(bg,brd,ic,lbl,lc){return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 auto"><div style="width:24px;height:24px;border-radius:50%;background:'+bg+';border:'+(brd?'2px solid '+brd:'none')+';box-sizing:border-box;display:flex;align-items:center;justify-content:center">'+ic+'</div><span style="font-size:11px;font-weight:600;color:'+lc+';white-space:nowrap">'+lbl+'</span></div>';}
        function conn(c){return '<div style="flex:1 1 auto;height:2px;background:'+c+';margin:0 6px;margin-top:11px"></div>';}
        var s1=step(G,null,CK,'Bill Created',GT);
        var s2=settled?step(G,null,CK,'Outstanding',GT):step(O,null,CL,'Outstanding',OT);
        var s3=settled?step(G,null,CK,'Settled',GT):step(W,BD,'','Settled',MU);
        return '<div style="display:flex;align-items:flex-start;flex:1 1 auto;max-width:360px;min-width:240px">'+s1+conn(G)+s2+conn(settled?G:BD)+s3+'</div>';
    }
    function creditStatCards(d) {
        var doc='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
        var rup='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>';
        var clk='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        var chk='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        function card(bg,ib,ac,ic,label,val,cap,vc){
            return '<div style="background:'+bg+';border:1px solid #E5E7EB;border-radius:12px;padding:18px;display:flex;gap:12px;align-items:flex-start">'
                +'<div style="width:44px;height:44px;border-radius:50%;background:'+ib+';color:'+ac+';display:flex;align-items:center;justify-content:center;flex:0 0 auto">'+ic+'</div>'
                +'<div><div style="font-size:12.5px;color:#6B7280;font-weight:500">'+label+'</div><div style="font-size:22px;font-weight:800;color:'+vc+';margin:2px 0">'+val+'</div><div style="font-size:11.5px;color:#9CA3AF">'+cap+'</div></div></div>';
        }
        return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:16px;margin-bottom:20px">'
            + card('#F5F3FF','#EDE9FE','#7C3AED',doc,'Total Credit Bills',(d.allCount||0),'All time','#7C3AED')
            + card('#ECFDF5','#D1FAE5','#059669',rup,'Total Outstanding','₹ '+creditFmt(d.outSum),(d.outCount||0)+' Bills','#059669')
            + card('#FFFBEB','#FEF3C7','#D97706',clk,'Overdue Bills',(d.overdueCount||0),'Require attention','#D97706')
            + card('#EFF6FF','#DBEAFE','#2563EB',chk,'Paid This Month','₹ '+creditFmt(d.paidMonthAmt),(d.paidMonthCount||0)+' Bills','#2563EB')
            + '</div>';
    }
    var _creditData = null, _creditSort = 'latest', _creditFilter = 'all', _creditFrom = '', _creditTo = '', _creditView = 'list', _creditPainted = [];
    var CBI = 'padding:9px 14px;font-size:13px;cursor:pointer;white-space:nowrap;color:#334155';
    function creditCloseMenus(){ document.querySelectorAll('.cb-menu').forEach(function(m){ m.style.display='none'; }); }
    function creditDateText(value) {
        if (!value) return '';
        var date = new Date(value + 'T00:00:00');
        return isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'short', year:'numeric'}).format(date);
    }
    function creditDateLabel() {
        if (_creditFrom && _creditTo) return creditDateText(_creditFrom) + ' – ' + creditDateText(_creditTo);
        if (_creditFrom) return 'From ' + creditDateText(_creditFrom);
        if (_creditTo) return 'Until ' + creditDateText(_creditTo);
        return 'All dates';
    }
    function creditFilterBills(){
        var a = (_creditData && _creditData.bills || []).slice();

        a = a.filter(function(b){
            var out = Number(b.outstanding||0);
            if (_creditFilter==='outstanding' && !(out>0.0001)) return false;
            if (_creditFilter==='settled' && out>0.0001) return false;
            if (_creditFilter==='overdue' && b.creditStatus!=='Overdue') return false;
            if (_creditFrom) { var f=new Date(_creditFrom+'T00:00:00').getTime(); if ((b.ts||0)<f) return false; }
            if (_creditTo) { var t=new Date(_creditTo+'T23:59:59').getTime(); if ((b.ts||0)>t) return false; }
            return true;
        });
        if (_creditSort==='overdue') a.sort(function(x,y){
            var xo=Number(x.outstanding||0)>0.0001 && (x.ts||0)<cut, yo=Number(y.outstanding||0)>0.0001 && (y.ts||0)<cut;
            return Number(yo)-Number(xo) || (y.ts||0)-(x.ts||0);
        });
        else if (_creditSort==='oldest') a.sort(function(x,y){return (x.ts||0)-(y.ts||0);});
        else if (_creditSort==='high') a.sort(function(x,y){return (y.outstanding||0)-(x.outstanding||0);});
        else if (_creditSort==='low') a.sort(function(x,y){return (x.outstanding||0)-(y.outstanding||0);});
        else a.sort(function(x,y){return (y.ts||0)-(x.ts||0);});
        return a;
    }
    function creditExportCsv(){
        var bills = creditFilterBills();
        var esc = function(v){ v=(v==null?'':''+v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
        var lines = ['Bill No,Date,Customer,Phone,Items,Total,Paid,Outstanding'];
        bills.forEach(function(b){ lines.push([esc(b.billNo),esc(b.date),esc(b.customer),esc(b.phone),b.itemCount,creditFmt(b.grand),creditFmt(b.paid),creditFmt(b.outstanding)].join(',')); });
        try { var blob=new Blob([lines.join('\n')],{type:'text/csv'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='CreditBills_'+new Date().toISOString().slice(0,10)+'.csv'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },100); } catch(_e){}
    }
    function creditRowKebab(i){
        return '<div style="position:relative;flex:0 0 auto">'
            + '<button class="cb-kebab" data-i="'+i+'" style="width:32px;height:32px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#9CA3AF;font-size:18px;line-height:1">&#8942;</button>'
            + '<div class="cb-menu" style="display:none;position:absolute;right:0;top:36px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 6px 20px rgba(17,24,39,.12);z-index:50;overflow:hidden;min-width:160px">'
            +   '<div class="cb-item" data-i="'+i+'" data-act="view" style="'+CBI+'">View / Edit Bill</div>'
            +   '<div class="cb-item" data-i="'+i+'" data-act="print" style="'+CBI+'">Print Receipt</div>'
            +   '<div class="cb-item" data-i="'+i+'" data-act="copy" style="'+CBI+'">Copy Bill No.</div>'
            +   '<div style="height:1px;background:#F1F5F9"></div>'
            +   '<div class="cb-item" data-i="'+i+'" data-act="cancel" style="'+CBI+';color:#DC2626">Cancel Bill</div>'
            + '</div></div>';
    }
    function creditPaintList(){
        var safeCredit=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
        var host = document.getElementById('credit-list-host'); if (!host || !_creditData) return;
        var bills = creditFilterBills(); _creditPainted = bills;
        var cnt = document.getElementById('credit-count'); if (cnt) cnt.textContent = 'Showing '+bills.length+' of '+(_creditData.allCount||0)+' credit bills';
        if (bills.length === 0) { host.innerHTML = '<div style="text-align:center;padding:50px;color:#9CA3AF">No credit bills match the filters</div>'; return; }
        var compact = (_creditView === 'compact');
        var h = '';
        bills.forEach(function(b, i){
            var settled = (Number(b.outstanding||0) <= 0.0001);
            var settleCtl = settled
                ? '<span style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;background:#ECFDF5;color:#059669;border-radius:8px;font-size:13px;font-weight:600;flex:0 0 auto">Settled</span>'
                : '<button class="credit-settle-btn" data-tx="'+b.txId+'" style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex:0 0 auto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> Settle Payment</button>';
            h += '<div style="display:flex;align-items:center;gap:'+(compact?'14px':'20px')+';flex-wrap:wrap;padding:'+(compact?'12px 20px':'18px 20px')+';'+(i<bills.length-1?'border-bottom:1px solid #F1F5F9':'')+'">'
                + '<div style="width:'+(compact?'32px;height:32px':'40px;height:40px')+';border-radius:50%;background:#EDE9FE;color:#7C3AED;display:flex;align-items:center;justify-content:center;flex:0 0 auto"><svg width="'+(compact?'16':'18')+'" height="'+(compact?'16':'18')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></div>'
                + '<div style="display:flex;flex-direction:column;gap:3px;min-width:200px;flex:1 1 auto">'
                +   '<span style="font-size:14px;font-weight:600;color:#7C3AED">#'+safeCredit(b.billNo)+'</span>'
                +   '<span style="font-size:12px;color:#6B7280">'+safeCredit(b.date)+'</span>'
                +   '<span style="font-size:12px;color:#6B7280">Due: '+(b.dueDate||'Not set')+' · '+(b.creditStatus||'')+'</span>'
                +   '<span style="font-size:12px;color:#6B7280">Last payment: '+(b.lastPayment||'None')+(b.settledOn?' · Settled on '+b.settledOn:'')+'</span>'
                +   '<span style="font-size:12px;color:#6B7280">'+safeCredit(b.customer)+(b.phone?' • '+safeCredit(b.phone):'')+' • '+b.itemCount+' item'+(b.itemCount!==1?'s':'')+'</span>'
                + '</div>'
                + (compact ? '' : creditProgress(settled))
                + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:120px;text-align:right;flex:0 0 auto">'
                +   '<span style="font-size:11.5px;color:#6B7280">Due Amount</span>'
                +   '<span style="font-size:18px;font-weight:800;color:'+(settled?'#059669':'#DC2626')+'">₹'+creditFmt(b.outstanding)+'</span>'
                +   '<span style="font-size:11.5px;color:#9CA3AF">Total ₹'+creditFmt(b.grand)+' • Paid ₹'+creditFmt(b.paid)+'</span>'
                + '</div>'
                + settleCtl
                + '<button type="button" class="credit-history-btn" data-tx="'+b.txId+'" style="padding:8px 12px;border:1px solid #ddd6fe;border-radius:8px;background:#f5f3ff;color:#6d28d9;cursor:pointer">Repayment history</button>'
                + creditRowKebab(i)
                + '</div>';
        });
        host.innerHTML = h;
        host.querySelectorAll('.credit-history-btn').forEach(function(button){button.addEventListener('click',function(){if(window.ZPosCreditHistory)window.ZPosCreditHistory.open(button.dataset.tx);});});
        host.querySelectorAll('.credit-settle-btn').forEach(function(btn){
            btn.addEventListener('click', function(e){ e.stopPropagation(); var bill=(_creditData.bills||[]).find(function(x){return x.txId===btn.dataset.tx;}); if (bill) openSettleOverlay(bill); });
        });
        host.querySelectorAll('.cb-kebab').forEach(function(btn){
            btn.addEventListener('click', function(e){ e.stopPropagation(); var m=btn.nextElementSibling; var open=(m.style.display==='block'); creditCloseMenus(); m.style.display=open?'none':'block'; });
        });
        host.querySelectorAll('.cb-item').forEach(function(it){
            it.addEventListener('click', function(e){ e.stopPropagation(); creditCloseMenus();
                var b=_creditPainted[+it.dataset.i]; if(!b) return; var act=it.dataset.act;
                var et='/apps/zenith/pos/EditTransaction?transactionId='+encodeURIComponent(b.txId);
                if (act==='view' || act==='cancel') location.href=et;
                else if (act==='print') window.open('/fop/apps/zenith/pos/ReceiptPdf?transactionId='+encodeURIComponent(b.txId),'_blank');
                else if (act==='copy') { try { navigator.clipboard.writeText(''+b.billNo); } catch(_e){} }
            });
        });
    }
    function renderCreditBills(search) {
        var root = document.getElementById('credit-bills-root');
        if (!root) return;
        if (!window.__cbDocClose) { window.__cbDocClose = true; document.addEventListener('click', creditCloseMenus); }
        root.innerHTML = '<div style="text-align:center;padding:40px;color:#999">Loading credit bills…</div>';
        historyPost({action:'creditBills', search: search||''}).then(function(d) {
            if (!d || !d.success) { root.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828">Error loading credit bills</div>'; return; }
            _creditData = d;
            var listSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>';
            var funnel = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
            var vActive = (_creditView==='compact');
            var searchIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
            var calendarIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>';
            var chevronIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
            var h = '<div style="font-family:Inter,Segoe UI,Arial,sans-serif">'
                + '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px">'
                +   '<div><h1 style="font-size:22px;line-height:1.3;font-weight:700;color:#20213A;margin:0 0 5px">Credit Bills</h1><div style="font-size:13px;color:#6B7280">Track and manage all credit bills and outstanding dues</div></div>'
                +   '<div style="display:flex;gap:10px;align-items:center">'
                +     '<a href="/apps/zenith/pos/Terminal" style="display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;background:#7C3AED;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">+ New Credit Bill</a>'
                +     '<div style="position:relative"><button id="credit-hdr-kebab" style="width:40px;height:40px;border:1px solid #7C3AED;border-radius:8px;background:#fff;color:#7C3AED;cursor:pointer;font-size:18px;line-height:1">&#8942;</button>'
                +       '<div class="cb-menu" style="display:none;position:absolute;right:0;top:44px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 6px 20px rgba(17,24,39,.12);z-index:50;overflow:hidden;min-width:150px">'
                +         '<div class="cb-hdr-item" data-act="export" style="'+CBI+'">Export CSV</div>'
                +         '<div class="cb-hdr-item" data-act="refresh" style="'+CBI+'">Refresh</div>'
                +       '</div></div>'
                +   '</div>'
                + '</div>'
                + creditStatCards(d)
                + '<div class="cb-toolbar">'
                +   '<div class="cb-search">'+searchIcon+'<input id="credit-search" type="search" aria-label="Search credit bills" placeholder="Search by bill no, customer or phone..." value="'+(search||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')+'"/></div>'
                +   '<div class="cb-date"><button id="credit-date-btn" type="button" aria-haspopup="true" aria-expanded="false">'+calendarIcon+'<span id="credit-date-label">'+creditDateLabel()+'</span>'+chevronIcon+'</button>'
                +     '<div id="credit-date-pop" class="cb-date-pop" hidden><label for="credit-from">From<input id="credit-from" type="date" value="'+_creditFrom+'"/></label><label for="credit-to">To<input id="credit-to" type="date" value="'+_creditTo+'"/></label><button id="credit-date-clear" type="button">Clear dates</button></div></div>'
                +   '<div class="cb-filter-wrap"><button id="credit-filter-btn" type="button" class="cb-filter-btn" style="border-color:'+(_creditFilter!=='all'?'var(--z-primary)':'var(--z-border)')+';color:'+(_creditFilter!=='all'?'var(--z-primary)':'var(--z-text-muted)')+'">'+funnel+' Filter'+(_creditFilter!=='all'?' •':'')+'</button>'
                +     '<div class="cb-menu" style="display:none;position:absolute;left:0;top:44px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 6px 20px rgba(17,24,39,.12);z-index:50;overflow:hidden;min-width:150px">'
                +       '<div class="cb-filter" data-f="all" style="'+CBI+'">All Bills</div><div class="cb-filter" data-f="outstanding" style="'+CBI+'">Outstanding</div><div class="cb-filter" data-f="overdue" style="'+CBI+'">Overdue</div><div class="cb-filter" data-f="settled" style="'+CBI+'">Settled</div>'
                +     '</div></div>'
                +   '<label class="cb-sort">Sort by: <select id="credit-sort" aria-label="Sort credit bills"><option value="latest">Latest First</option><option value="oldest">Oldest First</option><option value="high">Highest Amount</option><option value="low">Lowest Amount</option><option value="overdue">Overdue First</option></select>'+chevronIcon+'</label>'
                +   '<button id="credit-view-btn" type="button" title="Toggle compact view" class="cb-view-btn" style="background:'+(vActive?'var(--z-primary-light)':'var(--z-bg-card)')+';color:'+(vActive?'var(--z-primary)':'var(--z-text-muted)')+'">'+listSvg+'</button>'
                + '</div>'
                + '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:16px"><div id="credit-list-host"></div></div>'
                + '<div id="credit-count" style="font-size:12.5px;color:#6B7280"></div>'
                + '</div>';
            root.innerHTML = h;
            var sel = document.getElementById('credit-sort'); if (sel) { sel.value = _creditSort; sel.addEventListener('change', function(){ _creditSort = sel.value; creditPaintList(); }); }
            var si = document.getElementById('credit-search');
            if (si) { var t=null; si.addEventListener('input', function(){ clearTimeout(t); t=setTimeout(function(){ renderCreditBills(si.value); }, 400); }); }
            function updateCreditDates(){ var label=document.getElementById('credit-date-label'); if(label) label.textContent=creditDateLabel(); creditPaintList(); }
            var cf = document.getElementById('credit-from'); if (cf) cf.addEventListener('change', function(){ _creditFrom=cf.value; updateCreditDates(); });
            var ct = document.getElementById('credit-to'); if (ct) ct.addEventListener('change', function(){ _creditTo=ct.value; updateCreditDates(); });
            var dc = document.getElementById('credit-date-clear'); if (dc) dc.addEventListener('click', function(){ _creditFrom=''; _creditTo=''; cf.value=''; ct.value=''; updateCreditDates(); });
            var db = document.getElementById('credit-date-btn'); if (db) db.addEventListener('click', function(){ var pop=document.getElementById('credit-date-pop'); pop.hidden=!pop.hidden; db.setAttribute('aria-expanded',String(!pop.hidden)); });
            if (!window.__cbDateClose) { window.__cbDateClose=true; document.addEventListener('click',function(e){ if(e.target.closest && e.target.closest('.cb-date')) return; var pop=document.getElementById('credit-date-pop'), btn=document.getElementById('credit-date-btn'); if(pop) pop.hidden=true; if(btn) btn.setAttribute('aria-expanded','false'); }); }
            var vb = document.getElementById('credit-view-btn'); if (vb) vb.addEventListener('click', function(){ _creditView=(_creditView==='list'?'compact':'list'); var on=(_creditView==='compact'); vb.style.background=on?'#F5F3FF':'#fff'; vb.style.color=on?'#7C3AED':'#6B7280'; creditPaintList(); });
            var fb = document.getElementById('credit-filter-btn'); if (fb) fb.addEventListener('click', function(e){ e.stopPropagation(); var m=fb.nextElementSibling; var open=(m.style.display==='block'); creditCloseMenus(); m.style.display=open?'none':'block'; });
            root.querySelectorAll('.cb-filter').forEach(function(it){ it.addEventListener('click', function(e){ e.stopPropagation(); _creditFilter=it.dataset.f; creditCloseMenus(); var on=(_creditFilter!=='all'); if (fb){ fb.style.borderColor=on?'var(--z-primary)':'var(--z-border)'; fb.style.color=on?'var(--z-primary)':'var(--z-text-muted)'; fb.innerHTML=funnel+' Filter'+(on?' •':''); } creditPaintList(); }); });
            var hk = document.getElementById('credit-hdr-kebab'); if (hk) hk.addEventListener('click', function(e){ e.stopPropagation(); var m=hk.nextElementSibling; var open=(m.style.display==='block'); creditCloseMenus(); m.style.display=open?'none':'block'; });
            root.querySelectorAll('.cb-hdr-item').forEach(function(it){ it.addEventListener('click', function(e){ e.stopPropagation(); creditCloseMenus(); if (it.dataset.act==='export') creditExportCsv(); else renderCreditBills(si?si.value:(search||'')); }); });
            creditPaintList();
        }).catch(function(){
            // Never leave the page silently stuck on "Loading…" if the fetch/JSON fails (ZE-POS-002).
            if (root) root.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828">Could not load credit bills — please refresh the page.</div>';
        });
    }
    function openSettleOverlay(bill) {
        var outstanding = Number(bill.outstanding) || 0;
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
        var tabBtn = 'flex:1;padding:10px;border:none;font-weight:700;font-size:14px;cursor:pointer';
        ov.innerHTML = '<div style="background:#fff;border-radius:16px;width:440px;max-width:92vw;max-height:92vh;overflow:auto;box-shadow:0 12px 48px rgba(0,0,0,0.3)">'
            + '<div style="padding:18px 20px;background:#2e7d32;color:#fff;text-align:center;font-size:17px;font-weight:700">Settle Credit — #'+bill.billNo+'</div>'
            + '<div style="padding:20px 24px">'
            + '<div style="font-size:13px;color:#555;margin-bottom:6px">'+bill.customer+(bill.phone?' · '+bill.phone:'')+'</div>'
            + '<div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:14px"><span>Outstanding</span><span style="font-weight:800;color:#c62828">₹'+creditFmt(outstanding)+'</span></div>'
            // mode toggle
            + '<div style="display:flex;border:2px solid #2e7d32;border-radius:10px;overflow:hidden;margin-bottom:16px">'
            + '<button type="button" id="mode-single" style="'+tabBtn+';background:#2e7d32;color:#fff">Single Method</button>'
            + '<button type="button" id="mode-split" style="'+tabBtn+';background:#fff;color:#2e7d32">Split Payment</button></div>'
            // ----- SINGLE -----
            + '<div id="settle-single">'
            + '<label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Payment Method</label>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
            + '<button type="button" class="sm-opt" data-m="Cash" style="padding:12px;border:2px solid #4caf50;border-radius:8px;background:#4caf50;color:#fff;font-weight:700;cursor:pointer">Cash</button>'
            + '<button type="button" class="sm-opt" data-m="Card" style="padding:12px;border:2px solid #ccc;border-radius:8px;background:#fff;color:#333;font-weight:700;cursor:pointer">Card</button>'
            + '<button type="button" class="sm-opt" data-m="UPI" style="padding:12px;border:2px solid #ccc;border-radius:8px;background:#fff;color:#333;font-weight:700;cursor:pointer">UPI</button></div>'
            + '<label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Amount Received</label>'
            + '<input id="settle-amt" type="number" step="0.01" value="'+creditFmt(outstanding)+'" style="width:100%;padding:12px 14px;border:2px solid #2e7d32;border-radius:8px;font-size:18px;font-weight:700;text-align:center;box-sizing:border-box;outline:none"/>'
            + '<div style="font-size:11px;color:#999;margin-top:6px;text-align:center">Enter less than outstanding for a partial payment</div>'
            + '</div>'
            // ----- SPLIT -----
            + '<div id="settle-split" style="display:none">'
            + '<div style="font-size:12px;color:#666;margin-bottom:10px">Enter how much is paid by each method (any combination).</div>'
            + splitRow('Cash', '#4caf50') + splitRow('Card', '#2196f3') + splitRow('UPI', '#9c27b0')
            + '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-top:10px;padding-top:8px;border-top:1px solid #eee">'
            + '<span>Entered</span><span id="split-entered">₹0.00</span></div>'
            + '<div id="split-remaining" style="display:flex;justify-content:space-between;font-size:13px;color:#777;margin-top:4px"><span>Remaining</span><span>₹'+creditFmt(outstanding)+'</span></div>'
            + '</div>'
            + '<div style="display:flex;gap:12px;margin-top:18px">'
            + '<button id="settle-cancel" style="flex:1;padding:14px;border:2px solid #ccc;border-radius:10px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button>'
            + '<button id="settle-confirm" style="flex:1;padding:14px;border:none;border-radius:10px;font-weight:700;cursor:pointer;background:#2e7d32;color:#fff">Confirm Payment</button></div>'
            + '</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });

        var mode = 'single';
        var method = 'Cash';
        var singleEl = document.getElementById('settle-single');
        var splitEl = document.getElementById('settle-split');
        var mSingle = document.getElementById('mode-single');
        var mSplit = document.getElementById('mode-split');
        function setMode(m) {
            mode = m;
            var on = (m === 'split');
            splitEl.style.display = on ? 'block' : 'none';
            singleEl.style.display = on ? 'none' : 'block';
            mSplit.style.background = on ? '#2e7d32' : '#fff'; mSplit.style.color = on ? '#fff' : '#2e7d32';
            mSingle.style.background = on ? '#fff' : '#2e7d32'; mSingle.style.color = on ? '#2e7d32' : '#fff';
        }
        mSingle.addEventListener('click', function(){ setMode('single'); });
        mSplit.addEventListener('click', function(){ setMode('split'); });

        ov.querySelectorAll('.sm-opt').forEach(function(o){
            o.addEventListener('click', function(){
                method = o.dataset.m;
                ov.querySelectorAll('.sm-opt').forEach(function(x){ x.style.background='#fff'; x.style.color='#333'; x.style.borderColor='#ccc'; });
                var c = method==='Cash' ? '#4caf50' : (method==='Card' ? '#2196f3' : '#9c27b0');
                o.style.background=c; o.style.color='#fff'; o.style.borderColor=c;
            });
        });

        function splitInputs() { return { Cash: Number((document.getElementById('split-Cash')||{}).value || 0), Card: Number((document.getElementById('split-Card')||{}).value || 0), UPI: Number((document.getElementById('split-UPI')||{}).value || 0) }; }
        function refreshSplit() {
            var s = splitInputs();
            var ent = s.Cash + s.Card + s.UPI;
            var rem = outstanding - ent;
            document.getElementById('split-entered').textContent = '₹' + creditFmt(ent);
            var remEl = document.getElementById('split-remaining');
            remEl.innerHTML = '<span>Remaining</span><span style="font-weight:700;color:'+(Math.abs(rem)<0.005?'#2e7d32':(rem<0?'#c62828':'#e65100'))+'">₹'+creditFmt(rem)+(rem<0?' (over)':'')+'</span>';
        }
        ov.querySelectorAll('.split-inp').forEach(function(i){ i.addEventListener('input', refreshSplit); });

        document.getElementById('settle-cancel').addEventListener('click', function(){ ov.remove(); });
        document.getElementById('settle-confirm').addEventListener('click', function(){
            var btn = document.getElementById('settle-confirm');
            var pays = [];
            if (mode === 'single') {
                var amt = Number(document.getElementById('settle-amt').value || 0);
                if (amt <= 0) { histToast('Enter a valid amount', '#e53935'); return; }
                pays.push({ method: method, amount: amt });
            } else {
                var s = splitInputs();
                ['Cash','Card','UPI'].forEach(function(m){ if (s[m] > 0) pays.push({ method: m, amount: s[m] }); });
                if (pays.length === 0) { histToast('Enter at least one amount', '#e53935'); return; }
            }
            var total = pays.reduce(function(a,p){ return a + p.amount; }, 0);
            if (total > outstanding + 0.001) { histToast('Total exceeds outstanding ₹'+creditFmt(outstanding), '#e53935'); return; }
            btn.disabled = true; btn.textContent = 'Processing…';
            // Record each payment sequentially; the service clears credit when fully paid
            var chain = Promise.resolve(null);
            pays.forEach(function(p){
                chain = chain.then(function(prev){
                    if (prev && prev.error) return prev; // stop on first error
                    return historyPost({action:'settleCredit', settleTxId:bill.txId, settleMethod:p.method, settleAmount:String(p.amount)});
                });
            });
            chain.then(function(last){
                if (last && last.success) {
                    ov.remove();
                    if (last.fullyPaid) histToast('✔ Bill fully settled', '#2e7d32');
                    else histToast('✔ Payment recorded — ₹'+creditFmt(last.outstanding)+' remaining', '#e65100');
                    var si = document.getElementById('credit-search');
                    renderCreditBills(si ? si.value : '');
                } else { histToast((last && last.error) || 'Error settling', '#e53935'); btn.disabled = false; btn.textContent = 'Confirm Payment'; }
            });
        });
    }
    function splitRow(label, color) {
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
            + '<span style="width:48px;font-size:13px;font-weight:700;color:'+color+'">'+label+'</span>'
            + '<input id="split-'+label+'" class="split-inp" type="number" step="0.01" placeholder="0.00" style="flex:1;padding:10px 12px;border:2px solid '+color+';border-radius:8px;font-size:15px;font-weight:600;text-align:right;box-sizing:border-box;outline:none"/></div>';
    }
    // Auto-render whenever the Credit Bills screen is shown (poll persists across SPA navigation)
    setInterval(function(){
        var root = document.getElementById('credit-bills-root');
        if (root && !root.dataset.rendered) { root.dataset.rendered = '1'; renderCreditBills(''); }
    }, 700);
})();

/* === Fullscreen Toggle === */
window._pfs = window._pfs || {saved: [], active: false};
window.posPayCash = function(form) {
    if (form.dataset.posPaymentConfirmed === '1') return true;
    // Cash tender modal: quick denomination buttons + editable amount + live change.
    // Defensive: any script error must NOT block checkout -> fall through to a normal exact-amount submit.
    try {
        var f = form.querySelector('input[name="amount"]');
        var due = parseFloat(f ? f.value : '0') || 0;
        if (due <= 0) { return true; }
        var old = document.getElementById('posCashTenderOverlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var denoms = [10, 20, 50, 100, 200, 500, 2000];
        var ov = document.createElement('div');
        ov.id = 'posCashTenderOverlay';
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:12px';
        var denomBtns = denoms.map(function(d) {
            return '<button type="button" data-deno="' + d + '" class="posCashDeno" style="padding:14px 4px;font-size:16px;font-weight:700;border:2px solid #4caf50;background:#e8f5e9;color:#2e7d32;border-radius:10px;cursor:pointer">+' + d + '</button>';
        }).join('');
        ov.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:430px;width:100%;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-family:inherit">'
            + '<div style="font-size:18px;font-weight:800;color:#222;margin-bottom:12px">&#128176; Cash Payment</div>'
            + '<div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:8px"><span style="color:#666">Amount due</span><b style="color:#222">&#8377; ' + due.toFixed(2) + '</b></div>'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="color:#666;font-size:15px;min-width:62px">Received</span>'
            + '<input id="posCashRecv" type="number" step="any" min="0" value="' + due.toFixed(2) + '" style="flex:1;padding:12px;font-size:22px;font-weight:800;text-align:right;border:2px solid #4caf50;border-radius:10px;outline:none"/></div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px">' + denomBtns
            + '<button type="button" id="posCashExact" style="padding:14px 4px;font-size:13px;font-weight:700;border:2px solid #7C3AED;background:#ECE8FB;color:#7C3AED;border-radius:10px;cursor:pointer">Exact</button>'
            + '<button type="button" id="posCashClear" style="padding:14px 4px;font-size:13px;font-weight:700;border:2px solid #c62828;background:#ffebee;color:#c62828;border-radius:10px;cursor:pointer">Clear</button></div>'
            + '<div id="posCashChange" style="text-align:center;font-size:18px;font-weight:800;padding:11px;border-radius:10px;margin-bottom:14px"></div>'
            + '<div style="display:flex;gap:10px"><button type="button" id="posCashCancel" style="flex:1;padding:14px;font-size:15px;font-weight:700;border:1px solid #bbb;background:#f5f5f5;color:#444;border-radius:10px;cursor:pointer">Cancel</button>'
            + '<button type="button" id="posCashConfirm" style="flex:2;padding:14px;font-size:16px;font-weight:800;border:none;background:#4caf50;color:#fff;border-radius:10px;cursor:pointer">Confirm &amp; Complete</button></div>'
            + '</div>';
        document.body.appendChild(ov);
        var recvInp = ov.querySelector('#posCashRecv');
        var changeEl = ov.querySelector('#posCashChange');
        var confirmBtn = ov.querySelector('#posCashConfirm');
        function refresh() {
            var r = parseFloat(recvInp.value) || 0;
            if (r < due) {
                changeEl.style.background = '#ffebee'; changeEl.style.color = '#b71c1c';
                changeEl.textContent = 'Short by ₹' + (due - r).toFixed(2);
                confirmBtn.disabled = true; confirmBtn.style.opacity = '0.45'; confirmBtn.style.cursor = 'not-allowed';
            } else {
                changeEl.style.background = '#e8f5e9'; changeEl.style.color = '#1b5e20';
                changeEl.textContent = 'Change to return: ₹' + (r - due).toFixed(2);
                confirmBtn.disabled = false; confirmBtn.style.opacity = '1'; confirmBtn.style.cursor = 'pointer';
            }
        }
        var denoEls = ov.querySelectorAll('.posCashDeno');
        for (var i = 0; i < denoEls.length; i++) {
            denoEls[i].addEventListener('click', function() {
                var cur = parseFloat(recvInp.value) || 0;
                recvInp.value = (cur + parseFloat(this.getAttribute('data-deno'))).toFixed(2);
                refresh();
            });
        }
        ov.querySelector('#posCashExact').addEventListener('click', function() { recvInp.value = due.toFixed(2); refresh(); });
        ov.querySelector('#posCashClear').addEventListener('click', function() { recvInp.value = '0'; refresh(); recvInp.focus(); });
        recvInp.addEventListener('input', refresh);
        function closeOv() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        var confirmed = false;
        function doConfirm() {
            var r = parseFloat(recvInp.value) || 0;
            if (confirmed || r < due) { return; }
            confirmed = true;
            if (f) f.value = r.toFixed(2);
            closeOv();
            form.dataset.posPaymentConfirmed = '1';
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
        }
        ov.querySelector('#posCashCancel').addEventListener('click', closeOv);
        confirmBtn.addEventListener('click', doConfirm);
        ov.addEventListener('click', function(e) { if (e.target === ov) closeOv(); });
        recvInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
            else if (e.key === 'Escape') { closeOv(); }
        });
        refresh();
        setTimeout(function() { try { recvInp.focus(); recvInp.select(); } catch (e) {} }, 50);
        return false;
    } catch (e) { return true; }
};

window.posPayDigital = function(form) {
    if (form.dataset.posPaymentConfirmed === '1') return true;
    // Card / UPI confirmation gate. Unlike Cash, these forms submit (and mint the
    // bill) the instant the button is tapped, so a mis-tap or a declined/cancelled
    // payment would still complete the sale. Require the cashier to confirm the
    // payment actually went through first; Cancel aborts with no bill created.
    // Defensive: any error falls through to a normal submit (never blocks checkout).
    try {
        var amtI = form.querySelector('input[name="amount"]');
        var due = parseFloat(amtI ? amtI.value : '0') || 0;
        var methodI = form.querySelector('input[name="paymentMethod"]');
        var method = methodI ? methodI.value : 'Card';
        var isUpi = (method === 'UPI');
        var icon = isUpi ? '&#128241;' : '&#128179;';
        var label = isUpi ? 'UPI Payment' : 'Card Payment';
        var where = isUpi ? 'UPI / QR app' : 'card machine';
        var accent = isUpi ? '#9c27b0' : '#2196f3';
        var old = document.getElementById('posPayConfirmOverlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var ov = document.createElement('div');
        ov.id = 'posPayConfirmOverlay';
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:12px';
        ov.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-family:inherit">'
            + '<div style="font-size:18px;font-weight:800;color:#222;margin-bottom:14px">' + icon + ' ' + label + '</div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-bottom:6px"><span style="color:#666">Amount</span><b style="color:#222;font-size:24px">&#8377; ' + due.toFixed(2) + '</b></div>'
            + '<div style="font-size:14px;color:#5d4037;line-height:1.6;margin:12px 0 18px;padding:11px 13px;background:#fff8e1;border:1px solid #ffe082;border-radius:9px">Take the payment on the <b>' + where + '</b> first. Press <b>Confirm</b> only after it shows <b>approved</b>. If it failed or you tapped by mistake, press <b>Cancel</b> &mdash; no bill is created.</div>'
            + '<div style="display:flex;gap:10px"><button type="button" id="posPayConfCancel" style="flex:1;padding:14px;font-size:15px;font-weight:700;border:1px solid #bbb;background:#f5f5f5;color:#444;border-radius:10px;cursor:pointer">Cancel</button>'
            + '<button type="button" id="posPayConfOk" style="flex:2;padding:14px;font-size:16px;font-weight:800;border:none;background:' + accent + ';color:#fff;border-radius:10px;cursor:pointer">Confirm Payment Received</button></div>'
            + '</div>';
        document.body.appendChild(ov);
        function closeOv() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        var okBtn = ov.querySelector('#posPayConfOk');
        var doneOnce = false;
        function doConfirm() {
            if (doneOnce) return;
            doneOnce = true; closeOv();
            form.dataset.posPaymentConfirmed = '1';
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
        }
        ov.querySelector('#posPayConfCancel').addEventListener('click', closeOv);
        okBtn.addEventListener('click', doConfirm);
        ov.addEventListener('click', function(e) { if (e.target === ov) closeOv(); });
        ov.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
            else if (e.key === 'Escape') { e.preventDefault(); closeOv(); }
        });
        setTimeout(function() { try { okBtn.focus(); } catch (e) {} }, 50);
        return false;
    } catch (e) { return true; }
};

(function () {
    // POS keyboard shortcuts (hands-free billing). Bind once. F-keys work even while typing in the
    // scan/search box; '/' (focus scan) only fires when not already typing. The cash modal handles its
    // own keys, so shortcuts are paused while it is open.
    if (window.__posKeysBound) { return; }
    window.__posKeysBound = true;
    document.addEventListener('keydown', function (e) {
        if (document.getElementById('pos-free-approval') || document.getElementById('posCashTenderOverlay') || document.getElementById('posPayConfirmOverlay')) { return; }
        var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        var typing = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
        function clk(id) { var el = document.getElementById(id); if (el) { e.preventDefault(); el.click(); } }
        if (document.querySelector('.pos-checkout-reference')) {
            if (document.querySelector('[role="dialog"],#pos-history-overlay,#posCustomerOverlay,#posCreditOverlay,#posCloseSessionOverlay,.pos-split-panel,.pos-cash-panel')) return;
            var keys = {F1:'pos-discount',F2:'pos-pay-cash',F3:'pos-pay-card',F4:'pos-credit',F5:'pos-pay-upi',F6:'pos-split',F7:'pos-hold',F8:'pos-void',F10:'pos-history-btn'};
            if (keys[e.key]) { e.preventDefault(); clk(keys[e.key]); return; }
            if (e.key === 'F9') { e.preventDefault(); var held=document.querySelector('#pos-held-wrap summary,#pos-held-wrap button'); if (held) held.click(); return; }
            // The reference layout's search drawer owns '/'.
            if (e.key === '/') return;
        }
        switch (e.key) {
            case 'F1': e.preventDefault(); clk('pos-pay-cash'); break;
            case 'F2': e.preventDefault(); clk('pos-pay-card'); break;
            case 'F3': e.preventDefault(); clk('pos-pay-upi'); break;
            case 'F4': e.preventDefault(); clk('pos-split'); break;
            case 'F5': e.preventDefault(); clk('pos-recall'); break;
            case 'F6': e.preventDefault(); clk('pos-credit'); break;
            case 'F7': e.preventDefault(); clk('pos-hold'); break;
            case 'F8': e.preventDefault(); clk('pos-void'); break;
            case 'F9': e.preventDefault(); var h = document.getElementById('pos-history-btn') || document.getElementById('pos-history-btn-ns'); if (h) h.click(); break;
            case 'F10': e.preventDefault(); var n = document.querySelector('a[href*="freshSale"]'); if (n) n.click(); break;
            case '/': if (!typing) { e.preventDefault(); var s = document.getElementById('cartInlineSearch') || document.getElementById('pos-search'); if (s) { s.focus(); if (s.select) s.select(); } } break;
            default: break;
        }
    });
})();
(function () {
    // Whole-terminal SPATIAL arrow navigation + fast cart editing + sales-mode shortcuts.
    //  - Arrow keys move a highlight to the nearest control in that direction across the whole
    //    terminal (categories <-> products <-> cart lines <-> pay buttons <-> sales-mode <-> search).
    //  - Tab jumps to the CART; Shift+Tab to Products.
    //  - On a cart line: type 0-9 = quantity (Enter applies), Enter/R = edit rate, +/- nudge qty,
    //    Del remove, and M = cycle THIS line's sales mode (the inline .aj-mode dropdown).
    //  - Anywhere else: M = cycle the GLOBAL sales mode (the header mode chips).
    //  - Enter activates the highlighted control (add product / open category / press pay button /
    //    switch sales mode / focus search).
    // Pure .click()/change on the SAME controls a finger would use; DOM re-queried each keystroke;
    // ignored while the cash modal is open or while typing in an input/textarea/select.
    if (window.__posArrowNav) { return; }
    window.__posArrowNav = true;

    var BLUE = '#7C3AED', YELLOW = '#ffeb3b';
    var cur = null;       // { el, type, seq }
    var qtyBuf = '';
    var hintT = null;

    var SELS = [
        ['.pos-cat-strip a', 'cat'],
        ['.pos-header a[href*="changeSalesMode"]', 'mode'],
        ['.pos-product-grid button[type="submit"]', 'prod'],
        ['#pos-pay-cash', 'btn'], ['#pos-pay-card', 'btn'], ['#pos-pay-upi', 'btn'],
        ['#pos-split', 'btn'], ['#pos-credit', 'btn'], ['#pos-hold', 'btn'],
        ['#pos-void', 'btn'], ['#pos-recall', 'btn'],
        ['#pos-history-btn', 'btn'], ['#pos-history-btn-ns', 'btn'],
        ['#cartInlineSearch', 'search']
    ];

    function visible(el) { return !!(el && el.offsetParent !== null && el.getClientRects().length); }
    function seqOf(tr) { var b = tr.querySelector('.aj-q'); return b ? b.getAttribute('data-seq') : null; }

    function collect() {
        var out = [];
        SELS.forEach(function (pair) {
            Array.prototype.forEach.call(document.querySelectorAll(pair[0]), function (el) {
                if (visible(el)) out.push({ el: el, type: pair[1] });
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.pos-cart tbody tr'), function (tr) {
            if (tr.querySelector('.aj-q') && visible(tr)) out.push({ el: tr, type: 'cartrow' });
        });
        return out;
    }

    function unhl(el) {
        if (!el) return;
        el.style.outline = ''; el.style.outlineOffset = ''; el.style.boxShadow = '';
        if (el.tagName === 'TR') el.style.background = '';
    }
    function hl(el, type) {
        el.style.outline = '3px solid ' + (type === 'cat' || type === 'mode' ? YELLOW : BLUE);
        el.style.outlineOffset = '-2px';
        if (type !== 'cat' && type !== 'mode') el.style.boxShadow = '0 0 0 3px rgba(21,101,192,0.30)';
        if (type === 'cartrow') el.style.background = '#ECE8FB';
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    var HINTS = {
        cat:     'CATEGORY &nbsp; <b>&#8592;&#8593;&#8595;&#8594;</b> move &nbsp; <b>Enter</b> open',
        mode:    'SALES MODE &nbsp; <b>&#8592;&#8594;</b> move &nbsp; <b>Enter</b> apply &nbsp; <b>M</b> cycle',
        prod:    'PRODUCT &nbsp; <b>&#8592;&#8593;&#8595;&#8594;</b> move &nbsp; <b>Enter</b> add &nbsp; <b>M</b> sales mode &nbsp; <b>Tab</b> &#8594; Cart',
        cartrow: 'CART LINE &nbsp; <b>type 0-9</b> = qty &nbsp; <b>Enter</b>/<b>R</b> rate &nbsp; <b>M</b> item mode &nbsp; <b>+ &#8722;</b> nudge &nbsp; <b>Del</b> remove &nbsp; <b>&#8593;&#8595;</b> line',
        btn:     'BUTTON &nbsp; <b>&#8592;&#8593;&#8595;&#8594;</b> move &nbsp; <b>Enter</b> press',
        search:  'SEARCH &nbsp; <b>Enter</b> type here &nbsp; <b>&#8592;&#8593;&#8595;&#8594;</b> move'
    };
    function hintBox() {
        var h = document.getElementById('posZoneHint');
        if (!h) {
            h = document.createElement('div');
            h.id = 'posZoneHint';
            h.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(21,101,192,0.96);color:#fff;padding:7px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:2147483500;box-shadow:0 4px 16px rgba(0,0,0,0.35);pointer-events:none;white-space:nowrap;font-family:inherit';
            document.body.appendChild(h);
        }
        return h;
    }
    function flash(html, bg, ms) {
        var h = hintBox();
        h.innerHTML = '&#9656; ' + html;
        h.style.display = 'block'; h.style.background = bg || 'rgba(21,101,192,0.96)';
        if (hintT) clearTimeout(hintT);
        hintT = setTimeout(function () { var e = document.getElementById('posZoneHint'); if (e) e.style.display = 'none'; }, ms || 3500);
    }
    function showHint(type) { flash(HINTS[type] || HINTS.prod, 'rgba(21,101,192,0.96)', 3500); }
    function showQtyHint() { flash('SET QTY &nbsp; <b style="font-size:15px">' + (qtyBuf || '0') + '</b> &nbsp; press <b>Enter</b> to apply &nbsp; <b>Esc</b> cancel', 'rgba(230,81,0,0.97)', 4000); }
    function showModeHint(name) { flash('SALES MODE &nbsp; <b style="font-size:14px">' + (name || '') + '</b>', 'rgba(21,101,192,0.96)', 3000); }

    function setCur(o) {
        if (cur && cur.el) unhl(cur.el);
        qtyBuf = '';
        cur = { el: o.el, type: o.type, seq: o.type === 'cartrow' ? seqOf(o.el) : null };
        hl(o.el, o.type);
        showHint(o.type);
    }

    function resolve(list) {
        if (!cur) return null;
        var i;
        if (cur.type === 'cartrow' && cur.seq) {
            for (i = 0; i < list.length; i++) if (list[i].type === 'cartrow' && seqOf(list[i].el) === cur.seq) return list[i];
        }
        for (i = 0; i < list.length; i++) if (list[i].el === cur.el) return list[i];
        return null;
    }

    function rehighlightCart() {
        if (!cur || cur.type !== 'cartrow') return;
        var list = collect(), c = resolve(list);
        if (c) { hl(c.el, 'cartrow'); cur.el = c.el; }
        else {
            var rowsLeft = list.filter(function (o) { return o.type === 'cartrow'; });
            if (rowsLeft.length) setCur(rowsLeft[0]); else cur = null;
        }
    }

    function setQty(rowEl, n) {
        var input = rowEl.querySelector('.aj-qi');
        if (input) {
            input.value = n;
            input.dispatchEvent(new Event('change', {bubbles:true}));
            return;
        }
        var qb = rowEl.querySelectorAll('.aj-q');
        if (!qb.length) return;
        var btn = qb[qb.length - 1];
        btn.setAttribute('data-q', String(n));
        btn.click();
    }
    function focusRate(rowEl) {
        var pin = rowEl.querySelector('.aj-p');
        if (pin) { pin.focus(); if (pin.select) pin.select(); }
    }
    // cycle THIS cart line's inline sales-mode <select> (.aj-mode) -> fires setItemMode
    function cycleItemMode(rowEl) {
        var sel = rowEl.querySelector('.aj-mode');
        if (!sel || sel.options.length < 2) { flash('This item has no alternate sales mode', 'rgba(120,120,120,0.95)', 2500); return false; }
        sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
        var ev; try { ev = new Event('change', { bubbles: true }); } catch (e) { ev = document.createEvent('HTMLEvents'); ev.initEvent('change', true, false); }
        sel.dispatchEvent(ev);
        showModeHint(sel.options[sel.selectedIndex].text);
        setTimeout(rehighlightCart, 300);
        return true;
    }
    // cycle the GLOBAL sales mode (header chips) -> AJAX switch
    function cycleGlobalMode() {
        var links = Array.prototype.slice.call(document.querySelectorAll('.pos-header a[href*="changeSalesMode"]'));
        if (links.length < 2) { flash('Only one sales mode is configured', 'rgba(120,120,120,0.95)', 2500); return false; }
        var ai = -1;
        for (var i = 0; i < links.length; i++) { var bc = links[i].style.borderColor; if (bc === '#fff' || bc === 'rgb(255, 255, 255)') { ai = i; break; } }
        var nx = links[(ai + 1) % links.length];
        nx.click();
        showModeHint(nx.textContent.trim());
        return true;
    }

    function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    function move(dir) {
        var list = collect();
        if (!list.length) return;
        var c = resolve(list);
        if (!c) { setCur(list.find(function (o) { return o.type === 'prod'; }) || list[0]); return; }
        var a = center(c.el), best = null, bestScore = Infinity;
        list.forEach(function (o) {
            if (o.el === c.el) return;
            var b = center(o.el), dx = b.x - a.x, dy = b.y - a.y, along, cross;
            if (dir === 'ArrowRight') { if (dx <= 2) return; along = dx; cross = Math.abs(dy); }
            else if (dir === 'ArrowLeft') { if (dx >= -2) return; along = -dx; cross = Math.abs(dy); }
            else if (dir === 'ArrowDown') { if (dy <= 2) return; along = dy; cross = Math.abs(dx); }
            else { if (dy >= -2) return; along = -dy; cross = Math.abs(dx); }
            var score = along + cross * 2;
            if (score < bestScore) { bestScore = score; best = o; }
        });
        if (best) setCur(best);
    }

    function gotoCart() {
        var list = collect(), rows = list.filter(function (o) { return o.type === 'cartrow'; });
        if (!rows.length) { showHint('cartrow'); return; }
        var keep = (cur && cur.type === 'cartrow') ? (resolve(list) || rows[0]) : rows[0];
        setCur(keep);
    }
    function gotoProducts() {
        var list = collect(), p = list.find(function (o) { return o.type === 'prod'; });
        if (p) setCur(p);
    }

    function typing(e) { var t = (e.target && e.target.tagName ? e.target.tagName : '').toUpperCase(); return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; }

    document.addEventListener('keydown', function (e) {
        if (document.getElementById('pos-free-approval') || document.getElementById('posCashTenderOverlay') || document.getElementById('posPayConfirmOverlay')) return;
        if (typing(e) || document.querySelector('[role=dialog]')) return;
        var k = e.key;

        if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) gotoProducts(); else gotoCart(); return; }

        var isArrow = (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight');
        if (isArrow) {
            if (cur && cur.type === 'cartrow' && qtyBuf !== '') { var c0 = resolve(collect()); if (c0) { setQty(c0.el, parseFloat(qtyBuf) || 0); } qtyBuf = ''; }
            e.preventDefault(); move(k); return;
        }

        // global utility shortcuts: T tax toggle, F fullscreen, C close session
        if (k === 't' || k === 'T') { e.preventDefault(); var _tb = document.querySelector('.pos-header form[action*="toggleTax"] button'); if (_tb) { _tb.click(); flash('TAX toggled', 'rgba(21,101,192,0.96)', 2000); } return; }
        if (k === 'f' || k === 'F') { e.preventDefault(); var _fb = document.getElementById('posFullscreenBtn'); if (_fb) _fb.click(); else if (window.posToggleFullscreen) window.posToggleFullscreen(); return; }
        if (k === 'c' || k === 'C') { e.preventDefault(); if (document.querySelector('.pos-checkout-reference') || window.confirm('Close this POS session?')) { var _cb = document.querySelector('.pos-header form[action*="closeSession"] button'); if (_cb) _cb.click(); } return; }

        // M = sales mode: global unless we're on a cart line (then it's the line's item mode)
        if ((k === 'm' || k === 'M') && !(cur && cur.type === 'cartrow')) { e.preventDefault(); cycleGlobalMode(); return; }

        if (!cur || !cur.el) return;

        if (cur.type === 'cartrow') {
            var list = collect(), c = resolve(list);
            if (!c) { rehighlightCart(); return; }
            var qb = c.el.querySelectorAll('.aj-q');

            if (k === 'm' || k === 'M') { e.preventDefault(); cycleItemMode(c.el); return; }
            if (/^[0-9]$/.test(k) || (k === '.' && qtyBuf.indexOf('.') < 0)) { e.preventDefault(); qtyBuf += k; showQtyHint(); return; }
            if (k === 'Enter') {
                e.preventDefault();
                if (qtyBuf !== '') { var n = parseFloat(qtyBuf); qtyBuf = ''; if (!isNaN(n)) { setQty(c.el, n); setTimeout(rehighlightCart, 280); } return; }
                focusRate(c.el); return;
            }
            if (k === 'r' || k === 'R') { e.preventDefault(); qtyBuf = ''; focusRate(c.el); return; }
            if (k === 'Escape') { if (qtyBuf !== '') { e.preventDefault(); qtyBuf = ''; showHint('cartrow'); } return; }
            if (k === '+' || k === '=') { e.preventDefault(); qtyBuf = ''; if (qb[1]) qb[1].click(); setTimeout(rehighlightCart, 280); return; }
            if (k === '-' || k === '_') { e.preventDefault(); qtyBuf = ''; if (qb[0]) qb[0].click(); setTimeout(rehighlightCart, 280); return; }
            if (k === 'Backspace') { e.preventDefault(); if (qtyBuf !== '') { qtyBuf = qtyBuf.slice(0, -1); showQtyHint(); } else { var _rmb = c.el.querySelector('.aj-rm'); if (_rmb) _rmb.click(); setTimeout(rehighlightCart, 280); } return; }
            if (k === 'Delete') { e.preventDefault(); qtyBuf = ''; var _rmd = c.el.querySelector('.aj-rm'); if (_rmd) _rmd.click(); setTimeout(rehighlightCart, 280); return; }
            return;
        }

        if (k === 'Enter') {
            e.preventDefault();
            var el = cur.el, type = cur.type;
            if (type === 'search') { el.focus(); if (el.select) el.select(); return; }
            el.click();
            if (type === 'prod') { setTimeout(function () { if (document.contains(el)) hl(el, 'prod'); }, 260); }
        }
    });
})();

(function () {
    // Keep the keyboard hints alive after the cart re-renders. pos-terminal.js's buildSummary()
    // rebuilds the whole payment panel from JS templates that have NO F-key badges, NO button
    // ids, and drop the shortcuts legend -> so after any cart change the key names vanish and the
    // F1-F8 / spatial-nav ids break. This pass re-applies them every time .pos-summary changes:
    //  - tags each pay/action button with its stable id (#pos-pay-cash ... #pos-void) + key badge
    //  - re-injects the "KEYBOARD SHORTCUTS" legend (cloned from the server-rendered one)
    // Idempotent + debounced; runs on load and via a MutationObserver.
    if (window.__posDecorate) { return; }
    window.__posDecorate = true;

    var savedLegend = null;

    function payButton(sm, m) { var i = sm.querySelector('input[name="paymentMethod"][value="' + m + '"]'); return i && i.closest('form') ? i.closest('form').querySelector('button') : null; }
    function formButton(sm, act) { var f = sm.querySelector('form[action*="' + act + '"]'); return f ? f.querySelector('button') : null; }

    // [finder, id, key]
    var MAP = [
        [function (sm) { return sm.querySelector('#pos-pay-cash, .pos-cash-btn'); }, 'pos-pay-cash', 'F1'],
        [function (sm) { return payButton(sm, 'Card'); }, 'pos-pay-card', 'F2'],
        [function (sm) { return payButton(sm, 'UPI'); }, 'pos-pay-upi', 'F3'],
        [function (sm) { return sm.querySelector('#pos-split, .pos-split-btn'); }, 'pos-split', 'F4'],
        [function (sm) { return formButton(sm, 'recallSale'); }, 'pos-recall', 'F5'],
        [function (sm) { return sm.querySelector('#pos-credit, [onclick*="posCreditSale"]'); }, 'pos-credit', 'F6'],
        [function (sm) { return formButton(sm, 'holdSale'); }, 'pos-hold', 'F7'],
        [function (sm) { return formButton(sm, 'voidSale'); }, 'pos-void', 'F8']
    ];

    function addBadge(el, key) {
        if (!el) return;
        // already badged? (our span, or the server-rendered one with the same key text)
        var sp = el.querySelectorAll('span');
        for (var i = 0; i < sp.length; i++) { if ((sp[i].textContent || '').trim() === key) return; }
        var s = document.createElement('span');
        s.className = 'kb-badge';
        s.style.cssText = 'margin-left:7px;padding:1px 6px;border:1px solid rgba(255,255,255,0.7);border-radius:4px;font-size:11px;font-weight:700;opacity:0.9';
        s.textContent = key;
        el.appendChild(s);
    }

    // header utility buttons (present even without an active cart) -> key badges
    var HDR = [
        [function () { return document.querySelector('.pos-header form[action*="toggleTax"] button'); }, 'T'],
        [function () { return document.getElementById('posFullscreenBtn'); }, 'F'],
        [function () { return document.querySelector('.pos-header form[action*="closeSession"] button'); }, 'C']
    ];

    function decorate() {
        (document.querySelector('.pos-checkout-reference') ? [] : HDR).forEach(function (h) { var el = h[0](); if (el) addBadge(el, h[1]); });
        var sm = document.querySelector('.pos-summary');
        if (!sm) return;
        var reference = !!document.querySelector('.pos-checkout-reference');
        MAP.forEach(function (m) {
            var el = m[0](sm);
            if (el) { if (!el.id) el.id = m[1]; if (!reference) addBadge(el, m[2]); }
        });
        var lg = document.getElementById('posKbLegend');
        if (lg) { if (!savedLegend) savedLegend = lg.outerHTML; }
        else if (savedLegend) { sm.insertAdjacentHTML('beforeend', savedLegend); }
    }

    var t = null;
    function schedule() { if (t) return; t = setTimeout(function () { t = null; decorate(); }, 80); }

    if (document.readyState !== 'loading') decorate();
    else document.addEventListener('DOMContentLoaded', decorate);
    try {
        var summary = document.querySelector('.pos-summary');
        if (summary) new MutationObserver(schedule).observe(summary, { childList: true, subtree: true });
    } catch (e) { }
})();

window.posToggleFullscreen = function() {
    var root = document.getElementById('pos-terminal-root');
    if (!root) return;
    var pfs = window._pfs;
    if (pfs.active) {
        pfs.active = false;
        root.style.cssText = '';
        var ml = root.querySelector('.pos-main-layout');
        if (ml) ml.style.height = '';
        document.body.style.overflow = '';
        for (var i = pfs.saved.length - 1; i >= 0; i--) pfs.saved[i].el.style.cssText = pfs.saved[i].css;
        pfs.saved = [];
        try { sessionStorage.removeItem('posFS'); } catch(e) {}
        var ic = document.getElementById('fsBtnIcon');
        if (ic) ic.textContent = '⛶';
    } else {
        pfs.active = true; pfs.saved = [];
        var el = root.parentNode;
        while (el && el !== document) {
            if (el.style) {
                pfs.saved.push({el: el, css: el.style.cssText});
                if (el !== document.body && el !== document.documentElement) {
                    el.style.padding = '0'; el.style.margin = '0'; el.style.maxWidth = 'none';
                    el.style.width = '100%'; el.style.height = '100%'; el.style.border = 'none'; el.style.overflow = 'visible';
                }
            }
            if (el.parentNode && el.parentNode.children) {
                for (var i = 0; i < el.parentNode.children.length; i++) {
                    var sib = el.parentNode.children[i];
                    if (sib !== el && sib.tagName !== 'SCRIPT' && sib.tagName !== 'STYLE' && sib.tagName !== 'LINK') {
                        pfs.saved.push({el: sib, css: sib.style.cssText}); sib.style.display = 'none';
                    }
                }
            }
            el = el.parentNode;
        }
        document.body.style.overflow = 'hidden';
        // height:100dvh (dynamic viewport height) overrides 100vh where supported (Safari 15.4+)
        // so the fullscreen terminal isn't clipped by the iOS Safari URL bar; falls back to 100vh
        // on older browsers (the invalid dvh declaration is simply dropped).
        root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:999999;background:#fff';
        var ml = root.querySelector('.pos-main-layout');
        if (ml) { ml.style.height = 'calc(100vh - 52px)'; ml.style.height = 'calc(100dvh - 52px)'; }
        window.scrollTo(0, 0);
        try { sessionStorage.setItem('posFS', '1'); } catch(e) {}
        var ic = document.getElementById('fsBtnIcon');
        if (ic) ic.textContent = '✖';
    }
};
(function() {
    try { if (sessionStorage.getItem('posFS') === '1') setTimeout(window.posToggleFullscreen, 100); } catch(e) {}
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F11') { e.preventDefault(); window.posToggleFullscreen(); }
        if (e.key === 'Escape' && window._pfs && window._pfs.active) window.posToggleFullscreen();
    });
})();

/* === Core AJAX Engine === */
(function() {
    function init() {
        var af = document.getElementById('cartInlineAddForm');
        if (!af) { setTimeout(init, 300); return; }
        // The /apps SPA re-executes this screen script on soft-navigation, and the
        // no-session load's init() retry-loop stays alive across the open-session swap.
        // Without this guard TWO optimistic engines bind to the same cart+grid: one
        // product tap fires both grid-submit listeners -> two addItem POSTs -> the cart
        // re-renders optimistic + settleA + settleB (the "three states" flicker, and the
        // item could even post twice). The flag lives on the cart FORM element, so it is
        // per-live-DOM: a real DOM swap brings a fresh form (no flag) and re-binds cleanly,
        // while a bare re-exec against the same form is skipped.
        if (af.dataset.posEngineBound) return;   // a cart engine is already wired to this form (guards SPA soft-nav re-exec)
        af.dataset.posEngineBound = '1';

        var TK = (af.querySelector('[name=moquiSessionToken]') || {}).value || '';
        var SI = (af.querySelector('[name=sessionId]') || {}).value || '';
        var TX = (af.querySelector('[name=transactionId]') || {}).value || '';
        var TO = (af.querySelector('[name=taxOn]') || {}).value || 'Y';
        var SM = (af.querySelector('[name=salesModeId]') || {}).value || '';
        var CATID = (af.querySelector('[name=catId]') || {}).value || '';
        var CS = '₹';
        var busy = false;
        var modeSwitching = false;
        var cartClearing = false;
        var lastTxnNum = '';
        var lastPay = 0;
        var lastCartData = null;
        var heldId = '';
        var heldCount = 0;

        // A real cashier gesture or a completed bill resets the 60-minute idle clock.
        // Polling and background rendering do not. The server sweep also handles closed tabs.
        if (window.__posIdleCleanup) window.__posIdleCleanup();
        var idleAbort = new AbortController();
        var lastGestureAt = Date.now();
        var lastTouchSentAt = 0;
        var idleClosePending = false;
        var lastDayCheckAt = 0;
        var dayRefreshPending = false;
        var dayBadge = document.getElementById('pos-today-bills');
        var dayFormatter;
        try { if (dayBadge) dayFormatter = new Intl.DateTimeFormat('en-US', {timeZone:dayBadge.dataset.timeZone,
            year:'numeric',month:'2-digit',day:'2-digit'}); } catch (_) {}
        function sendSessionTouch() {
            if (!SI || Date.now() - lastTouchSentAt < 30000) return;
            lastTouchSentAt = Date.now();
            fetch('Terminal/touchSession', {method:'POST', credentials:'same-origin',
                headers:{'Content-Type':'application/x-www-form-urlencoded'},
                body:new URLSearchParams({sessionId:SI, moquiSessionToken:TK})}).catch(function(){});
        }
        function checkSessionIdle() {
            if (!af.isConnected) return;
            if (dayFormatter && Date.now() - lastDayCheckAt >= 60000) {
                lastDayCheckAt = Date.now();
                var parts = {};
                dayFormatter.formatToParts(new Date()).forEach(function(p){ parts[p.type] = p.value; });
                var currentDay = parts.year + parts.month + parts.day;
                var countBadge = document.getElementById('pos-today-bills');
                if (countBadge && countBadge.dataset.day !== currentDay && !dayRefreshPending) {
                    dayRefreshPending = true;
                    fetchScreen({}).then(syncIssuedBillHeader).catch(function(){}).finally(function(){dayRefreshPending = false;});
                }
            }
            if (!af.isConnected || idleClosePending || Date.now() - lastGestureAt < 3600000) return;
            idleClosePending = true;
            fetch('Terminal/closeIdleSession', {method:'POST', credentials:'same-origin',
                headers:{'Content-Type':'application/x-www-form-urlencoded'},
                body:new URLSearchParams({sessionId:SI, moquiSessionToken:TK})})
                .then(function(r){return r.json();})
                .then(function(d){
                    if (d.closed || d.reason === 'already_closed') {
                        window.location.assign('/apps/zenith/pos/PosSessions?sessionId=' + encodeURIComponent(SI));
                    } else if (d.reason === 'still_active') {
                        // Another live tab or a completed bill refreshed server activity.
                        lastGestureAt = Date.now();
                        idleClosePending = false;
                    } else if (d.reason === 'disabled') {
                        lastGestureAt = Date.now();
                        idleClosePending = false;
                    } else {
                        lastGestureAt = Date.now();
                        idleClosePending = false;
                        showToast('Session idle for an hour. Count the drawer and close it to finish reconciliation.', '#c62828');
                        // Keep real input tracking alive while a held/unfinished sale needs review.
                    }
                }).catch(function(){ idleClosePending = false; });
        }
        function onCashierGesture(e) {
            if (!e.isTrusted || !af.isConnected) return;
            if (Date.now() - lastGestureAt >= 3600000) { checkSessionIdle(); return; }
            lastGestureAt = Date.now();
            sendSessionTouch();
        }
        ['pointerdown','keydown','touchstart','wheel'].forEach(function(type) {
            document.addEventListener(type,onCashierGesture,{capture:true,passive:true,signal:idleAbort.signal});
        });
        document.addEventListener('visibilitychange',function(){
            if (!document.hidden) checkSessionIdle();
        },{signal:idleAbort.signal});
        var idleInterval = setInterval(checkSessionIdle,10000);
        window.__posIdleCleanup = function(){ idleAbort.abort(); clearInterval(idleInterval); };
        sendSessionTouch();


        function fmt(n) { return Math.round(Number(n)).toLocaleString('en-IN'); }
        function fmt2(n) { return Number(n).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}); }

        function extractHeldInfo(doc) {
            var badge = doc.querySelector('[data-held-id]');
            if (badge) {
                heldId = badge.dataset.heldId || '';
                heldCount = parseInt(badge.dataset.heldCount) || 0;
                return;
            }
            var rf = doc.querySelector('form[action*="recallSale"]');
            if (rf) { var hi = rf.querySelector('input[name="heldId"]'); heldId = hi ? hi.value : ''; }
            var hc = 0;
            doc.querySelectorAll('span').forEach(function(s) { var m = s.textContent.match(/HELD:\s*(\d+)/); if (m) hc = parseInt(m[1]); });
            heldCount = hc;
            if (hc === 0) heldId = '';
        }
        function updateHeldBadge() {
            // The held UI is the server-rendered #pos-held-wrap <details> picker, kept fresh via
            // syncHeldWrap() from each hold/recall/void response. The old JS #pos-held-badge is
            // retired so it can't duplicate the native one on /apps. No-op kept for old callers.
            var stale = document.getElementById('pos-held-badge'); if (stale) stale.remove();
            var dd = document.getElementById('pos-held-dropdown'); if (dd) dd.remove();
        }
        function toggleHeldDropdown() {
            var dd = document.getElementById('pos-held-dropdown');
            if (dd) { dd.remove(); return; }
            post({action:'listHeld', sessionId:SI}).then(function(d) {
                if (!d.success || !d.held || d.held.length === 0) { showToast('No held bills', '#ff9800'); return; }
                var badge = document.getElementById('pos-held-badge');
                if (!badge) return;
                var panel = document.createElement('div');
                panel.id = 'pos-held-dropdown';
                panel.style.cssText = 'position:absolute;top:100%;right:0;z-index:99999;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);min-width:320px;max-height:400px;overflow-y:auto;margin-top:8px;border:1px solid #e0e0e0';
                var h = '<div style="padding:12px 16px;background:#ff9800;color:#fff;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center">'
                    + '<span style="font-weight:700;font-size:15px">' + d.heldCount + ' Held Bill' + (d.heldCount > 1 ? 's' : '') + '</span>'
                    + '<span style="font-size:14px">Total: ₹' + Number(d.heldTotal||0).toFixed(2) + '</span></div>';
                d.held.forEach(function(bill, idx) {
                    var items = (bill.items||[]).slice(0,3).map(function(it) { return it.name + ' x' + it.qty; }).join(', ');
                    if (bill.itemCount > 3) items += ' +' + (bill.itemCount - 3) + ' more';
                    h += '<div class="held-bill-row" data-held-id="' + bill.heldId + '" style="padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer;transition:background 0.15s"'
                        + ' onmouseover="this.style.background=\'#fff3e0\'" onmouseout="this.style.background=\'#fff\'">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
                        + '<span style="font-weight:700;font-size:14px;color:#333">#' + (idx+1) + ' — ' + bill.customer + '</span>'
                        + '<span style="font-weight:700;font-size:14px;color:#e65100">₹' + Number(bill.subtotal||0).toFixed(2) + '</span></div>'
                        + '<div style="font-size:12px;color:#777">' + items + '</div>'
                        + '<div style="font-size:11px;color:#999;margin-top:2px">' + bill.holdTime + (bill.reason ? ' — ' + bill.reason : '') + '</div>'
                        + '</div>';
                });
                panel.innerHTML = h;
                badge.appendChild(panel);
                panel.addEventListener('click', function(ev) {
                    var row = ev.target.closest('.held-bill-row');
                    if (!row) return;
                    ev.stopPropagation();
                    var hid = row.dataset.heldId;
                    panel.remove();
                    recallHeldBill(hid);
                });
                var closeOnClick = function(ev) {
                    if (!panel.contains(ev.target) && ev.target !== badge) {
                        panel.remove(); document.removeEventListener('click', closeOnClick);
                    }
                };
                setTimeout(function() { document.addEventListener('click', closeOnClick); }, 50);
            });
        }
        function recallHeldBill(hid) {
            var fd = new URLSearchParams();
            fd.set('heldId', hid); fd.set('sessionId', SI); fd.set('taxOn', TO);
            fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
            fetch('Terminal/recallSale', {method:'POST', body:fd, credentials:'same-origin'})
                .then(function(r) { return r.text().then(function(html) { return {html:html, url:r.url||''}; }); })
                .then(function(resp) {
                    var respDoc = new DOMParser().parseFromString(resp.html, 'text/html');
                    var ntx = respDoc.querySelector('input[name="transactionId"]');
                    var newTx = ntx ? (ntx.value||'') : '';
                    if (!newTx && resp.url) { var m = resp.url.match(/transactionId=(\d+)/); if (m) newTx = m[1]; }
                    if (newTx) {
                        TX = newTx;
                        document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { el.value = TX; });
                        var ntk = respDoc.querySelector('input[name="moquiSessionToken"]');
                        if (ntk && ntk.value) TK = ntk.value;
                        extractHeldInfo(respDoc);
                        updateHeldBadge();
                        post({action:'refresh', transactionId:TX}).then(function(d) {
                            renderCart(d);
                            showToast('✔ Held sale recalled', '#e65100');
                        });
                    }
                });
        }
        function recallBtn() {
            return '<form method="post" action="Terminal/recallSale" style="margin:0">'
                + '<input type="hidden" name="heldId" value="'+heldId+'"/>'
                + '<input type="hidden" name="sessionId" value="'+SI+'"/>'
                + '<input type="hidden" name="taxOn" value="'+TO+'"/>'
                + '<input type="hidden" name="salesModeId" value="'+SM+'"/>'
                + '<input type="hidden" name="moquiSessionToken" value="'+TK+'"/>'
                + '<button type="submit" style="width:100%;padding:clamp(7px,1.2vh,13px) 8px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#e65100;color:#fff">&#128260; RECALL'+(heldCount > 1 ? ' ('+heldCount+')' : '')+'</button></form>';
        }
        function appendRecallIfNeeded() {
            if (heldCount <= 0 || !heldId) return;
            var sm = document.querySelector('.pos-summary');
            if (!sm || sm.querySelector('form[action*="recallSale"]')) return;
            if (sm.textContent.indexOf('Tap products') !== -1) {
                var div = document.createElement('div');
                div.style.marginTop = '8px';
                div.innerHTML = recallBtn();
                sm.appendChild(div);
            }
        }


        /* === Discount & Round-off === */
        if (!window.__posDiscDelegated) {
            window.__posDiscDelegated = true;
            document.addEventListener('click', function(e) {
                var b = e.target && e.target.closest ? e.target.closest('.pos-discount-btn') : null;
                if (b) { e.preventDefault(); if (typeof window.posDiscount === 'function') window.posDiscount(); }
            });
        }
        window.posDiscount = function() {
            if (!TX || cartClearing || modeSwitching) { showToast('Add items or wait for the cart to finish updating', '#e53935'); return; }
            if (!lastCartData || OPT._drainPending()) {
                OPT.whenIdle().then(function(){return post({action:'refresh',transactionId:TX});}).then(function(data){
                    if (!data || !data.success || !data.items.length) throw new Error('Add items to the cart first');
                    renderCart(data); window.posDiscount();
                }).catch(function(error){showToast(error.message,'#e53935');});
                return;
            }
            if (!lastCartData.items.length) { showToast('Add items to the cart first', '#e53935'); return; }
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px';
            ov.id='posDiscountOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Discount and round off');
            var rows = lastCartData.items.map(function(it) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0">'
                    + '<div style="flex:1;min-width:0;font-size:13px;font-weight:600;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + cartText(it.name || it.seq)
                    + '<span style="color:#999;font-weight:400"> &nbsp;' + (Number(it.qty) || 0) + ' &times; &#8377;' + Number(it.price || 0).toFixed(2) + '</span></div>'
                    + '<input class="pd-line" data-seq="' + it.seq + '" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" style="width:66px;padding:6px;border:1px solid #ccc;border-radius:6px;text-align:right;font-size:13px"/>'
                    + '<button type="button" class="pd-tg" data-t="pct" style="width:36px;padding:6px 0;border:1px solid #bbb;border-radius:6px;background:#f5f5f5;cursor:pointer;font-weight:700">%</button></div>';
            }).join('');
            ov.innerHTML = '<div style="background:#fff;border-radius:16px;width:480px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden">'
                + '<div style="padding:16px 20px;background:#6a1b9a;color:#fff;font-size:17px;font-weight:700">&#127991;&#65039; Discount &amp; Round-off</div>'
                + '<div style="padding:14px 18px;overflow-y:auto">'
                + '<div style="font-size:12px;font-weight:700;color:#6a1b9a;margin-bottom:2px">PER-ITEM DISCOUNT</div>'
                + '<div style="font-size:11px;color:#999;margin-bottom:6px">Tap % to switch a box to &#8377; (fixed amount).</div>' + rows
                + '<div style="font-size:12px;font-weight:700;color:#6a1b9a;margin:16px 0 4px">WHOLE-BILL DISCOUNT</div>'
                + '<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;font-size:13px;color:#555">Spread across all items (GST-correct)</div>'
                + '<input id="pd-bill" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" style="width:66px;padding:6px;border:1px solid #ccc;border-radius:6px;text-align:right;font-size:13px"/>'
                + '<button type="button" id="pd-bill-tg" class="pd-tg" data-t="pct" style="width:36px;padding:6px 0;border:1px solid #bbb;border-radius:6px;background:#f5f5f5;cursor:pointer;font-weight:700">%</button></div>'
                + '<label style="display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13px;color:#333;cursor:pointer"><input type="checkbox" id="pd-round" style="width:18px;height:18px"/> Round the payable <b>down</b> to a round figure</label>'
                + '<div id="pd-pin-wrap" style="display:none;margin-top:12px;background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:10px"><label style="font-size:13px;font-weight:600;color:#e65100;display:block;margin-bottom:4px">Manager PIN</label><input id="pd-pin" type="password" inputmode="numeric" autocomplete="off" style="width:100%;padding:9px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
                + '<a href="/apps/zenith/pos/DiscountSettings" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;font-size:12px;color:#6a1b9a;font-weight:700;text-decoration:none">&#9881;&#65039; Set / change discount rules &#8594;</a></div>'
                + '<div id="pd-msg" style="margin-top:10px;font-size:13px;color:#c62828;min-height:16px"></div></div>'
                + '<div style="display:flex;gap:10px;padding:14px 18px;border-top:1px solid #eee">'
                + '<button id="pd-cancel" style="flex:1;padding:13px;border:2px solid #ccc;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button>'
                + '<button id="pd-apply" style="flex:2;padding:13px;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;background:#6a1b9a;color:#fff">Apply</button></div></div>';
            document.body.appendChild(ov);
            ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
            ov.querySelectorAll('.pd-tg').forEach(function(tg) { tg.addEventListener('click', function() { var t = tg.dataset.t === 'pct' ? 'amt' : 'pct'; tg.dataset.t = t; tg.textContent = t === 'pct' ? '%' : '₹'; }); });
            ov.querySelector('#pd-cancel').addEventListener('click', function() { ov.remove(); });
            ov.querySelector('#pd-apply').addEventListener('click', function() {
                var lineDisc = {};
                ov.querySelectorAll('.pd-line').forEach(function(inp) { var v = Number(inp.value); if (v > 0) { var tg = inp.parentNode.querySelector('.pd-tg'); lineDisc[inp.dataset.seq] = { t: tg.dataset.t, v: v }; } });
                var billV = Number(ov.querySelector('#pd-bill').value) || 0;
                var btn = ov.querySelector('#pd-apply'); btn.disabled = true; btn.textContent = 'Applying…';
                var params = new URLSearchParams({ action: 'applyDiscount', transactionId: TX, sessionId: SI, taxOn: TO,
                    lineDiscounts: JSON.stringify(lineDisc), billDiscType: ov.querySelector('#pd-bill-tg').dataset.t, billDiscValue: String(billV),
                    roundOff: ov.querySelector('#pd-round').checked ? 'Y' : 'N', managerPin: (ov.querySelector('#pd-pin').value || ''), moquiSessionToken: TK });
                fetch('Terminal/ajaxCart', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params, credentials: 'same-origin' })
                    .then(function(r) { return r.json(); }).then(function(d) {
                        btn.disabled = false; btn.textContent = 'Apply';
                        if (d && d.success) {
                            showToast('Discount applied', '#2e7d32'); ov.remove();
                            // Re-sync the cart from the server (NOT a full reload — a reload reprices the
                            // cart to the sales-mode default, which would wipe the manual discount).
                            try { post({ action: 'refresh', transactionId: TX }).then(function(rd) { if (rd) renderCart(rd); }); }
                            catch (_e) { window.location.reload(); }
                            return;
                        }
                        if (d && d.needPin) { ov.querySelector('#pd-pin-wrap').style.display = 'block'; ov.querySelector('#pd-msg').textContent = d.error || 'Manager PIN required'; ov.querySelector('#pd-pin').focus(); return; }
                        ov.querySelector('#pd-msg').textContent = (d && d.error) || 'Could not apply the discount';
                    }).catch(function() { btn.disabled = false; btn.textContent = 'Apply'; ov.querySelector('#pd-msg').textContent = 'Network error — try again'; });
            });
        };

        /* === Credit / Pay-Later sale === */
        window.posCreditSale = function() {
            if (!TX) { showToast('Add items to the cart first', '#e53935'); return; }
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
            ov.innerHTML = '<div style="background:#fff;border-radius:16px;width:420px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,0.3)">'
                + '<div style="padding:18px 20px;background:#e65100;color:#fff;text-align:center;font-size:18px;font-weight:700">&#128196; Credit / Pay Later</div>'
                + '<div style="padding:20px 24px">'
                + '<div style="font-size:13px;color:#666;margin-bottom:14px">Choose a saved customer or add one below. Record any amount paid now; the balance remains in Credit Bills.</div>'
                + '<label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Customer Name *</label>'
                + '<div style="position:relative;margin-bottom:12px">'
                + '<input id="credit-name" type="text" autocomplete="off" placeholder="Type to search your saved customers&hellip;" style="width:100%;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
                + '<div id="credit-cust-results" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.18);max-height:160px;overflow-y:auto;margin-top:4px"></div>'
                + '</div>'
                + '<label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Customer Phone *</label>'
                + '<input id="credit-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="10 to 15 digits" style="width:100%;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
                + '<button id="credit-add-customer" type="button" style="margin-top:7px;padding:0;border:0;background:none;color:#7C3AED;font-weight:700;cursor:pointer">+ Add customer with this name and phone</button>'
                + '<div style="display:flex;gap:10px;margin-top:15px"><label style="flex:1;font-size:13px;font-weight:600;color:#555">Paid now (₹)<input id="credit-upfront" type="number" min="0" step="0.01" inputmode="decimal" value="0" style="display:block;width:100%;margin-top:4px;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box"/></label>'
                + '<label style="flex:1;font-size:13px;font-weight:600;color:#555">Method<select id="credit-upfront-method" style="display:block;width:100%;margin-top:4px;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box"><option value="Cash">Cash</option><option value="Card">Card</option><option value="UPI">UPI</option></select></label></div>'
                + '<label style="display:block;margin-top:12px">Credit days for this bill<input id="credit-days" type="number" min="0" max="3650" step="1" placeholder="Customer term, e.g. 2 or 30" style="display:block;width:100%;padding:10px;border:1px solid #ddd6fe;border-radius:8px;box-sizing:border-box"></label>'
                + '<p id="credit-date-preview" style="font-size:12px;color:#6b7280" aria-live="polite"></p>'
                + '<label style="display:block">Reason if overriding customer terms (manager)<input id="credit-terms-reason" maxlength="255" style="display:block;width:100%;padding:10px;border:1px solid #ddd6fe;border-radius:8px;box-sizing:border-box"></label>'
                + '<div id="credit-due-preview" aria-live="polite" style="margin-top:9px;font-size:13px;font-weight:700;color:#c62828"></div>'
                + '<div style="display:flex;gap:12px;margin-top:20px">'
                + '<button id="credit-cancel" style="flex:1;padding:14px;border:2px solid #ccc;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button>'
                + '<button id="credit-confirm" style="flex:1;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#e65100;color:#fff">Complete Credit Sale</button>'
                + '</div></div></div>';
            ov.id='posCreditOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Credit sale');
            document.body.appendChild(ov);
            ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
            var nameInp = document.getElementById('credit-name');
            nameInp.focus();
            // Saved-customer search: typing a name (or phone) lists matching saved customers
            // (same org-scoped searchCustomers used by the CUSTOMER button); picking one fills
            // both name and phone so credit is recorded against the existing contact.
            var resBox = document.getElementById('credit-cust-results');
            var phoneInp = document.getElementById('credit-phone');
            var selectedPartyId = '';
            var amountInp = document.getElementById('credit-upfront');
            var daysInp = document.getElementById('credit-days');
            var daysTouched = false, customerDays = null;
            function showDueDate(){
                var days = daysInp.value.trim(), start = lastCartData && lastCartData.creditDateToday;
                var node = document.getElementById('credit-date-preview');
                if(!/^\d+$/.test(days)||Number(days)>3650||!start){node.textContent='Choose the customer’s calendar-day term before completing.';return;}
                var date=new Date(start+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+Number(days));
                node.textContent='Due through '+date.toISOString().slice(0,10)+' ('+(lastCartData.creditTimeZone||'')+'). Day 0 is today; calendar days include weekends.';
            }
            daysInp.addEventListener('input',function(){daysTouched=true;showDueDate();});

            var duePreview = document.getElementById('credit-due-preview');
            var creditBtn = document.getElementById('credit-confirm');
            var creditReady = false;
            creditBtn.disabled = true;
            creditBtn.textContent = 'Loading bill…';
            function updateDuePreview() {
                var paid = Number(amountInp.value || 0);
                var remaining = Math.max(0, Number(lastPay || 0) - Number((lastCartData && lastCartData.paid) || 0));
                duePreview.textContent = Number.isFinite(paid) && paid >= 0 && paid <= remaining
                    ? 'Balance after this payment: ₹' + fmt2(remaining - paid) : 'Enter an amount from ₹0 to the remaining bill balance.';
            }
            amountInp.addEventListener('input', updateDuePreview);
            duePreview.textContent = 'Loading the current bill balance…';
            if (lastCartData && lastCartData.customer) {
                nameInp.value = lastCartData.customer;
                phoneInp.value = lastCartData.customerPhone || '';
                selectedPartyId = lastCartData.customerPartyId || '';
            }
            // Re-read after the optimistic cart queue drains; the cashier may have tapped a
            // product immediately before Credit. Never collect against a stale UI total.
            function loadCreditBalance(attempt) {
                if (!document.body.contains(ov)) return;
                if (busy || OPT._drainPending() > 0) {
                    if (attempt < 80) setTimeout(function() { loadCreditBalance(attempt + 1); }, 100);
                    else duePreview.textContent = 'Bill is still updating. Close and reopen Credit.';
                    return;
                }
                post({action:'refresh', transactionId:TX}).then(function(d) {
                    if (!d || !d.success || !d.items || !d.items.length) throw new Error('Bill unavailable');
                    lastPay = Number(d.pay || 0);
                    lastCartData = d;
                    if(!daysTouched && d.customerCreditDays!=null){customerDays=d.customerCreditDays;daysInp.value=String(customerDays);}
                    showDueDate();
                    if (!nameInp.value.trim() && d.customer) { nameInp.value = d.customer; phoneInp.value = d.customerPhone || ''; selectedPartyId = d.customerPartyId || ''; }
                    updateDuePreview();
                    creditReady = true;
                    creditBtn.disabled = false;
                    creditBtn.textContent = 'Complete Credit Sale';
                }).catch(function() { duePreview.textContent = 'Could not load the bill. Close and reopen Credit.'; });
            }
            loadCreditBalance(0);
            document.getElementById('credit-add-customer').addEventListener('click', function() {
                selectedPartyId = '';
                resBox.style.display = 'none';
                (nameInp.value.trim() ? phoneInp : nameInp).focus();
                showToast('Enter both fields; the customer will be saved with this credit bill.', '#7C3AED');
            });
            var cTimer = null;
            function creditCustSearch(term) {
                var pr = new URLSearchParams({ term: term || '', sessionId: SI, moquiSessionToken: TK });
                return fetch('Terminal/searchCustomers', { method: 'post', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: pr, credentials: 'same-origin' }).then(function(r) { return r.json(); });
            }
            function renderCreditCust(list) {
                if (!list || !list.length) { resBox.style.display = 'block'; resBox.textContent = 'No saved customer found. Use Add customer below.'; return; }
                var h = '';
                function safe(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
                list.forEach(function(c) {
                    h += '<div class="cc-row" data-party-id="' + safe(c.partyId) + '" data-name="' + safe(c.name) + '" data-phone="' + safe(c.phone) + '" data-credit-days="' + safe(c.creditDays==null?'':c.creditDays) + '" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-weight:700;color:#e65100">' + safe(c.name) + '</span>' + (c.phone ? '<span style="font-size:13px;color:#777;white-space:nowrap">' + safe(c.phone) + '</span>' : '') + '</div>';
                });
                resBox.innerHTML = h; resBox.style.display = 'block';
                resBox.querySelectorAll('.cc-row').forEach(function(row) {
                    row.addEventListener('click', function() {
                        nameInp.value = row.dataset.name || '';
                        if (row.dataset.phone) phoneInp.value = row.dataset.phone;
                        selectedPartyId = row.dataset.partyId || '';
                        customerDays=row.dataset.creditDays===''?null:Number(row.dataset.creditDays);
                        daysInp.value=customerDays==null?'':String(customerDays);daysTouched=false;showDueDate();
                        resBox.style.display = 'none';
                        if (!phoneInp.value) phoneInp.focus();
                    });
                });
            }
            nameInp.addEventListener('input', function() {
                selectedPartyId = '';
                clearTimeout(cTimer);
                var q = nameInp.value.trim();
                if (q.length < 1) { resBox.style.display = 'none'; return; }
                cTimer = setTimeout(function() { creditCustSearch(q).then(function(d) { renderCreditCust((d && d.success) ? (d.customers || []) : []); }); }, 300);
            });
            phoneInp.addEventListener('input', function() { selectedPartyId = ''; });
            ov.addEventListener('click', function(e) { if (resBox && !resBox.contains(e.target) && e.target !== nameInp) resBox.style.display = 'none'; });
            document.getElementById('credit-cancel').addEventListener('click', function() { ov.remove(); });
            document.getElementById('credit-confirm').addEventListener('click', function() {
                if (!creditReady) return;
                var nm = (document.getElementById('credit-name').value || '').trim();
                var ph = (document.getElementById('credit-phone').value || '').trim();
                if (!nm) { showToast('Enter the customer name', '#e53935'); document.getElementById('credit-name').focus(); return; }
                if (!ph) { showToast('Enter the customer phone', '#e53935'); document.getElementById('credit-phone').focus(); return; }
                if (ph.replace(/[^0-9]/g, '').length < 10 || ph.replace(/[^0-9]/g, '').length > 15) { showToast('Enter a valid 10 to 15 digit phone number', '#e53935'); phoneInp.focus(); return; }
                var _dv=daysInp.value.trim(); if(_dv!==''&&(!/^\d+$/.test(_dv)||Number(_dv)>3650)){showToast('Choose 0–3650 calendar days for this bill','#e53935');daysInp.focus();return;}
                if(_dv!==''&&customerDays!=null&&Number(_dv)!==customerDays&&!document.getElementById('credit-terms-reason').value.trim()){showToast('Enter a reason for overriding customer terms','#e53935');return;}
                var paidNow = Number(amountInp.value);
                var remaining = Math.max(0, Number(lastPay || 0) - Number((lastCartData && lastCartData.paid) || 0));
                if (!/^\d+(\.\d{1,2})?$/.test(amountInp.value.trim()) || !Number.isFinite(paidNow) || paidNow > remaining) { showToast('Paid now must be between ₹0 and the remaining bill balance, with at most two decimals', '#e53935'); amountInp.focus(); return; }
                var btn = document.getElementById('credit-confirm');
                btn.disabled = true; btn.textContent = 'Completing...';
                // Submit a real form POST so the SPA navigates to the receipt/confirmation screen
                var f = document.createElement('form');
                f.method = 'post'; f.action = 'Terminal/completeCredit'; f.style.display = 'none';
                function hid(n, v) { var i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); }
                hid('transactionId', TX); hid('sessionId', SI); hid('salesModeId', SM);
                hid('customerName', nm); hid('customerPhone', ph); hid('moquiSessionToken', TK);
                if (selectedPartyId) hid('customerPartyId', selectedPartyId);
                hid('upfrontAmount', paidNow.toFixed(2));
                hid('creditDays',daysInp.value);hid('termsReason',document.getElementById('credit-terms-reason').value);
                if (paidNow > 0) hid('upfrontMethod', document.getElementById('credit-upfront-method').value);
                OPT.whenIdle().then(function(){f.querySelector('[name="transactionId"]').value=TX;return window.PosFreeItems.ensure(TX,TK);}).then(function(){
                    document.body.appendChild(f);f.submit();
                }).catch(function(error){btn.disabled=false;btn.textContent='Complete Credit Sale';alert(error.message);});
            });
        };

        function showToast(msg, bg) {
            var t = document.createElement('div');
            t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:999999;padding:18px 36px;border-radius:12px;font-size:20px;font-weight:700;color:#fff;background:'+(bg||'#2e7d32')+';box-shadow:0 6px 32px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;white-space:nowrap;letter-spacing:0.5px';
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(function() { t.style.opacity = '1'; }, 30);
            setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 400); }, 3500);
        }

        function showBanner(billNum, method) {
            var old = document.querySelector('.pos-print-banner');
            if (old) old.remove();
            var b = document.createElement('div');
            b.className = 'pos-print-banner';
            var label = method === 'qz' ? 'printed silently' : 'sent to printer';
            b.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:999998;background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;padding:18px 30px;display:flex;align-items:center;justify-content:center;gap:16px;font-size:18px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,0.3);transform:translateY(-100%);transition:transform 0.4s cubic-bezier(0.22,1,0.36,1);letter-spacing:0.5px';
            b.innerHTML = '<span style="font-size:28px">&#128424;</span> BILL-' + (billNum || '') + ' ' + label + ' <span style="font-size:22px">&#10004;</span>';
            document.body.appendChild(b);
            setTimeout(function() { b.style.transform = 'translateY(0)'; }, 30);
            setTimeout(function() { b.style.transform = 'translateY(-100%)'; setTimeout(function() { b.remove(); }, 500); }, 4000);
        }

        /* === QZ Tray - Silent Thermal Printing === */
        var qzReady = false;
        var qzConnectFailed = false; // set once a connect attempt fails so we never stall waiting on it again
        var qzPrinter = '';
        try { qzPrinter = localStorage.getItem('posPrinter') || ''; } catch(e) {}

        function qzConnect() {
            if (typeof qz === 'undefined') { qzConnectFailed = true; return Promise.reject('QZ Tray library not loaded'); }
            if (qz.websocket.isActive()) { qzReady = true; qzConnectFailed = false; return Promise.resolve(); }
            // Race the connect against a short timeout — a missing/closed QZ Tray must never delay the receipt.
            var timer;
            var attempt = qz.websocket.connect({ retries: 0, delay: 0 });
            var guard = new Promise(function(_, rej) { timer = setTimeout(function() { rej('qz-timeout'); }, 1200); });
            return Promise.race([attempt, guard]).then(function() {
                clearTimeout(timer); qzReady = true; qzConnectFailed = false;
            }).catch(function(err) {
                clearTimeout(timer); qzConnectFailed = true; throw err;
            });
        }

        function qzShowSetup() {
            return qzConnect().then(function() {
                return qz.printers.find();
            }).then(function(printers) {
                return new Promise(function(resolve, reject) {
                    var old = document.querySelector('.pos-printer-overlay');
                    if (old) old.remove();
                    var ov = document.createElement('div');
                    ov.className = 'pos-printer-overlay';
                    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center';
                    var card = '<div style="background:#fff;border-radius:16px;padding:28px;width:420px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4)">'
                        + '<div style="font-size:20px;font-weight:700;color:#7C3AED;margin-bottom:6px">&#128424; Printer Setup</div>'
                        + '<div style="font-size:13px;color:#666;margin-bottom:16px">Select your thermal receipt printer for silent printing via QZ Tray</div>';
                    if (printers.length === 0) {
                        card += '<div style="padding:20px;text-align:center;color:#e53935;font-size:15px">No printers found. Make sure your thermal printer is connected and drivers are installed.</div>';
                    } else {
                        printers.forEach(function(p) {
                            var sel = (p === qzPrinter) ? 'background:#e8f5e9;border-color:#4caf50;' : '';
                            card += '<div class="qz-printer-opt" data-name="'+p.replace(/"/g,'&quot;')+'" style="padding:12px 16px;border:2px solid #ddd;border-radius:10px;margin-bottom:8px;cursor:pointer;font-size:15px;font-weight:600;'+sel+'transition:all 0.15s">'
                                + p + '</div>';
                        });
                    }
                    card += '<div style="display:flex;gap:10px;margin-top:16px">'
                        + '<button class="qz-cancel" style="flex:1;padding:12px;border:2px solid #ccc;border-radius:10px;background:#f5f5f5;font-size:14px;font-weight:600;cursor:pointer;color:#666">Cancel</button>'
                        + '<button class="qz-save" style="flex:1;padding:12px;border:none;border-radius:10px;background:#7C3AED;color:#fff;font-size:14px;font-weight:700;cursor:pointer;opacity:' + (qzPrinter ? '1' : '0.5') + '"' + (qzPrinter ? '' : ' disabled') + '>Save & Print</button>'
                        + '</div></div>';
                    ov.innerHTML = card;
                    document.body.appendChild(ov);
                    var selected = qzPrinter;
                    ov.addEventListener('click', function(e) {
                        var opt = e.target.closest('.qz-printer-opt');
                        if (opt) {
                            selected = opt.dataset.name;
                            ov.querySelectorAll('.qz-printer-opt').forEach(function(o) {
                                o.style.background = ''; o.style.borderColor = '#ddd';
                            });
                            opt.style.background = '#e8f5e9'; opt.style.borderColor = '#4caf50';
                            var sv = ov.querySelector('.qz-save');
                            if (sv) { sv.disabled = false; sv.style.opacity = '1'; }
                        }
                        if (e.target.closest('.qz-cancel')) { ov.remove(); reject('cancelled'); }
                        if (e.target.closest('.qz-save') && selected) {
                            qzPrinter = selected;
                            try { localStorage.setItem('posPrinter', qzPrinter); } catch(e2) {}
                            ov.remove();
                            resolve(qzPrinter);
                        }
                    });
                });
            });
        }

        function qzPrint(html, billNum) {
            return qzConnect().then(function() {
                if (!qzPrinter) return qzShowSetup();
                return qzPrinter;
            }).then(function(printer) {
                var cfg = qz.configs.create(printer, {
                    size: {width: 80}, units: 'mm', colorType: 'grayscale',
                    margins: {top: 0, right: 0, bottom: 0, left: 0}, scaleContent: false
                });
                var data = [{type: 'pixel', format: 'html', data: html,
                    options: {pageWidth: 80, pageHeight: null}}];
                return qz.print(cfg, data);
            }).then(function() {
                showBanner(billNum, 'qz');
            });
        }

        // Probe QZ Tray in the background right after load so the very first sale already
        // knows whether silent printing is available (qzConnectFailed) — no per-receipt stall.
        setTimeout(function() {
            qzConnect().then(function() {
                console.log('QZ Tray connected — silent printing enabled');
                showToast('Printer connected — silent printing active', '#7C3AED');
            }).catch(function() {});
        }, 400);

        function buildReceiptHtml(d, isTax, edited) {
            d=window._posReceiptTextData(d);
            var s = d.store || {}, bi = d.bill || {}, sm2 = d.summary || {};
            var cs2 = '₹';
            function f2(n) { return Number(n||0).toFixed(2); }
            var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>'
                + '<style>'
                + '@page{size:80mm auto;margin:0}'
                + 'body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000}'
                + '.rcpt{width:72mm;margin:0 auto;padding:2mm 3mm;box-sizing:border-box}'
                + '.c{text-align:center} .r{text-align:right} .b{font-weight:bold}'
                + '.sep{border-bottom:1px dashed #000;margin:4px 0}'
                + '.sep2{border-bottom:2px solid #000;margin:4px 0}'
                + 'table{width:100%;border-collapse:collapse}'
                + 'th,td{padding:2px 1px;font-size:11px}'
                + 'th{border-bottom:1px solid #000}'
                + '.hdr{font-size:8px;color:#666}'
                + '.tot{font-size:15px;font-weight:bold}'
                + '@media print{body{margin:0;padding:0}}'
                + '</style></head><body><div class="rcpt">';
            if (s.headerText) html += '<div class="c hdr">' + s.headerText + '</div>';
            html += '<div class="c b" style="font-size:16px;margin:2px 0">' + (s.name||'Store') + '</div>';
            if (s.address) html += '<div class="c hdr">' + s.address + '</div>';
            if (s.phone) html += '<div class="c hdr">Ph: ' + s.phone + '</div>';
            if (s.email) html += '<div class="c hdr">' + s.email + '</div>';
            if (isTax && s.taxReg) html += '<div class="c hdr">GSTIN: ' + s.taxReg + '</div>';
            html += '<div class="sep"></div>';
            if (isTax) {
                html += '<div class="c b" style="font-size:13px;margin:3px 0">POS TAX RECEIPT</div>';
            } else {
                html += '<div class="c b" style="font-size:13px;margin:3px 0">RECEIPT</div>';
            }
            if (edited) {
                html += '<div class="c b" style="font-size:12px;margin:3px 0;border:1px dashed #000;padding:3px 2px">** EDITED / REVISED BILL **</div>';
                html += '<div class="c hdr" style="margin-bottom:2px">Reprinted after modification</div>';
            }
            html += '<table><tr><td class="hdr" style="width:30%">Bill No:</td><td class="b">' + (bi.number||'') + '</td></tr>';
            html += '<tr><td class="hdr">Date:</td><td>' + (bi.date||'') + '</td></tr>';
            if (bi.cashier) html += '<tr><td class="hdr">Cashier:</td><td>' + bi.cashier + '</td></tr>';
            html += '<tr><td class="hdr">Customer:</td><td>' + (bi.customer||'Walk-In') + '</td></tr>';
            if (bi.customerPhone) html += '<tr><td class="hdr">Mobile:</td><td>' + bi.customerPhone + '</td></tr>';
            html += '</table>';
            html += '<div class="sep2"></div>';
            html += '<table><thead><tr><th style="text-align:center;width:16px">#</th><th style="text-align:left">Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Total</th></tr></thead><tbody>';
            (d.items||[]).forEach(function(it, idx) {
                var nm = (it.name||'') + (it.mode && it.mode !== 'Retail' ? ' <span style="font-size:8px;color:#555">['+it.mode+']</span>' : '');
                html += '<tr><td class="c">' + (idx+1) + '</td><td>' + nm + '</td><td class="c">' + (it.qty + (it.uom ? ' ' + it.uom : '')) + '</td><td class="r">' + f2(it.rate) + '</td><td class="r">' + f2(it.total) + '</td></tr>';
                if (Number(it.discount||0) > 0) html += '<tr><td colspan="5" style="font-size:9px;color:#666;padding-left:6px">' + (it.mode && it.mode !== 'Retail' ? it.mode + ' disc' : 'Disc') + ': -' + cs2 + f2(it.discount) + '</td></tr>';
            });
            html += '</tbody></table>';
            html += '<div class="sep"></div>';
            html += '<div style="font-size:10px;margin:2px 0">Total Qty: ' + sm2.totalQty + ' | Items: ' + sm2.itemCount + '</div>';
            html += '<table>';
            html += '<tr><td>Taxable (after discount)</td><td class="r">' + cs2 + f2(sm2.subtotal) + '</td></tr>';
            if (Number(sm2.discount||0) > 0) html += '<tr><td>Discount included</td><td class="r">' + cs2 + f2(sm2.discount) + '</td></tr>';
            if (isTax && Number(sm2.tax||0) > 0) {
                var halfTax = Number(sm2.tax) / 2;
                html += '<tr><td>CGST</td><td class="r">' + cs2 + f2(halfTax) + '</td></tr>';
                html += '<tr><td>SGST</td><td class="r">' + cs2 + f2(halfTax) + '</td></tr>';
            }
            if (Number(sm2.roundOff||0) !== 0) html += '<tr><td class="hdr">Round Off</td><td class="r hdr">' + f2(sm2.roundOff) + '</td></tr>';
            html += '</table>';
            html += '<div class="sep2"></div>';
            html += '<table><tr><td class="tot">' + (isTax ? 'GRAND TOTAL' : 'TOTAL') + '</td><td class="r tot">' + cs2 + f2(sm2.total) + '</td></tr></table>';
            if (isTax) html += '<div style="font-size:8px;color:#666;text-align:right;margin-top:1px">(Incl. of all taxes)</div>';
            html += '<div class="sep2"></div>';
            html += '<table>';
            (d.payments||[]).forEach(function(p) { html += '<tr><td>' + (p.method||'') + '</td><td class="r">' + cs2 + f2(p.amount) + '</td></tr>'; });
            if (Number(d.change||0) > 0) html += '<tr><td class="b">Change</td><td class="r b">' + cs2 + f2(d.change) + '</td></tr>';
            html += '</table>';
            if (d.isCredit) {
                html += '<div class="sep2"></div>';
                html += '<div class="c b" style="font-size:13px;border:1px dashed #000;padding:3px 2px">** ' + (Number(d.outstanding) > 0 ? 'CREDIT — AMOUNT DUE' : 'CREDIT — PAID IN FULL') + ' **</div>';
                html += '<table><tr><td class="b">Outstanding</td><td class="r b">' + cs2 + f2(d.outstanding) + '</td></tr></table>';
            }
            if (Number(d.saving||0) > 0) {
                html += '<div class="sep"></div>';
                html += '<div class="c b" style="font-size:12px">You Saved: ' + cs2 + f2(d.saving) + '</div>';
            }
            if (s.footerText) { html += '<div class="sep"></div><div class="c hdr" style="white-space:pre-line">' + String(s.footerText).replace(/\\r/g,'').replace(/\\n/g,'<br>').replace(/\n/g,'<br>') + '</div>'; }
            html += '<div class="c b" style="font-size:13px;margin-top:6px">Thank You !!</div>';
            html += '<div class="c" style="margin-top:6px;font-size:7px;color:#666">Powered by ZetaERP &middot; visit www.zetaclantech.com</div>';
            html += '</div>';
            return html;
        }

        function iframePrint(html, billNum) {
            html += '</body></html>';
            // Use a fresh iframe each time — Safari can hold stale state on a reused print frame
            var old = document.getElementById('pos-receipt-frame');
            if (old) { try { old.remove(); } catch(e) {} }
            var iframe = document.createElement('iframe');
            iframe.id = 'pos-receipt-frame';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
            document.body.appendChild(iframe);
            var iDoc = iframe.contentDocument || iframe.contentWindow.document;
            iDoc.open(); iDoc.write(html); iDoc.close();
            var bannerShown = false;
            function triggerBanner() { if (bannerShown) return; bannerShown = true; showBanner(billNum, 'iframe'); }
            try { iframe.contentWindow.onafterprint = triggerBanner; } catch(e) {}
            var printed = false;
            function doPrint() {
                if (printed) return; printed = true;
                try {
                    iframe.contentWindow.focus(); // Safari requires focusing the frame before print()
                    iframe.contentWindow.print();
                } catch(e) { try { window.print(); } catch(e2) {} }
            }
            // Parent-driven print works across Chrome + Safari (in-iframe window.print() is unreliable in Safari)
            iframe.onload = function() { setTimeout(doPrint, 90); };
            setTimeout(doPrint, 380); // fallback if onload doesn't fire after document.write
            setTimeout(triggerBanner, 6000);
        }

        function printReceipt(txId, billNum, taxOn, edited, preData) {
            if (!txId) return;
            var isTax = (taxOn === 'Y');
            function render(d) {
                if (!d || !d.success) return;
                var html = buildReceiptHtml(d, isTax, edited);
                if (qzReady || (typeof qz !== 'undefined' && !qzConnectFailed)) {
                    qzPrint(html + '</body></html>', billNum).catch(function(err) {
                        if (err === 'cancelled') return;
                        console.warn('QZ Tray print failed, falling back to browser print:', err);
                        iframePrint(html, billNum);
                    });
                } else {
                    iframePrint(html, billNum);
                }
            }
            // Live sale passes the receipt data straight from the payment response — no extra fetch.
            if (preData && preData.success) { render(preData); return; }
            fetch('Terminal/ajaxCart', {
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({action:'receiptData', transactionId: txId, sessionId: SI, taxOn: TO, salesModeId: SM, moquiSessionToken: TK}),
                credentials: 'same-origin'
            }).then(function(r) { return r.json(); }).then(render).catch(function(e) { console.error('Receipt print error:', e); });
        }
        // Expose so the (top-level) bill-history module can reprint an edited bill
        // using the same QZ/iframe pipeline when a session is active.
        window._posPrintReceipt = printReceipt;

        function approvedPaymentFetch(url, options) {
            return OPT.whenIdle().then(function() { options.body.set('transactionId', TX);return window.PosFreeItems.ensure(TX, TK); })
                .then(function() { return fetch(url, options); });
        }

        /* --- Cart AJAX --- */
        function post(params) {
            if (busy) return Promise.resolve(null);
            busy = true;
            params.sessionId = SI; params.taxOn = TO; params.salesModeId = SM; params.moquiSessionToken = TK;
            return fetch('Terminal/ajaxCart', {
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams(params), credentials: 'same-origin'
            }).then(function(r) { return r.json(); }).finally(function() { busy = false; });
        }

        function payBtn(method, label, bg) {
            return '<form method="post" action="Terminal/payAndComplete" class="pos-pay-form" onsubmit="return '+(method === 'Cash' ? 'posPayCash' : 'posPayDigital')+'(this)" style="margin:0">'
                + '<input type="hidden" name="transactionId" value="'+TX+'"/>'
                + '<input type="hidden" name="sessionId" value="'+SI+'"/>'
                + '<input type="hidden" name="paymentMethod" value="'+method+'"/>'
                + '<input type="hidden" name="amount" value="'+Number(lastPay || 0)+'"/>'
                + '<input type="hidden" name="salesModeId" value="'+SM+'"/>'
                + '<input type="hidden" name="customerPhone" value=""/>'
                + '<input type="hidden" name="moquiSessionToken" value="'+TK+'"/>'
                + '<button type="submit" id="pos-pay-'+method.toLowerCase()+'" style="width:100%;padding:clamp(8px,1.4vh,15px) 8px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:'+bg+';color:#fff">'+label+'</button></form>';
        }
        function actionBtn(action, label, bg, conf) {
            return '<form method="post" action="Terminal/'+action+'" style="margin:0">'
                + '<input type="hidden" name="transactionId" value="'+TX+'"/>'
                + '<input type="hidden" name="sessionId" value="'+SI+'"/>'
                + '<input type="hidden" name="taxOn" value="'+TO+'"/>'
                + '<input type="hidden" name="salesModeId" value="'+SM+'"/>'
                + '<input type="hidden" name="moquiSessionToken" value="'+TK+'"/>'
                + '<button type="submit"'+(action==='holdSale'?' id="pos-hold"':action==='voidSale'?' id="pos-void"':'')+' style="width:100%;padding:clamp(7px,1.2vh,13px) 8px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:'+bg+';color:#fff"'
                + (conf ? ' onclick="return confirm(\''+conf+'\')"' : '') + '>'+label+'</button></form>';
        }
        function referencePayments(d) {
            var disabled = !d.items.length;
            var badge = function(key) { return '<kbd>'+key+'</kbd>'; };
            var html = '<div class="pos-paywrap pos-reference-payments">'
                + '<button type="button" id="pos-discount" class="pos-discount-btn">&#127991; DISCOUNT / ROUND-OFF'+badge('F1')+'</button>'
                + '<button type="button" id="pos-pay-cash" class="pos-cash-btn">&#128176; CASH'+badge('F2')+'</button>'
                + payBtn('Card','&#128179; CARD'+badge('F3'),'#009dff')
                + '<button id="pos-credit" type="button" onclick="posCreditSale()">&#128196; CREDIT'+badge('F4')+'</button>'
                + payBtn('UPI','&#128241; UPI'+badge('F5'),'#9518dd')
                + '<button id="pos-split" type="button" class="pos-split-btn">&#8596; SPLIT PAYMENT'+badge('F6')+'</button>'
                + actionBtn('holdSale','&#10074;&#10074; HOLD'+badge('F7'),'#ff9b00')
                + actionBtn('voidSale','&#10005; VOID / CANCEL'+badge('F8'),'#ff3f49','Void this sale?')
                + '<button id="pos-copilot" type="button" onclick="posCheckoutCopilot()">&#9635; AI Copilot</button></div>';
            if (disabled) html=html.replace(/<button(?![^>]*id="pos-copilot")/g,'<button disabled');
            return html;
        }

        function buildSummary(d) {
            extractHeldInfo(document); // keep held count/id in sync with the live header badge
            var modeLabel = SM ? (SM.charAt(0).toUpperCase() + SM.slice(1).toLowerCase()) : 'Retail';
            var sh = '<div class="pos-sum-strip" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                + lastCompletedMarkup()
                + '<div style="display:flex;gap:16px;font-size:14px">'
                + '<span style="color:#555">Qty: <b id="posSumQty">'+fmt(d.tQty)+'</b></span>'
                + '<span style="color:#555">Tax: <b id="posSumTax">'+fmt(d.tax)+'</b></span>'
                + '<span style="color:#555">Disc: <b id="posSumDisc">'+fmt(d.disc)+'</b></span>'
                + '</div></div>'
                + '<div class="pos-sum-total" style="background:#7C3AED;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
                + '<span style="font-size:16px;font-weight:600">'+modeLabel+' TOTAL</span>'
                + '<span id="posSumTotal" style="font-size:28px;font-weight:800;letter-spacing:1px">'+CS+fmt2(d.pay)+'</span></div>';
            if (document.querySelector('.pos-checkout-reference')) return sh + referencePayments(d);
            sh += '<div class="pos-paywrap">';
            if (d.items.length > 0) {
                sh += '<button type="button" class="pos-discount-btn" style="display:block;width:100%;padding:clamp(7px,1.1vh,12px) 8px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;background:#6a1b9a;color:#fff;border:none;text-align:center;margin-bottom:8px;box-sizing:border-box">&#127991;&#65039; DISCOUNT / ROUND-OFF</button>';
                sh += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">'
                    + '<button type="button" class="pos-cash-btn" style="width:100%;padding:clamp(8px,1.4vh,15px) 8px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#4caf50;color:#fff">&#128176; CASH</button>'
                    + payBtn('Card','&#128179; CARD','#2196f3')
                    + payBtn('UPI','&#128241; UPI','#9c27b0') + '</div>'
                    + '<button type="button" class="pos-split-btn" style="display:block;width:100%;padding:clamp(7px,1.2vh,13px) 8px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#7C3AED;color:#fff;border:none;text-align:center;margin-bottom:8px;box-sizing:border-box">&#8596; SPLIT PAYMENT</button>'
                    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr'+(heldCount > 0 ? ' 1fr' : '')+';gap:8px">'
                    + '<button type="button" onclick="posCreditSale()" style="width:100%;padding:clamp(7px,1.2vh,13px) 4px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;background:#e65100;color:#fff;border:none;text-align:center;box-sizing:border-box">&#128196; CREDIT</button>'
                    + actionBtn('holdSale','HOLD','#ff9800')
                    + actionBtn('voidSale','VOID / CANCEL','#f44336','Void this sale?')
                    + (heldCount > 0 && heldId ? recallBtn() : '')
                    + '</div>';
            } else {
                sh += '<div style="text-align:center;padding:16px;color:#aaa;font-size:16px">Tap products to add items</div>';
                if (heldCount > 0 && heldId) sh += '<div style="margin-top:8px">' + recallBtn() + '</div>';
            }
            sh += '</div>';
            return sh;
        }

        function buildSplitPanel() {
            var modeLabel = SM ? (SM.charAt(0).toUpperCase() + SM.slice(1).toLowerCase()) : 'Retail';
            return '<div class="pos-sum-strip" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                + lastCompletedMarkup()
                + '<div style="display:flex;gap:16px;font-size:14px">'
                + '<span style="color:#555">Qty: <b>'+(lastCartData ? fmt(lastCartData.tQty) : '0')+'</b></span>'
                + '<span style="color:#555">Tax: <b>'+(lastCartData ? fmt(lastCartData.tax) : '0')+'</b></span>'
                + '<span style="color:#555">Disc: <b>'+(lastCartData ? fmt(lastCartData.disc) : '0')+'</b></span>'
                + '</div></div>'
                + '<div class="pos-sum-total" style="background:#7C3AED;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
                + '<span style="font-size:16px;font-weight:600">'+modeLabel+' TOTAL</span>'
                + '<span style="font-size:28px;font-weight:800;letter-spacing:1px">'+CS+fmt(lastPay)+'</span></div>'
                + '<div class="pos-split-panel" style="border:2px solid #7C3AED;border-radius:10px;padding:14px;background:#ECE8FB">'
                + '<div style="text-align:center;font-size:17px;font-weight:700;color:#7C3AED;margin-bottom:6px">SPLIT PAYMENT</div>'
                + '<div style="text-align:center;font-size:24px;font-weight:800;color:#333;margin-bottom:14px">Total: '+CS+fmt(lastPay)+'</div>'
                + '<form method="post" action="Terminal/splitPayAndComplete" class="pos-split-form" style="margin:0">'
                + '<input type="hidden" name="transactionId" value="'+TX+'"/>'
                + '<input type="hidden" name="sessionId" value="'+SI+'"/>'
                + '<input type="hidden" name="taxOn" value="'+TO+'"/>'
                + '<input type="hidden" name="salesModeId" value="'+SM+'"/>'
                + '<input type="hidden" name="customerPhone" value=""/>'
                + '<input type="hidden" name="moquiSessionToken" value="'+TK+'"/>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
                + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#2e7d32;text-align:right">&#128176; Cash</span>'
                + '<input type="number" name="cashAmount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #4caf50;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
                + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#7C3AED;text-align:right">&#128179; Card</span>'
                + '<input type="number" name="cardAmount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #2196f3;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-left:65px">'
                + '<input type="text" name="cardRef" placeholder="Card reference #" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
                + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#7b1fa2;text-align:right">&#128241; UPI</span>'
                + '<input type="number" name="upiAmount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #9c27b0;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-left:65px">'
                + '<input type="text" name="upiRef" placeholder="UPI reference #" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<button type="submit" style="width:100%;padding:16px;background:#7C3AED;color:#fff;border:none;border-radius:10px;font-size:17px;font-weight:700;cursor:pointer;margin-bottom:8px">&#10003; CONFIRM SPLIT</button>'
                + '</form>'
                + '<button type="button" class="pos-split-cancel" style="display:block;width:100%;text-align:center;padding:12px;background:#f5f5f5;border:none;border-radius:8px;color:#666;font-size:14px;font-weight:600;cursor:pointer">&#10006; CANCEL</button>'
                + '</div>';
        }

        function cashQuickBtns(total) {
            var seen = {}, amounts = [], steps = [1, 10, 50, 100, 500, 1000];
            amounts.push(total); seen[total] = true;
            for (var i = 0; i < steps.length; i++) {
                var r = Math.ceil(total / steps[i]) * steps[i];
                if (r > total && !seen[r]) { amounts.push(r); seen[r] = true; }
                if (amounts.length >= 5) break;
            }
            var h = '';
            for (var i = 0; i < amounts.length; i++) {
                h += '<button type="button" class="pos-cash-quick" data-amt="'+amounts[i]+'" style="padding:10px 16px;border:1px solid #4caf50;border-radius:8px;background:#fff;color:#2e7d32;font-size:15px;font-weight:700;cursor:pointer">'
                    + CS + fmt(amounts[i]) + '</button>';
            }
            return h;
        }

        function buildCashPanel() {
            var modeLabel = SM ? (SM.charAt(0).toUpperCase() + SM.slice(1).toLowerCase()) : 'Retail';
            return '<div class="pos-sum-strip" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                + lastCompletedMarkup()
                + '<div style="display:flex;gap:16px;font-size:14px">'
                + '<span style="color:#555">Qty: <b>'+(lastCartData ? fmt(lastCartData.tQty) : '0')+'</b></span>'
                + '<span style="color:#555">Tax: <b>'+(lastCartData ? fmt(lastCartData.tax) : '0')+'</b></span>'
                + '<span style="color:#555">Disc: <b>'+(lastCartData ? fmt(lastCartData.disc) : '0')+'</b></span>'
                + '</div></div>'
                + '<div class="pos-sum-total" style="background:#7C3AED;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
                + '<span style="font-size:16px;font-weight:600">'+modeLabel+' TOTAL</span>'
                + '<span style="font-size:28px;font-weight:800;letter-spacing:1px">'+CS+fmt(lastPay)+'</span></div>'
                + '<div class="pos-cash-panel" style="border:2px solid #4caf50;border-radius:10px;padding:14px;background:#e8f5e9">'
                + '<div style="text-align:center;font-size:17px;font-weight:700;color:#2e7d32;margin-bottom:6px">CASH PAYMENT</div>'
                + '<div style="text-align:center;font-size:24px;font-weight:800;color:#333;margin-bottom:14px">Bill: '+CS+fmt(lastPay)+'</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
                + '<span style="min-width:80px;font-size:14px;font-weight:700;color:#2e7d32;text-align:right">Received</span>'
                + '<input type="number" class="pos-cash-input" value="" placeholder="Enter amount" step="any" min="0" onfocus="this.select()" autofocus style="flex:1;padding:14px 10px;border:2px solid #4caf50;border-radius:8px;font-size:22px;text-align:right;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div class="pos-cash-change" style="text-align:center;font-size:20px;font-weight:700;margin-bottom:12px;min-height:32px"></div>'
                + '<button type="button" class="pos-cash-confirm" disabled style="width:100%;padding:16px;background:#4caf50;color:#fff;border:none;border-radius:10px;font-size:17px;font-weight:700;cursor:pointer;margin-bottom:8px;opacity:0.5">&#128176; CONFIRM PAYMENT</button>'
                + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;justify-content:center">'
                + cashQuickBtns(lastPay) + '</div>'
                + '<button type="button" class="pos-cash-cancel" style="display:block;width:100%;text-align:center;padding:12px;background:#f5f5f5;border:none;border-radius:8px;color:#666;font-size:14px;font-weight:600;cursor:pointer">&#10006; CANCEL</button>'
                + '</div>';
        }

        function cartText(value) { return window._posReceiptTextData(String(value == null ? '' : value)); }

        function recoverClosedCart() {
            // A completed/voided transaction must never remain the live cart after a
            // delayed tab, payment redirect or History action. Reload without its ID;
            // the server will select this session's open cart, if one exists.
            TX = '';
            lastCartData = null;
            document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { el.value = ''; });
            var url = new URL(window.location.href);
            url.searchParams.delete('transactionId');
            url.searchParams.delete('lastCompletedId');
            window.location.replace(url.href);
        }

        var cartFrame = 0;
        function queueCartRender() {
            if (cartFrame) return;
            cartFrame = requestAnimationFrame(function() {
                cartFrame = 0;
                if (af.isConnected) renderCart(lastCartData);
            });
        }
        // Keep stable rows connected: replacing tbody on each tap discarded other line drafts
        // and forced the browser to lay out every control again, even for an unchanged reply.
        function patchCartRows(body, rows) {
            var existing = new Map(), wanted = new Set(rows.map(function(item) { return item.key; }));
            Array.from(body.children).forEach(function(row) {
                if (wanted.has(row.dataset.posLineKey)) existing.set(row.dataset.posLineKey, row);
                else row.remove();
            });
            rows.forEach(function(item, index) {
                var row = existing.get(item.key);
                if (row) existing.delete(item.key);
                else { row = document.createElement('tr'); row.dataset.posLineKey = item.key; }
                if (row._posMarkup !== item.html) {
                    var next = document.createElement('tr'), cells = [];
                    next.innerHTML = item.html;
                    Array.from(next.children).forEach(function(cell, index) {
                        cells.push(cell.outerHTML);
                        if (!row.children[index]) row.appendChild(cell);
                        else if (!row._posCells || row._posCells[index] !== cells[index]) row.replaceChild(cell, row.children[index]);
                    });
                    while (row.children.length > cells.length) row.lastElementChild.remove();
                    row._posCells = cells;
                    row._posMarkup = item.html;
                    row.style.borderBottom = '1px solid #e0e0e0';
                }
                if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
            });
            existing.forEach(function(row) { row.remove(); });
        }

        function renderCart(d) {
            if (cartFrame) { cancelAnimationFrame(cartFrame); cartFrame = 0; }
            if (d && d.cartClosed) { recoverClosedCart(); return; }
            if (!d || !d.success) { if (d && d.error) alert(d.error); return; }
            TX = d.transactionId || '';
            document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { if (el.value !== TX) el.value = TX; });
            syncModeLinks();
            var tb = document.querySelector('.pos-cart tbody');
            if (!tb) return;
            var h = '', rows = [];
            if (d.items.length === 0) {
                h = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#aaa;font-size:16px">Tap products to add items</td></tr>';
            }
            d.items.forEach(function(it, idx) {
                h = '';
                h += '<td style="padding:3px 10px;text-align:center;font-size:13px;font-weight:700;color:#777;vertical-align:middle;width:30px">'+(idx+1)+'</td>';
                // Mode chip in its own column, coloured by sale mode (Retail blue / Wholesale orange / Custom teal)
                var modeCell = '-';
                if (d.modes && d.modes.length) {
                    var _cm = null; for (var _mi = 0; _mi < d.modes.length; _mi++) { if (d.modes[_mi].id === it.mode) { _cm = d.modes[_mi]; break; } }
                    if (!_cm) _cm = d.modes.find(function(m){return m.id===SM;}) || d.modes[0];
                    var _mn = _cm ? _cm.name : '';
                    var _cbg = '#DBEAFE', _cfg = '#2563EB';
                    if (/whole/i.test(_mn)) { _cbg = '#FFEDD5'; _cfg = '#EA580C'; }
                    else if (/custom/i.test(_mn)) { _cbg = '#D5F0EC'; _cfg = '#0F766E'; }
                    if (d.modes.length > 1) {
                        var mo = '';
                        d.modes.forEach(function(m){ mo += '<option value="'+cartText(m.id)+'"'+((it.mode||SM)===m.id?' selected':'')+'>'+cartText(m.name)+(Number(m.disc)>0?(' −'+Number(m.disc)+'%'):'')+'</option>'; });
                        modeCell = '<select class="aj-mode" data-seq="'+cartText(it.seq)+'" title="Sale mode for this item" style="font-size:12px;font-weight:600;padding:3px 6px;border:1px solid '+_cbg+';border-radius:6px;background:'+_cbg+';color:'+_cfg+';cursor:pointer;max-width:120px">'+mo+'</select>';
                    } else {
                        modeCell = '<span style="display:inline-block;font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px;background:'+_cbg+';color:'+_cfg+'">'+cartText(_mn)+'</span>';
                    }
                }
                h += '<td style="padding:3px 10px"><div style="font-size:14px;font-weight:600;color:#000;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+cartText(it.name)+'</div><div style="font-size:11px;color:#555">'+cartText(it.pid)+'</div>'+(((document.getElementById('pos-free-item-approval')||{}).value==='Y' && (Number(it.price)<=0 || Number(it.total)<=0))?'<small style="display:block;color:#92400e;font-weight:600">Free item · manager approval</small>':'')+'</td>';
                h += '<td style="padding:3px 8px;text-align:left;vertical-align:middle">'+modeCell+'</td>';
                h += '<td style="padding:4px 4px;text-align:right;vertical-align:middle"><div style="display:flex;align-items:center;gap:3px;justify-content:flex-end">';
                var priceCapability = document.getElementById('pos-price-override-allowed');
                var priceAllowed = !priceCapability || priceCapability.value === 'Y';
                h += '<input type="text" inputmode="decimal" value="'+Number(it.price)+'" data-seq="'+cartText(it.seq)+'" class="aj-p" '+(priceAllowed?'':'readonly title="POS write permission is required to change a bill price."')+' style="width:65px;padding:8px 6px;border:1px solid #ccc;border-radius:6px;font-size:14px;text-align:right;background:#fff;color:#000;box-sizing:border-box"/>';
                h += '<button data-seq="'+cartText(it.seq)+'" class="aj-pb" '+(priceAllowed?'':'disabled title="POS write permission is required to change a bill price."')+' style="width:32px;height:32px;border:none;background:#7C3AED;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0">&#10003;</button>';
                h += '</div></td>';
                h += '<td style="padding:4px;text-align:center;vertical-align:middle"><div style="display:flex;align-items:center;justify-content:center;gap:0">';
                h += '<button data-seq="'+cartText(it.seq)+'" data-q="'+(Number(it.qty)-1)+'" class="aj-q" style="width:34px;height:34px;border:2px solid #e53935;background:#fff;font-size:19px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:8px 0 0 8px;color:#e53935">-</button>';
                h += '<input type="number" step="any" value="'+Number(it.qty)+'" data-seq="'+cartText(it.seq)+'" class="aj-qi" style="width:58px;text-align:center;font-weight:bold;font-size:16px;border-top:2px solid #ccc;border-bottom:2px solid #ccc;border-left:none;border-right:none;height:34px;background:#fff;color:#000;outline:none;box-sizing:border-box"/>';
                h += '<button data-seq="'+cartText(it.seq)+'" data-q="'+(Number(it.qty)+1)+'" class="aj-q" style="width:34px;height:34px;border:2px solid #2e7d32;background:#fff;font-size:19px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:0 8px 8px 0;color:#2e7d32">+</button>';
                if (it.uom) h += '<span class="pos-cart-uom" style="font-size:11px;color:#e65100;font-weight:700;margin-left:5px;white-space:nowrap;flex-shrink:0">'+cartText(it.uom)+'</span>';
                h += '</div>';
                h += '</td>';
                h += '<td style="padding:3px 10px;text-align:right;font-size:14px;color:#6B7280;vertical-align:middle">'+Number(it.tax||0).toFixed(3)+'</td>';
                h += '<td style="padding:3px 10px;text-align:right;font-size:15px;font-weight:700;color:#000;vertical-align:middle">'+fmt2(it.total)+'</td>';
                h += '<td style="padding:4px 6px;text-align:center;vertical-align:middle"><button data-seq="'+cartText(it.seq)+'" class="aj-rm" style="width:32px;height:32px;border:none;background:#e53935;color:#fff;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;padding:0" title="Remove item">&#10005;</button></td>';
                rows.push({key:String(it.seq), html:h});
            });
            var _cs = document.getElementById('cartScroll'); var _ps = _cs ? _cs.scrollTop : 0; var _pc = (lastCartData && lastCartData.items) ? lastCartData.items.length : 0;
            if (d.items.length) patchCartRows(tb, rows);
            else tb.innerHTML = h;
            if (_cs) { if (d.items.length > _pc) _cs.scrollTop = _cs.scrollHeight; else _cs.scrollTop = _ps; }
            /* ZE-BC-091: after any cart re-render, return focus to the barcode search box so scanning
               survives a qty/price/remove button click (the reported "scanner dead after changing qty
               until the input is clicked" bug). Skip if the user is in a form field (editing qty/price
               inline, a modal, etc.) so we never yank focus mid-edit. */
            try { var _ae = document.activeElement; if (!(_ae && (_ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA' || _ae.tagName === 'SELECT'))) { var _sib = document.getElementById('cartInlineSearch'); if (_sib) _sib.focus(); } } catch (e) {}
            var sm = document.querySelector('.pos-summary');
            if (sm) {
                extractHeldInfo(document);
                var _sig = (d.items.length > 0 ? '1' : '0') + ':' + heldCount + ':' + (heldId ? '1' : '0');
                var _q = sm.querySelector('#posSumQty');
                if (_q && sm.getAttribute('data-sig') === _sig) {
                    _q.textContent = fmt(d.tQty);
                    var _tx = sm.querySelector('#posSumTax'); if (_tx) _tx.textContent = fmt(d.tax);
                    var _dc = sm.querySelector('#posSumDisc'); if (_dc) _dc.textContent = fmt(d.disc);
                    var _tt = sm.querySelector('#posSumTotal'); if (_tt) _tt.innerHTML = CS + (document.querySelector('.pos-checkout-reference') ? fmt2(d.pay) : fmt(d.pay));
                } else {
                    sm.innerHTML = buildSummary(d);
                    sm.setAttribute('data-sig', _sig);
                }
            }
            // Mirror authoritative and optimistic cart changes in the visible side summary.
            var sideCount = document.getElementById('pos-side-item-count');
            if (sideCount) sideCount.textContent = 'Subtotal (' + d.items.length + ' item' + (d.items.length === 1 ? '' : 's') + ')';
            [['pos-side-subtotal', d.sub], ['pos-side-discount', d.disc], ['pos-side-tax', d.tax], ['pos-side-round', d.round]].forEach(function(pair) {
                var value = document.getElementById(pair[0]);
                if (value) value.textContent = CS + fmt2(pair[1] || 0);
            });
            document.querySelectorAll('.pos-pay-form input[name="amount"]').forEach(function(el) { el.value = d.pay; });
            document.querySelectorAll('.pos-pay-form input[name="transactionId"]').forEach(function(el) { if (el.value !== TX) el.value = TX; });
            var bn = document.getElementById('pos-bill-badge');
            if (bn) {
                if (d.txnNum) bn.dataset.lastBill = d.txnNum;
                bn.textContent = bn.dataset.lastBill || '—';
                bn.classList.toggle('nb-billno__new', !bn.dataset.lastBill);
            }
            lastTxnNum = d.txnNum || '';
            lastPay = d.pay || 0;
            lastCartData = d;
            // Keep the header customer chip in sync with the authoritative cart
            var _cn = document.getElementById('pos-cust-name');
            if (_cn) _cn.textContent = (d.customer && d.customer.length) ? d.customer : 'Walk-In';
        }

        function lastCompletedMarkup() {
            var bill = document.getElementById('pos-bill-badge');
            return '<div id="pos-last-completed" style="font-size:13px;color:#777">Last: '
                + cartText(bill && bill.dataset.sessionLastBill || '-') + ' / '
                + cartText(bill && bill.dataset.sessionLastAmount || '0') + '</div>';
        }

        function resetCompletedCart() {
            // Reset the live model and any scheduled optimistic paint before the next tap.
            // The receipt keeps its own completed-bill payload.
            renderCart({success:true, transactionId:'', items:[], sub:0, tax:0, disc:0,
                tQty:0, grand:0, pay:0, round:0, modes:lastCartData && lastCartData.modes || []});
            // Checkout leaves an empty cart. A refresh must not reopen the completed
            // transaction still present in the original cashier URL.
            var current = new URL(window.location.href);
            if (current.searchParams.has('transactionId')) {
                current.searchParams.delete('transactionId');
                history.replaceState(history.state, '', current.pathname + current.search + current.hash);
            }
        }

        function syncIssuedBillHeader(doc) {
            var sourceBill = doc.querySelector('#pos-bill-badge');
            var bill = document.getElementById('pos-bill-badge');
            if (sourceBill && bill) {
                bill.dataset.lastBill = sourceBill.dataset.lastBill || '';
                bill.dataset.sessionLastBill = sourceBill.dataset.sessionLastBill || '-';
                bill.dataset.sessionLastAmount = sourceBill.dataset.sessionLastAmount || '0';
                bill.textContent = sourceBill.textContent;
                bill.classList.toggle('nb-billno__new', !bill.dataset.lastBill);
            }
            var lastSummary = document.getElementById('pos-last-completed');
            if (lastSummary && bill) lastSummary.textContent = 'Last: '
                + (bill.dataset.sessionLastBill || '-') + ' / ' + (bill.dataset.sessionLastAmount || '0');
            var sourceCount = doc.querySelector('#pos-today-bills');
            var count = document.getElementById('pos-today-bills');
            if (sourceCount && count) {
                count.textContent = sourceCount.textContent;
                count.dataset.day = sourceCount.dataset.day;
            }
        }

        /* ============================================================
           Optimistic cart engine — instant local echo + coalesced,
           never-dropped background sync. Makes the terminal feel offline:
           every tap updates the cart immediately, the server call happens
           in the background. The server still recomputes payableAmount from
           the DB line items and refuses to complete an underpaid bill
           (complete#PosTransaction), so optimistic numbers can NEVER change
           what is charged — they only hide the ~0.8s round-trip. Any per-op
           error falls back to a plain server-authoritative post()->renderCart().
           Money model (matches recalculate#TransactionTotals):
             grand = Σ(line.total) + taxK·Σ(line.tax);  pay = round(grand)
           taxK self-calibrates from each authoritative reply (=1 when the
           server keeps tax separate, 0 when line totals are tax-inclusive).
           ============================================================ */
        var OPT = (function () {
            var COALESCE = true;    // strict FIFO is provably order-safe; coalescing reorders absolute/relative ops
            var taxK = 1, tmp = 0;
            var q = [];               // pending server ops (FIFO; qty/price/add coalesced)
            var inflight = false;
            var idleWaiters = [];
            function notifyIdle() {
                if (inflight || q.length) return;
                idleWaiters.splice(0).forEach(function(resolve) { resolve(); });
            }
            var tmpMeta = {};         // tmpSeq -> {pid, mode}  (lines not yet saved server-side)
            var realByTmp = {};       // tmpSeq -> real itemSeqId (filled when its add completes)
            var claimed = {};         // real itemSeqId -> true (already assigned to a temp line)

            function n(x) { return Number(x) || 0; }
            function isTmp(s) { return String(s).indexOf('t#') === 0; }
            function lc() { return lastCartData; }
            function bySeq(s) { var L = lc(); if (!L) return null; for (var i = 0; i < L.items.length; i++) if (String(L.items[i].seq) === String(s)) return L.items[i]; return null; }
            function byPid(pid, mode) { var L = lc(); if (!L) return null; for (var i = 0; i < L.items.length; i++) { var it = L.items[i]; if (String(it.pid) === String(pid) && String(it.mode || '') === String(mode || '')) return it; } return null; }

            function recompute() {
                var L = lc(); if (!L) return;
                var st = 0, sx = 0, tq = 0;
                L.items.forEach(function (it) { st += n(it.total); sx += n(it.tax); tq += n(it.qty); });
                L.sub = st; L.tax = sx; L.tQty = tq; L.grand = st + taxK * sx; L.pay = Math.round(L.grand);
            }
            function calibrate(d) {
                var st = 0, sx = 0; (d.items || []).forEach(function (it) { st += n(it.total); sx += n(it.tax); });
                var g = (d.grand != null) ? n(d.grand) : n(d.pay);
                if (sx > 0) { var k = (g - st) / sx; if (k > -0.05 && k < 2) taxK = k; }
            }
            // Resolve a just-completed addItem's temp line to the real itemSeqId it
            // created. Matching by product alone is AMBIGUOUS when the same product
            // was removed and re-added (the old, now-deleted seq still matches), so
            // we claim the response line for this product+mode whose seq we have not
            // already assigned to another temp line. Tying the mapping to THIS add's
            // completion (FIFO single-flight => its removeItem already ran) makes it
            // unambiguous.
            function mapAdd(op, d) {
                if (!op.ts || realByTmp[op.ts]) return;
                var meta = tmpMeta[op.ts]; if (!meta) return;
                for (var i = 0; i < d.items.length; i++) {
                    var s = d.items[i];
                    if (String(s.pid) === String(meta.pid) && String(s.mode || '') === String(meta.mode || '') && !claimed[s.seq]) {
                        realByTmp[op.ts] = s.seq; claimed[s.seq] = true; return;
                    }
                }
            }
            // Propagate every known temp->real seq to the live cart and queued ops.
            function applyRealSeqs() {
                var L = lc();
                if (L) L.items.forEach(function (it) { if (isTmp(it.seq) && realByTmp[it.seq]) it.seq = realByTmp[it.seq]; });
                q.forEach(function (op) { if (op.seq && isTmp(op.seq) && realByTmp[op.seq]) op.seq = realByTmp[op.seq]; });
            }

            function paramsFor(op) {
                var b = { action: op.action, transactionId: TX, sessionId: SI, taxOn: TO, salesModeId: SM, moquiSessionToken: TK };
                if (op.action === 'addItem') { b.productId = op.pid; b.unitPrice = op.price; b.addQty = op.addQty || 1; }
                else if (op.action === 'updateQty') { b.itemSeqId = op.seq; b.newQty = op.newQty; }
                else if (op.action === 'updatePrice') { b.itemSeqId = op.seq; b.newPrice = op.newPrice; }
                else if (op.action === 'removeItem') { b.itemSeqId = op.seq; }
                else if (op.action === 'setItemMode') { b.itemSeqId = op.seq; b.itemMode = op.mode; }
                else if (op.action === 'scanAdd') { b.cartSearch = op.code; }
                return b;
            }
            function drain() {
                if (inflight || !q.length) return;
                var op = q[0];
                if (op.needSeq) {
                    if (isTmp(op.seq) && realByTmp[op.seq]) op.seq = realByTmp[op.seq];
                    if (isTmp(op.seq)) return;   // its addItem is still in flight — retry after that reconciles
                }
                inflight = true;
                fetch('Terminal/ajaxCart', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(paramsFor(op)), credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        inflight = false; var done = q.shift();
                        if (d && d.success) {
                            if (d.transactionId) {
                                // Item sequence numbers restart per bill; prior claims must not
                                // strand a rapid edit queued behind the first add of the next bill.
                                if (d.transactionId !== TX) { claimed = {}; realByTmp = {}; }
                                TX = d.transactionId;
                                document.querySelectorAll('input[name="transactionId"]').forEach(function (el) { el.value = TX; }); syncModeLinks();
                            }
                            calibrate(d);
                            if (done.action === 'addItem') mapAdd(done, d);
                            applyRealSeqs();
                            if (q.length === 0) renderCart(d);   // unchanged cells retain drafts while totals settle
                        } else {
                            if (d && d.cartClosed) { q.length = 0; recoverClosedCart(); return; }
                            // server rejected this op (e.g. product has no price in the active sales
                            // mode): undo the purely-optimistic line so the cart can't drift from server.
                            if (done.action === 'addItem' && done.ts) {
                                var L0 = lc();
                                if (L0) { for (var ri = L0.items.length - 1; ri >= 0; ri--) { if (String(L0.items[ri].seq) === String(done.ts)) L0.items.splice(ri, 1); } delete tmpMeta[done.ts]; }
                                for (var rj = q.length - 1; rj >= 0; rj--) { if (q[rj].lineKey === done.lineKey) q.splice(rj, 1); }
                                recompute(); renderCart(lc());
                            }
                            if (d && d.error) { try { var _et = document.createElement('div'); _et.textContent = '⚠ ' + d.error; _et.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:9999999;background:#c62828;color:#fff;padding:13px 24px;border-radius:10px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,0.3);max-width:90vw;text-align:center'; document.body.appendChild(_et); setTimeout(function () { _et.remove(); }, 3500); } catch (e) {} }
                        }
                        drain();
                        notifyIdle();
                    })
                    .catch(function () { inflight = false; q.shift(); drain(); notifyIdle(); });
            }
            function mergeable(i) { return !(i === 0 && inflight); }
            // Coalesce ONLY with the most-recent pending op on the same line, and
            // only when it is the same action. addItem is a relative delta and
            // updateQty an absolute set, so merging across an intervening op of the
            // other type would reorder them (set-then-add must stay set-then-add).
            // Looking only at the line's latest queued op preserves that order while
            // still collapsing the common case of mashing one control.
            function lastIdxForLine(key) { for (var i = q.length - 1; i >= 0; i--) if (q[i].lineKey === key) return i; return -1; }
            function enqueue(op) {
                if (COALESCE) {
                    var i = lastIdxForLine(op.lineKey);
                    if (i >= 0 && mergeable(i) && q[i].action === op.action) {
                        if (op.action === 'addItem') { q[i].addQty = (q[i].addQty || 1) + (op.addQty || 1); drain(); return; }
                        if (op.action === 'updateQty' || op.action === 'updatePrice') { op.needSeq = q[i].needSeq; q[i] = op; drain(); return; }
                    }
                }
                q.push(op); drain();
            }

            function doAdd(pid, price, name, uom) {
                var L = lc();
                // First item of a fresh bill: no cart/transaction yet. Start a local cart
                // and render instantly; the addItem goes out with an empty transactionId,
                // the server CREATES the transaction and returns its id, and single-flight
                // FIFO makes every later op wait and adopt it.
                if (!L) { L = { success: true, transactionId: TX || '', items: [], disc: 0 }; lastCartData = L; }
                var ln = byPid(pid, SM || ''); var newTs = null;
                if (ln && n(ln.qty) > 0) { var f = (n(ln.qty) + 1) / n(ln.qty); ln.qty = n(ln.qty) + 1; ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f; }
                else { newTs = 't#' + (++tmp); tmpMeta[newTs] = { pid: pid, mode: SM || '' }; ln = { seq: newTs, pid: pid, name: name || pid, price: n(price), qty: 1, total: n(price), tax: 0, disc: 0, mode: SM || '', uom: uom || '' }; L.items.push(ln); }
                recompute(); queueCartRender();
                enqueue({ action: 'addItem', pid: pid, price: price, mode: SM || '', addQty: 1, ts: newTs, lineKey: pid + '|' + (SM || '') });
            }
            function doQty(seq, newQty) {
                newQty = Number(newQty);
                // ZETAERP-POS-CART-001: on session RE-ENTRY the optimistic model (lastCartData) is unseeded
                // (null) while the server rendered the persisted rows, so bySeq can't find a line. THROW so the
                // OPT.* wrapper's catch posts the edit straight to the server (TX is seeded from the cart form)
                // and reseeds the model via renderCart — otherwise a silent return leaves the control "dead".
                var ln = bySeq(seq); if (!ln) throw 'pos-reseed';
                // A quantity edit must NEVER delete the line — a decimal/cleared/0 value that
                // resolved while typing would silently drop the item. Revert to the authoritative
                // cart instead; removal is only via the explicit × (remove) button.
                if (!(newQty > 0)) { renderCart(lc()); return; }
                var f = newQty / n(ln.qty); ln.qty = newQty; ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f;
                recompute(); renderCart(lc());
                enqueue({ action: 'updateQty', seq: ln.seq, newQty: newQty, needSeq: true, lineKey: ln.pid + '|' + (ln.mode || '') });
            }
            function doPrice(seq, newPrice) {
                newPrice = Number(newPrice);
                var ln = bySeq(seq); if (!ln) throw 'pos-reseed';   // ZETAERP-POS-CART-001: unseeded re-entry model → server fallback (see doQty)
                var f = n(ln.price) > 0 ? newPrice / n(ln.price) : 0;
                ln.price = newPrice;
                if (f > 0) { ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f; } else { ln.total = newPrice * n(ln.qty); ln.tax = 0; }
                recompute(); renderCart(lc());
                enqueue({ action: 'updatePrice', seq: ln.seq, newPrice: newPrice, needSeq: true, lineKey: ln.pid + '|' + (ln.mode || '') });
            }
            function doRemove(seq) {
                var L = lc(); if (!L) throw 'pos-reseed';   // ZETAERP-POS-CART-001: unseeded re-entry model → server-side remove fallback (see doQty)
                var ln = bySeq(seq); var key = ln ? (ln.pid + '|' + (ln.mode || '')) : ('rm#' + seq);
                L.items = L.items.filter(function (it) { return String(it.seq) !== String(seq); });
                recompute(); renderCart(L);
                enqueue({ action: 'removeItem', seq: seq, needSeq: true, lineKey: key });
            }
            function doMode(seq, mode) {
                // per-item sales-mode reprices server-side by discount rules -> no safe optimistic value
                var ln = bySeq(seq); var key = ln ? (ln.pid + '|' + (ln.mode || '')) : ('mode#' + seq);
                enqueue({ action: 'setItemMode', seq: seq, mode: mode, needSeq: true, lineKey: key });
            }
            var scanN = 0;
            function doScan(code) { enqueue({ action: 'scanAdd', code: code, lineKey: 'scan#' + (++scanN) }); }

            return {
                add: function (pid, price, name, uom) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doAdd(pid, price, name, uom); } catch (e) { post({ action: 'addItem', transactionId: TX, productId: pid, unitPrice: price, addQty: 1 }).then(renderCart); } },
                qty: function (seq, q2) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doQty(seq, q2); } catch (e) { post({ action: Number(q2) <= 0 ? 'removeItem' : 'updateQty', transactionId: TX, itemSeqId: seq, newQty: q2 }).then(renderCart); } },
                price: function (seq, p2) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doPrice(seq, p2); } catch (e) { post({ action: 'updatePrice', transactionId: TX, itemSeqId: seq, newPrice: p2 }).then(renderCart); } },
                remove: function (seq) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doRemove(seq); } catch (e) { post({ action: 'removeItem', transactionId: TX, itemSeqId: seq }).then(renderCart); } },
                mode: function (seq, m) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doMode(seq, m); } catch (e) { post({ action: 'setItemMode', transactionId: TX, itemSeqId: seq, itemMode: m }).then(renderCart); } },
                scan: function (code) { if (cartClearing || modeSwitching) return showToast('Wait for the cart to finish updating', '#c62828'); try { doScan(code); } catch (e) { post({ action: 'scanAdd', transactionId: TX, cartSearch: code }).then(function (d) { if (d && !d.success && d.error) alert(d.error); else renderCart(d); }); } },
                _drainPending: function () { return q.length + (inflight ? 1 : 0); },
                whenIdle: function () {
                    if (cartFrame) renderCart(lastCartData);
                    return (inflight || q.length) ? new Promise(function(resolve) { idleWaiters.push(resolve); }) : Promise.resolve();
                }
            };
        })();

        window._posClearCart = function() {
            if (document.querySelector('.ofl-qi') && window._posOffline) { window._posOffline.clearDraft(); return Promise.resolve(); }
            if (!navigator.onLine) return Promise.reject(new Error('Reconnect before clearing the server cart.'));
            if (modeSwitching) return Promise.reject(new Error('Wait for the sales mode to finish changing.'));
            if (cartClearing) return Promise.reject(new Error('The cart is already being cleared.'));
            cartClearing = true;
            return OPT.whenIdle().then(function() {
                if (!TX) throw new Error('There is no open cart to clear.');
                return post({action:'clearCart',transactionId:TX});
            }).then(function(data) {
                if (!data || !data.success) throw new Error(data && data.error || 'Cart could not be cleared. Try again.');
                renderCart(data);
            }).finally(function() { cartClearing = false; });
        };
        window._posCurrentTax = function() { return TO; };
        window._posRefreshCart = function() {
            return post({action:'refresh',transactionId:TX}).then(renderCart).catch(function() {
                histToast('Could not refresh totals. Reload the bill before paying.', '#c62828');
            });
        };

        window._posAjax = function(pid, price, name) {
            if (!navigator.onLine && window._posOffline) { window._posOffline.add(pid, price); return; }
            OPT.add(pid, price, name);
        };
        window._posScan = function(code) {
            if (!navigator.onLine && window._posOffline) { window._posOffline.scan(code); return; }
            OPT.scan(code);
        };

        /* --- Screen content fetcher (for grid/category/mode swaps) --- */
        function fetchScreen(params, signal) {
            var base = window.location.pathname + '.qvt';
            var p = {sessionId: SI, taxOn: TO, salesModeId: SM};
            if (TX) p.transactionId = TX;
            if (CATID) p.catId = CATID;
            for (var k in params) { if (params[k] !== undefined && params[k] !== null && params[k] !== '') p[k] = params[k]; else delete p[k]; }
            var qs = Object.keys(p).filter(function(k) { return p[k] !== '' && p[k] !== undefined; }).map(function(k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
            return fetch(base + '?' + qs, {credentials: 'same-origin', signal: signal})
                .then(function(r) { if (!r.ok) throw new Error('Product refresh failed'); return r.text(); })
                .then(function(html) { return new DOMParser().parseFromString(html, 'text/html'); });
        }

        function fetchCatalog(params, signal) {
            var data = Object.assign({sessionId:SI, salesModeId:SM, moquiSessionToken:TK}, params);
            return fetch('Terminal/productGrid', {method:'POST', credentials:'same-origin', signal:signal,
                headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(data)})
                .then(function(r) { if (!r.ok) throw new Error('Product refresh failed'); return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error(data.error || 'Product grid unavailable');
                    var doc = document.implementation.createHTMLDocument('');
                    var grid = doc.createElement('div'); grid.className = 'pos-product-grid';
                    data.products.forEach(function(p) {
                        var form = doc.createElement('form'); form.method='post'; form.action='Terminal/addItem';
                        form.style.cssText='margin:0;display:contents';
                        Object.entries({sessionId:SI, transactionId:TX, productId:p.productId, unitPrice:p.price,
                            addQty:1, catId:params.catId || '', taxOn:TO, salesModeId:SM, moquiSessionToken:TK}).forEach(function(pair) {
                            var input=doc.createElement('input');input.type='hidden';input.name=pair[0];input.value=pair[1];form.appendChild(input);
                        });
                        var button=doc.createElement('button');button.type='submit';button.disabled=p.blocked;
                        button.style.cssText='background:#fff;border:1px solid #ddd;border-radius:10px;padding:14px 8px;cursor:pointer;text-align:center;font-family:inherit;color:#333;min-height:clamp(64px,9vh,90px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px';
                        if(p.blocked)button.style.cssText+=';opacity:0.5;cursor:not-allowed;background:#f5f5f5;border-style:dashed;border-color:#e57373';
                        var title=doc.createElement('div');title.textContent=p.name;title.title=p.name;
                        title.style.cssText='font-size:13px;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex-shrink:0';
                        var price=doc.createElement('div');price.textContent=p.priceText;price.style.cssText='font-size:17px;font-weight:bold;color:'+(p.blocked?'#c62828':'#e53935');
                        var stock=doc.createElement('div');stock.className='pos-card-stock';stock.dataset.productId=p.productId;stock.textContent=p.stockText;stock.title="On-hand stock in this counter's warehouse";
                        button.append(title,price,stock);form.appendChild(button);grid.appendChild(form);
                    });
                    if(data.hasMore){var more=doc.createElement('button');more.type='button';more.className='pos-load-more';more.dataset.nextOffset=data.nextOffset;more.textContent='Load more products';more.style.cssText='grid-column:1/-1;padding:12px;border:1px solid #A78BFA;border-radius:8px;background:#fff;color:#6D28D9;font-weight:700;cursor:pointer';grid.appendChild(more);}
                    if(!data.products.length){var empty=doc.createElement('div');empty.style.cssText='grid-column:1/-1;text-align:center;padding:60px 20px;color:#999';empty.textContent='No products found';grid.appendChild(empty);}
                    doc.body.appendChild(grid); return doc;
                });
        }

        function swapGrid(doc) {
            var next=doc.querySelector('.pos-product-grid'), grid=document.querySelector('.pos-product-grid');
            if(next && grid) grid.replaceChildren.apply(grid, Array.from(next.childNodes));
        }

        /* --- Cart event delegation --- */
        var cart = document.querySelector('.pos-cart');
        if (cart) {
            cart.addEventListener('click', function(e) {
                var t = e.target.closest ? (e.target.closest('.aj-q,.aj-pb,.aj-rm') || e.target) : e.target;
                if (t.classList.contains('aj-q')) {
                    e.preventDefault(); e.stopPropagation();
                    // A product tap may be waiting for the next frame. Step from the live model,
                    // so a fast + after that tap cannot overwrite its already queued increment.
                    var line = lastCartData && lastCartData.items.find(function(it) { return String(it.seq) === t.dataset.seq; });
                    var nq = line ? Number(line.qty) + (t.textContent.trim() === '+' ? 1 : -1) : Number(t.dataset.q);
                    if (!(nq > 0)) return;   // − stops at the floor; it never deletes (× removes)
                    OPT.qty(t.dataset.seq, nq);
                }
                if (t.classList.contains('aj-pb')) {
                    e.preventDefault(); e.stopPropagation();
                    var inp = t.previousElementSibling;
                    if (!inp) return;
                    OPT.price(t.dataset.seq, inp.value);
                }
                if (t.classList.contains('aj-rm')) {
                    e.preventDefault(); e.stopPropagation();
                    OPT.remove(t.dataset.seq);
                }
            });
            cart.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && e.target.classList.contains('aj-p')) { e.preventDefault(); var btn = e.target.nextElementSibling; if (btn) btn.click(); }
                if (e.key === 'Enter' && e.target.classList.contains('aj-qi')) { e.preventDefault(); e.target.blur(); }
            });
            // Typeable quantity (decimals for loose/weighed goods); price auto-recalculates server-side
            cart.addEventListener('change', function(e) {
                if (e.target.classList.contains('aj-qi')) {
                    var nq = Number(e.target.value);
                    // Empty/0/NaN (e.g. the box was cleared to retype a decimal) must not delete
                    // the line — revert to the last good qty. Any value > 0 (incl. decimals like
                    // 0.5) keeps the line and recomputes its amount (qty × rate).
                    if (!(nq > 0)) { if (lastCartData) renderCart(lastCartData); else e.target.value = e.target.defaultValue; return; }
                    OPT.qty(e.target.dataset.seq, nq);
                }
                if (e.target.classList.contains('aj-mode')) {
                    OPT.mode(e.target.dataset.seq, e.target.value);
                }
            });
            cart.addEventListener('submit', function(e) {
                var form = e.target;
                if (!form || !form.action) return;
                if (form.action.indexOf('updateItemQty') !== -1) {
                    e.preventDefault();
                    var fd = new FormData(form); var nq = Number(fd.get('newQty'));
                    if (nq < 0) return;
                    OPT.qty(fd.get('itemSeqId'), nq);
                }
                if (form.action.indexOf('updateItemPrice') !== -1) {
                    e.preventDefault();
                    var fd2 = new FormData(form);
                    OPT.price(fd2.get('itemSeqId'), fd2.get('newPrice'));
                }
                if (form.action.indexOf('removeItem') !== -1) {
                    e.preventDefault();
                    var fd3 = new FormData(form);
                    OPT.remove(fd3.get('itemSeqId'));
                }
            }, true);
        }

        /* --- Product grid: intercept addItem --- */
        var gridRoot = document.querySelector('.pos-product-grid');
        var loadingMore = false;
        if (window.__posLoadMoreHandler) document.removeEventListener('click', window.__posLoadMoreHandler, true);
        window.__posLoadMoreHandler = function(e) {
            var more = e.target.closest('.pos-product-grid .pos-load-more');
            if (!more || loadingMore) return;
            e.preventDefault();
            loadingMore = true;
            more.disabled = true;
            var offset = Number(more.dataset.nextOffset);
            var input = document.getElementById('cartInlineSearch');
            var term = input ? input.value.trim() : '';
            var cat = CATID;
            fetchCatalog({productOffset: offset, searchTerm: term, catId: term ? '' : cat})
                .then(function(doc) {
                    if (CATID !== cat || (input && input.value.trim() !== term) || !more.isConnected) return;
                    var next = doc.querySelector('.pos-product-grid');
                    if (!next) throw new Error('Product page unavailable');
                    var grid = more.parentElement;
                    more.remove();
                    while (next.firstChild) grid.appendChild(next.firstChild);
                })
                .catch(function() { if (more.isConnected) more.disabled = false; })
                .finally(function() { loadingMore = false; });
        };
        document.addEventListener('click', window.__posLoadMoreHandler, true);
        if (gridRoot) gridRoot.addEventListener('submit', function(e) {
            var form = e.target.closest('form');
            if (!form || form.action.indexOf('addItem') === -1) return;
            e.preventDefault();
            var fd = new FormData(form);
            // When a bill is being edited from History, the editor is mounted over the cart and a
            // product tap should land in THAT bill, not the live cart behind it. Route to the editor.
            if (window.__posCartEditorAddProduct) {
                window.__posCartEditorAddProduct(fd.get('productId'), fd.get('unitPrice'),
                    (function(){ var b = form.querySelector('button div'); return b ? b.textContent : ''; })());
                return;
            }
            if (!navigator.onLine && window._posOffline) {
                window._posOffline.add(fd.get('productId'), fd.get('unitPrice'));
                return;
            }
            OPT.add(fd.get('productId'), fd.get('unitPrice'), (function(){var b=form.querySelector('button div');return b?b.textContent:'';})());
        }, true);

        /* --- Product Grid Search: AJAX --- */
        var catalogVersion = 0, catalogAbort, lastCatalogCategory = CATID;
        function loadCatalog(params, cachedGrid) {
            var version = ++catalogVersion;
            if (catalogAbort) catalogAbort.abort();
            catalogAbort = new AbortController();
            var grid = document.querySelector('.pos-product-grid');
            if (grid) {
                if (cachedGrid) grid.innerHTML = cachedGrid;
                grid.style.opacity = cachedGrid ? '1' : '0.4';
                grid.style.pointerEvents = cachedGrid ? '' : 'none';
                grid.setAttribute('aria-busy', 'true');
            }
            return fetchCatalog(params, catalogAbort.signal).then(function(doc) {
                if (version !== catalogVersion) return;
                var next = doc.querySelector('.pos-product-grid');
                if (!next) throw new Error('Product grid unavailable');
                if (!params.catId && !params.searchTerm) __allGridCache = next.innerHTML;
                swapGrid(doc);
                lastCatalogCategory = CATID;
            }).catch(function(error) {
                if (version !== catalogVersion || error.name === 'AbortError') return;
                CATID = lastCatalogCategory;
                var root = document.getElementById('pos-terminal-root');
                if (root) root.dataset.checkoutCategory = CATID || '';
                document.querySelectorAll('.pos-cat-strip a').forEach(function(link) {
                    var selected = (new URL(link.href).searchParams.get('catId') || '') === (CATID || '');
                    link.classList.toggle('is-selected', selected);
                    link.style.background = selected ? '#7C3AED' : '#455a64';
                });
                showToast('Could not refresh products. The previous products are available; try again.', '#c62828');
            }).finally(function() {
                if (version !== catalogVersion) return;
                var grid = document.querySelector('.pos-product-grid');
                if (grid) { grid.style.pointerEvents = ''; grid.style.opacity = '1'; grid.setAttribute('aria-busy', 'false'); }
            });
        }
        window._gridSearch = function(term) {
            return loadCatalog(term ? {searchTerm: term, catId: ''} : {catId: CATID || ''});
        };

        /* --- Category strip: AJAX. ZE-POS-0204: ALL ITEMS used to grey-out the grid (opacity 0.4 +
           pointer-events none) until a FULL page re-fetch of every tile returned — a 5-10s freeze on
           large catalogs. The full grid is the landing state, so cache it once and restore INSTANTLY
           on ALL ITEMS (grid stays tappable); a background fetch keeps the cache fresh. Specific
           category tabs keep the fetch path (small responses). --- */
        var __allGridCache = null;
        (function() { try {
            var g = document.querySelector('.pos-product-grid');
            if (g && !CATID && !new URL(location.href).searchParams.get('searchTerm')) __allGridCache = g.innerHTML;
        } catch(e) {} })();
        document.querySelectorAll('.pos-cat-strip a').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var linkUrl = new URL(this.href);
                var newCatId = linkUrl.searchParams.get('catId') || '';
                CATID = newCatId;
                document.querySelectorAll('.pos-cat-strip a').forEach(function(a) { a.style.background = '#455a64'; });
                this.style.background = '#7C3AED';
                var grid = document.querySelector('.pos-product-grid');
                var searchInput = document.getElementById('cartInlineSearch');
                if (searchInput) searchInput.value = '';
                if (newCatId === '' && __allGridCache && grid) {
                    loadCatalog({catId: '', searchTerm: ''}, __allGridCache);
                    return;
                }
                loadCatalog({catId: newCatId, searchTerm: ''});
            });
        });

        /* --- Sales mode switching: AJAX --- */
        function syncModeLinks() {
            document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function(link) {
                var url = new URL(link.href);
                if (TX) url.searchParams.set('transactionId', TX);
                else url.searchParams.delete('transactionId');
                if (link.href !== url.href) link.href = url.href;
            });
        }
        document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function(link) {
            var u = new URL(link.href);
            var mid = u.searchParams.get('salesModeId') || '';
            var isActive = link.style.borderColor === '#fff' || link.style.borderColor === 'rgb(255, 255, 255)';
            if (isActive) link.dataset.color = link.style.background || '#2e7d32';
        });
        document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (modeSwitching) return;
                var linkUrl = new URL(this.href);
                var newSM = linkUrl.searchParams.get('salesModeId') || '';
                if (!newSM || newSM === SM) return;
                modeSwitching = true;
                var previousSM = SM;
                OPT.whenIdle().then(function() {
                    // The optimistic cart can be visible before its addItem reply gives us TX.
                    // Switch only after every queued write has settled, using that current ID.
                    return fetchScreen({salesModeId: newSM});
                }).then(function(doc) {
                    var renderedMode = doc.querySelector('#cartInlineAddForm [name="salesModeId"]');
                    if (!renderedMode) throw new Error('Could not load the selected sales mode.');
                    SM = renderedMode.value;
                    af.querySelector('[name=salesModeId]').value = SM;
                    swapGrid(doc);
                    var newLinks = doc.querySelectorAll('.pos-header a[href*="changeSalesMode"]');
                    document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function(a) {
                        var mid = new URL(a.href).searchParams.get('salesModeId');
                        var match = Array.prototype.find.call(newLinks, function(nl) { return new URL(nl.href).searchParams.get('salesModeId') === mid; });
                        a.classList.toggle('is-active', !!match && match.classList.contains('is-active'));
                    });
                    var modeError = doc.querySelector('#posModeSwitchErr');
                    if (modeError) showToast(modeError.textContent.trim(), '#c62828');
                    if (TX) {
                        return post({action:'refresh', transactionId: TX}).then(function(d) {
                            if (!d || !d.success) throw new Error((d && d.error) || 'Could not refresh the cart after changing mode.');
                            renderCart(d);
                        });
                    } else {
                        var ns = doc.querySelector('.pos-summary');
                        if (ns) { var os = document.querySelector('.pos-summary'); if (os) os.innerHTML = ns.innerHTML; }
                        appendRecallIfNeeded();
                    }
                }).catch(function(err) {
                    SM = previousSM;
                    af.querySelector('[name=salesModeId]').value = SM;
                    showToast(err.message || 'Could not change sales mode. Try again.', '#c62828');
                }).finally(function() {
                    modeSwitching = false;
                });
            });
        });

        /* --- Tax toggle: AJAX --- */
        var taxForm = document.querySelector('.pos-header form[action*="toggleTax"]');
        if (taxForm) taxForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (modeSwitching || cartClearing) return;
            var newTax = TO === 'Y' ? 'N' : 'Y';
            var btn = taxForm.querySelector('button');
            if (btn) btn.disabled = true;
            modeSwitching = true;
            OPT.whenIdle().then(function() {
                var fd = new FormData(taxForm);
                fd.set('transactionId',TX); fd.set('sessionId',SI); fd.set('taxOn',newTax);
                fd.set('salesModeId',SM); fd.set('moquiSessionToken',TK);
                return fetch(taxForm.action,{method:'POST',body:new URLSearchParams(fd),credentials:'same-origin'});
            }).then(function(response) {
                if (!response.ok) throw new Error('Tax mode could not be changed. Reload the bill and try again.');
                return response.text();
            }).then(function(html) {
                var doc=new DOMParser().parseFromString(html,'text/html');
                var saved=doc.querySelector('#cartInlineAddForm input[name="taxOn"]');
                var error=doc.querySelector('#posModeSwitchErr,.alert-danger');
                if (!saved || saved.value!==newTax || error) throw new Error(error ? error.textContent.trim() : 'Tax mode was not saved. Reload the bill.');
                TO=newTax;
                document.querySelectorAll('input[name="taxOn"]').forEach(function(input){input.value=TO;});
                taxForm.querySelector('input[name="taxOn"]').value=TO==='Y'?'N':'Y';
                var label=taxForm.querySelector('.nb-tax__lbl'); if(label) label.textContent='Tax: '+(TO==='Y'?'On':'Off');
                if(btn) { btn.classList.toggle('on',TO==='Y'); btn.setAttribute('aria-pressed',String(TO==='Y')); }
                var url=new URL(location.href);url.searchParams.set('taxOn',TO);history.replaceState(history.state,'',url.href);
                return post({action:'refresh',transactionId:TX});
            }).then(function(data) { if(data)renderCart(data); })
                .catch(function(error){showToast(error.message,'#c62828');})
                .finally(function(){modeSwitching=false;if(btn)btn.disabled=false;});
        });

        /* --- Close Session: AJAX dialog --- */
        var closeForm = document.querySelector('.pos-header form[action*="closeSession"]');
        if (closeForm) {
            closeForm.removeAttribute('onsubmit');
            closeForm.addEventListener('submit', function(e) {
                e.preventDefault();
                if (document.querySelector('.pos-close-overlay')) return;
                fetch('Terminal/ajaxCart', {
                    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({action:'sessionSummary', sessionId: SI, taxOn: TO, salesModeId: SM, moquiSessionToken: TK}),
                    credentials: 'same-origin'
                }).then(function(r) { return r.json(); }).then(function(d) {
                    if (!d || !d.success) { alert(d ? d.error : 'Failed to load session summary'); return; }
                    var ov = document.createElement('div');
                    ov.className = 'pos-close-overlay'; ov.id='posCloseSessionOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Close session');
                    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center';
                    var row = function(label, val, color) {
                        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">'
                            + '<span style="color:#555;font-size:15px">'+label+'</span>'
                            + '<span style="font-weight:700;font-size:15px;color:'+(color||'#333')+'">'+CS+fmt2(val)+'</span></div>';
                    };
                    var html = '<div style="background:#fff;border-radius:16px;padding:28px 32px;width:420px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,0.3)">'
                        + '<div style="text-align:center;font-size:22px;font-weight:800;color:#463D7A;margin-bottom:4px">Close Session</div>'
                        + '<div style="text-align:center;font-size:13px;color:#888;margin-bottom:18px">Session #'+SI+'</div>'
                        + '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
                        + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Session Summary</div>'
                        + '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">'
                        + '<span style="color:#555;font-size:15px">Bills Completed</span>'
                        + '<span style="font-weight:700;font-size:15px;color:#7C3AED">'+d.billCount+'</span></div>'
                        + row('Total Sales', d.totalSales, '#2e7d32')
                        + '</div>'
                        + '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
                        + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Cash Breakdown</div>'
                        + row('Opening Cash', d.openingCash)
                        + row('Cash Received', d.cashReceived, '#2e7d32')
                        + row('Change Given', d.changeGiven, '#e65100')
                        + '<div style="display:flex;justify-content:space-between;padding:10px 0 4px;border-top:2px solid #463D7A;margin-top:6px">'
                        + '<span style="font-weight:800;font-size:17px;color:#463D7A">Expected Cash</span>'
                        + '<span style="font-weight:800;font-size:17px;color:#463D7A">'+CS+fmt2(d.expectedCash)+'</span></div>'
                        + '</div>'
                        + (d.cardReceived > 0 || d.upiReceived > 0 ? '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
                            + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Other Payments</div>'
                            + (d.cardReceived > 0 ? row('Card', d.cardReceived, '#7C3AED') : '')
                            + (d.upiReceived > 0 ? row('UPI', d.upiReceived, '#7b1fa2') : '')
                            + '</div>' : '')
                        + '<div style="margin-bottom:16px">'
                        + '<label style="font-size:14px;font-weight:700;color:#333;display:block;margin-bottom:6px">Enter Closing Cash Amount</label>'
                        + '<input type="number" class="pos-close-cash" step="0.01" min="0" value="'+fmt2(d.expectedCash)+'" style="width:100%;padding:14px 16px;border:2px solid #463D7A;border-radius:10px;font-size:22px;font-weight:700;text-align:right;box-sizing:border-box;outline:none;color:#463D7A" onfocus="this.select()"/>'
                        + '<div class="pos-close-diff" style="text-align:right;margin-top:6px;font-size:14px;font-weight:600"></div>'
                        + '</div>'
                        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
                        + '<button type="button" class="pos-close-cancel" style="padding:14px;border:2px solid #999;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#fff;color:#666">Cancel</button>'
                        + '<button type="button" class="pos-close-confirm" style="padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#c62828;color:#fff">&#9724; CLOSE SESSION</button>'
                        + '</div></div>';
                    ov.innerHTML = html;
                    document.body.appendChild(ov);
                    var inp = ov.querySelector('.pos-close-cash');
                    var diffEl = ov.querySelector('.pos-close-diff');
                    var expected = d.expectedCash;
                    function updateDiff() {
                        var v = parseFloat(inp.value) || 0;
                        var diff = v - expected;
                        if (Math.abs(diff) < 0.01) {
                            diffEl.textContent = '✓ Exact match';
                            diffEl.style.color = '#2e7d32';
                        } else if (diff > 0) {
                            diffEl.textContent = 'Excess: +' + CS + fmt2(diff);
                            diffEl.style.color = '#e65100';
                        } else {
                            diffEl.textContent = 'Short: ' + CS + fmt2(diff);
                            diffEl.style.color = '#c62828';
                        }
                    }
                    updateDiff();
                    inp.addEventListener('input', updateDiff);
                    ov.querySelector('.pos-close-cancel').addEventListener('click', function() { ov.remove(); });
                    ov.addEventListener('click', function(ev) { if (ev.target === ov) ov.remove(); });
                    ov.querySelector('.pos-close-confirm').addEventListener('click', function() {
                        var closingCash = Number(inp.value);
                        if (inp.value === '' || !Number.isFinite(closingCash) || closingCash < 0) {
                            inp.setCustomValidity('Enter a valid, non-negative closing cash amount.');
                            inp.reportValidity();
                            return;
                        }
                        inp.setCustomValidity('');
                        var fd = new FormData(closeForm);
                        fd.set('closingCash', inp.value);
                        fd.set('wantJson', '1');
                        fd.set('moquiSessionToken', TK);
                        var confirmButton = this;
                        confirmButton.disabled = true;
                        confirmButton.textContent = 'Closing...';
                        fetch(closeForm.action, {method:'POST', body: new URLSearchParams(fd), credentials:'same-origin'})
                            .then(function(response) {
                                if (!response.ok) throw new Error('Session close failed. Please try again.');
                                return response.json();
                            }).then(function(result) {
                                if (!result.success) throw new Error(result.error || 'Session close failed.');
                                ov.remove();
                                showToast('Session closed successfully');
                                window.location.assign('/apps/zenith/pos/PosSessions?sessionId=' + encodeURIComponent(SI));
                            }).catch(function(error) {
                                confirmButton.disabled = false;
                                confirmButton.textContent = 'CLOSE SESSION';
                                alert(error.message);
                            });
                    });
                    inp.focus();
                });
            });
        }

        /* --- Replace server-rendered <a> tags with buttons so SPA router can't intercept --- */
        var smRoot = document.querySelector('.pos-summary');
        // A payment/hold click may arrive before the next animation frame. Flush its
        // current amount and fields before any delegated handler reads the form.
        if (smRoot) ['click','submit'].forEach(function(type) {
            smRoot.addEventListener(type,function() { if (cartFrame) renderCart(lastCartData); },true);
        });
        var paymentPanelPending = false;
        function openPaymentPanel(builder, onOpen) {
            if (paymentPanelPending) return;
            paymentPanelPending = true;
            smRoot.setAttribute('aria-busy','true');
            OPT.whenIdle().then(function() {
                if (lastCartData && lastCartData.success) return;
                return post({action:'refresh',transactionId:TX}).then(function(data) {
                    if (!data || !data.success) throw new Error('Could not verify the bill. Please retry payment.');
                    renderCart(data);
                });
            }).then(function() {
                if (!af.isConnected || !lastCartData || !lastCartData.items.length) return;
                smRoot.innerHTML = builder();
                if (onOpen) onOpen();
            }).catch(function(error) {
                showToast(error.message || 'Could not open payment. Please retry.','#c62828');
            }).finally(function() {
                paymentPanelPending = false;
                smRoot.removeAttribute('aria-busy');
            });
        }
        if (smRoot) {
            var _splitLink = smRoot.querySelector('a[href*="showSplitPay"]');
            if (_splitLink) {
                var _sb = document.createElement('button');
                _sb.type = 'button'; _sb.className = 'pos-split-btn';
                _sb.style.cssText = _splitLink.style.cssText + 'border:none;';
                _sb.innerHTML = _splitLink.innerHTML;
                _splitLink.replaceWith(_sb);
            }
            var _cancelLink = smRoot.querySelector('a[href*="cancelSplitPay"]');
            if (_cancelLink) {
                var _cb = document.createElement('button');
                _cb.type = 'button'; _cb.className = 'pos-split-cancel';
                _cb.style.cssText = _cancelLink.style.cssText + 'border:none;cursor:pointer;';
                _cb.innerHTML = _cancelLink.innerHTML;
                _cancelLink.replaceWith(_cb);
            }
        }

        /* --- Init: extract held info from server-rendered page --- */
        extractHeldInfo(document);

        // Refresh the server-rendered held-bills picker (#pos-held-wrap <details>) from a full
        // terminal render, so HOLD/RECALL/VOID keep the badge correct with no page reload.
        function syncHeldWrap(doc) {
            try { var s = doc.querySelector('#pos-held-wrap'); var d = document.getElementById('pos-held-wrap'); if (s && d) d.innerHTML = s.innerHTML; } catch (e) {}
        }
        function reconcileTerminal(doc) {
            var ntk = doc.querySelector('input[name="moquiSessionToken"]'); if (ntk && ntk.value) TK = ntk.value;
            swapGrid(doc);
            var nb = doc.querySelector('.pos-cart tbody'); var ct = document.querySelector('.pos-cart tbody'); if (nb && ct) ct.innerHTML = nb.innerHTML;
            var ns = doc.querySelector('.pos-summary'); var sd = document.querySelector('.pos-summary'); if (ns && sd) sd.innerHTML = ns.innerHTML;
            syncHeldWrap(doc);
        }

        /* Hold uses the server's normal POST/redirect so a rejected hold never clears the cart.
           Recall and void continue through the existing delegated handler. */
        document.addEventListener('submit', function(e) {
            var form = e.target.closest ? e.target.closest('form') : null;
            if (!form) return;
            var act = form.getAttribute('action') || '';
            if (act.indexOf('holdSale') !== -1) return; // Native POST confirms the hold before the cart is cleared.
            if (act.indexOf('voidSale') !== -1 || act.indexOf('recallSale') !== -1) {
                e.preventDefault();
                var isRecall = act.indexOf('recallSale') !== -1;
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI); fd.set('taxOn', TO);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                if (isRecall) {
                    showToast('Recalling held sale…', '#e65100');
                } else {
                    // Empty the cart optimistically for void; Hold waits for its native response.
                    renderCart({ success: true, transactionId: '', items: [], sub: 0, tax: 0, disc: 0, tQty: 0, grand: 0, pay: 0 });
                    TX = ''; lastCartData = null; lastPay = 0;
                    showToast('Sale voided', '#e53935');
                }
                fetch(form.action, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin' })
                    .then(function(r) { var u = r.url || ''; return r.text().then(function(html) { return { html: html, url: u }; }); })
                    .then(function(resp) {
                        var doc = new DOMParser().parseFromString(resp.html, 'text/html');
                        var ntx = doc.querySelector('input[name="transactionId"]');
                        var newTx = ntx ? (ntx.value || '') : '';
                        if (!newTx && resp.url) { var m = resp.url.match(/transactionId=(\d+)/); if (m) newTx = m[1]; }
                        TX = newTx;
                        document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { el.value = TX; });
                        if (isRecall) {
                            // Show the recalled cart immediately (server HTML), then load the JSON
                            // model so optimistic edits work on the recalled lines.
                            reconcileTerminal(doc);
                            post({ action: 'refresh', transactionId: TX }).then(function(d) { renderCart(d); showToast('✔ Held sale recalled', '#e65100'); });
                        } else {
                            // Void keeps the optimistic empty cart until the next bill starts.
                            var ntk = doc.querySelector('input[name="moquiSessionToken"]'); if (ntk && ntk.value) TK = ntk.value;
                            syncHeldWrap(doc);
                            var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                            if (bn) bn.textContent = 'BILL- 0';
                        }
                    })
                    .catch(function() { try { location.reload(); } catch (e) {} });
            }
            if (act.indexOf('payAndComplete') !== -1 && act.indexOf('splitPayAndComplete') === -1) {
                e.preventDefault();
                // This capture listener runs before the form's native confirmation
                // handler. Gate first, then re-enter once through requestSubmit().
                e.stopPropagation();
                if (/posPayCash|posPayDigital/.test(form.getAttribute('onsubmit') || '') && form.dataset.posPaymentConfirmed !== '1') {
                    var gate = form.querySelector('[name="paymentMethod"]').value === 'Cash' ? window.posPayCash : window.posPayDigital;
                    if (gate(form) !== false) {
                        form.dataset.posPaymentConfirmed = '1';
                        if (form.requestSubmit) form.requestSubmit(); else form.submit();
                    }
                    return;
                }
                delete form.dataset.posPaymentConfirmed;
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                fd.set('wantJson', '1'); // get the print-receipt data back in the same response
                var method = fd.get('paymentMethod') || 'Cash';
                var paidAmt = fd.get('amount') || '0';
                var savedTx = TX;
                var btn = form.querySelector('button');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
                approvedPaymentFetch(form.action, {method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin'})
                    .then(function(r) { return r.json().catch(function() { return {success:false, error:'Payment failed'}; }); })
                    .then(function(d) {
                        if (!d || !d.success) throw new Error((d && d.error) || 'Payment failed');
                        var billNum = d.bill && d.bill.number || '';
                        showToast('✔ Sale Complete' + (billNum ? ' — ' + billNum : '') + ' — ' + CS + fmt(paidAmt) + ' ' + method.toUpperCase());
                        printReceipt(savedTx, billNum, TO, false, d.receiptUnavailable ? null : d);
                        resetCompletedCart();
                        return fetchScreen({});
                    })
                    .then(function(doc) {
                        if (!doc) return;
                        extractHeldInfo(doc);
                        updateHeldBadge();
                        var ntk = doc.querySelector('input[name="moquiSessionToken"]');
                        if (ntk && ntk.value) TK = ntk.value;
                        // Only refresh catalog/header metadata: a new bill may already be active.
                        swapGrid(doc);
                        syncIssuedBillHeader(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        alert('Payment error: ' + err.message);
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                    });
            }
            if (act.indexOf('splitPayAndComplete') !== -1) {
                e.preventDefault();
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                fd.set('wantJson', '1'); // get the print-receipt data back in the same response
                var cAmt = Number(fd.get('cashAmount') || 0);
                var dAmt = Number(fd.get('cardAmount') || 0);
                var uAmt = Number(fd.get('upiAmount') || 0);
                var splitTotal = cAmt + dAmt + uAmt;
                if (splitTotal < lastPay) {
                    alert('Split total (' + CS + fmt(splitTotal) + ') is less than the payable amount (' + CS + fmt(lastPay) + '). Please adjust.');
                    return;
                }
                var splitParts = [];
                if (cAmt > 0) splitParts.push(CS + fmt(cAmt) + ' Cash');
                if (dAmt > 0) splitParts.push(CS + fmt(dAmt) + ' Card');
                if (uAmt > 0) splitParts.push(CS + fmt(uAmt) + ' UPI');
                var savedTx = TX;
                var btn = form.querySelector('button[type="submit"]');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Processing...'; }
                approvedPaymentFetch(form.action, {method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin'})
                    .then(function(r) { return r.json().catch(function() { return {success:false, error:'Split payment failed'}; }); })
                    .then(function(d) {
                        if (!d || !d.success) throw new Error((d && d.error) || 'Split payment failed');
                        var billNum = d.bill && d.bill.number || '';
                        showToast('✔ Sale Complete' + (billNum ? ' — ' + billNum : '') + ' — ' + splitParts.join(' + '));
                        printReceipt(savedTx, billNum, TO, false, d.receiptUnavailable ? null : d);
                        resetCompletedCart();
                        return fetchScreen({});
                    })
                    .then(function(doc) {
                        if (!doc) return;
                        extractHeldInfo(doc);
                        updateHeldBadge();
                        var ntk = doc.querySelector('input[name="moquiSessionToken"]');
                        if (ntk && ntk.value) TK = ntk.value;
                        // Only refresh catalog/header metadata: a new bill may already be active.
                        swapGrid(doc);
                        syncIssuedBillHeader(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        alert('Split payment error: ' + err.message);
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '✓ CONFIRM SPLIT'; }
                    });
            }
        }, true);

        /* --- Split Payment / Cancel: click delegation on .pos-summary --- */
        if (smRoot) smRoot.addEventListener('click', function(e) {
            var link = e.target.closest('a');
            if (e.target.closest('.pos-split-btn') || (link && link.href && link.href.indexOf('showSplitPay') !== -1)) {
                e.preventDefault();
                e.stopPropagation();
                if (!lastCartData) {
                    var rows = document.querySelectorAll('.pos-cart tbody tr');
                    lastCartData = {items: Array.from(rows).filter(function(r) { return !r.textContent.includes('Tap products'); }),
                        tQty: 0, tax: 0, disc: 0, pay: 0, grand: 0, sub: 0, round: 0, cnt: 0, transactionId: TX, txnNum: lastTxnNum};
                    var totalEl = smRoot.querySelector('[style*="font-size:28px"], [style*="font-size: 28px"]');
                    if (totalEl) { var m = totalEl.textContent.replace(/[^\d.]/g, ''); lastPay = Number(m) || 0; lastCartData.pay = lastPay; }
                }
                openPaymentPanel(buildSplitPanel);
            }
            if (e.target.closest('.pos-split-cancel') || (link && link.href && link.href.indexOf('cancelSplitPay') !== -1)) {
                e.preventDefault();
                e.stopPropagation();
                if (lastCartData) {
                    smRoot.innerHTML = buildSummary(lastCartData);
                } else {
                    fetchScreen({}).then(function(doc) {
                        var ns = doc.querySelector('.pos-summary');
                        if (ns) smRoot.innerHTML = ns.innerHTML;
                    });
                }
            }
            /* --- Cash payment panel --- */
            if (e.target.closest('.pos-cash-btn')) {
                e.preventDefault();
                e.stopPropagation();
                if (!lastCartData) {
                    var rows = document.querySelectorAll('.pos-cart tbody tr');
                    lastCartData = {items: Array.from(rows).filter(function(r) { return !r.textContent.includes('Tap products'); }),
                        tQty: 0, tax: 0, disc: 0, pay: 0, grand: 0, sub: 0, round: 0, cnt: 0, transactionId: TX, txnNum: lastTxnNum};
                    var totalEl = smRoot.querySelector('[style*="font-size:28px"], [style*="font-size: 28px"]');
                    if (totalEl) { var m = totalEl.textContent.replace(/[^\d.]/g, ''); lastPay = Number(m) || 0; lastCartData.pay = lastPay; }
                }
                openPaymentPanel(buildCashPanel,function() {
                    var ci = smRoot.querySelector('.pos-cash-input');
                    if (ci) ci.focus();
                    var confirm = smRoot.querySelector('.pos-cash-confirm');
                    if (confirm) requestAnimationFrame(function() { confirm.scrollIntoView({block:'nearest'}); });
                });
            }
            if (e.target.closest('.pos-cash-cancel')) {
                e.preventDefault();
                e.stopPropagation();
                if (lastCartData) smRoot.innerHTML = buildSummary(lastCartData);
            }
            if (e.target.closest('.pos-cash-quick')) {
                var amt = e.target.closest('.pos-cash-quick').dataset.amt;
                var ci = smRoot.querySelector('.pos-cash-input');
                if (ci) { ci.value = amt; ci.dispatchEvent(new Event('input', {bubbles: true})); }
            }
            if (e.target.closest('.pos-cash-confirm')) {
                var ci = smRoot.querySelector('.pos-cash-input');
                var received = Number(ci ? ci.value : 0);
                if (received < lastPay) return;
                var change = received - lastPay;
                var billNum = lastTxnNum || '';
                var savedTx = TX;
                var btn = e.target.closest('.pos-cash-confirm');
                btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Processing...';
                var params = new URLSearchParams();
                params.set('transactionId', TX); params.set('sessionId', SI);
                params.set('paymentMethod', 'Cash'); params.set('amount', String(lastPay));
                params.set('salesModeId', SM); params.set('customerPhone', '');
                params.set('moquiSessionToken', TK);
                params.set('wantJson', '1'); // get the print-receipt data back in the same response
                approvedPaymentFetch('Terminal/payAndComplete', {method: 'POST', body: params, credentials: 'same-origin'})
                    .then(function(r) { return r.json().catch(function() { return {success:false, error:'Payment failed'}; }); })
                    .then(function(d) {
                        if (!d || !d.success) throw new Error((d && d.error) || 'Payment failed');
                        var toastMsg = '✔ Sale Complete — BILL-' + billNum + ' — ' + CS + fmt(lastPay) + ' CASH';
                        if (change > 0) toastMsg += ' (Change: ' + CS + fmt(change) + ')';
                        showToast(toastMsg);
                        printReceipt(savedTx, billNum, TO, false, d.receiptUnavailable ? null : d);
                        resetCompletedCart();
                        return fetchScreen({});
                    })
                    .then(function(doc) {
                        if (!doc) return;
                        extractHeldInfo(doc);
                        updateHeldBadge();
                        var ntk = doc.querySelector('input[name="moquiSessionToken"]');
                        if (ntk && ntk.value) TK = ntk.value;
                        // Only refresh catalog/header metadata: a new bill may already be active.
                        swapGrid(doc);
                        syncIssuedBillHeader(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        alert('Payment error: ' + err.message);
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '💰 CONFIRM PAYMENT'; }
                    });
            }
        });

        /* --- Cash input: live change calculation --- */
        if (smRoot) smRoot.addEventListener('input', function(e) {
            if (!e.target.classList.contains('pos-cash-input')) return;
            var received = Number(e.target.value) || 0;
            var changeDiv = smRoot.querySelector('.pos-cash-change');
            var confirmBtn = smRoot.querySelector('.pos-cash-confirm');
            if (!changeDiv || !confirmBtn) return;
            var diff = received - lastPay;
            if (e.target.value === '' || received === 0) {
                changeDiv.innerHTML = '';
                confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5';
            } else if (diff < 0) {
                changeDiv.innerHTML = '<span style="color:#e53935;font-size:20px">⚠ Short: ' + CS + fmt(Math.abs(diff)) + ' more needed</span>';
                confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5';
            } else if (diff === 0) {
                changeDiv.innerHTML = '<span style="color:#2e7d32;font-size:22px">✔ Exact Amount</span>';
                confirmBtn.disabled = false; confirmBtn.style.opacity = '1';
            } else {
                changeDiv.innerHTML = '<span style="color:#7C3AED;font-size:26px;letter-spacing:0.5px">Change: ' + CS + fmt(diff) + '</span>';
                confirmBtn.disabled = false; confirmBtn.style.opacity = '1';
            }
        });
    }
    init();
})();

/* === Cart Inline Search === */
(function() {
    function initCartSearch() {
        var si = document.getElementById('cartInlineSearch');
        var dd = document.getElementById('cartSearchDropdown');
        if (!si || !dd) { setTimeout(initCartSearch, 300); return; }
        var dt, aidx = -1, keyTimes = [];
        function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        // A physical barcode scanner emits keys far faster (<50ms apart) than a human types.
        function isScan() { if (keyTimes.length < 3) return false; var avg = (keyTimes[keyTimes.length - 1] - keyTimes[0]) / (keyTimes.length - 1); return avg < 160; }  /* ZE-BC-090: was 50ms — too tight for Safari/Edge Bluetooth-HID delivery (scans misread as typing). Chrome is ~20ms so unaffected; server scanAdd also resolves by name, so a misclassified fast-type still finds the product. */
        si.addEventListener('keydown', function(e) { if (e.key && e.key.length === 1) { keyTimes.push(Date.now()); if (keyTimes.length > 30) keyTimes.shift(); } });  /* ZE-BC-090: was 'keypress' (deprecated + fires unreliably for HID input in Safari/Edge); keydown fires consistently — track printable keys only. */
        si.addEventListener('input', function() {
            var t = this.value.trim(); clearTimeout(dt); aidx = -1;
            if (window._gridSearch) {
                clearTimeout(window._gridSyncTimer);
                window._gridSyncTimer = setTimeout(function() { window._gridSearch(si.value.trim()); }, 600);
            }
            if (t.length < 1) { dd.style.display = 'none'; return; }
            dt = setTimeout(function() {
                var tk = (document.querySelector('#cartInlineAddForm [name=moquiSessionToken]') || {}).value || '';
                fetch('Terminal/lookupProducts', {
                    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: 'term=' + encodeURIComponent(t) + '&moquiSessionToken=' + encodeURIComponent(tk), credentials: 'same-origin'
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (!data || data.length === 0) {
                        dd.innerHTML = '<div style="padding:10px;color:#999;font-size:13px;text-align:center">No products found</div>';
                        dd.style.display = 'block'; return;
                    }
                    var h = '';
                    for (var i = 0; i < data.length; i++) {
                        var p = data[i];
                        h += '<div class="cart-dd-item" data-pid="' + esc(p.productId) + '" data-price="' + p.mrpAmount + '" data-name="' + esc(p.productName || '').replace(/"/g, '&quot;') + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee;font-size:14px;background:#fff">';
                        h += '<span class="dd-price" style="float:right;color:#e53935;font-weight:bold;font-size:14px">' + esc('' + p.mrpAmount) + '</span>';
                        h += '<span class="dd-name" style="font-weight:600;color:#000;font-size:14px">' + esc(p.productName || '') + '</span>';
                        h += '<div class="dd-code" style="font-size:12px;color:#555;margin-top:2px">' + esc(p.pseudoId || '') + '</div></div>';
                    }
                    dd.innerHTML = h; dd.style.display = 'block'; aidx = -1;
                });
            }, 250);
        });
        si.addEventListener('keydown', function(e) {
            var items = dd.querySelectorAll('.cart-dd-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); aidx = Math.min(aidx + 1, items.length - 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); aidx = Math.max(aidx - 1, 0); }
            else if (e.key === 'Enter') {
                e.preventDefault(); var v = si.value.trim(); if (!v) return;
                // Fast entry (a scanner) or no dropdown match => let the server resolve the code by
                // pseudoId/barcode via _posScan. A human picking a result adds by productId AND passes
                // the product NAME so the optimistic line reads the name, not the bare code (ZE-POS-0207).
                if (aidx >= 0 && items[aidx]) {   /* ZE-BC-090: honour an explicit keyboard-navigated dropdown pick first, so the widened isScan() can't hijack it */
                    if (window._posAjax) window._posAjax(items[aidx].dataset.pid, items[aidx].dataset.price, items[aidx].dataset.name);
                } else if (isScan() || items.length === 0) {
                    if (window._posScan) window._posScan(v);
                } else {
                    if (window._posAjax) window._posAjax(items[0].dataset.pid, items[0].dataset.price, items[0].dataset.name);
                }
                dd.style.display = 'none'; si.value = ''; si.focus();
                if (window._gridSearch) window._gridSearch('');
                keyTimes = [];
            }
            else if (e.key === 'Escape') { dd.style.display = 'none'; }
            for (var i = 0; i < items.length; i++) items[i].style.background = (i === aidx) ? '#e8f5e9' : '#fff';
        });
        dd.addEventListener('click', function(e) {
            var item = e.target.closest('.cart-dd-item');
            if (!item) return;
            if (window._posAjax) {
                window._posAjax(item.dataset.pid, item.dataset.price, item.dataset.name);
                dd.style.display = 'none'; si.value = ''; si.focus();
                if (window._gridSearch) window._gridSearch('');
                return;
            }
        });
        document.addEventListener('click', function(e) { if (!si.contains(e.target) && !dd.contains(e.target)) dd.style.display = 'none'; });
    }
    initCartSearch();
})();

/* === Horizontal Resize Splitter (robust: document delegation, survives SPA re-renders) === */
(function() {
    var dragging = false, startX = 0, startLeftW = 0, totalW = 0;
    var layout, left, cart, splitter;
    function panels() {
        layout = document.querySelector('.pos-main-layout');
        left = document.querySelector('.pos-left-panel');
        cart = document.querySelector('.pos-cart');
        splitter = document.querySelector('.pos-splitter');
        return !!(layout && left && cart && splitter);
    }
    function applySaved() {
        if (!panels()) return;
        var saved = localStorage.getItem('posSplitRatio');
        if (saved) {
            var r = parseFloat(saved);
            if (r > 0.2 && r < 0.85) {
                left.style.flex = 'none';
                left.style.width = (r * 100) + '%';
                cart.style.width = ((1 - r) * 100 - 1) + '%';
            }
        }
    }
    function onStart(x) {
        if (!panels()) return;
        dragging = true; startX = x;
        startLeftW = left.offsetWidth;
        totalW = layout.offsetWidth - splitter.offsetWidth;
        splitter.style.background = '#A78BFA';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }
    function onMove(x) {
        if (!dragging) return;
        var dx = x - startX;
        var newLeft = Math.max(250, Math.min(startLeftW + dx, totalW - 300));
        left.style.flex = 'none';
        left.style.width = newLeft + 'px';
        cart.style.width = (totalW - newLeft) + 'px';
    }
    function onEnd() {
        if (!dragging) return;
        dragging = false;
        if (splitter) splitter.style.background = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (layout && left && splitter) {
            var ratio = left.offsetWidth / (layout.offsetWidth - splitter.offsetWidth);
            try { localStorage.setItem('posSplitRatio', ratio.toFixed(4)); } catch (e) {}
        }
    }
    function inSplitter(t) { return t && t.closest ? t.closest('.pos-splitter') : null; }
    document.addEventListener('mousedown', function(e) { if (inSplitter(e.target)) { e.preventDefault(); onStart(e.clientX); } });
    document.addEventListener('mousemove', function(e) { if (dragging) { e.preventDefault(); onMove(e.clientX); } });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchstart', function(e) { if (inSplitter(e.target)) { e.preventDefault(); onStart(e.touches[0].clientX); } }, {passive: false});
    document.addEventListener('touchmove', function(e) { if (dragging) { e.preventDefault(); onMove(e.touches[0].clientX); } }, {passive: false});
    document.addEventListener('touchend', onEnd);
    document.addEventListener('dblclick', function(e) {
        if (inSplitter(e.target) && panels()) {
            left.style.flex = '1'; left.style.width = '';
            cart.style.width = '55%';
            try { localStorage.removeItem('posSplitRatio'); } catch (e2) {}
        }
    });
    applySaved();
    setTimeout(applySaved, 250);
})();

console.log('[posterm] script END reached');
