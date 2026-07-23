import { expect, test } from "bun:test"
import { parseArgs } from "./resident"

test("Strategy Registry resident CLI is unbounded and candidate-only by default", () => {
  const config = parseArgs([])
  expect(config.max_cycles).toBe(0)
  expect(config.candidate_root).toBe(
    "data/release-candidates/strategy-drafts",
  )
  expect(config.db_path).toBe("data/rd_state.db")
})

test("Strategy Registry resident CLI validates bounded controls", () => {
  expect(() => parseArgs(["--lease-duration-ms", "999"])).toThrow()
  expect(parseArgs([
    "--max-cycles",
    "1",
    "--worker-id",
    "registry:test",
  ]).max_cycles).toBe(1)
})
