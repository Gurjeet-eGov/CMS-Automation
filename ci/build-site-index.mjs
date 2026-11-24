#!/usr/bin/env node
/**
 * build-site-index.mjs — write <site>/dashboards.json: one entry per dashboard
 * (<branch>/<environment>/catalog.json) with its newest run, for the landing
 * page (ci/site-index.html). Folder names are made safe (ci/dashboard-key.mjs);
 * the real names ("Nai Pepea") come from the dashboard's about.json.
 *
 * Usage: node ci/build-site-index.mjs <site-dir>
 */
import fs from 'node:fs';
import path from 'node:path';

const site = process.argv[2];
if (!site) {
  console.error('usage: build-site-index.mjs <site-dir>');
  process.exit(2);
}

const dirs = d => fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

const dashboards = [];
for (const source of dirs(site)) {
  for (const environment of dirs(path.join(site, source))) {
    const file = path.join(site, source, environment, 'catalog.json');
    if (!fs.existsSync(file)) continue;
    let catalog;
    try { catalog = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const runs = Array.isArray(catalog.runs) ? catalog.runs : [];
    const last = runs[0] || null;
    let about = {};
    try { about = JSON.parse(fs.readFileSync(path.join(site, source, environment, 'about.json'), 'utf8')) || {}; } catch { about = {}; }
    const name = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
    dashboards.push({
      key: `${source}/${environment}`,
      source: name(about.branch, source),
      environment: name(about.environment, environment),
      url: `${source}/${environment}/`,
      runs: runs.length,
      lastRun: last && pick(last, ['id', 'startedAt', 'passed', 'failed', 'timedOut', 'skipped', 'notRun', 'total', 'cutShort', 'hasReport', 'branch', 'sha', 'baseUrl']),
    });
  }
}
dashboards.sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(path.join(site, 'dashboards.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), dashboards }, null, 2)}\n`);
console.log(`[site-index] ${dashboards.length} dashboard(s): ${dashboards.map(d => d.key).join(', ')}`);
