#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const evidenceSchema = "bounded-mission.evaluator-host-capability.v1"
const decisionSchema = "bounded-mission.evaluator-capability-decision.v1"
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export interface CapabilityDecision {
  schema_version: typeof decisionSchema
  status: "supported" | "unsupported"
  dispatch_allowed: boolean
  evidence_sha256: string
  candidate_commit: string | null
  instruction_commit: string | null
  reasons: string[]
}

export function evaluateCapability(input: unknown, evidenceBytes: Uint8Array): CapabilityDecision {
  const reasons: string[] = []
  const evidence = asRecord(input)
  const source = asRecord(evidence?.source)
  const candidate = asRecord(evidence?.candidate)
  const authority = asRecord(evidence?.authority)
  const toolSurface = asRecord(evidence?.tool_surface)
  const tools = Array.isArray(toolSurface?.tools) ? toolSurface.tools : []
  const candidateCommit = stringValue(candidate?.candidate_commit)
  const instructionCommit = stringValue(candidate?.instruction_commit)

  if (evidence?.schema_version !== evidenceSchema) reasons.push("unsupported evidence schema")
  if (source?.kind !== "host-capability-api" || !nonEmptyString(source?.locator)) {
    reasons.push("capability evidence is not a located host capability API observation")
  }
  if (!commitPattern.test(candidateCommit ?? "")) reasons.push("candidate commit is not exact")
  if (!commitPattern.test(instructionCommit ?? "")) reasons.push("instruction commit is not exact")
  if (candidateCommit && instructionCommit && candidateCommit === instructionCommit) {
    reasons.push("reviewer instructions are candidate-controlled")
  }
  if (candidate?.access !== "evidence-only") reasons.push("candidate is not isolated as evidence-only")
  if (candidate?.automatic_discovery !== "candidate-excluded") {
    reasons.push("automatic instruction discovery does not exclude the candidate")
  }
  if (authority?.filesystem !== "read-only" || authority?.writes !== "none") {
    reasons.push("runtime authority is not read-only")
  }
  if (authority?.delegation !== "unavailable") reasons.push("delegation is available or unverified")
  if (authority?.lateral_communication !== "unavailable") {
    reasons.push("lateral communication is available or unverified")
  }
  if (toolSurface?.complete !== true) reasons.push("tool surface is incomplete or unverified")
  if (!Array.isArray(toolSurface?.tools) || tools.length === 0) {
    reasons.push("tool surface is missing")
  } else {
    for (const tool of tools) {
      const entry = asRecord(tool)
      if (!nonEmptyString(entry?.name) || entry?.effect !== "read-only") {
        reasons.push("tool surface contains an unnamed or non-read-only capability")
        break
      }
    }
  }

  return {
    schema_version: decisionSchema,
    status: reasons.length === 0 ? "supported" : "unsupported",
    dispatch_allowed: reasons.length === 0,
    evidence_sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
    candidate_commit: commitPattern.test(candidateCommit ?? "") ? candidateCommit : null,
    instruction_commit: commitPattern.test(instructionCommit ?? "") ? instructionCommit : null,
    reasons,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function usage(): never {
  process.stderr.write("Usage: evaluator-capability-check.ts --evidence <host-capability.json>\n")
  process.exit(2)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--evidence" || !args[1]) usage()

  try {
    const bytes = readFileSync(args[1])
    const decision = evaluateCapability(JSON.parse(bytes.toString()) as unknown, bytes)
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`)
    process.exit(decision.dispatch_allowed ? 0 : 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`evaluator capability evidence is invalid: ${message}\n`)
    process.exit(2)
  }
}
