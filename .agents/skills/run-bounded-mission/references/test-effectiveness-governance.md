# Govern Test Effectiveness

Load this reference only when a test failure can change the candidate, an escaped defect demonstrates
that existing tests missed required behavior, or the Mission may restructure tests. It governs the
decision; it is not another test runner, coverage gate, mutation platform, ledger, or acceptance
authority.

## Resolve authority first

Use this order:

1. frozen user outcome and current product/runtime contract;
2. behavior observed through the real production consumer;
3. owner contract and compatible cross-owner boundary;
4. tests and their fixtures, mocks, snapshots, and implementation assumptions.

Tests are evidence, not the final judge. Before changing production code for a red test, identify the
behavior the test claims, the contract or consumer evidence that authorizes it, and the failure class.
If the test contradicts a higher-authority contract or consumer, preserve production behavior and
revise, replace, lower, or nominate the test for deletion. If authority remains ambiguous, return to
Plan; do not make the code green by weakening required behavior.

## Classify the signal

Choose exactly one class when evidence supports it; otherwise record the classification as unresolved
and investigate:

| Machine value | Meaning | Default route |
| --- | --- | --- |
| `real_behavior_regression` | required consumer behavior regressed | fix production behavior and retain a behavior-level oracle |
| `outdated_contract_or_assertion` | test encodes a superseded contract or assertion | replace or delete the obsolete evidence |
| `implementation_coupled_change_detector` | test mirrors call shape, order, private structure, or code transformation without proving behavior | replace with a public behavior oracle or delete if it has no unique value |
| `scenario_gap` | the relevant state, boundary, or sequence was never exercised | strengthen the narrowest authoritative layer |
| `oracle_assertion_gap` | the scenario ran but assertions could not distinguish correct from faulty behavior | strengthen or replace the oracle |
| `selection_or_routing_gap` | the test or gate did not select the affected owner, consumer, or path | repair selection at the existing routing owner |
| `mock_or_fake_isolation_distortion` | a double diverged from the real boundary or hid integration behavior | replace with contract/integration evidence or a faithful fake |
| `environment_concurrency_or_time_gap` | environment, ordering, concurrency, clock, or timing behavior was absent | exercise the missing boundary without weakening deterministic lower tests |
| `flake_or_infrastructure` | the signal is nondeterministic or the harness/infrastructure failed | isolate and repair the signal; never reinterpret it as a product regression without evidence |

## Review every escaped defect

When an already-tested area lets a defect escape, answer all five questions before adding or changing
tests:

1. Which layer or real consumer should have detected the defect?
2. Why did the existing selection, scenario, boundary, or oracle fail to detect it?
3. Which adjacent defects share the same blind spot?
4. Can an existing test be strengthened or replaced instead of adding another test?
5. Which old tests become redundant or obsolete, and what unique value evidence prevents deletion?

“One bug, one new test” is not a conclusion. An unanswered question remains explicit uncertainty.

## Produce read-only evidence

Use the deterministic helper only with immutable Git revisions:

```bash
bun .agents/skills/run-bounded-mission/scripts/test-effectiveness-audit.ts \
  --origin <full-origin-commit-hash> \
  --candidate <full-candidate-commit-hash> \
  --owner-root <repository-relative-owner> \
  [--owner-root <repository-relative-owner> ...] \
  [--scope <repository-relative-owner>] \
  [--classification <machine-value>]
```

Both revision arguments must be complete 40- or 64-character lowercase Git commit hashes; symbolic
refs, abbreviated hashes, and revision expressions fail closed. The Agent derives canonical owner
roots from repository authority at both revisions and passes their union; the helper does not know
the repository's manifest or owner schema. It reads `git diff` plus tracked source (including shell
programs), test, `CONTRACT.md`, and `package.json` metadata. It emits one JSON evidence document to
stdout. It does not execute tests or mutation, modify files, inspect a database, infer coverage, or
declare deletion safe. Treat its import, name, duplicate-content, size, mock, and time/concurrency
signals as review leads. Direct candidate-tree test importers remain candidates even when their owner
did not change. Deleted tests are named as origin-review uncertainty, never treated as candidate-tree
proof that deletion was safe. Missing runtime timing remains unavailable rather than estimated.
Renames across supplied owner roots contribute both the origin-side and candidate-side owners; the
candidate-side source path remains the changed source while `previous_path` preserves the
origin-side movement evidence.
`--scope` limits the changed-path input; candidate-tree metadata remains repository-wide so direct
dependent tests and their owner markers outside that scope are not hidden.
Bare package imports resolve only through tracked package manifests; a coincidental repository path
with the same name is not treated as an internal dependency.
JavaScript and TypeScript direct-import evidence comes from Bun's runtime-owned file parser and
includes static imports, literal dynamic imports, re-exports, bare `require`, and `module.require`.
The helper has no workspace package dependency. The output `import_analysis.status` is `incomplete`
when a candidate file cannot be parsed or contains a non-literal, template, type-only, or other
module form the runtime scanner does not prove; `incomplete_files` retains stable repository-relative
paths and reason codes while imports proven in other files remain available. Consumers must not
treat an incomplete analysis as a complete candidate set, and
`no_direct_static_candidate_evidence` remains false until the analysis is complete.

The evidence must retain resolved origin/candidate commit and tree identities, affected owners,
unverified consumer leads, candidate tests and unique-value leads, cost signals, the five
escaped-defect questions, and uncertainty. Static paths do not prove production reachability or
execution, and the helper does not recommend test actions or decide whether to open a Test Refactor
Mission.
`no_direct_static_candidate_evidence=true` means only that no changed test or direct candidate-tree
import was found. It must not be restated as “no tests exist”; transitive paths, dynamic routing, and
deleted sources remain unresolved.

A supplied failure classification describes the escaped defect as review context only. It never
selects a per-test action. The workspace-skill check discovers all tracked skill-local helper tests
under `.agents/skills/*/scripts/*.test.ts`.

## Choose an action

For each candidate test choose one of:

- `keep`: distinct required behavior is demonstrated;
- `strengthen`: the scenario is relevant but its path or oracle is incomplete;
- `replace`: a higher-value behavior or boundary test can carry the requirement;
- `lower_layer`: the same deterministic rule belongs at a narrower owner layer;
- `delete_candidate`: no unique required behavior remains after replacement or duplication review;
- `further_investigation`: authority, consumer behavior, cost, or unique value is not yet known.

Never delete or rewrite a test from helper output alone. Mutation, coverage, LOC, test count, and
runtime are signals only; none is a target or automatic gate.

The following are necessary test-effectiveness signals, not dispatch authority. A separate Test
Refactor Mission is also a Refactor Mission under
[Refactor Mission proposals](refactor-mission-proposal.md): investigate it only after `accept`, and
only when that method's integrated evidence spanning at least two accepted Missions, reachable
revision, structural cause, consumer, proposal, consent, and dispatch requirements also pass.

Consider a separate Test Refactor Mission only when all of these are true:

1. the actionable set contains a replacement, layer move, deletion candidate, or coordinated change
   to at least two tests;
2. the current contract and consumer acceptance can remain frozen;
3. the test-only candidate can be separated from any production behavior fix and from its acceptance
   authority;
4. expected value, cost evidence, affected owner, and stopping evidence are named.

A localized authoritative regression test may stay in the current Mission. Missing answers, mixed
production behavior, or disputed authority route to further investigation or Plan, not an automatic
child Mission. This reference never dispatches or labels a Refactor Mission by itself.

## Evidence basis

- Google Testing Blog,
  [Change-Detector Tests Considered Harmful](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html):
  implementation mirroring can add maintenance cost without proving behavior.
- Google Research,
  [Long Term Effects of Mutation Testing](https://research.google/pubs/long-term-effects-of-mutation-testing/):
  artificial faults can reveal test-suite holes, but this reference does not authorize a repository
  mutation gate.
- pytest,
  [Flaky tests](https://docs.pytest.org/en/stable/explanation/flaky.html): uncontrolled state,
  ordering, concurrency, timing, and overly strict assertions are distinct failure sources.
- McMaster and Memon,
  [Call Stack Coverage for Test Suite Reduction](https://www.cs.umd.edu/~atif/papers/McMasterMemonICSM2005-abstract.html):
  reduction can trade suite size against fault detection, so static duplication is never deletion
  proof.
