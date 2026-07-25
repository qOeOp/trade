import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"

export interface ReplayRegularFileSnapshot {
  bytes: Buffer
  device: number
  inode: number
}

export function readReplayRegularFile(
  path: string,
  label: string,
): ReplayRegularFileSnapshot {
  const value = readReplayRegularFileIfExists(path, label)
  if (!value) throw new Error(`${label} does not exist`)
  return value
}

export function readReplayRegularFileIfExists(
  path: string,
  label: string,
): ReplayRegularFileSnapshot | null {
  const directory = dirname(resolve(path))
  const directoryBefore = lstatSync(directory)
  if (!directoryBefore.isDirectory()
      || directoryBefore.isSymbolicLink()) {
    throw new Error(`${label} parent directory must be a real directory`)
  }
  let fileDescriptor: number
  try {
    fileDescriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if (isMissingFile(error)) return null
    throw new Error(`${label} must be a regular non-symlink file`, { cause: error })
  }
  try {
    const before = fstatSync(fileDescriptor)
    if (!before.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file`)
    }
    const bytes = readFileSync(fileDescriptor)
    const after = fstatSync(fileDescriptor)
    const directoryAfter = lstatSync(directory)
    if (before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs
        || !directoryAfter.isDirectory()
        || directoryAfter.isSymbolicLink()
        || directoryBefore.dev !== directoryAfter.dev
        || directoryBefore.ino !== directoryAfter.ino) {
      throw new Error(`${label} changed while reading`)
    }
    return {
      bytes,
      device: after.dev,
      inode: after.ino,
    }
  } finally {
    closeSync(fileDescriptor)
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
}
