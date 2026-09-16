//! First-write custody for a Composer-backed exploratory Replay.
//!
//! The Composer source is its own lineage. No plugin Build Receipt is promoted to a legacy
//! Artifact Build attempt, receipt, or review.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};

use super::{
    LockedOutboxRowV1, PreparedSealV2, ReplaySealBindingV2, StoredOutboxV2, assemble_v2,
    canonical_digest, identity, seal_v2, storage, unavailable,
};
use crate::{
    composer_artifact_family_binding_v3::{
        ensure_composer_artifact_family_binding_for_replay_v3,
        load_composer_artifact_family_binding_for_replay_v3,
    },
    composer_replay_intent_v3::resolve_composer_replay_intent_in_transaction,
    exploratory_replay::{
        ComposerBackedExploratoryReplayProposalV3, EXPLORATORY_REPLAY_MUTATION_EFFECT_V3,
        EXPLORATORY_REPLAY_OPERATION_V3, EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2,
        EXPLORATORY_REPLAY_SCHEMA_V3, ExploratoryReplayCommitResultV2, ExploratoryReplayOwnerError,
        composition_v3::{
            prepare_composer_backed_replay_v3, prepare_composer_replay_seal_v3,
            project_composer_replay_view_v3, verify_composer_replay_frozen_v3,
        },
        exploratory_replay_admission_payload_v3,
    },
    product_edge::{
        RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, ResearchViewAvailability, ResearchViewPhase,
        ResearchViewV1, canonical_research_view_identity_v2,
    },
    source_research_composer_postgres_v2::{
        SealedSourceResearchComposerBindingOwnerV2, read_sealed_accepted_for_replay_in_transaction,
    },
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

pub(super) const RESEARCH_VIEW_TRANSITION_EVENT_V3: &str = "RESEARCH_EXPLORATION_VIEW_ADVANCED_V3";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_research_view_transitions_v3",
        runtime_read_grantees: &["rd_exploratory_replay_api_owner"],
        columns: &[
            crate::schema_materialization::required("replay_request_identity", "text"),
            crate::schema_materialization::required("research_request_identity", "text"),
            crate::schema_materialization::required("intent_identity", "text"),
            crate::schema_materialization::required("transition_digest", "text"),
            crate::schema_materialization::required("old_view_json", "jsonb"),
            crate::schema_materialization::required("new_view_json", "jsonb"),
            crate::schema_materialization::required("transition_json", "jsonb"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:replay_request_identity:public.rd_sealed_exploratory_replay_requests_v1(request_identity):a:a:s:false:false:true:",
            "p:replay_request_identity:::false:false:true:",
            "u:transition_digest:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("replay_request_identity"),
            crate::schema_materialization::unique_index("transition_digest"),
        ],
    },
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredResearchViewTransitionV3 {
    pub(super) schema_version: u16,
    pub(super) replay_request_identity: String,
    pub(super) research_request_identity: String,
    pub(super) intent_identity: String,
    pub(super) replay_meaning_digest: String,
    pub(super) replay_receipt_identity: String,
    pub(super) replay_seal_digest: String,
    pub(super) old_view: ResearchViewV1,
    pub(super) new_view: ResearchViewV1,
    pub(super) committed_at_epoch_ms: u64,
    pub(super) transition_digest: String,
}

#[derive(Serialize)]
struct ResearchViewTransitionMeaningV3<'a> {
    schema_version: u16,
    replay_request_identity: &'a str,
    research_request_identity: &'a str,
    intent_identity: &'a str,
    replay_meaning_digest: &'a str,
    replay_receipt_identity: &'a str,
    replay_seal_digest: &'a str,
    old_view: &'a ResearchViewV1,
    new_view: &'a ResearchViewV1,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredResearchViewTransitionOutboxV3 {
    pub(super) schema_version: u16,
    pub(super) replay_request_identity: String,
    pub(super) research_request_identity: String,
    pub(super) intent_identity: String,
    pub(super) replay_receipt_identity: String,
    pub(super) replay_seal_digest: String,
    pub(super) transition_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

pub(super) fn issue_research_view_transition_v3(
    old_view: ResearchViewV1,
    new_view: ResearchViewV1,
    receipt: &super::StoredReceiptV2,
) -> Result<StoredResearchViewTransitionV3, ExploratoryReplayOwnerError> {
    let digest = canonical_digest(
        "rd.research-view-transition.v3",
        &ResearchViewTransitionMeaningV3 {
            schema_version: 3,
            replay_request_identity: &receipt.request_identity,
            research_request_identity: &old_view.request_identity,
            intent_identity: &old_view.intent_identity,
            replay_meaning_digest: &receipt.meaning_digest,
            replay_receipt_identity: &receipt.receipt_identity,
            replay_seal_digest: &receipt.seal_digest,
            old_view: &old_view,
            new_view: &new_view,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        },
    )?;
    Ok(StoredResearchViewTransitionV3 {
        schema_version: 3,
        replay_request_identity: receipt.request_identity.clone(),
        research_request_identity: old_view.request_identity.clone(),
        intent_identity: old_view.intent_identity.clone(),
        replay_meaning_digest: receipt.meaning_digest.clone(),
        replay_receipt_identity: receipt.receipt_identity.clone(),
        replay_seal_digest: receipt.seal_digest.clone(),
        old_view,
        new_view,
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        transition_digest: digest,
    })
}

pub(super) fn verify_research_view_transition_v3(
    stored: &StoredResearchViewTransitionV3,
    receipt: &super::StoredReceiptV2,
) -> Result<(), ExploratoryReplayOwnerError> {
    let expected = issue_research_view_transition_v3(
        stored.old_view.clone(),
        stored.new_view.clone(),
        receipt,
    )?;
    if stored != &expected
        || stored.old_view.phase != ResearchViewPhase::IntentFrozen
        || stored.new_view.phase != ResearchViewPhase::ExplorationActive
        || stored.old_view.intent_identity != stored.new_view.intent_identity
        || stored.old_view.request_identity != stored.new_view.request_identity
        || stored
            .new_view
            .exploration
            .as_ref()
            .is_none_or(|exploration| {
                exploration.replay_request_identity != receipt.request_identity
                    || exploration.replay_request_meaning_digest != receipt.meaning_digest
                    || exploration.replay_receipt_identity != receipt.receipt_identity
                    || exploration.replay_request_seal_digest != receipt.seal_digest
            })
    {
        return Err(unavailable(
            "Composer Research View transition custody mismatch",
        ));
    }
    Ok(())
}

pub(super) async fn migrate_composer_research_view_transitions_v3(
    pool: &PgPool,
) -> Result<(), ExploratoryReplayOwnerError> {
    sqlx::query("CREATE TABLE IF NOT EXISTS public.rd_research_view_transitions_v3 (replay_request_identity TEXT PRIMARY KEY REFERENCES public.rd_sealed_exploratory_replay_requests_v1(request_identity), research_request_identity TEXT NOT NULL, intent_identity TEXT NOT NULL, transition_digest TEXT NOT NULL UNIQUE, old_view_json JSONB NOT NULL, new_view_json JSONB NOT NULL, transition_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
        .execute(pool)
        .await
        .map_err(storage)?;
    sqlx::query("ALTER TABLE public.rd_research_view_transitions_v3 OWNER TO rd_owner")
        .execute(pool)
        .await
        .map_err(storage)?;
    sqlx::query("REVOKE ALL ON TABLE public.rd_research_view_transitions_v3 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer")
        .execute(pool)
        .await
        .map_err(storage)?;
    sqlx::query("GRANT SELECT ON TABLE public.rd_research_view_transitions_v3 TO rd_exploratory_replay_api_owner")
        .execute(pool)
        .await
        .map_err(storage)?;
    Ok(())
}

/// Commits one exact Composer Replay request. The first read follows the request advisory lock;
/// an existing request never re-enters the current first-mutation admission path.
pub(crate) async fn commit_composer_v3(
    pool: &PgPool,
    proposal: ComposerBackedExploratoryReplayProposalV3,
) -> Result<ExploratoryReplayCommitResultV2, ExploratoryReplayOwnerError> {
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(&proposal.request_identity)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

    if let Some(existing) =
        super::composer_readback_v3::resolve_existing_composer_v3_in_transaction(
            &mut transaction,
            &proposal,
        )
        .await?
    {
        let result = existing_to_commit_result(existing);
        transaction.commit().await.map_err(storage)?;
        return Ok(result);
    }

    // Binding is an independently committed R&D Owner fact. Release the request lock before
    // issuing it in its own transaction, then lock and recheck the request on the new cut.
    transaction.rollback().await.map_err(storage)?;
    ensure_composer_artifact_family_binding_for_replay_v3(
        pool,
        &proposal,
        &SealedSourceResearchComposerBindingOwnerV2,
    )
    .await
    .map_err(unavailable)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(&proposal.request_identity)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    if let Some(existing) =
        super::composer_readback_v3::resolve_existing_composer_v3_in_transaction(
            &mut transaction,
            &proposal,
        )
        .await?
    {
        let result = existing_to_commit_result(existing);
        transaction.commit().await.map_err(storage)?;
        return Ok(result);
    }

    let first_cut = database_now_epoch_ms(&mut transaction).await?;
    let admission = resolve_admission_for_downstream_in_transaction(
        &mut transaction,
        &proposal.admission,
        DownstreamAdmissionModeV1::FirstMutation {
            read_cut_epoch_ms: first_cut,
        },
    )
    .await
    .map_err(unavailable)?;
    verify_admission(&admission, &proposal, first_cut)?;

    let census = load_trial_family_census_v2_by_family_in_transaction(
        &mut transaction,
        &proposal.trial_family_identity,
    )
    .await
    .map_err(unavailable)?;
    let composer = read_sealed_accepted_for_replay_in_transaction(
        &mut transaction,
        &proposal.composer_locator,
        first_cut,
    )
    .await
    .map_err(unavailable)?;
    let intent =
        resolve_composer_replay_intent_in_transaction(&mut transaction, &census, &composer).await?;
    let artifact_family = load_composer_artifact_family_binding_for_replay_v3(
        &mut transaction,
        &census,
        &intent,
        &composer,
    )
    .await
    .map_err(unavailable)?
    .ok_or_else(|| unavailable("Composer Artifact-family binding is unavailable"))?;
    let market = vibe_data::owner::replay_market_facts_v2::resolve_bound_replay_cut_for_rd_in_transaction_v1(
        &mut transaction,
        proposal.market_data_locator,
    )
    .await
    .map_err(unavailable)?;
    let old_view = lock_exact_research_view(&mut transaction, &intent, &composer).await?;
    if old_view.availability != ResearchViewAvailability::Available
        || old_view.phase != ResearchViewPhase::IntentFrozen
        || old_view.intent_identity != intent.identity()
        || old_view.projection_identity != canonical_research_view_identity_v2(&old_view)
        || first_cut >= old_view.valid_through_epoch_ms
        || admission.effective_principal() != old_view.trusted_principal
        || admission.authorized_scope() != old_view.authorized_scope
        || admission.authorization().frontier().frontier_identity()
            != old_view.authorization_policy_cut
    {
        return Err(unavailable(
            "Composer Research View preimage is unavailable",
        ));
    }
    let final_cut = database_now_epoch_ms(&mut transaction).await?;
    verify_admission(&admission, &proposal, final_cut)?;
    if final_cut >= old_view.valid_through_epoch_ms {
        return Err(unavailable(
            "Composer Research View expired before Replay commit",
        ));
    }
    let composed = prepare_composer_backed_replay_v3(
        &proposal,
        &census,
        &intent,
        &composer,
        &artifact_family,
        &market,
    )?;
    let prepared = prepare_composer_replay_seal_v3(
        composed,
        &census,
        old_view.clone(),
        admission.request().semantic_digest().map_err(unavailable)?,
        final_cut,
    )?;
    verify_composer_replay_frozen_v3(&prepared.frozen, &prepared.receipt)?;
    let (v2_prepared, v2_receipt) = seal_v2(
        PreparedSealV2 {
            canonical_request_bytes: prepared.canonical_request_bytes.clone(),
            meaning_digest: prepared.meaning_digest.clone(),
            execution_profile_seal: Some(prepared.execution_profile_seal.clone()),
        },
        ReplaySealBindingV2 {
            request_identity: &proposal.request_identity,
            request_digest: &prepared.frozen.request_digest,
            execution_profile_seal: Some(&prepared.execution_profile_seal),
            committed_at_epoch_ms: final_cut,
        },
    )?;
    let new_view = project_composer_replay_view_v3(
        &old_view,
        &composer,
        &artifact_family,
        &prepared,
        &v2_receipt.receipt_identity,
        &v2_receipt.seal_digest,
        final_cut,
    )?;

    persist_composer_replay_row(&mut transaction, &prepared, &v2_receipt).await?;
    update_exact_research_view(&mut transaction, &old_view, &new_view, &intent).await?;
    let transition = issue_research_view_transition_v3(old_view, new_view, &v2_receipt)?;
    verify_research_view_transition_v3(&transition, &v2_receipt)?;
    persist_research_view_transition(&mut transaction, &transition).await?;
    persist_v2_outbox(&mut transaction, &prepared, &v2_receipt).await?;
    persist_research_view_transition_outbox(&mut transaction, &transition).await?;
    // A first write is not deliverable until the very same exact historical read port can
    // reconstruct it. Any missing Owner evidence rolls the entire transaction back.
    let sealed = super::composer_readback_v3::resolve_existing_composer_v3_in_transaction(
        &mut transaction,
        &proposal,
    )
    .await?
    .ok_or_else(|| unavailable("Composer Replay post-write readback is unavailable"))?;
    if sealed.canonical_request_bytes() != prepared.canonical_request_bytes
        || sealed.meaning_digest() != v2_receipt.meaning_digest
        || sealed.receipt.receipt_identity != v2_receipt.receipt_identity
        || sealed.receipt.seal_digest != v2_receipt.seal_digest
        || sealed.receipt.committed_at_epoch_ms != v2_receipt.committed_at_epoch_ms
        || sealed.product_edge_admission() != &proposal.admission
    {
        return Err(unavailable("Composer Replay post-write readback mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(assemble_v2(v2_prepared, v2_receipt))
}

fn existing_to_commit_result(
    readback: crate::exploratory_replay::SealedExploratoryReplayReadbackV2,
) -> ExploratoryReplayCommitResultV2 {
    let receipt = super::StoredReceiptV2 {
        schema_version: readback.receipt.schema_version,
        receipt_identity: readback.receipt.receipt_identity.clone(),
        request_identity: readback.request_identity().to_owned(),
        meaning_digest: readback.meaning_digest.clone(),
        seal_digest: readback.receipt.seal_digest.clone(),
        execution_profile_seal: readback.execution_profile_seal.clone(),
        committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms,
    };
    assemble_v2(
        PreparedSealV2 {
            canonical_request_bytes: readback.canonical_request_bytes,
            meaning_digest: readback.meaning_digest,
            execution_profile_seal: readback.execution_profile_seal,
        },
        receipt,
    )
}

fn verify_admission(
    admission: &ProductEdgeAdmissionReadbackV1,
    proposal: &ComposerBackedExploratoryReplayProposalV3,
    now: u64,
) -> Result<(), ExploratoryReplayOwnerError> {
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
        || !admission.authorizes_first_mutation_at(now)
    {
        return Err(unavailable(
            "canonical Product Edge Replay V3 admission mismatch",
        ));
    }
    Ok(())
}

async fn database_now_epoch_ms(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, ExploratoryReplayOwnerError> {
    let value: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    u64::try_from(value).map_err(unavailable)
}

async fn lock_exact_research_view(
    transaction: &mut Transaction<'_, Postgres>,
    intent: &crate::composer_replay_intent_v3::ComposerReplayIntentV3,
    composer: &crate::develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
) -> Result<ResearchViewV1, ExploratoryReplayOwnerError> {
    let sql = if intent.identity().starts_with("rd-research-intent-v2-") {
        "SELECT view_json,receipt_json,intent_json FROM public.rd_research_request_receipts_v1 WHERE intent_json->>'intent_identity'=$1 FOR UPDATE"
    } else if intent
        .identity()
        .starts_with("rd-successor-research-intent-v1-")
    {
        "SELECT view_json,receipt_json,intent_json FROM public.rd_successor_research_intents_v1 WHERE intent_identity=$1 FOR UPDATE"
    } else {
        return Err(unavailable("Composer Research Intent type is unavailable"));
    };
    let rows = sqlx::query(sql)
        .bind(intent.identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(unavailable("exact Composer Research View is unavailable"));
    }
    let row = &rows[0];
    let view_json: serde_json::Value = row.try_get("view_json").map_err(storage)?;
    let intent_json: serde_json::Value = row.try_get("intent_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let view: ResearchViewV1 = serde_json::from_value(view_json).map_err(unavailable)?;
    if intent_json["intent_identity"] != intent.identity()
        || receipt_json["request_identity"] != view.request_identity
        || view.intent_identity != intent.identity()
    {
        return Err(unavailable("Composer Research View lineage mismatch"));
    }
    let mut digest = Sha256::new();
    digest.update(b"rd.develop.request-identity.v2\0");
    digest.update(view.request_identity.as_bytes());
    let digest_bytes: [u8; 32] = digest.finalize().into();
    if &digest_bytes != composer.research_request_identity().as_bytes() {
        return Err(unavailable("Composer Research request identity mismatch"));
    }
    Ok(view)
}

async fn update_exact_research_view(
    transaction: &mut Transaction<'_, Postgres>,
    old_view: &ResearchViewV1,
    new_view: &ResearchViewV1,
    intent: &crate::composer_replay_intent_v3::ComposerReplayIntentV3,
) -> Result<(), ExploratoryReplayOwnerError> {
    let old_json = serde_json::to_value(old_view).map_err(unavailable)?;
    let new_json = serde_json::to_value(new_view).map_err(unavailable)?;
    let sql = if intent.identity().starts_with("rd-research-intent-v2-") {
        "UPDATE public.rd_research_request_receipts_v1 SET view_json=$1 WHERE request_identity=$2 AND intent_json->>'intent_identity'=$3 AND view_json=$4"
    } else {
        "UPDATE public.rd_successor_research_intents_v1 SET view_json=$1 WHERE request_identity=$2 AND intent_identity=$3 AND view_json=$4"
    };
    let updated = sqlx::query(sql)
        .bind(new_json)
        .bind(&old_view.request_identity)
        .bind(intent.identity())
        .bind(old_json)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    if updated.rows_affected() != 1 {
        return Err(unavailable(
            "Composer Research View changed before Replay commit",
        ));
    }
    Ok(())
}

async fn persist_composer_replay_row(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &crate::exploratory_replay::composition_v3::PreparedComposerReplaySealV3,
    receipt: &super::StoredReceiptV2,
) -> Result<(), ExploratoryReplayOwnerError> {
    let frozen = &prepared.frozen;
    let source = &frozen.source;
    let receipt_bytes = serde_json::to_vec(receipt).map_err(unavailable)?;
    let receipt_json =
        serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(unavailable)?;
    let request_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        crate::native_replay_rd_sources_v2::REPLAY_REQUEST_STORAGE_DOMAIN_V1,
        &prepared.canonical_request_bytes,
    );
    let receipt_storage_digest = crate::native_replay_rd_sources_v2::owner_storage_digest(
        crate::native_replay_rd_sources_v2::REPLAY_RECEIPT_STORAGE_DOMAIN_V1,
        &receipt_bytes,
    );
    sqlx::query("INSERT INTO public.rd_sealed_exploratory_replay_requests_v1 (request_identity,request_digest,source_kind,composer_source_json,build_request_identity,attempt_identity,intent_identity,trial_family_identity,artifact_identity,build_receipt_identity,artifact_family_binding_identity,census_frontier_identity,frozen_json,receipt_json,lifecycle_state,committed_at_epoch_ms,v2_canonical_request_bytes,v2_request_storage_digest,v2_meaning_digest,v2_seal_digest,v2_receipt_json,v2_receipt_storage_bytes,v2_receipt_storage_digest,request_schema_version) VALUES ($1,$2,'COMPOSER_V3',$3,NULL,NULL,$4,$5,$6,NULL,$7,$8,$9,$10,'FROZEN',$11,$12,$13,$14,$15,$16,$17,$18,2)")
        .bind(&source.proposal.request_identity)
        .bind(&frozen.request_digest)
        .bind(serde_json::to_value(source).map_err(unavailable)?)
        .bind(&source.intent_identity)
        .bind(&source.proposal.trial_family_identity)
        .bind(&source.proposal.artifact_identity)
        .bind(&source.artifact_family_binding_identity)
        .bind(&source.census_frontier_identity)
        .bind(serde_json::to_value(frozen).map_err(unavailable)?)
        .bind(serde_json::to_value(&prepared.receipt).map_err(unavailable)?)
        .bind(i64::try_from(frozen.committed_at_epoch_ms).map_err(unavailable)?)
        .bind(&prepared.canonical_request_bytes)
        .bind(request_storage_digest)
        .bind(&prepared.meaning_digest)
        .bind(&receipt.seal_digest)
        .bind(receipt_json)
        .bind(receipt_bytes)
        .bind(receipt_storage_digest)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn persist_v2_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &crate::exploratory_replay::composition_v3::PreparedComposerReplaySealV3,
    receipt: &super::StoredReceiptV2,
) -> Result<(), ExploratoryReplayOwnerError> {
    let payload = StoredOutboxV2 {
        schema_version: receipt.schema_version,
        request_identity: receipt.request_identity.clone(),
        meaning_digest: receipt.meaning_digest.clone(),
        seal_digest: receipt.seal_digest.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
        lineage_request_digest: prepared.frozen.request_digest.clone(),
        execution_profile_seal: receipt.execution_profile_seal.clone(),
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
    };
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    let payload_bytes = serde_json::to_vec(&payload).map_err(unavailable)?;
    let payload_json =
        serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(unavailable)?;
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let envelope = LockedOutboxRowV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: receipt.request_identity.clone(),
        event_kind: EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2.to_owned(),
        payload_digest: payload_digest.clone(),
        payload_json: payload_json.clone(),
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(unavailable)?;
    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(event_identity)
        .bind(&receipt.request_identity)
        .bind(EXPLORATORY_REPLAY_REQUEST_FROZEN_EVENT_V2)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(&payload_bytes)
        .bind(crate::native_replay_rd_sources_v2::owner_storage_digest(
            crate::native_replay_rd_sources_v2::REPLAY_OUTBOX_STORAGE_DOMAIN_V1,
            &payload_bytes,
        ))
        .bind(&envelope_bytes)
        .bind(crate::native_replay_rd_sources_v2::owner_storage_digest(
            crate::native_replay_rd_sources_v2::REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1,
            &envelope_bytes,
        ))
        .bind(i64::try_from(receipt.committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn persist_research_view_transition(
    transaction: &mut Transaction<'_, Postgres>,
    transition: &StoredResearchViewTransitionV3,
) -> Result<(), ExploratoryReplayOwnerError> {
    sqlx::query("INSERT INTO public.rd_research_view_transitions_v3 (replay_request_identity,research_request_identity,intent_identity,transition_digest,old_view_json,new_view_json,transition_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&transition.replay_request_identity)
        .bind(&transition.research_request_identity)
        .bind(&transition.intent_identity)
        .bind(&transition.transition_digest)
        .bind(serde_json::to_value(&transition.old_view).map_err(unavailable)?)
        .bind(serde_json::to_value(&transition.new_view).map_err(unavailable)?)
        .bind(serde_json::to_value(transition).map_err(unavailable)?)
        .bind(i64::try_from(transition.committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn persist_research_view_transition_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    transition: &StoredResearchViewTransitionV3,
) -> Result<(), ExploratoryReplayOwnerError> {
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
    let event_identity = identity("rd-owner-event-v1", &payload_digest);
    let payload_bytes = serde_json::to_vec(&payload).map_err(unavailable)?;
    let payload_json =
        serde_json::from_slice::<serde_json::Value>(&payload_bytes).map_err(unavailable)?;
    let envelope = LockedOutboxRowV1 {
        event_identity: event_identity.clone(),
        aggregate_identity: transition.replay_request_identity.clone(),
        event_kind: RESEARCH_VIEW_TRANSITION_EVENT_V3.to_owned(),
        payload_digest: payload_digest.clone(),
        payload_json: payload_json.clone(),
        committed_at_epoch_ms: transition.committed_at_epoch_ms,
    };
    let envelope_bytes = serde_json::to_vec(&envelope).map_err(unavailable)?;
    sqlx::query("INSERT INTO public.rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(event_identity)
        .bind(&transition.replay_request_identity)
        .bind(RESEARCH_VIEW_TRANSITION_EVENT_V3)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(&payload_bytes)
        .bind(crate::native_replay_rd_sources_v2::owner_storage_digest(
            crate::native_replay_rd_sources_v2::REPLAY_OUTBOX_STORAGE_DOMAIN_V1,
            &payload_bytes,
        ))
        .bind(&envelope_bytes)
        .bind(crate::native_replay_rd_sources_v2::owner_storage_digest(
            crate::native_replay_rd_sources_v2::REPLAY_OUTBOX_ENVELOPE_STORAGE_DOMAIN_V1,
            &envelope_bytes,
        ))
        .bind(i64::try_from(transition.committed_at_epoch_ms).map_err(unavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}
