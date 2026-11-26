import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';
const LOCAL_STACK = process.env.LOCAL_STACK === '1';
const EXCLUDE_LOCAL_ONLY = LOCAL_STACK ? undefined : /@local-only/;
// tests/onboarding/ walks the configurator onboarding wizard: it creates and
// deactivates throwaway child tenants on the target and adds ~20 serial tests to
// a full run. Opt in per environment with RUN_ONBOARDING=1 in its config.env.
const RUN_ONBOARDING = process.env.RUN_ONBOARDING === '1';
// Session and file-access checks (tag @2.12_session_checks) run only on their
// own: never in full or any other scope. RUN_SESSION_CHECKS=1 (set by the
// `session-checks` scope in ci/run-suite.sh) runs ONLY them, with the setup
// projects as their dependencies. Same mechanism as @local-only / LOCAL_STACK.
const RUN_SESSION_CHECKS = process.env.RUN_SESSION_CHECKS === '1';
const SESSION_CHECKS_TAG = /@2\.12_session_checks/;
const ONLY_SESSION_CHECKS = RUN_SESSION_CHECKS ? SESSION_CHECKS_TAG : undefined;
const EXCLUDED = [EXCLUDE_LOCAL_ONLY, RUN_SESSION_CHECKS ? undefined : SESSION_CHECKS_TAG].filter((r): r is RegExp => !!r);

export default defineConfig({
  // Specs live under tests/<persona>/ (citizen, employee, admin) plus
  // tests/lifecycle/ for cross-persona end-to-end flows. The setup project
  // below writes auth.json before any spec project runs.
  // Anchor test discovery to the canonical `tests/` tree at the repo
  // root. Using testDir: '.' with `tests/**/*.spec.ts` matches files
  // inside dev worktrees too (`.worktrees/<branch>/tests/...`), which
  // double-loads @playwright/test and crashes the runner. Pinning
  // testDir to `tests` scopes discovery to this checkout's specs only.
  testDir: 'tests',
  testMatch: [
    '**/*.spec.ts',
    'fixtures/auth.setup.ts',
    'fixtures/lifecycle.setup.ts',
    'fixtures/api.setup.ts',
    'fixtures/citizen.setup.ts',
    'fixtures/profile.setup.ts',
  ],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // Manage specs mutate tenant state; serial keeps cleanup deterministic.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'report.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    // Opt-in for self-signed clusters (e.g. local k3s ingress); secure by default.
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
    headless: true,
    screenshot: 'on',
    trace: 'on',
    video: 'on',
  },
  projects: [
    {
      // Runs before everything and depends on nothing: it interrogates the live
      // deployment and writes deployment-profile.json, which utils/env.ts reads
      // synchronously at import time. Every other project therefore depends on
      // it, or their specs would import env.ts with no profile behind it and
      // silently fall back to the legacy hardcoded defaults.
      name: 'profile-setup',
      testMatch: /tests\/fixtures\/profile\.setup\.ts$/,
    },
    {
      // Runs first — performs UI login and writes storageState to auth.json,
      // plus the sessionStorage half of the session to auth-session.json
      // (storageState cannot hold sessionStorage). Reads tenant + credentials
      // through env.ts, so it needs the discovered profile.
      name: 'setup',
      testMatch: /tests\/fixtures\/auth\.setup\.ts$/,
      dependencies: ['profile-setup'],
    },
    {
      // Runs after `setup`. Drives the PGR API end-to-end to seed two
      // complaints (one PENDINGFORASSIGNMENT, one CLOSEDAFTERRESOLUTION
      // with rating=4) and writes lifecycle-fixtures.json. Downstream
      // specs that need a "pinned" SRID read from that file.
      name: 'lifecycle-setup',
      testMatch: /tests\/fixtures\/lifecycle\.setup\.ts$/,
      dependencies: ['setup', 'profile-setup'],
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: 'auth.json',
      },
      dependencies: ['setup', 'lifecycle-setup', 'citizen-setup', 'profile-setup'],
      testIgnore: [
        // Don't try to run setup itself as part of the chromium project.
        /tests\/fixtures\/(auth|lifecycle|api|citizen|profile)\.setup\.ts$/,
        // `testDir: 'tests'` (above) makes chromium discover EVERY spec tree,
        // including tests/api and tests/smoke — which already have their own
        // dedicated projects with token-injection auth (auth-api.json) and an
        // `api-setup` dependency. Without this, all 38 api specs + the smoke
        // spec ran a second time under chromium with the UI storage state,
        // duplicating every api result in report.json (38 pass/fail/skip rows
        // counted twice) and inflating suite runtime for zero added coverage.
        /tests\/(api|smoke)\//,
        // Analytics-dashboard benchmarks have their own config
        // (playwright.dashboard.config.ts) and fail without its DASHBOARD_* settings.
        /tests\/dashboard-performance\//,
        // Opt-in only: see RUN_ONBOARDING above.
        ...(RUN_ONBOARDING ? [] : [/tests\/onboarding\//]),
      ],
      grep: ONLY_SESSION_CHECKS,
      grepInvert: EXCLUDED,
    },
    {
      // Token-injection auth — writes auth-api.json storage state.
      // Used by smoke + api projects which do not exercise the UI login form.
      //
      // Depends on profile-setup because api.setup.ts imports utils/env.ts, and
      // env.ts resolves TENANT/ROOT_TENANT at MODULE-IMPORT time from
      // deployment-profile.json. With no edge here the two setups race, and on
      // the run where api-setup wins there is no profile on disk yet — so env.ts
      // silently falls back to its legacy `ke.nairobi`/`ke` literals and this
      // project authenticates against a tenant that isn't the one under test.
      // On maputo that surfaces as `ROPC token request failed (400)`; on bomet
      // it would pass for the worst possible reason — the fallback literal `ke`
      // happens to BE bomet's real tenant, so the bug is invisible there.
      // `setup` needs no such edge: it does not import env.ts.
      name: 'api-setup',
      testMatch: /tests\/fixtures\/api\.setup\.ts$/,
      dependencies: ['profile-setup'],
    },
    {
      // Provisions ONE fresh citizen per `npx playwright test` invocation
      // and writes the identity to citizen-fixture.json. Citizen specs
      // consume the fixture via readProvisionedCitizen() instead of each
      // registering their own citizen — shared identity, single round-trip.
      name: 'citizen-setup',
      testMatch: /tests\/fixtures\/citizen\.setup\.ts$/,
      dependencies: ['profile-setup'],
    },
    {
      name: 'smoke',
      testDir: 'tests/smoke',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['api-setup', 'profile-setup'],
      grep: ONLY_SESSION_CHECKS,
      grepInvert: EXCLUDED,
      timeout: 30_000,
      use: {
        storageState: 'auth-api.json',
      },
    },
    {
      name: 'api',
      testDir: 'tests/api',
      testMatch: /.*\.spec\.ts$/,
      // lifecycle-setup writes lifecycle-fixtures.json, which api-helpers.spec.ts
      // reads at module-load time. Without this dependency a `--project=api` run has
      // no fixture file and that spec self-skips — which read as a data gap but was
      // purely a missing dependency here.
      dependencies: ['api-setup', 'profile-setup', 'lifecycle-setup'],
      grep: ONLY_SESSION_CHECKS,
      grepInvert: EXCLUDED,
      use: {
        storageState: 'auth-api.json',
      },
    },
  ],
});
