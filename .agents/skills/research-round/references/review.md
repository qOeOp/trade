# Independent review

A reviewer helps when it reads external evidence (fixed records, source diffs, native reports, tool
traces), checks well-defined properties, and does not share the author's context. It does not help
when asked whether a strategy will make money or to judge prose alone.

## Running one

- Use a sub-agent with a clean context. Give it fixed IDs and evidence locations, not your
  conclusions.
- Calibrate a new reviewer prompt on a known-clean case first.
- Ask for findings that cite fixed evidence. In the next decision, state which findings you accepted
  and why. Retain a freeze review with `material retain` and cite its `review_evidence:SHA256` ID
  in the confirmation attempt's plan.

## Freeze (required before confirmation)

- Does the conclusion stay within its window, instruments and layer?
- How many source versions ran on the same window across the goal? Report effective trials and a
  deflated Sharpe ratio as diagnostics, not gates.
- Does every decision cite the preregistered primary response, and does the configuration match the
  contract?
- Does each source revision's diff from its code parent change only its attempt's declared
  mechanism, with a causal clock?
- Did the preregistered grid show a plateau?
- Which alternative explanations remain?

Unresolved freeze findings block the step. For a conclusion about to be promoted, have two or three
clean-context Agents recompute its key numbers; disagreement means no claim.
