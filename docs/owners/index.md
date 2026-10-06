# Owner contracts

This directory defines the product-level authority boundaries projected by the global architecture Flow. It is intentionally above classes, APIs, processes, and storage choices. A future implementation may change those details, but it must preserve these owners, facts, handoffs, and prohibitions unless the architecture contract is revised first.

The product has six responsibility groups and nine business Owners. Native Trading Node groups Runtime, Risk, Execution and Portfolio; the other five groups each have one Owner. Visual groups are not service processes. Product Edge is the client boundary, Strategy Factory describes the strategy value stream, and Event Rail and Observability are infrastructure. R&D retains projects, strategy packages, experiments and knowledge. The Agent reuses data queries and native replay for discovery without another scanner or research decision service. See the [service blueprint](../architecture/) for client interfaces and delivery milestones.

## Lifecycle

1. [Market Data](./market-data/) supplies point-in-time market and instrument facts.
2. [R&D](./rd/) turns sourced hypotheses into frozen intents, builds immutable strategy artifacts, and records bounded repairs and successors under frozen research rules.
3. [Backtest](./backtest/) produces canonical replay evidence for exploration or protected evaluation.
4. [Qualification](./qualification/) independently admits or revokes deployability without feeding protected results back into the same research loop.
5. [Strategy Governance](./strategy-governance/) owns deployment decisions, lifecycle state, and capital policy.
6. [Runtime](./runtime/) runs activated strategy instances and is the only normal writer of trade intent.
7. [Risk](./risk/) returns a terminal decision; only new risk creates a one-use reservation, while ordinary risk reduction does not.
8. [Execution](./execution/) exclusively owns orders, external effects, venue readback, and reconciliation.
9. [Portfolio](./portfolio/) projects account, exposure, performance, and capacity facts from execution and valuation inputs.

## System invariants

- One mutable business fact has one authoritative owner.
- R&D and Qualification are one-way at the protected boundary: protected results cannot tune the submitted candidate, and Backtest produces evidence without owning R&D decisions.
- Paper and live trading share Runtime, Risk, and Execution semantics; only the Execution Adapter changes.
- Normal new-risk commands bind the same Risk Decision and Reservation. Normal reducing commands bind an explicit reducing decision and adapter admission without a Reservation. Recovery uses the complete active fence set.
- Agent discovery is read-only. Ordinary data queries need no Research Project; stateful signal inspection reuses native replay. R&D may retain research records. Discovery grants no activation authority; Governance independently evaluates frozen lifecycle conditions.
- Event Rail carries wake-up hints for already committed facts; it is not an approval, retry, recovery, or terminal-state authority.
- Recovery permits only fenced cancel, reduce, flatten, and readback actions. New risk remains blocked until `RecoveryCase.KNOWN_CLOSED`, after which Governance may authorize a new generation and Runtime must separately prove `APPLIED`.

## Compatibility references

[Scanner boundary](./scanner/) retains sealed protocol and refusal meanings; on-demand discovery reuses existing services.
