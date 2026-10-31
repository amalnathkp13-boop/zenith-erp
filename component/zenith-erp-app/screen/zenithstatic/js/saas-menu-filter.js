(function() {
    if (window._saasMenuFilterLoaded) return;
    window._saasMenuFilterLoaded = true;

    // ZE-AUTH-002: The role/plan menu filter runs client-side (below), so without this guard the full
    // module list — including admin-only items (Settings) and non-plan modules — would render and flash
    // for a moment before being removed, briefly exposing privileged navigation. We therefore hide the
    // top-level module nav items until the filter has run, then reveal only the allowed set. This only
    // applies to users who actually get filtered (a server-embedded config is present); the platform
    // super-admin has no embedded config and is untouched. Missing configuration keeps navigation hidden until the authenticated policy arrives.
    var HIDE_ID = "zmf-menu-pending";
    function injectHide() {
        if (document.getElementById(HIDE_ID)) return;
        var st = document.createElement("style");
        st.id = HIDE_ID;
        st.textContent = '.q-drawer a.q-item[href^="/qapps/zenith/"]{visibility:hidden !important;}';
        (document.head || document.documentElement).appendChild(st);
    }
    function reveal() {
        var st = document.getElementById(HIDE_ID);
        if (st && st.parentNode) st.parentNode.removeChild(st);
    }

    function readEmbedded() {
        // Vue strips <script> from screen templates, so the server embeds the
        // config in a hidden div's data-* attributes (which survive compile).
        var el = document.getElementById("zenith-saas-cfg");
        if (!el) return null;
        try {
            return {
                isSaasTenant: el.getAttribute("data-tenant") === "true",
                hasAllAccess: el.getAttribute("data-all") === "true",
                posOnly: el.getAttribute("data-pos-only") === "true",
                isAdmin: el.getAttribute("data-is-admin") !== "false",
                navRestricted: el.getAttribute('data-nav-restricted') === 'true',
                isSuperAdmin: el.getAttribute('data-super') === 'true',
                modules: JSON.parse(el.getAttribute("data-modules") || "[]")
            };
        } catch (e) { return null; }
    }

    // The Quasar (/qapps) shell renders its module menu client-side via Vue, so the full list — including
    // admin-only Settings and non-plan modules — paints before the filter below can trim it. Hide the
    // module nav up front on /qapps and reveal only once the filter has run. (The /apps shell renders the
    // menu server-side and this Vue filter never touches it, so no hiding there.) Missing or failed configuration must never reveal the unfiltered menu.
    if (location.pathname.indexOf('/qapps/') === 0) injectHide();

    // ZE-NAV-SSR (/qapps): persistent CSS ALLOW-LIST. The Vue navMenuList filter below removes disallowed
    // modules, and this allow-list also covers delayed Vue initialization. This injects a persistent
    // style that hides EVERY /qapps module item and reveals ONLY the allowed ones (server-known from data-modules),
    // so an out-of-plan module can never appear in the /qapps nav even if the JS filter never runs. Only applied
    // to users who are actually filtered (a limited-plan tenant); non-tenant / all-access see everything.
    function applyAllowlist(cfg) {
        if (!cfg || !(cfg.navRestricted || cfg.posOnly || (cfg.isSaasTenant && !cfg.hasAllAccess))) return;
        var show;
        if (cfg.posOnly) {
            show = ["pos", "inventory", "mypassword"];
        } else {
            show = (cfg.modules || []).map(function(m) { return String(m).toLowerCase(); });
            // saas-admin is the PLATFORM super-admin console — hidden for tenants (this branch only runs for
            // a tenant), so it is deliberately NOT revealed. my-subscription IS a tenant's own page → shown.
            show = show.concat(["dashboard", "my-subscription", "mypassword"]);
            if (cfg.isAdmin !== false) show.push("settings");
        }
        var css = '.q-drawer a.q-item[href^="/qapps/zenith/"]{display:none !important}';
        show.forEach(function(m) { if (m) css += '.q-drawer a.q-item[href^="/qapps/zenith/' + m + '" i]{display:flex !important}'; });
        var st = document.getElementById("zmf-allowlist");
        if (!st) { st = document.createElement("style"); st.id = "zmf-allowlist"; (document.head || document.documentElement).appendChild(st); }
        st.textContent = css;
    }

    function startFilter(cfg) {
        if (!cfg || !Array.isArray(cfg.modules)) return;
        var embedded = document.getElementById('zenith-saas-cfg');
        if (!embedded) {
            embedded = document.createElement('div'); embedded.id = 'zenith-saas-cfg'; embedded.hidden = true;
            [['data-tenant',cfg.isSaasTenant],['data-all',cfg.hasAllAccess],['data-pos-only',cfg.posOnly],
                ['data-is-admin',cfg.isAdmin],['data-super',cfg.isSuperAdmin],['data-nav-restricted',cfg.navRestricted]]
                .forEach(function(pair) { embedded.setAttribute(pair[0], String(!!pair[1])); });
            embedded.setAttribute('data-modules', JSON.stringify(cfg.modules));
            document.body.appendChild(embedded);
        }
        window.dispatchEvent(new Event('zenith:nav-config'));
        var app = document.getElementById("apps-root");
        if (!app || !app.__vue__) return;
        applyAllowlist(cfg);
        var vm = app.__vue__;
        var isTenant = !!cfg.isSaasTenant;
        var hasAll = !!cfg.hasAllAccess;
        var posOnly = !!cfg.posOnly;
        // ZE-SETTINGS-0203: Settings is admin-only. Default TRUE unless the server explicitly says false,
        // so a missing flag (e.g. the XHR fallback) never hides Settings from a real admin.
        var isAdmin = cfg.isAdmin !== false;
        var allowedSet = {};
        (cfg.modules || []).forEach(function(m) { allowedSet[String(m).toLowerCase()] = true; });
        // "mypassword" is the self-service sign-in-password screen (ZE-AUTH-001) — every user may reach it.
        var alwaysAllowed = { "dashboard":true, "saas-admin":true, "my-subscription":true, "mypassword":true };
        var lastFiltered = null;

        function filterMenu(list) {
            // Guard prevents redundant re-processing of the same array reference.
            if (!list || !list.length || list === lastFiltered) return;
            lastFiltered = list;
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                // Only filter the top-level ZetaERP app menu (the module list).
                // Filtering deeper levels would wrongly hide each module's own
                // sub-screens, since their names are not plan-module names.
                if (!item || item.name !== "zenith") continue;
                if (!item.subscreens || !item.subscreens.length) continue;
                var filtered = item.subscreens.filter(function(ss) {
                    var name = ss.name ? ss.name.toLowerCase() : "";
                    // POS-only cashier: till-first, but may step into POS + Inventory (create/manage
                    // items) — plus Dashboard (alwaysAllowed below). Everything else stays hidden.
                    if (posOnly) return name === "pos" || name === "inventory" || name === "mypassword";
                    // Settings is admin-only (ZENITH_ADMIN/ADMIN) regardless of plan — hide it from
                    // everyone else so they don't navigate into an "Access Restricted" wall.
                    if (name === "settings") return isAdmin;
                    if (name === "saas-admin") return cfg.isSuperAdmin === true;
                    if (name === "my-subscription" && !isTenant) return false;
                    if (cfg.navRestricted) return !!alwaysAllowed[name] || !!allowedSet[name];
                    if (!isTenant || hasAll) return true;
                    if (alwaysAllowed[name]) return true;
                    return !!allowedSet[name];
                });
                if (filtered.length !== item.subscreens.length) {
                    item.subscreens = filtered;
                }
            }
        }

        vm.$watch("navMenuList", function(newList) {
            filterMenu(newList);
            // Reveal only once the module menu is actually populated AND filtered — revealing on an early
            // empty pass would let the full list paint (and flash) when it populates a moment later. Wait
            // for Vue to re-render the filtered list, so the removed items are gone before anything shows.
            var ready = newList && newList.some(function(it) {
                return it && it.name === "zenith" && it.subscreens && it.subscreens.length;
            });
            if (ready) vm.$nextTick(reveal);
        }, { immediate: true });
    }

    function boot() {
        var app = document.getElementById("apps-root");
        if (!(app && app.__vue__)) return false;
        // Prefer the server-embedded config (zero extra round-trip, applies on first paint). Re-read it
        // each attempt: on /qapps the hidden config div is rendered by Vue AFTER this script first runs,
        // so a one-time read at load would miss it. Fall back to the saasConfig XHR only if it is absent.
        var embedded = window.__zenithSaasCfg || readEmbedded();
        if (embedded) {
            startFilter(embedded);
            return true;
        }
        var vm = app.__vue__;
        $.ajax({
            type: "GET", url: vm.appRootPath + "/apps/zenith/saasConfig", dataType: "json",
            success: function(cfg) { if (cfg) startFilter(cfg); },
            error: function() { /* Keep pending navigation hidden until a valid permission response. */ }
        });
        return true;
    }

    // Poll tightly for the Vue app so the filter applies as early as possible (minimising the brief
    // pending window). Keep unfiltered navigation hidden if the app never mounts.
    var checkReady = setInterval(function() {
        if (boot()) clearInterval(checkReady);
    }, 30);
})();
