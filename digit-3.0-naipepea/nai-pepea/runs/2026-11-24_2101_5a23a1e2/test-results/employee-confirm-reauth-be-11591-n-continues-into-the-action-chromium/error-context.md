# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: employee/confirm-reauth-before-account-action-2645.spec.ts >> employee account — confirm it is you before an account action #2645 >> Set or update password asks to confirm, then continues into the action
- Location: tests/employee/confirm-reauth-before-account-action-2645.spec.ts:42:7

# Error details

```
Error: the employee surface must offer UPDATE_PASSWORD (digit.auth.account.actions)

expect(received).toContain(expected) // indexOf

Expected value: "UPDATE_PASSWORD"
Received array: []
```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - img "State Logo" [ref=e9]
    - generic [ref=e10]:
      - generic [ref=e14] [cursor=pointer]:
        - generic [ref=e15]: en
        - img [ref=e17]
      - generic [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: G
        - img [ref=e25]
  - generic:
    - generic [ref=e28]:
      - generic [ref=e30]:
        - generic [ref=e31]: Complaints
        - generic "File a Complaint" [ref=e33] [cursor=pointer]:
          - img [ref=e35]
          - generic [ref=e38]: File a Complaint
        - generic "Search Complaint" [ref=e40] [cursor=pointer]:
          - img [ref=e42]
          - generic [ref=e45]: Search Complaint
      - generic [ref=e46]:
        - button "Logout" [ref=e47] [cursor=pointer]:
          - img [ref=e48]
          - generic [ref=e51]: Logout
        - generic [ref=e52]:
          - img "eGov Foundation"
    - button "Close sidebar" [expanded] [ref=e53] [cursor=pointer]:
      - img [ref=e54]
  - main [ref=e57]:
    - generic [ref=e58]:
      - heading "Account and security" [level=1] [ref=e59]
      - generic [ref=e60]:
        - button "Try again" [disabled]
```

# Test source

```ts
  1  | /**
  2  |  * Account actions ask for the password again as a confirmation (CCRS #2645).
  3  |  *
  4  |  * From /<slug>/digit-ui/employee/user/account, "Set or update password" sends
  5  |  * the person to Keycloak with kc_action. The digit-employee theme then says
  6  |  * "Confirm it's you to change your password" and offers Cancel back to the
  7  |  * account page. The person types the email as for any sign-in; no username is
  8  |  * passed in the URL. Signing in continues into the action: the update-password
  9  |  * form.
  10 |  *
  11 |  * The password is typed on a hosted page, so tracing is off for this file
  12 |  * (the same rule as hostedSignIn's guard). The update-password form is never
  13 |  * submitted, so the persona's password is unchanged.
  14 |  */
  15 | import { test, expect } from '@playwright/test';
  16 | import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
  17 | import { loginViaApi } from '../utils/auth';
  18 | import { surfacePath } from '../utils/identity-bff';
  19 | 
  20 | test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });
  21 | 
  22 | test.describe('employee account — confirm it is you before an account action #2645', () => {
  23 |   async function openPasswordAction(page: import('@playwright/test').Page) {
  24 |     await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  25 |     await page.goto(`${BASE_URL}${surfacePath('employee', 'user/account')}?cb=${Date.now()}`);
  26 |     await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });
  27 |     // IdentityAccount.js renders the h1 at once but the buttons only after the
  28 |     // session (account.actions) loads, so never decide on the button before that.
  29 |     // account.actions comes from the surface client's digit.auth.account.actions.
  30 |     const session = await page.request.get(`${BASE_URL}/identity/v1/session?surface=employee&include=account`);
  31 |     expect(session.ok(), 'identity session with account metadata').toBe(true);
  32 |     const actions: string[] = (await session.json()).account?.actions ?? [];
  33 |     // Configured but not rendered, or not configured at all, is a failure: this
  34 |     // test exists to prove the confirmation, so it must not skip.
> 35 |     expect(actions, 'the employee surface must offer UPDATE_PASSWORD (digit.auth.account.actions)').toContain('UPDATE_PASSWORD');
     |                                                                                                     ^ Error: the employee surface must offer UPDATE_PASSWORD (digit.auth.account.actions)
  36 |     const passwordButton = page.getByRole('button', { name: /set or update password/i });
  37 |     await passwordButton.waitFor({ timeout: 15_000 });
  38 |     await passwordButton.click();
  39 |     await expect(page.locator('#kc-page-title')).toContainText(/confirm it.s you/i, { timeout: 30_000 });
  40 |   }
  41 | 
  42 |   test('Set or update password asks to confirm, then continues into the action',
  43 |     { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
  44 |       await openPasswordAction(page);
  45 |       await expect(page.locator('#kc-page-title')).toContainText(/change your password/i);
  46 | 
  47 |       await page.locator('input[name="username"]').fill(ADMIN_USER);
  48 |       await page.locator('#password').fill(ADMIN_PASS);
  49 |       const consent = page.locator('#privacy-component-check');
  50 |       if (await consent.count()) await consent.check({ force: true });
  51 |       await page.locator('#kc-login, button[type="submit"]').first().click();
  52 | 
  53 |       await expect(page.locator('#password-new')).toBeVisible({ timeout: 30_000 });
  54 |       await expect(page.locator('#password-confirm')).toBeVisible();
  55 |     });
  56 | 
  57 |   test('Cancel on the confirmation returns to the account page',
  58 |     { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
  59 |       await openPasswordAction(page);
  60 |       await page.locator('#kc-cancel').click();
  61 |       await expect(page).toHaveURL(/\/employee\/user\/account/, { timeout: 30_000 });
  62 |       await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });
  63 |     });
  64 | });
  65 | 
```