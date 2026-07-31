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

- `runOneFlowStep(dbPath, input, mode, runtime?)`
- `appendExecutionObserve(dbPath, input, preflightResult, executionGate, runtime?)`
- `evaluateIdempotency(dbPath, contract, runtime?)`
- `buildMockExecutionResult(contract, mode)`

State access goes through portfolio-execution-state owner tools by default. Tests may inject `ExecutionStateRuntime` as a behavior anchor.
