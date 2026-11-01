# Users, organization roles, and shop scope verification

The changes share the existing Zenith application and database. The sidebar, topbar,
and background retain the shared theme. Only Users/role-editor content has new styles.

## Behavior

- Users combines name/email, status, and role filters. Existing account edit, password
  reset, two-factor reset, enable/disable, delete, and CSV transitions remain available.
- Create role opens an organization-owned module/submodule editor. Its catalogue comes
  from mounted screens and the active plan. Enabling a module does not select children.
  Selecting a submodule includes its nested workflow screens and transitions.
- Save validates the catalogue again, rejects empty/unknown selections and duplicate
  names within the organization, and never assigns the role automatically. Custom roles
  can be reopened from Users, then assigned through Manage roles.
- Built-in roles remain supported. Selecting Settings does not bypass its administrator guard. Additional custom roles combine their selections.
  Built-in read-only access does not become write access when combined with a custom role.
- Custom roles are checked on server requests as well as navigation. Quasar's shell
  templates, menu metadata, and current-user organization bootstrap retain their specific
  read paths; arbitrary entity REST reads do not inherit a selected screen's permission.
- Registered Shops determine the switcher's shop list. Organizations without registered
  Store records retain the legacy facility list. No facility or historical bill is deleted.
- A shop selection clears a stale dashboard counter selection while preserving the
  shell, date, and chart filters. Shop totals include all sessions of that shop's counters.
  Cashier bill-history permission rules are unchanged.

## Disposable integration test

Never install `qa-screen.xml` into a live runtime. It is a test helper gated by the JVM
property `users.scope.qa.disposable=true`, synthetic administrator identities, and
synthetic organizations. The browser verifier also refuses every origin except
`http://127.0.0.1:18086`.

Use the existing clean staging/runtime preparation documented under `docs/infra/ci`
and `docs/qa/pos-runtime`. Overlay the candidate `component/` tree into a fresh runtime.
Use a new in-memory H2 database, public demo/seed data, disabled jobs/email/search,
and bind HTTP and database listeners to loopback. Do not copy a live database,
credentials, signing key, or production image layer.

Install the existing POS disposable fixture helper and fixture files as documented in
`docs/qa/pos-runtime`. Copy this directory's `qa-screen.xml` only to the isolated runtime's
`component/zenith-erp-settings/screen/zenith/settings/Settings/AccessQa.xml`.
Start with both `pos.qa.disposable=true` and `users.scope.qa.disposable=true` JVM properties.

With Playwright available to Node, run from the repository root:

```sh
node docs/qa/users-shop-scope/verify-runtime.cjs
```

The verifier initializes the fixture once, creates synthetic organization roles and an
account with a generated temporary password, exercises both Bootstrap and Quasar,
checks stored records and authorization failures, verifies shop totals, and writes
screenshots plus `report.json` under `output/users-shop-scope`. Do not commit the output
directory wholesale. `USERS_QA_SKIP_INIT=1` is only for diagnosing the same disposable
fixture; the final acceptance run must use a fresh database without this flag.

Stop the exact isolated JVM when finished. Verify both listeners have closed and that
the in-memory database cannot be reconnected to using `IFEXISTS=TRUE`. This disposes
all fixture records without applying a purge to any persistent customer database.

## Small source regressions

With the runtime's Groovy/XML libraries on the Java classpath:

```sh
java -cp 'WEB-INF/lib/*:execlib/*:runtime/lib/*' groovy.ui.GroovyMain \
  docs/qa/users-shop-scope/check-scope.groovy .
```

Use `;` instead of `:` between classpath entries on Windows. This evaluates the actual
production resolver and switch transition against synthetic query doubles. The original
resolver fails the two-registered-shops assertion (it returns the orphan third facility).
The original switch transition fails the stale-counter and Quasar-shell assertions.

Run `check-role-template.groovy` with the same classpath to render the actual saved-role
link. It reproduces the missing FreeMarker URL charset failure and verifies the explicit
UTF-8 fix plus escaped role names.

## Deployment/review notes

The new `OrganizationAccessRole` entity and private entity-API deny rule need the normal schema/seed update used by
the deployment process, including its organization EntityFilter. No production schema,
shop registration, role assignment, subscription, or account is changed by this PR itself.
The new enforcement is opt-in for `ZENITH_ORG_` roles; existing platform roles keep their
existing behavior. Review authentication and organization boundaries before merging.
