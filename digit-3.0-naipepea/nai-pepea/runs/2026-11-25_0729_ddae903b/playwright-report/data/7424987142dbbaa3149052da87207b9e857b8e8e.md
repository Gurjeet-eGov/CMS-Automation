# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin/users.spec.ts >> manage/users >> 3. edit — username disabled, name updates round-trip
- Location: tests/admin/users.spec.ts:253:7

# Error details

```
Error: POST /user/users/_createnovalidate failed (400): INVALID_USER:The DIGIT 3.0 individual registry refused this person
```

# Test source

```ts
  1   | /**
  2   |  * User management — list / show / create / edit.
  3   |  *
  4   |  * UserList / UserCreate / UserEdit are a thin wrapper over egov-user:
  5   |  *   - GET list: POST /user/_search  (requires at least one filter; the
  6   |  *     configurator defaults to roleCodes=['CITIZEN'] when none is set)
  7   |  *   - CREATE : POST /user/users/_createnovalidate
  8   |  *   - UPDATE : POST /user/users/_updatenovalidate
  9   |  *   - GET ONE: /user/_search with uuid
  10  |  *
  11  |  * Teardown: egov-user has no delete, so we soft-deactivate by setting
  12  |  * `active=false` via _updatenovalidate. Done inline here — not added to
  13  |  * helpers/teardown.ts to keep the shared helper surface small and
  14  |  * MDMS-/PGR-focused.
  15  |  *
  16  |  * UserList has NO search/filter bar in the current source (UserList.tsx
  17  |  * defines no `filters` prop) — this spec asserts the columns + create form
  18  |  * shape only; it does NOT assert a search/narrow behavior that the UI
  19  |  * doesn't implement.
  20  |  */
  21  | import { test, expect } from '@playwright/test';
  22  | import { apiAuth, type AuthInfo } from '../utils/manage/api';
  23  | import { lettersOnly, testCode } from '../utils/manage/codes';
  24  | import { TENANT, ROOT_TENANT } from '../utils/env';
  25  | import { getMobileValidationRule, generateValidMobile, type MobileRule } from '../utils/mdms-mobile';
  26  | 
  27  | // Root (state) tenant from env — no hardcoded 'ke'.
  28  | const TENANT_CODE = ROOT_TENANT;
  29  | const LIST_PATH = '/configurator/manage/users';
  30  | 
  31  | const USER_SEARCH = '/user/_search';
  32  | const USER_UPDATE = '/user/users/_updatenovalidate';
  33  | 
  34  | const createdUsernames = new Set<string>();
  35  | 
  36  | // Live MDMS mobile rule for the deployment tenant — used to generate valid
  37  | // numbers instead of a hardcoded Kenya '07…' literal.
  38  | let mobileRule: MobileRule;
  39  | 
  40  | test.describe.configure({ mode: 'serial' });
  41  | 
  42  | test.beforeAll(async () => {
  43  |   mobileRule = await getMobileValidationRule(TENANT);
  44  | });
  45  | 
  46  | function requestInfo(auth: AuthInfo, action = '_search'): Record<string, unknown> {
  47  |   return {
  48  |     apiId: 'Rainmaker',
  49  |     ver: '1.0',
  50  |     ts: Date.now(),
  51  |     action,
  52  |     msgId: `${Date.now()}|en_IN`,
  53  |     authToken: auth.token,
  54  |     // Roles come from the configurator storageState as bare code strings; expand
  55  |     // to Role objects so services can deserialize them. Kong (compose) re-resolves
  56  |     // userInfo from the token and tolerates strings; the stock k8s gateway forwards
  57  |     // them verbatim → 401/500 "Cannot construct Role from String". See manage/api.ts.
  58  |     userInfo: auth.user
  59  |       ? {
  60  |           ...auth.user,
  61  |           roles: (Array.isArray((auth.user as { roles?: unknown }).roles)
  62  |             ? ((auth.user as { roles: unknown[] }).roles)
  63  |             : []
  64  |           ).map((r) =>
  65  |             typeof r === 'string'
  66  |               ? { code: r, name: r, tenantId: (auth.user as { tenantId?: string }).tenantId }
  67  |               : r,
  68  |           ),
  69  |         }
  70  |       : undefined,
  71  |   };
  72  | }
  73  | 
  74  | async function postJson(
  75  |   auth: AuthInfo,
  76  |   pathWithQuery: string,
  77  |   body: Record<string, unknown>,
  78  | ): Promise<Record<string, unknown>> {
  79  |   const res = await fetch(`${auth.baseUrl}${pathWithQuery}`, {
  80  |     method: 'POST',
  81  |     headers: {
  82  |       'Content-Type': 'application/json',
  83  |       Authorization: `Bearer ${auth.token}`,
  84  |     },
  85  |     body: JSON.stringify(body),
  86  |   });
  87  |   let parsed: Record<string, unknown> = {};
  88  |   try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  89  |   if (!res.ok || (Array.isArray(parsed.Errors) && (parsed.Errors as unknown[]).length)) {
  90  |     const errs = parsed.Errors as Array<{ code?: string; message?: string }> | undefined;
  91  |     const summary = errs?.map((e) => `${e.code || '??'}:${e.message || ''}`).join(', ')
  92  |       || `HTTP_${res.status}`;
> 93  |     throw new Error(`POST ${pathWithQuery} failed (${res.status}): ${summary}`);
      |           ^ Error: POST /user/users/_createnovalidate failed (400): INVALID_USER:The DIGIT 3.0 individual registry refused this person
  94  |   }
  95  |   return parsed;
  96  | }
  97  | 
  98  | async function softDeleteUser(auth: AuthInfo, userName: string): Promise<void> {
  99  |   const res = await postJson(auth, USER_SEARCH, {
  100 |     RequestInfo: requestInfo(auth),
  101 |     tenantId: TENANT_CODE,
  102 |     userName,
  103 |     pageSize: 1,
  104 |   });
  105 |   const list = (res.user as Array<Record<string, unknown>> | undefined) || [];
  106 |   if (!list.length) return;
  107 |   const user = list[0];
  108 |   if (user.active === false) return;
  109 |   user.active = false;
  110 |   await postJson(auth, USER_UPDATE, {
  111 |     RequestInfo: requestInfo(auth, '_update'),
  112 |     user,
  113 |   });
  114 | }
  115 | 
  116 | test.afterAll(async () => {
  117 |   if (createdUsernames.size === 0) return;
  118 |   const auth = await apiAuth();
  119 |   const failed: Array<{ userName: string; reason: string }> = [];
  120 |   for (const u of createdUsernames) {
  121 |     try { await softDeleteUser(auth, u); } catch (e) {
  122 |       failed.push({ userName: u, reason: (e as Error).message });
  123 |     }
  124 |   }
  125 |   if (failed.length) {
  126 |     // eslint-disable-next-line no-console
  127 |     console.warn(`[users] cleanup left ${failed.length} user(s) behind:`, failed);
  128 |   }
  129 | });
  130 | 
  131 | test.describe('manage/users', () => {
  132 |   test('1. list renders with profile columns + at least one citizen row', {
  133 |     annotation: {
  134 |       type: 'description',
  135 |       description: `Asserts /manage/users renders with the four expected column headers (Username, Name, Mobile, Type) and at least one populated row. The default filter is roleCodes=['CITIZEN'] (configurator's hardcoded default), and the tenant has seeded ADMIN + test citizens.
  136 | 
  137 | Steps:
  138 | 1. Navigate to /configurator/manage/users.
  139 | 2. Assert role=table is visible.
  140 | 3. For each header in ['Username','Name','Mobile','Type'], assert the matching role=columnheader is visible.
  141 | 4. Assert getByRole('row') count > 1 (header + at least one citizen).
  142 | 
  143 | UserList does NOT have a search/filter bar (no filters prop in the source) — this spec asserts columns + count only, not narrow behavior the UI doesn't implement.`,
  144 |     },
  145 |     tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
  146 |     page,
  147 |   }) => {
  148 |     await page.goto(LIST_PATH);
  149 | 
  150 |     const table = page.getByRole('table');
  151 |     await expect(table).toBeVisible();
  152 | 
  153 |     for (const header of ['Username', 'Name', 'Mobile', 'Type']) {
  154 |       await expect(
  155 |         page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
  156 |       ).toBeVisible();
  157 |     }
  158 | 
  159 |     // Default filter is roleCodes=['CITIZEN']. Tenant has seeded citizens
  160 |     // (ADMIN / test citizens per curl probe) — expect at least 1 data row.
  161 |     const dataRows = page.getByRole('row');
  162 |     expect(await dataRows.count()).toBeGreaterThan(1);
  163 |   });
  164 | 
  165 |   test('2. create — citizen user lands and is retrievable via API', {
  166 |     annotation: {
  167 |       type: 'description',
  168 |       description: `Drives the UserCreate form to create a fresh citizen, navigates back to the list, and verifies via egov-user _search that the user landed with the expected fields. UserCreate has NO Username field — it derives userName from the mobile number (leading 0 stripped), so the persisted userName === mobileNumber. Soft-deletes in afterAll.
  169 | 
  170 | Steps:
  171 | 1. Generate a 10-digit mobile number; derive expectedUserName = mobile with any leading 0 stripped; track expectedUserName for cleanup.
  172 | 2. Navigate to /configurator/manage/users/create.
  173 | 3. #461/#462: no Username label on the form; the Name and Mobile Number labels carry the required "*".
  174 | 4. Fill labels Name ("Citizen": DIGIT 3.0 refuses digit-bearing names), Mobile Number, Email (no Username field).
  175 | 5. Click Create; wait for navigation back to /configurator/manage/users (45s timeout).
  176 | 6. POST /user/_search with userName=expectedUserName; assert exactly 1 result.
  177 | 7. Assert userName === mobileNumber === expectedUserName, active=true, type='CITIZEN'.
  178 | 
  179 | Teardown is API-only — egov-user has no UI delete affordance for users; the afterAll soft-deletes via _updatenovalidate with active=false.`,
  180 |     },
  181 |     tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
  182 |     page,
  183 |   }, testInfo) => {
  184 |     const uname = `pw${testCode(testInfo, 'USR').toLowerCase().replace(/_/g, '')}`
  185 |       .slice(0, 40); // used for the email only.
  186 |     // Mobile valid for THIS tenant's MDMS rule — Kenya starts 7/1, Maputo
  187 |     // starts 8. Previously hardcoded a Kenya-format `07…` literal, which the
  188 |     // mz backend rejects. NOTE: this surfaces a real product bug —
  189 |     // UserCreate.tsx validates with `v.mobileKERequired` (a hardcoded Kenyan
  190 |     // regex ^0?[17][0-9]{8}$), so the form blocks any tenant-valid non-Kenya
  191 |     // number and the citizen can never be created on a non-Kenya deployment.
  192 |     const mobile = generateValidMobile(await getMobileValidationRule(TENANT));
  193 |     // UserCreate has no Username field — it derives userName from the mobile
```