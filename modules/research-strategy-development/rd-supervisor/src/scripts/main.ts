#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { buildDomainJobResult, validateDomainJobResult } from "../../../../contracts/domain-runtime/src/domain-runtime"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runRdProgramStateCommand } from "../../../rd-program-state/src/lib/rd-program-state"
import { runRdSupervisorLoop } from "../lib/rd-supervisor-runner"

type JSONRecord = Record<string, unknown>

interface Config {
  statePath: string
  catalogDbPath: string
  input: JSONRecord
  supervisorJob: boolean
}

interface SupervisorJobInput {
  cycle_id?: string
  ticket_no?: string
  job_id?: string
  idempotency_key?: string
  now?: string
  state_path?: string
  catalog_db_path?: string
  goal?: JSONRecord
  supervisor?: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertRuntimeOutputPaths(config.statePath, config.catalogDbPath)
    return successResponse(config.supervisorJob
      ? runSupervisorJob(config)
      : runRdSupervisorLoop({ path: config.statePath, input: config.input, catalogDbPath: config.catalogDbPath }))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { statePath: "", catalogDbPath: "./data/data_catalog.db", input: {}, supervisorJob: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--state": config.statePath = readValue(argv, ++index, arg); break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg)); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--supervisor-job": config.supervisorJob = true; break
      case "--help": printHelp(); process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function runSupervisorJob(config: Config): JSONRecord {
  const input = config.input as SupervisorJobInput
  const cycleId = input.cycle_id || "manual-cycle"
  const ticketNo = input.ticket_no || "J04"
  const jobId = input.job_id || "rd_strategy_supervisor"
  const idempotencyKey = input.idempotency_key || `${cycleId}:${ticketNo}`
  const statePath = input.state_path || config.statePath || "./data/rd/program.json"
  const catalogDbPath = input.catalog_db_path || config.catalogDbPath
  const supervisorInput = {
    ...asRecord(input.supervisor),
    now: input.now || stringField(asRecord(input.supervisor).now) || undefined,
  }
  const inputRefs = [`research_state_store:program/${statePath}`]
  let data: JSONRecord
  let domainStatus = "ok"
  let outputRefs: string[] = []

  assertRuntimeOutputPaths(statePath, catalogDbPath)
  if (!existsSync(statePath)) {
    const goal = asRecord(input.goal)
    const init = runRdProgramStateCommand({
      path: statePath,
      catalogDbPath,
      input: {
        action: "init",
        now: input.now,
        objective: stringField(goal.objective) || "find a shadow-eligible 4H swing strategy",
        budget: asRecord(goal.budget),
        next_hypothesis_queue: Array.isArray(goal.next_hypothesis_queue) ? goal.next_hypothesis_queue : [],
      },
    })
    data = {
      mode: "init",
      init,
    }
    outputRefs = [stringField(init.state_ref) || statePath]
  } else {
    const runResult = runRdSupervisorLoop({ path: statePath, input: supervisorInput, catalogDbPath }) as unknown as JSONRecord
    data = {
      mode: "loop",
      result: runResult,
    }
    const status = stringField(runResult.status)
    domainStatus = status === "data_or_tool_blocked" ? "blocked" : "ok"
    outputRefs = [
      stringField(runResult.state_ref),
      stringField(runResult.strategy_ref),
      ...iterationResultRefs(runResult),
    ].filter(Boolean)
  }

  const runtimeResult = buildDomainJobResult({
    domain: "research-strategy-development",
    job_id: jobId,
    idempotency_key: idempotencyKey,
    status: domainStatus,
    input_refs: inputRefs,
    output_refs: outputRefs,
    writes: { research_state_store: true, artifact_catalog: true },
    incidents: [],
    audit: {
      cycle_id: cycleId,
      ticket_no: ticketNo,
      mode: stringField(data.mode),
      state_path: statePath,
      catalog_db_path: catalogDbPath,
    },
  })
  validateDomainJobResult(runtimeResult, ["research_state_store", "artifact_catalog"])
  return {
    ...data,
    runtime_result: runtimeResult,
  }
}

function assertRuntimeOutputPaths(...paths: string[]): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJsonFile(path: string): JSONRecord {
  return readJson(readFileSync(path, "utf8"))
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function iterationResultRefs(value: JSONRecord): string[] {
  const iterations = Array.isArray(value.iterations) ? value.iterations.map(asRecord) : []
  return iterations.map((iteration) => stringField(iteration.result_ref)).filter(Boolean)
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "rd-supervisor.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "rd-supervisor.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --state ./data/rd/program.json --json '{"max_iterations":10}'
  bun src/scripts/main.ts --supervisor-job --state ./data/rd/program.json --json '{"cycle_id":"cycle","goal":{"objective":"find edge"}}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
