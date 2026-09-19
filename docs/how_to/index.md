# How-to Guides

:::note[Layer]
These walkthroughs drive the inherited engine's Python API. They run, and they are the fastest way
to watch the engine work end to end.

They are not the workflow the platform admits. A strategy that reaches production is a Design that
R&D's Develop capability lowers and compiles, not a subclass written by hand. See
`docs/owners/rd.md` and `docs/architecture/strategy-factory.md`.
:::

Goal-oriented recipes for common tasks. Each guide assumes familiarity with
Vibe concepts and focuses on achieving a specific outcome.

New to Vibe? Start with the [getting started](../getting_started/)
path and [tutorials](../tutorials/) first.

## Data workflows

| Guide                                                 | Description                                  |
| :---------------------------------------------------- | :------------------------------------------- |
| [Loading external data][loading_external_data]        | Load CSV data into the Parquet data catalog. |
| [Data catalog with Databento][data_catalog_databento] | Set up a catalog with Databento market data. |

## Live trading

| Guide                                                   | Description                                          |
| :------------------------------------------------------ | :--------------------------------------------------- |
| [Configure a live trading node](configure_live_trading) | Set up LiveNodeConfig, execution engine, and venues. |
| [Get started with Lighter](get_started_lighter)         | Start Lighter from Rust or Python.                   |

## Rust

| Guide                                            | Description                                         |
| :----------------------------------------------- | :-------------------------------------------------- |
| [Write an Actor (Rust)](write_rust_actor)        | Build a data actor with subscriptions and handlers. |
| [Write a Strategy (Rust)](write_rust_strategy)   | Build a strategy with order management.             |
| [Run a Backtest (Rust)](run_rust_backtest)       | Use BacktestEngine or BacktestNode with a catalog.  |
| [Run Live Trading (Rust)](run_rust_live_trading) | Connect to a venue with LiveNode.                   |

[loading_external_data]: https://github.com/qOeOp/trade/blob/main/docs/how_to/loading_external_data.py
[data_catalog_databento]: https://github.com/qOeOp/trade/blob/main/docs/how_to/data_catalog_databento.py
