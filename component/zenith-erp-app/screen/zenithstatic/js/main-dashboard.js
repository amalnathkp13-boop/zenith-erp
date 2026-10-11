/* Home dashboard lifecycle: shared by the server renderer and the Quasar SPA. */
(function () {
  'use strict';
  var initialized = new WeakSet();
  var navRoot;
  var notificationObserver;
  // Outline icons from the supplied dashboard reference; SVG stays crisp at the header's actual size.
  function outlineIcon(name) {
    var paths = {
      menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
      owner: '<path d="M3 7v4a1 1 0 001 1h3m10-5v4a1 1 0 01-1 1h-3m-4 0v5a1 1 0 001 1h2"/><circle cx="12" cy="4" r="2"/>',
      search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
      calendar_today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
      notifications_none: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>',
      tune: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06"/>',
      expand_more: '<path d="M6 9l6 6 6-6"/>',
      chevron_right: '<path d="M9 18l6-6-6-6"/>'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'home-glyph'); svg.innerHTML = paths[name] || '';
    return svg;
  }
  function clearChrome() {
    ['homePrimaryNav', 'homeBrand', 'homeMenuButton', 'homeUtilities', 'homeOwnerIcon', 'homeSearchIcon'].forEach(function (id) {
      var element = document.getElementById(id); if (element) element.remove();
    });
    if (notificationObserver) notificationObserver.disconnect();
    notificationObserver = null; navRoot = null;
  }
  function chrome(root) {
    var nav = document.getElementById('homePrimaryNav');
    if (nav && navRoot !== root) { clearChrome(); nav = null; }
    if (!root) { clearChrome(); return; }
    if (nav) return;
    var search = document.getElementById('zq-search') || document.getElementById('z-search');
    if (!search) return;
    var cfg;
    try { cfg = JSON.parse(root.dataset.config); } catch (error) { return; }
    nav = document.createElement('nav'); nav.id = 'homePrimaryNav'; nav.setAttribute('aria-label', 'Primary modules');
    [{ label: 'Dashboard', url: '/apps/zenith/Dashboard' }].concat(cfg.nav || []).forEach(function (item, index) {
      var link = document.createElement('a'); link.textContent = item.label;
      link.href = item.url.replace('/apps/', location.pathname.startsWith('/qapps/') ? '/qapps/' : '/apps/');
      if (index === 0) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    search.before(nav);
    var spa = location.pathname.startsWith('/qapps/');
    var host = search.parentNode;
    var owner = document.getElementById(spa ? 'zq-ownerview' : 'z-ownerview');
    if (owner) { var ownerIcon = outlineIcon('owner'); ownerIcon.id = 'homeOwnerIcon'; owner.prepend(ownerIcon); }
    var searchIcon = outlineIcon('search'); searchIcon.id = 'homeSearchIcon'; search.querySelector('.zqsr-box,.zsr-box').prepend(searchIcon);
    var brand = document.createElement('a'); brand.id = 'homeBrand'; brand.href = (spa ? '/qapps/' : '/apps/') + 'zenith/Dashboard';
    brand.setAttribute('aria-label', 'ZcERP dashboard');
    var logo = document.createElement('span'); logo.className = 'home-logo'; logo.textContent = 'Zc'; brand.appendChild(logo);
    var name = document.createElement('span'); name.textContent = 'ZcERP'; brand.appendChild(name); host.prepend(brand);
    if (!spa) {
      var menu = document.createElement('button'); menu.id = 'homeMenuButton'; menu.type = 'button'; menu.setAttribute('aria-label', 'Toggle sidebar');
      menu.appendChild(outlineIcon('menu'));
      menu.addEventListener('click', function () { var toggle = document.getElementById(innerWidth > 900 ? 'z-side-toggle' : 'z-side-burger'); if (toggle) toggle.click(); });
      host.prepend(menu);
    }
    var input = search.querySelector('input');
    if (input) { input.placeholder = 'Search…'; input.setAttribute('aria-label', 'Search modules and screens'); }
    var tools = document.createElement('nav'); tools.id = 'homeUtilities'; tools.setAttribute('aria-label', 'Account tools');
    function utility(icon, href, label) {
      var link = document.createElement('a'); link.href = href; link.title = label; link.setAttribute('aria-label', label);
      link.appendChild(outlineIcon(icon));
      tools.appendChild(link); return link;
    }
    utility('calendar_today', '/apps/my/User/Calendar/MyCalendar', 'Calendar');
    var settings = (cfg.nav || []).find(function (item) { return item.label === 'Settings'; });
    if (settings) utility('settings', settings.url.replace('/apps/', spa ? '/qapps/' : '/apps/'), 'Settings');
    var bell = utility('notifications_none', '/apps/my/User/Notifications', 'Notifications');
    var sourceBadge = document.querySelector('#navbar_notification_count, #zq-toolbtns .zqtb-badge');
    var dot = document.createElement('span'); dot.className = 'home-notification-dot'; dot.hidden = true; bell.appendChild(dot);
    function notificationCount() { dot.hidden = !sourceBadge || !(Number(sourceBadge.textContent.trim()) > 0); }
    notificationCount();
    if (sourceBadge) { notificationObserver = new MutationObserver(notificationCount); notificationObserver.observe(sourceBadge, { childList: true, characterData: true, subtree: true }); }
    var sourceAvatar = document.querySelector('#z-avatar, #zq-toolbtns .zqtb-avatar');
    if (sourceAvatar) { var avatar = sourceAvatar.cloneNode(true); avatar.removeAttribute('id'); avatar.className = 'home-avatar'; tools.appendChild(avatar); }
    search.after(tools);
    navRoot = root;
  }
  function boot() {
    var root = document.getElementById('homeDashboard');
    chrome(root);
    if (!root || initialized.has(root)) return;
    var chart = root.querySelector('#homeActivityChart');
    var status = root.querySelector('#homeLayoutStatus');
    if (!status) return; // Wait for the complete SPA fragment, including when the chart is hidden.
    initialized.add(root);
    var config;
    try { config = JSON.parse(root.dataset.config); } catch (error) { status.textContent = 'Dashboard settings could not be loaded.'; return; }
    root.querySelectorAll('.home-header-controls .material-icons').forEach(function (glyph) {
      var svg = outlineIcon(glyph.textContent.trim());
      if (glyph.classList.contains('home-date-caret')) svg.classList.add('home-date-caret');
      glyph.replaceWith(svg);
    });
    if (config.redirect && /^\/apps\/zenith\//.test(config.redirect)) {
      window.location.replace(config.redirect.replace('/apps/', location.pathname.startsWith('/qapps/') ? '/qapps/' : '/apps/'));
      return;
    }
    var money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
    var svgNS = 'http://www.w3.org/2000/svg';
    function svgNode(tag, attributes, text) {
      var element = document.createElementNS(svgNS, tag);
      Object.keys(attributes).forEach(function (key) { element.setAttribute(key, attributes[key]); });
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function draw(view) {
      var data = config[view], hourly = view === 'hourly';
      if (!data) return;
      var values = data.series.map(Number), max = Math.max.apply(null, values.concat([1]));
      var step = Math.pow(10, Math.floor(Math.log10(max))), ceiling = Math.ceil(max / step) * step;
      var svg = svgNode('svg', { viewBox: '0 0 680 240', role: 'img', 'aria-label': (hourly ? "Today's hourly sales" : 'Sales Analyst') + ': ₹' + money.format(data.total) });
      svg.appendChild(svgNode('title', {}, data.cats.map(function (label, i) { return label + ': ₹' + money.format(values[i]); }).join('; ')));
      for (var i = 0; i <= 4; i++) {
        var y = 20 + i * 45, amount = ceiling * (4 - i) / 4;
        svg.appendChild(svgNode('line', { x1: 52, y1: y, x2: 666, y2: y, stroke: '#E5E7EB', 'stroke-dasharray': '4,4' }));
        svg.appendChild(svgNode('text', { x: 44, y: y + 4, 'text-anchor': 'end', fill: '#9CA3AF', 'font-size': 11 }, amount >= 1000 ? money.format(amount / 1000) + 'K' : money.format(amount)));
      }
      var points = [], slot = 610 / Math.max(values.length, 1);
      values.forEach(function (value, index) {
        var x = 55 + slot * (index + 0.5), y = 200 - value / ceiling * 180;
        points.push([x, y]);
        if (hourly) svg.appendChild(svgNode('rect', { x: x - slot * 0.3, y: y, width: slot * 0.6, height: 200 - y, rx: 4, fill: '#6DD4C8' }));
        if (index % Math.max(1, Math.ceil(values.length / 8)) === 0 || index === values.length - 1) {
          svg.appendChild(svgNode('text', { x: x, y: 224, 'text-anchor': 'middle', fill: '#6B7280', 'font-size': 11 }, data.cats[index]));
        }
      });
      if (!hourly && points.length) {
        var path = points.map(function (p, index) {
          if (!index) return 'M' + p.join(',');
          var previous = points[index - 1], middle = (previous[0] + p[0]) / 2;
          return 'C' + middle + ',' + previous[1] + ' ' + middle + ',' + p[1] + ' ' + p.join(',');
        }).join(' ');
        var defs = svgNode('defs', {}), gradient = svgNode('linearGradient', { id: 'homeSalesGradient', x1: 0, y1: 0, x2: 0, y2: 1 });
        gradient.appendChild(svgNode('stop', { offset: '0%', 'stop-color': '#3B82F6', 'stop-opacity': 0.12 }));
        gradient.appendChild(svgNode('stop', { offset: '100%', 'stop-color': '#3B82F6', 'stop-opacity': 0.01 }));
        defs.appendChild(gradient); svg.appendChild(defs);
        svg.appendChild(svgNode('path', { d: path + ' L' + points[points.length - 1][0] + ',200 L' + points[0][0] + ',200 Z', fill: 'url(#homeSalesGradient)' }));
        svg.appendChild(svgNode('path', { d: path, fill: 'none', stroke: '#2563EB', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
        points.forEach(function (p) { svg.appendChild(svgNode('circle', { cx: p[0], cy: p[1], r: 5, fill: '#2563EB', stroke: 'white', 'stroke-width': 2.5 })); });
      }
      chart.replaceChildren(svg);
      chart.setAttribute('aria-label', svg.getAttribute('aria-label'));
      root.querySelector('#baHead').textContent = '₹' + money.format(data.total);
      root.querySelector('#baSub').textContent = data.sub + ' · ' + (Number(data.total) === 0 ? 'No sales recorded' : '₹' + money.format(data.total) + ' in sales');
      var heading = root.querySelector('[data-chart-title]');
      if (heading) heading.textContent = hourly ? "Today's Hourly Sales" : 'Sales Analyst';
      root.querySelectorAll('.ba-seg-btn').forEach(function (button) { var active = button.dataset.t === view; button.classList.toggle('on', active); button.setAttribute('aria-pressed', String(active)); });
    }
    root.querySelectorAll('.ba-seg-btn').forEach(function (button) { button.addEventListener('click', function () { draw(button.dataset.t); }); });
    if (chart) draw('weekly');
    // Keep raw HTML links on the current mount; the POS terminal intentionally uses /apps.
    if (location.pathname.startsWith('/qapps/')) root.querySelectorAll('a[href^="/apps/"]').forEach(function (link) {
      if (!link.pathname.endsWith('/pos/Terminal')) link.setAttribute('href', link.getAttribute('href').replace('/apps/', '/qapps/'));
    });
    if (location.pathname.startsWith('/qapps/')) {
      config.saveUrl = config.saveUrl.replace('/apps/', '/qapps/');
      root.querySelectorAll('form[action^="/apps/"]').forEach(function (form) { form.action = form.getAttribute('action').replace('/apps/', '/qapps/'); });
    }
    // Moqui can carry same-named dashboard parameters into module links. They belong to this page.
    root.querySelectorAll('a[href]').forEach(function (link) {
      var target = new URL(link.href, location.href);
      if (target.origin !== location.origin || /\/zenith(?:\/Dashboard)?\/?$/.test(target.pathname)) return;
      ['showSettings', 'dashDate', 'dashDateTo', 'dateMode'].forEach(function (key) { target.searchParams.delete(key); });
      link.href = target.pathname + target.search + target.hash;
    });
    var widgets = Array.from(root.querySelectorAll('.dash-widget'));
    if (!widgets.length) status.textContent = 'All dashboard sections are hidden. Use Customize to show them again.';
    var wrap = document.createElement('div'); wrap.className = 'home-widgets';
    if (widgets.length) widgets[0].before(wrap);
    var order = (config.order || 'kpis,activity,snapshot,insights,modules').split(',');
    order.concat(widgets.map(function (widget) { return widget.dataset.wkey; })).forEach(function (key) {
      var widget = widgets.find(function (w) { return w.dataset.wkey === key; });
      if (widget && widget.parentNode !== wrap) wrap.appendChild(widget);
    });
    var sizes = {};
    (config.sizes || '').split(',').forEach(function (pair) { var parts = pair.split(':'); sizes[parts[0]] = parts[1]; });
    widgets.forEach(function (widget) { if (/^(half|third)$/.test(sizes[widget.dataset.wkey])) widget.dataset.size = sizes[widget.dataset.wkey]; });
    var timer, saveQueue = Promise.resolve();
    function save() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!root.isConnected) return;
        var ordered = Array.from(wrap.children);
        var body = new URLSearchParams({ order: ordered.map(function (w) { return w.dataset.wkey; }).join(','), sizes: ordered.filter(function (w) { return w.dataset.size; }).map(function (w) { return w.dataset.wkey + ':' + w.dataset.size; }).join(','), moquiSessionToken: config.token });
        status.textContent = 'Saving layout…';
        saveQueue = saveQueue.then(function () {
          return fetch(config.saveUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, credentials: 'same-origin' })
            .then(function (response) { if (!response.ok) throw new Error('Save failed'); return response.json(); })
            .then(function (result) { if (!result.saved) throw new Error('Save failed'); status.textContent = 'Layout saved.'; })
            .catch(function () { status.textContent = 'Layout could not be saved. Reload and try again.'; });
        });
      }, 250);
    }
    root.classList.toggle('home-customizing', Boolean(config.customize));
    widgets.forEach(function (widget) {
      var handle = widget.querySelector('.dash-handle');
      if (handle) handle.remove();
      if (!config.customize) return;
      var controls = document.createElement('div'); controls.className = 'home-widget-controls';
      [['Move up', -1], ['Move down', 1], ['Resize', 0]].forEach(function (action) {
        var button = document.createElement('button'); button.type = 'button'; button.textContent = action[0];
        button.setAttribute('aria-label', action[0] + ' ' + widget.dataset.wkey);
        button.addEventListener('click', function () {
          if (action[1] < 0 && widget.previousElementSibling) wrap.insertBefore(widget, widget.previousElementSibling);
          if (action[1] > 0 && widget.nextElementSibling) wrap.insertBefore(widget.nextElementSibling, widget);
          if (!action[1]) { var next = { full: 'half', half: 'third', third: 'full' }[widget.dataset.size || 'full']; if (next === 'full') delete widget.dataset.size; else widget.dataset.size = next; }
          save(); button.focus();
        });
        controls.appendChild(button);
      });
      widget.prepend(controls);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  new MutationObserver(boot).observe(document.documentElement, { childList: true, subtree: true });
})();
