# Research Control Plane Contracts

Owns the stable cross-plane identity and Draft Strategy authorization contracts.

## Responsibilities

- Define the immutable identity binding shared by Trial, Replay, Forward, and Draft Strategy registration, including Experiment Contract v3 `replay_execution_input` and Trial Reservation v9 bindings for Replay risk/spec/status schedules, instrument-status provenance, the Control Plane-certified status-provider capability, supplemental revision stream, Contract-derived Requirement Set and nullable liquidity-capacity-attestation hash.
- Define the self-hashed Instrument Status Provider Certification v1 snapshot. It binds one Market Data provider build/normalization capability to a certifier, policy and half-open validity window; Dataset producers and Replay workers cannot mint this authority.
- Define the self-hashed Provider Certification Termination v1 fact. It is append-only, non-retroactive and either revokes one certification or supersedes it with a separately registered successor; it changes only future Control Plane admission and is not Replay input.
- Define separate self-hashed Reservation Cancellation v1 and Attempt Cancellation v1 receipts. The former fences future claims at its effective time; the latter targets one exact active lease generation. Neither receipt is Replay economic input or mutable Trial state.
- Define self-hashed Attempt Cancellation Observation v1 as a worker submission bound to one cancellation hash、lease generation and cancelled Run Outcome v35. It is evidence of cooperative observation, not a second cancellation authority or a stopping-latency claim.
- Define the only authorization accepted by Strategy Registry: an `accept_for_draft` Reviewer Decision bound to one completed Trial and primary Result.
- Define the registered Draft Strategy binding consumed by Forward Evidence Plane.
- Reject incomplete or mutable-looking boundary objects before owner commands run.

## Boundaries

- Does not persist facts, execute Replay, render strategy markdown, or decide promotion.
- Does not expose Control Plane database internals.
