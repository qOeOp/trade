import assert from "node:assert/strict"
import test from "node:test"
import {
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndSignalInputFromJson,
} from "./strategy-rnd-inputs"

test("strategy R&D input parser keeps factor research option aliases", () => {
  const input = strategyRndBatchInputFromJson({
    manifest_path: "/tmp/manifest.json",
    factor_discover: true,
    factor_research_options: {
      horizon_bars: 24,
      min_abs_ic: 0.05,
      max_selected: 3,
    },
    candidates: [{
      candidate_id: "candidate-1",
      parameter_count: 2,
      params: { family: "trend" },
    }],
  })

  assert.equal(input.manifestPath, "/tmp/manifest.json")
  assert.equal(input.factorDiscover, true)
  assert.equal(input.factorResearchOptions?.horizonBars, 24)
  assert.equal(input.factorResearchOptions?.minAbsIc, 0.05)
  assert.equal(input.factorResearchOptions?.maxSelected, 3)
  assert.equal(input.candidates[0].candidateId, "candidate-1")
  assert.equal(input.candidates[0].parameterCount, 2)
})

test("strategy R&D campaign parser keeps discovery manifest aliases", () => {
  const input = strategyRndCampaignInputFromJson({
    campaign_id: "campaign-1",
    hypotheses: [{
      hypothesis_id: "h1",
      discoveryManifestPath: "/tmp/discovery.json",
      validation_manifest_path: "/tmp/validation.json",
      candidates: [{ candidate_id: "candidate-1" }],
    }],
  })

  assert.equal(input.campaignId, "campaign-1")
  assert.equal(input.hypotheses[0].hypothesisId, "h1")
  assert.equal(input.hypotheses[0].manifestPath, "/tmp/discovery.json")
  assert.equal(input.hypotheses[0].validationManifestPath, "/tmp/validation.json")
})

test("strategy R&D signal parser normalizes candidate input", () => {
  const input = strategyRndSignalInputFromJson({
    manifest_path: "/tmp/manifest.json",
    entry_price: 65000,
    max_signal_age_bars: 2,
    candidate: {
      candidate_id: "candidate-1",
      family: "trend_pullback_v1",
    },
  })

  assert.equal(input.manifestPath, "/tmp/manifest.json")
  assert.equal(input.entryPrice, 65000)
  assert.equal(input.maxSignalAgeBars, 2)
  assert.equal(input.candidate.candidateId, "candidate-1")
})
