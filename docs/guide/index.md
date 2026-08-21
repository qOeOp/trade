# Product guide

VibeTrader is a governed loop for turning falsifiable market ideas into managed automated trading.
The product is not a collection of engine APIs. Its public shape is the set of owners and handoffs
shown in the global architecture Flow.

## Read this guide in order

1. [Install](./install/) establishes a reproducible local foundation without granting trading authority.
2. [Quickstart](./quickstart/) walks through the shortest safe product journey.
3. [Product loop](./product-loop/) explains how evidence, strategies, capital, execution, and feedback connect.
4. [Architecture rules](./architecture-rules/) defines the invariants future implementation must preserve.
5. [Design evidence](./design-evidence/) states what mature platforms and research support and what remains our choice.
6. [Development Chunk Contract](./development-chunk-contract/) turns one architecture contract into a bounded agent implementation loop.
7. [Agent Implementation Guide](./agent-implementation/) connects a bounded chunk to verified current engine references without restoring legacy prose as authority.
8. [Source Intake Playbook](./source-intake/) gives Research a high-ROI, provider-neutral external-source admission baseline.
9. [Market Data Intake Playbook](./market-data-intake/) turns credentials and provider endpoints into rights-bound, point-in-time facts.
10. [Observability Playbook](./observability/) defines trace, telemetry, outbox, persistence, and Dashboard projections without creating another business authority.
11. [Trade Dashboard](./dashboard/) defines the future first-party visual shell, navigation, component system, and minimal Windmill replacement boundary.
12. [Architecture boundaries](../architecture/) separates authority Owners from shells stages and channels.
13. [Owners](../owners/) defines the ten writers of business truth.
14. [Scenarios](../scenarios/) describes the seven observable end-to-end stories.

## What the architecture Flow means

The Flow is the global projection of this documentation. A box is either a business owner, a product
boundary, a delivery channel, a stage, or a value-stream boundary. An arrow is a directional contract:
request, fact, policy, proposal, intent, command, effect, handoff, event, or read model.

The top-level map is intentionally bounded to 13 groups plus one non-authoritative Event Rail channel node,
with no more than five modules in any group. Details that do not change authority or an owner handoff belong in the corresponding text page,
not in the overview.

## What this guide does not promise

The documentation defines product responsibilities and observable contracts. It does not freeze class
names, database schemas, network protocols, deployment topology, or implementation language. Existing
engine capabilities are admitted only behind the owner that is responsible for their business result.
