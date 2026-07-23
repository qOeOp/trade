import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  FORMAL_REPLAY_QUEUE_WORK_SCHEMA,
  type FormalReplayQueueWork,
} from "./formal-replay-job-queue"

export function formalReplayQueueWorkFixture(
  jobId = "job-1",
  environmentId = "test:formal-replay-resident",
): FormalReplayQueueWork {
  const binding = createDeveloperDataSnapshotBinding({
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
  return {
    schema_version: FORMAL_REPLAY_QUEUE_WORK_SCHEMA,
    job_id: jobId,
    idempotency_key: `formal-replay:${jobId}`,
    request_registration_id: "registration-1",
    request_registration_hash: "a".repeat(64),
    data_snapshot_binding: binding,
    funding_events_source: null,
    mark_events_source: null,
    supplemental_facts_source: null,
    data_bundle_ref: `tmp/formal-replay/${jobId}/bundle.json`,
    artifact_root: `tmp/formal-replay/${jobId}/artifacts`,
    environment_id: environmentId,
    replay_worker_id: "formal-replay-worker",
    replay_lease_duration_ms: 300_000,
    max_queue_attempts: 3,
    accepted_at: "2026-07-23T00:00:00.000Z",
  }
}
