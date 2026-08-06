# vibe-architect-ax


[VibeTrader](https://github.com/qOeOp/trade) adapter for [AX Exchange](https://architect.exchange).

## Overview

[AX Exchange](https://architect.exchange) is a centralized and regulated derivatives exchange for
traditional underlying asset classes. Its production catalog lists perpetual contracts across FX,
equities, energy ETFs, metals, energy, treasuries, and compute. Its sandbox also exposes dated
futures. AX is licensed by the
[Bermuda Monetary Authority (BMA)](https://www.bma.bm/).

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.
