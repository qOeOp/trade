# decision.observe-builder

## Type

atomic module

## Owns

- Building a normalized observe event from supplied account, market, plan, and policy projections.
- Symbol-scoped account projection summarization for observe event bodies.
- The in-memory observe event body contract used by `trade-flow`.

## Inputs

- Chain id, symbol, side, strategy reference, optional setup id.
- Account snapshot projection.
- Optional market snapshot refs, plan seed, policy snapshot, and created time.

## Outputs

- `observe` event candidate with `event_key`, `chain_id`, `body_json`, and `created_at`.
- Symbol-scoped account projection summary.

## Boundaries

- Does not call exchange, filesystem, catalog, R&D, review, or execution tools.
- Does not read or write `trade.db`.
- Does not decide whether an action is executable; preflight remains outside this module.
- Does not own command routing or script response envelopes.
