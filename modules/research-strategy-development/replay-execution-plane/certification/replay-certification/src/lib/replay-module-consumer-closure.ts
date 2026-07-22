import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, normalize, relative } from "node:path"
import ts from "typescript"
import {
  REPLAY_CERTIFICATION_OWNER,
  REPLAY_PLANE_ROOT,
} from "./replay-certification"

export type ReplayModuleClassification =
  | "canonical-runtime"
  | "canonical-certification"
  | "compatibility-runtime"
  | "compatibility-certification"
  | "certification-owner"

export interface ObservedReplayModule {
  classification: ReplayModuleClassification
  package_path: string
  package_name: string
}

export interface ObservedReplayConsumerEdge {
  consumer_path: string
  provider_path: string
}

export interface ObservedReplayModuleConsumerClosure {
  modules: ObservedReplayModule[]
  production_consumer_edges: ObservedReplayConsumerEdge[]
}

export type ReplayProductionConsumerClassification =
  | "replay-canonical-runtime"
  | "replay-compatibility-runtime"
  | "research-control-plane"
  | "forward-evidence-plane"
  | "agent-roles"

export interface ReplayModuleConsumerClosureManifest {
  schema_version: "trade.rd-replay-module-consumer-closure.v1"
  owner: string
  source_policy: "typescript-static-non-test-non-certification-imports"
  module_counts: Record<ReplayModuleClassification, number>
  production_consumer_edge_counts: Record<ReplayProductionConsumerClassification, number>
  observed_module_count: number
  observed_production_consumer_edge_count: number
  observed_closure_sha256: string
}

export function loadReplayModuleConsumerClosureManifest(
  repoRoot: string,
  path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-module-consumer-closure.json"),
): ReplayModuleConsumerClosureManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayModuleConsumerClosureManifest
}

export function assertReplayModuleConsumerClosureManifest(
  manifest: ReplayModuleConsumerClosureManifest,
  repoRoot: string,
): void {
  if (manifest.schema_version !== "trade.rd-replay-module-consumer-closure.v1"
      || manifest.owner !== REPLAY_CERTIFICATION_OWNER
      || manifest.source_policy !== "typescript-static-non-test-non-certification-imports") {
    throw new Error("unsupported Replay module/consumer closure manifest")
  }
  const observed = discoverReplayModuleConsumerClosure(repoRoot)
  const moduleCounts = countBy(observed.modules.map((entry) => entry.classification))
  const consumerClassifications = observed.production_consumer_edges.map((edge) =>
    classifyReplayProductionConsumer(edge.consumer_path, observed.modules))
  const consumerCounts = countBy(consumerClassifications)
  if (manifest.observed_module_count !== observed.modules.length
      || !sameRecord(manifest.module_counts, moduleCounts)) {
    throw new Error("Replay module/consumer closure must classify every Replay module exactly once")
  }
  if (manifest.observed_production_consumer_edge_count !== observed.production_consumer_edges.length
      || !sameRecord(manifest.production_consumer_edge_counts, consumerCounts)) {
    throw new Error("Replay module/consumer closure must classify every production consumer edge")
  }
  if (manifest.observed_closure_sha256 !== replayModuleConsumerClosureHash(observed)) {
    throw new Error("Replay module/consumer closure changed without explicit registry review")
  }
}

export function replayModuleConsumerClosureHash(
  closure: ObservedReplayModuleConsumerClosure,
): string {
  return createHash("sha256").update(stableJson(closure)).digest("hex")
}

export function classifyReplayProductionConsumer(
  consumerPath: string,
  replayModules: ObservedReplayModule[],
): ReplayProductionConsumerClassification {
  if (consumerPath.startsWith(`${REPLAY_PLANE_ROOT}/`)) {
    const owner = replayModules.find((entry) => entry.package_path === consumerPath)
    if (owner?.classification === "compatibility-runtime") return "replay-compatibility-runtime"
    if (owner?.classification === "canonical-runtime") return "replay-canonical-runtime"
    throw new Error(`unclassified Replay production consumer: ${consumerPath}`)
  }
  const scopes: Array<[string, ReplayProductionConsumerClassification]> = [
    ["modules/research-strategy-development/research-control-plane/", "research-control-plane"],
    ["modules/research-strategy-development/forward-evidence-plane/", "forward-evidence-plane"],
    ["modules/research-strategy-development/agent-roles/", "agent-roles"],
  ]
  const match = scopes.find(([prefix]) => consumerPath.startsWith(prefix))
  if (!match) throw new Error(`unclassified Replay production consumer: ${consumerPath}`)
  return match[1]
}

export function discoverReplayModuleConsumerClosure(
  repoRoot: string,
): ObservedReplayModuleConsumerClosure {
  const allPackageRoots = discoverPackageRoots(join(repoRoot, "modules"), repoRoot)
  const packageNames = new Map<string, string>()
  for (const packagePath of allPackageRoots) {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, packagePath, "package.json"), "utf8")) as {
      name?: string
    }
    if (packageJson.name) packageNames.set(packageJson.name, packagePath)
  }
  const modules = allPackageRoots
    .filter((path) => path.startsWith(`${REPLAY_PLANE_ROOT}/`))
    .map((packagePath) => ({
      classification: classifyReplayModule(packagePath),
      package_path: packagePath,
      package_name: packageName(repoRoot, packagePath),
    }))
    .sort((left, right) => left.package_path.localeCompare(right.package_path))

  const edges = new Map<string, ObservedReplayConsumerEdge>()
  for (const file of discoverTypeScriptSources(join(repoRoot, "modules"))) {
    const repoPath = relative(repoRoot, file).replaceAll("\\", "/")
    if (isNonProductionSource(repoPath)) continue
    const consumerPath = owningPackage(repoPath, allPackageRoots)
    if (!consumerPath) continue
    const source = ts.createSourceFile(
      repoPath,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ESNext,
      true,
      scriptKind(repoPath),
    )
    for (const specifier of staticModuleSpecifiers(source)) {
      const providerPath = resolveProviderPackage(
        specifier,
        repoPath,
        allPackageRoots,
        packageNames,
      )
      if (!providerPath?.startsWith(`${REPLAY_PLANE_ROOT}/`) || providerPath === consumerPath) continue
      const edge = { consumer_path: consumerPath, provider_path: providerPath }
      edges.set(`${edge.consumer_path} -> ${edge.provider_path}`, edge)
    }
  }
  return {
    modules,
    production_consumer_edges: [...edges.values()].sort((left, right) =>
      `${left.consumer_path} -> ${left.provider_path}`.localeCompare(
        `${right.consumer_path} -> ${right.provider_path}`,
      )),
  }
}

export function classifyReplayModule(packagePath: string): ReplayModuleClassification {
  if (packagePath === REPLAY_CERTIFICATION_OWNER) return "certification-owner"
  if (packagePath.includes("/certification/legacy-")) return "compatibility-certification"
  if (packagePath.includes("/compatibility/")) return "compatibility-runtime"
  if (packagePath.includes("/certification/") || packagePath === `${REPLAY_PLANE_ROOT}/tests`) {
    return "canonical-certification"
  }
  return "canonical-runtime"
}

function resolveProviderPackage(
  specifier: string,
  sourcePath: string,
  packageRoots: string[],
  packageNames: Map<string, string>,
): string | null {
  if (specifier.startsWith(".")) {
    const resolved = normalize(join(dirname(sourcePath), specifier)).replaceAll("\\", "/")
    return owningPackage(resolved, packageRoots)
  }
  return packageNames.get(specifier) ?? null
}

function staticModuleSpecifiers(source: ts.SourceFile): string[] {
  const values: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      values.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
      values.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return values
}

function owningPackage(path: string, packageRoots: string[]): string | null {
  let owner: string | null = null
  for (const root of packageRoots) {
    const containsPath = path === root || path.startsWith(`${root}/`)
    if (containsPath && (!owner || root.length > owner.length)) owner = root
  }
  return owner
}

function isNonProductionSource(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
    || path.includes("/certification/")
    || path.startsWith(`${REPLAY_PLANE_ROOT}/tests/`)
}

function discoverPackageRoots(root: string, repoRoot: string): string[] {
  const roots: string[] = []
  walk(root, (path) => {
    if (path.endsWith("/package.json")) {
      roots.push(relative(repoRoot, dirname(path)).replaceAll("\\", "/"))
    }
  })
  return roots.sort()
}

function discoverTypeScriptSources(root: string): string[] {
  const sources: string[] = []
  walk(root, (path) => {
    if (/\.[cm]?[jt]sx?$/.test(path)) sources.push(path)
  })
  return sources
}

function packageName(repoRoot: string, packagePath: string): string {
  const value = JSON.parse(readFileSync(join(repoRoot, packagePath, "package.json"), "utf8")) as {
    name?: string
  }
  if (!value.name) throw new Error(`Replay module package name is missing: ${packagePath}`)
  return value.name
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function walk(root: string, visit: (path: string) => void): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "tmp") continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) walk(path, visit)
    else if (entry.isFile()) visit(path.replaceAll("\\", "/"))
  }
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const counts = {} as Record<T, number>
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function sameRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
