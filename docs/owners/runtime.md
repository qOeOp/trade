# Runtime

## Responsibility

Apply Governance-authorized generations, consume live market facts, and produce normal Trade Intent. Governance
authorization never proves an instance is running; Runtime's Generation Application Receipt does. Runtime binds
an approved Risk permit into an order command but owns no order, fill, account effect, Recovery Case, or closure.

## Authoritative facts owned

- Strategy Instance identity, generation, governed deployment binding, and internal checkpoint.
- Generation Application Receipt binding Governance decision, Execution Scope, adapter binding, Strategy
  Artifact, application attempt, checkpoint frontier, fence epoch, authorization mode, and complete request
  Authorization Lineage to `APPLIED`, `REJECTED_NO_INSTANCE`, or `APPLICATION_UNKNOWN`. An unattended receipt
  additionally binds Autonomous Policy Authorization.
- Trade Intent bound to the exact generation, Execution Scope, market cut, intent kind, digest, issue time,
  Governance decision, authorization mode, complete request Authorization Lineage, and, when unattended, current
  Autonomous Policy Authorization.
- Runtime Incident Fact bound to incident identity, generation, affected scope, category, severity, and shared Time
  Evidence. It is immutable and never gains a Recovery Case back-reference; Execution records the incident identity
  in the case cause set.
- Runtime Readiness Fact bound to instance, generation, checkpoint, affected scope, cause frontier, `READY` or
  `NOT_READY`, local suppression receipt, and `valid-through`.
- Runtime Kernel Repair Result bound to one R&D-owned `native-repair-request`, stable correlation, predecessor
  `REPAIR_INPUTS` decision, original proof digest, old kernel version, decisive evidence, repair policy, and fresh
  Time Evidence. Runtime alone commits `REPAIRED`, `UNAVAILABLE`, or `OUTCOME_UNKNOWN` for that attempt.

## Modules

- **Strategy Instance** - run the governed artifact, consume market facts, emit Trade Intent, and bind an approved
  Risk decision into an Authorized Order Command. Paper and Live use the same instance semantics; only the
  Execution adapter, account namespace, and effect namespace differ.
- **Readiness Gate** - stop local intent and command production before committing `NOT_READY`, then publish the
  exact generation, checkpoint, affected scope, and time frontier to Risk and Execution.

Checkpoint and readiness persistence are internal Runtime concerns rather than a second visible capability or
authority. Their implementation may change as long as restart joins the same identities and preserves the facts
above.

## Input handoffs

- [Strategy Governance](./strategy-governance/) supplies a generation-specific `INITIAL_ACTIVATION`, `PROMOTION`,
  `REDUCTION`, `PAUSE`, `RETIREMENT`, `DE_RISK`, or `RECOVERY` decision, its Execution Scope, complete request Authorization Lineage, and when automated
  intent is allowed, an explicit Autonomous Policy Authorization and retention validity.
- [Market Data](./market-data/) supplies current market and instrument facts.
- [Risk](./risk/) returns a terminal Risk Decision, one-use Reservation, decrease-only permit, or terminal
  pre-consumption withdrawal.
- [Execution](./execution/) returns order, fill, rejection, terminal readback, and reconciliation facts needed
  to update instance state or declare readiness loss.
- [R&D](./rd/) supplies only a frozen `RUNTIME_KERNEL` `native-repair-request` with exact predecessor decision,
  correlation, proof digest, old kernel identity and source cut, policy, and fresh Time Evidence. Wrong category,
  target, predecessor, proof, identity, cut, policy, time, or changed meaning creates no attempt or result.

## Output handoffs

- To [Risk](./risk/): normal Trade Intent, decrease-only lifecycle intent, immutable Runtime Readiness Facts, and
  committed `runtime-incident-fact`. For `RUNTIME_INCIDENT`, the `runtime-risk-incident-fence` relation carries
  that source fact to Risk; Runtime never writes the resulting Recovery Fence.
- To [Execution](./execution/): an Authorized Order Command during normal trading; during Recovery only instance,
  checkpoint, readiness, and incident facts, never a Recovery Command.
- To [Strategy Governance](./strategy-governance/): Generation Application Receipts and directly readable Runtime
  Incident Facts. Execution supplies `RecoveryCase.KNOWN_CLOSED` separately.
- To [R&D](./rd/): committed generation-scoped Incident facts as successor-only source evidence. The
  handoff cannot tune the running generation, reopen its Intent, or expose protected Qualification detail.
- To [R&D](./rd/): the exact request-correlated Runtime Kernel Repair Result. `REPAIRED` names a new kernel
  version and permits only a new request-equal Replay Request bound to the exact native repair request and
  result identities, exact predecessor `REPAIR_INPUTS` decision, `RUNTIME_KERNEL` category, stable correlation,
  original proof digest, predecessor and successor kernel identities and source cuts, and unchanged predecessor
  request semantics. Only `REPAIRED` permits re-entry; `UNAVAILABLE` permits only the correlated
  `STOP_INPUT_UNAVAILABLE`; `OUTCOME_UNKNOWN` permits no stop, retry, successor, Artifact, Selection, or Replay
  Request. Delivery, acceptance, silence, and telemetry are not repair results.
- To Event Rail: committed incident and readiness-change wake hints; notification delivery is never evidence of
  readiness, fencing, Recovery Case closure, or lifecycle completion.

## Rejections and prohibitions

- Never send a normal command without the matching current Risk Decision and Reservation or decrease-only permit.
- Never emit new intent or command after matching `NOT_READY`; local suppression precedes fact publication.
- Never emit new intent when Governance retention is absent, expired, revoked, unknown, or `DE_RISK_PENDING`.
  An unattended intent also fails closed when Autonomous Policy Authorization is absent, expired, revoked, or
  mismatched. Local suppression precedes any acknowledgement of the successor lifecycle state.
- Never translate `REDUCTION`, `PAUSE`, or `RETIREMENT` into add-risk intent or Reservation.
- Every attended decrease-only lifecycle command binds the exact Risk `PERMIT_DECREASE_ONLY` and is limited to
  cancel, reduce, flatten, or readback; no other command reaches the Execution adapter gate.
- An unattended applied Artifact may emit `DECREASE_ONLY_STRATEGY_PROTECTIVE` only from its bound protective-exit
  rule and trigger evidence. It remains a normal Runtime intent: an active `RISK_HARD_STOP` fence suppresses it,
  and it never authorizes or substitutes a Recovery Command.
- Never commit `APPLIED`, emit an add-risk Trade Intent, or create a normal Paper or Live command for
  `ATTENDED_REQUEST`. Only `UNATTENDED_REQUEST_WITH_POLICY` may drive `INITIAL_ACTIVATION`, `PROMOTION`, or
  automated trading; attended authority remains non-running and decrease-only.
- Never own order lifecycle, fill, venue effect, account state, Reservation settlement, Recovery Command, Recovery
  Case state, or `KNOWN_CLOSED`.
- Never infer a running instance from Governance state or retry an `APPLICATION_UNKNOWN` attempt as a new application.
- Never accept `SIMULATOR` or `BACKTEST_OPERATIONAL` as a Runtime repair, rewrite a result for changed request
  meaning, or let repair delivery create a kernel version, Research transition, or retry.
- Paper mode never fabricates fills or account state in Runtime; the selected simulated Execution Adapter owns
  simulated order and account effects under a Paper-only namespace.

## Failure and recovery

On readiness loss, Runtime first stops local intent and command production, then commits one immutable
`NOT_READY` fact for the exact generation, checkpoint, Execution Scope, Capacity Scope, cause frontier, and time
validity. Risk independently turns that fact or its expiry into a shared active fence. A Runtime incident instead
commits its immutable `runtime-incident-fact` and may leave Runtime `READY`; `runtime-risk-incident-fence` submits
that exact fact to Risk, which alone may commit the matching `RUNTIME_INCIDENT` Recovery Fence. Execution resolves only the distinct
`RUNTIME_INCIDENT` Recovery Admission Disposition and creates or joins a case only from `RECOVERY_ADMITTED` with
a matching active fence. It never requires or substitutes an Execution drift source. For an
admitted case, Execution Reconciler owns it, creates bounded recovery actions, joins terminal venue, Risk, and
Portfolio facts, and alone writes `KNOWN_CLOSED`. Runtime may restart from its checkpoint, but it cannot lift a
fence, close a case, or resume the old generation; Governance must issue a fresh decision.

## Decision contract

- **Inputs** - one Governance generation decision and artifact, current Market Data, terminal Risk decisions, and
  Execution order/fill/readback facts.
- **Diagnosis and decision** - apply or reject one generation, evaluate strategy conditions, emit normal Trade
  Intent, bind authorized commands, and commit readiness or incident facts.
- **Conflict resolution** - generation, checkpoint and readiness identities are monotonic; newer fence or
  lifecycle state suppresses older writes, and duplicate application joins once.
- **Outputs and terminal negatives** - Application Receipt, Trade Intent, Authorized Order Command, readiness and
  incident facts; rejection, unknown application and `NOT_READY` never imply running or success.
- **Feedback and economic meaning** - run the same governed strategy semantics in Paper and Live while returning
  operational facts that explain behavior without claiming orders or PnL.
- **Prohibitions** - no adapter selection authority beyond the bound scope, fill, account effect, order lifecycle,
  Reservation state, Recovery action, case, closure, or persistence-as-separate-authority.

## Subsequent implementation acceptance

- Strategy Instance is the only normal Trade Intent writer in Paper and Live.
- Every command binds the exact current decision, Reservation or decrease-only permit, and Execution Scope.
- Every normal command also preserves the initiating request, principal, scope, admitted shell binding and history
  head, Operator Authorization, operation manifest, and authorization mode from Governance through the Trade
  Intent and Risk permit. An unattended command additionally preserves Autonomous Policy Authorization.
- Paper and Live preserve disjoint account and effect namespaces.
- Old generations cannot write through a newer checkpoint or readiness frontier.
- Runtime commits local suppression before `NOT_READY`; stale or expired readiness can never authorize new intent.
- Risk fencing does not depend on Runtime acknowledgement or an Execution case transition.
- Restart joins the same application, checkpoint, and readiness identities and cannot create a second instance.
- Runtime has no API or state transition that creates, advances, commands, or closes a Recovery Case.
- A Runtime Incident Fact never changes bytes or acquires a case identifier after commit. One or more cases may
  reference it only from their append-only cause sets.
- Every admitted `RUNTIME_KERNEL` native repair request has one correlated write-once result. Exact replay joins
  the same attempt and result; `UNAVAILABLE` and `OUTCOME_UNKNOWN` create no successor kernel identity, while only
  a result-bound `REPAIRED` can name one.

## Observability and persistence

Runtime persists application, Strategy Instance checkpoint, readiness, lifecycle observation, and immutable Incident facts. Telemetry covers load/start/stop latency, heartbeat and readiness, restart, queue pressure, strategy invocation count, and bounded incident category. Dashboard uptime, downtime, running-since, restart count, applied-generation count, and use duration derive from exact application/readiness/incident intervals under one Time Evidence epoch; missing heartbeats alone cannot declare an incident resolved, a generation stopped, or Recovery closed.
