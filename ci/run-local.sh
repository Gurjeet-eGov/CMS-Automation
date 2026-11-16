#!/usr/bin/env bash
# run-local.sh — run the suite on your own machine exactly the way CI does.
#
# Usage:
#   ci/run-local.sh <environment> [scope] [--source product] [--ref <ref>] [--grep <expr>] [-- <playwright args>]
#
# Examples:
#   ci/run-local.sh naipepea profile-only            # read-only: what does the deployment have?
#   ci/run-local.sh naipepea smoke
#   ci/run-local.sh naipepea citizen --grep @area:pgr
#   ci/run-local.sh bomet full --source product --ref develop
#   ci/run-local.sh naipepea smoke -- --headed      # watch the browser
#
# Passwords come from environments/<environment>/secrets.env (git-ignored; copy
# secrets.example next to it and fill it in). Results land in .work/out; the
# script prints how to open the report.
#
# These runs act on a LIVE deployment: they sign in, file complaints and create
# citizens. Don't run against a deployment someone else is testing at the same
# time (the suite assumes it has the tenant to itself).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVIRONMENT="${1:-}"
[[ -n "$ENVIRONMENT" && "$ENVIRONMENT" != -* ]] || { sed -n '2,20p' "$0"; exit 2; }
shift
SCOPE="smoke"
if [[ $# -gt 0 && "$1" != -* ]]; then SCOPE="$1"; shift; fi
SOURCE="this-branch"; REF=""; GREP=""; EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:?}"; shift 2 ;;
    --ref)    REF="${2:?}"; shift 2 ;;
    --grep)   GREP="${2:?}"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

"$ROOT/ci/prepare-suite.sh" --source "$SOURCE" --ref "$REF"

cd "$ROOT/.work/suite"
# Reinstall only when the lockfile changed since the last local run.
LOCK_SUM="$(shasum package-lock.json | cut -d' ' -f1)"
if [[ ! -d node_modules || "$(cat node_modules/.ci-lock-sum 2>/dev/null)" != "$LOCK_SUM" ]]; then
  npm ci --no-audit --no-fund
  echo "$LOCK_SUM" > node_modules/.ci-lock-sum
fi
npx playwright install chromium >/dev/null

"$ROOT/ci/run-suite.sh" --environment "$ENVIRONMENT" --scope "$SCOPE" --grep "$GREP" -- ${EXTRA[@]+"${EXTRA[@]}"}

echo
node "$ROOT/ci/summarize.mjs" --out "$ROOT/.work/out" --suite "$ROOT/.work/suite" --notify never
if [[ -d "$ROOT/.work/out/playwright-report" ]]; then
  echo "Open the HTML report:"
  echo "  (cd .work/suite && npx playwright show-report ../out/playwright-report)"
fi
