---
name: research-round
description: Plan and close one strategy research round in this repository (question, preregistered attempt, native run, decision, next experiment). Use before publishing an attempt, before choosing the next experiment, and before claiming that a strategy improved, failed or generalized.
---

# Research round

You choose the question and the method. This skill fixes only what a round must commit to in advance,
so that a failure locates a bottleneck and the next run can change a decision. Publication mechanics
are in `research/records/README.md` ("One research round"); numbers from sealed reports follow the
`native-report-analysis` skill. Rationale and sources: `docs/plans/agent-rd-methodology-plan.zh.md`.

## Name the layer the attempt tests

A whole-strategy failure rejects the bundle of signal, entry, exit, sizing and cost; it does not
reject any one part. State in `contract.plan` which layer this attempt tests.

| Layer | Question | Failure allows you to conclude |
|---|---|---|
| L0 memory | What was tried; which failures and corrections bind this round? (`find`, `show --brief`, `compare`) | — |
| L1 definition | Timeframe, confirmation time, identification rule, entry, protection, target, holding; which observable response is predicted? | The direction has not been tested yet |
| L2 implementation and capacity | Does the code express the registered rule with a causal clock; are there enough events? | Fix the implementation; the result does not evaluate the mechanism |
| L3 market response | After the event, does price move as predicted against a preregistered reference? What happened to plans during their native lifetime? See [l3-boundary.md](references/l3-boundary.md) | This definition has no predictive power; not the whole direction |
| L4 native net account | Does the response survive fills, fees, funding and sizing? (`artifacts report`, `compare --analysis`) | Name the failing layer: gross edge, cost, frequency, size or tail |
| L5 confirmation | Does a frozen candidate hold on data that did not exist when it was frozen? See [confirmation.md](references/confirmation.md) | Development improvement did not generalize |

## Commit in the pending plan

In addition to the README questions:

1. **Outcome → action map with branches.** Give two or three ranges of the primary response and the
   next action each triggers. If every range leads to the same action, the run cannot change a
   decision: change the question or the primary response instead of running it.
2. **Target feasibility.** Estimate whether a fully working mechanism could reach the user's goal
   under the fixed risk boundaries ([feasibility.md](references/feasibility.md)). If not, make the
   primary response a mechanism reading or a local improvement, and say in `scope` that the run does
   not test the joint goal.
3. **Failure layer first.** After an economics failure, the next L4 candidate cites the failing layer
   located from that run's report. If it cannot be located, run a diagnostic attempt first.
4. **Freeze little, but freeze it hard.** Freeze the primary response, reference, window, cost model
   and the outcome → action map. Everything else is exploratory and never counts as confirmation.
5. **Count trials honestly.** Use one `family_id` per mechanism line for its budget and stop rule;
   count selection pressure across the whole `goal_id`. Declare every `/tmp` replay that influenced a
   choice as an inspected trial.
6. **Know what is unseen.** Any window before your model's training cutoff is knowledge-exposed:
   usable for exploration and falsification, never for "unseen" confirmation.
7. **Dry-run every write.** `publish attempt --dry-run` reports unreadable `evidence_refs` in
   `read_preflight`; `artifacts register --dry-run` reports a candidate that `compare` would refuse in
   `pair_preflight`. Fix what they report before writing.

## Bounded robustness

For a candidate with positive net or a clear local improvement, one preregistered grid is allowed:
one parameter at a time, the frozen center plus one step on each side (2k+1 cells). Write the plateau
rule before reading results, count every cell as a trial, and confirm only the preregistered center.

## Progress check

After three consecutive economics failures (a default prompt, not a threshold), answer before the next
candidate: in which layer did each fail; which named explanations were excluded and which
preregistered predictions were corroborated; did changes come from mechanism-derived predictions or
from filters added after seeing losing trades? Then continue, pivot or stop. Stopping is a valid
result. If two checks in a row neither excluded an explanation nor corroborated a prediction, stop
generating candidates and bring the question to the user.

## Independent review

G1 is optional, before a line's first L4 run or when a plan claims to test the joint goal. G2 is
required before registering a confirmation attempt, admitting knowledge or paper running; its
unresolved findings block that step. Use [review.md](references/review.md).

## Do not

- Judge every candidate only by the joint goal.
- Relabel an inspected window as holdout, or call a development improvement generalization.
- Add filters after inspecting losing trades and call the result a mechanism.
- Raise risk, leverage or the notional cap, or relax the goal, to rescue a result: these are the
  user's boundaries.
- Derive PnL, R multiples, win rates or breakeven comparisons from L3 price paths.
