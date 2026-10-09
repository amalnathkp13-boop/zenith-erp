# Main dashboard responsive verification

Baseline: `origin/master` at `44983553`, including the previously merged UI and functional fixes. This change only adjusts scoped dashboard CSS and increments its stylesheet version. The dashboard XML, JavaScript, services, permissions, links and write paths are unchanged.

The date picker now stays inside the available header width. The module navigation gives way to the sidebar on laptop widths before it can overflow. Cards respond to the content width remaining beside the sidebar; period buttons and customization controls fit compact layouts. Large totals and long labels wrap inside their existing rows.

Run `verify-layout.cjs` with Playwright available through `NODE_PATH`, and `SMOKE_USER` / `SMOKE_PASS` set to the local demo credentials. Optional environment variables: `RESPONSIVE_BASE_URL` (localhost only), `RESPONSIVE_ORGANIZATION`, and `RESPONSIVE_OUTPUT`. The script writes checks and screenshots into the ignored `tmp/responsiveness/dashboard` directory by default. It does not submit customization changes or business transactions.

Verification on 9 October 2026 covers both `/apps` and `/qapps` at 320, 360, 390, 600, 768, 820, 1024, 1280, 1366, 1440, 1920 and 2560 pixels, including open date pickers, compact half/third widget layouts and long labels/totals. Desktop 1440px screenshots were byte-identical to the baseline before the additional long-text wrapping rules; the normal desktop card structure, colors, typography and data are preserved. The existing `docs/infra/ci/home-dashboard-regression.mjs` also passes authentication, invalid/reversed/long date ranges, monthly buckets, filter context and all six action destinations. All four repository guards pass.

Review: `http://localhost:8080/qapps/zenith/Dashboard` (or `/apps/zenith/Dashboard`), with Local ERP Demo selected. Existing explicitly requested `PREVIEW_HOME_*` synthetic data remains in the local database for review. No production database is used and no sample data is loaded automatically by this change. Sample cleanup is intentionally deferred until the user finishes visual review.
