import { createHash } from "node:crypto"
import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>

export function replayHarnessHash(): string {
  return requiredFingerprintHash(runReplayRunnerFingerprint({}), "harness_hash")
}

export function replayDataHash(manifestPath: string, timeframe: string, supplementalDataRefs: string[] = []): string {
  return requiredFingerprintHash(runReplayRunnerFingerprint({
    manifest_path: manifestPath,
    timeframe,
    supplemental_data_refs: supplementalDataRefs,
  }), "data_hash")
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function runReplayRunnerFingerprint(input: JSONRecord): JSONRecord {
  const command = resolveRegisteredOwnerTool("research.replay-runner", [
    "--fingerprint",
    "--json",
    JSON.stringify(input),
  ])
  const proc = Bun.spawnSync(command.argv, {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  const response = parseJsonRecord(stdout)
  if (!proc.success) {
    if (response.ok === false && typeof response.error === "string") throw new Error(response.error)
    throw new Error(`replay runner owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "replay runner owner tool returned ok=false")
  return response.data && typeof response.data === "object" && !Array.isArray(response.data)
    ? response.data as JSONRecord
    : response
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JSONRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function parseJsonRecord(raw: string): JSONRecord {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JSONRecord : {}
  } catch {
    return {}
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function requiredFingerprintHash(value: JSONRecord, field: "harness_hash" | "data_hash" | "assumptions_hash"): string {
  const hash = stringField(value[field])
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`replay fingerprint missing valid ${field}`)
  }
  return hash
}
