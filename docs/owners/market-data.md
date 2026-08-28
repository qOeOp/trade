# Market Data

## Responsibility

Provide canonical, time-correct market, reference, and instrument facts to every analytical and trading consumer. Market Data owns data meaning and observability, not the strategy-specific selection of what a run should consume.

## Authoritative facts owned

- Normalized market records with distinct event time, provider-available time, retrieval time, and correction
  publication time. An observed value means available to this system at the bound decision cut, not merely that
  the underlying event had already happened.
- Dataset versions, point-in-time availability, coverage, lineage, corrections, and license constraints.
- Canonical instrument identity, venue mapping, tick size, contract lifecycle, currency, and valuation terms,
  including effective-dated trading calendar, session and time-zone rules, corporate actions, symbol changes,
  expiry/roll facts, and historical membership.
- Universe Selection Record binding the requester-owned selection rule, eligible-instrument frontier, effective and
  observed times, historical membership cut, exclusions, and result identity. Market Data evaluates a supplied
  rule but does not choose a strategy universe.
- PIT Market Snapshot identity bound to source and dataset versions, the four time coordinates, shared clock and
  decision-cut availability frontier, Instrument
  Master and Universe Selection Record versions, calendar/session/time-zone and corporate-action cuts, coverage,
  license, correction lineage, and one Market Semantics Compatibility identity.
- Every ordinary Research snapshot disposition additionally repeats the exact PIT Market Snapshot Request identity
  and content digest, requested instrument and universe scope, decision cut, provenance, license, correction,
  stable correlation, and Time Evidence. `PREPARED` or `SUBMITTED_OR_UNKNOWN` on the Research side proves no data
  availability.
- Market Semantics Compatibility identity shared by historical snapshots and live streams: normalization,
  adjustment, timestamp interpretation, instrument/reference mapping, and input-meaning versions.
- **TARGET:** typed Strategy Input Binding Receipt resolving one Research-declared market/reference role to exact
  instrument/universe, field, timeframe, units, PIT/live cut, source and Market Semantics identities.
- Immutable Market Data Source Binding binding source implementation and configuration digests, authenticated
  endpoint and dataset/account mapping, trust and normalization policies, license and redistribution scope,
  and an opaque least-privilege credential handle.
- Each Source Binding retains the complete supported failure-category set. A versioned stable precedence selects
  one primary category and canonical state independent of evidence arrival order: revoked rights are `REVOKED`,
  definitive denial is `UNLICENSED`, unresolved rights evidence or source unavailability is `UNAVAILABLE`, and
  identity/configuration or semantics mismatch is `INCOMPATIBLE`. `ADMITTED` is exclusive and requires no failure.
- **CURRENT:** one private canonical clock head is atomically persisted with Owner-local Source Binding and PIT facts.
  Exact replay and same-epoch advancement are supported; epoch change, a sealed cross-Owner handoff, and an Epoch
  Successor Proof are not current.
- **TARGET:** an immutable, content-addressed, exactly resolvable sealed clock-head handoff binds head identity/digest,
  clock identity/epoch, monotonic sequence, wall observation, decision cut, exclusive valid-through,
  restart-continuity digest, uncertainty/skew bounds, and comparison rule. Same-epoch successors strictly advance the
  required cuts. A new epoch additionally requires one direct immutable Epoch Successor Proof atomically committed
  with the new head and binding exact predecessor/successor head digests, prior/successor epoch identities, successor
  continuity digest, proof identity, commit cut, and comparison rule.

## Modules

- **Data Clients** - connect official vendors and venues and retrieve raw trades, quotes, bars, and reference files without defining their business identity.
- **Data Engine** - normalize records and time semantics, serve subscriptions and queries, and materialize reproducible snapshots.
- **PIT Catalog** - record when data, calendars, sessions, actions, membership, and corrections became observable;
  evaluate supplied universe-selection rules without admitting future information.
- **Instrument Master** - own effective-dated instrument identities, venue mappings, contract terms, sessions,
  time zones, lifecycle and corporate-action facts; it does not choose a run universe.

## Strategy input-role binding

For the [StrategyDesignV2 compiler](../architecture/strategy-factory#strategy-design-v2-shared-lifecycle-kernel),
Research declares a typed input role and Market Data alone resolves market/reference roles to an exact sealed
binding receipt. The receipt binds the role to a role-independent stable selection identity covering field
semantics, instrument or stable Universe Selection Record scope, timeframe/bar specification, units and scaling,
Source Binding lineage root, correction stream, and Market Semantics Compatibility identity. Renewable PIT,
snapshot, batch, frontier/version, time, sequence, row and value facts are excluded. It grants data consumption only; it does not choose a strategy universe,
mechanism, target, lifecycle action or order.

Missing, stale, ambiguous, incompatible or non-unique role resolution is an unavailable binding and produces no
`StrategyPlanV2` or replay/runtime input. Market Data, R&D and the compiler must not infer a binding from ticker,
free-form label, alias, substring, naming similarity, list position or arrival order. Historical Backtest and later
admitted Runtime adapters must preserve the same role and Market Semantics identities; a mismatch fails closed
rather than being normalized by the consumer.

**CURRENT/PARTIAL, Owner-binding M1:** Market Data can derive one exactly-two-member universe only
from a complete `VerifiedPitObservationBatch` and atomically seal its canonically sorted member keys,
distinct canonical instruments, Owner-derived static selection identity/digest, Instrument Master digest,
batch/snapshot facts, Source Binding lineage, Market Semantics identity, and every requested `(member, role)`
value. The static selection authority binds the one-to-one member/instrument set plus Instrument Master,
Source Binding lineage-root and Market Semantics cuts; the original PIT-request universe digest is dynamic
provenance only. Caller arrival order is irrelevant. Missing, duplicate, third or inconsistent members;
cross-key instrument aliasing; missing or ambiguous member-role rows; any selection/master/semantics/lineage
splice; and caller `InstrumentSet` scope produce no positive
selection or frame. This is a current Owner-local binding contract only; it does not claim compiler,
shared-kernel, ProgramHost, Backtest, Paper, Live, or production maturity.

**SEALED_ACCEPTANCE only:** enabling the non-default compile-time Cargo feature
`sealed-strategy-input-acceptance` exposes one zero-argument fixture adapter for the fixed AAPL/MSFT,
OPEN/CLOSE corpus. The adapter drives the crate-private Source Binding admission and PIT
prepare/aggregate/verify authorities, then calls the normal universe-frame binder; it accepts no caller-selected
rows, requests, locators, digests, clocks, providers, persistence, or runtime selector. Default and production
manifests omit the feature. A release build that explicitly enables it remains an isolated acceptance artifact,
never a production build. This fixture proves only the compile-time acceptance topology: it provides no PostgreSQL
custody, provider connectivity, deployed Windmill readiness, production composition, or trading authority.

The runtime handoff consumes the existing static receipts plus one verified batch and re-resolves each selection;
the frame contains only its trigger and dynamic value receipts. Market Data issues its trigger only from selected rows
in one Owner-verified observation batch with identical snapshot/fact/batch identities, event-effective,
provider-available and correction-publication times, non-zero correction sequence, and event class. Bars map to
`BAR`; quote, trade, reference, economic and scalar frames map to `EVENT`; logical time is the greater of
provider-available and correction-publication time; event time is event-effective time; and Owner sequence is the
correction sequence. Stable event identity is the first 16 bytes of domain-separated BLAKE3 over those coordinates
and the sorted role/binding/row-digest set. Each ordered role-value receipt preserves its original binding digest
and role identity, seals the explicit fixed-i128 semantic, exact little-endian bytes, scale and row digest, and
cross-binds the trigger and observation-batch digest. Consumers derive the lifecycle envelope from the trigger;
they cannot mint it from caller-selected values or order keys. Market Data never issues `TIMER` or `FILL` triggers:
those remain unavailable pending real Time/Scheduler and Execution Owner contracts respectively.

## Input handoffs

- Data vendors and trading venues provide raw market and reference records through Data Clients.
- [R&D](./rd/) submits an initial frozen PIT Market Snapshot Request before exploratory consumption.
  It binds the Research Request, Intent, TrialFamily, instrument or universe scope, four-time decision cut,
  required provenance, license and correction frontier, stable correlation, and Time Evidence.
- [R&D](./rd/) may submit one Market Data Repair Request only from a committed `REPAIR_INPUTS`
  Iteration Decision. It repeats the original PIT request identity and proof digest, instrument scope, decision cut,
  bounded reason, stable correlation, required provenance/license/correction fields, and shared Time Evidence.
- Operations supply the Market Data Source Binding, opaque credential handles, license scope, and correction feeds without
  changing observed-at history. Credentials never enter a snapshot, stream, artifact, or product view.

## Output handoffs

- To [R&D](./rd/): one move-only, Market Data-sealed `ResearchPitTerminal` whose canonical six-state
  disposition is correlated to the exact initial
  request identity, content digest, scope, cut, provenance, license, correction, and stable correlation, plus the
  exact Universe Selection Record identity and digest for hypothesis testing. A repair request resolves separately to the same correlated request identity
  as `AVAILABLE` with the repaired snapshot, or terminal `UNAVAILABLE` with a bounded decisive source category.
  Strategy Factory cannot import, construct, deserialize, or implement the terminal authority and receives no raw
  store receipt, PIT lineage rows, Source Binding lineage rows, or clock rows.
- To [Backtest](./backtest/): the exact PIT Market Snapshot and Universe Selection Record for the request-bound PIT scope and snapshot/correction rule; actual consumption must repeat both identities and every frozen execution identity in Run Result.
- To [Scanner](./scanner/): the exact PIT Market Snapshot requested by published activation conditions.
- To [Runtime](./runtime/): live market streams and instrument updates carrying the same Market Semantics
  Compatibility identity consumed by the generation's Strategy Artifact and historical evidence.
- To [Portfolio](./portfolio/): prices, FX rates, contract specifications, valuation facts, and an identified liquidity input cut for Capacity View.
- **TARGET, after Shared Time producer closure, to [Portfolio](./portfolio/):** the sealed canonical clock-head handoff
  for `PORTFOLIO_FRESHNESS`. Portfolio supplies its exact prior handoff and alone authorizes its transition; it cannot
  walk or skip proof links or compare monotonic sequences across epochs.

## Rejections and prohibitions

- Never select the instruments or time window for a research run, backtest, or scan.
- Never silently fill, rewrite, or forward-date missing historical facts.
- Never treat a reachable source as proof that data is licensed, complete, point-in-time correct, or fit for a strategy.
- Never admit an unavailable, revoked, endpoint-mismatched, digest-mismatched, untrusted, or unlicensed source;
  never expose credential values or data outside its redistribution scope.
- Never own strategy, qualification, deployment, order, or account state.
- Never infer a repair terminal from delivery, silence, a prior snapshot, or a mismatched request proof. A repair
  never mutates the old snapshot or Research Intent.
- Never infer an ordinary snapshot result from submission or transport acknowledgement, or serve an earlier
  snapshot under a changed request identity, content digest, scope, decision cut, or policy binding.
- Never become a global Time Owner or decide another Owner's clock transition.
- Never construct the governed Market Data PostgreSQL repository from a DSN, secret, caller assertion, or ambiguous
  store state alone. The private Market Data store-admission seam must consume and revalidate its exact sealed
  Deployment Store Admission receipt, then
  Market Data must validate current PIT, Source Binding, and clock heads before sealing `ResearchPitTerminal`.
  Ordinary consumers never receive the receipt, capability, raw evidence, or a caller-selected snapshot query.
  Production resolution and dynamic product composition remain `TARGET / UNAVAILABLE`.

## Failure and recovery

Unavailable, stale, unlicensed, ambiguous, or insufficient data fails closed for the dependent consumer. Corrections create a new traceable version rather than rewriting prior receipts. During recovery, Market Data continues supplying valuation facts, but it cannot declare positions, effects, or a Recovery Case closed.

Provider-catalog `LEGAL_REVIEW_REQUIRED` or otherwise unknown rights map to
`RIGHTS_EVIDENCE_UNRESOLVED` and Source Binding `UNAVAILABLE`; they do not become `UNLICENSED` without decisive
denial evidence. `TERMS_OR_LICENSE_BLOCKED` is an R&D Source Intake terminal, not a Market Data state. Market Data
must re-evaluate the underlying rights evidence under its own policy and never copy that terminal across Owners.

When multiple blockers are supported, the binding and snapshot retain all of them and choose one stable primary.
Snapshot precedence is `UNLICENSED` before `AMBIGUOUS`, `STALE`, `INSUFFICIENT`, then `UNAVAILABLE`.
`REVOKED` or `UNLICENSED` source bindings map to snapshot `UNLICENSED`; `INCOMPATIBLE` maps to `AMBIGUOUS`;
source `UNAVAILABLE` maps to snapshot `UNAVAILABLE`. Later evidence creates successor bindings and snapshots and
never upgrades an earlier terminal result.

If any time coordinate or the shared decision cut is missing, conflicting, or cannot prove that the fact was
available at the decision, the snapshot is `AMBIGUOUS` or unavailable. Event time alone never admits a historical
fact, and retrieval after the cut never backfills an earlier decision.

## Decision contract

- **Inputs** - admitted source binding, raw market and reference records, correction feeds, license scope, and a
  requester-owned universe rule or PIT scope.
- **Diagnosis and decision** - normalize meaning, establish four-time availability, resolve instrument identity,
  coverage, correction and license, then materialize one versioned fact or snapshot disposition.
- **Conflict resolution** - source lineage and decision-time availability outrank later corrections; conflicting
  identity, clocks or versions remain ambiguous and corrections create successors.
- **Outputs and terminal negatives** - streams, instrument facts, selection records and PIT snapshots, or explicit
  `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, and unavailable results.
- **Feedback and economic meaning** - common historical/live semantics prevent phantom Alpha, valuation drift and
  unsafe sizing caused by look-ahead, wrong contract terms or unlicensed incomplete data.
- **Prohibitions** - no research objective, strategy universe choice, lifecycle, order, account projection,
  credential disclosure, forward fill or rewritten availability history.

## Subsequent implementation acceptance

- A historical query can prove exactly which version was observable at its requested time.
- Every admitted fact proves event, provider-available, retrieval, and correction-publication time against the
  same clock and decision cut; no later-known fact can become earlier-available evidence.
- Instrument identity and contract terms remain consistent across research, replay, live data, valuation, and execution adapters.
- Historical and live consumers reject a mismatched Market Semantics Compatibility identity instead of silently
  changing normalization, adjustments, timestamp meaning, or instrument mapping at deployment.
- Every PIT request proves calendar, session, time-zone, corporate-action, lifecycle, historical-membership, and
  universe-selection versions as both effective and observable at the requested cut.
- Every ordinary Research response repeats the exact initial PIT Market Snapshot Request and correlation bindings;
  changed meaning requires a successor request and silence creates no Market Data or Research transition.
- Consumers receive explicit insufficiency or staleness instead of synthetic success.
- Re-running a snapshot against the same admitted versions yields the same canonical inputs.
- Snapshot outcomes are explicit: `AVAILABLE`, `INSUFFICIENT`, `STALE`, `UNLICENSED`, `AMBIGUOUS`, or
  `UNAVAILABLE`. Every repair response additionally repeats the repair request identity, stable correlation, and
  original request proof digest.
- Simultaneous rights, compatibility, freshness, sufficiency, and availability failures preserve the complete
  blocker set while the frozen precedence selects the same primary under every evidence-arrival permutation.
- Protected replay cannot substitute a different PIT scope, Universe Selection Record identity or digest, snapshot rule, correction frontier, or snapshot identity after Qualification freezes the request.
- Same-epoch handoff replay joins exact bytes; advancement strictly advances required cuts without changing epoch
  semantics. A new epoch fails closed unless its new head and direct immutable proof commit atomically and both remain
  exactly resolvable by digest.

## Observability and persistence

Market Data persists Source Binding, rights/retention decision, semantics profile, instrument history, PIT requests and snapshots, stream/valuation facts, corrections, and publication outbox under its own write authority. Telemetry records provider request latency, freshness, gaps, rate limits, correction lag, and bounded rejection category without exporting API keys or licensed payload bodies. Dashboard source health always carries source/semantics versions, as-of frontier, license disposition, completeness, and valid-through; a green provider metric cannot substitute a missing or stale PIT fact.
