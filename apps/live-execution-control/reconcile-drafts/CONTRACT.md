# Reconcile Drafts Contract

Owns deterministic comparison between local flow state and exchange account facts.

## Responsibilities

- Compare local event-derived state with account snapshot open orders and order history.
- Propose `order_fill(source=reconcile)` drafts for chain-owned missing facts.
- Preserve exchange cumulative filled quantity and emit only the monotonic fill delta relative to durable local facts.
- Bind fill drafts to exchange trade identity when available, otherwise exchange order identity plus cumulative fill quantity.
- Report unmatched foreign orders, protective drift, and position deltas.

## Boundaries

- Does not call exchange APIs.
- Does not append events to `trade.db`.
- Does not apply drafts.
- Does not make strategy or execution decisions.
- Never treats a cumulative exchange quantity as a new fill delta.
