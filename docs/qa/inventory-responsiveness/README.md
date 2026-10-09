# Inventory responsive verification

Baseline: merged `origin/master` at `44983553`, including the previous Inventory UI and functional fixes. This PR adds an Inventory scope wrapper (`display:contents`) and a dedicated containment stylesheet. It adjusts native form widths, compact Quasar gutters, facility/expiry pagers, the dashboard date picker and card breakpoints. The movement chart observes its actual available width. Open transfer menus appear above the floating Copilot launcher.

Existing colors, typography, desktop structure, data calculations and actions stay authoritative. Product, catalogue, warehouse, receiving, serial, forecast, stock, adjustment and gate pass services are unchanged. XML parameters, actions and transitions in both modified Inventory screens were compared with master and are identical. Screen XML parses, JavaScript syntax and all four repository guards pass.

## Coverage

`verify-layout.cjs` covers 23 screen/variant routes on both `/apps` and `/qapps`, at 320, 390, 600, 768, 900, 1024, 1280, 1440, 1920 and 2560 pixels. It checks document bounds and visible content while allowing wide tables to scroll inside their existing containers. This includes the dashboard, its three detail lists, products/edit product, catalogue/list members, facilities/edit facility, receiving/order detail, serial numbers, demand forecast, stock levels, transfers/new/edit, adjustments/edit, gate passes, the on-screen print preview and expiry risk. Print stylesheet and export layouts are unchanged.

`verify-interactions.cjs` opens and dismisses nine native dialogs at 320, 768 and 1440 pixels on both surfaces (54 checks), plus date pickers and expanded dashboard insights at four widths (16 checks). It never submits a business transaction or saved preference. `verify-menus.cjs` checks pointer hits on last-row product/transfer menu links and opens native filters (24 checks). Persistent native Quasar filter panels are dismissed by navigation without submitting.

The tests require Playwright through `NODE_PATH` and local `SMOKE_USER` / `SMOKE_PASS` environment variables. Optional: `RESPONSIVE_BASE_URL` (localhost only), `RESPONSIVE_ORGANIZATION` and `RESPONSIVE_OUTPUT`. Layout checks can select comma-separated `RESPONSIVE_SCREENS`; interaction checks can select `RESPONSIVE_CONTROLS_ONLY=1`; menu checks can also select `RESPONSIVE_SHELLS` and `RESPONSIVE_WIDTHS`. Results and screenshots default to ignored `tmp/responsiveness` folders. Third-party network requests are blocked during these browser tests; application assets and the real local Moqui renderers remain in use.

Desktop 1440px screenshot comparisons show the existing module layouts are preserved. Most images match exactly; differences in others are confined to transient toolbar controls/badges, plus a small expiry-table hover detail. Dashboard content, cards and chart geometry match the previous layout at desktop width. Source changes are limited to containment, chart sizing and menu layering.

## Local review data

Review `http://localhost:8080/qapps/zenith/Inventory/InventoryDashboard` (or `/apps/zenith/Inventory/InventoryDashboard`), with Local ERP Demo selected. Localhost contains the existing main-dashboard, stock-level and transfer samples plus supplemental `RESP_INV_*` samples for catalogues, receiving, serial numbers, forecasts, pending adjustments, gate passes and expiry.

`preview-local.sql` is an optional manual local seed. It requires the demo database/organization, refuses duplicate product IDs, imports atomically, uses no legal identifiers and is never loaded automatically by the application. Restart local Moqui after importing to refresh entity caches. The sample asset quantities and opening ledger entries agree. An ignored local database backup was captured before importing.

The samples remain at the user's explicit request until visual review ends. `preview-cleanup-local.sql` removes the exact supplemental IDs afterward; a rollback-only dry run verified all deletion paths without removing the review data. New user-created references may make cleanup fail safely on foreign keys. Existing main-dashboard/stock/transfer samples are outside that cleanup's scope.

GitHub Actions for the dashboard PR could not start because the repository account's payments/spending limit blocked runner allocation. Local guards and runtime checks are recorded independently; GitHub CI status must be assessed separately.
