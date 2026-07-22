#!/usr/bin/env bun

import { resolve } from "node:path"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import { assertProjectRuntimePath, repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { runRdAutonomyCycle, type AutonomyInvoker, type AutonomyOwner } from "../lib/rd-autonomy-cycle"

interface Config { db: string; catalogDb: string; programId: string; profile: string; input: JSONRecord }

async function run(argv: string[]): Promise<JSONRecord> {
  try {
    const config = parse(argv)
    assertProjectRuntimePath(config.db); assertProjectRuntimePath(config.catalogDb)
    if (config.profile !== "profile/model-gateway.json") throw new Error("--profile must be profile/model-gateway.json")
    const cycleId = text(config.input.cycle_id) || "manual-cycle"
    const now = text(config.input.now) || new Date().toISOString()
    const supervisorPayload = { ...config.input, cycle_id: cycleId, now, db_path: config.db, program_id: config.programId, catalog_db_path: config.catalogDb }
    const invoke = ownerInvoker(config, supervisorPayload)
    const result = await runRdAutonomyCycle({
      cycle_id: cycleId, now, program_id: config.programId,
      program_ref: `research_state_store:rd_program/${safeId(config.programId)}`,
      supervisor_payload: supervisorPayload,
    }, invoke)
    return successResponse("rd-autonomy-cycle.script-response.v1", result)
  } catch (error) {
    return errorResponse("rd-autonomy-cycle.script-response.v1", error)
  }
}

function ownerInvoker(config: Config, supervisorPayload: JSONRecord): AutonomyInvoker {
  return async (owner, payload) => ownerData(await execute(fixedCommand(owner, config, supervisorPayload, payload), owner === "supervisor" ? 30_000 : 45_000))
}

function fixedCommand(owner: AutonomyOwner, config: Config, supervisorPayload: JSONRecord, payload: JSONRecord): string[] {
  if (owner === "plan" || owner === "queue") return ["modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts", "--db", config.db, "--program-id", config.programId, "--json", JSON.stringify(payload)]
  if (owner === "model_task") return ["modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer/src/scripts/main.ts", "--action", "model_task", "--json", JSON.stringify(payload)]
  if (owner === "gateway") return ["modules/orchestration-ops/model-gateway/src/scripts/main.ts", "--profile", config.profile, "--json", JSON.stringify(payload)]
  if (owner === "assess") return ["modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer/src/scripts/main.ts", "--action", "assess_model_result", "--json", JSON.stringify(payload)]
  return ["modules/research-strategy-development/research-control-plane/program-supervisor/src/scripts/main.ts", "--supervisor-job", "--db", config.db, "--program-id", config.programId, "--catalog-db", config.catalogDb, "--json", JSON.stringify(supervisorPayload)]
}

async function execute(command: string[], timeoutMs: number): Promise<JSONRecord> {
  const child = Bun.spawn({ cmd: [process.execPath, resolve(repoRoot(), command[0]), ...command.slice(1)], cwd: repoRoot(), env: process.env, stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (timedOut) throw new Error("autonomy owner CLI timed out")
    if (exitCode !== 0) throw new Error(stderr.trim().slice(0, 2_000) || `autonomy owner exited ${exitCode}`)
    const value = JSON.parse(stdout.trim()) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("autonomy owner returned non-object JSON")
    const result = value as JSONRecord
    if (result.ok === false) throw new Error(text(record(result.error).message) || "autonomy owner reported failure")
    return result
  } finally { clearTimeout(timer) }
}

function parse(argv: string[]): Config {
  const config: Config = { db: "data/rd_state.db", catalogDb: "data/data_catalog.db", programId: "rd-program", profile: "profile/model-gateway.json", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") config.db = readFlagValue(argv, ++index, arg)
    else if (arg === "--catalog-db") config.catalogDb = readFlagValue(argv, ++index, arg)
    else if (arg === "--program-id") config.programId = readFlagValue(argv, ++index, arg)
    else if (arg === "--profile") config.profile = readFlagValue(argv, ++index, arg)
    else if (arg === "--json") config.input = readJsonObject(readFlagValue(argv, ++index, arg))
    else if (arg === "--help") { console.log("Usage: bun src/scripts/main.ts --db data/rd_state.db --catalog-db data/data_catalog.db --program-id rd-program --profile profile/model-gateway.json --json '<J04 payload>'"); process.exit(0) }
    else throw new Error(`unknown flag: ${arg}`)
  }
  return config
}

function ownerData(value: JSONRecord): JSONRecord { return record(value.data) }
function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function safeId(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-program" }

printScriptResult(await run(Bun.argv.slice(2)))
