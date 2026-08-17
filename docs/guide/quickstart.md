# Quickstart

The shortest safe journey ends with a reconciled paper result. It demonstrates the product loop without
creating a live market effect.

## 1. Start with a falsifiable idea

Use Product Edge to submit a sourced hypothesis. R&D's Research capability freezes the mechanism, required data, cost and
capacity assumptions, experiment family, budget, falsifier, and stopping rule as a Research Intent.

## 2. Build a reproducible strategy artifact

R&D's Development Sandbox runs generated code in an isolated context. R&D publishes a content-addressed
Strategy Artifact that binds the intent, code, dependencies, and runtime version. The sandbox cannot deploy it.

## 3. Explore, then freeze

The separate Backtest service may return exploratory facts to R&D for a new iteration. Once a candidate is frozen,
Qualification preregisters protected evaluation rules. Protected results cannot return to the same
R&D loop.

## 4. Admit the strategy

Qualification publishes an Eligibility State. Strategy Governance alone decides whether to activate,
reduce, pause, resume, or retire the strategy and which capital policy applies. Eligibility is not activation.
An accepted lifecycle request preserves its request, principal, scope, admitted shell binding and history head,
Operator Authorization, and operation manifest. Automated Paper trading additionally requires an explicit
`PAPER` Autonomous Policy Authorization; a bare Governance decision is insufficient.

## 5. Run a paper session

Governance authorizes one paper generation; it does not start Runtime. Runtime independently applies that
decision and only an `APPLIED` Generation Application Receipt proves one Strategy Instance is running. The
instance emits a Trade Intent. Risk returns `ALLOW` plus one-use Reservation, and Runtime forms an Authorized
Order Command bound to that exact decision and Reservation.
Application, intent, permit, command, Effect Journal, and simulated readback preserve the same Authorization
Lineage and Autonomous Policy Authorization.

Execution claims the Reservation and waits for Risk's immutable `CONSUMED` result. It then durably records one
`PREPARED` attempt and sends one `ADAPTER_ADMISSION_REQUEST`. Only Risk's matching `ADMITTED_ONCE` result permits
Execution to persist `INVOCATION_STARTED` and invoke the simulated adapter. The adapter result and authoritative
readback then drive Execution, Portfolio, and Risk closure; no acknowledgement or timeout can skip a step.

## 6. Close the evidence loop

Execution reconciles simulated effects after adapter invocation and reports outcome and settlement lineage.
Portfolio publishes the matching Capacity View and Portfolio Risk Evidence Bundle covering account, exposure,
open-order, performance, and incorporated settlement lineage.
Risk alone computes current usage and remaining headroom, and closes Reservation liability only after the same
economic lineage is proven no-effect or replaced by that Portfolio projection. Governance consumes the committed
facts for the next lifecycle decision.

Governance retains `ACTIVE_GENERATION` only through an explicit renewal with fresh required Eligibility,
Performance, Exposure, and degradation evidence. Loss or staleness enters `DE_RISK_PENDING`, blocks new risk,
and continues a decrease-only pause, reduction, or retirement path without waiting for missing capacity evidence.

The quickstart is complete only when the run has canonical inputs and results, the external-effect model is
reconciled, risk reservations are terminal, and Portfolio can explain the resulting account state.
