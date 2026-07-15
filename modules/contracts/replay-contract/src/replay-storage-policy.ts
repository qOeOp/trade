export const REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION = "rd-replay-local-fsync-link-cas-v1" as const
export const REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION = "rd-replay-object-conditional-put-cas-v1" as const

export type ReplayArtifactStoragePolicyVersion =
  | typeof REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
  | typeof REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION
