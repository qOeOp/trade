import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { serverRuntimeProfileHash } from "./server-runtime-profile"
import { readServerRuntimeStatus, type ServerRuntimeStatus } from "./server-runtime-status"

export const SERVER_RUNTIME_PUBLIC_SMOKE_SCHEMA = "trade.server-runtime-public-smoke.v2" as const

interface SmokeSnapshot {
  observation_id: string
  observed_at: string
  stream_epoch: string
  consumer_watch_cycles: number
  consumer_restarts: number
  comparable_matches: number
  comparable_mismatches: number
  fencing_token: number
  process_manager_ready: boolean
}

export interface ServerRuntimePublicSmokeResult {
  schema_version: typeof SERVER_RUNTIME_PUBLIC_SMOKE_SCHEMA
  profile_id: string
  deployment_id: string
  profile_hash: string
  status: "local_observation_passed" | "server_observation_passed"
  snapshots: [SmokeSnapshot, SmokeSnapshot]
  assertions: {
    l2_owner_ready: true
    consumer_ready_same_epoch: true
    two_distinct_control_cycles: true
    comparable_mismatch_did_not_increase: true
    fenced_lease_stable: true
  }
  pending_server_gates: string[]
  limitations: string[]
}

export interface PublicSmokeDependencies {
  sample?: () => ServerRuntimeStatus
  sleep?: (milliseconds: number) => Promise<void>
}

export async function runServerRuntimePublicSmoke(
  profile: ServerRuntimeProfile,
  releaseRoot: string,
  bunPath: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
  dependencies: PublicSmokeDependencies = {},
): Promise<ServerRuntimePublicSmokeResult> {
  const timeoutMs = boundedInteger(options.timeoutMs ?? 90_000, 1_000, 300_000, "timeout_ms")
  const pollMs = boundedInteger(options.pollMs ?? 5_000, 100, timeoutMs, "poll_ms")
  const sample = dependencies.sample ?? (() => readServerRuntimeStatus(profile, releaseRoot, bunPath))
  const sleep = dependencies.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
  const first = compactReadySnapshot(sample())
  const deadline = Date.now() + timeoutMs
  let second: SmokeSnapshot | undefined
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())))
    const candidate = compactReadySnapshot(sample())
    if (candidate.observation_id !== first.observation_id) {
      second = candidate
      break
    }
  }
  if (!second) throw new Error("public smoke timed out before a second control cycle")
  if (second.stream_epoch !== first.stream_epoch) throw new Error("L2 epoch changed during public smoke")
  if (second.comparable_mismatches > first.comparable_mismatches) {
    throw new Error("comparable Agent/program mismatch increased during public smoke")
  }
  if (second.fencing_token !== first.fencing_token) throw new Error("control fencing token changed during public smoke")
  const serverReady = first.process_manager_ready && second.process_manager_ready
  return {
    schema_version: SERVER_RUNTIME_PUBLIC_SMOKE_SCHEMA,
    profile_id: profile.profile_id,
    deployment_id: profile.deployment_id,
    profile_hash: serverRuntimeProfileHash(profile),
    status: serverReady ? "server_observation_passed" : "local_observation_passed",
    snapshots: [first, second],
    assertions: {
      l2_owner_ready: true,
      consumer_ready_same_epoch: true,
      two_distinct_control_cycles: true,
      comparable_mismatch_did_not_increase: true,
      fenced_lease_stable: true,
    },
    pending_server_gates: [
      ...(!serverReady ? ["process_manager_units_not_observable_and_active"] : []),
      "operator_controlled_real_consumer_fault_injection_not_executed",
      "real_volume_backup_restore_not_covered_by_public_smoke",
    ],
    limitations: [
      "read_only_bounded_public_market_observation",
      "does_not_signal_restart_or_install_processes",
      "does_not_enable_domain_jobs_notifications_or_live_writes",
      "single_fenced_lease_view_is_not_distributed_consensus_evidence",
    ],
  }
}

function compactReadySnapshot(status: ServerRuntimeStatus): SmokeSnapshot {
  if (!status.readiness.l2_owner_ready) throw new Error("L2 owner is not ready")
  if (!status.readiness.l2_consumer_ready) throw new Error("L2 consumer is not ready")
  if (!status.readiness.l2_epoch_matches_consumer) throw new Error("L2 consumer epoch does not match owner")
  if (!status.readiness.control_lease_active) throw new Error("control lease is not active")
  const owner = status.components.l2_owner as Record<string, unknown>
  const consumer = status.components.l2_consumer as Record<string, unknown>
  const control = status.components.control_runtime as Record<string, unknown>
  const source = record(owner.source, "l2_owner.source")
  const latestBaseline = record(consumer.latest_baseline, "l2_consumer.latest_baseline")
  const metrics = record(consumer.metrics, "l2_consumer.metrics")
  const controlState = record(consumer.control, "l2_consumer.control")
  const latest = record(control.latest, "control_runtime.latest")
  const comparable = record(control.comparable_counts, "control_runtime.comparable_counts")
  const lease = record(control.supervisor_lease, "control_runtime.supervisor_lease")
  const streamEpoch = text(source.stream_epoch, "l2_owner.source.stream_epoch")
  if (text(latestBaseline.stream_epoch, "l2_consumer.latest_baseline.stream_epoch") !== streamEpoch) {
    throw new Error("L2 consumer baseline epoch drifted from owner")
  }
  return {
    observation_id: text(latest.observation_id, "control_runtime.latest.observation_id"),
    observed_at: status.observed_at,
    stream_epoch: streamEpoch,
    consumer_watch_cycles: integer(metrics.watch_cycle_total, "l2_consumer.metrics.watch_cycle_total"),
    consumer_restarts: integer(controlState.restart_total, "l2_consumer.control.restart_total"),
    comparable_matches: integer(comparable.matched, "control_runtime.comparable_counts.matched"),
    comparable_mismatches: integer(comparable.mismatched, "control_runtime.comparable_counts.mismatched"),
    fencing_token: integer(lease.fencing_token, "control_runtime.supervisor_lease.fencing_token"),
    process_manager_ready: status.readiness.process_manager_observable && status.readiness.process_units_active,
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} must be a non-empty string`)
  return value
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`)
  return Number(value)
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
