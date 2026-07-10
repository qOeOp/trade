import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import { readRdProgramState, updateRdProgramStateFromStrategyReview, writeRdProgramState } from "../lib/rd-program-state"
import { displayPath } from "../lib/paths"
import type { ReplayResult } from "../lib/replay-core"
import {
  appendReplayEvidence,
  appendStrategyEvidence,
  promoteStrategy,
  reviewStrategy,
  runStrategyCycle,
  syncShadowEvidenceFromReviews,
  type AntiOverfitProof,
  type EvidenceQualification,
  type EvidenceKind,
  type EvidenceStats,
} from "../lib/strategy-iteration"
import { successResponse } from "./response"
import type { CommandConfig, JSONRecord, ScriptResponse } from "./types"

export function handleEvidenceCommand(config: CommandConfig): ScriptResponse | null {
  if (config.appendStrategyEvidence) {
    return successResponse(appendStrategyEvidenceFromInput(config))
  }
  if (config.strategyReview) {
    return successResponse(withExistingDb(config.dbPath, (db) => {
      const report = reviewStrategy({
        strategyPath: config.strategyPath,
        ledgerPath: config.ledgerPath,
        catalogDbPath: evidenceCatalogDbPath(config),
        db,
      })
      return withRdReviewFeedback(config, report as unknown as JSONRecord)
    }))
  }
  if (config.strategyPromote) {
    return successResponse(withExistingDb(config.dbPath, (db) => promoteStrategy({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      db,
      toStatus: config.promoteTo,
      yes: config.yes,
    })))
  }
  if (config.strategyCycle) {
    return successResponse(withExistingDb(config.dbPath, (db) => runStrategyCycle({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      catalogDbPath: evidenceCatalogDbPath(config),
      db,
      setupId: stringField(config.input.setup_id) || undefined,
      promoteTo: config.promoteToExplicit ? config.promoteTo : undefined,
      yes: config.yes,
      now: stringField(config.input.now) || undefined,
    })))
  }
  return null
}

function withRdReviewFeedback(config: CommandConfig, report: JSONRecord): JSONRecord {
  const statePath = stringField(config.input.rd_program_state_path)
  if (!statePath) {
    return report
  }
  const state = readRdProgramState(statePath)
  const updated = updateRdProgramStateFromStrategyReview(state, report, stringField(config.input.now) || undefined)
  const written = writeRdProgramState(statePath, updated, evidenceCatalogDbPath(config))
  return {
    ...report,
    rd_program_state: {
      schema_version: "trade-flow.rd-program-state-result.v1",
      action: "update",
      state_ref: written.path,
      catalog_db_path: written.catalog_db_path,
      artifact_id: written.artifact_id,
      state: updated,
      goal: {
        objective: updated.objective,
        status: updated.status,
        budget: updated.budget,
        usage: updated.usage,
        stop_conditions: updated.stop_conditions,
        latest_failure_summary: updated.latest_failure_summary,
        latest_reliability_gate: updated.latest_reliability_gate,
        rejected_mechanisms: updated.rejected_mechanisms,
        universe_lessons: updated.universe_lessons,
        next_hypothesis_queue: updated.next_hypothesis_queue,
        artifact_refs: updated.artifact_refs,
      },
    },
  }
}

function appendStrategyEvidenceFromInput(config: CommandConfig): unknown {
  if (!config.strategyPath) {
    throw new Error("--append-strategy-evidence requires --strategy")
  }
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
    if (kind !== "shadow") {
      throw new Error("review-derived strategy evidence must use kind=shadow")
    }
    return withExistingDb(config.dbPath, (db) => {
      if (!db) {
        throw new Error("review-derived shadow evidence requires an existing --db")
      }
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

function evidenceCatalogDbPath(config: CommandConfig): string | undefined {
  return config.ledgerPath && displayPath(config.catalogDbPath) === "data/data_catalog.db"
    ? undefined
    : config.catalogDbPath
}

function readQualification(input: JSONRecord): EvidenceQualification | undefined {
  const qualification = asRecord(input.qualification)
  const funding = asRecord(input.funding_event_coverage ?? qualification.funding_event_coverage)
  const panel = asRecord(input.panel_null_gate ?? qualification.panel_null_gate)
  const result = {
    ...(Object.keys(funding).length > 0 ? { funding_event_coverage: funding } : {}),
    ...(Object.keys(panel).length > 0 ? { panel_null_gate: panel } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function readEvidenceKind(value: unknown): EvidenceKind {
  const kind = stringField(value)
  if (kind === "replay" || kind === "shadow" || kind === "live_small" || kind === "review_batch") {
    return kind
  }
  throw new Error("strategy evidence kind must be replay, shadow, live_small, or review_batch")
}

function withExistingDb<T>(dbPath: string, fn: (db?: Database) => T): T {
  if (!dbPath || !existsSync(dbPath)) {
    return fn(undefined)
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}
