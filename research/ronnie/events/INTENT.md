# TrialFamily events-v1: do calendar and macro event windows explain strategy losses?

Written before `events/run.py` exists and before any strategy's trades are split by these windows. The event dates are
fetched from official calendars by `events/fetch_events.py` before any scoring.

## Why

The user asks whether strategies that look weak are weak only around year ends, rate decisions or other events, and
would work if those windows were skipped. A quick diagnostic (not committed) showed the trap: dropping the two worst
calendar months after the fact "improves" every strategy, including falsified ones. On the box fade, months chosen on
2018-2022 left the 2023-2026 result still negative (-0.039R to -0.008R). So the windows here are fixed in advance from
external calendars, chosen for an a-priori reason (volatility and liquidity shocks), and tested against skipping the
same number of random trades.

## Event windows (UTC calendar days of the entry)

| Id | Window                                                                                   | Source                                     |
| -- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| E1 | FOMC: the decision day, the day before and the day after (scheduled and unscheduled)     | federalreserve.gov FOMC calendars           |
| E2 | CPI: the release day and the day after                                                   | ALFRED CPIAUCSL vintage dates, one per month (the last vintage of each month) |
| E3 | month turn: the last two and first two days of each month                                | calendar                                   |
| E4 | year end: 20 December to 5 January                                                       | calendar                                   |
| M1 | the two worst calendar months chosen on development, applied unchanged on the holdout    | the development data                        |

BTC halvings (2020-05-11, 2024-04-20) are reported descriptively only: two events cannot support a rule.

## Strategies and trade logs (reused unchanged)

| Strategy | Log                                         | Score                 | Development / holdout                       |
| -------- | ------------------------------------------- | --------------------- | ------------------------------------------- |
| TREND    | `trend/trades.csv.gz` (T0)                  | R minus control       | 17 majors 2018-2022 / 20 coins 2023-10 to 2026-08 |
| B1       | `exits/trades.csv.gz` kind B1, X0           | R (no control logged) | 17 majors 2018-2022 / 20 large caps 2023-2026 |
| BOX      | `exits/trades.csv.gz` kind BOX, X0          | R                     | as B1                                       |
| FADE     | `range6/events.csv.gz`                      | R minus control       | 17 majors 2018-2022 (1h+4h) / 20 large caps 2023-2026 (1h) |
| O3       | `oversold/events.csv.gz` variant O3         | R minus control       | 17 majors 2018-2022 / 37 large caps 2023-2026 |
| SHORT    | `short/events.csv.gz` variants S0-S2        | R minus control       | 17 majors 2018-2022 / 37 large caps 2023-2026 |

## Test

For each strategy, event and set: the skip filter drops the trades whose entry day is inside the window. Its gain is
the mean score of the kept trades minus the mean of all trades. The null shuffles the in-window flags within each coin
(2,000 permutations), so a random skip of the same number of trades from the same coins. The p-value is one-sided:
the share of permutations whose gain is at least the observed gain.

## Decision

- **A skip filter is adopted for a strategy** when its gain is positive with p < 0.05 on development and again on the
  holdout. With 30 strategy-event pairs, about 1.5 pass one set by chance; passing both sets at 0.05 is the bar
  (about 0.075 false passes expected over all pairs).
- **A falsified strategy is rescued** only if a filter is adopted for it and the kept trades' score has a 95% interval
  above zero on the holdout (coin-then-trade bootstrap).
- Also reported, descriptive: the in-window and out-of-window means for every pair; the opposite reading (in-window
  trades better, p from the other tail); the halving windows (plus or minus 30 days).
