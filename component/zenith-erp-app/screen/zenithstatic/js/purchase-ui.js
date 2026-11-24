/* Purchase-only adapters for native read controls. No fetch, submit or business writes. */
(function () {
    'use strict';
    if (window.zenithPurchaseUiLoaded) return;
    window.zenithPurchaseUiLoaded = true;
    var openedContactPo = '';
    function enhance() {
        var contactPo = location.pathname.endsWith('/Purchase/FindPurchaseOrder') && new URLSearchParams(location.search).get('openCreate') === 'Y' ? location.href : '';
        if (!contactPo) openedContactPo = '';
        if (contactPo && contactPo !== openedContactPo) {
            var newPoButton = document.querySelector('#po-header button');
            if (newPoButton) {
                openedContactPo = contactPo;
                var cleanUrl = new URL(location.href);
                cleanUrl.searchParams.delete('openCreate');
                history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
                document.title = document.title.replace('(Y, ', '(');
                newPoButton.click();
            }
        }
        if (location.pathname.endsWith('/Purchase/FindPurchaseOrder')) {
            document.querySelectorAll('.zc-purchase-page a[href*="openCreate=Y"]').forEach(function (link) {
                var url = new URL(link.href);
                url.searchParams.delete('openCreate');
                link.href = url.href;
            });
        }
        document.querySelectorAll('.zc-purchase-page .z-listchrome.zlc-on').forEach(function (card) {
            var toolbar = card.querySelector('.zlc-toolbar');
            if (!toolbar) return;
            var search = toolbar.querySelector('.zlc-search input');
            if (search && search.getAttribute('aria-label') !== 'Search loaded rows') {
                search.placeholder = 'Search this page…';
                search.setAttribute('aria-label', 'Search loaded rows');
                search.title = 'Searches loaded rows. Use Filters to search all records.';
            }
            var nativeFilter = Array.from(card.querySelectorAll('tr.form-list-nav-row button, tr.form-list-nav-row a')).find(function (element) {
                return /Find\s*Options/.test(element.textContent);
            });
            // Shared chrome calls Find Options "Saved Finds" when saving is unavailable.
            // Reuse that read-control proxy with its real name instead of offering duplicate filters.
            var nativeSaved = Array.from(card.querySelectorAll('tr.form-list-nav-row button, tr.form-list-nav-row a')).some(function (element) {
                return /Saved\s*Finds/i.test(element.textContent);
            });
            var savedProxy = Array.from(toolbar.querySelectorAll('button')).find(function (element) {
                return /Saved\s*Finds/i.test(element.textContent);
            });
            if (nativeFilter && savedProxy && !nativeSaved) {
                savedProxy.textContent = 'Filters';
                savedProxy.classList.add('zc-purchase-filter');
            }
            if (nativeFilter && !toolbar.querySelector('.zc-purchase-filter')) {
                var filter = document.createElement('button');
                filter.type = 'button';
                filter.className = 'zlc-btn zc-purchase-filter';
                filter.textContent = 'Filters';
                filter.addEventListener('click', function () { nativeFilter.click(); });
                toolbar.insertBefore(filter, search ? search.parentElement.nextSibling : toolbar.firstChild);
            }
            card.querySelectorAll('.zlc-pg').forEach(function (button) {
                var unavailable = button.classList.contains('zlc-dis');
                if (button.disabled !== unavailable) button.disabled = unavailable;
                var icon = button.querySelector('.material-icons');
                var names = {first_page:'First page',chevron_left:'Previous page',chevron_right:'Next page',last_page:'Last page'};
                if (icon && names[icon.textContent]) button.setAttribute('aria-label', names[icon.textContent]);
            });
            // On a single page Moqui may render more rows than the shared toolbar's fallback size.
            // Display the observed result honestly; selecting a numeric size still uses its native handler.
            var size = card.querySelector('.zlc-pp');
            if (size && !/[?&]pageSize=\d+/.test(location.search)) {
                var rows = card.querySelectorAll('.q-table .tbody > .tr, table > tbody > tr').length;
                if (rows > Number(size.value) && !size.querySelector('[data-purchase-observed]')) {
                    var option = document.createElement('option');
                    option.value = 'observed'; option.textContent = rows + ' shown';
                    option.disabled = true; option.dataset.purchaseObserved = 'true';
                    size.appendChild(option); size.value = option.value;
                }
            }
        });
    }
    var pending = false;
    var observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; enhance(); });
    });
    observer.observe(document.body, {childList:true,subtree:true});
    enhance();
})();
