# Forward plan: decision dates and admit/kill criteria

Fixed on 2026-10-01, before any forward outcome exists. It closes retrospective flaw 4 (forward records without a
decision date or criteria). Thresholds come from `loop/forward_plan.py` (`loop/forward_plan.txt`): 20,000 block-
bootstrapped 52-week paths (4-week blocks) of each candidate's backtest weekly stream.

"Admit" here means only "recommended to the user as a proposal". No candidate reaches paper or live execution
without the user's explicit authority (AGENTS.md); this plan widens nothing.

## Dates

- **Interim, 2027-04-01:** kill checks only; nothing is admitted.
- **Decision, 2027-10-01:** the kill checks plus the admit criteria below.
- **At any daily run:** a kill threshold crossed ends the candidate's record (it is kept, marked killed, not deleted).

## Candidates

| candidate | record | kill (any time) | admit at 2027-10-01 | years to decide at half the backtest Sharpe |
| --- | --- | --- | --- | --- |
| Book T (B3, box_break, trendline_time, oversold_idio; equal risk) | built from the component records | drawdown beyond the backtest 99th percentile (-8.0% at 10% volatility), or a 52-week sum below the 1st percentile (+0.6%) | Sharpe above 0 and drawdown within the 95th percentile (-6.2%) | 2.6 |
| B3 Donchian book | `trend/forward/b3_weights.csv` | drawdown beyond -9.3% | Sharpe above 0 and the B3 - B1 difference above 0 | 5.8 |
| K1 carry | `carry/forward/` | 52-week return per notional below +1.5% (the 1st percentile of 2023-2026) | 52-week return above +2.4% (the 5th percentile) after costs on capital | 0.7 |
| T0 daily trend | `trend/forward/` | none of its own; it is the comparison for B3 | not a candidate alone | - |
| box_break, trendline_time, oversold_idio | `combo/forward/signals.csv` | none alone; components of book T | not candidates alone | 5.7, 3.9, 19 |
| B1, b1_time, trendline, ridge, oversold_o3 | `combo/forward/signals.csv` | comparisons only | not candidates | - |

## Known limits, stated now

- **K1 is already at its kill line.** Its 2025 and 2026 holdout years returned +1.4% and +0.2% per notional, below the
  +1.5% threshold; the bootstrap ignores the decay. A first forward year below +1.5% kills it, which is the expected
  outcome unless funding regimes return.
- **No candidate except K1 can be confirmed in one year.** The book needs about 2.6 years at half its in-sample Sharpe.
  The 2027-10-01 decision is therefore "consistent with the backtest, keep recording" or "killed", never "proven".
- **The 4h records ran once a day until 2026-10-01.** Signals were logged up to 24 hours late, and those whose stop or
  target had already traded were voided (about half). From 2026-10-01 16:18 UTC, `combo/forward.py` runs every 4 hours
  in its own routine (the daily routine no longer runs it), so the latency is at most about 4 hours. Records logged
  before then are kept, marked by their logged_at time, and the book's scorer starts from the first 4-hourly run.
- **Different coins.** The combo record runs on BTC, ETH and 15 holdout coins; B3 runs on the 17 iteration majors.
  The book mixes them, as the backtest did not. This is stated, not fixed.
- **The scorer for book T** (weekly streams from matured, committed records, scaled as in N-2) is written at the
  interim date, from code frozen in `loop/ensemble.py`, before any record is read for it.

## Sequential rule (CRITERIA section D), added 2026-10-01

The fixed decision date stays. In addition, each candidate's weekly forward returns feed Wald's sequential test (H0:
Sharpe 0; H1: half the backtest Sharpe; alpha 5%, power 80%; bounds +2.77 and -1.56). Expected time to the scale-up bound
if the strategy works:

| candidate | backtest Sharpe | if the live Sharpe equals the backtest | if it is half the backtest | fixed-length test at half |
| --- | --- | --- | --- | --- |
| Book T | 2.04 | 0.9 years | 3.7 years | 5.9 years |
| F-2 | 1.66 | 1.4 | 5.5 | 9.0 |
| D-1 | 1.37 | 2.0 | 8.1 | 13.2 |
| B3 | 1.37 | 2.0 | 8.1 | 13.2 |
| B1 | 0.97 | 4.1 | 16.2 | 26.3 |
| C-6 | 0.76 | 6.6 | 26.4 | 42.8 |

- **The book is the only candidate a forward record can judge in about a year,** which is why gate U is applied to it
  first.
- **Single rules are judged inside the book,** and their own records are diagnostics.

## Candidate CF, the calm-coin filter (added 2026-10-01)

Signals of B1, b1_time, trendline and trendline_time are tagged at scoring time as calm when the coin's 30-day realised
volatility before the signal is at or below the cut-off in `loop/calm_filter.json`. The scorer reports calm and other
signals separately. CF is decided with the others on 2027-10-01 (LOG, "Candidate CF").

## R-1, the role-reversal retest (added 2026-10-02, after its stage-2 pass)

- **Record:** `roleflip/forward.py` logs resting limit orders at each daily close; only fills after the log count.
- **Kill:** a sequential-test kill bound crossing, or 30 closed trades with a mean R below zero.
- **Gate U review** (usable at small size, which needs the user's authority) once the forward record is positive with
  at least 30 closed trades.
- **Decision date:** 2027-10-01 with the others.

## R-1 tags from his 2026 video (registered 2026-10-02, forward-only), and L-5c (added 2026-10-03)

- **L-5c double support (`dsup` in `roleflip/forward/orders.csv`):** the R-1 level lies within 0.5 ATR of a broken,
  retested trend line (loop L-5, development +0.091 [+0.004, +0.176] against +0.018 for moved lines). Decided with W
  and F on 2027-10-01, Holm over the three.


Computed at scoring time from data before each order; every R-1 order is still recorded and scored.
- **W (weekly regime):** a long is aligned when the last closed weekly close is above the weekly Bollinger middle band
  (20-week mean); a short when it is below.
- **F (Fibonacci confluence):** the broken level lies within 0.25 daily ATR of the 0.382, 0.5 or 0.618 retracement of
  the latest daily impulse (from the last confirmed order-3 pivot low to the highest close since, mirrored for
  shorts).
- **Decision on 2027-10-01:** for each tag, the forward edge of tagged orders minus untagged orders, week-clustered,
  with Holm over the two. A tag is adopted only if its interval is above zero; otherwise it is reported and dropped.
  Neither tag is tested on 2018-2026 data, because those years were read for R-1.

**R-1u (2026-10-02):** the official R-1 record is the corrected rule, with one open trade per coin and the slot freed at
the exit, the slot going to the first fill (LOG, "R-1 fill-order fix"). The 60-day-slot version is dropped. R-1x is
(zone cap 0.5, buffer 0.25, 1.5R), the X-R1 plateau choice after that fix. Gate U review comes at 30 closed R-1u trades with a positive mean, or at a
sequential scale-up crossing, whichever is first.
