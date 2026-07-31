import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash,
  type ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
  type ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole,
  type ReplayPortfolioPostPartialStopReplacementAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-accounting-contracts"
import {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence,
  type ReplayPortfolioPostPartialStopReplacementRiskEvidence,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-risk-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  createReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  type ReplayPortfolioPostPartialStopReplacementAccountingLane,
} from "../../../accounting/src/lib/replay-portfolio-post-partial-stop-replacement-accounting"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

const MANIFEST = "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole, string> = {
  lane_result_artifact_manifests: "lane-result-artifact-manifests.json",
  lane_results: "lane-results.json",
  risk_evidence: "risk-evidence.json",
  lane_owner_bindings: "lane-owner-bindings.json",
  ledger: "ledger.json",
  journal: "journal.json",
  trial_balance: "trial-balance.json",
  accounting_evidence: "accounting-evidence.json",
}

export interface ReplayPortfolioPostPartialStopReplacementAccountingRunInput {
  risk_evidence: ReplayPortfolioPostPartialStopReplacementRiskEvidence
  lanes: ReplayPortfolioPostPartialStopReplacementAccountingLane[]
  artifact_store: ReplayArtifactStore
}

export interface ReplayPortfolioPostPartialStopReplacementAccountingOutcome {
  status: "completed" | "failed"
  evidence: ReplayPortfolioPostPartialStopReplacementAccountingEvidence | null
  artifact_manifest: ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest | null
  idempotent_replay: boolean
  failure: {
    code: "accounting-projection-failed" | "artifact-publication-failed"
    message: string
    partial_portfolio_result_published: false
  } | null
}

export function runReplayPortfolioPostPartialStopReplacementAccounting(
  input: ReplayPortfolioPostPartialStopReplacementAccountingRunInput,
): ReplayPortfolioPostPartialStopReplacementAccountingOutcome {
  let evidence: ReplayPortfolioPostPartialStopReplacementAccountingEvidence
  try {
    evidence = createReplayPortfolioPostPartialStopReplacementAccountingEvidence({
      risk_evidence: input.risk_evidence,
      lanes: input.lanes,
    })
  } catch (error) {
    return failed("accounting-projection-failed", error)
  }
  try {
    const published = publishReplayPortfolioPostPartialStopReplacementAccountingArtifact({
      risk_evidence: input.risk_evidence,
      lanes: input.lanes,
      evidence,
      artifact_store: input.artifact_store,
    })
    return {
      status: "completed",
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: published.idempotent_replay,
      failure: null,
    }
  } catch (error) {
    return failed("artifact-publication-failed", error)
  }
}

export function publishReplayPortfolioPostPartialStopReplacementAccountingArtifact(input: {
  risk_evidence: ReplayPortfolioPostPartialStopReplacementRiskEvidence
  lanes: ReplayPortfolioPostPartialStopReplacementAccountingLane[]
  evidence: ReplayPortfolioPostPartialStopReplacementAccountingEvidence
  artifact_store: ReplayArtifactStore
}): {
  manifest: ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest
  idempotent_replay: boolean
} {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence(input.risk_evidence)
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(input.evidence)
  if (input.evidence.portfolio_id !== input.risk_evidence.portfolio_id
      || input.evidence.source_risk_evidence_hash !== input.risk_evidence.evidence_hash
      || input.evidence.source_lane_bindings_hash !== input.risk_evidence.source_lane_bindings_hash) {
    throw new Error("Portfolio post-partial stop-replacement Artifact source closure drift")
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const lanes = [...input.lanes].sort((left, right) => left.lane_id.localeCompare(right.lane_id))
  const laneResultArtifactManifests = lanes.map((lane) => ({
    lane_id: lane.lane_id,
    artifact_manifest: lane.artifact_manifest,
  }))
  const laneResults = lanes.map((lane) => ({ lane_id: lane.lane_id, result: lane.result }))
  const values: Record<ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole, unknown> = {
    lane_result_artifact_manifests: laneResultArtifactManifests,
    lane_results: laneResults,
    risk_evidence: input.risk_evidence,
    lane_owner_bindings: input.evidence.lane_owner_bindings,
    ledger: input.evidence.ledger,
    journal: input.evidence.journal,
    trial_balance: input.evidence.trial_balance,
    accounting_evidence: input.evidence,
  }
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      source_risk_evidence_hash: input.risk_evidence.evidence_hash,
      source_lane_bindings_hash: input.risk_evidence.source_lane_bindings_hash,
      accounting_policy_version: input.evidence.accounting_policy_version,
    }),
    attempt_id_hash: input.evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input.evidence, values), idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES.map(
    (role) => {
      const name = NAMES[role]
      return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
    },
  )
  const body: Omit<ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest, "manifest_hash"> = {
    schema_version:
      REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id:
      `replay-portfolio-post-partial-stop-replacement-accounting:${input.evidence.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id,
    source_risk_evidence_hash: input.risk_evidence.evidence_hash,
    source_lane_bindings_hash: input.risk_evidence.source_lane_bindings_hash,
    accounting_evidence_hash: input.evidence.evidence_hash,
    lane_owner_bindings_hash: input.evidence.lane_owner_bindings_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_ACCOUNTING_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
  }
  const manifest = {
    ...body,
    manifest_hash: replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash(body),
  }
  assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  evidence: ReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  values: Record<ReplayPortfolioPostPartialStopReplacementAccountingArtifactRole, unknown>,
): ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest
  assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest(manifest)
  if (manifest.artifact_id
        !== `replay-portfolio-post-partial-stop-replacement-accounting:${evidence.fingerprint_hash}`
      || manifest.portfolio_id !== evidence.portfolio_id
      || manifest.source_risk_evidence_hash !== evidence.source_risk_evidence_hash
      || manifest.source_lane_bindings_hash !== evidence.source_lane_bindings_hash
      || manifest.accounting_evidence_hash !== evidence.evidence_hash
      || manifest.lane_owner_bindings_hash !== evidence.lane_owner_bindings_hash) {
    throw new Error("Portfolio post-partial stop-replacement committed manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || read.ref !== file.ref || sha256(read.bytes) !== file.sha256
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes)))
          !== canonicalHash(values[file.role])) {
      throw new Error("Portfolio post-partial stop-replacement committed payload drift")
    }
  }
  return manifest
}

function failed(
  code: NonNullable<ReplayPortfolioPostPartialStopReplacementAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioPostPartialStopReplacementAccountingOutcome {
  return {
    status: "failed",
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_portfolio_result_published: false,
    },
  }
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
