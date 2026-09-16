//! R&D-owned binding from one accepted Composer Artifact to one current TrialFamily cut.
//!
//! A Composer operation may contain several plugin Build Receipts. This aggregate binds its
//! single accepted operation and package instead of mislabeling any plugin receipt as the
//! legacy Artifact Build Receipt.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_data::owner::source_binding::BindingDigest;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_product_edge::{
    DownstreamAdmissionModeV1, resolve_admission_for_downstream_in_transaction,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::trial_family_postgres::{persist_outbox, verify_outbox_storage};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::{
    composer_replay_intent_v3::resolve_composer_replay_intent_in_transaction,
    develop_composer_postgres_v2::read_accepted_for_replay_in_transaction,
    exploratory_replay::{
        ComposerBackedExploratoryReplayProposalV3, EXPLORATORY_REPLAY_MUTATION_EFFECT_V3,
        EXPLORATORY_REPLAY_OPERATION_V3, EXPLORATORY_REPLAY_SCHEMA_V3,
        exploratory_replay_admission_payload_v3,
    },
    product_edge::{RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1},
    source_research_composer_postgres_v2::SourceResearchComposerBindingOwnerV2,
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};
use crate::{
    composer_replay_intent_v3::{ComposerReplayIntentV3, parse_named_sha256},
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    trial_family::{TrialFamilyCensusReadbackV2, TrialFamilyError, verify_census_v2},
};

const SCHEMA_VERSION: u16 = 3;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const BOUND_EVENT_V3: &str = "COMPOSER_ARTIFACT_TRIAL_FAMILY_BOUND_V3";

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComposerArtifactFamilyBindingV3 {
    schema_version: u16,
    binding_identity: String,
    binding_digest: String,
    artifact_locator: String,
    artifact_identity: BindingDigest,
    composer_request_identity: String,
    composer_request_digest: BindingDigest,
    composer_operation_receipt_identity: BindingDigest,
    artifact_package_bytes_digest: BindingDigest,
    intent_identity: String,
    intent_digest: String,
    trial_family_identity: String,
    trial_family_root_digest: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComposerArtifactFamilyBindingReceiptV3 {
    schema_version: u16,
    receipt_identity: String,
    binding_identity: String,
    binding_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ComposerArtifactFamilyReadbackV3 {
    binding: ComposerArtifactFamilyBindingV3,
    receipt: ComposerArtifactFamilyBindingReceiptV3,
}

#[derive(Serialize)]
struct BindingMeaning<'a> {
    schema_version: u16,
    artifact_locator: &'a str,
    artifact_identity: BindingDigest,
    composer_request_identity: &'a str,
    composer_request_digest: BindingDigest,
    composer_operation_receipt_identity: BindingDigest,
    artifact_package_bytes_digest: BindingDigest,
    intent_identity: &'a str,
    intent_digest: &'a str,
    trial_family_identity: &'a str,
    trial_family_root_digest: &'a str,
    census_frontier_identity: &'a str,
    census_frontier_digest: &'a str,
}

#[derive(Serialize)]
struct ReceiptMeaning<'a> {
    schema_version: u16,
    binding_identity: &'a str,
    binding_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ComposerArtifactFamilyOutboxV3 {
    schema_version: u16,
    artifact_locator: String,
    composer_request_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    binding_identity: String,
    binding_digest: String,
    binding_receipt_identity: String,
    committed_at_epoch_ms: u64,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl ComposerArtifactFamilyOutboxV3 {
    fn from_readback(readback: &ComposerArtifactFamilyReadbackV3) -> Self {
        let binding = &readback.binding;
        Self {
            schema_version: SCHEMA_VERSION,
            artifact_locator: binding.artifact_locator.clone(),
            composer_request_identity: binding.composer_request_identity.clone(),
            intent_identity: binding.intent_identity.clone(),
            trial_family_identity: binding.trial_family_identity.clone(),
            census_frontier_identity: binding.census_frontier_identity.clone(),
            binding_identity: binding.binding_identity.clone(),
            binding_digest: binding.binding_digest.clone(),
            binding_receipt_identity: readback.receipt.receipt_identity.clone(),
            committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms,
        }
    }
}

impl ComposerArtifactFamilyReadbackV3 {
    pub(crate) fn binding(&self) -> &ComposerArtifactFamilyBindingV3 {
        &self.binding
    }

    pub(crate) fn receipt(&self) -> &ComposerArtifactFamilyBindingReceiptV3 {
        &self.receipt
    }
}

impl ComposerArtifactFamilyBindingV3 {
    pub(crate) fn identity(&self) -> &str {
        &self.binding_identity
    }

    pub(crate) fn digest(&self) -> &str {
        &self.binding_digest
    }

    pub(crate) fn artifact_locator(&self) -> &str {
        &self.artifact_locator
    }

    pub(crate) fn composer_request_identity(&self) -> &str {
        &self.composer_request_identity
    }

    pub(crate) fn trial_family_identity(&self) -> &str {
        &self.trial_family_identity
    }

    pub(crate) fn census_frontier_identity(&self) -> &str {
        &self.census_frontier_identity
    }

    pub(crate) fn census_frontier_digest(&self) -> &str {
        &self.census_frontier_digest
    }
}

impl ComposerArtifactFamilyBindingReceiptV3 {
    pub(crate) fn identity(&self) -> &str {
        &self.receipt_identity
    }

    pub(crate) const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

pub(crate) fn issue_composer_artifact_family_binding_v3(
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    committed_at_epoch_ms: u64,
) -> Result<ComposerArtifactFamilyReadbackV3, TrialFamilyError> {
    verify_census_v2(census)?;
    let locator = composer.locator();
    let family = census.legacy_family.root();
    let intent_prefix = if intent.identity().starts_with("rd-research-intent-v2-") {
        "rd-research-intent-v2-"
    } else {
        "rd-successor-research-intent-v1-"
    };
    if locator.artifact_locator.is_empty()
        || committed_at_epoch_ms == 0
        || parse_named_sha256(intent.identity(), intent_prefix).map_err(unavailable)?
            != composer.intent_identity()
        || !canonical_sha256(intent.digest())
    {
        return Err(unavailable(
            "Composer Artifact-family source is unavailable",
        ));
    }
    let meaning = BindingMeaning {
        schema_version: SCHEMA_VERSION,
        artifact_locator: &locator.artifact_locator,
        artifact_identity: locator.artifact_identity,
        composer_request_identity: &locator.request_identity,
        composer_request_digest: composer.request_digest(),
        composer_operation_receipt_identity: locator.operation_receipt_identity,
        artifact_package_bytes_digest: composer.artifact_package_bytes_digest(),
        intent_identity: intent.identity(),
        intent_digest: intent.digest(),
        trial_family_identity: family.trial_family_identity(),
        trial_family_root_digest: family.root_digest(),
        census_frontier_identity: census.census_frontier.frontier_identity(),
        census_frontier_digest: census.census_frontier.frontier_digest(),
    };
    let binding_digest = canonical_digest("rd.composer-artifact-family-binding.v3", &meaning)?;
    let binding = ComposerArtifactFamilyBindingV3 {
        schema_version: SCHEMA_VERSION,
        binding_identity: identity("rd-composer-artifact-family-binding-v3", &binding_digest),
        binding_digest,
        artifact_locator: meaning.artifact_locator.to_owned(),
        artifact_identity: meaning.artifact_identity,
        composer_request_identity: meaning.composer_request_identity.to_owned(),
        composer_request_digest: meaning.composer_request_digest,
        composer_operation_receipt_identity: meaning.composer_operation_receipt_identity,
        artifact_package_bytes_digest: meaning.artifact_package_bytes_digest,
        intent_identity: meaning.intent_identity.to_owned(),
        intent_digest: meaning.intent_digest.to_owned(),
        trial_family_identity: meaning.trial_family_identity.to_owned(),
        trial_family_root_digest: meaning.trial_family_root_digest.to_owned(),
        census_frontier_identity: meaning.census_frontier_identity.to_owned(),
        census_frontier_digest: meaning.census_frontier_digest.to_owned(),
    };
    let receipt_digest = canonical_digest(
        "rd.composer-artifact-family-binding-receipt.v3",
        &ReceiptMeaning {
            schema_version: SCHEMA_VERSION,
            binding_identity: &binding.binding_identity,
            binding_digest: &binding.binding_digest,
            committed_at_epoch_ms,
        },
    )?;
    Ok(ComposerArtifactFamilyReadbackV3 {
        receipt: ComposerArtifactFamilyBindingReceiptV3 {
            schema_version: SCHEMA_VERSION,
            receipt_identity: identity(
                "rd-composer-artifact-family-binding-receipt-v3",
                &receipt_digest,
            ),
            binding_identity: binding.binding_identity.clone(),
            binding_digest: binding.binding_digest.clone(),
            committed_at_epoch_ms,
        },
        binding,
    })
}

pub(crate) fn admit_stored_composer_artifact_family_binding_v3(
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    binding_json: &serde_json::Value,
    receipt_json: &serde_json::Value,
) -> Result<ComposerArtifactFamilyReadbackV3, TrialFamilyError> {
    let binding: ComposerArtifactFamilyBindingV3 =
        serde_json::from_value(binding_json.clone()).map_err(unavailable)?;
    let receipt: ComposerArtifactFamilyBindingReceiptV3 =
        serde_json::from_value(receipt_json.clone()).map_err(unavailable)?;
    let expected = issue_composer_artifact_family_binding_v3(
        census,
        intent,
        composer,
        receipt.committed_at_epoch_ms,
    )?;
    if binding != expected.binding || receipt != expected.receipt {
        return Err(unavailable(
            "Composer Artifact-family binding content mismatch",
        ));
    }
    Ok(expected)
}

/// Issues the Composer Artifact-family fact in its own authorized R&D transaction.
/// The Replay transaction must subsequently reread it before its first INSERT.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn ensure_composer_artifact_family_binding_for_replay_v3<B>(
    pool: &PgPool,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    binding_owner: &B,
) -> Result<ComposerArtifactFamilyReadbackV3, TrialFamilyError>
where
    B: SourceResearchComposerBindingOwnerV2,
{
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(&proposal.request_identity)
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    let initial_cut = database_now_epoch_ms(&mut transaction).await?;
    let admission = resolve_admission_for_downstream_in_transaction(
        &mut transaction,
        &proposal.admission,
        DownstreamAdmissionModeV1::FirstMutation {
            read_cut_epoch_ms: initial_cut,
        },
    )
    .await
    .map_err(unavailable)?;
    verify_composer_replay_admission_v3(&admission, proposal)?;
    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut transaction,
        &proposal.trial_family_identity,
    )
    .await?;
    let composer = read_accepted_for_replay_in_transaction(
        &mut transaction,
        &proposal.composer_locator,
        binding_owner,
        initial_cut,
    )
    .await
    .map_err(unavailable)?;
    let intent =
        resolve_composer_replay_intent_in_transaction(&mut transaction, &census, &composer)
            .await
            .map_err(unavailable)?;
    if composer.locator().artifact_locator != proposal.artifact_identity {
        return Err(unavailable("Composer Artifact identity mismatch"));
    }
    let final_cut = database_now_epoch_ms(&mut transaction).await?;
    verify_composer_replay_admission_v3(&admission, proposal)?;
    if !admission.authorizes_first_mutation_at(final_cut) {
        return Err(unavailable(
            "Replay admission changed before Artifact-family binding",
        ));
    }
    let binding = persist_preverified_composer_artifact_family_binding_v3(
        &mut transaction,
        &census,
        &intent,
        &composer,
        final_cut,
    )
    .await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(binding)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn verify_composer_replay_admission_v3(
    admission: &vibe_product_edge::ProductEdgeAdmissionReadbackV1,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
) -> Result<(), TrialFamilyError> {
    let request = admission.request();
    if admission.locator() != &proposal.admission
        || proposal.admission.request_identity != proposal.request_identity
        || request.request_identity != proposal.request_identity
        || request.typed_payload
            != exploratory_replay_admission_payload_v3(proposal).map_err(unavailable)?
        || request.operation != EXPLORATORY_REPLAY_OPERATION_V3
        || request.operation_schema != EXPLORATORY_REPLAY_SCHEMA_V3
        || request.target_owner != RESEARCH_OWNER_V1
        || request.requested_effects.as_slice() != [EXPLORATORY_REPLAY_MUTATION_EFFECT_V3]
        || !admission
            .authorized_scope()
            .iter()
            .any(|scope| scope == RESEARCH_SCOPE_V1)
    {
        return Err(unavailable(
            "canonical Product Edge Replay V3 admission mismatch",
        ));
    }
    Ok(())
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn database_now_epoch_ms(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, TrialFamilyError> {
    let now: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(unavailable)?;
    u64::try_from(now).map_err(unavailable)
}

/// Reads one already committed binding under the caller's R&D transaction.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn load_composer_artifact_family_binding_for_replay_v3(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
) -> Result<Option<ComposerArtifactFamilyReadbackV3>, TrialFamilyError> {
    let row = sqlx::query("SELECT binding_identity,artifact_locator,composer_request_identity,intent_identity,trial_family_identity,census_frontier_identity,binding_digest,binding_json,receipt_json,committed_at_epoch_ms FROM public.rd_composer_artifact_family_bindings_v3 WHERE artifact_locator=$1 FOR SHARE")
        .bind(&composer.locator().artifact_locator)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(unavailable)?;
    let Some(row) = row else { return Ok(None) };
    let binding_json: serde_json::Value = row.try_get("binding_json").map_err(unavailable)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(unavailable)?;
    let readback = admit_stored_composer_artifact_family_binding_v3(
        census,
        intent,
        composer,
        &binding_json,
        &receipt_json,
    )?;
    let binding = &readback.binding;
    if row
        .try_get::<String, _>("binding_identity")
        .map_err(unavailable)?
        != binding.binding_identity
        || row
            .try_get::<String, _>("artifact_locator")
            .map_err(unavailable)?
            != binding.artifact_locator
        || row
            .try_get::<String, _>("composer_request_identity")
            .map_err(unavailable)?
            != binding.composer_request_identity
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(unavailable)?
            != binding.intent_identity
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(unavailable)?
            != binding.trial_family_identity
        || row
            .try_get::<String, _>("census_frontier_identity")
            .map_err(unavailable)?
            != binding.census_frontier_identity
        || row
            .try_get::<String, _>("binding_digest")
            .map_err(unavailable)?
            != binding.binding_digest
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(readback.receipt.committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(unavailable("Composer Artifact-family binding row mismatch"));
    }
    verify_binding_outbox_v3(transaction, &readback).await?;
    Ok(Some(readback))
}

/// Persists only after the caller authenticates the required Owner admission.
/// An exact retry against the same current Owner cut returns the original bytes without a write.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn persist_preverified_composer_artifact_family_binding_v3(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    intent: &ComposerReplayIntentV3,
    composer: &SealedDevelopComposerReadbackV2,
    committed_at_epoch_ms: u64,
) -> Result<ComposerArtifactFamilyReadbackV3, TrialFamilyError> {
    if let Some(existing) =
        load_composer_artifact_family_binding_for_replay_v3(transaction, census, intent, composer)
            .await?
    {
        return Ok(existing);
    }
    let readback =
        issue_composer_artifact_family_binding_v3(census, intent, composer, committed_at_epoch_ms)?;
    let binding = &readback.binding;
    sqlx::query("INSERT INTO public.rd_composer_artifact_family_bindings_v3 (binding_identity,artifact_locator,composer_request_identity,intent_identity,trial_family_identity,census_frontier_identity,binding_digest,binding_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(&binding.binding_identity)
        .bind(&binding.artifact_locator)
        .bind(&binding.composer_request_identity)
        .bind(&binding.intent_identity)
        .bind(&binding.trial_family_identity)
        .bind(&binding.census_frontier_identity)
        .bind(&binding.binding_digest)
        .bind(serde_json::to_value(binding).map_err(unavailable)?)
        .bind(serde_json::to_value(&readback.receipt).map_err(unavailable)?)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    persist_outbox(
        transaction,
        binding_outbox_identity(binding),
        &binding.artifact_locator,
        BOUND_EVENT_V3,
        &ComposerArtifactFamilyOutboxV3::from_readback(&readback),
        committed_at_epoch_ms,
    )
    .await?;
    Ok(readback)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn verify_binding_outbox_v3(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &ComposerArtifactFamilyReadbackV3,
) -> Result<(), TrialFamilyError> {
    let row = sqlx::query("SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(&readback.binding.artifact_locator)
        .bind(BOUND_EVENT_V3)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(unavailable)?
        .ok_or_else(|| unavailable("Composer Artifact-family outbox missing"))?;
    let payload_json: serde_json::Value = row.try_get("payload_json").map_err(unavailable)?;
    let payload: ComposerArtifactFamilyOutboxV3 =
        serde_json::from_value(payload_json.clone()).map_err(unavailable)?;
    if serde_json::to_value(&payload).map_err(unavailable)? != payload_json {
        return Err(unavailable(
            "Composer Artifact-family outbox shape mismatch",
        ));
    }
    verify_outbox_storage(&row, &payload)?;
    if row
        .try_get::<String, _>("event_identity")
        .map_err(unavailable)?
        != binding_outbox_identity(&readback.binding)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(unavailable)?
            != readback.binding.artifact_locator
        || row
            .try_get::<String, _>("event_kind")
            .map_err(unavailable)?
            != BOUND_EVENT_V3
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(unavailable)?
            != canonical_digest("rd.owner-outbox.payload.v1", &payload)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(unavailable)?
            != i64::try_from(readback.receipt.committed_at_epoch_ms).map_err(unavailable)?
        || payload != ComposerArtifactFamilyOutboxV3::from_readback(readback)
    {
        return Err(unavailable("Composer Artifact-family outbox mismatch"));
    }
    Ok(())
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn binding_outbox_identity(binding: &ComposerArtifactFamilyBindingV3) -> String {
    identity("rd-owner-outbox-v1", &binding.binding_digest)
}

fn canonical_digest(domain: &str, value: &impl Serialize) -> Result<String, TrialFamilyError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(unavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn canonical_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|suffix| {
        suffix.len() == 64
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    })
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn unavailable(error: impl std::fmt::Display) -> TrialFamilyError {
    TrialFamilyError::Unavailable(error.to_string())
}
