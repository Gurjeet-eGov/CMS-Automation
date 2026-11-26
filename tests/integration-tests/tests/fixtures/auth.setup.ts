import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { ADMIN_USER, ADMIN_PASS, ROOT_TENANT } from '../utils/env';
import { CONFIGURATOR_SESSION_KEY, saveTabSession, sessionFileFor } from '../utils/session-storage';

const AUTH_FILE = path.resolve('auth.json');
// storageState cannot hold sessionStorage, where the configurator keeps its
// session; utils/session-test.ts replays this file into each test's tabs.
const SESSION_FILE = path.resolve(sessionFileFor('auth.json'));

// Credentials: env.ts's one admin family (DIGIT_USERNAME / DIGIT_PASSWORD;
// ADMIN_USER / ADMIN_PASSWORD are deprecated aliases) at ROOT_TENANT
// (TENANT_CODE is a deprecated alias).
//
// UI login flow against the configurator. We intentionally walk the form
// rather than injecting storage so the spec exercises the same login
// surface a real admin uses (and catches regressions in the login form).
setup('authenticate', async ({ page }) => {
  // Not every target under test deploys the configurator (e.g. a local-setup
  // stack that only runs digit-ui-esbuild for PGR). `chromium`'s project
  // dependency on this fixture is purely for sequencing — employee/citizen
  // specs authenticate independently via API token injection and override
  // storageState themselves, so they never read auth.json's contents. Only
  // admin/configurator specs actually need it. Skip (not fail) when the
  // route 404s so a missing configurator doesn't block every other persona's
  // specs (previously required a manual `--no-deps` workaround).
  const response = await page.goto('/configurator/login');
  if (!response || !response.ok()) {
    setup.skip(
      true,
      `configurator not reachable on this target (GET /configurator/login -> ${response ? response.status() : 'no response'}) — admin/configurator specs will skip for lack of auth.json, but employee/citizen specs authenticate independently and are unaffected`,
    );
    return;
  }

  // The login page boots client-side — wait for the username field to mount.
  const usernameInput = page.locator('#username');
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(ADMIN_USER);
  await page.locator('#password').fill(ADMIN_PASS);

  const tenantInput = page.locator('#tenantCode');
  await tenantInput.click();
  await tenantInput.fill(ROOT_TENANT);

  // Choose Management mode so we land on /manage rather than /phase/1.
  // The button has no role=button — it's a styled <button type="button">.
  // Match by visible text. Onboarding is the default so this is required.
  const managementButton = page.getByRole('button', { name: /^Management$/ });
  await managementButton.click();

  // Submit and wait for navigation away from the login screen.
  await Promise.all([
    page.waitForURL(/\/configurator\/(manage|phase\/1)/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);

  // Sanity: this tab's sessionStorage should now hold the configurator session
  // blob (localStorage tokens are deprecated). We don't print the token — only
  // assert presence.
  const hasAuthState = await page.evaluate(
    (key) => !!sessionStorage.getItem(key),
    CONFIGURATOR_SESSION_KEY,
  );
  expect(hasAuthState, `${CONFIGURATOR_SESSION_KEY} not in sessionStorage after sign-in`).toBe(true);

  await page.context().storageState({ path: AUTH_FILE });
  await saveTabSession(page, SESSION_FILE);
});
