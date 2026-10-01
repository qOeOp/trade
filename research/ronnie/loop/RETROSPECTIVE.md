# Retrospective of the research/ronnie R&D process

Written at the user's request after the majors-slice reads. It reviews the R&D process as a whole and compares it with
how traders actually develop strategies and with published R&D agents. It covers the results, the intermediate
artifacts, the hand-offs between stages and the loop itself, and names the gaps, the bugs, and the work that looked
valuable but was not (or the reverse).

## Scale

- **Before the loop:** about 40 trial families (ronnie lines, community lines, ranges v1-v6, timing, filters,
  patterns, MTF, volume, trend, oversold, exits, events, short, gold, carry and others), each with an INTENT.md
  written before its runner.
- **In the loop (`loop/census.csv`):**
  - 36 iteration loops over families A-G;
  - 10 ablations;
  - 10 holdout reads (6 final/reserve, 4 majors);
  - 4 reruns, 1 peek and 1 diagnosis;
  - 7 protocol amendments and 43 workflow notes.

## Results, stated plainly

| Candidate | Evidence | Status |
| --- | --- | --- |
| Carry K1 (conditional funding hedge) | Passed development, holdout and final | The only full pass. Returns are decaying (2025 +1.4%, 2026 +0.2% per notional) and about half that on capital |
| Daily trend on majors | Development strong; holdout +0.12R over random, not significant; portfolio Sharpe 1.26 on survivors | Forward record |
| 4h box break (D-1), trend-line break (F-1/F-2), box-break retest (G-2), idiosyncratic capitulation (C-6) | Positive in several samples; on the majors 2023-2026 slice all "edge positive, interval spans zero" | Forward record (G-2 cannot be tracked) |
| B1 4h momentum | +0.06R over random, replicated thinly | Forward record |
| Everything else | Falsified: Ronnie's and the community's lines, level fades, range fades (v1-v6, E), sweeps, patterns, volume nodes, filters, shorts, event filters, support bounces (A), break continuation over random (B) | Closed |

The realistic size of a timing edge found here is 0.1-0.3R per trade, and none clears a deflated holdout bar alone.

## Real bugs found during the run

1. **Feature-key collision:** features keyed by (time, side) without the coin. It corrupted the tercile attribution of
   20 loops and steered loop A2 (workflow note 17).
2. **An unsatisfiable rule reported as a crash:** daily levels with two-close confirmation could never fire, and the
   failure showed only as a KeyError (note 14).
3. **Attribution used the wrong exit model:** the decomposition re-walked trades without A4's time stop (note 7).
4. **Undefined features printed as findings:** "box age" was always 0, and tied values were split into "terciles"
   (notes 18 and 37).
5. **Comparisons in the wrong unit:** R comparisons across stop designs (note 35). The G-2 versus D-1 gain in R was
   mostly a smaller stop.
6. **Census inflation:** reruns and informal looks were not logged until fixed (notes 24 and 27).
7. **The forward record ran a partial 4h bar:** fixed early in the run.

## Bugs and methodological flaws still present (not fixed)

1. **The confidence intervals are too narrow.** The coin-then-trade bootstrap treats coins as independent, but crypto
   coins move together on the same days. Signals cluster on market-wide days: 3+ coins capitulated on 2018-11-22, and
   61 of 76 C-4 trades had company within a day. Every interval in this research overstates significance to some
   degree. A date- or week-clustered bootstrap is needed, and the survivors should be re-read with it.
2. **Survivorship in the universe.** The 17 majors and the 20 large caps are today's survivors, chosen knowing they
   became large. The iteration tier and the majors slice are both biased upward. A point-in-time universe (top N by
   market cap at each date) is missing.
3. **The forward record is not the backtested strategy.** The routine runs once a day, so 4h signals are logged up to
   24 hours late. The entry is "the first 4h open after logging", and signals whose stop or target already traded are
   voided. Fast strategies are therefore tested with a latency their backtest never had. They should run every 4h, or
   the backtest should model the same delay.
4. **The forward records have no decision date and no criteria.** Nothing says when a forward candidate is admitted or
   killed, or on what evidence. Without that, the forward record is a diary, not a test.
5. **The gatekeeper boundary is prose-enforced.** The same agent wrote the gatekeeper, can read `loop/sealed/`, and
   designed the tiers. The gatekeeper subagents are the same model family, so they share its priors.
6. **The model's own memory is a leak no gatekeeper removes.** The language model was trained on market history; it
   "knows" roughly which coins rallied when. Every hypothesis it proposes is conditioned on that knowledge. Only
   forward data is immune.
7. **Costs are thin.** 0.06% per side, no slippage on 4h market entries at breakouts, a fixed funding charge, and no
   margin or liquidation risk in carry.
8. **Bonferroni stacking across reads depends on order.** The fourth candidate faced 98.75%, the first 95%, for no
   reason but sequence.

## Looked complex, added little

- **Pre-registered families on low-prior ideas** (Ronnie's lines, community lines scraped from TradingView, line
  intersections, Fibonacci). They were rigorous, and their null result was predictable from the literature. The
  rigour was spent where a quick literature check would have ended the question.
- **Thresholdout:** implemented, never used. No candidate ever reached a validation read that could use it.
- **The admissibility rules of the factor ledger:** their main "admissible" factor (BTC's trend) turned out to be beta.
  The beta check did the real work.
- **Seven protocol amendments mid-run.** Each was reasonable, and together they are protocol churn: the rules moved
  while the game was played. Amendments 1 (sample expansion) and 3 (no budget) loosened the protocol after failures.
- **Tercile attribution before the systematic attribution:** mostly noise. It drove A2 and E-3 into dead ends.
- **The majors_trend strategy program:** written and tested in Rust, but it could not be sealed or run in the product,
  so it added no evidence.
- **Iteration-gate passes on the discovery data** (D-1, F-1). They re-found what the data was chosen for and looked
  like progress.

## Looked useless, was valuable (or the reverse)

- **Valuable:** the loss decomposition (stops within 2 bars, MFE before the stop), the beta check, ablations, path
  statistics after breaks, the three-level verdict, the context-separated gatekeeper, and recording predictions before
  runs. Each changed a decision or prevented a false positive.
- **Misleading:** "edge over random entries" as the only objective. It asks whether the entry has timing skill. For a
  trader, a rule that is long in uptrends with a tight risk budget and earns +0.45R a trade (Family B) is valuable even
  when random longs in the same year earn almost as much: that is trend following, and it is what the portfolio
  actually earns. The research declared such rules "no edge". The objective was misaligned with the user's goal, which
  is portfolio return and drawdown against holding or cash.
- **Misleading:** passing the iteration gate after many looks (A8, C-6, F-2) looked like progress. Holdout reads showed
  them to be under-powered at best.

## Against how traders actually develop strategies

What the community does that this research did not:
- **Portfolio first:** combine several weak, uncorrelated edges, size by volatility, and manage the book's drawdown.
  Here each signal was judged alone with fixed R exits. The "positive but insignificant" candidates are exactly what
  an ensemble is for, and no ensemble was built or tested.
- **Risk and position management:** sizing, scaling in and out, and regime-dependent exposure. Only exits were studied
  (exit-v1); sizing was never a research object beyond one book.
- **Execution:** limit orders, slippage, funding, liquidation buffers. The forward harness cannot even hold a limit
  order (note 43).
- **Small live tests:** traders validate with real small size and real fills. Here a paper diary is logged once a day.
- **Crypto-native information:** open interest, liquidations, order-book imbalance, options skew, on-chain flows,
  token unlocks and listing effects. Only funding was touched, and the one thing that fully passed (carry) is from
  that family. The richest seam was the least explored.

## Against published R&D agents

- **RD-Agent(Q)** (Microsoft, NeurIPS 2025): research and development stages with a code agent (Co-STEER),
  factor-model co-optimization, a knowledge base of what worked, and evaluation by IC/ICIR plus portfolio backtests
  (Qlib).
- **AlphaAgent:** regularizes alpha mining for originality (AST similarity to known factors), complexity and
  hypothesis alignment, to resist alpha decay.
- **QuantAgent:** a two-layer loop that builds its own knowledge base from evaluator feedback.
- **QuantEvolve:** a multi-agent evolutionary search over strategy populations.

Compared with them:

| Dimension | This run | Published agents |
| --- | --- | --- |
| Search breadth | 36 single-threaded loops | Populations of hundreds of candidates per round |
| Holdout hygiene | Pre-registration, tiers, context-separated gatekeeper, deflation, verdict-only reads | Usually a fixed test split; leakage through the iterating context is rarely addressed |
| Knowledge accumulation | Census, ledger, LOG; lost partly across context compactions | Explicit knowledge base and SOTA tracking |
| Objective | Timing edge over random per trade | IC/ICIR and portfolio metrics (annualised return, IR, drawdown) |
| Combining signals | None | Factor combination and model co-optimization |
| Complexity and originality control | "One change per loop" by convention | Measured penalties (AlphaAgent) |
| Code generation and testing | By hand, with bugs found late | A code agent with execution feedback |

The run is stronger than these frameworks on overfitting discipline and weaker on breadth, accumulation, signal
combination and portfolio-level evaluation. Their reported gains are mostly not tested against the context leak that
amendment 5 addresses, so the two approaches are complementary.

## What to change (priority order)

1. **Fix the statistics:** a date-clustered bootstrap, and re-read the survivors with it.
2. **Fix the objective:** report portfolio metrics (return, Sharpe, drawdown against holding and cash) next to the
   timing edge. Build and test an ensemble of the forward candidates with volatility sizing.
3. **Fix the forward test:** run the 4h scripts every 4h, or model the latency in the backtest. Give every forward
   candidate a pre-declared decision date and admit/kill criteria. Support limit orders.
4. **Fix the universe:** use a point-in-time, survivorship-free top-N.
5. **Build the data layer:** prefetch and share OI, liquidations, funding, basis and order-book data, with a ledger of
   reads per lineage and per agent.
6. **Separate roles for real:** the gatekeeper and the sealed store sit behind access control, and the evaluator is
   ideally a different model or a deterministic service.
7. **Widen the search without loosening the gate:** generate many candidates with complexity and originality controls
   (as AlphaAgent does), but keep pre-registration, tiers and verdict-only holdouts.
8. **Spend rigour by prior:** do a literature screen first, and give low-prior ideas a cheap kill test, not a full
   family.
