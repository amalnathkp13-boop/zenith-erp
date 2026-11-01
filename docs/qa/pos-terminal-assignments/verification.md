# Receipt alignment and assigned billing terminals

Candidate based on master `d027844e`; verification used only synthetic POS_QA
records in the loopback Moqui runtime with an in-memory H2 database. No production
accounts, assignments, bills or hardware configuration were changed for this PR.

## Changes

- Shared receipt preview, checkout and reprint layout retains stable item, unit,
  rate and amount columns. Metadata values align next to their labels, wrap within
  the receipt and use the existing 58/80 mm widths and black-text defaults.
- QZ receives generated HTML with `flavor: 'plain'`, as documented in the
  [QZ HTML printing API](https://qz.io/docs/pixel). Without it, the installed
  QZ client can interpret receipt markup as a relative URL.
- POS → Terminals exposes administrator-only per-login assignments. The new
  `PosTerminalAssignment` table keys by organization and user. Assignments do not
  change the terminal's shop, seller, bill numbers or saved transactions.
- Non-admin billing users cannot choose an unassigned terminal, use another
  operator's session, or change terminal configuration. Session opening, cart
  access, receipt access and history use the shared assignment guard. No assignment
  or an inactive terminal fails closed. Admins retain access within their org.
- Assignment writes validate organization membership, active terminal/shop,
  request CSRF and admin access. Existing sessions must close before reassignment;
  session opening and assignment changes serialize on the user row.

## Actual results

- Before the fix, receipt column-position regression failed when product names
  changed, the access regression permitted an unassigned terminal, and the QZ
  routing regression found a missing HTML flavor. All pass after the fix.
- Receipt browser geometry: 58/80 mm, long/short product names, decimal quantities,
  revised receipts, header/row alignment and cell overflow: passed.
- Assignment workflow: 49 assertions passed, including real database persistence,
  both app surfaces, form transitions, rejected foreign requests, missing
  assignments, fixed terminal display, session/bill boundaries, payment/receipt
  completion, reassignment rules and CSRF.
- Existing focused history/shop regression: 60 assertions, zero failures.
- Catalog acceptance fixtures now open a cashier-owned session on an explicitly
  assigned counter and assert that an admin-owned session is rejected. Focused
  catalog acceptance (including bootstrap checks): 123 assertions, zero failures.
- Existing wrapped-tablet checkout: 162 assertions, zero failures.
- Receipt layout/options, 12 QZ routing cases, shared chrome and navigation guards:
  passed. The exact production access script also passed the standalone Groovy
  regression for assigned, missing, inactive and foreign terminals.
- Four repository lint guards, JavaScript syntax and modified XML parsing: passed.

## PR #170 staging follow-up

The cashier catalog fixture now uses an explicitly assigned terminal and a
cashier-owned session; the rejected admin-session assertion stays in place.
Existing billing logins must be assigned by an admin before the deployment
cutover described below. There is no permissive fallback for an unassigned login.

The subsequent [staging run](https://github.com/amalnathkp13-boop/zenith-erp/actions/runs/41321874720)
failed at the history editor's five-second product-visibility assertion. The API
catalog and scope assertions passed. A controlled six-second delay reproduced
that failure locally (80 checks, one failure). The revised test waits at most
20 seconds for the exact search response, validates its HTTP status, expected
product, result bound and tenant scope, then retains a five-second DOM-render
deadline. Missing, unauthorized or unrendered products still fail the test.

The regression deliberately delays the real Water Cup request by six seconds;
it does not replace the server response with mock product data. Focused acceptance
passed all 84 checks, including adding Water Cup and Tea Cup to the draft and
proving cancellation leaves the issued bill, tender rows and totals unchanged.
The measured Water Cup response was HTTP 200 in 6.4 seconds. All four lint guards
and the modified test's JavaScript syntax check passed. This follow-up changes
the acceptance tests and documentation only.

The wider local run completed 1,645 assertions and 100 viewport cases before
stopping in the free-item fixture: it also submitted cashier requests against an
admin-owned session, receiving the expected access denial before the free-item
policy could run. That fixture now creates a separate terminal, assigns it through
the real admin service, opens it as the cashier, and builds cashier-owned carts.
Its payment rejection asserts the manager-approval error specifically. Cleanup
voids remaining unpaid drafts, closes the session, then restores the cashier's
assignment so subsequent history tests can safely reassign it. The existing
manager, PIN, foreign-tenant, approval-audit and payment assertions remain intact.
`POS_QA_FOCUS=terminal-workflows` runs this fixture and the remaining cashier,
history-scope, rate-sync, receipt-design and hold-print groups together.
That focused continuation passed all 339 assertions with no failures.

Synthetic previews are in `evidence/`. Browser/QZ stubs do not certify physical
printer margins or installed driver paper settings. A physical receipt check
remains necessary after deployment. CI status is recorded separately on the PR.

## Deployment handoff

Only the maintainer deploys. Close existing billing sessions first, deploy the
complete component changes and restart Moqui to load the new entity/EECA. Sign in
as an administrator and assign each billing login under POS → Terminals before
resuming billing. Existing assignments are never inferred from the most recent
counter or from a browser preference. Unassigned billing users see a clear message
to contact their admin. No automatic production data backfill is included.

Local verification runtime is stopped after testing; its in-memory records are
destroyed, and an IFEXISTS database reconnection is used to verify teardown.
