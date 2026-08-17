# Observability Playbook

## Goal

This playbook turns one Owner or node into a diagnosable participant without coupling it to one vendor, broker, database, or Dashboard. It applies to R&D, Market Data, Backtest, Qualification, Scanner, Strategy Governance, Runtime, Risk, Execution, and Portfolio.

The rule is simple: Owners persist business facts; Observability persists operational copies and projections. If Observability disappears, Owner correctness and Recovery obligations remain unchanged.

## Admission sequence

1. Identify the native Owner fact, command, or nonterminal operation being observed.
2. Choose `COMMITTED_DOMAIN_EVENT` only for a committed fact; otherwise choose `TRACE`, `METRIC`, or `LOG`.
3. Bind the canonical envelope and W3C-compatible trace context at the process boundary.
4. Validate collection-policy version, source scope, cardinality budget, redaction class, and retention.
5. Co-commit a domain outbox entry with its source fact, or emit telemetry to the local OTLP endpoint.
6. Let the gateway validate, redact, sample, batch, and export without holding the Owner transaction open.
7. Project idempotently from stable identities and persist a checkpoint with source frontier and lag.
8. Expose stale, partial, rebuilding, quarantined, or unavailable state honestly in Dashboard and alerts.

## Minimum instrumentation per Owner node

Every admitted operation creates one root span or joins an incoming trace, uses stable correlation and causation identities, records queue/admission/processing/result timing, and emits a bounded terminal outcome or explicit unknown. Metrics must have a named unit, aggregation, window, and finite label set. Logs are structured records, not free-text business databases.

Never place API keys, opaque credential values, protected Qualification evidence, raw prompts/source bodies, account secrets, or unrestricted order payloads in trace attributes, metric labels, logs, Event Rail, or alert messages.

## Owner persistence and Dashboard matrix

| Owner               | Authoritative records                                                 | Dashboard projections                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R&D                 | source provenance, Research Intent, Artifact, iteration and selection | sources consumed, hypotheses, development attempts, failure reasons, iterations to selected version, D-only repair history                                                                                  |
| Backtest            | replay request, exploratory/protected result and diagnosis            | exploratory run purpose, terminal, duration, costs, capacity, and diagnostic distribution; protected public terminal outcome, type-opaque non-dereferenceable reference, and source-frontier freshness only |
| Qualification       | intake, protected assessment, attempt disposition, Eligibility        | attempts by public terminal outcome only: `QUALIFIED`/`CLOSED_NOT_QUALIFIED`/expiry/revocation                                                                                                              |
| Market Data         | source binding, PIT snapshot, stream, correction and valuation facts  | source freshness, gaps, corrections, rights/semantics rejections, provider latency                                                                                                                          |
| Scanner             | due-slot attempt, per-strategy disposition, receipt, proposal         | scheduled attempts, candidates scanned, matched/failed, proposals, latency                                                                                                                                  |
| Strategy Governance | registry, lifecycle, allocation and authorized generation decision    | current deployed generations, start/stop time, active duration, pause/retire/resume and capital changes                                                                                                     |
| Runtime             | application, readiness, checkpoint and incident facts                 | current applied generation, uptime/downtime, restarts, incidents and use duration                                                                                                                           |
| Risk                | decision/reservation, aggregate commitment, fence and closure         | allow/reject/decrease-only, reservation latency, liabilities, fences and duration                                                                                                                           |
| Execution           | journal, command, order/fill/readback, account and Recovery facts     | attempts, orders, fills, adapter latency, unknown effects, drift and recovery duration                                                                                                                      |
| Portfolio           | performance, exposure, capacity, interaction and lifecycle evidence   | PnL/drawdown, exposure, capacity, interaction degradation and evidence freshness                                                                                                                            |

Counts are derived from immutable identities and explicit states, never incremented as an unrelated mutable counter. For example, strategy-use count derives from distinct applied-generation or invocation facts; downtime derives from paired readiness/incident intervals under one clock epoch.

Backtest disclosure is asymmetric by design. Exploratory projections may expose their diagnostic category set.
Protected projections may expose the public terminal outcome `CLOSED_NOT_QUALIFIED` or `QUALIFIED`, a type-opaque
non-dereferenceable result reference, and source-frontier freshness only. Protected phase, run latency, terminal
timing, and timing-derived fields are forbidden. Never group,
filter, label, count, alert, derive a health score, or populate a research funnel from a protected diagnostic category,
internal terminal disposition, or negative reason. All negative terminals share the same public outcome and aggregate
labels: `REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`,
`ASSESSMENT_INVALID`, and `INELIGIBLE` are byte-equivalently `CLOSED_NOT_QUALIFIED`, while `QUALIFIED` remains
exact. Event Rail never emits an internal `INELIGIBLE` or another protected-terminal event, so protected failures
remain indistinguishable outside Qualification.

## Logical data model

- Owner stores remain separated by native write authority. Each Owner owns its fact tables and a co-transactional `owner_outbox`.
- `telemetry_event`, `trace_span`, `log_record`, `metric_sample`, and `metric_rollup` are operational stores with policy-bound retention.
- `owner_health_snapshot`, `strategy_lifecycle_projection`, and `research_funnel_projection` are rebuildable read models.
- `projection_checkpoint` binds consumer, partition, source frontier, schema version, observed time, lag, and rebuild generation.
- `quarantine_record` stores identity, bounded reason, source reference, and retry disposition without unsafe payloads.
- `alert_delivery` stores adapter attempt and delivery disposition only.

The contract intentionally does not select PostgreSQL, ClickHouse, Kafka, NATS, OpenTelemetry backend, or a frontend framework. A first implementation may use one physical database and one collector, provided schemas and write credentials preserve the logical boundaries.

## Middleware and failure semantics

Use a transactional outbox or equivalent atomic source-fact publication boundary. Event delivery is at least once. Projection consumers must be idempotent, detect changed content under a reused identity, maintain checkpoints, and quarantine poison records. Backpressure is bounded; overload may defer/drop telemetry according to policy but may not silently drop admitted business facts or Recovery obligations.

OTLP receivers, processors, and exporters are replaceable. A collector may batch, retry, sample, redact, and fan out, but it never reads secrets into exported attributes and never calls Owner write APIs. Alert adapters subscribe to bounded projections or Event Wakes and remain outside the correctness path.

## Acceptance tests

- Disable the collector and prove native Owner scenarios still reach the same authoritative terminal states.
- Crash between fact and publication and prove the co-committed outbox eventually republishes without duplicating the fact.
- Replay one event twice and prove one projection result; reuse the identity with changed content and prove quarantine.
- Drop, delay, and reorder telemetry and prove Dashboard marks incomplete or stale instead of inventing health.
- Rebuild every projection from its cited source frontier and compare the resulting digest.
- Inject secrets, protected detail, oversized payloads, and high-cardinality labels and prove rejection before export.
- Verify exploratory diagnostic aggregates remain available while protected category labels and every
  category-derived aggregate are rejected or absent from Dashboard, metrics, alerts, and research funnels.
- Click a Dashboard action and prove it becomes a new governed Product Edge request rather than a projection write.
