# Trade Dashboard

This package is the independently buildable Trade-owned Dashboard. It contains the Vibe-derived shell and shared
UI atoms together with the currently admitted first-party read surfaces.

## Shipped boundary

- Operations ships Runs, exact Run Detail, Workers, bounded shadow-read Schedules, Service Logs, and first-party
  Audit. Run Detail includes bounded Logs, Metrics, Traces, and Assets states.
- R&D ships the Source Intake point read, Research and Artifact directories, the Artifact source viewer, and the
  Develop Composer readback. Backtest ships the sealed Replay request readback.
- Market Data, Runtime, and Portfolio ship only their documented fail-closed foundation surfaces. Their visible
  unavailable or not-ready states do not prove a backend, provider, Owner consumer, or effect path exists.
- Event Rail, Telemetry, Alerts, Settings Access, and every other route below the bilingual `DRAWABLE_EXACT` gate
  remain navigation-only placeholders. A route name or retained source is not implementation authority.

The Operations APIs read only Trade-owned operational RunStore data. Typed R&D and Backtest reads use their exact
Owner contracts. They never copy Windmill job rows or raw Owner payloads, and operational completion is never
reinterpreted as business success. The same-identity Owner resolution endpoint may repeat only the registered typed
Owner read; it does not dispatch or retry an effect. Operational cache deletion is capability-gated,
terminal-run-only, and preserves the run tombstone and Owner locator.

## Image and Compose boundary

`product/dashboard/Dockerfile` builds the standalone `trade-dashboard` image. The R&D Workbench Compose file adds
`dashboard-run-store-migrate` and `dashboard-web` only under the opt-in `dashboard-preview` profile. The migration
must complete before the read-only web container starts; the host port defaults to `127.0.0.1:3100`.

The Dashboard image is not bundled into a Windmill image, and enabling its profile does not stop, replace, or add a
dependency to Windmill server or workers. There is no production deployment or Windmill cutover. Windmill remains
the current executor for every effect; the Dashboard has no provider execution, business-write, or trading
authority. Missing PostgreSQL or Owner configuration fails closed as an unavailable projection.

## Local checks

```bash
npm ci
npm run test
npm run typecheck
npm run build
```

For a local production preview after the build:

```bash
npm start -- --hostname 127.0.0.1 --port 3100
```

The default route redirects through the source-pinned login presentation. The exact route and component contracts
remain governed by `docs/guide/dashboard.md` and `docs/guide/dashboard.zh.md`.
