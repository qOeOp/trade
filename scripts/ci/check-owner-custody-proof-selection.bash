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

# Fail closed. Skipping on a missing dependency made this check silently pass: it
# printed a WARNING and exited 0, and pre-commit does not echo the output of a hook
# that passes, so "ran and passed" and "could not run" were byte-identical on CI.
# The ordered chain script depends on `rg` unconditionally, so today the runner does
# have ripgrep and this check really runs - but that is a property of the runner
# image, not of this script, and it must not be the reason the check has teeth.
if ! command -v rg &> /dev/null; then
  echo "check-owner-custody-proof-selection: ripgrep (rg) is required but was not found." >&2
  echo "       This check decides which #[ignore] tests count as Owner custody proofs;" >&2
  echo "       skipping it would let an unselected proof reach main unreported." >&2
  exit 1
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
  crates/execution_owner
  crates/portfolio_owner
  crates/strategy_governance
  crates/scanner_custody
)

# Proofs no chain selects, each with the reason it stays out. Adding a name here is a decision that
# the next reader can audit; leaving one out fails this check.
readonly -A unselected_reason=(
  ["a_retry_reads_the_committed_admission_back_and_a_changed_request_conflicts"]="the only durable admission proof that needs a Product Edge admission, and its bootstrap raises a genesis under a fresh deployment identity. That is right for a private store and wrong for the chain's shared one, where a genesis already exists: the admission is written under one deployment and resolved under another, and the Owner reports it unavailable. The gap is the missing iteration-result Product Edge seam, whose operation, effect and schema constants still have no production consumer"
  ["every_relational_scalar_is_bound_and_rollback_restores_exact_readback"]="uses DedicatedPostgresTestDatabase, whose marker validation requires every role to be named vibe_test_role_*. That is the dedicated per-Owner harness naming (crates/data/tests/run_market_data_owner_postgres.bash creates vibe_test_role_market_data_owner); the ordered chain exports its canonical role names, so admission refuses with ExpectedIdentityMismatch before the proof runs. Joining this chain would need both a canonical topology and no materialization, since that store is past the cutover"
  ["v2_census_append_restart_readback_and_fail_close_are_atomic"]="uses DedicatedPostgresTestDatabase, whose marker validation requires every role to be named vibe_test_role_*. That is the dedicated per-Owner harness naming (crates/data/tests/run_market_data_owner_postgres.bash creates vibe_test_role_market_data_owner); the ordered chain exports its canonical role names, so admission refuses with ExpectedIdentityMismatch before the proof runs. Joining this chain would need both a canonical topology and no materialization, since that store is past the cutover"
  ["postgres_v2_resolve_uses_exclusive_owner_validity_cut"]="uses DedicatedPostgresTestDatabase, whose marker validation requires every role to be named vibe_test_role_*. That is the dedicated per-Owner harness naming (crates/data/tests/run_market_data_owner_postgres.bash creates vibe_test_role_market_data_owner); the ordered chain exports its canonical role names, so admission refuses with ExpectedIdentityMismatch before the proof runs. Joining this chain would need both a canonical topology and no materialization, since that store is past the cutover"
  ["qualification_basis_cannot_terminalize_after_authority_revocation"]="makes the Qualification store unavailable by dropping its relations, which requires owning them. the qualification_owner role owns them and the chain admits qualification_writer, so the drop refuses with 'must be owner of table qualification_owner_outbox_v1' before the proof reaches its subject. Joining this chain needs a qualification_owner principal, or a way to withdraw the store that a writer holds"
  ["qualification_basis_recovers_under_immediate_policy_equivalent_successor"]="makes the Qualification store unavailable by dropping its relations, which requires owning them. the qualification_owner role owns them and the chain admits qualification_writer, so the drop refuses with 'must be owner of table qualification_owner_outbox_v1' before the proof reaches its subject. Joining this chain needs a qualification_owner principal, or a way to withdraw the store that a writer holds"
  ["committed_basis_cannot_terminalize_after_original_authority_expires"]="makes the Qualification store unavailable by dropping its relations, which requires owning them. the qualification_owner role owns them and the chain admits qualification_writer, so the drop refuses with 'must be owner of table qualification_owner_outbox_v1' before the proof reaches its subject. Joining this chain needs a qualification_owner principal, or a way to withdraw the store that a writer holds"
  ["readback_accepts_only_declared_exact_acl_topologies"]="requires RD_SCHEMA_READBACK_ACL_TEST_DATABASE_URL, a database whose connecting role may CREATE in public, and a role rd_schema_reader; no workflow, Makefile or script provides any of them, and the ordered chain clones its databases after the cutover that revokes CREATE"
  ["migration_materializes_private_runtime_kernel_request_custody"]="materializes as rd_owner, which the ordered chain's store refuses past the cutover by design; nothing wires this migrate into the materializer and nothing composes a runtime-kernel native repair request, so no admitted store carries the relation it would verify. The unwired module is a recorded finding, not a table to add here"
  ["actual_dataset_recovers_into_fresh_derived_catalogs"]="requires the separately downloaded frozen 2023 USD-M and PAXG Spot datasets; no workflow, Makefile or script provides it"
  ["actual_dual_tsmom_family_recovers_exact_terminal_receipt"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["actual_pairs_family_recovers_exact_terminal_receipt"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["actual_representative_family_recovers_exact_terminal_receipt"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["actual_representative_program_control_recovers_exact_receipt"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["actual_secac_formation_recovers_exact_without_claiming_holdout"]="requires exact 2023 Formation inputs plus intact unclaimed 2024 custody; no workflow, Makefile or script provides it"
  ["authenticates_frozen_representative_dataset_2023"]="requires the separately downloaded frozen 2023 USD-M dataset; no workflow, Makefile or script provides it"
  ["catalog_rule_injection_is_unavailable_and_writes_nothing"]="needs the catalog-admin route, which the chain grants by test name and whose routing its own check pins. With the default route it refuses 42501 permission denied for schema replay_policy_catalog_private"
  ["catalog_unlogged_drift_is_unavailable_to_migration_and_runtime"]="needs the catalog-admin route, which the chain grants by test name and whose routing its own check pins. With the default route it refuses 42501 permission denied for schema replay_policy_catalog_private"
  ["catalog_v3_admin_restart_tamper_and_acl_are_fail_closed"]="needs the catalog-admin route, which the chain grants by test name and whose routing its own check pins. With the default route it refuses 42501 permission denied for schema replay_policy_catalog_private"
  ["composer_unlogged_drift_is_unavailable_to_migration_and_runtime"]="needs sealed-source-intake-composer-acceptance, which the chain cannot simply add: the feature changes what the API materializes, and the chain refuses the result with 'rd_research_view_transitions_v3 has incompatible custody or relation options'. These four need their own provisioning, not a wider union"
  ["exact_complex_cache_executes_program_family_path_reproducibly"]="requires the separately downloaded exact 24-month Binance Vision cache; no workflow, Makefile or script provides it"
  ["exact_pilot_cache_executes_native_family_path"]="requires the separately downloaded exact 24-month Binance Vision cache; no workflow, Makefile or script provides it"
  ["forged_v3_admission_fails_without_replay_transition_or_outbox_write"]="needs sealed-source-intake-composer-acceptance, which the chain cannot simply add: the feature changes what the API materializes, and the chain refuses the result with 'rd_research_view_transitions_v3 has incompatible custody or relation options'. These four need their own provisioning, not a wider union"
  ["live_bounded_pit_probe_stops_on_cost_or_returns_authentic_evidence"]="live vendor probe; no workflow wires DATABENTO_API_KEY. It passes against the real vendor: one run downloads BBO and Definition for 0.000184 USD under a 0.05 USD ceiling"
  ["live_probe_answers_the_owner_scope_or_refuses"]="live vendor probe; no workflow wires DATABENTO_API_KEY. It passes locally, though on the refusal branch rather than the answering one"
  ["market_data_answers_one_frozen_request_from_live_vendor_data"]="live vendor probe; needs DATABENTO_API_KEY and MARKET_DATA_OWNER_DATABASE_URL on a store whose market_data_private schema already exists. It passes that way: twelve seconds against real vendor data"
  ["measure_admission_cost_by_program_size"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["official_holdout_integrity_probe_is_deterministic"]="requires the separately custodied official 2024 source bundle; no workflow, Makefile or script provides it"
  ["postgres_every_transaction_write_boundary_fault_leaves_zero_positive_rows"]="needs sealed-source-intake-composer-acceptance, which the chain cannot simply add: the feature changes what the API materializes, and the chain refuses the result with 'rd_research_view_transitions_v3 has incompatible custody or relation options'. These four need their own provisioning, not a wider union"
  ["regenerate_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["regenerate_source_research_composer_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["representative_coordinates_share_read_only_catalog_and_reproduce_fresh"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["sealed_run_and_restarted_resolve_return_the_same_public_receipt"]="needs sealed-source-intake-composer-acceptance, which the chain cannot simply add: the feature changes what the API materializes, and the chain refuses the result with 'rd_research_view_transitions_v3 has incompatible custody or relation options'. These four need their own provisioning, not a wider union"
  ["two_lowerings_two_builds_and_strict_replay_mint_one_v3_identity"]="builds through the sandbox, which verifies the frozen Linux target sysroot; docs/owners/rd.md holds that freeze until a fresh hosted A0 readback"
  ["stale_artifact_policy_reaches_real_owner_chain_and_cannot_open_risk"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
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

# The toolchain proof script lists each name as a quoted string, one selector per entry.
if [ -f scripts/ci/test-toolchain-proofs.bash ]; then
  rg -o "'[a-z_0-9]+(::[a-z_0-9]+)*'" scripts/ci/test-toolchain-proofs.bash 2> /dev/null |
    sed "s/'//g;s/.*:://" >> "$selected" || true
fi

# A path here that no longer exists would narrow what counts as "selected" without saying so.
# That errs toward noise rather than silence - proofs those scripts select would start looking
# unselected - but the noise would be blamed on the proofs, not on the renamed script.
for script in crates/data/tests/run_market_data_owner_postgres.bash \
  scripts/ci/test-qualification-owner-recovery-postgres.bash; do
  if [ ! -f "$script" ]; then
    echo "ERROR: the selection source '$script' does not exist." >&2
    echo "       Every proof it lists would start reporting as unselected, and the error would" >&2
    echo "       name those proofs rather than this path. Update the path or drop it here." >&2
    exit 1
  fi
  rg -o '^[[:space:]]*[a-z_0-9]+(::[a-z_0-9]+)+[[:space:]]*\\?$' "$script" 2> /dev/null |
    sed 's/[[:space:]]*\\*$//;s/^[[:space:]]*//;s/.*:://' >> "$selected" || true
done
sort -u -o "$selected" "$selected"

# An exemption for a proof that IS selected is never consulted: the loop below checks selection
# first and moves on. So the reason it carries is never read, never re-examined, and stays true or
# becomes false with nothing to tell them apart. That is the same silence this check exists to
# refuse, one level in: a reason nobody reads is indistinguishable from no reason at all.
#
# `real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact` is the case that
# prompted this. Its exemption says the proof compiles only on aarch64 while the job running the
# wasm proofs is x86_64; `scripts/ci/test-toolchain-proofs.bash` lists it in
# `admitted_host_wasm_proofs`, whose own comment names Linux x86_64 among the admitted hosts. The
# proof runs. The reason was false and unreachable, and neither fact could surface on its own.
stale_exemptions=()
for proof in "${!unselected_reason[@]}"; do
  if grep -qxF "$proof" "$selected"; then
    stale_exemptions+=("$proof")
  fi
done
if [ "${#stale_exemptions[@]}" -gt 0 ]; then
  printf 'ERROR: these proofs carry a reason for staying out of the chains, and are selected anyway:\n' >&2
  for proof in "${stale_exemptions[@]}"; do
    printf "       %s\n" "$proof" >&2
  done
  printf '       The reason is never read, so it cannot be relied on and cannot be corrected.\n' >&2
  printf '       Remove the entry; selection is the record that it runs.\n' >&2
  exit 1
fi

violations=0

# `owner_crates` is a hand-written list, and a path that does not exist used to be skipped in
# silence: the crate's proofs were never read, and this check still reported success. A typo, a
# crate that moved, or a rename therefore removed a whole Owner from the check without any
# output changing - the same shape this check exists to refuse, one level up.
for crate in "${owner_crates[@]}"; do
  if [ ! -d "$crate" ]; then
    echo "ERROR: owner_crates lists '$crate', which does not exist." >&2
    echo "       Its custody proofs would not be read at all and this check would still pass." >&2
    echo "       Fix the path, or remove the entry if that Owner is gone." >&2
    exit 1
  fi
  if [ ! -f "$crate/Cargo.toml" ]; then
    echo "ERROR: owner_crates lists '$crate', which is not a crate root." >&2
    echo "       Without a Cargo.toml its tests are not a package the chains can select by name." >&2
    exit 1
  fi

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
    #
    # The character class before `fn` admits `:` and `-` as well as whitespace, because a proof
    # declared at column 0 - one that is not nested inside a `mod` block - has no whitespace there.
    # What precedes it is `rg`'s own prefix, `path:LINE:` on the matched line and `path-LINE-` on a
    # context line. Requiring whitespace therefore made indentation decide whether this check could
    # see a proof at all, and nine of the 119 ignored proofs in the Owner crates were invisible to
    # it, including the first entry of the Market Data chain leg. None of the nine is presently
    # unselected, so this widening keeps the check green while giving it the teeth it claims: an
    # unselected top-level proof used to pass in silence.
    rg -n -A4 '#\[ignore' "$crate" --type rust 2> /dev/null |
      awk '
        /^--$/ { taken = 0; next }
        /#\[ignore/ {
          # Prose that names the attribute is not the attribute. A comment mentioning `#[ignore]`
          # opens a four-line window like a real one, and the next `fn` in it was reported as an
          # unselected proof even when that function is not ignored at all. Consuming the window
          # rather than skipping the line is what suppresses it: skipping would leave the
          # following `fn` to be taken by the untaken-window rule below, which is the bug.
          if (substr($0, 1, index($0, "#[ignore") - 1) ~ /\/\//) { taken = 1; next }
          taken = 0
          next
        }
        !taken && /[[:space:]:-]fn [a-z_0-9]+/ {
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
