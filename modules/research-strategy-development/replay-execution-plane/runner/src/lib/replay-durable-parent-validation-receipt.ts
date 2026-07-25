import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export const REPLAY_DURABLE_PARENT_VALIDATION_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-durable-parent-validation-receipt.v1" as const

export interface ReplayDurableParentValidationReceipt {
  schema_version: typeof REPLAY_DURABLE_PARENT_VALIDATION_RECEIPT_SCHEMA_VERSION
  parent_kind:
    | "worker_v10_successor_verification_authority_contract"
    | "worker_v10_successor_lease_admission"
    | "worker_v10_successor_execution_envelope_admission"
    | "worker_v10_successor_execution_transport_admission"
    | "worker_v10_successor_execution_stdio_probe_admission"
  parent_key: string
  parent_self_hash: string
  parent_canonical_file_sha256: string
  validation_policy: "canonical_file_and_parent_self_hash_verified_before_receipt"
  receipt_hash: string
}

interface ValidatedParentCacheEntry {
  value: unknown
  lineage_files: Array<{
    path: string
    sha256: string
    device: number
    inode: number
  }>
}

const validatedParentCache = new Map<string, ValidatedParentCacheEntry>()

export function registerReplayDurableParentValidationReceipt(input: {
  registry_root: string
  parent_kind: ReplayDurableParentValidationReceipt["parent_kind"]
  parent_key: string
  parent_self_hash: string
  parent_canonical_content: string
}): ReplayDurableParentValidationReceipt {
  requireHash(input.parent_key, "durable parent validation key")
  requireHash(input.parent_self_hash, "durable parent validation self hash")
  const body: Omit<ReplayDurableParentValidationReceipt, "receipt_hash"> = {
    schema_version: REPLAY_DURABLE_PARENT_VALIDATION_RECEIPT_SCHEMA_VERSION,
    parent_kind: input.parent_kind,
    parent_key: input.parent_key,
    parent_self_hash: input.parent_self_hash,
    parent_canonical_file_sha256: sha256(input.parent_canonical_content),
    validation_policy: "canonical_file_and_parent_self_hash_verified_before_receipt",
  }
  const expected = { ...body, receipt_hash: canonicalHash(body) }
  const path = receiptPath(input.registry_root, input.parent_kind, input.parent_key)
  const existing = readReceiptFile(path)
  if (existing) return sameReceipt(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readReceiptFile(path)
    if (winner) return sameReceipt(winner, expected)
    throw error
  }
  return parseReceipt(content)
}

export function readReplayDurableParentValidationReceipt(input: {
  registry_root: string
  parent_kind: ReplayDurableParentValidationReceipt["parent_kind"]
  parent_key: string
}): ReplayDurableParentValidationReceipt | null {
  requireHash(input.parent_key, "durable parent validation key")
  return readReceiptFile(receiptPath(input.registry_root, input.parent_kind, input.parent_key))
}

export function assertReplayDurableParentValidationReceipt(
  value: ReplayDurableParentValidationReceipt,
): void {
  if (value.schema_version !== REPLAY_DURABLE_PARENT_VALIDATION_RECEIPT_SCHEMA_VERSION
      || (value.parent_kind !== "worker_v10_successor_verification_authority_contract"
        && value.parent_kind !== "worker_v10_successor_lease_admission"
        && value.parent_kind !== "worker_v10_successor_execution_envelope_admission"
        && value.parent_kind !== "worker_v10_successor_execution_transport_admission"
        && value.parent_kind !== "worker_v10_successor_execution_stdio_probe_admission")
      || value.validation_policy !== "canonical_file_and_parent_self_hash_verified_before_receipt") {
    throw new Error("unsupported durable parent validation receipt")
  }
  requireHash(value.parent_key, "durable parent validation key")
  requireHash(value.parent_self_hash, "durable parent validation self hash")
  requireHash(value.parent_canonical_file_sha256, "durable parent canonical file hash")
  requireHash(value.receipt_hash, "durable parent validation receipt hash")
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== canonicalHash(body)) {
    throw new Error("durable parent validation receipt hash mismatch")
  }
}

export function rememberReplayDurableParentValidation<T>(input: {
  registry_root: string
  parent_kind: ReplayDurableParentValidationReceipt["parent_kind"]
  parent_key: string
  parent_canonical_file_sha256: string
  value: T
}): void {
  requireHash(input.parent_key, "durable parent validation key")
  requireHash(input.parent_canonical_file_sha256, "durable parent canonical file hash")
  if (validatedParentCache.size >= 64) validatedParentCache.clear()
  validatedParentCache.set(validationCacheKey(input), {
    value: structuredClone(input.value),
    lineage_files: captureRootLineage(input.registry_root),
  })
}

export function readRememberedReplayDurableParentValidation<T>(input: {
  registry_root: string
  parent_kind: ReplayDurableParentValidationReceipt["parent_kind"]
  parent_key: string
  parent_canonical_file_sha256: string
}): T | null {
  requireHash(input.parent_key, "durable parent validation key")
  requireHash(input.parent_canonical_file_sha256, "durable parent canonical file hash")
  const key = validationCacheKey(input)
  const entry = validatedParentCache.get(key)
  if (!entry) return null
  if (!lineageIsCurrent(entry.lineage_files)) {
    validatedParentCache.delete(key)
    return null
  }
  return structuredClone(entry.value as T)
}

function readReceiptFile(path: string): ReplayDurableParentValidationReceipt | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("durable parent validation receipt must be a regular file")
  }
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseReceipt(content: string): ReplayDurableParentValidationReceipt {
  const value = JSON.parse(content) as ReplayDurableParentValidationReceipt
  assertReplayDurableParentValidationReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("durable parent validation receipt is not canonical")
  }
  return value
}

function sameReceipt(
  existing: ReplayDurableParentValidationReceipt,
  expected: ReplayDurableParentValidationReceipt,
): ReplayDurableParentValidationReceipt {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("durable parent validation receipt key has different evidence")
  }
  return existing
}

function receiptPath(
  root: string,
  parentKind: ReplayDurableParentValidationReceipt["parent_kind"],
  parentKey: string,
): string {
  return join(resolve(root), `parent-validation-${parentKind.replaceAll("_", "-")}-${parentKey}.json`)
}

function validationCacheKey(input: {
  registry_root: string
  parent_kind: ReplayDurableParentValidationReceipt["parent_kind"]
  parent_key: string
  parent_canonical_file_sha256: string
}): string {
  const root = resolve(input.registry_root)
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("durable parent validation root must be a real directory")
  }
  return [
    root,
    `${stat.dev}:${stat.ino}`,
    input.parent_kind,
    input.parent_key,
    input.parent_canonical_file_sha256,
  ].join("\u0000")
}

function captureRootLineage(root: string): ValidatedParentCacheEntry["lineage_files"] {
  const resolvedRoot = resolve(root)
  return readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => {
      const path = join(resolvedRoot, entry.name)
      const stat = lstatSync(path)
      return {
        path,
        sha256: sha256(readFileSync(path)),
        device: stat.dev,
        inode: stat.ino,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

function lineageIsCurrent(files: ValidatedParentCacheEntry["lineage_files"]): boolean {
  return files.every((file) => {
    if (!existsSync(file.path)) return false
    const stat = lstatSync(file.path)
    return stat.isFile()
      && !stat.isSymbolicLink()
      && stat.dev === file.device
      && stat.ino === file.inode
      && sha256(readFileSync(file.path)) === file.sha256
  })
}

function sha256(value: string | Uint8Array): string {
  const hash = createHash("sha256")
  if (typeof value === "string") hash.update(value, "utf8")
  else hash.update(value)
  return hash.digest("hex")
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be sha256`)
  }
}
