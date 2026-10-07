# R-1 native replay

- `strategy.py` owns R-1 signal logic and submits native orders. It does not calculate fills or PnL.
- `prepare.py` asks the native Binance USD-M data client for historical minute bars and writes the native Catalog.
- `run.py` reads Nautilus catalog data, runs `BacktestEngine`, and writes native reports.
- Keep source rule custody tied to `0725a7b3f89902e27cd421a18b4b879a13268534`.
- Check with `python -m compileall research/r1_native`, then run against a catalog containing Binance USDT perpetual minute bars and the matching instrument.
