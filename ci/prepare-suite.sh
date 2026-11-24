#!/usr/bin/env bash
# prepare-suite.sh — put the suite a run will use at .work/suite.
#
# Usage: ci/prepare-suite.sh [--source this-branch|product] [--ref <ref>]
#
#   --source this-branch  (default) the suite in this checkout:
#                         tests/integration-tests on whatever branch is checked
#                         out (master, impl/<name>, …)
#   --source product      the suite straight from the product repo
#                         ($PRODUCT_REPO, default egovernments/Citizen-Complaint-
#                         Resolution-System) at --ref (default develop), with the
#                         same vendoring the Sync workflow applies
#
# Also copies ci/playwright.ci.config.ts into the suite and writes
# .work/suite-source.json (what was prepared, for run-meta.json).
#
# The suite is COPIED rather than run in place so that a run never writes
# reports, tokens or node_modules into the repo's own tests/ folder, and so both
# sources look identical to everything downstream. node_modules survives between
# local runs, so ci/run-local.sh doesn't reinstall every time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="this-branch"
REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:?--source needs a value}"; shift 2 ;;
    --ref)    REF="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
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

case "$SOURCE" in
  this-branch)
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
    LABEL="$BRANCH"
    ;;
  product)
    REPO="${PRODUCT_REPO:-egovernments/Citizen-Complaint-Resolution-System}"
    REF="${REF:-develop}"
    SHA="$("$ROOT/ci/fetch-product.sh" "$REPO" "$REF" "$WORK/product")"
    rm -rf "$WORK/product-suite"
    node "$ROOT/ci/import-product-suite.mjs" "$WORK/product" "$WORK/product-suite" --repo "$REPO" --ref "$REF" --sha "$SHA"
    rsync_suite "$WORK/product-suite"
    BRANCH="$REF"
    LABEL="product@$REF"
    ;;
  *) echo "[prepare] --source must be this-branch or product, got: $SOURCE" >&2; exit 2 ;;
esac

cp "$ROOT/ci/playwright.ci.config.ts" "$SUITE/playwright.ci.config.ts"

SOURCE="$SOURCE" REPO="$REPO" REF="${REF:-$BRANCH}" SHA="$SHA" BRANCH="$BRANCH" LABEL="$LABEL" node -e '
  const e = process.env;
  const out = { kind: e.SOURCE, repo: e.REPO, ref: e.REF, branch: e.BRANCH, sha: e.SHA, label: e.LABEL };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");
' "$WORK/suite-source.json"

echo "[prepare] suite ready at .work/suite — $LABEL @ ${SHA:0:9} ($REPO)"
