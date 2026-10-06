# On-demand market scan scenario

Users or external Agents query current instruments, market values or strategy signals. Agents choose filters and
interpret results; the product supplies existing data queries and native replay, without another scan department,
scheduler or observation engine. Running strategies consume native live data continuously without scan wakeups.

## Ordinary queries

For example, "which perpetual contracts have volume above this threshold": Agents call Market Data instrument,
snapshot and supported filter operations directly, binding market scope, data type and evaluation time without a
Strategy Artifact or research project. Host tools may analyze permitted responses further. Return actual data cuts,
coverage, completed items and named gaps; unsupported rules cannot be replaced with invented metrics or filters.

## Stateful strategy observation

For example, "which instruments remain in R-1's waiting-for-entry state under its historical rules":

1. The Agent selects a sealed native Strategy Artifact, instruments, input prefix, evaluation time and resource bound. Undeployed or unqualified versions may be observed.
2. Market Data prepares and binds warmup/evaluation inputs, retaining per-instrument coverage and gaps.
3. Backtest reuses native replay to reconstruct simulated state and return signals, without real trading credentials or access to mutable running-instance state.
4. The Agent reads and interprets results. R&D retains experiments, references and findings when research needs them, without a separate observation Host.

Path-dependent signals require a complete input prefix and exact rule version; a current snapshot cannot pretend
to reconstruct historical state. Simulated state, orders and positions are not real account state, and research
signals grant neither qualification nor deployment authority.

## Completion, recovery and boundaries

- The executing data/replay service owns its jobs. Resolve asynchronous work by original stable identity after disconnection; do not blindly create duplicates or release commitments.
- Return evaluation time, input versions, universe and completed coverage. Empty results, partial gaps, stale data and unknown execution are distinct.
- Preserve per-instrument failures and never present partial coverage as completed whole-market evaluation. Unexecuted work cannot prove no opportunities.
- Apply the same protected-read, budget and trial-exposure rules as other entrances. Observation produces no real orders, activation or account writes.
- Agent host timers own wakeup; the product adds no scheduled scan or deployment proposal.

## Implementation and acceptance

Ordinary-query acceptance proves data cuts, filters, gaps and permissions. Stateful observation proves native
replay inputs, reconstructed state, signals, asynchronous recovery and real-effect isolation. Reuse service ports
and close concrete story gaps without another discovery engine. Responsibilities are in
[R&D](../owners/rd/#on-demand-read-only-opportunity-discovery), [Market Data](../owners/market-data/) and
[Backtest](../owners/backtest/).
