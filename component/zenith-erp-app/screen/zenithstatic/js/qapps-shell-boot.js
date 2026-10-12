/* Apply the loading state in the document head, before the stock Quasar shell can paint. */
(function () {
    if (location.pathname.indexOf('/qapps/zenith') !== 0) return;
    document.documentElement.classList.add('zq-shell-boot');
    // Leave the framework usable if the customized navigation fails to load.
    setTimeout(function () { document.documentElement.classList.remove('zq-shell-boot'); }, 7000);
})();
