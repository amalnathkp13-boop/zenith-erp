# Inventory subnavigation consistency audit

**Date:** 2026-10-11
**Module:** Inventory
**Severity:** S4 — Low (UI, per SOP-05 §5)
**Case mapping:** SOP-05 §3 and §20, IV-140 (desktop layout)

## Finding

The Inventory section tabs change their labels when moving from the Inventory Dashboard to Stock Levels. The Dashboard screenshot shows the shared labels `Stock Levels`, `Receiving`, `Stock Transfers`, `Stock Adjustments`, `Gate Passes`, `Catalogues`, `Expiry Risk`, and `Demand Forecast`. The Stock Levels screenshot shows the same destinations as `Stock`, `Receive Stock`, `Stock Transfer`, `Stock Adjustment`, `Gate Entry`, `Product List`, `Expiry`, and `Sales Forecast`.

These are aliases for the same Inventory routes, not separate destinations. The shorter labels are also misleading: for example, `Product List` points to Catalogues, and `Sales Forecast` points to the Inventory Demand Forecast.

## Training-chat cross-check

I reviewed the training-chat text for this issue. It records earlier shared-header and navigation problems in other areas, but I found no prior Inventory subnavigation label mismatch. This finding appears new in the supplied screenshots. The check used conversation text only, not its images or pull requests.

## SOP assessment

SOP-05 §3 identifies the Inventory screens and their routes. §20, case IV-140, calls for aligned desktop layouts, and §5 classifies minor UI inconsistencies as S4. The SOP does not define a separate set of page-specific Inventory tab labels; the Inventory Dashboard screenshot and the shared navigation route map provide the consistent labels used here.

## Cause and correction

The page enhancement scripts for Product Catalog, Stock Levels, and Stock Transfers rewrote labels in the shared `#z-subnav` and `#zq-subnav` bars while those page roots were present. The Dashboard did not run those rewrites, which explains why its labels differed.

The correction removes those page-level label rewrites and their restoration bookkeeping. The canonical shared-shell labels, tab destinations, active-state handling, sidebar behavior, page controls, and stock/business logic remain in place. Static asset cache versions were bumped so browsers load the corrected scripts.

## Impact and verification

- Affected shared UI: Inventory subnavigation on Product Catalog, Stock Levels, and Stock Transfers in `/apps` and `/qapps`.
- No route targets, forms, queries, stock movements, data access, or business rules changed.
- Code inspection confirms the page scripts no longer assign Inventory tab text and the shared-shell route labels remain unchanged.
- The SOP pre-commit source guards passed: CSS comments, party picker, cross-module transitions, and form DOM collisions.
- Application test suites were not run.
- Runtime rendering on `/apps` and `/qapps` remains to be checked in an ERP environment, as required by the UI workflow. No live tenant data was changed.
