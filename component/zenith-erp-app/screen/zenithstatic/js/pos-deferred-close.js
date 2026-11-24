/* Durable POS offline queues and close requests for the signed-in organization and cashier. */
(function () {
    if (window.PosDeferredClose) return;
    var running, retryTimer, retryDelay = 5000, sessionWork = new Map();
    function identity() {
        var el = document.getElementById('pos-sync-context');
        return el && el.dataset.organization && el.dataset.user ?
            {organization:el.dataset.organization, user:el.dataset.user, token:el.dataset.token} : null;
    }
    function assertIdentity(who) {
        var current = identity();
        if (!current || current.organization !== who.organization || current.user !== who.user)
            throw Error('Return to the original organization to sync this session.');
    }
    function open() {
        var who = identity();
        if (!who) return Promise.reject(Error('Sign in to the original organization to sync this session.'));
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open('ZenithPosOffline-' + encodeURIComponent(who.organization), 2);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', {keyPath:'productId'});
                if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', {keyPath:'offlineId'});
                if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', {keyPath:'key'});
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }
    async function read(store, key) {
        var db = await open();
        try {
            return await new Promise(function (resolve, reject) {
                var request = db.transaction(store).objectStore(store);
                request = key == null ? request.getAll() : key instanceof IDBKeyRange ? request.getAll(key) : request.get(key);
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function () { reject(request.error); };
            });
        } finally { db.close(); }
    }
    async function write(change) {
        var db = await open();
        try {
            await new Promise(function (resolve, reject) {
                var tx = db.transaction(['state','queue'], 'readwrite');
                change(tx);
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = function () { reject(tx.error || Error('Session could not be saved on this device.')); };
            });
        } finally { db.close(); }
    }
    function key(sessionId) { return 'session-close:' + sessionId; }
    async function get(sessionId) {
        var row = await read('state', key(sessionId)), who = identity();
        return row && row.value && row.value.userId === who.user ? row.value : null;
    }
    async function save(request) {
        var who = identity();
        if (!who || !request.sessionId || !request.terminalId || !Number.isFinite(Number(request.closingCash)) || Number(request.closingCash) < 0)
            throw Error('Enter a valid closing cash amount.');
        request = Object.assign({}, request, {organizationPartyId:who.organization, userId:who.user, requestedAt:new Date().toISOString()});
        var prior = await get(request.sessionId);
        if (prior) return prior;
        assertIdentity(who);
        await write(function (tx) {
            var state = tx.objectStore('state');
            state.put({key:key(request.sessionId), value:request});
            ['draft:','snapshot:','holds:'].forEach(function (prefix) {
                var stateKey = prefix + request.terminalId + ':' + who.user;
                var existing = state.get(stateKey);
                existing.onsuccess = function () {
                    var value = existing.result && existing.result.value;
                    if (prefix === 'holds:' && Array.isArray(value)) {
                        state.put({key:stateKey, value:value.filter(function (hold) { return hold.sessionId !== request.sessionId; })});
                    } else if (value && value.sessionId === request.sessionId) state.put({key:stateKey, value:null});
                };
            });
        });
        notify(request);
        return request;
    }
    async function post(action, data) {
        var who = identity();
        if (!who) throw Error('Sign in to sync this session.');
        var payload = Object.assign({}, data, {moquiSessionToken:who.token});
        var closing = action === 'closeSession';
        var response = await fetch('/apps/zenith/pos/Terminal/' + action, {
            method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(20000),
            headers:{'Content-Type':closing ? 'application/x-www-form-urlencoded' : 'application/json'},
            body:closing ? new URLSearchParams(payload) : JSON.stringify(payload),
        });
        if (!response.ok) throw Error('Connection unavailable. The saved session will retry automatically.');
        return response.json();
    }
    function readyToSync(sale) { return !sale.checkoutPendingUntil || sale.checkoutPendingUntil <= Date.now(); }
    async function postSales(who, terminalId, sales) {
        assertIdentity(who);
        var result = await post('syncOfflineTransactions', {terminalId:terminalId, transactions:sales.map(function (sale) {
            var payload = Object.assign({}, sale);
            delete payload.checkoutPendingUntil;
            return JSON.stringify(payload);
        })});
        assertIdentity(who);
        var sent = new Set(sales.map(function (sale) { return sale.offlineId; }));
        var acknowledged = new Set((Array.isArray(result.syncedIds) ? result.syncedIds : []).filter(function (id) {
            return sent.has(id);
        }));
        if (acknowledged.size) {
            await write(function (tx) {
                acknowledged.forEach(function (id) { tx.objectStore('queue').delete(id); });
            });
            window.dispatchEvent(new Event('posofflinesynced'));
            if (window._posOffline?.acknowledgeLegacy)
                await window._posOffline.acknowledgeLegacy(Array.from(acknowledged), sales);
        }
        return {acknowledged:acknowledged,failures:result.failures || []};
    }
    async function reconcile(request) {
        var who = identity();
        var sales = (await read('queue')).filter(function (sale) {
            return sale.sessionId === request.sessionId && sale.terminalId === request.terminalId &&
                (!sale.organizationPartyId || sale.organizationPartyId === who.organization) && (!sale.userId || sale.userId === who.user);
        });
        if (sales.length) {
            var ready = sales.filter(readyToSync);
            var result = ready.length ? await postSales(who, request.terminalId, ready) : {acknowledged:new Set(),failures:[]};
            var outstanding = sales.filter(function (sale) { return !result.acknowledged.has(sale.offlineId); });
            if (outstanding.length) {
                request.failures = {};
                result.failures.forEach(function (failure) {
                    var sale = ready[failure.index];
                    if (sale && !result.acknowledged.has(sale.offlineId)) request.failures[sale.offlineId] = failure.error;
                });
                request.error = result.failures.map(function (failure) { return failure.error; }).filter(Boolean).join(' ') || 'Saved bills are waiting to sync.';
                return;
            }
        }
        // A successful response may have been lost. Both import and close are idempotent on the server.
        assertIdentity(who);
        var closed = await post('closeSession', {sessionId:request.sessionId, closingCash:request.closingCash, wantJson:'1'});
        if (!closed.success) { request.error = closed.error || 'Session closure will retry automatically.'; return; }
        request.syncedAt = new Date().toISOString();
        delete request.error;
        delete request.failures;
    }
    async function flushOpenSales(who, closingSessions) {
        // The visible terminal syncs its own queue and updates its bill state. Other terminals
        // still sync automatically if the cashier moves to another screen, shop, or drawer.
        var currentTerminal = window._posOffline && document.querySelector('#cartInlineAddForm [name=posTerminalId]')?.value;
        var grouped = new Map();
        (await read('queue')).forEach(function (sale) {
            if (!sale || !sale.terminalId || !sale.sessionId || !sale.offlineId || !readyToSync(sale) ||
                sale.terminalId === currentTerminal || closingSessions.has(sale.sessionId) ||
                sale.organizationPartyId !== who.organization || sale.userId !== who.user) return;
            if (!grouped.has(sale.terminalId)) grouped.set(sale.terminalId, []);
            grouped.get(sale.terminalId).push(sale);
        });
        for (var group of grouped) {
            assertIdentity(who);
            try { await postSales(who, group[0], group[1]); }
            catch (error) { /* keep this terminal's queue for the next reachable attempt */ }
        }
    }
    function syncSession(who, sessionId) {
        var lockName = 'zenith-pos-close-session:' + JSON.stringify([who.organization,who.user,sessionId]);
        if (sessionWork.has(lockName)) return sessionWork.get(lockName);
        async function sync() {
            assertIdentity(who);
            // Another tab may have finished this request while we waited for its lock.
            var request = await get(sessionId);
            if (!request || request.syncedAt || request.organizationPartyId !== who.organization || request.userId !== who.user) return;
            try { await reconcile(request); }
            catch (error) { request.error = error.message; }
            assertIdentity(who);
            await write(function (tx) { tx.objectStore('state').put({key:key(sessionId), value:request}); });
            notify(request);
            return request;
        }
        var work = (navigator.locks ? navigator.locks.request(lockName, sync) : sync())
            .finally(function () { sessionWork.delete(lockName); });
        sessionWork.set(lockName, work);
        return work;
    }
    async function process() {
        var who = identity();
        if (!who || !navigator.onLine) return;
        var rows = await read('state', IDBKeyRange.bound('session-close:', 'session-close:\uffff'));
        var closingSessions = new Set(), needsRetry = false;
        for (var row of rows) {
            var request = row.value;
            if (!row.key.startsWith('session-close:') || !request || request.syncedAt ||
                request.organizationPartyId !== who.organization || request.userId !== who.user) continue;
            closingSessions.add(request.sessionId);
            var pendingClose = await syncSession(who, request.sessionId);
            if (pendingClose && !pendingClose.syncedAt) needsRetry = true;
        }
        await flushOpenSales(who, closingSessions);
        if (needsRetry) {
            if (!retryTimer) {
                retryTimer = setTimeout(function () { retryTimer = null; flush(); }, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 60000);
            }
        } else {
            clearTimeout(retryTimer);
            retryTimer = null;
            retryDelay = 5000;
        }
    }
    function flush() {
        var who = identity();
        if (!who || !navigator.onLine) return Promise.resolve();
        if (running) return running;
        var work = navigator.locks ? navigator.locks.request('zenith-pos-close:' + who.organization + ':' + who.user, process) : process();
        running = work.catch(function () {}).finally(function () { running = null; });
        return running;
    }
    async function prepareOpen(terminalId) {
        var who = identity();
        if (!who) throw Error('Sign in to open this counter.');
        var pending = (await read('state', IDBKeyRange.bound('session-close:', 'session-close:\uffff')))
            .map(function (row) { return row.value; }).filter(function (request) {
                return request && request.terminalId === terminalId && !request.syncedAt &&
                    request.organizationPartyId === who.organization && request.userId === who.user;
            });
        assertIdentity(who);
        if (!pending.length) return;
        if (!navigator.onLine) throw Error('Reconnect to finish closing the previous session before opening this counter. Your saved bills are retained.');
        for (var request of pending) {
            var state = await post('touchSession', {sessionId:request.sessionId,activity:'N'});
            if (!state.success) throw Error('The previous session could not be checked. Please retry.');
            if (state.open === false) continue;
            // Reconcile just this counter, without waiting for other counters' background retries.
            await syncSession(who, request.sessionId);
            state = await post('touchSession', {sessionId:request.sessionId,activity:'N'});
            if (!state.success || state.open !== false) {
                var remaining = await get(request.sessionId);
                throw Error('The previous session could not finish closing. Your saved bills are retained. ' +
                    (remaining?.error || 'Please retry once the connection is available.'));
            }
        }
        assertIdentity(who);
        flush();
    }
    window.PosDeferredClose = {get:get, save:save, flush:flush, prepareOpen:prepareOpen};
    var openingForms = new WeakSet(), approvedForms = new WeakSet();
    document.addEventListener('submit', function (event) {
        var form = event.target;
        if (form.id !== 'OpenSessionForm' || !new URL(form.action, location.href).pathname.endsWith('/pos/Terminal/openSession')) return;
        if (approvedForms.delete(form)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (openingForms.has(form)) return;
        openingForms.add(form);
        var button = event.submitter || form.querySelector('button[type="submit"]');
        var status = form.querySelector('[data-pos-open-status]');
        if (!status) {
            status = document.createElement('p'); status.dataset.posOpenStatus = '';
            status.setAttribute('role','status'); form.append(status);
        }
        status.style.color = '#64748b'; status.textContent = 'Opening terminal…';
        if (button) button.disabled = true;
        prepareOpen(new FormData(form).get('terminalId')).then(function () {
            if (!form.isConnected) return;
            approvedForms.add(form);
            if (button) button.disabled = false;
            form.requestSubmit(button || undefined);
        }).catch(function (error) {
            status.style.color = '#c62828'; status.textContent = error.message;
        }).finally(function () {
            openingForms.delete(form);
            if (button) button.disabled = false;
        });
    }, true);
    var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('zenith-pos-session-close') : null;
    function notify(request) {
        window.dispatchEvent(new CustomEvent('possessionclosed', {detail:request}));
        if (channel) channel.postMessage(request);
    }
    if (channel) channel.onmessage = function (event) {
        var who = identity(), request = event.data;
        if (who && request && request.organizationPartyId === who.organization && request.userId === who.user)
            window.dispatchEvent(new CustomEvent('possessionclosed', {detail:request}));
    };
    window.addEventListener('online', flush);
    window.addEventListener('pageshow', flush);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
    setInterval(flush, 30000);
    setTimeout(flush, 2000);
})();
