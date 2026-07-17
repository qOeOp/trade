import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "./replay-decision-harness-dispatch-claim"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "./replay-decision-harness-worker-v10-execution-admission-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_BUNDLE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-execution-admission-pre-issue-evidence-v1" as const

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlocker =
  | "control_plane_registry_read_provenance_not_materialized"
  | "independent_dispatch_clock_attestation_not_materialized"
  | "execution_admission_command_instance_not_issued"
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_BUNDLE_SCHEMA_VERSION
  bundle_id: string
  bundle_hash: string
  bundle_key: string
  pre_issue_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION
  scope: "attempt_bound_execution_admission_pre_issue_evidence_only"
  owner: "replay_runner_worker_v10_execution_admission_pre_issue_registry"
  purpose: "bind_exact_dispatch_claim_and_post_claim_lease_observation_without_issuing_command"
  status: "claim_and_lease_evidence_bound_command_issue_blocked"
  source_execution_admission_contract_id: string
  source_execution_admission_contract_hash: string
  source_execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  source_dispatch_claim_id: string
  source_dispatch_claim_hash: string
  source_dispatch_claim: ReplayDecisionHarnessDispatchClaim
  source_current_lease_observation_id: string
  source_current_lease_observation_ref: string
  source_current_lease_observation_hash: string
  source_current_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  successor_process_artifact_hash: string
  transport_contract_hash: string
  durable_claim_binding: "exact_local_cas_dispatch_claim_bound"
  claim_authority_limit: "cas_exclusivity_only_not_process_or_transport_authority"
  lease_observation_policy: "strictly_after_claim_same_exact_lease_generation_and_before_expiry"
  lease_revalidation_status: "fresh_under_control_plane_receipt_with_caller_supplied_clock_only"
  control_plane_registry_read_provenance: "not_materialized_observation_wire_only"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  predecessor_blocker_closure:
    "dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock"
  execution_admission_command: null
  execution_admission_command_instance_count: 0
  command_issue_status: "blocked"
  blocker_set_policy: "complete_deterministic_ordered_post_bundle_pre_issue_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlocker[]
  attempt_bound_process_launch_intent: null
  attempt_bound_process_receipt: null
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleBody = Omit<
  ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  "bundle_hash"
>

export function replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlockers():
ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlocker[] {
  return [
    "control_plane_registry_read_provenance_not_materialized",
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey(input: {
  execution_admission_contract_hash: string
  dispatch_claim_hash: string
  current_lease_observation_hash: string
  pre_issue_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION
}): string {
  for (const hash of [input.execution_admission_contract_hash, input.dispatch_claim_hash,
    input.current_lease_observation_hash]) {
    requireHash(hash, "decision harness Worker v10 Execution Admission pre-issue key")
  }
  if (input.pre_issue_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 Execution Admission pre-issue policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(
  body: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleBody,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  const value = { ...structuredClone(body), bundle_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_BUNDLE_SCHEMA_VERSION
      || value.pre_issue_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION
      || value.scope !== "attempt_bound_execution_admission_pre_issue_evidence_only"
      || value.owner !== "replay_runner_worker_v10_execution_admission_pre_issue_registry"
      || value.purpose !== "bind_exact_dispatch_claim_and_post_claim_lease_observation_without_issuing_command"
      || value.status !== "claim_and_lease_evidence_bound_command_issue_blocked"
      || value.durable_claim_binding !== "exact_local_cas_dispatch_claim_bound"
      || value.claim_authority_limit !== "cas_exclusivity_only_not_process_or_transport_authority"
      || value.lease_observation_policy
        !== "strictly_after_claim_same_exact_lease_generation_and_before_expiry"
      || value.lease_revalidation_status
        !== "fresh_under_control_plane_receipt_with_caller_supplied_clock_only"
      || value.control_plane_registry_read_provenance !== "not_materialized_observation_wire_only"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.predecessor_blocker_closure
        !== "dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock"
      || value.execution_admission_command !== null
      || value.execution_admission_command_instance_count !== 0 || value.command_issue_status !== "blocked"
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_bundle_pre_issue_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlockers())
      || value.attempt_bound_process_launch_intent !== null || value.attempt_bound_process_receipt !== null
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 Execution Admission pre-issue authority")
  }
  for (const item of [value.bundle_id, value.source_execution_admission_contract_id,
    value.source_dispatch_claim_id, value.source_current_lease_observation_id,
    value.source_current_lease_observation_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "decision harness Worker v10 Execution Admission pre-issue identity")
  }
  for (const item of [value.bundle_hash, value.bundle_key, value.source_execution_admission_contract_hash,
    value.source_dispatch_claim_hash, value.source_current_lease_observation_hash,
    value.target_logical_request_id, value.target_worker_request_hash, value.current_attempt_lease_hash,
    value.successor_process_artifact_hash, value.transport_contract_hash]) {
    requireHash(item, "decision harness Worker v10 Execution Admission pre-issue hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue Attempt binding is invalid")
  }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(value.source_execution_admission_contract)
  assertReplayDecisionHarnessDispatchClaim(value.source_dispatch_claim)
  assertReplayAttemptLeaseObservationEnvelopeView(value.source_current_lease_observation)
  const contract = value.source_execution_admission_contract
  const successor = contract.source_successor_transport_contract
  const sourceEnvelope = successor.source_negative_probe_receipt.source_stdio_capability
    .source_transport_contract.source_execution_envelope
  const claim = value.source_dispatch_claim
  const claimEnvelope = claim.source_registration.source_authority_binding
    .source_dispatch_lease_admission.source_execution_envelope
  const observation = value.source_current_lease_observation
  const expectedKey = replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey({
    execution_admission_contract_hash: contract.contract_hash,
    dispatch_claim_hash: claim.claim_hash,
    current_lease_observation_hash: observation.observation_hash,
    pre_issue_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
  })
  if (value.bundle_key !== expectedKey
      || value.source_execution_admission_contract_id !== contract.contract_id
      || value.source_execution_admission_contract_hash !== contract.contract_hash
      || value.source_dispatch_claim_id !== claim.claim_id || value.source_dispatch_claim_hash !== claim.claim_hash
      || value.source_current_lease_observation_id !== observation.observation_id
      || value.source_current_lease_observation_ref !== observation.observation_ref
      || value.source_current_lease_observation_hash !== observation.observation_hash
      || value.target_logical_request_id !== contract.target_logical_request_id
      || value.target_logical_request_id !== claim.logical_request_id
      || value.target_logical_request_id !== sourceEnvelope.logical_request_id
      || value.target_logical_request_id !== claimEnvelope.logical_request_id
      || value.target_worker_request_hash !== contract.target_worker_request_hash
      || value.target_worker_request_hash !== sourceEnvelope.worker_request_hash
      || value.target_worker_request_hash !== claimEnvelope.worker_request_hash
      || value.attempt_id !== claim.attempt_id || value.attempt_id !== observation.attempt_id
      || value.attempt_id !== sourceEnvelope.attempt_id || value.attempt_id !== claimEnvelope.attempt_id
      || value.attempt_ordinal !== claim.attempt_ordinal || value.attempt_ordinal !== observation.attempt_ordinal
      || value.attempt_ordinal !== sourceEnvelope.attempt_ordinal
      || value.worker_id !== claim.worker_id || value.worker_id !== observation.worker_id
      || value.worker_id !== sourceEnvelope.worker_id || value.worker_id !== claimEnvelope.worker_id
      || value.lease_generation !== claim.lease_generation
      || value.lease_generation !== observation.lease_generation
      || value.lease_generation !== sourceEnvelope.lease_generation
      || value.current_attempt_lease_hash !== observation.attempt_lease_hash
      || value.current_attempt_lease_hash !== claim.revalidation_observation.attempt_lease_hash
      || value.successor_process_artifact_hash !== successor.successor_process_artifact_hash
      || value.transport_contract_hash !== successor.contract_hash) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue parent binding drift")
  }
  const observedAt = Date.parse(observation.observed_at)
  if (observedAt <= Date.parse(claim.claimed_at)
      || observedAt >= Date.parse(observation.attempt_lease.lease_expires_at)) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue observation is not post-claim fresh")
  }
  const { bundle_hash: bundleHash, ...body } = value
  if (value.bundle_id !== `decision-harness-worker-v10-execution-pre-issue-${value.bundle_key.slice(0, 24)}`
      || bundleHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue identity or hash mismatch")
  }
}

const FIELDS = ["attempt_bound_process_launch_intent", "attempt_bound_process_receipt", "attempt_id",
  "attempt_ordinal", "blocker_set_policy", "blockers", "bundle_hash", "bundle_id", "bundle_key",
  "claim_authority_limit", "clock_evidence", "command_issue_status", "control_plane_registry_read_provenance",
  "current_attempt_lease_hash", "decision_output_authority", "dispatch_occurrence", "durable_claim_binding",
  "economic_authority", "execution_admission_command", "execution_admission_command_instance_count",
  "harness_invocation", "lease_generation", "lease_observation_policy", "lease_revalidation_status",
  "order_authority", "owner", "pre_issue_policy_version", "predecessor_blocker_closure", "purpose",
  "request_decode_receipt_count", "request_frame_instance_count", "request_write_receipt_count",
  "response_admission", "response_frame_instance_count", "response_read_receipt_count", "schema_version", "scope",
  "signal_authority", "source_current_lease_observation", "source_current_lease_observation_hash",
  "source_current_lease_observation_id", "source_current_lease_observation_ref", "source_dispatch_claim",
  "source_dispatch_claim_hash", "source_dispatch_claim_id", "source_execution_admission_contract",
  "source_execution_admission_contract_hash", "source_execution_admission_contract_id", "status",
  "successor_process_artifact_hash", "target_logical_request_id", "target_worker_request_hash",
  "transport_activation", "transport_contract_hash", "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue field whitelist drift")
  }
}
