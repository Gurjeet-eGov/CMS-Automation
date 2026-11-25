# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin/complaint-types.spec.ts >> manage/complaint-types >> 4. department reference filter narrows the list
- Location: tests/admin/complaint-types.spec.ts:247:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('row').filter({ has: getByRole('cell') }).filter({ hasText: 'StreetLightingDamagedLightPole' }).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('row').filter({ has: getByRole('cell') }).filter({ hasText: 'StreetLightingDamagedLightPole' }).first()

```

# Test source

```ts
  231 |     // --- Verify SLA persisted via MDMS ---
  232 |     const afterEdit = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
  233 |       uniqueIdentifiers: [storedId(code)],
  234 |       limit: 5,
  235 |     });
  236 |     expect(afterEdit.length).toBeGreaterThan(0);
  237 |     expect((afterEdit[0].data as Record<string, unknown>).slaHours).toBe(72);
  238 |   });
  239 | 
  240 |   // NOTE: the former test 3 ("bulk import — happy path") was removed — there
  241 |   // is no /complaint-types/bulk route (App.tsx only wires bulk import for
  242 |   // employees, departments, designations, and localization). Complaint types
  243 |   // are created one at a time via the ComplaintTypeCreate form (test 2).
  244 |   // The former test 5 (root → city MDMS inheritance) was removed: city
  245 |   // tenants are out of scope (#2398 decision 2).
  246 | 
  247 |   test('4. department reference filter narrows the list', {
  248 |     annotation: {
  249 |       type: 'description',
  250 |       description: `Validates the Department filter on the complaint-types list: picking a department must narrow the rendered rows to exactly the complaint types that reference it.
  251 | 
  252 | Steps:
  253 | 1. Via MDMS, find an active leaf complaint type carrying a \`department\` (preferring a non-scratch one), then resolve that department's display name from common-masters.Department. Skip only if the deployment has no such pairing at all.
  254 | 2. Navigate to /configurator/manage/complaint-hierarchy; count the unfiltered DATA rows (rows containing role=cell).
  255 | 3. Open the Department filter (a Radix combobox showing "Department" until a value is picked) and select the resolved department by name.
  256 | 4. Assert the known complaint type's row survives the filter.
  257 | 5. Assert EVERY rendered row references that department (label or code) — vacuously-true empty results are excluded by step 4.
  258 | 6. Assert the row count strictly dropped versus the unfiltered list.
  259 | 
  260 | All row reads are auto-retrying expect()/expect.poll() — the grid debounces filter changes, so a bare count() straight after selecting reads the PRE-filter list.
  261 | 
  262 | The filter itself did not exist before: ComplaintTypeList passed no \`filters\` to DigitList, so this test skipped unconditionally on "Department filter not present on this build". It is now declared alongside SearchFilterInput, mirroring DesignationList.`,
  263 |     },
  264 |     tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  265 |     // Resolve the department to filter by from live data — never a literal.
  266 |     const auth = loadAuth();
  267 |     const [types, depts] = await Promise.all([
  268 |       mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 500, isActive: true }),
  269 |       mdmsSearch(auth, TENANT_CODE, DEPT_SCHEMA, { limit: 200, isActive: true }),
  270 |     ]);
  271 | 
  272 |     const deptOf = (r: MdmsRecord) => {
  273 |       const raw = (r.data as Record<string, unknown>)?.department;
  274 |       return Array.isArray(raw) ? (raw[0] as string | undefined) : (raw as string | undefined);
  275 |     };
  276 |     // ComplaintHierarchy junk left by previous runs is created ACTIVE, so
  277 |     // isActive alone doesn't separate it from real data here — the PW_ prefix
  278 |     // does. Prefer a real leaf; fall back to any leaf with a department.
  279 |     const leaves = types.filter((r) => deptOf(r));
  280 |     const leaf =
  281 |       leaves.find((r) => !SCRATCH_CODE.test(String(r.uniqueIdentifier))) ?? leaves[0];
  282 |     const deptCode = leaf ? deptOf(leaf) : undefined;
  283 |     const deptRecord = depts.find(
  284 |       (d) =>
  285 |         String(d.uniqueIdentifier) === deptCode ||
  286 |         String((d.data as Record<string, unknown>)?.code ?? '') === deptCode,
  287 |     );
  288 |     test.skip(
  289 |       !leaf || !deptRecord,
  290 |       'No active complaint type linked to an active department on this deployment',
  291 |     );
  292 | 
  293 |     // The list renders the department via EntityLink, which shows the
  294 |     // department NAME when it resolves and falls back to the raw code when it
  295 |     // does not — accept either.
  296 |     const deptName = String(
  297 |       (deptRecord!.data as Record<string, unknown>)?.name ?? deptRecord!.uniqueIdentifier,
  298 |     );
  299 |     // The list's "Service Code" column renders the record's `code` field, NOT its
  300 |     // MDMS uniqueIdentifier. Those differ for ComplaintHierarchy because mdms-v2
  301 |     // derives the identifier as `<hierarchyType>.<code>` (see storedId above):
  302 |     //   uniqueIdentifier "PGR.BurningOfGarbage"  vs  code "BurningOfGarbage"
  303 |     // Matching the row on the identifier therefore never finds it, and the test
  304 |     // failed as though the department filter had hidden a row it never rendered.
  305 |     const serviceCode = String(
  306 |       (leaf!.data as Record<string, unknown>)?.code ?? leaf!.uniqueIdentifier,
  307 |     );
  308 | 
  309 |     await page.goto(LIST_PATH);
  310 | 
  311 |     // DATA rows only — the header row holds columnheaders, not cells.
  312 |     const dataRows = page.getByRole('row').filter({ has: page.getByRole('cell') });
  313 |     await expect(dataRows.first()).toBeVisible();
  314 |     const unfilteredCount = await dataRows.count();
  315 |     expect(unfilteredCount).toBeGreaterThan(0);
  316 | 
  317 |     // ReferenceFilterInput renders a Radix trigger with no <label> and no
  318 |     // accessible name — its only label is the SelectValue placeholder, so match
  319 |     // on the text it displays (the placeholder before selection, the chosen
  320 |     // department's name after).
  321 |     const filter = page
  322 |       .getByRole('combobox')
  323 |       .filter({ hasText: new RegExp(`^(Department|${escapeRe(deptName)})$`) })
  324 |       .first();
  325 |     await expect(filter).toBeVisible();
  326 |     await filter.click();
  327 |     await page.getByRole('option', { name: new RegExp(`^${escapeRe(deptName)}$`) }).click();
  328 | 
  329 |     // The known complaint type must survive the filter — this also rules out a
  330 |     // vacuously-true "every row matches" over an empty result set.
> 331 |     await expect(dataRows.filter({ hasText: serviceCode }).first()).toBeVisible();
      |                                                                     ^ Error: expect(locator).toBeVisible() failed
  332 | 
  333 |     // ...and every row left must reference that department.
  334 |     const needle = deptName.toLowerCase();
  335 |     const codeNeedle = String(deptCode).toLowerCase();
  336 |     await expect
  337 |       .poll(
  338 |         async () => {
  339 |           const texts = await dataRows.allTextContents();
  340 |           return (
  341 |             texts.length > 0 &&
  342 |             texts.every((t) => {
  343 |               const lower = t.toLowerCase();
  344 |               return lower.includes(needle) || lower.includes(codeNeedle);
  345 |             })
  346 |           );
  347 |         },
  348 |         { message: `every row should reference department "${deptName}"` },
  349 |       )
  350 |       .toBe(true);
  351 | 
  352 |     // And the list genuinely shrank.
  353 |     await expect
  354 |       .poll(() => dataRows.count(), { message: 'department filter should narrow the list' })
  355 |       .toBeLessThan(unfilteredCount);
  356 |   });
  357 | });
  358 | 
```