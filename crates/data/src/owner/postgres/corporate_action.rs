//! Caller-transaction PostgreSQL custody for native Corporate Action V1.

#![allow(
    dead_code,
    reason = "positive Replay/Backtest composition is intentionally not installed"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    corporate_action::{
        AuthenticatedCorporateActionInputsV1, CorporateActionErrorV1, CorporateActionIdentity,
        CorporateActionReadbackV1, UntrustedCorporateActionLocatorV1,
        UntrustedCorporateActionProposalV1,
        authority::{
            decode_and_verify_readback_v1, issue_facts_and_cut_v1, issue_readback_v1,
            validate_successor_v1,
        },
    },
    source_binding::BindingDigest,
};

pub(super) const CORPORATE_ACTION_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), action_identity BYTEA NOT NULL CHECK(octet_length(action_identity)=32), instrument BYTEA NOT NULL CHECK(octet_length(instrument)>0), predecessor_identity BYTEA NULL REFERENCES market_data_private.corporate_action_facts_v1(fact_identity), effective_from_ns TEXT NOT NULL, effective_until_ns TEXT NULL, owner_observation_ns TEXT NOT NULL, decision_cut BIGINT NOT NULL CHECK(decision_cut>0), correction_identity BYTEA NOT NULL CHECK(octet_length(correction_identity)=32), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0), UNIQUE(action_identity,correction_identity), UNIQUE(action_identity,predecessor_identity))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_facts_v1 FROM PUBLIC",
    "CREATE UNIQUE INDEX IF NOT EXISTS corporate_action_one_genesis_v1 ON market_data_private.corporate_action_facts_v1(action_identity) WHERE predecessor_identity IS NULL",
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_heads_v1 (action_identity BYTEA PRIMARY KEY CHECK(octet_length(action_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.corporate_action_facts_v1(fact_identity))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_heads_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_cuts_v1 (request_identity BYTEA PRIMARY KEY CHECK(octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), cut_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(cut_identity)=32), cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_cuts_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_state_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.corporate_action_cuts_v1(request_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0), readback_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(readback_identity)=32), readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_receipts_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.corporate_action_outbox_v1 (outbox_identity BYTEA PRIMARY KEY REFERENCES market_data_private.corporate_action_receipts_v1(receipt_identity) CHECK(octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.corporate_action_receipts_v1(request_identity), payload BYTEA NOT NULL CHECK(octet_length(payload)>0))",
    "REVOKE ALL ON TABLE market_data_private.corporate_action_outbox_v1 FROM PUBLIC",
];

pub(super) async fn install_corporate_action_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), CorporateActionErrorV1> {
    for statement in CORPORATE_ACTION_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn resolve_corporate_action_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &UntrustedCorporateActionProposalV1,
    inputs: &AuthenticatedCorporateActionInputsV1,
) -> Result<CorporateActionReadbackV1, CorporateActionErrorV1> {
    let (facts, cut) = issue_facts_and_cut_v1(proposal, inputs)?;
    advisory_lock(transaction, proposal.request_identity).await?;
    if let Some(readback) = load_readback(transaction, proposal.request_identity, true).await? {
        if readback.receipt().request_meaning_digest != proposal.request_meaning_digest
            || readback.cut().identity() != cut.identity()
        {
            return Err(CorporateActionErrorV1::RequestConflict);
        }
        return Ok(readback);
    }
    for fact in &facts {
        advisory_lock(transaction, fact.action_identity()).await?;
        let head:Option<Vec<u8>>=sqlx::query_scalar("SELECT f.fact_bytes FROM market_data_private.corporate_action_heads_v1 h JOIN market_data_private.corporate_action_facts_v1 f ON f.fact_identity=h.fact_identity WHERE h.action_identity=$1 FOR UPDATE OF h,f").bind(fact.action_identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        let predecessor = head
            .as_deref()
            .map(crate::owner::corporate_action::codec::decode_fact)
            .transpose()?;
        if predecessor
            .as_ref()
            .is_some_and(|prior| prior.identity() == fact.identity())
        {
            if predecessor
                .as_ref()
                .is_none_or(|prior| prior.canonical_bytes() != fact.canonical_bytes())
            {
                return Err(CorporateActionErrorV1::StoreUntrusted);
            }
        } else {
            validate_successor_v1(predecessor.as_ref(), fact)?;
        }
    }
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
    let generation = store_generation(&database);
    sqlx::query("INSERT INTO market_data_private.corporate_action_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING").bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    let sequence:i64=sqlx::query_scalar("UPDATE market_data_private.corporate_action_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING append_sequence").bind(generation.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?.ok_or(CorporateActionErrorV1::StoreUntrusted)?;
    let readback = issue_readback_v1(
        facts,
        cut,
        generation,
        u64::try_from(sequence).map_err(|_| CorporateActionErrorV1::StoreUntrusted)?,
        proposal.stable_correlation,
    )?;
    persist_readback(transaction, &readback).await?;
    Ok(readback)
}

pub(super) async fn recover_corporate_action_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: UntrustedCorporateActionLocatorV1,
) -> Result<CorporateActionReadbackV1, CorporateActionErrorV1> {
    advisory_lock(transaction, locator.request_identity).await?;
    let readback = load_readback(transaction, locator.request_identity, true)
        .await?
        .ok_or(CorporateActionErrorV1::UnknownIdentity)?;
    if readback.receipt().request_meaning_digest != locator.request_meaning_digest {
        return Err(CorporateActionErrorV1::RequestConflict);
    }
    Ok(readback)
}

async fn persist_readback(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CorporateActionReadbackV1,
) -> Result<(), CorporateActionErrorV1> {
    for fact in readback.facts() {
        sqlx::query("INSERT INTO market_data_private.corporate_action_facts_v1(fact_identity,action_identity,instrument,predecessor_identity,effective_from_ns,effective_until_ns,owner_observation_ns,decision_cut,correction_identity,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(fact_identity) DO NOTHING").bind(fact.identity().as_bytes().as_slice()).bind(fact.action_identity().as_bytes().as_slice()).bind(fact.instrument()).bind(fact.predecessor_identity().map(|v|v.as_bytes().to_vec())).bind(fact.effective_from_ns.to_string()).bind(fact.effective_until_ns.map(|v|v.to_string())).bind(fact.owner_observation_ns.to_string()).bind(i64::try_from(fact.decision_cut).map_err(|_|CorporateActionErrorV1::CapacityExceeded)?).bind(fact.correction_identity.as_bytes().as_slice()).bind(fact.canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
        let stored:Vec<u8>=sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.corporate_action_facts_v1 WHERE fact_identity=$1 FOR UPDATE").bind(fact.identity().as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
        if stored != fact.canonical_bytes() {
            return Err(CorporateActionErrorV1::StoreUntrusted);
        }
        sqlx::query("INSERT INTO market_data_private.corporate_action_heads_v1(action_identity,fact_identity) VALUES($1,$2) ON CONFLICT(action_identity) DO UPDATE SET fact_identity=EXCLUDED.fact_identity").bind(fact.action_identity().as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    }
    sqlx::query("INSERT INTO market_data_private.corporate_action_cuts_v1(request_identity,request_meaning_digest,cut_identity,cut_bytes) VALUES($1,$2,$3,$4)").bind(readback.cut().request_identity.as_bytes().as_slice()).bind(readback.cut().request_meaning_digest.as_bytes().as_slice()).bind(readback.cut().identity().as_bytes().as_slice()).bind(readback.cut().canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.corporate_action_receipts_v1(request_identity,receipt_identity,receipt_bytes,readback_identity,readback_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6)").bind(readback.cut().request_identity.as_bytes().as_slice()).bind(readback.receipt().identity().as_bytes().as_slice()).bind(readback.receipt().canonical_bytes()).bind(readback.identity().as_bytes().as_slice()).bind(readback.canonical_bytes()).bind(i64::try_from(readback.receipt().append_sequence).map_err(|_|CorporateActionErrorV1::CapacityExceeded)?).execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.corporate_action_outbox_v1(outbox_identity,request_identity,payload) VALUES($1,$2,$3)").bind(readback.outbox_identity().as_bytes().as_slice()).bind(readback.cut().request_identity.as_bytes().as_slice()).bind(readback.receipt().canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
    Ok(())
}

async fn load_readback(
    transaction: &mut Transaction<'_, Postgres>,
    request: BindingDigest,
    lock: bool,
) -> Result<Option<CorporateActionReadbackV1>, CorporateActionErrorV1> {
    let sql = if lock {
        "SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.corporate_action_cuts_v1 c JOIN market_data_private.corporate_action_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.corporate_action_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1 FOR UPDATE OF c,r,o"
    } else {
        "SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.corporate_action_cuts_v1 c JOIN market_data_private.corporate_action_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.corporate_action_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1"
    };
    let row = sqlx::query(sql)
        .bind(request.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(store_error)?;
    let Some(row) = row else {
        let partial:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.corporate_action_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.corporate_action_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.corporate_action_outbox_v1 WHERE request_identity=$1)").bind(request.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
        return if partial {
            Err(CorporateActionErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let bytes: Vec<u8> = row.try_get("readback_bytes").map_err(store_error)?;
    let readback = decode_and_verify_readback_v1(&bytes)?;
    let state:Option<(Vec<u8>,i64)>=sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.corporate_action_state_v1 WHERE singleton").fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let stored_facts:Vec<Vec<u8>>=sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.corporate_action_facts_v1 WHERE fact_identity=ANY($1) ORDER BY fact_identity").bind(readback.facts().iter().map(|f|f.identity().as_bytes().to_vec()).collect::<Vec<_>>()).fetch_all(&mut **transaction).await.map_err(store_error)?;
    let mut expected = readback
        .facts()
        .iter()
        .map(|f| (f.identity(), f.canonical_bytes().to_vec()))
        .collect::<Vec<_>>();
    expected.sort_by_key(|v| v.0);
    let exact = row_bytes(&row, "request_meaning_digest")?
        == readback.cut().request_meaning_digest.as_bytes()
        && row_bytes(&row, "cut_identity")? == readback.cut().identity().as_bytes()
        && row_bytes(&row, "cut_bytes")? == readback.cut().canonical_bytes()
        && row_bytes(&row, "receipt_identity")? == readback.receipt().identity().as_bytes()
        && row_bytes(&row, "receipt_bytes")? == readback.receipt().canonical_bytes()
        && row_bytes(&row, "readback_identity")? == readback.identity().as_bytes()
        && row_bytes(&row, "outbox_identity")? == readback.outbox_identity().as_bytes()
        && row_bytes(&row, "payload")? == readback.receipt().canonical_bytes()
        && stored_facts == expected.into_iter().map(|v| v.1).collect::<Vec<_>>()
        && u64::try_from(
            row.try_get::<i64, _>("append_sequence")
                .map_err(store_error)?,
        )
        .ok()
            == Some(readback.receipt().append_sequence)
        && state.is_some_and(|(generation, sequence)| {
            generation == readback.receipt().store_generation_identity.as_bytes()
                && u64::try_from(sequence)
                    .is_ok_and(|value| value >= readback.receipt().append_sequence)
        });
    if !exact {
        return Err(CorporateActionErrorV1::StoreUntrusted);
    }
    Ok(Some(readback))
}

async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), CorporateActionErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex'),0))")
        .bind(identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    Ok(())
}
fn row_bytes(row: &sqlx::postgres::PgRow, name: &str) -> Result<Vec<u8>, CorporateActionErrorV1> {
    row.try_get(name).map_err(store_error)
}
fn store_generation(database: &str) -> CorporateActionIdentity {
    let mut h = blake3::Hasher::new();
    h.update(b"vibe.market-data.corporate-action-store-generation.v1\0");
    h.update(database.as_bytes());
    CorporateActionIdentity::from_untrusted_bytes(*h.finalize().as_bytes())
}
fn store_error(_: impl std::fmt::Debug) -> CorporateActionErrorV1 {
    CorporateActionErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::CORPORATE_ACTION_SCHEMA_V1;
    #[test]
    fn schema_is_private_write_once_complete_and_outbox_equals_receipt() {
        let schema = CORPORATE_ACTION_SCHEMA_V1.join("\n");
        for name in [
            "corporate_action_facts_v1",
            "corporate_action_heads_v1",
            "corporate_action_cuts_v1",
            "corporate_action_receipts_v1",
            "corporate_action_outbox_v1",
        ] {
            assert!(schema.contains(name));
        }
        assert!(schema.contains("FROM PUBLIC"));
        assert!(schema.contains(
            "REFERENCES market_data_private.corporate_action_receipts_v1(receipt_identity)"
        ));
        assert!(!schema.contains("GRANT "));
    }
}
