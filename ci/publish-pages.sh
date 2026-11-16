#!/usr/bin/env bash
# publish-pages.sh — add one full run to a dashboard inside a GitHub Pages site
# folder. Pure file work (no git): ci/push-pages.sh wraps it with the gh-pages
# clone and push, and you can point it at any local folder to preview.
#
# Usage: ci/publish-pages.sh <site-dir>
#
# Reads .work/out (the run's results + run-meta.json) and .work/suite (the
# prepared suite, with `npm ci` done: build-catalog needs tsx and ts-morph).
# Env: REPORTS_KEPT  runs that keep their full Playwright report (default 5);
#                    older runs stay in the history with results only.
#
# Site layout (one dashboard per suite source × environment, each with its own
# history, so a product-suite run never reads as a regression of master's):
#   <site>/index.html            landing page (ci/site-index.html)
#   <site>/dashboards.json       what the landing page lists
#   <site>/<source>/<env>/       the suite's own dashboard/ app + catalog.json,
#                                history.json, runs/<runId>/{playwright-report,
#                                test-results, report.json}
#   e.g. master/naipepea/, impl-bomet/bomet/, product-develop/naipepea/
#
# Mirrors runner/run-cycle.sh's catalog + publish + prune, which is how the
# deployment box has always published this dashboard.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$(cd "${1:?usage: publish-pages.sh <site-dir>}" && pwd)"
OUT="$ROOT/.work/out"
SUITE="$ROOT/.work/suite"
KEEP="${REPORTS_KEPT:-5}"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "[publish] REPORTS_KEPT must be a whole number ≥ 1 (got $KEEP)" >&2; exit 2; }

[[ -f "$OUT/run-meta.json" ]] || { echo "[publish] no .work/out/run-meta.json" >&2; exit 2; }
[[ -f "$OUT/report.json" ]] || { echo "[publish] no report.json: nothing to publish" >&2; exit 2; }

meta() { node -p "const m=require(process.argv[1]); String($1 ?? '')" "$OUT/run-meta.json"; }
RUN_ID="$(meta m.runId)"
KEY="$(meta m.dashboardKey)"
LABEL="$(meta m.source.label)"
SHA="$(meta m.source.sha)"
TARGET="$(meta m.target.baseUrl)"
[[ "$KEY" =~ ^[a-z0-9._-]+/[a-z0-9_]+$ ]] || { echo "[publish] unexpected dashboard key: $KEY" >&2; exit 2; }

DASH="$SITE/$KEY"
RUN_DIR="$DASH/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "[publish] $KEY ← run $RUN_ID"

# 1. The run's own folder: what the dashboard's per-run and per-test links open.
cp -f "$OUT/report.json" "$RUN_DIR/"
for d in playwright-report test-results; do
  rm -rf "${RUN_DIR:?}/$d"
  [[ -d "$OUT/$d" ]] && cp -R "$OUT/$d" "$RUN_DIR/"
done

# 2. catalog.json + history.json, carrying the dashboard's previous history
#    forward. Run from the suite dir: build-catalog makes test ids relative to
#    its working directory and resolves report paths against the report's
#    rootDir, which is the same absolute path in both CI jobs.
BUILD="$ROOT/.work/catalog-build"
rm -rf "$BUILD"; mkdir -p "$BUILD"
(
  cd "$SUITE"
  env BRANCH="$LABEL" GIT_SHA="$SHA" BASE_URL="$TARGET" RUN_LIMIT="$KEEP" \
    REPORT_JSON="$OUT/report.json" HISTORY_JSON="$BUILD/history.json" CATALOG_JSON="$BUILD/catalog.json" \
    PUBLIC_HISTORY_JSON="$DASH/history.json" PUBLIC_CATALOG_JSON="$DASH/catalog.json" \
    npx --no-install tsx scripts/build-catalog.ts "$RUN_ID"
)
cp -f "$BUILD/catalog.json" "$BUILD/history.json" "$DASH/"

# 3. The dashboard app itself, from the suite that ran: a suite update that
#    changes the catalog format brings the matching UI with it.
cp -R "$SUITE/dashboard/." "$DASH/"

# 4. Keep runs/ to exactly the runs the catalog still links into (the newest
#    REPORTS_KEPT with a report), as run-cycle.sh does.
KEEP_IDS="$(node -e '
  const h = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write((h.runs || []).filter(r => r.hasReport !== false).map(r => r.id).join("\n"));
' "$DASH/history.json")"
if [[ -n "$KEEP_IDS" ]]; then
  for d in "$DASH"/runs/*/; do
    id="$(basename "$d")"
    if ! grep -qxF -- "$id" <<<"$KEEP_IDS"; then
      rm -rf "${DASH:?}/runs/$id"
      echo "[publish] pruned the report of run $id (its results stay in the history)"
    fi
  done
fi

# 5. Landing page + its index, and no Jekyll processing (it would hide files
#    and slow every Pages build down).
cp -f "$ROOT/ci/site-index.html" "$SITE/index.html"
node "$ROOT/ci/build-site-index.mjs" "$SITE"
touch "$SITE/.nojekyll"

SITE_KB="$(du -sk "$SITE" | cut -f1)"
[[ -d "$SITE/.git" ]] && SITE_KB=$(( SITE_KB - $(du -sk "$SITE/.git" | cut -f1) ))
SIZE_MB=$(( SITE_KB / 1024 ))
echo "[publish] site is ${SIZE_MB} MB"
if (( SIZE_MB > 800 )); then
  echo "::warning title=GitHub Pages size::The site is ${SIZE_MB} MB; GitHub Pages stops at 1 GB. Lower REPORTS_KEPT, or switch RECORD_VIDEO / RECORD_TRACES off."
fi
