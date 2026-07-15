# Research Control Plane Contracts

Owns the stable cross-plane identity and Draft Strategy authorization contracts.

## Responsibilities

- Define the immutable identity binding shared by Trial, Replay, Forward, and Draft Strategy registration, including Experiment Contract v3 `replay_execution_input` and Trial Reservation v8 bindings for Replay risk/spec/status schedules, instrument-status provenance, the Control Plane-certified status-provider capability, supplemental revision stream and Contract-derived Requirement Set.
- Define the self-hashed Instrument Status Provider Certification v1 snapshot. It binds one Market Data provider build/normalization capability to a certifier, policy and half-open validity window; Dataset producers and Replay workers cannot mint this authority.
- Define the only authorization accepted by Strategy Registry: an `accept_for_draft` Reviewer Decision bound to one completed Trial and primary Result.
- Define the registered Draft Strategy binding consumed by Forward Evidence Plane.
- Reject incomplete or mutable-looking boundary objects before owner commands run.

## Boundaries

- Does not persist facts, execute Replay, render strategy markdown, or decide promotion.
- Does not expose Control Plane database internals.
