import { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { validateUniverseSeed } from "./research-control-plane-schema"

export interface UniverseSeed {
  nodes: Array<{
    node_id: string; parent_node_id?: string; level: number
    node_type: "universe" | "edge" | "mechanism_family" | "canonical_strategy"
    slug: string; name: string; path: string; description?: string
    research_scope_status: "active" | "catalog_only" | "product_out_of_scope" | "deprecated"
    implementation_scope_status: "ready" | "backlog" | "data_blocked" | "tool_blocked" | "product_out_of_scope" | "deprecated"
    sort_order?: number; metadata_json?: JSONRecord; created_at: string; updated_at: string
  }>
  axes: Array<{ node_id: string; axis: "return_driver" | "risk_premium" | "market_mechanism" | "market_domain" | "structural_edge"; is_primary: boolean; created_at: string }>
}

export interface TrialReservation {
  trial_id: string
  trial_group_id: string
  experiment_id: string
  trial_ordinal: number
  candidate_id: string
  candidate_identity_hash: string
  identity_hash_policy_version: string
  run_id: string
  idempotency_key: string
  created_at: string
}

export interface ExperimentResultWrite {
  result_id: string
  experiment_id: string
  result_scope: "trial" | "experiment" | "trial_group"
  trial_id?: string
  trial_group_id?: string
  run_id: string
  idempotency_key: string
  stage_id: string
  result_type_id: string
  artifact_ref: string
  evidence_fingerprint_json: JSONRecord
  summary_json: JSONRecord
  created_at: string
}

export interface DataSurfaceWrite {
  surface_id: string
  slug: string
  name: string
  surface_type: "market_price" | "derivatives" | "microstructure" | "onchain" | "options" | "macro_event" | "text_event" | "cross_venue"
  availability_contract_json: JSONRecord
  coverage_status: "missing" | "partial" | "ready" | "blocked" | "out_of_scope"
  owner_module?: string
  evidence_ref?: string
  created_at: string
  updated_at: string
}

export interface PipelineRegistryItemWrite {
  item_id: string
  registry_type: "feature" | "forecast_model" | "portfolio" | "risk_rule" | "execution_rule"
  slug: string
  name: string
  schema_version: string
  version: string
  owner_module?: string
  status: "active" | "experimental" | "blocked" | "unavailable" | "deprecated"
  contract_json: JSONRecord
  input_contract_json?: JSONRecord
  output_contract_json?: JSONRecord
  capability_tags: string[]
  deterministic: boolean
  deprecated_at?: string
  created_at: string
  updated_at: string
}

export function upsertDataSurface(db: Database, input: DataSurfaceWrite): void {
  requireUtc(input.created_at); requireUtc(input.updated_at)
  db.query(`
    INSERT INTO rd_data_surface(
      surface_id, slug, name, surface_type, availability_contract_json,
      coverage_status, owner_module, evidence_ref, created_at, updated_at
    ) VALUES ($id, $slug, $name, $type, $contract, $coverage, $owner, $evidence, $created, $updated)
    ON CONFLICT(surface_id) DO UPDATE SET
      name=excluded.name, surface_type=excluded.surface_type,
      availability_contract_json=excluded.availability_contract_json,
      coverage_status=excluded.coverage_status, owner_module=excluded.owner_module,
      evidence_ref=excluded.evidence_ref, updated_at=excluded.updated_at
  `).run({
    $id: required(input.surface_id, "surface_id"), $slug: required(input.slug, "slug"),
    $name: required(input.name, "name"), $type: input.surface_type,
    $contract: JSON.stringify(input.availability_contract_json), $coverage: input.coverage_status,
    $owner: input.owner_module ?? null, $evidence: input.evidence_ref ?? null,
    $created: input.created_at, $updated: input.updated_at,
  })
}

export function linkUniverseDataSurface(db: Database, input: {
  node_id: string; surface_id: string
  requirement_type: "required" | "optional" | "enhancement"
  coverage_status: "missing" | "partial" | "ready" | "blocked" | "out_of_scope"
  metadata_json?: JSONRecord; updated_at: string
}): void {
  requireUtc(input.updated_at)
  db.query(`
    INSERT INTO rd_universe_data_surface(
      node_id, surface_id, requirement_type, coverage_status, metadata_json, updated_at
    ) VALUES ($node, $surface, $requirement, $coverage, $metadata, $updated)
    ON CONFLICT(node_id, surface_id) DO UPDATE SET
      requirement_type=excluded.requirement_type, coverage_status=excluded.coverage_status,
      metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
  `).run({
    $node: required(input.node_id, "node_id"), $surface: required(input.surface_id, "surface_id"),
    $requirement: input.requirement_type, $coverage: input.coverage_status,
    $metadata: input.metadata_json ? JSON.stringify(input.metadata_json) : null, $updated: input.updated_at,
  })
}

export function upsertPipelineRegistryItem(db: Database, input: PipelineRegistryItemWrite): void {
  requireUtc(input.created_at); requireUtc(input.updated_at)
  if (input.deprecated_at) requireUtc(input.deprecated_at)
  db.query(`
    INSERT INTO rd_pipeline_registry_item(
      item_id, registry_type, slug, name, schema_version, version, owner_module,
      status, contract_json, input_contract_json, output_contract_json,
      capability_tags_json, deterministic, deprecated_at, created_at, updated_at
    ) VALUES (
      $id, $type, $slug, $name, $schema, $version, $owner, $status, $contract,
      $input, $output, $tags, $deterministic, $deprecated, $created, $updated
    ) ON CONFLICT(item_id) DO UPDATE SET
      name=excluded.name, owner_module=excluded.owner_module, status=excluded.status,
      contract_json=excluded.contract_json, input_contract_json=excluded.input_contract_json,
      output_contract_json=excluded.output_contract_json,
      capability_tags_json=excluded.capability_tags_json,
      deterministic=excluded.deterministic, deprecated_at=excluded.deprecated_at,
      updated_at=excluded.updated_at
  `).run({
    $id: required(input.item_id, "item_id"), $type: input.registry_type,
    $slug: required(input.slug, "slug"), $name: required(input.name, "name"),
    $schema: required(input.schema_version, "schema_version"), $version: required(input.version, "version"),
    $owner: input.owner_module ?? null, $status: input.status,
    $contract: JSON.stringify(input.contract_json),
    $input: input.input_contract_json ? JSON.stringify(input.input_contract_json) : null,
    $output: input.output_contract_json ? JSON.stringify(input.output_contract_json) : null,
    $tags: JSON.stringify([...new Set(input.capability_tags)].sort()),
    $deterministic: input.deterministic ? 1 : 0, $deprecated: input.deprecated_at ?? null,
    $created: input.created_at, $updated: input.updated_at,
  })
}

export function upsertUniverseCoverage(db: Database, input: {
  coverage_id: string; node_id: string
  coverage_type: "data" | "family" | "replay" | "panel" | "forward" | "governance"
  scope_ref?: string; module_ref?: string
  coverage_status: "missing" | "partial" | "ready" | "blocked" | "out_of_scope"
  evidence_ref?: string; metadata_json?: JSONRecord; updated_at: string
}): void {
  requireUtc(input.updated_at)
  db.query(`
    INSERT INTO rd_universe_coverage(
      coverage_id, node_id, coverage_type, scope_ref, module_ref,
      coverage_status, evidence_ref, metadata_json, updated_at
    ) VALUES ($id, $node, $type, $scope, $module, $status, $evidence, $metadata, $updated)
    ON CONFLICT(node_id, coverage_type, scope_ref) DO UPDATE SET
      module_ref=excluded.module_ref, coverage_status=excluded.coverage_status,
      evidence_ref=excluded.evidence_ref, metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at
  `).run({
    $id: required(input.coverage_id, "coverage_id"), $node: required(input.node_id, "node_id"),
    $type: input.coverage_type, $scope: input.scope_ref ?? "*", $module: input.module_ref ?? null,
    $status: input.coverage_status, $evidence: input.evidence_ref ?? null,
    $metadata: input.metadata_json ? JSON.stringify(input.metadata_json) : null, $updated: input.updated_at,
  })
}

export function readPlannerControlPlaneContext(db: Database): JSONRecord {
  const canonicals = db.query(`
    SELECT n.node_id, n.path, n.name, n.research_scope_status,
           n.implementation_scope_status,
           COALESCE(json_group_array(json_object(
             'coverage_type', c.coverage_type,
             'scope_ref', c.scope_ref,
             'coverage_status', c.coverage_status
           )) FILTER (WHERE c.coverage_id IS NOT NULL), '[]') AS coverage_json
    FROM rd_universe_node n
    LEFT JOIN rd_universe_coverage c ON c.node_id=n.node_id
    WHERE n.level=3 AND n.research_scope_status='active'
    GROUP BY n.node_id
    ORDER BY n.path
  `).all() as Array<{
    node_id: string; path: string; name: string; research_scope_status: string
    implementation_scope_status: string; coverage_json: string
  }>
  const dataSurfaces = db.query(`
    SELECT surface_id, slug, coverage_status, owner_module, evidence_ref
    FROM rd_data_surface ORDER BY slug
  `).all() as Array<Record<string, unknown>>
  const capabilities = db.query(`
    SELECT item_id, registry_type, slug, version, status, owner_module,
           capability_tags_json
    FROM rd_pipeline_registry_item
    WHERE status IN ('active', 'experimental')
    ORDER BY registry_type, slug, version
  `).all() as Array<Record<string, unknown>>
  const lessons = db.query(`
    SELECT n.kg_node_id, n.ref_id, n.slug, n.name, n.metadata_json
    FROM rd_knowledge_node n WHERE n.node_type='lesson'
    ORDER BY n.updated_at DESC LIMIT 100
  `).all() as Array<Record<string, unknown>>
  return {
    schema_version: "trade-flow.rd-planner-control-plane-context.v1",
    active_canonicals: canonicals.map((row) => ({
      node_id: row.node_id, path: row.path, name: row.name,
      research_scope_status: row.research_scope_status,
      implementation_scope_status: row.implementation_scope_status,
      coverage: JSON.parse(row.coverage_json),
    })),
    data_surfaces: dataSurfaces.map(parseJsonColumns),
    capabilities: capabilities.map(parseJsonColumns),
    lessons: lessons.map(parseJsonColumns),
  }
}

export function seedUniverse(db: Database, seed: UniverseSeed): void {
  const write = db.transaction(() => {
    if ((db.query("SELECT COUNT(*) AS count FROM rd_universe_node").get() as { count: number }).count > 0) {
      throw new Error("Universe is already seeded; use a versioned seed migration")
    }
    const insertNode = db.query(`
      INSERT INTO rd_universe_node(
        node_id, parent_node_id, level, node_type, slug, name, path, description,
        research_scope_status, implementation_scope_status, sort_order,
        metadata_json, created_at, updated_at
      ) VALUES (
        $id, $parent, $level, $type, $slug, $name, $path, $description,
        $research, $implementation, $sort, $metadata, $created, $updated
      )
    `)
    for (const node of [...seed.nodes].sort((left, right) => left.level - right.level || (left.sort_order ?? 0) - (right.sort_order ?? 0))) {
      requireUtc(node.created_at); requireUtc(node.updated_at)
      insertNode.run({
        $id: node.node_id, $parent: node.parent_node_id ?? null, $level: node.level,
        $type: node.node_type, $slug: node.slug, $name: node.name, $path: node.path,
        $description: node.description ?? null, $research: node.research_scope_status,
        $implementation: node.implementation_scope_status, $sort: node.sort_order ?? 0,
        $metadata: node.metadata_json ? JSON.stringify(node.metadata_json) : null,
        $created: node.created_at, $updated: node.updated_at,
      })
    }
    const insertAxis = db.query(`
      INSERT INTO rd_universe_node_axis(node_id, axis, is_primary, created_at)
      VALUES ($node, $axis, $primary, $created)
    `)
    for (const axis of seed.axes) {
      requireUtc(axis.created_at)
      insertAxis.run({ $node: axis.node_id, $axis: axis.axis, $primary: axis.is_primary ? 1 : 0, $created: axis.created_at })
    }
    validateUniverseSeed(db)
  })
  write()
}

export function reserveTrial(db: Database, input: TrialReservation): void {
  requireUtc(input.created_at)
  const replay = db.query(`SELECT trial_id, experiment_id, candidate_identity_hash FROM rd_trial WHERE idempotency_key=$key`).get({ $key: input.idempotency_key }) as {
    trial_id: string; experiment_id: string; candidate_identity_hash: string
  } | null
  if (replay) {
    if (replay.trial_id === input.trial_id && replay.experiment_id === input.experiment_id
        && replay.candidate_identity_hash === input.candidate_identity_hash) return
    throw new Error("trial idempotency key was already used for a different write")
  }
  const group = db.query(`
    SELECT trial_accounting_policy_version FROM rd_trial_group WHERE trial_group_id=$id
  `).get({ $id: input.trial_group_id }) as { trial_accounting_policy_version: string } | null
  if (!group) throw new Error("Trial Group does not exist")
  const counts = countsAgainstBudget(group.trial_accounting_policy_version)
  const write = db.transaction(() => {
    db.query(`
      INSERT INTO rd_trial(
        trial_id, trial_group_id, experiment_id, trial_ordinal, candidate_id,
        candidate_identity_hash, identity_hash_policy_version, run_id, status,
        counts_against_budget, idempotency_key, created_at
      ) VALUES (
        $trial_id, $trial_group_id, $experiment_id, $trial_ordinal, $candidate_id,
        $candidate_identity_hash, $identity_hash_policy_version, $run_id, 'reserved',
        $counts, $idempotency_key, $created_at
      )
    `).run({
      $trial_id: input.trial_id, $trial_group_id: input.trial_group_id,
      $experiment_id: input.experiment_id, $trial_ordinal: input.trial_ordinal,
      $candidate_id: input.candidate_id, $candidate_identity_hash: input.candidate_identity_hash,
      $identity_hash_policy_version: input.identity_hash_policy_version, $run_id: input.run_id,
      $counts: counts, $idempotency_key: input.idempotency_key, $created_at: input.created_at,
    })
    ensureKgNode(db, `kg:trial:${input.trial_id}`, "trial", input.trial_id, input.trial_id, input.trial_id, input.created_at)
    db.query(`
      INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
      VALUES ($id, $from, $to, 'consumes', NULL, $created)
    `).run({
      $id: `kg-edge:experiment-consumes:${input.trial_id}`,
      $from: `kg:experiment:${input.experiment_id}`, $to: `kg:trial:${input.trial_id}`,
      $created: input.created_at,
    })
  })
  write()
}

export function finishTrial(
  db: Database,
  input: { trial_id: string; status: "completed" | "failed" | "cancelled"; completed_at: string },
): void {
  requireUtc(input.completed_at)
  const current = db.query("SELECT status, completed_at FROM rd_trial WHERE trial_id=$id").get({ $id: input.trial_id }) as {
    status: string; completed_at: string | null
  } | null
  if (current?.status === input.status && current.completed_at === input.completed_at) return
  const result = db.query(`
    UPDATE rd_trial SET status=$status, completed_at=$completed_at
    WHERE trial_id=$trial_id AND status='reserved'
  `).run({ $status: input.status, $completed_at: input.completed_at, $trial_id: input.trial_id })
  if (result.changes !== 1) throw new Error("Trial is missing or no longer reserved")
}

export function appendExperimentResult(db: Database, input: ExperimentResultWrite): void {
  requireUtc(input.created_at)
  const replay = db.query(`SELECT result_id, experiment_id, artifact_ref FROM rd_experiment_result WHERE idempotency_key=$key`).get({ $key: input.idempotency_key }) as {
    result_id: string; experiment_id: string; artifact_ref: string
  } | null
  if (replay) {
    if (replay.result_id === input.result_id && replay.experiment_id === input.experiment_id
        && replay.artifact_ref === input.artifact_ref) return
    throw new Error("result idempotency key was already used for a different write")
  }
  for (const field of ["policy_hash", "harness_hash", "data_hash", "assumptions_hash", "temporal_contract"]) {
    const value = input.evidence_fingerprint_json[field]
    if (typeof value !== "string" || !value.trim()) throw new Error(`evidence fingerprint requires non-empty ${field}`)
  }
  const write = db.transaction(() => {
    const experiment = db.query("SELECT lifecycle_state FROM rd_experiment_contract WHERE experiment_id=$id").get({ $id: input.experiment_id }) as { lifecycle_state: string } | null
    if (!experiment || !["discovery", "forward_observation"].includes(experiment.lifecycle_state)) {
      throw new Error("Result may only publish for an executable open experiment state")
    }
    if (input.stage_id === "forward_observation" && experiment.lifecycle_state !== "forward_observation") {
      throw new Error("forward Result requires forward_observation lifecycle state")
    }
    if (input.stage_id !== "forward_observation" && experiment.lifecycle_state !== "discovery") {
      throw new Error("historical and diagnostic Result stages require discovery lifecycle state")
    }
    if (input.result_scope === "trial") {
      const trial = db.query(`
        SELECT run_id, status FROM rd_trial
        WHERE trial_id=$trial AND experiment_id=$experiment AND trial_group_id=$group
      `).get({ $trial: input.trial_id ?? null, $experiment: input.experiment_id, $group: input.trial_group_id ?? null }) as { run_id: string; status: string } | null
      if (!trial || trial.status !== "completed" || trial.run_id !== input.run_id) {
        throw new Error("trial-scoped Result requires the matching completed Trial run")
      }
    }
    db.query(`
      INSERT INTO rd_experiment_result(
        result_id, experiment_id, result_scope, trial_id, trial_group_id, run_id,
        idempotency_key, stage_id, result_type_id, artifact_ref,
        evidence_fingerprint_json, summary_json, created_at
      ) VALUES (
        $result_id, $experiment_id, $result_scope, $trial_id, $trial_group_id, $run_id,
        $idempotency_key, $stage_id, $result_type_id, $artifact_ref,
        $fingerprint, $summary, $created_at
      )
    `).run({
      $result_id: input.result_id, $experiment_id: input.experiment_id,
      $result_scope: input.result_scope, $trial_id: input.trial_id ?? null,
      $trial_group_id: input.trial_group_id ?? null, $run_id: input.run_id,
      $idempotency_key: input.idempotency_key, $stage_id: input.stage_id,
      $result_type_id: input.result_type_id, $artifact_ref: input.artifact_ref,
      $fingerprint: JSON.stringify(input.evidence_fingerprint_json),
      $summary: JSON.stringify(input.summary_json), $created_at: input.created_at,
    })
    ensureKgNode(db, `kg:experiment:${input.experiment_id}`, "experiment", input.experiment_id, input.experiment_id, input.experiment_id, input.created_at)
    ensureKgNode(db, `kg:result:${input.result_id}`, "result", input.result_id, input.result_id, input.result_id, input.created_at)
    db.query(`
      INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
      VALUES ($id, $from, $to, 'produces', NULL, $created)
    `).run({
      $id: `kg-edge:experiment-produces:${input.result_id}`,
      $from: `kg:experiment:${input.experiment_id}`, $to: `kg:result:${input.result_id}`,
      $created: input.created_at,
    })
  })
  write()
}

export function publishExperimentResultAndFinishTrials(
  db: Database,
  input: { result: ExperimentResultWrite; trial_ids: string[]; completed_at: string },
): void {
  requireUtc(input.completed_at)
  const publish = db.transaction(() => {
    for (const trialId of input.trial_ids) {
      finishTrial(db, { trial_id: trialId, status: "completed", completed_at: input.completed_at })
    }
    appendExperimentResult(db, input.result)
  })
  publish()
}

export function openExperimentBlocker(db: Database, input: {
  blocker_id: string; experiment_id: string
  blocker_type: "external_data" | "external_tool" | "capacity" | "governance"
  detail_ref: string; idempotency_key: string; created_at: string
}): void {
  requireUtc(input.created_at)
  const replay = db.query(`SELECT blocker_id, experiment_id, detail_ref FROM rd_experiment_blocker WHERE idempotency_key=$key`).get({ $key: input.idempotency_key }) as {
    blocker_id: string; experiment_id: string; detail_ref: string
  } | null
  if (replay) {
    if (replay.blocker_id === input.blocker_id && replay.experiment_id === input.experiment_id
        && replay.detail_ref === input.detail_ref) return
    throw new Error("blocker idempotency key was already used for a different write")
  }
  db.query(`
    INSERT INTO rd_experiment_blocker(
      blocker_id, experiment_id, blocker_type, detail_ref, status,
      idempotency_key, created_at
    ) VALUES ($id, $experiment, $type, $detail, 'open', $key, $created)
  `).run({
    $id: input.blocker_id, $experiment: input.experiment_id, $type: input.blocker_type,
    $detail: input.detail_ref, $key: input.idempotency_key, $created: input.created_at,
  })
}

export function closeExperimentBlocker(db: Database, input: {
  blocker_id: string; close_reason: "resolved" | "superseded" | "experiment_closed"; closed_at: string
  closed_by?: "system" | "governance"
}): void {
  requireUtc(input.closed_at)
  const blocker = db.query("SELECT blocker_type, status, close_reason, closed_at FROM rd_experiment_blocker WHERE blocker_id=$id").get({ $id: input.blocker_id }) as {
    blocker_type: string; status: string; close_reason: string | null; closed_at: string | null
  } | null
  if (blocker?.status === "closed" && blocker.close_reason === input.close_reason && blocker.closed_at === input.closed_at) return
  if (blocker?.blocker_type === "governance" && input.closed_by !== "governance") {
    throw new Error("governance blockers may only be closed by governance")
  }
  const result = db.query(`
    UPDATE rd_experiment_blocker SET status='closed', close_reason=$reason, closed_at=$closed
    WHERE blocker_id=$id AND status='open'
  `).run({ $reason: input.close_reason, $closed: input.closed_at, $id: input.blocker_id })
  if (result.changes !== 1) throw new Error("blocker is missing or already closed")
}

export function openBlockerAndTransition(db: Database, input: Parameters<typeof openExperimentBlocker>[1] & {
  expected_version: number; lifecycle_event_id: string; lifecycle_idempotency_key: string
}): void {
  const write = db.transaction(() => {
    openExperimentBlocker(db, input)
    applySystemTransition(db, {
      experiment_id: input.experiment_id, expected_version: input.expected_version,
      trigger_type: "blocker", trigger_value: "opened", trigger_ref: `blocker://${input.blocker_id}`,
      event_id: input.lifecycle_event_id, idempotency_key: input.lifecycle_idempotency_key,
      created_at: input.created_at,
    })
  })
  write()
}

export function resolveBlockerAndTransition(db: Database, input: Parameters<typeof closeExperimentBlocker>[1] & {
  experiment_id: string; expected_version: number
  lifecycle_event_id: string; lifecycle_idempotency_key: string
}): void {
  const write = db.transaction(() => {
    closeExperimentBlocker(db, input)
    const remaining = db.query(`
      SELECT COUNT(*) AS count FROM rd_experiment_blocker
      WHERE experiment_id=$experiment AND status='open'
    `).get({ $experiment: input.experiment_id }) as { count: number }
    if (remaining.count > 0) throw new Error("experiment still has open blockers")
    if (input.close_reason === "resolved") {
      applySystemTransition(db, {
        experiment_id: input.experiment_id, expected_version: input.expected_version,
        trigger_type: "blocker", trigger_value: "resolved", trigger_ref: `blocker://${input.blocker_id}`,
        event_id: input.lifecycle_event_id, idempotency_key: input.lifecycle_idempotency_key,
        created_at: input.closed_at,
      })
    }
  })
  write()
}

export function upsertKnowledgeNode(db: Database, input: {
  kg_node_id: string; node_type: string; ref_id?: string; slug: string; name: string
  metadata_json?: JSONRecord; created_at: string; updated_at: string
}): void {
  requireUtc(input.created_at); requireUtc(input.updated_at)
  db.query(`
    INSERT INTO rd_knowledge_node(
      kg_node_id, node_type, ref_id, slug, name, metadata_json, created_at, updated_at
    ) VALUES ($id, $type, $ref, $slug, $name, $metadata, $created, $updated)
    ON CONFLICT(kg_node_id) DO UPDATE SET
      name=excluded.name, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
  `).run({
    $id: input.kg_node_id, $type: input.node_type, $ref: input.ref_id ?? null,
    $slug: input.slug, $name: input.name,
    $metadata: input.metadata_json ? JSON.stringify(input.metadata_json) : null,
    $created: input.created_at, $updated: input.updated_at,
  })
}

export function appendKnowledgeEdge(db: Database, input: {
  edge_id: string; from_kg_node_id: string; to_kg_node_id: string; edge_type: string
  metadata_json?: JSONRecord; created_at: string
}): void {
  requireUtc(input.created_at)
  db.query(`
    INSERT INTO rd_knowledge_edge VALUES($id, $from, $to, $type, $metadata, $created)
  `).run({
    $id: input.edge_id, $from: input.from_kg_node_id, $to: input.to_kg_node_id,
    $type: input.edge_type, $metadata: input.metadata_json ? JSON.stringify(input.metadata_json) : null,
    $created: input.created_at,
  })
}

export function appendKnowledgeEvidence(db: Database, input: {
  edge_evidence_id: string; edge_id: string; evidence_ref: string; evidence_type: string
  evidence_strength?: number; scoring_policy_ref?: string; observed_at: string
  supersedes_edge_evidence_id?: string; idempotency_key: string
  metadata_json?: JSONRecord; created_at: string
}): void {
  requireUtc(input.observed_at); requireUtc(input.created_at)
  const replay = db.query(`SELECT edge_evidence_id, edge_id, evidence_ref FROM rd_knowledge_edge_evidence WHERE idempotency_key=$key`).get({ $key: input.idempotency_key }) as {
    edge_evidence_id: string; edge_id: string; evidence_ref: string
  } | null
  if (replay) {
    if (replay.edge_evidence_id === input.edge_evidence_id && replay.edge_id === input.edge_id
        && replay.evidence_ref === input.evidence_ref) return
    throw new Error("knowledge evidence idempotency key was already used for a different write")
  }
  if (input.evidence_strength !== undefined && !input.scoring_policy_ref) throw new Error("scored evidence requires scoring_policy_ref")
  db.query(`
    INSERT INTO rd_knowledge_edge_evidence(
      edge_evidence_id, edge_id, evidence_ref, evidence_type, evidence_strength,
      scoring_policy_ref, observed_at, supersedes_edge_evidence_id,
      supersedes_edge_id, idempotency_key, metadata_json, created_at
    ) VALUES (
      $id, $edge, $ref, $type, $strength, $policy, $observed, $supersedes,
      CASE WHEN $supersedes IS NULL THEN NULL ELSE $edge END, $key, $metadata, $created
    )
  `).run({
    $id: input.edge_evidence_id, $edge: input.edge_id, $ref: input.evidence_ref,
    $type: input.evidence_type, $strength: input.evidence_strength ?? null,
    $policy: input.scoring_policy_ref ?? null, $observed: input.observed_at,
    $supersedes: input.supersedes_edge_evidence_id ?? null, $key: input.idempotency_key,
    $metadata: input.metadata_json ? JSON.stringify(input.metadata_json) : null,
    $created: input.created_at,
  })
}

export function appendResearchLesson(db: Database, input: {
  lesson_id: string; experiment_id: string; hypothesis_id: string
  conclusion: "blocks" | "supports"; lesson_ref: string
  regime_ref?: string; asset_universe_ref?: string
  metadata_json: JSONRecord; idempotency_key: string; created_at: string
}): void {
  requireUtc(input.created_at)
  const replay = db.query(`SELECT edge_evidence_id FROM rd_knowledge_edge_evidence WHERE idempotency_key=$key`).get({ $key: input.idempotency_key })
  if (replay) return
  const contract = db.query(`
    SELECT hypothesis_id FROM rd_experiment_contract WHERE experiment_id=$id
  `).get({ $id: input.experiment_id }) as { hypothesis_id: string } | null
  if (contract?.hypothesis_id !== input.hypothesis_id) throw new Error("lesson scope must match the experiment hypothesis")
  const write = db.transaction(() => {
    ensureKgNode(db, `kg:lesson:${input.lesson_id}`, "lesson", input.lesson_id, input.lesson_id, input.lesson_id, input.created_at)
    db.query(`UPDATE rd_knowledge_node SET metadata_json=$metadata WHERE kg_node_id=$id`).run({
      $metadata: JSON.stringify(input.metadata_json), $id: `kg:lesson:${input.lesson_id}`,
    })
    const structuralEdges: Array<readonly [string, string, string, string]> = [
      [`kg-edge:lesson-experiment:${input.lesson_id}`, `kg:lesson:${input.lesson_id}`, `kg:experiment:${input.experiment_id}`, "derived_from"],
      [`kg-edge:lesson-hypothesis:${input.lesson_id}`, `kg:lesson:${input.lesson_id}`, `kg:hypothesis:${input.hypothesis_id}`, input.conclusion],
    ]
    if (input.regime_ref) {
      ensureKgNode(db, `kg:regime:${input.regime_ref}`, "regime", input.regime_ref, input.regime_ref, input.regime_ref, input.created_at)
      structuralEdges.push([`kg-edge:lesson-regime:${input.lesson_id}`, `kg:lesson:${input.lesson_id}`, `kg:regime:${input.regime_ref}`, "applies_under"])
    }
    if (input.asset_universe_ref) {
      ensureKgNode(db, `kg:asset-universe:${input.asset_universe_ref}`, "asset_universe", input.asset_universe_ref, input.asset_universe_ref, input.asset_universe_ref, input.created_at)
      structuralEdges.push([`kg-edge:lesson-universe:${input.lesson_id}`, `kg:lesson:${input.lesson_id}`, `kg:asset-universe:${input.asset_universe_ref}`, "scoped_to"])
    }
    const insertEdge = db.query(`
      INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
      VALUES ($id, $from, $to, $type, NULL, $created)
    `)
    for (const [id, from, to, type] of structuralEdges) insertEdge.run({ $id: id, $from: from, $to: to, $type: type, $created: input.created_at })
    db.query(`
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        idempotency_key, metadata_json, created_at
      ) VALUES ($id, $edge, $ref, 'lesson', $created, $key, $metadata, $created)
    `).run({
      $id: `kg-evidence:lesson:${input.lesson_id}`,
      $edge: `kg-edge:lesson-hypothesis:${input.lesson_id}`, $ref: input.lesson_ref,
      $key: input.idempotency_key, $metadata: JSON.stringify(input.metadata_json), $created: input.created_at,
    })
  })
  write()
}

export function applySystemTransition(db: Database, input: {
  experiment_id: string
  expected_version: number
  trigger_type: "system" | "blocker" | "governance"
  trigger_value: string
  trigger_ref: string
  event_id: string
  idempotency_key: string
  fresh_fingerprint?: boolean
  created_at: string
}): void {
  requireUtc(input.created_at)
  const write = db.transaction(() => {
    const replay = db.query(`
      SELECT event_id, experiment_id FROM rd_lifecycle_event WHERE idempotency_key=$key
    `).get({ $key: input.idempotency_key }) as { event_id: string; experiment_id: string } | null
    if (replay) {
      if (replay.event_id === input.event_id && replay.experiment_id === input.experiment_id) return
      throw new Error("lifecycle idempotency key was already used for a different event")
    }
    const experiment = db.query(`
      SELECT lifecycle_state, lifecycle_version, lifecycle_rule_version, suspended_from_state
      FROM rd_experiment_contract WHERE experiment_id=$id
    `).get({ $id: input.experiment_id }) as {
      lifecycle_state: string; lifecycle_version: number; lifecycle_rule_version: string; suspended_from_state: string | null
    } | null
    if (!experiment || experiment.lifecycle_version !== input.expected_version) throw new Error("experiment lifecycle version conflict")
    const rule = db.query(`
      SELECT rule_id, next_state, requires_fresh_fingerprint FROM rd_lifecycle_transition_rule
      WHERE rule_version=$version AND current_state=$state AND trigger_type=$type
        AND trigger_value=$value AND requires_result_stage_id='__any__'
    `).get({
      $version: experiment.lifecycle_rule_version, $state: experiment.lifecycle_state,
      $type: input.trigger_type, $value: input.trigger_value,
    }) as { rule_id: string; next_state: string; requires_fresh_fingerprint: number } | null
    if (!rule) throw new Error("system trigger does not resolve to one lifecycle rule")
    if (rule.requires_fresh_fingerprint === 1 && input.fresh_fingerprint !== true) {
      throw new Error("lifecycle transition requires a fresh evidence fingerprint")
    }
    if (experiment.lifecycle_state === "suspended") {
      if (!experiment.suspended_from_state || rule.next_state !== experiment.suspended_from_state) {
        throw new Error("suspended experiment may only resume to its recorded prior state")
      }
    }
    const nextVersion = input.expected_version + 1
    db.query(`
      INSERT INTO rd_lifecycle_event VALUES(
        $event_id, $experiment_id, $sequence, $rule_id, $trigger_ref,
        $current, $next, $key, $created_at
      )
    `).run({
      $event_id: input.event_id, $experiment_id: input.experiment_id,
      $sequence: nextVersion, $rule_id: rule.rule_id, $trigger_ref: input.trigger_ref,
      $current: experiment.lifecycle_state, $next: rule.next_state,
      $key: input.idempotency_key, $created_at: input.created_at,
    })
    const updated = db.query(`
      UPDATE rd_experiment_contract SET lifecycle_state=$next, lifecycle_version=$version,
        last_lifecycle_event_id=$event,
        suspended_from_state=CASE
          WHEN $next='suspended' THEN $current
          WHEN $current='suspended' THEN NULL
          ELSE suspended_from_state
        END,
        updated_at=$updated_at
      WHERE experiment_id=$id AND lifecycle_version=$expected
    `).run({
      $next: rule.next_state, $version: nextVersion, $event: input.event_id,
      $current: experiment.lifecycle_state, $updated_at: input.created_at,
      $id: input.experiment_id, $expected: input.expected_version,
    })
    if (updated.changes !== 1) throw new Error("experiment lifecycle version conflict")
  })
  write()
}

export function rebuildLifecycleProjection(db: Database, experimentId: string, rebuiltAt: string): void {
  requireUtc(rebuiltAt)
  const events = db.query(`
    SELECT event_id, sequence_no, current_state, next_state FROM rd_lifecycle_event
    WHERE experiment_id=$id ORDER BY sequence_no
  `).all({ $id: experimentId }) as Array<{ event_id: string; sequence_no: number; current_state: string; next_state: string }>
  if (events.length === 0 || events[0]?.current_state !== "__unregistered__") throw new Error("lifecycle bootstrap event is missing")
  let suspendedFrom: string | null = null
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.sequence_no !== index + 1 || (index > 0 && event.current_state !== events[index - 1]?.next_state)) {
      throw new Error("lifecycle event history cannot be projected")
    }
    if (event.next_state === "suspended") suspendedFrom = event.current_state
    else if (event.current_state === "suspended") suspendedFrom = null
  }
  const latest = events.at(-1)!
  const result = db.query(`
    UPDATE rd_experiment_contract SET lifecycle_state=$state, lifecycle_version=$version,
      last_lifecycle_event_id=$event, suspended_from_state=$suspended, updated_at=$updated
    WHERE experiment_id=$id
  `).run({
    $state: latest.next_state, $version: latest.sequence_no, $event: latest.event_id,
    $suspended: suspendedFrom, $updated: rebuiltAt, $id: experimentId,
  })
  if (result.changes !== 1) throw new Error("experiment does not exist")
  assertLifecycleProjection(db, experimentId)
}

export function assertLifecycleProjection(db: Database, experimentId: string): void {
  const contract = db.query(`
    SELECT lifecycle_state, lifecycle_version, last_lifecycle_event_id
    FROM rd_experiment_contract WHERE experiment_id=$id
  `).get({ $id: experimentId }) as { lifecycle_state: string; lifecycle_version: number; last_lifecycle_event_id: string | null } | null
  if (!contract) throw new Error("experiment does not exist")
  const events = db.query(`
    SELECT event_id, sequence_no, current_state, next_state FROM rd_lifecycle_event
    WHERE experiment_id=$id ORDER BY sequence_no
  `).all({ $id: experimentId }) as Array<{ event_id: string; sequence_no: number; current_state: string; next_state: string }>
  if (events.length === 0 || events[0]?.current_state !== "__unregistered__") throw new Error("lifecycle bootstrap event is missing")
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.sequence_no !== index + 1) throw new Error("lifecycle sequence is not contiguous")
    if (index > 0 && event.current_state !== events[index - 1]?.next_state) throw new Error("lifecycle event chain is broken")
  }
  const latest = events.at(-1)!
  if (contract.lifecycle_version !== events.length || contract.lifecycle_state !== latest.next_state
      || contract.last_lifecycle_event_id !== latest.event_id) throw new Error("lifecycle projection does not match event history")
}

function countsAgainstBudget(policy: string): number {
  if (policy === "trade-flow.trial-accounting.v1" || policy === "trial-accounting-v1") return 1
  throw new Error(`unsupported trial accounting policy: ${policy}`)
}

function requireUtc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("timestamp must be RFC 3339 UTC")
  }
}

function required(value: string, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function parseJsonColumns(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "string" && key.endsWith("_json")) {
      try { return [key.slice(0, -5), JSON.parse(value)] }
      catch { return [key, value] }
    }
    return [key, value]
  }))
}

function ensureKgNode(
  db: Database, id: string, type: string, ref: string, slug: string, name: string, now: string,
): void {
  db.query(`
    INSERT INTO rd_knowledge_node(
      kg_node_id, node_type, ref_id, slug, name, metadata_json, created_at, updated_at
    ) VALUES ($id, $type, $ref, $slug, $name, NULL, $now, $now)
    ON CONFLICT(kg_node_id) DO NOTHING
  `).run({ $id: id, $type: type, $ref: ref, $slug: slug, $name: name, $now: now })
}
