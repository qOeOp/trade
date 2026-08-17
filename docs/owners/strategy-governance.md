# Strategy Governance

## Responsibility

Own the deployable strategy registry, lifecycle decision, and permitted capital policy from qualification through retirement. Governance decides whether a strategy generation may run; it does not design artifacts, judge individual trades, or own order effects.

## Authoritative facts owned

- Governed Strategy Entry binding ArtifactRef, exact Eligibility Fact and generation-specific economic-condition
  versions, qualified capacity ceiling, ActivationConditionVersion, CapitalEnvelopeVersion, effective interval,
  and one immutable Execution Scope. That scope binds a pre-admitted candidate-neutral Capacity Scope, exact
  adapter implementation/configuration and trust-policy digest, venue or simulator endpoint, account binding,
  capability and reduce-only policy, and opaque credential handle.
- Lifecycle state, Authorized Generation Decision, effective time, active generation, exact committed fact identities, and bounded rationale category. Every generation decision cross-binds the initiating request's complete Authorization Lineage and a distinct Autonomous Policy Authorization for unattended trading. Governance never copies protected Qualification content.
- Versioned Capital Envelope applicability chain: one `POOL_ROOT` envelope for the Portfolio-owned Capacity Scope
  plus one `STRATEGY_GENERATION` envelope for each governed generation. Both kinds bind their own
  `effective-from`/`effective-through` interval and the same complete shared Time Evidence shape; they are neither
  committed usage nor available headroom.
- Capital Allocation Disposition for one complete contender set and one Portfolio Interaction Receipt. It records
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

- **Strategy Registry** — store the current governed deployment decision, deployable ArtifactRef, and immutable generation Execution Scope without owning artifact content.
- **Lifecycle Manager** — compute `INACTIVE`, `ACTIVE_GENERATION`, `DE_RISK_PENDING`, `REDUCED`, `PAUSED`, or
  `RETIRED` from eligibility, performance, exposure, degradation, policy, incidents, drift, and closure facts.
  Renew `ACTIVE_GENERATION` only from fresh required evidence. Risk's Aggregate Commitment Frontier state is outside this lifecycle state machine.
- **Capital Policy** — version the `POOL_ROOT` plus `STRATEGY_GENERATION` Capital Envelope chain consumed by Risk without creating committed capacity, a trade command, or final trade size.
  A `POOL_ROOT` binds Capacity Scope, account namespace, gross limits, policy provenance, and effective interval but
  forbids strategy, generation, Execution Scope, parent, Eligibility, or allocation fields. A `STRATEGY_GENERATION` envelope binds
  exactly one generation, Execution Scope, parent pool root, Eligibility, gross limits, and effective interval but
  forbids sibling-parent, Portfolio usage, Risk headroom, or admission results.

## Input handoffs

- [Qualification](../qualification/) supplies committed Eligibility State and Revocation facts with exact Candidate, fact, economic-condition, evaluated cost/capacity-model, and qualified-capacity versions.
- [Scanner](../scanner/) supplies one terminal Scanner Receipt per scan; condition-dependent activation must bind an exact matched proposal member with the same strategy entry, ArtifactRef, and condition version as the decision target.
- [Portfolio](../portfolio/) supplies one Portfolio Lifecycle Evidence Receipt. `INITIAL_ACTIVATION` binds a fresh
  candidate-neutral gross Capacity View for the pre-existing Capacity Scope; `PROMOTION` additionally binds exact
  fresh Performance and Exposure Receipts under its own `PROMOTION` transition-evidence key. Generation-specific
  economic conditions come from Qualification and Capital Policy, not from the pool ceiling.
- Before creating an Execution Scope, [Portfolio](../portfolio/) supplies one current `BOUND` Capacity Scope and
  [Execution](../execution/) supplies one current `ADMITTED` Execution Adapter Binding. Account, mode, effect
  namespace, endpoint, capabilities, valid-through, and shared-constraint partition must match exactly; unknown
  or conflicting prebinding creates no lifecycle authorization.
- [Portfolio](../portfolio/) supplies a Portfolio Interaction Receipt for set-wide decisions, including
  concentration, correlation, directional and factor overlap, tail contribution, diversification contribution,
  and marginal portfolio value on one coherent contender and valuation cut. Missing interaction evidence makes
  the allocation decision unavailable rather than independent per-strategy approvals.
  Every contender must carry the exact Portfolio-owned interaction class from that receipt; Governance never
  recomputes or substitutes the classification.
- [Runtime](../runtime/) supplies the Generation Application Receipt and directly readable Runtime Incident Facts.
- [Execution](../execution/) supplies immutable `RecoveryCase.KNOWN_CLOSED` before a new generation may start.
- [Execution](../execution/) supplies directly readable committed Reconciliation Drift Facts, including explicit unknown-effect state and authoritative readback cut.
- Product Edge supplies explicit lifecycle requests but cannot mutate governed state directly. Each request carries
  request identity, principal, scope, admitted active-shell binding and history head, Operator Authorization, and
  operation manifest. Governance closes each stable request identity with its own terminal receipt; absent receipt remains unknown.

## Output handoffs

- To [Scanner](../scanner/): exact ArtifactRef, Eligibility, ActivationConditionVersion, CapitalEnvelopeVersion, data needs, and effective interval.
- To [Runtime](../runtime/): authorize `INITIAL_ACTIVATION` or `PROMOTION`, or a decrease-only `REDUCTION`,
  `PAUSE`, or `RETIREMENT` transition for one strategy generation. Every add-risk transition repeats the complete
  request Authorization Lineage and binds explicit Autonomous Policy Authorization. Runtime separately proves application;
  Governance never claims the instance is running.
- To [Risk](../risk/): a policy carrying the applicable `POOL_ROOT` and exact `STRATEGY_GENERATION` Capital Envelopes, current Eligibility Fact, compatible Capacity View rules, validity interval, and economic-capacity contract. An intent is constrained only by its own applicability chain; sibling generation envelopes are not folded into a global minimum. Risk still admits their aggregate commitments against the common pool ceiling on its same-scope Aggregate Commitment Frontier. It is never an order command.
- To [Risk](../risk/): each generation envelope repeats the governing Capital Allocation Disposition and contender
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
- Never bypass Scanner evidence when activation is condition-dependent or activate a negative or nonmember strategy from a `PROPOSED` batch.
- Never copy protected Qualification measurements, parameters, results, holdout details, or evaluation output into a decision, rationale, or read model.
- Never accept `INITIAL_ACTIVATION` when the compatible Capacity View, Eligibility, required Scanner evidence, or Recovery fact is missing, expired, mismatched, or unavailable. `PROMOTION` additionally requires matching fresh Performance and Exposure Receipts for the exact generation and the exact `PROMOTION` evidence key. `PAUSE`, `REDUCTION`, and `RETIREMENT` remain available without capacity or performance evidence because they do not add risk.
- A Scanner proposal is evidence only. Governance may use it only under an already authorized unattended
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

When contenders exceed the shared pool, Governance waits for the declared contender-set frontier, applies the
versioned allocation policy to the complete set plus one coherent Portfolio Interaction Receipt, and commits one
Capital Allocation Disposition. It first removes exact policy-rejected members, then lexicographically sorts the
admissible set by declared ordinal policy priority, Portfolio interaction class, requested capital fraction, and
finally unique canonical generation bytes before capped priority fill. A missing member or attribute, duplicate
generation identity, duplicate complete comparator key, unresolved overlap, stale or mixed cut, or ambiguous policy
commits `INPUT_INCOMPLETE_NO_WRITE`; it never produces a partial allocation. Risk then enforces, but never
recomputes, those envelopes.

## Decision contract

- **Inputs** — current Eligibility, complete Scanner evidence when condition-dependent, full contender set,
  Portfolio lifecycle, interaction and degradation receipts, Runtime application or incident facts, Execution
  drift and closure facts, and authorized lifecycle requests.
- **Diagnosis and decision** — determine eligibility and retention, then lifecycle state and one deterministic
  Capital Allocation Disposition; Governance decides deployment and capital share, never a trade.
- **Conflict resolution** — complete-set allocation is replay-stable and order-independent; lifecycle conflicts
  resolve once by `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`;
  `PROMOTION` always participates at this declared rank and must carry the `PROMOTION` evidence key. Adverse
  evidence action selection remains a separate versioned three-outcome policy.
- **Outputs and terminal negatives** — lifecycle decision, envelope, allocation disposition, or explicit no-write;
  missing, stale, mixed-cut, tied without policy, or unknown evidence creates no add-risk transition.
- **Feedback and economic meaning** — performance, exposure, interaction, degradation, incidents and drift govern
  whether scarce capital is started, renewed, reduced, paused, or retired.
- **Prohibitions** — no Artifact authorship, protected detail, Trade Intent, risk permit, order, venue effect,
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
- Every contender carries all three versioned priority attributes with declared source, direction, and missing-value
  disposition. Missing or unknown priority produces `INPUT_INCOMPLETE_NO_WRITE`; an exact tie resolves only by the
  canonical strategy-generation identity.
- Allocation is a deterministic capped fill over the complete unordered set. Duplicate generation identity or
  complete comparator key, or any missing/unknown attribute, commits `INPUT_INCOMPLETE_NO_WRITE` and no Authorized
  Generation Decision.
- Concurrent conflicting lifecycle requests resolve once under
  `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION`; no lower-precedence request can overwrite a committed safer state.
- Every adverse transition proves why `RETIREMENT`, `PAUSE`, or `REDUCTION` was selected under the current disposition
  policy and, when predicates overlap, resolves exactly by `RETIREMENT > PAUSE > REDUCTION`; request precedence cannot
  stand in for that evidence-based choice.

## Observability and persistence

Strategy Governance persists Registry entries, lifecycle requests and receipts, allocation contenders and disposition, capital envelopes, authorized-generation decisions, and adverse lifecycle evidence. Dashboard lifecycle projections derive which strategies are deployed, generation, mode, effective start/stop time, active duration, pause/retire/resume history, and capital changes from these facts plus Runtime application evidence. A projection cannot mark a strategy running merely because Governance authorized it, and no alert or Dashboard action changes lifecycle without a new governed request.
