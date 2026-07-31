import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import { buildReplayWorkerV10SuccessorExecutionAdmissionCommand } from "./replay-worker-v10-successor-execution-command-record"
import {
  buildReplayWorkerV10SuccessorExecutionCommandAdmission,
  buildReplayWorkerV10SuccessorExecutionDispatchClaim,
} from "./replay-worker-v10-successor-execution-command-records"
import {
  assertReplayWorkerV10SuccessorExecutionCommandParentSelfHash,
  readReplayWorkerV10SuccessorExecutionCommandParent,
  validateReplayWorkerV10SuccessorExecutionCommandAuthority,
} from "./replay-worker-v10-successor-execution-command-parent"
import {
  persistReplayWorkerV10SuccessorExecutionAdmissionCommand,
  persistReplayWorkerV10SuccessorExecutionCommandAdmission,
  persistReplayWorkerV10SuccessorExecutionDispatchClaim,
  readReplayWorkerV10SuccessorExecutionAdmissionCommandRecord,
  readReplayWorkerV10SuccessorExecutionCommandAdmissionRecord,
  readReplayWorkerV10SuccessorExecutionDispatchClaimRecord,
} from "./replay-worker-v10-successor-execution-command-store"
import type { ReplayWorkerV10SuccessorExecutionCommandRegistryInput } from "./replay-worker-v10-successor-execution-command-types"

export type { ReplayWorkerV10SuccessorExecutionCommandRegistryInput } from "./replay-worker-v10-successor-execution-command-types"

export function issueReplayWorkerV10SuccessorExecutionCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const parent = readParent(input)
  assertReplayWorkerV10SuccessorExecutionCommandParentSelfHash(parent.source)
  const claim = persistReplayWorkerV10SuccessorExecutionDispatchClaim(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionDispatchClaim(input, parent.source, parent.file_sha256),
  )
  const command = persistReplayWorkerV10SuccessorExecutionAdmissionCommand(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionAdmissionCommand(
      input,
      parent.source,
      parent.file_sha256,
      claim,
    ),
  )
  return persistReplayWorkerV10SuccessorExecutionCommandAdmission(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionCommandAdmission(
      parent.source,
      parent.file_sha256,
      command,
    ),
    parent.source,
  )
}

export function readReplayWorkerV10SuccessorExecutionDispatchClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  const parent = readParent(input)
  const expected = buildReplayWorkerV10SuccessorExecutionDispatchClaim(
    input,
    parent.source,
    parent.file_sha256,
  )
  return readReplayWorkerV10SuccessorExecutionDispatchClaimRecord(
    input.registry_root,
    expected.claim_key,
    expected,
  )
}

export function readReplayWorkerV10SuccessorExecutionAdmissionCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  const parent = readParent(input)
  const claim = readExpectedClaim(input, parent.source, parent.file_sha256)
  if (!claim) return null
  const expected = buildReplayWorkerV10SuccessorExecutionAdmissionCommand(
    input,
    parent.source,
    parent.file_sha256,
    claim,
  )
  return readReplayWorkerV10SuccessorExecutionAdmissionCommandRecord(
    input.registry_root,
    expected.command_key,
    expected,
  )
}

export function readReplayWorkerV10SuccessorExecutionCommandAdmission(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission | null {
  const parent = readParent(input)
  const claim = readExpectedClaim(input, parent.source, parent.file_sha256)
  if (!claim) return null
  const command = readExpectedCommand(input, parent.source, parent.file_sha256, claim)
  if (!command) return null
  const expected = buildReplayWorkerV10SuccessorExecutionCommandAdmission(
    parent.source,
    parent.file_sha256,
    command,
  )
  return readReplayWorkerV10SuccessorExecutionCommandAdmissionRecord(
    input.registry_root,
    expected.admission_key,
    parent.source,
    expected,
  )
}

function readParent(input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput) {
  const parent = readReplayWorkerV10SuccessorExecutionCommandParent(input)
  validateReplayWorkerV10SuccessorExecutionCommandAuthority(input, parent.source)
  return parent
}

function readExpectedClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReturnType<typeof readParent>["source"],
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  const expected = buildReplayWorkerV10SuccessorExecutionDispatchClaim(input, parent, parentFileSha256)
  return readReplayWorkerV10SuccessorExecutionDispatchClaimRecord(
    input.registry_root,
    expected.claim_key,
    expected,
  )
}

function readExpectedCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReturnType<typeof readParent>["source"],
  parentFileSha256: string,
  claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  const expected = buildReplayWorkerV10SuccessorExecutionAdmissionCommand(
    input,
    parent,
    parentFileSha256,
    claim,
  )
  return readReplayWorkerV10SuccessorExecutionAdmissionCommandRecord(
    input.registry_root,
    expected.command_key,
    expected,
  )
}
