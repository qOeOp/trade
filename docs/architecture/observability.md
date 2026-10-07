# Observability

## Responsibility

Observability is a non-authoritative operational boundary for traces, metrics, logs, global status projections, and alert routing. It makes the whole system diagnosable without becoming another writer for research, qualification, lifecycle, account, order, risk, or recovery facts.

Start with Nautilus/service logs, container logs and task terminal states. Preserve actionable errors for the user to inspect, repair and deploy. Dashboard reads admitted facts from owning services. No dedicated telemetry gateway, global status database or alert system is a prerequisite. Add an existing collector, bounded projection or notification adapter only for a concrete tracing, aggregation or notification need; these are infrastructure capabilities, not business departments.

## Two separate signal lanes

Committed domain events and runtime telemetry do not share authority semantics.

- **Committed domain events** originate only after the native Owner commits its fact and an outbox entry in the same transaction. The source service retains its outbox and publication progress, using native messaging extension points or existing transport for at-least-once notifications; consumers deduplicate by stable event identity and then read the source Owner fact.
- **Trace, metric, and log signals** use native records first, with OTLP to an existing collector when centralized collection is needed. Collection is pluggable, versioned, independently enabled or disabled, sampled, cardinality-bounded, and redacted. Losing telemetry may reduce visibility but cannot change native Owner correctness or business state.

Commands and uncommitted requests remain on Owner ports. Notifications announce fact changes; they do not issue business commands. Native in-process MessageBus delivery is not durable cross-service delivery. When the latter is needed, the source service resumes outbox publication without a separate notification service.

## Canonical envelope and trace context

Structured cross-service observation interfaces bind the fields required by their actual consumer contract: schema version, signal kind, source Owner and node, event or observation identity, correlation and causation identities, idempotency key, trace/span/parent-span identities, all applicable strategy/generation/artifact/TrialFamily/account/scope/mode namespaces, four relevant times plus clock epoch, bounded outcome/error category, payload digest/reference, redaction class, and collection-policy version.

Committed events additionally bind the exact immutable Owner fact reference and content digest. Trace context is correlation metadata only: it carries no credential, protected Qualification evidence, principal authority, or effect permission.

## Persistence model

Ordinary logs need no unrelated account, strategy, clock or span fields and no business receipt per log. State and permission consumers still resolve owning-service facts.

The table assigns authority when a capability is needed; it requires neither every table nor separate deployments. Existing runtime infrastructure keeps logs. Projection/notification storage is added only for an admitted consumer. Physical infrastructure may be shared while write credentials, retention and deletion remain partitioned by authority and disclosure class.

| Logical store                                                         | Writer                                    | Purpose                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Owner fact store                                                      | native Owner only                         | immutable or versioned business facts and native receipts                            |
| Owner outbox                                                          | native Owner in the same fact transaction | fact identity, event type, sequence, payload digest, publication state               |
| telemetry record / trace span / log record / metric sample and rollup | Observability custody                     | redacted operational signals with bounded retention                                  |
| owner health / strategy lifecycle / research funnel projections       | Status Projection                         | rebuildable views with source frontier, freshness, completeness, lag, and checkpoint |
| quarantine and dead letter                                            | Observability custody                     | invalid, unknown, or exhausted delivery identities without secret payloads           |
| alert delivery                                                        | Alert Routing                             | delivered, suppressed, failed, or unknown adapter disposition                        |

Owning services retain necessary large business results behind exact references. Logs do not copy business payloads or require a new diagnostic object store. Dashboard records never become the only copy of a business fact.

## Global Status View

Dashboard API exposes a bounded read-only Global Status View. It may summarize R&D source use and iteration
history, Backtest runs under their disclosure class, Qualification outcomes, Market Data freshness, R&D
observation coverage/results, legacy Scanner receipts, active generations, Runtime uptime and incidents, Risk
reservations/fences, Execution orders/fills/unknown effects, and Portfolio exposure/performance/capacity.
Exploratory Backtest projections may include their diagnostic category set. Protected projections may include
only the public terminal outcome `CLOSED_NOT_QUALIFIED` or `QUALIFIED`, a type-opaque
non-dereferenceable result reference, and source-frontier freshness.

Protected phase, latency, terminal timing, and timing-derived fields are forbidden. Internal replay,
diagnostic, assessment, and ineligibility dispositions and every category- or reason-derived aggregate remain
indistinguishable and Qualification-only. Specifically, `REPLAY_REJECTED`, `REPLAY_INVALID`,
`DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and `INELIGIBLE` all project
byte-equivalently as `CLOSED_NOT_QUALIFIED`; `QUALIFIED` remains exact. Notifications never publish an
internal `INELIGIBLE` or other protected-terminal event.

Every field cites its source Owner facts or telemetry frontier and exposes `observed-at`, `valid-through`, completeness, lag, and rebuild state. `STALE`, `PARTIAL`, `REBUILDING`, and `UNAVAILABLE` remain visible; they cannot render as healthy or complete. A Dashboard click that requests a mutation starts a separately admitted Product Edge → Owner request and never writes through the view.

Displaying a Product Edge journey does not make Observability the product-closure owner. It may annotate a
Research stage, run progress, or failure diagnosis, but it cannot store the authoritative workflow stage, create
an Iteration Decision, advance Qualification, select a successor, or infer completion from telemetry. Product
closure remains the composition of native Owner requests, receipts, and bounded projections.

## Committed notifications

Notifications carry stable identity, source Owner, committed fact reference and required ordering. A wake prompts Governance to read Qualification, Runtime or Execution directly; silence cannot imply no incident or completed recovery. Notification and alert retries resend the same hint without replaying business writes. Lost notifications cannot change Owner state. Alert delivery receipts are outputs, never source events or business facts.

Qualification notifications contain only public attempt correlation, public state, effective cut, sequence and a type-opaque non-dereferenceable reference. Negative outcomes with equal public inputs are indistinguishable in event presence and those fields; consumers deduplicate on these public fields. Protected metrics, internal categories, terminal timing and derived information never enter notifications.

## Alert routing

When notifications are needed, an existing alert component consumes bounded committed-event hints or policy-admitted health conditions and sends them to a user-selected replaceable adapter, without a product default channel. It owns delivery preferences, attempts, and receipts only. Delivery success, silence, duplication, or failure never proves a source transition, clears a fence, retries an unknown order effect, resumes a strategy, or declares `KNOWN_CLOSED`.

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
