# Census: proofs whose inputs come from a test-only constructor

A constructor that exists only under `cfg(test)` can make a proof answer a question nobody asked.
`run_multi_frame_equity_corpus` drives a two-frame target-set backtest and reads as evidence that
multiple frames work; its second frame comes from `issue_backtest_universe_successor_for_test`,
which builds one by copying the first frame and changing its logical instant and its members'
open and close. The arithmetic across two frames is proved. Whether an Owner can supply a second
frame is not, and that is the part that is missing.

This counts how far that shape reaches. Measured at `d6e4ea597` on a clean tree.

## What was counted

A function defined in a production module  -  a file under a crate's `src/` that does not end in
`_tests.rs`  -  whose name carries `for_test` or `test_only`. Only `.rs` files are read, so this
document cannot enter its own sample.

```text
95 definitions, 92 distinct names, across 42 files

strategy_factory   23 files      analysis         2
data                7            common           2
adapters            6            observability    1
                                 qualification    1
```

## Which proofs reach them

Callers were followed two levels: a constructor, the helper that calls it, and the `#[test]`,
`#[rstest]` or `#[tokio::test]` above that helper. Two levels because that is the shape of the
case above, and because the call graph here is built from names and gets less trustworthy with
every level.

```text
82 of the 92 reach at least one named proof
10 reach none
median reach: 1 proof
```

Three constructors reach far more than the rest, and they are excluded from the table below:
`for_test` reaches 5180, `seal_for_test` 157, `verified_strategy_input_bindings_for_test` 114.
A name that common is being resolved to unrelated definitions, so those counts measure the
method, not the repository.

## The proofs that claim more than construction

This is the part worth reading. A proof is listed when its name carries `owner`, `production`,
`real`, `end_to_end`, `canonical` or `live`  -  a claim about where the input came from  -  while its
input comes from a constructor that made one.

**Three of them are ordered chain entries**, which is this repository's acceptance criterion:

| chain entry                                                                   | takes its input from                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed`  | `replay_success_terminal_in_transaction_for_test`, `replay_failure_terminal_in_transaction_for_test` |
| `catalog_v3_bootstrap_publishes_the_head_the_owner_reads_and_formation_binds` | `cleanup_catalog_for_disposable_test_only`                                                           |

The rest, by constructor:

| constructor                                                                                         | defined at                                      | proofs whose names claim more                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin_implementation_receipts_for_test`                                                           | `strategy_plan_v2.rs:3949`                      | `actual_owner_selection_compiles_the_canonical_universe_plan`, `durable_plan_requires_current_exact_owner_universe_evidence`, `owner_valid_alternate_join_claim_fails_before_native_preparation`, `reaction_local_roles_require_one_common_owner_frame_anchor`, and two more |
| `compile_with_binding_and_implementation_receipts_for_test`                                         | `strategy_plan_v2.rs:3847`                      | `canonical_plan_change_rebinds_artifact_and_profile`, `immutable_accessors_are_canonical_and_lowering_bound`, `canonical_input_join_lowers_multi_timeframe_roles_byte_stably`                                                                                                |
| `compile_with_binding_projections_for_test`                                                         | `strategy_plan_v2.rs:3834`                      | `forward_cycle_state_ownership_and_cross_reaction_refs_fail_closed`, and two more                                                                                                                                                                                            |
| `issue_backtest_universe_successor_for_test`                                                        | `program_host_v2.rs:1457`                       | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`, `later_frame_weight_uses_account_scoped_equity_including_unrealized_pnl`                                                                                                                                  |
| `add_admitted_frame_for_test`                                                                       | `program_host_backtest_target_set_v2.rs:302`    | the same two                                                                                                                                                                                                                                                                 |
| `program_host_sim_event_round_trip_for_test`                                                        | `program_host_sim_event_consumer_v1.rs:852`     | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`, `real_sim_event_run_which_only_entered_claims_no_round_trip`                                                                                                                                              |
| `target_sysroot_digest_for_test`                                                                    | `develop_plugin_build_v2_sandbox.rs:653`        | `canonical_linux_sysroot_matches_the_frozen_generator_digest`, `canonical_sysroot_reread_fails_closed_after_mutation`                                                                                                                                                        |
| `state_pair_for_test`                                                                               | `program_host_v2.rs:2144`                       | `real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact`                                                                                                                                                                                                |
| `new_with_native_instruments_for_test`                                                              | `replay_target_set_execution_bundle_v1.rs:603`  | `owner_bound_profile_drives_bar_signal_then_real_event_fills`                                                                                                                                                                                                                |
| `compile_from_verified_owner_source_for_test`                                                       | `complex_strategy_compiler.rs:281`              | `verified_owner_source_token_compiles_every_symbolic_input_without_public_receipt_minting`                                                                                                                                                                                   |
| `fail_before_second_submit_for_test`                                                                | `program_host_backtest_target_set_v2.rs:322`    | `second_submit_boundary_fault_preserves_first_real_submission_and_committed_host`                                                                                                                                                                                            |
| `mutate_record_for_test`, `positive_row_count_for_test`, `rewrite_outbox_request_identity_for_test` | `develop_composer_operation_v2.rs`              | `every_private_canonical_member_mutation_fails_resolve_without_successor`                                                                                                                                                                                                    |
| `member_checkpoints_for_test`                                                                       | `program_host_v2.rs:2160`                       | `two_member_frame_invokes_once_is_causal_canonical_and_restart_equal`                                                                                                                                                                                                        |
| `issue_plugin_implementation_receipt_v2_for_test`                                                   | `strategy_plan_v2.rs:3974`                      | `canonical_plan_change_rebinds_artifact_and_profile`, and one more                                                                                                                                                                                                           |
| `issue_for_test`                                                                                    | `complex_strategy_compiler.rs:75`               | `canonical_pair_spread_state_builds_exact_compile_input`                                                                                                                                                                                                                     |
| `first_for_test`                                                                                    | `correction_policy_projection/authority.rs:206` | `first_projection_is_canonical_and_deterministic`                                                                                                                                                                                                                            |
| `verify_target_sysroot_for_test`                                                                    | `develop_plugin_build_v2_sandbox.rs:658`        | `canonical_sysroot_reread_fails_closed_after_mutation`                                                                                                                                                                                                                       |

```text
23 constructors, 23 distinct proofs
```

## What this is not

**It is not a list of defects.** A constructor is the right tool where the proof is about the
arithmetic and the input's provenance is somebody else's proof. What the table says is narrower:
for each of these, the name promises something about provenance, and the provenance is
construction. Whether that is a gap depends on whether some other proof covers the supply, and
this census did not look for those.

**The reach numbers are not exact.** The call graph is built by matching names, so a common name
resolves to unrelated definitions. That is why the three hubs are excluded and why the depth is
two. Every row in the table above was read by hand at its call site; the aggregate was not.

**A worked check, so the method can be judged:** `issue_backtest_universe_successor_for_test` is
called at line 477 of `program_host_v2_target_set_backtest_tests.rs`, inside
`later_frame_weight_uses_account_scoped_equity_including_unrealized_pnl` which begins at line 476;
`real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat` at line 675 reaches the same
constructor through `run_round_trip_corpus`. Both edges are real.
