# Ops Runtime Store Contract

Owns `ops_runtime_store`, the orchestration observability store for cycle, job, health, notify, incident, and lock records.

## Responsibilities

- Create and migrate `data/ops_runtime.db` schema.
- Record cycle runs and job runs.
- Record runtime health observations.
- Record notification attempts.
- Record system incidents and append-only incident lifecycle events.
- Own ops locks used by the automation cycle.

## Boundaries

- Does not store trading truth.
- Does not infer strategy, market, or execution state.
- Does not call exchange, research, policy, or notification services.
- Exposes append/update observability helpers only.
- Incident status changes are operational acknowledgements, not trading verdicts.
