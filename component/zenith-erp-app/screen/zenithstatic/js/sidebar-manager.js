/* Per-user sidebar customization for the two existing ZcERP shells. The rendered links
   remain the source of labels, icons, routes and section membership. */
(function () {
    'use strict';
    if (window.__zcSidebarManager) return;
    window.__zcSidebarManager = true;

    var side, scroll, links = [], allowed = [], saved = { version: 1, order: [], hidden: [] };
    var draft, trigger, veil, dialog, list, search, tabs, error, saveButton, busy = false;
    var currentTab = 'visible', dragId = null, previousFocus = null;
    var categoryClass, linkClass;

    function node(tag, className, text) {
        var n = document.createElement(tag);
        if (className) n.className = className;
        if (text != null) n.textContent = text;
        return n;
    }
    function icon(name) { return node('span', 'material-icons', name); }
    function button(label, cls, fn) {
        var b = node('button', cls, label);
        b.type = 'button'; b.addEventListener('click', fn); return b;
    }
    function normalize(raw) {
        var ids = links.map(function (x) { return x.id; });
        var unique = function (xs) {
            var seen = {};
            return (Array.isArray(xs) ? xs : []).filter(function (id) {
                if (typeof id !== 'string' || ids.indexOf(id) < 0 || allowed.indexOf(id) < 0 || seen[id]) return false;
                seen[id] = true; return true;
            });
        };
        return { version: 1, order: unique(raw && raw.order), hidden: unique(raw && raw.hidden) };
    }
    function clone(c) { return { version: 1, order: c.order.slice(), hidden: c.hidden.slice() }; }
    function dirty() { return JSON.stringify(draft) !== JSON.stringify(saved); }
    function eligible() { return links.filter(function (x) { return allowed.indexOf(x.id) >= 0; }); }
    function sectionItems(section) {
        return eligible().filter(function (x) { return x.section === section; });
    }
    function ordered(items, config) {
        return items.slice().sort(function (a, b) {
            var ai = config.order.indexOf(a.id), bi = config.order.indexOf(b.id);
            if (ai < 0) ai = links.indexOf(a) + links.length;
            if (bi < 0) bi = links.indexOf(b) + links.length;
            return ai - bi;
        });
    }
    function sections() {
        var out = [];
        eligible().forEach(function (x) { if (out.indexOf(x.section) < 0) out.push(x.section); });
        return out;
    }
    function applySidebar() {
        if (!side) return;
        links.forEach(function (x) {
            x.el.hidden = allowed.indexOf(x.id) < 0 || saved.hidden.indexOf(x.id) >= 0;
        });
        sections().forEach(function (section) {
            var group = ordered(sectionItems(section), saved);
            var heading = section ? [].slice.call(scroll.querySelectorAll('.' + categoryClass))
                .filter(function (h) { return h.textContent.trim() === section; })[0] : null;
            if (!heading) return;
            var after = heading.nextElementSibling;
            while (after && !after.classList.contains(categoryClass)) after = after.nextElementSibling;
            group.forEach(function (x) { scroll.insertBefore(x.el, after); });
        });
        [].slice.call(scroll.querySelectorAll('.' + categoryClass)).forEach(function (h) {
            var next = h.nextElementSibling, any = false;
            while (next && !next.classList.contains(categoryClass)) {
                if (next.classList.contains(linkClass) && !next.hidden && next.style.display !== 'none') any = true;
                next = next.nextElementSibling;
            }
            h.hidden = !any;
        });
    }
    function status(message) { error.textContent = message || ''; error.hidden = !message; }
    function activeItems() {
        return eligible().filter(function (x) {
            return (draft.hidden.indexOf(x.id) < 0) === (currentTab === 'visible');
        });
    }
    function setTab(name) {
        currentTab = name;
        render();
        var t = tabs.querySelector('[data-tab="' + name + '"]');
        if (t) t.focus();
    }
    function move(id, direction) {
        var x = links.filter(function (item) { return item.id === id; })[0];
        if (!x) return;
        var group = ordered(sectionItems(x.section).filter(function (item) {
            return draft.hidden.indexOf(item.id) < 0;
        }), draft);
        var at = group.indexOf(x), next = at + direction;
        if (next < 0 || next >= group.length) return;
        group.splice(at, 1); group.splice(next, 0, x);
        var other = draft.order.filter(function (key) {
            return !group.some(function (item) { return item.id === key; });
        });
        draft.order = other.concat(group.map(function (item) { return item.id; }));
        render();
        var focus = list.querySelector('[data-move="' + id + '"][data-direction="' + direction + '"]');
        if (focus) focus.focus();
    }
    function reorder(sourceId, targetId) {
        if (sourceId === targetId) return;
        var source = links.filter(function (x) { return x.id === sourceId; })[0];
        var target = links.filter(function (x) { return x.id === targetId; })[0];
        if (!source || !target || source.section !== target.section) return;
        var group = ordered(sectionItems(source.section).filter(function (x) {
            return draft.hidden.indexOf(x.id) < 0;
        }), draft);
        var from = group.indexOf(source), to = group.indexOf(target);
        if (from < 0 || to < 0) return;
        group.splice(from, 1); group.splice(to, 0, source);
        draft.order = draft.order.filter(function (key) {
            return !group.some(function (x) { return x.id === key; });
        }).concat(group.map(function (x) { return x.id; }));
        render();
    }
    function toggle(id) {
        var at = draft.hidden.indexOf(id);
        if (at < 0) draft.hidden.push(id);
        else draft.hidden.splice(at, 1);
        status('');
        render();
    }
    function render() {
        if (!dialog || !draft) return;
        var visibleCount = eligible().filter(function (x) { return draft.hidden.indexOf(x.id) < 0; }).length;
        var availableCount = eligible().length - visibleCount;
        [].slice.call(tabs.children).forEach(function (t) {
            var on = t.getAttribute('data-tab') === currentTab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
            t.textContent = (t.getAttribute('data-tab') === 'visible' ? 'Visible Modules (' + visibleCount + ')' : 'Available Modules (' + availableCount + ')');
        });
        list.innerHTML = '';
        var term = search.value.trim().toLocaleLowerCase();
        var matching = activeItems().filter(function (x) { return x.label.toLocaleLowerCase().indexOf(term) >= 0; });
        if (!matching.length) {
            var empty = node('div', 'zsm-empty');
            empty.appendChild(node('p', null, term ? 'No modules match your search.' :
                currentTab === 'visible' ? 'Your sidebar has no visible modules.' : 'All available modules are already in your sidebar.'));
            if (term) empty.appendChild(button('Clear search', 'zsm-link-button', function () { search.value = ''; render(); search.focus(); }));
            else if (currentTab === 'visible') empty.appendChild(button('Browse available modules', 'zsm-link-button', function () { setTab('available'); }));
            list.appendChild(empty);
            return;
        }
        sections().forEach(function (section) {
            var group = ordered(matching.filter(function (x) { return x.section === section; }), draft);
            if (!group.length) return;
            list.appendChild(node('h3', 'zsm-section', section));
            var ul = node('ul', 'zsm-list');
            group.forEach(function (x) {
                var li = node('li', 'zsm-row'); li.setAttribute('data-id', x.id);
                if (currentTab === 'visible') {
                    li.draggable = true;
                    li.addEventListener('dragstart', function (e) { dragId = x.id; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
                    li.addEventListener('dragover', function (e) {
                        var source = links.filter(function (item) { return item.id === dragId; })[0];
                        if (source && source.section === x.section) { e.preventDefault(); li.classList.add('is-drop-target'); }
                    });
                    li.addEventListener('dragleave', function () { li.classList.remove('is-drop-target'); });
                    li.addEventListener('drop', function (e) { e.preventDefault(); reorder(dragId, x.id); dragId = null; });
                    li.addEventListener('dragend', function () { dragId = null; li.classList.remove('is-dragging'); });
                    var handle = node('span', 'zsm-handle material-icons', 'drag_indicator');
                    handle.title = 'Drag to reorder within ' + section;
                    handle.setAttribute('aria-hidden', 'true'); li.appendChild(handle);
                }
                var tile = node('span', 'zsm-icon'); tile.appendChild(icon(x.icon)); li.appendChild(tile);
                var text = node('span', 'zsm-row-text'); text.appendChild(node('strong', null, x.label));
                li.appendChild(text);
                if (currentTab === 'visible') {
                    var controls = node('span', 'zsm-move');
                    [-1, 1].forEach(function (direction) {
                        var b = button('', 'zsm-move-button', function () { move(x.id, direction); });
                        b.appendChild(icon(direction < 0 ? 'arrow_upward' : 'arrow_downward'));
                        b.setAttribute('aria-label', 'Move ' + x.label + (direction < 0 ? ' up' : ' down') + ' within ' + section);
                        b.setAttribute('data-move', x.id); b.setAttribute('data-direction', direction);
                        var peers = ordered(sectionItems(x.section).filter(function (item) {
                            return draft.hidden.indexOf(item.id) < 0;
                        }), draft);
                        b.disabled = peers.indexOf(x) + direction < 0 || peers.indexOf(x) + direction >= peers.length;
                        controls.appendChild(b);
                    });
                    li.appendChild(controls);
                    var hide = button('', 'zsm-toggle is-on', function () { toggle(x.id); });
                    hide.setAttribute('role', 'switch'); hide.setAttribute('aria-checked', 'true');
                    hide.setAttribute('aria-label', 'Show ' + x.label + ' in sidebar');
                    hide.appendChild(node('span', 'zsm-toggle-dot')); li.appendChild(hide);
                } else {
                    li.appendChild(button('Add', 'zsm-add', function () { toggle(x.id); }));
                }
                ul.appendChild(li);
            });
            list.appendChild(ul);
        });
    }
    function close(force) {
        if (busy) return;
        if (!force && dirty() && !window.confirm('Discard your unsaved sidebar changes?')) return;
        dialog.remove(); veil.remove(); dialog = veil = null;
        [].slice.call(document.body.children).forEach(function (n) { if (n.__zsmInert) { n.inert = false; delete n.__zsmInert; } });
        document.body.classList.remove('zsm-open');
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function open() {
        if (dialog) return;
        previousFocus = document.activeElement;
        draft = clone(saved); currentTab = 'visible';
        veil = node('div', 'zsm-veil'); veil.addEventListener('click', function () { close(false); });
        dialog = node('section', 'zsm-dialog'); dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'zsm-title');
        dialog.setAttribute('aria-describedby', 'zsm-description');
        var head = node('header', 'zsm-header');
        var titles = node('div'); var h = node('h2', null, 'Customize Sidebar'); h.id = 'zsm-title'; titles.appendChild(h);
        var p = node('p', null, 'Add, remove or reorder modules in your sidebar'); p.id = 'zsm-description'; titles.appendChild(p); head.appendChild(titles);
        var x = button('', 'zsm-close', function () { close(false); }); x.appendChild(icon('close'));
        x.setAttribute('aria-label', 'Close sidebar settings'); head.appendChild(x); dialog.appendChild(head);
        var tools = node('div', 'zsm-tools');
        var searchWrap = node('label', 'zsm-search'); searchWrap.appendChild(icon('search'));
        search = node('input'); search.type = 'search'; search.placeholder = 'Search modules...';
        search.setAttribute('aria-label', 'Search modules'); search.addEventListener('input', render);
        searchWrap.appendChild(search); tools.appendChild(searchWrap);
        tabs = node('div', 'zsm-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sidebar module lists');
        ['visible','available'].forEach(function (name) {
            var tab = button('', 'zsm-tab', function () { setTab(name); }); tab.setAttribute('role', 'tab');
            tab.setAttribute('data-tab', name); tab.setAttribute('aria-controls', 'zsm-list'); tabs.appendChild(tab);
        });
        tabs.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(currentTab === 'visible' ? 'available' : 'visible'); }
        });
        tools.appendChild(tabs);
        tools.appendChild(node('p', 'zsm-help', 'Drag to reorder within a section • Use arrow buttons with a keyboard'));
        dialog.appendChild(tools);
        list = node('div', 'zsm-body'); list.id = 'zsm-list'; list.setAttribute('role', 'tabpanel');
        dialog.appendChild(list);
        error = node('p', 'zsm-error'); error.setAttribute('role', 'alert'); error.hidden = true; dialog.appendChild(error);
        var foot = node('footer', 'zsm-footer');
        foot.appendChild(button('Reset to default', 'zsm-reset', function () {
            if (window.confirm('Restore the default sidebar? Save changes to keep the reset.')) {
                draft = { version:1, order:[], hidden:[] }; status(''); render();
            }
        }));
        var actions = node('div', 'zsm-actions');
        actions.appendChild(button('Cancel', 'zsm-cancel', function () { close(true); }));
        saveButton = button('Save changes', 'zsm-save', save); actions.appendChild(saveButton);
        foot.appendChild(actions); dialog.appendChild(foot);
        document.body.appendChild(veil); document.body.appendChild(dialog);
        [].slice.call(document.body.children).forEach(function (n) {
            if (n !== veil && n !== dialog && !n.inert) { n.inert = true; n.__zsmInert = true; }
        });
        document.body.classList.add('zsm-open');
        dialog.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
            if (e.key !== 'Tab') return;
            var focusables = [].slice.call(dialog.querySelectorAll('button:not([disabled]),input:not([disabled])'));
            var first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        render(); search.focus();
    }
    function save() {
        if (busy) return;
        var clean = normalize(draft);
        if (clean.order.length !== draft.order.length || clean.hidden.length !== draft.hidden.length) {
            status('Some modules are no longer available. Reopen settings and try again.'); return;
        }
        busy = true; saveButton.disabled = true; saveButton.textContent = 'Saving…'; status('');
        var tok = document.getElementById('z-shopdata');
        var body = new URLSearchParams({ payload: JSON.stringify(clean), moquiSessionToken: tok ? tok.getAttribute('data-token') || '' : '' });
        fetch('/apps/zenith/saveSidebarConfiguration', {
            method:'POST', credentials:'same-origin',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8', 'Accept':'application/json' },
            body:body.toString()
        }).then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok || !data.saved) throw new Error(data.error || 'Could not save sidebar settings.');
                saved = clean; applySidebar(); busy = false; close(true);
            });
        }).catch(function (e) { status(e.message || 'Could not save sidebar settings. Please retry.'); })
            .finally(function () { busy = false; if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save changes'; } });
    }
    function build() {
        side = document.getElementById('z-sidebar') || document.getElementById('zq-sidebar');
        if (!side || side.querySelector('.zsm-entry')) return false;
        categoryClass = side.id === 'z-sidebar' ? 'zs-cat' : 'zqs-cat';
        linkClass = side.id === 'z-sidebar' ? 'zs-link' : 'zqs-link';
        scroll = side.querySelector(side.id === 'z-sidebar' ? '.zs-scroll' : '.zqs-scroll');
        if (!scroll) return false;
        var heading = '';
        [].slice.call(scroll.children).forEach(function (n) {
            if (n.classList.contains(categoryClass)) heading = n.textContent.trim();
            if (!n.classList.contains(linkClass)) return;
            var id = n.getAttribute('data-match');
            if (!id || id === '/__more' || id === '/saas-admin') return;
            links.push({ id:id, el:n, section:heading, label:(n.querySelector('.t') || n).textContent.trim(),
                icon:(n.querySelector('.material-icons') || {}).textContent || 'apps' });
        });
        var entry = button('', 'zsm-entry', open); entry.disabled = true;
        entry.appendChild(icon('tune')); entry.appendChild(node('span', 't', 'Manage Sidebar'));
        entry.setAttribute('aria-label', 'Manage Sidebar'); entry.title = 'Manage Sidebar';
        side.appendChild(entry); trigger = entry;
        fetch('/apps/zenith/getSidebarConfiguration', { credentials:'same-origin', headers:{ Accept:'application/json' } })
            .then(function (response) { if (!response.ok) throw new Error('Unable to load sidebar settings.'); return response.json(); })
            .then(function (data) {
                allowed = Array.isArray(data.allowedIds) ? data.allowedIds : [];
                var raw = {}; try { raw = JSON.parse(data.preference || '{}'); } catch (_e) {}
                saved = normalize(raw); applySidebar();
                entry.disabled = false; entry.title = 'Manage Sidebar';
            }).catch(function () {
                entry.title = 'Sidebar settings unavailable. Select to retry.';
                entry.disabled = false;
                entry.addEventListener('click', function retry(e) {
                    e.stopImmediatePropagation(); entry.removeEventListener('click', retry);
                    entry.disabled = true; entry.title = 'Loading sidebar settings';
                    side.removeChild(entry); links = []; build();
                }, true);
            });
        return true;
    }
    var attempts = 0, timer = setInterval(function () {
        if (build() || ++attempts > 80) clearInterval(timer);
    }, 150);
})();
