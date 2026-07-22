import { isAbsolute, resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"

export const SERVER_RUNTIME_SYSTEMD_RENDER_SCHEMA = "trade.server-runtime-systemd-render.v1" as const

export interface ServerRuntimeSystemdRender {
  schema_version: typeof SERVER_RUNTIME_SYSTEMD_RENDER_SCHEMA
  profile_id: string
  deployment_id: string
  profile_hash: string
  process_authority: "systemd"
  readiness_claim: "process_units_only_status_required"
  units: Record<string, string>
}

export function renderServerRuntimeSystemd(profile: ServerRuntimeProfile, releaseRoot: string, bunPath: string): ServerRuntimeSystemdRender {
  const root = absolutePath(releaseRoot, "release_root")
  const bun = absolutePath(bunPath, "bun_path")
  const common = {
    profile,
    root,
    bun,
    data: resolve(root, "data"),
    tmp: resolve(root, "tmp"),
  }
  const units = {
    "trade-l2-owner.service": renderService({
      ...common,
      description: "Trade public L2 owner",
      after: ["network-online.target"],
      wants: ["network-online.target"],
      command: l2OwnerCommand(profile, root, bun),
    }),
    "trade-l2-consumer.service": renderService({
      ...common,
      description: "Trade resident L2 consumer",
      after: ["trade-l2-owner.service"],
      wants: ["trade-l2-owner.service"],
      command: l2ConsumerCommand(profile, root, bun),
    }),
    "trade-control-runtime.service": renderService({
      ...common,
      description: "Trade no-live control runtime",
      after: ["trade-l2-consumer.service"],
      wants: ["trade-l2-consumer.service"],
      command: controlRuntimeCommand(profile, root, bun),
    }),
    "trade-server-shadow.target": renderTarget(),
  }
  return {
    schema_version: SERVER_RUNTIME_SYSTEMD_RENDER_SCHEMA,
    profile_id: profile.profile_id,
    deployment_id: profile.deployment_id,
    profile_hash: serverRuntimeProfileHash(profile),
    process_authority: "systemd",
    readiness_claim: "process_units_only_status_required",
    units,
  }
}

function renderService(input: {
  profile: ServerRuntimeProfile
  root: string
  bun: string
  data: string
  tmp: string
  description: string
  after: string[]
  wants: string[]
  command: string[]
}): string {
  const manager = input.profile.process_manager
  return `[Unit]
Description=${input.description}
After=${input.after.join(" ")}
Wants=${input.wants.join(" ")}
StartLimitIntervalSec=${manager.start_limit_interval_seconds}
StartLimitBurst=${manager.start_limit_burst}

[Service]
Type=simple
User=${manager.service_user}
Group=${manager.service_group}
WorkingDirectory=${systemdQuote(input.root)}
Environment=${systemdQuote(`TRADE_REPO_ROOT=${input.root}`)}
ExecStart=${input.command.map(systemdQuote).join(" ")}
Restart=on-failure
RestartSec=${manager.restart_seconds}
TimeoutStopSec=${manager.shutdown_grace_seconds}
KillMode=control-group
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${systemdQuote(input.data)} ${systemdQuote(input.tmp)}

[Install]
WantedBy=trade-server-shadow.target
`
}

function renderTarget(): string {
  return `[Unit]
Description=Trade no-live server shadow profile
Wants=trade-l2-owner.service trade-l2-consumer.service trade-control-runtime.service
After=network-online.target trade-l2-owner.service trade-l2-consumer.service trade-control-runtime.service

[Install]
WantedBy=multi-user.target
`
}

function l2OwnerCommand(profile: ServerRuntimeProfile, root: string, bun: string): string[] {
  const owner = profile.l2_owner
  return [
    bun,
    resolve(root, "modules/market-data-products/l2-order-book-service/src/scripts/foreground.ts"),
    "--symbol", owner.symbol,
    "--output-base", owner.output_base,
    "--listen", owner.listen,
    "--epoch-seconds", String(owner.epoch_seconds),
    "--queue-capacity", String(owner.queue_capacity),
    "--segment-frames", String(owner.segment_frames),
    "--sync-every-frames", String(owner.sync_every_frames),
    "--stale-after-ms", String(owner.stale_after_ms),
    "--restart-limit", String(owner.restart_limit),
    "--market-data-db", owner.market_data_db,
    "--admission-interval-ms", String(owner.admission_interval_ms),
    "--disk-check-interval-ms", String(owner.disk_check_interval_ms),
    "--disk-soft-min-bytes", String(owner.disk_soft_min_bytes),
    "--disk-hard-min-bytes", String(owner.disk_hard_min_bytes),
    "--resource-check-interval-ms", String(owner.resource_check_interval_ms),
  ]
}

function l2ConsumerCommand(profile: ServerRuntimeProfile, root: string, bun: string): string[] {
  const consumer = profile.l2_consumer
  return [
    bun,
    resolve(root, "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-foreground.ts"),
    "--max-cycles", String(consumer.max_cycles),
    "--session-ms", String(consumer.session_ms),
    "--max-events", String(consumer.max_events),
    "--watch-ms", String(consumer.watch_ms),
    "--depth", String(consumer.depth),
    "--max-freshness-ms", String(consumer.max_freshness_ms),
    "--restart-limit", String(consumer.restart_limit),
  ]
}

function controlRuntimeCommand(profile: ServerRuntimeProfile, root: string, bun: string): string[] {
  const control = profile.control_runtime
  return [
    bun,
    resolve(root, "modules/orchestration-ops/trade-flow/src/scripts/main.ts"),
    "--db", control.trade_db,
    "--run-program-shadow-supervisor",
    "--json",
    JSON.stringify({
      ops_runtime_db: control.ops_runtime_db,
      interval_seconds: control.interval_seconds,
      observe_agent_parity: control.observe_agent_parity,
    }),
  ]
}

function absolutePath(value: string, field: string): string {
  if (!isAbsolute(value) || /[\n\r\0]/.test(value)) throw new Error(`${field} must be an absolute path without control characters`)
  return value.replace(/\/$/, "") || "/"
}

function systemdQuote(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error("systemd argument contains a forbidden control character")
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}
