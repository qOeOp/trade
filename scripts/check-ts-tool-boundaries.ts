#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import * as ts from "typescript"
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

for (const lockPath of findFilesNamed("apps", "bun.lock")) {
  issues.push(`${lockPath}: tool-local bun.lock files are not allowed; use the root install lockfile`)
}

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

for (const file of walkSourceFiles("apps")) {
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
    if (parts[0] !== "apps") {
      return
    }
    if (parts[1] === "contracts") {
      return
    }
    const targetTool = owningToolRoot(resolved)
    if (sourceTool && targetTool && sourceTool !== targetTool) {
      observedEdges.add(`${sourceTool} -> ${targetTool}`)
    }
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
    "apps/portfolio-execution-state/flow-projector -> apps/portfolio-execution-state/event-store",
    "apps/live-decision-planning/slow-track-plan -> apps/live-decision-planning/observe-runner",
    "apps/live-decision-planning/slow-track-plan -> apps/live-decision-planning/decision-input-assembler",
    "apps/live-decision-planning/slow-track-plan -> apps/live-decision-planning/trade-plan-builder",
    "apps/live-decision-planning/slow-track-plan -> apps/live-decision-planning/action-intent-publisher",
    "apps/live-decision-planning/observe-runner -> apps/live-decision-planning/observe-builder",
    "apps/live-execution-control/fast-track-guard -> apps/live-execution-control/execution-gate",
    "apps/live-execution-control/recovery-runner -> apps/live-execution-control/execution-recorder",
    "apps/live-execution-control/recovery-runner -> apps/live-execution-control/reconcile-drafts",
    "apps/live-execution-control/execution-flow-runner -> apps/live-execution-control/execution-recorder",
    "apps/live-execution-control/execution-flow-runner -> apps/live-execution-control/execution-gate",
    "apps/live-execution-control/live-small-runner -> apps/live-execution-control/execution-flow-runner",
    "apps/live-execution-control/live-small-runner -> apps/live-execution-control/execution-gate",
    "apps/live-execution-control/live-small-runner -> apps/live-execution-control/execution-router",
    "apps/live-execution-control/live-small-runner -> apps/live-execution-control/execution-recorder",
    "apps/live-execution-control/live-small-runner -> apps/live-execution-control/execution-capability",
    "apps/live-execution-control/watch-handoff-revalidation -> apps/live-execution-control/execution-gate",
    "apps/market-data-products/ohlcv-fetch -> apps/market-data-products/market-data-store",
    "apps/market-data-products/binance-read/instrument-status-collector -> apps/market-data-products/market-data-store",
    "apps/market-data-products/aggregate-trade-provider -> apps/market-data-products/market-data-store",
    "apps/market-data-products/aggregate-trade-provider -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/market-data-products/instrument-status-provider -> apps/market-data-products/market-data-store",
    "apps/exchange-gateway/binance-write/order-place -> apps/exchange-gateway/exchange-runtime-store",
    "apps/exchange-gateway/binance-write/order-cancel -> apps/exchange-gateway/exchange-runtime-store",
    "apps/exchange-gateway/binance-write/position-adjust -> apps/exchange-gateway/exchange-runtime-store",
    "apps/exchange-gateway/binance-write/position-protect -> apps/exchange-gateway/exchange-runtime-store",
    "apps/orchestration-ops/runtime-health-guard -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/ops-notify-dispatch -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/control-effectiveness-review -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/domain-bus -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/agent-host-codex -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/agent-host-codex -> apps/orchestration-ops/agent-artifact-store",
    "apps/orchestration-ops/agent-host-codex -> apps/orchestration-ops/agent-workspace-manager",
    "apps/orchestration-ops/agent-host-openclaw -> apps/orchestration-ops/agent-artifact-store",
    "apps/orchestration-ops/agent-host-openclaw -> apps/orchestration-ops/ops-runtime-store",
    "apps/orchestration-ops/agent-host-openclaw -> apps/orchestration-ops/agent-workspace-manager",
    "apps/orchestration-ops/trade-flow -> apps/orchestration-ops/ops-runtime-store",
    "apps/governance-review-compliance/closed-flow-review-sweep -> apps/governance-review-compliance/governance-ledger",
  ])
  const testOnlyAllowed = new Set([
    "apps/research-strategy-development/agent-roles/reviewer/signal-evaluator -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/market-data-products/instrument-status-provider -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/market-data-products/aggregate-trade-provider",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/market-data-products/instrument-status-provider",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/market-data-products/market-data-store",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/replay-execution-plane/data-adapter",
    "apps/live-decision-planning/slow-track-plan -> apps/policy-risk/runtime-policy-compiler",
    "apps/live-decision-planning/slow-track-plan -> apps/portfolio-execution-state/event-store",
    "apps/live-decision-planning/slow-track-plan -> apps/portfolio-execution-state/flow-projector",
    "apps/live-execution-control/fast-track-guard -> apps/live-decision-planning/observe-runner",
    "apps/live-execution-control/fast-track-guard -> apps/portfolio-execution-state/event-store",
    "apps/live-execution-control/fast-track-guard -> apps/portfolio-execution-state/flow-projector",
    "apps/live-execution-control/recovery-runner -> apps/live-decision-planning/observe-runner",
    "apps/live-execution-control/recovery-runner -> apps/portfolio-execution-state/event-store",
    "apps/live-execution-control/recovery-runner -> apps/portfolio-execution-state/flow-projector",
    "apps/live-execution-control/execution-flow-runner -> apps/portfolio-execution-state/event-store",
    "apps/live-execution-control/execution-flow-runner -> apps/portfolio-execution-state/flow-projector",
    "apps/live-execution-control/live-small-runner -> apps/live-decision-planning/observe-runner",
    "apps/live-execution-control/live-small-runner -> apps/portfolio-execution-state/event-store",
    "apps/live-execution-control/live-small-runner -> apps/portfolio-execution-state/flow-projector",
    "apps/research-strategy-development/research-control-plane/dataset-governance/data-split -> apps/market-data-products/market-data-store",
    "apps/governance-review-compliance/closed-flow-review-sweep -> apps/portfolio-execution-state/event-store",
    "apps/governance-review-compliance/closed-flow-review-sweep -> apps/portfolio-execution-state/flow-projector",
  ])
  const edge = `${sourceTool} -> ${targetTool}`
  return alwaysAllowed.has(edge)
    || (file.endsWith(".test.ts") && testOnlyAllowed.has(edge))
}

function isAllowedResearchStrategyDevelopmentImport(sourceTool: string, targetTool: string): boolean {
  if (!sourceTool.startsWith("apps/research-strategy-development/")
    || !targetTool.startsWith("apps/research-strategy-development/")) {
    return false
  }
  const allowedDomainDag = new Set([
    "apps/research-strategy-development/replay-execution-plane/benchmark -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/benchmark -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/accounting",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle -> apps/research-strategy-development/replay-execution-plane/engine",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle -> apps/research-strategy-development/replay-execution-plane/accounting",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle",
    "apps/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/replay-execution-plane/certification/calibration-suite -> apps/research-strategy-development/replay-execution-plane/benchmark",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/agent-roles/developer/candidate-batch-engine -> apps/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "apps/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> apps/research-strategy-development/replay-execution-plane/benchmark",
    "apps/research-strategy-development/research-control-plane/dataset-governance/funding-governance -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/agent-roles/developer/rd-campaign-runner -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/agent-roles/developer/rd-campaign-runner -> apps/research-strategy-development/research-control-plane/experiment-ledger",
    "apps/research-strategy-development/agent-roles/developer/rd-campaign-runner -> apps/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "apps/research-strategy-development/agent-roles/developer/rd-campaign-runner -> apps/research-strategy-development/research-control-plane/program-control",
    "apps/research-strategy-development/research-control-plane/experiment-ledger -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/research-control-plane/experiment-ledger -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/research-control-plane/experiment-ledger -> apps/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "apps/research-strategy-development/agent-roles/developer/rd-loop-runner -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/agent-roles/developer/rd-loop-runner -> apps/research-strategy-development/research-control-plane/experiment-ledger",
    "apps/research-strategy-development/agent-roles/developer/rd-loop-runner -> apps/research-strategy-development/research-control-plane/program-control",
    "apps/research-strategy-development/research-control-plane/program-control -> apps/research-strategy-development/research-control-plane/state-store",
    "apps/research-strategy-development/research-control-plane/agent-run-orchestrator -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/agent-run-orchestrator -> apps/research-strategy-development/research-control-plane/state-store",
    "apps/research-strategy-development/research-control-plane/agent-run-orchestrator -> apps/research-strategy-development/agent-roles/developer",
    "apps/research-strategy-development/research-control-plane/agent-run-orchestrator -> apps/research-strategy-development/agent-roles/planner",
    "apps/research-strategy-development/forward-evidence-plane/paper-tracker -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/forward-evidence-plane/paper-tracker -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/agent-roles/developer/rd-campaign-runner",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/research-control-plane/program-control",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/research-control-plane/state-store",
    "apps/research-strategy-development/research-control-plane/program-supervisor -> apps/research-strategy-development/research-control-plane/strategy-policy-writer",
    "apps/research-strategy-development/research-control-plane/replay-recovery -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/research-control-plane/replay-recovery -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/replay-recovery -> apps/research-strategy-development/research-control-plane/state-store",
    "apps/research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/agent-roles/developer",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/agent-roles/planner",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/forward-evidence-plane/contracts",
    "apps/research-strategy-development/research-control-plane/state-store -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/research-control-plane/strategy-registry -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/strategy-registry -> apps/research-strategy-development/research-control-plane/strategy-policy-writer",
    "apps/research-strategy-development/replay-execution-plane/engine -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/engine -> apps/research-strategy-development/replay-execution-plane/data-adapter",
    "apps/research-strategy-development/replay-execution-plane/engine -> apps/research-strategy-development/replay-execution-plane/accounting",
    "apps/research-strategy-development/replay-execution-plane/engine -> apps/research-strategy-development/replay-execution-plane/metrics",
    "apps/research-strategy-development/replay-execution-plane/data-adapter -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/data-adapter -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/accounting -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/metrics -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/runner -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/runner -> apps/research-strategy-development/replay-execution-plane/data-adapter",
    "apps/research-strategy-development/replay-execution-plane/runner -> apps/research-strategy-development/replay-execution-plane/engine",
    "apps/research-strategy-development/replay-execution-plane/runner -> apps/research-strategy-development/replay-execution-plane/accounting",
    "apps/research-strategy-development/replay-execution-plane/runner -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/contracts -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/contracts -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/runner -> apps/research-strategy-development/forward-evidence-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/runner -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/runner -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/forward-evidence-plane/runner -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/agent-roles/developer -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/agent-roles/developer -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/agent-roles/planner -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/agent-roles/reviewer -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/agent-roles/reviewer -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/agent-roles/developer/signal-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision",
    "apps/research-strategy-development/agent-roles/developer/signal-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/agent-roles/developer/signal-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/agent-roles/developer/signal-engine -> apps/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "apps/research-strategy-development/agent-roles/reviewer/signal-evaluator -> apps/research-strategy-development/agent-roles/developer/signal-engine",
    "apps/research-strategy-development/agent-roles/developer/strategy-family-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/agent-roles/developer/strategy-family-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/agent-roles/developer/strategy-family-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-features",
    "apps/research-strategy-development/agent-roles/developer/strategy-family-engine -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
  ])
  return allowedDomainDag.has(`${sourceTool} -> ${targetTool}`)
}

function isAllowedSameDomainIntegrationTestImport(file: string, sourceTool: string, targetTool: string): boolean {
  const explicitIntegrationEdges = new Set([
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/engine",
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/data-adapter",
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/accounting",
    "apps/research-strategy-development/replay-execution-plane/tests -> apps/research-strategy-development/replay-execution-plane/metrics",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/research-control-plane/contracts",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/replay-execution-plane/contracts",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/agent-roles/developer",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/agent-roles/planner",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/agent-roles/reviewer",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/replay-execution-plane/runner",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/research-control-plane/state-store",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/research-control-plane/strategy-registry",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/research-control-plane/strategy-policy-writer",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/forward-evidence-plane/runner",
    "apps/research-strategy-development/research-control-plane/tests -> apps/research-strategy-development/forward-evidence-plane/contracts",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/research-control-plane/program-control",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/research-control-plane/program-supervisor",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/research-control-plane/experiment-ledger",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/agent-roles/developer/candidate-batch-engine",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/agent-roles/developer/rd-loop-runner",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/agent-roles/developer/rd-campaign-runner",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-data",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/agent-roles/developer/strategy-family-engine",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision",
    "apps/research-strategy-development/research-control-plane/certification/legacy-integration-suite -> apps/research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane",
  ])
  const integrationSource = sourceTool.endsWith("/tests") || file.endsWith(".test.ts")
  return integrationSource && explicitIntegrationEdges.has(`${sourceTool} -> ${targetTool}`)
}

function isAllowedTradeFlowOrchestratorImport(file: string, sourceTool: string, targetTool: string): boolean {
  if (sourceTool !== "apps/orchestration-ops/trade-flow" || !targetTool.startsWith("apps/")) {
    return false
  }
  const allowedByFile: Record<string, Set<string>> = {
    "apps/orchestration-ops/trade-flow/src/scripts/lib/job-graph-runner.ts": new Set([
      "apps/orchestration-ops/domain-bus",
      "apps/orchestration-ops/ops-runtime-store",
    ]),
  }
  const testOnlyAllowed = new Set([
    "apps/live-decision-planning/observe-builder",
    "apps/live-execution-control/execution-flow-runner",
    "apps/live-execution-control/execution-recorder",
    "apps/live-execution-control/execution-router",
    "apps/live-execution-control/live-small-runner",
    "apps/live-execution-control/reconcile-drafts",
    "apps/live-execution-control/recovery-runner",
    "apps/portfolio-execution-state/event-store",
    "apps/portfolio-execution-state/flow-projector",
  ])
  return allowedByFile[file]?.has(targetTool) === true
    || (file.endsWith(".test.ts") && testOnlyAllowed.has(targetTool))
}

if (issues.length > 0) {
  console.error(`quality: TS tool boundary violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function readToolPackages(): ToolPackage[] {
  const packages: ToolPackage[] = []
  for (const packagePath of findPackageJson("apps")) {
    const pkg = readJson(packagePath)
    const name = typeof pkg.name === "string" ? pkg.name : ""
    packages.push({
      entry: dirname(packagePath).replace(/^apps\//, ""),
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
  return findFilesNamed(dir, "package.json")
}

function findFilesNamed(dir: string, name: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findFilesNamed(path, name))
    } else if (entry.isFile() && entry.name === name) {
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
