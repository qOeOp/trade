#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import type { SegmentRecoveryResult, SegmentWriteResult } from "../bun/segment"

interface Execution<T> {
  result: T
  wallNs: number
  maxRssBytes?: number
}

interface Candidate {
  implementation: "bun" | "go" | "rust"
  command: string[]
}

const moduleRoot = process.cwd()
const repositoryRoot = resolve(moduleRoot, "../../..")
const arguments_ = parseArgs(process.argv.slice(2))
const fixturePath = resolve(moduleRoot, arguments_.fixture)
const outputPath = resolve(repositoryRoot, arguments_.output)
assertTmpPath(outputPath)
const workDirectory = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/segment-work")
mkdirSync(workDirectory, { recursive: true })

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { events?: unknown[] }
if (!Array.isArray(fixture.events) || fixture.events.length === 0) throw new Error("fixture must contain events")
const payloadPath = resolve(workDirectory, "payloads.jsonl")
writeFileSync(payloadPath, `${fixture.events.map((event) => JSON.stringify(event)).join("\n")}\n`)

const goBinary = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/bin/l2-segment-go")
const rustBinary = resolve(moduleRoot, "target/release/l2-segment-rust")
runChecked(["go", "build", "-o", goBinary, "./src/go-segment"])
runChecked(["cargo", "build", "--release", "--bin", "l2-segment-rust"])
const candidates: Candidate[] = [
  { implementation: "bun", command: ["bun", "src/bun/segment-main.ts"] },
  { implementation: "go", command: [goBinary] },
  { implementation: "rust", command: [rustBinary] },
]

const writeParity: Record<string, Omit<SegmentWriteResult, "implementation" | "elapsed_ns">> = {}
const baselineSegments = new Map<string, Buffer>()
const implementationEvidence: Array<Record<string, unknown>> = []
for (const candidate of candidates) {
  const samples: Array<Execution<SegmentWriteResult>> = []
  for (let sample = 0; sample < arguments_.samples; sample += 1) {
    const segmentPath = resolve(workDirectory, `${candidate.implementation}-${sample}.tl2s`)
    rmSync(segmentPath, { force: true })
    const execution = execute<SegmentWriteResult>(candidate.command, ["--mode", "write", "--input", payloadPath, "--output", segmentPath])
    samples.push(execution)
    if (sample === 0) baselineSegments.set(candidate.implementation, readFileSync(segmentPath))
  }
  const first = samples[0]!.result
  writeParity[candidate.implementation] = withoutRuntimeFields(first)
  const nsPerFrame = samples.map((sample) => sample.result.elapsed_ns / sample.result.frame_count)
  const wall = samples.map((sample) => sample.wallNs)
  const rss = samples.flatMap((sample) => sample.maxRssBytes == null ? [] : [sample.maxRssBytes])
  implementationEvidence.push({
    implementation: candidate.implementation,
    command: candidate.command.map(displayCommandPart).join(" "),
    median_write_ns_per_frame: percentile(nsPerFrame, 0.5),
    p95_write_ns_per_frame: percentile(nsPerFrame, 0.95),
    median_wall_ns: percentile(wall, 0.5),
    p95_wall_ns: percentile(wall, 0.95),
    ...(rss.length === 0 ? {} : { max_rss_bytes: Math.max(...rss) }),
    segment_bytes: first.segment_bytes,
    segment_hash: first.segment_hash,
    payload_hash: first.payload_hash,
  })
}

const bunSegment = baselineSegments.get("bun")!
for (const [implementation, segment] of baselineSegments) {
  if (!segment.equals(bunSegment)) throw new Error(`${implementation} segment bytes differ from Bun`)
}
const parityValues = Object.values(writeParity)
if (!parityValues.every((value) => JSON.stringify(value) === JSON.stringify(parityValues[0]))) {
  throw new Error("segment write result parity failed")
}

const truncatedPath = resolve(workDirectory, "truncated.tl2s")
const corruptPath = resolve(workDirectory, "corrupt.tl2s")
writeFileSync(truncatedPath, bunSegment.subarray(0, bunSegment.length - 17))
const corrupt = Buffer.from(bunSegment)
corrupt[corrupt.length - 1] ^= 0xff
writeFileSync(corruptPath, corrupt)

const recoveryParity: Record<string, { truncated: Omit<SegmentRecoveryResult, "implementation" | "elapsed_ns">; corrupt: Omit<SegmentRecoveryResult, "implementation" | "elapsed_ns">; salvage_complete: boolean }> = {}
for (const candidate of candidates) {
  const salvagePath = resolve(workDirectory, `${candidate.implementation}-salvaged.tl2s`)
  rmSync(salvagePath, { force: true })
  const truncated = execute<SegmentRecoveryResult>(candidate.command, ["--mode", "recover", "--input", truncatedPath, "--salvage-output", salvagePath]).result
  const corruptResult = execute<SegmentRecoveryResult>(candidate.command, ["--mode", "recover", "--input", corruptPath]).result
  const salvaged = execute<SegmentRecoveryResult>(candidate.command, ["--mode", "recover", "--input", salvagePath]).result
  if (truncated.status !== "truncated_payload" || corruptResult.status !== "checksum_mismatch" || salvaged.status !== "complete") {
    throw new Error(`${candidate.implementation} recovery failed closed-world expectations`)
  }
  recoveryParity[candidate.implementation] = {
    truncated: withoutRecoveryRuntimeFields(truncated),
    corrupt: withoutRecoveryRuntimeFields(corruptResult),
    salvage_complete: true,
  }
}
const recoveryValues = Object.values(recoveryParity)
if (!recoveryValues.every((value) => JSON.stringify(value) === JSON.stringify(recoveryValues[0]))) {
  throw new Error("segment recovery parity failed")
}

const evidence = {
  schema_version: "trade.l2-segment-bakeoff-evidence.v1",
  generated_at: new Date().toISOString(),
  fixture: relative(repositoryRoot, fixturePath),
  frame_count: fixture.events.length,
  samples_per_implementation: arguments_.samples,
  write_parity: writeParity,
  recovery_parity: recoveryParity,
  implementations: implementationEvidence,
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output: relative(repositoryRoot, outputPath), frame_count: fixture.events.length, write_parity: writeParity, recovery_parity: recoveryParity, implementations: implementationEvidence })}\n`)

function execute<T>(command: string[], args: string[]): Execution<T> {
  const runtimeCommand = [...command, ...args]
  const measuredCommand = process.platform === "darwin" ? ["/usr/bin/time", "-l", ...runtimeCommand] : runtimeCommand
  const startedAt = process.hrtime.bigint()
  const execution = Bun.spawnSync({ cmd: measuredCommand, cwd: moduleRoot, stdout: "pipe", stderr: "pipe" })
  const wallNs = Number(process.hrtime.bigint() - startedAt)
  if (execution.exitCode !== 0) throw new Error(`command failed: ${runtimeCommand.join(" ")}\n${execution.stderr.toString()}`)
  const rss = execution.stderr.toString().match(/([0-9]+)\s+maximum resident set size/)?.[1]
  return { result: JSON.parse(execution.stdout.toString()) as T, wallNs, ...(rss == null ? {} : { maxRssBytes: Number(rss) }) }
}

function withoutRuntimeFields(result: SegmentWriteResult): Omit<SegmentWriteResult, "implementation" | "elapsed_ns"> {
  const { implementation: _, elapsed_ns: __, ...stable } = result
  return stable
}

function withoutRecoveryRuntimeFields(result: SegmentRecoveryResult): Omit<SegmentRecoveryResult, "implementation" | "elapsed_ns"> {
  const { implementation: _, elapsed_ns: __, ...stable } = result
  return stable
}

function runChecked(command: string[]): void {
  const result = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`build failed: ${command.join(" ")}`)
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
}

function displayCommandPart(value: string): string {
  if (!isAbsolute(value)) return value
  const repositoryRelative = relative(repositoryRoot, value)
  return repositoryRelative.startsWith("..") ? value : repositoryRelative
}

function assertTmpPath(path: string): void {
  const repositoryRelative = relative(repositoryRoot, path).replaceAll("\\", "/")
  if (!repositoryRelative.startsWith("tmp/") || repositoryRelative.includes("../")) throw new Error("output must be inside repository tmp/")
}

function parseArgs(argv: string[]): { fixture: string; samples: number; output: string } {
  const result = {
    fixture: "fixtures/complete.json",
    samples: 5,
    output: "tmp/l2-recorder-bakeoff/segment-evidence.json",
  }
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1]
    if (value == null) throw new Error(`incomplete argument: ${argv[index]}`)
    if (argv[index] === "--fixture") result.fixture = value
    else if (argv[index] === "--samples") result.samples = Number(value)
    else if (argv[index] === "--output") result.output = value
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (!Number.isSafeInteger(result.samples) || result.samples < 1 || result.samples > 100) throw new Error("samples must be between 1 and 100")
  return result
}
