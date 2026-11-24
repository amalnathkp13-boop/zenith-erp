/* Keeps optional quote fields available without crowding the party selection. */
(function () {
    'use strict';
    if (window.zenithQuoteCreateLoaded) return;
    window.zenithQuoteCreateLoaded = true;

    function enhance() {
        var form = document.getElementById('CreateQuoteForm');
        if (!form || form.querySelector('.zqc-options-toggle')) return;
        var layout = form.querySelector(':scope > fieldset') || form;
        var rows = Array.from(layout.children).filter(function (child) { return child.classList.contains('row'); });
        if (rows.length < 4) return;
        rows[1].classList.add('zqc-advanced-row');
        rows[2].classList.add('zqc-advanced-row');
        rows[1].id = 'zqc-quote-options-1';
        rows[2].id = 'zqc-quote-options-2';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'zqc-options-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'zqc-quote-options-1 zqc-quote-options-2');
        toggle.innerHTML = '<span>More options</span><span class="material-icons zqc-options-chevron" aria-hidden="true">expand_more</span>';
        toggle.addEventListener('click', function () {
            var expanded = toggle.getAttribute('aria-expanded') !== 'true';
            toggle.setAttribute('aria-expanded', String(expanded));
            layout.dataset.advanced = String(expanded);
        });
        rows[0].after(toggle);
        layout.dataset.advanced = 'false';
    }

    var pending = false;
    new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; enhance(); });
    }).observe(document.body, {childList:true,subtree:true});
    enhance();
})();
