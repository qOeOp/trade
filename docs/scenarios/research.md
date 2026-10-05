# Research requirements and acceptance

R&D converts a sourced market hypothesis into a frozen, reproducible strategy artifact while keeping
exploration separate from protected qualification.

## Research scope and autonomy

Research admits perpetuals, spot data/backtests and spot/perpetual two-leg strategies. R-1 first acceptance remains Binance USDT perpetuals. Spot intake and multi-leg hosting require their own integration and acceptance; no Paper/Live path is admitted.

<a id="user-story-and-acceptance-target"></a>

**Target state, not a claim of current availability.** An external agent is a user-chosen assistant outside the
product, such as Codex or Claude, connected to domain MCP/CLI tools; another host can use the same interface.
The user supplies a research theme, risk tolerance, available data, and resource-spend cap. Before experiments,
the agent registers portfolio objectives, benchmarks, risk constraints, return units, and observation horizon.
Objectives cannot change after results to select a winner. Within that frozen scope, the agent may find sources,
propose and preregister new mechanism families, author strategies, run experiments, diagnose failures, and open
successor rounds. There is no fixed trial-count limit, but every run, rerun, and look is counted in the trial and
data-read ledgers. Spend caps pause work, method stops have explicit decisions, and leaving the theme or changing
pass criteria needs a new user request. Product and agent host enforce separate resource limits and report them
separately; unavailable model usage is never zero.
The product persists business facts and deterministic jobs; a host-side timer wakes the external agent. A new
session resumes from Owner receipts, not from the previous chat or a living MCP process. This grants neither the
agent nor the product Paper, Live, or real-money execution authority.

The agent may repair implementation that deviates from the frozen method, retaining correction lineage and
affected results and verifying the successor. It cannot erase failures or join a changed run under the old
identity. Pass/closure criteria or statistical-protocol changes require user confirmation and a new frozen version.
For example, coding coin clustering when the protocol requires week clustering is an implementation error;
changing a protocol that originally chose coin clustering to week clustering is a protocol revision. Neither
makes old results independent evidence for the new protocol.

| User expectation                                                | Observable result for agent and user                                                                                                                                                                                                                             | Authority and failure path                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start from a source and question, then explore within the theme | Source quality, mechanism, alternatives, discriminating prediction, minimum effect of interest, trial family, and variant set are frozen before result reads; a new family has distinct lineage                                                                  | Source Intake and R&D receipts; sources are data, and unregistered or out‑of‑scope experiments are refused                                           |
| Use only data available at the time                             | Point‑in‑time universe rule, listing and delisting treatment, data version, costs, funding, and capacity identity are frozen with the request; every agent data read and trial is traceable                                                                      | Market Data and R&D ledgers; protected partitions, missing data, and unreproducible scope fail closed                                                |
| Author real order behavior                                      | The agent submits JSON `research.strategy-authoring.v1`; R&D compiles and seals an immutable artifact that can express expiring resting limits, linked stops and targets, partial exits, stop moves, holding limits, and slots assigned by actual fill order     | R&D authoring and build receipts; build and semantic failures do not become economic failures                                                        |
| See a useful research report                                    | Under the same frozen data and execution model, report portfolio return, drawdown, risk‑adjusted results, holding and cash comparisons, concurrent exposure and overlap, costs, and capacity first; single‑strategy and random‑entry comparisons diagnose causes | Native Backtest Result and R&D Diagnosis; charts, agent prose, and run success create neither selection nor qualification                            |
| Continue or stop unattended                                     | Each round records prediction, observed result, failure cause, mechanism change, and resource use; spend cap and method stop rules can halt it, while trial count is not a run quota                                                                             | R&D Iteration Decision and knowledge ledger; unknown results stay unresolved and weak evidence waits for new data                                    |
| Evaluate independently and observe forward evidence             | Qualification may internally distinguish pass, equivalence to null, and insufficient evidence, but exposes only `QUALIFIED` or `CLOSED_NOT_QUALIFIED` to research; qualified candidates enter a record‑only forward stage with the same order and cost semantics | Qualification owns protected and forward facts; public nonqualification cannot close a mechanism, and forward recording cannot create trading orders |

## R-1 resting entries and staged exits

**The first end-to-end acceptance example is the R-1 family.** Its market baseline is point-in-time Binance USDT
perpetual history, not spot prices substituted for perpetual economics. Starting from a sourced daily
breakout-and-retest hypothesis, the agent registers the mechanism and builds a strategy on a point-in-time universe
that includes historical listings and delistings. R-1u rests a limit
near the broken level for at most ten days and replays the stop, signal-frozen 2R reference target, maximum holding period, and one position
per coin after fill. R-1s exits half at that target, holds the other half, and moves its stop to entry, proving that the same
simulator can replay partial exits and state changes. Fills, cancels, stops, and targets follow event order; order
creation order cannot allocate slots, and pre-fill highs cannot count as post-fill profit. Register and report the
variants separately. The report includes perpetual fees, funding, slippage, minimum order size, and margin
constraints, and names the fill-path resolution and events that cannot be ordered within its smallest time unit.
When missing data can change the outcome, the result stays unresolved. R-1s remained forward exploratory in the
source study; passing this acceptance example does
not establish economic edge, qualification, or trading permission. The source study is pinned to
`claude/inspiring-gauss-pxaril` commit `0725a7b3f89902e27cd421a18b4b879a13268534`, especially
`research/ronnie/roleflip/forward.py`, `replay.py`, and `loop/RETROSPECTIVE.md`.

### Event causality and minimum-resolution ambiguity

the finest execution data is one minute. When a complete minute reaches stop and target
and cannot establish ordering, apply frozen conservative stop-first fallback and include it in portfolio results
with a policy-inference flag, not claimed observed order. Report affected trades/reasons/counts and chart flags;
ordering sensitivity may be reported without selecting favorable outcomes after inspection. This fallback covers
ordering within complete minute data, not missing minutes, invalid market facts or unverifiable execution inputs.
The execution policy uses on-demand hierarchical descent, not uniform minute execution throughout.
Signal timeframe and execution resolution differ: when a daily candle reaches entry and target, descend through
the frozen available hierarchy (for example daily → four-hour → finer → one-minute) until order is established
or the minimum reached. A target touched before entry is not profit; target after entry may exit. Refine only
unresolved subintervals and advance resolved intervals chronologically. Child data must have matching PIT
custody, bounds, parent consistency and complete coverage. Do not commit hypothetical parent fills then consume
child fills again. Activation, expiry, protective changes, capital contention and funding cuts also require
refinement/event boundaries when they affect results; all members share one causal account timeline. Consume
only already-effective signals/orders: a close-confirmed daily signal cannot fill earlier that day. Pre-entry
extremes are not post-entry performance. Charts disclose resolution and inferred event timing, not fictional
observed ticks. Backtest/shared execution handles descent, not strategy code. Acceptance covers target-before-
entry, entry-before-target, protective races, invalidation boundaries, portfolio contention and restore. Coarse
execution requires proof of unchanged account state/economic outcome; sealed execution versions never drift.
Statistics follow Nautilus: reuse native Portfolio snapshots and analytics, including registration of
`MaxDrawdown`, and report the actual return series/sampling. Retained code defaults to daily valuation snapshots
and supports optional finer snapshots; analyzer portfolio returns are still daily-aggregated. Enabling finer
snapshots does not automatically make native primary drawdown intraday. The unconfirmed intraday-primary proposal
is not a new standard. Do not claim daily samples capture all intraday extrema or invent continuous portfolio
equity from OHLC. Name insufficient native inputs/product wiring gaps; never silently substitute closed-position
returns as portfolio returns.

Terminal handling: retain open positions at the window end, without inventing a strategy
exit or automatically liquidating. Use the frozen Portfolio valuation methodology and valid cutoff market data
for final equity; separately report realized/unrealized PnL, open quantities and incurred fees/funding. Unincurred
exit costs are not actual costs; show fill prices separately from valuation prices with source/time/staleness.
Missing valid valuation cannot produce fictitious complete returns. Engine shutdown cleanup must not silently add
liquidation trades to the primary report. Any liquidation sensitivity is separate and never replaces that report.

Close-confirmation rule: first-version candle/indicator conditions for signals, cancellations
and stop changes are confirmed only after the relevant bar closes and its data is available. A 15m closing indicator
cannot cancel an earlier fill within that interval. Already effective price entry/stop/target orders may still trigger
intrabar. Descent does not generate signals from unfinished indicators or backdate new protection to the parent
bar's open; retain previous order/protection effective times. Dynamic unfinished-bar indicators are outside initial
semantics. Freeze/verify closing-boundary event ordering in the shared execution contract, not input loading order.

Same-time new-entry admission order: shared execution orders by effective decision time;
requests actually available at the same decision cut use frozen canonical symbol-name ascending order, then stable
strategy/signal identity for ties. Thread scheduling, database iteration and agent submission speed do not decide
priority; never wait for future requests to form a batch. This is shared execution configuration, not a strategy
priority parameter. Existing Risk contracts still admit/refuse each request. Insufficient capacity terminates the
request with no queue, automatic resizing or recovery replay. Ordering applies only to new-entry admission, not
existing resting-order matching or protective/exit event chronology. Acceptance varies traversal/scheduling order
and preserves identical admissions and per-request grounds.

when a complete minute still cannot order entry/target and reaches no stop, conservatively
record entry and carry the position forward, never credit a possibly pre-entry high as profit. Continue normal
execution on later minutes with a policy-inference flag. This is only genuine ambiguity: established ordering
from effective open/child evidence is not subject to a blanket delay of targets.

### Multi-timeframe data and execution preparation

**Descent data dependencies and preparation.** Descent reads real finer history for the same interval, or
aggregates coarser bars from custodied finer data under frozen rules. Daily OHLC cannot reconstruct/interpolate
a four-hour or minute path. Strategies declare signal/feature timeframes; independent execution policy declares
minimum resolution/hierarchy, from which the product derives dependencies without strategy fetch code. Bind
venue, members/PIT selector, replay interval, feature warmup, hierarchy, source/revision meaning and resource
bounds. Warmup grants no trades outside the run; resolution changes widen no research market/time scope.

Preparation requires economical base-data reuse and bounded finer preparation. The
Binance measurement qualifies the proposed universal aggregation shortcut: native timeframes disagree on some
incident days, so an aggregated bar cannot silently stand in for that venue's native bar. For the Binance
native-bar baseline, fetch each required signal timeframe through the existing native client and reuse its
custodied slices; do not claim four signal timeframes require four full copies of minute execution history.
A strategy may explicitly request a derived series; freeze its base, aggregation rules and distinct source meaning,
and reuse native aggregation only after the required cadence/fields are verified. Derived caches are rebuildable.
Neither choice reconstructs minute chronology from a daily OHLC bar. Prepare actual finer bars for unresolved
bounded intervals under the frozen policy, rather than requiring full-window minute data. This target planning
capability does not change the current T0 custody path, which already binds its fixed minute fill inputs.

Market Data owns ingestion/backfill, PIT custody, aggregation consistency and gap evidence. R&D owns research/
trial identity and admits complete execution inputs. Backtest validates/consumes sealed data, never stitches
unregistered remote history. Freeze dependency planning, aggregation/descent rules, base inputs and budget and
validate base coverage before execution. A newly discovered ambiguity enters a traceable preparation/wait phase:
service orchestration submits a Market Data child job, validates/binds immutable finer slices and resumes the
unresolved interval without duplicate fills. The final result seals the complete consumed-data manifest and
derivation lineage; incomplete preparation is not a valid final result. Custodied
data not in memory may load lazily by bounded subinterval; cache loading is not new data meaning. Missing data
routes to Market Data preparation/repair with gap/old-attempt history retained, never a stop-first/hold fallback
masquerading as valid replay. New data identity requires native preparation/readmission and a named successor,
not mutation of a sealed run or replacement digest; protected request/result equality and isolation remain.
Automatic orchestration stays within frozen market/time/source/budget/protected permissions; failures name the
reason rather than widen budgets or invent paths. On-demand acquisition is registered preparation, not arbitrary
fetch authority or permission to rewrite sealed data/results.

**Nautilus reuse and isolation.** Modify/integrate the Nautilus retained in this repository rather
than write another backtest engine. Prefer native aggregation, order state, matching and account events.
Descent data preparation belongs to backtest job orchestration/execution-input planning, not strategies or the
matcher. MCP adapts service entrypoints; the matching core holds no MCP client, remote acquisition role or Market
Data implementation dependency. Orchestration submits durable data jobs through owner contracts and binds slices;
matching consumes validated data/native commands. Route signal bars separately from execution inputs; overlapping
parent/child intervals must not drive duplicate fills or repeated signal aggregation.

Local recursive descent remains a target requiring evidence. Current
`crates/execution/src/matching_engine/engine.rs::process_bar` retains the finest execution type and can keep ignoring
coarser bars after finer input; alternating 15m/1m injection is insufficient. `BacktestEngine::run(streaming=true)`
offers batch continuation, not proof of parent-fill rollback, arbitrary resolution changes or independent member
progress preserving portfolio causality. Measure native public boundaries first; compare input preplanning/replay
and bounded continuation for correctness/cost before choosing the smallest adapter. Do not bypass internal state
encapsulation or create a strategy-side simulator. Admission evidence includes coarse resumption after finer input,
overlap, cross-member capital/timer events, preparation failure/recovery and minute fallback. Compare order/position/
capital events and equity with full fine-resolution replay under identical assumptions; report reads, memory and
elapsed time. Do not claim local descent is available before correctness/resource bounds pass.

[Native capability adoption](../architecture/capability-adoption/) distinguishes engine mechanisms, product
responsibilities and integration gaps. Native execution/cache remains the order/fill/position fact
authority; the shared adapter retains intent, trade/leg linkage, consumed-event frontier and rule progress only.
Generated runtime carriers may reuse the framework Strategy base's native order management without making authored
signal logic manage venue state. Default brackets use OUO; ordinary OCO or unequal-quantity OUO cannot directly
implement R-1s half-size targets with full-size stops. Leg completion is not whole-trade closure. Update remaining
protection from native fill feedback and reuse native modify/cancel commands, not a second state machine. GTD
expiration advances from native events, not invented expiry facts. Freeze/report probabilistic slippage, L1
market-style remainder handling, gaps and actual fees separately; disabled probability does not imply zero execution
price difference. Account balance updates alone do not make deposits/withdrawals return-neutral. Use verifiable
cashflows under existing Portfolio methodology or report missing integration; never label cashflow equity jumps as
strategy profit/loss. Native statistical fallback or synthetic recovery terminals do not override existing
portfolio-evidence/unknown-commitment boundaries.

Current `pit_window_custody_v1` has input/fill declarations and custody with `FillBarOpen` quote
derivation; V1 `backtest.run` still names one member, execution timeframe and window, not implemented recursive
descent/automatic preparation. Native bar execution, hierarchy, planning and full consumption are target gates.
Acceptance covers daily-only input, aggregatable minute custody, uncached data, finer gaps, inconsistent parents,
warmup, budgets, new identities after repair and refusal of reads outside frozen scope.

### Planned and filled prices

The fixed-target variant requires: calculate and freeze the target from planned entry and initial
stop when the signal is generated; price improvement on actual fill does not recalculate it. Planned entry 100,
stop 90 and target 120 remain target 120 after fill at 98: gross price risk is 8, reward 22 and actual gross ratio
2.75 rather than 2. Report planned price, actual average fill, stop, fixed target, planned R and actual risk/reward
separately, with net-of-cost outcomes distinct. Source `replay.py` recalculates targets from fill price, so this
is a new named strategy/trial meaning, preserving old evidence rather than claiming exact trade reproduction.
Acceptance separates registered target-basis divergence from unexplained matching divergence. Qualification
consumes the new artifact/fixed-target identity, never reused eligibility from the earlier variant.
Once R-1s's registered first-leg fill condition is satisfied, move the remaining stop
to this trade's actual average entry, not its planned signal entry. Seal the fill frontier/average referenced
at the transition and apply the trade identity and native price precision. This does not change the
fixed target or add fee compensation to a different breakeven price. Report a move to actual entry average;
actual stop slippage and all costs remain execution facts, with no promise of zero net PnL. Racing entry fills
follow the existing quantity/protection feedback contract, never silently rewriting an already recorded stop move.

### Entry invalidation and independent trades

**Pending-entry invalidation is not limited to expiry.** The authoring contract requires cancellation
on candle patterns, indicator changes, or price distance beyond a volatility-normalized threshold. These are
composable, pre-registered lifecycle predicates in the versioned JSON authoring successor, decided by the shared
kernel and executed by the native simulator. Freeze observation timeframe, price reference, composition and
priority, thresholds, and whether volatility is captured at arming or updated at each decision. Use only data
available at the decision cut: a close-based cancel cannot erase an earlier fill. Cancel only remaining quantity;
preserve filled positions and protection. Suspended entries may also become invalid and must not be resubmitted.
Restoration preserves terminal cancellation. Creating an order and cancelling an identified order are independent
strategy actions; a later entry is a new order, not automatic restoration. Do not introduce product recovery
windows, retry counts, or automatic rearming switches inside strategies. Strategies express new economic
opportunities; operational failure recovery belongs to independent shared execution policy.
Keep strategy/trial attribution; an ordinary new entry need not reference an earlier cancelled order.
Reports expose expiry, invalidation, fills and cancelled remainder with predicate
inputs and event times; ambiguous ordering follows frozen execution policy or stays unresolved.
Current `AuthoringActionV1` exposes only `Enter`, `Flip`, and `Exit`; Host cleanup and shutdown cancellation
do not establish support for this JSON path. Acceptance adds candle/indicator invalidation, distance thresholds,
partial fills, fill/cancel competition, suspended invalidation, and restart/rearming to the
[resting-entry kernel target](../architecture/strategy-factory.md#target---resting-entries-oco-exits-and-the-intrabar-path).

**Independent entries and exits, shared capital and risk.** two entries in
the same instrument retain separate orders, actual fills, stops, staged exits and trade results. Cancelling or
closing one must preserve the other. Exits name their trade and reduce only its remaining quantity. One portfolio
shares capital and margin. Portfolio owns account/exposure/capacity evidence; Risk alone owns commitment usage,
headroom and risk admission. Trade attribution reconciles to the portfolio without duplicating
account capital. reject an entry exceeding available capital, margin or frozen risk
bounds, recording the native reason and requested quantity. Do not automatically resize or queue submission
when capacity returns implicitly. Risk refusal remains terminal for that request; Runtime/Execution handles
refusal, waiting or admitted successors under independently frozen execution policy without strategy recovery
code. The first execution baseline has no automatic resizing or implicit queue. Quantity changes require sizing
policy or explicit new request meaning, never hidden mutation by an execution retry. Check the shared
portfolio at the event cut. Distinguish rejection, native partial fills and frozen instrument-grid rounding,
reporting requested, admitted and filled quantities. Acceptance covers entries competing for one remaining
allowance, refusal preserving existing trades, and restoration without implicit retries.
strategy JSON declares fixed quantity, allocation from current portfolio equity, or
risk sizing from entry/stop distance. The shared kernel evaluates the expression at the registered decision
cut using actual portfolio state; an external agent need not resubmit quantities on every simulated frame.
Seal expression, dimensions, equity/price/stop inputs and instrument rounding, making evaluated quantities
reproducible. Invalid dimensions, invalid arithmetic, zero denominators and unavailable required state receive
named refusals. Sizing cannot bypass portfolio admission or introduce implicit resizing. V1's fixed integer
`Enter.units` field does not prove dynamic authoring is available. calculate quantity
when creating the order, keep pending quantity fixed, and use explicit cancel/new-create actions to change it.
The original remains a commitment until cancellation becomes effective. Acceptance covers equity changes, stop
distance, rounding, stable pending quantity and resource refusal.
One-trade-per-instrument and entry exclusivity are strategy rules; preserve R-1's original slot
rule without imposing it on all strategies. Reuse engine position identities and net-position mapping rather
than building another fill or accounting simulator. Current target-set Host still requires one native net
position per member; this is a versioned extension target. Acceptance adds distinct stops and partial exits for
two same-coin entries, cancellation, isolated closure, portfolio reconciliation and checkpoint restoration.

The same product path must later cover two different mechanisms: K1 spot-perpetual carry tests multi-leg positions,
funding, margin, and return on capital actually committed; the B3 point-in-time top-N trend book tests historical
universe entry and exit, simultaneous positions across strategies, correlated losses, and portfolio drawdown. These
are architecture compatibility examples. Returns in the source branch are neither product qualification nor a
promise of future returns.

### Re-evaluation and completion

**New evidence can explicitly reopen a conclusion.** `CLOSED` binds a tested mechanism, market scope, time, and
evidence; it is not a permanent ban across markets. The same mechanism may acquire a named review successor only
when new independent data or an untested scope exists, a review prediction and minimum effect of interest were
registered first, and old evidence plus new reads remain counted. Old conclusions are never rewritten. Replaying
old data, renaming the mechanism, or restating a binary protected status cannot reopen it.

**Completion criterion.** An external agent submits and reads back the full R-1 journey through domain tools and
can resume by native identity after its session restarts. Dashboard shows the same sources, trials, reports,
unresolved states, and admitted actions. Independent acceptance exercises missing data, unregistered trials, spend
caps, wrong event order, protected leakage, mistaken closure after nonqualification, and a forward record trying to
trade.

### Reports and on-demand graphical replay

**On-demand graphical replay.** Address a bounded chart window by Run, signal and trade identity.
Show custody candles, signal-time planned entry/stop/target, pending validity/invalidation, simulated actual
fills, partial exits, protection changes and unfilled/refusal/cancel reasons, including signals with no fills.
Charts project Market Data custody and native Backtest events/reports; agents and Dashboard reference the same
identities. Rendering creates no order facts, eligibility or research conclusions. Distinguish planned prices,
simulated fills and actual venue facts; inferred intrabar order is not observed tick execution. Expose execution
model, resolution, rounding and uncertainty, with native event/input/refusal readback. Generate on demand rather
than pre-rendering every trade, respecting bounded windows and product resource caps. Charts inherit request
permissions/protected isolation and cannot disclose protected data/results; this target widens no Dashboard
route implementation admission. Acceptance includes filled/unfilled, refused/cancelled, partial exits, fixed
targets versus actual entry average, event races, data gaps and restoration under the same identities.

**TARGET / after U1: control intervention attribution.** The design distinguishes risk refusals,
capital trims, readiness and kill gates as changes between strategy intent and actual trading. Diagnostics should
join intent, control decision, actual orders/fills and reasons, separating mechanism, market, execution and control
intervention. The current Portfolio attribution enum does not establish this capability. This is a deferred gap,
not a second authoritative order book; an unfilled intent contributes no invented return. A counterfactual requires
its own frozen simulation, preserving the actual fill facts. Strategies do not own execution retries or reconciliation.

## Strategy and Owner boundaries

**Target design, not admission of a new execution path.** A strategy is not an account, risk or qualification
Owner. It is the trading behavior R&D compiles and seals: entries, requested quantities, cancellations, stops
and staged exits are part of the researched strategy. It proposes intents; it cannot change external limits,
grant permission or declare itself qualified.  insufficient funds, rate limits,
network failures and venue rejection recovery do not belong to strategy logic. Strategies define signals,
entry conditions/prices, economic invalidation, stops/targets and partial exits. Independent sizing configuration
declares quantity rules; Runtime's reusable calculation module combines these with Portfolio state to form
requested quantities. Independent execution policy owns waiting, retry and termination. These can share the
JSON authoring route and be jointly sealed by R&D without another Owner, registry or strategy recovery program.
JSON declares protection rules and transition conditions; actual fill events activate
and maintain them without per-bar strategy modification commands or broker state management. R-1s declares
half at 2R and a stop move to entry once that exit leg actually fills to its registered condition. Touch,
submission and acceptance do not prove the exit filled. The shared kernel consumes fills to decide protection
state; Execution applies native changes and records results; replay uses the same kernel/simulator. Protection
quantity follows the trade's actual remaining open quantity, not another trade or assumed completion of a
partially filled exit leg. Seal condition, exit-leg quantity basis, updated price and native rounding meaning.
floor preceding exit legs to the frozen instrument quantity step and assign remainder
to the last leg. Half of three minimum units becomes legs of one and two. Shared handling prevents aggregate
exits exceeding the trade's actual open quantity and reports planned/actual fractions and rounding basis.
Validate price/quantity/notional terms against historical instrument rules and order type, without applying
inapplicable opening constraints to reduce-only orders. Refuse an invalid split known before entry by name,
never silently merging legs or changing fractions. If actual partial fills reveal no legal nonzero split,
report the unexecutable plan, retain fills and existing protection and follow established incident handling;
never erase a real position as unfilled. Acceptance covers odd quantities, multiple legs, remainder, zero legs,
partial-fill changes and restore, with no over-exit or unexplained quantity.
after partial entry, the first actual exit fill, including a partial take-profit fill,
causes shared lifecycle handling to cancel the unfilled entry remainder and end further entry. No strategy
recovery code or extra switch is required. Target touch or exit submission is not an exit fill. Cancellation
cannot block stop execution and releases no commitment until effective. Racing entry fills update actual
quantity/protection rather than being marked cancelled. Acceptance uses the valid path of partial entry then
price rising to a target while the remainder rests below; do not invent ordinary matching with a live buy
remainder skipped as the same-book trade price descends through it to a lower stop.
R&D/Qualification freeze signal rules, sizing, execution policy and cost/capacity identities together for replay.
Quantity expressions remain supported; they need not be coded inside the signal state machine.

| Responsibility                                             | Sole decision or fact authority                                                                                                           | Prohibited crossing                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Trading rules and configuration                            | R&D owns authoring, Artifact and trial identity; signal rules, independent sizing configuration and execution policy are jointly sealed   | No risk approval, account truth or protected‑result adaptation                        |
| Strategy state machine                                     | Runtime shared kernel consumes market and actual‑fill feedback, emits intents and checkpoints trade state; Backtest hosts research replay | No invented fills, account allocation or self‑issued Risk permission                  |
| Account, equity, exposure and measurement                  | Portfolio; replay applies sealed methodology and engine accounting to simulated facts                                                     | No trading approval or Risk commitment/headroom calculation                           |
| External risk policy, commitments and per‑intent admission | Risk evaluates policy, account evidence and held commitments to permit or refuse                                                          | No choosing entries/exits, resizing requested quantity or declaring economic validity |
| Qualification and validated economic bounds                | Qualification evaluates the complete frozen candidate, including sizing, exits, costs and capacity; owns Eligibility and qualified bounds | No per‑order execution, candidate optimization or deployment authorization            |
| Deployment authority and capital envelopes                 | Strategy Governance authorizes generations, allocation and lifecycle within qualified bounds                                              | No overriding Qualification ceilings or claiming fills/commitments                    |
| Orders, fills and account effects                          | Execution owns production facts; Backtest native simulator produces and seals simulated orders/fills and Run Results                      | No self‑approved risk addition or simulation claimed as venue effect                  |

### Signals, sizing and execution outcomes

**Signals are decoupled from execution.** A signal identifies a market opportunity; a Trade Intent requests
entry quantity, cancellation or a trade-specific exit. Neither proves risk permission, order acceptance or fills.
Runtime hosts the strategy and submits intents to Risk, binding permission into order commands; only Execution
executes production venue commands and owns acceptance/rejection and actual fills. Account synchronization and
external withdrawal attribution are not strategy parameters. Strategies call no account/trading APIs, keep no
venue-balance authority and allocate no account capital.
Risk checks fresh account evidence and all commitments before orders; waiting for a venue margin error cannot
replace admission. Withdrawals, market changes or external activity between approval and submission may still
cause venue rejection. Execution retains the rejection receipt, Risk settles commitments from authoritative
effect/settlement evidence, Portfolio updates account facts, and Runtime/strategy consumes feedback. A funds
refusal does not falsify the market signal or turn intent into a filled position. Runtime/Execution applies
independent policy to the original valid signal and failure: terminate, wait or admit a successor without asking
the strategy for another signal merely to recover execution. The first execution baseline is:
insufficient margin and other definite refusals terminate this signal execution, with no waiting for capacity
to return. Distinguish local Risk refusal from post-invocation venue rejection. Temporary failures proven to
have no effect may retry finitely under standard policy; unknown results require readback, never blind resubmission.
Strategies handle no broker error codes, retry counters or queues. A missed opportunity is not erased history:
retain signal, admission/refusal, submission, venue response and filled quantity. Reports distinguish no signal,
Risk refusal, venue rejection, pending-unfilled orders and actual fills; no fill creates no fabricated PnL or
position. Terminal signals remain terminal through duplicate delivery/restore. Later independent signals use
normal admission, but execution cannot fabricate them. Admitted transient-failure successors bind original signal, policy and
order/attempt lineage, require fresh risk admission and preserve existing Execution idempotency/recovery rules.
Expired/economically invalid signals cannot proceed; execution policy cannot increase quantity, change economic
prices or chase indefinitely. Timeout/unknown response is not definite rejection, permits no release
without no-effect evidence, and cannot trigger a blind retry. Simulator acceptance covers local risk refusal,
post-admission venue rejection and unknown effects separately, not only ideal fills.

Dependency direction: strategy expresses market signals/trading rules; Runtime forms Trade Intents using
independent sizing configuration and committed account/market evidence;
Risk independently consumes intent, policy and account/commitment cuts; execution results then update account
facts and strategy state. Calculated quantity is not permission. A utility in `crates/risk` grants no Owner
authority. Inherited `calculate_fixed_risk_position_size` clips using `hard_limit`; adopting its arithmetic
must not silently replace the baseline refusal with clipping. Requested quantity, refusal and precision rounding
remain distinct and traceable.

**Research versus production authority.** An unqualified exploratory candidate may replay under frozen research
risk/capital/cost conditions. Backtest reuses Risk policy evaluation, capacity and accounting semantics and records
simulated admission/commitments within that run. It creates no Paper/Live Execution Scope and issues no production
Risk Decision, Reservation, Governance authorization or Eligibility. Production permissions and durable reservations
remain with their original Owners. Protected replay uses the same frozen Artifact/execution identities and returns
protected facts only to Qualification.

### Multi-strategy portfolios and shared accounts

**Combined strategies and account allocation.** The identity hierarchy is account/economic pool → strategy
instance (frozen Artifact/version) → independent trade → order/fill. Strategy positions are attributed projections
within one account, not copies of its balance. Bind fills to strategy/trade identities before aggregating under
the actual account's netting or hedging semantics. Report strategy gross exposure and account net exposure;
offsetting directions cannot conceal both commitments and risks. Seal the mapping from trade exits to venue
orders for the account mode. The portfolio model permits independent opposing same-instrument trades across
strategies, retaining separate entry/exit and PnL attribution. Zero account net quantity does not close both
strategy trades. Seal netting/hedging mode, engine virtual-position mapping and trade-exit order rules. Native
netting quantities may offset, but B's entry must not be recorded as A's strategy exit. Margin, funding and
commitment follow the actual frozen model; zero net quantity alone cannot erase both capital/risk commitments,
nor may virtual trades duplicate native account fees or fills. Refuse inaccurate attribution/quantity/cost/exit
mapping instead of silently imposing one-position-per-instrument. Acceptance covers equal offset, unequal net
quantity, separate exits, partial fills and restore with trade/account reconciliation.

R&D registers the research combination's complete member/Artifact set, shared initial capital, allocation rule,
capital-contention order, sizing equity basis and member/reallocation transitions. Backtest replays one continuous
shared account, not a sum of separate curves each funded with the entire account. Production allocation remains
Governance's `POOL_ROOT` and `STRATEGY_GENERATION` Capital Envelopes. Strategies request capital, Portfolio provides
capacity/interaction facts, and Risk enforces envelopes against all same-pool commitments without reallocating
Governance fractions. Research configuration is frozen run input, not a production Governance decision.
the first multi-strategy combination uses pre-registered fixed allocation fractions,
without automatic lending of unused capacity between strategies. Changing members, fractions or reallocation
rules requires a new registered combination-design version. Capital additions under existing rules update
allocation/envelope versions and fact history without unconditional artifact rebuild or qualification rerun.
A strategy with no current position does not implicitly grant its allocation to another.
fractions allocate initial capital; each strategy thereafter retains its own realized
and unrealized PnL, net of fees/funding and other costs attributed by frozen methodology. Equity-based sizing
uses that strategy's attributed equity, not full account equity or automatic restoration of initial fractions.
Initial 60,000/40,000 becomes 70,000/30,000 after respective net gains/losses of 10,000. Attributed equity is a
Portfolio-method projection within the shared account, not a venue subaccount or independently withdrawable
balance. Risk policy, strategy envelopes and account-wide constraints still limit usable capacity. Negative,
unvalued or incomplete state cannot support risk addition. Added capital, member exit or explicit reallocation
requires the registered allocation transition, never implicit transfer of another strategy's PnL. Attributed
equities plus unallocated items reconcile to account equity at one cut. Acceptance covers differing strategy
PnL paths, costs, unrealized valuation and account constraints, including no automatic rebalancing.
Dynamic allocation remains a later target, not implicit rebalancing or borrowing in the first example.

Each request must fit both its strategy allocation and account total ceilings. An envelope is not a cash transfer
or guarantee of future fills. Explicitly choose account equity, allocated capital or strategy-attributed equity
as the sizing basis. Portfolio methodology defines strategy PnL/fee/funding attribution and unallocated cash/cost
items; strategy attribution plus residual items reconciles to account totals. Count each fill, reservation and
commitment once, not again at every reporting level. Acceptance covers same-coin directional interactions across
two strategies, isolated trade exits, strategy/account limit contention, costs, restore and aggregate reconciliation.
pending entry orders reserve strategy and shared-account capacity under the frozen
margin and risk model. They cannot each reuse the same headroom. Required margin is not full order notional.
The Binance USDⓈ-M account API separately reports `totalOpenOrderInitialMargin`,
`totalPositionInitialMargin` and `availableBalance`, the named external semantic reference
([Account API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account), checked 2026-10-05).
Freeze account mode, leverage, instrument tiers, fees and capacity dimensions, using historical point-in-time
terms rather than today's rules. Report product risk commitments separately from venue margin without double
deduction of one economic liability. Partial fills transfer the corresponding pending commitment to position
commitment; the remainder stays held. Release unfilled commitment only after effective cancellation/expiry,
not a cancel request. Unknown/racing cancellation remains held; restoration follows the original identity
without duplicate reserve/release. Risk owns production commitment lifecycle; Backtest records only run-local
simulated commitments under the same model, never production Reservations. Acceptance covers shared headroom,
partial fills, cancel/expiry, fill/cancel races, restoration and commitment reconciliation.

Allocation affects combination return/drawdown: individual member qualifications cannot be concatenated into
combination qualification. Qualification must evaluate the exact member/allocation identity independently while
retaining protected isolation and deployment authorization boundaries.

### Reconciliation and external capital flows

**Venue account readback and reconciliation.** A strategy maintains no second authoritative balance or
available-funds ledger. It reads Portfolio's versioned account/attribution projection; its checkpoint holds
trading logic and execution feedback state. Execution adapter readback commits venue facts → Portfolio projects
account/attribution/valuation → Risk joins policy and commitments not yet represented in venue/Portfolio facts
→ Runtime consumes state and proposes intents. Binance `availableBalance`, total account equity and attributed
strategy equity have different meanings; equality is not required. Illustratively, equity/attribution of 100,000
and position/order margin of 70,000 with 30,000 available is not itself drift. Actual availability follows the
frozen account model and authoritative facts, not this illustrative subtraction.

Reconcile balances, orders, fills, fees/funding and positions at the same account, mode, currency/unit, valuation
method and provably consistent observation cut, not just one available-balance number. Order/account events,
authoritative snapshots and restart readback build a versioned fact frontier; missing, reordered, stale or
inconsistent observations cannot prove synchronization. Risk retains local commitments not yet reflected in
venue availability. Replace liability already incorporated into a consistent account cut by its lineage instead
of deducting it twice; venue available funds are not product headroom.

Execution records real same-basis drift and reads back missing orders/fills/fees/transfers; Portfolio reprojects
from complete facts. Do not overwrite strategy attribution or reset allocation from a latest API number.
Idempotently join attributable late facts to existing identities; unknown ownership stays unknown. Balance
changes alone cannot assign external deposits, withdrawals or manual trades to a strategy. The product supports deposits, withdrawals and manual/other-tool activity during operation. Execution records
authoritative external cashflow/order/fill facts; Portfolio separates external cashflows and activity attribution.
Deposits are not profit, withdrawals are not loss, and external positions are not product-strategy entries.
Insufficient provenance or ownership stays unattributed, but actual external exposure and reduced funds still
enter account facts and Risk's total constraints. The capital policy permits a deposit-purpose instruction:
add capital to running strategy A or distribute under registered combination fractions. Purpose and actual
deposit are distinct identities: no capital before receipt, no duplicate allocation, and no unsupported matching
by amount alone. After receipt/reconciliation, Portfolio records external cashflow and Governance updates
production envelopes within existing qualification/risk boundaries; replay records its run-local allocation event.
Deposits without purpose remain unallocated and may later be explicitly added to running strategies. New orders
may size from updated attributed equity; existing pending quantity stays fixed. Unchanged strategy logic and
qualified economic meaning with capital within approved bounds do not require artifact rebuilding or evaluation
for every top-up. Exceeding bounds invokes existing Owner authorization/qualification requirements, never
automatic widening. Envelope updates prove neither running instances nor order effects; native readback remains
required. Unspecified withdrawal policy: debit releasable unallocated capital first, then
apportion the remainder in proportion to each strategy's releasable idle capital, not initial allocation fractions
or position notional. Derive releasable amounts from a consistent pre-withdrawal effective fact frontier and existing
Risk constraints; retain policy/frontier identity, amounts and cash-precision rounding, and apply each cashflow once.
Portfolio records capital flow rather than trading loss; Governance updates production envelopes, and replay records
its run-local allocation event. Strategies handle no withdrawals. Do not automatically resize pending orders or
remove position protection. If actual withdrawal exceeds provably releasable product capital, accept venue facts,
record the deficit and use existing Risk/recovery constraints for affected additions; never invent releasable funds,
erase commitments through prorating or preserve a fictitious pre-withdrawal balance. Unallocated
capital is a product attribution category, not venue availability or withdrawable amount. Capital attributed
to strategies but not committed at the venue may remain withdrawable. For example, 100,000 fully attributed
to A/B with no unallocated cash and 70,000 position/order usage may leave 30,000 withdrawable under the venue
model. Withdrawing it can comply with venue limits while requiring strategy-capital attribution updates.
Read `maxWithdrawAmount` separately rather than equating it to `availableBalance`, and reconcile local admitted
commitments not yet reflected at the venue. Accept an actual withdrawal as an account fact even if strategy
attribution is pending; apply the explicit withdrawal policy to attribution and risk constraints afterward.
Explained reconciled
external activity alone does not unconditionally stop operation. Unexplained drift, unavailable account evidence
or exceeded risk bounds blocks affected-scope additions under existing Owner contracts. External cancellation/
closure updates execution feedback from authoritative facts; it is not a strategy-triggered exit or permission
to restore the old order/position automatically. Research replay may inject pre-registered external cashflows
and interventions to verify the same accounting, attribution, capacity and feedback semantics.
Unavailable consistent state blocks affected-scope risk
addition under existing Runtime readiness, Risk fence and Execution Recovery contracts. Protection/recovery
uses only its existing authority; synchronization cannot blindly trade to match a ledger, and reconciliation
closure does not restore trading authorization. Acceptance covers ordinary basis differences, missing/duplicate/
reordered events, pending cancellation, liability replacement, external capital changes, unknown fills, restart
and recovery, retaining original facts/correction lineage. Owner ledgers still mark Execution reconciliation/
recovery custody and full Portfolio account projection TARGET; this is design, not a deployed Binance integration.

### Design change and qualification bounds

**Change boundaries.** Within approved research bounds, an agent changes entry/sizing/exit rules through new
artifacts and counted trials, never by editing an already qualified artifact or reusing old eligibility for new
meaning. User risk tolerance and research hard caps constrain the strategy from outside; widening them or changing
pass standards requires user confirmation. Strategy parameters or Governance allocations cannot widen qualified
economic ceilings. This table grants no new Owner implementation admission, Paper/Live route or production write.
Every later task names intent producer, sole admission authority, effect source and readback consumer; it cannot
create a second account or risk authority inside the strategy.

## Research request and iteration contracts

Product Edge submits a source-linked hypothesis. The request states the intended mechanism and the question
to falsify and commits the bounded Qualification phase-fact frontier already projected to that principal. It is
not yet strategy evidence or permission to trade.

### Requests and visible state

The R&D workbench presents the accepted Source and Hypothesis, frozen Research Intent, Strategy Artifact and
Build Receipt, exploratory requests and results, Diagnosis, and the terminal Iteration Decision as one continuous
journey. Every displayed stage resolves to its native Owner fact or a source-frontier-bound `STALE`, `UNAVAILABLE`,
or unresolved state; the workbench is not another registry.

After an exploratory result, Product Edge exposes only the action admitted by R&D facts: wait while the result is
non-terminal or unknown, submit the exact typed repair request selected by `REPAIR_INPUTS`, stop on a committed
terminal decision, create the one admitted successor Intent, or submit the exact `SELECTED_FOR_QUALIFICATION`
Candidate to Qualification. Each action creates a new typed request and remains `SUBMITTED_OR_UNKNOWN` until its
native receipt arrives. Run Detail and Compare may join bounded projections for explanation, but neither UI state
nor Observability telemetry can create an Iteration Decision, Selection, or Qualification intake.

### Registration, diagnosis and successors

Source Intake records provenance and treats source or tool content as untrusted data, never instructions. Before
freezing an Intent, R&D's Research capability records plausible alternative interpretations, a discriminating prediction, and a
falsifier. R&D freezes an initial PIT Market Snapshot Request before submission; Market Data correlates the
snapshot disposition to its exact identity, digest, scope, decision cut, provenance, license, correction, and Time
Evidence. Submission or silence is not a market fact.
The [Source Intake Playbook](../guide/source-intake/) defines the provider-neutral acquisition baseline without
adding a Flow node or business authority.
Research Intent freezes the mechanism, data scope, exact cost, slippage, and capacity-model versions, capacity assumptions, permanent TrialFamily, complete semantic predecessor frontier, precommitted independence basis, budget,
falsifier, and stop rule. Develop Sandbox builds in isolation. Strategy Artifact binds the frozen intent,
code, dependencies, and runtime identity. Exploratory Native Replay may return canonical facts for a new intent
only when the result exactly repeats the request's Artifact, PIT scope and snapshot, universe selection and
correction rule, replay configuration, Runtime kernel, simulator, cost, slippage, and capacity identities.
Each terminal exploratory result first supplies one complete finite non-empty `diagnosticCategorySet`, preserving
every simultaneously supported category. The six execution-defect categories map to the same `REPAIR_INPUTS`
branch; `NO_EXECUTION_DEFECT` and `VALID_ECONOMIC_FAILURE` allow interpretation, while `UNRESOLVED_FAILURE`
produces no decision. R&D's Research capability then
diagnoses evidence, mechanism, economics, robustness, failure cause, and ordinal information value. It
then commits one Iteration Decision: `REPAIR_INPUTS`, one `SINGLE_DIMENSION` successor over
`RETURN_MECHANISM`, `MARKET_REGIME`, `INSTRUMENT_SCOPE`, `FEATURE_SIGNAL`, `ENTRY_RULE`, `EXIT_RULE`,
`POSITION_AND_HOLDING`, `FREQUENCY_AND_COST`, or `CAPACITY_AND_PORTFOLIO_ROLE`; one preregistered finite joint
experiment; `READY_FOR_SELECTION`; or a terminal stop. Selection
requires exactly one `READY_FOR_SELECTION` decision with the same policy, evidence, and Census cut.
`REPAIR_INPUTS` names exactly one of `MARKET_DATA`, `ARTIFACT`, `RUNTIME_KERNEL`, `BACKTEST_OPERATIONAL`,
`SIMULATOR`, or `REPLAY_CONFIGURATION` and its native
Owner boundary. It is terminal for the consumed result and starts no repair, successor, Artifact, Replay Request,
or Selection by itself. Market Data owns PIT repair; R&D owns Artifact and Replay Configuration repair. For
`RUNTIME_KERNEL`, `SIMULATOR`, or `BACKTEST_OPERATIONAL`, R&D freezes one `native-repair-request` bound to the
predecessor repair decision, stable correlation, original proof digest, category-specific old identity and source
cut, target Owner, policy, and fresh Time Evidence. Runtime accepts only kernel repair; Backtest accepts
`SIMULATOR` only at its Sim Exchange surface `sim-exchange` and `BACKTEST_OPERATIONAL` only at Native Replay's
`BACKTEST_RUNNER_SERVICE`. `BACKTEST_OPERATIONAL` binds the operational profile, run attempt,
runner readiness, backpressure, resource-exhaustion or outage evidence, and Time Evidence; it preempts economic
interpretation and cannot masquerade as `RUNTIME_KERNEL` or `SIMULATOR`. Only the native Owner commits
`REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN`: `REPAIRED` permits only one new request-equal Replay Request
bound to the exact predecessor `REPAIR_INPUTS` decision, category, native repair request and result identities,
original proof digest, stable correlation, predecessor and successor native identities and cuts, and unchanged
predecessor request semantics. `BACKTEST_OPERATIONAL` also binds the successor operational-profile identity and
cut. Only `REPAIRED` permits re-entry; `UNAVAILABLE` closes only as the exact correlated
`STOP_INPUT_UNAVAILABLE`; `OUTCOME_UNKNOWN`, request delivery, silence, or nonterminal evidence produces no stop,
retry, successor, Artifact, Selection, or Replay Request.
Next action has total precedence: repair, hard stop, ready for selection, low-information-value stop, then one
unique change. The finite change set uses ordinal rank, deterministic tie-break, and collision-free identity plus
content digest; duplicate identities or complete comparison keys invalidate the set and create no action.

The attended D-only branch is separate from this adaptive TrialFamily loop. Product Edge submits one exact
`ATTENDED_D_ONLY_REPAIR`; an accepted receipt proves only R&D admission. Pre-admission rejection is
`REJECTED_NO_WRITE` on that receipt and creates no repair attempt or disposition. R&D then writes one request- and
attempt-correlated D-only Repair Disposition. `D0_COMPLETED_NO_ARTIFACT` proves the declared non-executable repair
with no Artifact. `D1_VALIDATED` requires a new immutable Artifact plus passing request-equal repair validation
and only permits a separately formed attended-repair Candidate. `D1_VALIDATION_FAILED` preserves any built
successor Artifact and failed validation but creates no Candidate. `D1_BUILD_FAILED` terminally records a
deterministic build, package, or Artifact Security Admission failure before any canonical successor Artifact,
validation result, or Candidate and grants no retry. `REJECTED_NOT_D_ONLY` routes semantic change to
a separate sourced-hypothesis request, and `OUTCOME_UNKNOWN` closes the attempt at its last authoritative
frontier without success or naked retry. Same request, admission, attempt, and meaning replay the same write-once
disposition; another attempt requires a new explicit user request, successor admission, and successor attempt.

### Service handoffs

Product Edge → R&D carries the sourced request. R&D → Product Edge returns one write-once R&D Request
Request Receipt: `ACCEPTED` binds the resulting Research Intent, while `REJECTED_NO_WRITE` proves no Research
transition. No receipt leaves the original request unresolved. R&D → Market Data carries the frozen initial
PIT Market Snapshot Request; Market Data → R&D carries only its exactly correlated disposition.
After a committed `REPAIR_INPUTS` decision, R&D → Market Data carries one correlated Market Data Repair
Request; Market Data → R&D returns only the matching `AVAILABLE` or `UNAVAILABLE` PIT Snapshot terminal.
Delivery, silence, and a changed proof digest are not repair results.
Inside R&D, Research and Develop share one Owner: Develop produces immutable Artifact/build evidence without a
second authority. R&D → Backtest carries the immutable Artifact and one separately frozen Exploratory Replay
Request bound to that exact artifact, data scope, replay configuration, and the Intent's exact cost, slippage, and
capacity-model identities. Backtest → R&D carries exploratory facts only; it never selects the next R&D action.
For native repair, R&D → Runtime carries only a `RUNTIME_KERNEL` `native-repair-request`, while R&D → Backtest
carries only a `SIMULATOR` or `BACKTEST_OPERATIONAL` `native-repair-request`; each Owner returns the exact
request-correlated terminal result and R&D alone may form its resulting replay or stop transition.
Market Data → Backtest supplies the frozen replay input. Later Market Data corrections enter R&D only as
successor-only committed provenance and never mutate the earlier request, Intent, Selection, or deployed generation.
Only `SELECTED_FOR_QUALIFICATION` may carry the frozen Candidate and its exact disposition to Qualification;
every terminal stop remains only in the Iteration Decision and creates no Selection, Qualification intake, or
protected holdout use.
The Candidate also carries the pre-result Protected Robustness Plan covering required time, regime, instrument,
perturbation, and reasonable parameter-neighborhood cells plus coverage, tolerance, threshold, aggregation, and
missing-cell policies. Qualification and protected Backtest consume it unchanged and return no protected detail.
Committed Live Performance, Runtime Incident, and Reconciliation Drift facts can enter only a successor source
lineage and never mutate an already selected or deployed Intent.

### Evidence closure

The scenario begins only after an `ACCEPTED` Research Request Receipt bound to the exact `FROZEN` Research Intent.
It ends with that intent, permanent TrialFamily identity, content-addressed Strategy
Artifact and Build Receipt, one stable R&D-owned Exploratory Replay Request, identified PIT Market Snapshot, and canonical exploratory Run Results joined to that request.
If and only if the Iteration Decision is `READY_FOR_SELECTION`, proof also includes exactly one selected-only
Research Selection Disposition bound to the frozen Intent falsifier and the complete exploratory and Census
frontiers used for selection. A terminal stop is proved by Iteration Decision alone and has no Selection or
Candidate. Intent, Request, Result, Diagnosis, Iteration Decision, and any Selection and Candidate repeat the same
exact cost, slippage, and capacity-model identities.

## Acceptance outcome

- **Beneficiary** - researchers and strategy developers who need fast iteration without spending protected evidence or hiding failed trials.
- **Observable outcome** - a sourced hypothesis becomes a reproducible artifact and one explicit Iteration
  Decision; only `READY_FOR_SELECTION` adds a falsifier-bound Selection before Qualification can begin.
- **Harm if unchanged** - exploratory winners could erase losing siblings, drift from the frozen falsifier, or consume holdout on candidates Research never selected.
- **Terminal negative** - falsifier rejection, stop rule, exhausted budget, or a correlated unavailable-input
  repair ends in an explicit Iteration Decision stop with no Selection and no protected replay. An incomplete,
  mismatched, unknown, or nonterminal attempt stays unresolved or becomes typed repair evidence; it is not a stop.

## Refusal, unknown and forbidden transitions

- Missing provenance, PIT time, instrument identity, costs, budget, or falsifier blocks artifact admission.
- Generated code cannot access account or execution authority from Develop Sandbox.
- An exploratory result is not eligibility, deployment, or live evidence.
- A mutable, superseded, mismatched, incomplete, or unresolved exploratory request creates no run or result.
- Only a request-equal `TERMINAL_RESULT` may enter Research Selection. Rejected, invalid, unknown, non-terminal,
  and request-mismatched attempts remain TrialFamily Census facts only. Rejected or invalid evidence can produce
  only typed `REPAIR_INPUTS`; unknown evidence produces no decision. A successor experiment must equal the
  highest-ranked admissible option under the frozen tie-break.
- Duplicate diagnostic classifications, change identities, content digests, or complete comparator keys never
  fall back to arrival order; they produce unresolved/no-decision.
- Purge and embargo derivation, family-aware multiplicity, complete attempt frontier, protected policy, experiment
  mode, changed dimensions, and finite joint combinations are frozen before their results and carried unchanged.
- A protected result cannot return to this research loop.
- A missing or falsifier-mismatched selected-only Research Selection Disposition cannot cross into Qualification;
  no non-selection disposition exists.
- A later request may reference an opaque feedback frontier, but Research never receives protected category or detail and cannot grant a fresh holdout budget by changing TrialFamily.
- Shell delivery without the R&D-owned receipt cannot create or prove a Research Intent.
