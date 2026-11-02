# Kitchen workflow and print verification

The existing Kitchen screens remain under POS. The global header, sidebar and
canvas are unchanged. KOT Dashboard, Kitchen Display, KOT Billing, Tables,
KOT History and Waiters retain their destinations and order. The Bootstrap KOT
tabs use the same current purple active-tab treatment as the Quasar renderer.

## Changes verified

- Kitchen Display uses real, organization-scoped status counts, notes, items and
  existing status actions. Counts remain global to the authorized active tickets
  when the list is filtered. Responsive checks cover 1440, 1024, 768 and 390 px.
- Loading starts before a Kitchen route changes, retains the existing global
  navigation, ignores obsolete component responses and exposes retry on failure.
  Direct entry waits for the current shell. Both server HTML and SPA entry work.
- Tables → Open Billing selects the exact table in KOT Billing. Tables are linked
  by ID, validated through their facility owner and marked occupied when sent.
  Drafts and printing do not occupy a table. Cancelling one of multiple active
  orders retains occupancy; cancelling the last releases it. Serving food does
  not imply payment. Closing/deleting an actively ordered table is rejected.
- Available table deletion passes the exact primary key after ownership checks.
  Missing/foreign/wildcard IDs cannot delete records. Add Table requires a facility
  in the UI and on the server, with an inline message before disabling Save.
- KOT Billing adds Print Bill alongside Draft and Print KOT. It uses canonical
  prices, the existing tax dispatcher, receipt options and shared receipt renderer.
  A mixed ₹100/18% + ₹200/5% order has ₹28 GST and ₹328 total, without creating
  transactions, payments, KOTs, stock or tax rows merely to quote/print.
- Active/Completed cards expose independent KOT Print and Bill Print actions.
  New ticket-only orders retain a server-calculated unpaid receipt snapshot, so
  later price changes cannot silently reprice that printout. Unsent/unpaid order
  output is explicitly labelled; it has no fabricated invoice number or payment.
- History preserves filters, summaries and CSV/XLSX export, with View, independent
  row prints, selection count and bulk actions. Bill Print requires a real linked,
  finalized transaction and uses its saved receipt. Missing linkage is reported;
  it never substitutes a KOT or manufactures a sale. Only checked rows print.
- Print windows blocked/closed or printing failures remain retryable without
  business writes. KOT counters advance only after a browser print request is
  accepted, and the acknowledged count updates in History. This is not proof
  that a physical printer produced paper or that a user did not cancel a dialog.

## Regressions and actual results

Before patching, the navigation browser harness failed five of six checks. The
live disposable table checks reproduced the wrong destination, missing facility
feedback, missing occupancy and available-table deletion failure.

The final native Moqui/H2 Chrome suite passed **113 checks**, including existing
Kitchen drafts, waiters, legacy routes, XSS-as-text, CSRF and foreign-shop denial.
Edge and Playwright WebKit run the focused table/billing/print group independently;
counts and results are recorded in `results.json`. WebKit is not a claim of testing
the Safari application on macOS/iOS. The navigation harness passed six checks per
engine in Chrome, Edge and WebKit. Shared receipt layout/options checks and all
four repository guards passed. XML and JavaScript parsing passed. This repository
uses Moqui; it has no root npm test/build application.

Entry points:

```text
node docs/qa/pos-runtime/verify-kitchen-display.cjs
node docs/qa/pos-runtime/check-kitchen-navigation.cjs
```

The runtime verifier requires the disposable native runtime/probe environment
described in the POS QA README. `POS_QA_PHASE=workflows` with `POS_QA_SKIP_INIT=1`
reruns only the focused workflows on that synthetic database. `POS_QA_ENGINE=webkit`
selects WebKit; `POS_QA_CHROME` can select Edge. Existing POS CI also invokes the
new table/print groups and navigation harness. See synthetic evidence alongside
this document. No production requests, sales or account changes were performed.

On 2 November the branch was reconciled with master `01e796eb`, retaining its
role-access controls and Users stylesheet on both surfaces alongside the Kitchen
assets. The complete native Chrome Kitchen verifier passed again: 113 checks,
zero failures. The four repository guards and merged shared-app XML parsing passed.

## Deployment and remaining hardware checks

Deploy the complete component changes and restart Moqui so the optional KOT
`tableId` and `orderReceiptJson` columns are created. Historical table labels are
preserved; no guessed table/pricing backfill is run. Old unlinked tickets without
a price snapshot cannot print an invented customer bill.

Kitchen printing retains the existing browser printer-selection workflow. KOT and
customer receipts remain separate jobs; this change does not reuse a billing-only
QZ callback with a different signature or assume both use the same device. Select
the correct physical printer/paper size and test both on the target terminal.
Hardware availability, browser dialog cancellation and physical output cannot be
certified by intercepted browser tests. Production QZ trust/assignments are untouched.
