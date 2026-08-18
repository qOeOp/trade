# Execution

## Responsibility

Exclusively own order lifecycle, external venue effects, authoritative readback, reconciliation, and Recovery
Case closure. Execution validates normal permits or active Risk fences before effects and reports facts to
Runtime, Risk, Portfolio, and Governance.

## Authoritative facts owned

- Order identity, state transitions, commands accepted or rejected, and cancellation history.
- Effect Journal binding Execution Scope, durable `PREPARED` attempt records, Adapter Admission Results,
  `INVOCATION_STARTED` records, permits or fences, orders, venue replies, fills, and readbacks. A normal effect also
  preserves the authorization mode and complete request Authorization Lineage carried by its command.
  `UNATTENDED_REQUEST_WITH_POLICY` additionally preserves its Autonomous Policy Authorization.
- Immutable Execution Adapter Binding repeated by Execution Scope and every attempt: implementation and
  configuration digests, authenticated venue or simulator endpoint, account mapping, capabilities including
  reduce-only semantics, trust-policy version, and opaque least-privilege credential handle.
- Adapter-normalized venue facts with preserved source identity and uncertainty.
- Finite Execution Quality Observation on each complete account-fact cut, under one observation-policy version,
  with a complete `observationCategorySet` drawn from `SLIPPAGE`, `LATENCY`, `VENUE_REJECTION`, `PARTIAL_FILL`,
  `VENUE_ANOMALY`, `READBACK_FAILURE`, `RECONCILIATION_DRIFT`, and `NONE_OBSERVED`. Every independently supported
  simultaneous category is preserved and binds its decisive order, fill, timing, readback, reconciliation, and
  venue evidence. `NONE_OBSERVED` is valid only as a singleton after a complete census.
- Reconciliation result and identified missing, duplicate, or unknown external effects.
- Committed Reconciliation Drift Fact binding drift identity, affected generation and scope, authoritative readback
  cut, observation time, category, and state. The immutable drift never gains a Recovery Case back-reference;
  the case records the drift identity in its cause set.
- Reconciliation Drift category is one of `ORDER_STATE_DIVERGENCE`, `FILL_STATE_DIVERGENCE`,
  `POSITION_DIVERGENCE`, `BALANCE_DIVERGENCE`, `ADAPTER_READBACK_UNAVAILABLE`, or
  `UNKNOWN_EXTERNAL_EFFECT`; unknown cause remains explicit rather than guessed into another category.
- Recovery Admission Disposition for each distinct `RUNTIME_INCIDENT` or `RECONCILIATION_DRIFT` source, committed
  before any case as `RECOVERY_ADMITTED`, `NO_RECOVERY_REQUIRED`, or `UNRESOLVED_NO_CASE`. The former binds only
  the exact `runtime-incident-fact`; the latter binds only the exact `reconciliation-drift-fact`. Each binds generation,
  scope, Runtime readiness, applicable Risk fence, authoritative Execution/Portfolio cuts, policy, and fresh Time
  Evidence; same-meaning replay joins one write-once disposition. Either admitted singleton proceeds without the
  other source, and simultaneous admitted branches retain distinct dispositions before joining one case.
- Recovery Case, Recovery Command, and immutable `RecoveryCase.KNOWN_CLOSED` binding the complete cause and
  affected-effect set to one Risk-authoritative complete active-fence-set identity/content digest and common
  Runtime, Execution, Risk, Portfolio, and time frontier.
- Recovery Effect Attempt with durable `PREPARED` and `INVOCATION_STARTED` cuts bound to the Recovery Case,
  exact current `ACTIVE` Risk Fence, bounded action, authoritative pre-action readback, adapter binding, and
  attempt identity. Crash or replay joins the same attempt; it never creates an unrecorded or duplicate action.

## Modules

- **Order Engine** - validate permits or recovery fences and exclusively manage order creation, change, cancellation, and terminal state.
- **Execution Adapters** - admit exactly the adapter binding fixed by Execution Scope, then translate requests,
  replies, fills, errors, and readbacks without changing endpoint, account, capability, or trust policy on restart.
- **Effect Journal** - persist one stable `PREPARED` attempt before requesting admission, then persist `INVOCATION_STARTED` only after the matching immutable `ADMITTED_ONCE` result and join all later external-effect facts to that identity.
- **Reconciler** - own Recovery Case state and bounded Recovery Commands, compare effects with authoritative
  readback, join closure evidence, and alone write immutable `KNOWN_CLOSED` without resuming trading.

## Input handoffs

- [Runtime](./runtime/) sends an Authorized Order Command. An add-risk command binds the same Risk Decision and
  Reservation; an exact decrease-only command instead binds `PERMIT_DECREASE_ONLY` and explicitly carries no
  Reservation or claim. Both bind authorization mode and complete request Authorization Lineage.
  `UNATTENDED_REQUEST_WITH_POLICY` additionally binds the current Autonomous Policy Authorization.
- [Risk](./risk/) first returns the sole immutable Reservation Claim Result. Only `CONSUMED` permits a prepared attempt; Risk then returns the sole immutable Adapter Admission Result, and only matching `ADMITTED_ONCE` permits `INVOCATION_STARTED` and normal adapter invocation.
- During Recovery, Runtime supplies instance, checkpoint, readiness, and incident facts only. A `NOT_READY`
  Readiness Fact directly opens or joins the one Execution-owned case for the same generation, scope, cause, and
  source frontier. An Incident Fact or Execution Drift Fact first receives one Execution-owned Recovery Admission
  Disposition; only `RECOVERY_ADMITTED` with a matching `ACTIVE` fence permits a case. Reconciler creates
  case- and fence-bound cancel, reduce, flatten, or readback commands from authoritative Execution exposure cuts.
- [Risk](./risk/) supplies the complete active fence set proven at one Aggregate Commitment Frontier, including
  every source-specific member identity, epoch, policy, action set, and cut, plus terminal Reservation membership
  and residual-exposure closure facts. A fence with the exact `RISK_HARD_STOP` source branch also directly opens or joins the case while Runtime
  may remain `READY`; Execution preserves the hard-stop cause and policy references but never owns them.
- [Portfolio](./portfolio/) supplies the matching account closure projection.
- Venues and simulated adapters provide authoritative replies, fills, account readbacks, and errors.

## Output handoffs

- To [Strategy Governance](./strategy-governance/) before it creates a Paper or Live Execution Scope: one current
  immutable `ADMITTED` Execution Adapter Binding with exact mode, account, effect namespace, endpoint,
  capabilities, trust policy, and valid-through. Missing, revoked, cross-mode, aliased, or unknown binding creates
  no Execution Scope or authorization.
- To [Risk](./risk/) in Paper or Live: one stable Reservation Claim Request, then after `CONSUMED` one `ADAPTER_ADMISSION_REQUEST` bound to the durable `PREPARED` attempt and command, then post-admission unknown-effect, settlement, or exactly one no-effect proof. `PRE_ADAPTER_SUPPRESSION` binds a `SUPPRESSED_BY_FENCE` result and durable no-invocation record; `VENUE_READBACK` binds one `ADMITTED_ONCE` and `INVOCATION_STARTED` attempt to authoritative readback. The proof shapes are mutually exclusive.
- An exact `PERMIT_DECREASE_ONLY` command bypasses the add-risk Reservation graph: Execution creates no
  Reservation Claim Request or claim result and admits no add-risk shape. It still writes one stable `PREPARED`
  attempt and sends `ADAPTER_ADMISSION_REQUEST`; Risk orders that request against same-scope fence activation.
  Only `ADMITTED_ONCE` permits `INVOCATION_STARTED` and the bounded decrease action. Recovery remains a separate
  active-fence path.
- To [Risk](./risk/) before Recovery admission: `execution-risk-drift-fence` carries the committed exact
  `reconciliation-drift-fact` for `RECONCILIATION_DRIFT`; Execution never writes the resulting Recovery Fence.
  During Recovery, every later fact binds case, generation, scope, complete active fence-set identity/digest,
  Recovery Command, and effect chain. A committed drift `UNKNOWN_EFFECT` binds effect journal, uncertain-effect
  lineage, uncertainty observation, last readback attempt or proven absence, and complete source/time frontier;
  it needs no fabricated terminal readback. Only `NO_EFFECT` and `SETTLED` bind authoritative terminal readback
  and reconciliation cuts. No recovery fact is an `ADAPTER_ADMISSION_REQUEST`, and Execution neither reads nor
  asserts Risk-owned Reservation membership.
- To [Runtime](./runtime/): order, fill, command rejection, terminal venue readback, and reconciliation results.
- To [R&D](./rd/): committed generation-scoped account, order, fill, complete Execution Quality
  Observation, Effect Journal, authoritative readback, and Reconciliation Drift facts as successor-only source
  evidence. The Research provenance binds those exact committed fact identities and source cuts, never Effect
  Closure View. This local feedback cannot mutate a running or selected lineage and contains no protected
  Qualification detail.
- To [Portfolio](./portfolio/): account, order, fill, fee, authoritative venue facts, stable settlement/readback
  lineage, and the exact finite Execution Quality Observation used by Portfolio projection and attribution.
- To [Strategy Governance](./strategy-governance/): directly readable committed Reconciliation Drift Facts; Event Rail is only a wake hint.
- To [Strategy Governance](./strategy-governance/): immutable `RecoveryCase.KNOWN_CLOSED` before any fresh generation decision.
- To Event Rail: committed order, fill, and reconciliation events as wake-up hints.

## Rejections and prohibitions

- Never accept a normal add-risk command without the same current Risk Decision and Reservation binding. A normal
  decrease-only command instead requires the exact decrease-only permit and explicit-none Reservation/claim lineage.
- Never accept a normal add-risk command whose authorization mode, request, principal, scope, admitted shell binding or
  history head, Operator Authorization, operation manifest, Governance decision, intent, or Risk permit lineage is
  absent, expired, revoked, or mismatched. `UNATTENDED_REQUEST_WITH_POLICY` additionally requires a current,
  matching Autonomous Policy Authorization; it never replaces any request-lineage member.
- Never admit a normal Paper or Live command carrying `ATTENDED_REQUEST`, even when a principal is present or the
  request was accepted. Normal add-risk and adapter effect require `UNATTENDED_REQUEST_WITH_POLICY`; attended
  authority is limited to decrease-only or recovery until a separate attended-effect contract exists.
- The adapter gate admits attended lifecycle work only with the exact current Risk `PERMIT_DECREASE_ONLY`.
  Recovery instead requires the exact Risk-authoritative complete `ACTIVE` fence set. Execution derives the
  allowed action as the intersection of all member sets, never their union; an empty intersection or
  completeness-unproven set admits no action. Neither path admits an add-risk shape.
- Never accept a normal or recovery add-risk command after matching Runtime `NOT_READY` or an active Risk fence,
  or when either readiness or fence frontier is unavailable, stale, or mismatched.
- Never invent fills, suppress uncertainty, or mark unknown venue state as success.
- Never convert missing, stale, mixed-scope, mixed-effect, or policy-mismatched observation evidence into
  `NONE_OBSERVED`; such evidence is unavailable for attribution.
- Never accept an unavailable, untrusted, revoked, digest-mismatched, wrong-account, wrong-mode, or
  capability-insufficient adapter binding, and never place credential material in a command or journal.
- Never own Trade Intent, risk policy, account projection, lifecycle state, or fence activation.

## Failure and recovery

Before normal invocation, Execution sends one stable Reservation Claim Request. Only a matching `CONSUMED`
result admits preparation: Execution may durably record one `PREPARED` attempt and send one
`ADAPTER_ADMISSION_REQUEST` bound to that attempt, command, Risk Decision, Reservation, and immutable adapter
binding, but may not call externally. Risk durably and atomically serializes admission against same-scope Recovery
fence activation, then commits one immutable `ADMITTED_ONCE`, `SUPPRESSED_BY_FENCE`, or `REJECTED` result. Execution
persists `INVOCATION_STARTED` before the external call and only for matching `ADMITTED_ONCE`. A lost response,
crash, restart, or replay joins the same identities; it never changes adapter binding or invokes another attempt.
`SUPPRESSED_BY_FENCE` and `REJECTED` remain durable no-invocation outcomes. Once invocation starts, only
authoritative readback proves `VENUE_READBACK` no-effect or settlement. Timeout or ambiguous response remains
`UNKNOWN_EFFECT`, never a safe retry.

For normal decrease-only work, the command carries `PERMIT_DECREASE_ONLY` and explicit-none Reservation and claim
lineage. Execution persists the same stable `PREPARED` boundary and requests adapter admission without a claim;
Risk still serializes admission against fence activation. `SUPPRESSED_BY_FENCE` and `REJECTED` prove no
invocation, while only `ADMITTED_ONCE` can lead to `INVOCATION_STARTED`. Crash, restart, and replay join that same
attempt and result.

If an applied-Artifact `DECREASE_ONLY_STRATEGY_PROTECTIVE` and `RISK_HARD_STOP` contend, Execution preserves the
normal intent and its Risk suppression or already-admitted attempt lineage but accepts only the Risk fence as
Recovery authority. The Recovery plan binds one exact open-order/exposure/readback cut plus every admitted or
started decrease effect in the same stable economic lineage. Fence-first produces no normal invocation;
admission-first awaits or consumes that attempt's authoritative readback. Either ordering allows at most one
external decrease effect for the same remaining quantity.

Effect Closure View projects `UNKNOWN_EFFECT`, `NO_EFFECT`, or `SETTLED` with the exact attempt, adapter binding,
effect frontier, readback and reconciliation cuts, freshness, blocker, and responsible Owner. Every view also
binds requesting principal, authorized scope, authorization-policy cut, account, mode and effect namespace,
stable request identity, projection cut, valid-through, replay meaning, and Recovery Case and fence when
applicable. Cross-principal, cross-account, cross-mode, stale-policy, changed-meaning, or mismatched Recovery replay
is rejected rather than served from an earlier view. It is explanatory; only Effect Journal and source Owner facts
are authoritative.

For recovery reduce or flatten, Reconciler plans from an authoritative venue-position cut and Order Engine
revalidates the same side and quantity immediately before adapter invocation with enforceable reduce-only
semantics. A newer cut, partial or concurrent fill, zero exposure, sign change, unsupported reduce-only adapter,
or possible zero crossing commits a durable no-effect rejection. Reconciler may build a successor only from the
newer readback; it never retries the stale command. Recovery does not reuse normal claim arbitration. Reconciler
selects actions by one versioned deterministic policy over the complete affected-effect set: readback before any
mutation, then cancel open orders before reduce, reduce before flatten, and no action when the current cut proves
zero exposure. Stable instrument and order identity break ties; missing membership or an unresolved tie produces
no mutation. For each selected action, Reconciler commits a Recovery Effect Attempt `PREPARED` before any adapter
invocation and `INVOCATION_STARTED` immediately before the call. A crash between either cut is resolved by
authoritative readback under the same attempt identity, never a new blind retry. Reconciler
alone writes `KNOWN_CLOSED` after the complete cause and affected-effect set joins the active Risk fence, Runtime
checkpoint and current readiness, authoritative Execution readback, complete Risk closure, Portfolio closure, and common time
frontier. Closure never lifts the fence or resumes trading.

## Decision contract

- **Inputs** - normal Authorized Order Command plus Risk claim/admission results, or Execution-owned Recovery Case
  plus the exact current active Risk Fence; adapter, venue, Risk and Portfolio facts close the loop.
- **Diagnosis and decision** - validate normal effect authority or select one bounded Recovery action, journal the
  attempt cuts, perform authoritative readback, reconcile, and decide effect/case closure.
- **Conflict resolution** - stable normal attempt identity prevents duplicate invocation; Recovery action order is
  readback, cancel, reduce, flatten with stable identity tie-breaks and no mutation on unresolved membership.
- **Outputs and terminal negatives** - order and effect facts, drift, readback, Effect Closure View, Recovery Effect
  Attempt and `KNOWN_CLOSED`; rejected, no-effect and unknown remain distinct durable outcomes.
- **Feedback and economic meaning** - make every external effect, fee, fill, drift and closure attributable so
  Portfolio can measure economics and Governance can change lifecycle safely.
- **Prohibitions** - no Trade Intent, allocation, Risk state, account projection, lifecycle state, blind retry,
  invented fill, notification proof, or fence activation.

## Subsequent implementation acceptance

- Only Order Engine can change order lifecycle state.
- Every external attempt is traceable to a validated permit or active recovery fence.
- Every normal Effect Journal record and authoritative readback resolves to the same authorization mode, request,
  principal, scope, admitted shell binding and history head, Operator Authorization, operation manifest,
  Governance decision, intent, Risk decision, and Reservation. `UNATTENDED_REQUEST_WITH_POLICY` additionally
  resolves to the same current Autonomous Policy Authorization.
- Every normal add-risk command has one Reservation Claim Result; only `CONSUMED` permits one `PREPARED` record, one immutable Adapter Admission Result, and at most one `INVOCATION_STARTED`. Decrease-only forbids any claim result or Reservation but still requires its exact permit, `PREPARED`, Adapter Admission Result, and at most one `INVOCATION_STARTED`. Restart joins those identities and readback instead of issuing a second attempt.
- A Reservation Claim Result never binds or requires a `PREPARED` receipt or adapter-admission fact. For add-risk,
  `CONSUMED` is committed first, Execution then writes `PREPARED`, and only that receipt may enter the later
  Adapter Admission Request; no circular or speculative preparation is accepted.
- Every complete execution observation resolves to a complete finite `observationCategorySet` and each member's
  policy/evidence cuts. Simultaneous supported categories are preserved; `NONE_OBSERVED` is a singleton proving a
  complete census, while an incomplete cut creates no available observation.
- Every decrease-only command has explicit-none Reservation/claim lineage, one `PREPARED` attempt, one immutable
  Adapter Admission Result, and at most one `INVOCATION_STARTED`; it cannot invoke from the permit alone.
- Paper and Live adapters consume the same command contract but cannot share account or effect namespaces.
- Concurrent commands cannot consume one Reservation; the same command replay joins the existing Effect Journal.
- Claim and withdrawal resolve to one Risk-owned result; after `CONSUMED`, `ADAPTER_ADMISSION_REQUEST` and fence activation resolve to one second Risk-owned frontier result before any adapter call.
- `SUPPRESSED_BY_FENCE` or `REJECTED` cannot become `INVOCATION_STARTED`; `ADMITTED_ONCE` is necessary but a durable invocation-start record is still required before the call.
- A recovery reduce or flatten action cannot cross zero or increase opposite-side exposure after a partial or concurrent fill; stale cuts fail before adapter invocation.
- Repeated or late replies are idempotently joined without erasing uncertainty.
- Venue readback, Risk settlement, Portfolio projection, and Recovery Case evidence agree before closure.
- Recovery readback and reconciliation cover the exact case effect set and source cut with no unknown effect.
- Only Reconciler creates Recovery Commands and writes Recovery Case state or `KNOWN_CLOSED`; Runtime can do none of those.
- Recovery facts never request ordinary adapter admission; unknown recovery effects keep affected Reservations non-reusable and the case fenced.
- For orphan positions and out-of-band effects, Execution supplies external readback but cannot assert Reservation absence; Risk alone may resolve its own set as `RESOLVED_EMPTY`.
- Every lifecycle response to reconciliation drift binds the exact Execution-owned drift fact identity; notification delivery never proves reconciliation.
- Every `RUNTIME_INCIDENT` exact `runtime-incident-fact` and every `RECONCILIATION_DRIFT` exact
  `reconciliation-drift-fact` deterministically receives its own Recovery Admission Disposition; neither
  source substitutes for or requires the other.
  `RECOVERY_ADMITTED` alone permits the matching case; Runtime `READY` plus no matching fence and authoritative
  no-effect or fully reconciled no-residual-liability proof commits `NO_RECOVERY_REQUIRED`; all other unresolved
  admission evidence commits `UNRESOLVED_NO_CASE`. The latter two create no case, command, effect, or fence.
- Every matching admitted `RUNTIME_INCIDENT` or `RECONCILIATION_DRIFT` disposition, Runtime `NOT_READY`, or
  `RISK_HARD_STOP` fence source joins the same case by immutable identity. Either admitted singleton needs no
  other source. A hard-stop source neither requires Runtime `NOT_READY` nor
  transfers fence or cause authority to Execution.
- Every Recovery action is selected from the complete affected set by the same versioned order and is traceable to
  one `PREPARED` and at most one `INVOCATION_STARTED` Recovery Effect Attempt. Unknown membership or ordering
  commits no external action.
- Every Effect Closure View binds principal, scope, policy, account, mode, namespace, request meaning, projection
  cut and, when applicable, Recovery Case and fence. A mismatched replay returns no view.

## Observability and persistence

Execution persists command admission, Effect Journal, adapter attempt, invocation boundary, order/fill/fee/readback facts, reconciliation drift, Recovery Case, and effect-attempt closure. Telemetry records queue, admission, adapter and venue latency, retry suppression, partial fills, readback failure, unknown effect, drift, and recovery duration with exact account/scope/mode/effect namespaces. Dashboard counts commands, attempts, orders, fills, rejections, unknown effects, and recoveries from those identities; spans, transport acknowledgements, logs, or alerts never prove an external effect or permit a retry.
