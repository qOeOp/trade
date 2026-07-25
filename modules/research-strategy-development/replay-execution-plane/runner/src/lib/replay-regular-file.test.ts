import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readReplayRegularFile, readReplayRegularFileIfExists } from "./replay-regular-file"

test("regular file snapshots reject path substitution primitives", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-regular-file-"))
  try {
    const file = join(root, "evidence.json")
    const symlink = join(root, "evidence-link.json")
    const directory = join(root, "evidence-directory")
    const linkedDirectory = join(root, "linked-directory")
    writeFileSync(file, "{\"trusted\":true}\n", "utf8")
    symlinkSync(file, symlink)
    mkdirSync(directory)
    symlinkSync(directory, linkedDirectory)

    expect(readReplayRegularFile(file, "Replay evidence").bytes.toString("utf8"))
      .toBe("{\"trusted\":true}\n")
    expect(readReplayRegularFileIfExists(join(root, "missing.json"), "Replay evidence"))
      .toBeNull()
    expect(() => readReplayRegularFile(symlink, "Replay evidence"))
      .toThrow("must be a regular non-symlink file")
    expect(() => readReplayRegularFile(directory, "Replay evidence"))
      .toThrow("must be a regular non-symlink file")
    expect(() => readReplayRegularFile(join(linkedDirectory, "evidence.json"), "Replay evidence"))
      .toThrow("parent directory must be a real directory")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
