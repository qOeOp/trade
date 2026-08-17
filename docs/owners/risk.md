# Risk

## Responsibility

Independently gate every normal Trade Intent against current policy, account exposure, and aggregate commitments. Risk owns the terminal decision, one-use reservation, same-scope commitment frontier, and emergency fence; it never owns order commands, Portfolio projections, or external effects.

## Authoritative facts owned

- Risk Decision bound to one intent and digest, Execution Scope, policy version and cut, Portfolio account and
  exposure cut, decision time, authorization mode, and complete request Authorization Lineage. For
  `UNATTENDED_REQUEST_WITH_POLICY`, it additionally binds the current Autonomous Policy Authorization.
- Every terminal `REJECT` preserves the complete unique non-empty supported rejection-category set, each
  category's decisive fact identities and cuts, evaluated policy heads and limits, fresh Time Evidence, and one
  deterministic primary category selected by a bound versioned total precedence. The primary orders explanation;
  every valid set has the same no-Reservation `REJECT` action.
- Exact `PERMIT_DECREASE_ONLY` for one cancel, reduce, flatten, or readback action, bound to the current exposure
  cut, normal Governance lifecycle authority, scope, and validity; it creates no add-risk Reservation and is not
  Recovery authority.
- One-use Risk Reservation with `AVAILABLE`, `WITHDRAWN`, `CONSUMED`, `UNKNOWN_EFFECT`, `NO_EFFECT`, and `SETTLED` lifecycle states and a separately explicit held-or-released commitment liability.
- Immutable Reservation Claim Result with `CONSUMED`, `WITHDRAWN`, or `REJECTED` for add-risk only, followed for
  a consumed claim by an immutable Adapter Admission Result with `ADMITTED_ONCE`, `SUPPRESSED_BY_FENCE`, or
  `REJECTED`. Decrease-only creates no claim but its `PREPARED` attempt receives the same three-state Adapter
  Admission Result. Adapter admission is committed against recovery fence activation on the same frontier and is
  the sole normal adapter-invocation authority.
- One durably and atomically serialized Aggregate Commitment Frontier per immutable Portfolio-owned Capacity
  Scope. It combines one coherent Portfolio Risk Evidence Bundle with every held Reservation liability and
  counts each stable economic lineage exactly once. Risk alone computes usage and remaining headroom.
- Active Recovery Fence epoch, affected generation and scope, and allowed recovery action bounds. Risk is its sole
  writer. Each fence binds exactly one source branch: `RUNTIME_NOT_READY` with the exact immutable `NOT_READY`
  Readiness Fact; `RUNTIME_INCIDENT` with the committed `runtime-incident-fact` received through
  `runtime-risk-incident-fence`; `RECONCILIATION_DRIFT` with the committed `reconciliation-drift-fact` received
  through `execution-risk-drift-fence`; or `RISK_HARD_STOP` with exact cause evidence, policy, and Aggregate
  Commitment Frontier cut. A Risk hard stop may fence while Runtime remains `READY`.
- Risk also owns the complete active-fence-set identity and content digest at each Aggregate Commitment Frontier.
  The set retains every source-specific fence lineage. Its effective Recovery action set is the deterministic
  intersection of all member action sets, never their union; an empty intersection authorizes no command.
- Stable same-scope enforcement arbitration: concurrent normal intents are admitted against one serialized
  commitment frontier under the declared policy ordering. Risk never invents contender priority or reallocates
  Governance shares; missing or tied business priority fails closed rather than becoming arrival-order allocation.

## Modules

- **Risk Reservation** — durably serialize one Execution claim or withdraw an unconsumed allowance, then hold,
  replace, or release liability on the same-scope frontier. Consumed liability closes only from Execution settlement
  facts joined to a matching Portfolio Risk Evidence Bundle; `SETTLED` alone does not release it.
- **Risk Engine** — return allow with decision and reservation, or a terminal rejection, for every normal intent.
- **Kill Switch** — block new risk and fence affected generations while defining the bounded cancel/reduce/flatten recovery scope.

## Input handoffs

- [Runtime](../runtime/) submits Trade Intent, immutable Readiness Facts, and for `RUNTIME_INCIDENT` the committed
  `runtime-incident-fact` through `runtime-risk-incident-fence`. Risk treats source facts as evidence for its own
  independent fence commit, not requests or acknowledgements.
- [Strategy Governance](../strategy-governance/) supplies the applicable `POOL_ROOT` and exact
  `STRATEGY_GENERATION` Capital Envelope chain with current Eligibility, each envelope's effective interval and
  complete shared Time Evidence, authorization mode, and complete request Authorization Lineage.
  `UNATTENDED_REQUEST_WITH_POLICY` additionally carries its current Autonomous Policy Authorization. One intent
  uses only its own chain; sibling envelopes are not a global minimum.
- [Portfolio](../portfolio/) supplies the immutable Capacity Scope, candidate-neutral gross Capacity View, and one
  coherent Portfolio Risk Evidence Bundle with exposure, open orders, account/valuation cut, and incorporated
  Execution lineages. It never supplies Risk commitment state or net headroom.
- [Execution](../execution/) submits one stable Reservation Claim Request for add-risk. After matching `CONSUMED`,
  it persists a `PREPARED` attempt and submits one stable `ADAPTER_ADMISSION_REQUEST`. For exact decrease-only it
  submits no claim, persists `PREPARED` with explicit-none Reservation/claim lineage, and submits the admission
  request directly. It later reports unknown effect, settlement, or exactly one no-effect proof: durable
  pre-adapter suppression without invocation/readback identity, or authoritative adapter readback for one admitted attempt.
- For `RECONCILIATION_DRIFT`, Execution submits the committed exact `reconciliation-drift-fact` through
  `execution-risk-drift-fence`; that relation carries source evidence and grants Execution no fence write authority.
- During Recovery, Execution reports common case, complete fence-set identity/digest, command, and effect identity
  plus state-specific evidence. A committed drift `UNKNOWN_EFFECT` supplies effect-journal and uncertainty lineage,
  the last readback attempt or proven absence, and complete source/time evidence; it may activate fencing without
  claiming an outcome. `NO_EFFECT` and `SETTLED` require authoritative terminal readback and reconciliation cuts.
  Risk joins them to its own membership frontier and alone resolves it as nonempty, explicitly empty, or unresolved.

## Output handoffs

- To [Runtime](../runtime/): terminal rejection, an approved Risk Decision with one-use Reservation, and any terminal pre-consumption `WITHDRAWN` outcome.
- To [Execution](../execution/): exactly one immutable Reservation Claim Result for each stable add-risk claim,
  then one Adapter Admission Result per prepared add-risk or decrease-only attempt. Risk commits `ADMITTED_ONCE`, `SUPPRESSED_BY_FENCE`, or `REJECTED`
  in the Aggregate Commitment Frontier mutation that orders admission against fence activation. It also supplies
  the complete active fence set, terminal Reservation membership, and residual-exposure closure facts to Reconciler.
- The complete set tells Reconciler every independently active `RUNTIME_NOT_READY`, `RUNTIME_INCIDENT`,
  `RECONCILIATION_DRIFT`, or `RISK_HARD_STOP` member and carries each branch's required evidence. Execution may
  open or join Recovery directly from a hard-stop fence; Runtime
  need not first change readiness.
- Every terminal rejection binds the complete supported category set, one deterministic primary, decisive policy
  and evidence identities, exact fact cuts, and a no-Reservation proof so Runtime can stop or route a successor
  without interpreting prose.
  Categories are `STALE_OR_MISSING_AUTHORIZATION`, `SCOPE_OR_GENERATION_MISMATCH`,
  `EVIDENCE_UNAVAILABLE_OR_MIXED_CUT`, `GOVERNANCE_POLICY_EXCEEDED`,
  `QUALIFIED_ECONOMIC_BOUND_EXCEEDED`, `AGGREGATE_CAPACITY_EXHAUSTED`,
  `FENCE_OR_READINESS_BLOCKED`, and `DUPLICATE_OR_CONFLICTING_INTENT`. Primary precedence is
  `STALE_OR_MISSING_AUTHORIZATION > SCOPE_OR_GENERATION_MISMATCH > DUPLICATE_OR_CONFLICTING_INTENT >
  FENCE_OR_READINESS_BLOCKED > EVIDENCE_UNAVAILABLE_OR_MIXED_CUT > GOVERNANCE_POLICY_EXCEEDED >
  QUALIFIED_ECONOMIC_BOUND_EXCEEDED > AGGREGATE_CAPACITY_EXHAUSTED`, independent of evidence or request arrival
  order. Governance-policy breach, Qualification economic-bound breach, and aggregate pool exhaustion remain
  distinct simultaneous causes rather than sharing one opaque limit category.

## Rejections and prohibitions

- Never allow add-risk without complete current Eligibility, economic-capacity, lifecycle-policy, and Capacity View facts. Missing, expired, cross-scope, economic-condition-, methodology-, assumption-, liquidity-, or version-mismatched evidence returns terminal `REJECT` and creates no Reservation.
- Never allow add-risk from a bare Governance decision or `ATTENDED_REQUEST`. Only
  `UNATTENDED_REQUEST_WITH_POLICY` may obtain an add-risk decision or Reservation, and its Trade Intent, lifecycle
  decision, current retention renewal, and Autonomous Policy Authorization must preserve the same complete request
  Authorization Lineage. `ATTENDED_REQUEST` is admissible only for an exact decrease-only action.
- Never allow add-risk when active-generation retention is missing, expired, revoked, unknown, or
  `DE_RISK_PENDING`, or when required Eligibility, Performance, Exposure, or degradation evidence is stale.
  Decrease-only pause, reduction, and retirement remain admissible without fresh capacity or performance evidence.
- Never create or forward an order command, retry an effect, or claim venue settlement.
- Never release a Reservation from Runtime acknowledgement, Execution `SETTLED` alone, or an adapter response alone.
- Never double count one economic member or treat `UNKNOWN_EFFECT` as free capacity. `WITHDRAWN` and authoritative
  post-consumption `NO_EFFECT` may release liability; `SETTLED` retains it until one serialized frontier transition
  replaces it with a Portfolio bundle covering the same lineage.
- Never issue an add-risk Reservation for a Governance reduce, pause, or retire transition. A decrease-only
  decision may permit cancel, reduce, flatten, or readback only and any unknown effect escalates to Recovery.
- Never encode decrease-only authority as a normal `ALLOW` or reusable policy. Only exact
  `PERMIT_DECREASE_ONLY` may cross the adapter gate, and an add-risk shape is terminally rejected.
- Never require or accept `PERMIT_DECREASE_ONLY` as Recovery authority. Recovery is bounded only by the exact
  Risk-authoritative complete `ACTIVE` fence set and the intersection of its member action sets. A stale, omitted,
  inactive, widened, mismatched, completeness-unproven, or empty-intersection set admits no Recovery action.
- Never permit add-risk for matching `NOT_READY`, expired readiness, or an `ACTIVE` fence. Fence activation does
  not depend on Recovery Case state or acknowledgement.

## Failure and recovery

A rejected normal intent has a terminal result and creates no external attempt. Every add-risk decision durably and
atomically serializes against the exact Capacity Scope Aggregate Commitment Frontier. Capacity View supplies the
candidate-neutral gross pool ceiling; the Portfolio Risk Evidence Bundle supplies coherent projected exposure,
open orders, and incorporated settlement lineages; held Reservation liabilities complete usage. A stale attempt,
overlapping unknown scope, or missing, stale, mismatched member rejects without a Reservation. Each intent is checked
against its own `POOL_ROOT` → `STRATEGY_GENERATION` applicability chain while all sibling usage shares the root pool
ceiling. A narrowed policy below usage commits `OVERCOMMITTED_NO_NEW_RISK` without preserving add-risk authority.

Execution first submits one stable Reservation Claim Request. Risk durably serializes `CONSUMED`, `WITHDRAWN`,
or `REJECTED`. Only matching `CONSUMED` admits one `PREPARED` attempt and `ADAPTER_ADMISSION_REQUEST`; it still
permits no external call. Risk serializes admission with recovery fence activation and returns one immutable result. Only
`ADMITTED_ONCE` permits `INVOCATION_STARTED`; response loss or restart joins the same result and attempt.
`SUPPRESSED_BY_FENCE` or `REJECTED` proves no invocation. The Reservation graph is strict: pre-claim expiry,
withdrawal, or proven no invocation ends as `WITHDRAWN`; only `CONSUMED` can advance to `UNKNOWN_EFFECT`,
authoritative `NO_EFFECT`, or `SETTLED`. `UNKNOWN_EFFECT` can later advance only to authoritative `NO_EFFECT` or
`SETTLED`. `SETTLED` stays held until a coherent Portfolio Risk Evidence Bundle contains the exact settlement
lineage and one serialized transition replaces, rather than adds, that liability.

For exact decrease-only, Risk accepts either a Governance-authorized lifecycle reduction or an unattended
`DECREASE_ONLY_STRATEGY_PROTECTIVE` intent bound to the applied Artifact's protective-exit rule, trigger evidence,
and current exposure/open-order cuts. Both require `PERMIT_DECREASE_ONLY`, explicit-none Reservation and claim
lineage, and a durable `PREPARED` attempt. Risk creates no claim result, but serializes the `ADAPTER_ADMISSION_REQUEST` against the
same-scope fence exactly as for add-risk. Only `ADMITTED_ONCE` permits invocation; suppression, rejection,
restart, and replay retain the same attempt and admission identity.

Risk independently and atomically activates one fence on its same-scope frontier from exactly one source branch,
without waiting for a Recovery Case acknowledgement. `RUNTIME_NOT_READY` requires Runtime's local suppression and
immutable `NOT_READY` Readiness Fact. `RUNTIME_INCIDENT` requires the exact committed `runtime-incident-fact` from
`runtime-risk-incident-fence`; `RECONCILIATION_DRIFT` requires the exact committed `reconciliation-drift-fact`
from `execution-risk-drift-fence`. Those relations supply source evidence only. `RISK_HARD_STOP` instead requires
the bound Risk cause, decisive evidence, policy, and frontier cut and may activate while Runtime remains `READY`. Fence
activation and every in-flight normal adapter admission have one total order. Fence first returns
`SUPPRESSED_BY_FENCE`; normal admission first returns one `ADMITTED_ONCE` attempt that enters the Recovery effect
frontier. When an Artifact protective stop and `RISK_HARD_STOP` are simultaneous, the fence wins every not-yet-admitted
normal permit or command while the protective intent, trigger, and terminal suppression remain causal evidence.
An admission that already won remains exactly one attempt for authoritative readback; it does not mint Recovery
authority. Risk supplies the active fence to Execution Reconciler, which alone owns the case and bounded Recovery
Commands. Risk alone owns Reservation membership and its nonempty, explicitly empty, or unresolved result.
Execution alone writes `KNOWN_CLOSED` after matching Risk and Portfolio closure facts.

## Decision contract

- **Inputs** — one Runtime intent and readiness cut, Governance envelope and authorization lineage, coherent
  Portfolio risk bundle, and later Execution claim, admission and settlement facts.
- **Diagnosis and decision** — evaluate authorization, identity, evidence, limits, commitment frontier and fence;
  commit one terminal rejection or one-use decision and Reservation.
- **Conflict resolution** — same-scope mutations serialize under declared enforcement order; Governance allocation
  remains fixed, duplicate identity joins once, and unresolved business priority rejects.
- **Outputs and terminal negatives** — decision, Reservation, claim/admission result, fence or a categorized
  `REJECT` with the complete supported set, deterministic primary, decisive facts, and proof of no Reservation;
  missing or mixed-cut evidence supports `EVIDENCE_UNAVAILABLE_OR_MIXED_CUT` and never becomes implicit allow.
- **Feedback and economic meaning** — bound worst-case outstanding liability and prevent stale, duplicate or
  over-limit exposure without deciding which strategy deserves capital.
- **Prohibitions** — no contender allocation, order command, adapter call, venue fact, Portfolio projection,
  lifecycle decision, Recovery Case, or closure.

## Subsequent implementation acceptance

- Every normal Trade Intent produces exactly one current terminal decision.
- The terminal decision shape is discriminated: add-risk `ALLOW` requires one Reservation; exact
  `PERMIT_DECREASE_ONLY` requires either current Governance de-risk authority or an applied-Artifact protective-stop
  authority plus current exposure/open-order cuts and forbids a Reservation; `REJECT` requires a unique non-empty supported rejection-category set, one deterministic primary,
  and proof that no Reservation was created.
- Every independently supported rejection cause and its evidence remains in the terminal record. The primary is
  the first supported member of the frozen total precedence, never the first evidence or request to arrive; every
  supported-set variant keeps the same `REJECT` action and creates no Reservation.
- Every allow decision and Reservation preserve the Governance authorization mode and complete request
  Authorization Lineage. `UNATTENDED_REQUEST_WITH_POLICY` additionally preserves and revalidates its Autonomous
  Policy Authorization; any required-lineage break produces terminal `REJECT` with no Reservation.
- Every add-risk decision binds one exact valid gross-ceiling Capacity View and immutable account-plus-mode economic-pool Capacity Scope. Strategy or generation may not appear in that scope; Paper and Live differ, and unknown overlap fails closed.
- Every intent is bounded by its own `POOL_ROOT` and `STRATEGY_GENERATION` envelope chain, Qualification and lifecycle ceilings, and Risk limit; sibling generation envelopes are never folded into its minimum.
- Risk evaluates both envelope states and overlapping effective intervals against the same decision time and shared
  Time Evidence cut. A missing, expired, superseded, cross-epoch, non-overlapping, wrong-parent, cross-account,
  cross-mode, or cross-scope member produces terminal `REJECT` and no Reservation.
- Every same-scope add-risk decision wins one durable atomic serialization. Usage counts one coherent Portfolio
  projection bundle and held Reservation liabilities by economic lineage, unknown liability occupies worst-case
  capacity, and incomplete or stale evidence rejects.
- Every allow decision creates a unique one-use Reservation that cannot be replayed or double-consumed.
- A second command cannot claim the same Reservation even when requests are concurrent; exact replay joins the first claim.
- One stable claim receives exactly one Reservation Claim Result. Only `CONSUMED` permits one prepared attempt,
  which receives one immutable Adapter Admission Result serialized with fence activation; only `ADMITTED_ONCE`
  can become `INVOCATION_STARTED`.
- Response loss, restart, or replay joins the same prepared attempt and admission result and cannot call an adapter twice.
- Execution cannot accept a normal command whose permit binding is missing, stale, or mismatched.
- Unknown external effect preserves the reservation and recovery fence until terminal facts arrive.
- `RecoveryCase.KNOWN_CLOSED` never supersedes, deactivates, lifts, or reuses the predecessor's `ACTIVE` Risk
  Fence. The old generation remains permanently fenced. A fresh generation requires a distinct Governance
  decision and ordinary add-risk gates, but has no Recovery Fence until one of its own four exact Recovery source
  branches independently activates one.
- Every active fence proves exactly one `RUNTIME_NOT_READY`, `RUNTIME_INCIDENT`, `RECONCILIATION_DRIFT`, or
  `RISK_HARD_STOP` source branch. A hard-stop fence
  neither requires nor fabricates Runtime `NOT_READY`, yet opens or joins the same Execution-owned Recovery path.
- `SETTLED` preserves commitment liability until a Portfolio bundle covers the same Execution settlement lineage
  and one serialized transition replaces rather than adds the member. `WITHDRAWN` and authoritative post-consumption
  `NO_EFFECT` may release directly; `AVAILABLE` never transitions directly to `NO_EFFECT`.
- A Recovery fact requesting ordinary adapter admission, adding risk, or binding a mismatched case or fence cannot change Reservation state.
- Fence activation and any in-flight `ADAPTER_ADMISSION_REQUEST` have one same-scope atomic order; a fence winner
  commits `SUPPRESSED_BY_FENCE`, while a normal winner commits exactly one `ADMITTED_ONCE` attempt included in the
  Recovery effect frontier.
- Risk alone owns the Reservation membership frontier and its `RESOLVED_NONEMPTY`, `RESOLVED_EMPTY`, or `UNRESOLVED` state. An implicit empty or `UNRESOLVED` set cannot support closure; `RESOLVED_EMPTY` requires the complete Risk frontier joined with Execution's external readback cut.
- Paper and Live Risk decisions bind disjoint account and effect namespaces and reject cross-mode Portfolio or Execution facts.

## Observability and persistence

Risk persists policy, decision, Reservation, claim membership, aggregate commitment frontier, Kill Switch/Fence, liability, and closure facts. Telemetry covers decision and serialization latency, bounded supported rejection set and deterministic primary category, reservation age, frontier contention, fence state, and policy/readiness failure. Dashboard allow/reject/decrease-only counts, rejection-set/primary distributions, outstanding liabilities, aggregate commitment, fence count, and fence duration derive from exact facts; metrics or alert delivery cannot release a Reservation, lift a fence, authorize Execution, or prove closure.
