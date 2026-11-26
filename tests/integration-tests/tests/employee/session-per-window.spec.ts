/**
 * Employee UI — a session belongs to one window (requirements §1.2–1.4).
 *
 * Requirement: after sign-in the session token lives in the tab's session
 * storage, so a new window or tab asks for login again; a different employee
 * can sign in there; logout expires the token on the server, ending every
 * session of that user (same browser and another browser) and no one else's.
 * The inbox's "Open in new tab" is the one way to open a complaint in a new tab
 * already signed in as the same user; every other way asks for login.
 * Manual cases SEC/013–SEC/020.
 *
 * Steps live in utils/session-checks.ts (identical for the three UIs); sign-in
 * is a fresh API sign-in per test, except the first test, which signs in through the form.
 * User A and B are two employees from PERSONA_CANDIDATES (secrets.example):
 * logout ends every session of a user, so the admin and shared personas are
 * never used here. The inbox checks (SEC/018–020) work a complaint, so their
 * employee A is CITY_ADMIN_USER — an employee with the CMS roles
 * (workflowEmployee()); its other employee is a candidate.
 */
import { test, expect } from '../utils/session-test';
import { seedComplaintAsCitizen } from '../utils/seed';
import {
  PORTALS,
  browserNewTabMeansAskLogin,
  closedWindowAsksLogin,
  endsSignedOut,
  isSignedIn,
  logoutEndsOnlyThatUser,
  newTabAsksLogin,
  openFromInboxInNewTab,
  serviceCodeInDepartmentOf,
  tokenStatus,
  twoUsersStayIndependent,
  usersFor,
  workflowEmployee,
} from '../utils/session-checks';
import type { Credential } from '../utils/ui-sign-in';

const portal = PORTALS.employee;
const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:employee'];

let users: { a: Credential; b: Credential } | null = null;
let usersSkip = '';
/** Employee A of the inbox checks: CITY_ADMIN_USER. */
let worker: Credential | null = null;
let workerSkip = '';
let srid = '';
let seedSkip = '';

test.describe('employee — session belongs to one window', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const u = await usersFor('employee');
    if ('skip' in u) usersSkip = u.skip;
    else users = u;
    const w = await workflowEmployee();
    if ('skip' in w) workerSkip = w.skip;
    else worker = w;
    if (!worker) return;
    try {
      // File it with a complaint type of the inbox employee's own department, so
      // department filtering puts it in that inbox (the type comes from the
      // deployment profile).
      const dept = await serviceCodeInDepartmentOf(worker);
      srid = (
        await seedComplaintAsCitizen({ description: 'session checks: inbox open-in-new-tab', ...(dept.code ? { serviceCode: dept.code } : {}) })
      ).srid;
    } catch (e: any) {
      seedSkip = `could not file a complaint to open from the inbox: ${String(e?.message ?? e).slice(0, 200)}`;
    }
  });

  test('a new window, or a new tab with the URL typed in, asks for login @SEC/013', {
    annotation: {
      type: 'description',
      description: `SEC/013: the session lives in one tab; any other new tab or window of the same browser asks for login.

Steps:
1. In one browser, sign employee A in through the login form (tab 1).
2. Open a new tab and type a protected URL (the profile page); assert it shows the login page and holds no token.
3. Reload tab 1; assert it is still signed in (positive control).
4. Open another new window on the employee home; assert it asks for login.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(150_000);
    test.skip(!!usersSkip, usersSkip);
    await newTabAsksLogin(portal, browser, users!.a);
  });

  test('two different employees in two windows of one browser stay independent @SEC/014', {
    annotation: {
      type: 'description',
      description: `SEC/014: one browser can hold several employees, one per window, without mixing them up.

Steps:
1. In one browser, sign employee A in in tab 1 and employee B in tab 2.
2. Reload both tabs.
3. Assert each tab still holds its own user (different user ids, different tokens) and both are signed in.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!!usersSkip, usersSkip);
    await twoUsersStayIndependent(portal, browser, users!.a, users!.b);
  });

  test('logout ends every session of that employee, in this and another browser, but no one else\'s @SEC/015', {
    annotation: {
      type: 'description',
      description: `SEC/015: logout expires and deletes the token on the server, so all of that user's sessions end (same browser and a different browser) while other users stay signed in; the old token is refused and the next sign-in gets a new one.

Steps:
1. Browser X: employee A in tab 1, employee B in tab 2. Browser Y: employee A again, on a protected page.
2. Assert all three tokens are live on the server (positive control).
3. Log A out from browser X tab 1 through the profile menu (the Logout control); assert that tab lands on the sign-in page right away.
4. Assert both of A's tokens are refused by the server, and A's window in browser Y, reloaded, lands on the sign-in page.
5. Assert B's token is still live and B's window still signed in.
6. Sign A in again; assert the token is new and live.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!!usersSkip, usersSkip);
    await logoutEndsOnlyThatUser(portal, browser, users!.a, users!.b);
  });

  test('closing the window without logging out means the next tab asks for login @SEC/016', {
    annotation: {
      type: 'description',
      description: `SEC/016: a closed window takes its session with it. (Restoring a closed tab from browser history is not something Playwright can drive; it stays a manual check.)

Steps:
1. Sign employee A in in tab 1 and note its URL.
2. Close tab 1 without logging out.
3. Open a new tab on the same URL; assert it asks for login.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(150_000);
    test.skip(!!usersSkip, usersSkip);
    await closedWindowAsksLogin(portal, browser, users!.a);
  });

  test('a tab opened by the browser\'s own means (Ctrl/Cmd+click, middle-click, open in new tab) asks for login @SEC/017', {
    annotation: {
      type: 'description',
      description: `SEC/017: only the inbox option opens a signed-in tab; Ctrl/Cmd+click, middle-click and "open link in new tab" must ask for login. Chrome's Duplicate tab copies session storage and cannot be driven from Playwright — it stays a manual check.

Steps:
1. Sign employee A in in tab 1 and open the employee home.
2. Ctrl/Cmd+click an in-app link; assert the new tab asks for login. Repeat with a middle-click.
3. Open tab 1's URL in a new tab; assert it asks for login.
4. Reload tab 1; assert it is still signed in (positive control).`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!!usersSkip, usersSkip);
    await browserNewTabMeansAskLogin(portal, browser, users!.a);
  });

  test('inbox "Open in new tab" opens the complaint already signed in as the same employee @SEC/018', {
    annotation: {
      type: 'description',
      description: `SEC/018: the inbox option is the sanctioned way to work several complaints in parallel tabs.

Employee A is CITY_ADMIN_USER, an employee with the CMS roles.

Steps:
1. File a complaint as a citizen through the API, with a complaint type of employee A's department (beforeAll).
2. Sign employee A in through the API and open the inbox; find the complaint's row (positive control; if it is not listed, any row with the button).
3. Click the row's "Open in new tab" button (button.pgr-open-new-tab whose aria-label holds the complaint id).
4. Assert the new tab is signed in, as employee A, on that complaint.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!!workerSkip, workerSkip);
    test.skip(!!seedSkip, seedSkip);
    const ctx = await browser.newContext();
    try {
      const tab1 = await ctx.newPage();
      await portal.signInViaApi(tab1, worker!);
      const uidA = await portal.readUserId(tab1);
      const { tab: opened, srid: shown } = await openFromInboxInNewTab(tab1, srid);
      expect(await isSignedIn(portal, opened), 'the tab opened from the inbox must be signed in').toBe(true);
      expect(await portal.readUserId(opened), 'the opened tab must be signed in as the same employee').toBe(uidA);
      expect(opened.url(), 'the opened tab must show the chosen complaint').toContain(shown);
    } finally {
      await ctx.close();
    }
  });

  test('a tab opened from the inbox follows its own employee when another employee is signed in elsewhere @SEC/019', {
    annotation: {
      type: 'description',
      description: `SEC/019: with employee B signed in in another tab of the same browser, "Open in new tab" from A's inbox must open as A, never as B.

Employee A is CITY_ADMIN_USER; employee B is a PERSONA_CANDIDATES employee.

Steps:
1. Same browser: employee A in tab 1, employee B in tab 2 (both through the API).
2. From tab 1's inbox, open the seeded complaint with "Open in new tab".
3. Assert the new tab's user is A (not B) and tab 2 is still B.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!!workerSkip, workerSkip);
    test.skip(!!usersSkip, usersSkip);
    test.skip(!!seedSkip, seedSkip);
    const ctx = await browser.newContext();
    try {
      const tabA = await ctx.newPage();
      await portal.signInViaApi(tabA, worker!);
      const tabB = await ctx.newPage();
      await portal.signInViaApi(tabB, users!.a);
      const [uidA, uidB] = [await portal.readUserId(tabA), await portal.readUserId(tabB)];
      expect(uidA).not.toBe(uidB);
      const { tab: opened } = await openFromInboxInNewTab(tabA, srid);
      expect(await portal.readUserId(opened), 'the opened tab must belong to employee A').toBe(uidA);
      expect(await portal.readUserId(tabB), 'employee B\'s tab must be untouched').toBe(uidB);
    } finally {
      await ctx.close();
    }
  });

  test('logout from a tab opened from the inbox logs out all of that employee\'s tabs @SEC/020', {
    annotation: {
      type: 'description',
      description: `SEC/020: logging out in any one of the employee's tabs ends the others too.

Employee A is CITY_ADMIN_USER (this test logs it out).

Steps:
1. Sign employee A in in tab 1; open the seeded complaint from the inbox in a new tab.
2. Log out from the opened tab with the Logout button; assert that tab lands on the login page.
3. Assert A's token is refused by the server and tab 1, reloaded, is no longer signed in.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!!workerSkip, workerSkip);
    test.skip(!!seedSkip, seedSkip);
    const ctx = await browser.newContext();
    try {
      const tab1 = await ctx.newPage();
      await portal.signInViaApi(tab1, worker!);
      const token = await portal.readToken(tab1);
      expect(await tokenStatus(token), 'A\'s token must be live first (positive control)').toBe(200);
      const { tab: opened } = await openFromInboxInNewTab(tab1, srid);
      await portal.logout(opened);
      expect(await tokenStatus(token), 'A\'s token must be refused after logging out from the opened tab').not.toBe(200);
      await tab1.reload({ waitUntil: 'domcontentloaded' });
      expect(await endsSignedOut(portal, tab1), 'tab 1 must no longer be signed in (it must land on the login page)').toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
