#!/usr/bin/env bash
# fetch-product.sh — download just the integration suite from the product repo.
#
# Usage: ci/fetch-product.sh <owner/repo> <ref> <dir>
#   <ref>  a branch, tag or full commit SHA (e.g. develop, v2.9.0, a11596cc3e0a…)
#   <dir>  emptied and filled with a sparse checkout: tests/integration-tests
#          plus any file the suite imports from outside that folder
#
# Prints the checked-out commit SHA on stdout (everything else goes to stderr).
# Works on macOS's bash 3.2 too, so ci/run-local.sh can use it.
set -euo pipefail

repo="${1:?usage: fetch-product.sh <owner/repo> <ref> <dir>}"
ref="${2:?usage: fetch-product.sh <owner/repo> <ref> <dir>}"
dir="${3:?usage: fetch-product.sh <owner/repo> <ref> <dir>}"
here="$(cd "$(dirname "$0")" && pwd)"

[[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "[fetch-product] not an owner/repo: $repo" >&2; exit 2; }

rm -rf "$dir"
mkdir -p "$dir"
cd "$dir"
{
  git init -q
  git remote add origin "https://github.com/$repo.git"
  # Only the suite folder, and only the file contents we check out (blob:none).
  git config core.sparseCheckout true
  echo '/tests/integration-tests/' > .git/info/sparse-checkout
  echo "[fetch-product] fetching $repo @ $ref"
  git fetch -q --depth 1 --filter=blob:none origin "$ref"
  git -c advice.detachedHead=false checkout -q FETCH_HEAD
} >&2

# Files the suite imports from outside its folder (see import-product-suite.mjs):
# add each to the sparse checkout so it can be vendored.
added=0
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  echo "/$p" >> .git/info/sparse-checkout
  added=$((added + 1))
  echo "[fetch-product] also fetching $p (imported by the suite from outside its folder)" >&2
done < <(node "$here/import-product-suite.mjs" --scan .)
if (( added > 0 )); then
  git read-tree -mu HEAD >&2 # re-apply the sparse patterns: checks the new paths out
fi

git rev-parse HEAD
