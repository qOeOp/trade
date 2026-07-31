import { expect, test } from "bun:test"
import { parseYamlSubset } from "./strategy-contract"

test("strategy YAML subset preserves nested policy values", () => {
  expect(parseYamlSubset("strategy_id: trend-v1\nrisk:\n  max_loss: 2\n")).toEqual({
    strategy_id: "trend-v1",
    risk: { max_loss: 2 },
  })
})
