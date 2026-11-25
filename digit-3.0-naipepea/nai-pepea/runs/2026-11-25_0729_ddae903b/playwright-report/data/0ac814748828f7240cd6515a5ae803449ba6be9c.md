# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin/employees.spec.ts >> manage/employees >> 7. bulk import — 3 valid + 2 invalid rows, create 3 lands
- Location: tests/admin/employees.spec.ts:898:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /Create\s+3\s+(employee|row)s?/i })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('button', { name: /Create\s+3\s+(employee|row)s?/i })

```

# Test source

```ts
  923  | code was chosen. Omitting the column sidesteps a tenant-shape dependency
  924  | this test was never actually about.
  925  | 
  926  | Invalid row 1 uses a syntactically well-formed DOB (only the mobile is
  927  | short) rather than mobile+DOB both broken: excelParser.ts's parseEmployeeExcel
  928  | treats a malformed DOB as a parse-time failure and drops the row from the
  929  | returned data array entirely (never reaches the preview table at all), which
  930  | would silently shrink "Total" from 5 to 4 and defeat this test's own "preview
  931  | marks 2 errors" contract. A bad mobile alone still fails validateRow's
  932  | per-tenant MDMS length/pattern check and shows as an Error row, which is what
  933  | the test is actually asserting.`,
  934  |     },
  935  |     tag: ['@area:configurator-manage', '@area:hrms', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({
  936  |     page,
  937  |   }, testInfo) => {
  938  |     const validCodes = [1, 2, 3].map((i) => testCodeIndexed(testInfo, 'EMP_BULK_OK', i));
  939  |     const invalidCodes = [1, 2].map((i) => testCodeIndexed(testInfo, 'EMP_BULK_BAD', i));
  940  |     validCodes.forEach((c) => createdCodes.add(c));
  941  |     // Invalid rows are never created — no cleanup needed.
  942  | 
  943  |     await page.goto(`${LIST_PATH}/bulk`);
  944  | 
  945  |     // Wait for reference counts to populate so validateRow has the closed
  946  |     // vocabularies (departments/designations/boundaries) loaded.
  947  |     await expect(
  948  |       page.getByText(/Departments/i).first(),
  949  |     ).toBeVisible({ timeout: 30_000 });
  950  | 
  951  |     const rows = [
  952  |       // Valid trio — PW_ codes, tenant-valid mobiles, real dept/desig. No
  953  |       // jurisdictions column (see annotation — optional, and unusable at
  954  |       // this spec's ROOT tenant which has no boundary hierarchy at all).
  955  |       ...validCodes.map((c, i) => ({
  956  |         employeeCode: c,
  957  |         name: `PW Bulk ${lettersOnly(String(i + 1))}`, // letters only: DIGIT 3.0 refuses names with digits
  958  |         userName: '',
  959  |         // Valid for THIS tenant's MDMS mobile rule — no hardcoded '07…'.
  960  |         mobileNumber: generateValidMobile(mobileRule),
  961  |         emailId: `${c.toLowerCase()}@example.com`,
  962  |         gender: 'FEMALE',
  963  |         dob: '1992-03-15',
  964  |         department: SEED_DEPT,
  965  |         designation: SEED_DESIG,
  966  |         roles: 'EMPLOYEE',
  967  |         jurisdictions: '',
  968  |         dateOfAppointment: '2026-02-01',
  969  |       })),
  970  |       // Invalid row 1 — mobile too short. DOB is well-formed on purpose: a
  971  |       // malformed DOB makes excelParser.ts drop the row at PARSE time (never
  972  |       // reaches the preview table), which would silently shrink this test's
  973  |       // "5 rows, 2 errors" contract to 4 rows — see annotation.
  974  |       {
  975  |         employeeCode: invalidCodes[0],
  976  |         name: 'PW Bulk Bad One',
  977  |         userName: '',
  978  |         mobileNumber: '99999',
  979  |         emailId: `${invalidCodes[0].toLowerCase()}@example.com`,
  980  |         gender: 'MALE',
  981  |         dob: '1988-04-10',
  982  |         department: SEED_DEPT,
  983  |         designation: SEED_DESIG,
  984  |         roles: 'EMPLOYEE',
  985  |         jurisdictions: '',
  986  |         dateOfAppointment: '',
  987  |       },
  988  |       // Invalid row 2 — unknown department + unknown role code.
  989  |       {
  990  |         employeeCode: invalidCodes[1],
  991  |         name: 'PW Bulk Bad Two',
  992  |         userName: '',
  993  |         // Valid mobile + email so the ONLY validation errors are the unknown dept/role.
  994  |         mobileNumber: generateValidMobile(mobileRule),
  995  |         emailId: `${invalidCodes[1].toLowerCase()}@example.com`,
  996  |         gender: 'MALE',
  997  |         dob: '1990-01-01',
  998  |         department: 'NO_SUCH_DEPT',
  999  |         designation: SEED_DESIG,
  1000 |         roles: 'NO_SUCH_ROLE',
  1001 |         jurisdictions: '',
  1002 |         dateOfAppointment: '',
  1003 |       },
  1004 |     ];
  1005 | 
  1006 |     const buffer = await buildEmployeeXlsx(rows);
  1007 |     await page.locator('input[type="file"]').first().setInputFiles({
  1008 |       name: 'employees.xlsx',
  1009 |       mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  1010 |       buffer,
  1011 |     });
  1012 | 
  1013 |     // Preview renders — expect 2 "error" marks (order-independent).
  1014 |     // The BulkImportPanel labels invalid rows with an "error" badge.
  1015 |     await expect(page.getByText(/2.*error|error.*2/i).first()).toBeVisible({
  1016 |       timeout: 30_000,
  1017 |     });
  1018 | 
  1019 |     // Create button reflects the valid count.
  1020 |     const createBtn = page.getByRole('button', {
  1021 |       name: /Create\s+3\s+(employee|row)s?/i,
  1022 |     });
> 1023 |     await expect(createBtn).toBeVisible({ timeout: 15_000 });
       |                             ^ Error: expect(locator).toBeVisible() failed
  1024 |     await createBtn.click();
  1025 | 
  1026 |     // Completion page — 3 landed, download-credentials CTA surfaces.
  1027 |     // RC8: completion copy is "Created 3 employees" (number AFTER the word),
  1028 |     // not "3 created" — accept either order.
  1029 |     await expect(
  1030 |       page.getByText(/(?:created\s+3|3\s+(?:created|success))/i).first(),
  1031 |     ).toBeVisible({
  1032 |       timeout: 90_000,
  1033 |     });
  1034 | 
  1035 |     // API sanity — all 3 valid codes are present & active.
  1036 |     const auth = loadAuth();
  1037 |     for (const c of validCodes) {
  1038 |       const direct = await postJson(auth,
  1039 |         `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(c)}&limit=1&offset=0`,
  1040 |         { RequestInfo: requestInfo(auth) });
  1041 |       const list = (direct.Employees as HrmsEmployee[]) || [];
  1042 |       expect(list.length, `bulk-created ${c} should exist`).toBe(1);
  1043 |       expect(list[0].isActive).not.toBe(false);
  1044 |     }
  1045 | 
  1046 |     // Invitations CSV download — completionExtras renders it whenever a row
  1047 |     // was created, so it is required here.
  1048 |     const downloadBtn = page.getByRole('button', { name: /invitations CSV/i });
  1049 |     await expect(downloadBtn).toBeVisible();
  1050 |     const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  1051 |     await downloadBtn.click();
  1052 |     const download = await downloadPromise;
  1053 |     expect(await download.path()).toBeTruthy();
  1054 |   });
  1055 | });
  1056 | 
  1057 | // --- Helpers local to this spec ---
  1058 | 
  1059 | /**
  1060 |  * The grid's own record count, read from its "Showing 1-10 of 65" footer.
  1061 |  *
  1062 |  * The footer is the only honest total on the page: the visible row count is
  1063 |  * capped by the page size (10), so a filter that narrows 65 -> 40 changes no
  1064 |  * row count at all. DigitDatagrid renders the footer only when total > 0, so an
  1065 |  * absent footer plus the empty state means a real zero; an absent footer with
  1066 |  * no empty state means the grid is mid-refetch (react-query unmounts the table
  1067 |  * while a new filter's query is pending) and the caller must retry.
  1068 |  */
  1069 | async function readTotal(page: Page): Promise<number | null> {
  1070 |   const footer = page.getByText(/Showing\s+\d+\s*[-–]\s*\d+\s+of\s+\d+/i).first();
  1071 |   if ((await footer.count()) > 0) {
  1072 |     const text = await footer.textContent({ timeout: 2_000 }).catch(() => null);
  1073 |     const m = text?.match(/of\s+(\d+)/i);
  1074 |     if (m) return Number(m[1]);
  1075 |   }
  1076 |   if ((await page.getByText(/No records found/i).count()) > 0) return 0;
  1077 |   return null;
  1078 | }
  1079 | 
  1080 | /**
  1081 |  * readTotal() once the grid has stopped moving.
  1082 |  *
  1083 |  * For a total we can predict, prefer `expect.poll(() => readTotal(page))` —
  1084 |  * it retries a stale read away. This exists for the reads whose expected value
  1085 |  * is exactly what we are measuring (the per-status totals), where a stale read
  1086 |  * would otherwise be indistinguishable from a settled one. The grid debounces
  1087 |  * filter changes (~750ms measured), so we wait past that before sampling and
  1088 |  * then require two consecutive identical readings.
  1089 |  */
  1090 | async function settledTotal(page: Page, opts?: { settleMs?: number; timeoutMs?: number }): Promise<number> {
  1091 |   const settleMs = opts?.settleMs ?? 2_000;
  1092 |   const deadline = Date.now() + (opts?.timeoutMs ?? 20_000);
  1093 |   await page.waitForTimeout(settleMs);
  1094 |   let previous: number | null = null;
  1095 |   while (Date.now() < deadline) {
  1096 |     const current = await readTotal(page);
  1097 |     if (current !== null && current === previous) return current;
  1098 |     previous = current;
  1099 |     await page.waitForTimeout(400);
  1100 |   }
  1101 |   throw new Error(
  1102 |     `the employee grid never settled on a record count (last read: ${previous ?? 'none — no footer and no empty state'})`,
  1103 |   );
  1104 | }
  1105 | 
  1106 | /**
  1107 |  * An employee code that identifies exactly ONE record on this deployment.
  1108 |  *
  1109 |  * The quick-search filter matches the whole serialized record
  1110 |  * (dataProvider clientFilter: `JSON.stringify(record).includes(q)`), not just
  1111 |  * the code column, so plenty of real codes are useless as a narrowing probe:
  1112 |  * searching `ADMIN` on the local stack returns all 65 rows, because every
  1113 |  * employee's jurisdiction hierarchy is `MAPUTO_ADMIN`. Uniqueness is checked
  1114 |  * against the same record set the grid itself lists (HRMS at TENANT_CODE,
  1115 |  * limit 500 — the page size hrmsGetList uses), and candidates are walked in
  1116 |  * sorted order so the choice is deterministic across runs.
  1117 |  */
  1118 | async function pickUniqueEmployeeCode(): Promise<string | null> {
  1119 |   const auth = loadAuth();
  1120 |   const employees = await employeeSearch(auth, TENANT_CODE, { limit: 500 });
  1121 |   const serialized = employees.map((e) => JSON.stringify(e).toLowerCase());
  1122 |   const codes = employees
  1123 |     .map((e) => String(e.code ?? ''))
```