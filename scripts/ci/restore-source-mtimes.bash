#!/usr/bin/env bash
# Date the checkout's sources so cargo rebuilds only what changed since the restored target was built.
#
# actions/checkout gives every file the checkout time, which is newer than every artifact the Rust
# cache restores, so cargo rebuilt every workspace crate on every run (73 of 74 in the rust tests
# job) even when a pull request touched one leaf. The restored target records the commit it was
# built from (S). Every tracked file is dated long before any artifact, then every file that
# differs between S and HEAD is dated now: cargo rebuilds exactly the crates those files reach.
#
# Anything uncertain falls back to leaving the checkout times, which rebuilds every workspace crate
# as before: no recorded S, an S that cannot be fetched or diffed, or a change to an input every
# crate reads (Cargo.lock, the toolchain file, .cargo/config, any build.rs).
#
# S is kept as the content of `vibe-source-commit/CACHEDIR.TAG` under the target directory:
# rust-cache deletes every other loose file there before saving (cleanup.ts cleanTargetDir keeps a
# directory holding a CACHEDIR.TAG, and that file).
#
# Usage: restore-source-mtimes.bash <target-dir>
set -Eeuo pipefail

target_dir="${1:?usage: restore-source-mtimes.bash <target-dir>}"
marker_dir="$target_dir/vibe-source-commit"
marker="$marker_dir/CACHEDIR.TAG"
marker_prefix="# The commit whose sources built this target directory: "
head_commit="$(git rev-parse HEAD)"

# The target directory is about to be built from HEAD, so it records HEAD, whatever happens next.
record_head() {
  mkdir -p "$marker_dir"
  printf 'Signature: 8a477f597d28d172789f06886806bc55\n%s%s\n' "$marker_prefix" "$head_commit" >"$marker"
}

full_rebuild() {
  echo "source mtimes: $1; keeping checkout times, so every workspace crate rebuilds"
  record_head
  exit 0
}

source_commit=""
if [[ -f "$marker" ]]; then
  source_commit="$(sed -n "s/^${marker_prefix}\([0-9a-f]\{40\}\)\$/\1/p" "$marker")"
fi
source_commit="${source_commit:-${VIBE_SOURCE_COMMIT_WHEN_UNRECORDED:-}}"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || full_rebuild "the restored target records no source commit"

if ! git cat-file -e "${source_commit}^{commit}" 2>/dev/null; then
  git fetch --quiet --no-tags --depth=1 origin "$source_commit" ||
    full_rebuild "source commit $source_commit cannot be fetched"
fi
changed="$(git diff --name-only --no-renames "$source_commit" HEAD)" ||
  full_rebuild "cannot diff $source_commit against HEAD"
if grep -qE '^(Cargo\.lock|rust-toolchain(\.toml)?|\.cargo/config(\.toml)?)$|(^|/)build\.rs$' <<<"$changed"; then
  full_rebuild "an input every crate reads changed since $source_commit"
fi

# 2000-01-01T00:00:00Z: older than any artifact a cache can hold.
git ls-files -z | xargs -0 touch -h -m -d @946684800
if [[ "${VIBE_SOURCE_MTIMES_SKIP_CHANGED:-}" != "1" ]]; then
  git diff -z --name-only --no-renames --diff-filter=d "$source_commit" HEAD | xargs -0 -r touch -h -m
fi
record_head
count="$(grep -c . <<<"$changed" || true)"
echo "source mtimes: $count file(s) changed since $source_commit are dated now; every other tracked file is dated 2000-01-01"
# Which crates the dated files belong to, for the log.
sed -nE 's#^(crates/(adapters/)?[^/]+)/.*#\1#p' <<<"$changed" | sort | uniq -c || true
