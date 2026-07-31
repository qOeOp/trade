import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, test } from "bun:test"
import {
  buildOhlcvCoverageAuditFixture,
} from "../../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import {
  reconcileMarketDataDemands,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  createForwardObservationCandleSegment,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-candle-segment"
import {
  buildForwardObservationMarketDataDemand,
  createForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import {
  materializeForwardDatasetCandidate,
} from "./forward-dataset-candidate-materializer"

const HASH = "a".repeat(64)

test("Forward dataset materializer verifies owner slices and publishes one immutable OHLCV-only candidate", () => {
  const root = mkdtempSync(join(tmpdir(), "forward-dataset-candidate-"))
  try {
    const program = fixtureProgram()
    const demand = buildForwardObservationMarketDataDemand(program, {
      issued_at: "2026-07-23T03:00:00.000Z",
    })
    const observedAt = "2026-07-23T08:01:00.000Z"
    const openTime = Date.parse(program.first_observation_open_time)
    const csv = [
      "date,timestamp,open,high,low,close,volume",
      `${new Date(openTime).toISOString()},${openTime},100,101,99,100.5,10`,
      "",
    ].join("\n")
    const sliceHash = createHash("sha256").update(csv).digest("hex")
    const artifactDir = join(
      root,
      "data/artifacts/market-data/candle-slices",
      sliceHash,
    )
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(join(artifactDir, "4h.csv"), csv)
    writeFileSync(join(artifactDir, "manifest.json"), JSON.stringify({
      slice_ref: `market-data://candle-slice/${sliceHash}`,
      closed_candles_only: true,
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
          rows: 1,
          first_open_ts: openTime,
          last_open_ts: openTime,
          content_sha256: sliceHash,
        },
      },
    }))
    const segment = createForwardObservationCandleSegment({
      program,
      previous_segment: null,
      demand,
      demand_accepted_at: "2026-07-23T03:00:01.000Z",
      subscription_plan: reconcileMarketDataDemands({
        demands: [demand],
        observed_at: observedAt,
        max_symbols: 20,
      }),
      coverage_audit: buildOhlcvCoverageAuditFixture({
        symbol: "BTCUSDT",
        timeframe: "4h",
        start_open_time: openTime,
        end_open_time: openTime,
      }, observedAt, true),
      candle_slice: {
        schema_version: "market-data.candle-slice-export.v1",
        slice_ref: `market-data://candle-slice/${sliceHash}`,
        manifest_path:
          `data/artifacts/market-data/candle-slices/${sliceHash}/manifest.json`,
        content_sha256: sliceHash,
        rows: 1,
        first_open_ts: openTime,
        last_open_ts: openTime,
      },
      created_at: observedAt,
    })
    const first = materializeForwardDatasetCandidate({
      repository_root: root,
      program,
      segments: [segment],
      created_at: observedAt,
    })
    const second = materializeForwardDatasetCandidate({
      repository_root: root,
      program,
      segments: [segment],
      created_at: observedAt,
    })
    expect(first.artifact_status).toBe("created")
    expect(second.artifact_status).toBe("existing")
    expect(first.candidate).toEqual(second.candidate)
    expect(first.candidate.window.row_count).toBe(1)
    expect(first.candidate.authority.forward_replay_admission_authority)
      .toBe("none")
    expect(createHash("sha256").update(readFileSync(
      join(root, first.candidate.bars_artifact_ref),
    )).digest("hex")).toBe(first.candidate.bars_artifact_sha256)
    expect(first.bars[0]).toEqual({
      open_time: "2026-07-23T04:00:00.000Z",
      close_time: "2026-07-23T08:00:00.000Z",
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
      closed: true,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixtureProgram() {
  return createForwardObservationProgram({
    program_id: "forward-program-1",
    source_admission_id: "forward-source-1",
    source_binding_hash: HASH,
    experiment_id: "experiment-1",
    decision_id: "decision-1",
    draft_id: "draft-1",
    strategy_id: "S-1",
    strategy_version: "draft-1",
    strategy_policy_hash: HASH,
    selected_trial_id: "trial-1",
    historical_replay_request_registration_id: "registration-1",
    historical_replay_request_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    frozen_at: "2026-07-23T01:15:00.000Z",
    market_data_demand_id: "rd-forward:source-1",
    created_at: "2026-07-23T02:00:00.000Z",
  })
}
