#!/usr/bin/env bun

import { buildGovernanceRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>

const RECOMMENDATION_KINDS = ["risk_limit", "deprecation", "mode_constraint", "manual_review"] as const
const SEVERITIES = ["info", "warning", "critical"] as const

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
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
    return {
      ok: true,
      schema_version: "policy-feedback-compiler.result.v1",
      data: {
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
      },
    }
  } catch (error) {
    return { ok: false, schema_version: "policy-feedback-compiler.result.v1", error: error instanceof Error ? error.message : String(error) }
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
  console.log("Usage: bun src/scripts/main.ts --json '<policy feedback payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
