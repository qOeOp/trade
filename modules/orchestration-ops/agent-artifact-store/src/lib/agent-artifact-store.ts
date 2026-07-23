import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { resolve, sep } from "node:path"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"

export type AgentArtifactStorage = "durable" | "temporary"
export type AgentArtifactMediaType = AgentArtifactRef["media_type"]

export interface MaterializedAgentArtifact {
  artifact: AgentArtifactRef
  text: string
}

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024

export function writeAgentTextArtifact(input: {
  repository_root: string
  storage: AgentArtifactStorage
  media_type: AgentArtifactMediaType
  text: string
}): AgentArtifactRef {
  const root = repositoryRoot(input.repository_root)
  const text = boundedText(input.text)
  rejectSecretLike(text)
  const bytes = Buffer.from(text, "utf8")
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error("Agent artifact exceeds byte limit")
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const storeRoot = ensureStoreRoot(root, input.storage)
  const path = resolve(storeRoot, sha256)
  assertInside(storeRoot, path)
  if (existsSync(path)) {
    if (!lstatSync(path).isFile() || !readFileSync(path).equals(bytes)) {
      throw new Error("Agent artifact content-address collision")
    }
  } else {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 })
  }
  return {
    ref: `agent-artifact://${input.storage}/${sha256}`,
    sha256,
    media_type: input.media_type,
    bytes: bytes.byteLength,
  }
}

export function writeAgentJsonArtifact(input: {
  repository_root: string
  storage: AgentArtifactStorage
  value: unknown
}): AgentArtifactRef {
  return writeAgentTextArtifact({
    repository_root: input.repository_root,
    storage: input.storage,
    media_type: "application/json",
    text: canonicalJson(input.value),
  })
}

export function readAgentArtifact(
  repositoryRootValue: string,
  artifact: AgentArtifactRef,
): MaterializedAgentArtifact {
  const root = repositoryRoot(repositoryRootValue)
  const parsed = parseRef(artifact.ref)
  if (parsed.sha256 !== artifact.sha256) throw new Error("Agent artifact ref and digest drifted")
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > MAX_ARTIFACT_BYTES) {
    throw new Error("Agent artifact byte count is invalid")
  }
  const storeRoot = ensureStoreRoot(root, parsed.storage)
  const path = resolve(storeRoot, parsed.sha256)
  assertInside(storeRoot, path)
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error("Agent artifact is missing")
  const bytes = readFileSync(path)
  if (bytes.byteLength !== artifact.bytes
    || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
    throw new Error("Agent artifact bytes or digest drifted")
  }
  const text = bytes.toString("utf8")
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("Agent artifact is not valid UTF-8 text")
  rejectSecretLike(text)
  return { artifact: structuredClone(artifact), text }
}

export function parseAgentJsonArtifact(
  repositoryRootValue: string,
  artifact: AgentArtifactRef,
): unknown {
  if (artifact.media_type !== "application/json") throw new Error("Agent artifact is not JSON")
  return JSON.parse(readAgentArtifact(repositoryRootValue, artifact).text)
}

function ensureStoreRoot(root: string, storage: AgentArtifactStorage): string {
  const path = resolve(root, storage === "durable"
    ? "data/artifacts/agent-runs"
    : "tmp/agent-runs/artifacts")
  assertInside(root, path)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const actual = realpathSync(path)
  if (actual !== path) throw new Error("Agent artifact store root must not be a symlink")
  chmodSync(path, 0o700)
  return path
}

function parseRef(ref: string): { storage: AgentArtifactStorage; sha256: string } {
  const match = /^agent-artifact:\/\/(durable|temporary)\/([a-f0-9]{64})$/.exec(ref)
  if (!match) throw new Error("Agent artifact ref is unsupported")
  return { storage: match[1] as AgentArtifactStorage, sha256: match[2]! }
}

function repositoryRoot(value: string): string {
  const root = realpathSync(resolve(value))
  if (!lstatSync(root).isDirectory()) throw new Error("repository_root must be a directory")
  return root
}

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Agent artifact path escaped repository")
}

function boundedText(value: string): string {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Agent artifact must be text")
  return value
}

function rejectSecretLike(value: string): void {
  if (/(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/i.test(value)
    || /authorization\s*:\s*(?:bearer|basic)\s+\S+/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\b(?:password|api[_-]?key|secret|token)\s*[:=]\s*["']?\S{8,}/i.test(value)) {
    throw new Error("Agent artifact contains secret-like material")
  }
}
