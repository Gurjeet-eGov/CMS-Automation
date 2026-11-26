/**
 * DIGIT auth utilities — token acquisition and session injection.
 */
import { BASE_URL } from './env';
import { employeeSessionKeys, writeTabSession } from './session-storage';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  UserRequest?: Record<string, unknown>;
}

export interface AuthConfig {
  baseURL?: string;
  tenant: string;
  /** Override the tenant used for OAuth (defaults to root derived from tenant). */
  authTenant?: string;
  username: string;
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

/** Acquire a DIGIT access token via /user/oauth/token (ROPC grant). */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  const resp = await fetch(`${baseURL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: config.username,
      password: config.password,
      tenantId: config.tenant,
      scope: 'read',
      userType: config.userType || 'EMPLOYEE',
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Auth failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

/**
 * Login via API token injection — bypasses the UI login form.
 * The session goes into THIS tab's sessionStorage (session-storage.ts); a new
 * tab of the same context starts signed out, as the app itself behaves.
 */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  // Auth against root tenant (ADMIN lives at root), but inject city tenant into UI
  const rootTenant = config.authTenant || (config.tenant.includes('.') ? config.tenant.split('.')[0] : config.tenant);
  const tokenResponse = await getDigitToken({ ...config, tenant: rootTenant });

  await page.goto(`${baseURL}/digit-ui/employee/user/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await writeTabSession(page, employeeSessionKeys(tokenResponse, config.tenant));

  await page.goto(`${baseURL}/digit-ui/employee`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
