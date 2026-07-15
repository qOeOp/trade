# Replay Metrics

Owns deterministic metric projection from certified Replay fills and ledger entries.

Metrics are derived read models only. Numeric v3 monetary sums and Equity v1 remain authoritative inputs. Trade fee and liquidation fee are reported separately; observed margin measures consume the ordered snapshot path. A simulated liquidation execution does not become an exchange-realized fill-quality claim, and an OHLCV breach is not counted as executed liquidation. Metrics cannot alter execution facts or write Control Plane decisions.
