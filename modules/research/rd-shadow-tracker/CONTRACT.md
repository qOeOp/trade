# research/rd-shadow-tracker

## Type

atomic module

## Owns

- R&D paper shadow tracker state.
- Setup event chain projection for `open_setup -> observe_setup -> close_setup -> review_setup`.
- Conversion from forward holdout entry signals into review draft input.

## Inputs

- Forward holdout result JSON, or an existing tracker state JSON.
- Optional manifest map for refreshing open paper positions.
- Optional output path and catalog DB path.

## Outputs

- R&D tracker state artifact.
- Optional catalog artifact registration.
- Review draft records embedded in closed paper positions.

## Boundaries

- Writes only explicit tracker artifact output and catalog refs.
- Does not write `trade.db`, call exchange APIs, promote strategy evidence, or run R&D search.
- Tracker output is review input only; it is not strategy evidence by itself.
