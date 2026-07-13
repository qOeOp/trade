#!/usr/bin/env bun

import { buildGovernanceRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>

interface GateIssue {
  field: string
  reason: string
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const issues = validateEvidence(input)
    const decision = issues.length === 0 ? "accepted" : "needs_evidence"
    const verdictRef = stringField(input.verdict_ref) || `governance_ledger:evidence_verdict/${stringField(input.evidence_ref) || "unknown"}`
    return {
      ok: issues.length === 0,
      schema_version: "evidence-intake-gate.result.v1",
      data: {
        status: decision,
        issues,
        governance_ref: buildGovernanceRef({
          ref: verdictRef,
          kind: "evidence_verdict",
          strategy_id: stringField(input.strategy_id) || undefined,
          cycle_id: stringField(input.cycle_id) || undefined,
          decision,
        }),
      },
      ...(issues.length > 0 ? { error: issues.map((issue) => `${issue.field}:${issue.reason}`).join("; ") } : {}),
    }
  } catch (error) {
    return { ok: false, schema_version: "evidence-intake-gate.result.v1", error: error instanceof Error ? error.message : String(error) }
  }
}

function validateEvidence(input: JSONRecord): GateIssue[] {
  const issues: GateIssue[] = []
  if (!stringField(input.evidence_ref)) issues.push({ field: "evidence_ref", reason: "required" })
  if (stringArray(input.source_refs).length === 0) issues.push({ field: "source_refs", reason: "must be non-empty" })
  if (!stringField(input.data_hash)) issues.push({ field: "data_hash", reason: "required" })
  if (!stringField(input.policy_hash)) issues.push({ field: "policy_hash", reason: "required" })
  const freshness = asRecord(input.freshness)
  if (!stringField(freshness.as_of)) issues.push({ field: "freshness.as_of", reason: "required" })
  const maxAge = freshness.max_age_seconds
  if (maxAge !== undefined && (!Number.isFinite(Number(maxAge)) || Number(maxAge) < 0)) {
    issues.push({ field: "freshness.max_age_seconds", reason: "must be non-negative" })
  }
  return issues
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<governance evidence payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
