import {
  REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionHarnessRegistryCapability,
  assertReplayDecisionHarnessSourceBundle,
  canonicalJson,
  createReplayDecisionHarnessReceipt,
  type ReplayDecisionHarnessCapability,
  type ReplayDecisionHarnessReceipt,
  type ReplayDecisionHarnessRegistryCapability,
  type ReplayDecisionHarnessSourceBundle,
  type ReplayDecisionInputSnapshot,
  type ReplayExecutionRequest,
  type ReplaySupplementalValue,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayRegisteredDecisionHarness {
  source_bundle: ReplayDecisionHarnessSourceBundle
  execute(input: {
    request: ReplayExecutionRequest
    decision_input_snapshot: ReplayDecisionInputSnapshot
  }): {
    derived_order: ReplayExecutionRequest["order"]
    trace: ReplaySupplementalValue
  }
}

export interface ReplayDecisionHarnessRegistry {
  capability: ReplayDecisionHarnessRegistryCapability
  resolve(bundleHash: string): ReplayRegisteredDecisionHarness | undefined
}

export interface ReplayDecisionHarnessAdmission {
  source_bundle: ReplayDecisionHarnessSourceBundle | null
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
    if (entries.has(registration.source_bundle.bundle_hash)) {
      throw new ReplayDecisionHarnessError("Replay decision harness registry contains a duplicate bundle hash")
    }
    entries.set(registration.source_bundle.bundle_hash, {
      source_bundle: structuredClone(registration.source_bundle),
      execute: registration.execute,
    })
  }
  return {
    capability: structuredClone(REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY),
    resolve: (bundleHash) => {
      const registration = entries.get(bundleHash)
      return registration && {
        source_bundle: structuredClone(registration.source_bundle),
        execute: registration.execute,
      }
    },
  }
}

export function executeReplayDecisionHarness(input: {
  registry: ReplayDecisionHarnessRegistry | undefined
  request: ReplayExecutionRequest
  decision_input_snapshot: ReplayDecisionInputSnapshot
}): ReplayDecisionHarnessAdmission {
  if (input.request.supplemental_requirement_set.mode === "none") {
    return { source_bundle: null, receipt: null }
  }
  if (!input.registry) throw new ReplayDecisionHarnessError("Replay supplemental lane requires a decision harness registry")
  try {
    assertReplayDecisionHarnessRegistryCapability(input.registry.capability)
    const registration = input.registry.resolve(input.request.harness_hash)
    if (!registration) throw new Error("decision harness bundle hash is not registered")
    assertReplayDecisionHarnessSourceBundle(registration.source_bundle, input.request)
    const capability: ReplayDecisionHarnessCapability = {
      schema_version: REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
      harness_hash: registration.source_bundle.bundle_hash,
      source_bundle_ref: registration.source_bundle.bundle_ref,
      source_bundle_hash: registration.source_bundle.bundle_hash,
      registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
      loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
      execution_policy: "registered_entrypoint_deterministic",
      input_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
      output_schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
    }
    const output = registration.execute({
      request: structuredClone(input.request),
      decision_input_snapshot: structuredClone(input.decision_input_snapshot),
    })
    if (!output || canonicalJson(output.derived_order) !== canonicalJson(input.request.order)) {
      throw new Error("decision harness derived Order does not match the authorized Replay request")
    }
    return {
      source_bundle: structuredClone(registration.source_bundle),
      receipt: createReplayDecisionHarnessReceipt({
        request: input.request,
        decision_input_snapshot: input.decision_input_snapshot,
        source_bundle: registration.source_bundle,
        capability,
        derived_order: output.derived_order,
        trace: output.trace,
      }),
    }
  } catch (error) {
    throw new ReplayDecisionHarnessError(error instanceof Error ? error.message : String(error))
  }
}
