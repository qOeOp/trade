#!/usr/bin/env bun

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export const convergenceMetricKeys = [
  "module_owners",
  "registered_tools",
  "architecture_domains",
  "architecture_stores",
  "architecture_jobs",
  "architecture_rails",
] as const

export type ConvergenceMetricKey = typeof convergenceMetricKeys[number]
export type ConvergenceMetrics = Record<ConvergenceMetricKey, number>

interface ConvergenceBaseline {
  schema_version: string
  recovery_freeze: boolean
  ceilings: ConvergenceMetrics
}

export function assessConvergence(
  actual: ConvergenceMetrics,
  ceilings: ConvergenceMetrics,
): string[] {
  const issues: string[] = []
  for (const key of convergenceMetricKeys) {
    if (actual[key] > ceilings[key]) {
      issues.push(`${key} grew from ceiling ${ceilings[key]} to ${actual[key]}`)
    }
  }
  return issues
}

export function collectConvergenceMetrics(root: string): ConvergenceMetrics {
  const toolset = readJson(join(root, "toolset.json"))
  const architecture = readJson(join(root, "docs/architecture/architecture-manifest.json"))
  return {
    module_owners: countNamedFiles(join(root, "modules"), "CONTRACT.md"),
    registered_tools: arrayLength(toolset.tools, "toolset.tools"),
    architecture_domains: arrayLength(architecture.domains, "architecture.domains"),
    architecture_stores: arrayLength(architecture.stores, "architecture.stores"),
    architecture_jobs: arrayLength(architecture.jobs, "architecture.jobs"),
    architecture_rails: arrayLength(architecture.rails, "architecture.rails"),
  }
}

function main(): void {
  const root = process.cwd()
  const baselinePath = join(root, "docs/engineering/convergence-baseline.json")
  const baseline = readJson(baselinePath) as unknown as ConvergenceBaseline
  validateBaseline(baseline)

  const actual = collectConvergenceMetrics(root)
  for (const key of convergenceMetricKeys) {
    process.stdout.write(`convergence: ${key} ${actual[key]}/${baseline.ceilings[key]}\n`)
  }
  const issues = assessConvergence(actual, baseline.ceilings)
  if (issues.length > 0) {
    throw new Error(
      `recovery surface freeze violated:\n${issues.join("\n")}\n`
      + "consolidate an existing surface, or obtain explicit user approval before changing the baseline",
    )
  }
  process.stdout.write("convergence: ok\n")
}

function validateBaseline(value: ConvergenceBaseline): void {
  if (value.schema_version !== "trade.convergence-baseline.v1") {
    throw new Error(`unsupported convergence baseline schema: ${String(value.schema_version)}`)
  }
  if (value.recovery_freeze !== true) throw new Error("convergence recovery freeze must remain enabled")
  for (const key of convergenceMetricKeys) {
    const ceiling = value.ceilings?.[key]
    if (!Number.isInteger(ceiling) || ceiling < 0) {
      throw new Error(`invalid convergence ceiling: ${key}`)
    }
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function arrayLength(value: unknown, label: string): number {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.length
}

function countNamedFiles(path: string, name: string): number {
  let count = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) count += countNamedFiles(child, name)
    else if (entry.isFile() && entry.name === name) count += 1
  }
  return count
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`convergence: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
