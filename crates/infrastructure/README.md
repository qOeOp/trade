# vibe-infrastructure

Database and messaging infrastructure for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-infrastructure` crate provides backend database implementations and message bus adapters
that enable VibeTrader to scale from development to production deployments. This includes
enterprise-grade data persistence and messaging capabilities:

- **Redis integration**: Cache database and message bus implementations using Redis.
- **PostgreSQL integration**: SQL-based cache database with full data models.
- **Connection management**: Connection handling with retry logic and health monitoring.
- **Serialization options**: Support for JSON and MessagePack encoding formats.
- **Python bindings**: PyO3 integration for Python interoperability.

The crate supports multiple database backends through feature flags, allowing users to choose
the appropriate infrastructure components for their specific deployment requirements and scale.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `redis`: Enables the Redis cache database and message bus backing implementations.
- `postgres`: Enables the PostgreSQL SQLx models and cache database backend.
- `extension-module`: Builds as a Python extension module.
