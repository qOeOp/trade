import { describe, expect, test } from "bun:test"
import {
  assessCandidateSpaceCompatibility,
  listStrategyFamilyCapabilities,
  readStrategyFamilyCapability,
} from "./strategy-family-capability"
import { listRndFamilyIds } from "./rnd-family"

describe("strategy family capability registry", () => {
  test("covers every statically registered family with stable identity", () => {
    const capabilities = listStrategyFamilyCapabilities()
    expect(capabilities).toHaveLength(7)
    expect(new Set(capabilities.map((item) => item.family_id)).size).toBe(7)
    expect(capabilities.map((item) => item.family_id).sort()).toEqual(listRndFamilyIds())
    expect(capabilities.every((item) => /^[a-f0-9]{64}$/.test(item.capability_hash))).toBe(true)
  })

  test("classifies exact engine parameters without guessing aliases", () => {
    const family = readStrategyFamilyCapability(
      "canonical:trend/time-series-trend/time-series-momentum",
    )
    expect(family).not.toBeNull()
    expect(assessCandidateSpaceCompatibility({
      lookback_bars: [20, 40],
      threshold_atr: [1.5, 2],
    }, family!)).toEqual({
      compatible: true,
      unsupported_axes: [],
      invalid_axes: [],
    })
    expect(assessCandidateSpaceCompatibility({
      lookback_period: [20, 40],
      threshold_atr: [-1],
    }, family!)).toEqual({
      compatible: false,
      unsupported_axes: ["lookback_period"],
      invalid_axes: ["threshold_atr"],
    })
    expect(family?.parameter_axes.find((axis) => axis.name === "threshold_atr"))
      .toMatchObject({ minimum: 0, exclusive_minimum: true })
    expect(family?.implementation_contract).toMatchObject({
      feature_definition: {
        formula: "(close[index] - close[index-lookback_bars]) / ATR14[index]",
        visibility: "closed_candle_only",
      },
      risk_rule: {
        entry_risk_gate: "reject unless 0 < abs(entry-stop) <= max_risk_atr*ATR14",
        target: "entry plus or minus abs(entry-stop)*reward_risk",
      },
      execution_rule: {
        order_authority: "family emits a signal only and has no exchange-write authority",
      },
    })
    expect(assessCandidateSpaceCompatibility({ threshold_atr: [0] }, family!))
      .toMatchObject({ compatible: false, invalid_axes: ["threshold_atr"] })
  })
})
