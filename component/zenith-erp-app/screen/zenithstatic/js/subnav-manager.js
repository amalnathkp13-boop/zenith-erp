/* Per-user section navigation for both ZcERP shells. Rendered links remain the authority. */
(function () {
    'use strict';
    if (window.__zcSubnavManager) return;
    window.__zcSubnavManager = true;

    var current, cache = {}, drawer, veil, draft, previousFocus, busy = false;
    function el(tag, cls, label) {
        var item = document.createElement(tag);
        if (cls) item.className = cls;
        if (label != null) item.textContent = label;
        return item;
    }
    function button(label, cls, action) {
        var item = el('button', cls, label);
        item.type = 'button'; item.addEventListener('click', action); return item;
    }
    function icon(name) { return el('span', 'material-icons', name); }
    function normalize(raw, links, module) {
        var ids = links.map(function (link) { return link.id; });
        function unique(values) {
            var seen = {};
            return (Array.isArray(values) ? values : []).map(function (id) {
                if (module === 'kot' && typeof id === 'string' && id.indexOf('/pos/') === 0) {
                    var kotId = '/kot/' + id.slice('/pos/'.length);
                    if (ids.indexOf(kotId) >= 0) return kotId;
                }
                return id;
            }).filter(function (id) {
                if (ids.indexOf(id) < 0 || seen[id]) return false;
                seen[id] = true; return true;
            });
        }
        return { version: 1, order: unique(raw && raw.order), hidden: unique(raw && raw.hidden) };
    }
    function copy(value) { return { version: 1, order: value.order.slice(), hidden: value.hidden.slice() }; }
    function ordered(links, settings) {
        return links.slice().sort(function (a, b) {
            var ai = settings.order.indexOf(a.id), bi = settings.order.indexOf(b.id);
            return (ai < 0 ? a.index + links.length : ai) - (bi < 0 ? b.index + links.length : bi);
        });
    }
    function apply() {
        if (!current || !current.settings) return;
        var settings = normalize(current.settings, current.links, current.module);
        ordered(current.links, settings).forEach(function (link) {
            link.node.hidden = settings.hidden.indexOf(link.id) >= 0;
            current.strip.appendChild(link.node);
        });
        var selected = current.strip.querySelector(current.selector + '.on');
        if (selected) selected.scrollIntoView({ block:'nearest', inline:'nearest' });
    }
    function findBar() {
        var ssr = document.getElementById('z-subnav');
        if (ssr && ssr.classList.contains('show')) {
            var group = ssr.querySelector('.zsub-grp.show');
            if (group) return { bar:ssr, strip:group, module:group.getAttribute('data-match').slice(1), selector:'.zsub-tab' };
        }
        var spa = document.getElementById('zq-subnav');
        if (spa && spa.classList.contains('show') && spa.getAttribute('data-mod')) {
            var strip = spa.querySelector('.zsn-strip');
            if (!strip) {
                strip = el('div', 'zsn-strip');
                while (spa.firstChild) strip.appendChild(spa.firstChild);
                spa.appendChild(strip);
            }
            return { bar:spa, strip:strip, module:spa.getAttribute('data-mod'), selector:'.zqsub-tab' };
        }
        return null;
    }
    function refresh() {
        var view = findBar();
        if (view && current && current.strip === view.strip && current.module === view.module && current.trigger.isConnected) return;
        if (drawer) close(true);
        if (current) current.trigger.remove();
        current = null;
        if (!view) return;
        var links = [].slice.call(view.strip.querySelectorAll(view.selector)).filter(function (node) {
            return node.style.display !== 'none' && !!node.getAttribute('data-match');
        }).map(function (node, index) {
            return { id:node.getAttribute('data-match'), label:node.textContent.trim(), node:node, index:index };
        });
        if (!links.length) return;
        view.links = links; view.settings = cache[view.module] || null;
        current = view;
        var trigger = button('', 'zsn-trigger', open);
        trigger.appendChild(icon('tune'));
        trigger.setAttribute('aria-label', 'Customize ' + (view.strip.querySelector('.zsub-title,.zqsub-title') || {}).textContent + ' navigation');
        trigger.title = trigger.getAttribute('aria-label');
        trigger.disabled = !view.settings;
        view.bar.appendChild(trigger); view.trigger = trigger;
        if (view.settings) { apply(); return; }
        fetch('/apps/zenith/getSubnavConfiguration?module=' + encodeURIComponent(view.module), {
            credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json' }
        }).then(function (response) {
            if (!response.ok) throw new Error('Navigation settings could not be loaded.');
            return response.json();
        }).then(function (data) {
            if (data.error) throw new Error(data.error);
            var parsed = {};
            try { parsed = JSON.parse(data.preference || '{}'); } catch (_e) { /* invalid old preference: defaults */ }
            cache[view.module] = normalize(parsed, links, view.module);
            if (current === view) { view.settings = cache[view.module]; apply(); trigger.disabled = false; }
        }).catch(function () {
            if (current === view) {
                trigger.disabled = false;
                trigger.title = 'Navigation settings unavailable; select to retry';
                trigger.addEventListener('click', function retry(event) {
                    event.stopImmediatePropagation();
                    view.bar.removeChild(trigger); current = null; refresh();
                }, true);
            }
        });
    }
    function close(force) {
        if (!drawer || (busy && !force)) return;
        if (!force && JSON.stringify(draft) !== JSON.stringify(current.settings) &&
                !window.confirm('Discard unsaved navigation changes?')) return;
        drawer.remove(); veil.remove(); drawer = veil = null;
        document.body.classList.remove('zsn-open');
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function open() {
        if (!current || !current.settings || drawer || busy) return;
        previousFocus = document.activeElement;
        draft = copy(current.settings);
        veil = el('div', 'zsn-veil'); veil.addEventListener('click', function () { close(false); });
        drawer = el('section', 'zsn-drawer');
        drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-labelledby', 'zsn-title');
        var head = el('header', 'zsn-head');
        var heading = el('div');
        var title = el('h2', null, 'Customize ' + (current.strip.querySelector('.zsub-title,.zqsub-title') || {}).textContent + ' Navigation');
        title.id = 'zsn-title'; heading.appendChild(title);
        heading.appendChild(el('p', null, 'Choose which submodules appear and set their order for this workspace.'));
        head.appendChild(heading);
        var x = button('', 'zsn-close', function () { close(false); }); x.appendChild(icon('close'));
        x.setAttribute('aria-label', 'Close navigation settings'); head.appendChild(x); drawer.appendChild(head);
        var search = el('input', 'zsn-search'); search.type = 'search'; search.placeholder = 'Search submodules...';
        search.setAttribute('aria-label', 'Search submodules'); drawer.appendChild(search);
        var count = el('h3', 'zsn-count'); drawer.appendChild(count);
        var list = el('ul', 'zsn-list'); drawer.appendChild(list);
        var note = el('p', 'zsn-note', 'Hiding a submodule only removes it from this navigation. It does not delete data or change permissions.');
        drawer.appendChild(note);
        var error = el('p', 'zsn-error'); error.setAttribute('role', 'alert'); error.hidden = true; drawer.appendChild(error);
        var foot = el('footer', 'zsn-foot');
        var reset = button('Reset to default', 'zsn-reset', function () { draft = { version:1, order:[], hidden:[] }; render(); });
        foot.appendChild(reset);
        var actions = el('div', 'zsn-actions'); actions.appendChild(button('Cancel', 'zsn-cancel', function () { close(true); }));
        var save = button('Save changes', 'zsn-save', persist); actions.appendChild(save); foot.appendChild(actions);
        drawer.appendChild(foot);
        function render() {
            list.replaceChildren();
            count.textContent = 'Visible on top bar (' + (current.links.length - draft.hidden.length) + ')';
            var term = search.value.trim().toLocaleLowerCase();
            var matches = ordered(current.links, draft).filter(function (link) { return link.label.toLocaleLowerCase().indexOf(term) >= 0; });
            if (!matches.length) list.appendChild(el('li', 'zsn-empty', 'No submodules match your search.'));
            matches.forEach(function (link) {
                var row = el('li', 'zsn-row'); row.setAttribute('data-id', link.id); row.draggable = !term;
                var handle = icon('drag_indicator'); handle.className += ' zsn-handle';
                handle.setAttribute('aria-hidden', 'true'); row.appendChild(handle);
                row.appendChild(el('span', 'zsn-label', link.label));
                var moves = el('span', 'zsn-moves');
                [-1, 1].forEach(function (direction) {
                    var move = button('', 'zsn-move', function () {
                        var items = ordered(current.links, draft), at = items.indexOf(link), to = at + direction;
                        if (to < 0 || to >= items.length) return;
                        items.splice(at, 1); items.splice(to, 0, link);
                        draft.order = items.map(function (item) { return item.id; }); render();
                        var focus = list.querySelector('[data-id="' + link.id + '"] [data-direction="' + direction + '"]');
                        if (focus) focus.focus();
                    });
                    move.appendChild(icon(direction < 0 ? 'arrow_upward' : 'arrow_downward'));
                    move.setAttribute('aria-label', 'Move ' + link.label + (direction < 0 ? ' up' : ' down'));
                    move.setAttribute('data-direction', direction);
                    var at = ordered(current.links, draft).indexOf(link);
                    move.disabled = at + direction < 0 || at + direction >= current.links.length;
                    moves.appendChild(move);
                });
                row.appendChild(moves);
                var on = draft.hidden.indexOf(link.id) < 0;
                var toggle = button('', 'zsn-toggle' + (on ? ' is-on' : ''), function () {
                    draft.hidden = on ? draft.hidden.concat(link.id) : draft.hidden.filter(function (id) { return id !== link.id; });
                    render();
                });
                toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(on));
                toggle.setAttribute('aria-label', 'Show ' + link.label + ' in top navigation');
                toggle.appendChild(el('span', 'zsn-dot')); row.appendChild(toggle);
                row.addEventListener('dragstart', function (event) { event.dataTransfer.setData('text/plain', link.id); event.dataTransfer.effectAllowed = 'move'; });
                row.addEventListener('dragover', function (event) { if (!term) event.preventDefault(); });
                row.addEventListener('drop', function (event) {
                    event.preventDefault();
                    var source = event.dataTransfer.getData('text/plain'), items = ordered(current.links, draft);
                    var from = items.findIndex(function (item) { return item.id === source; });
                    var to = items.indexOf(link);
                    if (from < 0 || to < 0 || from === to) return;
                    items.splice(to, 0, items.splice(from, 1)[0]);
                    draft.order = items.map(function (item) { return item.id; }); render();
                });
                list.appendChild(row);
            });
        }
        function persist() {
            if (busy) return;
            busy = true; save.disabled = true; save.textContent = 'Saving...'; error.hidden = true;
            var view = current, panel = drawer, pending = copy(draft);
            var token = document.getElementById('z-shopdata');
            var form = new URLSearchParams({ module:view.module, payload:JSON.stringify(pending),
                moquiSessionToken:token ? token.getAttribute('data-token') || '' : '' });
            fetch('/apps/zenith/saveSubnavConfiguration', { method:'POST', credentials:'same-origin',
                headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8', Accept:'application/json' },
                body:form.toString() }).then(function (response) {
                return response.json().then(function (data) {
                    if (!response.ok || !data.saved) throw new Error(data.error || 'Could not save navigation settings.');
                    view.settings = pending; cache[view.module] = copy(pending);
                    if (current === view) apply();
                    busy = false; if (drawer === panel) close(true);
                });
            }).catch(function (failure) {
                error.textContent = failure.message || 'Could not save navigation settings. Please retry.';
                error.hidden = false;
            }).finally(function () { busy = false; save.disabled = false; save.textContent = 'Save changes'; });
        }
        search.addEventListener('input', render);
        drawer.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(false); }
            if (event.key !== 'Tab') return;
            var controls = [].slice.call(drawer.querySelectorAll('button:not([disabled]),input:not([disabled])'));
            var first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        document.body.appendChild(veil); document.body.appendChild(drawer);
        document.body.classList.add('zsn-open'); render(); search.focus();
    }
    document.addEventListener('zc:subnav-updated', refresh);
    var attempts = 0, timer = setInterval(function () {
        refresh();
        if (current || ++attempts > 80) clearInterval(timer);
    }, 150);
})();
