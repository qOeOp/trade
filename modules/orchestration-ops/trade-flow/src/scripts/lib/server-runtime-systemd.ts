import { isAbsolute, resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"
import { serverRuntimeProcessSpecs } from "./server-runtime-processes"

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
  if (profile.process_manager.target !== "systemd") throw new Error("systemd renderer requires a systemd profile")
  const root = absolutePath(releaseRoot, "release_root")
  const bun = absolutePath(bunPath, "bun_path")
  const common = {
    profile,
    root,
    bun,
    data: resolve(root, "data"),
    tmp: resolve(root, "tmp"),
  }
  const processes = Object.fromEntries(serverRuntimeProcessSpecs(profile, root, bun).map((process) => [process.id, process]))
  const units = {
    "trade-l2-owner.service": renderService({
      ...common,
      description: "Trade public L2 owner",
      after: ["network-online.target"],
      wants: ["network-online.target"],
      command: processes["l2-owner"].command,
    }),
    "trade-l2-consumer.service": renderService({
      ...common,
      description: "Trade resident L2 consumer",
      after: ["trade-l2-owner.service"],
      wants: ["trade-l2-owner.service"],
      command: processes["l2-consumer"].command,
    }),
    "trade-control-runtime.service": renderService({
      ...common,
      description: "Trade no-live control runtime",
      after: ["trade-l2-consumer.service"],
      wants: ["trade-l2-consumer.service"],
      command: processes["control-runtime"].command,
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

function absolutePath(value: string, field: string): string {
  if (!isAbsolute(value) || /[\n\r\0]/.test(value)) throw new Error(`${field} must be an absolute path without control characters`)
  return value.replace(/\/$/, "") || "/"
}

function systemdQuote(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error("systemd argument contains a forbidden control character")
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}
