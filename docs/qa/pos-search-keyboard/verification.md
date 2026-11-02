# POS search and keyboard verification

## Behavior

The shared product search keeps a typed trailing word separator: `pp ` selects
names containing that phrase, rather than silently becoming the infix `pp`.
Leading/repeated whitespace is normalized. Product-name prefix matches rank ahead
of infix matches before pagination. Dropdowns expose up to 60 matches; the grid
retains Load more for remaining results. Item codes and barcode aliases remain
supported, with literal percent/underscore handling and explicit organization scope.
Checkout and both history editors use the same server search.

Changing or clearing the search invalidates old replies immediately. Selecting a
product or pressing Escape cancels pending dropdown work. Clearing restores the
cached All Items grid while its authorized refresh runs.

At the quantity field's left caret boundary, Left moves to the rate's end. At the
rate's right boundary, Right moves to quantity's start. Ordinary caret movement,
text selections, modifier arrows, validation, and Enter rate -> quantity -> search
are retained. Quantity remains decimal-capable with the existing validated save path.

## Actual checks

- Before patch: original lookup returned Appalam entries for `pp `; blank search
  returned suggestions; repeated whitespace and prefix ranking failed. Original
  browser handlers failed trailing-space, cleared/stale reply and arrow-navigation
  regressions. No production records were used.
- After patch: 33 focused runtime checks passed against real Moqui/H2, including
  both /apps and /qapps search APIs, 67 PP variants across two grid pages, code
  lookup, escaped wildcards, foreign-org exclusion, and read-only search snapshots.
  The /apps browser workflow confirms rate 15 x quantity 2.5 = line total 37.50
  using an independent SELECT-only database probe.
- 12 production-handler browser regressions passed in installed Chrome and Edge,
  including delayed replies, clearing, selection, Escape, both history editors,
  caret boundaries and preserved Enter navigation.
- Existing catalog performance/safety suite: 36 checks passed, including CSRF,
  foreign sessions, shop/mode prices, rapid additions, retained drafts and keyboard
  quantity entry. Existing catalog navigation races/failure recovery: 5 passed.
- Four repository guards, modified XML parsing and JavaScript syntax passed.

## Limits and cleanup

Full interactive /qapps SPA verification was blocked by a local renderer stall
that also occurs with the pre-change pos-terminal.js. Both /qapps JSON search
paths passed; this does not certify a complete /qapps interactive billing flow.
CI results are recorded separately on the PR. No deployment was performed.

All fixtures were synthetic POS_QA records in a disposable loopback, in-memory
runtime. The process was stopped after verification; an IFEXISTS database
reconnection failed, confirming that test data did not remain available.

## Re-run

Use the disposable setup described in docs/qa/pos-runtime, with its QA helper and
fixture files installed. Run check-search-keyboard.cjs with Playwright and an
installed Chrome (or POS_QA_CHROME for Edge). Run verify-search-keyboard.cjs on a
fresh initialized runtime with POS_QA_NATIVE_ROOT, POS_QA_JAVA and POS_QA_OUT set.
The verifier refuses non-loopback URLs and uses the existing SELECT-only DB probe.
Stop the in-memory runtime and verify IFEXISTS reconnection fails afterward.
