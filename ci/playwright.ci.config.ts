/**
 * playwright.ci.config.ts — the suite's own config, with recording behind flags.
 *
 * ci/prepare-suite.sh copies this file next to the suite's playwright.config.ts,
 * and ci/run-suite.sh runs `npx playwright test --config playwright.ci.config.ts`.
 * Everything (projects, setup chain, reporters, timeouts, workers) comes from the
 * suite's config unchanged; only what gets recorded differs:
 *
 *   screenshot  off, unless RECORD_SCREENSHOTS=true → failing tests only
 *   video       off, unless RECORD_VIDEO=true       → kept for failing tests only
 *   trace       off, unless RECORD_TRACES=true      → kept for failing tests only
 *
 * With all three off, the published report is text only: no images, videos or
 * traces reach the public dashboard or the downloadable results.
 *
 * Why not the suite's own "record everything": a full run then produces several
 * GB, past GitHub Pages' 1 GB limit. And traces capture live session tokens,
 * which would be readable on the public dashboard until they expire.
 *
 * RECORD_SCREENSHOTS / RECORD_VIDEO / RECORD_TRACES are repository variables
 * (Settings → Secrets and variables → Actions → Variables). See docs/GUIDE.md §8.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const on = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test((v ?? '').trim());

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    screenshot: on(process.env.RECORD_SCREENSHOTS) ? 'only-on-failure' : 'off',
    video: on(process.env.RECORD_VIDEO) ? 'retain-on-failure' : 'off',
    trace: on(process.env.RECORD_TRACES) ? 'retain-on-failure' : 'off',
  },
});
