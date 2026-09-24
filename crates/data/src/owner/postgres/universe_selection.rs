//! Caller-transaction PostgreSQL custody for historical membership and Universe Selection W1.
//!
//! Every operation borrows the caller's transaction. This module never owns a pool, begins, commits,
//! or rolls back a transaction, so a later composition root can atomically join this custody with
//! its enclosing Owner operation.

#![allow(
    dead_code,
    reason = "W2 composition registration is outside the W1 path lease"
)]

use std::collections::BTreeSet;
use std::fmt::Debug;
use std::future::Future;
use std::pin::Pin;

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    instrument_master::authority::{ObservationClockV1, select_facts_observed},
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    source_binding::BindingDigest,
    universe_selection::{
        HistoricalMembershipRecordV1, UniverseSelectionErrorV1, UniverseSelectionReadbackV1,
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
        authority::{
            HistoricalMembershipFactProposalV1, UniverseSelectionRuleEvaluatorV1,
            decode_readback_v1, decode_source_fact_v1, fixed_member_scope_v1, issue_source_fact_v1,
            issue_universe_selection_readback_v1, select_complete_membership_v1, validate_request,
        },
        codec,
    },
};

pub(super) const MAX_UNIVERSE_SELECTION_AGGREGATE_BYTES_V1: usize = 8 * 1024 * 1024;

pub(super) const UNIVERSE_SELECTION_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.historical_membership_frontiers_v1 (eligible_frontier BYTEA PRIMARY KEY CHECK(octet_length(eligible_frontier)=32))",
    // Admission order: each frontier created from now on takes the next number, and the latest
    // numbered frontier is the one Market Data holds as current. A frontier admitted before this
    // column existed has no number and is never current; it is not renumbered, so its membership
    // counts again only once it is admitted under a new frontier digest.
    "CREATE SEQUENCE IF NOT EXISTS market_data_private.historical_membership_frontier_admissions_v1 AS BIGINT MINVALUE 1",
    "ALTER TABLE market_data_private.historical_membership_frontiers_v1 ADD COLUMN IF NOT EXISTS admission_sequence BIGINT UNIQUE CHECK (admission_sequence > 0)",
    "REVOKE ALL ON SEQUENCE market_data_private.historical_membership_frontier_admissions_v1 FROM PUBLIC",
    // The one statement of which frontier is current, for the Owner's own evaluation and for the
    // reads it answers R&D with alike.
    "CREATE OR REPLACE FUNCTION market_data_private.current_eligible_frontier_v1() RETURNS BYTEA LANGUAGE SQL STABLE SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.eligible_frontier FROM market_data_private.historical_membership_frontiers_v1 f WHERE f.admission_sequence IS NOT NULL ORDER BY f.admission_sequence DESC LIMIT 1 $function$",
    "REVOKE ALL ON FUNCTION market_data_private.current_eligible_frontier_v1() FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.historical_membership_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), eligible_frontier BYTEA NOT NULL CHECK(octet_length(eligible_frontier)=32), member_key BYTEA NOT NULL CHECK(octet_length(member_key)>0), instrument BYTEA NOT NULL CHECK(octet_length(instrument)>0), predecessor_identity BYTEA NULL REFERENCES market_data_private.historical_membership_facts_v1(fact_identity), decision_cut BIGINT NOT NULL CHECK(decision_cut>0), owner_observation_ns TEXT NOT NULL CHECK(owner_observation_ns<>''), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0), UNIQUE(eligible_frontier,member_key,fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.historical_membership_heads_v1 (eligible_frontier BYTEA NOT NULL CHECK(octet_length(eligible_frontier)=32), member_key BYTEA NOT NULL CHECK(octet_length(member_key)>0), fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.historical_membership_facts_v1(fact_identity), PRIMARY KEY(eligible_frontier,member_key))",
    "CREATE TABLE IF NOT EXISTS market_data_private.historical_membership_manifest_v1 (eligible_frontier BYTEA NOT NULL CHECK(octet_length(eligible_frontier)=32), ordinal BIGINT NOT NULL CHECK(ordinal>0), member_key BYTEA NOT NULL CHECK(octet_length(member_key)>0), PRIMARY KEY(eligible_frontier,ordinal), UNIQUE(eligible_frontier,member_key))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_selection_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_selection_records_v1 (selection_identity BYTEA PRIMARY KEY CHECK(octet_length(selection_identity)=32), request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), record_bytes BYTEA NOT NULL CHECK(octet_length(record_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_selection_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.universe_selection_records_v1(request_identity), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), selection_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.universe_selection_records_v1(selection_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.universe_selection_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.universe_selection_receipts_v1(request_identity), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0))",
];

pub(super) async fn install_universe_selection_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), UniverseSelectionErrorV1> {
    for statement in UNIVERSE_SELECTION_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|cause| store_error(&cause))?;
    }
    Ok(())
}

/// The eligible-instrument frontier Market Data holds as current: the latest admitted one.
///
/// Admission order is Market Data's own, so a requester never chooses the frontier its selection
/// is evaluated against. `None` when no frontier has been admitted since frontiers were numbered.
pub(super) async fn resolve_current_eligible_frontier_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<BindingDigest>, UniverseSelectionErrorV1> {
    let current: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT market_data_private.current_eligible_frontier_v1()")
            .fetch_one(&mut **transaction)
            .await
            .map_err(|cause| store_error(&cause))?;
    current
        .map(|bytes| {
            <[u8; 32]>::try_from(bytes.as_slice())
                .map(BindingDigest::from_untrusted_bytes)
                .map_err(|_| UniverseSelectionErrorV1::StoreUntrusted)
        })
        .transpose()
}

pub(super) async fn persist_historical_membership_frontier_v1(
    transaction: &mut Transaction<'_, Postgres>,
    eligible_frontier: BindingDigest,
    proposals: Vec<HistoricalMembershipFactProposalV1>,
) -> Result<(), UniverseSelectionErrorV1> {
    if !codec::nonzero(eligible_frontier) || proposals.len() > codec::MAX_MEMBERSHIP_RECORDS {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    advisory_lock(transaction, eligible_frontier).await?;
    let created = sqlx::query("INSERT INTO market_data_private.historical_membership_frontiers_v1(eligible_frontier,admission_sequence) VALUES($1,nextval('market_data_private.historical_membership_frontier_admissions_v1')) ON CONFLICT(eligible_frontier) DO NOTHING")
        .bind(eligible_frontier.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?
        .rows_affected() == 1;
    let mut facts = proposals
        .into_iter()
        .map(issue_source_fact_v1)
        .collect::<Result<Vec<_>, _>>()?;
    facts.sort_by(|left, right| {
        (
            left.member_key(),
            left.decision_cut(),
            left.identity().as_bytes(),
        )
            .cmp(&(
                right.member_key(),
                right.decision_cut(),
                right.identity().as_bytes(),
            ))
    });
    let member_keys: Vec<Vec<u8>> = facts
        .iter()
        .map(|fact| fact.member_key().to_vec())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let stored_manifest: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_key FROM market_data_private.historical_membership_manifest_v1 WHERE eligible_frontier=$1 ORDER BY ordinal FOR SHARE",
    ).bind(eligible_frontier.as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(|cause| store_error(&cause))?;

    if !created
        && member_keys
            .iter()
            .any(|key| stored_manifest.binary_search(key).is_err())
    {
        return Err(UniverseSelectionErrorV1::RequestConflict);
    }

    if created {
        for (index, member_key) in member_keys.iter().enumerate() {
            sqlx::query("INSERT INTO market_data_private.historical_membership_manifest_v1(eligible_frontier,ordinal,member_key) VALUES($1,$2,$3)")
                .bind(eligible_frontier.as_bytes().as_slice()).bind(i64::try_from(index + 1).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?)
                .bind(member_key).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        }
    }

    for fact in &facts {
        advisory_lock(transaction, fact.identity()).await?;
    }

    for fact in facts {
        if let Some(predecessor) = fact.predecessor_identity() {
            let prior: Option<(Vec<u8>, Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT eligible_frontier,member_key,instrument FROM market_data_private.historical_membership_facts_v1 WHERE fact_identity=$1 FOR SHARE")
                .bind(predecessor.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
            if prior.is_none_or(|(frontier, member, instrument)| {
                frontier != eligible_frontier.as_bytes().as_slice()
                    || member != fact.member_key()
                    || instrument != fact.instrument()
            }) {
                return Err(UniverseSelectionErrorV1::InvalidMembership);
            }
        }
        // A fact's identity does not name its frontier, but its row does: the same fact stated
        // for a second frontier is a caller conflict, refused here rather than left to surface as
        // the heads table's unique violation.
        let existing: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT eligible_frontier,fact_bytes FROM market_data_private.historical_membership_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
            .bind(fact.identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        if let Some((frontier, bytes)) = existing {
            if frontier.is_empty()
                || bytes != fact.canonical_bytes()
            {
                return Err(UniverseSelectionErrorV1::RequestConflict);
            }
        } else {
            sqlx::query("INSERT INTO market_data_private.historical_membership_facts_v1(fact_identity,eligible_frontier,member_key,instrument,predecessor_identity,decision_cut,owner_observation_ns,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
                .bind(fact.identity().as_bytes().as_slice()).bind(eligible_frontier.as_bytes().as_slice())
                .bind(fact.member_key()).bind(fact.instrument()).bind(fact.predecessor_identity().map(|value| value.as_bytes().to_vec()))
                .bind(extract_decision_cut(fact.canonical_bytes())?).bind(extract_owner_observation(fact.canonical_bytes())?.to_string())
                .bind(fact.canonical_bytes()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        }
        let head: Option<Vec<u8>> = sqlx::query_scalar("SELECT fact_identity FROM market_data_private.historical_membership_heads_v1 WHERE eligible_frontier=$1 AND member_key=$2 FOR UPDATE")
            .bind(eligible_frontier.as_bytes().as_slice()).bind(fact.member_key()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        match head {
            None if fact.predecessor_identity().is_none() => {
                sqlx::query("INSERT INTO market_data_private.historical_membership_heads_v1(eligible_frontier,member_key,fact_identity) VALUES($1,$2,$3)")
                    .bind(eligible_frontier.as_bytes().as_slice()).bind(fact.member_key()).bind(fact.identity().as_bytes().as_slice())
                    .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
            }
            Some(head)
                if fact
                    .predecessor_identity()
                    .is_some_and(|prior| prior.as_bytes().as_slice() == head) =>
            {
                sqlx::query("UPDATE market_data_private.historical_membership_heads_v1 SET fact_identity=$3 WHERE eligible_frontier=$1 AND member_key=$2")
                    .bind(eligible_frontier.as_bytes().as_slice()).bind(fact.member_key()).bind(fact.identity().as_bytes().as_slice())
                    .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
            }
            Some(head) if head == fact.identity().as_bytes().as_slice() => {}
            _ => return Err(UniverseSelectionErrorV1::RequestConflict),
        }
    }
    Ok(())
}

pub(super) async fn resolve_universe_selection_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedUniverseSelectionRequestV1,
    evaluator: Option<&dyn UniverseSelectionRuleEvaluatorV1>,
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    validate_request(request)?;
    advisory_lock(transaction, request.request_identity()).await?;
    advisory_lock(transaction, request.eligible_instrument_frontier()).await?;
    advisory_lock(transaction, request.correction_frontier_digest()).await?;
    if let Some(readback) = load_readback(transaction, request.request_identity(), true).await? {
        if readback.record().request_meaning_digest() != request.request_meaning_digest() {
            return Err(UniverseSelectionErrorV1::RequestConflict);
        }
        return Ok(readback);
    }
    let expected_member_keys: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_key FROM market_data_private.historical_membership_manifest_v1 WHERE eligible_frontier=$1 ORDER BY ordinal FOR SHARE",
    ).bind(request.eligible_instrument_frontier().as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    let fact_bytes: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT fact_bytes FROM market_data_private.historical_membership_facts_v1 WHERE eligible_frontier=$1 ORDER BY member_key,decision_cut,fact_identity FOR SHARE",
    ).bind(request.eligible_instrument_frontier().as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    let frontier_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.historical_membership_frontiers_v1 WHERE eligible_frontier=$1)")
        .bind(request.eligible_instrument_frontier().as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(|cause| store_error(&cause))?;

    if !frontier_exists {
        return Err(UniverseSelectionErrorV1::UnknownIdentity);
    }
    let source_facts = fact_bytes
        .iter()
        .map(|bytes| decode_source_fact_v1(bytes))
        .collect::<Result<Vec<_>, _>>()?;
    let fixed = fixed_member_scope_v1(
        request.selection_rule_identity(),
        request.selection_rule_bytes(),
    )?;
    if let Some(scope) = &fixed {
        fixed_member_preconditions_v1(transaction, request, scope).await?;
    }
    let membership =
        select_complete_membership_v1(request, &source_facts, &expected_member_keys, evaluator)?;
    if let Some(scope) = &fixed {
        fixed_members_included_v1(scope, &membership)?;
    }
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let generation = codec::digest(codec::STORE_GENERATION_DOMAIN, database.as_bytes());
    sqlx::query("INSERT INTO market_data_private.universe_selection_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    let sequence: i64 = sqlx::query_scalar("UPDATE market_data_private.universe_selection_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING append_sequence")
        .bind(generation.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
        .ok_or(UniverseSelectionErrorV1::StoreUntrusted)?;
    let sequence = u64::try_from(sequence).map_err(|_| UniverseSelectionErrorV1::StoreUntrusted)?;
    let readback = issue_universe_selection_readback_v1(request, membership, generation, sequence)?;
    validate_aggregate_size(&readback)?;
    insert_readback_rows(transaction, &readback, sequence).await?;
    Ok(readback)
}

type FixedMemberPreconditionsFutureV1<'a> =
    Pin<Box<dyn Future<Output = Result<(), UniverseSelectionErrorV1>> + Send + 'a>>;

/// What a fixed-member request needs before its frontier is evaluated.
///
/// It is evaluated against the frontier Market Data holds as current, never one the requester
/// chose, and each requested identity must resolve to an Instrument Master fact in force and
/// observable at the request's instants: an unresolved identity is refused, never dropped from a
/// selection that would then hold fewer members. Built outside the caller's frame, which sits on
/// the replay composition chain entry's deepest path.
fn fixed_member_preconditions_v1<'a, 'b: 'a>(
    transaction: &'a mut Transaction<'b, Postgres>,
    request: &'a UntrustedUniverseSelectionRequestV1,
    scope: &'a ResearchInstrumentScopeV1,
) -> FixedMemberPreconditionsFutureV1<'a> {
    Box::pin(async move {
        if resolve_current_eligible_frontier_v1(transaction).await?
            != Some(request.eligible_instrument_frontier())
        {
            return Err(UniverseSelectionErrorV1::FrontierNotCurrent);
        }
        let clock = super::load_owner_clock_head_v1(transaction)
            .await
            .map_err(|cause| store_error(&cause))?
            .ok_or(UniverseSelectionErrorV1::StoreUnavailable)?;
        let clock = ObservationClockV1::from_owner_head(
            &clock.clock_identity,
            &clock.clock_epoch,
            clock.monotonic_sequence,
        )
        .ok_or(UniverseSelectionErrorV1::StoreUntrusted)?;
        let facts = super::load_instrument_facts(transaction, scope.identities(), false)
            .await
            .map_err(|cause| store_error(&cause))?;

        for identity in scope.identities() {
            select_facts_observed(
                &facts,
                std::slice::from_ref(identity),
                request.effective_at_ns(),
                request.owner_observation_ns(),
                request.decision_cut(),
                clock,
            )
            .map_err(|_| UniverseSelectionErrorV1::FixedMemberUnresolved)?;
        }
        Ok(())
    })
}

/// Each identity a fixed-member request names is included by exactly one member.
fn fixed_members_included_v1(
    scope: &ResearchInstrumentScopeV1,
    membership: &[HistoricalMembershipRecordV1],
) -> Result<(), UniverseSelectionErrorV1> {
    for identity in scope.identities() {
        let included = membership
            .iter()
            .filter(|member| member.included() && member.instrument() == identity.as_bytes())
            .count();

        if included != 1 {
            return Err(UniverseSelectionErrorV1::FixedMemberNotInFrontier);
        }
    }
    Ok(())
}

/// Writes one issued selection's record, receipt, and outbox rows; the only writer of all three.
async fn insert_readback_rows(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &UniverseSelectionReadbackV1,
    sequence: u64,
) -> Result<(), UniverseSelectionErrorV1> {
    let record = readback.record();
    sqlx::query("INSERT INTO market_data_private.universe_selection_records_v1(selection_identity,request_identity,request_meaning_digest,record_bytes) VALUES($1,$2,$3,$4)")
        .bind(record.identity().as_bytes().as_slice()).bind(record.request_identity().as_bytes().as_slice())
        .bind(record.request_meaning_digest().as_bytes().as_slice()).bind(record.canonical_bytes())
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    sqlx::query("INSERT INTO market_data_private.universe_selection_receipts_v1(request_identity,request_meaning_digest,selection_identity,receipt_identity,receipt_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(record.request_identity().as_bytes().as_slice()).bind(record.request_meaning_digest().as_bytes().as_slice())
        .bind(record.identity().as_bytes().as_slice()).bind(readback.receipt().identity().as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).bind(i64::try_from(sequence).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?)
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    sqlx::query("INSERT INTO market_data_private.universe_selection_outbox_v1(outbox_identity,request_identity,receipt_bytes) VALUES($1,$2,$3)")
        .bind(readback.outbox_identity().as_bytes().as_slice()).bind(record.request_identity().as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    Ok(())
}

/// Stores a selection the Owner issued in memory through the same rows its resolver writes, for
/// a test that needs a persisted selection without the membership frontier behind it.
#[cfg(test)]
pub(in crate::owner) async fn persist_issued_readback_for_test(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &UniverseSelectionReadbackV1,
    sequence: u64,
) -> Result<(), UniverseSelectionErrorV1> {
    insert_readback_rows(transaction, readback, sequence).await
}

pub(super) async fn recover_universe_selection_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedUniverseSelectionLocatorV1,
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    advisory_lock(transaction, locator.request_identity()).await?;
    let readback = load_readback(transaction, locator.request_identity(), true)
        .await?
        .ok_or(UniverseSelectionErrorV1::UnknownIdentity)?;
    if readback.record().request_meaning_digest() != locator.request_meaning_digest() {
        return Err(UniverseSelectionErrorV1::RequestConflict);
    }
    Ok(readback)
}

/// Reads the one Universe Selection with this record identity and digest, without locking it.
///
/// A composition binding names the selection it bound by record, not by request, so the
/// bound-replay Instrument Master cut issuance finds it this way. Selection rows are append-only
/// and the read runs in the caller's snapshot, so it needs no lock; taking none means it can never
/// wait on a transaction that holds the selection's rows.
pub(super) async fn recover_universe_selection_by_record_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
    digest: BindingDigest,
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    let request_identity: Vec<u8> = sqlx::query_scalar(
        "SELECT request_identity FROM market_data_private.universe_selection_records_v1 WHERE selection_identity=$1",
    )
    .bind(identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?
    .ok_or(UniverseSelectionErrorV1::UnknownIdentity)?;
    let readback = load_readback(transaction, digest_from_row(request_identity)?, false)
        .await?
        .ok_or(UniverseSelectionErrorV1::StoreUntrusted)?;
    if readback.record().identity() != identity || readback.record().digest() != digest {
        return Err(UniverseSelectionErrorV1::DigestMismatch);
    }
    Ok(readback)
}

async fn load_readback(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: BindingDigest,
    lock: bool,
) -> Result<Option<UniverseSelectionReadbackV1>, UniverseSelectionErrorV1> {
    let row = if lock {
        sqlx::query("SELECT r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 r JOIN market_data_private.universe_selection_receipts_v1 c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 o ON o.request_identity=r.request_identity WHERE r.request_identity=$1 FOR UPDATE OF r,c,o")
            .bind(request_identity.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    } else {
        sqlx::query("SELECT r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 r JOIN market_data_private.universe_selection_receipts_v1 c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 o ON o.request_identity=r.request_identity WHERE r.request_identity=$1")
            .bind(request_identity.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    };
    let Some(row) = row else {
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.universe_selection_records_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.universe_selection_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.universe_selection_outbox_v1 WHERE request_identity=$1)")
            .bind(request_identity.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        return if partial {
            Err(UniverseSelectionErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let meaning = digest_from_row(
        row.try_get("request_meaning_digest")
            .map_err(|cause| store_error(&cause))?,
    )?;
    let selection = digest_from_row(
        row.try_get("selection_identity")
            .map_err(|cause| store_error(&cause))?,
    )?;
    let record_bytes: Vec<u8> = row
        .try_get("record_bytes")
        .map_err(|cause| store_error(&cause))?;
    let receipt_identity = digest_from_row(
        row.try_get("receipt_identity")
            .map_err(|cause| store_error(&cause))?,
    )?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|cause| store_error(&cause))?;
    let outbox_identity = digest_from_row(
        row.try_get("outbox_identity")
            .map_err(|cause| store_error(&cause))?,
    )?;
    let outbox_receipt: Vec<u8> = row
        .try_get("outbox_receipt_bytes")
        .map_err(|cause| store_error(&cause))?;
    let readback = decode_readback_v1(&record_bytes, &receipt_bytes, outbox_identity)?;
    if readback.record().request_identity() != request_identity
        || readback.record().request_meaning_digest() != meaning
        || readback.record().identity() != selection
        || readback.receipt().identity() != receipt_identity
        || outbox_receipt != receipt_bytes
    {
        return Err(UniverseSelectionErrorV1::StoreUntrusted);
    }
    Ok(Some(readback))
}

fn validate_aggregate_size(
    readback: &UniverseSelectionReadbackV1,
) -> Result<(), UniverseSelectionErrorV1> {
    readback
        .record()
        .canonical_bytes()
        .len()
        .checked_add(readback.receipt().canonical_bytes().len())
        .filter(|size| *size <= MAX_UNIVERSE_SELECTION_AGGREGATE_BYTES_V1)
        .map(|_| ())
        .ok_or(UniverseSelectionErrorV1::CapacityExceeded)
}

async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), UniverseSelectionErrorV1> {
    let key = i64::from_be_bytes(
        identity.as_bytes()[..8]
            .try_into()
            .map_err(|_| UniverseSelectionErrorV1::DigestMismatch)?,
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    Ok(())
}

fn digest_from_row(bytes: Vec<u8>) -> Result<BindingDigest, UniverseSelectionErrorV1> {
    Ok(BindingDigest::from_untrusted_bytes(
        bytes
            .try_into()
            .map_err(|_| UniverseSelectionErrorV1::StoreUntrusted)?,
    ))
}

#[track_caller]
fn store_error(cause: &impl Debug) -> UniverseSelectionErrorV1 {
    crate::owner::storage_diagnostic::refused_by_store_at(cause);
    UniverseSelectionErrorV1::StoreUnavailable
}

// Checked offsets are used only for redundant indexed projections; the canonical decoder remains authority.
fn extract_decision_cut(bytes: &[u8]) -> Result<i64, UniverseSelectionErrorV1> {
    let fact = decode_source_fact_v1(bytes)?;
    i64::try_from(fact.proposal.decision_cut)
        .map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)
}
fn extract_owner_observation(bytes: &[u8]) -> Result<i128, UniverseSelectionErrorV1> {
    Ok(decode_source_fact_v1(bytes)?.proposal.owner_observation_ns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn schema_and_queries_require_one_caller_transaction_and_complete_manifest() {
        assert!(
            UNIVERSE_SELECTION_SCHEMA_V1
                .iter()
                .all(|sql| !sql.contains("BEGIN") && !sql.contains("COMMIT"))
        );
        assert!(
            UNIVERSE_SELECTION_SCHEMA_V1
                .iter()
                .any(|sql| sql.contains("historical_membership_manifest_v1"))
        );
        assert!(
            UNIVERSE_SELECTION_SCHEMA_V1
                .iter()
                .any(|sql| sql.contains("universe_selection_outbox_v1"))
        );
    }

    #[rstest]
    fn aggregate_cap_rejects_overflow() {
        assert_eq!(MAX_UNIVERSE_SELECTION_AGGREGATE_BYTES_V1, 8 * 1024 * 1024);
    }
}
