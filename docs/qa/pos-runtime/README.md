# Disposable POS regression verification

This suite runs only against a loopback, disposable runtime. Never install the QA
screen or fixtures on production. Live MARUTHI inspection is read-only and does
not establish that an un-deployed candidate is running there.

The two `POS_QA_*` organizations, products, prices and three users are synthetic
test fixtures. They have no legal registration numbers, real contact details,
provider credentials or production data. The bootstrap password is the public
Moqui demo password, copied from the disposable runtime's demo user. The screen
requires `-Dpos.qa.disposable=true`; its initializer requires platform ADMIN and
refuses to reinitialize an existing fixture. Only the three synthetic users can
invoke its fixed service/parameter allowlist. Do not expose this runtime publicly.

`staging-acceptance` selects this profile for POS PRs. It overlays the candidate
components on the checksum-pinned clean staging image, runs the existing four
billing goldens unchanged, then this suite. A dispatch can select `pos` with an
exact candidate SHA after the POS workflow is merged. Before merge, follow the
Production-Bug PR SOP: dispatch **master's** workflow with the exact candidate SHA
and `contacts_profile=none` (master does not yet offer `pos`). This independently
uses master's fixtures/asserts; the automatic PR run supplies the additional POS
suite. Record both run links. The fixture/helper paths exist only in the disposable runtime.

Native testing uses an in-memory H2 database with a loopback, SELECT-only probe.
CI uses the staging compose tmpfs PostgreSQL database. Evidence consists of
`report.json`, synthetic screenshots/PDFs, and a separate teardown proof after
the staging stack and its volumes are removed. No test report is a production
deployment claim. Never reuse a database containing customer records.

## Regressions covered

- Assert an opened session actually committed to its authorized org/terminal before
  creating a cart. Session creation no longer calls speculative pricing/tax
  calculations or clears their errors: a failed optional warmup could roll back
  the session while returning an id, after newer Tax input validation.
- Reject empty checkout/credit, nonpositive quantities, negative price/discount,
  invalid tenders, zero non-free tender and non-cash overpayment before writing.
  Permit a legitimate zero-payable item without manufacturing a payment row.
- Reconcile cash change, split payments, actual gift-card redemption, partial/full credit, drawer cash entries,
  float-in/out and bank deposits; safe-count is an observation. Late cash credit collections
  belong to the receiving drawer. Payment Wise page/CSV/PDF subtract change once
  and count distinct bills for each method, retaining the billing-date filter contract.
- Preserve recorded partial tenders and held carts at session boundaries.
- Preserve held sale identity, customer, manual price, line mode and tax toggle.
- Choose customer place-of-supply before the first line. Once lines or tenders exist,
  changing/clearing to a different destination is rejected without changing any rows.
  Same-destination changes preserve existing line taxes; choosing a customer never
  calls the tax refresh service. Assert normal new-line GST and invoice headers.
- Independent, idempotent offline imports, partial acknowledgements, rollback of
  invalid items/money, and preservation of the interactive cart. Browser checks retain
  unacknowledged queue entries after partial/legacy/failed responses, check GST cache
  and receipt markup, and preserve invalid-quantity lines. A differing
  historical offline total stays unacknowledged for review; no cash is invented.
- Concurrent completion numbers and synthetic-only amendment validation, linked
  invoice totals, tax detail and audit. No production issued bill is amended.
- Tenant service/detail/receipt denial, CSRF, cashier permissions, child report
  rendering, one search-add POST, active till layouts and both app shells. Normal
  and Advanced layouts retain cart access and contain wrapped headers at five widths.
  Desktop terminals keep the outer page fixed and scroll within the terminal if
  needed, while narrow layouts retain their scrolling fallback; the fullscreen icon uses SVG.
  AJAX cart add/remove updates the side Bill Summary, names remain literal text,
  and Advanced mobile checkout stacks the catalog/cart and wraps readable payment buttons.
- Tax-off item addition is checked in the active synthetic cart and terminal, whose
  operating region permits org authorization. The AJAX request omits customer and
  destination-state fields; the line is then removed so later checks use the original empty cart.

Render checks do not certify every business operation in a screen. Physical QZ
printers, scales, handheld scanners, external payment providers and Safari dark
mode need owner/device verification. Browser PDF output is not a hardware test.
The [coverage register](coverage.md) retains duplicate SOP ids with their titles;
unverified steps are not recorded as passes.

## Owner deployment handoff

Merge and deployment are separate. Only Amal deploys, following
[`SOP-commit-and-deploy.md`](../../SOP-commit-and-deploy.md). This candidate depends
on master `d9dca975d4f22a74470ae0a3b8bebe16fc57b1a3`, retaining the merged
Sales tax-inclusive invoice contract, Tax safeguards, Inventory styles and
Contacts/dashboard asset registrations. Deploy the reviewed,
complete component tree in one maintenance operation and restart Moqui so the new
POS access/services and their callers become available together. Do not copy a
child screen or JavaScript ahead of its service dependency.

One nullable column, `pos_payment.collection_session_id`, and its optional
session relationship are added. Before exposing the new services, the owner must
apply/verify this entity change using the repository's Moqui schema-update process
while POS is quiescent. Do not deploy service callers against an old schema.
Existing payment rows remain null and are interpreted as legacy original-session
tenders; no historical payments are rewritten or guessed into a new drawer.
Do not deploy `docs/qa/pos-runtime`.

**DEPLOY-GATE — billing, schema and authorization.** The owner must capture and
compare relevant MARUTHI state before/after the controlled no-op reverify required
by the [Production-Bug PR SOP](../../SOP-production-bug-PR.pdf), and record an
approved aggregate result or verification-run link. Website navigation and
synthetic tenant results do not substitute for this proof. No candidate writes
may be tested on a real tenant. Production database proof is still pending;
the author's workstation has website access but no configured SSH/database
connection. Do not mark this requirement passed from a green synthetic CI run.

Before deploying the offline change, preserve each till's pending legacy
`ZenithPosOffline` queue. The candidate now resolves each legacy record's original
terminal/session against the authenticated organization through a POST/CSRF-protected,
read-only endpoint. Only verified records are copied to the org-specific queue;
original amounts, tax flags and captured item values are not recalculated. The
original remains until the server acknowledges that exact verified offline id.
Foreign, unidentifiable, conflicting, changed or failed records remain on the device
with a visible owner-recovery notice. No legacy data is assigned to whoever logs in
next and there is no automatic assumption that an old collected total matches a new
billing total. Repeated recovery and sync must remain idempotent.

The current-master rebase and review fixes require fresh runtime/CI proof. Historical
reports and run links are not acceptance evidence for the revised head. #54 is not a
dependency; no SaaS billing protections are reverted here. Pure reference/topbar and
Tables control changes are being separated from this billing candidate.

Current-master verification is recorded in `review-reverification.json`. A fresh
run also checks Payment Wise's user-timezone report window against a runtime whose
JVM defaults to UTC: completed synthetic cash bills at 00:30 and 23:59:59.999 must
appear in that user's selected day on both CSV interfaces. The test restores the
captured original timestamp and independently asserts unchanged grand total, tax
and change. The screen, CSV and PDF use the same user-timezone parsing. This changes
report date buckets, not stored bill figures; owner financial acceptance remains
mandatory. Helpers remain under docs/qa and must never be installed on production.

The earlier author audit passed all 522 native checks (56 pages, 100 layouts); `review-reverification.json` identifies that exact tested application and framework. The product-search test waits for the rendered suggestion and response instead of an arbitrary delay. Required exact-image CI and owner financial/device acceptance remain pending.

The senior-review follow-up also corrected Cash Entry's read-only date window: displayed user-local dates were parsed in the JVM timezone, so a just-saved entry could disappear around midnight. Parse both boundaries in the user's timezone and use the next calendar day's midnight exclusively, including the last millisecond and daylight-saving day lengths. Both native interfaces verify search/reset against independently stored cash entries and include local midnight/final-millisecond entries while excluding the next day on a 25-hour DST day. `cash-entry-date-reverification.json` identifies the focused runtime run in child #59; its Cash Entry execution definitions match this parent. This does not relabel the historical full billing run as verification of the revised head. The date filter changes list/report buckets, with no change to stored entry amounts, write services or organization scoping.
