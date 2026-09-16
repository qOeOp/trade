#!/usr/bin/env bash
# Reclaim the Cargo target directory between test phases when the disk is tight.
#
# The `rust tests` job runs three heavy phases into one target directory, and each
# phase compiles the workspace under a different feature union. Cargo keeps every
# resolution's artifacts side by side, so the footprint is roughly additive rather
# than shared. On 2026-09-14 that crossed the runner's disk and `cargo nextest
# archive` began failing with `No space left on device`, which is why `main` has
# been red ever since.
#
# The following phase rebuilds from source either way, so the previous phase's
# artifacts are dead weight once its tests have run. Removing them costs
# compile time, so this only pays that cost when the space is actually needed.

set -euo pipefail

label=${1:?Usage: reclaim-cargo-target.bash LABEL [MIN_AVAILABLE_GB]}
min_available_gb=${2:-40}
target_dir=${CARGO_TARGET_DIR:-target}

if [ ! -d "$target_dir" ]; then
  echo "No target directory at ${target_dir}; nothing to reclaim ${label}."
  exit 0
fi

available_gb=$(($(df -Pk "$target_dir" | awk 'NR == 2 {print $4}') / 1024 / 1024))
if [ "$available_gb" -ge "$min_available_gb" ]; then
  echo "Available ${available_gb}G >= ${min_available_gb}G ${label}; keeping ${target_dir}."
  exit 0
fi

echo "::group::Reclaiming ${target_dir} ${label}"
echo "Available ${available_gb}G < ${min_available_gb}G; removing the previous phase's artifacts."
du -sh "$target_dir" || true
rm -rf "${target_dir:?}"
reclaimed_gb=$(($(df -Pk "$(dirname "$target_dir")" | awk 'NR == 2 {print $4}') / 1024 / 1024))
echo "Available after reclaim: ${reclaimed_gb}G"
echo "::endgroup::"
