//! The one schema an admitted Market Data reader is ever granted.
//!
//! Store Admission's reads used to call `market_data_private` directly, so the principal they
//! connect as had to hold `USAGE` on the Owner's private schema. That is the grant the time-zone
//! custody check refuses: it requires `market_data_private` to have no grantee but its owner. Each
//! function here is a `SECURITY DEFINER` pass-through that runs as the owner, so a reader holds
//! `USAGE` on `market_data_admitted_read` and `EXECUTE` on the functions it calls, and nothing on
//! `market_data_private`.
//!
//! A wrapper widens nothing. Each one either calls the private function of the same name with its
//! own parameters, unchanged, or is one of four fixed reads of Owner rows that a read or a
//! measurement used to make directly. Every wrapper is `STABLE`, pins `search_path`, takes only typed values, and
//! loses `PUBLIC`'s default `EXECUTE` as soon as it is created.
//!
//! The migration grants them to one role: `market_data_admitted_reader`, the principal a Store
//! Admission leases, when the deployment has provisioned it
//! (`product/rd-workbench/postgres-init/25-market-data-admitted-reader.sh`). It gains `USAGE` on
//! this schema and `EXECUTE` on every function in it. That is exactly what the admitted reads and
//! the measurement call, because every wrapper is on an admitted read's floor or is the
//! measurement's ledger read, which `every_wrapper_serves_an_admitted_read_or_the_measurement` in
//! Store Admission holds.

/// Creates the schema if it is missing, then every wrapper, then revokes `PUBLIC`'s default
/// `EXECUTE` from each, and last grants the admitted reader the schema and every wrapper when it
/// exists.
pub(super) const ADMITTED_READ_SCHEMA_V1: &[&str] = &[
    // `CREATE SCHEMA IF NOT EXISTS` checks database `CREATE` before existence, and the deployed
    // Owner holds none; the authority migration creates this schema there. Ask about existence
    // first and create only what is genuinely missing.
    "DO $admitted_read_schema$ BEGIN IF pg_catalog.to_regnamespace('market_data_admitted_read') IS NULL THEN EXECUTE 'CREATE SCHEMA market_data_admitted_read'; END IF; END $admitted_read_schema$",
    "REVOKE ALL ON SCHEMA market_data_admitted_read FROM PUBLIC",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_bar_schedule_candidates_v1(p_canonical_instrument TEXT) RETURNS TABLE(fact_digest BYTEA,canonical_instrument TEXT,predecessor_fact_digest BYTEA,fact_bytes BYTEA,cut_identity BYTEA,cut_bytes BYTEA,readback_identity BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_bar_schedule_candidates_v1(p_canonical_instrument) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_bar_schedule_history_v1(p_canonical_instrument TEXT) RETURNS TABLE(head_fact_digest BYTEA,fact_digest BYTEA,predecessor_fact_digest BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_bar_schedule_history_v1(p_canonical_instrument) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_bar_schedule_v1(p_readback_identity BYTEA) RETURNS TABLE(fact_digest BYTEA,canonical_instrument TEXT,predecessor_fact_digest BYTEA,fact_bytes BYTEA,cut_identity BYTEA,cut_bytes BYTEA,readback_identity BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_bar_schedule_v1(p_readback_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_clock_custody_state_v1() RETURNS TABLE(head_identity BYTEA,head_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_clock_custody_state_v1() $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_clock_handoff_v1(p_head_identity BYTEA) RETURNS TABLE(head_identity BYTEA,head_digest BYTEA,predecessor_head_digest BYTEA,clock_identity TEXT,clock_epoch TEXT,monotonic_sequence BIGINT,wall_observed BIGINT,decision_cut BIGINT,valid_through BIGINT,restart_continuity_digest BYTEA,uncertainty_bound BIGINT,skew_bound BIGINT,comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_clock_handoff_v1(p_head_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_clock_membership_custody_v1() RETURNS TABLE(handoff_count BIGINT,head_identity BYTEA,root_head_identity BYTEA,ordinal BIGINT,prior_head_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_clock_membership_custody_v1() $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_epoch_successor_proof_v1(p_successor_head_digest BYTEA) RETURNS TABLE(proof_identity BYTEA,predecessor_head_digest BYTEA,successor_head_digest BYTEA,prior_clock_identity TEXT,prior_clock_epoch TEXT,successor_clock_identity TEXT,successor_clock_epoch TEXT,successor_continuity_digest BYTEA,commit_cut BIGINT,comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_epoch_successor_proof_v1(p_successor_head_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_native_replay_next_frame_v2(p_scope_digest BYTEA, p_after_ns BIGINT, p_decision_cut_ns BIGINT) RETURNS TABLE(event_effective_ns BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_native_replay_next_frame_v2(p_scope_digest,p_after_ns,p_decision_cut_ns) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_native_replay_quote_cut_census_v2(p_scope_digest BYTEA, p_after_ns BIGINT, p_before_ns BIGINT) RETURNS TABLE(snapshot_identity BYTEA,snapshot_fact_digest BYTEA,scope_digest BYTEA,event_effective_ns BIGINT,decision_cut_ns BIGINT,instrument_master_digest BYTEA,universe_selection_digest BYTEA,market_semantics_identity BYTEA,source_binding_lineage_root BYTEA,correction_lineage_root BYTEA,correction_lineage_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_native_replay_quote_cut_census_v2(p_scope_digest,p_after_ns,p_before_ns) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_owner_history_census_custody_v1() RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT market_data_private.resolve_owner_history_census_custody_v1() $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_lineage_custody_v1(p_lineage_root BYTEA) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT market_data_private.resolve_pit_lineage_custody_v1(p_lineage_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_lineage_members_v1(p_lineage_root BYTEA) RETURNS TABLE(member_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_lineage_members_v1(p_lineage_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_observation_batch_v1(p_snapshot_identity BYTEA) RETURNS TABLE(source_binding_identity BYTEA,source_binding_lineage_root BYTEA,source_binding_lineage_version BIGINT,batch_digest BYTEA,batch_bytes BYTEA,row_count BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_observation_batch_v1(p_snapshot_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_observation_rows_v1(p_snapshot_identity BYTEA) RETURNS TABLE(ordinal BIGINT,symbolic_key TEXT,member_key TEXT,row_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_observation_rows_v1(p_snapshot_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_snapshot_v1(p_snapshot_identity BYTEA) RETURNS TABLE(row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT,clock_identity TEXT,clock_epoch TEXT,monotonic_sequence BIGINT,wall_observed BIGINT,decision_cut BIGINT,valid_through BIGINT,restart_continuity_digest BYTEA,uncertainty_bound BIGINT,skew_bound BIGINT,comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_snapshot_v1(p_snapshot_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_sample_receipt_v1(p_receipt_digest BYTEA) RETURNS TABLE(sample_identity BYTEA,fact_digest BYTEA,series_identity BYTEA,series_predecessor_identity BYTEA,series_sequence BIGINT,correction_slot_identity BYTEA,correction_predecessor_identity BYTEA,correction_sequence BIGINT,logical_time BIGINT,lineage_version BIGINT,projection_receipt_digest BYTEA,projection_binding_receipt_digest BYTEA,projection_receipt_bytes BYTEA,projection_custody_digest BYTEA,fact_bytes BYTEA,fact_custody_digest BYTEA,receipt_digest BYTEA,receipt_bytes BYTEA,receipt_custody_digest BYTEA,outbox_identity BYTEA,outbox_payload_digest BYTEA,outbox_payload_bytes BYTEA,outbox_custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_sample_receipt_v1(p_receipt_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_source_binding_v1(p_binding_id BYTEA) RETURNS TABLE(row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT,clock_identity TEXT,clock_epoch TEXT,monotonic_sequence BIGINT,wall_observed BIGINT,decision_cut BIGINT,valid_through BIGINT,restart_continuity_digest BYTEA,uncertainty_bound BIGINT,skew_bound BIGINT,comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_source_binding_v1(p_binding_id) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_source_lineage_custody_v1(p_lineage_root BYTEA) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT market_data_private.resolve_source_lineage_custody_v1(p_lineage_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_source_lineage_members_v1(p_lineage_root BYTEA) RETURNS TABLE(member_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_source_lineage_members_v1(p_lineage_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_schedule_dependencies_v3(p_receipt_digest BYTEA) RETURNS TABLE(component_ordinal BIGINT,role_identity BYTEA,binding_receipt_digest BYTEA,schedule_readback_identity BYTEA,schedule_fact_digest BYTEA,schedule_cut_identity BYTEA,schedule_cut_digest BYTEA,schedule_receipt_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(p_receipt_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_v2(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,kind SMALLINT,subject_identity BYTEA,component_count BIGINT,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v2(p_receipt_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_v3(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,kind SMALLINT,lifecycle SMALLINT,subject_identity BYTEA,component_count BIGINT,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v3(p_receipt_digest) $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_timeframe_projection_receipt_v1(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,binding_receipt_digest BYTEA,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_timeframe_projection_receipt_v1(p_receipt_digest) $function$",
    // The reads of Owner rows a Store Admission read or measurement used to make directly.
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_source_binding_lineage_root_v1(p_binding_id BYTEA) RETURNS TABLE(lineage_root BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.lineage_root FROM market_data_private.source_binding_facts_v1 AS f WHERE f.binding_id=p_binding_id $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_pit_snapshot_references_v1(p_snapshot_identity BYTEA) RETURNS TABLE(lineage_root BYTEA,source_binding_identity JSONB) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.lineage_root,f.aggregate_json->'fact'->'source_binding_identity' FROM market_data_private.pit_snapshot_facts_v1 AS f WHERE f.snapshot_identity=p_snapshot_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_clock_handoffs_v1() RETURNS TABLE(head_identity BYTEA,handoff JSONB) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT h.head_identity,pg_catalog.to_jsonb(h) FROM market_data_private.clock_handoffs_v1 AS h ORDER BY h.head_identity LIMIT 10001 $function$",
    "CREATE OR REPLACE FUNCTION market_data_admitted_read.resolve_owner_migrations_v1() RETURNS TABLE(row_json TEXT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT pg_catalog.to_jsonb(m)::text FROM market_data_private.owner_migrations_v1 AS m ORDER BY 1 LIMIT 10001 $function$",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_bar_schedule_candidates_v1(TEXT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_bar_schedule_history_v1(TEXT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_bar_schedule_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_clock_custody_state_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_clock_handoff_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_clock_membership_custody_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_epoch_successor_proof_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_native_replay_next_frame_v2(BYTEA,BIGINT,BIGINT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_native_replay_quote_cut_census_v2(BYTEA,BIGINT,BIGINT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_owner_history_census_custody_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_lineage_custody_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_lineage_members_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_observation_batch_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_observation_rows_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_snapshot_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_sample_receipt_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_source_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_source_lineage_custody_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_source_lineage_members_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_schedule_dependencies_v3(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_v2(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_strategy_input_sample_projection_v3(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_timeframe_projection_receipt_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_source_binding_lineage_root_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_pit_snapshot_references_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_clock_handoffs_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_admitted_read.resolve_owner_migrations_v1() FROM PUBLIC",
    ADMITTED_READER_GRANT_V1,
];

/// The one grant the migration makes. It is conditional because the role is the deployment's to
/// provision, and a store with no reader is still a valid Owner store.
///
/// `ALL FUNCTIONS IN SCHEMA` is every wrapper above and nothing else only because nothing else
/// creates a function here, which `the_admitted_read_schema_is_what_its_statements_declare` proves
/// against the migrated catalog. If that proof is ever relaxed, this must grant each wrapper by
/// signature instead.
pub(super) const ADMITTED_READER_GRANT_V1: &str = "DO $admitted_reader_grant$ BEGIN IF pg_catalog.to_regrole('market_data_admitted_reader') IS NOT NULL THEN GRANT USAGE ON SCHEMA market_data_admitted_read TO market_data_admitted_reader; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA market_data_admitted_read TO market_data_admitted_reader; END IF; END $admitted_reader_grant$";

/// The name of every wrapper the list creates, for Store Admission's proof that each serves an
/// admitted read or the measurement.
#[cfg(test)]
pub(in crate::owner) fn declared_admitted_read_wrapper_names_v1()
-> std::collections::BTreeSet<&'static str> {
    ADMITTED_READ_SCHEMA_V1
        .iter()
        .filter_map(|statement| {
            statement.strip_prefix("CREATE OR REPLACE FUNCTION market_data_admitted_read.")
        })
        .filter_map(|rest| rest.split_once('(').map(|(name, _)| name))
        .collect()
}

/// The Owner rows a wrapper may read directly, and the one body that reads each.
///
/// Every other wrapper calls the private function of its own name. Anything else is refused by
/// `every_wrapper_widens_nothing`, so a wrapper that starts reading another table, or calling a
/// private function other than its namesake, has to be added here, where a reviewer sees it.
#[cfg(test)]
const OWNER_ROW_READS_V1: &[(&str, &str)] = &[
    (
        "resolve_source_binding_lineage_root_v1",
        "SELECT f.lineage_root FROM market_data_private.source_binding_facts_v1 AS f WHERE f.binding_id=p_binding_id",
    ),
    (
        "resolve_pit_snapshot_references_v1",
        "SELECT f.lineage_root,f.aggregate_json->'fact'->'source_binding_identity' FROM market_data_private.pit_snapshot_facts_v1 AS f WHERE f.snapshot_identity=p_snapshot_identity",
    ),
    (
        "resolve_clock_handoffs_v1",
        "SELECT h.head_identity,pg_catalog.to_jsonb(h) FROM market_data_private.clock_handoffs_v1 AS h ORDER BY h.head_identity LIMIT 10001",
    ),
    (
        "resolve_owner_migrations_v1",
        "SELECT pg_catalog.to_jsonb(m)::text FROM market_data_private.owner_migrations_v1 AS m ORDER BY 1 LIMIT 10001",
    ),
];

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use rstest::rstest;

    use super::{ADMITTED_READ_SCHEMA_V1, ADMITTED_READER_GRANT_V1, OWNER_ROW_READS_V1};
    use crate::owner::postgres::MarketDataOwnerPostgres;

    const CREATE: &str = "CREATE OR REPLACE FUNCTION market_data_admitted_read.";
    const ATTRIBUTES: &str =
        " LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ ";

    /// One wrapper as its statement declares it.
    struct WrapperV1<'a> {
        name: &'a str,
        parameters: Vec<(&'a str, &'a str)>,
        returns: &'a str,
        body: &'a str,
    }

    fn wrappers() -> Vec<WrapperV1<'static>> {
        ADMITTED_READ_SCHEMA_V1
            .iter()
            .filter_map(|statement| statement.strip_prefix(CREATE))
            .map(|rest| {
                let (name, rest) = rest.split_once('(').expect("a parameter list");
                let (parameters, rest) = rest.split_once(") RETURNS ").expect("a return type");
                let (returns, rest) = rest.split_once(ATTRIBUTES).unwrap_or_else(|| {
                    panic!("{name} is SQL, STABLE, SECURITY DEFINER and pins search_path")
                });
                let body = rest
                    .strip_suffix(" $function$")
                    .unwrap_or_else(|| panic!("{name}'s body is one quoted statement"));
                let parameters = parameters
                    .split(',')
                    .map(str::trim)
                    .filter(|parameter| !parameter.is_empty())
                    .map(|parameter| parameter.split_once(' ').expect("a named, typed parameter"))
                    .collect();
                WrapperV1 {
                    name,
                    parameters,
                    returns,
                    body,
                }
            })
            .collect()
    }

    /// Every wrapper is either the pass-through of its private namesake, with its own parameters in
    /// order, or one of the fixed Owner row reads; and every one loses `PUBLIC`'s `EXECUTE` in the
    /// same migration. The list grants once, last, and only to the admitted reader.
    #[rstest]
    fn every_wrapper_widens_nothing() {
        let row_reads = OWNER_ROW_READS_V1
            .iter()
            .copied()
            .collect::<BTreeMap<_, _>>();
        let mut names = BTreeSet::new();
        let mut revokes = BTreeSet::new();

        for wrapper in wrappers() {
            assert!(
                names.insert(wrapper.name),
                "{} is created once",
                wrapper.name
            );
            let arguments = wrapper
                .parameters
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(",");
            let call = format!("market_data_private.{}({arguments})", wrapper.name);
            let pass_through = if wrapper.returns == "BOOLEAN" {
                format!("SELECT {call}")
            } else {
                format!("SELECT * FROM {call}")
            };

            if let Some(read) = row_reads.get(wrapper.name) {
                assert_eq!(wrapper.body, *read, "{} reads its fixed rows", wrapper.name);
            } else {
                assert_eq!(
                    wrapper.body, pass_through,
                    "{} calls its private namesake with its own parameters",
                    wrapper.name
                );
            }
            let types = wrapper
                .parameters
                .iter()
                .map(|(_, kind)| *kind)
                .collect::<Vec<_>>()
                .join(",");
            revokes.insert(format!(
                "REVOKE ALL ON FUNCTION market_data_admitted_read.{}({types}) FROM PUBLIC",
                wrapper.name
            ));
        }

        for read in row_reads.keys() {
            assert!(
                names.contains(read),
                "the fixed row read {read} is a wrapper"
            );
        }
        assert_eq!(
            ADMITTED_READ_SCHEMA_V1
                .iter()
                .filter(|statement| statement.starts_with("REVOKE ALL ON FUNCTION "))
                .map(|statement| (*statement).to_owned())
                .collect::<BTreeSet<_>>(),
            revokes,
            "each wrapper, and only a wrapper, loses PUBLIC's EXECUTE"
        );
        assert!(
            ADMITTED_READ_SCHEMA_V1
                .contains(&"REVOKE ALL ON SCHEMA market_data_admitted_read FROM PUBLIC")
        );
        assert_eq!(
            ADMITTED_READ_SCHEMA_V1
                .iter()
                .filter(|statement| statement.contains("GRANT "))
                .collect::<Vec<_>>(),
            [&ADMITTED_READER_GRANT_V1],
            "the migration grants in one statement"
        );
        assert_eq!(
            ADMITTED_READ_SCHEMA_V1.last(),
            Some(&ADMITTED_READER_GRANT_V1)
        );
        let granted = ADMITTED_READER_GRANT_V1
            .strip_prefix("DO $admitted_reader_grant$ BEGIN IF pg_catalog.to_regrole('market_data_admitted_reader') IS NOT NULL THEN ")
            .and_then(|rest| rest.strip_suffix(" END IF; END $admitted_reader_grant$"))
            .expect("the grant is conditional on the reader existing");
        assert_eq!(
            granted
                .split("; ")
                .map(|statement| statement.trim_end_matches(';'))
                .collect::<Vec<_>>(),
            [
                "GRANT USAGE ON SCHEMA market_data_admitted_read TO market_data_admitted_reader",
                "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA market_data_admitted_read TO market_data_admitted_reader",
            ],
            "the reader gains the schema and its functions, and nothing else"
        );
        assert_eq!(
            ADMITTED_READ_SCHEMA_V1.len(),
            3 + 2 * names.len(),
            "the list is the schema, its revoke, a create and a revoke per wrapper, and the grant"
        );
    }

    /// The migrated schema is what the statements declare, read back from the catalog.
    ///
    /// Each function in `market_data_admitted_read` is one the list creates; each is `SQL`,
    /// `STABLE`, `SECURITY DEFINER`, pins `search_path`, and is owned by the owner of
    /// `market_data_private`, so it runs with exactly the privileges its namesake runs with. A
    /// pass-through takes and returns exactly what its namesake does. No ACL on the schema or any
    /// function names `PUBLIC`, and none is left at its default, which would grant `PUBLIC`
    /// `EXECUTE`. Migrating twice leaves the same catalog.
    #[rstest]
    #[ignore = "requires the crates/data disposable PostgreSQL harness"]
    fn the_admitted_read_schema_is_what_its_statements_declare() {
        std::thread::Builder::new()
            .name("market-data-admitted-read-schema".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(run_admitted_read_schema_scenario());
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// One function of either schema, as the catalog reports it.
    type CatalogFunctionV1 = (
        String,
        String,
        String,
        String,
        bool,
        String,
        Option<Vec<String>>,
        String,
        Option<String>,
        bool,
    );

    const CATALOG_FUNCTIONS: &str = "SELECT n.nspname::text, p.proname::text, \
        pg_catalog.pg_get_function_arguments(p.oid), pg_catalog.pg_get_function_result(p.oid), \
        p.prosecdef, p.provolatile::text, p.proconfig, l.lanname::text, p.proacl::text, \
        p.proowner = (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'market_data_private') \
        FROM pg_catalog.pg_proc p \
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
        WHERE n.nspname IN ('market_data_admitted_read', 'market_data_private') \
        ORDER BY 1, 2, 3";

    async fn run_admitted_read_schema_scenario() {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let owner = MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let first: Vec<CatalogFunctionV1> = sqlx::query_as(CATALOG_FUNCTIONS)
            .fetch_all(owner.pool())
            .await
            .expect("the catalog lists both schemas");
        let private = first
            .iter()
            .filter(|row| row.0 == "market_data_private")
            .map(|row| (row.1.as_str(), row))
            .collect::<BTreeMap<_, _>>();
        let admitted = first
            .iter()
            .filter(|row| row.0 == "market_data_admitted_read")
            .collect::<Vec<_>>();
        let declared = wrappers()
            .into_iter()
            .map(|wrapper| {
                // The catalog stores an identifier truncated to 63 bytes.
                wrapper.name[..wrapper.name.len().min(63)].to_owned()
            })
            .collect::<BTreeSet<_>>();
        assert!(!declared.is_empty(), "the list declares wrappers");
        assert_eq!(
            admitted
                .iter()
                .map(|row| row.1.clone())
                .collect::<BTreeSet<_>>(),
            declared,
            "the schema holds exactly the declared wrappers"
        );

        for (_, name, arguments, result, definer, volatility, config, language, acl, owned) in
            &admitted
        {
            assert!(*definer, "{name} runs as its owner");
            assert_eq!(volatility, "s", "{name} is STABLE");
            assert_eq!(language, "sql", "{name} is SQL");
            assert_eq!(
                config.as_deref(),
                Some(&["search_path=pg_catalog, pg_temp".to_owned()][..]),
                "{name} pins search_path"
            );
            assert!(
                *owned,
                "{name} is owned by the owner of market_data_private"
            );
            let acl = acl.as_deref().unwrap_or_else(|| {
                panic!("{name} is left at the default ACL, which grants PUBLIC")
            });
            assert!(
                acl.trim_matches(['{', '}'])
                    .split(',')
                    .all(|item| !item.starts_with('=')),
                "{name} grants PUBLIC: {acl}"
            );

            if !OWNER_ROW_READS_V1.iter().any(|(read, _)| read == name) {
                let namesake = private
                    .get(name.as_str())
                    .unwrap_or_else(|| panic!("{name} has a private namesake"));
                assert_eq!(
                    (arguments, result),
                    (&namesake.2, &namesake.3),
                    "{name} takes and returns what its namesake does"
                );
            }
        }
        let schema_acl: Option<String> = sqlx::query_scalar(
            "SELECT nspacl::text FROM pg_catalog.pg_namespace WHERE nspname = 'market_data_admitted_read'",
        )
        .fetch_one(owner.pool())
        .await
        .expect("the schema exists");
        let schema_acl = schema_acl.expect("the schema's ACL is explicit, not PUBLIC's default");
        assert!(
            schema_acl
                .trim_matches(['{', '}'])
                .split(',')
                .all(|item| !item.starts_with('=')),
            "the schema grants PUBLIC: {schema_acl}"
        );

        drop(owner);
        let again = MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("the Owner migrates a second time");
        let second: Vec<CatalogFunctionV1> = sqlx::query_as(CATALOG_FUNCTIONS)
            .fetch_all(again.pool())
            .await
            .expect("the catalog lists both schemas");
        assert_eq!(first, second, "migrating again changes nothing");
    }
}
