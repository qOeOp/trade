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

export function describeSurfaceGrowth(
  actual: ConvergenceMetrics,
  baseline: ConvergenceMetrics,
): string[] {
  const observations: string[] = []
  for (const key of convergenceMetricKeys) {
    if (actual[key] > baseline[key]) {
      observations.push(`${key} changed from baseline ${baseline[key]} to ${actual[key]}`)
    }
  }
  return observations
}

export function collectConvergenceMetrics(root: string): ConvergenceMetrics {
  const toolset = readJson(join(root, "toolset.json"))
  const architecture = readJson(join(root, "docs/architecture/architecture-manifest.json"))
  return {
    module_owners: countNamedFiles(join(root, "apps"), "CONTRACT.md"),
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
  for (const observation of describeSurfaceGrowth(actual, baseline.ceilings)) {
    process.stdout.write(`convergence: observation: ${observation}\n`)
  }
  process.stdout.write("convergence: report ok (non-blocking)\n")
}

function validateBaseline(value: ConvergenceBaseline): void {
  if (value.schema_version !== "trade.convergence-baseline.v1") {
    throw new Error(`unsupported convergence baseline schema: ${String(value.schema_version)}`)
  }
  if (typeof value.recovery_freeze !== "boolean") {
    throw new Error("convergence recovery_freeze must be a boolean")
  }
  for (const key of convergenceMetricKeys) {
    const baseline = value.ceilings?.[key]
    if (!Number.isInteger(baseline) || baseline < 0) {
      throw new Error(`invalid convergence baseline: ${key}`)
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
