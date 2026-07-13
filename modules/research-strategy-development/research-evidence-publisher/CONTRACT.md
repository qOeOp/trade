# research.research-evidence-publisher

## Responsibility

Publish research, validation, shadow, candidate, or lesson outputs as stable evidence refs for governance, policy, and artifact consumers.

## Inputs

- Evidence ref and evidence kind.
- One or more artifact refs.
- Optional candidate refs and source refs.
- Produced timestamp and content hash.

## Outputs

- `trade.protocol.research-evidence-ref.v1`

## Boundaries

- Does not run experiments.
- Does not promote strategy candidates.
- Does not write policy, `trade.db`, or exchange state.
- Produces refs only; durable artifact storage remains owned by artifact catalog owners.
