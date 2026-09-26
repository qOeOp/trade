//! Two reads a caller outside Market Data makes before it acts on a new snapshot, in its own
//! transaction.
//!
//! One returns what a universe-member Replay composition over the snapshot is composed from, so a
//! locator-only issuance command can be written without rebuilding a Market Data formula. The other
//! returns the value a Source Binding's compatibility scope states, so a Market Semantics
//! submission for a new snapshot under the binding can state the same one.
//!
//! The `market_data_rd_api` functions below only return stored rows. They are `STABLE` and take no
//! row locks, so a read never waits on, or holds up, a Market Data writer; the Owner decoders and
//! checks the writers use decide every answer. Neither read is a decision: the issuance and the
//! admission re-derive and check everything they are given.

use sqlx::{Postgres, Row, Transaction};

use super::SourceBindingStoredAggregate;

use crate::owner::{
    correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
    market_semantics::MarketSemanticsFactV1,
    market_semantics_admission_v1::{
        MarketSemanticsScopeValueErrorV1, MarketSemanticsScopeValueV1,
        MarketSemanticsValueSubmissionV1,
    },
    pit_snapshot::{PitSnapshotOwnerReadback, UntrustedPitSnapshotLocator},
    reference_fact_coordinates::verified_coordinates_from_r0_v1,
    replay_market_facts_v2::{
        ReplayCompositionContentLocatorV1, ReplayCompositionRequestLocatorV1,
    },
    source_binding::{
        BindingDigest, SourceBindingOwnerReadback, UntrustedSourceBindingLocator,
        authority::derive_market_semantics_compatibility_identity_v1,
    },
    universe_member_composition_basis_v1::{
        UniverseMemberCompositionBasisErrorV1, UniverseMemberCompositionBasisV1,
    },
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_pit_snapshot_for_composition_basis_v1(p_snapshot_identity BYTEA) RETURNS TABLE(row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.snapshot_identity,f.fact_digest,f.request_identity,f.request_digest,f.correction_stream_identity,f.correction_sequence,f.lineage_root,f.lineage_version,f.aggregate_json,o.event_identity,o.aggregate_identity,o.payload,o.payload_digest,h.lineage_root,h.snapshot_identity,h.fact_digest,h.lineage_version FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity=f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.snapshot_identity=p_snapshot_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_source_binding_for_composition_basis_v1(p_binding BYTEA) RETURNS TABLE(row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.binding_id,f.fact_digest,NULL::BYTEA,NULL::BYTEA,NULL::TEXT,NULL::BIGINT,f.lineage_root,f.lineage_version,f.aggregate_json,o.event_identity,o.aggregate_identity,o.payload,o.payload_digest,h.lineage_root,h.binding_id,h.fact_digest,h.lineage_version FROM market_data_private.source_binding_facts_v1 f JOIN market_data_private.source_binding_outbox_v1 o ON o.aggregate_identity=f.binding_id JOIN market_data_private.source_binding_heads_v1 h ON h.lineage_root=f.lineage_root WHERE f.binding_id=p_binding $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_universe_selection_for_composition_basis_v1(p_selection BYTEA) RETURNS TABLE(request_identity BYTEA,request_meaning_digest BYTEA,selection_identity BYTEA,record_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,outbox_identity BYTEA,outbox_receipt_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT r.request_identity,r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes FROM market_data_private.universe_selection_records_v1 r JOIN market_data_private.universe_selection_receipts_v1 c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 o ON o.request_identity=r.request_identity WHERE r.selection_identity=p_selection $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_reference_fact_r0_for_composition_basis_v1(p_request BYTEA) RETURNS TABLE(request_identity BYTEA,record_identity BYTEA,request_meaning_digest BYTEA,record_bytes BYTEA,cut_identity BYTEA,cut_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,readback_identity BYTEA,readback_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,payload BYTEA,store_generation_identity BYTEA,state_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT x.request_identity,x.record_identity,x.request_meaning_digest,x.record_bytes,c.cut_identity,c.cut_bytes,p.receipt_identity,p.receipt_bytes,p.readback_identity,p.readback_bytes,p.append_sequence,o.outbox_identity,o.payload,s.store_generation_identity,s.append_sequence FROM market_data_private.reference_fact_r0_records_v1 x JOIN market_data_private.reference_fact_r0_cuts_v1 c ON c.request_identity=x.request_identity JOIN market_data_private.reference_fact_r0_receipts_v1 p ON p.request_identity=x.request_identity JOIN market_data_private.reference_fact_r0_outbox_v1 o ON o.request_identity=x.request_identity CROSS JOIN market_data_private.reference_fact_r0_state_v1 s WHERE s.singleton AND x.request_identity=p_request $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_market_semantics_readback_for_composition_basis_v1(p_request BYTEA) RETURNS TABLE(request_meaning_digest BYTEA,cut_identity BYTEA,cut_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,readback_identity BYTEA,readback_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,payload BYTEA,stored_fact_bytes BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload,f.fact_bytes,s.store_generation_identity,s.append_sequence FROM market_data_private.market_semantics_cuts_v1 c JOIN market_data_private.market_semantics_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.market_semantics_outbox_v1 o ON o.request_identity=c.request_identity JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=r.fact_identity CROSS JOIN market_data_private.market_semantics_state_v1 s WHERE s.singleton AND c.request_identity=p_request $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_market_semantics_scope_heads_v1(p_scope BYTEA) RETURNS TABLE(pit_snapshot_identity BYTEA,request_identity BYTEA,fact_identity BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT h.pit_snapshot_identity,r.request_identity,f.fact_identity,f.fact_bytes FROM market_data_private.market_semantics_heads_v2 h JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=h.fact_identity JOIN market_data_private.market_semantics_receipts_v1 r ON r.fact_identity=h.fact_identity WHERE h.compatibility_scope_identity=p_scope ORDER BY h.pit_snapshot_identity,r.request_identity $function$",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_pit_snapshot_for_composition_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_source_binding_for_composition_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_universe_selection_for_composition_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_reference_fact_r0_for_composition_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_market_semantics_readback_for_composition_basis_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_market_semantics_scope_heads_v1(BYTEA) FROM PUBLIC",
    "DO $grant$ BEGIN IF pg_catalog.to_regrole('rd_owner') IS NOT NULL THEN GRANT EXECUTE ON FUNCTION market_data_rd_api.read_pit_snapshot_for_composition_basis_v1(BYTEA),market_data_rd_api.read_source_binding_for_composition_basis_v1(BYTEA),market_data_rd_api.read_universe_selection_for_composition_basis_v1(BYTEA),market_data_rd_api.read_reference_fact_r0_for_composition_basis_v1(BYTEA),market_data_rd_api.read_market_semantics_readback_for_composition_basis_v1(BYTEA),market_data_rd_api.read_market_semantics_scope_heads_v1(BYTEA) TO rd_owner; END IF; END $grant$",
];

type BasisError = UniverseMemberCompositionBasisErrorV1;

/// Returns the Universe Selection, R0 record, Market Semantics readback and correction policy a
/// universe-member Replay composition over `pit` names, as Market Data holds them.
///
/// Runs in the caller's transaction, reads only, and takes no row locks. Each record is fixed by
/// the snapshot; the caller states nothing but the snapshot and the Source Binding it believes the
/// snapshot was minted under. Every record is checked the way the issuance checks it, so a basis
/// returned here names nothing the issuance would refuse as a dependency mismatch.
///
/// # Errors
///
/// [`UniverseMemberCompositionBasisErrorV1::PitUnavailable`] when no `AVAILABLE` snapshot is stored
/// under exactly `pit`; [`UniverseMemberCompositionBasisErrorV1::SourceBindingMismatch`] when it
/// was minted under another binding; [`UniverseMemberCompositionBasisErrorV1::SourceBindingUnavailable`]
/// when no admitted binding is stored under exactly `source_binding`;
/// [`UniverseMemberCompositionBasisErrorV1::MarketSemanticsNotAdmitted`] when no fact has been
/// admitted for the snapshot in the binding's scope; and
/// [`UniverseMemberCompositionBasisErrorV1::StoreUnavailable`] when the store cannot be read or
/// returns evidence Market Data does not trust.
pub async fn resolve_universe_member_composition_basis_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit: &UntrustedPitSnapshotLocator,
    source_binding: &UntrustedSourceBindingLocator,
) -> Result<UniverseMemberCompositionBasisV1, UniverseMemberCompositionBasisErrorV1> {
    let row = sqlx::query(
        "SELECT * FROM market_data_rd_api.read_pit_snapshot_for_composition_basis_v1($1)",
    )
    .bind(pit.snapshot_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| BasisError::StoreUnavailable)?
    .ok_or(BasisError::PitUnavailable)?;
    let aggregate = super::decode_pit_row(&row, false).map_err(|_| BasisError::StoreUnavailable)?;

    if aggregate.receipt().locator() != pit
        || !PitSnapshotOwnerReadback::from_verified(&aggregate).is_available()
    {
        return Err(BasisError::PitUnavailable);
    }
    let fact = aggregate.fact();
    let request = fact.request();

    if &request.source_binding != source_binding {
        return Err(BasisError::SourceBindingMismatch);
    }
    let stored = read_source_binding_v1(transaction, source_binding)
        .await
        .map_err(|e| match e {
            SourceReadErrorV1::Unavailable => BasisError::SourceBindingUnavailable,
            SourceReadErrorV1::Store => BasisError::StoreUnavailable,
        })?;
    let source = SourceBindingOwnerReadback::from_verified(&stored);

    if !source.is_admitted() {
        return Err(BasisError::SourceBindingUnavailable);
    }

    // The snapshot names this binding by locator; the binding version and frontiers it was minted
    // under must be the stored binding's, as the issuance requires of the declaration's source.
    if source.binding_id() != fact.source_binding_identity()
        || source.lineage_root() != fact.source_binding_lineage_root()
        || source.lineage_version() != fact.source_binding_lineage_version()
        || stored.commit().fact().source_frontier().digest != fact.evidence().source_frontier.digest
        || stored.commit().fact().correction_frontier().digest
            != fact.evidence().correction_frontier.digest
    {
        return Err(BasisError::StoreUnavailable);
    }
    let scope = derive_market_semantics_compatibility_identity_v1(
        &stored.commit().fact().proposal().semantics,
    );

    if scope != request.market_semantics_identity {
        return Err(BasisError::StoreUnavailable);
    }

    let universe = {
        let row = sqlx::query(
            "SELECT * FROM market_data_rd_api.read_universe_selection_for_composition_basis_v1($1)",
        )
        .bind(request.universe_selection_digest.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| BasisError::StoreUnavailable)?
        .ok_or(BasisError::StoreUnavailable)?;
        super::strategy_input_binding_registry::decode_universe_selection_row_v1(
            &row,
            request.universe_selection_digest,
        )
        .map_err(|_| BasisError::StoreUnavailable)?
    };

    if universe.record().source_binding_lineage_root() != fact.source_binding_lineage_root()
        || universe.record().correction_frontier_digest()
            != fact.evidence().correction_frontier.digest
    {
        return Err(BasisError::StoreUnavailable);
    }

    // The R0 record is the one the snapshot's own commit appended, whose request is a function of
    // the snapshot alone.
    let expected_r0 =
        super::reference_fact_coordinates::owner_r0_request_for_available_pit_v1(&aggregate)
            .map_err(|_| BasisError::StoreUnavailable)?;
    let r0 = super::reference_fact_coordinates::read_reference_fact_r0_for_composition_basis_v1(
        transaction,
        expected_r0.request_identity,
    )
    .await
    .map_err(|_| BasisError::StoreUnavailable)?
    .ok_or(BasisError::StoreUnavailable)?;

    if r0.receipt().request_meaning_digest != expected_r0.request_meaning_digest {
        return Err(BasisError::StoreUnavailable);
    }

    let heads = read_scope_heads_v1(transaction, scope)
        .await
        .map_err(|()| BasisError::StoreUnavailable)?;
    let head = match heads
        .iter()
        .filter(|head| head.fact.pit_snapshot_identity == fact.snapshot_identity())
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => return Err(BasisError::MarketSemanticsNotAdmitted),
        [head] => *head,
        _ => return Err(BasisError::StoreUnavailable),
    };
    let semantics =
        super::market_semantics::read_market_semantics_readback_for_composition_basis_v1(
            transaction,
            head.request_identity,
        )
        .await
        .map_err(|_| BasisError::StoreUnavailable)?;

    // The same agreement the issuance requires of the readback it is named: one fact, the head
    // itself, stated about this snapshot and binding, and cut against this R0 record.
    if semantics.facts() != std::slice::from_ref(&head.fact)
        || semantics.cut().r0_cut_identity != r0.cut().identity()
        || semantics.cut().r0_cut_digest != r0.cut().digest()
        || head.fact.pit_fact_digest != pit.fact_digest
        || head.fact.source_binding_identity != source_binding.binding_id
    {
        return Err(BasisError::StoreUnavailable);
    }

    let coordinates =
        verified_coordinates_from_r0_v1(&r0).map_err(|_| BasisError::StoreUnavailable)?;
    let correction = project_first_v1(CorrectionPolicyAuthenticatedInputsV1 {
        source_binding: &source,
        coordinates: &coordinates,
        r0_coordinate_identity: r0.record().identity(),
        r0_coordinate_digest: r0.record().digest(),
    })
    .map_err(|_| BasisError::StoreUnavailable)?;

    Ok(UniverseMemberCompositionBasisV1::new(
        ReplayCompositionRequestLocatorV1::from_untrusted(
            universe.record().request_identity(),
            universe.record().request_meaning_digest(),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            r0.receipt().request_identity,
            r0.receipt().request_meaning_digest,
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            semantics.receipt().request_identity,
            semantics.receipt().request_meaning_digest,
        ),
        ReplayCompositionContentLocatorV1::from_untrusted(
            correction.identity(),
            correction.identity(),
        ),
    ))
}

/// Returns the value the compatibility scope of `source_binding` states today.
///
/// Runs in the caller's transaction, reads only, and takes no row locks. The scope is derived from
/// the binding's own semantics, exactly as the admission derives it, and the value is the one every
/// head of that scope carries.
///
/// # Errors
///
/// [`MarketSemanticsScopeValueErrorV1::SourceBindingUnavailable`] when no binding is stored under
/// exactly `source_binding`, and [`MarketSemanticsScopeValueErrorV1::StoreUnavailable`] when the
/// store cannot be read, returns evidence Market Data does not trust, or holds heads of one scope
/// that state different values.
pub async fn resolve_market_semantics_scope_value_v1(
    transaction: &mut Transaction<'_, Postgres>,
    source_binding: &UntrustedSourceBindingLocator,
) -> Result<MarketSemanticsScopeValueV1, MarketSemanticsScopeValueErrorV1> {
    let stored = read_source_binding_v1(transaction, source_binding)
        .await
        .map_err(|e| match e {
            SourceReadErrorV1::Unavailable => {
                MarketSemanticsScopeValueErrorV1::SourceBindingUnavailable
            }
            SourceReadErrorV1::Store => MarketSemanticsScopeValueErrorV1::StoreUnavailable,
        })?;
    let scope = derive_market_semantics_compatibility_identity_v1(
        &stored.commit().fact().proposal().semantics,
    );
    let heads = read_scope_heads_v1(transaction, scope)
        .await
        .map_err(|()| MarketSemanticsScopeValueErrorV1::StoreUnavailable)?;
    let value = match heads.split_first() {
        None => None,
        Some((first, rest)) => {
            if rest.iter().any(|head| head.fact.value != first.fact.value) {
                return Err(MarketSemanticsScopeValueErrorV1::StoreUnavailable);
            }
            Some(MarketSemanticsValueSubmissionV1::from_value(
                &first.fact.value,
            ))
        }
    };
    Ok(MarketSemanticsScopeValueV1::new(scope, value))
}

enum SourceReadErrorV1 {
    /// No binding is stored under exactly this locator.
    Unavailable,
    /// The store is unreachable or returned rows that do not verify.
    Store,
}

/// The Source Binding stored under exactly `locator`, whether or not it is its lineage's head.
async fn read_source_binding_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedSourceBindingLocator,
) -> Result<SourceBindingStoredAggregate, SourceReadErrorV1> {
    let row = sqlx::query(
        "SELECT * FROM market_data_rd_api.read_source_binding_for_composition_basis_v1($1)",
    )
    .bind(locator.binding_id.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceReadErrorV1::Store)?
    .ok_or(SourceReadErrorV1::Unavailable)?;
    let stored = super::decode_source_row(&row, false).map_err(|_| SourceReadErrorV1::Store)?;

    if stored.commit().receipt().locator() != locator {
        return Err(SourceReadErrorV1::Unavailable);
    }
    Ok(stored)
}

/// One current head of a compatibility scope, with the request its readback is stored under.
struct ScopeHeadV1 {
    request_identity: BindingDigest,
    fact: MarketSemanticsFactV1,
}

/// Every current head of `scope`, each decoded and checked against the row that carried it.
async fn read_scope_heads_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: BindingDigest,
) -> Result<Vec<ScopeHeadV1>, ()> {
    let rows = sqlx::query(
        "SELECT pit_snapshot_identity,request_identity,fact_identity,fact_bytes FROM market_data_rd_api.read_market_semantics_scope_heads_v1($1)",
    )
    .bind(scope.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ())?;
    let digest = |row: &sqlx::postgres::PgRow, column: &str| -> Result<BindingDigest, ()> {
        let bytes: Vec<u8> = row.try_get(column).map_err(|_| ())?;
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| ())?;
        Ok(BindingDigest::from_untrusted_bytes(bytes))
    };
    let mut heads = Vec::with_capacity(rows.len());

    for row in &rows {
        let bytes: Vec<u8> = row.try_get("fact_bytes").map_err(|_| ())?;
        let fact = crate::owner::market_semantics::codec::decode_fact(&bytes).map_err(|_| ())?;

        if fact.identity() != digest(row, "fact_identity")?
            || fact.pit_snapshot_identity != digest(row, "pit_snapshot_identity")?
            || fact.compatibility_scope_identity != scope
        {
            return Err(());
        }
        heads.push(ScopeHeadV1 {
            request_identity: digest(row, "request_identity")?,
            fact,
        });
    }
    Ok(heads)
}
