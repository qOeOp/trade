#!/usr/bin/env bash

# Every Owner custody proof must be selected by a chain, or say why it is not.
#
# An `#[ignore]` test is invisible to `make cargo-test`: only the isolated PostgreSQL chains select
# ignored tests, and only by exact name. A proof that no chain lists therefore never runs, while the
# document it backs keeps claiming the capability. That is how a lowering recorded as CURRENT_PARTIAL
# came to emit source that could not compile - the three tests that would have caught it were all
# ignored and none was listed.
#
# This check does not decide which proofs belong in a chain. It only refuses silence: an unselected
# proof must carry a reason in the exemption table below, so the next reader sees a decision rather
# than an oversight.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "ERROR: owner custody proof selection check requires one repository root" >&2
  exit 1
fi

repository_root="$1"
cd "$repository_root"

if ! command -v rg &> /dev/null; then
  echo "WARNING: ripgrep not found, skipping owner custody proof selection check"
  exit 0
fi

# Crates whose `#[ignore]` tests are Owner custody proofs. Adapter, risk, execution and persistence
# crates are deliberately absent: their ignored tests assert exchange behaviour against live
# credentials or frozen datasets, not Owner custody.
readonly owner_crates=(
  crates/strategy_factory
  crates/strategy_factory_rd_owner_api
  crates/data
  crates/product_edge
  crates/operator_authorization
  crates/backtest_owner
  crates/qualification
)

# Proofs no chain selects, each with the reason it stays out. Adding a name here is a decision that
# the next reader can audit; leaving one out fails this check.
readonly -A unselected_reason=(
  ["actual_dataset_recovers_into_fresh_derived_catalogs"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["actual_dual_tsmom_family_recovers_exact_terminal_receipt"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["actual_pairs_family_recovers_exact_terminal_receipt"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["actual_representative_family_recovers_exact_terminal_receipt"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["actual_representative_program_control_recovers_exact_receipt"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["actual_secac_formation_recovers_exact_without_claiming_holdout"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["authenticates_frozen_representative_dataset_2023"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["catalog_rule_injection_is_unavailable_and_writes_nothing"]="replay policy catalog V3 is TARGET / NOT_ADMITTED in docs/owners/rd.md"
  ["catalog_unlogged_drift_is_unavailable_to_migration_and_runtime"]="replay policy catalog V3 is TARGET / NOT_ADMITTED in docs/owners/rd.md"
  ["catalog_v3_admin_restart_tamper_and_acl_are_fail_closed"]="replay policy catalog V3 is TARGET / NOT_ADMITTED in docs/owners/rd.md"
  ["composer_unlogged_drift_is_unavailable_to_migration_and_runtime"]="needs sealed-source-intake-composer-acceptance, which the chain's archive does not enable"
  ["exact_complex_cache_executes_program_family_path_reproducibly"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["exact_pilot_cache_executes_native_family_path"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["forged_v3_admission_fails_without_replay_transition_or_outbox_write"]="needs sealed-source-intake-composer-acceptance, which the chain's archive does not enable"
  ["live_bounded_pit_probe_stops_on_cost_or_returns_authentic_evidence"]="live vendor probe; needs a real vendor request and its credential"
  ["live_probe_answers_the_owner_scope_or_refuses"]="live vendor probe; needs a real vendor request and its credential"
  ["market_data_answers_one_frozen_request_from_live_vendor_data"]="live vendor probe; needs a real vendor request and its credential"
  ["materially_different_external_project_is_artifact_only_and_exactly_recoverable"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["measure_admission_cost_by_program_size"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["official_holdout_integrity_probe_is_deterministic"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["postgres_v4_is_atomic_idempotent_exact_and_tamper_closed"]="broken: it commits a second sample for a second role, but the fact identity covers what was observed and not who asked, so the Owner refuses it as IdentityConflict; its batch offers no second observable fact"
  ["postgres_every_transaction_write_boundary_fault_leaves_zero_positive_rows"]="needs sealed-source-intake-composer-acceptance, which the chain's archive does not enable"
  ["real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact"]="compiled only on aarch64; the job that runs the wasm proofs is x86_64 and the aarch64 jobs build without running tests"
  ["regenerate_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["regenerate_source_research_composer_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["representative_coordinates_share_read_only_catalog_and_reproduce_fresh"]="frozen external dataset; the chain provisions a database, not a corpus"
  ["sealed_run_and_restarted_resolve_return_the_same_public_receipt"]="needs sealed-source-intake-composer-acceptance, which the chain's archive does not enable"
  ["two_lowerings_two_builds_and_strict_replay_mint_one_v3_identity"]="builds through the sandbox, which verifies the frozen Linux target sysroot; docs/owners/rd.md holds that freeze until a fresh hosted A0 readback"
  ["stale_artifact_policy_reaches_real_owner_chain_and_cannot_open_risk"]="frozen external dataset; the chain provisions a database, not a corpus"
)

echo "Checking that every Owner custody proof is selected or explained..."

selected=$(mktemp)
trap 'rm -f "$selected"' EXIT

# Read what each chain actually selects, not merely what its text mentions. A name that survives
# only in a positional assertion or a comment selects nothing.
if [ -f scripts/ci/test-rd-owner-postgres.bash ]; then
  awk '
    /^readonly rd_owner_postgres_tests=\(/ { inside = 1; next }
    inside && /^\)/ { inside = 0 }
    inside && /^[[:space:]]*'"'"'/ {
      gsub(/^[[:space:]]*'"'"'|'"'"'[[:space:]]*$/, "")
      n = split($0, field, "|")
      name = field[n]
      sub(/.*::/, "", name)
      print name
    }
  ' scripts/ci/test-rd-owner-postgres.bash >> "$selected"
  rg -o "seed_test='[a-z_0-9:]+'" scripts/ci/test-rd-owner-postgres.bash 2> /dev/null |
    sed "s/.*:://;s/'//" >> "$selected" || true
fi

# The wasm proof script lists each name as a quoted array entry, one selector per entry.
if [ -f scripts/ci/test-wasm-toolchain-proofs.bash ]; then
  rg -o "^[[:space:]]*'[a-z_0-9]+(::[a-z_0-9]+)+'$" scripts/ci/test-wasm-toolchain-proofs.bash 2> /dev/null |
    sed "s/[[:space:]]*//g;s/'//g;s/.*:://" >> "$selected" || true
fi

for script in crates/data/tests/run_market_data_owner_postgres.bash \
  scripts/ci/test-qualification-owner-recovery-postgres.bash; do
  [ -f "$script" ] || continue
  rg -o '^[[:space:]]*[a-z_0-9]+(::[a-z_0-9]+)+[[:space:]]*\\?$' "$script" 2> /dev/null |
    sed 's/[[:space:]]*\\*$//;s/^[[:space:]]*//;s/.*:://' >> "$selected" || true
done
sort -u -o "$selected" "$selected"

violations=0

for crate in "${owner_crates[@]}"; do
  [ -d "$crate" ] || continue

  while read -r proof; do
    [ -n "$proof" ] || continue
    if grep -qxF "$proof" "$selected"; then
      continue
    fi
    if [ -n "${unselected_reason[$proof]:-}" ]; then
      continue
    fi
    echo "ERROR: no chain selects the Owner custody proof '$proof'," >&2
    echo "       and it carries no reason in check-owner-custody-proof-selection.bash." >&2
    echo "       List it in a chain, or record why it stays out." >&2
    violations=$((violations + 1))
  done < <(
    # Only the first `fn` after each attribute is the proof; a later one is a helper nested
    # inside its body.
    rg -n -A4 '#\[ignore' "$crate" --type rust 2> /dev/null |
      awk '
        /^--$/ { taken = 0; next }
        /#\[ignore/ { taken = 0; next }
        !taken && /[[:space:]]fn [a-z_0-9]+/ {
          match($0, /fn [a-z_0-9]+/)
          print substr($0, RSTART + 3, RLENGTH - 3)
          taken = 1
        }
      ' |
      sort -u
  )
done

if [ "$violations" -gt 0 ]; then
  echo "Found $violations unexplained Owner custody proof(s)" >&2
  exit 1
fi

echo "Every Owner custody proof is selected by a chain or carries its reason"
