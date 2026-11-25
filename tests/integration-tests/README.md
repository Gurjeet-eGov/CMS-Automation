# DIGIT Integration Tests

End-to-end Playwright tests for DIGIT — PGR lifecycle (citizen + employee
flows) and the configurator's manage surface (departments, designations,
complaints). Runs against any DIGIT deployment; configured via env vars.

## Quick Start

Each deployment is an **environment**: `environments/<name>/config.env`
(committed, no secrets) plus `environments/<name>/secrets.env` (git-ignored;
copy `secrets.example` next to it and fill it in). Run it the way CI does,
from the repo root:

```bash
ci/run-local.sh <env> profile-only        # read-only: what does the deployment have?
ci/run-local.sh <env> smoke               # scopes: profile-only, smoke, api, smoke+api,
ci/run-local.sh <env> full                #   citizen, employee, admin, lifecycle, full
ci/run-local.sh <env> citizen --grep @area:pgr -- --headed
```

Results land in `.work/out` (`report.json`, `results.xml`,
`playwright-report/`). See `WRITING-TESTS.md` §7.

Running Playwright directly from this folder still works when you export the
variables yourself:

```bash
npm install
npx playwright install chromium

# Run everything against the default environment (Nairobi)
npm test

# Run a single persona's flows
npm run test:citizen
npm run test:employee
npm run test:admin
npm run test:lifecycle

# Interactive runner
npm run test:ui

# Sanity-check that all specs parse without running them
npm run test:list

# Run against a different deployment by hand (example values: bomet, single-tenant `ke`)
BASE_URL=https://bometfeedbackhub.digit.org \
DIGIT_TENANT=ke \
LOCALITY_CODE=BOMET_BOMET_CENTRAL_CHESOEN \
SERVICE_CODE=RudeBehavior \
npx playwright test

# …or source a ready-made per-deployment env file (see deploy/bomet.env)
set -a; source deploy/bomet.env; set +a && npx playwright test
```

Every run starts with the setup projects (`tests/fixtures/*.setup.ts`, see
`WRITING-TESTS.md` §2). Sign-in is **Keycloak + the Identity BFF**: the
`setup` project signs the admin (`ADMIN_USER` / `ADMIN_PASSWORD`, a Keycloak
login) into the configurator with `utils/configurator-auth.ts`
`loginConfigurator` and saves the BFF session cookie and the selected DIGIT
context to `auth.json`; `api-setup` does the same without a browser
(`auth-api.json`). The app keeps its tokens in **sessionStorage**. Both
files are gitignored.

## Environment Variables

Per-deployment values belong in `environments/<name>/config.env`, passwords
and logins in its `secrets.env`. The bomet and Nairobi values below are the
code's fallbacks, shown as examples, not as what to use.

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://naipepea.digit.org` | DIGIT deployment base URL |
| `DIGIT_TENANT` | `ke.nairobi` | City-level tenant ID |
| `ROOT_TENANT` | Derived from `DIGIT_TENANT` | State/root tenant ID (e.g. `ke`) |
| `DIGIT_USERNAME` | `ADMIN` | Employee admin username |
| `DIGIT_PASSWORD` | `eGov@123` | Employee admin password |
| `CITY_ADMIN_USER` | `EMP-KE_NAIROBI-000089` | City-level admin username (for UI tests) |
| `CITY_ADMIN_PASS` | `eGov@123` | City-level admin password |
| `CITIZEN_PHONE_PREFIX` | `7` | First digit(s) for valid mobile numbers |
| `FIXED_OTP` | `123456` | OTP value (for mock OTP deployments) |
| `SERVICE_CODE` | `IllegalConstruction` | PGR service code for complaint tests (must exist on the deployment) |
| `LOCALITY_CODE` | `NAIROBI_CITY_VIWANDANI` | Boundary locality code for address |
| `EMPLOYEE_USER` / `EMPLOYEE_PASSWORD` | `BOMET_LME` / `eGov@123` | PGR_LME employee for inbox/resolve flows |
| `GRO_USER` / `GRO_PASSWORD` | `KE_GRO` / `eGov@123` | GRO employee — required for the PGR `ASSIGN` action |
| `WARD_CSR_USER` / `WARD_CSR_PASSWORD` | `BOMET_CSR_CHESOEN_…` / `eGov@123` | Ward-scoped CSR (boundary jurisdiction tests) |
| `WARD_CSR_BOUNDARY` / `FORBIDDEN_WARDS` | bomet wards | Leaf ward the CSR is scoped to / sibling wards that must be hidden |
| `CITY_TENANT` | `ke.nairobi` | A real city tenant in the configurator list (tenants-search test) |
| `TENANT_LABEL` | `Bomet County` | Tenant label shown on the login City combobox |
| `SCREENSHOT_DIR` | `/tmp/full-complaint-lifecycle-ui-screenshots` | Directory for UI test screenshots |
| `IDENTITY_TEST_TENANT_SLUG` | — (required) | Workspace slug: app URLs are `/<slug>/digit-ui/…` |
| `IDENTITY_TEST_OTP_CODE` / `IDENTITY_TEST_OTP_SINK_URL` | — | Citizen OTP: a fixed code, or an SMS sink the suite reads |
| `PERSONA_CANDIDATES` | — | More logins the suite may sign in as, `login:password` pairs, comma-separated (in `secrets.env`) |
| `CITIZEN_LANGUAGE_PILL_TEXT` | `English` | Text of the citizen home page's language pill on this deployment |
| `CITIZEN_DEFAULT_NAME` | — (the phone number) | Name the deployment gives a citizen who registers without one |
| `TENANT_CASE_WORKAROUND` | off | Temporary workaround for an open product bug; see `WRITING-TESTS.md` §10 |

See `environments/<name>/config.env` and `secrets.example` for the
per-environment files `ci/run-local.sh` and CI load. `.env.example` and
`deploy/*.env` are the older hand-sourced templates.

## Portability

This suite is meant to run against **any** DIGIT deployment, not just the
one it was authored against (Nairobi). How far that holds depends on the
spec. Every spec falls into one of three tiers — know which tier you're
writing before you add assertions.

### Tier 1 — Platform-portable (runs on any healthy deployment)

Needs only a valid login + correct env **values**; it either asserts
platform/UI *behaviour* or **self-seeds** the data it needs (registers its
own citizen, creates its own complaint, onboards its own throwaway tenant).
These are the bulk of the suite (most of the API surface + self-seeding
flows). They pass anywhere the platform is healthy and the env vars point
at valid values.

**Rule for staying in Tier 1:** assert behaviour, not a particular
deployment's data. Read the rule/label/locale the deployment actually has
(e.g. "the configured locale resolves these keys") rather than pinning a
literal (`sw_KE`, a specific label string, a fixed complaint id).

### Tier 2 — Provisioning-coupled (runs only where the deployment is seeded for it)

Needs the deployment to actually **have** specific entities wired up: a GRO,
a `PGR_LME` *in the department the service routes to*, a ward-scoped CSR, a
known assigned complaint. No env var can conjure these — they must exist in
the deployment's HRMS / role / boundary / service→department topology.

> Real example: PGR `ASSIGN` requires a GRO, and the assignee must be a
> `PGR_LME` whose department matches the complaint's service-code routing.
> On a box where every service routes to an empty department, the flow
> cannot complete no matter how the test is configured — that's a
> deployment data gap, not a test bug.

**Rule for Tier 2:** discover the precondition at runtime and
`test.skip(reason)` when it's absent, instead of failing red. A missing
persona on deployment X should read as "skipped: no PGR_LME in dept Y", not
as a failure. Prefer a shared resolver (look up a valid persona from HRMS)
over a hardcoded username.

### Tier 3 — Deployment-pinned (avoid; refactor toward Tier 1)

Hardcodes one deployment's data into assertions (`ke.nairobi`, `sw_KE`,
exact label text, "31 boundaries", a fixed complaint id). These only pass
on the one box whose data matches. Treat any new Tier-3 assertion as a
smell: parameterize the value via env, or rewrite it as a behavioural
(Tier-1) check.

### Practical checklist for a portable spec

- Read deployment values from `tests/utils/env.ts` — never inline a tenant,
  user, locale, service code, or boundary literal in a spec.
- Self-seed data where you can (register citizen, create complaint/tenant)
  instead of assuming pre-existing inventory.
- When you genuinely need seeded state (Tier 2), `test.skip()` with a clear
  reason if it's missing — don't fail.
- Assert *behaviour and shape*, not a specific deployment's *values*.
- Put per-deployment values in an env file (see `deploy/bomet.env`), not in
  code defaults — code defaults should track the canonical reference
  deployment only.

## Test Suites

Specs are organised by **persona** (citizen / employee / admin) plus a
shared `lifecycle/` directory for cross-persona end-to-end flows. Date-
stamped specs (`*-fixes-YYYY-MM-DD.spec.ts`) capture regressions for a
specific fix wave; future fix waves should add assertions to the
existing persona spec, not a new dated tree.

### `tests/citizen/`

- `citizen-otp-login.spec.ts` — OTP login (auto-register + fixed OTP)
- `citizen-logout.spec.ts` — logout flow ends on the login page
- `complaint-detail-page.spec.ts` — detail page loads without crashing
- `complaint-type-dropdown-labels.spec.ts` — translated category names
- `pgr-home-layout-and-scroll.spec.ts` — citizen-side regression smoke (CCRS#421/#422/#441)
- `complaint-create-payload-contract.spec.ts` — pincode + AddressOne/Two populators
- `complaint-timeline-and-rating-display.spec.ts` — rating + timeline localization

### `tests/employee/`

- `login.spec.ts` — employee sign-in, wrong-password handling, session tokens
- `inbox-filters.spec.ts`, `inbox-search.spec.ts`, `pgr-inbox-sort-922.spec.ts` — inbox
- `pgr-details.spec.ts`, `workflow-lifecycle-ui.spec.ts`, `workflow-reject-ui.spec.ts`,
  `escalate-action-521.spec.ts`, `reopen-limit-925.spec.ts` — complaint details and workflow actions
- `profile.spec.ts`, `profile-validation-config-445.spec.ts`,
  `change-password-visibility-812.spec.ts`,
  `confirm-reauth-before-account-action-2645.spec.ts` — account and profile
- `sidebar.spec.ts`, `digit-ui-shell-2026-05-31.spec.ts`,
  `working-context-jurisdiction.spec.ts` — shell, navigation, working context
- `pgr-fixes-2026-04-29.spec.ts` — assign workflow, role filter, REJECT reasons

### `tests/admin/`

Configurator manage surface (`/configurator/manage/*`) plus admin-scoped
regression checks:
`departments`, `designations`, `complaint-types`, `complaints`,
`employees`, `users`, `tenants`, `boundary-hierarchies`, `localization`,
`theme-editor`, `theme-applied`,
`pgr-dashboard`, `hardcoding`, `recently-shipped-fixes`,
`configurator-mdms-fixes-2026-04-29`.

Specs that create data use a `PW_${hash}_${kind}` prefix and an
`afterAll` that soft-deletes via the helpers (`mdms _update isActive=false`
for masters, PGR `REJECT` workflow action for complaints). Tests pull
live data dynamically — no hardcoded `ContractDispute` / `DEPT_14` /
`PGR_LME assignee uuid`; if the tenant lacks an HRMS employee with the
needed role, the relevant test calls `test.skip()` with a clear reason.

### `tests/lifecycle/`

Cross-persona end-to-end flows:
- `pgr-sla-auto-escalate.spec.ts` — SLA breach auto-escalation (needs a
  deployment tuned for fast escalation; skips otherwise)

The PGR API lifecycle and the ESCALATE chain live in `tests/api/`
(`pgr-lifecycle.spec.ts`, `pgr-escalation.spec.ts`).

### `tests/onboarding-real/`

`workspace-lifecycle.spec.ts` (#2266) drives the whole self-service journey
against a real stack, at API level through the public origin:

1. Magic-link signup (link read from Mailpit), PGR signup draft, `_submit`,
   then `operations/_search` until `SUCCEEDED`.
2. Founder `_select`; the workspace starts `NOT_STARTED`.
3. The configurator's step calls, in order: Branding (logo upload,
   ThemeConfig), Geography (2-level hierarchy), Departments (2 departments,
   1 designation), Employees (two GROs and an LME via HRMS `_create` then BFF
   `_link`; before that, one browser step downloads the Employees step's template and checks its Codes sheet and sample row against the departments, designation and boundaries just created (#2648; needs `npx playwright install chromium`); the water GRO and the LME follow their activation mail and set a
   password; the roads GRO exists only so every routed department has a GRO,
   and is never activated), Complaint types (2 leaves
   with department and SLA). Every step is marked DONE and the workspace ends
   `DONE` with every probe true. The labels the steps wrote resolve for `en_IN`.
4. GRO and LME sign in through Keycloak with their email (#2646); in a
   browser the water GRO signs out and back in, and the login field reads
   "Email" (needs `npx playwright install chromium`). A citizen signs in by OTP at `/{slug}/`
   and files a complaint.
5. The GRO sees it in the TEAM inbox and assigns it, the LME sees it in the MINE
   inbox and resolves it, the citizen rates and closes it, and the workflow
   history reads APPLY, ASSIGN, RESOLVE, RATE.
6. The founder removes the LME: HRMS marks the employee inactive, the BFF drops
   the binding, and the LME's session and DIGIT token stop working.

Any 403, 404 or 5xx on any request fails the run at that call. Each run
creates one new tenant and leaves it behind (there is no tenant delete API);
its slug is `e2e-<letters>` and its tenant id `ee<letters>`.

It is not part of any CI job. Run it by hand against a dev box:

| Variable | Description |
|----------|-------------|
| `ONBOARDING_E2E_BASE_URL` | Public origin of the stack (nginx in front of Kong, the BFF and Keycloak) |
| `ONBOARDING_E2E_MAILPIT_URL` | Mailpit API base, e.g. `http://127.0.0.1:18025/mailpit/api/v1` through an SSH tunnel |
| `ONBOARDING_E2E_OTP_COMMAND` | Shell command that prints the citizen OTP. It gets `OTP_PHONE`, `OTP_TENANT_ID`, `OTP_CHALLENGE_ID` and `OTP_SINCE_MS` |
| `ONBOARDING_E2E_EMAIL_DOMAIN` | Domain for the run's addresses (default `e2e.test`; Mailpit catches all) |
| `ONBOARDING_E2E_MOBILE_PREFIX` / `ONBOARDING_E2E_MOBILE_LENGTH` | Shape of generated mobile numbers (default `7`, 9 digits); checked against the tenant's rule |
| `ONBOARDING_E2E_IGNORE_HTTPS_ERRORS` | `1` for a box with a self-signed certificate |

With `IDENTITY_CITIZEN_OTP_SENDER=log`, the OTP command can read the BFF log:

```bash
ssh -f -N -L 18025:127.0.0.1:18025 <box>
export ONBOARDING_E2E_BASE_URL=https://<box-domain>
export ONBOARDING_E2E_MAILPIT_URL=http://127.0.0.1:18025/mailpit/api/v1
export ONBOARDING_E2E_OTP_COMMAND='ssh <box> "sudo docker logs --since $((OTP_SINCE_MS/1000-5)) digit-identity-bff 2>&1" \
  | grep identity.citizen_otp.log_sender | sed "s/^[^{]*//" \
  | jq -r --arg t "$OTP_TENANT_ID" --arg p "$OTP_PHONE" "select(.tenantId==\$t and (.phoneNumber|tostring|endswith(\$p))) | .code" | tail -1'
npm run test:onboarding-real
```

A run takes about 2–5 minutes; most of it is tenant provisioning (measured: 4.0 min, then 2.0 min once #2310 removed the provisioning retries). Each run uses
one magic-link request, and the BFF allows 3 per client IP per 30 minutes by
default (`IDENTITY_MAGIC_LINK_REQUEST_LIMIT`), so back-to-back runs from one
machine can stall at "No mail with a sign-in link".

## Project Structure

```
tests/
├── fixtures/                         # setup projects, run before the specs
│   ├── profile.setup.ts              # discovers the deployment → deployment-profile.json
│   ├── auth.setup.ts                 # configurator sign-in → auth.json
│   ├── api.setup.ts                  # BFF sign-in, no browser → auth-api.json
│   ├── citizen.setup.ts              # one fresh citizen → citizen-fixture.json
│   └── lifecycle.setup.ts            # seeds complaints → lifecycle-fixtures.json
├── citizen/                          # citizen persona flows
├── employee/                         # employee persona flows
├── admin/                            # configurator + manage surface
├── lifecycle/                        # cross-persona end-to-end
└── utils/
    ├── identity-bff.ts               # Keycloak + Identity BFF: sign-in, contexts, OTP, surfacePath
    ├── auth.ts                       # staff sign-in through the BFF (signIn, loginViaApi)
    ├── citizen-login.ts              # citizen OTP sign-in (API session or UI)
    ├── configurator-auth.ts          # configurator session (loginConfigurator)
    ├── env.ts                        # environment config
    ├── manage/                       # admin spec helpers
    │   ├── api.ts                    # reads auth.json, mdms/pgr/hrms calls
    │   ├── codes.ts                  # PW_${hash}_${kind} test codes
    │   └── teardown.ts               # cleanupMdms / cleanupPgrComplaints
    └── launch-fixes/                 # date-stamped fix-wave helpers
        ├── api.ts
        └── ui.ts
```

## CI

`.github/workflows/integration-tests.yml` runs the suite on demand
(Actions → Run workflow) with an **environment**, a **scope** (default
`full`) and an optional **grep**. The environment is a GitHub Environment
holding `CONFIG_ENV` and `SECRETS_ENV` (the contents of that environment's
`config.env` and `secrets.env`). It uses the same `ci/` scripts as
`ci/run-local.sh`; full runs are published to the GitHub Pages dashboard per
`<branch>/<env>`. Screenshots, video and traces are off in CI unless
`RECORD_SCREENSHOTS` / `RECORD_VIDEO` / `RECORD_TRACES` are set.

## Prerequisites

- Node.js 18+
- A running DIGIT deployment with:
  - PGR services (`pgr-services`)
  - User service (`egov-user`)
  - Workflow service (`egov-workflow-v2`)
  - A citizen OTP the suite can read: a fixed code (`IDENTITY_TEST_OTP_CODE`)
    or an SMS sink (`IDENTITY_TEST_OTP_SINK_URL`)
  - City-level admin employee for UI tests (e.g. `EMP-KE_NAIROBI-000089`)

## Notes

- **API tests** are fast (~2s) and use `fetch()` directly — no browser needed
- **UI tests** use Playwright headless Chromium, take screenshots at each step
- The city-level admin (`CITY_ADMIN_USER`) is needed because DIGIT's `getCurrentTenantId()` returns the employee's login tenant — UI workflow actions require this to match the complaint's city tenant
- Citizen registration goes through the Identity BFF OTP flow; the BFF rate-limits OTPs per phone and per IP, so avoid re-running citizen sign-in in tight loops
