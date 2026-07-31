import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"
import { runReplayOwnerAssertionProcess } from "./replay-owner-assertion-process"

export interface ReplayReleaseCandidateComponent {
  role: string
  path: string
  content_sha256: string
  authority_hash_field: string | null
  authority_hash: string | null
}

export interface ReplayReleaseCandidateProfile {
  profile: string
  checkpoint_mode: string
  golden_path: string
  golden_test_name: string
  golden_source_sha256: string
  timeout_ms: number
}

export interface ReplayReleaseCandidateFixturePack {
  schema_version: "trade.rd-replay-release-candidate-fixture-pack.v1"
  owner: string
  candidate_scope: "m4-frozen-four-public-profiles-and-m5-release-evidence"
  freeze_policy: "closed-world-repo-relative-content-addressed-components-no-generated-result-copy"
  execution_policy: "one-fresh-bun-process-golden-owner-assertion-per-public-profile"
  verdict_policy: "fixture-pack-is-candidate-evidence-not-independent-release-verdict"
  components: ReplayReleaseCandidateComponent[]
  profiles: ReplayReleaseCandidateProfile[]
  limitations: string[]
  pack_sha256: string
}

export interface ReplayReleaseCandidateProfileReceipt {
  profile: string
  process_id: number
  golden_assertion_hash: string
}

export interface ReplayReleaseCandidateFixtureReceipt {
  schema_version: "trade.rd-replay-release-candidate-fixture-receipt.v1"
  pack_sha256: string
  runtime: { name: "bun"; version: string }
  component_set_hash: string
  profiles: ReplayReleaseCandidateProfileReceipt[]
  limitations: string[]
  receipt_sha256: string
}

const EXPECTED_COMPONENTS: Array<Pick<ReplayReleaseCandidateComponent,
  "role" | "path" | "authority_hash_field">> = [
  {
    role: "canonical-result-fixture",
    path: "apps/research-strategy-development/replay-execution-plane/tests/src/fixtures/certified-single-position-v24.json",
    authority_hash_field: null,
  },
  {
    role: "public-profile-evidence-registry",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-profile-evidence.json`,
    authority_hash_field: null,
  },
  {
    role: "certification-suite-registry",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-certification-suites.json`,
    authority_hash_field: null,
  },
  {
    role: "evidence-epoch-registry",
    path: "docs/research/reliability/rd-replay-evidence-epoch-registry.json",
    authority_hash_field: null,
  },
  {
    role: "module-consumer-closure",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-module-consumer-closure.json`,
    authority_hash_field: "observed_closure_sha256",
  },
  {
    role: "cross-process-reproducibility",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-cross-process-reproducibility-bundle.json`,
    authority_hash_field: "bundle_sha256",
  },
  {
    role: "historical-artifact-migration-registry",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-historical-artifact-migration.json`,
    authority_hash_field: "registry_sha256",
  },
  {
    role: "historical-artifact-fixture-pack",
    path: "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/fixtures/historical-artifact-read-migration-v1.json",
    authority_hash_field: "pack_hash",
  },
  {
    role: "publication-crash-recovery",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-publication-crash-recovery-bundle.json`,
    authority_hash_field: "bundle_sha256",
  },
  {
    role: "capacity-performance-envelope",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-capacity-performance-envelope.json`,
    authority_hash_field: "bundle_sha256",
  },
  {
    role: "fault-corruption-recovery",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-fault-corruption-recovery-bundle.json`,
    authority_hash_field: "bundle_sha256",
  },
  {
    role: "operational-readiness",
    path: `${REPLAY_CERTIFICATION_OWNER}/replay-operational-readiness.json`,
    authority_hash_field: "registry_sha256",
  },
]

const EXPECTED_PROFILES: Array<Omit<ReplayReleaseCandidateProfile, "golden_source_sha256">> = [
  {
    profile: "independent-lane-batch",
    checkpoint_mode: "child-trial-engine-checkpoints-v32-only",
    golden_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    golden_test_name: "independent capital lanes execute in canonical Plan order and aggregate evidence without shared NAV semantics",
    timeout_ms: 25_000,
  },
  {
    profile: "integrated-portfolio",
    checkpoint_mode: "not-supported-no-checkpoint-writer",
    golden_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    golden_test_name: "integrated Portfolio makes Allocation the only entry authority and releases exposure/risk through lifecycle Artifact",
    timeout_ms: 30_000,
  },
  {
    profile: "single-trial",
    checkpoint_mode: "resumable-engine-checkpoint-v32",
    golden_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts",
    golden_test_name: "runner atomically commits artifacts and retries idempotently",
    timeout_ms: 25_000,
  },
  {
    profile: "terminal-aware-bounded-cycle",
    checkpoint_mode: "not-supported-no-checkpoint-writer",
    golden_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    golden_test_name: "bounded Cycle Sequence executes one, two, and three predeclared full-flat cycles without cycle-number schemas",
    timeout_ms: 30_000,
  },
]

const EXPECTED_LIMITATIONS = [
  "synthetic-and-owner-test-fixtures-not-production-history-corpus",
  "content-freeze-does-not-prove-cross-host-or-cross-runtime-parity",
  "fixture-pack-does-not-expand-public-profiles-or-simulator-semantics",
  "fixture-pack-does-not-replace-complete-owner-certification",
  "fixture-pack-does-not-authorize-release-without-independent-audit",
  "remote-distributed-store-shadow-live-and-real-account-evidence-out-of-scope",
]

export function loadReplayReleaseCandidateFixturePack(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-release-candidate-fixture-pack.json"),
): ReplayReleaseCandidateFixturePack {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayReleaseCandidateFixturePack
}

export function assertReplayReleaseCandidateFixturePack(
  pack: ReplayReleaseCandidateFixturePack,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  if (pack.schema_version !== "trade.rd-replay-release-candidate-fixture-pack.v1"
      || pack.owner !== REPLAY_CERTIFICATION_OWNER
      || pack.candidate_scope !== "m4-frozen-four-public-profiles-and-m5-release-evidence"
      || pack.freeze_policy !== "closed-world-repo-relative-content-addressed-components-no-generated-result-copy"
      || pack.execution_policy !== "one-fresh-bun-process-golden-owner-assertion-per-public-profile"
      || pack.verdict_policy !== "fixture-pack-is-candidate-evidence-not-independent-release-verdict") {
    throw new Error("unsupported Replay release candidate fixture pack")
  }
  if (JSON.stringify(pack.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay release candidate fixture limitations are incomplete")
  }
  if (pack.components.length !== EXPECTED_COMPONENTS.length
      || new Set(pack.components.map((entry) => entry.role)).size !== pack.components.length) {
    throw new Error("Replay release candidate component closure is incomplete")
  }
  const componentDocuments = new Map<string, Record<string, unknown>>()
  pack.components.forEach((component, index) => {
    const expected = EXPECTED_COMPONENTS[index]!
    if (component.role !== expected.role || component.path !== expected.path
        || component.authority_hash_field !== expected.authority_hash_field) {
      throw new Error(`Replay release candidate component identity drifted: ${component.role}`)
    }
    const source = readSource(repoRoot, component.path, `component ${component.role}`)
    if (sha256(source) !== component.content_sha256) {
      throw new Error(`Replay release candidate component content drifted: ${component.role}`)
    }
    const document = JSON.parse(source) as Record<string, unknown>
    componentDocuments.set(component.role, document)
    if (component.authority_hash_field === null) {
      if (component.authority_hash !== null) {
        throw new Error(`Replay release candidate component invents authority hash: ${component.role}`)
      }
    } else if (component.authority_hash === null
        || document[component.authority_hash_field] !== component.authority_hash) {
      throw new Error(`Replay release candidate component authority hash drifted: ${component.role}`)
    }
  })
  const reproducibility = componentDocuments.get("cross-process-reproducibility") as {
    canonical_result_probe?: { fixture_path?: string; fixture_source_sha256?: string }
  }
  const canonicalFixture = pack.components[0]!
  if (reproducibility.canonical_result_probe?.fixture_path !== canonicalFixture.path
      || reproducibility.canonical_result_probe.fixture_source_sha256 !== canonicalFixture.content_sha256) {
    throw new Error("Replay release candidate canonical Result fixture is not bound to reproducibility evidence")
  }
  if (pack.profiles.length !== EXPECTED_PROFILES.length) {
    throw new Error("Replay release candidate public-profile golden matrix is incomplete")
  }
  pack.profiles.forEach((profile, index) => {
    const expected = EXPECTED_PROFILES[index]!
    const { golden_source_sha256: _sourceHash, ...identity } = profile
    if (JSON.stringify(identity) !== JSON.stringify(expected)) {
      throw new Error(`Replay release candidate profile identity drifted: ${profile.profile}`)
    }
    const evidence = profileEvidence.profiles[index]
    const golden = evidence?.evidence.golden
    if (!evidence || evidence.profile !== profile.profile
        || evidence.checkpoint_mode !== profile.checkpoint_mode
        || golden.kind === "explicit-not-supported"
        || golden.path !== profile.golden_path || golden.test_name !== profile.golden_test_name) {
      throw new Error(`Replay release candidate profile golden authority drifted: ${profile.profile}`)
    }
    const source = readSource(repoRoot, profile.golden_path, `${profile.profile} golden`)
    if (sha256(source) !== profile.golden_source_sha256) {
      throw new Error(`Replay release candidate profile source drifted: ${profile.profile}`)
    }
    if (!source.includes(`test(${JSON.stringify(profile.golden_test_name)}`)) {
      throw new Error(`Replay release candidate golden assertion is missing: ${profile.profile}`)
    }
  })
  if (pack.pack_sha256 !== replayReleaseCandidateFixturePackHash(pack)) {
    throw new Error("Replay release candidate fixture pack hash drifted")
  }
}

export async function runReplayReleaseCandidateFixtureProbe(
  pack: ReplayReleaseCandidateFixturePack,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): Promise<ReplayReleaseCandidateFixtureReceipt> {
  assertReplayReleaseCandidateFixturePack(pack, profileEvidence, repoRoot)
  const profiles: ReplayReleaseCandidateProfileReceipt[] = []
  for (const profile of pack.profiles) {
    const process = await runReplayOwnerAssertionProcess({
      test_path: profile.golden_path,
      test_name: profile.golden_test_name,
      timeout_ms: profile.timeout_ms,
      failure_label: `Replay release candidate golden: ${profile.profile}`,
    }, repoRoot)
    profiles.push({
      profile: profile.profile,
      process_id: process.process_id,
      golden_assertion_hash: sha256(stableJson({
        path: profile.golden_path,
        test_name: profile.golden_test_name,
        outcome: "passed",
      })),
    })
  }
  if (new Set(profiles.map((entry) => entry.process_id)).size !== profiles.length) {
    throw new Error("Replay release candidate golden assertions did not run in distinct fresh processes")
  }
  const componentSetHash = sha256(stableJson(pack.components))
  const body = {
    schema_version: "trade.rd-replay-release-candidate-fixture-receipt.v1" as const,
    pack_sha256: pack.pack_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    component_set_hash: componentSetHash,
    profiles,
    limitations: [...pack.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function replayReleaseCandidateFixturePackHash(
  pack: ReplayReleaseCandidateFixturePack,
): string {
  const { pack_sha256: _packHash, ...body } = pack
  return sha256(stableJson(body))
}

function readSource(repoRoot: string, path: string, role: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay release candidate ${role} path is not repo-relative`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay release candidate ${role} is missing`)
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
