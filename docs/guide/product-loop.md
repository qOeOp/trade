# Product loop

The product is a closed learning and control loop. Every transition changes either evidence, governance,
runtime authority, external effects, or the factual projection used by the next decision.

## User-facing closure and implementation boundary

The Owner control loop below is the target authority flow; it does not by itself prove a usable application.
User-facing closure exists only when [Product Edge](../../architecture/product-edge/) lets a user carry one bounded
goal from entry to an authoritative result and its next legal action without manually joining Owner databases,
receipts, logs, or terminal output.

- `CURRENT/PARTIAL` - `crates/strategy_factory` provides a narrow frozen `ResearchIntent` to `StrategyArtifact`
  to native replay and `TrialReceipt` pilot. It is `SURVIVED_NOT_ADMITTED`, not a complete R&D product.
- `TARGET/ABSENT_TARGET_ONLY` - an R&D workbench presents Source and Hypothesis, frozen Intent, Artifact and Build
  Receipt, exploratory Run Detail and Compare, Diagnosis, Iteration Decision, and the exact stop, repair,
  successor, or Qualification handoff action.
- `NOT_ADMITTED` - an architecture page, target read model, Dashboard, or reachable low-level API does not make
  the workbench `CURRENT`.

[Observability](../../architecture/observability/) may explain progress and failure, but it cannot close the journey,
choose the next action, or substitute telemetry for a native Owner receipt.

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
