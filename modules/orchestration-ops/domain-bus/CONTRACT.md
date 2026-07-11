# orchestration-ops/domain-bus

## Type

atomic ops module

## Owns

- Runtime logical bus adapter for domain inbox / outbox envelopes.
- Append/update of `domain_message` rows in `ops_runtime_store`.

## Inputs

- `direction`, source / target domain, rail, payload ref, optional cycle/job refs.
- Existing `ops_runtime_store` SQLite path.

## Outputs

- Persisted bus envelope with status.
- Queryable bus message list for cycle / target / status filters.

## Boundaries

- Does not execute jobs.
- Does not interpret trade, research, governance, market, exchange, or policy payloads.
- Does not write owner domain stores except `ops_runtime_store`.
- Does not replace domain owner CLIs; it only records handoff envelopes and refs.
