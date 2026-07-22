# Watch Handoff Revalidation Contract

## Responsibility

- Revalidate one triggered Watch handoff against its immutable definition, a fresh observation, the existing execution gate, and the existing plan preflight.
- Return a bounded receipt that can close the Watch Task audit lifecycle.

## Boundaries

- A passing result has `execution_authority=none`; it is not an execution approval or command.
- Does not call execution-router, live-small runner, exchange tools, event-store, or any database.
- Does not refresh account, policy, portfolio, or market facts; callers must supply current owner facts to preflight.
- Identity, hash, lineage, deadline, invalidation, and trigger failures are fail-closed.
