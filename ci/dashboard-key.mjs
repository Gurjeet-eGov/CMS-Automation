#!/usr/bin/env node
/**
 * dashboard-key.mjs — the folder a run's dashboard is published in, on the
 * gh-pages branch: <branch>/<environment>, each part made safe for a web
 * address and a folder name.
 *
 *   node ci/dashboard-key.mjs <branch> <environment>   prints e.g. digit-3.0-naipepea/nai-pepea
 *
 * A GitHub Environment may be called "Nai Pepea"; its folder is nai-pepea. The
 * real name stays in run-meta.json, so pages and summaries still say "Nai Pepea".
 * Two names that only differ in case, spaces or punctuation share a folder.
 *
 * ci/publish-pages.sh refuses any key that doesn't match KEY_PATTERN, so a run
 * can never write outside its own folder.
 */
import { pathToFileURL } from 'node:url';

/** Lowercase letters, digits, '.', '_' and '-'; never empty, never starting or ending with '.' or '-' (so never '.' or '..'). */
export function folderName(s) {
  const out = String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/g, '');
  return out || 'x';
}

export const dashboardKey = (branch, environment) => `${folderName(branch)}/${folderName(environment)}`;

/** The same pattern as in ci/publish-pages.sh. */
export const KEY_PATTERN = /^[a-z0-9_]([a-z0-9._-]*[a-z0-9_])?\/[a-z0-9_]([a-z0-9._-]*[a-z0-9_])?$/;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [branch, environment] = process.argv.slice(2);
  if (!branch || !environment) {
    console.error('usage: dashboard-key.mjs <branch> <environment>');
    process.exit(2);
  }
  console.log(dashboardKey(branch, environment));
}
