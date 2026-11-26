/**
 * FileStore access control — no file, file URL or listing without a valid token.
 *
 * Requirement (§2): only a signed-in user with a
 * valid access token may use the FileStore API, for one file and for several;
 * there must be no open link that lists files; nothing else in FileStore
 * changed. Manual cases SEC/001–SEC/007.
 *
 * Sibling of api/filestore-fixes-2026-04-29.spec.ts, which covers upload
 * VALIDITY (corrupt / oversized files) with a valid token; this file covers who
 * may reach FileStore at all.
 *
 * Mechanism: bare fetch, so a "no token" request really carries none — no
 * cookies, no storageState. beforeAll uploads one small PNG with the admin's
 * token and learns which header the deployment takes the token in (auth-token
 * or Authorization: Bearer). Every rejection test is paired with that positive
 * control: a valid token CAN fetch the same file, so a 401 below means access
 * control, not a dead endpoint. If the control itself fails, that is reported
 * as the failure (signed-in users lost access — a regression) and the negative
 * tests skip, because a rejection would then prove nothing.
 *
 * Agreed expected results (from the tester) for the two cases the md left open:
 * SEC/006 — only the parent tenant is configured, so any signed-in citizen or
 * employee with a valid tenant id and file id gets the file; SEC/007 — the URL
 * /files/url returns is pre-signed, opens directly without a token, and is
 * valid for 1 hour.
 *
 * Each test's title ends with its manual case id (@SEC/0NN), which is how Test
 * Run links automated results to the manual case sheet.
 */
import { test, expect } from '../utils/session-test';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS, EMPLOYEE_USER, EMPLOYEE_PASS } from '../utils/env';
import { getPrincipal } from '../utils/employee-ui';
import { getDigitToken } from '../utils/auth';
import { provisionFreshCitizen } from '../utils/citizen-provision';
import { PORTALS, logoutViaApi, tokenStatus } from '../utils/ui-sign-in';

const FS = `${BASE_URL}/filestore/v1/files`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);
const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:api', '@persona:system'];

interface Reply {
  status: number;
  bytes: Buffer;
  text: string;
  contentType: string;
}

async function call(url: string, init: RequestInit = {}): Promise<Reply> {
  const r = await fetch(url, { redirect: 'manual', ...init });
  const bytes = Buffer.from(await r.arrayBuffer());
  return { status: r.status, bytes, text: bytes.toString('utf8'), contentType: r.headers.get('content-type') || '' };
}

/** Status + start of the body, for assertion messages. Bodies here never carry our token. */
const show = (r: Reply) => `HTTP ${r.status} [${r.contentType}] ${r.text.replace(/\s+/g, ' ').slice(0, 220)}`;
const isPng = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

/** What a reply gives away: file bytes, or a URL to a stored file. Empty = nothing. */
function leaks(r: Reply): string[] {
  const out: string[] = [];
  if (isPng(r.bytes)) out.push('the file bytes');
  if (/X-Amz-Signature|[?&]Signature=|"url"\s*:\s*"https?:/i.test(r.text)) out.push('a URL to a stored file');
  return out;
}

function expectRejected(r: Reply, what: string): void {
  expect([401, 403], `${what}: must be refused with 401/403 — got ${show(r)}`).toContain(r.status);
  expect(leaks(r), `${what}: the refusal must return no content — got ${show(r)}`).toEqual([]);
}

type AuthStyle = 'auth-token' | 'bearer';
const headersFor = (style: AuthStyle, token: string): Record<string, string> =>
  style === 'auth-token' ? { 'auth-token': token } : { Authorization: `Bearer ${token}` };

function uploadForm(tenantId: string, name = 'sec-audit.png'): FormData {
  const fd = new FormData();
  fd.append('tenantId', tenantId);
  fd.append('module', 'PGR');
  fd.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), name);
  return fd;
}

const idUrl = (id: string, tenant = TENANT) => `${FS}/id?tenantId=${encodeURIComponent(tenant)}&fileStoreId=${encodeURIComponent(id)}`;
const urlUrl = (ids: string, tenant = TENANT) => `${FS}/url?tenantId=${encodeURIComponent(tenant)}&fileStoreIds=${encodeURIComponent(ids)}`;

// ── shared state from beforeAll ──────────────────────────────────────────────
let adminToken = '';
let style: AuthStyle = 'auth-token';
let fileStoreId = '';
let uploadProblem = ''; // non-empty = a signed-in upload failed (reported by the control test)
let signedUrl = ''; // what /files/url hands a signed-in user ('' if none)
let controlOk = false; // a valid token could fetch the file
let controlProblem = '';

test.beforeAll(async () => {
  test.setTimeout(90_000);
  try {
    adminToken = (await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS })).access_token;
  } catch (e: any) {
    uploadProblem = `admin ${ADMIN_USER}@${ROOT_TENANT} could not sign in: ${String(e?.message ?? e).slice(0, 200)}`;
    return;
  }
  // Learn which header the deployment takes the token in, by uploading.
  const tried: string[] = [];
  for (const s of ['auth-token', 'bearer'] as AuthStyle[]) {
    const r = await call(FS, { method: 'POST', headers: headersFor(s, adminToken), body: uploadForm(TENANT) });
    const id = (() => {
      try {
        return JSON.parse(r.text)?.files?.[0]?.fileStoreId || '';
      } catch {
        return '';
      }
    })();
    if (r.status < 300 && id) {
      style = s;
      fileStoreId = id;
      break;
    }
    tried.push(`${s}: ${show(r)}`);
  }
  if (!fileStoreId) {
    uploadProblem = `signed-in upload to ${FS} (tenant ${TENANT}) failed with both token headers — ${tried.join(' | ')}`;
    return;
  }
  const got = await call(idUrl(fileStoreId), { headers: headersFor(style, adminToken) });
  if (got.status === 200 && isPng(got.bytes)) controlOk = true;
  else controlProblem = `valid token could not fetch file ${fileStoreId}: ${show(got)}`;
  const u = await call(urlUrl(fileStoreId), { headers: headersFor(style, adminToken) });
  try {
    const j = JSON.parse(u.text);
    signedUrl = String(j?.fileStoreIds?.[0]?.url ?? j?.[fileStoreId] ?? '').split(',')[0];
  } catch {
    signedUrl = '';
  }
});

/** Every negative test starts with this: no control, no meaningful rejection. */
function needControl(): void {
  const why = uploadProblem || controlProblem;
  test.skip(!!why, `positive control failed on ${TENANT}, so a rejection would prove nothing: ${why}`);
}

test.describe('filestore — a valid token is required', () => {
  test('a signed-in user can still upload, fetch and get a URL for a file (positive control) @SEC/001', {
    annotation: {
      type: 'description',
      description: `Regression guard for the fix: FileStore must still serve a signed-in user. Also the positive control every rejection test in this file depends on.

Steps:
1. Sign in as the admin via the API (password grant) and upload a 1x1 PNG to POST /filestore/v1/files, with the token in the auth-token header, else Authorization: Bearer.
2. GET /filestore/v1/files/id with the same token; assert 200 and PNG bytes.
3. GET /filestore/v1/files/url with the same token; assert 200 and a URL for the file.`,
    },
    tag: TAGS,
  }, async () => {
    expect(uploadProblem, 'signed-in upload must succeed').toBe('');
    expect(controlProblem, 'signed-in fetch must return the file').toBe('');
    const u = await call(urlUrl(fileStoreId), { headers: headersFor(style, adminToken) });
    expect(u.status, `signed-in /files/url — ${show(u)}`).toBe(200);
    expect(signedUrl, `signed-in /files/url returned no URL — ${show(u)}`).toMatch(/^https?:\/\//);
  });

  test('without a token, single-file fetch is refused and returns nothing @SEC/001', {
    annotation: {
      type: 'description',
      description: `SEC/001: GET /filestore/v1/files/id with no token must be 401/403 with no file bytes and no URL.

Steps:
1. Positive control (beforeAll): the same request with a valid token returns the file.
2. Repeat it with no token header and no cookies; assert 401/403 and no content.`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    expectRejected(await call(idUrl(fileStoreId)), 'GET /files/id without a token');
  });

  test('without a token, the multiple-file URL fetch is refused and returns no URL @SEC/001', {
    annotation: {
      type: 'description',
      description: `SEC/001: GET /filestore/v1/files/url (one id, and a list of ids) with no token must be 401/403 and hand out no URL.

Steps:
1. Positive control (beforeAll): with a valid token the call returns a URL.
2. Call it with no token for the single id and for "id,id"; assert 401/403 and no URL.`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    expectRejected(await call(urlUrl(fileStoreId)), 'GET /files/url (one id) without a token');
    expectRejected(await call(urlUrl(`${fileStoreId},${fileStoreId}`)), 'GET /files/url (two ids) without a token');
  });

  test('without a token, upload is refused and stores nothing @SEC/001', {
    annotation: {
      type: 'description',
      description: `SEC/001: POST /filestore/v1/files with no token must be 401/403 and return no fileStoreId.

Steps:
1. Positive control (beforeAll): the same upload with a valid token returned a fileStoreId.
2. Upload the same PNG with no token; assert 401/403 and no fileStoreId in the body.`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    const r = await call(FS, { method: 'POST', body: uploadForm(TENANT, 'sec-audit-no-token.png') });
    expect([401, 403], `POST /files without a token — ${show(r)}`).toContain(r.status);
    expect(r.text, `POST /files without a token must not store anything — ${show(r)}`).not.toMatch(/fileStoreId/i);
  });

  test('a file link pasted into a signed-out browser is refused @SEC/001', {
    annotation: {
      type: 'description',
      description: `SEC/001: the file link opened in a browser with no session (pasted, or from an SMS) must not show the file.

Steps:
1. Positive control (beforeAll): a valid token fetches the file.
2. Open GET /filestore/v1/files/id?… in a fresh browser context with no storage; assert the response is 401/403 and no image renders.`,
    },
    tag: ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:system'],
  }, async ({ browser }) => {
    needControl();
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await ctx.newPage();
      const resp = await page.goto(idUrl(fileStoreId), { waitUntil: 'commit', timeout: 30_000 });
      const status = resp?.status() ?? 0;
      expect([401, 403], `signed-out browser opening the file link got HTTP ${status}`).toContain(status);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const imgLoaded = await page.locator('img').evaluateAll((imgs) => imgs.some((i) => (i as HTMLImageElement).naturalWidth > 0));
      expect(imgLoaded, 'signed-out browser must not render the file').toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('malformed, tampered and logout-revoked tokens are refused @SEC/002', {
    annotation: {
      type: 'description',
      description: `SEC/002: bad tokens are rejected — malformed, tampered, and revoked by logout. An expired (8-hour) token cannot be produced within a run; revocation exercises the same server-side "token no longer valid" path.

Steps:
1. Positive control (beforeAll): the admin's valid token fetches the file.
2. Fetch with a malformed token and with the admin token altered in its last characters; assert 401/403 and no content.
3. Provision a throwaway citizen and sign them in in a browser tab (API sign-in); with the tab's token upload a file and fetch it back (its own positive control).
4. Log that citizen out through the logout API (/user/_logout, the call the app makes; logout is only the way to get a revoked token here — the Logout button is checked by the session checks); confirm egov-user no longer accepts the token.
5. Fetch the citizen's file with the revoked token; assert 401/403 and no content.`,
    },
    tag: TAGS,
  }, async ({ browser }) => {
    test.setTimeout(120_000);
    needControl();
    expectRejected(await call(idUrl(fileStoreId), { headers: headersFor(style, 'not-a-real-token') }), 'malformed token');
    const tampered = adminToken.slice(0, -4) + (adminToken.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa');
    expectRejected(await call(idUrl(fileStoreId), { headers: headersFor(style, tampered) }), 'tampered token');

    const who = await provisionFreshCitizen();
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const tab = await ctx.newPage();
    await PORTALS.citizen.signInViaApi(tab, { user: who.mobile, pass: '' });
    const token = await PORTALS.citizen.readToken(tab);
    const up = await call(FS, { method: 'POST', headers: headersFor(style, token), body: uploadForm(ROOT_TENANT, 'citizen.png') });
    const citizenFile = (() => {
      try {
        return JSON.parse(up.text)?.files?.[0]?.fileStoreId || '';
      } catch {
        return '';
      }
    })();
    expect(citizenFile, `a signed-in citizen must be able to upload — ${show(up)}`).not.toBe('');
    const own = await call(idUrl(citizenFile, ROOT_TENANT), { headers: headersFor(style, token) });
    expect(own.status, `the citizen must be able to fetch its own file before logout — ${show(own)}`).toBe(200);

    await ctx.close();
    await logoutViaApi(token, ROOT_TENANT);
    const after = await tokenStatus(token);
    test.skip(after === 200, `the logout API accepted the citizen's token but egov-user still accepts it on ${ROOT_TENANT}; the revoked-token check cannot run`);
    expectRejected(await call(idUrl(citizenFile, ROOT_TENANT), { headers: headersFor(style, token) }), 'token revoked by logout');
  });

  test('no FileStore endpoint lists files without a token @SEC/003', {
    annotation: {
      type: 'description',
      description: `SEC/003: no open link may list the files on the server — FileStore roots, the files collection (with and without trailing slash), the tag and metadata endpoints, and the storage bucket root behind the signed URLs.

Steps:
1. Positive control (beforeAll): the uploaded file exists and a valid token fetches it.
2. GET each listing candidate with no token; assert it is either refused, or answers without any file listing (no array of files, no fileStoreId, no bucket listing).
3. If a signed URL was handed out, GET the bucket root it points into; assert no bucket listing.`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    const t = encodeURIComponent(TENANT);
    const candidates = [
      `${BASE_URL}/filestore`,
      `${BASE_URL}/filestore/`,
      `${BASE_URL}/filestore/v1`,
      `${FS}`,
      `${FS}/`,
      `${FS}/id?tenantId=${t}`,
      `${FS}/tag?tenantId=${t}&tag=PGR`,
      `${FS}/metadata?tenantId=${t}&fileStoreId=${encodeURIComponent(fileStoreId)}`,
    ];
    const listed: string[] = [];
    for (const url of candidates) {
      const r = await call(url);
      const ok = r.status >= 200 && r.status < 300;
      const looksLikeListing =
        r.text.includes(fileStoreId) || /"files"\s*:\s*\[|"fileStoreIds"\s*:\s*\[|<ListBucketResult|<Contents>/i.test(r.text) || leaks(r).length > 0;
      if (ok && looksLikeListing) listed.push(`${url.replace(BASE_URL, '')} → ${show(r)}`);
    }
    if (signedUrl) {
      const u = new URL(signedUrl);
      const firstSegment = u.pathname.split('/').filter(Boolean)[0];
      for (const root of [`${u.origin}/`, firstSegment ? `${u.origin}/${firstSegment}/` : '']) {
        if (!root) continue;
        const r = await call(root);
        if (/<ListBucketResult|<Contents>/i.test(r.text)) listed.push(`bucket root ${root} → ${show(r)}`);
      }
    }
    expect(listed, 'endpoints that listed files without a token').toEqual([]);
  });

  test('bypass attempts do not reach a file without a token @SEC/004', {
    annotation: {
      type: 'description',
      description: `SEC/004: letter case, encoded paths, extra parameters, other HTTP methods and spoofed forwarding headers must not get round the token check.

Steps:
1. Positive control (beforeAll): a valid token fetches the file.
2. Send each variant with no token; assert none returns 2xx with content and none hands out a URL. (OPTIONS may answer 2xx for CORS, but must carry no content.)`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    const q = `tenantId=${encodeURIComponent(TENANT)}&fileStoreId=${encodeURIComponent(fileStoreId)}`;
    const variants: Array<{ label: string; url: string; init?: RequestInit }> = [
      { label: 'upper-case service', url: `${BASE_URL}/FILESTORE/v1/files/id?${q}` },
      { label: 'mixed-case path', url: `${BASE_URL}/filestore/V1/Files/Id?${q}` },
      { label: 'encoded slashes', url: `${BASE_URL}/filestore%2Fv1%2Ffiles%2Fid?${q}` },
      { label: 'encoded letter', url: `${BASE_URL}/filestore/v1/files/%69d?${q}` },
      { label: 'double slash', url: `${BASE_URL}//filestore/v1/files/id?${q}` },
      { label: 'empty auth-token param', url: `${FS}/id?${q}&auth-token=` },
      { label: 'garbage access_token param', url: `${FS}/id?${q}&access_token=x` },
      { label: 'garbage authToken param', url: `${FS}/id?${q}&authToken=x` },
      { label: 'extra unknown param', url: `${FS}/id?${q}&debug=true&public=true` },
      { label: 'HEAD', url: `${FS}/id?${q}`, init: { method: 'HEAD' } },
      { label: 'POST to /id', url: `${FS}/id?${q}`, init: { method: 'POST' } },
      { label: 'PUT to /id', url: `${FS}/id?${q}`, init: { method: 'PUT' } },
      { label: 'spoofed X-Forwarded-For', url: `${FS}/id?${q}`, init: { headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1' } } },
      { label: 'X-Original-URL rewrite', url: `${BASE_URL}/digit-ui/?${q}`, init: { headers: { 'X-Original-URL': `/filestore/v1/files/id?${q}`, 'X-Rewrite-URL': `/filestore/v1/files/id?${q}` } } },
      { label: 'OPTIONS', url: `${FS}/id?${q}`, init: { method: 'OPTIONS' } },
    ];
    const reached: string[] = [];
    for (const v of variants) {
      const r = await call(v.url, v.init);
      const twoXX = r.status >= 200 && r.status < 300;
      const gaveSomething = leaks(r).length > 0;
      const method = (v.init?.method || 'GET').toUpperCase();
      const methodShouldNot2xx = method !== 'OPTIONS' && !v.label.startsWith('X-Original');
      if (gaveSomething || (twoXX && methodShouldNot2xx && (method === 'HEAD' || r.bytes.length > 0) && !/<html/i.test(r.text))) {
        reached.push(`${v.label} → ${show(r)}`);
      }
    }
    expect(reached, 'variants that reached FileStore without a token').toEqual([]);
  });

  test('invalid, guessed and mixed file IDs give a safe error, not a 500 or a stack trace @SEC/005', {
    annotation: {
      type: 'description',
      description: `SEC/005: with a valid token, unknown, malformed, traversal and mixed ids must fail safely — no 5xx and no stack trace in the body.

Steps:
1. Positive control (beforeAll): the real id is served.
2. With the same valid token, fetch /files/id and /files/url for each bad id, and /files/url for a mix of the real id and a bad one.
3. Assert every status is below 500 and no body shows a Java stack trace or exception class.`,
    },
    tag: ['@2.12_session_checks', '@area:auth', '@kind:edge-case', '@layer:api', '@persona:system'],
  }, async () => {
    needControl();
    const bad = [
      '00000000-0000-4000-8000-000000000000',
      'abc',
      '../../etc/passwd',
      `${fileStoreId}x`,
      "' OR '1'='1",
      'x'.repeat(2_000),
    ];
    const unsafe: string[] = [];
    const trace = /\bat (org|com|java|javax|sun)\.[\w.$]+\(|\.java:\d+\)|Exception:|stack\s?trace/i;
    const check = (label: string, r: Reply) => {
      if (r.status >= 500 || trace.test(r.text)) unsafe.push(`${label} → ${show(r)}`);
    };
    for (const id of bad) {
      check(`/id ${id.slice(0, 30)}`, await call(idUrl(id), { headers: headersFor(style, adminToken) }));
      check(`/url ${id.slice(0, 30)}`, await call(urlUrl(id), { headers: headersFor(style, adminToken) }));
    }
    check('/url mixed', await call(urlUrl(`${fileStoreId},${bad[0]}`), { headers: headersFor(style, adminToken) }));
    expect(unsafe, 'requests that failed unsafely (5xx or a stack trace)').toEqual([]);
  });

  test('a signed-in citizen and a signed-in employee can open a file with its tenant id and file id @SEC/006', {
    annotation: {
      type: 'description',
      description: `SEC/006: only the parent tenant is configured, so any signed-in citizen or employee who sends a valid tenant id and file id gets the file (agreed expected result). A request under another tenant id is not specified, so its outcome is recorded, not asserted.

Steps:
1. Positive control (beforeAll): the admin uploaded a PNG under the tenant and can fetch it.
2. Provision a throwaway citizen; fetch the admin's file with the citizen's token, the valid tenant id and the file id; assert 200 and the file bytes.
3. Sign EMPLOYEE_USER in through the API; fetch the same file with the employee's token; assert 200 and the file bytes.
4. Fetch it with the admin's token under another tenant id; record the outcome.`,
    },
    tag: TAGS,
  }, async () => {
    test.setTimeout(90_000);
    needControl();
    const citizen = await provisionFreshCitizen();
    const asCitizen = await call(idUrl(fileStoreId), { headers: headersFor(style, citizen.token) });
    expect(asCitizen.status === 200 && isPng(asCitizen.bytes), `a signed-in citizen with the valid tenant id and file id must get the file — ${show(asCitizen)}`).toBe(true);

    const employee = await getPrincipal(EMPLOYEE_USER, EMPLOYEE_PASS);
    test.skip(!employee, `EMPLOYEE_USER ${EMPLOYEE_USER} could not sign in on ${TENANT} or ${ROOT_TENANT}, so the employee half cannot run`);
    const asEmployee = await call(idUrl(fileStoreId), { headers: headersFor(style, employee!.token) });
    expect(asEmployee.status === 200 && isPng(asEmployee.bytes), `a signed-in employee with the valid tenant id and file id must get the file — ${show(asEmployee)}`).toBe(true);

    const otherTenant = await call(idUrl(fileStoreId, `${ROOT_TENANT}.secaudit`), { headers: headersFor(style, adminToken) });
    test.info().annotations.push({
      type: 'finding',
      description: `same file asked for under another tenant id: HTTP ${otherTenant.status}${isPng(otherTenant.bytes) ? ' — served' : ' — not served'}`,
    });
  });

  test('a file URL handed to a signed-in user opens without a token and is valid for one hour @SEC/007', {
    annotation: {
      type: 'description',
      description: `SEC/007: the URL that /files/url returns is pre-signed — it opens directly in a browser with no token, and it is valid for 1 hour (agreed expected result). A run cannot wait out the hour, so the expiry the URL is signed with is checked instead.

Steps:
1. Positive control (beforeAll): a signed-in /files/url call returned a URL for the uploaded file.
2. GET that URL with no token and no cookies; assert 200 and the file bytes.
3. Read the expiry it is signed with: X-Amz-Expires must be 3600, or an Expires epoch must be at most 3600 s (plus 60 s clock skew) from now. A URL with no expiry fails.`,
    },
    tag: TAGS,
  }, async () => {
    needControl();
    expect(signedUrl, `a signed-in /files/url call on ${TENANT} returned no URL`).toMatch(/^https?:\/\//);
    const r = await call(signedUrl);
    expect(r.status === 200 && isPng(r.bytes), `the pre-signed URL must open with no token — got HTTP ${r.status} [${r.contentType}]`).toBe(true);

    const u = new URL(signedUrl);
    const amzExpires = u.searchParams.get('X-Amz-Expires');
    const epochExpires = u.searchParams.get('Expires');
    test.info().annotations.push({
      type: 'finding',
      description: `pre-signed URL expiry: ${amzExpires ? `X-Amz-Expires=${amzExpires} s` : epochExpires ? `Expires=${epochExpires} (epoch)` : 'none'}`,
    });
    if (amzExpires) {
      expect(Number(amzExpires), 'the pre-signed URL must be valid for 1 hour (X-Amz-Expires)').toBe(3600);
    } else {
      expect(epochExpires, 'the pre-signed URL carries no expiry (neither X-Amz-Expires nor Expires)').not.toBeNull();
      const secondsLeft = Number(epochExpires) - Date.now() / 1000;
      expect(secondsLeft, 'the pre-signed URL must not already be expired').toBeGreaterThan(0);
      expect(secondsLeft, 'the pre-signed URL must be valid for at most 1 hour').toBeLessThanOrEqual(3660);
    }
  });
});
