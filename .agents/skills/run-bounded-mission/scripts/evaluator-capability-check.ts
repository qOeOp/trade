#!/usr/bin/env bun

import { createHash } from "node:crypto"

const evidenceSchema = "bounded-mission.evaluator-host-capability.v1"
const decisionSchema = "bounded-mission.evaluator-capability-decision.v1"
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const digestPattern = /^[0-9a-f]{64}$/

export interface CapabilityDecision {
  schema_version: typeof decisionSchema
  status: "supported" | "unsupported"
  dispatch_allowed: boolean
  evidence_sha256: string | null
  candidate_locator: string | null
  instruction_commit: string | null
  reasons: string[]
}

export function evaluateTrustedCapability(
  input: unknown,
  evidenceBytes: Uint8Array,
): CapabilityDecision {
  const reasons: string[] = []
  const evidence = asRecord(input)
  const context = asRecord(evidence?.context)
  const candidate = asRecord(evidence?.candidate)
  const locator = asRecord(candidate?.locator)
  const authority = asRecord(evidence?.authority)
  const toolSurface = asRecord(evidence?.tool_surface)
  const tools = Array.isArray(toolSurface?.tools) ? toolSurface.tools : []
  const instructionCommit = stringValue(candidate?.instruction_commit)
  const candidateLocator = validateCandidateLocator(locator, reasons)
  const reviewerContext = stringValue(context?.reviewer_context_id)
  const builderContexts = Array.isArray(context?.builder_context_ids)
    ? context.builder_context_ids
    : []

  if (evidence?.schema_version !== evidenceSchema) reasons.push("unsupported evidence schema")
  if (!reviewerContext || builderContexts.length === 0 || builderContexts.some((id) => !nonEmptyString(id))) {
    reasons.push("reviewer or builder context identity is missing")
  }
  if (reviewerContext && builderContexts.includes(reviewerContext)) {
    reasons.push("reviewer context participated in the candidate build")
  }
  if (context?.build_participation !== "none") {
    reasons.push("reviewer non-participation is unavailable or unverified")
  }
  if (!commitPattern.test(instructionCommit ?? "")) reasons.push("instruction commit is not exact")
  if (locator?.kind === "commit" && locator?.commit === instructionCommit) {
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
    candidate_locator: candidateLocator,
    instruction_commit: commitPattern.test(instructionCommit ?? "") ? instructionCommit : null,
    reasons,
  }
}

export function currentHostDecision(): CapabilityDecision {
  return {
    schema_version: decisionSchema,
    status: "unsupported",
    dispatch_allowed: false,
    evidence_sha256: null,
    candidate_locator: null,
    instruction_commit: null,
    reasons: ["current host does not expose a trusted evaluator capability observation channel"],
  }
}

function validateCandidateLocator(
  locator: Record<string, unknown> | null,
  reasons: string[],
): string | null {
  if (locator?.kind === "commit" && commitPattern.test(stringValue(locator.commit) ?? "")) {
    return `commit:${String(locator.commit)}`
  }
  if (
    locator?.kind === "diff"
    && commitPattern.test(stringValue(locator.origin_commit) ?? "")
    && digestPattern.test(stringValue(locator.diff_sha256) ?? "")
    && locator.includes_untracked === true
  ) {
    return `diff:${String(locator.origin_commit)}:${String(locator.diff_sha256)}`
  }
  reasons.push("candidate locator is not an exact commit or complete diff digest")
  return null
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

if (import.meta.main) {
  if (process.argv.length !== 3 || process.argv[2] !== "--current-host") {
    process.stderr.write("Usage: evaluator-capability-check.ts --current-host\n")
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(currentHostDecision(), null, 2)}\n`)
  process.exit(1)
}
