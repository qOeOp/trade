#!/usr/bin/env bun

import { readJsonLines, recoverSegment, writeSegment } from "./segment"

const args = parseArgs(process.argv.slice(2))
const result = args.mode === "write"
  ? writeSegment(requireValue(args.output, "--output"), readJsonLines(requireValue(args.input, "--input")), {
      delayMs: args.delayMs,
      syncEveryFrames: args.syncEveryFrames,
    })
  : recoverSegment(requireValue(args.input, "--input"), args.salvageOutput)
process.stdout.write(`${JSON.stringify(result)}\n`)

function parseArgs(argv: string[]): { mode: "write" | "recover"; input?: string; output?: string; salvageOutput?: string; delayMs: number; syncEveryFrames: number } {
  let mode: "write" | "recover" | undefined
  let input: string | undefined
  let output: string | undefined
  let salvageOutput: string | undefined
  let delayMs = 0
  let syncEveryFrames = 0
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1]
    if (value == null) throw new Error(`incomplete argument: ${argv[index]}`)
    if (argv[index] === "--mode" && (value === "write" || value === "recover")) mode = value
    else if (argv[index] === "--input") input = value
    else if (argv[index] === "--output") output = value
    else if (argv[index] === "--salvage-output") salvageOutput = value
    else if (argv[index] === "--delay-ms") delayMs = parseNonNegativeInteger(value, "--delay-ms")
    else if (argv[index] === "--sync-every-frames") syncEveryFrames = parseNonNegativeInteger(value, "--sync-every-frames")
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (mode == null) throw new Error("--mode must be write or recover")
  return { mode, input, output, salvageOutput, delayMs, syncEveryFrames }
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function requireValue(value: string | undefined, name: string): string {
  if (value == null) throw new Error(`${name} is required`)
  return value
}
