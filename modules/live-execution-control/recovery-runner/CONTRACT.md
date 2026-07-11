# Recovery Runner Contract

Owns safe recovery orchestration for a single local flow.

## Responsibilities

- Read local flow events and projection.
- Fetch account snapshot through a read-only exchange tool.
- Build reconcile drafts through `reconcile-drafts`.
- Write `needs_review` when unmatched facts exist.
- Optionally apply safe reconcile drafts through the portfolio projector.

## Boundaries

- Does not place, cancel, protect, or adjust exchange orders.
- Does not invent missing fills without account/history evidence.
- Does not own reconcile draft construction.
- Does not own event schema.

