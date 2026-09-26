#!/usr/bin/env bash
# Drives pull-pinned-image.bash against a stand-in `docker` that prints pull progress on stdout, as
# the real one does. Whatever happens, the script's stdout must be exactly one line - the reference
# the caller then runs - ending in @sha256:<digest>: a caller that captures it with $(...) would
# otherwise run an image name with progress text in it. It must use the first source that serves,
# say on stderr when it fell back - also when a source hangs instead of refusing - prefer an image
# already present, and refuse unpinned or mismatched sources by name.
set -euo pipefail
while IFS='=' read -r name _; do case "$name" in GIT_*) unset "$name" ;; esac done < <(env)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULLER="${PULL_PINNED_IMAGE_SCRIPT:-${SCRIPT_DIR}/pull-pinned-image.bash}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export PATH="${root}/bin:${PATH}" DOCKER_PULL_RETRY_DELAY_SECONDS=1
mkdir -p "${root}/bin"

# SERVING: hosts whose pulls succeed. PRESENT: references already in the local image store.
# HANGING: hosts whose pulls never finish.
cat > "${root}/bin/docker" << 'EOF'
#!/usr/bin/env bash
case "$1" in
  image) [[ " ${PRESENT:-} " == *" $3 "* ]] ;;
  pull)
    [[ " ${HANGING:-} " == *" ${2%%/*} "* ]] && exec sleep 600
    echo "${2%%@*}: Pulling from library/postgres"
    echo "Digest: ${2##*@}"
    [[ " ${SERVING:-} " == *" ${2%%/*} "* ]] || { echo "toomanyrequests: Data limit exceeded" >&2; exit 1; }
    echo "Status: Downloaded newer image for ${2}"
    ;;
esac
EOF
chmod +x "${root}/bin/docker"

d=sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c
mirror="mirror.gcr.io/library/postgres:16.4-alpine@${d}"
ecr="public.ecr.aws/docker/library/postgres:16.4-alpine@${d}"

run_case() { # name, expected exit, expected stdout (empty: none), stderr fragment, sources...
  local name=$1 want=$2 out=$3 fragment=$4 status=0
  shift 4
  bash "$PULLER" "$@" > "${root}/${name}.out" 2> "${root}/${name}.err" || status=$?
  local lines
  lines="$(grep -c '' "${root}/${name}.out" || true)"
  if [[ "$status" -ne "$want" ]] || { [[ -n "$fragment" ]] && ! grep -qF -- "$fragment" "${root}/${name}.err"; }; then
    echo "FAIL: ${name}: expected exit ${want} and '${fragment}' on stderr, got ${status}:" >&2
    cat "${root}/${name}.err" >&2
    exit 1
  fi
  if [[ -n "$out" ]] && { [[ "$lines" -ne 1 ]] || [[ "$(cat "${root}/${name}.out")" != "$out" ]] ||
    [[ "$out" != *"@sha256:"* ]]; }; then
    echo "FAIL: ${name}: stdout must be exactly '${out}', got ${lines} line(s):" >&2
    cat "${root}/${name}.out" >&2
    exit 1
  fi
  if [[ -z "$out" ]] && [[ "$lines" -ne 0 ]]; then
    echo "FAIL: ${name}: stdout must be empty, got:" >&2
    cat "${root}/${name}.out" >&2
    exit 1
  fi
}

SERVING="mirror.gcr.io public.ecr.aws" run_case mirror-serves 0 "$mirror" "Pulling from" "$mirror" "$ecr"
if grep -q 'after' "${root}/mirror-serves.err"; then
  echo "FAIL: mirror-serves: reported a fallback that did not happen." >&2
  exit 1
fi
SERVING="public.ecr.aws" run_case falls-back 0 "$ecr" \
  "pulled ${d} from public.ecr.aws after mirror.gcr.io failed." "$mirror" "$ecr"
PRESENT="$ecr" SERVING="" run_case already-present 0 "$ecr" "" "$mirror" "$ecr"
if [[ -s "${root}/already-present.err" ]]; then
  echo "FAIL: already-present: pulled although the image was present:" >&2
  cat "${root}/already-present.err" >&2
  exit 1
fi
SERVING="" run_case nothing-serves 1 "" "ERROR: no source served ${d}" "$mirror" "$ecr"
HANGING="mirror.gcr.io" SERVING="public.ecr.aws" PULL_PINNED_IMAGE_TIMEOUT_SECONDS=2 run_case mirror-hangs 0 "$ecr" \
  "mirror.gcr.io did not serve ${d} within 2s; trying the next source." "$mirror" "$ecr"
run_case unpinned 1 "" "is not pinned by digest." "$mirror" "public.ecr.aws/docker/library/postgres:16.4-alpine"
run_case mismatched 1 "" "every source must name the same image." "$mirror" \
  "public.ecr.aws/docker/library/postgres:16.4-alpine@sha256:$(printf '0%.0s' {1..64})"

echo "pull-pinned-image: one reference on stdout, first source that serves, fallback logged, unpinned and mismatched refused"
