//! Caller-transaction PostgreSQL custody for native Session V1.

#![allow(dead_code, reason = "Session is intentionally not globally installed")]

use crate::owner::{
    calendar::UntrustedCalendarLocatorV1,
    reference_fact_catalog::{ReferenceFactCatalogValueV1, UntrustedReferenceFactCatalogLocatorV1},
    session::{
        InstrumentMasterReferenceV1, SessionDependenciesV1, SessionErrorV1, SessionFactProposalV1,
        SessionIdentityV1, SessionReadbackV1, UntrustedSessionLocatorV1, UntrustedSessionRequestV1,
        authority::{
            prepare_resolution_v1, rejoin_stored_v1, request_meaning_digest_v1, seal_readback_v1,
        },
        codec,
    },
    source_binding::BindingDigest,
    time_zone::UntrustedTimeZoneLocatorV1,
};
use sqlx::{Postgres, Row, Transaction};

type StoredSessionPredecessorRow = (Vec<u8>, Vec<u8>, i32, i64, Vec<u8>);

pub(super) const SESSION_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_state_v1(singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32),append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_facts_v1(fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32),session_identity BYTEA NOT NULL CHECK(octet_length(session_identity)>0),trading_day INTEGER NOT NULL,interval_ordinal BIGINT NOT NULL CHECK(interval_ordinal>=0),lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),predecessor_identity BYTEA NULL REFERENCES market_data_private.session_facts_v1(fact_identity),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0),UNIQUE(lineage_root,correction_sequence),UNIQUE(session_identity,trading_day,interval_ordinal,fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_heads_v1(session_identity BYTEA NOT NULL,trading_day INTEGER NOT NULL,interval_ordinal BIGINT NOT NULL CHECK(interval_ordinal>=0),fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.session_facts_v1(fact_identity),PRIMARY KEY(session_identity,trading_day,interval_ordinal))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_cuts_v1(cut_identity BYTEA PRIMARY KEY CHECK(octet_length(cut_identity)=32),request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32),request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32),cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_cut_facts_v1(cut_identity BYTEA NOT NULL REFERENCES market_data_private.session_cuts_v1(cut_identity),ordinal BIGINT NOT NULL CHECK(ordinal>0),fact_identity BYTEA NOT NULL REFERENCES market_data_private.session_facts_v1(fact_identity),PRIMARY KEY(cut_identity,ordinal),UNIQUE(cut_identity,fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_receipts_v1(request_identity BYTEA PRIMARY KEY,request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.session_cuts_v1(cut_identity),receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.session_outbox_v1(outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32),request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.session_receipts_v1(request_identity),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0))",
    "REVOKE ALL ON TABLE market_data_private.session_state_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_heads_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_cuts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_cut_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_receipts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.session_outbox_v1 FROM PUBLIC",
];

pub(super) struct SessionNativeResolutionV1 {
    pub(super) calendar_locator: UntrustedCalendarLocatorV1,
    pub(super) time_zone_locator: UntrustedTimeZoneLocatorV1,
    pub(super) instrument_master: InstrumentMasterReferenceV1,
    pub(super) proposals: Vec<SessionFactProposalV1>,
    pub(super) r0_cut_identity: BindingDigest,
    pub(super) r0_cut_digest: BindingDigest,
}

pub(super) async fn install_session_schema_v1(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), SessionErrorV1> {
    for s in SESSION_SCHEMA_V1 {
        sqlx::query(*s)
            .execute(&mut **tx)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn resolve_session_in_transaction_v1(
    tx: &mut Transaction<'_, Postgres>,
    request: UntrustedSessionRequestV1,
    inputs: SessionNativeResolutionV1,
) -> Result<SessionReadbackV1, SessionErrorV1> {
    sqlx::query("SAVEPOINT market_data_session_v1")
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    let result = resolve_inner(tx, request, inputs).await;
    match result {
        Ok(v) => {
            sqlx::query("RELEASE SAVEPOINT market_data_session_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            Ok(v)
        }
        Err(e) => {
            sqlx::query("ROLLBACK TO SAVEPOINT market_data_session_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            sqlx::query("RELEASE SAVEPOINT market_data_session_v1")
                .execute(&mut **tx)
                .await
                .map_err(store_error)?;
            Err(e)
        }
    }
}

async fn resolve_inner(
    tx: &mut Transaction<'_, Postgres>,
    request: UntrustedSessionRequestV1,
    inputs: SessionNativeResolutionV1,
) -> Result<SessionReadbackV1, SessionErrorV1> {
    let SessionNativeResolutionV1 {
        calendar_locator,
        time_zone_locator,
        instrument_master,
        proposals,
        r0_cut_identity,
        r0_cut_digest,
    } = inputs;
    let calendar_locator_bytes = locator_bytes(
        calendar_locator.request_identity(),
        calendar_locator.request_meaning_digest(),
    );
    let time_zone_locator_bytes = locator_bytes(
        time_zone_locator.request_identity,
        time_zone_locator.request_meaning_digest,
    );

    if request.calendar_cut_locator_bytes.as_ref() != calendar_locator_bytes
        || request.time_zone_cut_locator_bytes.as_ref() != time_zone_locator_bytes
    {
        return Err(SessionErrorV1::InvalidDependency);
    }
    let (instrument_master, instrument_calendar, instrument_session, instrument_time_zone) =
        recover_instrument_master_reference_v1(tx, &instrument_master).await?;
    let calendar = super::calendar::recover_calendar_v1(tx, calendar_locator)
        .await
        .map_err(map_calendar_error)?;
    let time_zone = super::time_zone::recover_time_zone_in_transaction_v1(tx, time_zone_locator)
        .await
        .map_err(map_time_zone_error)?;

    if request.session_identity.as_ref() != instrument_session.as_ref()
        || calendar.cut().calendar_identity() != instrument_calendar.as_ref()
        || time_zone
            .facts()
            .iter()
            .any(|fact| fact.time_zone_identity() != instrument_time_zone.as_ref())
    {
        return Err(SessionErrorV1::InvalidDependency);
    }
    let source_locator = request.source_binding_locator_bytes.to_vec();
    let r0_locator = request.r0_locator_bytes.to_vec();
    let deps = SessionDependenciesV1 {
        calendar: &calendar,
        time_zone: &time_zone,
        instrument_master,
        calendar_cut_locator_bytes: &calendar_locator_bytes,
        time_zone_cut_locator_bytes: &time_zone_locator_bytes,
        source_binding_locator_bytes: &source_locator,
        r0_locator_bytes: &r0_locator,
    };
    let meaning = request_meaning_digest_v1(&request, &deps.instrument_master)?;
    advisory_lock(tx, request.request_identity).await?;
    if let Some(readback) = load(tx, request.request_identity).await? {
        if readback.cut.request_meaning_digest != meaning {
            return Err(SessionErrorV1::RequestConflict);
        }
        return Ok(readback);
    }
    let mut catalog_entries = Vec::with_capacity(proposals.len());
    for proposal in &proposals {
        let entry = super::reference_fact_catalog::resolve_reference_fact_catalog_entry_v1(
            tx,
            proposal.catalog_locator,
        )
        .await
        .map_err(map_catalog_error)?
        .ok_or(SessionErrorV1::InvalidDependency)?;
        catalog_entries.push(entry);
    }
    let prepared = prepare_resolution_v1(
        request,
        &deps,
        proposals,
        catalog_entries,
        r0_cut_identity,
        r0_cut_digest,
    )?;
    sqlx::query("SELECT pg_advisory_xact_lock(6004799503164006721)")
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    let mut state:Option<(Vec<u8>,i64)>=sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.session_state_v1 WHERE singleton FOR UPDATE").fetch_optional(&mut **tx).await.map_err(store_error)?;
    if state.is_none() {
        let seed: String = sqlx::query_scalar(
            "SELECT current_database() || ':' || pg_catalog.gen_random_uuid()::text",
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(store_error)?;
        let generation = codec::digest(
            b"vibe.market-data.session-store-generation.v1\0",
            seed.as_bytes(),
        );
        sqlx::query("INSERT INTO market_data_private.session_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0)").bind(generation.as_bytes().as_slice()).execute(&mut **tx).await.map_err(store_error)?;
        state = Some((generation.as_bytes().to_vec(), 0));
    }
    let state = state.ok_or(SessionErrorV1::StoreUntrusted)?;
    let generation = digest_row(state.0.clone())?;
    let sequence = u64::try_from(state.1)
        .map_err(|_| SessionErrorV1::StoreUntrusted)?
        .checked_add(1)
        .ok_or(SessionErrorV1::CapacityExceeded)?;
    let readback = seal_readback_v1(prepared, generation, sequence)?;
    for fact in readback.facts() {
        advisory_lock(tx, fact.identity).await?;
        let existing:Option<Vec<u8>>=sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.session_facts_v1 WHERE fact_identity=$1 FOR UPDATE").bind(fact.identity.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
        if let Some(bytes) = existing {
            if bytes != fact.canonical_bytes() {
                return Err(SessionErrorV1::StoreUntrusted);
            }
        } else {
            if let Some(predecessor) = fact.predecessor_identity {
                let prior:Option<StoredSessionPredecessorRow>=sqlx::query_as("SELECT lineage_root,session_identity,trading_day,interval_ordinal,fact_bytes FROM market_data_private.session_facts_v1 WHERE fact_identity=$1 FOR SHARE").bind(predecessor.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
                let Some((prior_lineage, prior_session, prior_day, prior_ordinal, prior_bytes)) =
                    prior
                else {
                    return Err(SessionErrorV1::InvalidDependency);
                };
                let prior_fact = crate::owner::session::authority::decode_fact(&prior_bytes)?;
                let catalog = load_catalog_for_fact(tx, fact).await?;
                let prior_catalog = load_catalog_for_fact(tx, &prior_fact).await?;

                if prior_lineage != fact.lineage_root.as_bytes().as_slice()
                    || prior_session != fact.session_identity.as_ref()
                    || prior_day != fact.trading_day
                    || u32::try_from(prior_ordinal).ok() != Some(fact.interval_ordinal)
                    || prior_fact.identity() != predecessor
                    || catalog.predecessor_identity() != Some(prior_fact.catalog_entry_identity())
                    || catalog.scope_identity() != prior_catalog.scope_identity()
                    || catalog.source().source_binding_lineage_root
                        != prior_catalog.source().source_binding_lineage_root
                    || prior_catalog
                        .source()
                        .source_binding_lineage_version
                        .checked_add(1)
                        != Some(catalog.source().source_binding_lineage_version)
                {
                    return Err(SessionErrorV1::InvalidDependency);
                }
            }
            sqlx::query("INSERT INTO market_data_private.session_facts_v1(fact_identity,session_identity,trading_day,interval_ordinal,lineage_root,predecessor_identity,correction_sequence,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(fact.identity.as_bytes().as_slice()).bind(&fact.session_identity).bind(fact.trading_day).bind(i64::from(fact.interval_ordinal)).bind(fact.lineage_root.as_bytes().as_slice()).bind(fact.predecessor_identity.map(|v|v.as_bytes().to_vec())).bind(i64::try_from(fact.correction_sequence).map_err(|_|SessionErrorV1::CapacityExceeded)?).bind(fact.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
        }
        let head:Option<Vec<u8>>=sqlx::query_scalar("SELECT fact_identity FROM market_data_private.session_heads_v1 WHERE session_identity=$1 AND trading_day=$2 AND interval_ordinal=$3 FOR UPDATE").bind(&fact.session_identity).bind(fact.trading_day).bind(i64::from(fact.interval_ordinal)).fetch_optional(&mut **tx).await.map_err(store_error)?;
        match head {
            None if fact.predecessor_identity.is_none() => {
                sqlx::query("INSERT INTO market_data_private.session_heads_v1(session_identity,trading_day,interval_ordinal,fact_identity) VALUES($1,$2,$3,$4)").bind(&fact.session_identity).bind(fact.trading_day).bind(i64::from(fact.interval_ordinal)).bind(fact.identity.as_bytes().as_slice()).execute(&mut **tx).await.map_err(store_error)?;
            }
            Some(v) if v == fact.identity.as_bytes().as_slice() => {}
            Some(v)
                if fact
                    .predecessor_identity
                    .is_some_and(|p| p.as_bytes().as_slice() == v) =>
            {
                sqlx::query("UPDATE market_data_private.session_heads_v1 SET fact_identity=$4 WHERE session_identity=$1 AND trading_day=$2 AND interval_ordinal=$3").bind(&fact.session_identity).bind(fact.trading_day).bind(i64::from(fact.interval_ordinal)).bind(fact.identity.as_bytes().as_slice()).execute(&mut **tx).await.map_err(store_error)?;
            }
            _ => return Err(SessionErrorV1::RequestConflict),
        }
    }
    sqlx::query("INSERT INTO market_data_private.session_cuts_v1(cut_identity,request_identity,request_meaning_digest,cut_bytes) VALUES($1,$2,$3,$4)").bind(readback.cut.identity.as_bytes().as_slice()).bind(readback.cut.request_identity.as_bytes().as_slice()).bind(readback.cut.request_meaning_digest.as_bytes().as_slice()).bind(readback.cut.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
    for (index, fact) in readback.facts().iter().enumerate() {
        sqlx::query("INSERT INTO market_data_private.session_cut_facts_v1(cut_identity,ordinal,fact_identity) VALUES($1,$2,$3)").bind(readback.cut.identity.as_bytes().as_slice()).bind(i64::try_from(index+1).map_err(|_|SessionErrorV1::CapacityExceeded)?).bind(fact.identity.as_bytes().as_slice()).execute(&mut **tx).await.map_err(store_error)?;
    }
    sqlx::query("INSERT INTO market_data_private.session_receipts_v1(request_identity,request_meaning_digest,cut_identity,receipt_identity,receipt_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6)").bind(readback.receipt.request_identity.as_bytes().as_slice()).bind(readback.receipt.request_meaning_digest.as_bytes().as_slice()).bind(readback.receipt.cut_identity.as_bytes().as_slice()).bind(readback.receipt.identity.as_bytes().as_slice()).bind(&readback.receipt.canonical_bytes).bind(i64::try_from(sequence).map_err(|_|SessionErrorV1::CapacityExceeded)?).execute(&mut **tx).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.session_outbox_v1(outbox_identity,request_identity,receipt_bytes) VALUES($1,$2,$3)").bind(readback.outbox_identity.as_bytes().as_slice()).bind(readback.receipt.request_identity.as_bytes().as_slice()).bind(&readback.receipt.canonical_bytes).execute(&mut **tx).await.map_err(store_error)?;
    let updated=sqlx::query("UPDATE market_data_private.session_state_v1 SET append_sequence=$1 WHERE singleton AND store_generation_identity=$2 AND append_sequence=$3").bind(i64::try_from(sequence).map_err(|_|SessionErrorV1::CapacityExceeded)?).bind(generation.as_bytes().as_slice()).bind(state.1).execute(&mut **tx).await.map_err(store_error)?;
    if updated.rows_affected() != 1 {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

pub(super) async fn recover_session_in_transaction_v1(
    tx: &mut Transaction<'_, Postgres>,
    locator: UntrustedSessionLocatorV1,
) -> Result<SessionReadbackV1, SessionErrorV1> {
    advisory_lock(tx, locator.request_identity).await?;
    let readback = load(tx, locator.request_identity)
        .await?
        .ok_or(SessionErrorV1::UnknownIdentity)?;
    if readback.cut.request_meaning_digest != locator.request_meaning_digest {
        return Err(SessionErrorV1::RequestConflict);
    }
    Ok(readback)
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    request: SessionIdentityV1,
) -> Result<Option<SessionReadbackV1>, SessionErrorV1> {
    let row=sqlx::query("SELECT c.cut_identity,c.request_meaning_digest AS cut_meaning,c.cut_bytes,r.request_meaning_digest AS receipt_meaning,r.cut_identity AS receipt_cut,r.receipt_identity,r.receipt_bytes,r.append_sequence,o.outbox_identity,o.receipt_bytes AS payload FROM market_data_private.session_cuts_v1 c JOIN market_data_private.session_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.session_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1 FOR UPDATE OF c,r,o").bind(request.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
    let Some(row) = row else {
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.session_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.session_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.session_outbox_v1 WHERE request_identity=$1)")
            .bind(request.as_bytes().as_slice()).fetch_one(&mut **tx).await.map_err(store_error)?;
        return if partial {
            Err(SessionErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let cut_identity: Vec<u8> = row.try_get("cut_identity").map_err(store_error)?;
    let cut_meaning: Vec<u8> = row.try_get("cut_meaning").map_err(store_error)?;
    let cut_bytes: Vec<u8> = row.try_get("cut_bytes").map_err(store_error)?;
    let receipt_meaning: Vec<u8> = row.try_get("receipt_meaning").map_err(store_error)?;
    let receipt_cut: Vec<u8> = row.try_get("receipt_cut").map_err(store_error)?;
    let receipt_identity: Vec<u8> = row.try_get("receipt_identity").map_err(store_error)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let append: i64 = row.try_get("append_sequence").map_err(store_error)?;
    let outbox = digest_row(row.try_get("outbox_identity").map_err(store_error)?)?;
    let payload: Vec<u8> = row.try_get("payload").map_err(store_error)?;

    if cut_identity
        != codec::digest(codec::CUT_DOMAIN, &cut_bytes)
            .as_bytes()
            .as_slice()
        || receipt_identity
            != codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes)
                .as_bytes()
                .as_slice()
    {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let facts:Vec<Vec<u8>>=sqlx::query_scalar("SELECT f.fact_bytes FROM market_data_private.session_cut_facts_v1 j JOIN market_data_private.session_facts_v1 f ON f.fact_identity=j.fact_identity WHERE j.cut_identity=$1 ORDER BY j.ordinal FOR SHARE OF j,f").bind(&cut_identity).fetch_all(&mut **tx).await.map_err(store_error)?;
    let readback = rejoin_stored_v1(&facts, &cut_bytes, &receipt_bytes, outbox, &payload)?;
    let state:Option<(Vec<u8>,i64)>=sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.session_state_v1 WHERE singleton FOR SHARE").fetch_optional(&mut **tx).await.map_err(store_error)?;
    let Some((generation, state_sequence)) = state else {
        return Err(SessionErrorV1::StoreUntrusted);
    };

    if cut_meaning != readback.cut.request_meaning_digest.as_bytes().as_slice()
        || receipt_meaning
            != readback
                .receipt
                .request_meaning_digest
                .as_bytes()
                .as_slice()
        || receipt_cut != readback.receipt.cut_identity.as_bytes().as_slice()
        || append <= 0
        || u64::try_from(append).ok() != Some(readback.receipt.append_sequence)
        || generation
            != readback
                .receipt
                .store_generation_identity
                .as_bytes()
                .as_slice()
        || state_sequence < append
    {
        return Err(SessionErrorV1::StoreUntrusted);
    }

    for fact in readback.facts() {
        load_catalog_for_fact(tx, fact).await?;
        let head:Option<Vec<u8>>=sqlx::query_scalar("SELECT fact_identity FROM market_data_private.session_heads_v1 WHERE session_identity=$1 AND trading_day=$2 AND interval_ordinal=$3 FOR SHARE").bind(&fact.session_identity).bind(fact.trading_day).bind(i64::from(fact.interval_ordinal)).fetch_optional(&mut **tx).await.map_err(store_error)?;
        if head.as_deref() != Some(fact.identity().as_bytes().as_slice()) {
            return Err(SessionErrorV1::StoreUntrusted);
        }
    }
    Ok(Some(readback))
}

async fn load_catalog_for_fact(
    tx: &mut Transaction<'_, Postgres>,
    fact: &crate::owner::session::SessionFactV1,
) -> Result<crate::owner::reference_fact_catalog::ReferenceFactCatalogEntryV1, SessionErrorV1> {
    let identity = fact.catalog_entry_identity();
    let entry = super::reference_fact_catalog::resolve_reference_fact_catalog_entry_v1(
        tx,
        UntrustedReferenceFactCatalogLocatorV1::from_untrusted(identity, identity),
    )
    .await
    .map_err(map_catalog_error)?
    .ok_or(SessionErrorV1::StoreUntrusted)?;
    let source = entry.source();
    let value_matches = match entry.value() {
        ReferenceFactCatalogValueV1::Session {
            session_identity,
            trading_day,
            interval_ordinal,
            local_open,
            local_close,
        } => {
            session_identity.as_ref() == fact.session_identity.as_ref()
                && *trading_day == fact.trading_day
                && *interval_ordinal == fact.interval_ordinal
                && local_open.day == fact.local_open.day
                && local_open.nanos_of_day == fact.local_open.nanos_of_day
                && local_open.resolution as u8 == fact.local_open.resolution as u8
                && local_close.day == fact.local_close.day
                && local_close.nanos_of_day == fact.local_close.nanos_of_day
                && local_close.resolution as u8 == fact.local_close.resolution as u8
        }
        _ => false,
    };

    if entry.scope_identity() != fact.lineage_root
        || entry.correction_sequence() != fact.correction_sequence
        || source.source_binding_identity != fact.source_binding_identity
        || source.source_binding_fact_digest != fact.source_binding_fact_digest
        || source.source_binding_lineage_root != fact.source_binding_lineage_root
        || source.source_binding_lineage_version != fact.source_binding_lineage_version
        || source.source_frontier_digest != fact.source_frontier_digest
        || source.correction_frontier_digest != fact.correction_frontier_digest
        || !value_matches
    {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    Ok(entry)
}

fn map_catalog_error(
    error: crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1,
) -> SessionErrorV1 {
    match error {
        crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1::StoreUnavailable => {
            SessionErrorV1::StoreUnavailable
        }
        crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1::StoreUntrusted => {
            SessionErrorV1::StoreUntrusted
        }
        _ => SessionErrorV1::InvalidDependency,
    }
}

fn locator_bytes(identity: BindingDigest, meaning: BindingDigest) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(64);
    bytes.extend_from_slice(identity.as_bytes());
    bytes.extend_from_slice(meaning.as_bytes());
    bytes
}
async fn recover_instrument_master_reference_v1(
    tx: &mut Transaction<'_, Postgres>,
    untrusted: &InstrumentMasterReferenceV1,
) -> Result<(InstrumentMasterReferenceV1, Box<[u8]>, Box<[u8]>, Box<[u8]>), SessionErrorV1> {
    let bytes: &[u8] = &untrusted.locator_bytes;
    if bytes.len() != 64 {
        return Err(SessionErrorV1::InvalidDependency);
    }
    let request_identity = BindingDigest::from_untrusted_bytes(
        bytes[..32]
            .try_into()
            .map_err(|_| SessionErrorV1::InvalidDependency)?,
    );
    let request_meaning_digest = BindingDigest::from_untrusted_bytes(
        bytes[32..]
            .try_into()
            .map_err(|_| SessionErrorV1::InvalidDependency)?,
    );
    let readback = super::load_durable_instrument_readback(tx, request_identity, false)
        .await
        .map_err(map_instrument_master_error)?
        .ok_or(SessionErrorV1::InvalidDependency)?;

    if readback.request_meaning_digest != request_meaning_digest
        || readback.facts().len() != 1
        || readback.cut().expected_members().len() != 1
    {
        return Err(SessionErrorV1::InvalidDependency);
    }
    let fact = &readback.facts()[0];
    let canonical = InstrumentMasterReferenceV1 {
        locator_bytes: locator_bytes(request_identity, request_meaning_digest).into_boxed_slice(),
        readback_identity: readback.digest(),
        fact_digest: readback.facts()[0].digest(),
        cut_digest: readback.cut().digest(),
    };

    if untrusted != &canonical {
        return Err(SessionErrorV1::InvalidDependency);
    }
    Ok((
        canonical,
        fact.calendar_identity().as_bytes().into(),
        fact.session_identity().as_bytes().into(),
        fact.time_zone_identity().as_bytes().into(),
    ))
}
fn map_instrument_master_error(
    error: crate::owner::instrument_master::InstrumentMasterError,
) -> SessionErrorV1 {
    match error {
        crate::owner::instrument_master::InstrumentMasterError::StoreUnavailable => {
            SessionErrorV1::StoreUnavailable
        }
        crate::owner::instrument_master::InstrumentMasterError::StoreUntrusted => {
            SessionErrorV1::StoreUntrusted
        }
        _ => SessionErrorV1::InvalidDependency,
    }
}
fn map_calendar_error(error: crate::owner::calendar::CalendarErrorV1) -> SessionErrorV1 {
    match error {
        crate::owner::calendar::CalendarErrorV1::StoreUnavailable => {
            SessionErrorV1::StoreUnavailable
        }
        crate::owner::calendar::CalendarErrorV1::StoreUntrusted => SessionErrorV1::StoreUntrusted,
        _ => SessionErrorV1::InvalidDependency,
    }
}
fn map_time_zone_error(error: crate::owner::time_zone::TimeZoneErrorV1) -> SessionErrorV1 {
    match error {
        crate::owner::time_zone::TimeZoneErrorV1::StoreUnavailable => {
            SessionErrorV1::StoreUnavailable
        }
        crate::owner::time_zone::TimeZoneErrorV1::StoreUntrusted => SessionErrorV1::StoreUntrusted,
        _ => SessionErrorV1::InvalidDependency,
    }
}
fn digest_row(bytes: Vec<u8>) -> Result<BindingDigest, SessionErrorV1> {
    Ok(BindingDigest::from_untrusted_bytes(
        bytes
            .try_into()
            .map_err(|_| SessionErrorV1::StoreUntrusted)?,
    ))
}
async fn advisory_lock(
    tx: &mut Transaction<'_, Postgres>,
    id: BindingDigest,
) -> Result<(), SessionErrorV1> {
    let key = i64::from_be_bytes(
        id.as_bytes()[..8]
            .try_into()
            .map_err(|_| SessionErrorV1::StoreUntrusted)?,
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    Ok(())
}
fn store_error<E>(_e: E) -> SessionErrorV1 {
    SessionErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    #[rstest]
    fn schema_private_and_unregistered() {
        let s = SESSION_SCHEMA_V1.join("\n");
        assert!(s.contains("bootstrap schema ownership is unavailable"));
        assert!(!s.contains("CREATE SCHEMA"));
        assert_eq!(s.matches("REVOKE ALL ON TABLE").count(), 7);

        for r in [
            "session_state_v1",
            "session_facts_v1",
            "session_heads_v1",
            "session_cuts_v1",
            "session_cut_facts_v1",
            "session_receipts_v1",
            "session_outbox_v1",
        ] {
            assert!(s.contains(r));
        }
        assert!(s.contains("REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC"));
        assert!(!include_str!("../postgres.rs").contains("install_session_schema_v1("));
        let implementation = include_str!("session.rs");
        assert!(implementation.contains("ROLLBACK TO SAVEPOINT market_data_session_v1"));
        assert!(implementation.contains("pg_catalog.gen_random_uuid()"));
        assert!(implementation.contains("resolve_reference_fact_catalog_entry_v1"));
        assert!(implementation.contains("fact.calendar_identity()"));
        assert!(implementation.contains("fact.session_identity()"));
        assert!(implementation.contains("fact.time_zone_identity()"));
        assert!(implementation.contains("recover_calendar_v1(tx, calendar_locator)"));
        assert!(
            implementation.contains("recover_time_zone_in_transaction_v1(tx, time_zone_locator)")
        );
    }
}
