#!/usr/bin/env bash
# Pull one digest-pinned image from the first source that answers, and print the reference used.
#
# public.ecr.aws refuses anonymous pulls past a data limit counted per source IP. Hosted runners
# share their IPs with every other GitHub user, so a job can land on an exhausted one: on 2026-09-26
# a `rust tests` service pull (#1050) and this chain's own pull (#1052) failed three times each with
# `toomanyrequests: Data limit exceeded`. The same digests are on mirror.gcr.io, which is tried
# first; ECR stays as the fallback. A digest names the bytes, so every source serves the same image;
# this refuses a list whose digests differ, and logs which source it used when it falls back. Each
# source gets a bounded time, so a source that hangs rather than refuses also falls through.
#
# Usage: pull-pinned-image.bash <image@sha256:...> [<image@sha256:...> ...]
# Prints the reference that is present locally afterwards; the caller runs exactly that.
set -Eeuo pipefail
trap 'echo "pull-pinned-image.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

[[ $# -gt 0 ]] || {
  echo "ERROR: pull-pinned-image.bash needs at least one image@sha256:... reference." >&2
  exit 1
}
digest=""
for source in "$@"; do
  if [[ ! "$source" =~ @(sha256:[0-9a-f]{64})$ ]]; then
    echo "ERROR: ${source} is not pinned by digest." >&2
    exit 1
  fi
  if [[ -n "$digest" && "${BASH_REMATCH[1]}" != "$digest" ]]; then
    echo "ERROR: ${source} pins ${BASH_REMATCH[1]}, not ${digest}; every source must name the same image." >&2
    exit 1
  fi
  digest="${BASH_REMATCH[1]}"
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
attempts="${PULL_PINNED_IMAGE_ATTEMPTS:-2}"
seconds="${PULL_PINNED_IMAGE_TIMEOUT_SECONDS:-300}"
for source in "$@"; do
  if docker image inspect "$source" > /dev/null 2>&1; then
    echo "$source"
    exit 0
  fi
done
for source in "$@"; do
  if timeout "$seconds" bash "${script_dir}/docker-pull-retry.sh" "$source" "$attempts" >&2; then
    if [[ "$source" != "$1" ]]; then
      echo "pull-pinned-image.bash: pulled ${digest} from ${source%%/*} after ${1%%/*} failed." >&2
    fi
    echo "$source"
    exit 0
  fi
  echo "pull-pinned-image.bash: ${source%%/*} did not serve ${digest} within ${seconds}s; trying the next source." >&2
done
echo "ERROR: no source served ${digest}: $*" >&2
exit 1
