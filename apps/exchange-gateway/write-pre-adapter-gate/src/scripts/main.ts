#!/usr/bin/env bun

import { validateExecutionCapability } from "../../../../contracts/execution-capability-contract/src/execution-capability-contract"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "write-pre-adapter-gate.result.v1"

const WRITE_ACTIONS = ["place_entry", "cancel_order", "adjust_position", "sync_protection", "reduce_position", "close_position"] as const

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const issues = validateGate(input)
    return {
      ok: issues.length === 0,
      schema_version: SCHEMA_VERSION,
      data: {
        schema_version: "exchange-write-pre-adapter-gate.v1",
        status: issues.length === 0 ? "passed" : "blocked",
        issues,
        action: stringField(input.action),
        mode: stringField(input.mode),
        idempotency_key: stringField(input.idempotency_key),
        source_intent_ref: stringField(input.source_intent_ref),
        client_order_id: stringField(input.client_order_id) || undefined,
      },
      ...(issues.length > 0 ? { error: issues.map((issue) => `${issue.field}:${issue.reason}`).join("; ") } : {}),
    }
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function validateGate(input: JSONRecord): Array<{ field: string; reason: string }> {
  const issues: Array<{ field: string; reason: string }> = []
  const action = stringField(input.action)
  if (!WRITE_ACTIONS.includes(action as typeof WRITE_ACTIONS[number])) issues.push({ field: "action", reason: "unsupported write action" })
  if (!stringField(input.mode)) issues.push({ field: "mode", reason: "required" })
  if (!stringField(input.idempotency_key)) issues.push({ field: "idempotency_key", reason: "required" })
  if (!stringField(input.source_intent_ref)) issues.push({ field: "source_intent_ref", reason: "required" })
  if (input.authorized !== true) issues.push({ field: "authorized", reason: "must be true" })
  for (const issue of validateExecutionCapability(asRecord(input.capability), {
    target_action: action,
    idempotency_key: stringField(input.idempotency_key),
    source_intent_ref: stringField(input.source_intent_ref),
    now: stringField(input.now) || undefined,
  })) {
    issues.push({ field: `capability.${issue}`, reason: "invalid or mismatched" })
  }
  return issues
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<exchange write gate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
