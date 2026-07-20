import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioFixedPartialTerminalArtifactManifest,
  assertReplayPortfolioFixedPartialTerminalEvidence,
  assertReplayPortfolioFixedPartialTerminalOutcome,
  replayPortfolioFixedPartialTerminalArtifactManifestHash,
  replayPortfolioFixedPartialTerminalOutcomeHash,
  type ReplayPortfolioFixedPartialTerminalArtifactManifest,
  type ReplayPortfolioFixedPartialTerminalArtifactRole,
  type ReplayPortfolioFixedPartialTerminalEvidence,
  type ReplayPortfolioFixedPartialTerminalOutcome,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-terminal-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  executeReplayPortfolioFixedPartialTerminal,
  type ReplayPortfolioFixedPartialTerminalLane,
} from "../../../engine/src/lib/replay-portfolio-fixed-partial-terminal-engine"
import { runReplayIntegratedPortfolio } from "./replay-integrated-portfolio-runner"
import { readReplayIntegratedPortfolioArtifactEvidence } from
  "./replay-portfolio-mark-risk-revaluation-runner"
import { runReplayPortfolioProtectiveTerminal, type ReplayPortfolioProtectiveTerminalRunInput } from
  "./replay-portfolio-protective-terminal-runner"
import { runReplayTrial } from "./replay-trial-runner"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace } from "./replay-artifact-store"

const MANIFEST = "portfolio-fixed-partial-terminal-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioFixedPartialTerminalArtifactRole, string> = {
  source_protective_terminal_artifact_manifest: "source-protective-terminal-artifact-manifest.json",
  source_protective_terminal_evidence: "source-protective-terminal-evidence.json",
  lane_result_artifact_manifests: "lane-result-artifact-manifests.json",
  lane_results: "lane-results.json", fixed_partial_terminal_records: "fixed-partial-terminal-records.json",
  fixed_partial_terminal_fingerprint: "fixed-partial-terminal-fingerprint.json",
  fixed_partial_terminal_evidence: "fixed-partial-terminal-evidence.json",
}

export interface ReplayPortfolioFixedPartialTerminalRunInput extends ReplayPortfolioProtectiveTerminalRunInput {
  execute_fixed_partial_terminal?: typeof executeReplayPortfolioFixedPartialTerminal
  execute_lane_replay?: typeof runReplayTrial
}

export function runReplayPortfolioFixedPartialTerminal(
  input: ReplayPortfolioFixedPartialTerminalRunInput,
): ReplayPortfolioFixedPartialTerminalOutcome {
  const projected = { ...input, allow_predeclared_fixed_partial_reduce_projection: true as const }
  const source = runReplayPortfolioProtectiveTerminal(projected)
  if (!source.evidence || !source.artifact_manifest) {
    return failed(input, "source-terminal-failed", source.failure?.message ?? "source terminal failed")
  }
  const integrated = runReplayIntegratedPortfolio(projected)
  if (!integrated.result || !integrated.risk_result || !integrated.artifact?.artifact_manifest) {
    return failed(input, "source-terminal-failed", integrated.failure?.message ?? "integrated source failed")
  }
  let allocationResult
  try {
    allocationResult = readReplayIntegratedPortfolioArtifactEvidence(
      input, integrated.result, integrated.artifact.artifact_manifest,
    ).allocation_result
  } catch (error) { return failed(input, "source-terminal-failed", error) }
  let lanes: ReplayPortfolioFixedPartialTerminalLane[]
  let laneResults: NonNullable<ReplayPortfolioFixedPartialTerminalOutcome["lane_results"]>
  try {
    const decisions = allocationResult.allocation_cycles.flatMap((cycle) => cycle.decisions)
    const decisionByLane = new Map<string, (typeof decisions)[number]>(
      decisions.map((item) => [item.lane_id, item]),
    )
    const priorityByLane = new Map(input.risk_reservation.lanes.map((item) => [item.lane_id, item.priority_rank]))
    laneResults = []
    lanes = input.lanes.map(({ lane_id: laneId, trial }) => {
      const decision = decisionByLane.get(laneId); const priority = priorityByLane.get(laneId)
      if (!decision || !priority) throw new Error(`Fixed-partial Lane ${laneId} source missing`)
      const entries = trial.request.decision_schedule.entries
      const partials = entries.filter((entry) => entry.expected_effect === "authorized_partial_reduce")
      if (partials.length > 1 || entries.some((entry) => ![
        "authorized_initial_order", "authorized_partial_reduce", "authorized_reduce_only_exit", "no_action",
      ].includes(entry.expected_effect))) throw new Error(`Fixed-partial Lane ${laneId} exceeds bounded schedule`)
      const partialIntent = partials[0]?.authorized_partial_reduce ?? null
      if (partials[0] && (!partialIntent || partials[0].authorized_order_hash !== canonicalHash(partialIntent))) {
        throw new Error(`Fixed-partial Lane ${laneId} intent authority drift`)
      }
      let replay: ReplayPortfolioFixedPartialTerminalLane["replay"] = null
      if (decision.allocation === "admitted") {
        const outcome = (input.execute_lane_replay ?? runReplayTrial)({ ...trial, artifact_store: input.artifact_store })
        if (outcome.status !== "completed" || !outcome.result || !outcome.artifact_manifest) {
          throw new Error(outcome.failure?.message ?? `Fixed-partial Lane ${laneId} Replay failed`)
        }
        replay = { result: outcome.result, artifact_manifest: outcome.artifact_manifest }
        laneResults.push({ lane_id: laneId, ...replay })
      }
      const accounting = trial.dataset_manifest.instrument.accounting
      return { lane_id: laneId, priority_rank: priority, request_hash: canonicalHash(trial.request),
        fee_bps: trial.request.cost_policy.fee_bps, slippage_bps: trial.request.cost_policy.slippage_bps,
        price_increment: accounting.price_increment, settlement_increment: accounting.settlement_increment,
        partial_intent: partialIntent ? structuredClone(partialIntent) : null,
        partial_intent_hash: partialIntent ? canonicalHash(partialIntent) : null, replay }
    }).sort((a, b) => a.lane_id.localeCompare(b.lane_id))
    laneResults.sort((a, b) => a.lane_id.localeCompare(b.lane_id))
  } catch (error) { return failed(input, "lane-replay-failed", error) }
  let evidence
  try {
    evidence = (input.execute_fixed_partial_terminal ?? executeReplayPortfolioFixedPartialTerminal)({
      source_evidence: source.evidence, source_manifest: source.artifact_manifest,
      allocation_result: allocationResult, risk_result: integrated.risk_result, lanes,
    })
  } catch (error) { return failed(input, "partial-terminal-engine-failed", error) }
  try {
    const published = publishReplayPortfolioFixedPartialTerminalArtifact({
      source_evidence: source.evidence, source_manifest: source.artifact_manifest,
      lane_results: laneResults, evidence, authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioFixedPartialTerminalOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id, status: "completed", evidence,
      artifact_manifest: published.manifest, lane_results: laneResults,
      idempotent_replay: source.idempotent_replay && published.idempotent_replay, failure: null,
    }
    const outcome = { ...body, outcome_hash: replayPortfolioFixedPartialTerminalOutcomeHash(body) }
    assertReplayPortfolioFixedPartialTerminalOutcome(outcome); return outcome
  } catch (error) { return failed(input, "partial-terminal-artifact-failed", error) }
}

export function publishReplayPortfolioFixedPartialTerminalArtifact(input: {
  source_evidence: NonNullable<ReturnType<typeof runReplayPortfolioProtectiveTerminal>["evidence"]>
  source_manifest: NonNullable<ReturnType<typeof runReplayPortfolioProtectiveTerminal>["artifact_manifest"]>
  lane_results: NonNullable<ReplayPortfolioFixedPartialTerminalOutcome["lane_results"]>
  evidence: ReplayPortfolioFixedPartialTerminalEvidence
  authority_frozen_at: string
  artifact_store: ReplayPortfolioFixedPartialTerminalRunInput["artifact_store"]
}) {
  assertReplayPortfolioFixedPartialTerminalEvidence(input.evidence)
  const values: Record<ReplayPortfolioFixedPartialTerminalArtifactRole, unknown> = {
    source_protective_terminal_artifact_manifest: input.source_manifest,
    source_protective_terminal_evidence: input.source_evidence,
    lane_result_artifact_manifests: input.lane_results.map((item) => ({ lane_id: item.lane_id,
      artifact_manifest: item.artifact_manifest })),
    lane_results: input.lane_results.map((item) => ({ lane_id: item.lane_id, result: item.result })),
    fixed_partial_terminal_records: input.evidence.lane_records,
    fixed_partial_terminal_fingerprint: input.evidence.fingerprint,
    fixed_partial_terminal_evidence: input.evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({ idempotency_key_hash: canonicalHash({
    source: input.source_evidence.evidence_hash, policy: input.evidence.policy_version,
  }), attempt_id_hash: input.evidence.evidence_hash })
  if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, input.evidence, values), idempotent_replay: true }
  const files = REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]; return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioFixedPartialTerminalArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-fixed-partial-terminal:${input.evidence.fingerprint.fingerprint_hash}`,
    portfolio_id: input.evidence.portfolio_id, evidence_hash: input.evidence.evidence_hash,
    fingerprint_hash: input.evidence.fingerprint.fingerprint_hash,
    source_protective_terminal_evidence_hash: input.source_evidence.evidence_hash, files,
    completeness: { authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_ARTIFACT_ROLES, commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false }, authority_frozen_at: input.authority_frozen_at,
  }
  const manifest = { ...body, manifest_hash: replayPortfolioFixedPartialTerminalArtifactManifestHash(body) }
  assertReplayPortfolioFixedPartialTerminalArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest)); return { manifest, idempotent_replay: false }
}
function readCommitted(namespace: ReplayArtifactNamespace, evidence: ReplayPortfolioFixedPartialTerminalEvidence,
  values: Record<ReplayPortfolioFixedPartialTerminalArtifactRole, unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioFixedPartialTerminalArtifactManifest
  assertReplayPortfolioFixedPartialTerminalArtifactManifest(manifest)
  if (manifest.evidence_hash !== evidence.evidence_hash || manifest.fingerprint_hash !== evidence.fingerprint.fingerprint_hash) {
    throw new Error("Fixed-partial committed manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("Fixed-partial committed payload drift")
    }
  }
  return manifest
}
function failed(input: ReplayPortfolioFixedPartialTerminalRunInput,
  code: NonNullable<ReplayPortfolioFixedPartialTerminalOutcome["failure"]>["code"], error: unknown) {
  const body: Omit<ReplayPortfolioFixedPartialTerminalOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_TERMINAL_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id, status: "failed", evidence: null,
    artifact_manifest: null, lane_results: null, idempotent_replay: false,
    failure: { code, message: error instanceof Error ? error.message : String(error), partial_result_published: false },
  }
  const outcome = { ...body, outcome_hash: replayPortfolioFixedPartialTerminalOutcomeHash(body) }
  assertReplayPortfolioFixedPartialTerminalOutcome(outcome); return outcome
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
