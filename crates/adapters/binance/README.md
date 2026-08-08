# vibe-binance

[VibeTrader](https://github.com/qOeOp/trade) adapter for the
[Binance](https://www.binance.com/) cryptocurrency exchange.

The `vibe-binance` crate provides client bindings (HTTP & WebSocket), data models,
and helper utilities that wrap the official **Binance API**. Live data and execution
clients are available for:

- Spot markets, including Binance US (api.binance.com)
- USD-M Futures (fapi.binance.com)
- COIN-M Futures (dapi.binance.com)

The crate also includes shared enums, endpoint constants, URL routing, and credential
plumbing for adjacent Binance surfaces such as Margin and European Options. Those
surfaces do not have live data or execution clients in this crate.

## VibeTrader

[VibeTrader](https://github.com/qOeOp/trade) is a Rust-native
engine for multi-asset, multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, providing research-to-live semantic parity.

## Authentication

This crate requires **Ed25519 API keys** for all authenticated endpoints (REST and WebSocket API).
Ed25519 is recommended by Binance for its superior performance and security. HMAC and RSA keys
are not supported.

Generate an Ed25519 keypair and register it with Binance:

```bash
# Generate private key (PKCS#8 PEM format)
openssl genpkey -algorithm ed25519 -out binance_ed25519_private.pem

# Extract public key for Binance registration
openssl pkey -in binance_ed25519_private.pem -pubout -out binance_ed25519_public.pem
```

Set credentials via environment variables:

```bash
export BINANCE_API_KEY="your-api-key-from-binance"
export BINANCE_API_SECRET="$(cat binance_ed25519_private.pem)"
```

## Feature flags

This crate provides feature flags to control source code inclusion during compilation:

- `python`: Enables Python bindings from [PyO3](https://pyo3.rs).
- `extension-module`: Builds as a Python extension module.

[High-precision mode](https://github.com/qOeOp/trade/blob/main/docs/getting_started/installation.md#precision-mode) (128-bit value types) is enabled by default.
