# POS SOP coverage register

Source: `docs/qa/SOP-09-POS.md`. Evidence names refer to `verify-runtime.cjs` and
the generated report/artifacts. Duplicate case ids are preserved by occurrence
and title. **Covered steps** means the listed assertions only; it does not claim
every step in a case passed. **Pending** is explicitly not a pass. Physical
hardware, external providers and Safari require the owner's environment.

| SOP id / occurrence | Title | Coverage and evidence |
|---|---|---|
| PS-001 / 1 | Open a session | Open/session status and active till DOM |
| PS-002 / 1 | One open session per terminal | Pending: not yet fully exercised |
| PS-003 / 1 | Tap a product | Pending: not yet fully exercised |
| PS-004 / 1 | Category tabs | Pending: not yet fully exercised |
| PS-004a / 1 | **ALL ITEMS is instant** | Pending: not yet fully exercised |
| PS-005 / 1 | Product search | Pending: not yet fully exercised |
| PS-005a / 1 | **Search-bar add = qty 1** | One search/Enter ajaxCart POST, qty 1 |
| PS-005b / 1 | Search-add shows the name | Search-added product name in cart DOM; markup stays literal in AJAX cart, side summary follows add/remove |
| PS-005c / 1 | Search box still scans | Pending: not yet fully exercised |
| PS-006 / 1 | Qty + / − | Pending: not yet fully exercised |
| PS-007 / 1 | **Qty edit never deletes** | Invalid quantity POST retains the cart line |
| PS-008 / 1 | Price edit | Pending: not yet fully exercised |
| PS-009 / 1 | Negative price | Negative add/edit price refused before write |
| PS-010 / 1 | Remove line (×) | Pending: not yet fully exercised |
| PS-011 / 1 | Empty-cart checkout | Empty checkout and credit refused |
| PS-015 / 1 | Scan a coded product | Pending: not yet fully exercised |
| PS-016 / 1 | Unknown barcode | Pending: not yet fully exercised |
| PS-017 / 1 | Duplicate/ambiguous code | Pending: not yet fully exercised |
| PS-018 / 1 | Scanner Enter | Pending: not yet fully exercised |
| PS-020 / 1 | Store-wide mode switch | Pending: not yet fully exercised |
| PS-021 / 1 | Per-line mode | Pending: not yet fully exercised |
| PS-022 / 1 | **Unpriced product in a fixed mode** | Missing wholesale product price refused at add (mode-switch step still needs separate coverage) |
| PS-023 / 1 | **Quantity-break** | Configured threshold 5 selects wholesale 90; manual price 80 is exempt (threshold reversion still pending) |
| PS-024 / 1 | **TAX toggle OFF/ON** | Pending: not yet fully exercised |
| PS-025 / 1 | Attach a customer | Customer attachment changes destination without repricing |
| PS-026 / 1 | Customer cross-org | Parent customer ownership guard (foreign request coverage required) |
| PS-030 / 1 | Intra-state 18% | 100 taxable + CGST/SGST 9 each = 118 |
| PS-031 / 1 | Inter-state 18% | Inter-state discounted 72 taxable with IGST, unchanged manual price |
| PS-032 / 1 | Mixed rates | Mixed 100 at 18% + 200 at 5% = 328 |
| PS-033 / 1 | Round-off | 117.90 grand plus round-off reconciles to 118 payable |
| PS-034 / 1 | Tax OFF sale | Held tax-off cart retains zero GST without repricing |
| PS-040 / 1 | Cash exact (F1) | Pending: not yet fully exercised |
| PS-041 / 1 | Cash over-payment | Cash 200, payable 118, change 82 |
| PS-042 / 1 | Card (F2) / UPI (F3) | Card split and UPI/credit payment rows |
| PS-043 / 1 | **Split payment** | Cash 60 + Card 58 = 118 |
| PS-044 / 1 | **Split under total (rejected)** | Pending: not yet fully exercised |
| PS-045 / 1 | **No double-charge on retry** | Completed checkout retry creates no second payment |
| PS-046 / 1 | Over-payment change on split | Noncash cumulative over-tender rejected before insert |
| PS-047 / 1 | **Split non-cash over-tender (rejected)** | Partial noncash over-tender refused, existing tender retained |
| PS-048 / 1 | **Split inputs legible in dark mode** | Pending: not yet fully exercised |
| PS-050 / 1 | Complete a sale | Persisted completed status, one number and retry-safe tender; hardware printing separately pending |
| PS-051 / 1 | **Receipt auto-prints** | Pending: not yet fully exercised |
| PS-052 / 1 | Receipt never blocks a sale | Pending: not yet fully exercised |
| PS-053 / 1 | **Auto-advance to new sale** | Pending: not yet fully exercised |
| PS-054 / 1 | New Sale / F10 | Pending: not yet fully exercised |
| PS-055 / 1 | Receipt PDF | Receipt PDF renders with portable Rs. currency prefix |
| PS-060 / 1 | Hold a cart | Hold/recall retains original identity and line snapshot |
| PS-061 / 1 | Recall | Second recall rejected |
| PS-062 / 1 | Multi-bill hold | Pending: not yet fully exercised |
| PS-063 / 1 | Void | Unpaid void has no bill number |
| PS-064 / 1 | Void/hold then new bill | Pending: not yet fully exercised |
| PS-070 / 1 | **Amend an issued bill** | Synthetic-only quantity amendment, same number, linked total/tax/audit |
| PS-071 / 1 | Amend receipt reprint | Pending: not yet fully exercised |
| PS-072 / 1 | Credit / pay-later | Empty credit denied; synthetic credit preserves partial collected amount |
| PS-072a / 1 | **Credit marker on the receipt** | Pending: not yet fully exercised |
| PS-073 / 1 | Settle a credit bill | Partial/full credit, old-shift collection attribution, cash/change and closed-drawer preservation |
| PS-073a / 1 | **Credit bill status in Transactions** | Pending: not yet fully exercised |
| PS-090 / 1 | **Cashier lands in POS** | Cashier landing assertions |
| PS-091 / 1 | **Cashier can create items** | Cashier Inventory GET renders |
| PS-092 / 1 | **Cashier reaches the Dashboard** | Cashier access boundary covered; dashboard tile subset pending |
| PS-093 / 1 | **Other modules still bounce** | Cashier Accounting denied/bounced to POS |
| PS-094 / 1 | **Non-cashier is unaffected** | Pending: not yet fully exercised |
| PS-080 / 1 | Close session | 1425 drawer reconciliation plus idempotent re-close |
| PS-081 / 1 | Stale-cart cleanup | Partial payments survive reopen/close/fresh-sale/void attempts |
| PS-082 / 1 | Cash entry / movement | UI cash-in/out posts link to drawer and reconcile |
| PS-082a / 1 | **Cash / Expense / Wastage entry validation** | Cash/expense invalid amounts and expired-wastage invalid quantity/cost refused |
| PS-085 / 1 | Consecutive numbers | Pending: not yet fully exercised |
| PS-086 / 1 | **Concurrent terminals** | Two simultaneous terminal completions, distinct consecutive numbers |
| PS-087 / 1 | Per-tenant series | Pending: not yet fully exercised |
| PS-090 / 2 | Bill becomes an invoice | Idempotent POS invoice sync and finalized header |
| PS-090a / 1 | **Printed invoice matches the receipt (GST)** | Receipt and InvoicePrint PDF: 900 taxable + 162 GST = 1062; words/visual inspected |
| PS-091 / 2 | Invoice GST matches | GST detail carried to linked invoice |
| PS-091a / 1 | **Invoice barcode + clean layout** | Invoice PDF visually contains DataMatrix and correct number caption |
| PS-092 / 2 | Stock depletes | Opening tracked stock 100 → sale qty 2 sync 98 → amend qty 3 stock 97 |
| PS-100 / 1 | Terminal CRUD | Pending: not yet fully exercised |
| PS-101 / 1 | Sales modes | Pending: not yet fully exercised |
| PS-102 / 1 | Product Prices bulk grid | Wholesale fixed price and missing-price service assertions (bulk-grid writes not yet certified) |
| PS-103 / 1 | Receipt template | Pending: not yet fully exercised |
| PS-110 / 1 | Offline config | Pending: not yet fully exercised |
| PS-111 / 1 | Offline sale sync | Valid/invalid batch isolation, per-id ack, retry idempotency, original cart preserved |
| PS-111a / 1 | **Bill History while offline** | Pending: not yet fully exercised |
| PS-112 / 1 | Reports | All report children render; Payment Wise CSV independently reconciles net cash and distinct bills; net-payment PDF renders (other numeric report assertions pending) |
| PS-113 / 1 | Bill register / audit | Concurrent numbers and synthetic amendment audit assertions |
| PS-120 / 1 | Terminal on a real till screen | Active Normal/Advanced terminal at 1920/1366/800/390/320; cart height, header containment, scroll-reachable cart/payment controls and SVG fullscreen icon; 100 general layout combinations. Physical till still needs owner acceptance |
| PS-121 / 1 | **/qapps bounces to /apps** | qapps Terminal renders rich apps redirect |
| PS-121a / 1 | **Dashboard "Manage" shortcut tiles open** | Pending: not yet fully exercised |
| PS-122 / 1 | Keyboard shortcuts | Pending: not yet fully exercised |
| PS-123 / 1 | XSS in product/customer name | Offline malicious product name remains literal; Kitchen child renders assert no execution |
| PS-124 / 1 | Transitions need the session token | Normal cart transition rejects missing CSRF; offline endpoint intentionally token-free and guarded |
