# L2 Order Book Core Contract

Same-domain internal engine shared by the L2 evidence harness and production owner.

## Owns

- Decimal normalization and deterministic bid / ask projection.
- Binance `U/u/pu` snapshot bridge and live continuity state.
- Canonical current-book hash and bounded level accounting.
- TL2S v1 frame encoding, crash-safe finalize, valid-prefix recovery, and rotating segments.

## Boundaries

- No network, runtime lifecycle, gRPC, Kafka, database, strategy, LLM, or exchange write.
- Does not decide whether an incident should reconnect, stop, or alert; callers own policy.
- Does not admit market-data manifests or become a historical-data authority.
- Schema or sequence changes require fixture parity in `l2-recorder-bakeoff` and production tests.

## Checks

- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
