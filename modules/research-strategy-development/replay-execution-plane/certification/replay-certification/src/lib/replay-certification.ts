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

export const REPLAY_CERTIFICATION_OWNER =
  "modules/research-strategy-development/replay-execution-plane/certification/replay-certification" as const
export const REPLAY_PLANE_ROOT =
  "modules/research-strategy-development/replay-execution-plane" as const

export function findReplayCertificationRepoRoot(start = import.meta.dir): string {
  let cursor = resolve(start)
  while (true) {
    if (existsSync(join(cursor, "package.json")) && existsSync(join(cursor, "modules"))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error("Replay certification repository root not found")
    cursor = parent
  }
}

export function loadReplayCertificationManifest(repoRoot: string): ReplayCertificationManifest {
  const path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-certification-suites.json")
  return JSON.parse(readFileSync(path, "utf8")) as ReplayCertificationManifest
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

function certificationSortKey(suite: ReplayCertificationSuite): string {
  return `${suite.classification === "canonical" ? "0" : "1"}:${suite.package_path}`
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
    const child = Bun.spawn(["bun", "run", "check"], {
      cwd: join(repoRoot, suite.package_path),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`Replay certification failed: ${suite.package_path}`)
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
