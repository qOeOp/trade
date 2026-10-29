#!/usr/bin/env bash
# Prints true when GITHUB_SHA contains the latest commit on main that changes the documentation
# site, false when a later main commit changes it (that commit's own docs-pages run deploys it).
# Needs a checkout with full history; keep the paths in step with docs-pages.yml.
set -euo pipefail

git fetch --quiet origin main
newest=$(git log -1 --format=%H FETCH_HEAD -- \
  .github/workflows/docs-pages.yml docs docs-site .github/actions/ci-paths \
  .github/scripts/ci-paths.py .github/scripts/docs-pages-current.sh)
if git merge-base --is-ancestor "$newest" "$GITHUB_SHA"; then
  echo true
else
  echo false
fi
