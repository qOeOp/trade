import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { recoverSegment, writeSegment } from "./segment"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true })
})

describe("TL2S raw segment", () => {
  test("round-trips exact frames and detects a truncated tail", () => {
    const directory = temporaryDirectory()
    const path = join(directory, "complete.tl2s")
    const payloads = [Buffer.from("first"), Buffer.from("second-payload")]
    const written = writeSegment(path, payloads)
    expect(written.frame_count).toBe(2)
    expect(recoverSegment(path).status).toBe("complete")

    const truncatedPath = join(directory, "truncated.tl2s")
    const segment = readFileSync(path)
    writeFileSync(truncatedPath, segment.subarray(0, segment.length - 3))
    const recovered = recoverSegment(truncatedPath)
    expect(recovered.status).toBe("truncated_payload")
    expect(recovered.valid_frame_count).toBe(1)
  })

  test("rejects checksum corruption without consuming the bad frame", () => {
    const directory = temporaryDirectory()
    const path = join(directory, "complete.tl2s")
    writeSegment(path, [Buffer.from("first"), Buffer.from("second")])
    const corrupt = readFileSync(path)
    corrupt[corrupt.length - 1] ^= 0xff
    const corruptPath = join(directory, "corrupt.tl2s")
    writeFileSync(corruptPath, corrupt)
    const recovered = recoverSegment(corruptPath)
    expect(recovered.status).toBe("checksum_mismatch")
    expect(recovered.valid_frame_count).toBe(1)
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "trade-l2-segment-"))
  temporaryDirectories.push(directory)
  return directory
}
