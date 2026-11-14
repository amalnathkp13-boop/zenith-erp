/* KOT Dashboard sales chart, shared by /apps and /qapps. */
(function () {
  'use strict';

  const currency = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'});
  const compact = new Intl.NumberFormat('en-IN', {notation: 'compact', maximumFractionDigits: 1});
  const byId = id => document.getElementById(id);
  const width = 600;
  const height = 180;
  let chart;
  let points = [];
  let positions = [];
  let peak = 0;
  let selected = 0;

  function selectPoint(index, announce = false) {
    const point = points[index];
    const box = byId('kd-chartbox');
    if (!point || !box) return;
    selected = index;

    const [x, y] = positions[index];
    box.style.setProperty('--kd-point-x', `${x / width * 100}%`);
    box.style.setProperty('--kd-point-y', `${y / height * 100}%`);
    byId('kd-guide').hidden = false;
    byId('kd-dot').hidden = false;
    const sales = currency.format(point.sales);
    byId('kd-tip-label').textContent = point.label;
    byId('kd-tip-sales').textContent = sales;
    byId('kd-tip-orders').textContent = point.orders;
    const tip = byId('kd-tip');
    tip.hidden = false;
    tip.classList.toggle('kd-tip--below', y / height * box.clientHeight < tip.offsetHeight + 5);
    const halfWidth = tip.offsetWidth / 2;
    box.style.setProperty('--kd-tip-inset', `${halfWidth + 2}px`);
    if (announce) byId('kd-chart-status').textContent = `${point.label}, sales ${sales}, ${point.orders} orders`;
  }

  function draw(range, button) {
    const series = chart[range];
    points = series.points;
    const values = points.map(point => Number(point.sales));
    byId('kd-wrap').querySelectorAll('.kd-ctab').forEach(tab => {
      tab.classList.toggle('is-active', tab === button);
      tab.setAttribute('aria-pressed', String(tab === button));
    });
    byId('kd-trend-sub').textContent = range === 'today' ? 'Hourly sales and order volume' : 'Daily sales and order volume';
    byId('kd-axis').replaceChildren(...series.axis.map(label => {
      const span = document.createElement('span');
      span.textContent = label;
      return span;
    }));

    const highest = Math.max(1, ...values);
    const lowest = Math.min(0, ...values);
    const magnitude = 10 ** Math.floor(Math.log10((highest - lowest) / 5));
    const step = [1, 2, 2.5, 5, 10].find(unit => unit * magnitude * 5 >= highest - lowest) * magnitude;
    const bottom = Math.floor(lowest / step) * step;
    const top = Math.max(bottom + step * 5, Math.ceil(highest / step) * step);
    const y = sales => height * (top - sales) / (top - bottom);
    const spacing = width / (points.length - (range === 'today' ? 0 : 1));
    positions = values.map((value, i) => [i * spacing, y(value)]);

    const labels = [];
    const grid = [];
    for (let sale = top; sale >= bottom - step / 10; sale -= step) {
      const label = document.createElement('span');
      label.textContent = `${sale < 0 ? '−' : ''}₹ ${compact.format(Math.abs(sale))}`;
      labels.push(label);
      grid.push(`<path d="M0 ${y(sale)}H${width}"/>`);
    }
    byId('kd-axis-y').replaceChildren(...labels);

    // Keep each curve inside the values of its two adjacent buckets.
    let line = positions.reduce((path, [x, y], i) => {
      if (!i) return `M${x} ${y}`;
      const [lastX, lastY] = positions[i - 1];
      const midX = (lastX + x) / 2;
      return `${path} C${midX} ${lastY} ${midX} ${y} ${x} ${y}`;
    }, '');
    if (range === 'today') line += ` H${width}`;
    const zero = y(0);
    byId('kd-svg').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs><linearGradient id="kdgrad" x2="0%" y2="100%"><stop class="kd-area-start"/><stop offset="100%" class="kd-area-end"/></linearGradient></defs>
      <g class="kd-grid">${grid.join('')}</g>
      <path d="${line} V${zero} H0 Z" fill="url(#kdgrad)"/>
      <path d="${line}" class="kd-line"/>
    </svg>${[...positions.filter((_, i) => i % Math.ceil(points.length / 8) === 0 || i === points.length - 1),
      ...(range === 'today' ? [[width, positions.at(-1)[1]]] : [])].map(([x, y]) =>
      `<i class="kd-point" style="left:${x / width * 100}%;top:${y / height * 100}%"></i>`).join('')}`;

    if (points.some(point => point.orders > 0)) {
      peak = points.reduce((best, point, index) => point.orders && (best === -1 || point.sales > points[best].sales) ? index : best, -1);
      selectPoint(peak);
    } else {
      peak = 0;
      selected = 0;
      for (const id of ['kd-dot', 'kd-guide', 'kd-tip']) byId(id).hidden = true;
    }
  }

  window.kdRange = draw;
  window.kdSetDate = value => {
    if (!value) return;
    const target = new URL(location.href);
    target.searchParams.set('dashDate', value);
    location.assign(target.href);
  };
  window.kdRefresh = () => {
    byId('kd-refresh').classList.add('spin');
    location.reload();
  };
  window.kdInit = function () {
    const data = byId('kd-data');
    if (!data || data.dataset.initialized) return;
    chart = JSON.parse(data.dataset.chart);
    data.dataset.initialized = 'true';
    draw('today', byId('kd-wrap').querySelector('[data-r="today"]'));

    const box = byId('kd-chartbox');
    box.addEventListener('pointermove', event => {
      const rect = box.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * width;
      const spacing = positions[1][0];
      selectPoint(Math.max(0, Math.min(points.length - 1, Math.round(x / spacing))));
    });
    box.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch' && points[peak].orders) selectPoint(peak); });
    box.addEventListener('focus', () => selectPoint(selected, true));
    box.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectPoint(Math.max(0, Math.min(points.length - 1, selected + (event.key === 'ArrowLeft' ? -1 : 1))), true);
    });
  };
  window.kdInit();
})();
