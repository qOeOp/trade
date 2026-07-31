# execution.recorder

## Type

atomic module

## Owns

- Converting execution tool results into auditable `order_fill` plan-event drafts.
- Validating target-action-specific execution result shape before recording.
- Unwrapping stable tool response envelopes for execution callers.

## Inputs

- Target action.
- Preflight result for entry placement.
- Execution contract input for entry placement.
- Structured request and execution result for cancel, protection, and position adjustment actions.
- Optional event key and created time.

## Outputs

- One or more `order_fill` plan-event draft records.
- Validation errors for incomplete execution tool results.

## Boundaries

- Does not append to `trade.db`; callers own persistence.
- Does not run preflight, trigger gates, idempotency, or exchange commands.
- Does not call Binance tools or read exchange state.
- Does not make strategy, R&D, review, or recovery decisions.
