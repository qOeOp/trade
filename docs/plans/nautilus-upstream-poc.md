# Published Nautilus Replay Migration

The full evidence record is maintained in [Chinese](https://qoeop.github.io/trade/zh/docs/replay/). This page summarizes its reproducible result.

The published `nautilus_trader==2.0.0rc3` package replayed the same one year of 37 Binance perpetual instruments, LAST and MARK prices, funding inputs, quantity table and 100,000 USDT shared native account used by the local engine. H18a matched exactly: 29,712 orders, 2,589 fills, 686 positions and ending equity of 104,901.95547793 USDT. H19a matched order identities and states with 17,665 orders, 1,722 fills and 507 positions; ending equity differed by 0.00352690 USDT (published package: 111,664.46988783 USDT). Both had zero rejected or denied orders.

The former local engine had a bracket child activation issue. The native Strategy now adapts the linked exit order activation sequence, preserving native order types and economics. The repository therefore no longer needs a forked Rust matching engine. Future Nautilus upgrades require a fresh order lifecycle and paired replay check.

See [`strategies/r1/README.md`](https://github.com/qOeOp/trade/blob/main/strategies/r1/README.md) for commands and [`docs/plans/nautilus-upstream-poc.zh.md`](https://github.com/qOeOp/trade/blob/main/docs/plans/nautilus-upstream-poc.zh.md) for full evidence and limitations.
