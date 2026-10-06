# Overview scenario

The overview tells one product story from a falsifiable idea to governed automated trading, factual feedback,
and known-safe recovery. It shows owner contracts; scenario pages contain the detail.

## Entry

One individual gives a sourced, falsifiable market idea to an external Agent. The Agent calls the domain MCPs through bounded, versioned Owner operations. Server services persist admitted jobs and results independently of that conversation. Dashboard reads research progress and evidence; it exposes approved Governance controls, including first trial confirmation, but neither starts research nor controls the local Agent. Product Edge admits requests without owning business truth or trading directly.

## Value path

1. Market Data provides traceable point-in-time facts and canonical instrument identity.
2. Research freezes the hypothesis and produces a reproducible Strategy Artifact.
3. Exploratory Backtest may support another research iteration.
4. A frozen candidate enters independent protected Qualification.
5. Strategy Governance combines eligibility, lifecycle evidence, capital policy, complete request Authorization
   Lineage, and an explicit Autonomous Policy Authorization into deployment decisions.
6. R&D offers on-demand discovery using the same strategy judgments without deployment proposals. Running strategies
   consume market data continuously; Governance evaluates frozen lifecycle conditions directly.
7. After the user confirms first trial entry, Runtime, Risk and Execution perform real trial/formal trading through one permit-bound native write chain. Promotion rechecks frozen conditions and capacity.
8. Portfolio projects read-only account, exposure, performance, capacity, interaction, and degradation facts.
   Governance applies the approved trial/formal pool ratios and equal running-member allocation only when existing occupancy fits; otherwise admission waits; Risk enforces generation envelopes and joins
   account facts, open orders, and liabilities without becoming an allocator.
9. Committed feedback returns to Governance; Recovery fences incidents until external effects are known closed.

## Owner handoffs

The core direction is Market Data → Research → Backtest → Qualification → Strategy Governance → Runtime →
Risk → Runtime → Execution → Portfolio → Strategy Governance. Strategy Factory visually groups the
R&D-owned build path and independent qualification path without becoming a second authority. Product
Edge requests actions and reads views. Observability receives committed events and bounded telemetry only.

## Proof

Every transition is attributable to its owning fact: frozen intent and artifact, canonical run result,
eligibility, deployment decision, risk decision and reservation, authorized order command, effect journal,
reconciled account projection, lifecycle feedback, and `RecoveryCase.KNOWN_CLOSED` when recovery occurs.
Every automated effect additionally preserves the initiating request, principal, scope, admitted shell binding and
history head, Operator Authorization, operation manifest, and Autonomous Policy Authorization through readback.

## Development outcome

- **Beneficiary** - the individual user researching and operating strategies with a replaceable external Agent.
- **Observable outcome** - every accepted transition has one Owner fact and every automated effect joins a governed generation, permit, execution record, account projection, and feedback loop.
- **Harm if unchanged** - teams would build competing authorities, promote attractive but unqualified results, and lose the ability to explain capital or external effects.
- **Terminal negative** - any incomplete handoff ends in its Owner's explicit negative or unresolved state; an open Recovery Case, missing receipt, or unknown effect is never inferred as success.

## Fail closed and forbidden transitions

- Natural language, an agent plan, a notification, or an event is never trading authority.
- Protected evaluation cannot feed the same research loop.
- Read-only discovery cannot start Runtime.
- Risk cannot issue an order command; Execution cannot accept a command without the bound permit.
- Unknown external effect cannot be treated as success, closure, or permission to start a new generation.
- An active generation is never retained by silence. Eligibility loss or stale required performance, exposure, or
  degradation evidence enters `DE_RISK_PENDING`, blocks new risk, and preserves decrease-only safety actions.
