import { createHash } from "node:crypto"
import type { ReplayPortfolioReallocationReservationSnapshot } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayIntegratedPortfolioOutcome } from "../../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationPlan, ReplayPortfolioAllocationResult } from "../../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES,
  assertReplayPortfolioReallocationArtifactManifest,
  replayPortfolioReallocationArtifactManifestHash,
  type ReplayPortfolioReallocationArtifactManifest,
  type ReplayPortfolioReallocationArtifactRole,
  type ReplayPortfolioReallocationPlan,
  type ReplayPortfolioReallocationResult,
} from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import { canonicalHash, canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace, type ReplayArtifactStore } from "../../../../runner/src/lib/replay-artifact-store"

const MANIFEST = "portfolio-reallocation-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioReallocationArtifactRole, string> = {
  reallocation_plan: "reallocation-plan.json",
  reallocation_reservation: "reallocation-reservation.json",
  predecessor_integrated_result: "predecessor-integrated-result.json",
  predecessor_artifact_manifest: "predecessor-artifact-manifest.json",
  cycle_2_allocation_plan: "cycle-2-allocation-plan.json",
  cycle_2_allocation_result: "cycle-2-allocation-result.json",
  reallocation_result: "reallocation-result.json",
}

export interface ReplayPortfolioReallocationArtifactPublishInput {
  plan: ReplayPortfolioReallocationPlan
  reservation: ReplayPortfolioReallocationReservationSnapshot
  predecessor: ReplayIntegratedPortfolioOutcome
  allocation_plan: ReplayPortfolioAllocationPlan
  allocation_result: ReplayPortfolioAllocationResult
  result: ReplayPortfolioReallocationResult
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioReallocationArtifact(
  input: ReplayPortfolioReallocationArtifactPublishInput,
): { manifest: ReplayPortfolioReallocationArtifactManifest; idempotent_replay: boolean } {
  const predecessorResult = input.predecessor.result
  const predecessorManifest = input.predecessor.artifact?.artifact_manifest
  if (!predecessorResult || !predecessorManifest) throw new Error("predecessor evidence is incomplete")
  const values: Record<ReplayPortfolioReallocationArtifactRole, unknown> = {
    reallocation_plan: input.plan,
    reallocation_reservation: input.reservation,
    predecessor_integrated_result: predecessorResult,
    predecessor_artifact_manifest: predecessorManifest,
    cycle_2_allocation_plan: input.allocation_plan,
    cycle_2_allocation_result: input.allocation_result,
    reallocation_result: input.result,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ reallocation_plan_hash: input.plan.plan_hash }),
    attempt_id_hash: input.result.result_hash,
  })
  if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, input, values), idempotent_replay: true }
  const files = REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]
    return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioReallocationArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-reallocation:${input.result.result_hash}`,
    portfolio_id: input.plan.portfolio_id,
    reallocation_result_hash: input.result.result_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.reservation.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioReallocationArtifactManifestHash(body as ReplayPortfolioReallocationArtifactManifest) }
  assertReplayPortfolioReallocationArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  input: ReplayPortfolioReallocationArtifactPublishInput,
  values: Record<ReplayPortfolioReallocationArtifactRole, unknown>,
): ReplayPortfolioReallocationArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as ReplayPortfolioReallocationArtifactManifest
  assertReplayPortfolioReallocationArtifactManifest(manifest)
  if (manifest.reallocation_result_hash !== input.result.result_hash) throw new Error("reallocation manifest identity drift")
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("reallocation artifact payload binding mismatch")
    }
  }
  return manifest
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
