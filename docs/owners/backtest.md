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
| Intrabar chronology                       | Native OHLC path assumptions with minute bar execution                                 | Minute execution, native signal aggregation and configured bar paths require integration           | Path assumptions do not prove observed chronology; missing data cannot use fallback                                               |
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
The R-1 acceptance strategy records enough pre-order diagnostics to distinguish absent triggers from filters; without
those records, the cause remains undetermined rather than product-inferred. Zero fills alone mean neither failure nor
an empty report: a complete zero-fill result requires complete order/fill, account, valuation and required report
coverage. Mark undefined statistics unavailable; missing or partial details cannot masquerade as empty collections.

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
multi-instrument target sets are not compositions of independent strategies. R-1 uses native Strategy `OrderFactory` and commands, binding exact `Price` / `Quantity`,
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

Use the frozen native bar path for every complete minute: default OHLC or the configured adaptive high/low
ordering. It determines simulated entry, stop and target order; do not override it with stop-first or
enter-then-hold rules. Record the configuration and label bar-based outcomes as simulated chronology. The Agent
may compare separate runs under native configurations without selecting a favorable path after inspection.
Missing minutes or invalid data remain gaps, not permission to fabricate a result.

External execution bars use `bar_execution` with an L1 book. Preserve source timestamps: native matching processes
bars at `ts_init`, normally the close, while `ts_event` follows the source convention. Market Data normalization
and native aggregation settings must establish those boundaries before replay. Resting orders process before
the strategy receives that bar; a signal confirmed at its close cannot fill earlier within it.

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

Engine termination still runs native stop hooks and queued commands. Retaining terminal positions requires
the frozen strategy lifecycle configuration and `on_stop` to preserve them; report every actual termination
effect instead of deleting shutdown fills afterward.

### Native fee and margin models

Backtest reuses Nautilus `FeeModel` and `MarginModel`; strategies do not calculate separate fees or keep a margin ledger.
Select `MakerTakerFeeModel`, fixed fees or an extension supported by native interfaces; use
`StandardMarginModel`, `LeveragedMarginModel` or a native extension with proven consumer wiring for margin.

Bind the repository API actually installed. In this version, `MakerTakerFeeModel` reads instrument maker/taker
fees; newer official examples may pass fee rates to the model instead. These are version-specific parameter
carriers, not interchangeable constructors. Resolve imports, configuration types and native bindings from the
reported runtime environment before strategy loading.

Freeze each run's models, implementation versions, parameters and basis. Fees and margin may be explicitly
selected simulation conditions; a complete historical fee archive is not a prerequisite for every replay.
Applying current rates throughout the interval is a simulation assumption, not a historical charging fact.
Missing required parameters or native consumer support still refuses the run, without silent zeros or defaults.

Market Data owns historical prices, funding, mark prices and supplied historical terms; Backtest owns simulation
models and parameters. Report historical data separately from simulation conditions. Parameter changes produce
new runs; the Agent may compare cost sensitivity without a product cost optimizer. Model selection grants neither
qualification nor trading authority; Qualification verifies applicable conditions under its separate frozen protocol.

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

- Stable task, request and attempt identities, frozen strategy package, Git source, environment and native run configuration.
- Request-equal consumed input versions, instruments, window, PIT/correction scope, availability, warm-up boundary and aggregation configuration.
- Native orders, fills, refusals, positions, costs, funding, account series and results, with the exact model versions used.
- Raw errors, available exception locations/stacks and bounded native logs, with missing, truncated, unknown or partial evidence explicit.
- Protected Candidate/Intake, frozen policy, Protected Robustness Plan and cell bindings, and protected results and attempt frontier visible only to Qualification.

Backtest reports actual run facts; it does not own scientific diagnostic classes, strategy repair decisions or a server repair workflow.
Existing semantic traces and diagnostic-policy fields describe recorded compatibility results, without requiring program graphs or repair protocols from native Python strategies.
`SIMULATOR` / `BACKTEST_OPERATIONAL` repair is not implemented in the four Backtest crates and is not an existing authoritative fact.

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

- [R&D](./rd/) passes a complete sealed value resolved at the upper admission boundary through a typed downward port: stable identity, meaning digest, strategy package, parameters, environment, input manifest and native model configuration. Backtest validates its bindings and records the task; it does not read back into R&D or recompile authoring documents.
- [Market Data](./market-data/) supplies exact immutable versions, complete required windows, instrument terms, precision, rights and PIT/correction/availability evidence. Missing, stale, conflicting or unequal bindings fail before native loading/preparation; MCP does not fill data during execution. Data gaps are not economic failure.
- [Qualification](./qualification/) sends frozen protected requests only after `ADMITTED` intake and holdout reservation. Execution identities, policy and plan cells are fixed before observation; admission refusal closes the request with `RUN_REJECTED` while details remain protected.

Existing locator compatibility preserves exact bytes, digest equality, stable cuts, atomic zero-write failure and same-identity recovery. Migration cannot substitute caller copies for source authority. `D1_EXECUTABLE_REPAIR` / `REPAIR_VALIDATION` constrain only the old interface and are not native task prerequisites; no native repair consumer exists.
Direct `BACKTEST_OWNER_V1` Instrument Master resolution remains TARGET. External calls to `run_exploratory_replay_v2` are gated by `native-replay-execution`, absent from the deployed Dockerfile. These contracts do not prove deployed reachability.

## Current compatibility output handoffs

Target reports reference the frozen Python package digest, Git source, entry point, parameters, environment, consumed inputs and aggregation configuration. R&D receives task/native result/raw error facts; Qualification receives request-equal sealed protected results. Product Edge/Dashboard reads only authorized exploratory facts, never protected payloads.

Existing compatibility readers and limits:

- Dashboard shadow read through `resolve_exploratory_replay_result_v3` exposes canonical result bytes and terminal/reconciliation/diagnostic/semantic-trace-presence, without economic fields.
- `resolve_backtest_run_report_v1` / `OwnerBacktestReportV1` derives run/request/attempt, return series, net return, drawdown and fills from the same committed engine result. Returns are fractions. The handoff currently does not distinguish daily equity returns from closed-position price returns; consumers cannot label all of them equity returns.
- The engine still supplies `EMPTY` reasons: `MORE_THAN_ONE_EQUITY_CURRENCY`, `ACCOUNT_WITHOUT_PRICED_SNAPSHOT`, `FEWER_THAN_TWO_ENGINE_DAYS` or `NO_DEFINED_DAILY_RETURN`. Noncanonical results refuse as `ENGINE_RESULT_NONCANONICAL`; zero fills alone do not imply EMPTY.
- The old report reads frozen request/Design/program under a bounded `SERIALIZABLE, READ ONLY, DEFERRABLE` snapshot. Preserve `REPORT_SNAPSHOT_UNAVAILABLE`, `STRATEGY_NOT_ANCHORED_TO_RUN`, `ARTIFACT_BUILD_RECEIPTS_UNAVAILABLE`, `REPLAY_REQUEST_V3_NOT_YET_REPORTED`, `UNIVERSE_SELECTION_NOT_ONE_MEMBER` and `UNIVERSE_SELECTION_UNAVAILABLE`; a new native package does not bypass the old reader's anchoring.
- This report has no HTTP caller. Its PostgreSQL proof reads a real engine result written by acceptance and refuses an out-of-family run as a whole. No chain entry submits a fully reportable in-family Composer V3 run; it does not prove the native report journey complete.

Old diagnostic-policy and repair schemas preserve recorded meanings only. Unimplemented repair results are not required next-experiment handoffs. Failed or unknown runs are not complete economic/qualification evidence, and protected diagnostics remain visible only to Qualification.

## Rejections and prohibitions

Diagnostic class names below constrain only existing compatibility records; they add no mandatory native classification or repair workflow. Protected errors/logs and all protected result detail remain private to Qualification, including server-error review.

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
- Old compatibility classes cannot rewrite raw errors or turn delivery, acceptance, silence or telemetry into completed repair.
- Never expose a protected result through Product Edge, even as a read-only view.

## Failure and recovery

Missing, substituted or unequal input/run bindings and data/term faults produce named refusals or raw errors, retaining task, attempt, package, environment, consumed versions and logs. Rejected, invalid, interrupted, partial or unknown runs are not economic failure or qualification.

After changing strategy source, the Agent freezes a new package and submits a linked complete run. Service, fixed-environment or simulator faults retain exact versions and errors for user review, repair and deployment. A repair is followed by an explicit linked new task, without automatic retry or a service repair Owner. Unknown state resolves the original identity first; silence cannot create a terminal.

Qualification closes protected attempts and holdout under the frozen policy. Protected failures cannot become exploratory evidence, expose diagnostics, or turn admission failure into INELIGIBLE.

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

- A real consumer reads native frozen-task admission, identity-conflict refusal and same-identity query/recovery; submission or sealing is not completion.
- Requested and consumed package, environment, PIT/correction inputs, instruments, window, aggregation, models and costs match field by field. Equal inputs reproduce native events and results.
- Native orders, fills, accounts, costs/funding, results and bounded logs remain readable by original identity. Partial, failed, truncated and unknown evidence stays explicit, and reports do not invent return semantics.
- Protected results repeat Candidate/Intake policy, plan and exact cell identities, accounting for each cell once. Only Qualification decides coverage and eligibility against the complete attempt frontier. Missing, unequal or unknown evidence creates no Eligibility.
- Strategy corrections create new packages/tasks with predecessors retained. Service errors retain logs for user repair/deployment, without requiring nonexistent native repair requests.
- Existing compatibility readers verify their frozen identities, refusals, rights and protection isolation. Old Composer/repair schemas are not native acceptance prerequisites. Owner acceptance still requires Linux ordered PostgreSQL chains and report; local tests do not prove deployment.

## Observability and persistence

Backtest persists each Replay Request, run attempt, consumed Artifact and PIT identities, operational-profile
identity and version, runner/service readiness and bounded backpressure/resource/outage evidence,
cost/capacity inputs, complete diagnostic set, Exploratory Result, and Protected Run Result. Operational
signals cover queue time, engine/simulator duration, resource use, and named failure without copying
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
