---
name: research-round
description: Plans and closes one strategy research round in this repository (question, preregistered attempt, native run, decision, next experiment). Use before running a backtest for a research question, before publishing an attempt, before choosing the next experiment, and before claiming that a strategy improved, failed or generalized.
---

# Research round

What a round commits to before it reads a result. Exact commands are in
[strategy-authoring.md](references/strategy-authoring.md) (strategy file contract, source
publication and binding), [publish.md](references/publish.md) (reading records, the pending attempt,
decisions, evidence and `compare`) and [seal.md](references/seal.md) (identities, `artifacts run`,
`verify`, `backup`, `register` and `report`). Numbers from sealed reports follow the
`nautilus-report-analysis` skill.

Read prior records first (`find`, then `show <id> --brief`) for any claim you extend or combine. A
run that a decision cites goes through `artifacts run`, `verify`, `backup` and `register`; direct
`run_portfolio` output under `/tmp` is a diagnostic.

## Name the layer

A whole-strategy failure rejects the bundle, not any one part. State which layer the attempt tests:

- **L1 definition**: the rule and the observable response it predicts.
- **L2 implementation**: the code matches the rule with a causal clock, and there are enough events.
- **L3 market response**: price after the event against a preregistered reference, and plan
  lifecycles ([l3-boundary.md](references/l3-boundary.md)).
- **L4 net account**: fills, fees, funding and sizing; name the failing part (gross edge, cost,
  frequency, size or tail).
- **L5 confirmation**: a frozen candidate on data that did not exist at freeze time
  ([confirmation.md](references/confirmation.md)).

## Before publishing

1. Map outcomes to actions with at least two different actions. If every outcome leads to the same
   action, do not run.
2. Check feasibility ([feasibility.md](references/feasibility.md)). If a fully working mechanism
   cannot reach the goal within the risk limits, the primary response is a mechanism reading or a
   local improvement, and the scope says so.
3. After an economics failure, cite the failing part before the next candidate; if it is unknown,
   diagnose first.
4. Freeze the primary response, reference, window, cost model, outcome map and reader. Everything
   else is exploratory.
5. Use one family per mechanism line for budget and stop; count selection pressure across the goal.
   In the plan, list every replay you ran since the previous attempt that is not registered to an
   attempt (command and output path), or write `Unregistered replays: none`.
6. Treat windows before the model's training cutoff as knowledge-exposed: exploration and
   falsification only.
7. Dry-run every write that has `--dry-run` (`publish attempt`, `material retain`,
   `artifacts register`) and fix what `read_preflight` or `pair_preflight` reports.

## Robustness

At most one preregistered grid: one parameter at a time, the frozen center plus one step each side.
Write the plateau rule first, count every cell as a trial, and confirm only the center.

## Progress and stopping

After three economics failures in a goal with no economics pass between them (decisions with layer
`economics` and outcome `failed`, in publication order; decisions on other layers neither count nor
reset), answer in the next attempt's plan, or in the third failure's `next_action` if you stop:
which L4 part failed each time, which explanations were excluded, which predictions were
corroborated, and whether changes came from the mechanism or from inspected losers. The count
restarts after each check. Stopping is a valid result. If two checks in a row show neither
exclusion nor corroboration, bring the question to the user.

## Evidence and review

- Keep readers, results and conclusions outside Git and `/tmp`; publish them with
  `material retain --file PATH SHA256 [--file ...]`, dry-run first
  ([publish.md](references/publish.md)), and cite the returned `review_evidence:SHA256` IDs in
  `decision.basis.evidence_refs`. Another attempt's run is evidence, never `candidate_run_ref`.
- Review independently before confirmation ([review.md](references/review.md)).
- When a workbench gap blocked a task, forced a workaround in more than one attempt, or cost a
  rerun, record it as a product finding under `docs/plans/`: affected attempt IDs, the blocked task,
  evidence (fixed IDs), iteration cost, workaround and the smallest shared capability needed.

## Do not

- Relabel an inspected window as holdout, or call a development improvement generalization.
- Add filters after inspecting losing trades and call the result a mechanism.
- Change the risk limits or the goal to rescue a result.
- Derive PnL, R multiples, win rates or breakeven from price touches.
