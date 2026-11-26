/**
 * UI helpers for the file-access regression checks (@2.12_session_checks,
 * SEC/008–011): watching the FileStore traffic a page makes, downloading a
 * complaint receipt, and checking images shown before sign-in.
 *
 * The complaint with a photo these checks open is seeded once per run by the
 * lifecycle setup (tests/fixtures/lifecycle.setup.ts → lifecycle-fixtures.json
 * `photo`), through the API.
 */
import type { Page, Response } from '@playwright/test';
import { BASE_URL } from './env';

/**
 * Every FileStore response a page receives, for "the page's FileStore calls
 * succeed": the API (/filestore/v1/…) and the pre-signed file URLs it hands out
 * (/file-store/…, where the thumbnails are fetched from).
 */
export function recordFilestoreTraffic(page: Page): Array<{ url: string; status: number; method: string }> {
  const seen: Array<{ url: string; status: number; method: string }> = [];
  page.on('response', (r: Response) => {
    if (/\/file-?store\//i.test(r.url())) seen.push({ url: r.url().split('?')[0], status: r.status(), method: r.request().method() });
  });
  return seen;
}

/** FileStore calls that failed, as readable lines (no query strings, so no ids or tokens). */
export function failedFilestoreCalls(seen: Array<{ url: string; status: number; method: string }>): string[] {
  return seen.filter((s) => s.status >= 400).map((s) => `${s.method} ${s.url.replace(BASE_URL, '')} → HTTP ${s.status}`);
}

/**
 * Click the complaint page's receipt / PDF control and report what came back:
 * a download (with its size), or a PDF response. Never throws for "not found" —
 * the caller asserts on `found` so the message names the page it looked at.
 */
export async function downloadReceipt(page: Page): Promise<{ found: boolean; ok: boolean; detail: string }> {
  const control = page
    .getByRole('button', { name: /download|receipt|pdf/i })
    .or(page.getByRole('link', { name: /download|receipt|pdf/i }))
    .first();
  if (!(await control.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false))) return { found: false, ok: false, detail: 'no download / receipt / PDF control visible' };

  let pdfStatus = 0;
  const onResponse = (r: Response) => {
    const ct = r.headers()['content-type'] || '';
    if (/pdf/i.test(ct) || /\/(pdf-service|egov-pdf)\//i.test(r.url())) pdfStatus = pdfStatus || r.status();
  };
  page.context().on('response', onResponse);
  try {
    const download = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await control.click();
    const d = await download;
    if (d) {
      const path = await d.path().catch(() => null);
      const { statSync } = await import('node:fs');
      const size = path ? statSync(path).size : 0;
      return { found: true, ok: size > 0, detail: `download "${d.suggestedFilename()}" (${size} bytes)` };
    }
    await page.waitForTimeout(3_000);
    return { found: true, ok: pdfStatus > 0 && pdfStatus < 400, detail: pdfStatus ? `PDF response HTTP ${pdfStatus}` : 'no download and no PDF response after clicking' };
  } finally {
    page.context().off('response', onResponse);
  }
}

interface ImageState {
  found: boolean;
  shown: boolean;
  complete: boolean;
  width: number;
  height: number;
  path: string;
  status: number;
}

/**
 * Does the image matched by `selector` actually show? Built for a complaint page
 * that fills its Attachments card late (after its workflow and file-URL calls):
 *   1. wait up to `appearMs` for the element to exist, then scroll it into view
 *      (a lazily loaded image does not fetch until it is near the viewport);
 *   2. poll up to `decodeMs` until it is on screen and decoded (complete,
 *      naturalWidth > 0) — React may re-render it meanwhile, so a failed read
 *      just retries;
 *   3. report the image's path (never the signed query string), its own HTTP
 *      status (the browser's resource timing for its URL) and its natural size,
 *      so a failure says which of "not there / refused / not an image" it was.
 */
export async function imageStatus(
  page: Page,
  selector: string,
  { appearMs = 30_000, decodeMs = 20_000 }: { appearMs?: number; decodeMs?: number } = {},
): Promise<{ ok: boolean; detail: string }> {
  const img = page.locator(selector).first();
  if (!(await img.waitFor({ state: 'attached', timeout: appearMs }).then(() => true, () => false))) {
    return { ok: false, detail: `no image matching "${selector}" appeared within ${appearMs / 1000} s` };
  }
  await img.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  const read = (): Promise<ImageState> =>
    img
      .evaluate((el: HTMLImageElement) => {
        const src = el.currentSrc || el.src || '';
        const timing = performance.getEntriesByName(src).pop() as (PerformanceEntry & { responseStatus?: number }) | undefined;
        const r = el.getBoundingClientRect();
        let path = src;
        try {
          path = /^(blob|data):/.test(src) ? src.slice(0, 16) : new URL(src).pathname;
        } catch {
          /* keep */
        }
        return {
          found: true,
          shown: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
          complete: el.complete,
          width: el.naturalWidth,
          height: el.naturalHeight,
          path,
          status: timing?.responseStatus ?? 0,
        };
      })
      .catch(() => ({ found: false, shown: false, complete: false, width: 0, height: 0, path: '', status: 0 }));
  let s = await read();
  const deadline = Date.now() + decodeMs;
  while (!(s.shown && s.complete && s.width > 0) && Date.now() < deadline) {
    await page.waitForTimeout(250);
    s = await read();
  }
  const ok = s.shown && s.complete && s.width > 0;
  const why = ok ? '' : !s.found ? 'element went away' : !s.shown ? 'not on screen' : !s.complete ? 'still loading' : 'did not decode (broken image)';
  return {
    ok,
    detail: `${s.path || selector} — HTTP ${s.status || 'n/a'}, ${s.width}×${s.height}${why ? `, ${why} after ${decodeMs / 1000} s` : ''}`,
  };
}

/** True when the image is on screen and decoded; see imageStatus() for the detail of a failure. */
export async function imageLoaded(page: Page, selector: string): Promise<boolean> {
  return (await imageStatus(page, selector)).ok;
}

/**
 * Open `url` in a page with NO session and report its images: how many are
 * visible, which visible ones failed to decode, and which image or FileStore
 * responses failed. For "branding images load before sign-in" (SEC/011).
 */
export async function signedOutImages(page: Page, url: string): Promise<{ visible: number; broken: string[]; failedResponses: string[] }> {
  const failedResponses: string[] = [];
  page.on('response', (r) => {
    const isImage = r.request().resourceType() === 'image' || /\/filestore\//i.test(r.url());
    if (isImage && r.status() >= 400) failedResponses.push(`${r.url().split('?')[0].replace(BASE_URL, '')} → HTTP ${r.status()}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  const imgs = await page.locator('img').evaluateAll((els) =>
    els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      })
      .map((e) => ({ src: (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src, ok: (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0 })),
  );
  return {
    visible: imgs.length,
    broken: imgs.filter((i) => !i.ok).map((i) => i.src.split('?')[0].replace(BASE_URL, '')),
    failedResponses,
  };
}
