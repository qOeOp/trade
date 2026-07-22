import { expect, test } from "bun:test"
import { safeFileName, summarizeRejectedReasons } from "./rd-ledger"

test("ledger rejection summaries are deterministic", () => {
  const batch = {
    batch_id: "b1",
    hypothesis: "h1",
    candidate_source: "provided",
    outcome: "no_promote",
    trial_count: 2,
    accepted_count: 0,
    winner: null,
    candidates: [
      { gate: { accepted: false, blocked_by: [{ check_id: "B", reason: "b" }, { check_id: "A", reason: "a" }] } },
      { gate: { accepted: false, blocked_by: [{ check_id: "B", reason: "b" }] } },
    ],
  } as Parameters<typeof summarizeRejectedReasons>[0]
  expect(summarizeRejectedReasons(batch)).toEqual([{ check_id: "B", count: 2 }, { check_id: "A", count: 1 }])
  expect(safeFileName(" unsafe / run ")).toBe("unsafe-run")
})
