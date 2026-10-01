# TrialFamily range-v4: unchanged replication of the 4h box breakout on large caps

Written before `range4/run.py` exists or any signal below is scored. Crypto only.

## Rule (exactly range-v3 X1 on 4h bars, nothing changed)

- **Box:** the range-v2 box, known at the bar before the signal bar.
- **Signal:** the first close beyond a qualified box's edge. Entry is at the next open, in the break's direction.
- **Exits:** the stop is the box midline, the target entry plus or minus the box width, and the time limit 30 4h bars.
- **Costs and control:** 0.06% per side, stop first. Each signal is compared with 20 random entries of the same year,
  side, stop in ATR, target in R and time limit.

## Data: large caps only, all unread for this rule

- **The 17 majors** (BTC, ETH, BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM, FIL), from
  2023-01 to 2026-08. range-v2 read this period for box fades, but no breakout rule has been scored on it.
- **Twenty further large caps:** NEAR, UNI, AAVE, ICP, APT, ARB, SUI, OP, INJ, TIA, SEI, PEPE, SHIB, HBAR, ALGO, FET,
  WLD, IMX, STX and LDO. Each runs from 2023-01, or from its listing, to 2026-08.
  - They are the larger coins of a 2024-01 and 2026-08 archive coverage check.
  - Earlier families used some of them for other rules, never for this one.

## Decision (read once)

- **Holds:** when the R-minus-control interval (95%, coin-then-signal bootstrap) over all 37 coins is above zero.
- **Also reported:** the 17 majors and the 20 large caps apart, BTC, ETH and SOL individually, and by year.
