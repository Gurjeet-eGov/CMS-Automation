// node --test ci/tests/  — ci/load-env.sh: order of settings, the secrets
// parser (values are never executed), masking, and the plain-words checks.
// Runs the real script in bash against a throwaway repo + suite layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOAD_ENV = path.resolve(here, '../load-env.sh');

function sandbox({ config = '', upstream = null, expectations = false, identity = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'));
  const env = path.join(root, 'environments', 'demo');
  const suite = path.join(root, 'suite');
  fs.mkdirSync(env, { recursive: true });
  fs.mkdirSync(path.join(suite, 'deploy', 'expectations'), { recursive: true });
  fs.mkdirSync(path.join(suite, 'tests', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(env, 'config.env'), config);
  if (upstream) fs.writeFileSync(path.join(suite, 'deploy', 'demo.env'), upstream);
  if (expectations) fs.writeFileSync(path.join(env, 'expectations.json'), '{"name":"demo"}');
  fs.writeFileSync(path.join(suite, 'deploy', 'expectations', 'default.json'), '{}');
  if (identity) fs.writeFileSync(path.join(suite, 'tests', 'utils', 'identity-bff.ts'), 'process.env.IDENTITY_TEST_TENANT_SLUG');
  return { root, suite };
}

/** Source load-env.sh for `demo` and print the given variables as JSON. */
function load(box, extraEnv = {}, vars = []) {
  const script = `source "$LOAD_ENV" demo >/dev/null 2>"$ROOT/stderr"; rc=$?
node -e 'const o={rc:Number(process.argv[1]),problems:process.env.CONFIG_PROBLEMS_X.split("\\n").filter(Boolean),keys:process.env.SECRET_KEYS_X.trim().split(/\\s+/).filter(Boolean),vars:{}};for(const v of process.argv.slice(2))o.vars[v]=process.env[v]??null;console.log(JSON.stringify(o))' "$rc" ${vars.join(' ')}`;
  const r = spawnSync('bash', ['-c', `${script.replace('node -e', 'CONFIG_PROBLEMS_X="$CONFIG_PROBLEMS" SECRET_KEYS_X="$SECRET_KEYS" node -e')}`], {
    cwd: box.suite, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CI_ROOT: box.root, LOAD_ENV, ROOT: box.root, ...extraEnv },
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  return { ...JSON.parse(lines[lines.length - 1]), stdout: r.stdout };
}

const GOOD = 'BASE_URL=https://demo.test\nDIGIT_TENANT=dm\nIDENTITY_TEST_TENANT_SLUG=dm1\n';

test('upstream profile, then config.env, then run inputs: later wins', () => {
  const box = sandbox({
    upstream: 'export BASE_URL=https://upstream.test\nexport DIGIT_TENANT=up   # comment\nexport GRO_USER=up-gro\n',
    config: 'UPSTREAM_ENV=deploy/demo.env\nGRO_USER=cfg-gro\nIDENTITY_TEST_TENANT_SLUG=cfg\n',
  });
  const r = load(box, { INPUT_BASE_URL: 'https://input.test/' }, ['BASE_URL', 'DIGIT_TENANT', 'GRO_USER', 'IDENTITY_TEST_TENANT_SLUG']);
  assert.equal(r.rc, 0, r.problems.join('; '));
  assert.deepEqual(r.vars, { BASE_URL: 'https://input.test', DIGIT_TENANT: 'up', GRO_USER: 'cfg-gro', IDENTITY_TEST_TENANT_SLUG: 'cfg' });
});

test('secrets are literal: $, quotes, backticks and = survive; nothing is executed', () => {
  const box = sandbox({ config: GOOD });
  const marker = path.join(box.root, 'pwned');
  const secrets = [
    '# a comment',
    '',
    `ADMIN_PASSWORD=p$HOME"x\`touch ${marker}\`=y$(touch ${marker})`,
    "  export GRO_PASSWORD = '  keep my spaces '  ",
    'IDENTITY_TEST_OTP_CODE=123456\r',
  ].join('\n');
  const r = load(box, { ENV_SECRETS: secrets }, ['ADMIN_PASSWORD', 'GRO_PASSWORD', 'IDENTITY_TEST_OTP_CODE']);
  assert.equal(r.rc, 0, r.problems.join('; '));
  assert.equal(r.vars.ADMIN_PASSWORD, `p$HOME"x\`touch ${marker}\`=y$(touch ${marker})`);
  assert.equal(r.vars.GRO_PASSWORD, '  keep my spaces ');
  assert.equal(r.vars.IDENTITY_TEST_OTP_CODE, '123456');
  assert.deepEqual(r.keys, ['ADMIN_PASSWORD', 'GRO_PASSWORD', 'IDENTITY_TEST_OTP_CODE']);
  assert.equal(fs.existsSync(marker), false, 'a secret value was executed');
});

test('in GitHub Actions every secret value is masked', () => {
  const box = sandbox({ config: GOOD });
  const script = `source "${LOAD_ENV}" demo`;
  const r = spawnSync('bash', ['-c', script], {
    cwd: box.suite, encoding: 'utf8',
    env: { PATH: process.env.PATH, CI_ROOT: box.root, GITHUB_ACTIONS: 'true', ENV_SECRETS: 'A=one\nB=two words\nC=' },
  });
  assert.match(r.stdout, /^::add-mask::one$/m);
  assert.match(r.stdout, /^::add-mask::two words$/m);
  assert.doesNotMatch(r.stdout, /^::add-mask::$/m, 'empty values are not masked');
});

test('a malformed secrets line is reported without its content', () => {
  const box = sandbox({ config: GOOD });
  const r = load(box, { ENV_SECRETS: 'OK=1\nthis is my-password\n' });
  assert.equal(r.rc, 1);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /line 2 of the SECRETS_DEMO secret is not KEY=value/);
  assert.doesNotMatch(r.problems[0], /my-password/);
});

test('local runs read environments/<env>/secrets.env when no secret is passed', () => {
  const box = sandbox({ config: GOOD });
  fs.writeFileSync(path.join(box.root, 'environments', 'demo', 'secrets.env'), 'ADMIN_PASSWORD=from-file\n');
  const r = load(box, {}, ['ADMIN_PASSWORD']);
  assert.equal(r.vars.ADMIN_PASSWORD, 'from-file');
});

test('missing slug, tenant and URL are each named in plain words', () => {
  const box = sandbox({ config: 'IDENTITY_TEST_TENANT_SLUG=\n' });
  const r = load(box);
  assert.equal(r.rc, 1);
  assert.equal(r.problems.length, 3);
  assert.match(r.problems.join('\n'), /BASE_URL is not set/);
  assert.match(r.problems.join('\n'), /DIGIT_TENANT is not set/);
  assert.match(r.problems.join('\n'), /workspace slug\) is not set/);
});

test('the slug is only required by suites that use the Identity BFF sign-in', () => {
  const box = sandbox({ config: 'BASE_URL=https://old.test\nDIGIT_TENANT=ke\n', identity: false });
  assert.equal(load(box).rc, 0);
});

test('an expectations.json kept with the environment becomes EXPECTATIONS_FILE', () => {
  const box = sandbox({ config: GOOD, expectations: true });
  const r = load(box, {}, ['EXPECTATIONS_FILE']);
  assert.equal(r.vars.EXPECTATIONS_FILE, 'deploy/expectations/ci-demo.json');
  assert.ok(fs.existsSync(path.join(box.suite, 'deploy', 'expectations', 'ci-demo.json')));
});

test('a digit_tenant input drops the configured root/city tenant', () => {
  const box = sandbox({ config: `${GOOD}ROOT_TENANT=dm\nCITY_TENANT=dm\n` });
  const r = load(box, { INPUT_DIGIT_TENANT: 'mz.maputo' }, ['DIGIT_TENANT', 'ROOT_TENANT', 'CITY_TENANT']);
  assert.deepEqual(r.vars, { DIGIT_TENANT: 'mz.maputo', ROOT_TENANT: null, CITY_TENANT: null });
});

test('environment names must work as secret names', () => {
  const box = sandbox({ config: GOOD });
  const r = spawnSync('bash', ['-c', `source "${LOAD_ENV}" Bad-Name; echo "rc=$?"`], {
    cwd: box.suite, encoding: 'utf8', env: { PATH: process.env.PATH, CI_ROOT: box.root },
  });
  assert.match(r.stdout, /rc=1/);
});

// ── GitHub: the chosen environment's CONFIG_ENV and SECRETS_ENV, each a whole pasted file ──

/** Source load-env.sh for `name` with a bare environment and return stdout and the exit code. */
function raw(box, name, env) {
  const r = spawnSync('bash', ['-c', `source "${LOAD_ENV}" "$1"; echo "rc=$? problems=[$CONFIG_PROBLEMS] keys=[$SECRET_KEYS] base=[$BASE_URL]"`, '_', name], {
    cwd: box.suite, encoding: 'utf8', env: { PATH: process.env.PATH, CI_ROOT: box.root, ...env },
  });
  return r.stdout;
}

test('a pasted CONFIG_ENV wins over the config.env in the repo', () => {
  const box = sandbox({ config: 'BASE_URL=https://from-repo.test\nDIGIT_TENANT=repo\nIDENTITY_TEST_TENANT_SLUG=repo\n' });
  const r = load(box, { ENV_CONFIG: GOOD, ENV_SECRETS: 'ADMIN_PASSWORD=x' }, ['BASE_URL', 'DIGIT_TENANT', 'IDENTITY_TEST_TENANT_SLUG']);
  assert.equal(r.rc, 0, r.problems.join('; '));
  assert.deepEqual(r.vars, { BASE_URL: 'https://demo.test', DIGIT_TENANT: 'dm', IDENTITY_TEST_TENANT_SLUG: 'dm1' });
  assert.deepEqual(r.keys, ['ADMIN_PASSWORD'], 'config keys are not listed as secrets');
});

test('a pasted CONFIG_ENV is read, never run; config values are not masked', () => {
  const box = sandbox();
  const marker = path.join(box.root, 'pwned');
  const out = raw(box, 'demo', {
    GITHUB_ACTIONS: 'true',
    ENV_CONFIG: `${GOOD}NOTE=$(touch ${marker})\`touch ${marker}\`\r\n`,
    ENV_SECRETS: 'ADMIN_PASSWORD=s3cret',
  });
  assert.match(out, /rc=0 /, out);
  assert.equal(fs.existsSync(marker), false, 'a config line was executed');
  assert.match(out, /^::add-mask::s3cret$/m);
  assert.doesNotMatch(out, /::add-mask::https:\/\/demo\.test/, 'the address stays readable');
});

test('UPSTREAM_ENV works from a pasted CONFIG_ENV, but only inside the suite', () => {
  const box = sandbox({ upstream: 'export BASE_URL=https://upstream.test\nexport DIGIT_TENANT=up\n' });
  const r = load(box, { ENV_CONFIG: 'UPSTREAM_ENV=deploy/demo.env\nIDENTITY_TEST_TENANT_SLUG=s1\n', ENV_SECRETS: 'A=1' }, ['BASE_URL', 'DIGIT_TENANT']);
  assert.equal(r.rc, 0, r.problems.join('; '));
  assert.deepEqual(r.vars, { BASE_URL: 'https://upstream.test', DIGIT_TENANT: 'up' });
  const outside = load(box, { ENV_CONFIG: `UPSTREAM_ENV=../../etc/hosts\n${GOOD}`, ENV_SECRETS: 'A=1' });
  assert.equal(outside.rc, 1);
  assert.match(outside.problems.join('\n'), /names UPSTREAM_ENV=\.\.\/\.\.\/etc\/hosts, but this suite has no such file/);
});

test('on GitHub, a missing SECRETS_ENV or CONFIG_ENV is named plainly', () => {
  const box = sandbox();
  fs.rmSync(path.join(box.root, 'environments', 'demo', 'config.env'));
  const noSecrets = raw(box, 'demo', { GITHUB_ACTIONS: 'true', ENV_CONFIG: GOOD });
  assert.match(noSecrets, /SECRETS_ENV is missing in the demo environment's secrets/);
  const noConfig = raw(box, 'demo', { GITHUB_ACTIONS: 'true', ENV_SECRETS: 'A=1' });
  assert.match(noConfig, /rc=1 problems=\[CONFIG_ENV is missing in the demo environment's secrets/);
});

test('a malformed CONFIG_ENV line names the CONFIG_ENV secret', () => {
  const box = sandbox();
  const r = load(box, { ENV_CONFIG: `${GOOD}just some words\n`, ENV_CONFIG_NAME: 'the CONFIG_ENV secret of the demo environment', ENV_SECRETS: 'A=1' });
  assert.equal(r.rc, 1);
  assert.match(r.problems[0], /line 4 of the CONFIG_ENV secret of the demo environment is not KEY=value/);
});

test('GitHub Environment names may use capitals and -, but never reach another folder', () => {
  const box = sandbox();
  assert.match(raw(box, 'Net-Two', { ENV_CONFIG: GOOD, ENV_SECRETS: 'A=1' }), /rc=0 /);
  assert.match(raw(box, '../demo', { ENV_CONFIG: GOOD, ENV_SECRETS: 'A=1' }), /rc=1 problems=\[environment name '..\/demo' must be letters, digits, - or _/);
});
