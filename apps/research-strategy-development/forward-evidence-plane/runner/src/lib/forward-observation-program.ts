import type { Database } from "bun:sqlite"
import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  createForwardObservationProgram,
  type ForwardObservationProgram,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import {
  listForwardSourceAdmissions,
} from "../../../../research-control-plane/state-store/src/lib/forward-source-admission"
import {
  admitForwardObservationProgram,
  readForwardObservationProgram,
} from "../../../../research-control-plane/state-store/src/lib/forward-observation-program"
import {
  readRegisteredReplayExecutionRequest,
} from "../../../../research-control-plane/state-store/src/lib/replay-request-registration"
import {
  readReadyDraftStrategy,
} from "../../../../research-control-plane/strategy-registry/src/lib/strategy-registry"

export function reconcileForwardObservationPrograms(
  db: Database,
  input: { observed_at: string; limit?: number },
): {
  created: ForwardObservationProgram[]
  existing: ForwardObservationProgram[]
  failures: Array<{
    source_admission_id: string
    failure_code: string
  }>
} {
  utc(input.observed_at, "observed_at")
  const created: ForwardObservationProgram[] = []
  const existing: ForwardObservationProgram[] = []
  const failures: Array<{
    source_admission_id: string
    failure_code: string
  }> = []
  for (const binding of listForwardSourceAdmissions(
    db,
    input.limit ?? 1_000,
  )) {
    const programId = `forward-program:${binding.binding_hash.slice(0, 48)}`
    const prior = readForwardObservationProgram(db, programId)
    if (prior) {
      existing.push(prior)
      continue
    }
    try {
      const source = db.query(`
        SELECT admitted_at FROM rd_forward_source_admission
        WHERE admission_id=$admission_id
      `).get({
        $admission_id: binding.admission_id,
      }) as { admitted_at: string } | null
      if (!source
          || Date.parse(input.observed_at)
            < Date.parse(utc(source.admitted_at, "admitted_at"))) {
        throw new Error("Forward program source admission time drifted")
      }
      const draft = readReadyDraftStrategy(db, binding.draft_id)
      if (!draft
          || draft.authorization.identity.experiment_id
            !== binding.experiment_id
          || draft.authorization.decision_id !== binding.decision_id
          || draft.strategy_policy_hash !== binding.strategy_source_hash) {
        throw new Error("Forward program Draft lineage drifted")
      }
      const rows = db.query(`
        SELECT registration_id, request_hash
        FROM rd_replay_request_registration
        WHERE trial_id=$trial_id
        ORDER BY registration_id COLLATE BINARY
      `).all({
        $trial_id: draft.authorization.selected_trial_id,
      }) as Array<{ registration_id: string; request_hash: string }>
      if (rows.length !== 1) {
        throw new Error(
          "Forward program requires exactly one historical Replay registration",
        )
      }
      const row = rows[0]!
      const request = readRegisteredReplayExecutionRequest(
        db,
        row.registration_id,
      )
      if (canonicalHash(request) !== row.request_hash
          || request.experiment_id !== binding.experiment_id
          || request.trial_id !== draft.authorization.selected_trial_id
          || request.candidate_id
            !== draft.authorization.identity.candidate_id
          || request.candidate_hash
            !== draft.authorization.identity.candidate_hash) {
        throw new Error("Forward program historical Replay identity drifted")
      }
      const program = createForwardObservationProgram({
        program_id: programId,
        source_admission_id: binding.admission_id,
        source_binding_hash: binding.binding_hash,
        experiment_id: binding.experiment_id,
        decision_id: binding.decision_id,
        draft_id: binding.draft_id,
        strategy_id: binding.strategy_id,
        strategy_version: binding.strategy_version,
        strategy_policy_hash: binding.strategy_source_hash,
        selected_trial_id: request.trial_id,
        historical_replay_request_registration_id: row.registration_id,
        historical_replay_request_hash: row.request_hash,
        symbol: request.symbol,
        timeframe: request.timeframe,
        frozen_at: draft.authorization.candidate_frozen_at,
        market_data_demand_id:
          `rd-forward:${binding.binding_hash.slice(0, 48)}`,
        created_at: source.admitted_at,
      })
      created.push(admitForwardObservationProgram(db, program))
    } catch (error) {
      failures.push({
        source_admission_id: binding.admission_id,
        failure_code: classifyForwardProgramFailure(error),
      })
    }
  }
  return { created, existing, failures }
}

function classifyForwardProgramFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("source admission time")) {
    return "source_admission_time_drift"
  }
  if (message.includes("Draft")) return "draft_lineage_drift"
  if (message.includes("exactly one historical Replay")) {
    return "historical_replay_registration_ambiguous"
  }
  if (message.includes("historical Replay")) {
    return "historical_replay_lineage_drift"
  }
  if (message.includes("non-canonical") || message.includes("hash")) {
    return "contract_hash_drift"
  }
  return "program_admission_rejected"
}

export function shouldRenewForwardMarketDataDemand(
  latestLeaseExpiresAt: string | undefined,
  observedAt: string,
  renewBeforeMs = 6 * 3_600_000,
): boolean {
  const observed = Date.parse(utc(observedAt, "observed_at"))
  if (latestLeaseExpiresAt == null) return true
  const expiry = Date.parse(utc(
    latestLeaseExpiresAt,
    "latest_lease_expires_at",
  ))
  if (!Number.isSafeInteger(renewBeforeMs)
      || renewBeforeMs < 60_000
      || renewBeforeMs > 29 * 86_400_000) {
    throw new Error("renew_before_ms is invalid")
  }
  return expiry - observed <= renewBeforeMs
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
