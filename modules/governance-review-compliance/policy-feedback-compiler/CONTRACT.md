# governance.policy-feedback-compiler

## Responsibility

Compile review findings into policy feedback refs for policy-risk consumers.

## Inputs

- Feedback ref.
- Review refs and recommendation kind.
- Severity, policy scope, decision, and content hash.

## Outputs

- Policy feedback payload.
- `trade.protocol.governance-ref.v1` with `kind=policy_feedback`.

## Boundaries

- Does not change runtime policy.
- Does not approve overrides.
- Does not write execution state or call exchange APIs.
- Produces governance feedback refs only.
