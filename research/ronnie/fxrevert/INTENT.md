# Research Intent: daily mean reversion on the FX majors (TrialFamily fxrevert-v1)

Registered 2026-09-30, before `fxrevert/run.py` was written or run.

- **Question:** the FX majors show a variance ratio below 1 (`market_character.py`). Does a daily mean-reversion entry
  beat random entries on them?
- **Data:** daily bars (UTC days) built from FXCM hourly bid candles for EURUSD, GBPUSD, USDJPY, AUDUSD, NZDUSD,
  USDCAD, USDCHF, GBPJPY and EURAUD.
- **Execution:** signals on a closed day, entry at the next day's open. Stop 2 x ATR(14) daily from entry, checked
  first on every day. Cost 0.005% per side. R is the result over the stop distance.

## Entries and exits (declared defaults)

- M1 Bollinger fade: the close is above the upper Bollinger band (20, 2) for a short, or below the lower band for a
  long. Exit at the close of the first day that closes back through the 20-day SMA, or after 10 days.
- M2 RSI(2): RSI(2) above 90 for a short, below 10 for a long. Exit at the close of the first day RSI(2) crosses 50,
  or after 5 days.
- M3 5-day stretch: the 5-day log return exceeds 1.5 x (20-day standard deviation of daily log returns x sqrt 5). Fade
  it and exit at the close of the 5th day.
- One position per setup and pair at a time; no new signal while one is open.

## Control, periods, decision

- Control: 20 random entry days per signal, same pair and year, same side. Each uses the same stop rule and the same
  exit rule applied from its own entry day.
- In-sample 2017-2022; out-of-sample 2023-2026, read once. The FX 2023-2026 data has served earlier 4h studies of
  other entries, but none of these three.
- A setup holds when avgR minus control has a 95% bootstrap interval above zero in sample and a 90% interval above
  zero out of sample. Three trials.
