# Overview scenario

The overview tells one product story from a falsifiable idea to governed automated trading, factual feedback,
and known-safe recovery. It shows owner contracts; scenario pages contain the detail.

## Entry

One individual gives a sourced, falsifiable market idea to an external Agent. The Agent calls the domain MCPs through bounded, versioned Owner operations. Server services persist admitted jobs and results independently of that conversation. Dashboard reads research progress and evidence; it exposes approved Governance controls, including first trial confirmation, but neither starts research nor controls the local Agent. Product Edge admits requests without owning business truth or trading directly.

## Value path

1. The user gives an external Agent a goal and risk tolerance. Within approved bounds the Agent authors native Strategy code, proposes hypotheses and registers experiments.
2. Market Data prepares/reuses exact one-minute bars and required additional data; R&D freezes Git source, parameters, environment and input references.
3. Backtest uses Nautilus replay, matching and reports. The Agent interprets evidence; R&D retains experiments, exposure and reusable knowledge. Reaching the research goal stops research.
4. The user separately requests independent Qualification. Protected evaluation publishes only its binary terminal result; failure does not restart research.
5. Qualification does not launch a strategy. Dashboard user confirmation of real trial places the exact version in the Governance queue.
6. Governance checks current eligibility, authority, frozen policy, account capacity and existing occupancy. Native Runtime/Risk/Execution/Portfolio then run the admitted deployment.
7. Governance promotes under frozen trial conditions and unloads under frozen exit conditions or a user request. Existing positions retain protection; capital is reusable only after actual occupancy clears.
8. Single-strategy and combination research share native backtest semantics. Combination configuration is independently versioned; R&D researches member-exit plans and Governance executes them. Portfolio provides reproducible account/performance facts; the Agent provides scientific interpretation.
9. Failures retain source logs and unknown effects. Fact Owners close recovery under Risk fences; notifications, retries or local acknowledgements never establish success.

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
