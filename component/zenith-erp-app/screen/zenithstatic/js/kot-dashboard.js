/* KOT Dashboard — inline-SVG sales chart + interactions.
 * Loaded via <img onload> from KotDashboard.xml so it runs on both /apps and /qapps. */
(function () {
  if (window.kdInit) { window.kdInit(); return; }

  var CHART = { today: { values: [], points: [], axis: [] } };
  var curRange = 'today';
  var ptsFrac = [];   // [fracX, fracY] per point
  var curVals = [];
  var curPoints = [];
  var peakIdx = 0;

  var VB_W = 600, VB_H = 220, padT = 12, padB = 8, padL = 2, padR = 2;

  function $(id) { return document.getElementById(id); }
  function base() { return location.pathname.replace(/\/$/, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function inr(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    var neg = n < 0; n = Math.abs(n);
    var s = n.toFixed(2), ip = s.split('.')[0], fp = s.split('.')[1], res;
    if (ip.length <= 3) { res = ip; }
    else {
      var last3 = ip.slice(-3), rest = ip.slice(0, -3), out = '';
      while (rest.length > 2) { out = ',' + rest.slice(-2) + out; rest = rest.slice(0, -2); }
      res = rest + out + ',' + last3;
    }
    return (neg ? '-' : '') + '₹' + res + '.' + fp;
  }

  function niceMax(m) {
    if (m <= 0) return 10;
    var pow = Math.pow(10, Math.floor(Math.log(m) / Math.LN10));
    var n = m / pow, step;
    if (n <= 1) step = 1; else if (n <= 2) step = 2; else if (n <= 5) step = 5; else step = 10;
    return step * pow;
  }

  function draw(series) {
    var vals = (series.values || []).map(Number), n = vals.length;
    curVals = vals; curPoints = series.points || [];
    if (!n) { $('kd-svg').innerHTML = '<div class="kd-chart__empty">No sales data for this period.</div>'; ptsFrac = []; return; }
    var max = niceMax(Math.max.apply(null, vals.concat([1])));
    var X = function (i) { return padL + (VB_W - padL - padR) * (n <= 1 ? 0.5 : i / (n - 1)); };
    var Y = function (v) { return padT + (VB_H - padT - padB) * (1 - v / max); };
    var pts = vals.map(function (v, i) { return [X(i), Y(v)]; });
    ptsFrac = pts.map(function (p) { return [p[0] / VB_W, p[1] / VB_H]; });

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + X(n - 1).toFixed(1) + ',' + (VB_H - padB) + ' L' + X(0).toFixed(1) + ',' + (VB_H - padB) + ' Z';
    var grid = '';
    for (var g = 0; g <= 4; g++) { var gy = (padT + (VB_H - padT - padB) * g / 4).toFixed(1); grid += '<line x1="0" y1="' + gy + '" x2="' + VB_W + '" y2="' + gy + '" stroke="#E5E7EB" stroke-width="1" stroke-opacity="0.7" vector-effect="non-scaling-stroke"/>'; }

    var svg = '<svg viewBox="0 0 ' + VB_W + ' ' + VB_H + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="kdgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2563EB" stop-opacity="0.18"/><stop offset="100%" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#kdgrad)"/>' +
      '<path d="' + line + '" fill="none" stroke="#2563EB" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      '</svg>';
    $('kd-svg').innerHTML = svg;

    // peak point (highest value) gets the default tooltip, like the mockup
    peakIdx = 0; for (var i = 1; i < vals.length; i++) { if (vals[i] > vals[peakIdx]) peakIdx = i; }
    showTip(peakIdx);
  }

  function ensureDot() {
    var dot = $('kd-dot');
    if (!dot) {
      dot = document.createElement('div'); dot.id = 'kd-dot';
      dot.style.cssText = 'position:absolute;width:11px;height:11px;border-radius:50%;background:#2563EB;border:2px solid #fff;box-shadow:0 0 0 1px #2563EB;transform:translate(-50%,-50%);pointer-events:none;display:none;z-index:4';
      var box = $('kd-chartbox'); if (box) box.appendChild(dot);
    }
    return dot;
  }

  function showTip(i) {
    if (!ptsFrac.length || i == null || i < 0 || i >= ptsFrac.length) return;
    var box = $('kd-chartbox'); if (!box) return;
    var w = box.clientWidth, h = box.clientHeight;
    var px = ptsFrac[i][0] * w, py = ptsFrac[i][1] * h;
    var dot = ensureDot(); dot.style.left = px + 'px'; dot.style.top = py + 'px'; dot.style.display = 'block';
    var tip = $('kd-tip');
    if (tip) {
      tip.innerHTML = '<span>' + esc(curPoints[i] || '') + '</span><b>' + inr(curVals[i] || 0) + '</b>';
      tip.style.left = Math.max(40, Math.min(w - 40, px)) + 'px';
      tip.style.top = py + 'px';
      tip.style.display = 'block';
    }
  }

  function renderAxis(series) {
    var ax = $('kd-axis'); if (!ax) return;
    ax.innerHTML = (series.axis || []).map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('');
  }

  window.kdRange = function (r, el) {
    curRange = r;
    document.querySelectorAll('.kd-ctab').forEach(function (b) { b.classList.toggle('is-active', b === el); });
    var s = CHART[r] || { values: [], points: [], axis: [] };
    renderAxis(s); draw(s);
  };
  window.kdSetDate = function (v) { if (v) location.href = base() + '/?dashDate=' + encodeURIComponent(v); };
  window.kdRefresh = function () { var b = $('kd-refresh'); if (b) b.classList.add('spin'); location.reload(); };
  window.kdGo = function (path) { location.href = base() + '/' + path; };

  window.kdInit = function () {
    var el = $('kd-data');
    if (!el || el.dataset.initialized) return;
    el.dataset.initialized = 'true';
    try { CHART = JSON.parse(el.getAttribute('data-chart') || '{}'); } catch (e) { CHART = {}; }
    var s = CHART.today || { values: [], points: [], axis: [] };
    renderAxis(s); draw(s);

    var box = $('kd-chartbox');
    if (box) {
      box.addEventListener('mousemove', function (e) {
        if (!ptsFrac.length) return;
        var rect = box.getBoundingClientRect(), mx = e.clientX - rect.left, w = rect.width;
        var best = 0, bd = 1e9;
        for (var i = 0; i < ptsFrac.length; i++) { var d = Math.abs(ptsFrac[i][0] * w - mx); if (d < bd) { bd = d; best = i; } }
        showTip(best);
      });
      box.addEventListener('mouseleave', function () { showTip(peakIdx); });
    }
  };
  window.addEventListener('resize', function () { showTip(peakIdx); });
  window.kdInit();
})();
