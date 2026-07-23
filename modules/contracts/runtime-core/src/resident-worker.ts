import { renameSync, writeFileSync } from "node:fs"

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
