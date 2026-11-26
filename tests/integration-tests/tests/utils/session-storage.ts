/**
 * Where the apps keep a signed-in session — one place for every sign-in helper.
 *
 * On 2.12.1 builds with per-tab sessions (cms_pilot), the employee and citizen
 * digit-ui and the configurator keep the whole session in sessionStorage, which
 * belongs to one tab. A token in localStorage is deprecated: the apps don't
 * read it, and leaving one there would let a test pass on a session the app
 * never honoured, so any copy there is removed.
 *
 * The key sets below are exactly what a REAL sign-in writes on cms_pilot
 * (observed in the browser's storage panel, 2026-11-26), with values built from
 * the API token response in the same shapes:
 *
 *   raw token ............ Employee.token / Citizen.token, token
 *   user JSON ............ Employee.user-info / Citizen.user-info, user-info
 *   envelope ............. Digit.User, Digit.citizen.userRequestObject,
 *                          Digit.Employee.tenantId, Digit.PGR_TENANTS
 *                          — {"value": …, "ttl": 86400, "expiry": <epoch ms>}
 *   epoch ms ............. Digit.UserTokenExpiryAt (sign-in + token lifetime),
 *                          pgr.employee.sessionLoginAt (sign-in time)
 *
 * Not written, on purpose: Digit.IdleLogoutLogin (the app regenerates it on
 * load) and Digit.CitizenLastActivity (the app writes it on activity).
 *
 * sessionStorage survives navigation and reload inside the same tab, so the
 * helpers write on a page of the app's origin and then navigate that same tab
 * into the app. A NEW tab starts empty — exactly what the session checks assert
 * — so a helper only ever signs in the page it is given.
 *
 * If a build uses different keys, change them here.
 */
import type { Page } from '@playwright/test';

/** The parts of a /user/oauth/token response the session is built from. */
export interface TokenLike {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  ResponseInfo?: unknown;
  UserRequest?: Record<string, unknown>;
}

const DAY_SECONDS = 86400;

/** The app's storage envelope: {"value": …, "ttl": 86400, "expiry": <epoch ms>}. */
function envelope(value: unknown, now: number): string {
  return JSON.stringify({ value, ttl: DAY_SECONDS, expiry: now + DAY_SECONDS * 1000 });
}

/**
 * What Digit.User / Digit.citizen.userRequestObject hold inside "value" — on
 * cms_pilot: info, access_token, token_type, refresh_token, expires_in, scope
 * (+ ResponseInfo for employees), i.e. the token response with UserRequest
 * renamed to info.
 */
function userObject(tok: TokenLike): Record<string, unknown> {
  return {
    info: tok.UserRequest ?? {},
    access_token: tok.access_token,
    ...(tok.token_type ? { token_type: tok.token_type } : {}),
    ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    ...(tok.expires_in !== undefined ? { expires_in: tok.expires_in } : {}),
    ...(tok.scope ? { scope: tok.scope } : {}),
    ...(tok.ResponseInfo !== undefined ? { ResponseInfo: tok.ResponseInfo } : {}),
  };
}

/** Every sessionStorage key a real employee sign-in writes. */
export function employeeSessionKeys(tok: TokenLike, tenant: string, now = Date.now()): Record<string, string> {
  const info = JSON.stringify(tok.UserRequest ?? {});
  return {
    'Employee.token': tok.access_token,
    token: tok.access_token,
    'Employee.user-info': info,
    'user-info': info,
    'Digit.User': envelope(userObject(tok), now),
    'Digit.citizen.userRequestObject': envelope(userObject(tok), now),
    'Digit.Employee.tenantId': envelope(tenant, now),
    'Digit.PGR_TENANTS': envelope([], now),
    'Digit.UserTokenExpiryAt': String(now + (tok.expires_in ?? 8 * 3600) * 1000),
    'pgr.employee.sessionLoginAt': String(now),
  };
}

/** Every sessionStorage key a real citizen sign-in writes. */
export function citizenSessionKeys(tok: TokenLike, now = Date.now()): Record<string, string> {
  const info = JSON.stringify(tok.UserRequest ?? {});
  return {
    'Citizen.token': tok.access_token,
    token: tok.access_token,
    'Citizen.user-info': info,
    'user-info': info,
    'Digit.User': envelope(userObject(tok), now),
    'Digit.citizen.userRequestObject': envelope(userObject(tok), now),
    'Digit.UserTokenExpiryAt': String(now + (tok.expires_in ?? 8 * 3600) * 1000),
  };
}

/** The configurator's session blob (it carries authToken). */
export const CONFIGURATOR_SESSION_KEY = 'crs-auth-state';

/**
 * Write a session into the CURRENT tab's sessionStorage, and remove any copy of
 * the same keys from localStorage (deprecated location). The page must already
 * be on the app's origin (any page of it — the login page is the usual choice).
 */
export async function writeTabSession(page: Page, entries: Record<string, string>): Promise<void> {
  await page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) {
      sessionStorage.setItem(k, v);
      localStorage.removeItem(k);
    }
  }, entries);
}

/** Whether this tab holds a session token under `key` (presence only — never the value). */
export async function tabHasToken(page: Page, key: string): Promise<boolean> {
  return page.evaluate((k) => Boolean(sessionStorage.getItem(k)), key).catch(() => false);
}

/** Read this tab's token under `key` from sessionStorage ('' when absent). For API checks only — never log it. */
export async function readTabToken(page: Page, key: string): Promise<string> {
  return page.evaluate((k) => sessionStorage.getItem(k) || '', key).catch(() => '');
}

/**
 * Snapshot of one tab's sessionStorage, for the setup projects. Playwright's
 * storageState (auth.json / auth-api.json) keeps cookies and localStorage only,
 * so the sessionStorage half of a session is saved beside it and replayed into
 * each test's tabs by utils/session-test.ts. Holds a live token: git-ignored,
 * never copied out of the run folder, never printed.
 */
export interface SavedTabSession {
  origin: string;
  entries: Record<string, string>;
}

export async function saveTabSession(page: Page, file: string): Promise<void> {
  const snapshot = await page.evaluate(() => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k !== null) entries[k] = sessionStorage.getItem(k) ?? '';
    }
    return { origin: location.origin, entries };
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, JSON.stringify(snapshot));
}

/** The replay file that belongs to a storageState file: auth.json → auth-session.json. */
export function sessionFileFor(storageStateFile: string): string {
  return storageStateFile.replace(/\.json$/, '') + '-session.json';
}
