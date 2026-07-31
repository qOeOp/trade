import { createHash } from "node:crypto"
import { cpus, totalmem } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"
import { runReplayOwnerAssertionProcess } from "./replay-owner-assertion-process"

export interface ReplayCertifiedWorkloadUnit {
  unit: "batch" | "portfolio" | "sequence" | "cycle" | "lane" | "trial" | "market_bar"
  count: number
}

export interface ReplayRuntimeHardLimit {
  dimension: "cycle_count"
  maximum: number
  evidence_path: string
  evidence_export: string
}

export interface ReplayCapacityPerformanceProfile {
  profile: string
  entrypoint_path: string
  entrypoint_export: string
  test_path: string
  test_name: string
  certified_workload: ReplayCertifiedWorkloadUnit[]
  runtime_hard_limits: ReplayRuntimeHardLimit[]
  undeclared_capacity_dimensions: string[]
  warmup_run_count: 1
  measured_run_count: 2
  sample_timeout_ms: number
  regression_ceiling_ms: number
}

export interface ReplayCapacityPerformanceEnvelope {
  schema_version: "trade.rd-replay-capacity-performance-envelope.v1"
  owner: string
  capacity_scope: "frozen-owner-fixture-known-good-release-envelope-not-maximum-throughput"
  outside_envelope_policy: "uncertified-not-implicitly-supported-and-not-runtime-rejected-unless-owner-limit-exists"
  execution_policy: "sequential-fresh-bun-process-exact-frozen-owner-assertion"
  timing_policy: "monotonic-wall-clock-current-host-regression-guardrail-not-sla"
  resource_policy: "one-child-process-at-a-time-output-captured-peak-memory-cpu-and-io-unclaimed"
  profiles: ReplayCapacityPerformanceProfile[]
  limitations: string[]
  bundle_sha256: string
}

export interface ReplayCapacityPerformanceProfileReceipt {
  profile: string
  process_ids: [number, number]
  elapsed_ms: [number, number]
  maximum_elapsed_ms: number
  median_elapsed_ms: number
  regression_ceiling_ms: number
  workload_hash: string
  assertion_hash: string
}

export interface ReplayCapacityPerformanceReceipt {
  schema_version: "trade.rd-replay-capacity-performance-receipt.v1"
  bundle_sha256: string
  runtime: { name: "bun"; version: string }
  host_observation: {
    platform: string
    architecture: string
    logical_cpu_count: number
    total_memory_bytes: number
  }
  profiles: ReplayCapacityPerformanceProfileReceipt[]
  limitations: string[]
  receipt_sha256: string
}

const INDEPENDENT_TEST =
  "independent capital lanes execute in canonical Plan order and aggregate evidence without shared NAV semantics"
const INTEGRATED_TEST =
  "integrated Portfolio makes Allocation the only entry authority and releases exposure/risk through lifecycle Artifact"
const SINGLE_TEST = "runner atomically commits artifacts and retries idempotently"
const CYCLE_TEST =
  "bounded Cycle Sequence executes one, two, and three predeclared full-flat cycles without cycle-number schemas"
const BATCH_TEST_PATH =
  "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts"
const TRIAL_TEST_PATH =
  "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts"
const CYCLE_LIMIT_PATH =
  "apps/research-strategy-development/replay-execution-plane/contracts/src/lib/replay-portfolio-cycle-sequence-contracts.ts"
const PUBLIC_ENTRYPOINT_PATH =
  "apps/research-strategy-development/replay-execution-plane/runner/src/public.ts"

const EXPECTED_PROFILES: ReplayCapacityPerformanceProfile[] = [
  {
    profile: "independent-lane-batch",
    entrypoint_path: PUBLIC_ENTRYPOINT_PATH,
    entrypoint_export: "runReplayIndependentLaneBatch",
    test_path: BATCH_TEST_PATH,
    test_name: INDEPENDENT_TEST,
    certified_workload: [
      { unit: "batch", count: 1 }, { unit: "lane", count: 2 }, { unit: "trial", count: 2 },
    ],
    runtime_hard_limits: [],
    undeclared_capacity_dimensions: ["maximum_lane_count", "maximum_child_trial_payload_bytes"],
    warmup_run_count: 1,
    measured_run_count: 2,
    sample_timeout_ms: 15_000,
    regression_ceiling_ms: 10_000,
  },
  {
    profile: "integrated-portfolio",
    entrypoint_path: PUBLIC_ENTRYPOINT_PATH,
    entrypoint_export: "runReplayIntegratedPortfolio",
    test_path: BATCH_TEST_PATH,
    test_name: INTEGRATED_TEST,
    certified_workload: [
      { unit: "portfolio", count: 1 }, { unit: "lane", count: 2 }, { unit: "trial", count: 2 },
    ],
    runtime_hard_limits: [],
    undeclared_capacity_dimensions: ["maximum_lane_count", "maximum_market_event_count", "maximum_artifact_bytes"],
    warmup_run_count: 1,
    measured_run_count: 2,
    sample_timeout_ms: 20_000,
    regression_ceiling_ms: 15_000,
  },
  {
    profile: "single-trial",
    entrypoint_path: PUBLIC_ENTRYPOINT_PATH,
    entrypoint_export: "runReplayTrial",
    test_path: TRIAL_TEST_PATH,
    test_name: SINGLE_TEST,
    certified_workload: [{ unit: "trial", count: 1 }, { unit: "market_bar", count: 1 }],
    runtime_hard_limits: [],
    undeclared_capacity_dimensions: ["maximum_market_bar_count", "maximum_source_event_count", "maximum_artifact_bytes"],
    warmup_run_count: 1,
    measured_run_count: 2,
    sample_timeout_ms: 20_000,
    regression_ceiling_ms: 15_000,
  },
  {
    profile: "terminal-aware-bounded-cycle",
    entrypoint_path: PUBLIC_ENTRYPOINT_PATH,
    entrypoint_export: "runReplayPortfolioProtectiveTerminalCycleSequence",
    test_path: BATCH_TEST_PATH,
    test_name: CYCLE_TEST,
    certified_workload: [
      { unit: "sequence", count: 1 }, { unit: "cycle", count: 3 },
      { unit: "lane", count: 6 }, { unit: "trial", count: 6 },
    ],
    runtime_hard_limits: [{
      dimension: "cycle_count",
      maximum: 8,
      evidence_path: CYCLE_LIMIT_PATH,
      evidence_export: "REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES",
    }],
    undeclared_capacity_dimensions: ["maximum_lanes_per_cycle", "maximum_market_event_count", "maximum_artifact_bytes"],
    warmup_run_count: 1,
    measured_run_count: 2,
    sample_timeout_ms: 30_000,
    regression_ceiling_ms: 20_000,
  },
]

const EXPECTED_LIMITATIONS = [
  "known-good-owner-fixture-envelope-is-not-a-maximum-throughput-claim",
  "outside-envelope-input-is-uncertified-not-implicitly-supported",
  "wall-clock-ceilings-are-current-host-regression-guardrails-not-sla",
  "cross-host-cross-runtime-and-contended-host-performance-not-certified",
  "peak-memory-cpu-utilization-io-throughput-and-remote-store-performance-not-certified",
  "only-terminal-cycle-count-has-an-existing-runtime-hard-limit",
]

export function loadReplayCapacityPerformanceEnvelope(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-capacity-performance-envelope.json"),
): ReplayCapacityPerformanceEnvelope {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayCapacityPerformanceEnvelope
}

export function assertReplayCapacityPerformanceEnvelope(
  envelope: ReplayCapacityPerformanceEnvelope,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  if (envelope.schema_version !== "trade.rd-replay-capacity-performance-envelope.v1"
      || envelope.owner !== REPLAY_CERTIFICATION_OWNER
      || envelope.capacity_scope !== "frozen-owner-fixture-known-good-release-envelope-not-maximum-throughput"
      || envelope.outside_envelope_policy
        !== "uncertified-not-implicitly-supported-and-not-runtime-rejected-unless-owner-limit-exists"
      || envelope.execution_policy !== "sequential-fresh-bun-process-exact-frozen-owner-assertion"
      || envelope.timing_policy !== "monotonic-wall-clock-current-host-regression-guardrail-not-sla"
      || envelope.resource_policy
        !== "one-child-process-at-a-time-output-captured-peak-memory-cpu-and-io-unclaimed") {
    throw new Error("unsupported Replay capacity/performance envelope")
  }
  if (JSON.stringify(envelope.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay capacity/performance limitations are incomplete")
  }
  const profileNames = profileEvidence.profiles.map((profile) => profile.profile)
  if (JSON.stringify(envelope.profiles.map((profile) => profile.profile)) !== JSON.stringify(profileNames)
      || envelope.profiles.length !== EXPECTED_PROFILES.length) {
    throw new Error("Replay capacity/performance envelope must cover every public profile once")
  }
  envelope.profiles.forEach((profile, index) => {
    const expected = EXPECTED_PROFILES[index]!
    if (JSON.stringify(profile) !== JSON.stringify(expected)) {
      throw new Error(`Replay capacity/performance profile overclaim or drift: ${profile.profile}`)
    }
    const entrypoint = readSource(repoRoot, profile.entrypoint_path, `${profile.profile} entrypoint`)
    const test = readSource(repoRoot, profile.test_path, `${profile.profile} owner assertion`)
    if (!exportsName(entrypoint, profile.entrypoint_export)
        || !test.includes(`test(${JSON.stringify(profile.test_name)}`)) {
      throw new Error(`Replay capacity/performance evidence is missing: ${profile.profile}`)
    }
    for (const limit of profile.runtime_hard_limits) {
      const source = readSource(repoRoot, limit.evidence_path, `${profile.profile} runtime hard limit`)
      if (!source.includes(`export const ${limit.evidence_export} = ${limit.maximum} as const`)) {
        throw new Error(`Replay runtime hard limit evidence drifted: ${profile.profile}`)
      }
    }
  })
  if (envelope.bundle_sha256 !== replayCapacityPerformanceEnvelopeHash(envelope)) {
    throw new Error("Replay capacity/performance envelope hash drifted")
  }
}

function exportsName(source: string, name: string): boolean {
  return source.includes(`export function ${name}`)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source)
}

export async function runReplayCapacityPerformanceProbe(
  envelope: ReplayCapacityPerformanceEnvelope,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): Promise<ReplayCapacityPerformanceReceipt> {
  assertReplayCapacityPerformanceEnvelope(envelope, profileEvidence, repoRoot)
  const profiles: ReplayCapacityPerformanceProfileReceipt[] = []
  for (const profile of envelope.profiles) {
    for (let index = 0; index < profile.warmup_run_count; index += 1) {
      await runProfileSample(profile, repoRoot)
    }
    const samples = []
    for (let index = 0; index < profile.measured_run_count; index += 1) {
      samples.push(await runProfileSample(profile, repoRoot))
    }
    const elapsed = samples.map((sample) => sample.elapsedMs) as [number, number]
    if (samples[0]!.pid === samples[1]!.pid) {
      throw new Error(`Replay capacity/performance samples did not use distinct processes: ${profile.profile}`)
    }
    const maximum = Math.max(...elapsed)
    if (maximum > profile.regression_ceiling_ms) {
      throw new Error(`Replay performance regression ceiling exceeded: ${profile.profile}`)
    }
    const ordered = [...elapsed].sort((left, right) => left - right)
    profiles.push({
      profile: profile.profile,
      process_ids: samples.map((sample) => sample.pid) as [number, number],
      elapsed_ms: elapsed,
      maximum_elapsed_ms: maximum,
      median_elapsed_ms: (ordered[0]! + ordered[1]!) / 2,
      regression_ceiling_ms: profile.regression_ceiling_ms,
      workload_hash: sha256(stableJson(profile.certified_workload)),
      assertion_hash: sha256(stableJson({
        test_name: profile.test_name,
        outcome: "passed",
      })),
    })
  }
  const body = {
    schema_version: "trade.rd-replay-capacity-performance-receipt.v1" as const,
    bundle_sha256: envelope.bundle_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    host_observation: {
      platform: process.platform,
      architecture: process.arch,
      logical_cpu_count: cpus().length,
      total_memory_bytes: totalmem(),
    },
    profiles,
    limitations: [...envelope.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function replayCapacityPerformanceEnvelopeHash(
  envelope: ReplayCapacityPerformanceEnvelope,
): string {
  const { bundle_sha256: _bundleSha256, ...body } = envelope
  return sha256(stableJson(body))
}

async function runProfileSample(
  profile: ReplayCapacityPerformanceProfile,
  repoRoot: string,
): Promise<{ pid: number; elapsedMs: number }> {
  const result = await runReplayOwnerAssertionProcess({
    test_path: profile.test_path,
    test_name: profile.test_name,
    timeout_ms: profile.sample_timeout_ms,
    failure_label: `Replay capacity/performance owner assertion: ${profile.profile}`,
  }, repoRoot)
  return { pid: result.process_id, elapsedMs: result.elapsed_ms }
}

function readSource(repoRoot: string, path: string, role: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay capacity/performance ${role} path is not repo-relative`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay capacity/performance ${role} source is missing`)
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
