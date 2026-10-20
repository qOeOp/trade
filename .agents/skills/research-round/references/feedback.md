# Feedback and priority

Read when reading comparison evidence, writing `interpretation`, `search_exposure` or `priority`
judgments, and ordering the next actions.

Judgments are written with `judgment add --kind KIND --line LINE --based-on COMMIT --body FILE
--subject ...`, where `KIND` is `interpretation`, `search_exposure`, `priority`, `recommendation`
or `review_cadence` and `--based-on` is the ledger commit you read. They are append-only: to change
one, add a new one that supersedes it. `research state` shows the current judgments with the facts
read now and `gates`, which lists what the next registration still lacks.

## Reading the comparison

- When a comparison is refused for comparability, choose another comparable control, or replay
  the control under the new identity first and the candidate after it. Never align or splice the
  two series yourself to get an effect, an interval or a p.
- p is a tail probability under the registered null and paired-resampling model, not the
  probability that the strategy or mechanism works, and not an effect size. Not reaching the
  registered level does not make the mechanism invalid; an interval across zero reads as
  uncertain. Reaching it inside the development window is an improvement or a development
  observation, not out-of-sample validity.

## Judgments

- Before registering the next hypothesis, write at least one `interpretation` of the previous
  result: the conditions it was obtained under and when it should be re-evaluated. A conclusion
  stays inside the registered conditions; an insignificant, losing or zero-fill result is never
  written as an exclusion. An invalid run that a registration retries (`retry_of`) needs no
  interpretation, only its repair record (diagnosis.md).
- Trials the product's commands read are counted by the ledger. Every extra view you computed
  with your own script (per month, per contract, participation, ...) is recorded as a
  `search_exposure` judgment, including views a skill requires.
- Order the next research actions (each a registered rule change with its grid, not a ranking of
  candidates) on six grounds: expected effect; uncertainty (interval, p, block-length sensitivity,
  power); mechanism support from sources and diagnosis; the directions and conditions already
  explored; the information the action brings; its cost (precheck and replay time, grid points).
  Write the grounds with the runs, registrations and ledger commit you read in a `priority`
  judgment, apart from the recommendation and the review cadence. A negative result changes the
  order and the re-evaluation condition; it never closes a direction or excludes a candidate.
- For each action it ranks first, a `priority` judgment names the report measures that motivate
  it (slice or section, measure name and direction, cited by run id and ledger commit without
  copying values) and the signal-table row and duty ids they map to (attribution.md). A
  parameter-only change (another period, length or threshold) names the report evidence that
  supports it; prefer the duties the report's strongest signals point to over a parameter change
  without such evidence.
