# Product editor verification

This change replaces only Inventory → Edit Product content with the supplied card
layout. The global navbar/sidebar are unchanged; their shared asset version is
bumped as required by CONTRIBUTING.md. The five links navigate the actual editable
sections. Summary fields update immediately; warehouse stock and price history
come from the existing database queries. GST rates never invent HSN/SAC codes.

`Product.printName` is an optional override. Null/blank follows Product Name,
including future renames. An explicit different name persists until reset with
**Use Product Name**. New POS lines (including additions when revising a bill)
snapshot the effective name in their existing `productName` field. Reprints read
that snapshot; old issued invoices are not rewritten or renumbered.

The optional image is saved with the product form, separately in
`ProductEditorImage`, so POS/catalogue queries do not load image bytes. Uploads
are decoded, bounded to 2 MB/4096 pixels per side and re-encoded as PNG/JPEG.
Ownership, write access, POST and CSRF checks cover update/delete. The update map
allows only editor fields and preserves partial updates and null/unpriced MRP.
The normal Moqui schema update must add the nullable `printName` column and image
table before this candidate is deployed. No manual data backfill is required.

## Actual results

- Chrome: **62 checks, zero failures** against a freshly initialized disposable
  loopback Moqui/H2 runtime; both `/apps` and `/qapps`.
- Edge: **61 checks, zero failures**, same suite against that initialized runtime
  (the one bootstrap fixture check is not repeated).
- Four viewport widths per shell: 1440, 1024, 768, 390 pixels.
- Actual form saves, automatic/custom/reset name persistence, blank MRP remaining
  unpriced, real image upload/reload/removal, price-change audit records, validation,
  duplicate barcode, CSRF, foreign org and view-only write rejection.
- New POS bill names, actual synthetic payment/completion, reprint after master
  rename, issued invoice amount/identity unchanged, next default-name bill, void
  and session close. Synthetic role changes restored in `finally`.
- `check-editor.cjs` failed on the original source because the persisted print-name
  override was absent; it passes with the implementation. XML parsing, JS syntax,
  whitespace and all four repository guards pass.
- QA JVM stopped; zero QA HTTP/H2 listeners; IFEXISTS DB probe cannot reconnect.
  Production data and physical printers were never accessed. No root npm test or
  build scripts exist in this Moqui repository. Safari was not run locally.

Evidence: `evidence/chrome-results.json`, `edge-results.json`,
`editor-desktop.png` and `teardown.json`. All data/screenshots are synthetic.

## Reproduce locally

Use the existing disposable POS runtime instructions and fixtures in
`docs/qa/pos-runtime/README.md`; never use a production or persistent customer DB.
Overlay `role-probe.xml` only into the disposable runtime at
`runtime/component/zenith-erp-inventory/screen/zenith/inventory/Inventory/ProductEditorQa.xml`.
Set `POS_QA_NATIVE_ROOT`, `POS_QA_JAVA`, `POS_QA_OUT`, and the bundled Node module
directory in `NODE_PATH`. Run `node docs/qa/product-editor/verify.cjs`.
For Edge set `POS_QA_CHROME` to its installed executable and run again.
Stop the disposable JVM and confirm the database/listeners are gone afterward.
Never install either QA helper on production.
