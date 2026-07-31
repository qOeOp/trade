# Account Candidate Arbiter Contract

## Owns

- Deterministic account-level ranking of already-qualified setup candidates.
- Integer risk-unit mutual exclusion across total account、new-position、symbol and correlation-bucket limits.
- One self-hashed allocation proposal that records accepted and rejected setup versions with exact market-fact evidence.

## Boundaries

- Does not scan markets、qualify setups、invent correlation buckets、price risk、reserve capital、write account state or execute orders.
- Scores、risk units、strategy version、plan hash and market fact hashes must already be supplied by their owners.
- An allocation is a proposal only. It grants no preflight、execution、exchange-write or lifecycle authority and never partially resizes a candidate.
