import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  buildWatchTaskDefinition,
  WATCH_TASK_OBSERVATION_SCHEMA,
  type WatchTaskDefinition,
  type WatchTaskEvaluation,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  runWatchTaskSession,
  type RuntimeWatchTaskRecord,
  type WatchTaskClock,
  type WatchTaskStatePort,
} from "./watch-task-runtime"
import { createOpsRuntimeStorePort } from "./watch-task-owner-ports"

const definition = buildWatchTaskDefinition({
  task_id: "watch-runtime-1",
  plan_ref: "plan://1",
  flow_id: "flow-1",
  intent_ref: "intent://1",
  intent_content_hash: "sha256:intent-1",
  symbol: "BTCUSDT",
  side: "long",
  source_refs: ["market://btc"],
  trigger: { kind: "mark_price_in_range", low: 99, high: 101 },
  invalidation: { kind: "mark_price_at_or_beyond", operator: "lte", price: 95 },
  lifetime: {
    created_at: "2026-07-23T00:00:00.000Z",
    not_before: "2026-07-23T00:00:00.000Z",
    deadline: "2026-07-23T01:00:00.000Z",
  },
  budget: { poll_interval_ms: 1_000, max_observations: 10, max_errors: 1, max_fact_age_ms: 2_000 },
  idempotency_key: "watch:flow-1:intent-1",
})

test("watch task session polls until trigger and returns only a no-authority handoff", async () => {
  const state = new MemoryStatePort(definition)
  const clock = new MemoryClock("2026-07-23T00:00:01.000Z")
  const marks = [110, 100]
  const result = await runWatchTaskSession({
    definition,
    state,
    clock,
    holderId: "fixture-holder",
    observations: {
      observe: async () => ({
        schema_version: WATCH_TASK_OBSERVATION_SCHEMA,
        observation_ref: `market://obs/${marks.length}`,
        symbol: "BTCUSDT",
        observed_at: clock.now(),
        source_observed_at: clock.now(),
        mark_price: marks.shift() ?? 100,
        continuity: "point_in_time",
      }),
    },
  })
  assert.equal(result.status, "triggered")
  assert.equal(result.task_status, "triggered")
  assert.equal(result.observation_count, 2)
  assert.equal(result.handoff?.execution_authority, "none")
  assert.equal(state.renewals, 1)
  assert.equal(state.releases, 1)
})

test("watch task session exhausts observation errors and stops on lease contention", async () => {
  const state = new MemoryStatePort(definition)
  const clock = new MemoryClock("2026-07-23T00:00:01.000Z")
  const blocked = await runWatchTaskSession({
    definition,
    state,
    clock,
    holderId: "fixture-holder",
    observations: { observe: async () => { throw new Error("market unavailable") } },
  })
  assert.equal(blocked.status, "terminal")
  assert.equal(blocked.task_status, "blocked")
  assert.equal(blocked.terminal_reason, "error_budget_exhausted")
  assert.equal(blocked.handoff, undefined)

  const contendedState = new MemoryStatePort(definition)
  contendedState.leaseAvailable = false
  const contended = await runWatchTaskSession({
    definition,
    state: contendedState,
    clock,
    observations: { observe: async () => { throw new Error("must not run") } },
  })
  assert.equal(contended.status, "lease_unavailable")
  assert.equal(contended.task_status, "created")
})

test("runtime state port uses the ops owner CLI and preserves compare-and-set state", () => {
  const root = repoRoot()
  const directory = `tmp/watch-task-port-${process.pid}-${Date.now()}`
  const dbRef = `${directory}/ops.db`
  mkdirSync(resolve(root, directory), { recursive: true })
  try {
    const port = createOpsRuntimeStorePort({ repositoryRoot: root, bunPath: process.execPath, dbPath: dbRef })
    const created = port.create(definition)
    const armed = port.arm(created, "2026-07-23T00:00:00.500Z")
    assert.equal(armed.status, "armed")
    assert.equal(port.read(definition.task_id).version, armed.version)
    const lease = port.acquireLease(
      definition.task_id,
      "fixture-holder",
      "2026-07-23T00:00:01.000Z",
      "2026-07-23T00:00:31.000Z",
    )
    assert.equal(lease.acquired, true)
    assert.equal(port.renewLease(
      definition.task_id,
      "fixture-holder",
      lease.fencing_token ?? 0,
      "2026-07-23T00:00:02.000Z",
      "2026-07-23T00:00:32.000Z",
    ), true)
    port.releaseLease(definition.task_id, "fixture-holder", lease.fencing_token ?? 0)
  } finally {
    rmSync(resolve(root, directory), { recursive: true, force: true })
  }
})

class MemoryClock implements WatchTaskClock {
  private currentMs: number

  constructor(initial: string) {
    this.currentMs = Date.parse(initial)
  }

  now(): string {
    return new Date(this.currentMs).toISOString()
  }

  async sleep(milliseconds: number): Promise<void> {
    this.currentMs += milliseconds
  }
}

class MemoryStatePort implements WatchTaskStatePort {
  record: RuntimeWatchTaskRecord
  leaseAvailable = true
  renewals = 0
  releases = 0

  constructor(definition: WatchTaskDefinition) {
    this.record = {
      definition,
      status: "created",
      observation_count: 0,
      error_count: 0,
      version: 1,
      updated_at: definition.lifetime.created_at,
    }
  }

  create(): RuntimeWatchTaskRecord {
    return this.record
  }

  read(): RuntimeWatchTaskRecord {
    return this.record
  }

  arm(task: RuntimeWatchTaskRecord, now: string): RuntimeWatchTaskRecord {
    this.record = { ...task, status: "armed", version: task.version + 1, updated_at: now }
    return this.record
  }

  apply(task: RuntimeWatchTaskRecord, evaluation: WatchTaskEvaluation): RuntimeWatchTaskRecord {
    const status = evaluation.outcome === "wait" ? "observing" : evaluation.outcome
    this.record = {
      ...task,
      status,
      observation_count: evaluation.next_observation_count,
      error_count: evaluation.next_error_count,
      version: task.version + 1,
      updated_at: evaluation.evaluated_at,
      terminal_reason: ["expired", "blocked"].includes(status) ? evaluation.reason : undefined,
      last_observation_ref: evaluation.observation_ref,
      handoff: evaluation.handoff,
    }
    return this.record
  }

  acquireLease(): { acquired: boolean; fencing_token?: number } {
    return this.leaseAvailable ? { acquired: true, fencing_token: 1 } : { acquired: false }
  }

  renewLease(): boolean {
    this.renewals += 1
    return true
  }

  releaseLease(): void {
    this.releases += 1
  }
}
