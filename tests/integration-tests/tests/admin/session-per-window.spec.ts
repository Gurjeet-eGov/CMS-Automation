/**
 * Configurator — a session belongs to one window (requirements §1.2–1.4).
 *
 * Requirement: after sign-in the session token lives in the tab's session
 * storage, so a new window or tab asks for login again; a different configurator user can
 * sign in there; logout expires the token on the server, ending every session
 * of that user (same browser and another browser) and no one else's.
 * Manual cases SEC/040–SEC/044. Same checks as employee/session-per-window.spec.ts,
 * without the employee-only inbox cases.
 *
 * Steps live in utils/session-checks.ts (identical for the three UIs); sign-in
 * is a fresh API sign-in per test, except the first test, which signs in through the form.
 * Users: two employees from PERSONA_CANDIDATES (any employee may sign in to the configurator on 2.12.1); see secrets.example.
 */
import { test } from '../utils/session-test';
import {
  PORTALS,
  browserNewTabMeansAskLogin,
  closedWindowAsksLogin,
  logoutEndsOnlyThatUser,
  newTabAsksLogin,
  twoUsersStayIndependent,
  usersFor,
} from '../utils/session-checks';

const portal = PORTALS.configurator;
const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:admin'];

/** Users for one test, or a skip reason (from secrets.env). */
async function users() {
  const u = await usersFor('configurator');
  test.skip('skip' in u, 'skip' in u ? u.skip : '');
  return u as Exclude<typeof u, { skip: string }>;
}

test.describe('configurator — session belongs to one window', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a new window, or a new tab with the URL typed in, asks for login @SEC/040', {
    annotation: {
      type: 'description',
      description: `SEC/040: the session lives in one tab; any other new tab or window of the same browser asks for login.

Steps:
1. In one browser, sign configurator user A in through the sign-in form (tab 1).
2. Open a new tab and type a protected URL; assert it shows the sign-in page and holds no token.
3. Reload tab 1; assert it is still signed in (positive control).
4. Open another new window on the home page; assert it asks for login.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    const u = await users();
    await newTabAsksLogin(portal, browser, u.a);
  });

  test('two different users in two windows of one browser stay independent @SEC/041', {
    annotation: {
      type: 'description',
      description: `SEC/041: one browser can hold several users, one per window, without mixing them up.

Steps:
1. In one browser, sign configurator user A in in tab 1 and configurator user B in tab 2.
2. Reload both tabs.
3. Assert each tab still holds its own user (different user ids, different tokens) and both are signed in.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    const u = await users();
    await twoUsersStayIndependent(portal, browser, u.a, u.b);
  });

  test('logout ends every session of that user, in this and another browser, but no one else\'s @SEC/042', {
    annotation: {
      type: 'description',
      description: `SEC/042: logout expires and deletes the token on the server, so all of that user's sessions end (same browser and a different browser) while other users stay signed in; the old token is refused and the next sign-in gets a new one.

Steps:
1. Browser X: configurator user A in tab 1, configurator user B in tab 2. Browser Y: configurator user A again, on a protected page.
2. Assert all three tokens are live on the server (positive control).
3. Log A out from browser X tab 1 through the UI (the Logout control); assert that tab lands on the sign-in page right away.
4. Assert both of A's tokens are refused, and A's window in browser Y, reloaded, lands on the sign-in page.
5. Assert B's token is still live and B's window still signed in.
6. Sign A in again; assert the token is new and live.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(300_000);
    const u = await users();
    await logoutEndsOnlyThatUser(portal, browser, u.a, u.b);
  });

  test('closing the window without logging out means the next tab asks for login @SEC/043', {
    annotation: {
      type: 'description',
      description: `SEC/043: a closed window takes its session with it. (Restoring a closed tab from browser history is not something Playwright can drive; it stays a manual check.)

Steps:
1. Sign configurator user A in in tab 1 and note its URL.
2. Close tab 1 without logging out.
3. Open a new tab on the same URL; assert it asks for login.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    const u = await users();
    await closedWindowAsksLogin(portal, browser, u.a);
  });

  test('a tab opened by the browser\'s own means (Ctrl/Cmd+click, middle-click, open in new tab) asks for login @SEC/044', {
    annotation: {
      type: 'description',
      description: `SEC/044: Ctrl/Cmd+click, middle-click and "open link in new tab" must ask for login. Chrome's Duplicate tab copies session storage and cannot be driven from Playwright — it stays a manual check.

Steps:
1. Sign configurator user A in in tab 1 and open the home page.
2. Ctrl/Cmd+click an in-app link; assert the new tab asks for login. Repeat with a middle-click.
3. Open tab 1's URL in a new tab; assert it asks for login.
4. Reload tab 1; assert it is still signed in (positive control).`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(180_000);
    const u = await users();
    await browserNewTabMeansAskLogin(portal, browser, u.a);
  });
});
