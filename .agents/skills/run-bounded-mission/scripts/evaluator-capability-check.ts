#!/usr/bin/env bun

const decisionSchema = "bounded-mission.evaluator-capability-decision.v1"

export interface CapabilityDecision {
  schema_version: typeof decisionSchema
  status: "supported" | "unsupported"
  dispatch_allowed: boolean
  evidence_sha256: string | null
  candidate_locator: string | null
  instruction_commit: string | null
  reasons: string[]
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

if (import.meta.main) {
  if (process.argv.length !== 3 || process.argv[2] !== "--current-host") {
    process.stderr.write("Usage: evaluator-capability-check.ts --current-host\n")
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(currentHostDecision(), null, 2)}\n`)
  process.exit(1)
}
