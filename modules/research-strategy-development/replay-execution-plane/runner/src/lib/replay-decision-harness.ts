import {
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessRegistryCapability,
  assertReplayDecisionHarnessSourceBundle,
  canonicalJson,
  createReplayDecisionHarnessReceipt,
  replayDecisionOutputFor,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessCapability,
  type ReplayDecisionHarnessReceipt,
  type ReplayDecisionHarnessRegistryCapability,
  type ReplayDecisionHarnessSourceBundle,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
  type ReplayDecisionScheduleEntry,
  type ReplayDecisionStateSnapshot,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import { buildReplayDecisionHarness, executeReplayDecisionHarnessWorker } from "./replay-decision-harness-build"

export interface ReplayRegisteredDecisionHarness {
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
}

export interface ReplayDecisionHarnessRegistry {
  capability: ReplayDecisionHarnessRegistryCapability
  resolve(bundleHash: string): ReplayRegisteredDecisionHarness | undefined
}

export interface ReplayDecisionHarnessAdmission {
  source_bundle: ReplayDecisionHarnessSourceBundle | null
  build_attestation: ReplayDecisionHarnessBuildAttestation | null
  receipt: ReplayDecisionHarnessReceipt | null
}

export class ReplayDecisionHarnessError extends Error {
  readonly code = "decision-harness-rejected" as const

  constructor(message: string) {
    super(message)
    this.name = "ReplayDecisionHarnessError"
  }
}

export function createReplayDecisionHarnessRegistry(
  registrations: ReplayRegisteredDecisionHarness[],
): ReplayDecisionHarnessRegistry {
  const entries = new Map<string, ReplayRegisteredDecisionHarness>()
  for (const registration of registrations) {
    assertReplayDecisionHarnessSourceBundle(registration.source_bundle)
    assertReplayDecisionHarnessBuildAttestation(registration.build_attestation, registration.source_bundle)
    const rebuiltAttestation = buildReplayDecisionHarness(registration.source_bundle)
    if (canonicalJson(rebuiltAttestation) !== canonicalJson(registration.build_attestation)) {
      throw new ReplayDecisionHarnessError("Replay decision harness build attestation does not match deterministic rebuild")
    }
    if (entries.has(registration.source_bundle.bundle_hash)) {
      throw new ReplayDecisionHarnessError("Replay decision harness registry contains a duplicate bundle hash")
    }
    entries.set(registration.source_bundle.bundle_hash, structuredClone(registration))
  }
  return {
    capability: structuredClone(REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY),
    resolve: (bundleHash) => {
      const registration = entries.get(bundleHash)
      return registration && structuredClone(registration)
    },
  }
}

export function executeReplayDecisionHarness(input: {
  registry: ReplayDecisionHarnessRegistry | undefined
  request: ReplayExecutionRequest
  schedule_entry: ReplayDecisionScheduleEntry
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_state_snapshot?: ReplayDecisionStateSnapshot | null
}): ReplayDecisionHarnessAdmission {
  if (input.request.supplemental_requirement_set.mode === "none"
      && input.request.decision_market_input_requirement.mode === "none") {
    return { source_bundle: null, build_attestation: null, receipt: null }
  }
  if (!input.registry) throw new ReplayDecisionHarnessError("Replay supplemental lane requires a decision harness registry")
  try {
    assertReplayDecisionHarnessRegistryCapability(input.registry.capability)
    const registration = input.registry.resolve(input.request.harness_hash)
    if (!registration) throw new Error("decision harness bundle hash is not registered")
    assertReplayDecisionHarnessSourceBundle(registration.source_bundle, input.request)
    assertReplayDecisionHarnessBuildAttestation(registration.build_attestation, registration.source_bundle)
    const capability: ReplayDecisionHarnessCapability = {
      schema_version: REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
      harness_hash: registration.source_bundle.bundle_hash,
      source_bundle_ref: registration.source_bundle.bundle_ref,
      source_bundle_hash: registration.source_bundle.bundle_hash,
      build_attestation_hash: registration.build_attestation.attestation_hash,
      build_artifact_hash: registration.build_attestation.artifact.sha256,
      runtime_executable_hash: registration.build_attestation.runtime.executable_sha256,
      registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
      build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
      loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
      worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
      execution_policy: "fresh_subprocess_stdio_reproducibility_pair",
      context_schema_version: REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
      supplemental_input_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
      market_input_schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
      state_input_schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
      output_schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
    }
    const execution = executeReplayDecisionHarnessWorker({
      source_bundle: registration.source_bundle,
      build_attestation: registration.build_attestation,
      request: input.request,
      schedule_entry: input.schedule_entry,
      decision_input_snapshot: input.decision_input_snapshot,
      decision_market_input_snapshot: input.decision_market_input_snapshot,
      decision_state_snapshot: input.decision_state_snapshot ?? null,
    })
    const verificationExecution = executeReplayDecisionHarnessWorker({
      source_bundle: registration.source_bundle,
      build_attestation: registration.build_attestation,
      request: input.request,
      schedule_entry: input.schedule_entry,
      decision_input_snapshot: input.decision_input_snapshot,
      decision_market_input_snapshot: input.decision_market_input_snapshot,
      decision_state_snapshot: input.decision_state_snapshot ?? null,
    })
    if (canonicalJson(execution.worker_request) !== canonicalJson(verificationExecution.worker_request)
        || canonicalJson(execution.worker_response) !== canonicalJson(verificationExecution.worker_response)) {
      throw new Error("decision harness worker reproducibility parity failed")
    }
    const expectedOutput = replayDecisionOutputFor(input.request, input.schedule_entry)
    if (canonicalJson(execution.worker_response.decision_output) !== canonicalJson(expectedOutput)) {
      throw new Error("decision harness output does not match the frozen decision schedule")
    }
    return {
      source_bundle: structuredClone(registration.source_bundle),
      build_attestation: structuredClone(registration.build_attestation),
      receipt: createReplayDecisionHarnessReceipt({
        request: input.request,
        decision_input_snapshot: input.decision_input_snapshot,
        decision_market_input_snapshot: input.decision_market_input_snapshot,
        decision_state_snapshot: input.decision_state_snapshot ?? null,
        source_bundle: registration.source_bundle,
        build_attestation: registration.build_attestation,
        capability,
        worker_request: execution.worker_request,
        worker_response: execution.worker_response,
        worker_verification_response: verificationExecution.worker_response,
        decision_output: execution.worker_response.decision_output,
        trace: execution.worker_response.trace,
      }),
    }
  } catch (error) {
    throw new ReplayDecisionHarnessError(error instanceof Error ? error.message : String(error))
  }
}
