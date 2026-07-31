import assert from "node:assert/strict"
import test from "node:test"
import { sourcePlan } from "./funding-demand-plan.test"
import { runFundingDemandCycle } from "./funding-demand-worker"

test("funding demand cycle fetches one missing exact window without claiming completion", async () => {
  const fetched: string[] = []
  const result = await runFundingDemandCycle({
    observed_at: "2026-07-23T08:00:00.000Z",
    max_jobs: 1,
  }, {
    read_subscription_plan: async () => sourcePlan(),
    resolve_coverage: async () => ({ status: "missing", audit: null, candidate_archive_ids: [] }),
    fetch_window: async (job) => {
      fetched.push(job.target.target_id)
      return { ok: true, reason: "owner_commit_completed" }
    },
  })
  assert.equal(result.status, "completed")
  assert.equal(result.complete_target_count, 0)
  assert.equal(result.executed_job_count, 1)
  assert.equal(result.facts.length, 0)
  assert.equal(fetched.length, 1)
  assert.match(fetched[0]!, /^funding:BTCUSDT:/)
})

test("funding conflict degrades without fetching or choosing evidence", async () => {
  const result = await runFundingDemandCycle({
    observed_at: "2026-07-23T08:00:00.000Z",
    max_jobs: 1,
  }, {
    read_subscription_plan: async () => sourcePlan(),
    resolve_coverage: async () => ({
      status: "conflict",
      audit: null,
      candidate_archive_ids: ["funding-archive:a", "funding-archive:b"],
    }),
    fetch_window: async () => {
      throw new Error("must not fetch conflict")
    },
  })
  assert.equal(result.status, "degraded")
  assert.equal(result.conflict_target_count, 1)
  assert.equal(result.executed_job_count, 0)
})
