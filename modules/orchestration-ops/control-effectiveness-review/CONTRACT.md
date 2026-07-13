# Control Effectiveness Review Contract

Owns post-cycle review of control-system effectiveness. It reads `ops_runtime_store` and writes only `control_review` rows.

## Responsibilities

- Detect repeated incidents, failed/blocked jobs, failed notifications, and stale acknowledged incidents.
- Produce control improvement items with source refs, suspected owner, and recommended code/process fix.
- Suggest next-cycle constraints for the control tower or operator.
- Persist the review result for audit and later follow-up.

## Boundaries

- Does not inspect or judge trade PnL.
- Does not decide strategy quality or risk budgets.
- Does not change source code, config, exchange state, or trading facts.
- Does not resolve incidents automatically.
