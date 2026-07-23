import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import { preflightServerRuntime } from "./server-runtime-status"
import { renderServerRuntimeLaunchd, SERVER_RUNTIME_LAUNCHD_LABELS } from "./server-runtime-launchd"

type JSONRecord = Record<string, unknown>
type ComponentId = keyof typeof SERVER_RUNTIME_LAUNCHD_LABELS

export interface LaunchdCommandResult { exit_code: number; stdout: string; stderr: string }
export type LaunchdCommandExecutor = (argv: string[]) => LaunchdCommandResult

export interface ServerRuntimeLaunchdManagerInput {
  release_root: string
  bun_path: string
  execute?: LaunchdCommandExecutor
  launch_agents_directory?: string
  uid?: number
}

export function inspectServerRuntimeLaunchd(input: ServerRuntimeLaunchdManagerInput): JSONRecord {
  const context = loadContext(input)
  return managerProjection(context, "plan")
}

export function installServerRuntimeLaunchd(input: ServerRuntimeLaunchdManagerInput): JSONRecord {
  const context = loadContext(input)
  if (context.preflight.status !== "ready") throw new Error("server runtime preflight is blocked")
  if (context.units.some((unit) => unit.loaded)) throw new Error("a server runtime launchd label is already loaded")
  const drift = context.units.filter((unit) => unit.plist_status === "drifted")
  if (drift.length > 0) throw new Error(`launchd plist drift must be removed first: ${drift.map((unit) => unit.label).join(", ")}`)
  mkdirSync(context.launchAgentsDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(resolve(context.releaseRoot, "tmp/server-runtime/logs"), { recursive: true, mode: 0o700 })
  const created: string[] = []
  const bootstrapped: string[] = []
  try {
    for (const unit of context.units) {
      if (unit.plist_status === "missing") {
        atomicWrite(unit.destination, unit.content)
        created.push(unit.destination)
      }
      const result = context.execute(["/bin/launchctl", "bootstrap", context.domainTarget, unit.destination])
      if (result.exit_code !== 0) throw new Error(`launchctl bootstrap failed for ${unit.label}`)
      bootstrapped.push(unit.label)
    }
  } catch (error) {
    for (const label of [...bootstrapped].reverse()) {
      context.execute(["/bin/launchctl", "bootout", `${context.domainTarget}/${label}`])
    }
    for (const path of created) if (existsSync(path)) rmSync(path)
    throw error
  }
  return {
    ...managerProjection(loadContext(input), "install"),
    bootstrapped_labels: bootstrapped,
    installed: true,
    live_writes_allowed: false,
  }
}

export function uninstallServerRuntimeLaunchd(input: ServerRuntimeLaunchdManagerInput): JSONRecord {
  const context = loadContext(input)
  const removed: string[] = []
  for (const unit of [...context.units].reverse()) {
    context.execute(["/bin/launchctl", "bootout", `${context.domainTarget}/${unit.label}`])
    if (existsSync(unit.destination)) {
      if (hash(readFileSync(unit.destination)) !== unit.desired_hash) {
        throw new Error(`refusing to remove drifted launchd plist: ${unit.label}`)
      }
      rmSync(unit.destination)
      removed.push(unit.label)
    }
  }
  return {
    schema_version: "trade.server-runtime-launchd-manager.v1",
    action: "uninstall",
    release_id: context.releaseId,
    removed_labels: removed,
    installed: false,
    live_writes_allowed: false,
  }
}

export function restartServerRuntimeLaunchdComponent(
  input: ServerRuntimeLaunchdManagerInput,
  component: ComponentId,
): JSONRecord {
  if (!Object.hasOwn(SERVER_RUNTIME_LAUNCHD_LABELS, component)) throw new Error("component is not a fixed server runtime component")
  const context = loadContext(input)
  const label = SERVER_RUNTIME_LAUNCHD_LABELS[component]
  const unit = context.units.find((candidate) => candidate.label === label)
  if (!unit?.loaded) throw new Error("component is not loaded")
  const result = context.execute(["/bin/launchctl", "kickstart", "-k", `${context.domainTarget}/${label}`])
  if (result.exit_code !== 0) throw new Error(`launchctl kickstart failed for ${label}`)
  return {
    schema_version: "trade.server-runtime-launchd-manager.v1",
    action: "restart-component",
    release_id: context.releaseId,
    component,
    label,
    requested: true,
    live_writes_allowed: false,
  }
}

function loadContext(input: ServerRuntimeLaunchdManagerInput) {
  const releaseRoot = absolute(input.release_root, "release_root")
  const bunPath = absolute(input.bun_path, "bun_path")
  const manifest = JSON.parse(readFileSync(resolve(releaseRoot, "release-manifest.json"), "utf8")) as JSONRecord
  if (manifest.schema_version !== "trade.server-runtime-release-manifest.v1") throw new Error("unsupported release manifest")
  const releaseId = text(manifest.release_id, "release_id")
  if (manifest.profile_ref !== "profile/server-runtime-macos.json" || manifest.data_seed !== "empty_runtime_roots_only") {
    throw new Error("release manifest is not a state-free macOS server release")
  }
  const safety = record(manifest.safety)
  if (safety.domain_jobs_enabled !== false || safety.live_writes_allowed !== false || safety.notify_dry_run !== true) {
    throw new Error("release manifest safety widened")
  }
  const profile = parseServerRuntimeProfile(JSON.parse(
    readFileSync(resolve(releaseRoot, String(manifest.profile_ref)), "utf8"),
  ))
  if (profile.process_manager.target !== "launchd") throw new Error("release profile is not launchd")
  const rendered = renderServerRuntimeLaunchd(profile, releaseRoot, bunPath)
  const execute = input.execute ?? executeLaunchctl
  const uid = input.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1)
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("launchd requires a POSIX user id")
  const domainTarget = `gui/${uid}`
  const launchAgentsDirectory = absolute(
    input.launch_agents_directory ?? resolve(homedir(), "Library/LaunchAgents"),
    "launch_agents_directory",
  )
  const units = (["l2-owner", "l2-consumer", "control-runtime"] as ComponentId[]).map((component) => {
    const label = SERVER_RUNTIME_LAUNCHD_LABELS[component]
    const content = rendered.units[`${label}.plist`]
    const destination = resolve(launchAgentsDirectory, `${label}.plist`)
    const desiredHash = hash(Buffer.from(content))
    const existingHash = existsSync(destination) ? hash(readFileSync(destination)) : ""
    const state = serviceState(execute, `${domainTarget}/${label}`)
    return {
      component, label, content, destination, desired_hash: desiredHash,
      plist_status: !existingHash ? "missing" : existingHash === desiredHash ? "matched" : "drifted",
      loaded: state.loaded, state: state.state,
    }
  })
  return {
    releaseRoot, bunPath, releaseId, profile, rendered, execute, domainTarget,
    launchAgentsDirectory, units,
    preflight: preflightServerRuntime(profile, releaseRoot, bunPath),
  }
}

function managerProjection(context: ReturnType<typeof loadContext>, action: string): JSONRecord {
  return {
    schema_version: "trade.server-runtime-launchd-manager.v1",
    action,
    release_id: context.releaseId,
    process_authority: "launchd",
    preflight_status: context.preflight.status,
    units: context.units.map((unit) => ({
      component: unit.component,
      label: unit.label,
      desired_hash: unit.desired_hash,
      plist_status: unit.plist_status,
      loaded: unit.loaded,
      state: unit.state,
    })),
    installed: context.units.every((unit) => unit.plist_status === "matched" && unit.loaded),
    live_writes_allowed: false,
  }
}

function serviceState(execute: LaunchdCommandExecutor, target: string): { loaded: boolean; state: string } {
  const result = execute(["/bin/launchctl", "print", target])
  if (result.exit_code !== 0) return { loaded: false, state: "not_loaded" }
  const state = /\bstate\s*=\s*(not running|running|waiting|exited)\b/.exec(result.stdout)?.[1] ?? "loaded_unknown"
  return { loaded: true, state }
}

function executeLaunchctl(argv: string[]): LaunchdCommandResult {
  if (argv[0] !== "/bin/launchctl") throw new Error("launchd manager only executes /bin/launchctl")
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { exit_code: result.status ?? 127, stdout: result.stdout, stderr: result.stderr }
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, content, { mode: 0o600, flag: "wx" })
  renameSync(temporary, path)
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function absolute(value: string, field: string): string {
  if (!isAbsolute(value) || /[\n\r\0]/.test(value)) throw new Error(`${field} must be an absolute path`)
  return resolve(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`${field} must be a string`)
  return value
}

function record(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
