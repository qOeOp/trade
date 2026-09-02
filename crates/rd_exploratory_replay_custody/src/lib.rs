//! Canonical R&D custody for sealed exploratory Replay V2 reads.
//!
//! A selector is only a query. Positive authority is a move-only token assembled
//! by this crate after resolving the fixed R&D Owner PostgreSQL API and checking
//! the complete V2 request, receipt, seal, and outbox binding.

use std::fmt::Display;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use thiserror::Error;
use vibe_backtest_owner_contracts::{ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2};
use vibe_product_edge::ProductEdgeAdmissionLocatorV1;

const RD_RESOLVE_FUNCTION_V2: &str =
    "rd_owner_api.resolve_exploratory_replay_request_v2(text,text)";
const INTERNAL_VERIFY_FUNCTION_V2: &str =
    "rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text)";
const FROZEN_EVENT_V2: &str = "EXPLORATORY_REPLAY_REQUEST_FROZEN_V2";
const FROZEN_EVENT_V1: &str = "EXPLORATORY_REPLAY_REQUEST_FROZEN_V1";

#[derive(Debug, Error)]
pub enum ExploratoryReplayCustodyError {
    #[error("R&D exploratory Replay V2 custody unavailable")]
    Unavailable,
    #[error("R&D exploratory Replay V2 custody storage unavailable: {0}")]
    Storage(String),
}

/// Caller-safe recovery selector. It grants no Replay authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryReplayRecoverySelectorV2 {
    pub request_identity: String,
    pub meaning_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExploratoryReplayAvailabilityV2 {
    Available,
    Stale,
    Unavailable,
}

/// Move-only positive R&D Owner fact. It has no public constructor and is not
/// deserializable, so a consumer cannot turn caller bytes into custody.
///
/// ```compile_fail
/// use vibe_rd_exploratory_replay_custody::SealedExploratoryReplayReadbackV2;
/// let _: SealedExploratoryReplayReadbackV2 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug)]
pub struct SealedExploratoryReplayReadbackV2 {
    request: ReplayRequestV2,
    canonical_request_bytes: Vec<u8>,
    meaning_digest: String,
    receipt_identity: String,
    seal_digest: String,
    committed_at_epoch_ms: u64,
    owner_cut_epoch_ms: u64,
}

impl SealedExploratoryReplayReadbackV2 {
    #[must_use]
    pub fn request(&self) -> &ReplayRequestV2 {
        &self.request
    }

    #[must_use]
    pub fn canonical_request_bytes(&self) -> &[u8] {
        &self.canonical_request_bytes
    }

    #[must_use]
    pub fn meaning_digest(&self) -> &str {
        &self.meaning_digest
    }

    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    #[must_use]
    pub fn seal_digest(&self) -> &str {
        &self.seal_digest
    }

    #[must_use]
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    #[must_use]
    pub const fn owner_cut_epoch_ms(&self) -> u64 {
        self.owner_cut_epoch_ms
    }
}

#[derive(Debug)]
pub struct ExploratoryReplayReadResultV2 {
    request_identity: String,
    availability: ExploratoryReplayAvailabilityV2,
    readback: Option<SealedExploratoryReplayReadbackV2>,
}

impl ExploratoryReplayReadResultV2 {
    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    #[must_use]
    pub const fn availability(&self) -> ExploratoryReplayAvailabilityV2 {
        self.availability
    }

    #[must_use]
    pub fn readback(&self) -> Option<&SealedExploratoryReplayReadbackV2> {
        self.readback.as_ref()
    }

    #[must_use]
    pub fn into_readback(self) -> Option<SealedExploratoryReplayReadbackV2> {
        self.readback
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedEnvelopeV2 {
    schema_version: u32,
    availability: ExploratoryReplayAvailabilityV2,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner_cut_epoch_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    frozen: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    outbox: Option<LockedOutboxV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    trial_family_outbox: Option<LockedOutboxV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    artifact_family_outbox: Option<LockedOutboxV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_canonical_request_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_meaning_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_seal_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_receipt: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v2_outbox: Option<LockedOutboxV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct IdentityDigestV1 {
    identity: String,
    digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct VersionedIdentityV1 {
    identity: String,
    version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyReplayProposalV1 {
    request_identity: String,
    admission: ProductEdgeAdmissionLocatorV1,
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    artifact_identity: String,
    build_receipt_identity: String,
    artifact_family_binding_identity: String,
    census_frontier_identity: String,
    requested_pit_scope: IdentityDigestV1,
    dataset: IdentityDigestV1,
    feature_set: IdentityDigestV1,
    strategy_spec: IdentityDigestV1,
    exact_code_bytes_digest: String,
    replay_config: IdentityDigestV1,
    runtime_kernel: VersionedIdentityV1,
    simulator: VersionedIdentityV1,
    backtest_engine: VersionedIdentityV1,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    deterministic_seed: u64,
    range_start_epoch_ms: u64,
    range_end_epoch_ms: u64,
    calendar_identity: String,
    time_zone_identity: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredFrozenCoreV2 {
    schema_version: u32,
    request_schema_version: u16,
    proposal: LegacyReplayProposalV1,
    product_edge_request_semantic_digest: String,
    research_receipt_identity: String,
    intent_semantic_digest: String,
    trial_family_root_digest: String,
    census_frontier_digest: String,
    artifact_family_binding_digest: String,
    artifact_family_binding_receipt_identity: String,
    artifact_review_identity: String,
    exact_code_bytes_sha256_digest: String,
    source_capsule_digest: String,
    build_recipe_digest: String,
    dependency_identity: String,
    trial_family_outbox_event_identity: String,
    trial_family_outbox_digest: String,
    trial_family_outbox_committed_at_epoch_ms: u64,
    artifact_family_outbox_event_identity: String,
    artifact_family_outbox_digest: String,
    artifact_family_outbox_committed_at_epoch_ms: u64,
    committed_at_epoch_ms: u64,
    request_digest: String,
}

#[derive(Serialize)]
struct FrozenMeaningV1<'a> {
    schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_schema_version: Option<u16>,
    proposal: &'a LegacyReplayProposalV1,
    product_edge_request_semantic_digest: &'a str,
    research_receipt_identity: &'a str,
    intent_semantic_digest: &'a str,
    trial_family_root_digest: &'a str,
    census_frontier_digest: &'a str,
    artifact_family_binding_digest: &'a str,
    artifact_family_binding_receipt_identity: &'a str,
    artifact_review_identity: &'a str,
    exact_code_bytes_sha256_digest: &'a str,
    source_capsule_digest: &'a str,
    build_recipe_digest: &'a str,
    dependency_identity: &'a str,
    trial_family_outbox_event_identity: &'a str,
    trial_family_outbox_digest: &'a str,
    trial_family_outbox_committed_at_epoch_ms: u64,
    artifact_family_outbox_event_identity: &'a str,
    artifact_family_outbox_digest: &'a str,
    artifact_family_outbox_committed_at_epoch_ms: u64,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    request_identity: String,
    request_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    schema_version: u32,
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    artifact_identity: String,
    census_frontier_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FamilyFrozenOutboxV1 {
    schema_version: u32,
    research_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    root_receipt_identity: String,
    membership_receipt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBoundOutboxV1 {
    schema_version: u32,
    artifact_identity: String,
    build_receipt_identity: String,
    trial_family_identity: String,
    binding_identity: String,
    binding_receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredReceiptV2 {
    schema_version: u16,
    receipt_identity: String,
    request_identity: String,
    meaning_digest: String,
    seal_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxV2 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: StoredOutboxPayloadV2,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxPayloadV2 {
    schema_version: u16,
    request_identity: String,
    meaning_digest: String,
    seal_digest: String,
    receipt_identity: String,
    lineage_request_digest: String,
    committed_at_epoch_ms: u64,
}

/// Resolve existing Replay V2 custody without creating or mutating any R&D fact.
pub async fn resolve_sealed_exploratory_replay_request_v2(
    rd_pool: &PgPool,
    selector: &ExploratoryReplayRecoverySelectorV2,
) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayCustodyError> {
    if selector.request_identity.trim().is_empty() || selector.meaning_digest.trim().is_empty() {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    validate_resolution_binding(rd_pool).await?;
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.resolve_exploratory_replay_request_v2($1,$2)")
            .bind(&selector.request_identity)
            .bind(&selector.meaning_digest)
            .fetch_one(rd_pool)
            .await
            .map_err(storage)?;
    decode_owner_envelope(selector, value)
}

async fn validate_resolution_binding(
    rd_pool: &PgPool,
) -> Result<(), ExploratoryReplayCustodyError> {
    let function_ok: bool = sqlx::query_scalar(
        "SELECT current_user='rd_owner'
             AND NOT procedure.prosecdef
             AND procedure.provolatile='v'
             AND procedure.proparallel='u'
             AND procedure.proisstrict
             AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND procedure.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
             AND procedure.proargtypes='25 25'::pg_catalog.oidvector
             AND owner.rolname='rd_custodian'
             AND language.lanname='plpgsql'
             AND pg_catalog.strpos(procedure.prosrc,'verify_exploratory_replay_request_internal_v2') > 0
             AND pg_catalog.has_function_privilege('rd_owner',procedure.oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee NOT IN (owner.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rd_owner'))
             )
             AND EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc helper
               JOIN pg_catalog.pg_roles helper_owner ON helper_owner.oid=helper.proowner
               WHERE helper.oid=pg_catalog.to_regprocedure($2)
                 AND helper_owner.rolname='rd_custodian'
                 AND NOT helper.prosecdef
                 AND helper.provolatile='v'
                 AND helper.proparallel='u'
                 AND helper.proisstrict
                 AND helper.proconfig=ARRAY['search_path=pg_catalog']::text[]
                 AND pg_catalog.has_function_privilege('rd_owner',helper.oid,'EXECUTE')
                 AND NOT pg_catalog.has_function_privilege('backtest_owner',helper.oid,'EXECUTE')
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_catalog.aclexplode(helper.proacl) helper_acl
                    WHERE helper_acl.privilege_type='EXECUTE'
                      AND helper_acl.grantee NOT IN (helper_owner.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rd_owner'))
                 )
             )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_roles owner ON owner.oid=procedure.proowner
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(RD_RESOLVE_FUNCTION_V2)
    .bind(INTERNAL_VERIFY_FUNCTION_V2)
    .fetch_optional(rd_pool)
    .await
    .map_err(storage)?
    .unwrap_or(false);

    if !function_ok {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn decode_owner_envelope(
    selector: &ExploratoryReplayRecoverySelectorV2,
    value: Option<serde_json::Value>,
) -> Result<ExploratoryReplayReadResultV2, ExploratoryReplayCustodyError> {
    let Some(value) = value else {
        return Ok(unavailable(selector));
    };
    let envelope: LockedEnvelopeV2 = exact(&value)?;
    if envelope.schema_version != 2
        || envelope.availability == ExploratoryReplayAvailabilityV2::Unavailable
    {
        return Ok(unavailable(selector));
    }
    let Ok(base) = validate_base_envelope(&envelope) else {
        return Ok(unavailable(selector));
    };

    let availability = envelope.availability;
    let owner_cut_epoch_ms = base.owner_cut_epoch_ms;
    let frozen = base.frozen;
    let (Some(encoded), Some(meaning_digest), Some(seal_digest), Some(receipt_value), Some(outbox)) = (
        envelope.v2_canonical_request_base64,
        envelope.v2_meaning_digest,
        envelope.v2_seal_digest,
        envelope.v2_receipt,
        envelope.v2_outbox,
    ) else {
        return Ok(unavailable(selector));
    };
    let receipt: StoredReceiptV2 = exact(&receipt_value)?;
    let Ok(canonical_request_bytes) = BASE64.decode(encoded) else {
        return Ok(unavailable(selector));
    };
    let Ok(dto) = serde_json::from_slice::<ReplayRequestDtoV2>(&canonical_request_bytes) else {
        return Ok(unavailable(selector));
    };
    let Ok(request) = ReplayRequestV2::try_from(dto) else {
        return Ok(unavailable(selector));
    };

    if request.namespace() != ReplayNamespaceV2::Exploratory
        || request.to_canonical_bytes().ok().as_deref() != Some(canonical_request_bytes.as_slice())
        || request
            .meaning_digest()
            .ok()
            .as_ref()
            .map(|digest| digest.as_str())
            != Some(meaning_digest.as_str())
        || !legacy_projection_matches(&frozen.proposal, request.as_dto())
    {
        return Ok(unavailable(selector));
    }
    let expected_seal = canonical_digest(
        "rd.exploratory-replay-request-seal.v2",
        &(
            2_u16,
            request.request_identity().as_str(),
            meaning_digest.as_str(),
            BASE64.encode(&canonical_request_bytes),
            frozen.request_digest.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let receipt_digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v2",
        &(
            2_u16,
            request.request_identity().as_str(),
            meaning_digest.as_str(),
            expected_seal.as_str(),
            frozen.committed_at_epoch_ms,
        ),
    )?;
    let expected_payload = StoredOutboxPayloadV2 {
        schema_version: 2,
        request_identity: request.request_identity().as_str().to_string(),
        meaning_digest: meaning_digest.clone(),
        seal_digest: expected_seal.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        lineage_request_digest: frozen.request_digest.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &expected_payload)?;

    if frozen.schema_version != 1
        || frozen.request_schema_version != 2
        || selector.request_identity != request.request_identity().as_str()
        || selector.meaning_digest != meaning_digest
        || receipt.schema_version != 2
        || receipt.request_identity != selector.request_identity
        || receipt.meaning_digest != meaning_digest
        || receipt.seal_digest != expected_seal
        || receipt.committed_at_epoch_ms != frozen.committed_at_epoch_ms
        || receipt.receipt_identity != identity("rd-exploratory-replay-receipt-v2", &receipt_digest)
        || seal_digest != expected_seal
        || outbox.payload_json != expected_payload
        || outbox.aggregate_identity != selector.request_identity
        || outbox.event_kind != FROZEN_EVENT_V2
        || outbox.payload_digest != payload_digest
        || outbox.event_identity != identity("rd-owner-event-v1", &payload_digest)
        || outbox.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Ok(unavailable(selector));
    }

    if availability == ExploratoryReplayAvailabilityV2::Stale {
        return Ok(ExploratoryReplayReadResultV2 {
            request_identity: selector.request_identity.clone(),
            availability,
            readback: None,
        });
    }
    Ok(ExploratoryReplayReadResultV2 {
        request_identity: selector.request_identity.clone(),
        availability: ExploratoryReplayAvailabilityV2::Available,
        readback: Some(SealedExploratoryReplayReadbackV2 {
            request,
            canonical_request_bytes,
            meaning_digest,
            receipt_identity: receipt.receipt_identity,
            seal_digest,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
            owner_cut_epoch_ms,
        }),
    })
}

struct ValidatedBaseEnvelopeV2 {
    frozen: StoredFrozenCoreV2,
    owner_cut_epoch_ms: u64,
}

fn validate_base_envelope(
    envelope: &LockedEnvelopeV2,
) -> Result<ValidatedBaseEnvelopeV2, ExploratoryReplayCustodyError> {
    let frozen: StoredFrozenCoreV2 = exact(
        envelope
            .frozen
            .as_ref()
            .ok_or(ExploratoryReplayCustodyError::Unavailable)?,
    )?;
    let receipt: StoredReceiptV1 = exact(
        envelope
            .receipt
            .as_ref()
            .ok_or(ExploratoryReplayCustodyError::Unavailable)?,
    )?;
    let outbox = envelope
        .outbox
        .as_ref()
        .ok_or(ExploratoryReplayCustodyError::Unavailable)?;
    verify_frozen(&frozen)?;
    verify_receipt_v1(&receipt, &frozen)?;
    verify_outbox_v1(outbox, &frozen, &receipt)?;
    verify_dependency_outbox::<FamilyFrozenOutboxV1>(
        envelope
            .trial_family_outbox
            .as_ref()
            .ok_or(ExploratoryReplayCustodyError::Unavailable)?,
        &frozen.proposal.trial_family_identity,
        "TRIAL_FAMILY_FROZEN_V1",
        &frozen.trial_family_outbox_event_identity,
        &frozen.trial_family_outbox_digest,
        frozen.trial_family_outbox_committed_at_epoch_ms,
    )?;
    verify_dependency_outbox::<ArtifactBoundOutboxV1>(
        envelope
            .artifact_family_outbox
            .as_ref()
            .ok_or(ExploratoryReplayCustodyError::Unavailable)?,
        &frozen.proposal.artifact_identity,
        "ARTIFACT_TRIAL_FAMILY_BOUND_V1",
        &frozen.artifact_family_outbox_event_identity,
        &frozen.artifact_family_outbox_digest,
        frozen.artifact_family_outbox_committed_at_epoch_ms,
    )?;
    let owner_cut_epoch_ms = envelope
        .owner_cut_epoch_ms
        .filter(|cut| *cut > 0)
        .ok_or(ExploratoryReplayCustodyError::Unavailable)?;
    Ok(ValidatedBaseEnvelopeV2 {
        frozen,
        owner_cut_epoch_ms,
    })
}

fn verify_frozen(frozen: &StoredFrozenCoreV2) -> Result<(), ExploratoryReplayCustodyError> {
    validate_legacy_proposal(&frozen.proposal)?;
    let digest = frozen_digest(frozen)?;

    if frozen.schema_version != 1
        || frozen.request_schema_version != 2
        || !valid_sha256(&frozen.exact_code_bytes_sha256_digest)
        || !valid_sha256(&frozen.product_edge_request_semantic_digest)
        || frozen.request_digest != digest
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn frozen_digest(frozen: &StoredFrozenCoreV2) -> Result<String, ExploratoryReplayCustodyError> {
    canonical_digest(
        "rd.exploratory-replay-request.v1",
        &FrozenMeaningV1 {
            schema_version: frozen.schema_version,
            request_schema_version: Some(frozen.request_schema_version),
            proposal: &frozen.proposal,
            product_edge_request_semantic_digest: &frozen.product_edge_request_semantic_digest,
            research_receipt_identity: &frozen.research_receipt_identity,
            intent_semantic_digest: &frozen.intent_semantic_digest,
            trial_family_root_digest: &frozen.trial_family_root_digest,
            census_frontier_digest: &frozen.census_frontier_digest,
            artifact_family_binding_digest: &frozen.artifact_family_binding_digest,
            artifact_family_binding_receipt_identity: &frozen
                .artifact_family_binding_receipt_identity,
            artifact_review_identity: &frozen.artifact_review_identity,
            exact_code_bytes_sha256_digest: &frozen.exact_code_bytes_sha256_digest,
            source_capsule_digest: &frozen.source_capsule_digest,
            build_recipe_digest: &frozen.build_recipe_digest,
            dependency_identity: &frozen.dependency_identity,
            trial_family_outbox_event_identity: &frozen.trial_family_outbox_event_identity,
            trial_family_outbox_digest: &frozen.trial_family_outbox_digest,
            trial_family_outbox_committed_at_epoch_ms: frozen
                .trial_family_outbox_committed_at_epoch_ms,
            artifact_family_outbox_event_identity: &frozen.artifact_family_outbox_event_identity,
            artifact_family_outbox_digest: &frozen.artifact_family_outbox_digest,
            artifact_family_outbox_committed_at_epoch_ms: frozen
                .artifact_family_outbox_committed_at_epoch_ms,
            committed_at_epoch_ms: frozen.committed_at_epoch_ms,
        },
    )
}

fn validate_legacy_proposal(
    proposal: &LegacyReplayProposalV1,
) -> Result<(), ExploratoryReplayCustodyError> {
    let identities = [
        proposal.request_identity.as_str(),
        proposal.admission.request_identity.as_str(),
        proposal.admission.admission_identity.as_str(),
        proposal.build_request_identity.as_str(),
        proposal.attempt_identity.as_str(),
        proposal.intent_identity.as_str(),
        proposal.trial_family_identity.as_str(),
        proposal.artifact_identity.as_str(),
        proposal.build_receipt_identity.as_str(),
        proposal.artifact_family_binding_identity.as_str(),
        proposal.census_frontier_identity.as_str(),
        proposal.requested_pit_scope.identity.as_str(),
        proposal.dataset.identity.as_str(),
        proposal.feature_set.identity.as_str(),
        proposal.strategy_spec.identity.as_str(),
        proposal.replay_config.identity.as_str(),
        proposal.runtime_kernel.identity.as_str(),
        proposal.runtime_kernel.version.as_str(),
        proposal.simulator.identity.as_str(),
        proposal.simulator.version.as_str(),
        proposal.backtest_engine.identity.as_str(),
        proposal.backtest_engine.version.as_str(),
        proposal.cost_model_identity.as_str(),
        proposal.slippage_model_identity.as_str(),
        proposal.capacity_model_identity.as_str(),
        proposal.calendar_identity.as_str(),
        proposal.time_zone_identity.as_str(),
    ];

    if identities
        .iter()
        .any(|value| value.is_empty() || value.len() > 512 || value.trim() != *value)
        || [
            &proposal.requested_pit_scope.digest,
            &proposal.dataset.digest,
            &proposal.feature_set.digest,
            &proposal.strategy_spec.digest,
            &proposal.replay_config.digest,
            &proposal.admission.admission_digest,
        ]
        .iter()
        .any(|digest| !valid_sha256(digest))
        || !valid_blake3(&proposal.exact_code_bytes_digest)
        || proposal.range_start_epoch_ms >= proposal.range_end_epoch_ms
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn verify_receipt_v1(
    receipt: &StoredReceiptV1,
    frozen: &StoredFrozenCoreV2,
) -> Result<(), ExploratoryReplayCustodyError> {
    let digest = canonical_digest(
        "rd.exploratory-replay-request-receipt.v1",
        &(
            1_u32,
            &frozen.proposal.request_identity,
            &frozen.request_digest,
            frozen.committed_at_epoch_ms,
        ),
    )?;

    if receipt.schema_version != 1
        || receipt.receipt_identity != identity("rd-exploratory-replay-receipt-v1", &digest)
        || receipt.request_identity != frozen.proposal.request_identity
        || receipt.request_digest != frozen.request_digest
        || receipt.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn verify_outbox_v1(
    outbox: &LockedOutboxV1,
    frozen: &StoredFrozenCoreV2,
    receipt: &StoredReceiptV1,
) -> Result<(), ExploratoryReplayCustodyError> {
    let payload: StoredOutboxV1 = exact(&outbox.payload_json)?;
    let expected = StoredOutboxV1 {
        schema_version: 1,
        request_identity: frozen.proposal.request_identity.clone(),
        request_digest: frozen.request_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        intent_identity: frozen.proposal.intent_identity.clone(),
        trial_family_identity: frozen.proposal.trial_family_identity.clone(),
        artifact_identity: frozen.proposal.artifact_identity.clone(),
        census_frontier_identity: frozen.proposal.census_frontier_identity.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let digest = canonical_digest("rd.owner-outbox.payload.v1", &expected)?;
    if payload != expected
        || outbox.event_identity != identity("rd-owner-event-v1", &digest)
        || outbox.aggregate_identity != expected.request_identity
        || outbox.event_kind != FROZEN_EVENT_V1
        || outbox.payload_digest != digest
        || outbox.committed_at_epoch_ms != frozen.committed_at_epoch_ms
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn verify_dependency_outbox<T>(
    outbox: &LockedOutboxV1,
    aggregate_identity: &str,
    event_kind: &str,
    event_identity: &str,
    payload_digest: &str,
    committed_at_epoch_ms: u64,
) -> Result<(), ExploratoryReplayCustodyError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let payload: T = exact(&outbox.payload_json)?;
    let recomputed_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    if outbox.aggregate_identity != aggregate_identity
        || outbox.event_kind != event_kind
        || outbox.event_identity != event_identity
        || outbox.payload_digest != payload_digest
        || outbox.payload_digest != recomputed_digest
        || outbox.committed_at_epoch_ms != committed_at_epoch_ms
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(())
}

fn legacy_projection_matches(
    proposal: &LegacyReplayProposalV1,
    request: &ReplayRequestDtoV2,
) -> bool {
    proposal.request_identity == request.request_identity.as_str()
        && proposal.admission.request_identity == request.request_identity.as_str()
        && proposal.intent_identity == request.frozen_research_intent.identity.as_str()
        && proposal.trial_family_identity == request.trial_family.identity.as_str()
        && proposal.artifact_identity == request.artifact.identity.as_str()
        && proposal.census_frontier_identity
            == request.trial_family_census_frontier.identity.as_str()
        && proposal.requested_pit_scope.identity == request.pit_scope.identity.as_str()
        && proposal.requested_pit_scope.digest == request.pit_scope.digest.as_str()
        && proposal.dataset.identity == request.pit_snapshot.identity.as_str()
        && proposal.dataset.digest == request.pit_snapshot.digest.as_str()
        && proposal.feature_set.identity == request.resolved_owner_inputs.identity.as_str()
        && proposal.feature_set.digest == request.resolved_owner_inputs.digest.as_str()
        && proposal.strategy_spec.identity == request.strategy_design.identity.as_str()
        && proposal.strategy_spec.digest == request.strategy_design.digest.as_str()
        && proposal.exact_code_bytes_digest == request.artifact.digest.as_str()
        && proposal.replay_config.identity == request.replay_configuration.identity.as_str()
        && proposal.replay_config.digest == request.replay_configuration.digest.as_str()
        && proposal.runtime_kernel.identity == request.models.runtime_kernel.identity.as_str()
        && proposal.runtime_kernel.version == request.models.runtime_kernel.version.as_str()
        && proposal.simulator.identity == request.models.simulator.identity.as_str()
        && proposal.simulator.version == request.models.simulator.version.as_str()
        && proposal.backtest_engine.identity == request.runner_operational_profile.identity.as_str()
        && proposal.backtest_engine.version == request.runner_operational_profile.version.as_str()
        && proposal.cost_model_identity == request.models.cost.identity.as_str()
        && proposal.slippage_model_identity == request.models.slippage.identity.as_str()
        && proposal.capacity_model_identity == request.models.capacity.identity.as_str()
        && proposal.deterministic_seed == request.deterministic_seed
        && proposal.range_start_epoch_ms == request.window.start_event_ns
        && proposal.range_end_epoch_ms == request.window.end_event_ns_exclusive
        && proposal.calendar_identity == request.calendar.identity.as_str()
        && proposal.time_zone_identity == request.time_zone.identity.as_str()
}

fn unavailable(selector: &ExploratoryReplayRecoverySelectorV2) -> ExploratoryReplayReadResultV2 {
    ExploratoryReplayReadResultV2 {
        request_identity: selector.request_identity.clone(),
        availability: ExploratoryReplayAvailabilityV2::Unavailable,
        readback: None,
    }
}

fn exact<T>(value: &serde_json::Value) -> Result<T, ExploratoryReplayCustodyError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone())
        .map_err(|_| ExploratoryReplayCustodyError::Unavailable)?;
    if serde_json::to_value(&decoded).map_err(|_| ExploratoryReplayCustodyError::Unavailable)?
        != *value
    {
        return Err(ExploratoryReplayCustodyError::Unavailable);
    }
    Ok(decoded)
}

fn canonical_digest<T: Serialize + ?Sized>(
    domain: &str,
    value: &T,
) -> Result<String, ExploratoryReplayCustodyError> {
    #[derive(Serialize)]
    struct Envelope<'a, T: ?Sized> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value })
        .map_err(|_| ExploratoryReplayCustodyError::Unavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn valid_blake3(value: &str) -> bool {
    value.strip_prefix("blake3:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn storage(error: impl Display) -> ExploratoryReplayCustodyError {
    ExploratoryReplayCustodyError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn sha(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn blake(byte: char) -> String {
        format!("blake3:{}", byte.to_string().repeat(64))
    }

    fn selector() -> ExploratoryReplayRecoverySelectorV2 {
        ExploratoryReplayRecoverySelectorV2 {
            request_identity: "request-v2".to_string(),
            meaning_digest: format!("blake3:{}", "a".repeat(64)),
        }
    }

    fn valid_base_envelope(availability: ExploratoryReplayAvailabilityV2) -> LockedEnvelopeV2 {
        let proposal = LegacyReplayProposalV1 {
            request_identity: "request-v2".into(),
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: "request-v2".into(),
                admission_identity: "admission-v2".into(),
                admission_digest: sha('1'),
            },
            build_request_identity: "build-v2".into(),
            attempt_identity: "attempt-v2".into(),
            intent_identity: "intent-v2".into(),
            trial_family_identity: "trial-v2".into(),
            artifact_identity: "artifact-v2".into(),
            build_receipt_identity: "build-receipt-v2".into(),
            artifact_family_binding_identity: "artifact-binding-v2".into(),
            census_frontier_identity: "census-v2".into(),
            requested_pit_scope: IdentityDigestV1 {
                identity: "pit-scope-v2".into(),
                digest: sha('2'),
            },
            dataset: IdentityDigestV1 {
                identity: "pit-snapshot-v2".into(),
                digest: sha('3'),
            },
            feature_set: IdentityDigestV1 {
                identity: "owner-input-v2".into(),
                digest: sha('4'),
            },
            strategy_spec: IdentityDigestV1 {
                identity: "strategy-v2".into(),
                digest: sha('5'),
            },
            exact_code_bytes_digest: blake('6'),
            replay_config: IdentityDigestV1 {
                identity: "replay-config-v2".into(),
                digest: sha('7'),
            },
            runtime_kernel: VersionedIdentityV1 {
                identity: "runtime-v2".into(),
                version: "1".into(),
            },
            simulator: VersionedIdentityV1 {
                identity: "simulator-v2".into(),
                version: "1".into(),
            },
            backtest_engine: VersionedIdentityV1 {
                identity: "backtest-v2".into(),
                version: "1".into(),
            },
            cost_model_identity: "cost-v2".into(),
            slippage_model_identity: "slippage-v2".into(),
            capacity_model_identity: "capacity-v2".into(),
            deterministic_seed: 7,
            range_start_epoch_ms: 10,
            range_end_epoch_ms: 20,
            calendar_identity: "calendar-v2".into(),
            time_zone_identity: "utc-v2".into(),
        };
        let family_payload = FamilyFrozenOutboxV1 {
            schema_version: 1,
            research_receipt_identity: "research-receipt-v2".into(),
            intent_identity: proposal.intent_identity.clone(),
            trial_family_identity: proposal.trial_family_identity.clone(),
            root_receipt_identity: "root-receipt-v2".into(),
            membership_receipt_identity: "membership-receipt-v2".into(),
            census_frontier_identity: proposal.census_frontier_identity.clone(),
            census_frontier_digest: sha('8'),
        };
        let family_digest =
            canonical_digest("rd.owner-outbox.payload.v1", &family_payload).unwrap();
        let family_event = identity("rd-owner-event-v1", &family_digest);
        let artifact_payload = ArtifactBoundOutboxV1 {
            schema_version: 1,
            artifact_identity: proposal.artifact_identity.clone(),
            build_receipt_identity: proposal.build_receipt_identity.clone(),
            trial_family_identity: proposal.trial_family_identity.clone(),
            binding_identity: proposal.artifact_family_binding_identity.clone(),
            binding_receipt_identity: "binding-receipt-v2".into(),
        };
        let artifact_digest =
            canonical_digest("rd.owner-outbox.payload.v1", &artifact_payload).unwrap();
        let artifact_event = identity("rd-owner-event-v1", &artifact_digest);
        let committed_at_epoch_ms = 100;
        let mut frozen = StoredFrozenCoreV2 {
            schema_version: 1,
            request_schema_version: 2,
            proposal,
            product_edge_request_semantic_digest: sha('9'),
            research_receipt_identity: "research-receipt-v2".into(),
            intent_semantic_digest: sha('a'),
            trial_family_root_digest: sha('b'),
            census_frontier_digest: family_payload.census_frontier_digest.clone(),
            artifact_family_binding_digest: artifact_digest.clone(),
            artifact_family_binding_receipt_identity: "binding-receipt-v2".into(),
            artifact_review_identity: "artifact-review-v2".into(),
            exact_code_bytes_sha256_digest: sha('c'),
            source_capsule_digest: sha('d'),
            build_recipe_digest: sha('e'),
            dependency_identity: "dependency-v2".into(),
            trial_family_outbox_event_identity: family_event.clone(),
            trial_family_outbox_digest: family_digest.clone(),
            trial_family_outbox_committed_at_epoch_ms: committed_at_epoch_ms,
            artifact_family_outbox_event_identity: artifact_event.clone(),
            artifact_family_outbox_digest: artifact_digest.clone(),
            artifact_family_outbox_committed_at_epoch_ms: committed_at_epoch_ms,
            committed_at_epoch_ms,
            request_digest: String::new(),
        };
        frozen.request_digest = frozen_digest(&frozen).unwrap();
        let receipt_digest = canonical_digest(
            "rd.exploratory-replay-request-receipt.v1",
            &(
                1_u32,
                &frozen.proposal.request_identity,
                &frozen.request_digest,
                committed_at_epoch_ms,
            ),
        )
        .unwrap();
        let receipt = StoredReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-exploratory-replay-receipt-v1", &receipt_digest),
            request_identity: frozen.proposal.request_identity.clone(),
            request_digest: frozen.request_digest.clone(),
            committed_at_epoch_ms,
        };
        let base_payload = StoredOutboxV1 {
            schema_version: 1,
            request_identity: frozen.proposal.request_identity.clone(),
            request_digest: frozen.request_digest.clone(),
            receipt_identity: receipt.receipt_identity.clone(),
            intent_identity: frozen.proposal.intent_identity.clone(),
            trial_family_identity: frozen.proposal.trial_family_identity.clone(),
            artifact_identity: frozen.proposal.artifact_identity.clone(),
            census_frontier_identity: frozen.proposal.census_frontier_identity.clone(),
            committed_at_epoch_ms,
        };
        let base_digest = canonical_digest("rd.owner-outbox.payload.v1", &base_payload).unwrap();
        LockedEnvelopeV2 {
            schema_version: 2,
            availability,
            owner_cut_epoch_ms: Some(200),
            frozen: Some(serde_json::to_value(frozen).unwrap()),
            receipt: Some(serde_json::to_value(receipt).unwrap()),
            outbox: Some(LockedOutboxV1 {
                event_identity: identity("rd-owner-event-v1", &base_digest),
                aggregate_identity: "request-v2".into(),
                event_kind: FROZEN_EVENT_V1.into(),
                payload_digest: base_digest,
                payload_json: serde_json::to_value(base_payload).unwrap(),
                committed_at_epoch_ms,
            }),
            trial_family_outbox: Some(LockedOutboxV1 {
                event_identity: family_event,
                aggregate_identity: "trial-v2".into(),
                event_kind: "TRIAL_FAMILY_FROZEN_V1".into(),
                payload_digest: family_digest,
                payload_json: serde_json::to_value(family_payload).unwrap(),
                committed_at_epoch_ms,
            }),
            artifact_family_outbox: Some(LockedOutboxV1 {
                event_identity: artifact_event,
                aggregate_identity: "artifact-v2".into(),
                event_kind: "ARTIFACT_TRIAL_FAMILY_BOUND_V1".into(),
                payload_digest: artifact_digest,
                payload_json: serde_json::to_value(artifact_payload).unwrap(),
                committed_at_epoch_ms,
            }),
            v2_canonical_request_base64: None,
            v2_meaning_digest: None,
            v2_seal_digest: None,
            v2_receipt: None,
            v2_outbox: None,
        }
    }

    #[rstest]
    fn absent_owner_fact_is_unavailable_without_positive_token() {
        let result = decode_owner_envelope(&selector(), None).expect("absence is a valid read");
        assert_eq!(
            result.availability(),
            ExploratoryReplayAvailabilityV2::Unavailable
        );
        assert!(result.readback().is_none());
    }

    #[rstest]
    fn incomplete_stale_owner_fact_fails_closed() {
        let value = serde_json::json!({
            "schema_version": 2,
            "availability": "STALE"
        });
        let result =
            decode_owner_envelope(&selector(), Some(value)).expect("stale is a valid read");
        assert_eq!(
            result.availability(),
            ExploratoryReplayAvailabilityV2::Unavailable
        );
        assert!(result.into_readback().is_none());
    }

    #[rstest]
    fn valid_v1_base_cannot_promote_missing_v2_custody_to_stale() {
        let value =
            serde_json::to_value(valid_base_envelope(ExploratoryReplayAvailabilityV2::Stale))
                .unwrap();
        let result =
            decode_owner_envelope(&selector(), Some(value)).expect("missing V2 is unavailable");

        assert_eq!(
            result.availability(),
            ExploratoryReplayAvailabilityV2::Unavailable
        );
        assert!(result.into_readback().is_none());
    }

    #[rstest]
    fn owner_envelope_rejects_unknown_fields() {
        let value = serde_json::json!({
            "schema_version": 2,
            "availability": "STALE",
            "caller_attestation": true
        });
        assert!(decode_owner_envelope(&selector(), Some(value)).is_err());
    }

    #[rstest]
    fn available_label_without_complete_owner_evidence_fails_closed() {
        let value = serde_json::to_value(valid_base_envelope(
            ExploratoryReplayAvailabilityV2::Available,
        ))
        .unwrap();
        let result =
            decode_owner_envelope(&selector(), Some(value)).expect("incomplete is unavailable");
        assert_eq!(
            result.availability(),
            ExploratoryReplayAvailabilityV2::Unavailable
        );
        assert!(result.readback().is_none());
    }
}
