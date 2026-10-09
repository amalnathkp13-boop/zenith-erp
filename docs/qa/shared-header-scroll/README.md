# Shared header scroll regression

On live `/qapps`, scroll down on Sales, POS or Inventory, then scroll upward by a small amount without returning to the top. Quasar's `QHeader reveal` translates the header independently of the fixed module tabs. The tabs leave an exposed strip of page content above them, and the two bars move independently during reversal. Contacts already had a local override for this behavior.

The shared shell now keeps the header fixed with its tabs. A single resize observer measures the header and visible tabs; the same measurements position the tabs and reserve content space. This also handles toolbar wrapping, sidebar resizing and SPA changes between modules with different toolbar layouts. Existing module-specific toolbar styling remains intact. Both stylesheet registrations and the navigation script are cache-busted.

Scope: Quasar shared chrome only. No services, entities, queries, forms, transitions, menu destinations, cashier filters, shop submissions, invoice totals or offline storage change. Bootstrap's layout, including the focused billing terminal, is unchanged. This is independent of POS billing PR #27; it replaces the Quasar header portion previously carried by UI PR #59.

## Reproducible regression

```sh
# Run from a clone with Playwright available. Do not point this runner at production.
# QA_WEBROOT is a local framework screen/webroot directory containing libs/vue and libs/quasar.
QA_WEBROOT=/path/to/runtime/base-component/webroot/screen/webroot \
QA_BASE_REF=9a9b053533ebbe916127430a5fe1b466e382e4e6 \
QA_OUTPUT=/tmp/shared-header-proof \
node docs/qa/shared-header-scroll/check.cjs
```

Optional `QA_CHROME` selects an installed Chrome executable; `QA_GIT` selects Git. The runner starts a temporary server on loopback with an allocated port and closes it and its browser on exit. Its pages contain synthetic text, the repository's exact shared CSS/navigation, and real framework Vue/Quasar components. It has no database, ERP credentials or financial actions.

- The unpatched master must reproduce the gap with a real `QHeader`, not a hand-built static header.
- All 16 module tab sets plus My Subscription are exercised at 1440, 1200, 1024, 900, 710 and 375 pixels.
- Checks include scroll-down and repeated small scroll reversals away from page top, joined header/tab geometry, and content reservation.
- SPA navigation from wrapped Contacts to unwrapped POS, resize without reload, mobile sidebar interaction, module search, hidden tabs on My Subscription and cashier tab filtering are checked.
- The Bootstrap fixture and its interactive control are compared before/after at three widths; the billing-tab destination remains `/apps/zenith/pos/Terminal`.
- Any JavaScript exception or write request fails the runner. The full local assertion results are private; the sanitized summary and source hashes are in `evidence.json`.

This isolated shell test is intentionally separate from Moqui end-to-end, billing, database, printer or device acceptance. Required staging-acceptance and repo-guards must also pass on the final PR head. The maintainer must verify the real deployed shell after the normal ordered deployment; merge alone does not update production.

The older #59 header evidence tested full down/return scrolling. It did not require the genuine Quasar shell or cover small reverse scrolls, so it is not used as proof for this fix.

## Native runtime verification

Fresh disposable Moqui runtime overlaid with all 1,004 tracked component files from the rebased candidate; comparison found zero differences after CRLF/LF normalization. Seventy-two native renders covered 18 routes on both `/apps` and genuine `/qapps`, at 1440 and 710 pixels. The native Quasar assertions require `.q-header` and `#zq-subnav`; 19 naturally scrollable layouts exercised down and small upward scrolling. Short pages are recorded as render/layout checks, not scroll coverage.

All 115 native checks passed with zero browser exceptions. Focused Terminal geometry matched master on both entry surfaces. Independent SELECT-only fingerprints of 18 financial/subscription tables matched before and after navigation; business POSTs were blocked, including Terminal catalog prefetch. This is a read-only UI no-op check, not billing/device acceptance. The disposable JVM was stopped, both listeners closed, and an independent `IFEXISTS=TRUE` reconnect failed, confirming no surviving fixture database.
