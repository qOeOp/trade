# Overview scenario

The overview tells one product story from a falsifiable idea to governed automated trading, factual feedback,
and known-safe recovery. It shows owner contracts; scenario pages contain the detail.

## Entry

A person submits a sourced, falsifiable market idea through the target Windmill Product Edge. The default
Windmill App and optional external conversation clients connected through Windmill MCP invoke the same versioned,
bounded Owner operations behind one `WINDMILL_PRODUCT_EDGE` admission gateway. Neither UI, MCP transport, nor
workflow stores business truth or trades directly.

## Value path

1. Market Data provides traceable point-in-time facts and canonical instrument identity.
2. Research freezes the hypothesis and produces a reproducible Strategy Artifact.
3. Exploratory Backtest may support another research iteration.
4. A frozen candidate enters independent protected Qualification.
5. Strategy Governance combines eligibility, lifecycle evidence, capital policy, complete request Authorization
   Lineage, and an explicit Autonomous Policy Authorization into deployment decisions.
6. Scanner can periodically submit evidence-only proposals. A proposal continues lawfully only inside an already
   authorized unattended lifecycle lineage and a separate Governance decision; Scanner never deploys.
7. Runtime, Risk, and Execution perform automated paper or live trading through one permit-bound write chain.
8. Portfolio projects read-only account, exposure, performance, capacity, interaction, and degradation facts.
   Governance deterministically allocates a complete contender set; Risk enforces generation envelopes and joins
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

- **Beneficiary** - quantitative researchers, strategy operators, and capital owners who need one traceable path from an idea to automated trading.
- **Observable outcome** - every accepted transition has one Owner fact and every automated effect joins a governed generation, permit, execution record, account projection, and feedback loop.
- **Harm if unchanged** - teams would build competing authorities, promote attractive but unqualified results, and lose the ability to explain capital or external effects.
- **Terminal negative** - any incomplete handoff ends in its Owner's explicit negative or unresolved state; an open Recovery Case, missing receipt, or unknown effect is never inferred as success.

## Fail closed and forbidden transitions

- Natural language, an agent plan, a notification, or an event is never trading authority.
- Protected evaluation cannot feed the same research loop.
- Scanner cannot start Runtime.
- Risk cannot issue an order command; Execution cannot accept a command without the bound permit.
- Unknown external effect cannot be treated as success, closure, or permission to start a new generation.
- An active generation is never retained by silence. Eligibility loss or stale required performance, exposure, or
  degradation evidence enters `DE_RISK_PENDING`, blocks new risk, and preserves decrease-only safety actions.
