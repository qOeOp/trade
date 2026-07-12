# contracts/domain-runtime

## Type

contract module

## Owns

- Shared domain lifecycle hook names and ordering.
- Domain job result envelope contract.
- Hook context shell for inbox refs, permission scope, write scope, idempotency key, trading mode, and audit metadata.
- Failure classification vocabulary for `ok / skipped / blocked / failed / retryable / needs_review`.

## Inputs

- Job ticket / command envelope refs from `protocol-fabric`.
- Domain inbox envelope.
- Runtime policy / trading mode snapshot refs.
- Owner store refs declared by the target domain.

## Outputs

- Validated domain job result envelope.
- Hook audit metadata.
- Incident refs for control tower post-processing.

## Boundaries

- Does not dispatch jobs.
- Does not define transport middleware.
- Does not read or write `trade.db`, catalog DB, market data, exchange state, policy registry, governance ledger, or research state.
- Does not perform strategy, market, execution, promotion, or risk-budget decisions.
- Does not auto-register plugins or scan modules.
- Does not replace `protocol-fabric`; it consumes protocol envelopes and defines lifecycle semantics around domain handling.

## Hook Order

```text
pre_accept
  -> pre_handle
  -> handler
  -> post_handle
  -> post_commit
  -> outbox
```

`on_error` may run after any failed hook or handler and must preserve the original failure class.

## Required Result Envelope

Every domain runtime adapter returns:

- `ok`
- `status`
- `domain`
- `job_id`
- `idempotency_key`
- `input_refs`
- `output_refs`
- `writes`
- `incidents`
- `audit`

Business payloads remain owned by their domain outbox contracts.
