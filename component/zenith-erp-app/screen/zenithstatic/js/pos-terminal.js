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
            if(state.missingPrice)throw new Error('Enter a price above ₹0 for each unpriced product before payment.');
            if(!state.approvalEnabled && (state.freeItems||[]).some(function(item){return !(Number(item.price)>0);}))throw new Error('Set a price above ₹0 for every product before payment.');
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

window._posSetCustomerChip = function(name, phone) {
    ['pos-cust-name', 'pos-header-customer-name'].forEach(function(id) {
        var label = document.getElementById(id);
        if (label) label.textContent = name || 'Walk-in Customer';
    });
    var phoneLabel = document.getElementById('pos-cust-phone');
    if (phoneLabel) phoneLabel.textContent = phone || '—';
};

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

function posReceiptPrintMarkup(title, message, offline = false) {
    const button = (id, label, primary) => '<button type="button" ' + id
        + ' style="padding:10px 14px;border:1px solid #7C3AED;border-radius:8px;background:' + (primary ? '#7C3AED;color:#fff' : '#fff;color:#5b21b6')
        + ';font-size:14px;font-weight:700;cursor:pointer">' + label + '</button>';
    return '<div style="background:#fff;color:#111;padding:24px;border-radius:12px;max-width:440px;max-height:85vh;overflow:auto;overflow-wrap:anywhere">'
        + '<h2 style="margin:0 0 12px;font-size:20px">' + window._posReceiptTextData(title) + '</h2>'
        + '<p class="pos-print-status" role="status" style="margin:0 0 18px;white-space:pre-line">' + window._posReceiptTextData(message) + '</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:10px">'
        + (offline ? button('id="oflPrintReceipt"', 'Print receipt', true) : button('class="pos-print-retry"', 'Retry QZ', true)
            + button('class="pos-print-browser"', 'Print using browser', false))
        + button('class="pos-print-cancel ofl-cancel"', 'Close', false) + '</div></div>';
}

/* === POS offline workspace: cached catalog, editable cart and durable checkout queue. === */
window._posOffline = (function () {
    var afScope = document.getElementById('cartInlineAddForm');
    var orgScope = afScope && afScope.querySelector('[name=posOrganizationPartyId]');
    var orgFallback = document.getElementById('pos-offline-org');
    var orgId = orgScope ? orgScope.value : orgFallback ? orgFallback.value : '';
    // New queues are per organization; verified legacy sales are copied without changing amounts.
    var DBN = 'ZenithPosOffline-' + encodeURIComponent(orgId),
        DBV = 2,
        db = null;
    var catalog = {}; // productId -> {productId,name,price,uom,taxCode,barcode}
    var cart = [];
    var lastLocalAmount;
    var booted = false;
    var syncing = false;
    var syncTask;
    var payPending = false;
    var heldSyncing = false;
    var serverDraftPaused = false;
    var restoringTask, restoreError;
    var transportDown = false, connectionProbe, connectionTimer;
    var pendingLocalEdits = [], storageReady = false, rejectedSales = new Map(), localClose = null;
    function disconnected() {
        return !navigator.onLine || transportDown;
    }
    function active() {
        return !!localClose || disconnected() || localEditing;
    }
    function connectionState() {
        if (disconnected()) return 'Offline';
        if (localClose || !localEditing) return 'Online';
        return restoreError ? 'Review cart' : 'Reconnecting';
    }
    function announceConnection() {
        window.dispatchEvent(new Event('posconnectionchange'));
    }
    function probeConnection() {
        if (!navigator.onLine) return Promise.resolve(false);
        if (!connectionProbe) {
            connectionProbe = fetch('Terminal/posAssetVersion', {
                method:'POST', credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(2500),
            }).then(function (response) {
                // An authentication rejection still proves the server is reachable.
                if (response.status === 401 || response.status === 403 ||
                    (response.redirected && /\/Login(?:[/?#]|$)/i.test(response.url))) return true;
                return response.ok && response.json().then(function (data) { return Number.isFinite(data && data.ver); });
            }).catch(function () { return false; })
                .finally(function () { connectionProbe = null; });
        }
        return connectionProbe;
    }
    function scheduleConnectionCheck() {
        clearTimeout(connectionTimer);
        if (storageReady && afScope && afScope.isConnected && tCtx().sessionId && navigator.onLine && !document.hidden)
            connectionTimer = setTimeout(checkConnection, 5000);
    }
    function connectionChanged() {
        scheduleConnectionCheck();
        announceConnection();
        if (localClose) { if (window.PosDeferredClose) window.PosDeferredClose.flush(); return; }
        if (disconnected()) {
            begin();
        } else {
            if (serverDraftPaused) {
                localEditing = serverDraftPaused = false;
                draft = null;
                pendingLocalEdits.length = 0;
            }
            sync().then(function () {
                if (localEditing && canUseOnlineHeldPicker()) window._posRefreshHeldPicker?.();
            });
            if (!localEditing) cacheCatalog();
        }
    }
    function checkConnection(force) {
        if (!afScope || !afScope.isConnected || !tCtx().sessionId || !navigator.onLine) return;
        return probeConnection().then(function (reachable) {
            if (!afScope.isConnected || !navigator.onLine) return;
            var changed = transportDown === reachable;
            transportDown = !reachable;
            if (changed || force === true || (reachable && draft?.restoreRequest && !restoreError)) connectionChanged();
            else scheduleConnectionCheck();
        });
    }
    function transportFailure(error) {
        if (!orgId || !tCtx().terminalId) return Promise.resolve(false);
        if (!navigator.onLine || transportDown) return Promise.resolve(true);
        if (!error || !(error.name === 'TypeError' || error.name === 'TimeoutError' || error.posGateway)) return Promise.resolve(false);
        return probeConnection().then(function (reachable) {
            if (!reachable && afScope && afScope.isConnected) {
                transportDown = true;
                connectionChanged();
            }
            return !reachable;
        });
    }
    function esc(x) {
        return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function f2(x) {
        return Number(x || 0).toFixed(2);
    }
    function tCtx() {
        var af = document.getElementById('cartInlineAddForm');
        function v(n) {
            var el = af && af.querySelector ? af.querySelector('[name=' + n + ']') : null;
            return el ? el.value : '';
        }
        var tEl = document.querySelector('input[name=posTerminalId]');
        return { sessionId: v('sessionId'), terminalId: tEl ? tEl.value : '' };
    }
    function openDB() {
        if (!orgId) return Promise.reject(new Error('No active POS organization'));
        return new Promise(function (res, rej) {
            var rq = indexedDB.open(DBN, DBV);
            rq.onupgradeneeded = function (e) {
                var d = e.target.result;
                if (!d.objectStoreNames.contains('catalog'))
                    d.createObjectStore('catalog', { keyPath: 'productId' });
                if (!d.objectStoreNames.contains('queue'))
                    d.createObjectStore('queue', { keyPath: 'offlineId' });
                if (!d.objectStoreNames.contains('state')) d.createObjectStore('state', { keyPath: 'key' });
            };
            rq.onsuccess = function (e) {
                db = e.target.result;
                res(db);
            };
            rq.onerror = function (e) {
                rej(e);
            };
        });
    }
    // Copy only sales whose original terminal/session ownership the server verifies.
    // Original values remain in the legacy DB until that exact sale is acknowledged.
    var legacyDb = null,
        legacyCopied = Object.create(null),
        recoveryInFlight = null;
    function legacyNotice(show) {
        var notice = document.getElementById('pos-legacy-offline-notice');
        if (!notice && show) {
            notice = document.createElement('div');
            notice.id = 'pos-legacy-offline-notice';
            notice.setAttribute('role', 'status');
            notice.style.cssText =
                'padding:10px;margin:8px;border:1px solid #b7791f;background:#fffbeb;color:#744210';
            notice.textContent =
                "Older offline sales remain on this device. Verified sales are available in this organization's pending queue. Keep this device available for the owner to reconcile any unresolved sales; do not clear browser storage.";
            var parent = document.querySelector('.pos-cart') || document.body;
            parent.parentNode.insertBefore(notice, parent);
        }
        if (notice) notice.hidden = !show;
    }
    function readLegacy() {
        return new Promise(function (resolve, reject) {
            if (legacyDb) {
                read();
                return;
            }
            var request = indexedDB.open('ZenithPosOffline');
            // Abort creation if this till never had a legacy database.
            request.onupgradeneeded = function () {
                request.transaction.abort();
            };
            request.onerror = function () {
                if (request.error && request.error.name === 'AbortError') resolve([]);
                else reject(new Error('Legacy offline storage could not be read'));
            };
            request.onblocked = function () {
                reject(new Error('Legacy offline storage is busy'));
            };
            request.onsuccess = function () {
                legacyDb = request.result;
                read();
            };
            function read() {
                if (!legacyDb.objectStoreNames.contains('queue')) {
                    resolve([]);
                    return;
                }
                var transaction = legacyDb.transaction('queue', 'readonly');
                var rows = transaction.objectStore('queue').getAll();
                rows.onsuccess = function () {
                    resolve(rows.result || []);
                };
                rows.onerror = function () {
                    reject(new Error('Legacy offline queue could not be read'));
                };
            }
        });
    }
    function copyVerifiedLegacy(sales) {
        return ensureDb().then(function (database) {
            if (!database) throw new Error('Offline storage unavailable');
            return new Promise(function (resolve, reject) {
                var copied = [],
                    transaction = database.transaction('queue', 'readwrite');
                var store = transaction.objectStore('queue');
                sales.forEach(function (sale) {
                    var row = Object.assign({}, sale, { organizationPartyId: orgId });
                    var existing = store.get(row.offlineId);
                    existing.onsuccess = function () {
                        // Never overwrite a newer or different sale that happens to reuse the id.
                        if (!existing.result) {
                            store.add(row);
                            copied.push({
                                id: row.offlineId,
                                source: JSON.stringify(sale),
                                payload: JSON.stringify(row),
                            });
                        } else if (JSON.stringify(existing.result) === JSON.stringify(row))
                            copied.push({
                                id: row.offlineId,
                                source: JSON.stringify(sale),
                                payload: JSON.stringify(row),
                            });
                    };
                });
                transaction.oncomplete = function () {
                    copied.forEach(function (copy) {
                        legacyCopied[copy.id] = copy;
                    });
                    resolve(copied.length);
                };
                transaction.onerror = transaction.onabort = function () {
                    reject(new Error('Legacy sales were not copied'));
                };
            });
        });
    }
    function recoverLegacy() {
        if (recoveryInFlight) return recoveryInFlight;
        recoveryInFlight = readLegacy()
            .then(function (sales) {
                legacyNotice(sales.length > 0);
                if (!sales.length || !navigator.onLine || !orgId) return 0;
                var token = document.querySelector('[name=moquiSessionToken]');
                if (!token || !token.value) return 0;
                var eligible = Object.create(null),
                    batches = [],
                    candidates = sales.filter(function (sale) {
                        return (
                            sale &&
                            sale.offlineId &&
                            sale.sessionId &&
                            sale.terminalId &&
                            (!sale.organizationPartyId || sale.organizationPartyId === orgId)
                        );
                    });
                for (var i = 0; i < candidates.length; i += 200) batches.push(candidates.slice(i, i + 200));
                return batches
                    .reduce(function (previous, batch) {
                        return previous.then(function () {
                            return fetch('Terminal/resolveLegacyOfflineScope', {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    moquiSessionToken: token.value,
                                    organizationPartyId: orgId,
                                    candidates: JSON.stringify(
                                        batch.map(function (sale) {
                                            return {
                                                offlineId: sale.offlineId,
                                                organizationPartyId: sale.organizationPartyId,
                                                sessionId: sale.sessionId,
                                                terminalId: sale.terminalId,
                                            };
                                        }),
                                    ),
                                }),
                            })
                                .then(function (response) {
                                    if (!response.ok)
                                        throw new Error('Legacy ownership could not be verified');
                                    return response.json();
                                })
                                .then(function (result) {
                                    if (
                                        result.organizationPartyId !== orgId ||
                                        !Array.isArray(result.eligibleIds)
                                    )
                                        throw new Error('Organization changed during recovery');
                                    result.eligibleIds.forEach(function (id) {
                                        if (
                                            batch.some(function (sale) {
                                                return sale.offlineId === id;
                                            })
                                        )
                                            eligible[id] = true;
                                    });
                                });
                        });
                    }, Promise.resolve())
                    .then(function () {
                        return copyVerifiedLegacy(
                            candidates.filter(function (sale) {
                                return eligible[sale.offlineId];
                            }),
                        );
                    });
            })
            .catch(function () {
                legacyNotice(true);
                return 0;
            });
        return recoveryInFlight.then(
            function (count) {
                recoveryInFlight = null;
                return count;
            },
            function (error) {
                recoveryInFlight = null;
                throw error;
            },
        );
    }
    function acknowledgeLegacy(ids, sent) {
        var acknowledged = ids.filter(function (id) {
            return (
                legacyCopied[id] &&
                sent.some(function (sale) {
                    return sale.offlineId === id && JSON.stringify(sale) === legacyCopied[id].payload;
                })
            );
        });
        if (!legacyDb || !acknowledged.length) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var transaction = legacyDb.transaction('queue', 'readwrite'),
                store = transaction.objectStore('queue');
            acknowledged.forEach(function (id) {
                var current = store.get(id);
                current.onsuccess = function () {
                    if (current.result && JSON.stringify(current.result) === legacyCopied[id].source)
                        store.delete(id);
                };
            });
            transaction.oncomplete = function () {
                acknowledged.forEach(function (id) {
                    delete legacyCopied[id];
                });
                readLegacy()
                    .then(function (rows) {
                        legacyNotice(rows.length > 0);
                    })
                    .catch(function () {
                        legacyNotice(
                            true,
                            'Legacy offline storage could not be checked. Keep this device and retry.',
                        );
                    });
                resolve();
            };
            transaction.onerror = transaction.onabort = function () {
                reject(new Error('Acknowledged legacy rows remain on the device'));
            };
        });
    }

    var settings = {},
        draft = null,
        holds = [],
        localEditing = false,
        snapshot = null,
        writeTail = Promise.resolve(),
        storageError = false;
    var scope = tCtx().terminalId + ':' + ((document.getElementById('pos-offline-user') || {}).value || '');
    function stateRead(key) {
        return ensureDb().then(function (d) {
            if (!d) throw Error('Offline storage unavailable');
            return new Promise(function (resolve, reject) {
                var r = d.transaction('state', 'readonly').objectStore('state').get(key);
                r.onsuccess = function () {
                    resolve(r.result && r.result.value);
                };
                r.onerror = function () {
                    reject(r.error);
                };
            });
        });
    }
    function stateWrite(key, value) {
        return ensureDb().then(function (d) {
            if (!d) throw Error('Offline storage unavailable');
            return new Promise(function (resolve, reject) {
                var t = d.transaction('state', 'readwrite');
                t.objectStore('state').put({ key: key, value: value });
                t.oncomplete = resolve;
                t.onerror = t.onabort = function () {
                    reject(t.error || Error('Offline storage failed'));
                };
            });
        });
    }
    function readSessionDraft() {
        var currentSession = tCtx().sessionId;
        return new Promise(function (resolve, reject) {
            var transaction = db.transaction('state', 'readwrite'), state = transaction.objectStore('state');
            var saved, request = state.get('draft:' + scope);
            request.onsuccess = function () {
                saved = request.result?.value || null;
                if (saved && saved.sessionId !== currentSession) {
                    state.put({key:'retained-draft:' + scope + ':' + saved.sessionId + ':' + (saved.draftId || 'legacy'), value:saved});
                    state.delete('draft:' + scope);
                    saved = null;
                }
            };
            transaction.oncomplete = function () { resolve(saved); };
            transaction.onerror = transaction.onabort = function () { reject(transaction.error || Error('Could not load the saved cart.')); };
        });
    }
    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }
    function saveDraft() {
        var saved = copy(draft);
        writeTail = writeTail
            .catch(function () {})
            .then(function () {
                return stateWrite('draft:' + scope, saved);
            });
        writeTail.then(
            function () {
                storageError = false;
            },
            function () {
                storageError = true;
                toast('Draft could not be saved on this device. Do not close this page.', '#c62828');
            },
        );
        return writeTail;
    }
    var catalogIndex = [], catalogRefresh;
    function catalogIdentity(config) {
        var user = (document.getElementById('pos-offline-user') || {}).value || '';
        return config && config.version === 2 && config.organizationPartyId === orgId &&
            config.terminalId === tCtx().terminalId && config.userId === user;
    }
    function installCatalog(config) {
        settings = config || {};
        catalog = {};
        catalogIndex = (settings.products || []).map(function (p) {
            catalog[p.productId] = p;
            return { product:p, text:[p.name, p.barcode, p.productId].join(' ').toLowerCase() };
        });
    }
    function loadCatalog() {
        return stateRead('config:' + scope).then(function (config) {
            installCatalog(catalogIdentity(config) ? config : null);
        });
    }
    function cacheCatalog() {
        if (localEditing) return Promise.resolve(0);
        if (catalogRefresh) return catalogRefresh;
        var request = new AbortController();
        var deadline = setTimeout(function () { request.abort(); }, 12000);
        catalogRefresh = fetch('Terminal/exportPosCatalog', {
            signal:request.signal,
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify({ terminalId:tCtx().terminalId }), credentials:'same-origin',
        }).then(function (response) {
            if (!response.ok) {
                var error = Error('Catalog unavailable');
                error.posGateway = [502,503,504].includes(response.status);
                throw error;
            }
            return response.json();
        }).then(function (config) {
            if (!catalogIdentity(config)) throw Error('Offline catalog identity differs');
            config.products = (config.products || []).map(function (p) {
                return Object.assign({}, p, {
                    name:p.productName || p.productId, price:Number(p.listPrice || 0), uom:p.uom || '',
                });
            });
            return stateWrite('config:' + scope, config).then(function () {
                installCatalog(config);
                var form = document.getElementById('cartInlineAddForm');
                var source = form && form.querySelector('[name=transactionId]');
                var id = source && source.value;
                if (!id || localEditing || (snapshot && snapshot.transactionId === id)) return config.products.length;
                var previousSnapshot = snapshot;
                var data = new URLSearchParams(new FormData(form));
                data.set('action', 'refresh');
                return fetch('Terminal/ajaxCart', {
                    method:'POST', body:data, credentials:'same-origin', signal:request.signal,
                }).then(function (response) {
                    if (!response.ok) return null;
                    return response.json();
                }).then(function (result) {
                    // A confirmed cart edit or tax change is newer than this background read.
                    if (!localEditing && snapshot === previousSnapshot && source.value === id &&
                        result && result.success && result.transactionId === id) remember(result);
                }).catch(function () {}).then(function () { return config.products.length; });
            });
        }).catch(function (error) { transportFailure(error); return 0; }).finally(function () {
            clearTimeout(deadline);
            catalogRefresh = null;
        });
        return catalogRefresh;
    }
    function ensureDb() {
        return db
            ? Promise.resolve(db)
            : openDB().catch(function () {
                  return null;
              });
    }
    function enqueue(sale) {
        return ensureDb().then(function (d) {
            if (!d) throw Error('Offline storage unavailable');
            return new Promise(function (resolve, reject) {
                var t = d.transaction(['queue', 'state'], 'readwrite');
                t.objectStore('queue').add(sale);
                t.objectStore('state').put({ key: 'draft:' + scope, value: null });
                t.objectStore('state').put({ key: 'snapshot:' + scope, value: null });
                t.oncomplete = resolve;
                t.onerror = t.onabort = function () {
                    reject(t.error || Error('Sale could not be saved'));
                };
            });
        });
    }
    function getQueue() {
        return ensureDb().then(function (d) {
            if (!d) return [];
            return new Promise(function (resolve, reject) {
                var r = d.transaction('queue', 'readonly').objectStore('queue').getAll();
                r.onsuccess = function () {
                    resolve(
                        (r.result || []).filter(function (s) {
                            return (
                                s.terminalId === tCtx().terminalId &&
                                (!s.userId || s.userId === (document.getElementById('pos-offline-user') || {}).value)
                            );
                        }),
                    );
                };
                r.onerror = function () {
                    reject(r.error);
                };
            });
        });
    }
    function toast(msg, bg) {
        var t = document.createElement('div');
        t.textContent = msg;
        t.setAttribute('role', 'alert');
        t.style.cssText =
            'position:fixed;top:55px;left:5%;right:5%;z-index:9999999;padding:14px;background:' +
            (bg || '#2e7d32') +
            ';color:white;text-align:center';
        document.body.appendChild(t);
        setTimeout(function () {
            t.remove();
        }, 5000);
    }
    function paused() {
        return serverDraftPaused;
    }
    function banner(show) {
        var b = document.getElementById('pos-offline-banner');
        if ((!serverDraftPaused && !restoreError) || localClose) { if (b) b.remove(); return; }
        if (!b) {
            b = document.createElement('span');
            b.id = 'pos-offline-banner';
            b.setAttribute('role', 'status');
            b.style.cssText =
                'position:fixed;top:0;left:0;right:0;z-index:999991;background:#92400e;color:white;text-align:center;padding:7px';
            document.body.appendChild(b);
        }
        b.hidden = !show;
        b.textContent = restoreError || 'Offline snapshot unavailable. Reconnect before changing this draft.';
    }
    function newDraft() {
        var c = tCtx();
        return {
            draftId: crypto.randomUUID(),
            items: [],
            mode:
                (document.querySelector('#cartInlineAddForm [name=salesModeId]') || {}).value ||
                ((settings.modes || [])[0] || {}).id ||
                '',
            taxOn: typeof window._posCurrentTax === 'function' ? window._posCurrentTax() : 'N',
            sessionId: c.sessionId,
            terminalId: c.terminalId,
            customer: null,
        };
    }
    function remember(data) {
        if (localEditing || !data || !data.success) return;
        snapshot = copy(data);
        if (data.transactionId && holds.some(function (bill) { return bill.serverHeldId && bill.sourceTransactionId === data.transactionId; })) {
            holds = holds.filter(function (bill) { return !bill.serverHeldId || bill.sourceTransactionId !== data.transactionId; });
            writeTail = writeTail.then(function () { return stateWrite('holds:' + scope, copy(holds)); });
        }
        if (db) stateWrite('snapshot:' + scope, snapshot).catch(function () {});
    }
    function setDraftSource(bill) {
        bill.sourceTransactionId = snapshot.transactionId;
        bill.sourceRevision = snapshot.sourceRevision;
        bill.originState = snapshot.originState;
        bill.destinationState = snapshot.destinationState;
        bill.items = snapshot.items.map(function (item) {
            return {productId:item.pid,seq:item.seq,name:item.name,printName:item.printName,
                qty:Number(item.qty),price:Number(item.price),mode:item.mode || bill.mode,
                uom:item.uom,discount:Number(item.disc || 0)};
        });
        bill.customer = snapshot.customer ? {partyId:snapshot.customerPartyId,name:snapshot.customer,
            phone:snapshot.customerPhone,creditDays:snapshot.customerCreditDays,state:snapshot.destinationState} : null;
        return bill;
    }
    function draftContent(bill) {
        var lines = bill.items.map(function (item) {
            return [item.productId, item.qty, item.price, item.mode, item.discount];
        });
        return JSON.stringify([lines, bill.mode, bill.taxOn, bill.customer, bill.destinationState, bill.sourceRevision]);
    }
    var leaseReady = false,
        leasePending = false;
    function begin() {
        if (localClose) return false;
        if (!storageReady || (window._posCartWriteInFlight && window._posCartWriteInFlight())) return false;
        if (!leaseReady) {
            if (!leasePending) {
                leasePending = true;
                if (!navigator.locks) {
                    serverDraftPaused = true;
                    banner(true);
                    toast(
                        'This browser cannot lock an offline workspace. Update the browser before offline checkout.',
                        '#c62828',
                    );
                    return false;
                }
                navigator.locks
                    .request(
                        'zenith-pos-offline:' + orgId + ':' + scope,
                        { ifAvailable: true },
                        function (lock) {
                            if (!lock) {
                                serverDraftPaused = true;
                                localEditing = true;
                                banner(true);
                                toast(
                                    'This offline terminal is open in another tab. Close that tab first.',
                                    '#c62828',
                                );
                                return;
                            }
                            leaseReady = true;
                            if (active() || draft || sessionHolds().length) begin();
                            if ((draft || sessionHolds().length) && !disconnected()) sync();
                            return new Promise(function () {});
                        },
                    )
                    .catch(function () {
                        serverDraftPaused = true;
                        banner(true);
                    });
            }
            return false;
        }
        if (localEditing) {
            if (restoringTask || draft?.restoreRequest) return false;
            if (!serverDraftPaused) applyPendingEdits();
            return !serverDraftPaused;
        }
        localEditing = true;
        announceConnection();
        if (!settings.version) {
            serverDraftPaused = true;
            banner(true);
            return false;
        }
        if (!draft) {
            var sourceId = (document.querySelector('#cartInlineAddForm [name=transactionId]') || {}).value;
            if (sourceId && (!snapshot || snapshot.transactionId !== sourceId)) {
                serverDraftPaused = true;
                banner(true);
                return false;
            }
            draft = newDraft();
            // A new empty bill must never inherit the previous bill's cached rows.
            if (sourceId && snapshot && snapshot.transactionId) {
                if (!snapshot.sourceRevision || Number(snapshot.paid) > 0) {
                    serverDraftPaused = true;
                    banner(true);
                    return false;
                }
                setDraftSource(draft);
            }
            if (draft.sourceTransactionId) draft.onlineBaseline = draftContent(draft);
        }
        cart = draft.items;
        if (!applyPendingEdits()) change();
        return true;
    }
    function modeInfo(id) {
        return (
            (settings.modes || []).find(function (m) {
                return m.id === id;
            }) || {}
        );
    }
    function money(n) {
        return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }
    function totals(bill) {
        bill = bill || draft;
        var sub = 0,
            tax = 0,
            discount = 0,
            qty = 0;
        bill.items.forEach(function (i) {
            var p = catalog[i.productId] || {},
                m = modeInfo(i.mode),
                gross = Number(i.price) * Number(i.qty),
                disc = (gross * Number(i.discount || 0)) / 100,
                net = gross - disc;
            var destination = (bill.customer || {}).state || bill.destinationState || settings.state,
                interstate = destination && String(destination) !== String(settings.state);
            var rates = (interstate ? p.interstateRates : p.taxRates) || [],
                sum = rates.reduce(function (s, r) {
                    return s + Number(r);
                }, 0),
                base = net,
                amount = 0;
            if (bill.taxOn === 'Y') {
                if (m.inclusive && sum > 0) base = money((net * 100) / (100 + sum));
                amount = rates.reduce(function (s, r) {
                    return s + money((base * Number(r)) / 100);
                }, 0);
            }
            i.tax = money(amount);
            i.taxable = base;
            i.total = base + i.tax;
            sub += base;
            tax += i.tax;
            discount += disc;
            qty += Number(i.qty);
        });
        var grand = sub + tax;
        return {
            sub: sub,
            tax: money(tax),
            disc: discount,
            grand: grand,
            pay: Math.round(grand),
            round: Math.round(grand) - grand,
            qty: qty,
        };
    }
    function taxEnabled() {
        return draft && draft.taxOn === 'Y';
    }
    function payable() {
        return totals().pay;
    }
    function render() {
        if (serverDraftPaused || !draft || !window._posRenderOfflineCart) return;
        cart = draft.items;
        var t = totals();
        window._posRenderOfflineCart({
            success: true,
            items: cart.map(function (item) {
                item.seq ||= 'local-' + crypto.randomUUID();
                return Object.assign({pid:item.productId}, item);
            }),
            modes: settings.modes || [],
            mode: draft.mode,
            modeLabel: modeInfo(draft.mode).name || 'Retail',
            canOverride: settings.canOverride,
            lastLocalAmount: lastLocalAmount,
            sub:t.sub, tax:t.tax, disc:t.disc, round:t.round, pay:t.pay, tQty:t.qty,
        });
        banner(true);
        var taxLabel = document.querySelector('.nb-tax__lbl');
        if (taxLabel) taxLabel.textContent = 'Tax: ' + (draft.taxOn === 'Y' ? 'On' : 'Off');
        var taxButton = document.querySelector('.nb-tax button');
        if (taxButton) {
            taxButton.classList.toggle('on', draft.taxOn === 'Y');
            taxButton.setAttribute('aria-pressed', String(draft.taxOn === 'Y'));
        }
        window._posSetCustomerChip(draft.customer && draft.customer.name, draft.customer && draft.customer.phone);
        renderHeldPicker();
    }
    function change() {
        saveDraft();
        render();
    }
    function addLine(pid, quantity, mode, seq) {
        var p = catalog[pid];
        if (!p) {
            toast('Product unavailable in this terminal’s offline catalog.', '#c62828');
            return;
        }
        var price = (p.prices || {})[mode];
        var rate = Number(price ? price.price : p.price) || 0,
            existing = cart.find(function (i) {
                return i.productId === pid && i.mode === mode && i.price === rate;
            });
        if (existing) {
            existing.qty += quantity;
            return existing;
        }
        var line = {
                productId: pid,
                seq: seq || 'local-' + crypto.randomUUID(),
                name: p.name,
                price: rate,
                qty: quantity,
                uom: p.uom,
                mode: mode,
                discount: Number((price && price.disc) || 0),
        };
        cart.push(line);
        return line;
    }
    function applyPendingEdits() {
        if (!pendingLocalEdits.length) return false;
        var focus, tempLines = new Map();
        pendingLocalEdits.splice(0).forEach(function (edit) {
            if (edit.action === 'addItem' || edit.action === 'scanAdd') {
                var product = edit.pid;
                if (edit.action === 'scanAdd') {
                    var matches = search(edit.code);
                    if (!matches.length) { toast('No cached products match.', '#c62828'); return; }
                    product = matches[0].productId;
                }
                focus = addLine(product, edit.addQty || 1, edit.mode || draft.mode, edit.ts);
                if (edit.ts && focus) tempLines.set(edit.ts, focus);
                return;
            }
            var line = tempLines.get(edit.seq) || cart.find(function (item) { return String(item.seq) === String(edit.seq); });
            if (!line || !cart.includes(line)) return;
            if (edit.action === 'updateQty' && Number.isFinite(Number(edit.newQty)) && Number(edit.newQty) > 0) line.qty = Number(edit.newQty);
            else if (edit.action === 'updatePrice' && settings.canOverride && Number.isFinite(Number(edit.newPrice)) && Number(edit.newPrice) > 0)
                line.price = Number(edit.newPrice);
            else if (edit.action === 'removeItem') cart.splice(cart.indexOf(line), 1);
            else if (edit.action === 'setItemMode') {
                var price = ((catalog[line.productId] || {}).prices || {})[edit.mode];
                if (price && !price.blocked) {
                    line.mode = edit.mode;
                    line.price = Number(price.price);
                    line.discount = Number(price.disc || 0);
                }
            }
        });
        change();
        if (focus && cart.includes(focus)) {
            var input = Array.from(document.querySelectorAll('.pos-cart .aj-qi')).find(function (field) {
                return field.dataset.seq === String(focus.seq);
            });
            if (input) { input.focus(); input.select(); }
        }
        return true;
    }
    function handoff(edits) {
        pendingLocalEdits = edits.concat(pendingLocalEdits);
        begin();
    }
    function edit(op) {
        if (serverDraftPaused || payPending || restoringTask || draft?.restoreRequest) return;
        pendingLocalEdits.push(op);
        begin();
    }
    function add(pid) { edit({action:'addItem',pid:pid}); }
    function search(term, respectWordBoundary) {
        var raw = String(term || '').toLowerCase();
        var terms = raw.trim().split(/\s+/);
        if (respectWordBoundary && terms.length === 1 && /\s$/.test(raw)) terms[0] += ' ';
        if (!terms[0]) return [];
        var found = [];
        for (var i = 0; i < catalogIndex.length && found.length < 50; i++) {
            var entry = catalogIndex[i];
            if (terms.every(function (token) { return entry.text.indexOf(token) >= 0; })) found.push(entry.product);
        }
        return found;
    }
    function scan(code) { edit({action:'scanAdd',code:code}); }
    function gridPage(params) {
        if (params.catId && !settings.gridCategories) throw Error('Reconnect once to refresh cached categories.');
        var category = params.catId ? new Set(settings.gridCategories[params.catId] || []) : null;
        var stock = settings.gridStockTracking;
        var term = String(params.searchTerm || '').trim().toLowerCase().split(/\s+/);
        var matches = catalogIndex.filter(function (entry) {
            var id = entry.product.productId;
            return (!stock || Object.hasOwn(stock, id)) && (!category || category.has(id)) &&
                term.every(function (word) { return entry.text.includes(word); });
        }).map(function (entry) { return entry.product; });
        matches.sort(function (a,b) { return a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId); });
        var offset = Math.max(0, Number(params.productOffset) || 0);
        var mode = draft ? draft.mode : newDraft().mode;
        var amount = new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
        var products = matches.slice(offset, offset + 60).map(function (p) {
            var rate = (p.prices || {})[mode];
            var price = rate ? rate.price : p.price;
            return {productId:p.productId, name:p.name, price:price || 0,
                priceText:price == null ? '₹0 · Enter price' : '₹' + amount.format(price),
                stockText:stock && stock[p.productId] === false ? 'Stock: not tracked' : 'Stock: unavailable'};
        });
        return {products:products, hasMore:offset + products.length < matches.length, nextOffset:offset + products.length};
    }
    function lookup(pid) {
        return catalog[pid] || null;
    }
    function catalogSize() {
        return Object.keys(catalog).length;
    }
    function modal(title, body, panelWidth) {
        var old = document.getElementById('posOfflineDialog');
        if (old) old.remove();
        var overlay = document.createElement('dialog');
        overlay.id = 'posOfflineDialog';
        overlay.className = 'pos-pay-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', title);
        overlay.style.cssText = 'position:fixed;inset:0;background:transparent;border:0;padding:0;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);width:' + (panelWidth || 460) + 'px';
        overlay.innerHTML = (panelWidth
            ? '<form novalidate style="margin:0">'
            : '<form style="background:white;color:#111;border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:85vh;overflow:auto"><h2>' + esc(title) + '</h2>') +
            body +
            '<p role="alert" class="ofl-error" style="color:#b91c1c" hidden></p>' +
            (panelWidth ? '' : '<button type="button" class="ofl-cancel">Cancel</button>') + '</form>';
        function close() {
            if (payPending || overlay.dataset.paymentReceived) return;
            overlay.close();
            overlay.remove();
            resumeOnline();
        }
        overlay.querySelector('.ofl-cancel,.pos-cash-cancel,.pos-split-cancel,#posPayConfCancel,#credit-cancel')?.addEventListener('click', close);
        overlay.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
        overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
        document.body.appendChild(overlay);
        overlay.showModal();
        return overlay;
    }
    function customerPicker() {
        if (!begin()) return null;
        return {
            taxOn: taxEnabled(),
            search: function (term) {
                term = term.trim().toLowerCase();
                var digits = term.replace(/\D/g, '');
                return (settings.customers || []).filter(function (customer) {
                    return customer.name.toLowerCase().includes(term) || customer.partyId.toLowerCase().includes(term) ||
                        (digits.length >= 3 && String(customer.phone || '').replace(/\D/g, '').includes(digits));
                }).sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 30);
            },
            select: function (customer, wantsTaxBill) {
                if (!begin()) return false;
                var origin = draft.originState || settings.state;
                var destination = customer?.state || origin;
                var currentDestination = draft.customer?.state || draft.destinationState || origin;
                if (draft.items.length && destination !== currentDestination) {
                    toast('Start a new bill to change the tax destination. Existing bill amounts are preserved.', '#c62828');
                    return false;
                }
                draft.customer = customer ? copy(customer) : null;
                draft.destinationState = destination;
                if (customer && wantsTaxBill) draft.taxOn = 'Y';
                change();
                return true;
            },
            close: resumeOnline,
        };
    }
    function discountDialog() {
        var ov = modal(
            'Bill discount',
            '<label>Discount %<input id="oflDiscount" inputmode="decimal" value="0"/></label><p>Discounts above this shop’s manager limit require an online approval.</p><button type="submit">Apply discount</button>',
        );
        ov.querySelector('form').onsubmit = function (e) {
            e.preventDefault();
            var percent = Number(ov.querySelector('input').value);
            if (
                !settings.canOverride ||
                !Number.isFinite(percent) ||
                percent < 0 ||
                percent >= 100 ||
                (settings.discountLimit != null && percent > Number(settings.discountLimit))
            ) {
                ov.querySelector('.ofl-error').textContent =
                    'Use an authorized discount below 100%, or reconnect for manager approval.';
                ov.querySelector('.ofl-error').hidden = false;
                return;
            }
            cart.forEach(function (i) {
                i.discount = percent;
            });
            change();
            ov.remove();
        };
    }
    function storeWorkspace(nextDraft, nextHolds) {
        return ensureDb().then(function (d) {
            return new Promise(function (resolve, reject) {
                var transaction = d.transaction('state', 'readwrite'),
                    store = transaction.objectStore('state');
                store.put({ key: 'draft:' + scope, value: copy(nextDraft) });
                store.put({ key: 'holds:' + scope, value: copy(nextHolds) });
                transaction.oncomplete = resolve;
                transaction.onerror = transaction.onabort = function () {
                    reject(transaction.error);
                };
            });
        });
    }
    function holdDraft() {
        if (!cart.length || payPending || draft?.restoreRequest) return Promise.resolve(false);
        if (heldSyncing) {
            toast('Held bills are reconnecting. Try again in a moment.');
            return Promise.resolve(false);
        }
        payPending = true;
        heldCacheVersion++;
        var saved = copy(draft);
        delete saved.onlineBaseline;
        saved.draftId = crypto.randomUUID();
        saved.heldAt = Date.now();
        var all = holds.concat([saved]),
            next = newDraft();
        writeTail = writeTail
            .then(function () {
                return storeWorkspace(next, all);
            })
            .then(function () {
                holds = all;
                draft = next;
                cart = draft.items;
                render();
                toast('Bill held', '#b45309');
                return true;
            })
            .catch(function () {
                toast('Could not hold the bill. Keep it open.', '#c62828');
                return false;
            })
            .finally(function () {
                payPending = false;
            });
        return writeTail.then(function (saved) {
            if (!saved || disconnected()) return false;
            return (syncTask || Promise.resolve()).then(sync).then(function () { return !active(); });
        });
    }
    function canUseOnlineHeldPicker() {
        return !disconnected() && !serverDraftPaused && !sessionHolds().some(function (bill) { return !bill.serverHeldId; });
    }
    var heldCacheTask, heldCacheVersion = 0;
    // Keep server holds on the device too; only unacknowledged local holds need uploading.
    function cacheHeldBills(changed) {
        if (changed === true) heldCacheVersion++;
        if (!storageReady || disconnected() || localClose || !tCtx().sessionId) return Promise.resolve();
        if (heldCacheTask) return heldCacheTask;
        var context = tCtx(), version = heldCacheVersion;
        heldCacheTask = fetch('Terminal/ajaxCart', {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(12000),
            body:new URLSearchParams({action:'listHeld',sessionId:context.sessionId,
                moquiSessionToken:(document.querySelector('[name=moquiSessionToken]') || {}).value || ''})})
            .then(function (response) { if (!response.ok) throw Error('Held bills unavailable.'); return response.json(); })
            .then(function (result) {
                if (!result.success || !Array.isArray(result.held)) return;
                return getQueue().then(function (sales) {
                    writeTail = writeTail.then(async function () {
                        if (context.sessionId !== tCtx().sessionId || payPending || heldSyncing || version !== heldCacheVersion) return;
                        var pending = holds.filter(function (bill) { return !bill.serverHeldId; });
                        var consumed = new Set(pending.concat(sales, draft ? [draft] : []).map(function (bill) { return bill.sourceHeldId; }).filter(Boolean));
                        var mirrored = result.held.map(function (bill) { return bill.workspace; }).filter(function (bill) {
                            return bill && bill.sessionId === context.sessionId && bill.terminalId === context.terminalId && !consumed.has(bill.serverHeldId) && bill.sourceTransactionId !== snapshot?.transactionId;
                        });
                        var next = holds.filter(function (bill) { return bill.sessionId !== context.sessionId && bill.serverHeldId; }).concat(pending, mirrored);
                        await stateWrite('holds:' + scope, copy(next));
                        holds = next;
                        renderHeldPicker();
                    });
                    return writeTail;
                });
            }).catch(function () {}).finally(function () {
                heldCacheTask = null;
                if (version !== heldCacheVersion) return cacheHeldBills();
            });
        return heldCacheTask;
    }
    function renderHeldPicker() {
        var wrap = document.getElementById('pos-held-wrap');
        if (!wrap || !localEditing || canUseOnlineHeldPicker()) return;
        var button = wrap.querySelector('summary,button');
        if (!button) return;
        var open = !!wrap.querySelector('details[open]');
        var summary = document.createElement('summary');
        summary.className = 'nb-abtn nb-abtn--hold';
        summary.innerHTML = button.innerHTML;
        summary.querySelectorAll('.nb-cnt').forEach(function (count) { count.remove(); });
        var currentHolds = sessionHolds();
        if (currentHolds.length) {
            var count = document.createElement('span');
            count.className = 'nb-cnt'; count.textContent = currentHolds.length;
            summary.insertBefore(count, summary.querySelector('kbd'));
        }
        var details = document.createElement('details');
        details.className = 'nb-held__d'; details.open = open;
        details.appendChild(summary);
        var menu = document.createElement('div');
        menu.className = 'nb-held__menu';
        menu.innerHTML = '<div class="nb-held__hint">Tap a bill to switch to it. Your current cart is held automatically.</div>';
        currentHolds.reverse().forEach(function (held, index) {
            var row = document.createElement('button');
            row.type = 'button'; row.className = 'nb-held__item'; row.dataset.recall = held.draftId;
            var time = held.heldAt ? new Date(held.heldAt).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}) : '';
            row.innerHTML = '<span><b>Held bill ' + (index + 1) + '</b> · ' + held.items.length + (held.items.length === 1 ? ' item' : ' items') +
                '<div class="nb-held__t">' + (time ? 'held ' + esc(time) + ' · ' : '') + 'Saved on this device</div></span>' +
                '<span class="nb-held__amt">₹ ' + totals(held).sub.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}) + '</span>';
            menu.appendChild(row);
        });
        if (!currentHolds.length) menu.innerHTML += '<div class="nb-held__hint">No held bills on this device.</div>';
        details.appendChild(menu);
        wrap.replaceChildren(details);
    }
    function heldDialog() {
        renderHeldPicker();
        var picker = document.querySelector('#pos-held-wrap details');
        if (picker) picker.open = !picker.open;
    }
    function recallDraft(id) {
        if (payPending || heldSyncing || draft?.restoreRequest) return;
        var held = sessionHolds().find(function (bill) { return bill.draftId === id; });
        if (!held) return;
        payPending = true;
        heldCacheVersion++;
        var next = copy(held), rest = holds.filter(function (bill) { return bill.draftId !== id; });
        delete next.serverHeldId;
        if (cart.length) {
            var current = copy(draft);
            delete current.onlineBaseline;
            current.draftId = crypto.randomUUID(); current.heldAt = Date.now(); rest.push(current);
        }
        writeTail = writeTail.then(function () { return storeWorkspace(next, rest); }).then(function () {
            draft = next; holds = rest; cart = draft.items;
            render();
            var picker = document.querySelector('#pos-held-wrap details');
            if (picker) picker.open = false;
        }).catch(function () {
            toast('Could not recall this bill. Keep this page open.', '#c62828');
        }).finally(function () {
            payPending = false;
            if (!disconnected()) sync();
        });
    }
    function sessionHolds() {
        var sessionId = tCtx().sessionId;
        return holds.filter(function (bill) { return bill.sessionId === sessionId; });
    }
    function syncHeldDrafts(sales) {
        if (!leaseReady || serverDraftPaused || heldSyncing || payPending || disconnected()) return Promise.resolve();
        var activeSource = draft && draft.sourceTransactionId;
        var ready = sessionHolds().filter(function (bill) {
            if (bill.serverHeldId) return false;
            if (!bill.sourceTransactionId) return true;
            return bill.sourceTransactionId !== activeSource && !sales.some(function (sale) {
                return sale.sourceTransactionId === bill.sourceTransactionId;
            });
        });
        if (!ready.length) return Promise.resolve();
        heldSyncing = true;
        heldCacheVersion++;
        var saved = ready.slice(0,100).map(function (bill) {
            var amounts = totals(bill);
            return Object.assign(copy(bill), {version:2,offlineId:bill.draftId,userId:settings.userId,
                organizationPartyId:orgId,total:amounts.pay,taxAmount:amounts.tax,
                ts:new Date(bill.heldAt || Date.now()).toISOString()});
        });
        var token = document.querySelector('[name=moquiSessionToken]');
        return fetch('Terminal/syncOfflineHeldBills', {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(20000),
            headers:{'Content-Type':'application/json'},body:JSON.stringify({terminalId:tCtx().terminalId,sessionId:tCtx().sessionId,
                moquiSessionToken:token && token.value,heldBills:saved})
        }).then(function (response) {
            if (!response.ok) throw Error('Held bills remain saved on this device.');
            return response.json();
        }).then(function (result) {
            var ids = new Set((result.syncedIds || []).filter(function (id) { return saved.some(function (bill) { return bill.offlineId === id; }); }));
            if (!ids.size) return;
            heldCacheVersion++;
            writeTail = writeTail.then(async function () {
                var rest = holds.flatMap(function (bill) {
                    if (!ids.has(bill.draftId)) return [bill];
                    var source = (result.heldSources || {})[bill.draftId];
                    return source ? [Object.assign(copy(bill), source)] : [];
                });
                await stateWrite('holds:' + scope, copy(rest));
                holds = rest;
                renderHeldPicker();
                if ((!localEditing || cart.length) && canUseOnlineHeldPicker()) window._posRefreshHeldPicker?.();
            });
            return writeTail;
        }).catch(function (error) { return transportFailure(error); })
          .finally(function () { heldSyncing = false; });
    }
    function validation(method, bill = draft) {
        if (!cart.length) return 'Add products first.';
        if (storageError) return 'Device storage failed. Keep this bill open.';
        if (
            Array.from(document.querySelectorAll('.pos-cart .aj-p,.pos-cart .aj-qi')).some(function (el) {
                return !el.value.trim() || !Number.isFinite(Number(el.value)) || Number(el.value) <= 0;
            })
        )
            return 'Correct the rate and quantity fields before payment.';
        if (
            cart.some(function (i) {
                return !Number.isFinite(i.qty) || i.qty <= 0 || !Number.isFinite(i.price) || i.price <= 0;
            })
        )
            return 'Enter positive quantities and prices. Free items need online manager approval.';
        if (
            bill.taxOn === 'Y' &&
            cart.some(function (i) {
                var destination = (bill.customer || {}).state || bill.destinationState || settings.state;
                return !Array.isArray(
                    (catalog[i.productId] || {})[
                        destination && String(destination) !== String(settings.state)
                            ? 'interstateRates'
                            : 'taxRates'
                    ],
                );
            })
        )
            return 'Tax cache is unavailable for an item. Reconnect before payment.';
        var total = totals(bill);
        if (total.pay <= 0) return 'Reconnect to complete a zero-total bill.';
        var modes = new Set(
            cart.map(function (i) {
                return i.mode;
            }),
        );
        var rule = (settings.rules || []).find(function (r) {
            return modes.has(r.mode) && ((r.customer && !bill.customer && method !== 'Credit') || Number(r.minimum) > total.grand);
        });
        if (rule) return 'This shop’s customer or minimum-order rule is not met.';
        return '';
    }
    function tenderError(overlay, message) {
        var error = overlay.querySelector('.ofl-error');
        error.textContent = message;
        error.hidden = !message;
    }
    function tender(method) {
        if (!disconnected()) return;
        if (!begin()) return;
        var error = validation(method);
        if (error) {
            toast(error, '#c62828');
            return;
        }
        var total = payable();
        var dialogs = window.PosTillDialogs;
        if (method === 'Credit') { creditTender(); return; }
        if (method === 'Cash') {
            var ov = modal('Cash payment', dialogs.cashMarkup(total, true), 540);
            var panel = ov.querySelector('.pos-cash-panel'), input = panel.querySelector('.pos-cash-input');
            input.addEventListener('input', function () { dialogs.updateCash(panel, total); });
            panel.addEventListener('click', function (event) {
                var quick = event.target.closest('.pos-cash-quick');
                if (!quick) return;
                input.value = quick.dataset.amt;
                dialogs.updateCash(panel, total);
            });
            input.focus();
            ov.querySelector('form').onsubmit = function (event) {
                event.preventDefault();
                if (dialogs.updateCash(panel, total)) pay('Cash', [{method:'Cash',amount:Number(input.value)}], ov);
            };
            return;
        }
        if (method === 'Split') {
            var split = modal('Split payment', dialogs.splitMarkup(total), 540);
            var splitPanel = split.querySelector('.pos-split-panel');
            dialogs.bindSplit(splitPanel, total);
            splitPanel.querySelector('[name=cashAmount]').focus();
            split.querySelector('form').onsubmit = function (event) {
                event.preventDefault();
                if (!dialogs.updateSplit(splitPanel, total)) return;
                var payments = ['Cash','Card','UPI'].map(function (kind) {
                    var key = kind.toLowerCase(), amount = Number(splitPanel.querySelector('[name=' + key + 'Amount]').value);
                    var reference = splitPanel.querySelector('[name=' + key + 'Ref]')?.value.trim().slice(0, 80);
                    return reference ? {method:kind,amount:amount,reference:reference} : {method:kind,amount:amount};
                }).filter(function (payment) { return payment.amount > 0; });
                var cashChange = payments.length === 1 && payments[0].method === 'Cash' && payments[0].amount > total;
                pay(cashChange ? 'Cash' : 'Split', payments, split);
            };
            return;
        }
        var digital = modal(method + ' Payment', dialogs.digitalMarkup(method, total, true), 420);
        var confirmation = digital.querySelector('#posPayConfOk');
        confirmation.focus();
        confirmation.onclick = function () {
            var payments = [{method:method,amount:total}];
            if (method !== 'UPI') { pay(method, payments, digital); return; }
            digital.dataset.paymentReceived = 'true';
            digital.setAttribute('aria-label', 'Save UPI bill');
            var card = digital.querySelector('form').firstElementChild;
            card.innerHTML = dialogs.upiReceiptMarkup(total);
            var save = card.querySelector('#posPaySave');
            save.onclick = function () { pay(method, payments, digital, {receipt:'save'}); };
            card.querySelector('#posPaySavePrint').onclick = function () { pay(method, payments, digital, {receipt:'print'}); };
            save.focus();
        };
    }
    function creditTender() {
        var overlay = modal('Credit sale', window.PosTillDialogs.creditMarkup(), 420);
        var field = function (id) { return overlay.querySelector('#credit-' + id); };
        var name = field('name'), phone = field('phone'), days = field('days'), reason = field('terms-reason');
        var results = field('cust-results'), upfront = field('upfront'), confirm = field('confirm');
        var selected = draft.customer && draft.customer.partyId ? draft.customer : null;
        var phoneDigits = function (value) { return String(value || '').replace(/\D/g, ''); };
        var creditZone = settings.creditTimeZone;
        name.value = (draft.customer || {}).name || '';
        phone.value = (draft.customer || {}).phone || '';
        name.maxLength = 80;
        phone.maxLength = 20;
        confirm.type = 'submit';
        field('due-preview').before(overlay.querySelector('.ofl-error'));
        function withCustomer(customer) {
            return Object.assign({}, draft, {customer:customer, destinationState:customer?.state || draft.originState || settings.state});
        }
        function hideResults() { results.style.display = 'none'; results.replaceChildren(); }
        function preview() {
            var total = totals(withCustomer(selected)).pay;
            upfront.max = String(total);
            var paid = upfront.valueAsNumber;
            field('due-preview').textContent = upfront.validity.valid && Number.isFinite(paid)
                ? 'Balance after this payment: ₹' + f2(total - paid) : 'Enter an amount from ₹0 to the bill total.';
            var note = field('date-preview');
            if (!days.value || !days.validity.valid) { note.textContent = 'Choose a calendar-day term for this bill.'; return; }
            var dateParts = new Intl.DateTimeFormat('en-CA', {timeZone:creditZone,year:'numeric',month:'2-digit',day:'2-digit'})
                .formatToParts(new Date());
            var part = function (type) { return Number(dateParts.find(function (entry) { return entry.type === type; }).value); };
            var due = new Date(Date.UTC(part('year'),part('month') - 1,part('day') + days.valueAsNumber));
            note.textContent = 'Due through ' + due.toISOString().slice(0,10) + (creditZone ? ' (' + creditZone + ')' : '') + '. Day 0 is today.';
        }
        function applyTerms() {
            days.value = selected?.creditDays ?? '';
            days.readOnly = selected?.creditDays != null && !settings.canOverrideCreditTerms;
            reason.parentElement.hidden = !(selected?.creditDays != null && settings.canOverrideCreditTerms);
            reason.value = '';
            preview();
        }
        function selectCustomer(customer) {
            selected = customer;
            name.value = customer.name;
            phone.value = customer.phone || '';
            hideResults();
            applyTerms();
            (phone.value ? upfront : phone).focus();
        }
        name.addEventListener('input', function () {
            if (selected) { selected = null; phone.value = ''; applyTerms(); }
            hideResults();
            var term = name.value.trim().toLowerCase();
            if (!term) return;
            var matches = (settings.customers || []).filter(function (customer) {
                return customer.name.toLowerCase().includes(term) || String(customer.phone || '').includes(term);
            });
            matches.slice(0,8).forEach(function (customer) {
                var button = document.createElement('button');
                button.type = 'button'; button.className = 'cc-row';
                button.style.cssText = 'display:block;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #f0f0f0;background:#fff;color:#e65100;text-align:left;font-weight:700;cursor:pointer';
                button.textContent = customer.name + (customer.phone ? ' · ' + customer.phone : '');
                button.onclick = function () { selectCustomer(customer); };
                results.appendChild(button);
            });
            if (matches.length) results.style.display = 'block';
        });
        phone.addEventListener('input', function () {
            if (selected && selected.phone && phoneDigits(phone.value) !== phoneDigits(selected.phone)) {
                selected = null;
                applyTerms();
            }
        });
        field('add-customer').onclick = function () {
            selected = null;
            hideResults();
            applyTerms();
            (name.value.trim() ? phone : name).focus();
        };
        overlay.addEventListener('click', function (event) {
            if (event.target !== name && !results.contains(event.target)) hideResults();
        });
        overlay.addEventListener('input', function () { tenderError(overlay, ''); });
        upfront.addEventListener('input', preview);
        days.addEventListener('input', preview);
        applyTerms();
        name.focus();
        overlay.querySelector('form').onsubmit = function (event) {
            event.preventDefault();
            var customerName = name.value.trim(), customerPhone = phoneDigits(phone.value);
            if (!customerName) { tenderError(overlay, 'Enter the customer name.'); name.focus(); return; }
            if (!/^\d{10,15}$/.test(customerPhone)) { tenderError(overlay, 'Enter a valid 10 to 15 digit phone number.'); phone.focus(); return; }
            if (!days.validity.valid) { tenderError(overlay, 'Enter 0–3650 calendar days.'); days.focus(); return; }
            var customer = selected || (settings.customers || []).find(function (saved) {
                return saved.name.toLowerCase() === customerName.toLowerCase() && phoneDigits(saved.phone) === customerPhone;
            });
            var creditDays = days.value === '' ? customer?.creditDays ?? null : days.valueAsNumber;
            if (customer?.creditDays != null && creditDays !== customer.creditDays &&
                (!settings.canOverrideCreditTerms || !reason.value.trim())) {
                tenderError(overlay, 'Use the saved credit term or enter a manager-approved reason to override it.');
                return;
            }
            var bill = withCustomer(Object.assign({}, customer, {name:customerName,phone:customerPhone,creditDays:creditDays}));
            if (reason.value.trim()) bill.customer.termsReason = reason.value.trim();
            var error = validation('Credit',bill);
            if (error) { tenderError(overlay,error); return; }
            upfront.max = String(totals(bill).pay);
            var paid = upfront.valueAsNumber;
            if (!Number.isFinite(paid) || !upfront.validity.valid) {
                tenderError(overlay, 'Enter an amount from ₹0 to the bill total, with at most two decimal places.');
                upfront.focus();
                return;
            }
            var payments = paid > 0 ? [{method:field('upfront-method').value,amount:paid}] : [];
            pay('Credit',payments,overlay,{bill:bill});
        };
    }
    function pay(method, payments, ov, options = {}) {
        if (payPending) return;
        tenderError(ov, '');
        payPending = true;
        var bill = options.bill || draft;
        var t = totals(bill),
            sale = Object.assign(copy(bill), {
                version: 2,
                offlineId: 'OFL-' + crypto.randomUUID(),
                userId: settings.userId,
                organizationPartyId: orgId,
                store: Object.assign({}, settings.store, method === 'Credit' ? settings.creditReceiptText : null),
                receiptOptions: settings.receiptOptions?.[method === 'Credit' ? 'credit' : 'normal'],
                total: t.pay,
                taxAmount: t.tax,
                subtotal: t.sub,
                discountTotal: t.disc,
                roundOff: t.round,
                paymentMethod: method,
                change: method === 'Cash' ? money(payments[0].amount - t.pay) : 0,
                payments: payments,
                ts: new Date().toISOString(),
            });
        delete sale.onlineBaseline;
        writeTail
            .catch(function () {
                throw Error('Draft storage failed');
            })
            .then(function () {
                return enqueue(sale);
            })
            .then(
                function () {
                    lastLocalAmount = sale.total;
                    draft = newDraft();
                    cart = draft.items;
                    snapshot = null;
                    render();
                    banner(true);
                    if (ov) ov.remove();
                    if (options.receipt === 'print') printReceipt(sale);
                    if (options.receipt) toast('Bill saved on this device and queued to sync.');
                    else receiptDialog(sale);
                    if (!disconnected()) sync();
                },
                function (e) {
                    tenderError(ov, 'Could not save the sale. ' + e.message);
                },
            )
            .finally(function () {
                payPending = false;
            });
    }
    function printReceipt(sale) {
        var customer = sale.customer || {}, payments = sale.payments || [];
        var store = Object.assign({showPaymentDetails:'Y'}, sale.store);
        var isCredit = sale.paymentMethod === 'Credit';
        var receipt = {
            store:store,
            options:sale.receiptOptions,
            bill:{number:sale.offlineId,numbers:{offline:true},date:new Date(sale.ts).toLocaleString(),
                customer:customer.name || 'Walk-in Customer', customerPhone:customer.phone},
            items:sale.items.map(function (item) {
                return {name:item.printName || (catalog[item.productId] || {}).printName || item.name,
                    qty:item.qty,uom:item.uom,rate:item.price,total:item.total,tax:item.tax,
                    discount:money(item.price * item.qty * (item.discount || 0) / 100)};
            }),
            summary:{total:sale.total,subtotal:sale.subtotal,tax:sale.taxAmount,
                discount:sale.discountTotal,roundOff:sale.roundOff},
            payments:payments,change:sale.change,isCredit:isCredit,
            outstanding:isCredit ? money(sale.total - payments.reduce(function (paid, payment) { return paid + Number(payment.amount); },0)) : 0,
            notes:'OFFLINE RECEIPT — PENDING SYNC. The official invoice number is assigned after synchronization.',
        };
        var html = window.PosReceiptLayout.render(receipt, sale.taxOn === 'Y') + '</body></html>';
        var frame = document.getElementById('pos-offline-frame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'pos-offline-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;left:-10000px;width:80mm';
            document.body.appendChild(frame);
        }
        var d = frame.contentDocument;
        d.open();
        d.write(html);
        d.close();
        frame.contentWindow.focus();
        frame.contentWindow.print();
    }
    function receiptDialog(sale) {
        var title = 'Sale saved on this device';
        var message = '₹' + f2(sale.total) + ' · ' + sale.paymentMethod + '\nReference: ' + sale.offlineId
            + '\nBill queued to sync.' + (sale.change ? ' Change given: ₹' + f2(sale.change) + '.' : '');
        var ov = modal(title, posReceiptPrintMarkup(title, message, true), 440);
        ov.querySelector('#oflPrintReceipt').onclick = function () {
            printReceipt(sale);
        };
    }
    function removeSynced(ids) {
        return ensureDb().then(function (d) {
            return new Promise(function (resolve, reject) {
                var t = d.transaction('queue', 'readwrite');
                ids.forEach(function (id) {
                    t.objectStore('queue').delete(id);
                });
                t.oncomplete = resolve;
                t.onerror = t.onabort = reject;
            });
        });
    }
    function hasQueuedSaleForDraft(sales, sourceId) {
        var sessionId = tCtx().sessionId;
        return sales.some(function (sale) {
            return (!sale.sessionId || sale.sessionId === sessionId) && sale.sourceTransactionId &&
                (!sourceId || sale.sourceTransactionId === sourceId);
        });
    }
    function canResumeOnline() {
        return !localClose && !disconnected() && localEditing && draft?.sessionId === tCtx().sessionId && leaseReady &&
            !syncing && !payPending && !pendingLocalEdits.length &&
            !document.querySelector('#posOfflineDialog,#posCustomerOverlay[data-offline]') &&
            typeof window._posResumeOnline === 'function' && typeof window._posReadRestoredCart === 'function';
    }
    function matchesOnlineDraft() {
        if (draft.restoreRequest) return false;
        if (!draft.sourceTransactionId) return !draft.items.length && !draft.customer;
        // An unchanged cached copy can safely give control back to its server draft.
        if (!snapshot || snapshot.transactionId !== draft.sourceTransactionId || draft.sessionId !== tCtx().sessionId) return false;
        var baseline = draft.onlineBaseline || draftContent(setDraftSource(newDraft()));
        return draftContent(draft) === baseline;
    }
    async function restoreDraft(bill) {
        if (!bill.restoreRequest) {
            var amounts = totals(bill), request = copy(bill);
            delete request.onlineBaseline;
            bill.restoreRequest = Object.assign(request, {version:2,offlineId:crypto.randomUUID(),userId:settings.userId,
                organizationPartyId:orgId,total:amounts.pay,taxAmount:amounts.tax,ts:new Date().toISOString()});
        }
        await saveDraft();
        var context = tCtx(), token = document.querySelector('[name=moquiSessionToken]');
        var response = await fetch('Terminal/restoreOfflineDraft', {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(15000),
            headers:{'Content-Type':'application/json'},body:JSON.stringify({terminalId:context.terminalId,sessionId:context.sessionId,
                moquiSessionToken:token && token.value,draft:bill.restoreRequest})});
        if (!response.ok) {
            if ([401,403].includes(response.status)) restoreError = 'Sign in again to confirm this saved cart.';
            var error = Error('Waiting for the server to confirm the saved cart.');
            error.posGateway = [502,503,504].includes(response.status);
            throw error;
        }
        var result = await response.json();
        if (result.rejected) {
            delete bill.restoreRequest;
            await saveDraft();
        }
        if (result.rejected || result.conflict) {
            restoreError = result.error;
            return null;
        }
        if (result.offlineId !== bill.restoreRequest.offlineId || !result.transactionId) return null;
        return window._posReadRestoredCart(result.transactionId, bill);
    }
    function resumeOnline() {
        if (restoringTask) return restoringTask;
        if (!canResumeOnline()) return Promise.resolve();
        restoringTask = getQueue().then(async function (sales) {
            if (!canResumeOnline()) return;
            var bill = draft, unchanged = matchesOnlineDraft(), source = bill.sourceTransactionId ? snapshot : null;
            if (hasQueuedSaleForDraft(sales, bill.sourceTransactionId) && (unchanged || bill.sourceTransactionId)) {
                restoreError = 'A saved payment needs review in Bill History before this cart can reconnect.';
                return;
            }
            if (!unchanged) {
                source = await restoreDraft(bill);
                if (!source || !source.success || disconnected() || draft !== bill) return;
                await stateWrite('snapshot:' + scope, source);
            }
            if (disconnected() || draft !== bill) return;
            await writeTail.catch(function () {});
            await stateWrite('draft:' + scope, null);
            if (disconnected()) {
                if (source?.transactionId) {
                    snapshot = source;
                    draft = setDraftSource(Object.assign(newDraft(), {mode:bill.mode,taxOn:bill.taxOn}));
                    draft.onlineBaseline = draftContent(draft);
                    window._posRememberRestoredSource?.(source.transactionId);
                    render();
                }
                await saveDraft();
                return;
            }
            localEditing = false;
            draft = null;
            restoreError = null;
            announceConnection();
            var restored = window._posResumeOnline(source, unchanged ? null : bill);
            cacheCatalog();
            return restored;
        }).catch(function (error) {
            return transportFailure(error);
        }).finally(function () {
            restoringTask = null;
            banner(active());
            announceConnection();
        });
        return restoringTask;
    }
    function sync() {
        if (localClose) return window.PosDeferredClose ? window.PosDeferredClose.flush() : Promise.resolve(0);
        if (syncTask) return syncTask;
        if (disconnected()) return Promise.resolve(0);
        syncing = true;
        syncTask = recoverLegacy()
            .then(getQueue)
            .then(function (q) {
                if (!q.length) return 0;
                var token = document.querySelector('[name=moquiSessionToken]');
                return fetch('Terminal/syncOfflineTransactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    signal: AbortSignal.timeout(20000),
                    body: JSON.stringify({
                        moquiSessionToken: token && token.value,
                        terminalId: tCtx().terminalId,
                        transactions: q.map(function (s) {
                            return JSON.stringify(s);
                        }),
                    }),
                })
                    .then(function (r) {
                        if (!r.ok) {
                            var error = Error('Sync failed');
                            error.posGateway = [502,503,504].includes(r.status);
                            throw error;
                        }
                        return r.json();
                    })
                    .then(function (d) {
                        var ack = Array.isArray(d.syncedIds)
                            ? d.syncedIds.filter(function (id) {
                                  return q.some(function (s) {
                                      return s.offlineId === id;
                                  });
                              })
                            : [];
                        return removeSynced(ack)
                            .then(function () {
                                return acknowledgeLegacy(ack, q);
                            })
                            .then(function () {
                                ack.forEach(function (id) { rejectedSales.delete(id); });
                                if (ack.length) window.dispatchEvent(new Event('posofflinesynced'));
                                (d.failures || []).forEach(function (failure) {
                                    var sale = q[failure.index];
                                    if (sale && failure.error) rejectedSales.set(sale.offlineId, failure.error);
                                });
                                return ack.length;
                            });
                    });
            })
            .then(function (count) {
                return getQueue().then(function (remaining) {
                    return syncHeldDrafts(remaining).then(function () { return count; });
                });
            })
            .catch(function (error) { return transportFailure(error).then(function () { return 0; }); })
            .finally(function () {
                syncing = false;
                syncTask = null;
                banner(active());
                cacheSummary();
                return resumeOnline().then(cacheHeldBills);
            });
        return syncTask;
    }
    var summaryRequest;
    function rememberSummary(summary) {
        if (summary && summary.success) return stateWrite('summary:' + tCtx().sessionId, copy(summary));
        return Promise.resolve();
    }
    function cacheSummary() {
        if (summaryRequest || disconnected() || localClose || !tCtx().sessionId) return summaryRequest || Promise.resolve();
        summaryRequest = fetch('Terminal/ajaxCart', {method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000),
            body:new URLSearchParams({action:'sessionSummary', sessionId:tCtx().sessionId,
                moquiSessionToken:(document.querySelector('[name=moquiSessionToken]') || {}).value || ''})})
            .then(function (response) { if (response.ok) return response.json(); })
            .then(rememberSummary).catch(function () {}).finally(function () { summaryRequest = null; });
        return summaryRequest;
    }
    async function closeSummary() {
        var summary = await stateRead('summary:' + tCtx().sessionId);
        var saved = !!summary;
        summary = Object.assign({billCount:0,totalSales:0,openingCash:0,cashReceived:0,changeGiven:0,movementNet:0,expectedCash:0,cardReceived:0,upiReceived:0}, summary);
        ['billCount','totalSales','openingCash','cashReceived','changeGiven','movementNet','expectedCash','cardReceived','upiReceived'].forEach(function (field) { summary[field] = Number(summary[field] || 0); });
        var known = new Set(summary.offlineIds || []);
        (await getQueue()).filter(function (sale) { return sale.sessionId === tCtx().sessionId && !known.has(sale.offlineId); }).forEach(function (sale) {
            summary.billCount++;
            summary.totalSales += Number(sale.total || 0);
            summary.changeGiven += Number(sale.change || 0);
            (sale.payments || []).forEach(function (payment) {
                var field = {Cash:'cashReceived',Card:'cardReceived',UPI:'upiReceived'}[payment.method];
                if (field) summary[field] += Number(payment.amount || 0);
            });
        });
        summary.expectedCash = Number(summary.openingCash) + Number(summary.cashReceived) - Number(summary.changeGiven) + Number(summary.movementNet);
        summary.warning = saved ? 'Offline estimate from the last saved session summary. Enter the actual cash in the drawer. Saved bills will sync automatically when connected.'
            : 'The online summary is unavailable. Enter the actual cash in the drawer. Saved bills will sync automatically when connected.';
        if ((draft && draft.items.length) || holds.length) summary.warning += ' Unpaid cart items and held bills in this session will be discarded.';
        return summary;
    }
    function showClosed(request) {
        if (!request || request.sessionId !== tCtx().sessionId) return;
        localClose = request;
        localEditing = false;
        draft = null; holds = []; cart = []; snapshot = null;
        banner(false);
        var dialog = document.getElementById('posSessionClosed');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'posSessionClosed';
            dialog.className = 'pos-close-overlay';
            dialog.setAttribute('role','dialog');
            dialog.setAttribute('aria-labelledby','pos-closed-title');
            dialog.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px;max-width:480px;color:#17213b">' +
                '<h2 id="pos-closed-title" style="margin:0 0 12px;font-size:24px">Session closed</h2>' +
                '<p class="pos-closed-status" role="status"></p><p>Closing cash: ₹' + f2(request.closingCash) + '</p>' +
                '<div style="display:flex;gap:12px;margin-top:20px"><button type="button" class="pos-closed-history" style="padding:10px 14px;border:1px solid #7c3aed;border-radius:8px;background:#fff;color:#6d28d9;font:inherit">Bill History</button>' +
                '<a href="/apps/zenith/pos/PosTerminals" style="padding:10px 14px;border-radius:8px;background:#7c3aed;color:white;text-decoration:none">Back to counters</a></div></div>';
            dialog.addEventListener('cancel', function (event) { event.preventDefault(); });
            dialog.querySelector('button').addEventListener('click', function () {
                if (window.posOpenHistory) window.posOpenHistory();
                var history = document.getElementById('pos-history-overlay');
                if (history) dialog.append(history);
            });
            (document.fullscreenElement || document.body).append(dialog);
            dialog.showModal();
        }
        dialog.querySelector('.pos-closed-status').textContent = request.syncedAt ? 'All saved bills and the session closure have synchronized.'
            : request.error ? 'Closed on this device. Saved bills are retained for automatic retry. You can check them in Bill History.'
            : 'Closed on this device. Saved bills will sync automatically when the connection returns.';
        Object.keys(request.failures || {}).forEach(function (id) { rejectedSales.set(id, request.failures[id]); });
    }
    async function deferClose(amount) {
        if (draft?.restoreRequest || payPending || (window._posCartWriteInFlight && window._posCartWriteInFlight())) throw Error('Wait for the current cart or payment to be confirmed, then close the session.');
        if (!window.PosDeferredClose) throw Error('Offline session closure is unavailable. Reload while connected before going offline.');
        await writeTail;
        var ctx = tCtx();
        var request = await window.PosDeferredClose.save({sessionId:ctx.sessionId, terminalId:ctx.terminalId, closingCash:amount});
        showClosed(request);
        window.PosDeferredClose.flush();
        return {success:true,deferred:true};
    }
    function clearDraft() {
        if (!begin()) return false;
        var sourceId = draft.sourceTransactionId, sourceRevision = draft.sourceRevision;
        draft = newDraft();
        // Clearing the local rows must also replace the unpaid source when the next sale syncs.
        if (sourceId) { draft.sourceTransactionId = sourceId; draft.sourceRevision = sourceRevision; }
        cart = draft.items;
        change();
        return true;
    }
    function sessionClosed() {
        if (!db || sessionHolds().length || (draft && draft.items.length)) return Promise.resolve();
        return getQueue().then(function (pending) {
            if (pending.some(function (sale) { return sale.sessionId === tCtx().sessionId; })) return;
            return Promise.all([stateWrite('draft:' + scope, null), stateWrite('snapshot:' + scope, null)]);
        });
    }
    async function needsDeferredClose() {
        if (disconnected()) return true;
        if (localEditing) await sync();
        if (draft?.restoreRequest) throw Error('Wait for the server to confirm the saved cart before closing the session.');
        var sessionId = tCtx().sessionId;
        return localEditing || sessionHolds().length > 0 || (await getQueue()).some(function (sale) {
            return sale.sessionId === sessionId;
        });
    }
    function boot() {
        if (booted || !orgId || location.pathname.indexOf('/pos/Terminal') < 0) return;
        booted = true;
        // A missing snapshot or another tab's lease must never leave the server-rendered cart editable.
        ['beforeinput', 'submit', 'change'].forEach(function (eventName) {
            document.addEventListener(eventName, function (event) {
                if ((serverDraftPaused || restoringTask || draft?.restoreRequest) && event.target.closest('.pos-cart,.pos-summary,#cartInlineAddForm')) {
                    event.preventDefault(); event.stopImmediatePropagation();
                }
            }, true);
        });
        openDB()
            .then(loadCatalog)
            .then(function () {
                return Promise.all([
                    readSessionDraft(),
                    stateRead('snapshot:' + scope),
                    stateRead('holds:' + scope),
                    window.PosDeferredClose ? window.PosDeferredClose.get(tCtx().sessionId) : Promise.resolve(null),
                ]);
            })
            .then(function (saved) {
                if (saved[3]) {
                    storageReady = true;
                    showClosed(saved[3]);
                    window.PosDeferredClose.flush();
                    return;
                }
                draft = saved[0] || null;
                holds = saved[2] || [];
                holds.forEach(function (bill) { bill.draftId = bill.draftId || crypto.randomUUID(); });
                if (!snapshot) snapshot = saved[1] || null;
                storageReady = true;
                if (draft || sessionHolds().some(function (bill) { return !bill.serverHeldId; }) || disconnected()) begin();
                connectionChanged();
            })
            .catch(function () {
                toast('Offline storage unavailable. Keep online checkout.', '#c62828');
            });
        window.addEventListener('offline', connectionChanged);
        window.addEventListener('possessionclosed', function (event) { showClosed(event.detail); });
        window.addEventListener('online', function () { checkConnection(true); });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) clearTimeout(connectionTimer);
            else checkConnection();
        });
        setInterval(function () {
            if (!disconnected()) sync();
        }, 30000);
        setInterval(function () { if (!active()) cacheCatalog(); }, 180000);
        document.addEventListener(
            'submit',
            function (e) {
                if (!active()) return;
                if (e.target.matches('.pos-header form[action*="toggleTax"]')) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (begin()) {
                        draft.taxOn = draft.taxOn === 'Y' ? 'N' : 'Y';
                        change();
                    }
                }
            },
            true,
        );
        document.addEventListener(
            'click',
            function (e) {
                var b = e.target.closest('button,a,summary');
                if (!b) return;
                var savedHold = b.matches('#pos-held-wrap [data-recall]');
                if (!active() && !savedHold) return;
                if (b.closest('#posSessionClosed,#pos-history-overlay,#posCloseSessionOverlay')) return;
                if (localClose) { e.preventDefault(); e.stopImmediatePropagation(); return; }
                if (b.closest('#posOfflineDialog,#posCustomerOverlay')) return;
                if (!disconnected() && b.matches('#pos-pay-cash,#pos-pay-card,#pos-credit,#pos-pay-upi,#pos-split,#pos-hold')) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    sync();
                    toast(restoreError || 'Wait for the saved cart to reconnect, then try again.', '#b45309');
                    return;
                }
                if (payPending) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                if (serverDraftPaused && !b.closest('.pos-header form[action*="closeSession"]')) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                var mode = b.matches('a[href*="changeSalesMode"]')
                    ? new URL(b.href).searchParams.get('salesModeId')
                    : null;
                if (mode) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (!begin()) return;
                    draft.mode = mode;
                    cart.forEach(function (i) {
                        var price = ((catalog[i.productId] || {}).prices || {})[mode];
                        if (price && !price.blocked) {
                            i.mode = mode;
                            i.price = Number(price.price);
                            i.discount = Number(price.disc || 0);
                        }
                    });
                    change();
                    if (window._gridSearch) window._gridSearch('');
                    return;
                }
                if (draft?.restoreRequest && b.closest('.pos-cart,.pos-summary,#cartInlineAddForm,.pos-left-panel')) {
                    e.preventDefault(); e.stopImmediatePropagation(); return;
                }
                if (savedHold) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    if (begin()) recallDraft(b.dataset.recall);
                    return;
                }
                if (b.closest('#pos-held-wrap') && canUseOnlineHeldPicker()) return;
                if (
                    b.matches(
                        '.pos-cart .aj-q,.pos-cart .aj-rm,#pos-held-wrap > button,#pos-held-wrap summary,#pos-pay-cash,#pos-pay-card,#pos-credit,#pos-pay-upi,#pos-split,#pos-discount,#pos-hold',
                    )
                ) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (!begin()) return;
                    if (b.id === 'pos-credit') tender('Credit');
                    else if (b.id === 'pos-split') tender('Split');
                    else if (b.id === 'pos-discount') discountDialog();
                    else if (b.id === 'pos-hold') holdDraft();
                    else if (b.closest('#pos-held-wrap')) heldDialog();
                    else if (b.id.indexOf('pos-pay-') === 0)
                        tender(
                            { cash: 'Cash', card: 'Card', upi: 'UPI', credit: 'Credit', split: 'Split' }[
                                b.id.slice(8)
                            ],
                        );
                    else {
                        var i = cart.findIndex(function (item) { return String(item.seq) === b.dataset.seq; });
                        if (i < 0) return;
                        if (b.matches('.aj-rm')) cart.splice(i, 1);
                        else cart[i].qty = Math.max(1, Number(b.dataset.q));
                        change();
                    }
                }
            },
            true,
        );
        document.addEventListener(
            'input',
            function (e) {
                if (!active() || !e.target.matches('.pos-cart .aj-p,.pos-cart .aj-qi')) return;
                e.stopImmediatePropagation();
                if (payPending || restoringTask || draft?.restoreRequest) {
                    e.preventDefault();
                    return;
                }
                var el = e.target,
                    i = cart.find(function (item) { return String(item.seq) === el.dataset.seq; }),
                    n = Number(el.value);
                if (i && el.value.trim() !== '' && Number.isFinite(n) && n > 0) {
                    if (el.matches('.aj-p') && !settings.canOverride) return;
                    i[el.matches('.aj-p') ? 'price' : 'qty'] = n;
                    change();
                }
            },
            true,
        );
        document.addEventListener(
            'change',
            function (e) {
                if (!active() || !e.target.matches('.pos-cart .aj-mode,.pos-cart .aj-p,.pos-cart .aj-qi')) return;
                e.stopImmediatePropagation();
                if (e.target.matches('.aj-mode')) edit({action:'setItemMode',seq:e.target.dataset.seq,mode:e.target.value});
                else render();
            },
            true,
        );
        document.addEventListener(
            'keydown',
            function (e) {
                if (e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
                var input = e.target,
                    search = input.id === 'cartInlineSearch';
                if (
                    e.code === 'Space' &&
                    search &&
                    !input.value.trim() &&
                    !document.getElementById('posOfflineDialog')
                ) {
                    var cash = document.getElementById('pos-pay-cash');
                    if (cash && !cash.disabled) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        cash.focus();
                    }
                    return;
                }
                if (!active()) return;
                if (e.key === 'F9' && !canUseOnlineHeldPicker() && !document.querySelector('#posOfflineDialog,#posCustomerOverlay')) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (begin()) heldDialog();
                    return;
                }
                if (input.matches('.pos-cart .aj-p,.pos-cart .aj-qi') && e.key === 'Enter') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    var next = input.matches('.aj-p')
                        ? input.closest('tr').querySelector('.aj-qi')
                        : document.getElementById('cartInlineSearch');
                    if (next) {
                        next.focus();
                        if (next.select) next.select();
                    }
                }
            },
            true,
        );
    }
    setTimeout(boot, 1500);
    return {
        boot: boot,
        active: active,
        disconnected: disconnected,
        connectionState: connectionState,
        transportFailure: transportFailure,
        handoff: handoff,
        edit: edit,
        paused: paused,
        add: add,
        scan: scan,
        sync: sync,
        canUseOnlineHeldPicker: canUseOnlineHeldPicker,
        cacheHeldBills: cacheHeldBills,
        async prepareOnlineRecall() {
            if (!canUseOnlineHeldPicker()) return false;
            await resumeOnline();
            return !active();
        },
        hold: function () {
            if (!disconnected()) { sync(); return; }
            if (begin()) holdDraft();
        },
        clearDraft: clearDraft,
        needsDeferredClose: needsDeferredClose,
        render: render,
        customerPicker: customerPicker,
        discount: function () { if (begin()) discountDialog(); },
        printReceipt: printReceipt,
        remember: remember,
        cacheCatalog: cacheCatalog,
        searchSuggestions: function (term, mode) {
            var onlinePreview = !!mode;
            mode = mode || (draft && draft.mode);
            return search(term, onlinePreview).map(function (product) {
                var rate = (product.prices || {})[mode];
                var price = rate ? rate.price : product.price;
                return { productId: product.productId, productName: product.name, mrpAmount: price || 0,
                    pricePending: price == null, pseudoId: product.barcode };
            });
        },
        lookup: lookup,
        catalogSize: catalogSize,
        gridPage: gridPage,
        getQueue: getQueue,
        reviewReason: function (id) { return rejectedSales.get(id); },
        recoverLegacy: recoverLegacy,
        sessionClosed: sessionClosed,
        closeSummary: closeSummary,
        rememberSummary: rememberSummary,
        deferClose: deferClose,
        acknowledgeLegacy: acknowledgeLegacy,
    };
})();

/* === Bill History (works with or without an open session) === */
(function() {
    var CTX = { sessionId: '', terminalId: '' };
    function histToken() {
        var af = document.getElementById('cartInlineAddForm');
        if (af) { var t = af.querySelector('[name=moquiSessionToken]'); if (t && t.value) return t.value; }
        try { if (window.moqui && window.moqui.webrootVue && window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; } catch(e){}
        // Start-session screen: no cart form and window.moqui.webrootVue may not be initialised yet,
        // so the token came back EMPTY and the history POST was rejected (non-JSON -> "Couldn't load").
        // Any server-rendered token on the page (e.g. the OpenSessionForm) is valid for this session.
        var any = document.querySelector('[name=moquiSessionToken]');
        if (any && any.value) return any.value;
        return '';
    }
    var historyToast;
    function histToast(msg, bg) {
        if (historyToast) historyToast.remove();
        var t = historyToast = document.createElement('div');
        t.setAttribute('role', 'status');
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:999999;max-width:calc(100% - 24px);box-sizing:border-box;padding:18px 36px;border-radius:12px;font-size:20px;font-weight:700;color:#fff;background:'+(bg||'#2e7d32')+';box-shadow:0 6px 32px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;text-align:center;overflow-wrap:anywhere;letter-spacing:0.5px';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '1'; }, 30);
        setTimeout(function() {
            t.style.opacity = '0';
            setTimeout(function() {
                t.remove();
                if (historyToast === t) historyToast = null;
            }, 400);
        }, 3500);
    }
        /* === Bill History Panel === */
        var historyOverlay = null, historyCriteria = {}, historyRequest, historyVersion = 0;
        var historyReconnect, historySynced, historyFailed = false;
        function openBillHistory(search) {
            closeHistory(); historyCriteria = {};
            var ov = document.createElement('div');
            ov.id = 'pos-history-overlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Bill history');
            historyOverlay = ov;
            ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
            var panel = document.createElement('div');
            panel.style.cssText = 'background:#fff;border-radius:16px;width:90vw;max-width:800px;max-height:85vh;max-height:85dvh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden';
            panel.innerHTML = '<div style="flex:none;padding:16px 20px;background:#7C3AED;color:#fff;display:flex;justify-content:space-between;align-items:center">'
                + '<span style="font-size:18px;font-weight:700">&#128196; Bill History</span>'
                + '<button id="hist-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0 4px">&times;</button></div>'
                + '<div style="flex:none;display:flex;gap:8px;padding:12px 20px;border-bottom:1px solid #e0e0e0">'
                + '<input id="hist-search" type="search" aria-label="Search bills" placeholder="Search by bill number, amount, or customer..." style="flex:1;min-width:0;padding:10px 14px;border:1px solid #ccc;border-radius:8px;font-size:14px"/>'
                + '<button id="hist-filter" type="button" aria-expanded="false" aria-controls="hist-filter-form" style="border:1px solid #7C3AED;border-radius:8px;background:white;color:#6D28D9;padding:0 12px">Filter</button></div>'
                + '<div id="hist-scroll" style="min-height:0;overflow:auto">'
                + '<form id="hist-filter-form" hidden novalidate style="padding:12px 20px;border-bottom:1px solid #e0e0e0"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:8px">'
                + '<label style="min-width:0;font-weight:600">From Date<input type="date" name="historyFromDate" required style="display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:4px;padding:8px;border:1px solid #d7d1e6;border-radius:7px;background:white;color:#202036"/></label>'
                + '<label style="min-width:0;font-weight:600">To Date<input type="date" name="historyToDate" required style="display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:4px;padding:8px;border:1px solid #d7d1e6;border-radius:7px;background:white;color:#202036"/></label>'
                + '<label style="min-width:0;font-weight:600">From Time<input type="time" name="historyFromTime" style="display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:4px;padding:8px;border:1px solid #d7d1e6;border-radius:7px;background:white;color:#202036"/></label>'
                + '<label style="min-width:0;font-weight:600">To Time<input type="time" name="historyToTime" style="display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:4px;padding:8px;border:1px solid #d7d1e6;border-radius:7px;background:white;color:#202036"/></label></div>'
                + '<p id="hist-filter-error" role="alert" style="margin:6px 0;color:#b91c1c" hidden></p>'
                + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px"><button id="hist-filter-reset" type="button">Reset</button><button type="submit">Apply Filter</button></div></form>'
                + '<div id="hist-list" style="padding:8px 12px"><div style="text-align:center;padding:40px;color:#999">Loading...</div></div></div>';
            ov.appendChild(panel);
            document.body.appendChild(ov);
            ov.addEventListener('click', function(ev) { if (ev.target === ov) closeHistory(); });
            panel.querySelector('#hist-close').addEventListener('click', closeHistory);
            var searchInput = panel.querySelector('#hist-search');
            searchInput.value = search || '';
            var filter = panel.querySelector('#hist-filter');
            var form = panel.querySelector('#hist-filter-form');
            var error = panel.querySelector('#hist-filter-error');
            var fromDate = form.elements.historyFromDate, toDate = form.elements.historyToDate;
            var earliest = '0001-01-01';
            var clock = document.getElementById('nb-clock');
            var parts = new Intl.DateTimeFormat('en-CA', {timeZone: clock ? clock.dataset.timeZone : undefined,
                year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
            function part(type) { return parts.find(function(p) { return p.type === type; }).value; }
            var today = part('year') + '-' + part('month') + '-' + part('day');
            function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= earliest && value <= today; }
            function syncDateBounds() {
                fromDate.min = earliest;
                fromDate.max = validDate(toDate.value) ? toDate.value : today;
                toDate.min = validDate(fromDate.value) ? fromDate.value : earliest;
                toDate.max = today;
            }
            syncDateBounds();
            form.addEventListener('input', syncDateBounds);
            var searchTimer;
            function reload() { clearTimeout(searchTimer); loadHistoryList(searchInput.value); }
            historyReconnect = function() { if (historyFailed) reload(); };
            window.addEventListener('online', historyReconnect);
            historySynced = reload;
            window.addEventListener('posofflinesynced', historySynced);
            filter.addEventListener('click', function () {
                form.hidden = !form.hidden;
                filter.setAttribute('aria-expanded', String(!form.hidden));
                if (!form.hidden) panel.querySelector('#hist-scroll').scrollTop = 0;
            });
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var values = Object.fromEntries(new FormData(form));
                if (!validDate(values.historyFromDate) || !validDate(values.historyToDate)) {
                    error.textContent = 'Choose both dates, up to today, using a four-digit year.';
                    error.hidden = false;
                    return;
                }
                var from = values.historyFromDate + 'T' + (values.historyFromTime || '00:00');
                var to = values.historyToDate + 'T' + (values.historyToTime || '23:59');
                error.hidden = from <= to;
                if (!error.hidden) { error.textContent = 'The end must be on or after the start.'; return; }
                historyCriteria = values; filter.textContent = 'Filter •'; reload();
            });
            panel.querySelector('#hist-filter-reset').addEventListener('click', function () {
                form.reset(); syncDateBounds(); error.hidden = true; historyCriteria = {}; filter.textContent = 'Filter'; reload();
            });
            searchInput.addEventListener('input', function() {
                clearTimeout(searchTimer);
                if (historyRequest) historyRequest.abort();
                ++historyVersion;
                searchTimer = setTimeout(function() { if (searchInput.isConnected) reload(); }, 200);
            });
            searchInput.focus();
            loadHistoryList(search || '');
        }
        function closeHistory() {
            ++historyVersion;
            window.removeEventListener('online', historyReconnect);
            window.removeEventListener('posofflinesynced', historySynced);
            historySynced = null;
            historyReconnect = null; historyFailed = false;
            if (historyRequest) historyRequest.abort();
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
        function historyPost(params, signal, renewed) {
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
            var url = ajaxCartUrl();
            if ((params.action === 'creditBills' || params.action === 'settleCredit') && creditModulePath() === '/apps/zenith/kot') {
                var transition = params.action === 'creditBills' ? 'listCreditBills' : 'settleCredit';
                url = '/apps/zenith/kot/CreditBills/' + transition;
            }
            return send(url, {   // ZE-POS-0211: absolute (was relative 'Terminal/ajaxCart' -> broke on a trailing-slash page URL)
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams(params), credentials: 'same-origin', signal: signal
            }).then(function(r) {
                var loginRedirect = r.redirected && /\/Login(?:[/?#]|$)/i.test(r.url);
                if (params.action === 'billHistory' && r.status === 401 && !r.redirected && !renewed &&
                    typeof window._posRefreshBrowserToken === 'function') {
                    return window._posRefreshBrowserToken().then(function() { return historyPost(params, signal, true); }, function() {
                        var authError = new Error('Sign in again to load bill history.');
                        authError.historyAuth = true;
                        throw authError;
                    });
                }
                if (params.action === 'billHistory' && (!r.ok || loginRedirect)) {
                    var error = new Error('Bill history request failed (HTTP ' + r.status + ').');
                    error.status = r.status;
                    error.historyAuth = r.status === 401 || r.status === 403 || loginRedirect;
                    throw error;
                }
                return r.json();
            });
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
        function reprintSavedBill(bill, button) {
            if (button.disabled) return;
            button.disabled = true;
            historyPost({action:'receiptData', transactionId:bill.txId}).then(function(data) {
                if (!data || !data.success) throw new Error('The saved receipt could not be loaded.');
                var taxOn = Number(data.summary && data.summary.tax || 0) > 0 ? 'Y' : 'N';
                if (typeof window._posPrintReceipt === 'function') return window._posPrintReceipt(bill.txId, bill.billNo, taxOn, bill.amendCount > 0, data);
                else histIframePrint(buildHistReceipt(data, taxOn === 'Y', bill.amendCount > 0));
            }).catch(function() { histToast('The saved bill could not be printed. Try again.', '#c62828'); })
                .finally(function() { button.disabled = false; });
        }
        function buildHistReceipt(d, isTax, edited) {
            return window.PosReceiptLayout.render(d, isTax, edited);
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
        function histEsc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
        function deviceSaleRows(sales, search) {
            var term = (search || '').toLowerCase();
            return sales.filter(function (sale) {
                return !term || [sale.offlineId, sale.total, sale.paymentMethod].concat((sale.items || []).map(function (item) { return item.name; }))
                    .some(function (value) { return String(value || '').toLowerCase().includes(term); });
            }).map(function (sale) {
                var reason = window._posOffline.reviewReason?.(sale.offlineId);
                return '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px dashed #b45309;border-radius:10px;margin-bottom:8px;background:#fffbeb">' +
                    '<div><strong>' + (reason ? 'Offline sale needs review' : 'OFFLINE — PENDING SYNC') + '</strong> · ' + histEsc(sale.offlineId) +
                    '<div>₹' + Number(sale.total || 0).toFixed(2) + ' · ' + histEsc(sale.paymentMethod) + ' · ' +
                    histEsc(new Date(sale.ts).toLocaleString()) + '</div>' + (reason ? '<div>' + histEsc(reason) + '</div>' : '') + '</div>' +
                    (sale.offlineId ? '<button type="button" class="hist-reprint" data-device-reprint="' + histEsc(sale.offlineId) +
                        '" style="padding:9px 14px;border:1px solid #7C3AED;border-radius:8px;color:#7C3AED;background:#fff;font-weight:700">&#128424; Reprint</button>' : '') + '</div>';
            }).join('');
        }
        function loadHistoryList(search, offset, retried) {
            var listEl = document.getElementById('hist-list');
            if (!listEl) return;
            offset = offset || 0;
            if (historyRequest) historyRequest.abort();
            historyRequest = new AbortController();
            var version = ++historyVersion;
            var filtered = !!historyCriteria.historyFromDate;
            function current() { return version === historyVersion && listEl.isConnected; }
            function showDeviceSales(replace) {
                if (filtered || offset || !window._posOffline) return Promise.resolve(false);
                return window._posOffline.getQueue().then(function (sales) {
                    if (!current() || !sales.length) return false;
                    var rows = deviceSaleRows(sales, search);
                    if (replace) listEl.innerHTML = rows || '<p>No offline bills match this search.</p>';
                    else if (rows) listEl.insertAdjacentHTML('afterbegin', rows);
                    listEl.querySelectorAll('[data-device-reprint]').forEach(function (button) {
                        button.addEventListener('click', function () {
                            var sale = sales.find(function (row) { return row.offlineId === button.dataset.deviceReprint; });
                            if (sale) window._posOffline.printReceipt?.(sale);
                        });
                    });
                    return true;
                }).catch(function () { return false; });
            }
            historyFailed = false;
            listEl.innerHTML = '<div role="status" style="text-align:center;padding:40px;color:#999">Loading...</div>';
            listEl.parentElement.scrollTop = 0;
            historyPost(Object.assign({action:'billHistory', search:search||'', offset:offset}, historyCriteria), historyRequest.signal).then(function(d) {
                if (!current()) return;
                if (!d || !d.success) {
                    if (!d || !d.error) throw new Error('History unavailable');
                    listEl.textContent = d.error; return;
                }
                if (!d.bills || d.bills.length === 0) {
                    listEl.textContent = filtered ? 'No bills found for the selected date and time.' : (search ? 'No bills match your search.' : 'No completed bills found.');
                    showDeviceSales(true);
                    return;
                }
                var h = '<div role="status" style="font-size:12px;color:#666;padding:4px 8px;margin-bottom:4px">'+d.total+' bill'+(d.total>1?'s':'')+' found</div>';
                d.bills.forEach(function(bill) {
                    var payStr = (bill.payments||[]).map(function(p) { return p.method; }).join(', ');
                    var edited = bill.amendCount > 0 ? '<span style="background:#ff9800;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:6px">EDITED ('+bill.amendCount+')</span>' : '';
                    h += '<div class="hist-bill-row" data-tx-id="'+histEsc(bill.txId)+'" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:12px 14px;border:1px solid #e8e8e8;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:all 0.15s;background:#fafafa" onmouseover="this.style.background=\'#ECE8FB\';this.style.borderColor=\'#CBB8F0\'" onmouseout="this.style.background=\'#fafafa\';this.style.borderColor=\'#e8e8e8\'">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center">'
                        + '<div><span style="font-weight:700;font-size:15px;color:#7C3AED">#'+histEsc(bill.billNo)+'</span>'+edited+'</div>'
                        + '<span style="font-weight:800;font-size:16px;color:#2e7d32">₹'+Number(bill.grand||0).toFixed(2)+'</span></div>'
                        + '<div style="grid-column:1;display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:space-between;font-size:12px;color:#777">'
                        + '<span>'+histEsc(bill.date)+'</span>'
                        + '<span>'+histEsc(bill.customer)+' &middot; '+bill.itemCount+' item'+(bill.itemCount>1?'s':'')+' &middot; '+histEsc(payStr)+'</span>'
                        + '</div><button type="button" class="hist-reprint" style="grid-column:2;grid-row:1 / span 2;align-self:center;padding:9px 14px;border:1px solid #7C3AED;border-radius:8px;color:#7C3AED;background:#fff;font-weight:700;cursor:pointer">&#128424; Reprint</button></div>';
                });
                if (offset || offset + d.bills.length < d.total) {
                    h += '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0">'
                        + (offset ? '<button type="button" id="hist-prev">Previous</button>' : '<span></span>')
                        + (offset + d.bills.length < d.total ? '<button type="button" id="hist-next">Next</button>' : '') + '</div>';
                }
                listEl.innerHTML = h;
                showDeviceSales(false);
                var prev = listEl.querySelector('#hist-prev'), next = listEl.querySelector('#hist-next');
                if (prev) prev.onclick = function() { loadHistoryList(search, Math.max(0, offset - 20)); };
                if (next) next.onclick = function() { loadHistoryList(search, offset + d.bills.length); };
                listEl.querySelectorAll('.hist-bill-row').forEach(function(row) {
                    row.querySelector('.hist-reprint').addEventListener('click', function(event) {
                        event.stopPropagation();
                        var bill = d.bills.find(function(item) { return item.txId === row.dataset.txId; });
                        if (bill) reprintSavedBill(bill, event.currentTarget);
                    });
                    row.addEventListener('click', function() {
                        var txId = row.dataset.txId;
                        var bill = d.bills.find(function(b) { return b.txId === txId; });
                        if (bill) openCartEditor(bill);
                    });
                });
            }).catch(function(failure) {
                if (!current() || failure.name === 'AbortError') return;
                // Only replay this read, never payments, amendments or receipt printing.
                var temporary = failure.status >= 500 || failure.status === 408 || failure.status === 429 || failure.name === 'TypeError' || failure.name === 'SyntaxError';
                if (!retried && temporary && !failure.historyAuth && navigator.onLine !== false && !window._posOffline?.disconnected?.()) {
                    setTimeout(function() { if (current()) loadHistoryList(search, offset, true); }, 300);
                    return;
                }
                historyFailed = !failure.historyAuth;
                // ZE-POS-017: while offline, show the bills saved on THIS device (pending sync) instead of
                // a bare connection error. Falls back to the error only when there is nothing queued.
                function addRetry() {
                    var retry = document.createElement('button');
                    retry.type = 'button'; retry.textContent = 'Retry';
                    retry.style.cssText = 'display:block;margin:12px auto;padding:10px 24px;border:1px solid #7C3AED;border-radius:8px;background:white;color:#6D28D9;cursor:pointer';
                    retry.onclick = function() { if (current()) loadHistoryList(search, offset); };
                    listEl.appendChild(retry);
                }
                var showErr = function() {
                    if (!current()) return;
                    listEl.innerHTML = '<div role="alert" style="text-align:center;padding:24px;color:#c62828"></div>';
                    var message = listEl.firstElementChild;
                    message.textContent = failure.historyAuth
                        ? 'History access was refused. Sign in again if your session expired, or check your access with an administrator.'
                        : 'Bill history is temporarily unavailable. Retry here without leaving billing.';
                    addRetry();
                };
                if (failure.historyAuth || filtered) { showErr(); return; }
                showDeviceSales(true).then(function (shown) {
                    if (!current()) return;
                    if (shown) addRetry(); else showErr();
                });
            });
        }
        function openBillDetail(bill) {
            var listEl = document.getElementById('hist-list');
            if (!listEl) return;
            var h = '<div style="padding:8px">';
            h += '<button id="hist-back" style="background:none;border:none;color:#7C3AED;font-size:14px;cursor:pointer;padding:4px 0;font-weight:600">&larr; Back to list</button>';
            h += '<div style="background:#f5f5f5;border-radius:10px;padding:14px;margin-top:8px">';
            h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
                + '<span style="font-size:18px;font-weight:700;color:#7C3AED">Bill #'+histEsc(bill.billNo)+'</span>'
                + '<span style="font-size:11px;color:#999">'+histEsc(bill.date)+'</span></div>';
            h += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
            h += '<thead><tr style="border-bottom:2px solid #ddd"><th style="text-align:left;padding:6px 4px">#</th><th style="text-align:left;padding:6px 4px">Item</th><th style="text-align:right;padding:6px 4px">Rate</th><th style="text-align:center;padding:6px 4px">Qty</th><th style="text-align:right;padding:6px 4px">Total</th><th style="padding:6px 4px"></th></tr></thead><tbody>';
            (bill.items||[]).forEach(function(it, idx) {
                h += '<tr style="border-bottom:1px solid #eee" data-seq="'+it.seq+'" data-tx="'+histEsc(bill.txId)+'">'
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
            var addTimer = null, addVersion = 0;
            if (addSearch) addSearch.addEventListener('input', function() {
                clearTimeout(addTimer);
                var q = addSearch.value, version = ++addVersion;
                addResults.replaceChildren(); addResults.style.display = 'none';
                if (!q.trim()) { addResults.style.display = 'none'; return; }
                addTimer = setTimeout(function() {
                    historyPost({action:'searchProductsJson', q:q}).then(function(d) {
                        if (version !== addVersion || addSearch.value !== q || !addSearch.isConnected) return;
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
              + '<div><span style="font-size:16px;font-weight:800">&#9998; Editing Bill #'+histEsc(bill.billNo)+'</span>'
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
              +     '<button id="ced-print" type="button" style="flex:1;padding:13px;border:1px solid #bbb;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;color:#222">&#128424; Print bill</button>'
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
            var addInp = ed.querySelector('#ced-add'), addRes = ed.querySelector('#ced-add-res'), addTimer=null, addVersion=0;
            addInp.addEventListener('input', function(){
                clearTimeout(addTimer);
                var q = addInp.value, version = ++addVersion;
                addRes.replaceChildren(); addRes.style.display='none';
                if (!q.trim()) { addRes.style.display='none'; return; }
                addTimer = setTimeout(function(){
                    historyPost({action:'searchProductsJson', q:q}).then(function(d){
                        if (version !== addVersion || addInp.value !== q || !addInp.isConnected) return;
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

            function doCancel() { if (dirty() && !window.confirm('Discard your unsaved changes to Bill #'+histEsc(bill.billNo)+'?')) return; closeCartEditor(); }
            ed.querySelector('#ced-cancel').addEventListener('click', doCancel);
            ed.querySelector('#ced-print').addEventListener('click', function(event) { reprintSavedBill(bill, event.currentTarget); });
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
            var firstRate = ed.querySelector('.ced-price');
            if (firstRate) firstRate.focus();
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
    function openCustomerPicker(local) {
        var af = document.getElementById('cartInlineAddForm');
        CTX.sessionId = af ? ((af.querySelector('[name=sessionId]') || {}).value || '') : CTX.sessionId;
        if (customerOverlay) return;
        var ov = document.createElement('div'); customerOverlay = ov; ov.id='posCustomerOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Choose customer');
        if (local) ov.dataset.offline = '';
        function closeCustomer() {
            if (customerOverlay !== ov) return;
            ov.remove();
            customerOverlay = null;
            window.removeEventListener('posconnectionchange', connectionChanged);
            clearTimeout(t);
            if (local) local.close();
        }
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:6vh';
        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:16px;width:90vw;max-width:560px;max-height:84vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden';
        panel.innerHTML =
            '<div style="padding:14px 18px;background:#7C3AED;color:#fff;display:flex;justify-content:space-between;align-items:center">'
          + '<span style="font-size:17px;font-weight:700">&#128100; Customer for this bill</span>'
          + '<button id="cust-close" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0 4px">&times;</button></div>'
          + '<div style="padding:12px 18px;border-bottom:1px solid #e0e0e0;display:flex;gap:8px;align-items:center">'
          + '<input id="cust-search" type="text" placeholder="Search name or phone…" autocomplete="off" style="flex:1;padding:11px 14px;border:1px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
          + '<a id="cust-new" href="/apps/zenith/Contacts/Customers" target="_blank" rel="noopener" style="white-space:nowrap;padding:11px 14px;border-radius:8px;background:#ECE8FB;color:#7C3AED;border:1px solid #DCD3F2;font-weight:700;font-size:13px;text-decoration:none" title="Add a new customer in Contacts (opens a new tab)">&#43; New</a></div>'
          + '<div style="padding:8px 18px 0"><button id="cust-walkin" type="button" style="width:100%;padding:11px;border:1px dashed #bbb;background:#fafafa;border-radius:8px;font-size:14px;font-weight:700;color:#555;cursor:pointer">&#128694; Walk-In (no customer)</button></div>'
          + '<label style="display:flex;align-items:center;gap:9px;padding:10px 18px;color:#374151;font-size:13px"><input id="cust-tax-bill" type="checkbox" style="width:17px;height:17px;accent-color:#7C3AED"/> Tax bill for selected customer (3-inch receipt)</label>'
          + '<div id="cust-list" style="flex:1;overflow-y:auto;padding:10px 14px 16px"><div style="text-align:center;padding:30px;color:#999">Type a name or phone number to search your customers…</div></div>';
        ov.appendChild(panel); document.body.appendChild(ov);
        ov.addEventListener('click', function(ev) { if (ev.target === ov) closeCustomer(); });
        ov.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closeCustomer(); } });
        panel.querySelector('#cust-close').addEventListener('click', closeCustomer);
        var taxBill = panel.querySelector('#cust-tax-bill');
        taxBill.checked = local ? local.taxOn : window._posCurrentTax?.() === 'Y';
        function selectLocal(customer) {
            if (!local.select(customer, taxBill.checked)) return;
            histToast(customer ? 'Customer: ' + customer.name : 'Customer cleared — Walk-In', customer ? '#7C3AED' : '#607d8b');
            closeCustomer();
        }
        panel.querySelector('#cust-walkin').addEventListener('click', function() {
            if (local) { selectLocal(null); return; }
            var tx = getOpenTxId();
            if (!tx) { window._posSetCustomerChip(); closeCustomer(); return; }
            custPost('clearCustomer', {transactionId: tx}).then(function(d) {
                if (!d || !d.success) { histToast((d && d.error) || 'Could not clear customer', '#c62828'); return; }
                if (getOpenTxId() !== tx) return;
                if (window._posRefreshCart) window._posRefreshCart();
                window._posSetCustomerChip(); histToast('Customer cleared — Walk-In', '#607d8b'); closeCustomer();
            });
        });
        var si = panel.querySelector('#cust-search'), listEl = panel.querySelector('#cust-list'), t = null, requestId = 0;
        var newCustomer = panel.querySelector('#cust-new');
        if (local) newCustomer.title = 'Enter a customer for this bill';
        newCustomer.addEventListener('click', function(event) {
            if (!local) return;
            event.preventDefault();
            clearTimeout(t);
            listEl.innerHTML = '<form style="display:grid;gap:10px;padding:4px;color:#374151">'
                + '<p style="margin:0">Use a name and phone for this bill. To create a contact, open Contacts when online.</p>'
                + '<label>Name<input name="name" required maxlength="80" style="display:block;width:100%;padding:10px;border:1px solid #ccc;border-radius:8px"/></label>'
                + '<label>Phone<input name="phone" type="tel" maxlength="20" style="display:block;width:100%;padding:10px;border:1px solid #ccc;border-radius:8px"/></label>'
                + '<button type="submit" style="padding:10px;background:#7C3AED;color:#fff;border:0;border-radius:8px;font-weight:700">Use customer</button></form>';
            var form = listEl.querySelector('form');
            form.elements.name.focus();
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                var name = form.elements.name.value.trim();
                if (name) selectLocal({name:name, phone:form.elements.phone.value.trim()});
            });
        });
        function connectionChanged() {
            // Wait for POS to enter the local workspace before switching the open picker.
            queueMicrotask(function() {
                if (customerOverlay !== ov || local || !window._posOffline?.disconnected()) return;
                local = window._posOffline.customerPicker();
                if (!local) return;
                ov.dataset.offline = '';
                newCustomer.title = 'Enter a customer for this bill';
                clearTimeout(t);
                loadCustList(si.value);
            });
        }
        window.addEventListener('posconnectionchange', connectionChanged);
        si.addEventListener('input', function() { clearTimeout(t); t = setTimeout(function() { loadCustList(si.value); }, 350); });
        si.focus();
        loadCustList('');
        function loadCustList(term) {
            var request = ++requestId;
            if (local) { renderCustList(local.search(term)); return; }
            listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#999">Searching…</div>';
            custPost('searchCustomers', {term:term}).then(function(data) {
                if (customerOverlay !== ov || request !== requestId) return;
                if (!data || !data.success) { listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#c62828">Error loading customers</div>'; return; }
                renderCustList(data.customers || []);
            });
        }
        function renderCustList(customers) {
            if (!customers.length) {
                listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#999">' + (local
                    ? 'No saved customers found. Reconnect to refresh the customer list.'
                    : 'No customers found. Use “+ New” to add one in Contacts.') + '</div>';
                return;
            }
            var h = '';
            customers.forEach(function(c) {
                h += '<div class="cust-row" data-pid="' + custEscape(c.partyId) + '" data-name="' + custEscape(c.name || '') + '" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border:1px solid #e8e8e8;border-radius:10px;margin-bottom:8px;cursor:pointer" onmouseover="this.style.background=\'#e8eaf6\'" onmouseout="this.style.background=\'#fff\'">'
                  + '<span style="font-weight:700;color:#7C3AED">' + custEscape(c.name || c.partyId) + '</span>'
                  + (c.phone ? '<span style="font-size:13px;color:#777;white-space:nowrap">' + custEscape(c.phone) + '</span>' : '')
                  + '</div>';
            });
            listEl.innerHTML = h;
            listEl.querySelectorAll('.cust-row').forEach(function(row, index) {
                row.addEventListener('click', function() {
                    if (local) { selectLocal(customers[index]); return; }
                    var tx = getOpenTxId();
                    var pid = row.dataset.pid, nm = row.dataset.name;
                    var wantsTaxBill = taxBill.checked;
                    if (!tx && !CTX.sessionId) { histToast('Open a session before selecting a customer', '#e65100'); return; }
                    custPost('setCustomer', {transactionId: tx, customerPartyId: pid}).then(function(d) {
                        if (d && d.success) {
                            if (getOpenTxId() !== tx) return;
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
                            window._posSetCustomerChip(d.customer || nm, d.customerPhone); histToast('Customer: ' + (d.customer || nm), '#7C3AED'); closeCustomer();
                        }
                        else { histToast((d && d.error) || 'Could not set customer', '#c62828'); }
                    });
                });
            });
        }
    }
    window.posOpenCustomer = function() {
        var offline = window._posOffline;
        if (!offline?.active()) { openCustomerPicker(); return; }
        var local = offline.customerPicker();
        if (local) openCustomerPicker(local);
    };
    if (!window.__posCustDelegated) {
        window.__posCustDelegated = true;
        document.addEventListener('click', function(e) {
            var b = (e.target && e.target.closest) ? e.target.closest('#pos-customer-btn') : null;
            if (b) { e.preventDefault(); if (typeof window.posOpenCustomer === 'function') window.posOpenCustomer(); }
        });
    }

    /* === Credit Bills screen: list outstanding credit bills + settle (partial allowed) === */
    function creditModulePath() {
        var root = document.getElementById('credit-bills-root');
        return root && root.dataset.creditModule === 'kot' ? '/apps/zenith/kot' : '/apps/zenith/pos';
    }
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
        var root = document.getElementById('credit-bills-root');
        var canUseTransactions = root.dataset.creditTransactions !== 'false';
        return '<div style="position:relative;flex:0 0 auto">'
            + '<button class="cb-kebab" data-i="'+i+'" style="width:32px;height:32px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#9CA3AF;font-size:18px;line-height:1">&#8942;</button>'
            + '<div class="cb-menu" style="display:none;position:absolute;right:0;top:36px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 6px 20px rgba(17,24,39,.12);z-index:50;overflow:hidden;min-width:160px">'
            +   (canUseTransactions ? '<div class="cb-item" data-i="'+i+'" data-act="view" style="'+CBI+'">View / Edit Bill</div>'
                + '<div class="cb-item" data-i="'+i+'" data-act="print" style="'+CBI+'">Print Receipt</div>' : '')
            +   '<div class="cb-item" data-i="'+i+'" data-act="copy" style="'+CBI+'">Copy Bill No.</div>'
            +   (canUseTransactions ? '<div style="height:1px;background:#F1F5F9"></div>'
                + '<div class="cb-item" data-i="'+i+'" data-act="cancel" style="'+CBI+';color:#DC2626">Cancel Bill</div>' : '')
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
                var et=creditModulePath()+'/EditTransaction?transactionId='+encodeURIComponent(b.txId);
                if (act==='view' || act==='cancel') location.href=et;
                else if (act==='print') window.open('/fop'+creditModulePath()+'/ReceiptPdf?transactionId='+encodeURIComponent(b.txId),'_blank');
                else if (act==='copy') { try { navigator.clipboard.writeText(''+b.billNo); } catch(_e){} }
            });
        });
    }
    function renderCreditBills(search) {
        var root = document.getElementById('credit-bills-root');
        if (!root) return;
        var modulePath = creditModulePath();
        var billingPath = modulePath + (modulePath.endsWith('/kot') ? '/KotBilling' : '/Terminal');
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
                +     (root.dataset.creditBilling !== 'false' ? '<a href="'+billingPath+'" style="display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;background:#7C3AED;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">+ New Credit Bill</a>' : '')
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
            + '<div style="padding:18px 20px;background:#2e7d32;color:#fff;text-align:center;font-size:17px;font-weight:700">Settle Credit — #'+histEsc(bill.billNo)+'</div>'
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
            var recorded = false;
            pays.forEach(function(p){
                chain = chain.then(function(prev){
                    if (prev && !prev.success) return prev;
                    return historyPost({action:'settleCredit', settleTxId:bill.txId, settleMethod:p.method, settleAmount:String(p.amount)})
                        .then(function(result) { recorded = recorded || !!result.success; return result; });
                });
            });
            function refreshBalance() {
                ov.remove();
                var si = document.getElementById('credit-search');
                renderCreditBills(si ? si.value : '');
            }
            chain.then(function(last){
                if (last && last.success) {
                    refreshBalance();
                    if (last.fullyPaid) histToast('✔ Bill fully settled', '#2e7d32');
                    else histToast('✔ Payment recorded — ₹'+creditFmt(last.outstanding)+' remaining', '#e65100');
                } else {
                    histToast((last && last.error) || 'Error settling', '#e53935');
                    if (recorded) refreshBalance();
                    else { btn.disabled = false; btn.textContent = 'Confirm Payment'; }
                }
            }).catch(function(){
                refreshBalance();
                histToast('Could not confirm payment. Check repayment history before retrying.', '#e53935');
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

function submitPosPaymentForm(form) {
    // A cart refresh can replace the form while its confirmation is still open.
    // Attach it only for the submit event so no duplicate controls remain on cancel.
    var detached = !form.isConnected;
    if (detached) { form.hidden = true; document.body.appendChild(form); }
    try {
        if (form.requestSubmit) form.requestSubmit(); else form.submit();
    } finally {
        if (detached) form.remove();
    }
}

window.posPayCash = function(form) {
    if (window._posCommitEdits && !window._posCommitEdits()) return false;
    if (window._posWaitForEdits && window._posWaitForEdits(form)) return false;
    if (form.dataset.posPaymentConfirmed === '1') return true;
    // Cash tender modal: quick denomination buttons + editable amount + live change.
    // Keep the cart inert while the cashier enters received cash.
    try {
        var f = form.querySelector('input[name="amount"]');
        var due = parseFloat(f ? f.value : '0') || 0;
        if (due <= 0) { return true; }
        var old = document.getElementById('posCashTenderOverlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var denoms = [10, 20, 50, 100, 200, 500, 2000];
        var ov = document.createElement('dialog');
        ov.id = 'posCashTenderOverlay';
        ov.style.cssText = 'border:0;padding:0;background:transparent;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:visible';
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
        ov.showModal();
        var recvInp = ov.querySelector('#posCashRecv');
        recvInp.focus(); recvInp.select();
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
        function closeOv() { if (ov.open) ov.close(); ov.remove(); }
        var confirmed = false;
        function doConfirm() {
            var r = parseFloat(recvInp.value) || 0;
            if (confirmed || r < due) { return; }
            confirmed = true;
            if (f) f.value = r.toFixed(2);
            closeOv();
            form.dataset.posPaymentConfirmed = '1';
            submitPosPaymentForm(form);
        }
        ov.querySelector('#posCashCancel').addEventListener('click', closeOv);
        confirmBtn.addEventListener('click', doConfirm);
        ov.addEventListener('click', function(e) {
            var box = ov.getBoundingClientRect();
            if (e.target === ov && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) closeOv();
        });
        ov.addEventListener('cancel', function(e) { e.preventDefault(); closeOv(); });
        recvInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
        });
        ov.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' || !e.target.matches('.posCashDeno,#posCashExact')) return;
            e.preventDefault();
            e.target.click();
            doConfirm();
        });
        refresh();
        return false;
    } catch (e) { console.error('Cash payment dialog failed', e); return false; }
};

window.posPayDigital = function(form) {
    if (window._posCommitEdits && !window._posCommitEdits()) return false;
    if (window._posWaitForEdits && window._posWaitForEdits(form)) return false;
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
        var label = isUpi ? 'UPI Payment' : 'Card Payment';
        var old = document.getElementById('posPayConfirmOverlay');
        if (old) return false;
        var ov = document.createElement('div');
        ov.id = 'posPayConfirmOverlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', label);
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:12px';
        ov.innerHTML = PosTillDialogs.digitalMarkup(method, due);
        document.body.appendChild(ov);
        function closeOv() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        var okBtn = ov.querySelector('#posPayConfOk');
        var choosingReceipt = false;
        var submitted = false;
        function completePayment(skipReceipt) {
            if (submitted) return;
            submitted = true;
            if (skipReceipt) {
                var choice = document.createElement('input');
                choice.type = 'hidden';
                choice.name = 'skipReceipt';
                choice.value = 'Y';
                form.appendChild(choice);
            }
            closeOv();
            form.dataset.posPaymentConfirmed = '1';
            try { submitPosPaymentForm(form); }
            finally { if (choice) choice.remove(); }
        }
        function doConfirm() {
            if (choosingReceipt || submitted) return;
            if (!isUpi) { completePayment(false); return; }
            choosingReceipt = true;
            ov.setAttribute('aria-label', 'Save UPI bill');
            var panel = ov.firstElementChild;
            panel.innerHTML = PosTillDialogs.upiReceiptMarkup(due);
            var save = panel.querySelector('#posPaySave');
            save.addEventListener('click', function() { completePayment(true); });
            panel.querySelector('#posPaySavePrint').addEventListener('click', function() { completePayment(false); });
            save.focus();
        }
        ov.querySelector('#posPayConfCancel').addEventListener('click', closeOv);
        okBtn.addEventListener('click', doConfirm);
        ov.addEventListener('click', function(e) { if (e.target === ov && !choosingReceipt) closeOv(); });
        ov.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && (!choosingReceipt || e.repeat)) {
                e.preventDefault();
                if (!e.repeat) doConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (!choosingReceipt) closeOv();
            }
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
    if (window.posToggleFocus) return window.posToggleFocus();
};

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
        var cartRequest = null;
        var modeSwitching = false;
        var taxModePending = false, unconfirmedTaxTx = null;
        var cartClearing = false;
        var lastTxnNum = '';
        var lastPay = 0;
        var lastCartData = null;
        var heldId = '';
        var heldCount = 0;
        var catalogRevision = '', catalogCheck = null, catalogDirtyTx = '';

        // Keep this till open while the billing workspace is mounted.
        if (window.__posIdleCleanup) window.__posIdleCleanup();
        var idleAbort = new AbortController();
        var lastGestureAt = Date.now();
        var lastTouchSentAt = 0;
        var lastDayCheckAt = 0;
        var dayRefreshPending = false;
        var dayBadge = document.getElementById('pos-today-bills');
        var handedOff = false;
        var dayFormatter;
        try { if (dayBadge) dayFormatter = new Intl.DateTimeFormat('en-US', {timeZone:dayBadge.dataset.timeZone,
            year:'numeric',month:'2-digit',day:'2-digit'}); } catch (_) {}
        function sendSessionTouch() {
            if (!SI || handedOff || Date.now() - lastTouchSentAt < 10000) return;
            lastTouchSentAt = Date.now();
            fetch(location.pathname.replace(/\/+$/, '') + '/touchSession', {method:'POST', credentials:'same-origin',
                headers:{'Content-Type':'application/x-www-form-urlencoded'},
                body:new URLSearchParams({sessionId:SI, moquiSessionToken:TK})})
                .then(function(response){ return response.json(); })
                .then(function(result){
                    if (!af.isConnected || !result.handoffUserId) return;
                    handedOff = true;
                    window.__posIdleCleanup();
                    PosTillDialogs.showHandoff(result.handoffUserId, function(){ location.assign('/apps/zenith/pos/Dashboard'); });
                }).catch(function(){});
        }
        function maintainBillingScreen() {
            if (!af.isConnected) return;
            sendSessionTouch();
            checkAssetVersion();
            maybeAutoReload();
            if (dayFormatter && Date.now() - lastDayCheckAt >= 60000) {
                lastDayCheckAt = Date.now();
                var parts = {};
                dayFormatter.formatToParts(new Date()).forEach(function(p){ parts[p.type] = p.value; });
                var currentDay = parts.year + parts.month + parts.day;
                var countBadge = document.getElementById('pos-today-bills');
                if (countBadge && countBadge.dataset.day !== currentDay && !dayRefreshPending) {
                    dayRefreshPending = true;
                    fetchScreen({}).then(syncCompletedBillSummary).catch(function(){}).finally(function(){dayRefreshPending = false;});
                }
            }
        }
        function onCashierGesture(e) {
            if (!e.isTrusted || !af.isConnected) return;
            lastGestureAt = Date.now();
            sendSessionTouch();
        }
        ['pointerdown','keydown','touchstart','wheel'].forEach(function(type) {
            document.addEventListener(type,onCashierGesture,{capture:true,passive:true,signal:idleAbort.signal});
        });
        document.addEventListener('visibilitychange',function(){
            if (!document.hidden) { maintainBillingScreen(); pollCatalog(); }
        },{signal:idleAbort.signal});
        window.addEventListener('focus', pollCatalog, {signal:idleAbort.signal});
        var idleInterval = setInterval(function(){ maintainBillingScreen(); pollCatalog(); },10000);
        window.__posIdleCleanup = function(){ idleAbort.abort(); clearInterval(idleInterval); };
        sendSessionTouch();

        // --- Auto-update: reload the open terminal to the newest deploy, but ONLY when idle ----------
        // window.__posAssetVer is pos-terminal.js's build mtime embedded at render; the server returns
        // the current one. Every deploy changes it (build-from-git resets file mtimes), so a mismatch
        // means a newer build is live. We reload only when no sale is in progress (same safe-gate as
        // pollCatalog: no open cart, no payment/cash/split/credit modal, no pending sync, not mid
        // cart-clear/mode-switch) AND after 30s with no cashier gesture, and never more than once per
        // 2 min (sessionStorage guard) so a version mismatch can never cause a reload loop. No-op if
        // the baseline is absent (e.g. a surface that strips the inline script).
        var __baseVer = String((window.__posAssetVer != null) ? window.__posAssetVer : '');
        var __lastVerCheck = 0, __updateReady = false, __reloading = false;
        function checkAssetVersion() {
            if (__reloading || !__baseVer || Date.now() - __lastVerCheck < 120000) return;
            __lastVerCheck = Date.now();
            fetch('Terminal/posAssetVersion', {method:'POST', credentials:'same-origin',
                headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:''})
                .then(function(r){ return r.json(); })
                .then(function(d){ if (d && d.ver != null && String(d.ver) !== __baseVer) __updateReady = true; })
                .catch(function(){});
        }
        function maybeAutoReload() {
            if (!__updateReady || __reloading || !af.isConnected) return;
            if (lastCartData && lastCartData.items && lastCartData.items.length) return;
            if (cartClearing || modeSwitching || cartRequest || OPT._drainPending() ||
                (window._posOffline && window._posOffline.active()) ||
                document.querySelector('#posCreditOverlay,#posPayConfirmOverlay,#posCashTenderOverlay,.pos-cash-panel,.pos-split-panel')) return;
            if (Date.now() - lastGestureAt < 30000) return;
            try { if (Date.now() - (parseInt(sessionStorage.getItem('posAutoReloadTs'), 10) || 0) < 120000) return; } catch (e) {}
            __reloading = true;
            try { sessionStorage.setItem('posAutoReloadTs', String(Date.now())); } catch (e) {}
            try { showToast('Updating POS to the latest version...', '#7C3AED'); } catch (e) {}
            setTimeout(function(){ try { location.reload(); } catch (e) { window.location.href = window.location.pathname + window.location.search; } }, 1500);
        }


        function fmt(n) { return Math.round(Number(n)).toLocaleString('en-IN'); }
        function fmtQty(n) { return Number(n).toLocaleString('en-IN', {maximumFractionDigits:6}); }
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
            if (!hid || cartClearing || modeSwitching) return;
            if (window._posOffline?.active?.()) {
                window._posOffline.prepareOnlineRecall().then(function (ready) {
                    if (ready) recallHeldBill(hid);
                    else showToast('Finish syncing the current cart before recalling this bill.', '#b45309');
                });
                return;
            }
            if (window._posCommitEdits && !window._posCommitEdits()) return;
            cartClearing = true;
            OPT.whenIdle().then(function() {
                return post({action:'recallSale', heldId:hid});
            }).then(function(data) {
                if (!data || !data.success) throw new Error(data && data.error || 'Could not recall this bill.');
                SM = data.salesModeId || SM;
                af.querySelector('[name=salesModeId]').value = SM;
                applyTaxMode(data.taxOn);
                var url = new URL(location.href);
                url.searchParams.set('transactionId', data.transactionId);
                url.searchParams.set('salesModeId', SM);
                url.searchParams.set('taxOn', TO);
                url.searchParams.delete('freshSale');
                url.searchParams.delete('lastCompletedId');
                history.replaceState(history.state, '', url.href);
                document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function(link) {
                    link.classList.toggle('is-active', new URL(link.href).searchParams.get('salesModeId') === SM);
                });
                if (smRoot) smRoot.removeAttribute('data-sig');
                var heldPicker = document.querySelector('#pos-held-wrap details');
                if (heldPicker) heldPicker.open = false;
                renderCart(data);
                return fetchScreen({}).then(function(doc) {
                    if (!doc.getElementById('pos-held-wrap')) throw new Error('Held bills unavailable.');
                    syncHeldWrap(doc);
                    swapGrid(doc);
                    renderCart(lastCartData);
                }).catch(function() {
                    showToast('Bill recalled. Reload to refresh the Held Bills list and products.', '#b45309');
                });
            }).catch(function(error) { showToast(error.message, '#c62828'); })
              .finally(function() { cartClearing = false; });
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
            if (window._posOffline?.active?.()) { window._posOffline.discount(); return; }
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
            ov.innerHTML = PosTillDialogs.creditMarkup();
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
                if (cartRequest || OPT._drainPending() > 0) {
                    if (attempt < 80) setTimeout(function() { loadCreditBalance(attempt + 1); }, 100);
                    else duePreview.textContent = 'Bill is still updating. Close and reopen Credit.';
                    return;
                }
                refreshCatalog(true).then(function() { return post({action:'refresh', transactionId:TX}); }).then(function(d) {
                    if (!d || !d.success || !d.items || !d.items.length) throw new Error('Bill unavailable');
                    lastPay = Number(d.pay || 0);
                    lastCartData = d;
            if(window._posOffline)window._posOffline.remember(d);
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
                hid('transactionId', TX); hid('sessionId', SI); hid('salesModeId', SM); hid('taxOn', TO);
                hid('customerName', nm); hid('customerPhone', ph); hid('moquiSessionToken', TK);
                if (selectedPartyId) hid('customerPartyId', selectedPartyId);
                hid('upfrontAmount', paidNow.toFixed(2));
                hid('creditDays',daysInp.value);hid('termsReason',document.getElementById('credit-terms-reason').value);
                if (paidNow > 0) hid('upfrontMethod', document.getElementById('credit-upfront-method').value);
                confirmCatalogTender().then(function(){
                    hid('catalogRevision', catalogRevision);
                    f.querySelector('[name="transactionId"]').value = TX;
                    f.querySelector('[name="moquiSessionToken"]').value = TK;
                    return window.PosFreeItems.ensure(TX, TK);
                }).then(function(){
                    document.body.appendChild(f);f.submit();
                }).catch(function(error){updateDuePreview();btn.disabled=false;btn.textContent='Complete Credit Sale';showToast(error.message, '#c62828');});
            });
        };

        function showToast(msg, bg) {
            var t = document.createElement('div');
            t.setAttribute('role', bg === '#c62828' ? 'alert' : 'status');
            t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 32px);box-sizing:border-box;padding:14px 22px;border-radius:12px;font-size:18px;font-weight:700;color:#fff;background:'+(bg||'#2e7d32')+';box-shadow:0 6px 32px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;overflow-wrap:anywhere';
            t.textContent = msg;
            var fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
            (fullscreen && fullscreen !== document.documentElement ? fullscreen : document.body).appendChild(t);
            setTimeout(function() { t.style.opacity = '1'; }, 30);
            setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 400); }, 3500);
            return t;
        }

        function showBanner(billNum, method) {
            var old = document.querySelector('.pos-print-banner');
            if (old) old.remove();
            var b = document.createElement('div');
            b.className = 'pos-print-banner';
            var label = method === 'qz' ? 'sent to printer' : 'browser print requested';
            b.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:999998;background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;padding:18px 30px;display:flex;align-items:center;justify-content:center;gap:16px;font-size:18px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,0.3);transform:translateY(-100%);transition:transform 0.4s cubic-bezier(0.22,1,0.36,1);letter-spacing:0.5px';
            b.innerHTML = '<span style="font-size:28px">&#128424;</span> BILL-' + (billNum || '') + ' ' + label + ' <span style="font-size:22px">&#10004;</span>';
            document.body.appendChild(b);
            setTimeout(function() { b.style.transform = 'translateY(0)'; }, 30);
            setTimeout(function() { b.style.transform = 'translateY(-100%)'; setTimeout(function() { b.remove(); }, 500); }, 4000);
        }

        /* === QZ Tray - Silent Thermal Printing === */
        var qzSetup = null;
        var qzPrinter = '';
        try { qzPrinter = localStorage.getItem('posPrinter') || ''; } catch(e) {}

        function qzConnect() {
            return window.PosQzPrint.connect();
        }

        function qzShowSetup() {
            if (qzSetup) return qzSetup;
            qzSetup = qzConnect().then(function() {
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
                        + '<div style="font-size:13px;color:#666;margin-bottom:16px">Select your receipt printer for direct printing via QZ Tray. Allow QZ permission requests when prompted.</div>';
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
            }).finally(function() { qzSetup = null; });
            return qzSetup;
        }

        function qzPrint(html, billNum) {
            return qzConnect().then(function() {
                if (!qzPrinter) return qzShowSetup();
                return qzPrinter;
            }).then(function(printer) {
                return window.PosQzPrint.printHtml(printer, html);
            }).then(function() {
                showBanner(billNum, 'qz');
            });
        }

        // Connect only for an explicit print/setup action; opening billing must not prompt for device access.

        function buildReceiptHtml(d, isTax, edited) {
            return window.PosReceiptLayout.render(d, isTax, edited);
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

        function offerBrowserPrint(html, billNum, qzErr) {
            // Never force a native print dialog over fullscreen after a QZ failure.
            // A retry prints only this receipt; it does not repeat checkout/payment.
            var panel = document.createElement('div');
            panel.className = 'pos-print-fallback';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-label', 'Receipt printing');
            panel.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
            panel.innerHTML = posReceiptPrintMarkup('Receipt printing',
                'QZ Tray did not confirm printing. Check the printer before retrying. Browser printing may exit fullscreen.');
            document.body.appendChild(panel);
            if (qzErr) { try { panel.querySelector('.pos-print-status').textContent = 'QZ Tray did not print. Reason: ' + qzErr + '. Retry, or print via browser.'; } catch(e) {} }
            var retry = panel.querySelector('.pos-print-retry');
            retry.addEventListener('click', function() {
                panel.querySelectorAll('button').forEach(function(button) { button.disabled = true; });
                panel.querySelector('.pos-print-status').textContent = 'Connecting to QZ Tray. Allow the connection if prompted.';
                qzPrint(html + '</body></html>', billNum).then(function() { panel.remove(); }).catch(function(err) {
                    if (err === 'cancelled') { panel.remove(); return; }
                    panel.querySelector('.pos-print-status').textContent = 'QZ Tray did not confirm printing. Check the printer, then retry or choose browser printing.';
                }).finally(function() {
                    panel.querySelectorAll('button').forEach(function(button) { button.disabled = false; });
                });
            });
            panel.querySelector('.pos-print-browser').addEventListener('click', function() {
                panel.remove(); iframePrint(html, billNum);
            });
            panel.querySelector('.pos-print-cancel').addEventListener('click', function() { panel.remove(); });
            retry.focus();
        }

        function printReceipt(txId, billNum, taxOn, edited, preData) {
            if (!txId) return;
            var isTax = (taxOn === 'Y');
            function render(d) {
                if (!d || !d.success) return;
                var html = buildReceiptHtml(d, isTax, edited);
                if (typeof qz !== 'undefined' && window.PosQzPrint) {
                    var connecting = !qz.websocket.isActive() ? showToast('Connecting to QZ Tray. Allow the connection if prompted.', '#7C3AED') : null;
                    return qzPrint(html + '</body></html>', billNum).catch(function(err) {
                        if (err === 'cancelled') return;
                        console.warn('QZ Tray did not confirm receipt printing:', err);
                        offerBrowserPrint(html, billNum, err);
                    }).finally(function() { if (connecting) connecting.remove(); });
                } else if (document.fullscreenElement || document.webkitFullscreenElement) {
                    offerBrowserPrint(html, billNum);
                } else {
                    iframePrint(html, billNum);
                }
            }
            // Live sale passes the receipt data straight from the payment response — no extra fetch.
            if (preData && preData.success) return render(preData);
            return fetch('Terminal/ajaxCart', {
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams({action:'receiptData', transactionId: txId, sessionId: SI, taxOn: TO, salesModeId: SM, moquiSessionToken: TK}),
                credentials: 'same-origin'
            }).then(function(r) { return r.json(); }).then(render).catch(function(e) { console.error('Receipt print error:', e); });
        }
        // Expose so the (top-level) bill-history module can reprint an edited bill
        // using the same QZ/iframe pipeline when a session is active.
        window._posPrintReceipt = printReceipt;

        function approvedPaymentFetch(url, options) {
            return confirmCatalogTender().then(function() {
                options.body.set('transactionId', TX);
                options.body.set('catalogRevision', catalogRevision);
                options.body.set('taxOn', TO);
                options.body.set('moquiSessionToken', TK);
                return window.PosFreeItems.ensure(TX, TK);
            }).then(function() { return fetch(url, options); })
                .then(function(r) { return r.json().catch(function() { return null; }); })
                .then(function(d) {
                    if (!d || !d.priceReview) return d;
                    catalogDirtyTx = TX;
                    return refreshCatalog(true).catch(function() {}).then(function() {
                        throw new Error(d.error || 'Product prices changed. Review the current total before taking payment.');
                    });
                });
        }

        /* --- Cart AJAX --- */
        function post(params, signal) {
            if (cartRequest) {
                if (params.action !== 'clearCart') return Promise.resolve(null);
                // A refresh can already be in flight when the cashier clears the draft.
                return cartRequest.catch(function() {}).then(function() { return post(params, signal); });
            }
            params.sessionId = SI; params.taxOn = params.taxOn || TO; params.salesModeId = params.salesModeId || SM; params.moquiSessionToken = TK;
            cartRequest = fetch('Terminal/ajaxCart', {
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: new URLSearchParams(params), credentials: 'same-origin', signal: signal || AbortSignal.timeout(25000)
            }).then(function(r) { return r.json(); }).finally(function() { cartRequest = null; });
            return cartRequest;
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
                + '<button type="button" id="pos-pay-cash" class="pos-cash-btn">Cash'+badge('F2')+'</button>'
                + payBtn('Card','Card'+badge('F3'),'#009dff')
                + '<button id="pos-credit" type="button" onclick="posCreditSale()">Credit'+badge('F4')+'</button>'
                + payBtn('UPI','UPI'+badge('F5'),'#9518dd')
                + '<button id="pos-split" type="button" class="pos-split-btn">Split Payment'+badge('F6')+'</button>'
                + actionBtn('holdSale','Hold'+badge('F7'),'#ff9b00')
                + '</div>';
            if (disabled) html=html.replace(/<button /g,'<button disabled ');
            return html;
        }

        function buildSummary(d) {
            extractHeldInfo(document); // keep held count/id in sync with the live header badge
            var modeLabel = SM ? (SM.charAt(0).toUpperCase() + SM.slice(1).toLowerCase()) : 'Retail';
            var sh = '<div class="pos-sum-strip" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                + lastCompletedMarkup()
                + '<div style="display:flex;gap:16px;font-size:14px">'
                + '<span style="color:#555">Qty: <b id="posSumQty">'+fmtQty(d.tQty)+'</b></span>'
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
                + '<span style="color:#555">Qty: <b>'+(lastCartData ? fmtQty(lastCartData.tQty) : '0')+'</b></span>'
                + '<span style="color:#555">Tax: <b>'+(lastCartData ? fmt(lastCartData.tax) : '0')+'</b></span>'
                + '<span style="color:#555">Disc: <b>'+(lastCartData ? fmt(lastCartData.disc) : '0')+'</b></span>'
                + '</div></div>'
                + '<div class="pos-sum-total" style="background:#7C3AED;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
                + '<span style="font-size:16px;font-weight:600">'+modeLabel+' TOTAL</span>'
                + '<span style="font-size:28px;font-weight:800;letter-spacing:1px">'+CS+fmt(lastPay)+'</span></div>'
                + PosTillDialogs.splitMarkup(lastPay,
                    '<form method="post" action="Terminal/splitPayAndComplete" class="pos-split-form" style="margin:0">'
                    + '<input type="hidden" name="transactionId" value="'+TX+'"/>'
                    + '<input type="hidden" name="sessionId" value="'+SI+'"/>'
                    + '<input type="hidden" name="taxOn" value="'+TO+'"/>'
                    + '<input type="hidden" name="salesModeId" value="'+SM+'"/>'
                    + '<input type="hidden" name="customerPhone" value=""/>'
                    + '<input type="hidden" name="moquiSessionToken" value="'+TK+'"/>', '</form>');
        }

        function buildCashPanel() {
            var modeLabel = SM ? (SM.charAt(0).toUpperCase() + SM.slice(1).toLowerCase()) : 'Retail';
            return '<div class="pos-sum-strip" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                + lastCompletedMarkup()
                + '<div style="display:flex;gap:16px;font-size:14px">'
                + '<span style="color:#555">Qty: <b>'+(lastCartData ? fmtQty(lastCartData.tQty) : '0')+'</b></span>'
                + '<span style="color:#555">Tax: <b>'+(lastCartData ? fmt(lastCartData.tax) : '0')+'</b></span>'
                + '<span style="color:#555">Disc: <b>'+(lastCartData ? fmt(lastCartData.disc) : '0')+'</b></span>'
                + '</div></div>'
                + '<div class="pos-sum-total" style="background:#7C3AED;color:#fff;padding:clamp(5px,1vh,12px) 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
                + '<span style="font-size:16px;font-weight:600">'+modeLabel+' TOTAL</span>'
                + '<span style="font-size:28px;font-weight:800;letter-spacing:1px">'+CS+fmt(lastPay)+'</span></div>'
                + PosTillDialogs.cashMarkup(lastPay);
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
            url.searchParams.delete('freshSale');
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
        function patchCartRows(body, rows, discardInputs) {
            var active = document.activeElement;
            var selection = active && active.tagName === 'INPUT' && active.type !== 'number' ? [active.selectionStart, active.selectionEnd] : null;
            var existing = new Map(), wanted = new Set(rows.map(function(item) { return item.key; }));
            Array.from(body.children).forEach(function(row) {
                var control = row.querySelector('[data-seq]');
                var key = OPT.realSeq(row.dataset.posLineKey || (control && control.dataset.seq));
                if (wanted.has(key) && !existing.has(key)) {
                    row.dataset.posLineKey = key;
                    existing.set(key, row);
                } else row.remove();
            });
            rows.forEach(function(item, index) {
                var row = existing.get(item.key);
                if (row) existing.delete(item.key);
                else { row = document.createElement('tr'); row.dataset.posLineKey = item.key; }
                if (discardInputs || row._posMarkup !== item.html) {
                    var next = document.createElement('tr'), cells = [];
                    next.innerHTML = item.html;
                    Array.from(next.children).forEach(function(cell, index) {
                        cells.push(cell.outerHTML);
                        if (!row.children[index]) row.appendChild(cell);
                        else if (discardInputs || !row._posCells || row._posCells[index] !== cells[index]) {
                            if (!discardInputs && row.children[index].contains(active) && active.matches('.aj-p,.aj-qi')) {
                                // Moving a focused Qty fires change on a lone "." and restores 1 before the next digit.
                                if (active.classList.contains('aj-qi')) {
                                    var quantity = cell.querySelector('.aj-qi');
                                    active.dataset.seq = quantity.dataset.seq;
                                    active.defaultValue = quantity.defaultValue;
                                    active.previousElementSibling.replaceWith(quantity.previousElementSibling);
                                    active.nextElementSibling.replaceWith(quantity.nextElementSibling);
                                    return;
                                }
                                var replacement = cell.querySelector('.aj-p');
                                if (replacement) { active.dataset.seq = replacement.dataset.seq; replacement.replaceWith(active); }
                            }
                            row.replaceChild(cell, row.children[index]);
                        }
                    });
                    while (row.children.length > cells.length) row.lastElementChild.remove();
                    row._posCells = cells;
                    row._posMarkup = item.html;
                    row.style.borderBottom = '1px solid #e0e0e0';
                }
                if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
                row.dataset.posProduct = item.pid || ''; row.dataset.posMode = item.mode || '';
            });
            existing.forEach(function(row) { row.remove(); });
            if (active && active.isConnected && active.matches('.aj-p,.aj-qi')) {
                active.focus(); if (selection) try { active.setSelectionRange(selection[0], selection[1]); } catch (ignored) {}
            }
        }

        var pendingProductFocus = null;
        function renderCart(d, discardInputs, local) {
            if (cartFrame) { cancelAnimationFrame(cartFrame); cartFrame = 0; }
            if (!local && window._posOffline?.active?.()) return;
            if (d && d.cartClosed) { recoverClosedCart(); return; }
            if (!d || !d.success) { if (d && d.error) showToast(d.error, '#c62828'); return; }
            if (!local) {
                TX = d.transactionId || '';
                document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { if (el.value !== TX) el.value = TX; });
                syncModeLinks();
            }
            var discountButton = document.querySelector('.pos-checkout-reference #pos-discount');
            if (discountButton) discountButton.disabled = !d.items.length;
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
                    var _mn = _cm ? _cm.name : it.mode || '';
                    var _cbg = '#DBEAFE', _cfg = '#2563EB';
                    if (/whole/i.test(_mn)) { _cbg = '#FFEDD5'; _cfg = '#EA580C'; }
                    else if (/custom/i.test(_mn)) { _cbg = '#D5F0EC'; _cfg = '#0F766E'; }
                    if (d.modes.length > 1) {
                        var mo = !_cm && it.mode ? '<option selected disabled value="'+cartText(it.mode)+'">'+cartText(it.mode)+'</option>' : '';
                        d.modes.forEach(function(m){ mo += '<option value="'+cartText(m.id)+'"'+((it.mode||d.mode||SM)===m.id?' selected':'')+'>'+cartText(m.name)+(Number(m.disc)>0?(' −'+Number(m.disc)+'%'):'')+'</option>'; });
                        modeCell = '<select class="aj-mode" data-seq="'+cartText(it.seq)+'" title="Sale mode for this item" style="font-size:12px;font-weight:600;padding:3px 6px;border:1px solid '+_cbg+';border-radius:6px;background:'+_cbg+';color:'+_cfg+';cursor:pointer;max-width:120px">'+mo+'</select>';
                    } else {
                        modeCell = '<span style="display:inline-block;font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px;background:'+_cbg+';color:'+_cfg+'">'+cartText(_mn)+'</span>';
                    }
                }
                var priceNote = it.pricePending ? 'Enter a price above ₹0' :
                    (document.getElementById('pos-free-item-approval')||{}).value==='Y' && (Number(it.price)<=0 || Number(it.total)<=0) ? 'Free item · manager approval' : '';
                h += '<td style="padding:3px 10px"><div style="font-size:14px;font-weight:600;color:#000;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+cartText(it.name)+'</div><div style="font-size:11px;color:#555">'+cartText(it.pid)+'</div>'+(priceNote?'<small style="display:block;color:#92400e;font-weight:600">'+priceNote+'</small>':'')+'</td>';
                h += '<td style="padding:3px 8px;text-align:left;vertical-align:middle">'+modeCell+'</td>';
                h += '<td style="padding:4px 4px;text-align:right;vertical-align:middle"><div style="display:flex;align-items:center;gap:3px;justify-content:flex-end">';
                var priceCapability = document.getElementById('pos-price-override-allowed');
                var priceAllowed = local ? d.canOverride : !priceCapability || priceCapability.value === 'Y';
                h += '<input type="text" inputmode="decimal" value="'+Number(it.price)+'" data-seq="'+cartText(it.seq)+'" class="aj-p" '+(priceAllowed?'':'readonly title="POS write permission is required to change a bill price."')+' style="width:65px;padding:8px 6px;border:1px solid #ccc;border-radius:6px;font-size:14px;text-align:right;background:#fff;color:#000;box-sizing:border-box"/>';
                h += '<button data-seq="'+cartText(it.seq)+'" class="aj-pb" '+(priceAllowed?'':'disabled title="POS write permission is required to change a bill price."')+' style="width:32px;height:32px;border:none;background:#7C3AED;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0">&#10003;</button>';
                h += '</div></td>';
                h += '<td style="padding:4px;text-align:center;vertical-align:middle"><div style="display:flex;align-items:center;justify-content:center;gap:0">';
                h += '<button data-seq="'+cartText(it.seq)+'" data-q="'+(Number(it.qty)-1)+'" class="aj-q" style="width:34px;height:34px;border:2px solid #e53935;background:#fff;font-size:19px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:8px 0 0 8px;color:#e53935">-</button>';
                h += '<input type="text" inputmode="decimal" value="'+Number(it.qty)+'" data-seq="'+cartText(it.seq)+'" class="aj-qi" style="width:58px;text-align:center;font-weight:bold;font-size:16px;border-top:2px solid #ccc;border-bottom:2px solid #ccc;border-left:none;border-right:none;height:34px;background:#fff;color:#000;outline:none;box-sizing:border-box"/>';
                h += '<button data-seq="'+cartText(it.seq)+'" data-q="'+(Number(it.qty)+1)+'" class="aj-q" style="width:34px;height:34px;border:2px solid #2e7d32;background:#fff;font-size:19px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:0 8px 8px 0;color:#2e7d32">+</button>';
                if (it.uom) h += '<span class="pos-cart-uom" style="font-size:11px;color:#e65100;font-weight:700;margin-left:5px;white-space:nowrap;flex-shrink:0">'+cartText(it.uom)+'</span>';
                h += '</div>';
                h += '</td>';
                h += '<td style="padding:3px 10px;text-align:right;font-size:14px;color:#6B7280;vertical-align:middle">'+Number(it.tax||0).toFixed(3)+'</td>';
                h += '<td style="padding:3px 10px;text-align:right;font-size:15px;font-weight:700;color:#000;vertical-align:middle">'+fmt2(it.total)+'</td>';
                h += '<td style="padding:4px 6px;text-align:center;vertical-align:middle"><button data-seq="'+cartText(it.seq)+'" class="aj-rm" style="width:32px;height:32px;border:none;background:#e53935;color:#fff;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;padding:0" title="Remove item">&#10005;</button></td>';
                rows.push({key:String(it.seq), pid:it.pid, mode:it.mode || SM || '', html:h});
            });
            var _cs = document.getElementById('cartScroll'); var _ps = _cs ? _cs.scrollTop : 0; var _pc = (lastCartData && lastCartData.items) ? lastCartData.items.length : 0;
            if (d.items.length) patchCartRows(tb, rows, discardInputs === true);
            else tb.innerHTML = h;
            if (pendingProductFocus) {
                var selected = d.items.findIndex(function(item) { return item.pid === pendingProductFocus; });
                if (selected >= 0) {
                    var field = tb.children[selected].querySelector('.aj-qi');
                    if (field) { field.focus(); field.select(); }
                    pendingProductFocus = null;
                }
            }
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
                if (_q && (local ? sm.querySelector('.pos-reference-payments') : sm.getAttribute('data-sig') === _sig)) {
                    _q.textContent = fmtQty(d.tQty);
                    var _tx = sm.querySelector('#posSumTax'); if (_tx) _tx.textContent = fmt(d.tax);
                    var _dc = sm.querySelector('#posSumDisc'); if (_dc) _dc.textContent = fmt(d.disc);
                    var _tt = sm.querySelector('#posSumTotal'); if (_tt) _tt.innerHTML = CS + (document.querySelector('.pos-checkout-reference') ? fmt2(d.pay) : fmt(d.pay));
                } else {
                    sm.innerHTML = buildSummary(d);
                    sm.setAttribute('data-sig', _sig);
                }
                if (local) {
                    sm.querySelectorAll('.pos-reference-payments button:not(#pos-copilot)').forEach(function (button) {
                        button.disabled = !d.items.length;
                    });
                    var label = sm.querySelector('.pos-sum-total > span:first-child');
                    if (label) label.textContent = d.modeLabel + ' TOTAL';
                    var last = document.getElementById('pos-last-completed');
                    var lastAmount = d.lastLocalAmount;
                    if (last && lastAmount != null) {
                        var text = 'Last amount: ' + fmt2(lastAmount);
                        if (last.firstChild && last.firstChild.nodeType === Node.TEXT_NODE) last.firstChild.nodeValue = text;
                        else last.prepend(document.createTextNode(text));
                    }
                }
            }
            // Mirror authoritative and optimistic cart changes in the visible side summary.
            var sideCount = document.getElementById('pos-side-item-count');
            if (sideCount) sideCount.textContent = 'Subtotal (' + d.items.length + ' item' + (d.items.length === 1 ? '' : 's') + ')';
            [['pos-side-subtotal', d.sub], ['pos-side-discount', d.disc], ['pos-side-tax', d.tax], ['pos-side-round', d.round]].forEach(function(pair) {
                var value = document.getElementById(pair[0]);
                if (value) value.textContent = CS + fmt2(pair[1] || 0);
            });
            if (local) return;
            document.querySelectorAll('.pos-pay-form input[name="amount"]').forEach(function(el) { el.value = d.pay; });
            document.querySelectorAll('.pos-pay-form input[name="transactionId"]').forEach(function(el) { if (el.value !== TX) el.value = TX; });
            lastTxnNum = d.txnNum || '';
            lastPay = d.pay || 0;
            if (window._posOffline && d !== lastCartData) window._posOffline.remember(d);
            lastCartData = d;
            window._posSetCustomerChip(d.customer, d.customerPhone);
        }
        window._posRenderOfflineCart = function (data) { renderCart(data, false, true); };

        function lastCompletedMarkup() {
            var root = document.getElementById('pos-terminal-root');
            var amount = cartText(root?.dataset.lastCompletedAmount || '0');
            return '<div id="pos-last-completed" style="font-size:13px;color:#777">Last amount: ' + amount + '</div>';
        }

        function resetCompletedCart(keepCategory) {
            // Reset the live model and any scheduled optimistic paint before the next tap.
            // The receipt keeps its own completed-bill payload.
            renderCart({success:true, transactionId:'', items:[], sub:0, tax:0, disc:0,
                tQty:0, grand:0, pay:0, round:0, modes:lastCartData && lastCartData.modes || []});
            // Checkout leaves an empty cart. A refresh must not reopen the completed
            // transaction still present in the original cashier URL.
            var current = new URL(window.location.href);
            current.searchParams.delete('transactionId');
            if (!keepCategory) {
                current.searchParams.delete('catId');
                current.searchParams.delete('searchTerm');
                resetProductCategory();
            }
            if (current.href !== location.href) history.replaceState(history.state, '', current.pathname + current.search + current.hash);
        }

        function syncCompletedBillSummary(doc) {
            var source = doc.getElementById('pos-terminal-root');
            var root = document.getElementById('pos-terminal-root');
            if (source && root) {
                root.dataset.lastCompletedAmount = source.dataset.lastCompletedAmount || '0';
                var lastSummary = document.getElementById('pos-last-completed');
                if (lastSummary) lastSummary.textContent = 'Last amount: ' + root.dataset.lastCompletedAmount;
            }
            var sourceCount = doc.querySelector('#pos-today-bills');
            var count = document.getElementById('pos-today-bills');
            if (sourceCount && count) {
                count.textContent = sourceCount.textContent;
                count.dataset.day = sourceCount.dataset.day;
            }
        }
        window._posReadRestoredCart = function (transactionId, bill) {
            return post({action:'refresh',transactionId:transactionId,taxOn:bill.taxOn,salesModeId:bill.mode}, AbortSignal.timeout(12000));
        };
        window._posRememberRestoredSource = function (transactionId) {
            TX = transactionId;
            af.elements.transactionId.value = transactionId;
        };

        window._posResumeOnline = function (source, bill) {
            if (!af.isConnected) return;
            if (smRoot) smRoot.removeAttribute('data-sig');
            if (bill) {
                SM = bill.mode || SM;
                TO = bill.taxOn;
                af.elements.salesModeId.value = SM;
                var url = new URL(location.href);
                url.searchParams.set('transactionId', source.transactionId);
                url.searchParams.set('salesModeId', SM);
                url.searchParams.set('taxOn', TO);
                url.searchParams.delete('freshSale');
                url.searchParams.delete('lastCompletedId');
                history.replaceState(history.state, '', url.href);
                document.querySelectorAll('.pos-header a[href*="changeSalesMode"]').forEach(function (link) {
                    link.classList.toggle('is-active', new URL(link.href).searchParams.get('salesModeId') === SM);
                });
            }
            if (source) renderCart(source, true);
            else resetCompletedCart(true);
            applyTaxMode(TO);
            return fetchScreen({}, AbortSignal.timeout(12000)).then(function (doc) {
                syncHeldWrap(doc);
                syncCompletedBillSummary(doc);
            }).catch(function () {});
        };

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
            var syncError = null;
            var recovering = null;
            var idleWaiters = [];
            var realByTmp = {};
            function notifyIdle() {
                if (inflight || q.length) return;
                idleWaiters.splice(0).forEach(function(waiter) { if (syncError) waiter.reject(syncError); else waiter.resolve(); });
            }
            function realSeq(seq) { return realByTmp[seq] || seq; }
            function requestCart(params, renewed) {
                return fetch('Terminal/ajaxCart', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','X-Requested-With':'XMLHttpRequest'},
                    body:new URLSearchParams(params), credentials:'same-origin', signal:AbortSignal.timeout(15000) })
                    .then(function(response) {
                        // Only retry an explicitly rejected request and absolute edits/reads.
                        // Never replay an add/scan delta or an ambiguous network failure.
                        if (response.status === 401 && !response.redirected && !renewed &&
                            ['refresh','updatePrice','updateQty','setItemMode'].indexOf(params.action) !== -1) {
                            return refreshBrowserToken(params.transactionId).then(function() {
                                params.moquiSessionToken = TK;
                                return requestCart(params, true);
                            });
                        }
                        return response.json().catch(function (error) {
                            error.posGateway = [502,503,504].includes(response.status);
                            throw error;
                        });
                    });
            }
            function reconcile() {
                if (recovering) return recovering;
                recovering = requestCart(Object.assign(paramsFor({action:'refresh'}), {recoverDraft:'Y'})).then(function(data) {
                    if (!data || (!data.success && !data.cartClosed)) return;
                    pendingProductFocus = null;
                    renderCart(data, true);
                    if (!data.cartClosed) syncError = null;
                }).catch(function() {
                    // A later action can retry the read without replaying an uncertain edit.
                }).finally(function() { recovering = null; });
                return recovering;
            }
            function fail(message) {
                inflight = false;
                q.length = 0;
                syncError = new Error(message + ' Check the saved cart before continuing.');
                notifyIdle();
                showToast(syncError.message, '#c62828');
                reconcile();
            }
            function canEdit() {
                if (cartClearing || modeSwitching) {
                    showToast('Wait for the cart to finish updating', '#c62828');
                    return false;
                }
                if (!syncError) return true;
                showToast('Checking the saved cart. Try the edit again in a moment.', '#c62828');
                reconcile();
                return false;
            }

            function n(x) { return Number(x) || 0; }
            function isTmp(s) { return String(s).indexOf('t#') === 0; }
            function lc() { return lastCartData; }
            function bySeq(s) { var L = lc(); if (!L) return null; for (var i = 0; i < L.items.length; i++) if (String(L.items[i].seq) === String(s)) return L.items[i]; return null; }
            function byPid(pid, mode, price) {
                var cart = lc();
                return cart && cart.items.find(function(item) {
                    return item.pid === pid && (item.mode || '') === mode && n(item.price) === n(price);
                });
            }

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
            function handoff() {
                inflight = false;
                var edits = q.splice(0);
                syncError = null;
                if (cartFrame) { cancelAnimationFrame(cartFrame); cartFrame = 0; }
                idleWaiters.splice(0).forEach(function (waiter) {
                    waiter.reject(new Error('Connection lost. Continue with the offline cart.'));
                });
                window._posOffline.handoff(edits);
            }
            function drain() {
                if (inflight || !q.length) return;
                if (window._posOffline && window._posOffline.disconnected()) { handoff(); return; }
                var op = q[0];
                if (op.needSeq && isTmp(op.seq)) {
                    fail('The item could not be matched to a saved bill line.');
                    return;
                }
                inflight = true;
                requestCart(paramsFor(op)).then(function(d) {
                    inflight = false;
                    q.shift();
                    if (d && d.cartClosed) {
                        q.length = 0;
                        syncError = new Error(d.error || 'This bill is no longer open.');
                        notifyIdle();
                        recoverClosedCart();
                        return;
                    }
                    if (!d || !d.success) {
                        // The server can create the bill before rejecting its first item.
                        if (d && d.transactionId && !TX) TX = d.transactionId;
                        fail(d && d.error || 'The bill edit could not be saved.');
                        return;
                    }
                    if (d.transactionId && d.transactionId !== TX) { realByTmp = {}; TX = d.transactionId; }
                    if (window._posOffline) {
                        window._posOffline.remember(d);
                        af.querySelector('[name=transactionId]').value = TX;
                    }
                    calibrate(d);
                    if (op.ts && d.addedItemSeqId) realByTmp[op.ts] = d.addedItemSeqId;
                    applyRealSeqs();
                    if (window._posOffline && window._posOffline.disconnected()) { handoff(); return; }
                    if (!q.length) renderCart(d);
                    drain();
                    notifyIdle();
                }).catch(function(error) {
                    if (!window._posOffline) { fail('The bill could not be synchronized.'); return; }
                    window._posOffline.transportFailure(error).then(function (lost) {
                        if (lost) handoff();
                        else fail('The bill could not be synchronized.');
                    });
                });
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
                        if (op.action === 'addItem' && n(q[i].price) === n(op.price)) { q[i].addQty = (q[i].addQty || 1) + (op.addQty || 1); drain(); return; }
                        if ((op.action === 'updateQty' || op.action === 'updatePrice') && q[i].seq === op.seq) { q[i] = op; drain(); return; }
                    }
                }
                q.push(op); drain();
            }

            function doAdd(pid, price, name, uom) {
                // A deliberate product selection focuses its quantity; background additions preserve an active line draft.
                if (!document.activeElement || !document.activeElement.matches('.aj-p,.aj-qi')) pendingProductFocus = pid;
                var L = lc();
                // First item of a fresh bill: no cart/transaction yet. Start a local cart
                // and render instantly; the addItem goes out with an empty transactionId,
                // the server CREATES the transaction and returns its id, and single-flight
                // FIFO makes every later op wait and adopt it.
                if (!L) { L = { success: true, transactionId: TX || '', items: [], disc: 0 }; lastCartData = L; }
                var ln = byPid(pid, SM || '', price); var newTs = null;
                if (ln && n(ln.qty) > 0) { var f = (n(ln.qty) + 1) / n(ln.qty); ln.qty = n(ln.qty) + 1; ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f; }
                else { newTs = 't#' + (++tmp); ln = { seq: newTs, pid: pid, name: name || pid, price: n(price), qty: 1, total: n(price), tax: 0, disc: 0, mode: SM || '', uom: uom || '' }; L.items.push(ln); }
                recompute();
                if (pendingProductFocus) renderCart(L); else queueCartRender();
                enqueue({ action: 'addItem', pid: pid, price: price, mode: SM || '', addQty: 1, ts: newTs, lineKey: pid + '|' + (SM || '') });
            }
            function doQty(seq, newQty) {
                newQty = Number(newQty);
                var ln = bySeq(seq);
                // A quantity edit must NEVER delete the line — a decimal/cleared/0 value that
                // resolved while typing would silently drop the item. Revert to the authoritative
                // cart instead; removal is only via the explicit × (remove) button.
                if (!(newQty > 0)) return;
                if (!ln) { enqueue({action:'updateQty', seq:seq, newQty:newQty, needSeq:true, lineKey:seq}); return; }
                var f = newQty / n(ln.qty); ln.qty = newQty; ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f;
                recompute(); renderCart(lc());
                enqueue({ action: 'updateQty', seq: ln.seq, newQty: newQty, needSeq: true, lineKey: ln.pid + '|' + (ln.mode || '') });
            }
            function doPrice(seq, newPrice) {
                newPrice = Number(newPrice);
                var ln = bySeq(seq);
                if (!ln) { enqueue({action:'updatePrice', seq:seq, newPrice:newPrice, needSeq:true, lineKey:seq}); return; }
                var f = n(ln.price) > 0 ? newPrice / n(ln.price) : 0;
                ln.price = newPrice;
                if (f > 0) { ln.total = n(ln.total) * f; ln.tax = n(ln.tax) * f; } else { ln.total = newPrice * n(ln.qty); ln.tax = 0; }
                recompute(); renderCart(lc());
                enqueue({ action: 'updatePrice', seq: ln.seq, newPrice: newPrice, needSeq: true, lineKey: ln.pid + '|' + (ln.mode || '') });
            }
            function doRemove(seq) {
                var L = lc();
                var ln = bySeq(seq); var key = ln ? (ln.pid + '|' + (ln.mode || '')) : ('rm#' + seq);
                if (L) {
                    L.items = L.items.filter(function (it) { return String(it.seq) !== String(seq); });
                    recompute(); renderCart(L);
                }
                enqueue({ action: 'removeItem', seq: seq, needSeq: true, lineKey: key });
            }
            function doMode(seq, mode) {
                // per-item sales-mode reprices server-side by discount rules -> no safe optimistic value
                var ln = bySeq(seq); var key = ln ? (ln.pid + '|' + (ln.mode || '')) : ('mode#' + seq);
                enqueue({ action: 'setItemMode', seq: seq, mode: mode, needSeq: true, lineKey: key });
            }
            var scanN = 0;
            function doScan(code) { enqueue({ action: 'scanAdd', code: code, lineKey: 'scan#' + (++scanN) }); }

            function local(op) {
                if (!window._posOffline || !window._posOffline.active()) return false;
                window._posOffline.edit(op);
                return true;
            }
            window._posCartWriteInFlight = function () { return inflight; };
            return {
                add: function (pid, price, name, uom) { if (canEdit()) doAdd(pid, price, name, uom); },
                qty: function (seq, qty) { if (!local({action:'updateQty',seq:seq,newQty:qty}) && canEdit()) doQty(seq, qty); },
                price: function (seq, price) { if (!local({action:'updatePrice',seq:seq,newPrice:price}) && canEdit()) doPrice(seq, price); },
                remove: function (seq) { if (!local({action:'removeItem',seq:seq}) && canEdit()) doRemove(seq); },
                mode: function (seq, mode) { if (!local({action:'setItemMode',seq:seq,mode:mode}) && canEdit()) doMode(seq, mode); },
                scan: function (code) { if (canEdit()) doScan(code); },
                realSeq: realSeq,
                _drainPending: function () { return q.length + (inflight || syncError ? 1 : 0); },
                whenIdle: function () {
                    if (syncError) {
                        var error = syncError;
                        return reconcile().then(function() { throw error; });
                    }
                    if (window._posCommitEdits && !window._posCommitEdits()) return Promise.reject(new Error('Correct the bill rate or quantity before continuing.'));
                    if (cartFrame) renderCart(lastCartData);
                    return (inflight || q.length) ? new Promise(function(resolve, reject) { idleWaiters.push({resolve:resolve,reject:reject}); }) : Promise.resolve();
                }
            };
        })();

        window._posClearCart = function() {
            if (window._posOffline?.active?.()) {
                if (window._posOffline.paused()) return Promise.reject(new Error('Reconnect before clearing this cart.'));
                if (!window._posOffline.clearDraft()) return Promise.reject(new Error('Wait for the saved cart to reconnect before clearing it.'));
                return Promise.resolve();
            }
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
            if (window._posOffline && window._posOffline.active()) { window._posOffline.add(pid, price); return; }
            OPT.add(pid, price, name);
        };
        window._posScan = function(code) {
            if (window._posOffline && window._posOffline.active()) { window._posOffline.scan(code); return; }
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
            return fetch(base + '?' + qs, {credentials: 'same-origin', cache:'no-store', signal: signal})
                .then(function(r) { if (!r.ok) throw new Error('Product refresh failed'); return r.text(); })
                .then(function(html) { return new DOMParser().parseFromString(html, 'text/html'); });
        }
        function refreshBrowserToken(expectedTx) {
            // A different tab can renew the session while the till stays open. A fresh,
            // authorized form supplies its token without replacing the cashier's cart.
            return fetchScreen({}).then(function(doc) {
                var form = doc.getElementById('cartInlineAddForm');
                var session = form && form.querySelector('[name=sessionId]');
                var token = form && form.querySelector('[name=moquiSessionToken]');
                if (!af.isConnected || expectedTx !== TX || !session || session.value !== SI || !token || !token.value)
                    throw new Error('Your sign-in session needs attention. Sign in again to continue this bill.');
                TK = token.value;
                document.querySelectorAll('[name=moquiSessionToken]').forEach(function(input) { input.value = TK; });
            });
        }
        window._posRefreshBrowserToken = function() { return refreshBrowserToken(TX); };

        function productGridDocument(data, params) {
            var doc = document.implementation.createHTMLDocument('');
            var grid = doc.createElement('div'); grid.className = 'pos-product-grid';
            data.products.forEach(function(p) {
                var form = doc.createElement('form'); form.method='post'; form.action='Terminal/addItem';
                form.style.cssText='margin:0;display:contents';
                Object.entries({sessionId:SI, transactionId:TX, productId:p.productId, unitPrice:p.price,
                    addQty:1, catId:params.catId || '', taxOn:TO, salesModeId:SM, moquiSessionToken:TK}).forEach(function(pair) {
                    var input=doc.createElement('input');input.type='hidden';input.name=pair[0];input.value=pair[1];form.appendChild(input);
                });
                var button=doc.createElement('button');button.type='submit';
                button.style.cssText='background:#fff;border:1px solid #ddd;border-radius:10px;padding:14px 8px;cursor:pointer;text-align:center;font-family:inherit;color:#333;min-height:clamp(64px,9vh,90px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px';
                var title=doc.createElement('div');title.textContent=p.name;title.title=p.name;
                title.style.cssText='font-size:13px;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex-shrink:0';
                var price=doc.createElement('div');price.textContent=p.priceText;price.style.cssText='font-size:17px;font-weight:bold;color:#e53935';
                var stock=doc.createElement('div');stock.className='pos-card-stock';stock.dataset.productId=p.productId;stock.textContent=p.stockText;stock.title="On-hand stock in this counter's warehouse";
                button.append(title,price,stock);form.appendChild(button);grid.appendChild(form);
            });
            if(data.hasMore){var more=doc.createElement('button');more.type='button';more.className='pos-load-more';more.dataset.nextOffset=data.nextOffset;more.textContent='Load more products';more.style.cssText='grid-column:1/-1;padding:12px;border:1px solid #A78BFA;border-radius:8px;background:#fff;color:#6D28D9;font-weight:700;cursor:pointer';grid.appendChild(more);}
            if(!data.products.length){var empty=doc.createElement('div');empty.style.cssText='grid-column:1/-1;text-align:center;padding:60px 20px;color:#999';empty.textContent='No products found';grid.appendChild(empty);}
            doc.body.appendChild(grid); return doc;
        }

        function fetchCatalog(params, request = new AbortController()) {
            if (window._posOffline?.active?.() && window._posOffline.gridPage)
                return Promise.resolve().then(function () { return productGridDocument(window._posOffline.gridPage(params), params); });
            var data = Object.assign({sessionId:SI, salesModeId:SM, moquiSessionToken:TK}, params);
            var deadline = setTimeout(function() { request.abort(); }, 5000);
            return fetch('Terminal/productGrid', {method:'POST', credentials:'same-origin', signal:request.signal,
                headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(data)})
                .then(function(r) { if (!r.ok) throw new Error('Product refresh failed'); return r.json(); })
                .then(function(data) {
                    if (!data.success) throw new Error(data.error || 'Product grid unavailable');
                    return productGridDocument(data, params);
                }).finally(function() { clearTimeout(deadline); });
        }

        function swapGrid(doc) {
            var next=doc.querySelector('.pos-product-grid'), grid=document.querySelector('.pos-product-grid');
            if(next && grid) grid.replaceChildren.apply(grid, Array.from(next.childNodes));
        }

        /* --- Cart event delegation --- */
        var cart = document.querySelector('.pos-cart');
        function commitLineInput(input) {
            if (!input || input.readOnly || !input.matches('.aj-p,.aj-qi')) return true;
            var raw = input.value.trim(), value = Number(raw), price = input.classList.contains('aj-p');
            var valid = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) && Number.isFinite(value) && (price ? value >= 0 : value > 0);
            input.setCustomValidity(valid ? '' : (price ? 'Enter a valid nonnegative rate.' : 'Enter a quantity greater than zero.'));
            input.setAttribute('aria-invalid', String(!valid));
            if (!valid) return false;
            var line = lastCartData && lastCartData.items.find(function(item) { return String(item.seq) === input.dataset.seq; });
            var previous = line ? Number(price ? line.price : line.qty) : Number(input.dataset.posSubmitted != null ? input.dataset.posSubmitted : input.defaultValue);
            if (previous !== value) {
                if (!line) input.dataset.posSubmitted = String(value);
                if (price) OPT.price(input.dataset.seq, value); else OPT.qty(input.dataset.seq, value);
            }
            return true;
        }
        function currentPaymentForm(form) {
            if (!form.isConnected) {
                var method = form.querySelector('[name=paymentMethod]');
                var updated = method && Array.from(document.querySelectorAll('form.pos-pay-form')).find(function(candidate) {
                    var input = candidate.querySelector('[name=paymentMethod]'); return input && input.value === method.value;
                });
                if (updated) return updated;
                // The normal summary can replace the form with a Cash button.
                var amount = form.querySelector('[name=amount]');
                if (amount) amount.value = lastPay;
            }
            return form;
        }
        window._posWaitForEdits = function(form) {
            if (!OPT._drainPending()) return false;
            var paymentTx = TX;
            OPT.whenIdle().then(function() {
                if (af.isConnected && TX && TX === paymentTx) submitPosPaymentForm(currentPaymentForm(form));
            }).catch(function(error) { showToast(error.message, '#c62828'); });
            return true;
        };
        window._posCommitEdits = function() {
            var fields = cart ? cart.querySelectorAll('.aj-p,.aj-qi') : [];
            for (var i = 0; i < fields.length; i++) {
                if (!commitLineInput(fields[i])) { fields[i].focus(); fields[i].reportValidity(); return false; }
            }
            return true;
        };
        if (cart) {
            cart.addEventListener('input', function(e) { commitLineInput(e.target); });
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
                var input = e.target;
                if (!input.matches('.aj-p,.aj-qi') || e.isComposing) return;
                var price = input.classList.contains('aj-p'), next;
                if (e.key === 'Enter') {
                    next = price ? input.closest('tr').querySelector('.aj-qi') : document.getElementById('cartInlineSearch');
                } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && input.selectionStart === input.selectionEnd) {
                    if (e.key === 'ArrowLeft' && !price && input.selectionStart === 0) next = input.closest('tr').querySelector('.aj-p');
                    if (e.key === 'ArrowRight' && price && input.selectionEnd === input.value.length) next = input.closest('tr').querySelector('.aj-qi');
                }
                if (!next || next.readOnly) return;
                e.preventDefault();
                if (!commitLineInput(input)) { input.reportValidity(); return; }
                next.focus();
                if (e.key === 'Enter') next.select();
                else { var caret = e.key === 'ArrowLeft' ? next.value.length : 0; next.setSelectionRange(caret, caret); }
            });
            // Typeable quantity (decimals for loose/weighed goods); price auto-recalculates server-side
            cart.addEventListener('change', function(e) {
                if (e.target.classList.contains('aj-qi')) {
                    var nq = Number(e.target.value);
                    // Empty/0/NaN (e.g. the box was cleared to retype a decimal) must not delete
                    // the line — revert to the last good qty. Any value > 0 (incl. decimals like
                    // 0.5) keeps the line and recomputes its amount (qty × rate).
                    if (!(nq > 0)) {
                        var savedItem = lastCartData && lastCartData.items.find(function(item) { return String(item.seq) === String(e.target.dataset.seq); });
                        e.target.value = savedItem ? savedItem.qty : e.target.defaultValue;
                        e.target.setCustomValidity(''); e.target.removeAttribute('aria-invalid');
                        if (lastCartData) renderCart(lastCartData);
                        return;
                    }
                    commitLineInput(e.target);
                }
                if (e.target.classList.contains('aj-p')) commitLineInput(e.target);
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
            var term = input ? input.value : '';
            var cat = CATID;
            fetchCatalog({productOffset: offset, searchTerm: term, catId: term ? '' : cat})
                .then(function(doc) {
                    if (CATID !== cat || (input && input.value !== term) || !more.isConnected) return;
                    var next = doc.querySelector('.pos-product-grid');
                    if (!next) throw new Error('Product page unavailable');
                    var grid = more.parentElement;
                    more.remove();
                    while (next.firstChild) grid.appendChild(next.firstChild);
                })
                .catch(function() {
                    if (!more.isConnected) return;
                    more.disabled = false;
                    showToast('Could not load more products. Try again.', '#c62828');
                })
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
            if (window._posOffline && window._posOffline.active()) {
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
                grid.setAttribute('aria-busy', 'true');
            }
            return fetchCatalog(params, catalogAbort).then(function(doc) {
                if (version !== catalogVersion) return;
                var next = doc.querySelector('.pos-product-grid');
                if (!next) throw new Error('Product grid unavailable');
                if (!params.catId && !params.searchTerm && !window._posOffline?.active?.()) __allGridCache = next.innerHTML;
                swapGrid(doc);
                lastCatalogCategory = CATID;
            }).catch(function(error) {
                if (version !== catalogVersion) return;
                CATID = lastCatalogCategory;
                var root = document.getElementById('pos-terminal-root');
                if (root) root.dataset.checkoutCategory = CATID || '';
                document.querySelectorAll('.pos-cat-strip a').forEach(function(link) {
                    var selected = (new URL(link.href).searchParams.get('catId') || '') === (CATID || '');
                    link.classList.toggle('is-selected', selected);
                    link.style.background = selected ? '#7C3AED' : '#455a64';
                });
                showToast(window._posOffline?.active?.() ? error.message : 'Could not refresh products. The previous products are available; try again.', '#c62828');
            }).finally(function() {
                if (version !== catalogVersion) return;
                var grid = document.querySelector('.pos-product-grid');
                if (grid) { grid.style.pointerEvents = ''; grid.style.opacity = '1'; grid.setAttribute('aria-busy', 'false'); }
            });
        }
        window._gridSearch = function(term) {
            return term ? loadCatalog({searchTerm: term, catId: ''}) : loadCatalog({catId: CATID || ''}, CATID ? null : __allGridCache);
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
        function selectProductCategory(id) {
            CATID = id;
            var root = document.getElementById('pos-terminal-root');
            if (root) root.dataset.checkoutCategory = id;
            document.querySelectorAll('.pos-cat-strip a').forEach(function (link) {
                var selected = (new URL(link.href).searchParams.get('catId') || '') === id;
                link.classList.toggle('is-selected', selected);
                link.style.background = selected ? '#7C3AED' : '#455a64';
            });
            var search = document.getElementById('cartInlineSearch');
            if (search && search.value) {
                search.value = '';
                search.dispatchEvent(new Event('input'));
            }
            return loadCatalog({catId:id, searchTerm:''}, id ? null : __allGridCache);
        }
        function resetProductCategory() {
            var search = document.getElementById('cartInlineSearch');
            var current = new URL(location.href);
            if (CATID || (search && search.value) || current.searchParams.has('searchTerm')) selectProductCategory('');
        }
        function refreshCatalog(revalidate) {
            if (catalogCheck) {
                if (!revalidate) return catalogCheck;
                return catalogCheck.catch(function() {}).then(function() { return refreshCatalog(true); });
            }
            var checkedTx = TX, previous = catalogRevision;
            function request(attempt) {
                return fetch('Terminal/catalogRevision', {
                    method:'POST', credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(10000),
                    headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},
                    body:new URLSearchParams({sessionId:SI, transactionId:checkedTx, taxOn:TO,
                        since:previous, revalidate:revalidate ? 'Y' : 'N', moquiSessionToken:TK})
                }).then(function(response) {
                    if (response.status === 401 && !attempt) {
                        return refreshBrowserToken(checkedTx).then(function() {
                            catalogDirtyTx = checkedTx;
                            return request(1);
                        });
                    }
                    if (response.status === 401 || response.redirected && /\/Login(?:[/?#]|$)/i.test(response.url))
                        throw new Error('Your sign-in session expired. Sign in again to continue this bill.');
                    if (!response.ok) {
                        var error = new Error(response.status === 403 ? 'Access to this POS session was denied.' : 'Could not verify product prices. Try again.');
                        error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
                        throw error;
                    }
                    return response.json();
                }).catch(function(error) {
                    if (attempt || !af.isConnected || checkedTx !== TX ||
                        !(error.retryable || error instanceof TypeError || error instanceof SyntaxError || error.name === 'TimeoutError')) throw error;
                    // The verification is idempotent. Re-read the saved cart if a response was lost.
                    catalogDirtyTx = checkedTx;
                    return new Promise(function(resolve) { setTimeout(resolve, 300); }).then(function() { return request(1); });
                });
            }
            catalogCheck = request(0).then(function(data) {
                if (!data || !data.success || !data.revision)
                    throw new Error(data && (data.error || (data.errors || []).join(' ')) || 'Could not verify product prices. Try again.');
                if (!af.isConnected) return data;
                catalogRevision = data.revision;
                if (data.changed) {
                    syncCatalogModes(data.modes || []);
                    __allGridCache = null;
                    var search = document.getElementById('cartInlineSearch');
                    if (search && search.value.trim()) {
                        window._gridSearch(search.value);
                        search.dispatchEvent(new CustomEvent('input', {detail:{catalogRefresh:true}}));
                    } else window._gridSearch('');
                    if (previous && window._posOffline) window._posOffline.cacheCatalog();
                }
                if (checkedTx && (data.cartChanged || (previous && data.changed))) catalogDirtyTx = checkedTx;
                if (!TX || catalogDirtyTx !== TX || taxModePending || cartRequest || OPT._drainPending() ||
                    document.querySelector('.pos-cart [aria-invalid="true"]')) return data;
                var cartBefore = lastCartData;
                return post({action:'refresh', transactionId:TX}).then(function(current) {
                    if (!af.isConnected || checkedTx !== TX || OPT._drainPending() || lastCartData !== cartBefore) return data;
                    if (!current || !current.success) throw new Error('Could not refresh the bill. Try again.');
                    var focused = document.activeElement;
                    var edited = focused && focused.matches('.aj-p') && focused.getAttribute('aria-invalid') !== 'true';
                    var oldValue = edited && focused.value;
                    if (Number(current.pay) !== Number(lastPay) && smRoot &&
                        smRoot.querySelector('.pos-cash-panel,.pos-split-panel')) {
                        smRoot.removeAttribute('data-sig');
                    }
                    renderCart(current);
                    if (edited && focused.isConnected && focused.value === oldValue) {
                        var line = current.items.find(function(item) { return String(item.seq) === focused.dataset.seq; });
                        if (line) focused.value = line.price;
                    }
                    catalogDirtyTx = '';
                    return data;
                });
            }).finally(function() { catalogCheck = null; });
            return catalogCheck;
        }
        function pollCatalog() {
            if (!af.isConnected || document.hidden || !navigator.onLine || cartClearing || modeSwitching || cartRequest ||
                OPT._drainPending() || (window._posOffline && window._posOffline.active()) ||
                document.querySelector('#posCreditOverlay,#posPayConfirmOverlay,#posCashTenderOverlay,.pos-cash-panel,.pos-split-panel')) return;
            refreshCatalog(false).then(function(data) {
                if (data.cartChanged) showToast('Product prices changed. Review the updated bill total.', '#b45309');
            }).catch(function() {});
        }
        function taxModeError() {
            if (taxModePending) return 'Wait for the tax mode to finish updating.';
            if (unconfirmedTaxTx === TX) return 'Retry the tax switch before taking payment.';
            return '';
        }
        function confirmCatalogTender() {
            var total = Number(lastPay), checkedTx = TX;
            return OPT.whenIdle().then(function() {
                var error = taxModeError();
                if (error) throw new Error(error);
                return refreshCatalog(true);
            }).then(function(data) {
                var error = taxModeError();
                if (error) throw new Error(error);
                if (TX !== checkedTx) throw new Error('The active bill changed. Review it before taking payment.');
                if (!af.isConnected || !TX || catalogDirtyTx === TX) throw new Error('Could not verify the current bill. Try again.');
                if (data.cartChanged || Number(lastPay) !== total)
                    throw new Error('Product prices changed. Review the updated bill total before taking payment.');
            });
        }
        document.querySelectorAll('.pos-cat-strip a').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                selectProductCategory(new URL(link.href).searchParams.get('catId') || '');
            });
        });

        /* --- Sales mode switching: AJAX --- */
        function syncCatalogModes(modes) {
            var menu = document.querySelector('.pos-header .nb-modes__menu');
            var heading = menu && menu.querySelector('.nb-modes__section');
            if (!heading) return;
            menu.querySelectorAll('a[href*="changeSalesMode"],.nb-modes__item[aria-current],.pos-mode-unavailable').forEach(function(link) { link.remove(); });
            if (!modes.length) {
                var hint = document.createElement('span');
                hint.className = 'nb-modes__item pos-mode-unavailable';
                hint.textContent = 'No active sales modes';
                heading.after(hint);
                return;
            }
            if (!modes.some(function(mode) { return mode.id === SM; })) {
                SM = (modes.find(function(mode) { return mode.isDefault; }) || modes[0]).id;
                af.querySelector('[name=salesModeId]').value = SM;
            }
            var links = document.createDocumentFragment();
            modes.forEach(function(mode) {
                var link = document.createElement('a');
                var query = new URLSearchParams({sessionId:SI, transactionId:TX, catId:CATID, taxOn:TO, salesModeId:mode.id});
                link.href = 'Terminal/changeSalesMode?' + query;
                link.className = 'nb-modes__item' + (mode.id === SM ? ' is-active' : '');
                link.textContent = mode.name;
                links.appendChild(link);
            });
            heading.after(links);
        }
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
        var modeHeader = document.querySelector('.pos-header');
        if (modeHeader) modeHeader.addEventListener('click', function(e) {
                var link = e.target.closest('a[href*="changeSalesMode"]');
                if (!link) return;
                e.preventDefault();
                e.stopPropagation();
                if (modeSwitching) return;
                var linkUrl = new URL(link.href);
                var newSM = linkUrl.searchParams.get('salesModeId') || '';
                if (!newSM || newSM === SM) return;
                modeSwitching = true;
                var previousSM = SM;
                OPT.whenIdle().then(function() {
                    // The optimistic cart can be visible before its addItem reply gives us TX.
                    // Switch only after every queued write has settled, using that current ID.
                    return fetchScreen({salesModeId: newSM, applySalesMode: "Y"});
                }).then(function(doc) {
                    var renderedMode = doc.querySelector('#cartInlineAddForm [name="salesModeId"]');
                    if (!renderedMode) throw new Error('Could not load the selected sales mode.');
                    SM = renderedMode.value;
                    af.querySelector('[name=salesModeId]').value = SM;
                    __allGridCache = null;
                    swapGrid(doc);
                    var search = document.getElementById('cartInlineSearch');
                    if (search && search.value.trim()) search.dispatchEvent(new Event('input'));
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

        /* --- Tax toggle: AJAX --- */
        var taxForm = document.querySelector('.pos-header form[action*="toggleTax"]');
        function applyTaxMode(taxOn) {
            TO = taxOn;
            document.querySelectorAll('input[name="taxOn"]').forEach(function(input) { input.value = TO; });
            if (!taxForm) return;
            taxForm.querySelector('input[name="taxOn"]').value = TO === 'Y' ? 'N' : 'Y';
            var label = taxForm.querySelector('.nb-tax__lbl');
            if (label) label.textContent = 'Tax: ' + (TO === 'Y' ? 'On' : 'Off');
            var button = taxForm.querySelector('button');
            if (button) { button.classList.toggle('on', TO === 'Y'); button.setAttribute('aria-pressed', String(TO === 'Y')); }
        }
        if (taxForm) taxForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (modeSwitching || cartClearing || paymentPanelPending) return;
            var newTax = TO === 'Y' ? 'N' : 'Y';
            var button = taxForm.querySelector('button');
            var label = taxForm.querySelector('.nb-tax__lbl');
            var settledCart = OPT.whenIdle();
            modeSwitching = taxModePending = true;
            button.disabled = true;
            taxForm.setAttribute('aria-busy','true');
            label.textContent = 'Updating tax…';
            settledCart.then(function() {
                // Let any earlier catalog response settle before it can repaint the old tax total.
                return catalogCheck && catalogCheck.catch(function() {});
            }).then(function() {
                var transaction = TX;
                return post({action:'toggleTax',transactionId:transaction,taxOn:newTax}, AbortSignal.timeout?.(15000))
                    .catch(function() {
                        unconfirmedTaxTx = transaction;
                        throw new Error('Could not confirm tax mode. Retry the tax switch before taking payment.');
                    });
            }).then(function(data) {
                if (!data || !data.success || data.taxOn !== newTax)
                    throw new Error(data && data.error || 'Tax mode could not be changed. Try again.');
                unconfirmedTaxTx = null;
                if (catalogDirtyTx === TX) catalogDirtyTx = '';
                if (!af.isConnected || (window._posOffline && window._posOffline.active())) return;
                applyTaxMode(data.taxOn);
                var url = new URL(location.href);
                url.searchParams.set('taxOn',TO);
                history.replaceState(history.state,'',url.href);
                renderCart(data);
            }).catch(function(error) {
                showToast(error.message,'#c62828');
            }).finally(function() {
                modeSwitching = taxModePending = false;
                button.disabled = false;
                taxForm.removeAttribute('aria-busy');
                if (!window._posOffline || !window._posOffline.active())
                    label.textContent = 'Tax: ' + (TO === 'Y' ? 'On' : 'Off');
            });
        });

        /* --- Close Session: shared cash review --- */
        var closeForm = document.querySelector('.pos-header form[action*="closeSession"]');
        if (closeForm) closeForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (closeForm.dataset.loading || document.getElementById('posCloseSessionOverlay')) return;
            closeForm.dataset.loading = '1';
            try {
                var offline = window._posOffline;
                var deferred = offline && await offline.needsDeferredClose();
                var summary;
                if (!deferred) {
                    try {
                        var response = await fetch('Terminal/ajaxCart', {
                            method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000),
                            body:new URLSearchParams({action:'sessionSummary', sessionId:SI, taxOn:TO, salesModeId:SM, moquiSessionToken:TK})
                        });
                        summary = await response.json();
                        if (!response.ok || !summary.success) throw new Error(summary.error || 'Failed to load session summary');
                        if (offline) await offline.rememberSummary(summary).catch(function () {});
                    } catch (error) {
                        if (!offline || !(await offline.transportFailure(error))) throw error;
                        deferred = true;
                    }
                }
                if (deferred) summary = await offline.closeSummary();
                PosTillDialogs.openClose({sessionId:SI, summary:summary, warning:summary.warning, close:async function(amount) {
                    if (deferred || (offline && await offline.needsDeferredClose())) return offline.deferClose(amount);
                    var fd = new FormData(closeForm);
                    fd.set('closingCash',amount); fd.set('wantJson','1'); fd.set('moquiSessionToken',TK);
                    var response;
                    try { response = await fetch(closeForm.action,{method:'POST',body:new URLSearchParams(fd),credentials:'same-origin',signal:AbortSignal.timeout(5000)}); }
                    catch (error) {
                        if (offline && await offline.transportFailure(error)) return offline.deferClose(amount);
                        throw error;
                    }
                    if ([502,503,504].includes(response.status) && offline) {
                        var gateway = new Error('Session close unavailable'); gateway.posGateway = true;
                        if (await offline.transportFailure(gateway)) return offline.deferClose(amount);
                    }
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.success) throw new Error(result.error || 'Session close failed. Please try again.');
                    return result;
                }, onClosed:function(result) {
                    if (result.deferred) return;
                    showToast('Session closed successfully');
                    var cleared = window._posOffline ? window._posOffline.sessionClosed() : Promise.resolve();
                    cleared.finally(function() { location.assign(result.redirectUrl || '/apps/zenith/pos/Terminal?sessionId='+encodeURIComponent(SI)); });
                }});
            } catch (error) { showToast(error.message,'#c62828'); }
            finally { delete closeForm.dataset.loading; }
        });

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
            var taxError = taxModeError();
            if (taxError) { showToast(taxError,'#c62828'); return; }
            paymentPanelPending = true;
            smRoot.setAttribute('aria-busy','true');
            OPT.whenIdle().then(function() {
                return refreshCatalog(true);
            }).then(function() {
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
        // terminal render after an AJAX void.
        function syncHeldWrap(doc) {
            window._posOffline?.cacheHeldBills(true);
            if (window._posOffline && !window._posOffline.canUseOnlineHeldPicker()) return;
            var source = doc.querySelector('#pos-held-wrap'), target = document.getElementById('pos-held-wrap');
            if (!source || !target) return;
            var open = !!target.querySelector('details[open]');
            target.innerHTML = source.innerHTML;
            var picker = target.querySelector('details');
            if (picker) picker.open = open;
        }
        window._posRefreshHeldPicker = function () {
            return fetchScreen({}, AbortSignal.timeout(12000)).then(syncHeldWrap).catch(function () {});
        };
        // Hold in place: a native navigation exits browser fullscreen.
        document.addEventListener('submit', function(e) {
            if (!af.isConnected) return;
            var form = e.target.closest ? e.target.closest('form') : null;
            if (!form) return;
            var act = form.getAttribute('action') || '';
            if (act.indexOf('holdSale') !== -1) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (window._posOffline?.active?.()) { window._posOffline.hold(); return; }
                if (cartClearing || modeSwitching || !TX) return;
                cartClearing = true;
                OPT.whenIdle().then(function() {
                    var reason = form.querySelector('[name=holdReason]');
                    return post({action:'holdSale', transactionId:TX, holdReason:reason ? reason.value : ''});
                }).then(function(data) {
                    if (!data || !data.success || !data.heldId) throw new Error(data && data.error || 'Could not hold this bill.');
                    resetCompletedCart(true);
                    showToast('Bill held', '#b45309');
                    // Fetch the existing server-rendered picker; no document navigation.
                    return fetchScreen({transactionId:''}).then(function(doc) {
                        if (!doc.getElementById('pos-held-wrap')) throw new Error('Held bills unavailable.');
                        syncHeldWrap(doc);
                        if (lastCartData) renderCart(lastCartData);
                    }).catch(function() {
                        showToast('Bill held. Reload to refresh the Held Bills list.', '#b45309');
                    });
                }).catch(function(error) { showToast(error.message, '#c62828'); })
                  .finally(function() { cartClearing = false; });
                return;
            }
            if (act.indexOf('recallSale') !== -1) {
                e.preventDefault(); e.stopImmediatePropagation();
                var held = form.querySelector('[name=heldId]');
                if (held) recallHeldBill(held.value);
                return;
            }
            if (act.indexOf('voidSale') !== -1) {
                e.preventDefault();
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI); fd.set('taxOn', TO);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                // Empty the cart optimistically for void; Hold waits for its native response.
                renderCart({ success: true, transactionId: '', items: [], sub: 0, tax: 0, disc: 0, tQty: 0, grand: 0, pay: 0 });
                TX = ''; lastCartData = null; lastPay = 0;
                showToast('Sale voided', '#e53935');
                fetch(form.action, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin' })
                    .then(function(r) { var u = r.url || ''; return r.text().then(function(html) { return { html: html, url: u }; }); })
                    .then(function(resp) {
                        var doc = new DOMParser().parseFromString(resp.html, 'text/html');
                        var ntx = doc.querySelector('input[name="transactionId"]');
                        var newTx = ntx ? (ntx.value || '') : '';
                        if (!newTx && resp.url) { var m = resp.url.match(/transactionId=(\d+)/); if (m) newTx = m[1]; }
                        TX = newTx;
                        document.querySelectorAll('input[name="transactionId"]').forEach(function(el) { el.value = TX; });
                        // Void keeps the optimistic empty cart until the next bill starts.
                        var ntk = doc.querySelector('input[name="moquiSessionToken"]'); if (ntk && ntk.value) TK = ntk.value;
                        syncHeldWrap(doc);
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function() { try { location.reload(); } catch (e) {} });
            }
            if (act.indexOf('payAndComplete') !== -1 && act.indexOf('splitPayAndComplete') === -1) {
                e.preventDefault();
                // This capture listener runs before the form's native confirmation
                // handler. Gate first, then re-enter once through requestSubmit().
                e.stopPropagation();
                if (/posPayCash|posPayDigital/.test(form.getAttribute('onsubmit') || '') && form.dataset.posPaymentConfirmed !== '1') {
                    if (paymentPanelPending) return;
                    var method = form.querySelector('[name="paymentMethod"]').value;
                    var paymentTx = TX;
                    paymentPanelPending = true;
                    OPT.whenIdle().then(function() { return refreshCatalog(true); }).then(function() {
                        if (!af.isConnected || !TX || TX !== paymentTx) return;
                        form = currentPaymentForm(form);
                        var gate = method === 'Cash' ? window.posPayCash : window.posPayDigital;
                        if (gate(form) !== false) {
                            form.dataset.posPaymentConfirmed = '1';
                            submitPosPaymentForm(form);
                        }
                    }).catch(function(error) { showToast(error.message, '#c62828'); })
                      .finally(function() { paymentPanelPending = false; });
                    return;
                }
                delete form.dataset.posPaymentConfirmed;
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                fd.set('wantJson', '1'); // get the print-receipt data back in the same response
                var method = fd.get('paymentMethod') || 'Cash';
                var paidAmt = fd.get('amount') || '0';
                var shouldPrint = method !== 'UPI' || fd.get('skipReceipt') !== 'Y';
                var savedTx = TX;
                var btn = form.querySelector('button');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
                approvedPaymentFetch(form.action, {method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin'})
                    .then(function(d) {
                        if (!d || !d.success) throw new Error((d && d.error) || 'Payment failed');
                        var billNum = d.bill && d.bill.number || '';
                        showToast('✔ Sale Complete' + (billNum ? ' — ' + billNum : '') + ' — ' + CS + fmt(paidAmt) + ' ' + method.toUpperCase());
                        if (shouldPrint) printReceipt(savedTx, billNum, TO, false, d.receiptUnavailable ? null : d);
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
                        syncCompletedBillSummary(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        showToast('Payment error: ' + err.message, '#c62828');
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                    });
            }
            if (act.indexOf('splitPayAndComplete') !== -1) {
                e.preventDefault();
                if (!PosTillDialogs.updateSplit(form.closest('.pos-split-panel'), lastPay)) {
                    showToast('Check the split amounts before completing the bill.', '#c62828');
                    return;
                }
                var fd = new FormData(form);
                fd.set('transactionId', TX); fd.set('sessionId', SI);
                fd.set('salesModeId', SM); fd.set('moquiSessionToken', TK);
                fd.set('wantJson', '1'); // get the print-receipt data back in the same response
                var cAmt = Number(fd.get('cashAmount') || 0);
                var dAmt = Number(fd.get('cardAmount') || 0);
                var uAmt = Number(fd.get('upiAmount') || 0);
                var splitParts = [];
                if (cAmt > 0) splitParts.push(CS + fmt(cAmt) + ' Cash');
                if (dAmt > 0) splitParts.push(CS + fmt(dAmt) + ' Card');
                if (uAmt > 0) splitParts.push(CS + fmt(uAmt) + ' UPI');
                var savedTx = TX;
                var btn = form.querySelector('button[type="submit"]');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Processing...'; }
                approvedPaymentFetch(form.action, {method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin'})
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
                        syncCompletedBillSummary(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        showToast('Split payment error: ' + err.message, '#c62828');
                        if (btn) { btn.style.opacity = ''; btn.textContent = 'Confirm split'; PosTillDialogs.updateSplit(form.closest('.pos-split-panel'), lastPay); }
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
                openPaymentPanel(buildSplitPanel, function() {
                    PosTillDialogs.bindSplit(smRoot.querySelector('.pos-split-panel'), lastPay);
                });
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
                        syncCompletedBillSummary(doc);
                        appendRecallIfNeeded();
                        var bn = document.querySelector('.pos-header [style*="background:#e65100"]') || document.querySelector('.pos-header [style*="background: rgb(230, 81, 0)"]');
                        if (bn) bn.textContent = 'BILL- 0';
                    })
                    .catch(function(err) {
                        showToast('Payment error: ' + err.message, '#c62828');
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '💰 CONFIRM PAYMENT'; }
                    });
            }
        });

        /* --- Cash input: live change calculation --- */
        if (smRoot) smRoot.addEventListener('input', function(e) {
            if (!e.target.classList.contains('pos-cash-input')) return;
            PosTillDialogs.updateCash(smRoot,lastPay);
        });
        pollCatalog();
    }
    init();
})();

/* === Cart Inline Search === */
(function() {
    function initCartSearch() {
        var si = document.getElementById('cartInlineSearch');
        var dd = document.getElementById('cartSearchDropdown');
        if (!si || !dd) { setTimeout(initCartSearch, 300); return; }
        var dt, aidx = -1, keyTimes = [], searchVersion = 0, searchAbort, gridSearchActive = false;
        if (si.dataset.posSearchBound) return;
        si.dataset.posSearchBound = 'true';
        function resetSearch() {
            ++searchVersion;
            clearTimeout(dt); clearTimeout(window._gridSyncTimer);
            if (searchAbort) searchAbort.abort();
            dd.replaceChildren(); dd.style.display = 'none'; aidx = -1;
        }
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        }); }
        function resetGridSearch() {
            if (gridSearchActive && window._gridSearch) window._gridSearch('');
            gridSearchActive = false;
        }
        // A physical barcode scanner emits keys far faster (<50ms apart) than a human types.
        function isScan() { if (keyTimes.length < 3) return false; var avg = (keyTimes[keyTimes.length - 1] - keyTimes[0]) / (keyTimes.length - 1); return avg < 160; }  /* ZE-BC-090: was 50ms — too tight for Safari/Edge Bluetooth-HID delivery (scans misread as typing). Chrome is ~20ms so unaffected; server scanAdd also resolves by name, so a misclassified fast-type still finds the product. */
        si.addEventListener('keydown', function(e) { if (e.key && e.key.length === 1) { keyTimes.push(Date.now()); if (keyTimes.length > 30) keyTimes.shift(); } });  /* ZE-BC-090: was 'keypress' (deprecated + fires unreliably for HID input in Safari/Edge); keydown fires consistently — track printable keys only. */
        function renderResults(data, text, version) {
            if (version !== searchVersion || si.value !== text || !si.isConnected) return;
            if (!data.length) {
                dd.innerHTML = '<div style="padding:10px;color:#999;font-size:13px;text-align:center">No products found</div>';
            } else {
                dd.innerHTML = data.map(function (p) {
                    return '<div class="cart-dd-item" data-pid="' + esc(p.productId) + '" data-price="' + Number(p.mrpAmount || 0) + '" data-name="' + esc(p.productName) + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee;font-size:14px;background:#fff">'
                        + '<span class="dd-price" style="float:right;color:#e53935;font-weight:bold;font-size:14px">' + (p.pricePending ? '₹0 · Enter price' : esc(p.mrpAmount)) + '</span>'
                        + '<span class="dd-name" style="font-weight:600;color:#000">' + esc(p.productName) + '</span>'
                        + '<div class="dd-code" style="font-size:12px;color:#555;margin-top:2px">' + esc(p.pseudoId) + '</div></div>';
                }).join('');
            }
            dd.style.display = 'block'; aidx = -1;
        }
        si.addEventListener('input', function(event) {
            var text = this.value; resetSearch(); var version = searchVersion;
            if (event.isComposing) return;
            if (!text.trim()) { keyTimes = []; resetGridSearch(); return; }
            var offline = window._posOffline;
            if (offline && offline.active()) {
                renderResults(offline.searchSuggestions(text), text, version);
                return;
            }
            var form = document.getElementById('cartInlineAddForm');
            if (!form) return;
            var local = offline ? offline.searchSuggestions(text, form.elements.salesModeId.value) : [];
            if (local.length) renderResults(local, text, version);
            var grid = document.querySelector('.pos-product-grid');
            if (event.detail?.catalogRefresh) gridSearchActive = true;
            else if (window._gridSearch && grid && grid.getClientRects().length) {
                window._gridSyncTimer = setTimeout(function() {
                    if (version === searchVersion) { gridSearchActive = true; window._gridSearch(text); }
                }, 450);
            }
            dt = setTimeout(function() {
                var lookup = new URLSearchParams({term:text,
                    salesModeId:form.elements.salesModeId.value, moquiSessionToken:form.elements.moquiSessionToken.value});
                var request = searchAbort = new AbortController();
                var deadline = setTimeout(function() { request.abort(); }, 5000);
                fetch('Terminal/lookupProducts', {
                    signal:request.signal, method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
                    body:lookup, credentials:'same-origin'
                }).then(function(r) {
                    if (!r.ok) throw new Error('Product search unavailable');
                    return r.json();
                }).then(function(rows) {
                    if (!Array.isArray(rows) || version !== searchVersion || aidx >= 0) return;
                    renderResults(rows, text, version);
                }).catch(function() {
                    if (!local.length && version === searchVersion && si.value === text) {
                        dd.textContent = 'Could not load product results. Try searching again.';
                        dd.style.display = 'block';
                    }
                }).finally(function() { clearTimeout(deadline); });
            }, 100);
        });
        si.addEventListener('keydown', function(e) {
            if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
            var items = dd.querySelectorAll('.cart-dd-item');
            if (e.key === 'ArrowUp' && !si.value.trim()) {
                var firstQty = document.querySelector('.pos-cart .aj-qi:not([readonly]):not([disabled])');
                if (firstQty) { e.preventDefault(); firstQty.focus(); firstQty.select(); }
                return;
            }
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
                resetSearch(); si.value = '';
                if (!document.activeElement.matches('.aj-qi')) si.focus();
                resetGridSearch();
                keyTimes = [];
            }
            else if (e.key === 'Escape') { resetSearch(); }
            for (var i = 0; i < items.length; i++) items[i].style.background = (i === aidx) ? '#e8f5e9' : '#fff';
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items[aidx]) items[aidx].scrollIntoView({block:'nearest'});
        });
        dd.addEventListener('click', function(e) {
            var item = e.target.closest('.cart-dd-item');
            if (!item) return;
            if (window._posAjax) {
                window._posAjax(item.dataset.pid, item.dataset.price, item.dataset.name);
                resetSearch(); si.value = '';
                if (!document.activeElement.matches('.aj-qi')) si.focus();
                resetGridSearch();
                return;
            }
        });
        document.addEventListener('click', function(e) { if (!si.contains(e.target) && !dd.contains(e.target)) resetSearch(); });
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
