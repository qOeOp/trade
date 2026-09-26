#!/usr/bin/env bash

set -Eeuo pipefail

# The checks in this script name what they looked for, but it is four thousand lines long and any
# bare command that fails under `set -e` still ends it with an empty log. Run 35650397288 is what
# that costs: a hosted runner spent on the ordered chain, and between the `make` line and `Error 1`
# the log held nothing at all. This is the backstop for whatever the named checks do not cover.
# `-E` on the line above is what makes this reach a function body. Measured, because the shape is
# easy to get wrong: without `-E` a failure inside a function fires no trap at all - not at the line,
# not at the call site - and every check in this script lives inside one. With `-E` the trap names
# the failing line itself, and a function called as `if ! func` still reports nothing, because the
# ERR trap follows the same suppression `set -e` does inside a condition.
trap 'echo "test-rd-owner-postgres.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

readonly guarded_roots=(
  crates/operator_authorization
  crates/product_edge
  crates/rd_source_intake_invocation_custody
  crates/qualification
  crates/backtest_owner
  crates/backtest_result_custody
  crates/data
  crates/strategy_factory
  crates/strategy_factory_rd_owner_api
)

# Build the Owner test packages into one nextest archive. The ordered
# package/binary/test filters below then run from that immutable build while
# the database-sensitive tests still execute one at a time and fail fast.
readonly rd_owner_postgres_tests=(
  'vibe-strategy-factory|vibe_strategy_factory|replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed'
  'vibe-strategy-factory|exploratory_replay_request_owner|legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back'
  'vibe-strategy-factory|exploratory_replay_request_owner|origin_current_replay_table_renames_with_exact_v1_v2_read_continuity'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::fresh_rd_owner_migrates_before_qualification_writer_validates'
  'vibe-strategy-factory|develop_composer_owner_v2|durable_owner_is_atomic_restart_exact_and_fail_closed'
  'vibe-data|vibe_data|owner::replay_market_facts_v2::postgres_tests::postgres_replay_composition_owner_is_atomic_exact_and_observes_reader_market_transaction_overlap'
  'vibe-strategy-factory|source_intake|postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once'
  'vibe-product-edge|vibe_product_edge|postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical'
  'vibe-product-edge|vibe_product_edge|postgres::tests::expired_manifest_recovery_rejoins_across_owners_and_preserves_old_rows'
  'vibe-strategy-factory|exploratory_replay_request_owner|frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner'
  'vibe-strategy-factory|exploratory_replay_request_owner|market_data_owner_sealed_request_port_is_exact_serializable_and_runtime_immutable'
  'vibe-strategy-factory|exploratory_replay_request_owner|replay_at_or_after_valid_through_writes_no_frozen_row_or_outbox'
  'vibe-strategy-factory|source_intake|postgres_readback_rejects_tampered_raw_payload'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_owner_is_atomic_restart_exact_and_rd_locked_read_only'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::exploratory_replay_result_http_readback_is_exact_locked_and_rd_read_only'
  'vibe-strategy-factory-rd-owner-api|dashboard_read_api|tests::replay_result_dashboard_read_api_returns_exact_canonical_bytes'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_rd_read_rejects_function_source_drift'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_rd_read_rejects_owner_api_routine_sibling'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_rd_read_rejects_raw_table_acl_drift'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_rd_read_rejects_inherited_owner_membership'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_rd_read_rejects_owner_attribute_drift'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_topology_fence_serializes_managed_acl_drift'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_result_mid_commit_failure_rolls_back_every_aggregate_row'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::governance_artifact_membership_readback_is_restart_exact_and_fail_closed'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::successor_artifact_enters_exploratory_replay_with_exact_owner_custody'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic'
  'vibe-strategy-factory|vibe_strategy_factory|replay_execution_profile_binding_v1::tests::verified_owner_readback_mints_provenance_and_wrong_coordinates_fail'
  'vibe-product-edge|vibe_product_edge|postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation'
  'vibe-data|instrument_economic_terms_postgres_v1|atomic_exact_replay_restart_tamper_and_acl_fail_closed'
  'vibe-strategy-factory|vibe_strategy_factory|program_host_bar_joined_cut_postgres_acceptance_tests::owner_postgres_v4_moves_through_program_host_and_real_backtest'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::iteration_analysis_postgres_acceptance_tests::analysis_request_completion_resolve_restart_and_tamper_are_atomic'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::protected_replay_request_is_atomic_retry_exact_and_backtest_sealed'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_protected_result_is_atomic_request_bound_and_qualification_sealed'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::negative_protected_attempt_closure_is_atomic_retry_exact_and_eligibility_absent'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::diagnostic_protected_attempt_closure_is_atomic_and_creates_no_assessment_or_eligibility'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::bounded_feature_program_joint_freeze_is_atomic_idempotent_and_tamper_closed'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::declared_bounded_feature_program_assembles_from_owner_custody_and_freezes'
  'vibe-strategy-factory|develop_composer_postgres_v2|postgres_migration_materializes_only_private_binary_authority'
  'vibe-strategy-factory|develop_composer_postgres_v2|sealed_read_port_is_restart_exact_fail_closed_and_query_only'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_result_admission_postgres::tests::a_committed_admission_is_read_back_by_its_locator_and_never_created_by_one'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_result_admission_postgres::tests::a_locator_from_another_experiment_never_reads_this_admission_back'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_result_admission_postgres::tests::row_scalar_storage_or_outbox_tamper_closes_the_readback'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_result_admission_postgres::tests::a_malformed_request_never_reaches_owner_custody'
  'vibe-strategy-factory|trial_family_owner|postgres_owner_persists_one_family_and_replays_without_partial_conflict_writes'
  'vibe-strategy-factory|trial_family_owner|every_v2_semantic_rejection_is_rejection_only_and_replays_exactly'
  'vibe-strategy-factory|trial_family_owner|invalid_successor_cannot_poison_heads_and_verified_lineage_never_skips_corruption'
  'vibe-strategy-factory|trial_family_owner|concurrent_invalid_and_valid_same_scope_serialize_without_invalid_authority'
  'vibe-strategy-factory|trial_family_owner|exhaustive_lineage_waits_for_row_mutation_and_recovers_after_restore'
  'vibe-strategy-factory|trial_family_owner|stored_request_meaning_corruption_is_unavailable_until_exact_restoration'
  'vibe-strategy-factory|trial_family_owner|missing_research_custody_prepares_no_attempt'
  'vibe-strategy-factory|trial_family_owner|research_and_attempt_resolve_share_one_deadlock_free_lock_order'
  'vibe-strategy-factory|trial_family_owner|no_artifact_receipt_mutation_fails_closed_and_exact_restore_replays'
  'vibe-strategy-factory|trial_family_owner|expired_attempt_receipt_is_independently_outcome_unknown'
  'vibe-strategy-factory|vibe_strategy_factory|market_data_repair_resolution_postgres::tests::repaired_readback_is_reverified_inside_successor_transaction'
  'vibe-strategy-factory|vibe_strategy_factory|market_data_repair_resolution_postgres::tests::commit_retry_resolve_conflict_and_tamper_are_atomic'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::portfolio_resource_grant_advisory_lock_serializes_distinct_grants'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::portfolio_resource_grant_issue_read_replay_successor_revoke_restart_acl_and_expiry'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::exact_stale_cut_blocks_every_artifact_transition_without_writes'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::stored_attempt_catalog_is_exactly_classifiable_without_writes'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::opaque_legacy_success_is_classified_but_never_promoted'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::exact_origin_terminal_legacy_is_read_only_and_nonterminal_blocks_activation'
  'vibe-strategy-factory|source_intake|postgres_sealed_success_atomically_reads_back_distinct_time_heads_and_rejects_mismatches'
  'vibe-strategy-factory|develop_composer_postgres_v2|transaction_bound_read_uses_the_borrowed_backend_locks_and_writes_nothing'
  'vibe-strategy-factory|develop_composer_postgres_v2|transaction_bound_read_rejects_wrong_owner_acl_and_stale_custody'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::frozen_program_runs_the_production_composer_to_a_durable_artifact'
  'vibe-strategy-factory|vibe_strategy_factory|replay_policy_catalog_postgres_v2::postgres_tests::catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::autonomous_policy_authorization_advisory_lock_serializes_distinct_authorizations'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::autonomous_policy_authorization_issue_read_replay_successor_revoke_restart_acl_and_expiry'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::postgres_successor_is_append_only_replay_safe_and_preserves_history'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::postgres_history_mutations_fail_closed_and_restore_exactly'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::shared_resolver_blocks_revoke_update_lock'
  'vibe-operator-authorization|vibe_operator_authorization|postgres::tests::select_only_consumer_resolve_serializes_with_revoke'
  'vibe-product-edge|vibe_product_edge|postgres::tests::lifecycle_request_admission_is_typed_effect_free_and_replay_exact'
  'vibe-execution-owner|vibe_execution_owner|adapter_binding_postgres::tests::postgres_binding_custody_is_atomic_replay_safe_and_tamper_closed'
  'vibe-portfolio-owner|vibe_portfolio_owner|capacity_scope_postgres::tests::postgres_capacity_scope_registry_is_append_only_and_seals_one_bound_scope'
  'vibe-strategy-governance|vibe_strategy_governance|registry_postgres::postgres_proof::postgres_execution_scope_binds_only_what_both_source_owners_confirm'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::protected_replay_request_sets_seal_every_terminal_lineage_and_close_registration'
  'vibe-backtest-owner|vibe_backtest_owner|tests::postgres_protected_v3_results_and_attempt_frontiers_close_every_terminal_lineage'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::protected_assessments_close_every_terminal_once_and_project_public_status'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::protected_feedback_projection_readback_fails_closed_on_corruption_and_writes_nothing'
  'vibe-data|vibe_data|owner::postgres::market_data_rd_api_authorization_postgres_tests::market_data_rd_api_admits_the_rd_owner_through_the_grant_layer_alone'
  'vibe-data|vibe_data|owner::postgres::market_data_rd_api_authorization_postgres_tests::market_data_rd_api_refuses_the_backtest_owner_loudly_not_emptily'
  'vibe-scanner-custody|vibe_scanner_custody|postgres::chain_proofs::terminal_receipt_custody_commits_joins_refuses_and_reads_back_to_product_edge'
  'vibe-scanner-custody|vibe_scanner_custody|postgres::chain_proofs::a_caller_without_the_grant_is_refused_rather_than_answered_empty'
  'vibe-risk-owner|vibe_risk_owner|capacity_read_port_postgres::postgres_proof::postgres_capacity_observation_seals_only_what_portfolio_currently_publishes'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::frozen_program_replays_over_http_to_the_same_joint_freeze'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::an_authored_design_is_published_bound_and_frozen_over_http'
  'vibe-strategy-factory|trial_family_owner|intent_lookup_does_not_lock_a_receipt_it_does_not_return'
  'vibe-strategy-factory|vibe_strategy_factory|postgres_error_message::postgres_tests::owner_storage_errors_carry_the_detail_postgres_sent'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::second_request_under_one_principal_resolves_through_the_frontier_arm'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::sealed_request_reads_name_the_admission_they_refused'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::an_orphaned_projection_names_itself_rather_than_the_caller_request'
  'vibe-qualification|vibe_qualification|postgres::postgres_tests::an_eligibility_fact_window_is_derived_and_its_lineage_is_enforced_by_storage'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::the_authored_frozen_program_runs_the_production_composer'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::backtest_run_report_postgres_acceptance_tests::backtest_run_report_reads_back_every_point_a_real_run_committed'
  'vibe-strategy-factory-rd-owner-api|dashboard_read_api|tests::backtest_run_report_browser_acceptance_reads_the_owner_answer'
  'vibe-strategy-factory|source_intake|postgres_readback_refuses_an_identity_admitted_for_another_operation'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::postgres_v3_request_binds_its_instrument_scope_into_the_intent'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::postgres_v3_scope_market_data_does_not_admit_closes_with_its_bound_check'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::postgres_v3_request_market_data_cannot_place_is_rejected_by_its_own_answer'
  'vibe-product-edge|vibe_product_edge|deployment_acceptance::tests::deployment_fixture_is_admitted_idempotent_and_refuses_other_content_by_name'
  'vibe-strategy-factory|vibe_strategy_factory|iteration_decision_postgres::postgres_acceptance_tests::legacy_replay_request_passes_the_source_boundary_under_issuance_isolation'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::legacy_prepared_drain_is_atomic_idempotent_and_read_only'
)
readonly nextest_graph_args=(
  --locked
  --package vibe-strategy-factory
  --package vibe-strategy-factory-rd-owner-api
  --package vibe-product-edge
  --package vibe-operator-authorization
  --package vibe-backtest-owner
  --package vibe-data
  --package vibe-qualification
  --package vibe-execution-owner
  --package vibe-portfolio-owner
  --package vibe-strategy-governance
  --package vibe-scanner-custody
  --package vibe-risk-owner
  --lib
  --tests
)
# The incoming Makefile union also contains workspace-root features that none of
# the three selected packages expose. Keep the archive projection package-scoped.
readonly nextest_archive_features='vibe-strategy-factory/sealed-develop-composer-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-acceptance,vibe-strategy-factory-rd-owner-api/sealed-artifact-source-browser-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance,vibe-product-edge/sealed-deployment-acceptance'
# The schema materializer is the archive's own `strategy-factory-rd-owner-api` binary, so it has no
# feature set of its own. It needs rd-owner-api's `sealed-develop-composer-acceptance`, which
# `sealed-source-intake-composer-acceptance` above already implies; check_nextest_graph_contract
# keeps that implication true. It used to be built separately with `cargo run` and a union spelled
# out beside this one. A bin build carries no dev-dependencies, so Cargo unified that graph's
# dependency features differently from the test graph, and 78 crates - datafusion, parquet, hyper,
# reqwest among them - were compiled twice: five minutes (#993's run 35989665241). Resolved with
# `cargo metadata`, that union and this set give every one of the 74 workspace crates the same
# features.
# `10-migrate-authority-custody.sh` installs the two Composer acceptance commit functions only when
# SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE is 1, and drops them when it is 0. A build with the
# Composer-backed Replay feature checks for them - `COMPOSER_OWNER_API_FUNCTION_COUNT_V2` is 10
# there and 8 without - so the switch is read from the union this chain builds, never set beside
# it. Set beside it, the two drift: the feature compiled, the switch stayed 0, and every Composer
# owner refused its own database as "Composer authority topology is unavailable".
if [[ ",${nextest_archive_features}," == *",vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance,"* ]]; then
  readonly composer_acceptance_migration=1
else
  readonly composer_acceptance_migration=0
fi
# `--success-output final`: nextest discards a passing test's stdout by default, and every entry
# here is one whole acceptance. Entry 28 alone drives eleven browser sub-tests whose individual
# durations exist only on that stream, so a green entry printed nothing at all about what it did -
# and a whole day was spent reading that absence as evidence: "the passing runs never build the
# Dashboard" was read off a log that simply was not printing the build. It cost about 800 lines,
# under three percent, measured on the runs that established this.
# `--no-tests=fail`: every entry selects one test by exact name, so a typo in a name selects
# nothing. On the pinned nextest (0.9.143) that is already an error - an unmatched filter exits 4,
# with or without this flag, under `--profile ci` and without it - so this states a default rather
# than correcting one. It is stated because the default belongs to the tool and the profile, and
# this property should not move when either does.
readonly nextest_execution_args=(--fail-fast --run-ignored ignored-only --success-output final --no-tests=fail)
readonly candidate_experiment_upgrade_seed_test='trial_family_postgres::postgres_binding_tests::canonical_candidate_experiment_upgrade_seed_is_owner_issued_and_locked_readback_exact'

check_nextest_graph_contract() {
  if rg -n '^[[:space:]]*cargo[[:space:]]+test([[:space:]]|$)' "${BASH_SOURCE[0]}"; then
    echo "ERROR: isolated PostgreSQL tests must use the shared nextest graph." >&2
    return 1
  fi
  if [[ "${#rd_owner_postgres_tests[@]}" -ne 107 ]]; then
    echo "ERROR: isolated PostgreSQL test selection must retain all 107 ordered tests, found ${#rd_owner_postgres_tests[@]}." >&2
    return 1
  fi
  if [[ "${rd_owner_postgres_tests[0]}" != *'|replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed' ]] ||
    [[ "${rd_owner_postgres_tests[1]}" != *'|legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]] ||
    [[ "${rd_owner_postgres_tests[2]}" != *'|origin_current_replay_table_renames_with_exact_v1_v2_read_continuity' ]] ||
    [[ "${rd_owner_postgres_tests[3]}" != *'|product_edge_postgres::tests::fresh_rd_owner_migrates_before_qualification_writer_validates' ]] ||
    [[ "${rd_owner_postgres_tests[4]}" != *'|durable_owner_is_atomic_restart_exact_and_fail_closed' ]] ||
    [[ "${rd_owner_postgres_tests[5]}" != *'|owner::replay_market_facts_v2::postgres_tests::postgres_replay_composition_owner_is_atomic_exact_and_observes_reader_market_transaction_overlap' ]] ||
    [[ "${rd_owner_postgres_tests[6]}" != *'|postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed' ]] ||
    [[ "${rd_owner_postgres_tests[7]}" != *'|tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once' ]] ||
    [[ "${rd_owner_postgres_tests[8]}" != *'|postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical' ]] ||
    [[ "${rd_owner_postgres_tests[9]}" != *'|postgres::tests::expired_manifest_recovery_rejoins_across_owners_and_preserves_old_rows' ]] ||
    [[ "${rd_owner_postgres_tests[10]}" != *'|frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner' ]] ||
    [[ "${rd_owner_postgres_tests[11]}" != *'|market_data_owner_sealed_request_port_is_exact_serializable_and_runtime_immutable' ]] ||
    [[ "${rd_owner_postgres_tests[12]}" != *'|replay_at_or_after_valid_through_writes_no_frozen_row_or_outbox' ]] ||
    [[ "${rd_owner_postgres_tests[13]}" != *'|postgres_readback_rejects_tampered_raw_payload' ]] ||
    [[ "${rd_owner_postgres_tests[14]}" != *'|tests::postgres_result_owner_is_atomic_restart_exact_and_rd_locked_read_only' ]] ||
    [[ "${rd_owner_postgres_tests[15]}" != *'|tests::exploratory_replay_result_http_readback_is_exact_locked_and_rd_read_only' ]] ||
    [[ "${rd_owner_postgres_tests[16]}" != *'|tests::replay_result_dashboard_read_api_returns_exact_canonical_bytes' ]] ||
    [[ "${rd_owner_postgres_tests[17]}" != *'|tests::postgres_result_rd_read_rejects_function_source_drift' ]] ||
    [[ "${rd_owner_postgres_tests[18]}" != *'|tests::postgres_result_rd_read_rejects_owner_api_routine_sibling' ]] ||
    [[ "${rd_owner_postgres_tests[19]}" != *'|tests::postgres_result_rd_read_rejects_raw_table_acl_drift' ]] ||
    [[ "${rd_owner_postgres_tests[20]}" != *'|tests::postgres_result_rd_read_rejects_inherited_owner_membership' ]] ||
    [[ "${rd_owner_postgres_tests[21]}" != *'|tests::postgres_result_rd_read_rejects_owner_attribute_drift' ]] ||
    [[ "${rd_owner_postgres_tests[22]}" != *'|tests::postgres_result_topology_fence_serializes_managed_acl_drift' ]] ||
    [[ "${rd_owner_postgres_tests[23]}" != *'|tests::postgres_result_mid_commit_failure_rolls_back_every_aggregate_row' ]] ||
    [[ "${rd_owner_postgres_tests[24]}" != *'|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut' ]] ||
    [[ "${rd_owner_postgres_tests[25]}" != *'|artifact_build_postgres::postgres_freshness_tests::governance_artifact_membership_readback_is_restart_exact_and_fail_closed' ]] ||
    [[ "${rd_owner_postgres_tests[26]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::successor_artifact_enters_exploratory_replay_with_exact_owner_custody' ]] ||
    [[ "${rd_owner_postgres_tests[27]}" != *'|tests::strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody' ]] ||
    [[ "${rd_owner_postgres_tests[28]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::repair_decision_action_and_market_data_request_commit_retry_resolve_and_rejection_are_atomic' ]] ||
    [[ "${rd_owner_postgres_tests[29]}" != *'|replay_execution_profile_binding_v1::tests::verified_owner_readback_mints_provenance_and_wrong_coordinates_fail' ]] ||
    [[ "${rd_owner_postgres_tests[30]}" != *'|postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation' ]] ||
    [[ "${rd_owner_postgres_tests[31]}" != *'|atomic_exact_replay_restart_tamper_and_acl_fail_closed' ]] ||
    [[ "${rd_owner_postgres_tests[32]}" != *'|program_host_bar_joined_cut_postgres_acceptance_tests::owner_postgres_v4_moves_through_program_host_and_real_backtest' ]] ||
    [[ "${rd_owner_postgres_tests[33]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::iteration_analysis_postgres_acceptance_tests::analysis_request_completion_resolve_restart_and_tamper_are_atomic' ]] ||
    [[ "${rd_owner_postgres_tests[34]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic' ]] ||
    [[ "${rd_owner_postgres_tests[35]}" != *'|postgres::postgres_tests::protected_replay_request_is_atomic_retry_exact_and_backtest_sealed' ]] ||
    [[ "${rd_owner_postgres_tests[36]}" != *'|tests::postgres_protected_result_is_atomic_request_bound_and_qualification_sealed' ]] ||
    [[ "${rd_owner_postgres_tests[37]}" != *'|postgres::postgres_tests::negative_protected_attempt_closure_is_atomic_retry_exact_and_eligibility_absent' ]] ||
    [[ "${rd_owner_postgres_tests[38]}" != *'|postgres::postgres_tests::diagnostic_protected_attempt_closure_is_atomic_and_creates_no_assessment_or_eligibility' ]] ||
    [[ "${rd_owner_postgres_tests[39]}" != *'|product_edge_postgres::tests::bounded_feature_program_joint_freeze_is_atomic_idempotent_and_tamper_closed' ]] ||
    [[ "${rd_owner_postgres_tests[40]}" != *'|product_edge_postgres::tests::declared_bounded_feature_program_assembles_from_owner_custody_and_freezes' ]] ||
    [[ "${rd_owner_postgres_tests[41]}" != *'|postgres_migration_materializes_only_private_binary_authority' ]] ||
    [[ "${rd_owner_postgres_tests[42]}" != *'|sealed_read_port_is_restart_exact_fail_closed_and_query_only' ]] ||
    [[ "${rd_owner_postgres_tests[43]}" != *'|iteration_result_admission_postgres::tests::a_committed_admission_is_read_back_by_its_locator_and_never_created_by_one' ]] ||
    [[ "${rd_owner_postgres_tests[44]}" != *'|iteration_result_admission_postgres::tests::a_locator_from_another_experiment_never_reads_this_admission_back' ]] ||
    [[ "${rd_owner_postgres_tests[45]}" != *'|iteration_result_admission_postgres::tests::row_scalar_storage_or_outbox_tamper_closes_the_readback' ]] ||
    [[ "${rd_owner_postgres_tests[46]}" != *'|iteration_result_admission_postgres::tests::a_malformed_request_never_reaches_owner_custody' ]] ||
    [[ "${rd_owner_postgres_tests[47]}" != *'|postgres_owner_persists_one_family_and_replays_without_partial_conflict_writes' ]] ||
    [[ "${rd_owner_postgres_tests[48]}" != *'|every_v2_semantic_rejection_is_rejection_only_and_replays_exactly' ]] ||
    [[ "${rd_owner_postgres_tests[49]}" != *'|invalid_successor_cannot_poison_heads_and_verified_lineage_never_skips_corruption' ]] ||
    [[ "${rd_owner_postgres_tests[50]}" != *'|concurrent_invalid_and_valid_same_scope_serialize_without_invalid_authority' ]] ||
    [[ "${rd_owner_postgres_tests[51]}" != *'|exhaustive_lineage_waits_for_row_mutation_and_recovers_after_restore' ]] ||
    [[ "${rd_owner_postgres_tests[52]}" != *'|stored_request_meaning_corruption_is_unavailable_until_exact_restoration' ]] ||
    [[ "${rd_owner_postgres_tests[53]}" != *'|missing_research_custody_prepares_no_attempt' ]] ||
    [[ "${rd_owner_postgres_tests[54]}" != *'|research_and_attempt_resolve_share_one_deadlock_free_lock_order' ]] ||
    [[ "${rd_owner_postgres_tests[55]}" != *'|no_artifact_receipt_mutation_fails_closed_and_exact_restore_replays' ]] ||
    [[ "${rd_owner_postgres_tests[56]}" != *'|expired_attempt_receipt_is_independently_outcome_unknown' ]] ||
    [[ "${rd_owner_postgres_tests[57]}" != *'|market_data_repair_resolution_postgres::tests::repaired_readback_is_reverified_inside_successor_transaction' ]] ||
    [[ "${rd_owner_postgres_tests[58]}" != *'|market_data_repair_resolution_postgres::tests::commit_retry_resolve_conflict_and_tamper_are_atomic' ]] ||
    [[ "${rd_owner_postgres_tests[59]}" != *'|postgres::tests::portfolio_resource_grant_advisory_lock_serializes_distinct_grants' ]] ||
    [[ "${rd_owner_postgres_tests[60]}" != *'|postgres::tests::portfolio_resource_grant_issue_read_replay_successor_revoke_restart_acl_and_expiry' ]] ||
    [[ "${rd_owner_postgres_tests[61]}" != *'|artifact_build_postgres::postgres_freshness_tests::exact_stale_cut_blocks_every_artifact_transition_without_writes' ]] ||
    [[ "${rd_owner_postgres_tests[62]}" != *'|artifact_build_postgres::postgres_freshness_tests::stored_attempt_catalog_is_exactly_classifiable_without_writes' ]] ||
    [[ "${rd_owner_postgres_tests[63]}" != *'|artifact_build_postgres::postgres_freshness_tests::opaque_legacy_success_is_classified_but_never_promoted' ]] ||
    [[ "${rd_owner_postgres_tests[64]}" != *'|artifact_build_postgres::postgres_freshness_tests::exact_origin_terminal_legacy_is_read_only_and_nonterminal_blocks_activation' ]] ||
    [[ "${rd_owner_postgres_tests[65]}" != *'|postgres_sealed_success_atomically_reads_back_distinct_time_heads_and_rejects_mismatches' ]] ||
    [[ "${rd_owner_postgres_tests[66]}" != *'|transaction_bound_read_uses_the_borrowed_backend_locks_and_writes_nothing' ]] ||
    [[ "${rd_owner_postgres_tests[67]}" != *'|transaction_bound_read_rejects_wrong_owner_acl_and_stale_custody' ]] ||
    [[ "${rd_owner_postgres_tests[68]}" != *'|product_edge_postgres::tests::frozen_program_runs_the_production_composer_to_a_durable_artifact' ]] ||
    [[ "${rd_owner_postgres_tests[69]}" != *'|replay_policy_catalog_postgres_v2::postgres_tests::catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds' ]] ||
    [[ "${rd_owner_postgres_tests[70]}" != *'|postgres::tests::autonomous_policy_authorization_advisory_lock_serializes_distinct_authorizations' ]] ||
    [[ "${rd_owner_postgres_tests[71]}" != *'|postgres::tests::autonomous_policy_authorization_issue_read_replay_successor_revoke_restart_acl_and_expiry' ]] ||
    [[ "${rd_owner_postgres_tests[72]}" != *'|postgres::tests::postgres_successor_is_append_only_replay_safe_and_preserves_history' ]] ||
    [[ "${rd_owner_postgres_tests[73]}" != *'|postgres::tests::postgres_history_mutations_fail_closed_and_restore_exactly' ]] ||
    [[ "${rd_owner_postgres_tests[74]}" != *'|postgres::tests::shared_resolver_blocks_revoke_update_lock' ]] ||
    [[ "${rd_owner_postgres_tests[75]}" != *'|postgres::tests::select_only_consumer_resolve_serializes_with_revoke' ]] ||
    [[ "${rd_owner_postgres_tests[76]}" != *'|postgres::tests::lifecycle_request_admission_is_typed_effect_free_and_replay_exact' ]] ||
    # The three trading-side entries carry no ordering dependency on one another: each drives the
    # upstream custody it needs inside its own test, under its own per-process suffix identity. PR
    # #693's body claimed the reverse; that claim was true of an earlier design, in which Portfolio's
    # proof read a fact Execution's chain entry had left behind, and it was not re-checked after #654
    # rewrote that proof to drive Execution's production custody itself. This note records the
    # correction; it is not a claim that any entry may be freely reordered.
    #
    # Pinning them is not about their dependencies anyway. Every entry pinned by position makes a
    # reorder something two places have to agree on, so a reorder is always deliberate rather than
    # accidental - which is what matters in a chain that shares one database it never resets.
    [[ "${rd_owner_postgres_tests[77]}" != *'|adapter_binding_postgres::tests::postgres_binding_custody_is_atomic_replay_safe_and_tamper_closed' ]] ||
    [[ "${rd_owner_postgres_tests[78]}" != *'|capacity_scope_postgres::tests::postgres_capacity_scope_registry_is_append_only_and_seals_one_bound_scope' ]] ||
    [[ "${rd_owner_postgres_tests[79]}" != *'|registry_postgres::postgres_proof::postgres_execution_scope_binds_only_what_both_source_owners_confirm' ]] ||
    [[ "${rd_owner_postgres_tests[80]}" != *'|postgres::postgres_tests::protected_replay_request_sets_seal_every_terminal_lineage_and_close_registration' ]] ||
    [[ "${rd_owner_postgres_tests[81]}" != *'|tests::postgres_protected_v3_results_and_attempt_frontiers_close_every_terminal_lineage' ]] ||
    [[ "${rd_owner_postgres_tests[82]}" != *'|postgres::postgres_tests::protected_assessments_close_every_terminal_once_and_project_public_status' ]] ||
    [[ "${rd_owner_postgres_tests[83]}" != *'|postgres::postgres_tests::protected_feedback_projection_readback_fails_closed_on_corruption_and_writes_nothing' ]] ||
    [[ "${rd_owner_postgres_tests[84]}" != *'|owner::postgres::market_data_rd_api_authorization_postgres_tests::market_data_rd_api_admits_the_rd_owner_through_the_grant_layer_alone' ]] ||
    [[ "${rd_owner_postgres_tests[85]}" != *'|owner::postgres::market_data_rd_api_authorization_postgres_tests::market_data_rd_api_refuses_the_backtest_owner_loudly_not_emptily' ]] ||
    [[ "${rd_owner_postgres_tests[86]}" != *'|postgres::chain_proofs::terminal_receipt_custody_commits_joins_refuses_and_reads_back_to_product_edge' ]] ||
    [[ "${rd_owner_postgres_tests[87]}" != *'|postgres::chain_proofs::a_caller_without_the_grant_is_refused_rather_than_answered_empty' ]] ||
    [[ "${rd_owner_postgres_tests[88]}" != *'|capacity_read_port_postgres::postgres_proof::postgres_capacity_observation_seals_only_what_portfolio_currently_publishes' ]] ||
    [[ "${rd_owner_postgres_tests[89]}" != *'|tests::frozen_program_replays_over_http_to_the_same_joint_freeze' ]] ||
    [[ "${rd_owner_postgres_tests[90]}" != *'|tests::an_authored_design_is_published_bound_and_frozen_over_http' ]] ||
    [[ "${rd_owner_postgres_tests[91]}" != *'|intent_lookup_does_not_lock_a_receipt_it_does_not_return' ]] ||
    [[ "${rd_owner_postgres_tests[92]}" != *'|postgres_error_message::postgres_tests::owner_storage_errors_carry_the_detail_postgres_sent' ]] ||
    [[ "${rd_owner_postgres_tests[93]}" != *'|product_edge_postgres::tests::second_request_under_one_principal_resolves_through_the_frontier_arm' ]] ||
    [[ "${rd_owner_postgres_tests[94]}" != *'|postgres::postgres_tests::sealed_request_reads_name_the_admission_they_refused' ]] ||
    [[ "${rd_owner_postgres_tests[95]}" != *'|postgres::postgres_tests::an_orphaned_projection_names_itself_rather_than_the_caller_request' ]] ||
    [[ "${rd_owner_postgres_tests[96]}" != *'|postgres::postgres_tests::an_eligibility_fact_window_is_derived_and_its_lineage_is_enforced_by_storage' ]] ||
    [[ "${rd_owner_postgres_tests[97]}" != *'|tests::the_authored_frozen_program_runs_the_production_composer' ]] ||
    [[ "${rd_owner_postgres_tests[98]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::backtest_run_report_postgres_acceptance_tests::backtest_run_report_reads_back_every_point_a_real_run_committed' ]] ||
    [[ "${rd_owner_postgres_tests[99]}" != *'|tests::backtest_run_report_browser_acceptance_reads_the_owner_answer' ]] ||
    [[ "${rd_owner_postgres_tests[100]}" != *'|postgres_readback_refuses_an_identity_admitted_for_another_operation' ]] ||
    [[ "${rd_owner_postgres_tests[101]}" != *'|product_edge_postgres::tests::postgres_v3_request_binds_its_instrument_scope_into_the_intent' ]] ||
    [[ "${rd_owner_postgres_tests[102]}" != *'|product_edge_postgres::tests::postgres_v3_scope_market_data_does_not_admit_closes_with_its_bound_check' ]] ||
    [[ "${rd_owner_postgres_tests[103]}" != *'|product_edge_postgres::tests::postgres_v3_request_market_data_cannot_place_is_rejected_by_its_own_answer' ]] ||
    [[ "${rd_owner_postgres_tests[104]}" != *'|deployment_acceptance::tests::deployment_fixture_is_admitted_idempotent_and_refuses_other_content_by_name' ]] ||
    [[ "${rd_owner_postgres_tests[105]}" != *'|iteration_decision_postgres::postgres_acceptance_tests::legacy_replay_request_passes_the_source_boundary_under_issuance_isolation' ]] ||
    [[ "${rd_owner_postgres_tests[106]}" != *'|artifact_build_postgres::postgres_freshness_tests::legacy_prepared_drain_is_atomic_idempotent_and_read_only' ]]; then
    echo "ERROR: isolated PostgreSQL test ordering must remain fresh-first and destructive-drain-last." >&2
    return 1
  fi
  if [[ "${nextest_graph_args[*]}" != '--locked --package vibe-strategy-factory --package vibe-strategy-factory-rd-owner-api --package vibe-product-edge --package vibe-operator-authorization --package vibe-backtest-owner --package vibe-data --package vibe-qualification --package vibe-execution-owner --package vibe-portfolio-owner --package vibe-strategy-governance --package vibe-scanner-custody --package vibe-risk-owner --lib --tests' ]] ||
    [[ "$nextest_archive_features" != 'vibe-strategy-factory/sealed-develop-composer-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-acceptance,vibe-strategy-factory-rd-owner-api/sealed-artifact-source-browser-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance,vibe-product-edge/sealed-deployment-acceptance' ]] ||
    [[ "${nextest_execution_args[*]}" != '--fail-fast --run-ignored ignored-only --success-output final --no-tests=fail' ]]; then
    echo "ERROR: shared nextest graph, schema feature union, or sequential ignored-only execution changed." >&2
    return 1
  fi
  # The materializer runs from the archive, so the archive's features must reach rd-owner-api's
  # `sealed-develop-composer-acceptance`. They do through `sealed-source-intake-composer-acceptance`;
  # if that entry is ever dropped from the manifest, the materializer loses the Composer schema.
  if ! python3 - "$(dirname "${BASH_SOURCE[0]}")/../../crates/strategy_factory_rd_owner_api/Cargo.toml" << 'MANIFEST'; then
import re
import sys

manifest = open(sys.argv[1], encoding="utf-8").read()
block = re.search(r"^sealed-source-intake-composer-acceptance = \[(.*?)^\]", manifest, re.M | re.S)
sys.exit(0 if block and re.search(r'^\s*"sealed-develop-composer-acceptance",$', block.group(1), re.M) else 1)
MANIFEST
    echo "ERROR: rd-owner-api's sealed-source-intake-composer-acceptance no longer implies sealed-develop-composer-acceptance, which the schema materializer built in the archive needs." >&2
    return 1
  fi
  if [[ "$candidate_experiment_upgrade_seed_test" != 'trial_family_postgres::postgres_binding_tests::canonical_candidate_experiment_upgrade_seed_is_owner_issued_and_locked_readback_exact' ]]; then
    echo "ERROR: Candidate experiment upgrade must use the canonical Owner issuance/readback fixture." >&2
    return 1
  fi

  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  if ! rg -Fxq \
    'RD_OWNER_POSTGRES_FEATURES := $(CARGO_FEATURES),vibe-strategy-factory/sealed-develop-composer-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-acceptance,vibe-strategy-factory-rd-owner-api/sealed-artifact-source-browser-acceptance,vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance,vibe-product-edge/sealed-deployment-acceptance' \
    "$repository_root/Makefile" || ! rg -Uq \
    'cargo-test-rd-owner-postgres-isolated: check-nextest-installed.*\n\tNEXTEST_PROFILE="\$\(NEXTEST_PROFILE\)".*\n\tCARGO_CI_PROFILE="\$\(CARGO_CI_PROFILE\)".*\n\tRD_OWNER_POSTGRES_FEATURES="\$\(RD_OWNER_POSTGRES_FEATURES\)"' \
    "$repository_root/Makefile"; then
    echo "ERROR: Makefile must pass the sealed Develop Composer feature union to the shared nextest graph." >&2
    return 1
  fi
  # Three consumers of the one feature graph: the rust tests step and the chain archive job in
  # build.yml, and the R&D chain legs, whose make line owner-chain-matrix.py generates for both
  # workflows.
  if [[ "$(rg -c 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
    "$repository_root/.github/workflows/build.yml")" -ne 2 ]] ||
    [[ "$(rg -c 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
      "$repository_root/scripts/ci/owner-chain-matrix.py")" -ne 1 ]]; then
    echo "ERROR: the rust tests step, the chain archive job and the chain legs must all pass the shared feature graph." >&2
    return 1
  fi
  if ! rg -Uq \
    'RUST_TEST_EXTRA_FEATURES: >-\n[[:space:]]+capnp,hypersync,vibe-serialization/sbe,vibe-infrastructure/postgres,\n[[:space:]]+vibe-strategy-factory/sealed-develop-composer-acceptance,\n[[:space:]]+vibe-strategy-factory-rd-owner-api/sealed-source-intake-acceptance,\n[[:space:]]+vibe-strategy-factory-rd-owner-api/sealed-artifact-source-browser-acceptance,\n[[:space:]]+vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml"; then
    echo "ERROR: rd-owner-postgres workflow must define the complete Composer and Source Intake feature union." >&2
    return 1
  fi
  # The sealed browser inputs live in one composite action, and this pins that action rather than
  # any workflow's copy of it. Pinning a copy is how the divergence happened: this check watched
  # `rd-owner-postgres.yml`, `owner-chains.yml` grew a second copy, and `build.yml` never had one -
  # so the two channels AGENTS.md calls interchangeable disagreed, and the check stayed green
  # throughout because the file it watched was still correct.
  local browser_action="$repository_root/.github/actions/dashboard-browser-acceptance/action.yml"
  if [[ ! -f "$browser_action" ]]; then
    echo "ERROR: the sealed Dashboard browser acceptance action is missing." >&2
    return 1
  fi
  if ! rg -Fq 'DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE=1' "$browser_action" ||
    ! rg -Fq 'DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE=' "$browser_action" ||
    ! rg -Fq '${{ runner.temp }}/dashboard-strategy-viewer-chrome/chrome-linux64/chrome' \
      "$browser_action" ||
    ! rg -Fq 'npm ci --prefix product/dashboard' "$browser_action" ||
    ! rg -Fq 'ecae8b71d4890cf5f32577ab5ea1b3840c2b5e05f51490b1666674cf1f5b0c37' "$browser_action"; then
    echo "ERROR: the sealed Dashboard browser acceptance action must install immutable runtime inputs." >&2
    return 1
  fi
  # Every channel AGENTS.md accepts as chain evidence has to call it. A channel that does not still
  # runs entry 28 and still reports PASS - in milliseconds, having driven no browser - so its
  # absence here is indistinguishable from success in the chain's own output. Those channels are
  # `owner-chains` and `build`'s chain job; `rd-owner-postgres.yml` is not one (its own header says
  # why), so it is not listed.
  local acceptance_channel
  for acceptance_channel in owner-chains build; do
    if ! rg -Fq './.github/actions/dashboard-browser-acceptance' \
      "$repository_root/.github/workflows/${acceptance_channel}.yml"; then
      echo "ERROR: ${acceptance_channel}.yml claims to carry the Owner chain but never installs the sealed Dashboard browser acceptance inputs." >&2
      return 1
    fi
  done
  if ! rg -n 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml" > /dev/null; then
    echo "ERROR: rd-owner-postgres workflow must pass RUST_TEST_EXTRA_FEATURES to the isolated test graph." >&2
    return 1
  fi
  if ! rg -Uq \
    'cargo nextest archive.*\n[[:space:]]+"\$\{nextest_graph_args\[@\]\}".*\n[[:space:]]+--features "\$nextest_archive_features"' \
    "${BASH_SOURCE[0]}"; then
    echo "ERROR: nextest archive must compile the exact selected-package feature projection." >&2
    return 1
  fi
  if ! rg -Uq \
    "program_host_bar_joined_cut_postgres_acceptance_tests::owner_postgres_v4_moves_through_program_host_and_real_backtest'.*\n[[:space:]]+env.*\n[[:space:]]+VIBE_POSTGRES_TEST_DATABASE_NAME=\"\\\$program_host_acceptance_database\"" \
    "${BASH_SOURCE[0]}"; then
    echo "ERROR: Program Host acceptance must use its canonical fresh PostgreSQL clone." >&2
    return 1
  fi
  python3 - "${BASH_SOURCE[0]}" << 'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
catalog_test = "replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed"
bootstrap_test = "replay_policy_catalog_postgres_v2::postgres_tests::catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds"
poison_test = "postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation"
array_open = "readonly rd_owner_postgres_tests=(\n"
array_close = "\n)\nreadonly nextest_graph_args=("
if source.count(array_open) != 1:
    raise SystemExit("ERROR: ordered PostgreSQL test literal is unavailable.")
array_start = source.index(array_open) + len(array_open)
array_end = source.find(array_close, array_start)
if array_end < 0:
    raise SystemExit("ERROR: ordered PostgreSQL test literal boundary is unavailable.")
array_body = source[array_start:array_end]
entry_pattern = re.compile(r"  '([A-Za-z0-9_|:-]+)'")
entries = []
for line in array_body.splitlines():
    if not line.strip():
        continue
    match = entry_pattern.fullmatch(line)
    if match is None:
        raise SystemExit(
            "ERROR: every ordered PostgreSQL test must be one strict single-quoted literal."
        )
    fields = match.group(1).split("|")
    if len(fields) != 3 or any(not field for field in fields):
        raise SystemExit("ERROR: ordered PostgreSQL test literal must contain three fields.")
    entries.append(tuple(fields))
# The count lives in one place. Writing it into the message as well lets the two drift, and the
# drifted form reads as nonsense the moment it fires: "must contain 92 entries, found 92".
expected_entries = 107
if len(entries) != expected_entries:
    raise SystemExit(
        f"ERROR: ordered PostgreSQL test literal must contain {expected_entries} entries, found {len(entries)}."
    )

# The count and the positional guards are independent, and that gap is how an entry lands in a
# slot nobody checks: raise the count, pin every index up to the old last one, and the new slot
# is unconstrained. An entry appended there is exactly what "destructive-drain-last" exists to
# refuse, and the positional guards stay green while it is false. So the guards must cover every
# position, checked here rather than left to whoever edits them to notice.
pinned_positions = {int(index) for index in re.findall(r"rd_owner_postgres_tests\[(\d+)\]", source)}
expected_positions = set(range(expected_entries))
if pinned_positions != expected_positions:
    unpinned = sorted(expected_positions - pinned_positions)
    out_of_range = sorted(pinned_positions - expected_positions)
    raise SystemExit(
        "ERROR: ordered PostgreSQL positional guards must pin every entry by name; "
        f"unpinned {unpinned}, out of range {out_of_range}."
    )
if sum(test_name == poison_test for _, _, test_name in entries) != 1:
    raise SystemExit(
        "ERROR: recovery-sidecar poison test must occur exactly once as a parsed test name."
    )
if sum(test_name == catalog_test for _, _, test_name in entries) != 1:
    raise SystemExit(
        "ERROR: catalog-admin route test must occur exactly once as a parsed test name."
    )
if sum(test_name == bootstrap_test for _, _, test_name in entries) != 1:
    raise SystemExit(
        "ERROR: catalog V3 bootstrap route test must occur exactly once as a parsed test name."
    )
loop_open = 'for chain_step in "${chain_run_order[@]}"; do\n'
loop_close = "\ndone\n\nlegacy_replay_fingerprint_after="
if source.count(loop_open) != 1:
    raise SystemExit("ERROR: ordered PostgreSQL execution loop is unavailable.")
loop_start = source.index(loop_open) + len(loop_open)
loop_end = source.find(loop_close, loop_start)
if loop_end < 0:
    raise SystemExit("ERROR: ordered PostgreSQL execution loop boundary is unavailable.")
loop_body = source[loop_start:loop_end]
exact_filter = '  test_filter="package(${test_package}) & binary(${test_binary}) & test(=${test_name})"'
filter_definitions = [
    line for line in loop_body.splitlines() if re.match(r"\s*test_filter=", line)
]
if filter_definitions != [exact_filter]:
    raise SystemExit("ERROR: ordered PostgreSQL loop must define one exact test filter.")
route = (
    f'''if [[ "$test_name" == '{catalog_test}' ]] ||\n'''
    f'''    [[ "$test_name" == '{bootstrap_test}' ]] ||\n'''
    f'''    [[ "$test_name" == '{poison_test}' ]]; then'''
)
if loop_body.count(route) != 1:
    raise SystemExit(
        "ERROR: Product Edge recovery-sidecar poison test must share the catalog-admin clone route."
    )
route_start = loop_body.index(route)
if loop_body.index(exact_filter) >= route_start:
    raise SystemExit("ERROR: exact test filter must be defined before database routing.")
pre_route_prefix = loop_body[:route_start]
test_filter_tokens = re.findall(
    r"(?<![A-Za-z0-9_])test_filter(?![A-Za-z0-9_])", pre_route_prefix
)
if len(test_filter_tokens) != 1:
    raise SystemExit(
        "ERROR: ordered PostgreSQL loop may touch test_filter only in its exact assignment."
    )
route_start += len(route)
route_end = loop_body.find('\n  elif [[ "$test_name"', route_start)
if route_end < 0:
    raise SystemExit("ERROR: catalog-admin clone route boundary is unavailable.")
route_body = loop_body[route_start:route_end]
expected_overrides = (
    ("VIBE_POSTGRES_TEST_DATABASE_NAME", '"$catalog_admin_database"'),
    ("OPERATOR_AUTHORIZATION_TEST_DATABASE_URL", '"postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("PRODUCT_EDGE_TEST_DATABASE_URL", '"postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("RD_OWNER_TEST_DATABASE_URL", '"postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("RD_FACT_WRITER_TEST_DATABASE_URL", '"postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("MARKET_DATA_OWNER_TEST_DATABASE_URL", '"postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL", '"postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL", '"postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL", '"postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("QUALIFICATION_TEST_DATABASE_URL", '"postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("BACKTEST_TEST_DATABASE_URL", '"postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("INSTRUMENT_OWNER_TEST_DATABASE_URL", '"postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("INSTRUMENT_OWNER_DATABASE_URL", '"postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("EXECUTION_OWNER_TEST_DATABASE_URL", '"postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("PORTFOLIO_OWNER_TEST_DATABASE_URL", '"postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("GOVERNANCE_OWNER_TEST_DATABASE_URL", '"postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("RISK_OWNER_TEST_DATABASE_URL", '"postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
    ("SCANNER_OWNER_TEST_DATABASE_URL", '"postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}"'),
)
route_lines = route_body.splitlines()
if route_lines[:2] != ["", "    env \\"]:
    raise SystemExit("ERROR: catalog-admin clone route env preamble is unavailable.")
try:
    invocation_start = next(
        index for index, line in enumerate(route_lines) if line.strip() == "cargo nextest run \\"
    )
except StopIteration:
    raise SystemExit("ERROR: catalog-admin clone route nextest invocation is unavailable.")
assignment_pattern = re.compile("\\s*([A-Z][A-Z0-9_]*)=(.*) \\\\")
assignments = []
for line in route_lines[2:invocation_start]:
    match = assignment_pattern.fullmatch(line)
    if match is None:
        raise SystemExit("ERROR: catalog-admin clone route env preamble contains a non-assignment.")
    assignments.append((match.group(1), match.group(2)))
if tuple(assignments) != expected_overrides:
    raise SystemExit(
        "ERROR: catalog-admin clone route must retain the complete ordered database URL override set."
    )
expected_invocation = (
    "cargo nextest run \\",
    '"${nextest_reuse_args[@]}" \\',
    '--profile "$nextest_profile" \\',
    '"${nextest_execution_args[@]}" \\',
    '-E "$test_filter"',
)
invocation = tuple(line.strip() for line in route_lines[invocation_start:])
if invocation != expected_invocation:
    raise SystemExit(
        "ERROR: catalog-admin clone route must retain one exact selected-test nextest invocation."
    )
PY
  if ! rg -Uq \
    "strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody'.*\n[[:space:]]+\[\[.*successor_artifact_enters_exploratory_replay_with_exact_owner_custody'.*\n[[:space:]]+\[\[.*analysis_request_completion_resolve_restart_and_tamper_are_atomic'.*\n[[:space:]]+\[\[.*backtest_run_report_reads_back_every_point_a_real_run_committed'.*\n[[:space:]]+\[\[.*positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic'.*\n[[:space:]]+\[\[.*test_binary.*trial_family_owner'.*\n[[:space:]]+\[\[.*test_name.*artifact_build_postgres::postgres_freshness_tests::\*.*\n[[:space:]]+\[\[.*test_binary.*source_intake'.*\n[[:space:]]+\[\[.*test_binary.*vibe_qualification'.*\n[[:space:]]+\[\[.*postgres_protected_v3_results_and_attempt_frontiers_close_every_terminal_lineage'.*\n[[:space:]]+\[\[.*second_request_under_one_principal_resolves_through_the_frontier_arm'.*\n[[:space:]]+\[\[.*test_name.*product_edge_postgres::tests::postgres_v3_\*.*\n[[:space:]]+RUST_MIN_STACK=16777216.*\n[[:space:]]+cargo nextest run" \
    "${BASH_SOURCE[0]}"; then
    echo "ERROR: large composed acceptances must use their admitted test-thread stack." >&2
    return 1
  fi
}

# Both PostgreSQL containers start under an init. Without one the postmaster is PID 1 and reaps the
# orphaned heredoc writer of every refused authority migration as a crashed backend (the comment at
# the first `docker run` says how), so the cluster crash-restarts mid-chain.
check_postgres_containers_run_under_init() {
  local runs inits
  runs="$(rg -c '^docker run \\$' "${BASH_SOURCE[0]}" || true)"
  inits="$(rg -U -c '^docker run \\\n  --detach \\\n  --init \\$' "${BASH_SOURCE[0]}" || true)"
  if [[ "${runs:-0}" -ne 2 || "${inits:-0}" -ne 2 ]]; then
    echo "ERROR: the chain's PostgreSQL containers must start with --init: ${runs:-0} docker run, ${inits:-0} with --init." >&2
    return 1
  fi
  local market_data
  market_data="$(dirname "${BASH_SOURCE[0]}")/../../crates/data/tests/run_market_data_owner_postgres.bash"
  if [[ "$(rg -c '^docker run ' "$market_data" || true)" -ne 1 ]] ||
    ! rg -q '^docker run --detach --init ' "$market_data"; then
    echo "ERROR: the Market Data chain's PostgreSQL container must start with --init, as this chain's do." >&2
    return 1
  fi
}

check_static_isolation() {
  local forbidden_fallback
  forbidden_fallback='RD_OWNER_TEST_DATABASE_URL or RD_OWNER_DATABASE_URL|or_else\(\|\| std::env::var\("(RD_OWNER|PRODUCT_EDGE|OPERATOR_AUTHORIZATION|WINDMILL)_DATABASE_URL"\)'
  if rg -n --glob '*.rs' "$forbidden_fallback" "${guarded_roots[@]}"; then
    echo "ERROR: PostgreSQL tests may not fall back to a production/default database URL." >&2
    return 1
  fi

  python3 - "${guarded_roots[@]}" << 'PY'
from pathlib import Path
import re
import sys

destructive = re.compile(
    r'["\']\s*(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b',
    re.I,
)
isolated_test_database_guards = (
    "DedicatedPostgresTestDatabase",
    "CanonicalOwnerPostgresTestDatabaseV1",
)
failures = []
# These legacy internal harnesses predate the canonical Owner topology and are
# not selected by this entrypoint. Keep their debt explicit while enforcing the
# admitted capability on every selected/new vibe-data destructive oracle.
legacy_data_destructive_tests = {
    "crates/data/src/owner/postgres/sample_projection_v4.rs",
    "crates/data/src/owner/postgres/tests.rs",
}

# A negative-capability proof asserts that a statement is REFUSED. It deliberately
# holds no mutation capability - that is its subject - and vibe_testkit's
# `assert_statement_is_refused` runs it inside a transaction it always rolls back,
# so nothing is written even if the privilege regresses. Strip those call
# expressions and judge what is left: the literal must sit INSIDE the call, so
# hoisting it to a `const` loses the marker, keeps the literal, and is refused
# here. That direction is deliberate - a guard should fail loudly rather than let
# a file pass because it happens to contain one sanctioned call somewhere else.
REFUSAL_HELPER = "assert_statement_is_refused("


def strip_refusal_proofs(text: str) -> str:
    """Remove every `assert_statement_is_refused(...)` call, matching parens."""
    out = []
    index = 0
    while True:
        found = text.find(REFUSAL_HELPER, index)
        if found == -1:
            out.append(text[index:])
            return "".join(out)
        out.append(text[index:found])
        depth = 0
        cursor = found + len(REFUSAL_HELPER) - 1
        while cursor < len(text):
            if text[cursor] == "(":
                depth += 1
            elif text[cursor] == ")":
                depth -= 1
                if depth == 0:
                    break
            cursor += 1
        index = cursor + 1


for root in map(Path, sys.argv[1:]):
    for path in root.rglob("*.rs"):
        text = path.read_text(encoding="utf-8")
        if not destructive.search(strip_refusal_proofs(text)):
            continue
        if path.as_posix() in legacy_data_destructive_tests:
            continue
        recovery_owned_qualification = path.as_posix() in {
            "crates/qualification/src/postgres.rs",
            "crates/qualification/src/recovery.rs",
        }
        if (
            recovery_owned_qualification
            and "QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL" in text
        ):
            continue
        if (
            not any(guard in text for guard in isolated_test_database_guards)
            or ".mutation()" not in text
        ):
            failures.append(str(path))
w3_oracle = Path("crates/data/src/owner/replay_market_facts_v2/postgres_tests.rs")
w3_text = w3_oracle.read_text(encoding="utf-8")
w3_fault_ddl = re.compile(
    r'["\']\s*(?:CREATE\s+CONSTRAINT\s+TRIGGER|DROP\s+(?:TRIGGER|FUNCTION))\b',
    re.I,
)
if (
    w3_fault_ddl.search(w3_text)
    and (
        "CanonicalOwnerPostgresTestDatabaseV1" not in w3_text
        or ".mutation()" not in w3_text
    )
):
    failures.append(str(w3_oracle))
if failures:
    print("ERROR: destructive PostgreSQL test SQL lacks dedicated-database admission:", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}", file=sys.stderr)
    raise SystemExit(1)
PY
}

check_backtest_result_function_source() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - \
    "$repository_root/product/rd-workbench/postgres-init/10-migrate-authority-custody.sh" \
    "$repository_root/crates/backtest_result_custody/src/lib.rs" \
    "$repository_root/crates/backtest_result_custody/src/protected_replay.rs" \
    "$repository_root/scripts/ci/test-rd-owner-postgres.bash" << 'PY'
from pathlib import Path
import re
import sys

migration = Path(sys.argv[1]).read_text(encoding="utf-8")
rust = Path(sys.argv[2]).read_text(encoding="utf-8")
protected_rust = Path(sys.argv[3]).read_text(encoding="utf-8")
test_script = Path(sys.argv[4]).read_text(encoding="utf-8")
sql_match = re.search(
    r"CREATE OR REPLACE FUNCTION backtest_owner_api\.resolve_exploratory_replay_result_v2\("
    r".*?AS \$function\$(.*?)\$function\$;",
    migration,
    re.DOTALL,
)
rust_match = re.search(r'const FUNCTION_SOURCE: &str = "([^"]*)";', rust)
lock_sql_match = re.search(
    r"CREATE OR REPLACE FUNCTION backtest_authority_lock_api\.lock_authority_catalogs_v1\(\)"
    r".*?AS \$function\$(.*?)\$function\$;",
    migration,
    re.DOTALL,
)
lock_rust_match = re.search(
    r'const AUTHORITY_LOCK_FUNCTION_SOURCE: &str =\s*"([^"]*)";', rust
)
protected_sql_match = re.search(
    r"CREATE OR REPLACE FUNCTION backtest_owner_api\.resolve_protected_replay_result_v1\("
    r".*?AS \$function\$(.*?)\$function\$;",
    migration,
    re.DOTALL,
)
protected_rust_match = re.search(
    r'const FUNCTION_SOURCE: &str = r#"(.*?)"#;', protected_rust, re.DOTALL
)
frontier_sql_match = re.search(
    r"CREATE OR REPLACE FUNCTION backtest_owner_api\.resolve_protected_replay_attempt_frontier_v1\("
    r".*?AS \$function\$(.*?)\$function\$;",
    migration,
    re.DOTALL,
)
frontier_rust_match = re.search(
    r'const FRONTIER_FUNCTION_SOURCE: &str = r#"(.*?)"#;', protected_rust, re.DOTALL
)
if (
    sql_match is None
    or rust_match is None
    or lock_sql_match is None
    or lock_rust_match is None
    or protected_sql_match is None
    or protected_rust_match is None
    or frontier_sql_match is None
    or frontier_rust_match is None
):
    raise SystemExit("ERROR: Backtest Result locked-read source identity is unavailable")
if sql_match.group(1) != rust_match.group(1):
    raise SystemExit("ERROR: Backtest Result locked-read source identity mismatch")
if lock_sql_match.group(1) != lock_rust_match.group(1):
    raise SystemExit("ERROR: Backtest Result authority-lock source identity mismatch")
if protected_sql_match.group(1) != protected_rust_match.group(1):
    raise SystemExit("ERROR: protected Backtest Result locked-read source identity mismatch")
if frontier_sql_match.group(1) != frontier_rust_match.group(1):
    raise SystemExit("ERROR: protected Backtest frontier locked-read source identity mismatch")
required_isolation = (
    "CREATE SCHEMA IF NOT EXISTS backtest_authority_lock_api AUTHORIZATION postgres;",
    "misplaced Backtest authority-lock function provenance mismatch",
    "GRANT USAGE ON SCHEMA backtest_owner_api TO rd_owner, qualification_writer;",
    "namespace.nspname='backtest_authority_lock_api'",
    "pg_catalog.pg_class relation WHERE relation.relnamespace=namespace.oid",
    "pg_catalog.pg_default_acl default_acl WHERE default_acl.defaclnamespace=namespace.oid",
)
if any(required not in migration for required in required_isolation):
    raise SystemExit("ERROR: Backtest Result authority-lock schema isolation is unavailable")
runtime_census = (
    "pg_catalog.pg_class relation WHERE relation.relnamespace=namespace.oid",
    "pg_catalog.pg_type data_type WHERE data_type.typnamespace=namespace.oid",
    "pg_catalog.pg_operator operator WHERE operator.oprnamespace=namespace.oid",
    "pg_catalog.pg_default_acl default_acl WHERE default_acl.defaclnamespace=namespace.oid",
)
if any(required not in rust for required in runtime_census):
    raise SystemExit("ERROR: Backtest Result runtime namespace census is unavailable")
materializer_owner_api_routine_census = (
    "pg_catalog.count(*) BETWEEN 1 AND 4",
    "procedure.oid IN (",
    "backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text)",
    "backtest_owner_api.resolve_exploratory_replay_result_v3(text,text,text)",
    "backtest_owner_api.resolve_protected_replay_result_v1(text,text,text)",
    "backtest_owner_api.resolve_protected_replay_attempt_frontier_v1(text,text)",
)
runtime_owner_api_routine_census = (
    "WITH expected_function AS (",
    "expected_sibling_function AS (",
    "expected_protected_function AS (",
    "expected_protected_frontier_function AS (",
    "namespace.nspname='backtest_owner_api'",
    "procedure.proname=$2",
    "procedure.proname=$4",
    "procedure.proargtypes=ARRAY[",
    "procedure.oid=(SELECT oid FROM expected_function)",
    "SELECT oid FROM expected_sibling_function",
    "SELECT oid FROM expected_protected_function",
    "SELECT oid FROM expected_protected_frontier_function",
)
if any(required not in migration for required in materializer_owner_api_routine_census) or any(
    required not in rust for required in runtime_owner_api_routine_census
):
    raise SystemExit("ERROR: Backtest Owner API routine census is unavailable")
runtime_validator = rust.split("async fn validate_topology(", 1)[1].split("#[derive", 1)[0]
if "pg_catalog.to_regprocedure" in runtime_validator:
    raise SystemExit("ERROR: Backtest writer topology validation requires forbidden Owner API schema resolution")
if "GRANT USAGE ON SCHEMA backtest_owner_api TO rd_owner, backtest_owner;" in migration:
    raise SystemExit("ERROR: backtest_owner retains sibling Owner API namespace access")
owner_api_sibling_oracle = (
    "CREATE FUNCTION backtest_owner_api.poisoned_sibling_v1()",
    "SECURITY DEFINER\nSET search_path = pg_catalog, pg_temp",
    "ALTER FUNCTION backtest_owner_api.poisoned_sibling_v1() OWNER TO backtest_custodian",
    "REVOKE ALL ON FUNCTION backtest_owner_api.poisoned_sibling_v1() FROM PUBLIC",
    "GRANT EXECUTE ON FUNCTION backtest_owner_api.poisoned_sibling_v1() TO rd_owner",
    "if run_authority_migration; then",
    "DROP FUNCTION backtest_owner_api.poisoned_sibling_v1()",
    "authority migration accepted a sibling Backtest Owner API routine",
)
position = -1
for required in owner_api_sibling_oracle:
    position = test_script.find(required, position + 1)
    if position < 0:
        raise SystemExit("ERROR: Backtest Owner API sibling rejection oracle is unavailable")
if "backtest_authority_lock_api.poisoned_sibling_v1()" not in test_script:
    raise SystemExit("ERROR: authority-lock sibling rejection oracle is unavailable")
if "backtest_authority_lock_api.poisoned_relation_v1" not in test_script:
    raise SystemExit("ERROR: authority-lock object rejection oracle is unavailable")
authority_migration_wrapper = '''run_authority_migration() {
  if ! run_authority_migration_for_database "$test_database"; then
    return 1
  fi
  docker exec'''
if authority_migration_wrapper not in test_script:
    raise SystemExit("ERROR: authority migration wrapper does not preserve migration failure")
ordered_fences = re.compile(
    r"SELECT pg_catalog\.pg_advisory_xact_lock\(\s*"
    r"pg_catalog\.hashtextextended\('vibe\.backtest\.result-topology\.v2',0\)\s*"
    r"\);\s*LOCK TABLE pg_catalog\.pg_authid, pg_catalog\.pg_auth_members "
    r"IN SHARE ROW EXCLUSIVE MODE;"
)
inverted_fences = re.compile(
    r"LOCK TABLE pg_catalog\.pg_authid, pg_catalog\.pg_auth_members "
    r"IN SHARE ROW EXCLUSIVE MODE;\s*SELECT pg_catalog\.pg_advisory_xact_lock\(\s*"
    r"pg_catalog\.hashtextextended\('vibe\.backtest\.result-topology\.v2',0\)"
)
if len(ordered_fences.findall(migration)) != 1:
    raise SystemExit("ERROR: authority migration fence order is unavailable or duplicated")
if len(ordered_fences.findall(test_script)) != 4:
    raise SystemExit("ERROR: Backtest Result managed-fault fence order changed")
if inverted_fences.search(migration) or inverted_fences.search(test_script):
    raise SystemExit("ERROR: Backtest Result shared-catalog/advisory lock order is inverted")
if rust.index("pg_advisory_xact_lock_shared") > rust.index("let exact_lock"):
    raise SystemExit("ERROR: Backtest Result runtime fence order is inverted")
PY
}

check_exploratory_replay_read_fence_source() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - \
    "$repository_root/crates/strategy_factory/src/exploratory_replay/postgres.rs" \
    "$repository_root/crates/rd_exploratory_replay_custody/src/lib.rs" \
    "$repository_root/product/rd-workbench/postgres-init/10-migrate-authority-custody.sh" \
    "$repository_root/scripts/ci/test-rd-owner-postgres.bash" << 'PY'
from hashlib import sha256
from pathlib import Path
import re
import sys

postgres = Path(sys.argv[1]).read_text(encoding="utf-8")
custody = Path(sys.argv[2]).read_text(encoding="utf-8")
migration = Path(sys.argv[3]).read_text(encoding="utf-8")
test_script = Path(sys.argv[4]).read_text(encoding="utf-8")
helper_signatures = (
    "verify_exploratory_replay_request_internal_v1",
    "verify_exploratory_replay_request_internal_v2",
    "verify_exploratory_replay_request_internal_v3",
)
shared_lock = (
    "pg_catalog.pg_advisory_xact_lock_shared(\n"
    "            pg_catalog.hashtextextended(requested_request_identity,0)\n"
    "          );"
)
for helper in helper_signatures:
    version = helper.rsplit("_v", 1)[1]
    match = re.search(
        rf'const INTERNAL_VERIFY_SOURCE_V{version}: &str = r#"(.*?)"#;',
        postgres,
        re.DOTALL,
    )
    if match is None:
        raise SystemExit(f"ERROR: {helper} source is unavailable")
    source = match.group(1)
    if source.count(shared_lock) != 1 or source.index(shared_lock) > source.index("FROM public."):
        raise SystemExit(f"ERROR: {helper} request fence is absent, duplicated, or ordered after its first read")
    if "FOR SHARE" in source:
        raise SystemExit(f"ERROR: {helper} requires forbidden table write privilege")
    digest = sha256(source.encode("utf-8")).hexdigest()
    if f'"{digest}"' not in custody:
        raise SystemExit(f"ERROR: {helper} authenticated source digest is stale")
    migration_source = re.search(
        rf'-- BEGIN INTERNAL_VERIFY_SOURCE_V{version}.*?AS \$function\$(.*?)\$function\$;',
        migration,
        re.DOTALL,
    )
    if migration_source is None or migration_source.group(1) != source:
        raise SystemExit(f"ERROR: {helper} authority migration source is stale")
exclusive_lock = (
    'sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock('
    'pg_catalog.hashtextextended($1,0))")\n'
    '        .bind(&proposal.request_identity)'
)
if exclusive_lock not in postgres:
    raise SystemExit("ERROR: Replay commit does not hold the paired exclusive request fence")
canonical_v1_parameter = (
    "verify_exploratory_replay_request_internal_v1(requested_request_identity text,"
    "requested_request_digest text,requested_receipt_identity text)"
)
drift_source = test_script.rsplit(
    "CREATE FUNCTION vibe_test_admin.drift_rd_exploratory_replay_routine_v1(", 1
)[1].split("$function$;", 1)[0]
if canonical_v1_parameter not in drift_source:
    raise SystemExit("ERROR: V1 helper drift oracle changes the canonical parameter identity")
PY
}

# Every literal below is a line that some other file in this repository writes, so a miss means that
# file moved rather than that this check is wrong - and the author needs to be told which line moved.
# A bare `rg -Fq` or `test` cannot tell them: under `set -euo pipefail` either one ends the whole
# script on a miss, and `-q` discards the only output there was. Run 35650397288 ended exactly that
# way: a hosted runner spent on the ordered chain, and between the `make` line and `Error 1` the log
# held nothing at all - no entry, no reason. The branch under it had given `market_data_reader` a
# password, so one pinned literal stopped matching. Naming that literal would have been the whole
# diagnosis, and it cost a thirty-minute run not to have it.
require_exact_line_once() {
  local literal="$1" file="$2" proves="$3"
  local found
  # `rg -Fxc` prints nothing and exits 1 when nothing matches, so `|| true` would leave `found` empty
  # and the message below would carry no number at all.
  found="$(rg -Fxc -- "$literal" "$file" || echo 0)"
  if [[ "$found" != 1 ]]; then
    echo "ERROR: ${proves}: expected this line exactly once in ${file}, found ${found}: ${literal}" >&2
    return 1
  fi
}

require_literal_present() {
  local literal="$1" file="$2" proves="$3"
  if ! rg -Fq -- "$literal" "$file"; then
    echo "ERROR: ${proves}: this exact text is no longer in ${file}: ${literal}" >&2
    return 1
  fi
}

check_market_data_principal_bootstrap_order() {
  local repository_root bootstrap migration bootstrap_line materializer_line
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  bootstrap="$repository_root/product/rd-workbench/postgres-init/00-create-rd-owner.sh"
  migration="$repository_root/product/rd-workbench/postgres-init/10-migrate-authority-custody.sh"
  require_exact_line_once 'CREATE ROLE market_data_owner NOLOGIN;' "$bootstrap" \
    'the bootstrap creates the Market Data owner with no login of its own'
  require_exact_line_once 'CREATE ROLE market_data_reader NOLOGIN;' "$bootstrap" \
    'the bootstrap creates the Market Data reader with no login of its own'
  require_exact_line_once 'GRANT rd_exploratory_replay_api_owner TO rd_owner;' "$bootstrap" \
    'the R&D Owner holds the exploratory replay API role'
  require_exact_line_once 'GRANT USAGE, CREATE ON SCHEMA rd_owner_api TO rd_exploratory_replay_api_owner;' "$bootstrap" \
    'the exploratory replay API role owns the schema it writes'
  require_literal_present 'REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC, operator_authorization_writer, qualification_writer, rd_exploratory_replay_api_owner;' "$migration" \
    'the migration closes the R&D Owner API schema to every principal that must not hold it'
  require_literal_present 'REVOKE ALL ON FUNCTION rd_owner_api.lock_market_data_repair_request_v1(text,text,text,text) FROM PUBLIC, market_data_owner, market_data_reader, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner' \
    "$repository_root/crates/strategy_factory/src/market_data_repair_request_postgres.rs" \
    'the repair-request lock is revoked from every principal outside the R&D Owner'
  require_literal_present 'REVOKE replay_policy_catalog_owner, replay_policy_catalog_admin_writer, composer_owner, rd_exploratory_replay_api_owner, market_data_owner, rd_database_owner FROM rd_owner, rd_fact_writer, market_data_reader;' "$migration" \
    'the migration strips the Owner roles this chain must not inherit'
  if rg -n 'CREATE ROLE market_data_(owner|reader) LOGIN|market_data_(owner|reader).*PASSWORD|GRANT .*market_data_(owner|reader)|GRANT market_data_(owner|reader)' "$bootstrap"; then
    echo "ERROR: bootstrap must not admit Market Data login, password, membership, or grants" >&2
    return 1
  fi
  require_literal_present "ALTER ROLE market_data_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'market_data_owner_password';" "$migration" \
    'the migration, not the bootstrap, is where the Market Data owner gains its login'
  require_literal_present "ALTER ROLE market_data_reader LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'market_data_reader_password';" "$migration" \
    'the migration, not the bootstrap, is where the Market Data reader gains its login'
  # `|| true` on both pipelines: under `pipefail` an unmatched `rg` would fail the whole substitution
  # and end the script before the emptiness below could be reported. Neither message below may spell
  # the materializer flag out, because these two greps count occurrences in this very file and a
  # message holding the literal would add one: `tail -1` happens to survive that today only because
  # the messages sit above the real invocation. The emptiness branch is reachable through the
  # bootstrap side alone - `00-create-rd-owner\.sh` carries a backslash and so does not match the
  # line that greps for it, while the materializer pattern always matches its own line.
  bootstrap_line="$(rg -n '00-create-rd-owner\.sh' "${BASH_SOURCE[0]}" | tail -1 | cut -d: -f1 || true)"
  materializer_line="$(rg -n -- '--materialize-schema' "${BASH_SOURCE[0]}" | tail -1 | cut -d: -f1 || true)"
  if [[ -z "$bootstrap_line" || -z "$materializer_line" ]]; then
    echo "ERROR: this script no longer names both the bootstrap and the schema materializer, so their order cannot be read: bootstrap='${bootstrap_line}' materializer='${materializer_line}'." >&2
    return 1
  fi
  if [[ "$bootstrap_line" -ge "$materializer_line" ]]; then
    echo "ERROR: the bootstrap must run before the schema materializer, but this script names the bootstrap at line ${bootstrap_line} and the materializer at line ${materializer_line}." >&2
    return 1
  fi
}

# The chain opens the Composer-backed Replay feature in an acceptance build; the deployed image
# must not. The deployment builds two crates that define it - `vibe-strategy-factory-rd-owner-api`
# in `Dockerfile.owner` and `vibe-strategy-factory` in `Dockerfile.sandbox` - with no `--features`,
# over default feature sets that are empty, and migrates its database with the acceptance switch
# unset. Those are what keep a wider chain union from reaching a deployed image, so they are pinned
# here, next to the union they are the other side of.
check_composer_acceptance_stays_in_the_chain() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local migration_calls switch_calls
  migration_calls="$(rg -c '^[[:space:]]+"\$container" sh -s < product/rd-workbench/postgres-init/10-migrate-authority-custody\.sh$' "${BASH_SOURCE[0]}" || true)"
  switch_calls="$(rg -c '^[[:space:]]+--env "SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE=\$\{composer_acceptance_migration\}" \\$' "${BASH_SOURCE[0]}" || true)"
  if [[ "${migration_calls:-0}" -lt 1 || "${migration_calls:-0}" != "${switch_calls:-0}" ]]; then
    echo "ERROR: every 10-migrate-authority-custody.sh run in this chain must pass SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE from the union: ${migration_calls:-0} runs, ${switch_calls:-0} pass it." >&2
    return 1
  fi
  # A switch typed in as a literal passes today and goes wrong the day the union changes.
  local expected_switch=0
  [[ ",${nextest_archive_features}," != *",vibe-strategy-factory-rd-owner-api/sealed-source-intake-composer-acceptance,"* ]] ||
    expected_switch=1
  if [[ "$composer_acceptance_migration" != "$expected_switch" ]]; then
    echo "ERROR: the Composer acceptance switch no longer follows the chain feature union." >&2
    return 1
  fi
  local dockerfile package manifest
  for dockerfile in Dockerfile.owner:vibe-strategy-factory-rd-owner-api Dockerfile.sandbox:vibe-strategy-factory; do
    package="${dockerfile#*:}"
    dockerfile="$repository_root/product/rd-workbench/${dockerfile%%:*}"
    if ! rg -q -F "cargo build --locked --release -p $package " "$dockerfile"; then
      echo "ERROR: $dockerfile no longer builds $package the way this check reads it." >&2
      return 1
    fi
    if rg -q -e '--features' -e '--all-features' "$dockerfile"; then
      echo "ERROR: $dockerfile passes a feature to a deployed build; the chain's acceptance union must not reach it." >&2
      return 1
    fi
  done
  for manifest in strategy_factory_rd_owner_api strategy_factory; do
    if ! awk '/^\[features\]/{f=1;next} /^\[/{f=0} f && $0=="default = []"{found=1} END{exit !found}' \
      "$repository_root/crates/$manifest/Cargo.toml"; then
      echo "ERROR: crates/$manifest must keep an empty default feature set; a deployed build takes its defaults." >&2
      return 1
    fi
  done
  local deploy_setters
  deploy_setters="$(git -C "$repository_root" grep -l -F SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE -- product/rd-workbench \
    ':!product/rd-workbench/postgres-init/10-migrate-authority-custody.sh' \
    ':!product/rd-workbench/scripts/check/authority.bash' || true)"
  if [[ -n "$deploy_setters" ]]; then
    echo "ERROR: the deployment names SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE: ${deploy_setters//$'\n'/, }" >&2
    return 1
  fi
}

# Owner code says why it refused through `tracing` - `refused_by_store` and its peers - and a test
# process drops every such event unless something subscribes. vibe-testkit's admission installs a
# subscriber that appends WARN and above to VIBE_TEST_LOG_FILE (its `TEST_LOG_FILE_ENV`), which each
# entry points beside its record. The collector's first line is this marker, so a file without it
# means the entry was not observed - it never admitted through vibe-testkit, or another subscriber
# took its events - and it is reported that way rather than counted as quiet.
readonly chain_log_collecting_marker='vibe-testkit: collecting WARN and above for this test process'

# sqlx's own performance hints, matched by target and message rather than by lacking a coordinate:
# a slow statement, and a pool acquire past its slow threshold. They say the runner was slow, not
# that an Owner refused, and on a slower runner a lock-contention proof emits nine of them.
readonly chain_log_sqlx_performance_hint='^[^ ]+ +WARN sqlx::(query: slow statement: |pool::acquire: acquired connection, but time to acquire exceeded slow threshold)'

# Three buckets, because the report exists so that a new refusal gets noticed. Refusals carry a
# `coordinate=` and are listed by entry and coordinate. sqlx performance hints are only totalled.
# Anything else - a sqlx connection error, an Owner cause logged without a coordinate - is listed by
# entry with its first line, never folded into either of the other two.
report_collected_warnings() {
  local record_dir="$1" entry_count="$2" position log events coordinates other count first
  local collected=0 refusing=0 othering=0 hints=0
  local -a unobserved=() refusal_lines=() other_lines=()
  for position in $(seq 1 "$entry_count"); do
    log="$(printf '%s/%03d.log' "$record_dir" "$position")"
    if [[ ! -f "$log" || "$(head -n 1 -- "$log")" != "$chain_log_collecting_marker" ]]; then
      unobserved+=("$position")
      continue
    fi
    collected=$((collected + 1))
    # Events only: the marker line itself says "WARN".
    events="$(tail -n +2 -- "$log" | grep -E '^[^ ]+ +WARN ' || true)"
    [[ -n "$events" ]] || continue
    count="$(printf '%s\n' "$events" | grep -cE "$chain_log_sqlx_performance_hint" || true)"
    hints=$((hints + count))
    events="$(printf '%s\n' "$events" | grep -vE "$chain_log_sqlx_performance_hint" || true)"
    [[ -n "$events" ]] || continue
    coordinates="$(printf '%s\n' "$events" | grep -o 'coordinate="[^"]*"' | sed -e 's/^coordinate="//' -e 's/"$//' | sort -u | paste -sd ' ' - || true)"
    if [[ -n "$coordinates" ]]; then
      refusing=$((refusing + 1))
      refusal_lines+=("  refused, entry ${position}: ${coordinates}")
    fi
    other="$(printf '%s\n' "$events" | grep -v 'coordinate="' || true)"
    if [[ -n "$other" ]]; then
      othering=$((othering + 1))
      count="$(printf '%s\n' "$other" | grep -c '' || true)"
      first="$(printf '%s\n' "$other" | head -n 1 | sed -E 's/^[^ ]+ +WARN +//' | cut -c1-140)"
      other_lines+=("  other, entry ${position}: ${count} warning(s), first: ${first}")
    fi
  done
  echo "=== owner warnings: collected for ${collected}/${entry_count} entries; refusals in ${refusing}, other warnings in ${othering}, ${hints} sqlx performance hint(s) in total"
  if [[ "${#refusal_lines[@]}" -gt 0 ]]; then
    printf '%s\n' "${refusal_lines[@]}"
  fi
  if [[ "${#other_lines[@]}" -gt 0 ]]; then
    printf '%s\n' "${other_lines[@]}"
  fi
  if [[ "${#unobserved[@]}" -gt 0 ]]; then
    echo "    not observed (no collector): ${unobserved[*]}"
  fi
}

# The collector's positive control. `durable_owner_is_atomic_restart_exact_and_fail_closed`
# constructs two refusals on purpose - it installs an extra Composer routine
# (`tests/develop_composer_owner_v2.rs:149-186`) and flips one bit of a stored Design (:298-319) -
# and each is reported through `refused_by_store` with its own coordinate. Neither depends on a
# live defect, so both must appear every round. A missing one means either the collector stopped
# collecting or that deliberate refusal no longer reports where it did; both need a look, and a
# chain that passes without either would be reporting quiet entries it cannot see.
require_collected_positive_control() {
  local record_dir="$1" position="$2" log coordinate
  log="$(printf '%s/%03d.log' "$record_dir" "$position")"
  if [[ ! -f "$log" || "$(head -n 1 -- "$log")" != "$chain_log_collecting_marker" ]]; then
    echo "ERROR: entry ${position} ran without the warning collector; ${log} does not begin with its marker." >&2
    return 1
  fi
  for coordinate in develop_composer.read_authority.routines develop_composer.role_set.project; do
    if ! grep -Fq "coordinate=\"${coordinate}\"" -- "$log"; then
      echo "ERROR: entry ${position} constructs a refusal reported as ${coordinate}, and ${log} does not hold it." >&2
      return 1
    fi
  done
}

# The warning report and its positive control, on fixed files. A file holding only the collector's
# marker must count as zero warnings: the marker line itself says "WARN", and the first version of
# the report counted it, so every collected entry read as having warned once. Each other kind of line
# must land in its own bucket, so a sqlx hint can never pass for a refusal or hide one.
check_collected_warning_report() {
  local fixtures report
  fixtures="$(mktemp -d)"
  printf '%s\n' "$chain_log_collecting_marker" > "$fixtures/001.log"
  printf '%s\n%s\n' "$chain_log_collecting_marker" \
    '2026-01-01T00:00:00.000000Z  WARN vibe_strategy_factory::storage_diagnostic: R&D Owner refused into SubmittedOrUnknown coordinate="fixture.refusal" cause=fixture' \
    > "$fixtures/002.log"
  printf '%s\n%s\n%s\n' "$chain_log_collecting_marker" \
    '2026-01-01T00:00:00.000000Z  WARN sqlx::query: slow statement: execution time exceeded alert threshold summary="SELECT 1" elapsed=1.5' \
    '2026-01-01T00:00:00.000000Z  WARN sqlx::pool::acquire: acquired connection, but time to acquire exceeded slow threshold acquired_after_secs=2.5' \
    > "$fixtures/003.log"
  printf '%s\n%s\n' "$chain_log_collecting_marker" \
    '2026-01-01T00:00:00.000000Z  WARN sqlx_core::pool::connection: error occurred while testing the connection on-release error=fixture' \
    > "$fixtures/004.log"
  report="$(report_collected_warnings "$fixtures" 5)"
  if [[ "$report" != *"=== owner warnings: collected for 4/5 entries; refusals in 1, other warnings in 1, 2 sqlx performance hint(s) in total"* ]] ||
    [[ "$report" == *"entry 1:"* ]] ||
    [[ "$report" != *"  refused, entry 2: fixture.refusal"* ]] ||
    [[ "$report" == *"entry 3:"* ]] ||
    [[ "$report" != *"  other, entry 4: 1 warning(s), first: sqlx_core::pool::connection: error occurred while testing the connection on-release error=fixture"* ]] ||
    [[ "$report" != *"not observed (no collector): 5"* ]]; then
    rm -rf -- "$fixtures"
    echo "ERROR: the warning report misfiles its fixed cases (marker only: nothing; a coordinate: refused; sqlx slow statement or acquire: a hint total only; anything else: other; no file: not observed):" >&2
    printf '%s\n' "$report" >&2
    return 1
  fi
  printf '%s\n%s\n%s\n' "$chain_log_collecting_marker" \
    'x  WARN y: z coordinate="develop_composer.read_authority.routines"' \
    'x  WARN y: z coordinate="develop_composer.role_set.project"' > "$fixtures/005.log"
  if ! require_collected_positive_control "$fixtures" 5 2> /dev/null; then
    rm -rf -- "$fixtures"
    echo "ERROR: the collector's positive control refuses a log that holds both coordinates." >&2
    return 1
  fi
  printf '%s\n' "$chain_log_collecting_marker" > "$fixtures/005.log"
  if require_collected_positive_control "$fixtures" 5 2> /dev/null; then
    rm -rf -- "$fixtures"
    echo "ERROR: the collector's positive control accepts a log that holds neither coordinate." >&2
    return 1
  fi
  rm -rf -- "$fixtures"
}

check_trial_family_candidate_experiment_cutover() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - \
    "$repository_root/crates/strategy_factory/src/trial_family_postgres.rs" \
    "$repository_root/crates/strategy_factory/src/iteration_decision_postgres.rs" \
    "$repository_root/product/rd-workbench/postgres-init/10-migrate-authority-custody.sh" \
    "$repository_root/docs/owners/rd.md" \
    "$repository_root/docs/owners/rd.zh.md" \
    "$repository_root/scripts/ci/test-rd-owner-postgres.bash" << 'PY'
from pathlib import Path
import re
import sys

trial_family = Path(sys.argv[1]).read_text(encoding="utf-8")
iteration_decision = Path(sys.argv[2]).read_text(encoding="utf-8")
migration = Path(sys.argv[3]).read_text(encoding="utf-8")
owner_doc = Path(sys.argv[4]).read_text(encoding="utf-8")
owner_doc_zh = Path(sys.argv[5]).read_text(encoding="utf-8")
test_script = Path(sys.argv[6]).read_text(encoding="utf-8")
table = "rd_trial_family_candidate_experiments_v1"

if f'table!("{table}", &[], [' not in trial_family:
    raise SystemExit("ERROR: Candidate experiment custody is not R&D Owner-only")

create = f"CREATE TABLE IF NOT EXISTS public.{table} ("
if migration.count(create) != 1:
    raise SystemExit("ERROR: existing-cutover Candidate experiment materialization is absent or duplicated")
if migration.index(create) > migration.index("DO $rd_ownership$"):
    raise SystemExit("ERROR: Candidate experiment relation is materialized after R&D ownership cutover")
rust_create = re.search(
    rf'"(CREATE TABLE IF NOT EXISTS {table} \(.*?\))"', trial_family
)
migration_create = re.search(
    rf"CREATE TABLE IF NOT EXISTS public\.{table} \(.*?\n\);", migration, re.DOTALL
)
normalize = lambda statement: " ".join(
    statement.replace("public.", "").rstrip(";").split()
).replace("( ", "(").replace(" )", ")")
if (
    rust_create is None
    or migration_create is None
    or normalize(rust_create.group(1)) != normalize(migration_create.group(0))
):
    raise SystemExit("ERROR: Rust and existing-cutover Candidate experiment schemas diverge")
required_shape = (
    "experiment_identity TEXT PRIMARY KEY",
    "trial_family_identity TEXT NOT NULL REFERENCES public.rd_trial_families_v1(trial_family_identity)",
    "candidate_set_frontier_identity TEXT NOT NULL REFERENCES public.rd_trial_family_attempt_cuts_v2(candidate_set_frontier_identity)",
    "experiment_storage_bytes BYTEA NOT NULL",
    "experiment_storage_digest TEXT NOT NULL",
    "receipt_storage_bytes BYTEA NOT NULL",
    "receipt_storage_digest TEXT NOT NULL",
    "UNIQUE (trial_family_identity, attempt_ordinal, candidate_identity)",
)
if any(fragment not in migration for fragment in required_shape):
    raise SystemExit("ERROR: existing-cutover Candidate experiment relation shape is incomplete")

replay_grant = migration.split("GRANT SELECT ON TABLE", 1)[1].split(
    "TO rd_exploratory_replay_api_owner;", 1
)[0]
if table in replay_grant:
    raise SystemExit("ERROR: Replay verifier role has unneeded Candidate experiment SELECT")

acl_marker = "DO $candidate_experiment_acl_cutover$"
acl_end_marker = "$candidate_experiment_acl_cutover$;"
if migration.count(acl_marker) != 1:
    raise SystemExit("ERROR: Candidate experiment ACL convergence is absent or duplicated")
acl_start = migration.index(acl_marker)
acl_end = migration.index(acl_end_marker, acl_start) + len(acl_end_marker)
acl_cutover = migration[acl_start:acl_end]
if not (
    migration.index("$rd_ownership$;") < acl_start
    and acl_end < migration.index("ALTER DEFAULT PRIVILEGES FOR ROLE rd_owner")
):
    raise SystemExit("ERROR: Candidate experiment ACL convergence is outside the R&D ownership cutover")
def normalize_candidate_sql(source: str) -> str:
    source = re.sub(r"/\*.*?\*/", " ", source, flags=re.DOTALL)
    source = re.sub(r"--[^\n]*", " ", source)
    source = re.sub(
        r'"((?:""|[^"])*)"',
        lambda match: match.group(1).replace('""', '"'),
        source,
    )
    concatenated_literals = re.compile(r"'((?:''|[^'])*)'\s*\|\|\s*'((?:''|[^'])*)'")
    while True:
        collapsed = concatenated_literals.sub(
            lambda match: "'"
            + (
                match.group(1).replace("''", "'")
                + match.group(2).replace("''", "'")
            ).replace("'", "''")
            + "'",
            source,
        )
        if collapsed == source:
            break
        source = collapsed
    return " ".join(source.lower().split())

allowed_acl_cutover = """DO $candidate_experiment_acl_cutover$
DECLARE grant_fact record;
BEGIN
  FOR grant_fact IN
    SELECT DISTINCT acl.grantee, role.rolname
    FROM pg_catalog.pg_class relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl
    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE relation.oid='public.rd_trial_family_candidate_experiments_v1'::pg_catalog.regclass
      AND acl.grantee<>relation.relowner
  LOOP
    IF grant_fact.grantee=0 THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.rd_trial_family_candidate_experiments_v1 FROM PUBLIC CASCADE';
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE public.rd_trial_family_candidate_experiments_v1 FROM %I CASCADE',
        grant_fact.rolname
      );
    END IF;
  END LOOP;
  FOR grant_fact IN
    SELECT DISTINCT attribute.attname, acl.grantee, role.rolname
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE relation.oid='public.rd_trial_family_candidate_experiments_v1'::pg_catalog.regclass
      AND attribute.attnum>0
      AND NOT attribute.attisdropped
      AND acl.grantee<>relation.relowner
  LOOP
    IF grant_fact.grantee=0 THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%I) ON TABLE public.rd_trial_family_candidate_experiments_v1 FROM PUBLIC CASCADE',
        grant_fact.attname
      );
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%I) ON TABLE public.rd_trial_family_candidate_experiments_v1 FROM %I CASCADE',
        grant_fact.attname,
        grant_fact.rolname
      );
    END IF;
  END LOOP;
END
$candidate_experiment_acl_cutover$;"""

def acl_cutover_is_allowlisted(source: str) -> bool:
    return normalize_candidate_sql(source) == normalize_candidate_sql(allowed_acl_cutover)

if not acl_cutover_is_allowlisted(acl_cutover):
    raise SystemExit("ERROR: Candidate experiment ACL block contains a non-allowlisted statement")
acl_body = acl_cutover.index("BEGIN") + len("BEGIN")
for injected_statement in (
    "\nDELETE FROM public.rd_trial_family_candidate_experiments_v1;",
    "\nEXECUTE 'DELETE FROM public.rd_trial_family_' || 'candidate_experiments_v1';",
):
    mutated_acl_cutover = (
        acl_cutover[:acl_body] + injected_statement + acl_cutover[acl_body:]
    )
    if acl_cutover_is_allowlisted(mutated_acl_cutover):
        raise SystemExit("ERROR: Candidate experiment ACL block allowlist accepts target mutation")

sql_start = migration.index("BEGIN;", migration.index("<< 'SQL'"))
sql_end = migration.rindex("COMMIT;\nSQL") + len("COMMIT;")
migration_transaction = migration[sql_start:sql_end]
allowed_create = migration_create.group(0)
if migration_transaction.count(allowed_create) != 1 or migration_transaction.count(acl_cutover) != 1:
    raise SystemExit("ERROR: Candidate experiment migration allowlist boundaries are ambiguous")
unlisted_statements = migration_transaction.replace(allowed_create, "", 1).replace(
    acl_cutover, "", 1
)
target_reference = re.compile(rf"\b(?:public\.)?{re.escape(table)}\b")
read_only_copy_to = re.compile(
    rf"\bcopy\s+(?:public\.)?{re.escape(table)}(?:\s*\([^;]*?\))?\s+to\b[^;]*;"
    rf"|\bcopy\s*\(\s*select\b[^;]*\b(?:public\.)?{re.escape(table)}\b[^;]*\)\s+to\b[^;]*;"
)
dynamic_target_parts = re.compile(
    r"\bexecute\b(?=[^;]*\brd_trial_family_)(?=[^;]*\bcandidate_experiments_v1\b)[^;]*;"
)

def has_unlisted_target_statement(source: str) -> bool:
    normalized = normalize_candidate_sql(source)
    normalized = read_only_copy_to.sub("", normalized)
    return (
        target_reference.search(normalized) is not None
        or dynamic_target_parts.search(normalized) is not None
    )

if has_unlisted_target_statement(unlisted_statements):
    raise SystemExit("ERROR: Candidate experiment migration contains a non-allowlisted target statement")
for forbidden_probe in (
    f'INSERT INTO public.{table} SELECT * FROM source;',
    f'UPDATE /* normalized comment */ "public"."{table}" SET candidate_digest=\'tampered\';',
    f'DELETE FROM public.{table};',
    f'TRUNCATE TABLE ONLY public.{table};',
    f'MERGE INTO public.{table} USING source ON false WHEN NOT MATCHED THEN INSERT DEFAULT VALUES;',
    "EXECUTE 'DELETE FROM public.rd_trial_family_' || 'candidate_experiments_v1';",
    "EXECUTE pg_catalog.format('DELETE FROM %I.%s%s','public','rd_trial_family_','candidate_experiments_v1');",
    f'COPY "public"."{table}" FROM STDIN;',
    f'COPY "public"."{table}" FROM \'/tmp/to\';',
):
    if not has_unlisted_target_statement(forbidden_probe):
        raise SystemExit("ERROR: Candidate experiment statement allowlist accepts target mutation")
for allowed_probe in (
    f'COPY "public"."{table}" TO STDOUT;',
    f'COPY (SELECT * FROM "public"."{table}") TO STDOUT;',
):
    if has_unlisted_target_statement(allowed_probe):
        raise SystemExit("ERROR: Candidate experiment statement allowlist rejects read-only COPY TO")

cutover_oracle = test_script.rsplit(
    'existing_cutover_candidate_experiment_fingerprint_before="$(', 1
)[1].split("CREATE ROLE vibe_test_owner_topology_admin", 1)[0]
ordered_oracle = (
    "DROP TABLE public.rd_trial_family_candidate_experiments_v1;",
    'run_authority_migration_for_database "$test_database"',
    "verify_candidate_experiment_acl_convergence() {",
    "fingerprint_before=",
    "CREATE ROLE candidate_experiment_acl_grantor NOLOGIN;",
    "CREATE ROLE candidate_experiment_acl_delegate NOLOGIN;",
    "GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO rd_exploratory_replay_api_owner, surprise_replay_grantee;",
    "GRANT SELECT(experiment_identity), SELECT(candidate_digest)\n"
    "  ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO rd_exploratory_replay_api_owner, surprise_replay_grantee;",
    "GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO candidate_experiment_acl_grantor WITH GRANT OPTION;",
    "GRANT SELECT(experiment_identity), SELECT(candidate_digest)\n"
    "  ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO candidate_experiment_acl_grantor WITH GRANT OPTION;",
    "SET ROLE candidate_experiment_acl_grantor;",
    "GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO candidate_experiment_acl_delegate;",
    "GRANT SELECT(experiment_identity), SELECT(candidate_digest)\n"
    "  ON TABLE public.rd_trial_family_candidate_experiments_v1\n"
    "  TO candidate_experiment_acl_delegate;",
    "RESET ROLE;",
    'run_authority_migration_for_database "$test_database"',
    "fingerprint_after=",
    'run_authority_migration_for_database "$test_database"',
    "idempotent_fingerprint=",
)
position = -1
for fragment in ordered_oracle:
    position = cutover_oracle.find(fragment, position + 1)
    if position < 0:
        raise SystemExit("ERROR: Candidate experiment upgrade/ACL/idempotency oracle is incomplete or reordered")
fingerprint_helper = test_script.rsplit(
    "candidate_experiment_owner_only_fingerprint() {", 1
)[1].split("run_authority_migration_for_database() {", 1)[0]
if "AND EXISTS (\n    SELECT 1 FROM public.rd_trial_family_candidate_experiments_v1\n  )" not in fingerprint_helper:
    raise SystemExit("ERROR: Candidate experiment preservation fingerprint permits an empty target")

seed_test_name = "canonical_candidate_experiment_upgrade_seed_is_owner_issued_and_locked_readback_exact"
seed_fixture = trial_family.split(f"async fn {seed_test_name}", 1)[1].split(
    "\n    #[tokio::test]", 1
)[0]
for fragment in (
    "crate::schema_materialization::require_existing_public_tables(&pool, TABLES)",
    "persist_initial_family(&mut transaction, &family, &receipt)",
    "append_trial_family_attempt_in_transaction(",
    "issue_candidate_experiment_readbacks_v1(&census, &proposals, committed_at + 1)",
    "load_trial_family_census_v2_in_transaction(",
    "load_candidate_experiments_for_census_in_transaction(",
    "assert_eq!(locked_experiments, expected)",
):
    if fragment not in seed_fixture:
        raise SystemExit("ERROR: Candidate experiment upgrade seed bypasses Owner issuance/readback")
if (
    "migrate(&pool)" in seed_fixture
    or "INSERT INTO rd_trial_family_candidate_experiments_v1" in seed_fixture
    or "cleanup(" in seed_fixture
):
    raise SystemExit("ERROR: Candidate experiment upgrade seed bypasses post-cutover Owner custody")
seed_execution = test_script.rsplit('\n  build_nextest_archive "$nextest_archive_file"\n', 1)[1].split(
    "run_authority_migration() {", 1
)[0]
position = -1
for fragment in (
    'candidate_experiment_seed_filter="package(vibe-strategy-factory)',
    'cargo nextest run',
    '-E "$candidate_experiment_seed_filter"',
    "verify_candidate_experiment_acl_convergence",
):
    position = seed_execution.find(fragment, position + 1)
    if position < 0:
        raise SystemExit("ERROR: canonical Candidate experiment seed/readback must precede ACL poison")

successor_fixture = iteration_decision.split(
    "async fn successor_artifact_enters_exploratory_replay_with_exact_owner_custody()", 1
)[1].split("\n    #[tokio::test]", 1)[0]
if "candidate_experiment_digest_v1" in successor_fixture:
    raise SystemExit("ERROR: successor fixture recomputes Candidate digest outside Owner Census readback")
successor_evaluations = iteration_decision.split(
    "fn successor_candidate_evaluations(", 1
)[1].split("\n    #[tokio::test]", 1)[0]
for fragment in (
    ".candidate_set_frontier\n            .candidates()",
    ".find(|candidate| candidate.candidate_identity() == candidate_identity)",
    "candidate_digest: candidate.candidate_digest().to_string()",
):
    if fragment not in successor_evaluations:
        raise SystemExit("ERROR: successor fixture does not consume exact Owner Census Candidate identity/digest")

if "the nine relations traversed by the" in owner_doc or "\u5b9e\u9645\u904d\u5386\u7684\u4e5d\u5f20 relation" in owner_doc_zh:
    raise SystemExit("ERROR: R&D Owner docs retain a stale Replay verifier relation count")
PY
}

existing_cutover_replay_fingerprint() {
  docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$test_database" << 'SQL'
SELECT relation.oid::text || ':' || pg_catalog.encode(
  pg_catalog.convert_to(
    COALESCE(
      (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(replay) ORDER BY replay.request_identity)::text
         FROM public.rd_sealed_exploratory_replay_requests_v1 replay),
      'null'
    ),
    'UTF8'
  ),
  'hex'
)
FROM pg_catalog.pg_class relation
JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
  AND relation.relname='rd_sealed_exploratory_replay_requests_v1';
SQL
}

candidate_experiment_owner_only_fingerprint() {
  docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$test_database" << 'SQL'
SELECT relation.oid::text || ':' || pg_catalog.encode(
  pg_catalog.convert_to(
    COALESCE(
      (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(experiment) ORDER BY experiment.experiment_identity)::text
         FROM public.rd_trial_family_candidate_experiments_v1 experiment),
      '[]'
    ),
    'UTF8'
  ),
  'hex'
)
FROM pg_catalog.pg_class relation
JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public'
  AND relation.relname='rd_trial_family_candidate_experiments_v1'
  AND pg_catalog.pg_get_userbyid(relation.relowner)='rd_owner'
  AND EXISTS (
    SELECT 1 FROM public.rd_trial_family_candidate_experiments_v1
  )
  AND (SELECT pg_catalog.count(*)=7
         AND pg_catalog.count(*) FILTER (WHERE acl.grantee=relation.relowner)=7
         AND pg_catalog.count(DISTINCT acl.privilege_type)=7
         AND pg_catalog.bool_and(acl.grantor=relation.relowner AND NOT acl.is_grantable)
       FROM pg_catalog.aclexplode(COALESCE(
         relation.relacl,
         pg_catalog.acldefault('r',relation.relowner)
       )) acl)
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid=relation.oid
      AND attribute.attnum>0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
  );
SQL
}

run_authority_migration_for_database() {
  local fixture_database="$1"
  docker exec --interactive \
    --env POSTGRES_HOST=127.0.0.1 \
    --env "POSTGRES_DATABASE=${fixture_database}" \
    --env "POSTGRES_PASSWORD=${test_password}" \
    --env "RD_OWNER_DB_PASSWORD=${test_password}" \
    --env "RD_FACT_WRITER_DB_PASSWORD=${test_password}" \
    --env "MARKET_DATA_OWNER_DB_PASSWORD=${test_password}" \
    --env "MARKET_DATA_READER_DB_PASSWORD=${test_password}" \
    --env "REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD=${test_password}" \
    --env "OPERATOR_AUTHORIZATION_DB_PASSWORD=${test_password}" \
    --env "QUALIFICATION_OWNER_DB_PASSWORD=${test_password}" \
    --env "PRODUCT_EDGE_DB_PASSWORD=${test_password}" \
    --env "BACKTEST_OWNER_DB_PASSWORD=${test_password}" \
    --env "EXECUTION_WRITER_DB_PASSWORD=${test_password}" \
    --env "PORTFOLIO_WRITER_DB_PASSWORD=${test_password}" \
    --env "GOVERNANCE_WRITER_DB_PASSWORD=${test_password}" \
    --env "INSTRUMENT_OWNER_DB_PASSWORD=${test_password}" \
    --env "RISK_WRITER_DB_PASSWORD=${test_password}" \
    --env "SCANNER_WRITER_DB_PASSWORD=${test_password}" \
    --env "SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE=${composer_acceptance_migration}" \
    "$container" sh -s < product/rd-workbench/postgres-init/10-migrate-authority-custody.sh
}

check_postgres_containers_run_under_init
check_static_isolation
check_nextest_graph_contract
check_backtest_result_function_source
check_exploratory_replay_read_fence_source
check_market_data_principal_bootstrap_order
check_trial_family_candidate_experiment_cutover
check_composer_acceptance_stays_in_the_chain
check_collected_warning_report
# A PostgreSQL crash-reinit leaves the postmaster running, so its start time does not move; what
# records it is a LOG line, which the lock-and-error excerpt printed at cleanup filters out. Measured
# before --init: every round's authority-migration drills made the postmaster reap an orphaned shell
# killed by SIGPIPE, log "terminating any other active server processes", and reset every
# connection of every database - three times a round, with the chain still green. These lines are
# therefore counted in the raw server log of each container, and crash recovery also resets the
# cumulative statistics, which gives a second, independent reading.
readonly postgres_crash_pattern='was terminated by signal|terminating any other active server processes|all server processes terminated; reinitializing|database system was interrupted'

postgres_crash_lines() {
  grep -aE "$postgres_crash_pattern" || true
}

postgres_stats_reset() {
  docker exec "$1" psql --quiet --no-align --tuples-only --username postgres --dbname postgres \
    --command 'SELECT stats_reset FROM pg_catalog.pg_stat_bgwriter'
}

# Fails the chain, naming each line, if a container crashed or reset its statistics.
require_no_postgres_crash() {
  local name="$1" target="$2" stats_reset_before="$3" lines stats_reset_after
  lines="$(docker logs "$target" 2>&1 | postgres_crash_lines)"
  stats_reset_after="$(postgres_stats_reset "$target")"
  if [[ -n "$lines" || "$stats_reset_after" != "$stats_reset_before" ]]; then
    echo "ERROR: the ${name} PostgreSQL container crashed and reset every connection during the chain." >&2
    echo "statistics reset before the entries: ${stats_reset_before:-none}; after: ${stats_reset_after:-none}" >&2
    printf '%s\n' "$lines" >&2
    return 1
  fi
}

# The crash reading and its positive control, on fixed lines: each line the postmaster writes
# around a crash-reinit is counted, and ordinary shutdown, restart, ERROR and FATAL lines are not.
check_postgres_crash_reading() {
  local crash clean
  crash="$(printf '%s\n' \
    '2026-09-24 16:47:44.893 UTC [1] LOG:  server process (PID 2285) was terminated by signal 13: Broken pipe' \
    '2026-09-24 16:47:44.893 UTC [1] LOG:  terminating any other active server processes' \
    '2026-09-24 16:47:44.894 UTC [1] LOG:  all server processes terminated; reinitializing' \
    '2026-09-24 16:47:44.901 UTC [2288] LOG:  database system was interrupted; last known up at 2026-09-24 16:44:41 UTC' |
    postgres_crash_lines | grep -c '' || true)"
  clean="$(printf '%s\n' \
    '2026-09-24 16:39:49.101 UTC [1] LOG:  received fast shutdown request' \
    '2026-09-24 16:39:49.300 UTC [1] LOG:  database system is shut down' \
    '2026-09-24 16:39:50.215 UTC [1] LOG:  database system is ready to accept connections' \
    '2026-09-24 16:44:38.557 UTC [293] ERROR:  Backtest Result topology mismatch' \
    '2026-09-24 16:44:38.632 UTC [303] FATAL:  the database system is in recovery mode' |
    postgres_crash_lines | grep -c '' || true)"
  if [[ "$crash" -ne 4 || "$clean" -ne 0 ]]; then
    echo "ERROR: the crash reading counts ${crash} of the four crash-reinit lines and ${clean} ordinary lines." >&2
    return 1
  fi
}

# A host that sleeps during a run stops the database, the browser and every clock but the wall
# clock. Measured on a local preflight (2026-09-24): macOS entered "Dark Wake Thermal Emergency" and
# slept 972 seconds in the middle of entry 28; the server log is empty for those minutes, nextest
# reported 193.5 s and Node, which counts the wall clock, 1154 s, and the entry failed on an Owner
# read "after 970882ms against its 25000ms budget". That failure is about the host, not the chain.
# So every run compares the wall clock with a monotonic clock that stops during sleep, and a run
# that slept more than chain_sleep_tolerance_seconds is named as invalid evidence, pass or fail. A
# stepped wall clock (an NTP correction that jumps rather than slews) widens the gap the same way;
# that errs toward invalidating a run, and `pmset -g log` tells the two apart.
readonly chain_sleep_tolerance_seconds=30

chain_clock_reading() {
  python3 -c 'import time; print(int(time.time()), int(time.monotonic()))'
}

# Seconds the host slept between two readings: wall-clock elapsed minus monotonic elapsed.
chain_slept_seconds() {
  local wall_start="$1" mono_start="$2" wall_end="$3" mono_end="$4"
  echo $(((wall_end - wall_start) - (mono_end - mono_start)))
}

report_chain_host_sleep() {
  local wall_now mono_now slept
  [[ -n "${chain_wall_start:-}" ]] || return 0
  read -r wall_now mono_now <<< "$(chain_clock_reading)"
  slept="$(chain_slept_seconds "$chain_wall_start" "$chain_mono_start" "$wall_now" "$mono_now")"
  if [[ "$slept" -gt "$chain_sleep_tolerance_seconds" ]]; then
    echo "=== INVALID EVIDENCE: the wall clock ran ${slept} s ahead of the monotonic clock during this run: the host slept, or its clock was stepped (pmset -g log tells which). ===" >&2
    echo "=== Its timings, and any timeout or failure inside the sleep, are not evidence about the chain. ===" >&2
  fi
}

# The sleep reading and its positive control, on fixed numbers: the measured 972-second sleep must be
# named, and a run whose two clocks agree within the tolerance must not be.
check_chain_sleep_reading() {
  local slept
  slept="$(chain_slept_seconds 1000 5000 2154 5182)"
  if [[ "$slept" -ne 972 ]] || [[ "$slept" -le "$chain_sleep_tolerance_seconds" ]]; then
    echo "ERROR: the sleep reading gives ${slept} s for a run that slept 972 s." >&2
    return 1
  fi
  slept="$(chain_slept_seconds 1000 5000 2400 6398)"
  if [[ "$slept" -gt "$chain_sleep_tolerance_seconds" ]]; then
    echo "ERROR: the sleep reading names a ${slept} s sleep in a run whose clocks agree within two seconds." >&2
    return 1
  fi
}

# The shard list: one row per chain entry, `shard<TAB>component<TAB>test name<TAB>browser`, rows
# in chain order. A component is a set of entries that must share one database in chain order;
# different components never read each other's rows, so each starts from the state before the
# first entry. Components run one after another, never interleaved: interleaving would rebuild the
# databases in the middle of a component and drop what its earlier entries wrote.
#
# The needs list (`rd-owner-chain-needs.tsv`) may name, per entry, `replays`: entries run again as
# preconditions at the start of that entry's component, because the state it needs is produced by
# an entry whose own component runs elsewhere. A replay leaves no record and counts for nothing;
# the entry it repeats is judged where it runs as itself.
chain_shard_list="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rd-owner-chain-shards.tsv"
chain_needs_list="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rd-owner-chain-needs.tsv"
readonly chain_shard_list chain_needs_list

# Prints the 1-based chain position of a test name, or nothing.
chain_position_of() {
  local name="$1" position=0 selection
  for selection in "${rd_owner_postgres_tests[@]}"; do
    position=$((position + 1))
    if [[ "${selection##*|}" == "$name" ]]; then
      echo "$position"
      return 0
    fi
  done
}

load_chain_shard() {
  local shard="$1" row_shard component name position replays replay replayed first
  local -a components=()
  local -A component_entries=() component_replays=()
  if [[ ! -f "$chain_shard_list" ]]; then
    echo "ERROR: RD_OWNER_CHAIN_SHARD=${shard} but there is no shard list at ${chain_shard_list}." >&2
    exit 1
  fi
  while IFS=$'\t' read -r row_shard component name _; do
    [[ "$row_shard" == "$shard" ]] || continue
    position="$(chain_position_of "$name")"
    if [[ -z "$position" ]]; then
      echo "ERROR: shard ${shard} lists ${name}, which is not a chain entry." >&2
      exit 1
    fi
    if [[ -z "${component_entries[$component]+set}" ]]; then
      components+=("$component")
      component_entries["$component"]=''
      component_replays["$component"]=''
    fi
    component_entries["$component"]+="${position} "
    chain_shard_entry_count=$((chain_shard_entry_count + 1))
    replays=''
    if [[ -f "$chain_needs_list" ]]; then
      replays="$(awk -F'\t' -v name="$name" '$1 == name { print $4 }' "$chain_needs_list")"
    fi
    if [[ -n "$replays" && "$replays" != '-' ]]; then
      IFS=',' read -r -a replayed <<< "$replays"
      for replay in "${replayed[@]}"; do
        first="$(chain_position_of "$replay")"
        if [[ -z "$first" ]]; then
          echo "ERROR: ${name} replays ${replay}, which is not a chain entry." >&2
          exit 1
        fi
        component_replays["$component"]+="${first} "
      done
    fi
  done < "$chain_shard_list"
  if [[ "$chain_shard_entry_count" -eq 0 ]]; then
    echo "ERROR: the shard list names no entry for shard ${shard}." >&2
    exit 1
  fi
  for component in "${components[@]}"; do
    read -r -a replayed <<< "${component_replays[$component]}"
    for position in $(printf '%s\n' "${replayed[@]}" | sort -n -u); do
      chain_run_order+=("${position}|replay|${component}")
    done
    read -r -a replayed <<< "${component_entries[$component]}"
    for position in "${replayed[@]}"; do
      chain_run_order+=("${position}|entry|${component}")
    done
  done
}

# Every database an entry can write, snapshotted as a template once the pre-loop setup has
# settled. A template clone carries neither the database ACL nor its role settings, and its owner
# must be named, so all three are kept beside it and restored on every rebuild.
chain_snapshot_databases() {
  printf '%s\n' "$test_database" "$catalog_admin_database" "$origin_current_database" \
    "$legacy_replay_database" "$program_host_acceptance_database" "$composer_sealed_read_database"
}

chain_admin_psql() {
  docker exec "$container" psql --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres --command "$1"
}

declare -A chain_database_owner=()
declare -A chain_database_acl=()

snapshot_chain_databases() {
  local database
  while IFS= read -r database; do
    chain_database_owner["$database"]="$(chain_admin_psql "SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname = '${database}'")"
    chain_database_acl["$database"]="$(chain_admin_psql "SELECT COALESCE(datacl::text, '') FROM pg_catalog.pg_database WHERE datname = '${database}'")"
    chain_admin_psql "CREATE DATABASE \"${database}_t0\" WITH TEMPLATE \"${database}\" OWNER \"${chain_database_owner[$database]}\"" > /dev/null
  done < <(chain_snapshot_databases)
  chain_admin_psql "DROP TABLE IF EXISTS vibe_chain_role_settings_t0" > /dev/null
  chain_admin_psql "CREATE TABLE vibe_chain_role_settings_t0 AS SELECT database_entry.datname, setting.setrole, setting.setconfig FROM pg_catalog.pg_db_role_setting setting JOIN pg_catalog.pg_database database_entry ON database_entry.oid = setting.setdatabase" > /dev/null
}

reset_chain_databases() {
  local database
  while IFS= read -r database; do
    chain_admin_psql "DROP DATABASE \"${database}\" WITH (FORCE)" > /dev/null
    chain_admin_psql "CREATE DATABASE \"${database}\" WITH TEMPLATE \"${database}_t0\" OWNER \"${chain_database_owner[$database]}\"" > /dev/null
    if [[ -n "${chain_database_acl[$database]}" ]]; then
      chain_admin_psql "UPDATE pg_catalog.pg_database SET datacl = '${chain_database_acl[$database]}'::aclitem[] WHERE datname = '${database}'" > /dev/null
    fi
    chain_admin_psql "INSERT INTO pg_catalog.pg_db_role_setting SELECT database_entry.oid, saved.setrole, saved.setconfig FROM vibe_chain_role_settings_t0 saved JOIN pg_catalog.pg_database database_entry ON database_entry.datname = saved.datname WHERE saved.datname = '${database}'" > /dev/null
  done < <(chain_snapshot_databases)
}

drop_chain_database_snapshots() {
  local database
  while IFS= read -r database; do
    chain_admin_psql "DROP DATABASE IF EXISTS \"${database}_t0\"" > /dev/null
  done < <(chain_snapshot_databases)
  chain_admin_psql "DROP TABLE IF EXISTS vibe_chain_role_settings_t0" > /dev/null
}

# The shard list is the planner's output and nothing else. It is regenerated here with the shard
# count its own header states, and must match byte for byte, so a hand edit cannot drift away from
# the declared needs it is derived from. The planner also refuses a declaration that names an entry
# not in the chain, a need that does not run before its entry, a missing entry, an unresolved need
# ("?"), and a replay without its reason; each replay it prints, with why it is there and what
# replaces it.
check_chain_shard_plan() {
  local planner shard_count planned
  planner="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rd-owner-chain-shard-plan.py"
  if [[ ! -f "$chain_needs_list" || ! -f "$chain_shard_list" ]]; then
    echo "ERROR: the chain runs as shards and needs both ${chain_needs_list} and ${chain_shard_list}." >&2
    return 1
  fi
  shard_count="$(sed -n 's/^# \([0-9][0-9]*\) shards;.*/\1/p' "$chain_shard_list")"
  if [[ -z "$shard_count" ]]; then
    echo "ERROR: ${chain_shard_list} does not state its shard count in its header." >&2
    return 1
  fi
  if ! planned="$(python3 "$planner" "$shard_count")"; then
    echo "ERROR: the shard planner refuses the declared needs (above)." >&2
    return 1
  fi
  if [[ "$planned"$'\n' != "$(cat "$chain_shard_list")"$'\n' ]]; then
    echo "ERROR: ${chain_shard_list} is not the planner's output for ${shard_count} shards; regenerate it with" >&2
    echo "       python3 scripts/ci/rd-owner-chain-shard-plan.py ${shard_count} > scripts/ci/rd-owner-chain-shards.tsv" >&2
    diff <(printf '%s\n' "$planned") "$chain_shard_list" | head -20 >&2
    return 1
  fi
}

# The chain's verdict from its records alone, so a run split across jobs is judged by the same
# report a serial run prints. Records are named by global chain position, so the directories of
# several jobs merge into the layout one serial run leaves. Every position must hold exactly one
# junit record naming the test the array puts there, with one test run and none failed, errored or
# skipped: a record under the wrong number, a skip-shaped pass and a missing entry are each named.
# The two summary lines then come from the same code the serial chain calls.
report_chain_records() {
  local record_dir="$1" position selection package binary name record header problems=0
  local expected_count="${#rd_owner_postgres_tests[@]}"
  if [[ ! -d "$record_dir" ]]; then
    echo "ERROR: no chain record directory at ${record_dir}." >&2
    return 1
  fi
  for position in $(seq 1 "$expected_count"); do
    selection="${rd_owner_postgres_tests[$((position - 1))]}"
    IFS='|' read -r package binary name <<< "$selection"
    record="$(printf '%s/%03d.xml' "$record_dir" "$position")"
    if [[ ! -f "$record" ]]; then
      echo "ERROR: entry ${position} (${name}) left no record at ${record}." >&2
      problems=$((problems + 1))
      continue
    fi
    header="$(grep -m 1 -o '<testsuites [^>]*>' -- "$record" || true)"
    if [[ "$header" != *' tests="1" skipped="0" failures="0" errors="0" '* ]]; then
      echo "ERROR: entry ${position} (${name}) did not record exactly one passing test: ${header:-no testsuites element}" >&2
      problems=$((problems + 1))
    fi
    if ! grep -Fq "<testcase name=\"${name}\" classname=\"${package}" -- "$record"; then
      echo "ERROR: record ${record} is not entry ${position} (${name}); it names $(grep -m 1 -o '<testcase name="[^"]*"' -- "$record" || echo 'no test case')." >&2
      problems=$((problems + 1))
    fi
  done
  while IFS= read -r record; do
    position="$(basename -- "$record" .xml)"
    if [[ ! "$position" =~ ^[0-9]{3}$ ]] || ((10#$position < 1 || 10#$position > expected_count)); then
      echo "ERROR: ${record} is not the record of any of the ${expected_count} entries." >&2
      problems=$((problems + 1))
    fi
  done < <(find "$record_dir" -maxdepth 1 -name '*.xml' -type f | sort)
  if [[ "$problems" -ne 0 ]]; then
    echo "ERROR: ${problems} problem(s) in the chain records at ${record_dir}." >&2
    return 1
  fi
  echo "=== ordered chain: all ${expected_count} entries passed, ${expected_count} recorded"
  report_collected_warnings "$record_dir" "$expected_count"
}

# The record verdict and its positive control, on records built from the array itself. A complete
# set must pass and print the serial chain's own lines; each way a merged set can be wrong must be
# named: a missing entry, a record under another entry's number, a skip-shaped pass, and a record
# for a position the array does not have.
check_chain_record_report() {
  local fixtures position selection package binary name report
  fixtures="$(mktemp -d)"
  for position in $(seq 1 "${#rd_owner_postgres_tests[@]}"); do
    selection="${rd_owner_postgres_tests[$((position - 1))]}"
    IFS='|' read -r package binary name <<< "$selection"
    printf '<testsuites name="nextest-run" tests="1" skipped="0" failures="0" errors="0" time="1">\n<testcase name="%s" classname="%s::%s" time="1"/>\n</testsuites>\n' \
      "$name" "$package" "$binary" > "$(printf '%s/%03d.xml' "$fixtures" "$position")"
    printf '%s\n' "$chain_log_collecting_marker" > "$(printf '%s/%03d.log' "$fixtures" "$position")"
  done
  if ! report="$(report_chain_records "$fixtures" 2>&1)" ||
    [[ "$report" != "=== ordered chain: all ${#rd_owner_postgres_tests[@]} entries passed, ${#rd_owner_postgres_tests[@]} recorded"$'\n'"=== owner warnings: collected for ${#rd_owner_postgres_tests[@]}/${#rd_owner_postgres_tests[@]} entries; refusals in 0, other warnings in 0, 0 sqlx performance hint(s) in total" ]]; then
    rm -rf -- "$fixtures"
    echo "ERROR: the record verdict refuses a complete set of records or prints other lines:" >&2
    printf '%s\n' "$report" >&2
    return 1
  fi
  mv -- "$fixtures/002.xml" "$fixtures/002.held"
  if report_chain_records "$fixtures" > /dev/null 2>&1; then
    rm -rf -- "$fixtures"
    echo "ERROR: the record verdict accepts a set with entry 2 missing." >&2
    return 1
  fi
  cp -- "$fixtures/001.xml" "$fixtures/002.xml"
  if report_chain_records "$fixtures" > /dev/null 2>&1; then
    rm -rf -- "$fixtures"
    echo "ERROR: the record verdict accepts entry 1's record under entry 2's number." >&2
    return 1
  fi
  mv -- "$fixtures/002.held" "$fixtures/002.xml"
  sed -e 's/ skipped="0" / skipped="1" /' "$fixtures/001.xml" > "$fixtures/001.skipped"
  mv -- "$fixtures/001.xml" "$fixtures/001.held"
  mv -- "$fixtures/001.skipped" "$fixtures/001.xml"
  if report_chain_records "$fixtures" > /dev/null 2>&1; then
    rm -rf -- "$fixtures"
    echo "ERROR: the record verdict accepts a skip-shaped record." >&2
    return 1
  fi
  mv -- "$fixtures/001.held" "$fixtures/001.xml"
  cp -- "$fixtures/001.xml" "$(printf '%s/%03d.xml' "$fixtures" "$((${#rd_owner_postgres_tests[@]} + 1))")"
  if report_chain_records "$fixtures" > /dev/null 2>&1; then
    rm -rf -- "$fixtures"
    echo "ERROR: the record verdict accepts a record for a position the chain does not have." >&2
    return 1
  fi
  rm -rf -- "$fixtures"
}

check_chain_record_report
check_postgres_crash_reading
check_chain_sleep_reading
check_chain_shard_plan

if [[ "${1:-}" == "--report-records" ]]; then
  if [[ "$#" -ne 2 ]]; then
    echo "usage: $0 --report-records <chain record directory>" >&2
    exit 2
  fi
  report_chain_records "$2"
  exit
fi

if [[ "${1:-}" == "--check" ]]; then
  exit 0
fi

if [[ -z "${CARGO_CI_PROFILE:-}" ]]; then
  echo "ERROR: CARGO_CI_PROFILE must select a Cargo compile profile." >&2
  exit 1
fi
readonly cargo_ci_profile="$CARGO_CI_PROFILE"
if [[ -z "${NEXTEST_PROFILE:-}" ]]; then
  echo "ERROR: NEXTEST_PROFILE must select a nextest execution profile." >&2
  exit 1
fi
readonly nextest_profile="$NEXTEST_PROFILE"
if [[ -z "${RD_OWNER_POSTGRES_FEATURES:-}" ]]; then
  echo "ERROR: RD_OWNER_POSTGRES_FEATURES must select the shared workspace feature union." >&2
  exit 1
fi
readonly rd_owner_postgres_features="${RD_OWNER_POSTGRES_FEATURES//[[:space:]]/}"
IFS=',' read -r -a required_archive_features <<< "$nextest_archive_features"
for required_feature in "${required_archive_features[@]}"; do
  case ",${rd_owner_postgres_features}," in
    *",${required_feature},"*) ;;
    *)
      echo "ERROR: R&D Owner PostgreSQL feature union omits required archive feature ${required_feature}." >&2
      exit 1
      ;;
  esac
done

# The archive can be built in one job and run in another: CI builds it where the Rust cache is and
# runs the chain on a runner that only downloads it. The chain then runs binaries it did not build,
# so the archive carries an identity - the source tree, the features and both profiles - and a chain
# given an archive refuses one whose identity is not its own, by name, rather than running binaries
# from some other tree.
# The production provisioning binary for Operator Authorization and Product Edge, built as the
# deployment image builds it (no features) and staged where .config/nextest.toml's
# [profile.ci.archive] include picks it up, so it reaches every job that runs from the archive.
chain_provisioning_binary=product-edge-authority-bootstrap
build_chain_provisioning_binary() {
  local target_dir profile_dir
  target_dir="${CARGO_TARGET_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/target}"
  case "$cargo_ci_profile" in
    dev | test) profile_dir=debug ;;
    release | bench) profile_dir=release ;;
    *) profile_dir="$cargo_ci_profile" ;;
  esac
  cargo build --locked --package vibe-product-edge-admin --bin "$chain_provisioning_binary" \
    --profile "$cargo_ci_profile"
  mkdir -p -- "${target_dir}/chain-provisioning"
  cp -- "${target_dir}/${profile_dir}/${chain_provisioning_binary}" "${target_dir}/chain-provisioning/"
}

build_nextest_archive() {
  build_chain_provisioning_binary
  cargo nextest archive \
    "${nextest_graph_args[@]}" \
    --features "$nextest_archive_features" \
    --profile "$nextest_profile" \
    --cargo-profile "$cargo_ci_profile" \
    --archive-file "$1"
}
nextest_archive_identity() {
  printf 'tree %s\nfeatures %s\ncargo-profile %s\nnextest-profile %s\n' \
    "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse 'HEAD^{tree}')" \
    "$nextest_archive_features" "$cargo_ci_profile" "$nextest_profile"
}
if [[ "${1:-}" == "--archive-only" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "ERROR: --archive-only needs the archive file to write." >&2
    exit 1
  fi
  mkdir -p -- "$(dirname -- "$2")"
  build_nextest_archive "$2"
  nextest_archive_identity > "${2}.identity"
  echo "=== R&D Owner chain archive written to ${2}:" >&2
  cat "${2}.identity" >&2
  exit 0
fi

# This chain has refused to run anywhere but Linux since the file was created, and until now it said
# only that. The restriction arrived with the file in #326 on 2026-08-23 and its commit recorded no
# reason. A survey since finds no construct here that needs Linux - no `--network host`, no `/proc`,
# no cgroups, no `nsenter`, no GNU-only `stat`, `date` or `sed` flags - and the one platform-specific
# name in the script, `host.docker.internal`, is the direction Docker Desktop provides and Linux
# needs `--add-host` for. That is "no recorded reason", which is not the same as "nothing to
# protect", so the refusal stays.
#
# What changes is that it can be stepped over deliberately instead of silently. It is stepped over
# today - by editing this check out - and an edited-out check leaves nothing in the log saying the
# run was told to skip it, so a local pass and a Linux pass read alike afterwards. The variable
# leaves that trace on every run that uses it.
#
# The name carries the meaning, because a reader reaches for the variable long before they reach for
# this comment. A local run is a preflight: AGENTS.md admits an Owner implementation when its entries
# pass on Linux CI, and a pass here only says the chain is worth spending a runner on. It is not
# acceptance, and no amount of it becomes acceptance.
if [[ "$(uname -s)" != "Linux" ]]; then
  if [[ "${RD_OWNER_CHAIN_LOCAL_PREFLIGHT:-}" != "1" ]]; then
    echo "ERROR: this chain runs on Linux, and this host is $(uname -s)." >&2
    echo "       No reason was recorded when that restriction was introduced, and no Linux-only" >&2
    echo "       construct has been found in this script since, so it may well run here." >&2
    echo "       Set RD_OWNER_CHAIN_LOCAL_PREFLIGHT=1 to run it as a preflight." >&2
    echo "       A pass under that variable is a working state, not acceptance. Acceptance is" >&2
    echo "       these entries passing on Linux CI, and nothing run here substitutes for it." >&2
    exit 1
  fi
  echo "=== RD_OWNER_CHAIN_LOCAL_PREFLIGHT=1: running on $(uname -s), not Linux. ===" >&2
  echo "=== This is a preflight. Acceptance is these entries passing on Linux CI. ===" >&2
fi
read -r chain_wall_start chain_mono_start <<< "$(chain_clock_reading)"
readonly chain_wall_start chain_mono_start

if ! command -v docker > /dev/null 2>&1; then
  echo "ERROR: Docker is required for isolated R&D Owner PostgreSQL tests." >&2
  exit 1
fi
if ! command -v timeout > /dev/null 2>&1; then
  echo "ERROR: timeout is required for isolated R&D Owner PostgreSQL tests." >&2
  exit 1
fi

# One local chain per machine, taken before the first container or build: overlapping chains load
# the machine until entries with a time window fail for load alone. owner-chain-lock.bash says why
# and how. A hosted runner runs one job, so CI does not take it.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  # shellcheck source=scripts/ci/owner-chain-lock.bash
  source "$(dirname "${BASH_SOURCE[0]}")/owner-chain-lock.bash"
  acquire_owner_chain_lock || exit 1
  # Binaries built by another worktree must not run here; cargo-target-in-worktree.bash says why.
  # shellcheck source=scripts/ci/cargo-target-in-worktree.bash
  source "$(dirname "${BASH_SOURCE[0]}")/cargo-target-in-worktree.bash"
  require_cargo_target_inside_worktree || exit 1
fi

# A wall clock on every entry; chain-entry-watchdog.bash says why. 900s is about six and a half times
# the slowest entry measured - 135.8s, entry 28, the most any entry took across 25 chain records of
# 2026-09-22..23 - and stays above nextest's own ten-minute stop (`slow-timeout`, 120s x 5), so a
# hung test is still named by nextest and only what nextest cannot see reaches this.
# This expires as entries grow slower: when any entry routinely passes 450s, re-measure from the
# chain records and raise it. CHAIN_ENTRY_WALL_CLOCK_SECONDS lowers it to make the watchdog fire on
# purpose.
# shellcheck source=scripts/ci/chain-entry-watchdog.bash
source "$(dirname "${BASH_SOURCE[0]}")/chain-entry-watchdog.bash"
readonly chain_entry_wall_clock_seconds="${CHAIN_ENTRY_WALL_CLOCK_SECONDS:-900}"

# Entry 28 drives the Dashboard in a real browser only when three sealed inputs are present, and so
# does entry 100, the single-run report's acceptance, which reads the same three. Without
# them each returns in a few milliseconds and reports PASS, so a chain that never touched a browser
# goes green and says nothing about it. Measured twice on two trees: 0.011s locally against 136.78s
# on CI, and locally it is the fastest of all ninety-nine entries - three times faster than the one
# below it, which does a single string assertion. That reading alone rules out starting Next.js and
# Chrome; no comparison with CI is needed to see it.
#
# Only the first of the three is silent. The test reads the other two with `.expect(...)`, so their
# absence already panics and names itself. Checking all three here buys exactly two things: the
# failure arrives before the entry runs rather than a hundred and thirty seconds into it, and a run
# missing several is told about all of them at once. It is not new coverage for those two.
#
# One check, two readers. What differs is only what happens after it, never what it looks for: a
# preflight must carry on and record that this entry covered nothing, because `--fail-fast` would
# otherwise turn a local run of ninety-eight real entries into twenty-seven. The gate must refuse,
# because there the inputs are installed by .github/actions/dashboard-browser-acceptance and their
# absence means that step did not do its job.
sealed_browser_inputs_absent() {
  local -a absent=()
  [[ "${DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE:-}" == "1" ]] ||
    absent+=("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE (must be exactly 1)")
  [[ -n "${DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE:-}" ]] ||
    absent+=("DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE")
  [[ -n "${DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE:-}" ]] ||
    absent+=("DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE")
  [[ "${#absent[@]}" -gt 0 ]] || return 0
  printf '%s\n' "${absent[@]}"
}

check_sealed_browser_inputs() {
  local absent
  absent="$(sealed_browser_inputs_absent)"
  [[ -n "$absent" ]] || return 0
  if [[ "${RD_OWNER_CHAIN_LOCAL_PREFLIGHT:-}" == "1" ]]; then
    echo "=== The Dashboard browser acceptance will NOT run this round. Absent: ===" >&2
    while read -r name; do echo "===   $name" >&2; done <<< "$absent"
    echo "=== Entries 28 and 100 return in milliseconds and report PASS, covering nothing. ===" >&2
    echo "=== A green chain this round covers every entry except those two. ===" >&2
    return 0
  fi
  echo "ERROR: the sealed Dashboard browser acceptance inputs are absent:" >&2
  while read -r name; do echo "       $name" >&2; done <<< "$absent"
  echo "       Entries 28 and 100 would return in milliseconds and report PASS, so this chain" >&2
  echo "       would go green while the Dashboard browser acceptances ran nothing at all." >&2
  echo "       .github/actions/dashboard-browser-acceptance sets all three." >&2
  return 1
}
check_sealed_browser_inputs

readonly postgres_image="public.ecr.aws/docker/library/postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c"
suffix="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')-$$"
readonly suffix
readonly container="vibe-rd-owner-test-${suffix}"
readonly volume="vibe-rd-owner-test-${suffix}"
readonly test_database="vibe_test_${suffix//-/_}"
readonly catalog_admin_database="vibe_test_catalog_admin_${suffix//-/_}"
readonly origin_current_database="vibe_test_origin_current_${suffix//-/_}"
readonly legacy_replay_database="vibe_test_legacy_replay_${suffix//-/_}"
readonly program_host_acceptance_database="vibe_test_program_host_acceptance_${suffix//-/_}"
readonly composer_sealed_read_database="vibe_test_composer_sealed_read_${suffix//-/_}"
readonly impersonator_container="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_volume="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_database="vibe_impersonator_${suffix//-/_}"
test_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly test_password
impersonator_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly impersonator_password
volume_created=false
impersonator_volume_created=false
container_created=false
impersonator_container_created=false
nextest_archive_dir=''
nextest_archive_file=''
nextest_extract_dir=''
# Where the ordered chain is. The chain is fail-fast over one shared store, so a red run's useful
# number is the entry it stopped at, not only the test nextest names: an Owner's acceptance is its
# own entries passing, and this is what says how far the run got.
chain_entry_count="${#rd_owner_postgres_tests[@]}"
# One shard of the chain runs only the entries the shard list gives it, each dependency component
# on databases rebuilt from the state before the first entry; unset, every entry runs in order.
readonly chain_shard="${RD_OWNER_CHAIN_SHARD:-}"
chain_shard_entry_count=0
# What the loop runs, in order: `position|entry|component` or `position|replay|component`. Without a
# shard it is every entry, in chain order.
chain_run_order=()
if [[ -n "$chain_shard" ]]; then
  load_chain_shard "$chain_shard"
else
  for chain_position in $(seq 1 "$chain_entry_count"); do
    chain_run_order+=("${chain_position}|entry|")
  done
  chain_position=0
fi
readonly chain_run_order
chain_run_index=0
chain_current_component=''
readonly chain_entry_count
chain_position=0
chain_entry_label=''
chain_completed=false

remove_docker_object_for_cleanup() {
  local object_type="$1"
  local object_name="$2"
  local max_attempts="$3"
  local attempt=1
  local -a remove_command=(docker volume rm "$object_name")
  if [[ "$object_type" == container ]]; then
    remove_command=(docker container rm --force "$object_name")
  fi

  while [[ "$attempt" -le "$max_attempts" ]]; do
    if "${remove_command[@]}" > /dev/null 2>&1; then
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep 1
    fi
    attempt=$((attempt + 1))
  done
  echo "ERROR: cleanup could not remove ${object_type} ${object_name}." >&2
  return 1
}

cleanup() {
  local primary_status="$?"
  local cleanup_failed=false
  trap - EXIT
  disarm_chain_entry_watchdog
  report_chain_host_sleep
  # `set +e` does not quiet the ERR trap - Bash runs it on any failing command outside a condition,
  # whatever errexit is set to - and everything below is written to tolerate failure and report it in
  # its own words. Without this line a failing chain would end in a run of generic trap lines that
  # say nothing the explicit messages here do not already say better.
  trap - ERR
  set +e

  # The entry that ended the run never reached its own copy, so take it here.
  if [[ "$primary_status" -ne 0 && -n "${chain_position:-}" ]]; then
    keep_chain_record "$chain_position"
  fi

  # The one line a person reads first, printed here rather than next to the `exit` at the end of this
  # function, because everything between the two is unbounded: the server log dumped below ran to
  # 270157 lines on run 35703938333.
  #
  # GitHub keeps all of it - the raw job log holds 297380 lines and the summary sits at line 286933 -
  # but the commands people actually read one job with do not. Measured on that run:
  #
  #   gh api repos/<repo>/actions/jobs/<id>/logs   297380 lines   summary present
  #   gh run view <run> --log                      119412 lines   summary absent
  #   gh run view <run> --job <id> --log            78108 lines   summary absent
  #
  # Two of the three drop it, and nothing in what they return says anything was dropped. Printing the
  # summary after an unbounded dump therefore makes it readable only by someone who already knows
  # which of the three to reach for, and that knowledge is exactly what a person diagnosing a red
  # chain does not have. Printed here it survives all three. Nothing unbounded may come before the
  # sentence that says where the run stopped.
  if [[ "$primary_status" -ne 0 && "$chain_position" -gt 0 && "$chain_completed" != true ]]; then
    echo "ordered chain stopped at entry ${chain_position}/${chain_entry_count} (${chain_entry_label}); $((chain_position - 1)) passed before it." >&2
  fi

  if [[ -n "$nextest_extract_dir" ]] &&
    ! rm -rf -- "$nextest_extract_dir"; then
    cleanup_failed=true
  fi
  if [[ -n "$nextest_archive_file" ]] &&
    ! rm -f -- "$nextest_archive_file"; then
    cleanup_failed=true
  fi
  if [[ -n "$nextest_archive_dir" ]] &&
    ! rmdir -- "$nextest_archive_dir"; then
    cleanup_failed=true
  fi

  # PostgreSQL writes a deadlock's DETAIL - both processes and both statements - to its own
  # server log, and this script used to delete the container without ever reading it. A chain
  # failure then reported "deadlock detected" with no way to learn which two transactions, and
  # the evidence was destroyed on the way out. Dump it before the container goes.
  #
  # Both sides of the comparison, at the cost each one is worth.
  #
  # `log_lock_waits` records a wait whether or not the chain goes on to fail, and the passing runs
  # carry deadlocks too: across twelve runs the passing side logged 0, 2, 2, 3, 3, 3, 4 and 5 of
  # them while the four that stopped at entry 28 logged 1, 1, 1 and 2. Reading only the failing
  # side samples on the outcome being explained, so the counts have to come from both.
  #
  # The counts are not the whole log. Measured on one passing round: 627780 lines in the job, of
  # which the server log was 598824 -- 95% -- and the entire reason it is there was 14 `still
  # waiting` records and no deadlock. Emitting all of it to carry fourteen lines also pushed
  # everything printed after it out of two of the three ways a log can be fetched
  # (`gh run view --log` returns 119412 lines, `--job --log` 78108, the REST endpoint 297380, and
  # none of them says it truncated).
  #
  # So a passing round prints the lock records and says how many lines it did not print; a failing
  # round prints everything, because then the question is which two transactions, and that answer
  # is in the lines around them. Tailing to a fixed length would be the wrong economy either way:
  # lock waits are spread across the whole round, so keeping the end drops the early ones, and
  # drops them silently.
  if [[ "$container_created" == true ]]; then
    local postgres_server_log postgres_log_lines postgres_lock_records
    postgres_server_log="$(docker logs "$container" 2>&1 || true)"
    postgres_log_lines="$(printf '%s' "$postgres_server_log" | grep -c '' || true)"
    if [[ "$primary_status" -ne 0 ]]; then
      printf '=== postgres server log (chain container): %s lines, all of them ===\n' \
        "$postgres_log_lines" >&2
      printf '%s\n' "$postgres_server_log" >&2
    else
      postgres_lock_records="$(printf '%s\n' "$postgres_server_log" |
        grep -E 'deadlock detected|still waiting for|acquired .*Lock|ERROR:|FATAL:|PANIC:' || true)"
      printf '=== postgres server log (chain container): %s lines, showing %s lock and error records ===\n' \
        "$postgres_log_lines" \
        "$(printf '%s' "$postgres_lock_records" | grep -c '' || true)" >&2
      printf '%s\n' "$postgres_lock_records" >&2
      printf '=== the other lines carried no deadlock, lock wait, ERROR, FATAL or PANIC ===\n' >&2
    fi
    echo "=== end postgres server log ===" >&2

    # A deadlock's DETAIL names both processes and the statement each one is BLOCKED ON. It never
    # says what either one already holds, and that is the half the fix depends on: the inverted
    # transaction is the one that took the second table first, which is a fact about its past.
    #
    # Two attempts to recover that past from the code failed. Walking the call graph by hand got
    # lost six levels down, twice. A static walker over every function that threads the same
    # `&mut Transaction` then reported that no single body takes the attempts lock before the
    # receipts lock - so the order is assembled across calls, and reading the source cannot say
    # in which order a given run made them.
    #
    # `log_statement=all` records the past directly. The whole statement log is far too large to
    # print, so only the processes PostgreSQL itself named in a deadlock are printed, in the order
    # they ran. That turns "which call site holds the attempts lock" from an inference into a
    # transcript. The filter is the point: without it this block would bury the chain's own output.
    local deadlock_pids
    deadlock_pids="$(printf '%s' "$postgres_server_log" |
      grep -oE 'Process [0-9]+ waits for' | grep -oE '[0-9]+' | sort -u || true)"
    if [[ -n "$deadlock_pids" ]]; then
      printf '=== statements of the %s processes named in a deadlock ===\n' \
        "$(printf '%s' "$deadlock_pids" | grep -c '' || true)" >&2
      local pid pid_lines
      while read -r pid; do
        [[ -n "$pid" ]] || continue
        # `[pid]` appears in every line this backend wrote, so this keeps its whole transcript.
        pid_lines="$(printf '%s\n' "$postgres_server_log" | grep -F "[$pid]" || true)"
        if [[ -z "$pid_lines" ]]; then
          # Before `log_statement=all` this was the normal reading for the process that WON the
          # deadlock: it never errored, so it never wrote a line of its own and appeared only
          # inside the loser's DETAIL. An empty transcript and a process that did nothing read
          # the same way, so say which one this is instead of printing nothing.
          printf -- '--- pid %s: named in a DETAIL but wrote no line of its own ---\n' "$pid" >&2
          continue
        fi
        printf -- '--- pid %s, in order ---\n' "$pid" >&2
        printf '%s\n' "$pid_lines" >&2
      done <<< "$deadlock_pids"
      echo "=== end deadlock process statements ===" >&2
    else
      # Zero is a reading only when the instrument was present. Say which zero this is.
      echo "=== no deadlock in this run: no process transcripts to print ===" >&2
    fi
  fi

  if [[ "$container_created" == true ]] &&
    ! remove_docker_object_for_cleanup container "$container" 3; then
    cleanup_failed=true
  fi
  if [[ "$impersonator_container_created" == true ]] &&
    ! remove_docker_object_for_cleanup container "$impersonator_container" 3; then
    cleanup_failed=true
  fi
  if [[ "$volume_created" == true ]] &&
    ! remove_docker_object_for_cleanup volume "$volume" 5; then
    cleanup_failed=true
  fi
  if [[ "$impersonator_volume_created" == true ]] &&
    ! remove_docker_object_for_cleanup volume "$impersonator_volume" 5; then
    cleanup_failed=true
  fi

  if [[ "$primary_status" -ne 0 ]]; then
    exit "$primary_status"
  fi
  if [[ "$cleanup_failed" == true ]]; then
    exit 1
  fi
  exit 0
}
# Every `cargo nextest run` below rewrites the same junit.xml, so the chain's invocations leave only
# the last one behind. One copy per entry is what makes "did entry N run, and for how long" a
# question a machine can answer instead of one a person answers by reading the log. nextest's store
# does not follow CARGO_TARGET_DIR - it is always <workspace>/target/nextest - so this reads the
# store path rather than deriving one.
chain_record_dir='target/nextest/chain-records'
readonly chain_record_dir
chain_record_source='target/nextest/ci/junit.xml'
readonly chain_record_source
rm -rf -- "$chain_record_dir"
mkdir -p -- "$chain_record_dir"

# Copies the record nextest just wrote. Called once per entry on the way through, and once more from
# `cleanup` for the entry that ended the run: without that second call a failing entry would have no
# record, and "no record" would mean both "never ran" and "ran and failed".
keep_chain_record() {
  local position="$1"
  [[ -f "$chain_record_source" ]] || return 0
  cp -- "$chain_record_source" "$(printf '%s/%03d.xml' "$chain_record_dir" "$position")"
}

trap cleanup EXIT

probe_tcp_endpoint() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" << 'PY'
import socket
import sys
import time

host, port = sys.argv[1], int(sys.argv[2])
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        break
    try:
        with socket.create_connection((host, port), timeout=min(0.25, remaining)):
            raise SystemExit(0)
    except OSError:
        pass
    time.sleep(min(0.5, max(0, deadline - time.monotonic())))
raise SystemExit(1)
PY
}

select_reachable_postgres_endpoint() {
  local object_name="$1"
  local published_port="$2"
  local endpoint_label="$3"
  local host="127.0.0.1"
  local port="$published_port"

  if [[ -f /.dockerenv ]]; then
    if ! host="$(docker inspect --format '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}' "$object_name")" ||
      [[ -z "$host" ]]; then
      echo "ERROR: could not resolve ${endpoint_label} PostgreSQL sibling-container endpoint." >&2
      return 1
    fi
    port=5432
  fi

  if ! probe_tcp_endpoint "$host" "$port"; then
    echo "ERROR: ${endpoint_label} PostgreSQL endpoint is unreachable from the caller after 15 seconds." >&2
    return 1
  fi
  printf '%s %s\n' "$host" "$port"
}

if ! docker image inspect "$postgres_image" > /dev/null 2>&1; then
  bash scripts/ci/docker-pull-retry.sh "$postgres_image" 3
fi
docker volume create "$volume" > /dev/null
volume_created=true
docker volume create "$impersonator_volume" > /dev/null
impersonator_volume_created=true
# `--init`: PostgreSQL must not be PID 1 here. The authority migration runs through
# `docker exec … sh -s`, and its SQL is one large heredoc, which busybox sh feeds to psql from a
# forked writer. When the migration is refused on purpose (the fault drills, entry 19's restore),
# psql exits, `set -e` takes sh with it, and the writer, still writing, is orphaned to PID 1. As
# PID 1 the postmaster reaps it; the writer dies of SIGPIPE on the closed pipe, and the postmaster
# reads any child killed by a signal as a crashed backend and restarts every server process - three
# crash recoveries in every chain run, logged as "server process (PID n) was terminated by signal 13"
# with n two below the migration's backend. With an init as PID 1, the orphan is its to reap.
# Reproduced in a disposable postgres:16.4-alpine: a 369 KB heredoc crashes the cluster, a 551-byte
# one (no writer forked) and the same 369 KB heredoc under --init do not; a process snapshot names
# the killed pid as the heredoc writer, with no connection of its own.
docker run \
  --detach \
  --init \
  --name "$container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${volume},target=/var/lib/postgresql/data" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${test_password}" \
  --env POSTGRES_DB=postgres \
  "$postgres_image" \
  -c log_lock_waits=on \
  -c deadlock_timeout=1s \
  -c log_statement=all > /dev/null
container_created=true
docker run \
  --detach \
  --init \
  --name "$impersonator_container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${impersonator_volume},target=/var/lib/postgresql/data" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${impersonator_password}" \
  --env "POSTGRES_DB=${impersonator_database}" \
  "$postgres_image" > /dev/null
impersonator_container_created=true

attempt=1
until docker exec "$container" pg_isready --username postgres --dbname postgres > /dev/null 2>&1; do
  if [[ "$attempt" -ge 30 ]]; then
    echo "ERROR: isolated PostgreSQL did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

attempt=1
until timeout 3 docker exec "$impersonator_container" psql --quiet --username postgres \
  --dbname "$impersonator_database" --command 'SELECT 1' > /dev/null 2>&1; do
  if [[ "$attempt" -ge 30 ]]; then
    echo "ERROR: impersonating PostgreSQL did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

port_mapping="$(docker port "$container" 5432/tcp)"
postgres_port="${port_mapping##*:}"
case "$postgres_port" in
  '' | *[!0-9]*)
    echo "ERROR: could not determine isolated PostgreSQL port." >&2
    exit 1
    ;;
esac
readonly published_postgres_port="$postgres_port"

impersonator_port_mapping="$(docker port "$impersonator_container" 5432/tcp)"
impersonator_port="${impersonator_port_mapping##*:}"
case "$impersonator_port" in
  '' | *[!0-9]*)
    echo "ERROR: could not determine impersonating PostgreSQL port." >&2
    exit 1
    ;;
esac

postgres_endpoint="$(
  select_reachable_postgres_endpoint "$container" "$postgres_port" "isolated"
)"
read -r postgres_host postgres_port <<< "$postgres_endpoint"
if [[ -f /.dockerenv ]]; then
  postgres_alias_host="host.docker.internal"
  postgres_alias_port="$published_postgres_port"
else
  postgres_alias_host="localhost"
  postgres_alias_port="$published_postgres_port"
fi
readonly postgres_alias_host postgres_alias_port
if [[ "$postgres_alias_host" == "$postgres_host" && "$postgres_alias_port" == "$postgres_port" ]]; then
  echo "ERROR: isolated PostgreSQL alias endpoint is not distinct." >&2
  exit 1
fi
if ! probe_tcp_endpoint "$postgres_alias_host" "$postgres_alias_port"; then
  echo "ERROR: isolated PostgreSQL alias endpoint is unreachable from the caller after 15 seconds." >&2
  exit 1
fi
impersonator_endpoint="$(
  select_reachable_postgres_endpoint \
    "$impersonator_container" "$impersonator_port" "impersonating"
)"
read -r impersonator_host impersonator_port <<< "$impersonator_endpoint"

docker exec --interactive "$impersonator_container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$impersonator_database" \
  --set=impersonator_database="$impersonator_database" \
  --set=impersonator_password="$impersonator_password" << 'SQL'
CREATE ROLE rd_owner NOLOGIN;
CREATE ROLE backtest_owner LOGIN PASSWORD :'impersonator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CONNECT ON DATABASE :"impersonator_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"impersonator_database" TO backtest_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT USAGE ON SCHEMA rd_owner_api TO backtest_owner;
CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)
RETURNS jsonb
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog, pg_temp
AS $function$
DECLARE encoded text;
BEGIN
  encoded := pg_catalog.current_setting('vibe.fake_envelope_base64', true);
  IF encoded IS NULL OR encoded = '' THEN
    RETURN pg_catalog.jsonb_build_object('schema_version',1,'availability','STALE');
  END IF;
  RETURN pg_catalog.convert_from(pg_catalog.decode(encoded,'base64'),'UTF8')::pg_catalog.jsonb;
END
$function$;
ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) TO backtest_owner;
CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)
RETURNS jsonb
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog, pg_temp
AS $function$
DECLARE encoded text;
BEGIN
  encoded := pg_catalog.current_setting('vibe.fake_envelope_base64', true);
  IF encoded IS NULL OR encoded = '' THEN
    RETURN pg_catalog.jsonb_build_object('schema_version',2,'availability','STALE');
  END IF;
  RETURN pg_catalog.convert_from(pg_catalog.decode(encoded,'base64'),'UTF8')::pg_catalog.jsonb;
END
$function$;
ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) TO backtest_owner;
SQL

docker exec --interactive \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_DB=postgres \
  --env "RD_OWNER_DATABASE_NAME=${test_database}" \
  --env "RD_OWNER_DB_PASSWORD=${test_password}" \
  --env "RD_FACT_WRITER_DB_PASSWORD=${test_password}" \
  --env "MARKET_DATA_OWNER_DB_PASSWORD=${test_password}" \
  --env "MARKET_DATA_READER_DB_PASSWORD=${test_password}" \
  --env "REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD=${test_password}" \
  --env "OPERATOR_AUTHORIZATION_DB_PASSWORD=${test_password}" \
  --env "QUALIFICATION_OWNER_DB_PASSWORD=${test_password}" \
  --env "PRODUCT_EDGE_DB_PASSWORD=${test_password}" \
  --env "BACKTEST_OWNER_DB_PASSWORD=${test_password}" \
  --env "EXECUTION_WRITER_DB_PASSWORD=${test_password}" \
  --env "PORTFOLIO_WRITER_DB_PASSWORD=${test_password}" \
  --env "GOVERNANCE_WRITER_DB_PASSWORD=${test_password}" \
  --env "INSTRUMENT_OWNER_DB_PASSWORD=${test_password}" \
  --env "RISK_WRITER_DB_PASSWORD=${test_password}" \
  --env "SCANNER_WRITER_DB_PASSWORD=${test_password}" \
  "$container" sh -s < product/rd-workbench/postgres-init/00-create-rd-owner.sh

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE ROLE surprise_replay_grantee NOLOGIN;
CREATE TABLE public.rd_exploratory_replay_request_custody_v1 (
  request_identity text PRIMARY KEY,
  request_digest text NOT NULL,
  build_request_identity text NOT NULL,
  attempt_identity text NOT NULL,
  intent_identity text NOT NULL,
  trial_family_identity text NOT NULL,
  artifact_identity text NOT NULL,
  build_receipt_identity text NOT NULL,
  artifact_family_binding_identity text NOT NULL,
  census_frontier_identity text NOT NULL,
  frozen_json jsonb NOT NULL,
  receipt_json jsonb NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'FROZEN',
  committed_at_epoch_ms bigint NOT NULL,
  request_schema_version smallint NOT NULL DEFAULT 1,
  v2_canonical_request_bytes bytea,
  v2_meaning_digest text,
  v2_seal_digest text,
  v2_receipt_json jsonb
);
ALTER TABLE public.rd_exploratory_replay_request_custody_v1 OWNER TO rd_owner;
REVOKE ALL ON TABLE public.rd_exploratory_replay_request_custody_v1 FROM PUBLIC;
GRANT SELECT, UPDATE ON TABLE public.rd_exploratory_replay_request_custody_v1 TO surprise_replay_grantee;
GRANT SELECT(request_identity), UPDATE(lifecycle_state)
  ON TABLE public.rd_exploratory_replay_request_custody_v1 TO surprise_replay_grantee;
INSERT INTO public.rd_exploratory_replay_request_custody_v1 (
  request_identity,
  request_digest,
  build_request_identity,
  attempt_identity,
  intent_identity,
  trial_family_identity,
  artifact_identity,
  build_receipt_identity,
  artifact_family_binding_identity,
  census_frontier_identity,
  frozen_json,
  receipt_json,
  lifecycle_state,
  committed_at_epoch_ms,
  request_schema_version
) VALUES (
  'internal-continuity-replay-v1',
  'sha256:internal-continuity-request-v1',
  'internal-continuity-build-v1',
  'internal-continuity-attempt-v1',
  'internal-continuity-intent-v1',
  'internal-continuity-family-v1',
  'sha256:internal-continuity-artifact-v1',
  'internal-continuity-build-receipt-v1',
  'internal-continuity-family-binding-v1',
  'internal-continuity-census-v1',
  pg_catalog.jsonb_build_object('kind','internal-custody-continuity','schema_version',1),
  pg_catalog.jsonb_build_object('kind','internal-custody-continuity-receipt','schema_version',1),
  'FROZEN',
  1700000000000,
  1
);
SQL

nextest_temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
if [[ ! -d "$nextest_temp_root" ]]; then
  echo "ERROR: nextest archive parent does not exist: ${nextest_temp_root}" >&2
  exit 1
fi
nextest_archive_dir="$(mktemp -d "${nextest_temp_root%/}/vibe-rd-owner-nextest.XXXXXXXX")"
nextest_archive_file="${nextest_archive_dir}/rd-owner-tests.tar.zst"
if [[ -n "${RD_OWNER_NEXTEST_ARCHIVE:-}" ]]; then
  if ! diff -u "${RD_OWNER_NEXTEST_ARCHIVE}.identity" <(nextest_archive_identity) >&2; then
    echo "ERROR: the archive at ${RD_OWNER_NEXTEST_ARCHIVE} was not built from this tree with these" >&2
    echo "       features and profiles (its identity is on the left above), so its binaries are not" >&2
    echo "       the ones this chain must run." >&2
    exit 1
  fi
  echo "=== running the archive built elsewhere: ${RD_OWNER_NEXTEST_ARCHIVE}" >&2
  cp -- "$RD_OWNER_NEXTEST_ARCHIVE" "$nextest_archive_file"
else
  build_nextest_archive "$nextest_archive_file"
fi

# Extract the archive once and run every entry from the extracted tree. `--archive-file` extracts the
# whole archive again on each invocation - 52 binaries, about 3.5 s each time - and the chain makes
# one invocation per entry, so that alone was six of its minutes (run 35989665241). `--no-run` stops
# after the extraction. The reuse arguments point nextest at the same metadata, binaries and libdirs
# the archive run would have extracted, with the same remapping, so the tests run the same binaries.
nextest_extract_dir="${nextest_archive_dir}/extracted"
mkdir -- "$nextest_extract_dir"
cargo nextest run \
  --archive-file "$nextest_archive_file" \
  --extract-to "$nextest_extract_dir" \
  --no-run
readonly nextest_reuse_args=(
  --binaries-metadata "${nextest_extract_dir}/target/nextest/binaries-metadata.json"
  --cargo-metadata "${nextest_extract_dir}/target/nextest/cargo-metadata.json"
  --target-dir-remap "${nextest_extract_dir}/target"
  --workspace-remap "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
)

# The schema materializer is the rd-owner-api binary the archive already holds; see
# nextest_archive_features for why it is not built a second time.
schema_materializer="$(
  python3 - "${nextest_extract_dir}/target" << 'BINARY'
import json
import sys

target = sys.argv[1]
meta = json.load(open(f"{target}/nextest/binaries-metadata.json", encoding="utf-8"))["rust-build-meta"]
found = [
    binary["path"]
    for binaries in meta["non-test-binaries"].values()
    for binary in binaries
    if binary["name"] == "strategy-factory-rd-owner-api" and binary["kind"] == "bin-exe"
]
if len(found) != 1:
    sys.exit(f"ERROR: the archive holds {len(found)} strategy-factory-rd-owner-api binaries, expected 1.")
print(f"{target}/{found[0]}")
BINARY
)"
RD_OWNER_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}" \
  "$schema_materializer" \
  --materialize-schema

docker exec --interactive \
  --env POSTGRES_HOST=127.0.0.1 \
  --env "POSTGRES_DATABASE=${test_database}" \
  --env "POSTGRES_PASSWORD=${test_password}" \
  --env "RD_OWNER_DB_PASSWORD=${test_password}" \
  --env "RD_FACT_WRITER_DB_PASSWORD=${test_password}" \
  --env "MARKET_DATA_OWNER_DB_PASSWORD=${test_password}" \
  --env "MARKET_DATA_READER_DB_PASSWORD=${test_password}" \
  --env "REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD=${test_password}" \
  --env "OPERATOR_AUTHORIZATION_DB_PASSWORD=${test_password}" \
  --env "QUALIFICATION_OWNER_DB_PASSWORD=${test_password}" \
  --env "PRODUCT_EDGE_DB_PASSWORD=${test_password}" \
  --env "BACKTEST_OWNER_DB_PASSWORD=${test_password}" \
  --env "EXECUTION_WRITER_DB_PASSWORD=${test_password}" \
  --env "PORTFOLIO_WRITER_DB_PASSWORD=${test_password}" \
  --env "GOVERNANCE_WRITER_DB_PASSWORD=${test_password}" \
  --env "INSTRUMENT_OWNER_DB_PASSWORD=${test_password}" \
  --env "RISK_WRITER_DB_PASSWORD=${test_password}" \
  --env "SCANNER_WRITER_DB_PASSWORD=${test_password}" \
  --env "SEALED_SOURCE_RESEARCH_COMPOSER_ACCEPTANCE=${composer_acceptance_migration}" \
  "$container" sh -s < product/rd-workbench/postgres-init/10-migrate-authority-custody.sh

existing_cutover_candidate_experiment_fingerprint_before="$(
  existing_cutover_replay_fingerprint
)"
readonly existing_cutover_candidate_experiment_fingerprint_before
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DROP TABLE public.rd_trial_family_candidate_experiments_v1;
SQL
run_authority_migration_for_database "$test_database"
existing_cutover_candidate_experiment_fingerprint_after="$(
  existing_cutover_replay_fingerprint
)"
readonly existing_cutover_candidate_experiment_fingerprint_after
if [[ "$existing_cutover_candidate_experiment_fingerprint_after" != "$existing_cutover_candidate_experiment_fingerprint_before" ]]; then
  echo "ERROR: Candidate experiment cutover upgrade changed existing R&D OID or canonical row bytes." >&2
  exit 1
fi

verify_candidate_experiment_acl_convergence() {
  local fingerprint_before fingerprint_after idempotent_fingerprint
  fingerprint_before="$(candidate_experiment_owner_only_fingerprint)"
  if [[ -z "$fingerprint_before" ]]; then
    echo "ERROR: no canonical Candidate experiment entered exact Owner-only custody." >&2
    return 1
  fi
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
CREATE ROLE candidate_experiment_acl_grantor NOLOGIN;
CREATE ROLE candidate_experiment_acl_delegate NOLOGIN;
GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO rd_exploratory_replay_api_owner, surprise_replay_grantee;
GRANT SELECT(experiment_identity), SELECT(candidate_digest)
  ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO rd_exploratory_replay_api_owner, surprise_replay_grantee;
GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO candidate_experiment_acl_grantor WITH GRANT OPTION;
GRANT SELECT(experiment_identity), SELECT(candidate_digest)
  ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO candidate_experiment_acl_grantor WITH GRANT OPTION;
SET ROLE candidate_experiment_acl_grantor;
GRANT SELECT ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO candidate_experiment_acl_delegate;
GRANT SELECT(experiment_identity), SELECT(candidate_digest)
  ON TABLE public.rd_trial_family_candidate_experiments_v1
  TO candidate_experiment_acl_delegate;
RESET ROLE;
SQL
  run_authority_migration_for_database "$test_database"
  fingerprint_after="$(candidate_experiment_owner_only_fingerprint)"
  if [[ "$fingerprint_after" != "$fingerprint_before" ]]; then
    echo "ERROR: Candidate experiment ACL convergence changed its OID or canonical rows, or retained a non-Owner grant." >&2
    return 1
  fi
  run_authority_migration_for_database "$test_database"
  idempotent_fingerprint="$(candidate_experiment_owner_only_fingerprint)"
  if [[ "$idempotent_fingerprint" != "$fingerprint_before" ]]; then
    echo "ERROR: Candidate experiment ACL convergence is not idempotent." >&2
    return 1
  fi
}

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --set=test_database="$test_database" \
  --set=test_password="$test_password" << 'SQL'
CREATE ROLE vibe_test_owner_topology_admin LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'test_password';
CREATE ROLE instrument_economic_intruder LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE instrument_economic_noinherit_intruder LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE market_data_reader PASSWORD :'test_password';
GRANT replay_policy_catalog_owner, composer_owner TO vibe_test_owner_topology_admin;
DO $database_access$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO rd_fact_writer, replay_policy_catalog_admin_writer, vibe_test_owner_topology_admin, instrument_owner',
    pg_catalog.current_database()
  );
END
$database_access$;
SQL

readonly test_marker="rd-owner-isolated-${suffix}"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --set=test_database="$test_database" \
  --set=test_marker="$test_marker" << 'SQL'
CREATE SCHEMA IF NOT EXISTS vibe_test_admin AUTHORIZATION postgres;
CREATE TABLE IF NOT EXISTS vibe_test_admin.dedicated_postgres_test_instance_v1 (
  marker_identity text NOT NULL,
  database_name text NOT NULL,
  test_role text PRIMARY KEY
);
ALTER TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 OWNER TO postgres;
REVOKE ALL ON SCHEMA vibe_test_admin FROM PUBLIC;
REVOKE ALL ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_admin TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
GRANT SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
INSERT INTO vibe_test_admin.dedicated_postgres_test_instance_v1(marker_identity, database_name, test_role)
SELECT :'test_marker', :'test_database', role_name
FROM unnest(ARRAY[
  'operator_authorization_writer',
  'product_edge_owner',
  'rd_owner',
  'rd_fact_writer',
  'replay_policy_catalog_admin_writer',
  'market_data_owner',
  'market_data_reader',
  'qualification_writer',
  'backtest_owner',
  'instrument_owner',
  'execution_writer',
  'portfolio_writer',
  'governance_writer',
  'risk_writer',
  'scanner_writer',
  'vibe_test_owner_topology_admin'
]) AS role_name
ON CONFLICT (test_role) DO UPDATE
SET marker_identity=EXCLUDED.marker_identity, database_name=EXCLUDED.database_name;

CREATE FUNCTION vibe_test_admin.remove_qualification_holdout_treatment_registration_v1(
  expected_marker_identity text,
  requested_reservation_identity text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF session_user<>'qualification_writer' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Qualification legacy-upgrade fixture caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='qualification_writer'
  ) THEN
    RAISE EXCEPTION 'Qualification legacy-upgrade fixture marker mismatch' USING ERRCODE='55000';
  END IF;
  DELETE FROM public.qualification_holdout_treatment_registrations_v1 registration
   WHERE registration.reservation_identity=requested_reservation_identity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Qualification treatment registration fixture unavailable' USING ERRCODE='55000';
  END IF;
END
$function$;
ALTER FUNCTION vibe_test_admin.remove_qualification_holdout_treatment_registration_v1(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.remove_qualification_holdout_treatment_registration_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.remove_qualification_holdout_treatment_registration_v1(text,text)
  TO qualification_writer;

CREATE FUNCTION vibe_test_admin.inject_backtest_result_acl_with_fence_v1(
  expected_marker_identity text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Backtest Result fence fault caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Backtest Result fence fault marker mismatch' USING ERRCODE='55000';
  END IF;
  PERFORM pg_catalog.set_config(
    'application_name','vibe-backtest-result-fence-v1',true
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0)
  );
  EXECUTE 'GRANT SELECT ON TABLE public.backtest_replay_results_v2 TO rd_owner';
END
$function$;
ALTER FUNCTION vibe_test_admin.inject_backtest_result_acl_with_fence_v1(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.inject_backtest_result_acl_with_fence_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.inject_backtest_result_acl_with_fence_v1(text)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.delete_instrument_economic_fact_as_replica_v1(
  expected_marker_identity text,
  requested_fact_identity bytea
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Instrument Owner replica fault caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Instrument Owner replica fault marker mismatch' USING ERRCODE='55000';
  END IF;
  PERFORM pg_catalog.set_config('session_replication_role','replica',true);
  EXECUTE 'DELETE FROM instrument_owner_private.economic_terms_facts_v1 WHERE fact_identity=$1'
    USING requested_fact_identity;
END
$function$;
ALTER FUNCTION vibe_test_admin.delete_instrument_economic_fact_as_replica_v1(text,bytea)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.delete_instrument_economic_fact_as_replica_v1(text,bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.delete_instrument_economic_fact_as_replica_v1(text,bytea)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.set_instrument_economic_builtin_membership_v1(
  expected_marker_identity text,
  requested_role text,
  enabled boolean
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Instrument Owner membership fault caller mismatch' USING ERRCODE='42501';
  END IF;
  IF requested_role NOT IN ('instrument_economic_intruder','instrument_economic_noinherit_intruder') THEN
    RAISE EXCEPTION 'Instrument Owner membership fault target mismatch' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Instrument Owner membership fault marker mismatch' USING ERRCODE='55000';
  END IF;
  IF enabled THEN
    EXECUTE pg_catalog.format('GRANT pg_write_all_data TO %I', requested_role);
  ELSE
    EXECUTE pg_catalog.format('REVOKE pg_write_all_data FROM %I', requested_role);
  END IF;
END
$function$;
ALTER FUNCTION vibe_test_admin.set_instrument_economic_builtin_membership_v1(text,text,boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.set_instrument_economic_builtin_membership_v1(text,text,boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_instrument_economic_builtin_membership_v1(text,text,boolean)
  TO vibe_test_owner_topology_admin;

CREATE TABLE vibe_test_admin.rd_exploratory_replay_routine_definition_v1 (
  target text PRIMARY KEY,
  definition text NOT NULL
);
CREATE TABLE vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 (
  target text PRIMARY KEY
);
ALTER TABLE vibe_test_admin.rd_exploratory_replay_routine_definition_v1 OWNER TO postgres;
ALTER TABLE vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 OWNER TO postgres;
REVOKE ALL ON TABLE vibe_test_admin.rd_exploratory_replay_routine_definition_v1,
  vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 FROM PUBLIC;
GRANT INSERT ON TABLE vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1
  TO rd_exploratory_replay_api_owner;
GRANT SELECT ON TABLE vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.drift_rd_exploratory_replay_routine_v1(
  expected_marker_identity text,
  target text,
  restore boolean
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE target_oid oid;
DECLARE saved_definition text;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'R&D Replay routine drift caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'R&D Replay routine drift marker mismatch' USING ERRCODE='55000';
  END IF;
  target_oid := CASE target
    WHEN 'facade' THEN pg_catalog.to_regprocedure('rd_owner_api.lock_exploratory_replay_request_for_market_data_v1(text,text,text,text)')
    WHEN 'v2' THEN pg_catalog.to_regprocedure('rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text)')
    WHEN 'v1' THEN pg_catalog.to_regprocedure('rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text)')
    ELSE NULL
  END;
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'R&D Replay routine drift target mismatch' USING ERRCODE='22023';
  END IF;
  IF restore THEN
    SELECT definition INTO STRICT saved_definition
      FROM vibe_test_admin.rd_exploratory_replay_routine_definition_v1 stored
     WHERE stored.target=drift_rd_exploratory_replay_routine_v1.target;
    EXECUTE saved_definition;
    DELETE FROM vibe_test_admin.rd_exploratory_replay_routine_definition_v1 stored
     WHERE stored.target=drift_rd_exploratory_replay_routine_v1.target;
    RETURN;
  END IF;
  INSERT INTO vibe_test_admin.rd_exploratory_replay_routine_definition_v1(target,definition)
  VALUES (target,pg_catalog.pg_get_functiondef(target_oid));
  IF target='facade' THEN
    EXECUTE $ddl$CREATE OR REPLACE FUNCTION rd_owner_api.lock_exploratory_replay_request_for_market_data_v1(requested_request_identity text,requested_meaning_digest text,requested_receipt_identity text,requested_seal_digest text) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$BEGIN INSERT INTO vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 VALUES ('facade'); RETURN NULL; END$body$$ddl$;
  ELSIF target='v2' THEN
    EXECUTE $ddl$CREATE OR REPLACE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(requested_request_identity text,requested_meaning_digest text,requested_receipt_identity text,requested_seal_digest text) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path=pg_catalog AS $body$BEGIN INSERT INTO vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 VALUES ('v2'); RETURN NULL; END$body$$ddl$;
  ELSE
    EXECUTE $ddl$CREATE OR REPLACE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(requested_request_identity text,requested_request_digest text,requested_receipt_identity text) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path=pg_catalog AS $body$BEGIN INSERT INTO vibe_test_admin.rd_exploratory_replay_routine_sentinel_v1 VALUES ('v1'); RETURN NULL; END$body$$ddl$;
  END IF;
END
$function$;
ALTER FUNCTION vibe_test_admin.drift_rd_exploratory_replay_routine_v1(text,text,boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.drift_rd_exploratory_replay_routine_v1(text,text,boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.drift_rd_exploratory_replay_routine_v1(text,text,boolean)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.rename_sealed_exploratory_replay_fixture_v1(
  expected_marker_identity text,
  target_relation_name text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay fixture rename caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Replay fixture rename marker mismatch' USING ERRCODE='55000';
  END IF;
  IF target_relation_name NOT IN (
    'rd_exploratory_replay_request_custody_v1',
    'rd_exploratory_replay_requests_v1'
  ) THEN
    RAISE EXCEPTION 'Replay fixture rename target mismatch' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_request_custody_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_sealed_exploratory_replay_requests_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_requests_v1')
  );

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace namespace
      JOIN pg_catalog.pg_roles owner ON owner.oid=namespace.nspowner
     WHERE namespace.nspname='public'
       AND owner.rolname='rd_database_owner'
  ) THEN
    RAISE EXCEPTION 'Replay fixture rename schema owner mismatch' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
     WHERE namespace.nspname='public'
       AND relation.relname='rd_sealed_exploratory_replay_requests_v1'
       AND relation.relkind='r'
       AND relation.relpersistence='p'
       AND owner.rolname='rd_owner'
  ) THEN
    RAISE EXCEPTION 'Replay fixture rename source mismatch' USING ERRCODE='55000';
  END IF;

  IF target_relation_name='rd_exploratory_replay_request_custody_v1' THEN
    IF pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NOT NULL THEN
      RAISE EXCEPTION 'Replay fixture rename target exists' USING ERRCODE='42P07';
    END IF;
    ALTER TABLE public.rd_sealed_exploratory_replay_requests_v1
      RENAME TO rd_exploratory_replay_request_custody_v1;
  ELSE
    IF pg_catalog.to_regclass('public.rd_exploratory_replay_requests_v1') IS NOT NULL THEN
      RAISE EXCEPTION 'Replay fixture rename target exists' USING ERRCODE='42P07';
    END IF;
    ALTER TABLE public.rd_sealed_exploratory_replay_requests_v1
      RENAME TO rd_exploratory_replay_requests_v1;
  END IF;
END
$function$;
ALTER FUNCTION vibe_test_admin.rename_sealed_exploratory_replay_fixture_v1(text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.rename_sealed_exploratory_replay_fixture_v1(text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.rename_sealed_exploratory_replay_fixture_v1(text,text)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.restore_sealed_exploratory_replay_fixture_v1(
  expected_marker_identity text,
  source_relation_name text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE source_oid oid;
DECLARE source_is_current boolean;
DECLARE candidate_oid oid;
DECLARE candidate_is_current boolean;
DECLARE current_candidate_count integer := 0;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay fixture restore caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Replay fixture restore marker mismatch' USING ERRCODE='55000';
  END IF;
  IF source_relation_name NOT IN (
    'rd_exploratory_replay_request_custody_v1',
    'rd_exploratory_replay_requests_v1'
  ) THEN
    RAISE EXCEPTION 'Replay fixture restore source mismatch' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_request_custody_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_sealed_exploratory_replay_requests_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_requests_v1')
  );

  IF pg_catalog.to_regclass('public.rd_sealed_exploratory_replay_requests_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'Replay fixture restore canonical target exists' USING ERRCODE='42P07';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace namespace
      JOIN pg_catalog.pg_roles owner ON owner.oid=namespace.nspowner
     WHERE namespace.nspname='public'
       AND owner.rolname='rd_database_owner'
  ) THEN
    RAISE EXCEPTION 'Replay fixture restore schema owner mismatch' USING ERRCODE='55000';
  END IF;

  IF source_relation_name='rd_exploratory_replay_request_custody_v1' THEN
    source_oid := pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1');
  ELSE
    source_oid := pg_catalog.to_regclass('public.rd_exploratory_replay_requests_v1');
  END IF;

  FOREACH candidate_oid IN ARRAY ARRAY[
    pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1'),
    pg_catalog.to_regclass('public.rd_exploratory_replay_requests_v1')
  ] LOOP
    CONTINUE WHEN candidate_oid IS NULL;
    SELECT relation.relkind='r'
     AND relation.relpersistence='p'
     AND owner.rolname='rd_owner'
     AND (
       SELECT pg_catalog.count(*)=24
          AND pg_catalog.bool_and(CASE attribute.attname
            WHEN 'request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'request_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'build_request_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'attempt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'intent_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'trial_family_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'artifact_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'build_receipt_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'artifact_family_binding_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'census_frontier_identity' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'frozen_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'lifecycle_state' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'committed_at_epoch_ms' THEN attribute.atttypid='pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'request_schema_version' THEN attribute.atttypid='pg_catalog.int2'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'v2_canonical_request_bytes' THEN attribute.atttypid='pg_catalog.bytea'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_meaning_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_seal_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_receipt_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_request_storage_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_receipt_storage_bytes' THEN attribute.atttypid='pg_catalog.bytea'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'v2_receipt_storage_digest' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND NOT attribute.attnotnull
            WHEN 'source_kind' THEN attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
            WHEN 'composer_source_json' THEN attribute.atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attribute.attnotnull
            ELSE false
          END)
         FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid=candidate_oid
          AND attribute.attnum>0
          AND NOT attribute.attisdropped
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
        WHERE constraint_entry.conrelid=candidate_oid
          AND constraint_entry.contype='p'
          AND constraint_entry.conkey=ARRAY[(
            SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
             WHERE attribute.attrelid=candidate_oid
               AND attribute.attname='request_identity'
          )]::smallint[]
     )
    INTO candidate_is_current
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
   WHERE relation.oid=candidate_oid;
    IF candidate_oid=source_oid THEN
      source_is_current := candidate_is_current;
    END IF;
    IF candidate_is_current THEN
      current_candidate_count := current_candidate_count + 1;
    END IF;
  END LOOP;
  IF NOT COALESCE(source_is_current,false) OR current_candidate_count<>1 THEN
    RAISE EXCEPTION 'Replay fixture restore source topology mismatch' USING ERRCODE='55000';
  END IF;

  IF source_relation_name='rd_exploratory_replay_request_custody_v1' THEN
    ALTER TABLE public.rd_exploratory_replay_request_custody_v1
      RENAME TO rd_sealed_exploratory_replay_requests_v1;
  ELSE
    ALTER TABLE public.rd_exploratory_replay_requests_v1
      RENAME TO rd_sealed_exploratory_replay_requests_v1;
  END IF;
END
$function$;
ALTER FUNCTION vibe_test_admin.restore_sealed_exploratory_replay_fixture_v1(text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.restore_sealed_exploratory_replay_fixture_v1(text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.restore_sealed_exploratory_replay_fixture_v1(text,text)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.create_duplicate_exploratory_replay_fixture_v1(
  expected_marker_identity text,
  requested_request_identity text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE source_oid oid;
DECLARE source_is_current boolean;
DECLARE copied_rows bigint;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay duplicate fixture create caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Replay duplicate fixture create marker mismatch' USING ERRCODE='55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_request_custody_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_sealed_exploratory_replay_requests_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_requests_v1')
  );

  IF pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'Replay duplicate fixture create target exists' USING ERRCODE='42P07';
  END IF;
  source_oid := pg_catalog.to_regclass('public.rd_sealed_exploratory_replay_requests_v1');
  SELECT relation.relkind='r'
     AND relation.relpersistence='p'
     AND namespace.nspname='public'
     AND owner.rolname='rd_owner'
     AND (
       SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)=ARRAY[
         'request_identity','request_digest','build_request_identity','attempt_identity',
         'intent_identity','trial_family_identity','artifact_identity','build_receipt_identity',
         'artifact_family_binding_identity','census_frontier_identity','frozen_json','receipt_json',
         'lifecycle_state','committed_at_epoch_ms','request_schema_version',
         'v2_canonical_request_bytes','v2_meaning_digest','v2_seal_digest','v2_receipt_json',
         'source_kind','composer_source_json',
         'v2_request_storage_digest','v2_receipt_storage_bytes','v2_receipt_storage_digest'
       ]::name[]
       AND pg_catalog.array_agg(attribute.atttypid ORDER BY attribute.attnum)=ARRAY[
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.jsonb'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.int8'::pg_catalog.regtype,
         'pg_catalog.int2'::pg_catalog.regtype,'pg_catalog.bytea'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.bytea'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype
       ]::oid[]
       AND pg_catalog.array_agg(attribute.attnotnull ORDER BY attribute.attnum)=ARRAY[
         true,true,false,false,true,true,true,false,false,true,true,true,true,true,true,
         false,false,false,false,true,false,false,false,false
       ]
         FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid=source_oid
          AND attribute.attnum>0
          AND NOT attribute.attisdropped
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
        WHERE constraint_entry.conrelid=source_oid
          AND constraint_entry.contype='p'
          AND constraint_entry.conkey=ARRAY[(
            SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
             WHERE attribute.attrelid=source_oid
               AND attribute.attname='request_identity'
          )]::smallint[]
     )
    INTO source_is_current
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
   WHERE relation.oid=source_oid;
  IF NOT COALESCE(source_is_current,false) THEN
    RAISE EXCEPTION 'Replay duplicate fixture create source topology mismatch' USING ERRCODE='55000';
  END IF;

  CREATE TABLE public.rd_exploratory_replay_request_custody_v1
    (LIKE public.rd_sealed_exploratory_replay_requests_v1 INCLUDING ALL);
  INSERT INTO public.rd_exploratory_replay_request_custody_v1
  SELECT * FROM public.rd_sealed_exploratory_replay_requests_v1
   WHERE request_identity=requested_request_identity;
  GET DIAGNOSTICS copied_rows = ROW_COUNT;
  IF copied_rows<>1 THEN
    RAISE EXCEPTION 'Replay duplicate fixture create request mismatch' USING ERRCODE='P0002';
  END IF;
  ALTER TABLE public.rd_exploratory_replay_request_custody_v1 OWNER TO rd_owner;
  REVOKE ALL ON TABLE public.rd_exploratory_replay_request_custody_v1 FROM PUBLIC;
  GRANT SELECT, UPDATE ON TABLE public.rd_exploratory_replay_request_custody_v1
    TO surprise_replay_grantee;
END
$function$;
ALTER FUNCTION vibe_test_admin.create_duplicate_exploratory_replay_fixture_v1(text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.create_duplicate_exploratory_replay_fixture_v1(text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.create_duplicate_exploratory_replay_fixture_v1(text,text)
  TO vibe_test_owner_topology_admin;

CREATE FUNCTION vibe_test_admin.remove_duplicate_exploratory_replay_fixture_v1(
  expected_marker_identity text,
  requested_request_identity text
) RETURNS void LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE target_oid oid;
DECLARE target_is_current boolean;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay duplicate fixture remove caller mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
     WHERE marker.marker_identity=expected_marker_identity
       AND marker.database_name=pg_catalog.current_database()
       AND marker.test_role='vibe_test_owner_topology_admin'
  ) THEN
    RAISE EXCEPTION 'Replay duplicate fixture remove marker mismatch' USING ERRCODE='55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_request_custody_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_sealed_exploratory_replay_requests_v1')
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.rd_exploratory_replay_requests_v1')
  );

  IF pg_catalog.to_regclass('public.rd_sealed_exploratory_replay_requests_v1') IS NULL THEN
    RAISE EXCEPTION 'Replay duplicate fixture remove canonical source missing' USING ERRCODE='42P01';
  END IF;
  target_oid := pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1');
  SELECT relation.relkind='r'
     AND relation.relpersistence='p'
     AND namespace.nspname='public'
     AND owner.rolname='rd_owner'
     AND (
       SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)=ARRAY[
         'request_identity','request_digest','build_request_identity','attempt_identity',
         'intent_identity','trial_family_identity','artifact_identity','build_receipt_identity',
         'artifact_family_binding_identity','census_frontier_identity','frozen_json','receipt_json',
         'lifecycle_state','committed_at_epoch_ms','request_schema_version',
         'v2_canonical_request_bytes','v2_meaning_digest','v2_seal_digest','v2_receipt_json',
         'source_kind','composer_source_json',
         'v2_request_storage_digest','v2_receipt_storage_bytes','v2_receipt_storage_digest'
       ]::name[]
       AND pg_catalog.array_agg(attribute.atttypid ORDER BY attribute.attnum)=ARRAY[
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.jsonb'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.int8'::pg_catalog.regtype,
         'pg_catalog.int2'::pg_catalog.regtype,'pg_catalog.bytea'::pg_catalog.regtype,
         'pg_catalog.text'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.jsonb'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype,
         'pg_catalog.bytea'::pg_catalog.regtype,'pg_catalog.text'::pg_catalog.regtype
       ]::oid[]
       AND pg_catalog.array_agg(attribute.attnotnull ORDER BY attribute.attnum)=ARRAY[
         true,true,false,false,true,true,true,false,false,true,true,true,true,true,true,
         false,false,false,false,true,false,false,false,false
       ]
         FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid=target_oid
          AND attribute.attnum>0
          AND NOT attribute.attisdropped
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint constraint_entry
        WHERE constraint_entry.conrelid=target_oid
          AND constraint_entry.contype='p'
          AND constraint_entry.conkey=ARRAY[(
            SELECT attribute.attnum FROM pg_catalog.pg_attribute attribute
             WHERE attribute.attrelid=target_oid
               AND attribute.attname='request_identity'
          )]::smallint[]
     )
    INTO target_is_current
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
   WHERE relation.oid=target_oid;
  IF NOT COALESCE(target_is_current,false) THEN
    RAISE EXCEPTION 'Replay duplicate fixture remove target topology mismatch' USING ERRCODE='55000';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.rd_exploratory_replay_request_custody_v1)<>1
     OR NOT EXISTS (
       SELECT 1 FROM public.rd_exploratory_replay_request_custody_v1
        WHERE request_identity=requested_request_identity
     ) THEN
    RAISE EXCEPTION 'Replay duplicate fixture remove request mismatch' USING ERRCODE='55000';
  END IF;

  DROP TABLE public.rd_exploratory_replay_request_custody_v1;
END
$function$;
ALTER FUNCTION vibe_test_admin.remove_duplicate_exploratory_replay_fixture_v1(text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.remove_duplicate_exploratory_replay_fixture_v1(text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.remove_duplicate_exploratory_replay_fixture_v1(text,text)
  TO vibe_test_owner_topology_admin;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_database="$test_database" \
  --set=catalog_admin_database="$catalog_admin_database" \
  --set=origin_current_database="$origin_current_database" \
  --set=legacy_replay_database="$legacy_replay_database" \
  --set=program_host_acceptance_database="$program_host_acceptance_database" \
  --set=composer_sealed_read_database="$composer_sealed_read_database" << 'SQL'
CREATE DATABASE :"catalog_admin_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
CREATE DATABASE :"origin_current_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
CREATE DATABASE :"legacy_replay_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
CREATE DATABASE :"program_host_acceptance_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
CREATE DATABASE :"composer_sealed_read_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE :"catalog_admin_database" FROM PUBLIC;
REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE :"origin_current_database" FROM PUBLIC;
REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE :"legacy_replay_database" FROM PUBLIC;
REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE :"program_host_acceptance_database" FROM PUBLIC;
REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE :"composer_sealed_read_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"catalog_admin_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
GRANT CONNECT ON DATABASE :"origin_current_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
GRANT CONNECT ON DATABASE :"legacy_replay_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
GRANT CONNECT ON DATABASE :"program_host_acceptance_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;
GRANT CONNECT ON DATABASE :"composer_sealed_read_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_owner, market_data_reader, qualification_writer, backtest_owner, instrument_owner, execution_writer, portfolio_writer, governance_writer, risk_writer, scanner_writer, vibe_test_owner_topology_admin;

WITH clones(database_name) AS (
  VALUES (:'catalog_admin_database'), (:'origin_current_database'), (:'legacy_replay_database'), (:'program_host_acceptance_database'), (:'composer_sealed_read_database')
), roles(role_name) AS (
  VALUES
    ('operator_authorization_writer'),
    ('product_edge_owner'),
    ('rd_owner'),
    ('rd_fact_writer'),
    ('replay_policy_catalog_admin_writer'),
    ('market_data_owner'),
    ('market_data_reader'),
    ('qualification_writer'),
    ('backtest_owner'),
    ('instrument_owner'),
    ('execution_writer'),
    ('portfolio_writer'),
    ('governance_writer'),
    ('risk_writer'),
    ('scanner_writer'),
    ('vibe_test_owner_topology_admin')
)
SELECT (pg_catalog.count(*)=0)::int AS cloned_database_custody_ok,
       COALESCE(pg_catalog.string_agg(finding, E'\n' ORDER BY finding), '')
         AS cloned_database_custody_findings
  FROM (
    SELECT clones.database_name || ': ' || CASE
             WHEN database_entry.oid IS NULL THEN 'does not exist'
             WHEN pg_catalog.pg_get_userbyid(database_entry.datdba)<>'rd_database_owner'
               THEN 'is owned by ' || pg_catalog.pg_get_userbyid(database_entry.datdba)
             ELSE 'grants PUBLIC ' || (
               SELECT pg_catalog.string_agg(database_acl.privilege_type, ', ' ORDER BY database_acl.privilege_type)
                 FROM pg_catalog.aclexplode(COALESCE(
                   database_entry.datacl,
                   pg_catalog.acldefault('d',database_entry.datdba)
                 )) database_acl
                WHERE database_acl.grantee=0
                  AND database_acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY'))
           END AS finding
      FROM clones
      LEFT JOIN pg_catalog.pg_database database_entry
        ON database_entry.datname=clones.database_name
     WHERE database_entry.oid IS NULL
        OR pg_catalog.pg_get_userbyid(database_entry.datdba)<>'rd_database_owner'
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(
              database_entry.datacl,
              pg_catalog.acldefault('d',database_entry.datdba)
            )) database_acl
           WHERE database_acl.grantee=0
             AND database_acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY')
        )
    UNION ALL
    SELECT roles.role_name || ' cannot CONNECT to ' || clones.database_name
      FROM clones
      JOIN pg_catalog.pg_database database_entry
        ON database_entry.datname=clones.database_name
      CROSS JOIN roles
     WHERE NOT pg_catalog.has_database_privilege(roles.role_name,database_entry.oid,'CONNECT')
    UNION ALL
    -- CREATE and TEMPORARY are refused to every login role, not to the list above: a role added
    -- later is covered without being named. TEMPORARY is what lets a caller put a relation or a
    -- type in pg_temp, which a SECURITY DEFINER routine whose search_path does not end in pg_temp
    -- resolves first. A role counts with every role it can SET ROLE to, because
    -- has_database_privilege does not follow a membership granted WITH INHERIT FALSE.
    --
    -- One grant is exempt, and only as the role itself: the Instrument Owner's CREATE on the Owner
    -- database, which the R&D database bootstrap gives it so that it can create its own schema. A
    -- schema it creates is not on any SECURITY DEFINER search_path, because
    -- check-security-definer-search-path.sql refuses a path that names a schema which does not
    -- exist. No clone carries that grant, and a role that can SET ROLE to instrument_owner is
    -- still refused.
    SELECT login_role.rolname
           || CASE WHEN reachable.oid=login_role.oid THEN '' ELSE ' (as ' || reachable.rolname || ')' END
           || ' holds ' || privilege.name || ' on ' || database_entry.datname
      FROM pg_catalog.pg_database database_entry
      CROSS JOIN pg_catalog.pg_roles login_role
      JOIN pg_catalog.pg_roles reachable
        ON pg_catalog.pg_has_role(login_role.oid,reachable.oid,'SET')
      CROSS JOIN (VALUES ('CREATE'), ('TEMPORARY')) AS privilege(name)
     WHERE pg_catalog.pg_get_userbyid(database_entry.datdba)='rd_database_owner'
       AND login_role.rolcanlogin
       AND NOT login_role.rolsuper
       AND pg_catalog.has_database_privilege(reachable.oid,database_entry.oid,privilege.name)
       AND NOT (privilege.name='CREATE'
                AND login_role.rolname='instrument_owner'
                AND reachable.oid=login_role.oid
                AND database_entry.datname=:'test_database')
  ) findings
\gset
\if :cloned_database_custody_ok
\else
  -- \quit takes no exit status, so the refusal is an error that ON_ERROR_STOP turns into one.
  SELECT pg_catalog.set_config('vibe_test.cloned_database_custody_findings',
                               :'cloned_database_custody_findings', false) AS custody_findings_set
  \gset
  DO $custody$
  BEGIN
    RAISE EXCEPTION 'cloned R&D database custody mismatch:%',
      E'\n' || pg_catalog.current_setting('vibe_test.cloned_database_custody_findings');
  END
  $custody$;
\endif
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$catalog_admin_database" \
  --set=catalog_admin_database="$catalog_admin_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'catalog_admin_database';
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$origin_current_database" \
  --set=origin_current_database="$origin_current_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'origin_current_database';
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$legacy_replay_database" \
  --set=legacy_replay_database="$legacy_replay_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'legacy_replay_database';

CREATE TABLE public.rd_exploratory_replay_requests_v1 (
  replay_request_identity text PRIMARY KEY,
  run_attempt_identity text NOT NULL UNIQUE,
  semantic_digest text NOT NULL,
  request_json jsonb NOT NULL,
  receipt_json jsonb NOT NULL,
  handoff_json jsonb,
  committed_at_epoch_ms bigint NOT NULL,
  research_view_json jsonb,
  request_schema_version smallint NOT NULL,
  v2_canonical_request_bytes bytea,
  v2_meaning_digest text,
  v2_seal_digest text,
  v2_receipt_json jsonb
);
ALTER TABLE public.rd_exploratory_replay_requests_v1 OWNER TO rd_owner;
COMMENT ON TABLE public.rd_exploratory_replay_requests_v1 IS 'legacy Replay sentinel v1';
INSERT INTO public.rd_exploratory_replay_requests_v1 (
  replay_request_identity,
  run_attempt_identity,
  semantic_digest,
  request_json,
  receipt_json,
  handoff_json,
  committed_at_epoch_ms,
  research_view_json,
  request_schema_version,
  v2_canonical_request_bytes,
  v2_meaning_digest,
  v2_seal_digest,
  v2_receipt_json
)
SELECT
  'legacy-replay-' || ordinal::text,
  'legacy-attempt-' || ordinal::text,
  'sha256:legacy-' || ordinal::text,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-request'),
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-receipt'),
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-handoff'),
  ordinal,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-research-view'),
  2,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(ordinal),2,'0'),'hex'),
  'sha256:legacy-meaning-' || ordinal::text,
  'sha256:legacy-seal-' || ordinal::text,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-v2-receipt')
FROM pg_catalog.generate_series(0,25) ordinal;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$program_host_acceptance_database" \
  --set=program_host_acceptance_database="$program_host_acceptance_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'program_host_acceptance_database';
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$composer_sealed_read_database" \
  --set=composer_sealed_read_database="$composer_sealed_read_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'composer_sealed_read_database';
SQL

legacy_replay_fingerprint() {
  docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$legacy_replay_database" << 'SQL'
SELECT 'count=' || pg_catalog.count(*)::text
  FROM public.rd_exploratory_replay_requests_v1;

SELECT 'data_bytes_md5=' || pg_catalog.md5(COALESCE(
  pg_catalog.string_agg(
    pg_catalog.encode(
      pg_catalog.convert_to(pg_catalog.row_to_json(legacy)::text, 'UTF8'),
      'hex'
    ),
    E'\n' ORDER BY replay_request_identity
  ),
  ''
))
  FROM public.rd_exploratory_replay_requests_v1 legacy;

SELECT 'catalog_md5=' || pg_catalog.md5(
  relation.relkind::text || ':' ||
  relation.relpersistence::text || ':' ||
  relation.relreplident::text || ':' ||
  COALESCE(relation.reloptions::text, '<NULL>') || ':' ||
  COALESCE(pg_catalog.obj_description(relation.oid, 'pg_class'), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      attribute.attnum::text || ':' ||
      attribute.attname || ':' ||
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
      attribute.attnotnull::text || ':' ||
      attribute.attidentity::text || ':' ||
      attribute.attgenerated::text || ':' ||
      COALESCE(attribute.attacl::text, '<NULL>') || ':' ||
      COALESCE(pg_catalog.pg_get_expr(default_entry.adbin, default_entry.adrelid), '<NULL>'),
      E'\n' ORDER BY attribute.attnum
    )
      FROM pg_catalog.pg_attribute attribute
      LEFT JOIN pg_catalog.pg_attrdef default_entry
        ON default_entry.adrelid=attribute.attrelid
       AND default_entry.adnum=attribute.attnum
     WHERE attribute.attrelid=relation.oid
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
  ), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      constraint_entry.conname || ':' ||
      constraint_entry.contype::text || ':' ||
      pg_catalog.pg_get_constraintdef(constraint_entry.oid, true),
      E'\n' ORDER BY constraint_entry.conname
    )
      FROM pg_catalog.pg_constraint constraint_entry
     WHERE constraint_entry.conrelid=relation.oid
  ), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      pg_catalog.pg_get_indexdef(index_entry.indexrelid),
      E'\n' ORDER BY index_entry.indexrelid::pg_catalog.regclass::text
    )
      FROM pg_catalog.pg_index index_entry
     WHERE index_entry.indrelid=relation.oid
  ), '<NULL>')
)
  FROM pg_catalog.pg_class relation
 WHERE relation.oid='public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass;

SELECT 'owner_acl_md5=' || pg_catalog.md5(
  owner.rolname || ':' || COALESCE(relation.relacl::text, '<NULL>')
)
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
 WHERE relation.oid='public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass;
SQL
}

legacy_replay_fingerprint_before="$(legacy_replay_fingerprint)"
readonly legacy_replay_fingerprint_before

export RD_OWNER_FRESH_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_CLASSIFICATION_DATABASE_URL="$RD_OWNER_TEST_DATABASE_URL"
export RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_DRAIN_ALIAS_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_alias_host}:${postgres_alias_port}/${test_database}"
export QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export INSTRUMENT_OWNER_DATABASE_URL="$INSTRUMENT_OWNER_TEST_DATABASE_URL"
export EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export OPERATOR_AUTHORIZATION_TEST_DATABASE_ROLE="operator_authorization_writer"
export PRODUCT_EDGE_TEST_DATABASE_ROLE="product_edge_owner"
export RD_OWNER_TEST_DATABASE_ROLE="rd_owner"
export QUALIFICATION_TEST_DATABASE_ROLE="qualification_writer"
export BACKTEST_TEST_DATABASE_ROLE="backtest_owner"
export BACKTEST_IMPERSONATOR_TEST_DATABASE_URL="postgresql://backtest_owner:${impersonator_password}@${impersonator_host}:${impersonator_port}/${impersonator_database}"
export VIBE_POSTGRES_TEST_DATABASE_NAME="$test_database"
export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$test_marker"

candidate_experiment_seed_filter="package(vibe-strategy-factory) & binary(vibe_strategy_factory) & test(=${candidate_experiment_upgrade_seed_test})"
cargo nextest run \
  "${nextest_reuse_args[@]}" \
  --profile "$nextest_profile" \
  "${nextest_execution_args[@]}" \
  -E "$candidate_experiment_seed_filter"
verify_candidate_experiment_acl_convergence

run_authority_migration() {
  if ! run_authority_migration_for_database "$test_database"; then
    return 1
  fi
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
GRANT replay_policy_catalog_owner, composer_owner TO vibe_test_owner_topology_admin;
SQL
}

wait_for_authority_fixture_recovery() {
  local attempt=1
  until timeout 3 docker exec "$container" psql --quiet --username postgres \
    --dbname "$test_database" --command 'SELECT 1' > /dev/null 2>&1; do
    if [[ "$attempt" -ge 30 ]]; then
      echo "ERROR: isolated PostgreSQL did not recover after an expected authority-migration rejection." >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
}

expect_authority_migration_topology_rejection() {
  local rejection_output
  if rejection_output="$(run_authority_migration_for_database "$test_database" 2>&1)"; then
    printf '%s\n' "$rejection_output"
    echo "ERROR: authority migration accepted a poisoned topology." >&2
    return 1
  fi
  printf '%s\n' "$rejection_output"
  if [[ "$rejection_output" != *'ERROR:  Backtest Result topology mismatch'* ]]; then
    echo "ERROR: authority migration failed without the expected topology rejection." >&2
    return 1
  fi
}

verify_authority_lock_schema_sibling_fails_closed() {
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
CREATE FUNCTION backtest_authority_lock_api.poisoned_sibling_v1()
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS 'SELECT true';
COMMIT;
SQL

  if ! expect_authority_migration_topology_rejection; then
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
DROP FUNCTION IF EXISTS backtest_authority_lock_api.poisoned_sibling_v1();
COMMIT;
SQL
    return 1
  fi
  wait_for_authority_fixture_recovery

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
DROP FUNCTION IF EXISTS backtest_authority_lock_api.poisoned_sibling_v1();
COMMIT;
SQL
  run_authority_migration
}

verify_authority_lock_schema_sibling_fails_closed

verify_authority_lock_schema_object_fails_closed() {
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
CREATE TABLE backtest_authority_lock_api.poisoned_relation_v1(value text);
GRANT SELECT ON TABLE backtest_authority_lock_api.poisoned_relation_v1 TO PUBLIC;
COMMIT;
SQL

  if ! expect_authority_migration_topology_rejection; then
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
DROP TABLE IF EXISTS backtest_authority_lock_api.poisoned_relation_v1;
COMMIT;
SQL
    return 1
  fi
  wait_for_authority_fixture_recovery

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
DROP TABLE IF EXISTS backtest_authority_lock_api.poisoned_relation_v1;
COMMIT;
SQL
  run_authority_migration
}

verify_authority_lock_schema_object_fails_closed

verify_cross_database_authority_catalog_fence() {
  local holder_pid
  local mutator_pid
  local observed_holder=false
  local observed_mutator=false
  local holder_status=0
  local mutator_status=0
  local mutation_committed
  local attempt

  docker exec --interactive --env "PGPASSWORD=${test_password}" "$container" \
    psql --quiet --set ON_ERROR_STOP=1 --host 127.0.0.1 \
    --username rd_owner --dbname "$test_database" > /dev/null << 'SQL' &
SET application_name='vibe-backtest-authority-holder-v1';
BEGIN;
SELECT backtest_authority_lock_api.lock_authority_catalogs_v1();
SELECT pg_catalog.pg_sleep(2);
ROLLBACK;
SQL
  holder_pid="$!"
  for attempt in $(seq 1 100); do
    if [[ "$(docker exec "$container" psql --quiet --tuples-only --no-align \
      --username postgres --dbname "$test_database" --command \
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE application_name='vibe-backtest-authority-holder-v1' AND wait_event_type='Timeout' AND wait_event='PgSleep')")" == t ]]; then
      observed_holder=true
      break
    fi
    sleep 0.02
  done
  if [[ "$observed_holder" != true ]]; then
    wait "$holder_pid" || true
    echo "ERROR: cross-database authority holder did not acquire shared catalog locks." >&2
    return 1
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$origin_current_database" > /dev/null << 'SQL' &
SET application_name='vibe-backtest-authority-mutator-v1';
BEGIN;
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
ALTER ROLE backtest_owner BYPASSRLS;
COMMIT;
SQL
  mutator_pid="$!"
  for attempt in $(seq 1 100); do
    if [[ "$(docker exec "$container" psql --quiet --tuples-only --no-align \
      --username postgres --dbname "$origin_current_database" --command \
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE application_name='vibe-backtest-authority-mutator-v1' AND wait_event_type='Lock')")" == t ]]; then
      observed_mutator=true
      break
    fi
    sleep 0.02
  done
  wait "$holder_pid" || holder_status="$?"
  wait "$mutator_pid" || mutator_status="$?"

  mutation_committed="$(docker exec "$container" psql --quiet --tuples-only --no-align \
    --username postgres --dbname "$origin_current_database" --command \
    "SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname='backtest_owner'")"

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$origin_current_database" << 'SQL'
BEGIN;
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
ALTER ROLE backtest_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
SQL

  if [[ "$holder_status" -ne 0 || "$mutator_status" -ne 0 ]]; then
    echo "ERROR: cross-database authority fence process failed (holder=${holder_status}, mutator=${mutator_status})." >&2
    return 1
  fi
  if [[ "$observed_mutator" != true ]]; then
    echo "ERROR: cross-database managed role mutation bypassed shared catalog locks." >&2
    return 1
  fi
  if [[ "$mutation_committed" != t ]]; then
    echo "ERROR: cross-database managed role mutation did not commit after fence release." >&2
    return 1
  fi
}

verify_cross_database_authority_catalog_fence

inject_backtest_result_fault() {
  local fault="$1"
  case "$fault" in
    source)
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
CREATE OR REPLACE FUNCTION backtest_owner_api.resolve_exploratory_replay_result_v2(
  p_result_identity text,
  p_request_identity text,
  p_attempt_identity text
)
RETURNS jsonb LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS 'SELECT NULL::jsonb';
COMMIT;
SQL
      ;;
    owner_api_sibling)
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
CREATE FUNCTION backtest_owner_api.poisoned_sibling_v1()
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS 'SELECT true';
ALTER FUNCTION backtest_owner_api.poisoned_sibling_v1() OWNER TO backtest_custodian;
REVOKE ALL ON FUNCTION backtest_owner_api.poisoned_sibling_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backtest_owner_api.poisoned_sibling_v1() TO rd_owner;
COMMIT;
SQL
      ;;
    acl)
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
GRANT SELECT ON TABLE public.backtest_replay_results_v2 TO rd_owner;
COMMIT;
SQL
      ;;
    membership)
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
GRANT backtest_owner TO rd_owner WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
COMMIT;
SQL
      ;;
    attribute)
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
ALTER ROLE backtest_owner BYPASSRLS;
COMMIT;
SQL
      ;;
    concurrent_acl)
      ;;
  esac
}

restore_backtest_result_fault() {
  local fault="$1"
  if [[ "$fault" == owner_api_sibling ]]; then
    local owner_api_sibling_accepted=false
    if run_authority_migration; then
      owner_api_sibling_accepted=true
    fi
    wait_for_authority_fixture_recovery
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
DROP FUNCTION backtest_owner_api.poisoned_sibling_v1();
COMMIT;
SQL
    if [[ "$owner_api_sibling_accepted" == true ]]; then
      echo "ERROR: authority migration accepted a sibling Backtest Owner API routine." >&2
      return 1
    fi
  elif [[ "$fault" == membership ]]; then
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
REVOKE backtest_owner FROM rd_owner;
COMMIT;
SQL
  elif [[ "$fault" == attribute ]]; then
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$test_database" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0));
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
ALTER ROLE backtest_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
SQL
  fi
  run_authority_migration
}

# Production provisioning runs in three steps (product/rd-workbench/docker-compose.yml): the R&D
# schema materializer and the authority-custody migration, both run above, then
# `authority-schema-materialize`, which materializes the Operator Authorization and Product Edge
# schemas. Without the third, the template holds only Operator Authorization's four legacy
# relations while `connect_existing` counts every admitted relation, both grant kinds' included
# (`admitted_relations` and its check in crates/operator_authorization/src/postgres.rs at b55f8c03d),
# and refuses with TopologyNotAdmitted. Product Edge is short three of its thirteen relations (the
# admission event stream, admission events and expired-manifest recoveries). Entries passed anyway
# only because an earlier entry's `connect()` migrated them: an order dependency the chain hid, and
# one that a precondition built on a fresh database meets at once.
chain_provisioning="${nextest_extract_dir}/target/chain-provisioning/${chain_provisioning_binary}"
if [[ ! -x "$chain_provisioning" ]]; then
  echo "ERROR: the archive holds no ${chain_provisioning_binary} at ${chain_provisioning}." >&2
  exit 1
fi
OPERATOR_AUTHORIZATION_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}" \
  PRODUCT_EDGE_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}" \
  "$chain_provisioning" materialize-schema

# Taken after the pre-loop drills, once both servers have settled; the raw-log count at the end
# covers the whole life of each container, drills included.
chain_stats_reset_before="$(postgres_stats_reset "$container")"
impersonator_stats_reset_before="$(postgres_stats_reset "$impersonator_container")"
readonly chain_stats_reset_before impersonator_stats_reset_before

if [[ -n "$chain_shard" ]]; then
  snapshot_chain_databases
fi

# The Catalog administrator, two replay migration filters, and Program Host acceptance use separate
# fresh databases. In the shared database, run the complete Instrument Owner storage/ACL oracle only
# after its consumers because its final inheritance fault poisons that private store. Keep the
# destructive legacy PREPARED drain probe final because it removes receipt storage required by every
# positive Artifact Owner consumer.
for chain_step in "${chain_run_order[@]}"; do
  IFS='|' read -r chain_position chain_step_kind chain_step_component <<< "$chain_step"
  chain_run_index=$((chain_run_index + 1))
  test_selection="${rd_owner_postgres_tests[$((chain_position - 1))]}"
  IFS='|' read -r test_package test_binary test_name <<< "$test_selection"
  if [[ -n "$chain_current_component" && "$chain_step_component" != "$chain_current_component" ]]; then
    reset_chain_databases
  fi
  chain_current_component="$chain_step_component"
  chain_entry_label="${test_package} ${test_binary} ${test_name}"
  if [[ "$chain_step_kind" == replay ]]; then
    echo "=== replayed precondition ${chain_position}/${chain_entry_count} for component ${chain_step_component}: ${chain_entry_label}"
  else
    echo "=== ordered chain entry ${chain_position}/${chain_entry_count}: ${chain_entry_label}"
  fi
  # The previous entry's record must not be copied as this one's if this one never writes its own.
  rm -f -- "$chain_record_source"
  arm_chain_entry_watchdog "$chain_entry_wall_clock_seconds" \
    "$(printf '%s/%03d.timeout' "$chain_record_dir" "$chain_position")" \
    "ordered chain entry ${chain_position}/${chain_entry_count} (${chain_entry_label})"
  # Absolute: nextest runs each test from its package directory.
  VIBE_TEST_LOG_FILE="${PWD}/$(printf '%s/%03d.log' "$chain_record_dir" "$chain_position")"
  if [[ "$chain_step_kind" == replay ]]; then
    VIBE_TEST_LOG_FILE="${PWD}/$(printf '%s/%03d.replay.log' "$chain_record_dir" "$chain_position")"
  fi
  export VIBE_TEST_LOG_FILE
  test_filter="package(${test_package}) & binary(${test_binary}) & test(=${test_name})"
  backtest_result_fault=''
  case "$test_name" in
    tests::postgres_result_rd_read_rejects_function_source_drift) backtest_result_fault=source ;;
    tests::postgres_result_rd_read_rejects_owner_api_routine_sibling) backtest_result_fault=owner_api_sibling ;;
    tests::postgres_result_rd_read_rejects_raw_table_acl_drift) backtest_result_fault=acl ;;
    tests::postgres_result_rd_read_rejects_inherited_owner_membership) backtest_result_fault=membership ;;
    tests::postgres_result_rd_read_rejects_owner_attribute_drift) backtest_result_fault=attribute ;;
    tests::postgres_result_topology_fence_serializes_managed_acl_drift) backtest_result_fault=concurrent_acl ;;
  esac
  if [[ -n "$backtest_result_fault" ]]; then
    inject_backtest_result_fault "$backtest_result_fault"
  fi
  if [[ "$test_name" == 'replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed' ]] ||
    [[ "$test_name" == 'replay_policy_catalog_postgres_v2::postgres_tests::catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds' ]] ||
    [[ "$test_name" == 'postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation' ]]; then
    env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$catalog_admin_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      INSTRUMENT_OWNER_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${catalog_admin_database}" \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  elif [[ "$test_name" == 'legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]]; then
    env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$legacy_replay_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      INSTRUMENT_OWNER_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${legacy_replay_database}" \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  elif [[ "$test_name" == 'origin_current_replay_table_renames_with_exact_v1_v2_read_continuity' ]]; then
    env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$origin_current_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      INSTRUMENT_OWNER_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  elif [[ "$test_name" == 'tests::strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody' ]] ||
    [[ "$test_name" == 'iteration_decision_postgres::postgres_acceptance_tests::successor_artifact_enters_exploratory_replay_with_exact_owner_custody' ]] ||
    [[ "$test_name" == 'iteration_decision_postgres::postgres_acceptance_tests::iteration_analysis_postgres_acceptance_tests::analysis_request_completion_resolve_restart_and_tamper_are_atomic' ]] ||
    [[ "$test_name" == 'iteration_decision_postgres::postgres_acceptance_tests::backtest_run_report_postgres_acceptance_tests::backtest_run_report_reads_back_every_point_a_real_run_committed' ]] ||
    [[ "$test_name" == 'iteration_decision_postgres::postgres_acceptance_tests::positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic' ]] ||
    [[ "$test_binary" == 'trial_family_owner' ]] ||
    [[ "$test_name" == artifact_build_postgres::postgres_freshness_tests::* ]] ||
    [[ "$test_binary" == 'source_intake' ]] ||
    [[ "$test_binary" == 'vibe_qualification' ]] ||
    [[ "$test_name" == 'tests::postgres_protected_v3_results_and_attempt_frontiers_close_every_terminal_lineage' ]] ||
    [[ "$test_name" == 'product_edge_postgres::tests::second_request_under_one_principal_resolves_through_the_frontier_arm' ]] ||
    [[ "$test_name" == product_edge_postgres::tests::postgres_v3_* ]]; then # ci-pr 2026-09-24: v3_request overflows 2 MiB, passes 3 MiB; the scope sibling passes 2 MiB.
    RUST_MIN_STACK=16777216 \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  elif [[ "$test_name" == 'sealed_read_port_is_restart_exact_fail_closed_and_query_only' ]]; then
    env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$composer_sealed_read_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      INSTRUMENT_OWNER_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${composer_sealed_read_database}" \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  elif [[ "$test_name" == 'program_host_bar_joined_cut_postgres_acceptance_tests::owner_postgres_v4_moves_through_program_host_and_real_backtest' ]]; then
    env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$program_host_acceptance_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      MARKET_DATA_OWNER_TEST_DATABASE_URL="postgresql://market_data_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL="postgresql://replay_policy_catalog_admin_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      MARKET_DATA_RD_ROLE_SET_TEST_DATABASE_URL="postgresql://market_data_reader:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      INSTRUMENT_OWNER_TEST_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      INSTRUMENT_OWNER_DATABASE_URL="postgresql://instrument_owner:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      EXECUTION_OWNER_TEST_DATABASE_URL="postgresql://execution_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      PORTFOLIO_OWNER_TEST_DATABASE_URL="postgresql://portfolio_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      GOVERNANCE_OWNER_TEST_DATABASE_URL="postgresql://governance_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      RISK_OWNER_TEST_DATABASE_URL="postgresql://risk_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      SCANNER_OWNER_TEST_DATABASE_URL="postgresql://scanner_writer:${test_password}@${postgres_host}:${postgres_port}/${program_host_acceptance_database}" \
      cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  else
    cargo nextest run \
      "${nextest_reuse_args[@]}" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"
  fi
  if [[ "$chain_step_kind" != replay ]]; then
    keep_chain_record "$chain_position"
  fi
  if [[ "$chain_step_kind" != replay && "$test_name" == 'durable_owner_is_atomic_restart_exact_and_fail_closed' ]]; then
    require_collected_positive_control "$chain_record_dir" "$chain_position"
  fi
  if [[ -n "$backtest_result_fault" ]]; then
    restore_backtest_result_fault "$backtest_result_fault"
  fi
  if [[ "$chain_run_index" -eq "${#chain_run_order[@]}" ]]; then
    # One record per entry, counted against the array rather than checked for being non-empty: a
    # non-empty directory only rules out "nothing ran at all", not "ran thirty and the copy stopped
    # answering". A short count here means the record is incomplete while the chain says it passed,
    # which is the one combination that would let a reader trust a record that is missing entries.
    chain_record_count="$(find "$chain_record_dir" -name '*.xml' -type f | grep -c '' || true)"
    chain_expected_records="$chain_entry_count"
    if [[ -n "$chain_shard" ]]; then
      chain_expected_records="$chain_shard_entry_count"
    fi
    if [[ "$chain_record_count" -ne "$chain_expected_records" ]]; then
      echo "ERROR: the chain passed ${chain_expected_records} entries but left ${chain_record_count}" >&2
      echo "record(s) in ${chain_record_dir}. Every entry must leave one, or the published record" >&2
      echo "is missing entries while reporting success." >&2
      exit 1
    fi
    chain_completed=true
    if [[ -n "$chain_shard" ]]; then
      # The chain's two summary lines come from the merged records of every shard
      # (--report-records), so one shard reports only itself.
      echo "=== chain shard ${chain_shard}: all ${chain_shard_entry_count} entries passed, ${chain_record_count} recorded"
    else
      echo "=== ordered chain: all ${chain_entry_count} entries passed, ${chain_record_count} recorded"
      report_collected_warnings "$chain_record_dir" "$chain_entry_count"
    fi
  fi
  disarm_chain_entry_watchdog
done

legacy_replay_fingerprint_after="$(legacy_replay_fingerprint)"
readonly legacy_replay_fingerprint_after
if [[ "$legacy_replay_fingerprint_after" != "$legacy_replay_fingerprint_before" ]]; then
  echo "ERROR: legacy exploratory Replay table data or catalog changed." >&2
  exit 1
fi

if [[ -n "$chain_shard" ]]; then
  drop_chain_database_snapshots
fi

require_no_postgres_crash chain "$container" "$chain_stats_reset_before"
require_no_postgres_crash impersonating "$impersonator_container" "$impersonator_stats_reset_before"

# Every SECURITY DEFINER routine, in every database the chain materialized, must search pg_temp last
# and name no schema another role can create in; scripts/ci/check-security-definer-search-path.sql
# holds the rule, and no routine is exempt from it.
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-security-definer-guard.bash" "$container" \
  postgres "$test_database" "$catalog_admin_database" "$origin_current_database" \
  "$legacy_replay_database" "$program_host_acceptance_database" "$composer_sealed_read_database"

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DO $acl$
DECLARE
  unexpected_source_table text;
  forbidden_role_source text;
  forbidden_privilege text;
  privilege_name text;
  role_name text;
  qualification_table text;
BEGIN
  IF EXISTS (
       SELECT 1
       FROM pg_catalog.pg_database database_entry
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
         database_entry.datacl,
         pg_catalog.acldefault('d', database_entry.datdba)
       )) database_acl
       WHERE database_entry.datname = pg_catalog.current_database()
         AND database_acl.grantee = 0
         AND database_acl.privilege_type = 'CONNECT'
     )
     OR NOT pg_catalog.has_database_privilege('rd_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('rd_fact_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('market_data_reader', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('operator_authorization_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('qualification_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('product_edge_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('backtest_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('qualification_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('operator_authorization_owner', pg_catalog.current_database(), 'CONNECT')
     OR (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'qualification_owner')
     OR pg_catalog.pg_has_role('qualification_writer', 'qualification_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('rd_owner', 'qualification_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('qualification_writer', 'public', 'CREATE')
     OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = 'qualification_writer')
     OR pg_catalog.pg_has_role('qualification_writer', 'rd_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('qualification_writer', 'product_edge_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('qualification_writer', 'operator_authorization_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('qualification_writer', 'rd_owner_api', 'CREATE')
     OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = 'backtest_owner')
     OR pg_catalog.pg_has_role('backtest_owner', 'rd_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'product_edge_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'qualification_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'operator_authorization_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('backtest_owner', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('backtest_owner', 'rd_owner_api', 'CREATE')
  THEN
    RAISE EXCEPTION 'Qualification owner/writer physical roles or database CONNECT custody are not separated';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'rd_owner',
    'qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rd_owner lacks the sealed Qualification admission API';
  END IF;

  IF NOT pg_catalog.has_schema_privilege('product_edge_owner', 'qualification_api', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('qualification_owner', 'qualification_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'product_edge_owner',
       'qualification_api.read_public_status_v1(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'qualification_writer',
       'qualification_api.read_public_status_v1(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'product_edge_owner',
       'qualification_api.public_status_native_source_is_custodied_v1(text,text,bigint,text,text,text,bigint)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'qualification_writer',
       'qualification_api.public_status_native_source_is_custodied_v1(text,text,bigint,text,text,text,bigint)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_json_text_v1(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_json_digest_v1(text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('product_edge_owner', 'qualification_api.canonical_bytes_storage_digest_v1(text,bytea)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('qualification_writer', 'qualification_api.canonical_json_text_v1(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('qualification_writer', 'qualification_api.canonical_json_digest_v1(text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('qualification_writer', 'qualification_api.canonical_bytes_storage_digest_v1(text,bytea)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(ARRAY[
         'qualification_api.canonical_ordered_json_digest_v1(text,text)',
         'qualification_api.protected_replay_request_semantic_digest_is_valid_v1(jsonb,bytea,text,text)',
         'qualification_api.protected_replay_request_set_is_custodied_v1(text)',
         'qualification_api.public_status_expected_opaque_reference_v1(text,text,text,text)',
         'qualification_api.public_status_expected_fact_digest_v1(text,text,text,text,text,text,boolean)'
       ]) helper
       WHERE pg_catalog.has_function_privilege('product_edge_owner', helper, 'EXECUTE')
          OR pg_catalog.has_function_privilege('qualification_writer', helper, 'EXECUTE')
     )
  THEN
    RAISE EXCEPTION 'Qualification public status API boundary is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'qualification_api.read_public_status_v1(text)'
    )
      AND role.rolname = 'qualification_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 's'
      AND procedure.proparallel = 's'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Qualification public status API metadata mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'qualification_api.public_status_native_source_is_custodied_v1(text,text,bigint,text,text,text,bigint)'
    )
      AND role.rolname = 'qualification_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 's'
      AND procedure.proparallel = 's'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Qualification public status native-custody validator metadata mismatch';
  END IF;

  IF qualification_api.canonical_json_text_v1(
       '{"z":[2,{"b":true,"a":"x"}],"a":null}'::jsonb
     ) <> '{"a":null,"z":[2,{"a":"x","b":true}]}'
     OR qualification_api.canonical_json_digest_v1(
       'test.domain',
       '{"z":[2,{"b":true,"a":"x"}],"a":null}'::jsonb
     ) <> 'sha256:9d00d10c5eafa9ac29b9367ed0c7cd299d0077017025789d17bfca0b280da223'
     OR qualification_api.canonical_bytes_storage_digest_v1(
       'test.bytes',
       pg_catalog.convert_to('{"a":1}','UTF8')
     ) <> 'sha256:fc36c838cbb3673d095a291739429a7fdb5850c2f42a16bd48ac90a8e5b343fc'
     OR qualification_api.canonical_ordered_json_digest_v1(
       'test.ordered',
       '{"z":2,"a":1}'
     ) <> 'sha256:262facb6b6e6f92395f67fcf62d1d95b5b8698f9cead9f7eb9adad94108a263c'
     OR qualification_api.public_status_expected_opaque_reference_v1(
       'review-r5','candidate-r5','native-r5',
       'sha256:1111111111111111111111111111111111111111111111111111111111111111'
     ) <> 'qualification-public-reference-v1-d7324219d241aae0353a49d08abe33e0b9608ff587933b8fe5e530a48fa776f7'
     OR qualification_api.public_status_expected_fact_digest_v1(
       'review-r5','candidate-r5','CLOSED_NOT_QUALIFIED',
       'qualification-public-reference-v1-d7324219d241aae0353a49d08abe33e0b9608ff587933b8fe5e530a48fa776f7',
       'frontier-r5',
       'sha256:2222222222222222222222222222222222222222222222222222222222222222',
       true
     ) <> 'sha256:a2894972d1f29cfd9ad53674183017788f3d541fba0f33075a4d462d7f2bb111'
  THEN
    RAISE EXCEPTION 'Qualification canonical digest SQL/Rust interoperability changed';
  END IF;

  IF NOT pg_catalog.has_schema_privilege('qualification_writer', 'rd_owner_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'qualification_writer',
       'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'qualification_writer',
       'rd_owner_api.lock_ready_for_selection_for_qualification_v1(text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'qualification_writer lacks an admitted sealed R&D API';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'rd_owner_api'
      AND procedure.oid NOT IN (
        pg_catalog.to_regprocedure(
          'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'
        ),
        pg_catalog.to_regprocedure(
          'rd_owner_api.lock_ready_for_selection_for_qualification_v1(text,text)'
        )
      )
      AND pg_catalog.has_function_privilege('qualification_writer', procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'qualification_writer can execute an unadmitted R&D Owner API';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['qualification_owner', 'qualification_writer'] LOOP
    SELECT relation.relname INTO unexpected_source_table
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname LIKE 'rd_%'
      AND relation.relkind IN ('r', 'p')
      AND (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(
        role_name,
        relation.oid,
        checked_privilege
      )) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) checked_privilege)
    LIMIT 1;
    IF unexpected_source_table IS NOT NULL THEN
      RAISE EXCEPTION '% has forbidden raw R&D source privilege on %', role_name, unexpected_source_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  )
  THEN
    RAISE EXCEPTION 'sealed R&D basis API metadata mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  )
     OR NOT pg_catalog.has_schema_privilege('backtest_owner', 'rd_owner_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed exploratory replay Backtest API metadata or ACL mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  )
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed exploratory Replay V2 Backtest API metadata or ACL mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'qualification_api.lock_protected_replay_request_v1(text,text,text,text)'
    )
      AND role.rolname = 'qualification_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  )
     OR NOT pg_catalog.has_schema_privilege('backtest_owner', 'qualification_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'qualification_api.lock_protected_replay_request_v1(text,text,text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed protected replay Backtest API metadata or ACL mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'qualification_api.lock_protected_replay_request_set_v1(text,text)'
    )
      AND role.rolname = 'qualification_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
  )
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'qualification_api.lock_protected_replay_request_set_v1(text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed protected replay request-set API metadata or ACL mismatch';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'public',
    'rd_owner',
    'qualification_writer',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      role_name,
      'qualification_api.lock_protected_replay_request_v1(text,text,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed protected replay API', role_name;
    END IF;
    IF pg_catalog.has_function_privilege(
      role_name,
      'qualification_api.lock_protected_replay_request_set_v1(text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed protected replay request-set API', role_name;
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY[
    'public',
    'rd_owner',
    'qualification_owner',
    'qualification_writer',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed exploratory replay API', role_name;
    END IF;
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed exploratory Replay V2 API', role_name;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege(
       'backtest_owner',
       'public.rd_sealed_exploratory_replay_requests_v1',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'backtest_owner',
       'public.rd_owner_outbox_v1',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
  THEN
    RAISE EXCEPTION 'backtest_owner has forbidden raw R&D table privilege';
  END IF;

  IF pg_catalog.to_regprocedure(
    'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete R&D basis API signature remains published';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_entry
    JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_entry.indexrelid
    WHERE index_relation.relname = 'rd_owner_outbox_aggregate_kind_v1'
      AND index_entry.indrelid = 'public.rd_owner_outbox_v1'::pg_catalog.regclass
      AND index_entry.indisunique
      AND index_entry.indisvalid
  ) THEN
    RAISE EXCEPTION 'R&D owner outbox aggregate/event uniqueness is unavailable';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'public',
    'qualification_owner',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer',
    'backtest_owner'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed R&D basis API', role_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_entry
       WHERE constraint_entry.conrelid = 'public.qualification_public_status_facts_v1'::regclass
         AND constraint_entry.conname = 'qualification_public_status_facts_v1_status_check'
         AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_entry.oid), 'QUALIFIED') > 0
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_entry
       WHERE constraint_entry.conrelid = 'public.qualification_protected_robustness_assessments_v1'::regclass
         AND constraint_entry.conname = 'qualification_protected_robustness_assessments_v1_status_check'
         AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_entry.oid), 'COMPLETE_PASS') > 0
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint constraint_entry
       WHERE constraint_entry.conrelid = 'public.qualification_eligibility_facts_v1'::regclass
         AND constraint_entry.conname = 'qualification_eligibility_facts_v1_status_check'
         AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_entry.oid), 'QUALIFIED') > 0
     )
  THEN
    RAISE EXCEPTION 'Qualification qualified terminal constraints are unavailable';
  END IF;

  FOREACH qualification_table IN ARRAY ARRAY[
    'qualification_protected_feedback_projections_v1',
    'qualification_protected_feedback_heads_v1',
    'qualification_candidate_intake_receipts_v1',
    'qualification_holdout_reservations_v1',
    'qualification_protected_replay_requests_v1',
    'qualification_protected_replay_request_receipts_v1',
    'qualification_owner_outbox_v1'
  ] LOOP
    IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = qualification_table) <> 'qualification_owner' THEN
      RAISE EXCEPTION 'Qualification table custody mismatch for %', qualification_table;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT pg_catalog.has_table_privilege(
        'qualification_writer',
        pg_catalog.format('public.%I', qualification_table),
        privilege_name
      ) THEN
        RAISE EXCEPTION 'qualification_writer lacks % on %', privilege_name, qualification_table;
      END IF;
    END LOOP;
    FOREACH forbidden_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(
        'qualification_writer',
        pg_catalog.format('public.%I', qualification_table),
        forbidden_privilege
      ) THEN
        RAISE EXCEPTION 'qualification_writer has forbidden % on %', forbidden_privilege, qualification_table;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH qualification_table IN ARRAY ARRAY[
    'qualification_public_status_facts_v1',
    'qualification_protected_replay_request_sets_v1',
    'qualification_protected_economic_policy_bundles_v1',
    'qualification_protected_attempt_dispositions_v1',
    'qualification_protected_robustness_assessments_v1',
    'qualification_eligibility_facts_v1',
    'qualification_eligibility_fact_receipts_v1',
    'qualification_protected_attempt_dispositions_v2',
    'qualification_holdout_closures_v1',
    'qualification_holdout_closures_v2',
    'qualification_protected_attempt_disposition_receipts_v1',
    'qualification_protected_attempt_disposition_receipts_v2'
  ] LOOP
    IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = qualification_table) <> 'qualification_owner' THEN
      RAISE EXCEPTION 'Qualification append-only table custody mismatch for %', qualification_table;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      IF NOT pg_catalog.has_table_privilege('qualification_writer', pg_catalog.format('public.%I', qualification_table), privilege_name) THEN
        RAISE EXCEPTION 'qualification_writer lacks % on %', privilege_name, qualification_table;
      END IF;
    END LOOP;
    FOREACH forbidden_privilege IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege('qualification_writer', pg_catalog.format('public.%I', qualification_table), forbidden_privilege) THEN
        RAISE EXCEPTION 'qualification_writer has forbidden append-only % on %', forbidden_privilege, qualification_table;
      END IF;
    END LOOP;
  END LOOP;

  IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'qualification_public_status_heads_v1') <> 'qualification_owner'
     OR NOT pg_catalog.has_table_privilege('qualification_writer', 'public.qualification_public_status_heads_v1', 'SELECT,INSERT,UPDATE')
     OR pg_catalog.has_table_privilege('qualification_writer', 'public.qualification_public_status_heads_v1', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
  THEN
    RAISE EXCEPTION 'Qualification public status head custody mismatch';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'rd_owner',
    'backtest_owner',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    FOREACH qualification_table IN ARRAY ARRAY[
      'qualification_protected_feedback_projections_v1',
      'qualification_protected_feedback_heads_v1',
      'qualification_candidate_intake_receipts_v1',
      'qualification_public_status_facts_v1',
      'qualification_public_status_heads_v1',
      'qualification_holdout_reservations_v1',
      'qualification_protected_replay_requests_v1',
      'qualification_protected_replay_request_receipts_v1',
      'qualification_protected_replay_request_sets_v1',
      'qualification_protected_economic_policy_bundles_v1',
      'qualification_protected_attempt_dispositions_v1',
      'qualification_protected_robustness_assessments_v1',
      'qualification_eligibility_facts_v1',
      'qualification_eligibility_fact_receipts_v1',
      'qualification_protected_attempt_dispositions_v2',
      'qualification_holdout_closures_v1',
      'qualification_holdout_closures_v2',
      'qualification_protected_attempt_disposition_receipts_v1',
      'qualification_protected_attempt_disposition_receipts_v2',
      'qualification_owner_outbox_v1'
    ] LOOP
      FOREACH forbidden_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(
          role_name,
          pg_catalog.format('public.%I', qualification_table),
          forbidden_privilege
        ) THEN
          RAISE EXCEPTION '% has forbidden Qualification privilege % on %', role_name, forbidden_privilege, qualification_table;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY[
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_table_privilege(role_name, 'public.rd_independence_bases_v1', 'SELECT')
       OR pg_catalog.has_table_privilege(role_name, 'public.rd_owner_outbox_v1', 'SELECT')
       OR pg_catalog.has_function_privilege(role_name, 'qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)', 'EXECUTE')
    THEN
      RAISE EXCEPTION '% crossed the R&D/Qualification custody boundary', role_name;
    END IF;
    forbidden_role_source := NULL;
    SELECT table_name INTO forbidden_role_source
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'rd_%'
      AND (
        pg_catalog.has_table_privilege(
          role_name, pg_catalog.format('public.%I', table_name), 'SELECT'
        )
        OR (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(
          role_name,
          pg_catalog.format('public.%I', table_name),
          checked_privilege
        )) FROM pg_catalog.unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) checked_privilege)
      )
    LIMIT 1;
    IF forbidden_role_source IS NOT NULL THEN
      RAISE EXCEPTION '% can access forbidden R&D source %', role_name, forbidden_role_source;
    END IF;
  END LOOP;

  IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_independence_bases_v1') <> 'rd_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_owner_outbox_v1') <> 'rd_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_sealed_exploratory_replay_requests_v1') <> 'rd_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_trial_family_candidate_experiments_v1') <> 'rd_owner'
  THEN
    RAISE EXCEPTION 'R&D canonical source ownership mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND (SELECT count(*)=8
              AND count(*) FILTER (WHERE acl.grantee=relation.relowner)=7
              AND count(*) FILTER (
                WHERE pg_catalog.pg_get_userbyid(acl.grantee)='rd_exploratory_replay_api_owner'
                  AND acl.grantor=relation.relowner
                  AND acl.privilege_type='SELECT'
                  AND NOT acl.is_grantable
              )=1
              AND bool_and(
                acl.grantee=relation.relowner
                OR (pg_catalog.pg_get_userbyid(acl.grantee)='rd_exploratory_replay_api_owner'
                    AND acl.privilege_type='SELECT')
              )
            FROM pg_catalog.aclexplode(COALESCE(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )) acl)
  ) THEN
    RAISE EXCEPTION 'sealed exploratory Replay table runtime ACL mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
       AND acl.grantee<>relation.relowner
  ) THEN
    RAISE EXCEPTION 'sealed exploratory Replay column ACL is not Owner-private';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation
     WHERE relation.oid='public.rd_trial_family_candidate_experiments_v1'::pg_catalog.regclass
       AND (SELECT count(*)=7
              AND count(*) FILTER (WHERE acl.grantee=relation.relowner)=7
              AND count(DISTINCT acl.privilege_type)=7
              AND bool_and(acl.grantee=relation.relowner
                AND acl.grantor=relation.relowner
                AND acl.privilege_type IN ('INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
                AND NOT acl.is_grantable)
            FROM pg_catalog.aclexplode(COALESCE(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )) acl)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
     WHERE relation.oid='public.rd_trial_family_candidate_experiments_v1'::pg_catalog.regclass
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
       AND attribute.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'TrialFamily Candidate experiment table is not R&D Owner-only';
  END IF;

  IF pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NOT NULL
     OR (
       SELECT pg_catalog.count(*)
         FROM public.rd_sealed_exploratory_replay_requests_v1
        WHERE request_identity='internal-continuity-replay-v1'
          AND request_digest='sha256:internal-continuity-request-v1'
          AND committed_at_epoch_ms=1700000000000
          AND request_schema_version=1
     ) <> 1
  THEN
    RAISE EXCEPTION 'prior internal exploratory Replay custody was orphaned';
  END IF;

END
$acl$;
SQL
