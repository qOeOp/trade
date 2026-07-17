import {
  canonicalHash,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import type {
  ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import type {
  ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"

export interface ReplayDecisionInputMaterializationCommonFieldInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bundle: ReplaySourceEventDecisionObservationBundle
  derivation_admission: ReplayDecisionObservationBundleDerivationAdmissionSnapshot
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
}

export function buildReplayDecisionInputMaterializationCommonFields(
  input: ReplayDecisionInputMaterializationCommonFieldInput,
) {
  return {
    raw_dataset_revalidation: "not_performed" as const,
    worker_request_materialization: "forbidden" as const,
    harness_invocation: "forbidden" as const,
    decision_output_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    request_schema_version: input.request.schema_version,
    request_hash: canonicalHash(input.request),
    run_id: input.request.run_id,
    experiment_id: input.request.experiment_id,
    trial_group_id: input.request.trial_group_id,
    trial_id: input.request.trial_id,
    candidate_id: input.request.candidate_id,
    candidate_hash: input.request.candidate_hash,
    reservation_ref: input.request.trial_reservation_ref,
    reservation_hash: input.request.trial_reservation_hash,
    dataset_manifest_ref: input.dataset_manifest.manifest_ref,
    dataset_hash: input.dataset_manifest.data_hash,
    dataset_manifest_hash: replayDatasetManifestHash(input.dataset_manifest),
    derivation_admission_id: input.derivation_admission.admission_id,
    derivation_admission_hash: input.derivation_admission.admission_hash,
    bundle_id: input.bundle.bundle_id,
    bundle_hash: input.bundle.bundle_hash,
    harness_context_binding_id: input.harness_context_binding.binding_id,
    harness_context_binding_hash: input.harness_context_binding.binding_hash,
  }
}
