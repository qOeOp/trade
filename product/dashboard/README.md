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

`product/dashboard/Dockerfile` builds one standalone `trade-dashboard` image. The R&D Workbench Compose file uses
that image for `dashboard-run-store-migrate`, `dashboard-web`, `dashboard-shadow-worker`, and
`dashboard-shadow-scheduler`, all only under the opt-in `dashboard-preview` profile. The migration must complete
before the read-only web and shadow-runtime containers start; the web host port defaults to
`127.0.0.1:3100`, while the worker and scheduler expose no host port.

The worker and scheduler are separate least-privilege process roles over the Trade-owned RunStore. The worker can
claim only zero-effect operations with an explicit dispatcher and current compatibility envelope; the scheduler
can enqueue only the exact digest-bound schedule set. Missing or invalid RunStore, compatibility, role capability,
schedule, or Owner configuration keeps the relevant process unhealthy and exits it fail closed. Each runtime uses
its own identity and token; scheduler configuration does not receive Owner credentials.

The Dashboard image is not bundled into a Windmill image, and enabling its profile does not stop, replace, or add a
dependency to Windmill server or workers. There is no production deployment or Windmill cutover. Windmill remains
the current executor for every effect; the Dashboard shadow roles perform typed Owner reads and write only their
own operational RunStore records. They have no provider execution, business-write, or trading authority.
Missing PostgreSQL or Owner configuration fails closed as an unavailable projection or an unhealthy runtime role.

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
