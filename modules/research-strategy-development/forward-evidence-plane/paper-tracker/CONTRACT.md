# Forward Evidence Paper Tracker

## Type

atomic module

## Owns

- J05 R&D paper tracker state and artifact publication.
- Setup event chain projection for `open_setup -> observe_setup -> close_setup -> review_setup`.
- Conversion from legacy forward diagnostic entry signals into review draft input.

## Inputs

- Legacy forward diagnostic result JSON, or an existing tracker state JSON.
- Optional manifest map for refreshing open paper positions.
- Optional output path and catalog DB path.

## Outputs

- R&D tracker state artifact.
- Optional catalog artifact registration.
- Review draft records embedded in closed paper positions.
- Native `domain-runtime.domain-job-result.v1` for J05 `rd_forward_shadow_trackers`, with `artifact_catalog` as the only logical write surface.

## Boundaries

- Writes only explicit tracker artifact output and catalog refs.
- Does not write `trade.db`, call exchange APIs, promote strategy evidence, or run R&D search.
- Tracker output is review input only; it is not strategy evidence by itself.
- Despite the compatibility tool/job name, this module does not own or claim formal Shadow evidence.
- Placeholder tracker configs without `forward_result_path` or `state_path` return an auditable skipped J05 result; they do not invent artifact refs.
