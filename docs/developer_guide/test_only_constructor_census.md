# Census: proofs whose inputs come from a test-only constructor

A constructor that exists only under `cfg(test)` can make a proof answer a question nobody asked.
`run_multi_frame_equity_corpus` drives a two-frame target-set backtest and reads as evidence that
multiple frames work; its second frame comes from `issue_backtest_universe_successor_for_test`,
which builds one by copying the first frame and changing its logical instant and its members'
open and close. The arithmetic across two frames is proved. Whether an Owner can supply a second
frame is not, and that is the part that is missing.

This counts how far that shape reaches. Measured at `d6e4ea597` on a clean tree.

## What was counted

**Step one: the sample.** A function defined in a production module  -  a file under a crate's
`src/` that does not end in `_tests.rs`  -  whose name carries `for_test` or `test_only`. Only
`.rs` files are read, so this document cannot enter its own sample.

```text
95 definitions, 92 distinct names, across 42 files

strategy_factory   23 files      analysis         2
data                7            common           2
adapters            6            observability    1
                                 qualification    1
```

**Step two: is it a constructor?** A `for_test` name says when the function may be called, not
what it does. The question this census asks  -  *did the input come from somewhere real, or was it
built*  -  is only meaningful for a function that produces an input. Every definition is sorted by
what its body does, and only the constructors go on:

| class     | how it is recognised                                              | count | one instance                                                                                                  |
| --------- | ----------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| construct | returns a value that is not `()`, not `Result<(), _>`, not scalar | 55    | `create_data_client_for_test` (`adapters/lighter/src/data/mod.rs:3006`)                                       |
| verify    | asserts, returns nothing                                          | 18    | `test_credential_env_vars_for_testnet` (`adapters/derive/src/common/credential.rs:197`)                       |
| mutate    | takes `&mut`, or issues `UPDATE`, returns nothing                 | 16    | `reseal_storage_row_for_test` (`data/src/owner/replay_market_facts_v2/postgres.rs:1967`)                      |
| observe   | returns a scalar read off existing state                          | 3     | `subscription_count_for_test` (`adapters/polymarket/src/websocket/pool.rs:567`)                               |
| inject    | forces a fault into a later call, returns nothing                 | 2     | `drop_next_send_tx_result_for_test` (`adapters/lighter/src/websocket/client.rs:862`)                          |
| destruct  | issues `DELETE` / `DROP` / `TRUNCATE` and no `INSERT`             | 1     | `cleanup_catalog_for_disposable_test_only` (`strategy_factory/src/replay_policy_catalog_postgres_v2.rs:3801`) |

Only the 55 constructors reach the rest of this document. A destructor produces no input, so asking
where its input came from has no answer; the same holds for the other three non-producing classes.

**This step is a correction.** The first version of this census skipped it and treated every
`for_test` name as a constructor. Re-judging the 23 rows it published, 5 were not constructors:
`cleanup_catalog_for_disposable_test_only` (destruct), `fail_before_second_submit_for_test`
(inject), `mutate_record_for_test` (mutate), `positive_row_count_for_test` (observe),
`verify_target_sysroot_for_test` (verify)  -  **5 of 23 = 22% false positives at `d6e4ea597`**.
The table below was recounted from the 95 definitions rather than derived by subtraction, which
matters: subtraction would have kept the arithmetic 23 − 5 = 18 and missed that the corrected
criterion also *adds* one row the first version did not list (`record_for_test`). 23 − 5 + 1 = 19.

Two other defects in the original criterion were found while recounting, both of which inflated it:

- The claim-word filter matched substrings, so `unrealized` matched `real`, `ownership` matched
  `owner`, and `realtime` matched `real`. Two of the three affected names were in the published
  table. The filter now requires `_`-delimited words.
- The scan that decides whether an enclosing function is a `#[test]` looked at a fixed six-line
  window above the signature, so a multi-line `#[cfg(any(...))]` between the attribute and the
  signature hid it and demoted a test to a helper. It now scans to the previous item boundary.
  Positive control: `develop_composer_v2_tests.rs:200` now resolves to
  `real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact` with `isTest=true`.

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
`real`, `end_to_end`, `canonical` or `live` as an `_`-delimited word  -  a claim about where the
input came from  -  while its input comes from a constructor that made one.

**Two of them are ordered chain entries**, which is this repository's acceptance criterion:

| chain entry                                                                  | takes its input from                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed` | `replay_success_terminal_in_transaction_for_test`, `replay_failure_terminal_in_transaction_for_test` |
| `owner_postgres_v4_moves_through_program_host_and_real_backtest`             | `issue_plugin_implementation_receipt_v2_for_test`                                                    |

All 19, by constructor:

| constructor                                                 | defined at                                      | proofs whose names claim more                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin_implementation_receipts_for_test`                   | `strategy_plan_v2.rs:3949`                      | `actual_owner_selection_compiles_the_canonical_universe_plan`, `canonical_input_join_lowers_multi_timeframe_roles_byte_stably`, `durable_plan_requires_current_exact_owner_universe_evidence`, `immutable_accessors_are_canonical_and_lowering_bound`, `owner_valid_alternate_join_claim_fails_before_native_preparation`, `reaction_local_roles_require_one_common_owner_frame_anchor` |
| `compile_with_binding_and_implementation_receipts_for_test` | `strategy_plan_v2.rs:3847`                      | `canonical_input_join_lowers_multi_timeframe_roles_byte_stably`, `immutable_accessors_are_canonical_and_lowering_bound`                                                                                                                                                                                                                                                                 |
| `compile_with_binding_projections_for_test`                 | `strategy_plan_v2.rs:3834`                      | `canonical_input_join_lowers_multi_timeframe_roles_byte_stably`, `immutable_accessors_are_canonical_and_lowering_bound`                                                                                                                                                                                                                                                                 |
| `issue_plugin_implementation_receipt_v2_for_test`           | `strategy_plan_v2.rs:3974`                      | `owner_postgres_v4_moves_through_program_host_and_real_backtest`, `two_member_frame_invokes_once_is_causal_canonical_and_restart_equal`                                                                                                                                                                                                                                                 |
| `program_host_sim_event_round_trip_for_test`                | `program_host_sim_event_consumer_v1.rs:852`     | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`, `real_sim_event_run_which_only_entered_claims_no_round_trip`                                                                                                                                                                                                                                                         |
| `target_sysroot_digest_for_test`                            | `develop_plugin_build_v2_sandbox.rs:653`        | `canonical_linux_sysroot_matches_the_frozen_generator_digest`, `canonical_sysroot_reread_fails_closed_after_mutation`                                                                                                                                                                                                                                                                   |
| `add_admitted_frame_for_test`                               | `program_host_backtest_target_set_v2.rs:302`    | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`                                                                                                                                                                                                                                                                                                                       |
| `compile_from_verified_owner_source_for_test`               | `complex_strategy_compiler.rs:281`              | `verified_owner_source_token_compiles_every_symbolic_input_without_public_receipt_minting`                                                                                                                                                                                                                                                                                              |
| `first_for_test`                                            | `correction_policy_projection/authority.rs:206` | `first_projection_is_canonical_and_deterministic`                                                                                                                                                                                                                                                                                                                                       |
| `issue_backtest_universe_successor_for_test`                | `program_host_v2.rs:1457`                       | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`                                                                                                                                                                                                                                                                                                                       |
| `issue_for_test`                                            | `complex_strategy_compiler.rs:75`               | `canonical_pair_spread_state_builds_exact_compile_input`                                                                                                                                                                                                                                                                                                                                |
| `member_checkpoints_for_test`                               | `program_host_v2.rs:2160`                       | `two_member_frame_invokes_once_is_causal_canonical_and_restart_equal`                                                                                                                                                                                                                                                                                                                   |
| `new_with_native_instruments_for_test`                      | `replay_target_set_execution_bundle_v1.rs:603`  | `owner_bound_profile_drives_bar_signal_then_real_event_fills`                                                                                                                                                                                                                                                                                                                           |
| `program_host_sim_event_canonical_result_digest_for_test`   | `program_host_sim_event_consumer_v1.rs:877`     | `real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat`                                                                                                                                                                                                                                                                                                                       |
| `record_for_test`                                           | `develop_composer_operation_v2.rs:1551`         | `every_private_canonical_member_mutation_fails_resolve_without_successor`                                                                                                                                                                                                                                                                                                               |
| `replay_failure_terminal_in_transaction_for_test`           | `source_intake/postgres.rs:1137`                | `postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed`                                                                                                                                                                                                                                                                                                            |
| `replay_success_terminal_in_transaction_for_test`           | `source_intake/postgres.rs:1105`                | `postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed`                                                                                                                                                                                                                                                                                                            |
| `rewrite_outbox_request_identity_for_test`                  | `develop_composer_operation_v2.rs:311`          | `every_private_canonical_member_mutation_fails_resolve_without_successor`                                                                                                                                                                                                                                                                                                               |
| `state_pair_for_test`                                       | `program_host_v2.rs:2144`                       | `real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact`                                                                                                                                                                                                                                                                                                           |

```text
19 constructors, 19 distinct proofs
```

## What a passing check looks like

A census that only reports problems trains its readers to expect only problems, and then a passing
row is indistinguishable from a row nobody checked. This is what the check looks like when the
answer is that the proof is sound.

`postgres_sealed_success_atomically_reads_back_distinct_time_heads_and_rejects_mismatches`
(`crates/strategy_factory/tests/source_intake.rs:1680`, 473 lines) is an ordered chain entry whose
name claims nothing about provenance, but it is worth following because its sibling entry
*is* in the table above. At line 1807 it constructs `SealedSourceIntakeEnvironmentV1`, whose
`commit_terminal` (`src/source_intake/acceptance.rs:451`) calls
`commit_source_intake_success_terminal_in_transaction` at line 476 and
`commit_source_intake_failure_terminal_in_transaction` at line 501  -  the two production writers,
defined at `src/source_intake/postgres.rs:512` and `:570`. Across the whole 1680..2153 range there
are **0** `_for_test` call sites; the file as a whole has **11**, so the instrument that produced
that zero can produce a non-zero on this same file. The terminal rows this entry reads back were
written by the code that writes them in production.

Contrast that with its sibling
`postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed` in the table above,
which uses `replay_success_terminal_in_transaction_for_test` and
`replay_failure_terminal_in_transaction_for_test` six times and the production writers zero times.
Same module, same chain, two entries, opposite answers  -  which is the reason this census is
per-proof and not per-module.

## What this is not

**It is not a list of defects.** A constructor is the right tool where the proof is about the
arithmetic and the input's provenance is somebody else's proof. What the table says is narrower:
for each of these, the name promises something about provenance, and the provenance is
construction. Whether that is a gap depends on whether some other proof covers the supply, and
this census did not look for those.

**The reach numbers are not exact.** The call graph is built by matching names, so a common name
resolves to unrelated definitions. That is why the three hubs are excluded and why the depth is
two. Every row in the table above was read by hand at its call site; the aggregate was not.

**The five classes are mechanical, and mechanical is not correct.** Sorting by return type and SQL
verb misjudged three of the 95 on the first pass. Two of them were caught because the classifier's
answer and a hand reading disagreed, and one because the hand reading was the wrong one:
`rewrite_outbox_request_identity_for_test` does return a `Vec<u8>` and is a constructor. Those three
were found in the 28 definitions that were read by hand  -  the 23 the first version published and
five drawn as check points  -  so the rate they imply, 3 in 28, describes the hand-read set and
cannot be extended to the 67 that were not read. The count of 55 constructors carries an unknown
error; what it does not carry is the class of error the first version had, where the question was
asked of functions that produce nothing.

**A worked check, so the method can be judged:** `issue_backtest_universe_successor_for_test` is
called at line 477 of `program_host_v2_target_set_backtest_tests.rs`, inside
`later_frame_weight_uses_account_scoped_equity_including_unrealized_pnl` which begins at line 476;
`real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat` at line 675 reaches the same
constructor through `run_round_trip_corpus`. Both edges are real. Note that the first of those two
names is no longer counted as a claim about provenance  -  `unrealized` is not `real`  -  which is
the substring defect described above, caught here.
