#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import ts from "typescript"
import { inspectModuleReferences, isJavaScriptOrTypeScript, isTestSource, scriptKind } from "./lib/source-import-inspection"

type JSONRecord = Record<string, unknown>

interface ToolPackage {
  entry: string
  packagePath: string
  name: string
  dependencies: Record<string, string>
}

const rootPkg = readJson("package.json")
const rootDeps = {
  ...stringMap(rootPkg.dependencies),
  ...stringMap(rootPkg.devDependencies),
}
const toolPackages = readToolPackages()
const toolPackageNames = new Set(toolPackages.map((pkg) => pkg.name).filter(Boolean))
const toolPackageRootByName = new Map(toolPackages.filter((pkg) => pkg.name).map((pkg) => [pkg.name, dirname(pkg.packagePath).replace(/\\/g, "/")]))
const toolPackageRoots = toolPackages.map((pkg) => dirname(pkg.packagePath).replace(/\\/g, "/"))
const issues: string[] = []
const observedEdges = new Set<string>()

for (const pkg of toolPackages) {
  for (const [dep, version] of Object.entries(pkg.dependencies)) {
    const rootVersion = rootDeps[dep]
    if (rootVersion == null) {
      issues.push(`root package.json is missing dependency declared by ${pkg.packagePath}: ${dep}@${version}`)
    } else if (rootVersion !== version) {
      issues.push(`${pkg.packagePath}: ${dep} version ${version} differs from root package.json ${rootVersion}`)
    }
    if (toolPackageNames.has(dep)) {
      issues.push(`${pkg.packagePath}: TS tools must not depend on other tool packages: ${dep}`)
    }
  }
}

for (const file of walkSourceFiles("modules")) {
  const sourceTool = owningToolRoot(file)
  const content = readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true, scriptKind(file))

  inspectModuleReferences(sourceFile, { onSpecifier: (specifier) => {
    if (toolPackageNames.has(specifier)) {
      const targetTool = toolPackageRootByName.get(specifier) ?? ""
      if (sourceTool && targetTool && sourceTool !== targetTool) observedEdges.add(`${sourceTool} -> ${targetTool}`)
      issues.push(`${file}: package import ${specifier}`)
      return
    }
    if (!specifier.startsWith(".")) {
      return
    }

    const resolved = normalize(join(dirname(file), specifier)).replace(/\\/g, "/")
    const parts = resolved.split(/[\\/]/)
    if (parts[0] !== "modules") {
      return
    }
    if (parts[1] === "contracts") {
      return
    }
    const targetTool = owningToolRoot(resolved)
    if (sourceTool && targetTool && sourceTool !== targetTool) observedEdges.add(`${sourceTool} -> ${targetTool}`)
    if (isAllowedCrossToolImport(file, sourceTool, targetTool)) {
      return
    }
    if (isAllowedResearchStrategyDevelopmentImport(sourceTool, targetTool)) {
      return
    }
    if (isAllowedSameDomainIntegrationTestImport(file, sourceTool, targetTool)) {
      return
    }
    if (isAllowedTradeFlowOrchestratorImport(file, sourceTool, targetTool)) {
      return
    }
    if (targetTool && sourceTool && targetTool !== sourceTool) {
      issues.push(`${file}: ${specifier} -> ${targetTool}`)
    }
  }, onNonStatic: (kind) => {
    if (!isTestSource(file)) issues.push(`${file}: ${kind} must use a static string literal`)
  }, onForbiddenRuntime: (kind) => issues.push(`${file}: forbidden runtime code loading via ${kind}`) })
}

for (const cycle of findCycles(observedEdges)) {
  issues.push(`cyclic TS package dependency: ${cycle.join(" -> ")}`)
}

function isAllowedCrossToolImport(file: string, sourceTool: string, targetTool: string): boolean {
  const alwaysAllowed = new Set([
    "modules/portfolio-execution-state/flow-projector -> modules/portfolio-execution-state/event-store",
    "modules/live-decision-planning/slow-track-plan -> modules/live-decision-planning/observe-runner",
    "modules/live-decision-planning/observe-runner -> modules/live-decision-planning/observe-builder",
    "modules/live-execution-control/fast-track-guard -> modules/live-execution-control/execution-gate",
    "modules/live-execution-control/recovery-runner -> modules/live-execution-control/execution-recorder",
    "modules/live-execution-control/recovery-runner -> modules/live-execution-control/reconcile-drafts",
    "modules/live-execution-control/execution-flow-runner -> modules/live-execution-control/execution-recorder",
    "modules/live-execution-control/execution-flow-runner -> modules/live-execution-control/execution-gate",
    "modules/live-execution-control/live-small-runner -> modules/live-execution-control/execution-flow-runner",
    "modules/live-execution-control/live-small-runner -> modules/live-execution-control/execution-gate",
    "modules/live-execution-control/live-small-runner -> modules/live-execution-control/execution-router",
    "modules/live-execution-control/live-small-runner -> modules/live-execution-control/execution-recorder",
    "modules/market-data-products/ohlcv-fetch -> modules/market-data-products/market-data-store",
    "modules/market-data-products/binance-read/instrument-status-collector -> modules/market-data-products/market-data-store",
    "modules/market-data-products/aggregate-trade-provider -> modules/market-data-products/market-data-store",
    "modules/market-data-products/aggregate-trade-provider -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/market-data-products/instrument-status-provider -> modules/market-data-products/market-data-store",
    "modules/market-data-products/instrument-status-provider -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/exchange-gateway/binance-write/order-place -> modules/exchange-gateway/exchange-runtime-store",
    "modules/exchange-gateway/binance-write/order-cancel -> modules/exchange-gateway/exchange-runtime-store",
    "modules/exchange-gateway/binance-write/position-adjust -> modules/exchange-gateway/exchange-runtime-store",
    "modules/exchange-gateway/binance-write/position-protect -> modules/exchange-gateway/exchange-runtime-store",
    "modules/orchestration-ops/runtime-health-guard -> modules/orchestration-ops/ops-runtime-store",
    "modules/orchestration-ops/ops-notify-dispatch -> modules/orchestration-ops/ops-runtime-store",
    "modules/orchestration-ops/control-effectiveness-review -> modules/orchestration-ops/ops-runtime-store",
    "modules/orchestration-ops/domain-bus -> modules/orchestration-ops/ops-runtime-store",
    "modules/orchestration-ops/trade-flow -> modules/orchestration-ops/ops-runtime-store",
    "modules/governance-review-compliance/closed-flow-review-sweep -> modules/governance-review-compliance/governance-ledger",
  ])
  const testOnlyAllowed = new Set([
    "modules/research-strategy-development/research-control-plane/state-store -> modules/market-data-products/aggregate-trade-provider",
    "modules/research-strategy-development/research-control-plane/state-store -> modules/research-strategy-development/replay-execution-plane/data-adapter",
    "modules/live-decision-planning/slow-track-plan -> modules/policy-risk/runtime-policy-compiler",
    "modules/live-decision-planning/slow-track-plan -> modules/portfolio-execution-state/event-store",
    "modules/live-decision-planning/slow-track-plan -> modules/portfolio-execution-state/flow-projector",
    "modules/live-execution-control/fast-track-guard -> modules/live-decision-planning/observe-runner",
    "modules/live-execution-control/fast-track-guard -> modules/portfolio-execution-state/event-store",
    "modules/live-execution-control/fast-track-guard -> modules/portfolio-execution-state/flow-projector",
    "modules/live-execution-control/recovery-runner -> modules/live-decision-planning/observe-runner",
    "modules/live-execution-control/recovery-runner -> modules/portfolio-execution-state/event-store",
    "modules/live-execution-control/recovery-runner -> modules/portfolio-execution-state/flow-projector",
    "modules/live-execution-control/execution-flow-runner -> modules/portfolio-execution-state/event-store",
    "modules/live-execution-control/execution-flow-runner -> modules/portfolio-execution-state/flow-projector",
    "modules/live-execution-control/live-small-runner -> modules/live-decision-planning/observe-runner",
    "modules/live-execution-control/live-small-runner -> modules/portfolio-execution-state/event-store",
    "modules/governance-review-compliance/closed-flow-review-sweep -> modules/portfolio-execution-state/event-store",
    "modules/governance-review-compliance/closed-flow-review-sweep -> modules/portfolio-execution-state/flow-projector",
  ])
  const edge = `${sourceTool} -> ${targetTool}`
  return alwaysAllowed.has(edge)
    || (file.endsWith(".test.ts") && testOnlyAllowed.has(edge))
}

function isAllowedResearchStrategyDevelopmentImport(sourceTool: string, targetTool: string): boolean {
  if (!sourceTool.startsWith("modules/research-strategy-development/")
    || !targetTool.startsWith("modules/research-strategy-development/")) {
    return false
  }
  const allowedDomainDag = new Set([
    "modules/research-strategy-development/replay-execution-plane/benchmark -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/replay-execution-plane/benchmark -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> modules/research-strategy-development/replay-execution-plane/accounting",
    "modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/replay-execution-plane/certification/calibration-suite -> modules/research-strategy-development/replay-execution-plane/benchmark",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> modules/research-strategy-development/replay-execution-plane/benchmark",
    "modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/research-control-plane/experiment-ledger",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/research-control-plane/experiment-ledger",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/program-control -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/forward-evidence-plane/paper-tracker -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/forward-evidence-plane/paper-tracker -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/rd-campaign-runner",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/strategy-policy-writer",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/replay-execution-plane/runner",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/research-control-plane/state-store -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/state-store -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/research-control-plane/strategy-registry -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/strategy-registry -> modules/research-strategy-development/research-control-plane/strategy-policy-writer",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/data-adapter",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/accounting",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/metrics",
    "modules/research-strategy-development/replay-execution-plane/data-adapter -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/data-adapter -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/accounting -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/metrics -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/replay-execution-plane/engine",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/replay-execution-plane/accounting",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/contracts -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/contracts -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/runner -> modules/research-strategy-development/forward-evidence-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/runner -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/runner -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/forward-evidence-plane/runner -> modules/research-strategy-development/replay-execution-plane/runner",
    "modules/research-strategy-development/agent-roles/developer -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/agent-roles/developer -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/agent-roles/reviewer -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/agent-roles/reviewer -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/agent-roles/reviewer/signal-evaluator -> modules/research-strategy-development/agent-roles/developer/signal-engine",
    "modules/research-strategy-development/agent-roles/developer/strategy-family-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "modules/research-strategy-development/agent-roles/developer/strategy-family-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "modules/research-strategy-development/agent-roles/developer/strategy-family-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
  ])
  return sourceTool === "modules/research-strategy-development/research-control-plane/tests"
    || sourceTool === "modules/research-strategy-development/replay-execution-plane/tests"
    || allowedDomainDag.has(`${sourceTool} -> ${targetTool}`)
}

function isAllowedSameDomainIntegrationTestImport(file: string, sourceTool: string, targetTool: string): boolean {
  return file.endsWith(".test.ts")
    && sourceTool === "modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite"
    && targetTool.startsWith("modules/research-strategy-development/")
}

function isAllowedTradeFlowOrchestratorImport(file: string, sourceTool: string, targetTool: string): boolean {
  if (sourceTool !== "modules/orchestration-ops/trade-flow" || !targetTool.startsWith("modules/")) {
    return false
  }
  if (file.endsWith(".test.ts")) {
    return true
  }
  const allowedByFile: Record<string, Set<string>> = {
    "modules/orchestration-ops/trade-flow/src/scripts/lib/job-graph-runner.ts": new Set([
      "modules/orchestration-ops/domain-bus",
      "modules/orchestration-ops/ops-runtime-store",
    ]),
  }
  return allowedByFile[file]?.has(targetTool) === true
}

if (issues.length > 0) {
  console.error(`quality: TS tool boundary violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function readToolPackages(): ToolPackage[] {
  const packages: ToolPackage[] = []
  for (const packagePath of findPackageJson("modules")) {
    const pkg = readJson(packagePath)
    const name = typeof pkg.name === "string" ? pkg.name : ""
    packages.push({
      entry: dirname(packagePath).replace(/^modules\//, ""),
      packagePath,
      name,
      dependencies: {
        ...stringMap(pkg.dependencies),
        ...stringMap(pkg.devDependencies),
      },
    })
  }
  return packages
}

function findPackageJson(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findPackageJson(path))
    } else if (entry.isFile() && entry.name === "package.json") {
      files.push(path)
    }
  }
  return files
}

function owningToolRoot(file: string): string {
  const normalized = file.replace(/\\/g, "/")
  const sorted = [...toolPackageRoots].sort((a, b) => b.length - a.length)
  return sorted.find((root) => normalized === root || normalized.startsWith(`${root}/`)) || ""
}

function walkSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(path))
    } else if (entry.isFile() && isJavaScriptOrTypeScript(path)) {
      files.push(path)
    }
  }
  return files
}

function findCycles(edges: Set<string>): string[][] {
  const graph = new Map<string, Set<string>>()
  for (const edge of edges) {
    const [source, target] = edge.split(" -> ")
    if (!source || !target) continue
    const targets = graph.get(source) ?? new Set<string>()
    targets.add(target)
    graph.set(source, targets)
  }

  const cycles = new Map<string, string[]>()
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visitNode = (node: string): void => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      const cycle = [...stack.slice(start), node]
      const body = cycle.slice(0, -1)
      const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)])
      const canonical = rotations.map((rotation) => rotation.join(" -> ")).sort()[0]
      cycles.set(canonical, [...canonical.split(" -> "), canonical.split(" -> ")[0]])
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    stack.push(node)
    for (const target of graph.get(node) ?? []) visitNode(target)
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of graph.keys()) visitNode(node)
  return [...cycles.values()].sort((a, b) => a.join("/").localeCompare(b.join("/")))
}

function readJson(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value as JSONRecord)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}
