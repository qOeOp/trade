# Research Control Plane Contracts

Owns the stable cross-plane identity and Draft Strategy authorization contracts.

## Responsibilities

- Define the immutable identity binding shared by Trial, Replay, Forward, and Draft Strategy registration, including Experiment Contract v3 `replay_execution_input` and Trial Reservation v5 bindings for Replay risk/spec schedules, supplemental revision stream and Contract-derived Requirement Set.
- Define the only authorization accepted by Strategy Registry: an `accept_for_draft` Reviewer Decision bound to one completed Trial and primary Result.
- Define the registered Draft Strategy binding consumed by Forward Evidence Plane.
- Reject incomplete or mutable-looking boundary objects before owner commands run.

## Boundaries

- Does not persist facts, execute Replay, render strategy markdown, or decide promotion.
- Does not expose Control Plane database internals.
