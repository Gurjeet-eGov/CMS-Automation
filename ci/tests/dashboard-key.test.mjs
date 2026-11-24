// The dashboard's folder on gh-pages (ci/dashboard-key.mjs), the check
// ci/publish-pages.sh makes before writing there, and the real names the
// landing page shows (ci/build-site-index.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { folderName, dashboardKey, KEY_PATTERN } from '../dashboard-key.mjs';

const CI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a GitHub Environment name becomes a plain folder name', () => {
  assert.equal(folderName('Nai Pepea'), 'nai-pepea');
  assert.equal(folderName('naipepea'), 'naipepea');
  assert.equal(folderName('net_two'), 'net_two');
  assert.equal(folderName('Café  Ünïcode 🎉'), 'cafe-unicode');
  assert.equal(dashboardKey('digit-3.0-naipepea', 'Nai Pepea'), 'digit-3.0-naipepea/nai-pepea');
  assert.equal(dashboardKey('feature/x', 'Bomet'), 'feature-x/bomet');
});

test('odd names never become a folder outside the dashboard', () => {
  for (const s of ['..', '.', '.hidden', '-x-', '../../etc', 'a/b', '', '   ', '🎉', 'x'.repeat(200)]) {
    const f = folderName(s);
    assert.match(f, /^[a-z0-9_]([a-z0-9._-]*[a-z0-9_])?$/, `${JSON.stringify(s)} → ${f}`);
    assert.ok(!f.includes('/') && f !== '.' && f !== '..' && f.length <= 60, `${JSON.stringify(s)} → ${f}`);
    assert.match(dashboardKey('master', s), KEY_PATTERN);
  }
});

test('the command line prints the key', () => {
  const out = execFileSync('node', [path.join(CI, 'dashboard-key.mjs'), 'digit-3.0-naipepea', 'Nai Pepea'], { encoding: 'utf8' });
  assert.equal(out.trim(), 'digit-3.0-naipepea/nai-pepea');
  assert.notEqual(spawnSync('node', [path.join(CI, 'dashboard-key.mjs')]).status, 0, 'no arguments: usage, non-zero exit');
});

test('publish-pages.sh accepts exactly the keys dashboard-key.mjs makes', () => {
  const src = fs.readFileSync(path.join(CI, 'publish-pages.sh'), 'utf8');
  const re = src.match(/^KEY_RE='([^']+)'$/m)?.[1];
  assert.ok(re, 'publish-pages.sh defines KEY_RE');
  assert.equal(re, KEY_PATTERN.source.replace(/\\\//g, '/'), 'the same pattern in both places');
  const bashAccepts = key => spawnSync('bash', ['-c', `re='${re}'; [[ "$1" =~ $re ]]`, '_', key]).status === 0;
  for (const ok of ['digit-3.0-naipepea/nai-pepea', 'master/naipepea', 'master/net_two', 'a/b']) assert.ok(bashAccepts(ok), ok);
  for (const bad of ['digit-3.0-naipepea/Nai Pepea', 'master/..', '../x', 'master/.x', 'master', 'a/b/c', 'master/x-', '/x', 'x/']) {
    assert.ok(!bashAccepts(bad), bad);
    assert.doesNotMatch(bad, KEY_PATTERN);
  }
});

test('the landing page lists the real names from about.json', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  try {
    const dash = path.join(site, 'digit-3.0-naipepea', 'nai-pepea');
    fs.mkdirSync(dash, { recursive: true });
    fs.writeFileSync(path.join(dash, 'catalog.json'), JSON.stringify({ runs: [{ id: 'r1', passed: 3, failed: 0 }] }));
    fs.writeFileSync(path.join(dash, 'about.json'), JSON.stringify({ environment: 'Nai Pepea', branch: 'digit-3.0-naipepea' }));
    const old = path.join(site, 'master', 'naipepea'); // published before about.json existed
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'catalog.json'), JSON.stringify({ runs: [] }));
    execFileSync('node', [path.join(CI, 'build-site-index.mjs'), site], { stdio: 'ignore' });
    const { dashboards } = JSON.parse(fs.readFileSync(path.join(site, 'dashboards.json'), 'utf8'));
    const byKey = Object.fromEntries(dashboards.map(d => [d.key, d]));
    assert.equal(byKey['digit-3.0-naipepea/nai-pepea'].environment, 'Nai Pepea');
    assert.equal(byKey['digit-3.0-naipepea/nai-pepea'].url, 'digit-3.0-naipepea/nai-pepea/');
    assert.equal(byKey['master/naipepea'].environment, 'naipepea', 'no about.json: the folder name');
  } finally { fs.rmSync(site, { recursive: true, force: true }); }
});
