import type { Database } from "bun:sqlite"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertCertifiedStrategySourceBinding,
  type CertifiedStrategySourceBinding,
} from "../../../contracts/src/lib/certified-strategy-source-binding"
import { applySystemTransition } from "./research-control-plane-operations"

export function ensureForwardSourceAdmissionSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_forward_source_admission (
      admission_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL UNIQUE,
      decision_id TEXT NOT NULL UNIQUE,
      draft_id TEXT NOT NULL UNIQUE,
      binding_hash TEXT NOT NULL UNIQUE,
      binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
      admitted_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id)
        REFERENCES rd_experiment_contract(experiment_id),
      FOREIGN KEY (decision_id)
        REFERENCES rd_review_decision(decision_id),
      FOREIGN KEY (draft_id)
        REFERENCES rd_strategy_draft(draft_id)
    );
    CREATE TRIGGER IF NOT EXISTS rd_forward_source_admission_no_update
    BEFORE UPDATE ON rd_forward_source_admission
    BEGIN
      SELECT RAISE(ABORT, 'Forward source admission is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS rd_forward_source_admission_no_delete
    BEFORE DELETE ON rd_forward_source_admission
    BEGIN
      SELECT RAISE(ABORT, 'Forward source admission is durable');
    END;
  `)
}

export function admitCertifiedStrategySourceForForward(
  db: Database,
  input: {
    binding: CertifiedStrategySourceBinding
    admitted_at: string
  },
): CertifiedStrategySourceBinding {
  assertCertifiedStrategySourceBinding(input.binding)
  const admittedAt = utc(input.admitted_at, "admitted_at")
  ensureForwardSourceAdmissionSchema(db)
  const existing = readForwardSourceAdmission(
    db,
    input.binding.admission_id,
  )
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(input.binding)) {
      throw new Error("Forward source admission identity drifted")
    }
    return existing
  }
  const binding = structuredClone(input.binding)
  db.transaction(() => {
    const experiment = db.query(`
      SELECT lifecycle_state, lifecycle_version
      FROM rd_experiment_contract
      WHERE experiment_id=$experiment_id
    `).get({
      $experiment_id: binding.experiment_id,
    }) as {
      lifecycle_state: string
      lifecycle_version: number
    } | null
    if (!experiment || experiment.lifecycle_state !== "draft_frozen") {
      throw new Error(
        "certified Strategy source requires a draft_frozen experiment",
      )
    }
    const registry = db.query(`
      SELECT job.status, job.draft_id, job.strategy_ref,
             job.strategy_policy_hash, job.candidate_manifest_ref,
             job.candidate_manifest_hash, decision.experiment_id,
             decision.decision
      FROM rd_strategy_registry_job AS job
      JOIN rd_review_decision AS decision
        ON decision.decision_id=job.decision_id
      WHERE job.decision_id=$decision_id
    `).get({
      $decision_id: binding.decision_id,
    }) as {
      status: string
      draft_id: string | null
      strategy_ref: string | null
      strategy_policy_hash: string | null
      candidate_manifest_ref: string | null
      candidate_manifest_hash: string | null
      experiment_id: string
      decision: string
    } | null
    if (!registry
        || registry.status !== "completed"
        || registry.decision !== "accept_for_draft"
        || registry.experiment_id !== binding.experiment_id
        || registry.draft_id !== binding.draft_id
        || registry.strategy_policy_hash !== binding.strategy_source_hash
        || registry.candidate_manifest_hash
          !== binding.source_candidate_manifest_hash
        || !refMatches(
          registry.candidate_manifest_ref,
          binding.source_candidate_manifest_ref,
        )
        || !refMatches(
          registry.strategy_ref,
          binding.strategy_source_ref,
        )) {
      throw new Error(
        "Forward source admission drifted from completed Strategy Registry facts",
      )
    }
    const draft = db.query(`
      SELECT strategy_id, strategy_version, strategy_ref,
             strategy_policy_hash, materialization_status
      FROM rd_strategy_draft WHERE draft_id=$draft_id
    `).get({ $draft_id: binding.draft_id }) as {
      strategy_id: string
      strategy_version: string
      strategy_ref: string
      strategy_policy_hash: string
      materialization_status: string
    } | null
    if (!draft
        || draft.materialization_status !== "ready"
        || draft.strategy_id !== binding.strategy_id
        || draft.strategy_version !== binding.strategy_version
        || draft.strategy_policy_hash !== binding.strategy_source_hash
        || !refMatches(draft.strategy_ref, binding.strategy_source_ref)) {
      throw new Error(
        "Forward source admission drifted from materialized Draft facts",
      )
    }
    db.query(`
      INSERT INTO rd_forward_source_admission(
        admission_id, experiment_id, decision_id, draft_id,
        binding_hash, binding_json, admitted_at
      ) VALUES (
        $admission_id, $experiment_id, $decision_id, $draft_id,
        $binding_hash, $binding_json, $admitted_at
      )
    `).run({
      $admission_id: binding.admission_id,
      $experiment_id: binding.experiment_id,
      $decision_id: binding.decision_id,
      $draft_id: binding.draft_id,
      $binding_hash: binding.binding_hash,
      $binding_json: canonicalJson(binding),
      $admitted_at: admittedAt,
    })
    applySystemTransition(db, {
      experiment_id: binding.experiment_id,
      expected_version: experiment.lifecycle_version,
      trigger_type: "system",
      trigger_value: "certified_source_admitted",
      trigger_ref: `forward-source://${binding.binding_hash}`,
      event_id: `lifecycle:${binding.experiment_id}:forward-source:${binding.binding_hash.slice(0, 24)}`,
      idempotency_key:
        `lifecycle:forward-source:${binding.admission_id}`,
      created_at: admittedAt,
    })
  }).immediate()
  return requireForwardSourceAdmission(db, binding.admission_id)
}

export function readForwardSourceAdmission(
  db: Database,
  admissionId: string,
): CertifiedStrategySourceBinding | undefined {
  ensureForwardSourceAdmissionSchema(db)
  const row = db.query(`
    SELECT binding_json FROM rd_forward_source_admission
    WHERE admission_id=$admission_id
  `).get({
    $admission_id: identifier(admissionId, "admission_id"),
  }) as { binding_json: string } | null
  if (!row) return undefined
  const binding = JSON.parse(row.binding_json) as CertifiedStrategySourceBinding
  assertCertifiedStrategySourceBinding(binding)
  return binding
}

function requireForwardSourceAdmission(
  db: Database,
  admissionId: string,
): CertifiedStrategySourceBinding {
  const binding = readForwardSourceAdmission(db, admissionId)
  if (!binding) throw new Error("Forward source admission was not committed")
  return binding
}

function refMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false
  const normalized = actual.replaceAll("\\", "/")
  return normalized === expected || normalized.endsWith(`/${expected}`)
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
