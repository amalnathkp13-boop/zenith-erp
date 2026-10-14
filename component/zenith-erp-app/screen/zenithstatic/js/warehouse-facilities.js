/* Client controls for the organization-scoped warehouse list. */
(function () {
    'use strict';
    var initialized = new WeakSet();
    var columns = ['id','name','type','state','gstin','description','pincode','status'];
    function boot() {
        var root = document.getElementById('warehouseFacilities');
        if (!root || initialized.has(root) || !root.querySelector('.wf-create-anchor')) return;
        initialized.add(root);
        root.dataset.viewKey = root.querySelector('.wf-config').dataset.viewKey;
        root.querySelector('.wf-new-slot').appendChild(root.querySelector('.wf-create-anchor'));
        var createIcon = root.querySelector('.wf-primary .material-icons');
        if (createIcon) createIcon.textContent = 'add';
        var bootstrapIcon = root.querySelector('.wf-primary .fa');
        if (bootstrapIcon) { bootstrapIcon.classList.remove('fa-share'); bootstrapIcon.classList.add('fa-plus'); }
        root.classList.add('wf-ready');
        var rows = Array.from(root.querySelectorAll('.wf-table tbody tr'));
        var search = root.querySelector('.wf-search input');
        var perPage = root.querySelector('.wf-pagination select');
        var entries = root.querySelector('.wf-entries');
        var empty = root.querySelector('.wf-empty');
        var selectAll = root.querySelector('thead input[type=checkbox]');
        var selected = new Set();
        var page = 1, size = 10, sort = '', direction = 'asc', matching = [], visible = [];
        var collator = new Intl.Collator(undefined, { numeric:true, sensitivity:'base' });
        function value(row, key) { return row.querySelector('[data-column="'+key+'"]').textContent.trim(); }
        var values = new Map(rows.map(function (row) {
            var fields = {}; columns.forEach(function (key) { fields[key] = value(row,key); });
            return [row, fields];
        }));
        function say(message) { root.querySelector('.wf-selection').textContent = message; }
        function render() {
            var query = search.value.trim().toLocaleLowerCase();
            matching = rows.filter(function (row) { return columns.some(function (key) { return values.get(row)[key].toLocaleLowerCase().includes(query); }); });
            if (sort) matching.sort(function (a,b) { return (direction === 'asc' ? 1 : -1) * collator.compare(values.get(a)[sort],values.get(b)[sort]); });
            var pages = Math.max(1,Math.ceil(matching.length/size));
            page = Math.max(1,Math.min(page,pages));
            visible = matching.slice((page-1)*size,page*size);
            rows.forEach(function (row) { row.hidden = true; row.classList.toggle('wf-selected',selected.has(row.dataset.id)); row.querySelector('input[type=checkbox]').checked = selected.has(row.dataset.id); });
            matching.forEach(function (row) { root.querySelector('tbody').appendChild(row); });
            visible.forEach(function (row) { row.hidden = false; });
            empty.hidden = matching.length > 0;
            var first = matching.length ? (page-1)*size+1 : 0;
            var last = Math.min(page*size,matching.length);
            entries.textContent = 'Showing '+first+' to '+last+' of '+matching.length+' entries';
            root.querySelector('.wf-current-page').textContent = String(page);
            root.querySelectorAll('[data-page]').forEach(function (button) { button.disabled = ['first','previous'].includes(button.dataset.page) ? page === 1 : page === pages; });
            selectAll.disabled = visible.length === 0;
            var count = visible.filter(function (row) { return selected.has(row.dataset.id); }).length;
            selectAll.checked = visible.length > 0 && count === visible.length;
            selectAll.indeterminate = count > 0 && count < visible.length;
            say(selected.size ? selected.size+' selected · CSV exports selected facilities' : '');
        }
        search.addEventListener('input',function () { page=1; selected.clear(); render(); });
        perPage.addEventListener('change',function () { size=Number(perPage.value); page=1; render(); });
        root.querySelectorAll('[data-page]').forEach(function (button) { button.addEventListener('click',function () { var action=button.dataset.page; page=action==='first'?1:action==='last'?Math.max(1,Math.ceil(matching.length/size)):page+(action==='next'?1:-1); render(); }); });
        root.querySelectorAll('[data-sort]').forEach(function (button) {
            button.addEventListener('click',function () {
                var key = button.dataset.sort;
                direction = sort === key && direction === 'asc' ? 'desc' : 'asc'; sort=key; page=1;
                root.querySelectorAll('[data-sort]').forEach(function (other) { var active=other.dataset.sort===sort; other.closest('th').setAttribute('aria-sort',active?(direction==='asc'?'ascending':'descending'):'none'); other.querySelector('.wf-sort').textContent=active?(direction==='asc'?'↑':'↓'):'↕'; });
                render();
            });
        });
        rows.forEach(function (row) { row.querySelector('input[type=checkbox]').addEventListener('change',function (event) { if(event.target.checked)selected.add(row.dataset.id);else selected.delete(row.dataset.id);render(); }); });
        selectAll.addEventListener('change',function () { var checked=selectAll.checked;visible.forEach(function(row){if(checked)selected.add(row.dataset.id);else selected.delete(row.dataset.id);});render(); });
        root.querySelector('.wf-reset').addEventListener('click',function () { search.value='';sort='';direction='asc';page=1;size=10;perPage.value='10';selected.clear();root.querySelectorAll('[data-sort]').forEach(function(b){b.closest('th').setAttribute('aria-sort','none');b.querySelector('.wf-sort').textContent='↕';});render(); });
        function csvCell(text) { var safe=/^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"'; }
        root.querySelector('.wf-csv').addEventListener('click',function () {
            var exported = selected.size ? matching.filter(function(row){return selected.has(row.dataset.id);}) : matching;
            var csv = [['Facility ID','Facility Name','Type','State Code','GSTIN','Description','Pincode','Status'].map(csvCell).join(',')];
            exported.forEach(function(row){csv.push(columns.map(function(key){return csvCell(values.get(row)[key]);}).join(','));});
            var url=URL.createObjectURL(new Blob(['\ufeff'+csv.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
            var anchor=document.createElement('a');anchor.href=url;anchor.download='facilities.csv';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
            say('Exported '+exported.length+' facilities.');
        });
        function closeMenus() { root.querySelectorAll('.wf-more[open]').forEach(function(menu){menu.open=false;}); }
        root.querySelectorAll('.wf-more').forEach(function(menu) {
            menu.addEventListener('toggle',function(){if(!menu.open)return;root.querySelectorAll('.wf-more[open]').forEach(function(other){if(other!==menu)other.open=false;});var rect=menu.querySelector('summary').getBoundingClientRect();var pop=menu.querySelector('.wf-more-pop');pop.style.left=Math.max(12,Math.min(rect.right-190,innerWidth-202))+'px';pop.style.top=(rect.bottom+90<innerHeight?rect.bottom+5:rect.top-85)+'px';});
        });
        root.addEventListener('click',function(event){if(!event.target.closest('.wf-more'))closeMenus();});
        root.addEventListener('keydown',function(event){if(event.key==='Escape'){var menu=root.querySelector('details[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();}}});
        root.querySelectorAll('[data-copy-id]').forEach(function(button){button.addEventListener('click',function(){if(!navigator.clipboard){say('Copy is unavailable in this browser. Select the facility ID to copy it.');return;}navigator.clipboard.writeText(button.dataset.copyId).then(function(){say('Facility ID copied.');closeMenus();}).catch(function(){say('Facility ID could not be copied.');});});});
        var views=[];
        try { var stored=JSON.parse(localStorage.getItem(root.dataset.viewKey)||'[]');if(Array.isArray(stored))views=stored.filter(function(v){return typeof v.name==='string'&&typeof v.query==='string';}).slice(0,20); } catch(error) { views=[]; }
        function saveViews() { try { localStorage.setItem(root.dataset.viewKey,JSON.stringify(views));return true;}catch(error){say('Saved views are unavailable in this browser.');return false;} }
        function renderViews() {
            var list=root.querySelector('.wf-view-list');list.replaceChildren();root.querySelector('.wf-view-empty').hidden=views.length>0;
            views.forEach(function(view,index){var group=document.createElement('div');group.className='wf-view-item';var apply=document.createElement('button');apply.type='button';apply.textContent=view.name;apply.addEventListener('click',function(){search.value=view.query;sort=columns.includes(view.sort)?view.sort:'';direction=view.direction==='desc'?'desc':'asc';size=[10,25,50,100].includes(view.size)?view.size:10;perPage.value=String(size);page=1;selected.clear();root.querySelector('.wf-views').open=false;root.querySelectorAll('[data-sort]').forEach(function(b){var active=b.dataset.sort===sort;b.closest('th').setAttribute('aria-sort',active?(direction==='asc'?'ascending':'descending'):'none');b.querySelector('.wf-sort').textContent=active?(direction==='asc'?'↑':'↓'):'↕';});render();});var remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove saved view '+view.name);remove.addEventListener('click',function(){views.splice(index,1);saveViews();renderViews();});group.append(apply,remove);list.appendChild(group);});
        }
        root.querySelector('.wf-save-view').addEventListener('submit',function(event){event.preventDefault();var input=event.target.elements.viewName;var name=input.value.trim();if(!name)return;var view={name:name,query:search.value,sort:sort,direction:direction,size:size};var index=views.findIndex(function(v){return v.name===name;});if(index>=0)views[index]=view;else if(views.length<20)views.push(view);else{say('You can save up to 20 views. Remove a view first.');return;}if(saveViews()){input.value='';renderViews();say('View saved.');}});
        renderViews();render();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
    new MutationObserver(boot).observe(document.documentElement,{childList:true,subtree:true});
})();
