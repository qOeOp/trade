#!/usr/bin/env bash
# Enforces testing conventions:
# 1. Rust: Prefer #[rstest] over #[test] for consistency and parametrization support
# 2. Python: Do not probe PyO3 panic paths in process with pytest.raises(BaseException)

set -Eeuo pipefail
trap 'echo "$(basename "${BASH_SOURCE[0]}"):${LINENO}: this check failed: ${BASH_COMMAND}" >&2' ERR

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
# Check Rust concurrency proofs for scheduler-dependent assertions
################################################################################

echo "Checking Rust concurrency proof conventions..."

scheduler_results=$(mktemp)
# grep, not ripgrep: this guard's whole purpose is catching a check that goes
# quiet when it should speak, so its own file discovery must not depend on a
# tool that may be absent. Verified equivalent to the ripgrep form against two
# patterns that actually match, not only against a zero-match case.
while IFS= read -r rust_file; do
  awk -v path="$rust_file" '
    { line[NR] = $0 }
    # Attributes bind to the item that follows them, so collect them and decide
    # at the fn. Deciding at the attribute would leak one paused-clock test
    # exemption into every function after it, and the lookback below would leak
    # that test evidence the same way; both are bounded to the enclosing fn.
    /^[[:space:]]*#\[/ { attrs = attrs $0; collecting = 1; next }
    /^[[:space:]]*(pub[[:space:]]+)?(async[[:space:]]+)?fn[[:space:]]/ {
      paused = (attrs ~ /start_paused/) ? 1 : 0
      attrs = ""; collecting = 0; fn_start = NR
    }
    collecting && $0 !~ /^[[:space:]]*$/ { attrs = ""; collecting = 0 }
    /assert!\(![A-Za-z_][A-Za-z0-9_]*\.is_finished\(\)\)/ {
      if (paused) next
      from = NR - 15
      if (from < fn_start) from = fn_start
      if (from < 1) from = 1
      observed = 0
      for (i = from; i < NR; i++) {
        if (line[i] ~ /wait_for_[a-z_]*lock|pg_stat_activity|NOWAIT|recv\(\)|_receiver|advance\(/) observed = 1
      }
      if (!observed && (line[NR-1] ~ /yield_now\(\)\.await;/ || line[NR-1] ~ /sleep\(.*\)\.await;/)) {
        sub(/^[ \t]+/, "", $0)
        printf "%s:%d:%s\n", path, NR, $0
      }
    }
  ' "$rust_file" >> "$scheduler_results"
done < <(grep -rl --include='*.rs' --exclude-dir=.git --exclude-dir=target --exclude-dir=node_modules 'is_finished()' . || true)

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
# Check for ripgrep availability
################################################################################

if ! command -v rg &> /dev/null; then
  echo -e "${YELLOW}WARNING: ripgrep (rg) not found, skipping the ripgrep-based testing convention checks${NC}"
  echo "Install ripgrep to enable them: https://github.com/BurntSushi/ripgrep"
  if [ $VIOLATIONS -gt 0 ]; then
    echo -e "${RED}Found $VIOLATIONS testing convention violation(s)${NC}"
    exit 1
  fi
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
