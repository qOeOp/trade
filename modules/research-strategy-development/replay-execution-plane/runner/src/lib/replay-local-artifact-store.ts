import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  type Dirent,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayArtifactAttemptIdentity,
  ReplayArtifactDiscoveryStore,
  ReplayArtifactNamespace,
  ReplayArtifactReadFile,
} from "./replay-artifact-store"

export interface ReplayDurableFile {
  ref: string
  sha256: string
}

export function createReplayLocalArtifactStore(root: string): ReplayArtifactDiscoveryStore {
  return new ReplayLocalArtifactStore(root)
}

class ReplayLocalArtifactStore implements ReplayArtifactDiscoveryStore {
  readonly capability = REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY
  readonly #root: string

  constructor(root: string) {
    if (root.trim() === "") throw new Error("Replay local Artifact Store root is required")
    this.#root = resolve(root)
  }

  openAttempt(identity: ReplayArtifactAttemptIdentity): ReplayArtifactNamespace {
    requireHash(identity.idempotency_key_hash, "idempotency_key_hash")
    requireHash(identity.attempt_id_hash, "attempt_id_hash")
    return new ReplayLocalArtifactNamespace(join(
      this.#root,
      identity.idempotency_key_hash.slice(0, 24),
      identity.attempt_id_hash.slice(0, 24),
    ))
  }

  discoverAttemptNamespaces(): ReplayArtifactNamespace[] {
    if (!existsSync(this.#root)) return []
    const namespaces: ReplayArtifactNamespace[] = []
    for (const idempotencyDirectory of readDiscoveryDirectories(this.#root)) {
      requireDiscoveryDirectoryName(idempotencyDirectory.name)
      const idempotencyPath = join(this.#root, idempotencyDirectory.name)
      for (const attemptDirectory of readDiscoveryDirectories(idempotencyPath)) {
        requireDiscoveryDirectoryName(attemptDirectory.name)
        namespaces.push(new ReplayLocalArtifactNamespace(join(idempotencyPath, attemptDirectory.name)))
      }
    }
    return namespaces.sort((left, right) => left.namespace_ref.localeCompare(right.namespace_ref))
  }
}

class ReplayLocalArtifactNamespace implements ReplayArtifactNamespace {
  readonly namespace_ref: string

  constructor(directory: string) {
    this.namespace_ref = resolve(directory)
  }

  fileRef(name: string): string {
    requireFileName(name)
    return join(this.namespace_ref, name)
  }

  exists(name: string): boolean {
    return existsSync(this.fileRef(name))
  }

  listNames(): string[] {
    return existsSync(this.namespace_ref) ? readdirNames(this.namespace_ref) : []
  }

  read(name: string): ReplayArtifactReadFile {
    const ref = this.fileRef(name)
    assertRegularFile(ref)
    return { name, ref, bytes: readFileSync(ref) }
  }

  readRef(ref: string): ReplayArtifactReadFile {
    const resolvedRef = resolve(ref)
    const name = relative(this.namespace_ref, resolvedRef)
    if (resolvedRef !== ref || name === "" || name === ".." || name.startsWith(`..${sep}`) || name.includes(sep)) {
      throw new Error("Replay Artifact Store ref is outside the Attempt namespace")
    }
    requireFileName(name)
    return this.read(name)
  }

  writeImmutable(name: string, content: string): ReplayDurableFile {
    return writeReplayImmutableCas(this.fileRef(name), content)
  }

  remove(name: string): void {
    removeReplayDurableFile(this.fileRef(name))
  }
}

export function ensureReplayDurableDirectory(directory: string): void {
  const target = resolve(directory)
  const missing: string[] = []
  let cursor = target
  while (!existsSync(cursor)) {
    missing.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error("Replay artifact directory has no existing filesystem ancestor")
    cursor = parent
  }
  for (const path of missing.reverse()) {
    mkdirSync(path)
    fsyncDirectory(dirname(path))
  }
  fsyncDirectory(target)
}

export function writeReplayDurableAtomic(path: string, content: string): ReplayDurableFile {
  ensureReplayDurableDirectory(dirname(path))
  const sha256 = digest(content)
  const temporary = temporaryPath(path)
  writeDurableTemporary(temporary, content)
  try {
    renameSync(temporary, path)
    fsyncDirectory(dirname(path))
  } catch (error) {
    removeIfPresent(temporary)
    throw error
  }
  return { ref: path, sha256 }
}

export function writeReplayImmutableCas(path: string, content: string): ReplayDurableFile {
  ensureReplayDurableDirectory(dirname(path))
  const sha256 = digest(content)
  if (existsSync(path)) return assertExisting(path, sha256)
  const temporary = temporaryPath(path)
  writeDurableTemporary(temporary, content)
  try {
    try {
      linkSync(temporary, path)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      return assertExisting(path, sha256)
    }
    return { ref: path, sha256 }
  } finally {
    removeIfPresent(temporary)
    fsyncDirectory(dirname(path))
  }
}

export function removeReplayDurableFile(path: string): void {
  if (!existsSync(path)) return
  unlinkSync(path)
  fsyncDirectory(dirname(path))
}

function writeDurableTemporary(path: string, content: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, "wx", 0o600)
    writeFileSync(descriptor, content, "utf8")
    fsyncSync(descriptor)
  } catch (error) {
    removeIfPresent(path)
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function assertExisting(path: string, expectedHash: string): ReplayDurableFile {
  assertRegularFile(path)
  const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex")
  if (actualHash !== expectedHash) {
    throw new Error("Replay immutable artifact CAS collision")
  }
  return { ref: path, sha256: actualHash }
}

function assertRegularFile(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Artifact Store ref must be a regular file, not a link")
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function temporaryPath(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp`
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

function readdirNames(directory: string): string[] {
  return readdirSync(directory).sort((left, right) => left.localeCompare(right))
}

function readDiscoveryDirectories(directory: string): Dirent[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry) => {
      if (entry.isSymbolicLink()) throw new Error("Replay Artifact Store discovery refuses symbolic links")
      if (!entry.isDirectory()) throw new Error("Replay Artifact Store discovery requires a two-level directory tree")
      return true
    })
}

function requireDiscoveryDirectoryName(name: string): void {
  if (!/^[a-f0-9]{24}$/.test(name)) {
    throw new Error("Replay Artifact Store discovery found a non-canonical namespace directory")
  }
}

function requireFileName(name: string): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(name)) {
    throw new Error("Replay Artifact Store file name must be an ASCII Attempt-local basename")
  }
}

function requireHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Replay Artifact Store ${field} must be a sha256 digest`)
}
