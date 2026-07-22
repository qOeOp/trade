#!/usr/bin/env bun

import { isDeepStrictEqual } from "node:util"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { parseFixture, type BakeoffResult } from "../bun/projector"

interface Sample {
  internal_ns: number
  wall_ns: number
  processed_event_count: number
  events_per_second: number
  max_rss_bytes?: number
}

interface ImplementationEvidence {
  implementation: "bun" | "go" | "rust"
  command: string
  samples: Sample[]
  median_internal_ns_per_event: number
  p95_internal_ns_per_event: number
  median_wall_ns: number
  p95_wall_ns: number
  max_rss_bytes?: number
}

const moduleRoot = process.cwd()
const repositoryRoot = resolve(moduleRoot, "../../..")
const arguments_ = parseArgs(process.argv.slice(2))
const fixturePath = resolve(moduleRoot, arguments_.fixture)
const outputPath = resolve(repositoryRoot, arguments_.output)
assertIgnoredOutput(outputPath)

const goBinary = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/bin/l2-bakeoff-go")
const rustBinary = resolve(moduleRoot, "target/release/l2-bakeoff-rust")
mkdirSync(dirname(goBinary), { recursive: true })
runChecked(["go", "build", "-o", goBinary, "./src/go"])
runChecked(["cargo", "build", "--release", "--bin", "l2-bakeoff-rust"])

const implementations = [
  { implementation: "bun" as const, command: ["bun", "src/bun/main.ts"] },
  { implementation: "go" as const, command: [goBinary] },
  { implementation: "rust" as const, command: [rustBinary] },
]

const fixtureRaw = readFileSync(fixturePath, "utf8")
const fixture = parseFixture(fixtureRaw)
const parity: Record<string, { complete: boolean; gap: boolean; source_hash: string }> = {}
for (const candidate of implementations) {
  const completeResult = execute(candidate.command, fixturePath, 1).result
  const gapPath = resolve(moduleRoot, "fixtures/gap.json")
  const gapFixture = parseFixture(readFileSync(gapPath, "utf8"))
  const gapResult = execute(candidate.command, gapPath, 1).result
  parity[candidate.implementation] = {
    complete: isDeepStrictEqual(completeResult.outcome, fixture.expected),
    gap: isDeepStrictEqual(gapResult.outcome, gapFixture.expected),
    source_hash: completeResult.source_hash,
  }
  if (!parity[candidate.implementation].complete || !parity[candidate.implementation].gap) {
    throw new Error(`${candidate.implementation} failed fixture parity`)
  }
}

const evidence: ImplementationEvidence[] = []
for (const candidate of implementations) {
  execute(candidate.command, fixturePath, arguments_.iterations)
  const samples: Sample[] = []
  for (let sampleIndex = 0; sampleIndex < arguments_.samples; sampleIndex += 1) {
    const execution = execute(candidate.command, fixturePath, arguments_.iterations)
    const result = execution.result
    samples.push({
      internal_ns: result.elapsed_ns,
      wall_ns: execution.wallNs,
      processed_event_count: result.processed_event_count,
      events_per_second: result.elapsed_ns === 0
        ? 0
        : result.processed_event_count * 1_000_000_000 / result.elapsed_ns,
      ...(execution.maxRssBytes == null ? {} : { max_rss_bytes: execution.maxRssBytes }),
    })
  }
  const internalPerEvent = samples.map((sample) => sample.internal_ns / sample.processed_event_count)
  const wall = samples.map((sample) => sample.wall_ns)
  const rss = samples.flatMap((sample) => sample.max_rss_bytes == null ? [] : [sample.max_rss_bytes])
  evidence.push({
    implementation: candidate.implementation,
    command: candidate.command.map(displayCommandPart).join(" "),
    samples,
    median_internal_ns_per_event: percentile(internalPerEvent, 0.5),
    p95_internal_ns_per_event: percentile(internalPerEvent, 0.95),
    median_wall_ns: percentile(wall, 0.5),
    p95_wall_ns: percentile(wall, 0.95),
    ...(rss.length === 0 ? {} : { max_rss_bytes: Math.max(...rss) }),
  })
}

const output = {
  schema_version: "trade.l2-language-bakeoff-evidence.v1",
  generated_at: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    bun: commandVersion(["bun", "--version"]),
    go: commandVersion(["go", "version"]),
    rustc: commandVersion(["rustc", "--version"]),
  },
  fixture: relative(repositoryRoot, fixturePath),
  iterations: arguments_.iterations,
  samples_per_implementation: arguments_.samples,
  parity,
  implementations: evidence,
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output: relative(repositoryRoot, outputPath), parity, implementations: evidence })}\n`)

function execute(command: string[], fixture: string, iterations: number): { result: BakeoffResult; wallNs: number; maxRssBytes?: number } {
  const runtimeCommand = [...command, "--fixture", fixture, "--iterations", String(iterations)]
  const measuredCommand = process.platform === "darwin"
    ? ["/usr/bin/time", "-l", ...runtimeCommand]
    : runtimeCommand
  const startedAt = process.hrtime.bigint()
  const execution = Bun.spawnSync({ cmd: measuredCommand, cwd: moduleRoot, stdout: "pipe", stderr: "pipe" })
  const wallNs = Number(process.hrtime.bigint() - startedAt)
  const stdout = execution.stdout.toString().trim()
  const stderr = execution.stderr.toString()
  if (execution.exitCode !== 0) {
    throw new Error(`command failed (${execution.exitCode}): ${runtimeCommand.map(displayCommandPart).join(" ")}\n${stderr}`)
  }
  const result = JSON.parse(stdout) as BakeoffResult
  if (result.schema_version !== "trade.l2-bakeoff-result.v1") {
    throw new Error(`${command[0]} returned an unsupported result schema`)
  }
  const rssMatch = stderr.match(/([0-9]+)\s+maximum resident set size/)
  return {
    result,
    wallNs,
    ...(rssMatch?.[1] == null ? {} : { maxRssBytes: Number(rssMatch[1]) }),
  }
}

function runChecked(command: string[]): void {
  const result = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`build failed: ${command.join(" ")}`)
}

function commandVersion(command: string[]): string {
  const result = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`version command failed: ${command.join(" ")}`)
  return result.stdout.toString().trim()
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) throw new Error("cannot calculate a percentile without values")
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[index]!
}

function displayCommandPart(value: string): string {
  if (!isAbsolute(value)) return value
  const repositoryRelative = relative(repositoryRoot, value)
  return repositoryRelative.startsWith("..") ? value : repositoryRelative
}

function assertIgnoredOutput(output: string): void {
  const repositoryRelative = relative(repositoryRoot, output).replaceAll("\\", "/")
  if (!repositoryRelative.startsWith("tmp/") || repositoryRelative.includes("../")) {
    throw new Error("benchmark output must be inside repository tmp/")
  }
}

function parseArgs(argv: string[]): { fixture: string; iterations: number; samples: number; output: string } {
  const values = {
    fixture: "fixtures/complete.json",
    iterations: 10_000,
    samples: 5,
    output: "tmp/l2-recorder-bakeoff/evidence.json",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1]
    if (argv[index] === "--fixture" && next != null) values.fixture = next
    else if (argv[index] === "--iterations" && next != null) values.iterations = Number(next)
    else if (argv[index] === "--samples" && next != null) values.samples = Number(next)
    else if (argv[index] === "--output" && next != null) values.output = next
    else throw new Error(`unknown or incomplete argument: ${argv[index]}`)
    index += 1
  }
  if (!Number.isSafeInteger(values.iterations) || values.iterations < 1) throw new Error("iterations must be a positive integer")
  if (!Number.isSafeInteger(values.samples) || values.samples < 1) throw new Error("samples must be a positive integer")
  return values
}
