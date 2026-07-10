import { readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>

interface RndLoopCandidateSummary {
  candidate_id: string
  sample_count: number
  avg_r: number
  total_r: number
  profit_factor: number
  oos_sample_count: number
  oos_avg_r: number
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
    artifact_kind: "strategy_panel_rnd",
    outcome: stringField(data.outcome),
    diagnostic_mode: data.diagnostic_mode === true,
    trial_count: numberField(data.trial_count),
    candidates: array(data.candidates).map((raw): JSONRecord => {
      const candidate = asRecord(raw)
      if (stringField(candidate.family) === "marketability_score_v1" || isRecord(candidate.marketability)) {
        return {
          candidate_id: stringField(candidate.candidate_id),
          family: "marketability_score_v1",
          marketability: asRecord(candidate.marketability),
          asset_scores: array(candidate.assets).map(asRecord).map((asset) => {
            const marketability = asRecord(asset.marketability)
            return {
              dataset_id: stringField(asset.dataset_id),
              score: numberField(marketability.score),
              passed: marketability.passed === true,
              blocked_by: array(marketability.blocked_by).map(String).filter(Boolean),
            }
          }),
          blocked_by: candidateBlockedBy(candidate),
        }
      }
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

function summarizeStrategyRndLoop(value: JSONRecord): JSONRecord {
  const data = unwrapScriptData(value)
  const batch = asRecord(data.batch)
  return {
    artifact_kind: "strategy_rnd_loop",
    run_id: stringField(data.run_id),
    outcome: stringField(batch.outcome),
    trial_count: numberField(batch.trial_count),
    accepted_count: numberField(batch.accepted_count),
    candidate_source: stringField(batch.candidate_source),
    failure_summary: asRecord(batch.failure_summary),
    reliability_gate: asRecord(batch.reliability_gate),
    candidates: array(batch.candidates).map((raw): RndLoopCandidateSummary => {
      const candidate = asRecord(raw)
      const replay = asRecord(candidate.replay)
      const antiOverfit = asRecord(asRecord(replay.assumptions).anti_overfit)
      const oos = asRecord(antiOverfit.oos_stats)
      return {
        candidate_id: stringField(candidate.candidate_id),
        sample_count: numberField(replay.sample_count),
        avg_r: numberField(replay.avg_r),
        total_r: numberField(replay.total_r),
        profit_factor: numberField(replay.profit_factor),
        oos_sample_count: numberField(oos.sample_count),
        oos_avg_r: numberField(oos.avg_r),
        blocked_by: candidateBlockedBy(candidate),
      }
    }),
  }
}

function summarizeRndArtifact(value: JSONRecord): JSONRecord {
  const data = unwrapScriptData(value)
  if (isRecord(data.batch) && Array.isArray(asRecord(data.batch).candidates)) {
    return summarizeStrategyRndLoop(data)
  }
  return summarizeStrategyPanelRnd(data)
}

function candidateBlockedBy(candidate: JSONRecord): string[] {
  return array(asRecord(candidate.gate).blocked_by)
    .map(asRecord)
    .map((block) => stringField(block.check_id))
    .filter(Boolean)
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
  summarizeRndArtifact,
  summarizeStrategyRndLoop,
  summarizeStrategyPanelRnd,
  unwrapScriptData,
}
