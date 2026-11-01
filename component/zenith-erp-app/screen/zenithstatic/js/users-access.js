(function () {
    'use strict';
    window.zInitRoleEditor = function () {
        var form = document.getElementById('z-role-editor');
        if (!form || form.dataset.ready) return;
        form.dataset.ready = 'true';
        var catalogue, saved;
        var error = form.querySelector('#z-role-error');
        try { catalogue = JSON.parse(form.dataset.catalogue); saved = JSON.parse(form.dataset.draft); }
        catch (_) { error.textContent = 'Role details could not be loaded. Reload this page.'; return; }
        var enabled = new Set(), selected = {}, active = null, changed = false;
        catalogue.forEach(function (mod) {
            var valid = new Set(mod.screens.map(function (s) { return s.id; }));
            selected[mod.id] = new Set((Array.isArray(saved[mod.id]) ? saved[mod.id] : []).filter(function (id) { return valid.has(id); }));
            if (selected[mod.id].size) enabled.add(mod.id);
        });
        var modules = form.querySelector('#z-role-modules'), screens = form.querySelector('#z-role-screens');
        var allModules = form.querySelector('#z-role-all-modules'), allScreens = form.querySelector('#z-role-all-screens');
        var search = form.querySelector('#z-role-search'), input = form.querySelector('#z-role-selection');
        function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
        function draft() { var value = {}; catalogue.forEach(function (mod) { if (enabled.has(mod.id) && selected[mod.id].size) value[mod.id] = Array.from(selected[mod.id]); }); return value; }
        function update() {
            var count = 0; catalogue.forEach(function (mod) { if (enabled.has(mod.id)) count += selected[mod.id].size; });
            form.querySelector('#z-role-count').textContent = enabled.size + ' modules, ' + count + ' submodules selected';
            input.value = JSON.stringify(draft());
            allModules.checked = catalogue.length > 0 && enabled.size === catalogue.length;
            allModules.indeterminate = enabled.size > 0 && enabled.size < catalogue.length;
            var mod = catalogue.find(function (m) { return m.id === active; });
            allScreens.disabled = !mod || !enabled.has(active);
            allScreens.checked = !!mod && enabled.has(active) && selected[active].size === mod.screens.length;
            allScreens.indeterminate = !!mod && selected[active].size > 0 && selected[active].size < mod.screens.length;
            form.querySelector('#z-role-save').disabled = false;
        }
        function showScreens() {
            screens.replaceChildren();
            var mod = catalogue.find(function (m) { return m.id === active; });
            form.querySelector('#z-role-module-title').textContent = mod ? mod.name + ' submodules' : 'Submodules';
            form.querySelector('#z-role-instruction').hidden = !!mod;
            var term = form.querySelector('#z-role-screen-search').value.trim().toLowerCase();
            if (mod) mod.screens.filter(function (screen) { return screen.name.toLowerCase().includes(term); }).forEach(function (screen) {
                var label = node('label', 'z-role-screen'), box = node('input'); box.type = 'checkbox'; box.checked = selected[mod.id].has(screen.id);
                box.disabled = !enabled.has(mod.id);
                box.addEventListener('change', function () { changed = true; enabled.add(mod.id); if (box.checked) selected[mod.id].add(screen.id); else selected[mod.id].delete(screen.id); showModules(); update(); });
                label.append(box, node('span', null, screen.name)); screens.appendChild(label);
            });
            update();
        }
        function showModules() {
            modules.replaceChildren();
            catalogue.filter(function (mod) { return (mod.name + ' ' + mod.description).toLowerCase().includes(search.value.trim().toLowerCase()); }).forEach(function (mod) {
                var row = node('div', 'z-role-module'), box = node('input'), label = node('label');
                box.type = 'checkbox'; box.id = 'role-module-' + mod.id; box.checked = enabled.has(mod.id);
                box.addEventListener('change', function () { changed = true; if (box.checked) enabled.add(mod.id); else { enabled.delete(mod.id); selected[mod.id].clear(); } showModules(); showScreens(); });
                label.htmlFor = box.id; label.append(node('span', null, mod.name), node('small', null, mod.description), node('small', null, selected[mod.id].size + ' of ' + mod.screens.length + ' selected'));
                var customize = node('button', 'z-users-button', 'Customize'); customize.type = 'button'; customize.disabled = !enabled.has(mod.id);
                customize.addEventListener('click', function () { active = mod.id; showScreens(); });
                row.append(box, label, customize); modules.appendChild(row);
            });
            if (!modules.children.length) modules.appendChild(node('p', 'z-users-help', 'No modules match your search.'));
        }
        search.addEventListener('input', showModules);
        form.querySelector('#z-role-screen-search').addEventListener('input', showScreens);
        allModules.addEventListener('change', function () { changed = true; catalogue.forEach(function (mod) { if (allModules.checked) enabled.add(mod.id); else { enabled.delete(mod.id); selected[mod.id].clear(); } }); showModules(); showScreens(); });
        allScreens.addEventListener('change', function () { if (!active || !enabled.has(active)) return; changed = true; var mod = catalogue.find(function (m) { return m.id === active; }); selected[active] = new Set(allScreens.checked ? mod.screens.map(function (s) { return s.id; }) : []); showModules(); showScreens(); });
        form.querySelector('#z-role-reset').addEventListener('click', function () { if (!window.confirm('Clear all module and submodule selections in this draft?')) return; changed = true; enabled.clear(); catalogue.forEach(function (mod) { selected[mod.id].clear(); }); showModules(); showScreens(); });
        form.querySelector('#z-role-cancel').addEventListener('click', function (event) { if (changed && !window.confirm('Discard unsaved role changes?')) event.preventDefault(); });
        form.addEventListener('input', function () { changed = true; });
        var saving = false;
        form.addEventListener('submit', function (event) {
            if (saving) { event.preventDefault(); return; }
            update(); error.textContent = '';
            if (!Object.keys(draft()).length || catalogue.some(function (mod) { return enabled.has(mod.id) && selected[mod.id].size === 0; })) {
                event.preventDefault(); error.textContent = 'Choose at least one submodule in every enabled module, or turn that module off.'; return;
            }
            form.action = location.pathname.replace(/\.(qvt|vuet|html)$/, '') + '/saveRole';
            saving = true;
            form.querySelector('#z-role-save').disabled = true;
            form.querySelector('#z-role-save').textContent = 'Saving...';
        });
        showModules(); showScreens();
    };
    window.zInitRoleEditor();
}());
