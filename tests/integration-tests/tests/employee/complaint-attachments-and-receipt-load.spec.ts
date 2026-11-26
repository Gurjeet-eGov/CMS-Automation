/**
 * Employee — a complaint's attachment, opening it in a new tab, and its PDF
 * receipt still work for a signed-in employee, now that FileStore requires a
 * token (requirements §2.3). Manual case SEC/008.
 *
 * The complaint comes from the lifecycle setup: on a session-checks run it
 * files the non-terminal complaint WITH a photo already in FileStore and
 * records it in lifecycle-fixtures.json (`photo`). The employee is
 * CITY_ADMIN_USER — an employee with the CMS roles (workflowEmployee() in
 * utils/session-checks.ts) — signed in through the API: this spec is about
 * FileStore, not sign-in. Every test fails on any FileStore response that was
 * refused.
 */
import { test, expect } from '../utils/session-test';
import { BASE_URL } from '../utils/env';
import { loginEmployeeBrowser } from '../utils/employee-ui';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { downloadReceipt, failedFilestoreCalls, imageStatus, recordFilestoreTraffic } from '../utils/complaint-files-ui';
import { workflowEmployee } from '../utils/session-checks';
import type { Page } from '../utils/session-test';

const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:employee'];
/*
 * The complaint page on cms_pilot: the Attachments card shows the thumbnail as
 * `.photos-wrap img` (a pre-signed /file-store/… URL), and the timeline links
 * the full file with `<a target="_blank" href="…/file-store/…">`. The thumbnail
 * is matched by that structure only (a URL-based fallback can pick up a header
 * image); the link keeps its URL forms.
 */
const THUMB = '.photos-wrap img';
const ATTACHMENT_LINK = 'a[target="_blank"][href*="/file-store/"], a[target="_blank"][href*="/filestore/"]';

const fixtures = readLifecycleFixtures();
const srid = fixtures?.photo?.srid ?? '';
const seedSkip = srid
  ? ''
  : fixtures?.photo_skipped_reason || fixtures?.skipped_reason || 'the lifecycle setup recorded no complaint with a photo (lifecycle-fixtures.json has no `photo`)';

async function openComplaintAsEmployee(page: Page): Promise<void> {
  const who = await workflowEmployee();
  test.skip('skip' in who, 'skip' in who ? who.skip : '');
  const { user, pass } = who as { user: string; pass: string };
  const ok = await loginEmployeeBrowser(page, user, pass);
  expect(ok, `CITY_ADMIN_USER ${user} must get a browser session (it signed in through the API a moment ago)`).toBeTruthy();
  await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(srid).first(), 'the complaint page must render for the employee (positive control)').toBeVisible({ timeout: 30_000 });
}

test.describe('employee — complaint attachments and receipt with FileStore access control', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the complaint\'s attachment thumbnails load for the employee @SEC/008', {
    annotation: {
      type: 'description',
      description: `SEC/008 (attachments, thumbnails): the photo a citizen attached must render on the employee's complaint page.

Steps:
1. Lifecycle setup: a citizen filed a complaint with a PNG already in FileStore.
2. Sign CITY_ADMIN_USER (an employee with the CMS roles) in through the API; open the complaint (positive control: its id is shown).
3. Wait for the Attachments thumbnail (.photos-wrap img, up to 30 s), scroll it into view and wait for it to decode (on screen, naturalWidth > 0); the failure names its HTTP status and size.
4. Assert no FileStore call was refused (API and pre-signed file URLs).`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!!seedSkip, seedSkip);
    const seen = recordFilestoreTraffic(page);
    await openComplaintAsEmployee(page);
    const thumb = await imageStatus(page, THUMB);
    expect(thumb.ok, `the attachment thumbnail must load — ${thumb.detail}`).toBe(true);
    expect(failedFilestoreCalls(seen), 'FileStore calls refused on the employee complaint page').toEqual([]);
  });

  test('opening the attachment in a new tab shows the file @SEC/008', {
    annotation: {
      type: 'description',
      description: `SEC/008 (open in new tab): clicking the attachment opens it in a new tab, and the file must load there for the signed-in employee.

Steps:
1. Sign the employee in; open the complaint; the thumbnail is visible (positive control).
2. Click the attachment's link (it opens in a new tab) and wait for the new tab.
3. Assert the new tab's main response succeeded and the image decodes there.`,
    },
    tag: TAGS,
  }, async ({ page, context }) => {
    test.setTimeout(180_000);
    test.skip(!!seedSkip, seedSkip);
    await openComplaintAsEmployee(page);
    const link = page.locator(ATTACHMENT_LINK).first();
    await expect(link, 'the attachment link must be on the page (positive control)').toBeVisible({ timeout: 20_000 });
    const popup = context.waitForEvent('page', { timeout: 15_000 });
    await link.click();
    const tab = await popup;
    const resp = await tab.waitForEvent('response', { predicate: (r) => r.url() === tab.url(), timeout: 15_000 }).catch(() => null);
    await tab.waitForLoadState('load').catch(() => {});
    if (resp) expect(resp.status(), `the attachment opened in a new tab answered HTTP ${resp.status()}`).toBeLessThan(400);
    const opened = await imageStatus(tab, 'img');
    expect(opened.ok, `the attachment must load in the new tab — ${opened.detail}`).toBe(true);
  });

  test('the employee can download the complaint\'s PDF receipt @SEC/008', {
    annotation: {
      type: 'description',
      description: `SEC/008 (PDF receipt): the receipt download must still work for the signed-in employee.

Steps:
1. Sign the employee in; open the complaint (positive control: its id is shown).
2. Use the page's download / receipt / PDF control.
3. Assert a non-empty file was downloaded, or a PDF response succeeded; and no FileStore call was refused.`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!!seedSkip, seedSkip);
    const seen = recordFilestoreTraffic(page);
    await openComplaintAsEmployee(page);
    const r = await downloadReceipt(page);
    expect(r.found, `employee complaint ${srid}: ${r.detail}`).toBe(true);
    expect(r.ok, `employee receipt download: ${r.detail}`).toBe(true);
    expect(failedFilestoreCalls(seen), 'FileStore calls refused during the receipt download').toEqual([]);
  });
});
