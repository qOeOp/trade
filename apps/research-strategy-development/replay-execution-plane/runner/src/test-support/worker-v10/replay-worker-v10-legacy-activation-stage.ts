import { expect } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseObservationBody,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessTransportActivationGate,
} from "../../../../contracts/src/lib/replay-decision-harness-transport-activation"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessDispatchEvidenceRegistration } from "../../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import { buildReplayDecisionHarnessDispatchLeaseAuthorityBinding } from "../../lib/replay-decision-harness-dispatch-lease-authority-binding"
import { registerReplayDispatchEvidence } from "../../lib/replay-dispatch-evidence-registry"
import {
  launchReplayDispatchProcessProbe,
  readReplayProcessLaunchAttempt,
  readReplayProcessLaunchReceipt,
} from "../../lib/replay-process-launch-registry"
import {
  readReplayTransportActivationGate,
  registerReplayTransportActivationGate,
} from "../../lib/replay-transport-activation-registry"
import { readReplayDispatchClaim } from "../../lib/replay-dispatch-claim-registry"
import { readReplayDispatchEvidence } from "../../lib/replay-dispatch-evidence-registry"
import {
  expectLegacyProcessProbe,
  expectLegacyTransportActivation,
} from "./replay-worker-v10-cutover-legacy-stage.assertions"

export interface ReplayWorkerV10LegacyActivationStageInput {
  registry_root: string
  lease_observation_body: ReplayAttemptLeaseObservationBody
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  claim_observation: ReplayAttemptLeaseObservationSnapshot
  claim_renewed_observation: ReplayAttemptLeaseObservationSnapshot
  attempt_lease: ReplayAttemptLeaseSnapshot
  dispatch_evidence_registration: ReplayDecisionHarnessDispatchEvidenceRegistration
  profile(stage: string): void
}

export function runReplayWorkerV10LegacyActivationStage(
  input: ReplayWorkerV10LegacyActivationStageInput,
): void {
  const root = input.registry_root
  const claim = input.dispatch_claim
  const competingObservation = createReplayAttemptLeaseObservationSnapshot({
    ...input.lease_observation_body,
    observation_id: "lease-observation-envelope-competing",
    observation_ref: "observation://replay-attempt-lease/envelope-competing",
    observed_at: "2026-07-14T00:00:31Z",
  })
  const competingBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: input.execution_envelope,
    control_plane_lease_observation: competingObservation,
  })
  expect(() => registerReplayDispatchEvidence({
    registry_root: root,
    authority_binding: competingBinding,
    registered_at: "2026-07-14T00:00:32Z",
  })).toThrow("natural key is already registered with different authority")

  const launchObservation = createReplayAttemptLeaseObservationSnapshot({
    ...input.lease_observation_body,
    observation_id: "lease-observation-envelope-launch",
    observation_ref: "observation://replay-attempt-lease/envelope-launch",
    observed_at: "2026-07-14T00:00:34Z",
  })
  expect(() => launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: claim,
    launch_observation: input.claim_observation,
    clock: { now: () => "2026-07-14T00:00:35Z" },
  })).toThrow("requires a post-claim Lease observation")
  expect(() => launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: claim,
    launch_observation: launchObservation,
    clock: { now: () => input.attempt_lease.lease_expires_at },
  })).toThrow("must be invoked inside the revalidated Lease window")
  expect(() => launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: claim,
    launch_observation: input.claim_renewed_observation,
    clock: { now: () => "2026-07-14T00:02:02Z" },
  })).toThrow("parent or executable binding drift")

  const launchTimes = ["2026-07-14T00:00:35Z", "2026-07-14T00:00:36Z"]
  const processLaunchReceipt = launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: claim,
    launch_observation: launchObservation,
    clock: { now: () => launchTimes.shift() ?? "2026-07-14T00:00:36Z" },
  })
  expectLegacyProcessProbe(processLaunchReceipt)
  expect(launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: structuredClone(claim),
    launch_observation: structuredClone(launchObservation),
    clock: { now: () => { throw new Error("idempotent read must not relaunch") } },
  })).toEqual(processLaunchReceipt)
  const launchKey = {
    registry_root: root,
    attempt_id: claim.attempt_id,
    lease_generation: claim.lease_generation,
    logical_request_id: claim.logical_request_id,
  }
  expect(readReplayProcessLaunchAttempt(launchKey)).toEqual(processLaunchReceipt.source_process_launch_attempt)
  expect(readReplayProcessLaunchReceipt(launchKey)).toEqual(processLaunchReceipt)

  const missingTransportGateRoot = mkdtempSync(join(tmpdir(), "replay-transport-gate-missing-"))
  try {
    expect(() => registerReplayTransportActivationGate({
      registry_root: missingTransportGateRoot,
      source_process_launch_receipt: processLaunchReceipt,
    })).toThrow("requires the exact durable Process Launch Receipt")
  } finally {
    rmSync(missingTransportGateRoot, { recursive: true, force: true })
  }
  const transportGate = registerReplayTransportActivationGate({
    registry_root: root,
    source_process_launch_receipt: processLaunchReceipt,
  })
  input.profile("legacy transport activation")
  expectLegacyTransportActivation(transportGate)
  expect(registerReplayTransportActivationGate({
    registry_root: root,
    source_process_launch_receipt: structuredClone(processLaunchReceipt),
  })).toEqual(transportGate)
  expect(readReplayTransportActivationGate({
    registry_root: root,
    source_process_launch_receipt: processLaunchReceipt,
  })).toEqual(transportGate)
  expect(() => assertReplayDecisionHarnessTransportActivationGate({
    ...transportGate,
    target_worker_protocol_version: "rd-replay-harness-worker-stdio-v9" as never,
  })).toThrow("unsupported decision harness Transport Activation authority")
  expect(() => assertReplayDecisionHarnessTransportActivationGate({
    ...transportGate,
    blockers: transportGate.blockers.slice(1),
  })).toThrow("parent or blocker binding drift")
  expect(() => assertReplayDecisionHarnessTransportActivationGate({
    ...transportGate,
    transport_frame_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Transport Activation authority")
  const transportGateFile = readdirSync(root).find((name) => name.startsWith("transport-activation-"))
  if (!transportGateFile) throw new Error("expected Replay Transport Activation Gate registry file")
  writeFileSync(join(root, transportGateFile), "{}\n", "utf8")
  expect(() => readReplayTransportActivationGate({
    registry_root: root,
    source_process_launch_receipt: processLaunchReceipt,
  })).toThrow()

  const registryFilesAfterLaunch = readdirSync(root)
  const processReceiptFile = registryFilesAfterLaunch.find((name) => name.startsWith("process-launch-receipt-"))
  if (!processReceiptFile) throw new Error("expected Replay Process Launch Receipt registry file")
  writeFileSync(join(root, processReceiptFile), "{}\n", "utf8")
  expect(() => readReplayProcessLaunchReceipt(launchKey)).toThrow()
  writeFileSync(join(root, processReceiptFile), `${JSON.stringify(processLaunchReceipt, null, 2)}\n`, "utf8")
  expect(() => readReplayProcessLaunchReceipt(launchKey)).toThrow("not canonical")
  rmSync(join(root, processReceiptFile))
  expect(() => launchReplayDispatchProcessProbe({
    registry_root: root,
    source_claim: claim,
    launch_observation: launchObservation,
    clock: { now: () => { throw new Error("orphan launch attempt must not relaunch") } },
  })).toThrow("pending or indeterminate")
  const processAttemptFile = registryFilesAfterLaunch.find((name) => name.startsWith("process-launch-attempt-"))
  if (!processAttemptFile) throw new Error("expected Replay Process Launch Attempt registry file")
  writeFileSync(join(root, processAttemptFile), "{}\n", "utf8")
  expect(() => readReplayProcessLaunchAttempt(launchKey)).toThrow()

  const registryFiles = readdirSync(root)
  const claimFile = registryFiles.find((name) => name.startsWith("dispatch-claim-"))
  if (!claimFile) throw new Error("expected Replay Dispatch Claim registry file")
  writeFileSync(join(root, claimFile), "{}\n", "utf8")
  expect(() => readReplayDispatchClaim({
    registry_root: root,
    attempt_id: input.dispatch_evidence_registration.attempt_id,
    lease_generation: input.dispatch_evidence_registration.lease_generation,
    logical_request_id: input.dispatch_evidence_registration.logical_request_id,
  })).toThrow()
  const registryFile = registryFiles.find((name) => name.startsWith("dispatch-evidence-"))
  if (!registryFile) throw new Error("expected Replay Dispatch Evidence registry file")
  writeFileSync(join(root, registryFile), "{}\n", "utf8")
  expect(() => readReplayDispatchEvidence({
    registry_root: root,
    attempt_id: input.dispatch_evidence_registration.attempt_id,
    lease_generation: input.dispatch_evidence_registration.lease_generation,
    logical_request_id: input.dispatch_evidence_registration.logical_request_id,
  })).toThrow()
}
