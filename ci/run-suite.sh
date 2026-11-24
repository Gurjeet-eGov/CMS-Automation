#!/usr/bin/env bash
# run-suite.sh — run the prepared suite (.work/suite) against one environment
# and collect everything the report job needs into .work/out/.
#
# Usage: ci/run-suite.sh --environment <name> --scope <scope> [--grep <expr>] [-- <extra playwright args>]
#
# Scopes:
#   profile-only   read-only: only discover what the deployment has (profile-setup)
#   smoke          --project=smoke
#   api            --project=api
#   smoke+api      --project=smoke --project=api
#   citizen | employee | admin | lifecycle   that folder under tests/
#   full           everything (the only scope that feeds the dashboard history)
#
# Reads (all optional): ENV_CONFIG and ENV_SECRETS (on GitHub: the chosen
# environment's CONFIG_ENV and SECRETS_ENV), INPUT_BASE_URL, INPUT_TENANT_SLUG,
# INPUT_DIGIT_TENANT (see ci/load-env.sh); GREP; RECORD_SCREENSHOTS,
# RECORD_VIDEO, RECORD_TRACES;
# PW_GLOBAL_TIMEOUT_MS (default 5400000 = 90 min).
#
# Test failures are NOT an error here: the run's verdict is decided later, by
# ci/summarize.mjs. This script exits non-zero only when it can't do its job.
#
# .work/out/ afterwards:
#   run-meta.json            what ran, where, and anything that stopped it
#   report.json              Playwright's JSON report (if it got that far)
#   results.xml              the same results as JUnit XML, for Test Run (artifact test-results)
#   playwright-report/       the HTML report
#   test-results/            failure context (+ screenshots / video / traces when switched on)
#   deployment-profile.json  what profile-setup discovered (no secrets in it)
# Token files (auth*.json, citizen-fixture.json) are never copied out.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CI_ROOT="$ROOT"
SUITE="$ROOT/.work/suite"
OUT="$ROOT/.work/out"

ENVIRONMENT=""
SCOPE="smoke"
GREP="${GREP:-}"
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="${2:?}"; shift 2 ;;
    --scope)       SCOPE="${2:?}"; shift 2 ;;
    --grep)        GREP="${2:-}"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "[run] unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ENVIRONMENT" ]] || { echo "[run] --environment is required" >&2; exit 2; }
[[ -f "$SUITE/playwright.ci.config.ts" ]] || { echo "[run] no prepared suite: run ci/prepare-suite.sh first" >&2; exit 2; }

ARGS=()
case "$SCOPE" in
  profile-only) ARGS=(--project=profile-setup) ;;
  smoke)        ARGS=(--project=smoke) ;;
  api)          ARGS=(--project=api) ;;
  smoke+api)    ARGS=(--project=smoke --project=api) ;;
  citizen|employee|admin|lifecycle) ARGS=("tests/$SCOPE") ;;
  full)         ARGS=() ;;
  *) echo "[run] unknown scope: $SCOPE" >&2; exit 2 ;;
esac
PARTIAL=false
[[ "$SCOPE" != "full" || -n "$GREP" || ${#EXTRA[@]} -gt 0 ]] && PARTIAL=true

rm -rf "$OUT"
mkdir -p "$OUT"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA="$(node -p 'require(process.argv[1]).sha' "$ROOT/.work/suite-source.json")"
# Same shape as the suite's own run ids (scripts/build-catalog.ts and
# regression-alert.mjs sort runs by the first 15 characters).
RUN_ID="$(date -u +%Y-%m-%d_%H%M)_${SHA:0:8}"

cd "$SUITE" || exit 2
# Results from an earlier run in this folder must never pass for this run's.
rm -rf report.json results.xml playwright-report test-results deployment-profile.json
PROBLEMS=""
SECRET_KEYS=""
# shellcheck source=ci/load-env.sh
if ! source "$ROOT/ci/load-env.sh" "$ENVIRONMENT"; then
  PROBLEMS="$CONFIG_PROBLEMS"
  printf '%s' "$PROBLEMS" | while IFS= read -r p; do
    [[ -n "$p" ]] && echo "::error title=Configuration::$p" && echo "[run] cannot start: $p" >&2
  done
fi
# Each setting is exported on its own now; the raw blocks needn't reach Playwright.
unset ENV_SECRETS ENV_CONFIG

# Preflight: is the deployment reachable at all? An unreachable host would
# otherwise surface as dozens of setup timeouts.
PRE_OK=true
PRE_CODE=""
PRE_ERR=""
if [[ -z "$PROBLEMS" ]]; then
  insecure=()
  [[ "${IGNORE_HTTPS_ERRORS:-}" == "1" ]] && insecure=(-k)
  PRE_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -L ${insecure[@]+"${insecure[@]}"} "$BASE_URL/" 2>"$OUT/.preflight.err")"
  PRE_ERR="$(head -c 300 "$OUT/.preflight.err" | tr '\n' ' ')"
  rm -f "$OUT/.preflight.err"
  if [[ "$PRE_CODE" == "000" || "$PRE_CODE" =~ ^5 ]]; then
    PRE_OK=false
    echo "::error title=Unreachable::$BASE_URL answered ${PRE_CODE} ${PRE_ERR}"
  fi
  echo "[run] preflight: $BASE_URL → HTTP $PRE_CODE"
fi

PW_EXIT=""
if [[ -z "$PROBLEMS" && "$PRE_OK" == true ]]; then
  CMD=(npx playwright test --config playwright.ci.config.ts
    ${ARGS[@]+"${ARGS[@]}"}
    --global-timeout="${PW_GLOBAL_TIMEOUT_MS:-5400000}")
  [[ -n "$GREP" ]] && CMD+=(--grep "$GREP")
  CMD+=(${EXTRA[@]+"${EXTRA[@]}"})
  echo "[run] ${CMD[*]}"
  echo "[run] recording: screenshots=${RECORD_SCREENSHOTS:-off} video=${RECORD_VIDEO:-off} traces=${RECORD_TRACES:-off}"
  "${CMD[@]}"
  PW_EXIT=$?
  echo "[run] playwright exited $PW_EXIT (test failures are judged by the report step)"
fi
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for f in report.json results.xml playwright-report test-results deployment-profile.json; do
  [[ -e "$f" ]] && cp -R "$f" "$OUT/"
done

# The dashboard's folder on gh-pages: <branch>/<environment>, made safe for a
# folder name ("Nai Pepea" → nai-pepea). See ci/dashboard-key.mjs.
SUITE_BRANCH="$(node -p 'require(process.argv[1]).branch' "$ROOT/.work/suite-source.json" 2>/dev/null || true)"
DASHBOARD_KEY="$(node "$ROOT/ci/dashboard-key.mjs" "${SUITE_BRANCH:-unknown}" "$ENVIRONMENT")"

# Everything run-meta.json says comes through the environment, so no value is
# ever spliced into code.
DASHBOARD_KEY="$DASHBOARD_KEY" RUN_ID="$RUN_ID" ENVIRONMENT="$ENVIRONMENT" SCOPE="$SCOPE" PARTIAL="$PARTIAL" GREP="$GREP" \
STARTED="$STARTED" FINISHED="$FINISHED" PW_EXIT="$PW_EXIT" PROBLEMS="$PROBLEMS" \
PRE_OK="$PRE_OK" PRE_CODE="$PRE_CODE" PRE_ERR="$PRE_ERR" SECRET_KEYS="$SECRET_KEYS" \
M_BASE_URL="${BASE_URL:-}" M_TENANT="${DIGIT_TENANT:-}" M_SLUG="${IDENTITY_TEST_TENANT_SLUG:-}" \
M_SCREENSHOTS="${RECORD_SCREENSHOTS:-}" M_VIDEO="${RECORD_VIDEO:-}" M_TRACES="${RECORD_TRACES:-}" \
node -e '
  const fs = require("fs");
  const e = process.env;
  const on = v => /^(1|true|yes|on)$/i.test((v || "").trim());
  const source = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const meta = {
    runId: e.RUN_ID,
    environment: e.ENVIRONMENT,
    scope: e.SCOPE,
    grep: e.GREP || null,
    partial: e.PARTIAL === "true",
    dashboardKey: e.DASHBOARD_KEY,
    source,
    target: { baseUrl: e.M_BASE_URL || null, tenant: e.M_TENANT || null, workspaceSlug: e.M_SLUG || null },
    recording: { screenshots: on(e.M_SCREENSHOTS), video: on(e.M_VIDEO), traces: on(e.M_TRACES) },
    startedAt: e.STARTED,
    finishedAt: e.FINISHED,
    configProblems: (e.PROBLEMS || "").split("\n").filter(Boolean),
    preflight: e.PRE_CODE ? { ok: e.PRE_OK === "true", httpCode: e.PRE_CODE, error: e.PRE_ERR || null } : null,
    playwrightExit: e.PW_EXIT === "" ? null : Number(e.PW_EXIT),
    secretKeys: (e.SECRET_KEYS || "").trim().split(/\s+/).filter(Boolean),
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(meta, null, 2) + "\n");
' "$ROOT/.work/suite-source.json" "$OUT/run-meta.json" || { echo "[run] could not write run-meta.json" >&2; exit 3; }

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "run-id=$RUN_ID" >> "$GITHUB_OUTPUT"
fi
echo "[run] results in .work/out (run $RUN_ID)"
exit 0
