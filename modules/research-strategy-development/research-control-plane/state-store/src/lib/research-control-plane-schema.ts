import { Database } from "bun:sqlite"

export const RESEARCH_CONTROL_PLANE_SCHEMA_VERSION = "trade-flow.rd-control-plane-schema.v1"
export const RESEARCH_LIFECYCLE_RULE_VERSION = "trade-flow.rd-lifecycle-rules.v1"

const CONTROL_PLANE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rd_universe_node (
  node_id TEXT PRIMARY KEY,
  parent_node_id TEXT,
  level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 3),
  node_type TEXT NOT NULL CHECK(node_type IN (
    'universe', 'edge', 'mechanism_family', 'canonical_strategy'
  )),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  research_scope_status TEXT NOT NULL CHECK(research_scope_status IN (
    'active', 'catalog_only', 'product_out_of_scope', 'deprecated'
  )),
  implementation_scope_status TEXT NOT NULL CHECK(implementation_scope_status IN (
    'ready', 'backlog', 'data_blocked', 'tool_blocked',
    'product_out_of_scope', 'deprecated'
  )),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (parent_node_id, slug),
  FOREIGN KEY (parent_node_id) REFERENCES rd_universe_node(node_id)
);

CREATE TABLE IF NOT EXISTS rd_universe_node_axis (
  node_id TEXT NOT NULL,
  axis TEXT NOT NULL CHECK(axis IN (
    'return_driver', 'risk_premium', 'market_mechanism',
    'market_domain', 'structural_edge'
  )),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, axis),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_universe_node_primary_axis
ON rd_universe_node_axis(node_id)
WHERE is_primary = 1;

CREATE VIEW IF NOT EXISTS rd_universe_node_with_primary_axis AS
SELECT n.*, a.axis AS primary_classification_axis
FROM rd_universe_node n
LEFT JOIN rd_universe_node_axis a
  ON a.node_id = n.node_id AND a.is_primary = 1;

CREATE TABLE IF NOT EXISTS rd_data_surface (
  surface_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  surface_type TEXT NOT NULL CHECK(surface_type IN (
    'market_price', 'derivatives', 'microstructure', 'onchain',
    'options', 'macro_event', 'text_event', 'cross_venue'
  )),
  availability_contract_json TEXT NOT NULL CHECK(json_valid(availability_contract_json)),
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  owner_module TEXT,
  evidence_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rd_universe_data_surface (
  node_id TEXT NOT NULL,
  surface_id TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK(requirement_type IN (
    'required', 'optional', 'enhancement'
  )),
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (node_id, surface_id),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id),
  FOREIGN KEY (surface_id) REFERENCES rd_data_surface(surface_id)
);

CREATE TABLE IF NOT EXISTS rd_pipeline_registry_item (
  item_id TEXT PRIMARY KEY,
  registry_type TEXT NOT NULL CHECK(registry_type IN (
    'feature', 'forecast_model', 'portfolio', 'risk_rule', 'execution_rule'
  )),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_module TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'active', 'experimental', 'blocked', 'unavailable', 'deprecated'
  )),
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  input_contract_json TEXT CHECK(input_contract_json IS NULL OR json_valid(input_contract_json)),
  output_contract_json TEXT CHECK(output_contract_json IS NULL OR json_valid(output_contract_json)),
  capability_tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(capability_tags_json)),
  deterministic INTEGER NOT NULL DEFAULT 1 CHECK(deterministic IN (0, 1)),
  deprecated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (status = 'deprecated' AND deprecated_at IS NOT NULL) OR
    (status != 'deprecated' AND deprecated_at IS NULL)
  ),
  UNIQUE (registry_type, slug, version)
);

CREATE TABLE IF NOT EXISTS rd_universe_coverage (
  coverage_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  coverage_type TEXT NOT NULL CHECK(coverage_type IN (
    'data', 'family', 'replay', 'panel', 'forward', 'governance'
  )),
  scope_ref TEXT NOT NULL DEFAULT '*',
  module_ref TEXT,
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'missing', 'partial', 'ready', 'blocked', 'out_of_scope'
  )),
  evidence_ref TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  updated_at TEXT NOT NULL,
  UNIQUE (node_id, coverage_type, scope_ref),
  FOREIGN KEY (node_id) REFERENCES rd_universe_node(node_id)
);

CREATE TABLE IF NOT EXISTS rd_result_stage (
  stage_id TEXT PRIMARY KEY,
  stage_order INTEGER NOT NULL,
  is_sentinel INTEGER NOT NULL DEFAULT 0 CHECK(is_sentinel IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
  CHECK((stage_id = '__any__' AND is_sentinel = 1) OR
        (stage_id != '__any__' AND is_sentinel = 0))
);

CREATE TABLE IF NOT EXISTS rd_result_type (
  result_type_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rd_lifecycle_transition_rule (
  rule_id TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  current_state TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('reviewer', 'system', 'blocker', 'governance')),
  trigger_value TEXT NOT NULL,
  next_state TEXT NOT NULL CHECK(next_state IN (
    'proposed', 'blocked', 'discovery', 'rejected', 'needs_modification',
    'draft_frozen', 'forward_observation', 'invalidated', 'shadow_candidate',
    'suspended', 'superseded', 'closed'
  )),
  requires_result_stage_id TEXT NOT NULL DEFAULT '__any__',
  requires_fresh_fingerprint INTEGER NOT NULL DEFAULT 0
    CHECK(requires_fresh_fingerprint IN (0, 1)),
  UNIQUE (rule_version, current_state, trigger_type, trigger_value, requires_result_stage_id),
  FOREIGN KEY (requires_result_stage_id) REFERENCES rd_result_stage(stage_id)
);

CREATE TABLE IF NOT EXISTS rd_trial_group (
  trial_group_id TEXT PRIMARY KEY,
  hypothesis_scope_ref TEXT NOT NULL,
  group_hash TEXT NOT NULL UNIQUE,
  identity_hash_policy_version TEXT NOT NULL,
  candidate_mode TEXT NOT NULL CHECK(candidate_mode IN ('enumerated', 'generated_from_space')),
  candidate_generator_ref TEXT,
  search_space_json TEXT NOT NULL CHECK(json_valid(search_space_json)),
  selection_protocol_json TEXT NOT NULL CHECK(json_valid(selection_protocol_json)),
  max_trials INTEGER NOT NULL CHECK(max_trials >= 1),
  trial_accounting_policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('registered', 'running', 'sealed', 'closed')),
  registered_at TEXT NOT NULL,
  sealed_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (trial_group_id, group_hash, identity_hash_policy_version),
  UNIQUE (trial_group_id, identity_hash_policy_version),
  CHECK(
    (status IN ('registered', 'running') AND sealed_at IS NULL AND closed_at IS NULL) OR
    (status = 'sealed' AND sealed_at IS NOT NULL AND closed_at IS NULL) OR
    (status = 'closed' AND sealed_at IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CHECK(
    (candidate_mode = 'enumerated' AND candidate_generator_ref IS NULL) OR
    (candidate_mode = 'generated_from_space' AND candidate_generator_ref IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS rd_trial_group_candidate (
  trial_group_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_identity_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  parameter_assignment_json TEXT NOT NULL CHECK(json_valid(parameter_assignment_json)),
  candidate_ordinal INTEGER NOT NULL CHECK(candidate_ordinal >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (trial_group_id, candidate_id),
  UNIQUE (trial_group_id, candidate_ordinal),
  UNIQUE (
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (trial_group_id, identity_hash_policy_version)
    REFERENCES rd_trial_group(trial_group_id, identity_hash_policy_version)
);

CREATE TABLE IF NOT EXISTS rd_proposal (
  proposal_id TEXT PRIMARY KEY,
  planner_run_id TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK(proposal_kind IN ('experiment', 'family_backlog')),
  materialized_revision INTEGER,
  materialization_ref TEXT UNIQUE,
  materialized_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(
    (materialized_revision IS NULL AND materialization_ref IS NULL AND materialized_at IS NULL) OR
    (materialized_revision IS NOT NULL AND materialization_ref IS NOT NULL AND materialized_at IS NOT NULL)
  ),
  FOREIGN KEY (proposal_id, materialized_revision)
    REFERENCES rd_proposal_revision(proposal_id, revision)
);

CREATE TABLE IF NOT EXISTS rd_proposal_revision (
  proposal_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  proposal_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  validation_status TEXT NOT NULL CHECK(validation_status IN ('invalid', 'valid')),
  validation_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, revision),
  FOREIGN KEY (proposal_id) REFERENCES rd_proposal(proposal_id)
);

CREATE TABLE IF NOT EXISTS rd_experiment_contract (
  experiment_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL,
  canonical_node_id TEXT NOT NULL,
  hypothesis_id TEXT NOT NULL,
  code_family_id TEXT NOT NULL,
  trial_group_id TEXT NOT NULL,
  trial_group_hash TEXT NOT NULL,
  parent_experiment_id TEXT,
  contract_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  contract_validator_version TEXT NOT NULL,
  lifecycle_rule_version TEXT NOT NULL,
  scope_policy_version TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  selected_candidate_id TEXT,
  selected_trial_id TEXT,
  candidate_hash TEXT,
  candidate_frozen_at TEXT,
  suspended_from_state TEXT,
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN (
    'proposed', 'blocked', 'discovery', 'rejected', 'needs_modification',
    'draft_frozen', 'forward_observation', 'invalidated', 'shadow_candidate',
    'suspended', 'superseded', 'closed'
  )),
  lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_version >= 0),
  last_lifecycle_event_id TEXT,
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (proposal_id, proposal_revision),
  UNIQUE (proposal_id),
  UNIQUE (trial_group_id, experiment_id),
  CHECK(
    (selected_candidate_id IS NULL AND selected_trial_id IS NULL AND
     candidate_hash IS NULL AND candidate_frozen_at IS NULL) OR
    (selected_candidate_id IS NOT NULL AND selected_trial_id IS NOT NULL AND
     candidate_hash IS NOT NULL AND candidate_frozen_at IS NOT NULL)
  ),
  FOREIGN KEY (proposal_id, proposal_revision)
    REFERENCES rd_proposal_revision(proposal_id, revision),
  FOREIGN KEY (canonical_node_id) REFERENCES rd_universe_node(node_id),
  FOREIGN KEY (trial_group_id, trial_group_hash, identity_hash_policy_version)
    REFERENCES rd_trial_group(trial_group_id, group_hash, identity_hash_policy_version),
  FOREIGN KEY (
    selected_trial_id, experiment_id, selected_candidate_id,
    candidate_hash, identity_hash_policy_version
  ) REFERENCES rd_trial(
    trial_id, experiment_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (parent_experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (last_lifecycle_event_id) REFERENCES rd_lifecycle_event(event_id)
);

CREATE TABLE IF NOT EXISTS rd_trial (
  trial_id TEXT PRIMARY KEY,
  trial_group_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  trial_ordinal INTEGER NOT NULL CHECK(trial_ordinal >= 1),
  candidate_id TEXT NOT NULL,
  candidate_identity_hash TEXT NOT NULL,
  identity_hash_policy_version TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'completed', 'failed', 'cancelled')),
  counts_against_budget INTEGER NOT NULL CHECK(counts_against_budget IN (0, 1)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK(
    (status = 'reserved' AND completed_at IS NULL) OR
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
  ),
  UNIQUE (trial_group_id, experiment_id, trial_ordinal),
  UNIQUE (trial_id, experiment_id, trial_group_id),
  UNIQUE (
    trial_id, experiment_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ) REFERENCES rd_trial_group_candidate(
    trial_group_id, candidate_id,
    candidate_identity_hash, identity_hash_policy_version
  ),
  FOREIGN KEY (trial_group_id, experiment_id)
    REFERENCES rd_experiment_contract(trial_group_id, experiment_id)
);

CREATE TABLE IF NOT EXISTS rd_replay_instrument_status_provider_certification (
  certification_id TEXT PRIMARY KEY,
  certification_ref TEXT NOT NULL UNIQUE,
  certification_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'certified'),
  certified_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  certifier_id TEXT NOT NULL,
  certification_policy_version TEXT NOT NULL,
  provider_capability_hash TEXT NOT NULL,
  producer_domain TEXT NOT NULL CHECK(producer_domain = 'market-data-products'),
  producer_id TEXT NOT NULL,
  producer_version TEXT NOT NULL,
  producer_build_hash TEXT NOT NULL,
  normalization_policy_version TEXT NOT NULL,
  normalization_policy_hash TEXT NOT NULL,
  allowed_source_kind TEXT NOT NULL CHECK(allowed_source_kind = 'venue_status_event_archive'),
  allowed_completeness TEXT NOT NULL CHECK(allowed_completeness = 'complete_history'),
  certification_json TEXT NOT NULL CHECK(json_valid(certification_json)),
  CHECK(certified_at < valid_until)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_instrument_status_provider_certification_no_update
BEFORE UPDATE ON rd_replay_instrument_status_provider_certification
BEGIN
  SELECT RAISE(ABORT, 'Replay provider certification is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_instrument_status_provider_certification_no_delete
BEFORE DELETE ON rd_replay_instrument_status_provider_certification
BEGIN
  SELECT RAISE(ABORT, 'Replay provider certification is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_instrument_status_provider_certification_termination (
  termination_id TEXT PRIMARY KEY,
  termination_ref TEXT NOT NULL UNIQUE,
  termination_hash TEXT NOT NULL UNIQUE,
  certification_hash TEXT NOT NULL UNIQUE,
  termination_type TEXT NOT NULL CHECK(termination_type IN ('revoked', 'superseded')),
  recorded_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  termination_policy_version TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN (
    'provider_build_rotation', 'normalization_policy_rotation', 'capability_rotation',
    'certification_error', 'determinism_regression', 'security_incident', 'provider_retired'
  )),
  successor_certification_hash TEXT,
  termination_json TEXT NOT NULL CHECK(json_valid(termination_json)),
  CHECK(julianday(recorded_at) <= julianday(effective_at)),
  CHECK(
    (termination_type = 'revoked' AND successor_certification_hash IS NULL) OR
    (termination_type = 'superseded' AND successor_certification_hash IS NOT NULL
      AND successor_certification_hash != certification_hash)
  ),
  FOREIGN KEY (certification_hash)
    REFERENCES rd_replay_instrument_status_provider_certification(certification_hash),
  FOREIGN KEY (successor_certification_hash)
    REFERENCES rd_replay_instrument_status_provider_certification(certification_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_instrument_status_provider_certification_termination_no_update
BEFORE UPDATE ON rd_replay_instrument_status_provider_certification_termination
BEGIN
  SELECT RAISE(ABORT, 'Replay provider certification termination is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_instrument_status_provider_certification_termination_no_delete
BEFORE DELETE ON rd_replay_instrument_status_provider_certification_termination
BEGIN
  SELECT RAISE(ABORT, 'Replay provider certification termination is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_aggregate_trade_provider_certification (
  certification_id TEXT PRIMARY KEY,
  certification_ref TEXT NOT NULL UNIQUE,
  certification_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'certified'),
  certified_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  certifier_id TEXT NOT NULL,
  certification_policy_version TEXT NOT NULL,
  provider_capability_hash TEXT NOT NULL,
  producer_domain TEXT NOT NULL CHECK(producer_domain = 'market-data-products'),
  producer_id TEXT NOT NULL CHECK(producer_id = 'market-data.aggregate-trade-provider'),
  producer_version TEXT NOT NULL,
  producer_build_hash TEXT NOT NULL,
  provider_policy_hash TEXT NOT NULL,
  accepted_archive_schema TEXT NOT NULL CHECK(accepted_archive_schema = 'trade.market-data-aggregate-trade-archive.v1'),
  emitted_event_schema TEXT NOT NULL CHECK(emitted_event_schema = 'trade.rd-replay-aggregate-trade-event.v1'),
  emitted_attestation_schema TEXT NOT NULL CHECK(emitted_attestation_schema = 'trade.rd-replay-aggregate-trade-coverage-attestation.v1'),
  allowed_source_kind TEXT NOT NULL CHECK(allowed_source_kind = 'venue_aggregate_trade_archive'),
  allowed_external_completeness TEXT NOT NULL CHECK(allowed_external_completeness = 'not_verified'),
  certification_json TEXT NOT NULL CHECK(json_valid(certification_json)),
  CHECK(certified_at < valid_until)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_provider_certification_no_update
BEFORE UPDATE ON rd_replay_aggregate_trade_provider_certification
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade provider certification is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_provider_certification_no_delete
BEFORE DELETE ON rd_replay_aggregate_trade_provider_certification
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade provider certification is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_aggregate_trade_provider_certification_termination (
  termination_id TEXT PRIMARY KEY,
  termination_ref TEXT NOT NULL UNIQUE,
  termination_hash TEXT NOT NULL UNIQUE,
  certification_hash TEXT NOT NULL UNIQUE,
  termination_type TEXT NOT NULL CHECK(termination_type IN ('revoked', 'superseded')),
  recorded_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  termination_policy_version TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN (
    'provider_build_rotation', 'normalization_policy_rotation', 'capability_rotation',
    'certification_error', 'determinism_regression', 'security_incident', 'provider_retired'
  )),
  successor_certification_hash TEXT,
  termination_json TEXT NOT NULL CHECK(json_valid(termination_json)),
  CHECK(julianday(recorded_at) <= julianday(effective_at)),
  CHECK(
    (termination_type = 'revoked' AND successor_certification_hash IS NULL) OR
    (termination_type = 'superseded' AND successor_certification_hash IS NOT NULL
      AND successor_certification_hash != certification_hash)
  ),
  FOREIGN KEY (certification_hash)
    REFERENCES rd_replay_aggregate_trade_provider_certification(certification_hash),
  FOREIGN KEY (successor_certification_hash)
    REFERENCES rd_replay_aggregate_trade_provider_certification(certification_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_provider_certification_termination_no_update
BEFORE UPDATE ON rd_replay_aggregate_trade_provider_certification_termination
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade provider certification termination is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_provider_certification_termination_no_delete
BEFORE DELETE ON rd_replay_aggregate_trade_provider_certification_termination
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade provider certification termination is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_aggregate_trade_evidence_admission (
  admission_id TEXT PRIMARY KEY,
  admission_ref TEXT NOT NULL UNIQUE,
  admission_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'admitted'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  admission_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  provider_capability_hash TEXT NOT NULL,
  provider_certification_hash TEXT NOT NULL,
  archive_id TEXT NOT NULL,
  archive_hash TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  coverage_attestation_hash TEXT NOT NULL,
  coverage_start TEXT NOT NULL,
  coverage_end TEXT NOT NULL,
  external_completeness TEXT NOT NULL CHECK(external_completeness = 'not_verified'),
  scope TEXT NOT NULL CHECK(scope = 'pre_integration_exact_price_path_only'),
  admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
  CHECK(coverage_start < coverage_end),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (provider_certification_hash)
    REFERENCES rd_replay_aggregate_trade_provider_certification(certification_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_evidence_admission_no_update
BEFORE UPDATE ON rd_replay_aggregate_trade_evidence_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade evidence admission is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_aggregate_trade_evidence_admission_no_delete
BEFORE DELETE ON rd_replay_aggregate_trade_evidence_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay aggregate trade evidence admission is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_cross_source_ordering_admission (
  admission_id TEXT PRIMARY KEY,
  admission_ref TEXT NOT NULL UNIQUE,
  admission_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'admitted'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  admission_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  aggregate_trade_evidence_admission_ref TEXT NOT NULL,
  aggregate_trade_evidence_admission_hash TEXT NOT NULL UNIQUE,
  aggregate_trade_coverage_attestation_hash TEXT NOT NULL,
  ordering_attestation_id TEXT NOT NULL,
  ordering_attestation_hash TEXT NOT NULL UNIQUE,
  ordering_resolution TEXT NOT NULL CHECK(ordering_resolution IN ('exact_by_declared_timestamps', 'resolution_limited')),
  ambiguity_group_count INTEGER NOT NULL CHECK(ambiguity_group_count >= 0),
  dataset_manifest_ref TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  instrument_status_schedule_hash TEXT NOT NULL,
  instrument_status_provenance_hash TEXT NOT NULL,
  instrument_status_events_hash TEXT NOT NULL,
  funding_events_hash TEXT NOT NULL,
  aggregate_trade_events_hash TEXT NOT NULL,
  ohlcv_bars_hash TEXT NOT NULL,
  source_collections_hash TEXT NOT NULL,
  ordered_events_hash TEXT NOT NULL,
  ambiguity_groups_hash TEXT NOT NULL,
  limitations_hash TEXT NOT NULL,
  external_completeness TEXT NOT NULL CHECK(external_completeness = 'not_verified'),
  scope TEXT NOT NULL CHECK(scope = 'pre_integration_cross_source_ordering_only'),
  economic_authority TEXT NOT NULL CHECK(economic_authority = 'none'),
  admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (aggregate_trade_evidence_admission_hash)
    REFERENCES rd_replay_aggregate_trade_evidence_admission(admission_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_cross_source_ordering_admission_no_update
BEFORE UPDATE ON rd_replay_cross_source_ordering_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay cross-source ordering admission is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_cross_source_ordering_admission_no_delete
BEFORE DELETE ON rd_replay_cross_source_ordering_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay cross-source ordering admission is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_bar_linked_aggregate_trade_path_authority (
  authority_snapshot_id TEXT PRIMARY KEY,
  authority_snapshot_ref TEXT NOT NULL UNIQUE,
  authority_snapshot_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'authorized'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  authority_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL UNIQUE,
  entry_order_hash TEXT NOT NULL,
  dataset_manifest_ref TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  aggregate_trade_evidence_admission_hash TEXT NOT NULL UNIQUE,
  cross_source_ordering_admission_hash TEXT NOT NULL UNIQUE,
  bar_link_attestation_id TEXT NOT NULL UNIQUE,
  bar_link_attestation_hash TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  window_start_inclusive TEXT NOT NULL,
  window_end_exclusive TEXT NOT NULL,
  latest_component_available_at TEXT NOT NULL,
  kline_record_hash TEXT NOT NULL,
  replay_market_bar_hash TEXT NOT NULL,
  aggregate_trade_coverage_attestation_hash TEXT NOT NULL,
  aggregate_trade_events_hash TEXT NOT NULL,
  consumer_capability TEXT NOT NULL
    CHECK(consumer_capability = 'bounded_initial_stop_market_same_bar_post_entry_protection_ordering'),
  path_resolution_authority TEXT NOT NULL
    CHECK(path_resolution_authority = 'authorized_for_bound_request_and_bar'),
  external_completeness TEXT NOT NULL CHECK(external_completeness = 'not_verified'),
  runner_compatibility TEXT NOT NULL CHECK(runner_compatibility = 'not_bound'),
  activation TEXT NOT NULL CHECK(activation = 'forbidden_until_exact_request_runner_consumer'),
  limitations_hash TEXT NOT NULL,
  authority_json TEXT NOT NULL CHECK(json_valid(authority_json)),
  CHECK(window_start_inclusive < window_end_exclusive),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (aggregate_trade_evidence_admission_hash)
    REFERENCES rd_replay_aggregate_trade_evidence_admission(admission_hash),
  FOREIGN KEY (cross_source_ordering_admission_hash)
    REFERENCES rd_replay_cross_source_ordering_admission(admission_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_bar_linked_aggregate_trade_path_authority_no_update
BEFORE UPDATE ON rd_replay_bar_linked_aggregate_trade_path_authority
BEGIN
  SELECT RAISE(ABORT, 'Replay bar-linked aggregate-trade path authority is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_bar_linked_aggregate_trade_path_authority_no_delete
BEFORE DELETE ON rd_replay_bar_linked_aggregate_trade_path_authority
BEGIN
  SELECT RAISE(ABORT, 'Replay bar-linked aggregate-trade path authority is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_l2_experiment_attachment_authority (
  authority_snapshot_id TEXT PRIMARY KEY,
  authority_snapshot_ref TEXT NOT NULL UNIQUE,
  authority_snapshot_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'authorized'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  authority_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL UNIQUE,
  dataset_manifest_id TEXT NOT NULL,
  dataset_manifest_ref TEXT NOT NULL,
  dataset_data_hash TEXT NOT NULL,
  dataset_manifest_hash TEXT NOT NULL,
  venue_id TEXT NOT NULL CHECK(venue_id = 'binance-usdm'),
  symbol TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  compaction_id TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  stream_epoch TEXT NOT NULL,
  source_row_count INTEGER NOT NULL CHECK(source_row_count > 0),
  source_parquet_hash TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  batch_hash TEXT NOT NULL UNIQUE,
  batch_rows_hash TEXT NOT NULL,
  batch_offset INTEGER NOT NULL CHECK(batch_offset >= 0),
  batch_row_count INTEGER NOT NULL CHECK(batch_row_count > 0),
  batch_next_offset INTEGER NOT NULL,
  frame_start_inclusive INTEGER NOT NULL,
  frame_end_exclusive INTEGER NOT NULL,
  batch_exhausted INTEGER NOT NULL CHECK(batch_exhausted IN (0, 1)),
  attachment_scope TEXT NOT NULL
    CHECK(attachment_scope = 'one_exact_validated_batch_within_one_compacted_epoch'),
  economic_authority TEXT NOT NULL CHECK(economic_authority = 'none'),
  runner_compatibility TEXT NOT NULL CHECK(runner_compatibility = 'not_bound'),
  external_completeness TEXT NOT NULL CHECK(external_completeness = 'not_verified'),
  limitations_hash TEXT NOT NULL,
  authority_json TEXT NOT NULL CHECK(json_valid(authority_json)),
  CHECK(batch_next_offset = batch_offset + batch_row_count),
  CHECK(batch_next_offset <= source_row_count),
  CHECK(frame_start_inclusive = batch_offset + 1),
  CHECK(frame_end_exclusive = batch_next_offset + 1),
  CHECK(batch_exhausted = (batch_next_offset = source_row_count)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_l2_experiment_attachment_authority_no_update
BEFORE UPDATE ON rd_replay_l2_experiment_attachment_authority
BEGIN
  SELECT RAISE(ABORT, 'Replay L2 experiment attachment authority is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_l2_experiment_attachment_authority_no_delete
BEFORE DELETE ON rd_replay_l2_experiment_attachment_authority
BEGIN
  SELECT RAISE(ABORT, 'Replay L2 experiment attachment authority is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_decision_observation_bundle_admission (
  admission_id TEXT PRIMARY KEY,
  admission_ref TEXT NOT NULL UNIQUE,
  admission_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'admitted'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  admission_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL UNIQUE,
  dataset_manifest_ref TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  ordering_admission_ref TEXT NOT NULL,
  ordering_admission_hash TEXT NOT NULL UNIQUE,
  wire_manifest_id TEXT NOT NULL,
  wire_manifest_hash TEXT NOT NULL UNIQUE,
  decision_schedule_hash TEXT NOT NULL,
  bundle_id TEXT NOT NULL UNIQUE,
  bundle_hash TEXT NOT NULL UNIQUE,
  binding_set_hash TEXT NOT NULL,
  projection_count INTEGER NOT NULL CHECK(projection_count > 0),
  projections_hash TEXT NOT NULL,
  observation_values_hashes_hash TEXT NOT NULL,
  consumer_capability TEXT NOT NULL CHECK(consumer_capability = 'non_economic_decision_observation_audit'),
  scope TEXT NOT NULL CHECK(scope = 'pre_integration_non_economic_observation_audit_only'),
  harness_invocation TEXT NOT NULL CHECK(harness_invocation = 'forbidden'),
  economic_authority TEXT NOT NULL CHECK(economic_authority = 'none'),
  admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (ordering_admission_hash)
    REFERENCES rd_replay_cross_source_ordering_admission(admission_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_decision_observation_bundle_admission_no_update
BEFORE UPDATE ON rd_replay_decision_observation_bundle_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay decision observation bundle admission is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_decision_observation_bundle_admission_no_delete
BEFORE DELETE ON rd_replay_decision_observation_bundle_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay decision observation bundle admission is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_decision_observation_bundle_derivation_admission (
  admission_id TEXT PRIMARY KEY,
  admission_ref TEXT NOT NULL UNIQUE,
  admission_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'admitted'),
  issued_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  admission_policy_version TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL UNIQUE,
  dataset_manifest_ref TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  bundle_admission_ref TEXT NOT NULL UNIQUE,
  bundle_admission_hash TEXT NOT NULL UNIQUE,
  ordering_admission_hash TEXT NOT NULL,
  wire_manifest_id TEXT NOT NULL,
  wire_manifest_hash TEXT NOT NULL,
  decision_schedule_hash TEXT NOT NULL,
  bundle_id TEXT NOT NULL UNIQUE,
  bundle_hash TEXT NOT NULL UNIQUE,
  binding_set_id TEXT NOT NULL,
  binding_set_hash TEXT NOT NULL,
  derivation_attestation_id TEXT NOT NULL UNIQUE,
  derivation_attestation_hash TEXT NOT NULL UNIQUE,
  boundary_count INTEGER NOT NULL CHECK(boundary_count > 0),
  boundaries_hash TEXT NOT NULL,
  consumer_capability TEXT NOT NULL CHECK(consumer_capability = 'non_economic_decision_observation_derivation_audit'),
  scope TEXT NOT NULL CHECK(scope = 'pre_integration_non_economic_derivation_admission_only'),
  control_plane_parent_replay TEXT NOT NULL CHECK(control_plane_parent_replay = 'not_performed'),
  harness_invocation TEXT NOT NULL CHECK(harness_invocation = 'forbidden'),
  economic_authority TEXT NOT NULL CHECK(economic_authority = 'none'),
  admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (bundle_admission_hash)
    REFERENCES rd_replay_decision_observation_bundle_admission(admission_hash)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_decision_observation_bundle_derivation_admission_no_update
BEFORE UPDATE ON rd_replay_decision_observation_bundle_derivation_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay decision observation bundle derivation admission is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_decision_observation_bundle_derivation_admission_no_delete
BEFORE DELETE ON rd_replay_decision_observation_bundle_derivation_admission
BEGIN
  SELECT RAISE(ABORT, 'Replay decision observation bundle derivation admission is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_reservation_cancellation (
  cancellation_id TEXT PRIMARY KEY,
  cancellation_ref TEXT NOT NULL UNIQUE,
  cancellation_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'cancelled'),
  recorded_at TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  cancellation_policy_version TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN (
    'provider_certification_incident', 'data_integrity_incident',
    'harness_security_incident', 'policy_withdrawal', 'operator_emergency_stop'
  )),
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK(scope = 'future_attempt_claims'),
  cancellation_json TEXT NOT NULL CHECK(json_valid(cancellation_json)),
  CHECK(julianday(recorded_at) <= julianday(effective_at)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_reservation_cancellation_no_update
BEFORE UPDATE ON rd_replay_reservation_cancellation
BEGIN
  SELECT RAISE(ABORT, 'Replay Reservation cancellation is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_reservation_cancellation_no_delete
BEFORE DELETE ON rd_replay_reservation_cancellation
BEGIN
  SELECT RAISE(ABORT, 'Replay Reservation cancellation is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_attempt (
  attempt_id TEXT PRIMARY KEY,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  finalized_at TEXT,
  result_hash TEXT,
  artifact_ref TEXT,
  artifact_hash TEXT,
  terminal_checkpoint_hash TEXT,
  diagnostic_checkpoint_ref TEXT,
  diagnostic_checkpoint_hash TEXT,
  failure_class TEXT CHECK(failure_class IN ('input_invalid', 'unsupported_contract', 'data_integrity', 'deterministic_engine', 'resource', 'external_io')),
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE (trial_id, attempt_ordinal),
  CHECK(claimed_at <= heartbeat_at AND heartbeat_at < lease_expires_at),
  CHECK(
    (status IN ('claimed', 'running') AND finalized_at IS NULL AND result_hash IS NULL AND artifact_ref IS NULL AND artifact_hash IS NULL AND terminal_checkpoint_hash IS NULL AND failure_class IS NULL) OR
    (status = 'completed' AND finalized_at IS NOT NULL AND result_hash IS NOT NULL AND artifact_ref IS NOT NULL AND artifact_hash IS NOT NULL AND terminal_checkpoint_hash IS NOT NULL AND failure_class IS NULL) OR
    (status IN ('failed', 'cancelled', 'expired') AND finalized_at IS NOT NULL AND result_hash IS NULL AND artifact_ref IS NULL AND artifact_hash IS NULL AND terminal_checkpoint_hash IS NULL AND failure_class IS NOT NULL)
  ),
  CHECK(
    (diagnostic_checkpoint_ref IS NULL AND diagnostic_checkpoint_hash IS NULL) OR
    (diagnostic_checkpoint_ref IS NOT NULL AND diagnostic_checkpoint_hash IS NOT NULL)
  ),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_replay_attempt_per_trial
ON rd_replay_attempt(trial_id)
WHERE status IN ('claimed', 'running');

CREATE TABLE IF NOT EXISTS rd_replay_attempt_cancellation (
  cancellation_id TEXT PRIMARY KEY,
  cancellation_ref TEXT NOT NULL UNIQUE,
  cancellation_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'cancelled'),
  recorded_at TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  cancellation_policy_version TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN (
    'provider_certification_incident', 'data_integrity_incident',
    'harness_security_incident', 'policy_withdrawal', 'operator_emergency_stop'
  )),
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  target_lease_generation INTEGER NOT NULL CHECK(target_lease_generation >= 1),
  scope TEXT NOT NULL CHECK(scope = 'active_attempt'),
  cancellation_json TEXT NOT NULL CHECK(json_valid(cancellation_json)),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_cancellation_no_update
BEFORE UPDATE ON rd_replay_attempt_cancellation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt cancellation is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_cancellation_no_delete
BEFORE DELETE ON rd_replay_attempt_cancellation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt cancellation is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_attempt_cancellation_observation (
  observation_id TEXT PRIMARY KEY,
  observation_ref TEXT NOT NULL UNIQUE,
  observation_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status = 'observed'),
  observed_at TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  cancellation_id TEXT NOT NULL UNIQUE,
  cancellation_ref TEXT NOT NULL UNIQUE,
  cancellation_hash TEXT NOT NULL UNIQUE,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  target_lease_generation INTEGER NOT NULL CHECK(target_lease_generation >= 1),
  outcome_schema_version TEXT NOT NULL CHECK(outcome_schema_version = 'trade.rd-replay-run-outcome.v35'),
  outcome_status TEXT NOT NULL CHECK(outcome_status = 'cancelled'),
  outcome_failure_code TEXT NOT NULL CHECK(outcome_failure_code = 'execution-cancelled-at-checkpoint'),
  partial_result_published INTEGER NOT NULL CHECK(partial_result_published = 0),
  observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
  CHECK(julianday(observed_at) <= julianday(registered_at)),
  FOREIGN KEY (cancellation_id) REFERENCES rd_replay_attempt_cancellation(cancellation_id),
  FOREIGN KEY (attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_cancellation_observation_no_update
BEFORE UPDATE ON rd_replay_attempt_cancellation_observation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt cancellation observation is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_cancellation_observation_no_delete
BEFORE DELETE ON rd_replay_attempt_cancellation_observation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt cancellation observation is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_attempt_lease_observation (
  observation_id TEXT PRIMARY KEY,
  observation_ref TEXT NOT NULL UNIQUE,
  observation_hash TEXT NOT NULL UNIQUE,
  observation_policy_version TEXT NOT NULL CHECK(observation_policy_version = 'rd-replay-attempt-lease-observation-v1'),
  status TEXT NOT NULL CHECK(status = 'active_lease_observed'),
  observed_at TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  authority_owner TEXT NOT NULL CHECK(authority_owner = 'research_control_plane'),
  authority_source TEXT NOT NULL CHECK(authority_source = 'research_control_plane_state_store'),
  read_consistency TEXT NOT NULL CHECK(read_consistency = 'single_control_plane_transaction'),
  clock_evidence TEXT NOT NULL CHECK(clock_evidence = 'caller_supplied_utc_not_external_time_attestation'),
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
  attempt_lease_hash TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
  CHECK(julianday(observed_at) <= julianday(registered_at)),
  UNIQUE (attempt_id, lease_generation, observed_at),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_lease_observation_no_update
BEFORE UPDATE ON rd_replay_attempt_lease_observation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt Lease observation is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_attempt_lease_observation_no_delete
BEFORE DELETE ON rd_replay_attempt_lease_observation
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt Lease observation is immutable');
END;

CREATE TABLE IF NOT EXISTS rd_replay_successor_verification_lease_renewal (
  receipt_id TEXT PRIMARY KEY,
  receipt_ref TEXT NOT NULL UNIQUE,
  receipt_hash TEXT NOT NULL UNIQUE,
  receipt_policy_version TEXT NOT NULL CHECK(
    receipt_policy_version = 'rd-replay-successor-verification-lease-renewal-receipt-v1'
  ),
  status TEXT NOT NULL CHECK(status = 'successor_verification_lease_renewed'),
  source_request_id TEXT NOT NULL UNIQUE,
  source_request_key TEXT NOT NULL UNIQUE,
  source_request_hash TEXT NOT NULL UNIQUE,
  source_successor_authority_contract_hash TEXT NOT NULL UNIQUE,
  source_reproducibility_pair_contract_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  predecessor_lease_generation INTEGER NOT NULL CHECK(predecessor_lease_generation >= 1),
  predecessor_attempt_lease_hash TEXT NOT NULL,
  successor_lease_generation INTEGER NOT NULL CHECK(successor_lease_generation >= 2),
  successor_attempt_lease_hash TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  CHECK(successor_lease_generation = predecessor_lease_generation + 1),
  CHECK(julianday(renewed_at) < julianday(lease_expires_at)),
  FOREIGN KEY (attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);

CREATE TRIGGER IF NOT EXISTS rd_replay_successor_verification_lease_renewal_no_update
BEFORE UPDATE ON rd_replay_successor_verification_lease_renewal
BEGIN
  SELECT RAISE(ABORT, 'Replay successor verification Lease renewal Receipt is immutable');
END;

CREATE TRIGGER IF NOT EXISTS rd_replay_successor_verification_lease_renewal_no_delete
BEFORE DELETE ON rd_replay_successor_verification_lease_renewal
BEGIN
  SELECT RAISE(ABORT, 'Replay successor verification Lease renewal Receipt is immutable');
END;


CREATE TABLE IF NOT EXISTS rd_replay_checkpoint_receipt (
  receipt_id TEXT PRIMARY KEY,
  receipt_ref TEXT NOT NULL UNIQUE,
  receipt_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal >= 1),
  worker_id TEXT NOT NULL,
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
  attempt_lease_hash TEXT NOT NULL,
  diagnostic_checkpoint_ref TEXT NOT NULL,
  diagnostic_checkpoint_hash TEXT NOT NULL,
  engine_checkpoint_ref TEXT NOT NULL,
  engine_checkpoint_payload_hash TEXT NOT NULL,
  engine_checkpoint_hash TEXT NOT NULL,
  storage_policy_version TEXT NOT NULL,
  next_source_offset INTEGER NOT NULL CHECK(next_source_offset >= 1),
  UNIQUE (attempt_id, next_source_offset),
  UNIQUE (diagnostic_checkpoint_ref, diagnostic_checkpoint_hash),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);


CREATE TABLE IF NOT EXISTS rd_replay_resume_authorization (
  authorization_id TEXT PRIMARY KEY,
  authorization_ref TEXT NOT NULL UNIQUE,
  authorization_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  trial_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  reservation_ref TEXT NOT NULL,
  reservation_hash TEXT NOT NULL,
  source_attempt_id TEXT NOT NULL,
  source_attempt_ordinal INTEGER NOT NULL CHECK(source_attempt_ordinal >= 1),
  source_attempt_status TEXT NOT NULL CHECK(source_attempt_status IN ('cancelled', 'expired')),
  diagnostic_checkpoint_ref TEXT NOT NULL,
  diagnostic_checkpoint_hash TEXT NOT NULL,
  target_attempt_id TEXT NOT NULL UNIQUE,
  target_attempt_ordinal INTEGER NOT NULL CHECK(target_attempt_ordinal >= 1),
  target_worker_id TEXT NOT NULL,
  target_claimed_at TEXT NOT NULL,
  target_lease_generation_floor INTEGER NOT NULL CHECK(target_lease_generation_floor >= 1),
  target_attempt_lease_hash TEXT NOT NULL,
  CHECK(source_attempt_id != target_attempt_id),
  CHECK(target_attempt_ordinal > source_attempt_ordinal),
  FOREIGN KEY (trial_id) REFERENCES rd_trial(trial_id),
  FOREIGN KEY (source_attempt_id) REFERENCES rd_replay_attempt(attempt_id),
  FOREIGN KEY (target_attempt_id) REFERENCES rd_replay_attempt(attempt_id)
);


CREATE TABLE IF NOT EXISTS rd_experiment_result (
  result_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  result_scope TEXT NOT NULL CHECK(result_scope IN ('trial', 'experiment', 'trial_group')),
  trial_id TEXT,
  trial_group_id TEXT,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  stage_id TEXT NOT NULL,
  result_type_id TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  evidence_fingerprint_json TEXT NOT NULL CHECK(json_valid(evidence_fingerprint_json)),
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
  created_at TEXT NOT NULL,
  CHECK(stage_id != '__any__'),
  CHECK(
    (result_scope = 'trial' AND trial_id IS NOT NULL AND trial_group_id IS NOT NULL) OR
    (result_scope = 'experiment' AND trial_id IS NULL AND trial_group_id IS NULL) OR
    (result_scope = 'trial_group' AND trial_id IS NULL AND trial_group_id IS NOT NULL)
  ),
  UNIQUE (result_id, experiment_id),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (trial_id, experiment_id, trial_group_id)
    REFERENCES rd_trial(trial_id, experiment_id, trial_group_id),
  FOREIGN KEY (trial_group_id, experiment_id)
    REFERENCES rd_experiment_contract(trial_group_id, experiment_id),
  FOREIGN KEY (stage_id) REFERENCES rd_result_stage(stage_id),
  FOREIGN KEY (result_type_id) REFERENCES rd_result_type(result_type_id)
);

CREATE TABLE IF NOT EXISTS rd_review_decision (
  decision_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  reviewer_run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  transition_rule_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN (
    'reject', 'modify', 'accept_for_draft',
    'accept_for_forward', 'accept_for_shadow_candidate'
  )),
  observed_current_state TEXT NOT NULL,
  applied_next_state TEXT NOT NULL,
  rationale_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(stage_id != '__any__'),
  UNIQUE (decision_id, experiment_id),
  UNIQUE (experiment_id, stage_id, reviewer_run_id),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (stage_id) REFERENCES rd_result_stage(stage_id),
  FOREIGN KEY (transition_rule_id) REFERENCES rd_lifecycle_transition_rule(rule_id)
);

CREATE TABLE IF NOT EXISTS rd_review_decision_result (
  decision_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN (
    'primary', 'supporting', 'negative_control', 'cost', 'stability', 'holdout'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY (decision_id, result_id),
  FOREIGN KEY (decision_id, experiment_id)
    REFERENCES rd_review_decision(decision_id, experiment_id),
  FOREIGN KEY (result_id, experiment_id)
    REFERENCES rd_experiment_result(result_id, experiment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_review_decision_primary_result
ON rd_review_decision_result(decision_id)
WHERE evidence_role = 'primary';

CREATE TABLE IF NOT EXISTS rd_experiment_blocker (
  blocker_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL CHECK(blocker_type IN (
    'external_data', 'external_tool', 'capacity', 'governance'
  )),
  detail_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
  close_reason TEXT CHECK(close_reason IN ('resolved', 'superseded', 'experiment_closed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK(
    (status = 'open' AND closed_at IS NULL AND close_reason IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL AND close_reason IS NOT NULL)
  ),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id)
);

CREATE TABLE IF NOT EXISTS rd_lifecycle_event (
  event_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  transition_rule_id TEXT NOT NULL,
  trigger_ref TEXT NOT NULL,
  current_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, sequence_no),
  FOREIGN KEY (experiment_id) REFERENCES rd_experiment_contract(experiment_id),
  FOREIGN KEY (transition_rule_id) REFERENCES rd_lifecycle_transition_rule(rule_id)
);

CREATE TABLE IF NOT EXISTS rd_knowledge_node (
  kg_node_id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  ref_id TEXT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (node_type, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rd_knowledge_node_ref
ON rd_knowledge_node(node_type, ref_id)
WHERE ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rd_knowledge_edge (
  edge_id TEXT PRIMARY KEY,
  from_kg_node_id TEXT NOT NULL,
  to_kg_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (from_kg_node_id, to_kg_node_id, edge_type),
  FOREIGN KEY (from_kg_node_id) REFERENCES rd_knowledge_node(kg_node_id),
  FOREIGN KEY (to_kg_node_id) REFERENCES rd_knowledge_node(kg_node_id)
);

CREATE TABLE IF NOT EXISTS rd_knowledge_edge_evidence (
  edge_evidence_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_strength REAL CHECK(
    evidence_strength IS NULL OR
    (evidence_strength >= 0 AND evidence_strength <= 1)
  ),
  scoring_policy_ref TEXT,
  observed_at TEXT NOT NULL,
  supersedes_edge_evidence_id TEXT,
  supersedes_edge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (edge_evidence_id, edge_id),
  FOREIGN KEY (edge_id) REFERENCES rd_knowledge_edge(edge_id),
  FOREIGN KEY (supersedes_edge_evidence_id, supersedes_edge_id)
    REFERENCES rd_knowledge_edge_evidence(edge_evidence_id, edge_id),
  CHECK(
    (supersedes_edge_evidence_id IS NULL AND supersedes_edge_id IS NULL) OR
    (supersedes_edge_evidence_id IS NOT NULL AND supersedes_edge_id IS NOT NULL AND
     supersedes_edge_id = edge_id)
  ),
  CHECK(
    supersedes_edge_evidence_id IS NULL OR
    supersedes_edge_evidence_id != edge_evidence_id
  ),
  CHECK(evidence_strength IS NULL OR scoring_policy_ref IS NOT NULL)
);

CREATE TRIGGER IF NOT EXISTS prevent_proposal_rematerialization
BEFORE UPDATE OF materialized_revision, materialization_ref, materialized_at
ON rd_proposal
WHEN OLD.materialized_revision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'proposal is already materialized');
END;

CREATE TRIGGER IF NOT EXISTS prevent_proposal_identity_mutation
BEFORE UPDATE OF planner_run_id, proposal_kind, created_at
ON rd_proposal
BEGIN
  SELECT RAISE(ABORT, 'proposal identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS validate_experiment_registration_insert
BEFORE INSERT ON rd_experiment_contract
WHEN NEW.lifecycle_state != 'proposed'
  OR NEW.lifecycle_version != 0
  OR NEW.last_lifecycle_event_id IS NOT NULL
  OR NEW.selected_candidate_id IS NOT NULL
  OR NEW.selected_trial_id IS NOT NULL
  OR NEW.candidate_hash IS NOT NULL
  OR NEW.candidate_frozen_at IS NOT NULL
  OR NEW.suspended_from_state IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid initial experiment projection');
END;

CREATE TRIGGER IF NOT EXISTS prevent_registered_contract_identity_mutation
BEFORE UPDATE OF proposal_id, proposal_revision, canonical_node_id, hypothesis_id,
  code_family_id, trial_group_id, trial_group_hash, parent_experiment_id,
  contract_hash, identity_hash_policy_version,
  contract_validator_version, lifecycle_rule_version, scope_policy_version,
  registered_at, contract_json
ON rd_experiment_contract
BEGIN
  SELECT RAISE(ABORT, 'registered contract identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_candidate_refreeze
BEFORE UPDATE OF selected_candidate_id, selected_trial_id,
  candidate_hash, candidate_frozen_at
ON rd_experiment_contract
WHEN OLD.candidate_hash IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'frozen candidate identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS restrict_candidate_first_freeze
BEFORE UPDATE OF selected_candidate_id, selected_trial_id,
  candidate_hash, candidate_frozen_at
ON rd_experiment_contract
WHEN OLD.candidate_hash IS NULL
  AND NEW.candidate_hash IS NOT NULL
  AND NEW.lifecycle_state != 'draft_frozen'
BEGIN
  SELECT RAISE(ABORT, 'candidate may only freeze with draft_frozen transition');
END;

CREATE TRIGGER IF NOT EXISTS require_candidate_before_draft_frozen
BEFORE UPDATE OF lifecycle_state
ON rd_experiment_contract
WHEN NEW.lifecycle_state = 'draft_frozen' AND (
  NEW.selected_candidate_id IS NULL OR NEW.selected_trial_id IS NULL OR
  NEW.candidate_hash IS NULL OR NEW.candidate_frozen_at IS NULL OR
  NOT EXISTS (
    SELECT 1 FROM rd_trial t
    WHERE t.trial_id = NEW.selected_trial_id
      AND t.experiment_id = NEW.experiment_id
      AND t.candidate_id = NEW.selected_candidate_id
      AND t.candidate_identity_hash = NEW.candidate_hash
      AND t.status = 'completed'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'draft_frozen requires selected candidate and trial');
END;

CREATE TRIGGER IF NOT EXISTS require_lifecycle_projection_event
BEFORE UPDATE OF lifecycle_state, lifecycle_version, last_lifecycle_event_id
ON rd_experiment_contract
WHEN NEW.lifecycle_state != OLD.lifecycle_state
  OR NEW.lifecycle_version != OLD.lifecycle_version
  OR NEW.last_lifecycle_event_id IS NOT OLD.last_lifecycle_event_id
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM rd_lifecycle_event e
    WHERE e.event_id = NEW.last_lifecycle_event_id
      AND e.experiment_id = NEW.experiment_id
      AND e.sequence_no = NEW.lifecycle_version
      AND e.next_state = NEW.lifecycle_state
      AND NOT EXISTS (
        SELECT 1 FROM rd_lifecycle_event newer
        WHERE newer.experiment_id = NEW.experiment_id
          AND newer.sequence_no > e.sequence_no
      )
  ) THEN RAISE(ABORT, 'lifecycle projection requires the latest authoritative event') END;
END;

CREATE TRIGGER IF NOT EXISTS prevent_trial_group_definition_mutation
BEFORE UPDATE OF hypothesis_scope_ref, group_hash, candidate_mode,
  candidate_generator_ref, search_space_json, identity_hash_policy_version,
  selection_protocol_json, max_trials,
  trial_accounting_policy_version, registered_at
ON rd_trial_group
BEGIN
  SELECT RAISE(ABORT, 'registered trial group definition is immutable');
END;

CREATE TRIGGER IF NOT EXISTS restrict_trial_group_status_transition
BEFORE UPDATE OF status, sealed_at, closed_at
ON rd_trial_group
WHEN NOT (
  (OLD.status = 'registered' AND NEW.status = 'running'
    AND NEW.sealed_at IS NULL AND NEW.closed_at IS NULL) OR
  (OLD.status = 'running' AND NEW.status = 'sealed'
    AND NEW.sealed_at IS NOT NULL AND NEW.closed_at IS NULL) OR
  (OLD.status = 'sealed' AND NEW.status = 'closed'
    AND NEW.sealed_at = OLD.sealed_at AND NEW.closed_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Trial Group status transition');
END;

CREATE TRIGGER IF NOT EXISTS restrict_trial_group_candidate_insert
BEFORE INSERT ON rd_trial_group_candidate
WHEN NOT EXISTS (
  SELECT 1 FROM rd_trial_group g
  WHERE g.trial_group_id = NEW.trial_group_id
    AND (
      g.status = 'registered' OR
      (g.status = 'running' AND g.candidate_mode = 'generated_from_space')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'candidate cannot be added in current group state/mode');
END;

CREATE TRIGGER IF NOT EXISTS restrict_trial_reservation
BEFORE INSERT ON rd_trial
WHEN NEW.status != 'reserved'
  OR NEW.completed_at IS NOT NULL
  OR NOT EXISTS (
  SELECT 1 FROM rd_trial_group g
  WHERE g.trial_group_id = NEW.trial_group_id
    AND g.status = 'running'
    AND (
      SELECT COUNT(*) FROM rd_trial used
      WHERE used.trial_group_id = NEW.trial_group_id
        AND used.counts_against_budget = 1
    ) + NEW.counts_against_budget <= g.max_trials
)
BEGIN
  SELECT RAISE(ABORT, 'trial must be reserved in a running group with available budget');
END;

CREATE TRIGGER IF NOT EXISTS prevent_trial_identity_mutation
BEFORE UPDATE OF trial_group_id, experiment_id, trial_ordinal,
  candidate_id, candidate_identity_hash, identity_hash_policy_version,
  run_id, counts_against_budget, idempotency_key, created_at
ON rd_trial
BEGIN
  SELECT RAISE(ABORT, 'trial identity and accounting are immutable');
END;

CREATE TRIGGER IF NOT EXISTS restrict_trial_status_transition
BEFORE UPDATE OF status, completed_at
ON rd_trial
WHEN OLD.status != 'reserved'
  OR NEW.status NOT IN ('completed', 'failed', 'cancelled')
  OR NEW.completed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid trial status transition');
END;

CREATE TRIGGER IF NOT EXISTS prevent_replay_attempt_identity_mutation
BEFORE UPDATE OF trial_id, run_id, attempt_ordinal, worker_id, reservation_ref,
  reservation_hash, request_hash, claimed_at, idempotency_key
ON rd_replay_attempt
BEGIN
  SELECT RAISE(ABORT, 'Replay Attempt identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_terminal_replay_attempt_mutation
BEFORE UPDATE ON rd_replay_attempt
WHEN OLD.status IN ('completed', 'failed', 'cancelled', 'expired')
BEGIN
  SELECT RAISE(ABORT, 'terminal Replay Attempt is immutable');
END;

CREATE TRIGGER IF NOT EXISTS restrict_replay_attempt_status_transition
BEFORE UPDATE OF status ON rd_replay_attempt
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'claimed' AND NEW.status IN ('running', 'completed', 'failed', 'cancelled', 'expired')) OR
  (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled', 'expired'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid Replay Attempt status transition');
END;

CREATE TRIGGER IF NOT EXISTS restrict_replay_attempt_lease_renewal
BEFORE UPDATE OF lease_generation, heartbeat_at, lease_expires_at
ON rd_replay_attempt
WHEN NEW.lease_generation != OLD.lease_generation
  OR NEW.heartbeat_at != OLD.heartbeat_at
  OR NEW.lease_expires_at != OLD.lease_expires_at
BEGIN
  SELECT CASE WHEN OLD.status NOT IN ('claimed', 'running')
    OR NEW.lease_generation != OLD.lease_generation + 1
    OR NEW.heartbeat_at < OLD.heartbeat_at
    OR NEW.heartbeat_at >= OLD.lease_expires_at
    OR NEW.lease_expires_at <= OLD.lease_expires_at
  THEN RAISE(ABORT, 'invalid Replay Attempt lease renewal') END;
END;

CREATE TRIGGER IF NOT EXISTS prevent_contract_delete
BEFORE DELETE ON rd_experiment_contract
BEGIN SELECT RAISE(ABORT, 'registered contract cannot be deleted'); END;


CREATE TRIGGER IF NOT EXISTS prevent_replay_resume_authorization_update
BEFORE UPDATE ON rd_replay_resume_authorization
BEGIN
  SELECT RAISE(ABORT, 'Replay Resume Authorization is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_replay_resume_authorization_delete
BEFORE DELETE ON rd_replay_resume_authorization
BEGIN
  SELECT RAISE(ABORT, 'Replay Resume Authorization is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_replay_checkpoint_receipt_update
BEFORE UPDATE ON rd_replay_checkpoint_receipt
BEGIN
  SELECT RAISE(ABORT, 'Replay Checkpoint Receipt is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_replay_checkpoint_receipt_delete
BEFORE DELETE ON rd_replay_checkpoint_receipt
BEGIN
  SELECT RAISE(ABORT, 'Replay Checkpoint Receipt is immutable');
END;


CREATE TRIGGER IF NOT EXISTS prevent_trial_group_delete
BEFORE DELETE ON rd_trial_group
BEGIN SELECT RAISE(ABORT, 'registered trial group cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS prevent_proposal_revision_update
BEFORE UPDATE ON rd_proposal_revision
BEGIN SELECT RAISE(ABORT, 'proposal revision is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_proposal_revision_delete
BEFORE DELETE ON rd_proposal_revision
BEGIN SELECT RAISE(ABORT, 'proposal revision is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_trial_group_candidate_update
BEFORE UPDATE ON rd_trial_group_candidate
BEGIN SELECT RAISE(ABORT, 'trial group candidate is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_trial_group_candidate_delete
BEFORE DELETE ON rd_trial_group_candidate
BEGIN SELECT RAISE(ABORT, 'trial group candidate is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_experiment_result_update
BEFORE UPDATE ON rd_experiment_result
BEGIN SELECT RAISE(ABORT, 'experiment result is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_experiment_result_delete
BEFORE DELETE ON rd_experiment_result
BEGIN SELECT RAISE(ABORT, 'experiment result is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_review_decision_update
BEFORE UPDATE ON rd_review_decision
BEGIN SELECT RAISE(ABORT, 'review decision is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_review_decision_delete
BEFORE DELETE ON rd_review_decision
BEGIN SELECT RAISE(ABORT, 'review decision is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_review_decision_result_update
BEFORE UPDATE ON rd_review_decision_result
BEGIN SELECT RAISE(ABORT, 'decision evidence link is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_review_decision_result_delete
BEFORE DELETE ON rd_review_decision_result
BEGIN SELECT RAISE(ABORT, 'decision evidence link is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_lifecycle_event_update
BEFORE UPDATE ON rd_lifecycle_event
BEGIN SELECT RAISE(ABORT, 'lifecycle event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_lifecycle_event_delete
BEFORE DELETE ON rd_lifecycle_event
BEGIN SELECT RAISE(ABORT, 'lifecycle event is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_knowledge_evidence_update
BEFORE UPDATE ON rd_knowledge_edge_evidence
BEGIN SELECT RAISE(ABORT, 'knowledge evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS prevent_knowledge_evidence_delete
BEFORE DELETE ON rd_knowledge_edge_evidence
BEGIN SELECT RAISE(ABORT, 'knowledge evidence is append-only'); END;
`

const RESULT_STAGE_SEED: ReadonlyArray<readonly [string, number, number]> = [
  ["__any__", -1, 1],
  ["discovery", 10, 0],
  ["panel", 20, 0],
  ["negative_control", 30, 0],
  ["parameter_stability", 40, 0],
  ["cost_stress", 50, 0],
  ["historical_validation", 60, 0],
  ["forward_observation", 70, 0],
]

const RESULT_TYPE_SEED: ReadonlyArray<readonly [string, string]> = [
  ["replay", "Historical replay result"],
  ["panel", "Cross-asset panel result"],
  ["negative_control", "Negative-control result"],
  ["parameter_stability", "Parameter-stability result"],
  ["cost_stress", "Cost-stress result"],
  ["historical_validation", "Locked historical validation result"],
  ["forward_observation", "Post-freeze forward observation result"],
]

const LIFECYCLE_RULE_SEED: ReadonlyArray<readonly [string, string, string, string, string, string]> = [
  ["register", "__unregistered__", "system", "register", "proposed", "__any__"],
  ["start-discovery", "proposed", "system", "pre_run_gate_passed", "discovery", "__any__"],
  ["discovery-reject", "discovery", "reviewer", "reject", "rejected", "historical_validation"],
  ["discovery-modify", "discovery", "reviewer", "modify", "needs_modification", "historical_validation"],
  ["freeze-draft", "discovery", "reviewer", "accept_for_draft", "draft_frozen", "historical_validation"],
  ["start-forward", "draft_frozen", "reviewer", "accept_for_forward", "forward_observation", "historical_validation"],
  ["forward-reject", "forward_observation", "reviewer", "reject", "invalidated", "forward_observation"],
  ["forward-modify", "forward_observation", "reviewer", "modify", "needs_modification", "forward_observation"],
  ["shadow-candidate", "forward_observation", "reviewer", "accept_for_shadow_candidate", "shadow_candidate", "forward_observation"],
  ["block-proposed", "proposed", "blocker", "opened", "blocked", "__any__"],
  ["resume-proposed", "blocked", "blocker", "resolved", "proposed", "__any__"],
  ["contract-defect-proposed", "proposed", "system", "contract_defect", "needs_modification", "__any__"],
  ["contract-defect-discovery", "discovery", "system", "contract_defect", "needs_modification", "__any__"],
  ["suspend-proposed", "proposed", "system", "fingerprint_stale", "suspended", "__any__"],
  ["suspend-blocked", "blocked", "system", "fingerprint_stale", "suspended", "__any__"],
  ["suspend-discovery", "discovery", "system", "fingerprint_stale", "suspended", "__any__"],
  ["suspend-draft", "draft_frozen", "system", "fingerprint_stale", "suspended", "__any__"],
  ["suspend-forward", "forward_observation", "system", "fingerprint_stale", "suspended", "__any__"],
  ["resume-suspended-proposed", "suspended", "system", "resume_proposed", "proposed", "__any__"],
  ["resume-suspended-blocked", "suspended", "system", "resume_blocked", "blocked", "__any__"],
  ["resume-suspended-discovery", "suspended", "system", "resume_discovery", "discovery", "__any__"],
  ["resume-suspended-draft", "suspended", "system", "resume_draft_frozen", "draft_frozen", "__any__"],
  ["resume-suspended-forward", "suspended", "system", "resume_forward_observation", "forward_observation", "__any__"],
  ["supersede-proposed", "proposed", "governance", "child_registered", "superseded", "__any__"],
  ["supersede-blocked", "blocked", "governance", "child_registered", "superseded", "__any__"],
  ["supersede-discovery", "discovery", "governance", "child_registered", "superseded", "__any__"],
  ["supersede-draft", "draft_frozen", "governance", "child_registered", "superseded", "__any__"],
  ["supersede-forward", "forward_observation", "governance", "child_registered", "superseded", "__any__"],
  ["close-shadow-candidate", "shadow_candidate", "governance", "handoff_completed", "closed", "__any__"],
]

export function ensureResearchControlPlaneSchema(db: Database): void {
  db.exec(CONTROL_PLANE_SCHEMA_SQL)
  migrateReplayCheckpointReceiptStoragePolicy(db)
  seedResultStages(db)
  seedResultTypes(db)
  seedLifecycleRules(db)
  validateLifecycleRuleSeed(db)
}

function migrateReplayCheckpointReceiptStoragePolicy(db: Database): void {
  const columns = db.query("PRAGMA table_info(rd_replay_checkpoint_receipt)").all() as Array<{ name: string }>
  if (columns.some((column) => column.name === "storage_policy_version")) return
  db.run(`
    ALTER TABLE rd_replay_checkpoint_receipt
    ADD COLUMN storage_policy_version TEXT NOT NULL DEFAULT 'rd-replay-local-rename-no-fsync-v0'
  `)
}

export function validateUniverseSeed(db: Database): void {
  const nodes = db.query(`
    SELECT node_id, parent_node_id, level, node_type, slug, path,
           research_scope_status, implementation_scope_status
    FROM rd_universe_node
  `).all() as UniverseNodeRow[]
  if (nodes.length === 0) {
    throw new Error("universe seed must contain exactly one L0 root")
  }
  const byId = new Map(nodes.map((node) => [node.node_id, node]))
  const roots = nodes.filter((node) => node.level === 0)
  if (roots.length !== 1 || roots[0]?.parent_node_id !== null) {
    throw new Error("universe seed must contain exactly one parentless L0 root")
  }
  const expectedTypes = ["universe", "edge", "mechanism_family", "canonical_strategy"]
  for (const node of nodes) {
    if (node.node_type !== expectedTypes[node.level]) {
      throw new Error(`universe node ${node.node_id} has a level/type mismatch`)
    }
    assertValidScopeCombination(node)
    if (node.level === 0) {
      if (node.path !== node.slug) {
        throw new Error(`universe root ${node.node_id} has an invalid path`)
      }
      continue
    }
    const parent = node.parent_node_id ? byId.get(node.parent_node_id) : undefined
    if (!parent || parent.level !== node.level - 1) {
      throw new Error(`universe node ${node.node_id} has an invalid parent level`)
    }
    if (node.path !== `${parent.path}/${node.slug}`) {
      throw new Error(`universe node ${node.node_id} has an invalid path`)
    }
    if (
      node.research_scope_status === "active"
      && ["product_out_of_scope", "deprecated"].includes(parent.research_scope_status)
    ) {
      throw new Error(`active universe node ${node.node_id} cannot inherit from an inactive parent`)
    }
    assertNoUniverseCycle(node, byId)
  }

  const primaryAxes = db.query(`
    SELECT node_id, COUNT(*) AS count
    FROM rd_universe_node_axis
    WHERE is_primary = 1
    GROUP BY node_id
  `).all() as Array<{ node_id: string; count: number }>
  const primaryCountByNode = new Map(primaryAxes.map((row) => [row.node_id, row.count]))
  for (const node of nodes.filter((candidate) => candidate.level > 0)) {
    if (primaryCountByNode.get(node.node_id) !== 1) {
      throw new Error(`universe node ${node.node_id} must have exactly one primary axis`)
    }
  }
}

export function validateLifecycleRuleSeed(db: Database): void {
  const duplicate = db.query(`
    SELECT current_state, trigger_type, trigger_value, requires_result_stage_id, COUNT(*) AS count
    FROM rd_lifecycle_transition_rule
    WHERE rule_version=$version
    GROUP BY current_state, trigger_type, trigger_value, requires_result_stage_id
    HAVING COUNT(*) > 1
  `).get({ $version: RESEARCH_LIFECYCLE_RULE_VERSION }) as { count: number } | null
  if (duplicate) throw new Error("lifecycle rule seed is non-deterministic")
  const bootstrap = db.query(`
    SELECT next_state FROM rd_lifecycle_transition_rule
    WHERE rule_id=$id AND current_state='__unregistered__'
      AND trigger_type='system' AND trigger_value='register'
  `).get({ $id: `${RESEARCH_LIFECYCLE_RULE_VERSION}:register` }) as { next_state: string } | null
  if (bootstrap?.next_state !== "proposed") throw new Error("lifecycle bootstrap rule is missing or invalid")
  const invalidSentinel = db.query(`
    SELECT COUNT(*) AS count FROM rd_lifecycle_transition_rule r
    JOIN rd_result_stage s ON s.stage_id=r.requires_result_stage_id
    WHERE r.trigger_type != 'reviewer' AND s.is_sentinel != 1
  `).get() as { count: number }
  if (invalidSentinel.count !== 0) throw new Error("non-reviewer lifecycle rules must use the stage sentinel")
}

function assertNoUniverseCycle(node: UniverseNodeRow, byId: Map<string, UniverseNodeRow>): void {
  const visited = new Set<string>()
  let current: UniverseNodeRow | undefined = node
  while (current) {
    if (visited.has(current.node_id)) {
      throw new Error(`universe node ${node.node_id} participates in a cycle`)
    }
    visited.add(current.node_id)
    current = current.parent_node_id ? byId.get(current.parent_node_id) : undefined
  }
}

function seedResultStages(db: Database): void {
  const insert = db.query(`
    INSERT INTO rd_result_stage(stage_id, stage_order, is_sentinel, status)
    VALUES ($stage_id, $stage_order, $is_sentinel, 'active')
    ON CONFLICT(stage_id) DO NOTHING
  `)
  for (const [stageId, order, sentinel] of RESULT_STAGE_SEED) {
    insert.run({ $stage_id: stageId, $stage_order: order, $is_sentinel: sentinel })
  }
}

function seedLifecycleRules(db: Database): void {
  const insert = db.query(`
    INSERT INTO rd_lifecycle_transition_rule(
      rule_id, rule_version, current_state, trigger_type, trigger_value,
      next_state, requires_result_stage_id, requires_fresh_fingerprint
    ) VALUES (
      $rule_id, $rule_version, $current_state, $trigger_type, $trigger_value,
      $next_state, $requires_result_stage_id, $requires_fresh_fingerprint
    )
    ON CONFLICT(rule_id) DO NOTHING
  `)
  for (const [suffix, currentState, triggerType, triggerValue, nextState, stage] of LIFECYCLE_RULE_SEED) {
    insert.run({
      $rule_id: `${RESEARCH_LIFECYCLE_RULE_VERSION}:${suffix}`,
      $rule_version: RESEARCH_LIFECYCLE_RULE_VERSION,
      $current_state: currentState,
      $trigger_type: triggerType,
      $trigger_value: triggerValue,
      $next_state: nextState,
      $requires_result_stage_id: stage,
      $requires_fresh_fingerprint: triggerValue.startsWith("resume_") ? 1 : 0,
    })
  }
}

function seedResultTypes(db: Database): void {
  const insert = db.query(`
    INSERT INTO rd_result_type(result_type_id, status, description)
    VALUES ($id, 'active', $description)
    ON CONFLICT(result_type_id) DO NOTHING
  `)
  for (const [id, description] of RESULT_TYPE_SEED) insert.run({ $id: id, $description: description })
}

interface UniverseNodeRow {
  node_id: string
  parent_node_id: string | null
  level: number
  node_type: string
  slug: string
  path: string
  research_scope_status: string
  implementation_scope_status: string
}

function assertValidScopeCombination(node: UniverseNodeRow): void {
  const allowed: Record<string, string[]> = {
    active: ["ready", "backlog", "data_blocked", "tool_blocked"],
    catalog_only: ["backlog", "data_blocked", "tool_blocked", "product_out_of_scope"],
    product_out_of_scope: ["product_out_of_scope"],
    deprecated: ["deprecated"],
  }
  if (!allowed[node.research_scope_status]?.includes(node.implementation_scope_status)) {
    throw new Error(`universe node ${node.node_id} has an invalid scope combination`)
  }
}
