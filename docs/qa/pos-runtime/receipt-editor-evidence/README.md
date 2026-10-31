# Receipt editor and Hold/QZ verification

This update extends PR #164. It preserves the existing sidebar, toolbar, store selector and subnavigation. Only receipt-editor content and the existing receipt/print data path change.

## Implemented

- Normal, Credit / Pay Later and Edited / Revised editor links. Each design saves its own text and presentation options. Blank credit/revised text inherits normal text. A revised credit bill retains both revision and credit/amount-due markers.
- Collapsible settings cards, live shared-layout preview, 58/80mm selectors, confirmed deletion, Cancel and reachable Save actions.
- Optional greeting presets/custom Unicode message, alignment, emphasis and size; bill/customer/cashier labels and visibility; existing company/logo/display settings; nine section tones and print emphasis.
- Safe black/standard defaults; important bill information and amounts retain contrast. Payment rows follow the saved display setting. The compact-receipt QA fixture explicitly selects No, with a separate positive test for Yes.
- Template selection first uses the transaction terminal's shop, then the organization-wide fallback. Defaults are independent per shop. Inactive and foreign-shop templates cannot be selected.
- Preview, checkout and history use one escaped HTML layout. Saved tax-summary components are displayed without inventing CGST/SGST splits. The PDF preserves the actual document type even when tax rows are hidden.
- No bill numbers, invoice sequences, prices, quantities, taxes or payments are changed by template edits or rendering.

## Database compatibility

The existing `PosReceiptTemplate` gains eight nullable fields: `facilityId`, six credit/revised header/footer/terms overrides, and `receiptOptionsJson`. Normal fields keep their existing names. Missing options receive compatible defaults. Moqui's standard schema update must add these columns during the owner's normal deployment process; no production migration or data reset was run here.

Updates validate presentation keys, types, lengths, paper sizes and owned shop IDs. Partial changes preserve other designs, ownership and discount-approval settings. Organization locks serialize editor writes/default changes. Server-side module-write, record ownership and CSRF checks remain required.

## Reproductions and automated coverage

- On the main-branch printer code, actual F7 Hold/reload produced one QZ connection and zero print jobs. The regression fails on that version; Hold is required to produce zero connections and zero jobs after the fix. QZ is a mock, never a workstation printer.
- Before the template change, the receipt-design test failed because Edit Normal / Credit / Revised controls were absent.
- The focused disposable HTTP/UI suite covers both shells; 1440/1024/768/390px widths; live greeting/labels/visibility/paper preview; actual form Save; independent persistence; invalid input, CSRF, foreign organization and view-only denials; normal/credit/revised receipts; revised credit; unchanged bill money; PDF; shop fallback, inactive/deleted templates and no-template output.
- Static checks cover 16 normal/credit/revised tax-on/off HTML outputs, escaping, Unicode preview, selected display settings, paper widths, contrast and data immutability. Printer-routing checks include 58mm QZ configuration, permission waits, retry, disconnect, cancellation and explicit fullscreen browser fallback.
- Four repository guards, XML parsing, JavaScript syntax and whitespace checks pass. This Moqui repository has no root npm test/build scripts.

Local actual results: receipt editor 78/78, F7 Hold 15/15, existing history/printing 78/78; all passed. See `local-results.json`. GitHub Actions links for the new commit are recorded in the PR description after verification. Earlier successful CI runs are not evidence for the new commit.

## Hardware and deployment limits

No physical printer model was available for this automated run. QZ tests use a fake printer and never send a physical job. The existing QZ pixel/HTML driver path supports the shared layout; grey approximation and Unicode glyph availability still require a test on the installed driver/printer. Density in this editor adjusts text emphasis; hardware heat/density remains a driver setting. Raw ESC/POS/code-page support is not fabricated.

The legacy thermal PDF renderer has bundled Latin fonts. If a visible receipt value needs other glyphs, it emits a clear compatibility notice directing the operator to browser/QZ printing instead of silently outputting missing-glyph boxes. Remote logos are rendered by the browser/QZ path; the existing PDF path does not fetch arbitrary remote images. There is no new file-upload/storage service.

Prompt-free actual QZ printing still requires the deployment's valid certificate/signing setup. Installing QZ or clicking Allow does not replace that setup. No trust prompt is bypassed, no private signing key is committed, and no merge/deployment was performed.
