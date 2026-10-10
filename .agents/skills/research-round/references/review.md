# Independent review (G1, G2)

A reviewer is useful when it reads external evidence (fixed records, source diffs, native reports,
tool traces), checks well-defined properties, and does not share the author's context. It is close
to useless when asked whether a strategy will make money, or to judge a conclusion from prose alone.

## How to run one

- Spawn a sub-agent with a clean context. Give it the fixed attempt ID, revision and commit, the run
  IDs, and where the seals and source live; do not give it your narrative or conclusions.
- Before relying on a reviewer prompt, try it once on a known-clean case; a reviewer that flags clean
  work is not calibrated.
- Ask for findings that cite fixed evidence. You decide; in the next decision, say which findings you
  accepted or rejected and why.
- To retain the review, store its text as `review_evidence` material and cite it from
  `decision.basis.evidence_refs` (see README). A reviewer ID proves nothing by itself.

## G1: design (optional, before a line's first L4 run)

1. Can this experiment's result falsify the stated prediction? Is the primary response observable?
2. Does the source diff change only the declared mechanism? Is the clock causal?
3. Does the outcome → action map have at least two different actions?
4. Is the feasibility arithmetic present and correct for this design's sizing and capacity?
5. Are exposure, inspected runs and `/tmp` trials declared? Is the cost model identical to the
   intended reference's?

## G2: freeze (required before a confirmation attempt, knowledge admission or paper running)

1. Does the conclusion stay within the evidence (window, instruments, layer)?
2. Trial set across the `goal_id`: how many source versions ran on the same window? Compute the
   effective number of trials from the daily returns of all runs and a deflated Sharpe ratio, with
   their assumptions; treat them as diagnostics, not gates.
3. Does every decision cite the preregistered primary response, not a metric chosen afterwards? Does
   the actual configuration match the contract? Is every registered run cited?
4. Did the preregistered robustness grid show a plateau around the frozen center?
5. Which alternative explanations remain (regime, single instrument, a few trades, cost model)?

Unresolved G2 findings block the step they guard. For a conclusion about to be promoted, two or three
clean-context Agents can recompute its key numbers independently from the same seal; disagreement
means no claim.
