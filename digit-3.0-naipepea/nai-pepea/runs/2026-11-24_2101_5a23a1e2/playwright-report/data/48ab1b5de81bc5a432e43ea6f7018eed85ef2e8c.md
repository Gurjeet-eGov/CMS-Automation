# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: employee/pgr-details.spec.ts >> PGR complaint details — Flow 5 render slice >> Story 5.24b — Take Action VISIBLE on non-terminal complaint @p0
- Location: tests/employee/pgr-details.spec.ts:283:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.digit-action-bar-wrap button, .action-bar-wrap button, .action-bar-wrap button.submit-bar').first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.digit-action-bar-wrap button, .action-bar-wrap button, .action-bar-wrap button.submit-bar').first()

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - img "State Logo" [ref=e9]
    - generic [ref=e10]:
      - button "Net-Two·1 department·1 role" [ref=e13] [cursor=pointer]:
        - generic "Net-Two · 1 department · 1 role" [ref=e14]: Net-Two·1 department·1 role
      - generic [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: en
        - img [ref=e21]
      - generic [ref=e26] [cursor=pointer]:
        - generic [ref=e27]: P
        - img [ref=e29]
  - generic:
    - generic [ref=e32]:
      - generic [ref=e33]:
        - generic "Home" [ref=e35] [cursor=pointer]:
          - img [ref=e37]
          - generic [ref=e40]: Home
        - generic [ref=e41]:
          - generic [ref=e42]: Complaints
          - generic "Search Complaint" [ref=e44] [cursor=pointer]:
            - img [ref=e46]
            - generic [ref=e49]: Search Complaint
      - generic [ref=e50]:
        - button "Logout" [ref=e51] [cursor=pointer]:
          - img [ref=e52]
          - generic [ref=e55]: Logout
        - img "eGov Foundation" [ref=e57]
    - button "Close sidebar" [expanded] [ref=e58] [cursor=pointer]:
      - img [ref=e59]
  - generic [ref=e64]:
    - list [ref=e65]:
      - listitem [ref=e66]:
        - link "Home" [ref=e67] [cursor=pointer]:
          - /url: /net-two/digit-ui/employee
        - generic [ref=e68]: /
      - listitem [ref=e69]:
        - generic [ref=e70]: Complaint Details
    - generic [ref=e71]:
      - banner [ref=e72]:
        - heading "Complaint Details" [level=1] [ref=e73]
      - generic [ref=e75]:
        - generic [ref=e77]:
          - generic [ref=e78]:
            - generic [ref=e79]: Complaint No.
            - generic [ref=e80]: KE-NET-TWO-PGR-2026-11-24-285877
          - generic [ref=e81]:
            - generic [ref=e82]: Authority Type
            - generic [ref=e83]: County Government
          - generic [ref=e84]:
            - generic [ref=e85]: Main Category
            - generic [ref=e86]: Infrastructure
          - generic [ref=e87]:
            - generic [ref=e88]: Sector
            - generic [ref=e89]: Roads
          - generic [ref=e90]:
            - generic [ref=e91]: Complaint Subcategory
            - generic [ref=e92]: Potholes
          - generic [ref=e93]:
            - generic [ref=e94]: Filed Date
            - generic [ref=e95]: 24/11/2026
          - generic [ref=e96]:
            - generic [ref=e97]: Country
            - generic [ref=e98]: Mozambique
          - generic [ref=e99]:
            - generic [ref=e100]: State
            - generic [ref=e101]: Sofala
          - generic [ref=e102]:
            - generic [ref=e103]: City
            - generic [ref=e104]: Beira
          - generic [ref=e105]:
            - generic [ref=e106]: Ward
            - generic [ref=e107]: Ponta Gêa
          - generic [ref=e108]:
            - generic [ref=e109]: Current Status
            - generic [ref=e110]: Pending at last mile employee
          - generic [ref=e111]:
            - generic [ref=e112]: Landmark
            - generic [ref=e113]: NA
          - generic [ref=e114]:
            - generic [ref=e115]: Description
            - generic [ref=e116]: PW edited at 1795554268041
        - generic [ref=e117]:
          - generic [ref=e119]: Complaint Timeline
          - generic [ref=e122]:
            - generic [ref=e123]:
              - img [ref=e126]
              - generic [ref=e131]:
                - generic [ref=e132]: Assigned
                - generic [ref=e133]:
                  - generic [ref=e134]: 24/11/2026
                  - generic [ref=e135]: Siddharth Rao
                  - generic [ref=e136]: "Contact Details: 789123487"
            - generic [ref=e138]:
              - img [ref=e141]
              - generic [ref=e145]:
                - generic [ref=e146]: Applied
                - generic [ref=e147]:
                  - generic [ref=e148]: 24/11/2026
                  - generic [ref=e149]: NA
```

# Test source

```ts
  199 |     // nth()+innerText() loop auto-waits (up to the whole 120s test timeout)
  200 |     // on any pair missing a `.digit-viewcard-value` child — the details
  201 |     // grid renders a trailing empty field-pair with no value element, which
  202 |     // hung the old loop for the full timeout. evaluateAll reads the DOM
  203 |     // synchronously, so an absent child yields "" instead of blocking.
  204 |     const rows: { label: string; value: string }[] = await pairs.evaluateAll((els) =>
  205 |       els.map((el) => ({
  206 |         label: (el.querySelector('.digit-viewcard-label')?.textContent || '').trim(),
  207 |         value: (el.querySelector('.digit-viewcard-value')?.textContent || '').trim(),
  208 |       })),
  209 |     );
  210 | 
  211 |     const startIdx = rows.findIndex((r) => /^Complaint No\.?$/i.test(r.label));
  212 |     const endIdx = rows.findIndex((r) => /^Filed Date$/i.test(r.label));
  213 |     expect(startIdx, 'Complaint No. row must render').toBeGreaterThanOrEqual(0);
  214 |     expect(endIdx, 'Filed Date row must render after Complaint No.').toBeGreaterThan(startIdx);
  215 | 
  216 |     // Everything between them is classification (flat pair OR N hierarchy levels).
  217 |     const classificationRows = rows.slice(startIdx + 1, endIdx);
  218 |     expect(classificationRows.length, 'at least one classification row must render').toBeGreaterThanOrEqual(1);
  219 |     for (const r of classificationRows) {
  220 |       expect(r.value.length, `classification row "${r.label}" must have a value`).toBeGreaterThan(0);
  221 |       // Not a raw enum / missing-localization key (e.g. "GARBAGE_RELATED").
  222 |       expect(r.value).not.toMatch(/^[A-Z_]+$/);
  223 |     }
  224 |   });
  225 | 
  226 |   test('Story 5.9 — Filed Date renders in DD/MM/YYYY @p1', { tag: ['@persona:employee'] }, async ({ page }) => {
  227 |     await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);
  228 | 
  229 |     const filed = await valueForLabel(page, 'Filed Date');
  230 |     expect(filed).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  231 |   });
  232 | 
  233 |   test('Story 5.16 — Complaint Timeline section renders with checkpoint rows @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
  234 |     await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);
  235 | 
  236 |     // Accept the localized English label OR the raw i18n key / sw_KE rendering.
  237 |     const timelineHeader = page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first();
  238 |     await expect(timelineHeader).toBeVisible({ timeout: 10_000 });
  239 | 
  240 |     // .timeline-subelements wraps each checkpoint's body (date + actor +
  241 |     // comments). The terminal-fixture has APPLY + REJECT + REOPEN + RATE
  242 |     // history, so at least 2 rows must exist.
  243 |     const checkpoints = page.locator('.timeline-subelements');
  244 |     const count = await checkpoints.count();
  245 |     expect(count).toBeGreaterThanOrEqual(2);
  246 |   });
  247 | 
  248 |   test('Story 5.18 — timeline actor name is clean (no role-list concat) — #524', { tag: ['@persona:employee'] }, async ({ page }) => {
  249 |     // #524 fix is now in-repo (digit-ui-esbuild TimeLineWrapper.js `formatPerson`
  250 |     // returns just `person.name`), so this asserts the post-fix shape directly.
  251 |     // Previously masked with `test.fail(true)` pending a deploy; unmasked once
  252 |     // the bundle shipped.
  253 |     await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);
  254 | 
  255 |     // #524: actor names must not carry the appended role list. We don't
  256 |     // pin a specific actor name (varies by deployment/seed) — instead we
  257 |     // assert that NO timeline row renders the role-list concat shape
  258 |     // (" - Customer Support Representative, ...") that #524 strips.
  259 |     await expect(page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first())
  260 |       .toBeVisible({ timeout: 10_000 });
  261 |     const timelineText = (await page.locator('.timeline-date').allInnerTexts()).join(' \n ');
  262 |     expect(timelineText.length, 'timeline should render at least one actor row').toBeGreaterThan(0);
  263 |     expect(timelineText).not.toMatch(/Customer Support Representative/);
  264 |     expect(timelineText).not.toMatch(/Grievance Routing Officer/);
  265 |     expect(timelineText).not.toMatch(/SUPERUSER/);
  266 |   });
  267 | 
  268 |   test('Story 5.24a — Take Action HIDDEN on terminal-state complaint @p1', { tag: ['@persona:employee'] }, async ({ page }) => {
  269 |     await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);
  270 | 
  271 |     // CLOSEDAFTERREJECTION has no nextActions for any role, so the
  272 |     // button must not render. We do not just check count===0 — that
  273 |     // would pass if the entire page failed to load. Anchor on a known
  274 |     // section first.
  275 |     await expect(
  276 |       page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first(),
  277 |     ).toBeVisible({ timeout: 10_000 });
  278 | 
  279 |     const takeAction = page.getByRole('button', { name: /^Take Action$/i });
  280 |     await expect(takeAction).toHaveCount(0);
  281 |   });
  282 | 
  283 |   test('Story 5.24b — Take Action VISIBLE on non-terminal complaint @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
  284 |     await openDetails(page, NONTERMINAL_COMPLAINT_ID, NONTERMINAL_SKIP);
  285 | 
  286 |     // The take-action control renders ONLY when the workflow returns
  287 |     // nextActions for the viewing employee (PGRDetails.js gates the
  288 |     // ActionBar on `workflowDetails.data.nextActions.length > 0`). That
  289 |     // gate — not the label — is what this story asserts. Its visible text
  290 |     // is `t("ES_COMMON_TAKE_ACTION")`, which is localized per deployment
  291 |     // (and renders the raw key on tenants whose localization seed omits
  292 |     // it), so pinning the English "Take Action" string is non-portable.
  293 |     // Target the SubmitBar structurally instead: the details page has a
  294 |     // single ActionBar submit button, present iff the next-actions gate
  295 |     // passes.
  296 |     const takeAction = page.locator(
  297 |       '.digit-action-bar-wrap button, .action-bar-wrap button, .action-bar-wrap button.submit-bar',
  298 |     );
> 299 |     await expect(takeAction.first()).toBeVisible({ timeout: 10_000 });
      |                                      ^ Error: expect(locator).toBeVisible() failed
  300 |     await expect(takeAction.first()).toBeEnabled();
  301 |   });
  302 | 
  303 |   test('Story 5.location — optional coordinates hide/show the complete location card (#1750)', {
  304 |     annotation: {
  305 |       type: 'description',
  306 |       description: `Files one complaint with no geoLocation and one at latitude=0/longitude=36.8, then opens each through employee PGR details. The missing location must render neither the card heading nor a map; the equator point must render both. This keeps employee details aligned with the citizen detail contract and prevents truthiness checks from rejecting a valid zero-axis coordinate.`,
  307 |     },
  308 |     tag: ['@area:pgr', '@ccrs:1750', '@kind:regression', '@layer:ui', '@persona:employee'],
  309 |   }, async ({ page }) => {
  310 |     test.setTimeout(180_000);
  311 | 
  312 |     let missingId: string;
  313 |     let equatorId: string;
  314 |     try {
  315 |       const [missing, equator] = await Promise.all([
  316 |         seedComplaintAsCitizen({
  317 |           description: 'PW #1750 employee detail without geo-location',
  318 |           geoLocation: {},
  319 |         }),
  320 |         seedComplaintAsCitizen({
  321 |           description: 'PW #1750 employee detail equator geo-location',
  322 |           geoLocation: { latitude: 0, longitude: 36.8 },
  323 |         }),
  324 |       ]);
  325 |       missingId = missing.srid;
  326 |       equatorId = equator.srid;
  327 |     } catch (error) {
  328 |       test.skip(true, `complaint create blocked on this deployment: ${(error as Error).message.slice(0, 200)}`);
  329 |       return;
  330 |     }
  331 | 
  332 |     await page.route('https://nominatim.openstreetmap.org/reverse**', (route) =>
  333 |       route.fulfill({
  334 |         status: 200,
  335 |         contentType: 'application/json',
  336 |         body: JSON.stringify({ display_name: 'Playwright employee coordinate contract' }),
  337 |       }),
  338 |     );
  339 |     const locationHeading = () =>
  340 |       page.getByText(/^(Complaint(?:'s)? Location|CS_COMPLAINT_LOCATION)$/i, { exact: true });
  341 |     const locationMarker = () => page.locator('.leaflet-container .leaflet-marker-icon');
  342 | 
  343 |     await openDetails(page, missingId, 'fresh no-location fixture creation failed');
  344 |     await expect(
  345 |       locationHeading(),
  346 |       'employee details must hide the complete location card when coordinates are absent',
  347 |     ).toHaveCount(0);
  348 |     await expect(locationMarker()).toHaveCount(0);
  349 | 
  350 |     await openDetails(page, equatorId, 'fresh equator fixture creation failed');
  351 |     await expect(locationHeading(), 'employee details must accept latitude=0').toBeVisible();
  352 |     await expect(locationMarker()).toHaveCount(1);
  353 |   });
  354 | });
  355 | 
```