# Robustness diagnostics

Single-run reports already give daily tail trimming (`residual_after_top5_days`), single-instrument
trimming (`net_without_top_instrument`), sub-period splits (`dev_years`, `dev_quarters`), volatility
regimes (`by_regime`) and the aggregate profit bridge (`profit_bridge`, `closed_by_year`). Use the
two checks below for crypto-perpetual fragilities those sealed views do not separate.

- **Closed-cycle tail concentration.** Multi-day positions can concentrate returns in a few trades
  without triggering a 5-day return trim. From `tables()` closed cycles (`ts_closed_ns` not null),
  confirm the sum of `realized_pnl` equals `reconciled["realized_pnl_usdt"]`, then compute the sum
  and share of the top-K closed cycles (for example K = 3 and K = 5) in the direction of total
  closed PnL and the residual closed net PnL without them (noting any sign flip). State the
  population (closed cycles, open rows excluded), cycle count, K and `ledger_commit`.
- **Funding-vs-price regime dependence.** Perpetual funding flips across bull leverage and bear
  liquidation regimes. Read `profit_bridge` and `closed_by_year` first without recomputing sealed
  totals; from `tables()` closed cycles, split `price_pnl`, `commissions`, `funding` and
  `realized_pnl` by side (`long`, `short`) and close year or month, reconciled to `reconciled`.
  Report whether price-only net (`price_pnl - commissions`, excluding `funding`) stays positive and
  whether funding profit concentrates in one side or calendar year.
- Both checks are descriptive fragility diagnostics, never pass/fail gates, rankings or standalone
  justification to add a filter or drop trades. A figure that drives a recommendation or the next
  hypothesis needs an independent recomputation and a `search_exposure` judgment (`Evaluated
  variants: 0` when no extra rule or parameter variant was evaluated).
