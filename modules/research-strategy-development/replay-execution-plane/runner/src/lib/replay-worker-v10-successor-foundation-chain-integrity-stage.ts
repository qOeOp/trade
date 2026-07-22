import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readReplayWorkerV10AuthorityScheduleAdmission } from "./replay-worker-v10-authority-schedule-admission-registry"
import { readReplayWorkerV10ReproducibilityPairContract } from "./replay-worker-v10-reproducibility-pair-contract-registry"
import { readReplayWorkerV10SuccessorExecutionEnvelope } from "./replay-worker-v10-successor-execution-envelope-registry"
import { readReplayWorkerV10SuccessorExecutionStdioProbe } from "./replay-worker-v10-successor-execution-stdio-probe-registry"
import { readReplayWorkerV10SuccessorExecutionTransport } from "./replay-worker-v10-successor-execution-transport-registry"
import { readReplayWorkerV10SuccessorLeaseAdmission } from "./replay-worker-v10-successor-lease-admission-registry"
import { readReplayWorkerV10SuccessorVerificationAuthorityContract } from "./replay-worker-v10-successor-verification-authority-contract-registry"

export interface ReplayWorkerV10SuccessorFoundationChainIntegrityStageInput {
  registry_root: string
  transport_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionStdioProbe>[0][
      "source_successor_execution_transport_admission"
    ]
  envelope_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionTransport>[0][
      "source_successor_execution_envelope_admission"
    ]
  lease_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionEnvelope>[0][
      "source_successor_lease_admission"
    ]
  authority_contract:
    Parameters<typeof readReplayWorkerV10SuccessorLeaseAdmission>[0][
      "source_successor_authority_contract"
    ]
  renewal_request:
    Parameters<typeof readReplayWorkerV10SuccessorLeaseAdmission>[0]["source_renewal_request"]
  reproducibility_pair_contract:
    Parameters<typeof readReplayWorkerV10SuccessorVerificationAuthorityContract>[0][
      "source_reproducibility_pair_contract"
    ]
  authority_schedule_admission:
    Parameters<typeof readReplayWorkerV10ReproducibilityPairContract>[0]["source_schedule_admission"]
  authority_response_validation:
    Parameters<typeof readReplayWorkerV10AuthorityScheduleAdmission>[0]["source_response_validation"]
  replay_execution_request:
    Parameters<typeof readReplayWorkerV10AuthorityScheduleAdmission>[0]["source_replay_execution_request"]
}

export function runReplayWorkerV10SuccessorFoundationChainIntegrityStage(
  input: ReplayWorkerV10SuccessorFoundationChainIntegrityStageInput,
): void {
  const root = input.registry_root
  const transportFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-transport-${input.transport_admission.admission_key}.json`)
  if (!transportFile) throw new Error("expected Worker v10 successor execution Transport Admission file")
  writeFileSync(join(root, transportFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionTransport({
    registry_root: root,
    source_successor_execution_envelope_admission: input.envelope_admission,
  })).toThrow()

  const envelopeFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-envelope-${input.envelope_admission.admission_key}.json`)
  if (!envelopeFile) throw new Error("expected Worker v10 successor Execution Envelope Admission file")
  writeFileSync(join(root, envelopeFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionEnvelope({
    registry_root: root,
    source_successor_lease_admission: input.lease_admission,
  })).toThrow()

  const leaseFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-lease-admission-${input.lease_admission.admission_key}.json`)
  if (!leaseFile) throw new Error("expected Worker v10 successor Lease Admission file")
  writeFileSync(join(root, leaseFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorLeaseAdmission({
    registry_root: root,
    source_successor_authority_contract: input.authority_contract,
    source_renewal_request: input.renewal_request,
  })).toThrow()

  const authorityFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-verification-authority-contract-${input.authority_contract.contract_key}.json`)
  if (!authorityFile) throw new Error("expected Worker v10 successor verification authority Contract file")
  writeFileSync(join(root, authorityFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: root,
    source_reproducibility_pair_contract: input.reproducibility_pair_contract,
  })).toThrow()

  const pairFile = readdirSync(root).find((name) => name
    === `worker-v10-reproducibility-pair-contract-${input.reproducibility_pair_contract.contract_key}.json`)
  if (!pairFile) throw new Error("expected Worker v10 Reproducibility Pair Contract file")
  writeFileSync(join(root, pairFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10ReproducibilityPairContract({
    registry_root: root,
    source_schedule_admission: input.authority_schedule_admission,
  })).toThrow()

  const scheduleFile = readdirSync(root).find((name) => name
    === `worker-v10-authority-schedule-admission-${input.authority_schedule_admission.admission_key}.json`)
  if (!scheduleFile) throw new Error("expected Worker v10 Authority Schedule Admission file")
  writeFileSync(join(root, scheduleFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10AuthorityScheduleAdmission({
    registry_root: root,
    source_response_validation: input.authority_response_validation,
    source_replay_execution_request: input.replay_execution_request,
  })).toThrow()
}
