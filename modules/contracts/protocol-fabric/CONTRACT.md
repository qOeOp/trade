# contracts/protocol-fabric

## Type

contract module

## Owns

- Stable cross-domain envelope schema registry.
- Rail envelope header contract: `rail`, `event_type`, `source_domain`, `target_domain`, `schema_id`, `cycle_id`, `job_id`, `idempotency_key`, and `payload_ref`.
- Rail ownership registry vocabulary for allowed publishers, consumers, schemas, retention, and replay expectations.
- Job ticket schema and resolver helpers for command rail.
- Ops rail shell for health facts, incident refs, cycle summary, and next-cycle constraints.
- Event write envelope schema for fact rail.
- Artifact ref, market manifest, frozen candidate ref, research evidence ref, action intent ref, exchange command/result ref, policy snapshot, and logical store ref shells.

## Inputs

- In-memory JSON envelopes or schema paths.

## Outputs

- JSON schema files under `src/schemas`.
- Lightweight TypeScript constants for schema ids, top-level domain slugs, rail ids, and rail ownership registry.
- Pure job-ticket helpers that resolve `toolset` entry metadata into shared `command_spec`.
- Pure rail route validator for publisher / consumer ownership checks.

## Boundaries

- Does not dispatch jobs.
- Does not read `toolset.json`; callers pass already loaded registry entries.
- Does not read or write `trade.db`, catalog DB, artifacts, market data, or exchange state.
- Does not validate business strategy, risk limits, order intent, or promotion decisions.
- Does not define transport technology; rails remain logical protocol surfaces.
