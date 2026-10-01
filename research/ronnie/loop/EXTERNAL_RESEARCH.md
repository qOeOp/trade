# External research per strategy line (protocol amendment 8)

Literature and practitioner sources gathered by six parallel research subagents, one per strategy line. Each section
gives the sources (rule, claimed result, evidence quality) and the testable hypotheses. Claimed results are priors,
never evidence. The agent's own synthesis and the hypotheses chosen for loops are at the end.

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
