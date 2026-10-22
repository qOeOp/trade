# Report template

The fixed sections of a report you write on one run or on a comparison of two runs, in this order.
Values come from `replay report --trial-id RUN` and `hypothesis compare --bundle BUNDLE --trial-id
RUN`; detail tables you compute (`nautilus-report-analysis`) go under their section.

| Section | Single run | Comparison |
|---|---|---|
| Identity and eligibility | Run identity, economic-evidence eligibility and its reasons | Both identities, comparability |
| Test result | — | Effect, interval, p and the test conditions |
| Performance | Annual return, MARK maximum drawdown, plan win rate, Sharpe | Both sides and the difference |
| Profit sources | Price, commissions, funding, unrealized at the end | Difference of the four |
| Size and sizing timing | Average exposure, return per unit of exposure, level and timing terms, exposure in rising and falling months, annual return over drawdown | Difference of each |
| Costs | Taker share, breakeven fee multiple | Breakeven fee multiple |
| Instruments and direction | Top five contracts' share of absolute PnL, long and short apart | Difference of the same |
| Market exposure | Slope and intercept against the equal-weight basket and the BTC perpetual | Slope difference and intercept difference |
| Periods | Share of profitable months, remainder after removing up to five daily log contributions in the total's direction (largest for nonnegative total, smallest for negative total) | Share of months won, same trimming applied to paired daily log differences |
| Volatility regimes | High- and low-volatility days: count, mean and summed log return | Difference of the same |
| Trade structure | Cycles, win rate, average win and loss, expectancy per trade, holding time, exit categories | Difference of the same and the split of the expectancy difference |
| Trade pairing | — | Coverage, removed and added trades, difference on the same opportunity |
| Drawdown | Maximum drawdown, duration in days, dominant contract in the drawdown interval | Difference of the same |
| Prediction check | — | Whether each registered prediction has the same sign; the interaction when one was declared |
| Limitations | Deduplicated list of limitations | Both sides' limitations, merged and deduplicated |

Write every run or comparison report with all these sections in this order. Keep an empty
section and write why it is empty; never drop one.

The product's JSON reports are the working evidence. This template does not require an HTML
report or a regenerated overview on every iteration; create presentation files when needed.
