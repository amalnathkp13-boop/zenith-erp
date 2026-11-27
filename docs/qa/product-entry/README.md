# Shared product-entry regression

Run against a disposable local Moqui database seeded with the existing `docs/qa/sales-runtime/fixture.xml` and initialized with that folder's `qa-screen.xml`. Never install these helpers on a customer runtime.

1. Start that runtime with `-Dsales.qa.disposable=true`.
2. Copy this folder's `qa-screen.xml` to the runtime Sales screens as `ProductEntryQa.xml` before starting the server. It creates only fixed `SALES_QA_*` records and refuses initialization without the disposable flag and the public demo administrator.
3. Make Playwright available through `NODE_PATH` (the existing Sales QA browser tools are sufficient).
4. Set `SALES_QA_BASE` to the loopback URL and optionally `SALES_QA_OUT` to an artifact directory outside the checkout, then run `node docs/qa/product-entry/verify.cjs`.

The check opens ten document screens in both Bootstrap and Quasar, selects organization-scoped products, and saves quotation, order, invoice and credit-note lines through their native forms. It checks exact persisted line counts, quantity and price, and that issued/foreign documents expose no product-entry form. Purchase, transfer, adjustment and BOM screens retain their document-specific fields. The original Sales QA fixture and this helper use only synthetic data and public Moqui demo accounts. Destroy the disposable database after reviewing the preview.

The shared renderer delegates unrelated forms, product filters, multi-selects, dynamic remote selectors and non-HTML exports to Moqui's standard macros. POS terminals already have their own product grid. GRN/receiving rows remain tied to their source order rather than offering unrestricted catalog items.
