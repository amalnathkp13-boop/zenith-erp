# POS-04-09 — manager-approved free items

Historical evidence for PR #138. Under the later POS-05-10 policy, products with a ₹0 unit price or no price may remain in a draft cart, but payment and bill completion are blocked even with manager approval. Approval still applies to a positive-price product discounted to zero. The manual steps below describe the earlier policy.

The user selected **manager approval and reason** rather than blocking all free items. This follow-up belongs to PR #138 and preserves legitimate free-item sales. It does not retrospectively change issued invoices or credit collections.

## Behavior

Zero/missing prices and fully discounted lines may stay in a draft. Before collecting money, completing a cash/card/UPI/split/credit sale, or saving an issued-bill edit containing free items, the server requires approval for the current free lines. The checkout prompt lists their products and quantities and requires a trimmed reason of 1–500 characters.

A signed-in platform administrator, tenant administrator, or POS store manager with POS write access can explicitly approve. A cashier needs the **active shop's manager PIN**, configured under POS → Discount. POS write access alone does not confer manager authority. Only managers can save discount/approval settings. Five failed PIN attempts lock that user's attempts in that shop for five minutes; these counters survive rejected approval transactions.

The audit stores organization, transaction, session, exact free-line snapshot, reason, time, requester and approval method. Signed-in manager approval also records the manager account. PIN approval records the cashier/requester and `ShopManagerPin`; it does not falsely identify the cashier as the manager. PIN values are not stored in the approval audit or returned by the approval API. Transaction details show the approval history.

The approval covers the displayed contents. A change from another tab while approval is pending is rejected. Changes after approval invalidate it, including changing a quantity and restoring the old value. Unchanged hold/recall retains approval; moving the sale to a different session invalidates it. Decimal values are canonicalized so database scale conversion does not invalidate an unchanged approval.

An amendment is previewed and rolled back until approved. Approval then covers the final batch of changes, in the same transaction as the amended bill, linked invoice and inventory adjustments. A failed approval commits none of those changes.

Free-item checkout requires a connection: offline checkout keeps the draft and explains that online manager approval is needed. It creates no queued sale or receipt for that draft. Ordinary priced offline sales retain their existing workflow. Previously issued credit bills can still be settled without retroactive approval.

## Hypothesis and regression

Before changing the code, the hypothesis was that gating the shared payment/completion services and atomic amendment boundary would prevent free-sale bypasses without removing legitimate free items. A successful unapproved tender/completion, a cross-shop approval, a stale approval reused after an edit, or partial amendment persistence would disprove it.

The independent baseline runs the original `PosServices.xml` from `a3408cf3` in a fresh disposable runtime, with an updated guarded QA adapter that creates independent carts. Three checks fail: an unapproved mixed bill accepts money, an unapproved all-free bill completes, and an unapproved mixed bill completes as credit. The GET mutation control passes. The original service SHA-256 is `9b23600d9cad30d34fa1726080b4427bbd67447d2440cba78a1ad0d37a0f50d0`.

The first full candidate run stopped at check 871 because the stock-race suite used a free sale to anchor a session without approval. That fixture now explicitly obtains approval; the production gate was preserved. Intermediate harness navigation/selector errors and candidate implementation repairs are not counted as additional reported bugs.

Run the full portable POS suite through `docs/qa/pos-runtime/verify-runtime.cjs`; it includes `verify-free-items.cjs` and the shared policy cases. The standalone native regression is `docs/qa/pos-drive-reports/free-items.cjs`. Both use real services, authenticated HTTP, browser controls, and independent SQL against synthetic data. The full profile supports native H2 and CI PostgreSQL. No production endpoint, payment provider or physical printer is used.

## Manual retest

1. As a cashier, add a zero-price product and a normally priced product. Check the free-item label and totals. Cash checkout must ask for approval before recording money.
2. Cancel approval. Confirm the draft and quantities remain, with no tender, issued bill number or new approval.
3. Try a blank/whitespace reason and a reason longer than 500 characters. Neither may approve.
4. Use another shop's PIN, an incorrect PIN, or no PIN. Approval must fail without changing the bill.
5. After five failed PIN attempts, try the correct PIN. It must remain blocked for five minutes. A properly signed-in manager can still approve using their account.
6. Approve with the correct shop PIN and reason. Verify one completed bill, correct tender/change, and an audit identifying the cashier as requester and the PIN as approval method.
7. Repeat signed in as a manager. A reason and explicit confirmation remain mandatory; verify the manager account in history.
8. Complete an approved all-free bill. It must have a bill number and line item but no invented zero-valued payment row.
9. Repeat with tax on and off, an explicit zero override, a missing catalog price, and a 100% line/bill discount. Each free-item case needs approval.
10. Repeat mixed-bill checkout with Card, UPI, split Cash/Card, and Credit, including upfront collection. No tender or completion may bypass approval.
11. Change a free quantity after approval, then restore it. Approval must be required again. Also change a free line while another tab has the approval prompt open; the pending approval must be rejected.
12. Hold/recall an unchanged approved cart. Its approval may remain valid. A transfer to a different session requires approval again.
13. Edit an issued bill to a zero price. First cancel approval and verify unchanged lines, totals, invoice, stock and edit audit. Then approve and save; verify the same bill/invoice is updated consistently.
14. Change two free-item quantities in one amendment batch. The prompt must preview both final quantities and one approval must cover the whole committed batch.
15. Review transaction details. Check reason, method, requester, manager account where applicable, and timestamp; no PIN should be visible.
16. Disconnect and try an offline free-item payment. The unpaid draft stays and no receipt/queue entry is created. Check that a normally priced offline bill still queues and prints as before.
17. Use both supported layouts and narrow/desktop viewports. Check that approval controls remain visible, keyboard focus stays within the prompt, Escape cancels, and product names appear as text.
18. Verify ordinary priced cash/card/UPI/split bills, legacy credit collection, stock depletion and session reconciliation remain correct.

Actual final results and source fingerprints are recorded in `free-items-evidence.json`. Completion in Drive means verified code in the open PR; it does not mean deployed. Physical receipt hardware, provider delivery and deployed-shop configuration remain outside this disposable-runtime proof.

Synthetic browser previews:

![Manager approval on mobile](evidence/free-approval-mobile.png)

![Manager approval on desktop](evidence/free-approval-desktop.png)
