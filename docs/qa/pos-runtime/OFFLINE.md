# Offline checkout verification

Use a disposable runtime and the synthetic fixtures described in this directory. Never run this harness against a live shop.

`POS_QA_FOCUS=offline-workspace node docs/qa/pos-runtime/verify-runtime.cjs` runs the real billing services, browser disconnect/reconnect, and read-only database assertions. `node docs/qa/pos-runtime/verify-offline-cart.cjs` checks IndexedDB persistence, a second-tab conflict, input validation, partial acknowledgements, and failed sync independently.

The regression was reproduced before the change: disconnecting a populated server cart made it read-only and prevented checkout. The flow captures a revision of that unpaid draft and completes the same transaction on replay. A completed local receipt whose untendered source has changed is recovered as a separate bill without overwriting the changed draft. Ownership, session, tax, collected-total and ambiguous payment conflicts retain the device copy.

Online Cash, Card, UPI, Split and Credit also stage a durable checkout identity before their payment request. The server stores that identity atomically with completion. If a response is lost, automatic replay either acknowledges the exact completed checkout (including its full item and tender facts), or completes the queued receipt once. A connected ERP page also retries ordinary queued bills for the signed-in organization and user, including after leaving the terminal. A fresh in-flight HTTP checkout is excluded until its request settles or its recovery window expires.

`POS_QA_FOCUS=offline-auto-reconcile` verifies stale-source recovery, all tender methods, 20-line preservation and exact-attempt reconciliation against real local services. Older paid-source entries without a shared identity cannot be automatically matched by amount alone; they remain saved until their original bill and payment can be reconciled.

Manual checks:

1. Open the assigned terminal online and allow its catalog and draft snapshot to finish caching. Add a taxed product, disconnect, edit its rate and quantity, and verify the immediate total.
2. Search multiple words, including spaces. Select a product, press Enter from rate to quantity and from quantity to search. With an empty search, Space focuses Cash; Enter opens exact cash tender; the next Enter confirms once.
3. Complete Cash (including over-tender/change), Card, UPI, Split, and Credit sales. Credit needs a name and valid phone. Card/UPI confirmation records an externally received tender; offline checkout does not verify a payment gateway.
4. Change line modes and tax on/off. Hold a retail bill, make another bill in a different mode, and recall the first: its original rates, mode, customer, discount, and tax must return.
5. Reload with an unpaid local draft. It must survive. A second tab for the same terminal and login must not take over that draft.
6. Print a pending receipt and inspect names, units, tax, total, supplier, customer, change or credit balance. The receipt uses a unique offline reference. Its official invoice number is assigned after server validation. Browser printing is available offline; the server-backed QZ signing endpoint requires a connection.
7. Reconnect and verify transaction, invoice, tender rows, tax details, receivable, and stock. Retry the same queued sale: one acknowledgement and one completed transaction. An omitted acknowledgement or a failed HTTP request must leave the sale queued.
8. Try a foreign shop, product, terminal, user, stale draft revision, or missing session token. The request must not change bills or stock. Same-product equal-price lines in different modes must remain separate.

Keep the device and its browser storage until reconciliation is complete. The original closed session can receive valid late sales and retain its closing details. Changed policies/tax, unavailable tax cache, an unproven server tender, or altered held/draft-only records still need review. Free items and discounts requiring a manager approval remain online approval workflows; no manager PIN or signing private key is cached on the device.
