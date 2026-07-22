import { createHash } from "node:crypto"
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs"
import { dirname } from "node:path"

const MAGIC = Buffer.from("TL2S")
const HEADER_BYTES = 8
const FRAME_HEADER_BYTES = 8
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

export type RecoveryStatus = "complete" | "invalid_header" | "truncated_frame_header" | "invalid_length" | "truncated_payload" | "checksum_mismatch"

export interface SegmentWriteResult {
  schema_version: "trade.l2-segment-write-result.v1"
  implementation: "bun" | "go" | "rust"
  frame_count: number
  payload_bytes: number
  segment_bytes: number
  payload_hash: string
  segment_hash: string
  elapsed_ns: number
}

export interface SegmentRecoveryResult {
  schema_version: "trade.l2-segment-recovery-result.v1"
  implementation: "bun" | "go" | "rust"
  status: RecoveryStatus
  valid_frame_count: number
  valid_bytes: number
  payload_bytes: number
  payload_hash: string
  segment_bytes: number
  elapsed_ns: number
}

export function readJsonLines(path: string): Buffer[] {
  const raw = readFileSync(path)
  const lines = raw.toString("utf8").split("\n")
  if (lines.at(-1) === "") lines.pop()
  if (lines.length === 0 || lines.some((line) => line.length === 0)) throw new Error("input JSONL must contain non-empty lines")
  return lines.map((line) => Buffer.from(line))
}

export function writeSegment(outputPath: string, payloads: Buffer[]): SegmentWriteResult {
  if (payloads.length === 0) throw new Error("segment requires at least one payload")
  if (existsSync(outputPath)) throw new Error(`segment output already exists: ${outputPath}`)
  const partialPath = `${outputPath}.partial.${process.pid}.${Date.now()}`
  const startedAt = process.hrtime.bigint()
  const descriptor = openSync(partialPath, "wx", 0o600)
  let payloadBytes = 0
  const payloadHasher = createHash("sha256")
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    MAGIC.copy(header)
    header.writeUInt16BE(1, 4)
    header.writeUInt16BE(0, 6)
    writeAll(descriptor, header)
    for (const payload of payloads) {
      validatePayload(payload)
      const frameHeader = Buffer.alloc(FRAME_HEADER_BYTES)
      frameHeader.writeUInt32BE(payload.length, 0)
      frameHeader.writeUInt32BE(crc32(payload), 4)
      writeAll(descriptor, frameHeader)
      writeAll(descriptor, payload)
      payloadHasher.update(payload)
      payloadBytes += payload.length
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(partialPath, outputPath)
  syncDirectory(dirname(outputPath))
  const segment = readFileSync(outputPath)
  return {
    schema_version: "trade.l2-segment-write-result.v1",
    implementation: "bun",
    frame_count: payloads.length,
    payload_bytes: payloadBytes,
    segment_bytes: segment.length,
    payload_hash: payloadHasher.digest("hex"),
    segment_hash: sha256(segment),
    elapsed_ns: Number(process.hrtime.bigint() - startedAt),
  }
}

export function recoverSegment(path: string, salvageOutput?: string): SegmentRecoveryResult {
  const startedAt = process.hrtime.bigint()
  const segment = readFileSync(path)
  const payloadHasher = createHash("sha256")
  let status: RecoveryStatus = "complete"
  let offset = 0
  let validFrameCount = 0
  let payloadBytes = 0
  if (segment.length < HEADER_BYTES || !segment.subarray(0, 4).equals(MAGIC) || segment.readUInt16BE(4) !== 1 || segment.readUInt16BE(6) !== 0) {
    status = "invalid_header"
  } else {
    offset = HEADER_BYTES
    while (offset < segment.length) {
      if (segment.length - offset < FRAME_HEADER_BYTES) {
        status = "truncated_frame_header"
        break
      }
      const length = segment.readUInt32BE(offset)
      const expectedCrc = segment.readUInt32BE(offset + 4)
      if (length === 0 || length > MAX_PAYLOAD_BYTES) {
        status = "invalid_length"
        break
      }
      if (segment.length - offset - FRAME_HEADER_BYTES < length) {
        status = "truncated_payload"
        break
      }
      const payload = segment.subarray(offset + FRAME_HEADER_BYTES, offset + FRAME_HEADER_BYTES + length)
      if (crc32(payload) !== expectedCrc) {
        status = "checksum_mismatch"
        break
      }
      payloadHasher.update(payload)
      payloadBytes += payload.length
      validFrameCount += 1
      offset += FRAME_HEADER_BYTES + length
    }
  }
  if (salvageOutput != null) {
    if (existsSync(salvageOutput)) throw new Error(`salvage output already exists: ${salvageOutput}`)
    writeFileSync(salvageOutput, segment.subarray(0, offset), { flag: "wx", mode: 0o600 })
  }
  return {
    schema_version: "trade.l2-segment-recovery-result.v1",
    implementation: "bun",
    status,
    valid_frame_count: validFrameCount,
    valid_bytes: offset,
    payload_bytes: payloadBytes,
    payload_hash: payloadHasher.digest("hex"),
    segment_bytes: segment.length,
    elapsed_ns: Number(process.hrtime.bigint() - startedAt),
  }
}

function validatePayload(payload: Buffer): void {
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_BYTES) throw new Error(`payload length out of bounds: ${payload.length}`)
}

function writeAll(descriptor: number, buffer: Buffer): void {
  let offset = 0
  while (offset < buffer.length) offset += writeSync(descriptor, buffer, offset)
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

const CRC32_TABLE = buildCrc32Table()

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of value) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
}
