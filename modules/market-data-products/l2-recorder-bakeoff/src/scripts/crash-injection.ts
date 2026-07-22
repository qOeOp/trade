#!/usr/bin/env bun

import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { SegmentRecoveryResult } from "../bun/segment"
import { recoverSegment } from "../bun/segment"

type Implementation = "bun" | "go" | "rust"

interface Candidate {
  implementation: Implementation
  command: string[]
}

interface StableRecoveryResult extends Omit<SegmentRecoveryResult, "implementation" | "elapsed_ns"> {}

const moduleRoot = process.cwd()
const repositoryRoot = resolve(moduleRoot, "../../..")
const arguments_ = parseArgs(process.argv.slice(2))
const fixturePath = resolve(moduleRoot, arguments_.fixture)
const outputPath = resolve(repositoryRoot, arguments_.output)
const workDirectory = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/crash-work")
assertTmpPath(outputPath)
assertTmpPath(workDirectory)
rmSync(workDirectory, { recursive: true, force: true })
mkdirSync(workDirectory, { recursive: true })

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { events?: unknown[] }
if (!Array.isArray(fixture.events) || fixture.events.length <= arguments_.minValidFrames) {
  throw new Error(`fixture must contain more than ${arguments_.minValidFrames} events`)
}
const payloadPath = resolve(workDirectory, "payloads.jsonl")
writeFileSync(payloadPath, `${fixture.events.map((event) => JSON.stringify(event)).join("\n")}\n`)

const goBinary = resolve(repositoryRoot, "tmp/l2-recorder-bakeoff/bin/l2-segment-go")
const rustBinary = resolve(moduleRoot, "target/release/l2-segment-rust")
mkdirSync(dirname(goBinary), { recursive: true })
runChecked(["go", "build", "-o", goBinary, "./src/go-segment"])
runChecked(["cargo", "build", "--release", "--bin", "l2-segment-rust"])
const candidates: Candidate[] = [
  { implementation: "bun", command: ["bun", "src/bun/segment-main.ts"] },
  { implementation: "go", command: [goBinary] },
  { implementation: "rust", command: [rustBinary] },
]

const writerEvidence: Array<Record<string, unknown>> = []
for (const writer of candidates) {
  const requestedOutput = resolve(workDirectory, `${writer.implementation}.tl2s`)
  const crash = await killWriterAfterValidPrefix(writer, requestedOutput, payloadPath)
  const recoveryMatrix: Record<string, Record<string, unknown>> = {}
  const stableResults: StableRecoveryResult[] = []
  for (const recoverer of candidates) {
    const salvagePath = resolve(workDirectory, `${writer.implementation}-by-${recoverer.implementation}-salvaged.tl2s`)
    const recovered = executeRecovery(recoverer, crash.partialPath, salvagePath)
    const stable = withoutRuntimeFields(recovered)
    stableResults.push(stable)
    if (recovered.valid_frame_count < arguments_.minValidFrames || recovered.valid_frame_count >= fixture.events.length) {
      throw new Error(`${writer.implementation}/${recoverer.implementation} recovered an invalid frame count: ${recovered.valid_frame_count}`)
    }
    if (!["complete", "truncated_frame_header", "truncated_payload"].includes(recovered.status)) {
      throw new Error(`${writer.implementation}/${recoverer.implementation} rejected a process-crash prefix as ${recovered.status}`)
    }
    const salvageVerification: Record<string, boolean> = {}
    for (const verifier of candidates) {
      const verified = executeRecovery(verifier, salvagePath)
      salvageVerification[verifier.implementation] = verified.status === "complete"
        && verified.valid_frame_count === recovered.valid_frame_count
        && verified.payload_hash === recovered.payload_hash
    }
    if (!Object.values(salvageVerification).every(Boolean)) {
      throw new Error(`${writer.implementation}/${recoverer.implementation} salvage verification failed`)
    }
    recoveryMatrix[recoverer.implementation] = {
      result: stable,
      salvage_bytes: statSync(salvagePath).size,
      salvage_complete_by: salvageVerification,
    }
  }
  if (!stableResults.every((result) => JSON.stringify(result) === JSON.stringify(stableResults[0]))) {
    throw new Error(`${writer.implementation} recovery parity failed`)
  }
  writerEvidence.push({
    writer: writer.implementation,
    command: writer.command.map(displayCommandPart).join(" "),
    pid: crash.pid,
    signal: "SIGKILL",
    exit_code: crash.exitCode,
    partial_bytes: statSync(crash.partialPath).size,
    observed_valid_frames_before_kill: crash.observedValidFrames,
    guaranteed_synced_frames_before_kill: Math.floor(crash.observedValidFrames / arguments_.syncEveryFrames) * arguments_.syncEveryFrames,
    recovery_parity: true,
    recovery_matrix: recoveryMatrix,
  })
}

const evidence = {
  schema_version: "trade.l2-segment-crash-evidence.v1",
  generated_at: new Date().toISOString(),
  fixture: relative(repositoryRoot, fixturePath),
  frame_count: fixture.events.length,
  injection: {
    min_valid_frames: arguments_.minValidFrames,
    delay_ms: arguments_.delayMs,
    sync_every_frames: arguments_.syncEveryFrames,
    signal: "SIGKILL",
  },
  cross_recovery_parity: true,
  writers: writerEvidence,
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output: relative(repositoryRoot, outputPath), cross_recovery_parity: true, writers: writerEvidence })}\n`)

async function killWriterAfterValidPrefix(writer: Candidate, requestedOutput: string, input: string): Promise<{ pid: number; exitCode: number; partialPath: string; observedValidFrames: number }> {
  const command = [
    ...writer.command,
    "--mode", "write",
    "--input", input,
    "--output", requestedOutput,
    "--delay-ms", String(arguments_.delayMs),
    "--sync-every-frames", String(arguments_.syncEveryFrames),
  ]
  const child = Bun.spawn({ cmd: command, cwd: moduleRoot, stdout: "pipe", stderr: "pipe" })
  const pid = child.pid
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error(`refusing to signal invalid child pid: ${pid}`)
  const deadline = Date.now() + 15_000
  let partialPath: string | undefined
  let observedValidFrames = 0
  let signalSent = false
  try {
    while (Date.now() < deadline) {
      partialPath = findChildPartial(requestedOutput, pid)
      if (partialPath != null) {
        try {
          observedValidFrames = recoverSegment(partialPath).valid_frame_count
        } catch {
          observedValidFrames = 0
        }
        if (observedValidFrames >= arguments_.minValidFrames) break
      }
      if (child.exitCode != null) throw new Error(`${writer.implementation} writer exited before injection with code ${child.exitCode}`)
      await Bun.sleep(2)
    }
    if (partialPath == null || observedValidFrames < arguments_.minValidFrames) {
      throw new Error(`${writer.implementation} writer did not reach the injection threshold`)
    }
    process.kill(pid, "SIGKILL")
    signalSent = true
    const exitCode = await child.exited
    if (exitCode === 0) throw new Error(`${writer.implementation} writer unexpectedly completed after SIGKILL`)
    if (statSync(partialPath).size <= 8) throw new Error(`${writer.implementation} partial contains no frames`)
    return { pid, exitCode, partialPath, observedValidFrames }
  } finally {
    if (!signalSent && child.exitCode == null) process.kill(pid, "SIGKILL")
  }
}

function findChildPartial(requestedOutput: string, pid: number): string | undefined {
  const directory = dirname(requestedOutput)
  const prefix = `${basename(requestedOutput)}.partial.${pid}.`
  const matches = readdirSync(directory).filter((entry) => entry.startsWith(prefix))
  if (matches.length > 1) throw new Error(`multiple partial files found for pid ${pid}`)
  return matches[0] == null ? undefined : resolve(directory, matches[0])
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

function runChecked(command: string[]): void {
  const result = Bun.spawnSync({ cmd: command, cwd: moduleRoot, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`build failed: ${command.join(" ")}`)
}

function displayCommandPart(value: string): string {
  if (!isAbsolute(value)) return value
  const repositoryRelative = relative(repositoryRoot, value)
  return repositoryRelative.startsWith("..") ? value : repositoryRelative
}

function assertTmpPath(path: string): void {
  const repositoryRelative = relative(repositoryRoot, path).replaceAll("\\", "/")
  if (!repositoryRelative.startsWith("tmp/") || repositoryRelative.includes("../")) throw new Error("path must be inside repository tmp/")
}

function parseArgs(argv: string[]): { fixture: string; output: string; minValidFrames: number; delayMs: number; syncEveryFrames: number } {
  const result = {
    fixture: "fixtures/complete.json",
    output: "tmp/l2-recorder-bakeoff/crash-evidence.json",
    minValidFrames: 50,
    delayMs: 8,
    syncEveryFrames: 10,
  }
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1]
    if (value == null) throw new Error(`incomplete argument: ${argv[index]}`)
    if (argv[index] === "--fixture") result.fixture = value
    else if (argv[index] === "--output") result.output = value
    else if (argv[index] === "--min-valid-frames") result.minValidFrames = Number(value)
    else if (argv[index] === "--delay-ms") result.delayMs = Number(value)
    else if (argv[index] === "--sync-every-frames") result.syncEveryFrames = Number(value)
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (!Number.isSafeInteger(result.minValidFrames) || result.minValidFrames < 1) throw new Error("min-valid-frames must be a positive integer")
  if (!Number.isSafeInteger(result.delayMs) || result.delayMs < 1 || result.delayMs > 1000) throw new Error("delay-ms must be between 1 and 1000")
  if (!Number.isSafeInteger(result.syncEveryFrames) || result.syncEveryFrames < 1) throw new Error("sync-every-frames must be a positive integer")
  return result
}
