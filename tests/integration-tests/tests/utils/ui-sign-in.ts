/**
 * Sign-in, sign-out and session probes for the three UIs — the shared layer of
 * the session checks (@2.12_session_checks).
 *
 * Two ways to sign a tab in:
 *   - signIn (form) .... through the same form a person uses. Used where the
 *                        sign-in itself is under test (a real sign-in keeps its
 *                        session in that tab only).
 *   - signInViaApi ..... a fresh API token injected into that one tab with the
 *                        exact keys a real sign-in writes (session-storage.ts).
 *                        ~2 s instead of ~30–45 s for the citizen OTP form;
 *                        the default everywhere else.
 * Every sign-in is fresh: logout and idle sign-out end ALL of a user's sessions,
 * so a token shared between tests would be dead for the ones after.
 *
 * Every UI is one `Portal`, so the per-window and idle specs share the same
 * steps. Waits are on real signals (URL, token in the tab, an element) with
 * generous limits, never fixed sleeps: a fast deployment moves on at once, a
 * slow one gets up to the limit.
 *
 * Locators match structure, not wording, so they hold in every language.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, TENANT, TENANT_LABEL, ADMIN_USER, ADMIN_PASS } from './env';
import { getDigitToken } from './auth';
import { citizenLoginViaApi, citizenOtpLoginViaUI } from './citizen-login';
import { loginEmployeeBrowser } from './employee-ui';
import { loginConfigurator } from './configurator-auth';
import { CONFIGURATOR_SESSION_KEY, readTabToken } from './session-storage';

export type PortalName = 'employee' | 'citizen' | 'configurator';

/** For the citizen, `user` is the mobile number and `pass` is unused (OTP). */
export interface Credential {
  user: string;
  pass: string;
}

export interface IdlePopup {
  root: Locator;
  stay: Locator;
  signOut: Locator;
}

export interface Portal {
  name: PortalName;
  /** Signed-in landing page. */
  homeUrl: string;
  /** A protected page opened by typing its URL into a new tab. */
  protectedUrl: string;
  /** A page with a text input, for "a half-filled form is not kept". */
  formUrl: string;
  /** URL of a signed-in page of this portal (not its sign-in page). */
  signedInUrl: RegExp;
  /** Sign in through the form. */
  signIn(page: Page, cred: Credential): Promise<void>;
  /** Sign in with a fresh API token injected into this tab. */
  signInViaApi(page: Page, cred: Credential): Promise<void>;
  /** True when this tab shows the portal's sign-in page. */
  onLoginGate(page: Page): Promise<boolean>;
  /** The token the app holds in THIS tab ('' when none). Never log it. */
  readToken(page: Page): Promise<string>;
  /** The signed-in user's uuid in THIS tab ('' when none). */
  readUserId(page: Page): Promise<string>;
  /**
   * Sign out with the UI's Logout control, and assert it takes this tab to the
   * sign-in page right away (an API logout, logoutViaApi(), does not: the tab
   * only finds out on its next call). Fails if the control is not found.
   */
  logout(page: Page): Promise<void>;
  /** The inactivity pop-up — employee and citizen only (the configurator has no idle limit). */
  idlePopup?(page: Page): IdlePopup;
}

const SIGNAL_TIMEOUT = 30_000;

async function readJsonKey(page: Page, key: string): Promise<any> {
  const raw = await page.evaluate((k) => sessionStorage.getItem(k), key).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Click the first candidate that becomes visible within `timeout`; false if none did. */
async function clickFirstVisible(page: Page, candidates: Locator[], timeout = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const el = c.first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        return true;
      }
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/** Wait until the tab is a signed-in page of the portal with a token in it. */
async function waitSignedIn(portal: Portal, page: Page, how: string): Promise<void> {
  await expect
    .poll(async () => portal.signedInUrl.test(page.url()) && !(await portal.onLoginGate(page)) && (await portal.readToken(page)) !== '', {
      message: `${portal.name}: not signed in after ${how}`,
      timeout: SIGNAL_TIMEOUT,
    })
    .toBe(true);
}

/** Wait until the tab shows the portal's sign-in page. */
async function waitLoginGate(portal: Portal, page: Page, timeout = SIGNAL_TIMEOUT): Promise<boolean> {
  try {
    await expect.poll(() => portal.onLoginGate(page), { timeout }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The digit-ui inactivity pop-up (employee and citizen), as found on cms_pilot:
 *
 *   <div class="digit-popup-wrapper digit-idle-warning-popup">
 *     … <button id="stay-signed-in" class="digit-button-primary">Stay signed in</button>
 *       <button id="sign-out-now"  class="digit-button-secondary">Sign out now</button>
 *
 * The citizen UI prefixes the ids with the page (pgr-home-stay-signed-in), so
 * they are matched by suffix, inside the pop-up's own class. No text is matched.
 */
function digitIdlePopup(page: Page): IdlePopup {
  const root = page.locator('.digit-idle-warning-popup');
  return { root, stay: root.locator('button[id$="stay-signed-in"]'), signOut: root.locator('button[id$="sign-out-now"]') };
}

// ── Employee digit-ui ─────────────────────────────────────────────────────────

const employee: Portal = {
  name: 'employee',
  homeUrl: `${BASE_URL}/digit-ui/employee`,
  protectedUrl: `${BASE_URL}/digit-ui/employee/user/profile`,
  formUrl: `${BASE_URL}/digit-ui/employee/user/profile`,
  signedInUrl: /\/digit-ui\/employee(?!\/user\/(login|language-selection))/,

  async signIn(page, { user, pass }) {
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: SIGNAL_TIMEOUT });
    const userInput = page.locator('input[type="text"]').first();
    await userInput.waitFor({ state: 'visible', timeout: SIGNAL_TIMEOUT });
    await userInput.fill(user);
    await page.locator('input[type="password"]').first().fill(pass);
    // City picker: <Select id="emp-city">; its label is localized, so the option
    // is matched by the tenant's own display label (env.ts TENANT_LABEL).
    const cityCombo = page.locator('#emp-city, [role="combobox"]').first();
    if (await cityCombo.isVisible().catch(() => false)) {
      if (!((await cityCombo.textContent()) || '').includes(TENANT_LABEL)) {
        await cityCombo.click();
        await page.getByRole('option', { name: new RegExp(TENANT_LABEL, 'i') }).first().click();
      }
    }
    const agree = page.locator('input[type="checkbox"]').first();
    if ((await agree.isVisible().catch(() => false)) && !(await agree.isChecked().catch(() => true))) {
      await agree.check({ force: true }).catch(() => {});
    }
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Continue")').first().click();
    await waitSignedIn(employee, page, 'the login form');
  },

  async signInViaApi(page, { user, pass }) {
    const ok = await loginEmployeeBrowser(page, user, pass);
    expect(ok, `employee: ${user} could not get an API token on ${TENANT} or ${ROOT_TENANT}`).toBeTruthy();
    await waitSignedIn(employee, page, 'API sign-in');
  },

  async onLoginGate(page) {
    if (/\/digit-ui\/employee\/user\/(login|language-selection)/.test(page.url())) return true;
    return page.locator('input[type="password"]').first().isVisible().catch(() => false);
  },

  readToken: (page) => readTabToken(page, 'Employee.token'),

  async readUserId(page) {
    const info = (await readJsonKey(page, 'Employee.user-info')) || (await readJsonKey(page, 'Digit.User'))?.value?.info;
    return String(info?.uuid ?? '');
  },

  /*
   * Top bar: the profile button (button.pgr-topbar-profile-trigger, aria-haspopup
   * "menu") opens a menu on hover; its Logout entry is the menu item holding the
   * log-out icon (arrow path "M16 17l5-5-5-5"). Matched by structure, with the
   * menu item's text as a fallback only.
   */
  async logout(page) {
    const trigger = page.locator('button.pgr-topbar-profile-trigger[aria-haspopup="menu"]').first();
    const logoutItem = page
      .locator('button[role="menuitem"].pgr-topbar-menu-item:has(svg path[d="M16 17l5-5-5-5"])')
      .or(page.locator('button[role="menuitem"].pgr-topbar-menu-item').filter({ hasText: /log\s?out|sign\s?out/i }));
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.hover();
      if (!(await logoutItem.first().waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false))) await trigger.click();
    } else {
      await clickFirstVisible(page, [page.locator('.header-dropdown-profile'), page.locator('[class*="profile" i] button')], 5_000);
    }
    const clicked = await clickFirstVisible(page, [logoutItem, page.getByRole('menuitem', { name: /log\s?out|sign\s?out/i })]);
    expect(clicked, 'employee: no Logout entry found in the top-bar profile menu').toBe(true);
    await clickFirstVisible(page, [page.getByRole('button', { name: /^(yes|log\s?out|sign\s?out|confirm)/i })], 3_000);
    expect(await waitLoginGate(employee, page), 'employee: the Logout button must take this tab to the login page').toBe(true);
  },

  idlePopup: digitIdlePopup,
};

// ── Citizen digit-ui ──────────────────────────────────────────────────────────

const citizen: Portal = {
  name: 'citizen',
  homeUrl: `${BASE_URL}/digit-ui/citizen/pgr/complaints`,
  protectedUrl: `${BASE_URL}/digit-ui/citizen/pgr/complaints`,
  formUrl: `${BASE_URL}/digit-ui/citizen/user/profile`,
  signedInUrl: /\/digit-ui\/citizen(?!\/login)/,

  async signIn(page, { user }) {
    await citizenOtpLoginViaUI(page, user); // OTP from the SMS sink or FIXED_OTP (utils/otp.ts)
    await waitSignedIn(citizen, page, 'the OTP form');
  },

  async signInViaApi(page, { user }) {
    await citizenLoginViaApi(page, user);
    await waitSignedIn(citizen, page, 'API sign-in');
  },

  async onLoginGate(page) {
    if (/\/digit-ui\/citizen\/login/.test(page.url())) return true;
    return page.locator('input#login-mobile, input[name="mobileNumber"], input[type="tel"]').first().isVisible().catch(() => false);
  },

  readToken: (page) => readTabToken(page, 'Citizen.token'),

  async readUserId(page) {
    return String((await readJsonKey(page, 'Citizen.user-info'))?.uuid ?? '');
  },

  async logout(page) {
    const clicked = await clickFirstVisible(page, [
      page.getByRole('link', { name: /^\s*log\s?out\s*$/i }),
      page.getByRole('button', { name: /^\s*log\s?out\s*$/i }),
      page.getByText(/^\s*log\s?out\s*$/i),
    ], 10_000);
    expect(clicked, 'citizen: no Logout entry found').toBe(true);
    await clickFirstVisible(page, [page.getByRole('button', { name: /yes.*log\s?out|^log\s?out$|^yes$/i })], 5_000);
    expect(await waitLoginGate(citizen, page), 'citizen: the Logout control must take this tab to the login page').toBe(true);
  },

  idlePopup: digitIdlePopup,
};

// ── Configurator ──────────────────────────────────────────────────────────────

const configurator: Portal = {
  name: 'configurator',
  homeUrl: `${BASE_URL}/configurator/manage`,
  protectedUrl: `${BASE_URL}/configurator/manage/departments`,
  formUrl: `${BASE_URL}/configurator/manage/departments/create`,
  signedInUrl: /\/configurator\/(manage|phase)/,

  async signIn(page, { user, pass }) {
    await page.goto(`${BASE_URL}/configurator/login`, { waitUntil: 'domcontentloaded', timeout: SIGNAL_TIMEOUT });
    await expect(page.locator('#username')).toBeVisible({ timeout: SIGNAL_TIMEOUT });
    await page.locator('#username').fill(user);
    await page.locator('#password').fill(pass);
    await page.locator('#tenantCode').click();
    await page.locator('#tenantCode').fill(ROOT_TENANT);
    await page.getByRole('button', { name: /^Management$/ }).click();
    await page.getByRole('button', { name: /Sign In/i }).click();
    await waitSignedIn(configurator, page, 'the sign-in form');
  },

  async signInViaApi(page, who) {
    await loginConfigurator(page, who);
    await waitSignedIn(configurator, page, 'API sign-in');
  },

  async onLoginGate(page) {
    if (/\/configurator\/login/.test(page.url())) return true;
    return page.locator('#username').isVisible().catch(() => false);
  },

  async readToken(page) {
    return String((await readJsonKey(page, CONFIGURATOR_SESSION_KEY))?.authToken ?? '');
  },

  async readUserId(page) {
    return String((await readJsonKey(page, CONFIGURATOR_SESSION_KEY))?.user?.uuid ?? '');
  },

  /* The configurator's Log out is an icon-only button: matched by its log-out icon (svg.lucide-log-out). */
  async logout(page) {
    const direct = [
      page.locator('button:has(svg.lucide-log-out)'),
      page.getByRole('button', { name: /log\s?out|sign\s?out/i }),
      page.getByRole('menuitem', { name: /log\s?out|sign\s?out/i }),
    ];
    let clicked = await clickFirstVisible(page, direct, 3_000);
    if (!clicked) {
      await clickFirstVisible(page, [page.getByRole('button', { name: /account|user|profile|menu/i }), page.locator('[aria-haspopup="menu"], [aria-haspopup="true"]')], 5_000);
      clicked = await clickFirstVisible(page, direct, 5_000);
    }
    expect(clicked, 'configurator: no Log out control found').toBe(true);
    await clickFirstVisible(page, [page.getByRole('button', { name: /^(yes|log\s?out|sign\s?out|confirm)/i })], 3_000);
    expect(await waitLoginGate(configurator, page), 'configurator: the Log out control must take this tab to the sign-in page').toBe(true);
  },
};

export const PORTALS: Record<PortalName, Portal> = { employee, citizen, configurator };

/**
 * Signed in = a signed-in page of the portal with a token in this tab. Waits up
 * to `timeout` for the app to settle either way (after a reload or navigation).
 */
export async function isSignedIn(portal: Portal, page: Page, timeout = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await portal.onLoginGate(page)) return false;
    if (portal.signedInUrl.test(page.url()) && (await portal.readToken(page)) !== '') return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/** Open `url` in `page` and report whether it asked for sign-in (sign-in page shown, no token in the tab). */
export async function opensLoginGate(portal: Portal, page: Page, url = portal.protectedUrl): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SIGNAL_TIMEOUT });
  return (await waitLoginGate(portal, page, 20_000)) && (await portal.readToken(page)) === '';
}

/** Reload and wait for the app to settle. */
export async function reloadAndSettle(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

// ── server-side token check ─────────────────────────────────────────────────

let adminCaller: { token: string; info: Record<string, unknown> } | null = null;

async function caller(refresh = false): Promise<{ token: string; info: Record<string, unknown> }> {
  if (!adminCaller || refresh) {
    const t = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminCaller = { token: t.access_token, info: (t.UserRequest ?? {}) as Record<string, unknown> };
  }
  return adminCaller;
}

async function detailsStatus(token: string, who: { token: string; info: Record<string, unknown> }): Promise<number> {
  const ts = Date.now();
  const r = await fetch(`${BASE_URL}/user/_details?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', ver: '1.0', ts, msgId: `${ts}|en_IN`, authToken: who.token, userInfo: who.info },
    }),
  });
  return r.status;
}

/**
 * Does the server still accept this token? egov-user's /user/_details resolves
 * the token in `access_token` (the caller's own token goes in RequestInfo — the
 * admin's, fetched once and refreshed if it expired). 200 = live; anything else
 * = expired or deleted. The token is never logged.
 */
export async function tokenStatus(token: string): Promise<number> {
  let who = await caller();
  if ((await detailsStatus(who.token, who)) !== 200) who = await caller(true);
  return detailsStatus(token, who);
}

/**
 * End a session through egov-user's logout API — the same call the apps make:
 * POST /user/_logout?tenantId=… with the token both as `access_token` and as
 * RequestInfo.authToken. The token is dead on the server at once, but a tab
 * that holds it only goes to its sign-in page on its next failing API call (a
 * reload, a navigation); the UI's Logout button (Portal.logout) takes its own
 * tab there right away. So: the button where the logout itself is under test,
 * this where logout is only a step (e.g. to get a revoked token). Asserts HTTP
 * 200; the token is never logged.
 */
export async function logoutViaApi(token: string, tenant: string = TENANT): Promise<void> {
  const ts = Date.now();
  const r = await fetch(`${BASE_URL}/user/_logout?tenantId=${encodeURIComponent(tenant)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({
      access_token: token,
      RequestInfo: { apiId: 'Rainmaker', authToken: token, msgId: `${ts}|en_IN`, plainAccessRequest: {} },
    }),
  });
  expect(r.status, `the logout API (/user/_logout on ${tenant}) must accept the session's own token`).toBe(200);
}
