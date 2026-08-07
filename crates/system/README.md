# vibe-system

System-level components and orchestration for [VibeTrader](https://github.com/qOeOp/trade).

The `vibe-system` crate provides the core system architecture for orchestrating trading systems,
including the kernel that manages all engines, configuration management,
and system-level factories for creating components:

- `VibeKernel` - Core system orchestrator managing engines and components.
- `VibeKernelConfig` - Configuration for kernel initialization.
- System builders and factories for component creation, including caller-supplied clock construction for live/sandbox systems.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `streaming`: Enables `persistence` dependency for streaming configuration.
- `python`: Enables Python bindings from [PyO3](https://pyo3.rs) (auto-enables `streaming`).
- `defi`: Enables DeFi (Decentralized Finance) support.
- `live`: Enables live trading mode dependencies.
- `tracing-bridge`: Enables the `tracing` subscriber bridge for log integration.
- `extension-module`: Builds as a Python extension module.
