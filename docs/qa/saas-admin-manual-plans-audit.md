# SaaS Admin dated manual plans — audit and verification

Date: 2026-10-08. Scope: platform-admin tenant plan assignments while online payments are disabled. Tenant-to-customer recurring billing is outside this change.

## Confirmed defects

| ID / severity | File / control | Current behavior and reproduction | Cause | Correction |
|---|---|---|---|---|
| SA-MAN-01 / high | `SaasServices.xml`, `TenantDetail.xml` — Change Plan | Live read-only inspection confirmed only tenant, plan and billing-cycle controls. In a disposable tenant, changing the plan succeeded but left the tenant suspended. | Billed plan replacement updates plan/subscription, without defining or restoring a dated manual entitlement. | Separate ADMIN-only Assign Manual Plan service and Tenant Plans screen; required end date, active account, authoritative manual subscription. |
| SA-MAN-02 / high | `SaasLifecycleServices.xml` — trial/overdue/renewal jobs | Reactivating the synthetic account followed by the overdue job suspended it again. A stale trial also competes with a replacement subscription. | Existing jobs treat all accounts as automatic billing accounts. | Manual config pointer controls dated access. Retire predecessors; skip automatic invoice suspension/renewal/reminders; expire after the inclusive end date. Trial helper rechecks the locked persisted subscription instead of trusting stale arguments. |
| SA-MAN-03 / high | `ZenithApp.xml` — account render gate | An active account can otherwise remain accessible between its selected end date and the next scheduled check. | Active status alone does not establish whether a manual date has ended. | Read-only gate checks matching tenant/subscription, active status and end date before rendering. Missing or invalid manual grant fails closed. |
| SA-MAN-04 / medium | `TenantDashboard.xml`, legacy services/admin subscription actions | Self change/cancel, trial extension, billing actions and payment reactivation can compete with a manual grant. | No distinction between admin-granted access and billed subscriptions. | Clear dated notice; hide manual-account checkout/change/cancel controls; service guards reject conflicting actions. Existing invoices remain outstanding. A payment callback cannot revive expired manual access. |
| SA-MAN-05 / medium | `SaasAdminServices.xml` — target plan limits | Legacy usage collector counts users with `partyId=orgId`, missing tenant-group members and organization relationships. | Membership model differs from the legacy direct party query. | Manual assignment additionally counts deduplicated enabled, date-valid tenant/org members and admin. Reject an assignment below usage limits. |
| SA-MAN-06 / medium | `saas-admin.css`, `saas-admin-ui.js` — header/layout | Native test environment supplied a dark header. At tablet width, classic header container grew while its fixed height remained 51px, placing controls over tabs. | Environment theme and shell height do not follow responsive toolbar reflow. | Page-scoped white light-mode header; classic header reserves its full height; Quasar header offset is measured. Cards stack; only the table scrolls horizontally. Preserve search, Owner View, utilities, sidebar and footer. |

## Operator workflow

SaaS Admin → **Tenant Plans** → select tenant → Review Tenant → choose active plan → set **Access end date (inclusive)** → enter reason → Assign Manual Plan.

- New assignment begins today and immediately changes the plan. Trial/suspended accounts become active; cancelled accounts require review and are rejected.
- Extending the same active plan retains subscription ID and original start date. Repeating the identical active assignment is a no-op.
- Show tenant/organization, account, current plan, included modules, limits, start/end dates, calendar access days and remaining days. Calendar days describe entitlement duration, not measured login usage; counting stops at the end date.
- End date includes its entire calendar day. Next-day module access is blocked even before cron; the existing daily expiry job then records the expired/suspended state.
- No invoice, payment, receipt or automatic renewal is created. Old unpaid invoices are neither settled nor cancelled. Tenant plan limits still apply.
- ADMIN is the platform-wide boundary; ordinary tenant admins cannot list or assign other tenants. This is an opt-in management mode using existing `SaasTenantConfig`, with no schema migration.

## Verification

Live inspection was read-only, using the authorized super admin. No live tenant plan, password, invoice, payment or security configuration was changed. Live customer data and screenshots are not published.

Disposable runtime: approved `zetaerp-moqui:clean-staging`, archive SHA256 `0305b2d2f7124781c41de04eb8aa8a7847ee5116ee01f09dc52d7f12dc513b93`; candidate components overlaid on a fresh PostgreSQL tmpfs. This is the approved clean staging image, not a claim of byte-identical production layers.

- **68/68** real Moqui service/HTTP/database checks passed: both surfaces, POST/CSRF, ADMIN/foreign-tenant denial, malformed/missing/past dates, inactive plans, cancelled tenants, required reason, usage limits, restoration, replay, extension, stale trials, scheduled jobs, last-day/next-day access and payment-callback protection.
- User account/credential fields unchanged after restoring the intentional synthetic enabled-seat toggle (timestamp excluded); financial ERP Invoice rows unchanged; unselected tenant/subscriptions unchanged.
- Browser `/qapps` native form changed synthetic tenant S to Enterprise through 15-Nov-2026; `/apps` extended it through 16-Nov-2026. Database: active, Manual, autoRenew N, amount 0, zero payments, existing invoice count unchanged at one.
- Browser tenant search returned one matching row; selecting its link showed that tenant's details. Both surfaces checked at 320, 375, 768 and 1440 pixels. Page cards remain contained, light header white; table overflow is internal. Screenshot artifacts contain public demo/synthetic data only.
- `source-parity.json` compares all 14 changed runtime component files to checked-out source. `services-summary.json` and `browser-summary.json` record the run; cleanup record confirms complete disposable stack removal.

## Boundaries and deploy gate

This change is separate from draft My Subscription PR #44's payment-provider work. It enables dated manual assignment without payment integration; it does not represent gateway acceptance testing. Existing common Vue key warnings/browser offline indicator are outside this page change; real server writes and database assertions verified the tested flows.

No POS, Sales, GST formula, invoice numbering or login credential code is changed. Automatic accounts with no manual config retain their existing management path. Tenant locking serializes assignment with trial expiry, overdue suspension, renewal, legacy plan change/cancellation/trial extension and payment reactivation. Concurrent invoice creation already in flight at a gateway is not represented as a new manual entitlement.

Owner must review billing/access changes and perform the MARUTHI deploy gate before deployment: confirm no unexpected manual config exists, inspect payload, verify existing account access and financial reports read-only, then verify both surfaces. No merge or production deploy was performed by this work.

Rollback: revert code through a reviewed PR. If manual grants have since been issued, reconcile those exact grants and their dates first; simply restoring automatic billing code must not unexpectedly suspend or bill them. Preserve issued invoices and audit history.
