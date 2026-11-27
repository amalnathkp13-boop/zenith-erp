/* Shops only: native POSTs retain Moqui's validation/errors and work on both shells. */
(function () {
    'use strict';
    window.zcShopsInit = function () {
        var root = document.querySelector('.zc-shops-page');
        if (!root || root.dataset.initialized) return;
        root.dataset.initialized = 'true';
        // The narrow Quasar toolbar wraps; keep content below its measured height.
        if (window.zcShopsHeaderObserver) window.zcShopsHeaderObserver.disconnect();
        var header = document.querySelector('body.zq-nav .q-header');
        if (header) {
            var syncHeader = function () {
                if (root.isConnected) document.body.style.setProperty('--zq-shops-header-height', header.offsetHeight + 'px');
                else {
                    if (window.zcShopsHeaderObserver === headerObserver) document.body.style.removeProperty('--zq-shops-header-height');
                    if (headerObserver) headerObserver.disconnect();
                }
            };
            var headerObserver = window.ResizeObserver ? new ResizeObserver(syncHeader) : null;
            window.zcShopsHeaderObserver = headerObserver;
            syncHeader();
            if (headerObserver) headerObserver.observe(header);
        }

        if (!document.getElementById('zc-shops-css')) {
            var css = document.createElement('link');
            css.id = 'zc-shops-css'; css.rel = 'stylesheet'; css.href = '/zenithstatic/css/shops.css?v=6';
            document.head.appendChild(css);
        }
        var value = function (id) { var e = root.querySelector('#' + id); return e ? e.value : ''; };
        var token = function () { return value('st-token') || value('ns-token'); };
        var post = function (name, pairs) {
            if (root.dataset.submitting) return;
            var form = document.createElement('form');
            form.method = 'post'; form.action = location.pathname.replace(/\/$/, '') + '/' + name;
            pairs.push(['moquiSessionToken', token()]);
            pairs.forEach(function (pair) {
                var input = document.createElement('input'); input.type = 'hidden'; input.name = pair[0]; input.value = pair[1] == null ? '' : pair[1]; form.appendChild(input);
            });
            root.dataset.submitting = 'true'; root.appendChild(form); form.submit();
        };
        var storeId = function () { return value('st-id'); };
        window.stTab = function (name) {
            ['details', 'counters', 'hours', 'targets', 'holidays'].forEach(function (tab) {
                var b = root.querySelector('#tab-' + tab), panel = root.querySelector('#panel-' + tab), on = tab === name;
                if (b) { b.style.color = on ? '#7C3AED' : '#6B7280'; b.style.borderBottomColor = on ? '#7C3AED' : 'transparent'; b.setAttribute('aria-pressed', String(on)); }
                if (panel) panel.style.display = on ? 'block' : 'none';
            });
        };
        window.stToggleDay = function (button) {
            var closed = button.classList.toggle('on'); button.setAttribute('aria-checked', String(closed));
            button.closest('.st-hrow').querySelectorAll('.st-htime').forEach(function (input) { input.disabled = closed; input.style.opacity = closed ? '.5' : '1'; });
        };
        window.stSave = function () {
            var invalid = Array.from(root.querySelectorAll('#panel-details input, #panel-hours input')).find(function (e) { return !e.checkValidity(); });
            if (invalid) { window.stTab(invalid.closest('#panel-hours') ? 'hours' : 'details'); invalid.reportValidity(); return; }
            var pairs = [['storeId', storeId()]];
            ['name|storeName', 'type|storeTypeEnumId', 'facility|facilityId', 'manager|managerPartyId', 'status|statusId', 'address|address', 'city|city', 'phone|phone', 'email|email', 'area|areaSqFt'].forEach(function (entry) {
                var fields = entry.split('|'); pairs.push([fields[1], value('st-' + fields[0])]);
            });
            root.querySelectorAll('.st-hrow').forEach(function (row) {
                var times = row.querySelectorAll('.st-htime');
                pairs.push(['hDay', row.dataset.day], ['hOpen', times[0].value], ['hClose', times[1].value], ['hClosed', row.querySelector('.st-tgl').classList.contains('on') ? 'Y' : 'N']);
            });
            post('saveStoreProfile', pairs);
        };
        window.stAssign = function (id) { post('assignCounter', [['storeId', storeId()], ['terminalId', id]]); };
        window.stAddTarget = function () {
            if (!value('tg-from') || !value('tg-to')) { alert('From and To dates are required.'); return; }
            post('setTarget', [['storeId', storeId()], ['targetPeriodEnumId', value('tg-period')], ['periodStart', value('tg-from')], ['periodEnd', value('tg-to')], ['salesTarget', value('tg-amt')]]);
        };
        window.stAddHol = function () {
            if (!value('hl-date')) { alert('Date is required.'); return; }
            post('addHoliday', [['storeId', storeId()], ['holidayDate', value('hl-date')], ['description', value('hl-reason')]]);
        };
        window.stDelete = function () {
            if (confirm('Delete this store and its schedule, targets and holidays? An in-use facility cannot be deleted. This cannot be undone.')) post('deleteStore', [['storeId', storeId()]]);
        };
        root.querySelectorAll('form').forEach(function (form) {
            // Quasar fetches .qvt content through /apps, even while its visible URL is /qapps.
            // Native forms must post through the visible shell, like the generated edit POSTs.
            var action = form.getAttribute('action') || '', route = action.indexOf('/zenith/Stores/');
            if (route >= 0) form.action = location.pathname.split('/zenith/')[0] + action.slice(route);
            form.addEventListener('submit', function (event) {
                if (root.dataset.submitting) { event.preventDefault(); return; }
                root.dataset.submitting = 'true';
            });
        });
        // Shared list chrome filters only rendered rows; Enter performs a tenant-scoped server search.
        root.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' || !event.target.matches('.zlc-search input')) return;
            event.preventDefault();
            var url = new URL(location.href), search = event.target.value.trim();
            url.searchParams.delete('pageIndex');
            if (search) { url.searchParams.set('storeName', search); url.searchParams.set('storeName_op', 'contains'); url.searchParams.set('storeName_ic', 'Y'); }
            else { ['storeName', 'storeName_op', 'storeName_ic'].forEach(function (key) { url.searchParams.delete(key); }); }
            location.href = url.toString();
        });
        var canWrite = root.querySelector('[data-shop-can-write]');
        if (canWrite && canWrite.dataset.shopCanWrite !== 'true') {
            root.querySelectorAll('button[onclick]').forEach(function (button) {
                if (/stSave|stDelete|stAssign|stAddTarget|stAddHol|st-target-form|st-holiday-form/.test(button.getAttribute('onclick'))) button.hidden = true;
            });
            root.querySelectorAll('#panel-details input, #panel-details select, #panel-details textarea, #panel-hours input, #panel-hours button').forEach(function (input) { input.disabled = true; });
        }
    };
    window.zcShopsInit();
})();
