# Backtest

## Responsibility

Replay frozen strategy artifacts against admitted historical facts with production-equivalent trading semantics. Backtest owns what was actually consumed and what happened in replay; it does not decide whether a result is deployable.

## Capability comparison and MCP scope

Distinguish native Nautilus foundations, repository product extensions and current MCP reachability.
Retained Rust source governs integration; upstream latest documentation assists discovery. An upstream API,
individual test or tool name does not establish product assembly, deployment or end-to-end delivery.

| Function                                  | Native Nautilus foundation                                                             | Product extension and current MCP                                                                  | Scope assessment                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Historical event replay                   | BacktestEngine, simulated venues, clock, event ordering and native trading components  | `run` submits product orchestration; native execution depends on features and service assembly     | Recorded submission or sealed replay does not establish completed execution                                                       |
| Catalog loading and chunks                | BacktestNode configuration, instruments, oneshot/streaming                             | Entry resolves Market Data PIT custody; no general catalog configuration interface                 | Reuse native loading; add exact versions and consumption binding                                                                  |
| Strategy inputs                           | Native Strategy/Actor lifecycle and registration                                       | MCP accepts one catalogued `strategy_id`; product authoring/Host supply bounded mappings           | Native package sealing belongs to R&D; Backtest validates and executes frozen artifacts                                           |
| Multiple instruments and strategies       | Multiple instruments, `add_strategies` and shared native accounts                      | `run` names one instrument and strategy; internal target sets may contain multiple instruments     | Multiple instruments are not independent strategy compositions; complete composition MCP remains undelivered                      |
| Orders and exits                          | Native OrderFactory, OMS, commands/events, GTD, contingent and reduce_only foundations | Current target adapter fixes NETTING and GTC limits at snapshot prices                             | R-1 fixed targets, conditional cancellation, entry protection and staged exits require native Strategy integration and acceptance |
| Matching and liquidity assumptions        | Bar/trade/book matching, partial fills and Fill models                                 | No complete model selection/configuration binding through MCP                                      | Reuse native matching; model existence does not prove input suitability or consumption                                            |
| Fees, slippage and latency                | Fee, Fill and Latency models                                                           | Six request fields expose no such configuration; backend paths impose their own constraints        | Seal explicit choices and consumed configuration rather than another cost model                                                   |
| Balances, margin and positions            | Native accounts, Margin models, Portfolio and RiskEngine                               | Host path restricts one venue Margin account and NETTING                                           | Native components own trading facts; pool allocation and research scenarios add product policies                                  |
| Funding settlement                        | SimulatedExchange processes FundingRateUpdate and settlement boundaries                | Product data/result foundations exist; current MCP cannot express a complete funding schedule      | Prove schedule integration, account changes and reporting consistency without another ledger                                      |
| Execution algorithms                      | `add_exec_algorithm` / `add_exec_algorithms` and native algorithm interfaces           | No algorithm configuration through current MCP                                                     | Integrate needed algorithms with bound versions and parameters                                                                    |
| Intrabar chronology                       | Native OHLC path assumptions with minute bar execution                                 | Minute execution, native signal aggregation and conservative policy require integration            | Path assumptions do not prove observed chronology; missing data cannot use fallback                                               |
| Input repair and new runs                 | Native reset and complete repeated replay                                              | Agent submits a new sealed run for changed input versions                                          | Retain predecessors and exact evidence; never stitch runs or mutate old inputs                                                    |
| Run identity and result custody           | Native run/results and statistics                                                      | Product registry, identity conflicts, freeze/admission, attempts and result custody                | Adds durable research evidence; actual terminal outcome/results determine success                                                 |
| Reports and performance                   | Native results, analysis and order/fill/position/account facts                         | OwnerBacktestReportV1 conversion exists; MCP `report` refuses all recorded runs                    | Calculation foundations exist; MCP report delivery remains incomplete                                                             |
| Jobs and recovery                         | Repeated runs, streaming and state operations                                          | `status` reads recorded request/answer; `list` lists runs; `run` orchestrates in request           | Background execution, cancellation, unresolved result recovery and budget takeover have integration gaps                          |
| Composition capital and membership        | Shared accounts, multiple strategies, risk and common event timeline                   | Product composition/allocation targets exist; single strategy MCP lacks complete configuration     | Neither provides the complete product history of trial/formal pools, queued joins and exit plans                                  |
| Experiments, comparison and qualification | Repeated runs, configuration and results                                               | Agents compare experiments; R&D retains records; Qualification evaluates eligibility independently | Backtest supplies frozen runs/facts rather than search, ranking or deployment decisions                                           |

**Current four tools.** `run`, `status` and `list` have backend operation paths. `report` has protocol and route
code but always returns `RUN_HAS_NO_RESULT` for recorded runs. The six `run` fields identify the run, strategy,
instrument, execution timeframe and window bounds. They expose no composition members, allocation, algorithm
or cost model configuration. Native execution also depends on `composer-v3-replay`, `native-replay-execution`
and service availability. Orchestration admission, replay sealing or input-custody issuance is not a completed result.

### Target MCP functional sets

Retain one Backtest MCP with the following candidate capabilities, resolving tool names and structures at the contract layer.

1. **Admission checks:** check frozen artifacts, data bindings, venue/account/OMS, models and execution policy support; report named gaps.
   V0.1 uses no strategy-name or R-1 template whitelist; native strategies must satisfy connected capabilities, frozen inputs and resource bounds.
2. **Replay submission:** submit a frozen single strategy or versioned composition, reusing native engines and trading semantics.
3. **Job queries and control:** inspect/list/cancel runs and recover original job identity; distinguish stopped execution, unresolved results and completion.
4. **Results and reports:** return immutable result references and bounded reports preserving orders, fills, rejections, costs, accounts and member attribution.
5. **Reproduction and successors:** reproduce exact old bindings; refined inputs or changed configuration create linked new runs without overwriting evidence.

V0.1 delivers job queries and same-identity recovery without active replay cancellation. Admitted runs execute
within resource limits until completion or failure. Target cancellation capability is outside the first delivery.
Recover task/result records without requiring checkpoint continuation of intermediate replay state. After restart,
read the original identity: return complete results directly, resolve unknown status, and only after confirmed
interruption let the Agent submit a linked new full run with the same frozen inputs from initial state. Retain
original attempts, failures and resource usage; account for the new run under existing ledger rules.

### Formal result retention and storage bounds

V0.1 formal tasks, results, admitted reports and evidence detail have no automatic age-based deletion or
automatic reduction to summaries. Retained orders, fills, account/equity series and diagnostics remain readable
by original identity under their existing permissions and protected isolation. Temporary files outside formal
evidence custody may be cleaned. Insufficient storage stops admission of affected new tasks and reports the
capacity gap until the user decides expansion or formal evidence cleanup; old results are not evicted to keep
running. Admitted tasks remain resource-bounded; write failures are reported honestly and partial results never
claim a complete terminal. Reuse existing custody and resource admission without a new archive service or
first-version cleanup interface.

Admission, Replay, Results and Reports belong to one service; job control creates no additional department.
External Agents organize experiments, choose parameters, compare results and decide successors; R&D retains
experiments and decisions. Backtest queues and executes submitted frozen runs within budget, without expanding
parameter searches, ranking candidates or selecting the next parameter set. V0.1 accepts multiple independent runs
and queues them for sequential execution, with at most one replay executing at a time. Each retains separate
identity, status and results. Parallel execution is outside the first delivery; later extensions must preserve
resource bounds and isolation. Server scheduling introduces no research judgment. Qualification owns protected
evaluation. Market Data owns data
preparation. Backtest does not invoke live effects to simulate history or call MCP for data inside matching.

V0.1 result readback also provides bounded strategy diagnostic logs, reusing Nautilus logging and linking the
exact run and strategy version. Agents may record absent triggers and filter reasons to explain zero fills or
unexpected outcomes; the product generates no research diagnosis. Native events and results remain authoritative
for submitted, rejected or filled orders and account changes. Mark truncated or unavailable logs explicitly;
missing messages establish no negative condition, and log text cannot replace fill or account evidence.

### Failure diagnostics and durable error records

V0.1 retains failure information in the existing Backtest task/result database and exposes it through task and
diagnostic reads, without another error database or service. Records link the original request, existing
run/attempt, strategy hash, runtime and input versions, retaining time, named errors, available exception
locations/stack traces and bounded native logs. Mark absent runs/details rather than fabricate fields. Each Owner
writes its own failure facts; R&D links public receipts and Agent remediation notes without changing source facts.

Existing native orders, fills and account records from failed runs may be read for permitted diagnostics, with
explicit completeness and termination position. They are not complete successful replay, economic advantage
or qualification evidence. Retain only recorded facts/logs without promising pre-crash memory recovery or adding
simulator checkpoints. Protected errors remain private to research, and diagnostics must not disclose credentials.
An abnormal exit without a definitive error receipt remains unresolved until original task reconciliation.

Agents find recorded failures through project tasks and Backtest readback, diagnose strategy issues and link
repaired versions and validation runs in R&D. Server defects retain errors and exact version/task information
for later user inspection; service code self-repair and automatic deployment are outside the research workflow.

- **Strategy code defect:** edit Git source, seal a new Artifact and submit a linked complete replay. The server
  executes the new package without redeploying the Backtest service for every strategy edit. Retain old failures,
  packages and attempts; a research repair does not automatically replace a strategy trading real funds.
- **Product service or fixed environment defect:** retain service versions, error logs and related task information.
  The user inspects, repairs and deploys later. Add no repair workflow, built-in repair model or automatic release
  capability; research-Agent strategy submission does not include service repair or deployment authority.
  Experiments after user repair bind the exact new service/environment version while retaining old failures.

### Integration evidence and limits

The entry is `services/backtest-mcp/src/lib.rs` → `backtest_run_routes.rs` → R&D orchestration in
`backtest_run_v1.rs` → conditionally assembled `NativeReplayExecutionServiceV2`. Shared API assembly does not
transfer ownership of backtest facts to R&D or require one process per logical service.

Native evidence is in `crates/backtest/src/engine.rs`, `node.rs`, `config.rs`, `exchange.rs` and
`crates/execution/src/models/`. Current Host mapping is in
`crates/strategy_factory/src/program_host_backtest_target_set_v2.rs`; report conversion is in
`crates/strategy_factory/src/owner_backtest_report_v1.rs`. Actual `get_backtest_run_report` responses and
`execute_committed_replay_v1` branches take precedence over stale source comments. Upstream references:
[Backtesting](https://nautilustrader.io/docs/latest/concepts/backtesting/),
[Bar execution](https://nautilustrader.io/docs/latest/concepts/backtesting/bar-execution/) and
[Accounts and margin](https://nautilustrader.io/docs/latest/concepts/backtesting/accounts-and-margin/).

## Native backtest integration and capability boundaries

### V0.1 service operations and completion conditions

MCP and internal APIs call the same domain operations. This table defines consumption semantics, not tool URLs or another run-configuration language.

| Operation   | Input                                                                                                                                   | Return and completion condition                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Submit run  | Registered experiment/attempt, stable request identity, sealed package, input manifest, Run Specification and exact resource commitment | Original task identity and admission/queue facts; acceptance is not successful replay                                             |
| Query run   | Original request, attempt or task identity                                                                                              | State of the same job, bound inputs, actual consumption, available result or failure references; unknown differs from interrupted |
| Read result | Exact run/result, report kind, range, bound and pagination position                                                                     | Native summary, orders/fills/accounts, minute equity and bounded diagnostics with version, completeness and continuation          |

[Strategy Artifact and Run Specification](../architecture/strategy-factory.md#strategy-package-and-content-identity)
bind strategy content and experiment conditions separately. One submission runs one complete first-version
strategy. Multiple instruments share the replay account rather than concatenated single-instrument equity.
Agents may read Backtest results directly; R&D retains references and Agent explanations without another native
account or result authority.

### Native loading and result custody order

The repository's Python surface is `vibe_trading`. Build the exact run config engine with `BacktestNode.build`,
then load the sealed module with `add_strategy_from_config(run_config_id, ImportableStrategyConfig)`.
Use native `module.path:ClassName`; configuration class, parameters and import closure come from the package and
fixed environment, never the latest Git branch. Rust registration and Python configuration loading are different
entrances; availability of one does not prove the other is integrated.

Module imports execute Python code too; sealing grants no execution authority. Load and replay ordinary research inside existing
Docker/task isolation with only the sealed package, fixed environment and admitted research inputs. Mount neither other
projects nor protected data, supply no trading credentials, and permit no runtime network downloads or dependency
installation. R&D sealing does not arbitrarily import source under service authority; necessary checks use the
same restricted execution boundary. Ordinary process/container permissions and domain admission enforce this,
without a custom sandbox engine.

`crates/backtest/src/python/node.rs` provides that loader. Direct engine `add_strategy` and
`add_strategy_from_config` are in `crates/backtest/src/python/engine.rs`; register execution algorithms through
the native engine interfaces. Compiled example `add_builtin_strategy` is not the arbitrary strategy-authoring
entry and requires no replacement strategy Host.

When errors are ignored, native `BacktestNode.run` can skip engines or omit failed results. The product path
uses `BacktestRunConfig.raise_exception=true` and verifies that the expected run config was built, executed and returned its matching
result. A successful function return or nonempty result list does not independently prove this job succeeded.

Native nodes may dispose engines on completion. Set `dispose_on_completion=false` and keep the engine readable
until required reports are extracted and retained, using native `get_result`, `generate_orders_report`, `generate_fills_report`,
`generate_positions_report`, `generate_account_report` and Portfolio snapshots. Commit immutable results/reports,
then release the engine. Issue a complete readable result only after custody is confirmed. Until then, retain the original task and settlement state for resolution. A summary cannot replace failed report or minute series extraction.
Bounded external reports derive from retained native facts, preserving native price/quantity precision, currency
and amount units, event times and ordering basis. DataFrames or catalog paths are not the MCP data contract;
serialization never substitutes lossy floats for monetary values, unreadable detail for empty collections or
arbitrary caller SQL, paths or scripts for report queries.

### Native run admission and input mapping

V0.1 starts with explicitly configured funds, no positions and no pending orders; existing trading-state import is
not included. Warmup establishes indicators and computational strategy state without admitting orders or changing
the trading account. The account retains its frozen initial state at the execution interval start; no trade may
precede that interval. Retain and value terminal open positions under the agreed policy.

Backtest extends native `BacktestEngine`. The sealed manifest binds the native Strategy package, algorithms,
Instruments, OMS/account/book types, balances, Fee/Fill/Latency/Margin models,
GTD/contingent/reduce-only/position-ID support, bar execution/path policy, Risk configuration, seeds and data
ordering. Economic assessment cannot implicitly bypass native RiskEngine. Refuse unsupported combinations
without another matching engine. Native `add_strategies` / `add_exec_algorithm` register components;
product additions concern sealing, authorization, inputs and report custody.

For catalog-driven runs, reuse `BacktestNode` configuration validation, instrument loading and
oneshot/streaming paths, attaching Host/algorithms through its engine rather than recreating historical
readers/chunkers. When configuration suppresses build errors, a successful return does not prove every engine
was built.

Current `program_host_backtest_target_set_v2.rs` fixes NETTING and one venue Margin account and creates GTC limits at snapshot
prices. `Position` / `WeightMicros` are net target quantities/weights, not frozen limit
prices, margin proportions or stop-risk proportions. `backtest_run_v1.rs` accepts one `strategy_id`;
multi-instrument target sets are not compositions of independent strategies. R-1 requires versioned Host
lowering into native `OrderFactory` and commands: exact `Price` / `Quantity`,
original target price, GTD/conditional cancellation, entry-specific protection, partial-fill quantities and
reduce-only staged exits.

Native cache, events and OMS maintain actual state; do not reinterpret existing fields or force R-1 into the
current net-target adapter.

`crates/backtest/src/exchange.rs` already handles `FundingRateUpdate` and settlement boundaries. Wire admitted
complete funding schedules from Market Data and reconcile accounts/reports; recorders or schedule value types do not
prove integration. Bind settled costs separately from information known to strategies, without another funding ledger.

### One-minute execution and reproducibility

Bar replay uses admitted minute data throughout the execution interval. Strategies receive larger aggregated bars
through native subscriptions; internal aggregates drive signals without updating venue prices or matching twice.
`bar_adaptive_high_low_ordering` supplies an intraminute OHLC/OLHC assumption, not observed trade chronology.

Existing packages, data references and run configurations retain minute versions, native aggregation settings and
runtime identity. Changed data or configuration creates a new sealed run replayed from complete initial state;
there is no partial rewind or stitching of fills from separate runs. Native streaming can consume already bound
inputs in batches, preserving complete equal-`ts_init` boundaries.

Chunking reduces neither total events nor guarantees memory bounds on every reader path. Current
`crates/backtest/src/node.rs::run_streaming` uses a catalog iterator for one data configuration, while multiple
configurations first materialize and merge data through `load_and_merge_data`. Multi-instrument/timeframe memory
targets must verify the actual reader path.

For complete minute data with unresolved chronology, use stop-first for stop/target ambiguity and enter-then-hold
for entry/target ambiguity, marking policy assumptions. Native path heuristics do not automatically implement these
policies; native extension and acceptance are required. Until wired, report unresolved chronology. Missing minutes
or invalid data are gaps, not permission to apply an ambiguity fallback and fabricate a result.

### V0.1 research scale and performance acceptance

Verify one strategy on a shared account with approximately 50 perpetual instruments over five years, rather than
only one instrument over a short window. Scale follows research R-1's 17 majors plus 36 extensions. Freeze actual
contracts and valid intervals using Binance point-in-time facts, binding warmup, minute execution data, historical
marks and economic inputs such as fees/funding. Prototype tickers and the 2018 to 2022 interval are not consumable
Binance perpetual inputs; do not invent pre-listing history.

Record environment, input row counts, cache state, segmented loading/replay/statistics/readback time, peak memory
and resource consumption. Measure first preparation separately from a run on existing data. Reuse does not omit
execution history. Measure before diagnosing native loading, ordering or statistics bottlenecks; optimize native
paths without precision switching or another replay engine. Resource overruns and coverage gaps remain named
failures; shrinking instruments/history or joining isolated results cannot pass acceptance. No execution
measurement of this baseline is available yet; streaming configuration or native APIs do not establish performance.

### Perpetual valuation and execution prices

V0.1 values perpetual unrealized PnL, minute equity and terminal equity with admitted historical mark prices,
reusing native `MarkPriceUpdate` and Portfolio valuation. Limits, stops/targets and simulated fills retain their
frozen trading-data semantics. Market Data supplies separate trade and mark bindings; Backtest checks coverage,
availability and staleness without treating mark-price bars as executable trading data. Native `use_mark_prices`
permits price fallback when marks are unavailable, but that fallback does not satisfy this valuation contract.
Missing or invalid required inputs produce named gaps, not trade-price approximations labeled as mark equity.
Seal valuation and execution inputs separately and identify them in reports.

### Minute primary drawdown and statistical inputs

V0.1 primary maximum drawdown uses one-minute sampled native Portfolio account equity, including unrealized PnL
and incurred fees/funding. List daily closing drawdown separately. Reuse fine-grained native snapshots and
`MaxDrawdown`, connecting minute valuation inputs without another portfolio ledger or analytics engine. The current
analyzer aggregates portfolio returns daily; enabling minute snapshots is not evidence of minute primary drawdown.
That integration and a case with intraday loss followed by daily recovery are first-version acceptance requirements.
Freeze valuation source/time, sampling and same-time event boundaries; retain initial/terminal equity and account
changes and report missing/stale inputs. Minute drawdown does not capture every intraminute extreme or combine
independent instrument highs/lows into a portfolio path. Do not silently change other statistics sampling.

### Bounded minute equity sequence readback

V0.1 result reads let the Agent retrieve minute account equity in bounded batches by exact run/result identity
and interval, for host plotting, drawdown duration, recovery analysis or custom metrics. Return sampling times,
account equity and currency/valuation basis with exact result, valuation source and sampling references; retain
links to initial/terminal equity and account changes. Primary maximum drawdown and readback reuse the same
run's native Portfolio snapshots and sampling boundaries, without another equity calculation or ledger.

Reads return continuation positions and retain the same result version across pages. Large outputs do not fill
one conversation response, and truncation does not imply completeness. Daily closing curves may be summaries
but never replace minute sequences. Report missing or invalid valuation without interpolation, trade-price fallback
or omitted intervals masking gaps. Explain flat intervals from native account facts rather than treating absent
position snapshots as proof of a complete minute path. Protected run detail is not exposed to research.
Agent charts and custom analyses remain host exploration without an upload custody requirement.

For example, two R-1 exit versions may have similar maximum drawdown; the Agent retrieves their minute sequences
to compare time underwater, recovery and repeated declines, then records conclusions and exact result references
in R&D. Readback must align with primary drawdown inputs; existing statistics do not prove this interface delivered.

## TARGET - Consistent capital and execution policy replay

All Backtest runs use sealed initial funds only. They do not support deposits, withdrawals or other external
capital additions/removals during replay and expose no such event input. Equity may change through trading PnL,
fees, funding and valuation; pool/member allocation changes remain internal to the same account. External cash
flows belong to live Execution reconciliation, Portfolio measurement and Governance allocation, not replay inputs.

Sizing policy has no default template. Requests bind explicitly selected templates/parameters or exact frozen
configuration references; missing selection refuses admission rather than using strategy type or engine defaults.
Replay preserves the frozen choice without interactive reselection for each signal or rerun.

Replay returns bind strategy versions and complete account/deployment context: initial account, members and entry
times/rules, pool policy, sizing templates/parameters, leverage/margin/valuation, Risk limits/reservations, exit and
execution policy. Label isolated strategy diagnostics separately from deployed
composition results; an independently funded curve does not establish attainable shared-account returns.

Product-controlled allocation, sizing, queued admission and risk decisions reuse the same versioned domain policies
and native Runtime/Risk/Execution/Portfolio paths under a historical clock. Use sealed data, simulated venues and fact
adapters, never real Governance effects or production MCP/API calls from replay. Add no simplified parallel funds or
order engine. Model asynchronous account/event arrival order explicitly; shared code does not establish identical live
ordering. Changed capital/sizing/composition settings produce new sealed runs and evidence bindings; prior eligibility
does not implicitly cover arbitrary configurations.

Reports retain signal intent, requested/admitted size, rejection/waiting reasons, simulated fills, costs and account
paths. Explain capital/execution effects with common data and frozen controls. Rejected signals cannot count as filled
profitable trades. Historical prices do not reveal user lifecycle actions, network faults or queue position; missing
event histories require explicit scenario assumptions. Preregister sensitivity/stress scenarios for slippage, latency,
liquidity/fills, gaps and internal account allocation without simulating deposits/withdrawals. Report unmodeled gaps
without promising exact returns.

Real trials retain contemporaneous data, policies and account/order events to diagnose signal, sizing, admission,
timing, fill and cost differences. Backtest controls always use frozen initial funds. When the observed interval
contains deposits/withdrawals, do not inject cash flows to reconstruct the account or claim directly comparable
equity. Live Execution, Portfolio and Governance records explain external flows and attribution effects. Preserve
actual facts and simulated results without overwriting evidence or embellishing prospective results. Deployment
eligibility applies only to assessed contexts with valid evidence; freeze exact coverage and decision thresholds.
See [Nautilus backtest/live differences](https://nautilustrader.io/docs/latest/concepts/live/#backtest-and-live-differences).

## TARGET - Composition replay

Composition replay covers passing trials blocked by formal-pool usage: trial policy keeps producing orders/PnL
until formal admission transitions both pools. Waiting trial activity affects subsequent usage/NAV without early
formal allocation or reset evidence.

Replay inputs accept independent version members and a sealed shared account/allocation/risk configuration.
Use native multi-strategy registration, a shared account and one event timeline; do not concatenate separate runs.
Orders, fills, rejections and positions retain exact member/instance attribution. Reports bind account performance,
member contributions, capital competition, margin, costs and actual allocation states. Market Data prepares member
requirements; strategies do not coordinate cross-member data acquisition or funds. The single-strategy product entry
requires extension and acceptance; native `add_strategies` or a multi-leg Artifact alone does not prove readiness.

Composition replay must also support frozen member-entry and allocation-transition policies: wait until all
affected usage fits successor limits, then switch on the same account timeline while retaining old allocation during
waiting. Acceptance covers immediate entry, blocking valid orders/reservations, old-version orders invalidating a
ready transition, and recalculation after equity changes. Unstarted waiting members are not represented as already running.

Prevalidated member-exit plans replay on the same continuous account timeline: both members running, either
member stopping entries with orders cancelled and positions still protected, and the surviving member under the
approved successor allocation. Preserve actual reservations, costs and residual usage; an unload event does not
make locked capital disappear. Do not reset account equity or replace transitions with concatenated standalone
runs. Reports bind the exact plan and state/transition coverage consumed by Qualification and Governance.

Sizing-policy comparisons reuse native fixed-risk calculation as a baseline and provide size inputs under sealed
fractional-Kelly estimation/update rules. Updates use data available at decision time, never full-period win rates
backfilled into past orders. Report capital use, drawdown and concurrent-loss account paths. Preserve proposed and
Risk/execution-admitted sizes separately; theoretical sizes prove neither simulated fills nor deployment authority.

Replay also covers a waiting trial losing current promotion eligibility: no formal allocation until frozen
conditions pass again; if the maximum observation period has ended, stop entries, cancel unfilled entries and
return to R&D while retaining existing position protection. A still-passing capacity waiter remains in trial.

## TARGET - Research reporting and multi-leg replay

Reports are bounded projections of native results, not another fill ledger. Reuse native Portfolio/analyzer
facts for accounts, positions and costs; bind valuation sampling, return units, cost/control versions and
expose trade cards, paired variant differences and event/first-touch diagnostics. Nontrading event studies
produce neither trading NAV nor qualification. Freeze methods/parameters used for assessment. Agents reuse native statistics or their own analysis tools for cross run estimates and judgment; R&D retains method versions, inputs and conclusions. Backtest chooses no winner or stable advantage and adds no general script interpreter.

Missing native inputs produce named gaps, not closed-trade substitutes for portfolio performance. Zero trades,
open positions and partial coverage are distinct.

A paired/multi-leg Artifact binds each instrument, quantity/hedge relation, quote/settlement currency, margin
mode and funding source, with frozen triggers and leg execution/cancellation rules. Backtest reuses native
orders, venues and accounts, reporting per-leg simulated fill sequence, fees, funding, margin, net exposure
and unhedged duration. Spot cash and perpetual margin cannot each reuse the same available funds. Markets
guarantee no atomic fills; a shared candle cannot fabricate simultaneous success. Partial fills, refusals,
unknown legs and exits follow the frozen execution policy for outstanding orders and filled exposure, without
strategy-owned network retries.

Policy must declare unhedged exposure/duration limits, stopping new risk and exit actions. Missing policy or
instrument/cost/capital facts refuse admission without implicit defaults. Replay advances one account timeline
and unified capital/risk accounting. Host/policy/account integration still needs acceptance; native
multi-venue/order capabilities alone do not prove this whole story.

Acceptance compares frozen single/paired controls, funding settlement, second-leg refusal/partial/unknown outcomes,
fees and FX, then reconciles reports against native account facts. Protected jobs isolate credentials/caches/outputs;
diagnostics cannot become a protected-data exit.

## Authoritative facts owned

- Replay identity, deterministic clock, frozen inputs, runtime and simulation versions, and configuration digest.
- Canonical orders, fills, positions, costs, and outcome produced by a replay.
- **CURRENT_PARTIAL:** the complete ordered shared-kernel semantic trace, binding normalized lifecycle events, checkpoints,
  primitive and plugin results, target/protection transitions and fill reconciliation to the canonical replay.
- Native input availability, warmup bounds and actual subscribed data consumption. Missing or not-yet-available input is not evidence of a false strategy condition. Native events and strategy diagnostics explain behavior when needed; the service does not require a frozen program graph, predicate enumeration or a separate per-condition census from arbitrary Python strategies.
- Complete separation between exploratory runs and Qualification-requested protected runs.
- Exploratory Run Result repeats the consumed Strategy Artifact, requested PIT scope, PIT Market Snapshot,
  Universe Selection Record and correction rule, replay configuration, Runtime kernel, simulator, and cost,
  slippage, and capacity-model identities so Research can verify exact request-result equality.
- Existing compatibility results commit a complete finite `diagnosticCategorySet` under a bound
  diagnostic-policy version. Supported members are `NO_EXECUTION_DEFECT`, `MARKET_DATA`, `ARTIFACT`,
  `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`, `SIMULATOR`, `REPLAY_CONFIGURATION`, `VALID_ECONOMIC_FAILURE`, and
  `UNRESOLVED_FAILURE`. It preserves every independently supported simultaneous category and binds each member's
  decisive evidence cut. `NO_EXECUTION_DEFECT` cannot coexist with a defect category; ambiguous or non-isolating
  evidence is `UNRESOLVED_FAILURE`, never a guessed defect or economic result.
- `BACKTEST_OPERATIONAL` binds the exact operational-profile identity and version, run-attempt identity,
  runner/service readiness, backpressure, resource-exhaustion or outage evidence, and fresh Time Evidence. It is
  Backtest-owned operational diagnosis at the Native Replay service boundary, not a Runtime kernel or Sim
  Exchange/Simulator defect, and it blocks economic interpretation until corrected or excluded.
- Protected replay identity binds the exact Strategy Artifact, requested PIT scope, PIT Market Snapshot and
  Universe Selection Record identity and digest, calendar/session/time-zone, corporate-action and historical-membership
  cuts, Market Semantics Compatibility identity, snapshot and correction rule, replay-configuration digest,
  Runtime kernel, simulator, cost, slippage, and capacity model versions, and the exact Candidate/Intake protected
  decision-policy identity and version before execution. It also repeats the frozen Protected Robustness Plan
  identity, required cell identity, metric set, coverage rule, tolerances, thresholds, aggregation, missing-cell
  policy, and stop policy before any protected observation.
- Protected Run Result repeats the actual consumed counterpart of every protected-request field and the protected
  policy pair and requires exact request-to-result equality. It declares `PROTECTED_EVALUATION` as its canonical
  `timeEvidenceCutKind`, directly binds the request Time Evidence, and seals the result-stage clock cut for the
  exact request, attempt, plan, and plan cell.
- Backtest Repair Result binds one R&D-owned `native-repair-request`, exact `SIMULATOR` or
  `BACKTEST_OPERATIONAL` category, predecessor repair decision, stable correlation, original proof digest,
  category-specific old identity and source cut, repair policy, decisive evidence, and fresh Time Evidence.
  Backtest alone commits `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for that attempt.

## Modules

- **Native Replay** - replay historical events with deterministic time while reusing the native Runtime, Risk, and order semantics where applicable.
- **Sim Exchange** - model venue acceptance, latency, fills, fees, and account effects without external writes.
- **Run Result** - bind consumed data, artifact, configuration, orders, fills, costs, and terminal outcome into one canonical receipt.

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself. No row below is `IMPLEMENTATION_ADMITTED`: every row grants nothing, and widening the
admitted set requires changing this document first.

- **CURRENT_PARTIAL - ordered shared-kernel semantic trace:** the ordered vocabulary and its fail-closed census
  live in `crates/backtest_owner_contracts/src/native_replay_trace.rs`, and both the producer and the Backtest
  Owner apply that census before trace bytes are sealed, so a trace that skips a checkpoint, repeats a lifecycle,
  or leaves a native fill unreconciled is a fault and commits nothing. One vertical reaches it: the Sim `EVENT`
  consumer is the only caller of the census outside its own module, and no other vertical produces a trace.
- **CURRENT_PARTIAL - durable Result custody and R&D locked read:** see the section of the same name for what the
  ordered chain proves. Neither `crates/backtest_owner/Cargo.toml` nor `crates/backtest_result_custody/Cargo.toml`
  declares a `[features]` table, so this custody path is the same code in every build.
- **CURRENT_PARTIAL - exploratory Run Result views to Product Edge:** the Dashboard read API resolves exact
  canonical Result bytes through `resolve_exploratory_replay_result_v2`, composed in
  `crates/strategy_factory_rd_owner_api/src/dashboard_read_api.rs`, and only for a Result its TrialFamily census
  counts ([R&D](./rd/), "CURRENT - every committed exploratory Result is counted").
  `product/rd-workbench/Dockerfile.owner` builds and installs that binary. The ordered chain covers the refusal with
  `replay_result_dashboard_read_api_refuses_a_result_no_census_counts`, and a counted Result opening through the
  deployed read API with `backtest_run_report_browser_acceptance_reads_the_owner_answer`. This is the one Backtest
  output handoff that is reachable end to end in what is deployed.
- **CURRENT_PARTIAL - production entry for exploratory replay:** the replay is implemented and proven, and nothing
  in the deployed artifact can enter it. `run_exploratory_replay_v2` has exactly one caller outside its own crate,
  `crates/strategy_factory_rd_owner_api/src/exploratory_replay.rs`, and that caller sits under
  `#[cfg(feature = "native-replay-execution")]`, a production feature, while the image builds
  `--bin strategy-factory-rd-owner-api` with `--features composer-v3-replay` only. That measures the deployment
  artifact, not history. The other public commit path, `commit_exploratory_replay_result_v2`, has callers only
  inside the `#[cfg(test)]` module of `crates/backtest_owner/src/lib.rs`.
- **CURRENT_PARTIAL - protected observation:** Backtest derives the observation from the canonical result of the
  run it executed, and it can now learn which observation was frozen for that run:
  `derive_protected_economic_measurement_v1` computes and seals it from canonical Result bytes, and
  `ResolvedProtectedReplayRequestSetV1::economic_computation` resolves the metric and the coverage rule from the
  bundle the request set carries, so a caller selects a published computation and describes none. What remains is
  upstream of both. No production code constructs a `ProtectedEconomicPolicyBundleV1`, whose construction sites
  all sit inside `#[cfg(test)]` modules, and the step that would seal one into a request set is called from
  the ordered gate's entries and nowhere else, which [Qualification](./qualification/) states for every step of
  that terminal. Backtest can select the computation, and nothing outside the gate produces the selection.
- **CURRENT_PARTIAL - readable economics of a replayed run:** the V4 BAR joined-cut consumer returns the
  canonical result of its run beside the deterministic receipt, and `OwnerBacktestReportV1` in
  `crates/strategy_factory/src/owner_backtest_report_v1.rs` reads that result into the run's executions,
  return series, net return and maximum drawdown. Maximum drawdown is derived rather than read: the default
  `PortfolioAnalyzer` registers twenty statistics and `MaxDrawdown` is not among them, so no canonical result
  carries it, and the report computes it from the return series with that same statistic rather than with a
  second implementation of it. Net return and maximum drawdown are absent rather than zero when a run recorded
  no returns, so an unavailable number and an earned zero stay distinguishable. The ordered chain prints the
  report for `owner_postgres_v4_moves_through_program_host_and_real_backtest`, which feeds one BAR and so
  reports a run that executed nothing. No production caller reads the report and no Owner consumes it; the
  Dashboard's run report handoff below reads it from committed custody.
- **TARGET - production driver for the protected economic measurement:**
  `derive_protected_economic_measurement_v1` and `produce_and_commit_protected_replay_result_v3` are complete
  implementations with no production caller, and that is the documented design rather than a gap:
  [Qualification](./qualification/) states who may drive a protected evaluation and states that the ordered gate
  is the only driver of the eligibility terminal. Building a production driver therefore means changing a bound
  that document states, which needs the user's authorization first. This row deliberately does not repeat that
  bound's wording, because a second copy of one fact drifts when only one copy is edited; read it there. Two
  things a future driver will need are worth recording here rather than rediscovering: the validator in
  `crates/backtest_owner/src/protected_replay.rs` rejects a result whose cell is applicable and carries no
  execution defect unless a sealed measurement accompanies it, so the measurement is a precondition rather than
  an enrichment; and the exploratory path is separate, so nothing here blocks an exploratory Run Result report.
- **UNAVAILABLE compatibility interface - `REPAIR_VALIDATION` request and result:** no implementation exists. `REPAIR_VALIDATION` and
  `RepairValidation` appear in no file under `crates/` or `product/`.
- **UNAVAILABLE compatibility interface - `SIMULATOR` and `BACKTEST_OPERATIONAL` repair:** no Backtest repair surface exists. The only
  `repair` occurrences in the four Backtest crates are the comments in `crates/backtest_owner/src/postgres.rs`
  recording that custody is never repaired, and `BACKTEST_RUNNER_SERVICE` appears in no Rust file while
  `product/dashboard/lib/rd-iteration-timeline-client.ts` already lists it as a legal repair target. The consumer
  vocabulary exists and the producer does not.
- **CURRENT optional computation; report integration unavailable - exploratory statistics:**
  `vibe-backtest-statistics` computes both from values; no exploratory Result carries them yet, and no exploratory
  replay accrues funding. The optional calculation is described below; it is not a native report prerequisite.
- **UNAVAILABLE optional Forward Record interface - Forward Replay:** no Forward Replay exists. A Forward Replay replays one frozen Artifact incrementally
  over each newly observed cut of a Qualification Forward Record, on exactly the registered Runtime kernel,
  simulator, cost, slippage and capacity identities. Resting orders and open positions carry from cut to cut in
  Backtest custody, and a fill is admitted only from data observed after its order existed. It uses the one Sim
  Exchange the protected replay used, never a separate forward implementation, creates no Execution effect, and claims
  no Runtime kernel or Simulator repair.

## Native strategy and actual consumption evidence

Backtest loads the exact [native strategy package](../architecture/strategy-factory/#strategy-package-and-content-identity), environment, parameters and Owner input bindings.
Native Engine/Strategy handles lifecycle and order commands; Sim Exchange produces simulated acceptance, fills, refusals and account effects, without a product strategy interpreter.

Backtest retains actual ordered events, commands, fills, protection changes, accounts, costs and terminal outcomes, not their research/deployment meaning.
Multiple resolutions, dynamic members, legs or strategies require actual ordered consumed versions/frames; one frame or standalone strategy cannot attest the complete run.

Only Backtest execution generates actual consumption records. Callers/R&D propose requests but cannot supply or deserialize proof of the consumed side.
Results bind package, parameters, dependencies/environment, input receipts/cuts, configuration, native engine/simulator identity, cost/slippage/capacity models, seeds, window, calendar/time zone and event/result digests.
Missing or mismatched evidence produces no positive receipt; matching caller DTOs cannot prove execution.

Current ProgramHost/Plan receipts are compatibility readbacks, not target native package loading evidence. Migration preserves actual input verification, sealed Owner readback and immutable results rather than dropping checks after renaming.

### CURRENT_PARTIAL - durable Result custody and R&D locked read

The Backtest Owner owns the private canonical Result table and its append-only outbox, and only the Backtest
writer may perform DML.

The fixed `SECURITY DEFINER` `owner_api` lock/read functions `resolve_exploratory_replay_result_v2/v3` exist, and the
ordered PostgreSQL chain proves positive locked readback, function-source drift, Owner API sibling-routine,
raw-table ACL drift, inherited-owner-membership and owner-attribute drift rejection, topology-fence
serialization, mid-commit rollback, restart-exact readback, and R&D read-only access (the `vibe-backtest-owner`
entries whose test names begin with `postgres_result_` in `scripts/ci/test-rd-owner-postgres.bash`; the `postgres_protected_result_`
entry is deliberately not among them).

Backtest remains the sole authority for the result fact, and Protected Result custody remains isolated and is
not readable through this R&D seam.

The Backtest Owner exposes one fixed, safe-`search_path`, `SECURITY DEFINER` `owner_api`
lock/read function. Its fully qualified reads lock the exact Result, receipt, and outbox rows and return an
untrusted envelope inside the caller's already-open PostgreSQL transaction. A locator or dependency-neutral
contract is only a query and carries no Result authority.

The target dependency-neutral `vibe-backtest-result-custody` adapter validates the schema, function, and table owners,
installed function source, `SECURITY DEFINER` setting, table and function ACLs, canonical Result bytes and
digest, request correlation, Backtest receipt, and outbox binding before constructing a non-forgeable positive
readback. It accepts a caller-supplied transaction only; opening a separate pool or transaction cannot produce
a readback usable for an R&D decision.

This preserves the acyclic crate direction `vibe-strategy-factory -> vibe-backtest-result-custody -> vibe-backtest-owner-contracts`: the custody adapter does not depend on
`vibe-backtest-owner`, while `vibe-backtest-owner` retains Result construction and write authority. Missing,
stale, cross-spliced, wrong-owner, wrong-function, ACL-mismatched, noncanonical, digest-mismatched,
receipt-or-outbox-incomplete, or separately read custody is `UNAVAILABLE`. After response loss, exact
`RESOLVE` may return only the same pre-existing byte-identical Backtest Result and receipt; it
cannot create first custody, recompose a result, or append a second Result, receipt, or outbox event.

Admitted on that disposable PostgreSQL proof; it still grants no Dashboard implementation, deployment,
production write, provider effect, Paper, Live, or trading authority.

The same seam lists one request's Results. `read_exploratory_replay_result_directory_v1` takes the request identity and its meaning
digest and is the fifth `owner_api` function: fixed, safe-`search_path`, `SECURITY DEFINER`
and `STABLE`, executable by `rd_owner` alone, and pinned by the same topology census as
the others. Each entry states `attempt_identity`, `result_identity`, `terminal` and the
receipt's `committed_at_epoch_ms`, ordered by that time and then by attempt.

Backtest keeps no attempt table, so an attempt appears here only as a terminal Result: an attempt still in
flight, or one that failed before any Result, is R&D's to state, while a rejected run is listed with its own
terminal. The directory is complete or it is nothing. A listed Result whose receipt or outbox event is missing
refuses the whole read as `EXPLORATORY_RECEIPT_ABSENT` or `EXPLORATORY_OUTBOX_ABSENT` rather than listing fewer Results than
exist, and the adapter checks that every entry's receipt and outbox state the same request, meaning digest and
Result.

A request under which Backtest holds no Result answers `EXPLORATORY_REQUEST_RESULTS_ABSENT`, read as an empty directory:
Backtest holds no request table, so it cannot tell an unknown request from one with no Result yet. A Result
held under the same request identity and another meaning digest refuses the read as `EXPLORATORY_REQUEST_MEANING_MISMATCH`, and
more than 256 Results refuse it as `EXPLORATORY_REQUEST_RESULTS_EXCEED_BOUND`. The read takes no row lock: it runs inside a
`READ ONLY` transaction and holds only `AccessShareLock` and the topology fence every Backtest
read takes.

It states which Results exist and their terminals, never whether a report can be stated, which stays the
report read's judgement, and it lists no Protected Result.

## Reports and optional diagnostics

### Native report delivery

Once connected to completed results, `GET /v1/backtests/{run_id}/report` states the strategy the run's registry row names by
  `strategy_id` and its sealed native package: content digest, Git provenance, entry point, parameters and fixed
  execution environment. The report describes the actual consumed input manifest, including multiple instruments
  and native aggregations. Recompiling an authoring-language document is not a native prerequisite.
This is the target report route, not evidence that the current compatibility reader resolves completed results.

### Optional exploratory statistics

**CURRENT computation; report integration not connected.** `crates/backtest_statistics` provides
`matched_entry_control_v1` and `round_trips_from_fills` as pure functions over explicit values. Agents may use
admitted deterministic calculations or their own research scripts and record the inputs, method version and
interpretation in R&D. An exploratory report does not require this diagnostic, and it cannot replace independent
Qualification or turn an invalid run into economic evidence.

The existing V1 calculation takes bar opens and times, round trips, a cost per side, an optional per-bar funding
schedule and a seed. It returns an input digest. For each trade it samples 20 entries in the same UTC year and
side, with the same holding duration; both ends use bar opens. It computes net return after the stated costs and
funding, then an ISO-week clustered interval using 4,000 resamples and the 2.5th/97.5th percentiles. These constants
identify this function version; they are not a required research method or a new configuration framework.

This calculation does not replay strategy stops or targets and is not research T0's ATR-risk control. Do not
infer arbitrary Python exit rules from fills, or present these two controls as equivalent. Missing funding is
explicitly `funding_stated: false`, not zero-cost perpetual evidence. Any input used in a product report must
resolve the run's exact immutable data binding; newer bars or a different funding revision cannot substitute.
The native report's required evidence remains actual orders, fills, positions, costs and minute-level account
valuation. A request for an additional control that needs strategy execution is a separately registered native
replay chosen by the Agent, not an automatic second simulator hidden in report assembly.

### Run report document

**CURRENT compatibility assembly; IMPLEMENTATION_ADMITTED reader with incomplete result integration.** `backtest_run_report_document_v1` assembles a
`backtest.run` report from values: the run's four-question report, its fills, the bars its pinned custody head reads
back, its funding when stated, its instrument's taker fee rate and its request identity. It reads no Owner and no
clock.

- **The four questions stay four.** The Dashboard's `BacktestRunReport` answers exactly four questions about a single
  run (`docs/guide/dashboard.md`), and the run report carries it whole under `report`, unchanged. What a run report
  adds sits beside it, so the Dashboard contract gains no fifth field.
- **Standing.** `standing` is `EXPLORATORY_ONLY` and `holdout` is `NO_HOLDOUT_PARTITION_DEFINED` until Qualification
  registers its holdout partition.
- **Pricing.** `pricing` names how the run was priced:
  - `fills`: each order is decided at its frame's BAR close and filled at that frame's quote cut, as the target-set
    Host states;
  - `fees`: at the instrument's sealed terms;
  - `funding`: `STATED` or `NOT_STATED`;
  - `control`: at bar opens.
- **Fees.** `fees` totals the run's commissions exactly, one decimal per currency.
- **Control.** `control` is the matched-entry control of the section above, over the run's fills paired into round
  trips, seeded from the request identity.
- **Refusals.** Each is named: a fill this report cannot read (`REPORT_FILL_UNREADABLE`), a commission that is not
  an amount and a currency (`REPORT_COMMISSION_UNREADABLE`), fills that do not pair into round trips
  (`REPORT_FILLS_NOT_ROUND_TRIPS`), and inputs the control cannot measure (`REPORT_CONTROL_UNMEASURABLE`).
- **Pinned bars.** The bars are read from Market Data at the run's pinned custody head, cut there, so a chain that has
  since moved on still reads what the run read and is not refused. A pinned head no longer in the chain is refused
  as Market Data names it (`PitWindowHeadNotInChain`), and bars that do not match the run's bundle digest are
  refused as `REPORT_BARS_DIGEST_MISMATCH`.
- **Compatibility input refusals.** The current
  single-threshold compatibility reader retains `AUTHORED_STATEMENT_NOT_REPRODUCED` and
  `REPORT_DATA_WINDOW_NOT_SINGLE` for its admitted input shape; these refusals do not restrict the native target.
- **Data window.** A custody run's window is read from its pinned custody binding, not from a PIT snapshot: the
  instrument is the dataset_ref's, which is the chain's one member; the granularity is the bar label Market Data
  declares for the execution timeframe; start and exclusive end are the binding's run window; the cut is the pinned
  head identity, and the count is the one custody cut the run binds. A chain that has since moved on still states
  the window the run read.
- **Current route integration.** The route unconditionally answers `RUN_HAS_NO_RESULT` for recorded runs,
  carrying their recorded replay state. Native execution can commit a result through the feature-gated service,
  but that does not connect this HTTP reader to the result. Target report delivery resolves the committed result
  identity, reads its exact bindings and assembles the document; custody issuance alone is insufficient.

### Optional replication comparison

`crates/backtest_statistics` provides `compare_replication_v1` and the `t0-replication` CLI to compare two
explicit trade lists. The existing T0 compatibility profile keys trades by instrument, side and entry day,
compares exit days, excludes its first 200 warmup bars and incomplete terminal exits, and checks entry prices
against execution bar opens within the instrument tick. Its 99.5% threshold identifies that profile rather
than a product-wide strategy gate.

An Agent chooses an appropriate reference and preregisters comparison assumptions for the new native experiment.
Differences in position mode, target-price basis, data or costs must be reported, not hidden to pass a historical
number. The function does not require an authoring-language document, build native packages or verify complete
R-1 matching. Native acceptance compares actual order, fill and account events under the frozen experiment.

## Input handoffs

- R&D passes the complete sealed Exploratory Replay Request value through the typed downward port. It binds request identity, canonical meaning/digest, Artifact, PIT scope, Intent, costs/slippage/capacity and execution models. The upper boundary resolves producer custody before admission; Backtest checks its own exact input binding/current applicability and records its attempt/result without rereading R&D. Missing, stale, conflicting or unknown inputs retain their named no-attempt/unresolved meanings; no field is defaulted, fabricated or silently replaced.

**Locator protocol compatibility.** The following existing locator-resolution rules preserve sealed request and receipt meanings only; their reverse R&D read is a migration obligation, not a target layering exception. Migration relocates canonical resolution to the upper admission boundary while retaining exact bytes, stable cut, digest equality, unknown/no-write and same-identity recovery:

- [R&D](./rd/) submits one frozen Exploratory Replay Request, addressed by an R&D-owned locator carrying the
  request identity, the canonical request meaning digest, the receipt identity and the seal digest. Backtest
  re-resolves that locator through the fixed read-only R&D Owner port and verifies the canonical request bytes
  against the digest before any other field is read; a locator label, a downstream attestation, or a
  caller-supplied copy of the bytes is not the request. The request fixes the exact immutable Artifact, the
  requested PIT data scope, the replay configuration, the same cost, slippage and capacity-model versions frozen
  by its Research Intent, and every other component of the requested meaning that a positive terminal result must
  reconcile exactly. Backtest may observe `AVAILABLE`, `STALE`, or `UNAVAILABLE` on the R&D side; only
  `AVAILABLE` admits an attempt, and neither `STALE` nor `UNAVAILABLE` is a rejection of the request, because
  both say only that this Owner cannot presently supply it. A locator that resolves to nothing, bytes whose
  digest disagrees, a request whose meaning changed under the same identity, and an R&D port that does not answer
  all produce no attempt and no result: silence is never `UNAVAILABLE`, and `UNAVAILABLE` is never a terminal
  replay outcome. Backtest never reconstructs, defaults, or substitutes any requested component, never treats
  equality between two caller-authored representations as request-result correlation, and never begins an attempt
  for a request whose canonical bytes it has not itself verified.
- On the existing compatibility interface, an admitted `D1_EXECUTABLE_REPAIR` makes R&D submit a distinct `REPAIR_VALIDATION` request bound to the D-only
  repair admission, predecessor and successor Artifacts, defect oracle, complete non-defect regression corpus,
  frozen semantic-equality proof, and deterministic event/signal/intent/order trace comparison. It is never an
  exploratory or protected request.
- [Qualification](./qualification/) sends a frozen protected request created only after `ADMITTED` intake and
  holdout reservation, with every execution-defining identity and exact Candidate/Intake protected policy pair
  fixed. Each request addresses one declared Protected Robustness Plan cell or the exact frozen bounded matrix;
  Backtest cannot choose cells after observing results. Admission rejection must still commit a request-bound
  `RUN_REJECTED` result.
- [Market Data](./market-data/) supplies the frozen point-in-time facts and instrument terms one replay consumes:
  the PIT Market Snapshot identity and digest, the Universe Selection Record identity and digest, the snapshot and
  correction rule, the corporate-action and historical-membership cuts, the Market Semantics Compatibility
  identity, and, per instrument, the sealed fact digest, receipt digest and terms digest together with the venue,
  quote and settlement currencies, validity window, margin model and fee terms. Backtest consumes these as
  Owner-sealed receipts; it does not query a store, select a slice, or accept a caller-supplied fixture in their
  place. A receipt is either sealed and resolvable for the exact request-bound scope or it is not, and there is no
  partial or provisional form: only a complete set covering every requested instrument and the whole requested
  scope admits execution, and a set that covers the scope by substituting a neighbouring cut, a later correction
  frontier, or a different membership does not. An absent receipt, an unresolvable identity, a digest that
  disagrees, an instrument outside the request-bound universe, a validity window that does not contain the
  requested cut, or more than one settlement currency where the computation admits one, each fails before
  native package execution and produces no positive receipt, because a data gap is a replay-evidence fact and
  never an economic result. Backtest never infers a missing price, term, or membership, never silently changes
  costs, never substitutes a different snapshot or simulation version, and never lets telemetry or a projection
  stand in for a sealed receipt.
- The existing compatibility contract additionally defines one frozen `SIMULATOR` or `BACKTEST_OPERATIONAL`
  `native-repair-request`. `SIMULATOR` targets only Backtest's Sim Exchange surface `sim-exchange`;
  `BACKTEST_OPERATIONAL` targets only Native Replay's `BACKTEST_RUNNER_SERVICE`. Wrong target, category,
  predecessor, proof, old identity, source cut, policy, time, or
  changed meaning creates no Backtest repair attempt or result.

These two upstream contracts are no more admitted than the upstream states them to be: the corresponding
[Market Data](./market-data/) output handoff marks direct `BACKTEST_OWNER_V1` Instrument Master resolution
**TARGET**, so nothing here may be read as an admitted consumption path. The exploratory path is also
unreachable in what is deployed: the only caller of `run_exploratory_replay_v2` outside its own crate sits under
`#[cfg(feature = "native-replay-execution")]`, a production feature, and `product/rd-workbench/Dockerfile.owner` builds `strategy-factory-rd-owner-api` without it.
That measures the deployment artifact and not history; it says nothing about whether the path has ever run in
some other environment.

## Current compatibility output handoffs

The typed diagnostic and repair records below govern consumers of the existing compatibility schemas. Native research submission does not require this scientific classification or repair workflow. Native service failures retain task identity, actual errors and logs; the user repairs and deploys server changes. Strategy corrections create a new sealed package and experiment. Invalid, interrupted, unknown or input-mismatched runs remain unusable as economic or qualification evidence. Protected diagnostics stay inside Qualification.

- To [R&D](./rd/): exploratory Run Results with the complete finite `diagnosticCategorySet` and each
  member's decisive evidence cuts. Any execution-defect member preempts economic interpretation and Research
  chooses one repair under its frozen precedence while preserving all supported members. Only a set with no
  defect may use `NO_EXECUTION_DEFECT` or `VALID_ECONOMIC_FAILURE` for economic interpretation;
  `UNRESOLVED_FAILURE` permits no decision.
- To [R&D](./rd/): for `REPAIR_INPUTS_SIMULATOR` or `REPAIR_INPUTS_BACKTEST_OPERATIONAL`, Backtest alone returns
  the exact request-correlated `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN`. `REPAIRED` names a new simulator
  or operational-profile identity and permits only one new request-equal Replay Request bound to the exact
  predecessor `REPAIR_INPUTS` decision, category, native repair request and result identities, original proof
  digest, stable correlation, predecessor and successor native identities and cuts, and unchanged predecessor
  request semantics. `BACKTEST_OPERATIONAL` includes the successor operational-profile identity and cut. Only
  `REPAIRED` permits re-entry; `UNAVAILABLE` permits
  only the correlated `STOP_INPUT_UNAVAILABLE`; `OUTCOME_UNKNOWN` permits no stop, retry, successor, Artifact,
  Selection, or Replay Request. None mutates or retries the consumed run attempt.
- Only a request-equal exploratory `TERMINAL_RESULT` is selection-eligible; rejected, invalid, unknown,
  non-terminal, or mismatched attempts remain TrialFamily Census facts only.
- To R&D's attended repair path: one request-equal passing `REPAIR_VALIDATION` result may support
  `D1_VALIDATED`; a failed, rejected, invalid, unknown, or unequal result supports no Candidate and cannot be
  relabeled as research evidence. R&D alone commits the D-only Repair Disposition.
- To [Qualification](./qualification/): sealed Protected Run Results that repeat every consumed execution-defining identity for exact equality checking, plus complete consumed-input evidence only.
- To Product Edge: read-only exploratory Run Result views only; protected requests, measurements, results, and holdout details are never projected.
- To the Dashboard, two handoffs, and each carries only what it names:
  - The result readback, `resolve_exploratory_replay_result_v3` behind
    `exploratory_replay_result.shadow_read.v2`, carries the canonical result bytes and nothing derived from
    them. Its entry in `product/dashboard/lib/operation-registry.ts` permits `terminal`,
    `reconciliation_summary`, `diagnostic_summary` and `semantic_trace_presence`, and no economic field.
  - The run report, `resolve_backtest_run_report_v1` in
    `crates/strategy_factory/src/backtest_run_report_read_v1.rs`, carries the named `BacktestRunReport`
    fields. What the run produced is what `OwnerBacktestReportV1` derives from those same committed
    bytes: the run's result, request and attempt identities with the engine-result digest its outcome
    evidence binds, an Owner-decided state (`AVAILABLE` or `EMPTY`), every return observation the run
    recorded in canonical UTC, net return, maximum drawdown, and every execution with its side and with
    price and quantity exactly as the engine wrote them. It carries no statistics map, because those
    legitimately hold non-finite values. An `EMPTY` report also names why the run recorded no return, as
    `empty_reason`, derived from those same bytes and nothing else. The engine's own rule decides it:
    `Portfolio::statistics` takes daily equity returns from the portfolio snapshots
    (`calculate_snapshot_returns`) and, when those resolve to nothing, the return of each closed position. A run
    records no return exactly when the snapshots resolve to nothing and it closed no position. The reason is the
    first cause the engine's snapshot resolution meets, in its own order:
    - `MORE_THAN_ONE_EQUITY_CURRENCY`: a priced snapshot of one of the run's accounts carries more than one
      equity, or two such snapshots carry different currencies.
    - `ACCOUNT_WITHOUT_PRICED_SNAPSHOT`: the run has no account, or one of its accounts has no priced snapshot,
      because every snapshot of it names an unpriced instrument.
    - `FEWER_THAN_TWO_ENGINE_DAYS`: the priced snapshots give fewer than two days on which every account has had
      equity, as the engine counts days, carrying each account's equity forward. `snapshot_day_start` files each
      account's first priced snapshot, and any snapshot exactly on a UTC midnight, under the previous day, so a
      one-account run has two days as soon as it has a later snapshot not on a midnight. A run without a fill is therefore `AVAILABLE` with a return of
      zero, and having a fill is not a reason.
    - `NO_DEFINED_DAILY_RETURN`: two or more such days, but no day's return is defined, because each needs a finite
      ratio to a previous day's non-zero equity.

    A canonical result that is `EMPTY` although it closed a position, or although its snapshots resolve to a daily
    series, is not one the engine writes, and it is refused as `ENGINE_RESULT_NONCANONICAL` rather than given a
    reason. Every input the rule reads is in the committed bytes: the accounts' identities, each portfolio
    snapshot's account, `ts_event`, `total_equity`, `base_currency_equity` and `unpriced_instruments`, and each
    position's `ts_closed` and `realized_pnl`. The projection asks the engine's resolution itself for its cause
    rather than keeping a second copy of the rule. What reaches each reason today:
    - `FEWER_THAN_TWO_ENGINE_DAYS`: a run whose snapshots all fall on one midnight, which
      `a_run_whose_snapshots_all_fall_on_a_midnight_reports_empty` runs with a control a minute later; and any run
      on the epoch's first day, where the previous day cannot go below day zero, such as the sealed frame at 25 ns
      that `an_authored_universe_member_program_enters_once_through_the_target_set_sim` uses. F's single frame is
      not one: its registration snapshot is at the frame's midnight and its fill snapshot after it, so it is
      `AVAILABLE` with one return.
    - `MORE_THAN_ONE_EQUITY_CURRENCY`, `ACCOUNT_WITHOUT_PRICED_SNAPSHOT` and `NO_DEFINED_DAILY_RETURN`: no run,
      because every admitted account holds one currency, prices its instruments and starts with non-zero equity; a
      projection test over edited snapshots reaches each.

    The key is always present: `null` in an `AVAILABLE` report, one of the set in an `EMPTY` one. The strategy and the data window are not in a backtest result,
    so they come from upstream: the replay request the run answered, and the Design and program
    frozen under the Design it names. All three reads run in one transaction the report opens as
    `SERIALIZABLE, READ ONLY, DEFERRABLE`: a safe snapshot the three share, with the request storage
    function's isolation rule kept (it answers only under `read committed` or `serializable`, because
    under `repeatable read` its snapshot predates its request fence), and PostgreSQL refusing any row
    lock on the path. Waiting for that snapshot is bounded, and a report that runs out of time is
    refused as `REPORT_SNAPSHOT_UNAVAILABLE` rather than left waiting. The request is read through `rd_owner_api.read_exploratory_replay_request_v2`, which
    takes none; `resolve_exploratory_replay_request_v2` keeps its lock for the caller that writes
    afterwards and reads through the same function. The strategy is stated only
    for the admitted single-threshold family, and only when authoring the statement read back from that
    frozen pair reproduces the pair's canonical program exactly; any other run is refused as a whole
    for that named reason. The family carries no version, so a program an earlier author froze and the
    current author no longer reproduces is refused the same way. A run inside the family is stated only
    when the frozen program is anchored to the artifact the run executed: the request names a Design,
    not the program its artifact was built from. The anchor is the artifact's Composer build receipts,
    read through the Composer Owner's lock-free receipt read inside the report's transaction: there
    must be at least one, and every one must be a V3 plugin build carrying the freeze's
    `joint_freeze_digest`, which the report derives again from the freeze row. A V2 build carries no
    freeze and never anchors. An unanchored run is refused as `STRATEGY_NOT_ANCHORED_TO_RUN`, and
    receipts that cannot be read as `ARTIFACT_BUILD_RECEIPTS_UNAVAILABLE`. A legacy request's artifact was not built by Composer,
    so it never anchors. A Composer V3 request is read through its self-verified claim, without a lock, in
    builds with the Composer-backed Replay feature, and refused as `REPLAY_REQUEST_V3_NOT_YET_REPORTED` in
    builds without it, the deployed image among them. No in-family run has yet been stated end to end:
    no ordered-chain entry commits a Composer V3 run. The channel is
    stated as the run read it - role, instrument, fact, timeframe, unit and scale - and not in the form
    its request authored it, so an authoring form that names the instrument indirectly still yields
    those six fields, and a change to how a channel is authored does not change this handoff. The
    universe-member form names its instrument only through the run's universe selection. The report reads
    that selection's included members in its own transaction through Market Data's lock-free R&D read,
    `market_data_rd_api.read_universe_selection_for_rd_v1`, and states the channel on the frozen Design's
    CLOSE role with the one included member's Instrument Master identity as its instrument. A selection
    that does not include exactly one member is refused as `UNIVERSE_SELECTION_NOT_ONE_MEMBER`, and one
    that cannot be read or does not verify as `UNIVERSE_SELECTION_UNAVAILABLE`. The data window is the channel's instrument and timeframe, the request's
    window with an exclusive end, the number of PIT snapshots the request binds, and that snapshot's
    identity as the cut.

  The series is not one point per bar: portfolio returns are daily, and a run whose portfolio snapshots
  span fewer than two UTC days falls back to one return per closed position. Every series value, the net
  return and the maximum drawdown are fractions, where 0.01 is one percent, and that is all this handoff
  states about them.
  It does not say which return they measure. A daily point is an equity return, a closed-position point is a
  price return that ignores position size, and nothing in the handoff yet carries which of the two a run
  produced. So no consumer may present these numbers as an equity return until the handoff carries that
  basis, read back from the canonical result. The run
  report has no HTTP caller yet. Its PostgreSQL proof reads back a real engine run, but that run reaches
  custody through the acceptance module's own writer rather than through `run_exploratory_replay_v2`, which
  no ordered-chain entry drives, and its program is outside the family, so the chain proves the refusal
  and the result half. A run inside the family is not constructible in the chain today: no entry
  composes a replay request from an authored Design.

## Rejections and prohibitions

- Never infer missing data, silently change costs, or substitute a different artifact or simulation version.
- Never mix exploratory and protected results or expose protected results to the same research loop.
- Never treat replay survival, statistical significance, or a single holdout as deployment authority.
- Never own Eligibility State, lifecycle state, capital, live orders, or account truth.
- Never interpret a Run Result as deployability; only Qualification can consume protected evidence into Eligibility State.
- Never discard one supported diagnostic because another is present, or let duplicate or ambiguous evidence
  become a guessed repair target; preserve supported members and classify non-isolating evidence as
  `UNRESOLVED_FAILURE`.
- Never relabel runner readiness, backpressure, resource exhaustion, or a service outage as `RUNTIME_KERNEL`,
  `SIMULATOR`, valid economics, or unresolved when the operational evidence is decisive.
- Never accept `RUNTIME_KERNEL` as a Backtest repair, rewrite a repair result for changed meaning, or treat request
  delivery, acceptance, silence, or telemetry as a terminal native repair result.
- Never expose a protected result through Product Edge, even as a read-only view.

## Failure and recovery

Data gaps, invalid instrument terms, non-determinism, or an omitted substituted or mismatched Artifact, PIT
scope, PIT Market Snapshot identity, Universe Selection Record identity or digest, snapshot rule, replay
configuration, Runtime kernel, simulator, cost, slippage, or capacity model terminate as `RUN_REJECTED`
or `INVALID_REPLAY_EVIDENCE`. These are replay-evidence facts, never Candidate admission or Eligibility.
Qualification records the corresponding terminal attempt disposition and preregistered holdout closure without
calling it `INELIGIBLE`; only `IN_PROGRESS_OR_UNKNOWN` remains unresolved.

A protected run that cannot preserve isolation is not downgraded to exploratory evidence. Reproduction starts
from the frozen receipt, not from reconstructed defaults.

A decisively identified runner readiness, backpressure, resource-exhaustion, or service-outage failure is
`BACKTEST_OPERATIONAL`. It preempts economics and routes correction only to Backtest's operational profile and
runner service; it never claims a Runtime kernel or Simulator repair. On the protected path Qualification consumes
only the sealed category as `DIAGNOSTIC_INVALID`, closes holdout under the preregistered policy, emits no
Eligibility Fact, and exposes neither the operational evidence nor protected detail to R&D or Product Edge.

## Decision contract

- **Inputs** - one frozen exploratory or protected Replay Request plus exact admitted PIT snapshot, artifact,
  runtime, simulator, cost, slippage and capacity identities.
- **Diagnosis and decision** - admit or reject the exact request, establish runner/service operational readiness,
  replay deterministically, and commit actual consumption, operational diagnosis, and terminal result without
  interpreting deployability.
- **Conflict resolution** - request identity and namespace determine the run; changed meaning is rejected and
  replay joins the same result rather than substituting defaults.
- **Outputs and terminal negatives** - Run Result or `RUN_REJECTED`, `INVALID_REPLAY_EVIDENCE`, and
  `IN_PROGRESS_OR_UNKNOWN`; every branch remains factual evidence only.
- **Feedback and economic meaning** - expose net-of-cost behavior and reproducibility so Research can learn and
  Qualification can test without granting eligibility or capital.
- **Prohibitions** - no Candidate selection, protected feedback to Research, Eligibility, lifecycle, live order,
  account truth, or deployment authority.

## Subsequent implementation acceptance

- Identical admitted inputs reproduce the same canonical event and result sequence.
- Protected Run Result proves exact equality between every requested and consumed Artifact, PIT scope, snapshot,
  universe, calendar/session/time-zone, corporate-action, historical-membership, market-semantics, correction,
  replay, kernel, simulator, cost, slippage, capacity-model, Protected Robustness Plan, and plan-cell identity.
- Each terminal protected result accounts for exactly its requested plan cell and repeats the complete cell-set
  digest. Qualification alone resolves all sealed per-cell results against the frozen plan and assigns missing-cell
  disposition after consuming a sealed Backtest attempt frontier that proves no requested cell remains nonterminal;
  Backtest cannot claim whole-plan completeness or silently relabel unavailable evidence.
- Any protected request-to-result mismatch becomes `INVALID_REPLAY_EVIDENCE` and produces no Eligibility Fact.
- Every exploratory result joins the same stable R&D-owned request identity; a mismatched, mutable, superseded, or unresolved request produces no run.
- Every terminal exploratory result in the existing compatibility schema has one complete finite `diagnosticCategorySet`, diagnostic-policy version,
  and decisive evidence cut per supported member or complete non-isolating evidence set; simultaneous supported
  defects and economic failure remain visible and Research's one-repair selection is deterministic.
- Every terminal protected result likewise preserves one complete finite non-empty `diagnosticCategorySet` and
  content digest for Qualification only. `NO_EXECUTION_DEFECT` and `UNRESOLVED_FAILURE` are singleton-only; any
  supported execution defect preempts economics, and no protected set membership enters shared telemetry or R&D.
- Every terminal protected cell result carries sealed Backtest-owned applicability and outcome evidence plus one
  complete `PROTECTED_EVALUATION` result-stage Time Evidence. Backtest reports observations; it does not assign
  Qualification's `PASS`, `FAIL`, or non-applicability categories.
- Every `BACKTEST_OPERATIONAL` result proves the exact operational profile, run attempt, readiness/backpressure/
  resource-exhaustion/outage evidence, and Time Evidence; a correlated repair targets only
  `BACKTEST_RUNNER_SERVICE`, and a successor profile is consumed only by a new Replay Request.
- Every admitted Backtest native repair request has one correlated write-once result. Exact replay joins the same
  attempt and result; only `REPAIRED` may name a new category-specific identity, while `UNAVAILABLE` and
  `OUTCOME_UNKNOWN` grant no successor identity or retry.
- Every completed exploratory result proves exact request-consumed equality for Artifact, PIT scope and snapshot,
  universe selection and correction, replay configuration, Runtime kernel, simulator, cost, slippage, and capacity;
  only an equal `TERMINAL_RESULT` may enter Research Selection.
- Exploratory and protected run namespaces, access paths, and result consumers are demonstrably isolated.
- No Backtest result can authorize or apply a strategy generation; Qualification decides eligibility, Governance authorizes, and Runtime alone proves application.
- Backtest exposes only `RUN_REJECTED`, `IN_PROGRESS_OR_UNKNOWN`, `TERMINAL_RESULT`, or `INVALID_REPLAY_EVIDENCE`; it cannot write admission or eligibility state.
- A created protected request is never rejected without a Protected Run Result; the result is what lets Qualification close holdout custody.

## Observability and persistence

Backtest persists each Replay Request, run attempt, consumed Artifact and PIT identities, operational-profile
identity and version, runner/service readiness and bounded backpressure/resource/outage evidence,
cost/capacity inputs, complete diagnostic set, Exploratory Result, and Protected Run Result. Operational
signals cover queue time, engine/simulator duration, resource use, and repair dependency without copying
protected measurements or an internal terminal disposition into shared telemetry.

Exploratory projections may expose their diagnostic category set; protected projections expose only the
bounded public terminal outcome `CLOSED_NOT_QUALIFIED` or `QUALIFIED`, a type-opaque
non-dereferenceable reference, and source-frontier freshness. Protected phase, run latency, terminal timing,
and timing-derived fields are forbidden. They never expose a generic terminal disposition, internal reason, or
internal state. Every `REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`,
`ASSESSMENT_INVALID`, and `INELIGIBLE` terminal is byte-equivalently normalized to
`CLOSED_NOT_QUALIFIED`; positive `QUALIFIED` remains exact.

No protected category or category-derived aggregate may label, group, filter, count, alert, score health, or
enter a research funnel. Telemetry loss cannot manufacture a Result, diagnose a protected attempt for
Research, or let Qualification close an attempt.
