//! Durable PostgreSQL custody for public Instrument Master V2 facts and fixed Backtest cuts.

use std::fmt::Debug;

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

use super::{
    ADMITTED_UNIVERSE_MEMBER_COUNTS,
    instrument_master_v2::{
        InstrumentMasterCustodyErrorV2, InstrumentMasterCutLocatorV2, InstrumentMasterCutReceiptV2,
        InstrumentMasterCutRequestV2, InstrumentMasterCutV2, InstrumentMasterFactV2,
        InstrumentMasterReadbackV2, InstrumentMasterResolverV2, PublicInstrumentClassV2,
        native_replay_request_identity_v2, resolver_seal_v2,
    },
    postgres::{BoundUniverseSelectionErrorV1, recover_bound_universe_selection_in_transaction_v1},
    replay_market_facts_v2::ReplayCompositionBindingLocatorV1,
    source_binding::BindingDigest,
    universe_selection::{UniverseSelectionReadbackV1, verify_universe_selection_readback_v1},
};

pub(super) const MARKET_DATA_OWNER_DATABASE_URL_ENV: &str = "MARKET_DATA_OWNER_DATABASE_URL";
const CUSTODY_DOMAIN: &[u8] = b"vibe.market-data.instrument-master-public-v2.custody\0";
const GENERATION_DOMAIN: &[u8] = b"vibe.market-data.instrument-master-public-v2.generation\0";

const SCHEMA: [&str; 16] = [
    // `CREATE SCHEMA IF NOT EXISTS` checks database `CREATE` before it checks existence, so it
    // fails for an Owner that holds no database-level `CREATE` even when the schema is already
    // provisioned. Under the deployed custody topology the authority migration owns this schema
    // and the Owner has no such grant, so ask about existence first and create only what is
    // genuinely missing.
    "DO $instrument_master_v2_schema$ BEGIN IF pg_catalog.to_regnamespace('market_data_instrument_master_v2') IS NULL THEN EXECUTE 'CREATE SCHEMA market_data_instrument_master_v2'; END IF; END $instrument_master_v2_schema$",
    "REVOKE ALL ON SCHEMA market_data_instrument_master_v2 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.state (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32),append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.facts (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32),canonical_identity TEXT NOT NULL,predecessor_fact_identity BYTEA NULL REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),owner_observation_ns BYTEA NOT NULL CHECK(octet_length(owner_observation_ns)=16),fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0 AND octet_length(fact_bytes)<=65536),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32),UNIQUE(canonical_identity,correction_sequence),UNIQUE(predecessor_fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.cuts (cut_identity BYTEA PRIMARY KEY CHECK(octet_length(cut_identity)=32),request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32),request_binding_digest BYTEA UNIQUE NOT NULL CHECK(octet_length(request_binding_digest)=32),decision_cut BIGINT NOT NULL CHECK(decision_cut>0),first_fact_identity BYTEA NOT NULL REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,second_fact_identity BYTEA REFERENCES market_data_instrument_master_v2.facts(fact_identity) ON DELETE RESTRICT,cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0 AND octet_length(cut_bytes)<=196608),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32),CONSTRAINT cuts_distinct_members CHECK(second_fact_identity IS NULL OR first_fact_identity<>second_fact_identity))",
    // A cut table created before one-member cuts were admitted required a second fact and a
    // plain `first <> second` check. Its shape is read from the catalog as the column's NOT NULL
    // and the whole set of checks that mention the second fact, compared by definition: legacy is
    // NOT NULL with exactly the old check, current is nullable with exactly the named new one.
    // Legacy is converted once in this one statement, which commits or fails as a whole; current
    // is left alone; anything else - a same-named check with another definition, a duplicated or
    // extra check - is refused rather than guessed at. The definitions are compared as the text
    // `pg_get_constraintdef` prints, which is PostgreSQL's own normalized rendering: a server that
    // prints them differently matches neither shape and is refused, and the two strings below are
    // what the proof's server prints. The result is not read back afterwards: legacy is matched
    // exactly, the three changes then produce the current shape and nothing else, and no other
    // session can alter the table between them, so a re-read could never refuse anything (it was
    // written, and mutation testing showed it unreachable). Existing rows are two-member cuts and
    // satisfy the new check unchanged. Two installs racing on a legacy table leave the loser
    // failing on the constraint the winner already dropped, which refuses rather than corrupts.
    "DO $instrument_master_v2_cut_members$ DECLARE legacy CONSTANT TEXT := 'CHECK ((first_fact_identity <> second_fact_identity))'; current_check CONSTANT TEXT := 'CHECK (((second_fact_identity IS NULL) OR (first_fact_identity <> second_fact_identity)))'; second_required BOOLEAN; second_checks TEXT[]; current_named INTEGER; legacy_name TEXT; BEGIN SELECT a.attnotnull INTO second_required FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'market_data_instrument_master_v2.cuts'::regclass AND a.attname = 'second_fact_identity' AND NOT a.attisdropped; SELECT coalesce(array_agg(pg_catalog.pg_get_constraintdef(c.oid) ORDER BY 1), ARRAY[]::TEXT[]) INTO second_checks FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'market_data_instrument_master_v2.cuts'::regclass AND c.contype = 'c' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%second_fact_identity%'; SELECT count(*) INTO current_named FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'market_data_instrument_master_v2.cuts'::regclass AND c.conname = 'cuts_distinct_members' AND pg_catalog.pg_get_constraintdef(c.oid) = current_check; IF second_required IS NULL THEN RAISE EXCEPTION 'unknown Instrument Master V2 cut table shape'; ELSIF second_required AND second_checks = ARRAY[legacy] THEN SELECT c.conname INTO STRICT legacy_name FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'market_data_instrument_master_v2.cuts'::regclass AND c.contype = 'c' AND pg_catalog.pg_get_constraintdef(c.oid) = legacy; EXECUTE 'ALTER TABLE market_data_instrument_master_v2.cuts ALTER COLUMN second_fact_identity DROP NOT NULL'; EXECUTE format('ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT %I', legacy_name); EXECUTE 'ALTER TABLE market_data_instrument_master_v2.cuts ADD CONSTRAINT cuts_distinct_members ' || current_check; ELSIF NOT second_required AND second_checks = ARRAY[current_check] AND current_named = 1 THEN NULL; ELSE RAISE EXCEPTION 'Instrument Master V2 cut table is in neither its legacy nor its current shape'; END IF; END $instrument_master_v2_cut_members$",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.receipts (receipt_identity BYTEA PRIMARY KEY CHECK(octet_length(receipt_identity)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.cuts(cut_identity) ON DELETE RESTRICT,receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)=106),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.outbox (outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.cuts(cut_identity) ON DELETE RESTRICT,receipt_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_instrument_master_v2.receipts(receipt_identity) ON DELETE RESTRICT,payload_bytes BYTEA NOT NULL CHECK(octet_length(payload_bytes)=106),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    // Which composition binding each bound-replay request key was issued under. The cut's own
    // idempotency compares only the Universe Selection, so two bindings sharing one selection
    // would otherwise reuse one cut under one key; this row is what refuses the second binding.
    "CREATE TABLE IF NOT EXISTS market_data_instrument_master_v2.bound_replay_issuances (request_identity BYTEA PRIMARY KEY REFERENCES market_data_instrument_master_v2.cuts(request_identity) ON DELETE RESTRICT,binding_identity BYTEA NOT NULL CHECK(octet_length(binding_identity)=32),binding_digest BYTEA NOT NULL CHECK(octet_length(binding_digest)=32))",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.state FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.facts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.cuts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.receipts FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.outbox FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_instrument_master_v2.bound_replay_issuances FROM PUBLIC",
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
                .map_err(|cause| store_error(&cause))?;
        }
        let database: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&pool)
            .await
            .map_err(|cause| store_error(&cause))?;
        let generation = generation_identity(&database);
        sqlx::query("INSERT INTO market_data_instrument_master_v2.state(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
            .bind(generation.as_slice()).execute(&pool).await.map_err(|cause| store_error(&cause))?;
        let owner = Self { pool };
        owner.assert_acl().await?;
        Ok(owner)
    }

    /// Appends one canonical fact. Identical bytes are idempotent; every conflicting identity,
    /// duplicate sequence, gap, or branch fails before commit.
    ///
    /// # Errors
    ///
    /// Returns a custody or storage error when validation, persistence, or commit fails.
    pub async fn append_fact(
        &self,
        fact: &InstrumentMasterFactV2,
    ) -> Result<(), InstrumentMasterCustodyErrorV2> {
        let mut tx = self.serializable().await?;
        assert_acl_in_transaction(&mut tx).await?;
        let rows = load_fact_rows(&mut tx, fact.canonical_identity()).await?;
        let chain = decode_chain(rows)?;
        if let Some(existing) = chain.iter().find(|item| item.identity() == fact.identity()) {
            if existing.canonical_bytes() == fact.canonical_bytes() {
                tx.commit().await.map_err(|cause| store_error(&cause))?;
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
            .execute(&mut *tx).await.map_err(|cause| classify_insert(&cause))?;

        if result.rows_affected() != 1 {
            return Err(InstrumentMasterCustodyErrorV2::StoreUnavailable);
        }
        tx.commit().await.map_err(|cause| store_error(&cause))
    }

    /// Resolves the sealed one- or two-member Universe Selection and atomically appends its cut,
    /// deterministic receipt, and outbox record.
    ///
    /// # Errors
    ///
    /// Returns a custody or storage error when the selection is invalid or persistence fails.
    pub async fn issue_cut(
        &self,
        request: InstrumentMasterCutRequestV2,
        selection: &UniverseSelectionReadbackV1,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let members = admitted_members(&request, selection)?;
        let mut tx = self.serializable().await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        let readback = issue_cut_in_transaction(&mut tx, request, selection, &members).await?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
        Ok(readback)
    }

    /// Issues the initial cut for one sealed R&D Replay request over the Universe Selection its
    /// composition binding bound, and records which binding the request key was issued under.
    ///
    /// The key is derived from `sealed_request_identity` exactly as
    /// [`InstrumentMasterCutRequestV2::for_native_replay_request`] derives it, and the decision
    /// cut is the selection's own. Market Data cannot tell whether that identity names a sealed
    /// R&D request; the trust boundary is the fixed writer process that holds this Owner's
    /// credential, and a cut issued under the wrong binding is refused by R&D's consumer, whose
    /// selection and member checks fail closed.
    ///
    /// The same key and binding again return the stored cut with zero append. The same key under
    /// a different binding is refused with zero writes even when both bindings share one
    /// selection: the cut's own idempotency compares only the selection, so the recorded binding
    /// is what tells them apart.
    ///
    /// Everything happens in this Owner's own transaction, which reads the binding and the
    /// selection without row locks and never calls R&D, so it cannot wait on a lock R&D's open
    /// transaction holds. The one remaining wait cycle is a caller that holds an Instrument
    /// Master V2 transaction open across this call; none can, because every method here commits
    /// or rolls back before it returns and none hands a transaction out.
    ///
    /// # Errors
    ///
    /// Returns [`InstrumentMasterCustodyErrorV2::BoundReplayBindingConflict`] when the key was
    /// issued under another binding, [`InstrumentMasterCustodyErrorV2::BoundReplayBindingUnavailable`]
    /// when no binding matches the exact locator, and a custody or storage error otherwise.
    pub async fn issue_cut_for_bound_replay_v1(
        &self,
        sealed_request_identity: &str,
        binding: ReplayCompositionBindingLocatorV1,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let request_identity = native_replay_request_identity_v2(sealed_request_identity)?;
        let mut tx = self.serializable().await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        if let Some(recorded) = load_bound_replay_binding(&mut tx, request_identity).await? {
            if recorded != binding {
                return Err(InstrumentMasterCustodyErrorV2::BoundReplayBindingConflict);
            }
            let row = load_cut_by_request(&mut tx, request_identity)
                .await?
                .ok_or(InstrumentMasterCustodyErrorV2::CrossSpliced)?;
            let readback = decode_cut_row(&mut tx, row).await?;
            tx.commit().await.map_err(|cause| store_error(&cause))?;
            return Ok(readback);
        }
        let selection = recover_bound_universe_selection_in_transaction_v1(&mut tx, binding)
            .await
            .map_err(|e| match e {
                BoundUniverseSelectionErrorV1::BindingUnavailable => {
                    InstrumentMasterCustodyErrorV2::BoundReplayBindingUnavailable
                }
                BoundUniverseSelectionErrorV1::CustodyMismatch => {
                    InstrumentMasterCustodyErrorV2::CrossSpliced
                }
                BoundUniverseSelectionErrorV1::StoreUnavailable => {
                    InstrumentMasterCustodyErrorV2::StoreUnavailable
                }
            })?;
        let request = InstrumentMasterCutRequestV2::for_native_replay_request(
            sealed_request_identity,
            selection.record().decision_cut(),
        )?;
        let members = admitted_members(&request, &selection)?;
        let readback = issue_cut_in_transaction(&mut tx, request, &selection, &members).await?;
        sqlx::query("INSERT INTO market_data_instrument_master_v2.bound_replay_issuances(request_identity,binding_identity,binding_digest) VALUES($1,$2,$3)")
            .bind(request_identity.as_bytes().as_slice())
            .bind(binding.binding_identity().as_bytes().as_slice())
            .bind(binding.binding_digest().as_bytes().as_slice())
            .execute(&mut *tx).await.map_err(|cause| classify_insert(&cause))?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
        Ok(readback)
    }

    /// Returns only the exact historical readback bound to the original R&D request.
    ///
    /// # Errors
    ///
    /// Returns a custody or storage error when the locator is unknown or verification fails.
    pub async fn resolve(
        &self,
        locator: InstrumentMasterCutLocatorV2,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        let row = sqlx::query("SELECT c.*,r.receipt_identity,r.receipt_bytes,r.append_sequence AS receipt_append_sequence,o.outbox_identity,o.payload_bytes,o.append_sequence AS outbox_append_sequence,r.custody_digest AS receipt_custody_digest,o.custody_digest AS outbox_custody_digest,s.store_generation_identity,s.append_sequence AS state_append_sequence FROM market_data_instrument_master_v2.cuts c JOIN market_data_instrument_master_v2.receipts r ON r.cut_identity=c.cut_identity JOIN market_data_instrument_master_v2.outbox o ON o.cut_identity=c.cut_identity CROSS JOIN market_data_instrument_master_v2.state s WHERE s.singleton AND c.request_identity=$1 AND c.request_binding_digest=$2 AND c.cut_identity=$3 AND r.receipt_identity=$4")
            .bind(locator.request_identity().as_bytes().as_slice())
            .bind(locator.request_binding_digest().as_bytes().as_slice())
            .bind(locator.cut_identity().as_bytes().as_slice())
            .bind(locator.receipt_identity().as_bytes().as_slice())
            .fetch_optional(&mut *tx).await.map_err(|cause| store_error(&cause))?
            .ok_or(InstrumentMasterCustodyErrorV2::UnknownLocator)?;
        let readback = decode_cut_row(&mut tx, row).await?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
        Ok(readback)
    }

    /// Resolves the one V2 cut whose request key is derived from a sealed R&D Replay identity.
    ///
    /// # Errors
    ///
    /// Returns a custody or storage error when the request identity or stored cut is unavailable.
    pub async fn resolve_for_native_replay_request(
        &self,
        request_identity: &str,
    ) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
        let request_identity = native_replay_request_identity_v2(request_identity)?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_all(&mut tx).await?;
        assert_acl_in_transaction(&mut tx).await?;
        assert_complete_ledger(&mut tx).await?;
        let row = load_cut_by_request(&mut tx, request_identity)
            .await?
            .ok_or(InstrumentMasterCustodyErrorV2::UnknownLocator)?;
        let readback = decode_cut_row(&mut tx, row).await?;
        tx.commit().await.map_err(|cause| store_error(&cause))?;
        Ok(readback)
    }

    /// Opens this store's one writing transaction: serializable, and holding every table lock.
    ///
    /// `lock_all` must be its first statement. A serializable transaction's snapshot is taken by
    /// its first `SELECT` or data change, and `LOCK TABLE` is neither, so taking the table locks
    /// first gives a snapshot that already sees whatever the previous lock holder committed. The
    /// advisory `SELECT` that used to come first took the snapshot before its wait, and the second
    /// of two concurrent writers then failed its `FOR UPDATE` on `state` with SQLSTATE 40001.
    /// The table locks conflict with themselves, so they alone serialize every transaction here.
    async fn serializable(
        &self,
    ) -> Result<Transaction<'_, Postgres>, InstrumentMasterCustodyErrorV2> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *tx)
            .await
            .map_err(|cause| store_error(&cause))?;
        lock_all(&mut tx).await?;
        Ok(tx)
    }

    async fn assert_acl(&self) -> Result<(), InstrumentMasterCustodyErrorV2> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|cause| store_error(&cause))?;
        assert_acl_in_transaction(&mut tx).await?;
        tx.rollback().await.map_err(|cause| store_error(&cause))
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

/// The selection's included instruments in canonical order, once the request and selection agree.
fn admitted_members(
    request: &InstrumentMasterCutRequestV2,
    selection: &UniverseSelectionReadbackV1,
) -> Result<Vec<String>, InstrumentMasterCustodyErrorV2> {
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
    if !ADMITTED_UNIVERSE_MEMBER_COUNTS.contains(&members.len())
        || members.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection);
    }
    Ok(members)
}

/// Appends the cut for `request` over `selection` in the caller's transaction, or returns the one
/// already stored under the request identity when it was issued over the same selection.
///
/// The caller opened `tx` through `serializable`, so it holds every table lock, and has checked
/// the ACL and the ledger.
async fn issue_cut_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    request: InstrumentMasterCutRequestV2,
    selection: &UniverseSelectionReadbackV1,
    members: &[String],
) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
    if let Some(row) = load_cut_by_request(tx, request.request_identity()).await? {
        let readback = decode_cut_row(tx, row).await?;
        if readback.cut().decision_cut() == request.decision_cut()
            && readback.cut().universe_selection_identity() == selection.record().identity()
            && readback.cut().universe_selection_receipt_identity()
                == selection.receipt().identity()
            && readback.cut().universe_selection_outbox_identity() == selection.outbox_identity()
        {
            return Ok(readback);
        }
        return Err(InstrumentMasterCustodyErrorV2::RequestConflict);
    }
    let mut facts = Vec::with_capacity(members.len());

    for member in members {
        facts.push(resolve_member_at(tx, member, selection.record().owner_observation_ns()).await?);
    }

    if facts
        .iter()
        .any(|fact| !class_has_no_corporate_actions(fact.instrument_class()))
    {
        return Err(InstrumentMasterCustodyErrorV2::MemberClassCarriesCorporateActions);
    }
    let cut = InstrumentMasterCutV2::issue(
        request,
        selection.record().identity(),
        selection.receipt().identity(),
        selection.outbox_identity(),
        facts,
    )?;
    let state = sqlx::query("SELECT store_generation_identity,append_sequence FROM market_data_instrument_master_v2.state WHERE singleton FOR UPDATE")
            .fetch_one(&mut **tx).await.map_err(|cause| store_error(&cause))?;
    let generation = row_digest(&state, "store_generation_identity")?;
    let prior: i64 = state
        .try_get("append_sequence")
        .map_err(|cause| store_error(&cause))?;
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
            .bind(cut.members()[0].fact().identity().as_bytes().as_slice())
            // A one-member cut has no second fact; the row says so with NULL.
            .bind(cut.members().get(1).map(|member| member.fact().identity().as_bytes().to_vec()))
            .bind(cut.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut **tx).await.map_err(|cause| classify_insert(&cause))?;
    sqlx::query("INSERT INTO market_data_instrument_master_v2.receipts(receipt_identity,cut_identity,receipt_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5)")
            .bind(receipt.identity().as_bytes().as_slice()).bind(cut.identity().as_bytes().as_slice())
            .bind(receipt.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut **tx).await.map_err(|cause| classify_insert(&cause))?;
    sqlx::query("INSERT INTO market_data_instrument_master_v2.outbox(outbox_identity,cut_identity,receipt_identity,payload_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(receipt.outbox_identity().as_bytes().as_slice()).bind(cut.identity().as_bytes().as_slice())
            .bind(receipt.identity().as_bytes().as_slice()).bind(receipt.canonical_bytes()).bind(sequence).bind(custody.as_slice())
            .execute(&mut **tx).await.map_err(|cause| classify_insert(&cause))?;
    sqlx::query("UPDATE market_data_instrument_master_v2.state SET append_sequence=$1 WHERE singleton AND append_sequence=$2")
            .bind(sequence).bind(prior).execute(&mut **tx).await.map_err(|cause| store_error(&cause))?;
    assert_complete_ledger(tx).await?;
    InstrumentMasterReadbackV2::from_parts(cut, receipt)
}

/// The binding a bound-replay request key was issued under, if it was.
async fn load_bound_replay_binding(
    tx: &mut Transaction<'_, Postgres>,
    request_identity: BindingDigest,
) -> Result<Option<ReplayCompositionBindingLocatorV1>, InstrumentMasterCustodyErrorV2> {
    let row = sqlx::query("SELECT binding_identity,binding_digest FROM market_data_instrument_master_v2.bound_replay_issuances WHERE request_identity=$1")
        .bind(request_identity.as_bytes().as_slice())
        .fetch_optional(&mut **tx).await.map_err(|cause| store_error(&cause))?;
    row.map(|row| {
        Ok(ReplayCompositionBindingLocatorV1::from_untrusted(
            row_digest(&row, "binding_identity")?,
            row_digest(&row, "binding_digest")?,
        ))
    })
    .transpose()
}

/// Whether a class has no corporate actions by definition.
///
/// A universe-member Replay binds no corporate-action cut, and this is the check that lets it: a
/// crypto perpetual has no split, dividend, expiry or roll, and a rename makes a new canonical
/// instrument that historical membership proves. The match lists every class and has no wildcard,
/// so a class added later does not compile until someone decides here whether it carries corporate
/// actions. No input reaches the refusal today, and that is deliberate: its positive control is
/// that compile failure, not a runtime case.
const fn class_has_no_corporate_actions(class: PublicInstrumentClassV2) -> bool {
    match class {
        PublicInstrumentClassV2::CryptoPerpetual => true,
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
        .bind(identity.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(|cause| store_error(&cause))?
        .ok_or(InstrumentMasterCustodyErrorV2::MissingFact)?;
    let canonical: String = row
        .try_get("canonical_identity")
        .map_err(|cause| store_error(&cause))?;
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
        .bind(canonical).fetch_all(&mut **tx).await.map_err(|cause| store_error(&cause))
}

fn decode_chain(
    rows: Vec<sqlx::postgres::PgRow>,
) -> Result<Vec<InstrumentMasterFactV2>, InstrumentMasterCustodyErrorV2> {
    let mut chain = Vec::with_capacity(rows.len());
    for row in rows {
        let bytes: Vec<u8> = row
            .try_get("fact_bytes")
            .map_err(|cause| store_error(&cause))?;
        let fact = InstrumentMasterFactV2::from_canonical_bytes(&bytes, chain.last())
            .map_err(|_| InstrumentMasterCustodyErrorV2::ChainMismatch)?;

        if row_digest(&row, "fact_identity")? != fact.identity()
            || row_optional_digest(&row, "predecessor_fact_identity")?
                != fact.predecessor_fact_digest()
            || row
                .try_get::<i64, _>("correction_sequence")
                .map_err(|cause| store_error(&cause))?
                != i64::try_from(fact.correction_sequence())
                    .map_err(|_| InstrumentMasterCustodyErrorV2::ChainMismatch)?
            || row
                .try_get::<Vec<u8>, _>("owner_observation_ns")
                .map_err(|cause| store_error(&cause))?
                .as_slice()
                != fact.owner_observation_time_ns().to_be_bytes()
            || row
                .try_get::<Vec<u8>, _>("custody_digest")
                .map_err(|cause| store_error(&cause))?
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
        .bind(request.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(|cause| store_error(&cause))
}

async fn decode_cut_row(
    tx: &mut Transaction<'_, Postgres>,
    row: sqlx::postgres::PgRow,
) -> Result<InstrumentMasterReadbackV2, InstrumentMasterCustodyErrorV2> {
    let mut facts = vec![load_chain_ending_at(tx, row_digest(&row, "first_fact_identity")?).await?];
    let second: Option<Vec<u8>> = row
        .try_get("second_fact_identity")
        .map_err(|cause| store_error(&cause))?;

    if let Some(second) = second {
        let second: [u8; 32] = second
            .try_into()
            .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?;
        facts.push(load_chain_ending_at(tx, BindingDigest::from_untrusted_bytes(second)).await?);
    }
    let cut_bytes: Vec<u8> = row
        .try_get("cut_bytes")
        .map_err(|cause| store_error(&cause))?;
    let cut = InstrumentMasterCutV2::parse_with_facts(&cut_bytes, facts)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|cause| store_error(&cause))?;
    let receipt = InstrumentMasterCutReceiptV2::parse(&receipt_bytes)?;
    let custody = cut_custody(&cut, &receipt);
    if row_digest(&row, "cut_identity")? != cut.identity()
        || row_digest(&row, "request_identity")? != cut.request_identity()
        || row_digest(&row, "request_binding_digest")? != cut.request_binding_digest()
        || row_digest(&row, "receipt_identity")? != receipt.identity()
        || row_digest(&row, "outbox_identity")? != receipt.outbox_identity()
        || row
            .try_get::<Vec<u8>, _>("payload_bytes")
            .map_err(|cause| store_error(&cause))?
            != receipt_bytes
        || row
            .try_get::<Vec<u8>, _>("custody_digest")
            .map_err(|cause| store_error(&cause))?
            .as_slice()
            != custody
        || row
            .try_get::<Vec<u8>, _>("receipt_custody_digest")
            .map_err(|cause| store_error(&cause))?
            .as_slice()
            != custody
        || row
            .try_get::<Vec<u8>, _>("outbox_custody_digest")
            .map_err(|cause| store_error(&cause))?
            .as_slice()
            != custody
        || row_digest(&row, "store_generation_identity")? != receipt.store_generation_identity()
        || row
            .try_get::<i64, _>("append_sequence")
            .map_err(|cause| store_error(&cause))?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("receipt_append_sequence")
            .map_err(|cause| store_error(&cause))?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("outbox_append_sequence")
            .map_err(|cause| store_error(&cause))?
            != i64::try_from(receipt.append_sequence())
                .map_err(|_| InstrumentMasterCustodyErrorV2::CrossSpliced)?
        || row
            .try_get::<i64, _>("state_append_sequence")
            .map_err(|cause| store_error(&cause))?
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
    sqlx::query("LOCK TABLE market_data_instrument_master_v2.state,market_data_instrument_master_v2.facts,market_data_instrument_master_v2.cuts,market_data_instrument_master_v2.receipts,market_data_instrument_master_v2.outbox,market_data_instrument_master_v2.bound_replay_issuances IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut **tx).await.map_err(|cause| store_error(&cause))?;
    Ok(())
}

async fn assert_complete_ledger(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentMasterCustodyErrorV2> {
    let corrupt: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_instrument_master_v2.cuts c FULL JOIN market_data_instrument_master_v2.receipts r ON r.cut_identity=c.cut_identity FULL JOIN market_data_instrument_master_v2.outbox o ON o.cut_identity=c.cut_identity WHERE c.cut_identity IS NULL OR r.receipt_identity IS NULL OR o.outbox_identity IS NULL OR c.append_sequence<>r.append_sequence OR c.append_sequence<>o.append_sequence) OR (SELECT append_sequence FROM market_data_instrument_master_v2.state WHERE singleton)<>(SELECT COUNT(*) FROM market_data_instrument_master_v2.cuts) OR EXISTS(SELECT 1 FROM market_data_instrument_master_v2.cuts c CROSS JOIN market_data_instrument_master_v2.state s WHERE s.singleton AND (c.append_sequence<1 OR c.append_sequence>s.append_sequence))")
        .fetch_one(&mut **tx).await.map_err(|cause| store_error(&cause))?;

    if corrupt {
        Err(InstrumentMasterCustodyErrorV2::CrossSpliced)
    } else {
        Ok(())
    }
}

async fn assert_acl_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), InstrumentMasterCustodyErrorV2> {
    let admitted: bool = sqlx::query_scalar("SELECT pg_get_userbyid(n.nspowner)=current_user AND NOT has_schema_privilege('public',n.oid,'USAGE') AND (SELECT COUNT(*)=6 AND bool_and(pg_get_userbyid(c.relowner)=current_user) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind='r' AND c.relname IN ('state','facts','cuts','receipts','outbox','bound_replay_issuances')) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace=n.oid AND c.relname IN ('state','facts','cuts','receipts','outbox','bound_replay_issuances') AND a.grantee<>c.relowner) FROM pg_namespace n WHERE n.nspname='market_data_instrument_master_v2'")
        .fetch_one(&mut **tx).await.map_err(|cause| store_error(&cause))?;

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
    let bytes: Vec<u8> = row.try_get(name).map_err(|cause| store_error(&cause))?;
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
        .map_err(|cause| store_error(&cause))?
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
#[track_caller]
fn store_error(cause: &impl Debug) -> InstrumentMasterCustodyErrorV2 {
    crate::owner::storage_diagnostic::refused_by_store_at(cause);
    InstrumentMasterCustodyErrorV2::StoreUnavailable
}
#[track_caller]
fn classify_insert(error: &sqlx::Error) -> InstrumentMasterCustodyErrorV2 {
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
pub(crate) mod tests {
    use super::*;

    #[rstest::rstest]
    fn schema_is_v2_only_append_ledger() {
        let schema = SCHEMA.join("\n");
        assert!(schema.contains("instrument_master_v2.facts"));
        assert!(schema.contains("instrument_master_v2.outbox"));
        assert!(schema.contains("UNIQUE(predecessor_fact_identity)"));
        assert!(!schema.contains("instrument_master_facts_v1"));
        assert!(!schema.contains(" ON DELETE CASCADE"));
    }

    #[rstest::rstest]
    fn environment_name_is_owner_specific() {
        assert_eq!(
            MARKET_DATA_OWNER_DATABASE_URL_ENV,
            "MARKET_DATA_OWNER_DATABASE_URL"
        );
    }

    /// A universe selection readback over `members` (member key, instrument), every one included,
    /// through the Owner's own selection and issuance.
    pub(crate) fn selection_of(members: &[(&str, &str)]) -> UniverseSelectionReadbackV1 {
        selection_with_request(1, members)
    }

    /// [`selection_of`] under the selection request identity `[request_byte; 32]`, so that more
    /// than one selection can be stored side by side.
    pub(crate) fn selection_with_request(
        request_byte: u8,
        members: &[(&str, &str)],
    ) -> UniverseSelectionReadbackV1 {
        use crate::owner::universe_selection::{
            UntrustedUniverseSelectionRequestV1,
            authority::{
                CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
                issue_source_fact_v1, issue_universe_selection_readback_v1,
                select_complete_membership_v1,
            },
        };
        let digest = |byte: u8| BindingDigest::from_untrusted_bytes([byte; 32]);
        // Observed after the Instrument Master facts (101), at the cut's decision cut of 7.
        let request = UntrustedUniverseSelectionRequestV1::new(
            digest(request_byte),
            "RESEARCH_OWNER_V1",
            digest(2),
            vec![0, 1, 1],
            digest(3),
            10,
            200,
            7,
            digest(4),
            digest(5),
            digest(6),
        );
        let source = members
            .iter()
            .map(|(key, instrument)| {
                issue_source_fact_v1(HistoricalMembershipFactProposalV1 {
                    member_key: key.as_bytes().to_vec(),
                    instrument: instrument.as_bytes().to_vec(),
                    predecessor_identity: None,
                    effective_from_ns: 1,
                    effective_until_ns: None,
                    provider_available_ns: 2,
                    retrieval_ns: 3,
                    correction_publication_ns: 200,
                    owner_observation_ns: 200,
                    decision_cut: 7,
                    source_binding_lineage_root: digest(4),
                    correction_frontier_digest: digest(5),
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("membership facts");
        let mut manifest = members
            .iter()
            .map(|(key, _)| key.as_bytes().to_vec())
            .collect::<Vec<_>>();
        manifest.sort();
        let membership = select_complete_membership_v1(
            &request,
            &source,
            &manifest,
            Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
        )
        .expect("every member included");
        issue_universe_selection_readback_v1(&request, membership, digest(9), 1)
            .expect("selection readback")
    }

    async fn cut_table_shape(pool: &PgPool) -> (bool, Vec<String>) {
        let second_required: bool = sqlx::query_scalar("SELECT a.attnotnull FROM pg_catalog.pg_attribute a WHERE a.attrelid='market_data_instrument_master_v2.cuts'::regclass AND a.attname='second_fact_identity' AND NOT a.attisdropped")
            .fetch_one(pool).await.unwrap();
        let checks: Vec<String> = sqlx::query_scalar("SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c WHERE c.conrelid='market_data_instrument_master_v2.cuts'::regclass AND c.contype='c' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%second_fact_identity%' ORDER BY 1")
            .fetch_all(pool).await.unwrap();
        (second_required, checks)
    }

    async fn cut_rows(pool: &PgPool) -> Vec<(Vec<u8>, Vec<u8>, Option<Vec<u8>>, Vec<u8>)> {
        sqlx::query_as("SELECT cut_identity,first_fact_identity,second_fact_identity,cut_bytes FROM market_data_instrument_master_v2.cuts ORDER BY cut_identity")
            .fetch_all(pool).await.unwrap()
    }

    /// A cut holds one member or two, and a table from before one-member cuts migrates in place.
    ///
    /// A two-member cut is issued, then the table is put back into the shape it had before this
    /// change: `second_fact_identity NOT NULL` and a plain `first <> second` check. Installing
    /// again migrates it once, leaves the stored row byte for byte as it was, and a third install
    /// changes nothing. A half-migrated shape is refused rather than guessed at. Only then is a
    /// one-member cut issued and read back, and two identical members stay refused by the table.
    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn postgres_v2_cut_custody_holds_one_or_two_members_and_migrates_a_legacy_table() {
        use crate::owner::instrument_master_v2::tests::{fact_for, id};

        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        let pool = PgPool::connect(&owner_url).await.unwrap();
        let owner = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .unwrap();
        let btc = fact_for("BTCUSDT-PERP.BINANCE", "BTCUSDT", 10);
        let eth = fact_for("ETHUSDT-PERP.BINANCE", "ETHUSDT", 20);
        owner.append_fact(&btc).await.unwrap();
        owner.append_fact(&eth).await.unwrap();
        let current_shape = (
            false,
            vec!["CHECK (((second_fact_identity IS NULL) OR (first_fact_identity <> second_fact_identity)))".to_owned()],
        );
        assert_eq!(cut_table_shape(&pool).await, current_shape);

        let two = owner
            .issue_cut(
                InstrumentMasterCutRequestV2::new(id(40), 7),
                &selection_of(&[
                    ("BTCUSDT", "BTCUSDT-PERP.BINANCE"),
                    ("ETHUSDT", "ETHUSDT-PERP.BINANCE"),
                ]),
            )
            .await
            .expect("a two-member cut");
        assert_eq!(two.cut().members().len(), 2);

        // Put the table back into the shape a deployed store created before this change holds.
        for statement in [
            "ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT cuts_distinct_members",
            "ALTER TABLE market_data_instrument_master_v2.cuts ADD CHECK(first_fact_identity<>second_fact_identity)",
            "ALTER TABLE market_data_instrument_master_v2.cuts ALTER COLUMN second_fact_identity SET NOT NULL",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        let legacy_shape = (
            true,
            vec!["CHECK ((first_fact_identity <> second_fact_identity))".to_owned()],
        );
        assert_eq!(cut_table_shape(&pool).await, legacy_shape);
        let rows_before = cut_rows(&pool).await;

        let owner = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .expect("the legacy table migrates");
        assert_eq!(cut_table_shape(&pool).await, current_shape);
        assert_eq!(
            cut_rows(&pool).await,
            rows_before,
            "the stored two-member cut is untouched"
        );
        assert_eq!(
            owner.resolve(two.locator()).await.unwrap().cut().identity(),
            two.cut().identity()
        );
        InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .expect("a migrated table installs again");
        assert_eq!(
            cut_table_shape(&pool).await,
            current_shape,
            "the migration ran once"
        );

        // Half-migrated: nullable, but the old check still in place. Refused, not guessed at.
        sqlx::query("ALTER TABLE market_data_instrument_master_v2.cuts ADD CHECK(first_fact_identity<>second_fact_identity)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            InstrumentMasterV2PostgresOwner::install(pool.clone())
                .await
                .is_err(),
            "a shape that is neither legacy nor current is refused"
        );
        sqlx::query("DO $restore$ DECLARE stray TEXT; BEGIN SELECT c.conname INTO stray FROM pg_catalog.pg_constraint c WHERE c.conrelid='market_data_instrument_master_v2.cuts'::regclass AND pg_catalog.pg_get_constraintdef(c.oid)='CHECK ((first_fact_identity <> second_fact_identity))'; EXECUTE format('ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT %I', stray); END $restore$")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(cut_table_shape(&pool).await, current_shape);

        let exec = async |statement: &'static str| {
            sqlx::query(statement).execute(&pool).await.unwrap();
        };

        // The right name with the wrong definition is not the current shape: a same-named
        // `CHECK (true)` would otherwise pass for it and take the distinct-members rule with it.
        exec("ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT cuts_distinct_members").await;
        exec("ALTER TABLE market_data_instrument_master_v2.cuts ADD CONSTRAINT cuts_distinct_members CHECK (true)").await;
        assert!(
            InstrumentMasterV2PostgresOwner::install(pool.clone())
                .await
                .is_err(),
            "a same-named check with another definition is refused"
        );
        exec("ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT cuts_distinct_members").await;
        exec("ALTER TABLE market_data_instrument_master_v2.cuts ADD CONSTRAINT cuts_distinct_members CHECK (second_fact_identity IS NULL OR first_fact_identity <> second_fact_identity)").await;
        assert_eq!(cut_table_shape(&pool).await, current_shape);

        // Two identical legacy checks are not the legacy shape: migrating would drop one and
        // leave the table in a shape the next install refuses. Refused, and left exactly as it was.
        exec("ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT cuts_distinct_members").await;
        exec("ALTER TABLE market_data_instrument_master_v2.cuts ADD CHECK(first_fact_identity<>second_fact_identity)").await;
        exec("ALTER TABLE market_data_instrument_master_v2.cuts ADD CHECK(first_fact_identity<>second_fact_identity)").await;
        exec("ALTER TABLE market_data_instrument_master_v2.cuts ALTER COLUMN second_fact_identity SET NOT NULL").await;
        let doubled = (
            true,
            vec![
                "CHECK ((first_fact_identity <> second_fact_identity))".to_owned(),
                "CHECK ((first_fact_identity <> second_fact_identity))".to_owned(),
            ],
        );
        assert_eq!(cut_table_shape(&pool).await, doubled);
        assert!(
            InstrumentMasterV2PostgresOwner::install(pool.clone())
                .await
                .is_err(),
            "a doubled legacy check is refused"
        );
        assert_eq!(
            cut_table_shape(&pool).await,
            doubled,
            "nothing was half-migrated"
        );
        exec("DO $one$ DECLARE extra TEXT; BEGIN SELECT min(c.conname) INTO extra FROM pg_catalog.pg_constraint c WHERE c.conrelid='market_data_instrument_master_v2.cuts'::regclass AND pg_catalog.pg_get_constraintdef(c.oid)='CHECK ((first_fact_identity <> second_fact_identity))'; EXECUTE format('ALTER TABLE market_data_instrument_master_v2.cuts DROP CONSTRAINT %I', extra); END $one$").await;
        let owner = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .expect("with one legacy check left, the table migrates");
        assert_eq!(cut_table_shape(&pool).await, current_shape);

        let one = owner
            .issue_cut(
                InstrumentMasterCutRequestV2::new(id(41), 7),
                &selection_of(&[("BTCUSDT", "BTCUSDT-PERP.BINANCE")]),
            )
            .await
            .expect("a one-member cut");
        assert_eq!(one.cut().members().len(), 1);
        assert_eq!(
            one.cut().members()[0].fact().canonical_identity(),
            "BTCUSDT-PERP.BINANCE"
        );
        let reread = owner.resolve(one.locator()).await.unwrap();
        assert_eq!(reread.cut().identity(), one.cut().identity());
        assert_eq!(reread.cut().members().len(), 1);
        let one_row = cut_rows(&pool)
            .await
            .into_iter()
            .find(|row| row.0 == one.cut().identity().as_bytes().to_vec())
            .unwrap();
        assert_eq!(one_row.2, None, "a one-member cut stores no second fact");

        // The table still refuses a cut naming one fact twice.
        let duplicate = sqlx::query("UPDATE market_data_instrument_master_v2.cuts SET second_fact_identity=first_fact_identity WHERE cut_identity=$1")
            .bind(one.cut().identity().as_bytes().as_slice())
            .execute(&pool)
            .await
            .unwrap_err();
        assert_eq!(
            duplicate
                .as_database_error()
                .and_then(sqlx::error::DatabaseError::code)
                .as_deref(),
            Some("23514"),
            "check_violation"
        );
    }

    /// Rows in every table a bound-replay issuance may write, and the store's append sequence.
    async fn custody_counts(pool: &PgPool) -> Vec<i64> {
        let mut counts = Vec::new();

        for query in [
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.cuts",
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.receipts",
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.outbox",
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.bound_replay_issuances",
            "SELECT append_sequence FROM market_data_instrument_master_v2.state WHERE singleton",
        ] {
            counts.push(sqlx::query_scalar(query).fetch_one(pool).await.unwrap());
        }
        counts
    }

    async fn persist_selection(
        pool: &PgPool,
        selection: &UniverseSelectionReadbackV1,
        sequence: u64,
    ) {
        let mut tx = pool.begin().await.unwrap();
        crate::owner::postgres::persist_issued_readback_for_test(&mut tx, selection, sequence)
            .await
            .expect("the selection is stored");
        tx.commit().await.unwrap();
    }

    /// Stores a binding the Owner issues over `selection` and returns its exact locator.
    async fn persist_binding(
        pool: &PgPool,
        seed: u8,
        selection: &UniverseSelectionReadbackV1,
    ) -> ReplayCompositionBindingLocatorV1 {
        persist_binding_readback(
            pool,
            &crate::owner::replay_market_facts_v2::tests::binding_over_universe_selection(
                seed,
                selection.record().identity(),
                selection.record().digest(),
            ),
        )
        .await
    }

    /// Stores a universe-member (schema 2) binding over `selection`, which names no Instrument
    /// Master, and returns its exact locator.
    async fn persist_universe_member_binding(
        pool: &PgPool,
        seed: u8,
        selection: &UniverseSelectionReadbackV1,
    ) -> ReplayCompositionBindingLocatorV1 {
        persist_binding_readback(
            pool,
            &crate::owner::replay_market_facts_v2::tests::universe_member_binding_over_universe_selection(
                seed,
                selection.record().identity(),
                selection.record().digest(),
            ),
        )
        .await
    }

    async fn persist_binding_readback(
        pool: &PgPool,
        binding: &crate::owner::replay_market_facts_v2::ReplayCompositionBindingReadbackV1,
    ) -> ReplayCompositionBindingLocatorV1 {
        let mut tx = pool.begin().await.unwrap();
        crate::owner::replay_market_facts_v2::postgres::persist_replay_composition_binding_in_transaction_v1(
            &mut tx, binding,
        )
        .await
        .expect("the binding is stored");
        tx.commit().await.unwrap();
        binding.record().locator()
    }

    fn member_identities(readback: &InstrumentMasterReadbackV2) -> Vec<String> {
        readback
            .cut()
            .members()
            .iter()
            .map(|member| member.fact().canonical_identity().to_owned())
            .collect()
    }

    /// A bound-replay issuance keys one cut to one composition binding, atomically.
    ///
    /// The cut is issued over the selection the binding bound, at that selection's decision cut,
    /// and is the one the key-derived resolver returns. Asking again with the same binding
    /// appends nothing. Asking with a second binding over the same selection is refused by name
    /// with nothing written: that is the case the cut's own idempotency cannot see, since it
    /// compares only the selection. An unknown binding, a three-member selection, and a key whose
    /// cut was issued over another selection are refused without a write, and a failure after the
    /// cut row is written leaves no cut. The issuance neither waits on an open transaction that
    /// holds the binding and selection rows nor collides with concurrent issuances and resolves.
    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn postgres_bound_replay_issuance_keys_each_request_to_one_binding() {
        use std::time::Duration;

        use crate::owner::{
            instrument_master_v2::tests::fact_for,
            replay_market_facts_v2::tests::binding_over_universe_selection,
        };

        const BTC: (&str, &str) = ("BTCUSDT", "BTCUSDT-PERP.BINANCE");
        const ETH: (&str, &str) = ("ETHUSDT", "ETHUSDT-PERP.BINANCE");
        const SOL: (&str, &str) = ("SOLUSDT", "SOLUSDT-PERP.BINANCE");
        let bounded = Duration::from_secs(30);

        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        crate::owner::postgres::MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Market Data custody installs");
        let pool = PgPool::connect(&owner_url).await.unwrap();
        let owner = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .unwrap();

        for (seed, (symbol, instrument)) in [(10, BTC), (20, ETH), (30, SOL)] {
            owner
                .append_fact(&fact_for(instrument, symbol, seed))
                .await
                .unwrap();
        }
        let two = selection_with_request(11, &[BTC, ETH]);
        let one = selection_with_request(12, &[BTC]);
        let three = selection_with_request(13, &[BTC, ETH, SOL]);
        for (sequence, selection) in [(1, &two), (2, &one), (3, &three)] {
            persist_selection(&pool, selection, sequence).await;
        }
        let two_binding = persist_binding(&pool, 1, &two).await;
        let other_two_binding = persist_binding(&pool, 2, &two).await;
        let one_binding = persist_binding(&pool, 3, &one).await;
        let three_binding = persist_binding(&pool, 4, &three).await;
        assert_ne!(two_binding, other_two_binding);

        let issued = owner
            .issue_cut_for_bound_replay_v1("rd-replay-two", two_binding)
            .await
            .expect("a two-member cut over the bound selection");
        assert_eq!(member_identities(&issued), [BTC.1, ETH.1]);
        assert_eq!(issued.cut().decision_cut(), two.record().decision_cut());
        assert_eq!(
            issued.cut().universe_selection_identity(),
            two.record().identity()
        );
        assert_eq!(
            owner
                .resolve_for_native_replay_request("rd-replay-two")
                .await
                .expect("the key resolves"),
            issued
        );

        let settled = custody_counts(&pool).await;
        assert_eq!(settled, [1, 1, 1, 1, 1]);
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-two", two_binding)
                .await
                .expect("the same binding again"),
            issued
        );
        assert_eq!(
            custody_counts(&pool).await,
            settled,
            "a retry appends nothing"
        );
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-two", other_two_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::BoundReplayBindingConflict),
            "a second binding over the same selection is refused under the same key"
        );
        assert_eq!(custody_counts(&pool).await, settled);

        let single = owner
            .issue_cut_for_bound_replay_v1("rd-replay-one", one_binding)
            .await
            .expect("a one-member cut");
        assert_eq!(member_identities(&single), [BTC.1]);

        // A universe-member binding names no Instrument Master: the cut it keys is issued over the
        // selection it bound, from that selection's members alone.
        let universe_one_binding = persist_universe_member_binding(&pool, 6, &one).await;
        let universe_single = owner
            .issue_cut_for_bound_replay_v1("rd-replay-universe-one", universe_one_binding)
            .await
            .expect("a one-member cut keyed by a universe-member binding");
        assert_eq!(member_identities(&universe_single), [BTC.1]);
        assert_eq!(
            universe_single.cut().universe_selection_identity(),
            one.record().identity()
        );
        assert_eq!(
            universe_single.cut().decision_cut(),
            one.record().decision_cut()
        );

        // A member with no Instrument Master fact is refused by name, with nothing written.
        let unmastered = selection_with_request(14, &[("DOGEUSDT", "DOGEUSDT-PERP.BINANCE")]);
        persist_selection(&pool, &unmastered, 4).await;
        let unmastered_binding = persist_universe_member_binding(&pool, 7, &unmastered).await;
        let settled = custody_counts(&pool).await;
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-unmastered", unmastered_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::MissingFact)
        );
        assert_eq!(custody_counts(&pool).await, settled);

        let unstored =
            binding_over_universe_selection(5, two.record().identity(), two.record().digest())
                .record()
                .locator();
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-unstored", unstored)
                .await,
            Err(InstrumentMasterCustodyErrorV2::BoundReplayBindingUnavailable)
        );
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-three", three_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::InvalidUniverseSelection)
        );
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1(" padded", one_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::InvalidRequest)
        );
        assert_eq!(custody_counts(&pool).await, settled);

        // A cut issued for the key outside this path: over the same selection it is adopted with
        // no second cut, over another selection the key conflicts.
        owner
            .issue_cut(
                InstrumentMasterCutRequestV2::for_native_replay_request(
                    "rd-replay-direct",
                    one.record().decision_cut(),
                )
                .unwrap(),
                &one,
            )
            .await
            .unwrap();
        let settled = custody_counts(&pool).await;
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-direct", two_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::RequestConflict)
        );
        assert_eq!(custody_counts(&pool).await, settled);
        let adopted = owner
            .issue_cut_for_bound_replay_v1("rd-replay-direct", one_binding)
            .await
            .expect("the same selection adopts the stored cut");
        assert_eq!(member_identities(&adopted), [BTC.1]);
        let mut expected = settled.clone();
        expected[3] += 1;
        assert_eq!(
            custody_counts(&pool).await,
            expected,
            "only the binding row is new"
        );

        // A failure after the cut rows are written, before commit, leaves no cut behind.
        for statement in [
            "CREATE FUNCTION market_data_instrument_master_v2.refuse_bound_replay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected bound-replay failure'; END $$",
            "CREATE TRIGGER refuse_bound_replay BEFORE INSERT ON market_data_instrument_master_v2.bound_replay_issuances FOR EACH ROW EXECUTE FUNCTION market_data_instrument_master_v2.refuse_bound_replay()",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        let settled = custody_counts(&pool).await;
        assert_eq!(
            owner
                .issue_cut_for_bound_replay_v1("rd-replay-faulted", two_binding)
                .await,
            Err(InstrumentMasterCustodyErrorV2::StoreUnavailable)
        );
        assert_eq!(
            custody_counts(&pool).await,
            settled,
            "the cut rolled back with the fault"
        );

        for statement in [
            "DROP TRIGGER refuse_bound_replay ON market_data_instrument_master_v2.bound_replay_issuances",
            "DROP FUNCTION market_data_instrument_master_v2.refuse_bound_replay()",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        // An open transaction holding the binding rows `FOR SHARE`, as R&D's does, and the
        // selection rows `FOR UPDATE`, as the selection resolver's does, does not hold it up.
        let mut holder = pool.begin().await.unwrap();
        sqlx::query("SELECT 1 FROM market_data_private.replay_composition_bindings_v1 WHERE binding_identity=$1 FOR SHARE")
            .bind(one_binding.binding_identity().as_bytes().as_slice())
            .fetch_one(&mut *holder)
            .await
            .unwrap();
        sqlx::query("SELECT 1 FROM market_data_private.universe_selection_records_v1 WHERE selection_identity=$1 FOR UPDATE")
            .bind(one.record().identity().as_bytes().as_slice())
            .fetch_one(&mut *holder)
            .await
            .unwrap();
        tokio::time::timeout(
            bounded,
            owner.issue_cut_for_bound_replay_v1("rd-replay-held", one_binding),
        )
        .await
        .expect("the issuance does not wait on the open transaction")
        .expect("the issuance succeeds while it is open");
        holder.rollback().await.unwrap();

        // Two issuances and a resolve at once, repeatedly: all complete, none is refused.
        for round in 0..8 {
            let first = format!("rd-replay-concurrent-{round}-a");
            let second = format!("rd-replay-concurrent-{round}-b");
            let (a, b, resolved) = tokio::time::timeout(bounded, async {
                // Boxed: three issuances' futures side by side exceed the large-future limit.
                tokio::join!(
                    Box::pin(owner.issue_cut_for_bound_replay_v1(&first, two_binding)),
                    Box::pin(owner.issue_cut_for_bound_replay_v1(&second, one_binding)),
                    Box::pin(owner.resolve(issued.locator())),
                )
            })
            .await
            .expect("no concurrent participant waits forever");
            assert_eq!(
                member_identities(&a.expect("first issuance")),
                [BTC.1, ETH.1]
            );
            assert_eq!(member_identities(&b.expect("second issuance")), [BTC.1]);
            assert_eq!(resolved.expect("concurrent resolve"), issued);
        }
    }
}
