/**
 * Configurator auth helper — injects the session into the tab's sessionStorage.
 *
 * The CRS Configurator keeps its auth state under key 'crs-auth-state'. On
 * builds with per-tab sessions that lives in sessionStorage (one tab);
 * a localStorage copy is deprecated and is removed here. This helper acquires a
 * DIGIT token via API and injects it so we bypass the configurator login form
 * entirely — for THIS page only; a new tab starts signed out.
 */
import type { Page } from '@playwright/test';
import { getDigitToken } from './auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from './env';
import { CONFIGURATOR_SESSION_KEY, writeTabSession } from './session-storage';

const CONFIGURATOR_BASE = process.env.CONFIGURATOR_BASE_URL || `${BASE_URL}/configurator`;

export { CONFIGURATOR_BASE };

/** Sign `who` (default: the admin) in to the configurator by injecting a session into this tab. */
export async function loginConfigurator(page: Page, who?: { user: string; pass: string }): Promise<void> {
  const tokenResponse = await getDigitToken({
    tenant: ROOT_TENANT,
    username: who?.user ?? ADMIN_USER,
    password: who?.pass ?? ADMIN_PASS,
  });

  const user = (tokenResponse.UserRequest as Record<string, unknown> | undefined) || {};
  const roles = (user.roles as Array<{ code: string }>) || [];

  // Navigate to configurator first so we can write storage on its origin
  await page.goto(CONFIGURATOR_BASE, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // The configurator's auth-state format. It carries authToken, so it is
  // token-bearing: sessionStorage only.
  await writeTabSession(page, {
      [CONFIGURATOR_SESSION_KEY]: JSON.stringify({
        isAuthenticated: true,
        user: {
          name: (user.name as string) || 'Super Admin',
          email: (user.emailId as string) || '',
          roles: roles.map((r) => r.code),
          id: user.id,
          uuid: user.uuid,
          mobileNumber: user.mobileNumber,
        },
        environment: BASE_URL, // The DIGIT API base (not the configurator path)
        tenant: ROOT_TENANT,
        mode: 'management',
        currentPhase: 1,
        completedPhases: [],
        authToken: tokenResponse.access_token,
      }),
  });

  // Reload to pick up the injected session — should land on /manage
  await page.goto(`${CONFIGURATOR_BASE}/manage`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
}
