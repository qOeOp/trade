import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"

export function writeResidentWorkerState(path: string, value: Record<string, unknown>): void {
  const temporary = `${path}.tmp.${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, path)
}

export function classifyResidentWorkerFailure(
  error: unknown,
  ownerKind: "public" | "compute",
): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out/i.test(message)) return `${ownerKind}_owner_timeout`
  if (/capacity/i.test(message)) return "demand_capacity_blocked"
  if (/stopping/i.test(message)) return "shutdown"
  if (/identity|schema|hash|drift|collision/i.test(message)) return "owner_contract_drift"
  return `${ownerKind}_owner_unavailable`
}

export async function waitForResidentWorkerBackoff(
  intervalMs: number,
  consecutiveFailures: number,
  register: (cancel: () => void) => void,
): Promise<void> {
  const milliseconds = consecutiveFailures === 0
    ? intervalMs
    : Math.min(intervalMs, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 6))
  await new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds)
    register(() => {
      clearTimeout(timer)
      resolveDelay()
    })
  })
}

export function parseBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${field} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

export function resolveWorkerDataPath(
  root: string,
  value: string,
  label: string,
): string {
  const path = resolve(root, value)
  const dataRoot = resolve(root, "data")
  if (path !== dataRoot && !path.startsWith(`${dataRoot}${sep}`)) {
    throw new Error(`${label} escaped data root`)
  }
  return path
}

export function workerRepoPath(value: string, field: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")
      || value.includes("\0")) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

export function workerAbsolutePath(value: string, field: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.length > 512) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

export const workerBoundedInteger = parseBoundedInteger

export function workerDelay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function workerMarkReady(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) rmSync(path)
  writeFileSync(path, "ready\n", { flag: "wx", mode: 0o600 })
}

export function workerClearReady(path: string): void {
  if (existsSync(path)) rmSync(path)
}

export function workerWriteState(
  path: string,
  value: Readonly<Record<string, unknown>>,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function workerFlagValues(
  argv: string[],
  allowed: ReadonlySet<string>,
  label: string,
): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error(`${label} arguments must be --key value pairs`)
    }
    const key = flag.slice(2)
    if (!allowed.has(key)) throw new Error(`unknown argument: ${flag}`)
    if (values.has(key)) throw new Error(`duplicate argument: ${flag}`)
    values.set(key, value)
  }
  return values
}
