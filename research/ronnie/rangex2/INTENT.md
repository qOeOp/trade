# TrialFamily rangex-v2: hourly box fades and breaks by asset character, with enough boxes to decide

Written before `rangex2/run.py` is run on any data. Supersedes rangex-v1's design, whose daily boxes were too rare
(1-7 trades per asset).

## Assets and bars (1h boxes for every asset)

| Class | Assets | Source | Cost per side |
| --- | --- | --- | --- |
| FX | EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF | FXCM hourly | 0.005% |
| metals / oil | XAUUSD (gold), XAGUSD (silver), BRENTCMDUSD (Brent) | Dukascopy hourly | 0.02% |
| crypto (reference) | BTC, ETH | Binance hourly | 0.06% |

- **FX 1h unread:** FX 4h boxes were read in range-v1, but FX 1h boxes have never been scored.
- **Periods:** the formation period is 2018-2021 and the test period 2022-01 to 2026-08, read once.

## Rules (unchanged)

- **Box and trades:** range-v2 boxes on 1h bars. FADE is range-v2 C (rejection close at an edge) and BREAK is range-v3
  X1 (close beyond an edge). Each runs for 30 bars, stop first.
- **Control:** each trade against 20 random entries matched on year, side, stop in ATR and target in R.
- **Character:** an asset's HOLD is, over the formation period, the share of first box-edge tests that reached the box
  middle before a close 1 ATR beyond the edge (range-v6 `edge_tests`).

## Tests

- **T1, reported:** the Spearman correlation across the 11 assets between formation HOLD and test FADE edge.
- **T2, decided:** assets above the median formation HOLD form the range type. FADE holds for the range type when its
  test edge is above zero (95% asset-then-signal bootstrap) and above trend-type FADE edge. BREAK is reported by type.
- **T3, decided (development findings of range-v6 tested out of crypto):** two subsets of test-period FADE events
  pooled over all assets.
  - (a) no squeeze, ATR(14) over ATR(100) at least 0.978 (the range-v6 development cut);
  - (b) against the daily trend: side times the sign of (daily close minus its 50-day mean) at most 0.
  - Each holds when its edge is above zero (95%) and above the complementary subset.
- **Also reported:** oil against gold, FX as a class, metals and oil as a class, and crypto.

## Amendment (before any run): data source for metals and oil

Dukascopy allowed about one request a minute, so its download would have taken five to six hours. The same three
instruments now come from HistData.com free 1-minute bars (Eastern Standard Time, shifted to UTC), resampled to 1h:
XAUUSD, XAGUSD and BCOUSD (Brent). Nothing else changes, and nothing was scored before the switch.
`rangex2/fetch_histdata.py` downloads them.
