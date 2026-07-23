import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
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
      trial_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      replay_request_json TEXT NOT NULL CHECK(json_valid(replay_request_json))
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
    INSERT INTO rd_replay_request_registration VALUES(
      'registration-1', 'trial-1', $hash, $request
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
