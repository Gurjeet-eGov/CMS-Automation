#!/usr/bin/env node
/**
 * summarize.mjs — turn one run's results into a verdict, a readable summary and
 * a Slack message.
 *
 *   node ci/summarize.mjs --out .work/out [--catalog <dashboard>/catalog.json]
 *                         [--suite .work/suite] [--published] [--notify problems-only|always|never]
 *
 * Inputs
 *   <out>/run-meta.json   written by ci/run-suite.sh (missing = the run job broke)
 *   <out>/report.json     Playwright's JSON report (missing = Playwright crashed or never ran)
 *   --catalog             the dashboard's catalog.json after this run was published
 *                         (full runs only): this is the run history the comparison uses
 *   --suite               the prepared suite, for scripts/regression-alert.mjs, whose
 *                         analyzeRun() decides regressed / now skipped / stopped / fixed,
 *                         exactly as the mails from the deployment box do
 *   env RUN_URL, ARTIFACT_URL, PAGES_URL  links shown in the summary and in Slack
 *
 * Outputs
 *   $GITHUB_STEP_SUMMARY (or stdout)  the run summary, in Markdown
 *   .work/slack-payload.json          a Slack incoming-webhook message
 *   $GITHUB_OUTPUT                    alert=true|false, notify=true|false, headline=…
 *
 * "Unusual" (alert=true, the job goes red, Slack is told) means any of:
 *   config-missing  the run couldn't start: a required setting is missing
 *   unreachable     the deployment didn't answer
 *   runner-error    the run job broke before it could record anything
 *   no-report       Playwright produced no report (crashed, or the job was cancelled)
 *   suite-error     Playwright couldn't load the suite (e.g. a spec failed to import)
 *   setup-failed    a setup step failed, so the tests depending on it never ran
 *   cut-short       the run hit its global timeout or the max-failures limit
 *   regressed       full runs: passed the last time it ran, failing now
 *   now-skipped     full runs: passed before, skipped now
 *   stopped-running full runs: passed in the previous run, no result now
 *   failures        partial runs (smoke, a folder, a grep): any failing test
 * Tests that were already failing in the previous full run are listed, but don't
 * alert again: the suite has deliberate reds that would otherwise page every run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const FAILED = new Set(['failed', 'timedOut']);
/** build-catalog.ts's cutShortOf() patterns: the run stopped before finishing. */
const CUT_SHORT = [
  /^Timed out waiting [\d.]+s for the .+ to run/,
  /^Testing stopped early after \d+ maximum allowed failures/,
];
const MAX_LIST = 25;

const firstLine = msg => String(msg || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').find(l => l.trim())?.trim().slice(0, 220) ?? '';

/** Every test in a Playwright JSON report, with its final outcome. */
export function outcomes(report) {
  const out = [];
  const rootBase = report?.config?.rootDir ? path.basename(report.config.rootDir) : '';
  const walk = (suite, titles) => {
    const here = suite.title && !suite.file?.endsWith(suite.title) ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1];
        const status = last ? last.status : 'notRun';
        const file = rootBase ? `${rootBase}/${spec.file}` : spec.file;
        out.push({
          file,
          line: spec.line,
          title: [...here, spec.title].join(' › '),
          project: t.projectName || '',
          status,
          setup: /\.setup\.[cm]?[jt]s$/.test(spec.file || ''),
          flaky: t.status === 'flaky',
          error: firstLine(last?.error?.message || last?.errors?.[0]?.message),
          durationMs: results.reduce((s, r) => s + (r.duration || 0), 0),
        });
      }
    }
    for (const child of suite.suites || []) walk(child, here);
  };
  for (const s of report?.suites || []) walk(s, []);
  return out;
}

export function tally(list) {
  const c = { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0, notRun: 0, flaky: 0, total: list.length };
  for (const t of list) {
    if (t.status in c) c[t.status] += 1;
    if (t.flaky) c.flaky += 1;
  }
  return c;
}

const runErrors = report => (report?.errors || []).map(e => firstLine(e.message)).filter(Boolean);

/**
 * The verdict for one run.
 *   meta      run-meta.json (or null)
 *   report    report.json (or null)
 *   catalog   the dashboard catalog including this run (full runs; or null)
 *   analyze   regression-alert.mjs's analyzeRun (or null when unavailable)
 */
export function evaluate({ meta, report, catalog = null, analyze = null, published = false }) {
  const events = [];
  const add = (kind, title, items = [], detail = '') => events.push({ kind, title, items, detail });
  const tests = report ? outcomes(report) : [];
  const counts = tally(tests);
  const failing = tests.filter(t => FAILED.has(t.status) && !t.setup);
  let comparison = null;

  if (!meta) {
    add('runner-error', 'The test job broke before it could record anything', [], 'Open the "Run tests" job log on the run page.');
  } else if (meta.configProblems?.length) {
    add('config-missing', 'The run could not start: a setting is missing', meta.configProblems.map(p => ({ text: p })));
  } else if (meta.preflight && !meta.preflight.ok) {
    add('unreachable', `${meta.target?.baseUrl || 'The deployment'} did not answer`, [],
      `HTTP ${meta.preflight.httpCode}${meta.preflight.error ? ` · ${meta.preflight.error}` : ''}`);
  } else if (!report) {
    add('no-report', 'Playwright produced no report', [],
      `It crashed, or the job was cancelled or timed out${meta.playwrightExit != null ? ` (exit code ${meta.playwrightExit})` : ''}.`);
  } else {
    const errs = runErrors(report);
    const cut = errs.find(m => CUT_SHORT.some(re => re.test(m)));
    const ran = tests.filter(t => t.status !== 'notRun' && t.status !== 'skipped').length;
    if (cut) add('cut-short', 'The run stopped before it finished', [], cut);
    else if (errs.length && ran === 0) add('suite-error', 'Playwright could not load the suite', [], errs[0]);

    const setupFails = tests.filter(t => t.setup && FAILED.has(t.status));
    if (setupFails.length) {
      add('setup-failed', 'A setup step failed, so the tests that depend on it did not run',
        setupFails.map(t => ({ text: `${t.file}:${t.line} — ${t.title}`, error: t.error })));
    }

    if (meta.partial) {
      if (failing.length) {
        add('failures', `${failing.length} failing test${failing.length === 1 ? '' : 's'}`,
          failing.map(t => ({ text: `${t.file}:${t.line} — ${t.title}`, error: t.error })));
      }
    } else {
      const runs = catalog?.runs || [];
      const i = runs.findIndex(r => r.id === meta.runId);
      if (i === -1) {
        comparison = { state: published ? 'missing' : 'not-published' };
        if (!published) {
          add('not-published', 'The dashboard was not updated, so this run could not be compared with the previous one', [],
            'See the "Publish to GitHub Pages" step.');
        }
      } else if (!runs[i + 1]) {
        comparison = { state: 'baseline' };
      } else if (!analyze) {
        comparison = { state: 'unavailable', prev: runs[i + 1].id };
      } else {
        const a = analyze(catalog, runs[i], runs[i + 1]);
        comparison = { state: 'compared', prev: runs[i + 1].id, fixed: a.fixed };
        const item = t => ({ text: `${t.file}:${t.line} — ${t.title}`, error: t.error,
          note: t.flaky ? `flaky: failed ${t.flaky.fails} of the last ${t.flaky.of} runs` : (t.since ? `last passed in ${t.since}` : '') });
        if (a.regressed.length) add('regressed', 'Regressed: passed before, failing now', a.regressed.map(item));
        if (a.nowSkipped.length) add('now-skipped', 'Now skipped: passed before, skipped now', a.nowSkipped.map(item));
        if (a.stopped.length) add('stopped-running', 'Stopped running: passed in the previous run, no result now', a.stopped.map(item));
      }
    }
  }

  const label = meta ? `${meta.environment} · ${meta.scope}${meta.grep ? ` (${meta.grep})` : ''}` : 'integration tests';
  let headline;
  if (events.length) {
    const counted = { regressed: 'regressed', 'now-skipped': 'now skipped', 'stopped-running': 'stopped running', failures: 'failing' };
    headline = `${label}: ${events.map(e => (counted[e.kind] ? `${e.items.length} ${counted[e.kind]}` : e.kind.replace('-', ' '))).join(', ')}`;
  } else if (report) {
    headline = `${label}: no new problems — ${counts.passed} passed, ${counts.failed + counts.timedOut} failed, ${counts.skipped} skipped`;
  } else {
    headline = `${label}: nothing to report`;
  }
  return { meta, counts, failing, events, comparison, alert: events.length > 0, headline };
}

function duration(meta) {
  if (!meta?.startedAt || !meta?.finishedAt) return '';
  const min = Math.round((Date.parse(meta.finishedAt) - Date.parse(meta.startedAt)) / 60000);
  return Number.isFinite(min) ? `${min} min` : '';
}

/** Links for this run; empty strings when unknown. */
export function links(meta, env = process.env, published = false) {
  let pages = (env.PAGES_URL || '').replace(/\/?$/, '/');
  try { pages = new URL(pages).href; } catch { /* keep as given */ } // lower-cases the host (Gurjeet-eGov.github.io → gurjeet-egov.github.io)
  const dashboard = env.PAGES_URL && meta?.dashboardKey ? `${pages}${meta.dashboardKey}/` : '';
  return {
    run: env.RUN_URL || '',
    artifact: env.ARTIFACT_URL || '',
    dashboard,
    report: dashboard && published ? `${dashboard}runs/${meta.runId}/playwright-report/` : '',
  };
}

const esc = s => String(s).replace(/\|/g, '\\|');

export function renderMarkdown(result, l) {
  const { meta, counts, events, failing, comparison } = result;
  const out = [];
  out.push(`## ${result.alert ? '❌' : '✅'} ${esc(result.headline)}`, '');
  if (meta) {
    const src = meta.source || {};
    out.push('| | |', '|---|---|');
    out.push(`| Environment | **${meta.environment}** — ${meta.target?.baseUrl || '?'} (tenant \`${meta.target?.tenant || '?'}\`, workspace \`${meta.target?.workspaceSlug || '?'}\`) |`);
    out.push(`| Suite | ${src.kind === 'product' ? `product repo \`${src.repo}\` @ \`${src.ref}\`` : `this repo, branch \`${src.branch}\``} — commit \`${(src.sha || '').slice(0, 9)}\` |`);
    out.push(`| Scope | ${meta.scope}${meta.grep ? ` · grep \`${esc(meta.grep)}\`` : ''}${meta.partial ? ' (partial run: not added to the dashboard history)' : ''} |`);
    out.push(`| Run id | \`${meta.runId}\` ${duration(meta) ? `· ${duration(meta)}` : ''} |`);
    if (counts.total) {
      out.push(`| Result | ${counts.passed} passed · ${counts.failed + counts.timedOut} failed · ${counts.skipped} skipped${counts.notRun ? ` · ${counts.notRun} did not run` : ''}${counts.interrupted ? ` · ${counts.interrupted} interrupted` : ''}${counts.flaky ? ` · ${counts.flaky} flaky` : ''} — ${counts.total} total |`);
    }
    const rec = on => (on ? 'on (failures)' : 'off');
    out.push(`| Recording | screenshots ${rec(meta.recording?.screenshots)} · video ${rec(meta.recording?.video)} · traces ${rec(meta.recording?.traces)} |`);
    if (meta.secretKeys) out.push(`| Secrets used | ${meta.secretKeys.length ? meta.secretKeys.map(k => `\`${k}\``).join(' ') : 'none'} |`);
    out.push('');
  }

  const list = (items, max = MAX_LIST) => {
    for (const it of items.slice(0, max)) {
      out.push(`- ${it.text.includes('—') ? `\`${esc(it.text.split(' — ')[0])}\` — ${esc(it.text.split(' — ').slice(1).join(' — '))}` : esc(it.text)}${it.note ? ` _(${esc(it.note)})_` : ''}`);
      if (it.error) out.push(`  <br><sub>${esc(it.error).replace(/</g, '&lt;')}</sub>`);
    }
    if (items.length > max) out.push(`- … and ${items.length - max} more (see the report)`);
  };

  if (events.length) {
    out.push('### Unusual events', '');
    for (const e of events) {
      out.push(`#### ${e.title}${e.items.length > 1 ? ` (${e.items.length})` : ''}`);
      if (e.detail) out.push('', esc(e.detail));
      if (e.items.length) { out.push(''); list(e.items); }
      out.push('');
    }
  }

  if (comparison?.state === 'compared' && comparison.fixed?.length) {
    out.push(`### Fixed since ${comparison.prev} (${comparison.fixed.length})`, '');
    list(comparison.fixed.map(t => ({ text: `${t.file}:${t.line} — ${t.title}` })));
    out.push('');
  }
  if (meta && !meta.partial && failing.length) {
    const known = comparison?.state === 'compared' ? ' — any not listed above were already failing in the previous run, so they raise no alert' : '';
    const note = comparison?.state === 'baseline' ? ' — first full run on this dashboard: the next run is compared with this one' : '';
    out.push(`<details><summary>All failing tests (${failing.length})${known}${note}</summary>`, '');
    list(failing.map(t => ({ text: `${t.file}:${t.line} — ${t.title}`, error: t.error })), 200);
    out.push('', '</details>', '');
  }

  const linkLines = [];
  if (l.dashboard) linkLines.push(`- Dashboard: ${l.dashboard}${meta?.partial ? ' (full runs only)' : ''}`);
  if (l.report) linkLines.push(`- This run's Playwright report: ${l.report}`);
  if (l.artifact) linkLines.push(`- Download this run's results (HTML report and report.json): ${l.artifact} — open with \`npx playwright show-report playwright-report\``);
  if (linkLines.length) out.push('### Links', '', ...linkLines, '');
  if (l.dashboard && comparison?.state === 'baseline') {
    out.push('> First published run for this dashboard. If the dashboard link shows a 404, switch GitHub Pages on (docs/GUIDE.md §2, step 6).', '');
  }
  return `${out.join('\n')}\n`;
}

/** Slack incoming-webhook payload (Block Kit, with a plain-text fallback). */
export function slackPayload(result, l) {
  const { meta, counts, events } = result;
  const slackEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${result.alert ? '⚠️' : '✅'} CCRS tests — ${result.headline}`.slice(0, 150) } },
  ];
  if (meta) {
    const src = meta.source || {};
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Environment*\n${slackEsc(meta.environment)} — ${slackEsc(meta.target?.baseUrl || '?')}` },
        { type: 'mrkdwn', text: `*Suite*\n${slackEsc(src.kind === 'product' ? `product @ ${src.ref}` : src.branch || '?')} (${slackEsc((src.sha || '').slice(0, 9))})` },
        { type: 'mrkdwn', text: `*Scope*\n${slackEsc(meta.scope)}${meta.grep ? ` · ${slackEsc(meta.grep)}` : ''}` },
        { type: 'mrkdwn', text: `*Result*\n${counts.total ? `${counts.passed} passed · ${counts.failed + counts.timedOut} failed · ${counts.skipped} skipped` : 'no results'}` },
      ],
    });
  }
  for (const e of events.slice(0, 6)) {
    let text = `*${slackEsc(e.title)}*`;
    if (e.detail) text += `\n${slackEsc(e.detail)}`;
    for (const it of e.items.slice(0, 8)) text += `\n• ${slackEsc(it.text)}${it.error ? `\n    _${slackEsc(it.error.slice(0, 160))}_` : ''}`;
    if (e.items.length > 8) text += `\n… and ${e.items.length - 8} more`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } });
  }
  const linkText = [
    l.run && `<${l.run}|Run summary>`,
    l.report && `<${l.report}|Playwright report>`,
    l.dashboard && `<${l.dashboard}|Dashboard>`,
  ].filter(Boolean).join('  ·  ');
  if (linkText) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: linkText }] });
  return { text: `CCRS tests — ${result.headline}`, blocks };
}

export function shouldNotify(result, mode = 'problems-only') {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return result.alert;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const o = { out: '.work/out', catalog: null, suite: '.work/suite', published: false, notify: 'problems-only' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--catalog') o.catalog = argv[++i];
    else if (a === '--suite') o.suite = argv[++i];
    else if (a === '--published') o.published = true;
    else if (a === '--notify') o.notify = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!['problems-only', 'always', 'never'].includes(o.notify)) o.notify = 'problems-only';
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const meta = readJson(path.join(opts.out, 'run-meta.json'));
  const report = readJson(path.join(opts.out, 'report.json'));
  const catalog = opts.catalog ? readJson(opts.catalog) : null;
  let analyze = null;
  const alertModule = path.resolve(opts.suite, 'scripts/regression-alert.mjs');
  if (fs.existsSync(alertModule)) {
    try { ({ analyzeRun: analyze } = await import(pathToFileURL(alertModule).href)); } catch (e) {
      console.warn(`[summarize] could not load ${alertModule}: ${e.message}`);
    }
  }
  const result = evaluate({ meta, report, catalog, analyze, published: opts.published });
  const l = links(meta, process.env, opts.published);
  const md = renderMarkdown(result, l);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  else process.stdout.write(md);

  const payloadPath = path.resolve(opts.out, '..', 'slack-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(slackPayload(result, l), null, 2));
  const notify = shouldNotify(result, opts.notify);
  if (process.env.GITHUB_OUTPUT) {
    const headline = result.headline.replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `alert=${result.alert}\nnotify=${notify}\nheadline=${headline}\n`);
  }
  console.error(`[summarize] ${result.headline} (alert=${result.alert}, notify=${notify})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`[summarize] ERROR: ${e.stack || e.message}`); process.exit(1); });
}
