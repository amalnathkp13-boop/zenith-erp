# POS reference UI and working controls

Scope: remaining POS presentation gaps and dead controls. This separate UI follow-up is stacked on the reviewed billing PR #27, whose master baseline is `8054b6af4389cb564ac5db16045193a0093417db`. Maintainer merges and deploys separately.

## Reproduction and corrections

| Area | Reproduction / root cause | Correction |
| --- | --- | --- |
| Cash Entry, Quasar | Enter a decimal amount: the native `number` input has no step, so browser validation rejects decimals before any POST. Live read-only reproduction confirmed `stepMismatch=true`; no live submit. | Use the framework's normal text-line amount input in the two cash forms. Existing BigDecimal parsing, positive-amount checks, transitions and services remain intact. |
| Cash Entry labels | Shared Quasar label-left styling reserves 152px inside narrow columns; labels/input content collide. | Label-above CSS scoped to the three cash forms; responsive native filter grid and right-aligned header actions. |
| Table status filter | Live: select List View, then Occupied (0); all three available rows remain visible. The handler filters only floor cards. | Give list rows status metadata and filter both views. Clear selected-table actions on filter changes; native Delete disabled until selection. |
| Table controls | Filter/Duplicate/Rotate/Undo/Save Layout and several order actions call `tmSoon`; the top-level calls do not even have a feedback target. Print Bill navigates to all transactions; Add Items has no selected-table binding. | Remove unsupported button markup and its stub handler. Retain real table CRUD/status actions. Label existing navigation Open Billing / View Transactions. Manage Tables and Done accurately describe immediate persistence. This does not implement unsupported floor-layout editing, splitting bills or table transfer. |
| Dashboard | Large filled heading differs from supplied compact reference. In the Bootstrap runtime the custom-date popup is covered by later KPI cards because its card lacks a positioned stacking level. | Compact neutral heading/date row; position the date card above KPI cards. Preserve the native date GET form and existing popup stacking value. |
| Quick help | Thirteen top-level POS pages and the Kitchen container expand a large blue help panel by default. | Retain all help content in a compact keyboard-operable disclosure, initially collapsed. |
| Shared topbar, all ERP modules | Live scroll-down puts the fixed Quasar header above the viewport (`q-header--hidden` translates it upwards) while module tabs remain fixed. | Extend the existing Contacts stay-visible header rule to the shared Quasar ERP shell. Keep the Bootstrap #top bar sticky in the sidebar shell, let the body grow with its content so the sticky boundary lasts through a full scroll, and retain header stacking below navigation overlays. Exclude the focused billing-terminal layout. Bump the shared theme version on both surfaces. |

## Reference and scope review

Reference source: the owner's shared Drive `UI_New_Claudecode_Playwright` reports and fixed UI images under the supplied folder. Inspected POS Dashboard, Transactions, Cash Entry, Terminals, Sales Mode, Receipts, Normal/Advanced Billing and Table Management images. Reference amounts, people, products and mock business values are not copied into the app or evidence.

Existing styled cards, lists, mode controls, receipt/printer/import/offline screens and the billing terminal retain their layouts. Five already-collapsed help panels (DiscountSettings, ProductImport, PrinterConfig, BillNumberRegister, OfflineMode) are untouched. This UI-only follow-up is now a separate PR stacked on the revised billing PR #27. No checkout, invoice, offline-storage, tax-destination, service, entity or schema change is introduced by its own diff. Review the billing base separately; do not deploy it before the owner gates pass.

## Verification

Historical evidence from the combined candidate is checked in under [evidence](evidence/summary.json): 487 functional assertions, 56 page renders and 100 responsive POS layouts; 319 reference-UI assertions and 84 layouts. The UI suite checks header scroll-down/return and mobile sidebar reachability in POS, Contacts, Sales and Purchase. Both named disposable runtimes were stopped, their HTTP/database listeners disappeared and SELECT probes using `IFEXISTS=TRUE` could no longer reconnect. The tested component digest is recorded so documentation-only commits do not obscure the verified application tree.

`checks.json` records independent native runtime assertions and responsive geometry; screenshots contain only public demo identity and synthetic disposable fixtures. `source-checks.json` proves the 15 UI-adjusted screens retain the actions/transitions/parameters and native forms of PR #27's functional baseline (the exact revised #27 head supplied through `POS_REFERENCE_BASE_REF`), except the two documented cash amount input types. It also compares all tracked component bytes with the tested runtime and records a normalized application digest. The separate `docs/qa/pos-runtime/verify-runtime.cjs` suite validates the intentional checkout, drawer, offline, service and access-guard changes already in PR #27. The UI follow-up introduces no service/entity/query or checkout-engine edits.

The native runtime uses a public rebuilt framework and fresh loopback memory H2, not a byte-identical production framework or production database. GitHub's trusted master `staging-acceptance` candidate run independently supplies the pinned clean Linux/PostgreSQL acceptance gate. Run links and conclusions are in the PR.

Test scope: both entry surfaces (Credit Bills intentionally redirects to `/apps`), 1440/768/390px layouts, native cash submit/search/reset/invalid amount checks, table floor/list filtering, real table creation/status/close/delete, keyboard help, custom date submission and pointer reachability. Independent SELECT-only H2 probes verify persisted cash/table results and compare count plus SHA-256 row digests of 12 billing/accounting/session tables before and after. No issued invoice/bill or payment/session changes are allowed. Live inspection uses read-only navigation and transient field checks only; no live business writes.

Teardown is mandatory: stop only this named memory runtime after verification, confirm both loopback listeners close and reconnect with `IFEXISTS=TRUE` fails. The database vanishes with its JVM; no fixture helpers enter production components. Do not use these helpers on a persistent, remote or live database.

## Reproduce the disposable suite

Shared-header scroll regressions also exercise POS, Contacts, Sales and Purchase at desktop/mobile widths on both entry surfaces.

1. Overlay the candidate's components and canonical framework patches in a fresh disposable native runtime configured for `127.0.0.1:18085` and memory H2 TCP `127.0.0.1:19097`, with `-Dpurchase.pricing.qa.disposable=true`.
2. Copy `fixture.xml` only into that runtime as `component/zenith-erp-pos/PosUiQaFixture.xml`, and `qa-screen.xml` as `component/zenith-erp-contacts/screen/zenith/contacts/Contacts/PosUiQa.xml`. The initializer lives outside the guarded POS parent so setup never requires weakening that guard. Restart the disposable JVM so screen definitions are fresh.
3. Set `POS_REFERENCE_BASE_URL=http://127.0.0.1:18085`, `POS_REFERENCE_DB_URL=jdbc:h2:tcp://127.0.0.1:19097/mem:purchase-pricing-qa;IFEXISTS=TRUE`, `POS_REFERENCE_OUTPUT` to a private local evidence directory, `POS_REFERENCE_JAVA`, `POS_REFERENCE_H2_JAR`, and disposable seed credentials via `POS_REFERENCE_USERNAME` / `POS_REFERENCE_PASSWORD`. Set `NODE_PATH` to Playwright; optionally `POS_REFERENCE_CHROME` to an installed Chrome executable.
4. Run `node docs/qa/pos-reference/verify-runtime.cjs`. The helper rejects repeat initialization, unexpected ports, non-loopback requests, missing disposable flag and non-administrators. The DB probe accepts one SELECT and only the named memory URL. Any failed assertion exits nonzero.
5. Perform teardown and archive only sanitized passing results. Scanners, printers, cash drawers and payment-provider transactions require owner hardware acceptance; this PR does not change those paths or claim hardware coverage.

Current review: the exact split candidate passed 319 native assertions, 84 responsive layouts and 15 screen execution comparisons; all 971 component files matched the runtime. Independent snapshots of 12 financial/session tables stayed unchanged. Both listeners closed and a fresh IFEXISTS reconnect failed. See review-reverification.json. GitHub acceptance is still pending because the account billing limit prevents jobs starting; billing-base owner gates remain open.

The latest-master rebase's exact source/report hashes, current billing parent and
component inventory supersede the historical counts in `review-reverification.json`.
Its own UI diff preserves the billing parent's Payment Wise timezone correction;
that intentional report behavior is verified and reviewed in #27. Required CI and
owner billing/device acceptance remain separate deployment gates.
