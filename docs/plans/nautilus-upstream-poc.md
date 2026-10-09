# Published Nautilus Replay Migration

The full evidence record is maintained in [Chinese](https://qoeop.github.io/trade/zh/docs/replay/). This page summarizes its reproducible result.

The published `nautilus_trader==2.0.0rc3` package replayed the same one year of 37 Binance perpetual instruments, LAST and MARK prices, funding inputs, quantity table and 100,000 USDT shared native account used by the local engine. H18a matched exactly: 29,712 orders, 2,589 fills, 686 positions and ending equity of 104,901.95547793 USDT. H19a matched order identities and states with 17,665 orders, 1,722 fills and 507 positions; ending equity differed by 0.00352690 USDT (published package: 111,664.46988783 USDT). Both had zero rejected or denied orders.

The former local engine had a bracket child activation issue. The native Strategy now adapts the linked exit order activation sequence, preserving native order types and economics. The repository therefore no longer needs a forked Rust matching engine. Future Nautilus upgrades require a fresh order lifecycle and paired replay check.

`run_portfolio.py` now uses `BacktestNode` for all supported R1 variants, preserving the command and report contract. Node loads funding from the existing Catalog, and the custom funding decoder has been deleted. Existing MARK bars are locally converted into a verified native mark-update Catalog; no historical data was downloaded again. H18a and H19a matched the former native runner on the full annual 37-instrument shared account. Fourteen additional combinations were paired over the annual BTC/ETH window. Of the resulting 16 tested combinations, 14 passed integrity checks and matched; two reproduced their pre-existing order-integrity failures with the same reports. See `backtest/r1/receipts/parity-node-migration.json` and the earlier funding-loader receipts `parity-node-h18a.json` and `parity-node-h19a.json`.

See [`backtest/r1/README.md`](https://github.com/qOeOp/trade/blob/main/backtest/r1/README.md) for commands and [`docs/plans/nautilus-upstream-poc.zh.md`](https://github.com/qOeOp/trade/blob/main/docs/plans/nautilus-upstream-poc.zh.md) for full evidence and limitations.
