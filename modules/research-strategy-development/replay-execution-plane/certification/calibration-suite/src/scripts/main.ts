#!/usr/bin/env bun

import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readJsonInputArgs, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { runCalibrationSuite, runTrendBenchmark, strategyBenchmarkInputFromJson, strategyCalibrationInputFromJson } from "../../../../compatibility/benchmark-engine/src/lib/strategy-benchmark"

const SCHEMA_VERSION = "calibration-suite.script-response.v1"
const BENCHMARK_SCHEMA_VERSION = "benchmark-runner.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  const benchmarkMode = argv.includes("--benchmark")
  const inputArgs = argv.filter((arg) => arg !== "--benchmark")
  try {
    process.chdir(repoRoot())
    const input = readJsonInputArgs(inputArgs, printHelp).input
    return benchmarkMode
      ? successResponse(BENCHMARK_SCHEMA_VERSION, runTrendBenchmark(strategyBenchmarkInputFromJson(input)))
      : successResponse(SCHEMA_VERSION, runCalibrationSuite(strategyCalibrationInputFromJson(input)))
  } catch (error) {
    return errorResponse(benchmarkMode ? BENCHMARK_SCHEMA_VERSION : SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --json '{"datasets":[{"dataset_id":"BTC","manifest_path":"tmp/panels/btc/manifest.json"}]}'
  bun src/scripts/main.ts --benchmark --json '{"datasets":[{"dataset_id":"BTC","manifest_path":"tmp/panels/btc/manifest.json"}]}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
