import {
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { expect, test } from "bun:test"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
  prepareFormalReplayData,
} from "./formal-replay-data-preparer"
import type { FormalReplayContext } from "./formal-replay-runner"

test("formal Replay data preparation binds one exact snapshot through the Replay owner", () => {
  const root = `tmp/formal-replay-prepare-${process.pid}-${Date.now()}`
  const db = `${root}/rd.db`
  const outputRef = `${root}/bundle.json`
  const binding = dataBinding()
  const context = fixtureContext()
  const calls: string[][] = []
  mkdirSync(resolveRepoPath(root), { recursive: true })
  const request = {
    schema_version: FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
    request_registration_id: "registration-1",
    request_registration_hash: "a".repeat(64),
    data_snapshot_binding: binding,
    funding_events_source: null,
    mark_events_source: null,
    supplemental_facts_source: null,
    output_ref: outputRef,
    environment_id: "test:formal-replay-prepare",
  }
  try {
    const result = prepareFormalReplayData(db, request, {
      load_context: () => context,
      compile: (args) => {
        calls.push(args)
        return {
          schema_version: "trade.rd-formal-replay-data-bundle-compile-result.v1",
          bundle_ref: outputRef,
          bundle_sha256: "f".repeat(64),
          dataset_manifest_hash: "b".repeat(64),
          dataset_hash: "e".repeat(64),
          row_count: 2,
          recovered: false,
          replay_authority: "none_until_registered_attempt",
          review_authority: "none",
          deployment_authority: "none",
          trading_authority: false,
        }
      },
    })
    expect(result.data_snapshot_binding_hash).toBe(binding.binding_hash)
    expect(result.trading_authority).toBe(false)
    expect(calls[0]?.[0]).toBe("--compile-data-bundle")
    expect(calls[0]?.[1]).toBe("--input")
    const ownerInput = JSON.parse(
      readFileSync(resolveRepoPath(calls[0]![2]!), "utf8"),
    )
    expect(ownerInput.dataset_manifest).toEqual(context.manifest)
    expect(ownerInput.ohlcv_source).toEqual({
      ref: binding.content_ref,
      sha256: binding.content_hash,
    })
    expect(ownerInput.output_ref).toBe(outputRef)
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

test("formal Replay data preparation rejects snapshot/registration drift before owner execution", () => {
  const root = `tmp/formal-replay-prepare-drift-${process.pid}-${Date.now()}`
  const db = `${root}/rd.db`
  const binding = dataBinding()
  let called = false
  mkdirSync(resolveRepoPath(root), { recursive: true })
  try {
    expect(() => prepareFormalReplayData(db, {
      schema_version: FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
      request_registration_id: "registration-1",
      request_registration_hash: "a".repeat(64),
      data_snapshot_binding: { ...binding, row_count: 3 },
      funding_events_source: null,
      mark_events_source: null,
      supplemental_facts_source: null,
      output_ref: `${root}/bundle.json`,
      environment_id: "test:formal-replay-prepare-drift",
    }, {
      load_context: () => fixtureContext(),
      compile: () => {
        called = true
        return {}
      },
    })).toThrow("binding hash drifted")
    expect(called).toBe(false)
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

function dataBinding() {
  return createDeveloperDataSnapshotBinding({
    schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
    snapshot_ref: "dataset-split://fixture",
    snapshot_hash: "1".repeat(64),
    dataset_kinds: ["ohlcv"],
    hypothesis_id: "hypothesis-1",
    symbol: "BTCUSDT",
    exchange: "binance-usdm",
    segment: "validation",
    timeframe: "4h",
    row_count: 2,
    first_open_at: "2026-07-14T00:00:00.000Z",
    last_open_at: "2026-07-14T04:00:00.000Z",
    report_ref: "tmp/fixture/report.json",
    report_hash: "2".repeat(64),
    manifest_ref: "tmp/fixture/manifest.json",
    manifest_hash: "3".repeat(64),
    content_ref: "tmp/fixture/4h.csv",
    content_hash: "4".repeat(64),
    evidence_ref: "dataset-split://fixture",
  })
}

function fixtureContext(): FormalReplayContext {
  const replayRequest = {
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_id: "trial-1",
    run_id: "run-1",
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: "e".repeat(64),
  }
  return {
    registration: {
      registration_id: "registration-1",
      registration_hash: "a".repeat(64),
      reservation_admission_id: "admission-1",
      reservation_admission_hash: "c".repeat(64),
      trial_id: "trial-1",
      run_id: "run-1",
      request_hash: "d".repeat(64),
      dataset_manifest_hash: "b".repeat(64),
      replay_request: replayRequest,
    } as FormalReplayContext["registration"],
    admission: {
      admission_id: "admission-1",
      admission_hash: "c".repeat(64),
      reservation_snapshot: { reservation_id: "reservation-1" },
    } as FormalReplayContext["admission"],
    request: replayRequest as JSONRecord,
    manifest: {
      manifest_ref: "dataset://fixture",
      data_hash: "e".repeat(64),
      symbol: "BTCUSDT",
      timeframe: "4h",
      interval_ms: 14_400_000,
      row_count: 2,
      first_open_time: "2026-07-14T00:00:00.000Z",
      last_close_time: "2026-07-14T08:00:00.000Z",
    },
    stored_manifest_hash: "b".repeat(64),
  }
}
