import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

export type ReplayCertificationClassification = "canonical" | "compatibility"

export interface ReplayCertificationSuite {
  classification: ReplayCertificationClassification
  package_path: string
  package_name: string
}

export interface ReplayCertificationManifest {
  schema_version: "trade.rd-replay-certification-suites.v1"
  owner: string
  execution_policy: "sorted-sequential-fail-fast-package-check"
  suites: ReplayCertificationSuite[]
}

export type ReplayProfileEvidenceDimension = "golden" | "resume" | "idempotency" | "tamper"
export type ReplayProfileEvidenceKind = "test" | "delegated-child-trial-test" | "explicit-not-supported"

export interface ReplayProfileEvidenceRef {
  kind: ReplayProfileEvidenceKind
  path?: string
  test_name?: string
}

export interface ReplayProfileEvidenceEntry {
  profile: string
  entrypoint_path: string
  entrypoint_export: string
  checkpoint_mode: string
  evidence: Record<ReplayProfileEvidenceDimension, ReplayProfileEvidenceRef>
}

export interface ReplayProfileEvidenceManifest {
  schema_version: "trade.rd-replay-profile-evidence.v1"
  owner: string
  required_dimensions: ReplayProfileEvidenceDimension[]
  profiles: ReplayProfileEvidenceEntry[]
}

export const REPLAY_CERTIFICATION_OWNER =
  "apps/research-strategy-development/replay-execution-plane/certification/replay-certification" as const
export const REPLAY_PLANE_ROOT =
  "apps/research-strategy-development/replay-execution-plane" as const

export function findReplayCertificationRepoRoot(start = import.meta.dir): string {
  let cursor = resolve(start)
  while (true) {
    if (existsSync(join(cursor, "package.json")) && existsSync(join(cursor, "apps"))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error("Replay certification repository root not found")
    cursor = parent
  }
}

export function loadReplayCertificationManifest(repoRoot: string): ReplayCertificationManifest {
  const path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-certification-suites.json")
  return JSON.parse(readFileSync(path, "utf8")) as ReplayCertificationManifest
}

export function loadReplayProfileEvidenceManifest(repoRoot: string): ReplayProfileEvidenceManifest {
  const path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-profile-evidence.json")
  return JSON.parse(readFileSync(path, "utf8")) as ReplayProfileEvidenceManifest
}

export function discoverReplayPackageRoots(repoRoot: string): string[] {
  const planeRoot = join(repoRoot, REPLAY_PLANE_ROOT)
  const roots: string[] = []
  walk(planeRoot, (path) => {
    if (path.endsWith("/package.json")) roots.push(relative(repoRoot, dirname(path)).replaceAll("\\", "/"))
  })
  return roots.sort()
}

export function assertReplayCertificationManifest(
  manifest: ReplayCertificationManifest,
  repoRoot: string,
): void {
  if (manifest.schema_version !== "trade.rd-replay-certification-suites.v1"
      || manifest.owner !== REPLAY_CERTIFICATION_OWNER
      || manifest.execution_policy !== "sorted-sequential-fail-fast-package-check") {
    throw new Error("unsupported Replay certification manifest")
  }
  const paths = manifest.suites.map((suite) => suite.package_path)
  const sortedSuites = [...manifest.suites].sort((left, right) =>
    certificationSortKey(left).localeCompare(certificationSortKey(right)))
  if (new Set(paths).size !== paths.length
      || JSON.stringify(manifest.suites) !== JSON.stringify(sortedSuites)) {
    throw new Error("Replay certification suites must be unique and sorted by classification/package path")
  }
  for (const suite of manifest.suites) {
    if (suite.classification !== "canonical" && suite.classification !== "compatibility") {
      throw new Error(`unsupported Replay certification classification: ${String(suite.classification)}`)
    }
    if (!suite.package_path.startsWith(`${REPLAY_PLANE_ROOT}/`) || suite.package_path === manifest.owner) {
      throw new Error(`Replay certification package path is outside its authority: ${suite.package_path}`)
    }
    const packageJsonPath = join(repoRoot, suite.package_path, "package.json")
    if (!existsSync(packageJsonPath)) throw new Error(`Replay certification package is missing: ${suite.package_path}`)
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: string
      scripts?: Record<string, string>
    }
    if (packageJson.name !== suite.package_name || !packageJson.scripts?.check) {
      throw new Error(`Replay certification package does not expose its declared check: ${suite.package_path}`)
    }
    if (suite.package_path === `${REPLAY_PLANE_ROOT}/runner`) {
      assertReplayRunnerCertificationScripts(packageJson.scripts)
    }
    const compatibilityPath = suite.package_path.includes("/compatibility/")
      || suite.package_path.includes("/certification/legacy-")
    if ((suite.classification === "compatibility") !== compatibilityPath) {
      throw new Error(`Replay certification suite classification/path mismatch: ${suite.package_path}`)
    }
  }
  const expected = discoverReplayPackageRoots(repoRoot).filter((path) => path !== manifest.owner)
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(expected)) {
    throw new Error("Replay certification registry must classify every Plane package exactly once")
  }
}

export function assertReplayProfileEvidenceManifest(
  manifest: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  const publicEntrypointPath = `${REPLAY_PLANE_ROOT}/runner/src/public.ts`
  const requiredDimensions: ReplayProfileEvidenceDimension[] = ["golden", "resume", "idempotency", "tamper"]
  if (manifest.schema_version !== "trade.rd-replay-profile-evidence.v1"
      || manifest.owner !== REPLAY_CERTIFICATION_OWNER
      || JSON.stringify(manifest.required_dimensions) !== JSON.stringify(requiredDimensions)) {
    throw new Error("unsupported Replay profile evidence manifest")
  }
  const profiles = manifest.profiles.map((entry) => entry.profile)
  if (new Set(profiles).size !== profiles.length
      || JSON.stringify(profiles) !== JSON.stringify([...profiles].sort())) {
    throw new Error("Replay profile evidence entries must be unique and sorted")
  }
  for (const entry of manifest.profiles) {
    const entrypointSource = readRepoFile(repoRoot, entry.entrypoint_path)
    if (entry.entrypoint_path !== publicEntrypointPath
        || !exportsName(entrypointSource, entry.entrypoint_export)) {
      throw new Error(`Replay profile entrypoint is invalid: ${entry.profile}`)
    }
    if (JSON.stringify(Object.keys(entry.evidence).sort())
        !== JSON.stringify([...requiredDimensions].sort())) {
      throw new Error(`Replay profile evidence dimensions are incomplete: ${entry.profile}`)
    }
    for (const dimension of requiredDimensions) {
      const evidence = entry.evidence[dimension]
      if (evidence.kind === "explicit-not-supported") {
        if (dimension !== "resume" || entry.checkpoint_mode !== "not-supported-no-checkpoint-writer"
            || evidence.path !== undefined || evidence.test_name !== undefined) {
          throw new Error(`Replay explicit unsupported evidence is invalid: ${entry.profile}.${dimension}`)
        }
        continue
      }
      if (evidence.kind !== "test" && evidence.kind !== "delegated-child-trial-test") {
        throw new Error(`Replay profile evidence kind is invalid: ${entry.profile}.${dimension}`)
      }
      if (!evidence.path?.endsWith(".test.ts") || !evidence.test_name) {
        throw new Error(`Replay profile test evidence is incomplete: ${entry.profile}.${dimension}`)
      }
      const testSource = readRepoFile(repoRoot, evidence.path)
      if (!testSource.includes(`test(${JSON.stringify(evidence.test_name)}`)) {
        throw new Error(`Replay profile evidence test is missing: ${entry.profile}.${dimension}`)
      }
      if (evidence.kind === "delegated-child-trial-test"
          && (dimension !== "resume" || entry.checkpoint_mode !== "child-trial-engine-checkpoints-v32-only")) {
        throw new Error(`Replay delegated resume evidence is invalid: ${entry.profile}`)
      }
    }
    const resumeKind = entry.evidence.resume.kind
    if (entry.checkpoint_mode === "resumable-engine-checkpoint-v32" && resumeKind !== "test") {
      throw new Error(`Replay resumable profile lacks direct resume evidence: ${entry.profile}`)
    }
    if (entry.checkpoint_mode === "child-trial-engine-checkpoints-v32-only"
        && resumeKind !== "delegated-child-trial-test") {
      throw new Error(`Replay child-checkpoint profile lacks delegated resume evidence: ${entry.profile}`)
    }
  }
  const publicSource = readRepoFile(repoRoot, publicEntrypointPath)
  const declaredExports = [...publicSource.matchAll(/export\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from/g)]
    .map((match) => match[1]!)
    .sort()
  const profileExports = manifest.profiles.map((entry) => entry.entrypoint_export).sort()
  if (JSON.stringify(declaredExports) !== JSON.stringify(profileExports)) {
    throw new Error("Replay public execution surface must expose exactly the four certified profiles")
  }
}

function exportsName(source: string, name: string): boolean {
  return source.includes(`export function ${name}`)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source)
}

function certificationSortKey(suite: ReplayCertificationSuite): string {
  return `${suite.classification === "canonical" ? "0" : "1"}:${suite.package_path}`
}

function readRepoFile(repoRoot: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay certification path is not repo-relative: ${path}`)
  }
  const absolutePath = join(repoRoot, path)
  if (!existsSync(absolutePath)) throw new Error(`Replay certification evidence is missing: ${path}`)
  return readFileSync(absolutePath, "utf8")
}

export async function runReplayCertification(
  manifest: ReplayCertificationManifest,
  repoRoot: string,
  scope: ReplayCertificationClassification | "all",
): Promise<void> {
  assertReplayCertificationManifest(manifest, repoRoot)
  for (const suite of manifest.suites) {
    if (scope !== "all" && suite.classification !== scope) continue
    process.stderr.write(`replay-certification: ${suite.classification} ${suite.package_path}\n`)
    const child = Bun.spawn(replayCertificationCommand(suite.package_path), {
      cwd: join(repoRoot, suite.package_path),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`Replay certification failed: ${suite.package_path}`)
  }
}

export function replayCertificationCommand(packagePath: string): string[] {
  return packagePath === `${REPLAY_PLANE_ROOT}/runner`
    ? ["bun", "run", "test:release"]
    : ["bun", "run", "check"]
}

export function assertReplayRunnerCertificationScripts(scripts: Record<string, string>): void {
  const expected = {
    "test:release": "bun run lint && bun run test",
    test: "bun run test:worker-v10 && bun run test:remaining",
    "test:worker-v10": "sh ../../../../scripts/run-exclusive-test.sh replay-runner-heavyweight env REPLAY_TEST_PROFILE=1 bun test ./src/lib/replay-decision-worker-input-assembly-v4.test.ts",
    "test:remaining": "bun run test:remaining:main && bun run test:remaining:protective-stop-cancel-cycle",
    "test:remaining:main": "sh ../../../../scripts/run-exclusive-test.sh replay-runner-heavyweight bun test ./src/lib/formal-replay-data-bundle.test.ts ./src/lib/replay-bar-linked-stop-entry-path-runner.test.ts ./src/lib/replay-durable-parent-validation-receipt.test.ts ./src/lib/replay-independent-lane-batch-runner.test.ts ./src/lib/replay-local-artifact-store.test.ts ./src/lib/replay-portfolio-two-fixed-partial-terminal-runner.test.ts ./src/lib/replay-trial-runner.test.ts ./src/scripts/main.test.ts --test-name-pattern '^(?!protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles$).*'",
    "test:remaining:protective-stop-cancel-cycle": "sh ../../../../scripts/run-exclusive-test.sh replay-runner-heavyweight bun test ./src/lib/replay-independent-lane-batch-runner.test.ts --test-name-pattern '^protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles$'",
  }
  for (const [name, command] of Object.entries(expected)) {
    if (scripts[name] !== command) throw new Error(`Replay runner certification script drifted: ${name}`)
  }
}

function walk(root: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) walk(path, visit)
    else if (entry.isFile()) visit(path.replaceAll("\\", "/"))
  }
}
