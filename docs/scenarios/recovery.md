# Recovery scenario

Recovery classifies Runtime readiness loss, an incident, reconciliation drift, or a Risk hard stop into either an
owned no-case disposition or a provably closed external-effect state. It is the architecture's largest safety
boundary and never reuses the normal add-risk path.

## Entry

Each committed initiating cause is classified into exactly one applicable trigger branch. Distinct simultaneous
causes keep separate branch membership and join the same append-only Recovery Case causal frontier; no branch
requires evidence belonging only to another branch.
The scenario-level PRIMARY/SUPPORTING relation set is aggregate Flow and page coverage, not a conjunction; the
required executable path is the relation set of each applicable branch below.

- `RUNTIME_NOT_READY` applies when an immutable Runtime Readiness Fact is `NOT_READY` for the exact instance,
  generation, checkpoint, Execution Scope, and affected Capacity Scope. Runtime commits local intent/command
  suppression before publication, and Risk independently creates the matching fence. No Runtime Incident,
  Execution drift, or hard-stop cause is required; `NOT_READY` alone opens or joins the case.
- `RUNTIME_INCIDENT` applies only when an immutable `runtime-incident-fact` exists for the exact generation and
  scope. `runtime-risk-incident-fence` submits that exact committed source fact to Risk, which alone writes the
  matching `RUNTIME_INCIDENT` Recovery Fence. Before any case exists, Execution alone commits one write-once `recovery-admission-disposition` for that
  exact source. `RECOVERY_ADMITTED` requires the incident fact plus a matching `ACTIVE` Risk Recovery Fence and
  only then permits creating or joining the case. The singleton branch requires no reconciliation-drift fact.
- `RECONCILIATION_DRIFT` applies only when an immutable `reconciliation-drift-fact` exists for the exact
  generation and scope. `execution-risk-drift-fence` submits that exact committed source fact to Risk, which alone
  writes the matching `RECONCILIATION_DRIFT` Recovery Fence. It follows the same disposition-first rule, but its disposition binds only that drift
  source and never substitutes a Runtime incident. The singleton branch requires no incident fact.
- For either source branch, if Runtime is `READY`, no matching hard-stop or not-ready fence exists, and a fresh
  common Execution/Portfolio/Risk/Time cut proves no external effect or fully reconciled no residual liability,
  Execution commits `NO_RECOVERY_REQUIRED`; otherwise it commits `UNRESOLVED_NO_CASE` at the last authoritative
  admission frontier. The latter two states create no case, command, effect attempt, fence, or fabricated
  Runtime/Risk fact. When both branches are admitted, their distinct dispositions join one append-only case.
- `RISK_HARD_STOP` applies when Risk commits one `ACTIVE` fence with exact hard-stop cause evidence, policy
  version, Aggregate Commitment Frontier, generation, and scope. It directly opens or joins the case while
  Runtime may remain `READY` and without any Runtime Incident or Execution drift.

Readiness `valid-through` expiry fails closed and is never interpreted as `READY`. Risk never waits for Runtime
or Execution case acknowledgement to activate an applicable fence. Duplicate causes join the same case, and one
generation and affected scope cannot have parallel nonterminal cases. The case stores immutable cause references;
source Incident, Readiness, and Drift facts never acquire a case back-reference or change bytes.

## Value path

Only `RECOVERY_ADMITTED` may enter this path for a `RUNTIME_INCIDENT` or `RECONCILIATION_DRIFT` source. For a case with an independently
applicable `ACTIVE` fence, Risk totally orders fence activation with every in-flight normal `ADAPTER_ADMISSION_REQUEST`. If the fence wins,
Risk returns `SUPPRESSED_BY_FENCE`; if normal admission wins, exactly one immutable `ADMITTED_ONCE` attempt enters
the Recovery effect frontier. Risk alone proves the complete active fence set at its Aggregate Commitment
Frontier; Execution cannot infer completeness from delivered fence messages. Execution binds the exact set
identity, content digest, and every source-specific member identity, epoch, policy, action set, and source cut to
the `OPEN` case before advancing it to `FENCED_OPEN`. Runtime emits no normal intent on the `RUNTIME_NOT_READY`
branch; on a hard-stop branch Risk blocks new risk even if Runtime remains `READY`. Only Execution Reconciler may
create a Recovery Command. The effective allowed actions are the deterministic intersection of every member
fence action set, never their union; an empty intersection permits no command.

Case fence membership is append-only at each causal frontier. Every plan, command, effect attempt, Execution fact,
Portfolio/Risk closure fact, Product Edge closure view, and Runtime recovery fact binds the same immutable complete
set snapshot. A new fence before invocation invalidates the old plan and command. A new fence after invocation
preserves the original attempt identity and expands only the subsequent case frontier.

Order Engine validates each command, Execution Adapters perform the bounded action, Effect Journal records the
attempt and outcome, and Reconciler reads authoritative venue or simulator state. Recovery uses a versioned
deterministic order over the complete affected set: readback before mutation, cancel before reduce, reduce before
flatten, no mutation at zero exposure, and stable instrument and order identities for ties. Missing membership or
an unresolved tie causes no mutation. Every selected action commits a Recovery Effect Attempt `PREPARED` before
invocation and `INVOCATION_STARTED` immediately before the call. A normal attempt already in
flight must have durable `PREPARED` and `INVOCATION_STARTED` records; crash, response loss, and restart join those
records and authoritative readback rather than retrying. Recovery commands never use ordinary Trade Intent,
add-risk Reservation Claim, normal adapter-admission protocols, or the normal lifecycle `PERMIT_DECREASE_ONLY`.

Reduce or flatten binds the authoritative Execution exposure readback cut, side, absolute quantity, bounded
target, and reduce-only policy. Execution revalidates the same cut immediately before invocation. A newer cut,
partial or concurrent fill, zero or flipped exposure, unsupported reduce-only semantics, or possible zero
crossing commits a durable no-effect rejection. Reconciler may build a successor command only from the newer
authoritative readback; the stale command is never retried.

Execution reports case-, complete-fence-set-, command-, and effect-bound facts to Risk. A committed
`reconciliation-drift-fact.UNKNOWN_EFFECT` binds its effect journal frontier, invocation or uncertain-effect
lineage, uncertainty observation, last authoritative readback attempt or proven absence, and complete source and
Time Evidence frontier. This complete fact may activate its own `RECONCILIATION_DRIFT` fence without fabricating
an external outcome. Missing, ambiguous, uncommitted, or state-binding-incomplete evidence activates no fence.
Only successor `NO_EFFECT` or `SETTLED` facts bind an authoritative terminal readback and reconciliation cut.
Risk alone resolves Reservation membership and liability, including an explicit resolved-empty set for a
proven orphan external effect. Portfolio alone updates the account and exposure projection. Reconciler joins
those independent facts and writes `KNOWN_CLOSED` only when every cause and affected effect is covered at one
common evidence frontier.

## Owner handoffs

- Runtime → Risk: immutable readiness state for `RUNTIME_NOT_READY`; for `RUNTIME_INCIDENT`,
  `runtime-risk-incident-fence` carries the exact committed `runtime-incident-fact`. Both are source evidence;
  Risk remains the sole Recovery Fence writer.
- Runtime → Execution: instance, checkpoint, readiness, and committed incident facts; never Recovery Commands.
- Execution owns one source-exact Recovery Admission Disposition before any case for each `RUNTIME_INCIDENT` and
  `RECONCILIATION_DRIFT`. It may create or join a case only from `RECOVERY_ADMITTED`; either singleton needs no
  other source, simultaneous admitted dispositions join one case, and `NO_RECOVERY_REQUIRED` plus
  `UNRESOLVED_NO_CASE` are terminal no-case facts.
- Execution → Risk: for `RECONCILIATION_DRIFT`, `execution-risk-drift-fence` carries the exact committed
  `reconciliation-drift-fact`; it grants Execution no Recovery Fence write authority.
- Risk → Execution: the Risk-authoritative complete active fence set at one Aggregate Commitment Frontier, with
  exact set identity/digest and every source-specific member; Risk also supplies terminal Reservation membership
  and residual-exposure closure facts.
- Execution → Risk: fenced recovery effect facts without a normal claim or adapter-admission request.
- Execution → Portfolio: order, fill, account, fee, and authoritative readback facts.
- Market Data → Portfolio: current valuation, FX, and instrument facts.
- Portfolio → Risk and Execution: one coherent account/exposure bundle and matching account closure projection.
- Execution → Governance: immutable `RecoveryCase.KNOWN_CLOSED`; Governance alone may decide a new generation.

Event Rail may wake Governance and Observability to read committed Owner facts. It is not a recovery participant or
terminal authority.

## Proof

Each `RUNTIME_INCIDENT` or `RECONCILIATION_DRIFT` source first proves its own Execution-owned Recovery Admission
Disposition bound only to the exact `runtime-incident-fact` or `reconciliation-drift-fact`. Exact replay by
source fact, generation, scope, policy, evidence frontier, and meaning joins that write-once fact; changed source,
scope, policy, or evidence needs a successor disposition and never rewrites or fabricates a case.
When the disposition is `RECOVERY_ADMITTED`, the terminal proof is Execution-owned immutable
`RecoveryCase.KNOWN_CLOSED`. It binds one case, generation,
scope, complete active Risk fence-set identity/digest and member set, complete cause set, exhaustive affected-effect set, Runtime checkpoint/readiness frontier,
Execution readback and reconciliation cut, Risk Reservation closure, and Portfolio account projection at a
common valid time frontier. A later cause opens a successor case; it never rewrites closure.
`KNOWN_CLOSED` is a hard terminal proof, not a status summary: every listed cause and affected effect must resolve
from the case frontier, and any missing, stale, unknown, mixed-cut, or non-dereferenceable member blocks it.
The proof binds the same complete set of still-`ACTIVE` source-specific Risk Fences used for every Recovery action.
Closure does not supersede, deactivate, lift, or mutate any member: the old generation remains permanently fenced and each fence has no
`SUPERSEDED` or inactive transition. Any later generation requires a fresh Governance decision and the ordinary
add-risk gates; it never changes or reuses the predecessor fence. The later generation has no Recovery Fence
until one of its own four exact Recovery source branches independently activates one.
For every affected normal effect, the proof also preserves its original request Authorization Lineage and
Autonomous Policy Authorization through the Effect Journal and readback. The Recovery Command itself derives
only from the Execution-owned case plus the complete active Risk fence set; it is not a new
normal-trading authorization.

## Development outcome

- **Beneficiary** - operators and capital owners who must know when uncertain external effects are fully bounded and reconciled.
- **Observable outcome** - each Runtime incident or reconciliation drift produces one source-exact owned admission disposition; only an admitted cause
  enters an Execution-owned case that joins every cause and effect to venue readback, Risk closure, Portfolio
  closure, and immutable `KNOWN_CLOSED`.
- **Harm if unchanged** - split authority can permit naked retries, orphan positions, unresolved liability, or premature reuse of capital.
- **Terminal negative** - any unknown effect, unresolved Reservation membership, open reconciliation, missing cause, stale readiness, or mixed evidence cut keeps the case fenced open.

## Fail closed and forbidden transitions

- Runtime never opens, commands, advances, or closes a Recovery Case; it supplies only instance, checkpoint,
  readiness, and incident facts.
- Risk never waits for case acknowledgement to fence a `NOT_READY` or expired Runtime scope.
- Risk may also fence from exact `RISK_HARD_STOP` cause evidence and policy while Runtime is `READY`; Execution
  must open or join the same Recovery path without fabricating Runtime `NOT_READY`.
- A Runtime incident or reconciliation drift alone never fabricates a fence or case. Without a matching `ACTIVE` fence, authoritative
  no-effect or fully reconciled no-residual-liability proof yields `NO_RECOVERY_REQUIRED`; missing, mixed-cut, or
  non-isolating proof yields `UNRESOLVED_NO_CASE`. Neither state permits a command, effect attempt, or case.
- `NOT_READY` alone opens or joins a case even when no Incident or Drift exists; an implementation that waits for
  either additional cause leaves Recovery unclosed and is invalid.
- Recovery commands cannot activate a strategy, add exposure, or use ordinary Trade Intent, Reservation Claim,
  or adapter admission.
- No Recovery command passes the adapter gate without the exact Risk-authoritative complete `ACTIVE` fence set and
  an action in the intersection of all member allowed-action sets. A stale, omitted, inactive, widened, mismatched,
  or completeness-unproven set rejects the action; add-risk is never an allowed Recovery action.
- Recovery cannot erase or replace the Authorization Lineage of an affected normal effect, and an Agent or
  operator acknowledgement cannot mint Recovery Command authority.
- Missing, stale, ambiguous, or mismatched evidence blocks only transitions dependent on that trigger branch.
  Another branch's non-required fact must not be invented as a prerequisite or substitute. Every Recovery action
  still requires the exact current `ACTIVE` fence, and neither `RUNTIME_INCIDENT` nor `RECONCILIATION_DRIFT` can
  open a case before its own `RECOVERY_ADMITTED` disposition.
- If normal adapter admission wins before fence activation, that exact attempt joins the case effect frontier;
  if the fence wins, `SUPPRESSED_BY_FENCE` proves no normal adapter invocation.
- If `DECREASE_ONLY_STRATEGY_PROTECTIVE` and `RISK_HARD_STOP` become true at the same frontier, both causes remain
  attributable but the Risk fence is the sole Recovery authority. Fence-first suppresses the normal intent;
  admission-first preserves exactly one attempt for readback. Execution then deduplicates the normal protective
  lineage against the same open-order/exposure/readback cut, so every arrival-order permutation produces at most one external decrease effect.
- Missing, stale, or mismatched case, fence, exposure cut, or reduce-only capability blocks Execution invocation.
- An implicit empty or unresolved affected-Reservation set cannot support closure. Explicit empty requires
  complete Risk membership evidence joined to authoritative Execution readback.
- Simultaneous admitted incident and drift dispositions for one generation and scope join one case, while either
  singleton requires no other source. Omitted causes or effects,
  new causes before commit, or mixed Execution, Portfolio, Risk, or time cuts block closure.
- Recovery Case may reference immutable Incident, Readiness, and Drift causes; those source facts never mutate to
  point back to the case.
- Telegram delivery, Runtime liveness, local cancellation, or Event Rail silence cannot prove closure.
- `KNOWN_CLOSED` is immutable, never lifts the Risk fence, never resumes the old generation, and only permits
  Governance to consider a fresh authorization.
