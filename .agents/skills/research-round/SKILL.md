---
name: research-round
description: Plans and closes one strategy research round in this repository (hypothesis cards, exploration, candidate freeze, confirmation, next experiment, progress check). Use before running a backtest for a research question, before freezing a candidate or registering a confirmation, before choosing the next experiment, and before claiming that a strategy improved, failed or generalized.
---

# Research round

One user goal is one round of the research ledger. Commands are in
[records.md](references/records.md) (rounds, freezes, confirmations, reading the ledger),
[runs.md](references/runs.md) (every native replay) and
[strategy-authoring.md](references/strategy-authoring.md) (the strategy file contract). Ideas live
as hypothesis cards ([hypotheses.md](references/hypotheses.md)) in the knowledge list
([knowledge.md](references/knowledge.md)). Numbers beyond the product readings follow the
`nautilus-report-analysis` skill. A new goal starts with the `research-start` skill.

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
   behind it or any one part; what a failure excludes is the class its card wrote before the run.
4. Treat windows before the model's training cutoff as knowledge-exposed: exploration and
   falsification only. The goal's `known_exposure` lists windows earlier rounds inspected.

## Hypotheses

Every idea, including one in the user's prompt or a source the user names, is a hypothesis card in
the knowledge list, never a task to carry out as given. A card needs an economic rationale, a
falsifiable prediction, the frontier gap it targets and the class its failure excludes; an
independent reviewer passes it before its one coarse replay, and the coarse replay decides draft →
open ([hypotheses.md](references/hypotheses.md)).

- The coarse replay runs a simple mechanical version. Reconstructing a source's rules, checking
  fidelity or writing detailed rules waits until the card is open.
- A card the user proposed is marked as theirs and takes its place by prior like any other; it
  does not jump the queue, even when the user asks to set the others aside. Say so, with the
  order and why; you decide the order without approval.

When no draft or open card is left, find the next starting point as `research-start` step 2 does
(an extended frontier scan, or the user when nothing is left to scan or only finished strategies
remain) before writing another card.

## After a failure: name the part first

Before the next idea, name which part failed, from the readings (ledger value in brackets):

| Part | Reading | Next |
|---|---|---|
| gross edge (`gross_edge`) | closed price PnL before fees ≤ 0, or above 0 only because of one year | a different signal; record the card's class as excluded; never tune execution or exits |
| cost (`cost`) | positive before fees, eaten by commissions and funding | trade less often, use maker orders, hold longer, or avoid paying funding |
| tail (`tail`) | a few losing plans take most of the profit, or drawdown over budget | change exits and stops, or size by volatility |
| frequency (`frequency`) | plans pay but are too few, or the annual return is too low | more coins or timeframes, or looser entry conditions |
| integrity | the audit judged the run invalid | fix the code; not an economic failure (`failed` + `integrity` only for a defect you found in a passed run) |

If the part is unknown, diagnose it with `nautilus-report-analysis` before changing anything.

## Robustness

A grid is exploration and every cell is a trial. Change one parameter at a time around the center,
write the plateau rule first, and freeze only the center.

## Progress check

Check when any of these holds: `round status` reports `progress_check_due` (every third failed
freeze, or more than 20 distinct strategy sources replayed since the last freeze), or a fifth draft
has closed since the last check (excluded, or rejected at review).

1. For every frontier point compute the gap
   `max(0, w - win) / w + max(0, r - rd) / r`, where `w` is the goal's `min_plan_win_rate`,
   `r = min_annual_return / (2/3 × max_drawdown)`, `win` and `rd` the point's plan win rate and
   return to drawdown (a zero target adds nothing). The frontier moved out when the smallest gap
   is smaller than at the previous check of this goal.
2. Count the classes excluded since the previous check.
3. Record the check in the knowledge list. Development readings set the direction; they are not
   evidence.

When two checks in a row show neither an outward move nor a new excluded class, stop and bring the
user the frontier chart (plan win rate against return to drawdown), the excluded classes, and your
recommendation: whether the targets look reachable, which gate is stuck, and the next step (another
source of hypotheses, more data, or a target the user may reconsider). Only the user changes a
target. Stopping is a valid result.

## Evidence

- Sources a goal relied on go into one source note in the claims format, stored as an evidence
  bundle ([source-evidence.md](references/source-evidence.md)); a freeze cites it.
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
