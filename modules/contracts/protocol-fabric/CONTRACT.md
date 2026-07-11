# contracts/protocol-fabric

## Type

contract module

## Owns

- Stable cross-domain envelope schema registry.
- Job ticket schema and resolver helpers for command rail.
- Event write envelope schema for fact rail.
- Artifact ref, market manifest, exchange command/result ref, policy snapshot, and logical store ref shells.

## Inputs

- In-memory JSON envelopes or schema paths.

## Outputs

- JSON schema files under `src/schemas`.
- Lightweight TypeScript constants for schema ids and top-level domain slugs.
- Pure job-ticket helpers that resolve `toolset` entry metadata into shared `command_spec`.

## Boundaries

- Does not dispatch jobs.
- Does not read `toolset.json`; callers pass already loaded registry entries.
- Does not read or write `trade.db`, catalog DB, artifacts, market data, or exchange state.
- Does not validate business strategy, risk limits, order intent, or promotion decisions.
- Does not define transport technology; rails remain logical protocol surfaces.
