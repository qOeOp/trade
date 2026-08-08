#!/usr/bin/env bun

import { createHash } from "node:crypto"

const INPUT_SCHEMA = "delivery-barrier-input/v3"
const EVIDENCE_SCHEMA = "delivery-barrier-evidence/v3"
const RECEIPT_SCHEMA = "delivery-barrier-receipt/v3"
const EVIDENCE_KINDS = [
  "real_consumer",
  "root",
  "audit",
  "ci",
  "conversation",
  "drift",
] as const

type EvidenceKind = typeof EVIDENCE_KINDS[number]

interface EvidenceLocator {
  kind: EvidenceKind
  locator: string
  head_oid: string
  result: string
  content_sha256: string | null
}

interface BarrierEvidence {
  schema: typeof EVIDENCE_SCHEMA
  repository: string
  pull_request: number
  head_oid: string
  head_tree_oid: string
  base_ref: string
  base_oid: string
  merge_commit_oid: string
  merge_tree_oid: string
  queue_state: string
  evidence: EvidenceLocator[]
}

interface BarrierReceipt {
  schema: typeof RECEIPT_SCHEMA
  bytes: number
  sha256: string
  receipt: BarrierEvidence
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function isOid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}

function isPullRequest(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isBoundedAtom(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && [...value].every((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint > 31 && codePoint !== 127
        && (codePoint < 0xd800 || codePoint > 0xdfff)
    })
}

function isBaseRef(value: unknown): value is string {
  return isBoundedAtom(value, 255)
    && value !== "@"
    && !value.startsWith("-")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.includes("//")
    && !value.includes("..")
    && !value.includes("@{")
    && !/[ ~^:?*\[\]\\]/.test(value)
    && value.split("/").every((part) =>
      part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"))
}

function normalizeRepository(value: unknown): string {
  if (typeof value !== "string") throw new Error("repository must be owner/name")
  const match = /^([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/([a-z\d._-]{1,100})$/i.exec(value)
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error("repository must be owner/name")
  }
  return `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("canonical JSON contains an unsupported value")
  return encoded
}

function canonicalLine(value: unknown): string {
  return `${canonicalJson(value)}\n`
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index])
}

function parseCanonicalLine(bytes: Uint8Array, label: string): unknown {
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
  if (decoded === "" || !decoded.endsWith("\n") || decoded.slice(0, -1).includes("\n")) {
    throw new Error(`${label} must be one canonical JSON-LF record`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded.slice(0, -1))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!equalBytes(new TextEncoder().encode(canonicalLine(parsed)), bytes)) {
    throw new Error(`${label} is not canonical JSON-LF`)
  }
  return parsed
}

function rejectDuplicateMembers(source: string): void {
  let offset = 0
  const whitespace = /[\t\n\r ]/
  const skipWhitespace = (): void => {
    while (whitespace.test(source[offset] ?? "")) offset += 1
  }
  const readString = (): string => {
    const start = offset
    if (source[offset] !== '"') throw new Error("delivery input is not valid JSON")
    offset += 1
    while (offset < source.length) {
      if (source[offset] === "\\") {
        offset += 2
      } else if (source[offset] === '"') {
        offset += 1
        return JSON.parse(source.slice(start, offset)) as string
      } else {
        offset += 1
      }
    }
    throw new Error("delivery input is not valid JSON")
  }
  const readValue = (): void => {
    skipWhitespace()
    if (source[offset] === "{") {
      offset += 1
      const keys = new Set<string>()
      skipWhitespace()
      if (source[offset] === "}") {
        offset += 1
        return
      }
      while (offset < source.length) {
        skipWhitespace()
        const key = readString()
        if (keys.has(key)) throw new Error(`delivery input has duplicate member ${JSON.stringify(key)}`)
        keys.add(key)
        skipWhitespace()
        if (source[offset] !== ":") throw new Error("delivery input is not valid JSON")
        offset += 1
        readValue()
        skipWhitespace()
        if (source[offset] === "}") {
          offset += 1
          return
        }
        if (source[offset] !== ",") throw new Error("delivery input is not valid JSON")
        offset += 1
      }
      throw new Error("delivery input is not valid JSON")
    }
    if (source[offset] === "[") {
      offset += 1
      skipWhitespace()
      if (source[offset] === "]") {
        offset += 1
        return
      }
      while (offset < source.length) {
        readValue()
        skipWhitespace()
        if (source[offset] === "]") {
          offset += 1
          return
        }
        if (source[offset] !== ",") throw new Error("delivery input is not valid JSON")
        offset += 1
      }
      throw new Error("delivery input is not valid JSON")
    }
    if (source[offset] === '"') {
      readString()
      return
    }
    const start = offset
    while (offset < source.length && !/[\t\n\r ,\]}]/.test(source[offset]!)) offset += 1
    if (offset === start) throw new Error("delivery input is not valid JSON")
  }
  readValue()
  skipWhitespace()
  if (offset !== source.length) throw new Error("delivery input is not valid JSON")
}

function parseInput(bytes: Uint8Array): unknown {
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error("delivery input is not valid UTF-8")
  }
  if (decoded.trim() === "") throw new Error("delivery input is empty")
  rejectDuplicateMembers(decoded)
  try {
    return JSON.parse(decoded)
  } catch {
    throw new Error("delivery input is not valid JSON")
  }
}

function gitOutput(args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : null
}

function commitTree(oid: string): string | null {
  if (gitOutput(["cat-file", "-t", oid]) !== "commit") return null
  const tree = gitOutput(["rev-parse", "--verify", "--end-of-options", `${oid}^{tree}`])
  return isOid(tree) ? tree : null
}

function mergeTree(baseOid: string, headOid: string): string | null {
  const tree = gitOutput(["merge-tree", "--write-tree", baseOid, headOid])
  return isOid(tree) && gitOutput(["cat-file", "-t", tree]) === "tree" ? tree : null
}

function normalizeEvidence(value: unknown, headOid: string): EvidenceLocator[] {
  if (!Array.isArray(value) || value.length < EVIDENCE_KINDS.length || value.length > 24) {
    throw new Error("evidence must contain the bounded required kinds")
  }
  const order = new Map(EVIDENCE_KINDS.map((kind, index) => [kind, index]))
  const seen = new Set<string>()
  const normalized = value.map((entry): EvidenceLocator => {
    if (!isRecord(entry) || !hasExactKeys(entry, [
      "kind", "locator", "head_oid", "result", "content_sha256",
    ])) throw new Error("evidence locator has unknown or missing fields")
    if (typeof entry.kind !== "string" || !order.has(entry.kind as EvidenceKind)) {
      throw new Error("evidence kind is unknown")
    }
    if (!isBoundedAtom(entry.locator, 2048) || !isBoundedAtom(entry.result, 256)) {
      throw new Error("evidence locator or result is invalid")
    }
    if (entry.head_oid !== headOid) throw new Error("evidence head does not match candidate")
    if (entry.content_sha256 !== null && !isSha256(entry.content_sha256)) {
      throw new Error("evidence digest is invalid")
    }
    if (entry.result !== "pass" && !(entry.kind === "audit" && entry.result === "not_required")) {
      throw new Error(`evidence ${entry.kind} result is not accepted`)
    }
    if (entry.result === "not_required"
      && (!entry.locator.startsWith("predicate:") || entry.content_sha256 === null)) {
      throw new Error("audit not_required must bind a predicate locator and digest")
    }
    const key = `${entry.kind}\u0000${entry.locator}`
    if (seen.has(key)) throw new Error("evidence locator is duplicated")
    seen.add(key)
    return {
      kind: entry.kind as EvidenceKind,
      locator: entry.locator,
      head_oid: headOid,
      result: entry.result,
      content_sha256: entry.content_sha256 as string | null,
    }
  })
  for (const kind of EVIDENCE_KINDS) {
    if (!normalized.some((entry) => entry.kind === kind)) {
      throw new Error(`evidence is missing ${kind}`)
    }
  }
  return normalized.sort((left, right) =>
    order.get(left.kind)! - order.get(right.kind)!
      || (left.locator < right.locator ? -1 : left.locator > right.locator ? 1 : 0))
}

function normalizeInput(value: unknown): BarrierEvidence {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema", "repository", "pull_request", "head_oid", "head_tree_oid", "base_ref", "base_oid",
    "potential_merge_commit", "queue_state", "evidence",
  ]) || value.schema !== INPUT_SCHEMA) {
    throw new Error("delivery input has an invalid schema or fields")
  }
  if (!isPullRequest(value.pull_request)
    || !isOid(value.head_oid)
    || !isOid(value.head_tree_oid)
    || !isBaseRef(value.base_ref)
    || !isOid(value.base_oid)
    || !isBoundedAtom(value.queue_state, 128)
    || !isRecord(value.potential_merge_commit)
    || !hasExactKeys(value.potential_merge_commit, ["oid", "tree"])
    || !isOid(value.potential_merge_commit.oid)
    || !isRecord(value.potential_merge_commit.tree)
    || !hasExactKeys(value.potential_merge_commit.tree, ["oid"])
    || !isOid(value.potential_merge_commit.tree.oid)
    || value.potential_merge_commit.oid === value.potential_merge_commit.tree.oid) {
    throw new Error("delivery identity or merge representation is invalid")
  }
  if (commitTree(value.head_oid) !== value.head_tree_oid) {
    throw new Error("candidate tree does not match the local head commit")
  }
  if (mergeTree(value.base_oid, value.head_oid) !== value.potential_merge_commit.tree.oid) {
    throw new Error("merge tree does not match local base and head")
  }
  return {
    schema: EVIDENCE_SCHEMA,
    repository: normalizeRepository(value.repository),
    pull_request: value.pull_request,
    head_oid: value.head_oid,
    head_tree_oid: value.head_tree_oid,
    base_ref: value.base_ref,
    base_oid: value.base_oid,
    merge_commit_oid: value.potential_merge_commit.oid,
    merge_tree_oid: value.potential_merge_commit.tree.oid,
    queue_state: value.queue_state,
    evidence: normalizeEvidence(value.evidence, value.head_oid),
  }
}

function createReceipt(bytes: Uint8Array): BarrierReceipt {
  // The owner, not its callers, owns deterministic key order and byte serialization.
  const receipt = normalizeInput(parseInput(bytes))
  const inner = canonicalLine(receipt)
  return {
    schema: RECEIPT_SCHEMA,
    bytes: Buffer.byteLength(inner),
    sha256: `sha256:${createHash("sha256").update(inner).digest("hex")}`,
    receipt,
  }
}

function verifyReceipt(bytes: Uint8Array, expectedSha256: string): BarrierReceipt {
  if (!isSha256(expectedSha256)) throw new Error("expected receipt digest is invalid")
  const value = parseCanonicalLine(bytes, "delivery receipt")
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "bytes", "sha256", "receipt"])
    || value.schema !== RECEIPT_SCHEMA
    || !Number.isSafeInteger(value.bytes) || (value.bytes as number) <= 0
    || value.sha256 !== expectedSha256 || !isRecord(value.receipt)) {
    throw new Error("delivery receipt envelope is invalid")
  }
  if (!hasExactKeys(value.receipt, [
    "schema", "repository", "pull_request", "head_oid", "head_tree_oid", "base_ref", "base_oid",
    "merge_commit_oid", "merge_tree_oid", "queue_state", "evidence",
  ]) || value.receipt.schema !== EVIDENCE_SCHEMA
    || !isOid(value.receipt.merge_commit_oid) || !isOid(value.receipt.merge_tree_oid)) {
    throw new Error("delivery receipt evidence is invalid")
  }
  const input = {
    schema: INPUT_SCHEMA,
    repository: value.receipt.repository,
    pull_request: value.receipt.pull_request,
    head_oid: value.receipt.head_oid,
    head_tree_oid: value.receipt.head_tree_oid,
    base_ref: value.receipt.base_ref,
    base_oid: value.receipt.base_oid,
    potential_merge_commit: {
      oid: value.receipt.merge_commit_oid,
      tree: { oid: value.receipt.merge_tree_oid },
    },
    queue_state: value.receipt.queue_state,
    evidence: value.receipt.evidence,
  }
  const receipt = normalizeInput(input)
  const inner = canonicalLine(receipt)
  const observed = `sha256:${createHash("sha256").update(inner).digest("hex")}`
  const replayed: BarrierReceipt = {
    schema: RECEIPT_SCHEMA,
    bytes: value.bytes as number,
    sha256: value.sha256 as string,
    receipt,
  }
  if (value.bytes !== Buffer.byteLength(inner) || value.sha256 !== observed
    || canonicalLine(value.receipt) !== inner
    || !equalBytes(new TextEncoder().encode(canonicalLine(replayed)), bytes)) {
    throw new Error("delivery receipt bytes or digest do not replay")
  }
  return replayed
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  try {
    if (args.length === 1 && args[0] === "create") {
      process.stdout.write(canonicalLine(createReceipt(
        new Uint8Array(await Bun.stdin.arrayBuffer()),
      )))
      return 0
    }
    if (args.length === 3 && args[0] === "verify" && args[1] === "--sha256") {
      process.stdout.write(canonicalLine(verifyReceipt(
        new Uint8Array(await Bun.stdin.arrayBuffer()),
        args[2]!,
      )))
      return 0
    }
    throw new Error("usage: delivery-receipt.ts create | verify --sha256 <sha256:digest>")
  } catch (error) {
    console.error(`delivery-receipt: failed: ${error instanceof Error ? error.message : "invalid input"}`)
    return 2
  }
}

if (import.meta.main) process.exitCode = await main()
