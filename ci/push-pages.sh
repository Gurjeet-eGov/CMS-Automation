#!/usr/bin/env bash
# push-pages.sh — publish this run's dashboard to the gh-pages branch (CI).
#
# Usage: ci/push-pages.sh      env: GITHUB_TOKEN, GITHUB_REPOSITORY, REPORTS_KEPT
#
# Each attempt starts from a fresh clone of gh-pages, adds this run with
# ci/publish-pages.sh (which only touches this run's own dashboard folder, the
# landing page and dashboards.json), and pushes the result as ONE orphan commit:
# gh-pages never accumulates history, so old videos and screenshots don't pile
# up in the repository. --force-with-lease refuses the push if another run
# published in between (two environments finishing together); the attempt is
# then redone on top of that run's site, so neither loses its update.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/.work/site"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
REMOTE="https://github.com/$GITHUB_REPOSITORY.git"
# The token travels as a header for these git calls only: it is never written
# into a .git/config that later steps could read.
AUTH=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')")
BOT=(-c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com")

RUN_ID="$(node -p 'require(process.argv[1]).runId' "$ROOT/.work/out/run-meta.json")"
KEY="$(node -p 'require(process.argv[1]).dashboardKey' "$ROOT/.work/out/run-meta.json")"

for attempt in 1 2 3 4 5; do
  rm -rf "$SITE"
  if git "${AUTH[@]}" ls-remote --exit-code --heads "$REMOTE" gh-pages >/dev/null 2>&1; then
    git "${AUTH[@]}" clone -q --depth 1 --branch gh-pages --single-branch "$REMOTE" "$SITE"
    BASE="$(git -C "$SITE" rev-parse HEAD)"
  else
    echo "[pages] no gh-pages branch yet: this run creates it"
    mkdir -p "$SITE"
    git -C "$SITE" init -q
    git -C "$SITE" remote add origin "$REMOTE"
    BASE=""
  fi

  "$ROOT/ci/publish-pages.sh" "$SITE"

  git -C "$SITE" checkout -q --orphan "publish-$attempt"
  git -C "$SITE" add -A
  git -C "$SITE" "${BOT[@]}" commit -q -m "Publish $KEY run $RUN_ID"
  if git -C "$SITE" "${AUTH[@]}" push -q --force-with-lease="gh-pages:$BASE" origin "HEAD:refs/heads/gh-pages"; then
    echo "[pages] published $KEY run $RUN_ID to gh-pages"
    exit 0
  fi
  echo "[pages] gh-pages changed while this run was publishing (another run finished?): retrying ($attempt/5)"
  sleep $((attempt * 5))
done
echo "::error title=GitHub Pages::Could not publish to gh-pages after 5 attempts"
exit 1
