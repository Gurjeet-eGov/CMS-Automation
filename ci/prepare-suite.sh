#!/usr/bin/env bash
# prepare-suite.sh — put the suite a run will use at .work/suite.
#
# Usage: ci/prepare-suite.sh
#
# The suite is tests/integration-tests on whatever branch is checked out
# (master, digit-3.0-naipepea, …). `--source this-branch` is still accepted,
# for callers that pass it, and changes nothing.
#
# Also copies ci/playwright.ci.config.ts into the suite and writes
# .work/suite-source.json (what was prepared, for run-meta.json).
#
# The suite is COPIED rather than run in place so that a run never writes
# reports, tokens or node_modules into the repo's own tests/ folder. node_modules
# survives between local runs, so ci/run-local.sh doesn't reinstall every time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ "${2:-}" == "this-branch" ]] || { echo "[prepare] --source can only be this-branch (the suite on this branch), got: ${2:-}" >&2; exit 2; }
      shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "[prepare] unknown argument: $1" >&2; exit 2 ;;
  esac
done

WORK="$ROOT/.work"
SUITE="$WORK/suite"
mkdir -p "$WORK"

# Run output and token files must never be carried over from a previous run or
# copied in from a suite folder someone ran tests in.
OUTPUTS=(playwright-report test-results report.json results.xml auth.json auth-api.json citizen-fixture.json
  lifecycle-fixtures.json deployment-profile.json catalog.json history.json .git-sha)
rsync_suite() { # <from-dir>
  local excludes=(--exclude 'node_modules/')
  local o
  for o in "${OUTPUTS[@]}"; do excludes+=(--exclude "/$o"); done
  rsync -a --delete "${excludes[@]}" "$1/" "$SUITE/"
  for o in "${OUTPUTS[@]}"; do rm -rf "${SUITE:?}/$o"; done
}

[[ -f "$ROOT/tests/integration-tests/playwright.config.ts" ]] \
  || { echo "[prepare] no tests/integration-tests/playwright.config.ts on this branch" >&2; exit 1; }
rsync_suite "$ROOT/tests/integration-tests"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
BRANCH="${GITHUB_REF_NAME:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
# Under `schedule` the checkout may be SCHEDULED_BRANCH rather than the ref
# that triggered the run; the checked-out branch is the truth.
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  b="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"; [[ "$b" != "HEAD" ]] && BRANCH="$b"
fi
REPO="${GITHUB_REPOSITORY:-$(git -C "$ROOT" config --get remote.origin.url | sed -E 's#(\.git)?$##; s#.*github\.com[:/]##')}"

cp "$ROOT/ci/playwright.ci.config.ts" "$SUITE/playwright.ci.config.ts"

REPO="$REPO" SHA="$SHA" BRANCH="$BRANCH" node -e '
  const e = process.env;
  const out = { kind: "this-branch", repo: e.REPO, ref: e.BRANCH, branch: e.BRANCH, sha: e.SHA, label: e.BRANCH };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");
' "$WORK/suite-source.json"

echo "[prepare] suite ready at .work/suite — $BRANCH @ ${SHA:0:9} ($REPO)"
