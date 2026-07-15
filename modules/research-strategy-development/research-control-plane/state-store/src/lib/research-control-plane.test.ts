import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  RESEARCH_LIFECYCLE_RULE_VERSION,
  validateUniverseSeed,
} from "./research-control-plane-schema"
import {
  applyReviewerDecision,
  appendProposalRevision,
  candidateIdentityHash,
  materializeProposal,
  materializeGeneratedCandidate,
  registerExperiment,
  registerTrialGroup,
  trialGroupIdentityHash,
  transitionTrialGroup,
} from "./research-control-plane"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "./research-contract-validator"
import { hashIdentityPayload } from "./research-identity-hash"
import { buildDefaultUniverseSeed, seedDefaultResearchControlPlane } from "./research-universe-default-seed"
import { ensureResearchStateSchema } from "./research-state-store"
import { issueTrialReservationSnapshot } from "./trial-reservation-snapshot"
import { claimReplayAttempt, finalizeReplayAttempt, renewReplayAttemptLease } from "./replay-attempt-authority"
import {
  appendExperimentResult,
  applySystemTransition,
  assertLifecycleProjection,
  finishTrial,
  openBlockerAndTransition,
  rebuildLifecycleProjection,
  resolveBlockerAndTransition,
  reserveTrial,
} from "./research-control-plane-operations"

const NOW = "2026-07-14T03:20:00Z"
const HASH_POLICY = "trade-flow.identity-hash.v1"

test("control plane schema initializes frozen stages and lifecycle rules", () => {
  const db = openDb()
  try {
    const tables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'rd_%'
    `).all() as Array<{ name: string }>
    const names = new Set(tables.map((row) => row.name))
    for (const required of [
      "rd_universe_node",
      "rd_proposal_revision",
      "rd_trial_group",
      "rd_experiment_contract",
      "rd_trial",
      "rd_replay_attempt",
      "rd_experiment_result",
      "rd_review_decision",
      "rd_lifecycle_event",
      "rd_knowledge_edge_evidence",
    ]) {
      assert.equal(names.has(required), true, `missing ${required}`)
    }
    assert.equal(count(db, "rd_result_stage"), 8)
    assert.equal(count(db, "rd_lifecycle_transition_rule") >= 20, true)
  } finally {
    db.close()
  }
})

test("universe seed validator enforces hierarchy paths and primary axes", () => {
  const db = openDb()
  try {
    seedUniverse(db)
    assert.doesNotThrow(() => validateUniverseSeed(db))
    db.query("UPDATE rd_universe_node SET path='wrong/path' WHERE node_id='canonical-1'").run()
    assert.throws(() => validateUniverseSeed(db), /invalid path/)
  } finally {
    db.close()
  }
})

test("default control-plane seed installs the frozen universe, registries, and mapped coverage", () => {
  const db = openDb()
  try {
    const counts = seedDefaultResearchControlPlane(db, NOW)
    assert.equal(counts.nodes > 80, true)
    assert.equal(counts.data_surfaces, 11)
    assert.equal(counts.capabilities, 7)
    assert.doesNotThrow(() => validateUniverseSeed(db))
    assert.equal(count(db, "rd_universe_data_surface"), 10)
    assert.equal(count(db, "rd_universe_coverage"), 14)
    assert.equal(buildDefaultUniverseSeed(NOW).nodes.filter((node) => node.level === 3).length, 7)
  } finally {
    db.close()
  }
})

test("proposal revisions are monotonic, validated, and materialize once", () => {
  const db = openDb()
  try {
    appendProposalRevision(db, proposalRevision({ validation_status: "invalid" }))
    assert.throws(() => materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 1,
      materialization_ref: "family-backlog://item-1",
      materialized_at: NOW,
    }), /only a valid proposal revision/)

    appendProposalRevision(db, proposalRevision({ revision: 2, validation_status: "valid" }))
    assert.throws(
      () => appendProposalRevision(db, proposalRevision({ revision: 4, validation_status: "valid" })),
      /revision must be 3/,
    )
    materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 2,
      materialization_ref: "experiment://experiment-1",
      materialized_at: NOW,
    })
    assert.throws(() => materializeProposal(db, {
      proposal_id: "proposal-1",
      revision: 2,
      materialization_ref: "experiment://experiment-2",
      materialized_at: NOW,
    }), /already materialized/)
    assert.throws(
      () => db.query("UPDATE rd_proposal_revision SET validation_ref='changed' WHERE proposal_id='proposal-1'").run(),
      /append-only/,
    )
  } finally {
    db.close()
  }
})

test("trial groups freeze search identity and reject post-hoc candidates", () => {
  const db = openDb()
  try {
    registerTrialGroup(db, trialGroup())
    assert.throws(
      () => db.query("UPDATE rd_trial_group SET max_trials=99 WHERE trial_group_id='group-1'").run(),
      /definition is immutable/,
    )
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    assert.throws(() => db.query(`
      INSERT INTO rd_trial_group_candidate(
        trial_group_id, candidate_id, candidate_identity_hash,
        identity_hash_policy_version, parameter_assignment_json,
        candidate_ordinal, created_at
      ) VALUES ('group-1', 'candidate-2', 'candidate-hash-2', $policy, '{}', 2, $now)
    `).run({ $policy: HASH_POLICY, $now: NOW }), /candidate cannot be added/)
  } finally {
    db.close()
  }
})

test("generated candidates can only materialize through the frozen registered generator", () => {
  const db = openDb()
  try {
    const base = {
      trial_group_id: "generated-group", hypothesis_scope_ref: "hypothesis-generated",
      identity_hash_policy_version: HASH_POLICY, candidate_mode: "generated_from_space" as const,
      candidate_generator_ref: "generator://bounded-grid/v1",
      search_space_json: { schema_version: "trade-flow.rd-search-space.v1", lookback: [10, 20] },
      selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "ordered" },
      max_trials: 2, trial_accounting_policy_version: "trial-accounting-v1",
      registered_at: NOW, created_at: NOW, candidates: [],
    }
    registerTrialGroup(db, { ...base, group_hash: trialGroupIdentityHash(base) })
    transitionTrialGroup(db, { trial_group_id: "generated-group", action: "start", occurred_at: NOW })
    const input = {
      trial_group_id: "generated-group", candidate_generator_ref: "generator://bounded-grid/v1",
      identity_hash_policy_version: HASH_POLICY,
      candidate: {
        candidate_id: "generated-1", candidate_identity_hash: candidateIdentityHash({ lookback: 10 }),
        parameter_assignment_json: { lookback: 10 }, candidate_ordinal: 1, created_at: NOW,
      },
    }
    materializeGeneratedCandidate(db, input)
    materializeGeneratedCandidate(db, input)
    assert.equal(count(db, "rd_trial_group_candidate"), 1)
    assert.throws(() => materializeGeneratedCandidate(db, {
      ...input, candidate_generator_ref: "generator://other",
    }), /registered running group generator/)
    transitionTrialGroup(db, { trial_group_id: "generated-group", action: "seal", occurred_at: NOW })
    assert.throws(() => materializeGeneratedCandidate(db, {
      ...input,
      candidate: { ...input.candidate, candidate_id: "generated-2", candidate_ordinal: 2 },
    }), /registered running group generator/)
  } finally {
    db.close()
  }
})

test("experiment facts enforce trial identity, sentinel, freeze, and append-only invariants", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db)
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
    assert.throws(() => insertExperimentResult(db, "result-any", "__any__"), /CHECK constraint/)
    insertExperimentResult(db, "result-1", "historical_validation")
    assert.throws(
      () => db.query("UPDATE rd_experiment_result SET artifact_ref='changed' WHERE result_id='result-1'").run(),
      /append-only/,
    )

    assert.throws(() => applyReviewerDecision(db, reviewerDecision({
      decision_id: "decision-no-primary",
      idempotency_key: "decision-key-no-primary",
      lifecycle_event_id: "event-no-primary",
      lifecycle_idempotency_key: "event-key-no-primary",
      evidence: [{ result_id: "result-1", evidence_role: "supporting" }],
    })), /exactly one primary/)
    assert.equal(count(db, "rd_review_decision"), 0)
    assert.equal(count(db, "rd_lifecycle_event"), 2)

    applyReviewerDecision(db, reviewerDecision())
    const frozen = db.query(`
      SELECT lifecycle_state, lifecycle_version, selected_candidate_id,
             selected_trial_id, candidate_hash
      FROM rd_experiment_contract
      WHERE experiment_id='experiment-1'
    `).get() as Record<string, string | number>
    assert.deepEqual(frozen, {
      lifecycle_state: "draft_frozen",
      lifecycle_version: 3,
      selected_candidate_id: "candidate-1",
      selected_trial_id: "trial-1",
      candidate_hash: candidateIdentityHash({ lookback: 20 }),
    })
    assert.throws(() => db.query(`
      UPDATE rd_experiment_contract
      SET candidate_hash='replacement-hash'
      WHERE experiment_id='experiment-1'
    `).run(), /frozen candidate identity is immutable/)
  } finally {
    db.close()
  }
})

test("Control Plane atomically issues an immutable Replay Trial Reservation snapshot", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-reserved", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }), identity_hash_policy_version: HASH_POLICY,
      run_id: "run-reserved", idempotency_key: "trial-reserved-key", created_at: NOW,
    })
    const snapshot = issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-1", reservation_ref: "reservation://trial-reserved", issued_at: NOW,
      bindings: {
        replay_idempotency_key: "replay-key", execution_spec_hash: "a".repeat(64), dataset_manifest_ref: "dataset://fixture", dataset_hash: "b".repeat(64),
        venue_risk_policy_snapshot_hash: "c".repeat(64), instrument_spec_snapshot_hash: "d".repeat(64), harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64), cost_policy_hash: "1".repeat(64), margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v6", execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    assert.equal(snapshot.status, "reserved")
    assert.equal(snapshot.identity.trial_group_hash, trialGroup().group_hash)
    assert.equal(snapshot.identity.candidate_hash, candidateIdentityHash({ lookback: 20 }))
    assert.equal(snapshot.identity.experiment_contract_hash, hashIdentityPayload(experimentContract()))
    assert.equal(snapshot.counts_against_budget, true)
    finishTrial(db, { trial_id: "trial-reserved", status: "completed", completed_at: NOW })
    assert.throws(() => issueTrialReservationSnapshot(db, {
      trial_id: "trial-reserved", reservation_id: "reservation-2", reservation_ref: "reservation://trial-reserved", issued_at: NOW,
      bindings: snapshot.bindings, required_capabilities: snapshot.required_capabilities,
    }), /no longer reserved/)
  } finally {
    db.close()
  }
})

test("Control Plane fences Replay Attempt leases and permits retry only after a terminal or expired attempt", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
    reserveTrial(db, {
      trial_id: "trial-attempt", trial_group_id: "group-1", experiment_id: "experiment-1", trial_ordinal: 1,
      candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }), identity_hash_policy_version: HASH_POLICY,
      run_id: "run-attempt", idempotency_key: "trial-attempt-key", created_at: NOW,
    })
    const reservation = issueTrialReservationSnapshot(db, {
      trial_id: "trial-attempt", reservation_id: "reservation-attempt", reservation_ref: "reservation://trial-attempt", issued_at: NOW,
      bindings: {
        replay_idempotency_key: "replay-attempt-key", execution_spec_hash: "a".repeat(64), dataset_manifest_ref: "dataset://fixture", dataset_hash: "b".repeat(64),
        venue_risk_policy_snapshot_hash: "c".repeat(64), instrument_spec_snapshot_hash: "d".repeat(64), harness_hash: "e".repeat(64),
        assumptions_hash: "f".repeat(64), cost_policy_hash: "1".repeat(64), margin_policy_hash: "2".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v6", execution_mode: "step",
      },
      required_capabilities: ["closed-candle", "step"],
    })
    const first = claimReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", idempotency_key: "attempt-key-1",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:00:00Z", lease_expires_at: "2026-07-14T04:05:00Z",
      trial_reservation: reservation,
    })
    assert.equal(first.attempt_ordinal, 1)
    assert.equal(first.lease_generation, 1)
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-conflict", worker_id: "worker-2", idempotency_key: "attempt-key-conflict",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:01:00Z", lease_expires_at: "2026-07-14T04:06:00Z",
      trial_reservation: reservation,
    }), /already has active attempt/)
    const renewed = renewReplayAttemptLease(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 1,
      heartbeat_at: "2026-07-14T04:02:00Z", lease_expires_at: "2026-07-14T04:07:00Z",
    })
    assert.equal(renewed.status, "running")
    assert.equal(renewed.lease_generation, 2)
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 1,
      status: "failed", finalized_at: "2026-07-14T04:03:00Z", failure_class: "deterministic_engine",
    }), /fencing token mismatch/)
    finalizeReplayAttempt(db, {
      attempt_id: "attempt-1", worker_id: "worker-1", expected_lease_generation: 2,
      status: "failed", finalized_at: "2026-07-14T04:03:00Z", failure_class: "deterministic_engine",
    })
    const second = claimReplayAttempt(db, {
      attempt_id: "attempt-2", worker_id: "worker-2", idempotency_key: "attempt-key-2",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:04:00Z", lease_expires_at: "2026-07-14T04:06:00Z",
      trial_reservation: reservation,
    })
    assert.equal(second.attempt_ordinal, 2)
    const third = claimReplayAttempt(db, {
      attempt_id: "attempt-3", worker_id: "worker-3", idempotency_key: "attempt-key-3",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:07:00Z", lease_expires_at: "2026-07-14T04:12:00Z",
      trial_reservation: reservation,
    })
    assert.equal(third.attempt_ordinal, 3)
    assert.equal((db.query("SELECT status FROM rd_replay_attempt WHERE attempt_id='attempt-2'").get() as { status: string }).status, "expired")
    assert.throws(() => finalizeReplayAttempt(db, {
      attempt_id: "attempt-2", worker_id: "worker-2", expected_lease_generation: 1,
      status: "cancelled", finalized_at: "2026-07-14T04:05:00Z", failure_class: "resource",
    }), /already terminal/)
    finalizeReplayAttempt(db, {
      attempt_id: "attempt-3", worker_id: "worker-3", expected_lease_generation: 1,
      status: "completed", finalized_at: "2026-07-14T04:10:00Z",
      result_hash: "3".repeat(64), artifact_ref: "artifact://attempt-3", artifact_hash: "4".repeat(64),
      terminal_checkpoint_hash: "5".repeat(64),
    })
    assert.throws(() => claimReplayAttempt(db, {
      attempt_id: "attempt-4", worker_id: "worker-4", idempotency_key: "attempt-key-4",
      request_hash: "9".repeat(64), claimed_at: "2026-07-14T04:11:00Z", lease_expires_at: "2026-07-14T04:16:00Z",
      trial_reservation: reservation,
    }), /already has completed attempt/)
    assert.throws(() => db.query("UPDATE rd_replay_attempt SET artifact_ref='changed' WHERE attempt_id='attempt-3'").run(), /terminal Replay Attempt is immutable/)
  } finally {
    db.close()
  }
})

test("knowledge evidence can only supersede evidence on the same edge", () => {
  const db = openDb()
  try {
    db.exec(`
      INSERT INTO rd_knowledge_node VALUES
        ('kg-1', 'hypothesis', 'h1', 'h1', 'H1', NULL, '${NOW}', '${NOW}'),
        ('kg-2', 'result', 'r1', 'r1', 'R1', NULL, '${NOW}', '${NOW}'),
        ('kg-3', 'result', 'r2', 'r2', 'R2', NULL, '${NOW}', '${NOW}');
      INSERT INTO rd_knowledge_edge VALUES
        ('edge-1', 'kg-2', 'kg-1', 'supports', NULL, '${NOW}'),
        ('edge-2', 'kg-3', 'kg-1', 'refutes', NULL, '${NOW}');
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        idempotency_key, created_at
      ) VALUES ('evidence-1', 'edge-1', 'artifact://r1', 'result', '${NOW}', 'kg-key-1', '${NOW}');
    `)
    assert.throws(() => db.query(`
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        supersedes_edge_evidence_id, supersedes_edge_id, idempotency_key, created_at
      ) VALUES (
        'evidence-2', 'edge-2', 'artifact://r2', 'result', $now,
        'evidence-1', 'edge-1', 'kg-key-2', $now
      )
    `).run({ $now: NOW }), /CHECK constraint/)
  } finally {
    db.close()
  }
})

test("suspend and resume preserve prior state, require a fresh fingerprint, and projection rebuild is deterministic", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db)
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 2,
      trigger_type: "system", trigger_value: "fingerprint_stale",
      trigger_ref: "fingerprint://stale", event_id: "event-suspend",
      idempotency_key: "event-key-suspend", created_at: NOW,
    })
    const suspended = db.query(`
      SELECT lifecycle_state, suspended_from_state FROM rd_experiment_contract
      WHERE experiment_id='experiment-1'
    `).get()
    assert.deepEqual(suspended, { lifecycle_state: "suspended", suspended_from_state: "discovery" })
    assert.throws(() => applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume-bad",
      idempotency_key: "event-key-resume-bad", created_at: NOW,
    }), /fresh evidence fingerprint/)
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume",
      idempotency_key: "event-key-resume", fresh_fingerprint: true, created_at: NOW,
    })
    applySystemTransition(db, {
      experiment_id: "experiment-1", expected_version: 3,
      trigger_type: "system", trigger_value: "resume_discovery",
      trigger_ref: "fingerprint://fresh", event_id: "event-resume",
      idempotency_key: "event-key-resume", fresh_fingerprint: true, created_at: NOW,
    })
    assert.throws(
      () => db.query("UPDATE rd_experiment_contract SET lifecycle_version=99 WHERE experiment_id='experiment-1'").run(),
      /latest authoritative event/,
    )
    db.exec("DROP TRIGGER require_lifecycle_projection_event")
    db.query("UPDATE rd_experiment_contract SET lifecycle_version=99 WHERE experiment_id='experiment-1'").run()
    ensureResearchStateSchema(db)
    assert.throws(() => assertLifecycleProjection(db, "experiment-1"), /does not match/)
    rebuildLifecycleProjection(db, "experiment-1", NOW)
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
  } finally {
    db.close()
  }
})

test("blocker fact and lifecycle projection commit atomically", () => {
  const db = openDb()
  try {
    seedExecutableExperiment(db, false)
    openBlockerAndTransition(db, {
      blocker_id: "blocker-1", experiment_id: "experiment-1", blocker_type: "external_data",
      detail_ref: "data://gap", idempotency_key: "blocker-key-1", created_at: NOW,
      expected_version: 1, lifecycle_event_id: "event-blocked", lifecycle_idempotency_key: "event-key-blocked",
    })
    assert.equal((db.query("SELECT lifecycle_state FROM rd_experiment_contract WHERE experiment_id='experiment-1'").get() as { lifecycle_state: string }).lifecycle_state, "blocked")
    resolveBlockerAndTransition(db, {
      blocker_id: "blocker-1", experiment_id: "experiment-1", close_reason: "resolved", closed_at: NOW,
      expected_version: 2, lifecycle_event_id: "event-unblocked", lifecycle_idempotency_key: "event-key-unblocked",
    })
    assert.equal((db.query("SELECT lifecycle_state FROM rd_experiment_contract WHERE experiment_id='experiment-1'").get() as { lifecycle_state: string }).lifecycle_state, "proposed")
    assert.doesNotThrow(() => assertLifecycleProjection(db, "experiment-1"))
  } finally {
    db.close()
  }
})

function openDb(): Database {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  return db
}

function seedUniverse(db: Database): void {
  const insertNode = db.query(`
    INSERT INTO rd_universe_node(
      node_id, parent_node_id, level, node_type, slug, name, path,
      research_scope_status, implementation_scope_status, created_at, updated_at
    ) VALUES (
      $node_id, $parent_node_id, $level, $node_type, $slug, $name, $path,
      'active', 'ready', $now, $now
    )
  `)
  const rows = [
    ["root", null, 0, "universe", "strategy-universe", "Strategy Universe", "strategy-universe"],
    ["edge-1", "root", 1, "edge", "trend", "Trend", "strategy-universe/trend"],
    ["family-1", "edge-1", 2, "mechanism_family", "time-series-trend", "Time-Series Trend", "strategy-universe/trend/time-series-trend"],
    ["canonical-1", "family-1", 3, "canonical_strategy", "trend-pullback", "Trend Pullback", "strategy-universe/trend/time-series-trend/trend-pullback"],
  ] as const
  for (const [nodeId, parentId, level, type, slug, name, path] of rows) {
    insertNode.run({
      $node_id: nodeId,
      $parent_node_id: parentId,
      $level: level,
      $node_type: type,
      $slug: slug,
      $name: name,
      $path: path,
      $now: NOW,
    })
  }
  const insertAxis = db.query(`
    INSERT INTO rd_universe_node_axis(node_id, axis, is_primary, created_at)
    VALUES ($node_id, 'return_driver', 1, $now)
  `)
  for (const nodeId of ["edge-1", "family-1", "canonical-1"]) {
    insertAxis.run({ $node_id: nodeId, $now: NOW })
  }
}

function seedExecutableExperiment(db: Database, startDiscovery = true): void {
  seedUniverse(db)
  appendProposalRevision(db, proposalRevision({ validation_status: "valid" }))
  registerTrialGroup(db, trialGroup())
  registerExperiment(db, {
    experiment_id: "experiment-1",
    proposal_id: "proposal-1",
    proposal_revision: 1,
    canonical_node_id: "canonical-1",
    hypothesis_id: "hypothesis-1",
    code_family_id: "time_series_momentum_v1",
    trial_group_id: "group-1",
    trial_group_hash: trialGroup().group_hash,
    contract_hash: hashIdentityPayload(experimentContract()),
    identity_hash_policy_version: HASH_POLICY,
    contract_validator_version: RESEARCH_CONTRACT_VALIDATOR_VERSION,
    lifecycle_rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
    scope_policy_version: "scope-v1",
    contract_json: experimentContract(),
    bootstrap_event_id: "event-1",
    bootstrap_idempotency_key: "event-key-1",
    registered_at: NOW,
  })
  if (!startDiscovery) return
  db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id='group-1'").run()
  applySystemTransition(db, {
    experiment_id: "experiment-1", expected_version: 1,
    trigger_type: "system", trigger_value: "pre_run_gate_passed",
    trigger_ref: "system://pre-run-gate", event_id: "event-2",
    idempotency_key: "event-key-2", created_at: NOW,
  })
  reserveTrial(db, {
    trial_id: "trial-1", trial_group_id: "group-1", experiment_id: "experiment-1",
    trial_ordinal: 1, candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    identity_hash_policy_version: HASH_POLICY, run_id: "run-1",
    idempotency_key: "trial-key-1", created_at: NOW,
  })
  finishTrial(db, { trial_id: "trial-1", status: "completed", completed_at: NOW })
  db.query(`
    INSERT INTO rd_result_type(result_type_id, status, description)
    VALUES ('replay_result', 'active', 'Replay result artifact')
  `).run()
}

function insertExperimentResult(db: Database, resultId: string, stageId: string): void {
  appendExperimentResult(db, {
    result_id: resultId, experiment_id: "experiment-1", result_scope: "trial",
    trial_id: "trial-1", trial_group_id: "group-1", run_id: "run-1",
    idempotency_key: `result-key:${resultId}`, stage_id: stageId,
    result_type_id: "replay_result", artifact_ref: "artifact://result-1",
    evidence_fingerprint_json: {
      policy_hash: "p", harness_hash: "h", data_hash: "d",
      assumptions_hash: "a", temporal_contract: "closed-candle",
    },
    summary_json: {}, created_at: NOW,
  })
}

function proposalRevision(overrides: Partial<Parameters<typeof appendProposalRevision>[1]> = {}): Parameters<typeof appendProposalRevision>[1] {
  const valid = overrides.validation_status !== "invalid"
  const proposalJson = overrides.proposal_json ?? (valid
    ? experimentContract()
    : { schema_version: "trade-flow.rd-experiment-contract.v2" })
  return {
    proposal_id: "proposal-1",
    planner_run_id: "planner-run-1",
    proposal_kind: "experiment",
    revision: 1,
    proposal_hash: overrides.proposal_hash ?? hashIdentityPayload(proposalJson),
    identity_hash_policy_version: HASH_POLICY,
    proposal_json: proposalJson,
    validation_status: valid ? "valid" : "invalid",
    validation_ref: `validator://${RESEARCH_CONTRACT_VALIDATOR_VERSION}/proposal-1`,
    created_at: NOW,
    ...overrides,
  }
}

function trialGroup(): Parameters<typeof registerTrialGroup>[1] {
  const candidate = {
    candidate_id: "candidate-1",
    candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 },
    candidate_ordinal: 1,
    created_at: NOW,
  }
  const identity: Omit<Parameters<typeof registerTrialGroup>[1], "group_hash"> = {
    trial_group_id: "group-1",
    hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: HASH_POLICY,
    candidate_mode: "enumerated",
    search_space_json: { schema_version: "trade-flow.rd-search-space.v1", candidates: 1 },
    selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "predeclared" },
    max_trials: 1,
    trial_accounting_policy_version: "trial-accounting-v1",
    registered_at: NOW,
    created_at: NOW,
    candidates: [candidate],
  }
  return { ...identity, group_hash: trialGroupIdentityHash(identity) }
}

function experimentContract(): Record<string, unknown> {
  return {
    schema_version: "trade-flow.rd-experiment-contract.v2",
    canonical_node_id: "canonical-1",
    code_family_id: "time_series_momentum_v1",
    implementation_version: "v1",
    contract_versions: {
      identity_hash_policy: HASH_POLICY,
      validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
      lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION,
      scope_policy: "scope-v1",
    },
    hypothesis: { falsifiable_claim: "trend persistence exceeds costs" },
    economic_rationale: { why_exists: "slow positioning adjustment" },
    asset_universe_definition: { venue: "binance-usdm", selection_timestamp_rule: "point_in_time" },
    timeframe: { signal: "4h", execution: "4h" },
    sampling_and_alignment: { closed_candle_only: true },
    required_data: ["surface:ohlcv"],
    feature_definition: {}, target_definition: {}, forecast_definition: {}, signal_definition: {},
    position_rule: {}, portfolio_construction: {}, risk_rule: {}, execution_rule: {},
    transaction_cost_model: {}, expected_holding_period: {}, benchmark: {}, validation_plan: {},
    rejection_criteria: ["net return does not exceed cost"],
    trial_group_ref: { trial_group_id: "group-1", group_hash: trialGroupHashForContract() },
    candidate_registration: { candidate_ids: ["candidate-1"] },
    parent_experiment_id: null, random_seed: 1,
    code_commit_ref: "git://code", harness_commit_ref: "git://harness",
    data_snapshot_ref: "data://snapshot", assumptions_ref: "assumptions://v1",
  }
}

function trialGroupHashForContract(): string {
  const candidate = {
    candidate_id: "candidate-1", candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
    parameter_assignment_json: { lookback: 20 }, candidate_ordinal: 1, created_at: NOW,
  }
  return trialGroupIdentityHash({
    trial_group_id: "group-1", hypothesis_scope_ref: "hypothesis-1",
    identity_hash_policy_version: HASH_POLICY, candidate_mode: "enumerated",
    search_space_json: { schema_version: "trade-flow.rd-search-space.v1", candidates: 1 },
    selection_protocol_json: { schema_version: "trade-flow.rd-selection.v1", method: "predeclared" },
    max_trials: 1, trial_accounting_policy_version: "trial-accounting-v1", candidates: [candidate],
  })
}

function reviewerDecision(
  overrides: Partial<Parameters<typeof applyReviewerDecision>[1]> = {},
): Parameters<typeof applyReviewerDecision>[1] {
  return {
    decision_id: "decision-1",
    experiment_id: "experiment-1",
    reviewer_run_id: "reviewer-run-1",
    idempotency_key: "decision-key-1",
    expected_version: 2,
    stage_id: "historical_validation",
    decision: "accept_for_draft",
    rationale_ref: "artifact://review-1",
    evidence: [{ result_id: "result-1", evidence_role: "primary" }],
    lifecycle_event_id: "event-3",
    lifecycle_idempotency_key: "event-key-3",
    selected_trial_id: "trial-1",
    created_at: NOW,
    ...overrides,
  }
}

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
