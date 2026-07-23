# execution.execution-capability

## Responsibility

Compile an armable preflight verdict, short-lived policy authorization, fresh exchange account fact, portfolio projection, and action intent into one bounded exchange-write capability.

## Output

- `trade.execution.capability.v1`
- Binds target action, account scope, maximum risk/notional effect, idempotency, policy/fact/projection/intent refs, issue time, and expiry.

## Boundaries

- Does not decide thesis or promotion.
- Does not read stores or call an exchange.
- Does not outlive any bound authorization or fact freshness window.
- Is invalid when any account scope, policy hash, source ref, or idempotency binding differs at the exchange gate.
