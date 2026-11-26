const assetVersion = new URL(import.meta.url).search;
const [{ installPeople }, { installSalaryAndSettings }] = await Promise.all([
  import('./hr-people.js' + assetVersion),
  import('./hr-payroll-settings.js' + assetVersion),
]);

function updateLeaveBadge() {
  const count = document.getElementById('zc-hr-workspace')?.dataset.pendingLeaves;
  if (count === undefined) return;
  for (const badge of document.querySelectorAll('[data-match="/Hr/Leave"] .hr-leave-count')) {
    badge.textContent = count;
    badge.hidden = count === '0';
  }
}
document.addEventListener('zc:subnav-updated', updateLeaveBadge);

export async function openWorkspace(host) {
  if (!host || host.shadowRoot) return;
  const view = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = host.dataset.css;
  view.append(style);
  const markup = document.createElement('template');
  markup.innerHTML = `<div class="main"><div id="page-content" tabindex="-1" aria-live="polite">Loading HR workspace…</div><footer class="main-footer"><span><strong>ZcERP</strong> · Human resources</span><span id="working-date"></span></footer></div>
 <dialog id="modal" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title"></h2><p id="modal-subtitle"></p></div><button class="icon-btn" data-modal-close aria-label="Close dialog" id="modal-close"></button></div><div class="modal-body" id="modal-body"></div><div class="modal-footer" id="modal-footer"></div></dialog>
<div class="toast-area" id="toast-area" role="status" aria-live="polite"></div>
 <dialog id="save-problem" aria-labelledby="save-problem-title"><div class="modal-header"><h2 id="save-problem-title">Changes could not be saved</h2></div><div class="modal-body"><p></p></div><div class="modal-footer"><button class="btn btn-secondary" data-discard>Discard edit</button><button class="btn btn-primary" data-retry>Retry</button></div></dialog>`;
  view.append(markup.content);
  const H = { page: host.dataset.page, ui: {}, renderers: {}, afterRender: {} };
  let revision, confirmed;
  let employeesById, attendanceByDay, leavesByEmployee;
  function setRecords(state) {
    H.state = state;
    employeesById = new Map(state.employees.map((employee) => [employee.id, employee]));
    attendanceByDay = new Map();
    for (const record of state.attendance) {
      const key = record.employeeId + '|' + record.date;
      if (!attendanceByDay.has(key)) attendanceByDay.set(key, record);
    }
    leavesByEmployee = new Map();
    for (const leave of state.leaves) {
      if (!leavesByEmployee.has(leave.employeeId)) leavesByEmployee.set(leave.employeeId, []);
      leavesByEmployee.get(leave.employeeId).push(leave);
    }
  }
  function apply(result) {
    setRecords(result.state);
    H.today = result.today;
    H.month = H.today.slice(0, 7);
    revision = result.revision;
    confirmed = JSON.stringify(H.state);
    view.getElementById('working-date').textContent = 'Working date: ' + H.date(H.today);
  }
  async function read() {
    const res = await fetch(host.dataset.read, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Unable to open this HR workspace.');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unable to open this HR workspace.');
    return data;
  }
  async function load() {
    try {
      apply(await read());
      H.render();
      if (location.hash === '#daily-attendance-register') {
        const register = view.getElementById('daily-attendance-register');
        register?.focus({ preventScroll: true });
        register?.scrollIntoView({ block: 'start' });
      }
    } catch (err) {
      const page = view.getElementById('page-content');
      page.innerHTML =
        '<div class="notice notice-warning" role="alert"><span></span><button class="btn btn-secondary">Retry</button></div>';
      page.querySelector('span').textContent = err.message;
      page.querySelector('button').onclick = load;
    }
  }
  H.reload = load;
  H.documentUrl = (id) => `${host.dataset.document}?documentId=${encodeURIComponent(id)}`;
  H.uploadDocument = async (employeeCode, file) => {
    const body = new FormData();
    body.append('employeeCode', employeeCode);
    body.append('documentFile', file);
    body.append('moquiSessionToken', host.dataset.token);
    const response = await fetch(host.dataset.upload, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', moquiSessionToken: host.dataset.token },
      body,
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || `Unable to upload ${file.name}.`);
    return result.documentId;
  };
  let busy = false;
  H.save = async (message) => {
    if (busy) return false;
    busy = true;
    const content = view.querySelector('.main'),
      modal = view.getElementById('modal');
    content.inert = true;
    modal.inert = true;
    const body = JSON.stringify({
      workspace: JSON.stringify(H.state),
      revision,
      message,
      moquiSessionToken: host.dataset.token,
    });
    try {
      while (true) {
        let conflict = false;
        try {
          const response = await fetch(host.dataset.save, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              moquiSessionToken: host.dataset.token,
            },
            body,
          });
          const result = await response.json();
          if (result.success && response.ok) {
            apply(result);
            return true;
          }
          conflict = Boolean(result.conflict);
          throw new Error(result.error || 'Unable to save the HR changes.');
        } catch (error) {
          const problem = view.getElementById('save-problem');
          problem.querySelector('p').textContent =
            error.message +
            (conflict
              ? ' Reload the latest records before reapplying your edit.'
              : ' Your edit is still here.');
          const discard = problem.querySelector('[data-discard]'),
            retry = problem.querySelector('[data-retry]');
          discard.textContent = conflict ? 'Discard edit and reload' : 'Discard edit';
          retry.hidden = conflict;
          const keep = await new Promise((done) => {
            retry.onclick = () => done(true);
            discard.onclick = () => done(false);
            problem.oncancel = (e) => e.preventDefault();
            problem.showModal();
          });
          problem.close();
          if (keep) continue;
          H.closeModal();
          setRecords(JSON.parse(confirmed));
          if (conflict) await load();
          else H.render();
          return false;
        }
      }
    } finally {
      content.inert = false;
      modal.inert = false;
      busy = false;
    }
  };
  H.employee = (id) => employeesById.get(id);
  H.activeEmployees = () => H.state.employees.filter((e) => e.status !== 'Inactive');
  H.employedDuring = (employee, from, to = from) =>
    (employee.status !== 'Inactive' || employee.leavingDate) &&
    employee.joined <= to &&
    (!employee.leavingDate || employee.leavingDate >= from);
  H.employeesForPeriod = (from, to = from) => H.state.employees.filter((e) => H.employedDuring(e, from, to));
  H.isWorkday = (date) =>
    H.state.settings.workdays.includes(new Date(date + 'T12:00:00Z').getUTCDay()) &&
    !H.state.settings.holidays.some((h) => h.date === date);
  H.workingDays = (from, to) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to)
      return 0;
    const a = new Date(from + 'T12:00:00Z'),
      b = new Date(to + 'T12:00:00Z');
    if ((b - a) / 86400000 > 366) return 0;
    let n = 0;
    for (let d = a; d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
      if (H.isWorkday(d.toISOString().slice(0, 10))) n++;
    }
    return n;
  };
  H.calendarChangeError = (change) => {
    const next = { ...H.state.settings, ...change };
    const count = (leave, settings) => {
      let n = 0;
      for (
        let d = new Date(leave.from + 'T12:00:00Z'), end = new Date(leave.to + 'T12:00:00Z');
        d <= end;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const iso = d.toISOString().slice(0, 10);
        if (settings.workdays.includes(d.getUTCDay()) && !settings.holidays.some((h) => h.date === iso)) n++;
      }
      return leave.halfDay && n ? 0.5 : n;
    };
    const affected = H.state.leaves.find(
      (l) => ['Approved', 'Pending'].includes(l.status) && count(l, H.state.settings) !== count(l, next),
    );
    return affected
      ? 'This calendar change would alter an existing ' +
          affected.status.toLowerCase() +
          ' leave request for ' +
          (H.employee(affected.employeeId)?.name || affected.employeeId) +
          '. Cancel that request before changing its working days.'
      : '';
  };
  H.attendanceFor = (employeeId, date) => {
    const e = H.employee(employeeId);
    if (e && date < e.joined)
      return { status: 'Not joined', leaveDays: 0, checkIn: '', checkOut: '', note: '' };
    if (e?.leavingDate && date > e.leavingDate)
      return { status: 'Not employed', leaveDays: 0, checkIn: '', checkOut: '', note: '' };
    const holiday = H.state.settings.holidays.find((h) => h.date === date);
    if (holiday) return { status: 'Holiday', leaveDays: 0, checkIn: '', checkOut: '', note: holiday.name };
    if (!H.state.settings.workdays.includes(new Date(date + 'T12:00:00Z').getUTCDay()))
      return { status: 'Weekly off', leaveDays: 0, checkIn: '', checkOut: '', note: '' };
    const leave = leavesByEmployee
      .get(employeeId)
      ?.find((l) => l.status === 'Approved' && l.from <= date && l.to >= date);
    const record = attendanceByDay.get(employeeId + '|' + date);
    if (leave)
      return {
        ...record,
        status: leave.halfDay ? 'Half-day' : 'On leave',
        leaveDays: leave.halfDay ? 0.5 : 1,
        checkIn: leave.halfDay ? record?.checkIn || '' : '',
        checkOut: leave.halfDay ? record?.checkOut || '' : '',
        note: leave.halfDay ? 'Approved half-day ' + leave.type.toLowerCase() : leave.type,
      };
    return record
      ? { ...record, leaveDays: 0 }
      : { status: 'Not marked', leaveDays: 0, checkIn: '', checkOut: '', note: '' };
  };
  H.leaveBalance = (employeeId, type) => {
    if (type === 'Unpaid leave') return Infinity;
    const allowance = H.state.settings.leaveTypes.find((t) => t.name === type)?.days || 0;
    return (
      allowance -
      H.state.leaves
        .filter(
          (l) =>
            l.employeeId === employeeId &&
            l.type === type &&
            l.status === 'Approved' &&
            l.from.startsWith(H.today.slice(0, 4)),
        )
        .reduce((n, l) => n + Number(l.days), 0)
    );
  };
  H.esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    trend: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
    cart: '<path d="M2 3h3l3 12h11l3-9H6M9 20h.01M18 20h.01"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    store: '<path d="M4 9h16l1 12H3ZM6 9l1-6h10l1 6M6 17h12M9 12v2M12 12v2M15 12v2"/>',
    receipt: '<path d="M5 2h14v20l-3-2-4 2-4-2-3 2ZM8 6h8M8 10h8M8 14h5"/>',
    utensils: '<path d="M4 3v7m3-7v7m3-7v7M4 7h6M7 10v11M18 3c-5 5-4 11 0 11V3Zm0 11v7"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
    inventory: '<path d="M3 4h18v5H3ZM5 9v12h14V9M9 13h6"/>',
    shop: '<path d="M3 9 5 3h14l2 6M3 9c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0M4 12v9h16v-9M9 21v-7h6v7M8 3 7 9m5-6v6m4-6 1 6"/>',
    barcode: '<path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 7v10M10 7v10M14 7v10M17 7v10"/>',
    sliders: '<path d="M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10M9 3v6M14 9v6M6 15v6"/>',
    history: '<path d="M3 4v5h5M4 9a8 8 0 1 1 0 6M12 7v5l-3 2"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    wallet:
      '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M16 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>',
    clipboardReview:
      '<path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="4" rx="2"/><path d="M10 11h6M10 16h6M7 11h.01M7 16h.01"/>',
    banknoteClock:
      '<path d="M12 18H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><circle cx="11" cy="11" r="3"/><path d="M5 7h.01M5 15h.01M19 7h.01"/><circle cx="18" cy="17" r="4"/><path d="M18 15v2l1.5 1"/>',
    banknoteCheck:
      '<path d="M12 18H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5"/><circle cx="11" cy="11" r="3"/><path d="M5 7h.01M5 15h.01M19 7h.01"/><circle cx="18" cy="17" r="4"/><path d="m16 17 1.3 1.3L20 15.5"/>',
    settings:
      '<path d="m9 3-.6 2.2-2 .9-2-.6L2 9l1.7 1.6v2.8L2 15l2.4 3.5 2-.6 2 .9L9 21h6l.6-2.2 2-.9 2 .6L22 15l-1.7-1.6v-2.8L22 9l-2.4-3.5-2 .6-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="10.8" cy="10.8" r="7.4"/><path d="m16.3 16.3 4.7 4.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15v5ZM12 20h8"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrowLeft: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    phone: '<path d="m5 3 4 5-2 3a15 15 0 0 0 6 6l3-2 5 4-1 3C10 23 1 14 2 4Z"/>',
    briefcase:
      '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 4 13 4 18 0M12 11v5"/>',
    building:
      '<path d="M4 21V3h13v18M2 21h20M17 10h4v11M8 7h1m3 0h1M8 11h1m3 0h1M8 15h1m3 0h1M9 21v-3h4v3"/>',
    file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 12h8M8 16h8"/>',
    shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
    filter: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M18 18A8 8 0 0 1 4 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.7 2.7 0 0 1 5 .9c0 2-2.5 2.2-2.5 4.1M12 17h.01"/>',
    logout: '<path d="M9 3H3v18h6M9 12h12m-4-4 4 4-4 4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    arrowUp: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    arrowDown: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    external: '<path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/>',
    print: '<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 13h12v8H6Z"/>',
    save: '<path d="M3 3h15l3 3v15H3ZM7 3v6h9V3M7 21v-8h10v8"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  };
  H.icon = (name, size = 18) =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
  H.avatar = (employee, small = false) => {
    const e = employee || { name: 'Unknown', color: 'purple' };
    return `<span class="avatar ${H.esc(e.color || 'purple')} ${small ? 'small' : ''}" aria-hidden="true">${H.esc(
      e.name
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => n[0])
        .slice(0, 2)
        .join(''),
    )}</span>`;
  };
  H.badge = (status) => {
    const colors = {
      Active: 'green',
      Present: 'green',
      Approved: 'green',
      Paid: 'green',
      Finalized: 'green',
      'On probation': 'orange',
      Pending: 'orange',
      'Half-day': 'orange',
      Unpaid: 'orange',
      Absent: 'red',
      Rejected: 'red',
      'On leave': 'purple',
      Draft: 'blue',
      'Not marked': 'orange',
    };
    return `<span class="badge ${colors[status] || ''}">${H.esc(status)}</span>`;
  };
  H.money = (value) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    }).format(Number(value) || 0);
  H.date = (value, options) => {
    if (!value) return '—';
    const d = new Date(value.length === 10 ? value + 'T12:00:00Z' : value);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
          ...options,
        });
  };
  H.field = (label, control, hint = '') =>
    `<label class="field"><span>${H.esc(label)}</span>${control}${hint ? `<small class="field-hint">${H.esc(hint)}</small>` : ''}</label>`;
  H.empty = (title, description = '') =>
    `<div class="empty-state"><div class="empty-state-icon">${H.icon('search', 22)}</div><strong>${H.esc(title)}</strong><p>${H.esc(description)}</p></div>`;
  H.toast = (message, type = 'success') => {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = H.icon(type === 'error' || type === 'warning' ? 'alert' : 'checkCircle') + '<span></span>';
    el.querySelector('span').textContent = message;
    view.getElementById('toast-area').append(el);
    setTimeout(() => el.remove(), 4200);
  };
  H.closeModal = () => {
    const d = view.getElementById('modal');
    if (d.open) d.close();
  };
  H.openModal = ({ title, subtitle = '', body, footer = '', wide = false, onMount }) => {
    const d = view.getElementById('modal');
    if (d.open) d.close();
    d.classList.toggle('wide', wide);
    view.getElementById('modal-title').textContent = title;
    view.getElementById('modal-subtitle').textContent = subtitle;
    view.getElementById('modal-subtitle').hidden = !subtitle;
    view.getElementById('modal-body').innerHTML = body;
    view.getElementById('modal-footer').innerHTML = footer;
    view.getElementById('modal-footer').hidden = !footer;
    d.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', H.closeModal));
    H.decorateKpis?.(d);
    d.showModal();
    onMount?.(d);
  };
  H.confirm = ({ title, body, confirmLabel = 'Confirm', onConfirm, danger = false }) =>
    H.openModal({
      title,
      body,
      footer: `<button class="btn btn-secondary" data-modal-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-action">${H.esc(confirmLabel)}</button>`,
      onMount: (d) =>
        d.querySelector('#confirm-action').addEventListener('click', () => {
          H.closeModal();
          onConfirm();
        }),
    });
  H.csv = (filename, rows) => {
    const safe = (v) => {
      let s = String(v ?? '');
      if (typeof v === 'string' && /^\s*[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const data = '\uFEFF' + rows.map((row) => row.map(safe).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  H.printHtml = (html, title) => {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.append(frame);
    const page = frame.contentDocument;
    page.title = title;
    page.body.innerHTML = '<main id="print-root">' + html + '</main>';
    const css = page.createElement('link');
    css.rel = 'stylesheet';
    css.href = host.dataset.css;
    css.onload = () => {
      frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
      frame.contentWindow.focus();
      frame.contentWindow.print();
    };
    css.onerror = () => {
      frame.remove();
      H.toast('Unable to load the payslip print layout.', 'error');
    };
    page.head.append(css);
  };
  view.getElementById('modal-close').innerHTML = H.icon('x');
  view.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        H.closeModal();
    }
  });
  installPeople(H, view);
  installSalaryAndSettings(H, view);
  const $ = (s) => view.querySelector(s),
    E = H.esc;
  const pages = {
    dashboard: 'Dashboard',
    employees: 'Directory',
    attendance: 'Attendance',
    leave: 'Leave',
    payroll: 'Salary',
    reports: 'Reports',
    settings: 'Settings',
  };
  H.navigate = (page, hash = '') => {
    const route = pages[page];
    if (route) {
      const url = new URL(host.dataset.read, location.href);
      url.pathname = url.pathname.replace(/\/[^/]+\/readWorkspace$/, '/' + route);
      if (location.pathname.startsWith('/qapps/'))
        url.pathname = url.pathname.replace(/^\/apps\//, '/qapps/');
      url.hash = hash;
      location.assign(url.href);
    }
  };
  const stat = (label, value, foot, icon, color = '') =>
    `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${H.icon(icon)}</span><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;
  const pending = () => H.state.leaves.filter((l) => l.status === 'Pending');
  H.renderers.dashboard = () => {
    const employees = H.activeEmployees(),
      records = employees.map((e) => H.attendanceFor(e.id, H.today));
    const n = (status) => records.filter((r) => r.status === status).length;
    const present = n('Present'),
      leave = n('On leave'),
      absent = n('Absent'),
      half = n('Half-day'),
      unmarked = n('Not marked');
    const monday = new Date(H.today + 'T12:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const weekdays = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + offset);
      return date;
    })
      .filter((d) => H.state.settings.workdays.includes(d.getUTCDay()))
      .map((d) => d.toISOString().slice(0, 10));
    const weekPeriod = weekdays.length
      ? H.date(weekdays[0], {
          day: 'numeric',
          month: weekdays[0].slice(0, 7) === weekdays.at(-1).slice(0, 7) ? undefined : 'short',
          year: undefined,
        }) +
        '–' +
        H.date(weekdays.at(-1), { day: 'numeric', month: 'long', year: undefined })
      : 'This week';
    const chart = weekdays.map((date) => ({
      date,
      count: H.employeesForPeriod(date).filter((e) => H.attendanceFor(e.id, date).status === 'Present')
        .length,
    }));
    const segments = [
      { label: 'Present', value: present, color: 'var(--green)' },
      { label: 'On leave', value: leave, color: 'var(--primary)' },
      { label: 'Absent', value: absent, color: 'var(--red)' },
      { label: 'Half-day', value: half, color: 'var(--orange)' },
      ...(unmarked ? [{ label: 'Not marked', value: unmarked, color: 'var(--text-muted)' }] : []),
    ];
    for (const [label, color] of [
      ['Weekly off', 'var(--text-muted)'],
      ['Holiday', 'var(--teal-bar)'],
      ['Not joined', 'var(--blue)'],
      ['Not employed', 'var(--text-secondary)'],
    ]) {
      const value = n(label);
      if (value) segments.push({ label, value, color });
    }
    const scheduled = present + half + leave + absent + unmarked;
    const attendancePercent = scheduled ? Math.round(((present + half * 0.5) / scheduled) * 100) + '%' : '—';
    const chartMax = Math.max(1, employees.length, ...chart.map((day) => day.count));
    let offset = 0;
    const arcs = segments
      .map((s) => {
        const len = employees.length ? (s.value / employees.length) * 100 : 0,
          arc = `<circle cx="80" cy="80" r="64" pathLength="100" fill="none" stroke="${s.color}" stroke-width="13" stroke-dasharray="${Math.max(0, len - 0.8)} ${100 - Math.max(0, len - 0.8)}" stroke-dashoffset="${-offset}"/>`;
        offset += len;
        return s.value ? arc : '';
      })
      .join('');
    const pendingRows = pending().slice(0, 4);
    return `<div class="page-heading"><div class="page-title-text"><h1>HR overview</h1><p>Your people, attendance and approvals — all in one place.</p></div><div class="page-actions"><span class="date-chip">${H.icon('calendar', 14)}${H.date(H.today)}</span><button class="btn btn-secondary" data-go="reports">${H.icon('file')}View reports</button><button class="btn btn-primary" data-action="add-employee">${H.icon('plus')}Add employee</button></div></div>
   <div class="stats-grid">${stat('Active employees', employees.length, `${H.state.settings.departments.length} departments · ${H.state.employees.filter((e) => e.joined.startsWith(H.month)).length} joined this month`, 'users', 'purple')}${stat('Present today', present, `${employees.length ? Math.round((present / employees.length) * 100) : 0}% of active employees`, 'checkCircle', 'green')}${stat('On leave today', leave, 'Approved time away', 'calendar', 'blue')}${stat('Pending approvals', pending().length, 'Leave requests awaiting review', 'clock', 'amber')}</div>
   <div class="overview-middle"><section class="card"><div class="card-header"><div><h2 class="card-title">Attendance overview</h2><p class="card-subtitle">Employees marked present · ${weekPeriod}</p></div><span class="pill">This week</span></div><div class="attendance-chart" role="img" aria-label="Present employees: ${chart.map((x) => H.date(x.date) + ': ' + x.count).join(', ')}">${chart.map((x, i) => `<div class="chart-day"><span class="chart-count">${x.count}</span><div class="chart-bar" style="height:${Math.max(1, (x.count / chartMax) * 130)}px"></div><label>${H.date(x.date, { weekday: 'short', day: undefined, month: undefined, year: undefined })}</label></div>`).join('')}</div><div class="chart-footer"><span><i class="legend-marker"></i>Present employees</span><button class="btn-link" data-go="attendance">View attendance</button></div></section>
   <section class="card"><div class="card-header"><div><h2 class="card-title">Today's attendance</h2><p class="card-subtitle">A snapshot of your working day</p></div><span class="pill">${employees.length} employees</span></div><div class="attendance-breakdown"><div class="donut" role="img" aria-label="${segments.map((s) => s.label + ': ' + s.value).join(', ')}"><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="64" fill="none" stroke="var(--bg)" stroke-width="13"/>${arcs}</svg><div class="donut-center"><strong>${attendancePercent}</strong><span>Attendance*</span></div></div><div class="donut-legend">${segments.map((s) => `<div class="legend-line"><i style="background:${s.color}"></i><span>${s.label}</span><strong>${s.value}</strong></div>`).join('')}</div></div><div class="card-foot-note"><span>*Half-days count as 0.5 day.</span><button class="btn-link" data-action="mark-attendance">Update register</button></div></section></div>
   <div class="split-grid"><section class="card"><div class="card-header"><div><h2 class="card-title">Leave requests <span class="badge orange">${pending().length} pending</span></h2><p class="card-subtitle">Review upcoming time-off requests.</p></div><button class="btn-link" data-go="leave">View all</button></div>${
     pendingRows.length
       ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Leave dates</th><th>Days</th><th>Action</th></tr></thead><tbody>${pendingRows
           .map((l) => {
             const e = H.employee(l.employeeId);
             return `<tr><td><div class="person-cell">${H.avatar(e, true)}<div><div class="cell-primary">${E(e.name)}</div><div class="cell-secondary">${E(l.type)}</div></div></div></td><td><div class="cell-primary">${H.date(l.from, { year: undefined })}${l.from !== l.to ? ' – ' + H.date(l.to, { year: undefined }) : ''}</div><div class="cell-secondary">${E(e.department)}</div></td><td>${l.days}</td><td><div class="row-actions"><button class="icon-btn" data-leave-view="${E(l.id)}" aria-label="View leave request from ${E(e.name)}" title="View request">${H.icon('eye')}</button><button class="btn btn-secondary btn-sm" data-leave-approve="${E(l.id)}" aria-label="Approve leave request from ${E(e.name)}">Approve</button></div></td></tr>`;
           })
           .join('')}</tbody></table></div>`
       : H.empty('You’re all caught up', 'There are no pending leave requests.')
   }<div class="card-foot-note"><span>Single-step approval by the manager or HR.</span>${H.icon('shield', 14)}</div></section>
   <section class="card"><div class="card-header"><div><h2 class="card-title">People by department</h2><p class="card-subtitle">${employees.length} active employees across your teams</p></div></div><div class="card-body">${H.state.settings.departments
     .map((d, i) => {
       const count = employees.filter((e) => e.department === d).length;
       return `<div class="dept-item"><div class="dept-title"><span>${E(d)}</span><strong>${count} employees</strong></div><div class="dept-bar"><span style="width:${employees.length ? (count / employees.length) * 100 : 0}%;background:${i % 2 ? 'var(--teal-bar)' : 'var(--primary-blue)'}"></span></div></div>`;
     })
     .join('')}</div></section></div>
   <div class="two-grid"><section class="card"><div class="card-header"><div><h2 class="card-title">Recent joiners</h2><p class="card-subtitle">Welcome the newest members of your team.</p></div><button class="btn-link" data-go="employees">Directory</button></div><div class="card-body">${[
     ...employees,
   ]
     .sort((a, b) => b.joined.localeCompare(a.joined))
     .slice(0, 3)
     .map(
       (e) =>
         `<div class="activity-item"><div class="person-cell">${H.avatar(e)}<div><button class="btn-link" style="padding:0;color:var(--text-primary)" data-employee-view="${E(e.id)}">${E(e.name)}</button><div class="cell-secondary">${E(e.designation)} · ${E(e.department)}</div></div></div><span class="muted" style="margin-left:auto;font-size:11px;white-space:nowrap">${H.date(e.joined, { year: undefined })}</span></div>`,
     )
     .join(
       '',
     )}</div></section><section class="card"><div class="card-header"><div><h2 class="card-title">Recent activity</h2><p class="card-subtitle">The latest updates in your HR workspace.</p></div><button class="btn-link" data-action="activity">History</button></div><div class="card-body">${H.state.audit
     .slice(0, 3)
     .map(
       (a) =>
         `<div class="activity-item"><div class="activity-icon">${H.icon('checkCircle', 15)}</div><div><p>${E(a.message)}</p><small>${H.date(a.time)}</small></div></div>`,
     )
     .join('')}</div></section></div>`;
  };
  H.afterRender.dashboard = () => {
    view.querySelectorAll('[data-action="add-employee"]').forEach((b) => (b.onclick = H.addEmployee));
    view.querySelectorAll('[data-action="mark-attendance"]').forEach((b) => (b.onclick = H.markAttendance));
    view
      .querySelectorAll('[data-leave-view]')
      .forEach((b) => (b.onclick = () => H.viewLeave(b.dataset.leaveView)));
    view
      .querySelectorAll('[data-leave-approve]')
      .forEach((b) => (b.onclick = () => H.approveLeave(b.dataset.leaveApprove)));
    view
      .querySelectorAll('[data-employee-view]')
      .forEach((b) => (b.onclick = () => H.openEmployee(b.dataset.employeeView)));
    $('[data-action="activity"]').onclick = () => {
      H.navigate('settings', '#access');
    };
  };
  function reportRows(type) {
    const month = H.ui.reportMonth || H.month;
    if (type === 'employees')
      return [
        [
          'Employee ID',
          'Name',
          'Department',
          'Designation',
          'Joining date',
          'Employment type',
          'Status',
          'Salary type',
          'Agreed amount (INR)',
        ],
        ...H.state.employees.map((e) => [
          e.id,
          e.name,
          e.department,
          e.designation,
          e.joined,
          e.type,
          e.status,
          e.salaryType === 'daily' ? 'Per day salary' : 'Monthly agreed salary',
          e.salary,
        ]),
      ];
    if (type === 'attendance') {
      const [y, m] = month.split('-').map(Number),
        count = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const dates = Array.from(
        { length: count },
        (_, i) => month + '-' + String(i + 1).padStart(2, '0'),
      ).filter((d) => d <= H.today);
      return [
        [
          'Employee ID',
          'Name',
          'Department',
          'Month',
          'Present days',
          'Half-days',
          'Absent days',
          'Approved leave days',
          'Not marked',
          'Off / holiday',
        ],
        ...H.employeesForPeriod(month + '-01', month + '-' + String(count).padStart(2, '0')).map((e) => {
          const rec = dates
              .filter((d) => d >= e.joined && (!e.leavingDate || d <= e.leavingDate))
              .map((d) => H.attendanceFor(e.id, d)),
            n = (s) => rec.filter((r) => r.status === s).length;
          return [
            e.id,
            e.name,
            e.department,
            month,
            n('Present'),
            n('Half-day'),
            n('Absent'),
            rec.reduce((sum, r) => sum + (r.leaveDays || 0), 0),
            n('Not marked'),
            n('Weekly off') + n('Holiday'),
          ];
        }),
      ];
    }
    if (type === 'leave')
      return [
        ['Employee ID', 'Name', 'Leave type', 'Annual allocation', 'Used', 'Available'],
        ...H.activeEmployees().flatMap((e) =>
          H.state.settings.leaveTypes
            .filter((t) => t.name !== 'Unpaid leave')
            .map((t) => [
              e.id,
              e.name,
              t.name,
              t.days,
              t.days - H.leaveBalance(e.id, t.name),
              H.leaveBalance(e.id, t.name),
            ]),
        ),
      ];
    return [
      [
        'Employee ID',
        'Name',
        'Month',
        'Salary type',
        'Daily rate (INR)',
        'Paid days',
        'Basic',
        'Allowance',
        'Deduction',
        'Net payable',
        'Record status',
        'Payment status',
      ],
      ...H.state.salaries
        .filter((p) => p.month === month)
        .map((p) => [
          p.employeeId,
          H.employee(p.employeeId)?.name || 'Former employee',
          month,
          p.salaryType === 'daily' ? 'Per day salary' : 'Monthly agreed salary',
          p.salaryType === 'daily' ? p.dailyRate : '',
          p.salaryType === 'daily' ? (p.paidDays ?? 'Not reviewed') : '',
          p.basic,
          p.allowance,
          p.deduction,
          Number(p.basic) + Number(p.allowance) - Number(p.deduction),
          p.status,
          p.paid ? 'Paid' : 'Unpaid',
        ]),
    ];
  }
  H.renderers.reports = () => {
    const descriptions = [
      [
        'employees',
        'Employee directory',
        'A complete list of employee details, departments and employment status.',
        'users',
      ],
      [
        'attendance',
        'Monthly attendance',
        'Present, absent, half-day and approved leave totals for each employee.',
        'clock',
      ],
      [
        'leave',
        'Leave balances',
        'Annual allocations, approved usage and remaining leave for ' + H.today.slice(0, 4) + '.',
        'calendar',
      ],
      [
        'salary',
        'Salary summary',
        'Monthly earnings, deductions, net payable and recorded payment status.',
        'wallet',
      ],
    ];
    return `<div class="page-heading"><div class="page-title-text"><h1>HR reports</h1><p>Simple reports to support everyday people decisions.</p></div><div class="page-actions"><button class="btn btn-secondary" data-go="dashboard">Back to overview</button></div></div><div class="filter-bar"><label class="inline" for="report-month"><strong style="font-size:12px">Report month</strong><input type="month" id="report-month" value="${E(H.ui.reportMonth || H.month)}"></label><span class="muted" style="font-size:11.5px;margin-left:auto">Attendance is recorded through ${H.date(H.today)}.</span></div><div class="report-options">${descriptions.map((d) => `<section class="card report-card"><div class="report-icon">${H.icon(d[3], 19)}</div><div><h2>${d[1]}</h2><p>${d[2]}</p><div class="inline"><button class="btn btn-secondary btn-sm" data-preview-report="${d[0]}">${H.icon('eye')}Preview</button><button class="btn btn-ghost btn-sm" data-download-report="${d[0]}">${H.icon('download')}Export CSV</button></div></div></section>`).join('')}</div><section class="card"><div class="card-header"><div><h2 class="card-title">Reports at a glance</h2><p class="card-subtitle">Live totals from this HR workspace</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Report</th><th>Coverage</th><th>Records</th></tr></thead><tbody>${descriptions.map((d) => `<tr><td><div class="inline">${H.icon(d[3], 16)}<strong>${d[1]}</strong></div></td><td>${d[0] === 'employees' ? 'All employee records' : d[0] === 'leave' ? 'Annual balances · ' + H.today.slice(0, 4) : E(H.ui.reportMonth || H.month)}</td><td>${reportRows(d[0]).length - 1}</td></tr>`).join('')}</tbody></table></div></section>`;
  };
  H.afterRender.reports = () => {
    $('#report-month').onchange = (e) => {
      if (e.target.value) {
        H.ui.reportMonth = e.target.value;
        H.render();
      }
    };
    view.querySelectorAll('[data-download-report]').forEach(
      (b) =>
        (b.onclick = () => {
          H.csv(
            'ZcERP_' + b.dataset.downloadReport + '_' + (H.ui.reportMonth || H.month) + '.csv',
            reportRows(b.dataset.downloadReport),
          );
          H.toast('Report exported.');
        }),
    );
    view.querySelectorAll('[data-preview-report]').forEach(
      (b) =>
        (b.onclick = () => {
          const rows = reportRows(b.dataset.previewReport);
          H.openModal({
            title: 'Report preview',
            subtitle: `${rows.length - 1} records · ${H.ui.reportMonth || H.month}`,
            wide: true,
            body: `<div class="table-wrap"><table class="data-table"><thead><tr>${rows[0].map((x) => `<th>${E(x)}</th>`).join('')}</tr></thead><tbody>${rows
              .slice(1)
              .map((row) => `<tr>${row.map((x) => `<td>${E(x)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table></div>`,
            footer:
              '<button class="btn btn-secondary" data-modal-close>Close</button><button class="btn btn-primary" id="download-preview">Export CSV</button>',
            onMount: () =>
              ($('#download-preview').onclick = () =>
                H.csv('ZcERP_' + b.dataset.previewReport + '.csv', rows)),
          });
        }),
    );
  };
  H.decorateKpis = (root = view) => {
    const monthLabel = (value) => H.date(value + '-01', { day: undefined, month: 'long' });
    const snapshot = 'As of ' + H.date(H.today, { weekday: 'short' });
    root.querySelectorAll('.stat-card,.balance-card').forEach((card) => {
      card.querySelector('.kpi-meta')?.remove();
      const label = card.querySelector('.stat-label')?.textContent || '';
      let period = snapshot,
        areas = [H.page];
      if (card.classList.contains('balance-card')) {
        period = 'Leave year · ' + H.today.slice(0, 4);
        areas = ['leave', 'settings'];
      } else if (H.page === 'dashboard')
        areas = /employee/i.test(label)
          ? ['employees', 'settings']
          : /approval/i.test(label)
            ? ['leave']
            : ['attendance', 'leave', 'settings', 'employees'];
      else if (H.page === 'employees') {
        areas = /department/i.test(label) ? ['settings'] : ['employees'];
        if (/this month/i.test(label)) period = 'Period · ' + monthLabel(H.month);
      } else if (H.page === 'attendance') {
        areas = ['attendance', 'leave', 'employees', 'settings'];
        period =
          H.ui.attMode === 'monthly'
            ? 'Period · ' + monthLabel(H.ui.attMonth || H.month)
            : H.date(H.ui.attDate || H.today, { weekday: 'short' });
      } else if (H.page === 'leave') {
        areas = /types/i.test(label) ? ['leave', 'settings'] : ['leave'];
        if (/this month/i.test(label)) period = 'Period · ' + monthLabel(H.month);
      } else if (H.page === 'payroll') {
        areas = ['payroll'];
        period = 'Pay period · ' + monthLabel(H.ui.payMonth || H.month);
      }
      const stamps = areas
        .map((area) => H.state.recordedAt?.[area])
        .filter((value) => value && !Number.isNaN(Date.parse(value)))
        .sort((a, b) => Date.parse(b) - Date.parse(a));
      const time = stamps[0],
        recorded = time
          ? new Date(time).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
              timeZone: 'Asia/Kolkata',
            }) + ' IST'
          : 'Time not recorded';
      card.insertAdjacentHTML(
        'beforeend',
        `<div class="kpi-meta"><span class="stat-period">${H.icon('calendar', 12)}${E(period)}</span><span class="stat-recorded" title="Latest saved update to the data used by this card. Times are in India Standard Time.">${H.icon('clock', 12)}${time ? 'Last recorded: ' : ''}${E(recorded)}</span></div>`,
      );
    });
  };
  H.render = () => {
    $('#page-content').innerHTML = (H.renderers[H.page] || H.renderers.dashboard)();

    host.dataset.pendingLeaves = String(pending().length);
    updateLeaveBadge();
    view
      .querySelectorAll('#page-content [data-go]')
      .forEach((b) => (b.onclick = () => H.navigate(b.dataset.go)));
    H.afterRender[H.page]?.();
    H.decorateKpis($('#page-content'));
  };
  if (location.hash === '#access') H.ui.settingsTab = 'access';
  await load();
}
