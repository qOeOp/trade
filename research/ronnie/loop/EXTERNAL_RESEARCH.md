# External research per strategy line (protocol amendment 8)

Literature and practitioner sources gathered by six parallel research subagents, one per strategy line. Each section
gives the sources (rule, claimed result, evidence quality) and the testable hypotheses. Claimed results are priors,
never evidence. The agent's own synthesis and the hypotheses chosen for loops are at the end.

## 1. Funding carry (K1)

Sources:
- **He, Manela, Ross and von Wachter, "Fundamentals of Perpetual Futures"** (arXiv 2212.06888).
  - **Rule:** trade the deviation of the perpetual from its no-arbitrage price; close when it returns to zero.
  - **Claim:** Sharpe 11.65 (BTC) to 19.76 (ADA) before costs; BTC 3.27 at retail costs.
  - **Decay:** mean deviations shrank after 2022 (BTC 0.69% to 0.17%), partly attributed to Binance portfolio margin
    (more arbitrage capital).
  - **Momentum link:** past positive spot returns predict a higher premium.
  - **Quality:** 5 coins, 2020-2024, costs modelled, no holdout.
- **Schmeling, Schrimpf and Todorov, "Crypto Carry"** (BIS WP 1087; Management Science). Carry is driven by small
  investors' trend-chasing and scarce arbitrage capital. High carry predicts crashes, and the arbitrage's risk sits in
  margin spikes and liquidations of the short leg. Predictive regressions, not a backtest with costs.
- **Christin, Routledge, Soska and Zetlin-Jones, "The Crypto Carry Trade"** (CMU): Sharpe 8.76 for BTC-USDT, likely
  before 2022 and in-sample. Figures are from abstracts only.
- **"Cryptocurrency as an Investable Asset Class: Coming of Age"** (arXiv 2510.14435): carry Sharpe 6.45 over
  2020-08 to 2025-05, 4.06 in 2024, negative in 2025. This confirms that our decay is market-wide.
- **BitMEX Research, Q3 2025 derivatives report:** funding was exactly 0.01% for 78% (BTC) and 88% (ETH) of the
  quarter, the formula's interest anchor. **K1's entry threshold of 0.01% equals that anchor, so K1 enters whenever
  funding is merely pinned and does not filter for excess demand.**
- **Inan (2025), "Predictability of Funding Rates"** (SSRN 5576424): double-autoregressive models beat no-change
  forecasts out of sample (BTC only; abstract only).
- **Chi et al. (2023), Journal of Futures Markets:** basis, momentum and basis-momentum factors in crypto futures,
  2017-2021, in-sample.
- **Presto Labs (practitioner):** lagged funding changes have about zero R-squared for next-week price.

Hypotheses (ranked):
1. **Decompose K1's P&L** (anchor funding, excess funding, basis change, costs) and **enter only on funding above the
   anchor:** at least half of the last 21 settlements above 0.01%, or a 7-day mean of at least 0.015%.
2. **Time entries and exits on the premium index:** enter when its 3-day mean is above 0; exit when the 1-day premium
   goes below 0, instead of using lagged funding.
3. **A momentum gate:** hold only when the 30-day spot return is positive; optionally reduce size when funding is in
   its top 5% (crash and margin risk).
4. **Open-interest growth:** first test it as a forecast of next-week funding beyond an AR(1); use it only if it adds
   R-squared of at least 0.02 out of sample.
5. **An AR-forecast entry:** enter when forecast funding net of amortised costs is positive.

Caveat: none of these reverses the structural decay (more arbitrage capital, portfolio margin, Ethena-type products).

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

## 3. 4h breakouts (box, trend line, B1)

No source tests a 4h crypto breakout filtered by open interest, taker flow or funding; that is an open question.
- **Zarattini and Aziz, "Can Day Trading Really Be Profitable?"** (SSRN 4416622): a QQQ 5-minute opening-range break
  with the stop at the bar's opposite extreme and a 10R target, so in practice a time exit. An independent replication
  (github.com/giovannibrusco/zarattini-2023-orb-qqq) gets Sharpe 1.06 against the paper's 1.12, but net profit reaches
  zero at about 2.2 cents a share of slippage. This supports our time-exit finding and warns that +0.1 to +0.3R edges
  can vanish after costs.
- **Zarattini, Barbon and Aziz, "A Profitable Day Trading Strategy for the U.S. Equity Market"** (SSRN 4729284): the
  opening-range break only on "stocks in play" (abnormal relative activity), Sharpe about 2.4 in-sample. The edge comes
  from choosing the asset on abnormal activity, not from confirming the bar.
- **Zarattini, Pagani and Barbon, "Catching Crypto Trends"** (SSRN 5209907): ensembles across lookbacks reduce
  parameter fragility, which matters for our single 60-bar box.
- **Concretum, "Seasonality in Bitcoin Intraday Trend Trading":** BTC intraday trend returns cluster from Sunday about
  19:00 New York through the next day, 2018-2025, gross, with no out-of-sample test.
- **Shen, Urquhart and Wang (2022), "Bitcoin intraday time-series momentum"** (Financial Review): the first half hour
  predicts the last, out of sample, more strongly on high-volume or high-volatility openings.
- **"The Quarter-Hour Effect"** (arXiv 2607.09426): order imbalance at the start of clock periods predicts returns over
  the next 4-12 hours on six Binance perpetuals. A new preprint, abstract only.
- **Background, Hudson and Urquhart (2021):** about 15,000 rules on crypto; channel breakouts did best, but there was no
  out-of-sample predictability for Bitcoin (snippets only).

Hypotheses (ranked):
1. **Taker-flow confirmation:** the breakout bar's taker buy/sell ratio in the direction of the break and in the top
   tercile of its trailing 90 days (metrics, 2021 onward).
2. **Rising against falling open interest on the break:** rising open interest means new positions; falling means a
   squeeze that runs out of fuel (it may explain the 77% that return inside the box).
3. **Funding as a crowding veto:** skip long breaks when funding is above its trailing 90th percentile.
4. **A session window:** breaks closing between Sunday 23:00 and Monday 23:00 UTC against the rest.
5. **Ensemble box lookbacks (20/40/60/120) with a time exit**, sized by the number of boxes broken.

## 4. Capitulation reversals (C-6 / O3)

No primary study tests a capitulation measured against BTC on daily bars, or an open-interest flush as a bottom
signal. The closest evidence:
- **Blitz, Huij, Lansdorp and Verbeek (2013), "Short-term residual reversal"** (Journal of Financial Markets).
  Reversal ranked on factor residuals earns about 3x the risk-adjusted return of reversal on raw returns. Equities.
  For us: a beta-adjusted residual may beat the plain coin-minus-BTC difference.
- **Kitron and Wengrowicz, arXiv 2608.21888:** 15-minute reversal in 90% of 183 Binance pairs, concentrated after
  aggressive taker flow; order-book depth adds nothing. It reportedly is mostly idiosyncratic, but about 1.3 bp gross,
  not tradable. Taker volume is the conditioning variable.
- **Caporale and Plastun, "Price overreactions in the cryptocurrency market":** an unconditional counter-move after
  overreaction days was not profitable (4 coins, early data). This is consistent with our filters carrying the edge.
- **Jia, Liu and Yan (2021), Finance Research Letters:** extreme positive returns drive the higher-moment effects;
  extreme negative returns do not. Reversal after the worst days is weak unconditionally.
- **Farag, Luo, Yarovaya and Zieba (2025), "Returns from liquidity provision in cryptocurrency markets"** (Journal of
  Banking and Finance). Short-term reversal pays as a liquidity-provision premium, higher when liquidity is scarce
  and stress is high. This explains why our trades cluster in stress weeks.
- **"Perpetual Futures and Basis Risk" (AEA 2026, preliminary, unverified):** forced liquidations are common, and
  perpetual drawdowns mean-revert quickly.
- **Practitioner checks (negative):**
  - a BTC funding z-score below -1.5 buy rule is about zero after fees;
  - an "open-interest unwind needs taker-buy confirmation" idea is agent-generated, not evidence;
  - a liquidation-bounce study is synthetic.
  Our negative-funding split (34 trades) has no outside support.

Hypotheses (ranked):
1. **A beta-adjusted residual trigger** (r_coin - beta x r_BTC at most -15%, with a trailing 60-day beta), plus more
   coins (post-2022 listings). Falsified if the edge falls below +0.2R or any gain comes only from added coins.
2. **Open-interest flush confirmation (2021 onward):** require the perpetual's open interest to fall at least 15-20%
   over the drop window. Falsified if the split is 0.3R or less (week-clustered).
3. **Taker-flow reversal on the signal day:** the taker buy/sell ratio over the last 4-8 hours above 1 after a
   seller-dominated session. Falsified if it removes losers no better than a random filter of the same size.
4. **A 4h event definition, for more independent events:** residual at most -10% over 6-30 bars, at least 2.5x volume,
   close in the upper half, held 3-5 days. Falsified if costs erase it or events still fall in fewer than 25 weeks.
5. **Funding as a filter:** last, expected to fail.

Cautions: count the effective sample in independent weeks, not trades (30 trades in 12 weeks is about 12
observations), and fix thresholds before any out-of-sample read.

## 5. Bear-market and short strategies

Sources (SSRN and Wiley blocked direct fetches; "abstract only" marks details from search snippets):
- **Schmeling, Schrimpf and Todorov, "Crypto Carry"** (BIS WP 1087). A high basis predicts crashes and liquidations: +10%
  standardized carry predicts long liquidations equal to 22% of open interest the next month. BTC and ETH only. It
  supports de-risking timing, not standing shorts.
- **Borri, Liu, Tsyvinski and Wu (2025), "Cryptocurrency as an Investable Asset Class"** (arXiv 2510.14435).
  - **Factors:** weekly spreads of 2.6% for momentum (2.1% after 2020), -2.3% for size and -3.5% for value, gross.
  - **Shortability:** the small-coin and momentum legs are mostly not shortable on Binance.
  - **Carry decay:** confirmed.
- **Han, Kang and Ryu, "Time-Series and Cross-Sectional Momentum ... under Realistic Assumptions"** (SSRN 4675565).
  Time-series momentum is strong; cross-sectional momentum is almost non-existent after costs and the intraday
  liquidation of leveraged positions; best Sharpe about 1.5. Cost-aware. Abstract only.
- **Chi, Hao, Hu and Ran (2023), "An Empirical Investigation on Risk Factors in Cryptocurrency Futures"** (Journal of
  Futures Markets). The basis is the strongest cross-sectional predictor, 2017-2021, majors only; strong daily, weaker
  weekly. 2022 is out of sample for it.
- **Howden and Andreev, "Risk-Managed Time-Series Momentum in Crypto Majors"** (SSRN 7115459). 30-day momentum long or
  cash on 7 majors, exposure halved more than 15% below the peak. Claimed out-of-sample Sharpe 1.41 against 0.70 for
  buy-and-hold; maximum drawdown -45% (-28% with the overlay) against -84%. An unrefereed preprint with a possibly tuned
  threshold. Abstract only.
- **Short-horizon mean reversion** (arXiv 2608.21888): 15-minute reversal after aggressive taker flow in 90% of 183
  pairs, but about 1.3 bp gross against 5 bp of costs. A negative control.
- **He, Manela, Ross and von Wachter (2022):** perpetual-spot gaps co-move across coins and shrink over time.
- **Presto Labs:** funding explains same-week returns (R-squared 0.125) but has about zero next-week R-squared on a
  single asset.
- **No rigorous source** was found for open-interest changes or Binance long/short ratios as return predictors; any
  open-interest hypothesis is original research.

Hypotheses (ranked):
1. **A cross-sectional basis/funding long-short, daily and beta-neutral:**
   - long the lowest-funding quintile, short the highest;
   - scored on price return excluding funding and, separately, including it;
   - falsified if the spread is at or below zero out of sample after costs, or negative in 2022.
2. **Long/cash time-series momentum (30-day) with volatility targeting** on majors, earning in bear years by not
   losing. Falsified if its 2022 drawdown is not below half of buy-and-hold's, or its Sharpe is not above buy-and-hold's
   with the lookback fixed in advance.
3. **A funding-extreme crash overlay:** cut longs when BTC's 7-day funding is above its 1-year 90th percentile and open
   interest is up more than 20% in 14 days. Falsified if the next-30-day lower tail and mean in the flagged state are
   no worse than unconditional (from 2021).
4. **An open-interest/price divergence cross-section** (speculative): short coins whose open interest rose most while
   price fell, and long the reverse.

Note: no source documents a profitable directional short in crypto that survives out of sample. Bear years are earned
through relative value, carry and stepping out of the market.

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

## Synthesis: hypotheses chosen for loops (agent)

| line | first loops | data | status |
| --- | --- | --- | --- |
| Carry K1 | decomposition; entry band above the anchor (K1b) | funding | done: K1b not adopted; decomposition explains the decay |
| Trend | book comparison (T-1); point-in-time universe (T-2); clean read of the ensemble | daily OHLCV; universe of all USDT pairs | T-1 done (ensemble beats the regime baseline); T-2 waits for the universe download |
| Breakouts | session window (diagnosis, now); open-interest and taker-flow splits | metrics | the metrics download is running |
| Capitulation | beta-adjusted residual; open-interest flush; taker-flow reversal | metrics | waits for metrics |
| Bear markets | cross-sectional funding long-short; funding-extreme overlay | funding | queued |
| Ensemble | correlation and effective N, a pre-registered book, then PBO/CSCV, DSR | the five rules' trade logs | queued after T-2 |
