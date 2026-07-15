import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  assertReplayArtifactStoreCapability,
  type ReplayArtifactStoreCapabilitySnapshot,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayArtifactStoredFile {
  ref: string
  sha256: string
}

export interface ReplayArtifactReadFile {
  name: string
  ref: string
  bytes: Uint8Array
}

export interface ReplayArtifactAttemptIdentity {
  idempotency_key_hash: string
  attempt_id_hash: string
}

export interface ReplayArtifactNamespace {
  readonly namespace_ref: string
  fileRef(name: string): string
  exists(name: string): boolean
  listNames(): string[]
  read(name: string): ReplayArtifactReadFile
  readRef(ref: string): ReplayArtifactReadFile
  writeImmutable(name: string, content: string): ReplayArtifactStoredFile
  remove(name: string): void
}

export interface ReplayArtifactStore {
  readonly capability: ReplayArtifactStoreCapabilitySnapshot
  openAttempt(identity: ReplayArtifactAttemptIdentity): ReplayArtifactNamespace
}

export class ReplayArtifactStoreContractError extends Error {}

export function assertCertifiedReplayArtifactStore(store: ReplayArtifactStore): void {
  try {
    assertReplayArtifactStoreCapability(store.capability)
  } catch (error) {
    throw new ReplayArtifactStoreContractError(error instanceof Error ? error.message : String(error))
  }
  if (store.capability.backend_kind !== "local_filesystem"
      || store.capability.storage_policy_version !== REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION) {
    throw new ReplayArtifactStoreContractError(
      "Replay Artifact Store backend is contract-valid but not certified for execution",
    )
  }
}
