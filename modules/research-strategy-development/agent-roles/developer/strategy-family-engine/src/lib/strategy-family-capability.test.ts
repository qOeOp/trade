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
  })
})
