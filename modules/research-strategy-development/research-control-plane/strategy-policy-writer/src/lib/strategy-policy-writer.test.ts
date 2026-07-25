import assert from "node:assert/strict"
import test from "node:test"

import {
  SOURCE_SCHEMA_VERSION,
  lintStrategyPolicyShape,
  renderStrategyPolicyMarkdown,
  requiredPolicySections,
  strategyPolicySlug,
  type StrategyPolicySource,
} from "./strategy-policy-writer"

test("strategy policy writer renders a stable high-density policy shape", () => {
  const markdown = renderStrategyPolicyMarkdown(source())
  for (const section of requiredPolicySections()) {
    assert.ok(markdown.includes(section), `missing ${section}`)
  }
  assert.match(markdown, /strategy_id: S-CANDIDATE-VALIDATED/)
  assert.match(markdown, /timeframe: 1h/)
  assert.match(markdown, /family: trend_pullback_v1/)
  assert.match(markdown, /target_action: place_entry \| no_action/)
  assert.match(markdown, /live_permission: draft_only/)
  assert.equal(lintStrategyPolicyShape(markdown).valid, true)
})

test("strategy policy writer keeps family-specific language deterministic", () => {
  const markdown = renderStrategyPolicyMarkdown({
    ...source(),
    candidate: {
      candidate_id: "SBR Short",
      family: "structure_breakout_retest_v1",
      validation_run_ref: "tmp/validation.json",
      params: {
        side: "short",
        lookback_bars: 40,
        breakout_buffer_atr: 0.1,
        retest_tolerance_atr: 0.5,
        stop_atr: 0.8,
        max_risk_atr: 1.5,
        reward_risk: 2,
        max_hold_bars: 12,
      },
    },
  })
  assert.match(markdown, /structure breakout\/retest/)
  assert.match(markdown, /Breakout buffer and retest tolerance/)
  assert.equal(lintStrategyPolicyShape(markdown).valid, true)
})

test("strategy policy shape lint rejects thin or placeholder policies", () => {
  const result = lintStrategyPolicyShape("---\nstrategy_id: S-THIN\n---\n\n# Thin\n\nTODO\n")
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes("Why This Edge")))
  assert.ok(result.errors.some((error) => error.includes("TODO")))
})

test("strategy policy 4h tag lint preserves the bracket-bounded search semantics", () => {
  const warnings = (markdown: string) => lintStrategyPolicyShape(markdown).warnings
  assert.deepEqual(warnings("prefix tags: [4h]\ntimeframe: 4h"), [])
  assert.deepEqual(warnings(" tags: [4h]\ntimeframe: 4h"), [])
  assert.deepEqual(warnings("tags: [x\n4h]\ntimeframe: 4h"), [])
  assert.deepEqual(warnings("tags: [] 4h\ntimeframe: 4h"), ["timeframe is 4h but frontmatter tags do not include 4h"])
})

test("strategy policy slug is filesystem safe", () => {
  assert.equal(strategyPolicySlug("Candidate Validated / 1H"), "candidate-validated-1h")
})

function source(): StrategyPolicySource {
  return {
    schema_version: SOURCE_SCHEMA_VERSION,
    program_id: "rd-draft",
    objective: "validate a 1h candidate before landing a strategy draft",
    drafted_at: "2026-07-09T13:00:00.000Z",
    strategy_ref: "strategies/s-candidate-validated.md",
    evidence_refs: ["tmp/artifacts/validation.json"],
    candidate: {
      candidate_id: "Candidate Validated",
      family: "trend_pullback_v1",
      parameter_count: 6,
      validation_run_ref: "tmp/artifacts/validation.json",
      params: {
        side: "long",
        stop_atr: 0.8,
        max_risk_atr: 1.6,
        reward_risk: 2.4,
        max_hold_bars: 18,
      },
    },
  }
}
