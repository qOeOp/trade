//! Caller-transaction-owned PostgreSQL custody for the complete observation census.
//!
//! The concrete resolver is deliberately not registered until native Universe Selection can
//! supply its sealed readback in this same transaction. Nothing here opens a pool or mints a V1
//! joined-cut from stored bytes.

#![allow(
    dead_code,
    reason = "W1 transaction leaf awaits W1-U parent composition"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    observation_census::{
        ObservationCensusErrorV1, ObservationCensusReadbackV1, StrategyInputJoinedCutReadbackV1,
        UntrustedObservationCensusLocatorV1, UntrustedObservationCensusRequestV1,
        UntrustedStrategyInputJoinedCutLocatorV1, authority,
    },
    source_binding::BindingDigest,
    strategy_design_role_set::StrategyDesignRoleSetReceiptV1,
};

use super::{load_pit_for_update, strategy_input_binding_registry};

pub(super) const MAX_OBSERVATION_CENSUS_AGGREGATE_BYTES_V1: usize = 32 * 1024 * 1024;

pub(super) const OBSERVATION_CENSUS_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.observation_census_records_v1 (request_identity BYTEA PRIMARY KEY CHECK (octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK (octet_length(request_meaning_digest)=32), request_bytes BYTEA NOT NULL CHECK (octet_length(request_bytes)>0 AND octet_length(request_bytes)<=262144), census_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(census_identity)=32), census_bytes BYTEA NOT NULL, census_receipt_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(census_receipt_identity)=32), census_receipt_bytes BYTEA NOT NULL, joined_cut_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(joined_cut_identity)=32), joined_cut_custody_bytes BYTEA NOT NULL, v1_joined_cut_receipt_digest BYTEA NOT NULL CHECK (octet_length(v1_joined_cut_receipt_digest)=32), outbox_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(outbox_identity)=32), CHECK (octet_length(census_bytes)>0 AND octet_length(census_receipt_bytes)>0 AND octet_length(joined_cut_custody_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.observation_census_dependencies_v1 (request_identity BYTEA NOT NULL REFERENCES market_data_private.observation_census_records_v1(request_identity) ON DELETE RESTRICT, ordinal BIGINT NOT NULL CHECK (ordinal>=0), entry_identity BYTEA NOT NULL CHECK (octet_length(entry_identity)=32), input_role_identity BYTEA NOT NULL CHECK (octet_length(input_role_identity)=32), logical_time BIGINT NOT NULL CHECK (logical_time>0), event_time BIGINT NOT NULL CHECK (event_time>=0), owner_sequence BIGINT NOT NULL CHECK (owner_sequence>0), event_identity BYTEA NOT NULL CHECK (octet_length(event_identity)=16), trigger_digest BYTEA NOT NULL CHECK (octet_length(trigger_digest)=32), value_digest BYTEA NOT NULL CHECK (octet_length(value_digest)=32), entry_bytes BYTEA NOT NULL CHECK (octet_length(entry_bytes)>0), PRIMARY KEY(request_identity,ordinal), UNIQUE(request_identity,input_role_identity,logical_time,event_time,owner_sequence,event_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.observation_census_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), request_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.observation_census_records_v1(request_identity) ON DELETE RESTRICT, payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest)=32), payload BYTEA NOT NULL CHECK (octet_length(payload)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.observation_census_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), aggregate_count BIGINT NOT NULL CHECK (aggregate_count>=0))",
    "REVOKE ALL ON TABLE market_data_private.observation_census_records_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.observation_census_dependencies_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.observation_census_outbox_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.observation_census_state_v1 FROM PUBLIC",
];

struct DependencyEnvelopeV1 {
    entry_identity: BindingDigest,
    input_role_identity: BindingDigest,
    logical_time: u64,
    event_time: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
    trigger_digest: BindingDigest,
    value_digest: BindingDigest,
    entry_bytes: Box<[u8]>,
}

pub(super) struct ObservationCensusWriteEnvelopeV1 {
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
    request_bytes: Box<[u8]>,
    census_identity: BindingDigest,
    census_bytes: Box<[u8]>,
    census_receipt_identity: BindingDigest,
    census_receipt_bytes: Box<[u8]>,
    joined_cut_identity: BindingDigest,
    joined_cut_custody_bytes: Box<[u8]>,
    v1_joined_cut_receipt_digest: BindingDigest,
    outbox_identity: BindingDigest,
    dependencies: Box<[DependencyEnvelopeV1]>,
}

impl ObservationCensusWriteEnvelopeV1 {
    pub(super) fn from_readbacks(
        request: &UntrustedObservationCensusRequestV1,
        census: &ObservationCensusReadbackV1,
        joined: &StrategyInputJoinedCutReadbackV1,
    ) -> Result<Self, ObservationCensusErrorV1> {
        if !authority::verify_observation_census_readback_v1(census)
            || !authority::verify_strategy_input_joined_cut_readback_v1(joined)
            || joined.record().request_identity() != census.record().request_identity()
            || joined.record().request_meaning_digest() != census.record().request_meaning_digest()
            || joined.record().observation_census_identity() != census.record().identity()
            || joined.record().observation_census_digest() != census.record().digest()
            || request.request_identity() != census.record().request_identity()
            || request.request_meaning_digest() != census.record().request_meaning_digest()
        {
            return Err(ObservationCensusErrorV1::DigestMismatch);
        }
        let dependencies = census
            .record()
            .entries()
            .iter()
            .map(|entry| DependencyEnvelopeV1 {
                entry_identity: entry.identity(),
                input_role_identity: entry.input_role_identity(),
                logical_time: entry.logical_time(),
                event_time: entry.event_time(),
                owner_sequence: entry.owner_sequence(),
                event_identity: *entry.event_identity(),
                trigger_digest: entry.trigger_digest(),
                value_digest: entry.value_digest(),
                entry_bytes: entry.canonical_bytes().into(),
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let value = Self {
            request_identity: census.record().request_identity(),
            request_meaning_digest: census.record().request_meaning_digest(),
            request_bytes: authority::encode_observation_census_request_v1(request)?,
            census_identity: census.record().identity(),
            census_bytes: authority::encode_observation_census_storage_v1(census)?,
            census_receipt_identity: census.receipt().identity(),
            census_receipt_bytes: census.receipt().canonical_bytes().into(),
            joined_cut_identity: joined.record().identity(),
            joined_cut_custody_bytes: joined.record().canonical_bytes().into(),
            v1_joined_cut_receipt_digest: joined.record().joined_cut_receipt().digest(),
            outbox_identity: census.receipt().identity(),
            dependencies,
        };
        value.validate()?;
        Ok(value)
    }

    fn validate(&self) -> Result<(), ObservationCensusErrorV1> {
        [
            self.census_bytes.len(),
            self.request_bytes.len(),
            self.census_receipt_bytes.len(),
            self.joined_cut_custody_bytes.len(),
        ]
        .into_iter()
        .chain(
            self.dependencies
                .iter()
                .map(|entry| entry.entry_bytes.len()),
        )
        .try_fold(0_usize, usize::checked_add)
        .filter(|size| *size <= MAX_OBSERVATION_CENSUS_AGGREGATE_BYTES_V1)
        .ok_or(ObservationCensusErrorV1::CapacityExceeded)?;
        let decoded = authority::decode_observation_census_storage_v1(&self.census_bytes)?;
        let decoded_request = authority::decode_observation_census_request_v1(&self.request_bytes)?;
        if decoded_request.request_identity() != self.request_identity
            || decoded_request.request_meaning_digest() != self.request_meaning_digest
            || decoded.record().request_identity() != self.request_identity
            || decoded.record().request_meaning_digest() != self.request_meaning_digest
            || decoded.record().identity() != self.census_identity
            || decoded.receipt().identity() != self.census_receipt_identity
            || decoded.receipt().canonical_bytes() != self.census_receipt_bytes.as_ref()
            || self.outbox_identity != self.census_receipt_identity
            || self.dependencies.len() != decoded.record().entries().len()
        {
            return Err(ObservationCensusErrorV1::DigestMismatch);
        }

        for (stored, decoded) in self.dependencies.iter().zip(decoded.record().entries()) {
            if stored.entry_identity != decoded.identity()
                || stored.input_role_identity != decoded.input_role_identity()
                || stored.logical_time != decoded.logical_time()
                || stored.event_time != decoded.event_time()
                || stored.owner_sequence != decoded.owner_sequence()
                || stored.event_identity != *decoded.event_identity()
                || stored.trigger_digest != decoded.trigger_digest()
                || stored.value_digest != decoded.value_digest()
                || stored.entry_bytes.as_ref() != decoded.canonical_bytes()
            {
                return Err(ObservationCensusErrorV1::DigestMismatch);
            }
        }
        Ok(())
    }
}

pub(super) async fn install_observation_census_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ObservationCensusErrorV1> {
    for statement in OBSERVATION_CENSUS_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    }
    sqlx::query("INSERT INTO market_data_private.observation_census_state_v1(singleton,aggregate_count) VALUES(TRUE,0) ON CONFLICT(singleton) DO NOTHING")
        .execute(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    Ok(())
}

pub(super) async fn commit_observation_census_and_joined_cut_v1(
    transaction: &mut Transaction<'_, Postgres>,
    envelope: &ObservationCensusWriteEnvelopeV1,
) -> Result<(), ObservationCensusErrorV1> {
    envelope.validate()?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex'),0))")
        .bind(envelope.request_identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;

    if let Some(row) = sqlx::query("SELECT request_meaning_digest,request_bytes,census_identity,census_bytes,census_receipt_identity,census_receipt_bytes,joined_cut_identity,joined_cut_custody_bytes,v1_joined_cut_receipt_digest,outbox_identity FROM market_data_private.observation_census_records_v1 WHERE request_identity=$1 FOR UPDATE")
        .bind(envelope.request_identity.as_bytes().as_slice()).fetch_optional(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?
    {
        if row_bytes(&row, "request_meaning_digest")? != envelope.request_meaning_digest.as_bytes() {
            return Err(ObservationCensusErrorV1::RequestConflict);
        }
        let exact = row_bytes(&row, "census_identity")? == envelope.census_identity.as_bytes()
            && row_bytes(&row, "request_bytes")? == envelope.request_bytes.as_ref()
            && row_bytes(&row, "census_bytes")? == envelope.census_bytes.as_ref()
            && row_bytes(&row, "census_receipt_identity")? == envelope.census_receipt_identity.as_bytes()
            && row_bytes(&row, "census_receipt_bytes")? == envelope.census_receipt_bytes.as_ref()
            && row_bytes(&row, "joined_cut_identity")? == envelope.joined_cut_identity.as_bytes()
            && row_bytes(&row, "joined_cut_custody_bytes")? == envelope.joined_cut_custody_bytes.as_ref()
            && row_bytes(&row, "v1_joined_cut_receipt_digest")? == envelope.v1_joined_cut_receipt_digest.as_bytes()
            && row_bytes(&row, "outbox_identity")? == envelope.outbox_identity.as_bytes();

        if !exact {
            return Err(ObservationCensusErrorV1::RequestConflict);
        }
        verify_dependencies(transaction, envelope.request_identity, &envelope.dependencies).await?;
        verify_outbox(transaction, envelope).await?;
        verify_state(transaction).await?;
        return Ok(());
    }
    insert_record(transaction, envelope).await?;
    for (ordinal, entry) in envelope.dependencies.iter().enumerate() {
        insert_dependency(transaction, envelope.request_identity, ordinal, entry).await?;
    }
    sqlx::query("INSERT INTO market_data_private.observation_census_outbox_v1(outbox_identity,request_identity,payload_digest,payload) VALUES($1,$2,$3,$4)")
        .bind(envelope.outbox_identity.as_bytes().as_slice()).bind(envelope.request_identity.as_bytes().as_slice())
        .bind(envelope.census_identity.as_bytes().as_slice()).bind(envelope.census_bytes.as_ref())
        .execute(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    let updated = sqlx::query("UPDATE market_data_private.observation_census_state_v1 SET aggregate_count=aggregate_count+1 WHERE singleton")
        .execute(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    if updated.rows_affected() != 1 {
        return Err(ObservationCensusErrorV1::StoreUnavailable);
    }
    verify_dependencies(
        transaction,
        envelope.request_identity,
        &envelope.dependencies,
    )
    .await?;
    verify_outbox(transaction, envelope).await?;
    verify_state(transaction).await?;
    Ok(())
}

pub(super) async fn resolve_and_commit_observation_census_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedObservationCensusRequestV1,
) -> Result<
    (
        ObservationCensusReadbackV1,
        StrategyInputJoinedCutReadbackV1,
    ),
    ObservationCensusErrorV1,
> {
    let pit = load_pit_for_update(transaction, request.pit_locator().snapshot_identity, false)
        .await
        .map_err(|_| ObservationCensusErrorV1::IncompleteCensus)?
        .ok_or(ObservationCensusErrorV1::IncompleteCensus)?;
    if pit.receipt().locator() != request.pit_locator() {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    let role_identities = request
        .join_claim()
        .roles
        .iter()
        .map(|role| role.input_role_identity)
        .collect::<Vec<_>>();
    let (bindings, frames) =
        strategy_input_binding_registry::resolve_complete_strategy_input_roles_v1(
            transaction,
            request.pit_locator().request_identity,
            request.join_claim().strategy_design_identity,
            &role_identities,
        )
        .await
        .map_err(|e| map_registry_error(&e))?;
    let (census, joined) = authority::issue_observation_census_and_joined_cut_v1(
        request,
        &bindings,
        frames.into_vec(),
    )?;
    let envelope = ObservationCensusWriteEnvelopeV1::from_readbacks(request, &census, &joined)?;
    commit_observation_census_and_joined_cut_v1(transaction, &envelope).await?;
    Ok((census, joined))
}

/// W3 positive composition entrypoint. The role set is resolved by fixed R&D composition before
/// entering this Market Data transaction; caller-proposed V1 join fields cannot authorize it.
pub(super) async fn resolve_and_commit_authenticated_observation_census_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedObservationCensusRequestV1,
    role_set: &StrategyDesignRoleSetReceiptV1,
) -> Result<
    (
        ObservationCensusReadbackV1,
        StrategyInputJoinedCutReadbackV1,
    ),
    ObservationCensusErrorV1,
> {
    if !request_matches_authenticated_role_set_v1(request, role_set) {
        return Err(ObservationCensusErrorV1::JoinedCutUnavailable);
    }
    resolve_and_commit_observation_census_v1(transaction, request).await
}

fn request_matches_authenticated_role_set_v1(
    request: &UntrustedObservationCensusRequestV1,
    role_set: &StrategyDesignRoleSetReceiptV1,
) -> bool {
    let claim = request.join_claim();
    if !role_set.has_valid_integrity() || claim.strategy_design_identity != role_set.design_identity
    {
        return false;
    }
    let Some(join) = role_set
        .joins
        .binary_search_by_key(&claim.join_identity, |join| join.join_identity)
        .ok()
        .map(|index| &role_set.joins[index])
    else {
        return false;
    };
    join.semantic_id == claim.join_semantic_id
        && join.alignment_semantic_id == claim.alignment_semantic_id
        && join.trigger_input_id == claim.trigger_input_id
        && join.max_staleness_ns == claim.max_staleness_ns
        && join.roles.len() == claim.roles.len()
        && join
            .roles
            .iter()
            .zip(&claim.roles)
            .all(|(expected, actual)| {
                expected.semantic_id == actual.semantic_id
                    && expected.role_identity == actual.input_role_identity
            })
}

async fn insert_record(
    transaction: &mut Transaction<'_, Postgres>,
    envelope: &ObservationCensusWriteEnvelopeV1,
) -> Result<(), ObservationCensusErrorV1> {
    sqlx::query("INSERT INTO market_data_private.observation_census_records_v1(request_identity,request_meaning_digest,request_bytes,census_identity,census_bytes,census_receipt_identity,census_receipt_bytes,joined_cut_identity,joined_cut_custody_bytes,v1_joined_cut_receipt_digest,outbox_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(envelope.request_identity.as_bytes().as_slice()).bind(envelope.request_meaning_digest.as_bytes().as_slice())
        .bind(envelope.request_bytes.as_ref()).bind(envelope.census_identity.as_bytes().as_slice()).bind(envelope.census_bytes.as_ref())
        .bind(envelope.census_receipt_identity.as_bytes().as_slice()).bind(envelope.census_receipt_bytes.as_ref())
        .bind(envelope.joined_cut_identity.as_bytes().as_slice()).bind(envelope.joined_cut_custody_bytes.as_ref())
        .bind(envelope.v1_joined_cut_receipt_digest.as_bytes().as_slice()).bind(envelope.outbox_identity.as_bytes().as_slice())
        .execute(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    Ok(())
}

async fn insert_dependency(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: BindingDigest,
    ordinal: usize,
    entry: &DependencyEnvelopeV1,
) -> Result<(), ObservationCensusErrorV1> {
    let ordinal = i64::try_from(ordinal).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    let logical_time = i64::try_from(entry.logical_time)
        .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    let event_time =
        i64::try_from(entry.event_time).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    let owner_sequence = i64::try_from(entry.owner_sequence)
        .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    sqlx::query("INSERT INTO market_data_private.observation_census_dependencies_v1(request_identity,ordinal,entry_identity,input_role_identity,logical_time,event_time,owner_sequence,event_identity,trigger_digest,value_digest,entry_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(request_identity.as_bytes().as_slice()).bind(ordinal).bind(entry.entry_identity.as_bytes().as_slice())
        .bind(entry.input_role_identity.as_bytes().as_slice()).bind(logical_time).bind(event_time).bind(owner_sequence)
        .bind(entry.event_identity.as_slice()).bind(entry.trigger_digest.as_bytes().as_slice())
        .bind(entry.value_digest.as_bytes().as_slice()).bind(entry.entry_bytes.as_ref())
        .execute(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    Ok(())
}

pub(super) async fn load_observation_census_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedObservationCensusLocatorV1,
) -> Result<Option<ObservationCensusReadbackV1>, ObservationCensusErrorV1> {
    let Some(row) = sqlx::query("SELECT request_meaning_digest,request_bytes,census_bytes FROM market_data_private.observation_census_records_v1 WHERE request_identity=$1 FOR SHARE")
        .bind(locator.request_identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)? else { return Ok(None); };
    if row_bytes(&row, "request_meaning_digest")? != locator.request_meaning_digest().as_bytes() {
        return Err(ObservationCensusErrorV1::RequestConflict);
    }
    let request =
        authority::decode_observation_census_request_v1(row_bytes(&row, "request_bytes")?)?;

    if request.locator() != *locator {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let readback =
        authority::decode_observation_census_storage_v1(row_bytes(&row, "census_bytes")?)?;

    if readback.record().request_identity() != locator.request_identity()
        || readback.record().request_meaning_digest() != locator.request_meaning_digest()
    {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let expected = readback
        .record()
        .entries()
        .iter()
        .map(|entry| DependencyEnvelopeV1 {
            entry_identity: entry.identity(),
            input_role_identity: entry.input_role_identity(),
            logical_time: entry.logical_time(),
            event_time: entry.event_time(),
            owner_sequence: entry.owner_sequence(),
            event_identity: *entry.event_identity(),
            trigger_digest: entry.trigger_digest(),
            value_digest: entry.value_digest(),
            entry_bytes: entry.canonical_bytes().into(),
        })
        .collect::<Vec<_>>();
    verify_dependencies(transaction, locator.request_identity(), &expected).await?;
    let outbox = sqlx::query("SELECT payload_digest,payload FROM market_data_private.observation_census_outbox_v1 WHERE request_identity=$1 FOR SHARE")
        .bind(locator.request_identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?
        .ok_or(ObservationCensusErrorV1::CommitInterrupted)?;

    if row_bytes(&outbox, "payload_digest")? != readback.record().identity().as_bytes()
        || row_bytes(&outbox, "payload")? != row_bytes(&row, "census_bytes")?
    {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    verify_state(transaction).await?;
    Ok(Some(readback))
}

pub(super) async fn load_observation_census_request_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedObservationCensusLocatorV1,
) -> Result<Option<UntrustedObservationCensusRequestV1>, ObservationCensusErrorV1> {
    let Some(row) = sqlx::query("SELECT request_meaning_digest,request_bytes FROM market_data_private.observation_census_records_v1 WHERE request_identity=$1 FOR SHARE")
        .bind(locator.request_identity().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)? else { return Ok(None); };
    if row_bytes(&row, "request_meaning_digest")? != locator.request_meaning_digest().as_bytes() {
        return Err(ObservationCensusErrorV1::RequestConflict);
    }
    let request =
        authority::decode_observation_census_request_v1(row_bytes(&row, "request_bytes")?)?;

    if request.locator() != *locator {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    Ok(Some(request))
}

pub(super) async fn load_strategy_input_joined_cut_custody_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedStrategyInputJoinedCutLocatorV1,
) -> Result<
    Option<(
        UntrustedObservationCensusRequestV1,
        Box<[u8]>,
        BindingDigest,
    )>,
    ObservationCensusErrorV1,
> {
    let Some(row) = sqlx::query("SELECT request_bytes,joined_cut_identity,joined_cut_custody_bytes,v1_joined_cut_receipt_digest FROM market_data_private.observation_census_records_v1 WHERE joined_cut_identity=$1 FOR SHARE")
        .bind(locator.joined_cut_identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)? else { return Ok(None); };
    if row_bytes(&row, "joined_cut_identity")? != locator.joined_cut_digest().as_bytes() {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let custody = row_bytes(&row, "joined_cut_custody_bytes")?
        .to_vec()
        .into_boxed_slice();
    let digest: [u8; 32] = row_bytes(&row, "v1_joined_cut_receipt_digest")?
        .try_into()
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
    let request =
        authority::decode_observation_census_request_v1(row_bytes(&row, "request_bytes")?)?;
    Ok(Some((
        request,
        custody,
        BindingDigest::from_untrusted_bytes(digest),
    )))
}

fn row_bytes<'a>(
    row: &'a sqlx::postgres::PgRow,
    column: &str,
) -> Result<&'a [u8], ObservationCensusErrorV1> {
    row.try_get::<&[u8], _>(column)
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)
}

async fn verify_dependencies(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: BindingDigest,
    expected: &[DependencyEnvelopeV1],
) -> Result<(), ObservationCensusErrorV1> {
    let rows = sqlx::query("SELECT ordinal,entry_identity,input_role_identity,logical_time,event_time,owner_sequence,event_identity,trigger_digest,value_digest,entry_bytes FROM market_data_private.observation_census_dependencies_v1 WHERE request_identity=$1 ORDER BY ordinal FOR SHARE")
        .bind(request_identity.as_bytes().as_slice()).fetch_all(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
    if rows.len() != expected.len() {
        return Err(ObservationCensusErrorV1::CommitInterrupted);
    }

    for (ordinal, (row, entry)) in rows.iter().zip(expected).enumerate() {
        let ordinal =
            i64::try_from(ordinal).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
        let logical_time = i64::try_from(entry.logical_time)
            .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
        let event_time = i64::try_from(entry.event_time)
            .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
        let owner_sequence = i64::try_from(entry.owner_sequence)
            .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
        if row
            .try_get::<i64, _>("ordinal")
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?
            != ordinal
            || row_bytes(row, "entry_identity")? != entry.entry_identity.as_bytes()
            || row_bytes(row, "input_role_identity")? != entry.input_role_identity.as_bytes()
            || row
                .try_get::<i64, _>("logical_time")
                .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?
                != logical_time
            || row
                .try_get::<i64, _>("event_time")
                .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?
                != event_time
            || row
                .try_get::<i64, _>("owner_sequence")
                .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?
                != owner_sequence
            || row_bytes(row, "event_identity")? != entry.event_identity
            || row_bytes(row, "trigger_digest")? != entry.trigger_digest.as_bytes()
            || row_bytes(row, "value_digest")? != entry.value_digest.as_bytes()
            || row_bytes(row, "entry_bytes")? != entry.entry_bytes.as_ref()
        {
            return Err(ObservationCensusErrorV1::DigestMismatch);
        }
    }
    Ok(())
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    envelope: &ObservationCensusWriteEnvelopeV1,
) -> Result<(), ObservationCensusErrorV1> {
    let row = sqlx::query("SELECT outbox_identity,payload_digest,payload FROM market_data_private.observation_census_outbox_v1 WHERE request_identity=$1 FOR SHARE")
        .bind(envelope.request_identity.as_bytes().as_slice()).fetch_optional(&mut **transaction).await
        .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?
        .ok_or(ObservationCensusErrorV1::CommitInterrupted)?;

    if row_bytes(&row, "outbox_identity")? != envelope.outbox_identity.as_bytes()
        || row_bytes(&row, "payload_digest")? != envelope.census_identity.as_bytes()
        || row_bytes(&row, "payload")? != envelope.census_bytes.as_ref()
    {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    Ok(())
}

async fn verify_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ObservationCensusErrorV1> {
    let row = sqlx::query("SELECT s.aggregate_count,(SELECT COUNT(*) FROM market_data_private.observation_census_records_v1) AS record_count,(SELECT COUNT(*) FROM market_data_private.observation_census_outbox_v1) AS outbox_count FROM market_data_private.observation_census_state_v1 AS s WHERE s.singleton FOR SHARE")
        .fetch_optional(&mut **transaction).await.map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?
        .ok_or(ObservationCensusErrorV1::CommitInterrupted)?;
    let aggregate_count = row
        .try_get::<i64, _>("aggregate_count")
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
    let record_count = row
        .try_get::<i64, _>("record_count")
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
    let outbox_count = row
        .try_get::<i64, _>("outbox_count")
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
    if aggregate_count != record_count || aggregate_count != outbox_count {
        return Err(ObservationCensusErrorV1::CommitInterrupted);
    }
    Ok(())
}

fn map_registry_error(
    error: &strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
) -> ObservationCensusErrorV1 {
    use strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1 as Registry;
    match error {
        Registry::MarketSemanticsUnavailable => {
            ObservationCensusErrorV1::MarketSemanticsUnavailable
        }
        Registry::UnknownDeclaration => ObservationCensusErrorV1::IncompleteCensus,
        Registry::StrategyDesignRoleSetUnavailable => {
            ObservationCensusErrorV1::JoinedCutUnavailable
        }
        Registry::RequestConflict => ObservationCensusErrorV1::RequestConflict,
        Registry::StoreUnavailable => ObservationCensusErrorV1::StoreUnavailable,
        Registry::StoreUntrusted => ObservationCensusErrorV1::DigestMismatch,
        Registry::InvalidRequest
        | Registry::CapacityExceeded
        | Registry::CodecMismatch
        | Registry::PitUnavailable
        | Registry::UniverseUnavailable
        | Registry::SourceUnavailable
        | Registry::InstrumentMasterUnavailable
        | Registry::BindingUnavailable(_) => ObservationCensusErrorV1::IncompleteCensus,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn schema_keeps_records_dependencies_outbox_and_state_write_once() {
        assert_eq!(OBSERVATION_CENSUS_SCHEMA_V1.len(), 8);
        let schema = OBSERVATION_CENSUS_SCHEMA_V1.join("\n");

        for table in [
            "observation_census_records_v1",
            "observation_census_dependencies_v1",
            "observation_census_outbox_v1",
            "observation_census_state_v1",
        ] {
            assert!(schema.contains(table));
        }
        assert!(schema.contains("ON DELETE RESTRICT"));
        assert!(!schema.contains("ON DELETE CASCADE"));
        assert!(!schema.contains("CREATE OR REPLACE"));
        assert_eq!(schema.matches("REVOKE ALL ON TABLE").count(), 4);
    }

    #[rstest]
    fn transaction_leaf_has_no_pool_or_caller_frame_columns() {
        let schema = OBSERVATION_CENSUS_SCHEMA_V1.join("\n");
        assert!(!schema.contains("caller"));
        assert!(!schema.contains("frame_bytes"));
        assert!(schema.contains("entry_bytes"));
        assert!(schema.contains("v1_joined_cut_receipt_digest"));
        assert!(schema.contains("request_bytes"));
    }

    #[rstest]
    fn production_composition_registers_only_census_and_not_replay_v2() {
        let composition = include_str!("../postgres.rs");
        assert!(composition.contains("install_observation_census_schema_v1(&mut transaction)"));
        assert!(composition.contains(
            "impl super::observation_census::resolver_seal::Sealed for MarketDataOwnerPostgres"
        ));
        let semantics = composition
            .find("install_market_semantics_schema_v1(&mut transaction)")
            .unwrap();
        let registry = composition
            .find("install_strategy_input_binding_registry_schema_v1(")
            .unwrap();
        let census = composition
            .find("install_observation_census_schema_v1(&mut transaction)")
            .unwrap();
        assert!(semantics < registry && registry < census);
        assert!(!composition.contains("install_replay_market_facts_v2"));
        assert!(!composition.contains(
            "impl super::replay_market_facts_v2::resolver_seal::Sealed for MarketDataOwnerPostgres"
        ));
    }
}
