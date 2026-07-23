import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export const REPLAY_RELEASE_AUDIT_OWNER =
  "modules/research-strategy-development/research-control-plane/certification/replay-release-audit"
const SUBJECT_OWNER =
  "modules/research-strategy-development/replay-execution-plane/certification/replay-certification"

interface AuditSubject {
  owner: string
  fixture_pack_path: string
  fixture_pack_content_sha256: string
  fixture_pack_sha256: string
}

export interface AuditCommand {
  role: string
  cwd: string
  argv: string[]
  timeout_ms: number
}

interface AuditSourceBinding {
  role: string
  path: string
}

export interface ReplayIndependentReleaseAuditManifest {
  schema_version: "trade.rd-replay-independent-release-audit.v1"
  owner: string
  subject: AuditSubject
  independence_policy: string
  verification_policy: string
  verdict_scope: string
  required_exit_gates: { m4: string[]; m5_pre_audit: string[] }
  commands: AuditCommand[]
  negative_challenges: string[]
  source_bindings: AuditSourceBinding[]
  limitations: string[]
  audit_manifest_sha256: string
}

export interface ReplayMaturityForIndependentAudit {
  schema_version: string
  maturity: number
  maturity_scale: number
  convergence_workstream: { status: string }
  exit_gates: Record<string, Record<string, boolean>>
  next_allowed_outcome: string
}

interface AuditedComponent {
  role: string
  path: string
  content_sha256: string
  authority_hash_field: string | null
  authority_hash: string | null
}

interface AuditedProfile {
  profile: string
  golden_path: string
  golden_test_name: string
}

interface AuditedFixturePack {
  schema_version: string
  owner: string
  freeze_policy: string
  verdict_policy: string
  components: AuditedComponent[]
  profiles: AuditedProfile[]
  limitations: string[]
  pack_sha256: string
  [key: string]: unknown
}

export interface ReplayIndependentAuditCommandReceipt {
  role: string
  process_id: number
  exit_code: number
  stdout_sha256: string
  stderr_sha256: string
}

export interface ReplayIndependentReleaseAuditReceipt {
  schema_version: "trade.rd-replay-independent-release-audit-receipt.v1"
  verdict: "passed-within-declared-evidence-envelope"
  audit_manifest_sha256: string
  subject_pack_sha256: string
  runtime: { name: "bun"; version: string }
  negative_challenges: Array<{ challenge: string; outcome: "rejected" }>
  commands: ReplayIndependentAuditCommandReceipt[]
  limitations: string[]
  receipt_sha256: string
}

const EXPECTED_COMPONENTS: Array<Pick<AuditedComponent, "role" | "path" | "authority_hash_field">> = [
  { role: "canonical-result-fixture", path: "modules/research-strategy-development/replay-execution-plane/tests/src/fixtures/certified-single-position-v24.json", authority_hash_field: null },
  { role: "public-profile-evidence-registry", path: `${SUBJECT_OWNER}/replay-profile-evidence.json`, authority_hash_field: null },
  { role: "certification-suite-registry", path: `${SUBJECT_OWNER}/replay-certification-suites.json`, authority_hash_field: null },
  { role: "evidence-epoch-registry", path: "docs/research/reliability/rd-replay-evidence-epoch-registry.json", authority_hash_field: null },
  { role: "module-consumer-closure", path: `${SUBJECT_OWNER}/replay-module-consumer-closure.json`, authority_hash_field: "observed_closure_sha256" },
  { role: "cross-process-reproducibility", path: `${SUBJECT_OWNER}/replay-cross-process-reproducibility-bundle.json`, authority_hash_field: "bundle_sha256" },
  { role: "historical-artifact-migration-registry", path: `${SUBJECT_OWNER}/replay-historical-artifact-migration.json`, authority_hash_field: "registry_sha256" },
  { role: "historical-artifact-fixture-pack", path: "modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/fixtures/historical-artifact-read-migration-v1.json", authority_hash_field: "pack_hash" },
  { role: "publication-crash-recovery", path: `${SUBJECT_OWNER}/replay-publication-crash-recovery-bundle.json`, authority_hash_field: "bundle_sha256" },
  { role: "capacity-performance-envelope", path: `${SUBJECT_OWNER}/replay-capacity-performance-envelope.json`, authority_hash_field: "bundle_sha256" },
  { role: "fault-corruption-recovery", path: `${SUBJECT_OWNER}/replay-fault-corruption-recovery-bundle.json`, authority_hash_field: "bundle_sha256" },
  { role: "operational-readiness", path: `${SUBJECT_OWNER}/replay-operational-readiness.json`, authority_hash_field: "registry_sha256" },
]

const EXPECTED_PROFILES = [
  "independent-lane-batch",
  "integrated-portfolio",
  "single-trial",
  "terminal-aware-bounded-cycle",
]

const EXPECTED_M4_GATES = [
  "p1_through_p29_inventory_frozen",
  "canonical_public_entrypoints_declared",
  "opt_in_activation_registry_complete",
  "compatibility_consumers_isolated",
  "result_artifact_and_checkpoint_epochs_converged",
  "single_owner_certification_command",
  "canonical_and_compatibility_test_suites_separated",
  "all_supported_profiles_have_golden_resume_idempotency_and_tamper_evidence",
  "no_unclassified_replay_module_or_production_consumer",
]

const EXPECTED_M5_PRE_AUDIT_GATES = [
  "m4_exit_complete",
  "cross_process_reproducibility_bundle",
  "historical_artifact_read_migration_certified",
  "crash_recovery_and_exactly_once_publication_certified",
  "declared_capacity_and_performance_envelope_certified",
  "fault_injection_and_corruption_recovery_certified",
  "operational_observability_and_runbook_complete",
  "release_candidate_fixture_pack_frozen",
]

const EXPECTED_COMMANDS: AuditCommand[] = [
  {
    role: "subject-full-certification",
    cwd: SUBJECT_OWNER,
    argv: ["bun", "run", "certify"],
    timeout_ms: 600_000,
  },
  {
    role: "repository-audit-prerequisite-check",
    cwd: ".",
    argv: ["bun", "scripts/check-rd-replay-maturity-gate.ts", "--audit-prerequisites"],
    timeout_ms: 30_000,
  },
]

const EXPECTED_CHALLENGES = [
  "component-content-tamper",
  "component-authority-tamper",
  "release-verdict-overclaim",
]

const EXPECTED_SOURCE_BINDINGS = [
  { role: "independent-auditor", path: `${REPLAY_RELEASE_AUDIT_OWNER}/src/lib/replay-independent-release-audit.ts` },
  { role: "independent-auditor-test", path: `${REPLAY_RELEASE_AUDIT_OWNER}/src/lib/replay-independent-release-audit.test.ts` },
  { role: "maturity-gate-consumer", path: "scripts/check-rd-replay-maturity-gate.ts" },
]

const EXPECTED_LIMITATIONS = [
  "audit-subject-is-synthetic-and-owner-test-evidence-not-production-history-corpus",
  "audit-does-not-prove-cross-host-or-cross-runtime-parity",
  "audit-does-not-expand-public-profiles-or-simulator-semantics",
  "remote-distributed-store-shadow-live-and-real-account-evidence-out-of-scope",
]

export function findReplayReleaseAuditRepoRoot(start = import.meta.dir): string {
  let current = start
  while (true) {
    if (existsSync(join(current, "toolset.json"))
        && existsSync(join(current, "docs/research/reliability/rd-replay-maturity-gate.json"))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) throw new Error("cannot locate Replay release audit repository root")
    current = parent
  }
}

export function loadReplayIndependentReleaseAuditManifest(
  repoRoot: string,
  path = join(repoRoot, REPLAY_RELEASE_AUDIT_OWNER, "replay-independent-release-audit.json"),
): ReplayIndependentReleaseAuditManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayIndependentReleaseAuditManifest
}

export function loadReplayMaturityForIndependentAudit(
  repoRoot: string,
): ReplayMaturityForIndependentAudit {
  return JSON.parse(readFileSync(
    join(repoRoot, "docs/research/reliability/rd-replay-maturity-gate.json"),
    "utf8",
  )) as ReplayMaturityForIndependentAudit
}

export function loadReplayIndependentReleaseAuditReceipt(
  repoRoot: string,
  path = join(repoRoot, REPLAY_RELEASE_AUDIT_OWNER, "replay-independent-release-audit-receipt.json"),
): ReplayIndependentReleaseAuditReceipt {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayIndependentReleaseAuditReceipt
}

export function assertReplayIndependentReleaseAuditManifest(
  manifest: ReplayIndependentReleaseAuditManifest,
  maturity: ReplayMaturityForIndependentAudit,
  repoRoot: string,
): void {
  if (manifest.schema_version !== "trade.rd-replay-independent-release-audit.v1"
      || manifest.owner !== REPLAY_RELEASE_AUDIT_OWNER
      || manifest.subject.owner !== SUBJECT_OWNER
      || manifest.subject.fixture_pack_path !== `${SUBJECT_OWNER}/replay-release-candidate-fixture-pack.json`
      || manifest.independence_policy !== "auditor-outside-subject-owner-no-subject-implementation-import"
      || manifest.verification_policy !== "independent-pack-and-component-rehash-negative-challenges-then-full-certify"
      || manifest.verdict_scope !== "release-grade-only-within-frozen-four-profile-declared-evidence-envelope") {
    throw new Error("unsupported Replay independent release audit manifest")
  }
  const auditorOwner: string = manifest.owner
  const subjectOwner: string = manifest.subject.owner
  if (auditorOwner === subjectOwner || auditorOwner.startsWith(`${subjectOwner}/`)) {
    throw new Error("Replay release auditor is not independent from the subject owner")
  }
  if (JSON.stringify(manifest.required_exit_gates.m4) !== JSON.stringify(EXPECTED_M4_GATES)
      || JSON.stringify(manifest.required_exit_gates.m5_pre_audit)
        !== JSON.stringify(EXPECTED_M5_PRE_AUDIT_GATES)
      || JSON.stringify(manifest.commands) !== JSON.stringify(EXPECTED_COMMANDS)
      || JSON.stringify(manifest.negative_challenges) !== JSON.stringify(EXPECTED_CHALLENGES)
      || JSON.stringify(manifest.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay independent release audit coverage is incomplete")
  }
  assertCompleteMaturity(maturity)
  if (manifest.source_bindings.length !== EXPECTED_SOURCE_BINDINGS.length) {
    throw new Error("Replay independent audit source bindings are incomplete")
  }
  manifest.source_bindings.forEach((binding, index) => {
    const expected = EXPECTED_SOURCE_BINDINGS[index]!
    if (binding.role !== expected.role || binding.path !== expected.path) {
      throw new Error(`Replay independent audit source identity drifted: ${binding.role}`)
    }
    const source = readRepoSource(repoRoot, binding.path)
    if (binding.role === "independent-auditor"
        && /from\s+["'][^"']*replay-certification\//.test(source)) {
      throw new Error("Replay independent auditor imports subject-owner implementation")
    }
  })
  const fixtureSource = readRepoSource(repoRoot, manifest.subject.fixture_pack_path)
  if (sha256(fixtureSource) !== manifest.subject.fixture_pack_content_sha256) {
    throw new Error("Replay independent audit subject fixture-pack content drifted")
  }
  const fixturePack = JSON.parse(fixtureSource) as AuditedFixturePack
  assertAuditedFixturePack(fixturePack, repoRoot)
  if (fixturePack.pack_sha256 !== manifest.subject.fixture_pack_sha256) {
    throw new Error("Replay independent audit subject fixture-pack authority drifted")
  }
  if (manifest.audit_manifest_sha256 !== replayIndependentReleaseAuditManifestHash(manifest)) {
    throw new Error("Replay independent release audit manifest hash drifted")
  }
}

export async function runReplayIndependentReleaseAudit(
  manifest: ReplayIndependentReleaseAuditManifest,
  maturity: ReplayMaturityForIndependentAudit,
  repoRoot: string,
): Promise<ReplayIndependentReleaseAuditReceipt> {
  assertReplayIndependentReleaseAuditManifest(manifest, maturity, repoRoot)
  const fixturePack = JSON.parse(readRepoSource(
    repoRoot,
    manifest.subject.fixture_pack_path,
  )) as AuditedFixturePack
  const negativeChallenges = runNegativeChallenges(fixturePack, repoRoot)
  const commands: ReplayIndependentAuditCommandReceipt[] = []
  for (const command of manifest.commands) {
    commands.push(await runReplayIndependentAuditCommand(command, repoRoot))
  }
  if (new Set(commands.map((command) => command.process_id)).size !== commands.length) {
    throw new Error("Replay independent audit commands did not run in distinct fresh processes")
  }
  const body = {
    schema_version: "trade.rd-replay-independent-release-audit-receipt.v1" as const,
    verdict: "passed-within-declared-evidence-envelope" as const,
    audit_manifest_sha256: manifest.audit_manifest_sha256,
    subject_pack_sha256: manifest.subject.fixture_pack_sha256,
    runtime: { name: "bun" as const, version: Bun.version },
    negative_challenges: negativeChallenges,
    commands,
    limitations: [...manifest.limitations],
  }
  return { ...body, receipt_sha256: sha256(stableJson(body)) }
}

export function assertReplayIndependentReleaseAuditReceipt(
  receipt: ReplayIndependentReleaseAuditReceipt,
  manifest: ReplayIndependentReleaseAuditManifest,
): void {
  if (receipt.schema_version !== "trade.rd-replay-independent-release-audit-receipt.v1"
      || receipt.verdict !== "passed-within-declared-evidence-envelope"
      || receipt.audit_manifest_sha256 !== manifest.audit_manifest_sha256
      || receipt.subject_pack_sha256 !== manifest.subject.fixture_pack_sha256
      || receipt.runtime.name !== "bun" || !receipt.runtime.version) {
    throw new Error("unsupported Replay independent release audit receipt")
  }
  if (JSON.stringify(receipt.negative_challenges)
      !== JSON.stringify(EXPECTED_CHALLENGES.map((challenge) => ({ challenge, outcome: "rejected" })))
      || JSON.stringify(receipt.commands.map((command) => command.role))
        !== JSON.stringify(EXPECTED_COMMANDS.map((command) => command.role))
      || receipt.commands.some((command) => command.exit_code !== 0
        || !Number.isSafeInteger(command.process_id) || command.process_id <= 0
        || !/^[a-f0-9]{64}$/.test(command.stdout_sha256)
        || !/^[a-f0-9]{64}$/.test(command.stderr_sha256))
      || new Set(receipt.commands.map((command) => command.process_id)).size
        !== receipt.commands.length
      || JSON.stringify(receipt.limitations) !== JSON.stringify(EXPECTED_LIMITATIONS)) {
    throw new Error("Replay independent release audit receipt evidence is incomplete")
  }
  const { receipt_sha256: _receiptHash, ...body } = receipt
  if (receipt.receipt_sha256 !== sha256(stableJson(body))) {
    throw new Error("Replay independent release audit receipt hash drifted")
  }
}

export function replayIndependentReleaseAuditManifestHash(
  manifest: ReplayIndependentReleaseAuditManifest,
): string {
  const { audit_manifest_sha256: _manifestHash, ...body } = manifest
  return sha256(stableJson(body))
}

function assertCompleteMaturity(maturity: ReplayMaturityForIndependentAudit): void {
  if (maturity.schema_version !== "trade.rd-replay-maturity-gate.v2"
      || maturity.maturity !== 5 || maturity.maturity_scale !== 5
      || maturity.convergence_workstream.status !== "complete"
      || maturity.next_allowed_outcome
        !== "maintenance-only-new-capability-requires-explicit-reopen-decision") {
    throw new Error("Replay independent audit requires the complete M5 maturity state")
  }
  for (const gate of EXPECTED_M4_GATES) {
    if (maturity.exit_gates.m4?.[gate] !== true) {
      throw new Error(`Replay independent audit prerequisite gate is not closed: m4.${gate}`)
    }
  }
  for (const gate of [...EXPECTED_M5_PRE_AUDIT_GATES, "independent_release_audit_passed"]) {
    if (maturity.exit_gates.m5?.[gate] !== true) {
      throw new Error(`Replay independent audit prerequisite gate is not closed: m5.${gate}`)
    }
  }
}

function assertAuditedFixturePack(pack: AuditedFixturePack, repoRoot: string): void {
  if (pack.schema_version !== "trade.rd-replay-release-candidate-fixture-pack.v1"
      || pack.owner !== SUBJECT_OWNER
      || pack.freeze_policy
        !== "closed-world-repo-relative-content-addressed-components-no-generated-result-copy"
      || pack.verdict_policy !== "fixture-pack-is-candidate-evidence-not-independent-release-verdict") {
    throw new Error("unsupported independently audited Replay fixture pack")
  }
  if (pack.components.length !== EXPECTED_COMPONENTS.length
      || pack.profiles.map((profile) => profile.profile).join("|") !== EXPECTED_PROFILES.join("|")
      || !pack.limitations.includes("fixture-pack-does-not-authorize-release-without-independent-audit")) {
    throw new Error("independently audited Replay fixture-pack closure is incomplete")
  }
  pack.components.forEach((component, index) => {
    const expected = EXPECTED_COMPONENTS[index]!
    if (component.role !== expected.role || component.path !== expected.path
        || component.authority_hash_field !== expected.authority_hash_field) {
      throw new Error(`independently audited Replay component identity drifted: ${component.role}`)
    }
    const source = readRepoSource(repoRoot, component.path)
    if (sha256(source) !== component.content_sha256) {
      throw new Error(`independently audited Replay component content drifted: ${component.role}`)
    }
    const document = JSON.parse(source) as Record<string, unknown>
    if (component.authority_hash_field === null) {
      if (component.authority_hash !== null) {
        throw new Error(`independently audited Replay component invents authority: ${component.role}`)
      }
    } else if (document[component.authority_hash_field] !== component.authority_hash) {
      throw new Error(`independently audited Replay component authority drifted: ${component.role}`)
    }
  })
  for (const profile of pack.profiles) {
    const source = readRepoSource(repoRoot, profile.golden_path)
    if (!source.includes(`test(${JSON.stringify(profile.golden_test_name)}`)) {
      throw new Error(`independently audited Replay profile golden drifted: ${profile.profile}`)
    }
  }
  const { pack_sha256: _packHash, ...body } = pack
  if (pack.pack_sha256 !== sha256(stableJson(body))) {
    throw new Error("independently audited Replay fixture-pack self hash drifted")
  }
}

function runNegativeChallenges(
  fixturePack: AuditedFixturePack,
  repoRoot: string,
): Array<{ challenge: string; outcome: "rejected" }> {
  const challenges: Array<[string, AuditedFixturePack, string]> = []
  const contentTamper = structuredClone(fixturePack)
  contentTamper.components[0]!.content_sha256 = "0".repeat(64)
  challenges.push(["component-content-tamper", contentTamper, "component content drifted"])
  const authorityTamper = structuredClone(fixturePack)
  authorityTamper.components[5]!.authority_hash = "0".repeat(64)
  challenges.push(["component-authority-tamper", authorityTamper, "component authority drifted"])
  const verdictOverclaim = structuredClone(fixturePack)
  verdictOverclaim.verdict_policy = "fixture-pack-is-unbounded-production-release-verdict"
  challenges.push(["release-verdict-overclaim", verdictOverclaim, "unsupported independently audited"])
  return challenges.map(([challenge, pack, expectedError]) => {
    try {
      assertAuditedFixturePack(pack, repoRoot)
    } catch (error) {
      if (error instanceof Error && error.message.includes(expectedError)) {
        return { challenge, outcome: "rejected" as const }
      }
      throw error
    }
    throw new Error(`Replay independent audit negative challenge was accepted: ${challenge}`)
  })
}

export async function runReplayIndependentAuditCommand(
  command: AuditCommand,
  repoRoot: string,
): Promise<ReplayIndependentAuditCommandReceipt> {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.startsWith("RD_REPLAY_")) delete environment[key]
  }
  const outputRoot = mkdtempSync(join(tmpdir(), "replay-release-audit-command-"))
  const stdoutPath = join(outputRoot, "stdout.log")
  const stderrPath = join(outputRoot, "stderr.log")
  const cleanupOutput = () => rmSync(outputRoot, { recursive: true, force: true })
  const child = Bun.spawn(command.argv, {
    cwd: join(repoRoot, command.cwd),
    env: environment,
    stdout: Bun.file(stdoutPath),
    stderr: Bun.file(stderrPath),
    detached: process.platform !== "win32",
  })
  let timedOut = false
  let forceKill: ReturnType<typeof setTimeout> | undefined
  const timeout = setTimeout(() => {
    timedOut = true
    signalAuditCommandTree(child.pid, "SIGTERM")
    forceKill = setTimeout(() => signalAuditCommandTree(child.pid, "SIGKILL"), 1_000)
  }, command.timeout_ms)
  const exitCode = await child.exited
  clearTimeout(timeout)
  if (timedOut) signalAuditCommandTree(child.pid, "SIGKILL")
  if (forceKill) clearTimeout(forceKill)
  const stdout = readFileSync(stdoutPath, "utf8")
  const stderr = readFileSync(stderrPath, "utf8")
  if (timedOut) {
    cleanupOutput()
    throw new Error(`Replay independent audit command timed out: ${command.role}`)
  }
  if (exitCode !== 0) {
    cleanupOutput()
    throw new Error(`Replay independent audit command failed: ${command.role}\n${stderr || stdout}`)
  }
  const receipt = {
    role: command.role,
    process_id: child.pid,
    exit_code: exitCode,
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(stderr),
  }
  cleanupOutput()
  return receipt
}

function signalAuditCommandTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ESRCH") throw error
  }
}

function readRepoSource(repoRoot: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay independent audit path is not repo-relative: ${path}`)
  }
  const absolute = join(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Replay independent audit source is missing: ${path}`)
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
