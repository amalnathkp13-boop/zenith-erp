/* Reserve the measured wrapped header only while an Purchase operations screen is rendered. */
(function () {
  function start() {
    if (!document.body || window.zpurHeaderObserver) return;
    window.zpurHeaderObserver = true;
    var quoteTimer;
    var latestQuote = 0;
    document.addEventListener('input', function (event) {
        var form = event.target.closest('#AddItemForm[data-quote-url]');
        if (!form) return;
        var fields = form.elements;
        var price = fields.namedItem('unitAmount');
        var useCatalog = fields.namedItem('useCatalogPrice');
        var status = form.querySelector('#po-price-status');
        if (event.target === price) {
            useCatalog.value = price.value ? 'false' : 'true';
            status.textContent = price.value ? 'Manual unit price' : 'The configured price will be checked when you add the item.';
            latestQuote++;
            return;
        }
        if (event.target.name !== 'productId' && event.target.name !== 'quantity') return;
        var productId = fields.namedItem('productId').value;
        var quantity = fields.namedItem('quantity').value;
        var requestId = ++latestQuote;
        clearTimeout(quoteTimer);
        price.value = '';
        useCatalog.value = 'true';
        if (!productId || Number(quantity) <= 0) {
            status.textContent = 'Select a product and enter a positive quantity.';
            return;
        }
        status.textContent = 'Looking up the unit price…';
        quoteTimer = setTimeout(async function () {
            var params = new URLSearchParams({ orderId: fields.namedItem('orderId').value, productId: productId, quantity: quantity });
            try {
                var response = await fetch(form.dataset.quoteUrl + '?' + params);
                if (!response.ok) throw new Error('Price lookup failed');
                var quote = await response.json();
                if (requestId !== latestQuote || !form.isConnected) return;
                price.value = quote.unitAmount ?? '';
                var formatted = quote.unitAmount == null ? '' : new Intl.NumberFormat('en-IN', {
                    style: 'currency', currency: quote.currency, maximumFractionDigits: 6
                }).format(Number(quote.unitAmount));
                status.textContent = formatted ? quote.source + ' · ' + formatted : 'No configured price for this quantity. Enter a unit price.';
            } catch (error) {
                if (requestId === latestQuote && form.isConnected)
                    status.textContent = 'Price preview unavailable. The configured price will be checked when you add the item.';
            }
        }, 160);
    });
    var watchedHeader = null, headerObserver = null, pending = false;
    function sync() {
        pending = false;
        document.body.classList.toggle('zpur-module', /^\/(?:apps|qapps)\/zenith\/Purchase(?:\/|$)/.test(location.pathname));
        var header = document.querySelector('.q-header');
        if (header !== watchedHeader) {
            if (headerObserver) headerObserver.disconnect();
            watchedHeader = header;
            if (header && window.ResizeObserver) {
                headerObserver = new ResizeObserver(schedule);
                headerObserver.observe(header);
            }
        }
        if (header && document.querySelector('.zpur-page')) {
            document.body.style.setProperty('--zq-pur-header-height', (header.offsetHeight || 51) + 'px');
        } else {
            document.body.style.removeProperty('--zq-pur-header-height');
        }
    }
    function schedule() {
        if (!pending) { pending = true; window.requestAnimationFrame(sync); }
    }
    new MutationObserver(schedule).observe(document.body, { childList:true, subtree:true });
    window.addEventListener('resize', schedule);
    window.addEventListener('popstate', schedule);
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
