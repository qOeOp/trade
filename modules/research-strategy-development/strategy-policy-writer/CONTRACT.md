# research/strategy-policy-writer

## Type

atomic module

## Owns

- Rendering validated R&D candidates into deterministic strategy policy markdown.
- Versioned strategy policy source shape.
- Family-specific policy profiles for R&D strategy families.
- Strategy policy shape lint for human-readable policy completeness.

## Inputs

- Structured `StrategyPolicySource` records built from validated R&D candidates.
- Candidate params, family id, evidence refs, program objective, and draft timestamp.

## Outputs

- `strategies/*.md` markdown content.
- Policy shape lint results.
- Stable strategy ids, setup ids, and file slugs.

## Boundaries

- Does not run replay, campaigns, supervisors, governance review, or promotion.
- Does not call Binance, write trade state, or decide live permission.
- Does not accept free-form agent markdown as final strategy policy.
- Does not replace `contracts/strategy-contract`; Trade Contract compilation remains there.
