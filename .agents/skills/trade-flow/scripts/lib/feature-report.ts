import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

type JSONRecord = Record<string, unknown>

interface FeatureReportOptions {
  manifestPath: string
  outputPath: string
  indicators?: string
  featureSeries?: boolean
  force?: boolean
  techIndicatorsDir?: string
  runner?: TechIndicatorRunner
}

interface FeatureReportResult {
  status: "cached" | "generated"
  manifest_path: string
  output_path: string
  feature_count: number
  selected_indicators: string[]
  report_hash: string
}

interface TechIndicatorRun {
  stdout: string
  stderr: string
  status: number | null
}

type TechIndicatorRunner = (input: {
  cwd: string
  manifestPath: string
  indicators?: string
  featureSeries: boolean
}) => TechIndicatorRun

function ensureFeatureReport(options: FeatureReportOptions): FeatureReportResult {
  const manifestPath = resolve(options.manifestPath)
  const outputPath = resolve(options.outputPath)
  const featureSeries = options.featureSeries !== false

  if (!options.force && existsSync(outputPath)) {
    const cached = readFeatureReport(outputPath)
    if (cached && reportMatches(cached.data, manifestPath, featureSeries)) {
      return result("cached", manifestPath, outputPath, cached.data, cached.raw)
    }
  }

  const runner = options.runner || runTechIndicators
  const run = runner({
    cwd: resolve(options.techIndicatorsDir || ".agents/skills/tech-indicators"),
    manifestPath,
    indicators: options.indicators,
    featureSeries,
  })
  if (run.status !== 0) {
    throw new Error(`tech-indicators failed: ${run.stderr || run.stdout}`)
  }

  const parsed = parseFeatureReport(run.stdout, outputPath)
  if (!reportMatches(parsed.data, manifestPath, featureSeries)) {
    throw new Error("tech-indicators output did not match requested manifest or feature-series requirement")
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.tmp`
  writeFileSync(tempPath, run.stdout)
  renameSync(tempPath, outputPath)
  return result("generated", manifestPath, outputPath, parsed.data, run.stdout)
}

function runTechIndicators(input: {
  cwd: string
  manifestPath: string
  indicators?: string
  featureSeries: boolean
}): TechIndicatorRun {
  const args = ["run", "./scripts", "--manifest", input.manifestPath]
  if (input.indicators) {
    args.push("--indicators", input.indicators)
  }
  if (input.featureSeries) {
    args.push("--feature-series")
  }
  const run = spawnSync("go", args, { cwd: input.cwd, encoding: "utf8" })
  return {
    stdout: run.stdout || "",
    stderr: run.stderr || "",
    status: run.status,
  }
}

function readFeatureReport(path: string): { raw: string; data: JSONRecord } | null {
  try {
    const raw = readFileSync(path, "utf8")
    return parseFeatureReport(raw, path)
  } catch {
    return null
  }
}

function parseFeatureReport(raw: string, label: string): { raw: string; data: JSONRecord } {
  const parsed = JSON.parse(raw) as JSONRecord
  if (parsed.ok !== true || !isRecord(parsed.data)) {
    throw new Error(`feature report is not an ok script response: ${label}`)
  }
  return { raw, data: parsed.data }
}

function reportMatches(data: JSONRecord, manifestPath: string, requireFeatureSeries: boolean): boolean {
  const sourceManifest = stringField(data.source_manifest)
  if (sourceManifest && resolve(sourceManifest) !== manifestPath) {
    return false
  }
  if (!requireFeatureSeries) {
    return true
  }
  return featureCount(data) > 0
}

function result(status: "cached" | "generated", manifestPath: string, outputPath: string, data: JSONRecord, raw: string): FeatureReportResult {
  return {
    status,
    manifest_path: manifestPath,
    output_path: outputPath,
    feature_count: featureCount(data),
    selected_indicators: Object.keys(asRecord(data.selected_indicators)).sort(),
    report_hash: createHash("sha256").update(raw).digest("hex"),
  }
}

function featureCount(data: JSONRecord): number {
  return Object.values(asRecord(data.timeframes)).reduce<number>((total, rawFrame) => {
    return total + Object.keys(asRecord(asRecord(rawFrame).features)).length
  }, 0)
}

function isRecord(value: unknown): value is JSONRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asRecord(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  ensureFeatureReport,
  runTechIndicators,
  type FeatureReportOptions,
  type FeatureReportResult,
  type TechIndicatorRunner,
}
