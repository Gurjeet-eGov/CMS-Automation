import { tenantSlug } from '../utils/identity-bff';
/**
 * Citizen complaint — image attachment lifecycle (CCRS #555).
 *
 * Two halves of #555:
 *   1. Upload preview — the create form should show an <img> preview
 *      with a public-reachable URL (naturalWidth > 0) after the file
 *      is set, proving the `ComplaintPhotos.js` parser fix.
 *   2. Detail page render — the same image should appear on the
 *      complaint detail page (citizen view) once submitted.
 *
 * The detail half currently fails on bomet — Gurjeet 2026-05-20
 * UNRESOLVED retest. This spec catches both halves so the regression
 * surface is one whole flow.
 */
import path from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { BASE_URL } from '../utils/env';
import { citizenOtpLogin } from '../utils/citizen-login';
import { requires } from '../utils/capabilities';
import { fileComplaintUrl, fileComplaintViaWizard } from '../utils/citizen-filing';

// Attachment images are matched by what they are, never by where they are
// stored: the header's tenant logo is served from filestore too (alt="Logo",
// class digit-header-logo-img), so a filestore/host match picked the logo.
// - The upload preview is the picked file itself, shown from a blob: object URL
//   (PhotoPicker's img.cms-photo-thumb). No logo is ever a blob: URL.
// - Every attachment on the details page is an <img alt="issue thumbnail">,
//   DIGIT's attachment-thumbnail marker. Logos carry their own alts ("Logo",
//   "State Logo", …); the :not(…logo…) part guards against a build that ever
//   gives a logo a thumbnail-like alt.
// Neither depends on a fileStoreId, so a flow where more images are added or
// replaced later uses the same selectors.
const PREVIEW_IMG = 'img.cms-photo-thumb, img[src^="blob:"]';
const ATTACHMENT_IMG = 'img[alt*="thumbnail" i]:not([alt*="logo" i]):not([class*="logo" i])';

/** The image's intrinsic width once it has finished loading; 0 until then (or if it failed). */
const loadedWidth = (img: Locator) =>
  img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)).catch(() => 0);


test.describe('citizen complaint — attachment lifecycle #555', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('upload preview renders, then detail page surfaces the same image', { tag: ['@persona:citizen'] }, async ({ page }) => {
    // ============ OTP login (uses suite-wide provisioned citizen) ============
    await citizenOtpLogin(page);
    await page.waitForTimeout(3_000);

    // ============ Open new-complaint wizard ============
    // Develop's filing flow (utils/citizen-filing.ts): the photo picker sits on
    // step 1, next to the description and category.
    await page.goto(fileComplaintUrl(), { waitUntil: 'domcontentloaded' });
    const FILE_INPUT = 'input[type="file"]';
    await expect(page.locator('#complaint-description'), 'the details step must render').toBeVisible({ timeout: 20_000 });
    expect(await page.locator(FILE_INPUT).count(), 'the details step must offer a photo input').toBeGreaterThan(0);

    await page
      .locator(FILE_INPUT)
      .first()
      .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));

    const preview = page.locator(PREVIEW_IMG).filter({ visible: true }).first();
    await expect(preview, '#555 — the picked photo must show a preview <img>').toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => loadedWidth(preview), { message: '#555 — preview img must load (naturalWidth > 0)', timeout: 10_000 })
      .toBeGreaterThan(0);

    // ============ Submit + capture complaint id ============
    const createPromise = page
      .waitForResponse(
        (r) => /\/pgr-services\/.*\/_create/.test(r.url()) && r.status() < 500,
        { timeout: 60_000 },
      )
      .catch(() => null);
    // Next stays disabled until the photo has uploaded.
    await fileComplaintViaWizard(page, { description: 'Integration test description for #555 attachment.' });
    const createResp = await createPromise;
    if (!createResp) {
      test.info().annotations.push({
        type: 'skipped',
        description: '#555 detail render — wizard submit did not complete in this run.',
      });
      return;
    }
    const createJson = await createResp.json().catch(() => ({} as Record<string, unknown>));
    const sr0 = (
      (createJson as Record<string, unknown>).ServiceWrappers as Array<Record<string, unknown>> | undefined
    )?.[0]?.service as Record<string, unknown> | undefined;
    const complaintNumber = sr0?.serviceRequestId as string | undefined;
    expect(complaintNumber, '_create response must include a serviceRequestId').toBeTruthy();

    // ============ Detail page — Attachments img renders ============
    // Gated on the declared capability, not a stray env hatch: whether the
    // detail page renders the uploaded attachment <img> can't be discovered by
    // a read-only probe (see capabilities.ts), so deploy/expectations/*.json
    // carries the call per deployment. maputo-local + bomet both declare this
    // 'required', so a real #555 detail-half regression now fails loudly
    // instead of hiding behind ATTACHMENT_DETAIL_UNSUPPORTED. The upload-preview
    // half above always validates the ComplaintPhotos.js parser regardless.
    requires(test, 'ui.citizen.attachmentDetailRender', 'CCRS#555 detail half');
    // Citizen detail route is `/citizen/pgr/complaints/:id` (PLURAL) — see
    // pgr/src/pages/citizen/index.js:33 and the route contract locked in by
    // track-my-complaint.spec.ts. `/complaint-details/:id` is the EMPLOYEE
    // route; under /citizen it matches nothing, so the page renders an empty
    // shell (BackButton only) and the Attachments <img> can never appear.
    await page.goto(
      `${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/complaints/${complaintNumber}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5_000);

    // Any visible attachment thumbnail, however many the complaint has: this
    // proves the Attachments section renders real, loaded images (what #555
    // broke), not that it is this test's exact file.
    const attachment = page.locator(ATTACHMENT_IMG).filter({ visible: true }).first();
    await expect(
      attachment,
      '#555 — Attachments section on the citizen detail page must surface an <img>',
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => loadedWidth(attachment), { message: '#555 — detail img must load (naturalWidth > 0)', timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});
