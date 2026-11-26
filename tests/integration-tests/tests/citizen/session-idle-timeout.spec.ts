/**
 * Citizen UI — inactivity limit (requirements §1.5).
 *
 * Requirement: each session has an inactivity limit (3 minutes on the test
 * environment, 15 in production, configurable). One minute before it, a pop-up
 * offers "Stay signed in" or "Log out" (the UI says "Sign out now"). Any user event resets the counter; at
 * the limit the user is signed out automatically, the token is expired, and
 * the sign-in page says why. The same user stays signed in while active in any
 * one tab of a browser; each browser has its own counter.
 * Manual cases SEC/033–SEC/037, SEC/039 and SEC/055.
 *
 * How: the BROWSER clock is faked (context.clock), so the limit runs in
 * seconds; the server-side "token expired" checks use the real API. The limit
 * is 15 minutes unless the environment's config.env sets
 * SESSION_IDLE_LIMIT_SECONDS (the test environment uses 180); the pop-up always
 * comes 60 s before it. SEC/039 ("the limit comes from configuration") is these
 * same tests run without that setting. The pop-up is found by its structure
 * (utils/ui-sign-in.ts idlePopup), not its wording; the inactivity message is
 * found as the text the sign-in page shows that a freshly opened copy does not.
 *
 * Not automated: SEC/038 (phone lock / background tab) — a fake clock cannot model a throttled or
 * suspended tab. Users: fresh throwaway citizens (registered through the API, signed in through the OTP form — OTP from the SMS sink or FIXED_OTP).
 */
import { test } from '../utils/session-test';
import {
  PORTALS,
  activeInAnyTabKeepsSession,
  differentUsersTimeOutIndependently,
  perBrowserCounters,
  halfFilledFormNotKept,
  idleConfig,
  ignoredPopupSignsOutAtLimit,
  popupThenStayThenSignOut,
  userEventsResetTimer,
  usersFor,
} from '../utils/session-checks';

const portal = PORTALS.citizen;
const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'];

/** The idle settings and users for one test, or a skip reason naming what is missing. */
async function setup() {
  const cfg = idleConfig();
  test.skip('skip' in cfg, 'skip' in cfg ? cfg.skip : '');
  const u = await usersFor('citizen');
  test.skip('skip' in u, 'skip' in u ? u.skip : '');
  return { cfg: cfg as Exclude<typeof cfg, { skip: string }>, u: u as Exclude<typeof u, { skip: string }> };
}

test.describe('citizen — inactivity limit', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the pop-up appears one warning period before the limit (showing by 30 s before it); Stay signed in resets it; Sign out now signs out with no inactivity message @SEC/033', {
    annotation: {
      type: 'description',
      description: `SEC/033: pop-up timing and its two buttons.

Steps:
1. Install a fake browser clock; sign citizen A in through the API.
2. Advance to 10 s before limit − warning (limit − 70 s); assert still signed in and no pop-up.
3. Advance to 30 s before the limit (the pop-up is due 60 s before but can be a few seconds late); assert the pop-up shows both buttons.
4. Click "Stay signed in"; assert the pop-up closes and does not return within another limit − warning.
5. Advance to 30 s before the restarted limit; assert it is back; click "Sign out now"; assert the sign-in page shows no inactivity message and the token is refused by the server.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    const { cfg, u } = await setup();
    await popupThenStayThenSignOut(portal, browser, u.a, cfg);
  });

  test('an ignored pop-up signs the user out at the limit, with the inactivity message, and expires the token @SEC/034 @SEC/039', {
    annotation: {
      type: 'description',
      description: `SEC/034: automatic sign-out at the limit. Also SEC/039: the sign-out happens at the CONFIGURED limit (SESSION_IDLE_LIMIT_SECONDS, else the 15-minute default); the limit used is recorded on the result.

Steps:
1. Install a fake browser clock; sign citizen A in; assert the token is live (positive control).
2. Advance to 10 s before the limit; assert still signed in. Advance past the limit.
3. Assert the sign-in page is shown with a message a fresh sign-in page does not have.
4. Assert the old token is refused by the server.
5. Sign in again; assert a new, live token.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    const { cfg, u } = await setup();
    await ignoredPopupSignsOutAtLimit(portal, browser, u.a, cfg);
  });

  test('a half-filled form is not kept across the automatic sign-out @SEC/034', {
    annotation: {
      type: 'description',
      description: `SEC/034 (third point): what was typed before the automatic sign-out does not come back.

Steps:
1. Install a fake browser clock; sign citizen A in; open a form page and type a unique marker into its first text field (positive control: the field holds it).
2. Advance past the limit; assert signed out.
3. Sign in again and open the same form page; assert no field holds the marker.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    const { cfg, u } = await setup();
    await halfFilledFormNotKept(portal, browser, u.a, cfg);
  });

  test('user events reset the timer; the app\'s background calls do not @SEC/035', {
    annotation: {
      type: 'description',
      description: `SEC/035: mouse move, click, key press and scroll reset the counter; background requests (which keep running while the clock advances) do not.

Steps:
1. Install a fake browser clock; sign citizen A in.
2. Advance to 10 s before limit − warning; move the mouse, scroll, press a key, click.
3. Advance the same again; assert no pop-up and still signed in (the total passed the warning time, so only the reset explains it).
4. With no user events, advance to 30 s before the limit; assert the pop-up is showing.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(240_000);
    const { cfg, u } = await setup();
    await userEventsResetTimer(portal, browser, u.a, cfg);
  });

  test('the same user on several tabs of one browser stays signed in while active on any one of them @SEC/036', {
    annotation: {
      type: 'description',
      description: `SEC/036: activity in one tab keeps the user's other tabs alive.

Steps:
1. Install a fake browser clock; sign citizen A in in tab 1 and again in tab 2 of the same browser.
2. Keep tab 2 active in steps while the clock passes the limit.
3. Assert tab 1 (idle) is still signed in with no pop-up.
4. Stop all activity and pass the limit; assert the session ends (control).`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(300_000);
    const { cfg, u } = await setup();
    await activeInAnyTabKeepsSession(portal, browser, u.a, cfg);
  });

  test('each browser has its own counter; an automatic sign-out in one ends the same user\'s session in the other @SEC/037', {
    annotation: {
      type: 'description',
      description: `SEC/037: the same citizen signed in in two browsers. Each browser's idle counter runs on its own activity; when one signs out automatically, the shared token ends, so the other browser's session ends too.

Steps:
1. Browser X and browser Y, each with its own fake clock; sign citizen A in in both; X's token is live (positive control).
2. Let browser Y pass the limit (no activity there); assert Y lands on the sign-in page.
3. Assert browser X shows no pop-up (its counter did not move with Y's).
4. Assert X's token is now refused by the server: the automatic sign-out in Y ended the session.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(300_000);
    const { cfg, u } = await setup();
    await perBrowserCounters(portal, browser, u.a, cfg);
  });

  test('two different citizens in two windows of one browser time out independently @SEC/055', {
    annotation: {
      type: 'description',
      description: `SEC/055: two different citizens in two windows of the same browser each have their own idle timer — the idle one gets the pop-up and is signed out at the limit, "Stay signed in" for one must not touch the other's pop-up, and activity by one must not keep the other signed in. (Edge case, logged.)

Steps:
1. One browser with a fake clock: citizen A in window 1, citizen B in window 2 (both through the API); both start idle at the same moment.
2. Advance to 10 s before limit − warning; assert both still signed in and neither has a pop-up.
3. Advance to 30 s before the limit; assert B has the pop-up, and A has its own.
4. Click "Stay signed in" in A's window; assert A's pop-up closes and B's pop-up is still showing.
5. User events in A's window, then advance past B's limit; assert B is signed out (sign-in page) and A is still signed in.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(300_000);
    const { cfg, u } = await setup();
    await differentUsersTimeOutIndependently(portal, browser, u.a, u.b, cfg);
  });
});
