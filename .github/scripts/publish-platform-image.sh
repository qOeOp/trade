#!/usr/bin/env bash
# Assemble only the two native builds of one revision; no image or historical digest is removed.
set -euo pipefail
image="$1"
revision="$2"
alias="$3"
tags=(--tag "$image:sha-$revision")
if [ -n "$alias" ]; then tags+=(--tag "$image:$alias"); fi
docker buildx imagetools create "${tags[@]}" \
  "$image:sha-$revision-arm64" "$image:sha-$revision-amd64"
docker buildx imagetools inspect --raw "$image:sha-$revision" | python3 -c '
import json,sys
manifest=json.load(sys.stdin)
platforms={(x["platform"]["os"],x["platform"]["architecture"]) for x in manifest["manifests"]}
assert platforms=={("linux","arm64"),("linux","amd64")}, platforms
print("Published native arm64 and amd64 manifest")
'
