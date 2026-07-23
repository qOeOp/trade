#!/usr/bin/env bun

import { buildExchangeCommandRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { stringArray, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "post-write-confirmation.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const commandRef = stringField(input.command_ref)
    const clientOrderId = stringField(input.client_order_id)
    const action = stringField(input.action)
    const status = stringField(input.status) || "confirmed"
    const idempotencyKey = stringField(input.idempotency_key)
    if (!commandRef) throw new Error("command_ref is required")
    if (!clientOrderId) throw new Error("client_order_id is required")
    if (!idempotencyKey) throw new Error("idempotency_key is required")
    return successResponse(SCHEMA_VERSION, buildExchangeCommandRef({
        command_ref: commandRef,
        client_order_id: clientOrderId,
        action: action as "place_entry" | "adjust_position" | "cancel_order" | "sync_protection" | "reduce_position" | "close_position",
        status: status as "planned" | "submitted" | "accepted" | "rejected" | "confirmed" | "unknown",
        idempotency_key: idempotencyKey,
        request_ref: stringField(input.request_ref) || undefined,
        result_ref: stringField(input.result_ref) || undefined,
        exchange_order_ids: stringArray(input.exchange_order_ids),
        source_intent_ref: stringField(input.source_intent_ref) || undefined,
        event_write_ref: stringField(input.event_write_ref) || undefined,
        capability_ref: stringField(input.capability_ref) || undefined,
      }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<post-write confirmation payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
