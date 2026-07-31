import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assertProjectRuntimePath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import {
  claimReviewerAgentJob,
  completeReviewerAgentJob,
  reconcileCompletedReplayReviewerJobs,
  recordReviewerAgentJobFailure,
  retryReviewerAgentJobWithNewRun,
  type ReviewerAgentJobLease,
} from "../../../state-store/src/lib/reviewer-agent-job-queue"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import type { AgentArtifactPort } from "./planner-agent-run"
import { runReviewerAgentCycle } from "./reviewer-agent-cycle"

export const REVIEWER_AGENT_RESIDENT_CYCLE_SCHEMA =
  "trade.rd-reviewer-agent-resident-cycle.v1" as const

export interface ReviewerAgentResidentCycleInput {
  environment_id: string
  worker_id: string
  source_revision: string
  lease_duration_ms: number
  run_duration_ms: number
  max_attempts: number
  poll_interval_ms: number
}

export interface ReviewerAgentResidentCycleResult {
  schema_version: typeof REVIEWER_AGENT_RESIDENT_CYCLE_SCHEMA
  status: "idle" | "completed" | "retrying" | "dead_letter"
  job_id: string | null
  lease_generation: number | null
  reviewer_run_id: string | null
  result_id: string | null
  decision: string | null
  failure_class: string | null
  registry_authority: "review_decision_only" | "none"
  deployment_authority: "none"
  trading_authority: false
}

interface Dependencies {
  now(): Date
  run_cycle: typeof runReviewerAgentCycle
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  now: () => new Date(),
  run_cycle: runReviewerAgentCycle,
}

export async function runReviewerAgentResidentCycle(input: {
  db_path: string
  config: ReviewerAgentResidentCycleInput
  host: AgentHostPort
  artifacts: AgentArtifactPort
  signal?: AbortSignal
  dependencies?: Dependencies
}): Promise<ReviewerAgentResidentCycleResult> {
  assertProjectRuntimePath(input.db_path)
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES
  const environmentId = identifier(input.config.environment_id, "environment_id")
  const workerId = identifier(input.config.worker_id, "worker_id")
  const sourceRevision = revision(input.config.source_revision)
  const db = new Database(resolveRepoPath(input.db_path))
  let lease: ReviewerAgentJobLease | null = null
  try {
    db.exec("PRAGMA busy_timeout=5000")
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(environmentId, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    const claimedAt = canonicalTime(dependencies.now())
    reconcileCompletedReplayReviewerJobs(db, claimedAt)
    lease = claimReviewerAgentJob(db, {
      worker_id: workerId,
      claimed_at: claimedAt,
      lease_duration_ms: input.config.lease_duration_ms,
      run_duration_ms: input.config.run_duration_ms,
      max_attempts: input.config.max_attempts,
    })
    if (!lease) return idle()
    const prior = priorReview(db, lease.result_id)
    if (prior) {
      completeReviewerAgentJob(db, {
        job_id: lease.job_id,
        worker_id: workerId,
        lease_generation: lease.lease_generation,
        completed_at: canonicalTime(dependencies.now()),
        completion: completion(prior, "recovered_existing_decision"),
      })
      return completed(lease, prior)
    }
    const reviewerRunId = runId(lease)
    const cycle = await dependencies.run_cycle({
      db,
      host: input.host,
      artifacts: input.artifacts,
      reviewer_run_id: reviewerRunId,
      trace_id: `trace:${reviewerRunId}`,
      idempotency_key: `reviewer-run:${reviewerRunId}`,
      source_revision: sourceRevision,
      requested_at: lease.run_requested_at,
      deadline_at: lease.run_deadline_at,
      experiment_id: lease.experiment_id,
      stage_id: lease.stage_id,
      result_ids: [lease.result_id],
      poll_interval_ms: input.config.poll_interval_ms,
      signal: input.signal,
    })
    const decision = {
      decision_id: decisionId(db, cycle.submission.reviewer_run_id),
      reviewer_run_id: cycle.submission.reviewer_run_id,
      decision: cycle.submission.decision,
    }
    completeReviewerAgentJob(db, {
      job_id: lease.job_id,
      worker_id: workerId,
      lease_generation: lease.lease_generation,
      completed_at: canonicalTime(dependencies.now()),
      completion: completion(decision, "agent_admitted"),
    })
    return completed(lease, decision)
  } catch (error) {
    if (!lease) throw error
    const message = error instanceof Error ? error.message : String(error)
    const observedAt = canonicalTime(dependencies.now())
    const category = failureCategory(message)
    try {
      if (category === "permanent") {
        recordReviewerAgentJobFailure(db, {
          job_id: lease.job_id,
          worker_id: workerId,
          lease_generation: lease.lease_generation,
          observed_at: observedAt,
          failure_class: "owner_contract_drift",
          error: message,
          permanent: true,
        })
      } else if (category === "new_run") {
        retryReviewerAgentJobWithNewRun(db, {
          job_id: lease.job_id,
          worker_id: workerId,
          lease_generation: lease.lease_generation,
          observed_at: observedAt,
          failure_class: "agent_output_rejected",
          error: message,
        })
      } else {
        recordReviewerAgentJobFailure(db, {
          job_id: lease.job_id,
          worker_id: workerId,
          lease_generation: lease.lease_generation,
          observed_at: observedAt,
          failure_class: "agent_host_unavailable",
          error: message,
          permanent: false,
        })
      }
    } catch (stateError) {
      if (!/lease expired/i.test(
        stateError instanceof Error ? stateError.message : String(stateError),
      )) throw stateError
    }
    return {
      schema_version: REVIEWER_AGENT_RESIDENT_CYCLE_SCHEMA,
      status: category === "permanent" ? "dead_letter" : "retrying",
      job_id: lease.job_id,
      lease_generation: lease.lease_generation,
      reviewer_run_id: runId(lease),
      result_id: lease.result_id,
      decision: null,
      failure_class: category === "permanent"
        ? "owner_contract_drift"
        : category === "new_run"
          ? "agent_output_rejected"
          : "agent_host_unavailable",
      registry_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    }
  } finally {
    db.close()
  }
}

function priorReview(db: Database, resultId: string): {
  decision_id: string
  reviewer_run_id: string
  decision: string
} | null {
  return db.query(`
    SELECT decision.decision_id, decision.reviewer_run_id, decision.decision
    FROM rd_review_decision_result AS binding
    JOIN rd_review_decision AS decision
      ON decision.decision_id=binding.decision_id
    WHERE binding.result_id=$result_id
    ORDER BY decision.created_at, decision.decision_id
    LIMIT 1
  `).get({ $result_id: resultId }) as {
    decision_id: string
    reviewer_run_id: string
    decision: string
  } | null
}

function decisionId(db: Database, reviewerRunId: string): string {
  const row = db.query(`
    SELECT decision_id FROM rd_review_decision
    WHERE reviewer_run_id=$reviewer_run_id
  `).get({ $reviewer_run_id: reviewerRunId }) as { decision_id: string } | null
  if (!row) throw new Error("admitted Reviewer decision disappeared")
  return row.decision_id
}

function runId(lease: ReviewerAgentJobLease): string {
  const suffix = createHash("sha256")
    .update(`${lease.job_id}:${lease.lease_generation}`)
    .digest("hex")
    .slice(0, 32)
  return `reviewer:${suffix}`
}

function completion(
  decision: { decision_id: string; reviewer_run_id: string; decision: string },
  disposition: string,
): JSONRecord {
  return {
    schema_version: "trade.rd-reviewer-agent-job-completion.v1",
    disposition,
    decision_id: decision.decision_id,
    reviewer_run_id: decision.reviewer_run_id,
    decision: decision.decision,
    registry_authority: decision.decision === "accept_for_draft"
      ? "review_decision_only"
      : "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function completed(
  lease: ReviewerAgentJobLease,
  decision: { reviewer_run_id: string; decision: string },
): ReviewerAgentResidentCycleResult {
  return {
    schema_version: REVIEWER_AGENT_RESIDENT_CYCLE_SCHEMA,
    status: "completed",
    job_id: lease.job_id,
    lease_generation: lease.lease_generation,
    reviewer_run_id: decision.reviewer_run_id,
    result_id: lease.result_id,
    decision: decision.decision,
    failure_class: null,
    registry_authority: decision.decision === "accept_for_draft"
      ? "review_decision_only"
      : "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function idle(): ReviewerAgentResidentCycleResult {
  return {
    schema_version: REVIEWER_AGENT_RESIDENT_CYCLE_SCHEMA,
    status: "idle",
    job_id: null,
    lease_generation: null,
    reviewer_run_id: null,
    result_id: null,
    decision: null,
    failure_class: null,
    registry_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function failureCategory(message: string): "resume" | "new_run" | "permanent" {
  if (/(?:experiment does not exist|result does not belong|stage drifted|no allowed lifecycle decision|lacks authoritative evidence classification|identity drifted|source revision drifted|schema drifted)/i.test(message)) {
    return "permanent"
  }
  if (/(?:submission|output artifact|must complete|completed Agent Run|context pack|cited evidence|requires mechanical|canonical|unsupported)/i.test(message)) {
    return "new_run"
  }
  return "resume"
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function revision(value: unknown): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) {
    throw new Error("source_revision is invalid")
  }
  return value
}

function canonicalTime(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error("Reviewer Agent resident clock is invalid")
  return value.toISOString()
}
