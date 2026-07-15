import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"

export interface ReplayDurableFile {
  ref: string
  sha256: string
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
  const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex")
  if (actualHash !== expectedHash) {
    throw new Error("Replay immutable artifact CAS collision")
  }
  return { ref: path, sha256: actualHash }
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
