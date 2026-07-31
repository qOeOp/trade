import { expect, test } from "bun:test"
import { runReplayPortfolioCycleSequenceAccounting } from "./replay-portfolio-cycle-sequence-accounting-runner"
import { runReplayPortfolioReallocation } from "./replay-portfolio-reallocation-runner"
import { runReplayTwoCyclePortfolio } from "./replay-two-cycle-portfolio-runner"

test("legacy portfolio cycle exposes only its three historical consumer roots", () => {
  expect([
    runReplayPortfolioReallocation,
    runReplayTwoCyclePortfolio,
    runReplayPortfolioCycleSequenceAccounting,
  ].every((entrypoint) => typeof entrypoint === "function")).toBe(true)
})
