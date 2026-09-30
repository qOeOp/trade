# TrialFamily range-v1: Ronnie's range box, buy the floor and sell the ceiling

Written before `range/run.py` exists or any box signal is scored.

## Setup R2 (4h bars, decided at the close of bar i)

- **Box:** the 60 closed bars before bar i give `top` (highest high) and `bot` (lowest low). The ATR `a` is ATR(14) of
  bar i-1.
- **The box qualifies if all three hold:**
  - its width `top - bot` is between 4a and 15a;
  - price has touched each edge at least twice: a touch is a bar reaching within 0.5a of the edge, and touches count
    as separate when at least 5 bars apart;
  - the window is sideways: `|close[i-1] - close[i-60]| <= 0.35 x width`.
- **Long at the floor:**
  - bar i's low reaches `bot + 0.5a` but stays above `bot - 1.0a`;
  - bar i closes above `bot`, below `bot + 0.35 x width`, and in the upper half of its own range.
- **Long exits:** stop at `min(low[i], bot) - 0.5a`; target `top - 0.25a`.
- **Short at the ceiling:** mirrored.
- **Spacing:** at most one signal per side every 6 bars.
- **Common to both sides:** entry at the next open, time limit 30 bars, stop first when both are touched, and signals
  whose target is under 1R dropped (as in setups-v1).

## Test

- **Scoring:** each signal is compared with 20 random entries of the same year, side, stop in ATR and target in R. The
  code is `setups/run.py`'s `market_events` logic.
- **Costs:** 0.06% per side on crypto, 0.005% per side on FX.
- **Markets:** crypto is BTCUSD and ETHUSDT; FX is the nine majors of setups-v1.
  - in sample runs 2017-2022, at a 95% interval;
  - out of sample runs 2023-2026, at a 90% interval, read once.
- **Replication:** the 15 altcoins over their full history.
- **Decision (per class):** R2 holds when the in-sample and out-of-sample intervals of R minus control are both above
  zero. For crypto, the altcoin mean must also be above zero. No parameter above changes after the first run.
