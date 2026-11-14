# SOP — Committing changes & reflecting them to live production

**Audience:** every contributor. **Scope:** how a change goes from your editor to the live
system at https://erp.zetaclantech.com without breaking a live tenant or leaking data.

> This is a **live commercial multi-tenant SaaS**. Read [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
> and [`../SECURITY.md`](../SECURITY.md) first — the non-negotiables there override anything here.

---

**Contents**

- [0. Prerequisites (once per machine)](#0-prerequisites-once-per-machine)
- [Part A — Branch → commit → PR (everyone)](#part-a--branch--commit--pr-everyone)
- [Part B — Reflect the change to live production (owner / maintainers)](#part-b--reflect-the-change-to-live-production-owner--maintainers)
- [Keeping GitHub in sync with production](#keeping-github-in-sync-with-production)
- [Rollback](#rollback)
- [One-line summary](#one-line-summary)

## 0. Prerequisites (once per machine)

```bash
git clone https://github.com/amalnathkp13-boop/zenith-erp.git
cd zenith-erp
sh docs/infra/install-git-hooks.sh          # arm the pre-commit lint guards
```

Deploying to production additionally needs **SSH access to the prod host and the Docker deploy
setup**. The host and container details live in [`infra/README.md`](infra/README.md); SSH is
**key-based** (no passwords in the repo). **Ask the owner for access — do not deploy until you
have it and have been walked through it once.** Only the owner/maintainers deploy.

Set these once in your shell (values in `docs/infra/`):

```bash
SERVER=root@<PROD_HOST>          # from docs/infra/README.md
APP=deploy-moqui-1               # app container
DB=deploy-db-1                   # Postgres container (db: moqui / user: moqui)
```

---

## Part A — Branch → commit → PR (everyone)

### A1. Branch off `master`
```bash
git switch master && git pull
git switch -c feature/<short-name>       # or fix/… , chore/…
```
Never commit directly to `master`.

### A2. Make **one** logical change
- Keep the data layer and any write/billing path untouched **unless that is the change**.
- Preserve org isolation: every list/detail/JSON path scopes by `organizationPartyId`.
- CSS/JS under `zenithstatic/` changed? Bump the `?v=N` cache-bust in `ZenithApp.xml`.

### A3. Pre-commit safety pass (do this every time)
- [ ] No secrets in the diff (passwords, API keys, tokens, real `.env`).
- [ ] No customer/user/security data; no fabricated GSTIN/HSN/PAN/prices/stock.
- [ ] Billing/auth/org-isolation paths reviewed for safety.
- [ ] All test data purged (seed with a unique prefix → verify → delete by exact ids).

### A4. Commit (stage **explicit paths** — never `git add -A` / `.`)
```bash
git add component/<comp>/<path> [more explicit paths]
git commit -m "type: short subject

Why the change, and HOW it was verified (throwaway tenant, DB asserts, both surfaces)."
```
The pre-commit hook runs the lint guards (css-comments, party-picker,
cross-module-transitions, form-dom-collisions). **If a guard fails, fix the cause — never
`--no-verify`.**

### A5. Push & open a PR
```bash
git push -u origin feature/<short-name>
```
Open a PR against `master`, fill in the checklist (`.github/PULL_REQUEST_TEMPLATE.md`). The
`repo-guards` CI runs the same guards on GitHub and **cannot be skipped**. Get a review for
anything touching billing, auth, or org isolation. Merge to `master` after approval + green CI.

---

## Part B — Reflect the change to live production (owner / maintainers)

The running system is the Docker container on the prod host; git is the source of record. The
flow: **deploy the file into the container → persist the image → restart → verify → confirm the
git commit is the undo point.** The [`moqui-deploy`](infra/) scripts automate this; the manual
steps are below so you understand what they do.

### B1. Pre-flight — is it safe for live tenants?
Any billing-path change must be **no-op-safe for the flagship tenant** (MARUTHI, org `100000`).
Prove it on a **throwaway tenant** first (seed prefixed rows → exercise → assert DB → purge by
exact ids, residue 0). Never test a write path against a real tenant.

### B2. Deploy the changed file(s) into the container
Local `component/<comp>/<path>` ↔ container `/opt/moqui/runtime/component/<comp>/<path>`:
```bash
cat "component/<comp>/<path>" | ssh "$SERVER" \
  "docker exec -i $APP sh -c 'cat > /opt/moqui/runtime/component/<comp>/<path>'"
# confirm it landed:
ssh "$SERVER" "docker exec $APP sh -c 'grep -c <a-marker> /opt/moqui/runtime/component/<comp>/<path>'"
```

The `/qapps` framework wrapper is an exception to this component mapping. Its source is
`component/zenith-erp-saas/framework-overrides/webroot/screen/webroot/qapps.xml`, and its active
screen is `/opt/moqui/runtime/base-component/webroot/screen/webroot/qapps.xml`. The deployment
Dockerfile copies the tracked wrapper to that active path during a rebuild. For a file-only
wrapper deployment, maintainers must also update the active path before B3–B7; copying only the
component source does not activate it. Preserve the wrapper's login guard, and verify an
authenticated deep route such as `/qapps/zenith/Contacts/ContactsDashboard` stays on that screen.

### B3. Persist into the image (so a future recreate keeps it)
```bash
ssh "$SERVER" 'docker commit '"$APP"' zetaerp-moqui:latest && docker image prune -f'
```

### B4. Reload — **`restart`, NEVER `up -d`**
For the Inventory item-code reuse release, apply the [PostgreSQL migration](infra/db-migrations/2026-11-14-reuse-retired-product-codes.sql) during the maintenance window before starting the updated application. It replaces the old uniqueness indexes and keeps every product and barcode row.

`up -d` recreates the container and **discards uncommitted in-container edits** (and once filled
the disk → whole-site outage). Always:
```bash
ssh "$SERVER" 'cd /opt/deploy/deploy && docker compose restart moqui'
```

### B5. Poll until healthy (Moqui warms ~30–90s)
```bash
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" -u <user>:<pass> \
  "https://erp.zetaclantech.com/apps/zenith" --insecure); [ "$c" = 200 ] && { echo up; break; }; sleep 4; done
```

### B6. Static assets (CSS/JS) reminder
XML screens/services/entities + Groovy reload on restart. Assets under `zenithstatic/` are
served as-is — the `?v=N` bump in `ZenithApp.xml` (step A2) is what makes browsers refetch.

### B7. Verify on **both** surfaces
Render the change on **/apps** and **/qapps** and confirm ground-truth (DB state or the actual
UI), not a cached echo. Remove any test data you created.

### B8. Record the undo point
Make sure the corresponding commit is merged to `master` and pushed — that is your rollback
reference.

### Database access (read/verify)
```bash
echo "SELECT …;" | ssh "$SERVER" "docker exec -i $DB psql -U moqui -d moqui -P pager=off"
```
On the live DB, **DELETE only by exact captured ids**, never by a class predicate. An
unexpected FK block is a diagnostic — investigate, never force.

---

## Keeping GitHub in sync with production

**Rule: the repo must always reflect what is running in production.** Two things guarantee it:

1. **Every production change goes through git.** The deploy flow above is *deploy from the
   repo*, so a change only reaches production after it exists locally — and it is not "done"
   until it is **committed and pushed** (merged to `master` on GitHub). Never leave a deployed
   change unpushed.
2. **Never edit files directly inside the running container.** If an emergency hotfix ever *is*
   applied on the server, capture it back into the repo immediately:

   ```bash
   bash docs/infra/sync-from-live.sh
   ```

   It pulls the live container's source, writes any real drift back into the repo (ignoring
   CRLF/LF noise), lists new files, and prints `git status`. Review the diff (a hotfix must
   still be clean of secrets/customer data), then commit and push.

3. **A daily read-only audit watches for you.** `docs/infra/audit-live-sync.sh` compares the
   repo to the live container **without changing anything** and, on drift, drops a
   `ZENITH-SYNC-DRIFT.txt` marker on the owner's Desktop and logs to
   `~/.zenith-sync-audit.log`. It runs via the Windows Task Scheduler task
   **`ZenithLiveSyncAudit`** (daily, 9:00 AM). If that marker appears, run `sync-from-live.sh`,
   review, commit, and push. Re-register/adjust the schedule with `docs/infra/schedule-audit.ps1`.

> Verified in-sync check: the repo's source is compared to the live container content-only
> (line endings ignored). "In sync" means byte-identical source once CRLF/LF is normalised.

## Rollback

1. Revert the change in git (`git revert <sha>` on a branch → PR → merge) — never rewrite
   `master` history.
2. Redeploy the reverted file(s) via **B2–B5**.
3. Re-verify (**B7**).
Do **not** alter or renumber any already-issued bill/invoice as part of a rollback.

---

## One-line summary

**branch → change (one thing) → safety pass → commit explicit paths (hook lints) → PR + green
CI → merge → deploy file to container → `docker commit` → `docker compose restart` (never
`up -d`) → poll 200 → verify both surfaces → clean up test data.**
