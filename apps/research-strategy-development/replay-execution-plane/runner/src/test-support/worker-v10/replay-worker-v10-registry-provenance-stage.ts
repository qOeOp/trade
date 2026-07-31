import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayAttemptLeaseObservationSnapshot } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance } from "../../lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import { readReplayWorkerV10ExecutionAdmissionRegistryProvenance, registerReplayWorkerV10ExecutionAdmissionRegistryProvenance } from "../../lib/replay-worker-v10-execution-admission-registry-provenance-registry"
import { createReplayWorkerV10LeaseClockEvidenceFixture } from "./replay-worker-v10-lease-clock-evidence-fixture"

export interface ReplayWorkerV10RegistryProvenanceStageInput {
  registry_root: string
  pre_issue_bundle: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle
  pre_issue_observation: ReplayAttemptLeaseObservationSnapshot
  profile(stage: string): void
}

export function runReplayWorkerV10RegistryProvenanceStage(
  input: ReplayWorkerV10RegistryProvenanceStageInput,
) {
  const evidence = createReplayWorkerV10LeaseClockEvidenceFixture({
    observation: input.pre_issue_observation,
    registered_at: "2026-07-14T00:00:34Z",
    read_at: "2026-07-14T00:00:35Z",
    read_started_monotonic_ns: "3000000",
  })
  const provenanceInput = {
    source_pre_issue_bundle: input.pre_issue_bundle,
    control_plane_registry_read_receipt: evidence.registry_receipt,
  }
  const provenance = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
    provenanceInput,
  )
  input.profile("registry provenance")
  expect(provenance.status).toBe("registry_provenance_bound_independent_clock_blocked")
  expect(provenance.control_plane_registry_read_provenance)
    .toBe("registered_row_and_current_attempt_exact_match_bound")
  expect(provenance.predecessor_blocker_closure)
    .toBe("control_plane_registry_read_provenance_closed_only")
  expect(provenance.external_time_attestation).toBe("not_provided")
  expect(provenance.execution_admission_command_instance_count).toBe(0)
  expect(provenance.blockers).toEqual([
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(provenance))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage(
    provenance,
    provenanceInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance({
    ...provenanceInput,
    control_plane_registry_read_receipt: {
      ...evidence.registry_receipt,
      receipt_hash: "1".repeat(64),
    },
  })).toThrow()

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-registry-provenance-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
      registry_root: missingRoot,
      ...provenanceInput,
    })).toThrow("requires the exact durable pre-issue bundle")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: input.registry_root,
    ...provenanceInput,
  })).toEqual(provenance)
  expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: input.registry_root,
    source_pre_issue_bundle: structuredClone(input.pre_issue_bundle),
    control_plane_registry_read_receipt: structuredClone(evidence.registry_receipt),
  })).toEqual(provenance)
  expect(readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: input.registry_root,
    ...provenanceInput,
  })).toEqual(provenance)
  return {
    registry_read_receipt: evidence.registry_receipt,
    registry_provenance_input: provenanceInput,
    registry_provenance: provenance,
    build_clock: evidence.build_clock,
  }
}
