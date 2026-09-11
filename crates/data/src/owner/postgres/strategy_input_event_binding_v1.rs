//! Durable request-to-EVENT binding and complete ordered census custody.
//!
//! This is a predecessor for the explicitly selected `ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1`
//! profile. It exposes no production resolver. A positive preparation can be created only from an
//! R&D readback already authenticated by the fixed Owner port and the move-only Market Data EVENT
//! corpus. PostgreSQL persists that closed set; it never scans rows to infer completeness.

#![allow(
    dead_code,
    reason = "the isolated EVENT resolver is intentionally deferred until its full acceptance composition exists"
)]

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    sample_projection::StrategyInputSampleProjectionKindV2,
    source_binding::BindingDigest,
    strategy_input_event_corpus_v1::{
        StrategyInputEventBindingErrorV1, StrategyInputEventBindingLocatorV1,
        StrategyInputEventBindingReadbackV1, StrategyInputEventCorpusV1,
    },
};

use super::MarketDataOwnerPostgres;

const MAX_RD_COORDINATE_BYTES: usize = 4_096;
const MAX_RD_CUSTODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_EVENT_COUNT: usize = 1_000_000;
const MAX_AGGREGATE_BYTES: usize = 64 * 1024 * 1024;
const CENSUS_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-binding-census.v1\0";
const BINDING_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-binding.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-binding-receipt.v1\0";
const READBACK_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-binding-readback.v1\0";
const CUSTODY_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-event-binding-postgres.v1\0";

const RESOLVE_BINDING_SOURCE_V1: &str = "SELECT b.request_identity,b.request_meaning_digest,b.request_locator_bytes,b.request_bytes,b.request_receipt_bytes,b.request_receipt_identity,b.request_seal_digest,b.replay_start_event_ns,b.replay_end_event_ns_exclusive,b.selected_event_ordinal,b.projection_receipt_digest,b.projection_receipt_bytes,b.selected_event_identity,b.selected_trigger_digest,b.source_digest,b.corpus_digest,b.census_digest,b.event_count,b.binding_identity,b.binding_bytes,b.receipt_identity,b.receipt_bytes,b.readback_identity,b.readback_bytes,b.custody_digest,o.outbox_identity,o.payload,o.custody_digest AS outbox_custody_digest FROM market_data_private.strategy_input_event_bindings_v1 b JOIN market_data_private.strategy_input_event_binding_outbox_v1 o USING(binding_identity) WHERE b.binding_identity=p_binding_identity";
const RESOLVE_CENSUS_SOURCE_V1: &str = "SELECT event_ordinal,logical_time,event_time,owner_sequence,event_identity,trigger_digest,projection_receipt_digest,projection_receipt_bytes,entry_bytes FROM market_data_private.strategy_input_event_binding_census_v1 WHERE binding_identity=p_binding_identity ORDER BY event_ordinal";
const BINDING_COLUMN_SIGNATURE_V1: &str = "request_identity:bytea:true,request_meaning_digest:bytea:true,request_locator_bytes:bytea:true,request_bytes:bytea:true,request_receipt_bytes:bytea:true,request_receipt_identity:bytea:true,request_seal_digest:bytea:true,replay_start_event_ns:numeric(39,0):true,replay_end_event_ns_exclusive:numeric(39,0):true,selected_event_ordinal:bigint:true,projection_receipt_digest:bytea:true,projection_receipt_bytes:bytea:true,selected_event_identity:bytea:true,selected_trigger_digest:bytea:true,source_digest:bytea:true,corpus_digest:bytea:true,census_digest:bytea:true,event_count:bigint:true,binding_identity:bytea:true,binding_bytes:bytea:true,receipt_identity:bytea:true,receipt_bytes:bytea:true,readback_identity:bytea:true,readback_bytes:bytea:true,custody_digest:bytea:true";
const CENSUS_COLUMN_SIGNATURE_V1: &str = "binding_identity:bytea:true,event_ordinal:bigint:true,logical_time:bigint:true,event_time:bigint:true,owner_sequence:bigint:true,event_identity:bytea:true,trigger_digest:bytea:true,projection_receipt_digest:bytea:true,projection_receipt_bytes:bytea:true,entry_bytes:bytea:true";
const OUTBOX_COLUMN_SIGNATURE_V1: &str = "binding_identity:bytea:true,outbox_identity:bytea:true,payload:bytea:true,custody_digest:bytea:true";

pub(super) const STRATEGY_INPUT_EVENT_BINDING_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_event_bindings_v1 (request_identity BYTEA PRIMARY KEY CHECK(octet_length(request_identity)>0 AND octet_length(request_identity)<=4096),request_meaning_digest BYTEA NOT NULL UNIQUE CHECK(octet_length(request_meaning_digest)>0 AND octet_length(request_meaning_digest)<=4096),request_locator_bytes BYTEA NOT NULL CHECK(octet_length(request_locator_bytes)>0 AND octet_length(request_locator_bytes)<=16384),request_bytes BYTEA NOT NULL CHECK(octet_length(request_bytes)>0 AND octet_length(request_bytes)<=4194304),request_receipt_bytes BYTEA NOT NULL CHECK(octet_length(request_receipt_bytes)>0 AND octet_length(request_receipt_bytes)<=4194304),request_receipt_identity BYTEA NOT NULL CHECK(octet_length(request_receipt_identity)>0 AND octet_length(request_receipt_identity)<=4096),request_seal_digest BYTEA NOT NULL CHECK(octet_length(request_seal_digest)>0 AND octet_length(request_seal_digest)<=4096),replay_start_event_ns NUMERIC(39,0) NOT NULL,replay_end_event_ns_exclusive NUMERIC(39,0) NOT NULL,selected_event_ordinal BIGINT NOT NULL CHECK(selected_event_ordinal>=0),projection_receipt_digest BYTEA NOT NULL CHECK(octet_length(projection_receipt_digest)=32),projection_receipt_bytes BYTEA NOT NULL CHECK(octet_length(projection_receipt_bytes)>0),selected_event_identity BYTEA NOT NULL CHECK(octet_length(selected_event_identity)=16),selected_trigger_digest BYTEA NOT NULL CHECK(octet_length(selected_trigger_digest)=32),source_digest BYTEA NOT NULL CHECK(octet_length(source_digest)=32),corpus_digest BYTEA NOT NULL CHECK(octet_length(corpus_digest)=32),census_digest BYTEA NOT NULL UNIQUE CHECK(octet_length(census_digest)=32),event_count BIGINT NOT NULL CHECK(event_count>=2 AND event_count<=1000000),binding_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(binding_identity)=32),binding_bytes BYTEA NOT NULL CHECK(octet_length(binding_bytes)>0),receipt_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(receipt_identity)=32),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0),readback_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(readback_identity)=32),readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32),CHECK(replay_start_event_ns<replay_end_event_ns_exclusive),CHECK(selected_event_ordinal<event_count))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_event_binding_census_v1 (binding_identity BYTEA NOT NULL REFERENCES market_data_private.strategy_input_event_bindings_v1(binding_identity) ON DELETE RESTRICT,event_ordinal BIGINT NOT NULL CHECK(event_ordinal>=0),logical_time BIGINT NOT NULL CHECK(logical_time>0),event_time BIGINT NOT NULL CHECK(event_time>=0),owner_sequence BIGINT NOT NULL CHECK(owner_sequence>0),event_identity BYTEA NOT NULL CHECK(octet_length(event_identity)=16),trigger_digest BYTEA NOT NULL CHECK(octet_length(trigger_digest)=32),projection_receipt_digest BYTEA NOT NULL CHECK(octet_length(projection_receipt_digest)=32),projection_receipt_bytes BYTEA NOT NULL CHECK(octet_length(projection_receipt_bytes)>0),entry_bytes BYTEA NOT NULL CHECK(octet_length(entry_bytes)>0),PRIMARY KEY(binding_identity,event_ordinal),UNIQUE(binding_identity,event_identity),UNIQUE(binding_identity,trigger_digest),UNIQUE(binding_identity,projection_receipt_digest))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_event_binding_outbox_v1 (binding_identity BYTEA PRIMARY KEY REFERENCES market_data_private.strategy_input_event_bindings_v1(binding_identity) ON DELETE RESTRICT,outbox_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(outbox_identity)=32),payload BYTEA NOT NULL CHECK(octet_length(payload)>0),custody_digest BYTEA NOT NULL CHECK(octet_length(custody_digest)=32))",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_event_binding_v1(p_binding_identity BYTEA) RETURNS TABLE(request_identity BYTEA,request_meaning_digest BYTEA,request_locator_bytes BYTEA,request_bytes BYTEA,request_receipt_bytes BYTEA,request_receipt_identity BYTEA,request_seal_digest BYTEA,replay_start_event_ns NUMERIC,replay_end_event_ns_exclusive NUMERIC,selected_event_ordinal BIGINT,projection_receipt_digest BYTEA,projection_receipt_bytes BYTEA,selected_event_identity BYTEA,selected_trigger_digest BYTEA,source_digest BYTEA,corpus_digest BYTEA,census_digest BYTEA,event_count BIGINT,binding_identity BYTEA,binding_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,readback_identity BYTEA,readback_bytes BYTEA,custody_digest BYTEA,outbox_identity BYTEA,outbox_payload BYTEA,outbox_custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT b.request_identity,b.request_meaning_digest,b.request_locator_bytes,b.request_bytes,b.request_receipt_bytes,b.request_receipt_identity,b.request_seal_digest,b.replay_start_event_ns,b.replay_end_event_ns_exclusive,b.selected_event_ordinal,b.projection_receipt_digest,b.projection_receipt_bytes,b.selected_event_identity,b.selected_trigger_digest,b.source_digest,b.corpus_digest,b.census_digest,b.event_count,b.binding_identity,b.binding_bytes,b.receipt_identity,b.receipt_bytes,b.readback_identity,b.readback_bytes,b.custody_digest,o.outbox_identity,o.payload,o.custody_digest AS outbox_custody_digest FROM market_data_private.strategy_input_event_bindings_v1 b JOIN market_data_private.strategy_input_event_binding_outbox_v1 o USING(binding_identity) WHERE b.binding_identity=p_binding_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_event_binding_census_v1(p_binding_identity BYTEA) RETURNS TABLE(event_ordinal BIGINT,logical_time BIGINT,event_time BIGINT,owner_sequence BIGINT,event_identity BYTEA,trigger_digest BYTEA,projection_receipt_digest BYTEA,projection_receipt_bytes BYTEA,entry_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT event_ordinal,logical_time,event_time,owner_sequence,event_identity,trigger_digest,projection_receipt_digest,projection_receipt_bytes,entry_bytes FROM market_data_private.strategy_input_event_binding_census_v1 WHERE binding_identity=p_binding_identity ORDER BY event_ordinal $function$",
    "REVOKE ALL ON TABLE market_data_private.strategy_input_event_bindings_v1,market_data_private.strategy_input_event_binding_census_v1,market_data_private.strategy_input_event_binding_outbox_v1 FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_event_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_event_binding_census_v1(BYTEA) FROM PUBLIC",
];

/// Exact R&D bytes after the fixed R&D Owner port has authenticated its sealed readback.
///
/// The constructor is deliberately confined to Market Data Owner composition. A downstream caller
/// cannot promote a locator label or caller-authored request into this evidence.
pub(in crate::owner) struct AuthenticatedRdReplayRequestV1 {
    request_identity: Box<str>,
    request_meaning_digest: Box<str>,
    request_receipt_identity: Box<str>,
    request_seal_digest: Box<str>,
    request_locator_bytes: Box<[u8]>,
    request_bytes: Box<[u8]>,
    request_receipt_bytes: Box<[u8]>,
}

impl AuthenticatedRdReplayRequestV1 {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::owner) fn from_fixed_owner_readback(
        request_identity: impl Into<Box<str>>,
        request_meaning_digest: impl Into<Box<str>>,
        request_receipt_identity: impl Into<Box<str>>,
        request_seal_digest: impl Into<Box<str>>,
        request_locator_bytes: impl Into<Box<[u8]>>,
        request_bytes: impl Into<Box<[u8]>>,
        request_receipt_bytes: impl Into<Box<[u8]>>,
    ) -> Result<Self, StrategyInputEventBindingErrorV1> {
        let value = Self {
            request_identity: request_identity.into(),
            request_meaning_digest: request_meaning_digest.into(),
            request_receipt_identity: request_receipt_identity.into(),
            request_seal_digest: request_seal_digest.into(),
            request_locator_bytes: request_locator_bytes.into(),
            request_bytes: request_bytes.into(),
            request_receipt_bytes: request_receipt_bytes.into(),
        };
        value.validate()?;
        Ok(value)
    }

    fn validate(&self) -> Result<(), StrategyInputEventBindingErrorV1> {
        let coordinates = [
            self.request_identity.as_bytes(),
            self.request_meaning_digest.as_bytes(),
            self.request_receipt_identity.as_bytes(),
            self.request_seal_digest.as_bytes(),
        ];
        let custody = [
            self.request_locator_bytes.as_ref(),
            self.request_bytes.as_ref(),
            self.request_receipt_bytes.as_ref(),
        ];
        if coordinates
            .iter()
            .any(|value| value.is_empty() || value.len() > MAX_RD_COORDINATE_BYTES)
            || custody
                .iter()
                .any(|value| value.is_empty() || value.len() > MAX_RD_CUSTODY_BYTES)
        {
            return Err(StrategyInputEventBindingErrorV1::InvalidRequest);
        }
        Ok(())
    }
}

struct PreparedEventV1 {
    logical_time: u64,
    event_time: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
    trigger_digest: BindingDigest,
    projection_receipt_digest: BindingDigest,
    projection_receipt_bytes: Box<[u8]>,
    canonical_bytes: Box<[u8]>,
}

/// Owner-private closed preparation. The complete event set is consumed from the move-only corpus.
pub(in crate::owner) struct StrategyInputEventBindingPreparationV1 {
    rd: AuthenticatedRdReplayRequestV1,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    selected_event_ordinal: usize,
    source_digest: BindingDigest,
    corpus_digest: BindingDigest,
    census_digest: BindingDigest,
    census_bytes: Box<[u8]>,
    events: Box<[PreparedEventV1]>,
    binding_identity: BindingDigest,
    binding_bytes: Box<[u8]>,
    receipt_identity: BindingDigest,
    receipt_bytes: Box<[u8]>,
    readback_identity: BindingDigest,
    readback_bytes: Box<[u8]>,
    custody_digest: BindingDigest,
}

impl StrategyInputEventBindingPreparationV1 {
    pub(in crate::owner) fn from_owner_corpus(
        rd: AuthenticatedRdReplayRequestV1,
        replay_start_event_ns: i128,
        replay_end_event_ns_exclusive: i128,
        selected_event_ordinal: usize,
        corpus: StrategyInputEventCorpusV1,
    ) -> Result<Self, StrategyInputEventBindingErrorV1> {
        rd.validate()?;
        if !corpus.has_valid_digest()
            || corpus.expected_count() < 2
            || corpus.expected_count() > MAX_EVENT_COUNT
            || selected_event_ordinal >= corpus.expected_count()
            || replay_start_event_ns >= replay_end_event_ns_exclusive
        {
            return Err(StrategyInputEventBindingErrorV1::InvalidEventCensus);
        }
        let mut events = Vec::with_capacity(corpus.expected_count());
        let mut previous = None;
        for member in corpus.members() {
            let order = member.order_key();
            let key = (
                order.logical_time(),
                order.event_time(),
                order.owner_sequence(),
                order.event_identity(),
            );
            if previous.is_some_and(|prior| prior >= key)
                || i128::from(order.event_time()) < replay_start_event_ns
                || i128::from(order.event_time()) >= replay_end_event_ns_exclusive
                || member.projection().kind() != StrategyInputSampleProjectionKindV2::JoinedCut
                || member.projection().subject_identity()
                    != *member.joined_cut().digest().as_bytes()
                || member.joined_cut().trigger_digest()
                    != member
                        .joined_cut()
                        .components()
                        .iter()
                        .find(|component| {
                            component.role_semantic_id() == member.joined_cut().trigger_input_id()
                        })
                        .map(|component| component.frame().trigger().digest())
                        .ok_or(StrategyInputEventBindingErrorV1::InvalidEventCensus)?
            {
                return Err(StrategyInputEventBindingErrorV1::InvalidEventCensus);
            }
            previous = Some(key);
            let mut entry = Vec::new();
            put_u64(&mut entry, order.logical_time());
            put_u64(&mut entry, order.event_time());
            put_u64(&mut entry, order.owner_sequence());
            entry.extend_from_slice(&order.event_identity());
            entry.extend_from_slice(member.joined_cut().trigger_digest().as_bytes());
            entry.extend_from_slice(&member.projection().receipt_digest());
            put_bytes(&mut entry, member.projection().canonical_bytes())?;
            events.push(PreparedEventV1 {
                logical_time: order.logical_time(),
                event_time: order.event_time(),
                owner_sequence: order.owner_sequence(),
                event_identity: order.event_identity(),
                trigger_digest: member.joined_cut().trigger_digest(),
                projection_receipt_digest: BindingDigest::from_untrusted_bytes(
                    member.projection().receipt_digest(),
                ),
                projection_receipt_bytes: member
                    .projection()
                    .canonical_bytes()
                    .to_vec()
                    .into_boxed_slice(),
                canonical_bytes: entry.into_boxed_slice(),
            });
        }
        Self::from_parts(
            rd,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
            selected_event_ordinal,
            corpus.source_digest(),
            corpus.digest(),
            events,
        )
    }

    fn from_parts(
        rd: AuthenticatedRdReplayRequestV1,
        replay_start_event_ns: i128,
        replay_end_event_ns_exclusive: i128,
        selected_event_ordinal: usize,
        source_digest: BindingDigest,
        corpus_digest: BindingDigest,
        events: Vec<PreparedEventV1>,
    ) -> Result<Self, StrategyInputEventBindingErrorV1> {
        validate_event_set(
            &events,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
            selected_event_ordinal,
        )?;
        let mut census = Vec::new();
        put_u16(&mut census, 1);
        put_u32(
            &mut census,
            u32::try_from(events.len())
                .map_err(|_| StrategyInputEventBindingErrorV1::InvalidEventCensus)?,
        );
        for event in &events {
            put_bytes(&mut census, &event.canonical_bytes)?;
        }
        let census_digest = digest(CENSUS_DOMAIN, &census);
        let selected = &events[selected_event_ordinal];
        let mut binding = Vec::new();
        put_u16(&mut binding, 1);
        for value in [
            rd.request_identity.as_bytes(),
            rd.request_meaning_digest.as_bytes(),
            rd.request_receipt_identity.as_bytes(),
            rd.request_seal_digest.as_bytes(),
            rd.request_locator_bytes.as_ref(),
            rd.request_bytes.as_ref(),
            rd.request_receipt_bytes.as_ref(),
        ] {
            put_bytes(&mut binding, value)?;
        }
        binding.extend_from_slice(&replay_start_event_ns.to_be_bytes());
        binding.extend_from_slice(&replay_end_event_ns_exclusive.to_be_bytes());
        put_u64(
            &mut binding,
            u64::try_from(selected_event_ordinal)
                .map_err(|_| StrategyInputEventBindingErrorV1::InvalidEventCensus)?,
        );
        binding.extend_from_slice(source_digest.as_bytes());
        binding.extend_from_slice(corpus_digest.as_bytes());
        binding.extend_from_slice(census_digest.as_bytes());
        binding.extend_from_slice(selected.projection_receipt_digest.as_bytes());
        binding.extend_from_slice(&selected.event_identity);
        binding.extend_from_slice(selected.trigger_digest.as_bytes());
        let binding_identity = digest(BINDING_DOMAIN, &binding);
        let mut receipt = Vec::new();
        put_u16(&mut receipt, 1);
        receipt.extend_from_slice(binding_identity.as_bytes());
        put_bytes(&mut receipt, rd.request_identity.as_bytes())?;
        put_bytes(&mut receipt, rd.request_meaning_digest.as_bytes())?;
        receipt.extend_from_slice(census_digest.as_bytes());
        let receipt_identity = digest(RECEIPT_DOMAIN, &receipt);
        let mut readback = Vec::new();
        put_u16(&mut readback, 1);
        readback.extend_from_slice(binding_identity.as_bytes());
        readback.extend_from_slice(receipt_identity.as_bytes());
        put_bytes(&mut readback, &binding)?;
        put_bytes(&mut readback, &receipt)?;
        put_bytes(&mut readback, &census)?;
        let readback_identity = digest(READBACK_DOMAIN, &readback);
        let custody_digest = custody_digest(
            binding_identity,
            receipt_identity,
            readback_identity,
            &binding,
            &receipt,
            &readback,
            &census,
        );
        let aggregate_size = binding
            .len()
            .checked_add(receipt.len())
            .and_then(|size| size.checked_add(readback.len()))
            .and_then(|size| size.checked_add(census.len()))
            .and_then(|size| {
                events.iter().try_fold(size, |total, event| {
                    total.checked_add(event.canonical_bytes.len())
                })
            })
            .ok_or(StrategyInputEventBindingErrorV1::InvalidEventCensus)?;
        if aggregate_size > MAX_AGGREGATE_BYTES {
            return Err(StrategyInputEventBindingErrorV1::InvalidEventCensus);
        }
        Ok(Self {
            rd,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
            selected_event_ordinal,
            source_digest,
            corpus_digest,
            census_digest,
            census_bytes: census.into_boxed_slice(),
            events: events.into_boxed_slice(),
            binding_identity,
            binding_bytes: binding.into_boxed_slice(),
            receipt_identity,
            receipt_bytes: receipt.into_boxed_slice(),
            readback_identity,
            readback_bytes: readback.into_boxed_slice(),
            custody_digest,
        })
    }

    pub(in crate::owner) fn locator(&self) -> StrategyInputEventBindingLocatorV1 {
        StrategyInputEventBindingLocatorV1::from_untrusted(
            self.rd.request_identity.clone(),
            self.rd.request_meaning_digest.clone(),
            self.binding_identity,
        )
    }
}

pub(super) async fn install(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), StrategyInputEventBindingErrorV1> {
    for statement in STRATEGY_INPUT_EVENT_BINDING_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    }
    verify_contract(transaction).await
}

impl MarketDataOwnerPostgres {
    pub(in crate::owner) async fn commit_strategy_input_event_binding_v1(
        &self,
        prepared: &StrategyInputEventBindingPreparationV1,
    ) -> Result<StrategyInputEventBindingReadbackV1, StrategyInputEventBindingErrorV1> {
        self.commit_strategy_input_event_binding_inner_v1(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_strategy_input_event_binding_with_fault_v1(
        &self,
        prepared: &StrategyInputEventBindingPreparationV1,
        rollback_before_commit: bool,
        response_loss: bool,
    ) -> Result<StrategyInputEventBindingReadbackV1, StrategyInputEventBindingErrorV1> {
        self.commit_strategy_input_event_binding_inner_v1(
            prepared,
            rollback_before_commit,
            response_loss,
        )
        .await
    }

    async fn commit_strategy_input_event_binding_inner_v1(
        &self,
        prepared: &StrategyInputEventBindingPreparationV1,
        rollback_before_commit: bool,
        response_loss: bool,
    ) -> Result<StrategyInputEventBindingReadbackV1, StrategyInputEventBindingErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        verify_contract(&mut transaction).await?;
        advisory_lock(&mut transaction, prepared.rd.request_identity.as_bytes()).await?;
        validate_projection_custody(&mut transaction, &prepared.events, true).await?;
        if let Some(existing) = load_by_request(
            &mut transaction,
            prepared.rd.request_identity.as_bytes(),
            true,
        )
        .await?
        {
            if !readback_matches_prepared(&existing, prepared) {
                return Err(StrategyInputEventBindingErrorV1::ReplayConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
            return Ok(existing);
        }
        if let Some(conflict) =
            load_by_binding(&mut transaction, prepared.binding_identity, true).await?
        {
            if !readback_matches_prepared(&conflict, prepared) {
                return Err(StrategyInputEventBindingErrorV1::ReplayConflict);
            }
        } else {
            persist(&mut transaction, prepared).await?;
        }
        let stored = load_by_binding(&mut transaction, prepared.binding_identity, true)
            .await?
            .ok_or(StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        if !readback_matches_prepared(&stored, prepared) {
            return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
        }
        if rollback_before_commit {
            return Err(StrategyInputEventBindingErrorV1::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        if response_loss {
            Err(StrategyInputEventBindingErrorV1::ResponseLost)
        } else {
            Ok(stored)
        }
    }

    pub(in crate::owner) async fn resolve_strategy_input_event_binding_v1(
        &self,
        locator: &StrategyInputEventBindingLocatorV1,
    ) -> Result<StrategyInputEventBindingReadbackV1, StrategyInputEventBindingErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        verify_contract(&mut transaction).await?;
        let stored = load_by_binding(&mut transaction, locator.binding_identity(), false)
            .await?
            .ok_or(StrategyInputEventBindingErrorV1::UnknownBinding)?;
        if stored.locator() != locator {
            return Err(StrategyInputEventBindingErrorV1::ReplayConflict);
        }
        transaction
            .commit()
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
        Ok(stored)
    }
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &StrategyInputEventBindingPreparationV1,
) -> Result<(), StrategyInputEventBindingErrorV1> {
    let selected = &prepared.events[prepared.selected_event_ordinal];
    sqlx::query("INSERT INTO market_data_private.strategy_input_event_bindings_v1(request_identity,request_meaning_digest,request_locator_bytes,request_bytes,request_receipt_bytes,request_receipt_identity,request_seal_digest,replay_start_event_ns,replay_end_event_ns_exclusive,selected_event_ordinal,projection_receipt_digest,projection_receipt_bytes,selected_event_identity,selected_trigger_digest,source_digest,corpus_digest,census_digest,event_count,binding_identity,binding_bytes,receipt_identity,receipt_bytes,readback_identity,readback_bytes,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::NUMERIC,$9::NUMERIC,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)")
        .bind(prepared.rd.request_identity.as_bytes())
        .bind(prepared.rd.request_meaning_digest.as_bytes())
        .bind(prepared.rd.request_locator_bytes.as_ref())
        .bind(prepared.rd.request_bytes.as_ref())
        .bind(prepared.rd.request_receipt_bytes.as_ref())
        .bind(prepared.rd.request_receipt_identity.as_bytes())
        .bind(prepared.rd.request_seal_digest.as_bytes())
        .bind(prepared.replay_start_event_ns.to_string())
        .bind(prepared.replay_end_event_ns_exclusive.to_string())
        .bind(to_i64(prepared.selected_event_ordinal)?)
        .bind(selected.projection_receipt_digest.as_bytes().as_slice())
        .bind(selected.projection_receipt_bytes.as_ref())
        .bind(selected.event_identity.as_slice())
        .bind(selected.trigger_digest.as_bytes().as_slice())
        .bind(prepared.source_digest.as_bytes().as_slice())
        .bind(prepared.corpus_digest.as_bytes().as_slice())
        .bind(prepared.census_digest.as_bytes().as_slice())
        .bind(to_i64(prepared.events.len())?)
        .bind(prepared.binding_identity.as_bytes().as_slice())
        .bind(prepared.binding_bytes.as_ref())
        .bind(prepared.receipt_identity.as_bytes().as_slice())
        .bind(prepared.receipt_bytes.as_ref())
        .bind(prepared.readback_identity.as_bytes().as_slice())
        .bind(prepared.readback_bytes.as_ref())
        .bind(prepared.custody_digest.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(map_insert)?;
    for (ordinal, event) in prepared.events.iter().enumerate() {
        sqlx::query("INSERT INTO market_data_private.strategy_input_event_binding_census_v1(binding_identity,event_ordinal,logical_time,event_time,owner_sequence,event_identity,trigger_digest,projection_receipt_digest,projection_receipt_bytes,entry_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(prepared.binding_identity.as_bytes().as_slice())
            .bind(to_i64(ordinal)?)
            .bind(to_i64(event.logical_time)?)
            .bind(to_i64(event.event_time)?)
            .bind(to_i64(event.owner_sequence)?)
            .bind(event.event_identity.as_slice())
            .bind(event.trigger_digest.as_bytes().as_slice())
            .bind(event.projection_receipt_digest.as_bytes().as_slice())
            .bind(event.projection_receipt_bytes.as_ref())
            .bind(event.canonical_bytes.as_ref())
            .execute(&mut **transaction)
            .await
            .map_err(map_insert)?;
    }
    sqlx::query("INSERT INTO market_data_private.strategy_input_event_binding_outbox_v1(binding_identity,outbox_identity,payload,custody_digest) VALUES($1,$2,$3,$4)")
        .bind(prepared.binding_identity.as_bytes().as_slice())
        .bind(prepared.readback_identity.as_bytes().as_slice())
        .bind(prepared.readback_bytes.as_ref())
        .bind(prepared.custody_digest.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(map_insert)?;
    Ok(())
}

async fn load_by_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &[u8],
    lock: bool,
) -> Result<Option<StrategyInputEventBindingReadbackV1>, StrategyInputEventBindingErrorV1> {
    let query = if lock {
        "SELECT b.*,b.replay_start_event_ns::TEXT AS replay_start_event_ns_text,b.replay_end_event_ns_exclusive::TEXT AS replay_end_event_ns_exclusive_text,o.outbox_identity,o.payload AS outbox_payload,o.custody_digest AS outbox_custody_digest FROM market_data_private.strategy_input_event_bindings_v1 b JOIN market_data_private.strategy_input_event_binding_outbox_v1 o USING(binding_identity) WHERE b.request_identity=$1 FOR UPDATE OF b,o"
    } else {
        "SELECT r.*,r.replay_start_event_ns::TEXT AS replay_start_event_ns_text,r.replay_end_event_ns_exclusive::TEXT AS replay_end_event_ns_exclusive_text FROM market_data_private.resolve_strategy_input_event_binding_v1((SELECT binding_identity FROM market_data_private.strategy_input_event_bindings_v1 WHERE request_identity=$1)) r"
    };
    let row = sqlx::query(query)
        .bind(request_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    match row {
        Some(row) => decode_stored(transaction, row, lock).await.map(Some),
        None => Ok(None),
    }
}

async fn load_by_binding(
    transaction: &mut Transaction<'_, Postgres>,
    binding_identity: BindingDigest,
    lock: bool,
) -> Result<Option<StrategyInputEventBindingReadbackV1>, StrategyInputEventBindingErrorV1> {
    let query = if lock {
        "SELECT b.*,b.replay_start_event_ns::TEXT AS replay_start_event_ns_text,b.replay_end_event_ns_exclusive::TEXT AS replay_end_event_ns_exclusive_text,o.outbox_identity,o.payload AS outbox_payload,o.custody_digest AS outbox_custody_digest FROM market_data_private.strategy_input_event_bindings_v1 b JOIN market_data_private.strategy_input_event_binding_outbox_v1 o USING(binding_identity) WHERE b.binding_identity=$1 FOR UPDATE OF b,o"
    } else {
        "SELECT r.*,r.replay_start_event_ns::TEXT AS replay_start_event_ns_text,r.replay_end_event_ns_exclusive::TEXT AS replay_end_event_ns_exclusive_text FROM market_data_private.resolve_strategy_input_event_binding_v1($1) r"
    };
    let row = sqlx::query(query)
        .bind(binding_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    match row {
        Some(row) => decode_stored(transaction, row, lock).await.map(Some),
        None => Ok(None),
    }
}

async fn decode_stored(
    transaction: &mut Transaction<'_, Postgres>,
    row: sqlx::postgres::PgRow,
    lock: bool,
) -> Result<StrategyInputEventBindingReadbackV1, StrategyInputEventBindingErrorV1> {
    let request_identity = row_bytes(&row, "request_identity")?;
    let request_meaning = row_bytes(&row, "request_meaning_digest")?;
    let request_locator_bytes = row_bytes(&row, "request_locator_bytes")?;
    let request_bytes = row_bytes(&row, "request_bytes")?;
    let request_receipt_bytes = row_bytes(&row, "request_receipt_bytes")?;
    let request_receipt_identity = row_bytes(&row, "request_receipt_identity")?;
    let request_seal_digest = row_bytes(&row, "request_seal_digest")?;
    let replay_start_event_ns = row
        .try_get::<String, _>("replay_start_event_ns_text")
        .map_err(store_error)?
        .parse::<i128>()
        .map_err(store_error)?;
    let replay_end_event_ns_exclusive = row
        .try_get::<String, _>("replay_end_event_ns_exclusive_text")
        .map_err(store_error)?
        .parse::<i128>()
        .map_err(store_error)?;
    let selected_event_ordinal =
        from_i64_usize(row.try_get("selected_event_ordinal").map_err(store_error)?)?;
    let binding_identity = row_digest(&row, "binding_identity")?;
    let receipt_identity = row_digest(&row, "receipt_identity")?;
    let readback_identity = row_digest(&row, "readback_identity")?;
    let projection = row_digest(&row, "projection_receipt_digest")?;
    let projection_bytes = row_bytes(&row, "projection_receipt_bytes")?;
    let event_identity: [u8; 16] = row_bytes(&row, "selected_event_identity")?
        .try_into()
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    let selected_trigger_digest = row_digest(&row, "selected_trigger_digest")?;
    let source_digest = row_digest(&row, "source_digest")?;
    let corpus_digest = row_digest(&row, "corpus_digest")?;
    let census_digest = row_digest(&row, "census_digest")?;
    let event_count = from_i64_usize(row.try_get("event_count").map_err(store_error)?)?;
    let binding_bytes = row_bytes(&row, "binding_bytes")?;
    let receipt_bytes = row_bytes(&row, "receipt_bytes")?;
    let readback_bytes = row_bytes(&row, "readback_bytes")?;
    let stored_custody = row_digest(&row, "custody_digest")?;
    let outbox_identity = row_digest(&row, "outbox_identity")?;
    let outbox_payload = row_bytes(&row, "outbox_payload")?;
    let outbox_custody = row_digest(&row, "outbox_custody_digest")?;
    let events = load_census(transaction, binding_identity, lock).await?;
    let census_bytes = encode_census(&events)?;
    let selected = events
        .get(selected_event_ordinal)
        .ok_or(StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    let mut expected_binding = Vec::new();
    put_u16(&mut expected_binding, 1);
    for value in [
        request_identity.as_slice(),
        request_meaning.as_slice(),
        request_receipt_identity.as_slice(),
        request_seal_digest.as_slice(),
        request_locator_bytes.as_slice(),
        request_bytes.as_slice(),
        request_receipt_bytes.as_slice(),
    ] {
        put_bytes(&mut expected_binding, value)?;
    }
    expected_binding.extend_from_slice(&replay_start_event_ns.to_be_bytes());
    expected_binding.extend_from_slice(&replay_end_event_ns_exclusive.to_be_bytes());
    put_u64(
        &mut expected_binding,
        u64::try_from(selected_event_ordinal)
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?,
    );
    expected_binding.extend_from_slice(source_digest.as_bytes());
    expected_binding.extend_from_slice(corpus_digest.as_bytes());
    expected_binding.extend_from_slice(census_digest.as_bytes());
    expected_binding.extend_from_slice(projection.as_bytes());
    expected_binding.extend_from_slice(&event_identity);
    expected_binding.extend_from_slice(selected_trigger_digest.as_bytes());
    let mut expected_receipt = Vec::new();
    put_u16(&mut expected_receipt, 1);
    expected_receipt.extend_from_slice(binding_identity.as_bytes());
    put_bytes(&mut expected_receipt, &request_identity)?;
    put_bytes(&mut expected_receipt, &request_meaning)?;
    expected_receipt.extend_from_slice(census_digest.as_bytes());
    let mut expected_readback = Vec::new();
    put_u16(&mut expected_readback, 1);
    expected_readback.extend_from_slice(binding_identity.as_bytes());
    expected_readback.extend_from_slice(receipt_identity.as_bytes());
    put_bytes(&mut expected_readback, &expected_binding)?;
    put_bytes(&mut expected_readback, &expected_receipt)?;
    put_bytes(&mut expected_readback, &census_bytes)?;
    if events.len() != event_count
        || replay_start_event_ns >= replay_end_event_ns_exclusive
        || selected.projection_receipt_digest != projection
        || selected.projection_receipt_bytes.as_ref() != projection_bytes
        || selected.event_identity != event_identity
        || selected.trigger_digest != selected_trigger_digest
        || digest(CENSUS_DOMAIN, &census_bytes) != census_digest
        || expected_binding != binding_bytes
        || expected_receipt != receipt_bytes
        || expected_readback != readback_bytes
        || digest(BINDING_DOMAIN, &binding_bytes) != binding_identity
        || digest(RECEIPT_DOMAIN, &receipt_bytes) != receipt_identity
        || digest(READBACK_DOMAIN, &readback_bytes) != readback_identity
        || outbox_identity != readback_identity
        || outbox_payload != readback_bytes
        || outbox_custody != stored_custody
        || custody_digest(
            binding_identity,
            receipt_identity,
            readback_identity,
            &binding_bytes,
            &receipt_bytes,
            &readback_bytes,
            &census_bytes,
        ) != stored_custody
    {
        return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
    }
    validate_projection_custody(transaction, &events, lock).await?;
    let request_identity = String::from_utf8(request_identity)
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    let request_meaning = String::from_utf8(request_meaning)
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    Ok(StrategyInputEventBindingReadbackV1 {
        locator: StrategyInputEventBindingLocatorV1::from_untrusted(
            request_identity,
            request_meaning,
            binding_identity,
        ),
        receipt_identity,
        readback_identity,
        projection_receipt_digest: projection,
        selected_event_identity: event_identity,
        census_digest,
        event_count,
        canonical_bytes: readback_bytes.into_boxed_slice(),
    })
}

async fn load_census(
    transaction: &mut Transaction<'_, Postgres>,
    binding_identity: BindingDigest,
    lock: bool,
) -> Result<Vec<PreparedEventV1>, StrategyInputEventBindingErrorV1> {
    let query = if lock {
        "SELECT event_ordinal,logical_time,event_time,owner_sequence,event_identity,trigger_digest,projection_receipt_digest,projection_receipt_bytes,entry_bytes FROM market_data_private.strategy_input_event_binding_census_v1 WHERE binding_identity=$1 ORDER BY event_ordinal FOR UPDATE"
    } else {
        "SELECT * FROM market_data_private.resolve_strategy_input_event_binding_census_v1($1)"
    };
    let rows = sqlx::query(query)
        .bind(binding_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    let mut events = Vec::with_capacity(rows.len());
    for (expected, row) in rows.into_iter().enumerate() {
        if from_i64_usize(row.try_get("event_ordinal").map_err(store_error)?)? != expected {
            return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
        }
        events.push(PreparedEventV1 {
            logical_time: from_i64_u64(row.try_get("logical_time").map_err(store_error)?)?,
            event_time: from_i64_u64(row.try_get("event_time").map_err(store_error)?)?,
            owner_sequence: from_i64_u64(row.try_get("owner_sequence").map_err(store_error)?)?,
            event_identity: row_bytes(&row, "event_identity")?
                .try_into()
                .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?,
            trigger_digest: row_digest(&row, "trigger_digest")?,
            projection_receipt_digest: row_digest(&row, "projection_receipt_digest")?,
            projection_receipt_bytes: row_bytes(&row, "projection_receipt_bytes")?
                .into_boxed_slice(),
            canonical_bytes: row_bytes(&row, "entry_bytes")?.into_boxed_slice(),
        });
    }
    validate_event_set(&events, i128::MIN, i128::MAX, 0)?;
    for event in &events {
        if encode_event(event)? != event.canonical_bytes.as_ref() {
            return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
        }
    }
    Ok(events)
}

async fn validate_projection_custody(
    transaction: &mut Transaction<'_, Postgres>,
    events: &[PreparedEventV1],
    lock: bool,
) -> Result<(), StrategyInputEventBindingErrorV1> {
    for event in events {
        if lock {
            let locked: Option<Vec<u8>> = sqlx::query_scalar(
                "SELECT receipt_digest FROM market_data_private.strategy_input_sample_projection_receipts_v2 WHERE receipt_digest=$1 FOR KEY SHARE",
            )
            .bind(event.projection_receipt_digest.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
            if locked.as_deref() != Some(event.projection_receipt_digest.as_bytes()) {
                return Err(StrategyInputEventBindingErrorV1::ProjectionUnavailable);
            }
        }
        let stored = super::load_strategy_input_sample_projection_v2(
            transaction,
            *event.projection_receipt_digest.as_bytes(),
        )
        .await
        .map_err(|_| StrategyInputEventBindingErrorV1::ProjectionUnavailable)?
        .ok_or(StrategyInputEventBindingErrorV1::ProjectionUnavailable)?;
        if stored.kind_tag() != StrategyInputSampleProjectionKindV2::JoinedCut as u8
            || stored.canonical_bytes() != event.projection_receipt_bytes.as_ref()
        {
            return Err(StrategyInputEventBindingErrorV1::ProjectionUnavailable);
        }
    }
    Ok(())
}

async fn verify_contract(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), StrategyInputEventBindingErrorV1> {
    let exact: bool = sqlx::query_scalar(
        "WITH relations AS (SELECT c.oid,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='market_data_private' AND c.relname IN ('strategy_input_event_bindings_v1','strategy_input_event_binding_census_v1','strategy_input_event_binding_outbox_v1')), procedures AS (SELECT p.oid,p.proname,p.prosrc,p.provolatile,p.prosecdef,p.proleakproof,p.proconfig,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='market_data_private' AND p.proname IN ('resolve_strategy_input_event_binding_v1','resolve_strategy_input_event_binding_census_v1')) SELECT (SELECT count(*)=3 AND bool_and(relkind='r' AND relpersistence='p' AND NOT relrowsecurity AND NOT relforcerowsecurity AND relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='market_data_owner')) FROM relations) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM relations) OR i.inhparent IN (SELECT oid FROM relations)) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM relations) AND NOT t.tgisinternal) AND NOT EXISTS(SELECT 1 FROM relations r, LATERAL pg_catalog.aclexplode(COALESCE((SELECT relacl FROM pg_catalog.pg_class WHERE oid=r.oid),pg_catalog.acldefault('r',r.relowner))) a WHERE a.grantee<>r.relowner) AND (SELECT count(*)=2 AND bool_and(provolatile='s' AND prosecdef AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog']::text[] AND proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='market_data_owner')) FROM procedures) AND NOT EXISTS(SELECT 1 FROM procedures p, LATERAL pg_catalog.aclexplode(COALESCE((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=p.oid),pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AND (SELECT count(*)=25 FROM information_schema.columns WHERE table_schema='market_data_private' AND table_name='strategy_input_event_bindings_v1') AND (SELECT count(*)=10 FROM information_schema.columns WHERE table_schema='market_data_private' AND table_name='strategy_input_event_binding_census_v1') AND (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='market_data_private' AND table_name='strategy_input_event_binding_outbox_v1')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?;
    if !exact {
        return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
    }
    for (table, expected) in [
        (
            "strategy_input_event_bindings_v1",
            BINDING_COLUMN_SIGNATURE_V1,
        ),
        (
            "strategy_input_event_binding_census_v1",
            CENSUS_COLUMN_SIGNATURE_V1,
        ),
        (
            "strategy_input_event_binding_outbox_v1",
            OUTBOX_COLUMN_SIGNATURE_V1,
        ),
    ] {
        let signature: Option<String> = sqlx::query_scalar(
            "SELECT string_agg(attribute.attname||':'||pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||attribute.attnotnull::TEXT,',' ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='market_data_private' AND relation.relname=$1 AND attribute.attnum>0 AND NOT attribute.attisdropped",
        )
        .bind(table)
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
        if signature.as_deref() != Some(expected) {
            return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
        }
    }
    let binding_source: String = sqlx::query_scalar("SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('market_data_private.resolve_strategy_input_event_binding_v1(bytea)')")
        .fetch_one(&mut **transaction).await.map_err(store_error)?;
    let census_source: String = sqlx::query_scalar("SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('market_data_private.resolve_strategy_input_event_binding_census_v1(bytea)')")
        .fetch_one(&mut **transaction).await.map_err(store_error)?;
    if binding_source.trim() != RESOLVE_BINDING_SOURCE_V1
        || census_source.trim() != RESOLVE_CENSUS_SOURCE_V1
    {
        return Err(StrategyInputEventBindingErrorV1::StoreUnavailable);
    }
    Ok(())
}

fn validate_event_set(
    events: &[PreparedEventV1],
    start: i128,
    end: i128,
    selected: usize,
) -> Result<(), StrategyInputEventBindingErrorV1> {
    if events.len() < 2
        || events.len() > MAX_EVENT_COUNT
        || selected >= events.len()
        || start >= end
    {
        return Err(StrategyInputEventBindingErrorV1::InvalidEventCensus);
    }
    let mut previous = None;
    for event in events {
        let key = (
            event.logical_time,
            event.event_time,
            event.owner_sequence,
            event.event_identity,
        );
        if previous.is_some_and(|prior| prior >= key)
            || event.logical_time == 0
            || event.owner_sequence == 0
            || event.event_identity == [0; 16]
            || event.trigger_digest.as_bytes() == &[0; 32]
            || event.projection_receipt_digest.as_bytes() == &[0; 32]
            || event.projection_receipt_bytes.is_empty()
            || i128::from(event.event_time) < start
            || i128::from(event.event_time) >= end
        {
            return Err(StrategyInputEventBindingErrorV1::InvalidEventCensus);
        }
        previous = Some(key);
    }
    Ok(())
}

fn readback_matches_prepared(
    stored: &StrategyInputEventBindingReadbackV1,
    prepared: &StrategyInputEventBindingPreparationV1,
) -> bool {
    stored.locator() == &prepared.locator()
        && stored.receipt_identity() == prepared.receipt_identity
        && stored.readback_identity() == prepared.readback_identity
        && stored.projection_receipt_digest()
            == prepared.events[prepared.selected_event_ordinal].projection_receipt_digest
        && stored.selected_event_identity()
            == prepared.events[prepared.selected_event_ordinal].event_identity
        && stored.census_digest() == prepared.census_digest
        && stored.event_count() == prepared.events.len()
        && stored.canonical_bytes() == prepared.readback_bytes.as_ref()
}

fn encode_event(event: &PreparedEventV1) -> Result<Vec<u8>, StrategyInputEventBindingErrorV1> {
    let mut bytes = Vec::new();
    put_u64(&mut bytes, event.logical_time);
    put_u64(&mut bytes, event.event_time);
    put_u64(&mut bytes, event.owner_sequence);
    bytes.extend_from_slice(&event.event_identity);
    bytes.extend_from_slice(event.trigger_digest.as_bytes());
    bytes.extend_from_slice(event.projection_receipt_digest.as_bytes());
    put_bytes(&mut bytes, &event.projection_receipt_bytes)?;
    Ok(bytes)
}

fn encode_census(events: &[PreparedEventV1]) -> Result<Vec<u8>, StrategyInputEventBindingErrorV1> {
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u32(
        &mut bytes,
        u32::try_from(events.len())
            .map_err(|_| StrategyInputEventBindingErrorV1::InvalidEventCensus)?,
    );
    for event in events {
        put_bytes(&mut bytes, &event.canonical_bytes)?;
    }
    Ok(bytes)
}

fn custody_digest(
    binding: BindingDigest,
    receipt: BindingDigest,
    readback: BindingDigest,
    binding_bytes: &[u8],
    receipt_bytes: &[u8],
    readback_bytes: &[u8],
    census_bytes: &[u8],
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(CUSTODY_DOMAIN);
    hasher.update(binding.as_bytes());
    hasher.update(receipt.as_bytes());
    hasher.update(readback.as_bytes());
    for value in [binding_bytes, receipt_bytes, readback_bytes, census_bytes] {
        hasher.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
        hasher.update(value);
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn put_bytes(target: &mut Vec<u8>, bytes: &[u8]) -> Result<(), StrategyInputEventBindingErrorV1> {
    put_u32(
        target,
        u32::try_from(bytes.len())
            .map_err(|_| StrategyInputEventBindingErrorV1::InvalidEventCensus)?,
    );
    target.extend_from_slice(bytes);
    Ok(())
}

fn put_u16(target: &mut Vec<u8>, value: u16) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn put_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(target: &mut Vec<u8>, value: u64) {
    target.extend_from_slice(&value.to_be_bytes());
}

fn row_bytes(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<Vec<u8>, StrategyInputEventBindingErrorV1> {
    row.try_get(column).map_err(store_error)
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<BindingDigest, StrategyInputEventBindingErrorV1> {
    Ok(BindingDigest::from_untrusted_bytes(
        row_bytes(row, column)?
            .try_into()
            .map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)?,
    ))
}

fn from_i64_usize(value: i64) -> Result<usize, StrategyInputEventBindingErrorV1> {
    usize::try_from(value).map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)
}

fn from_i64_u64(value: i64) -> Result<u64, StrategyInputEventBindingErrorV1> {
    u64::try_from(value).map_err(|_| StrategyInputEventBindingErrorV1::StoreUnavailable)
}

fn to_i64(value: impl TryInto<i64>) -> Result<i64, StrategyInputEventBindingErrorV1> {
    value
        .try_into()
        .map_err(|_| StrategyInputEventBindingErrorV1::InvalidEventCensus)
}

fn map_insert(error: sqlx::Error) -> StrategyInputEventBindingErrorV1 {
    if error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
        == Some("23505")
    {
        StrategyInputEventBindingErrorV1::ReplayConflict
    } else {
        StrategyInputEventBindingErrorV1::StoreUnavailable
    }
}

fn store_error(_: impl std::fmt::Debug) -> StrategyInputEventBindingErrorV1 {
    StrategyInputEventBindingErrorV1::StoreUnavailable
}

async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &[u8],
) -> Result<(), StrategyInputEventBindingErrorV1> {
    sqlx::query(
        "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encode($1,'hex'),0))",
    )
    .bind(request_identity)
    .execute(&mut **transaction)
    .await
    .map_err(store_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn event(ordinal: u8) -> PreparedEventV1 {
        let mut value = PreparedEventV1 {
            logical_time: 100 + u64::from(ordinal),
            event_time: 10 + u64::from(ordinal),
            owner_sequence: 1 + u64::from(ordinal),
            event_identity: [ordinal; 16],
            trigger_digest: d(ordinal.saturating_add(20)),
            projection_receipt_digest: d(ordinal.saturating_add(40)),
            projection_receipt_bytes: vec![ordinal, 1].into_boxed_slice(),
            canonical_bytes: Box::default(),
        };
        value.canonical_bytes = encode_event(&value).unwrap().into_boxed_slice();
        value
    }

    fn rd() -> AuthenticatedRdReplayRequestV1 {
        AuthenticatedRdReplayRequestV1::from_fixed_owner_readback(
            "rd-request-1",
            "rd-meaning-1",
            "rd-receipt-1",
            "rd-seal-1",
            b"locator".to_vec(),
            b"request".to_vec(),
            b"receipt".to_vec(),
        )
        .unwrap()
    }

    fn prepared() -> StrategyInputEventBindingPreparationV1 {
        StrategyInputEventBindingPreparationV1::from_parts(
            rd(),
            10,
            20,
            1,
            d(80),
            d(81),
            vec![event(1), event(2)],
        )
        .unwrap()
    }

    #[test]
    fn same_meaning_replay_has_byte_identical_locator_and_readback() {
        let first = prepared();
        let second = prepared();
        assert_eq!(first.locator(), second.locator());
        assert_eq!(first.binding_bytes, second.binding_bytes);
        assert_eq!(first.receipt_bytes, second.receipt_bytes);
        assert_eq!(first.readback_bytes, second.readback_bytes);
        assert_eq!(first.census_bytes, second.census_bytes);
    }

    #[test]
    fn same_identity_with_changed_meaning_conflicts_without_equivalence() {
        let first = prepared();
        let mut changed = prepared();
        changed.rd.request_meaning_digest = "changed".into();
        let changed = StrategyInputEventBindingPreparationV1::from_parts(
            changed.rd,
            10,
            20,
            1,
            d(80),
            d(81),
            vec![event(1), event(2)],
        )
        .unwrap();
        let stored = StrategyInputEventBindingReadbackV1 {
            locator: first.locator(),
            receipt_identity: first.receipt_identity,
            readback_identity: first.readback_identity,
            projection_receipt_digest: first.events[1].projection_receipt_digest,
            selected_event_identity: first.events[1].event_identity,
            census_digest: first.census_digest,
            event_count: first.events.len(),
            canonical_bytes: first.readback_bytes.clone(),
        };
        assert!(!readback_matches_prepared(&stored, &changed));
    }

    #[test]
    fn reordered_duplicate_or_out_of_window_census_fails_closed() {
        assert_eq!(
            validate_event_set(&[event(2), event(1)], 10, 20, 0),
            Err(StrategyInputEventBindingErrorV1::InvalidEventCensus)
        );
        assert_eq!(
            validate_event_set(&[event(1), event(1)], 10, 20, 0),
            Err(StrategyInputEventBindingErrorV1::InvalidEventCensus)
        );
        assert_eq!(
            validate_event_set(&[event(1), event(2)], 12, 20, 0),
            Err(StrategyInputEventBindingErrorV1::InvalidEventCensus)
        );
    }

    #[test]
    fn corruption_changes_every_aggregate_identity() {
        let original = prepared();
        let mut corrupt_events = vec![event(1), event(2)];
        corrupt_events[1].projection_receipt_bytes[0] ^= 0x80;
        corrupt_events[1].canonical_bytes = encode_event(&corrupt_events[1]).unwrap().into();
        let corrupt = StrategyInputEventBindingPreparationV1::from_parts(
            rd(),
            10,
            20,
            1,
            d(80),
            d(81),
            corrupt_events,
        )
        .unwrap();
        assert_ne!(original.census_digest, corrupt.census_digest);
        assert_ne!(original.binding_identity, corrupt.binding_identity);
        assert_ne!(original.receipt_identity, corrupt.receipt_identity);
        assert_ne!(original.readback_identity, corrupt.readback_identity);
    }

    #[test]
    fn schema_authenticates_ordered_census_and_private_exact_resolvers() {
        let schema = STRATEGY_INPUT_EVENT_BINDING_SCHEMA_V1.join("\n");
        assert!(schema.contains("PRIMARY KEY(binding_identity,event_ordinal)"));
        assert!(schema.contains("ORDER BY event_ordinal"));
        assert!(schema.contains("SECURITY DEFINER SET search_path=pg_catalog"));
        assert!(schema.contains("REVOKE ALL ON FUNCTION"));
        assert!(!schema.contains("GRANT"));
    }
}
