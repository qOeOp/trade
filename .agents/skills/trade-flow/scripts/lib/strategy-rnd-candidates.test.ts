import assert from "node:assert/strict"
import test from "node:test"
import {
  assertUniqueCandidateIds,
  buildFactorResearch,
  loadStrategyRndFeatureStore,
  resolveCandidateCount,
  resolveRndCandidates,
} from "./strategy-rnd-candidates"
import type { FactorResearchReport } from "./factor-research"
import type { StrategyRndBatchInput } from "./strategy-rnd-inputs"

test("strategy R&D candidates reject duplicate or empty candidate ids", () => {
  assert.throws(() => assertUniqueCandidateIds([
    { candidateId: "DUP", params: {} },
    { candidateId: "DUP", params: {} },
  ]), /candidate_id must be unique: DUP/)
  assert.throws(() => assertUniqueCandidateIds([
    { candidateId: "", params: {} },
  ]), /candidate_id must be unique: <empty>/)
})

test("strategy R&D candidates resolve provided and composed candidate sources", () => {
  const input = baseInput()
  assert.deepEqual(resolveRndCandidates(input, null), {
    candidates: input.candidates,
    source: "provided",
  })

  const composed = resolveRndCandidates({
    ...input,
    factorCompose: true,
    factorSeeds: [{
      factorId: "vpci.value",
      role: "confirmation",
      transform: "percentile",
      lookback: 20,
      op: "gt",
      value: 0.7,
    }],
  }, null)
  assert.equal(composed.source, "bounded_factor_composition")
  assert.equal(composed.candidates.length, 1)
  assert.equal(composed.candidates[0].candidateId, "BASE-vpci-value-percentile-20-gt-0-7")
  assert.equal(composed.candidates[0].parameterCount, 8)
})

test("strategy R&D candidates preserve scientific factor discovery source", () => {
  const input = { ...baseInput(), factorCompose: true }
  const resolved = resolveRndCandidates(input, factorResearchFixture())
  assert.equal(resolved.source, "scientific_factor_discovery")
  assert.equal(Array.isArray(resolved.candidates[0].params?.factor_conditions), true)
  assert.equal((resolved.candidates[0].params?.factor_conditions as Array<{ factor_id: string }>)[0].factor_id, "edge.factor")
})

test("strategy R&D candidates cap resolved candidates to declared trial count", () => {
  const provided = resolveRndCandidates({
    ...baseInput(),
    searchTrialCount: 1,
    candidates: [
      { candidateId: "A", parameterCount: 6, params: { side: "long" } },
      { candidateId: "B", parameterCount: 6, params: { side: "short" } },
    ],
  }, null)
  assert.deepEqual(provided.candidates.map((candidate) => candidate.candidateId), ["A"])

  const composed = resolveRndCandidates({
    ...baseInput(),
    searchTrialCount: 1,
    factorCompose: true,
    factorSeeds: [
      {
        factorId: "stc.value",
        role: "timing",
        transform: "percentile",
        lookback: 20,
        op: "gt",
        value: 0.7,
      },
      {
        factorId: "vfi.value",
        role: "confirmation",
        transform: "percentile",
        lookback: 20,
        op: "gt",
        value: 0.7,
      },
    ],
  }, null)
  assert.equal(composed.candidates.length, 1)
})

test("strategy R&D candidates keep campaign candidate counting and discovery constraints explicit", () => {
  assert.throws(() => resolveCandidateCount({ ...baseInput(), candidates: [] }), /requires at least one candidate/)
  assert.equal(resolveCandidateCount({ ...baseInput(), factorDiscover: true, candidates: [] }), 0)
  assert.equal(buildFactorResearch(baseInput(), loadStrategyRndFeatureStore()), null)
  assert.throws(() => buildFactorResearch({
    ...baseInput(),
    factorDiscover: true,
    indicatorReportPath: "/tmp/unused-indicator-report.json",
    candidates: [
      { candidateId: "A", params: {} },
      { candidateId: "B", params: {} },
    ],
  }, loadStrategyRndFeatureStore()), /requires exactly one base candidate/)
})

function baseInput(): StrategyRndBatchInput {
  return {
    manifestPath: "/tmp/unused-manifest.json",
    candidates: [{ candidateId: "BASE", parameterCount: 6, params: { side: "both" } }],
  }
}

function factorResearchFixture(): FactorResearchReport {
  return {
    method: "setup_conditioned_rank_ic",
    horizon_bars: 6,
    lookback: 20,
    min_samples: 10,
    min_abs_ic: 0.05,
    max_correlation: 0.85,
    max_fdr: 0.05,
    profiles: [],
    selected_factor_ids: ["edge.factor"],
    seeds: [{
      factorId: "edge.factor",
      role: "confirmation",
      transform: "percentile",
      lookback: 20,
      op: "gt",
      value: 0.7,
    }],
  }
}
