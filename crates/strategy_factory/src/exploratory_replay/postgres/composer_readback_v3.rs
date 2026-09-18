//! Historical COMPOSER_V3 Replay readback. The stored JSON is a claim, not Owner authority.
//! A positive readback additionally needs exact historical Composer, TrialFamily, binding, and
//! Market Data Owner facts; a current-frontier resolver must never substitute for those facts.

use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use vibe_backtest_owner_contracts::{ReplayRequestDtoV2, ReplayRequestV2};
use vibe_data::owner::replay_market_facts_v2::resolve_bound_replay_cut_for_rd_in_transaction_v1;
use vibe_product_edge::{
    DownstreamAdmissionModeV1, resolve_admission_for_downstream_in_transaction,
};

use super::composer_commit_v3::{
    RESEARCH_VIEW_TRANSITION_EVENT_V3, StoredResearchViewTransitionOutboxV3,
    StoredResearchViewTransitionV3, verify_research_view_transition_v3,
};
use super::{
    EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2, LockedOutboxRowV1, PreparedSealV2,
    ReplaySealBindingV2, StoredOutboxV2, StoredReceiptV2, canonical_digest, decode_exact, identity,
    storage, unavailable, verify_v2_seal,
};
use crate::{
    composer_artifact_family_binding_v3::load_composer_artifact_family_binding_for_replay_v3,
    composer_replay_intent_v3::resolve_composer_replay_intent_in_transaction,
    develop_composer_postgres_v2::read_accepted_for_replay_historical_in_transaction,
    exploratory_replay::{
        ComposerBackedExploratoryReplayProposalV3, EXPLORATORY_REPLAY_MUTATION_EFFECT_V3,
        EXPLORATORY_REPLAY_OPERATION_V3, EXPLORATORY_REPLAY_SCHEMA_V3, ExploratoryReplayOwnerError,
        ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2,
        composition_v3::{
            StoredComposerReplayFrozenV3, StoredComposerReplayReceiptV3,
            StoredComposerReplaySourceV3, prepare_composer_backed_replay_v3,
            prepare_composer_replay_seal_v3, project_composer_replay_view_v3,
            verify_composer_replay_frozen_v3,
        },
        exploratory_replay_admission_payload_v3,
    },
    native_replay_rd_sources_v2::{
        REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, REPLAY_OUTBOX_STORAGE_DOMAIN_V1,
        REPLAY_RECEIPT_STORAGE_DOMAIN_V1, REPLAY_REQUEST_STORAGE_DOMAIN_V1, owner_storage_digest,
    },
    product_edge::{
        RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, ResearchViewV1,
        composer_exploration_research_view_is_valid_v3,
    },
    replay_execution_profile_binding_v1::ReplayExecutionProfileRequestSealV1,
    trial_family_postgres::load_trial_family_census_v2_at_frontier_in_transaction,
};

/// One internally consistent persisted claim. This type deliberately is not a sealed readback:
/// database rows can be internally consistent while their historical Owner dependencies differ.
struct StoredComposerReplayClaimV3 {
    frozen: StoredComposerReplayFrozenV3,
    receipt: StoredReceiptV2,
    canonical_request_bytes: Vec<u8>,
    request_storage_digest: String,
    canonical_receipt_bytes: Vec<u8>,
    receipt_storage_digest: String,
    canonical_outbox_bytes: Vec<u8>,
    outbox_storage_digest: String,
    transition: StoredResearchViewTransitionV3,
}

/// A narrow typed proof for historical Composer custody. Callers cannot construct it from JSON.
pub(crate) struct VerifiedResearchViewTransitionV3 {
    transition: StoredResearchViewTransitionV3,
}

impl VerifiedResearchViewTransitionV3 {
    pub(crate) fn old_view(&self) -> &ResearchViewV1 {
        &self.transition.old_view
    }

    pub(crate) fn new_view(&self) -> &ResearchViewV1 {
        &self.transition.new_view
    }

    pub(crate) fn replay_request_identity(&self) -> &str {
        &self.transition.replay_request_identity
    }
}

/// Verifies canonical Replay storage and the append-only CAS transition without following the
/// mutable current View. This port is narrower than a positive Replay readback because it does
/// not itself recompose Composer, TrialFamily, and Market Data Owner facts.
pub(crate) async fn read_verified_research_view_transition_v3_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    replay_request_identity: &str,
) -> Result<Option<VerifiedResearchViewTransitionV3>, ExploratoryReplayOwnerError> {
    let rows = sqlx::query("SELECT frozen_json FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 AND source_kind='COMPOSER_V3' FOR SHARE")
        .bind(replay_request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(corrupt("COMPOSER_V3 Replay row cardinality mismatch"));
    }
    let row = &rows[0];
    let frozen: StoredComposerReplayFrozenV3 =
        decode_exact(&row.try_get::<Value, _>("frozen_json").map_err(storage)?)?;

    if frozen.source.proposal.request_identity != replay_request_identity {
        return Err(corrupt("COMPOSER_V3 transition Replay identity mismatch"));
    }
    let claim = load_stored_claim(transaction, &frozen.source.proposal)
        .await?
        .ok_or_else(|| corrupt("COMPOSER_V3 Replay row disappeared"))?;
    let transition = claim.transition;
    Ok(Some(VerifiedResearchViewTransitionV3 { transition }))
}

/// Read-side entry for a Backtest/R&D locator. The stored proposal is only an untrusted selector:
/// the common resolver independently reconstructs its entire Owner source before returning.
pub(super) async fn resolve_composer_v3_by_locator_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<Option<SealedExploratoryReplayReadbackV2>, ExploratoryReplayOwnerError> {
    let row = sqlx::query("SELECT source_kind,frozen_json FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 FOR SHARE")
        .bind(&locator.request_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?;
    let Some(row) = row else { return Ok(None) };
    if row.try_get::<String, _>("source_kind").map_err(storage)? != "COMPOSER_V3" {
        return Err(corrupt("Replay locator is not a COMPOSER_V3 source"));
    }
    let frozen: StoredComposerReplayFrozenV3 =
        decode_exact(&row.try_get::<Value, _>("frozen_json").map_err(storage)?)?;

    if frozen.source.proposal.request_identity != locator.request_identity {
        return Err(corrupt("COMPOSER_V3 locator and stored source differ"));
    }
    let readback = Box::pin(resolve_existing_composer_v3_in_transaction(
        transaction,
        &frozen.source.proposal,
    ))
    .await?
    .ok_or_else(|| corrupt("COMPOSER_V3 Replay row disappeared"))?;

    if readback.meaning_digest() != locator.meaning_digest
        || readback.receipt.receipt_identity != locator.receipt_identity
        || readback.receipt.seal_digest != locator.seal_digest
    {
        return Err(corrupt(
            "COMPOSER_V3 Replay locator differs from Owner readback",
        ));
    }
    Ok(Some(readback))
}

/// Called under the Replay request advisory lock, before any new admission is attempted.
/// `None` means no row. A row with different meaning is a conflict, and a partial or unverified
/// row never becomes a positive Replay readback.
pub(super) async fn resolve_existing_composer_v3_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
) -> Result<Option<SealedExploratoryReplayReadbackV2>, ExploratoryReplayOwnerError> {
    let Some(claim) = load_stored_claim(transaction, proposal).await? else {
        return Ok(None);
    };
    let market = resolve_bound_replay_cut_for_rd_in_transaction_v1(
        transaction,
        proposal.market_data_locator,
    )
    .await
    .map_err(unavailable)?;
    let binding = market.binding();
    let market_facts = market.market_facts();
    let instrument_master = market.instrument_master();
    let source = &claim.frozen.source;
    let admission = resolve_admission_for_downstream_in_transaction(
        transaction,
        &proposal.admission,
        DownstreamAdmissionModeV1::Historical,
    )
    .await
    .map_err(unavailable)?;

    if admission.locator() != &proposal.admission
        || admission.request().request_identity != proposal.request_identity
        || admission.request().operation != EXPLORATORY_REPLAY_OPERATION_V3
        || admission.request().operation_schema != EXPLORATORY_REPLAY_SCHEMA_V3
        || admission.request().target_owner != RESEARCH_OWNER_V1
        || admission.request().requested_effects.as_slice()
            != [EXPLORATORY_REPLAY_MUTATION_EFFECT_V3]
        || !admission
            .authorized_scope()
            .iter()
            .any(|scope| scope == RESEARCH_SCOPE_V1)
        || admission.request().typed_payload
            != exploratory_replay_admission_payload_v3(proposal).map_err(unavailable)?
        || admission.request().semantic_digest().map_err(unavailable)?
            != claim.frozen.product_edge_request_semantic_digest
    {
        return Err(corrupt(
            "COMPOSER_V3 Product Edge historical admission mismatch",
        ));
    }
    let census = Box::pin(load_trial_family_census_v2_at_frontier_in_transaction(
        transaction,
        &proposal.trial_family_identity,
        &source.census_frontier_identity,
        &source.census_frontier_digest,
    ))
    .await
    .map_err(unavailable)?;
    let root = census.legacy_family.root();
    let root_receipt = census.legacy_family.root_receipt();
    let member = census.legacy_family.initial_intent_member();
    let expected_profile = ReplayExecutionProfileRequestSealV1::issue(
        &census.legacy_family,
        &proposal.request_identity,
        &claim.receipt.meaning_digest,
    )
    .map_err(unavailable)?;

    if source.trial_family_root_receipt_identity != root_receipt.receipt_identity()
        || source.trial_family_root_digest != root.root_digest()
        || source.trial_family_member_identity != member.member_identity()
        || source.trial_family_member_digest != member.member_digest()
        || claim.receipt.execution_profile_seal.as_ref() != Some(&expected_profile)
    {
        return Err(corrupt("COMPOSER_V3 TrialFamily Owner readback mismatch"));
    }

    if market.market_data_scope_digest() != proposal.market_data_scope_digest
        || source.market_binding_receipt_identity != binding.receipt().identity()
        || source.market_binding_outbox_identity != binding.outbox().identity()
        || source.market_facts_identity != market_facts.facts().identity()
        || source.market_facts_receipt_identity != market_facts.receipt().identity()
        || source.instrument_master_identity != instrument_master.identity()
        || source.instrument_master_receipt_identity != instrument_master.receipt_identity()
        || source.instrument_master_outbox_identity != instrument_master.outbox_identity()
    {
        return Err(corrupt("COMPOSER_V3 Market Data Owner readback mismatch"));
    }

    let old_view = &claim.transition.old_view;
    let new_view = &claim.transition.new_view;
    let exploration = new_view
        .exploration
        .as_ref()
        .ok_or_else(|| corrupt("COMPOSER_V3 historical exploration is missing"))?;
    let composer_view = new_view
        .composer_artifact
        .as_ref()
        .ok_or_else(|| corrupt("COMPOSER_V3 historical Composer reference is missing"))?;
    let composer = read_accepted_for_replay_historical_in_transaction(
        transaction,
        &proposal.composer_locator,
        old_view,
        new_view,
        exploration,
        composer_view,
    )
    .await
    .map_err(unavailable)?;
    let intent =
        resolve_composer_replay_intent_in_transaction(transaction, &census, &composer).await?;
    let artifact_family = load_composer_artifact_family_binding_for_replay_v3(
        transaction,
        &census,
        &intent,
        &composer,
    )
    .await
    .map_err(unavailable)?
    .ok_or_else(|| corrupt("COMPOSER_V3 historical Artifact-family binding is missing"))?;
    let composed = prepare_composer_backed_replay_v3(
        proposal,
        &census,
        &intent,
        &composer,
        &artifact_family,
        &market,
    )?;

    if composed.source != *source {
        return Err(corrupt("COMPOSER_V3 historical Owner source differs"));
    }
    let prepared = prepare_composer_replay_seal_v3(
        composed,
        &census,
        old_view.clone(),
        claim.frozen.product_edge_request_semantic_digest.clone(),
        claim.frozen.committed_at_epoch_ms,
    )?;

    if prepared.frozen != claim.frozen
        || prepared.canonical_request_bytes != claim.canonical_request_bytes
        || prepared.meaning_digest != claim.receipt.meaning_digest
        || Some(&prepared.execution_profile_seal) != claim.receipt.execution_profile_seal.as_ref()
        || project_composer_replay_view_v3(
            old_view,
            &composer,
            &artifact_family,
            &prepared,
            &claim.receipt.receipt_identity,
            &claim.receipt.seal_digest,
            claim.frozen.committed_at_epoch_ms,
        )? != *new_view
    {
        return Err(corrupt(
            "COMPOSER_V3 historical Replay/View projection differs",
        ));
    }
    let request_dto: ReplayRequestDtoV2 =
        serde_json::from_slice(&claim.canonical_request_bytes).map_err(unavailable)?;
    let request = ReplayRequestV2::try_from(request_dto).map_err(unavailable)?;
    Ok(Some(SealedExploratoryReplayReadbackV2 {
        request,
        canonical_request_bytes: claim.canonical_request_bytes,
        canonical_request_storage_digest: claim.request_storage_digest,
        product_edge_admission: proposal.admission.clone(),
        meaning_digest: claim.receipt.meaning_digest.clone(),
        receipt: super::into_receipt_v2(claim.receipt.clone()),
        canonical_receipt_bytes: claim.canonical_receipt_bytes,
        canonical_receipt_storage_digest: claim.receipt_storage_digest,
        canonical_outbox_bytes: claim.canonical_outbox_bytes,
        canonical_outbox_storage_digest: claim.outbox_storage_digest,
        execution_profile_seal: claim.receipt.execution_profile_seal,
        owner_cut_epoch_ms: claim.frozen.committed_at_epoch_ms,
    }))
}

async fn load_stored_claim(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
) -> Result<Option<StoredComposerReplayClaimV3>, ExploratoryReplayOwnerError> {
    let row = sqlx::query(
        "SELECT request_identity,request_digest,source_kind,composer_source_json,build_request_identity,attempt_identity,intent_identity,trial_family_identity,artifact_identity,build_receipt_identity,artifact_family_binding_identity,census_frontier_identity,frozen_json,receipt_json,lifecycle_state,committed_at_epoch_ms,v2_canonical_request_bytes,v2_request_storage_digest,v2_meaning_digest,v2_seal_digest,v2_receipt_json,v2_receipt_storage_bytes,v2_receipt_storage_digest,request_schema_version FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1 FOR SHARE",
    )
    .bind(&proposal.request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    let Some(row) = row else { return Ok(None) };
    if row.try_get::<String, _>("source_kind").map_err(storage)? != "COMPOSER_V3" {
        return Err(ExploratoryReplayOwnerError::ConflictingReplay);
    }
    let source: StoredComposerReplaySourceV3 = decode_exact(
        &row.try_get::<Value, _>("composer_source_json")
            .map_err(storage)?,
    )?;

    if source.proposal != *proposal {
        return Err(ExploratoryReplayOwnerError::ConflictingReplay);
    }
    let frozen: StoredComposerReplayFrozenV3 =
        decode_exact(&row.try_get::<Value, _>("frozen_json").map_err(storage)?)?;
    let composer_receipt: StoredComposerReplayReceiptV3 =
        decode_exact(&row.try_get::<Value, _>("receipt_json").map_err(storage)?)?;
    verify_composer_replay_frozen_v3(&frozen, &composer_receipt)?;
    if frozen.source != source
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != proposal.request_identity
        || row
            .try_get::<String, _>("request_digest")
            .map_err(storage)?
            != frozen.request_digest
        || row
            .try_get::<Option<String>, _>("build_request_identity")
            .map_err(storage)?
            .is_some()
        || row
            .try_get::<Option<String>, _>("attempt_identity")
            .map_err(storage)?
            .is_some()
        || row
            .try_get::<Option<String>, _>("build_receipt_identity")
            .map_err(storage)?
            .is_some()
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(storage)?
            != source.intent_identity
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != proposal.trial_family_identity
        || row
            .try_get::<String, _>("artifact_identity")
            .map_err(storage)?
            != proposal.artifact_identity
        || row
            .try_get::<String, _>("artifact_family_binding_identity")
            .map_err(storage)?
            != source.artifact_family_binding_identity
        || row
            .try_get::<String, _>("census_frontier_identity")
            .map_err(storage)?
            != source.census_frontier_identity
        || row
            .try_get::<String, _>("lifecycle_state")
            .map_err(storage)?
            != "FROZEN"
        || row
            .try_get::<i16, _>("request_schema_version")
            .map_err(storage)?
            != 2
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(corrupt("COMPOSER_V3 stored source mismatch"));
    }

    let canonical_request_bytes: Vec<u8> =
        row.try_get("v2_canonical_request_bytes").map_err(storage)?;
    let request_storage_digest: String =
        row.try_get("v2_request_storage_digest").map_err(storage)?;
    let meaning_digest: String = row.try_get("v2_meaning_digest").map_err(storage)?;
    let seal_digest: String = row.try_get("v2_seal_digest").map_err(storage)?;
    let receipt_json: Value = row.try_get("v2_receipt_json").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("v2_receipt_storage_bytes").map_err(storage)?;
    let receipt_storage_digest: String =
        row.try_get("v2_receipt_storage_digest").map_err(storage)?;
    let receipt: StoredReceiptV2 = decode_exact(&receipt_json)?;
    if receipt_bytes != serde_json::to_vec(&receipt).map_err(unavailable)?
        || serde_json::from_slice::<Value>(&receipt_bytes).map_err(unavailable)? != receipt_json
        || request_storage_digest
            != owner_storage_digest(REPLAY_REQUEST_STORAGE_DOMAIN_V1, &canonical_request_bytes)
        || receipt_storage_digest
            != owner_storage_digest(REPLAY_RECEIPT_STORAGE_DOMAIN_V1, &receipt_bytes)
        || meaning_digest != receipt.meaning_digest
        || seal_digest != receipt.seal_digest
        || receipt.execution_profile_seal.is_none()
    {
        return Err(corrupt("COMPOSER_V3 canonical Replay bytes mismatch"));
    }
    let prepared = PreparedSealV2 {
        canonical_request_bytes: canonical_request_bytes.clone(),
        meaning_digest,
        execution_profile_seal: receipt.execution_profile_seal.clone(),
    };
    verify_v2_seal(
        &prepared,
        &receipt,
        ReplaySealBindingV2 {
            request_identity: &proposal.request_identity,
            request_digest: &frozen.request_digest,
            execution_profile_seal: receipt.execution_profile_seal.as_ref(),
            committed_at_epoch_ms: frozen.committed_at_epoch_ms,
        },
    )?;
    let (canonical_outbox_bytes, outbox_storage_digest) =
        verify_outbox(transaction, &frozen, &receipt).await?;
    let transition = load_research_transition(transaction, &frozen, &receipt).await?;
    Ok(Some(StoredComposerReplayClaimV3 {
        frozen,
        receipt,
        canonical_request_bytes,
        request_storage_digest,
        canonical_receipt_bytes: receipt_bytes,
        receipt_storage_digest,
        canonical_outbox_bytes,
        outbox_storage_digest,
        transition,
    }))
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    frozen: &StoredComposerReplayFrozenV3,
    receipt: &StoredReceiptV2,
) -> Result<(Vec<u8>, String), ExploratoryReplayOwnerError> {
    let rows = sqlx::query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE",
    )
    .bind(&frozen.source.proposal.request_identity)
    .bind(EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if rows.len() != 1 {
        return Err(corrupt("COMPOSER_V3 Replay outbox cardinality mismatch"));
    }
    let row = &rows[0];
    let expected_payload = StoredOutboxV2 {
        schema_version: receipt.schema_version,
        request_identity: receipt.request_identity.clone(),
        meaning_digest: receipt.meaning_digest.clone(),
        seal_digest: receipt.seal_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        lineage_request_digest: frozen.request_digest.clone(),
        execution_profile_seal: receipt.execution_profile_seal.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let payload_bytes = serde_json::to_vec(&expected_payload).map_err(unavailable)?;
    let payload_json = serde_json::to_value(&expected_payload).map_err(unavailable)?;
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &expected_payload)?;
    let expected_envelope = LockedOutboxRowV1 {
        event_identity: identity("rd-owner-event-v1", &payload_digest),
        aggregate_identity: receipt.request_identity.clone(),
        event_kind: EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2.into(),
        payload_digest,
        payload_json: payload_json.clone(),
        committed_at_epoch_ms: frozen.committed_at_epoch_ms,
    };
    let envelope_bytes = serde_json::to_vec(&expected_envelope).map_err(unavailable)?;

    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != expected_envelope.event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != expected_envelope.aggregate_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)? != expected_envelope.event_kind
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != expected_envelope.payload_digest
        || row.try_get::<Value, _>("payload_json").map_err(storage)? != payload_json
        || row
            .try_get::<Vec<u8>, _>("canonical_payload_bytes")
            .map_err(storage)?
            != payload_bytes
        || row
            .try_get::<String, _>("canonical_payload_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(REPLAY_OUTBOX_STORAGE_DOMAIN_V1, &payload_bytes)
        || row
            .try_get::<Vec<u8>, _>("canonical_envelope_bytes")
            .map_err(storage)?
            != envelope_bytes
        || row
            .try_get::<String, _>("canonical_envelope_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, &envelope_bytes)
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(corrupt("COMPOSER_V3 Replay outbox mismatch"));
    }
    Ok((
        envelope_bytes.clone(),
        owner_storage_digest(REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, &envelope_bytes),
    ))
}

async fn load_research_transition(
    transaction: &mut Transaction<'_, Postgres>,
    frozen: &StoredComposerReplayFrozenV3,
    receipt: &StoredReceiptV2,
) -> Result<StoredResearchViewTransitionV3, ExploratoryReplayOwnerError> {
    let rows = sqlx::query("SELECT replay_request_identity,research_request_identity,intent_identity,transition_digest,old_view_json,new_view_json,transition_json,committed_at_epoch_ms FROM public.rd_research_view_transitions_v3 WHERE replay_request_identity=$1 FOR SHARE")
        .bind(&frozen.source.proposal.request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(corrupt(
            "COMPOSER_V3 Research transition cardinality mismatch",
        ));
    }
    let row = &rows[0];
    let transition: StoredResearchViewTransitionV3 = decode_exact(
        &row.try_get::<Value, _>("transition_json")
            .map_err(storage)?,
    )?;
    verify_research_view_transition_v3(&transition, receipt)?;
    let initial = &frozen.pre_transition_research_view;
    let view = &transition.new_view;
    if transition.old_view != *initial
        || row
            .try_get::<String, _>("replay_request_identity")
            .map_err(storage)?
            != transition.replay_request_identity
        || row
            .try_get::<String, _>("research_request_identity")
            .map_err(storage)?
            != initial.request_identity
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(storage)?
            != initial.intent_identity
        || row
            .try_get::<String, _>("transition_digest")
            .map_err(storage)?
            != transition.transition_digest
        || row.try_get::<Value, _>("old_view_json").map_err(storage)?
            != serde_json::to_value(initial).map_err(unavailable)?
        || row.try_get::<Value, _>("new_view_json").map_err(storage)?
            != serde_json::to_value(view).map_err(unavailable)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(corrupt("COMPOSER_V3 Research transition row mismatch"));
    }
    let source = &frozen.source;
    let Some(exploration) = view.exploration.as_ref() else {
        return Err(corrupt("COMPOSER_V3 Research exploration is missing"));
    };
    let Some(composer) = view.composer_artifact.as_ref() else {
        return Err(corrupt(
            "COMPOSER_V3 Research Composer reference is missing",
        ));
    };

    if view.request_identity != initial.request_identity
        || view.intent_identity != initial.intent_identity
        || !composer_exploration_research_view_is_valid_v3(view, initial)
        || exploration.trial_family_identity != source.proposal.trial_family_identity
        || exploration.census_frontier_identity != source.census_frontier_identity
        || exploration.census_frontier_digest != source.census_frontier_digest
        || exploration.replay_request_identity != source.proposal.request_identity
        || composer.artifact_locator != source.proposal.artifact_identity
        || composer.composer_request_identity != source.proposal.composer_locator.request_identity
        || composer.artifact_family_binding_identity != source.artifact_family_binding_identity
        || composer.artifact_family_binding_digest != source.artifact_family_binding_digest
        || composer.artifact_family_binding_receipt_identity
            != source.artifact_family_binding_receipt_identity
        || composer.trial_family_identity != source.proposal.trial_family_identity
        || composer.census_frontier_identity != source.census_frontier_identity
        || composer.census_frontier_digest != source.census_frontier_digest
    {
        return Err(corrupt("COMPOSER_V3 Research View projection mismatch"));
    }
    verify_research_transition_outbox(transaction, &transition).await?;
    Ok(transition)
}

async fn verify_research_transition_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    transition: &StoredResearchViewTransitionV3,
) -> Result<(), ExploratoryReplayOwnerError> {
    let rows = sqlx::query("SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(&transition.replay_request_identity)
        .bind(RESEARCH_VIEW_TRANSITION_EVENT_V3)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(corrupt(
            "COMPOSER_V3 Research transition outbox cardinality mismatch",
        ));
    }
    let payload = StoredResearchViewTransitionOutboxV3 {
        schema_version: 3,
        replay_request_identity: transition.replay_request_identity.clone(),
        research_request_identity: transition.research_request_identity.clone(),
        intent_identity: transition.intent_identity.clone(),
        replay_receipt_identity: transition.replay_receipt_identity.clone(),
        replay_seal_digest: transition.replay_seal_digest.clone(),
        transition_digest: transition.transition_digest.clone(),
        committed_at_epoch_ms: transition.committed_at_epoch_ms,
    };
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    let payload_bytes = serde_json::to_vec(&payload).map_err(unavailable)?;
    let expected_envelope = LockedOutboxRowV1 {
        event_identity: identity("rd-owner-event-v1", &payload_digest),
        aggregate_identity: transition.replay_request_identity.clone(),
        event_kind: RESEARCH_VIEW_TRANSITION_EVENT_V3.into(),
        payload_digest: payload_digest.clone(),
        payload_json: serde_json::to_value(&payload).map_err(unavailable)?,
        committed_at_epoch_ms: transition.committed_at_epoch_ms,
    };
    let envelope_bytes = serde_json::to_vec(&expected_envelope).map_err(unavailable)?;
    let row = &rows[0];
    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != expected_envelope.event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != transition.replay_request_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != RESEARCH_VIEW_TRANSITION_EVENT_V3
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row.try_get::<Value, _>("payload_json").map_err(storage)?
            != serde_json::to_value(&payload).map_err(unavailable)?
        || row
            .try_get::<Vec<u8>, _>("canonical_payload_bytes")
            .map_err(storage)?
            != payload_bytes
        || row
            .try_get::<String, _>("canonical_payload_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(REPLAY_OUTBOX_STORAGE_DOMAIN_V1, &payload_bytes)
        || row
            .try_get::<Vec<u8>, _>("canonical_envelope_bytes")
            .map_err(storage)?
            != envelope_bytes
        || row
            .try_get::<String, _>("canonical_envelope_storage_digest")
            .map_err(storage)?
            != owner_storage_digest(REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1, &envelope_bytes)
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(transition.committed_at_epoch_ms).map_err(unavailable)?
    {
        return Err(corrupt("COMPOSER_V3 Research transition outbox mismatch"));
    }
    Ok(())
}

fn corrupt(message: &str) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::Unavailable(message.into())
}
