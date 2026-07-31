#!/usr/bin/env bun

import { buildResearchEvidenceRef } from "../../../../../contracts/protocol-fabric/src/protocol-fabric"
import { stringArray, stringField } from "../../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

type EvidenceKind = "experiment" | "validation" | "shadow" | "candidate" | "lesson"

const EVIDENCE_KINDS: EvidenceKind[] = ["experiment", "validation", "shadow", "candidate", "lesson"]
const SCHEMA_VERSION = "research-evidence-publisher.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = parseArgs(argv)
    const evidenceRef = stringField(input.evidence_ref)
    const evidenceKind = stringField(input.evidence_kind)
    const artifactRefs = stringArray(input.artifact_refs)
    const producedAt = stringField(input.produced_at)
    const contentHash = stringField(input.content_hash)
    if (!evidenceRef) throw new Error("evidence_ref is required")
    if (!EVIDENCE_KINDS.includes(evidenceKind as EvidenceKind)) throw new Error("evidence_kind is unsupported")
    if (artifactRefs.length === 0) throw new Error("artifact_refs must be non-empty")
    if (!producedAt) throw new Error("produced_at is required")
    if (!contentHash) throw new Error("content_hash is required")
    return successResponse(SCHEMA_VERSION, buildResearchEvidenceRef({
        evidence_ref: evidenceRef,
        evidence_kind: evidenceKind as EvidenceKind,
        artifact_refs: artifactRefs,
        candidate_refs: optionalStringArray(input.candidate_refs),
        source_refs: optionalStringArray(input.source_refs),
        produced_at: producedAt,
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
  console.log("Usage: bun src/scripts/main.ts --json '<research evidence payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
