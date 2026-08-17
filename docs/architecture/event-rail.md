# Event Rail

## Responsibility

Event Rail is a wake-up channel and transport custodian that emits an Event Rail-owned Event Wake for committed eligibility, runtime incident, order, fill, and reconciliation-drift facts. It preserves wake identity, source fact reference, ordering semantics, and subscriber delivery.

## Authority boundary

The source Owner remains authoritative for the referenced business fact. Event Rail owns only the Event Wake transport record, and every wake binds that Owner and committed fact identity. Event Rail and Observability occupy custodian fields only; neither may appear as a business authority. Event Rail owns no approval, business retry, terminal state, recovery acknowledgement, order lifecycle, or account truth.

## Governance use

An event can wake Strategy Governance to read committed facts from Qualification, Runtime, or Execution. Runtime incident events identify a committed Runtime Incident Fact; reconciliation events identify a committed Execution Reconciliation Drift Fact. Governance reads those facts directly from the source Owner. Portfolio facts remain directly readable through their modeled Owner handoffs and are not invented as Event Rail wakes. The event itself never substitutes for a source fact.

## Alert use

Committed Event Wakes may be routed to Observability. The wake is Observability input; Alert Delivery is an Alert
Routing output and receipt, never an input or business fact. Qualification wakes expose exactly
`CLOSED_NOT_QUALIFIED`, `QUALIFIED`, `EXPIRED`, or `REVOKED`, using only public attempt correlation, public state,
effective cut, sequence, and one type-opaque non-dereferenceable reference. Every `REPLAY_REJECTED`,
`REPLAY_INVALID`, `DIAGNOSTIC_INVALID`, `DIAGNOSTIC_UNRESOLVED`, `ASSESSMENT_INVALID`, and `INELIGIBLE` terminal
emits the same normalized `CLOSED_NOT_QUALIFIED` event shape. Event presence, state, effective cut, opaque-reference
class, and sequence are therefore indistinguishable across all six; no internal `INELIGIBLE` event is published.
Those protected measurements, parameters, results, holdout details, evaluation outputs, timing differences, and
category-specific references never enter Event Rail. Delivery success means a message arrived, not that the
underlying business transition succeeded.

## Implementation acceptance

Consumers deduplicate Qualification wakes by the same public attempt correlation, state, effective cut, opaque
reference, and event sequence; other wakes use their stable Event Wake identity. Wake or alert delivery can retry
without replaying the source business write. Missing notification delivery cannot change an Owner state. Contract
validation rejects Event Rail or Observability in any business-authority field and rejects Alert Delivery as an
Events → Observability input.
