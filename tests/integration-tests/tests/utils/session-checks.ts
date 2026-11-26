/**
 * Steps shared by the session checks (@2.12_session_checks):
 * tests/{employee,citizen,admin}/session-per-window.spec.ts and
 * tests/{employee,citizen}/session-idle-timeout.spec.ts.
 *
 * The test() calls stay in each portal's own spec file (the dashboard keys a
 * test by file:line, so portals must not share one definition site); the steps
 * live here so every portal is checked identically.
 *
 * Conventions every step follows:
 *   - "browser" = a BrowserContext (own cookies and storage); "window/tab" = a
 *     page inside one. sessionStorage belongs to one tab.
 *   - Every sign-in is fresh, through the API by default (ui-sign-in.ts); the
 *     form only where the sign-in itself is under test.
 *   - Every "asks for login" / "signed out" assertion is paired with a positive
 *     control on the same portal, so a dead page can never pass.
 *   - Tokens are compared and checked against the server, never logged.
 *   - Idle steps fake the BROWSER clock (context.clock): clock.runFor(ms) makes
 *     the app believe that much time passed, instantly. The faked clock still
 *     ticks normally between jumps, so every jump is preceded by user activity,
 *     which restarts the app's idle count from zero right there.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { SESSION_IDLE_LIMIT_SECONDS, SESSION_IDLE_WARNING_SECONDS, ADMIN_USER, CITY_ADMIN_USER, CITY_ADMIN_PASS } from './env';
import { provisionFreshCitizen } from './citizen-provision';
import { resolveCredential, serviceCodesFor } from './personas';
import {
  PORTALS,
  isSignedIn,
  opensLoginGate,
  reloadAndSettle,
  tokenStatus,
  type Credential,
  type IdlePopup,
  type Portal,
  type PortalName,
} from './ui-sign-in';

/** How long before a due time a "not yet" check looks. */
const MARGIN_MS = 10_000;
/** How far past a due time a "now" check jumps — the apps check idleness on a few-second tick. */
const PAST_DUE_MS = 6_000;
/**
 * The pop-up is due SESSION_IDLE_WARNING_SECONDS (60 s) before the limit but can
 * come a few seconds late, so "it must be showing" is checked at limit − 30 s,
 * by when it must certainly be up. "Not yet" stays at MARGIN_MS before the warning.
 */
const POPUP_SURE_BEFORE_LIMIT_MS = 30_000;

/** The jump from MARGIN_MS before the warning to POPUP_SURE_BEFORE_LIMIT_MS before the limit (40 s for a 60 s warning). */
function toPopupSure(cfg: { limitMs: number; warnAtMs: number }): number {
  return cfg.limitMs - POPUP_SURE_BEFORE_LIMIT_MS - (cfg.warnAtMs - MARGIN_MS);
}

/** Record a note on the running test's report entry. */
function note(description: string): void {
  test.info().annotations.push({ type: 'note', description });
}

// ── who signs in ──────────────────────────────────────────────────────────────

/**
 * The session checks need 2 accounts in PERSONA_CANDIDATES besides the admin:
 * employees who can sign in (role EMPLOYEE). Accounts holding a PGR role
 * (PGR_LME, GRO, …) are preferred, because the inbox checks need user A to see
 * the complaint the test files — they confirm that with their own positive
 * control. Used on the employee UI and the configurator (any employee can sign
 * in to the configurator on 2.12.1), and signed in and out repeatedly — any
 * manual session on them is ended.
 *
 * Never the admin: its session is the suite's shared auth.json one. Never
 * CITY_ADMIN_USER either: it is the workflow employee (workflowEmployee()), and
 * user B must be a different person.
 * Picked deterministically: PGR-role holders first, then by username.
 */
let employeePair: Promise<{ a: Credential; b: Credential } | { skip: string }> | null = null;

function candidatesFromEnv(): Credential[] {
  const seen = new Set<string>();
  const out: Credential[] = [];
  for (const pair of (process.env.PERSONA_CANDIDATES || '').split(',')) {
    const [user, pass] = pair.split(':').map((s) => (s || '').trim());
    if (!user || !pass || user === ADMIN_USER || user === CITY_ADMIN_USER || seen.has(user)) continue;
    seen.add(user);
    out.push({ user, pass });
  }
  return out.sort((x, y) => x.user.localeCompare(y.user));
}

async function pickEmployeePair(): Promise<{ a: Credential; b: Credential } | { skip: string }> {
  const all = candidatesFromEnv();
  const signedIn: Array<{ c: Credential; rank: number }> = [];
  for (const c of all) {
    const p = await resolveCredential(c.user, c.pass);
    if (!p || !p.roles.includes('EMPLOYEE')) continue;
    // Department that owns a complaint type first (the inbox checks file into it), then a PGR role.
    const ownsTypes = serviceCodesFor(p).length > 0;
    const pgr = p.roles.some((r) => r.startsWith('PGR') || r === 'GRO');
    signedIn.push({ c, rank: (ownsTypes ? 0 : 2) + (pgr ? 0 : 1) });
  }
  const ordered = signedIn.sort((x, y) => x.rank - y.rank || x.c.user.localeCompare(y.c.user)).map((x) => x.c);
  if (ordered.length >= 2) return { a: ordered[0], b: ordered[1] };
  return {
    skip: `the session checks need 2 employees in PERSONA_CANDIDATES besides the admin; ${all.length} candidate(s) listed, ${ordered.length} signed in as an employee`,
  };
}

/**
 * A complaint type owned by `cred`'s HRMS department ('' when it has none) —
 * from the deployment profile, so nothing is hard-coded. Department filtering
 * puts a complaint of this type in that user's inbox.
 */
export async function serviceCodeInDepartmentOf(cred: Credential): Promise<{ code: string; departments: string[] }> {
  const p = await resolveCredential(cred.user, cred.pass);
  return { code: p ? serviceCodesFor(p)[0] ?? '' : '', departments: p?.departments ?? [] };
}

/** User A and user B for a portal, or a skip reason naming what is missing. Citizens are fresh per test. */
export async function usersFor(name: PortalName): Promise<{ a: Credential; b: Credential } | { skip: string }> {
  if (name === 'citizen') {
    const [a, b] = [await provisionFreshCitizen(), await provisionFreshCitizen()];
    return { a: { user: a.mobile, pass: '' }, b: { user: b.mobile, pass: '' } };
  }
  employeePair ??= pickEmployeePair();
  return employeePair;
}

/**
 * The employee for the workflow pages — the inbox's "Open in new tab"
 * (SEC/018–020) and the complaint page's attachments and receipt (SEC/008):
 * CITY_ADMIN_USER, an employee holding the CMS roles, so the role is never what
 * hides a complaint (department filtering still applies — the inbox checks file
 * into its department). Positive control: it signs in as an employee and holds
 * roles. Never the
 * admin, because SEC/020 logs this user out and the admin's session is shared
 * by the whole run.
 */
export async function workflowEmployee(): Promise<Credential | { skip: string }> {
  if (!CITY_ADMIN_USER || !CITY_ADMIN_PASS) {
    return { skip: 'CITY_ADMIN_USER / CITY_ADMIN_PASS are not set for this environment (secrets.env); the workflow-page checks need an employee with the CMS roles' };
  }
  if (CITY_ADMIN_USER === ADMIN_USER) {
    return { skip: 'CITY_ADMIN_USER is the suite admin; the workflow-page checks log it out, so it must be a different employee' };
  }
  // An employee sign-in that succeeds is the control; the base EMPLOYEE role is
  // not required (an account can hold only the CMS roles: CSR, GRO, PGR_LME, …).
  const p = await resolveCredential(CITY_ADMIN_USER, CITY_ADMIN_PASS);
  if (!p) return { skip: `CITY_ADMIN_USER ${CITY_ADMIN_USER} could not sign in as an employee on this deployment` };
  if (p.roles.length === 0) return { skip: `CITY_ADMIN_USER ${CITY_ADMIN_USER} signs in but holds no role on this deployment` };
  return { user: CITY_ADMIN_USER, pass: CITY_ADMIN_PASS };
}

/** Idle limit and warning time, or a skip reason. Limit: SESSION_IDLE_LIMIT_SECONDS, else 15 min; warning always 60 s before. */
export function idleConfig(): { limitMs: number; warnAtMs: number } | { skip: string } {
  if (!(SESSION_IDLE_LIMIT_SECONDS > SESSION_IDLE_WARNING_SECONDS + 30)) {
    return { skip: `SESSION_IDLE_LIMIT_SECONDS (${SESSION_IDLE_LIMIT_SECONDS}) must be well above the ${SESSION_IDLE_WARNING_SECONDS} s warning` };
  }
  return { limitMs: SESSION_IDLE_LIMIT_SECONDS * 1000, warnAtMs: (SESSION_IDLE_LIMIT_SECONDS - SESSION_IDLE_WARNING_SECONDS) * 1000 };
}

/** A new tab of `ctx`, freshly signed in as `cred` (API by default), with the positive control. */
async function signedInTab(portal: Portal, ctx: BrowserContext, cred: Credential, via: 'api' | 'form' = 'api'): Promise<Page> {
  const page = await ctx.newPage();
  if (via === 'form') await portal.signIn(page, cred);
  else await portal.signInViaApi(page, cred);
  expect(await isSignedIn(portal, page), `${portal.name}: sign-in (${via}) as ${cred.user} did not leave a session in the tab`).toBe(true);
  return page;
}

/**
 * For "must no longer be signed in": the tab may still show the last page and
 * hold the (now dead) token until the app's next call fails, so wait up to 20 s
 * for the app to land on its sign-in page. True when it did.
 */
export async function endsSignedOut(portal: Portal, page: Page): Promise<boolean> {
  try {
    await expect.poll(() => portal.onLoginGate(page), { timeout: 20_000 }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

/** True when `page` shows the sign-in page and holds no token (waits up to 20 s for it). */
async function asksLogin(portal: Portal, page: Page): Promise<boolean> {
  try {
    await expect.poll(() => portal.onLoginGate(page), { timeout: 20_000 }).toBe(true);
  } catch {
    return false;
  }
  return (await portal.readToken(page)) === '';
}

// ── per-window session (SEC/013–020, 028–032, 040–044) ───────────────────────

/** A new tab with the URL typed in asks for login; the first tab — signed in through the FORM — stays signed in. */
export async function newTabAsksLogin(portal: Portal, browser: Browser, a: Credential): Promise<void> {
  const ctx = await browser.newContext();
  try {
    const first = await signedInTab(portal, ctx, a, 'form');
    const second = await ctx.newPage();
    expect(await opensLoginGate(portal, second), `${portal.name}: a new tab with the URL typed in must ask for login`).toBe(true);
    await reloadAndSettle(first);
    expect(await isSignedIn(portal, first), `${portal.name}: the first tab must stay signed in (positive control)`).toBe(true);
    const third = await ctx.newPage();
    expect(await opensLoginGate(portal, third, portal.homeUrl), `${portal.name}: a new window must ask for login`).toBe(true);
  } finally {
    await ctx.close();
  }
}

/** Two different users in two windows of one browser stay independent. */
export async function twoUsersStayIndependent(portal: Portal, browser: Browser, a: Credential, b: Credential): Promise<void> {
  const ctx = await browser.newContext();
  try {
    const tabA = await signedInTab(portal, ctx, a);
    const tabB = await signedInTab(portal, ctx, b);
    await reloadAndSettle(tabA);
    await reloadAndSettle(tabB);
    expect(await isSignedIn(portal, tabA)).toBe(true);
    expect(await isSignedIn(portal, tabB)).toBe(true);
    const [uidA, uidB] = [await portal.readUserId(tabA), await portal.readUserId(tabB)];
    expect(uidA, `${portal.name}: tab A lost its user`).not.toBe('');
    expect(uidB, `${portal.name}: tab B lost its user`).not.toBe('');
    expect(uidA, `${portal.name}: signing B in, in another window, must not change tab A's user`).not.toBe(uidB);
    expect(await portal.readToken(tabA), `${portal.name}: the two windows must hold different sessions`).not.toBe(await portal.readToken(tabB));
  } finally {
    await ctx.close();
  }
}

/**
 * Logout ends every session of that user — another window, another browser —
 * but no other user's; the old token is refused; the next sign-in gets a new token.
 */
export async function logoutEndsOnlyThatUser(portal: Portal, browser: Browser, a: Credential, b: Credential): Promise<void> {
  const x = await browser.newContext();
  const y = await browser.newContext();
  try {
    const a1 = await signedInTab(portal, x, a); // browser X, window 1
    const bTab = await signedInTab(portal, x, b); // browser X, window 2 (other user)
    const a2 = await signedInTab(portal, y, a); // browser Y (same user)
    // Browser Y works on a page that needs the session (it calls the API), as a
    // person would; a public landing page makes no signed-in call on reload, so
    // the dead token would never be noticed there.
    await a2.goto(portal.protectedUrl, { waitUntil: 'domcontentloaded' });
    expect(await isSignedIn(portal, a2), `${portal.name}: browser Y opens a protected page while signed in (positive control)`).toBe(true);
    const [tA1, tA2, tB] = [await portal.readToken(a1), await portal.readToken(a2), await portal.readToken(bTab)];
    for (const [label, t] of [['A (browser X)', tA1], ['A (browser Y)', tA2], ['B', tB]] as const) {
      expect(await tokenStatus(t), `${portal.name}: ${label}'s token must be live before logout (positive control)`).toBe(200);
    }

    await portal.logout(a1);
    expect(await tokenStatus(tA1), `${portal.name}: the logged-out token must be refused`).not.toBe(200);
    expect(await tokenStatus(tA2), `${portal.name}: A's session in another browser must end too`).not.toBe(200);
    await reloadAndSettle(a2);
    expect(await endsSignedOut(portal, a2), `${portal.name}: A's window in browser Y must no longer be signed in (it must land on the sign-in page)`).toBe(true);

    expect(await tokenStatus(tB), `${portal.name}: user B's session must survive A's logout`).toBe(200);
    await reloadAndSettle(bTab);
    expect(await isSignedIn(portal, bTab), `${portal.name}: user B's window must stay signed in`).toBe(true);

    await portal.signInViaApi(a1, a);
    const fresh = await portal.readToken(a1);
    expect(fresh, `${portal.name}: signing in again must issue a NEW token`).not.toBe(tA1);
    expect(await tokenStatus(fresh), `${portal.name}: the new token must be live`).toBe(200);
  } finally {
    await x.close();
    await y.close();
  }
}

/** Closing the window without logging out: the next tab asks for login. */
export async function closedWindowAsksLogin(portal: Portal, browser: Browser, a: Credential): Promise<void> {
  const ctx = await browser.newContext();
  try {
    const first = await signedInTab(portal, ctx, a);
    await first.goto(portal.protectedUrl, { waitUntil: 'domcontentloaded' });
    expect(await isSignedIn(portal, first), `${portal.name}: the protected page opens while signed in (positive control)`).toBe(true);
    await first.close();
    const next = await ctx.newPage();
    expect(await opensLoginGate(portal, next), `${portal.name}: after closing the window, opening the same protected page again must ask for login`).toBe(true);
  } finally {
    await ctx.close();
  }
}

/**
 * Opening a page in a new tab by the browser's own means asks for login:
 * Ctrl/Cmd+click and middle-click on an in-app link, and "open link in new tab"
 * (a new tab on the same URL). Chrome's Duplicate tab copies sessionStorage and
 * cannot be reproduced by Playwright, so it stays a manual check.
 */
export async function browserNewTabMeansAskLogin(portal: Portal, browser: Browser, a: Credential): Promise<void> {
  const ctx = await browser.newContext();
  try {
    const first = await signedInTab(portal, ctx, a);
    await first.goto(portal.homeUrl, { waitUntil: 'domcontentloaded' });
    await first.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const origin = new URL(portal.homeUrl).origin;
    const link = first.locator(`a[href^="/"]:visible, a[href^="${origin}"]:visible`).first();
    const hasLink = await link.isVisible().catch(() => false);
    note(`${portal.name}: in-app link for the click checks ${hasLink ? 'found' : 'not found — only "open in new tab" by URL was checked'}`);
    if (hasLink) {
      for (const how of ['modifier', 'middle'] as const) {
        const popup = ctx.waitForEvent('page', { timeout: 10_000 });
        if (how === 'modifier') await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
        else await link.click({ button: 'middle' });
        const tab = await popup;
        await tab.waitForLoadState('domcontentloaded');
        expect(await asksLogin(portal, tab), `${portal.name}: a tab opened by ${how === 'modifier' ? 'Ctrl/Cmd+click' : 'middle-click'} must ask for login`).toBe(true);
        await tab.close();
      }
    }
    const byUrl = await ctx.newPage();
    expect(await opensLoginGate(portal, byUrl, first.url()), `${portal.name}: "open link in new tab" (same URL, new tab) must ask for login`).toBe(true);
    await reloadAndSettle(first);
    expect(await isSignedIn(portal, first), `${portal.name}: the original tab must stay signed in (positive control)`).toBe(true);
  } finally {
    await ctx.close();
  }
}

// ── employee inbox "Open in new tab" (SEC/018–020) ───────────────────────────

/**
 * The inbox row's "Open in new tab" button for one complaint:
 *   <button class="pgr-open-new-tab" aria-label="Open in new tab: <SRID>" title="Open in new tab">
 * Matched by its class and the complaint id inside its aria-label — no wording,
 * so it holds in every language, and unique to that complaint's row.
 */
/** True when `locator` becomes visible within `ms` (isVisible() answers at once — its timeout is ignored). */
async function visibleWithin(locator: Locator, ms: number): Promise<boolean> {
  return locator.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
}

export function inboxOpenNewTabButton(page: Page, srid: string) {
  return page.locator(`button.pgr-open-new-tab[aria-label*="${srid}"]`);
}

/**
 * Open a complaint from the inbox with its "Open in new tab" button; returns the
 * new tab and the complaint id it was opened for. Prefers `srid` (filed into the
 * user's department by the spec); if the inbox does not list it, any row with
 * the button will do — the behaviour under test does not depend on which
 * complaint. Skips, naming the tenant, when the inbox has no such row at all.
 */
export async function openFromInboxInNewTab(page: Page, srid: string): Promise<{ tab: Page; srid: string }> {
  const base = new URL(PORTALS.employee.homeUrl).origin;
  const anyButton = page.locator('button.pgr-open-new-tab');
  let chosen = srid;
  for (const path of ['/digit-ui/employee/pgr/inbox-v2', '/digit-ui/employee/pgr/inbox']) {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    if (srid && (await visibleWithin(inboxOpenNewTabButton(page, srid).first(), 20_000))) break;
    if (await visibleWithin(anyButton.first(), srid ? 3_000 : 20_000)) {
      const label = (await anyButton.first().getAttribute('aria-label')) || '';
      chosen = label.split(':').pop()?.trim() || '';
      note(`inbox: ${srid ? `${srid} is not listed for this user; ` : ''}opened ${chosen} from the inbox instead`);
      break;
    }
  }
  test.skip(!chosen || !(await inboxOpenNewTabButton(page, chosen).first().isVisible().catch(() => false)),
    `the user's inbox on this tenant lists no complaint with "Open in new tab"${srid ? ` (filed ${srid} into its department)` : ''}`);
  const button = inboxOpenNewTabButton(page, chosen);
  await expect(button, `complaint ${chosen}'s inbox row must offer "Open in new tab"`).toHaveCount(1, { timeout: 20_000 });
  const popup = page.context().waitForEvent('page', { timeout: 15_000 });
  await button.click();
  const tab = await popup;
  await tab.waitForLoadState('domcontentloaded');
  await tab.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return { tab, srid: chosen };
}

// ── idle timeout (SEC/021–027, 033–039) ──────────────────────────────────────

/** A browser (context) whose clock the test controls, installed before any page loads. */
async function clockedContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.clock.install();
  return ctx;
}

function popup(portal: Portal, page: Page): IdlePopup {
  if (!portal.idlePopup) throw new Error(`${portal.name} has no inactivity limit`);
  return portal.idlePopup(page);
}

async function popupVisible(portal: Portal, page: Page): Promise<boolean> {
  return popup(portal, page).stay.isVisible().catch(() => false);
}

/**
 * User activity in a tab — four of the events the requirement lists: mouse
 * move, scroll, a key press and a click on the page body. Restarts the app's
 * idle count; done right before every clock jump.
 */
async function userActivity(page: Page): Promise<void> {
  await page.mouse.move(120 + Math.random() * 200, 160 + Math.random() * 200);
  await page.mouse.wheel(0, 120);
  await page.keyboard.press('Shift');
  await page.locator('body').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
}

/** Activity, then jump the clock — so only the jump counts as idle time. */
async function idleFor(ctx: BrowserContext, page: Page, ms: number): Promise<void> {
  await userActivity(page);
  await ctx.clock.runFor(ms);
}

/** Wait (real time) for the tab to land on the sign-in page after a jump. */
async function landsOnLogin(portal: Portal, page: Page): Promise<boolean> {
  try {
    await expect.poll(() => portal.onLoginGate(page), { timeout: 30_000 }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The lines a sign-in page shows now that a freshly opened copy of it does not —
 * how the inactivity message is found without knowing its wording.
 */
async function extraLoginLines(browser: Browser, page: Page): Promise<string[]> {
  const lines = async (p: Page) => ((await p.locator('body').innerText().catch(() => '')) || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const fresh = await browser.newContext();
  try {
    const base = await fresh.newPage();
    await base.goto(page.url().split('?')[0], { waitUntil: 'domcontentloaded' });
    await base.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const baseline = new Set(await lines(base));
    return (await lines(page)).filter((l) => !baseline.has(l));
  } finally {
    await fresh.close();
  }
}

/**
 * SEC/021 · 033 — the pop-up is not there before limit − warning and is showing
 * by limit − 30 s; Stay signed in resets the timer; Sign out now signs out with
 * no inactivity message.
 */
export async function popupThenStayThenSignOut(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const sure = `${POPUP_SURE_BEFORE_LIMIT_MS / 1000} s before the limit`;
  const ctx = await clockedContext(browser);
  try {
    const page = await signedInTab(portal, ctx, a);
    const token = await portal.readToken(page);
    await idleFor(ctx, page, cfg.warnAtMs - MARGIN_MS);
    expect(await isSignedIn(portal, page, 5_000), `${portal.name}: still signed in ${MARGIN_MS / 1000} s before the warning (positive control)`).toBe(true);
    expect(await popupVisible(portal, page), `${portal.name}: the pop-up must not appear before limit − warning`).toBe(false);
    await ctx.clock.runFor(toPopupSure(cfg));
    await expect(popup(portal, page).stay, `${portal.name}: the pop-up must be showing by ${sure}`).toBeVisible({ timeout: 10_000 });
    await expect(popup(portal, page).signOut).toBeVisible();

    await popup(portal, page).stay.click();
    await expect(popup(portal, page).stay, `${portal.name}: "Stay signed in" must close the pop-up`).toBeHidden({ timeout: 10_000 });
    await ctx.clock.runFor(cfg.warnAtMs - MARGIN_MS);
    expect(await popupVisible(portal, page), `${portal.name}: after "Stay signed in" the timer restarts — no pop-up before a full limit − warning`).toBe(false);
    await ctx.clock.runFor(toPopupSure(cfg));
    await expect(popup(portal, page).signOut, `${portal.name}: the pop-up must be back by ${sure} of the restarted timer`).toBeVisible({ timeout: 10_000 });

    await popup(portal, page).signOut.click();
    expect(await landsOnLogin(portal, page), `${portal.name}: "Sign out now" must land on the sign-in page`).toBe(true);
    expect(await extraLoginLines(browser, page), `${portal.name}: a deliberate "Sign out now" must not show the inactivity message`).toEqual([]);
    expect(await tokenStatus(token), `${portal.name}: the token must be refused after "Sign out now"`).not.toBe(200);
  } finally {
    await ctx.close();
  }
}

/**
 * SEC/022 · 034 (+ 027 · 039: the CONFIGURED limit) — pop-up ignored: signed out
 * at the limit with the inactivity message; the old token is refused; signing in
 * again issues a new token. (The message is meant to stay on refresh, so that is
 * not checked.)
 */
export async function ignoredPopupSignsOutAtLimit(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const ctx = await clockedContext(browser);
  try {
    const page = await signedInTab(portal, ctx, a);
    note(`${portal.name}: idle limit under test ${cfg.limitMs / 1000} s (${process.env.SESSION_IDLE_LIMIT_SECONDS ? 'SESSION_IDLE_LIMIT_SECONDS' : 'product default'}); pop-up at ${cfg.warnAtMs / 1000} s`);
    const token = await portal.readToken(page);
    expect(await tokenStatus(token), `${portal.name}: token live before going idle (positive control)`).toBe(200);
    await idleFor(ctx, page, cfg.limitMs - MARGIN_MS);
    expect(await portal.onLoginGate(page), `${portal.name}: not signed out ${MARGIN_MS / 1000} s before the limit`).toBe(false);
    await ctx.clock.runFor(MARGIN_MS + PAST_DUE_MS);
    expect(await landsOnLogin(portal, page), `${portal.name}: must be signed out automatically at the limit`).toBe(true);
    const message = await extraLoginLines(browser, page);
    expect(message.length, `${portal.name}: the sign-in page must say the user was signed out for inactivity`).toBeGreaterThan(0);
    note(`${portal.name}: inactivity message shown: "${message.join(' / ').slice(0, 200)}"`);
    expect(await tokenStatus(token), `${portal.name}: the token must be expired by the automatic sign-out`).not.toBe(200);

    await portal.signInViaApi(page, a);
    const fresh = await portal.readToken(page);
    expect(fresh, `${portal.name}: signing in again must issue a new token`).not.toBe(token);
    expect(await tokenStatus(fresh)).toBe(200);
  } finally {
    await ctx.close();
  }
}

/** SEC/022 · 034 (third point) — a half-filled form is not kept across the automatic sign-out. */
export async function halfFilledFormNotKept(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const ctx = await clockedContext(browser);
  try {
    const page = await signedInTab(portal, ctx, a);
    await page.goto(portal.formUrl, { waitUntil: 'domcontentloaded' });
    const field = page.locator('input[type="text"]:visible, textarea:visible').first();
    await expect(field, `${portal.name}: the form page must show a text field (positive control)`).toBeVisible({ timeout: 20_000 });
    const marker = `SC${Date.now()}`;
    await field.fill(marker);
    await expect(field).toHaveValue(marker);
    await idleFor(ctx, page, cfg.limitMs + 2_000);
    expect(await landsOnLogin(portal, page), `${portal.name}: must be signed out automatically at the limit`).toBe(true);
    await portal.signInViaApi(page, a);
    await page.goto(portal.formUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[type="text"]:visible, textarea:visible').first()).toBeVisible({ timeout: 20_000 });
    const values = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values.some((v) => v.includes(marker)), `${portal.name}: the half-filled value must not come back after signing in again`).toBe(false);
  } finally {
    await ctx.close();
  }
}

/**
 * SEC/023 · 035 — user events reset the timer; the app's own background calls,
 * which keep running while the clock advances, do not.
 */
export async function userEventsResetTimer(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const ctx = await clockedContext(browser);
  try {
    const page = await signedInTab(portal, ctx, a);
    await idleFor(ctx, page, cfg.warnAtMs - MARGIN_MS);
    await idleFor(ctx, page, cfg.warnAtMs - MARGIN_MS); // activity in between, so the total passed the warning time
    expect(await popupVisible(portal, page), `${portal.name}: activity must reset the timer — no pop-up yet`).toBe(false);
    expect(await isSignedIn(portal, page, 5_000), `${portal.name}: still signed in (positive control)`).toBe(true);
    // No activity from here: background calls alone must not hold the session open.
    await ctx.clock.runFor(toPopupSure(cfg));
    await expect(
      popup(portal, page).stay,
      `${portal.name}: without user events the pop-up must be showing by ${POPUP_SURE_BEFORE_LIMIT_MS / 1000} s before the limit, background calls notwithstanding`,
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
}

/** SEC/024 · 036 — the same user on several tabs of one browser stays signed in while active in any one. */
export async function activeInAnyTabKeepsSession(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const ctx = await clockedContext(browser);
  try {
    const quiet = await signedInTab(portal, ctx, a);
    const busy = await signedInTab(portal, ctx, a);
    const step = Math.max(10_000, Math.floor(cfg.warnAtMs / 2));
    for (let elapsed = 0; elapsed < cfg.limitMs + step; elapsed += step) await idleFor(ctx, busy, step);
    expect(await isSignedIn(portal, quiet, 5_000), `${portal.name}: the idle tab must stay signed in while the same user is active in another tab`).toBe(true);
    expect(await popupVisible(portal, quiet), `${portal.name}: no pop-up in the idle tab while the user is active elsewhere`).toBe(false);
    // Positive control: with no activity anywhere, the session ends.
    await ctx.clock.runFor(cfg.limitMs + 2_000);
    expect(await landsOnLogin(portal, quiet), `${portal.name}: with no activity anywhere the session must end (control)`).toBe(true);
  } finally {
    await ctx.close();
  }
}

/**
 * SEC/025 · 037 — the same user in two browsers: each browser's idle counter runs
 * on its own activity, and an automatic sign-out in one ends the shared token, so
 * the other browser's session ends too.
 */
export async function perBrowserCounters(portal: Portal, browser: Browser, a: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const x = await clockedContext(browser);
  const y = await clockedContext(browser);
  try {
    const ax = await signedInTab(portal, x, a);
    const ay = await signedInTab(portal, y, a);
    const tokenX = await portal.readToken(ax);
    expect(await tokenStatus(tokenX), `${portal.name}: browser X's token live before browser Y idles (positive control)`).toBe(200);
    await idleFor(y, ay, cfg.limitMs + 2_000);
    expect(await landsOnLogin(portal, ay), `${portal.name}: browser Y must time out on its own counter`).toBe(true);
    expect(await popupVisible(portal, ax), `${portal.name}: browser X's counter must not have moved with Y's`).toBe(false);
    expect(await tokenStatus(tokenX), `${portal.name}: the automatic sign-out in browser Y must end the same user's session in browser X (shared token refused)`).not.toBe(200);
  } finally {
    await x.close();
    await y.close();
  }
}

/**
 * SEC/054 · 055 — two different users of the same kind in two windows of one
 * browser each have their own idle timer:
 *   - both idle: neither has a pop-up before limit − warning; each has its own
 *     pop-up by limit − 30 s (the idle user gets the warning);
 *   - "Stay signed in" in A's window closes A's pop-up only — B's stays up;
 *   - A carries on (user events in A's window), B stays idle: past the limit B
 *     is signed out and A is still signed in.
 */
export async function differentUsersTimeOutIndependently(portal: Portal, browser: Browser, a: Credential, b: Credential, cfg: { limitMs: number; warnAtMs: number }): Promise<void> {
  const sure = `${POPUP_SURE_BEFORE_LIMIT_MS / 1000} s before the limit`;
  const ctx = await clockedContext(browser);
  try {
    const tabA = await signedInTab(portal, ctx, a);
    const tabB = await signedInTab(portal, ctx, b);
    // Both users start idle at the same moment.
    await userActivity(tabA);
    await idleFor(ctx, tabB, cfg.warnAtMs - MARGIN_MS);
    expect(await isSignedIn(portal, tabA, 5_000), `${portal.name}: user A still signed in before the warning (positive control)`).toBe(true);
    expect(await isSignedIn(portal, tabB, 5_000), `${portal.name}: user B still signed in before the warning (positive control)`).toBe(true);
    expect(await popupVisible(portal, tabB), `${portal.name}: user B must have no pop-up before limit − warning`).toBe(false);
    expect(await popupVisible(portal, tabA), `${portal.name}: user A must have no pop-up before limit − warning`).toBe(false);

    await ctx.clock.runFor(toPopupSure(cfg));
    await expect(popup(portal, tabB).stay, `${portal.name}: the idle user B must get the pop-up by ${sure}`).toBeVisible({ timeout: 10_000 });
    await expect(popup(portal, tabA).stay, `${portal.name}: user A, idle as long, must have its own pop-up by ${sure}`).toBeVisible({ timeout: 10_000 });

    await popup(portal, tabA).stay.click();
    await expect(popup(portal, tabA).stay, `${portal.name}: "Stay signed in" must close user A's pop-up`).toBeHidden({ timeout: 10_000 });
    expect(await popupVisible(portal, tabB), `${portal.name}: "Stay signed in" for user A must not close user B's pop-up`).toBe(true);

    // A carries on; B stays idle past the limit.
    await idleFor(ctx, tabA, POPUP_SURE_BEFORE_LIMIT_MS + PAST_DUE_MS);
    expect(await landsOnLogin(portal, tabB), `${portal.name}: user B, idle in its own window, must be signed out at the limit even though user A is active in the same browser`).toBe(true);
    expect(await isSignedIn(portal, tabA, 5_000), `${portal.name}: the active user A must stay signed in`).toBe(true);
  } finally {
    await ctx.close();
  }
}

export { PORTALS, isSignedIn, opensLoginGate, tokenStatus };
