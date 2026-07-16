# Replay Metrics

Owns deterministic metric projection from certified Replay fills and ledger entries.

Metrics are derived read models only. Numeric v3 monetary sums and Equity v2 remain authoritative inputs. `never_opened` derives zero trade/PnL/cost and no margin observations rather than a failure. Trade fee and liquidation fee are reported separately; observed margin measures consume the ordered snapshot path. A simulated liquidation execution does not become an exchange-realized fill-quality claim, and an OHLCV breach is not counted as executed liquidation. Metrics cannot alter execution facts or write Control Plane decisions.

Result v33 additionally projects `ohlcv_resolution_limited_count`、`ohlcv_net_terminal_contribution_span` 与 `ohlcv_canonical_shortfall_to_best` from OHLCV Resolution Evidence v3. These summarize terminal-fill contribution sensitivity only; they exclude common entry fee、funding、prior partial cashflows and must not be presented as full account-equity confidence intervals or promotion scores.
