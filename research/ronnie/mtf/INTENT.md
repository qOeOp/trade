# TrialFamily mtf-v1: higher-timeframe levels used the way practitioners describe

Written before `mtf/run.py` exists or any signal below is scored.

## Why

The earlier tests used a level as a place to enter on a touch or a break, on one timeframe. Practitioners describe
other uses.
- **Top-down:** the daily or weekly chart gives the level. The trader waits for price to sweep it and for a
  lower-timeframe change of character (CHoCH). Entry comes on the lower timeframe, with a tight stop beyond the sweep
  and the next higher-timeframe level as target.
- **Sweep fade:** trade the failed break of a higher-timeframe level, a stop run that closes back inside.
- **Strong levels:** levels touched several times before. Chung and Bellotti (arXiv 2101.07410) report that levels
  with more prior bounces bounce more often, and that the effect decays.

## Levels (known at each moment from closed bars only)

- **Daily levels:** intact swing levels of order 3. A level is added once its pivot confirms and removed at the first
  daily close beyond it.
- **Weekly levels:** intact swing levels of order 2, handled the same way.
- **Touches:** a touch of a daily level is a later daily bar whose range reaches within 0.25 ATR(14, daily) of it and
  closes on the level's original side. Touches count as separate when at least 3 days apart.

## Variants (three, fixed)

- **M1, strong-level fade (1h bars).** The first 1h bar that reaches a daily level with at least 2 prior touches, and
  none in the last 3 days.
  - Entry is a limit at the level: buy at support, sell at resistance.
  - The stop is 0.5 ATR(daily) beyond the level, the target 1.0 ATR(daily) back from it (2R), and the time limit is
    120 1h bars.
  - Reported beside it, as the same fade on daily levels with no prior touch (not part of the decision).
- **M2, top-down sweep and CHoCH (1h bars).**
  - **Arm:** a 1h bar trades beyond a daily or weekly level (low below support, or high above resistance) while the
    prior 1h close was on the level's original side.
  - **Trigger:** within the next 24 1h bars, a 1h close goes back through the most recent confirmed 1h swing of order
    3 on the reversal side. For a long, that swing is the last swing high before the trigger.
  - **Invalidation:** no daily close more than 1 ATR(daily) beyond the level may come first.
  - **Entry and stop:** entry at the next 1h open. The stop is the sweep extreme since arming, 0.1 ATR(daily) beyond.
  - **Target:** the nearest intact daily or weekly level on the far side. It is skipped when under 2R and capped at
    6R.
  - **Time limit:** 120 1h bars.
- **M3, sweep fade (4h bars).**
  - **Setup:** a 4h bar trades beyond an intact daily level and closes back on its original side.
  - **Entry and exits:** entry at the next 4h open, stop 0.1 ATR(4h) beyond that bar's extreme, target 2R, time limit
    30 4h bars.

## Test

- **Controls:** every signal against 20 random entries on its own timeframe. Each matches the year, side, stop in ATR
  of that timeframe, target in R and time limit. Costs are 0.06% per side on crypto and 0.005% per side on FX.
- **Development:** BTCUSD and ETHUSDT, 2018-2022.
- **FX:** the nine majors, in sample 2017-2022 and out of sample 2023-2026.
- **Holdout (never used by any family):** the first 20 Binance USDT coins in this list with archive bars for 2021-06
  and 2026-08. List: ICX, ZRX, DGB, SC, HOT, ARPA, CTSI, DENT, DUSK, CHR, COTI, MTL, OGN, NKN, BAND, OCEAN, SKL, CELR,
  REEF, TFUEL, WIN, BTT, TRB, LPT, UMA. Signals run 2021-01 to 2026-08, and the holdout is read once.
- **Decision (per variant):**
  - **Crypto:** holds when the development (95%) and holdout coin-then-signal (95%) intervals of R minus control are
    both above zero.
  - **FX:** holds when the in-sample (95%) and out-of-sample (90%) intervals are both above zero.
