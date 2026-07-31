import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPLAY_CERTIFICATION_OWNER, type ReplayProfileEvidenceManifest } from "./replay-certification"

export type ReplayPublicationProfileRecoveryMode =
  | "direct-checkpoint-resume-or-deterministic-rerun"
  | "delegated-child-trial-recovery-deterministic-aggregate-no-batch-writer"
  | "deterministic-full-rerun-no-checkpoint-writer"

export interface ReplayPublicationCrashRecoveryProfile {
  profile: string
  publication_scope: "direct-manifest" | "child-trial-manifests-only"
  recovery_mode: ReplayPublicationProfileRecoveryMode
  writer_path: string
  writer_export: string
  test_path: string
  test_name: string
}

export interface ReplayPublicationCrashRecoveryBundle {
  schema_version: "trade.rd-replay-publication-crash-recovery-bundle.v1"
  owner: string
  store_policy: "local-fs-durable-immutable-cas-manifest-last"
  exactly_once_scope: "one-authoritative-commit-marker-not-one-process-execution"
  crash_probe: {
    member_script_path: string
    local_store_path: string
    crash_signal: "SIGKILL"
    crash_point: "after-all-durable-payloads-before-manifest"
    recovery_process_count: 2
    post_recovery_reader_count: 1
  }
  profiles: ReplayPublicationCrashRecoveryProfile[]
  limitations: string[]
  bundle_sha256: string
}

export interface ReplayPublicationCrashRecoveryReceipt {
  schema_version: "trade.rd-replay-publication-crash-recovery-receipt.v1"
  bundle_sha256: string
  runtime: { name: "bun"; version: string }
  crashed_process_id: number
  crash_exit_code: number
  orphan_payload_count: number
  orphan_manifest_present: false
  recovery_process_ids: [number, number]
  recovery_manifest_sha256: string
  recovery_publication_hash: string
  committed_manifest_count: 1
  post_recovery_reader_process_id: number
  post_recovery_idempotent_read: true
  remaining_temporary_file_count: 0
  limitations: string[]
  receipt_sha256: string
}

interface MemberOutput {
  schema_version: "trade.rd-replay-publication-crash-member.v1"
  process_id: number
  idempotent_read: boolean
  namespace_ref: string
  manifest_sha256: string
  publication_hash: string
  file_count: number
}

interface ReadyOutput {
  schema_version: "trade.rd-replay-publication-crash-member-ready.v1"
  process_id: number
  namespace_ref: string
  payload_count: number
  manifest_present: boolean
}

const EXPECTED_PROFILES: ReplayPublicationCrashRecoveryProfile[] = [
  {
    profile: "independent-lane-batch",
    publication_scope: "child-trial-manifests-only",
    recovery_mode: "delegated-child-trial-recovery-deterministic-aggregate-no-batch-writer",
    writer_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts",
    writer_export: "runReplayTrial",
    test_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    test_name: "independent lane failure is all-or-nothing and never publishes a partial batch Result",
  },
  {
    profile: "integrated-portfolio",
    publication_scope: "direct-manifest",
    recovery_mode: "deterministic-full-rerun-no-checkpoint-writer",
    writer_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-integrated-portfolio-artifact-publisher.ts",
    writer_export: "publishReplayIntegratedPortfolioArtifact",
    test_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    test_name: "integrated Portfolio makes Allocation the only entry authority and releases exposure/risk through lifecycle Artifact",
  },
  {
    profile: "single-trial",
    publication_scope: "direct-manifest",
    recovery_mode: "direct-checkpoint-resume-or-deterministic-rerun",
    writer_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts",
    writer_export: "runReplayTrial",
    test_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.test.ts",
    test_name: "runner atomically publishes an attempt-local checkpoint commit and resumes it across processes",
  },
  {
    profile: "terminal-aware-bounded-cycle",
    publication_scope: "direct-manifest",
    recovery_mode: "deterministic-full-rerun-no-checkpoint-writer",
    writer_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-protective-terminal-cycle-sequence-artifact-publisher.ts",
    writer_export: "publishReplayPortfolioProtectiveTerminalCycleSequenceArtifact",
    test_path: "apps/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.test.ts",
    test_name: "bounded Cycle Sequence executes one, two, and three predeclared full-flat cycles without cycle-number schemas",
  },
]

const EXPECTED_LIMITATIONS = [
  "local-filesystem-single-host-only-remote-and-distributed-stores-not-certified",
  "exactly-once-applies-to-authoritative-manifest-publication-not-process-execution",
  "independent-batch-has-no-durable-aggregate-writer-and-delegates-to-child-trial-manifests",
  "integrated-and-terminal-cycle-recover-by-deterministic-full-rerun-without-checkpoint",
  "power-loss-and-filesystem-hardware-failure-beyond-fsync-contract-not-certified",
]

export function loadReplayPublicationCrashRecoveryBundle(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-publication-crash-recovery-bundle.json"),
): ReplayPublicationCrashRecoveryBundle {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayPublicationCrashRecoveryBundle
}

export function assertReplayPublicationCrashRecoveryBundle(
  bundle: ReplayPublicationCrashRecoveryBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  if (bundle.schema_version !== "trade.rd-replay-publication-crash-recovery-bundle.v1"
      || bundle.owner !== REPLAY_CERTIFICATION_OWNER
      || bundle.store_policy !== "local-fs-durable-immutable-cas-manifest-last"
      || bundle.exactly_once_scope !== "one-authoritative-commit-marker-not-one-process-execution"
      || bundle.crash_probe.crash_signal !== "SIGKILL"
      || bundle.crash_probe.crash_point !== "after-all-durable-payloads-before-manifest"
      || bundle.crash_probe.recovery_process_count !== 2
      || bundle.crash_probe.post_recovery_reader_count !== 1) {
    throw new Error("unsupported Replay publication crash recovery bundle")
  }
  if (JSON.stringify(bundle.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay publication crash recovery limitations are incomplete")
  }
  readSource(repoRoot, bundle.crash_probe.member_script_path, "member")
  readSource(repoRoot, bundle.crash_probe.local_store_path, "local store")
  const profileNames = profileEvidence.profiles.map((profile) => profile.profile)
  if (JSON.stringify(bundle.profiles.map((profile) => profile.profile)) !== JSON.stringify(profileNames)
      || bundle.profiles.length !== EXPECTED_PROFILES.length) {
    throw new Error("Replay publication crash recovery must cover every public profile once")
  }
  bundle.profiles.forEach((profile, index) => {
    const expected = EXPECTED_PROFILES[index]!
    if (JSON.stringify(profile) !== JSON.stringify(expected)) {
      throw new Error(`Replay publication profile policy drifted: ${profile.profile}`)
    }
    const writer = readSource(repoRoot, profile.writer_path, `${profile.profile} writer`)
    const test = readSource(repoRoot, profile.test_path, `${profile.profile} test`)
    if (!writer.includes(`export function ${profile.writer_export}`)
        || !test.includes(`test(${JSON.stringify(profile.test_name)}`)) {
      throw new Error(`Replay publication profile evidence is missing: ${profile.profile}`)
    }
  })
  if (bundle.bundle_sha256 !== replayPublicationCrashRecoveryBundleHash(bundle)) {
    throw new Error("Replay publication crash recovery bundle hash drifted")
  }
}

export async function runReplayPublicationCrashRecoveryProbe(
  bundle: ReplayPublicationCrashRecoveryBundle,
  profileEvidence: ReplayProfileEvidenceManifest,
  repoRoot: string,
  root: string,
): Promise<ReplayPublicationCrashRecoveryReceipt> {
  assertReplayPublicationCrashRecoveryBundle(bundle, profileEvidence, repoRoot)
  const command = (mode: "crash-after-payload" | "recover-or-read") => [
    "bun", bundle.crash_probe.member_script_path, "--mode", mode, "--root", root,
  ]
  const crashed = Bun.spawn(command("crash-after-payload"), {
    cwd: repoRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  })
  const readyRead = await crashed.stdout.getReader().read()
  if (!readyRead.value) throw new Error("Replay publication crash member did not become ready")
  const ready = JSON.parse(new TextDecoder().decode(readyRead.value).trim()) as ReadyOutput
  if (ready.schema_version !== "trade.rd-replay-publication-crash-member-ready.v1"
      || ready.process_id !== crashed.pid || ready.payload_count !== 3
      || ready.manifest_present !== false) {
    throw new Error("Replay publication crash member ready evidence drifted")
  }
  crashed.kill(9)
  const crashExitCode = await crashed.exited
  if (crashExitCode === 0) throw new Error("Replay publication crash member was not killed")
  const orphanNames = readdirSync(ready.namespace_ref).sort()
  if (orphanNames.includes("artifact-manifest.json") || orphanNames.length !== ready.payload_count) {
    throw new Error("Replay publication crash point did not leave payload-only orphan evidence")
  }

  const recovered = await Promise.all([0, 1].map(async () =>
    readMember(Bun.spawn(command("recover-or-read"), {
      cwd: repoRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    }))))
  if (recovered[0]!.process_id === recovered[1]!.process_id
      || recovered.some((member) => member.file_count !== 4)
      || recovered[0]!.manifest_sha256 !== recovered[1]!.manifest_sha256
      || recovered[0]!.publication_hash !== recovered[1]!.publication_hash) {
    throw new Error("Replay concurrent publication recovery did not converge exactly")
  }
  const reader = await readMember(Bun.spawn(command("recover-or-read"), {
    cwd: repoRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  }))
  if (!reader.idempotent_read || reader.manifest_sha256 !== recovered[0]!.manifest_sha256
      || reader.publication_hash !== recovered[0]!.publication_hash) {
    throw new Error("Replay post-recovery publication read is not idempotent")
  }
  const paths = collectPaths(root)
  const manifestCount = paths.filter((path) => path.endsWith("/artifact-manifest.json")).length
  const temporaryCount = paths.filter((path) => path.endsWith(".tmp")).length
  if (manifestCount !== 1 || temporaryCount !== 0) {
    throw new Error("Replay publication recovery left duplicate commits or temporary files")
  }
  const body = {
    schema_version: "trade.rd-replay-publication-crash-recovery-receipt.v1" as const,
    bundle_sha256: bundle.bundle_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    crashed_process_id: ready.process_id,
    crash_exit_code: crashExitCode,
    orphan_payload_count: orphanNames.length,
    orphan_manifest_present: false as const,
    recovery_process_ids: [recovered[0]!.process_id, recovered[1]!.process_id] as [number, number],
    recovery_manifest_sha256: recovered[0]!.manifest_sha256,
    recovery_publication_hash: recovered[0]!.publication_hash,
    committed_manifest_count: 1 as const,
    post_recovery_reader_process_id: reader.process_id,
    post_recovery_idempotent_read: true as const,
    remaining_temporary_file_count: 0 as const,
    limitations: [...bundle.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function replayPublicationCrashRecoveryBundleHash(
  bundle: ReplayPublicationCrashRecoveryBundle,
): string {
  const { bundle_sha256: _bundleSha256, ...body } = bundle
  return sha256(stableJson(body))
}

async function readMember(child: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<MemberOutput> {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Replay publication recovery member failed: ${stderr}`)
  const member = JSON.parse(stdout) as MemberOutput
  if (member.schema_version !== "trade.rd-replay-publication-crash-member.v1"
      || member.process_id !== child.pid || !isHash(member.manifest_sha256)
      || !isHash(member.publication_hash)) {
    throw new Error("Replay publication recovery member evidence drifted")
  }
  return member
}

function readSource(repoRoot: string, path: string, kind: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay publication ${kind} path is not repo-relative`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay publication ${kind} source is missing`)
  return readFileSync(absolute, "utf8")
}

function collectPaths(root: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    paths.push(path.replaceAll("\\", "/"))
    if (entry.isDirectory()) paths.push(...collectPaths(path))
  }
  return paths
}

function isHash(value: string): boolean { return /^[a-f0-9]{64}$/.test(value) }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex") }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
