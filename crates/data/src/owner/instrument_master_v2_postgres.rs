//! Durable PostgreSQL custody for public Instrument Master V2 facts and fixed Backtest cuts.

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

use super::{
    instrument_master_v2::{
        InstrumentMasterCustodyErrorV2, InstrumentMasterCutLocatorV2, InstrumentMasterCutReceiptV2,
        InstrumentMasterCutRequestV2, InstrumentMasterCutV2, InstrumentMasterFactV2,
        InstrumentMasterReadbackV2, InstrumentMasterResolverV2, native_replay_request_identity_v2,
        resolver_seal_v2,
    },
    source_binding::BindingDigest,
    universe_selection::{UniverseSelectionReadbackV1, verify_universe_selection_readback_v1},
};

pub(super) const MARKET_DATA_OWNER_DATABASE_URL_ENV: &str = "MARKET_DATA_OWNER_DATABASE_URL";
const CUSTODY_DOMAIN: &[u8] = b"vibe.market-data.instrument-master-public-v2.custody\0";
const GENERATION_DOMAIN: &[u8] = b"vibe.market-data.instrument-master-public-v2.generation\0";
const ADVISORY_LOCK_KEY: i64 = 0x494d_5632_0000_0001;

const SCHEMA: [&str; 13] = [
    "CREATE SCHEMA IF NOT EXISTS market_data_instrument_master_v2",
    "REVOKE ALL ON SCHEMA market_data_instrument_master_v2 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.state (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32),append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.facts (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32),canonical_identity TEXT NOT NULL,predecessor_fact_identity BYTEA NULL REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),owner_observation_ns BYTEA NOT NULL CHECK(octet_length(owner_observation_ns)=16),fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0 AND octet_length(fact_bytes)<=65536),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32),UNIQUE(canonical_identity,correction_sequence),UNIQUE(predecessor_fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.cuts (cut_identity BYTEA PRIMARY KEY CHECK(octet_length(cut_identity)=32),request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32),request_binding_digest BYTEA UNIQUE NOT NULL CHECK(octet_length(request_binding_digest)=32),decision_cut BIGINT NOT NULL CHECK(decision_cut>0),first_fact_identity BYTEA NOT NULL REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,second_fact_identity BYTEA NOT NULL REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0 AND octet_length(cut_bytes)<=196608),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32),CHECK(first_fact_identity<>second_fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.receipts (receipt_identity BYTEA PRIMARY KEY CHECK(octet_length(receipt_identity)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.cuts(cut_identity) ON DELETE RESTRICT,receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)=106),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.outbox (outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.cuts(cut_identity) ON DELETE RESTRICT,receipt_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.receipts(receipt_identity) ON DELETE RESTRICT,payload_bytes BYTEA NOT NULL CHECK(octet_length(payload_bytes)=106),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.state FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.facts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.cuts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.receipts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.outbox FROM PUBLIC",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA market_data_instrument_master_v2 FROM PUBLIC",
];

/// Sole configured Market Data writer and exact-locator resolver.
#[derive(Clone, Debug)]
pub struct InstrumentMasterV2PostgresOwner {
    pool: PgPool,
}

impl InstrumentMasterV2PostgresOwner {
    pub(super) async fn install(pool: PgPool) -> Result<Self, InstrumentMasterCustodyErrorV2> {
        for statement in SCHEMA {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .map_err(store_error)?;
        }
        let database: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&pool)
            .await
            .map_err(store_error)?;
        let generation = generation_identity(&database);
        sqlx::query("INSERT INTO market_data_instrument_master_v2.state(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
            .bind(generation.as_slice()).execute(&pool).await.map_err(store_error)?;
        let owner = Self { pool };
        owner.assert_acl().await?;
        Ok(owner)
    }

    /// Appends one canonical fact. Identical bytes are idempotent; every conflicting identity,
    /// duplicate sequence, gap, or branch fails before commit.
    pub async fn append_fact(
        &self,
        fact: &InstrumentMasterFactV2,
    ) -> Result<(), InstrumentMasterCustodyErrorV2> {
        let mut tx = self.serializable().await?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        let rows = load_fact_rows(&mut tx, fact.canonical_identity()).await?;
        let chain = decode_chain(rows)?;
        if let Some(existing) = chain.iter().find(|item| item.identity() == fact.identity()) {
            if existing.canonical_bytes() == fact.canonical_bytes() {
                tx.commit().await.map_err(store_error)?;
                return Ok(());
            }
            return Err(InstrumentMasterCustodyErrorV2::IdentityConflict);
        }
        match chain.last() {
            None if fact.predecessor_fact_digest().is_none() && fact.correction_sequence() == 1 => {
            }
            Some(previous) if fact.is_direct_successor_of(previous) => {}
            _ => return Err(InstrumentMasterCustodyErrorV2::ChainMismatch),
        }
        let custody = fact_custody(fact);
        let result = sqlx::query("INSERT INTO market_data_instrument_master_v2.facts(fact_identity,canonical_identity,predecessor_fact_identity,correction_sequence,owner_observation_ns,fact_bytes,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(fact.identity().as_bytes().as_slice())
            .bind(fact.canonical_identity())
            .bind(fact.predecessor_fact_digest().map(|value| value.as_bytes().to_vec()))
            .bind(i64::try_from(fact.correction_sequence()).map_err(|_| InstrumentMasterCustodyErrorV2::ChainMismatch)?)
            .bind(fact.owner_observation_time_ns().to_be_bytes().as_slice())
            .bind(fact.canonical_bytes())
            .bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        if result.rows_affected() != 1 {
            return Err(InstrumentMasterCustodyErrorV2::StoreUnavailable);
        }
        tx.commit().await.map_err(store_error)
    }

    /// Resolves the sealed two-member Universe Selection and atomically appends its cut,
    /// deterministic receipt, and outbox record.
    pub async fn issue_cut(
        &self,
        request: InstrumentMasterCutRequestV2,
        selection: &UniverseSelectionReadbackV1,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        request.validate()?;
        if !verify_universe_selection_readback_v1(selection)
            || selection.record().decision_cut() != request.decision_cut()
        {
            return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
        }
        let mut members = selection
            .record()
            .membership()
            .iter()
            .filter(|member| member.included())
            .map(|member| std::str::from_utf8(member.instrument()).map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| InstrumentMasterCustodyErrorV2::InvalidUniverseSelection)?;
        members.sort();
        if members.len() != 2 || members[0] == members[1] {
            return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
        }

        let mut tx = self.serializable().await?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        if let Some(row) = load_cut_by_request(&mut tx, request.request_identity()).await? {
            let readback = decode_cut_row(&mut tx, row).await?;
            if readback.cut().decision_cut() == request.decision_cut()
                && readback.cut().universe_selection_identity() == selection.record().identity()
                && readback.cut().universe_selection_receipt_identity()
                    == selection.receipt().identity()
                && readback.cut().universe_selection_outbox_identity()
                    == selection.outbox_identity()
            {
                tx.commit().await.map_err(store_error)?;
                return Ok(readback);
            }
            return Err(InstrumentMasterCustodyErrorV2::RequestConflict);
        }
        let first = resolve_member_at(
            &mut tx,
            &members[0],
            selection.record().owner_observation_ns(),
        )
        .await?;
        let second = resolve_member_at(
            &mut tx,
            &members[1],
            selection.record().owner_observation_ns(),
        )
        .await?;
        let cut = InstrumentMasterCutV2::issue(
            request,
            selection.record().identity(),
            selection.receipt().identity(),
            selection.outbox_identity(),
            [first, second],
        )?;
        let state = sqlx::query("SELECT store_generation_identity,append_sequence FROM market_data_instrument_master_v2.state WHERE singleton FOR UPDATE")
            .fetch_one(&mut *tx).await.map_err(store_error)?;
        let generation = row_digest(&state, "store_generation_identity")?;
        let prior: i64 = state.try_get("append_sequence").map_err(store_error)?;
        let append_sequence = u64::try_from(prior)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(InstrumentMasterCustodyErrorV2::StoreUnavailable)?;
        let receipt = InstrumentMasterCutReceiptV2::issue(&cut, generation, append_sequence)?;
        let custody = cut_custody(&cut, &receipt);
        let sequence = i64::try_from(append_sequence)
            .map_err(|_| InstrumentMasterCustodyErrorV2::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_instrument_master_v2.cuts(cut_identity,request_identity,request_binding_digest,decision_cut,first_fact_identity,second_fact_identity,cut_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(cut.identity().as_bytes().as_slice()).bind(cut.request_identity().as_bytes().as_slice())
            .bind(cut.request_binding_digest().as_bytes().as_slice()).bind(i64::try_from(cut.decision_cut()).map_err(|_| InstrumentMasterCustodyErrorV2::InvalidRequest)?)
            .bind(cut.members()[0].fact().identity().as_bytes().as_slice()).bind(cut.members()[1].fact().identity().as_bytes().as_slice())
            .bind(cut.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        sqlx::query("INSERT INTO market_data_instrument_master_v2.receipts(receipt_identity,cut_identity,receipt_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5)")
            .bind(receipt.identity().as_bytes().as_slice()).bind(cut.identity().as_bytes().as_slice())
            .bind(receipt.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        sqlx::query("INSERT INTO market_data_instrument_master_v2.outbox(outbox_identity,cut_identity,receipt_identity,payload_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(receipt.outbox_identity().as_bytes().as_slice()).bind(cut.identity().as_bytes().as_slice())
            .bind(receipt.identity().as_bytes().as_slice()).bind(receipt.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut *tx).await.map_err(classify_insert)?;
        sqlx::query("UPDATE market_data_instrument_master_v2.state SET append_sequence=$1 WHERE singleton AND append_sequence=$2")
            .bind(sequence).bind(prior).execute(&mut *tx).await.map_err(store_error)?;
        assert_complete_ledger(&mut tx).await?;
        let readback = InstrumentMasterReadbackV2::from_parts(cut, receipt)?;
        tx.commit().await.map_err(store_error)?;
        Ok(readback)
    }

    /// Returns only the exact historical readback bound to the original R&D request.
    pub async fn resolve(
        &self,
        locator: InstrumentMasterCutLocatorV2,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        let row = sqlx::query("SELECT c.*,r.receipt_identity,r.receipt_bytes,r.append_sequence AS receipt_append_sequence,o.outbox_identity,o.payload_bytes,o.append_sequence AS outbox_append_sequence,r.custody_digest AS receipt_custody_digest,o.custody_digest AS outbox_custody_digest,s.store_generation_identity,s.append_sequence AS state_append_sequence FROM market_data_instrument_master_v2.cuts c JOIN market_data_instrument_master_v2.receipts r ON r.cut_identity=c.cut_identity JOIN market_data_instrument_master_v2.outbox o ON o.cut_identity=c.cut_identity CROSS JOIN market_data_instrument_master_v2.state s WHERE s.singleton AND c.request_identity=$1 AND c.request_binding_digest=$2 AND c.cut_identity=$3 AND r.receipt_identity=$4")
            .bind(locator.request_identity().as_bytes().as_slice())
            .bind(locator.request_binding_digest().as_bytes().as_slice())
            .bind(locator.cut_identity().as_bytes().as_slice())
            .bind(locator.receipt_identity().as_bytes().as_slice())
            .fetch_optional(&mut *tx).await.map_err(store_error)?
            .ok_or(InstrumentMasterCustodyErrorV2::UnknownLocator)?;
        let readback = decode_cut_row(&mut tx, row).await?;
        tx.commit().await.map_err(store_error)?;
        Ok(readback)
    }

    /// Resolves the one V2 cut whose request key is derived from a sealed R&D Replay identity.
    pub async fn resolve_for_native_replay_request(
        &self,
        request_identity: &str,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let request_identity = native_replay_request_identity_v2(request_identity)?;
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        let row = load_cut_by_request(&mut tx, request_identity)
            .await?
            .ok_or(InstrumentMasterCustodyErrorV2::UnknownLocator)?;
        let readback = decode_cut_row(&mut tx, row).await?;
        tx.commit().await.map_err(store_error)?;
        Ok(readback)
    }

    async fn serializable(
        &self,
    ) -> Result<Transaction<'_, Postgres>, InstrumentMasterCustodyErrorV2> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(ADVISORY_LOCK_KEY)
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        Ok(tx)
    }

    async fn assert_acl(&self) -> Result<(), InstrumentMasterCustodyErrorV2> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        assert_acl_in_transaction(&mut tx).await?;
        tx.rollback().await.map_err(store_error)
    }
}

impl resolver_seal_v2::Sealed for InstrumentMasterV2PostgresOwner {}

#[async_trait::async_trait]
impl InstrumentMasterResolverV2 for InstrumentMasterV2PostgresOwner {
    async fn resolve_instrument_master_v2_for_native_replay_request(
        &self,
        request_identity: &str,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        self.resolve_for_native_replay_request(request_identity)
            .await
    }

    async fn resolve_instrument_master_v2(
        &self,
        locator: InstrumentMasterCutLocatorV2,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        self.resolve(locator).await
    }
}

async fn resolve_member_at(
    tx: &mut Transaction<'_, Postgres>,
    identity: &str,
    observed_at: i128,
) -> Result<InstrumentMasterFactV2, InstrumentMasterCustodyErrorV2> {
    let chain = decode_chain(load_fact_rows(tx, identity).await?)?;
    chain
        .into_iter()
        .rev()
        .find(|fact| fact.owner_observation_time_ns() <= observed_at)
        .ok_or(InstrumentMasterCustodyErrorV2::MissingFact)
}

async fn load_chain_ending_at(
    tx: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<InstrumentMasterFactV2, InstrumentMasterCustodyErrorV2> {
    let row = sqlx::query("SELECT canonical_identity FROM market_data_instrument_master_v2.facts WHERE fact_identity=$1")
        .bind(identity.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?
        .ok_or(InstrumentMasterCustodyErrorV2::MissingFact)?;
    let canonical: String = row.try_get("canonical_identity").map_err(store_error)?;
    decode_chain(load_fact_rows(tx, &canonical).await?)?
        .into_iter()
        .find(|fact| fact.identity() == identity)
        .ok_or(InstrumentMasterCustodyErrorV2::MissingFact)
}

async fn load_fact_rows(
    tx: &mut Transaction<'_, Postgres>,
    canonical: &str,
) -> Result<Vec<sqlx::postgres::PgRow>, InstrumentMasterCustodyErrorV2> {
    sqlx::query("SELECT fact_identity,predecessor_fact_identity,correction_sequence,owner_observation_ns,fact_bytes,custody_digest FROM market_data_instrument_master_v2.facts WHERE canonical_identity=$1 ORDER BY correction_sequence")
        .bind(canonical).fetch_all(&mut **tx).await.map_err(store_error)
}

fn decode_chain(
    rows: Vec<sqlx::postgres::PgRow>,
) -> Result<Vec<InstrumentMasterFactV2>, InstrumentMasterCustodyErrorV2> {
    let mut chain = Vec::with_capacity(rows.len());
    for row in rows {
        let bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
        let fact = InstrumentMasterFactV2::from_canonical_bytes(&bytes, chain.last())
            .map_err(|_| InstrumentMasterCustodyErrorV2::ChainMismatch)?;
        if row_digest(&row, "fact_identity")? != fact.identity()
            || row_optional_digest(&row, "predecessor_fact_identity")?
                != fact.predecessor_fact_digest()
            || row
                .try_get::<i64, _>("correction_sequence")
                .map_err(store_error)?
                != i64::try_from(fact.correction_sequence())
                    .map_err(|_| InstrumentMasterCustodyErrorV2::ChainMismatch)?
            || row
                .try_get::<Vec<u8>, _>("owner_observation_ns")
                .map_err(store_error)?
                .as_slice()
                != fact.owner_observation_time_ns().to_be_bytes()
            || row
                .try_get::<Vec<u8>, _>("custody_digest")
                .map_err(store_error)?
                .as_slice()
                != fact_custody(&fact)
        {
            return Err(InstrumentMasterCustodyErrorV2::ChainMismatch);
        }
        chain.push(fact);
    }
    Ok(chain)
}

async fn load_cut_by_request(
    tx: &mut Transaction<'_, Postgres>,
    request: BindingDigest,
) -> Result<Option<sqlx::postgres::PgRow>, InstrumentMasterCustodyErrorV2> {
    sqlx::query("SELECT c.*,r.receipt_identity,r.receipt_bytes,r.append_sequence AS receipt_append_sequence,o.outbox_identity,o.payload_bytes,o.append_sequence AS outbox_append_sequence,r.custody_digest AS receipt_custody_digest,o.custody_digest AS outbox_custody_digest,s.store_generation_identity,s.append_sequence AS state_append_sequence FROM market_data_instrument_master_v2.cuts c JOIN market_data_instrument_master_v2.receipts r ON r.cut_identity=c.cut_identity JOIN market_data_instrument_master_v2.outbox o ON o.cut_identity=c.cut_identity CROSS JOIN market_data_instrument_master_v2.state s WHERE s.singleton AND c.request_identity=$1")
        .bind(request.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)
}

async fn decode_cut_row(
    tx: &mut Transaction<'_, Postgres>,
    row: sqlx::postgres::PgRow,
) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
    let first = load_chain_ending_at(tx, row_digest(&row, "first_fact_identity")?).await?;
    let second = load_chain_ending_at(tx, row_digest(&row, "second_fact_identity")?).await?;
    let cut_bytes: Vec<u8> = row.try_get("cut_bytes").map_err(store_error)?;
    let cut = InstrumentMasterCutV2::parse_with_facts(&cut_bytes, [first, second])?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let receipt = InstrumentMasterCutReceiptV2::parse(&receipt_bytes)?;
    let custody = cut_custody(&cut, &receipt);
    if row_digest(&row, "cut_identity")? != cut.identity()
        || row_digest(&row, "request_identity")? != cut.request_identity()
        || row_digest(&row, "request_binding_digest")? != cut.request_binding_digest()
        || row_digest(&row, "receipt_identity")? != receipt.identity()
        || row_digest(&row, "outbox_identity")? != receipt.outbox_identity()
        || row
            .try_get::<Vec<u8>, _>("payload_bytes")
            .map_err(store_error)?
            != receipt_bytes
        || row
            .try_get::<Vec<u8>, _>("custody_digest")
            .map_err(store_error)?
            .as_slice()
            != custody
        || row
            .try_get::<Vec<u8>, _>("receipt_custody_digest")
            .map_err(store_error)?
            .as_slice()
            != custody
        || row
            .try_get::<Vec<u8>, _>("outbox_custody_digest")
            .map_err(store_error)?
            .as_slice()
            != custody
        || row_digest(&row, "store_generation_identity")? != receipt.store_generation_identity()
        || row
            .try_get::<i64, _>("append_sequence")
            .map_err(store_error)?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("receipt_append_sequence")
            .map_err(store_error)?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("outbox_append_sequence")
            .map_err(store_error)?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("state_append_sequence")
            .map_err(store_error)?
            < i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
    {
        return Err(InstrumentMasterCustodyErrorV2::CrossSpliced);
    }
    InstrumentMasterReadbackV2::from_parts(cut, receipt)
}

async fn lock_all(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentMasterCustodyErrorV2> {
    sqlx::query("LOCK TABLE market_data_instrument_master_v2.state,market_data_instrument_master_v2.facts,market_data_instrument_master_v2.cuts,market_data_instrument_master_v2.receipts,market_data_instrument_master_v2.outbox IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut **tx).await.map_err(store_error)?;
    Ok(())
}

async fn assert_complete_ledger(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentMasterCustodyErrorV2> {
    let corrupt: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_instrument_master_v2.cuts c FULL JOIN market_data_instrument_master_v2.receipts r ON r.cut_identity=c.cut_identity FULL JOIN market_data_instrument_master_v2.outbox o ON o.cut_identity=c.cut_identity WHERE c.cut_identity IS NULL OR r.receipt_identity IS NULL OR o.outbox_identity IS NULL OR c.append_sequence<>r.append_sequence OR c.append_sequence<>o.append_sequence) OR (SELECT append_sequence FROM market_data_instrument_master_v2.state WHERE singleton)<>(SELECT COUNT(*) FROM market_data_instrument_master_v2.cuts) OR EXISTS(SELECT 1 FROM market_data_instrument_master_v2.cuts c CROSS JOIN market_data_instrument_master_v2.state s WHERE s.singleton AND (c.append_sequence<1 OR c.append_sequence>s.append_sequence))")
        .fetch_one(&mut **tx).await.map_err(store_error)?;
    if corrupt {
        Err(InstrumentMasterCustodyErrorV2::CrossSpliced)
    } else {
        Ok(())
    }
}

async fn assert_acl_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentMasterCustodyErrorV2> {
    let admitted: bool = sqlx::query_scalar("SELECT pg_get_userbyid(n.nspowner)=current_user AND NOT has_schema_privilege('public',n.oid,'USAGE') AND (SELECT COUNT(*)=5 AND bool_and(pg_get_userbyid(c.relowner)=current_user) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('state','facts','cuts','receipts','outbox')) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace=n.oid AND c.relname IN ('state','facts','cuts','receipts','outbox') AND a.grantee<>c.relowner) FROM pg_namespace n WHERE n.nspname='market_data_instrument_master_v2'")
        .fetch_one(&mut **tx).await.map_err(store_error)?;
    if admitted {
        Ok(())
    } else {
        Err(InstrumentMasterCustodyErrorV2::AclUnavailable)
    }
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, InstrumentMasterCustodyErrorV2> {
    let bytes: Vec<u8> = row.try_get(name).map_err(store_error)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn row_optional_digest(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<Option<BindingDigest>, InstrumentMasterCustodyErrorV2> {
    row.try_get::<Option<Vec<u8>>, _>(name)
        .map_err(store_error)?
        .map(|bytes| {
            bytes
                .try_into()
                .map(BindingDigest::from_untrusted_bytes)
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)
        })
        .transpose()
}

fn generation_identity(database: &str) -> [u8; 32] {
    hash(GENERATION_DOMAIN, database.as_bytes())
}
fn fact_custody(fact: &InstrumentMasterFactV2) -> [u8; 32] {
    hash(CUSTODY_DOMAIN, fact.canonical_bytes())
}
fn cut_custody(cut: &InstrumentMasterCutV2, receipt: &InstrumentMasterCutReceiptV2) -> [u8; 32] {
    let mut bytes =
        Vec::with_capacity(cut.canonical_bytes().len() + receipt.canonical_bytes().len());
    bytes.extend_from_slice(cut.canonical_bytes());
    bytes.extend_from_slice(receipt.canonical_bytes());
    hash(CUSTODY_DOMAIN, &bytes)
}
fn hash(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(domain);
    h.update(bytes);
    h.finalize().into()
}
fn store_error(_: sqlx::Error) -> InstrumentMasterCustodyErrorV2 {
    InstrumentMasterCustodyErrorV2::StoreUnavailable
}
fn classify_insert(error: sqlx::Error) -> InstrumentMasterCustodyErrorV2 {
    if error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .is_some_and(|code| code == "23505")
    {
        InstrumentMasterCustodyErrorV2::IdentityConflict
    } else {
        store_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_v2_only_append_ledger() {
        let schema = SCHEMA.join("\n");
        assert!(schema.contains("instrument_master_v2.facts"));
        assert!(schema.contains("instrument_master_v2.outbox"));
        assert!(schema.contains("UNIQUE(predecessor_fact_identity)"));
        assert!(!schema.contains("instrument_master_facts_v1"));
        assert!(!schema.contains(" ON DELETE CASCADE"));
    }

    #[test]
    fn environment_name_is_owner_specific() {
        assert_eq!(
            MARKET_DATA_OWNER_DATABASE_URL_ENV,
            "MARKET_DATA_OWNER_DATABASE_URL"
        );
    }
}
