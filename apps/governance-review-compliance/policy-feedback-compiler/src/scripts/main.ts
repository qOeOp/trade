#!/usr/bin/env bun

import { buildGovernanceRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { stringArray, stringField } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

type JSONRecord = Record<string, unknown>

const RECOMMENDATION_KINDS = ["risk_limit", "deprecation", "mode_constraint", "manual_review"] as const
const SEVERITIES = ["info", "warning", "critical"] as const

function main(argv: string[]): void {
  const result = run(argv)
  printScriptResult(result)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const feedbackRef = stringField(input.feedback_ref)
    const reviewRefs = stringArray(input.review_refs)
    const recommendationKind = stringField(input.recommendation_kind)
    const severity = stringField(input.severity) || "info"
    const contentHash = stringField(input.content_hash)
    if (!feedbackRef) throw new Error("feedback_ref is required")
    if (reviewRefs.length === 0) throw new Error("review_refs must be non-empty")
    if (!RECOMMENDATION_KINDS.includes(recommendationKind as typeof RECOMMENDATION_KINDS[number])) throw new Error("recommendation_kind is unsupported")
    if (!SEVERITIES.includes(severity as typeof SEVERITIES[number])) throw new Error("severity is unsupported")
    if (!contentHash) throw new Error("content_hash is required")
    return successResponse("policy-feedback-compiler.result.v1", {
        schema_version: "policy-feedback.v1",
        feedback_ref: feedbackRef,
        review_refs: reviewRefs,
        recommendation_kind: recommendationKind,
        severity,
        policy_scope: stringField(input.policy_scope) || "runtime_policy",
        decision: stringField(input.decision) || "proposed",
        content_hash: contentHash,
        governance_ref: buildGovernanceRef({
          ref: feedbackRef,
          kind: "policy_feedback",
          strategy_id: stringField(input.strategy_id) || undefined,
          cycle_id: stringField(input.cycle_id) || undefined,
          decision: stringField(input.decision) || "proposed",
        }),
    })
  } catch (error) {
    return errorResponse("policy-feedback-compiler.result.v1", error)
  }
}

function parseArgs(argv: string[]): JSONRecord {
  return readJsonObjectFlag(argv, printHelp)
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<policy feedback payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
