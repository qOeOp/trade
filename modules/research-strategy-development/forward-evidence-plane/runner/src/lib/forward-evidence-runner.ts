import {
  FORWARD_RESULT_SCHEMA_VERSION,
  assertForwardAdmissionRequest,
  type ForwardAdmissionRequest,
  type ForwardEvidenceResult,
} from "../../../contracts/src/lib/forward-evidence-contracts"
import type { ReplayDatasetManifest, ReplayFundingEvent, ReplayMarketBar } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { runReplayTrial } from "../../../../replay-execution-plane/runner/src/lib/replay-trial-runner"

export interface ForwardEvidenceRunInput {
  admission: ForwardAdmissionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  artifact_root?: string
  cancel_requested?: boolean
}

export function runForwardEvidenceSession(input: ForwardEvidenceRunInput): ForwardEvidenceResult {
  const { admission } = input
  const base = (): Omit<ForwardEvidenceResult, "status" | "observed_bar_count" | "limitations"> => ({
    schema_version: FORWARD_RESULT_SCHEMA_VERSION,
    session_id: admission.session_id,
    frozen_at: admission.frozen_at,
    data_watermark: admission.data_watermark,
    evidence_fingerprint: {
      strategy_policy_hash: admission.draft.strategy_policy_hash,
      candidate_hash: admission.draft.authorization.identity.candidate_hash,
      experiment_contract_hash: admission.draft.authorization.identity.experiment_contract_hash,
      frozen_at: admission.frozen_at,
      data_watermark: admission.data_watermark,
      forward_dataset_hash: admission.forward_dataset_hash,
      simulator_policy_version: admission.replay_request.simulator_policy.version,
    },
  })
  try {
    assertForwardAdmissionRequest(admission)
    validateForwardBars(input.bars, admission.frozen_at, admission.data_watermark)
    if (input.bars.length === 0
        || !input.bars.some((bar) => Date.parse(bar.open_time) >= Date.parse(admission.replay_request.order.earliest_executable_time))) {
      return {
        ...base(),
        status: "insufficient_data",
        observed_bar_count: input.bars.length,
        limitations: [{ code: "forward-window-not-executable", detail: "No post-freeze closed bar is yet executable for the frozen signal." }],
      }
    }
    const outcome = runReplayTrial({
      request: admission.replay_request,
      dataset_manifest: input.dataset_manifest,
      bars: input.bars,
      funding_events: input.funding_events,
      artifact_root: input.artifact_root,
      cancel_requested: input.cancel_requested,
    })
    if (outcome.status !== "completed" || !outcome.result) {
      return {
        ...base(),
        status: outcome.status,
        observed_bar_count: input.bars.length,
        limitations: [{ code: outcome.failure?.code || "forward-replay-failed", detail: outcome.failure?.message || "Forward Replay did not complete." }],
      }
    }
    return {
      ...base(),
      status: "completed",
      observed_bar_count: input.bars.length,
      replay_result: outcome.result,
      evidence_fingerprint: {
        ...base().evidence_fingerprint,
        replay_result_hash: outcome.result.fingerprint.result_hash,
      },
      limitations: [
        { code: "rd-forward-evidence-only", detail: "This result is post-freeze paper evidence, not formal Shadow or account execution evidence." },
      ],
    }
  } catch (error) {
    return {
      ...base(),
      status: "failed",
      observed_bar_count: input.bars.length,
      limitations: [{ code: "forward-admission-failed", detail: error instanceof Error ? error.message : String(error) }],
    }
  }
}

function validateForwardBars(bars: ReplayMarketBar[], frozenAt: string, watermark: string): void {
  const freeze = Date.parse(frozenAt)
  const highWatermark = Date.parse(watermark)
  for (const bar of bars) {
    if (Date.parse(bar.open_time) <= freeze || Date.parse(bar.close_time) <= freeze) {
      throw new Error("Forward session rejects pre-freeze or boundary-overlapping bars")
    }
    if (Date.parse(bar.close_time) > highWatermark) throw new Error("Forward session received data beyond its declared watermark")
  }
}
