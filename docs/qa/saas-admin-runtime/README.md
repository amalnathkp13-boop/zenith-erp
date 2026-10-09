# Disposable SaaS Admin dated-plan verification

This harness tests the real Moqui services/screens against a fresh, labelled local database. Never install `qa-screen.xml`, seed fixtures, or `MoquiConf.xml` in production.

## Run

Requirements: Docker, Python 3, and approved image `zetaerp-moqui:clean-staging` from release `staging-image-clean-v1`. No production credentials/database are used.

```sh
sh docs/qa/saas-admin-runtime/run.sh start
sh docs/qa/saas-admin-runtime/run.sh test
sh docs/qa/saas-admin-runtime/run.sh stop
```

The runner refuses an existing QA project. HTTP is loopback-only at port 18087, PostgreSQL lives in tmpfs, and no named volumes are mounted. Tests use October 2026 seed dates; outside that month, refresh/review the synthetic fixture period before rerunning (the test intentionally refuses stale dates).

Synthetic IDs are `SAASADMIN_QA_*`: A active owner account, B unselected tenant, T trial, S suspended; membership and inactive records exercise usage/isolation. Existing public CI billing/isolation fixtures are seeded solely in this empty DB. The QA helper is protected by `saasadmin.qa.disposable=true`, allowlisted demo users, ADMIN initialization, CSRF, and a synthetic-ID check. Initialization copies the public demo password hash only inside this disposable stack.

## Evidence

- `baseline.json`: old behavior reproduced before edits; live form inspected read-only.
- `services-summary.json`: 68 service/HTTP/database checks, all passed.
- `browser-summary.json`: actual browser form submissions and measured responsive layouts, both surfaces.
- `source-parity.json`: byte parity for every changed runtime component file.
- `preview-*.jpg`: synthetic/public-demo UI previews only.
- `cleanup.json`: labelled containers, networks and volumes removed; no customer stack touched.

Raw loader/server logs and session tokens stay under `/tmp/zenith-saas-admin-qa/results` and are not committed. Report: `../saas-admin-manual-plans-audit.md`.

## Mandatory cleanup

Use the runner's `stop` command after testing, even on failure. It checks project labels and removes only `zenith-saas-admin-qa`. Removing the tmpfs DB and Moqui container also removes generated subscriptions, invoices, users, sessions and transaction journals. Confirm zero containers, networks and volumes with that project label. Do not use a global Docker prune or delete anything on the live database.

## Latest author re-verification

`author-reverification.json` records fresh service/browser checks, tracked-component parity and destroyed memory database. The protected organization guard is exercised on an isolated synthetic tenant pointing at synthetic party 100000, never on a production connection. Actual form submissions on both surfaces are checked through independent JDBC, with financial/protected/foreign rows unchanged.

The additional `acceptance-native.py`, `SaasAdminNativeDb.java` and `verify-native-browser.cjs` support an explicitly opted-in native harness (`SAASADMIN_NATIVE_QA=true`) only at loopback HTTP 18085 / H2 19097, named memory `purchase-pricing-qa`, requiring the synthetic fixture before any database access. Java/Python/Chrome and output paths are passed through the documented `SAASADMIN_NATIVE_*` and `SAASADMIN_QA_OUT` variables. The JDBC helper accepts SELECT and only the exact fixture mutations needed by acceptance; it has no production URL override. Use a newly seeded disposable JVM and destroy it after verification; confirm both listeners disappear and an IFEXISTS reconnect fails.

The public rebuilt framework emitted raw multi-extension FreeMarker during one browser attempt. `native-MoquiConf.xml` explicitly registers its qvt.ftl and xsl-fo.ftl renderers in the QA fixture component for this native run. The normal pinned-image runner continues to use `MoquiConf.xml`. Neither QA configuration nor fixtures are deployment inputs. This native proof supplements, and does not replace, pinned Linux/PostgreSQL CI or owner financial acceptance.

The unconfirmed legacy payment callback is expected to be rejected, matching master #44's payment confirmation requirement. No payment/authentication protection is removed to accommodate old test expectations.
