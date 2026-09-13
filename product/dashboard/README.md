# Trade Dashboard

This package is the independently buildable Trade-owned Dashboard. It contains the Vibe-derived shell and shared
UI atoms together with the currently admitted first-party read surfaces.

## Shipped boundary

- Operations ships Runs, exact Run Detail, Workers, bounded shadow-read Schedules, Service Logs, and first-party
  Audit. Run Detail includes bounded Logs, Metrics, Traces, and Assets states.
- R&D ships the Source Intake point read, Research and Artifact directories, the Artifact source viewer, and the
  Develop Composer readback. Backtest ships sealed Replay request and canonical result-summary readbacks.
- Market Data, Runtime, and Portfolio ship only their documented fail-closed foundation surfaces. Their visible
  unavailable or not-ready states do not prove a backend, provider, Owner consumer, or effect path exists.
- Settings Access ships only the local browser-session read/re-authentication shell. Operator Authorization,
  Product Edge binding, successor, and transport-token mutation remain explicitly unavailable. Event Rail,
  Telemetry, Alerts, and every other route below the bilingual `DRAWABLE_EXACT` gate
  remain navigation-only placeholders. A route name or retained source is not implementation authority.

The Operations APIs read only Trade-owned operational RunStore data. Typed R&D and Backtest reads use their exact
Owner contracts. They never copy Windmill job rows or raw Owner payloads, and operational completion is never
reinterpreted as business success. The same-identity Owner resolution endpoint may repeat only the registered typed
Owner read; it does not dispatch or retry an effect. Operational cache deletion is capability-gated,
terminal-run-only, and preserves the run tombstone and Owner locator.

## Image and Compose boundary

`product/dashboard/Dockerfile` builds one standalone `trade-dashboard` image. The R&D Workbench Compose file uses
that image for `dashboard-run-store-migrate`, `dashboard-web`, `dashboard-shadow-worker`,
`dashboard-shadow-scheduler`, and `dashboard-effect-worker`, all only under the opt-in
`dashboard-preview` profile. The migration must complete before the web and runtime containers start; the web
host port defaults to `127.0.0.1:3100`, while the runtime roles expose no host port.

The shadow worker, scheduler, and effect worker are separate least-privilege process roles over the Trade-owned RunStore. The shadow worker can
claim only zero-effect operations with an explicit dispatcher and current compatibility envelope; the scheduler
can enqueue only the exact digest-bound schedule set. Missing or invalid RunStore, compatibility, role capability,
schedule, or Owner configuration keeps the relevant process unhealthy and exits it fail closed. Each runtime uses
its own identity and token; scheduler configuration does not receive Owner credentials.

Fresh Artifact Formation, Source/Research, Develop Composer V2, and Exploratory Replay V2 request-custody RUNs are admitted only when disposable execution,
compatibility, current Product Edge routing, operator capability, and RunStore custody are all available. The web
process freezes the typed request, routing, admission receipt, audit row, run, and distinct effect-queue row in one
transaction and returns the queued run; it never receives provider credentials. Only the effect worker receives a
provider credential and it can claim only the four exact typed operations. Artifact provider invocation remains
claim-before-start and at-most-once; loss after `INVOCATION_STARTED` requires manual reconciliation. Source/Research
recovery resolves retained identities first and may resume only a missing stage from the frozen input. Replay V2
uses lossless decimal strings at HTTP/MCP boundaries, freezes the Owner-identified selector before enqueue, and
persists a submission-start marker before the one permitted Owner submit. Any response-loss retry is resolve-only;
the Dashboard does not execute the native replay.

Develop Composer freezes the exact Owner request projection before enqueue, resolves the derived request identity
before any write, submits the locator only when that identity is authoritatively absent and only on the first
claim, persists the submission-start marker before transport, and resolves again for the terminal Owner readback.
After response loss or worker recovery it is resolve-only and never repeats the submit. This capability is exposed
only through the authenticated BFF and MCP handler; the browser Composer workbench remains a zero-effect readback.

The Source/Research effect worker uses the transport-neutral Owner V2 routes for both Source and Research RUN
requests. Their public bodies contain only domain proposals and exact ancestry; transport channel and policy
internals remain confined to the legacy Owner adapter. The effect operation and Product Edge routing identities
remain frozen until a separately authorized atomic cut.

The Dashboard image is not bundled into a Windmill image, and enabling its profile does not stop, replace, or add a
dependency to Windmill server or workers. There is no production deployment or Windmill cutover. Windmill remains
the current executor for production effects; the Dashboard effect worker is disabled by default and has only
explicit disposable-local authority. The Dashboard roles have no production trading authority.
Missing PostgreSQL or Owner configuration fails closed as an unavailable projection or an unhealthy runtime role.

Browser access uses an HttpOnly, SameSite=Strict local session cookie signed by `DASHBOARD_SESSION_HMAC_KEY` after
proof of `DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN`. Both values must be opaque secrets of at least 32 bytes and are
provided only to `dashboard-web`. This browser session is not an effect capability:
`DASHBOARD_OPERATOR_API_TOKEN` remains independently required by admitted operational actions. The public
`/api/health` endpoint returns no business data and is the Compose liveness target.

`/api/mcp` is a stateless Streamable HTTP endpoint over the same typed Dashboard handlers. It is outside the
browser-session gate but requires its own finite, scoped Bearer capability and validates Host and Origin before MCP
dispatch. Its fixed tool registry contains only Artifact preflight/action, Source/Research action, Develop Composer
request-custody action, Replay V2 request-custody action, exact run detail, and bounded run-log reads; it exposes
no arbitrary script, database, shell, or administrative tool.

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

The default route redirects to Operations through the local operator session gate. The exact route and component contracts
remain governed by `docs/guide/dashboard.md` and `docs/guide/dashboard.zh.md`.
