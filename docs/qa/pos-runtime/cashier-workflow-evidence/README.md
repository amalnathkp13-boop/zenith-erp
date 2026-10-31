# Cashier workflow verification â€” PR #164 follow-up

These checks use loopback Moqui with an in-memory H2 database and synthetic
`POS_QA_*` organizations. No production records, credentials or printer jobs are
part of this evidence. Focused run summaries and source fingerprints are recorded
in `../cashier-workflow-reverification.json`.

## Reproduced before changing the code

The initial focused native run completed 91 assertions and exposed eight failures:
product selection did not focus Rate; Enter did not select Quantity; a typed rate
was not saved without Enter; the lower strip repeated the bill number; manual rate
changes were counted as discounts; History had no Reprint button; the editor had no
independent Print bill button; and cashier initial HTML contained unauthorized
Sales navigation links. The shared CSS check separately reproduced Customize
wrapping below its tabs. The strengthened check includes Bootstrap 3’s
`!important` display rule, which otherwise overrides the classic shell’s flex row. The QZ virtual-clock check reproduced a device connection
on simply entering billing.

## Verified behavior

- A product selection focuses Rate. Enter selects Quantity, then Enter returns to
  Search. Background additions retain another line's active draft and selection.
- Valid rate/quantity input saves without Enter. Checkout and Hold wait for queued
  saves. A slow reopened-cart edit updates the amount before the payment dialog
  opens. Rejected synchronization blocks payment and asks the cashier to reload.
  Validation and server-side price permissions remain enforced.
- Lower Last amount omits the bill number. The header retains the last bill number.
- Reprint on a History row and Print bill inside the editor fetch saved receipt
  data. A draft changed to another price does not affect the reprint. Independent
  database snapshots assert unchanged issued lines, totals, payments and amendments.
- You Saved uses the explicit stored discount total; a manual negotiated rate is
  not added to it. Existing issued transaction amounts are not rewritten.
- Three synthetic terminals across two shops exercise cashier/operator isolation,
  same-login terminal selection, owner terminal history, direct receipt/PDF/amendment
  denial, and owner combined/single-shop counts and amounts against independent SQL.
  A foreign/unknown dashboard location returns zero rather than combined sales.
  An independently completed bill in another organization is excluded from All Shops
  totals, recent-bill details and the related organization-scoped dashboard queries.
- Initial classic HTML and Quasar navigation use the same authenticated role/plan
  allowlist. Delayed/failed configuration stays hidden beyond three seconds; an
  all-access plan does not remove role restrictions, including an empty grant list.
- Product Catalog styles stay inside the catalog. The shared Customize button stays
  alongside horizontally scrolling tabs instead of moving into page content.
- Opening billing makes no QZ connection. Explicit print/setup actions connect on
  demand. Permission delay, disconnection, timeout, retry, explicit browser fallback
  and duplicate-copy guards use a mock printer and no physical jobs.

## Re-running

Use the existing disposable runtime instructions in `../README.md`. The full
`verify-runtime.cjs` includes these checks. Final complete-run and CI results are
reported in PR #164. `POS_QA_FOCUS=cashier-entry`,
`history-scope`, `rate-sync`, `catalog`, or `history-window` selects a focused group.
Use a freshly initialized disposable database for independent acceptance results.
`POS_QA_UI_ONLY=true` is also used for focused rechecks against already initialized
synthetic fixtures; it is not a substitute for the full financial suite.

Standalone checks:

```text
node docs/qa/pos-runtime/check-shared-chrome.cjs
node docs/qa/pos-runtime/check-navigation-policy.cjs
node docs/qa/pos-runtime/check-print-routing.cjs
```

This Moqui checkout has no root package.json or npm test/build scripts. Native
runtime verification and the four repository guards are the applicable checks.

## Deployment and device boundaries

This PR is not a production deployment. Trusted, prompt-free QZ printing still
requires the deployment's trusted certificate/signing configuration and a physical
printer acceptance check. The repository contains deployment references to a
host-only signing key; this work neither reads/copies that key nor invents trust,
disables QZ security, or certifies hardware from mocks. Browser fallback is an
explicit choice while fullscreen because native print dialogs may exit fullscreen.
Owner financial acceptance remains required before deployment.
