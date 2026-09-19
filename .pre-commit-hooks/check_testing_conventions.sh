#!/usr/bin/env bash
# Enforces testing conventions:
# 1. Rust: Prefer #[rstest] over #[test] for consistency and parametrization support
# 2. Python: Do not probe PyO3 panic paths in process with pytest.raises(BaseException)

set -euo pipefail

HOOK_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$HOOK_DIR/.." && pwd -P)
readonly FROZEN_SOURCE_PATH="crates/strategy_factory/src/bounded_feature_program_lowerer_v1.rs"
bash "$HOOK_DIR/check_frozen_source_convention_baseline.sh" "$REPO_ROOT"

# Color output
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Track if we found violations
VIOLATIONS=0

################################################################################
# Check for ripgrep availability
################################################################################

if ! command -v rg &> /dev/null; then
  echo -e "${YELLOW}WARNING: ripgrep (rg) not found, skipping testing convention checks${NC}"
  echo "Install ripgrep to enable this check: https://github.com/BurntSushi/ripgrep"
  exit 0
fi

################################################################################
# Check Rust files for #[test] instead of #[rstest]
################################################################################

echo "Checking Rust testing conventions..."

# Create temporary files to store search results
rust_results=$(mktemp)
aaa_results=$(mktemp)
python_results=$(mktemp)
trap 'rm -f "$rust_results" "$aaa_results" "$python_results" "$scheduler_results"' EXIT

# Search for #[test] attribute in Rust files
# We want to find standalone #[test], not #[tokio::test] or #[rstest]
# Pattern: lines with #[test] but not #[test(...)] or #[tokio::test] or followed by #[rstest]
rg -n --glob "!$FROZEN_SOURCE_PATH" '^\s*#\[test\]' crates --type rust 2> /dev/null > "$rust_results" || true

while IFS=: read -r file line_num line_content; do
  # Skip empty lines
  [[ -z "$file" ]] && continue

  # Trim leading whitespace from line for display
  trimmed_line="${line_content#"${line_content%%[![:space:]]*}"}"

  echo -e "${RED}Error:${NC} Found #[test] instead of #[rstest] in $file:$line_num"
  echo "  Found: $trimmed_line"
  echo "  Expected: #[rstest]"
  echo "  Reason: Use #[rstest] for consistency and parametrization support"
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
done < "$rust_results"

################################################################################
# Check Rust files for AAA-style comments (Arrange/Act/Assert)
# These are Python conventions and should not be used in Rust tests
################################################################################

echo "Checking for AAA-style comments in Rust tests..."

# Search for // Arrange, // Act, // Assert comments (standalone or with trailing content)
# Pattern: lines starting with whitespace, then // followed by Arrange, Act, or Assert
# We look for the standalone markers, not comments that happen to contain these words in context
rg -n --glob "!$FROZEN_SOURCE_PATH" '^\s*//\s*(Arrange|Act|Assert)\s*($|:|\s*-)' crates --type rust 2> /dev/null > "$aaa_results" || true

while IFS=: read -r file line_num line_content; do
  # Skip empty lines
  [[ -z "$file" ]] && continue

  # Trim leading whitespace from line for display
  trimmed_line="${line_content#"${line_content%%[![:space:]]*}"}"

  echo -e "${RED}Error:${NC} Found AAA-style comment in $file:$line_num"
  echo "  Found: $trimmed_line"
  echo "  Reason: Arrange/Act/Assert comments are a Python convention, not used in Rust tests"
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
done < "$aaa_results"

################################################################################
# Check Python tests for broad BaseException panic probes
################################################################################

echo "Checking Python testing conventions..."

rg -n 'pytest\.raises\(BaseException' python/tests --type py 2> /dev/null > "$python_results" || true

while IFS=: read -r file line_num line_content; do
  [[ -z "$file" ]] && continue

  trimmed_line="${line_content#"${line_content%%[![:space:]]*}"}"

  echo -e "${RED}Error:${NC} Found broad BaseException probe in $file:$line_num"
  echo "  Found: $trimmed_line"
  echo "  Reason: PyO3 panic paths can pass in debug and abort the interpreter in release"
  echo "  Use: signature checks, specific Python exceptions, or subprocess isolation"
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
done < "$python_results"

################################################################################
# Check Rust concurrency proofs for scheduler-dependent assertions
################################################################################

echo "Checking Rust concurrency proof conventions..."

scheduler_results=$(mktemp)
for rust_file in $(rg -l 'is_finished\(\)' --glob '*.rs' . 2> /dev/null || true); do
  awk -v path="$rust_file" '
    { line[NR] = $0 }
    /#\[tokio::test/ { paused = ($0 ~ /start_paused/) ? 1 : 0 }
    /assert!\(![A-Za-z_][A-Za-z0-9_]*\.is_finished\(\)\)/ {
      if (paused) next
      observed = 0
      for (i = NR - 15; i < NR; i++) {
        if (i < 1) continue
        if (line[i] ~ /wait_for_[a-z_]*lock|pg_stat_activity|NOWAIT|recv\(\)|_receiver|advance\(/) observed = 1
      }
      if (!observed && (line[NR-1] ~ /yield_now\(\)\.await;/ || line[NR-1] ~ /sleep\(.*\)\.await;/)) {
        sub(/^[ \t]+/, "", $0)
        printf "%s:%d:%s\n", path, NR, $0
      }
    }
  ' "$rust_file" >> "$scheduler_results"
done

while IFS=: read -r file line_num line_content; do
  [[ -z "$file" ]] && continue

  echo -e "${RED}Error:${NC} Found scheduler-dependent concurrency assertion in $file:$line_num"
  echo "  Found: $line_content"
  echo "  Reason: after a bare yield or a fixed sleep, whether the other task reached its"
  echo "          blocking point is the scheduler's choice. A slower machine turns this red"
  echo "          and a faster one turns it green, so it is not evidence either way"
  echo "  Use: observe the real condition first, then assert"
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
done < "$scheduler_results"

################################################################################
# Report results
################################################################################

if [ $VIOLATIONS -gt 0 ]; then
  echo -e "${RED}Found $VIOLATIONS testing convention violation(s)${NC}"
  echo
  echo "Convention:"
  echo "  - Rust: Use #[rstest] instead of #[test] for consistency"
  echo "  - #[tokio::test] is acceptable for async tests without parametrization"
  echo "  - Do not use // Arrange / // Act / // Assert comments in Rust tests (Python convention)"
  echo "  - Python: Do not use pytest.raises(BaseException) in python/tests/ to probe PyO3 panic paths"
  echo "  - Rust: do not assert a task is unfinished after only a yield or a fixed sleep"
  echo
  echo "To fix:"
  echo "  - Replace #[test] with #[rstest] in your test functions"
  echo "  - Remove AAA-style comments or convert them to descriptive comments"
  echo "  - Replace broad BaseException probes with signature checks or subprocess-isolated tests"
  echo "  - Wait on the condition itself: a lock queue via pg_stat_activity, a NOWAIT probe, a"
  echo "    channel the test controls, or a paused clock advanced with tokio::time::advance"
  exit 1
fi

echo "All testing conventions are valid"
exit 0
