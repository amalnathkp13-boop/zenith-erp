/* Kitchen-only loading states. Shared navigation styling and canvas remain owned by the shell. */
(function () {
    'use strict';
    if (window.__zkKitchenUi) return;
    window.__zkKitchenUi = true;
    var pending = null, version = 0, timeout, scheduled = false, hooked = false, staleNodes=new WeakSet();
    var tabRequest;
    var tabContent = {KotDashboard:'#kd-wrap',KitchenDisplay:'.zk-display',KotBilling:'#kb-wrap,#kot-terminal-entry',
        Tables:'#tm-wrap',KotHistory:'#zk-history-toolbar',WaiterManagement:'#wf-search'};
    function url(value) { try { return new URL(value, location.href); } catch (_) { return null; } }
    function key(value) { var u=url(value); return u ? u.pathname.replace(/^\/(apps|qapps)/,'').replace(/\.(qvt|html)$/,'').replace(/\/$/,'') : ''; }
    function kitchen(value) { return /^\/zenith\/(?:kot|pos\/Kitchen)(?:\/|$)/.test(key(value)); }
    function appsKotTab(target) {
        return target && target.origin===location.origin && !target.hash &&
            /^\/apps\/zenith\/kot(?:\/(?:KotDashboard|KitchenDisplay|KotBilling|Tables|KotHistory|WaiterManagement))?\/?$/.test(target.pathname);
    }
    function highlightAppsTab(target) {
        var activePath = key(target.href).replace(/\/kot$/, '/kot/KotDashboard');
        document.querySelectorAll('#z-subnav .zsub-grp[data-match="/kot"] a').forEach(function(link) {
            var active = key(link.href)===activePath;
            link.classList.toggle('on', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }
    // Fetch a fresh, authorized screen while keeping the loaded Bootstrap shell.
    async function loadAppsKotTab(target, pushState) {
        var frame = document.getElementById('kitchen-page-frame');
        if (!frame) { location.assign(target.href); return; }
        if (tabRequest) tabRequest.abort();
        var request = new AbortController();
        tabRequest = request;
        begin(target.href, false);
        highlightAppsTab(target);
        try {
            var response = await fetch(target.href, {cache:'no-store', signal:request.signal});
            if (!response.ok || response.redirected) throw Error('KOT tab did not return its screen');
            var page = new DOMParser().parseFromString(await response.text(), 'text/html');
            var next = page.getElementById('kitchen-page-frame');
            var tab = key(target.href).split('/').pop();
            if (!next || key(next.dataset.kitchenRoute)!==key(target.href) ||
                !next.querySelector(tabContent[tab==='kot'?'KotDashboard':tab])) throw Error('KOT tab content is missing');
            if (tabRequest!==request || pending!==target.href) return;
            if (pushState) history.pushState(null, page.title, target.href);
            document.title = page.title;
            frame.replaceWith(next);
            window.scrollTo(0, 0);
            schedule();
        } catch (error) {
            if (!request.signal.aborted && pending===target.href) location.assign(target.href);
        } finally {
            if (tabRequest===request) tabRequest=null;
        }
    }
    function title(value) { var name=key(value).split('/').pop();return ({kot:'KOT Dashboard',Kitchen:'Kitchen Display',KitchenDisplay:'Kitchen Display',KotBilling:'KOT Billing',KotDashboard:'KOT Dashboard',KotHistory:'KOT History',Tables:'Tables',WaiterManagement:'Waiters'})[name] || 'Kitchen'; }
    var critical=document.createElement('style');
    critical.textContent='html.zk-initial-loading body{visibility:hidden!important}html.zk-route-pending #content>.inner>.container-fluid,html.zk-route-pending .q-page{visibility:hidden!important}#zk-route-status{visibility:visible!important;position:fixed;z-index:120;top:120px;left:240px;right:24px;padding:24px;border:1px solid #E4DFF3;border-radius:12px;background:#fff;color:#181329;font:15px/1.6 "Segoe UI",Arial,sans-serif}#zk-route-status h1{font-size:24px;margin:0 0 8px}#zk-route-status button{border:1px solid #7C3AED;background:#fff;color:#6D28D9;padding:8px 18px;border-radius:7px;cursor:pointer}#zk-route-status .zk-placeholder{height:72px;background:#F5F3FA;border-radius:8px;margin-top:18px}@media(max-width:900px){#zk-route-status{left:16px;right:16px;top:110px}}';
    document.head.appendChild(critical);
    function show(message, failed) {
        if (!pending || !document.body) return;
        var box=document.getElementById('zk-route-status');
        if (!box) { box=document.createElement('section');box.id='zk-route-status';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box); }
        box.replaceChildren();
        var heading=document.createElement('h1');heading.textContent=title(pending);box.appendChild(heading);
        var text=document.createElement('p');text.textContent=message;box.appendChild(text);
        if (failed) { var button=document.createElement('button');button.type='button';button.textContent='Retry';button.onclick=function(){location.assign(pending);};box.appendChild(button); }
        else { var placeholder=document.createElement('div');placeholder.className='zk-placeholder';placeholder.setAttribute('aria-hidden','true');box.appendChild(placeholder); }
    }
    function fail() { if(pending)show('The Kitchen page could not be loaded. Please try again.',true); }
    function begin(value, initial) {
        var target=url(value);if(!target || target.origin!==location.origin)return;
        if(!kitchen(target.href) && !kitchen(location.href) && !pending)return;
        if(pending===target.href)return;
        pending=target.href;++version;
        document.querySelectorAll('dialog.zk-history-view').forEach(function(dialog){dialog.close();dialog.remove();});
        if(!initial)document.querySelectorAll('#kitchen-page-frame,.zk-display,#kb-wrap,#tm-wrap,#zk-history-toolbar,#kd-wrap,#wf-search').forEach(function(node){staleNodes.add(node);});
        document.documentElement.classList.add('zk-route-pending');
        if(initial)document.documentElement.classList.add('zk-initial-loading');
        clearTimeout(timeout);timeout=setTimeout(fail,20000);
        show('Loading '+title(pending)+'…',false);
        // Keep the existing active-tab styling; select the destination immediately.
        document.querySelectorAll('#z-subnav a,#zq-subnav a,#kitchen-tabs a').forEach(function(link){
            if(key(link.href)===key(target.href)) {var parent=link.closest('ul');if(parent)parent.querySelectorAll('.active').forEach(function(n){n.classList.remove('active');});if(link.parentElement.tagName==='LI')link.parentElement.classList.add('active');}
        });
    }
    function hooks() {
        var m=window.moqui, root=m&&m.webrootVue;
        if(hooked || !root || typeof root.setUrl!=='function' || typeof m.loadComponent!=='function')return;
        hooked=true;
        var setUrl=root.setUrl, load=m.loadComponent, error=m.handleAjaxError, reload=root.reloadSubscreens;
        var siblingTab;
        root.setUrl=function(destination){
            var current=key(location.href), next=key(destination);
            begin(destination,false);
            siblingTab=location.pathname.startsWith('/qapps/') && !arguments[1] &&
                current!==next && /^\/zenith\/kot(?:\/|$)/.test(current) && next.startsWith('/zenith/kot/') &&
                tabContent[next.split('/').pop()] && !url(destination).search ? next : null;
            return setUrl.apply(this,arguments);
        };
        if(typeof reload==='function')root.reloadSubscreens=function(){
            var ancestors=root.activeSubscreens?.slice(0,2);
            if(!siblingTab || siblingTab!==key(root.currentPath) ||
                root.activeSubscreens?.length!==3 || ancestors[0].pathName!=='zenith' || ancestors[1].pathName!=='kot')
                return reload.apply(this,arguments);
            siblingTab=null;
            // Menu authorization still runs. Keep the unchanged app and KOT shells
            // while the framework fetches and mounts the newly selected child.
            var loaders=ancestors.map(function(screen){return screen.loadActive;});
            ancestors.forEach(function(screen){screen.loadActive=function(){return false;};});
            try { return reload.apply(this,arguments); }
            finally { ancestors.forEach(function(screen,i){screen.loadActive=loaders[i];}); }
        };
        m.loadComponent=function(info,callback){
            var generation=version, args=Array.prototype.slice.call(arguments);
            var tracked=info&&typeof info==='object'&&/\/zenith(?:\/|$)/.test(info.path||'');
            args[1]=function(){if(tracked && generation!==version)return;return callback.apply(this,arguments);};
            return load.apply(this,args);
        };
        if(typeof error==='function')m.handleAjaxError=function(){if(pending)fail();return error.apply(this,arguments);};
        var loadError=m.handleLoadError;
        if(typeof loadError==='function')m.handleLoadError=function(){if(pending)fail();return loadError.apply(this,arguments);};
    }
    function sync() {
        scheduled=false;hooks();
        if(!pending || !document.body)return;
        if(!document.getElementById('zk-route-status'))show('Loading '+title(pending)+'…',false);
        var frame=document.getElementById('kitchen-page-frame');
        var ready=frame&&!staleNodes.has(frame)&&key(frame.dataset.kitchenRoute)===key(pending);
        if(frame) {
            var destination=key(pending).split('/').pop(), selector=tabContent[destination==='kot'?'KotDashboard':destination==='Kitchen'?'KitchenDisplay':destination];
            if(selector){var content=frame.querySelector(selector);ready=!!content&&!staleNodes.has(content);}
        }
        if(!kitchen(pending))ready=!frame && window.moqui&&moqui.webrootVue&&moqui.webrootVue.loading===0;
        var shellReady=location.pathname.indexOf('/qapps/')===0 ? document.documentElement.classList.contains('zq-nav-ready') :
            !!document.querySelector('#z-subnav.show')&&document.getElementById('z-sidebar')?.parentElement===document.body;
        if(!ready || !shellReady)return;
        clearTimeout(timeout);pending=null;
        document.documentElement.classList.remove('zk-initial-loading','zk-route-pending');
        var box=document.getElementById('zk-route-status');if(box)box.remove();
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
    new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-kitchen-route']});
    document.addEventListener('click',function(e){
        if(e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
        var link=e.target.closest&&e.target.closest('a[href]');
        if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self')||link.getAttribute('href').startsWith('#'))return;
        var target=url(link.href);
        if (link.closest('#z-subnav') && appsKotTab(url(location.href)) && appsKotTab(target)) {
            e.preventDefault();
            loadAppsKotTab(target, true);
            return;
        }
        if (tabRequest) tabRequest.abort();
        begin(link.href,false);
    },true);
    document.addEventListener('click',function(e){var close=e.target.closest&&e.target.closest('[data-kitchen-dismiss-help]');if(close){e.preventDefault();var help=document.getElementById('posHelp_kitchen');if(help)help.hidden=true;}});
    window.addEventListener('popstate',function(){
        var target=url(location.href);
        if (appsKotTab(target) && document.querySelector('#kitchen-page-frame')) loadAppsKotTab(target, false);
        else begin(location.href,false);
    });
    window.addEventListener('pageshow',schedule);
    if(kitchen(location.href))begin(location.href,true);
    document.addEventListener('DOMContentLoaded',schedule);hooks();schedule();
})();
