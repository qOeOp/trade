#!/usr/bin/env bun

import { buildExchangeCommandRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const commandRef = stringField(input.command_ref)
    const clientOrderId = stringField(input.client_order_id)
    const action = stringField(input.action)
    const status = stringField(input.status) || "confirmed"
    const idempotencyKey = stringField(input.idempotency_key)
    if (!commandRef) throw new Error("command_ref is required")
    if (!clientOrderId) throw new Error("client_order_id is required")
    if (!idempotencyKey) throw new Error("idempotency_key is required")
    return {
      ok: true,
      schema_version: "post-write-confirmation.result.v1",
      data: buildExchangeCommandRef({
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
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "post-write-confirmation.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
}

function parseArgs(argv: string[]): JSONRecord {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") return readJson(readValue(argv, ++index, arg))
    if (arg === "--help") {
      printHelp()
      process.exit(0)
    }
    throw new Error(`unknown flag: ${arg}`)
  }
  return {}
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
  return values.length > 0 ? values : undefined
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<post-write confirmation payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
