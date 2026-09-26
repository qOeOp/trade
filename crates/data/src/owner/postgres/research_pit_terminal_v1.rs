//! Reads back one initial PIT intake by its correlation, in the caller's R&D transaction.
//!
//! The `market_data_rd_api` function below returns the stored snapshot the correlation row points
//! at, with the correlation row itself, and nothing else. It is `STABLE` and takes no row locks, so
//! a recovery never waits on, or holds up, a Market Data writer. The Owner's own decoder verifies
//! the snapshot, and the same projection the intake answered with builds the terminal.

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    research_pit_terminal_v1::{ResearchPitIntakeTerminalV1, ResearchPitTerminalReadErrorV1},
    source_binding::BindingDigest,
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_pit_initial_intake_by_correlation_v1(p_correlation_identity BYTEA) RETURNS TABLE(correlation_lineage_root BYTEA,correlation_snapshot_identity BYTEA,row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT c.lineage_root,c.snapshot_identity,f.snapshot_identity,f.fact_digest,f.request_identity,f.request_digest,f.correction_stream_identity,f.correction_sequence,f.lineage_root,f.lineage_version,f.aggregate_json,o.event_identity,o.aggregate_identity,o.payload,o.payload_digest,h.lineage_root,h.snapshot_identity,h.fact_digest,h.lineage_version FROM market_data_private.pit_initial_intake_correlations_v1 AS c JOIN market_data_private.pit_snapshot_facts_v1 AS f ON f.snapshot_identity=c.snapshot_identity JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity=f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE c.correlation_identity=p_correlation_identity $function$",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_pit_initial_intake_by_correlation_v1(BYTEA) FROM PUBLIC",
    "DO $grant$ BEGIN IF pg_catalog.to_regrole('rd_owner') IS NOT NULL THEN GRANT EXECUTE ON FUNCTION market_data_rd_api.read_pit_initial_intake_by_correlation_v1(BYTEA) TO rd_owner; END IF; END $grant$",
];

/// Reads back the one initial intake committed under `correlation`, if there is one.
///
/// Runs in the caller's R&D transaction, reads only, and takes no row locks. `Ok(None)` means
/// Market Data has never committed an initial intake under this correlation, and nothing else: a
/// store that cannot be read, a row that does not decode, and a snapshot that is not the one the
/// correlation row names are all errors, never `None`.
///
/// # Errors
///
/// [`ResearchPitTerminalReadErrorV1::StoreUnavailable`] when the store cannot be read or returns
/// custody that does not verify.
pub async fn resolve_research_pit_terminal_by_correlation_v1(
    transaction: &mut Transaction<'_, Postgres>,
    correlation: BindingDigest,
) -> Result<Option<ResearchPitIntakeTerminalV1>, ResearchPitTerminalReadErrorV1> {
    let rows = sqlx::query(
        "SELECT * FROM market_data_rd_api.read_pit_initial_intake_by_correlation_v1($1)",
    )
    .bind(correlation.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|e| {
        crate::owner::storage_diagnostic::refused_by_store(
            "research_pit_terminal.by_correlation.read",
            &e,
        );
        ResearchPitTerminalReadErrorV1::StoreUnavailable
    })?;
    let row = match rows.as_slice() {
        [] => return Ok(None),
        [row] => row,
        _ => return Err(ResearchPitTerminalReadErrorV1::StoreUnavailable),
    };
    let aggregate = super::decode_pit_row(row, false)
        .map_err(|_| ResearchPitTerminalReadErrorV1::StoreUnavailable)?;
    let fact = aggregate.fact();
    let digest = |name: &str| -> Result<BindingDigest, ResearchPitTerminalReadErrorV1> {
        let bytes: Vec<u8> = row
            .try_get(name)
            .map_err(|_| ResearchPitTerminalReadErrorV1::StoreUnavailable)?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| ResearchPitTerminalReadErrorV1::StoreUnavailable)?;
        Ok(BindingDigest::from_untrusted_bytes(bytes))
    };

    // The correlation row, the snapshot it names and the request that snapshot carries must agree:
    // an initial snapshot of its own lineage, requested under exactly this correlation.
    if digest("correlation_snapshot_identity")? != fact.snapshot_identity()
        || digest("correlation_lineage_root")? != fact.lineage_root()
        || fact.request().correlation_identity != correlation
        || fact.lineage_version() != 1
        || fact.predecessor_snapshot_identity().is_some()
    {
        return Err(ResearchPitTerminalReadErrorV1::StoreUnavailable);
    }
    Ok(Some(ResearchPitIntakeTerminalV1::new(
        super::pit_market_snapshot_terminal_of_v1(&aggregate),
        fact.request().requester_identity,
    )))
}
