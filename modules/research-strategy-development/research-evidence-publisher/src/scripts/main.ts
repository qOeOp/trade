#!/usr/bin/env bun

import { buildResearchEvidenceRef } from "../../../../contracts/protocol-fabric/src/protocol-fabric"

type JSONRecord = Record<string, unknown>
type EvidenceKind = "experiment" | "validation" | "shadow" | "candidate" | "lesson"

const EVIDENCE_KINDS: EvidenceKind[] = ["experiment", "validation", "shadow", "candidate", "lesson"]

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
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
    return {
      ok: true,
      schema_version: "research-evidence-publisher.result.v1",
      data: buildResearchEvidenceRef({
        evidence_ref: evidenceRef,
        evidence_kind: evidenceKind as EvidenceKind,
        artifact_refs: artifactRefs,
        candidate_refs: optionalStringArray(input.candidate_refs),
        source_refs: optionalStringArray(input.source_refs),
        produced_at: producedAt,
        content_hash: contentHash,
      }),
    }
  } catch (error) {
    return { ok: false, schema_version: "research-evidence-publisher.result.v1", error: error instanceof Error ? error.message : String(error) }
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
  console.log("Usage: bun src/scripts/main.ts --json '<research evidence payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
