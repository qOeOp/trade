# Proposals from the research/ronnie study: index and product proposal

Every proposal made during the study, in one place. The detailed records stay in the files below; this file indexes
them and holds the product proposal, which was first published only as a page ("R&D workflow improvement proposal",
2026-10-01).

## Where the proposals live

| File | What it proposes |
| --- | --- |
| `loop/WORKFLOW_NOTES.md` | 53 notes on the R&D workflow, each with what happened and a proposal (data ledger, gatekeeper, Thresholdout, three-level verdicts, factor ledger, beta check, visual review pipeline, forward-harness order types, and more) |
| `loop/RETROSPECTIVE.md` | The review of the whole process; open flaws and the priority list of changes |
| `loop/PROTOCOL.md` | The R&D loop protocol and its seven amendments (tiers, budgets, ledger rules, loop quality, context separation, reserve tier, majors slice) |
| `STRATEGIES.md` | The strategy catalogue ranked by usability, with the next R&D step for each strategy |
| `RD_AUTONOMY.md` | Requirements for an unsupervised production R&D loop: module-by-module product state, prototype reference, defects not to copy, fixed protocol rules, build order |
| `loop/CRITERIA.md` | Acceptance ladder, closure statuses, data buckets, the usable-at-small-size gate and sequential tests, with verified sources |
| this file, below | The product proposal: research steps compared with the product's design and deployed state |

## The highest-leverage proposals (cross-file summary)

1. **Context separation is a product requirement, not a habit.** At least two agents with separate memories, a
   gatekeeper that holds validation and final data behind access control, and verdict-only reads with a deliberate
   disclosure level (WORKFLOW_NOTES 34, 36, 40, 42).
2. **A data and trial ledger.** A system-held record of every (instrument, period) read, by which trial and which
   agent. It hands out untouched slices stratified by universe (majors, large caps, new listings) and counts every
   query of outcomes, peeks included, as a trial (notes 1, 2, 15, 27, 41).
3. **Attribution as factor evaluation.** IC, ICIR, buckets, a reliability flag, a beta check against random entries, a
   cross-loop factor ledger keyed by construct, and IC decay on holdout (notes 21-26, 29, 38).
4. **Loop quality over loop count.** A diagnosis package (decomposition, case review, beta check, ablation), competing
   explanations with discriminating tests, structural changes, a power check before filters, and predictions recorded
   and scored (notes 30, 31, 33, 39; PROTOCOL amendment 4).
5. **Visual trade review as a hypothesis generator.** Trade cards for the worst, best and a random sample, failure modes
   as code, and every visual hypothesis quantified on all trades with a beta check before any rule change (note 44).
6. **Statistics that match the data.** Date-clustered intervals, a point-in-time universe, unit-free comparisons, and
   minimum counts per half (notes 19, 35; RETROSPECTIVE flaws 1-2).
7. **An objective that matches the user.** Portfolio return and drawdown against holding and cash, next to the timing
   edge, and ensembles of weak edges (RETROSPECTIVE).
8. **A forward test that is the backtested strategy.** The same order types (limit, stop, validity, cancel), the same
   cadence or modelled latency, and a pre-declared decision date with admit/kill criteria (note 43; RETROSPECTIVE).

## Product proposal (compared with the design documents and deployed state, 2026-10-01)

The study ran outside the product: the user stated ideas in natural language, and an agent did everything in
`research/ronnie`. It registered intents and criteria, fetched data, backtested against random entries, read holdouts
on never-used coins, diagnosed failures and opened successor rounds. Finally it wrote the strongest candidate as a
strategy program and started a record-only forward test. "Usable now" below means reachable by a user of the deployed
product, not present in code.

### Step-by-step comparison

| Research step | In the product design | Usable now | Gap |
| --- | --- | --- | --- |
| State an idea in natural language | Yes: a conversation agent receives requests | No | Starts only in the `dashboard-preview` configuration; the R&D execution agent is a target |
| Register the hypothesis and criteria first | Yes: research intent (mechanism, data, budget, falsifier, stop rule) | Partly | `/rd/intake/new` is admitted, in preview only |
| Backtest with a random control and intervals | Partly: exploratory replay; random control only on the qualification side | No | The replay production entry is acceptance-only; composer `/resolve` and `/readback` return 503; no geometry-matched control or bootstrap interval |
| Development and holdout sets | Yes: holdout read only by qualification | No | Runs only in the ordered CI gates |
| Record every trial | Yes: trial-family census, failures included | Partly | Running totals and budget caps are targets; invisible to the user |
| Failure diagnosis and next round | Yes: iteration decision (fix, successor, stop) | Partly | `/rd/decisions` is read-only; its producer is behind a flag |
| Reconcile with the project backtest engine | Implied: shared kernel and simulated exchange | Partly | Result bytes are readable only |
| Portfolio-of-strategies backtest | No: portfolio means the account's real positions | No | No research on multi-strategy overlap or drawdown |
| Record-only forward test | No: paper trading is the full execution chain | No | The run module reports FOUNDATION_NOT_READY |
| Land the strategy as a program | Partly: artifact path; authoring language V1 unimplemented | No | Hand-written programs have no documented place; the sealing workflow seals only `complex` |
| Scan the whole market for new signals | No: the scanner matches approved strategies | No | Scheduling and loading are targets |

### What the design already gets right (keep)

- **Freeze the research intent first.** Writing INTENT.md before results blocked many in-sample illusions (a
  volume-confirmed break gained 0.24R a trade on development data, then 0 on other coins).
- **Record failed trials too.** Only a handful of 40+ families survived; without the census the role of luck cannot be
  estimated.
- **An independent party reads the holdout.** In this study the agent split and read its own holdouts until the
  gatekeeper was added, which is weaker than the product's design. The product's rule should not be relaxed.
- **A surprise only opens a successor intent.** "Volume nodes hold better" was a surprise found while reading results;
  re-tested as a successor on new data, it was falsified. The rule worked in practice.

### Proposals by priority

- **P1, open the shortest path from idea to exploratory result.**
  - Now: the deployed image does not enable the flags; the composer returns 503; the exploratory replay's production
    entry is acceptance-only (`rd.md:111-125`, `backtest.md:81-88`).
  - Why: every round of this study needed a backtest number, and the product cannot produce one.
  - Proposal: make a single-instrument, single-family exploratory replay reachable in deployment, with results written
    to the trial census. Its production enablement needs the user's authorization, as `backtest.md` requires.
- **P1, build a geometry-matched random control and intervals into exploratory runs.**
  - Now: the random control exists only on the qualification side, as a target (`qualification.md:147, 441-447`).
  - Proposal: a standard field in exploratory run details holding 20 random entries of the same year, side, stop in ATR
    and target in R, plus a clustered bootstrap interval. Per this study, it should be date-clustered and include a
    beta check. Keep qualification's control an independent source, so research cannot reach protected results
    through it.
- **P2, a failure-diagnosis panel.** Run details gain per-trade path statistics: MFE before the stop, the stop's bar,
  the share reaching the target, and an exit grid re-scored by stop width and target ratio, marked diagnostic and not
  for selection. Per this study, it also needs trade cards and failure modes as code (WORKFLOW_NOTES 44).
- **P2, a record-only forward stage** between qualification and paper trading. It produces timestamped signal records
  only, touches neither run nor execution, and is scored with the exploratory fill model. Per this study, it must
  support the backtest's order types and cadence, and each candidate needs a decision date.
- **P2, a discovery scan separate from the existing scanner.** A read-only, market-wide state snapshot of research
  candidates (new signal, in trend, near trigger) that makes no proposals and touches neither governance nor
  execution.
- **P3, widen the research data in stages:** major perpetuals at daily and hourly, then funding and open interest (the
  Binance public archives have them). Enabling the Binance fetch is the user's deployment decision
  (`market-data.md:195-197, 1257-1262`).
- **P3, a research view of strategy portfolios.** A read-only portfolio replay of overlap, concurrent positions,
  drawdown and yearly returns, as input to iteration decisions, not capital allocation. Three 4h strategies combined
  reached a 76% maximum drawdown, and two of them often took the same trade.
- **P3, define the place of hand-written strategy programs.** Until authoring language V1 exists, state whether
  hand-written programs are an admitted interim path or reference only. If admitted, let the sealing workflow seal any
  program from its manifest; `majors_trend` stopped at "proposal, source and tests" without a sealed artifact or a
  replay entry.

### Decisions that belong to the user

None of the proposals touches real money, changes what the product is for, or removes a seal or bound; under
AGENTS.md, documentation changes are the agent's to decide. Two items need the user: the production enablement of
exploratory replay, which the documents reserve for user authorization, and enabling the Binance data fetch, a
deployment decision.

Suggested order: the two P1 items first, since nothing else can be verified without them, then the two cheap,
immediately useful P2 items (the forward stage and the discovery scan).

Sources: `docs/guide/product-loop.md`, `docs/owners/rd.md`, `backtest.md`, `qualification.md`, `scanner.md`,
`portfolio.md`, `market-data.md`, `strategy-governance.md`, `docs/guide/dashboard.md`.
