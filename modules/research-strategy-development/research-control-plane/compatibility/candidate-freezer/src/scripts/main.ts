#!/usr/bin/env bun

import { buildFrozenCandidateRef } from "../../../../../../contracts/protocol-fabric/src/protocol-fabric"
import { stringArray, stringField } from "../../../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"

const SCHEMA_VERSION = "candidate-freezer.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const candidateRef = stringField(input.candidate_ref)
    const strategyId = stringField(input.strategy_id)
    const frozenAt = stringField(input.frozen_at)
    const sourceEvidenceRefs = stringArray(input.source_evidence_refs)
    const promotionStatus = stringField(input.promotion_status)
    const contentHash = stringField(input.content_hash)
    if (!candidateRef) throw new Error("candidate_ref is required")
    if (!strategyId) throw new Error("strategy_id is required")
    if (!frozenAt) throw new Error("frozen_at is required")
    if (sourceEvidenceRefs.length === 0) throw new Error("source_evidence_refs must be non-empty")
    if (!["draft", "validated", "shadow_ready", "rejected"].includes(promotionStatus)) throw new Error("promotion_status is unsupported")
    if (!contentHash) throw new Error("content_hash is required")
    return successResponse(SCHEMA_VERSION, buildFrozenCandidateRef({
        candidate_ref: candidateRef,
        strategy_id: strategyId,
        frozen_at: frozenAt,
        source_evidence_refs: sourceEvidenceRefs,
        assumption_refs: optionalStringArray(input.assumption_refs),
        limit_refs: optionalStringArray(input.limit_refs),
        promotion_status: promotionStatus as "draft" | "validated" | "shadow_ready" | "rejected",
        content_hash: contentHash,
      }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

function optionalStringArray(value: unknown): string[] | undefined {
  const values = stringArray(value)
  return values.length > 0 ? values : undefined
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<frozen candidate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
