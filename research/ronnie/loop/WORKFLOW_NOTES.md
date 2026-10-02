# Workflow notes: problems met while running the autonomous R&D loop

Input for the product's R&D system. Each note: what happened, why it matters, a proposal.

## Before the first loop

1. **The holdout ran out.** After about 40 trial families, every standard coin set had been read at least once. A
   clean final tier needed a hand-built list of never-used coins, made by scanning every script for coin literals.
   - **Proposal:** the R&D system keeps a ledger of every (instrument, period) read and by which trial. It hands out
     untouched holdout slices on request and refuses a second read.
2. **The validation level has to know the trial history.** Deflating for multiple testing needs the count of earlier
   validated candidates. Here that count lives in a CSV the loop appends to, so it is only as good as the discipline
   of writing to it.
   - **Proposal:** the census is a system record, and the validation step reads its level from it, not from the
     caller.
3. **Pre-registration is a commit, not a gate.** Nothing stops a run before its registration is committed; the order
   holds by convention.
   - **Proposal:** a run request carries the registration hash; the runner refuses an unregistered configuration.

## Loop A1

4. **Attribution by terciles is weak when every cell is negative.** All 24 cells lost; the "best" tercile only lost
   less. Picking the least bad cell as the next change is the overfitting path the protocol forbids, unless an outside
   source agrees.
   - **Proposal:** attribution reports a decomposition (stopped-out share, time to stop, maximum favourable excursion
     before the stop, result against the control in the same regime), so a loss is located in the entry, the stop or
     the target rather than in a feature bucket.
5. **The control decides the verdict.** The control is random entries of the same coin, year and side. In a trend
   regime, random entries in the trend's direction earn (+0.13R here), so the bar a trend-aligned setup must clear is
   high. A regime-matched control would answer a different question: does the level add to the trend?
   - **Proposal:** the control is part of the hypothesis registration (year-matched, regime-matched, or both reported).
6. **The attribution proposal (note 4) was needed at once.** Loop A2 followed the A1 tercile reading and got worse,
   because that reading did not carry over. A decomposition helper (stops within 2 bars, MFE before the stop) was
   written mid-run, and it pointed at the entry with a clear mechanism. An R&D system should ship this decomposition
   as the default attribution, before any feature buckets.
7. **Attribution must use the run's exit model.** The decomposition helper re-walked trades with the plain exits, so
   for A4 (time stop) it reported the A3 figures. Any attribution must take the exact trade model of the run, ideally
   from the trade records the run itself writes (exit bar, exit reason, MFE), not a reconstruction.
8. **A relative gain can hide an absolute loss.** A4 narrowed the gap to the control because the control got worse
   under the same time stop. The report should show both R and control side by side, and flag a "gain" made by
   lowering the control.
9. **Multi-timeframe features need explicit time alignment.** In A5 the level age was computed as a daily index minus a
   weekly index. Nothing flagged it; the tercile table printed plausible-looking numbers. A feature layer should carry
   each series' timeframe and refuse arithmetic across timeframes without an explicit alignment step.
10. **Small samples pass through.** A5's +0.24R on 58 trades looks like a breakthrough, and its interval spans zero.
    A report should lead with the interval and the per-half split, and say plainly when the sample cannot decide.
11. **A near miss has no defined path.** A8 passed both halves but missed the pooled interval narrowly, on 51 trades.
    The protocol has no step for "promising but under-sampled": validation would spend the clean tier on a candidate
    tuned through eight looks, and a ninth loop breaks the family budget. A forward record is the only clean option,
    and it is slow.
    - **Proposal:** the R&D system has a "needs more data" state that routes a near miss to a sample expansion
      registered in advance: more instruments or an earlier period in the iteration tier, chosen before the expansion
      is scored. That state is distinct from "failed" and from "validated".
12. **Loop count is the real multiplicity.** Eight informed looks at one tier make even a pass optimistic. The census
    records them, but nothing yet converts that count into a haircut on the reported edge.
    - **Proposal:** report a deflated edge alongside the raw one (for example, a deflated Sharpe ratio or a holdout
      haircut per look).
13. **One change per loop, applied as a filter, collapses the sample.** Family B went from 350 to 154, 121 and then 20
    trades as each loop added a condition. The rule "one change per loop" is good for attribution, but with filters it
    trades statistical power for interpretability, until nothing can be decided.
    - **Proposal:** before a loop runs, the system estimates its trade count from the predecessor (the share of trades
      the new condition keeps) and the minimum detectable edge at that count. It warns when the loop cannot reach the
      gate even if the edge is real.
14. **A rule that can never fire reports as a crash, not as a finding.** B-5 (daily levels with two-close confirmation)
    produced zero signals: a daily level crossed by the first close leaves the book before the second close, so the
    condition was unsatisfiable. It surfaced only as a KeyError in the report code.
    - **Proposal:** the runner checks signal counts per instrument before scoring and reports "zero signals: condition
      never satisfied" with a trace of which clause eliminated the candidates.
    - **Fix here:** the levels are read at the open of the first crossing bar. B-3 and B-4 used the weekly book, where
      this matters only when the two closes straddle a week boundary; their results stand as run.
15. **Earlier families contaminate the tiers of later ones.** O3 was read on 2023-2026 large caps before this protocol
    existed, so the protocol's validation tier is already spent for that lineage. Only a ledger of reads per lineage
    (note 1) can tell this; here it was caught by memory.
16. **Data latency shapes the loop.** The carry family's funding and kline archives (37 coins x 80 months x 3 files)
    took hours through a throttled downloader, while a strategy loop on cached bars takes about a minute. An R&D
    system needs a market-data layer that is prefetched and shared, so a loop's cost is computation, not download.
17. **A silent key collision corrupted 20 loops of attribution.** Features were stored in a dict keyed by (time, side).
    Daily bars share timestamps across coins, so features of different coins overwrote each other. Every tercile
    table looked plausible. The bug surfaced only when a trade listing showed three coins with identical features.
    Two loop decisions (A2, and partly C-2) rested on corrupted tables.
    - **Proposal:** trade records carry their own features at creation (one record per trade, with the instrument in
      its identity); attribution never joins features back by a partial key. An integrity check flags identical
      feature vectors across instruments.
18. **Tercile cuts on tied values invent groups.** The B-family "touches" feature is always 0, yet the table showed
    three groups with different edges, because ranking with ties split identical values arbitrarily. Attribution
    should refuse a feature with too few distinct values, or group by value.
19. **The halves rule ignores power.** C-4 passed the pooled interval, but its first half held 15 trades, and one
    clustered loss (three coins on 2018-11-22) sank it. Requiring both halves positive is sound against regime luck,
    but it needs a minimum count per half, or a pooled test with time-clustered resampling instead.
20. **A change can interact with the trade geometry and silently shrink the sample.** C-5's confirmation raised entries
    and pushed most targets under the 1R floor, so 61 of 76 trades vanished by a filter the loop did not name. The
    report should break down why candidate signals were dropped (target floor, stop cap, spacing, cancellation), so
    an unintended filter is visible.

## Attribution as factor evaluation (added after the user's review)

21. **The attribution had no system.** Tercile means gave no strength measure, no stability across time, no
    monotonicity and no multiple-testing control, so a noisy cell could steer a loop (A2). `loop/attrib.py` now reports,
    per feature:
    - the rank IC with the edge;
    - per-year IC with ICIR, t and hit rate;
    - the IC in each half;
    - quintile buckets with monotonicity and a coin-clustered Q5-Q1 interval;
    - a reliability flag (|t| >= 2, the same IC sign in both halves, and a Q5-Q1 interval excluding zero);
    - the number of features tested;
    - `compare` for IC decay from iteration to validation.
    A common feature set (BTC trend, coin trend, 20-bar return, volatility ratio, volume ratio, stop width, target R) is
    computed by the engine per trade and stored on the trade record, which also removes the cause of note 17.
22. **What the new attribution found at once.** On A3, BTC's trend is a reliable factor (IC +0.12, ICIR 2.6 over four
    years, Q5-Q1 +0.47R [+0.23, +0.70]), and the number of prior touches is reliably negative: the opposite of the
    tercile reading that motivated A2. The tercile tool never offered BTC's trend, because it was not a feature.
23. **Rare events cannot get a stability measure.** C-4 has only one year with 8 or more trades, so ICIR is not
    computable. The report says so instead of printing a number. Rare-event families need pooled tests with
    clustering, or a broader universe.
24. **Reruns inflate the census.** Re-scoring a loop to produce a new attribution appended a second trial row. Reruns
    are now marked `rerun-*` (environment flag `LOOP_RERUN`), and the validation level counts only real validations.
25. **A factor can be market timing in disguise.** BTC's trend predicts the support-bounce edge, but the control is
    random entries of the same year, so a factor that times the market within the year will look like strategy skill.
    - **Proposal:** attribution also reports each feature's IC with a regime-matched control's outcome (random entries
      on days in the same feature bucket). A feature that predicts the control too is beta, not skill.
26. **Factor stability must be judged across loops, not within one.** The volatility ratio is "reliable" in A10 with a
    positive sign, while the weekly-level loops favoured low volatility. Each loop's attribution sees only its own
    trades.
    - **Proposal:** the R&D system keeps a factor ledger across loops: each feature's IC and sign per loop, with the
      configuration. It requires a factor to hold its sign across related configurations before it may drive a
      change (meta-attribution). The per-loop flag is necessary, not sufficient.
27. **Informal looks are trials.** Sizing loop C-6 meant computing its trades' edge on the iteration tier. Nothing
    records such looks unless the agent writes them down, and they shape decisions as much as a registered run does.
    - **Proposal:** every query of trade outcomes goes through the R&D system, which logs it as a trial. Sizing
      questions are answered from counts only, without outcomes.
28. **An admissible factor may have no admissible threshold.** The target R passes the ledger, but at the natural cut
    (1:2) it keeps 5 trades. Any other cut would be read off the data. The ledger should report, with each admissible
    factor, the share of trades its natural threshold keeps.
29. **The beta check overturned the family's best lead.** BTC's trend was flagged in 4 loops with a stable sign, the
    strongest ledger factor in the research. Random entries showed the same bucket pattern, so it was market timing.
    Without this check, "support bounces when BTC is strong" would have gone to validation as a strategy.
    - **Proposal:** the beta check runs automatically for every flagged factor and is part of admissibility: a factor
      whose bucket pattern also appears in random entries is labelled "regime", and it is offered as a regime filter
      for an existing regime strategy, never as a source of entry skill.

## Iteration quality (the user's review after 33 loops)

30. **Most loops were small steps along noisy directions, not mechanism changes.** The census shows it:
    - **Edge rose as samples shrank:** A8 +0.41 on 51 trades, B-4 +0.33 on 20, B-5 +0.32 on 74. It fell back when the
      sample grew: A11 -0.08 on 346, B-8 +0.03 on 795, B-9 -0.10 on 1,053. That is selection of lucky subsets.
    - **Kinds of change:** of 33 loops, about 20 added or tightened a filter, 4 changed the level definition, 3
      changed the entry model, 1 changed an exit, and 3 expanded the sample. None changed the trade's thesis on the
      evidence of a discriminating test.
    - **Pace:** each loop took a few minutes of reasoning on one attribution table, with no look at individual trades
      and no competing explanations.
    - **Proposal:** measure progress by the lower bound of the edge interval (or the t-statistic), not the raw edge,
      so a gain made by shrinking the sample shows as no gain. Track the slope per loop on that measure.
31. **What a high-slope loop needs** (adopted as protocol amendment 4):
    1. **A diagnosis package before any change:**
       - the loss decomposition;
       - a review of the 20 worst and 20 best trades (what the chart looked like);
       - the beta check;
       - the factor ledger;
       - ablation: remove each component of the rule in turn and measure what it carries.
    2. **Competing explanations:** at least three for the failure, each with a signature it predicts in the data.
    3. **A discriminating diagnostic run first:** it tests those signatures without changing the strategy.
    4. **A structural change:** to the entry model, the exit model or the regime, the one the surviving explanation
       points at. A threshold or filter is allowed only with a power check showing the sample stays decidable.
    5. **A predicted effect size recorded before the run, compared after.** The agent's calibration (predicted against
       realised gain) is itself a tracked metric.
32. **The final tier is too small for rare events, and every lineage spends it.** C-6 drew 7 trades from the 12
    final-tier coins, so its single clean read decided nothing. Meanwhile each final read tightens the level for the
    next (k = 3 already).
    - **Proposal:** size the final tier to the strategy class. Hold back a large reserve of instruments and periods, and
      allocate a slice per candidate by expected event count. For rare events, use a time-forward holdout (the forward
      record) as the final tier, with a decision date fixed in advance.
33. **Amendment 4 raised the slope at once.** The first amendment-4 loop (C-4 diagnosis, then C-6) ran one
    discriminating diagnostic and one structural change. It moved the lower bound of the edge interval from +0.09 to
    +0.30 and the stop rate from 24% to 7%, the largest single-loop gain of the run. The earlier filter loops rarely
    moved the lower bound at all.

34. **Correction to note 32 (the user's review): the problem is a contaminated context, not a small final tier.** The
    iterating agent read the final tier's per-coin, per-year and IC-decay details (D-1, C-6). Anything read enters the
    context that designs the next loop, so the final tier became a second iteration tier. With 100 loops, any finite
    holdout is exhausted this way, whatever its size.
    - **Fix (protocol amendment 5):** separate roles and contexts. The iterator sees only the iteration tier. A
      gatekeeper (`loop/gatekeeper.py`), run by a fresh-context evaluator that never sees the iterator's reasoning,
      holds the validation and final tiers and relays only a verdict.
    - **The validation tier becomes reusable** through Thresholdout (Dwork et al., 2015): the iteration estimate comes
      back unless the holdout disagrees by more than a noisy threshold. Each disagreement spends a fixed budget.
    - **Sealed store:** details are written for audit to `loop/sealed/`, which the iterator does not read. Here that
      boundary is prose-enforced; in the product it should be access control.
    - **Renewable final tier:** the forward record.
    - **Product implication:** the R&D system needs at least two agents with separate memories and a data-access layer
      that enforces which agent sees which tier. A single agent with a protocol cannot hold this line, because its own
      context leaks.
35. **Ablations that move the stop change the unit.** Edge is measured in R, the trade's own risk. A stop at the broken
    edge plus 1 ATR is about 1.7 ATR closer than the box middle, so the same price move is worth more R. Comparing
    stop designs needs a unit-free measure (return per unit of volatility, or percent of price), or the lower bound of
    the edge against a control with the same geometry, which is what decided here.
36. **The gatekeeper subagent worked as intended.** It read the sealed file and returned one line. The iterator learned
    PASS and nothing else. The cost was one extra agent call; the gain is that the final tier of carry K1 can still be
    audited by the user and was never seen by the agent designing the next loop.
37. **A feature can be undefined for the construct.** "Box age" assumed persistent boxes, but the 60-bar rolling box
    shifts every bar, so the feature was 0 for every trade. The diagnosis printed a split with an empty side. Feature
    definitions need a validity check (variance and distinct values) before they enter a diagnosis, as note 18 asks
    for attribution.
38. **Factors can conflict across families.** "More touches" is good for range-edge fades (E-1) and bad for swing-level
    bounces (A3, A9). A ledger keyed by feature name alone would merge them. It needs the construct as part of the key
    (touches of what, counted how).
39. **The iterating agent's predictions are biased upward.** Registered predictions missed by -0.26R (E-2) and -0.30R
    (E-3), and only C-6 beat its prediction. A calibration record (prediction against outcome per loop) should feed
    back as a shrinkage on the agent's next predictions. A prediction that is never scored teaches nothing.
40. **A verdict-only holdout teaches nothing about why.** F-1, F-2 and G-2 all FAIL on the reserve, and the iterating
    agent cannot tell a negative edge from a positive but under-powered one, or a regime mismatch.
    - **Proposal:** the gatekeeper returns a three-level verdict (PASS; FAIL with the edge positive but the interval
      spanning zero; FAIL with the edge at or below zero). That leaks about one bit more and lets the next loop choose
      between "needs data" and "wrong mechanism". The level of disclosure is a deliberate, budgeted design parameter,
      not an accident of the tool.
41. **A holdout must match the target universe.** The reserve tier is 2024-2025 listings, many of them new tokens and
    memecoins in their post-listing decline, while the strategies were built and meant for majors and large caps (the
    user's own rule: big coins). A FAIL there may say "does not transfer to new listings" rather than "no edge on
    majors". The tier was chosen for cleanliness alone.
    - **Proposal:** the data ledger stratifies reserve slices by universe (majors, large caps, new listings) and
      period, so each candidate is tested on a clean slice of its own universe.
42. **The three-level verdict paid off at once.** On the majors slice, all four candidates came back "FAIL (edge
    positive, interval spans zero)". That one extra bit turned four bare FAILs into a clear next step: gather data (the
    forward record), not change the mechanism.
43. **The forward harness cannot record resting orders.** G-2 enters with a limit order at the broken edge, valid for
    12 bars. The forward record only models a market entry at the next 4h open, so G-2 cannot be paper-tracked
    as tested. A paper-trading layer for R&D must support the same order types as the backtest (limit, stop,
    validity window, cancellation), or candidates silently change on their way to the forward test.
44. **Visual trade review: useful for generating hypotheses, misleading for deciding.** Reviewing the 6 worst and 6 best
    F-2 trades produced three specific hypotheses in minutes. On all 994 trades, two were rejected (one reversed) and
    the third was mostly a generic effect that random entries share.
    - **Proposed pipeline:**
      1. trade cards for the worst, best and a random sample (the random sample guards against extreme-case
         narratives);
      2. failure modes defined as code (immediate stop, stall then fail, gap through the stop, wick-out, target then
         reversal) and counted;
      3. every visual hypothesis turned into a metric, then IC and buckets on all trades, then a beta check;
      4. only a hypothesis that survives (3) may change a rule.
    - **Breadth:** each loop lists hypotheses across categories (entry, exit, sizing, regime, universe, data source)
      and records the rejected ones, so narrow one-filter hypotheses do not crowd out structural ones.
45. **Visual hypotheses fail more often than not, so the quantification step is mandatory.** Over three visual reviews
    (F-2, E-1x, E-5), seven hypotheses were proposed. On all trades, five were rejected or reversed (tight stops, BTC
    co-movement, sharp spikes revert, bear-regime losses, sloped boxes), one held in direction only, and one (entry
    depth) was already a flagged factor. The human-like reading of charts favours memorable extremes. The review is
    still worth its cost because it proposes concrete, testable mechanisms quickly, but it must never shortcut the
    IC, bucket and beta checks.
46. **The loop barely looked outside.** Hypotheses came from the agent's memory and the loop's own attribution, so they
    circled the same ideas, and memory citations may be imprecise. One targeted search for the box-range failure
    returned the following.
    - **Already tested here:** the Bollinger 2-sigma fade with an ADX gate (Freqtrade "Bollinger Reverter 4h"), and
      Hurst or variance-ratio regime gates.
    - **Untested:** a low-volume regime for mean reversion.
    - **A new family, missed entirely:** mean reversion of the spread between correlated coins (pairs trading with a
      Hurst or ADF test). It explains the dozen failed single-coin range loops: single crypto prices trend, while
      spreads of correlated coins are the series that range.
    - **Proposal (protocol amendment 8):** a live, failure-targeted external search in every loop's hypothesis step,
      with each source recorded with its rule, claimed result and evidence quality.
47. **A churn bug passes silently unless trade counts are sanity-checked.** H-1's first run had about 20 trades a week
    on 5 pairs and a 12% win rate, impossible for a mean-reversion rule. The cause was re-entry beyond the stop. The
    runner should flag implausible statistics before reporting: a trade-count rate far above the design, a holding
    time of 0 bars for most trades, or a win rate far from the rule's geometry.
48. **Some edges live where the backtest cannot see them.** The pairs family moves toward profit as the horizon
    shortens (4h -0.42%, 1h -0.19% net). The literature's profits are at 5 minutes, where the outcome depends on maker
    fills, queue position and fees, which OHLC bars cannot model. An R&D system needs an execution simulator matched
    to the strategy's horizon (order-book or trade-level data for intraday strategies), or it will either miss such
    edges or credit fills that would not have happened.
49. **The census leaks verdict bits before the gatekeeper relays them.** The book gatekeeper wrote its two pass/fail
    bits into a shared census row. The iterating agent saw that row while checking its own census append, before the
    relay arrived. Here the bits were the same ones the relay carries, but any gatekeeper output written to a shared
    file is a side channel. Proposal: gatekeeper census rows go to a sealed ledger, and the shared census gets only "read
    done" until the verdict is relayed.
50. **Variant counts must be computed, not stated.** N-3 was registered with "24 variants" but its grid produced 32.
    The deflation and PBO depend on that count, so a hand-stated count is a bug class. Proposal: the registration
    stores the grid itself, and the runner refuses to run when the grid's size differs from the registered count.
51. **A filter can be immaterial, not true or false.** The funding veto (S-2) would have touched 2% of breakout
    trades; no result could change a decision. Proposal: the power check before a filter test (note 33) also
    computes the share of trades the filter can touch, and skips the test below a set share (for example 10%).
52. **Sparse streams break volatility scaling.** A trailing 26-week volatility is zero for a rule that trades in 5%
    of weeks, and the book printed NaN. Event strategies need a scaling defined on their own clock (per trade or an
    expanding estimate), stated in the book's design before the first run.
53. **The validation gatekeeper's PASS bit bypasses Thresholdout.** `loop/gatekeeper.py:57` sets PASS from the raw
    holdout interval (`lo > 0`), while only the edge goes through Thresholdout's noise. Each validation answer therefore
    carries one bit of unprotected holdout information. Found by the read-only product mapping on 2026-10-01. The
    validation tier is spent, so no running read is affected. Proposal: a verdict on a reusable holdout must be computed
    from the noised quantity (a noised lower bound), or the tier gives verdicts only once.
54. **The scorer silently dropped trades with targets below 1R.** `engine.score` inherits a `target >= 1R` filter from
    `range2/run.py:93`. Rules whose targets are often closer than the stop were scored on a biased remainder; in the
    Ronnie plan, S4 looked harmful (-0.24) when it was positive (+0.06). Earlier families were re-checked, and no
    closure changed. Proposal: a scorer never filters trades silently; any exclusion is a rule's explicit condition,
    counted and reported with the result.
55. **A gatekeeper verdict must carry every condition of its stage.** The R-1 read printed PASS from the interval alone,
    while stage 2 also requires the estimate to reach SESOI. The missing bit sat in the sealed file, and a second relay
    to fetch it was rightly denied because it reads the sealed store. Proposal: the gatekeeper's verdict function is
    generated from the stage definition in CRITERIA, so a verdict cannot omit a condition.
56. **A position-slot side effect became part of the validated rule.** R-1's backtest kept a coin busy for the full
    60-day hold after any fill, even an early stop, so the rule that passed its holdout trades each coin at most once
    per 60 days. Nobody chose that, and a live implementation would naturally free the slot after an exit. Proposal:
    position and slot logic are explicit, registered parameters of a rule (reported with its result), and the forward
    harness is generated from the same rule object as the backtest, so they cannot diverge.
57. **Slot logic processed orders in arming order, not fill order.** With several resting limit orders per coin, the
    backtest let an order that filled later void one that filled earlier, a look-ahead that lifted R-1's development
    edge from +0.22 to +0.34. Note 56's fix touched the same lines and missed it, and the forward harness had it right
    all along, so the two disagreed silently. It surfaced only when a chart drew the rule's trades next to a human's
    plan. Proposal: an event-driven simulator (orders resting through time, fills processed in time order) is the only
    implementation of any rule with resting orders, shared by backtest and forward; and a per-trade chart is part of
    every rule's review package.

