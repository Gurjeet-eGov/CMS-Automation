#!/usr/bin/env node
/**
 * import-product-suite.mjs — copy the product repo's integration suite into
 * this repo, and vendor every file the suite imports from OUTSIDE its folder.
 *
 * Why the vendoring: the product suite lives at tests/integration-tests inside
 * the big product monorepo, and a spec there may import product code by a
 * relative path that climbs out of the suite (today:
 * tests/specs/pgr-geo-location-contract.spec.ts →
 * ../../../../digit-ui-esbuild/products/pgr/src/utils/geoLocation.js). In this
 * repo that path leads nowhere, and one unresolvable import makes Playwright
 * abort the WHOLE run. So each such file is copied to
 * <suite>/vendor/product/<its path in the product repo>, the import is pointed
 * at the copy, and vendor/README.md records where every file came from.
 *
 * The rewrite is mechanical and repeatable: every sync starts again from a
 * fresh product copy, so the product-suite branch always holds "product suite +
 * this same patch" and merges into master stay clean.
 *
 * Usage:
 *   node ci/import-product-suite.mjs <product-checkout> <dest-suite-dir> [--repo owner/name] [--sha <commit>] [--ref <ref>]
 *       Replace <dest-suite-dir> with the product suite, vendoring as above.
 *   node ci/import-product-suite.mjs --scan <product-checkout>
 *       Print (one per line) the product-repo paths of the outside files the
 *       suite imports, so a sparse checkout can fetch them (ci/fetch-product.sh).
 *
 * Plain Node, no npm dependencies: it runs before `npm ci`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITE_REL = 'tests/integration-tests';
export const VENDOR_REL = 'vendor/product';
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
/** Never copied from the product checkout: dependencies and run output. */
const SKIP_NAMES = new Set([
  'node_modules', '.git', 'playwright-report', 'test-results', 'report.json',
  'auth.json', 'auth-api.json', 'citizen-fixture.json', 'lifecycle-fixtures.json',
  'deployment-profile.json', 'catalog.json', 'history.json', '.git-sha', 'dist',
]);
const NOTE = 'vendored from the product repo: see vendor/README.md';

/** Every relative module specifier in a source file, with its offset. */
export function relativeSpecifiers(source) {
  const out = [];
  const re = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+)\2/g;
  let m;
  while ((m = re.exec(source))) {
    out.push({ spec: m[3], index: m.index + m[1].length + 1 });
  }
  return out;
}

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (CODE_EXT.test(ent.name)) files.push(p);
  }
  return files;
}

const toPosix = p => p.split(path.sep).join('/');

/**
 * The outside imports of the product suite: for each, the importing file
 * (suite-relative), the specifier and the target's product-repo path.
 */
export function scanOutsideImports(productRoot) {
  const suiteRoot = path.join(productRoot, SUITE_REL);
  if (!fs.existsSync(suiteRoot)) throw new Error(`no ${SUITE_REL} in ${productRoot}`);
  const found = [];
  for (const file of walk(suiteRoot)) {
    if (toPosix(path.relative(suiteRoot, file)).startsWith(`${VENDOR_REL}/`)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const { spec } of relativeSpecifiers(src)) {
      const target = path.resolve(path.dirname(file), spec);
      const inSuite = path.relative(suiteRoot, target);
      if (!inSuite.startsWith('..')) continue; // stays inside the suite: fine
      const repoPath = toPosix(path.relative(productRoot, target));
      if (repoPath.startsWith('..')) throw new Error(`${toPosix(path.relative(productRoot, file))} imports ${spec}, which is outside the product repo itself`);
      found.push({ file: toPosix(path.relative(suiteRoot, file)), spec, repoPath });
    }
  }
  return found;
}

/** Outside files plus anything they import relatively, transitively (product-repo paths). */
function vendorClosure(productRoot, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = path.join(productRoot, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`the suite needs ${rel} from the product repo, but it isn't in the checkout at ${productRoot}`
        + ' (a sparse checkout must include it: ci/fetch-product.sh adds what --scan reports)');
    }
    seen.add(rel);
    if (!CODE_EXT.test(rel)) continue;
    for (const { spec } of relativeSpecifiers(fs.readFileSync(abs, 'utf8'))) {
      const dep = toPosix(path.relative(productRoot, path.resolve(path.dirname(abs), spec)));
      if (!dep.startsWith('..') && !seen.has(dep)) queue.push(dep);
    }
  }
  return [...seen].sort();
}

function copySuite(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: src => !SKIP_NAMES.has(path.basename(src)) || src === from,
  });
}

function vendorReadme({ repo, sha, ref, entries }) {
  const rows = entries.map(e => `| \`${VENDOR_REL}/${e.repoPath}\` | \`${e.repoPath}\` | ${e.importers.map(f => `\`${f}\``).join(', ') || '(imported by another vendored file)'} |`);
  return `# vendor/ — product files this suite needs from outside its own folder

This folder is written by \`ci/import-product-suite.mjs\` (part of CMS-Automation's
"Sync product suite" workflow and \`ci/prepare-suite.sh --source product\`). **Do not edit it by hand.**

## Why it exists

In the product repo (${repo ? `\`${repo}\`` : 'the egovernments repo'}) this suite lives at \`${SUITE_REL}\`,
and some specs import product source code by a relative path that climbs out of the suite folder.
Here, that path would lead nowhere, and a single import Playwright can't resolve aborts the **whole run**.
So every such file is copied here, keeping its product-repo path, and the import is pointed at the copy.
Each rewritten import line carries the comment \`// ${NOTE}\`.

| Copy in this suite | Original path in the product repo | Imported by |
|---|---|---|
${rows.join('\n') || '| (none) | | |'}

Copied from ${repo ? `\`${repo}\`` : 'the product repo'}${ref ? ` at \`${ref}\`` : ''}${sha ? `, commit \`${sha}\`` : ''}.

## Working on it

- **To refresh it:** run the "Sync product suite" workflow. Every sync re-copies these files from the product repo
  and re-applies the same import rewrite, so they never drift from the product.
- **To change the behaviour:** fix it in the product repo, because these are the product's own source files, then sync.
  If an implementation really needs a different version, change the importing spec on that implementation's
  \`impl/<name>\` branch to import its own helper instead of editing this copy. The next sync would overwrite an edited copy.
- **When a new spec imports another file from outside the suite:** nothing to do. The next sync finds it, vendors it,
  and adds a row above. If the file can't be found, the sync stops and names it.
`;
}

/** Copy the product suite into destDir (replacing it) and vendor its outside imports. */
export function importSuite(productRoot, destDir, meta = {}) {
  const suiteRoot = path.join(productRoot, SUITE_REL);
  const outside = scanOutsideImports(productRoot);
  const closure = vendorClosure(productRoot, outside.map(o => o.repoPath));

  const dest = path.resolve(destDir);
  if (dest === path.parse(dest).root || fs.existsSync(path.join(dest, '.git'))) {
    throw new Error(`refusing to replace ${dest}: it looks like a repo root, not a suite folder`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  copySuite(suiteRoot, dest);

  // vendor/ is rebuilt from scratch, so a file the suite stopped importing goes too.
  fs.rmSync(path.join(dest, 'vendor'), { recursive: true, force: true });
  for (const rel of closure) {
    const to = path.join(dest, VENDOR_REL, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(productRoot, rel), to);
  }

  // Point each outside import at its copy; note it at the end of the line.
  const byFile = new Map();
  for (const o of outside) byFile.set(o.file, [...(byFile.get(o.file) || []), o]);
  for (const [file, imports] of byFile) {
    const abs = path.join(dest, file);
    let src = fs.readFileSync(abs, 'utf8');
    for (const { spec, repoPath } of imports) {
      let next = toPosix(path.relative(path.dirname(abs), path.join(dest, VENDOR_REL, repoPath)));
      if (!next.startsWith('.')) next = `./${next}`;
      src = src.split(spec).join(next);
      src = src.split('\n').map(line => (line.includes(next) && !line.includes(NOTE) ? `${line} // ${NOTE}` : line)).join('\n');
    }
    fs.writeFileSync(abs, src);
  }

  const entries = closure.map(repoPath => ({
    repoPath,
    importers: [...new Set(outside.filter(o => o.repoPath === repoPath).map(o => o.file))],
  }));
  if (entries.length) {
    fs.writeFileSync(path.join(dest, 'vendor', 'README.md'), vendorReadme({ ...meta, entries }));
  }
  return { vendored: closure, rewritten: [...byFile.keys()] };
}

function main(argv) {
  if (argv[0] === '--scan') {
    if (!argv[1]) throw new Error('usage: import-product-suite.mjs --scan <product-checkout>');
    const paths = [...new Set(scanOutsideImports(argv[1]).map(o => o.repoPath))];
    if (paths.length) process.stdout.write(`${paths.join('\n')}\n`);
    return;
  }
  const [productRoot, destDir, ...rest] = argv;
  if (!productRoot || !destDir) {
    throw new Error('usage: import-product-suite.mjs <product-checkout> <dest-suite-dir> [--repo owner/name] [--sha <commit>] [--ref <ref>]');
  }
  const meta = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i].replace(/^--/, '');
    if (!['repo', 'sha', 'ref'].includes(k) || rest[i + 1] === undefined) throw new Error(`unknown or incomplete option: ${rest[i]}`);
    meta[k] = rest[i + 1];
  }
  const { vendored, rewritten } = importSuite(productRoot, destDir, meta);
  console.log(`[import] product suite copied to ${destDir}`);
  for (const v of vendored) console.log(`[import] vendored ${v} → ${VENDOR_REL}/${v}`);
  for (const f of rewritten) console.log(`[import] import rewritten in ${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`[import] ERROR: ${e.message}`);
    process.exit(1);
  }
}
