/**
 * `test` with the project's saved session restored into sessionStorage.
 *
 * In plain words: the setup projects sign in once and save that login to a file
 * (auth.json for the configurator, auth-api.json for the API projects), and a
 * test that uses the project's storageState starts already signed in. Those
 * files can only hold cookies and localStorage. On builds with per-tab sessions
 * the apps keep the session in sessionStorage, so the setup
 * projects also save that half (auth-session.json / auth-api-session.json),
 * and this file puts it back into each tab of the test, before the page loads.
 *
 * Specs import `test` (and anything else from @playwright/test) from here:
 *
 *     import { test, expect } from '../utils/session-test';
 *
 * It changes nothing for a spec that overrides storageState
 * (`test.use({ storageState: { cookies: [], origins: [] } })`) or signs in by
 * itself: the replay only runs when the project's storageState is a file that
 * has a saved session next to it.
 *
 * Each tab is seeded ONCE (a marker key in its sessionStorage), so a test that
 * logs out stays logged out when the app navigates or reloads afterwards.
 */
import { test as base } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sessionFileFor, type SavedTabSession } from './session-storage';

export * from '@playwright/test';

export const test = base.extend({
  context: async ({ context, storageState }, use) => {
    if (typeof storageState === 'string') {
      const file = path.resolve(sessionFileFor(storageState));
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedTabSession;
        await context.addInitScript(({ origin, entries }) => {
          if (location.origin !== origin) return;
          const MARK = '__pw_replayed_session';
          if (sessionStorage.getItem(MARK)) return;
          for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v);
          sessionStorage.setItem(MARK, '1');
        }, saved);
      }
    }
    await use(context);
  },
});
