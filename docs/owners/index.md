# Owner contracts

This directory defines the product-level authority boundaries projected by the global architecture Flow. It is intentionally above classes, APIs, processes, and storage choices. A future implementation may change those details, but it must preserve these owners, facts, handoffs, and prohibitions unless the architecture contract is revised first.

The overview contains thirteen Bento groups: ten business owners plus Product Edge, Strategy Factory, and Observability. Event Rail is a separate channel node, not an authority. R&D contains both Research and Develop capabilities; each group remains below the five-module ceiling.

## Lifecycle

1. [Market Data](./market-data/) supplies point-in-time market and instrument facts.
2. [R&D](./rd/) turns sourced hypotheses into frozen intents, builds immutable strategy artifacts, and supports bounded attended D-only repairs.
3. [Backtest](./backtest/) produces canonical replay evidence for exploration or protected evaluation.
4. [Qualification](./qualification/) independently admits or revokes deployability without feeding protected results back into the same research loop.
5. [Strategy Governance](./strategy-governance/) owns deployment decisions, lifecycle state, and capital policy.
6. [Scanner](./scanner/) periodically matches governed strategies to current conditions and submits proposals; it never starts a strategy.
7. [Runtime](./runtime/) runs activated strategy instances and is the only normal writer of trade intent.
8. [Risk](./risk/) independently returns a terminal decision and one-use reservation for every intent.
9. [Execution](./execution/) exclusively owns orders, external effects, venue readback, and reconciliation.
10. [Portfolio](./portfolio/) projects account, exposure, performance, and capacity facts from execution and valuation inputs.

## System invariants

- One mutable business fact has one authoritative owner.
- R&D and Qualification are one-way at the protected boundary: protected results cannot tune the submitted candidate, and Backtest produces evidence without owning R&D decisions.
- Paper and live trading share Runtime, Risk, and Execution semantics; only the Execution Adapter changes.
- Runtime may command Execution only with the same Risk Decision and Reservation that authorized the intent.
- Scanner proposes to Governance and never activates Runtime directly.
- Event Rail carries wake-up hints for already committed facts; it is not an approval, retry, recovery, or terminal-state authority.
- Recovery permits only fenced cancel, reduce, flatten, and readback actions. New risk remains blocked until `RecoveryCase.KNOWN_CLOSED`, after which Governance may authorize a new generation and Runtime must separately prove `APPLIED`.
