#!/usr/bin/env bun

import { dirname, relative, resolve } from "node:path"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import type { SegmentRecoveryResult } from "../bun/segment"
import { recoverSegment } from "../bun/segment"

type Implementation = "bun" | "go" | "rust"

interface Candidate {
  implementation: Implementation
  command: string[]
}

interface ResourcePeak {
  maxRssBytes: number
  maxCpuPercent: number
}

interface StableRecoveryResult extends Omit<SegmentRecoveryResult, "implementation" | "elapsed_ns"> {}

const moduleRoot = process.cwd()
const repositoryRoot = resolve(moduleRoot, "../../..")
const arguments_ = parseArgs(process.argv.slice(2))
if (!arguments_.yesPublicNetwork) throw new Error("supervised public soak requires explicit --yes-public-network")
const outputPath = resolve(repositoryRoot, arguments_.output)
assertTmpPath(outputPath)
const runToken = `${Date.now()}-${process.pid}`
const workDirectory = resolve(repositoryRoot, `tmp/l2-recorder-bakeoff/soak-supervisor-work/${runToken}`)
assertTmpPath(workDirectory)
mkdirSync(workDirectory, { recursive: true })

const goBinary = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/bin/l2-segment-go")
const segmentRustBinary = resolve(moduleRoot, "target/release/l2-segment-rust")
const soakRustBinary = resolve(moduleRoot, "target/release/l2-soak-rust")
mkdirSync(dirname(goBinary), { recursive: true })
runChecked(["go", "build", "-o", goBinary, "./src/go-segment"])
runChecked(["cargo", "build", "--release", "--bin", "l2-segment-rust", "--bin", "l2-soak-rust"])
const recoverers: Candidate[] = [
  { implementation: "bun", command: ["bun", "src/bun/segment-main.ts"] },
  { implementation: "go", command: [goBinary] },
  { implementation: "rust", command: [segmentRustBinary] },
]

const killedCycles: Array<Record<string, unknown>> = []
let resourcePeak: ResourcePeak = { maxRssBytes: 0, maxCpuPercent: 0 }
for (let cycle = 1; cycle <= arguments_.cycles; cycle += 1) {
  const cycleBase = resolve(workDirectory, `cycle-${String(cycle).padStart(2, "0")}`)
  mkdirSync(cycleBase)
  const killed = await runKilledCycle(cycle, cycleBase)
  resourcePeak = mergeResourcePeaks(resourcePeak, killed.resourcePeak)
  const stableResults: StableRecoveryResult[] = []
  const recoveryMatrix: Record<string, Record<string, unknown>> = {}
  for (const recoverer of recoverers) {
    const salvagePath = resolve(killed.runDirectory, `salvaged-by-${recoverer.implementation}.tl2s`)
    const recovered = executeRecovery(recoverer, killed.partialPath, salvagePath)
    if (recovered.valid_frame_count < arguments_.minValidFrames) {
      throw new Error(`cycle ${cycle}/${recoverer.implementation} recovered only ${recovered.valid_frame_count} frames`)
    }
    if (!["complete", "truncated_frame_header", "truncated_payload"].includes(recovered.status)) {
      throw new Error(`cycle ${cycle}/${recoverer.implementation} rejected crash prefix as ${recovered.status}`)
    }
    const stable = withoutRuntimeFields(recovered)
    stableResults.push(stable)
    const completeBy: Record<string, boolean> = {}
    for (const verifier of recoverers) {
      const verified = executeRecovery(verifier, salvagePath)
      completeBy[verifier.implementation] = verified.status === "complete"
        && verified.valid_frame_count === recovered.valid_frame_count
        && verified.payload_hash === recovered.payload_hash
    }
    if (!Object.values(completeBy).every(Boolean)) throw new Error(`cycle ${cycle} salvage verification failed`)
    recoveryMatrix[recoverer.implementation] = {
      result: stable,
      salvage_bytes: statSync(salvagePath).size,
      salvage_complete_by: completeBy,
    }
  }
  if (!stableResults.every((value) => JSON.stringify(value) === JSON.stringify(stableResults[0]))) {
    throw new Error(`cycle ${cycle} recovery parity failed`)
  }
  killedCycles.push({
    cycle,
    pid: killed.pid,
    signal: "SIGKILL",
    exit_code: killed.exitCode,
    observed_valid_frames_before_kill: killed.observedValidFrames,
    guaranteed_synced_frames_before_kill: Math.floor(killed.observedValidFrames / arguments_.syncEveryFrames) * arguments_.syncEveryFrames,
    partial_path: relative(repositoryRoot, killed.partialPath),
    partial_bytes: statSync(killed.partialPath).size,
    max_rss_bytes: killed.resourcePeak.maxRssBytes,
    max_cpu_percent: killed.resourcePeak.maxCpuPercent,
    recovery_parity: true,
    recovery_matrix: recoveryMatrix,
  })
}

const gracefulBase = resolve(workDirectory, "graceful-restart")
mkdirSync(gracefulBase)
const graceful = await runGracefulRestart(gracefulBase)
resourcePeak = mergeResourcePeaks(resourcePeak, graceful.resourcePeak)
const gracefulEvidencePath = resolve(moduleRoot, graceful.summary.output)
const gracefulEvidence = JSON.parse(readFileSync(gracefulEvidencePath, "utf8")) as {
  verdict?: string
  total_recorded_events?: number
  total_segments?: number
  max_queue_depth?: number
}
if (gracefulEvidence.verdict !== "passed" || (gracefulEvidence.total_recorded_events ?? 0) < 1) {
  throw new Error("graceful restart did not produce passing public-soak evidence")
}

const evidence = {
  schema_version: "trade.l2-soak-supervisor-evidence.v1",
  generated_at: new Date().toISOString(),
  symbol: arguments_.symbol,
  cycles: arguments_.cycles,
  min_valid_frames: arguments_.minValidFrames,
  sync_every_frames: arguments_.syncEveryFrames,
  signal: "SIGKILL",
  all_cycle_recovery_parity: true,
  max_rss_bytes: resourcePeak.maxRssBytes,
  max_cpu_percent: resourcePeak.maxCpuPercent,
  killed_cycles: killedCycles,
  graceful_restart: {
    exit_code: graceful.exitCode,
    evidence_path: relative(repositoryRoot, gracefulEvidencePath),
    verdict: gracefulEvidence.verdict,
    total_recorded_events: gracefulEvidence.total_recorded_events,
    total_segments: gracefulEvidence.total_segments,
    max_queue_depth: gracefulEvidence.max_queue_depth,
    max_rss_bytes: graceful.resourcePeak.maxRssBytes,
    max_cpu_percent: graceful.resourcePeak.maxCpuPercent,
  },
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 })
process.stdout.write(`${JSON.stringify({
  output: relative(repositoryRoot, outputPath),
  all_cycle_recovery_parity: true,
  cycles: arguments_.cycles,
  graceful_restart: evidence.graceful_restart,
  max_rss_bytes: evidence.max_rss_bytes,
  max_cpu_percent: evidence.max_cpu_percent,
})}\n`)

async function runKilledCycle(cycle: number, outputBase: string): Promise<{
  pid: number
  exitCode: number
  runDirectory: string
  partialPath: string
  observedValidFrames: number
  resourcePeak: ResourcePeak
}> {
  const child = Bun.spawn({
    cmd: soakCommand(outputBase, arguments_.workerDurationSeconds),
    cwd: moduleRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const pid = child.pid
  assertSignalTarget(pid)
  const deadline = Date.now() + arguments_.injectionTimeoutMs
  let runDirectory: string | undefined
  let partialPath: string | undefined
  let observedValidFrames = 0
  let signalSent = false
  let peak: ResourcePeak = { maxRssBytes: 0, maxCpuPercent: 0 }
  try {
    while (Date.now() < deadline) {
      peak = mergeResourcePeaks(peak, sampleProcess(pid))
      runDirectory = findOnlyRunDirectory(outputBase)
      if (runDirectory != null) {
        partialPath = findChildPartial(runDirectory, pid)
        if (partialPath != null) {
          try {
            observedValidFrames = recoverSegment(partialPath).valid_frame_count
          } catch {
            observedValidFrames = 0
          }
          if (observedValidFrames >= arguments_.minValidFrames) break
        }
      }
      if (child.exitCode != null) {
        const stderr = await new Response(child.stderr).text()
        throw new Error(`cycle ${cycle} worker exited before injection with code ${child.exitCode}: ${stderr}`)
      }
      await Bun.sleep(20)
    }
    if (runDirectory == null || partialPath == null || observedValidFrames < arguments_.minValidFrames) {
      throw new Error(`cycle ${cycle} did not reach ${arguments_.minValidFrames} recoverable frames`)
    }
    killExact(pid)
    signalSent = true
    const exitCode = await child.exited
    if (exitCode === 0) throw new Error(`cycle ${cycle} unexpectedly completed after SIGKILL`)
    peak = mergeResourcePeaks(peak, sampleProcess(pid))
    return { pid, exitCode, runDirectory, partialPath, observedValidFrames, resourcePeak: peak }
  } finally {
    if (!signalSent && child.exitCode == null) killExact(pid)
  }
}

async function runGracefulRestart(outputBase: string): Promise<{
  exitCode: number
  summary: { output: string; verdict?: string }
  resourcePeak: ResourcePeak
}> {
  const child = Bun.spawn({
    cmd: soakCommand(outputBase, arguments_.gracefulDurationSeconds),
    cwd: moduleRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  assertSignalTarget(child.pid)
  let peak: ResourcePeak = { maxRssBytes: 0, maxCpuPercent: 0 }
  while (child.exitCode == null) {
    peak = mergeResourcePeaks(peak, sampleProcess(child.pid))
    await Bun.sleep(25)
  }
  const exitCode = await child.exited
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  if (exitCode !== 0) throw new Error(`graceful restart failed with code ${exitCode}: ${stderr}`)
  return { exitCode, summary: JSON.parse(stdout) as { output: string; verdict?: string }, resourcePeak: peak }
}

function soakCommand(outputBase: string, durationSeconds: number): string[] {
  return [
    soakRustBinary,
    "--yes-public-network",
    "--symbol", arguments_.symbol,
    "--duration-seconds", String(durationSeconds),
    "--queue-capacity", String(arguments_.queueCapacity),
    "--segment-frames", String(arguments_.segmentFrames),
    "--sync-every-frames", String(arguments_.syncEveryFrames),
    "--max-book-levels", String(arguments_.maxBookLevels),
    "--force-disconnect-after", "0",
    "--output-base", outputBase,
  ]
}

function findOnlyRunDirectory(outputBase: string): string | undefined {
  const directories = readdirSync(outputBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(outputBase, entry.name))
  if (directories.length > 1) throw new Error(`multiple worker run directories found below ${relative(repositoryRoot, outputBase)}`)
  return directories[0]
}

function findChildPartial(runDirectory: string, pid: number): string | undefined {
  const marker = `.partial.${pid}.`
  const matches = readdirSync(runDirectory)
    .filter((entry) => entry.includes(marker))
    .map((entry) => resolve(runDirectory, entry))
  if (matches.length > 1) throw new Error(`multiple partial files found for worker pid ${pid}`)
  return matches[0]
}

function executeRecovery(candidate: Candidate, input: string, salvageOutput?: string): SegmentRecoveryResult {
  const command = [...candidate.command, "--mode", "recover", "--input", input]
  if (salvageOutput != null) command.push("--salvage-output", salvageOutput)
  const execution = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "pipe", stderr: "pipe" })
  if (execution.exitCode !== 0) throw new Error(`recovery failed: ${command.join(" ")}\n${execution.stderr.toString()}`)
  return JSON.parse(execution.stdout.toString()) as SegmentRecoveryResult
}

function withoutRuntimeFields(result: SegmentRecoveryResult): StableRecoveryResult {
  const { implementation: _, elapsed_ns: __, ...stable } = result
  return stable
}

function sampleProcess(pid: number): ResourcePeak {
  const sample = Bun.spawnSync({ cmd: ["ps", "-o", "rss=,%cpu=", "-p", String(pid)], stdout: "pipe", stderr: "ignore" })
  if (sample.exitCode !== 0) return { maxRssBytes: 0, maxCpuPercent: 0 }
  const values = sample.stdout.toString().trim().split(/\s+/)
  const rssKiB = Number(values[0])
  const cpuPercent = Number(values[1])
  return {
    maxRssBytes: Number.isFinite(rssKiB) ? rssKiB * 1024 : 0,
    maxCpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
  }
}

function mergeResourcePeaks(left: ResourcePeak, right: ResourcePeak): ResourcePeak {
  return {
    maxRssBytes: Math.max(left.maxRssBytes, right.maxRssBytes),
    maxCpuPercent: Math.max(left.maxCpuPercent, right.maxCpuPercent),
  }
}

function assertSignalTarget(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error(`refusing to signal invalid child pid: ${pid}`)
}

function killExact(pid: number): void {
  assertSignalTarget(pid)
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

function runChecked(command: string[]): void {
  const result = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`build failed: ${command.join(" ")}`)
}

function assertTmpPath(path: string): void {
  const repositoryRelative = relative(repositoryRoot, path).replaceAll("\\", "/")
  if (!repositoryRelative.startsWith("tmp/") || repositoryRelative.includes("../")) throw new Error("path must be inside repository tmp/")
}

function parseArgs(argv: string[]): {
  yesPublicNetwork: boolean
  symbol: string
  cycles: number
  minValidFrames: number
  syncEveryFrames: number
  segmentFrames: number
  queueCapacity: number
  maxBookLevels: number
  workerDurationSeconds: number
  gracefulDurationSeconds: number
  injectionTimeoutMs: number
  output: string
} {
  const result = {
    yesPublicNetwork: false,
    symbol: "BTCUSDT",
    cycles: 3,
    minValidFrames: 10,
    syncEveryFrames: 5,
    segmentFrames: 1000,
    queueCapacity: 64,
    maxBookLevels: 20_000,
    workerDurationSeconds: 30,
    gracefulDurationSeconds: 5,
    injectionTimeoutMs: 30_000,
    output: `tmp/l2-recorder-bakeoff/soak-supervisor-evidence-${Date.now()}.json`,
  }
  let index = 0
  while (index < argv.length) {
    if (argv[index] === "--yes-public-network") {
      result.yesPublicNetwork = true
      index += 1
      continue
    }
    const value = argv[index + 1]
    if (value == null) throw new Error(`incomplete argument: ${argv[index]}`)
    if (argv[index] === "--symbol") result.symbol = value
    else if (argv[index] === "--cycles") result.cycles = Number(value)
    else if (argv[index] === "--min-valid-frames") result.minValidFrames = Number(value)
    else if (argv[index] === "--sync-every-frames") result.syncEveryFrames = Number(value)
    else if (argv[index] === "--segment-frames") result.segmentFrames = Number(value)
    else if (argv[index] === "--queue-capacity") result.queueCapacity = Number(value)
    else if (argv[index] === "--max-book-levels") result.maxBookLevels = Number(value)
    else if (argv[index] === "--worker-duration-seconds") result.workerDurationSeconds = Number(value)
    else if (argv[index] === "--graceful-duration-seconds") result.gracefulDurationSeconds = Number(value)
    else if (argv[index] === "--injection-timeout-ms") result.injectionTimeoutMs = Number(value)
    else if (argv[index] === "--output") result.output = value
    else throw new Error(`unknown argument: ${argv[index]}`)
    index += 2
  }
  if (!/^[A-Z0-9]{5,20}$/.test(result.symbol)) throw new Error("symbol must be an uppercase Binance symbol")
  if (!Number.isSafeInteger(result.cycles) || result.cycles < 1 || result.cycles > 20) throw new Error("cycles must be between 1 and 20")
  if (!Number.isSafeInteger(result.minValidFrames) || result.minValidFrames < 1) throw new Error("min-valid-frames must be positive")
  if (!Number.isSafeInteger(result.syncEveryFrames) || result.syncEveryFrames < 1) throw new Error("sync-every-frames must be positive")
  if (!Number.isSafeInteger(result.segmentFrames) || result.segmentFrames <= result.minValidFrames) throw new Error("segment-frames must exceed min-valid-frames")
  if (!Number.isSafeInteger(result.queueCapacity) || result.queueCapacity < 1) throw new Error("queue-capacity must be positive")
  if (!Number.isSafeInteger(result.maxBookLevels) || result.maxBookLevels < 2000) throw new Error("max-book-levels must be at least 2000")
  if (!Number.isSafeInteger(result.workerDurationSeconds) || result.workerDurationSeconds < 5) throw new Error("worker-duration-seconds must be at least 5")
  if (!Number.isSafeInteger(result.gracefulDurationSeconds) || result.gracefulDurationSeconds < 5) throw new Error("graceful-duration-seconds must be at least 5")
  if (!Number.isSafeInteger(result.injectionTimeoutMs) || result.injectionTimeoutMs < 5000) throw new Error("injection-timeout-ms must be at least 5000")
  return result
}
