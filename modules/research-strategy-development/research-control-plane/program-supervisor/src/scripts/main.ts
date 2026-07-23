#!/usr/bin/env bun

import { buildDomainJobResult, validateDomainJobResult } from "../../../../../contracts/domain-runtime/src/domain-runtime"
import { assertProjectRuntimePath, repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { strategyHypothesisToQueueItem } from "../../../../../contracts/strategy-hypothesis-contract/src/strategy-hypothesis-contract"
import { runRdProgramStateCommand } from "../../../program-control/src/lib/rd-program-state"
import { runRdSupervisorLoop } from "../lib/rd-supervisor-runner"
import {
  executeCompatibilityEvaluationWorkPackage,
} from "../lib/compatibility-evaluation-runner"
import {
  COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/experiment-evaluation-work-package"

interface Config {
  dbPath: string
  programId: string
  catalogDbPath: string
  input: JSONRecord
  supervisorJob: boolean
  evaluationJob: boolean
}

interface SupervisorJobInput {
  cycle_id?: string
  ticket_no?: string
  job_id?: string
  idempotency_key?: string
  now?: string
  db_path?: string
  program_id?: string
  catalog_db_path?: string
  goal?: JSONRecord
  supervisor?: JSONRecord
  hypothesis_contract_path?: string
}

const SCHEMA_VERSION = "rd-supervisor.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertRuntimeOutputPaths(config.dbPath, config.catalogDbPath)
    const data = config.evaluationJob
      ? runEvaluationJob(config)
      : config.supervisorJob
      ? runSupervisorJob(config)
      : runRdSupervisorLoop({
          path: rdProgramRef(config.programId),
          dbPath: config.dbPath,
          input: config.input,
          catalogDbPath: config.catalogDbPath,
          environmentId: environmentId(config.input),
        })
    return successResponse(SCHEMA_VERSION, data)
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    dbPath: "./data/rd_state.db",
    programId: "rd-program",
    catalogDbPath: "./data/data_catalog.db",
    input: {},
    supervisorJob: false,
    evaluationJob: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db":
        config.dbPath = readFlagValue(argv, ++index, arg)
        break
      case "--program-id":
        config.programId = readFlagValue(argv, ++index, arg)
        break
      case "--catalog-db":
        config.catalogDbPath = readFlagValue(argv, ++index, arg)
        break
      case "--input":
        config.input = readJsonObjectFile(readFlagValue(argv, ++index, arg))
        break
      case "--json":
        config.input = readJsonObject(readFlagValue(argv, ++index, arg))
        break
      case "--supervisor-job":
        config.supervisorJob = true
        break
      case "--evaluation-job":
        config.evaluationJob = true
        break
      case "--help":
        exitWithHelp()
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (config.supervisorJob && config.evaluationJob) {
    throw new Error("--supervisor-job and --evaluation-job are mutually exclusive")
  }
  return config
}

function runEvaluationJob(config: Config): JSONRecord {
  const input = config.input
  const artifactRoot = stringField(input.artifact_root)
  const catalogDbPath = stringField(input.catalog_db_path) || config.catalogDbPath
  assertRuntimeOutputPaths(artifactRoot, catalogDbPath)
  return executeCompatibilityEvaluationWorkPackage(config.dbPath, {
    schema_version: COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION,
    package_id: stringField(input.package_id),
    package_hash: stringField(input.package_hash),
    environment_id: stringField(input.environment_id)
      || process.env.TRADE_ENVIRONMENT_ID
      || "local:local",
    artifact_root: artifactRoot,
    catalog_db_path: catalogDbPath,
    completed_at: stringField(input.completed_at),
  })
}

function runSupervisorJob(config: Config): JSONRecord {
  const input = config.input as SupervisorJobInput
  const cycleId = input.cycle_id || "manual-cycle"
  const ticketNo = input.ticket_no || "J04"
  const jobId = input.job_id || "rd_strategy_supervisor"
  const idempotencyKey = input.idempotency_key || `${cycleId}:${ticketNo}`
  const dbPath = input.db_path || config.dbPath
  const programId = input.program_id || config.programId
  const stateRef = rdProgramRef(programId)
  const catalogDbPath = input.catalog_db_path || config.catalogDbPath
  const supervisorConfig = asRecord(input.supervisor)
  const supervisorInput = {
    ...supervisorConfig,
    control_plane_required: supervisorConfig.control_plane_required !== false,
    now: input.now || stringField(supervisorConfig.now) || undefined,
  }
  const inputRefs = [stateRef]
  let initResult: JSONRecord | undefined

  assertRuntimeOutputPaths(dbPath, catalogDbPath)
  if (!rdProgramExists(stateRef, dbPath)) {
    const goal = asRecord(input.goal)
    const init = runRdProgramStateCommand({
      dbPath,
      programId,
      input: {
        action: "init",
        now: input.now,
        objective: stringField(goal.objective) || "find a shadow-eligible 4H swing strategy",
        budget: asRecord(goal.budget),
        next_hypothesis_queue: initialHypothesisQueue(input, goal),
      },
    })
    initResult = init as unknown as JSONRecord
  }
  const runResult = runRdSupervisorLoop({
    path: stateRef,
    dbPath,
    input: supervisorInput,
    catalogDbPath,
    environmentId: environmentId(input as unknown as JSONRecord),
  }) as unknown as JSONRecord
  const data = {
    mode: initResult ? "init_loop" : "loop",
    ...(initResult ? { init: initResult } : {}),
    result: runResult,
  }
  const status = stringField(runResult.status)
  const domainStatus = status === "data_or_tool_blocked" ? "blocked" : "ok"
  const outputRefs = uniqueStrings([
    stringField(initResult?.state_ref),
    stringField(runResult.state_ref),
    stringField(runResult.strategy_ref),
    ...iterationResultRefs(runResult),
  ])

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
      state_ref: stateRef,
      db_path: dbPath,
      catalog_db_path: catalogDbPath,
    },
  })
  validateDomainJobResult(runtimeResult, ["research_state_store", "artifact_catalog"])
  return {
    ...data,
    runtime_result: runtimeResult,
  }
}

function initialHypothesisQueue(input: SupervisorJobInput, goal: JSONRecord): JSONRecord[] {
  if (Array.isArray(goal.next_hypothesis_queue) && goal.next_hypothesis_queue.length > 0) {
    return goal.next_hypothesis_queue.map(asRecord)
  }
  const contractPath = stringField(goal.hypothesis_contract_path) || stringField(input.hypothesis_contract_path)
  if (contractPath) {
    return [strategyHypothesisToQueueItem(readJsonObjectFile(contractPath))]
  }
  const contract = asRecord(goal.hypothesis_contract)
  if (Object.keys(contract).length > 0) {
    return [strategyHypothesisToQueueItem(contract)]
  }
  return []
}

function assertRuntimeOutputPaths(...paths: string[]): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function environmentId(input: JSONRecord): string {
  return stringField(input.environment_id)
    || process.env.TRADE_ENVIRONMENT_ID
    || "local:local"
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function iterationResultRefs(value: JSONRecord): string[] {
  const iterations = Array.isArray(value.iterations) ? value.iterations.map(asRecord) : []
  const finalState = asRecord(value.final_state)
  const artifactRefs = Array.isArray(finalState.artifact_refs) ? finalState.artifact_refs.map(stringField) : []
  return [
    ...iterations.map((iteration) => stringField(iteration.result_ref)),
    ...artifactRefs,
  ].filter(Boolean)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function rdProgramRef(programId: string): string {
  const id = programId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-program"
  return `research_state_store:rd_program/${id}`
}

function rdProgramExists(stateRef: string, dbPath: string): boolean {
  try {
    runRdProgramStateCommand({ path: stateRef, dbPath, input: { action: "read" } })
    return true
  } catch {
    return false
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --db ./data/rd_state.db --program-id rd-program --json '{"max_iterations":10}'
  bun src/scripts/main.ts --supervisor-job --db ./data/rd_state.db --program-id rd-program --json '{"cycle_id":"cycle","goal":{"objective":"find edge"}}'
  bun src/scripts/main.ts --evaluation-job --db ./data/rd_state.db --json '{"package_id":"evaluation-package:...","package_hash":"...","artifact_root":"tmp/artifacts/strategy-rnd","completed_at":"..."}'
`)
}

function exitWithHelp(): never {
  printHelp()
  process.exit(0)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
