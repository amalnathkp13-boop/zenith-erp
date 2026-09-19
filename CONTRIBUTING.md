# Contributing to ZetaERP

Welcome to the team. This is a **live, proprietary, multi-tenant SaaS** with real customer
data, so contributing here comes with a few hard rules that protect customers and the business.
Please read this fully before your first change.

---

## The non-negotiables

These are not style preferences — breaking them can leak customer data, corrupt billing, or
take the site down.

1. **Never commit secrets.** No passwords, API keys, tokens, private keys, or real `.env`
   files. Config lives in the server's `.env` and in the app's `CompanySettings`, never in git.
   `.env` is git-ignored; keep it that way. If you ever commit a secret by accident, tell the
   owner immediately — it must be rotated, not just deleted.
2. **Never expose** security / user / password / customer data in code, commit messages,
   issues, PRs, or screenshots.
3. **Never fabricate** business or legal data (GSTIN, HSN, PAN, prices, stock, tax rates) —
   ask the owner for the real value.
4. **Billing paths must be no-op-safe for live tenants.** Verify before/after on a **throwaway
   tenant**, never on the flagship tenant (MARUTHI, org `100000`) or any real one.
5. **Clean up all test data** after verifying — seed with a unique prefix, verify, then purge
   by exact ids. `docs/infra/purge-tenant.sh` helps.
6. **Never alter or renumber an already-issued bill / invoice.**
7. On the live DB, **DELETE only by exact captured ids**, never by a class predicate. An
   unexpected FK block is a diagnostic — investigate, never force through.
8. **Never** stage with `git add -A` / `git add .` — stage explicit paths (or `git add -u`).

## Architecture you must know

- **Two surfaces, one source.** Screens render on **/apps** (Bootstrap 3) and **/qapps**
  (Quasar SPA). They do not share CSS utility classes, and **/qapps strips `<script>` and
  `<style>` tags** — bootstrap client JS there with an `<img onload>` attribute.
- **Org isolation is mandatory.** Every list/detail/JSON transition must scope by
  `organizationPartyId` (screen transitions run *outside* the active-org entity filter, so scope
  them explicitly). Use the org-scoped `PartyPicker` include, never the stock `searchPartyList`.
- **Moqui gotchas** (hard-won): `<else-if>` must nest its actions; `type="date"` is
  day-granular so add a `-lastUpdatedStamp` tiebreaker; inside `<![CDATA[ ]]>` Groovy use
  literal `&&` and `<`, but in plain XML attributes use `&amp;&amp;` / `&lt;`.

## Branch & PR workflow

1. Branch from `master`: `git switch -c feature/<short-name>` (or `fix/…`, `chore/…`).
2. Make one logical change. Keep the data layer and the write path untouched unless that *is*
   the change.
3. Commit with a clear message: a `type: subject` summary line, then a body explaining **why**
   and **how it was verified**.
4. Push and open a PR against `master`. Fill in the PR checklist
   (`.github/PULL_REQUEST_TEMPLATE.md`).
5. Get a review. Do not merge your own PR without one for anything touching a billing, auth,
   or org-isolation path.

## Lint guards & git hooks

Static guards catch the most common footguns. **Arm them once per clone:**

```bash
sh docs/infra/install-git-hooks.sh
```

The pre-commit hook runs the guards in `docs/infra/`:

| Guard | Catches |
|---|---|
| `lint-css-comments` | a stray `*/` in a CSS comment (kills the next rule) |
| `lint-party-picker` | a non-org-aware party lookup (cross-tenant leak) |
| `lint-cross-module-transitions` | unregistered cross-module transition calls |
| `lint-form-dom-collisions` | a form control named after a Vue-render DOM property |

The hook is bypassable locally with `--no-verify`, so the **same guards also run in GitHub
Actions** (`.github/workflows/repo-guards.yml`) on every push and PR, where they **cannot be
skipped**. A red check blocks the merge — fix the cause, never work around it.

### Don't push straight to `master`

All `master` changes go through a **pull request** — **no exceptions, including the owner**. A
CI guard (`.github/workflows/no-direct-push.yml`) runs on every push to `master` and **fails
with a red check** if the commit did not arrive via a PR. If you see that red check on your
commit, you pushed directly — move the work onto a branch and open a PR. *(On the current
GitHub plan this is an after-the-fact signal, not a hard block; full enforcement needs GitHub
Pro branch protection. An `ALLOWLIST` in the workflow can exempt specific maintainers, but it
is intentionally empty — strict for everyone.)*

## Deploy pipeline (owner / maintainers)

Source lives here; the running system is a Docker container on the server. The flow is: edit
locally → deploy the file into the container → commit the image to its tag → **`docker compose
restart`** (never `up -d`, which discards uncommitted in-container edits) → poll for 200 →
verify on both surfaces → `git commit` here as an undo point.

**Full step-by-step runbook: [`docs/SOP-commit-and-deploy.md`](docs/SOP-commit-and-deploy.md)**
(commit → PR → deploy → verify → rollback). Scripts are in `docs/infra/`. **Server access and
credentials are not in this repo** — ask the owner.

Static assets (CSS/JS under `zenithstatic/`) are cache-busted via a `?v=N` query in
`ZenithApp.xml`; bump it when you change them.

## Verifying a change

- Prove it on **ground-truth DB state**, not on a page echoing your own edit (caches lie).
- For write paths: seed a throwaway tenant with a unique prefix, exercise the path, assert the
  DB changed as expected, then purge by exact ids and confirm zero residue.
- Confirm both **/apps** and **/qapps** render correctly.

## Commit message trailer

Commits authored with AI assistance end with the appropriate `Co-Authored-By:` trailer. Match
the existing history style.

---

Questions about any of this? Ask the owner before you push — it is always cheaper than a
rollback.
