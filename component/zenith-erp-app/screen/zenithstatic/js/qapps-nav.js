/*
 * qapps-nav.js — ZE-NAV: port the /apps categorised sidebar + light Owner-View top bar to the
 * Quasar SPA (/qapps). /qapps strips inline <style>/<script>, so this ships as a footer_script
 * (added in ZenithApp.xml) and its CSS lives in zenith-theme-v4.css (loaded on /qapps). It hides
 * the framework tree-drawer, injects a fixed categorised sidebar, and restyles the q-header light
 * with the Owner-View pill / shop switcher / global search — mirroring the /apps redesign. The
 * config it reads (#zenith-saas-cfg, #z-shopdata) is already rendered on /qapps (type="html,qvt").
 *
 * SPA note: the q-header / q-drawer / page-container layout is PERSISTENT across client-side
 * navigations (only the page content swaps), so the chrome is injected once; only the active
 * highlight is re-applied on route change (polled — robust against whichever router the shell uses).
 */
(function () {
    if (location.pathname.indexOf('/qapps/') !== 0) return;   // Quasar shell only
    if (window.__zqNav) return; window.__zqNav = 1;
    try { document.body.classList.add('zq-nav'); } catch (_e) {}   // apply the chrome CSS from first paint (no black header flash)

    // per-module sub-nav tabs — [moduleTitle, 'segment:label', …]; href = /qapps/zenith/<mount>/<segment>
    // (POS Terminal → /apps billing surface). Mirrors the /apps #z-subnav route map.
    var SUBNAV = {
        '/Contacts': ['Contacts', 'ContactsDashboard:Dashboard', 'FindContact:All Contacts', 'Customers:Customers', 'Vendors:Suppliers', 'CustomerGroups:Customer Groups', 'MergeContacts:Merge'],
        '/sales': ['Sales', 'SalesDashboard:Dashboard', 'FindQuotation:Quotations', 'FindOrder:Orders', 'FindDeliveryChallan:Delivery Challans', 'FindInvoice:Invoices', 'FindCreditNote:Credit / Debit Notes', 'PosSalesRegister:POS Sales', 'WarrantyPolicies:Warranty', 'Commissions:Commissions', 'SalesForecast:Forecast'],
        '/Purchase': ['Purchase', 'GoodsReceipt:Goods Receipt (GRN)', 'FindPurchaseOrder:Purchase Orders', 'FindPurchaseInvoice:Vendor Bills (ITC)', 'CreatePurchaseInvoice:Log Vendor Bill', 'PurchaseInvoices:Purchase Invoices', 'PurchaseReturns:Purchase Returns', 'JobWorkChallan:Job Work Challan', 'RfqList:RFQs', 'Gstr2bRecon:GSTR-2B Recon', 'VendorEvaluation:Vendor Evaluation'],
        '/Crm': ['CRM', 'Leads:Leads', 'Pipeline:Pipeline', 'Activities:Activities', 'Segments:Segments'],
        '/pos': ['POS', 'Dashboard:Dashboard', 'OwnerDashboard:Overview', 'Terminal:Billing Terminal', 'PosTransactions:Transactions', 'DailySummary:Daily Summary', 'PosSessions:Sessions', 'PosTerminals:Terminals', 'CreditBills:Credit Bills', 'CashEntry:Cash Entry', 'Expenses:Expenses', 'Wastage:Wastage', 'Stock:Stock', 'Reports:Reports', 'BillAuditReport:Audit Report', 'ProductPricing:Product Prices', 'PriceOverrides:Price Overrides', 'DiscountSettings:Discount', 'SalesMode:Sales Mode', 'Barcodes:Barcodes', 'BarcodeLabels:Barcode Labels', 'ProductImport:Import', 'ReceiptConfig:Receipts', 'PrinterConfig:Printers', 'Kitchen:Kitchen', 'BillNumberRegister:Bill Register', 'OfflineMode:Offline Mode'],
        '/Inventory': ['Inventory', 'InventoryDashboard:Dashboard', 'FindProduct:Products', 'FindFacility:Warehouse', 'StockLevels:Stock Levels', 'FindReceipt:Receiving', 'StockTransfers:Stock Transfers', 'StockAdjustments:Stock Adjustments', 'GatePasses:Gate Passes', 'CreateCatalogue:Catalogues', 'ExpiryDashboard:Expiry Risk', 'SerialNumbers:Serial Numbers', 'DemandForecast:Demand Forecast'],
        '/manufacturing': ['Manufacturing', 'WorkOrders:Work Orders', 'BillOfMaterials:Bill of Materials', 'WorkCenters:Work Centers', 'JobWork:Job Work', 'MrpPlanning:MRP Planning', 'ProductionSchedule:Production Schedule'],
        '/Accounting': ['Accounting', 'AcctgDashboard:Dashboard', 'ChartOfAccounts:Chart of Accounts', 'ManualJournalEntry:Journal Entry', 'JournalHistory:Journal History', 'Invoices:Invoices (A/R & A/P)', 'Payments:Payments', 'TrialBalance:Trial Balance', 'ProfitAndLoss:Profit & Loss', 'CashFlowStatement:Cash Flow', 'AgingReport:AR/AP Aging', 'Budgets:Budgets', 'GstReports:GST Reports', 'Gstr3bReport:GSTR-3B', 'TdsRegister:TDS Register', 'MsmeAgingReport:MSME Aging', 'AutoBrs:Bank Feeds & BRS', 'Schedule3Statements:Schedule III', 'RecurringInvoices:Recurring Invoices', 'TallyExport:Tally Export', 'VoucherAudit:Voucher Audit', 'McaAuditLog:MCA Audit Log'],
        '/payroll': ['Payroll', 'PayrollRuns:Payroll Runs', 'SalaryStructures:Salary Structures', 'TaxDeclarations:Tax Declarations', 'SalaryAdvances:Salary Advances', 'CtcCalculator:CTC Calculator', 'StatutoryCompliance:Statutory Compliance', 'EpfRegister:EPF Register', 'EsiRegister:ESI Register'],
        '/expenses': ['Expenses', 'MyExpenses:My Expenses', 'AllReports:All Reports', 'Categories:Categories', 'Advances:Advances', 'PerDiemRules:Per Diem Rules'],
        '/project': ['Projects', 'Projects:Projects', 'AllTasks:All Tasks'],
        '/Stores': ['Shops', 'FindStore:All Shops'],
        '/tax': ['Tax', 'TaxDashboard:Dashboard', 'FindTaxRate:Tax Rates', 'FindTaxAuthority:Tax Authorities', 'FindTaxExemption:Tax Exemptions', 'FindTaxRegistration:Tax Registrations', 'Gstr1Returns:GST Returns'],
        '/pricing': ['Pricing', 'PricingDashboard:Dashboard', 'FindPriceList:Price Lists', 'FindPricingRule:Pricing Rules', 'PriceChangeHistory:Price History'],
        '/barcode': ['Barcode', 'BarcodeDashboard:Dashboard', 'FindBarcode:Product Barcodes', 'LabelTemplates:Label Templates', 'PrintJobs:Print Jobs']
    };
    // the "Dashboards" hub shown on the Home/Dashboard landing — [label, href, matchPrefix, planModule] across
    // the ERP. A tab is shown only if its planModule is in the tenant's plan (null = always shown).
    var DASHBOARDS = [
        ['Overview', '/qapps/zenith', '/', null],
        ['Sales', '/qapps/zenith/sales/SalesDashboard', '/sales', 'sales'],
        ['POS', '/qapps/zenith/pos/Dashboard', '/pos/Dashboard', 'pos'],
        ['Owner Overview', '/qapps/zenith/pos/OwnerDashboard', '/pos/OwnerDashboard', 'pos'],
        ['Inventory', '/qapps/zenith/Inventory/InventoryDashboard', '/Inventory', 'inventory'],
        ['Accounting', '/qapps/zenith/Accounting/AcctgDashboard', '/Accounting', 'accounting'],
        ['Contacts', '/qapps/zenith/Contacts/ContactsDashboard', '/Contacts', 'contacts'],
        ['HR', '/qapps/zenith/Hr/HrDashboard', '/Hr', 'hr'],
        ['Tax', '/qapps/zenith/tax/TaxDashboard', '/tax', 'tax'],
        ['Pricing', '/qapps/zenith/pricing/PricingDashboard', '/pricing', 'pricing'],
        ['Barcode', '/qapps/zenith/barcode/BarcodeDashboard', '/barcode', 'barcode']
    ];
    // tenant's allowed plan modules (null = all-access / not a plan-gated tenant)
    function tenantMods() {
        try { var cfg = document.getElementById('zenith-saas-cfg');
            if (cfg && cfg.getAttribute('data-tenant') === 'true' && cfg.getAttribute('data-all') !== 'true') {
                var m = []; try { m = JSON.parse(cfg.getAttribute('data-modules') || '[]'); } catch (_e) {} return m.length ? m : null;
            }
        } catch (_e) {} return null;
    }

    // module → sidebar entry. hrefs stay on /qapps (stay in the SPA); the billing Terminal is /apps-only.
    var CATS = [
        { cat: '', items: [
            { match: '/Dashboard', icon: 'dashboard', label: 'Dashboard', href: '/qapps/zenith' },
            { mod: 'contacts', match: '/Contacts', icon: 'groups', label: 'Contacts', href: '/qapps/zenith/Contacts/ContactsDashboard' }
        ], head: 'OVERVIEW' },
        { head: 'SALES & CRM', items: [
            { mod: 'sales', match: '/sales', icon: 'trending_up', label: 'Sales', href: '/qapps/zenith/sales/SalesDashboard' },
            { mod: 'purchase', match: '/Purchase', icon: 'shopping_cart', label: 'Purchase', href: '/qapps/zenith/Purchase/RfqList' },
            { mod: 'crm', match: '/Crm', icon: 'campaign', label: 'CRM', href: '/qapps/zenith/Crm/Leads' },
            { mod: 'pos', match: '/pos', icon: 'point_of_sale', label: 'POS', href: '/qapps/zenith/pos/Dashboard' },
            { mod: 'pos', match: '/pos/Terminal', icon: 'receipt_long', label: 'POS Billing', href: '/apps/zenith/pos/Terminal' },
            { mod: 'pricing', match: '/pricing', icon: 'sell', label: 'Pricing', href: '/qapps/zenith/pricing/PricingDashboard' }
        ] },
        { head: 'OPERATIONS', items: [
            { mod: 'inventory', match: '/Inventory', icon: 'inventory_2', label: 'Inventory', href: '/qapps/zenith/Inventory/InventoryDashboard' },
            { mod: 'manufacturing', match: '/manufacturing', icon: 'precision_manufacturing', label: 'Manufacturing', href: '/qapps/zenith/manufacturing/WorkOrders' },
            { mod: 'project', match: '/project', icon: 'folder_open', label: 'Projects', href: '/qapps/zenith/project' },
            { match: '/Stores', icon: 'storefront', label: 'Shops', href: '/qapps/zenith/Stores/FindStore' },
            { mod: 'barcode', match: '/barcode', icon: 'qr_code_scanner', label: 'Barcode', href: '/qapps/zenith/barcode/BarcodeDashboard' }
        ] },
        { head: 'FINANCE', items: [
            { mod: 'accounting', match: '/Accounting', icon: 'account_balance', label: 'Accounting', href: '/qapps/zenith/Accounting/AcctgDashboard' },
            { mod: 'tax', match: '/tax', icon: 'percent', label: 'Tax', href: '/qapps/zenith/tax/TaxDashboard' },
            { mod: 'payroll', match: '/payroll', icon: 'payments', label: 'Payroll', href: '/qapps/zenith/payroll/PayrollRuns' },
            { mod: 'expenses', match: '/expenses', icon: 'savings', label: 'Expenses', href: '/qapps/zenith/expenses/MyExpenses' }
        ] },
        { head: 'OTHER', items: [
            { match: '/__more', icon: 'more_horiz', label: 'More Modules', href: '/qapps/zenith' }
        ] }
    ];

    function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    function mi(name) { var s = el('span', 'material-icons', name); return s; }
    var allLinks = [];

    // ZE-NAV: "More Modules" (OTHER category) discloses the dashboard's All Modules grid instead of being a
    // dead same-page link. On the dashboard → smooth-scroll to it; elsewhere → flag + let the href navigate
    // home, then the route-change watcher scrolls once the grid renders.
    function scrollToModules() {
        var tries = 0;
        (function poll() {
            var g = document.getElementById('dashAllModules');
            if (g) { try { g.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_e) { g.scrollIntoView(); } return; }
            if (++tries <= 24) setTimeout(poll, 300);
        })();
    }
    function gotoModules(e) {
        if (document.getElementById('dashAllModules')) { if (e) e.preventDefault(); scrollToModules(); }
        else { try { sessionStorage.setItem('zqGotoModules', '1'); } catch (_e) {} }
    }

    function buildSidebar() {
        // ZE-NAV: super-admin-only entry to the platform SaaS Admin panel — mirror the /apps sidebar so it's
        // reachable from /qapps too (SaasAdmin itself gates on the ADMIN group). Links to the /apps panel.
        try {
            var _cfg = document.getElementById('zenith-saas-cfg');
            var _other = CATS[CATS.length - 1];
            if (_cfg && _cfg.getAttribute('data-super') === 'true' && _other && _other.head === 'OTHER'
                && !_other.items.some(function (x) { return x.match === '/saas-admin'; })) {
                _other.items.push({ match: '/saas-admin', icon: 'admin_panel_settings', label: 'SaaS Admin', href: '/apps/zenith/saas-admin' });
            }
        } catch (_e) {}
        var side = el('aside'); side.id = 'zq-sidebar';
        var brand = el('div', 'zqs-brand');
        var img = el('img'); img.src = '/zenithstatic/img/zetaerp-icon-zc.svg'; img.alt = 'ZC'; brand.appendChild(img);
        brand.appendChild(el('span', null, 'ZcERP'));
        side.appendChild(brand);
        var scroll = el('div', 'zqs-scroll');
        CATS.forEach(function (grp) {
            if (grp.head) { var h = el('div', 'zqs-cat', grp.head); scroll.appendChild(h); }
            grp.items.forEach(function (it) {
                var a = el('a', 'zqs-link'); a.href = it.href;
                if (it.mod) a.setAttribute('data-mod', it.mod);
                a.setAttribute('data-match', it.match);
                if (it.match === '/__more') a.addEventListener('click', gotoModules);
                a.appendChild(mi(it.icon));
                a.appendChild(el('span', 't', it.label));
                scroll.appendChild(a);
                allLinks.push(a);
            });
        });
        side.appendChild(scroll);
        var tgl = el('button', 'zqs-collapse'); tgl.id = 'zq-side-toggle'; tgl.title = 'Collapse / expand'; tgl.innerHTML = '&#10094;';
        side.appendChild(tgl);
        return side;
    }

    // longest data-match prefix of the /qapps-relative path
    function applyActive() {
        var rel = location.pathname.replace(/^\/qapps\/zenith/, '') || '/';
        var best = null, bestLen = -1;
        allLinks.forEach(function (a) {
            a.classList.remove('on');
            var m = a.getAttribute('data-match') || '';
            if (m && m !== '/__more' && rel.indexOf(m) === 0 && m.length > bestLen) { best = a; bestLen = m.length; }
        });
        if (!best) best = allLinks[0];
        if (best) best.classList.add('on');
    }

    function applyRbac(side) {
        try {
            var cfg = document.getElementById('zenith-saas-cfg');
            if (cfg && cfg.getAttribute('data-tenant') === 'true' && cfg.getAttribute('data-all') !== 'true') {
                var mods = []; try { mods = JSON.parse(cfg.getAttribute('data-modules') || '[]'); } catch (_e) {}
                if (mods.length) {
                    allLinks.forEach(function (a) { var k = a.getAttribute('data-mod'); if (k && mods.indexOf(k) < 0) a.style.display = 'none'; });
                    [].slice.call(side.querySelectorAll('.zqs-cat')).forEach(function (h) {
                        var n = h.nextElementSibling, any = false;
                        while (n && !n.classList.contains('zqs-cat')) { if (n.classList && n.classList.contains('zqs-link') && n.style.display !== 'none') { any = true; break; } n = n.nextElementSibling; }
                        if (!any) h.style.display = 'none';
                    });
                }
            }
        } catch (_e) {}
    }

    // ---- top bar: Owner View pill / shop switcher / global search, injected into the q-header ----
    function buildTopbar(header) {
        var cfg = document.getElementById('zenith-saas-cfg');
        var shopData = document.getElementById('z-shopdata');
        var orgName = (cfg && cfg.getAttribute('data-org-name')) || '';
        var posOnly = cfg && cfg.getAttribute('data-pos-only') === 'true';
        var canSwitch = false, shops = [], activeShop = '', shopTok = '';
        if (shopData) {
            canSwitch = shopData.getAttribute('data-multishop') === 'true' && !posOnly;
            activeShop = shopData.getAttribute('data-active') || '';
            shopTok = shopData.getAttribute('data-token') || '';
            [].slice.call(shopData.querySelectorAll('i')).forEach(function (n) { shops.push({ id: n.getAttribute('data-id'), name: n.getAttribute('data-name') }); });
        }
        var wrap = el('div'); wrap.id = 'zq-topextra';
        // Owner View pill / switcher
        var ov = el('div'); ov.id = 'zq-ownerview';
        ov.appendChild(mi('grid_view'));   // ZE-QAPPS-TOPBAR-PARITY: match the /apps Owner-View icon (was verified_user)
        ov.appendChild(el('span', null, 'Owner View'));
        if (canSwitch) {
            ov.classList.add('zqov-switch');
            ov.appendChild(el('span', 'zqov-sep', '·'));
            var cur = el('span', 'zqov-org'); var act = shops.filter(function (s) { return s.id === activeShop; })[0];
            cur.textContent = act ? act.name : 'All Shops'; ov.appendChild(cur);
            ov.appendChild(mi('expand_more')).classList.add('zqov-caret');
            var menu = el('div'); menu.id = 'zq-shopmenu';
            menu.appendChild(el('div', 'zqsm-head', 'View shop'));
            var submit = function (id) { var f = el('form'); f.method = 'POST'; f.action = '/apps/zenith/setActiveShop'; f.style.display = 'none';
                var add = function (n, v) { var i = el('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
                add('facilityId', id || ''); add('moquiSessionToken', shopTok); add('returnUrl', location.pathname + location.search);
                document.body.appendChild(f); f.submit(); };
            var item = function (id, name, on) { var a = el('a', 'zqsm-item' + (on ? ' on' : '')); a.href = '#';
                a.appendChild(mi(on ? 'check' : (id ? 'storefront' : 'apps'))); a.appendChild(el('span', null, name));
                a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); submit(id); }); return a; };
            menu.appendChild(item('', 'All Shops (combined)', !activeShop));
            shops.forEach(function (s) { menu.appendChild(item(s.id, s.name, s.id === activeShop)); });
            var msep = el('div'); msep.style.cssText = 'height:1px;background:#EEE9F7;margin:5px 6px'; menu.appendChild(msep);
            var mmg = el('a', 'zqsm-item'); mmg.href = '/qapps/zenith/Stores/FindStore'; mmg.style.fontWeight = '700';
            mmg.appendChild(mi('add')); mmg.appendChild(el('span', null, 'Add / manage shops'));
            mmg.addEventListener('click', function (e) { e.stopPropagation(); });
            menu.appendChild(mmg);
            ov.appendChild(menu);
            ov.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('show'); });
            document.addEventListener('click', function () { menu.classList.remove('show'); });
        } else if (orgName) {
            ov.appendChild(el('span', 'zqov-sep', '·'));
            ov.appendChild(el('span', 'zqov-org', orgName));
        }
        wrap.appendChild(ov);
        // search
        var sc = el('div'); sc.id = 'zq-search';
        var box = el('div', 'zqsr-box'); box.appendChild(mi('search'));
        var inp = el('input'); inp.type = 'text'; inp.id = 'zq-search-input'; inp.placeholder = 'Search modules…'; inp.setAttribute('autocomplete', 'off'); box.appendChild(inp);
        var kb = el('span', 'z-kbd'); var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''); kb.textContent = isMac ? '⌘K' : 'Ctrl K'; kb.setAttribute('aria-hidden', 'true'); kb.title = 'Focus search'; kb.addEventListener('click', function () { inp.focus(); }); box.appendChild(kb);
        sc.appendChild(box);
        var res = el('div'); res.id = 'zq-search-results'; sc.appendChild(res);
        wrap.appendChild(sc);
        // Index the rendered, plan-filtered navigation and its screens, rather than the raw module catalogue.
        function searchIndex() {
            var idx = [];
            document.querySelectorAll('#zq-sidebar .zqs-link').forEach(function (link) {
                if (link.style.display === 'none') return;
                var match = link.getAttribute('data-match'), label = (link.querySelector('.t') || link).textContent.trim();
                if (match === '/__more') return;
                idx.push({ label: label, mod: '', href: link.getAttribute('href') });
                var group = SUBNAV[match];
                if (group) group.slice(1).forEach(function (screen) {
                    var split = screen.indexOf(':'), route = screen.slice(0, split);
                    idx.push({ label: screen.slice(split + 1), mod: group[0], href: (match === '/pos' && route === 'Terminal' ? '/apps/' : '/qapps/') + 'zenith' + match + '/' + route });
                });
            });
            document.querySelectorAll('#dashAllModules a[href]').forEach(function (link) { idx.push({ label: link.textContent.trim(), mod: '', href: link.getAttribute('href') }); });
            return idx;
        }
        var current = -1;
        function draw(q) { q = (q || '').trim().toLowerCase(); res.innerHTML = '';
            current = -1;
            if (!q) { res.classList.remove('show'); return; }
            var seen = {};
            var out = searchIndex().filter(function (it) {
                var key = it.href + '|' + it.label;
                if (seen[key] || (it.mod + ' ' + it.label).toLowerCase().indexOf(q) < 0) return false;
                seen[key] = true; return true;
            }).slice(0, 12);
            if (!out.length) { var em = el('div', 'zqsr-empty', 'No matches'); res.appendChild(em); res.classList.add('show'); return; }
            out.forEach(function (it) { var a = el('a'); a.href = it.href; a.appendChild(mi('arrow_forward')); a.appendChild(el('span', null, it.label)); res.appendChild(a); });
            res.classList.add('show'); }
        inp.addEventListener('input', function () { draw(inp.value); });
        inp.addEventListener('focus', function () { if (inp.value.trim()) draw(inp.value); });
        inp.addEventListener('keydown', function (e) {
            var links = res.querySelectorAll('a');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); if (!links.length) return;
                if (current >= 0) links[current].classList.remove('sel');
                current = current < 0 ? (e.key === 'ArrowDown' ? 0 : links.length - 1) : (current + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
                links[current].classList.add('sel'); links[current].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                var selected = links[current] || links[0]; if (selected) { e.preventDefault(); location.href = selected.getAttribute('href'); }
            } else if (e.key === 'Escape') { inp.value = ''; res.classList.remove('show'); inp.blur(); }
        });
        document.addEventListener('click', function (e) { if (!sc.contains(e.target)) res.classList.remove('show'); });
        // ⌘K / Ctrl-K focuses the quick-search from anywhere (bound once; input is looked up live)
        if (!window.__zqSearchKbd) { window.__zqSearchKbd = 1; document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { var si = document.getElementById('zq-search-input'); if (si) { e.preventDefault(); si.focus(); try { si.select(); } catch (_e) {} } } }); }
        // insert INTO the toolbar row, right after the menu burger, so it stays a single row
        var toolbar = header.querySelector('.q-toolbar') || header;
        var burger = toolbar.querySelector('button');
        if (burger) toolbar.insertBefore(wrap, burger.nextSibling); else toolbar.insertBefore(wrap, toolbar.firstChild);
        buildToolButtons(toolbar);
    }

    // ---- right-side control cluster mirroring the /apps top bar ----
    // /apps shows: avatar, logout, theme toggle, notifications, messages, calendar, tasks, password. The Quasar
    // header's own right buttons (facility switcher `edit_location`, notifications dropdown, history, account avatar)
    // are none of them present on /apps, so we hide them and render one cohesive, /apps-identical cluster instead.
    function zInitials(n) { n = (n || '').trim(); if (!n) return '?'; var w = n.split(/\s+/); var a = w[0].charAt(0); var b = w.length > 1 ? w[w.length - 1].charAt(0) : (w[0].charAt(1) || ''); return (a + b).toUpperCase(); }
    function buildToolButtons(toolbar) {
        try {
            if (!toolbar || document.getElementById('zq-toolbtns')) return;
            var cfg = document.getElementById('zenith-saas-cfg');
            var uname = (cfg && cfg.getAttribute('data-user-name')) || '';
            // hide the framework's mismatched right buttons (none exist on /apps)
            [].slice.call(toolbar.querySelectorAll('button.q-btn')).forEach(function (btn) {
                var ic = btn.querySelector('.q-icon, .material-icons'); var t = ic ? ic.textContent.trim() : '';
                if (t === 'help_outline' || t === 'edit_location' || t === 'notifications' || t === 'history') btn.style.display = 'none';
                if (btn.querySelector('.q-avatar')) btn.style.display = 'none';   // framework account avatar
            });
            var cluster = el('div'); cluster.id = 'zq-toolbtns';
            function tb(icon, href, title, cls) { var a = el('a', 'zqtb' + (cls ? ' ' + cls : '')); a.href = href; a.title = title; a.setAttribute('aria-label', title); a.appendChild(mi(icon)); return a; }
            var lock = tb('lock', '/apps/zenith/MyPassword', 'My Password');
            var bell = tb('notifications', '/apps/my/User/Notifications', 'Notifications'); bell.appendChild(el('span', 'zqtb-badge zq-empty'));
            var mail = tb('mail', '/apps/my/User/Messages/FindMessage?statusId=CeReceived', 'Messages', 'zqtb-quad');
            var cal = tb('event', '/apps/my/User/Calendar/MyCalendar', 'Events This Week', 'zqtb-quad');
            var task = tb('task_alt', '/apps/my/User/Task/MyTasks', 'Open Tasks', 'zqtb-quad');
            var theme = tb('contrast', '#', 'Switch Dark / Light');
            theme.addEventListener('click', function (e) {
                e.preventDefault();
                try {
                    var on = document.body.classList.toggle('body--dark');
                    try { localStorage.setItem('zqDark', on ? '1' : '0'); } catch (_e) {}
                    try { var app = document.getElementById('apps-root'); if (app && app.__vue__ && app.__vue__.$q && app.__vue__.$q.dark) app.__vue__.$q.dark.set(on); } catch (_e) {}
                } catch (_e) {}
            });
            var logout = tb('power_settings_new', '/Login/logout', 'Logout' + (uname ? ' ' + uname : ''), 'zqtb-danger');
            // avatar (initials) → My Account — rightmost, mirroring /apps
            var av = el('a', 'zqtb zqtb-avatar'); av.href = '/apps/my'; av.title = uname || 'My account'; av.setAttribute('aria-label', (uname ? uname + ' — ' : '') + 'My account'); av.textContent = zInitials(uname);
            // order matches the /apps toolbar (L→R): password, notifications, messages, calendar, tasks, theme, logout, avatar
            [lock, bell, mail, cal, task, theme, logout, av].forEach(function (b2) { cluster.appendChild(b2); });
            toolbar.appendChild(cluster);
            try { if (localStorage.getItem('zqDark') === '1') document.body.classList.add('body--dark'); } catch (_e) {}
        } catch (_e) {}
    }

    // ---- per-module sub-nav bar (below the header): current module's sections as horizontal tabs ----
    var subBar = null;
    // The header and fixed tabs share one offset, including wrapped mobile toolbars.
    function syncHeaderLayout() {
        var header = document.querySelector('.q-header');
        if (!header) return;
        document.body.style.setProperty('--zq-header-height', header.getBoundingClientRect().height + 'px');
        document.body.style.setProperty('--zq-subnav-height', (subBar ? subBar.getBoundingClientRect().height : 0) + 'px');
    }
    function updateSubnav() {
        if (!subBar) return;
        var rel = location.pathname.replace(/^\/qapps\/zenith/, '') || '/';
        // Home/Dashboard landing → the "Dashboards" hub (every ERP dashboard)
        if (rel === '/' || rel === '/Dashboard') {
            subBar.innerHTML = '';
            subBar.removeAttribute('data-mod');
            subBar.appendChild(el('span', 'zqsub-title', 'Dashboards'));
            var mods = tenantMods();
            DASHBOARDS.forEach(function (d) {
                if (d[3] && mods && mods.indexOf(d[3]) < 0) return;   // module not in the tenant's plan → skip
                var a = el('a', 'zqsub-tab', d[0]); a.href = d[1];
                var on = (d[2] === '/') ? (rel === '/' || rel === '/Dashboard') : (rel.indexOf(d[2]) === 0);
                if (on) a.classList.add('on');
                subBar.appendChild(a);
            });
            subBar.classList.add('show'); document.body.classList.add('zq-has-subnav'); syncHeaderLayout();
            return;
        }
        var key = null, klen = -1;
        for (var k in SUBNAV) { if (rel.indexOf(k) === 0 && k.length > klen) { key = k; klen = k.length; } }
        subBar.innerHTML = '';
        if (!key) { subBar.classList.remove('show'); document.body.classList.remove('zq-has-subnav'); syncHeaderLayout(); return; }
        var arr = SUBNAV[key], mount = key.slice(1);
        subBar.setAttribute('data-mod', mount);  // ZE-CONTACTS-DS: lets CSS scope the active-tab pill to Contacts only
        // ZE-NAV-ALIAS: a detail/edit screen (menu-include=false, e.g. EditStockTransfer) shares no URL prefix with its
        // list tab, so no tab would highlight. Map it to the parent list route for active-state matching only (the group
        // still resolves via the /<module> prefix above, so this doesn't change which subnav renders).
        var relA = rel, _NAV_ALIAS = { '/Inventory/EditStockTransfer': '/Inventory/StockTransfers', '/Inventory/EditStockAdjustment': '/Inventory/StockAdjustments', '/Inventory/EditFacility': '/Inventory/FindFacility' };
        for (var _ak in _NAV_ALIAS) { if (rel.indexOf(_ak) === 0) { relA = _NAV_ALIAS[_ak] + rel.slice(_ak.length); break; } }
        // ZE-POS-NAV-ROLE: a POS-only cashier (posOnlyUser -> data-pos-only) sees only till-operational POS submodules;
        // hide the rest (visibility-only). Same cashier set as the /apps #z-subnav filter (ZenithApp.xml). Admin / Store
        // Manager are never posOnly, so they keep every tab.
        var posCash = null;
        if (mount === 'pos') { try { var _pc = document.getElementById('zenith-saas-cfg'); if (_pc && _pc.getAttribute('data-pos-only') === 'true') posCash = { Dashboard: 1, Terminal: 1, PosTransactions: 1, DailySummary: 1, PosSessions: 1, CreditBills: 1, CashEntry: 1 }; } catch (_e) {} }
        subBar.appendChild(el('span', 'zqsub-title', arr[0]));
        var active = null, alen = -1;
        for (var i = 1; i < arr.length; i++) {
            var pair = arr[i], ci = pair.indexOf(':'), seg = pair.slice(0, ci), label = pair.slice(ci + 1);
            if (posCash && !posCash[seg]) continue;
            var href = (mount === 'pos' && seg === 'Terminal') ? '/apps/zenith/pos/Terminal' : ('/qapps/zenith/' + mount + '/' + seg);
            var a = el('a', 'zqsub-tab', label); a.href = href;
            var m = key + '/' + seg; if (relA.indexOf(m) === 0 && m.length > alen) { active = a; alen = m.length; }
            subBar.appendChild(a);
        }
        if (active) active.classList.add('on');
        subBar.classList.add('show'); document.body.classList.add('zq-has-subnav'); syncHeaderLayout();
        if (active) { try { var r = active.getBoundingClientRect(), br = subBar.getBoundingClientRect(); subBar.scrollLeft += (r.left - br.left) - (subBar.clientWidth / 2) + (r.width / 2); } catch (_e) {} }
    }

    function init() {
        var header = document.querySelector('.q-header');
        var layout = document.querySelector('.q-layout');
        if (!header || !layout) return false;
        var body = document.body;
        body.classList.add('zq-nav');
        var side = buildSidebar();
        body.appendChild(side);
        applyRbac(side);
        applyActive();
        buildTopbar(header);
        subBar = el('div'); subBar.id = 'zq-subnav';
        body.appendChild(subBar);
        updateSubnav();
        if (window.ResizeObserver) {
            var headerResize = new ResizeObserver(syncHeaderLayout);
            headerResize.observe(header);
            headerResize.observe(subBar);
        } else window.addEventListener('resize', syncHeaderLayout);
        // collapse (persisted)
        try { if (localStorage.getItem('zqSideCollapsed') === '1') body.classList.add('zq-side-collapsed'); } catch (_e) {}
        var tgl = document.getElementById('zq-side-toggle');
        if (tgl) tgl.addEventListener('click', function () { body.classList.toggle('zq-side-collapsed'); try { localStorage.setItem('zqSideCollapsed', body.classList.contains('zq-side-collapsed') ? '1' : '0'); } catch (_e) {} });
        // the framework's menu burger used to toggle the (now hidden) tree drawer — repurpose it to open our
        // sidebar off-canvas on mobile; tapping the page content closes it.
        var fwBurger = header.querySelector('.q-toolbar button');
        if (fwBurger) fwBurger.addEventListener('click', function () { if (window.innerWidth <= 900) body.classList.toggle('zq-side-open'); }, true);
        document.addEventListener('click', function (e) { if (body.classList.contains('zq-side-open') && !side.contains(e.target) && (!fwBurger || !fwBurger.contains(e.target))) body.classList.remove('zq-side-open'); });
        side.addEventListener('click', function (e) { if (e.target.closest('.zqs-link')) body.classList.remove('zq-side-open'); });
        // re-apply active highlight on SPA route changes (URL is swapped without a full reload)
        var last = location.pathname;
        setInterval(function () { if (location.pathname !== last) { last = location.pathname; applyActive(); updateSubnav(); try { if (sessionStorage.getItem('zqGotoModules')) { sessionStorage.removeItem('zqGotoModules'); scrollToModules(); } } catch (_e) {} } }, 400);
        document.documentElement.classList.add('zq-nav-ready');
        document.documentElement.classList.remove('zq-shell-boot');
        return true;
    }

    // the Quasar shell renders asynchronously — wait for the layout AND the screen config (#z-shopdata, which
    // drives the shop switcher) so canSwitch is read correctly; fall back after ~4s if the config never loads.
    var tries = 0;
    var iv = setInterval(function () {
        tries++;
        if (!document.getElementById('z-shopdata') && tries <= 16) return;
        if (init() || tries > 60) clearInterval(iv);
    }, 250);
})();
