# Product loop

## Product purpose and scope

The product turns sourced market hypotheses into reproducible strategies, portfolio backtest evidence and research
decisions, with continuous facts for independent qualification, record-only forward evaluation and governed
strategy lifecycles. It supports perpetuals, spot data/backtests and spot/perpetual two-leg research. The first
end-to-end acceptance is the Binance USDT perpetual R-1 resting-entry/staged-exit story. Spot, multi-leg and dynamic
portfolio capabilities remain development targets until their individual admission and integration.

Independent domain MCPs expose the services. The user chooses an external agent such as Codex or Claude; data and
backtest extend native Nautilus, R&D manages research, and the custom Dashboard views and controls the same facts.
Each service durably owns its deterministic jobs. A host timer wakes the external agent for model-based research
decisions. A disconnected conversation or MCP session loses neither jobs nor results.

## Agent-outside R&D experience

The user supplies the theme, risk tolerance, data scope, resource-spend ceiling and stop boundaries. Before running,
the agent registers comparisons, baselines, return units, horizon, costs and risk constraints. It may propose new
hypotheses and mechanism families and iterate inside those frozen bounds. Portfolio return and drawdown determine
continuation; entry advantage, randomized entries and individual-strategy comparisons diagnose causes. Every trial
enters the anti-overfitting ledger; trial counts do not replace spend limits.

The product and agent host independently bound and report resource use; unreadable model consumption is unavailable.
The agent may repair deviations from frozen rules while retaining repair lineage and affected results. Changing
passing criteria, statistical protocol, risk tolerance or scope requires user confirmation and a new frozen version.
The product makes no model call. The agent submits versioned JSON authoring documents; R&D validates and seals
immutable Artifacts. The agent cannot edit business facts.

## From source to research decision

| Stage                 | User or agent action                                                                 | Product result and responsibility                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Define the question   | Submit source, mechanism, alternatives and falsifiable prediction                    | R&D admits source, freezes Research Intent and permanent trial lineage                                            |
| Prepare data          | Declare market, time, signal timeframes and warm‑up                                  | Market Data supplies PIT coverage, versions and named gaps; services own preparation jobs                         |
| Author strategy       | Submit JSON signal rules, sizing configuration and execution policy                  | R&D compiles BFP and seals Artifact, dependencies and complete meaning                                            |
| Explore               | Submit bounded backtest and query identities                                         | Backend completes internal composition; native Backtest produces orders, fills, portfolio results and diagnostics |
| Diagnose and iterate  | Compare frozen objectives and choose a legal next action                             | R&D commits repair, successor experiment, stop or selection; an unknown run produces no economic judgment         |
| Qualify independently | Submit selected, frozen candidate                                                    | Qualification consumes the preregistered protected protocol and returns only bounded public conclusions           |
| Record forward        | Query continuous simulation under the same execution semantics                       | Qualification owns registration/decision; Backtest preserves simulated orders, positions and costs across cuts    |
| Govern lifecycle      | Request deployment or de‑risking within qualification, capital and permission bounds | Governance authorizes; Runtime independently proves application; trading paths require separate admission         |

One `backtest.run` completes validation, research binding, dataset resolution, Artifact and replay composition inside
the backend. The agent does not assemble internal receipts, move market rows or drive each Owner step. Requests,
jobs, results and legal actions are addressable by stable identities. Same-identity/same-meaning recovery rejoins
original results; changed meaning creates a successor or conflict, never overwrites old records. See
[Product Edge](../architecture/product-edge/) and [research design](../scenarios/research/).

## Qualification and forward evidence

Exploration is not qualification. Qualification independently consumes the whole frozen candidate, trial family,
costs, capacity, embargo, budget and holdout rules. Internally it may distinguish pass, equivalence failure and
insufficient evidence; research sees only `QUALIFIED` or `CLOSED_NOT_QUALIFIED`, and cannot close a mechanism solely
from a public nonqualified result. Protected numbers, reasons and categories do not return to research. New
families, charts or direct MCP calls do not bypass reads or trial accounting.

Record-only forward is a target: before its first cut, freeze interim/decision dates, elimination/admission lines,
sequential-test parameters and derivations. Backtest uses the same qualified Artifact, orders, cadence, costs,
slippage and capacity model, carrying simulated state across cuts. It touches no Runtime instance, venue adapter,
credential or money. Report every candidate and revoke qualification on elimination. A positive Forward Decision
allows proposing paper activation; it replaces none of the other activation authorities.

## Trading control and recovery

The trading target uses one native in-process node per Capacity Scope, assembling `LiveNode`, `RiskEngine`,
`ExecutionEngine` and a thin product trust layer. Signals and protection rules belong to the strategy; sizing
configuration computes requested quantity; Risk decides capacity/admission; Execution owns orders, fills and venue
reconciliation. No second order book or account engine replaces native cache. Portfolio provides versioned
measurement and attribution.

Governance owns generation authorization, capital envelopes and lifecycle. Only an `APPLIED` receipt proves Runtime
application. Active-generation renewal requires fresh eligibility, performance, exposure and degradation evidence;
missing evidence stops new risk while preserving the decrease-only safety path. Scanner periodically evaluates
deployment conditions and proposes to Governance, isolates individual-strategy gaps and never starts Runtime.
Host research wake-ups and service-owned Scanner/forward jobs are separate responsibilities; Dashboard owns no
business state machine.

Unknown effects permit no blind resubmit, commitment release or failure claim. Runtime readiness, incidents,
reconciliation drift and Risk hard stops enter recovery through their authoritative facts. Execution cancels,
reduces, flattens and reads back only within the intersection allowed by the complete active fence set. Only the
Reconciler writes `KNOWN_CLOSED` once venue facts, Risk settlement and Portfolio projections agree; closure restores
no old trading authority. [Architecture rules](./architecture-rules/) and Owner chapters define the complete
identity, authorization, decrease-only and recovery contracts. Research, forward evidence and documentation admit
no Paper, Live or real-money effect.

## User interface and service acceptance

The custom Dashboard presents Sources, Research, Hypotheses, Artifacts, Backtests, Qualification, Scanner, Runtime
and Operations under the same identities, unresolved reasons and allowed actions. Logs, charts, operational success
and agent explanation create no research decision, qualification or deployment fact. Changes submit successor JSON,
never edit an Artifact in place. Implement only routes and atoms admitted by [Dashboard](./dashboard/).

MCP research journeys have independent acceptance; Dashboard routes separately prove browser behavior. Existing
domain tools, narrow authoring and replay custody wiring do not establish complete R-1, research MCP, recursive
local refinement, report delivery or production deployment. [Agent implementation](./agent-implementation/) names
current gaps and consumers. Acceptance requires positive results, named refusals, unknown-state preservation,
same-identity recovery and isolation; a handshake, build, local test or target diagram is not product delivery.
