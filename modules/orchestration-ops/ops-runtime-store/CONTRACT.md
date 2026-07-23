# Ops Runtime Store Contract

Owns `ops_runtime_store`, the orchestration observability store for cycle, job, health, notify, incident, lock, runtime-parity, and provider-neutral Agent Run operational records.

## Responsibilities

- Create and migrate `data/ops_runtime.db` schema.
- Record cycle runs and job runs.
- Record runtime health observations.
- Record notification attempts.
- Record system incidents and append-only incident lifecycle events.
- Own ops locks, heartbeat renewal, and monotonic fencing generations used by runtime supervisors.
- Report whether an acquisition recovered an expired active row; clean release preserves generation history without preserving active ownership.
- Record immutable Agent/program parity observations, including both canonical projection hashes and diagnostic projections; a repeated observation id is accepted only when byte-equivalent after row decoding.
- Expose a compact read-only parity status projection with raw, shared-input-comparable, and legacy-sequential counts, latest hashes/basis, and fenced supervisor lease state; omit holder identity and diagnostic detail.
- Persist bounded Watch Task definitions, compare-and-set lifecycle state, counters, typed handoff, terminal reason, and append-only transitions; `triggered` carries no execution authority.
- Persist Agent Run request identity, lifecycle events, sanitized Host session refs, and terminal result. Duplicate request/idempotency identity is create-or-identical; event sequences and terminal closure fail closed.
- Persist immutable create-or-identical Agent workspace execution scopes as bounded canonical JSON bound to run/request/scope hashes; this is operational authorization evidence with `domain_authority=none`, not a patch or owner fact.
- Persist one restart-readable patch-adoption lifecycle per completed Developer Run. A terminal candidate result binds exact run/request/scope/patch and release manifest identity; it grants no merge, deploy, strategy, Replay, promotion, or trading authority.
- Persist a separate restart-readable Strategy source-adoption lifecycle keyed by the Registry candidate manifest hash. It binds source revision、exact Strategy bytes and terminal certified source archive without pretending the Strategy candidate is an Agent code patch; it grants no checkout advance、hot load、deploy、Forward、promotion or trading authority.

## Boundaries

- Does not store trading truth.
- Does not infer strategy, market, or execution state.
- Does not call exchange, research, policy, or notification services.
- Exposes append/update observability helpers only.
- Incident status changes are operational acknowledgements, not trading verdicts.
- Parity observations compare runtime semantics only; they do not authorize domain jobs, strategy promotion, exchange writes, or execution cutover.
- Agent Run rows contain operational refs and canonical contracts only; they do not contain prompts, raw reasoning, provider payloads, owner facts, credentials, patches, or domain authority.
