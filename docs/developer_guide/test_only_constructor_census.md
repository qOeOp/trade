# Census: proofs whose inputs come from a test-only constructor

A constructor that exists only under `cfg(test)` can make a proof answer a question nobody asked.
`run_multi_frame_equity_corpus` drives a two-frame target-set backtest and reads as evidence that
multiple frames work; its second frame comes from `issue_backtest_universe_successor_for_test`,
which builds one by copying the first frame and changing its logical instant and its members'
open and close. The arithmetic across two frames is proved. Whether an Owner can supply a second
frame is not, and that is the part that is missing.

This counts how far that shape reaches. Measured at `d6e4ea597` on a clean tree.

**It counts proofs, not modules, and the reason is in the repository.** `crates/strategy_factory`'s
Source Intake module contributes two ordered chain entries. One of them constructs a sealed
environment whose `commit_terminal` calls the production terminal writers, with zero `_for_test`
call sites in its 473-line body. The other uses the replay constructors six times and the
production writers zero times. Same module, same chain, adjacent entries, opposite answers. A
per-module verdict would have to pick one of those two and would be wrong about the other. The
worked form of that pair is below, and it is also where this census stops being able to answer.

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

**The mechanical rule is a first cut, and it leaks in the permissive direction.** The 19 rows that
survived to the table below were then read by hand, and 7 of them are not constructors either:

| reclassified by hand                                      | actually | what the mechanical rule missed                                                              |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `add_admitted_frame_for_test`                             | mutate   | `anyhow::Result<()>` has one type parameter, so the `Result<(), E>` pattern did not match it |
| `state_pair_for_test`                                     | observe  | returns `(&[u8], &[u8])` borrowed out of `self`                                              |
| `member_checkpoints_for_test`                             | observe  | maps over `self.member_kernels`                                                              |
| `record_for_test`                                         | observe  | clones a record already in `self.state`                                                      |
| `first_for_test`                                          | verify   | validates its `Projection` argument and returns it unchanged                                 |
| `program_host_sim_event_canonical_result_digest_for_test` | observe  | a digest of its argument                                                                     |
| `target_sysroot_digest_for_test`                          | observe  | a digest of a path                                                                           |

The rule tests *what type comes back*. The question is *whether a value was made*, and a borrowed
view of existing state, a digest of an argument, and a validated pass-through all come back as
non-unit types. **19 mechanical, 12 after hand reading**; every one of the 12 below was read.

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

## The 12, and where their inputs actually come from

A row reaches here when the proof's name carries `owner`, `production`, `real`, `end_to_end`,
`canonical` or `live` as an `_`-delimited word  -  a claim about where the input came from  -  while
its input comes from a constructor that made one. For each, the supply-side question was then asked
directly: *does anything outside test-only code produce this value today?*

**Four delegate entirely to production code.** The `for_test` name is a visibility shim, nothing
more; the value the proof consumes was built by the same code that builds it in production. These
are not gaps, and listing them as such is the census's own false-positive class.

| constructor                                                                                | delegates to                                    | that target                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------- |
| `issue_for_test` (`complex_strategy_compiler.rs:75`)                                       | `issue_binding_receipt`                         | `complex_strategy_compiler.rs:585`, ungated |
| `issue_plugin_implementation_receipt_v2_for_test` (`strategy_plan_v2.rs:3974`)             | `issue_plugin_implementation_receipt`           | `strategy_plan_v2.rs:1607`, ungated         |
| `new_with_native_instruments_for_test` (`replay_target_set_execution_bundle_v1.rs:603`)    | `Self::new_with_native_instruments`             | `:438`, ungated, one extra `None`           |
| `program_host_sim_event_round_trip_for_test` (`program_host_sim_event_consumer_v1.rs:852`) | `round_trip_closure`, `canonical_result_digest` | `:670` and `:881`, both ungated             |

`owner_postgres_v4_moves_through_program_host_and_real_backtest` is an ordered chain entry and its
constructor is in that first group, so that entry's claim holds.

**Six fabricate at least one component.** Here the name promises provenance and the provenance is
construction:

| constructor                                                                              | what it fabricates                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_backtest_universe_successor_for_test` (`program_host_v2.rs:1457`)                 | a successor frame, by copying the first and changing its logical instant and members' open/close  -  the case at the top of this document |
| `compile_from_verified_owner_source_for_test` (`complex_strategy_compiler.rs:281`)       | the `VerifiedOwnerSourceResolution` itself, via `for_verified_test`, which is `#[cfg(test)]`; the compilation it then runs is production  |
| `plugin_implementation_receipts_for_test` (`strategy_plan_v2.rs:3949`)                   | the four build digests, as `BindingDigest::from_untrusted_bytes([seed; 32])`                                                              |
| `compile_with_binding_and_implementation_receipts_for_test` (`strategy_plan_v2.rs:3847`) | the binding projections, via `test_binding_projections`, which is `#[cfg(test)]`                                                          |
| `compile_with_binding_projections_for_test` (`strategy_plan_v2.rs:3834`)                 | both of the above, which it calls in sequence                                                                                             |
| `rewrite_outbox_request_identity_for_test` (`develop_composer_operation_v2.rs:311`)      | a request identity and the digests over it; the outbox it starts from is real                                                             |

**Two reach the production writers and fabricate one of their inputs**, which is the most
interesting row in this document and is treated on its own below:
`replay_success_terminal_in_transaction_for_test` and
`replay_failure_terminal_in_transaction_for_test` (`source_intake/postgres.rs:1105`, `:1137`) call
`commit_source_intake_success/failure_terminal_in_transaction`  -  the production writers  -  but
supply their `retrieval_time` from `SourceIntakeRetrievalTimeEvidenceV1::from_receipt_fixture`.

```text
12 constructors: 4 delegate, 6 fabricate, 2 partly
```

## What a passing check looks like, and where this one stops passing

A census that reports only problems trains its readers to expect only problems, and then a passing
row is indistinguishable from a row nobody checked. This is what the check looks like when it
passes  -  and, because it is the same case, what it looks like when a pass at one level is not a
pass at the next.

`postgres_sealed_success_atomically_reads_back_distinct_time_heads_and_rejects_mismatches`
(`crates/strategy_factory/tests/source_intake.rs:1680`, 473 lines) is an ordered chain entry. At
line 1807 it constructs `SealedSourceIntakeEnvironmentV1`, whose `commit_terminal`
(`src/source_intake/acceptance.rs:451`) calls
`commit_source_intake_success_terminal_in_transaction` at line 476 and
`commit_source_intake_failure_terminal_in_transaction` at line 501  -  the production writers,
defined at `src/source_intake/postgres.rs:512` and `:570`. Across the whole 1680..2153 range there
are **0** `_for_test` call sites; the file as a whole has **11**, so the instrument that produced
that zero can produce a non-zero on this same file. **That is a real pass**: the terminal rows this
entry reads back were written by the code that writes them in production, and its sibling chain
entry `postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed`
(`tests/source_intake.rs:714`), in the table above, uses the replay constructors six times and the
writers zero times. Same module, same chain, adjacent entries, opposite answers.

**And then the next question has a different answer.** The writers record a
`SourceIntakeRetrievalTimeEvidenceV1`. Every producer of that type in the tree  -  all eleven call
sites  -  is `fixture` or `from_receipt_fixture`, and the two `impl` blocks that define them are
`#[cfg(any(test, feature = "sealed-source-intake-acceptance"))]`. The sealed environment itself
builds it at `acceptance.rs:198` with `SourceIntakeRetrievalTimeEvidenceV1::fixture`. **Nothing in
this repository produces that evidence outside test and sealed-acceptance code.** The production
writers are reached; one of the facts they write has no production producer.

The check reported 0 and the check was right. It measures `_for_test` call sites, and the
fabrication here is spelled `fixture` and sits behind a feature gate. A criterion cannot find what
its pattern does not spell.

## What the name pattern does not cover

The sample is every production-module function whose name carries `for_test` or `test_only`  -  86
definitions in 39 files at `d6e4ea597` under the pattern `fn [a-z_]*(for_test|test_only)[a-z_]*`.
The same pattern with `fixture` matches **136 definitions in 67 files, with zero overlap**. Most of
those 136 are tests that read a fixture rather than test-only producers, so 136 is an upper bound
on what is missing, not a second census. What is not in doubt is the direction: the one case above
where a fabricated input mattered was spelled `fixture`, and this census could not see it.

Anyone extending this work should start there, and should expect the extension to change answers in
the table above rather than only add rows.

## What this is not

**It is not a list of defects.** A constructor is the right tool where the proof is about the
arithmetic and the input's provenance is somebody else's proof. Four of the twelve turned out to
delegate to production code outright, which is why the supply-side question has to be asked per row
and cannot be inferred from the name. For the six that fabricate, what the table says is still
narrower than "defect": the name promises provenance and the provenance is construction. Whether
that matters depends on what the proof is for.

**The reach numbers are not exact.** The call graph is built by matching names, so a common name
resolves to unrelated definitions. That is why the three hubs are excluded and why the depth is
two. Every row in the table above was read by hand at its call site; the aggregate was not.

**The five classes are mechanical, and mechanical is not correct.** 29 of the 95 definitions have
now been read by hand: the 23 the first version published, five drawn as check points, and
`record_for_test`. On those 29 the mechanical rule was wrong **9 times**  -  two found when its
answer and a hand reading disagreed, seven found when the twelve survivors were read in full. Once
the hand reading was the wrong one: `rewrite_outbox_request_identity_for_test` does return a
`Vec<u8>` and is a constructor.

9 in 29 is not a rate that extends to the 66 definitions nobody read, and if it were extended it
would understate rather than overstate: those 29 are exactly the definitions that had already drawn
attention, and a misjudgement rate measured on rows someone already looked at runs lower than the
rate among rows nobody did. The count of 55 constructors carries an unknown error. What it no
longer carries is the class of error the first version had, where the question was asked of
functions that produce nothing.

**A worked check, so the method can be judged:** `issue_backtest_universe_successor_for_test` is
called at line 477 of `program_host_v2_target_set_backtest_tests.rs`, inside
`later_frame_weight_uses_account_scoped_equity_including_unrealized_pnl` which begins at line 476;
`real_sim_event_run_enters_fills_exits_fills_again_and_ends_flat` at line 675 reaches the same
constructor through `run_round_trip_corpus`. Both edges are real. Note that the first of those two
names is no longer counted as a claim about provenance  -  `unrealized` is not `real`  -  which is
the substring defect described above, caught here.
