# CRM lifecycle verification

The [capability review](market-review.md) maps the implementation specification to eight CRMs and records the native order-header discrepancy found during testing.

## Set up a follow-up rule

1. Sign in as the business owner and open **CRM → Workflows**.
2. Choose **Use template: Contact the new lead** or **Use template: Follow up on the proposal**. Review the trigger, task title and number of days until it is due. Choose **Enabled** and select **Save rule**.
3. Create a lead or move a deal into the chosen stage. Open **Recent tasks created by rules** to see who owns the task and when it is due. The salesperson can open it from **CRM → Activities**.
4. Open a task to see its due time and ERP inbox reminder status. Scheduled delivery requires the native Moqui job runner to be enabled and the CRM seed data to be loaded.
5. To stop future tasks, edit the rule, choose **Paused**, and save it. Existing tasks keep their status and due date.

New-lead rules cover manual capture and imports that go through the lead service. A manually entered first follow-up takes priority. A stage rule creates one task per opportunity and stage even if the deal later returns to that stage.

## Run the local checks

Use the repository's disposable Moqui runtime, PostgreSQL staging configuration, and [all-modules QA fixture](../all-modules/fixture.xml). The HTTP tests use synthetic tenants and create business records. The QA screen belongs exclusively in the loopback test runtime. It requires the `sales.qa.disposable` JVM property. Refresh the CRM entity schema and seed data before running the tests, including the cancellation transition and assignment notification topic. Initialize the fixture through its existing QA screen. Set `CRM_QA_PASSWORD` to the disposable fixture password.

| Scenario | Check |
| --- | --- |
| Owner templates, rule timing, private seller assignment, manual override, retries, pause, tenant scope and manual SMS logging | `CRM_QA_DB_CONTAINER=<disposable-postgres-container> python3 docs/qa/crm-lifecycle/check-owner-automation.py` |
| Filtered CSV/XLSX exports, default group access, explicit custom grants and tenant scope | `python3 docs/qa/crm-lifecycle/check-exports.py <disposable-postgres-container>` |
| Native ERP inbox delivery, preferences, repeat runs and rescheduling | `python3 docs/qa/crm-lifecycle/check-reminders.py <disposable-postgres-container>` |
| Dashboard links and their underlying records by period and user time zone | `python3 docs/qa/crm-lifecycle/check-drilldowns.py <disposable-postgres-container>` |
| Existing people linked to accounts, primary-contact updates, preferred channel and repeat saves | `python3 docs/qa/all-modules/verify-crm-account-contacts.py` |
| Task handoff, recipient queue, reschedule and cancellation reason, blocked terminal transitions and history | `CRM_QA_PORT=18919 python3 docs/qa/crm-lifecycle/check-follow-ups.py` |
| Stage transitions, native quote creation, concurrent retry, revision, line pricing, GST, order, invoice and settlement | `python3 docs/qa/crm-lifecycle/check-opportunity.py http://127.0.0.1:18919 <disposable-postgres-container>` |
| Forecasting and workload calculations across currencies, stages and time zones | Run `groovy docs/qa/crm-lifecycle/check-reports.groovy component/zenith-erp-crm/screen/zenith/crm/Crm/Reports.xml` with the runtime's Groovy version. |
| Lead qualification and conversion, ERP customer reuse and assignments | The existing [workflow suite](../all-modules/verify-workflows.cjs) includes the CRM regression cases. |
| Rendering, pipeline interaction, CSV import and retries | The repository's [staging browser smoke](../../infra/ci/smoke.mjs) runs on pull requests. |

## Verification on the disposable tenant

- A lead with a matching customer required an explicit selection. Concurrent conversion requests returned the same customer and opportunity IDs.
- Follow-up reassignment changed the recipient's queue. Cancelling required a reason, preserved the audit history and prevented subsequent completion or rescheduling.
- A customer-linked support case retained the active organization, customer, priority and response and resolution deadlines after saving.
- A quotation revision retained its opportunity. Tests reconciled the native quotation and order lines to the resulting invoice for a tax-free product and a product with configured GST. See the [amounts observed on the order header](market-review.md#erp-quotation-verification).
- Browser checks opened Dashboard, Leads, Pipeline, Activities, Reports and Customer detail on both `/apps` and `/qapps` at 390 and 1440 pixels. They checked visible content and horizontal overflow within the CRM page.
