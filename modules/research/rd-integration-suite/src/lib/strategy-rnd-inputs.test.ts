import assert from "node:assert/strict"
import test from "node:test"
import {
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
} from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"

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

test("strategy R&D campaign parser reads canonical discovery manifest field", () => {
  const input = strategyRndCampaignInputFromJson({
    campaign_id: "campaign-1",
    panel_report_path: "/tmp/panel.json",
    hypotheses: [{
      hypothesis_id: "h1",
      thesis_certificate: {
        edge_type: "structural trend continuation",
        behavioral_hypothesis: "late buyers defend pullbacks after trend confirmation",
        market_participants: "trend followers and trapped short sellers",
        regime: "liquid perpetual trend regime",
        invalidation: "breaks when pullbacks fail trend support",
        cost_sensitivity: "must survive fee and slippage stress",
        candidate_universe: "trend pullback candidates with fixed role budget",
        negative_controls: ["side_flip", "entry_lag"],
      },
      discovery_manifest_path: "/tmp/discovery.json",
      validation_manifest_path: "/tmp/validation.json",
      candidates: [{ candidate_id: "candidate-1" }],
    }],
  })

  assert.equal(input.campaignId, "campaign-1")
  assert.equal(input.panelReportPath, "/tmp/panel.json")
  assert.equal(input.hypotheses[0].hypothesisId, "h1")
  assert.equal(input.hypotheses[0].thesisCertificate?.edgeType, "structural trend continuation")
  assert.deepEqual(input.hypotheses[0].thesisCertificate?.negativeControls, ["side_flip", "entry_lag"])
  assert.equal(input.hypotheses[0].manifestPath, "/tmp/discovery.json")
  assert.equal(input.hypotheses[0].validationManifestPath, "/tmp/validation.json")
})

test("strategy R&D input parser ignores camel-case contract fields", () => {
  const batch = strategyRndBatchInputFromJson({
    manifestPath: "/tmp/manifest.json",
    maxHoldBars: 12,
    factorDiscover: true,
    factorResearchOptions: { horizonBars: 24 },
    candidates: [{ candidateId: "candidate-1", parameterCount: 2 }],
  })

  assert.equal(batch.manifestPath, "")
  assert.equal(batch.maxHoldBars, undefined)
  assert.equal(batch.factorDiscover, false)
  assert.equal(batch.factorResearchOptions?.horizonBars, undefined)
  assert.equal(batch.candidates[0].candidateId, "")
  assert.equal(batch.candidates[0].parameterCount, undefined)

})
