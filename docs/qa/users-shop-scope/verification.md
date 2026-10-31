# Verification — Users, roles, and shop grouping

Candidate: `feat/users-access-shop-scope-20261031`, based on master `1c2f8b95`.

## Actual results

- Fresh native Moqui/JDK 21 runtime booted successfully with candidate components and
  a new in-memory H2 database. HTTP and database listeners were bound to loopback;
  jobs, email, and search delivery were disabled.
- **65 browser/database acceptance checks passed**, covering Bootstrap `/apps` and
  Quasar `/qapps`, desktop and 390px layouts. No browser JavaScript exceptions occurred.
  See [the check list](evidence/acceptance.json).
- The actual shop resolver and switch transition passed synthetic source regressions.
  The original resolver returns the orphan third facility instead of two registered
  shops; the original switch transition retains a stale counter and loses Quasar's shell.
- The actual saved-role link failed with FreeMarker's unset URL charset, then passed
  after explicit UTF-8 encoding. The regression also checks escaped role names.
- All four repository lint guards passed; all three changed JavaScript assets passed
  `node --check`; affected XML parsed successfully; `git diff --check` passed.
- Existing POS clock regression passed. Existing clean-workspace conversion suite:
  **13 tests passed**. This repository has no root `package.json`, so `npm run test`
  and `npm run build` are not available project commands; native boot and browser
  verification were used for this Moqui application.
- An additional isolated probe confirmed a selected custom role can open its POS
  Dashboard without the optional All Employees membership.

## Permission and data checks

Role creation persisted the exact selections without creating memberships. Saved roles
reopened through their Users-page links with the same selections. Duplicate names
(case insensitive), empty selections, unknown screens, missing CSRF, foreign edits,
foreign assignments, and last-administrator removal were rejected. The same role name
was accepted in a different organization.

Primary-key entity lookup behavior required an explicit ownership check on returned
role records. A separate private entity authorization rule prevents the generic entity
API from bypassing the role services. Both a restricted user and a tenant administrator
were blocked from reading another organization's role through that API. Unselected
screen and write requests were blocked; Quasar's selected page and navigation loaded.

Two registered shops, three counters, and multiple operators produced totals of 30,
40, and 70 for shop one, shop two, and combined respectively. Shop one included both
its counters; shop two excluded them. Amounts of the three pre-existing synthetic bills
remained 10, 20, and 40 throughout. No issued bill was edited or renumbered.

The isolated JVM was stopped after verification. HTTP 18086 and H2 19098 had no
listeners; a TCP reconnect with `IFEXISTS=TRUE` failed with connection refused. Thus
all in-memory fixture records were disposed. No production records were written.

## Review and deployment limits

Synthetic [Users preview](evidence/users.png) and [Create role preview](evidence/role-editor.png)
retain the existing shared navigation and background. Screenshots contain disposable
fixture identities only. Physical Safari/Edge verification was not performed.

The normal schema/seed update is required for the new entity, its organization filter,
and the private entity-API authorization rule. No deployment or merge was performed.
Existing platform roles and cashier-history rules remain in place. GitHub CI status
must be checked on the opened PR's current revision.
