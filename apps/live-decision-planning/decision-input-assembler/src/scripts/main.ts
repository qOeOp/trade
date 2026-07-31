#!/usr/bin/env bun

import { stringArray, stringField, withoutUndefined, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "decision-input-assembler.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const decisionInputRef = stringField(input.decision_input_ref)
    const sourceRefs = stringArray(input.source_refs)
    const assembledAt = stringField(input.assembled_at)
    if (!decisionInputRef) throw new Error("decision_input_ref is required")
    if (sourceRefs.length === 0) throw new Error("source_refs must be non-empty")
    if (!assembledAt) throw new Error("assembled_at is required")
    return successResponse(SCHEMA_VERSION, withoutUndefined({
        schema_version: "decision-input-bundle.v1",
        decision_input_ref: decisionInputRef,
        source_refs: sourceRefs,
        policy_refs: stringArray(input.policy_refs),
        market_refs: stringArray(input.market_refs),
        flow_refs: stringArray(input.flow_refs),
        account_refs: stringArray(input.account_refs),
        evidence_refs: stringArray(input.evidence_refs),
        symbol_scope: stringArray(input.symbol_scope),
        assembled_at: assembledAt,
        content_hash: stringField(input.content_hash) || stableHash([decisionInputRef, ...sourceRefs, assembledAt].join("|")),
      }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<decision input payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
