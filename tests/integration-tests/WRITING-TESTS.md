# Integration tests — how they work & how to add them

End-to-end Playwright tests that run against a **live DIGIT deployment** (no mocking).
The same suite must pass on **any** deployment — a DIGIT 3.0 workspace (flat tenant,
reached at `/<workspace-slug>/digit-ui/…`), local Maputo (`mz.maputo`), bomet Kenya
(`ke`), etc. That "deployment-agnostic" rule is the single most important thing to
understand before writing a test. Each deployment is described by an environment folder,
`environments/<name>/` (see §7).

---

## 1. Layout

```
tests/integration-tests/
  playwright.config.ts        # projects, timeouts, workers
  tests/
    citizen/  employee/  admin/   # UI specs, grouped by who uses the screen
    api/  smoke/                   # API-only specs (token-injection auth)
    keycloak/  lifecycle/  specs/  onboarding-real/  identity-real/
    fixtures/                      # SETUP projects (run before specs) + auth files
    utils/                         # env, profile, probes, personas, seed, helpers
  scripts/                    # build-catalog.ts (dashboard), tag-tests.ts (tagging)
```

## 2. How a run works (the pipeline)

Every `npx playwright test` runs these **setup projects first** (declared as project
dependencies in `playwright.config.ts`), then the spec projects:

1. **`profile-setup`** → writes `deployment-profile.json`. Interrogates the *live*
   deployment once (`utils/profile.ts` `discoverProfile()`): tenant + label (from
   localization), boundary hierarchy shape + a proven leaf, complaint types, PGR
   workflow actions, mobile regex, postal pattern, populated locales, the **seed plan**
   (serviceCode + localityCode + idPrefix), and the resolved **personas** (logs each in,
   records which tenant accepted it). It **hard-asserts** the anti-vacuous-pass guards
   (rows 1, 3, 4, 5, 6 in §3) so an empty stack fails loudly instead of skipping green.
2. **`setup`** (configurator sign-in as ADMIN via `utils/configurator-auth.ts`
   `loginConfigurator`: Keycloak + the Identity BFF, then the configurator context →
   `auth.json` with the BFF session cookie and the selected DIGIT context; it asserts
   DIGIT accepts the token).
3. **`api-setup`** (`utils/auth.ts` `loginViaApi`, signs in through the BFF, no UI →
   `auth-api.json`; used by `api` + `smoke`).
4. **`citizen-setup`** (one fresh citizen per run via the BFF OTP flow →
   `citizen-fixture.json`; the OTP is the fixed `IDENTITY_TEST_OTP_CODE` or is read from
   `IDENTITY_TEST_OTP_SINK_URL`).
5. **`lifecycle-setup`** (seeds 3 complaints → `lifecycle-fixtures.json`: one
   non-terminal at `PENDINGFORASSIGNMENT`, one assigned at `PENDINGATLME`, one walked
   ASSIGN→RESOLVE→RATE to `CLOSEDAFTERRESOLUTION` rating=4). Always files as a CITIZEN
   (APPLY is `[CITIZEN, CSR]` everywhere). If no viable seed triple exists it writes a
   `status: skipped` marker and **passes** — downstream specs fall back to their own
   env/historical defaults rather than cascade-failing.

Then the spec projects run: **`chromium`** (all UI specs), **`api`** (`tests/api`),
**`smoke`** (`tests/smoke`). `@local-only` specs run only when `LOCAL_STACK=1`.

`utils/env.ts` reads `deployment-profile.json` **synchronously at import time** — that
ordering (a project dependency, not a `beforeAll`) is why any spec that imports a value
from `env.ts` is automatically deployment-correct.

**Fixture files written to the suite root** (shared, per-invocation state):
`deployment-profile.json`, `auth.json`, `auth-api.json`, `citizen-fixture.json`,
`lifecycle-fixtures.json`. Because they're shared, **`workers: 1`** and you must **never
run two `npx playwright test` invocations against the same stack at once** — they
clobber each other's profile + auth + seed fixtures.

## 3. Data a deployment must have

The suite *discovers* these live (§2) rather than hardcoding them — but discovery can
only find what the deployment was seeded with. If a row is missing, the paired setup
step either **hard-fails** (suite stops) or **self-skips** (that capability's specs
skip, not fail).

| # | Data | Service / MDMS | Missing → | Guard |
|---|------|----------------|-----------|-------|
| 1 | Tenant hierarchy: root + city (e.g. `mz` / `mz.maputo`) | tenant-management | can't resolve TENANT | hard-fail |
| 2 | City display label `TENANT_TENANTS_<CITY>` in `en_IN` | localization | login combobox spins → 120s timeout | warn (falls back to guess) |
| 3 | Boundary hierarchy, ≥2 levels, ≥1 leaf node | boundary-service + MDMS boundary | no complaint can be filed | **hard-fail** |
| 4 | PGR `BusinessService` **at the city tenant**, ≥1 action | egov-workflow-v2 | no workflow to drive | **hard-fail** |
| 5 | Complaint types (`RAINMAKER-PGR.ServiceDefs` / `ComplaintHierarchy`) at city | MDMS v2 | nothing to file | **hard-fail** |
| 6 | An **employee persona** the seed plan can use: a GRO actor + a PGR_LME assignee whose HRMS department matches a complaint type's department | egov-hrms | ASSIGN 400s `DEPARTMENT_NOT_FOUND`; setup can't seed | **hard-fail** (employee persona), else lifecycle self-skips |
| 6b | **Escalation suite only:** ≥2 *more* employees in the seed complaint-type's department (≥3 total incl. the assignee), to build the 2-level `reportingTo` chain | egov-hrms | `pgr-escalation` tests 3–12 self-skip | self-skip |
| 7 | `MobileNumberValidation` regex | common-masters MDMS | phone gen falls back to `7`-lead (Kenya) | degrades |
| 8 | Postal config `CORE_POSTAL_CONFIGS.postalCodePattern` in SPA globalConfigs | globalConfigs.js | falls back to 5-digit rule | degrades |
| 9 | PGR id prefix (segment before `-PGR-`) | egov-idgen | falls back to `NCCG` | degrades |
| 10 | Localization messages for `en_IN` (+ any locale under test), incl. workflow action labels (ESCALATE, …) | localization | label assertions skip/fail | per-spec |
| 11 | `RejectionReasons`, `Department`, `Designation` masters | MDMS v2 | admin/HRMS specs skip | per-spec |
| 12 | Citizen self-registration + an OTP the suite can read (fixed `IDENTITY_TEST_OTP_CODE` or an SMS sink at `IDENTITY_TEST_OTP_SINK_URL`) | Identity BFF + user-service | citizen-setup fails | hard-fail (citizen specs) |
| 13 | **Optional:** Keycloak realm + OIDC discovery | keycloak | `tests/keycloak/*` self-skip | self-skip |

A deployment's onboarding (XLSX + `deploy.sh`) may not seed all of these — close the
gaps by hand on the test tenant.

## 4. The golden rule: no hardcoded deployment literals

Every deployment-shaped value resolves through one chain:

```
explicit env var  →  deployment-profile.json  →  legacy hardcoded default
```

Do **not** hardcode: tenant (`ke`, `mz.maputo`), phone prefix (`+254`), a complaint
type (`ContractDispute`, `reparo_buracos`), a postal format, a boundary/ward code, an
id prefix (`NCCG`), a tenant label ("Bomet County"), a specific SRID, a username
(`EMP001`). Instead, import from `utils/env.ts`:

```ts
import { TENANT, ROOT_TENANT, SERVICE_CODE, LOCALITY_CODE, TENANT_LABEL,
         POSTAL_CODE_PATTERN, LOCALES, PGR_ID_PREFIX, generateCitizenPhone } from '../utils/env';
```

…or resolve it live (MDMS / boundary / workflow lookups via `utils/probes.ts`,
`utils/personas.ts`). A test that "passes" only because a hardcoded literal happens to
match one deployment is a **vacuous pass** — the whole point of this chain is to turn
those into real, portable assertions.

**This extends to workflow *shape*, not just literals** — read a feature's actual
configuration live rather than assuming one deployment's behaviour:
- **ESCALATE model** — depends on the deployment's workflow. Which states offer
  ESCALATE, which roles may take it and who can act after it differ between
  implementations, even within DIGIT 3.0. Read the live `BusinessService` instead of
  assuming one shape; a test that pins one deployment's workflow contract belongs on
  that deployment's branch (e.g. `tests/api/pgr-escalation.spec.ts` on a deployment
  branch pins that deployment's escalation states).
- **Inbox locality sort** — some deployments sort by the raw leaf boundary code, others
  by a coarser bairro/name key, so a spec cannot assume raw-leaf-code order.
- **Postal / mobile formats, id prefixes, locales** — always from the profile.

## 5. Adding a test — checklist

1. **Put it in the right persona folder** (`tests/admin/`, `tests/citizen/`, …). The
   folder + filename drive its default dashboard tags.
2. **Tag it.** Every `test()` takes an options object with a `tag` array:
   ```ts
   test('does the thing', {
     tag: ['@persona:admin', '@area:pgr', '@layer:ui', '@kind:regression'],
   }, async ({ page }) => { … });
   ```
   Facets (used by the dashboard filters): `@persona:` (admin | citizen | employee |
   cross | system), `@area:` (pgr, hrms, configurator-manage, localization, theme,
   dashboard, auth, mdms-schema, proxy, keycloak, onboarding, manage-boundaries),
   `@layer:` (ui | api), `@kind:` (happy-path | edge-case | regression | smoke |
   lifecycle | validation). Reference a ticket with `@ccrs:NNN` / `@pr:NNN`.
   `@deprecated:<label>` (e.g. `@deprecated:digit-3.0`) is a **label**, not a facet:
   it marks a retired test (§9) and is not coverage.
3. **Pull deployment values from `env.ts`** (§4) — never hardcode.
4. **Reuse the helpers** instead of rolling your own:
   - `utils/auth.ts` `getDigitToken`, `loadAuth`; `utils/employee-ui.ts`
     `loginEmployeeBrowser`, `getPrincipal`, `readInboxRows`, `fetchService`.
   - `utils/seed.ts` `seedComplaintAsCitizen`, `driveToPendingAtLme`, … (file/assign/
     resolve a complaint — APPLY is always `[CITIZEN, CSR]`, so file as a citizen).
   - `utils/manage/api.ts` `pgrSearch`, `pgrCount`, `mdmsSearch`, `employeeSearch`.
   - `utils/personas.ts` `getPersona`, `resolveSeedPlan` (the exact serviceCode/actor/
     assignee triple PGR will actually accept on this deployment).
   - Sign-in (DIGIT 3.0): `utils/identity-bff.ts` `surfacePath` (every app URL is
     `/<slug>/digit-ui/…`), `citizenSignIn`; `utils/citizen-login.ts` `citizenOtpLogin`;
     `utils/citizen-provision.ts` `provisionFreshCitizen`. The app keeps tokens in
     **sessionStorage**, not localStorage.
5. **Skip, don't fail, when a capability or data legitimately isn't present** — with a
   precise reason (`test.skip(!x, 'no ward-scoped CSR on <tenant>: …')`). Reserve a red
   for a real regression. Never let a spec pass by asserting nothing.
   - A skip reason names the **workspace/tenant and the evidence** (what was looked
     for, what was found). Never put staff names or logins in it: reasons are published
     in the report.
   - In a chain of dependent tests, a skipped step must not make the next test **fail**.
     Record the skip reason in a shared variable and have the later tests
     `test.skip(!!reason, reason)` on it.
6. **Clean up what you create.** Track created records and soft-delete them in
   `afterAll` (`utils/manage/teardown.ts`); use the `PW_` code prefix
   (`utils/manage/codes.ts` `testCode`) so leftovers are identifiable and never collide.

## 6. Conventions & gotchas (learned the hard way)

- **Assert on the write's RESPONSE, not an immediate re-search.** pgr-services' search
  index lags the write by a beat — an immediate `_search` after an update reads the
  *old* value. Read the value back from the `_update`/`_create` response.
- **Wait for the XHR before asserting.** Don't race a UI Save:
  ```ts
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/_update') && r.request().method()==='POST'),
    page.getByRole('button', { name: /^Save$/ }).click(),
  ]);
  ```
- **Default to `mode: 'default'`, not `'serial'`.** With `workers:1` both run in file
  order, but `serial` cascade-skips every test after the first failure — hiding the
  real state. Use `serial` only when tests genuinely depend on each other.
- **Locate custom selects/filters by role + name**, e.g.
  `getByRole('combobox', { name: /^Status$/i })` — `getByLabel` misses controls that
  render without a `<label>` association.
- **Two-level tenants:** a complaint's boundary, assignee, and workflow live at the
  **city** tenant (`mz.maputo`), while the citizen lives at the **root** (`mz`). File
  and validate against the correct one.
- **HRMS `employees/_search` needs `offset=0`** (it 500s without it); its
  `roles=`/`codes=` filters are unreliable — search then filter in code.
- **`@local-only`-tagged specs** are excluded unless `LOCAL_STACK=1`.
- **A "nothing shown" check needs proof the page loaded.** `toHaveCount(0)` / an empty
  row list is green on a page that never rendered. Pair it with a positive control on the
  same surface (the empty-state block, a header, a known row). Wait helpers such as
  `utils/employee-ui.ts` `waitForInboxSettled` give up quietly on timeout, so they are
  not that proof on their own.
- **No English fallback labels or location literals.** A label that differs per
  deployment (language pill text, default citizen name) comes from config, e.g.
  `CITIZEN_LANGUAGE_PILL_TEXT`, `CITIZEN_DEFAULT_NAME` in `utils/env.ts`, set in the
  environment's `config.env`. Coordinates, ward codes and similar come from the profile or
  from data the test creates.

## 7. Running

Each deployment is an **environment**: `environments/<name>/config.env` (committed,
no secrets) plus a git-ignored `secrets.env` (copy `secrets.example` next to it and fill
it in). Run from the repo root, the same way CI does:

```bash
ci/run-local.sh <env> [scope] [--grep <expr>] [-- <playwright args or files>]

ci/run-local.sh <env> profile-only                  # read-only: what does the deployment have?
ci/run-local.sh <env> smoke
ci/run-local.sh <env> citizen --grep @area:pgr
ci/run-local.sh <env> full -- tests/admin/users.spec.ts
```

Scopes: `profile-only`, `smoke`, `api`, `smoke+api`, `citizen`, `employee`, `admin`,
`lifecycle`, `full`. The script copies the suite to `.work/suite`, runs it with
`ci/playwright.ci.config.ts` and writes results to **`.work/out`** (`report.json`,
`results.xml`, `playwright-report/`). CI runs the same scripts from
`.github/workflows/integration-tests.yml`; screenshots, video and traces are off there
unless `RECORD_SCREENSHOTS` / `RECORD_VIDEO` / `RECORD_TRACES` are set.

Run **one invocation at a time against a deployment** (shared fixtures — §2). The
dashboard (`scripts/build-catalog.ts`, `scripts/tag-tests.ts`) groups results by the
tags above; `ci/publish-pages.sh` publishes full runs per `<branch>/<env>`.

## 8. Pass / fail / skip — what each means

- **pass** — the behaviour is correct on this deployment.
- **fail** — a real regression, OR a genuine app/deployment defect the test correctly
  catches (keep it red; don't weaken the assertion to go green).
- **skip** — a capability/data/build feature this deployment legitimately lacks, with a
  precise reason. A skip must never hide a failure.

## 9. Retiring a test

When a product or deployment change makes a test no longer apply, **skip it always and
say why** rather than deleting it or rewriting it into a different test:

```ts
test('2. single create — happy path …', {
  tag: ['@persona:admin', '@area:hrms', '@layer:ui', '@kind:happy-path', '@deprecated:digit-3.0'],
}, async ({ page }) => {
  test.skip(true, 'Deprecated in DIGIT 3.0: HRMS refuses an employee without a current ' +
    'assignment (COMPAT_REFUSED). Covered by "2b. single create with a current assignment …"');
  …
});
```

- The reason starts with `Deprecated in <version or deployment>:`, says **what changed**,
  and names the replacement (`Covered by "<test title>"`) when there is one. It must be
  enough for someone on another deployment or branch to decide whether to keep the test
  skipped or switch it back on for their implementation.
- Tag it `@deprecated:<label>` (§5). Leave the test body in place, so re-enabling it is
  one line.
- Add any **replacement test at the end of the file**. The dashboard keys tests by
  `file:line:title`, so inserting a test mid-file gives every test below it a new id and
  resets its history.
- Examples: `tests/api/pgr-escalation.spec.ts` tests 2 and 14,
  `tests/admin/employees.spec.ts` test 2, `tests/admin/complaints.spec.ts` test 9,
  `tests/admin/tenants.spec.ts` test 3.

## 10. Temporary workarounds

A workaround for an **open product bug** must be easy to switch off once the bug is fixed:

1. It sits behind **one environment flag**, off by default, switched on per environment
   in `environments/<env>/config.env`.
2. Its code lives in **one helper**, not spread across specs.
3. It carries a `TEMPORARY … remove once <issue link> is fixed` comment.
4. It has a row in the table below.

**To revert after the fix:** set the flag to `false` (or remove the line) in the
environment's `config.env`, re-run the affected tests, and once they pass delete the
flag, the helper branch and the table row.

| Flag | Issue | Where | How to revert |
|---|---|---|---|
| `TENANT_CASE_WORKAROUND` | egovernments/complaint-management-system#84 (the tenant id's case differs between the configurator and the employee UI) | `tests/utils/identity-bff.ts` (`tenantCaseWorkaround`, `sameTenant`), `tests/utils/configurator-auth.ts` (`loginConfigurator` session tenant) | set `TENANT_CASE_WORKAROUND=false` in the environment's `config.env`, re-run, then delete |
