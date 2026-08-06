# Adapters and integrations

In-tree adapters translate venue or provider protocols into the shared Vibe Trader data and
execution contracts. The engine owns normalized domain behavior; each adapter owns transport,
authentication, venue-specific parsing, and client wiring.

## Current adapters

| Adapter | Capability |
| --- | --- |
| Architect (AX) | Data and execution |
| Betfair | Data and execution |
| Binance | Data and execution |
| Blockchain | Data |
| BitMEX | Data and execution |
| Bybit | Data and execution |
| Coinbase | Data and execution |
| Databento | Data |
| Deribit | Data and execution |
| Derive | Data and execution |
| dYdX | Data and execution |
| Hyperliquid | Data and execution |
| Interactive Brokers | Data and execution |
| Kraken | Data and execution |
| Lighter | Data and execution |
| OKX | Data and execution |
| Polymarket | Data and execution |
| Sandbox | Execution |
| Tardis | Data |

## Adapter requirements

An adapter change must keep protocol-specific concerns behind the existing client and factory
boundaries, use the shared model types, fail closed on invalid venue data, and include focused
tests and integration documentation. New credentials or live side effects require explicit
configuration and must never be introduced by tests or examples.

Implementation guidance is in [`docs/developer_guide/adapters.md`](docs/developer_guide/adapters.md),
with venue-specific guides under [`docs/integrations/`](docs/integrations/).
