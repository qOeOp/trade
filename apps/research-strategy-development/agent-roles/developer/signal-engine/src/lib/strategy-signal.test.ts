import { expect, test } from "bun:test"
import { strategySignalInputFromJson } from "./strategy-signal"

test("signal JSON input normalizes candidate identity and numbers", () => {
  const input = strategySignalInputFromJson({
    manifest_path: " manifests/discovery.json ",
    entry_price: "100.5",
    candidate: { candidate_id: " candidate-1 ", family: "trend_pullback_v1" },
  })
  expect(input.manifestPath).toBe("manifests/discovery.json")
  expect(input.entryPrice).toBe(100.5)
  expect(input.candidate.candidateId).toBe("candidate-1")
})
