import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>

export function replayHarnessHash(): string {
  return requiredFingerprintHash(runLegacyReplayFingerprint({}), "harness_hash")
}

export function replayDataHash(manifestPath: string, timeframe: string, supplementalDataRefs: string[] = []): string {
  return requiredFingerprintHash(runLegacyReplayFingerprint({
    manifest_path: manifestPath,
    timeframe,
    supplemental_data_refs: supplementalDataRefs,
  }), "data_hash")
}

export function hashCanonical(value: unknown): string {
  return requiredFingerprintHash(runLegacyReplayFingerprint({ assumptions: value }), "assumptions_hash")
}

function runLegacyReplayFingerprint(input: JSONRecord): JSONRecord {
  const command = resolveRegisteredOwnerTool("research.legacy-replay-fingerprint", [
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
    throw new Error(`legacy replay fingerprint owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "legacy replay fingerprint owner tool returned ok=false")
  return response.data && typeof response.data === "object" && !Array.isArray(response.data)
    ? response.data as JSONRecord
    : response
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
