#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <project-manifest> <fresh-output> <dockerfile>" >&2
  exit 64
}

[[ $# -eq 3 ]] || usage
project_file=$1
output=$2
dockerfile=$3
[[ -f $project_file && -f $dockerfile && ! -e $output ]] || usage

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
product="$tmp/product"
context="$tmp/context"
mkdir "$context"

repository=$(git -C "$(dirname "$project_file")" rev-parse --show-toplevel)
project_file=$(cd "$(dirname "$project_file")" && pwd -P)/$(basename "$project_file")
[[ $project_file == "$repository"/* ]] || usage
project_locator=${project_file#"$repository"/}

safe_path() {
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && $1 != /* && $1 != *..* && $1 != .cargo* ]]
}

canonical_project() {
  jq -S -c . "$1" > "$tmp/canonical.jcs"
  cmp "$1" "$tmp/canonical.jcs"
  jq -e '
    keys == ["cargo_manifest", "schema_version", "source_files", "wasm_target"] and
    .schema_version == 1 and
    (.source_files | length > 0 and length <= 64) and
    .source_files == (.source_files | sort | unique)
  ' "$1" > /dev/null
}

validate_metadata() {
  local metadata=$1 manifest=$2 target=$3 root="/inspect/source/$2"
  jq -e --arg root "$root" --arg target "$target" '
    (.packages | length > 0) and
    ([.packages[] | select(.source != null and .source != "registry+https://github.com/rust-lang/crates.io-index")] | length == 0) and
    ([.packages[] |
      select(.name != "libm" or .version != "0.2.16" or .source != "registry+https://github.com/rust-lang/crates.io-index") |
      .targets[].kind[] | select(. == "custom-build" or . == "proc-macro")] | length == 0) and
    ([.packages[] | select(.name == "libm" and .version == "0.2.16") |
      .targets[].kind[] | select(. == "proc-macro")] | length == 0) and
    ([.packages[] | select(.manifest_path == $root) | .targets[] |
      select(.crate_types == ["cdylib"] and (.name | gsub("-"; "_")) == $target)] | length == 1)
  ' "$metadata" > /dev/null
  while IFS= read -r package_manifest; do
    case $package_manifest in
      /inspect/source/*) grep -Fqx -- "${package_manifest#/inspect/source/}" "$tmp/expected" ;;
      *) exit 66 ;;
    esac
  done < <(jq -r '.packages[] | select(.source == null) | .manifest_path' "$metadata")
}

docker_build() {
  local target=$1 manifest=$2 wasm_target=$3 destination=$4 dockerfile_sha
  dockerfile_sha=$(shasum -a 256 "$dockerfile" | cut -d ' ' -f 1)
  docker buildx build \
    --platform linux/arm64 \
    --file "$dockerfile" \
    --target "$target" \
    --build-arg "PROGRAM_MANIFEST=$manifest" \
    --build-arg "PROGRAM_WASM_TARGET=$wasm_target" \
    --build-arg "DOCKERFILE_SHA256=$dockerfile_sha" \
    --output "type=local,dest=$destination" \
    "$context"
}

canonical_project "$project_file"
jq -r '.source_files[]' "$project_file" > "$tmp/expected"
grep -Fqx -- "$project_locator" "$tmp/expected"
sources=()
total=0
while IFS= read -r source; do
  safe_path "$source" && [[ -f "$repository/$source" && ! -L "$repository/$source" ]] || exit 66
  size=$(wc -c < "$repository/$source")
  [[ $size -le 1048576 ]] || exit 66
  total=$((total + size))
  sources+=("$source")
done < "$tmp/expected"
[[ $total -le 4194304 ]] || exit 66

git init -q --bare "$tmp/git"
export GIT_DIR="$tmp/git" GIT_WORK_TREE="$repository" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
capture_tree() {
  git read-tree --empty
  git add -- "${sources[@]}"
  git ls-files > "$tmp/actual"
  cmp "$tmp/expected" "$tmp/actual"
  git ls-files --stage | awk '$1 != "100644" && $1 != "100755" { exit 1 }'
  git write-tree
}
tree=$(capture_tree)
[[ $tree == "$(capture_tree)" ]] || {
  echo "program source changed during capture" >&2
  exit 66
}
git show "$tree:$project_locator" > "$tmp/project.jcs"
canonical_project "$tmp/project.jcs"
git -c tar.umask=0022 archive --format=tar --mtime=1970-01-01T00:00:01Z \
  --output "$context/source.tar" "$tree"

manifest=$(jq -er .cargo_manifest "$tmp/project.jcs")
wasm_target=$(jq -er .wasm_target "$tmp/project.jcs")
safe_path "$manifest" && [[ $wasm_target =~ ^[A-Za-z0-9_]+$ ]] || exit 66
docker_build inspection "$manifest" "$wasm_target" "$tmp/inspection"
validate_metadata "$tmp/inspection/metadata.json" "$manifest" "$wasm_target"
docker_build seal "$manifest" "$wasm_target" "$product"

[[ $(wc -c < "$product/source-capsule.tar") -le 8388608 ]]
[[ $(wc -c < "$product/build-recipe.jcs") -le 32768 ]]
[[ $(wc -c < "$product/program.first.wasm") -le 65536 ]]
[[ $(wc -c < "$product/program.second.wasm") -le 65536 ]]
cmp "$product/program.first.wasm" "$product/program.second.wasm"
mv "$product" "$output"
