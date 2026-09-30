# Research Intent: the crypto breakout on coins it has never seen (TrialFamily altcoins-v1)

Registered 2026-09-30, before `altcoins/run.py` was written or run.

- **Question:** does setups-v1's only survivor, B1 (the S2b breakout on 4h bars, crypto), hold on coins that played
  no part in finding it?
- **Rule:** B1 exactly as in `setups/run.py`: ronnie_bt S2b defaults, stop at the signal bar's far end, target 2R,
  30-bar time exit, stop first, cost 0.06% per side, every signal scored on its own.
- **Control:** 20 random entries per signal, same coin and year, same side, same stop distance in ATR and target in R.
- **Coins (fixed now):** BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM, FIL, each against
  USDT from Binance's public hourly klines (data.binance.vision). History runs from listing to 2026-09. The whole
  history is out of sample for this rule.
- **Bias:** these are coins still listed today, a survivorship bias. The list includes coins that faded (LTC, ETC,
  XLM, FIL) but not ones that were delisted.
- **Decision:** the rule holds on new coins if the pooled avgR minus control has a 95% bootstrap interval above zero,
  with the bootstrap resampling coins, then signals within coins. Per-coin results are reported but not tested.
  One trial.
