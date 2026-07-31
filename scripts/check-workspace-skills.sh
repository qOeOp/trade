#!/usr/bin/env sh

set -eu
unset RIPGREP_CONFIG_PATH

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

skills_root=.agents/skills
[ -d "$skills_root" ] || exit 0

check_mission_role() {
  role_file=$1
  expected_name=$2

  if [ ! -f "$role_file" ]; then
    printf 'workspace-skill: role %s file %s field file: required role locator is missing\n' \
      "$expected_name" "$role_file" >&2
    return 1
  fi

  awk -v role="$expected_name" -v file="$role_file" '
    function fail(field, message) {
      printf "workspace-skill: role %s file %s field %s: %s\n", role, file, field, message > "/dev/stderr"
      failed = 1
    }

    {
      if (preamble_ended) {
        next
      }
      if ($0 ~ /^[[:space:]]*\[/ || index($0, "\"\"\"") || index($0, "\047\047\047")) {
        preamble_ended = 1
        next
      }
      if ($0 ~ /^[[:space:]]*name[[:space:]]*=/) {
        name_count++
        if ($0 != "name = \"" role "\"") {
          name_exact = 0
        } else {
          name_exact = 1
        }
      }
      if ($0 ~ /^[[:space:]]*sandbox_mode[[:space:]]*=/) {
        sandbox_count++
        if ($0 != "sandbox_mode = \"read-only\"") {
          sandbox_exact = 0
        } else {
          sandbox_exact = 1
        }
      }
    }

    END {
      if (name_count == 0) {
        fail("name", "exact canonical assignment is required before any table or multiline string")
      } else if (name_count != 1) {
        fail("name", "exact canonical assignment must be unique")
      } else if (!name_exact) {
        fail("name", "expected exact canonical value " role)
      }

      if (sandbox_count == 0) {
        fail("sandbox_mode", "exact canonical assignment is required before any table or multiline string")
      } else if (sandbox_count != 1) {
        fail("sandbox_mode", "exact canonical assignment must be unique")
      } else if (!sandbox_exact) {
        fail("sandbox_mode", "expected exact canonical value read-only")
      }

      exit failed
    }
  ' "$role_file"
}

if [ -f "$skills_root/run-bounded-mission/SKILL.md" ]; then
  check_mission_role .codex/agents/mission-researcher.toml mission_researcher
  check_mission_role .codex/agents/mission-planner.toml mission_planner
  check_mission_role .codex/agents/mission-evaluator.toml mission_evaluator
fi

typescript_compiler=node_modules/.bin/tsc
if [ ! -x "$typescript_compiler" ]; then
  printf 'workspace-skill: TypeScript compiler is required: %s\n' "$typescript_compiler" >&2
  exit 1
fi
"$typescript_compiler" --project .agents/tsconfig.json

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
    printf 'workspace-skill: domain implementation belongs under apps/, found: %s\n' "$forbidden_marker" >&2
    exit 1
  fi
  for forbidden_dir in src schemas data migrations; do
    if [ -d "$skill_dir/$forbidden_dir" ]; then
      printf 'workspace-skill: domain-owned directory belongs under apps/: %s/%s\n' "$skill_dir" "$forbidden_dir" >&2
      exit 1
    fi
  done
  for test_file in "$skill_dir"/scripts/*.test.ts; do
    [ -f "$test_file" ] || continue
    if ! command -v bun >/dev/null 2>&1; then
      printf 'workspace-skill: bun is required for helper tests: %s\n' "$test_file" >&2
      exit 1
    fi
    bun test "./$test_file" >/dev/null
  done
done

printf 'workspace skills ok: %s\n' "$skill_count"
