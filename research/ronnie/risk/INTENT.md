# TrialFamily risk-v1: can position rules cut the drawdown of the crypto book without cutting its return?

Written before `risk/run.py` exists.

## Base

The trades are those of `combo/portfolio.py`: B1, trendline_break_strong and line_break_ridge on 17 coins, with the
same fills, fees, funding, 3x notional cap and at most 10 positions. The base book (V0) risks 0.5% of equity per trade
with one position per coin and strategy. That book lost 76% peak to trough.

## Variants (all fixed now)

| Id  | Rule                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------- |
| V1  | one position per coin: signals of several strategies on one coin, side and bar merge into one trade (priority B1, trendline, ridge); no second trade on a coin while one is open |
| V2  | V1, plus total open risk at most 3% of equity and at most 4 open positions on one side                         |
| V3  | V1, plus confidence size: risk x 0.5 against the daily trend (close vs SMA200 of closed daily bars), x 1.0 with it; x 1.5 more when two or three strategies agree on that coin, side and bar |
| V4  | V1, plus drawdown brake: risk x 0.5 while equity is more than 15% below its peak, x 0.25 more than 30% below      |
| V5  | V1, plus volatility target: risk x clip(1.5% / trailing 30-day daily volatility of the book, 0.25, 1)           |
| V6  | V3 and V4 together                                                                                            |

## Evidence

- **Periods:**
  - design runs 2018-01 to 2022-12;
  - check runs 2023-01 to 2026-09.
  - The book's aggregate check-period return has already been seen (`combo/portfolio.txt`). No variant has.
- **Per variant and period:** CAGR, max drawdown, daily Sharpe, Calmar (CAGR over max drawdown), and max drawdown with
  daily returns scaled to 30% annual volatility.
- **Confidence inputs:** before sizing, the trade-level average R by daily-trend alignment and by strategy agreement
  is reported per period. This shows whether the inputs carry information at all.
- **Decision:** a variant is adopted only if it beats V0 on both Sharpe and Calmar in both periods. When several do,
  the simplest is adopted.
- **Status:** these coins were used before, so an adopted rule is still a working rule, and future bars are its test.
