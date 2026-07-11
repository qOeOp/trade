# execution-flow-runner

## Owns

- dry-run / shadow execution flow state transition
- skipped execution observe event construction
- execution idempotency gate
- deterministic mock execution result for non-live execution modes

## Does not own

- live exchange writes
- strategy thesis or promotion logic
- account snapshot reconciliation

## Stable entrypoints

- `runOneFlowStep(db, input, mode)`
- `appendExecutionObserve(db, input, preflightResult, executionGate)`
- `evaluateIdempotency(db, contract)`
- `buildMockExecutionResult(contract, mode)`
