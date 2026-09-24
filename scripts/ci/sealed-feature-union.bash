# shellcheck shell=bash
# Reads the ordered chain's sealed feature union from the chain script's own definition, so every
# consumer compiles exactly what the chain compiles and none keeps a second copy that could drift.
#
# Usage: source this file, then `sealed_feature_union <chain script>`; the union is printed on stdout.
# It parses the definition exactly instead of evaluating it: when the chain restructures how it
# spells its union, this fails and says so, and never falls back to a partial or stale value.
#
# The chain builds one graph: its nextest archive, whose own rd-owner-api binary also materializes
# the schema. So the archive's feature set is the whole union. The chain's --check keeps that true
# by requiring the archive's features to imply what the materializer needs. A second, separately
# spelled union would mean the chain builds a second graph again, and this reader would then
# under-report it - so finding one is an error, not something to skip.

sealed_feature_union() {
  local chain_script="$1"
  local archive_features=""
  local line

  while IFS= read -r line; do
    if [[ "$line" =~ ^readonly\ nextest_archive_features=\'([^\']+)\'$ ]]; then
      if [ -n "$archive_features" ]; then
        echo "ERROR: $chain_script defines nextest_archive_features twice." >&2
        return 1
      fi
      archive_features="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^readonly\ schema_materialization_features= ]]; then
      echo "ERROR: $chain_script spells a separate schema_materialization_features union again." >&2
      echo "       This reader takes the archive's features as the whole union; teach it the second" >&2
      echo "       graph before relying on it, or the union it prints will be too narrow." >&2
      return 1
    fi
  done < "$chain_script"

  if [ -z "$archive_features" ]; then
    echo "ERROR: could not read the sealed feature union from $chain_script." >&2
    echo "       Expected 'readonly nextest_archive_features='...''." >&2
    echo "       Update the reader where the chain now spells its union; do not copy it." >&2
    return 1
  fi
  printf '%s\n' "$archive_features"
}
