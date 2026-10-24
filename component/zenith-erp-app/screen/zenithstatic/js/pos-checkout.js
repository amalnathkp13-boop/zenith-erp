/* Reference billing layout only. Money, stock posting and payment gates stay in pos-terminal.js. */
(function () {
    'use strict';
    var root, observer, scheduled = false, noticeTimer, stockTimer, stockBusy = false;
    function notice(message) {
        var el = document.getElementById('pos-checkout-notice');
        if (!el) { el = document.createElement('div'); el.id = 'pos-checkout-notice'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
        el.textContent = message; clearTimeout(noticeTimer);
        noticeTimer = setTimeout(function () { el.remove(); }, 3500);
    }
    window.posShowNoHeld = function () { notice('No held bills in this session. Use Hold (F7) to save the current cart.'); };
    window.posCheckoutCopilot = function () {
        var button = document.getElementById('ai-copilot-toggle');
        if (button) button.click(); else notice('The assistant is not available in this workspace.');
    };
    function connection() {
        var el = document.getElementById('pos-connection-status');
        if (el) { el.textContent = navigator.onLine ? 'Online' : 'Offline'; el.parentElement.classList.toggle('is-offline', !navigator.onLine); }
    }
    function paint() {
        scheduled = false;
        root = document.querySelector('.pos-checkout-reference'); if (!root) return;
        // Disconnect while decorating, so changing a badge never starts a mutation loop.
        if (observer) observer.disconnect();
        var rows = root.querySelectorAll('.pos-cart tbody tr');
        var count = Array.from(rows).filter(function (row) { return row.querySelector('input,select,button,form'); }).length;
        var counter = document.getElementById('pos-cart-count'); if (counter) counter.textContent = String(count);
        var clear = document.getElementById('pos-clear-cart'); if (clear) clear.disabled = !count;
        root.querySelectorAll('.pos-cart .aj-p').forEach(function (input) { input.setAttribute('aria-label', 'Unit price'); });
        root.querySelectorAll('.pos-cart .aj-qi').forEach(function (input) { input.setAttribute('aria-label', 'Quantity'); });
        root.querySelectorAll('#cartScroll select').forEach(function (select) {
            var label = select.selectedOptions.length ? select.selectedOptions[0].textContent : '';
            select.dataset.priceKind = /whole/i.test(label) ? 'wholesale' : /custom/i.test(label) ? 'custom' : 'retail';
            select.setAttribute('aria-label', 'Sales mode');
        });
        root.querySelectorAll('.pos-cart .aj-q').forEach(function (button) { button.setAttribute('aria-label', button.textContent.trim() === '+' ? 'Increase quantity' : 'Decrease quantity'); });
        root.querySelectorAll('.pos-cart .aj-rm').forEach(function (button) { button.setAttribute('aria-label', 'Remove item'); if (!button.querySelector('svg')) button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>'; });
        root.querySelectorAll('.pos-cat-strip a').forEach(function (link) {
            var current = root.querySelector('#cartInlineAddForm input[name="catId"]');
            var category = root.dataset.checkoutCategory != null ? root.dataset.checkoutCategory : current ? current.value : new URL(location.href).searchParams.get('catId') || '';
            link.classList.toggle('is-selected', (new URL(link.href).searchParams.get('catId') || '') === category);
        });
        var close = root.querySelector('.nb-power');
        if (close && !close.querySelector('kbd')) { var key = document.createElement('kbd'); key.textContent = 'C'; close.appendChild(key); }
        if (observer) observer.observe(root, {childList:true, subtree:true});
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(paint); } }
    function search(open) {
        var panel = root.querySelector('.pos-cart-search'), input = document.getElementById('cartInlineSearch');
        if (!panel || !input) return;
        panel.classList.toggle('is-open', open);
        if (open) {
            var heading=root.querySelector('.pos-cart-heading').getBoundingClientRect();
            panel.style.top=Math.max(12,Math.min(heading.bottom+6,innerHeight-340))+'px';
            input.focus();
        }
    }
    function refreshStock() {
        if (!root || !root.isConnected || document.hidden || !navigator.onLine || stockBusy) return;
        var grid=root.querySelector('.pos-product-grid'); if (!grid) return;
        var bounds=grid.getBoundingClientRect(), top=Math.max(0,bounds.top), bottom=Math.min(innerHeight,bounds.bottom);
        if (bottom<=top) return;
        var cards = Array.from(grid.querySelectorAll('.pos-card-stock')).filter(function(card){var r=card.getBoundingClientRect();return r.bottom>=top&&r.top<=bottom;}).slice(0,120);
        var form = document.getElementById('cartInlineAddForm'); if (!cards.length || !form) return;
        var params = new URLSearchParams(); ['sessionId','moquiSessionToken'].forEach(function (name) { var input=form.elements.namedItem(name); if (input) params.set(name,input.value); });
        params.set('action','cardStock'); params.set('productIds',cards.slice(0,120).map(function (card) { return card.dataset.productId; }).join(','));
        stockBusy = true;
        fetch('Terminal/ajaxCart',{method:'POST',body:params,credentials:'same-origin'})
            .then(function (r) { if (!r.ok) throw new Error('Stock unavailable'); return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                cards.forEach(function (card) { var stock=data.stock[card.dataset.productId]; if (!stock || !card.isConnected) return;
                    card.textContent = !stock.tracked ? 'Stock: not tracked' : stock.quantity == null ? 'Stock: unavailable' : 'Stock: ' + Number(stock.quantity).toLocaleString('en-IN',{maximumFractionDigits:3});
                });
            }).catch(function () { /* Existing stock stays visible; checkout still validates authoritative stock. */ })
            .finally(function () { stockBusy = false; });
    }
    function boot() {
        root = document.querySelector('.pos-checkout-reference'); if (!root || root.dataset.checkoutBound) return;
        root.dataset.checkoutBound = '1';
        observer = new MutationObserver(schedule); paint(); connection();
        root.addEventListener('keydown',function(event){
            if(event.target.id==='cartInlineSearch' && (event.key==='Enter'||event.key==='Escape')) setTimeout(function(){search(false);},0);
        },true);
        root.addEventListener('click',function(event){
            if(event.target.closest('.cart-dd-item')) setTimeout(function(){search(false);},0);
        },true);
        root.addEventListener('click', function (event) {
            var category = event.target.closest('.pos-cat-strip a');
            if (category) { root.dataset.checkoutCategory = new URL(category.href).searchParams.get('catId') || ''; schedule(); }
            if (event.target.closest('#pos-clear-cart')) {
                if (typeof window._posClearCart !== 'function') { notice('The bill is still loading. Try again.'); return; }
                if (!confirm('Clear all items from this unpaid bill?')) return;
                var button = document.getElementById('pos-clear-cart'); button.disabled = true;
                window._posClearCart().then(function () { notice('Cart cleared.'); }).catch(function (error) { notice(error.message); }).finally(schedule);
            }
        });
        document.addEventListener('keydown', function (event) {
            var input = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
            var overlay = document.querySelector('[role="dialog"],#posCashTenderOverlay,#posPayConfirmOverlay,#pos-history-overlay,#posCustomerOverlay,#posCreditOverlay,#posCloseSessionOverlay');
            if (event.key === 'Escape') search(false);
            if (event.key === '/' && !input && !overlay) { event.preventDefault(); search(true); }
            if (event.target.id === 'cartInlineSearch' && event.key.length === 1) search(true);
        });
        root.addEventListener('input',function(event){ if(event.target.id==='cartInlineSearch' && event.target.value) search(true); });
        window.addEventListener('online',connection); window.addEventListener('offline',connection);
        document.addEventListener('visibilitychange',refreshStock);
        stockTimer = setInterval(function () { if (!root.isConnected) { clearInterval(stockTimer); observer.disconnect(); return; } refreshStock(); },30000);
        // Cart completion replaces the visible grid with server-rendered stock, so polling is only a fallback.
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot); else boot();
}());
