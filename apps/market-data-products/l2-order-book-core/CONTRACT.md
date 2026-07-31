# L2 Order Book Core Contract

## Type

same-domain deterministic Rust engine / no CLI

## Owns

- Decimal normalization and deterministic bid / ask projection.
- Binance `U/u/pu` snapshot bridge and live continuity state.
- Canonical current-book hash and bounded level accounting.
- TL2S v1 frame encoding, crash-safe finalize, valid-prefix recovery, and rotating segments.

## Inputs

- Binance depth snapshot and normalized depth-update values supplied by callers.
- Bounded level capacity、TL2S payload bytes、segment rotation and sync parameters.

## Outputs

- Deterministic book projection、sequence decision、canonical book hash and bounded snapshots.
- Finalized/recovered TL2S segment descriptors；filesystem bytes remain caller-owned evidence.

## Boundaries

- No network, runtime lifecycle, gRPC, Kafka, database, strategy, LLM, or exchange write.
- Does not decide whether an incident should reconnect, stop, or alert; callers own policy.
- Does not admit market-data manifests or become a historical-data authority.
- `l2-recorder-bakeoff` is a consumer/certification harness；network、soak and process lifecycle remain outside this core.
- Schema or sequence changes require fixture parity in `l2-recorder-bakeoff` and production tests.

## Checks

- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
