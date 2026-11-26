/**
 * Configurator — XLSX and logo uploads still work for a signed-in admin
 * (FileStore regression, requirements §2.3).
 *
 * The FileStore fix requires a token for every FileStore call; the
 * configurator's uploads must keep working. Manual case SEC/010, covered here
 * standalone (it does not lean on onboarding/phase1-branding.spec.ts).
 *
 *   - XLSX: the Departments bulk import accepts a one-row workbook and previews
 *     it as valid. Nothing is created — the test stops at the preview.
 *   - Logo: the only logo upload is the onboarding wizard's branding step, which
 *     first creates a throwaway child tenant. Like tests/onboarding/ it is
 *     opt-in (RUN_ONBOARDING=1 in the environment's config.env); afterAll
 *     deactivates the tenant it created.
 *
 * Both fail on any FileStore response that was refused.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { test, expect } from '../utils/session-test';
import { failedFilestoreCalls, imageLoaded, recordFilestoreTraffic } from '../utils/complaint-files-ui';
import { deactivateTenantViaApi, freshOnboardingIds, loginOnboarding, tmpXlsx, writeTenantFixture } from '../utils/onboarding';

const TAGS = ['@2.12_session_checks', '@area:auth', '@kind:regression', '@layer:ui', '@persona:admin'];
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

test.describe('configurator — XLSX upload with FileStore access control', () => {
  test('the Departments bulk import accepts an XLSX and previews it as valid @SEC/010', {
    annotation: {
      type: 'description',
      description: `SEC/010 (XLSX): a signed-in admin's workbook upload must still be accepted. Uses the configurator session from the setup project. Nothing is created.

Steps:
1. Open /configurator/manage/departments/bulk as the signed-in admin.
2. Upload a one-row Department workbook built in memory.
3. Assert the preview reports 1 valid row (positive: the upload was read) and no FileStore call was refused.
4. Leave without creating.`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.setTimeout(120_000);
    const seen = recordFilestoreTraffic(page);
    await page.goto('/configurator/manage/departments/bulk', { waitUntil: 'domcontentloaded' });
    const input = page.locator('input[type="file"]').first();
    await expect(input, 'the bulk import page must show its upload control (positive control)').toBeAttached({ timeout: 30_000 });
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Department');
    sheet.addRow(['code', 'name', 'description']);
    sheet.addRow([`SC${Date.now().toString(36).toUpperCase()}`, 'Session checks preview', 'Not created']);
    await input.setInputFiles({
      name: 'departments.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
    });
    await expect(page.getByText(/\b1\s*(valid|rows?)\b/i).first(), 'the uploaded workbook must preview as 1 valid row').toBeVisible({ timeout: 30_000 });
    expect(failedFilestoreCalls(seen), 'FileStore calls refused during the XLSX upload').toEqual([]);
  });
});

test.describe('configurator — logo upload with FileStore access control', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const createdTenants: string[] = [];
  const tempFiles: string[] = [];

  test.afterAll(async () => {
    tempFiles.forEach((f) => fs.rmSync(f, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('a logo uploaded in the branding step is stored and shown back @SEC/010', {
    annotation: {
      type: 'description',
      description: `SEC/010 (logo): the branding upload must still reach FileStore for a signed-in admin, and the logo must be shown back. Opt-in: needs RUN_ONBOARDING=1, because the branding step sits behind creating a throwaway child tenant (deactivated in afterAll).

Steps:
1. Sign in to the configurator in Onboarding mode; upload a one-tenant workbook and "Upload to DIGIT" (creates the throwaway tenant).
2. At "Branding assets", upload a PNG to the first image row.
3. Assert the FileStore upload succeeded, the row shows a stored file, and any preview image decodes; no FileStore call was refused.`,
    },
    tag: TAGS,
  }, async ({ page }) => {
    test.skip(process.env.RUN_ONBOARDING !== '1', 'the logo upload sits in the onboarding wizard, which creates a throwaway child tenant; set RUN_ONBOARDING=1 in this environment\'s config.env to run it');
    test.setTimeout(240_000);
    const seen = recordFilestoreTraffic(page);
    const ids = freshOnboardingIds();
    const tenantFile = tmpXlsx('tenant-secaudit', ids.SUFFIX);
    const logoFile = path.join(os.tmpdir(), `logo-secaudit-${ids.SUFFIX}.png`);
    await writeTenantFixture(tenantFile, ids);
    fs.writeFileSync(logoFile, PNG);
    tempFiles.push(tenantFile, logoFile);

    await loginOnboarding(page);
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await page.locator('input[type="file"]').first().setInputFiles(tenantFile);
    await expect(page.getByRole('cell', { name: ids.TENANT_CODE })).toBeVisible({ timeout: 30_000 });
    createdTenants.push(ids.TENANT_CODE);
    await page.getByRole('button', { name: /Upload to DIGIT/i }).click();
    const brandingInput = page.locator('input[type="file"][accept*="image"]').first();
    await expect(brandingInput, 'the branding step must show an image upload (positive control)').toBeAttached({ timeout: 60_000 });

    const upload = page.waitForResponse((r) => /\/filestore\/v1\/files/i.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
    await brandingInput.setInputFiles(logoFile);
    const resp = await upload;
    expect(resp.status(), `the logo upload to FileStore answered HTTP ${resp.status()}`).toBeLessThan(300);
    await expect(page.getByText(/filestore id|uploaded/i).first(), 'the branding row must show the stored file').toBeVisible({ timeout: 30_000 });
    const preview = page.locator('img[src*="filestore"], img[src^="blob:"], img[src^="data:image"]');
    if (await preview.first().isVisible().catch(() => false)) {
      expect(await imageLoaded(page, 'img[src*="filestore"], img[src^="blob:"], img[src^="data:image"]'), 'the logo preview must load').toBe(true);
    }
    expect(failedFilestoreCalls(seen), 'FileStore calls refused during the logo upload').toEqual([]);
  });
});
