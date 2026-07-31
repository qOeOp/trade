# Market Data Runtime Manager Contract

## Owns

- One foreground Market Data process authority for bounded demand-driven L2 owner + resident-consumer pairs.
- Periodic owner-backed active-flow projection → leased demand sync、`market-data-store` subscription proposal read、stable slot / loopback port planning、owner-before-consumer readiness、consumer-before-owner drain and signal-safe shutdown.
- Typed per-cycle effects and a redacted latest runtime state without PID、secret or arbitrary command.

## Boundaries

- Adopted by `profile/server-runtime-container.json` as the container market-data authority. The legacy host-native launchd/systemd profile still owns a fixed single-symbol pair; both profiles must never target the same owner data/port namespace concurrently.
- Reads demand only through the Market Data owner CLI. Runtime / R&D callers cannot inject endpoint、path、command、PID、credential or lifecycle action.
- Active-flow sync requires an explicit canonical symbol from the Flow Projector; it never guesses one from chain / strategy prose. Exposure、unknown position or open orders become defensive demand; a pending action becomes active-plan demand.
- Source-capacity failure preserves current pairs and starts / drains nothing. Owner read / DB failure also preserves current pairs.
- No exchange private/write、strategy、Replay、Fill、risk or economic authority.
