import {
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  createReplayDecisionInputSnapshot,
  createReplayDecisionMarketInputSnapshot,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_SCHEMA_VERSION,
  assertReplaySourceEventDecisionObservationInputMaterialization,
  createReplaySourceEventDecisionObservationInputMaterialization,
  createReplaySourceEventDecisionObservationInputMaterializationEntry,
  type ReplaySourceEventDecisionObservationInputMaterialization,
  type ReplaySourceEventDecisionObservationInputMaterializationBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-input-materialization"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  type ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBindingLineage,
} from "./replay-source-event-decision-observation-harness-context-binding"

export interface ReplaySourceEventDecisionObservationInputMaterializationInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bundle: ReplaySourceEventDecisionObservationBundle
  derivation_admission: ReplayDecisionObservationBundleDerivationAdmissionSnapshot
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
}

export function buildReplaySourceEventDecisionObservationInputMaterialization(
  input: ReplaySourceEventDecisionObservationInputMaterializationInput,
): ReplaySourceEventDecisionObservationInputMaterialization {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplaySourceEventDecisionObservationInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `source-event-decision-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplaySourceEventDecisionObservationInputMaterializationLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionObservationInputMaterializationLineage(
  value: ReplaySourceEventDecisionObservationInputMaterialization,
  input: ReplaySourceEventDecisionObservationInputMaterializationInput,
): void {
  assertReplaySourceEventDecisionObservationInputMaterialization(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplaySourceEventDecisionObservationInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `source-event-decision-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision observation input materialization parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplaySourceEventDecisionObservationInputMaterializationInput,
): Omit<ReplaySourceEventDecisionObservationInputMaterializationBody, "materialization_id"> {
  const entries = input.harness_context_binding.entries.map((contextEntry, index) => {
    const projection = input.bundle.projections[index]!
    const decisionInputSnapshot = createReplayDecisionInputSnapshot(
      input.request,
      [],
      contextEntry.decision_time,
    )
    const bars = selectMarketInputBars(input.request, projection.observations)
    const marketInputSnapshot = createReplayDecisionMarketInputSnapshot({
      request: input.request,
      decision_time: contextEntry.decision_time,
      interval_ms: input.dataset_manifest.interval_ms,
      bars,
    })
    return createReplaySourceEventDecisionObservationInputMaterializationEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: contextEntry.decision_time,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      observation_projection_id: projection.projection_id,
      observation_projection_hash: projection.projection_hash,
      supplemental_input_status: "materialized_empty_no_requirements",
      decision_input_snapshot: decisionInputSnapshot,
      decision_input_snapshot_hash: decisionInputSnapshot.snapshot_hash,
      market_input_status: input.request.decision_market_input_requirement.mode === "none"
        ? "materialized_empty_no_requirement"
        : "materialized_closed_bar_lookback",
      decision_market_input_snapshot: marketInputSnapshot,
      decision_market_input_snapshot_hash: marketInputSnapshot.snapshot_hash,
      state_input_status: contextEntry.harness_context.decision_phase === "position_open"
        ? "runtime_state_required_not_materialized"
        : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      worker_request_compatibility: "not_bound",
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  return {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_SCHEMA_VERSION,
    materialization_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_POLICY_VERSION,
    scope: "pre_worker_non_economic_decision_input_materialization",
    materialization_purpose: "materialize_formal_supplemental_and_market_snapshots_from_admitted_observations",
    authority_source: "decision_observation_harness_context_binding",
    parent_context_binding_validation: "full_rebuild_against_request_bundle_and_derivation_admission",
    dataset_manifest_validation: "schema_and_request_identity_only",
    observation_source_validation: "admitted_bundle_projection_and_context_binding_lineage",
    raw_dataset_revalidation: "not_performed",
    supplemental_input_materialization: "certified_empty_requirement_set_only",
    market_input_materialization: "certified_from_admitted_closed_bar_observations",
    state_input_materialization: "not_materialized_runtime_state_required",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    runner_compatibility: "not_bound",
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
    supplemental_requirement_set_hash: input.request.supplemental_requirement_set_hash,
    decision_market_input_requirement_hash: input.request.decision_market_input_requirement_hash,
    decision_input_snapshot_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    decision_market_input_snapshot_schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
    decision_state_snapshot_schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((item) => item.entry_hash)),
    decision_input_snapshot_hashes_hash:
      canonicalHash(entries.map((item) => item.decision_input_snapshot_hash)),
    decision_market_input_snapshot_hashes_hash:
      canonicalHash(entries.map((item) => item.decision_market_input_snapshot_hash)),
    materialized_state_snapshot_count: 0,
    runtime_state_required_count:
      entries.filter((item) => item.state_input_status === "runtime_state_required_not_materialized").length,
    first_decision_time: entries[0]!.decision_time,
    last_decision_time: entries.at(-1)!.decision_time,
  }
}

function selectMarketInputBars(
  request: ReplayExecutionRequest,
  observations: ReplaySourceEventDecisionObservationBundle["projections"][number]["observations"],
): ReplayMarketBar[] {
  const requirement = request.decision_market_input_requirement
  if (requirement.mode === "none") return []
  return observations
    .filter((item) => item.observation_type === "closed_bar")
    .map((item) => structuredClone(item.observation) as ReplayMarketBar)
    .slice(-requirement.lookback_bars)
}

function assertInputAuthority(input: ReplaySourceEventDecisionObservationInputMaterializationInput): void {
  assertReplayExecutionRequest(input.request)
  assertReplayDatasetManifest(input.dataset_manifest)
  assertReplaySourceEventDecisionObservationBundle(input.bundle)
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot(input.derivation_admission)
  assertReplaySourceEventDecisionObservationHarnessContextBinding(input.harness_context_binding)
  assertReplaySourceEventDecisionObservationHarnessContextBindingLineage(input.harness_context_binding, {
    request: input.request,
    bundle: input.bundle,
    derivation_admission: input.derivation_admission,
  })
  if (input.request.supplemental_requirement_set.mode !== "none"
      || input.dataset_manifest.supplemental_facts.coverage !== "none"
      || input.dataset_manifest.supplemental_facts.record_count !== 0
      || input.dataset_manifest.supplemental_facts.content_hash !== canonicalHash([])
      || input.request.supplemental_facts_hash !== canonicalHash([])) {
    throw new Error("decision observation input materialization only certifies empty supplemental requirements")
  }
  if (input.dataset_manifest.manifest_ref !== input.request.dataset_manifest_ref
      || input.dataset_manifest.data_hash !== input.request.dataset_hash
      || input.dataset_manifest.symbol !== input.request.symbol
      || input.dataset_manifest.timeframe !== input.request.timeframe
      || input.dataset_manifest.supplemental_facts.requirement_set_hash
        !== input.request.supplemental_requirement_set_hash) {
    throw new Error("decision observation input materialization Dataset Manifest does not match Request")
  }
  if (input.bundle.projection_count !== input.harness_context_binding.entry_count) {
    throw new Error("decision observation input materialization boundary count drift")
  }
  for (const [index, contextEntry] of input.harness_context_binding.entries.entries()) {
    const projection = input.bundle.projections[index]
    if (!projection
        || projection.projection_id !== contextEntry.observation_projection_id
        || projection.projection_hash !== contextEntry.observation_projection_hash
        || projection.as_of_time !== contextEntry.decision_time) {
      throw new Error("decision observation input materialization projection/context drift")
    }
  }
}
