# Autonomous R&D loop: log

Each loop is registered here (hypothesis, source, change, run) and committed before it runs; its result, attribution
and next step are appended after the run.

## Family A: "support holds in a trend" (assume the level holds while the trend is intact)

Sources:
- Osler (2000, FRBNY Economic Policy Review, "Support for Resistance"; 2003, Journal of Finance): published support and
  resistance levels predict intraday trend interruptions, explained by clustered take-profit orders at levels and
  stop-loss orders just beyond them.
- Time-series momentum in crypto (Rohrbach et al., 2017; "Dynamic time series momentum of cryptocurrencies", 2021):
  trends persist, so a level in the trend's direction has the trend behind it.
- Community practice (buy support in an uptrend, sell resistance in a downtrend, enter on a rejection candle, stop
  beyond the level, target the prior swing).
- This research: unconditional level fades fail because a tested edge usually breaks (range-v3: 48-70% of tests);
  4h EMA20 pullbacks on BTC and ETH were flat (setups-v1 P1). Hence: trend-aligned only, daily levels, rejection
  confirmation.

### Loop A1 (registered before running)

- **Hypothesis:** in a daily uptrend (close above the 200-day mean and the 50-day mean above the 200-day mean), an
  intact daily swing-low support (order 3, `level_book`) that is tested and rejected holds; mirror for downtrends and
  resistance.
- **Signal:** the day's low reaches within 0.25 ATR(14) of the support and the day closes above it; entry at the next
  open.
- **Exits:** stop at the support minus 1 ATR; target the highest high of the prior 20 days; time limit 20 days;
  signals with target under 1R or stop over 6 ATR are dropped; one signal per coin per 5 days.
