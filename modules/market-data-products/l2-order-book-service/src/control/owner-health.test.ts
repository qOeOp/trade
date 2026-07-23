import assert from "node:assert/strict"
import test from "node:test"
import { buildL2OwnerHealth, buildUnavailableL2OwnerHealth, selectUniqueActiveL2Launch } from "./owner-health"
import type { LaunchReceipt, RuntimeState } from "./runtime-contract"

const receipt: LaunchReceipt = {
  schema_version: "trade.l2-service-launch-receipt.v1",
  launched_at: "2026-07-22T00:00:00Z",
  supervisor_pid: 101,
  runtime_directory: "tmp/l2-order-book-service/runtime/test",
  runtime_state_path: "tmp/l2-order-book-service/runtime/test/runtime-state.json",
  terminal_state_path: "tmp/l2-order-book-service/runtime/test/terminal-state.json",
  log_path: "tmp/l2-order-book-service/runtime/test/supervisor.log",
  service_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service",
  query_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query",
  config: {
    symbol: "BTCUSDT", output_base: "data/l2", listen: "127.0.0.1:50061", epoch_seconds: 86_100,
    duration_seconds: 86_400, queue_capacity: 256, segment_frames: 1_000, sync_every_frames: 100,
    stale_after_ms: 2_000, restart_limit: 3, market_data_db: "data/market_data.db",
    admission_interval_ms: 30_000, disk_check_interval_ms: 5_000,
    disk_soft_min_bytes: 10 * 1024 ** 3, disk_hard_min_bytes: 5 * 1024 ** 3,
    resource_check_interval_ms: 30_000,
  },
}

const state: RuntimeState = {
  schema_version: "trade.l2-service-runtime-state.v1",
  updated_at: "2026-07-22T00:01:00Z",
  status: "running",
  supervisor_pid: 101,
  service_pid: 102,
  attempt: 1,
  consecutive_failures: 0,
  last_exit_code: null,
  next_restart_at: null,
  disk_status: "healthy",
  disk_available_bytes: 20 * 1024 ** 3,
  disk_last_error: "",
  admission_status: "ready",
  admission_last_checked_at: "2026-07-22T00:01:00Z",
  admission_last_error: "",
  admission_created_total: 0,
  admission_rejected_incomplete_total: 0,
  admission_rejected_invalid_total: 0,
  resource_last_checked_at: "2026-07-22T00:01:00Z",
  resource_last_error: "",
  service_rss_bytes: 12_000_000,
  service_rss_max_bytes: 18_000_000,
  service_cpu_percent: 0.2,
  service_cpu_max_percent: 3.1,
}

const source = {
  schema_version: "trade.l2-health.v1",
  symbol: "BTCUSDT",
  service_status: "live",
  stream_epoch: "epoch-1",
  continuity_status: "live",
  source_ready: true,
  raw_writer_ready: true,
  projector_ready: true,
  read_ready: true,
  broker_enabled: false,
  broker_ready: false,
  last_update_id: 100,
  last_receive_time_ms: 1_700_000_000_000,
  freshness_ms: 20,
  incident_count: 0,
  last_incident: "",
}

test("L2 owner health closes supervisor control and loopback source readiness without paths or pids", () => {
  const health = buildL2OwnerHealth({
    observed_at: "2026-07-22T00:02:00Z",
    receipt,
    runtime_state: state,
    terminal_state: null,
    supervisor_alive: true,
    service_alive: true,
    source_health: source,
  })
  assert.equal(health.status, "healthy")
  assert.equal(health.readiness.overall_ready, true)
  assert.equal(health.readiness.control_state_fresh, true)
  assert.equal(health.control?.state_age_ms, 60_000)
  assert.equal(health.control?.state_stale_after_ms, 90_000)
  assert.equal(health.control?.admission_status, "ready")
  assert.equal(health.source?.stream_epoch, "epoch-1")
  assert.equal(health.lifecycle_authority, "none")
  assert.equal(JSON.stringify(health).includes("supervisor_pid"), false)
  assert.equal(JSON.stringify(health).includes("runtime_state_path"), false)
})

test("L2 owner health degrades on control pressure and fails closed on identity drift", () => {
  const health = buildL2OwnerHealth({
    observed_at: "2026-07-22T00:02:00Z",
    receipt,
    runtime_state: { ...state, disk_status: "soft_limit" },
    terminal_state: null,
    supervisor_alive: true,
    service_alive: true,
    source_health: source,
  })
  assert.equal(health.status, "degraded")
  assert.equal(health.readiness.control_ready, true)
  assert.equal(health.readiness.source_read_ready, true)
  assert.equal(health.readiness.overall_ready, true)
  const stale = buildL2OwnerHealth({
    observed_at: "2026-07-22T00:03:00Z",
    receipt,
    runtime_state: state,
    terminal_state: null,
    supervisor_alive: true,
    service_alive: true,
    source_health: source,
  })
  assert.equal(stale.status, "degraded")
  assert.equal(stale.readiness.control_state_fresh, false)
  assert.equal(stale.readiness.control_ready, false)
  assert.throws(() => buildL2OwnerHealth({
    observed_at: "2026-07-22T00:02:00Z",
    receipt,
    runtime_state: state,
    terminal_state: null,
    supervisor_alive: true,
    service_alive: true,
    source_health: { ...source, symbol: "ETHUSDT" },
  }), /identity drifted/)
})

test("L2 owner health represents no active supervisor without inventing readiness", () => {
  const health = buildUnavailableL2OwnerHealth("2026-07-22T00:02:00Z")
  assert.equal(health.status, "unavailable")
  assert.equal(health.symbol, null)
  assert.equal(health.readiness.overall_ready, false)
  assert.equal(health.lifecycle_authority, "none")
  assert.equal(selectUniqueActiveL2Launch([]), null)
  assert.equal(selectUniqueActiveL2Launch(["active"]), "active")
  assert.throws(() => selectUniqueActiveL2Launch(["one", "two"]), /multiple active/)
})
