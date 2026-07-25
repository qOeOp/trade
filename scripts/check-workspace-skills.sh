#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

skills_root=.agents/skills
[ -d "$skills_root" ] || exit 0

skill_count=0
for skill_dir in "$skills_root"/*; do
  [ -d "$skill_dir" ] || continue
  skill_count=$((skill_count + 1))
  skill_name="$(basename "$skill_dir")"
  skill_file="$skill_dir/SKILL.md"

  if ! printf '%s\n' "$skill_name" | rg -q '^[a-z0-9]+(-[a-z0-9]+)*$'; then
    printf 'workspace-skill: invalid skill directory name: %s\n' "$skill_dir" >&2
    exit 1
  fi
  if [ ! -f "$skill_file" ]; then
    printf 'workspace-skill: missing SKILL.md: %s\n' "$skill_dir" >&2
    exit 1
  fi

  frontmatter_end="$(awk 'NR > 1 && $0 == "---" { print NR; exit }' "$skill_file")"
  if [ "$(sed -n '1p' "$skill_file")" != '---' ] || [ -z "$frontmatter_end" ]; then
    printf 'workspace-skill: invalid frontmatter boundary: %s\n' "$skill_file" >&2
    exit 1
  fi
  frontmatter="$(sed -n "2,$((frontmatter_end - 1))p" "$skill_file")"
  declared_name="$(printf '%s\n' "$frontmatter" | sed -n 's/^name:[[:space:]]*//p')"
  description="$(printf '%s\n' "$frontmatter" | sed -n 's/^description:[[:space:]]*//p')"

  if [ "$declared_name" != "$skill_name" ]; then
    printf 'workspace-skill: frontmatter name must match directory: %s\n' "$skill_file" >&2
    exit 1
  fi
  if [ -z "$description" ]; then
    printf 'workspace-skill: description must explain behavior and trigger: %s\n' "$skill_file" >&2
    exit 1
  fi
  if printf '%s\n' "$frontmatter" | rg -n -v '^(name|description):[[:space:]]+.+' >/dev/null; then
    printf 'workspace-skill: only name and description are allowed in frontmatter: %s\n' "$skill_file" >&2
    exit 1
  fi
  if rg -n '\[TODO|TODO:' "$skill_dir" >/dev/null; then
    rg -n '\[TODO|TODO:' "$skill_dir" >&2
    printf 'workspace-skill: placeholder content is not allowed: %s\n' "$skill_dir" >&2
    exit 1
  fi

  forbidden_marker="$(find "$skill_dir" -type f \( \
    -name package.json -o \
    -name tsconfig.json -o \
    -name go.mod -o \
    -name requirements.txt -o \
    -name pyproject.toml -o \
    -name '*.db' -o \
    -name '*.sqlite' \
  \) -print -quit)"
  if [ -n "$forbidden_marker" ]; then
    printf 'workspace-skill: domain implementation belongs under modules/, found: %s\n' "$forbidden_marker" >&2
    exit 1
  fi
  for forbidden_dir in src schemas data migrations; do
    if [ -d "$skill_dir/$forbidden_dir" ]; then
      printf 'workspace-skill: domain-owned directory belongs under modules/: %s/%s\n' "$skill_dir" "$forbidden_dir" >&2
      exit 1
    fi
  done
done

printf 'workspace skills ok: %s\n' "$skill_count"
