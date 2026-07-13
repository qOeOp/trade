# governance.evidence-intake-gate

## Responsibility

Gate governance evidence before review or promotion by checking required refs, data hash, policy hash, and freshness metadata.

## Inputs

- Evidence ref.
- Source refs.
- Data hash and policy hash.
- Freshness timestamp and optional maximum age.

## Outputs

- Evidence intake verdict.
- `trade.protocol.governance-ref.v1` with `kind=evidence_verdict`.

## Boundaries

- Does not run review attribution.
- Does not promote strategies.
- Does not write policy or execution state.
- Does not call exchange APIs.
