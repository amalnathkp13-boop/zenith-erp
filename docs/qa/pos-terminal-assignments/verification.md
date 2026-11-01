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
- Existing wrapped-tablet checkout: 162 assertions, zero failures.
- Receipt layout/options, 12 QZ routing cases, shared chrome and navigation guards:
  passed. The exact production access script also passed the standalone Groovy
  regression for assigned, missing, inactive and foreign terminals.
- Four repository lint guards, JavaScript syntax and modified XML parsing: passed.

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
