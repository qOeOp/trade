# Acceptance and closure criteria

Written on 2026-10-01 at the user's request: when is a strategy fully developed, and when is a family closed
without discarding something of value? Every rule below cites its source. Citations were verified against primary or
author-hosted pages by a research subagent; "abstract" marks the ones seen only in an abstract. Where a rule is the
agent's own choice, it says so.

## Sources

| key | citation | what it gives us |
| --- | --- | --- |
| AHM | Arnott, Harvey and Markowitz (2019), "A Backtesting Protocol in the Era of Machine Learning", *Journal of Financial Data Science* 1(1):64-74 | A seven-point protocol: hypothesis before research; count every trial; data rules fixed in advance; no out-of-sample iteration ("true out-of-sample tests are only possible in live trading"); minimal tweaks; simplest specification; a culture that accepts most tests fail |
| HLZ | Harvey, Liu and Zhu (2016), "...and the Cross-Section of Expected Returns", *RFS* 29(1):5-68 | A new factor "needs to clear a much higher hurdle, with a t-statistic greater than 3.0" |
| HL15 | Harvey and Liu (2015), "Backtesting", *JPM* 42(1):13-28 | A Sharpe haircut for multiple testing that is non-linear: a marginal Sharpe after many trials can be cut to zero, a strong one loses little. "It is always a mistake to use the 50% adjustment" |
| HL20 | Harvey and Liu (2020), "False (and Missed) Discoveries in Financial Economics", *JF* 75(5):2503-2553 (abstract) | Type I and Type II errors both matter. Thresholds should weigh false discoveries against missed ones, and current methods lack power |
| DSR | Bailey and Lopez de Prado (2014), "The Deflated Sharpe Ratio", *JPM* 40(5):94-107 | A Sharpe ratio deflated for the number of trials, their Sharpe variance, sample length, skew and kurtosis |
| MTRL | Bailey and Lopez de Prado (2012), "The Sharpe Ratio Efficient Frontier", *Journal of Risk* 15(2) | Minimum Track Record Length; the Probabilistic Sharpe Ratio |
| PBO | Bailey, Borwein, Lopez de Prado and Zhu (2017), "The Probability of Backtest Overfitting", *J. Computational Finance* 20(4):39-69 | CSCV estimate of the probability that the in-sample best configuration underperforms out of sample |
| RW | White (2000), *Econometrica* 68(5); Hansen (2005), *JBES* 23(4); Romano and Wolf (2005), *Econometrica* 73(4) | Data-snooping tests of the best of many rules. Romano-Wolf is stepwise, controls familywise error, and rejects more false nulls than single-step Bonferroni |
| TOST | Lakens (2017), "Equivalence Tests: A Practical Primer", *SPPS* 8(4):355-362 | Equivalence bounds from a smallest effect size of interest (SESOI). A result is "undetermined" when the interval includes both zero and the bound |
| LO | Lo (2002), "The Statistics of Sharpe Ratios", *FAJ* 58(4):36-52 | SE(SR) is about sqrt((1 + SR^2/2) / T) under IID returns, and serial correlation changes annualisation |
| MP | McLean and Pontiff (2016), *JF* 71(1):5-32 (abstract) | Predictor returns are 26% lower out of sample and 58% lower after publication |
| WCLS | Wiecki, Campbell, Lent and Stauth (2016), *Journal of Investing* 25(3) (abstract) | On 888 algorithms, backtest Sharpe barely predicts live Sharpe (R^2 < 0.025), and more backtesting widens the gap |
| JKP | Jensen, Kelly and Pedersen (2023), "Is There a Replication Crisis in Finance?", *JF* 78(5):2465-2518 | Hierarchical shrinkage: judged jointly, most factors replicate |
| CARVER | Carver (2017), "Some more trading rules", qoppac.blogspot.com | Dropping weak ("dud") rules after seeing results is in-sample fitting; keep plausible rules in the ensemble |
| CFM | Jordan (CFM), "Systematic Investing on a Global Scale", *The Hedge Fund Journal* (2015) | A new strategy goes live "at 10% of its eventual target allocation", because of out-of-sample decay and code risk |
| EVANS | Evans (2010), "Mutual Fund Incubation", *JF* 65(4):1581-1611 | Incubation records are a selected sample; the survivors overstate later results |

## The smallest effect of interest (agent's choice, stated)

- **Per-trade timing rules:** SESOI = +0.10R over matched random entries.
  - Below it, the edge is within the uncertainty of costs and slippage (0.12% round trip is 0.05-0.1R on typical 4h
    stops).
  - A forward record cannot detect it in any useful time (`loop/FORWARD_PLAN.md`).
- **Books:** SESOI = a Sharpe difference of 0.3 against the comparison book (buy-and-hold, the regime book or cash).
- The user may change either value; a change applies to every family at once, never to one.

## A. Acceptance: when a strategy is fully developed

A strategy moves up one stage at a time; skipping a stage is not allowed. "Developed" is stage 5, and even then real
capital needs the user's explicit authority (AGENTS.md).

| stage | evidence required | source |
| --- | --- | --- |
| 0 Registered | Mechanism and economic rationale; an outside source (academic or practitioner) or the reason none exists; SESOI; falsifier; the list of credible variants; the trial counter started | AHM 1-2; RETROSPECTIVE item 8 (spend rigour by prior) |
| 1 Developed in sample | Edge >= SESOI with a week-clustered interval above zero; a beta check against random entries; a loss decomposition; with several variants, PBO below 0.5 and the variant count computed from the grid | AHM 2, 4; PBO; workflow notes 25, 50 |
| 2 Holdout, read once | Read by the gatekeeper on data the lineage never touched. Pass: interval above zero and estimate >= SESOI after deflation across the reads of that batch by Holm or Romano-Wolf, not order-dependent Bonferroni. Equivalent-null: the interval's upper bound below SESOI, which kills the strategy. Inconclusive: anything else, which parks it and allows stage 3 | RW; TOST; RETROSPECTIVE flaw 8 |
| 3 Forward incubation | A pre-declared decision date and kill thresholds; a length from MinTRL at a haircut Sharpe; the same order types and cadence as the backtest; every registered forward candidate reported, not only the survivors | MTRL; AHM 4; EVANS; FORWARD_PLAN |
| 4 Pooled evidence | Holdout plus forward (never the development data) reach t >= 3, or DSR >= 0.95 with N set to the lineage's whole trial count | HLZ; DSR; HL15 |
| 5 Developed | After a 26-58% decay haircut, the estimate is still >= SESOI. The implementation is the backtested strategy (one code path, costs, funding, margin). The proposal to the user names a starting size, as a fraction of target in the manner of CFM | MP; WCLS; CFM |

Why stage 4 pools evidence: by LO's arithmetic, a true Sharpe 1 book needs about 8 years for t = 2.8 and about 15
years for t = 3 plus power. No single slice of 2018-2026 can carry that, so the bar is met by accumulating independent
evidence, not by loosening it.

## B. Closure: when a family is closed

A failed significance gate alone never closes anything (HL20; TOST: absence of evidence is not evidence of absence).
Every family carries one of five statuses:

| status | condition | what happens |
| --- | --- | --- |
| **Closed** | (a) Equivalence: every credible variant that ran has an upper bound below SESOI on data not used to select it (TOST); or (b) mechanism falsified: its testable implication fails where it should be strongest, on a test whose detectable edge at 80% power is below SESOI, and the registered variants are exhausted | Not restarted without a new mechanism |
| **Parked** | Inconclusive: the estimate's interval spans zero and SESOI, and the detectable edge exceeds SESOI | The record states the data needed (trades, years or coins) and a revisit trigger. It may sit in an ensemble at small weight when costs are low (CARVER), but it never counts as evidence of skill |
| **Absorbed** | The mechanism is carried by another line, so a separate test adds nothing | Points to the line that carries it |
| **Immaterial** | The filter or split touches under 10% of trades, so no result could change a decision | Closed as a filter; the mechanism itself keeps its status |
| **Active** | Positive at stage 1 or above | Follows the acceptance ladder |

Guards against wrongful closure:
1. **Run the closure audit before closing:** a week-clustered interval and the detectable edge for every loop of the
   family (`loop/closure_audit.py`). Coin-clustered intervals are too narrow, which makes wrongful closure more likely.
2. **Retest each positive near-miss on new coins before closing.** A8 was closed this way (A8x); B-5 was parked.
3. **Judge the family on its credible variants jointly** (JKP, RW), not each one in isolation; a family of five
   inconclusive positive variants is a parked family, not five closures.
4. **Check the objective.** A rule that fails "edge over random" but earns its return from trend exposure is absorbed,
   not closed (Family B into the trend book; RETROSPECTIVE "misleading objective").
5. **Prior and rigour.** A low-prior idea gets a cheap kill test, but the closure condition is the same for all.

## How the criteria change the protocol

- PROTOCOL gate statuses gain "equivalent-null" and "inconclusive", next to pass and fail.
- Holdout deflation moves from order-dependent Bonferroni to Holm across each batch of reads.
- Registration adds SESOI, the credible-variant list and the computed variant count.
- STRATEGIES.md shows each family's status (active, parked, absorbed, immaterial or closed) instead of a single
  "falsified" list.
