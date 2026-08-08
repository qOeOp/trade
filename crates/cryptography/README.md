# vibe-cryptography

Cryptographic utilities and security functions for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-cryptography` crate provides essential cryptographic primitives and security utilities
required for secure communication with trading venues and data providers. This includes
digital signing, TLS configuration, and cryptographic provider management:

- HMAC-based message authentication and signing.
- Digital signatures using RSA and Ed25519 algorithms.
- TLS client configuration with platform certificate verification.
- Cryptographic provider management and initialization.
- Secure encoding and decoding utilities.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
