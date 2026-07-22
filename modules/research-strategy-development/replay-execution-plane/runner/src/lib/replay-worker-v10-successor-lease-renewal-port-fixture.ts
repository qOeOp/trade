import { expect } from "bun:test"
import {
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION,
  createReplaySuccessorVerificationLeaseRenewalReceipt,
  hashReplayAttemptLeaseSnapshot,
  replaySuccessorVerificationLeaseRenewalReceiptIdentityHash,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerRequestV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type { ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-schedule-admission"
import type { ReplayDecisionHarnessWorkerV10ReproducibilityPairContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"
import type { ReplaySuccessorVerificationLeaseRenewalAuthorityPort } from "./replay-worker-v10-successor-lease-admission-registry"

export function createReplayWorkerV10SuccessorLeaseRenewalPortFixture(input: {
  successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  reproducibility_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  schedule_admission: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  worker_request: ReplayDecisionHarnessWorkerRequestV10
  replay_execution_request_hash: string
  predecessor_attempt_lease: ReplayAttemptLeaseSnapshot
  on_call(): void
}): ReplaySuccessorVerificationLeaseRenewalAuthorityPort {
  return {
    renew: (request) => {
      input.on_call()
      expect(request.source_successor_authority_contract_hash)
        .toBe(input.successor_authority_contract.contract_hash)
      expect(request.source_reproducibility_pair_contract_hash)
        .toBe(input.reproducibility_pair_contract.contract_hash)
      expect(request.source_first_schedule_admission_hash)
        .toBe(input.schedule_admission.admission_hash)
      expect(request.source_first_execution_envelope_hash)
        .toBe(input.execution_envelope.envelope_hash)
      expect(request.logical_request_id).toBe(input.worker_request.logical_request_id)
      expect(request.worker_request_hash).toBe(input.worker_request.request_hash)
      expect(request.replay_execution_request_hash).toBe(input.replay_execution_request_hash)
      expect(request.expected_current_attempt_lease_hash)
        .toBe(hashReplayAttemptLeaseSnapshot(input.predecessor_attempt_lease))
      expect(request.expected_current_lease_generation)
        .toBe(input.predecessor_attempt_lease.lease_generation)
      expect(request.minimum_successor_lease_generation)
        .toBe(input.predecessor_attempt_lease.lease_generation + 1)

      const renewedAt = "2026-07-14T00:04:00Z"
      const successorAttemptLease: ReplayAttemptLeaseSnapshot = {
        ...structuredClone(input.predecessor_attempt_lease),
        status: "running",
        lease_generation: input.predecessor_attempt_lease.lease_generation + 1,
        heartbeat_at: renewedAt,
        lease_expires_at: request.requested_lease_expires_at,
      }
      const predecessorHash = hashReplayAttemptLeaseSnapshot(input.predecessor_attempt_lease)
      const successorHash = hashReplayAttemptLeaseSnapshot(successorAttemptLease)
      const identity = replaySuccessorVerificationLeaseRenewalReceiptIdentityHash({
        source_request_hash: request.request_hash,
        predecessor_attempt_lease_hash: predecessorHash,
        successor_attempt_lease_hash: successorHash,
        receipt_policy_version:
          REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
      })
      return createReplaySuccessorVerificationLeaseRenewalReceipt({
        schema_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION,
        receipt_id: `replay-successor-verification-lease-renewal-receipt-${identity.slice(0, 24)}`,
        receipt_ref:
          `receipt://replay-successor-verification-lease-renewal/${identity.slice(0, 24)}`,
        receipt_policy_version:
          REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
        status: "successor_verification_lease_renewed",
        authority_owner: "research_control_plane",
        authority_source: "research_control_plane_state_store",
        registry_table: "rd_replay_successor_verification_lease_renewal",
        registry_row_immutability: "sqlite_update_and_delete_triggers",
        source_request_id: request.request_id,
        source_request_ref: request.request_ref,
        source_request_hash: request.request_hash,
        source_request: structuredClone(request),
        source_evidence_validation: "opaque_hash_binding_only_replay_lineage_not_revalidated",
        renewal_transaction:
          "single_control_plane_transaction_exact_predecessor_fencing_update_and_receipt_insert",
        clock_source: "control_plane_authority_process_clock_port",
        clock_independence: "authority_internal_sampling_without_caller_heartbeat_time",
        caller_heartbeat_time_input: "forbidden",
        external_time_attestation: "not_provided",
        renewed_at: renewedAt,
        predecessor_attempt_lease_hash: predecessorHash,
        predecessor_attempt_lease: structuredClone(input.predecessor_attempt_lease),
        successor_attempt_lease_hash: successorHash,
        successor_attempt_lease: successorAttemptLease,
        generation_relation: "successor_equals_predecessor_plus_one",
        immutable_attempt_binding:
          "attempt_ordinal_worker_trial_run_reservation_request_and_claimed_at_exactly_equal",
        requested_expiry_relation:
          "successor_expiry_equals_control_plane_admitted_request_expiry",
        successor_authority: "lease_generation_only_fresh_execution_lineage_still_required",
        process_authority: "none",
        harness_authority: "none",
        decision_output_authority: "none",
        signal_authority: "none",
        order_authority: "none",
        economic_authority: "none",
        trial_authority: "none",
      })
    },
  }
}
