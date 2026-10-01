# TrialFamily carry-v1: market-neutral funding carry and funding as a positioning signal

Written before `carry/run.py` exists or any funding series is scored. Crypto only, Binance USD-M perpetuals against
Binance spot, daily resolution.

## Why

short-v1 found no short rule that holds, and the bear-market defence of the books is cash. A position that earns in
either regime is the market-neutral cash-and-carry: long spot and short the perpetual, collecting funding while
longs pay shorts. The literature reports large and persistent crypto carry, for example the futures basis averaging
double digits a year and predicting returns (Schmeling, Schrimpf and Todorov, 2023, "Crypto Carry"). Funding extremes
are also read as crowding: high funding marks crowded longs.

## Mechanics

- **Hedge return per day, per unit of notional:** spot return minus perpetual return plus the funding received by the
  short (the sum of that day's funding settlements). It is close to the funding plus the change in the spot-perp basis.
- **Costs:** 0.10% per side on spot plus 0.05% per side on the perpetual, so 0.30% for opening and closing a hedge.
- **Capital:** returns are on the hedge's notional. A real hedge also posts perpetual margin, so at 1x on the short
  leg the capital is about twice the notional; annual returns on capital are about half those reported.

## Variants (decisions at 00:00 UTC on data up to that time)

| Id | Rule                                                                                                          |
| -- | ------------------------------------------------------------------------------------------------------------- |
| K0 | always on: the hedge on every coin, opened once (descriptive baseline of the carry level)                     |
| K1 | conditional: open a coin's hedge when its trailing 7-day mean funding per 8 hours is at least 0.01%; close it when the trailing 3-day mean falls below 0 |
| K2 | cross-sectional: each Monday, hedge the top fifth of coins by trailing 7-day funding for one week; turnover is charged |
| P1 | positioning (directional, descriptive plus one test): the perpetual's next 7-day return after a coin's trailing 7-day funding is in the top or bottom decile of its own trailing 365 days |

## Data

`data.binance.vision`: monthly funding-rate archives (from 2020-01) and daily klines of the perpetual and the spot
pair. Symbols: the base against USDT; PEPE and SHIB perpetuals are the 1000-unit contracts, which leaves returns
unchanged.
- **Development:** the 17 majors, 2020-01 to 2022-12.
- **Holdout:** the 17 majors and the 20 large caps of range-v4, 2023-01 to 2026-08, read once.

## Decision

- **K1 holds** when its net daily return per coin-day held, summed into an equal-weight portfolio of the held hedges,
  is above zero at 95% (weekly block bootstrap) on development and on the holdout, and its annualised net return
  beats K0 on both.
- **K2 holds** when its weekly net return minus the equal-weight hedge of the whole universe in the same weeks is
  above zero at 95% (week bootstrap) on both sets.
- **P1:** the top-decile minus bottom-decile next 7-day return is tested the same way (coin-then-event bootstrap);
  a negative value at 95% on both sets means high funding predicts lower returns (crowding).
- Also reported, descriptive: per-year carry, the worst week, and the share of days with negative funding.
