import { readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>

interface PanelCandidateSummary {
  candidate_id: string
  pooled: JSONRecord
  blocked_by: string[]
}

function readJsonArtifact(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function unwrapScriptData(value: JSONRecord): JSONRecord {
  if (value.ok === true && isRecord(value.data)) {
    return value.data
  }
  return value
}

function summarizeStrategyPanelRnd(value: JSONRecord): JSONRecord {
  const data = unwrapScriptData(value)
  return {
    outcome: stringField(data.outcome),
    diagnostic_mode: data.diagnostic_mode === true,
    trial_count: numberField(data.trial_count),
    candidates: array(data.candidates).map((raw): PanelCandidateSummary => {
      const candidate = asRecord(raw)
      return {
        candidate_id: stringField(candidate.candidate_id),
        pooled: asRecord(candidate.pooled),
        blocked_by: array(asRecord(candidate.gate).blocked_by)
          .map(asRecord)
          .map((block) => stringField(block.check_id))
          .filter(Boolean),
      }
    }),
  }
}

function isRecord(value: unknown): value is JSONRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asRecord(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberField(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export {
  readJsonArtifact,
  summarizeStrategyPanelRnd,
  unwrapScriptData,
}
