import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"
import type { Database } from "bun:sqlite"
import {
  canonicalJson,
} from "../../modules/contracts/runtime-core/src/canonical-json"
import {
  readStrategySourceAdoptionReadonly,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/strategy-source-adoption-store"
import {
  CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
  createCertifiedStrategySourceBinding,
  type CertifiedStrategySourceBinding,
} from "../../modules/research-strategy-development/research-control-plane/contracts/src/lib/certified-strategy-source-binding"
import {
  assertStrategySourceCandidate,
  type StrategySourceCandidate,
} from "../../modules/research-strategy-development/research-control-plane/contracts/src/lib/strategy-source-candidate-contract"
import {
  admitCertifiedStrategySourceForForward,
} from "../../modules/research-strategy-development/research-control-plane/state-store/src/lib/forward-source-admission"
import {
  assertCertifiedStrategySourceAdoptionPackage,
  readCertifiedStrategySourceAdoptionManifest,
} from "./rd-strategy-source-adoption"

export function admitCertifiedStrategyAdoptionToForward(input: {
  research_db: Database
  ops_db: Database
  repository_root: string
  adoption_id: string
  admitted_at?: string
}): CertifiedStrategySourceBinding {
  const root = realpathSync(resolve(input.repository_root))
  const adoption = readStrategySourceAdoptionReadonly(
    input.ops_db,
    input.adoption_id,
  )
  if (!adoption
      || adoption.status !== "candidate_certified"
      || !adoption.result) {
    throw new Error(
      "Forward source bridge requires a certified Ops adoption result",
    )
  }
  const candidatePath = safeRepoFile(
    root,
    adoption.source_candidate_manifest_ref,
    "Strategy source candidate manifest",
  )
  const candidate = JSON.parse(
    readFileSync(candidatePath, "utf8"),
  ) as StrategySourceCandidate
  assertStrategySourceCandidate(candidate)
  if (candidate.manifest_hash
        !== adoption.source_candidate_manifest_hash
      || candidate.source_provenance.source_revision
        !== adoption.source_revision
      || candidate.strategy_source.ref !== adoption.strategy_source_ref
      || candidate.strategy_source.sha256 !== adoption.strategy_source_hash) {
    throw new Error("certified Ops adoption drifted from source candidate")
  }
  const candidateSourcePath = resolve(
    dirname(candidatePath),
    candidate.strategy_source.ref,
  )
  assertInside(dirname(candidatePath), candidateSourcePath)
  assertExactFile(
    candidateSourcePath,
    candidate.strategy_source.sha256,
    candidate.strategy_source.bytes,
    "Strategy source candidate",
  )

  const result = adoption.result
  const certifiedPath = safeRepoFile(
    root,
    result.certified_manifest_ref,
    "Strategy source adoption manifest",
  )
  const certified = readCertifiedStrategySourceAdoptionManifest(
    certifiedPath,
  )
  assertCertifiedStrategySourceAdoptionPackage(root, certified)
  if (canonicalJson({
    adoption_id: certified.adoption_id,
    candidate_hash: certified.source_candidate.manifest_hash,
    candidate_revision: certified.source_candidate.source_revision,
    candidate_source_revision: certified.candidate_source_revision,
    strategy_ref: certified.adopted_strategy.ref,
    manifest_hash: certified.manifest_hash,
    archive_ref: certified.source_archive.ref,
    archive_hash: certified.source_archive.sha256,
    certified_at: certified.certified_at,
  }) !== canonicalJson({
    adoption_id: result.adoption_id,
    candidate_hash: result.source_candidate_manifest_hash,
    candidate_revision: result.base_source_revision,
    candidate_source_revision: result.candidate_source_revision,
    strategy_ref: result.adopted_strategy_ref,
    manifest_hash: result.certified_manifest_hash,
    archive_ref: result.source_archive_ref,
    archive_hash: result.source_archive_hash,
    certified_at: result.certified_at,
  })) {
    throw new Error(
      "certified Strategy adoption manifest drifted from Ops result",
    )
  }
  if (certified.source_candidate.manifest_ref
        !== adoption.source_candidate_manifest_ref
      || certified.source_candidate.manifest_hash
        !== candidate.manifest_hash
      || certified.source_candidate.replay_build_artifact_hash
        !== candidate.replay_code_evidence
          .decision_harness_build_artifact_hash
      || certified.source_candidate.replay_runtime_executable_hash
        !== candidate.replay_code_evidence
          .decision_harness_runtime_executable_hash
      || certified.adopted_strategy.ref !== candidate.strategy_source.ref
      || certified.adopted_strategy.sha256
        !== candidate.strategy_source.sha256
      || certified.adopted_strategy.bytes !== candidate.strategy_source.bytes) {
    throw new Error(
      "certified Strategy adoption provenance drifted from candidate",
    )
  }
  const decision = input.research_db.query(`
    SELECT experiment_id FROM rd_review_decision
    WHERE decision_id=$decision_id AND decision='accept_for_draft'
  `).get({
    $decision_id: candidate.decision.decision_id,
  }) as { experiment_id: string } | null
  if (!decision) {
    throw new Error(
      "Forward source bridge cannot resolve accepted Research decision",
    )
  }
  const admittedAt = utc(
    input.admitted_at ?? new Date().toISOString(),
    "admitted_at",
  )
  if (Date.parse(admittedAt) < Date.parse(certified.certified_at)) {
    throw new Error("Forward source admission cannot predate certification")
  }
  const binding = createCertifiedStrategySourceBinding({
    schema_version: CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
    admission_id: `forward-source:${candidate.manifest_hash.slice(0, 48)}`,
    experiment_id: decision.experiment_id,
    decision_id: candidate.decision.decision_id,
    draft_id: candidate.decision.draft_id,
    strategy_id: candidate.decision.strategy_id,
    strategy_version: candidate.decision.strategy_version,
    strategy_source_ref: candidate.strategy_source.ref,
    strategy_source_hash: candidate.strategy_source.sha256,
    source_candidate_manifest_ref:
      adoption.source_candidate_manifest_ref,
    source_candidate_manifest_hash: candidate.manifest_hash,
    source_adoption_id: adoption.adoption_id,
    source_adoption_manifest_ref: result.certified_manifest_ref,
    source_adoption_manifest_hash: result.certified_manifest_hash,
    candidate_source_revision: result.candidate_source_revision,
    source_archive_ref: result.source_archive_ref,
    source_archive_hash: result.source_archive_hash,
    historical_replay_build_artifact_hash:
      candidate.replay_code_evidence
        .decision_harness_build_artifact_hash,
    historical_replay_runtime_executable_hash:
      candidate.replay_code_evidence
        .decision_harness_runtime_executable_hash,
    certified_at: result.certified_at,
    authority: {
      forward_evidence_authority: "source_binding_only",
      deployment_authority: "none",
      trading_authority: false,
    },
  })
  return admitCertifiedStrategySourceForForward(input.research_db, {
    binding,
    admitted_at: admittedAt,
  })
}

function safeRepoFile(root: string, ref: string, label: string): string {
  const path = resolve(root, ref)
  assertInside(root, path)
  if (!existsSync(path)) throw new Error(`${label} is missing`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`)
  }
  return path
}

function assertExactFile(
  path: string,
  expectedHash: string,
  expectedBytes: number,
  label: string,
): void {
  if (!existsSync(path)) throw new Error(`${label} is missing`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()
      || statSync(path).size !== expectedBytes
      || sha256(readFileSync(path)) !== expectedHash) {
    throw new Error(`${label} bytes drifted`)
  }
}

function assertInside(root: string, path: string): void {
  const base = resolve(root)
  const target = resolve(path)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error("Forward source artifact escaped repository root")
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
