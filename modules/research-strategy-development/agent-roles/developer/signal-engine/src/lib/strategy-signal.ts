import {
  evaluateLatestSignal,
} from "../../../../../replay-execution-plane/compatibility/legacy-research-kernel/src/lib/replay-core"
import { hashCanonical, replayDataHash } from "../../../../../replay-execution-plane/compatibility/legacy-replay-identity/src/lib/legacy-replay-identity"
import { getRndFamily } from "../../../strategy-family-engine/src/lib/rnd-family"
import { loadStrategyFeatureStore } from "../../../strategy-family-engine/src/lib/strategy-feature-store"

type JSONRecord = Record<string, unknown>

export interface StrategySignalCandidateInput {
  candidateId: string
  description?: string
  family?: string
  parameterCount?: number
  params?: JSONRecord
}

interface StrategySignalInput {
  manifestPath: string
  indicatorReportPath?: string
  timeframe?: string
  entryPrice: number
  now?: string
  maxSignalAgeBars?: number
  candidate: StrategySignalCandidateInput
}

function evaluateStrategySignal(input: StrategySignalInput): JSONRecord {
  if (!input.manifestPath || !input.candidate.candidateId) {
    throw new Error("strategy signal requires manifestPath and candidate")
  }
  const family = input.candidate.family || "trend_pullback_v1"
  const store = loadStrategyFeatureStore(input.indicatorReportPath)
  const configured = getRndFamily(family).configure(input.candidate.candidateId, input.candidate.params || {}, store)
  const supplementalDataRefs = [
    ...(input.indicatorReportPath ? [input.indicatorReportPath] : []),
    ...(configured.supplementalDataRefs || []),
  ]
  return {
    candidate_id: input.candidate.candidateId,
    family,
    params: configured.params,
    candidate_hash: hashCanonical({ family, params: configured.params }),
    data_hash: replayDataHash(input.manifestPath, input.timeframe || configured.strategy.default_timeframe, supplementalDataRefs),
    ...evaluateLatestSignal(
      configured.strategy,
      { manifestPath: input.manifestPath, timeframe: input.timeframe },
      input.entryPrice,
      { now: input.now, maxAgeBars: input.maxSignalAgeBars },
    ),
  }
}

function strategySignalInputFromJson(input: JSONRecord): StrategySignalInput {
  return {
    manifestPath: stringField(input.manifest_path),
    indicatorReportPath: stringField(input.indicator_report_path) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    entryPrice: Number(input.entry_price),
    now: stringField(input.now) || undefined,
    maxSignalAgeBars: optionalNumber(input.max_signal_age_bars),
    candidate: candidateFromJson(asRecord(input.candidate)),
  }
}

function candidateFromJson(input: JSONRecord): StrategySignalCandidateInput {
  return {
    candidateId: stringField(input.candidate_id),
    description: stringField(input.description) || undefined,
    family: stringField(input.family) || undefined,
    parameterCount: optionalNumber(input.parameter_count),
    params: asRecord(input.params),
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export {
  evaluateStrategySignal,
  strategySignalInputFromJson,
  type StrategySignalInput,
}
