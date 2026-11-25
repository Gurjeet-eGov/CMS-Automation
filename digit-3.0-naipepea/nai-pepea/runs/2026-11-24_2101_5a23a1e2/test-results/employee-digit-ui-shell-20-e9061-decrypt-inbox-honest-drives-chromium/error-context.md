# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: employee/digit-ui-shell-2026-05-31.spec.ts >> employee digit-ui shell bundle >> hosted sign-in + chrome + visible decrypt + inbox honest drives
- Location: tests/employee/digit-ui-shell-2026-05-31.spec.ts:50:7

# Error details

```
Error: #505 sub-3 — the sign-in header logo must render. It comes from MDMS common-masters.StateInfo.logoUrl (logoUrlWhite on the dark banner), which is empty for this workspace, so the page shows the workspace name instead.

expect(locator).toBeVisible() failed

Locator: locator('.dg-banner-header__logo').first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - #505 sub-3 — the sign-in header logo must render. It comes from MDMS common-masters.StateInfo.logoUrl (logoUrlWhite on the dark banner), which is empty for this workspace, so the page shows the workspace name instead. with timeout 15000ms
  - waiting for locator('.dg-banner-header__logo').first()

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e6]:
    - paragraph [ref=e9]: Net-Two
    - banner [ref=e10]:
      - heading "Login" [level=1] [ref=e11]
    - generic [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]: User Name*
        - textbox "User Name" [ref=e16]
      - generic [ref=e17]:
        - generic [ref=e18]: Password*
        - generic [ref=e19]:
          - textbox "Password" [ref=e20]
          - button "Show password" [ref=e21] [cursor=pointer]:
            - img [ref=e22]
      - generic [ref=e25]:
        - generic [ref=e26]:
          - checkbox "I agree to the DIGIT's" [ref=e27] [cursor=pointer]
          - img [ref=e29] [cursor=pointer]
          - generic [ref=e31]: I agree to the DIGIT's
        - group [ref=e32]:
          - generic "Privacy Policy" [ref=e33] [cursor=pointer]:
            - generic [ref=e34]: Privacy Policy
      - button "Login" [disabled]
      - button "Forgot Password?" [ref=e35] [cursor=pointer]
  - link "Powered by DIGIT" [ref=e37] [cursor=pointer]:
    - /url: https://www.digit.org/
    - img "Powered by DIGIT" [ref=e38]
```

# Test source

```ts
  37  |  *      PENDINGATLME and leaves assigned, specifically so a spec like this one
  38  |  *      has a real "assigned to an employee" SRID on the live deployment)
  39  |  *   -> '' (no cross-deployment fallback — an SRID from a different tenant
  40  |  *      renders "No Results Found" and burns the #344 assertion's whole
  41  |  *      timeout waiting for content that was never going to appear; see
  42  |  *      pgr-details.spec.ts for the same lesson learned the hard way).
  43  |  */
  44  | const ASSIGNED_COMPLAINT_ID =
  45  |   process.env.ASSIGNED_COMPLAINT_ID || _fixtures?.complaints?.assigned_to_employee || '';
  46  | 
  47  | test.describe('employee digit-ui shell bundle', () => {
  48  |   test.use({ storageState: { cookies: [], origins: [] } });
  49  | 
  50  |   test('hosted sign-in + chrome + visible decrypt + inbox honest drives', {
  51  |     annotation: {
  52  |       type: 'description',
  53  |       description: `One pass through the employee app's sign-in and shell, covering #592, #505, #622, #344 and #432.
  54  | 
  55  | Steps:
  56  | 1. A complaint assigned to an employee exists (lifecycle setup, or ASSIGNED_COMPLAINT_ID).
  57  | 2. #592: /digit-ui/globalConfigs.js is served and names the state tenant.
  58  | 3. #505 sub-1: the hosted sign-in page renders its brand banner, not white.
  59  | 4. #505 sub-3: the sign-in header logo renders and loads. The page takes it from MDMS common-masters.StateInfo (logoUrl / logoUrlWhite); when both are empty it shows the workspace name instead, and this step fails saying so.
  60  | 5. #622: signing in completes and the employee shell mounts (no 503 / "Something went wrong").
  61  | 6. #505 sub-2: the header shows the signed-in user's initial.
  62  | 7. #505 sub-4: dropdown icons render dark, not white-on-white.
  63  | 8. #344: the assigned complaint's details show the citizen's name and mobile decrypted, not as hex.
  64  | 9. #432: the inbox mounts, every row is in an open workflow state, the status filter is populated, and only the sortable column has a sort icon.`,
  65  |     },
  66  |     tag: ['@persona:employee'],
  67  |   }, async ({ page }) => {
  68  |     // This test used to carry an unconditional `test.fixme(true, …)` blaming
  69  |     // two onboarding-data gaps. Both claims were false and are now retired:
  70  |     //   * "#344 needs a seeded ASSIGNED_COMPLAINT_ID" — lifecycle.setup.ts DOES
  71  |     //     seed one (lifecycle-fixtures.json -> complaints.assigned_to_employee),
  72  |     //     which is exactly what the resolution chain above reads.
  73  |     //   * "#505 brand chrome needs tenant branding onboarded" — the sign-in
  74  |     //     banner renders its brand colour from the shipped stylesheet with zero
  75  |     //     branding seeded.
  76  |     //
  77  |     // No skip guard here on purpose: an unresolved SRID is a broken
  78  |     // lifecycle-setup, not a legitimate "nothing to test" — fail loudly with the
  79  |     // cause rather than driving the UI at a blank SRID and timing out opaquely.
  80  |     expect(
  81  |       ASSIGNED_COMPLAINT_ID,
  82  |       'no assigned_to_employee complaint available — lifecycle.setup.ts did not seed one; set ASSIGNED_COMPLAINT_ID to override',
  83  |     ).not.toBe('');
  84  | 
  85  |     // ============ #592 globalConfigs.js ============
  86  |     const gcResp = await page.request.get(`${BASE_URL}${GLOBAL_CONFIGS_URL}?cb=${Date.now()}`);
  87  |     expect(gcResp.status()).toBe(200);
  88  |     expect(await gcResp.text()).toMatch(/STATE_LEVEL_TENANT_ID|stateTenantId/);
  89  | 
  90  |     // ============ #505 sub-1 + sub-3 — hosted sign-in page (Keycloak theme) ============
  91  |     // Since #1999 the employee signs in on Keycloak's digit-employee theme
  92  |     // (keycloak/theme-src EmployeeTemplate.tsx); the digit-ui form with its
  93  |     // .banner / City picker is gone. Without carousel images the card sits on
  94  |     // .dg-banner (--color-digitv2-header-sidenav), with them on .dg-carousel-shell.
  95  |     // The sign-in theme fetches its branding (MDMS common-masters.StateInfo,
  96  |     // which holds the logo URLs) while it loads; keep it to explain a missing logo.
  97  |     const brandingResp = page
  98  |       .waitForResponse(
  99  |         (r) => r.url().includes('/identity/v1/branding-api/mdms-v2/') && r.request().method() === 'POST',
  100 |         { timeout: 30_000 },
  101 |       )
  102 |       .catch(() => null);
  103 |     await page.goto(authorizeUrl(BASE_URL, 'employee'));
  104 |     await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
  105 |     const shell = page.locator('.dg-root.dg-employee').locator('.dg-banner, .dg-carousel-shell').first();
  106 |     await expect(shell, '#505 — the digit-employee theme must render its sign-in shell').toBeVisible();
  107 |     if (await page.locator('.dg-banner').count()) {
  108 |       const bannerBg = await page.locator('.dg-banner').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  109 |       expect(bannerBg, '#505 sub-1 — sign-in banner must render with a brand color, not white').not.toMatch(
  110 |         /rgba?\(\s*255\s*,\s*255\s*,\s*255/,
  111 |       );
  112 |     }
  113 | 
  114 |     /*
  115 |      * #505 sub-3: TenantHeader's logo (Chrome.tsx). SafeImage renders nothing
  116 |      * for an unset or failed src, so a broken logo shows up here as a missing
  117 |      * element; naturalWidth guards against a decoded-but-empty box too. The
  118 |      * stylesheet pins height 56px; 20px is the collapse floor, not a size pin.
  119 |      */
  120 |     const stateInfo = await brandingResp
  121 |       .then(async (r) => {
  122 |         const body = (await r?.json().catch(() => null)) as
  123 |           | { MdmsRes?: { 'common-masters'?: { StateInfo?: Array<{ logoUrl?: string; logoUrlWhite?: string }> } } }
  124 |           | null;
  125 |         return body?.MdmsRes?.['common-masters']?.StateInfo?.[0] ?? null;
  126 |       })
  127 |       .catch(() => null);
  128 |     const logoNotConfigured = !!stateInfo && !stateInfo.logoUrl && !stateInfo.logoUrlWhite;
  129 |     const logo = page.locator('.dg-banner-header__logo').first();
  130 |     await expect(
  131 |       logo,
  132 |       '#505 sub-3 — the sign-in header logo must render.' +
  133 |         (logoNotConfigured
  134 |           ? ' It comes from MDMS common-masters.StateInfo.logoUrl (logoUrlWhite on the dark banner), which is empty ' +
  135 |             'for this workspace, so the page shows the workspace name instead.'
  136 |           : ''),
> 137 |     ).toBeVisible();
      |       ^ Error: #505 sub-3 — the sign-in header logo must render. It comes from MDMS common-masters.StateInfo.logoUrl (logoUrlWhite on the dark banner), which is empty for this workspace, so the page shows the workspace name instead.
  138 |     // The CSS gives the <img> its box before the request lands: wait for the decode.
  139 |     await expect
  140 |       .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
  141 |         message: '#505 sub-3 — logo image must actually load',
  142 |         timeout: 15_000,
  143 |       })
  144 |       .toBe(true);
  145 |     const logoBox = await logo.evaluate((img: HTMLImageElement) => ({
  146 |       w: img.offsetWidth, h: img.offsetHeight, natW: img.naturalWidth, natH: img.naturalHeight,
  147 |     }));
  148 |     expect(logoBox.natW, '#505 sub-3 — logo image must actually load').toBeGreaterThan(0);
  149 |     expect(logoBox.natH, '#505 sub-3 — logo image must actually load').toBeGreaterThan(0);
  150 |     expect(logoBox.w, '#505 sub-3 logo laid-out width').toBeGreaterThanOrEqual(20);
  151 |     expect(logoBox.h, '#505 sub-3 logo laid-out height').toBeGreaterThanOrEqual(20);
  152 | 
  153 |     // ============ #622 — sign-in completes and the shell mounts ============
  154 |     // The persona signs in without the page (loginViaApi), so its password is
  155 |     // never typed into a traced browser; the hosted form above is only looked at.
  156 |     await loginViaApi(page, { tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
  157 |     await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
  158 |     await page.waitForTimeout(3_000);
  159 | 
  160 |     // ============ #505 sub-2 — header initial visible ============
  161 |     /*
  162 |      * The header renders the initial of the user's DISPLAY NAME, not of their
  163 |      * username: TopBar.js passes `userDetails.info.name` to the Dropdown's
  164 |      * `profilePic` prop, and Dropdown renders a string prop as
  165 |      * `profilePic[0].toUpperCase()`. The expectation comes from egov-user's
  166 |      * own record, not from the session the header reads: if the context
  167 |      * exchange put the username in info.name, both would agree on the wrong
  168 |      * initial.
  169 |      */
  170 |     const session = await page.evaluate(() => {
  171 |       const user = (window as any).Digit?.UserService?.getUser?.();
  172 |       return { token: user?.access_token as string, uuid: user?.info?.uuid as string, tenantId: user?.info?.tenantId as string };
  173 |     });
  174 |     const userSearch = await page.request.post(`${BASE_URL}/user/_search`, {
  175 |       data: { RequestInfo: { authToken: session.token }, tenantId: session.tenantId || TENANT, uuid: [session.uuid] },
  176 |     });
  177 |     expect(userSearch.status(), '#505 sub-2 — egov-user must return the signed-in employee').toBe(200);
  178 |     const displayName = String((await userSearch.json()).user?.[0]?.name ?? '').trim();
  179 |     expect(
  180 |       displayName,
  181 |       `#505 sub-2 — no display name in the session for ${EMPLOYEE_USER}; the header initial has no expectation to compare against`,
  182 |     ).not.toBe('');
  183 |     const expectedInitial = displayName.charAt(0).toUpperCase();
  184 |     const headerInitial = await page.evaluate((expected) => {
  185 |       const headerNodes = [
  186 |         ...document.querySelectorAll(
  187 |           'header *, [class*="topbar" i] *, [class*="TopBar" i] *, [class*="header" i] *',
  188 |         ),
  189 |       ];
  190 |       return headerNodes.find((n) => (n.textContent || '').trim() === expected) ? true : false;
  191 |     }, expectedInitial);
  192 |     expect(headerInitial, `#505 sub-2 — header must surface user initial '${expectedInitial}'`).toBe(
  193 |       true,
  194 |     );
  195 | 
  196 |     // ============ #505 sub-4 — dropdown icons rendered with dark fill ============
  197 |     const profileTrigger = page.locator('.header-dropdown-profile').first();
  198 |     if (await profileTrigger.isVisible().catch(() => false)) {
  199 |       await profileTrigger.scrollIntoViewIfNeeded();
  200 |       const btn = profileTrigger.locator('xpath=ancestor::button[1]');
  201 |       if (await btn.isVisible().catch(() => false)) await btn.click();
  202 |       else await profileTrigger.click();
  203 |       await page.waitForTimeout(1_500);
  204 | 
  205 |       await expect(page.getByText(/Edit Profile/i).first()).toBeVisible({ timeout: 8_000 });
  206 |       await expect(page.getByText(/Logout/i).first()).toBeVisible({ timeout: 8_000 });
  207 | 
  208 |       const iconColors = await page.evaluate(() => {
  209 |         const items = [...document.querySelectorAll('.header-dropdown-option, [role="menuitem"]')];
  210 |         const colors: string[] = [];
  211 |         for (const item of items) {
  212 |           const svg = item.querySelector('svg path, svg rect, svg circle') as SVGElement | null;
  213 |           if (svg) {
  214 |             const fill = svg.getAttribute('fill') || getComputedStyle(svg).fill;
  215 |             if (fill) colors.push(fill);
  216 |           }
  217 |         }
  218 |         return colors;
  219 |       });
  220 |       const hasDark = iconColors.some(
  221 |         (c) =>
  222 |           !/^#?fff(fff)?$/i.test(c.trim()) &&
  223 |           !/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/.test(c.trim()) &&
  224 |           !/^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(c.trim()),
  225 |       );
  226 |       expect(hasDark, `#505 sub-4 — at least one dropdown icon must be visibly dark`).toBeTruthy();
  227 |       await page.keyboard.press('Escape');
  228 |       await page.waitForTimeout(800);
  229 |     }
  230 | 
  231 |     // ============ #344 — complaint detail visible decrypt ============
  232 |     await page.goto(
  233 |       `${BASE_URL}/${tenantSlug()}/digit-ui/employee/pgr/complaint-details/${ASSIGNED_COMPLAINT_ID}?cb=${Date.now()}`,
  234 |     );
  235 |     await page.waitForLoadState('domcontentloaded');
  236 |     await page.waitForTimeout(4_500);
  237 | 
```