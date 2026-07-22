import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { runServerRuntimePublicSmoke } from "./server-runtime-public-smoke"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import type { ServerRuntimeStatus } from "./server-runtime-status"

const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8"),
))

test("public smoke requires two healthy cycles without epoch, parity, or fencing drift", async () => {
  const samples = [status("cycle-1", 10, false), status("cycle-1", 11, false), status("cycle-2", 12, false)]
  const result = await runServerRuntimePublicSmoke(profile, "/opt/trade", "/usr/bin/bun", {
    timeoutMs: 1_000,
    pollMs: 100,
  }, {
    sample: () => samples.shift() ?? status("cycle-2", 12, false),
    sleep: async () => undefined,
  })
  assert.equal(result.status, "local_observation_passed")
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.observation_id), ["cycle-1", "cycle-2"])
  assert.equal(result.pending_server_gates.includes("systemd_units_not_observable_and_active"), true)
})

test("public smoke rejects a consumer epoch or comparable parity regression", async () => {
  const paritySamples = [status("cycle-1", 10, true), status("cycle-2", 11, true, { mismatches: 1 })]
  await assert.rejects(runServerRuntimePublicSmoke(profile, "/opt/trade", "/usr/bin/bun", {
    timeoutMs: 1_000,
    pollMs: 100,
  }, {
    sample: () => paritySamples.shift() ?? status("cycle-2", 11, true, { mismatches: 1 }),
    sleep: async () => undefined,
  }), /mismatch increased/)

  const epochSamples = [status("cycle-1", 10, true), status("cycle-2", 11, true, { epoch: "epoch-2" })]
  await assert.rejects(runServerRuntimePublicSmoke(profile, "/opt/trade", "/usr/bin/bun", {
    timeoutMs: 1_000,
    pollMs: 100,
  }, {
    sample: () => epochSamples.shift() ?? status("cycle-2", 11, true, { epoch: "epoch-2" }),
    sleep: async () => undefined,
  }), /epoch changed/)
})

function status(
  observationId: string,
  matches: number,
  systemdReady: boolean,
  changes: { epoch?: string; mismatches?: number } = {},
): ServerRuntimeStatus {
  const epoch = changes.epoch ?? "epoch-1"
  return {
    schema_version: "trade.server-runtime-status.v1",
    observed_at: "2026-07-23T00:00:00.000Z",
    profile_id: "server-shadow",
    deployment_id: "single-node-shadow",
    profile_hash: "hash",
    status: systemdReady ? "ready" : "degraded",
    readiness: {
      l2_owner_ready: true,
      l2_consumer_ready: true,
      l2_epoch_matches_consumer: true,
      control_lease_active: true,
      process_manager_observable: systemdReady,
      process_units_active: systemdReady,
      overall_ready: systemdReady,
    },
    components: {
      l2_owner: { source: { stream_epoch: epoch } },
      l2_consumer: {
        latest_baseline: { stream_epoch: epoch },
        metrics: { watch_cycle_total: matches * 10 },
        control: { restart_total: 1 },
      },
      control_runtime: {
        latest: { observation_id: observationId },
        comparable_counts: { matched: matches, mismatched: changes.mismatches ?? 0 },
        supervisor_lease: { fencing_token: 7 },
      },
    },
    process_units: {},
    limitations: [],
  }
}
