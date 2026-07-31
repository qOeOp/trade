import {
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  createReplayDecisionMarketInputSnapshot,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_POLICY_VERSION,
  REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_SCHEMA_VERSION,
  assertReplayDecisionMarketInputMaterialization,
  createReplayDecisionMarketInputMaterialization,
  createReplayDecisionMarketInputMaterializationEntry,
  type ReplayDecisionMarketInputMaterialization,
  type ReplayDecisionMarketInputMaterializationBody,
} from "../../../contracts/src/lib/replay-decision-market-input-materialization"
import {
  assertReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  type ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { selectReplayDecisionMarketInputBars } from "./replay-decision-market-input-selection"
import { buildReplayDecisionInputMaterializationCommonFields } from "./replay-decision-input-materialization-common-fields"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBindingLineage,
} from "./replay-source-event-decision-observation-harness-context-binding"

export interface ReplayDecisionMarketInputMaterializationInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bundle: ReplaySourceEventDecisionObservationBundle
  derivation_admission: ReplayDecisionObservationBundleDerivationAdmissionSnapshot
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
}

export function buildReplayDecisionMarketInputMaterialization(
  input: ReplayDecisionMarketInputMaterializationInput,
): ReplayDecisionMarketInputMaterialization {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionMarketInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `decision-market-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionMarketInputMaterializationLineage(value, input)
  return value
}

export function assertReplayDecisionMarketInputMaterializationLineage(
  value: ReplayDecisionMarketInputMaterialization,
  input: ReplayDecisionMarketInputMaterializationInput,
): void {
  assertReplayDecisionMarketInputMaterialization(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionMarketInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `decision-market-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision Market input materialization parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionMarketInputMaterializationInput,
): Omit<ReplayDecisionMarketInputMaterializationBody, "materialization_id"> {
  const entries = input.harness_context_binding.entries.map((contextEntry, index) => {
    const projection = input.bundle.projections[index]!
    const bars = selectReplayDecisionMarketInputBars(input.request, projection.observations)
    const snapshot = createReplayDecisionMarketInputSnapshot({
      request: input.request,
      decision_time: contextEntry.decision_time,
      interval_ms: input.dataset_manifest.interval_ms,
      bars,
    })
    return createReplayDecisionMarketInputMaterializationEntry({
      schema_version: REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: contextEntry.decision_time,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      observation_projection_id: projection.projection_id,
      observation_projection_hash: projection.projection_hash,
      market_input_status: input.request.decision_market_input_requirement.mode === "none"
        ? "materialized_empty_no_requirement" : "materialized_closed_bar_lookback",
      decision_market_input_snapshot: snapshot,
      decision_market_input_snapshot_hash: snapshot.snapshot_hash,
      worker_request_compatibility: "not_bound",
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  return {
    schema_version: REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_SCHEMA_VERSION,
    materialization_policy_version: REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_POLICY_VERSION,
    scope: "pre_worker_non_economic_market_input_materialization",
    purpose: "materialize_formal_market_snapshots_from_admitted_closed_bar_observations",
    authority_source: "decision_observation_harness_context_binding",
    parent_context_binding_validation: "full_rebuild_against_request_bundle_and_derivation_admission",
    dataset_manifest_validation: "schema_and_request_market_identity_only",
    supplemental_binding_validation: "not_inspected_outside_market_responsibility",
    ...buildReplayDecisionInputMaterializationCommonFields(input),
    decision_market_input_requirement_hash: input.request.decision_market_input_requirement_hash,
    decision_market_input_snapshot_schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    snapshot_hashes_hash: canonicalHash(entries.map((entry) => entry.decision_market_input_snapshot_hash)),
    first_decision_time: entries[0]!.decision_time,
    last_decision_time: entries.at(-1)!.decision_time,
  }
}

function assertInputAuthority(input: ReplayDecisionMarketInputMaterializationInput): void {
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
  if (input.dataset_manifest.manifest_ref !== input.request.dataset_manifest_ref
      || input.dataset_manifest.data_hash !== input.request.dataset_hash
      || input.dataset_manifest.symbol !== input.request.symbol
      || input.dataset_manifest.timeframe !== input.request.timeframe) {
    throw new Error("decision Market input materialization Dataset Manifest does not match Request market identity")
  }
  if (input.bundle.projection_count !== input.harness_context_binding.entry_count) {
    throw new Error("decision Market input materialization boundary count drift")
  }
  for (const [index, contextEntry] of input.harness_context_binding.entries.entries()) {
    const projection = input.bundle.projections[index]
    if (!projection || projection.projection_id !== contextEntry.observation_projection_id
        || projection.projection_hash !== contextEntry.observation_projection_hash
        || projection.as_of_time !== contextEntry.decision_time) {
      throw new Error("decision Market input materialization projection/context drift")
    }
  }
}
