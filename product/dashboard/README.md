# Trade Dashboard baseline

This package is the first independently buildable Trade-owned Dashboard slice. It contains the Vibe-derived login
and shell, the shared Claude-token UI system, the admitted Operations Runs and Run Detail consumers, and the fixed
fail-closed Market Data and Runtime route geometry.

`GET /api/operations/runs` and the bounded Run Detail endpoints read only Trade-owned operational RunStore data.
They never copy Windmill job rows or Owner payloads and never reinterpret operational completion as business
success. The same-identity Owner resolution endpoint may repeat only the registered typed Owner read; it does not
dispatch or retry an effect. Operational cache deletion is capability-gated, terminal-run-only, and preserves the
run tombstone and Owner locator.

Routes that have not reached the bilingual `DRAWABLE_EXACT` completeness gate remain navigation-only placeholders.
In particular, this baseline does not ship the local R&D, Backtest, Overview, Workers, Schedules, Service Logs,
Audit, Event Rail, Telemetry, Alerts, Settings Access, or Portfolio page candidates. Their retained local source is
not implementation authority.

The Dashboard has no production deployment, Windmill cutover, provider execution, business write, or trading
authority. Windmill remains the current executor for every effect. Missing PostgreSQL or Owner configuration fails
closed as an unavailable projection.

## Local checks

```bash
npm ci
npm run test
npm run typecheck
npm run build
```

For a local production preview after the build:

```bash
npm start -- --hostname 127.0.0.1 --port 3110
```

The default route redirects through the source-pinned login presentation. `/operations` is the admitted run ledger,
and `/operations/runs/:runIdentity` is the bounded detail route.
