#!/usr/bin/env bash
# Assemble only the two native builds of one revision; no image or historical digest is removed.
set -euo pipefail
image="$1"
revision="$2"
alias="$3"
tags=(--tag "$image:sha-$revision")
if [ "$alias" = main ]; then
  # Main builds of different commits run at the same time, so an older one can finish last: move `main` only to a
  # revision equal to or ahead of the one it names now (its org.opencontainers.image.revision).
  current="$(docker buildx imagetools inspect --format '{{json .Image}}' "$image:main" 2>/dev/null \
    | jq -r '."linux/amd64".config.Labels."org.opencontainers.image.revision" // empty' || true)"
  status=ahead
  if [ -n "$current" ]; then
    status="$(gh api "repos/$GITHUB_REPOSITORY/compare/$current...$revision" --jq .status)"
  fi
  if [ "$status" = ahead ] || [ "$status" = identical ]; then
    tags+=(--tag "$image:main")
  else
    echo "$image:main stays at $current: $revision is $status of it"
  fi
elif [ -n "$alias" ]; then
  tags+=(--tag "$image:$alias")
fi
docker buildx imagetools create "${tags[@]}" \
  "$image:sha-$revision-arm64" "$image:sha-$revision-amd64"
docker buildx imagetools inspect --raw "$image:sha-$revision" | python3 -c '
import json,sys
manifest=json.load(sys.stdin)
platforms={(x["platform"]["os"],x["platform"]["architecture"]) for x in manifest["manifests"]}
assert platforms=={("linux","arm64"),("linux","amd64")}, platforms
print("Published native arm64 and amd64 manifest")
'
