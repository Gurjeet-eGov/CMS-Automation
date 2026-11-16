// node --test ci/tests/  — the verdict logic of ci/summarize.mjs, on hand-made
// reports and catalogs. Uses the suite's own regression-alert.mjs, so a change
// to its analyzeRun() that breaks this repo's alerts shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, outcomes, renderMarkdown, slackPayload, shouldNotify, links } from '../summarize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { analyzeRun } = await import(path.join(here, '../../tests/integration-tests/scripts/regression-alert.mjs'));

const meta = (over = {}) => ({
  runId: '2026-11-17_1000_aaaaaaaa', environment: 'naipepea', scope: 'full', grep: null, partial: false,
  dashboardKey: 'master/naipepea',
  source: { kind: 'this-branch', branch: 'master', sha: 'aaaaaaaa1111', repo: 'me/CMS-Automation', ref: 'master' },
  target: { baseUrl: 'https://naipepea.digit.org', tenant: 'qa', workspaceSlug: 'qa2398' },
  recording: { video: false, traces: false },
  startedAt: '2026-11-17T10:00:00Z', finishedAt: '2026-11-17T10:42:00Z',
  configProblems: [], preflight: { ok: true, httpCode: '200', error: null }, playwrightExit: 1, secretKeys: ['ADMIN_PASSWORD'],
  ...over,
});

/** A Playwright JSON report from [file, line, title, status, project?] rows. */
function report(rows, errors = []) {
  const byFile = new Map();
  for (const [file, line, title, status, project = 'chromium'] of rows) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({
      title, file, line, column: 1,
      tests: [{ projectName: project, status: status === 'passed' ? 'expected' : status === 'skipped' ? 'skipped' : 'unexpected',
        results: status === 'notRun' ? [] : [{ status, duration: 1000, error: FAILEDISH.has(status) ? { message: `Error: ${title} broke\n    at x` } : undefined }] }],
    });
  }
  return {
    config: { rootDir: '/work/suite/tests' },
    suites: [...byFile].map(([file, specs]) => ({ title: file, file, specs, suites: [] })),
    errors: errors.map(message => ({ message })),
  };
}
const FAILEDISH = new Set(['failed', 'timedOut']);

/** A catalog with runs newest first and per-test histories. */
function catalog(runIds, perTest) {
  return {
    runs: runIds.map(id => ({ id, branch: 'master', sha: id.slice(-8), passed: 0, failed: 0, skipped: 0, total: 0 })),
    tests: Object.entries(perTest).map(([key, statuses]) => {
      const [file, line, title] = key.split(':');
      return {
        id: key, file, line: Number(line), title,
        history: statuses.map((status, i) => ({ runId: runIds[i], status })).filter(h => h.status),
      };
    }),
  };
}

test('outcomes reads final results, marks setup files and builds tests/ paths', () => {
  const r = report([
    ['fixtures/auth.setup.ts', 3, 'authenticate', 'passed', 'setup'],
    ['citizen/a.spec.ts', 10, 'files a complaint', 'failed'],
    ['citizen/a.spec.ts', 20, 'never ran', 'notRun'],
  ]);
  const o = outcomes(r);
  assert.equal(o.length, 3);
  assert.deepEqual(o.map(t => [t.file, t.status, t.setup]), [
    ['tests/fixtures/auth.setup.ts', 'passed', true],
    ['tests/citizen/a.spec.ts', 'failed', false],
    ['tests/citizen/a.spec.ts', 'notRun', false],
  ]);
  assert.match(o[1].error, /files a complaint broke/);
});

test('partial run: any failing test is an alert', () => {
  const r = report([['smoke/x.spec.ts', 5, 'health', 'failed', 'smoke'], ['smoke/y.spec.ts', 6, 'ok', 'passed', 'smoke']]);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: r });
  assert.equal(res.alert, true);
  assert.deepEqual(res.events.map(e => e.kind), ['failures']);
  assert.match(res.headline, /naipepea · smoke: 1 failing/);
});

test('partial run, all green: no alert', () => {
  const r = report([['smoke/y.spec.ts', 6, 'ok', 'passed', 'smoke']]);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: r });
  assert.equal(res.alert, false);
  assert.match(res.headline, /no new problems — 1 passed/);
});

test('full run: a test that passed last time and fails now is a regression; a known red is not', () => {
  const runs = ['2026-11-17_1000_aaaaaaaa', '2026-11-16_1000_bbbbbbbb'];
  const cat = catalog(runs, {
    'tests/citizen/a.spec.ts:10:files a complaint': ['failed', 'passed'],   // regressed
    'tests/api/b.spec.ts:7:deliberate red': ['failed', 'failed'],           // known red
    'tests/citizen/c.spec.ts:4:fixed one': ['passed', 'failed'],            // fixed
    'tests/admin/d.spec.ts:2:now skipped': ['skipped', 'passed'],           // now skipped
  });
  const r = report([
    ['citizen/a.spec.ts', 10, 'files a complaint', 'failed'],
    ['api/b.spec.ts', 7, 'deliberate red', 'failed', 'api'],
    ['citizen/c.spec.ts', 4, 'fixed one', 'passed'],
    ['admin/d.spec.ts', 2, 'now skipped', 'skipped'],
  ]);
  const res = evaluate({ meta: meta(), report: r, catalog: cat, analyze: analyzeRun, published: true });
  assert.deepEqual(res.events.map(e => e.kind), ['regressed', 'now-skipped']);
  assert.equal(res.events[0].items[0].text, 'tests/citizen/a.spec.ts:10 — files a complaint');
  assert.equal(res.comparison.fixed.length, 1);
  const md = renderMarkdown(res, links(meta(), { PAGES_URL: 'https://me.github.io/CMS-Automation', RUN_URL: 'https://github.com/run/1' }, true));
  assert.match(md, /Regressed: passed before, failing now/);
  assert.match(md, /Fixed since 2026-11-16_1000_bbbbbbbb/);
  assert.match(md, /All failing tests \(2\) — any not listed above were already failing/);
  assert.match(md, /https:\/\/me\.github\.io\/CMS-Automation\/master\/naipepea\/runs\/2026-11-17_1000_aaaaaaaa\/playwright-report\//);
});

test('full run with only known reds: no alert', () => {
  const runs = ['2026-11-17_1000_aaaaaaaa', '2026-11-16_1000_bbbbbbbb'];
  const cat = catalog(runs, { 'tests/api/b.spec.ts:7:deliberate red': ['failed', 'failed'] });
  const r = report([['api/b.spec.ts', 7, 'deliberate red', 'failed', 'api']]);
  const res = evaluate({ meta: meta(), report: r, catalog: cat, analyze: analyzeRun, published: true });
  assert.equal(res.alert, false);
});

test('first full run on a dashboard is the baseline: failures listed, no alert', () => {
  const cat = catalog(['2026-11-17_1000_aaaaaaaa'], { 'tests/a.spec.ts:1:x': ['failed'] });
  const r = report([['a.spec.ts', 1, 'x', 'failed']]);
  const res = evaluate({ meta: meta(), report: r, catalog: cat, analyze: analyzeRun, published: true });
  assert.equal(res.alert, false);
  assert.equal(res.comparison.state, 'baseline');
  assert.match(renderMarkdown(res, links(meta(), { PAGES_URL: 'https://x.github.io/r/' }, true)), /first full run on this dashboard/);
});

test('a failed setup step is an alert of its own', () => {
  const r = report([
    ['fixtures/profile.setup.ts', 40, 'discover deployment profile', 'failed', 'profile-setup'],
    ['citizen/a.spec.ts', 10, 'files a complaint', 'notRun'],
  ]);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: r });
  assert.deepEqual(res.events.map(e => e.kind), ['setup-failed']);
});

test('no report.json: Playwright crashed', () => {
  const res = evaluate({ meta: meta({ playwrightExit: 134 }), report: null });
  assert.deepEqual(res.events.map(e => e.kind), ['no-report']);
  assert.match(res.events[0].detail, /exit code 134/);
});

test('global timeout: cut short', () => {
  const r = report([['a.spec.ts', 1, 'x', 'passed']], ['Timed out waiting 5400s for the test suite to run']);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: r });
  assert.deepEqual(res.events.map(e => e.kind), ['cut-short']);
});

test('a spec that fails to load: suite error', () => {
  const r = report([], ["Error: Cannot find module '../../../../digit-ui-esbuild/x.js'"]);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: r });
  assert.deepEqual(res.events.map(e => e.kind), ['suite-error']);
});

test('missing settings and an unreachable host stop the run before Playwright', () => {
  const a = evaluate({ meta: meta({ configProblems: ['IDENTITY_TEST_TENANT_SLUG (the workspace slug) is not set'], preflight: null }), report: null });
  assert.deepEqual(a.events.map(e => e.kind), ['config-missing']);
  const b = evaluate({ meta: meta({ preflight: { ok: false, httpCode: '000', error: 'Could not resolve host' } }), report: null });
  assert.deepEqual(b.events.map(e => e.kind), ['unreachable']);
  assert.match(b.events[0].detail, /HTTP 000 · Could not resolve host/);
});

test('no run-meta at all: the run job broke', () => {
  const res = evaluate({ meta: null, report: null });
  assert.deepEqual(res.events.map(e => e.kind), ['runner-error']);
});

test('full run that was not published: says so, and alerts', () => {
  const r = report([['a.spec.ts', 1, 'x', 'passed']]);
  const res = evaluate({ meta: meta(), report: r, catalog: null, analyze: analyzeRun, published: false });
  assert.deepEqual(res.events.map(e => e.kind), ['not-published']);
});

test('notify modes', () => {
  assert.equal(shouldNotify({ alert: false }, 'problems-only'), false);
  assert.equal(shouldNotify({ alert: true }, 'problems-only'), true);
  assert.equal(shouldNotify({ alert: false }, 'always'), true);
  assert.equal(shouldNotify({ alert: true }, 'never'), false);
});

test('Slack payload stays inside Block Kit limits and escapes markup', () => {
  const many = Array.from({ length: 60 }, (_, i) => [`smoke/t${i}.spec.ts`, i + 1, `<b>test ${i}</b> & more`, 'failed', 'smoke']);
  const res = evaluate({ meta: meta({ scope: 'smoke', partial: true }), report: report(many) });
  const p = slackPayload(res, { run: 'https://github.com/run/1', dashboard: '', report: '', artifact: '' });
  assert.ok(p.blocks[0].text.text.length <= 150);
  for (const b of p.blocks) if (b.text?.type === 'mrkdwn') assert.ok(b.text.text.length <= 3000);
  const body = JSON.stringify(p);
  assert.ok(!body.includes('<b>'));
  assert.match(body, /and 52 more/);
});
