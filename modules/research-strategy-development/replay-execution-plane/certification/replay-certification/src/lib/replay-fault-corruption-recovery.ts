import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"
import { runReplayOwnerAssertionProcess } from "./replay-owner-assertion-process"

export type ReplayFaultRecoveryClass =
  | "clean-checkpoint-or-deterministic-rerun-required"
  | "fresh-attempt-rebuild-required"
  | "aggregate-rerun-after-authoritative-children"
  | "manifest-last-identical-retry"
  | "full-profile-rerun-required"

export interface ReplayFaultCorruptionCase {
  case_id: string
  profile: string
  fault_stage: "dataset-admission" | "engine-checkpoint" | "committed-artifact-read"
    | "child-trial-execution" | "aggregate-evidence-validation" | "portfolio-execution-publication"
    | "portfolio-artifact-publication" | "terminal-cycle-execution"
  fault_kind: "frozen-input-corruption" | "checkpoint-semantic-corruption"
    | "committed-payload-corruption" | "injected-child-failure" | "rehash-semantic-tamper"
    | "injected-owner-port-failure" | "orphan-payload-interruption" | "injected-mid-sequence-failure"
  evidence_path: string
  evidence_test_name: string
  expected_detection: string
  expected_authority_outcome: "no-result-or-authoritative-manifest" | "corrupt-commit-rejected"
  recovery_class: ReplayFaultRecoveryClass
  timeout_ms: number
}

export interface ReplayFaultCorruptionRecoveryBundle {
  schema_version: "trade.rd-replay-fault-corruption-recovery-bundle.v1"
  owner: string
  scope: "frozen-owner-fault-and-corruption-assertions-for-four-public-profiles"
  authority_policy: "no-partial-result-or-manifest-authority-before-valid-commit"
  corruption_policy: "detect-before-use-never-rehash-or-silent-repair"
  recovery_policy: "retry-only-when-identical-source-and-owner-contract-permit"
  execution_policy: "sequential-fresh-bun-process-exact-frozen-owner-assertion"
  cases: ReplayFaultCorruptionCase[]
  limitations: string[]
  bundle_sha256: string
}

export interface ReplayFaultCorruptionCaseReceipt {
  case_id: string
  profile: string
  process_id: number
  fault_stage: ReplayFaultCorruptionCase["fault_stage"]
  recovery_class: ReplayFaultRecoveryClass
  assertion_hash: string
}

export interface ReplayFaultCorruptionRecoveryReceipt {
  schema_version: "trade.rd-replay-fault-corruption-recovery-receipt.v1"
  bundle_sha256: string
  runtime: { name: "bun"; version: string }
  cases: ReplayFaultCorruptionCaseReceipt[]
  limitations: string[]
  receipt_sha256: string
}

const CERTIFICATION_TEST =
  "modules/research-strategy-development/replay-execution-plane/tests/src/replay-certification.test.ts"
const ENGINE_TEST =
  "modules/research-strategy-development/replay-execution-plane/engine/src/lib/replay-reference-engine.test.ts"
const TRIAL_TEST =
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts"
const PORTFOLIO_TEST =
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts"

const EXPECTED_CASES: ReplayFaultCorruptionCase[] = [
  {
    case_id: "single-dataset-frozen-hash-corruption",
    profile: "single-trial",
    fault_stage: "dataset-admission",
    fault_kind: "frozen-input-corruption",
    evidence_path: CERTIFICATION_TEST,
    evidence_test_name: "data integrity: changing a bar without changing the frozen manifest is rejected",
    expected_detection: "dataset-hash-mismatch-before-result-publication",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "fresh-attempt-rebuild-required",
    timeout_ms: 20_000,
  },
  {
    case_id: "single-checkpoint-semantic-corruption",
    profile: "single-trial",
    fault_stage: "engine-checkpoint",
    fault_kind: "checkpoint-semantic-corruption",
    evidence_path: ENGINE_TEST,
    evidence_test_name: "checkpoint hash and source prefix fencing reject tampered resume state",
    expected_detection: "authority-state-or-source-prefix-fence-rejects-resume",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "clean-checkpoint-or-deterministic-rerun-required",
    timeout_ms: 20_000,
  },
  {
    case_id: "single-committed-artifact-corruption",
    profile: "single-trial",
    fault_stage: "committed-artifact-read",
    fault_kind: "committed-payload-corruption",
    evidence_path: TRIAL_TEST,
    evidence_test_name: "runner fences stale Attempt leases and verifies every committed artifact file",
    expected_detection: "artifact-file-hash-mismatch-on-idempotent-read",
    expected_authority_outcome: "corrupt-commit-rejected",
    recovery_class: "fresh-attempt-rebuild-required",
    timeout_ms: 25_000,
  },
  {
    case_id: "independent-child-failure",
    profile: "independent-lane-batch",
    fault_stage: "child-trial-execution",
    fault_kind: "injected-child-failure",
    evidence_path: PORTFOLIO_TEST,
    evidence_test_name: "independent lane failure is all-or-nothing and never publishes a partial batch Result",
    expected_detection: "failed-or-incomplete-child-blocks-batch-result",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "aggregate-rerun-after-authoritative-children",
    timeout_ms: 25_000,
  },
  {
    case_id: "independent-child-semantic-corruption",
    profile: "independent-lane-batch",
    fault_stage: "aggregate-evidence-validation",
    fault_kind: "rehash-semantic-tamper",
    evidence_path: PORTFOLIO_TEST,
    evidence_test_name: "independent lane Batch rejects Plan, allocation, authority and child evidence tampering",
    expected_detection: "authority-capital-or-child-result-binding-rejected",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "aggregate-rerun-after-authoritative-children",
    timeout_ms: 25_000,
  },
  {
    case_id: "integrated-owner-port-and-publication-failure",
    profile: "integrated-portfolio",
    fault_stage: "portfolio-execution-publication",
    fault_kind: "injected-owner-port-failure",
    evidence_path: PORTFOLIO_TEST,
    evidence_test_name: "integrated Portfolio makes Allocation the only entry authority and releases exposure/risk through lifecycle Artifact",
    expected_detection: "engine-artifact-or-revaluation-owner-failure-blocks-portfolio-result",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "full-profile-rerun-required",
    timeout_ms: 30_000,
  },
  {
    case_id: "integrated-orphan-payload-publication-interruption",
    profile: "integrated-portfolio",
    fault_stage: "portfolio-artifact-publication",
    fault_kind: "orphan-payload-interruption",
    evidence_path: PORTFOLIO_TEST,
    evidence_test_name: "Portfolio Artifact uses manifest-last commit, is idempotent, and retries orphan payloads without partial Result",
    expected_detection: "payload-without-manifest-remains-non-authoritative",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "manifest-last-identical-retry",
    timeout_ms: 30_000,
  },
  {
    case_id: "terminal-mid-sequence-execution-failure",
    profile: "terminal-aware-bounded-cycle",
    fault_stage: "terminal-cycle-execution",
    fault_kind: "injected-mid-sequence-failure",
    evidence_path: PORTFOLIO_TEST,
    evidence_test_name: "bounded Cycle Sequence executes one, two, and three predeclared full-flat cycles without cycle-number schemas",
    expected_detection: "later-cycle-failure-blocks-sequence-result-and-artifact",
    expected_authority_outcome: "no-result-or-authoritative-manifest",
    recovery_class: "full-profile-rerun-required",
    timeout_ms: 30_000,
  },
]

const EXPECTED_LIMITATIONS = [
  "frozen-selected-fault-points-not-exhaustive-combinatorial-injection",
  "filesystem-power-loss-and-fsync-boundary-covered-by-separate-publication-crash-gate",
  "remote-distributed-artifact-store-corruption-and-recovery-not-certified",
  "committed-corruption-is-detected-not-automatically-repaired",
  "integrated-and-terminal-profiles-have-no-checkpoint-and-require-full-rerun",
  "cross-host-cross-runtime-and-concurrent-fault-schedules-not-certified",
]

export function loadReplayFaultCorruptionRecoveryBundle(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-fault-corruption-recovery-bundle.json"),
): ReplayFaultCorruptionRecoveryBundle {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayFaultCorruptionRecoveryBundle
}

export function assertReplayFaultCorruptionRecoveryBundle(
  bundle: ReplayFaultCorruptionRecoveryBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  if (bundle.schema_version !== "trade.rd-replay-fault-corruption-recovery-bundle.v1"
      || bundle.owner !== REPLAY_CERTIFICATION_OWNER
      || bundle.scope !== "frozen-owner-fault-and-corruption-assertions-for-four-public-profiles"
      || bundle.authority_policy !== "no-partial-result-or-manifest-authority-before-valid-commit"
      || bundle.corruption_policy !== "detect-before-use-never-rehash-or-silent-repair"
      || bundle.recovery_policy !== "retry-only-when-identical-source-and-owner-contract-permit"
      || bundle.execution_policy !== "sequential-fresh-bun-process-exact-frozen-owner-assertion") {
    throw new Error("unsupported Replay fault/corruption recovery bundle")
  }
  if (JSON.stringify(bundle.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay fault/corruption recovery limitations are incomplete")
  }
  if (bundle.cases.length !== EXPECTED_CASES.length) {
    throw new Error("Replay fault/corruption recovery case matrix is incomplete")
  }
  bundle.cases.forEach((entry, index) => {
    const expected = EXPECTED_CASES[index]!
    if (JSON.stringify(entry) !== JSON.stringify(expected)) {
      throw new Error(`Replay fault/corruption recovery case overclaim or drift: ${entry.case_id}`)
    }
    const source = readSource(repoRoot, entry.evidence_path, entry.case_id)
    if (!source.includes(`test(${JSON.stringify(entry.evidence_test_name)}`)) {
      throw new Error(`Replay fault/corruption owner assertion is missing: ${entry.case_id}`)
    }
  })
  const publicProfiles = profileEvidence.profiles.map((profile) => profile.profile).sort()
  const coveredProfiles = [...new Set(bundle.cases.map((entry) => entry.profile))].sort()
  if (JSON.stringify(coveredProfiles) !== JSON.stringify(publicProfiles)) {
    throw new Error("Replay fault/corruption matrix must cover every public profile")
  }
  if (bundle.bundle_sha256 !== replayFaultCorruptionRecoveryBundleHash(bundle)) {
    throw new Error("Replay fault/corruption recovery bundle hash drifted")
  }
}

export async function runReplayFaultCorruptionRecoveryProbe(
  bundle: ReplayFaultCorruptionRecoveryBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): Promise<ReplayFaultCorruptionRecoveryReceipt> {
  assertReplayFaultCorruptionRecoveryBundle(bundle, profileEvidence, repoRoot)
  const cases: ReplayFaultCorruptionCaseReceipt[] = []
  for (const entry of bundle.cases) {
    const processId = await runCase(entry, repoRoot)
    cases.push({
      case_id: entry.case_id,
      profile: entry.profile,
      process_id: processId,
      fault_stage: entry.fault_stage,
      recovery_class: entry.recovery_class,
      assertion_hash: sha256(stableJson({
        evidence_test_name: entry.evidence_test_name,
        outcome: "passed",
      })),
    })
  }
  if (new Set(cases.map((entry) => entry.process_id)).size !== cases.length) {
    throw new Error("Replay fault/corruption cases did not run in distinct processes")
  }
  const body = {
    schema_version: "trade.rd-replay-fault-corruption-recovery-receipt.v1" as const,
    bundle_sha256: bundle.bundle_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    cases,
    limitations: [...bundle.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function replayFaultCorruptionRecoveryBundleHash(
  bundle: ReplayFaultCorruptionRecoveryBundle,
): string {
  const { bundle_sha256: _bundleHash, ...body } = bundle
  return sha256(stableJson(body))
}

async function runCase(entry: ReplayFaultCorruptionCase, repoRoot: string): Promise<number> {
  const result = await runReplayOwnerAssertionProcess({
    test_path: entry.evidence_path,
    test_name: entry.evidence_test_name,
    timeout_ms: entry.timeout_ms,
    failure_label: `Replay fault/corruption owner assertion: ${entry.case_id}`,
  }, repoRoot)
  return result.process_id
}

function readSource(repoRoot: string, path: string, caseId: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay fault/corruption evidence path is not repo-relative: ${caseId}`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay fault/corruption evidence source is missing: ${caseId}`)
  return readFileSync(absolute, "utf8")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
