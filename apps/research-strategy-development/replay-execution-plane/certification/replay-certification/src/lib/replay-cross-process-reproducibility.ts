import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"

export type ReplayCrossProcessResumeClaim =
  | "direct-engine-checkpoint"
  | "delegated-child-trial-checkpoint"
  | "explicit-not-supported"

export interface ReplayCrossProcessCanonicalResultProbe {
  fixture_path: string
  fixture_source_sha256: string
  member_script_path: string
  member_count: 2
  execution_policy: "concurrent-distinct-process-same-runtime-exact-canonical-result"
  expected_input_hash: string
  expected_result_hash: string
}

export interface ReplayCrossProcessProfileEvidence {
  profile: string
  entrypoint_path: string
  entrypoint_export: string
  test_path: string
  test_name: string
  checkpoint_mode: string
  resume_claim: ReplayCrossProcessResumeClaim
}

export interface ReplayCrossProcessReproducibilityBundle {
  schema_version: "trade.rd-replay-cross-process-reproducibility-bundle.v1"
  owner: string
  canonical_result_probe: ReplayCrossProcessCanonicalResultProbe
  profile_execution_policy: "two-fresh-bun-processes-per-public-profile-exact-owner-test"
  process_count_per_profile: 2
  runtime_policy: "current-certification-runtime-recorded-not-cross-runtime"
  output_policy: "canonical-result-exact-and-both-profile-processes-pass-owner-assertion"
  profiles: ReplayCrossProcessProfileEvidence[]
  limitations: string[]
  bundle_sha256: string
}

export interface ReplayCrossProcessCanonicalResultReceipt {
  member_process_ids: [number, number]
  runtime_identity: string
  input_hash: string
  result_hash: string
}

export interface ReplayCrossProcessProfileReceipt {
  profile: string
  process_ids: [number, number]
  exit_codes: [number, number]
  semantic_assertion_sha256: string
}

export interface ReplayCrossProcessReproducibilityReceipt {
  schema_version: "trade.rd-replay-cross-process-reproducibility-receipt.v1"
  bundle_sha256: string
  runtime: { name: "bun"; version: string }
  canonical_result: ReplayCrossProcessCanonicalResultReceipt
  profiles: ReplayCrossProcessProfileReceipt[]
  limitations: string[]
  receipt_sha256: string
}

interface ReplayCrossProcessMemberOutput {
  schema_version: "trade.rd-replay-cross-process-member.v1"
  process_id: number
  runtime_identity: string
  input_hash: string
  result_hash: string
}

export function loadReplayCrossProcessReproducibilityBundle(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-cross-process-reproducibility-bundle.json"),
): ReplayCrossProcessReproducibilityBundle {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayCrossProcessReproducibilityBundle
}

export function assertReplayCrossProcessReproducibilityBundle(
  bundle: ReplayCrossProcessReproducibilityBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  if (bundle.schema_version !== "trade.rd-replay-cross-process-reproducibility-bundle.v1"
      || bundle.owner !== REPLAY_CERTIFICATION_OWNER
      || bundle.profile_execution_policy !== "two-fresh-bun-processes-per-public-profile-exact-owner-test"
      || bundle.process_count_per_profile !== 2
      || bundle.runtime_policy !== "current-certification-runtime-recorded-not-cross-runtime"
      || bundle.output_policy !== "canonical-result-exact-and-both-profile-processes-pass-owner-assertion") {
    throw new Error("unsupported Replay cross-process reproducibility bundle")
  }
  if (!bundle.limitations.includes("cross-host-and-cross-runtime-parity-not-certified")
      || !bundle.limitations.includes("unsupported-checkpoint-modes-remain-unsupported")
      || !bundle.limitations.includes("release-fixture-pack-freeze-is-a-separate-m5-gate")
      || !bundle.limitations.includes("remaining-m5-gates-not-certified-by-this-bundle")) {
    throw new Error("Replay cross-process reproducibility limitations are incomplete")
  }
  const probe = bundle.canonical_result_probe
  if (probe.member_count !== 2
      || probe.execution_policy !== "concurrent-distinct-process-same-runtime-exact-canonical-result"
      || !isHash(probe.expected_input_hash) || !isHash(probe.expected_result_hash)
      || sha256(readRepoFile(repoRoot, probe.fixture_path)) !== probe.fixture_source_sha256) {
    throw new Error("Replay cross-process canonical Result probe drifted")
  }
  readRepoFile(repoRoot, probe.member_script_path)
  const profiles = bundle.profiles.map((entry) => entry.profile)
  const expectedProfiles = profileEvidence.profiles.map((entry) => entry.profile)
  if (new Set(profiles).size !== profiles.length
      || JSON.stringify(profiles) !== JSON.stringify([...profiles].sort())
      || JSON.stringify(profiles) !== JSON.stringify(expectedProfiles)) {
    throw new Error("Replay cross-process bundle must cover every public profile exactly once")
  }
  for (const entry of bundle.profiles) {
    const profile = profileEvidence.profiles.find((candidate) => candidate.profile === entry.profile)
    if (!profile || entry.entrypoint_path !== profile.entrypoint_path
        || entry.entrypoint_export !== profile.entrypoint_export
        || entry.checkpoint_mode !== profile.checkpoint_mode
        || entry.resume_claim !== expectedResumeClaim(profile.checkpoint_mode)) {
      throw new Error(`Replay cross-process profile authority drifted: ${entry.profile}`)
    }
    const entrypoint = readRepoFile(repoRoot, entry.entrypoint_path)
    const test = readRepoFile(repoRoot, entry.test_path)
    if (!exportsName(entrypoint, entry.entrypoint_export)) {
      throw new Error(`Replay cross-process entrypoint source drifted: ${entry.profile}`)
    }
    if (!entry.test_path.endsWith(".test.ts")
        || !test.includes(`test(${JSON.stringify(entry.test_name)}`)) {
      throw new Error(`Replay cross-process semantic assertion drifted: ${entry.profile}`)
    }
  }
  if (bundle.bundle_sha256 !== bundleHash(bundle)) {
    throw new Error("Replay cross-process reproducibility bundle hash drifted")
  }
}

function exportsName(source: string, name: string): boolean {
  return source.includes(`export function ${name}`)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source)
}

export async function runReplayCrossProcessReproducibilityBundle(
  bundle: ReplayCrossProcessReproducibilityBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): Promise<ReplayCrossProcessReproducibilityReceipt> {
  assertReplayCrossProcessReproducibilityBundle(bundle, profileEvidence, repoRoot)
  const canonicalResult = await runCanonicalResultProbe(bundle.canonical_result_probe, repoRoot)
  const profileReceipts: ReplayCrossProcessProfileReceipt[] = []
  for (const entry of bundle.profiles) {
    const command = ["bun", "test", entry.test_path, "--test-name-pattern", `^${escapeRegExp(entry.test_name)}$`]
    const results = await Promise.all(spawnPair(command, repoRoot).map(readChild))
    assertDistinctProcesses(results[0]!.pid, results[1]!.pid, entry.profile)
    for (const result of results) {
      if (result.exitCode !== 0 || !result.output.includes(`(pass) ${entry.test_name}`)
          || !result.output.includes(" 0 fail")) {
        throw new Error(`Replay cross-process semantic assertion failed: ${entry.profile}`)
      }
    }
    profileReceipts.push({
      profile: entry.profile,
      process_ids: [results[0]!.pid, results[1]!.pid],
      exit_codes: [results[0]!.exitCode, results[1]!.exitCode],
      semantic_assertion_sha256: sha256(stableJson({
        profile: entry.profile,
        entrypoint_export: entry.entrypoint_export,
        test_name: entry.test_name,
        outcome: "passed",
      })),
    })
  }
  const body = {
    schema_version: "trade.rd-replay-cross-process-reproducibility-receipt.v1" as const,
    bundle_sha256: bundle.bundle_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    canonical_result: canonicalResult,
    profiles: profileReceipts,
    limitations: [...bundle.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function bundleHash(bundle: ReplayCrossProcessReproducibilityBundle): string {
  const { bundle_sha256: _bundleSha256, ...body } = bundle
  return sha256(stableJson(body))
}

async function runCanonicalResultProbe(
  probe: ReplayCrossProcessCanonicalResultProbe,
  repoRoot: string,
): Promise<ReplayCrossProcessCanonicalResultReceipt> {
  const command = ["bun", probe.member_script_path, "--fixture", probe.fixture_path]
  const results = await Promise.all(spawnPair(command, repoRoot).map(readChild))
  assertDistinctProcesses(results[0]!.pid, results[1]!.pid, "canonical-result")
  const members = results.map((result) => {
    if (result.exitCode !== 0) throw new Error("Replay cross-process canonical Result member failed")
    const member = JSON.parse(result.stdout) as ReplayCrossProcessMemberOutput
    if (member.schema_version !== "trade.rd-replay-cross-process-member.v1" || member.process_id !== result.pid) {
      throw new Error("Replay cross-process canonical Result member identity drifted")
    }
    return member
  })
  if (members[0]!.runtime_identity !== members[1]!.runtime_identity
      || members.some((member) => member.input_hash !== probe.expected_input_hash
        || member.result_hash !== probe.expected_result_hash)) {
    throw new Error("Replay cross-process canonical Result parity failed")
  }
  return {
    member_process_ids: [members[0]!.process_id, members[1]!.process_id],
    runtime_identity: members[0]!.runtime_identity,
    input_hash: members[0]!.input_hash,
    result_hash: members[0]!.result_hash,
  }
}

type ReplayCertificationChild = Bun.Subprocess<"ignore", "pipe", "pipe">

function spawnPair(command: string[], repoRoot: string): [ReplayCertificationChild, ReplayCertificationChild] {
  const options = { cwd: repoRoot, stdin: "ignore" as const, stdout: "pipe" as const,
    stderr: "pipe" as const, env: { ...process.env, NO_COLOR: "1" } }
  return [Bun.spawn(command, options), Bun.spawn(command, options)]
}

async function readChild(child: ReplayCertificationChild): Promise<{
  pid: number; exitCode: number; stdout: string; output: string
}> {
  if (child.stdout == null || typeof child.stdout === "number"
      || child.stderr == null || typeof child.stderr === "number") {
    throw new Error("Replay cross-process verifier requires piped child output")
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  return { pid: child.pid, exitCode, stdout, output: `${stdout}\n${stderr}` }
}

function assertDistinctProcesses(first: number, second: number, scope: string): void {
  if (first === second) throw new Error(`Replay cross-process verifier reused a process: ${scope}`)
}

function expectedResumeClaim(checkpointMode: string): ReplayCrossProcessResumeClaim {
  if (checkpointMode === "resumable-engine-checkpoint-v32") return "direct-engine-checkpoint"
  if (checkpointMode === "child-trial-engine-checkpoints-v32-only") return "delegated-child-trial-checkpoint"
  if (checkpointMode === "not-supported-no-checkpoint-writer") return "explicit-not-supported"
  throw new Error(`unsupported Replay checkpoint mode: ${checkpointMode}`)
}

function readRepoFile(repoRoot: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay cross-process path is not repo-relative: ${path}`)
  }
  const absolutePath = join(repoRoot, path)
  if (!existsSync(absolutePath)) throw new Error(`Replay cross-process source is missing: ${path}`)
  return readFileSync(absolutePath, "utf8")
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex") }
function isHash(value: string): boolean { return /^[0-9a-f]{64}$/.test(value) }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
