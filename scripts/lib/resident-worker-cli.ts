import { resolve, sep } from "node:path"

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

export function workerBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return number
}

export function workerDelay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
