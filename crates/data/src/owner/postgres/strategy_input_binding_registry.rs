//! Caller-transaction PostgreSQL custody for write-once Strategy Input Binding declarations.
//!
//! The registry stores only the canonical untrusted request, its meaning digest, and the digest of
//! the binding freshly derived by Market Data. Recovery rereads the native PIT and Universe
//! dependencies and invokes the unchanged V1 binder; stored bytes cannot mint a binding receipt.

#![allow(
    dead_code,
    reason = "the Observation Census composition consumes this predecessor in a later bounded slice"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    instrument_master::InstrumentMasterError,
    market_semantics::{MarketSemanticsErrorV1, MarketSemanticsReadbackV1},
    pit_snapshot::{
        PitSnapshotError, VerifiedPitObservationBatch, authority::verify_observation_batch,
    },
    source_binding::{BindingDigest, SourceBindingOwnerReadback},
    strategy_design_role_set::StrategyDesignRoleSetReceiptV1,
    strategy_input_binding::{
        StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputEventFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, bind_strategy_input_event_frame, bind_strategy_input_role,
        codec, request_matches_authenticated_role_v1,
    },
    universe_selection::{UniverseSelectionReadbackV1, authority::decode_readback_v1},
};

use super::{
    load_durable_instrument_readback, load_pit_for_update, load_pit_observation_batch_for_update,
    load_source_for_update,
};

pub(super) const MAX_STRATEGY_INPUT_BINDING_REQUEST_BYTES_V1: usize = codec::MAX_REQUEST_BYTES;

pub(super) const STRATEGY_INPUT_BINDING_REGISTRY_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_binding_declarations_v1 (pit_request_identity BYTEA NOT NULL CHECK(octet_length(pit_request_identity)=32), strategy_design_identity BYTEA NOT NULL CHECK(octet_length(strategy_design_identity)=32), input_role_identity BYTEA NOT NULL CHECK(octet_length(input_role_identity)=32), request_bytes BYTEA NOT NULL CHECK(octet_length(request_bytes)>0 AND octet_length(request_bytes)<=65536), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), owner_binding_digest BYTEA NOT NULL CHECK(octet_length(owner_binding_digest)=32), PRIMARY KEY(pit_request_identity,strategy_design_identity,input_role_identity))",
    "REVOKE ALL ON TABLE market_data_private.strategy_input_binding_declarations_v1 FROM PUBLIC",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum StrategyInputBindingRegistryErrorV1 {
    InvalidRequest,
    CapacityExceeded,
    CodecMismatch,
    PitUnavailable,
    UniverseUnavailable,
    SourceUnavailable,
    InstrumentMasterUnavailable,
    MarketSemanticsUnavailable,
    BindingUnavailable(StrategyInputBindingUnavailable),
    UnknownDeclaration,
    RequestConflict,
    StoreUnavailable,
    StoreUntrusted,
    StrategyDesignRoleSetUnavailable,
}

/// Authenticates a complete legacy request set against the fixed R&D role-set readback before any
/// W3 positive composition. Existing V1 request and receipt bytes remain unchanged.
pub(super) fn validate_authenticated_role_set_coverage_v1(
    role_set: &StrategyDesignRoleSetReceiptV1,
    requests: &[UntrustedStrategyInputBindingRequest],
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    if !role_set.has_valid_integrity()
        || requests.len() != role_set.roles.len()
        || requests.is_empty()
        || requests.iter().any(|request| {
            request.research_request_identity != role_set.research_request_identity
                || request.strategy_design_identity != role_set.design_identity
                || role_set
                    .role(request.input_role_identity)
                    .is_none_or(|role| !request_matches_authenticated_role_v1(request, role))
        })
    {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    let mut identities = requests
        .iter()
        .map(|request| request.input_role_identity)
        .collect::<Vec<_>>();
    identities.sort_unstable();
    identities.dedup();
    if identities.len() != role_set.roles.len()
        || !identities
            .iter()
            .zip(&role_set.roles)
            .all(|(identity, role)| *identity == role.role_identity)
    {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    Ok(())
}

pub(super) struct StrategyInputBindingDeclarationReadbackV1 {
    request: UntrustedStrategyInputBindingRequest,
    request_meaning_digest: BindingDigest,
    binding: StrategyInputBindingReceipt,
}

impl StrategyInputBindingDeclarationReadbackV1 {
    pub(super) const fn request(&self) -> &UntrustedStrategyInputBindingRequest {
        &self.request
    }

    pub(super) const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }

    pub(super) const fn binding(&self) -> &StrategyInputBindingReceipt {
        &self.binding
    }
}

pub(super) async fn install_strategy_input_binding_registry_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    for statement in STRATEGY_INPUT_BINDING_REGISTRY_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) async fn register_strategy_input_binding_declaration_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    register_strategy_input_binding_declaration_unchecked_v1(transaction, request).await
}

/// Production positive registration requires the exact authenticated R&D role set and all role
/// declarations. Recovery continues to use the unchanged V1 stored request bytes below.
#[cfg(not(test))]
pub(super) async fn register_strategy_input_binding_declaration_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    complete_requests: &[UntrustedStrategyInputBindingRequest],
    role_set: &StrategyDesignRoleSetReceiptV1,
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    validate_authenticated_role_set_coverage_v1(role_set, complete_requests)?;
    if !complete_requests
        .iter()
        .any(|candidate| candidate == request)
    {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    register_strategy_input_binding_declaration_unchecked_v1(transaction, request).await
}

async fn register_strategy_input_binding_declaration_unchecked_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    let request_bytes = codec::encode_request_v1(request).map_err(map_codec_error)?;
    let request_meaning_digest =
        codec::meaning_digest_v1(&request_bytes).map_err(map_codec_error)?;
    lock_key(transaction, request).await?;

    // Dependencies and the binding are always re-established before either insertion or rejoin.
    let binding = resolve_and_bind(transaction, request).await?;
    let stored = load_stored(
        transaction,
        request.pit_request_identity,
        request.strategy_design_identity,
        request.input_role_identity,
    )
    .await?;
    if let Some(stored) = stored {
        let decoded = verify_stored(
            request.pit_request_identity,
            request.strategy_design_identity,
            request.input_role_identity,
            &stored.request_bytes,
            stored.request_meaning_digest,
            stored.owner_binding_digest,
        )?;
        if stored.request_bytes != request_bytes
            || stored.request_meaning_digest != request_meaning_digest
        {
            return Err(StrategyInputBindingRegistryErrorV1::RequestConflict);
        }
        if decoded != *request || stored.owner_binding_digest != binding.digest() {
            return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
        }
        return Ok(StrategyInputBindingDeclarationReadbackV1 {
            request: decoded,
            request_meaning_digest,
            binding,
        });
    }

    sqlx::query("INSERT INTO market_data_private.strategy_input_binding_declarations_v1(pit_request_identity,strategy_design_identity,input_role_identity,request_bytes,request_meaning_digest,owner_binding_digest) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(request.pit_request_identity.as_bytes().as_slice())
        .bind(request.strategy_design_identity.as_bytes().as_slice())
        .bind(request.input_role_identity.as_bytes().as_slice())
        .bind(&request_bytes)
        .bind(request_meaning_digest.as_bytes().as_slice())
        .bind(binding.digest().as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    Ok(StrategyInputBindingDeclarationReadbackV1 {
        request: request.clone(),
        request_meaning_digest,
        binding,
    })
}

pub(super) async fn recover_strategy_input_binding_declaration_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    lock_key_values(
        transaction,
        pit_request_identity,
        strategy_design_identity,
        input_role_identity,
    )
    .await?;
    let stored = load_stored(
        transaction,
        pit_request_identity,
        strategy_design_identity,
        input_role_identity,
    )
    .await?
    .ok_or(StrategyInputBindingRegistryErrorV1::UnknownDeclaration)?;
    let request = verify_stored(
        pit_request_identity,
        strategy_design_identity,
        input_role_identity,
        &stored.request_bytes,
        stored.request_meaning_digest,
        stored.owner_binding_digest,
    )?;
    let binding = resolve_and_bind(transaction, &request).await?;
    if binding.digest() != stored.owner_binding_digest {
        return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
    }
    Ok(StrategyInputBindingDeclarationReadbackV1 {
        request,
        request_meaning_digest: stored.request_meaning_digest,
        binding,
    })
}

async fn resolve_and_bind(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<StrategyInputBindingReceipt, StrategyInputBindingRegistryErrorV1> {
    let batch = resolve_native_pit(transaction, request).await?;
    let universe = resolve_native_universe(transaction, request.universe_selection_digest).await?;
    validate_universe_dependency(request, &batch, &universe)?;
    validate_native_source(transaction, request, &batch).await?;
    let semantics = resolve_native_market_semantics(transaction, request, &batch).await?;
    let [semantics_fact] = semantics.facts() else {
        return Err(StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable);
    };
    let instrument =
        validate_native_instrument_master(transaction, request, &batch, semantics_fact).await?;
    validate_native_market_semantics(request, &batch, instrument, semantics_fact)?;
    bind_strategy_input_role(request, &batch)
        .map_err(StrategyInputBindingRegistryErrorV1::BindingUnavailable)
}

pub(super) async fn resolve_complete_strategy_input_roles_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    role_identities: &[BindingDigest],
) -> Result<
    (
        Box<[StrategyInputBindingReceipt]>,
        Box<[StrategyInputEventFrameReceipt]>,
    ),
    StrategyInputBindingRegistryErrorV1,
> {
    let mut unique = role_identities.to_vec();
    unique.sort_unstable();
    unique.dedup();
    if unique.is_empty() || unique.len() != role_identities.len() {
        return Err(StrategyInputBindingRegistryErrorV1::InvalidRequest);
    }
    let mut declarations = Vec::with_capacity(unique.len());
    for role_identity in unique {
        declarations.push(
            recover_strategy_input_binding_declaration_v1(
                transaction,
                pit_request_identity,
                strategy_design_identity,
                role_identity,
            )
            .await?,
        );
    }
    let request = declarations
        .first()
        .ok_or(StrategyInputBindingRegistryErrorV1::InvalidRequest)?
        .request();
    let batch = resolve_native_pit(transaction, request).await?;
    let bindings = declarations
        .into_iter()
        .map(|declaration| declaration.binding)
        .collect::<Vec<_>>();
    let mut frames = Vec::with_capacity(bindings.len());
    for binding in &bindings {
        frames.push(
            bind_strategy_input_event_frame(std::slice::from_ref(binding), &batch)
                .map_err(StrategyInputBindingRegistryErrorV1::BindingUnavailable)?,
        );
    }
    Ok((bindings.into_boxed_slice(), frames.into_boxed_slice()))
}

async fn validate_native_source(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    let aggregate = load_source_for_update(transaction, batch.source_binding_identity(), false)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::SourceUnavailable)?
        .ok_or(StrategyInputBindingRegistryErrorV1::SourceUnavailable)?;
    let source = SourceBindingOwnerReadback::from_verified(&aggregate);
    if !source.is_admitted()
        || source.binding_id() != request.source_binding_identity
        || source.binding_id() != batch.source_binding_identity()
        || source.lineage_root() != batch.source_binding_lineage_root()
        || source.lineage_version() != batch.source_binding_lineage_version()
        || aggregate.commit().fact().source_frontier().digest != batch.source_frontier_digest()
        || aggregate.commit().fact().correction_frontier().digest
            != batch.correction_frontier_digest()
    {
        return Err(StrategyInputBindingRegistryErrorV1::SourceUnavailable);
    }
    Ok(())
}

/// Re-establishes the exact Source Binding readback already required by one durable declaration.
/// This is used only by fixed W3 composition inside the same Market Data transaction.
pub(super) async fn recover_strategy_input_binding_source_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<SourceBindingOwnerReadback, StrategyInputBindingRegistryErrorV1> {
    let batch = resolve_native_pit(transaction, request).await?;
    let aggregate = load_source_for_update(transaction, batch.source_binding_identity(), false)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::SourceUnavailable)?
        .ok_or(StrategyInputBindingRegistryErrorV1::SourceUnavailable)?;
    let source = SourceBindingOwnerReadback::from_verified(&aggregate);
    if !source.is_admitted()
        || source.binding_id() != request.source_binding_identity
        || source.binding_id() != batch.source_binding_identity()
        || source.fact_digest() != aggregate.commit().fact().digest()
        || source.lineage_root() != batch.source_binding_lineage_root()
        || source.lineage_version() != batch.source_binding_lineage_version()
        || aggregate.commit().fact().source_frontier().digest != batch.source_frontier_digest()
        || aggregate.commit().fact().correction_frontier().digest
            != batch.correction_frontier_digest()
    {
        return Err(StrategyInputBindingRegistryErrorV1::SourceUnavailable);
    }
    Ok(source)
}

async fn validate_native_instrument_master(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    semantics: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<NativeInstrumentMasterCoordinateV1, StrategyInputBindingRegistryErrorV1> {
    let UntrustedStrategyInputScope::ExactInstrument { instrument } = &request.scope else {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable);
    };
    if request.instrument_master_digest != batch.instrument_master_digest() {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable);
    }
    // The semantics fact carries the complete version coordinate. The unique cut locator selects
    // one durable readback without choosing a latest fact or scanning the instrument history.
    let request_rows: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT request_identity FROM market_data_private.instrument_master_receipts_v1 WHERE cut_identity=$1 ORDER BY request_identity",
    )
    .bind(semantics.instrument_master_cut_digest.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    let request_identity = exact_instrument_request_identity(&request_rows)?;
    let readback = load_durable_instrument_readback(transaction, request_identity, false)
        .await
        .map_err(map_instrument_error)?
        .ok_or(StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    let [fact] = readback.facts() else {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable);
    };
    let exact_member = readback.cut().expected_members() == std::slice::from_ref(instrument);
    let effective = i128::from(batch.time_evidence().event_effective.value);
    if readback.digest() != request.instrument_master_digest
        || !native_instrument_cut_matches(
            readback.cut().decision_cut,
            request.decision_cut,
            readback.cut().effective_instant(),
            effective,
            exact_member,
        )
        || fact.canonical_identity() != instrument
        || fact.market_semantics_identity() != request.market_semantics_identity
        || fact.source_frontier() != batch.source_frontier_digest()
        || fact.correction_frontier() != batch.correction_frontier_digest()
        || fact.effective_from() > effective
        || fact
            .effective_until()
            .is_some_and(|until| effective >= until)
    {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable);
    }
    Ok(NativeInstrumentMasterCoordinateV1 {
        readback: readback.digest(),
        fact: fact.digest(),
        cut: readback.cut().digest(),
    })
}

fn exact_instrument_request_identity(
    request_rows: &[Vec<u8>],
) -> Result<BindingDigest, StrategyInputBindingRegistryErrorV1> {
    let [request_identity] = request_rows else {
        return if request_rows.is_empty() {
            Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable)
        } else {
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        };
    };
    let identity: [u8; 32] = request_identity
        .as_slice()
        .try_into()
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    Ok(BindingDigest::from_untrusted_bytes(identity))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NativeInstrumentMasterCoordinateV1 {
    readback: BindingDigest,
    fact: BindingDigest,
    cut: BindingDigest,
}

const fn native_instrument_cut_matches(
    cut_decision: u64,
    expected_decision: u64,
    cut_effective: i128,
    expected_effective: i128,
    exact_member: bool,
) -> bool {
    cut_decision == expected_decision && cut_effective == expected_effective && exact_member
}

fn market_semantics_instrument_coordinate_matches(
    instrument: NativeInstrumentMasterCoordinateV1,
    request_readback: BindingDigest,
    semantics_readback: BindingDigest,
    semantics_fact: BindingDigest,
    semantics_cut: BindingDigest,
) -> bool {
    instrument.readback == request_readback
        && instrument.readback == semantics_readback
        && instrument.fact == semantics_fact
        && instrument.cut == semantics_cut
}

async fn resolve_native_market_semantics(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> Result<MarketSemanticsReadbackV1, StrategyInputBindingRegistryErrorV1> {
    super::market_semantics::resolve_market_semantics_scope_in_transaction_v1(
        transaction,
        request.market_semantics_identity,
        i128::from(batch.time_evidence().event_effective.value),
        i128::from(batch.time_evidence().observed_at),
        request.decision_cut,
    )
    .await
    .map_err(map_market_semantics_error)
}

fn validate_native_market_semantics(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    instrument: NativeInstrumentMasterCoordinateV1,
    fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    if fact.compatibility_scope_identity != request.market_semantics_identity
        || fact.pit_snapshot_identity != batch.snapshot_identity()
        || fact.pit_fact_digest != batch.fact_digest()
        || fact.source_binding_identity != batch.source_binding_identity()
        || fact.source_binding_lineage_root != batch.source_binding_lineage_root()
        || fact.source_binding_lineage_version != batch.source_binding_lineage_version()
        || !market_semantics_instrument_coordinate_matches(
            instrument,
            request.instrument_master_digest,
            fact.instrument_master_readback_digest,
            fact.instrument_master_fact_digest,
            fact.instrument_master_cut_digest,
        )
        || fact.source_frontier != batch.source_frontier_digest()
        || fact.correction_frontier != batch.correction_frontier_digest()
    {
        return Err(StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable);
    }
    Ok(())
}

async fn resolve_native_pit(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<VerifiedPitObservationBatch, StrategyInputBindingRegistryErrorV1> {
    let aggregate = load_pit_for_update(transaction, request.snapshot_identity, false)
        .await
        .map_err(map_pit_error)?
        .ok_or(StrategyInputBindingRegistryErrorV1::PitUnavailable)?;
    let stored = load_pit_observation_batch_for_update(transaction, &aggregate)
        .await
        .map_err(map_pit_error)?
        .ok_or(StrategyInputBindingRegistryErrorV1::PitUnavailable)?;
    verify_observation_batch(
        &aggregate,
        stored.source_binding_identity,
        stored.source_binding_lineage_root,
        stored.source_binding_lineage_version,
        stored.digest,
        &stored.bytes,
        &stored.rows,
    )
    .map_err(map_pit_error)
}

async fn resolve_native_universe(
    transaction: &mut Transaction<'_, Postgres>,
    selection_identity: BindingDigest,
) -> Result<UniverseSelectionReadbackV1, StrategyInputBindingRegistryErrorV1> {
    let row = sqlx::query("SELECT r.request_identity,r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 AS r JOIN market_data_private.universe_selection_receipts_v1 AS c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 AS o ON o.request_identity=r.request_identity WHERE r.selection_identity=$1 FOR SHARE OF r,c,o")
        .bind(selection_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?
        .ok_or(StrategyInputBindingRegistryErrorV1::UniverseUnavailable)?;
    let request_identity = row_digest(&row, "request_identity")?;
    let meaning = row_digest(&row, "request_meaning_digest")?;
    let native_selection = row_digest(&row, "selection_identity")?;
    let receipt_identity = row_digest(&row, "receipt_identity")?;
    let outbox_identity = row_digest(&row, "outbox_identity")?;
    let record_bytes = row_bytes(&row, "record_bytes")?;
    let receipt_bytes = row_bytes(&row, "receipt_bytes")?;
    let outbox_receipt_bytes = row_bytes(&row, "outbox_receipt_bytes")?;
    let readback = decode_readback_v1(record_bytes, receipt_bytes, outbox_identity)
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    if native_selection != selection_identity
        || readback.record().identity() != selection_identity
        || readback.record().request_identity() != request_identity
        || readback.record().request_meaning_digest() != meaning
        || readback.receipt().identity() != receipt_identity
        || outbox_receipt_bytes != receipt_bytes
    {
        return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

fn validate_universe_dependency(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    universe: &UniverseSelectionReadbackV1,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    if universe.record().identity() != request.universe_selection_digest
        || universe.record().source_binding_lineage_root() != batch.source_binding_lineage_root()
        || universe.record().correction_frontier_digest() != batch.correction_frontier_digest()
    {
        return Err(StrategyInputBindingRegistryErrorV1::UniverseUnavailable);
    }
    if let UntrustedStrategyInputScope::ExactInstrument { instrument } = &request.scope {
        let exact_members = universe
            .record()
            .membership()
            .iter()
            .filter(|member| member.included() && member.instrument() == instrument.as_bytes())
            .count();
        if exact_members != 1 {
            return Err(StrategyInputBindingRegistryErrorV1::UniverseUnavailable);
        }
    }
    Ok(())
}

struct StoredDeclarationV1 {
    request_bytes: Vec<u8>,
    request_meaning_digest: BindingDigest,
    owner_binding_digest: BindingDigest,
}

async fn load_stored(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
) -> Result<Option<StoredDeclarationV1>, StrategyInputBindingRegistryErrorV1> {
    let row = sqlx::query("SELECT request_bytes,request_meaning_digest,owner_binding_digest FROM market_data_private.strategy_input_binding_declarations_v1 WHERE pit_request_identity=$1 AND strategy_design_identity=$2 AND input_role_identity=$3 FOR UPDATE")
        .bind(pit_request_identity.as_bytes().as_slice())
        .bind(strategy_design_identity.as_bytes().as_slice())
        .bind(input_role_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    row.map(|row| {
        Ok(StoredDeclarationV1 {
            request_bytes: row
                .try_get("request_bytes")
                .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?,
            request_meaning_digest: row_digest(&row, "request_meaning_digest")?,
            owner_binding_digest: row_digest(&row, "owner_binding_digest")?,
        })
    })
    .transpose()
}

fn verify_stored(
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
    request_bytes: &[u8],
    request_meaning_digest: BindingDigest,
    owner_binding_digest: BindingDigest,
) -> Result<UntrustedStrategyInputBindingRequest, StrategyInputBindingRegistryErrorV1> {
    let request = codec::decode_request_v1(request_bytes)
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    let meaning = codec::meaning_digest_v1(request_bytes)
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    if request.pit_request_identity != pit_request_identity
        || request.strategy_design_identity != strategy_design_identity
        || request.input_role_identity != input_role_identity
        || meaning != request_meaning_digest
        || owner_binding_digest.as_bytes() == &[0; 32]
    {
        return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
    }
    Ok(request)
}

async fn lock_key(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    lock_key_values(
        transaction,
        request.pit_request_identity,
        request.strategy_design_identity,
        request.input_role_identity,
    )
    .await
}

async fn lock_key_values(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex')||encode($2::bytea,'hex')||encode($3::bytea,'hex'),0))")
        .bind(pit_request_identity.as_bytes().as_slice())
        .bind(strategy_design_identity.as_bytes().as_slice())
        .bind(input_role_identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    Ok(())
}

fn row_bytes<'a>(
    row: &'a sqlx::postgres::PgRow,
    column: &str,
) -> Result<&'a [u8], StrategyInputBindingRegistryErrorV1> {
    row.try_get(column)
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<BindingDigest, StrategyInputBindingRegistryErrorV1> {
    let bytes: [u8; 32] = row_bytes(row, column)?
        .try_into()
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn map_codec_error(error: codec::CodecError) -> StrategyInputBindingRegistryErrorV1 {
    match error {
        codec::CodecError::InvalidRequest => StrategyInputBindingRegistryErrorV1::InvalidRequest,
        codec::CodecError::CapacityExceeded => {
            StrategyInputBindingRegistryErrorV1::CapacityExceeded
        }
        codec::CodecError::CodecMismatch => StrategyInputBindingRegistryErrorV1::CodecMismatch,
    }
}

fn map_pit_error(_: PitSnapshotError) -> StrategyInputBindingRegistryErrorV1 {
    StrategyInputBindingRegistryErrorV1::PitUnavailable
}

fn map_instrument_error(_: InstrumentMasterError) -> StrategyInputBindingRegistryErrorV1 {
    StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable
}

fn map_market_semantics_error(_: MarketSemanticsErrorV1) -> StrategyInputBindingRegistryErrorV1 {
    StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::strategy_design_role_set::{
        StrategyDesignRoleEntryV1, StrategyDesignRoleSetLocatorV1, StrategyDesignRoleSetReceiptV1,
    };
    use crate::owner::strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn request() -> UntrustedStrategyInputBindingRequest {
        UntrustedStrategyInputBindingRequest {
            research_request_identity: d(1),
            strategy_design_identity: d(2),
            input_role_identity: d(3),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: "XNAS:AAPL".into(),
            },
            field_semantic: MarketDataFieldSemantic::BarClosePrice,
            channel: StrategyInputChannel::Market,
            timeframe: "PT1M".into(),
            unit: StrategyInputUnit::Price,
            scale: 4,
            pit_request_identity: d(4),
            pit_request_digest: d(5),
            snapshot_identity: d(6),
            snapshot_fact_digest: d(7),
            observation_batch_digest: d(8),
            source_binding_identity: d(9),
            source_frontier_digest: d(10),
            correction_frontier_digest: d(11),
            instrument_master_digest: d(12),
            universe_selection_digest: d(13),
            market_semantics_identity: d(14),
            decision_cut: 15,
        }
    }

    fn authenticated_role_set() -> StrategyDesignRoleSetReceiptV1 {
        let role = |identity| StrategyDesignRoleEntryV1 {
            role_identity: identity,
            semantic_id: format!("role-{identity:?}"),
            fact_class: "MARKET_DATA".into(),
            instrument: "XNAS:AAPL".into(),
            scope: r#"{"kind":"EXACT_INSTRUMENT"}"#.into(),
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
            channel: "MARKET".into(),
            timeframe: "PT1M".into(),
            unit: "PRICE".into(),
            scale: 4,
            value_type: "I128".into(),
        };
        StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
            StrategyDesignRoleSetLocatorV1 {
                schema_version: 2,
                request_identity: "composer-request".into(),
                operation_receipt_identity: d(20),
                artifact_locator: "artifact".into(),
                artifact_identity: d(21),
                canonical_plan_digest: d(22),
                design_digest: d(23),
            },
            d(1),
            d(24),
            d(2),
            d(23),
            d(25),
            vec![role(d(3)), role(d(16))],
            vec![],
        )
        .unwrap()
    }

    #[test]
    fn authenticated_registration_requires_exact_complete_role_coverage() {
        let first = request();
        let mut second = first.clone();
        second.input_role_identity = d(16);
        let role_set = authenticated_role_set();
        assert!(
            validate_authenticated_role_set_coverage_v1(
                &role_set,
                &[first.clone(), second.clone()]
            )
            .is_ok()
        );
        assert_eq!(
            validate_authenticated_role_set_coverage_v1(&role_set, &[first]),
            Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable)
        );
        second.scale = 5;
        assert_eq!(
            validate_authenticated_role_set_coverage_v1(&role_set, &[request(), second]),
            Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable)
        );
    }

    #[test]
    fn schema_is_private_bounded_and_omits_positive_or_caller_authority() {
        assert_eq!(MAX_STRATEGY_INPUT_BINDING_REQUEST_BYTES_V1, 64 * 1024);
        let schema = STRATEGY_INPUT_BINDING_REGISTRY_SCHEMA_V1.join("\n");
        assert!(schema.contains(
            "PRIMARY KEY(pit_request_identity,strategy_design_identity,input_role_identity)"
        ));
        assert!(schema.contains("octet_length(request_bytes)<=65536"));
        assert!(schema.contains("REVOKE ALL"));
        for forbidden in ["frame", "member", "receipt", "caller_binding"] {
            assert!(!schema.contains(forbidden));
        }
    }

    #[test]
    fn instrument_version_coordinate_keeps_readback_fact_and_cut_distinct() {
        let coordinate = NativeInstrumentMasterCoordinateV1 {
            readback: d(12),
            fact: d(16),
            cut: d(17),
        };
        assert_eq!(coordinate.readback, d(12));
        assert_eq!(coordinate.fact, d(16));
        assert_eq!(coordinate.cut, d(17));
        assert!(native_instrument_cut_matches(15, 15, 18, 18, true));
        assert!(!native_instrument_cut_matches(16, 15, 18, 18, true));
        assert!(!native_instrument_cut_matches(15, 15, 19, 18, true));
        assert!(!native_instrument_cut_matches(15, 15, 18, 18, false));
        assert!(market_semantics_instrument_coordinate_matches(
            coordinate,
            d(12),
            d(12),
            d(16),
            d(17)
        ));
        assert!(!market_semantics_instrument_coordinate_matches(
            coordinate,
            d(18),
            d(12),
            d(16),
            d(17)
        ));
        for spliced in [
            (d(18), d(16), d(17)),
            (d(12), d(18), d(17)),
            (d(12), d(16), d(18)),
        ] {
            assert!(!market_semantics_instrument_coordinate_matches(
                coordinate,
                d(12),
                spliced.0,
                spliced.1,
                spliced.2
            ));
        }
    }

    #[test]
    fn instrument_cut_locator_requires_exactly_one_well_formed_request_identity() {
        assert_eq!(
            exact_instrument_request_identity(&[vec![12; 32]]),
            Ok(d(12))
        );
        assert_eq!(
            exact_instrument_request_identity(&[]),
            Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterUnavailable)
        );
        assert_eq!(
            exact_instrument_request_identity(&[vec![12; 32], vec![12; 32]]),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
        assert_eq!(
            exact_instrument_request_identity(&[vec![12; 31]]),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
    }

    #[test]
    fn stored_recovery_byte_verifies_key_meaning_and_owner_digest() {
        let request = request();
        let bytes = codec::encode_request_v1(&request).unwrap();
        let meaning = codec::meaning_digest_v1(&bytes).unwrap();
        assert_eq!(
            verify_stored(d(4), d(2), d(3), &bytes, meaning, d(90)).unwrap(),
            request
        );
        assert_eq!(
            verify_stored(d(4), d(92), d(3), &bytes, meaning, d(90)),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
        assert_eq!(
            verify_stored(d(4), d(2), d(3), &bytes, d(91), d(90)),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
        assert_eq!(
            verify_stored(d(4), d(2), d(3), &bytes, meaning, d(0)),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
        let mut corrupted = bytes;
        corrupted.push(0);
        assert_eq!(
            verify_stored(d(4), d(2), d(3), &corrupted, meaning, d(90)),
            Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted)
        );
    }
}
