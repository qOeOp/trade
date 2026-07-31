import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import {
  L2_LAUNCH_RECEIPT_SCHEMA,
  assertRuntimeRef,
  processMatchesL2Supervisor,
  type LaunchReceipt,
} from "./runtime-contract"

export interface L2RuntimeArchiveMove {
  runtime_directory: string
  archive_directory: string
  reason: "inactive_supervisor" | "incomplete_receipt"
}

export interface L2RuntimeGcDependencies {
  process_matches_supervisor?: (pid: number, runtimeDirectory: string) => boolean
  directory_mtime_ms?: (path: string) => number
}

export function planInactiveL2RuntimeArchive(
  root: string,
  observedAt: string,
  minimumAgeMs = 60_000,
  dependencies: L2RuntimeGcDependencies = {},
): L2RuntimeArchiveMove[] {
  const observedAtMs = Date.parse(observedAt)
  if (!Number.isFinite(observedAtMs)) throw new Error("observedAt must be an ISO timestamp")
  if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 60_000 || minimumAgeMs > 86_400_000) {
    throw new Error("minimumAgeMs must be between 60000 and 86400000")
  }
  const runtimeRoot = assertRuntimeRef(root, "tmp/l2-order-book-service/runtime")
  if (!existsSync(runtimeRoot)) return []
  const archiveRoot = assertRuntimeRef(root, "tmp/l2-order-book-service/archive")
  const processMatches = dependencies.process_matches_supervisor ?? processMatchesL2Supervisor
  const directoryMtime = dependencies.directory_mtime_ms ?? ((path: string) => statSync(path).mtimeMs)
  const moves: L2RuntimeArchiveMove[] = []
  const entries = readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))
  if (entries.length > 10_000) throw new Error("L2 runtime GC requires operator review above 10000 entries")
  for (const entry of entries) {
    const runtimeDirectory = resolve(runtimeRoot, entry.name)
    if (observedAtMs - directoryMtime(runtimeDirectory) < minimumAgeMs) continue
    const receiptPath = resolve(runtimeDirectory, "launch-receipt.json")
    let reason: L2RuntimeArchiveMove["reason"] = "incomplete_receipt"
    if (existsSync(receiptPath)) {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as LaunchReceipt
      if (receipt.schema_version !== L2_LAUNCH_RECEIPT_SCHEMA) {
        throw new Error(`unsupported L2 launch receipt in ${entry.name}`)
      }
      if (basename(receipt.runtime_directory) !== entry.name) {
        throw new Error(`L2 launch receipt directory identity drifted in ${entry.name}`)
      }
      if (processMatches(receipt.supervisor_pid, receipt.runtime_directory)) continue
      reason = "inactive_supervisor"
    }
    const archiveDirectory = resolve(archiveRoot, entry.name)
    if (existsSync(archiveDirectory)) throw new Error(`L2 runtime archive collision for ${entry.name}`)
    moves.push({
      runtime_directory: assertRuntimeRef(root, `tmp/l2-order-book-service/runtime/${entry.name}`),
      archive_directory: assertRuntimeRef(root, `tmp/l2-order-book-service/archive/${entry.name}`),
      reason,
    })
  }
  return moves
}

export function archiveInactiveL2Runtimes(
  root: string,
  observedAt: string,
  minimumAgeMs = 60_000,
  dependencies: L2RuntimeGcDependencies = {},
): L2RuntimeArchiveMove[] {
  const moves = planInactiveL2RuntimeArchive(root, observedAt, minimumAgeMs, dependencies)
  if (moves.length === 0) return moves
  mkdirSync(assertRuntimeRef(root, "tmp/l2-order-book-service/archive"), { recursive: true, mode: 0o700 })
  for (const move of moves) renameSync(move.runtime_directory, move.archive_directory)
  return moves
}
