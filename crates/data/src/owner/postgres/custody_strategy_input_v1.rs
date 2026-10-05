//! Strategy input declarations over a custody frame (T0-10, `docs/owners/market-data.md`).
//!
//! A custody run's Design is declared over its first custody frame, sealed as a batch whose source
//! is that frame's view, so its strategy-input universe selection is the one every later frame of
//! the run derives. The registry re-resolves such a declaration here: the view at the head that
//! holds it - a later correction never refuses an earlier declaration - and, for every other
//! dependency, the chain's own basis, which the basis read verifies against the root custody.
//!
//! The R&D principal makes the same reread inside its own transaction (T0-10 (c)). `rd_owner`
//! holds nothing on `market_data_private`, so it reads the chain, its rows, its basis and its
//! Universe Selection through `market_data_rd_api` wrappers, each a pass-through to the private
//! function the admitted port reads through `market_data_admitted_read`, and the reread decodes
//! and verifies them exactly as that port's read does. The custody tables are append-only but for
//! the chain head, which the reread never reads: it walks the chain's custodies, so the wrappers
//! take no lock.

/// The `market_data_rd_api` pass-throughs the R&D principal's custody reread calls. They are
/// installed after the custody schema, because a SQL function's body is checked when it is
/// created, and granted to `rd_owner` when the deployment has provisioned it.
pub(super) const RD_CUSTODY_READ_SCHEMA_V1: &[&str] = &[
    "CREATE OR REPLACE FUNCTION market_data_rd_api.resolve_pit_window_chain_v1(p_chain_root BYTEA) RETURNS TABLE(entry_kind SMALLINT,payload JSONB) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_window_chain_v1(p_chain_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.resolve_pit_window_rows_v1(p_chain_root BYTEA, p_versions BYTEA[]) RETURNS TABLE(version_identity BYTEA,member_ordinal SMALLINT,field TEXT,fact_digest BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_window_rows_v1(p_chain_root,p_versions) $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.resolve_pit_window_chain_basis_v1(p_chain_root BYTEA) RETURNS TABLE(entry_kind SMALLINT,payload JSONB) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_window_chain_basis_v1(p_chain_root) $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.resolve_pit_window_universe_selection_v1(p_request_identity BYTEA) RETURNS TABLE(request_identity BYTEA,request_meaning_digest BYTEA,selection_identity BYTEA,record_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,outbox_identity BYTEA,outbox_receipt_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT * FROM market_data_private.resolve_pit_window_universe_selection_v1(p_request_identity) $function$",
    "REVOKE ALL ON FUNCTION market_data_rd_api.resolve_pit_window_chain_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.resolve_pit_window_rows_v1(BYTEA,BYTEA[]) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.resolve_pit_window_chain_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.resolve_pit_window_universe_selection_v1(BYTEA) FROM PUBLIC",
    "DO $grant$ BEGIN IF pg_catalog.to_regrole('rd_owner') IS NOT NULL THEN GRANT EXECUTE ON FUNCTION market_data_rd_api.resolve_pit_window_chain_v1(BYTEA),market_data_rd_api.resolve_pit_window_rows_v1(BYTEA,BYTEA[]),market_data_rd_api.resolve_pit_window_chain_basis_v1(BYTEA),market_data_rd_api.resolve_pit_window_universe_selection_v1(BYTEA) TO rd_owner; END IF; END $grant$",
];

use sqlx::{PgConnection, Postgres, Transaction};

use super::{
    pit_window_custody_v1::{
        PitWindowRowsReadV1, ResolvedPitWindowViewV1, chain_basis_from_raw_v1,
        chain_basis_from_readback_v1, chain_evidence_from_raw_v1, load_chain_evidence_v1,
        read_pit_window_chain_basis_v1, resolve_pit_window_view_from_raw_v1,
        resolve_pit_window_view_in_transaction_v1, root_universe_request_v1,
    },
    strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
    universe_selection::{read_universe_selection_by_request_v1, universe_selection_from_raw_v1},
};
use crate::owner::{
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{CustodyViewInputsV1, verify_custody_view_batch_v1},
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, PitWindowChainBasisV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowCustodyFrameV1,
    },
    source_binding::BindingDigest,
    store_admission::{
        MAX_PIT_WINDOW_ROWS_V1, RawPitWindowChainBasisV1, RawPitWindowChainV1, RawPitWindowRowV1,
        RawUniverseSelectionAggregateV1, UniverseSelectionAggregateTupleV1,
        bounded_pit_window_entries_v1, bounded_universe_selection_aggregate_v1,
    },
    strategy_input_binding::UntrustedStrategyInputBindingRequest,
};

use StrategyInputBindingRegistryErrorV1 as Refused;

/// The view of `frame` at the head it pins, sealed as a batch, with the chain basis verified at
/// that head.
pub(super) async fn read_custody_frame_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    frame: &UntrustedPitWindowCustodyFrameV1,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    let view = resolve_pit_window_view_in_transaction_v1(transaction, frame)
        .await
        .map_err(|_| Refused::PitUnavailable)?;
    let batch = seal_frame_view_v1(frame, &view)?;
    let readback = read_pit_window_chain_basis_v1(transaction, frame.custody.chain_root)
        .await
        .map_err(|_| Refused::StoreUnavailable)?
        .ok_or(Refused::PitUnavailable)?;
    let evidence = load_chain_evidence_v1(transaction, frame.custody.chain_root)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
    let request_identity = root_universe_request_v1(&evidence, frame.custody.chain_root)
        .ok_or(Refused::StoreUntrusted)?;
    let selection = read_universe_selection_by_request_v1(transaction, request_identity)
        .await
        .map_err(|_| Refused::StoreUnavailable)?
        .ok_or(Refused::UniverseUnavailable)?;
    let basis = chain_basis_from_readback_v1(&view.chain, readback, &selection)
        .ok_or(Refused::StoreUntrusted)?;
    Ok((batch, basis))
}

/// The same read as [`read_custody_frame_batch_v1`], made as `rd_owner` through its
/// `market_data_rd_api` pass-throughs and verified by the admitted port's decoders.
async fn read_custody_frame_batch_as_rd_owner_v1(
    connection: &mut PgConnection,
    frame: &UntrustedPitWindowCustodyFrameV1,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    let chain_root = *frame.custody.chain_root.as_bytes();
    let raw = read_rd_chain_v1(connection, chain_root).await?;
    let view = resolve_pit_window_view_from_raw_v1(
        frame,
        &raw,
        &mut RdRowsReadV1 {
            connection: &mut *connection,
            chain_root,
        },
    )
    .await
    .map_err(|_| Refused::PitUnavailable)?;
    let batch = seal_frame_view_v1(frame, &view)?;
    let raw_basis = read_rd_chain_basis_v1(connection, chain_root).await?;
    let readback = chain_basis_from_raw_v1(&raw_basis, frame.custody.chain_root)
        .map_err(|()| Refused::StoreUntrusted)?
        .ok_or(Refused::PitUnavailable)?;
    let evidence = chain_evidence_from_raw_v1(&raw).ok_or(Refused::StoreUntrusted)?;
    let request_identity = root_universe_request_v1(&evidence, frame.custody.chain_root)
        .ok_or(Refused::StoreUntrusted)?;
    let raw_selection = read_rd_universe_selection_v1(connection, *request_identity.as_bytes())
        .await?
        .ok_or(Refused::UniverseUnavailable)?;
    let selection =
        universe_selection_from_raw_v1(&raw_selection).map_err(|_| Refused::StoreUntrusted)?;
    let basis = chain_basis_from_readback_v1(&view.chain, readback, &selection)
        .ok_or(Refused::StoreUntrusted)?;
    Ok((batch, basis))
}

// The R&D principal's four reads: each is the admitted read's query through the
// `market_data_rd_api` pass-through of the same private function, bounded as that read bounds it.

async fn read_rd_chain_v1(
    connection: &mut PgConnection,
    chain_root: [u8; 32],
) -> Result<RawPitWindowChainV1, Refused> {
    let rows: Vec<(i16, String)> = sqlx::query_as(
        "SELECT entry_kind, payload::text FROM market_data_rd_api.resolve_pit_window_chain_v1($1)",
    )
    .bind(chain_root.as_slice())
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| Refused::StoreUnavailable)?;
    Ok(RawPitWindowChainV1 {
        entries: bounded_pit_window_entries_v1(rows).map_err(|()| Refused::StoreUntrusted)?,
    })
}

async fn read_rd_chain_basis_v1(
    connection: &mut PgConnection,
    chain_root: [u8; 32],
) -> Result<RawPitWindowChainBasisV1, Refused> {
    let rows: Vec<(i16, String)> = sqlx::query_as(
        "SELECT entry_kind, payload::text FROM market_data_rd_api.resolve_pit_window_chain_basis_v1($1)",
    )
    .bind(chain_root.as_slice())
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| Refused::StoreUnavailable)?;
    Ok(RawPitWindowChainBasisV1 {
        entries: bounded_pit_window_entries_v1(rows).map_err(|()| Refused::StoreUntrusted)?,
    })
}

async fn read_rd_universe_selection_v1(
    connection: &mut PgConnection,
    request_identity: [u8; 32],
) -> Result<Option<RawUniverseSelectionAggregateV1>, Refused> {
    let rows: Vec<UniverseSelectionAggregateTupleV1> = sqlx::query_as(
        "SELECT request_identity, request_meaning_digest, selection_identity, record_bytes, receipt_identity, receipt_bytes, outbox_identity, outbox_receipt_bytes FROM market_data_rd_api.resolve_pit_window_universe_selection_v1($1)",
    )
    .bind(request_identity.as_slice())
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| Refused::StoreUnavailable)?;
    bounded_universe_selection_aggregate_v1(rows).map_err(|()| Refused::StoreUntrusted)
}

/// The rows function's columns, in its order.
type RdRowColumnsV1 = (Vec<u8>, i16, String, Vec<u8>, Vec<u8>);

struct RdRowsReadV1<'a> {
    connection: &'a mut PgConnection,
    chain_root: [u8; 32],
}

impl PitWindowRowsReadV1 for RdRowsReadV1<'_> {
    async fn read_rows(&mut self, versions: &[[u8; 32]]) -> Result<Vec<RawPitWindowRowV1>, ()> {
        let versions = versions
            .iter()
            .map(|version| version.to_vec())
            .collect::<Vec<_>>();
        let rows: Vec<RdRowColumnsV1> = sqlx::query_as(
            "SELECT version_identity, member_ordinal, field, fact_digest, fact_bytes FROM market_data_rd_api.resolve_pit_window_rows_v1($1,$2)",
        )
        .bind(self.chain_root.as_slice())
        .bind(&versions)
        .fetch_all(&mut *self.connection)
        .await
        .map_err(|_| ())?;

        if rows.len() > MAX_PIT_WINDOW_ROWS_V1 {
            return Err(());
        }
        Ok(rows
            .into_iter()
            .map(
                |(version_identity, member_ordinal, field, fact_digest, fact_bytes)| {
                    RawPitWindowRowV1 {
                        version_identity,
                        member_ordinal,
                        field,
                        fact_digest,
                        fact_bytes,
                    }
                },
            )
            .collect())
    }
}

/// `view` sealed as the batch of `frame`, once it is the view of exactly that frame.
fn seal_frame_view_v1(
    frame: &UntrustedPitWindowCustodyFrameV1,
    view: &ResolvedPitWindowViewV1,
) -> Result<VerifiedPitObservationBatch, Refused> {
    if view.chain.chain_root != frame.custody.chain_root
        || view.chain.head_identity != frame.head_identity
        || view.selection.event_ns != frame.event_ns
    {
        return Err(Refused::StoreUntrusted);
    }
    verify_custody_view_batch_v1(CustodyViewInputsV1 {
        chain_root: view.chain.chain_root,
        record: &view.chain.root,
        clock: &view.chain.root_clock,
        selection: &view.selection,
        rows: &view.rows,
    })
    .map_err(|_| Refused::StoreUntrusted)
}

/// The custody batch a `CustodyView`-sourced request was composed over: the view at the latest
/// head of its chain whose frame view at the request's event is the request's view, so a
/// correction committed after the declaration never refuses it.
///
/// `read_as_rd_owner` makes every read through `market_data_rd_api`, inside the R&D principal's
/// own transaction.
///
/// The walk is boxed so every registry read that may take this arm keeps a small future.
pub(super) async fn reread_custody_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    read_as_rd_owner: bool,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    Box::pin(reread_custody_batch_inner_v1(
        transaction,
        request,
        read_as_rd_owner,
    ))
    .await
}

async fn reread_custody_batch_inner_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    read_as_rd_owner: bool,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    let crate::owner::strategy_input_binding::StrategyInputBatchSourceV1::CustodyView {
        chain_root,
        view_identity,
        event_ns,
        ..
    } = request.source
    else {
        return Err(Refused::PitUnavailable);
    };

    let evidence = if read_as_rd_owner {
        let raw = read_rd_chain_v1(transaction, *chain_root.as_bytes()).await?;
        chain_evidence_from_raw_v1(&raw).ok_or(Refused::StoreUntrusted)?
    } else {
        load_chain_evidence_v1(transaction, chain_root)
            .await
            .map_err(|_| Refused::StoreUnavailable)?
    };
    let mut heads: Vec<(u64, BindingDigest)> = evidence
        .custodies
        .iter()
        .map(|custody| (custody.chain_version, custody.identity))
        .collect();
    heads.sort_unstable_by_key(|head| std::cmp::Reverse(head.0));

    for (_, head_identity) in heads {
        let frame = UntrustedPitWindowCustodyFrameV1 {
            custody: UntrustedPitWindowCustodyClaimV1 { chain_root },
            head_identity,
            event_ns,
        };
        let read = if read_as_rd_owner {
            read_custody_frame_batch_as_rd_owner_v1(transaction, &frame).await
        } else {
            read_custody_frame_batch_v1(transaction, &frame).await
        };
        let Ok((batch, basis)) = read else {
            continue;
        };

        if matches!(
            batch.source(),
            PitObservationBatchSourceV1::CustodyView { view_identity: held, .. } if held == view_identity
        ) {
            return Ok((batch, basis));
        }
    }
    Err(Refused::PitUnavailable)
}

/// Checks a custody-sourced request's coordinates against the chain basis its batch was read
/// with: the Universe Selection record, Instrument Master key and Market Semantics identity the
/// root custody bound. The batch itself is checked against the request when the role binds.
pub(super) fn check_custody_request_against_basis_v1(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    basis: &PitWindowChainBasisV1,
) -> Result<(), Refused> {
    if request.universe_selection_digest != basis.universe_selection().request_identity()
        || batch.universe_selection_digest() != basis.universe_selection().request_identity()
    {
        return Err(Refused::UniverseUnavailable);
    }

    if request.instrument_master_digest != basis.instrument_master_key()
        || batch.instrument_master_digest() != basis.instrument_master_key()
    {
        return Err(Refused::InstrumentMasterBatchDigestUnavailable);
    }

    if request.market_semantics_identity != basis.market_semantics_identity()
        || batch.market_semantics_identity() != basis.market_semantics_identity()
    {
        return Err(Refused::MarketSemanticsUnavailable);
    }
    Ok(())
}
