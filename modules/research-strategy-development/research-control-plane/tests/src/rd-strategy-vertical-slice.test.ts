import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION } from "../../contracts/src/lib/control-plane-contracts"
import type { ResearchIdentityBinding } from "../../contracts/src/lib/control-plane-contracts"
import { REPLAY_DATASET_MANIFEST_SCHEMA_VERSION, REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, REPLAY_SIMULATOR_POLICY_VERSION, replayDatasetHash, type ReplayDatasetManifest, type ReplayMarketBar } from "../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { buildDeveloperReplayRequest } from "../../../agent-roles/developer/src/lib/developer-role"
import { runReplayTrial } from "../../../replay-execution-plane/runner/src/lib/replay-trial-runner"
import { buildDraftAuthorization } from "../../../agent-roles/reviewer/src/lib/reviewer-role"
import { materializeDraftStrategy } from "../../strategy-registry/src/lib/strategy-registry"
import { SOURCE_SCHEMA_VERSION } from "../../strategy-policy-writer/src/lib/strategy-policy-writer"
import { runForwardEvidenceSession } from "../../../forward-evidence-plane/runner/src/lib/forward-evidence-runner"
import { FORWARD_ADMISSION_SCHEMA_VERSION as FORWARD_SCHEMA_VERSION } from "../../../forward-evidence-plane/contracts/src/lib/forward-evidence-contracts"

const HASH = "2".repeat(64)

test("Contract to Replay to Review to landed Draft to Forward is auditable", () => {
  const historicalBars: ReplayMarketBar[] = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const historicalDataHash = replayDatasetHash(historicalBars)
  const identity: ResearchIdentityBinding = {
    schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
    trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH,
    identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH,
  }
  const historicalRequest = buildDeveloperReplayRequest({
    run_id: "historical-run-1", idempotency_key: "historical-key-1", identity,
    dataset_manifest_ref: "dataset://historical", dataset_hash: historicalDataHash, harness_hash: HASH, assumptions_hash: HASH,
    symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" }, random_seed: 1,
  })
  const replay = runReplayTrial({
    request: historicalRequest,
    dataset_manifest: manifest("historical", historicalBars, historicalDataHash, "2026-07-13T00:00:00Z"),
    bars: historicalBars,
  })
  expect(replay.status).toBe("completed")
  if (!replay.result) throw new Error("fixture Replay did not produce a Result")
  const authorization = buildDraftAuthorization({
    decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1",
    selected_trial_id: identity.trial_id, selected_candidate_id: identity.candidate_id,
    candidate_frozen_at: "2026-07-14T08:00:00Z", explicit_decision: "accept_for_draft", identity, result: replay.result,
  })
  const db = new Database(":memory:")
  const strategyRoot = mkdtempSync(join(tmpdir(), "rd-vertical-strategies-"))
  const draft = materializeDraftStrategy(db, {
    draft_id: "draft-1", strategy_version: "1", idempotency_key: "draft-key-1",
    strategy_root: strategyRoot, created_at: "2026-07-14T08:00:00Z", authorization,
    policy_source: {
      schema_version: SOURCE_SCHEMA_VERSION, program_id: "program-1", objective: "Test a frozen closed-candle candidate.", drafted_at: "2026-07-14T08:00:00Z",
      evidence_refs: ["result://result-1"], candidate: { candidate_id: identity.candidate_id, family: "trend_pullback_v1", timeframe: "4h", validation_run_ref: "result://result-1", params: { side: "long", stop_atr: 1, reward_risk: 2 } },
    },
  })
  expect(existsSync(draft.strategy_ref)).toBe(true)

  const forwardBars: ReplayMarketBar[] = [{ open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const forwardDataHash = replayDatasetHash(forwardBars)
  const forwardRequest = {
    ...historicalRequest,
    run_id: "forward-run-1", idempotency_key: "forward-replay-key-1",
    dataset_manifest_ref: "dataset://forward", dataset_hash: forwardDataHash, strategy_policy_hash: draft.strategy_policy_hash,
    order: { ...historicalRequest.order, signal_time: "2026-07-14T12:00:00Z", earliest_executable_time: "2026-07-14T16:00:00Z" },
  }
  const forward = runForwardEvidenceSession({
    admission: {
      schema_version: FORWARD_SCHEMA_VERSION, session_id: "forward-session-1", idempotency_key: "forward-key-1", forward_reservation_id: "forward-reservation-1",
      frozen_at: "2026-07-14T08:00:00Z", data_watermark: "2026-07-14T20:00:00Z", forward_dataset_hash: forwardDataHash, draft, replay_request: forwardRequest,
    },
    dataset_manifest: manifest("forward", forwardBars, forwardDataHash, "2026-07-14T08:00:00Z"),
    bars: forwardBars,
  })
  expect(forward.status).toBe("completed")
  expect(forward.evidence_fingerprint.strategy_policy_hash).toBe(draft.strategy_policy_hash)
  expect(forward).not.toHaveProperty("shadow_candidate")
  db.close()
})

function manifest(id: string, bars: ReplayMarketBar[], dataHash: string, selectedAt: string): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: `manifest-${id}`, manifest_ref: `dataset://${id}`, data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time",
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative", base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" },
    },
    universe: { selected_at: selectedAt, survivorship: "point_in_time" },
  }
}
