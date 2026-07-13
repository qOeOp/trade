#!/usr/bin/env bun

import { buildActionIntentRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>
type IntentKind = "trade_plan" | "watchlist" | "no_action"
type IntentStatus = "proposed" | "blocked" | "expired"
type IntentSide = "long" | "short" | "flat"

const INTENT_KINDS: IntentKind[] = ["trade_plan", "watchlist", "no_action"]
const INTENT_STATUSES: IntentStatus[] = ["proposed", "blocked", "expired"]
const INTENT_SIDES: IntentSide[] = ["long", "short", "flat"]

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const intentRef = stringField(input.intent_ref)
    const intentKind = stringField(input.intent_kind)
    const status = stringField(input.status)
    const sourceRefs = stringArray(input.source_refs)
    const contentHash = stringField(input.content_hash)
    const side = stringField(input.side)
    if (!intentRef) throw new Error("intent_ref is required")
    if (!INTENT_KINDS.includes(intentKind as IntentKind)) throw new Error("intent_kind is unsupported")
    if (!INTENT_STATUSES.includes(status as IntentStatus)) throw new Error("status is unsupported")
    if (sourceRefs.length === 0) throw new Error("source_refs must be non-empty")
    if (side && !INTENT_SIDES.includes(side as IntentSide)) throw new Error("side is unsupported")
    if (!contentHash) throw new Error("content_hash is required")
    return {
      ok: true,
      schema_version: "action-intent-publisher.result.v1",
      data: buildActionIntentRef({
        intent_ref: intentRef,
        intent_kind: intentKind as IntentKind,
        status: status as IntentStatus,
        symbol: stringField(input.symbol) || undefined,
        side: side ? side as IntentSide : undefined,
        source_refs: sourceRefs,
        expires_at: stringField(input.expires_at) || undefined,
        no_action_reason: stringField(input.no_action_reason) || undefined,
        content_hash: contentHash,
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "action-intent-publisher.result.v1", error: error instanceof Error ? error.message : String(error) }
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<action intent payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
