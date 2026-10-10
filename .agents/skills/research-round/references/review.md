# Independent review

A reviewer helps when it reads external evidence (fixed records, source diffs, native reports, tool
traces), checks well-defined properties, and does not share the author's context. It does not help
when asked whether a strategy will make money or to judge prose alone.

## Running one

- Use a sub-agent with a clean context. Give it fixed IDs and evidence locations, not your
  conclusions.
- Calibrate a new reviewer prompt on a known-clean case first.
- Ask for findings that cite fixed evidence. In the next decision, state which findings you accepted
  and why. Retain the review as `review_evidence` when it matters.

## Design (optional, before a line's first L4 run)

- Can the result falsify the prediction, and is the primary response observable?
- Does the source diff change only the declared mechanism, with a causal clock?
- Does the outcome map have at least two different actions, and is the feasibility estimate right?
- Are exposure, inspected runs and unregistered replays declared, and does the cost model match the
  reference?

## Freeze (required before confirmation, knowledge admission or paper running)

- Does the conclusion stay within its window, instruments and layer?
- How many source versions ran on the same window across the goal? Report effective trials and a
  deflated Sharpe ratio as diagnostics, not gates.
- Does every decision cite the preregistered primary response, and does the configuration match the
  contract?
- Did the preregistered grid show a plateau?
- Which alternative explanations remain?

Unresolved freeze findings block the step. For a conclusion about to be promoted, have two or three
clean-context Agents recompute its key numbers; disagreement means no claim.
