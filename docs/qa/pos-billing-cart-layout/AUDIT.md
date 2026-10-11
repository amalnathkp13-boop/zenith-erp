# POS billing add and viewport layout audit

Status: local candidate prepared on `fix/pos-billing-cart-layout`; not pushed and no PR opened.

## Reported behavior

The provided screenshots show an item add failing while POS tax is off, with a GST supply-state validation message. The optimistic cart row then disappears. The Normal billing view also extends below the viewport and requires page scrolling. The Advanced view should retain the catalog/cart/payment arrangement shown in the supplied reference.

## Findings and corrections

### POS-1 — Tax-off item adds enter GST validation

`add#PosTransactionItem` called `calculate#Tax` before checking `taxOn`. The India GST service validates seller and buyer states even when the cashier has turned tax off. Its error returned through the cart AJAX endpoint, and the optimistic cart engine removed the temporary row after the server rejected the add.

The add service now initializes a tax-free line from the entered price less discount and calls the tax engine only when tax is on. This also preserves the entered price for tax-inclusive sales modes when tax is off. Tax-on calculation and stored tax breakdowns continue through the existing GST path.

### POS-2 — Desktop billing falls back to page scrolling

The shared POS page rule forced `#pos-terminal-root` to scroll and prevented `.pos-main-layout` from shrinking below 300px, even though the terminal already measures the viewport height. Normal mode therefore pushed the footer and payment controls below the fold.

The terminal screen now overrides those rules only for the wide billing terminal. The main work area can shrink to the measured viewport, the Advanced catalog fills its left grid track, the cart and customer panel keep their own scroll areas, and the payment section stays in the terminal frame. Normal mode also reduces card and footer spacing on shorter desktop screens. The shared ERP header, navigation, and other POS screens are not changed. Narrow layouts keep their existing scrolling fallback.

## SOP coverage

- `docs/qa/SOP-09-POS.md`: PS-003 (tap adds and updates totals), PS-024 and PS-034 (tax toggle and tax-off sale), PS-030/031 (tax-on intra/inter-state calculations remain on the existing path), PS-120 (catalog, cart, and payment controls fit without clipping), and XF-001 (single cart engine and authoritative server result).
- `docs/SOP-production-bug-PR.pdf`: reproduce the reported path, isolate one logical change, use only synthetic disposable fixtures, verify `/apps` and `/qapps`, run repository guards, and keep runtime-only proof distinct from source checks.
- `CONTRIBUTING.md` and `docs/infra/local-dev-setup.md`: branch from current `origin/master`; use disposable data only; never test billing writes on MARUTHI or another live tenant; do not include customer data or secrets.

## Training chat comparison

I inspected the shared training chat's text only and excluded its images and PR contents. Its text mentions an earlier POS GST-recalculation failure during customer assignment. That is related, but the text does not describe a tax-off first-item add being rejected and rolled back, nor the Normal billing page-height problem. These are distinct reported symptoms.

## Verification and limits

The disposable POS runtime suite now contains a regression case using a synthetic terminal with no valid supply state, plus desktop layout assertions for a fixed outer terminal and reachable payment controls. The fixture is synthetic and the test closes its session and voids its unissued cart.

Source checks completed:

- XML parsing passed for the edited POS service, terminal screen, disposable fixture, and QA screen.
- `node --check` passed for the POS runtime verifier.
- CSS comment, party picker, cross-module transition, and form DOM collision guards passed.
- `git diff --check` passed with the repository's CRLF line endings recognized.

This workstation has no Docker executable and no local ZetaERP runtime image, so the Moqui billing scenario and rendered viewport could not be run here. The new regression case is prepared in the disposable POS runtime suite but has not been executed. I have not accessed a production tenant, written billing data, pushed the branch, opened a PR, merged code, or deployed anything.

Before merge, run the repository's required master workflow against the exact candidate SHA and the POS CI acceptance workflow as required by the POS runtime README. A maintainer must also verify the POS on both app surfaces in the disposable runtime and confirm cleanup evidence. The report does not claim those runtime checks passed.
