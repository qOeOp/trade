import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  createReplayAttemptLeaseObservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  createReplayDecisionHarnessSourceBundle,
  createReplayDecisionStateSnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayPositionOpenStateInputMaterializationLineage,
  buildReplayPositionOpenStateInputMaterialization,
} from "../../../engine/src/lib/replay-position-open-state-input-materialization"
import {
  buildReplayDecisionWorkerInputAssemblyV3,
} from "../../../engine/src/lib/replay-decision-worker-input-assembly-v3"
import { buildReplayDecisionHarness } from "./replay-decision-harness-build"
import { runReplayTrial } from "./replay-trial-runner"
import {
  createReplayDecisionHarnessCutoverRegistry,
  executeReplayDecisionHarness,
} from "./replay-decision-harness"
import {
  executeReplayWorkerV10Cutover,
  readReplayWorkerV10CutoverReceipt,
} from "./replay-worker-v10-cutover"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import {
  admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import {
  buildReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  expectFormalCutoverAdmission,
  expectWorkerV10Cutover,
} from "./replay-worker-v10-cutover-legacy-stage.assertions"
import { runReplayWorkerV10LegacyActivationStage } from "./replay-worker-v10-legacy-activation-stage"
import { runReplayWorkerV10SuccessorSpawnStage } from "./replay-worker-v10-successor-spawn-stage"
import { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import { runReplayWorkerV10SuccessorIntentStage } from "./replay-worker-v10-successor-intent-stage"
import { runReplayWorkerV10SuccessorCapsuleStage } from "./replay-worker-v10-successor-capsule-stage"
import { runReplayWorkerV10SuccessorIntegrityStage } from "./replay-worker-v10-successor-integrity-stage"
import { runReplayWorkerV10UpstreamIntegrityStage } from "./replay-worker-v10-upstream-integrity-stage"
import { runReplayWorkerV10SuccessorExecutionStage } from "./replay-worker-v10-successor-execution-stage"
import { runReplayWorkerV10SuccessorLeaseStage } from "./replay-worker-v10-successor-lease-stage"
import { runReplayWorkerV10AuthorityResponseStage } from "./replay-worker-v10-authority-response-stage"
import { runReplayWorkerV10AuthorityProcessStage } from "./replay-worker-v10-authority-process-stage"
import { runReplayWorkerV10AuthoritySpawnStage } from "./replay-worker-v10-authority-spawn-stage"
import { runReplayWorkerV10AuthorityAdmissionStage } from "./replay-worker-v10-authority-admission-stage"
import { runReplayWorkerV10AuthorityTransportStage } from "./replay-worker-v10-authority-transport-stage"
import { runReplayWorkerV10PredecessorLaunchStage } from "./replay-worker-v10-predecessor-launch-stage"
import { runReplayWorkerV10PredecessorAdmissionEvidenceStage } from "./replay-worker-v10-predecessor-admission-evidence-stage"
import { runReplayWorkerV10ExecutionClaimStage } from "./replay-worker-v10-execution-claim-stage"
import { runReplayWorkerV10TransportContractStage } from "./replay-worker-v10-transport-contract-stage"
import { runReplayWorkerV10StdioProbeStage } from "./replay-worker-v10-stdio-probe-stage"
import { runReplayWorkerV10SuccessorTransportStage } from "./replay-worker-v10-successor-transport-stage"
import { runReplayWorkerV10DispatchAuthorityBindingStage } from "./replay-worker-v10-dispatch-authority-binding-stage"
import { runReplayWorkerV10DispatchEvidenceStage } from "./replay-worker-v10-dispatch-evidence-stage"
import { runReplayWorkerV10ExecutionEnvelopeStage } from "./replay-worker-v10-execution-envelope-stage"
import { runReplayWorkerV10DispatchLeaseAdmissionStage } from "./replay-worker-v10-dispatch-lease-admission-stage"
import { runReplayWorkerV10RequestMaterializationStage } from "./replay-worker-v10-request-materialization-stage"
import { runReplayWorkerV10BuildCapabilityStage } from "./replay-worker-v10-build-capability-stage"
import { runReplayWorkerV10ResponseContractStage } from "./replay-worker-v10-response-contract-stage"
import { runReplayWorkerV10InvocationIdentityStage } from "./replay-worker-v10-invocation-identity-stage"
import { runReplayWorkerV10LogicalRequestIdentityStage } from "./replay-worker-v10-logical-request-identity-stage"
import { runReplayWorkerV10AssemblyStage } from "./replay-worker-v10-assembly-stage"
import { runReplayWorkerV10CodeAdmissionStage } from "./replay-worker-v10-code-admission-stage"
import {
  GOLDEN_REPLAY_BARS,
  GOLDEN_REPLAY_DATASET_HASH,
  HASH,
  goldenReplayDatasetManifest,
} from "./replay-worker-v10-market-fixture"
import {
  authorizeReplayTrialRequest,
  request,
} from "./replay-worker-v10-request-fixture"
import {
  contextBinding,
  workerInputAssemblyV2,
} from "./replay-worker-v10-input-fixture"
import {
  runReplayWorkerV10PositionOpenMaterializationStage,
} from "./replay-worker-v10-position-open-materialization-stage"


const replayProfileStartedAt = performance.now()

function replayProfile(stage: string): void {
  if (process.env.REPLAY_TEST_PROFILE !== "1") return
  const elapsed = ((performance.now() - replayProfileStartedAt) / 1_000).toFixed(2)
  process.stderr.write(`[replay-worker-v10-test] ${elapsed}s ${stage}\n`)
}

test("Replay binds runtime inputs and deterministic code evidence without Worker authority", async () => {
  replayProfile("start")
  const sourceBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{
      path: "strategy.ts",
      content_utf8: [
        "export function decide(input) {",
        "  if (input.request_context.decision_phase !== 'initial_entry') return { decision_output: { action: 'no_action' }, trace: null }",
        "  return { decision_output: { action: 'submit_initial_order', order: { side: 'long', quantity: 1, signal_time: '2026-07-14T04:00:00Z', earliest_executable_time: '2026-07-14T08:00:00Z', stop_price: 95, target_price: 110, entry_execution: { order_type: 'market' } } }, trace: null }",
        "}",
        "",
      ].join("\n"),
    }],
  })
  const buildAttestation = buildReplayDecisionHarness(sourceBundle)
  const requestValue = request(HASH, sourceBundle.bundle_hash, GOLDEN_REPLAY_DATASET_HASH)
  const trialReservation = authorizeReplayTrialRequest(requestValue)
  const binding = contextBinding(requestValue)
  const positionOpenMaterializationStage =
    runReplayWorkerV10PositionOpenMaterializationStage({
      request: requestValue,
      harness_context_binding: binding,
    })
  const sourceEvents = positionOpenMaterializationStage.source_events
  const snapshot = positionOpenMaterializationStage.decision_state_snapshot
  const input = positionOpenMaterializationStage.materialization_input
  const materialization = positionOpenMaterializationStage.materialization

  const sourceAssemblyV2 = workerInputAssemblyV2(requestValue, binding)
  const assemblyStage = runReplayWorkerV10AssemblyStage({
    source_assembly_v2: sourceAssemblyV2,
    state_input_materialization: materialization,
    harness_context_binding: binding,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  })
  const assemblyV3Input = assemblyStage.assembly_v3_input
  const assemblyV4 = assemblyStage.assembly_v4
  const codeAdmissionStage = runReplayWorkerV10CodeAdmissionStage({
    assembly_v4: assemblyV4,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
    forged_build_attestation: assemblyStage.forged_build_attestation,
    profile: replayProfile,
  })
  const codeAdmission = codeAdmissionStage.code_admission

  const invocationIdentityStage = runReplayWorkerV10InvocationIdentityStage({
    code_admission: codeAdmission,
    decision_state_snapshot: snapshot,
    replay_execution_request: requestValue,
    source_bundle: sourceBundle,
    legacy_artifact_hash: buildAttestation.artifact.sha256,
    source_assembly_v2: sourceAssemblyV2,
  })
  const invocationIdentities = invocationIdentityStage.invocation_identity_set

  const logicalRequestIdentityStage = runReplayWorkerV10LogicalRequestIdentityStage({
    invocation_identity_set: invocationIdentities,
  })
  const identityUpgrade = logicalRequestIdentityStage.identity_upgrade

  const requestMaterializationStage = runReplayWorkerV10RequestMaterializationStage({
    identity_upgrade: identityUpgrade,
    source_assembly_v2: sourceAssemblyV2,
    decision_state_snapshot: snapshot,
    profile: replayProfile,
  })
  const requestV10Materialization = requestMaterializationStage.request_materialization
  const firstRequestV10 = requestMaterializationStage.first_request
  const buildCapabilityStage = runReplayWorkerV10BuildCapabilityStage({
    code_admission: codeAdmission,
    legacy_artifact_hash: buildAttestation.artifact.sha256,
  })
  const workerV10BuildCapability = buildCapabilityStage.worker_v10_build_capability

  const decoderModuleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-decoder-module-"))
  try {
    const decoderModulePath = join(decoderModuleRoot, workerV10BuildCapability.artifact.file_name)
    writeFileSync(decoderModulePath, workerV10BuildCapability.artifact.content_utf8, "utf8")
    const decoderModule = await import(
      `${pathToFileURL(decoderModulePath).href}?artifact=${workerV10BuildCapability.artifact.sha256}`
    ) as Record<string, unknown>
    const decode = decoderModule[workerV10BuildCapability.decoder_export_name]
    if (typeof decode !== "function") throw new Error("expected Worker v10 decoder export")
    expect(decode(structuredClone(firstRequestV10))).toEqual(firstRequestV10)
    expect(() => decode({ ...firstRequestV10, frame_id: "not-designed" }))
      .toThrow("field whitelist drift")
    expect(() => decode(Object.assign(Object.create({ inherited: true }), firstRequestV10)))
      .toThrow("must be one plain object")
    expect(() => decode({ ...firstRequestV10, worker_protocol_version: "rd-replay-harness-worker-stdio-v9" }))
      .toThrow("protocol drift")
    expect(() => decode({ ...firstRequestV10, transport_status: "invoked" }))
      .toThrow("executable markers are forbidden")
  } finally {
    rmSync(decoderModuleRoot, { recursive: true, force: true })
  }

  const responseContractStage = runReplayWorkerV10ResponseContractStage({
    request_materialization: requestV10Materialization,
    first_request: firstRequestV10,
  })
  const responseV10Contract = responseContractStage.response_contract
  const responseV10 = responseContractStage.response

  const authorityBinding = assemblyV4.harness_context_binding
  const executionEnvelopeStage = runReplayWorkerV10ExecutionEnvelopeStage({
    authority_binding: authorityBinding,
    response_contract: responseV10Contract,
    worker_request: firstRequestV10,
  })
  const attemptLease = executionEnvelopeStage.attempt_lease
  const executionEnvelope = executionEnvelopeStage.execution_envelope
  const renewedLease = executionEnvelopeStage.renewed_lease
  const successorEnvelope = executionEnvelopeStage.successor_envelope

  const dispatchLeaseAdmissionStage = runReplayWorkerV10DispatchLeaseAdmissionStage({
    attempt_lease: attemptLease,
    execution_envelope: executionEnvelope,
    renewed_lease: renewedLease,
    successor_envelope: successorEnvelope,
    retry_lease: executionEnvelopeStage.retry_lease,
    retry_envelope: executionEnvelopeStage.retry_envelope,
  })
  const dispatchAdmission = dispatchLeaseAdmissionStage.dispatch_admission

  const dispatchAuthorityBindingStage = runReplayWorkerV10DispatchAuthorityBindingStage({
    attempt_lease: attemptLease,
    execution_envelope: executionEnvelope,
    dispatch_admission: dispatchAdmission,
  })
  const leaseObservationBody = dispatchAuthorityBindingStage.lease_observation_body
  const leaseObservation = dispatchAuthorityBindingStage.lease_observation
  const authorityBindingInput = dispatchAuthorityBindingStage.authority_binding_input
  const dispatchAuthorityBinding = dispatchAuthorityBindingStage.dispatch_authority_binding
  const dispatchEvidenceRegistryRoot = mkdtempSync(join(tmpdir(), "replay-dispatch-evidence-"))
  try {
    const dispatchEvidenceStage = runReplayWorkerV10DispatchEvidenceStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: dispatchAuthorityBinding,
      attempt_lease: attemptLease,
      profile: replayProfile,
    })
    const dispatchEvidenceRegistration =
      dispatchEvidenceStage.dispatch_evidence_registration

    const transportContractStage = runReplayWorkerV10TransportContractStage({
      registry_root: dispatchEvidenceRegistryRoot,
      worker_v10_build_capability: workerV10BuildCapability,
      execution_envelope: executionEnvelope,
      code_admission: codeAdmission,
      logical_request_artifact_hash: buildAttestation.artifact.sha256,
      worker_request: firstRequestV10,
      worker_response: responseV10,
      profile: replayProfile,
    })
    const durableWorkerV10Capability = transportContractStage.durable_worker_capability
    const transportContractInput = transportContractStage.transport_contract_input
    const workerV10TransportContract = transportContractStage.worker_v10_transport_contract

    const stdioProbeStage = runReplayWorkerV10StdioProbeStage({
      registry_root: dispatchEvidenceRegistryRoot,
      registered_transport_contract: transportContractStage.registered_transport_contract,
      profile: replayProfile,
    })
    const durableStdioCapability = stdioProbeStage.durable_stdio_capability
    const negativeProbeReceipt = stdioProbeStage.negative_probe_receipt

    const successorTransportStage = runReplayWorkerV10SuccessorTransportStage({
      registry_root: dispatchEvidenceRegistryRoot,
      negative_probe_receipt: negativeProbeReceipt,
      profile: replayProfile,
    })
    const successorTransportContract = successorTransportStage.successor_transport_contract
    const executionClaimStage = runReplayWorkerV10ExecutionClaimStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_transport_contract: successorTransportContract,
      lease_observation_body: leaseObservationBody,
      lease_observation: leaseObservation,
      dispatch_evidence_registration: dispatchEvidenceRegistration,
      attempt_lease: attemptLease,
      renewed_lease: renewedLease,
      profile: replayProfile,
    })
    const executionAdmissionContract = executionClaimStage.execution_admission_contract
    const claimObservation = executionClaimStage.claim_observation
    const claimRenewedObservation = executionClaimStage.renewed_claim_observation
    const dispatchClaim = executionClaimStage.dispatch_claim
    const predecessorAdmissionEvidenceStage =
      runReplayWorkerV10PredecessorAdmissionEvidenceStage({
        registry_root: dispatchEvidenceRegistryRoot,
        execution_admission_contract: executionAdmissionContract,
        dispatch_claim: dispatchClaim,
        lease_observation_body: leaseObservationBody,
        claim_observation: claimObservation,
        renewed_claim_observation: claimRenewedObservation,
        successor_transport_contract: successorTransportContract,
        profile: replayProfile,
      })
    const preIssueObservation = predecessorAdmissionEvidenceStage.pre_issue_observation
    const preIssueInput = predecessorAdmissionEvidenceStage.pre_issue_input
    const registryReadReceipt = predecessorAdmissionEvidenceStage.registry_read_receipt
    const registryProvenanceInput =
      predecessorAdmissionEvidenceStage.registry_provenance_input
    const registryProvenance = predecessorAdmissionEvidenceStage.registry_provenance
    const clockAttestation = predecessorAdmissionEvidenceStage.clock_attestation
    const clockBindingInput = predecessorAdmissionEvidenceStage.clock_binding_input
    const clockBinding = predecessorAdmissionEvidenceStage.clock_binding
    const predecessorLaunchStage = runReplayWorkerV10PredecessorLaunchStage({
      registry_root: dispatchEvidenceRegistryRoot,
      clock_binding: clockBinding,
      dispatch_claim: dispatchClaim,
      pre_issue_observation: preIssueObservation,
      registry_read_receipt: registryReadReceipt,
      clock_attestation: clockAttestation,
      attempt_lease: attemptLease,
      lease_observation_body: leaseObservationBody,
      profile: replayProfile,
    })
    const commandInput = predecessorLaunchStage.command_input
    const executionAdmissionCommand = predecessorLaunchStage.execution_command
    const postCommandObservation = predecessorLaunchStage.post_command_observation
    const postCommandReadAt = predecessorLaunchStage.post_command_read_at
    const postCommandRegistryReceipt = predecessorLaunchStage.post_command_registry_receipt
    const postCommandClockAttestation = predecessorLaunchStage.post_command_clock_attestation
    const processIntentInput = predecessorLaunchStage.process_intent_input
    const processLaunchIntent = predecessorLaunchStage.process_launch_intent
    const processReadinessInput = predecessorLaunchStage.process_readiness_input
    const processLaunchReadiness = predecessorLaunchStage.process_launch_readiness

    const authorityTransportStage = runReplayWorkerV10AuthorityTransportStage({
      registry_root: dispatchEvidenceRegistryRoot,
      process_launch_readiness: processLaunchReadiness,
      first_worker_request: firstRequestV10,
      execution_envelope: executionEnvelope,
      first_worker_response: responseV10,
      predecessor_successor_transport_contract: successorTransportContract,
      profile: replayProfile,
    })
    const authorityBuildInput = authorityTransportStage.frame_build_input
    const authorityFrameBuild = authorityTransportStage.frame_build
    const activatedStdioInput = authorityTransportStage.activated_stdio_input
    const activatedStdio = authorityTransportStage.activated_stdio
    const authorityTransportInput = authorityTransportStage.transport_input
    const authorityTransport = authorityTransportStage.transport

    const authorityAdmissionStage = runReplayWorkerV10AuthorityAdmissionStage({
      registry_root: dispatchEvidenceRegistryRoot,
      post_command_observation: postCommandObservation,
      authority_transport: authorityTransport,
      activated_stdio: activatedStdio,
      predecessor_execution_command: executionAdmissionCommand,
      predecessor_process_launch_intent: processLaunchIntent,
      post_command_clock_attestation: postCommandClockAttestation,
      predecessor_successor_transport_contract: successorTransportContract,
      lease_observation_body: leaseObservationBody,
    })
    const authorityCommandInput = authorityAdmissionStage.command_input
    const authorityCommand = authorityAdmissionStage.command
    const authorityIntentInput = authorityAdmissionStage.intent_input
    const authorityIntent = authorityAdmissionStage.intent
    const authorityIntentRegistryReceipt = authorityAdmissionStage.intent_registry_receipt
    const authorityCapsuleInput = authorityAdmissionStage.capsule_input
    const authorityCapsule = authorityAdmissionStage.capsule

    const authoritySpawnStage = runReplayWorkerV10AuthoritySpawnStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_capsule: authorityCapsule,
      intent_registry_receipt: authorityIntentRegistryReceipt,
      profile: replayProfile,
    })
    const spawnRevalidationRequestInput = authoritySpawnStage.request_input
    const spawnRevalidationRequest = authoritySpawnStage.request
    const spawnRevalidationInput = authoritySpawnStage.revalidation_input
    const spawnRevalidation = authoritySpawnStage.revalidation

    const authorityProcessStage = await runReplayWorkerV10AuthorityProcessStage({
      registry_root: dispatchEvidenceRegistryRoot,
      spawn_revalidation: spawnRevalidation,
      authority_capsule: authorityCapsule,
      activated_stdio: activatedStdio,
      authority_transport: authorityTransport,
      authority_command: authorityCommand,
      authority_intent: authorityIntent,
      profile: replayProfile,
    })
    const authorityProcessReceipt = authorityProcessStage.process_receipt
    const authorityDispatchReceipt = authorityProcessStage.dispatch_receipt
    const authorityDispatchAttempt = authorityProcessStage.dispatch_attempt

    const authorityResponseStage = runReplayWorkerV10AuthorityResponseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      dispatch_receipt: authorityDispatchReceipt,
      dispatch_attempt: authorityDispatchAttempt,
      process_receipt: authorityProcessReceipt,
      replay_execution_request: requestValue,
      profile: replayProfile,
    })
    const authorityResponseValidation = authorityResponseStage.response_validation
    const authorityScheduleAdmission = authorityResponseStage.schedule_admission
    const reproducibilityPairContract =
      authorityResponseStage.reproducibility_pair_contract

    const successorLeaseStage = runReplayWorkerV10SuccessorLeaseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      reproducibility_pair_contract: reproducibilityPairContract,
      first_execution_envelope: executionEnvelope,
      first_schedule_admission: authorityScheduleAdmission,
      first_worker_request: firstRequestV10,
      replay_execution_request_hash: authorityBinding.request_hash,
      predecessor_attempt_lease: attemptLease,
      profile: replayProfile,
    })
    const successorAuthorityContract = successorLeaseStage.authority_contract
    const requestedSuccessorLeaseExpiry = successorLeaseStage.requested_lease_expiry
    const successorLeaseResult = successorLeaseStage.result
    const successorLeaseAdmission = successorLeaseStage.admission

    const successorExecutionStage = runReplayWorkerV10SuccessorExecutionStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_execution_envelope: executionEnvelope,
      comparison_successor_envelope: successorEnvelope,
      predecessor_lease_generation: attemptLease.lease_generation,
      durable_worker_capability: durableWorkerV10Capability,
      predecessor_transport_contract: workerV10TransportContract,
      predecessor_stdio_capability: durableStdioCapability,
      predecessor_negative_probe_receipt: negativeProbeReceipt,
      predecessor_successor_transport_contract: successorTransportContract,
      predecessor_execution_admission_contract: executionAdmissionContract,
      profile: replayProfile,
    })
    const successorEnvelopeAdmission = successorExecutionStage.envelope_admission
    const successorTransportAdmission = successorExecutionStage.transport_admission
    const successorStdioProbeAdmission = successorExecutionStage.stdio_probe_admission
    const successorExecutionContractAdmission =
      successorExecutionStage.execution_contract_admission

    const successorCommandStage = runReplayWorkerV10SuccessorCommandStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_lease_generation: attemptLease.lease_generation,
      predecessor_execution_admission_command_hash: executionAdmissionCommand.command_hash,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorCommandAdmission = successorCommandStage.command_admission
    const successorExecutionCommand = successorCommandStage.execution_command

    const successorIntentStage = runReplayWorkerV10SuccessorIntentStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_command_admission: successorCommandAdmission,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_stdio_probe_admission: successorStdioProbeAdmission,
      command_observation: successorCommandStage.command_observation,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorProcessLaunchIntent = successorIntentStage.process_launch_intent

    const successorCapsuleStage = runReplayWorkerV10SuccessorCapsuleStage({
      registry_root: dispatchEvidenceRegistryRoot,
      process_launch_intent: successorProcessLaunchIntent,
      execution_command: successorExecutionCommand,
      execution_contract_admission: successorExecutionContractAdmission,
      profile: replayProfile,
    })
    const successorAuthorityCapsule = successorCapsuleStage.authority_capsule
    const successorCapsuleFile = successorCapsuleStage.capsule_file
    const successorIntentFile = successorCapsuleStage.intent_file

    const successorSpawnStage = runReplayWorkerV10SuccessorSpawnStage({
      registry_root: dispatchEvidenceRegistryRoot,
      capsule_file: successorCapsuleFile,
      intent_file: successorIntentFile,
      authority_capsule: successorAuthorityCapsule,
      process_launch_intent: successorProcessLaunchIntent,
      successor_lease_admission: successorLeaseAdmission,
      profile: replayProfile,
    })
    const successorSpawnResult = successorSpawnStage.result
    const buildSuccessorSpawnReceipt = successorSpawnStage.build_receipt
    const successorSpawnRevalidation = successorSpawnResult.spawn_boundary_revalidation
    let cutoverRevalidationCalls = 0
    const cutoverInput = {
      registry_root: dispatchEvidenceRegistryRoot,
      source_pair_contract: reproducibilityPairContract,
      source_successor_spawn_revalidation: successorSpawnRevalidation,
      source_successor_authority_capsule: successorAuthorityCapsule,
      source_successor_process_launch_intent: successorProcessLaunchIntent,
      source_successor_stdio_probe_admission: successorStdioProbeAdmission,
      authority_port: {
        revalidate: (request: ReplaySpawnBoundaryRevalidationRequest) => {
          cutoverRevalidationCalls += 1
          return buildSuccessorSpawnReceipt(
            request, "2026-07-14T00:04:10Z", "2026-07-14T00:04:11Z", "12000000", "12000100",
          )
        },
      },
    }
    const cutover = executeReplayWorkerV10Cutover(cutoverInput)
    replayProfile("worker cutover")
    expectWorkerV10Cutover({
      outcome: cutover,
      revalidation_calls: cutoverRevalidationCalls,
    })
    expect(readReplayWorkerV10CutoverReceipt(cutoverInput)).toEqual(cutover.receipt)
    const cutoverRetry = executeReplayWorkerV10Cutover(cutoverInput)
    expect(cutoverRetry.disposition).toBe("existing_cutover_receipt")
    expect(cutoverRetry.receipt).toEqual(cutover.receipt)
    expect(cutoverRevalidationCalls).toBe(1)
    const cutoverWorkerRequest = cutover.receipt.second_request_frame.worker_request
    const formalCutoverAdmission = executeReplayDecisionHarness({
      registry: createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt]),
      request: requestValue,
      schedule_entry: requestValue.decision_schedule.entries[0]!,
      decision_input_snapshot: cutoverWorkerRequest.decision_input_snapshot,
      decision_market_input_snapshot: cutoverWorkerRequest.decision_market_input_snapshot,
      decision_state_snapshot: cutoverWorkerRequest.decision_state_snapshot,
    })
    replayProfile("formal cutover admission")
    expectFormalCutoverAdmission({
      receipt: formalCutoverAdmission.receipt,
      cutover: cutover.receipt,
    })
    const resultArtifactRoot = mkdtempSync(join(tmpdir(), "rd-replay-r4-152-result-golden-"))
    try {
      const cutoverRegistry = createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt])
      const completedTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(completedTrial.status).toBe("completed")
      expect(completedTrial.result?.status).toBe("completed")
      const initialDecisionEvidence = completedTrial.result?.decision_evidence_timeline.entries[0]
      expect(initialDecisionEvidence?.decision_harness_receipt?.receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(initialDecisionEvidence?.decision_harness_receipt?.worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.decision_harness_receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(completedTrial.result?.fingerprint.decision_harness_worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.dataset_hash).toBe(GOLDEN_REPLAY_DATASET_HASH)
      expect(completedTrial.result?.fingerprint.trial_reservation_hash)
        .toBe(hashTrialReservationSnapshot(trialReservation))
      expect(completedTrial.artifact_manifest?.result_hash)
        .toBe(completedTrial.result?.fingerprint.result_hash)
      expect(completedTrial.artifact_manifest?.files.some(
        (file) => file.role === "decision_evidence_timeline",
      )).toBe(true)
      expect(completedTrial.artifact_manifest?.completeness.authoritative_result).toBe(true)
      const idempotentTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(idempotentTrial.status).toBe("completed")
      expect(idempotentTrial.idempotent_replay).toBe(true)
      expect(idempotentTrial.artifact_manifest).toEqual(completedTrial.artifact_manifest)
    } finally {
      rmSync(resultArtifactRoot, { recursive: true, force: true })
    }
    expect(admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_authority_capsule: structuredClone(successorAuthorityCapsule),
      source_successor_process_launch_intent: structuredClone(successorProcessLaunchIntent),
      authority_port: {
        revalidate: () => {
          successorSpawnStage.record_authority_port_call()
          throw new Error("durable successor revalidation retry must not call Control Plane")
        },
      },
    })).toEqual(successorSpawnResult)
    expect(successorSpawnStage.authority_port_call_count()).toBe(1)
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation({
      ...successorSpawnRevalidation,
      successor_worker_process_count: 1 as never,
    })).toThrow()

    runReplayWorkerV10SuccessorIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      command_stage: successorCommandStage,
      intent_stage: successorIntentStage,
      capsule_stage: successorCapsuleStage,
      spawn_stage: successorSpawnStage,
      execution_contract_admission: successorExecutionContractAdmission,
      stdio_probe_admission: successorStdioProbeAdmission,
      transport_admission: successorTransportAdmission,
      envelope_admission: successorEnvelopeAdmission,
      lease_admission: successorLeaseAdmission,
      authority_contract: successorAuthorityContract,
      renewal_request: successorLeaseResult.renewal_request,
      reproducibility_pair_contract: reproducibilityPairContract,
      authority_schedule_admission: authorityScheduleAdmission,
      authority_response_validation: authorityResponseValidation,
      replay_execution_request: requestValue,
    })

    runReplayWorkerV10UpstreamIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_response_validation: authorityResponseValidation,
      authority_dispatch_receipt: authorityDispatchReceipt,
      authority_process_receipt: authorityProcessReceipt,
      spawn_revalidation: spawnRevalidation,
      spawn_revalidation_input: spawnRevalidationInput,
      spawn_revalidation_request: spawnRevalidationRequest,
      spawn_revalidation_request_input: spawnRevalidationRequestInput,
      authority_capsule: authorityCapsule,
      authority_capsule_input: authorityCapsuleInput,
      authority_intent: authorityIntent,
      authority_intent_input: authorityIntentInput,
      authority_command: authorityCommand,
      authority_command_input: authorityCommandInput,
      authority_transport: authorityTransport,
      authority_transport_input: authorityTransportInput,
      activated_stdio: activatedStdio,
      activated_stdio_input: activatedStdioInput,
      authority_frame_build: authorityFrameBuild,
      authority_build_input: authorityBuildInput,
      process_launch_readiness: processLaunchReadiness,
      process_readiness_input: processReadinessInput,
      post_command_registry_receipt: postCommandRegistryReceipt,
      post_command_read_at: postCommandReadAt,
      post_command_clock_attestation: postCommandClockAttestation,
      execution_admission_command: executionAdmissionCommand,
      process_launch_intent: processLaunchIntent,
      process_intent_input: processIntentInput,
      registry_read_receipt: registryReadReceipt,
      clock_attestation: clockAttestation,
      registry_provenance: registryProvenance,
      clock_binding: clockBinding,
      command_input: commandInput,
      clock_binding_input: clockBindingInput,
      registry_provenance_input: registryProvenanceInput,
      pre_issue_input: preIssueInput,
      execution_admission_contract: executionAdmissionContract,
      successor_transport_contract: successorTransportContract,
      negative_probe_receipt: negativeProbeReceipt,
      durable_stdio_capability: durableStdioCapability,
      worker_v10_transport_contract: workerV10TransportContract,
      transport_contract_input: transportContractInput,
    })

    runReplayWorkerV10LegacyActivationStage({
      registry_root: dispatchEvidenceRegistryRoot,
      lease_observation_body: leaseObservationBody,
      execution_envelope: executionEnvelope,
      dispatch_claim: dispatchClaim,
      claim_observation: claimObservation,
      claim_renewed_observation: claimRenewedObservation,
      attempt_lease: attemptLease,
      dispatch_evidence_registration: dispatchEvidenceRegistration,
      profile: replayProfile,
    })
  } finally {
    rmSync(dispatchEvidenceRegistryRoot, { recursive: true, force: true })
  }
  const renewedObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-2",
    observation_ref: "observation://replay-attempt-lease/envelope-2",
    observed_at: renewedLease.heartbeat_at,
    lease_generation: renewedLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(renewedLease),
    attempt_lease: renewedLease,
  })
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: renewedObservation,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: successorEnvelope,
    control_plane_lease_observation: renewedObservation,
  })
  expect(successorAuthorityBinding.source_dispatch_lease_admission.lease_generation).toBe(3)
  expect(successorAuthorityBinding.binding_hash).not.toBe(dispatchAuthorityBinding.binding_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...authorityBindingInput,
    control_plane_lease_observation: {
      ...leaseObservation,
      observation_hash: "b".repeat(64),
    },
  })).toThrow("observation hash mismatch")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...dispatchAuthorityBinding,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Authority Binding authority")

  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: sourceEvents.slice(1),
  })).toThrow("source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: [...sourceEvents, {
      source_event_id: "source:bar_open:3", kind: "bar_open", source_index: 2,
      event_key: {
        event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
        source_sequence: 3, event_subphase: 0, stable_event_id: "source:bar_open:3",
      },
    }],
  })).toThrow("exact complete source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    harness_context_binding: contextBinding(request("b".repeat(64))),
  })).toThrow("Request/Context binding drift")
  const mismatchedRequest = request("b".repeat(64))
  const mismatchedState = buildReplayPositionOpenStateInputMaterialization({
    request: mismatchedRequest,
    harness_context_binding: contextBinding(mismatchedRequest),
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [mismatchedState],
  })).toThrow("R4.102 parent binding drift")
  expect(() => assertReplayPositionOpenStateInputMaterialization({
    ...materialization,
    worker_request_materialization: "allowed" as never,
  })).toThrow("unsupported position-open State input materialization authority")
  const { snapshot_hash: _snapshotHash, ...snapshotBody } = snapshot
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, {
    ...input,
    decision_state_snapshot: createReplayDecisionStateSnapshot({
      ...snapshotBody,
      cash_balance: 999.8,
    }),
  })).toThrow("parent lineage drift")
}, 600_000)
