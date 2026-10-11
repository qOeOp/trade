---
name: research-round
description: Plans and closes one strategy research round in this repository (goal, exploration, candidate freeze, confirmation, next experiment). Use before running a backtest for a research question, before freezing a candidate or registering a confirmation, before choosing the next experiment, and before claiming that a strategy improved, failed or generalized.
---

# Research round

One user goal is one round of the research ledger. Commands are in
[records.md](references/records.md) (rounds, freezes, confirmations, reading the ledger),
[runs.md](references/runs.md) (every native replay) and
[strategy-authoring.md](references/strategy-authoring.md) (the strategy file contract). Numbers
beyond the product readings follow the `nautilus-report-analysis` skill.

## What is recorded

The ledger registers two things; everything else is unregistered exploration.

- **Candidate freeze**: one sealed development run of a fixed strategy revision, judged once, when
  you stop developing that candidate or want to confirm it. The product computes the verdict from
  the goal's gates and the run's readings, and counts the distinct strategy sources replayed on the
  development window; you name the failed part when it fails. Freeze a failing candidate too: a
  failed freeze is recorded like a passed one, and the stop rules count them.
- **Confirmation**: only after a passed freeze, on data that does not exist yet: preregister the
  window, wait, run once, then the product judges it ([confirmation.md](references/confirmation.md)).

Source reading, definitions, debugging, event studies and pilots are exploration: no registration,
no dry runs. Every native replay still writes a trial row automatically, and that is how selection
pressure is counted. A verdict is never edited; a correction is a new record naming it.

## Before any test

1. Before each test, an event study as much as a replay, write its possible outcomes and the
   different action each leads to (at least two different actions). If every outcome leads to the
   same action, do not run it.
2. Read the goal and the gates in [feasibility.md](references/feasibility.md). The user owns only
   the three targets; sizing, per-plan risk and notional limits are yours. Judge a design first by
   the size-independent gates, with their numbers: closed plans, plan win rate, and return ÷
   drawdown against `min_annual_return ÷ (2/3 × max_drawdown)`. Never reject or narrow a design
   because a cap you chose binds, and never rescue a failed gate by sizing: size moves return and
   drawdown together. When those gates pass, scale size once so the drawdown lands near 2/3 of the
   budget, run that revision once and freeze it; no grid of sizes.
3. A whole-strategy result judges that combination of definition, rules and sizing, never the idea
   behind it or any one part. After a failed freeze, name its failed part (gross edge, cost,
   frequency, tail or integrity) before the next candidate; if it is unknown, diagnose first.
4. Treat windows before the model's training cutoff as knowledge-exposed: exploration and
   falsification only. The goal's `known_exposure` lists windows earlier rounds inspected.

## Robustness

A grid is exploration and every cell is a trial. Change one parameter at a time around the center,
write the plateau rule first, and freeze only the center.

## Progress and stopping

`round status` gives the counters. Run a progress check after every third failed freeze, and also
when more than 20 distinct strategy sources have been replayed since the last freeze. Answer in the
next freeze's note, or to the user if you stop: which part failed each time, which explanations
were excluded, which predictions were corroborated, and whether changes came from the mechanism or
from inspected losers. Stopping is a valid result. If two checks in a row show neither exclusion
nor corroboration, bring the question to the user.

## Evidence

- Each goal has one source note in the claims format, stored as an evidence bundle
  ([source-evidence.md](references/source-evidence.md)); a freeze cites it.
- Strategy source and stored runs are the retained evidence. A short exploration note may be stored
  as a bundle; readers, logs and scratch output stay in `/tmp`.
- When a workbench gap blocked a task, forced a workaround more than once or cost a rerun, record it
  as a product finding under `docs/plans/`: the blocked task, evidence (run and freeze IDs with the
  ledger commit), iteration cost, workaround and the smallest shared capability needed.

## Do not

- Relabel an inspected window as holdout, or call a development improvement generalization, also
  for a single tuning step or as partial evidence. Development, pre-cutoff or already existing
  data, including a window a tuning step skipped or one after the development window, can refute a
  change or leave it not refuted, never confirm it: never call it half, quasi or semi
  out-of-sample, independent, or "no overfitting".
- Freeze a candidate whose result or improvement rests on one sub-period or a few instruments
  before a stability check across sub-periods and instruments (for example leaving them out).
- Add filters after inspecting losing trades and call the result a mechanism.
- Change the user's goal (a target, the drawdown measure or the window) to rescue a result, or
  record your own sizing or risk plan as a user constraint.
- Derive PnL, R multiples, win rates or expectancy from price touches, or compare touch outcomes
  with a breakeven in numbers or in words, even as a rough, scenario or upper-bound figure the
  user asks for or a guess at how it would come out; or resolve two levels touched in one bar by
  any rule (stop-first or an even split included). Send the economic question to a native replay
  and report its same-bar ambiguity first; citing which native child filled is not ordering.
