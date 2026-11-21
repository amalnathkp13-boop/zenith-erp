export function installSalaryAndSettings(H, view) {
  const $ = (selector, root = view) => root.querySelector(selector);
  const $$ = (selector, root = view) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => H.esc(String(value == null ? '' : value));
  const net = (row) => Number(row.basic || 0) + Number(row.allowance || 0) - Number(row.deduction || 0);
  const isDaily = (row) => row.salaryType === 'daily';
  const salaryBasis = (row) => (isDaily(row) ? 'Per day' : 'Monthly');
  const daysInMonth = (month) => {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number, 0)).getUTCDate();
  };
  const monthLabel = (value) =>
    new Date(value + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const uid = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cancelButton = '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>';
  const field = (label, control, hint) => H.field(label, control, hint || '');
  async function persist(message) {
    if (!(await H.save(message))) return;
    H.closeModal();
    H.render();
    H.toast(message);
  }
  function currentMonth() {
    return H.ui.payMonth || H.month;
  }
  function monthRows() {
    return H.state.salaries.filter((row) => row.month === currentMonth());
  }
  function filteredSalaryRows() {
    const q = (H.ui.paySearch || '').trim().toLowerCase();
    const status = H.ui.payStatus || '';
    return monthRows().filter((row) => {
      const employee = H.employee(row.employeeId);
      if (!employee) return false;
      const matches =
        !q || [employee.name, employee.id, employee.department].join(' ').toLowerCase().includes(q);
      const matchesStatus =
        !status ||
        (status === 'Paid'
          ? row.paid
          : status === 'Finalized'
            ? row.status === 'Finalized' && !row.paid
            : row.status === status);
      return matches && matchesStatus;
    });
  }
  function salaryTable(rows) {
    if (!rows.length)
      return H.empty(
        'No salary records found',
        monthRows().length
          ? 'Try another name or status.'
          : 'Prepare this month to create draft records for your active employees.',
      );
    return (
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Basic earnings</th><th>Allowances</th><th>Deductions</th><th>Net payable</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      rows
        .map((row) => {
          const employee = H.employee(row.employeeId);
          const basisDetail = isDaily(row)
            ? H.money(row.dailyRate) +
              '/day · ' +
              (row.paidDays == null ? 'paid days needed' : esc(row.paidDays) + ' paid days')
            : 'Monthly salary';
          return (
            '<tr><td><div class="person-cell">' +
            H.avatar(employee, true) +
            '<div><div class="cell-primary">' +
            esc(employee.name) +
            '</div><div class="cell-secondary">' +
            esc(employee.id) +
            ' · ' +
            esc(employee.department) +
            '</div></div></div></td><td>' +
            H.money(row.basic) +
            '<div class="cell-secondary">' +
            basisDetail +
            '</div></td><td>' +
            H.money(row.allowance) +
            '</td><td>' +
            H.money(row.deduction) +
            '</td><td><strong>' +
            H.money(net(row)) +
            '</strong></td><td>' +
            H.badge(row.paid ? 'Paid' : row.status === 'Finalized' ? 'Unpaid' : 'Draft') +
            '</td><td><div class="row-actions">' +
            (row.status === 'Draft'
              ? '<button ' +
                (row.managedByPayroll ? 'disabled ' : '') +
                'class="btn btn-ghost btn-sm" data-salary-edit="' +
                esc(row.id) +
                '" title="Review salary">' +
                H.icon('edit', 16) +
                'Review</button>'
              : '<button class="btn btn-ghost btn-sm" data-payslip="' +
                esc(row.id) +
                '" title="View payslip">' +
                H.icon('file', 16) +
                'Payslip</button>' +
                (!row.paid && !row.managedByPayroll
                  ? '<button class="icon-btn" data-salary-paid="' +
                    esc(row.id) +
                    '" aria-label="Mark salary paid for ' +
                    esc(employee.name) +
                    '" title="Mark paid">' +
                    H.icon('check', 17) +
                    '</button>'
                  : '')) +
            '</div></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }
  H.renderers.payroll = function () {
    const rows = monthRows();
    const drafts = rows.filter((row) => row.status === 'Draft');
    const finalized = rows.filter((row) => row.status === 'Finalized');
    const total = rows.reduce((sum, row) => sum + net(row), 0);
    const pendingAmount = finalized.filter((row) => !row.paid).reduce((sum, row) => sum + net(row), 0);
    return (
      '<div class="page-heading"><div class="page-title-text"><div class="eyebrow">PEOPLE OPERATIONS</div><h1>Salary &amp; Payslips</h1><p class="muted">Review monthly pay, finalize records, and keep payslips in one place.</p></div><div class="page-actions"><button class="btn btn-secondary" id="pay-export">' +
      H.icon('download') +
      'Export</button><button class="btn btn-primary" id="pay-prepare">' +
      H.icon('plus') +
      'Prepare month</button></div></div>' +
      '<div class="stats-grid"><div class="stat-card"><span class="stat-icon purple">' +
      H.icon('wallet') +
      '</span><div class="stat-label">Monthly net payable</div><div class="stat-value">' +
      H.money(total) +
      '</div><div class="stat-foot">' +
      rows.length +
      ' salary records · ' +
      monthLabel(currentMonth()) +
      '</div></div><div class="stat-card"><span class="stat-icon blue">' +
      H.icon('clipboardReview') +
      '</span><div class="stat-label">Awaiting review</div><div class="stat-value">' +
      drafts.length +
      '</div><div class="stat-foot">Draft records to finalize</div></div><div class="stat-card"><span class="stat-icon amber">' +
      H.icon('banknoteClock') +
      '</span><div class="stat-label">Unpaid finalized salaries</div><div class="stat-value">' +
      H.money(pendingAmount) +
      '</div><div class="stat-foot">' +
      finalized.filter((row) => !row.paid).length +
      ' records awaiting payment</div></div><div class="stat-card"><span class="stat-icon green">' +
      H.icon('banknoteCheck') +
      '</span><div class="stat-label">Salaries paid</div><div class="stat-value">' +
      rows.filter((row) => row.paid).length +
      '<span class="muted" style="font-size:1rem;font-weight:500"> / ' +
      rows.length +
      '</span></div><div class="stat-foot">Recorded payment status</div></div></div>' +
      '<div class="filter-bar"><div class="search-field">' +
      H.icon('search') +
      '<input id="pay-search" type="search" placeholder="Search employees or departments" aria-label="Search salary records" value="' +
      esc(H.ui.paySearch || '') +
      '"></div><label class="inline muted" for="pay-month">Pay period <input type="month" id="pay-month" min="2020-01" max="2100-12" value="' +
      esc(currentMonth()) +
      '"></label><select id="pay-status" aria-label="Filter salary status"><option value="">All statuses</option>' +
      ['Draft', 'Finalized', 'Paid']
        .map(
          (value) =>
            '<option value="' +
            value +
            '"' +
            (H.ui.payStatus === value ? ' selected' : '') +
            '>' +
            (value === 'Finalized' ? 'Finalized · unpaid' : value) +
            '</option>',
        )
        .join('') +
      '</select></div>' +
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Salary register</h2><p class="card-subtitle">' +
      monthLabel(currentMonth()) +
      ' · Earnings and deductions in INR</p></div><span class="pill" id="pay-count">' +
      filteredSalaryRows().length +
      ' records</span></div><div id="pay-table">' +
      salaryTable(filteredSalaryRows()) +
      '</div><div class="table-footer"><span class="muted">Finalize a reviewed record to make its payslip available.</span><span class="muted">Currency: INR</span></div></section>' +
      '<div class="notice notice-info">' +
      H.icon('info') +
      '<span>Use Payroll for statutory deductions and payroll runs.</span></div>'
    );
  };
  function bindSalaryRows() {
    $$('[data-salary-edit]').forEach((button) =>
      button.addEventListener('click', () => editSalary(button.dataset.salaryEdit)),
    );
    $$('[data-payslip]').forEach((button) =>
      button.addEventListener('click', () => showPayslip(button.dataset.payslip)),
    );
    $$('[data-salary-paid]').forEach((button) =>
      button.addEventListener('click', () => markPaid(button.dataset.salaryPaid)),
    );
  }
  function refreshSalaryTable() {
    const rows = filteredSalaryRows();
    $('#pay-table').innerHTML = salaryTable(rows);
    $('#pay-count').textContent = rows.length + ' records';
    bindSalaryRows();
  }
  H.afterRender.payroll = function () {
    $('#pay-search').addEventListener('input', (event) => {
      H.ui.paySearch = event.target.value;
      refreshSalaryTable();
    });
    $('#pay-status').addEventListener('change', (event) => {
      H.ui.payStatus = event.target.value;
      refreshSalaryTable();
    });
    $('#pay-month').addEventListener('change', (event) => {
      if (!event.target.value) return;
      H.ui.payMonth = event.target.value;
      H.render();
    });
    $('#pay-export').addEventListener('click', () => {
      H.csv('salary-register-' + currentMonth() + '.csv', [
        [
          'Employee ID',
          'Employee',
          'Department',
          'Month',
          'Salary basis',
          'Daily rate',
          'Paid days',
          'Basic earnings',
          'Allowances',
          'Deductions',
          'Net payable',
          'Record status',
          'Payment status',
        ],
        ...filteredSalaryRows().map((row) => {
          const employee = H.employee(row.employeeId);
          return [
            employee.id,
            employee.name,
            employee.department,
            row.month,
            salaryBasis(row),
            isDaily(row) ? row.dailyRate : '',
            isDaily(row) && row.paidDays != null ? row.paidDays : '',
            row.basic,
            row.allowance,
            row.deduction,
            net(row),
            row.status,
            row.paid ? 'Paid' : 'Unpaid',
          ];
        }),
      ]);
      H.toast('Salary register exported.');
    });
    $('#pay-prepare').addEventListener('click', prepareMonth);
    bindSalaryRows();
  };
  function prepareMonth() {
    const month = currentMonth();
    const existing = new Set(monthRows().map((row) => row.employeeId));
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    const missing = H.employeesForPeriod(month + '-01', lastDay).filter(
      (employee) => !existing.has(employee.id),
    );
    if (!missing.length) {
      H.toast('No additional employee records are needed for this month.', 'info');
      return;
    }
    H.confirm({
      title: 'Prepare ' + monthLabel(month) + '?',
      body:
        '<p>Create <strong>' +
        missing.length +
        ' draft salary records</strong> using each employee’s agreed salary basis. Existing records will be preserved.</p><p class="muted">Review earnings and deductions before finalizing. Per-day records require a reviewed number of paid days.</p>',
      confirmLabel: 'Create drafts',
      onConfirm: () => {
        missing.forEach((employee) => {
          const daily = employee.salaryType === 'daily';
          H.state.salaries.push({
            id: uid('SAL'),
            employeeId: employee.id,
            month,
            salaryType: daily ? 'daily' : 'monthly',
            ...(daily ? { dailyRate: Number(employee.salary) || 0, paidDays: null } : {}),
            basic: daily ? 0 : Number(employee.salary) || 0,
            allowance: 0,
            deduction: 0,
            status: 'Draft',
            paid: false,
          });
        });
        persist('Created ' + missing.length + ' salary drafts for ' + monthLabel(month) + '.');
      },
    });
  }
  function editSalary(id) {
    const row = H.state.salaries.find((item) => item.id === id);
    if (!row || row.managedByPayroll || row.status !== 'Draft') return;
    const employee = H.employee(row.employeeId);
    const daily = isDaily(row);
    const employeeDaily = employee.salaryType === 'daily';
    const basisChanged =
      daily !== employeeDaily || (daily && Number(row.dailyRate) !== Number(employee.salary));
    const basisNotice = basisChanged
      ? '<div class="notice notice-info" style="align-items:flex-start;flex-wrap:wrap"><span style="flex:1;min-width:180px">This draft uses its saved salary basis. The employee’s current setup is <strong>' +
        H.money(employee.salary) +
        (employeeDaily ? ' per day' : ' per month') +
        '</strong>.</span><button type="button" class="btn btn-secondary btn-sm" id="salary-use-current-basis">Use current salary basis</button></div>'
      : '';
    const maxPaidDays = daysInMonth(row.month);
    const basicFields = daily
      ? field(
          'Rate per day (₹)',
          '<input name="dailyRate" type="number" min="0" max="100000000" step="0.01" required value="' +
            esc(row.dailyRate) +
            '">',
        ) +
        field(
          'Reviewed paid days',
          '<input name="paidDays" type="number" min="0" max="' +
            maxPaidDays +
            '" step="0.5" required placeholder="Enter paid days" value="' +
            (row.paidDays == null ? '' : esc(row.paidDays)) +
            '">',
          'Enter reviewed payable days, including any applicable paid leave. Maximum ' +
            maxPaidDays +
            ' days.',
        ) +
        field(
          'Basic earnings (₹)',
          '<input name="basic" type="number" readonly aria-readonly="true" value="' + row.basic + '">',
          'Rate per day × reviewed paid days.',
        )
      : field(
          'Basic salary (₹)',
          '<input name="basic" type="number" min="0" max="100000000" step="0.01" required value="' +
            row.basic +
            '">',
        );
    H.openModal({
      title: 'Review salary',
      subtitle: employee.name + ' · ' + monthLabel(row.month) + ' · ' + salaryBasis(row),
      wide: false,
      body:
        basisNotice +
        '<form id="salary-form"><div class="form-grid">' +
        basicFields +
        field(
          'Allowances (₹)',
          '<input name="allowance" type="number" min="0" max="100000000" step="0.01" required value="' +
            row.allowance +
            '">',
        ) +
        field(
          'Deductions (₹)',
          '<input name="deduction" type="number" min="0" max="100000000" step="0.01" required value="' +
            row.deduction +
            '">',
          'Enter a reviewed total; missing attendance never deducts pay automatically.',
        ) +
        '<div class="field"><span>Net payable</span><strong id="salary-net" style="font-size:1.7rem;padding:12px 0">' +
        H.money(net(row)) +
        '</strong></div></div><p id="salary-error" role="alert" class="text-danger" hidden></p><div class="notice notice-info">' +
        H.icon('info') +
        '<span>Finalizing locks these amounts' +
        (daily ? ', rate, and paid days' : '') +
        ' and makes the payslip available.</span></div></form>',
      footer:
        cancelButton +
        '<button class="btn btn-secondary" type="submit" form="salary-form" name="action" value="save">Save draft</button><button class="btn btn-primary" type="submit" form="salary-form" name="action" value="finalize">Finalize record</button>',
      onMount: () => {
        const form = $('#salary-form');
        if (basisChanged)
          $('#salary-use-current-basis').addEventListener('click', () => useCurrentSalaryBasis(id));
        const read = () => {
          const dailyRate = daily ? Number(form.elements.dailyRate.value) : null;
          const paidDays =
            daily && form.elements.paidDays.value !== '' ? Number(form.elements.paidDays.value) : null;
          const basic = daily
            ? Math.round(dailyRate * Number(paidDays) * 100) / 100
            : Number(form.elements.basic.value);
          return {
            basic,
            allowance: Number(form.elements.allowance.value),
            deduction: Number(form.elements.deduction.value),
            ...(daily ? { dailyRate, paidDays } : {}),
          };
        };
        form.addEventListener('input', () => {
          const values = read();
          if (daily) form.elements.basic.value = Number.isFinite(values.basic) ? values.basic : 0;
          $('#salary-net').textContent = H.money(net(values));
          $('#salary-error').hidden = true;
        });
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const values = read();
          if (
            daily &&
            (form.elements.dailyRate.value === '' ||
              values.paidDays == null ||
              !Number.isFinite(values.paidDays) ||
              values.paidDays < 0 ||
              values.paidDays > maxPaidDays ||
              !Number.isInteger(values.paidDays * 2))
          ) {
            $('#salary-error').textContent =
              'Enter a daily rate and reviewed paid days from 0 to ' + maxPaidDays + ', in half-day steps.';
            $('#salary-error').hidden = false;
            return;
          }
          if (
            Object.values(values).some((value) => !Number.isFinite(value) || value < 0) ||
            net(values) < 0
          ) {
            $('#salary-error').textContent =
              'Amounts must be positive or zero. Deductions cannot exceed total earnings.';
            $('#salary-error').hidden = false;
            return;
          }
          Object.assign(row, values, { salaryType: daily ? 'daily' : 'monthly' });
          const finalized = event.submitter && event.submitter.value === 'finalize';
          if (finalized) row.status = 'Finalized';
          persist((finalized ? 'Finalized salary for ' : 'Saved salary draft for ') + employee.name + '.');
        });
      },
    });
  }
  function useCurrentSalaryBasis(id) {
    const row = H.state.salaries.find((item) => item.id === id);
    if (!row || row.managedByPayroll || row.status !== 'Draft') return;
    const employee = H.employee(row.employeeId);
    const daily = employee.salaryType === 'daily';
    H.confirm({
      title: 'Use current salary basis?',
      body:
        '<p>Update this draft for ' +
        esc(employee.name) +
        ' to <strong>' +
        H.money(employee.salary) +
        (daily ? ' per day' : ' per month') +
        '</strong>.</p><p>' +
        (daily
          ? 'Basic earnings will reset to zero until you enter reviewed paid days.'
          : 'Basic earnings will reset to the employee’s current monthly salary.') +
        ' Allowances and deductions will reset to zero for a fresh review.</p><p class="muted">Unsaved form changes will be discarded. Finalized salary records remain unchanged.</p>',
      confirmLabel: 'Update draft basis',
      onConfirm: async () => {
        if (row.status !== 'Draft') return;
        row.salaryType = daily ? 'daily' : 'monthly';
        row.basic = daily ? 0 : Number(employee.salary) || 0;
        row.allowance = 0;
        row.deduction = 0;
        if (daily) {
          row.dailyRate = Number(employee.salary) || 0;
          row.paidDays = null;
        } else {
          delete row.dailyRate;
          delete row.paidDays;
        }
        if (!(await H.save('Updated draft salary basis for ' + employee.name + '.'))) return;
        H.render();
        H.toast('Draft basis updated. Review the salary amounts before finalizing.');
        editSalary(id);
      },
    });
  }
  function markPaid(id) {
    const row = H.state.salaries.find((item) => item.id === id);
    if (!row || row.managedByPayroll || row.status !== 'Finalized' || row.paid) return;
    const employee = H.employee(row.employeeId);
    H.confirm({
      title: 'Record salary as paid?',
      body:
        '<p>Mark <strong>' +
        H.money(net(row)) +
        '</strong> for ' +
        esc(employee.name) +
        ' in ' +
        monthLabel(row.month) +
        ' as paid.</p><p class="muted">This records the payment status. No money is transferred.</p>',
      confirmLabel: 'Mark paid',
      onConfirm: () => {
        row.paid = true;
        persist('Marked salary paid for ' + employee.name + '.');
      },
    });
  }
  function payslipMarkup(row) {
    const employee = H.employee(row.employeeId);
    const basisDetails =
      '<div class="detail-item"><span>Salary basis</span><strong>' +
      salaryBasis(row) +
      '</strong></div>' +
      (isDaily(row)
        ? '<div class="detail-item"><span>Rate per day</span><strong>' +
          H.money(row.dailyRate) +
          '</strong></div><div class="detail-item"><span>Reviewed paid days</span><strong>' +
          esc(row.paidDays) +
          ' days</strong></div>'
        : '');
    const earningsLabel = isDaily(row)
      ? 'Daily earnings<div class="cell-secondary">' +
        H.money(row.dailyRate) +
        ' × ' +
        esc(row.paidDays) +
        ' paid days</div>'
      : 'Basic salary';
    return (
      '<section class="payslip"><div class="between inline" style="align-items:flex-start"><div><h2 style="margin:0 0 5px">' +
      esc(H.state.settings.company) +
      '</h2><p class="muted" style="margin:0">' +
      esc(H.state.settings.location) +
      '</p></div><span class="pill">Payslip</span></div><hr style="border:0;border-top:1px solid var(--border,#e5e7eb);margin:24px 0"><h3>Payslip · ' +
      monthLabel(row.month) +
      '</h3><div class="detail-grid"><div class="detail-item"><span>Employee</span><strong>' +
      esc(employee.name) +
      '</strong></div><div class="detail-item"><span>Employee ID</span><strong>' +
      esc(employee.id) +
      '</strong></div><div class="detail-item"><span>Department</span><strong>' +
      esc(employee.department) +
      '</strong></div><div class="detail-item"><span>Designation</span><strong>' +
      esc(employee.designation) +
      '</strong></div>' +
      basisDetails +
      '</div><div class="table-wrap" style="margin-top:24px"><table class="data-table"><thead><tr><th>Salary component</th><th style="text-align:right">Amount</th></tr></thead><tbody><tr><td>' +
      earningsLabel +
      '</td><td style="text-align:right">' +
      H.money(row.basic) +
      '</td></tr><tr><td>Allowances</td><td style="text-align:right">' +
      H.money(row.allowance) +
      '</td></tr><tr><td>Total earnings</td><td style="text-align:right"><strong>' +
      H.money(Number(row.basic) + Number(row.allowance)) +
      '</strong></td></tr><tr><td>Deductions</td><td style="text-align:right">− ' +
      H.money(row.deduction) +
      '</td></tr><tr><td><strong>Net payable</strong></td><td style="text-align:right;font-size:1.25rem"><strong>' +
      H.money(net(row)) +
      '</strong></td></tr></tbody></table></div><p class="muted">Payment status: <strong>' +
      (row.paid ? 'Paid' : 'Unpaid') +
      '</strong></p><p class="subtle" style="margin-top:24px">Generated from the finalized salary record.</p></section>'
    );
  }
  function showPayslip(id) {
    const row = H.state.salaries.find((item) => item.id === id);
    if (!row || row.status !== 'Finalized') return;
    const markup = payslipMarkup(row);
    H.openModal({
      title: 'Employee payslip',
      subtitle: monthLabel(row.month),
      body: markup,
      wide: true,
      footer:
        '<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button class="btn btn-primary" id="payslip-print">' +
        H.icon('print') +
        'Print / save PDF</button>',
      onMount: () => {
        $('#payslip-print').addEventListener('click', () =>
          H.printHtml(markup, 'Payslip — ' + H.employee(row.employeeId).name),
        );
      },
    });
  }

  const settingTabs = [
    ['organization', 'Organization', 'building'],
    ['departments', 'Departments', 'users'],
    ['leave-policy', 'Leave policy', 'calendar'],
    ['work-calendar', 'Work calendar', 'clock'],
    ['access', 'Access & history', 'shield'],
  ];
  H.renderers.settings = function () {
    const current = H.ui.settingsTab || 'organization';
    return (
      '<div class="page-heading"><div class="page-title-text"><div class="eyebrow">WORKSPACE PREFERENCES</div><h1>HR Settings</h1><p class="muted">Set up your organization, leave policies, and working calendar.</p></div><div class="page-actions"><span class="pill">' +
      H.icon('shield', 16) +
      ' HR administrator</span></div></div><div class="settings-layout"><nav class="settings-nav" aria-label="HR settings">' +
      settingTabs
        .map(
          (tab) =>
            '<button class="settings-link' +
            (current === tab[0] ? ' active' : '') +
            '" data-setting-tab="' +
            tab[0] +
            '">' +
            H.icon(tab[2]) +
            '<span>' +
            tab[1] +
            '</span></button>',
        )
        .join('') +
      '</nav><div id="settings-panel">' +
      (
        {
          organization: organizationSettings,
          departments: departmentSettings,
          'leave-policy': leaveSettings,
          'work-calendar': calendarSettings,
          access: accessSettings,
        }[current] || organizationSettings
      )() +
      '</div></div>'
    );
  };
  H.afterRender.settings = function () {
    $$('[data-setting-tab]').forEach((button) =>
      button.addEventListener('click', () => {
        H.ui.settingsTab = button.dataset.settingTab;
        H.render();
      }),
    );
    const current = H.ui.settingsTab || 'organization';
    (
      ({
        organization: bindOrganization,
        departments: bindDepartments,
        'leave-policy': bindLeaveSettings,
        'work-calendar': bindCalendar,
        access: bindAccess,
      })[current] || bindOrganization
    )();
  };
  function organizationSettings() {
    const settings = H.state.settings;
    return (
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Organization details</h2><p class="card-subtitle">Shown in employee records, reports, and payslips.</p></div>' +
      H.icon('building', 22) +
      '</div><div class="card-body"><form id="organization-form"><div class="form-grid">' +
      field(
        'Company name',
        '<input name="company" maxlength="100" required value="' + esc(settings.company) + '">',
      ) +
      field(
        'HR contact email',
        '<input name="email" type="email" maxlength="120" required value="' + esc(settings.email) + '">',
      ) +
      field(
        'Office location',
        '<input name="location" maxlength="120" required value="' + esc(settings.location) + '">',
      ) +
      field(
        'Currency',
        '<input value="Indian rupee (INR)" readonly aria-readonly="true">',
        'Salary records use INR.',
      ) +
      '</div><div style="display:flex;justify-content:flex-end;margin-top:24px"><button class="btn btn-primary" type="submit">Save changes</button></div></form></div></section>'
    );
  }
  function bindOrganization() {
    $('#organization-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const company = String(data.get('company')).trim(),
        location = String(data.get('location')).trim(),
        email = String(data.get('email')).trim();
      if (!company || !location || !email) {
        H.toast('Complete all organization fields.', 'error');
        return;
      }
      Object.assign(H.state.settings, { company, location, email });
      persist('Updated organization details.');
    });
  }
  function departmentSettings() {
    const departments = H.state.settings.departments;
    const designations = H.state.settings.designations || [];
    return (
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Departments</h2><p class="card-subtitle">Keep employee teams consistent across HR.</p></div><button class="btn btn-primary btn-sm" id="department-add">' +
      H.icon('plus', 16) +
      'Add department</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Department</th><th>Active employees</th><th>Actions</th></tr></thead><tbody>' +
      departments
        .map((name, index) => {
          const count = H.activeEmployees().filter((employee) => employee.department === name).length;
          const used = H.state.employees.some((employee) => employee.department === name);
          return (
            '<tr><td><span class="cell-primary">' +
            esc(name) +
            '</span></td><td>' +
            count +
            ' employees</td><td><div class="row-actions"><button class="icon-btn" data-department-edit="' +
            index +
            '" aria-label="Rename ' +
            esc(name) +
            '">' +
            H.icon('edit', 17) +
            '</button>' +
            (!used
              ? '<button class="icon-btn" data-department-remove="' +
                index +
                '" aria-label="Remove ' +
                esc(name) +
                '">' +
                H.icon('trash', 17) +
                '</button>'
              : '') +
            '</div></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></section><section class="card" style="margin-top:20px"><div class="card-header"><div><h2 class="card-title">Designations</h2><p class="card-subtitle">Job titles available when adding employees.</p></div><button class="btn btn-secondary btn-sm" id="designation-add">' +
      H.icon('plus', 16) +
      'Add designation</button></div><div class="card-body"><div class="inline" style="gap:10px;flex-wrap:wrap">' +
      designations.map((name) => '<span class="pill">' + esc(name) + '</span>').join('') +
      (!designations.length ? '<span class="muted">No designations configured yet.</span>' : '') +
      '</div></div></section>'
    );
  }
  function bindDepartments() {
    $('#department-add').addEventListener('click', () => departmentEditor());
    $$('[data-department-edit]').forEach((button) =>
      button.addEventListener('click', () => departmentEditor(Number(button.dataset.departmentEdit))),
    );
    $$('[data-department-remove]').forEach((button) =>
      button.addEventListener('click', () => {
        const index = Number(button.dataset.departmentRemove),
          name = H.state.settings.departments[index];
        H.confirm({
          title: 'Remove department?',
          body: '<p>' + esc(name) + ' has no employee records. Remove it from the department list?</p>',
          confirmLabel: 'Remove department',
          danger: true,
          onConfirm: () => {
            H.state.settings.departments.splice(index, 1);
            persist('Removed department ' + name + '.');
          },
        });
      }),
    );
    $('#designation-add').addEventListener('click', () => {
      H.openModal({
        title: 'Add designation',
        body:
          '<form id="designation-form">' +
          field(
            'Designation name',
            '<input name="name" maxlength="80" required placeholder="e.g. Operations Executive">',
          ) +
          '<p id="designation-error" class="text-danger" role="alert" hidden></p></form>',
        footer:
          cancelButton +
          '<button type="submit" class="btn btn-primary" form="designation-form">Add designation</button>',
        onMount: () => {
          $('#designation-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const name = event.target.elements.name.value.trim();
            const values = H.state.settings.designations || (H.state.settings.designations = []);
            if (!name || values.some((value) => value.toLowerCase() === name.toLowerCase())) {
              $('#designation-error').textContent = 'Enter a unique designation name.';
              $('#designation-error').hidden = false;
              return;
            }
            values.push(name);
            persist('Added designation ' + name + '.');
          });
        },
      });
    });
  }
  function departmentEditor(index) {
    const oldName = Number.isInteger(index) ? H.state.settings.departments[index] : '';
    H.openModal({
      title: oldName ? 'Rename department' : 'Add department',
      subtitle: oldName
        ? 'Employee records will use the updated name.'
        : 'Create a team for employee organization.',
      body:
        '<form id="department-form">' +
        field(
          'Department name',
          '<input name="name" maxlength="80" required value="' +
            esc(oldName) +
            '" placeholder="e.g. Customer Success">',
        ) +
        '<p id="department-error" class="text-danger" role="alert" hidden></p></form>',
      footer:
        cancelButton +
        '<button type="submit" form="department-form" class="btn btn-primary">' +
        (oldName ? 'Save changes' : 'Add department') +
        '</button>',
      onMount: () => {
        $('#department-form').addEventListener('submit', (event) => {
          event.preventDefault();
          const name = event.target.elements.name.value.trim();
          const exists = H.state.settings.departments.some(
            (value, i) => i !== index && value.toLowerCase() === name.toLowerCase(),
          );
          if (!name || exists) {
            $('#department-error').textContent = 'Enter a unique department name.';
            $('#department-error').hidden = false;
            return;
          }
          if (oldName) {
            H.state.settings.departments[index] = name;
            H.state.employees.forEach((employee) => {
              if (employee.department === oldName) employee.department = name;
            });
          } else H.state.settings.departments.push(name);
          persist((oldName ? 'Renamed department to ' : 'Added department ') + name + '.');
        });
      },
    });
  }
  function leaveSettings() {
    const types = H.state.settings.leaveTypes;
    return (
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Leave policy</h2><p class="card-subtitle">Default annual allocation for each employee.</p></div><button class="btn btn-primary btn-sm" id="leave-type-add">' +
      H.icon('plus', 16) +
      'Add leave type</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Leave type</th><th>Annual allocation</th><th>Approval</th><th>Actions</th></tr></thead><tbody>' +
      types
        .map(
          (type, index) =>
            '<tr><td><span class="cell-primary">' +
            esc(type.name) +
            '</span><div class="cell-secondary">' +
            (type.name === 'Unpaid leave' ? 'No paid leave entitlement' : 'Paid leave entitlement') +
            '</div></td><td>' +
            (type.name === 'Unpaid leave' ? 'Not limited' : type.days + ' days') +
            '</td><td><span class="muted">Manager or HR</span></td><td><button class="icon-btn" data-leave-policy="' +
            index +
            '" aria-label="Edit ' +
            esc(type.name) +
            '">' +
            H.icon('edit', 17) +
            '</button></td></tr>',
        )
        .join('') +
      '</tbody></table></div><div class="table-footer"><span class="muted">Approved leave reduces the available balance. Pending requests stay separate.</span></div></section><div class="notice notice-info">' +
      H.icon('info') +
      '<span>This base version uses one-step approval and a shared annual allocation per leave type.</span></div>'
    );
  }
  function bindLeaveSettings() {
    $('#leave-type-add').addEventListener('click', () => leavePolicyEditor());
    $$('[data-leave-policy]').forEach((button) =>
      button.addEventListener('click', () => leavePolicyEditor(Number(button.dataset.leavePolicy))),
    );
  }
  function leavePolicyEditor(index) {
    const old = Number.isInteger(index) ? H.state.settings.leaveTypes[index] : null;
    const isUnpaid = old && old.name === 'Unpaid leave';
    H.openModal({
      title: old ? 'Edit leave policy' : 'Add leave type',
      body:
        '<form id="leave-policy-form"><div class="form-grid">' +
        field(
          'Leave type',
          '<input name="name" required maxlength="60" value="' +
            esc(old ? old.name : '') +
            '"' +
            (isUnpaid ? ' readonly' : '') +
            '>',
        ) +
        field(
          'Annual allocation (days)',
          '<input name="days" type="number" min="0" max="366" step="0.5" required value="' +
            (old ? old.days : 5) +
            '"' +
            (isUnpaid ? ' readonly' : '') +
            '>',
          isUnpaid ? 'Unpaid leave has no paid balance.' : 'Applies to all employees in this HR workspace.',
        ) +
        '</div><p class="text-danger" role="alert" id="policy-error" hidden></p></form>',
      footer:
        cancelButton +
        '<button type="submit" form="leave-policy-form" class="btn btn-primary">Save policy</button>',
      onMount: () => {
        $('#leave-policy-form').addEventListener('submit', (event) => {
          event.preventDefault();
          const name = event.target.elements.name.value.trim();
          const days = Number(event.target.elements.days.value);
          const duplicate = H.state.settings.leaveTypes.some(
            (type, i) => i !== index && type.name.toLowerCase() === name.toLowerCase(),
          );
          let error = '';
          if (!name || duplicate) error = 'Enter a unique leave type name.';
          else if (!Number.isFinite(days) || days < 0 || days > 366)
            error = 'Enter an allocation between 0 and 366 days.';
          else if (!isUnpaid && name.toLowerCase() === 'unpaid leave')
            error = 'Use the existing Unpaid leave policy.';
          else if (old && !isUnpaid) {
            const usedByEmployee = {};
            H.state.leaves
              .filter(
                (leave) =>
                  leave.type === old.name &&
                  leave.status === 'Approved' &&
                  leave.from.slice(0, 4) === H.today.slice(0, 4),
              )
              .forEach(
                (leave) =>
                  (usedByEmployee[leave.employeeId] =
                    (usedByEmployee[leave.employeeId] || 0) + Number(leave.days)),
              );
            if (Object.values(usedByEmployee).some((used) => used > days))
              error = 'This allocation is lower than approved leave already used by an employee.';
          }
          if (error) {
            $('#policy-error').textContent = error;
            $('#policy-error').hidden = false;
            return;
          }
          if (old) {
            const previous = old.name;
            old.name = name;
            old.days = isUnpaid ? 0 : days;
            H.state.leaves.forEach((leave) => {
              if (leave.type === previous) leave.type = name;
            });
          } else H.state.settings.leaveTypes.push({ name, days });
          persist('Saved leave policy for ' + name + '.');
        });
      },
    });
  }
  function calendarSettings() {
    const settings = H.state.settings;
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const ordered = [1, 2, 3, 4, 5, 6, 0];
    return (
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Working week</h2><p class="card-subtitle">Weekly days off are excluded from leave-day calculations.</p></div></div><div class="card-body"><form id="workweek-form"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:12px">' +
      ordered
        .map(
          (day) =>
            '<label class="inline" style="gap:10px;border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:14px 12px"><input type="checkbox" name="day" value="' +
            day +
            '"' +
            (settings.workdays.includes(day) ? ' checked' : '') +
            '><span>' +
            names[day] +
            '</span></label>',
        )
        .join('') +
      '</div><div style="display:flex;justify-content:flex-end;margin-top:22px"><button class="btn btn-primary" type="submit">Save working week</button></div></form></div></section><section class="card" style="margin-top:20px"><div class="card-header"><div><h2 class="card-title">Holiday calendar</h2><p class="card-subtitle">Organization-wide holidays for attendance and leave.</p></div><button class="btn btn-secondary btn-sm" id="holiday-add">' +
      H.icon('plus', 16) +
      'Add holiday</button></div>' +
      (settings.holidays.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Holiday</th><th>Date</th><th>Actions</th></tr></thead><tbody>' +
          [...settings.holidays]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(
              (holiday) =>
                '<tr><td><span class="cell-primary">' +
                esc(holiday.name) +
                '</span></td><td>' +
                H.date(holiday.date) +
                '</td><td><button class="icon-btn" data-holiday-remove="' +
                esc(holiday.date) +
                '" aria-label="Remove ' +
                esc(holiday.name) +
                '">' +
                H.icon('trash', 17) +
                '</button></td></tr>',
            )
            .join('') +
          '</tbody></table></div>'
        : H.empty('No holidays configured', 'Add the dates your organization observes.')) +
      '</section>'
    );
  }
  function bindCalendar() {
    $('#workweek-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const days = $$('input[name="day"]:checked', event.target).map((input) => Number(input.value));
      if (!days.length) {
        H.toast('Choose at least one working day.', 'error');
        return;
      }
      const error = H.calendarChangeError({ workdays: days });
      if (error) {
        H.toast(error, 'error');
        return;
      }
      H.state.settings.workdays = days;
      persist('Updated the working week.');
    });
    $('#holiday-add').addEventListener('click', () => {
      H.openModal({
        title: 'Add holiday',
        body:
          '<form id="holiday-form"><div class="form-grid">' +
          field(
            'Holiday name',
            '<input name="name" maxlength="80" required placeholder="e.g. Company holiday">',
          ) +
          field(
            'Date',
            '<input name="date" type="date" min="2020-01-01" max="2100-12-31" required value="' +
              H.today +
              '">',
          ) +
          '</div><p id="holiday-error" role="alert" class="text-danger" hidden></p></form>',
        footer:
          cancelButton +
          '<button class="btn btn-primary" type="submit" form="holiday-form">Add holiday</button>',
        onMount: () => {
          $('#holiday-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const name = event.target.elements.name.value.trim(),
              date = event.target.elements.date.value;
            const holidays = [...H.state.settings.holidays, { name, date }];
            let error = '';
            if (!name || !date) error = 'Enter a holiday name and date.';
            else if (H.state.settings.holidays.some((holiday) => holiday.date === date))
              error = 'A holiday already exists on this date.';
            else error = H.calendarChangeError({ holidays });
            if (error) {
              $('#holiday-error').textContent = error;
              $('#holiday-error').hidden = false;
              return;
            }
            H.state.settings.holidays = holidays;
            persist('Added holiday ' + name + '.');
          });
        },
      });
    });
    $$('[data-holiday-remove]').forEach((button) =>
      button.addEventListener('click', () => {
        const date = button.dataset.holidayRemove,
          holiday = H.state.settings.holidays.find((item) => item.date === date);
        H.confirm({
          title: 'Remove holiday?',
          body: '<p>Remove ' + esc(holiday.name) + ' on ' + H.date(date) + ' from the working calendar?</p>',
          confirmLabel: 'Remove holiday',
          danger: true,
          onConfirm: () => {
            const holidays = H.state.settings.holidays.filter((item) => item.date !== date);
            const error = H.calendarChangeError({ holidays });
            if (error) {
              H.toast(error, 'error');
              return;
            }
            H.state.settings.holidays = holidays;
            persist('Removed holiday ' + holiday.name + '.');
          },
        });
      }),
    );
  }
  function accessSettings() {
    const rows = [
      ['Employee records', 'All employees', 'Team details', 'Own profile'],
      ['Attendance', 'Manage and correct', 'View team', 'View own'],
      ['Leave requests', 'Manage all', 'Approve team', 'Request own'],
      ['Salary & payslips', 'Restricted HR access', 'No default access', 'Own payslips'],
      ['Policies & settings', 'Manage', 'No access', 'No access'],
    ];
    const entries = [...H.state.audit].slice(0, 12);
    return (
      '<section class="card"><div class="card-header"><div><h2 class="card-title">Access roles</h2><p class="card-subtitle">Reference permissions for the three basic HR roles.</p></div>' +
      H.icon('shield', 22) +
      '</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Area</th><th>HR / Admin</th><th>Manager</th><th>Employee</th></tr></thead><tbody>' +
      rows
        .map(
          (row) =>
            '<tr>' +
            row
              .map((cell, index) => '<td' + (!index ? ' class="cell-primary"' : '') + '>' + cell + '</td>')
              .join('') +
            '</tr>',
        )
        .join('') +
      '</tbody></table></div><div class="card-body"><div class="notice notice-info" style="margin:0">' +
      H.icon('info') +
      '<span>This workspace is restricted to authorized HR administrators. Managers and employees use the ERP screens permitted by their roles.</span></div></div></section><section class="card" style="margin-top:20px"><div class="card-header"><div><h2 class="card-title">Recent activity</h2><p class="card-subtitle">Changes recorded in this HR workspace.</p></div><button class="btn btn-secondary btn-sm" id="audit-export">' +
      H.icon('download', 16) +
      'Export history</button></div><div class="card-body">' +
      (entries.length
        ? '<div class="stack">' +
          entries
            .map(
              (entry) =>
                '<div class="inline" style="gap:14px;padding:12px 0;border-bottom:1px solid var(--border,#e5e7eb)"><span style="color:var(--primary,#7c3aed)">' +
                H.icon('checkCircle', 18) +
                '</span><div><div class="cell-primary">' +
                esc(entry.message) +
                '</div><div class="cell-secondary">' +
                esc(
                  new Date(entry.time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
                ) +
                '</div></div></div>',
            )
            .join('') +
          '</div>'
        : H.empty(
            'No changes yet',
            'Changes to employees, attendance, leave, salary, and settings appear here.',
          )) +
      '</div></section>'
    );
  }
  function bindAccess() {
    $('#audit-export').addEventListener('click', () => {
      H.csv('hr-activity-history.csv', [
        ['Time', 'Change'],
        ...H.state.audit.map((entry) => [entry.time, entry.message]),
      ]);
      H.toast('Activity history exported.');
    });
  }
}
