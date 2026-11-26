/**
 * Citizen — the photo on their own complaint and its receipt still load for a
 * signed-in citizen, now that FileStore requires a token (requirements §2.3).
 * Manual case SEC/009. Uploading a photo through the filing wizard is checked
 * manually, not here.
 *
 * The complaint comes from the lifecycle setup: on a session-checks run it
 * files the non-terminal complaint WITH a photo already in FileStore, as the
 * suite's provisioned citizen, and records it in lifecycle-fixtures.json
 * (`photo`). The citizen signs in through the API as that same citizen. Each
 * test fails on any FileStore response its page received that was refused —
 * "loads" means FileStore accepted the signed-in citizen, not merely that
 * something rendered.
 */
import { test, expect } from '../utils/session-test';
import { BASE_URL } from '../utils/env';
import { citizenOtpLogin } from '../utils/citizen-login';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { downloadReceipt, failedFilestoreCalls, imageStatus, recordFilestoreTraffic } from '../utils/complaint-files-ui';

const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'];
/*
 * The thumbnail in the complaint page's Attachments card:
 *   <div class="photos-wrap"><img src="…/file-store/…_small.jpg?X-Amz-…" alt="issue thumbnail"></div>
 * Matched by that structure only — a URL-based fallback can pick up a header
 * image instead.
 */
const DETAIL_IMG = '.photos-wrap img';

/** The seeded complaint with a photo, or a skip reason naming why there is none. */
function seededPhoto(): { srid: string; citizenMobile: string } | { skip: string } {
  const f = readLifecycleFixtures();
  if (f?.photo) return f.photo;
  return { skip: f?.photo_skipped_reason || f?.skipped_reason || 'the lifecycle setup recorded no complaint with a photo (lifecycle-fixtures.json has no `photo`)' };
}

test.describe('citizen — complaint photo and receipt with FileStore access control', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the citizen sees the photo on their complaint @SEC/009', {
    annotation: {
      type: 'description',
      description: `SEC/009 (view): the photo attached to a citizen's complaint must load on the complaint page for that citizen.

Steps:
1. Lifecycle setup: the provisioned citizen filed a complaint with a PNG already in FileStore.
2. Sign that citizen in through the API; open the complaint; its id is shown (positive control).
3. Wait for the Attachments thumbnail (.photos-wrap img, up to 30 s — the card fills in after the page's own calls), scroll it into view, and wait for it to decode (on screen, naturalWidth > 0); the failure names its HTTP status and size.
4. Assert no FileStore call was refused (API and pre-signed file URLs).`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.setTimeout(120_000);
    const photo = seededPhoto();
    test.skip('skip' in photo, 'skip' in photo ? photo.skip : '');
    const { srid, citizenMobile } = photo as { srid: string; citizenMobile: string };
    const seen = recordFilestoreTraffic(page);
    await citizenOtpLogin(page, citizenMobile);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${srid}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(srid).first(), 'the complaint page must render (positive control)').toBeVisible({ timeout: 30_000 });
    const thumb = await imageStatus(page, DETAIL_IMG);
    expect(thumb.ok, `the photo must load on the complaint page — ${thumb.detail}`).toBe(true);
    expect(failedFilestoreCalls(seen), 'FileStore calls refused on the complaint page').toEqual([]);
  });

  test('the citizen can download the complaint receipt @SEC/009', {
    annotation: {
      type: 'description',
      description: `SEC/009 (receipt): the receipt download must still work for the signed-in citizen.

Steps:
1. Sign the citizen who filed the seeded complaint in through the API; open the complaint (positive control: its id is shown).
2. Use the page's download / receipt control.
3. Assert a non-empty file was downloaded, or a PDF response succeeded; and no FileStore call was refused.`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.setTimeout(120_000);
    const photo = seededPhoto();
    test.skip('skip' in photo, 'skip' in photo ? photo.skip : '');
    const { srid, citizenMobile } = photo as { srid: string; citizenMobile: string };
    const seen = recordFilestoreTraffic(page);
    await citizenOtpLogin(page, citizenMobile);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${srid}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(srid).first()).toBeVisible({ timeout: 30_000 });
    const r = await downloadReceipt(page);
    expect(r.found, `citizen complaint ${srid}: ${r.detail}`).toBe(true);
    expect(r.ok, `citizen receipt download: ${r.detail}`).toBe(true);
    expect(failedFilestoreCalls(seen), 'FileStore calls refused during the receipt download').toEqual([]);
  });
});
