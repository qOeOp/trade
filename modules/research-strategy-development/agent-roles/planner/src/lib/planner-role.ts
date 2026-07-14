import { createHash } from "node:crypto"

export interface PlannerProposalInput {
  proposal_id: string
  hypothesis_id: string
  universe_node_id: string
  objective: string
  dataset_requirements: string[]
  candidate_space: Record<string, unknown>
  trial_budget: number
  evaluation_protocol_ref: string
  context_fingerprint: string
  created_at: string
}

export interface PlannerProposalSubmission extends PlannerProposalInput {
  schema_version: "trade.rd-planner-proposal-submission.v1"
  revision: 1
  proposal_hash: string
}

export function buildPlannerProposal(input: PlannerProposalInput): PlannerProposalSubmission {
  for (const [field, value] of Object.entries({
    proposal_id: input.proposal_id,
    hypothesis_id: input.hypothesis_id,
    universe_node_id: input.universe_node_id,
    objective: input.objective,
    evaluation_protocol_ref: input.evaluation_protocol_ref,
    context_fingerprint: input.context_fingerprint,
  })) if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  if (!Number.isSafeInteger(input.trial_budget) || input.trial_budget <= 0) throw new Error("trial_budget must be a positive integer")
  if (input.dataset_requirements.length === 0) throw new Error("dataset_requirements cannot be empty")
  if (Object.keys(input.candidate_space).length === 0) throw new Error("candidate_space cannot be empty")
  if (!Number.isFinite(Date.parse(input.created_at))) throw new Error("created_at must be an ISO timestamp")
  const body = { schema_version: "trade.rd-planner-proposal-submission.v1" as const, revision: 1 as const, ...input }
  return { ...body, proposal_hash: createHash("sha256").update(stable(body)).digest("hex") }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  return JSON.stringify(value) ?? "null"
}
