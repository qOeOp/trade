#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import type { ReplayResult } from "../../../../contracts/replay-contract/src/replay-contract"
import { displayPath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  appendReplayEvidence,
  appendStrategyEvidence,
  promoteStrategy,
  reviewStrategy,
  runStrategyCycle,
  syncShadowEvidenceFromReviews,
  type AntiOverfitProof,
  type EvidenceKind,
  type EvidenceQualification,
  type EvidenceStats,
} from "../lib/strategy-iteration"

type JSONRecord = Record<string, unknown>

interface Config {
  appendStrategyEvidence: boolean
  strategyReview: boolean
  strategyPromote: boolean
  strategyCycle: boolean
  yes: boolean
  strategyPath: string
  ledgerPath: string
  catalogDbPath: string
  dbPath: string
  promoteTo: "draft" | "shadow" | "live-small" | "paused"
  promoteToExplicit: boolean
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  const invocationCwd = process.cwd()
  const root = repoRoot()
  const config = parseArgs(argv, invocationCwd, root)
  try {
    process.chdir(root)
    return successResponse(runConfig(config))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(invocationCwd)
  }
}

function runConfig(config: Config): unknown {
  if (config.appendStrategyEvidence) return appendStrategyEvidenceFromInput(config)
  if (config.strategyReview) {
    return withExistingDb(config.dbPath, (db) => reviewStrategy({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      db,
    }))
  }
  if (config.strategyPromote) {
    return withExistingDb(config.dbPath, (db) => promoteStrategy({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      db,
      toStatus: config.promoteTo,
      yes: config.yes,
    }))
  }
  if (config.strategyCycle) {
    return withExistingDb(config.dbPath, (db) => runStrategyCycle({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      db,
      setupId: stringField(config.input.setup_id) || undefined,
      promoteTo: config.promoteToExplicit ? config.promoteTo : undefined,
      yes: config.yes,
      now: stringField(config.input.now) || undefined,
    }))
  }
  throw new Error("provide --append-strategy-evidence, --strategy-review, --strategy-promote, or --strategy-cycle")
}

function appendStrategyEvidenceFromInput(config: Config): unknown {
  if (!config.strategyPath) throw new Error("--append-strategy-evidence requires --strategy")
  const replayResult = asRecord(config.input.replay_result)
  if (Object.keys(replayResult).length > 0) {
    return appendReplayEvidence({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      replayResult: replayResult as unknown as ReplayResult,
      setupId: stringField(config.input.setup_id) || undefined,
      sourceRef: stringField(config.input.source_ref) || undefined,
      now: stringField(config.input.now) || undefined,
      qualification: readQualification(config.input),
    })
  }
  if (config.input.from_reviews === true || config.input.from_db_reviews === true) {
    const kind = readEvidenceKind(config.input.kind)
    if (kind !== "shadow") throw new Error("review-derived strategy evidence must use kind=shadow")
    return withExistingDb(config.dbPath, (db) => {
      if (!db) throw new Error("review-derived shadow evidence requires an existing --db")
      return syncShadowEvidenceFromReviews({
        strategyPath: config.strategyPath,
        ledgerPath: config.ledgerPath,
        catalogDbPath: evidenceCatalogDbPath(config),
        db,
        setupId: stringField(config.input.setup_id) || undefined,
        now: stringField(config.input.now) || undefined,
      })
    })
  }
  const gate = asRecord(config.input.gate)
  const antiOverfit = asRecord(config.input.anti_overfit)
  const executionAttribution = asRecord(config.input.execution_attribution)
  return appendStrategyEvidence({
    strategyPath: config.strategyPath,
    ledgerPath: config.ledgerPath,
    catalogDbPath: evidenceCatalogDbPath(config),
    kind: readEvidenceKind(config.input.kind),
    setupId: stringField(config.input.setup_id) || undefined,
    sourceRef: stringField(config.input.source_ref) || undefined,
    stats: asRecord(config.input.stats) as unknown as EvidenceStats,
    antiOverfit: Object.keys(antiOverfit).length > 0 ? antiOverfit as unknown as AntiOverfitProof : undefined,
    executionAttribution: Object.keys(executionAttribution).length > 0 ? executionAttribution : undefined,
    qualification: readQualification(config.input),
    gate: Object.keys(gate).length > 0 ? gate : undefined,
    notes: stringField(config.input.notes) || undefined,
    now: stringField(config.input.now) || undefined,
  })
}

function parseArgs(argv: string[], invocationCwd: string, root: string): Config {
  const config: Config = {
    appendStrategyEvidence: false,
    strategyReview: false,
    strategyPromote: false,
    strategyCycle: false,
    yes: false,
    strategyPath: "",
    ledgerPath: "",
    catalogDbPath: "./data/data_catalog.db",
    dbPath: "",
    promoteTo: "shadow",
    promoteToExplicit: false,
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--append-strategy-evidence": config.appendStrategyEvidence = true; break
      case "--strategy-review": config.strategyReview = true; break
      case "--strategy-promote": config.strategyPromote = true; break
      case "--strategy-cycle": config.strategyCycle = true; break
      case "--yes": config.yes = true; break
      case "--strategy": config.strategyPath = normalizePath(readValue(argv, ++index, arg), invocationCwd, root); break
      case "--ledger": config.ledgerPath = normalizePath(readValue(argv, ++index, arg), invocationCwd, root); break
      case "--catalog-db": config.catalogDbPath = normalizePath(readValue(argv, ++index, arg), invocationCwd, root); break
      case "--db": config.dbPath = normalizePath(readValue(argv, ++index, arg), invocationCwd, root); break
      case "--to":
      case "--promote-to":
        config.promoteTo = readStrategyStatus(readValue(argv, ++index, arg))
        config.promoteToExplicit = true
        break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg), invocationCwd, root); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function evidenceCatalogDbPath(config: Config): string | undefined {
  return config.ledgerPath && displayPath(config.catalogDbPath) === "data/data_catalog.db"
    ? undefined
    : config.catalogDbPath
}

function readQualification(input: JSONRecord): EvidenceQualification | undefined {
  const qualification = asRecord(input.qualification)
  const funding = asRecord(input.funding_event_coverage ?? qualification.funding_event_coverage)
  const panel = asRecord(input.panel_negative_control_gate ?? qualification.panel_negative_control_gate)
  const result = {
    ...(Object.keys(funding).length > 0 ? { funding_event_coverage: funding } : {}),
    ...(Object.keys(panel).length > 0 ? { panel_negative_control_gate: panel } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function readEvidenceKind(value: unknown): EvidenceKind {
  const kind = stringField(value)
  if (kind === "replay" || kind === "shadow" || kind === "live_small" || kind === "review_batch") return kind
  throw new Error("strategy evidence kind must be replay, shadow, live_small, or review_batch")
}

function readStrategyStatus(value: string): "draft" | "shadow" | "live-small" | "paused" {
  if (value === "draft" || value === "shadow" || value === "live-small" || value === "paused") return value
  throw new Error("--to must be draft, shadow, live-small, or paused")
}

function withExistingDb<T>(dbPath: string, fn: (db?: Database) => T): T {
  if (!dbPath || !existsSync(dbPath)) return fn(undefined)
  const db = new Database(dbPath, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJsonFile(path: string, invocationCwd: string, root: string): JSONRecord {
  return readJson(readFileSync(normalizeReadablePath(path, invocationCwd, root), "utf8"))
}

function readJson(value: string): JSONRecord {
  const parsed = JSON.parse(value) as unknown
  return asRecord(parsed)
}

function successResponse(data: unknown): JSONRecord {
  return {
    ok: true,
    schema_version: "strategy-review.script-response.v1",
    data,
  }
}

function errorResponse(error: unknown): JSONRecord {
  return {
    ok: false,
    schema_version: "strategy-review.script-response.v1",
    error: error instanceof Error ? error.message : String(error),
  }
}

function printHelp(): void {
  console.log(`strategy-review

Usage:
  bun src/scripts/main.ts --append-strategy-evidence --strategy <strategy.md> --json '<payload>'
  bun src/scripts/main.ts --strategy-review --strategy <strategy.md>
  bun src/scripts/main.ts --strategy-promote --strategy <strategy.md> --to shadow [--yes]
  bun src/scripts/main.ts --strategy-cycle --strategy <strategy.md> --json '<payload>'

Options:
  --ledger <path>       Evidence ledger path.
  --catalog-db <path>   Data catalog path, default ./data/data_catalog.db.
  --db <path>           Read-only trade event DB for review-derived evidence.
`)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function normalizeReadablePath(path: string, invocationCwd: string, root: string): string {
  const cwdPath = resolve(invocationCwd, path)
  if (existsSync(cwdPath)) return cwdPath
  const rootPath = resolve(root, path)
  if (existsSync(rootPath)) return rootPath
  return path
}

function normalizePath(path: string, invocationCwd: string, root: string): string {
  if (!path || path.startsWith("/")) return path
  const cwdPath = resolve(invocationCwd, path)
  if (existsSync(cwdPath) || existsSync(dirname(cwdPath))) return cwdPath
  const rootPath = resolve(root, path)
  if (existsSync(rootPath) || existsSync(dirname(rootPath))) return rootPath
  return path
}

if (import.meta.main) main(process.argv.slice(2))
