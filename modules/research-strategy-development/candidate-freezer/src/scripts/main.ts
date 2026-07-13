#!/usr/bin/env bun

import { buildFrozenCandidateRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
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
    return {
      ok: true,
      schema_version: "candidate-freezer.result.v1",
      data: buildFrozenCandidateRef({
        candidate_ref: candidateRef,
        strategy_id: strategyId,
        frozen_at: frozenAt,
        source_evidence_refs: sourceEvidenceRefs,
        assumption_refs: optionalStringArray(input.assumption_refs),
        limit_refs: optionalStringArray(input.limit_refs),
        promotion_status: promotionStatus as "draft" | "validated" | "shadow_ready" | "rejected",
        content_hash: contentHash,
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "candidate-freezer.result.v1", error: error instanceof Error ? error.message : String(error) }
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

function optionalStringArray(value: unknown): string[] | undefined {
  const values = stringArray(value)
  return values.length > 0 ? values : undefined
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<frozen candidate payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
