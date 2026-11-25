# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: employee/change-password-visibility-812.spec.ts >> employee account — password action visibility #812 >> Account and security shows a styled password button
- Location: tests/employee/change-password-visibility-812.spec.ts:21:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /password/i }).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('button', { name: /password/i }).first()

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - img "State Logo" [ref=e9]
    - generic [ref=e10]:
      - button "Net-Two·1 department·2 roles" [ref=e13] [cursor=pointer]:
        - generic "Net-Two · 1 department · 2 roles" [ref=e14]: Net-Two·1 department·2 roles
      - generic [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: en
        - img [ref=e21]
      - generic [ref=e26] [cursor=pointer]:
        - generic [ref=e27]: G
        - img [ref=e29]
  - generic:
    - generic [ref=e32]:
      - generic [ref=e33]:
        - generic "Home" [ref=e35] [cursor=pointer]:
          - img [ref=e37]
          - generic [ref=e40]: Home
        - generic [ref=e41]:
          - generic [ref=e42]: Complaints
          - generic "File a Complaint" [ref=e44] [cursor=pointer]:
            - img [ref=e46]
            - generic [ref=e49]: File a Complaint
          - generic "Search Complaint" [ref=e51] [cursor=pointer]:
            - img [ref=e53]
            - generic [ref=e56]: Search Complaint
      - generic [ref=e57]:
        - button "Logout" [ref=e58] [cursor=pointer]:
          - img [ref=e59]
          - generic [ref=e62]: Logout
        - img "eGov Foundation" [ref=e64]
    - button "Close sidebar" [expanded] [ref=e65] [cursor=pointer]:
      - img [ref=e66]
  - main [ref=e69]:
    - generic [ref=e70]:
      - heading "Account and security" [level=1] [ref=e71]
      - heading "emp_0001@NETTWO.kc.local" [level=2] [ref=e73]
      - generic [ref=e74]:
        - heading "Signed-in sessions" [level=2] [ref=e75]
        - list
        - generic [ref=e76]:
          - button "Sign out other sessions" [ref=e77]
          - button "Sign out everywhere" [ref=e78]
          - button "Logout" [ref=e79]
```

# Test source

```ts
  1  | /**
  2  |  * Employee password action is a visible button (CCRS #812).
  3  |  *
  4  |  * #812 was a "Change password" control that rendered as plain text. Since
  5  |  * #1999 the profile's change-password form is gone: identity-managed staff
  6  |  * reach Keycloak's UPDATE_PASSWORD action from "Account and security"
  7  |  * (UserProfile.js -> /employee/user/account, IdentityAccount.js). This
  8  |  * spec walks that path and keeps the original styling assertion on the
  9  |  * password button. UPDATE_PASSWORD is in keycloak/realm.json's
  10 |  * clientPolicy.accountActions, so the button is expected on every deployment.
  11 |  */
  12 | import { test, expect } from '@playwright/test';
  13 | import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
  14 | import { loginViaApi } from '../utils/auth';
  15 | import { surfacePath } from '../utils/identity-bff';
  16 | 
  17 | 
  18 | test.describe('employee account — password action visibility #812', () => {
  19 |   test.use({ storageState: { cookies: [], origins: [] } });
  20 | 
  21 |   test('Account and security shows a styled password button', { tag: ['@persona:employee'] }, async ({ page }) => {
  22 |     await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  23 | 
  24 |     await page.goto(`${BASE_URL}${surfacePath('employee', 'user/profile')}?cb=${Date.now()}`);
  25 |     const accountButton = page.getByRole('button', { name: /account and security/i });
  26 |     await expect(accountButton, 'identity-managed profile must link to Account and security').toBeVisible({ timeout: 15_000 });
  27 |     await accountButton.click();
  28 | 
  29 |     await expect(page).toHaveURL(/\/employee\/user\/account/);
  30 |     await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });
  31 | 
  32 |     // IdentityAccount.js ACTIONS.UPDATE_PASSWORD: "Set or update password".
  33 |     const passwordButton = page.getByRole('button', { name: /password/i }).first();
> 34 |     await expect(passwordButton).toBeVisible({ timeout: 15_000 });
     |                                  ^ Error: expect(locator).toBeVisible() failed
  35 | 
  36 |     // The #812 assertion: a real button surface, not transparent or white text.
  37 |     const backgroundColor = await passwordButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  38 |     expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  39 |     expect(backgroundColor).not.toBe('rgb(255, 255, 255)');
  40 |   });
  41 | });
  42 | 
```