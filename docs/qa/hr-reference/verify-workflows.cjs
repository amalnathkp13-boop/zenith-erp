'use strict';

// Run against a disposable localhost tenant with HR_QA_USER and HR_QA_PASSWORD set.
const assert = require('node:assert/strict');
const { request } = require('playwright');

(async () => {
  const origin = new URL(process.env.HR_QA_ORIGIN || 'http://127.0.0.1:18162');
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname),
    'Requires a disposable localhost instance',
  );
  const user = process.env.HR_QA_USER,
    password = process.env.HR_QA_PASSWORD;
  assert(user && password, 'Provide credentials for the disposable tenant');
  const client = await request.newContext();
  const route = origin.origin + '/apps/zenith/Hr/Dashboard/';
  try {
    const auth = await client.get(route + 'readWorkspace', {
      headers: { Authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64') },
    });
    const token = auth.headers().moquisessiontoken;
    assert(token);
    let result = await auth.json();
    assert.equal(result.success, true);
    const read = async () => (await client.get(route + 'readWorkspace')).json();
    const send = async (payload, revision = result.revision) => {
      const response = await client.post(route + 'saveWorkspace', {
        headers: { moquiSessionToken: token },
        data: {
          moquiSessionToken: token,
          revision,
          workspace: JSON.stringify(payload),
          message: 'Verified a workspace change.',
        },
      });
      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch {
        throw Error(
          'Unexpected HR response, HTTP ' +
            response.status() +
            ': ' +
            body
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .slice(0, 300),
        );
      }
    };
    const edit = async (label, fn) => {
      const data = structuredClone(result.state);
      fn(data);
      result = await send(data);
      assert.equal(
        result.success,
        true,
        label +
          ': ' +
          JSON.stringify({ error: result.error, errors: result.errors, message: result.message }),
      );
      console.log('PASS', label);
    };
    const deny = async (label, fn) => {
      const data = structuredClone(result.state);
      fn(data);
      const rejection = await send(data);
      assert.equal(rejection.success, false, label);
      assert(rejection.error, label);
      assert.equal((await read()).revision, result.revision, label + ' changed persisted records');
      console.log('PASS', label);
    };

    const startRevision = result.revision;
    const id = 'QA-' + Date.now(),
      today = result.today,
      month = today.slice(0, 7);
    const newDate = (str) => new Date(str + 'T12:00:00Z');
    const workingDate = (direction) => {
      const date = newDate(today);
      do {
        date.setUTCDate(date.getUTCDate() + direction);
      } while (
        !result.state.settings.workdays.includes(date.getUTCDay()) ||
        result.state.settings.holidays.some((h) => h.date === date.toISOString().slice(0, 10))
      );
      return date.toISOString().slice(0, 10);
    };
    const shiftDay = workingDate(-1),
      leaveDay = workingDate(1);
    await edit('settings survive a second read', (s) => {
      if (!s.settings.departments.includes('Operations')) s.settings.departments.push('Operations');
      s.settings.location = 'QA campus ' + id;
    });
    assert.equal((await read()).state.settings.location, 'QA campus ' + id);
    assert.equal((await send(result.state, startRevision)).conflict, true);
    console.log('PASS stale browser save preserves newer settings');
    const group = 'HR QA group ' + id;
    await edit('add department', (s) => s.settings.departments.push(group));
    await edit('archive unused department', (s) => {
      s.settings.departments = s.settings.departments.filter((d) => d !== group);
    });
    await edit('reactivate department', (s) => s.settings.departments.push(group));
    await edit('create a directory employee and document metadata', (s) =>
      s.employees.push({
        id,
        name: 'QA Employee ' + id,
        email: id.toLowerCase() + '@example.test',
        phone: '',
        emergency: '',
        department: 'Operations',
        joined: '2020-01-01',
        leavingDate: '',
        designation: 'Analyst',
        manager: '',
        status: 'Active',
        type: 'Full-time',
        salaryType: 'daily',
        salary: 500,
        color: 'purple',
        documents: [{ name: 'QA joining note.txt', size: 42, added: today }],
      }),
    );
    await edit('link manager by stable employee code', (s) =>
      s.employees.push({
        ...s.employees.find((e) => e.id === id),
        id: id + '-M',
        name: 'Team member ' + id,
        email: id.toLowerCase() + '-m@example.test',
        manager: id,
        documents: [],
      }),
    );
    assert.equal(result.state.employees.find((e) => e.id === id + '-M').manager, id);
    await edit('name change preserves reporting relationship', (s) => {
      s.employees.find((e) => e.id === id).name = 'QA Manager ' + id;
    });
    assert.equal(result.state.employees.find((e) => e.id === id + '-M').manager, id);
    await edit('save a daily attendance entry', (s) =>
      s.attendance.push({
        id: 'new-shift',
        employeeId: id,
        date: shiftDay,
        status: 'Present',
        checkIn: '09:00',
        checkOut: '17:00',
        note: 'Local register',
      }),
    );
    await deny('invalid check-out is rejected atomically', (s) => {
      s.attendance.find((r) => r.employeeId === id).checkOut = '08:00';
    });
    await edit('create a leave request', (s) =>
      s.leaves.push({
        id: 'new-leave',
        employeeId: id,
        type: 'Casual leave',
        from: leaveDay,
        to: leaveDay,
        days: 1,
        reason: 'Local verification',
        status: 'Pending',
        applied: today,
        halfDay: false,
      }),
    );
    await edit('approve the request', (s) => {
      s.leaves.find((r) => r.employeeId === id).status = 'Approved';
    });
    await edit('prepare per-day salary', (s) =>
      s.salaries.push({
        id: 'new-salary',
        employeeId: id,
        month,
        salaryType: 'daily',
        dailyRate: 500,
        paidDays: null,
        basic: 0,
        allowance: 0,
        deduction: 0,
        status: 'Draft',
        paid: false,
      }),
    );
    await edit('finalize salary with reviewed paid days', (s) =>
      Object.assign(
        s.salaries.find((r) => r.employeeId === id),
        {
          paidDays: 1.5,
          basic: 750,
          status: 'Finalized',
        },
      ),
    );
    await deny('finalized earnings are immutable', (s) => {
      s.salaries.find((r) => r.employeeId === id).basic = 800;
    });
    await edit('record final salary as paid', (s) => {
      s.salaries.find((r) => r.employeeId === id).paid = true;
    });
    await deny('paid salary cannot be reset', (s) => {
      s.salaries.find((r) => r.employeeId === id).paid = false;
    });
    await deny('client cannot discard other employees', (s) => {
      s.employees = s.employees.filter((e) => e.id !== id);
    });
    const fresh = await read();
    assert.equal(fresh.revision, result.revision);
    assert(fresh.state.salaries.find((s) => s.employeeId === id && s.paid));
    assert(fresh.state.audit.length && fresh.state.audit[0].userId);
    console.log('PASS payments, audit and server revision survive reload');
    if (process.env.HR_QA_RESTRICTED_USER) {
      const other = await request.newContext();
      try {
        const attempted = await other.get(route + 'readWorkspace', {
          headers: {
            Authorization:
              'Basic ' + Buffer.from(process.env.HR_QA_RESTRICTED_USER + ':' + password).toString('base64'),
          },
        });
        assert.equal((await attempted.json()).success, false, 'limited account received management access');
        console.log('PASS restricted user cannot read full HR records');
      } finally {
        await other.dispose();
      }
    }
    if (process.env.HR_QA_OTHER_ORG_USER) {
      const other = await request.newContext();
      try {
        const attempted = await other.get(route + 'readWorkspace?organizationPartyId=POS_QA_A', {
          headers: {
            Authorization:
              'Basic ' + Buffer.from(process.env.HR_QA_OTHER_ORG_USER + ':' + password).toString('base64'),
          },
        });
        const otherWorkspace = await attempted.json();
        assert.equal(otherWorkspace.success, true);
        assert(!otherWorkspace.state.employees.some((e) => e.id === id));
        assert.notEqual(otherWorkspace.revision, result.revision);
        console.log('PASS organization comes from authenticated membership');
      } finally {
        await other.dispose();
      }
    }
    console.log('Disposable HR fixture employee', id);
  } finally {
    await client.dispose();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
