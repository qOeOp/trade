# Ops Runtime Store Contract

Owns `ops_runtime_store`, the orchestration observability store for cycle, job, health, notify, incident, lock, and runtime-parity records.

## Responsibilities

- Create and migrate `data/ops_runtime.db` schema.
- Record cycle runs and job runs.
- Record runtime health observations.
- Record notification attempts.
- Record system incidents and append-only incident lifecycle events.
- Own ops locks, heartbeat renewal, and monotonic fencing generations used by runtime supervisors.
- Report whether an acquisition recovered an expired active row; clean release preserves generation history without preserving active ownership.
- Record immutable Agent/program parity observations, including both canonical projection hashes and diagnostic projections; a repeated observation id is accepted only when byte-equivalent after row decoding.
- Expose a compact read-only parity status projection with aggregate counts, latest hashes, and fenced supervisor lease state; omit holder identity and diagnostic detail.

## Boundaries

- Does not store trading truth.
- Does not infer strategy, market, or execution state.
- Does not call exchange, research, policy, or notification services.
- Exposes append/update observability helpers only.
- Incident status changes are operational acknowledgements, not trading verdicts.
- Parity observations compare runtime semantics only; they do not authorize domain jobs, strategy promotion, exchange writes, or execution cutover.
