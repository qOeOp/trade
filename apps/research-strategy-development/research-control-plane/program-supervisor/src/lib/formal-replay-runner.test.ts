import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { expect, test } from "bun:test"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  FORMAL_REPLAY_DATA_BUNDLE_SCHEMA,
  FORMAL_REPLAY_JOB_REQUEST_SCHEMA,
  runFormalReplayJob,
  type FormalReplayContext,
  type FormalReplayJobResult,
  type FormalReplayRunnerDependencies,
} from "./formal-replay-runner"

test("formal Replay job crosses owner processes through one immutable dispatch file", () => {
  const token = createHash("sha256")
    .update(`${process.pid}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16)
  const root = `tmp/formal-replay-job-${token}`
  const db = `${root}/rd.db`
  const artifactRoot = `${root}/artifacts`
  const bundleRef = `${root}/bundle.json`
  const absoluteRoot = resolveRepoPath(root)
  mkdirSync(absoluteRoot, { recursive: true })
  const bundle = {
    schema_version: FORMAL_REPLAY_DATA_BUNDLE_SCHEMA,
    dataset_manifest_hash: "b".repeat(64),
    bars: [{ open_time: "2026-07-22T00:00:00.000Z" }],
    funding_events: [],
    mark_events: [],
    supplemental_facts: [],
  }
  writeFileSync(resolveRepoPath(bundleRef), `${JSON.stringify(bundle)}\n`)
  const calls: { admits: string[][]; runs: string[][] } = {
    admits: [],
    runs: [],
  }
  const context = fixtureContext()
  const expected: FormalReplayJobResult = {
    schema_version: "trade.rd-formal-replay-job-result.v1",
    status: "completed",
    execution_id: "execution-1",
    request_registration_id: "registration-1",
    attempt_id: "formal-replay-attempt:execution-1",
    result_id: "formal-replay-result:fixture",
    artifact_ref: "replay-artifact://fixture",
    dispatch_ref: null,
    dispatch_sha256: null,
    recovered_result: false,
    formal_evidence_kind: "mechanical_replay",
    review_authority: "classified_result_only",
    deployment_authority: "none",
    trading_authority: false,
  }
  const times = [
    new Date("2026-07-23T01:00:00.000Z"),
    new Date("2026-07-23T01:00:01.000Z"),
    new Date("2026-07-23T01:01:00.000Z"),
    new Date("2026-07-23T01:01:01.000Z"),
  ]
  const dependencies: FormalReplayRunnerDependencies = {
    now: () => times.shift()!,
    load_context: () => context,
    admit: (args) => {
      calls.admits.push(args)
      return { dispatch_authority: { authority_id: "authority-1" } }
    },
    run: (args) => {
      calls.runs.push(args)
      return { status: "completed" }
    },
    persist: (_db, _request, _context, _outcome, dispatch) => ({
      ...expected,
      dispatch_ref: dispatch.ref,
      dispatch_sha256: dispatch.sha256,
    }),
  }
  try {
    const request = {
      schema_version: FORMAL_REPLAY_JOB_REQUEST_SCHEMA,
      execution_id: "execution-1",
      request_registration_id: "registration-1",
      request_registration_hash: "a".repeat(64),
      data_bundle_ref: bundleRef,
      data_bundle_sha256: sha256(readFileSync(resolveRepoPath(bundleRef))),
      artifact_root: artifactRoot,
      environment_id: "local:local",
      worker_id: "formal-replay-worker-1",
      lease_duration_ms: 300_000,
    }
    const result = runFormalReplayJob(db, request, dependencies)
    expect(result.status).toBe("completed")
    expect(calls.admits[0]).toContain("--recovered-at")
    expect(calls.runs[0]?.[0]).toBe("--input")
    const dispatchRef = calls.runs[0]?.[1]
    expect(dispatchRef).toBeTruthy()
    expect(existsSync(resolveRepoPath(dispatchRef!))).toBe(true)
    const dispatch = JSON.parse(readFileSync(resolveRepoPath(dispatchRef!), "utf8"))
    expect(dispatch.dispatch_authority.authority_id).toBe("authority-1")
    expect(dispatch.trial_reservation.reservation_id).toBe("reservation-1")
    expect(dispatch.dataset_manifest.manifest_ref).toBe("dataset://fixture")
    expect(dispatch.bars).toEqual(bundle.bars)
    expect(dispatch).not.toHaveProperty("request")
    expect(dispatch).not.toHaveProperty("attempt_lease")

    const restarted = runFormalReplayJob(db, request, dependencies)
    expect(restarted.status).toBe("completed")
    expect(calls.admits).toHaveLength(2)
    const firstClaim = JSON.parse(calls.admits[0]!.at(-1)!)
    const restartedClaim = JSON.parse(calls.admits[1]!.at(-1)!)
    expect(restartedClaim.claimed_at).toBe(firstClaim.claimed_at)
    expect(restartedClaim.lease_expires_at).toBe(firstClaim.lease_expires_at)
    expect(calls.runs[1]?.[1]).toBe(dispatchRef)
  } finally {
    rmSync(absoluteRoot, { recursive: true, force: true })
  }
})

test("formal Replay job request is closed and rejects unsafe paths before owner calls", () => {
  expect(() => runFormalReplayJob("data/rd.db", {
    schema_version: FORMAL_REPLAY_JOB_REQUEST_SCHEMA,
    unexpected: true,
  })).toThrow("request contract")
})

function fixtureContext(): FormalReplayContext {
  const registration = {
    registration_id: "registration-1",
    registration_hash: "a".repeat(64),
    reservation_admission_id: "admission-1",
    reservation_admission_hash: "c".repeat(64),
    trial_id: "trial-1",
    run_id: "run-1",
    request_hash: "d".repeat(64),
    dataset_manifest_hash: "b".repeat(64),
    replay_request: {
      experiment_id: "experiment-1",
      trial_group_id: "group-1",
      trial_id: "trial-1",
      run_id: "run-1",
      dataset_manifest_ref: "dataset://fixture",
      dataset_hash: "e".repeat(64),
    },
  }
  return {
    registration: registration as FormalReplayContext["registration"],
    admission: {
      admission_id: "admission-1",
      admission_hash: "c".repeat(64),
      reservation_snapshot: { reservation_id: "reservation-1" },
    } as FormalReplayContext["admission"],
    request: registration.replay_request as JSONRecord,
    manifest: {
      manifest_ref: "dataset://fixture",
      data_hash: "e".repeat(64),
    },
    stored_manifest_hash: "b".repeat(64),
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
