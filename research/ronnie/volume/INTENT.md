# TrialFamily volume-v1: does volume tell real support and resistance from false, and real breaks from false?

Written before `volume/run.py` exists or any measure below is computed.

## Claims under test

- **High-volume nodes:** prices where much volume traded act as support and resistance. Low-volume nodes are crossed
  quickly.
- **Levels backed by volume:** a swing level sitting on heavy traded volume is real, and one on thin volume is hollow.
  Volume can falsify levels.
- **Break volume:** a break on high volume is real, and one on low volume is likely false.

## Volume profile (known at the open of each UTC day D)

- **Window and bins:** the 1h bars of days D-30 to D-1. Each bar's volume is spread evenly over its high-low range in
  price bins of width 0.1 ATR(14, daily, at D-1). The profile is smoothed with a 3-bin moving mean.
- **HVN:** a local maximum of the smoothed profile at or above the 80th percentile of bin volumes.
- **LVN:** a local minimum at or below the 20th percentile.

## Measures

- **A. Node reaction.** Each day, take the nearest HVN above and below the day's open, and the same for LVNs, each
  0.5 to 5 ATR(daily) from the open.
  - Each goes through the first-touch reaction test of community-v1 on 1h bars, with ATR(4h) and a 240-bar horizon.
  - **Held:** price moves 1 ATR away on the rejecting side first. **Broke:** a close lands 1 ATR beyond first.
  - Each node is compared with 20 copies moved 1-4 ATR(4h).
  - Reported: HVN held minus moved, LVN held minus moved, and HVN minus LVN.
- **B. Swing levels judged by volume.** Each day, take the nearest intact daily swing level (order 3, as in mtf-v1)
  above and below the open, within 5 ATR(daily).
  - A level is **backed** when its bin's profile volume ranks in the top third of the bins within 5 ATR of the open,
    and **hollow** when it ranks in the bottom third.
  - Reported: held rate backed minus hollow, and each against 20 moved copies.
- **C. Break volume.** Every first 4h close through a line of timing-v1 (swing levels of order 3, 5 and 8, and trend
  lines of order 5 and 8), one per bar and side.
  - The trade has its stop at the bar's opposite extreme, a 2R target and 30 bars, scored by `combo/harness.score`
    against random controls.
  - The break bar's relative volume is its volume over the mean of the prior 20 4h bars.
  - **High volume:** at least 1.5. **Low volume:** under 1.0.
  - Reported: the edge (R minus control) of each group, and high minus low.

## Data

- **Development:** BTCUSD (Bitstamp) and ETHUSDT (Binance), 2018-2022.
- **Holdout (never used by any family):** the first 20 Binance USDT coins in this list with archive bars for 2022-01
  and 2026-08. List: AUDIO, ALICE, KNC, STX, AR, ROSE, RSR, SFP, CAKE, TWT, JST, SUN, DYDX, GALA, FLOW, SUPER, C98,
  MASK, ATA, LINA, DODO, ALPHA, BEL. The holdout runs 2022-2026 and is read once.
- **FX:** excluded, since the feeds carry no traded volume.

## Decisions (95% intervals, bootstrap over days for A and B, coin-then-event on the holdout for C)

- **A holds:** HVN held minus moved is above zero, and HVN minus LVN is above zero, on development and on the holdout.
- **B holds:** backed minus hollow is above zero on development and on the holdout.
- **C holds:** high minus low and the high-volume edge are both above zero on development and on the holdout.
