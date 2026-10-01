# TrialFamily range-v3: box trading redesigned from the failure diagnosis and the literature

Written after `range3/diagnose.py` (development data only) and before any variant below is coded or scored. Crypto
only.

## What the first two rounds missed

`range3/diagnose.txt` uses the 17 majors over 2018-2022 only.
- **Edges break:** after price reaches a box edge, the box breaks on that same side within 30 bars 48-70% of the time,
  and on the far side only 6-10%. Price reaches the far edge 10-14% of the time.
- **Limit fills are swept:** 90% are stopped, most on the fill bar itself.
- **No exit rescues the fade:** nine stop and target combinations (stop 0.5-2 ATR beyond the edge, target a quarter of
  the box to the far edge) are all negative.
- **Reading:** a test of a box edge is more often the start of a break than a turning point, as with the breakouts that
  hold elsewhere in this research.

## What the literature says

- **Reversal exists, but at 15 minutes:** directional reversal is pervasive in crypto at 15-minute horizons, at about
  1.3 bp gross per trade, too small for retail costs. It grows after moves driven by aggressive taker flow
  (arXiv 2608.21888).
- **Reversal reflects overreaction:** intraday return predictability in Bitcoin includes a reversal component linked
  to overreaction to non-fundamental information (Wen et al., 2022, North American Journal of Economics and Finance).
- **Regime tests:** practitioners separate mean-reverting from trending regimes with the variance ratio, the Hurst
  exponent and ADX.

## Variants (fixed)

The boxes are those of range-v2 (60 bars, 4-15 ATR wide, two touches per edge, sideways, on 1h and 4h). A box is known
at the bar before the signal bar.
- **X1, box breakout (from the diagnosis), 1h and 4h.**
  - **Signal:** the first close beyond a qualified box's edge. Entry is at the next open, in the break's direction.
  - **Exits:** the stop is the box midline, the target entry plus or minus the box width (measured move), and the time
    limit 30 bars.
- **X2, overreaction fade (from the literature), 1h.**
  - **Signal:** a 1h bar with body at least 2.5 ATR(14, 1h) and volume at least 3 times the prior 20-bar mean, while a
    4h box is active. Entry is at the next open, against the bar.
  - **Exits:** the stop is 0.25 ATR beyond the bar's extreme, the target a 50% retracement of its body, and the time
    limit 12 bars.
  - **Also reported:** X2-any, the same fade without the box condition (not decided).
- **X3, regime-gated box fade, 1h and 4h.** The range-v2 C entry, kept only when two regime conditions hold at the
  signal bar:
  - the variance ratio VR(4) of 1h log returns over the prior 720 1h bars is under 0.9;
  - ADX(14) on 4h bars is under 20.

## Test

- **Scoring:** every signal against 20 random entries on its timeframe, matched on year, side, stop in ATR, target in R
  and time limit. Costs are 0.06% per side, stop first, via `mtf/run.py` walk.
- **Development:** the 17 majors, 2018-2022.
- **Holdout (never used by any family):** STRAX, LSK, CTK, GTC, REQ, FIDA, DEXE, AUCTION, DIA, ONG, RAY, RIF, WAXP and
  XVG against USDT. These are the coins of a 2022-01 and 2026-08 archive coverage check not in any earlier set
  (SFP dropped, used in volume-v1). The holdout runs 2022-2026 and is read once.
- **Decision (per variant and timeframe):** holds when the R-minus-control interval (95%, coin-then-signal bootstrap) is
  above zero on both sets.
