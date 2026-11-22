export function installPeople(HR, view) {
  const $ = (s, root = view) => root.querySelector(s);
  const $$ = (s, root = view) => [...root.querySelectorAll(s)];
  const E = (v) => HR.esc(v == null ? '' : String(v));
  const options = (items, selected, first) =>
    (first ? `<option value="">${E(first)}</option>` : '') +
    items.map((x) => `<option value="${E(x)}" ${x === selected ? 'selected' : ''}>${E(x)}</option>`).join('');
  const input = (name, value = '', attrs = '') => `<input name="${E(name)}" value="${E(value)}" ${attrs}>`;
  const select = (name, items, value, attrs = '', first) =>
    `<select name="${E(name)}" ${attrs}>${options(items, value, first)}</select>`;
  const field = (label, control, hint) => HR.field(label, control, hint || '');
  const person = (e) =>
    `<div class="person-cell">${HR.avatar(e)}<div><div class="cell-primary">${E(e.name)}</div><div class="cell-secondary">${E(e.id)}</div></div></div>`;
  const title = (name, subtitle, actions = '') =>
    `<div class="page-heading"><div class="page-title-text"><h1>${name}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;
  const statistic = (label, value, note, icon, color = '') =>
    `<div class="stat-card"><div class="between"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${HR.icon(icon)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${note}</div></div>`;
  const formFooter = (label = 'Save changes') =>
    `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button><button type="submit" form="modal-form" class="btn btn-primary">${label}</button>`;
  const cancelBinding = (dialog) =>
    $$('[data-cancel]', dialog).forEach((b) => b.addEventListener('click', HR.closeModal));
  const freshId = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const message = (dialog, text) => {
    const box = $('[data-form-error]', dialog);
    if (box) {
      box.hidden = !text;
      box.textContent = text;
    }
  };
  const errorBox = '<div class="notice notice-warning" data-form-error role="alert" hidden></div>';
  function updateViewPreservingFocus(id) {
    const old = view.getElementById(id),
      pos = old?.selectionStart;
    HR.render();
    const current = view.getElementById(id);
    if (current) {
      current.focus();
      if (typeof pos === 'number') {
        try {
          current.setSelectionRange(pos, pos);
        } catch (_) {}
      }
    }
  }
  function paging(rows, key, label) {
    const size = 8,
      max = Math.max(1, Math.ceil(rows.length / size));
    HR.ui[key] = Math.min(Math.max(1, HR.ui[key] || 1), max);
    const page = HR.ui[key],
      start = (page - 1) * size;
    return {
      rows: rows.slice(start, start + size),
      footer: `<div class="table-footer"><span class="muted">${rows.length ? `${start + 1}–${Math.min(start + size, rows.length)}` : '0'} of ${rows.length} ${label}</span><div class="pagination"><button class="btn btn-secondary btn-sm" data-page-prev="${key}" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="muted">${page} / ${max}</span><button class="btn btn-secondary btn-sm" data-page-next="${key}" ${page >= max ? 'disabled' : ''}>Next</button></div></div>`,
    };
  }
  function bindPaging() {
    $$('[data-page-prev]').forEach((b) =>
      b.addEventListener('click', () => {
        HR.ui[b.dataset.pagePrev]--;
        HR.render();
      }),
    );
    $$('[data-page-next]').forEach((b) =>
      b.addEventListener('click', () => {
        HR.ui[b.dataset.pageNext]++;
        HR.render();
      }),
    );
  }

  /* EMPLOYEES */
  function filteredEmployees() {
    const q = (HR.ui.empSearch || '').toLowerCase().trim();
    return HR.state.employees.filter(
      (e) =>
        (!q ||
          [e.name, e.id, e.email, e.designation].some((v) =>
            String(v || '')
              .toLowerCase()
              .includes(q),
          )) &&
        (!HR.ui.empDept || e.department === HR.ui.empDept) &&
        (!HR.ui.empStatus || e.status === HR.ui.empStatus),
    );
  }
  HR.renderers.employees = () => {
    const rows = filteredEmployees(),
      page = paging(rows, 'empPage', 'employees');
    return (
      title(
        'Employees',
        'A clear view of your people, teams and employee records.',
        `<button class="btn btn-secondary" id="export-employees">${HR.icon('download')} Export</button><button class="btn btn-primary" id="add-employee">${HR.icon('plus')} Add employee</button>`,
      ) +
      `<div class="stats-grid">${statistic('Active employees', HR.activeEmployees().length, 'Current workforce', 'users', 'purple')}${statistic('Departments', HR.state.settings.departments.length, 'Across your organization', 'building')}${statistic('On probation', HR.state.employees.filter((e) => e.status === 'On probation').length, 'New members settling in', 'briefcase', 'amber')}${statistic('Joined this month', HR.state.employees.filter((e) => e.joined?.startsWith(HR.month)).length, HR.date(HR.today, { day: undefined, month: 'long' }), 'calendar', 'green')}</div>
      <div class="filter-bar"><div class="search-field">${HR.icon('search')}<input id="employee-search" type="search" placeholder="Search name, ID or email" value="${E(HR.ui.empSearch)}" aria-label="Search employees"></div><select id="employee-dept" aria-label="Filter employees by department">${options(HR.state.settings.departments, HR.ui.empDept, 'All departments')}</select><select id="employee-status" aria-label="Filter employees by status">${options(['Active', 'On probation', 'Inactive'], HR.ui.empStatus, 'All statuses')}</select><button class="btn btn-ghost" id="employee-clear">Clear filters</button></div>
      <section class="card"><div class="card-header"><div><h2 class="card-title">Employee directory <span class="pill">${rows.length}</span></h2><p class="card-subtitle">Employee details and employment status in one place.</p></div></div>${page.rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Department / role</th><th>Contact</th><th>Joined</th><th>Status</th><th class="action-heading">Actions</th></tr></thead><tbody>${page.rows.map((e) => `<tr><td>${person(e)}</td><td><div class="cell-primary">${E(e.department)}</div><div class="cell-secondary">${E(e.designation)}</div></td><td><div class="cell-primary">${E(e.email)}</div><div class="cell-secondary">${E(e.phone || 'No phone added')}</div></td><td>${HR.date(e.joined)}</td><td>${HR.badge(e.status)}</td><td><div class="row-actions"><button class="icon-btn" data-view-employee="${E(e.id)}" aria-label="View ${E(e.name)}" title="View profile">${HR.icon('eye')}</button><button class="icon-btn" data-edit-employee="${E(e.id)}" aria-label="Edit ${E(e.name)}" title="Edit employee">${HR.icon('edit')}</button></div></td></tr>`).join('')}</tbody></table></div>` : HR.empty('No employees found', 'Try a different search or clear your filters.')}${page.footer}</section>`
    );
  };
  HR.afterRender.employees = () => {
    $('#employee-search').addEventListener('input', (e) => {
      HR.ui.empSearch = e.target.value;
      HR.ui.empPage = 1;
      updateViewPreservingFocus('employee-search');
    });
    $('#employee-dept').addEventListener('change', (e) => {
      HR.ui.empDept = e.target.value;
      HR.ui.empPage = 1;
      HR.render();
    });
    $('#employee-status').addEventListener('change', (e) => {
      HR.ui.empStatus = e.target.value;
      HR.ui.empPage = 1;
      HR.render();
    });
    $('#employee-clear').addEventListener('click', () => {
      HR.ui.empSearch = '';
      HR.ui.empDept = '';
      HR.ui.empStatus = '';
      HR.ui.empPage = 1;
      HR.render();
    });
    $('#add-employee').addEventListener('click', () => employeeForm());
    $('#export-employees').addEventListener('click', () =>
      HR.csv('ZetaERP_Employees.csv', [
        [
          'Employee ID',
          'Name',
          'Department',
          'Designation',
          'Email',
          'Phone',
          'Joining date',
          'Employment type',
          'Status',
          'Salary type',
          'Salary amount (INR)',
          'Salary unit',
        ],
        ...filteredEmployees().map((e) => [
          e.id,
          e.name,
          e.department,
          e.designation,
          e.email,
          e.phone,
          e.joined,
          e.type,
          e.status,
          e.salaryType === 'daily' ? 'Per day salary' : 'Monthly agreed salary',
          e.salary,
          e.salaryType === 'daily' ? 'per day' : 'per month',
        ]),
      ]),
    );
    $$('[data-view-employee]').forEach((b) =>
      b.addEventListener('click', () => profile(b.dataset.viewEmployee)),
    );
    $$('[data-edit-employee]').forEach((b) =>
      b.addEventListener('click', () => employeeForm(b.dataset.editEmployee)),
    );
    bindPaging();
  };
  function nextEmployeeId() {
    let last = 0;
    for (const employee of HR.state.employees) {
      const match = /^ZE-(\d{1,12})$/.exec(employee.id);
      if (match) last = Math.max(last, Number(match[1]));
    }
    return 'ZE-' + String(last + 1).padStart(3, '0');
  }
  function employeeForm(id) {
    const existing = id ? HR.employee(id) : null;
    if (id && !existing) return;
    const e = existing || {
      name: '',
      email: '',
      phone: '',
      joined: HR.today,
      department: HR.state.settings.departments[0],
      designation: '',
      manager: '',
      type: 'Full-time',
      status: 'Active',
      salaryType: 'monthly',
      salary: 0,
      emergency: '',
      leavingDate: '',
      documents: [],
    };
    let attached = [...(e.documents || [])];
    const departments = HR.state.settings.departments;
    const departmentField = departments.length
      ? select('department', departments, e.department, 'required')
      : input('department', '', 'required maxlength="80" placeholder="e.g. Operations"');
    const managers = HR.activeEmployees().filter((person) => person.id !== id);
    const currentManager = HR.employee(e.manager) || managers.find((person) => person.name === e.manager);
    if (currentManager && !managers.includes(currentManager)) managers.push(currentManager);
    const names = new Set(),
      repeated = new Set();
    for (const person of managers) {
      if (names.has(person.name)) repeated.add(person.name);
      names.add(person.name);
    }
    const managerOptions = managers
      .map((person) => {
        const label = repeated.has(person.name) ? person.name + ' · ' + person.id : person.name;
        return (
          '<option value="' +
          E(person.id) +
          '" ' +
          (person.id === currentManager?.id ? 'selected' : '') +
          '>' +
          E(label) +
          '</option>'
        );
      })
      .join('');
    const managerField =
      '<select name="manager"><option value="">No manager assigned</option>' + managerOptions + '</select>';
    HR.openModal({
      title: existing ? 'Edit employee' : 'Add employee',
      subtitle: existing
        ? `${existing.id} · Keep employee details up to date.`
        : 'Create a profile and add this person to your team.',
      wide: true,
      body: `<form id="modal-form">${errorBox}<div class="form-grid">${field('Full name *', input('name', e.name, 'required maxlength="80" autocomplete="name" placeholder="e.g. Ananya Rao"'))}${field('Work email *', input('email', e.email, 'type="email" required maxlength="160" autocomplete="email" placeholder="name@example.com"'))}${field('Phone', input('phone', e.phone, 'type="tel" maxlength="24" autocomplete="tel" placeholder="+91 98765 43210"'))}${field('Joining date *', input('joined', e.joined, 'type="date" required'))}${field('Department *', departmentField)}${field('Designation *', input('designation', e.designation, 'required maxlength="80" list="employee-designations" placeholder="e.g. Software Engineer"') + `<datalist id="employee-designations">${(HR.state.settings.designations || []).map((d) => `<option value="${E(d)}"></option>`).join('')}</datalist>`)}${field('Reporting manager', managerField)}${field('Employment type', select('type', ['Full-time', 'Part-time', 'Contract'], e.type))}${field('Status', select('status', ['Active', 'On probation', 'Inactive'], e.status))}<div id="employee-leaving-field" ${e.status === 'Inactive' ? '' : 'hidden'}>${field('Leaving date *', input('leavingDate', e.leavingDate || HR.today, 'type="date"'))}</div>${field('Salary type *', `<select name="salaryType" required><option value="monthly" ${e.salaryType !== 'daily' ? 'selected' : ''}>Monthly agreed salary</option><option value="daily" ${e.salaryType === 'daily' ? 'selected' : ''}>Per day salary</option></select>`)}<label class="field salary-amount-field"><span id="employee-salary-label">${e.salaryType === 'daily' ? 'Daily' : 'Monthly'} salary amount (₹) *</span>${input('salary', e.salary, 'type="number" required min="0" max="10000000" step="0.01"')}<small class="field-hint" id="employee-salary-unit">₹ / ${e.salaryType === 'daily' ? 'day' : 'month'}</small></label>${field('Emergency contact', input('emergency', e.emergency, 'maxlength="120" placeholder="Name and phone number"'))}${field('Documents', '<input type="file" id="employee-documents" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">', 'Document names are recorded; file contents are not uploaded.')}<div class="span-2" id="employee-doc-list">${attached.map((d) => `<span class="pill">${E(typeof d === 'string' ? d : d.name)}</span>`).join(' ')}</div></div></form>`,
      footer: formFooter(existing ? 'Save changes' : 'Add employee'),
      onMount(dialog) {
        cancelBinding(dialog);
        const employeeFormElement = $('#modal-form', dialog);
        const syncLeaving = () => {
          const inactive = employeeFormElement.elements.status.value === 'Inactive';
          $('#employee-leaving-field', dialog).hidden = !inactive;
          employeeFormElement.elements.leavingDate.disabled = !inactive;
          employeeFormElement.elements.leavingDate.required = inactive;
        };
        employeeFormElement.elements.status.addEventListener('change', syncLeaving);
        syncLeaving();
        const syncSalaryType = () => {
          const daily = employeeFormElement.elements.salaryType.value === 'daily';
          $('#employee-salary-label', dialog).textContent =
            (daily ? 'Daily' : 'Monthly') + ' salary amount (₹) *';
          $('#employee-salary-unit', dialog).textContent = '₹ / ' + (daily ? 'day' : 'month');
        };
        employeeFormElement.elements.salaryType.addEventListener('change', syncSalaryType);
        syncSalaryType();
        $('#employee-documents', dialog).addEventListener('change', (ev) => {
          attached = [
            ...(e.documents || []),
            ...[...ev.target.files].map((f) => ({ name: f.name, size: f.size, added: HR.today })),
          ];
          $('#employee-doc-list', dialog).innerHTML = attached
            .map((d) => `<span class="pill">${E(typeof d === 'string' ? d : d.name)}</span>`)
            .join(' ');
        });
        $('#modal-form', dialog).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const form = ev.target;
          if (!form.reportValidity()) return;
          const f = Object.fromEntries(new FormData(form));
          f.name = f.name.trim();
          f.email = f.email.trim();
          f.designation = f.designation.trim();
          f.department = f.department.trim();
          if (!f.department) return message(dialog, 'Enter a department.');
          f.salary = Number(f.salary || 0);
          f.salaryType = f.salaryType === 'daily' ? 'daily' : 'monthly';
          if (!f.name || !f.designation) return message(dialog, 'Enter a name and designation.');
          if (f.status === 'Inactive' && f.leavingDate < f.joined)
            return message(dialog, 'The leaving date must be on or after the joining date.');
          if (f.status !== 'Inactive') f.leavingDate = '';
          if (HR.state.employees.some((x) => x.id !== id && x.email.toLowerCase() === f.email.toLowerCase()))
            return message(dialog, 'An employee with this email already exists.');
          if (!Number.isFinite(f.salary) || f.salary < 0)
            return message(dialog, 'Enter a valid non-negative salary.');
          const updated = {
            ...e,
            ...f,
            documents: attached,
            id: existing?.id || nextEmployeeId(),
            color: e.color || 'purple',
          };
          if (!departments.length) departments.push(f.department);
          if (existing) Object.assign(existing, updated);
          else HR.state.employees.push(updated);
          if (!(await HR.save(`${existing ? 'Updated' : 'Added'} employee ${updated.name}`))) return;
          HR.closeModal();
          HR.render();
          HR.toast(existing ? 'Employee details updated.' : 'Employee added to the directory.');
        });
      },
    });
  }
  function profile(id) {
    const e = HR.employee(id);
    if (!e) return;
    const item = (label, val) =>
      `<div class="detail-item"><span>${label}</span><strong>${E(val || 'Not added')}</strong></div>`;
    HR.openModal({
      title: 'Employee profile',
      subtitle: `${e.id} · ${e.department}`,
      wide: true,
      body: `<div class="profile-overview"><div class="person-cell">${HR.avatar(e)}<div><h2>${E(e.name)}</h2><p class="muted">${E(e.designation)}</p></div></div>${HR.badge(e.status)}</div><div class="detail-grid">${item('Work email', e.email)}${item('Phone', e.phone)}${item('Department', e.department)}${item('Reporting manager', HR.employee(e.manager)?.name || e.manager)}${item('Joined', HR.date(e.joined))}${item('Employment type', e.type)}${e.status === 'Inactive' ? item('Leaving date', e.leavingDate ? HR.date(e.leavingDate) : 'Not recorded') : ''}${item('Salary type', e.salaryType === 'daily' ? 'Per day salary' : 'Monthly agreed salary')}${item('Agreed salary', HR.money(e.salary) + (e.salaryType === 'daily' ? ' / day' : ' / month'))}${item('Emergency contact', e.emergency)}</div><h3 class="section-label">Leave balance</h3><div class="balance-grid">${HR.state.settings.leaveTypes
        .filter((t) => t.name !== 'Unpaid leave')
        .map(
          (t) =>
            `<div class="balance-card"><span class="muted">${E(t.name)}</span><strong>${HR.leaveBalance(e.id, t.name)} <small>days</small></strong></div>`,
        )
        .join(
          '',
        )}</div><h3 class="section-label">Documents</h3>${e.documents?.length ? `<div class="stack">${e.documents.map((d) => `<div class="document-row">${HR.icon('file')}<span>${E(typeof d === 'string' ? d : d.name)}</span><span class="cell-secondary">Document record</span></div>`).join('')}</div>` : '<p class="muted">No document records added.</p>'}`,
      footer: `<button class="btn btn-secondary" data-cancel>Close</button><button class="btn btn-primary" id="profile-edit">${HR.icon('edit')} Edit employee</button>`,
      onMount(dialog) {
        cancelBinding(dialog);
        $('#profile-edit', dialog).addEventListener('click', () => {
          HR.closeModal();
          employeeForm(e.id);
        });
      },
    });
  }
  HR.openEmployee = profile;
  HR.addEmployee = () => employeeForm();

  /* ATTENDANCE */
  const attendanceStates = ['Present', 'Absent', 'Half-day'];
  const draftKey = (employeeId, date) => `${date}|${employeeId}`;
  const drafts = () => (HR.ui.attDrafts ||= {});
  function attendanceEmployees() {
    const q = (HR.ui.attSearch || '').toLowerCase(),
      monthly = HR.ui.attMode === 'monthly';
    const dates = monthly ? monthDates(HR.ui.attMonth || HR.month) : [HR.ui.attDate || HR.today];
    return HR.employeesForPeriod(dates[0], dates[dates.length - 1]).filter(
      (e) =>
        (!q || `${e.name} ${e.id}`.toLowerCase().includes(q)) &&
        (!HR.ui.attDept || e.department === HR.ui.attDept),
    );
  }
  function hours(record) {
    if (!record.checkIn || !record.checkOut) return '—';
    const a = record.checkIn.split(':').map(Number),
      b = record.checkOut.split(':').map(Number),
      mins = b[0] * 60 + b[1] - a[0] * 60 - a[1];
    return mins > 0 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '—';
  }
  function monthDates(month) {
    const [year, m] = month.split('-').map(Number),
      last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }
  function attendanceLock(employeeId, date) {
    const employee = HR.employee(employeeId);
    if (!employee) return 'Employee record unavailable';
    if (!HR.employedDuring(employee, date)) return 'Outside employment dates';
    if (date > HR.today) return 'Future date — attendance is locked';
    const record = HR.attendanceFor(employeeId, date);
    if (record.timeClock) return 'Managed by the attendance clock';
    if (Number(record.leaveDays || 0) > 0)
      return record.leaveDays === 0.5 ? 'Approved half-day leave' : 'Approved leave';
    if (['On leave', 'Holiday', 'Weekly off', 'Not joined', 'Not employed'].includes(record.status))
      return record.status;
    return '';
  }
  function editableAttendance(employeeId, date) {
    const saved = HR.attendanceFor(employeeId, date);
    const status = attendanceStates.includes(saved.status) ? saved.status : 'Not marked';
    return {
      employeeId,
      date,
      status,
      checkIn: status === 'Absent' || status === 'Not marked' ? '' : saved.checkIn || '',
      checkOut: status === 'Absent' || status === 'Not marked' ? '' : saved.checkOut || '',
    };
  }
  function draftAttendance(employeeId, date) {
    return drafts()[draftKey(employeeId, date)] || editableAttendance(employeeId, date);
  }
  function sameAttendance(a, b) {
    return (
      a.status === b.status &&
      (a.checkIn || '') === (b.checkIn || '') &&
      (a.checkOut || '') === (b.checkOut || '')
    );
  }
  function setAttendanceDraft(employeeId, date, changes) {
    if (attendanceLock(employeeId, date)) return;
    const key = draftKey(employeeId, date),
      next = { ...draftAttendance(employeeId, date), ...changes };
    if (['Absent', 'Not marked'].includes(next.status)) {
      next.checkIn = '';
      next.checkOut = '';
    }
    if (sameAttendance(next, editableAttendance(employeeId, date))) delete drafts()[key];
    else drafts()[key] = next;
    if (HR.ui.attErrors) delete HR.ui.attErrors[key];
  }
  function draftEntries() {
    return Object.values(drafts());
  }
  function dirtyText() {
    const entries = draftEntries();
    if (!entries.length) return 'All changes saved';
    const dates = new Set(entries.map((d) => d.date)).size;
    return `${entries.length} unsaved ${entries.length === 1 ? 'row' : 'rows'}${dates > 1 ? ` across ${dates} dates` : ''}. Save attendance applies all pending changes.`;
  }
  function rerenderAttendance(focusId) {
    const scrollY = window.scrollY;
    HR.render();
    window.scrollTo({ top: scrollY, behavior: 'instant' });
    if (focusId) view.getElementById(focusId)?.focus({ preventScroll: true });
  }
  function syncDraftSummary() {
    const entries = draftEntries();
    $$('[data-att-dirty-summary]').forEach((el) => (el.textContent = dirtyText()));
    $$('[data-save-attendance]').forEach((el) => (el.disabled = !entries.length));
    $$('[data-discard-attendance]').forEach((el) => (el.hidden = !entries.length));
    $$('[data-review-attendance]').forEach(
      (el) => (el.hidden = !entries.length || HR.ui.attMode !== 'monthly'),
    );
    $$('[data-attendance-row]').forEach((row) => {
      const key = draftKey(row.dataset.attendanceRow, HR.ui.attDate || HR.today),
        dirty = !!drafts()[key];
      row.classList.toggle('attendance-row-dirty', dirty);
      const flag = $('[data-att-dirty]', row);
      if (flag) flag.hidden = !dirty;
      row.classList.toggle('attendance-row-error', !!HR.ui.attErrors?.[key]);
      const error = $('[data-att-row-error]', row);
      if (error) {
        error.textContent = HR.ui.attErrors?.[key]?.message || '';
        error.hidden = !error.textContent;
      }
      const duration = $('[data-att-hours]', row);
      if (duration)
        duration.textContent = hours(draftAttendance(row.dataset.attendanceRow, HR.ui.attDate || HR.today));
    });
    if (!Object.keys(HR.ui.attErrors || {}).length) {
      const banner = $('#attendance-error');
      if (banner) banner.hidden = true;
    }
  }
  function dailyAttendanceRow(employee, date) {
    const saved = HR.attendanceFor(employee.id, date),
      locked = attendanceLock(employee.id, date),
      record = locked ? saved : draftAttendance(employee.id, date),
      key = draftKey(employee.id, date),
      dirty = !!drafts()[key],
      error = HR.ui.attErrors?.[key];
    const id = employee.id,
      disabled = !!locked || !['Present', 'Half-day'].includes(record.status);
    const controls = locked
      ? `<div>${HR.badge(saved.status)}<div class="attendance-lock-note">${HR.icon('shield', 13)} ${E(locked)}</div></div>`
      : `<div class="attendance-status-controls" role="group" aria-label="Attendance status for ${E(employee.name)}"><button type="button" id="att-present-${E(id)}" class="btn btn-sm attendance-choice is-present ${record.status === 'Present' ? 'active' : ''}" data-att-status="Present" data-employee="${E(id)}" aria-pressed="${record.status === 'Present'}">Present</button><button type="button" id="att-absent-${E(id)}" class="btn btn-sm attendance-choice is-absent ${record.status === 'Absent' ? 'active' : ''}" data-att-status="Absent" data-employee="${E(id)}" aria-pressed="${record.status === 'Absent'}">Absent</button><button type="button" id="att-half-${E(id)}" class="btn btn-ghost btn-sm attendance-choice is-half ${record.status === 'Half-day' ? 'active' : ''}" data-att-status="Half-day" data-employee="${E(id)}" aria-pressed="${record.status === 'Half-day'}">Half-day</button></div><div class="attendance-row-note"><span>${record.status === 'Not marked' ? 'Not marked' : E(record.status)}</span>${record.status !== 'Not marked' ? `<button type="button" class="attendance-clear btn btn-ghost btn-sm" data-att-clear="${E(id)}" aria-label="Clear attendance for ${E(employee.name)}">Clear</button>` : ''}<span class="badge orange" data-att-dirty ${dirty ? '' : 'hidden'}>Unsaved</span></div>`;
    return `<tr data-attendance-row="${E(id)}" class="${dirty ? 'attendance-row-dirty ' : ''}${error ? 'attendance-row-error' : ''}"><td>${person(employee)}</td><td>${E(employee.department)}</td><td>${controls}<div class="attendance-row-error-text text-danger" data-att-row-error ${error ? '' : 'hidden'}>${E(error?.message)}</div></td><td><input class="attendance-time" id="att-in-${E(id)}" type="time" data-att-time="checkIn" data-employee="${E(id)}" value="${E(record.checkIn || '')}" aria-label="Check in for ${E(employee.name)}" ${disabled ? 'disabled' : ''}></td><td><input class="attendance-time" id="att-out-${E(id)}" type="time" data-att-time="checkOut" data-employee="${E(id)}" value="${E(record.checkOut || '')}" aria-label="Check out for ${E(employee.name)}" ${disabled ? 'disabled' : ''}></td><td><span data-att-hours>${hours(record)}</span></td></tr>`;
  }
  HR.renderers.attendance = () => {
    const date = HR.ui.attDate || HR.today,
      mode = HR.ui.attMode || 'daily',
      monthly = mode === 'monthly';
    const periodDates = monthly ? monthDates(HR.ui.attMonth || HR.month) : [date],
      all = HR.employeesForPeriod(periodDates[0], periodDates[periodDates.length - 1]);
    const records = monthly
      ? all.flatMap((e) =>
          periodDates
            .filter((d) => d <= HR.today && HR.employedDuring(e, d))
            .map((d) => HR.attendanceFor(e.id, d)),
        )
      : all.map((e) => HR.attendanceFor(e.id, date));
    const present = records.filter((r) => r.status === 'Present').length,
      absent = records.filter((r) => r.status === 'Absent').length,
      leave = monthly
        ? records.reduce((sum, r) => sum + Number(r.leaveDays || 0), 0)
        : records.filter((r) => Number(r.leaveDays || 0) > 0).length,
      unmarked = records.filter((r) => r.status === 'Not marked').length;
    let employees = attendanceEmployees();
    if (mode === 'daily' && HR.ui.attStatus)
      employees = employees.filter(
        (e) =>
          (attendanceLock(e.id, date) ? HR.attendanceFor(e.id, date) : draftAttendance(e.id, date)).status ===
          HR.ui.attStatus,
      );
    const page = mode === 'monthly' ? paging(employees, 'attPage', 'employees') : null;
    const dirty = draftEntries().length,
      error = Object.values(HR.ui.attErrors || {})[0];
    let table, footer;
    if (mode === 'daily') {
      table = employees.length
        ? `<div class="table-wrap"><table class="data-table attendance-register" id="daily-attendance-register" tabindex="-1"><thead><tr><th>Employee</th><th>Department</th><th>Attendance</th><th>Check in <span class="cell-secondary">optional</span></th><th>Check out <span class="cell-secondary">optional</span></th><th>Recorded time</th></tr></thead><tbody>${employees.map((e) => dailyAttendanceRow(e, date)).join('')}</tbody></table></div>`
        : HR.empty('No employees match', 'Change the date or clear the filters to see your team.');
      footer = `<div class="table-footer"><span class="muted">${employees.length} ${employees.length === 1 ? 'employee' : 'employees'} shown · Select a status before entering optional times.</span><button class="btn btn-primary btn-sm" data-save-attendance ${dirty ? '' : 'disabled'}>Save attendance</button></div>`;
    } else {
      const dates = monthDates(HR.ui.attMonth || HR.month);
      table = page.rows.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Present</th><th>Half-days</th><th>Absent</th><th>Leave days</th><th>Not marked</th><th>Off / holiday</th></tr></thead><tbody>${page.rows
            .map((e) => {
              const rec = dates
                  .filter((d) => d <= HR.today && HR.employedDuring(e, d))
                  .map((d) => HR.attendanceFor(e.id, d)),
                n = (s) => rec.filter((r) => r.status === s).length;
              return `<tr><td>${person(e)}</td><td><strong class="text-success">${n('Present')}</strong></td><td>${n('Half-day')}</td><td>${n('Absent')}</td><td>${rec.reduce((sum, r) => sum + Number(r.leaveDays || 0), 0)}</td><td>${n('Not marked')}</td><td>${n('Weekly off') + n('Holiday')}</td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : HR.empty('No employees match', 'Choose another department or search.');
      footer = page.footer;
    }
    return (
      title(
        'Attendance',
        'Mark your team’s attendance, add times if needed, and save together.',
        `<button class="btn btn-secondary" id="export-attendance">${HR.icon('download')} Export</button><button class="btn btn-primary" data-save-attendance ${dirty ? '' : 'disabled'}>${HR.icon('save')} Save attendance</button>`,
      ) +
      `<div class="stats-grid">${statistic(monthly ? 'Present days' : 'Present', present, monthly ? 'Saved employee-days this month' : 'Saved attendance for selected date', 'checkCircle', 'green')}${statistic(monthly ? 'Leave days' : 'On leave', leave, monthly ? 'Approved leave days, including half-days' : 'Approved full-day or half-day leave', 'calendar', 'purple')}${statistic(monthly ? 'Absent days' : 'Absent', absent, monthly ? 'Saved employee-days this month' : 'Saved attendance for selected date', 'users', 'amber')}${statistic('Not marked', unmarked, monthly ? 'Employee-days awaiting entry' : 'Awaiting attendance entry', 'clock')}</div>
      <div class="tabs"><button class="tab ${mode === 'daily' ? 'active' : ''}" data-att-mode="daily">Daily attendance</button><button class="tab ${mode === 'monthly' ? 'active' : ''}" data-att-mode="monthly">Monthly summary</button></div>
      <div class="filter-bar"><div class="search-field">${HR.icon('search')}<input type="search" id="attendance-search" value="${E(HR.ui.attSearch)}" placeholder="Search employee" aria-label="Search attendance"></div>${mode === 'daily' ? `<input type="date" id="attendance-date" value="${E(date)}" aria-label="Attendance date">` : `<input type="month" id="attendance-month" value="${E(HR.ui.attMonth || HR.month)}" aria-label="Attendance month">`}<select id="attendance-dept" aria-label="Filter attendance by department">${options(HR.state.settings.departments, HR.ui.attDept, 'All departments')}</select>${mode === 'daily' ? `<select id="attendance-status" aria-label="Filter attendance by status">${options(['Present', 'Absent', 'Half-day', 'On leave', 'Not marked', 'Weekly off', 'Holiday'], HR.ui.attStatus, 'All statuses')}</select>` : ''}<button class="btn btn-ghost" id="attendance-clear-filters">Clear filters</button></div>
      <section class="card"><div class="card-header"><div><h2 class="card-title">${mode === 'daily' ? 'Daily attendance register' : 'Monthly attendance summary'}</h2><p class="card-subtitle">${mode === 'daily' ? `${HR.date(date)} · Approved leave and non-working days are locked.` : `${E(HR.ui.attMonth || HR.month)} · Saved records through ${HR.date(HR.today)}.`}</p></div><span class="pill">${employees.length} employees</span></div><div class="attendance-draft-summary"><span data-att-dirty-summary role="status">${dirtyText()}</span><div class="inline"><button class="btn btn-ghost btn-sm" data-review-attendance ${dirty && mode === 'monthly' ? '' : 'hidden'}>Review changes</button><button class="btn btn-ghost btn-sm" data-discard-attendance ${dirty ? '' : 'hidden'}>Discard changes</button></div></div><div id="attendance-error" class="notice notice-warning" role="alert" tabindex="-1" ${error ? '' : 'hidden'}>${E(error?.message)}</div>${table}${footer}</section><p class="attendance-export-note muted">Summary cards, monthly totals and exports use saved attendance.</p>`
    );
  };
  function showAttendanceError(entry, text, fieldName = 'status') {
    HR.ui.attErrors ||= {};
    HR.ui.attErrors[draftKey(entry.employeeId, entry.date)] = { message: text, field: fieldName };
    HR.ui.attMode = 'daily';
    HR.ui.attDate = entry.date;
    HR.ui.attSearch = '';
    HR.ui.attDept = '';
    HR.ui.attStatus = '';
    HR.render();
    const target =
      view.getElementById(
        (fieldName === 'checkOut' ? 'att-out-' : fieldName === 'checkIn' ? 'att-in-' : 'att-present-') +
          entry.employeeId,
      ) || $('#attendance-error');
    if (target) {
      target.focus?.({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  async function saveAttendance() {
    const entries = draftEntries();
    if (!entries.length) return;
    const invalid = $$('input[data-att-time]').find((el) => !el.validity.valid);
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    HR.ui.attErrors = {};
    for (const entry of entries) {
      const employee = HR.employee(entry.employeeId),
        name = employee?.name || entry.employeeId,
        lock = attendanceLock(entry.employeeId, entry.date);
      if (lock)
        return showAttendanceError(
          entry,
          `${name}: ${lock}. Discard this change or update the relevant record.`,
        );
      if (!attendanceStates.includes(entry.status) && entry.status !== 'Not marked')
        return showAttendanceError(entry, `${name}: choose Present, Absent, Half-day, or clear the entry.`);
      for (const fieldName of ['checkIn', 'checkOut'])
        if (entry[fieldName] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry[fieldName]))
          return showAttendanceError(entry, `${name}: enter a valid time.`, fieldName);
      if (entry.checkOut && !entry.checkIn)
        return showAttendanceError(entry, `${name}: add a check-in time before a check-out time.`, 'checkIn');
      if (entry.checkIn && entry.checkOut && entry.checkOut <= entry.checkIn)
        return showAttendanceError(
          entry,
          `${name}: check out must be later than check in for this daily record.`,
          'checkOut',
        );
    }
    let changes = 0;
    for (const entry of entries) {
      if (sameAttendance(entry, editableAttendance(entry.employeeId, entry.date))) continue;
      if (entry.status === 'Not marked')
        HR.state.attendance = HR.state.attendance.filter(
          (r) => !(r.employeeId === entry.employeeId && r.date === entry.date),
        );
      else {
        const existing = HR.state.attendance.find(
          (r) => r.employeeId === entry.employeeId && r.date === entry.date,
        );
        const values = {
          ...entry,
          checkIn: entry.status === 'Absent' ? '' : entry.checkIn || '',
          checkOut: entry.status === 'Absent' ? '' : entry.checkOut || '',
          note: 'Updated in daily attendance register',
        };
        if (existing) Object.assign(existing, values);
        else HR.state.attendance.push({ id: freshId('ATT'), ...values });
      }
      changes++;
    }
    if (
      changes &&
      !(await HR.save(
        `Updated attendance for ${changes} ${changes === 1 ? 'employee entry' : 'employee entries'} in the daily register`,
      ))
    )
      return;
    HR.ui.attDrafts = {};
    HR.ui.attErrors = {};
    rerenderAttendance();
    HR.toast(
      changes
        ? `Attendance saved for ${changes} ${changes === 1 ? 'entry' : 'entries'}.`
        : 'Attendance is already up to date.',
    );
  }
  function exportAttendance() {
    const doExport = () => {
      const monthly = HR.ui.attMode === 'monthly',
        dates = monthly
          ? monthDates(HR.ui.attMonth || HR.month).filter((d) => d <= HR.today)
          : [HR.ui.attDate || HR.today];
      if (monthly) {
        const rows = [
          [
            'Employee ID',
            'Name',
            'Department',
            'Month',
            'Present days',
            'Half-day records',
            'Absent days',
            'Approved leave days',
            'Not marked',
            'Off / holiday',
          ],
        ];
        attendanceEmployees().forEach((e) => {
          const records = dates.filter((d) => HR.employedDuring(e, d)).map((d) => HR.attendanceFor(e.id, d)),
            n = (status) => records.filter((r) => r.status === status).length;
          rows.push([
            e.id,
            e.name,
            e.department,
            HR.ui.attMonth || HR.month,
            n('Present'),
            n('Half-day'),
            n('Absent'),
            records.reduce((sum, r) => sum + Number(r.leaveDays || 0), 0),
            n('Not marked'),
            n('Weekly off') + n('Holiday'),
          ]);
        });
        HR.csv('ZetaERP_Monthly_Attendance.csv', rows);
        return;
      }
      const rows = [
        [
          'Employee ID',
          'Name',
          'Department',
          'Date',
          'Status',
          'Approved leave days',
          'Check in',
          'Check out',
          'Correction reason',
        ],
      ];
      attendanceEmployees().forEach((e) =>
        dates.forEach((date) => {
          if (!HR.employedDuring(e, date)) return;
          const r = HR.attendanceFor(e.id, date);
          if (HR.ui.attStatus && r.status !== HR.ui.attStatus) return;
          rows.push([
            e.id,
            e.name,
            e.department,
            date,
            r.status,
            Number(r.leaveDays || 0),
            r.checkIn || '',
            r.checkOut || '',
            r.note || '',
          ]);
        }),
      );
      HR.csv('ZetaERP_Attendance.csv', rows);
    };
    if (draftEntries().length)
      HR.confirm({
        title: 'Export saved attendance?',
        body: 'You have unsaved attendance changes. This export includes saved records only. Save attendance first to include your latest edits.',
        confirmLabel: 'Export saved records',
        onConfirm: doExport,
      });
    else doExport();
  }
  HR.afterRender.attendance = () => {
    $('#attendance-search').addEventListener('input', (e) => {
      HR.ui.attSearch = e.target.value;
      HR.ui.attPage = 1;
      updateViewPreservingFocus('attendance-search');
    });
    $('#attendance-dept').addEventListener('change', (e) => {
      HR.ui.attDept = e.target.value;
      HR.ui.attPage = 1;
      rerenderAttendance();
    });
    $('#attendance-date')?.addEventListener('change', (e) => {
      if (e.target.value) {
        HR.ui.attDate = e.target.value;
        HR.ui.attPage = 1;
        rerenderAttendance();
      }
    });
    $('#attendance-month')?.addEventListener('change', (e) => {
      if (e.target.value) {
        HR.ui.attMonth = e.target.value;
        HR.ui.attPage = 1;
        rerenderAttendance();
      }
    });
    $('#attendance-status')?.addEventListener('change', (e) => {
      HR.ui.attStatus = e.target.value;
      rerenderAttendance();
    });
    $('#attendance-clear-filters').addEventListener('click', () => {
      HR.ui.attSearch = '';
      HR.ui.attDept = '';
      HR.ui.attStatus = '';
      HR.ui.attPage = 1;
      rerenderAttendance();
    });
    $$('[data-att-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        HR.ui.attMode = b.dataset.attMode;
        HR.ui.attPage = 1;
        rerenderAttendance();
      }),
    );
    $$('[data-att-status]').forEach((b) =>
      b.addEventListener('click', () => {
        setAttendanceDraft(b.dataset.employee, HR.ui.attDate || HR.today, { status: b.dataset.attStatus });
        rerenderAttendance(b.id);
      }),
    );
    $$('[data-att-clear]').forEach((b) =>
      b.addEventListener('click', () => {
        setAttendanceDraft(b.dataset.attClear, HR.ui.attDate || HR.today, {
          status: 'Not marked',
          checkIn: '',
          checkOut: '',
        });
        rerenderAttendance('att-present-' + b.dataset.attClear);
      }),
    );
    $$('[data-att-time]').forEach((control) =>
      control.addEventListener('input', () => {
        setAttendanceDraft(control.dataset.employee, HR.ui.attDate || HR.today, {
          [control.dataset.attTime]: control.value,
        });
        syncDraftSummary();
      }),
    );
    $$('[data-save-attendance]').forEach((b) => b.addEventListener('click', saveAttendance));
    $$('[data-discard-attendance]').forEach((b) =>
      b.addEventListener('click', () =>
        HR.confirm({
          title: 'Discard unsaved attendance?',
          body: 'Your saved attendance will remain unchanged. All pending edits across dates will be removed.',
          confirmLabel: 'Discard changes',
          danger: true,
          async onConfirm() {
            HR.ui.attDrafts = {};
            HR.ui.attErrors = {};
            rerenderAttendance();
          },
        }),
      ),
    );
    $$('[data-review-attendance]').forEach((b) =>
      b.addEventListener('click', () => {
        const first = draftEntries()[0];
        if (!first) return;
        HR.ui.attDate = first.date;
        HR.ui.attMode = 'daily';
        HR.ui.attSearch = '';
        HR.ui.attDept = '';
        HR.ui.attStatus = '';
        HR.render();
        view.getElementById('att-present-' + first.employeeId)?.focus();
      }),
    );
    $('#export-attendance').addEventListener('click', exportAttendance);
    bindPaging();
  };
  HR.markAttendance = () => HR.navigate('attendance', '#daily-attendance-register');

  /* LEAVE */
  function filteredLeaves() {
    const q = (HR.ui.leaveSearch || '').toLowerCase();
    return HR.state.leaves
      .filter((l) => {
        const e = HR.employee(l.employeeId);
        return (
          (!q || `${e?.name || ''} ${e?.id || ''}`.toLowerCase().includes(q)) &&
          (!HR.ui.leaveStatus || l.status === HR.ui.leaveStatus) &&
          (!HR.ui.leaveType || l.type === HR.ui.leaveType)
        );
      })
      .sort((a, b) => String(b.applied).localeCompare(String(a.applied)));
  }
  function daysText(n) {
    return `${n} ${n === 1 ? 'day' : 'days'}`;
  }
  HR.renderers.leave = () => {
    const mode = HR.ui.leaveMode || 'requests',
      pending = HR.state.leaves.filter((x) => x.status === 'Pending').length,
      approved = HR.state.leaves.filter((x) => x.status === 'Approved' && x.from.startsWith(HR.month)).length,
      today = HR.employeesForPeriod(HR.today, HR.today).filter(
        (e) => Number(HR.attendanceFor(e.id, HR.today).leaveDays || 0) > 0,
      ).length;
    const list = filteredLeaves(),
      page = paging(list, 'leavePage', 'requests');
    let content;
    if (mode === 'requests')
      content = `<div class="filter-bar"><div class="search-field">${HR.icon('search')}<input type="search" id="leave-search" placeholder="Search employee or ID" value="${E(HR.ui.leaveSearch)}" aria-label="Search leave requests"></div><select id="leave-status" aria-label="Filter leave by status">${options(['Pending', 'Approved', 'Rejected', 'Cancelled'], HR.ui.leaveStatus, 'All statuses')}</select><select id="leave-type" aria-label="Filter leave by type">${options(
        HR.state.settings.leaveTypes.map((t) => t.name),
        HR.ui.leaveType,
        'All leave types',
      )}</select><button class="btn btn-ghost" id="leave-clear">Clear filters</button></div><section class="card"><div class="card-header"><div><h2 class="card-title">Leave requests</h2><p class="card-subtitle">Review requests and keep balances up to date.</p></div><span class="pill">${pending} pending</span></div>${
        page.rows.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Leave type</th><th>Dates</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead><tbody>${page.rows
              .map((l) => {
                const e = HR.employee(l.employeeId);
                return `<tr><td>${e ? person(e) : E(l.employeeId)}</td><td><div class="cell-primary">${E(l.type)}</div><div class="cell-secondary leave-reason" title="${E(l.reason)}">${E(l.reason)}</div></td><td>${HR.date(l.from)}${l.to !== l.from ? `<div class="cell-secondary">to ${HR.date(l.to)}</div>` : ''}</td><td>${daysText(l.days)}${l.halfDay ? ' <span class="cell-secondary">(half-day)</span>' : ''}</td><td>${HR.badge(l.status)}</td><td><div class="row-actions">${l.status === 'Pending' ? `<button class="icon-btn text-success" data-leave-approve="${E(l.id)}" aria-label="Approve leave for ${E(e?.name)}" title="Approve">${HR.icon('check')}</button><button class="icon-btn text-danger" data-leave-reject="${E(l.id)}" aria-label="Reject leave for ${E(e?.name)}" title="Reject">${HR.icon('x')}</button>` : ''}<button class="icon-btn" data-leave-view="${E(l.id)}" aria-label="View leave for ${E(e?.name)}" title="View request">${HR.icon('eye')}</button></div></td></tr>`;
              })
              .join('')}</tbody></table></div>`
          : HR.empty('No leave requests found', 'Change the filters or create a new request.')
      }${page.footer}</section>`;
    else {
      const employees = HR.activeEmployees();
      content = `<section class="card"><div class="card-header"><div><h2 class="card-title">Employee leave balances</h2><p class="card-subtitle">${HR.today.slice(0, 4)} allocation · Approved requests reduce the available balance.</p></div><button class="btn btn-secondary btn-sm" id="export-balances">${HR.icon('download')} Export balances</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Department</th>${HR.state.settings.leaveTypes
        .filter((t) => t.name !== 'Unpaid leave')
        .map((t) => `<th>${E(t.name)}</th>`)
        .join('')}<th>Pending days</th></tr></thead><tbody>${employees
        .map(
          (e) =>
            `<tr><td>${person(e)}</td><td>${E(e.department)}</td>${HR.state.settings.leaveTypes
              .filter((t) => t.name !== 'Unpaid leave')
              .map(
                (t) =>
                  `<td><strong>${HR.leaveBalance(e.id, t.name)}</strong> <span class="cell-secondary">/ ${t.days} days</span></td>`,
              )
              .join(
                '',
              )}<td>${HR.state.leaves.filter((l) => l.employeeId === e.id && l.status === 'Pending' && l.from.startsWith(HR.today.slice(0, 4))).reduce((s, l) => s + l.days, 0)}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><div class="table-footer"><span class="muted">Unpaid leave is tracked separately and has no paid leave balance.</span></div></section>`;
    }
    return (
      title(
        'Leave management',
        'Simple requests, clear approvals and accurate leave balances.',
        `<button class="btn btn-secondary" id="export-leave">${HR.icon('download')} Export</button><button class="btn btn-primary" id="new-leave">${HR.icon('plus')} New leave request</button>`,
      ) +
      `<div class="stats-grid">${statistic('Pending requests', pending, 'Waiting for your review', 'clock', 'amber')}${statistic('Approved this month', approved, 'Requests starting in ' + HR.date(HR.today, { day: undefined, year: undefined, month: 'long' }), 'checkCircle', 'green')}${statistic('On leave today', today, 'Approved leave for ' + HR.date(HR.today), 'calendar', 'purple')}${statistic('Leave types', HR.state.settings.leaveTypes.length, 'Configured leave policies', 'file')}</div><div class="tabs"><button class="tab ${mode === 'requests' ? 'active' : ''}" data-leave-mode="requests">Leave requests <span class="tab-count">${pending}</span></button><button class="tab ${mode === 'balances' ? 'active' : ''}" data-leave-mode="balances">Leave balances</button></div>${content}`
    );
  };
  HR.afterRender.leave = () => {
    $$('[data-leave-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        HR.ui.leaveMode = b.dataset.leaveMode;
        HR.render();
      }),
    );
    $('#leave-search')?.addEventListener('input', (e) => {
      HR.ui.leaveSearch = e.target.value;
      HR.ui.leavePage = 1;
      updateViewPreservingFocus('leave-search');
    });
    $('#leave-status')?.addEventListener('change', (e) => {
      HR.ui.leaveStatus = e.target.value;
      HR.ui.leavePage = 1;
      HR.render();
    });
    $('#leave-type')?.addEventListener('change', (e) => {
      HR.ui.leaveType = e.target.value;
      HR.ui.leavePage = 1;
      HR.render();
    });
    $('#leave-clear')?.addEventListener('click', () => {
      HR.ui.leaveSearch = '';
      HR.ui.leaveStatus = '';
      HR.ui.leaveType = '';
      HR.ui.leavePage = 1;
      HR.render();
    });
    $('#new-leave').addEventListener('click', leaveForm);
    $$('[data-leave-approve]').forEach((b) =>
      b.addEventListener('click', () => approveLeave(b.dataset.leaveApprove)),
    );
    $$('[data-leave-reject]').forEach((b) =>
      b.addEventListener('click', () => rejectLeave(b.dataset.leaveReject)),
    );
    $$('[data-leave-view]').forEach((b) =>
      b.addEventListener('click', () => leaveDetails(b.dataset.leaveView)),
    );
    $('#export-leave').addEventListener('click', () =>
      HR.csv('ZetaERP_Leave_Requests.csv', [
        ['Employee ID', 'Employee', 'Type', 'From', 'To', 'Days', 'Status', 'Reason'],
        ...filteredLeaves().map((l) => [
          l.employeeId,
          HR.employee(l.employeeId)?.name || '',
          l.type,
          l.from,
          l.to,
          l.days,
          l.status,
          l.reason,
        ]),
      ]),
    );
    $('#export-balances')?.addEventListener('click', () => {
      const types = HR.state.settings.leaveTypes.filter((t) => t.name !== 'Unpaid leave');
      HR.csv('ZetaERP_Leave_Balances.csv', [
        ['Employee ID', 'Employee', ...types.map((t) => t.name)],
        ...HR.activeEmployees().map((e) => [
          e.id,
          e.name,
          ...types.map((t) => HR.leaveBalance(e.id, t.name)),
        ]),
      ]);
    });
    bindPaging();
  };
  function overlap(candidate, ignoreId) {
    return HR.state.leaves.find(
      (l) =>
        l.id !== ignoreId &&
        l.employeeId === candidate.employeeId &&
        ['Pending', 'Approved'].includes(l.status) &&
        l.from <= candidate.to &&
        l.to >= candidate.from,
    );
  }
  function leaveEmploymentIssue(leave) {
    const employee = HR.employee(leave.employeeId);
    if (!employee) return 'This employee record is unavailable.';
    if (employee.status === 'Inactive')
      return 'Leave cannot be requested or approved for an inactive employee.';
    if (employee.joined && leave.from < employee.joined)
      return 'Leave cannot start before the employee joining date.';
    if (employee.leavingDate && leave.to > employee.leavingDate)
      return 'Leave cannot extend beyond the employee leaving date.';
    return '';
  }
  function leaveForm() {
    if (!HR.activeEmployees().length) return HR.toast('Add an active employee first.', 'warning');
    HR.openModal({
      title: 'New leave request',
      subtitle: 'Working days are calculated from the company calendar.',
      wide: true,
      body: `<form id="modal-form">${errorBox}<div class="form-grid">${field(
        'Employee *',
        `<select name="employeeId" required>${HR.activeEmployees()
          .map((e) => `<option value="${E(e.id)}">${E(e.name)} · ${E(e.id)}</option>`)
          .join('')}</select>`,
      )}${field(
        'Leave type *',
        select(
          'type',
          HR.state.settings.leaveTypes.map((t) => t.name),
          HR.state.settings.leaveTypes[0]?.name,
          'required',
        ),
      )}${field('From *', input('from', HR.today, 'type="date" required'))}${field('To *', input('to', HR.today, 'type="date" required'))}<div class="span-2"><label class="check-label"><input type="checkbox" name="halfDay"> Half-day request</label></div><div class="span-2 notice notice-info" id="leave-calculation"></div><div class="span-2">${field('Reason *', '<textarea name="reason" rows="3" required maxlength="300" placeholder="Add a short reason for the request"></textarea>')}</div></div></form>`,
      footer: formFooter('Submit request'),
      onMount(dialog) {
        cancelBinding(dialog);
        const form = $('#modal-form', dialog);
        const calculate = () => {
          const f = Object.fromEntries(new FormData(form));
          const work = HR.workingDays(f.from, f.to),
            days = f.halfDay ? 0.5 : work,
            balance = HR.leaveBalance(f.employeeId, f.type);
          $('#leave-calculation', dialog).textContent =
            `Requested: ${work ? daysText(days) : '0 working days'} · Available: ${Number.isFinite(balance) ? daysText(balance) : 'Unpaid leave'}. Weekends and holidays are excluded.`;
        };
        ['employeeId', 'type', 'from', 'to', 'halfDay'].forEach((n) =>
          form.elements[n].addEventListener('change', calculate),
        );
        calculate();
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!form.reportValidity()) return;
          const f = Object.fromEntries(new FormData(form));
          f.reason = f.reason.trim();
          f.halfDay = !!f.halfDay;
          const employmentIssue = leaveEmploymentIssue(f);
          if (employmentIssue) return message(dialog, employmentIssue);
          if (!f.reason) return message(dialog, 'Add a reason for this request.');
          if (f.to < f.from) return message(dialog, 'The end date must be on or after the start date.');
          if (f.from.slice(0, 4) !== HR.today.slice(0, 4) || f.to.slice(0, 4) !== HR.today.slice(0, 4))
            return message(dialog, 'Choose dates within the leave year ' + HR.today.slice(0, 4) + '.');
          if (f.halfDay && f.from !== f.to)
            return message(dialog, 'A half-day request must start and end on the same day.');
          const work = HR.workingDays(f.from, f.to);
          if (work === 0) return message(dialog, 'Select at least one working day.');
          f.days = f.halfDay ? 0.5 : work;
          if (f.days > HR.leaveBalance(f.employeeId, f.type))
            return message(dialog, 'The requested days exceed the available leave balance.');
          if (overlap(f))
            return message(
              dialog,
              'This employee already has a pending or approved request for these dates.',
            );
          HR.state.leaves.unshift({ id: freshId('LV'), ...f, status: 'Pending', applied: HR.today });
          if (!(await HR.save(`Created leave request for ${HR.employee(f.employeeId).name}`))) return;
          HR.closeModal();
          HR.ui.leaveMode = 'requests';
          HR.ui.leaveStatus = '';
          HR.ui.leavePage = 1;
          HR.render();
          HR.toast('Leave request submitted for approval.');
        });
      },
    });
  }
  function approveLeave(id) {
    const l = HR.state.leaves.find((x) => x.id === id);
    if (!l || l.status !== 'Pending') return;
    const e = HR.employee(l.employeeId);
    const employmentIssue = leaveEmploymentIssue(l);
    if (employmentIssue) return HR.toast(employmentIssue, 'warning');
    if (l.days > HR.leaveBalance(l.employeeId, l.type))
      return HR.toast('This request exceeds the remaining leave balance.', 'warning');
    if (overlap(l, l.id))
      return HR.toast('This request overlaps another pending or approved request.', 'warning');
    HR.confirm({
      title: 'Approve leave request?',
      body: `Approve ${daysText(l.days)} of ${E(l.type.toLowerCase())} for ${E(e?.name)}? The balance and attendance will update together.`,
      confirmLabel: 'Approve leave',
      async onConfirm() {
        l.status = 'Approved';
        if (!(await HR.save(`Approved ${e?.name}'s leave request`))) return;
        HR.closeModal();
        HR.render();
        HR.toast('Leave approved. Balance and attendance updated.');
      },
    });
  }
  function rejectLeave(id) {
    const l = HR.state.leaves.find((x) => x.id === id);
    if (!l || l.status !== 'Pending') return;
    const e = HR.employee(l.employeeId);
    HR.openModal({
      title: 'Reject leave request',
      subtitle: `${e?.name} · ${daysText(l.days)} of ${l.type.toLowerCase()}`,
      body: `<form id="modal-form">${field('Reason for rejection *', '<textarea name="reason" rows="3" required maxlength="240" placeholder="Explain the reason to the employee"></textarea>')}</form>`,
      footer: formFooter('Reject request'),
      onMount(dialog) {
        cancelBinding(dialog);
        $('#modal-form', dialog).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!ev.target.reportValidity()) return;
          const reason = ev.target.elements.reason.value.trim();
          if (!reason) return;
          l.status = 'Rejected';
          l.reviewNote = reason;
          if (!(await HR.save(`Rejected ${e?.name}'s leave request`))) return;
          HR.closeModal();
          HR.render();
          HR.toast('Leave request rejected.');
        });
      },
    });
  }
  function leaveDetails(id) {
    const l = HR.state.leaves.find((x) => x.id === id);
    if (!l) return;
    const e = HR.employee(l.employeeId);
    HR.openModal({
      title: 'Leave request',
      subtitle: e ? `${e.name} · ${e.id}` : l.employeeId,
      body: `<div class="detail-grid"><div class="detail-item"><span>Leave type</span><strong>${E(l.type)}</strong></div><div class="detail-item"><span>Status</span>${HR.badge(l.status)}</div><div class="detail-item"><span>Dates</span><strong>${HR.date(l.from)}${l.from !== l.to ? ' – ' + HR.date(l.to) : ''}</strong></div><div class="detail-item"><span>Duration</span><strong>${daysText(l.days)}</strong></div><div class="detail-item"><span>Applied</span><strong>${HR.date(l.applied)}</strong></div></div><h3 class="section-label">Reason</h3><p>${E(l.reason)}</p>${l.reviewNote ? `<h3 class="section-label">Review note</h3><p>${E(l.reviewNote)}</p>` : ''}`,
      footer: `${['Pending', 'Approved'].includes(l.status) ? '<button class="btn btn-secondary" id="cancel-leave-request">Cancel request</button>' : ''}<button class="btn btn-primary" data-cancel>Close</button>`,
      onMount(dialog) {
        cancelBinding(dialog);
        $('#cancel-leave-request', dialog)?.addEventListener('click', () => {
          HR.closeModal();
          HR.confirm({
            title: 'Cancel this leave request?',
            body:
              l.status === 'Approved'
                ? 'The approved balance will be restored and attendance will return to its recorded or unmarked state.'
                : 'This request will be marked as cancelled.',
            confirmLabel: 'Cancel request',
            danger: true,
            async onConfirm() {
              l.status = 'Cancelled';
              if (!(await HR.save(`Cancelled ${e?.name}'s leave request`))) return;
              HR.closeModal();
              HR.render();
              HR.toast('Leave request cancelled.');
            },
          });
        });
      },
    });
  }
  HR.newLeave = leaveForm;
  HR.approveLeave = approveLeave;
  HR.viewLeave = leaveDetails;
}
