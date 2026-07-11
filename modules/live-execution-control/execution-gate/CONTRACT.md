# Execution Gate Contract

Owns deterministic trigger-condition checks that decide whether an already-approved action intent is ready to continue.

## Responsibilities

- Evaluate trigger expiry.
- Evaluate current mark against a price range.
- Return a stable ready/skipped gate result.

## Boundaries

- Does not compile execution contracts.
- Does not route exchange commands.
- Does not write events or call external tools.
- Does not make strategy or risk-policy decisions beyond trigger readiness.

