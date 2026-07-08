import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import type { ReplayResult } from "../lib/replay-core"
import {
  appendReplayEvidence,
  appendStrategyEvidence,
  promoteStrategy,
  reviewStrategy,
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
    return successResponse(withExistingDb(config.dbPath, (db) => reviewStrategy({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      db,
    })))
  }
  if (config.strategyPromote) {
    return successResponse(withExistingDb(config.dbPath, (db) => promoteStrategy({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      db,
      toStatus: config.promoteTo,
      yes: config.yes,
    })))
  }
  return null
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
      replayResult: replayResult as unknown as ReplayResult,
      setupId: stringField(config.input.setup_id) || undefined,
      sourceRef: stringField(config.input.source_ref) || undefined,
      now: stringField(config.input.now) || undefined,
      qualification: readQualification(config.input),
    })
  }
  const gate = asRecord(config.input.gate)
  const antiOverfit = asRecord(config.input.anti_overfit)
  const executionAttribution = asRecord(config.input.execution_attribution)
  return appendStrategyEvidence({
    strategyPath: config.strategyPath,
    ledgerPath: config.ledgerPath,
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
