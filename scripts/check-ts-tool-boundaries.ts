#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import ts from "typescript"

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
const toolPackageRoots = toolPackages.map((pkg) => dirname(pkg.packagePath).replace(/\\/g, "/"))
const issues: string[] = []

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

for (const file of walkTsFiles("modules")) {
  const sourceTool = owningToolRoot(file)
  const content = readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

  visit(sourceFile, (specifier) => {
    if (toolPackageNames.has(specifier)) {
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
  })
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
    "modules/research-strategy-development/replay-execution-plane/compatibility/benchmark-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine -> modules/research-strategy-development/replay-execution-plane/accounting",
    "modules/research-strategy-development/replay-execution-plane/compatibility/benchmark-runner -> modules/research-strategy-development/replay-execution-plane/compatibility/benchmark-engine",
    "modules/research-strategy-development/replay-execution-plane/certification/calibration-suite -> modules/research-strategy-development/replay-execution-plane/compatibility/benchmark-engine",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/forward-evidence-plane/compatibility/forward-holdout -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/forward-evidence-plane/compatibility/forward-holdout -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/forward-evidence-plane/compatibility/forward-holdout -> modules/research-strategy-development/agent-roles/developer/signal-engine",
    "modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> modules/research-strategy-development/replay-execution-plane/compatibility/benchmark-engine",
    "modules/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/replay-execution-plane/compatibility/panel-evaluator -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/replay-execution-plane/compatibility/panel-evaluator -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/research-control-plane/experiment-ledger",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "modules/research-strategy-development/agent-roles/developer/rd-campaign-runner -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/research-control-plane/experiment-ledger -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/research-control-plane/experiment-ledger",
    "modules/research-strategy-development/agent-roles/developer/rd-loop-runner -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/program-control -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/forward-evidence-plane/compatibility/rd-shadow-tracker -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/rd-campaign-runner",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/program-control",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/research-control-plane/program-supervisor -> modules/research-strategy-development/research-control-plane/strategy-policy-writer",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/replay-execution-plane/runner",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/replay-recovery -> modules/research-strategy-development/research-control-plane/state-store",
    "modules/research-strategy-development/replay-execution-plane/compatibility/replay-runner -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/replay-execution-plane/compatibility/replay-runner -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/compatibility/replay-runner -> modules/research-strategy-development/replay-execution-plane/runner",
    "modules/research-strategy-development/replay-execution-plane/compatibility/replay-runner -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/state-store -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/state-store -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/research-control-plane/strategy-registry -> modules/research-strategy-development/research-control-plane/contracts",
    "modules/research-strategy-development/research-control-plane/strategy-registry -> modules/research-strategy-development/research-control-plane/strategy-policy-writer",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/data-adapter",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/accounting",
    "modules/research-strategy-development/replay-execution-plane/engine -> modules/research-strategy-development/replay-execution-plane/metrics",
    "modules/research-strategy-development/replay-execution-plane/data-adapter -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/accounting -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/metrics -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/replay-execution-plane/contracts",
    "modules/research-strategy-development/replay-execution-plane/runner -> modules/research-strategy-development/replay-execution-plane/engine",
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
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
    "modules/research-strategy-development/agent-roles/developer/signal-engine -> modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "modules/research-strategy-development/agent-roles/reviewer/signal-evaluator -> modules/research-strategy-development/agent-roles/developer/signal-engine",
    "modules/research-strategy-development/agent-roles/developer/strategy-family-engine -> modules/research-strategy-development/replay-execution-plane/compatibility/replay-engine",
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

function visit(node: ts.Node, onSpecifier: (specifier: string) => void): void {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    onSpecifier(node.moduleSpecifier.text)
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [arg] = node.arguments
    if (arg && ts.isStringLiteral(arg)) {
      onSpecifier(arg.text)
    }
  }
  ts.forEachChild(node, (child) => visit(child, onSpecifier))
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

function walkTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(path))
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path)
    }
  }
  return files
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
