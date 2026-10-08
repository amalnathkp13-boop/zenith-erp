/* KOT Table Management — client behaviour.
 * Loaded via an <img onload> bootstrap from Tables.xml so it runs on both /apps (Bootstrap)
 * and /qapps (Quasar/Vue, which strips inline <script>). Plain JS here — no Vue-template constraints. */
(function () {
  if (window.__tmInit) return;
  window.__tmInit = true;

  function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function base() { return location.pathname.replace(/\/$/, ''); }

  // Moqui session token: WebrootVue on /qapps, hidden-input fallback on /apps.
  function tok() {
    try {
      if (window.moqui && window.moqui.webrootVue && window.moqui.webrootVue.moquiSessionToken) {
        return window.moqui.webrootVue.moquiSessionToken;
      }
    } catch (e) { /* ignore */ }
    var h = document.getElementById('tm-token');
    return h ? h.value : '';
  }

  // Read-only redirect transitions (goTerminal/goTransactions) — plain GET is fine.
  window.tmGo = function (path) { location.href = base() + '/' + path; };

  // State-changing transitions must be POSTed with the session token (Moqui CSRF guard).
  window.tmPost = function (path, params) {
    var f = document.createElement('form');
    f.method = 'POST';
    f.action = base() + '/' + path;
    f.style.display = 'none';
    function add(n, v) {
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = n; i.value = (v == null ? '' : v);
      f.appendChild(i);
    }
    if (params) {
      for (var k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) add(k, params[k]); }
    }
    add('moquiSessionToken', tok());
    document.body.appendChild(f);
    f.submit();
  };

  window.tmSelect = function (id) {
    qsa('.tm-card').forEach(function (c) {
      c.classList.toggle('is-selected', c.getAttribute('data-table-id') === id);
    });
    qsa('.tm-panel').forEach(function (p) {
      p.style.display = (p.getAttribute('data-table-id') === id) ? 'block' : 'none';
    });
    var e = document.getElementById('tm-panel-empty'); if (e) e.style.display = 'none';
    var w = document.getElementById('tm-wrap'); if (w) w.setAttribute('data-selected', id);
    var d = document.getElementById('tm-ebtn-delete'); if (d) { d.classList.remove('is-disabled'); d.disabled = false; }
  };

  window.tmClosePanel = function () {
    qsa('.tm-card').forEach(function (c) { c.classList.remove('is-selected'); });
    qsa('.tm-panel').forEach(function (p) { p.style.display = 'none'; });
    var e = document.getElementById('tm-panel-empty'); if (e) e.style.display = 'block';
    var w = document.getElementById('tm-wrap'); if (w) w.removeAttribute('data-selected');
    var d = document.getElementById('tm-ebtn-delete'); if (d) { d.classList.add('is-disabled'); d.disabled = true; }
  };

  window.tmFilter = function (f, el) {
    qsa('.tm-fpill').forEach(function (p) { p.classList.toggle('is-active', p === el); });
    qsa('.tm-card, .tm-table tbody tr[data-status]').forEach(function (c) {
      c.style.display = (f === 'all' || c.getAttribute('data-status') === f) ? '' : 'none';
    });
    // A filtered-out table must not leave its write actions selected.
    window.tmClosePanel();
  };

  window.tmView = function (mode, el) {
    var w = document.getElementById('tm-wrap'); if (!w) return;
    if (mode === 'list') { w.classList.add('view-list'); } else { w.classList.remove('view-list'); }
    qsa('.tm-viewbtn').forEach(function (b) {
      var on = (b === el);
      b.classList.toggle('is-active', on);
      b.classList.toggle('is-primary', on);
    });
  };

  window.tmEdit = function () {
    var w = document.getElementById('tm-wrap'); if (!w) return;
    var on = w.classList.toggle('edit-on');
    var btn = document.getElementById('tm-editbtn');
    if (btn) { btn.classList.toggle('is-active', on); btn.classList.toggle('is-primary', on); }
  };

  window.tmDelete = function () {
    var w = document.getElementById('tm-wrap'); if (!w) return;
    var id = w.getAttribute('data-selected'); if (!id) return;
    if (!confirm('Delete this table?')) return;
    window.tmPost('deleteTable', { tableId: id });
  };

  window.tmModal = function (open) {
    var m = document.getElementById('tm-addmodal'); if (!m) return;
    if (open) {
      m.classList.add('open');
      var n = document.getElementById('tm-f-num'); if (n) n.focus();
    } else {
      m.classList.remove('open');
    }
  };

  window.tmAddSave = function () {
    var num = document.getElementById('tm-f-num');
    if (!num || !num.value.trim()) { if (num) num.focus(); return; }
    var body = new URLSearchParams();
    body.append('tableNumber', num.value.trim());
    body.append('tableName', (document.getElementById('tm-f-name') || {}).value || '');
    body.append('seatingCapacity', (document.getElementById('tm-f-seat') || {}).value || '4');
    body.append('sectionName', (document.getElementById('tm-f-sec') || {}).value || 'Main');
    var fac = document.getElementById('tm-f-fac');
    if (fac && fac.value) body.append('facilityId', fac.value);
    body.append('statusId', 'TblAvailable');
    body.append('moquiSessionToken', tok());
    var btn = document.getElementById('tm-addsave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    fetch(base() + '/createTable', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }).then(function (r) {
      location.href = r.url || location.href;
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Add Table'; }
      alert('Could not add table.');
    });
  };
})();
