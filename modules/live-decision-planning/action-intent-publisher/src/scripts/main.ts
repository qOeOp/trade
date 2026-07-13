#!/usr/bin/env bun

import { buildActionIntentRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { stringArray, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type IntentKind = "trade_plan" | "watchlist" | "no_action"
type IntentStatus = "proposed" | "blocked" | "expired"
type IntentSide = "long" | "short" | "flat"

const INTENT_KINDS: IntentKind[] = ["trade_plan", "watchlist", "no_action"]
const INTENT_STATUSES: IntentStatus[] = ["proposed", "blocked", "expired"]
const INTENT_SIDES: IntentSide[] = ["long", "short", "flat"]
const SCHEMA_VERSION = "action-intent-publisher.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
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
    return successResponse(SCHEMA_VERSION, buildActionIntentRef({
        intent_ref: intentRef,
        intent_kind: intentKind as IntentKind,
        status: status as IntentStatus,
        symbol: stringField(input.symbol) || undefined,
        side: side ? side as IntentSide : undefined,
        source_refs: sourceRefs,
        expires_at: stringField(input.expires_at) || undefined,
        no_action_reason: stringField(input.no_action_reason) || undefined,
        content_hash: contentHash,
      }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<action intent payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
