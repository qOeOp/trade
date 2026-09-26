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

use super::pit_role_resolution_v1::AuthenticatedDesignIdentityV1;
use crate::owner::{
    instrument_master::InstrumentMasterError,
    market_semantics::{MarketSemanticsErrorV1, MarketSemanticsReadbackV1},
    pit_snapshot::{
        PitSnapshotError, VerifiedPitObservationBatch, authority::verify_observation_batch,
    },
    source_binding::{BindingDigest, SourceBindingOwnerReadback},
    strategy_design_role_set::{StrategyDesignRoleEntryV1, StrategyDesignRoleSetReceiptV1},
    strategy_input_binding::{
        StrategyInputBindingReceipt, StrategyInputBindingUnavailable,
        StrategyInputCustodyDeclarationV1, StrategyInputCustodyReadbackV1,
        StrategyInputCustodyUnavailableV1, StrategyInputEventFrameReceipt,
        StrategyInputUniverseCustodyDeclarationV1, StrategyInputUniverseCustodyReadbackV1,
        StrategyInputUniverseFrameReceipt, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputCustodyClaimV1, UntrustedStrategyInputScope,
        bind_strategy_input_event_frame, bind_strategy_input_role,
        bind_strategy_input_universe_frame, canonical_strategy_input_custody_roles_v1, codec,
        request_matches_authenticated_role_v1, seal_strategy_input_custody_v1,
        seal_strategy_input_universe_custody_v1,
    },
    universe_selection::{UniverseSelectionReadbackV1, authority::decode_readback_v1},
};

use super::{
    load_durable_instrument_readback, load_durable_instrument_readback_for_rd_replay, load_pit,
    load_pit_for_rd_strategy_input, load_pit_for_update, load_pit_observation_batch,
    load_pit_observation_batch_for_rd_strategy_input, load_pit_observation_batch_for_update,
    load_source, load_source_for_rd_strategy_input, load_source_for_update,
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
    InstrumentMasterScopeUnavailable,
    InstrumentMasterBatchDigestUnavailable,
    InstrumentMasterCutLocatorUnavailable,
    InstrumentMasterReadbackUnavailable,
    InstrumentMasterFactCountUnavailable,
    InstrumentMasterDigestUnavailable,
    InstrumentMasterCutUnavailable,
    InstrumentMasterCanonicalIdentityUnavailable,
    InstrumentMasterSemanticsIdentityUnavailable,
    InstrumentMasterSourceFrontierUnavailable,
    InstrumentMasterCorrectionFrontierUnavailable,
    InstrumentMasterEffectiveRangeUnavailable,
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
    if !role_set.has_valid_integrity() {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    validate_authenticated_role_coverage_v1(
        AuthenticatedDesignIdentityV1::from_role_set(role_set),
        &role_set.roles,
        requests,
    )
}

/// Authenticates a complete request set against the roles an authenticated shape declares.
///
/// The shape is either a Composer attestation or the Design role intent R&D publishes before any
/// program exists. Both state the same thing about a Design's roles, and neither is trusted here
/// for anything else: the requests still carry only facts Market Data resolved itself, and this
/// decides whether they cover exactly the declared set.
pub(super) fn validate_authenticated_role_coverage_v1(
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
    requests: &[UntrustedStrategyInputBindingRequest],
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    if requests.len() != roles.len()
        || requests.is_empty()
        || requests.iter().any(|request| {
            request.research_request_identity != design.research_request_identity()
                || request.strategy_design_identity != design.design_identity()
                || roles
                    .iter()
                    .find(|role| role.role_identity == request.input_role_identity)
                    .is_none_or(|role| !request_matches_authenticated_role_v1(request, role))
        })
    {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    // A role set cannot name a universe, so the requests must agree on one among themselves: a
    // Design reads one kind of scope, and every universe role of it reads the same selection.
    let exact = requests.iter().filter(|request| {
        matches!(
            request.scope,
            UntrustedStrategyInputScope::ExactInstrument { .. }
        )
    });
    let universes = requests
        .iter()
        .filter_map(|request| match request.scope {
            UntrustedStrategyInputScope::UniverseSelection { selection_identity } => {
                Some((selection_identity, request.universe_selection_digest))
            }
            _ => None,
        })
        .collect::<std::collections::BTreeSet<_>>();

    if (exact.count() != 0 && !universes.is_empty()) || universes.len() > 1 {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    let mut identities = requests
        .iter()
        .map(|request| request.input_role_identity)
        .collect::<Vec<_>>();
    identities.sort_unstable();
    identities.dedup();

    if identities.len() != roles.len()
        || !identities
            .iter()
            .zip(roles)
            .all(|(identity, role)| *identity == role.role_identity)
    {
        return Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable);
    }
    Ok(())
}

pub(super) struct StrategyInputBindingDeclarationReadbackV1 {
    request: UntrustedStrategyInputBindingRequest,
    request_meaning_digest: BindingDigest,
    binding: DeclaredStrategyInputBindingV1,
}

/// What Market Data bound a declaration to, derived by the Owner from the request's PIT batch.
///
/// An exact-instrument role binds to its one row. A universe-member role binds to its value for
/// every member of the selection at the cut - the role's universe frame - because it has no single
/// row to bind. Either way the stored declaration keeps only the digest.
///
/// Both bindings are boxed: the enum is held in the frames of the registry's async functions,
/// which a debug build keeps whole while they await, and the ordered chain runs those frames on a
/// 2 MiB test stack.
pub(super) enum DeclaredStrategyInputBindingV1 {
    ExactInstrument(Box<StrategyInputBindingReceipt>),
    UniverseMembers(Box<StrategyInputUniverseFrameReceipt>),
}

impl DeclaredStrategyInputBindingV1 {
    pub(super) const fn digest(&self) -> BindingDigest {
        match self {
            Self::ExactInstrument(binding) => binding.digest(),
            Self::UniverseMembers(frame) => frame.digest(),
        }
    }

    /// The exact-instrument binding, or a refusal for a universe-member declaration, which has no
    /// single-row binding.
    fn into_exact(
        self,
    ) -> Result<StrategyInputBindingReceipt, StrategyInputBindingRegistryErrorV1> {
        match self {
            Self::ExactInstrument(binding) => Ok(*binding),
            Self::UniverseMembers(_) => {
                Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterScopeUnavailable)
            }
        }
    }
}

impl StrategyInputBindingDeclarationReadbackV1 {
    pub(super) const fn request(&self) -> &UntrustedStrategyInputBindingRequest {
        &self.request
    }

    pub(super) const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }

    /// The digest of what Market Data bound this declaration to, for either scope.
    pub(super) const fn binding_digest(&self) -> BindingDigest {
        self.binding.digest()
    }

    /// The exact-instrument binding, or nothing for a universe-member declaration: the paths that
    /// join single rows into an event frame have no row to take from a universe role.
    pub(super) const fn exact_binding(&self) -> Option<&StrategyInputBindingReceipt> {
        match &self.binding {
            DeclaredStrategyInputBindingV1::ExactInstrument(binding) => Some(&**binding),
            DeclaredStrategyInputBindingV1::UniverseMembers(_) => None,
        }
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

/// Production positive registration requires an authenticated R&D statement of the Design's roles
/// and all role declarations. Recovery continues to use the unchanged V1 stored request bytes below.
#[cfg(not(test))]
pub(super) async fn register_strategy_input_binding_declaration_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    complete_requests: &[UntrustedStrategyInputBindingRequest],
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    validate_authenticated_role_coverage_v1(design, roles, complete_requests)?;
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

async fn recover_strategy_input_binding_declaration_for_rd_v1(
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
    let rows =
        sqlx::query("SELECT * FROM market_data_rd_api.lock_strategy_input_declarations_v1($1,$2)")
            .bind(pit_request_identity.as_bytes().as_slice())
            .bind(strategy_design_identity.as_bytes().as_slice())
            .fetch_all(&mut **transaction)
            .await
            .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    let row = rows
        .iter()
        .find(|row| row_digest(row, "input_role_identity").ok() == Some(input_role_identity))
        .ok_or(StrategyInputBindingRegistryErrorV1::UnknownDeclaration)?;
    let request_bytes = row_bytes(row, "request_bytes")?;
    let meaning = row_digest(row, "request_meaning_digest")?;
    let stored_digest = row_digest(row, "owner_binding_digest")?;
    let request = verify_stored(
        pit_request_identity,
        strategy_design_identity,
        input_role_identity,
        request_bytes,
        meaning,
        stored_digest,
    )?;
    let binding =
        resolve_and_bind_with_mode(transaction, &request, DependencyReadModeV1::RdOwner).await?;

    if binding.digest() != stored_digest {
        return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
    }
    Ok(StrategyInputBindingDeclarationReadbackV1 {
        request,
        request_meaning_digest: meaning,
        binding,
    })
}

/// Resolves the one PIT request a Design's persisted Strategy Input declarations belong to.
///
/// The Composer cannot be told which PIT cut a Design binds against. Its public operation carries
/// only a canonical Research request locator, and neither the Design nor the reread Research
/// custody names a PIT request, so without this the only way to reach a binding was the
/// compile-time sealed universe. Market Data owns the answer because it owns the declarations.
///
/// Ambiguity is refused rather than resolved. A Design whose declarations span more than one PIT
/// request has no single admitted cut, and choosing one here would invent an Owner decision that
/// no stored fact supports.
///
/// # Errors
///
/// Returns [`StrategyInputCustodyUnavailableV1::UnknownDeclaration`] when the Design has no
/// declaration, [`StrategyInputCustodyUnavailableV1::PitRequestMismatch`] when its declarations
/// span more than one PIT request, and [`StrategyInputCustodyUnavailableV1::StoreUnavailable`]
/// when the custody store cannot be read inside the caller transaction.
pub async fn resolve_pit_request_for_strategy_design_v1(
    transaction: &mut Transaction<'_, Postgres>,
    strategy_design_identity: BindingDigest,
) -> Result<StrategyDesignPitCoordinateV1, StrategyInputCustodyUnavailableV1> {
    if strategy_design_identity == BindingDigest::from_untrusted_bytes([0; 32]) {
        return Err(StrategyInputCustodyUnavailableV1::InvalidClaim);
    }
    let principal: String = sqlx::query_scalar("SELECT session_user::text")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.pit_coordinate.session_user",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;
    // Market Data reads its own relation; R&D may only reach it through the locked facade.
    let query = if principal == "rd_owner" {
        "SELECT pit_request_identity,input_role_identity,request_bytes FROM market_data_rd_api.lock_pit_request_for_strategy_design_v1($1)"
    } else {
        "SELECT pit_request_identity,input_role_identity,request_bytes FROM market_data_private.strategy_input_binding_declarations_v1 WHERE strategy_design_identity=$1 ORDER BY pit_request_identity,input_role_identity FOR SHARE"
    };
    let rows = sqlx::query(query)
        .bind(strategy_design_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.pit_coordinate.declarations.fetch_all",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;

    let mut resolved: Option<StrategyDesignPitCoordinateV1> = None;
    let mut declared_scope = None;
    let mut input_role_identities = Vec::with_capacity(rows.len());
    for row in &rows {
        let bytes: Vec<u8> = row.try_get("pit_request_identity").map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.pit_coordinate.column.pit_request_identity",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| StrategyInputCustodyUnavailableV1::DeclarationUntrusted)?;
        let request_bytes: Vec<u8> = row.try_get("request_bytes").map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.pit_coordinate.column.request_bytes",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;
        // The cut lives inside the stored request, not in a column, so it is decoded with the
        // same codec the custody reread uses rather than read from a second source.
        let request = codec::decode_request_v1(&request_bytes)
            .map_err(|_| StrategyInputCustodyUnavailableV1::DeclarationUntrusted)?;
        let scope = StrategyInputDeclaredScopeV1::of_request(&request)
            .ok_or(StrategyInputCustodyUnavailableV1::DeclarationUntrusted)?;

        if *declared_scope.get_or_insert(scope) != scope {
            return Err(StrategyInputCustodyUnavailableV1::ScopeMismatch);
        }
        let role_bytes: Vec<u8> = row.try_get("input_role_identity").map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.pit_coordinate.column.input_role_identity",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;
        let role_bytes: [u8; 32] = role_bytes
            .try_into()
            .map_err(|_| StrategyInputCustodyUnavailableV1::DeclarationUntrusted)?;
        let role_identity = BindingDigest::from_untrusted_bytes(role_bytes);
        if input_role_identities.contains(&role_identity) {
            return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
        }
        input_role_identities.push(role_identity);

        let candidate = (
            BindingDigest::from_untrusted_bytes(bytes),
            request.decision_cut,
        );

        match resolved
            .as_ref()
            .map(|c| (c.pit_request_identity, c.decision_cut))
        {
            None => {
                resolved = Some(StrategyDesignPitCoordinateV1 {
                    pit_request_identity: candidate.0,
                    decision_cut: candidate.1,
                    declared_scope: scope,
                    input_role_identities: Vec::new(),
                });
            }
            Some(existing) if existing == candidate => {}
            Some(existing) if existing.0 != candidate.0 => {
                return Err(StrategyInputCustodyUnavailableV1::PitRequestMismatch);
            }
            Some(_) => return Err(StrategyInputCustodyUnavailableV1::LineageDrift),
        }
    }
    let mut coordinate = resolved.ok_or(StrategyInputCustodyUnavailableV1::UnknownDeclaration)?;
    coordinate.input_role_identities = input_role_identities;
    Ok(coordinate)
}

/// The one PIT coordinate a Design's declarations agree on.
///
/// Both fields come from the same declaration rows, so a Design cannot present a PIT request from
/// one cut and a decision cut from another.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyDesignPitCoordinateV1 {
    /// The PIT request every declaration for this Design repeats.
    pub pit_request_identity: BindingDigest,
    /// The decision cut every one of those declarations was written against.
    pub decision_cut: u64,
    /// The one scope every one of those declarations was registered under, which selects the
    /// custody re-read that serves the Design.
    pub declared_scope: StrategyInputDeclaredScopeV1,
    /// Every input role the Design has a declaration for, in stored order. A caller that knows the
    /// Design still states its own complete role set; this is the recovery path's only source.
    pub input_role_identities: Vec<BindingDigest>,
}

/// The scope a Design's stored declarations were registered under.
///
/// A Design reads one kind of scope - registration refuses a role set that mixes them - so the
/// scope is a property of the Design's declarations, not of one role, and it names which custody
/// re-read serves them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyInputDeclaredScopeV1 {
    /// Every role reads one exact instrument; served by
    /// [`reread_persisted_strategy_input_custody_for_update_v1`].
    ExactInstrument,
    /// Every role reads each member of one Owner universe selection; served by
    /// [`reread_persisted_strategy_input_universe_custody_for_update_v1`].
    UniverseMembers,
}

impl StrategyInputDeclaredScopeV1 {
    /// The scope a stored request declares, or nothing for a scope the registry never stores.
    const fn of_request(request: &UntrustedStrategyInputBindingRequest) -> Option<Self> {
        match request.scope {
            UntrustedStrategyInputScope::ExactInstrument { .. } => Some(Self::ExactInstrument),
            UntrustedStrategyInputScope::UniverseSelection { .. } => Some(Self::UniverseMembers),
            UntrustedStrategyInputScope::InstrumentSet { .. } => None,
        }
    }
}

/// Re-reads one complete persisted Composer input custody inside the caller's open transaction.
///
/// This is the durable replacement for a fixed in-memory acceptance corpus. Every claimed role is
/// re-read from its write-once declaration, re-bound against the live native PIT, Universe, Source,
/// Instrument Master, and Market Semantics dependencies, and joined into one event frame. Stored
/// bytes never mint a receipt: a declaration that no longer re-derives to its recorded Owner digest,
/// names another Research request, Design, or PIT request, or carries any decision cut other than
/// the one the caller requires is rejected, and the whole claim fails closed with it.
///
/// Declaration rows remain locked for the caller transaction (`FOR UPDATE` for Market Data,
/// `FOR SHARE` through the R&D facade), so concurrent mutation cannot move the custody.
///
/// # Errors
///
/// Returns only a redacted [`StrategyInputCustodyUnavailableV1`] category. No error carries store
/// evidence, a partial binding, or a partial frame.
pub async fn reread_persisted_strategy_input_custody_for_update_v1(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &UntrustedStrategyInputCustodyClaimV1,
) -> Result<StrategyInputCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let mode = locking_custody_read_mode_v1(transaction).await?;
    reread_persisted_custody_with_mode_v1(transaction, claim, mode, seal_exact_custody_v1).await
}

/// Re-reads one complete persisted universe-member input custody inside the caller's open
/// transaction.
///
/// It is the universe counterpart of [`reread_persisted_strategy_input_custody_for_update_v1`], with
/// the same claim, the same locks and the same rejection rules. Every claimed role is re-read from
/// its write-once declaration and re-bound to its own universe frame, which must still equal the
/// stored digest; the complete role set is then bound into one universe frame over the live batch,
/// which is what the readback seals. Only universe-member declarations are served, and an
/// exact-instrument declaration is refused by name, as the exact re-read refuses a universe one.
///
/// # Errors
///
/// Returns only a redacted [`StrategyInputCustodyUnavailableV1`] category, including
/// [`StrategyInputCustodyUnavailableV1::ScopeMismatch`] for a declaration of the other scope. No
/// error carries store evidence, a partial binding, or a partial frame.
pub async fn reread_persisted_strategy_input_universe_custody_for_update_v1(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &UntrustedStrategyInputCustodyClaimV1,
) -> Result<StrategyInputUniverseCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let mode = locking_custody_read_mode_v1(transaction).await?;
    reread_persisted_custody_with_mode_v1(transaction, claim, mode, seal_universe_custody_v1).await
}

/// The dependency read mode a locking custody re-read takes for the session's principal.
///
/// Market Data locks its own rows; R&D reaches them only through the locked facade, after the
/// transport it depends on has been verified.
async fn locking_custody_read_mode_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<DependencyReadModeV1, StrategyInputCustodyUnavailableV1> {
    let principal: String = sqlx::query_scalar("SELECT session_user::text")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.custody_readback.session_user",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;

    if principal == "rd_owner" {
        super::replay_market_facts_v2::verify_rd_replay_cut_transport_v1(transaction)
            .await
            .map_err(|e| {
                crate::owner::storage_diagnostic::refused_by_store(
                    "strategy_input_binding_registry.custody_readback.rd_replay_cut_transport",
                    &e,
                );
                StrategyInputCustodyUnavailableV1::StoreUnavailable
            })?;
        Ok(DependencyReadModeV1::RdOwner)
    } else {
        Ok(DependencyReadModeV1::LockRows)
    }
}

/// Non-locking form of the persisted Composer input custody re-read.
///
/// It applies the identical re-derivation and rejection rules but takes no row lock, so it suits a
/// read-only projection that must not block Market Data writers.
///
/// # Errors
///
/// Returns only a redacted [`StrategyInputCustodyUnavailableV1`] category.
pub async fn reread_persisted_strategy_input_custody_read_only_v1(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &UntrustedStrategyInputCustodyClaimV1,
) -> Result<StrategyInputCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    reread_persisted_custody_with_mode_v1(
        transaction,
        claim,
        DependencyReadModeV1::ReadOnly,
        seal_exact_custody_v1,
    )
    .await
}

/// Seals the exact-instrument custody of a re-read claim; any universe-member declaration is
/// refused by name.
fn seal_exact_custody_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    declarations: &[StrategyInputBindingDeclarationReadbackV1],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let bindings = declarations
        .iter()
        .map(|declaration| declaration.exact_binding().cloned())
        .collect::<Option<Vec<_>>>()
        .ok_or(StrategyInputCustodyUnavailableV1::ScopeMismatch)?;
    let frame = bind_strategy_input_event_frame(&bindings, batch)
        .map_err(|_| StrategyInputCustodyUnavailableV1::FrameUnavailable)?;
    let sealed = declarations
        .iter()
        .zip(&bindings)
        .map(|(declaration, binding)| StrategyInputCustodyDeclarationV1 {
            request: declaration.request(),
            request_meaning_digest: declaration.request_meaning_digest(),
            binding,
        })
        .collect::<Vec<_>>();
    seal_strategy_input_custody_v1(claim, &sealed, &frame)
}

/// Seals the universe-member custody of a re-read claim over the role set's universe frame; any
/// exact-instrument declaration is refused by name.
fn seal_universe_custody_v1(
    claim: &UntrustedStrategyInputCustodyClaimV1,
    declarations: &[StrategyInputBindingDeclarationReadbackV1],
    batch: &VerifiedPitObservationBatch,
) -> Result<StrategyInputUniverseCustodyReadbackV1, StrategyInputCustodyUnavailableV1> {
    let requests = declarations
        .iter()
        .map(|declaration| {
            declaration
                .exact_binding()
                .is_none()
                .then(|| declaration.request().clone())
        })
        .collect::<Option<Vec<_>>>()
        .ok_or(StrategyInputCustodyUnavailableV1::ScopeMismatch)?;
    let frame = bind_strategy_input_universe_frame(&requests, batch)
        .map_err(|_| StrategyInputCustodyUnavailableV1::FrameUnavailable)?;
    let sealed = declarations
        .iter()
        .map(|declaration| StrategyInputUniverseCustodyDeclarationV1 {
            request: declaration.request(),
            request_meaning_digest: declaration.request_meaning_digest(),
            binding_digest: declaration.binding_digest(),
        })
        .collect::<Vec<_>>();
    seal_strategy_input_universe_custody_v1(claim, &sealed, &frame)
}

/// Re-reads every declaration of one claim and seals them with `seal`.
///
/// Each claimed role is recovered from its write-once declaration and re-bound in `mode`, which
/// refuses a declaration whose re-derived digest differs from the stored one; the stored role set
/// must then equal the claimed one exactly, so a caller cannot turn a Design into a positive subset
/// by omitting roles. `seal` is synchronous and runs last, so this is the only async frame on the
/// re-read path: a debug build keeps an async frame whole while it awaits, and the ordered chain
/// runs this path on a 2 MiB test stack.
async fn reread_persisted_custody_with_mode_v1<T>(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &UntrustedStrategyInputCustodyClaimV1,
    mode: DependencyReadModeV1,
    seal: fn(
        &UntrustedStrategyInputCustodyClaimV1,
        &[StrategyInputBindingDeclarationReadbackV1],
        &VerifiedPitObservationBatch,
    ) -> Result<T, StrategyInputCustodyUnavailableV1>,
) -> Result<T, StrategyInputCustodyUnavailableV1> {
    let roles = canonical_strategy_input_custody_roles_v1(claim)?;
    let mut declarations = Vec::with_capacity(roles.len());
    for role_identity in &roles {
        let declaration = match mode {
            DependencyReadModeV1::LockRows => {
                recover_strategy_input_binding_declaration_v1(
                    transaction,
                    claim.pit_request_identity,
                    claim.strategy_design_identity,
                    *role_identity,
                )
                .await
            }
            DependencyReadModeV1::ReadOnly => {
                rederive_strategy_input_binding_declaration_read_only_v1(
                    transaction,
                    claim.pit_request_identity,
                    claim.strategy_design_identity,
                    *role_identity,
                )
                .await
            }
            DependencyReadModeV1::RdOwner => {
                recover_strategy_input_binding_declaration_for_rd_v1(
                    transaction,
                    claim.pit_request_identity,
                    claim.strategy_design_identity,
                    *role_identity,
                )
                .await
            }
        }
        .map_err(|e| map_custody_error(&e))?;
        declarations.push(declaration);
    }

    // A caller cannot turn a persisted Design role set into a positive subset by omitting
    // declarations from the claim. Production registration admits each row only against the
    // authenticated complete Design role set.
    let all_rows = match mode {
        DependencyReadModeV1::LockRows => sqlx::query("SELECT input_role_identity FROM market_data_private.strategy_input_binding_declarations_v1 WHERE pit_request_identity=$1 AND strategy_design_identity=$2 FOR UPDATE")
            .bind(claim.pit_request_identity.as_bytes().as_slice())
            .bind(claim.strategy_design_identity.as_bytes().as_slice())
            .fetch_all(&mut **transaction)
            .await,
        DependencyReadModeV1::ReadOnly => sqlx::query("SELECT input_role_identity FROM market_data_private.strategy_input_binding_declarations_v1 WHERE pit_request_identity=$1 AND strategy_design_identity=$2")
            .bind(claim.pit_request_identity.as_bytes().as_slice())
            .bind(claim.strategy_design_identity.as_bytes().as_slice())
            .fetch_all(&mut **transaction)
            .await,
        DependencyReadModeV1::RdOwner => sqlx::query("SELECT input_role_identity FROM market_data_rd_api.lock_strategy_input_declarations_v1($1,$2)")
            .bind(claim.pit_request_identity.as_bytes().as_slice())
            .bind(claim.strategy_design_identity.as_bytes().as_slice())
            .fetch_all(&mut **transaction)
            .await,
    }
    .map_err(|e| {
            crate::owner::storage_diagnostic::refused_by_store(
                "strategy_input_binding_registry.custody_readback.declarations.fetch_all",
                &e,
            );
            StrategyInputCustodyUnavailableV1::StoreUnavailable
        })?;
    let mut stored_roles = all_rows
        .iter()
        .map(|row| {
            row_digest(row, "input_role_identity")
                .map_err(|_| StrategyInputCustodyUnavailableV1::DeclarationUntrusted)
        })
        .collect::<Result<Vec<_>, _>>()?;
    stored_roles.sort_unstable_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    if stored_roles != roles {
        return Err(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch);
    }

    let first = declarations
        .first()
        .ok_or(StrategyInputCustodyUnavailableV1::RoleCoverageMismatch)?;
    let batch = resolve_native_pit(transaction, first.request(), mode)
        .await
        .map_err(|e| map_custody_error(&e))?;
    seal(claim, &declarations, &batch)
}

/// Projects an internal registry failure onto the redacted public custody category.
fn map_custody_error(
    error: &StrategyInputBindingRegistryErrorV1,
) -> StrategyInputCustodyUnavailableV1 {
    use StrategyInputBindingRegistryErrorV1 as Registry;
    match error {
        Registry::UnknownDeclaration => StrategyInputCustodyUnavailableV1::UnknownDeclaration,
        Registry::StoreUnavailable => StrategyInputCustodyUnavailableV1::StoreUnavailable,
        Registry::InvalidRequest
        | Registry::CapacityExceeded
        | Registry::CodecMismatch
        | Registry::RequestConflict
        | Registry::StoreUntrusted => StrategyInputCustodyUnavailableV1::DeclarationUntrusted,
        Registry::PitUnavailable
        | Registry::UniverseUnavailable
        | Registry::SourceUnavailable
        | Registry::InstrumentMasterScopeUnavailable
        | Registry::InstrumentMasterBatchDigestUnavailable
        | Registry::InstrumentMasterCutLocatorUnavailable
        | Registry::InstrumentMasterReadbackUnavailable
        | Registry::InstrumentMasterFactCountUnavailable
        | Registry::InstrumentMasterDigestUnavailable
        | Registry::InstrumentMasterCutUnavailable
        | Registry::InstrumentMasterCanonicalIdentityUnavailable
        | Registry::InstrumentMasterSemanticsIdentityUnavailable
        | Registry::InstrumentMasterSourceFrontierUnavailable
        | Registry::InstrumentMasterCorrectionFrontierUnavailable
        | Registry::InstrumentMasterEffectiveRangeUnavailable
        | Registry::MarketSemanticsUnavailable
        | Registry::BindingUnavailable(_)
        | Registry::StrategyDesignRoleSetUnavailable => {
            StrategyInputCustodyUnavailableV1::DependencyUnavailable
        }
    }
}

async fn resolve_and_bind(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<DeclaredStrategyInputBindingV1, StrategyInputBindingRegistryErrorV1> {
    resolve_and_bind_with_mode(transaction, request, DependencyReadModeV1::LockRows).await
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DependencyReadModeV1 {
    LockRows,
    ReadOnly,
    RdOwner,
}

async fn resolve_and_bind_with_mode(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    mode: DependencyReadModeV1,
) -> Result<DeclaredStrategyInputBindingV1, StrategyInputBindingRegistryErrorV1> {
    let batch = resolve_native_pit(transaction, request, mode).await?;
    let universe =
        resolve_native_universe(transaction, request.universe_selection_digest, mode).await?;
    validate_universe_dependency(request, &batch, &universe)?;
    validate_native_source(transaction, request, &batch, mode).await?;
    let semantics = resolve_native_market_semantics(transaction, request, &batch, mode).await?;

    let [semantics_fact] = semantics.facts() else {
        return Err(StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable);
    };
    // The fact is compared with the batch before anything is read through it: the exact arm
    // resolves its Instrument Master through the fact's digests, and a fact from another snapshot
    // would otherwise surface as an Instrument Master mismatch rather than as the fact it is.
    validate_native_market_semantics(request, &batch, semantics_fact)?;

    // Each arm binds through a synchronous helper, so this async function's frame, which a debug
    // build keeps whole across every await, holds none of the binders' temporaries.
    match &request.scope {
        UntrustedStrategyInputScope::ExactInstrument { .. } => {
            let instrument =
                validate_native_instrument_master(transaction, request, &batch, semantics_fact)
                    .await?;
            bind_exact_instrument_declaration_v1(request, &batch, semantics_fact, instrument)
        }
        UntrustedStrategyInputScope::UniverseSelection { .. } => {
            bind_universe_members_declaration_v1(request, &batch)
        }
        UntrustedStrategyInputScope::InstrumentSet { .. } => {
            Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterScopeUnavailable)
        }
    }
}

/// Binds an exact-instrument declaration once its Instrument Master coordinate is resolved.
fn bind_exact_instrument_declaration_v1(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    semantics_fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
    instrument: NativeInstrumentMasterCoordinateV1,
) -> Result<DeclaredStrategyInputBindingV1, StrategyInputBindingRegistryErrorV1> {
    if !market_semantics_instrument_coordinate_matches(
        instrument,
        request.instrument_master_digest,
        semantics_fact.instrument_master_readback_digest,
        semantics_fact.instrument_master_fact_digest,
        semantics_fact.instrument_master_cut_digest,
    ) {
        return Err(StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable);
    }
    bind_strategy_input_role(request, batch)
        .map(|binding| DeclaredStrategyInputBindingV1::ExactInstrument(Box::new(binding)))
        .map_err(StrategyInputBindingRegistryErrorV1::BindingUnavailable)
}

/// Binds a universe-member declaration to the role's universe frame over the batch.
fn bind_universe_members_declaration_v1(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
) -> Result<DeclaredStrategyInputBindingV1, StrategyInputBindingRegistryErrorV1> {
    // A universe role binds no Instrument Master at composition time: its members' facts
    // are the request-keyed V2 cut Market Data issues over the selection's own membership
    // when R&D first binds the sealed request for native execution. Only the batch-level
    // coordinate is checked here; the per-instrument check moves to that cut, and nothing
    // between the two may present an Instrument Master field as verified.
    if request.instrument_master_digest != batch.instrument_master_digest() {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterBatchDigestUnavailable);
    }
    bind_strategy_input_universe_frame(std::slice::from_ref(request), batch)
        .map(|frame| DeclaredStrategyInputBindingV1::UniverseMembers(Box::new(frame)))
        .map_err(StrategyInputBindingRegistryErrorV1::BindingUnavailable)
}

/// Re-derives an exact-instrument binding without locking; a universe-member request has no
/// single-row binding and is refused.
pub(super) async fn rederive_strategy_input_binding_read_only_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<StrategyInputBindingReceipt, StrategyInputBindingRegistryErrorV1> {
    resolve_and_bind_with_mode(transaction, request, DependencyReadModeV1::ReadOnly)
        .await?
        .into_exact()
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
    resolve_complete_strategy_input_roles_with_mode_v1(
        transaction,
        pit_request_identity,
        strategy_design_identity,
        role_identities,
        DependencyReadModeV1::LockRows,
    )
    .await
}

pub(super) async fn rederive_complete_strategy_input_roles_read_only_v1(
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
    resolve_complete_strategy_input_roles_with_mode_v1(
        transaction,
        pit_request_identity,
        strategy_design_identity,
        role_identities,
        DependencyReadModeV1::ReadOnly,
    )
    .await
}

async fn resolve_complete_strategy_input_roles_with_mode_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    role_identities: &[BindingDigest],
    mode: DependencyReadModeV1,
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
        declarations.push(match mode {
            DependencyReadModeV1::LockRows => {
                recover_strategy_input_binding_declaration_v1(
                    transaction,
                    pit_request_identity,
                    strategy_design_identity,
                    role_identity,
                )
                .await?
            }
            DependencyReadModeV1::ReadOnly => {
                rederive_strategy_input_binding_declaration_read_only_v1(
                    transaction,
                    pit_request_identity,
                    strategy_design_identity,
                    role_identity,
                )
                .await?
            }
            DependencyReadModeV1::RdOwner => {
                recover_strategy_input_binding_declaration_for_rd_v1(
                    transaction,
                    pit_request_identity,
                    strategy_design_identity,
                    role_identity,
                )
                .await?
            }
        });
    }
    let request = declarations
        .first()
        .ok_or(StrategyInputBindingRegistryErrorV1::InvalidRequest)?
        .request();
    let batch = resolve_native_pit(transaction, request, mode).await?;
    let bindings = declarations
        .into_iter()
        .map(|declaration| declaration.binding.into_exact())
        .collect::<Result<Vec<_>, _>>()?;
    let mut frames = Vec::with_capacity(bindings.len());
    for binding in &bindings {
        frames.push(
            bind_strategy_input_event_frame(std::slice::from_ref(binding), &batch)
                .map_err(StrategyInputBindingRegistryErrorV1::BindingUnavailable)?,
        );
    }
    Ok((bindings.into_boxed_slice(), frames.into_boxed_slice()))
}

pub(super) async fn rederive_strategy_input_binding_declaration_read_only_v1(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
) -> Result<StrategyInputBindingDeclarationReadbackV1, StrategyInputBindingRegistryErrorV1> {
    let stored = load_stored_read_only(
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
    let binding =
        resolve_and_bind_with_mode(transaction, &request, DependencyReadModeV1::ReadOnly).await?;

    if binding.digest() != stored.owner_binding_digest {
        return Err(StrategyInputBindingRegistryErrorV1::StoreUntrusted);
    }
    Ok(StrategyInputBindingDeclarationReadbackV1 {
        request,
        request_meaning_digest: stored.request_meaning_digest,
        binding,
    })
}

async fn validate_native_source(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    mode: DependencyReadModeV1,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    let aggregate = match mode {
        DependencyReadModeV1::LockRows => {
            load_source_for_update(transaction, batch.source_binding_identity(), false).await
        }
        DependencyReadModeV1::ReadOnly => {
            load_source(transaction, batch.source_binding_identity(), false).await
        }
        DependencyReadModeV1::RdOwner => {
            load_source_for_rd_strategy_input(transaction, batch.source_binding_identity()).await
        }
    }
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
    let batch = resolve_native_pit(transaction, request, DependencyReadModeV1::LockRows).await?;
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
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterScopeUnavailable);
    };

    if request.instrument_master_digest != batch.instrument_master_digest() {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterBatchDigestUnavailable);
    }
    // The semantics fact carries the complete version coordinate. The unique cut locator selects
    // one durable readback without choosing a latest fact or scanning the instrument history.
    let principal: String = sqlx::query_scalar("SELECT session_user::text")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
    let readback = if principal == "rd_owner" {
        load_durable_instrument_readback_for_rd_replay(
            transaction,
            semantics.instrument_master_cut_digest,
        )
        .await
    } else {
        let request_rows: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT request_identity FROM market_data_private.instrument_master_receipts_v1 WHERE cut_identity=$1 ORDER BY request_identity",
        )
        .bind(semantics.instrument_master_cut_digest.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| StrategyInputBindingRegistryErrorV1::StoreUnavailable)?;
        let request_identity = exact_instrument_request_identity(&request_rows)?;
        load_durable_instrument_readback(transaction, request_identity, false).await
    }
    .map_err(map_instrument_error)?
    .ok_or(StrategyInputBindingRegistryErrorV1::StoreUntrusted)?;
    let [fact] = readback.facts() else {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterFactCountUnavailable);
    };
    let exact_member = readback.cut().expected_members() == std::slice::from_ref(instrument);
    let effective = i128::from(batch.time_evidence().event_effective.value);

    if readback.digest() != request.instrument_master_digest {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterDigestUnavailable);
    }

    if !native_instrument_cut_matches(
        readback.cut().decision_cut,
        request.decision_cut,
        readback.cut().effective_instant(),
        effective,
        exact_member,
    ) {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterCutUnavailable);
    }

    if fact.canonical_identity() != instrument {
        return Err(
            StrategyInputBindingRegistryErrorV1::InstrumentMasterCanonicalIdentityUnavailable,
        );
    }

    if fact.market_semantics_identity() != request.market_semantics_identity {
        return Err(
            StrategyInputBindingRegistryErrorV1::InstrumentMasterSemanticsIdentityUnavailable,
        );
    }

    if fact.source_frontier() != batch.source_frontier_digest() {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterSourceFrontierUnavailable);
    }

    if fact.correction_frontier() != batch.correction_frontier_digest() {
        return Err(
            StrategyInputBindingRegistryErrorV1::InstrumentMasterCorrectionFrontierUnavailable,
        );
    }

    if fact.effective_from() > effective
        || fact
            .effective_until()
            .is_some_and(|until| effective >= until)
    {
        return Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterEffectiveRangeUnavailable);
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
            Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterCutLocatorUnavailable)
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
    mode: DependencyReadModeV1,
) -> Result<MarketSemanticsReadbackV1, StrategyInputBindingRegistryErrorV1> {
    match mode {
        DependencyReadModeV1::LockRows => {
            super::market_semantics::resolve_market_semantics_scope_in_transaction_v1(
                transaction,
                request.market_semantics_identity,
                batch.snapshot_identity(),
                i128::from(batch.time_evidence().event_effective.value),
                i128::from(batch.time_evidence().observed_at),
                request.decision_cut,
            )
            .await
        }
        DependencyReadModeV1::ReadOnly => {
            super::market_semantics::resolve_market_semantics_scope_read_only_in_transaction_v1(
                transaction,
                request.market_semantics_identity,
                batch.snapshot_identity(),
                i128::from(batch.time_evidence().event_effective.value),
                i128::from(batch.time_evidence().observed_at),
                request.decision_cut,
            )
            .await
        }
        DependencyReadModeV1::RdOwner => {
            super::market_semantics::resolve_market_semantics_scope_for_rd_strategy_input_v1(
                transaction,
                request.market_semantics_identity,
                batch.snapshot_identity(),
                i128::from(batch.time_evidence().event_effective.value),
                i128::from(batch.time_evidence().observed_at),
                request.decision_cut,
            )
            .await
        }
    }
    .map_err(map_market_semantics_error)
}

/// Checks every Market Semantics field that holds for either scope: compatibility, the exact PIT
/// cut, its Source Binding and both frontiers. The single-instrument Instrument Master coordinate
/// is checked by the exact-instrument branch alone.
fn validate_native_market_semantics(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    if fact.compatibility_scope_identity != request.market_semantics_identity
        || fact.pit_snapshot_identity != batch.snapshot_identity()
        || fact.pit_fact_digest != batch.fact_digest()
        || fact.source_binding_identity != batch.source_binding_identity()
        || fact.source_binding_lineage_root != batch.source_binding_lineage_root()
        || fact.source_binding_lineage_version != batch.source_binding_lineage_version()
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
    mode: DependencyReadModeV1,
) -> Result<VerifiedPitObservationBatch, StrategyInputBindingRegistryErrorV1> {
    load_verified_pit_batch(transaction, request.snapshot_identity, mode).await
}

/// Re-reads and re-verifies one snapshot's complete observation batch.
///
/// The batch is the only thing a role's declaration can be composed from, so this is also the
/// Owner-side entry a Design's role resolution uses once it knows which snapshot answers.
pub(super) async fn load_owner_verified_pit_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
) -> Result<VerifiedPitObservationBatch, StrategyInputBindingRegistryErrorV1> {
    load_verified_pit_batch(
        transaction,
        snapshot_identity,
        DependencyReadModeV1::LockRows,
    )
    .await
}

/// Re-reads and re-verifies one snapshot's complete observation batch without taking any lock.
///
/// For a Market Data writer R&D calls while holding its own locks on these rows, which a locking
/// read here would wait on.
pub(super) async fn read_owner_verified_pit_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
) -> Result<VerifiedPitObservationBatch, StrategyInputBindingRegistryErrorV1> {
    load_verified_pit_batch(
        transaction,
        snapshot_identity,
        DependencyReadModeV1::ReadOnly,
    )
    .await
}

async fn load_verified_pit_batch(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
    mode: DependencyReadModeV1,
) -> Result<VerifiedPitObservationBatch, StrategyInputBindingRegistryErrorV1> {
    let aggregate = match mode {
        DependencyReadModeV1::LockRows => {
            load_pit_for_update(transaction, snapshot_identity, false).await
        }
        DependencyReadModeV1::ReadOnly => {
            load_pit(transaction, snapshot_identity, false, false).await
        }
        DependencyReadModeV1::RdOwner => {
            load_pit_for_rd_strategy_input(transaction, snapshot_identity).await
        }
    }
    .map_err(map_pit_error)?
    .ok_or(StrategyInputBindingRegistryErrorV1::PitUnavailable)?;
    let stored = match mode {
        DependencyReadModeV1::LockRows => {
            load_pit_observation_batch_for_update(transaction, &aggregate).await
        }
        DependencyReadModeV1::ReadOnly => {
            load_pit_observation_batch(transaction, &aggregate, false).await
        }
        DependencyReadModeV1::RdOwner => {
            load_pit_observation_batch_for_rd_strategy_input(transaction, &aggregate).await
        }
    }
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
    mode: DependencyReadModeV1,
) -> Result<UniverseSelectionReadbackV1, StrategyInputBindingRegistryErrorV1> {
    let query = match mode {
        DependencyReadModeV1::LockRows => {
            "SELECT r.request_identity,r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 AS r JOIN market_data_private.universe_selection_receipts_v1 AS c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 AS o ON o.request_identity=r.request_identity WHERE r.selection_identity=$1 FOR SHARE OF r,c,o"
        }
        DependencyReadModeV1::ReadOnly => {
            "SELECT r.request_identity,r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 AS r JOIN market_data_private.universe_selection_receipts_v1 AS c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 AS o ON o.request_identity=r.request_identity WHERE r.selection_identity=$1"
        }
        DependencyReadModeV1::RdOwner => {
            "SELECT * FROM market_data_rd_api.lock_universe_for_strategy_input_v1($1)"
        }
    };
    let row = sqlx::query(query)
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

async fn load_stored_read_only(
    transaction: &mut Transaction<'_, Postgres>,
    pit_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    input_role_identity: BindingDigest,
) -> Result<Option<StoredDeclarationV1>, StrategyInputBindingRegistryErrorV1> {
    let row = sqlx::query("SELECT request_bytes,request_meaning_digest,owner_binding_digest FROM market_data_private.strategy_input_binding_declarations_v1 WHERE pit_request_identity=$1 AND strategy_design_identity=$2 AND input_role_identity=$3")
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
    StrategyInputBindingRegistryErrorV1::InstrumentMasterReadbackUnavailable
}

fn map_market_semantics_error(
    error: MarketSemanticsErrorV1,
) -> StrategyInputBindingRegistryErrorV1 {
    // The caller learns only that Market Semantics is unavailable, which is deliberate. Without
    // this the Owner could not say why either, and a refusal here is two reads deep inside a
    // registration: the scope the request names, at the batch's own instants and cut.
    crate::owner::storage_diagnostic::refused_by_store(
        "strategy_input_binding_registry.market_semantics.scope",
        &error,
    );
    StrategyInputBindingRegistryErrorV1::MarketSemanticsUnavailable
}

/// Registers every declaration of one authenticated role set inside the caller's transaction.
///
/// Coverage is validated once for the whole set rather than per request, which is what makes a
/// role set arrive whole: a set that is missing a role, carries an extra one, or contains a request
/// the authenticated shape does not declare stores nothing at all. Each request is then registered
/// through the unchanged V1 path, so every binding is still re-derived from live native
/// dependencies and a replay rejoins the stored bytes instead of overwriting them.
pub(super) async fn register_authenticated_role_declarations_v1(
    transaction: &mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
    requests: &[UntrustedStrategyInputBindingRequest],
) -> Result<(), StrategyInputBindingRegistryErrorV1> {
    validate_authenticated_role_coverage_v1(design, roles, requests)?;

    for request in requests {
        register_strategy_input_binding_declaration_unchecked_v1(transaction, request).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::strategy_design_role_set::{
        StrategyDesignRoleSetLocatorV1, StrategyDesignRoleSetReceiptV1,
    };
    use crate::owner::strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
    };
    use rstest::rstest;

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

    #[rstest]
    fn custody_failures_are_redacted_onto_the_documented_public_categories() {
        use StrategyInputBindingRegistryErrorV1 as Registry;
        use StrategyInputCustodyUnavailableV1 as Custody;

        let cases = [
            (Registry::UnknownDeclaration, Custody::UnknownDeclaration),
            (Registry::StoreUnavailable, Custody::StoreUnavailable),
            (Registry::InvalidRequest, Custody::DeclarationUntrusted),
            (Registry::CapacityExceeded, Custody::DeclarationUntrusted),
            (Registry::CodecMismatch, Custody::DeclarationUntrusted),
            (Registry::RequestConflict, Custody::DeclarationUntrusted),
            (Registry::StoreUntrusted, Custody::DeclarationUntrusted),
            (Registry::PitUnavailable, Custody::DependencyUnavailable),
            (
                Registry::UniverseUnavailable,
                Custody::DependencyUnavailable,
            ),
            (Registry::SourceUnavailable, Custody::DependencyUnavailable),
            (
                Registry::InstrumentMasterScopeUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterBatchDigestUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterCutLocatorUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterReadbackUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterFactCountUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterDigestUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterCutUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterCanonicalIdentityUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterSemanticsIdentityUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterSourceFrontierUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterCorrectionFrontierUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::InstrumentMasterEffectiveRangeUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::MarketSemanticsUnavailable,
                Custody::DependencyUnavailable,
            ),
            (
                Registry::BindingUnavailable(StrategyInputBindingUnavailable::StaleBatch),
                Custody::DependencyUnavailable,
            ),
            (
                Registry::StrategyDesignRoleSetUnavailable,
                Custody::DependencyUnavailable,
            ),
        ];

        for (registry, expected) in &cases {
            assert_eq!(map_custody_error(registry), *expected);
        }
        // Every internal category is projected, and 25 of them collapse into 4 public ones, so a
        // caller cannot read store evidence back out of the rejection it receives.
        assert_eq!(cases.len(), 25);
        let mut projected = cases
            .iter()
            .map(|(_, custody)| format!("{custody}"))
            .collect::<Vec<_>>();
        projected.sort_unstable();
        projected.dedup();
        assert_eq!(projected.len(), 4);
    }

    #[rstest]
    fn custody_claim_canonicalization_is_shared_with_the_owner_authority() {
        let claim = UntrustedStrategyInputCustodyClaimV1 {
            research_request_identity: d(1),
            strategy_design_identity: d(2),
            pit_request_identity: d(4),
            input_role_identities: vec![d(9), d(3), d(6)],
            decision_cut: 15,
        };
        assert_eq!(
            canonical_strategy_input_custody_roles_v1(&claim),
            Ok(vec![d(3), d(6), d(9)])
        );

        let mut duplicated = claim;
        duplicated.input_role_identities = vec![d(3), d(3)];
        assert_eq!(
            canonical_strategy_input_custody_roles_v1(&duplicated),
            Err(StrategyInputCustodyUnavailableV1::InvalidClaim)
        );
    }

    #[rstest]
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

    #[rstest]
    fn a_design_reads_one_scope_and_its_universe_roles_read_one_selection() {
        let design = AuthenticatedDesignIdentityV1::from_role_set(&authenticated_role_set());
        let universe_role = |identity| StrategyDesignRoleEntryV1 {
            role_identity: identity,
            semantic_id: format!("role-{identity:?}"),
            fact_class: "MARKET_DATA".into(),
            instrument: String::new(),
            scope: r#"{"kind":"UNIVERSE_MEMBERS"}"#.into(),
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
            channel: "MARKET".into(),
            timeframe: "PT1M".into(),
            unit: "PRICE".into(),
            scale: 4,
            value_type: "I128".into(),
        };
        let universe_request = |role, selection| {
            let mut request = request();
            request.input_role_identity = role;
            request.scope = UntrustedStrategyInputScope::UniverseSelection {
                selection_identity: selection,
            };
            request
        };
        let roles = [universe_role(d(3)), universe_role(d(16))];

        assert_eq!(
            validate_authenticated_role_coverage_v1(
                design,
                &roles,
                &[
                    universe_request(d(3), d(40)),
                    universe_request(d(16), d(40))
                ],
            ),
            Ok(())
        );
        // Two selections, by identity or by the digest the PIT request resolved it to.
        let mut other_digest = universe_request(d(16), d(40));
        other_digest.universe_selection_digest = d(41);

        for requests in [
            [
                universe_request(d(3), d(40)),
                universe_request(d(16), d(42)),
            ],
            [universe_request(d(3), d(40)), other_digest],
        ] {
            assert_eq!(
                validate_authenticated_role_coverage_v1(design, &roles, &requests),
                Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable)
            );
        }
        // An exact role and a universe role in one Design, each matching its own attested role.
        let mixed_roles = [
            authenticated_role_set().roles[0].clone(),
            universe_role(d(16)),
        ];
        assert_eq!(
            validate_authenticated_role_coverage_v1(
                design,
                &mixed_roles,
                &[request(), universe_request(d(16), d(40))],
            ),
            Err(StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable)
        );
    }

    #[rstest]
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

    #[rstest]
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

    #[rstest]
    fn instrument_cut_locator_requires_exactly_one_well_formed_request_identity() {
        assert_eq!(
            exact_instrument_request_identity(&[vec![12; 32]]),
            Ok(d(12))
        );
        assert_eq!(
            exact_instrument_request_identity(&[]),
            Err(StrategyInputBindingRegistryErrorV1::InstrumentMasterCutLocatorUnavailable)
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

    #[rstest]
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
    /// Every storage boundary in this file must say why it refused.
    ///
    /// The needle is assembled at run time. Written as one literal, this test's own source would
    /// contain the pattern it forbids and the assertion could never fail.
    ///
    /// Not every refusal has a cause to record: a doc reference names the variant, and the
    /// `Registry` mapping forwards an error the registry already closed. Only the `map_err(|_| ..)`
    /// form discards something it was holding, and that form must not survive here.
    #[rstest]
    fn every_storage_refusal_records_its_cause() {
        let source = include_str!("strategy_input_binding_registry.rs");
        let discarding = [
            "map_err(|_| StrategyInputCustodyUnavailableV1",
            "::StoreUnavailable)",
        ]
        .concat();
        assert!(
            !source.contains(&discarding),
            "a storage boundary discards its cause without recording it"
        );

        let recorded: Vec<&str> = source
            .match_indices(&["storage_diagnostic::", "refused_by_store("].concat())
            .map(|(at, needle)| {
                let rest = &source[at + needle.len()..];
                let open = rest.find('"').expect("a recorded coordinate is a literal");
                let close = rest[open + 1..]
                    .find('"')
                    .expect("a closed coordinate literal");
                &rest[open + 1..open + 1 + close]
            })
            .collect();
        assert!(recorded.len() >= 8);
        // A coordinate is only useful if it names one site, so no two may share one.
        let mut distinct = recorded.clone();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(distinct.len(), recorded.len());
        assert!(
            recorded
                .iter()
                .all(|coordinate| coordinate.starts_with("strategy_input_binding_registry."))
        );
    }
}
