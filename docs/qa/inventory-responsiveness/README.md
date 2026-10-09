# Inventory responsive verification

Baseline: merged `origin/master` at `44983553`, including the previous Inventory UI and functional fixes. This PR adds an Inventory scope wrapper (`display:contents`) and a dedicated containment stylesheet. It adjusts native form widths, compact Quasar gutters, facility/expiry pagers, the dashboard date picker and card breakpoints. The movement chart observes its actual available width. Open transfer menus appear above the floating Copilot launcher.

Existing colors, typography, desktop structure, data calculations and actions stay authoritative. Product, catalogue, warehouse, receiving, serial, forecast, stock, adjustment and gate pass services are unchanged. XML parameters, actions and transitions in both modified Inventory screens were compared with master and are identical. Screen XML parses, JavaScript syntax and all four repository guards pass.

## Coverage

`verify-layout.cjs` covers 23 screen/variant routes on both `/apps` and `/qapps`, at 320, 390, 600, 768, 900, 1024, 1280, 1440, 1920 and 2560 pixels. It checks document bounds and visible content while allowing wide tables to scroll inside their existing containers. This includes the dashboard, its three detail lists, products/edit product, catalogue/list members, facilities/edit facility, receiving/order detail, serial numbers, demand forecast, stock levels, transfers/new/edit, adjustments/edit, gate passes, the on-screen print preview and expiry risk. Print stylesheet and export layouts are unchanged.

`verify-interactions.cjs` opens and dismisses nine native dialogs at 320, 768 and 1440 pixels on both surfaces (54 checks), plus date pickers and expanded dashboard insights at four widths (16 checks). It never submits a business transaction or saved preference. `verify-menus.cjs` checks pointer hits on last-row product/transfer menu links and opens native filters (24 checks). Persistent native Quasar filter panels are dismissed by navigation without submitting.

The tests require Playwright through `NODE_PATH` and local `SMOKE_USER` / `SMOKE_PASS` environment variables. Optional: `RESPONSIVE_BASE_URL` (localhost only), `RESPONSIVE_ORGANIZATION` and `RESPONSIVE_OUTPUT`. Layout checks can select comma-separated `RESPONSIVE_SCREENS`; interaction checks can select `RESPONSIVE_CONTROLS_ONLY=1`; menu checks can also select `RESPONSIVE_SHELLS` and `RESPONSIVE_WIDTHS`. Results and screenshots default to ignored `tmp/responsiveness` folders. Third-party network requests are blocked during these browser tests; application assets and the real local Moqui renderers remain in use.

The initial desktop comparisons preserved the previous module layouts. Most images matched exactly; differences in others were confined to transient toolbar controls/badges, plus a small expiry-table hover detail. The dashboard follow-up below also corrects the narrow card widths left by the sidebar, while keeping the existing colors, data, links and desktop structure.

## Live resizing of the Inventory dashboard

User review identified a delay while shrinking the page that the original settled-width checks did not measure. The follow-up is confined to the Inventory dashboard. Its Quasar toolbar reserves rows directly through CSS, including the notification utilities, search and module tabs. Header/sidebar/content width transitions are disabled on this screen. Container breakpoints now size the icon/value columns from the actual available space; compact cards keep ordinary totals readable, and the three-plus-two KPI layout fills both rows.

Inventory chart SVGs scale immediately with their containers. Axis redraws run after a 120ms pause, with animations and the library's duplicate window/parent resize handlers disabled. Offscreen charts are not redrawn; additional charts initialize when their section is open and they enter the viewport. Closing/reopening and resizing do not submit any preference or business transaction. Chart series, warehouse/date calculations and protected XML actions/transitions remain unchanged.

`verify-dashboard-resize.cjs` checks repeated shrink/expand sequences from 320 to 2560px on both surfaces, with additional insights closed and open. It measures visible SVG fitting without a fixed settling delay, checks toolbar overlap and content reservations, verifies hidden chart deferral and opens the date controls after resizing. Run it with the same environment variables as the other local checks. Screenshots and detailed results remain in the ignored local output folder; `dashboard-resize-checks.json` records the verification summary.

## Local review data

Review `http://localhost:8080/qapps/zenith/Inventory/InventoryDashboard` (or `/apps/zenith/Inventory/InventoryDashboard`), with Local ERP Demo selected. Localhost contains the existing main-dashboard, stock-level and transfer samples plus supplemental `RESP_INV_*` samples for catalogues, receiving, serial numbers, forecasts, pending adjustments, gate passes and expiry.

`preview-local.sql` is an optional manual local seed. It requires the demo database/organization, refuses duplicate product IDs, imports atomically, uses no legal identifiers and is never loaded automatically by the application. Restart local Moqui after importing to refresh entity caches. The sample asset quantities and opening ledger entries agree. An ignored local database backup was captured before importing.

The samples remain at the user's explicit request until visual review ends. `preview-cleanup-local.sql` removes the exact supplemental IDs afterward; a rollback-only dry run verified all deletion paths without removing the review data. New user-created references may make cleanup fail safely on foreign keys. Existing main-dashboard/stock/transfer samples are outside that cleanup's scope.

GitHub Actions for the dashboard PR could not start because the repository account's payments/spending limit blocked runner allocation. Local guards and runtime checks are recorded independently; GitHub CI status must be assessed separately.
