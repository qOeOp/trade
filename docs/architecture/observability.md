# Observability

## Responsibility

Observability is a non-authoritative operational boundary for traces, metrics, logs, global status projections, and alert routing. It makes the whole system diagnosable without becoming another writer for research, qualification, lifecycle, account, order, risk, or recovery facts.

Its visible modules are Telemetry Gateway, Status Projection, Alert Routing, and Dashboard API. Telegram is the default Alert Routing adapter, not a top-level authority.

## Two separate signal lanes

Committed domain events and runtime telemetry do not share authority semantics.

- **Committed domain events** originate only after the native Owner commits its fact and an outbox entry in the same transaction. Event Rail provides at-least-once wake delivery; consumers deduplicate by stable event identity and then read the source Owner fact.
- **Trace, metric, and log signals** use OTLP through the Telemetry Gateway. Collection is pluggable, versioned, independently enabled or disabled, sampled, cardinality-bounded, and redacted. Losing telemetry may reduce visibility but cannot change native Owner correctness or business state.

Commands and uncommitted requests remain on Owner ports. Event Rail is not a command bus, and the Telemetry Gateway is not a business workflow engine.

## Canonical envelope and trace context

Every accepted record binds schema version, signal kind, source Owner and node, event or observation identity, correlation and causation identities, idempotency key, trace/span/parent-span identities, all applicable strategy/generation/artifact/TrialFamily/account/scope/mode namespaces, four relevant times plus clock epoch, bounded outcome/error category, payload digest/reference, redaction class, and collection-policy version.

Committed events additionally bind the exact immutable Owner fact reference and content digest. Trace context is correlation metadata only: it carries no credential, protected Qualification evidence, principal authority, or effect permission.

## Persistence model

Physical infrastructure may be shared, but logical schemas, write credentials, retention, and deletion stay partitioned by authority and disclosure class.

| Logical store                                                         | Writer                                    | Purpose                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Owner fact store                                                      | native Owner only                         | immutable or versioned business facts and native receipts                            |
| Owner outbox                                                          | native Owner in the same fact transaction | fact identity, event type, sequence, payload digest, publication state               |
| telemetry record / trace span / log record / metric sample and rollup | Observability custody                     | redacted operational signals with bounded retention                                  |
| owner health / strategy lifecycle / research funnel projections       | Status Projection                         | rebuildable views with source frontier, freshness, completeness, lag, and checkpoint |
| quarantine and dead letter                                            | Observability custody                     | invalid, unknown, or exhausted delivery identities without secret payloads           |
| alert delivery                                                        | Alert Routing                             | delivered, suppressed, failed, or unknown adapter disposition                        |

Large payloads remain in a content-addressed object store behind digest references and disclosure policy. Dashboard records never become the only copy of a business fact.

## Global Status View

Dashboard API exposes a bounded read-only Global Status View. It may summarize R&D source use and iteration
history, Backtest runs under their disclosure class, Qualification outcomes, Market Data freshness, Scanner
proposals, active generations, Runtime uptime and incidents, Risk reservations/fences, Execution
orders/fills/unknown effects, and Portfolio exposure/performance/capacity. Exploratory Backtest projections may
include their diagnostic category set. Protected projections may include only the public terminal outcome
`CLOSED_NOT_QUALIFIED` or `QUALIFIED`, a type-opaque non-dereferenceable result reference, and source-frontier
freshness. Protected phase, latency, terminal timing, and timing-derived fields are forbidden. Internal replay,
diagnostic, assessment, and ineligibility dispositions and every
category- or reason-derived aggregate remain indistinguishable and Qualification-only. Specifically,
`REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and
`INELIGIBLE` all project byte-equivalently as `CLOSED_NOT_QUALIFIED`; `QUALIFIED` remains exact. Event Rail never
publishes an internal `INELIGIBLE` or other protected-terminal event.

Every field cites its source Owner facts or telemetry frontier and exposes `observed-at`, `valid-through`, completeness, lag, and rebuild state. `STALE`, `PARTIAL`, `REBUILDING`, and `UNAVAILABLE` remain visible; they cannot render as healthy or complete. A Dashboard click that requests a mutation starts a separately admitted Product Edge → Owner request and never writes through the view.

Displaying a Product Edge journey does not make Observability the product-closure owner. It may annotate a
Research stage, run progress, or failure diagnosis, but it cannot store the authoritative workflow stage, create
an Iteration Decision, advance Qualification, select a successor, or infer completion from telemetry. Product
closure remains the composition of native Owner requests, receipts, and bounded projections.

## Alert routing

Alert Routing consumes bounded Event Wakes or policy-admitted health conditions and sends them to Telegram or another replaceable adapter. It owns delivery preferences, attempts, and receipts only. Delivery success, silence, duplication, or failure never proves a source transition, clears a fence, retries an unknown order effect, resumes a strategy, or declares `KNOWN_CLOSED`.

## Implementation acceptance

- Observability can be disabled, degraded, restarted, or replaced without changing Owner transitions.
- Source facts and outbox entries commit atomically; no uncommitted telemetry creates a domain event.
- Event delivery is at least once and projection consumers are idempotent; the architecture makes no exactly-once claim.
- Invalid schema, changed content under one identity, protected detail, secrets, or unbounded cardinality are rejected or quarantined before export.
- Projection rebuild preserves exact source frontiers and cannot mutate or acknowledge the facts it reads.
- No protected Backtest category, internal terminal disposition, or negative reason may label, group, filter,
  count, alert, score health, or enter a research-funnel projection. The six negative terminals
  `REPLAY_REJECTED`, `REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and
  `INELIGIBLE` map identically to `CLOSED_NOT_QUALIFIED`; `QUALIFIED` stays exact, while exploratory categories
  remain observable under the bounded policy.
- Dashboard and alert adapters remain read-only until a separate governed Owner request is admitted.
