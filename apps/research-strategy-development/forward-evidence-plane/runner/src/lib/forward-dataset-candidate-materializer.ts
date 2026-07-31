import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"
import {
  canonicalJson,
  type ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  type ForwardObservationCandleSegment,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-candle-segment"
import {
  type ForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import {
  createForwardDatasetCandidate,
  type ForwardDatasetCandidate,
} from "../../../contracts/src/lib/forward-dataset-candidate"

export function materializeForwardDatasetCandidate(input: {
  repository_root: string
  program: ForwardObservationProgram
  segments: ForwardObservationCandleSegment[]
  created_at: string
}): {
  candidate: ForwardDatasetCandidate
  bars: ReplayMarketBar[]
  artifact_status: "created" | "existing"
} {
  const root = realpathSync(input.repository_root)
  const bars = input.segments.flatMap((segment) => (
    readSegmentBars(root, segment)
  ))
  const payload = canonicalJson({
    bars,
    funding_events: [],
    mark_events: [],
    supplemental_facts: [],
  })
  const contentHash = createHash("sha256").update(payload).digest("hex")
  const artifactRef =
    `data/artifacts/research/forward-dataset-candidates/${contentHash}/dataset.json`
  const artifactStatus = writeImmutable(
    root,
    artifactRef,
    payload,
  )
  return {
    candidate: createForwardDatasetCandidate({
      program: input.program,
      segments: input.segments,
      bars,
      bars_artifact_ref: artifactRef,
      bars_artifact_sha256: contentHash,
      created_at: input.created_at,
    }),
    bars,
    artifact_status: artifactStatus,
  }
}

function readSegmentBars(
  root: string,
  segment: ForwardObservationCandleSegment,
): ReplayMarketBar[] {
  const manifestPath = confinedExistingPath(
    root,
    segment.candle_slice.manifest_path,
    "data/artifacts/market-data/candle-slices",
  )
  const manifestBytes = readFileSync(manifestPath)
  if (manifestBytes.byteLength > 128 * 1024) {
    throw new Error("Forward candle slice manifest is oversized")
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    slice_ref?: unknown
    closed_candles_only?: unknown
    symbol?: unknown
    timeframes?: Record<string, {
      file?: unknown
      rows?: unknown
      first_open_ts?: unknown
      last_open_ts?: unknown
      content_sha256?: unknown
    }>
  }
  const timeframe = segment.coverage_audit.timeframe
  const item = manifest.timeframes?.[timeframe]
  if (manifest.slice_ref !== segment.candle_slice.slice_ref
      || manifest.closed_candles_only !== true
      || manifest.symbol !== segment.coverage_audit.symbol
      || item?.rows !== segment.candle_slice.rows
      || item.first_open_ts !== segment.candle_slice.first_open_ts
      || item.last_open_ts !== segment.candle_slice.last_open_ts
      || item.content_sha256 !== segment.candle_slice.content_sha256
      || item.file !== `${timeframe}.csv`) {
    throw new Error("Forward candle slice manifest identity drifted")
  }
  const csvPath = confinedExistingPath(
    root,
    relative(root, resolve(dirname(manifestPath), item.file)),
    "data/artifacts/market-data/candle-slices",
  )
  const csvBytes = readFileSync(csvPath)
  if (csvBytes.byteLength > 64 * 1024 * 1024
      || createHash("sha256").update(csvBytes).digest("hex")
        !== segment.candle_slice.content_sha256) {
    throw new Error("Forward candle slice payload drifted or is oversized")
  }
  const lines = csvBytes.toString("utf8").trimEnd().split(/\r?\n/)
  if (lines.shift() !== "date,timestamp,open,high,low,close,volume"
      || lines.length !== segment.window.row_count) {
    throw new Error("Forward candle slice CSV shape drifted")
  }
  const timeframeMs = segment.coverage_audit.timeframe_ms
  return lines.map((line, index) => {
    const fields = line.split(",")
    if (fields.length !== 7 || fields[6] === "") {
      throw new Error("Forward candle slice row is incomplete")
    }
    const [date, timestampText, ...numberFields] = fields
    const timestamp = Number(timestampText)
    const numbers = numberFields.map(Number)
    const expected = Date.parse(segment.window.start_open_time)
      + index * timeframeMs
    if (timestamp !== expected
        || date !== new Date(timestamp).toISOString()
        || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error("Forward candle slice row identity drifted")
    }
    return {
      open_time: date,
      close_time: new Date(timestamp + timeframeMs).toISOString(),
      open: numbers[0]!,
      high: numbers[1]!,
      low: numbers[2]!,
      close: numbers[3]!,
      volume: numbers[4]!,
      closed: true,
    }
  })
}

function confinedExistingPath(
  root: string,
  ref: string,
  allowedRootRef: string,
): string {
  if (!ref || ref.startsWith("/") || ref.split("/").includes("..")) {
    throw new Error("Forward dataset source path is invalid")
  }
  const allowedRoot = realpathSync(resolve(root, allowedRootRef))
  const path = realpathSync(resolve(root, ref))
  if (path !== allowedRoot && !path.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error("Forward dataset source escaped owner artifact root")
  }
  return path
}

function writeImmutable(
  root: string,
  ref: string,
  content: string,
): "created" | "existing" {
  const path = resolve(root, ref)
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error("Forward dataset artifact collision")
    }
    return "existing"
  }
  const temporary = resolve(
    directory,
    `.dataset.${process.pid}.${randomUUID()}.tmp`,
  )
  writeFileSync(temporary, content, { flag: "wx", mode: 0o600 })
  const descriptor = openSync(temporary, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    linkSync(temporary, path)
  } catch (error) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
      throw error
    }
    return "existing"
  } finally {
    unlinkSync(temporary)
  }
  const directoryDescriptor = openSync(directory, "r")
  try {
    fsyncSync(directoryDescriptor)
  } finally {
    closeSync(directoryDescriptor)
  }
  return "created"
}
