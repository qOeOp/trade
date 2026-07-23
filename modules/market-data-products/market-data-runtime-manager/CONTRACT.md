# Market Data Runtime Manager Contract

## Owns

- One foreground Market Data process authority for bounded demand-driven L2 owner + resident-consumer pairs.
- Periodic read of the `market-data-store` subscription proposal、stable slot / loopback port planning、owner-before-consumer readiness、consumer-before-owner drain and signal-safe shutdown.
- Typed per-cycle effects and a redacted latest runtime state without PID、secret or arbitrary command.

## Boundaries

- Not enabled by the current fixed single-symbol server profile. Adoption replaces that fixed pair; both modes must never own the same symbol concurrently.
- Reads demand only through the Market Data owner CLI. Runtime / R&D callers cannot inject endpoint、path、command、PID、credential or lifecycle action.
- Source-capacity failure preserves current pairs and starts / drains nothing. Owner read / DB failure also preserves current pairs.
- No exchange private/write、strategy、Replay、Fill、risk or economic authority.
