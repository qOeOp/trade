import assert from "node:assert/strict"
import test from "node:test"

import { getRndFamily, listRndFamilyIds } from "./rnd-family"

test("R&D families are discovered from family modules", () => {
  assert.deepEqual(listRndFamilyIds(), ["structure_breakout_retest_v1", "time_series_momentum_v1", "trend_pullback_v1", "volatility_compression_breakout_v1"])
  assert.equal(getRndFamily("trend_pullback_v1").id, "trend_pullback_v1")
  assert.throws(() => getRndFamily("missing_family"), /unsupported R&D family/)
})
