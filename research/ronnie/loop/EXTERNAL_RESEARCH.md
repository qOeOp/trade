# External research per strategy line (protocol amendment 8)

Literature and practitioner sources gathered by six parallel research subagents, one per strategy line. Each section
gives the sources (rule, claimed result, evidence quality) and the testable hypotheses. Claimed results are priors,
never evidence. The agent's own synthesis and the hypotheses chosen for loops are at the end.

## 2. Daily trend following on majors

Sources:
- **Zarattini, Pagani and Barbon (2025), "Catching Crypto Trends: A Tactical Approach for Bitcoin and Altcoins"**
  (SSRN 5209907).
  - **Rule:** long only, an ensemble of Donchian breakouts over lookbacks {5, 10, 20, 30, 60, 90, 150, 250, 360}. Each
    sub-model trails a stop at max(prior stop, channel midpoint). Positions are equal-weighted and the book is sized to
    25% annual volatility (90-day realised, leverage at most 1), over a daily point-in-time top-20 liquid universe.
  - **Claim:** Sharpe about 1.5-1.6, CAGR about 30%, alpha 11-14% a year against BTC, 2015 to 2025-03, net of 10-50 bp.
  - **Quality:** survivorship-free with costs, but the grid and target were chosen on the full period. The rule details
    are from a third-party summary.
  - **Relevance:** the closest public analogue to T0.
- **Babu et al. (AQR, 2020), "You Can't Always Trend When You Want":** trend P&L decomposes into the size of market
  moves, the conversion of moves into profit, and diversification. Weak decades came from muted moves. This explains
  our diagnosis: random entries with a trend exit still earn when big moves exist. Judge conversion against regime
  baselines, not entry timing.
- **Harvey et al. (Man, 2018), volatility targeting:** expect a smaller drawdown more reliably than a higher Sharpe.
- **Ammann, Burdorf, Liebi and Stockl (2022), "Survivorship and Delisting Bias in Cryptocurrency Markets"** (SSRN
  4287573): the bias is 0.93% a year value-weighted and 62% a year equal-weighted (3,904 coins). Our equal-weighted
  17-major book (CAGR +54%) is exposed to exactly this bias.
- **Schmeling, Schrimpf and Todorov (2023), "Crypto Carry"** (BIS WP 1087): carry moves with retail trend-chasing, and
  high carry predicts crashes. The carry Sharpe has decayed since 2024 (reported negative in 2025 in a secondary
  summary). Funding is a crowding signal for trend longs.
- **Liu and Tsyvinski (2021), RFS:** time-series momentum at 1-8 week horizons in BTC, ETH and XRP (in-sample, no costs).
- **Bui and Nguyen (2026), "AdaptiveTrend"** (arXiv 2602.11708): 6h trend, volatility-regime trailing stop, Sharpe
  2.41 on 150+ pairs. Unrefereed, with unclear costs and Sharpe-based selection; an idea source only.

Hypotheses (ranked):
1. **An ensemble of lookbacks, a midpoint trailing exit and portfolio volatility targeting** (source A), against T0 on
   2018-2022 majors and post-2023 coins; also against the same sizing on random entries.
2. **A point-in-time universe** (top N by trailing volume, listed at least a year, delisted coins included).
3. **Benchmarks against regime exposure:** long above the 200-day mean, volatility-targeted, and volatility-targeted
   buy-and-hold (AQR). If T0 does not beat them beyond a block-bootstrap interval, adopt the simpler rule.
4. **Funding or open interest as a crowding gate:** smaller new entries or tighter exits when 7-day funding is above
   its 90th percentile or open interest is up sharply.
5. **A faster signal on post-2023 coins** (20/10 or 4h).

## 6. Weak-signal ensembles, sizing and portfolio-level validation

Sources:
- **Bailey and Lopez de Prado (2014), "The Deflated Sharpe Ratio"** (SSRN 2460551). Corrects a Sharpe ratio for the
  number of trials, their dispersion, skew, kurtosis and sample length. For us: report the DSR of the book's return
  series, with N the effective number of independent configurations tried (clustered), not 5.
- **Bailey, Borwein, Lopez de Prado and Zhu, "The Probability of Backtest Overfitting"** (SSRN 2326253; R `pbo`,
  github.com/esvhd/pypbo). Combinatorially symmetric cross-validation (CSCV): the share of time-block splits in which
  the in-sample best configuration ranks below the median out of sample. For us: it tests book-construction choices
  (weighting, volatility target, overlap rule) on the full history without spending a holdout.
- **Harvey and Liu (2015), "Backtesting"** (haircut Sharpe ratio; Bonferroni, Holm, BHY). Holm or BHY is less strict
  than our Bonferroni and still defensible. Apply the haircut to the ensemble's Sharpe ratio.
- **Harvey et al. (Man Group, 2018), "The Impact of Volatility Targeting"** (SSRN 3175538). It raises the Sharpe ratio
  for risk assets through the leverage effect and cuts left tails in all classes. Strong multi-asset evidence, no
  crypto. Expect a lower drawdown for the 4h book.
- **Lopez de Prado (2016), hierarchical risk parity** (SSRN 2708678). Clusters strategies, then inverse-variance weights.
  The three 4h rules should cluster, capping their combined risk.
- **DeMiguel, Garlappi and Uppal (2009), "Optimal Versus Naive Diversification"** (RFS). 1/N is hard to beat out of
  sample. With noisy edges, the default should be equal risk weights, not fitted weights.
- **Joubert (2022), "Meta-Labeling"** (JFDS; hudson-and-thames code), and AFML chapter 4 on label concurrency and
  average-uniqueness weights. Uniqueness weights fit overlapping 4h entries; a full meta-model is optional and late.
- **Romano and Wolf (2005), stepwise multiple testing**, and Hansen's SPA test. A bootstrap stepdown test that controls
  FWER and uses the dependence between rules; more power than Bonferroni.

Plan proposed (ranked):
1. **Trial count and correlation first:** build daily return streams of the five rules at unit risk, with correlation,
   overlap and bear-period (2018, 2022) correlation, and an effective N by clustering. It falsifies the ensemble if the
   effective N is about 2 or less, or the bear-period correlation is near 1.
2. **A pre-registered book with no fitted weights:**
   - equal risk per cluster (HRP or 1/N);
   - overlapping same-asset, same-direction signals share one capped position;
   - an EWMA volatility target;
   - one cost model with funding.
   It falsifies the ensemble if the book does not beat the best single rule's Sharpe, or its maximum drawdown is not
   clearly below buy-and-hold's.
3. **CSCV/PBO** over 20-50 construction variants with 10-16 time blocks; it falsifies the ensemble if PBO is above
   about 0.5.
4. **Spend the clean holdout once on the frozen book:** DSR with N from step 1, and a Romano-Wolf or SPA p-value against
   buy-and-hold and cash.
5. **Optional:** meta-label sizing with funding, open interest and the volatility regime, counted as new trials.
