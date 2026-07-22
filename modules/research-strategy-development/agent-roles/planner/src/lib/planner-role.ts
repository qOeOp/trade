import {
  assertPlannerControlPlaneContextSnapshot,
  type PlannerControlPlaneContextSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/planner-control-plane-context"
import {
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  createPlannerProposalSubmission,
  type PlannerProposalSubmission,
} from "../../../../research-control-plane/contracts/src/lib/planner-proposal-submission"

export interface PlannerProposalInput {
  proposal_id: string
  hypothesis_id: string
  universe_node_id: string
  objective: string
  dataset_requirements: string[]
  candidate_space: Record<string, unknown>
  trial_budget: number
  evaluation_protocol_ref: string
  control_plane_context: PlannerControlPlaneContextSnapshot
  created_at: string
}

export function buildPlannerProposal(input: PlannerProposalInput): PlannerProposalSubmission {
  assertPlannerControlPlaneContextSnapshot(input.control_plane_context)
  for (const [field, value] of Object.entries({
    proposal_id: input.proposal_id,
    hypothesis_id: input.hypothesis_id,
    universe_node_id: input.universe_node_id,
    objective: input.objective,
    evaluation_protocol_ref: input.evaluation_protocol_ref,
  })) if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  const selectedCanonical = input.control_plane_context.active_canonicals
    .find((item) => item.node_id === input.universe_node_id)
  if (!selectedCanonical) {
    throw new Error("universe_node_id is not active in the bound Control Plane context")
  }
  if (!Number.isSafeInteger(input.trial_budget) || input.trial_budget <= 0) {
    throw new Error("trial_budget must be a positive integer")
  }
  if (input.dataset_requirements.length === 0) throw new Error("dataset_requirements cannot be empty")
  const datasetRequirements = input.dataset_requirements.map((item) => item.trim()).sort()
  if (datasetRequirements.some((item) => !item) || new Set(datasetRequirements).size !== datasetRequirements.length) {
    throw new Error("dataset_requirements must be unique non-empty data surface slugs")
  }
  for (const requirement of datasetRequirements) {
    const surface = input.control_plane_context.data_surfaces.find((item) => item.slug === requirement)
    if (!surface) throw new Error(`dataset requirement is absent from Control Plane context: ${requirement}`)
    if (surface.coverage_status !== "ready") {
      throw new Error(`dataset requirement is not ready for an Experiment Proposal: ${requirement}`)
    }
    const canonicalRequirement = selectedCanonical.data_surface_requirements
      .find((item) => item.surface_id === surface.surface_id)
    if (!canonicalRequirement) {
      throw new Error(`dataset requirement is not linked to the selected canonical: ${requirement}`)
    }
    if (canonicalRequirement.coverage_status !== "ready") {
      throw new Error(`canonical dataset requirement is not ready for an Experiment Proposal: ${requirement}`)
    }
  }
  if (Object.keys(input.candidate_space).length === 0) throw new Error("candidate_space cannot be empty")
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.created_at)
      || Number.isNaN(Date.parse(input.created_at))) {
    throw new Error("created_at must be an RFC 3339 UTC timestamp")
  }
  return createPlannerProposalSubmission({
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2 as const,
    proposal_id: input.proposal_id.trim(),
    hypothesis_id: input.hypothesis_id.trim(),
    universe_node_id: input.universe_node_id.trim(),
    objective: input.objective.trim(),
    dataset_requirements: datasetRequirements,
    candidate_space: input.candidate_space,
    trial_budget: input.trial_budget,
    evaluation_protocol_ref: input.evaluation_protocol_ref.trim(),
    control_plane_context_hash: input.control_plane_context.context_hash,
    created_at: input.created_at,
  })
}
