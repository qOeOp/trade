# Research Control Plane Contracts

Owns the stable cross-plane identity and Draft Strategy authorization contracts.

## Responsibilities

- Define the immutable identity binding shared by Trial, Replay, Forward, and Draft Strategy registration, including Experiment Contract v3 `replay_execution_input` and Trial Reservation v9 bindings for Replay risk/spec/status schedules, instrument-status provenance, the Control Plane-certified status-provider capability, supplemental revision stream, Contract-derived Requirement Set and nullable liquidity-capacity-attestation hash.
- Define the self-hashed Instrument Status Provider Certification v1 snapshot. It binds one Market Data provider build/normalization capability to a certifier, policy and half-open validity window; Dataset producers and Replay workers cannot mint this authority.
- Define the self-hashed Provider Certification Termination v1 fact. It is append-only, non-retroactive and either revokes one certification or supersedes it with a separately registered successor; it changes only future Control Plane admission and is not Replay input.
- Define a separate self-hashed Aggregate Trade Provider Certification v1. It binds the exact provider capability/build/policy, Archive v1 input and Replay Event/Attestation output schemas while fixing external completeness to `not_verified`; it never reuses the incompatible Instrument Status certification.
- Define Aggregate Trade Provider Certification Termination v1 and Reservation-bound Evidence Admission v1. Admission embeds the certification snapshot and archive/receipt/audit/evidence/attestation hashes, but its only scope is `pre_integration_exact_price_path_only`; it is not Trial Reservation v9, Request v30, Runner or Fill authority.
- Define Cross-source Ordering Admission v1. It binds one Replay-owned Ordering Attestation to the same reserved Trial、Reservation、Aggregate Trade Evidence Admission、Dataset/status authority and exact four-source collection hashes. Scope is `pre_integration_cross_source_ordering_only` with `economic_authority=none`; Reservation v9 and production wire remain unchanged.
- Define Decision Observation Bundle Admission v1. It binds one validated Request v30、Reservation v9、registered Cross-source Ordering Admission、Wire v2、frozen Decision Schedule and portable Observation Bundle to the authoritative reserved Trial. The receipt only grants `non_economic_decision_observation_audit`; it certifies Wire identity plus Schedule binding, explicitly leaves Projection derivation `not_certified`, and grants no Harness、Runner、Decision、Signal、Order or economic authority.
- Define separate self-hashed Reservation Cancellation v1 and Attempt Cancellation v1 receipts. The former fences future claims at its effective time; the latter targets one exact active lease generation. Neither receipt is Replay economic input or mutable Trial state.
- Define self-hashed Attempt Cancellation Observation v1 as a worker submission bound to one cancellation hash、lease generation and cancelled Run Outcome v35. It is evidence of cooperative observation, not a second cancellation authority or a stopping-latency claim.
- Define the only authorization accepted by Strategy Registry: an `accept_for_draft` Reviewer Decision bound to one completed Trial and primary Result.
- Define the registered Draft Strategy binding consumed by Forward Evidence Plane.
- Reject incomplete or mutable-looking boundary objects before owner commands run.

## Boundaries

- Does not persist facts, execute Replay, render strategy markdown, or decide promotion.
- Does not expose Control Plane database internals.
