import { dirname, isAbsolute, resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"
import { serverRuntimeProcessSpecs } from "./server-runtime-processes"

export const SERVER_RUNTIME_LAUNCHD_RENDER_SCHEMA = "trade.server-runtime-launchd-render.v1" as const
export const SERVER_RUNTIME_LAUNCHD_LABELS = {
  "l2-owner": "com.trade.server-shadow.l2-owner",
  "l2-consumer": "com.trade.server-shadow.l2-consumer",
  "control-runtime": "com.trade.server-shadow.control-runtime",
} as const

export interface ServerRuntimeLaunchdRender {
  schema_version: typeof SERVER_RUNTIME_LAUNCHD_RENDER_SCHEMA
  profile_id: string
  deployment_id: string
  profile_hash: string
  process_authority: "launchd"
  readiness_claim: "process_units_only_status_required"
  units: Record<string, string>
  limitations: string[]
}

export function renderServerRuntimeLaunchd(
  profile: ServerRuntimeProfile,
  releaseRoot: string,
  bunPath: string,
): ServerRuntimeLaunchdRender {
  if (profile.process_manager.target !== "launchd") throw new Error("launchd renderer requires a launchd profile")
  const root = absolutePath(releaseRoot, "release_root")
  const bun = absolutePath(bunPath, "bun_path")
  const units = Object.fromEntries(serverRuntimeProcessSpecs(profile, root, bun).map((process) => {
    const label = SERVER_RUNTIME_LAUNCHD_LABELS[process.id]
    return [`${label}.plist`, renderLaunchAgent({
      label,
      root,
      command: process.command,
      restartSeconds: profile.process_manager.restart_seconds,
      shutdownGraceSeconds: profile.process_manager.shutdown_grace_seconds,
    })]
  }))
  return {
    schema_version: SERVER_RUNTIME_LAUNCHD_RENDER_SCHEMA,
    profile_id: profile.profile_id,
    deployment_id: profile.deployment_id,
    profile_hash: serverRuntimeProfileHash(profile),
    process_authority: "launchd",
    readiness_claim: "process_units_only_status_required",
    units,
    limitations: [
      "launchd_does_not_prove_domain_readiness",
      "owner_readiness_enforces_dependency_order_after_independent_start",
      "protected_macos_source_roots_require_an_explicit_privacy_grant_or_repository_relocation",
    ],
  }
}

function renderLaunchAgent(input: {
  label: string
  root: string
  command: string[]
  restartSeconds: number
  shutdownGraceSeconds: number
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${input.command.map((argument) => `    <string>${xml(argument)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(input.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TRADE_REPO_ROOT</key>
    <string>${xml(input.root)}</string>
    <key>PATH</key>
    <string>${xml(`${dirname(input.command[0])}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>${input.restartSeconds}</integer>
  <key>ExitTimeOut</key>
  <integer>${input.shutdownGraceSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${xml(resolve(input.root, `tmp/server-runtime/logs/${input.label}.stdout.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(resolve(input.root, `tmp/server-runtime/logs/${input.label}.stderr.log`))}</string>
</dict>
</plist>
`
}

function absolutePath(value: string, field: string): string {
  if (!isAbsolute(value) || /[\n\r\0]/.test(value)) throw new Error(`${field} must be an absolute path without control characters`)
  return value.replace(/\/$/, "") || "/"
}

function xml(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error("launchd value contains a forbidden control character")
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
