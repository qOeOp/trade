# TrialFamily range-v2: multi-timeframe range boxes, sell the ceiling and buy the floor

Written before `range2/run.py` exists or any signal below is scored. Crypto only.

## Background

range-v1 tested one box (60 4h bars, rejection-close entry) and failed on every market. Ronnie marks boxes on several
timeframes and fades both edges. This family widens the test: three timeframes, a resting limit entry, and boxes that
coincide across timeframes.

## Box (per timeframe: 1h, 4h, 1d; decided at the close of bar i)

The box rules are those of range-v1, applied on each timeframe with that timeframe's ATR(14) `a`.
- **Box:** the 60 closed bars before bar i give the top and bottom.
- **Width:** from 4a to 15a.
- **Touches:** at least two touches of each edge, a touch being within 0.5a, with touches at least 5 bars apart.
- **Sideways:** the drift `|close[i-1] - close[i-60]|` is at most 0.35 times the width.
- **Price inside:** bar i closes inside the box.

## Variants (fixed)

- **L, limit at the edge (1h, 4h, 1d).**
  - At bar i's close, a buy limit sits at the bottom and a sell limit at the top, valid for the next 6 bars.
  - **Fill:** at the edge, or at the bar's open if that open is already beyond the edge but not beyond the stop.
  - **Stop:** 0.5a beyond the edge. **Target:** the far edge, 0.25a inside it.
  - **Spacing:** at most one order per side per box, and one per side every 6 bars.
- **C, rejection close (1h, 4h, 1d).** The range-v1 entry: a bar reaches the edge, closes back inside in its outer
  half, and the trade enters at the next open. Stop and target are as in L.
- **M, timeframe confluence (4h).** L on 4h boxes, kept only when the traded edge lies within 0.5a(4h) of the same
  edge of the 1d box active at that moment.

## Test

- **Exits:** the time limit is 30 bars of the box's timeframe, and the stop is taken first when both are touched
  (`mtf/run.py` walk). Signals whose target is under 1R are dropped. The cost is 0.06% per side.
- **Control:** each signal against 20 random entries on its timeframe, matched on year, side, stop in ATR, target in R
  and time limit.
- **Markets:** the 17 majors (BTC, ETH, BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM and
  FIL against USDT, Binance hourly klines).
  - development runs 2018-2022;
  - check runs 2023-01 to 2026-08, read once.
- **Decision (per variant and timeframe):** holds when the R-minus-control interval (95%, coin-then-signal bootstrap) is
  above zero in both periods.
