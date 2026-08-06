# vibe-lighter


[VibeTrader](https://github.com/qOeOp/trade) adapter for the [Lighter](https://lighter.xyz) decentralized spot and perpetuals exchange.

The `vibe-lighter` crate implements the Lighter adapter for VibeTrader, including
typed HTTP and WebSocket clients, REST and stream models, venue parsing, data and execution
client wiring, and an in-tree L2 signer for the official **Lighter API**.

Lighter is a high-throughput central-limit-order-book decentralized crypto exchange
for spot and perpetual futures, settling on Ethereum via a custom zero-knowledge rollup.
Order matching is performed off-chain by a sequencer, with ZK proofs published on-chain
to guarantee correctness of matching, fills, and liquidations.

Trading is non-custodial: users hold their assets in Lighter's smart contracts
and authorise trades with their own keys.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

Python bindings are intentionally narrow: configuration, enums, factory wiring, and the
integrator revocation helper. Data and execution clients are consumed directly through the Rust
trait surface.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.

## Integrator attribution

Submitted create and modify order transactions carry the VibeTrader integrator account index in
Lighter's `L2TxAttributes`. This helps us gauge real usage of the integration and prioritize
ongoing maintenance. Maker and taker integrator fees are set to zero, so attribution adds no trading
cost.

Lighter requires an `ApproveIntegrator` approval before these attributes can be attached to orders.
During startup, the execution client submits the required **zero-fee** approval for the configured
L2 account. See the
[Lighter integration guide](https://github.com/qOeOp/trade/blob/main/docs/integrations/lighter.md#integrator-attribution)
for approval and revocation details.

### Maker-only API keys

Lighter restricts maker-only API keys to the 0ms speed-bump lane (PostOnly orders, modifies on
ALO orders, and cancels), so they cannot submit `ApproveIntegrator` themselves. The execution
client detects maker-only keys at startup via `getMakerOnlyApiKeys` and skips the approval with
a WARN log. Approval is account-scoped: a single `ApproveIntegrator` from any non-maker-only
key on the same account permanently unlocks orders for every key on that account, including
maker-only ones.

## L2 transaction signer

The crate ships an in-tree implementation of the Lighter L2 signer (Schnorr
over the ECgFp5 curve, Goldilocks field, Poseidon2 binding). Correctness is
gated by independent layers:

- **Vector parity** with the upstream Go reference (`elliottech/poseidon_crypto`)
  for every algebra layer.
- **Compiled-signer oracle parity** with the signer distributed by the official
  `lighter-python` SDK, covering end-to-end outputs for the four supported tx
  kinds.
- **Differential parity** with Thomas Pornin's MIT-licensed Rust reference
  (`pornin/ecgfp5`), kept in the isolated fuzz crate so the production
  dependency graph has no git dependencies. The fuzz targets assert every public
  algebra operation byte-for-byte against it and soak point decode and scalar
  multiplication under coverage guidance. Pornin's reference accompanies the
  curve's design paper (IACR ePrint 2022/274), has been public and reused by
  downstream zero-knowledge projects since 2022, and shares no code lineage
  with our implementation: a bug that slips the gate would have to be present
  in both implementations in the same way.
- **Property tests** covering ring axioms, group laws, and Frobenius
  identities on the cryptographic primitives.

Round-trip testing against Lighter itself remains the final correctness
gate for what the sequencer accepts.

## Fuzzing

Coverage-guided fuzz targets for the L2 signer live in [`fuzz/`](fuzz/README.md). They require the
workspace-pinned `cargo-fuzz` binary and a Rust nightly toolchain; install them from the repository
root with `make install-tools` and `rustup toolchain install nightly`.

## Third-party notices

Reference attributions for cryptographic parameter sets and reproduced test vectors
used by the L2 transaction signer are listed in
[`licenses/THIRD_PARTY_LICENSES.md`](licenses/THIRD_PARTY_LICENSES.md).
