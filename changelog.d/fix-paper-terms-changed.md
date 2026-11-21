- Breaking (Paper refusal, delegated decision, probe C-172): Paper reads Binance's `fapi/v1/exchangeInfo` for each
  entry and refuses it with `TERMS_CHANGED` when the contract's tick size, step size or minimum notional differ from
  the market's at the run's market day, or cannot be read: the entry is not sent and the run stops, as Live does.
  The read runs off the node's thread and the entry waits for it unsent; reduce-only orders are not checked. Before,
  Paper compared terms only at start and kept trading after a mid-run change.
