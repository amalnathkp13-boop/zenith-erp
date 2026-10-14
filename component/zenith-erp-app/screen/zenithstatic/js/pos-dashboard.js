/* POS reference dashboard controls, including Quasar screen replacements. */
(function () {
    'use strict';
    var initialized = new WeakSet();
    function boot() {
        document.querySelectorAll('.pos-dash-v2 .pos-dash-chart-controls').forEach(function (form) {
            if (initialized.has(form)) return;
            var interval = form.querySelector('[name="chartMode"]');
            var range = form.querySelector('.pos-dash-chart-range');
            if (!interval || !range) return;
            initialized.add(form);
            interval.addEventListener('change', function () { form.requestSubmit(); });
            form.addEventListener('submit', function () {
                if (form.elements.dashDate.value !== form.elements.dashDate.defaultValue ||
                        form.elements.dashDateTo.value !== form.elements.dashDateTo.defaultValue) {
                    form.elements.dateMode.value = 'custom';
                }
            });
            form.addEventListener('keydown', function (event) {
                if (event.key === 'Escape' && range.open) {
                    range.open = false; range.querySelector('summary').focus();
                }
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    new MutationObserver(boot).observe(document.documentElement, { childList: true, subtree: true });
})();
