import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioCycleSequenceAccountingArtifactManifest,
  replayPortfolioCycleSequenceAccountingEvidenceHash,
  replayPortfolioCycleSequenceAccountingFingerprintHash,
  replayPortfolioCycleSequenceTrialBalanceHash,
  type ReplayPortfolioCycleSequenceAccountingArtifactManifest,
  type ReplayPortfolioCycleSequenceAccountingEvidence,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import {
  REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES,
  REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS,
  REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION,
  assertReplayPortfolioReallocationArtifactManifest,
  replayPortfolioReallocationResultHash,
  type ReplayPortfolioReallocationArtifactManifest,
  type ReplayPortfolioReallocationResult,
} from "../../../../contracts/src/lib/replay-portfolio-reallocation-contracts"
import {
  REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES,
  REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS,
  REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION,
  assertReplayTwoCyclePortfolioArtifactManifest,
  replayTwoCyclePortfolioFingerprintHash,
  replayTwoCyclePortfolioResultHash,
  type ReplayTwoCyclePortfolioArtifactManifest,
  type ReplayTwoCyclePortfolioFingerprint,
  type ReplayTwoCyclePortfolioResult,
} from "../../../../contracts/src/lib/replay-two-cycle-portfolio-contracts"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"
import type {
  ReplayArtifactDiscoveryStore,
  ReplayArtifactNamespace,
} from "../../../../runner/src/lib/replay-artifact-store"

export const REPLAY_HISTORICAL_ARTIFACT_MIGRATION_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-historical-artifact-migration-receipt.v1" as const

export type ReplayHistoricalArtifactMilestone = "M4-P10" | "M4-P11" | "M4-P13"

export interface ReplayHistoricalArtifactMigrationEntry {
  milestone: ReplayHistoricalArtifactMilestone
  source_schema_version: string
  source_manifest_hash: string
  source_primary_hash: string
  portfolio_id: string
  historical_shape: "fixed-second-allocation" | "fixed-two-cycle" | "bounded-sequence-consolidated-accounting"
  summary: Record<string, string | number | boolean>
}

export interface ReplayHistoricalArtifactMigrationReceipt {
  schema_version: typeof REPLAY_HISTORICAL_ARTIFACT_MIGRATION_RECEIPT_SCHEMA_VERSION
  migration_policy: "read-only-summary-no-writer-no-authority-rewrite"
  source_artifact_count: number
  entries: ReplayHistoricalArtifactMigrationEntry[]
  limitations: [
    "historical-p10-p11-p13-only",
    "opaque-source-payloads-are-integrity-checked-not-promoted-to-current-authority",
    "no-historical-writer-reactivation-or-canonical-runtime-import",
  ]
  receipt_hash: string
}

const SPECS = [
  {
    milestone: "M4-P10" as const,
    manifestName: "portfolio-reallocation-artifact-manifest.json",
    names: [
      "reallocation-plan.json", "reallocation-reservation.json", "predecessor-integrated-result.json",
      "predecessor-artifact-manifest.json", "cycle-2-allocation-plan.json",
      "cycle-2-allocation-result.json", "reallocation-result.json",
    ],
  },
  {
    milestone: "M4-P11" as const,
    manifestName: "two-cycle-portfolio-artifact-manifest.json",
    names: [
      "two-cycle-plan.json", "cycle-1-integrated-result.json", "cycle-1-artifact-manifest.json",
      "cycle-2-reallocation-result.json", "cycle-2-reallocation-manifest.json",
      "cycle-2-allocation-plan.json", "cycle-2-allocation-result.json", "cycle-2-risk-plan.json",
      "cycle-2-risk-reservation.json", "cycle-2-risk-result.json", "cycle-2-portfolio-evidence.json",
      "two-cycle-state-chain.json", "two-cycle-fingerprint.json", "two-cycle-result.json",
    ],
  },
  {
    milestone: "M4-P13" as const,
    manifestName: "portfolio-cycle-sequence-accounting-artifact-manifest.json",
    names: [
      "sequence-result.json", "sequence-artifact-manifest.json", "cycle-accounting-evidence.json",
      "consolidated-ledger.json", "consolidated-journal.json", "consolidated-trial-balance.json",
      "consolidated-fingerprint.json", "consolidated-accounting-evidence.json",
    ],
  },
] as const

export function readReplayHistoricalArtifactMigration(
  store: ReplayArtifactDiscoveryStore,
  requiredMilestones: readonly ReplayHistoricalArtifactMilestone[],
): ReplayHistoricalArtifactMigrationReceipt {
  const required = [...requiredMilestones].sort()
  if (required.length === 0 || new Set(required).size !== required.length
      || required.some((milestone) => !SPECS.some((spec) => spec.milestone === milestone))) {
    throw new Error("Replay historical Artifact migration milestone scope is invalid")
  }
  const namespaces = store.discoverAttemptNamespaces()
  const entries = required.map((milestone) => {
    const spec = SPECS.find((candidate) => candidate.milestone === milestone)!
    const matches = namespaces.filter((namespace) => namespace.exists(spec.manifestName))
    if (matches.length !== 1) {
      throw new Error(`Replay historical Artifact must resolve exactly once: ${milestone}`)
    }
    return readEntry(matches[0]!, spec)
  })
  const body = {
    schema_version: REPLAY_HISTORICAL_ARTIFACT_MIGRATION_RECEIPT_SCHEMA_VERSION,
    migration_policy: "read-only-summary-no-writer-no-authority-rewrite" as const,
    source_artifact_count: entries.length,
    entries,
    limitations: [
      "historical-p10-p11-p13-only",
      "opaque-source-payloads-are-integrity-checked-not-promoted-to-current-authority",
      "no-historical-writer-reactivation-or-canonical-runtime-import",
    ] as ReplayHistoricalArtifactMigrationReceipt["limitations"],
  }
  return { ...body, receipt_hash: canonicalHash(body) }
}

function readEntry(
  namespace: ReplayArtifactNamespace,
  spec: typeof SPECS[number],
): ReplayHistoricalArtifactMigrationEntry {
  const manifestRead = namespace.read(spec.manifestName)
  const manifest = JSON.parse(new TextDecoder().decode(manifestRead.bytes)) as
    | ReplayPortfolioReallocationArtifactManifest
    | ReplayTwoCyclePortfolioArtifactManifest
    | ReplayPortfolioCycleSequenceAccountingArtifactManifest
  assertManifest(spec.milestone, manifest)
  const expectedNames = [...spec.names, spec.manifestName].sort()
  if (JSON.stringify(namespace.listNames()) !== JSON.stringify(expectedNames)
      || manifest.files.length !== spec.names.length) {
    throw new Error(`Replay historical Artifact file set drifted: ${spec.milestone}`)
  }
  const payloads = new Map<string, unknown>()
  manifest.files.forEach((file, index) => {
    const read = namespace.read(file.name)
    if (file.name !== spec.names[index] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error(`Replay historical Artifact payload binding drifted: ${spec.milestone}`)
    }
    payloads.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  })
  if (spec.milestone === "M4-P10") return readP10(manifest as ReplayPortfolioReallocationArtifactManifest, payloads)
  if (spec.milestone === "M4-P11") return readP11(manifest as ReplayTwoCyclePortfolioArtifactManifest, payloads)
  return readP13(manifest as ReplayPortfolioCycleSequenceAccountingArtifactManifest, payloads)
}

function readP10(
  manifest: ReplayPortfolioReallocationArtifactManifest,
  payloads: Map<string, unknown>,
): ReplayHistoricalArtifactMigrationEntry {
  const result = payloads.get("reallocation_result") as ReplayPortfolioReallocationResult
  if (result.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_RESULT_SCHEMA_VERSION
      || result.result_hash !== replayPortfolioReallocationResultHash(result)
      || result.result_hash !== manifest.reallocation_result_hash
      || result.portfolio_id !== manifest.portfolio_id
      || JSON.stringify(result.limitations) !== JSON.stringify(REPLAY_PORTFOLIO_REALLOCATION_LIMITATIONS)) {
    throw new Error("Replay historical P10 Result drifted")
  }
  return {
    milestone: "M4-P10", source_schema_version: manifest.schema_version,
    source_manifest_hash: manifest.manifest_hash, source_primary_hash: result.result_hash,
    portfolio_id: result.portfolio_id, historical_shape: "fixed-second-allocation",
    summary: {
      reallocation_cycle: result.reallocation_cycle,
      opening_available_cash: result.opening_available_cash,
      ending_available_cash: result.ending_available_cash,
      ending_gross_exposure: result.ending_gross_exposure,
      ending_net_exposure: result.ending_net_exposure,
      ending_portfolio_risk: result.ending_portfolio_risk,
    },
  }
}

function readP11(
  manifest: ReplayTwoCyclePortfolioArtifactManifest,
  payloads: Map<string, unknown>,
): ReplayHistoricalArtifactMigrationEntry {
  const result = payloads.get("two_cycle_result") as ReplayTwoCyclePortfolioResult
  const fingerprint = payloads.get("two_cycle_fingerprint") as ReplayTwoCyclePortfolioFingerprint
  if (result.schema_version !== REPLAY_TWO_CYCLE_PORTFOLIO_RESULT_SCHEMA_VERSION
      || result.result_hash !== replayTwoCyclePortfolioResultHash(result)
      || result.state_chain_hash !== canonicalHash(result.state_chain)
      || result.result_hash !== manifest.two_cycle_result_hash
      || result.portfolio_id !== manifest.portfolio_id
      || JSON.stringify(result.limitations) !== JSON.stringify(REPLAY_TWO_CYCLE_PORTFOLIO_LIMITATIONS)
      || fingerprint.fingerprint_hash !== replayTwoCyclePortfolioFingerprintHash(fingerprint)
      || fingerprint.fingerprint_hash !== manifest.fingerprint_hash
      || fingerprint.two_cycle_result_hash !== result.result_hash) {
    throw new Error("Replay historical P11 Result/Fingerprint drifted")
  }
  return {
    milestone: "M4-P11", source_schema_version: manifest.schema_version,
    source_manifest_hash: manifest.manifest_hash, source_primary_hash: result.result_hash,
    portfolio_id: result.portfolio_id, historical_shape: "fixed-two-cycle",
    summary: {
      cycle_count: 2,
      cycle_1_ending_available_cash: result.cycle_1_ending_available_cash,
      cycle_2_opening_available_cash: result.cycle_2_opening_available_cash,
      ending_available_cash: result.ending_available_cash,
      ending_gross_exposure: result.ending_gross_exposure,
      ending_net_exposure: result.ending_net_exposure,
      ending_portfolio_risk: result.ending_portfolio_risk,
    },
  }
}

function readP13(
  manifest: ReplayPortfolioCycleSequenceAccountingArtifactManifest,
  payloads: Map<string, unknown>,
): ReplayHistoricalArtifactMigrationEntry {
  const evidence = payloads.get("consolidated_accounting_evidence") as
    ReplayPortfolioCycleSequenceAccountingEvidence
  const balance = evidence.consolidated_trial_balance
  const openingEquityCount = evidence.consolidated_journal.filter(
    (entry) => entry.cycle_entry.posting_kind === "opening_cash",
  ).length
  if (evidence.evidence_hash !== replayPortfolioCycleSequenceAccountingEvidenceHash(evidence)
      || evidence.fingerprint.fingerprint_hash
        !== replayPortfolioCycleSequenceAccountingFingerprintHash(evidence.fingerprint)
      || balance.trial_balance_hash !== replayPortfolioCycleSequenceTrialBalanceHash(balance)
      || evidence.cycle_records.length !== evidence.cycle_count
      || evidence.cycle_accounting_evidence_hashes.length !== evidence.cycle_count
      || evidence.consolidated_ledger.some((entry, index) => entry.global_ledger_sequence !== index + 1)
      || evidence.consolidated_journal.some((entry, index) => entry.global_journal_sequence !== index + 1)
      || openingEquityCount !== 1 || balance.opening_equity_posting_count !== 1
      || balance.balanced !== true || balance.total_debits !== balance.total_credits
      || balance.ending_reserved_isolated_collateral !== 0
      || balance.ending_settled_cash !== balance.ending_available_cash
      || balance.ending_unrealized_pnl !== 0
      || balance.ending_portfolio_nav !== balance.ending_settled_cash
      || evidence.evidence_hash !== manifest.accounting_evidence_hash
      || evidence.fingerprint.fingerprint_hash !== manifest.accounting_fingerprint_hash
      || evidence.sequence_result_hash !== manifest.sequence_result_hash
      || evidence.portfolio_id !== manifest.portfolio_id) {
    throw new Error("Replay historical P13 Accounting Evidence drifted")
  }
  return {
    milestone: "M4-P13", source_schema_version: manifest.schema_version,
    source_manifest_hash: manifest.manifest_hash, source_primary_hash: evidence.evidence_hash,
    portfolio_id: evidence.portfolio_id, historical_shape: "bounded-sequence-consolidated-accounting",
    summary: {
      cycle_count: evidence.cycle_count,
      initial_cash: balance.initial_cash,
      ending_available_cash: balance.ending_available_cash,
      ending_settled_cash: balance.ending_settled_cash,
      ending_portfolio_nav: balance.ending_portfolio_nav,
      balanced: balance.balanced,
      opening_equity_posting_count: balance.opening_equity_posting_count,
    },
  }
}

function assertManifest(
  milestone: ReplayHistoricalArtifactMilestone,
  manifest: ReplayPortfolioReallocationArtifactManifest
    | ReplayTwoCyclePortfolioArtifactManifest
    | ReplayPortfolioCycleSequenceAccountingArtifactManifest,
): void {
  if (milestone === "M4-P10") {
    assertReplayPortfolioReallocationArtifactManifest(manifest as ReplayPortfolioReallocationArtifactManifest)
    if (JSON.stringify(manifest.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_REALLOCATION_ARTIFACT_ROLES)) throw new Error("Replay P10 roles drifted")
  } else if (milestone === "M4-P11") {
    assertReplayTwoCyclePortfolioArtifactManifest(manifest as ReplayTwoCyclePortfolioArtifactManifest)
    if (JSON.stringify(manifest.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_TWO_CYCLE_PORTFOLIO_ARTIFACT_ROLES)) throw new Error("Replay P11 roles drifted")
  } else {
    assertReplayPortfolioCycleSequenceAccountingArtifactManifest(
      manifest as ReplayPortfolioCycleSequenceAccountingArtifactManifest,
    )
    if (JSON.stringify(manifest.files.map((file) => file.role))
        !== JSON.stringify(REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_ARTIFACT_ROLES)) {
      throw new Error("Replay P13 roles drifted")
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
