# VibeTrading product design

VibeTrading serves people conducting quantitative research with an external AI agent. The user supplies a market
question, risk tolerance and resource boundaries. Through MCP, the agent uses data, strategy authoring, backtest
and research services to produce reproducible strategies, portfolio evidence and explicit next decisions.

Data and backtest extend this repository's Nautilus foundation. The custom R&D service manages research. The
custom Dashboard views and controls the same facts. The product runs no research model, does not require a
conversation to drive internal steps, and does not treat exploration as trading permission.

## Design chapters

| Chapter                               | Content                                                                             | Canonical body                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Product and user journey              | User inputs, agent autonomy, research, qualification and lifecycle                  | [Product loop](./product-loop/)                                      |
| Service architecture                  | Domain MCPs, internal calls, native extensions and unique facts                     | [Architecture](../architecture/)                                     |
| Product interface                     | Requests, jobs, status, results, credentials and Dashboard channels                 | [Product Edge](../architecture/product-edge/)                        |
| Strategy representation and execution | JSON authoring, BFP, Artifacts, shared execution and data dependencies              | [Strategy Factory](../architecture/strategy-factory/)                |
| Research requirements and acceptance  | R‑1 orders/staged exits, portfolio capital, dynamic universe and execution fidelity | [Research design](../scenarios/research/)                            |
| Responsibilities and invariants       | Research, data, backtest, qualification and trading‑control authority               | [Architecture rules](./architecture-rules/) and [Owners](../owners/) |
| User interface                        | Routes, components, interaction, states and implementation admission                | [Dashboard](./dashboard/)                                            |
| Development and acceptance            | Current capabilities, dependencies, native reuse and bounded tasks                  | [Agent implementation](./agent-implementation/)                      |

## Using this design

Read the user behavior first, then the responsible service's contract. Entry chapters do not define a second
schema or refusal policy. Target capabilities describe the complete product; `CURRENT/PARTIAL` identifies existing
integration, `TARGET` identifies development work, and `NOT_ADMITTED` identifies missing implementation or effect
admission. A target is not a claim of callable capability.

The design is revisable. When measurements or a user decision change it, update the responsible chapter and its
direct consumers and remove superseded descriptions. Do not append competing rules for readers to reconcile.
Immutable business records and version compatibility retain their contractual meanings.

## Setup and operation

[Installation](./install/) prepares the local environment; [Quickstart](./quickstart/) describes safe research.
[Source intake](./source-intake/), [market-data intake](./market-data-intake/) and
[observability](./observability/) define their boundaries. [Development chunks](./development-chunk-contract/)
implement individual features; [design evidence](./design-evidence/) explains key design grounds. They are parts of
this same current design. [User scenarios](../scenarios/) organize its acceptance journeys.
