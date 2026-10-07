# Observability Playbook

## Goal

This playbook covers observability integration for Owners and nodes. See the [Observability architecture](../architecture/observability/) for independence from vendors, transports, storage and Dashboard.

The rule is simple: Owners persist business facts; Observability persists operational copies and projections. If Observability disappears, Owner correctness and Recovery obligations remain unchanged.

## Minimal integration

1. Reuse native and container logs, identify the actual task or run, and retain errors and terminal states. The user later inspects, repairs and deploys.
2. Dashboard reads admitted owning-service facts and reports unknown, stale or unavailable states. Logs do not prove business completion.
3. Add an existing collector or replaceable adapter only for concrete centralized tracing, aggregation or notification needs. Define fields, redaction and retention for the actual consumer.
4. Committed events used for cross-service wakeups remain atomically retained with their source fact and deduplicated by stable identity. Notification delivery does not prove a business transition.

No span, timing metric, full telemetry table set or projection is required for every operation. Secrets and protected Qualification evidence stay out of logs, labels, notifications and shared traces. Disabled observation cannot change business state or recovery obligations.

## Owner persistence and Dashboard matrix

| Owner               | Authoritative records                                                           | Dashboard projections                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R&D                 | Research Project, native strategy package, registered experiments and knowledge | input and result references, Agent explanations, errors and conclusions                                                                                                                                     |
| Backtest            | replay request, exploratory/protected result and diagnosis                      | exploratory run purpose, terminal, duration, costs, capacity, and diagnostic distribution; protected public terminal outcome, type‑opaque non‑dereferenceable reference, and source‑frontier freshness only |
| Qualification       | intake, protected assessment, attempt disposition, Eligibility                  | attempts by public terminal outcome only: `QUALIFIED`/`CLOSED_NOT_QUALIFIED`/expiry/revocation                                                                                                              |
| Market Data         | source binding, PIT snapshot, stream, correction and valuation facts            | source freshness, gaps, corrections, rights/semantics rejections, provider latency                                                                                                                          |
| Strategy Governance | registry, lifecycle, allocation and authorized generation decision              | current deployed generations, start/stop time, active duration, pause/retire/resume and capital changes                                                                                                     |
| Runtime             | application, readiness, checkpoint and incident facts                           | current applied generation, uptime/downtime, restarts, incidents and use duration                                                                                                                           |
| Risk                | decision/reservation, aggregate commitment, fence and closure                   | allow/reject/decrease‑only, reservation latency, liabilities, fences and duration                                                                                                                           |
| Execution           | journal, command, order/fill/readback, account and Recovery facts               | attempts, orders, fills, adapter latency, unknown effects, drift and recovery duration                                                                                                                      |
| Portfolio           | performance, exposure, capacity, interaction and lifecycle evidence             | PnL/drawdown, exposure, capacity, interaction degradation and evidence freshness                                                                                                                            |

Counts are derived from immutable identities and explicit states, never incremented as an unrelated mutable counter. For example, strategy-use count derives from distinct applied-generation or invocation facts; downtime derives from paired readiness/incident intervals under one clock epoch.

Backtest disclosure is asymmetric by design. Exploratory projections may expose their diagnostic category set.
Protected projections may expose the public terminal outcome `CLOSED_NOT_QUALIFIED` or `QUALIFIED`, a
type-opaque non-dereferenceable result reference, and source-frontier freshness only. Protected phase, run
latency, terminal timing, and timing-derived fields are forbidden. Never group, filter, label, count, alert,
derive a health score, or populate a research funnel from a protected diagnostic category, internal terminal
disposition, or negative reason.

All negative terminals share the same public outcome and aggregate labels: `REPLAY_REJECTED`,
`REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and
`INELIGIBLE` are byte-equivalently `CLOSED_NOT_QUALIFIED`, while `QUALIFIED` remains exact.
Notifications never emit an internal `INELIGIBLE` or another protected-terminal event, so protected
failures remain indistinguishable outside Qualification.

## Storage boundaries

Owning services persist tasks, results, errors and runtime facts. Existing log infrastructure retains runtime logs under access and retention policies. Do not prescribe telemetry tables, research funnels or lifecycle mirror databases. A needed admitted read-view cache cites source references and freshness, remains rebuildable and cannot replace or modify source facts. Read large results by exact owning-service references rather than copying them into logs.

## Middleware and failure semantics

Use a transactional outbox or equivalent atomic source-fact publication boundary. Event delivery is at least once. Projection consumers must be idempotent, detect changed content under a reused identity, maintain checkpoints, and quarantine poison records. Backpressure is bounded; overload may defer/drop telemetry according to policy but may not silently drop admitted business facts or Recovery obligations.

OTLP receivers, processors, and exporters are replaceable. A collector may batch, retry, sample, redact, and fan out, but it never reads secrets into exported attributes and never calls Owner write APIs. Alert adapters subscribe to bounded projections or committed-event hints and remain outside the correctness path.

## Acceptance for integrated capabilities

Verify capabilities actually integrated; do not build a collector, projection or alert system merely to run its tests. Secret/protected isolation, source-fact authority and independence from telemetry always apply.

- Disable the collector and prove native Owner scenarios still reach the same authoritative terminal states.
- Crash between fact and publication and prove the co-committed outbox eventually republishes without duplicating the fact.
- Replay one event twice and prove one projection result; reuse the identity with changed content and prove quarantine.
- Drop, delay, and reorder telemetry and prove Dashboard marks incomplete or stale instead of inventing health.
- Rebuild every projection from its cited source frontier and compare the resulting digest.
- Inject secrets, protected detail, oversized payloads, and high-cardinality labels and prove rejection before export.
- Verify exploratory diagnostic aggregates remain available while protected category labels and every
  category-derived aggregate are rejected or absent from Dashboard, metrics, alerts, and research funnels.
- Click a Dashboard action and prove it becomes a new governed Product Edge request rather than a projection write.
