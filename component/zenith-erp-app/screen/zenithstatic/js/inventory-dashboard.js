/* Inventory charts fit through CSS immediately; redraw axes once resizing settles. */
(function () {
    'use strict';
    window.zInventoryChart = function (img, draw) {
        var details = img.closest('.inv-additional');
        function render() {
            if (!img.isConnected || (details && !details.open)) return;
            if (details) details.removeEventListener('toggle', render);
            if (details && window.IntersectionObserver) {
                var visible = new IntersectionObserver(function (entries) {
                    if (!img.isConnected) { visible.disconnect(); return; }
                    if (entries.some(function (entry) { return entry.isIntersecting; })) {
                        visible.disconnect();
                        window.zChart(img, draw);
                    }
                });
                visible.observe(img.previousElementSibling || details);
            } else window.zChart(img, draw);
        }
        if (details && !details.open) details.addEventListener('toggle', render);
        else render();
    };
    window.zInventoryFitChart = function (el, options) {
        if (!el || el.dataset.inventoryChart) return;
        el.dataset.inventoryChart = 'ready';
        options.chart = Object.assign({}, options.chart, {
            width: el.clientWidth, animations: { enabled: false },
            redrawOnWindowResize: false, redrawOnParentResize: false
        });
        var chart = new ApexCharts(el, options), width = el.clientWidth;
        var timer = 0, busy = true, disposed = false, observer, visibility;
        function fitSvg() {
            var svg = el.querySelector('.apexcharts-svg');
            if (svg) {
                svg.setAttribute('viewBox', '0 0 ' + svg.getAttribute('width') + ' ' + svg.getAttribute('height'));
                svg.setAttribute('preserveAspectRatio', 'none');
            }
        }
        function resize() {
            timer = 0;
            if (!el.isConnected) {
                disposed = true;
                if (observer) observer.disconnect();
                if (visibility) visibility.disconnect();
                chart.destroy();
                return;
            }
            var next = el.clientWidth;
            if (busy || next <= 0 || next === width) return;
            var rect = el.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) return;
            width = next;
            busy = true;
            chart.updateOptions({ chart: { width: next } }, false, false, false).then(function () {
                fitSvg();
                busy = false;
                if (el.clientWidth !== width) schedule();
            });
        }
        function schedule() {
            if (disposed) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(resize, 120);
        }
        chart.render().then(function () { fitSvg(); busy = false; if (el.clientWidth !== width) schedule(); });
        if (window.ResizeObserver) {
            observer = new ResizeObserver(schedule);
            observer.observe(el);
        }
        if (window.IntersectionObserver) {
            visibility = new IntersectionObserver(function (entries) {
                if (!el.isConnected || entries.some(function (entry) { return entry.isIntersecting; })) schedule();
            });
            visibility.observe(el);
        }
        return chart;
    };
})();
