---
name: research-round
description: Plan and close one strategy research round in this repository (question, preregistered attempt, native run, decision, next experiment). Use before publishing an attempt, before choosing the next experiment, and before claiming that a strategy improved, failed or generalized.
---

# Research round

What a round commits to before it reads a result. Publication mechanics are in
`research/records/README.md`; numbers from sealed reports follow the `native-report-analysis` skill.

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
5. Use one family per mechanism line for budget and stop; count selection pressure across the goal;
   declare every unregistered replay that influenced a choice.
6. Treat windows before the model's training cutoff as knowledge-exposed: exploration and
   falsification only.
7. Dry-run every write and fix what `read_preflight` or `pair_preflight` reports.

## Robustness

At most one preregistered grid: one parameter at a time, the frozen center plus one step each side.
Write the plateau rule first, count every cell as a trial, and confirm only the center.

## Progress and stopping

After repeated economics failures, ask which layer failed, which explanations were excluded, which
predictions were corroborated, and whether changes came from the mechanism or from inspected
losers. Stopping is a valid result. If two checks in a row show neither exclusion nor
corroboration, bring the question to the user.

## Evidence and review

- Keep readers, results and conclusions outside Git and `/tmp`; publish them as `review_evidence`
  material and cite their fixed IDs in `decision.basis.evidence_refs`. Another attempt's run is
  evidence, never `candidate_run_ref`.
- Review independently before confirmation, knowledge admission or paper running
  ([review.md](references/review.md)).

## Do not

- Relabel an inspected window as holdout, or call a development improvement generalization.
- Add filters after inspecting losing trades and call the result a mechanism.
- Change the risk limits or the goal to rescue a result.
- Derive PnL, R multiples, win rates or breakeven from price touches.
