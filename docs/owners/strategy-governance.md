# Strategy Governance

## Responsibility

Own the deployable strategy registry, lifecycle decision, and permitted capital policy from qualification through retirement. Governance decides whether a strategy generation may run; it does not design artifacts, judge individual trades, or own order effects.

## TARGET - Joint-operation admission

Joint operation requires each complete strategy's own eligibility and matching composition eligibility, without
composition-only activation for independently ineligible members. One complete strategy may contain return and
hedging rules and multiple legs; it has one strategy version, lifecycle and allocation identity. Internal legs create
no separate trial/formal members or pool shares; actual usage remains account facts. Governance cannot waive
member eligibility or reinterpret its assessed scope based on correlations, hedging labels or composition metrics.

Governance maintains one effective composition binding per trading account, covering all running members
across trial and formal pools and the obligations for protected residual positions. It does not manage separate
AB/CD subgroup configurations. Applying a researched subset requires matching evidence for the resulting
whole-account composition; subset eligibility alone cannot justify additional members. Approved transitions
record current state under the frozen plan rather than inventing another research configuration.

Trial, promotion, unloading and return to research belong to each member strategy separately. Composition
definitions and joint eligibility constrain which members may operate together; the composition is not another
stage object requiring all members to pass, promote or unload together. A member change still requires checking
successor assessment applicability; unchanged stages of other members cannot justify mismatched joint eligibility.

Joint operation requires member eligibility and matching composition eligibility, valid user authority,
current capital/risk facts and native readiness. For already running strategies, an Agent may request adoption
of an assessed successor composition version within explicit prior user-approved change bounds. Governance
validates the exact configuration and evidence scope, authority and current facts before applying it; wider
changes require user confirmation. Research resource approval does not grant this operational authority.
Initial trial entry for a new strategy version still requires Dashboard confirmation; composition-change
authority cannot bypass it.

Governance records the approved active binding to the exact R&D composition configuration and matching
Qualification evidence. It owns operational authorization and capital policy, not the research configuration;
it neither rewrites that definition nor issues research eligibility. Governance consumes Qualification
evidence rather than running backtests. Current Portfolio interaction/account facts do not replace historical
composition eligibility, and historical evidence does not replace live Risk admission. Members and allocation
states must match the assessed applicability scope; unknown scope cannot expand authority.

On entry, unload or automatic promotion, check whether changed membership or equal allocation remains covered
before authorizing subsequent joint operation. Uncovered expansion requires reassessment. Stopping new
entries, cancelling entry orders and retaining existing protection cannot be blocked by reassessment. Before
admitting a new strategy to joint operation, require approved versioned rules and exit plans with
Qualification coverage for ordinary membership/allocation changes, including protected residual exposure.
Apply covered plans against current account facts without requiring a new assessment for each occurrence.

Changed members, policy or unsupported states require assessment before admitting new risk; unchanged formulas
alone do not prove coverage. Governance checks evidence and applies plans, not backtests or economic
optimization. Detailed normative bindings remain to be completed; no separate composition governance service.

## TARGET - Trial and formal strategy lifecycle

Strategy versions follow the R&D canonical content hash (`strategy_id`), not run or Research request IDs. A new
hash follows the complete lifecycle. An unchanged version may return to its original stage only through user
confirmation and resolution of the original qualified Artifact and stage evidence, with current eligibility,
authority, capital and risk checks. A stop never reactivates it automatically; missing or changed qualification
bindings cannot be repaired by hash equality. Pool reallocations alone do not change the strategy version.

Backtest qualification makes a candidate eligible, not active. Dashboard requires the user to confirm trial entry
for the exact candidate, frozen trial conditions and capital policy; valid current authority, allocation and native
readiness remain required. The user may keep a qualified candidate in R&D to improve it. Qualification alone never
starts a trial or causes automatic reactivation after a user stop.

The user may unload an economically valid strategy for improvement; an external Agent may also request this
autonomously within prior user-approved frozen boundaries. Governance verifies the affected strategy,
authority scope and current facts before applying it; missing valid authority produces no unload effect. This
permission covers unloading and R&D handoff, not activation of successors or changes to eligibility, capital
policy or existing protection. Governance records the user or admitted Agent improvement reason and authority
basis separately from economic failure and preserves qualification and stage evidence; unloading does not
fabricate a failed backtest or revoke qualification.

Stop new entries, cancel entry orders, return running allocation immediately and keep residual positions under
their original protections through the native path. R&D owns any successor; changed candidates requalify,
receive a new user-confirmed trial and cannot inherit previous stage authority.

The promotion route is R&D iteration, qualified backtest, real trading trial, and automatic promotion on frozen
conditions. Governance owns stage decisions, trial/formal membership, user-approved condition versions and capital
allocation; it does not produce backtest qualification, fills or profit measurements.

- Qualification consumes Backtest evidence and owns backtest eligibility and protected assessments; failures stay in R&D.
- Portfolio provides returns, NAV, fees, funding, capital-flow and attribution facts; Runtime/Execution provide actual operation, orders and fills.
- Governance consumes these facts under conditions frozen before operation to decide promotion, maximum-period trial termination and formal retention. A Dashboard selection is not a passing result.
- Approved ratios divide the common trial and formal pools; each pool allocates equally among actually running instances, recalculating on entry, unload or promotion. Unloading returns allocation immediately. Actual residual margin and exposure remain account facts checked by Risk at order admission, without retaining the unloaded strategy's running allocation.
- Trial expiry without meeting frozen promotion conditions or failure of formal retention conditions unloads the strategy and returns it to R&D. Stop new entries, cancel unfilled entry orders and hand existing positions to the existing native Runtime/Risk/Execution path under original protections. Direct downgrade from formal to trial trading is forbidden.
- R&D owns diagnosis, successor changes and new backtests; successors qualify again and start new trials without inheriting old results, stage decisions or authorization.
- Strategies express signals and necessary protection rules, not their own eligibility, promotion, unload, pool membership or allocation. Dashboard provides selection and readback.

Provide two finite per-trade sizing templates: fixed margin proportion and fixed planned-stop-risk proportion.
There is no default. Dashboard creation requires explicit template/exposed-parameter selection; APIs require
the same selection or an exact frozen configuration reference. Missing selection cannot produce a runnable
policy or operation authority, and previous selections are not automatically inherited. Reuse preserves an
explicit selection; existing frozen versions are not rewritten. The first derives a margin budget from
allocated capital, then calculates requested quantity using leverage and instrument specifications.

The second derives quantity from planned risk budget and entry/stop distance using native fixed-risk sizing,
subject to margin, leverage and quantity constraints. Planned stop loss is not a maximum actual loss; include
fees and gap/slippage assumptions. Freeze template, proportion, capital base, leverage, bounds and
effective/update rules before experiments and operation. Strategies express entry, stop and related rules;
shared sizing uses approved policy rather than private balances or policy changes. Both retain instance
limits, account Risk and queued-entry constraints.

Equal pool division remains the default. Fractional Kelly or unequal allocation is an optional named policy version
requiring R&D registration, independent assessment and explicit user approval of the exact version. A passing replay
or new estimate does not automatically change policy. Governance manages approved formulas, parameter bounds and
update conditions rather than training probability models. Operation must match policy eligibility and capacity scope;
queued member admission and shared-account/instance limits remain binding.

Allocation uses current account net equity under the approved measurement method, not exchange free margin
after position usage as a repeatedly shrinking pool base. Governance applies approved trial/formal proportions and
the effective running-member count to calculate instance limits. A limit is neither a private strategy wallet nor a
copied balance. Portfolio provides versioned, fresh equity, actual usage and account free-margin facts; strategies
do not maintain or reconcile another account balance.

Before entry or promotion, Governance calculates a complete successor allocation for affected instances from one
consistent equity/member cut. Risk/Runtime must admit that allocation version before the new member can add risk.
Do not start the member before asynchronously reducing existing limits, or admit both old and new limits together.
Equity changes update limits under the same frozen formula, subject to eligibility applicability, economic capacity
and policy hard bounds. Changing the formula or expanding beyond assessed scope is not an ordinary balance refresh.

When adding a strategy would reduce existing member limits, every affected member's actual usage must first
fit its successor limit. Usage includes positions, valid orders and unsettled reservations, deduplicated through
existing settlement lineage; checking only positions or one member is insufficient. If any member exceeds its proposed
limit, Governance refuses immediate entry and durably queues the user-confirmed request. Existing membership and
allocation stay effective. Unstarted waiting candidates receive no target-pool allocation and do not count as running members.
Do not force position reductions or cancel existing valid orders to make room for the candidate.

A passing trial waiting for formal capacity continues trading under its effective trial policy. It remains
counted in trial membership/allocation and account usage, receives no formal allocation, and does not stop
entries or cancel valid entry orders merely because promotion waits. Amounts still update through approved
formulas/current account facts rather than freezing enqueue-time balances. Eligibility, authorization and Risk
constraints remain effective. Capacity waiting alone does not invent economic failure or reset evidence. A
currently passing trial may continue waiting beyond its maximum observation period.

If current promotion conditions fail and the frozen maximum observation period has ended, terminate trial and
return to R&D: stop entries, cancel unfilled entry orders and retain existing position protection. Neither a
previous pass nor waiting starts a new observation clock. One successor allocation removes trial membership,
adds formal membership and recalculates both pools; node application receipts prove transition. At actual
promotion, re-evaluate the frozen economic conditions using current, traceable trial evidence as well as
capital, eligibility, authorization and readiness.

An earlier pass is not perpetual promotion authority: if current conditions fail, retain trial membership and
policy without formal allocation. Do not reset evidence or silently change criteria to preserve the earlier
pass.

Account, usage or membership changes wake Governance to reread facts and recalculate successor limits, rather
than reuse fixed amounts from enqueue time. Once all affected members fit, composition eligibility, user
confirmation, account capacity, authority and readiness must still be valid. Risk rechecks usage and
allocation versions at the same scope serialization boundary before admitting the complete successor
allocation and allowing entry. Concurrent old allocation orders may invalidate readiness; keep waiting instead
of starting and repairing afterward. Waiting is a Governance request state, not another queue service or
perpetual authority.

Dashboard exposes reasons and cancellation; cancelled requests or withdrawn authority cannot activate
automatically.

Existing usage cannot disappear through allocation arithmetic. If declining equity or other account changes make
current effective limits insufficient, rather than a pending member transition, stop new risk under existing rules
and retain original protection. A new instance limit does not establish executable account funds: insufficient actual
availability prevents new-risk admission. Strategies do not automatically borrow each other's unused limits.

The target no longer depends on a separate Scanner deployment proposal or periodic match. Governance evaluates
approved frozen conditions directly from bounded Qualification, Portfolio and Runtime/Risk/Execution facts; R&D
on-demand discovery is neither deployment evidence nor authority. The legacy `ScannerConditional` contract below
is migration compatibility and remains rejected as `ConditionalScannerNotAdmitted` today. A named target policy version
keeps eligibility, capital, authority and recovery constraints rather than lifting evidence requirements on old paths
or silently reinterpreting fields.

Equal pool division uses a new target policy version; sealed priority ranking/capped allocation below retains its
original meaning. Do not reinterpret old fields for equal division or let each node allocate the whole pool again.
Governance publishes allocation from one effective membership cut.

This is target business policy. Condition choices, normative stage facts and versioned handoffs still need completion.
It cannot silently rewrite sealed contracts, authorization modes or effect admission below. Implementation must connect
the corresponding Owners without a second order, account or qualification engine.

## Authoritative facts owned

- Governed Strategy Entry binding ArtifactRef, exact Eligibility Fact and generation-specific economic-condition
  versions, qualified capacity ceiling, ActivationConditionVersion, CapitalEnvelopeVersion, effective interval,
  and one immutable Execution Scope. That scope binds a pre-admitted candidate-neutral Capacity Scope, exact
  adapter implementation/configuration and trust-policy digest, venue or simulator endpoint, account binding,
  capability and reduce-only policy, and the Execution-owned Adapter Binding fact identity under which that
  binding's opaque credential handle is held. Governance binds the identity, never the handle: Execution withholds
  `credential_handle_identity` from the readback Governance admits against, and resolves the handle itself at the
  effect moment. The identity pins the scope to one exact credential without giving a second Owner reach to it.
- Lifecycle state, Authorized Generation Decision, effective time, active generation, exact committed fact identities, and bounded rationale category. Every generation decision cross-binds the initiating request's complete Authorization Lineage and a distinct Autonomous Policy Authorization for unattended trading. Governance never copies protected Qualification content.
- Versioned Capital Envelope applicability chain: one `POOL_ROOT` envelope for the Portfolio-owned Capacity Scope
  plus one `STRATEGY_GENERATION` envelope for each governed generation. Both kinds bind their own
  `effective-from`/`effective-through` interval and the same complete shared Time Evidence shape; they are neither
  committed usage nor available headroom.
- **Compatibility priority-allocation profile:** Capital Allocation Disposition for one complete contender set and one Portfolio Interaction Receipt. It records
  the policy version, contender-set frontier, accepted shares, rejected or deferred contenders, and the exact common
  evidence cut. Its versioned priority vector is limited to Governance-owned `POLICY_PRIORITY_CLASS`,
  Portfolio-owned `PORTFOLIO_INTERACTION_CLASS`, and Governance-owned `REQUESTED_CAPITAL_FRACTION`; each declares
  comparison direction and missing-value disposition. `POLICY_PRIORITY_CLASS` additionally binds a finite versioned
  class dictionary with semantic meaning, classification-rule identity, decisive Governance fact cuts, per-contender
  rationale, and classified-at Time Evidence; an unknown, unmapped, or unexplained ordinal is
  `INPUT_INCOMPLETE_NO_WRITE`. The final tie-break is canonical strategy-generation identity,
  never arrival order. Governance allocates the scarce pool once; Risk only enforces the resulting envelopes.
  Before ranking, a Governance-owned contender-membership frontier must include every same-scope generation that
  retains effective add-risk authority and every pending authorized request that would establish or increase
  add-risk. Every other known generation or request has one typed exclusion; expected and observed identities,
  cardinalities, and digests must match exactly. This is derived from the existing Strategy Registry, lifecycle,
  authorization, and policy heads and does not create a second registry.
  The allocation state is `ALLOCATED`, `NO_ALLOCATION`, or `INPUT_INCOMPLETE_NO_WRITE`; every member is exactly
  `ALLOCATED`, `REDUCED`, `DEFERRED`, or `REJECTED`. Full fill is allocated, positive capped partial fill is reduced,
  zero fill after higher-priority capped fills is deferred, and policy-inadmissible membership is rejected.
- Canonical lifecycle actions are exactly `INITIAL_ACTIVATION`, `PROMOTION`, `REDUCTION`, `PAUSE`, `RETIREMENT`,
  `DE_RISK`, and `RECOVERY`. Retention renewal is an evidence evaluation, not an extra action alias.
  `DE_RISK_PENDING` is the committed successor state when an active generation loses the evidence required to
  retain add-risk authority.
- Authorization mode is part of every lifecycle decision. `ATTENDED_REQUEST` can remain non-running or authorize
  decrease-only `REDUCTION`, `PAUSE`, `RETIREMENT`, `DE_RISK`, or `RECOVERY`. `INITIAL_ACTIVATION`, `PROMOTION`,
  and automated Paper or Live require `UNATTENDED_REQUEST_WITH_POLICY` with current Autonomous Policy
  Authorization. `PROMOTION` includes the bounded higher-capital or active-successor transition; resume and
  capital-increase names are not lifecycle-action aliases.
- Write-once Lifecycle Request Receipt with `ACCEPTED` bound to one resulting Authorized Generation Decision identity or `REJECTED_NO_WRITE` bound to no governance transition.

## Modules

- **Strategy Registry** - store the current governed deployment decision, deployable ArtifactRef, and immutable generation Execution Scope without owning artifact content.
- **Lifecycle Manager** - compute `INACTIVE`, `ACTIVE_GENERATION`, `DE_RISK_PENDING`, `REDUCED`, `PAUSED`, or
  `RETIRED` from eligibility, performance, exposure, degradation, policy, incidents, drift, and closure facts.
  Renew `ACTIVE_GENERATION` only from fresh required evidence. Risk's Aggregate Commitment Frontier state is outside this lifecycle state machine.
- **Capital Policy** - version the `POOL_ROOT` plus `STRATEGY_GENERATION` Capital Envelope chain consumed by Risk without creating committed capacity, a trade command, or final trade size.
  A `POOL_ROOT` binds Capacity Scope, account namespace, gross limits, policy provenance, and effective interval but
  forbids strategy, generation, Execution Scope, parent, Eligibility, or allocation fields. A `STRATEGY_GENERATION` envelope binds
  exactly one generation, Execution Scope, parent pool root, Eligibility, gross limits, and effective interval but
  forbids sibling-parent, Portfolio usage, Risk headroom, or admission results.

## Implementation status ledger

This ledger records only what the repository has reached at this cut. It uses the status vocabulary of the
[Market Data](./market-data/) ledger, with `CURRENT_PARTIAL` as the merged-but-unreachable form, and grants no
permission by itself. The rows marked `IMPLEMENTATION_ADMITTED` below are the only admitted slices, each admitted as bounded, separately reviewable work whose acceptance is an isolated PostgreSQL proof, its ordered-chain
entries passing on Linux, and a production path that depends on no testkit or acceptance feature; every other row
grants nothing, and widening the admitted set requires changing this document first.

- **CURRENT_PARTIAL - static fail-closed Governance core:** `crates/strategy_governance` owns the in-memory
  `GovernanceCore`, whose `resolve_frontier` resolves one complete conflict frontier under the canonical precedence,
  writes the write-once `LifecycleRequestReceipt` as `ACCEPTED` or `REJECTED_NO_WRITE`, detects alias retry, replay
  divergence, and semantic mutation, and serves a `GovernanceDecisionView` and current lifecycle receipt readback.
  A missing or invalid Eligibility is the one refusal that produces no receipt at all: it fails the whole frontier
  as `DecisionEvidenceUnavailable` before any receipt is written, where a missing artifact, capacity, or adapter
  binding each reject with one. That asymmetry is deliberate and pinned by the unit suite, so while Qualification
  has no producer the write-once receipt is a fact that is never written rather than one written as a rejection.
  The model carries the seven lifecycle actions, `PAPER` and `LIVE`, both authorization modes, eligibility and
  application status. Those are consumer-side shapes only: repository-wide, `EligibilityState::Expired` and
  `EligibilityState::Revoked` have no producer at all, every `UntrustedEligibilityReadback` is built inside this
  crate's own tests, and `crates/qualification` carries neither term. These types have no connected read port or produced facts. The static slice validates only `INITIAL_ACTIVATION` for `PAPER` under
  `UNATTENDED_REQUEST_WITH_POLICY` with a single-contender set; every other action, `LIVE`, `ATTENDED_REQUEST`, and
  condition-dependent activation reject as `ActionNotAdmittedInStaticSlice`, `LiveNotAdmitted`,
  `AttendedNotAdmitted`, or `ConditionalScannerNotAdmitted`. Public construction installs an unavailable Owner
  admission, so every public request fails closed (`crates/strategy_governance/tests/public_fail_closed.rs`), and no
  Runtime receipt resolver can be installed, so application projects `APPLICATION_UNKNOWN`.
- **CURRENT_PARTIAL / IMPLEMENTATION_ADMITTED - Strategy Registry and Execution Scope creation:** the immutable
  Execution Scope now has production PostgreSQL custody in `crates/strategy_governance`, under `governance_owner` and
  `governance_writer`. Before it writes, the custody rereads Portfolio's own `BOUND` Capacity Scope and Execution's
  own current `ADMITTED` PAPER adapter binding through those Owners' read-only APIs inside the writing transaction,
  and it refuses unless the two agree on account and prebinding and the caller's expectations match what each Owner
  said. Agreeing on the prebinding means Portfolio's registry names the exact adapter binding fact Execution
  admitted, so every new Execution binding generation requires a new Portfolio registry cut before a scope can be
  created against it; an older cut is refused as a conflicting prebinding rather than accepted as a narrower one. Its `governance_api` readback exposes the bound meaning, the scope carries no validity window of its own, and
  a replay keeps the creation time while refreshing freshness from the two current source facts. No production caller
  reaches it: Product Edge has no lifecycle request intake. Still admitted and still absent: the Governed Strategy
  Entry, lifecycle requests, and receipts, because the architecture binds an entry to an exact Eligibility Fact,
  generation-specific economic-condition versions, and a qualified capacity ceiling, and Qualification and R&D have
  no production writer for those or for the build receipt.
- **TARGET - Lifecycle Manager:** no evidence-driven lifecycle state, `DE_RISK_PENDING` succession, retention
  renewal, or adverse-evidence disposition policy exists.
- **TARGET / IMPLEMENTATION_ADMITTED - Capital Policy and Capital Allocation Disposition:** no `POOL_ROOT` or
  `STRATEGY_GENERATION` Capital Envelope, contender-membership frontier, or allocation exists. Admitted slice: one
  `POOL_ROOT` and one `STRATEGY_GENERATION` envelope for the single admitted generation; the contender-membership
  frontier and the allocation stay `TARGET` until a second contender exists.
- **TARGET / IMPLEMENTATION_ADMITTED - Authorization Lineage and Autonomous Policy Authorization:** the Operator Authorization Issuer in
  `crates/operator_authorization` is the only implemented lineage member, with PostgreSQL custody read by the
  deployed R&D Owner API; no Product Edge lifecycle request intake reaches Governance, and no issuer exists for
  Autonomous Policy Authorization. Admitted slice: the Autonomous Policy Authorization as one more grant kind of that
  Issuer under a `STRATEGY_GOVERNANCE` audience, carrying the fields named by Product Edge, and the Product Edge
  lifecycle request intake that binds it.
- **TARGET - handoffs and persistence:** no port to Qualification, Scanner, Portfolio, Runtime, Execution, or Risk
  and no durable relation for any Governance fact.
- **UNAVAILABLE optional compatibility profile - Forward Decision gate on paper activation:** the static `INITIAL_ACTIVATION` slice reads no Forward
  Decision.

## Input handoffs

- [Qualification](./qualification/) supplies committed Eligibility State and Revocation facts with exact Candidate, fact, economic-condition, evaluated cost/capacity-model, and qualified-capacity versions. The optional sealed Forward Record profile additionally requires the current Forward Decision; it is not a real-trial prerequisite. Under that profile, a paper `INITIAL_ACTIVATION` binds a current `FORWARD_ADMITTED` decision for the same Eligibility Fact; any other, missing or unknown Forward Decision commits `REJECTED_NO_WRITE`.
- **Compatibility only:** [Scanner](./scanner/) supplies one terminal Scanner Receipt per scan; condition-dependent activation must bind an exact matched proposal member with the same strategy entry, ArtifactRef, and condition version as the decision target.
- [Portfolio](./portfolio/) supplies one Portfolio Lifecycle Evidence Receipt. `INITIAL_ACTIVATION` binds a fresh
  candidate-neutral gross Capacity View for the pre-existing Capacity Scope; `PROMOTION` additionally binds exact
  fresh Performance and Exposure Receipts under its own `PROMOTION` transition-evidence key. Generation-specific
  economic conditions come from Qualification and Capital Policy, not from the pool ceiling.
- Before creating an Execution Scope, [Portfolio](./portfolio/) supplies one current `BOUND` Capacity Scope and
  [Execution](./execution/) supplies one current `ADMITTED` Execution Adapter Binding. Account, mode, effect
  namespace, endpoint, capabilities, valid-through, and shared-constraint partition must match exactly; unknown
  or conflicting prebinding creates no lifecycle authorization.
- [Portfolio](./portfolio/) supplies a Portfolio Interaction Receipt for set-wide decisions, including
  concentration, correlation, directional and factor overlap, tail contribution, diversification contribution,
  and marginal portfolio value on one coherent contender and valuation cut. Missing interaction evidence makes
  the allocation decision unavailable rather than independent per-strategy approvals.
  The sealed priority-allocation compatibility profile requires each contender's exact Portfolio-owned interaction class; the target equal-share policy does not introduce a scoring/classification framework. Governance never
  recomputes or substitutes the classification.
- [Runtime](./runtime/) supplies the Generation Application Receipt and directly readable Runtime Incident Facts.
- [Execution](./execution/) supplies immutable `RecoveryCase.KNOWN_CLOSED` before a new generation may start.
- [Execution](./execution/) supplies directly readable committed Reconciliation Drift Facts, including explicit unknown-effect state and authoritative readback cut.
- Product Edge supplies explicit lifecycle requests but cannot mutate governed state directly. Each request carries
  request identity, principal, scope, admitted active-shell binding and history head, Operator Authorization, and
  operation manifest. Governance closes each stable request identity with its own terminal receipt; absent receipt remains unknown.

## Output handoffs

- **Compatibility only:** to [Scanner](./scanner/): exact ArtifactRef, Eligibility, ActivationConditionVersion, CapitalEnvelopeVersion, data needs, and effective interval.
- To [Runtime](./runtime/): authorize `INITIAL_ACTIVATION` or `PROMOTION`, or a decrease-only `REDUCTION`,
  `PAUSE`, or `RETIREMENT` transition for one strategy generation. Every add-risk transition repeats the complete
  request Authorization Lineage and binds explicit Autonomous Policy Authorization. Runtime separately proves application;
  Governance never claims the instance is running.
- To [Risk](./risk/): a policy carrying the applicable `POOL_ROOT` and exact `STRATEGY_GENERATION` Capital Envelopes, current Eligibility Fact, compatible Capacity View rules, validity interval, and economic-capacity contract. An intent is constrained only by its own applicability chain; sibling generation envelopes are not folded into a global minimum. Risk still admits their aggregate commitments against the common pool ceiling on its same-scope Aggregate Commitment Frontier. It is never an order command.
- To [Risk](./risk/): each generation envelope repeats the governing Capital Allocation Disposition and contender
  set. Risk rejects a generation that exceeds its envelope or the pool, but cannot pick winners, redistribute
  unused shares, or let concurrent arrival order change the allocation.
- To Product Edge: the terminal Lifecycle Request Receipt plus read-only lifecycle and deployment decision views containing state, policy bounds, effective interval, bounded rationale category, and non-dereferenceable committed fact references only.

## Rejections and prohibitions

- Never decide scarce capital from a partial contender set, stale or mixed Portfolio Interaction Receipt, or
  nondeterministic request arrival. Replay of the same set, facts, and policy must reproduce the same Capital
  Allocation Disposition independent of delivery order.
- Distinct lifecycle requests for the same generation and decision frontier are resolved atomically by stable
  policy precedence, not last writer wins. The complete canonical order is
  `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`; equal-rank conflicts use canonical request identity. Equivalent duplicates
  join one receipt, while stale, mixed-cut, or lower-precedence requests commit explicit no-write. This request
  precedence does not choose an action from adverse evidence.
- Adverse evidence is evaluated under a separate versioned lifecycle disposition policy. `RETIREMENT` requires a
  terminal falsifier or structural invalidity with no bounded viable successor. `PAUSE` covers unresolved safety or
  temporarily missing required evidence. `REDUCTION` requires supported degradation plus a lower capital level that
  remains economically and operationally viable. When multiple adverse predicates are simultaneously true, the
  total winner order is `RETIREMENT > PAUSE > REDUCTION`; this evidence-disposition order is separate from request
  precedence. Governance records every applicable alternative, the unique selected outcome, decisive Portfolio
  categories and cuts, and the policy version; missing inputs create no decision.
- Never register an artifact without current Qualification evidence or silently replace an ArtifactRef. A stale, cross-candidate, condition-mismatched, or widened economic-capacity binding is not current evidence.
- On the sealed `ScannerConditional` compatibility interface, never bypass Scanner evidence or activate a negative or nonmember strategy from a `PROPOSED` batch.
- Never copy protected Qualification measurements, parameters, results, holdout details, or evaluation output into a decision, rationale, or read model.
- Never accept `INITIAL_ACTIVATION` when the compatible Capacity View, Eligibility, required policy evidence, or Recovery fact is missing, expired, mismatched, or unavailable. `PROMOTION` additionally requires matching fresh Performance and Exposure Receipts for the exact generation and the exact `PROMOTION` evidence key. `PAUSE`, `REDUCTION`, and `RETIREMENT` remain available without capacity or performance evidence because they do not add risk.
- A compatibility Scanner proposal is evidence only. Governance may use it only under an already authorized unattended
  lifecycle lineage and still commits the sole deployment and Capital Allocation Disposition. No proposal creates
  a Runtime application or capital authority by itself.
- Never silently retain `ACTIVE_GENERATION` when Eligibility is expired, revoked, missing, or unknown, or when
  required Performance, Exposure, or degradation evidence is stale or unavailable. Commit `DE_RISK_PENDING`,
  supersede add-risk authority immediately, and drive the decrease-only chain until exposure is closed or bounded.
  Missing capacity, performance, or exposure evidence must never block pause, reduction, or retirement.
- Never treat an Authorized Generation Decision alone as unattended-trading authority. The decision must bind a
  current Autonomous Policy Authorization and the initiating request's complete Authorization Lineage.
- Never transition `ATTENDED_REQUEST` to `ACTIVE_GENERATION`, ask Runtime to apply it, or allow it to originate a
  normal Paper or Live add-risk intent or effect. A future attended-effect path requires a separate explicit contract.
- Never create Trade Intent, Risk Decision, Reservation, order command, fill, or account effect.
- Never silently preserve earlier add-risk authority when a successor Capital Envelope narrows. Governance only
  publishes or supersedes the envelope, and publication does not prove current usage. Risk independently commits
  `OVERCOMMITTED_NO_NEW_RISK` on its Aggregate Commitment Frontier. Governance reduction, pause, and retirement
  use the already modeled eligibility, performance, policy, incident, drift, and closure evidence, not a hidden Risk handoff.
- Never report an authorized generation as running until Runtime commits `APPLIED`; `APPLICATION_UNKNOWN` cannot be converted into a duplicate application command.
- Never mark reduction, pause, or retirement complete from a decision alone. Runtime must stop new intents;
  Risk must authorize only non-increasing exposure without an add-risk Reservation; Execution must cancel,
  reduce, flatten, or read back; and Portfolio must prove the resulting exposure. Unknown effect enters Recovery.
- Never resume a fenced scope before `RecoveryCase.KNOWN_CLOSED`; closure permits a new decision but does not auto-activate.
- Never use Event Rail or notification delivery as incident, drift, reconciliation, or recovery evidence; bind the exact source Owner fact identity.

## Failure and recovery

Expired or revoked eligibility, adverse performance, policy breach, incident, or reconciliation drift can reduce
capital, pause, or retire a strategy. Unknown external effect forces pause and blocks a new generation. Execution
Reconciler's closed Recovery Case resolves that unknown-effect prerequisite for a fresh Governance decision. The
predecessor generation and its Risk Fence remain permanently fenced. A later generation uses a distinct decision
and the ordinary add-risk gates, but has no Recovery Fence until its own `RUNTIME_NOT_READY` or `RISK_HARD_STOP`
predicate activates one.

Retention is an explicit renewal, not silence. If eligibility is expired, revoked, missing, or unknown, or a
required performance, exposure, or degradation cut is stale, Governance commits `DE_RISK_PENDING` and removes
new-risk authority at once. Runtime and Risk fail closed on that successor state while the decrease-only chain
continues; unavailable capacity or performance evidence cannot prevent a safer pause, reduction, or retirement.

The decrease-only lifecycle path cannot reuse an ordinary add-risk Reservation. Its durable outcome binds the
Governance decision, Runtime application, Risk decrease-only decision, Execution effect/readback, and Portfolio
projection. A rejection or unavailable fact keeps the preceding lifecycle state; an unknown external effect
opens Recovery instead of fabricating a successful pause or retirement.

On the compatibility priority-allocation profile, when contenders exceed the shared pool, Governance waits for the declared contender-set frontier, applies the
versioned allocation policy to the complete set plus one coherent Portfolio Interaction Receipt, and commits
one Capital Allocation Disposition. It first removes exact policy-rejected members, then lexicographically
sorts the admissible set by declared ordinal policy priority, Portfolio interaction class, requested capital
fraction, and finally unique canonical generation bytes before capped priority fill.

A missing member or attribute, duplicate generation identity, duplicate complete comparator key, unresolved
overlap, stale or mixed cut, or ambiguous policy commits `INPUT_INCOMPLETE_NO_WRITE`; it never produces a partial
allocation. Risk then enforces, but never recomputes, those envelopes.

## Decision contract

- **Inputs** - current Eligibility, frozen policy evidence, complete effective membership and pending requests,
  Portfolio lifecycle, interaction and degradation receipts, Runtime application or incident facts, Execution
  drift and closure facts, and authorized lifecycle requests.
- **Diagnosis and decision** - determine eligibility and retention, then lifecycle state and one deterministic
  Capital Allocation Disposition; Governance decides deployment and capital share, never a trade.
- **Conflict resolution** - complete-set allocation is replay-stable and order-independent; lifecycle conflicts
  resolve once by `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`;
  `PROMOTION` always participates at this declared rank and must carry the `PROMOTION` evidence key. Adverse
  evidence action selection remains a separate versioned three-outcome policy.
- **Outputs and terminal negatives** - lifecycle decision, envelope, allocation disposition, or explicit no-write;
  missing, stale, mixed-cut, tied without policy, or unknown evidence creates no add-risk transition.
- **Feedback and economic meaning** - performance, exposure, interaction, degradation, incidents and drift govern
  whether scarce capital is started, renewed, reduced, paused, or retired.
- **Prohibitions** - no Artifact authorship, protected detail, Trade Intent, risk permit, order, venue effect,
  account projection, or proof that Runtime applied a decision.

## Subsequent implementation acceptance

- Every active generation resolves to one qualified ArtifactRef, lifecycle decision, capital policy, effective
  interval, immutable mode/account/effect namespace, pre-admitted Capacity Scope, and immutable adapter binding.
- A Paper generation can never alias or feed a Live account or effect namespace.
- Namespace identity checks survive replay and restart; an opposite-mode account or effect namespace binding is rejected across generations.
- Changing an activation condition beyond the bounds assessed by Qualification requires a new Candidate and qualification decision.
- Every Capital Envelope has exactly one applicability kind and parent: `POOL_ROOT` binds the Portfolio Capacity Scope; `STRATEGY_GENERATION` binds one generation and that root. An intent uses its own chain, while aggregate commitment remains bounded by the pool root and Capacity View gross ceiling.
- `POOL_ROOT` contains no strategy, generation, or Execution Scope. One root may parent multiple generation
  children only when every child retains its distinct exact Execution Scope and all share the same Capacity Scope,
  account, policy, and effective-time cuts.
- Risk admits add-risk only when the exact `POOL_ROOT` and `STRATEGY_GENERATION` envelopes are both `EFFECTIVE`,
  their intervals overlap the same decision time, and their clock epoch, monotonic sequence, policy-head frontier,
  account, mode, scope, and parent linkage agree. Missing, expired, cross-epoch, or non-overlapping chains reject
  without a policy write.
- A narrower successor below existing commitments supersedes the wider Capital Envelope. Risk alone determines and commits whether the resulting Aggregate Commitment Frontier is `OVERCOMMITTED_NO_NEW_RISK`; Governance never manufactures that state or treats envelope publication as proof of current usage.
- Every `INITIAL_ACTIVATION` or `PROMOTION` binds the exact Portfolio lifecycle receipt and Capacity View identity;
  `PROMOTION` also binds fresh exact Performance and Exposure Receipts and its `PROMOTION` evidence key. Wrong
  scope, economic condition, methodology, assumption, liquidity cut, or validity fails closed.
- `PROMOTION` creates a new Authorized Generation Decision; replay cannot duplicate a generation.
- Registry and lifecycle history cannot be rewritten without an auditable successor decision.
- Every accepted generation decision preserves request, principal, scope, admitted shell binding and history head,
  Operator Authorization, operation manifest, and authorization mode through its terminal receipt. An unattended
  decision additionally preserves Autonomous Policy Authorization.
- Every retained active generation has a current renewal decision bound to fresh required Eligibility, Performance,
  Exposure, and degradation evidence; loss of any required member yields `DE_RISK_PENDING`, never silent retention.
- Governance cannot produce an execution command or mark an external effect settled.
- A paused or fenced generation cannot be reactivated until the required terminal facts are readable.
- Every incident- or drift-driven lifecycle transition resolves to the exact Runtime Incident Fact or Execution Reconciliation Drift Fact that caused it.
- Concurrent or restarted lifecycle delivery joins one write-once request receipt, and concurrent Runtime delivery joins one Generation Application Receipt and at most one Strategy Instance.
- The same complete contender set, Portfolio Interaction Receipt, policy version, and evidence cut always produce
  the same Capital Allocation Disposition regardless of request delivery order.
- For the compatibility priority-allocation profile, every contender carries all three versioned priority attributes with declared source, direction, and missing-value
  disposition. Missing or unknown priority produces `INPUT_INCOMPLETE_NO_WRITE`; an exact tie resolves only by the
  canonical strategy-generation identity.
- Compatibility priority allocation is a deterministic capped fill over the complete unordered set. Duplicate generation identity or
  complete comparator key, or any missing/unknown attribute, commits `INPUT_INCOMPLETE_NO_WRITE` and no Authorized
  Generation Decision.
- Concurrent conflicting lifecycle requests resolve once under
  `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`; no lower-precedence request can overwrite a committed safer state.
- Every adverse transition proves why `RETIREMENT`, `PAUSE`, or `REDUCTION` was selected under the current disposition
  policy and, when predicates overlap, resolves exactly by `RETIREMENT > PAUSE > REDUCTION`; request precedence cannot
  stand in for that evidence-based choice.

## Observability and persistence

Strategy Governance persists Registry entries, lifecycle requests and receipts, allocation contenders and disposition, capital envelopes, authorized-generation decisions, and adverse lifecycle evidence. Dashboard lifecycle projections derive which strategies are deployed, generation, mode, effective start/stop time, active duration, pause/retire/resume history, and capital changes from these facts plus Runtime application evidence. A projection cannot mark a strategy running merely because Governance authorized it, and no alert or Dashboard action changes lifecycle without a new governed request.
