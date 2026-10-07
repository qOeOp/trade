# R-1 native replay

- `strategy.py` owns R-1u daily-pivot and registered H03 four-hour box signals, and submits native orders. It does not calculate fills or PnL. `test_box_signal.py` checks H03's source geometry; the complete economic read is native BacktestEngine output.
- `prepare.py` asks the native Binance USD-M data client for historical LAST/MARK minute bars and settled funding, then writes the native Catalog and the current-instrument assumption. The replay interval defaults to one minute; five minutes is a lower-resolution sensitivity option.
- `run.py` validates all three data timelines, runs `BacktestEngine` with native mark and funding updates, and writes native reports.
- `run_portfolio.py` streams prepared five-minute catalogs into one native margin account, with one Strategy per contract; its reports use a shared capital denominator and distinguish input start from order eligibility for multi-timeframe warmup.
- `RD_EXPERIMENTS.md` is the local experiment ledger for source evidence, hypotheses, replay identity, results, and open limits. Product and process findings belong in `docs/plans/r1-native-rd-findings.zh.md` for later blueprint reconciliation.
- `SOURCE_CASES.md` holds video/chart fidelity checks to apply before judging a new strategy variant's backtest score.
- Keep source rule custody tied to `0725a7b3f89902e27cd421a18b4b879a13268534`.
- Check with `python -m compileall research/r1_native`, then run against a catalog containing Binance USDT perpetual minute bars and the matching instrument.
