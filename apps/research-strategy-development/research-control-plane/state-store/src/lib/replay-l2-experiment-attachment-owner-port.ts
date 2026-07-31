import type { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type { ReplayDatasetManifest, ReplayExecutionRequest } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import type {
  ReplayL2CompactedEpochSource,
  ReplayL2DepthReadBatch,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-l2-depth-contracts"
import type { TrialReservationSnapshot } from "../../../contracts/src/lib/control-plane-contracts"
import {
  issueReplayL2ExperimentAttachmentAuthority,
  readReplayL2ExperimentAttachmentAuthority,
} from "./replay-l2-experiment-attachment-authority-registry"

export type ReplayL2ExperimentAttachmentOwnerAction =
  | "issue_replay_l2_experiment_attachment"
  | "read_replay_l2_experiment_attachment"

export function executeReplayL2ExperimentAttachmentOwnerAction(
  db: Database,
  action: ReplayL2ExperimentAttachmentOwnerAction,
  payload: JSONRecord,
): JSONRecord {
  if (action === "read_replay_l2_experiment_attachment") {
    const reservationHash = requireHash(
      payload.reservation_hash,
      "read Replay L2 experiment attachment reservation_hash",
    )
    return {
      ok: true,
      action,
      authority: readReplayL2ExperimentAttachmentAuthority(db, reservationHash),
    } as unknown as JSONRecord
  }
  const authority = issueReplayL2ExperimentAttachmentAuthority(db, {
    authority_snapshot_id: requireText(payload.authority_snapshot_id, "authority_snapshot_id"),
    authority_snapshot_ref: requireText(payload.authority_snapshot_ref, "authority_snapshot_ref"),
    issued_at: requireText(payload.issued_at, "issued_at"),
    authority_id: requireText(payload.authority_id, "authority_id"),
    authority_policy_version: requireText(payload.authority_policy_version, "authority_policy_version"),
    reservation: requireRecord(payload.reservation, "reservation") as unknown as TrialReservationSnapshot,
    request: requireRecord(payload.request, "request") as unknown as ReplayExecutionRequest,
    dataset_manifest: requireRecord(payload.dataset_manifest, "dataset_manifest") as unknown as ReplayDatasetManifest,
    source: requireRecord(payload.source, "source") as unknown as ReplayL2CompactedEpochSource,
    batch: requireRecord(payload.batch, "batch") as unknown as ReplayL2DepthReadBatch,
  })
  return { ok: true, action, authority } as unknown as JSONRecord
}

export function isReplayL2ExperimentAttachmentOwnerAction(
  value: string,
): value is ReplayL2ExperimentAttachmentOwnerAction {
  return value === "issue_replay_l2_experiment_attachment"
    || value === "read_replay_l2_experiment_attachment"
}

function requireRecord(value: unknown, field: string): JSONRecord {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) throw new Error(`${field} must be a non-empty object`)
  return record
}

function requireText(value: unknown, field: string): string {
  const text = stringField(value)
  if (!text) throw new Error(`${field} is required`)
  return text
}

function requireHash(value: unknown, field: string): string {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return text
}
