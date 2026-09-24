# shellcheck shell=bash
# Reads the ordered chain's sealed feature union from the chain script's own definition, so every
# consumer compiles exactly what the chain compiles and none keeps a second copy that could drift.
#
# Usage: source this file, then `sealed_feature_union <chain script>`; the union is printed on stdout.
# It parses the two definitions exactly instead of evaluating them: when the chain restructures how it
# spells its union, this fails and says so, and never falls back to a partial or stale value.

sealed_feature_union() {
  local chain_script="$1"
  local archive_features=""
  local schema_features=""
  local line

  while IFS= read -r line; do
    if [[ "$line" =~ ^readonly\ nextest_archive_features=\'([^\']+)\'$ ]]; then
      if [ -n "$archive_features" ]; then
        echo "ERROR: $chain_script defines nextest_archive_features twice." >&2
        return 1
      fi
      archive_features="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^readonly\ schema_materialization_features=\"\$\{nextest_archive_features\},([^\"]+)\"$ ]]; then
      if [ -n "$schema_features" ]; then
        echo "ERROR: $chain_script defines schema_materialization_features twice." >&2
        return 1
      fi
      schema_features="${BASH_REMATCH[1]}"
    fi
  done < "$chain_script"

  if [ -z "$archive_features" ] || [ -z "$schema_features" ]; then
    echo "ERROR: could not read the sealed feature union from $chain_script." >&2
    echo "       Expected 'readonly nextest_archive_features='...'' and" >&2
    echo "       'readonly schema_materialization_features=\"\${nextest_archive_features},...\"'." >&2
    echo "       Update the reader where the chain now spells its union; do not copy it." >&2
    return 1
  fi
  # The schema materialization build is the widest graph the chain compiles.
  printf '%s\n' "$archive_features,$schema_features"
}
