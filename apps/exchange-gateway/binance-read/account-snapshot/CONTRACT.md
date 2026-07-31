# Binance Account Snapshot Contract

## Owns

- Read-only Binance account facts
- Balances, positions, open orders, protective orders, and optional order history
- Stable non-secret `venue_account_ref` and `exchange-account-facts` snapshots bound to `account_ref`, `account_scope`, `as_of`, freshness, source, and content hash

## Output

- `trade.exchange.venue-account-ref.v1` identifies venue/environment/market/account alias; it never contains credential material.
- `trade.exchange.account-facts.v1` is the canonical cross-domain account fact. Legacy top-level account/order fields remain temporarily for compatibility.
- `snapshot_ref` identifies the exact content-addressed observation; it does not grant physical store access or execution authority.

## Forbidden

- Exchange writes
- Strategy judgment
- Writing `trade.db`
- Portfolio risk aggregation, capital reservation, or `available_to_trade` decisions
