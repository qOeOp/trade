# Product loop

The product is a closed learning and control loop. Every transition changes either evidence, governance,
runtime authority, external effects, or the factual projection used by the next decision.

## User-facing closure and implementation boundary

The Owner control loop below is the target authority flow; it does not by itself prove a usable application.
User-facing closure exists only when [Product Edge](../architecture/product-edge/) lets a user carry one bounded
goal from entry to an authoritative result and its next legal action without manually joining Owner databases,
receipts, logs, or terminal output.

- `CURRENT/PARTIAL` - `crates/strategy_factory` provides a narrow frozen `ResearchIntent` to `StrategyArtifact`
  to native replay and `TrialReceipt` pilot. It is `SURVIVED_NOT_ADMITTED`, not a complete R&D product.
- `TARGET/ABSENT_TARGET_ONLY` - the selected Windmill R&D Workbench presents Source and Hypothesis, frozen Intent, Artifact and Build
  Receipt, exploratory Run Detail and Compare, Diagnosis, Iteration Decision, and the exact stop, repair,
  successor, or Qualification handoff action. Windmill App and Windmill MCP invoke the same versioned operations.
- `NOT_ADMITTED` - an architecture page, local Windmill installation, MCP handshake, target read model, Dashboard,
  or reachable low-level API does not make the workbench `CURRENT`.

The target ships as one Docker Compose product package with one default Windmill web entry and one Windmill MCP
conversation outlet. Optional external conversation clients are not bundled or individually adapted. Windmill
schedules long-running research and scanner jobs; Trade Runtime remains the authority and process boundary for
live strategy loops, market sessions, risk, orders, and recovery effects.

[Observability](../architecture/observability/) may explain progress and failure, but it cannot close the journey,
choose the next action, or substitute telemetry for a native Owner receipt.

## Agent-native R&D experience

The user-facing authoring loop is conversation-driven:

Natural-language research request → Research Request Receipt → Frozen Research Intent → Agent activity and R&D
iterations → immutable Strategy Artifact and Build Receipt → exploratory Run Detail or Compare → Iteration
Decision → exact successor, stop, repair, or Qualification handoff.

The Conversation Agent ends at typed request submission and bounded status queries. A server-side R&D Execution
Agent owns the long-running execution session and remains supervised by Windmill when the conversation client is
closed. MCP does not lend the client model or credentials to that job. The two roles may share an explicitly
configured model provider or billing gateway, but not session authority, capability scope, budget, or audit
identity.

A user starts research, asks for an explanation, requests a revision, stops work, or submits the exact selected
Candidate through a visible action. Each mutating action creates a new typed request. A revision produces a new
immutable Artifact or an explicit native terminal disposition; it never edits or overwrites an existing Artifact.
Windmill Job progress explains execution only. The receiving Owner receipt and projection determine the business
phase and allowed next actions.

The target Windmill R&D Workbench closes the journey through these application areas:

| Area             | Required first product view                                                                                                                       | Authority boundary                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Overview         | Active research, decisions awaiting attention, recent outcomes, Scanner and Runtime health                                                        | Summary only; every state links to its native Owner projection                                                                  |
| Sources / Intake | Submitted papers, notes, media, tool output, acquisition state, provenance, interpretation, triage, and Research Queue                            | R&D Source Intake owns admission and provenance; external content stays untrusted and never creates Intent or Artifact directly |
| Research         | Runs, frozen goal, timeline, Agent activity, iteration state, progress, logs, and allowed actions                                                 | R&D receipts and Research View decide state; logs do not                                                                        |
| Hypotheses       | Pending, supported, falsified, stopped, or unresolved research hypotheses                                                                         | R&D owns provenance, lineage, and Iteration Decision                                                                            |
| Artifacts        | Identity, intent and iteration lineage, structured logic, parameters, dependencies, build state, semantic change explanation, and allowed actions | Artifact and Build Receipt remain authoritative; explanation is not a substitute                                                |
| Backtests        | Exploratory charts, risk metrics, Run Detail, and version comparison                                                                              | Backtest owns Run Results; comparison does not create Selection                                                                 |
| Qualification    | Bounded public status and exact admitted handoff action                                                                                           | Protected details remain opaque; Qualification owns intake and eligibility                                                      |
| Scanner          | Schedule, terminal Scanner Receipt, heartbeat, and unresolved state                                                                               | Windmill schedules work; Scanner owns proposal truth and never starts Runtime                                                   |
| Runtime          | Applied generations, strategy‑loop status, checkpoints, incidents, and permitted lifecycle actions                                                | Runtime, Governance, Risk, and Execution facts remain separate authorities                                                      |
| Operations       | Windmill jobs, workers, progress, logs, retries, and incidents                                                                                    | Operational success never means research, Qualification, deployment, or trading success                                         |

The first Artifact Review surface intentionally omits raw source. Full read-only source inspection, source diff,
controlled download, and source-linked diagnostics are deferred advanced audit capabilities. Notebook-first
authoring, an embedded code IDE, in-place Artifact edits, and version overwrite are not admitted product
capabilities. A user requests a change through the Agent and reviews the resulting successor Artifact instead.

## 1. Discover and formulate

Product Edge accepts natural-language intent but owns no trading truth. Market Data supplies traceable,
point-in-time facts. R&D's Research capability converts a sourced hypothesis into a frozen Research Intent.

## 2. Build and explore

R&D owns Strategy Artifact identity and contains the Develop capability. The separate Backtest Owner provides
exploratory replay as a service and may return canonical facts into a new R&D research iteration.

## 3. Qualify independently

A frozen submission enters Qualification with preregistered trials, costs, capacity, embargo, budget, and
holdout rules. Protected Evaluation is isolated. Qualification publishes eligibility or revocation facts;
it never activates a strategy and never teaches the same research loop from protected results.

## 4. Govern the lifecycle

Strategy Governance combines eligibility, performance, exposure, incidents, reconciliation drift, and capital
policy. It owns authorization, lifecycle state, permitted capital share, and effective time. Every accepted
generation decision preserves the complete request Authorization Lineage and binds a separate Autonomous Policy
Authorization for unattended trading. Runtime separately proves `APPLIED`. Reduce, pause, and retire use a
decrease-only effect chain and unknown effect enters Recovery.

Active status is renewed only from fresh required Eligibility, Performance, Exposure, and degradation evidence.
Loss or staleness commits `DE_RISK_PENDING`, removes new-risk authority, and keeps decrease-only safety actions
available until the generation is reduced, paused, retired, or recovered.

## 5. Find deployment opportunities

Scanner is a scheduled slow track. It loads deployable artifact references and activation conditions,
freezes a market snapshot, matches current conditions, and submits an auditable proposal to Governance.
Each strategy is evaluated independently: insufficient data blocks only that strategy, while complete matches may still
produce one batch proposal. Scanner never starts Runtime.

## 6. Trade through one control chain

Paper and live share the same Strategy Instance, trade intent, Risk decision, one-use reservation, order
command, effect journal, reconciliation, and Portfolio feedback semantics. Runtime is the only normal intent
writer. The simulated or live Execution adapter is the only mode-specific boundary. Every effect preserves the
complete request Authorization Lineage; unattended effects additionally preserve Autonomous Policy Authorization
from Governance through final Execution readback.

## 7. Recover to known closure

Recovery classifies each initiating cause as `RUNTIME_NOT_READY`, `RUNTIME_INCIDENT`,
`RECONCILIATION_DRIFT`, or `RISK_HARD_STOP`.
Distinct simultaneous admitted causes compose in one Recovery Case without requiring another branch's evidence. Runtime
`NOT_READY` supplies local suppression and its matching fence; a Risk hard stop can open and fence a case while
Runtime remains `READY` and neither `RUNTIME_INCIDENT` nor `RECONCILIATION_DRIFT` exists. `RUNTIME_INCIDENT` and
`RECONCILIATION_DRIFT` are distinct disposition-first branches: each binds only its exact immutable
`runtime-incident-fact` or `reconciliation-drift-fact`. The former reaches Risk through
`runtime-risk-incident-fence`, the latter through `execution-risk-drift-fence`, and Risk alone writes both matching
Recovery Fences. Execution must first commit a write-once `RECOVERY_ADMITTED`
Recovery Admission Disposition for that source; the independently applicable matching `ACTIVE` Risk Recovery Fence
then permits case entry. Either singleton admitted branch
may create or join a Recovery Case without the other source; when both are admitted, their distinct dispositions
join the same append-only case. A source closed as `NO_RECOVERY_REQUIRED`, or one that cannot be admitted and remains
`UNRESOLVED_NO_CASE`, creates no Recovery Case, recovery command, external effect, or Recovery Fence. Execution
Reconciler binds the Risk-authoritative complete active fence-set identity/content digest to reach `FENCED_OPEN`.
Risk proves completeness at the Aggregate Commitment Frontier, and the effective actions are the intersection of
all member action sets; an empty intersection permits no command. Recovery permits only cancel, reduce, flatten,
and readback actions owned by Execution. Execution readback, reconciliation,
Risk settlement, and the Portfolio closure projection must agree before Reconciler writes `KNOWN_CLOSED`. Only then may
Governance consider a fresh authorization for a new generation.

## Feedback that changes the next cycle

Portfolio Lifecycle Evidence Receipts, Runtime Incident Facts, Execution Reconciliation Drift Facts, and Qualification changes return
to Governance as directly readable committed Owner facts. Event Rail may wake consumers and deliver Telegram notifications,
but it cannot approve, retry, store terminal truth, or recover a strategy.
