#!/usr/bin/env bun

import { buildGovernanceRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { asRecord, stringArray, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "evidence-intake-gate.result.v1"

interface GateIssue {
  field: string
  reason: string
}

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const issues = validateEvidence(input)
    const decision = issues.length === 0 ? "accepted" : "needs_evidence"
    const verdictRef = stringField(input.verdict_ref) || `governance_ledger:evidence_verdict/${stringField(input.evidence_ref) || "unknown"}`
    return {
      ok: issues.length === 0,
      schema_version: SCHEMA_VERSION,
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
    return errorResponse(SCHEMA_VERSION, error)
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

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<governance evidence payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
