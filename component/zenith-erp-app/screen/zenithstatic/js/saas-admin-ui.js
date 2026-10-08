/* Keep the page below the actual native header after responsive reflow. */
(function () {
    function syncHeader() {
        var page = document.querySelector('.saas-plan-page');
        if (!page) return;
        var header = document.querySelector('.q-header');
        if (header) document.body.style.setProperty('--sap-header-height', header.offsetHeight + 'px');
        var endDate = page.querySelector('input[name="accessUntil"]');
        if (endDate) { endDate.max = '9998-12-31'; }
    }
    window.syncSaasAdminHeader = syncHeader;
    window.addEventListener('resize', syncHeader);
    var header = document.querySelector('.q-header');
    if (header && window.ResizeObserver) new ResizeObserver(syncHeader).observe(header);
    syncHeader();
})();
