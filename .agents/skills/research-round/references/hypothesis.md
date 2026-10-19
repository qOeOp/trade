# Hypothesis and registration body

Read when checking sources, choosing a parent, writing the hypothesis and its prediction, and
preparing the registration body.

## Sources first

- **H.2.1.1** Before an economic hypothesis, read the source bundles already retained in the
  ledger (`evidence export`). Cite those whose mechanism and conditions still match; search only
  the mechanism's gaps, following `research-sources` (videos: `video-evidence`). Enter originals,
  excerpts and the query log as a bundle (`evidence add`) before registering; a registration
  citing a missing bundle is refused.
- **H.2.2.1** Mark every reason as external evidence (someone else's research), local diagnosis
  (a fact seen in this line's runs) or conjecture (your own guess), in the body's `rationale`
  (`external`, `local`, `conjecture`) and the source notes. External evidence states its location,
  market, window, frequency, costs and validation conditions, and whether it supports the
  mechanism, a rule parameter or only the method; a condition not read is "unknown". Local
  diagnosis cites the run and the ledger commit.

## Parent and change

- **H.1.1.1** Any published candidate on the lineage can be the parent, not only the recommended,
  latest or best one; a losing, insignificant or diagnostic-only candidate derives like any other.
  Do not ask permission or question its eligibility. Give the reason for the parent separately
  from the reason for the control.
- **H.1.1.3** One hypothesis registers one actual rule change, and every grid point's difference
  text equals it word for word. Changing the universe selection (ranking, top N, signal screen,
  rebalance frequency) or the sizing and capital budget is a rule change; an entry and exit change
  made together is one action, registered and described as one. Quantities derived from existing
  rules and parameters of a method not in use are not changes. Narrow a vague direction to one
  concrete change before registering.
- **H.1.1.4** Pick the next change from the duties: summarize the stances in the headers of this
  line's candidates, list the duties marked 缺省 or 不适用, combine them with the latest diagnosis
  or the duty an attribution points to ([attribution.md](attribution.md)), and write the duty ids
  in `changed_duties`.

## Rationale and prediction

- **H.3.1.1** The rationale names the market mechanism, who pays (the counterparty, whose cost is
  transferred) and why the mechanism should still exist in this line's universe and window; a
  quantity the replay inputs lack is replaced by a named proxy with its limits. The prediction
  gives, for each changed duty, the direction (up or down) of a catalogue measure in a slice and
  the fill or holding features that should show it. A replay result must be able to refute it;
  "it makes money" or "it performs better" is not a prediction.
- **H.3.1.2** Before registering, write in `prediction.outcomes` what follows each of the five
  outcomes, `improved`, `not_significant`, `loss`, `zero_activity` and `invalid`, one sentence
  each: refine this direction, change the control, repair and retry, or lower the priority with
  the condition for re-evaluating it. Never rewrite it after the replay; add to it only in a
  judgment.

## Registration body

`registration add --bundle NAME --body FILE --source FILE ...` locks the body and the execution
identity in an immutable bundle. The body holds exactly `prediction`, `changed_duties`, `parent`,
`control_run`, `change`, `rationale`, `sources`, `metric`, `comparison`, `grid` (one to five
`{candidate, params}`), `conditions` and `window`, optionally `retry_of` and `prechecks` (each
grid candidate's `source-review-*` bundle). A root has no parent, no control and empty
`changed_duties`; a derivation names at least one duty, and every changed duty has a prediction.
The `comparison` values are uncalibrated method examples, locked with the registration. A refusal
names the missing field and its description.
