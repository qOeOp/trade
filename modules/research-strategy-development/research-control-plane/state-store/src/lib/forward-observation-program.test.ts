import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  buildOhlcvCoverageAuditFixture,
} from "../../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-test-fixtures"
import {
  reconcileMarketDataDemands,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  buildFundingCoverageAudit,
} from "../../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  buildMarketDataFactRefV2,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import {
  buildFundingReplaySliceRef,
} from "../../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  createForwardObservationCandleSegment,
} from "../../../contracts/src/lib/forward-observation-candle-segment"
import {
  createForwardDatasetCandidate,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-dataset-candidate"
import {
  buildForwardFundingMarketDataDemand,
  createForwardFundingEvidenceBinding,
  forwardFundingCoverageWindow,
} from "../../../../forward-evidence-plane/contracts/src/lib/forward-funding-evidence"
import {
  replayDatasetHash,
  type ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  buildForwardObservationMarketDataDemand,
  createForwardObservationProgram,
} from "../../../contracts/src/lib/forward-observation-program"
import {
  admitForwardObservationProgram,
  listCollectingForwardObservationPrograms,
  readForwardObservationProgram,
  readLatestForwardMarketDataDemandDelivery,
  recordForwardMarketDataDemandDelivery,
} from "./forward-observation-program"
import {
  admitForwardObservationCandleSegment,
  listForwardObservationCandleSegments,
  readLatestForwardObservationCandleSegment,
} from "./forward-observation-candle-segment"
import {
  admitForwardDatasetCandidate,
  readLatestForwardDatasetCandidate,
} from "./forward-dataset-candidate"
import {
  readForwardDatasetReadinessAssessment,
} from "./forward-dataset-readiness-assessment"
import {
  admitForwardFundingEvidenceBinding,
  readForwardFundingEvidenceBinding,
  readLatestForwardFundingDemandDelivery,
  recordForwardFundingDemandDelivery,
} from "./forward-funding-evidence"

const HASH = "a".repeat(64)

test("Forward observation program and renewable owner demand receipts are durable and authority-closed", () => {
  const db = fixtureDb()
  const program = fixtureProgram()
  expect(admitForwardObservationProgram(db, program)).toEqual(program)
  expect(admitForwardObservationProgram(db, program)).toEqual(program)
  expect(readForwardObservationProgram(db, program.program_id))
    .toEqual(program)
  expect(listCollectingForwardObservationPrograms(db)).toEqual([program])

  const demand = buildForwardObservationMarketDataDemand(program, {
    issued_at: "2026-07-23T02:05:30.000Z",
  })
  expect(recordForwardMarketDataDemandDelivery(db, {
    program_id: program.program_id,
    demand,
    owner_commit_status: "created",
    accepted_at: "2026-07-23T02:05:31.000Z",
  })).toBe("created")
  expect(recordForwardMarketDataDemandDelivery(db, {
    program_id: program.program_id,
    demand,
    owner_commit_status: "created",
    accepted_at: "2026-07-23T02:05:31.000Z",
  })).toBe("existing")
  expect(readLatestForwardMarketDataDemandDelivery(
    db,
    program.program_id,
  )?.demand).toEqual(demand)
  expect(() => db.query(`
    UPDATE rd_forward_observation_program SET symbol='ETHUSDT'
  `).run()).toThrow()
  expect(() => db.query(`
    DELETE FROM rd_forward_market_data_demand_delivery
  `).run()).toThrow()
  db.close()
})

test("Forward observation program rejects historical Replay identity drift", () => {
  const db = fixtureDb()
  db.query(`
    UPDATE rd_replay_request_registration
    SET replay_request_json=json_set(
      replay_request_json, '$.symbol', 'ETHUSDT'
    )
  `).run()
  expect(() => admitForwardObservationProgram(db, fixtureProgram()))
    .toThrow("historical Replay lineage")
  expect(Number((db.query(`
    SELECT COUNT(*) AS count FROM rd_forward_observation_program
  `).get() as { count: number }).count)).toBe(0)
  db.close()
})

test("Forward candle segment registry enforces the durable gapless owner-evidence chain", () => {
  const db = fixtureDb()
  const { program, segment } = fixtureSegment(db)
  expect(admitForwardObservationCandleSegment(db, segment))
    .toBe("created")
  expect(admitForwardObservationCandleSegment(db, segment))
    .toBe("existing")
  expect(readLatestForwardObservationCandleSegment(
    db,
    program.program_id,
  )).toEqual(segment)
  expect(listForwardObservationCandleSegments(
    db,
    program.program_id,
  )).toEqual([segment])
  expect(() => db.query(`
    UPDATE rd_forward_observation_candle_segment SET row_count=2
  `).run()).toThrow()
  db.close()
})

test("Forward dataset candidate registry independently binds the complete segment prefix and verified bars", () => {
  const db = fixtureDb()
  const { program, segment, start } = fixtureAdmittedSegment(db)
  const bars: ReplayMarketBar[] = [{
    open_time: new Date(start).toISOString(),
    close_time: new Date(start + 4 * 60 * 60 * 1_000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    closed: true,
  }]
  const datasetHash = replayDatasetHash(bars)
  const candidate = createForwardDatasetCandidate({
    program,
    segments: [segment],
    bars,
    bars_artifact_ref:
      `data/artifacts/research/forward-dataset-candidates/${datasetHash}/dataset.json`,
    bars_artifact_sha256: datasetHash,
    created_at: "2026-07-23T08:01:00.000Z",
  })
  expect(admitForwardDatasetCandidate(db, {
    candidate,
    verified_bars: bars,
  })).toBe("created")
  expect(admitForwardDatasetCandidate(db, {
    candidate,
    verified_bars: bars,
  })).toBe("existing")
  expect(readLatestForwardDatasetCandidate(db, program.program_id))
    .toEqual(candidate)
  const readiness = readForwardDatasetReadinessAssessment(db, {
    candidate_id: candidate.candidate_id,
    assessed_at: "2026-07-23T08:02:00.000Z",
  })
  expect(readiness.status).toBe("blocked_pending_components")
  expect(readiness.blockers).toContain("funding_window_unverified")
  expect(readiness.blockers).not.toContain("mark_window_unverified")
  const fundingWindow = forwardFundingCoverageWindow(candidate)
  const fundingDemand = buildForwardFundingMarketDataDemand(
    program,
    candidate,
    { issued_at: "2026-07-23T08:02:00.000Z" },
  )
  expect(recordForwardFundingDemandDelivery(db, {
    candidate_id: candidate.candidate_id,
    demand: fundingDemand,
    owner_commit_status: "created",
    accepted_at: "2026-07-23T08:02:01.000Z",
  })).toBe("created")
  expect(readLatestForwardFundingDemandDelivery(
    db,
    candidate.candidate_id,
  )?.demand).toEqual(fundingDemand)
  const fundingEvents = [{
    timestamp: candidate.window.data_watermark,
    rate: 0.0001,
    mark_price: 119_000,
  }]
  const fundingAudit = buildFundingCoverageAudit({
    venue: "binance_usdm",
    symbol: program.symbol,
    coverage: {
      start_at: fundingWindow.start_at,
      end_at: fundingWindow.end_at,
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: "funding-archive:BTCUSDT:forward",
      content_hash: "c".repeat(64),
      page_receipts: [{
        page_ordinal: 0,
        requested_start_ms: Date.parse(fundingWindow.start_at),
        requested_end_ms: Date.parse(fundingWindow.end_at) - 1,
        row_count: 1,
        first_event_ms: Date.parse(candidate.window.data_watermark),
        last_event_ms: Date.parse(candidate.window.data_watermark),
        response_hash: "d".repeat(64),
      }],
      event_count: 1,
      events_hash: "e".repeat(64),
      external_authenticity: "not_verified",
    },
    audited_at: "2026-07-23T08:03:00.000Z",
  })
  const fundingFact = buildMarketDataFactRefV2({
    product: "funding_events",
    venue: "binance_usdm",
    symbol: program.symbol,
    requirement: {
      timeframe: null,
      indicator_set_ref: null,
      minimum_depth: null,
    },
    consumer_binding: {
      demand_ids: [fundingDemand.demand_id],
      source_plan_hash: "f".repeat(64),
    },
    source: {
      ref: fundingAudit.source.ref,
      content_hash: fundingAudit.source.events_hash,
    },
    coverage: {
      kind: "half_open",
      start_at: fundingWindow.start_at,
      end_at: fundingWindow.end_at,
      completeness: "complete",
    },
    freshness: {
      kind: "immutable",
      as_of: fundingWindow.end_at,
      observed_at: fundingAudit.audited_at,
      max_freshness_ms: null,
      status: "not_applicable",
    },
  })
  const fundingSlice = buildFundingReplaySliceRef({
    symbol: program.symbol,
    coverage_start: fundingWindow.start_at,
    coverage_end: fundingWindow.end_at,
    source_archive_id: fundingAudit.source.ref,
    coverage_audit_hash: fundingAudit.audit_hash,
    normalized_events_hash: fundingAudit.source.events_hash,
    events: fundingEvents,
  })
  const fundingBinding = createForwardFundingEvidenceBinding({
    program,
    candidate,
    demand: fundingDemand,
    demand_accepted_at: "2026-07-23T08:02:01.000Z",
    owner_commit_status: "created",
    coverage_audit: fundingAudit,
    market_data_fact: fundingFact,
    funding_slice: fundingSlice,
    verified_events: fundingEvents,
    created_at: "2026-07-23T08:04:00.000Z",
  })
  expect(admitForwardFundingEvidenceBinding(db, {
    binding: fundingBinding,
    verified_events: fundingEvents,
  })).toBe("created")
  expect(readForwardFundingEvidenceBinding(
    db,
    candidate.candidate_id,
  )).toEqual(fundingBinding)
  const fundedReadiness = readForwardDatasetReadinessAssessment(db, {
    candidate_id: candidate.candidate_id,
    assessed_at: "2026-07-23T08:05:00.000Z",
  })
  expect(fundedReadiness.schema_version)
    .toBe("trade.rd-forward-dataset-readiness-assessment.v2")
  expect(fundedReadiness.blockers)
    .not.toContain("funding_window_unverified")
  expect(fundedReadiness.blockers)
    .toContain("instrument_spec_window_unverified")
  expect(() => db.query(`
    DELETE FROM rd_forward_funding_evidence_binding
  `).run()).toThrow()
  expect(() => admitForwardDatasetCandidate(db, {
    candidate: {
      ...candidate,
      candidate_id: "forward-dataset:drift",
    },
    verified_bars: bars,
  })).toThrow()
  expect(() => db.query(`
    DELETE FROM rd_forward_dataset_candidate
  `).run()).toThrow()
  db.close()
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

function fixtureAdmittedSegment(db: Database) {
  const fixture = fixtureSegment(db)
  admitForwardObservationCandleSegment(db, fixture.segment)
  return fixture
}

function fixtureSegment(db: Database) {
  const program = admitForwardObservationProgram(db, fixtureProgram())
  const demand = buildForwardObservationMarketDataDemand(program, {
    issued_at: "2026-07-23T03:00:00.000Z",
  })
  const acceptedAt = "2026-07-23T03:00:01.000Z"
  recordForwardMarketDataDemandDelivery(db, {
    program_id: program.program_id,
    demand,
    owner_commit_status: "created",
    accepted_at: acceptedAt,
  })
  const start = Date.parse(program.first_observation_open_time)
  const observedAt = "2026-07-23T08:01:00.000Z"
  const segment = createForwardObservationCandleSegment({
    program,
    previous_segment: null,
    demand,
    demand_accepted_at: acceptedAt,
    subscription_plan: reconcileMarketDataDemands({
      demands: [demand],
      observed_at: observedAt,
      max_symbols: 20,
    }),
    coverage_audit: buildOhlcvCoverageAuditFixture({
      symbol: program.symbol,
      timeframe: program.timeframe,
      start_open_time: start,
      end_open_time: start,
    }, observedAt, true),
    candle_slice: fixtureSlice(start),
    created_at: observedAt,
  })
  return { program, segment, start }
}

function fixtureSlice(openTime: number) {
  const hash = "b".repeat(64)
  return {
    schema_version: "market-data.candle-slice-export.v1" as const,
    slice_ref: `market-data://candle-slice/${hash}`,
    manifest_path:
      `data/artifacts/market-data/candle-slices/${hash}/manifest.json`,
    content_sha256: hash,
    rows: 1,
    first_open_ts: openTime,
    last_open_ts: openTime,
  }
}

function fixtureDb(): Database {
  const db = new Database(":memory:")
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      lifecycle_state TEXT NOT NULL
    );
    CREATE TABLE rd_strategy_draft(
      draft_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_policy_hash TEXT NOT NULL,
      materialization_status TEXT NOT NULL,
      authorization_json TEXT NOT NULL CHECK(json_valid(authorization_json))
    );
    CREATE TABLE rd_replay_request_registration(
      registration_id TEXT PRIMARY KEY,
      reservation_admission_id TEXT NOT NULL,
      trial_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      replay_request_json TEXT NOT NULL CHECK(json_valid(replay_request_json)),
      dataset_manifest_hash TEXT NOT NULL
    );
    CREATE TABLE rd_replay_trial_reservation_admission(
      admission_id TEXT PRIMARY KEY,
      dataset_manifest_json TEXT NOT NULL
        CHECK(json_valid(dataset_manifest_json))
    );
    CREATE TABLE rd_forward_source_admission(
      admission_id TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL,
      binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
      admitted_at TEXT NOT NULL
    );
  `)
  db.query(`
    INSERT INTO rd_experiment_contract VALUES(
      'experiment-1', 'forward_observation'
    )
  `).run()
  db.query(`
    INSERT INTO rd_strategy_draft VALUES(
      'draft-1', 'S-1', 'draft-1', $hash, 'ready', $authorization
    )
  `).run({
    $hash: HASH,
    $authorization: JSON.stringify({
      decision_id: "decision-1",
      selected_trial_id: "trial-1",
      candidate_frozen_at: "2026-07-23T01:15:00.000Z",
      identity: {
        experiment_id: "experiment-1",
        candidate_id: "candidate-1",
        candidate_hash: HASH,
      },
    }),
  })
  db.query(`
    INSERT INTO rd_replay_trial_reservation_admission VALUES(
      'reservation-admission-1', $manifest
    )
  `).run({
    $manifest: JSON.stringify({
      symbol: "BTCUSDT",
      timeframe: "4h",
      mark_coverage: "none",
    }),
  })
  db.query(`
    INSERT INTO rd_replay_request_registration VALUES(
      'registration-1', 'reservation-admission-1',
      'trial-1', $hash, $request, $hash
    )
  `).run({
    $hash: HASH,
    $request: JSON.stringify({
      experiment_id: "experiment-1",
      trial_id: "trial-1",
      candidate_id: "candidate-1",
      candidate_hash: HASH,
      symbol: "BTCUSDT",
      timeframe: "4h",
      supplemental_requirement_set: {
        mode: "none",
      },
    }),
  })
  db.query(`
    INSERT INTO rd_forward_source_admission VALUES(
      'forward-source-1', $hash, $binding, '2026-07-23T01:30:00.000Z'
    )
  `).run({
    $hash: HASH,
    $binding: JSON.stringify({
      experiment_id: "experiment-1",
      decision_id: "decision-1",
      draft_id: "draft-1",
      strategy_id: "S-1",
      strategy_version: "draft-1",
      strategy_source_hash: HASH,
    }),
  })
  return db
}
