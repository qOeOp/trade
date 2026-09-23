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

set -Eeuo pipefail

# This check asserts with bare commands in places, and a bare command that fails under `set -e`
# prints nothing at all - which is the shape this check exists to refuse, one level up. `-E` is what
# carries the trap into a function body; without it a failure inside one fires no trap at the line
# or at the call site.
trap 'echo "check-owner-custody-proof-selection.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

report_only=false
if [ "${2:-}" = "--report" ]; then
  report_only=true
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$report_only" != true ]; }; then
  echo "ERROR: usage: check-owner-custody-proof-selection.bash <repository-root> [--report]" >&2
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
  crates/risk_owner
  crates/execution_owner
  crates/portfolio_owner
  crates/strategy_governance
  crates/scanner_custody
)

# Crates that hold an `#[ignore]` test and are deliberately not custody crates, each with the reason
# its ignored tests are not chain proofs. This list and `owner_crates` above must together name every
# crate in the repository that holds one: a crate in neither fails this check.
#
# That completeness is the point. `owner_crates` was a hand-written list read as "the crates worth
# checking", and nothing said what the other crates were. Measured on d154cbced, 50 of the 189
# ignored tests in this repository live outside it, in 23 crates, and no check looked at any of them
# - not because anyone decided they needed no check, but because deciding was never required. A new
# crate inherited that silence on the day it was created.
#
# A reason here is about the crate, not the test: what its ignored tests need that CI does not give.
# Each begins with a tag so the report below can separate a settled decision from a blocked one.
readonly -A out_of_scope_reason=(
  ["crates/adapters/betfair"]="dataset: loads curated Betfair market files that are not in this repository"
  ["crates/adapters/binance"]="venue: reaches Binance, or needs the separately downloaded Binance Vision archive"
  ["crates/adapters/bitmex"]="slow: a multi-request integration probe, kept out of the per-commit budget"
  ["crates/adapters/blockchain"]="credential: needs ENVIO_API_TOKEN and live HyperSync access"
  ["crates/adapters/bybit"]="venue: reaches Bybit's live HTTP and websocket endpoints"
  ["crates/adapters/databento"]="credential: needs a local DATABENTO_API_KEY read-only probe authority"
  ["crates/adapters/derive"]="venue: live network calls against api.lyra.finance"
  ["crates/adapters/dydx"]="defect: the reconnect loop these tests drive is a known open defect, not a harness gap"
  ["crates/adapters/fred"]="dataset: needs VIBE_FRED_OFFICIAL_DATASET_ROOT to point at an offline official dataset"
  ["crates/adapters/hyperliquid"]="defect: blocks on a hard-coded timeout that is not injectable yet"
  ["crates/adapters/scheduled_events"]="dataset: needs externally custodied official snapshot bytes"
  ["crates/adapters/tardis"]="dataset: one-time dataset curation, deliberately not routine CI"
  ["crates/backtest"]="dataset: generates the immutable catalog the native repeat proof consumes"
  ["crates/common"]="defect: both tests document open production defects in the order emulator"
  ["crates/execution"]="slow: matching-engine scenarios kept out of the per-commit budget"
  ["crates/infrastructure"]="pending: waiting on PostgreSQL schema completion, specifically the FK constraints"
  ["crates/live"]="slow: stress scenarios, deliberately not run by default"
  ["crates/market_data_repair_custody"]="pending: its one proof uses CanonicalOwnerPostgresTestDatabaseV1, so it belongs in a chain; vibe-market-data-repair-custody is not in the chain's nextest archive, so listing it must add the package too"
  ["crates/model"]="generator: rewrites a generated table in execution.md rather than asserting anything"
  ["crates/network"]="slow: a continuous seed sweep driven by scripts/soak-network-turmoil.sh"
  ["crates/persistence"]="slow: a >120s catalog batching regression, run when catalog custody changes"
  ["crates/risk"]="pending: waiting on the emulator implementation and portfolio state tracking"
  ["crates/testkit"]="dataset: one-time dataset curation, deliberately not routine CI"
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
  ["composer_unlogged_drift_is_unavailable_to_migration_and_runtime"]="compiled in every build (its module carries no feature gate), but not selected and never run. At this revision the chain's own materialization no longer refuses rd_research_view_transitions_v3 (measured on a live chain database); whether this proof passes once selected is unmeasured, and selecting it is its own change"
  ["exact_complex_cache_executes_program_family_path_reproducibly"]="requires the separately downloaded exact 24-month Binance Vision cache; no workflow, Makefile or script provides it"
  ["exact_pilot_cache_executes_native_family_path"]="requires the separately downloaded exact 24-month Binance Vision cache; no workflow, Makefile or script provides it"
  ["forged_v3_admission_fails_without_replay_transition_or_outbox_write"]="compiled by the ordered chain since sealed-source-intake-composer-acceptance joined its union, but not selected and never run. At this revision the chain's own materialization no longer refuses rd_research_view_transitions_v3 (measured on a live chain database); whether this proof passes once selected is unmeasured, and selecting it is its own change"
  ["live_bounded_pit_probe_stops_on_cost_or_returns_authentic_evidence"]="live vendor probe; no workflow wires DATABENTO_API_KEY. It passes against the real vendor: one run downloads BBO and Definition for 0.000184 USD under a 0.05 USD ceiling"
  ["live_probe_answers_the_owner_scope_or_refuses"]="live vendor probe; no workflow wires DATABENTO_API_KEY. It passes locally, though on the refusal branch rather than the answering one"
  ["market_data_answers_one_frozen_request_from_live_vendor_data"]="live vendor probe; needs DATABENTO_API_KEY and MARKET_DATA_OWNER_DATABASE_URL on a store whose market_data_private schema already exists. It passes that way: twelve seconds against real vendor data"
  ["measure_admission_cost_by_program_size"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["official_holdout_integrity_probe_is_deterministic"]="requires the separately custodied official 2024 source bundle; no workflow, Makefile or script provides it"
  ["postgres_every_transaction_write_boundary_fault_leaves_zero_positive_rows"]="compiled by the ordered chain since sealed-source-intake-composer-acceptance joined its union, but not selected and never run. At this revision the chain's own materialization no longer refuses rd_research_view_transitions_v3 (measured on a live chain database); whether this proof passes once selected is unmeasured, and selecting it is its own change"
  ["regenerate_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["regenerate_source_research_composer_sealed_a0_corpus_from_real_producer"]="regenerates a committed corpus or measures cost; asserts no Owner custody"
  ["representative_coordinates_share_read_only_catalog_and_reproduce_fresh"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
  ["sealed_run_and_restarted_resolve_return_the_same_public_receipt"]="compiled by the ordered chain since sealed-source-intake-composer-acceptance joined its union, but not selected and never run. At this revision the chain's own materialization no longer refuses rd_research_view_transitions_v3 (measured on a live chain database); whether this proof passes once selected is unmeasured, and selecting it is its own change"
  ["two_lowerings_two_builds_and_strict_replay_mint_one_v3_identity"]="builds through the sandbox, which verifies the frozen Linux target sysroot; docs/owners/rd.md holds that freeze until a fresh hosted A0 readback"
  ["stale_artifact_policy_reaches_real_owner_chain_and_cannot_open_risk"]="requires frozen Binance, five-series ALFRED, and scheduled-event evidence; no workflow, Makefile or script provides it"
)

echo "Checking that every Owner custody proof is selected or explained..."

selected=$(mktemp)
ignored_crates="$(mktemp)"
trap 'rm -f "$selected" "$ignored_crates"' EXIT

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

# Every crate that holds an `#[ignore]` test must be classified, in `owner_crates` or in
# `out_of_scope_reason`. Neither list can be complete on its own, and a crate in neither used to be
# read as "not worth checking" when nothing had ever considered it.
#
# Both directions are checked. An unclassified crate fails, so a new crate cannot inherit silence.
# A classified crate that no longer holds an ignored test also fails, because a reason nobody can
# reach is the same as no reason, and it is the entry most likely to be left behind by a rename.
crate_root_of() {
  local directory
  directory="$(dirname "$1")"
  while [ "$directory" != "." ] && [ "$directory" != "/" ]; do
    if [ -f "$directory/Cargo.toml" ]; then
      printf '%s\n' "$directory"
      return 0
    fi
    directory="$(dirname "$directory")"
  done
  return 1
}

while read -r source_file; do
  [ -n "$source_file" ] || continue
  crate_root_of "$source_file" >> "$ignored_crates" || {
    echo "ERROR: '$source_file' holds an #[ignore] test and sits under no Cargo.toml." >&2
    echo "       Nothing can select a test that belongs to no package." >&2
    exit 1
  }
done < <(rg -l '^[[:space:]]*#\[ignore' --type rust 2> /dev/null || true)
sort -u -o "$ignored_crates" "$ignored_crates"

# A zero here means the search broke, not that the repository has no ignored tests: this check
# exists because there are 189 of them.
if [ ! -s "$ignored_crates" ]; then
  echo "ERROR: no crate in this repository appears to hold an #[ignore] test." >&2
  echo "       That is the shape a broken search has, not the shape this repository has." >&2
  exit 1
fi

unclassified=()
while read -r crate; do
  for known in "${owner_crates[@]}"; do
    [ "$crate" = "$known" ] && continue 2
  done
  [ -n "${out_of_scope_reason[$crate]:-}" ] && continue
  unclassified+=("$crate")
done < "$ignored_crates"
if [ "${#unclassified[@]}" -gt 0 ]; then
  echo "ERROR: these crates hold #[ignore] tests and are in neither list:" >&2
  for crate in "${unclassified[@]}"; do
    echo "       $crate" >&2
  done
  echo "       Add each to owner_crates, if its ignored tests are Owner custody proofs a chain" >&2
  echo "       must select, or to out_of_scope_reason with what its ignored tests need that CI" >&2
  echo "       does not give. Leaving a crate out is not a decision anyone can read later." >&2
  exit 1
fi

stale_scope=()
for crate in "${!out_of_scope_reason[@]}"; do
  grep -qxF "$crate" "$ignored_crates" || stale_scope+=("$crate")
done
if [ "${#stale_scope[@]}" -gt 0 ]; then
  echo "ERROR: these crates carry a reason for holding unchecked #[ignore] tests, and hold none:" >&2
  for crate in "${stale_scope[@]}"; do
    echo "       $crate" >&2
  done
  echo "       Remove the entry. A reason that describes nothing outlives what it described." >&2
  exit 1
fi

# The tag is what lets a reader separate a settled decision from a blocked one without reading all
# twenty-three reasons. `pending` and `defect` are the two that should not be permanent.
untagged=()
for crate in "${!out_of_scope_reason[@]}"; do
  case "${out_of_scope_reason[$crate]}" in
    venue:* | credential:* | dataset:* | slow:* | defect:* | pending:* | generator:*) ;;
    *) untagged+=("$crate") ;;
  esac
done
if [ "${#untagged[@]}" -gt 0 ]; then
  echo "ERROR: these out-of-scope reasons carry no recognised tag:" >&2
  for crate in "${untagged[@]}"; do
    echo "       $crate: ${out_of_scope_reason[$crate]}" >&2
  done
  echo "       Begin each with venue:, credential:, dataset:, slow:, defect:, pending: or" >&2
  echo "       generator:, so 'never runs here' and 'does not run yet' stay distinguishable." >&2
  exit 1
fi

# One extractor, two readers: the gate below and `--report`. Two would drift, and the one that
# drifted quietly would be the gate.
#
# It walks forward from each attribute to the first `fn` rather than reading a fixed context window.
# `rg -A4` was the window, and three proofs sat further than four lines from their own attribute -
# `stress_trade_burst` and `stress_cancel_starvation` behind two `cfg_attr` blocks, and
# `real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact` behind a four-line
# `cfg`. The last of those is in an Owner crate, and the exemption table below discusses it by name:
# the check knew the entry and could not see the test.
#
# Anchoring on `^[[:space:]]*#\[ignore` also retires the prose problem. A doc comment naming the
# attribute begins with `///` or `//`, so it never matches, where a substring search did and then
# took the next unrelated `fn` as a proof.
#
# An attribute with no `fn` after it fails rather than being skipped: a proof this cannot resolve is
# a proof it cannot check, and the two must not look alike.
ignored_proofs_in() {
  local crate="$1" file
  local -a files=()
  while read -r file; do
    [ -n "$file" ] && files+=("$file")
    # One pathspec, not two: git's `*` already crosses `/`, so adding `**/*.rs` beside `*.rs` lists
    # every nested file twice. `git ls-files` rather than a directory walk, because `.gitignore`
    # hides tracked files from a walker that reads it - 30 of this repository's 80 tracked `.sh`
    # files are invisible to `rg` here - and a checker that silently reads fewer files than exist
    # reports a shorter answer with no sign that it did.
  done < <(git ls-files -- "$crate/*.rs" 2> /dev/null || true)
  [ "${#files[@]}" -gt 0 ] || return 0
  awk '
    function decl_name(line,   m) {
      if (match(line, /(^|[^A-Za-z_0-9])fn[[:space:]]+[a-z_0-9]+/) == 0) return ""
      m = substr(line, RSTART, RLENGTH)
      sub(/^[^A-Za-z_]*/, "", m)
      sub(/^fn[[:space:]]+/, "", m)
      return m
    }
    FNR == 1 { pending = 0; depth = 0 }
    {
      if (!pending) {
        if ($0 ~ /^[[:space:]]*#\[ignore/) { pending = FNR; depth = 0 }
        next
      }
      # Blank lines and comments sit between an attribute and its item.
      if ($0 ~ /^[[:space:]]*$/ || $0 ~ /^[[:space:]]*\/\//) next
      # An attribute may span lines; follow its brackets rather than counting lines. A fixed window
      # is wrong in both directions - four lines missed three proofs behind `cfg_attr`, and twelve
      # reached past an item and took an unrelated `fn`.
      if (depth > 0 || $0 ~ /^[[:space:]]*#\[/) {
        n = gsub(/\[/, "[") - gsub(/\]/, "]")
        depth += n
        if (depth < 0) depth = 0
        next
      }
      name = decl_name($0)
      if (name != "") { print name; pending = 0; next }
      printf "ERROR: %s:%d carries #[ignore] and the next item is not a fn: %s\n", FILENAME, pending, $0 > "/dev/stderr"
      bad = 1
      pending = 0
    }
    END { if (bad) exit 1 }
  ' "${files[@]}" | sort -u
}

if [ "$report_only" = true ]; then
  # Which selector names each ignored test, for the question this check cannot answer by passing:
  # "who runs this one today". The sources are enumerated rather than listed, from the files that
  # invoke `cargo nextest` at all, because a hand-written list of sources is the thing that sent a
  # reader grepping `scripts/ .github/ Makefile` and concluding from zero hits that nothing ran a
  # test whose selector sits in `crates/data/tests/run_market_data_owner_postgres.bash`.
  #
  # "names" is not "selects": a name can appear in a comment or a positional assertion. The sound
  # direction is the other one - a name no source mentions is selected by nothing - and that is the
  # column worth reading.
  selector_sources="$(mktemp)"
  ignored_names="$(mktemp)"
  # `cargo test` as well as `cargo nextest`. Enumerating only the nextest callers missed
  # `scripts/ci/test-qualification-owner-recovery-postgres.bash`, which selects by exact name through
  # `cargo test -p ... <name>` and holds no occurrence of the word nextest at all. The control below
  # is what found that, before the table it produced was read by anyone.
  #
  # `if`, not `&&`: a loop body ending in a false `&&` returns non-zero, `pipefail` hands that to the
  # pipeline, and `set -e` ends the script - which is what the last candidate file not matching did.
  # This script is excluded from its own source list. It invokes `cargo nextest` only inside a
  # comment, and its exemption table holds the very names being looked up, so leaving it in would
  # report every exempted proof as named by a selector.
  git ls-files -- '*.bash' '*.sh' '*.yml' '*.yaml' '*.toml' 'Makefile' |
    while read -r candidate; do
      if [ "$candidate" = "scripts/ci/check-owner-custody-proof-selection.bash" ]; then
        continue
      fi
      if grep -qE 'cargo (nextest|test)' "$candidate" 2> /dev/null; then
        printf '%s\n' "$candidate"
      fi
    done > "$selector_sources"
  if [ ! -s "$selector_sources" ]; then
    echo "ERROR: no file in this repository appears to invoke cargo nextest." >&2
    rm -f "$selector_sources"
    exit 1
  fi
  # Read into an array once. Splitting the file inside the loop would leave `grep` with no file
  # operands the moment that list were empty, and `grep -q` with no operands reads standard input -
  # which is the loop's own, so it would block rather than fail.
  selector_files=()
  while read -r source; do selector_files+=("$source"); done < "$selector_sources"
  printf 'selector sources (%s):\n' "${#selector_files[@]}"
  sed 's/^/  /' "$selector_sources"
  printf '\n%-11s %-44s %s\n' "STATE" "CRATE" "TEST"
  named_total=0
  unnamed_total=0
  while read -r crate; do
    while read -r proof; do
      [ -n "$proof" ] || continue
      if grep -qF "$proof" -- "${selector_files[@]}" 2> /dev/null; then
        state=named
        named_total=$((named_total + 1))
      else
        state="NOT NAMED"
        unnamed_total=$((unnamed_total + 1))
      fi
      printf '%s\n' "$proof" >> "$ignored_names"
      printf '%-11s %-44s %s\n' "$state" "$crate" "$proof"
    done < <(ignored_proofs_in "$crate")
  done < "$ignored_crates"
  printf '\nnamed by some selector source: %s\nnamed by none: %s\n' "$named_total" "$unnamed_total"

  # The instrument has to prove it can see before its zeroes mean anything. Everything the chains
  # select is, by construction, named by a selector source; if any of it comes back unnamed, the
  # source enumeration is blind and every "NOT NAMED" above is unreliable rather than informative.
  #
  # This is not hypothetical. `.gitignore` in this repository hides 30 of its 80 tracked `.sh` files
  # from a directory walker that reads it, and the ordered chain's own script is one of the files at
  # risk. A report built that way lists almost everything as unselected and reads entirely
  # plausibly. `git check-ignore` cannot predict it either: gitignore does not apply to tracked
  # files, so git answers "not ignored" for a file ripgrep still skips.
  blind=0
  while read -r chain_selected; do
    [ -n "$chain_selected" ] || continue
    grep -qxF "$chain_selected" "$ignored_names" || continue
    if ! grep -qF "$chain_selected" -- "${selector_files[@]}" 2> /dev/null; then
      [ "$blind" -eq 0 ] && echo "ERROR: the selector sources above cannot see names the chains select:" >&2
      echo "       $chain_selected" >&2
      blind=$((blind + 1))
    fi
  done < "$selected"
  if [ "$blind" -gt 0 ]; then
    echo "       $blind of them. The enumeration is reading fewer files than exist, so every" >&2
    echo "       'NOT NAMED' row above is unreliable. Check what git ls-files returns for the" >&2
    echo "       selector scripts before reading any of this as evidence." >&2
    rm -f "$selector_sources" "$ignored_names"
    exit 1
  fi
  printf 'positive control: %s chain-selected names, all visible to the sources above\n' \
    "$(grep -c '' "$selected")"
  rm -f "$selector_sources" "$ignored_names"
  exit 0
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
  done < <(ignored_proofs_in "$crate")
done

if [ "$violations" -gt 0 ]; then
  echo "Found $violations unexplained Owner custody proof(s)" >&2
  exit 1
fi

echo "Every Owner custody proof is selected by a chain or carries its reason"
