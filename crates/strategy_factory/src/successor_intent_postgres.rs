//! PostgreSQL custody for Decision-selected successor Research Intents.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};
use vibe_qualification::{
    PostgresQualificationOwnerV1, ProtectedFeedbackFrontierReadbackV1, RdIndependenceBasisLocatorV1,
};

use crate::{
    iteration_decision::{
        CandidateComparisonDecisionReadbackV1, IterationDecisionOutcomeV1,
        is_valid_iteration_decision_locator_v1,
    },
    product_edge::{
        FrozenResearchGoalIntent, RESEARCH_OWNER_V1, ResearchGoalOwnerError,
        ResearchNextLegalAction, ResearchViewAvailability, ResearchViewPhase, ResearchViewV1,
        canonical_research_view_identity_v2,
    },
    rd_owner_postgres_custody::{
        ResearchCustodyLookupV1, admit_independence_basis_by_identity_in_transaction,
        admit_research_custody_in_transaction, validate_historical_view,
    },
    successor_intent::{
        FrozenSuccessorResearchIntentV1, SuccessorResearchIntentCompositionRequestV1,
        SuccessorResearchIntentErrorV1, SuccessorResearchIntentReadbackV1,
        SuccessorResearchIntentSourceV1, admit_stored_successor_research_intent_v1,
        issue_successor_research_intent_v1, successor_research_intent_semantic_digest_v1,
        verify_successor_research_intent_admission_v1,
    },
    trial_family::{TrialFamilyCensusReadbackV2, TrialFamilyError},
};

const SUCCESSOR_INTENT_COMMITTED_EVENT_V1: &str = "SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1";

pub(crate) const TABLES: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_successor_research_intents_v1",
        runtime_read_grantees: &["rd_exploratory_replay_api_owner"],
        columns: &[
            crate::schema_materialization::required("intent_identity", "text"),
            crate::schema_materialization::required("intent_digest", "text"),
            crate::schema_materialization::required("request_identity", "text"),
            crate::schema_materialization::required("decision_identity", "text"),
            crate::schema_materialization::required("result_identity", "text"),
            crate::schema_materialization::required("trial_family_identity", "text"),
            crate::schema_materialization::required("predecessor_intent_identity", "text"),
            crate::schema_materialization::required("request_json", "jsonb"),
            crate::schema_materialization::required("intent_json", "jsonb"),
            crate::schema_materialization::required("receipt_json", "jsonb"),
            crate::schema_materialization::required("request_storage_bytes", "bytea"),
            crate::schema_materialization::required("request_storage_digest", "text"),
            crate::schema_materialization::required("intent_storage_bytes", "bytea"),
            crate::schema_materialization::required("intent_storage_digest", "text"),
            crate::schema_materialization::required("receipt_storage_bytes", "bytea"),
            crate::schema_materialization::required("receipt_storage_digest", "text"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
            crate::schema_materialization::optional("request_semantic_digest", "text"),
            crate::schema_materialization::optional("admission_lineage_digest", "text"),
            crate::schema_materialization::optional("effective_principal", "text"),
            crate::schema_materialization::optional("authorized_scope_json", "jsonb"),
            crate::schema_materialization::optional("view_json", "jsonb"),
            crate::schema_materialization::optional("artifact_evidence_digest", "text"),
            crate::schema_materialization::optional("artifact_evidence_json", "jsonb"),
        ],
        constraints: &[
            "f:decision_identity:public.rd_iteration_decisions_v1(decision_identity):a:a:s:false:false:true:",
            "f:trial_family_identity:public.rd_trial_families_v1(trial_family_identity):a:a:s:false:false:true:",
            "p:intent_identity:::false:false:true:",
            "u:request_identity:::false:false:true:",
            "u:decision_identity:::false:false:true:",
            "u:result_identity:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("intent_identity"),
            crate::schema_materialization::unique_index("request_identity"),
            crate::schema_materialization::unique_index("decision_identity"),
            crate::schema_materialization::unique_index("result_identity"),
        ],
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorResearchIntentResolutionLocatorV1 {
    pub intent_identity: String,
    pub decision_identity: String,
}

#[derive(Debug, Error)]
pub enum SuccessorResearchIntentPostgresErrorV1 {
    #[error("successor Research Intent locator is invalid")]
    InvalidLocator,
    #[error("R&D TrialFamily custody is unavailable: {0}")]
    TrialFamily(#[from] TrialFamilyError),
    #[error("R&D Research Intent custody is unavailable: {0}")]
    ResearchCustody(#[from] ResearchGoalOwnerError),
    #[error("R&D Iteration Decision custody is unavailable: {0}")]
    Decision(#[from] crate::IterationDecisionPostgresErrorV1),
    #[error("successor Research Intent is unavailable: {0}")]
    Intent(#[from] SuccessorResearchIntentErrorV1),
    #[error("Product Edge successor admission is unavailable: {0}")]
    ProductEdge(#[from] vibe_product_edge::ProductEdgeError),
    #[error("successor Research Intent storage is unavailable: {0}")]
    Storage(String),
}

/// Materializes `rd_successor_research_intents_v1`, a relation the run report reads, so it runs only
/// before cutover. See [`crate::schema_materialization::PreCutoverMaterializationAdmitted`].
pub(crate) async fn migrate(
    pool: &PgPool,
    _admitted: &crate::schema_materialization::PreCutoverMaterializationAdmitted,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    crate::schema_materialization::materialize_public_table(
        pool,
        "rd_successor_research_intents_v1",
        "CREATE TABLE IF NOT EXISTS rd_successor_research_intents_v1 (intent_identity TEXT PRIMARY KEY, intent_digest TEXT NOT NULL, request_identity TEXT NOT NULL UNIQUE, decision_identity TEXT NOT NULL UNIQUE REFERENCES rd_iteration_decisions_v1(decision_identity), result_identity TEXT NOT NULL UNIQUE, trial_family_identity TEXT NOT NULL REFERENCES rd_trial_families_v1(trial_family_identity), predecessor_intent_identity TEXT NOT NULL, request_json JSONB NOT NULL, intent_json JSONB NOT NULL, receipt_json JSONB NOT NULL, request_storage_bytes BYTEA NOT NULL, request_storage_digest TEXT NOT NULL, intent_storage_bytes BYTEA NOT NULL, intent_storage_digest TEXT NOT NULL, receipt_storage_bytes BYTEA NOT NULL, receipt_storage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, request_semantic_digest TEXT, admission_lineage_digest TEXT, effective_principal TEXT, authorized_scope_json JSONB, view_json JSONB, artifact_evidence_digest TEXT, artifact_evidence_json JSONB)",
    )
    .await
    .map_err(storage)?;

    for statement in [
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS request_semantic_digest TEXT",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS admission_lineage_digest TEXT",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS effective_principal TEXT",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS authorized_scope_json JSONB",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS view_json JSONB",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_digest TEXT",
        "ALTER TABLE rd_successor_research_intents_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_json JSONB",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(storage)?;
    }
    migrate_successor_artifact_read_port(pool).await?;
    sqlx::query("REVOKE ALL ON TABLE public.rd_successor_research_intents_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer")
        .execute(pool)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn migrate_successor_artifact_read_port(
    pool: &PgPool,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    sqlx::query(
        "
        CREATE OR REPLACE FUNCTION rd_owner_api.peek_current_successor_research_for_artifact_v1(
          requested_intent_identity text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $function$
        DECLARE sealed record;
        BEGIN
          SELECT successor.*,
                 (SELECT pg_catalog.count(*) FROM public.rd_owner_outbox_v1 outbox
                   WHERE outbox.aggregate_identity = successor.intent_identity
                     AND outbox.event_kind = 'SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1') AS outbox_count,
                 (SELECT outbox.payload_digest FROM public.rd_owner_outbox_v1 outbox
                   WHERE outbox.aggregate_identity = successor.intent_identity
                     AND outbox.event_kind = 'SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1' LIMIT 1) AS outbox_digest,
                 (SELECT outbox.payload_json FROM public.rd_owner_outbox_v1 outbox
                   WHERE outbox.aggregate_identity = successor.intent_identity
                     AND outbox.event_kind = 'SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1' LIMIT 1) AS outbox_json,
                 (SELECT outbox.committed_at_epoch_ms FROM public.rd_owner_outbox_v1 outbox
                   WHERE outbox.aggregate_identity = successor.intent_identity
                     AND outbox.event_kind = 'SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1' LIMIT 1) AS outbox_committed_at
            INTO sealed
            FROM public.rd_successor_research_intents_v1 successor
           WHERE successor.intent_identity = requested_intent_identity;
          IF NOT FOUND
             OR sealed.request_semantic_digest IS NULL
             OR sealed.admission_lineage_digest IS NULL
             OR sealed.effective_principal IS NULL
             OR sealed.authorized_scope_json IS NULL
             OR sealed.view_json IS NULL
             OR sealed.artifact_evidence_digest IS NULL
             OR sealed.artifact_evidence_json IS NULL
             OR sealed.outbox_count <> 1
             OR sealed.request_storage_digest !~ '^blake3:[0-9a-f]{64}$'
             OR sealed.intent_storage_digest !~ '^blake3:[0-9a-f]{64}$'
             OR sealed.receipt_storage_digest !~ '^blake3:[0-9a-f]{64}$'
             OR sealed.request_semantic_digest !~ '^sha256:[0-9a-f]{64}$'
             OR sealed.admission_lineage_digest !~ '^blake3:[0-9a-f]{64}$'
             OR sealed.artifact_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
             OR sealed.outbox_digest !~ '^blake3:[0-9a-f]{64}$'
             OR sealed.request_json <> pg_catalog.convert_from(sealed.request_storage_bytes, 'UTF8')::jsonb
             OR sealed.intent_json <> pg_catalog.convert_from(sealed.intent_storage_bytes, 'UTF8')::jsonb
             OR sealed.receipt_json <> pg_catalog.convert_from(sealed.receipt_storage_bytes, 'UTF8')::jsonb
             OR sealed.request_json->>'request_identity' <> sealed.request_identity
             OR sealed.request_json->>'decision_identity' <> sealed.decision_identity
             OR sealed.request_json->>'result_identity' <> sealed.result_identity
             OR sealed.request_json#>>'{admission,request_identity}' <> sealed.request_identity
             OR sealed.intent_json->>'schema_version' <> '1'
             OR sealed.intent_json->>'intent_identity' <> sealed.intent_identity
             OR sealed.intent_json->>'intent_digest' <> sealed.intent_digest
             OR sealed.intent_json->>'request_identity' <> sealed.request_identity
             OR sealed.intent_json->>'decision_identity' <> sealed.decision_identity
             OR sealed.intent_json->>'result_identity' <> sealed.result_identity
             OR sealed.intent_json->>'trial_family_identity' <> sealed.trial_family_identity
             OR sealed.intent_json->>'predecessor_intent_identity' <> sealed.predecessor_intent_identity
             OR sealed.receipt_json->>'schema_version' <> '1'
             OR sealed.receipt_json->>'request_identity' <> sealed.request_identity
             OR sealed.receipt_json->>'intent_identity' <> sealed.intent_identity
             OR sealed.receipt_json->>'intent_digest' <> sealed.intent_digest
             OR sealed.receipt_json->>'decision_identity' <> sealed.decision_identity
             OR sealed.receipt_json->>'result_identity' <> sealed.result_identity
             OR sealed.receipt_json->>'committed_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
             OR sealed.view_json->>'schema_version' <> '1'
             OR sealed.view_json->>'request_identity' <> sealed.request_identity
             OR sealed.view_json->>'trusted_principal' <> sealed.effective_principal
             OR sealed.view_json->'authorized_scope' <> sealed.authorized_scope_json
             OR sealed.view_json->>'source_owner' <> 'R_AND_D'
             OR sealed.view_json->>'source_cut' <> 'rd-successor-source-cut-v1-' || pg_catalog.substr(sealed.intent_json->>'census_frontier_digest', 8)
             OR sealed.view_json->>'observed_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
             OR sealed.view_json->>'projection_at_epoch_ms' <> sealed.committed_at_epoch_ms::text
             OR (sealed.view_json->>'valid_through_epoch_ms')::bigint <= sealed.committed_at_epoch_ms
             OR sealed.view_json->>'availability' <> 'AVAILABLE'
             OR sealed.view_json->>'phase' <> 'INTENT_FROZEN'
             OR sealed.view_json->>'intent_identity' <> sealed.intent_identity
             OR sealed.view_json->'source_frontier' <> sealed.intent_json#>'{goal,sources}'
             OR sealed.view_json->>'next_legal_action' <> 'WAIT_FOR_R_AND_D_EXECUTION'
             OR sealed.artifact_evidence_json->>'schema_version' <> '1'
             OR sealed.artifact_evidence_json->>'request_identity' <> sealed.request_identity
             OR sealed.artifact_evidence_json->>'semantic_digest' <> sealed.request_semantic_digest
             OR sealed.artifact_evidence_json->'source_admission' <> sealed.request_json->'admission'
             OR sealed.artifact_evidence_json->>'effective_principal' <> sealed.effective_principal
             OR sealed.artifact_evidence_json->'authorized_scope' <> sealed.authorized_scope_json
             OR sealed.artifact_evidence_json->>'receipt_identity' <> sealed.receipt_json->>'receipt_identity'
             OR sealed.artifact_evidence_json->>'intent_identity' <> sealed.intent_identity
             OR sealed.artifact_evidence_json->>'view_identity' <> sealed.view_json->>'projection_identity'
             OR sealed.artifact_evidence_json->>'projection_at_epoch_ms' <> sealed.view_json->>'projection_at_epoch_ms'
             OR sealed.artifact_evidence_json->>'valid_through_epoch_ms' <> sealed.view_json->>'valid_through_epoch_ms'
             OR sealed.artifact_evidence_json->>'evidence_identity' <>
                'rd-current-research-artifact-evidence-v1-' ||
                (sealed.receipt_json->>'receipt_identity') || ':' || sealed.intent_identity || ':' ||
                (sealed.view_json->>'projection_identity')
             OR sealed.outbox_json->>'schema_version' <> '1'
             OR sealed.outbox_json->>'intent_identity' <> sealed.intent_identity
             OR sealed.outbox_json->>'intent_digest' <> sealed.intent_digest
             OR sealed.outbox_json->>'receipt_identity' <> sealed.receipt_json->>'receipt_identity'
             OR sealed.outbox_json->>'request_identity' <> sealed.request_identity
             OR sealed.outbox_json->>'predecessor_intent_identity' <> sealed.predecessor_intent_identity
             OR sealed.outbox_json->>'decision_identity' <> sealed.decision_identity
             OR sealed.outbox_json->>'decision_digest' <> sealed.intent_json->>'decision_digest'
             OR sealed.outbox_json->>'result_identity' <> sealed.result_identity
             OR sealed.outbox_json->>'trial_family_identity' <> sealed.trial_family_identity
             OR sealed.outbox_json->>'census_frontier_identity' <> sealed.intent_json->>'census_frontier_identity'
             OR sealed.outbox_json->>'experiment_identity' <> sealed.intent_json->>'experiment_identity'
             OR sealed.outbox_json->>'experiment_digest' <> sealed.intent_json->>'experiment_digest'
             OR sealed.outbox_committed_at <> sealed.committed_at_epoch_ms
          THEN RETURN NULL; END IF;
          RETURN pg_catalog.jsonb_build_object(
            'evidence_digest', sealed.artifact_evidence_digest,
            'evidence', sealed.artifact_evidence_json
          );
        END
        $function$
        ",
    )
    .execute(pool)
    .await
    .map_err(storage)?;
    sqlx::query(
        "
        CREATE OR REPLACE FUNCTION rd_owner_api.lock_current_successor_research_for_artifact_v1(
          requested_intent_identity text,
          requested_evidence_identity text,
          requested_evidence_digest text
        ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $function$
        DECLARE envelope jsonb; owner_cut_epoch_ms bigint;
        BEGIN
          PERFORM 1 FROM public.rd_successor_research_intents_v1
           WHERE intent_identity = requested_intent_identity FOR SHARE;
          IF NOT FOUND THEN RETURN NULL; END IF;
          PERFORM 1 FROM public.rd_owner_outbox_v1
           WHERE aggregate_identity = requested_intent_identity
             AND event_kind = 'SUCCESSOR_RESEARCH_INTENT_COMMITTED_V1' FOR SHARE;
          IF NOT FOUND THEN RETURN NULL; END IF;
          SELECT rd_owner_api.peek_current_successor_research_for_artifact_v1(requested_intent_identity)
            INTO envelope;
          IF envelope IS NULL
             OR envelope->>'evidence_digest' <> requested_evidence_digest
             OR envelope#>>'{evidence,evidence_identity}' <> requested_evidence_identity
          THEN RETURN NULL; END IF;
          owner_cut_epoch_ms := pg_catalog.floor(
            extract(epoch FROM pg_catalog.clock_timestamp()) * 1000
          )::bigint;
          IF (envelope#>>'{evidence,projection_at_epoch_ms}')::bigint > owner_cut_epoch_ms
          THEN RETURN NULL; END IF;
          RETURN pg_catalog.jsonb_build_object('owner_cut_epoch_ms', owner_cut_epoch_ms) || envelope;
        END
        $function$
        ",
    )
    .execute(pool)
    .await
    .map_err(storage)?;

    for statement in [
        "ALTER FUNCTION rd_owner_api.peek_current_successor_research_for_artifact_v1(text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.peek_current_successor_research_for_artifact_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.peek_current_successor_research_for_artifact_v1(text) TO product_edge_owner",
        "ALTER FUNCTION rd_owner_api.lock_current_successor_research_for_artifact_v1(text,text,text) OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.lock_current_successor_research_for_artifact_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
        "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_current_successor_research_for_artifact_v1(text,text,text) TO product_edge_owner",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(storage)?;
    }
    Ok(())
}

/// Freezes the Decision-selected successor Research Intent.
///
/// A successor freezes the protected-feedback projection that is current when it is created, the
/// same way an initial Research request does, under the Independence Basis its TrialFamily was
/// admitted under: Qualification resolves it first in its own transaction, which may renew it, and
/// the creating transaction admits it again and freezes only an equal one. An existing successor
/// replays under the projection it stored and resolves nothing.
pub(crate) async fn compose_successor_research_intent_v1(
    pool: &PgPool,
    qualification: &PostgresQualificationOwnerV1,
    request: SuccessorResearchIntentCompositionRequestV1,
) -> Result<SuccessorResearchIntentReadbackV1, SuccessorResearchIntentPostgresErrorV1> {
    validate_composition_request(&request)?;
    let resolved = match Box::pin(basis_to_resolve_for_new_successor(pool, &request)).await? {
        Some(basis) => {
            let resolution = qualification.resolve_or_create_for_basis(&basis).await;
            Some((basis, resolution))
        }
        None => None,
    };
    let mut transaction = pool.begin().await.map_err(storage)?;
    lock_composition_key(&mut transaction, &request.decision_identity).await?;

    let existing = load_by_decision_in_transaction(
        &mut transaction,
        &request.decision_identity,
        Some(&request),
    )
    .await?;
    let admission_cut = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
    let admission = resolve_admission_for_downstream_in_transaction(
        &mut transaction,
        &request.admission,
        if existing.is_some() {
            DownstreamAdmissionModeV1::Historical
        } else {
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: admission_cut,
            }
        },
    )
    .await?;
    verify_successor_research_intent_admission_v1(&admission, &request)?;

    if let Some(existing) = existing {
        verify_persisted_product_edge_custody(&mut transaction, &request, &existing, &admission)
            .await?;
        transaction.commit().await.map_err(storage)?;
        return Ok(existing);
    }

    if !admission.authorizes_first_mutation_at(admission_cut) {
        return Err(storage("Product Edge successor admission is not current"));
    }

    let family_identity = load_decision_family_identity(
        &mut transaction,
        &request.decision_identity,
        &request.result_identity,
    )
    .await?;
    let census =
        crate::trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction(
            &mut transaction,
            &family_identity,
        )
        .await?;
    let decision =
        crate::iteration_decision_postgres::load_candidate_comparison_by_result_in_transaction(
            &mut transaction,
            &census,
            &request.result_identity,
            None,
        )
        .await?
        .ok_or_else(|| storage("candidate-comparison Decision is missing"))?;
    if decision.decision().decision_identity() != request.decision_identity {
        return Err(storage("successor Decision locator mismatch"));
    }

    let basis = Box::pin(family_independence_basis_in_transaction(
        &mut transaction,
        &census,
    ))
    .await?;
    let protected_feedback = admit_successor_protected_feedback_in_transaction(
        &mut transaction,
        qualification,
        &basis,
        &admission,
        resolved,
    )
    .await?;
    let source = Box::pin(source_from_locked_custody(
        &mut transaction,
        &census,
        &decision,
        &protected_feedback,
    ))
    .await?;
    let committed_at_epoch_ms = owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
    if !admission.authorizes_first_mutation_at(committed_at_epoch_ms) {
        return Err(storage(
            "Product Edge successor admission expired before mutation",
        ));
    }
    let issued =
        issue_successor_research_intent_v1(request.clone(), source, committed_at_epoch_ms)?;
    let custody = issue_successor_artifact_custody(&request, &issued, &admission)?;
    persist(&mut transaction, &request, &issued, &custody).await?;
    let readback = load_by_decision_in_transaction(
        &mut transaction,
        &request.decision_identity,
        Some(&request),
    )
    .await?
    .ok_or_else(|| storage("committed successor Intent readback is missing"))?;
    if readback != issued {
        return Err(storage("committed successor Intent readback changed"));
    }
    let refreshed = qualification
        .admit_in_transaction(&mut transaction, &basis)
        .await;

    if !matches!(&refreshed, Ok(Some(refreshed)) if *refreshed == protected_feedback) {
        return Err(refuse_protected_feedback(
            SUCCESSOR_PROTECTED_FEEDBACK_REFRESH_MISMATCH_COORDINATE_V1,
            "the protected-feedback projection changed between its admission and the commit",
        ));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

/// A successor request admitted for an operator whose principal and scope are not its
/// TrialFamily basis's. It negates the request, which no retry changes, so it is refused as an
/// invalid proposal under this reason rather than as an unavailable Owner.
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_PRINCIPAL_SCOPE_REFUSAL_V1: &str =
    "the successor's admitted principal and scope are not its TrialFamily basis's";

/// Where each refusal that the environment may change is recorded. Each writes nothing and
/// answers the Owner unavailable, as any other store state the successor could not use does.
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_RESOLVE_COORDINATE_V1: &str =
    "research_goal_owner.compose_successor_v1.protected_feedback.resolve";
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_ABSENT_COORDINATE_V1: &str =
    "research_goal_owner.compose_successor_v1.protected_feedback.absent";
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_MISMATCH_COORDINATE_V1: &str =
    "research_goal_owner.compose_successor_v1.protected_feedback.mismatch";
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_REFRESH_MISMATCH_COORDINATE_V1: &str =
    "research_goal_owner.compose_successor_v1.protected_feedback.refresh_mismatch";
/// A successor's protected-feedback projection that was not admitted under its TrialFamily's
/// Independence Basis. The same coordinate answers when a successor is created and when its
/// Artifact build binds it.
pub(crate) const SUCCESSOR_PROTECTED_FEEDBACK_FOREIGN_BASIS_COORDINATE_V1: &str =
    "research_goal_owner.compose_successor_v1.protected_feedback.foreign_basis";

fn refuse_protected_feedback(
    coordinate: &'static str,
    cause: &(impl Display + ?Sized),
) -> SuccessorResearchIntentPostgresErrorV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, &cause.to_string());
    storage(format!("{coordinate}: {cause}"))
}

/// The basis a new successor must resolve protected feedback under, read before the creating
/// transaction because Qualification's resolution commits in its own; `None` when the successor
/// already exists and replays.
async fn basis_to_resolve_for_new_successor(
    pool: &PgPool,
    request: &SuccessorResearchIntentCompositionRequestV1,
) -> Result<Option<RdIndependenceBasisLocatorV1>, SuccessorResearchIntentPostgresErrorV1> {
    let mut transaction = pool.begin().await.map_err(storage)?;
    if load_by_decision_in_transaction(&mut transaction, &request.decision_identity, Some(request))
        .await?
        .is_some()
    {
        transaction.rollback().await.map_err(storage)?;
        return Ok(None);
    }
    let family_identity = load_decision_family_identity(
        &mut transaction,
        &request.decision_identity,
        &request.result_identity,
    )
    .await?;
    let census =
        crate::trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction(
            &mut transaction,
            &family_identity,
        )
        .await?;
    let basis = Box::pin(family_independence_basis_in_transaction(
        &mut transaction,
        &census,
    ))
    .await?;
    transaction.rollback().await.map_err(storage)?;
    Ok(Some(basis))
}

/// The Independence Basis a TrialFamily was admitted under: the one its initial Research Intent
/// committed. A successor commits no basis of its own.
async fn family_independence_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
) -> Result<RdIndependenceBasisLocatorV1, SuccessorResearchIntentPostgresErrorV1> {
    let custody = admit_research_custody_in_transaction(
        transaction,
        ResearchCustodyLookupV1::Intent(
            census.legacy_family.initial_intent_member().fact_identity(),
        ),
    )
    .await?
    .ok_or_else(|| storage("TrialFamily initial Research Intent custody is missing"))?;
    let Some(FrozenResearchGoalIntent::V2(intent)) = custody.intent() else {
        return Err(storage(
            "TrialFamily initial Research Intent V2 is required",
        ));
    };
    admitted_independence_basis_in_transaction(
        transaction,
        &intent.independence_basis_identity,
        &intent.independence_basis_digest,
    )
    .await
}

async fn admitted_independence_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
    basis_digest: &str,
) -> Result<RdIndependenceBasisLocatorV1, SuccessorResearchIntentPostgresErrorV1> {
    let basis =
        admit_independence_basis_by_identity_in_transaction(transaction, basis_identity).await?;

    if basis.basis_digest() != basis_digest {
        return Err(storage("TrialFamily Independence Basis digest mismatch"));
    }
    Ok(basis.locator())
}

/// Admits, in the creating transaction, the protected-feedback projection a new successor freezes:
/// the one Qualification resolved for the family's basis, still current under the creating lock,
/// admitted for an operator whose principal and scope are the basis's own.
async fn admit_successor_protected_feedback_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    qualification: &PostgresQualificationOwnerV1,
    basis: &RdIndependenceBasisLocatorV1,
    admission: &ProductEdgeAdmissionReadbackV1,
    resolved: Option<(
        RdIndependenceBasisLocatorV1,
        Result<ProtectedFeedbackFrontierReadbackV1, vibe_qualification::QualificationOwnerError>,
    )>,
) -> Result<ProtectedFeedbackFrontierReadbackV1, SuccessorResearchIntentPostgresErrorV1> {
    if admission.effective_principal() != basis.principal
        || admission.authorized_scope() != basis.request_scope.as_slice()
    {
        return Err(SuccessorResearchIntentErrorV1::Invalid(
            SUCCESSOR_PROTECTED_FEEDBACK_PRINCIPAL_SCOPE_REFUSAL_V1,
        )
        .into());
    }
    let resolved = match resolved {
        Some((resolved_basis, Ok(resolved))) if resolved_basis == *basis => resolved,
        Some((_, Err(cause))) => {
            return Err(refuse_protected_feedback(
                SUCCESSOR_PROTECTED_FEEDBACK_RESOLVE_COORDINATE_V1,
                &cause,
            ));
        }
        _ => {
            return Err(refuse_protected_feedback(
                SUCCESSOR_PROTECTED_FEEDBACK_RESOLVE_COORDINATE_V1,
                "no protected feedback was resolved for the TrialFamily basis",
            ));
        }
    };
    let admitted = match qualification.admit_in_transaction(transaction, basis).await {
        Ok(Some(admitted)) => admitted,
        Ok(None) => {
            return Err(refuse_protected_feedback(
                SUCCESSOR_PROTECTED_FEEDBACK_ABSENT_COORDINATE_V1,
                "Qualification admitted no protected-feedback projection for the TrialFamily basis",
            ));
        }
        Err(cause) => {
            return Err(refuse_protected_feedback(
                SUCCESSOR_PROTECTED_FEEDBACK_ABSENT_COORDINATE_V1,
                &cause,
            ));
        }
    };

    if admitted != resolved {
        return Err(refuse_protected_feedback(
            SUCCESSOR_PROTECTED_FEEDBACK_MISMATCH_COORDINATE_V1,
            "the projection admitted under the creating lock differs from the one resolved before it",
        ));
    }
    Ok(admitted)
}

/// Proves that the protected-feedback projection a successor Intent froze was admitted under its
/// TrialFamily's Independence Basis, `basis_identity` and `basis_digest`, which the Intent names.
/// Qualification owns that binding: its historical admission answers a projection only for the
/// basis it was admitted under. The projection it answers carries the source cut the successor
/// froze.
pub(crate) async fn verify_successor_protected_feedback_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
    basis_digest: &str,
    projection_identity: &str,
    projection_digest: &str,
) -> Result<ProtectedFeedbackFrontierReadbackV1, SuccessorResearchIntentPostgresErrorV1> {
    let basis =
        admitted_independence_basis_in_transaction(transaction, basis_identity, basis_digest)
            .await?;

    match vibe_qualification::admit_historical_projection_in_transaction(
        transaction,
        &basis,
        projection_identity,
        projection_digest,
    )
    .await
    {
        Ok(Some(projection))
            if projection.projection_identity() == projection_identity
                && projection.projection_digest() == projection_digest =>
        {
            Ok(projection)
        }
        Ok(_) => Err(foreign_basis()),
        Err(cause) => {
            crate::storage_diagnostic::refused_by_store(
                SUCCESSOR_PROTECTED_FEEDBACK_FOREIGN_BASIS_COORDINATE_V1,
                &cause,
            );
            Err(foreign_basis())
        }
    }
}

fn foreign_basis() -> SuccessorResearchIntentPostgresErrorV1 {
    refuse_protected_feedback(
        SUCCESSOR_PROTECTED_FEEDBACK_FOREIGN_BASIS_COORDINATE_V1,
        "the successor's protected-feedback projection was not admitted under its TrialFamily's Independence Basis",
    )
}

pub(crate) async fn resolve_successor_research_intent_v1(
    pool: &PgPool,
    locator: SuccessorResearchIntentResolutionLocatorV1,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    if !valid_identity(&locator.intent_identity) || !valid_identity(&locator.decision_identity) {
        return Err(SuccessorResearchIntentPostgresErrorV1::InvalidLocator);
    }
    let mut transaction = pool.begin().await.map_err(storage)?;
    let readback =
        load_by_intent_in_transaction(&mut transaction, &locator.intent_identity).await?;
    if let Some(value) = readback.as_ref()
        && value.intent().decision_identity() != locator.decision_identity
    {
        return Err(storage("successor Intent resolution locator mismatch"));
    }
    transaction.commit().await.map_err(storage)?;
    Ok(readback)
}

struct PredecessorContextV1 {
    intent_identity: String,
    intent_digest: String,
    source_frontier: Vec<crate::product_edge::ResearchSourceV1>,
    trial_family_identity: String,
    trial_family_policy_digest: String,
    independence_basis_identity: String,
    independence_basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SuccessorCurrentResearchArtifactEvidenceV1 {
    schema_version: u32,
    evidence_identity: String,
    request_identity: String,
    semantic_digest: String,
    source_admission: vibe_product_edge::ProductEdgeAdmissionLocatorV1,
    effective_principal: String,
    authorized_scope: Vec<String>,
    receipt_identity: String,
    intent_identity: String,
    view_identity: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

struct SuccessorArtifactCustodyV1 {
    request_semantic_digest: String,
    admission_lineage_digest: String,
    view: ResearchViewV1,
    evidence_digest: String,
    evidence: SuccessorCurrentResearchArtifactEvidenceV1,
}

pub(crate) struct SuccessorResearchViewCustodyV1 {
    request_semantic_digest: String,
    /// The Product Edge admission the successor Intent was admitted under, which every Develop
    /// continuation re-locks at its own cut.
    admission: vibe_product_edge::ProductEdgeAdmissionLocatorV1,
    initial_view: ResearchViewV1,
    view: ResearchViewV1,
}

impl SuccessorResearchViewCustodyV1 {
    pub(crate) fn request_semantic_digest(&self) -> &str {
        &self.request_semantic_digest
    }

    pub(crate) const fn admission(&self) -> &vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
        &self.admission
    }

    pub(crate) const fn view(&self) -> &ResearchViewV1 {
        &self.view
    }

    #[cfg(test)]
    pub(crate) fn fixture(
        readback: &SuccessorResearchIntentReadbackV1,
        request_semantic_digest: String,
        projection_at_epoch_ms: u64,
        valid_through_epoch_ms: u64,
    ) -> Self {
        let intent = readback.intent();
        let view = ResearchViewV1 {
            schema_version: 1,
            projection_identity: "rd-successor-research-view-test".to_owned(),
            request_identity: intent.request_identity().to_owned(),
            trusted_principal: "rd-owner-test".to_owned(),
            authorized_scope: vec![crate::product_edge::RESEARCH_SCOPE_V1.to_owned()],
            authorization_policy_cut: "rd-successor-authorization-cut-test".to_owned(),
            source_owner: RESEARCH_OWNER_V1.to_owned(),
            source_cut: "rd-successor-source-cut-test".to_owned(),
            observed_at_epoch_ms: projection_at_epoch_ms,
            projection_at_epoch_ms,
            valid_through_epoch_ms,
            availability: ResearchViewAvailability::Available,
            phase: ResearchViewPhase::IntentFrozen,
            intent_identity: intent.intent_identity().to_owned(),
            source_frontier: intent.goal().sources.clone(),
            attempt_identity: None,
            artifact_identity: None,
            build_receipt_identity: None,
            artifact_review_identity: None,
            composer_artifact: None,
            exploration: None,
            next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
        };
        Self {
            request_semantic_digest,
            admission: vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
                request_identity: intent.request_identity().to_owned(),
                admission_identity: "successor-admission-test".to_owned(),
                admission_digest: format!("sha256:{}", "0".repeat(64)),
            },
            initial_view: view.clone(),
            view,
        }
    }
}

fn issue_successor_artifact_custody(
    request: &SuccessorResearchIntentCompositionRequestV1,
    readback: &SuccessorResearchIntentReadbackV1,
    admission: &ProductEdgeAdmissionReadbackV1,
) -> Result<SuccessorArtifactCustodyV1, SuccessorResearchIntentPostgresErrorV1> {
    let intent = readback.intent();
    let receipt = readback.receipt();
    let request_semantic_digest = successor_research_intent_semantic_digest_v1(request)?;
    let admission_lineage_bytes =
        serde_json::to_vec(&admission.immutable_lineage()).map_err(storage)?;
    let admission_lineage_digest = storage_digest(
        "rd.successor-product-edge-admission-lineage.storage.v1",
        &admission_lineage_bytes,
    );
    let source_cut = format!(
        "rd-successor-source-cut-v1-{}",
        intent
            .census_frontier_digest()
            .trim_start_matches("sha256:")
    );
    let mut view = ResearchViewV1 {
        schema_version: 1,
        projection_identity: String::new(),
        request_identity: request.request_identity.clone(),
        trusted_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        authorization_policy_cut: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut,
        observed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        projection_at_epoch_ms: receipt.committed_at_epoch_ms(),
        valid_through_epoch_ms: receipt
            .committed_at_epoch_ms()
            .saturating_add(crate::product_edge::RESEARCH_VIEW_FRESHNESS_MS),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent.intent_identity().to_string(),
        source_frontier: intent.goal().sources.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        composer_artifact: None,
        exploration: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    view.projection_identity = canonical_research_view_identity_v2(&view);
    let evidence_identity = format!(
        "rd-current-research-artifact-evidence-v1-{}:{}:{}",
        receipt.receipt_identity(),
        intent.intent_identity(),
        view.projection_identity
    );
    let evidence = SuccessorCurrentResearchArtifactEvidenceV1 {
        schema_version: 1,
        evidence_identity,
        request_identity: request.request_identity.clone(),
        semantic_digest: request_semantic_digest.clone(),
        source_admission: request.admission.clone(),
        effective_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        receipt_identity: receipt.receipt_identity().to_string(),
        intent_identity: intent.intent_identity().to_string(),
        view_identity: view.projection_identity.clone(),
        projection_at_epoch_ms: view.projection_at_epoch_ms,
        valid_through_epoch_ms: view.valid_through_epoch_ms,
    };
    let evidence_bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd-owner.current-research-artifact-evidence.v1",
        "evidence": evidence,
    }))
    .map_err(storage)?;
    let evidence_digest = format!("sha256:{:x}", Sha256::digest(evidence_bytes));
    Ok(SuccessorArtifactCustodyV1 {
        request_semantic_digest,
        admission_lineage_digest,
        view,
        evidence_digest,
        evidence,
    })
}

/// Reseals a successor's stored View and the artifact evidence Product Edge locks against with
/// `valid_through_epoch_ms`, and returns the new view, evidence and evidence digest to store.
#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
pub(crate) fn reseal_successor_artifact_evidence_for_test(
    view_json: serde_json::Value,
    evidence_json: serde_json::Value,
    valid_through_epoch_ms: u64,
) -> Result<(serde_json::Value, serde_json::Value, String), SuccessorResearchIntentPostgresErrorV1>
{
    let mut view: ResearchViewV1 = serde_json::from_value(view_json).map_err(storage)?;
    let mut evidence: SuccessorCurrentResearchArtifactEvidenceV1 =
        serde_json::from_value(evidence_json).map_err(storage)?;
    view.valid_through_epoch_ms = valid_through_epoch_ms;
    evidence.valid_through_epoch_ms = valid_through_epoch_ms;
    let evidence_bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd-owner.current-research-artifact-evidence.v1",
        "evidence": evidence,
    }))
    .map_err(storage)?;
    Ok((
        serde_json::to_value(view).map_err(storage)?,
        serde_json::to_value(evidence).map_err(storage)?,
        format!("sha256:{:x}", Sha256::digest(evidence_bytes)),
    ))
}

pub(crate) async fn lock_successor_research_view_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<SuccessorResearchViewCustodyV1, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT request_storage_bytes,request_semantic_digest,effective_principal,authorized_scope_json,view_json,artifact_evidence_digest,artifact_evidence_json,intent_json,receipt_json FROM rd_successor_research_intents_v1 WHERE intent_identity=$1 FOR UPDATE")
        .bind(readback.intent().intent_identity())
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Research View custody is incomplete"));
    }
    let row = &rows[0];
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(storage)?;
    let request: SuccessorResearchIntentCompositionRequestV1 =
        serde_json::from_slice(&request_bytes).map_err(storage)?;
    let request_semantic_digest = successor_research_intent_semantic_digest_v1(&request)?;
    let effective_principal: String = row
        .try_get::<Option<String>, _>("effective_principal")
        .map_err(storage)?
        .ok_or_else(|| storage("successor Research View principal is missing"))?;
    let authorized_scope: Vec<String> = serde_json::from_value(
        row.try_get::<Option<serde_json::Value>, _>("authorized_scope_json")
            .map_err(storage)?
            .ok_or_else(|| storage("successor Research View scope is missing"))?,
    )
    .map_err(storage)?;
    let view: ResearchViewV1 = serde_json::from_value(
        row.try_get::<Option<serde_json::Value>, _>("view_json")
            .map_err(storage)?
            .ok_or_else(|| storage("successor Research View is missing"))?,
    )
    .map_err(storage)?;
    let evidence: SuccessorCurrentResearchArtifactEvidenceV1 = serde_json::from_value(
        row.try_get::<Option<serde_json::Value>, _>("artifact_evidence_json")
            .map_err(storage)?
            .ok_or_else(|| storage("successor Research View evidence is missing"))?,
    )
    .map_err(storage)?;
    let intent = readback.intent();
    let receipt = readback.receipt();
    let mut initial_view = ResearchViewV1 {
        schema_version: 1,
        projection_identity: String::new(),
        request_identity: request.request_identity.clone(),
        trusted_principal: effective_principal.clone(),
        authorized_scope: authorized_scope.clone(),
        authorization_policy_cut: view.authorization_policy_cut.clone(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut: format!(
            "rd-successor-source-cut-v1-{}",
            intent
                .census_frontier_digest()
                .trim_start_matches("sha256:")
        ),
        observed_at_epoch_ms: receipt.committed_at_epoch_ms(),
        projection_at_epoch_ms: receipt.committed_at_epoch_ms(),
        valid_through_epoch_ms: receipt
            .committed_at_epoch_ms()
            .saturating_add(crate::product_edge::RESEARCH_VIEW_FRESHNESS_MS),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent.intent_identity().to_string(),
        source_frontier: intent.goal().sources.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        composer_artifact: None,
        exploration: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    initial_view.projection_identity = canonical_research_view_identity_v2(&initial_view);
    let evidence_bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd-owner.current-research-artifact-evidence.v1",
        "evidence": evidence,
    }))
    .map_err(storage)?;
    let evidence_digest = format!("sha256:{:x}", Sha256::digest(evidence_bytes));
    let expected_evidence_identity = format!(
        "rd-current-research-artifact-evidence-v1-{}:{}:{}",
        receipt.receipt_identity(),
        intent.intent_identity(),
        initial_view.projection_identity
    );

    if row
        .try_get::<Option<String>, _>("request_semantic_digest")
        .map_err(storage)?
        .as_deref()
        != Some(request_semantic_digest.as_str())
        || row
            .try_get::<Option<String>, _>("artifact_evidence_digest")
            .map_err(storage)?
            .as_deref()
            != Some(evidence_digest.as_str())
        || row
            .try_get::<serde_json::Value, _>("intent_json")
            .map_err(storage)?
            != serde_json::to_value(intent).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(receipt).map_err(storage)?
        || evidence.schema_version != 1
        || evidence.evidence_identity != expected_evidence_identity
        || evidence.request_identity != request.request_identity
        || evidence.semantic_digest != request_semantic_digest
        || evidence.source_admission != request.admission
        || evidence.effective_principal != effective_principal
        || evidence.authorized_scope != authorized_scope
        || evidence.receipt_identity != receipt.receipt_identity()
        || evidence.intent_identity != intent.intent_identity()
        || evidence.view_identity != initial_view.projection_identity
        || evidence.projection_at_epoch_ms != initial_view.projection_at_epoch_ms
        || evidence.valid_through_epoch_ms != initial_view.valid_through_epoch_ms
    {
        return Err(storage("successor Research View evidence changed"));
    }
    validate_historical_view(&view, &initial_view)?;
    Ok(SuccessorResearchViewCustodyV1 {
        request_semantic_digest,
        admission: request.admission,
        initial_view,
        view,
    })
}

pub(crate) async fn advance_successor_research_view_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
    custody: &SuccessorResearchViewCustodyV1,
    new_view: &ResearchViewV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    validate_historical_view(new_view, &custody.initial_view)?;
    let updated = sqlx::query("UPDATE rd_successor_research_intents_v1 SET view_json=$1 WHERE intent_identity=$2 AND intent_json=$3 AND receipt_json=$4 AND view_json=$5")
        .bind(serde_json::to_value(new_view).map_err(storage)?)
        .bind(readback.intent().intent_identity())
        .bind(serde_json::to_value(readback.intent()).map_err(storage)?)
        .bind(serde_json::to_value(readback.receipt()).map_err(storage)?)
        .bind(serde_json::to_value(custody.view()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    if updated.rows_affected() != 1 {
        return Err(storage("successor Research View changed before transition"));
    }
    Ok(())
}

async fn source_from_locked_custody(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    readback: &CandidateComparisonDecisionReadbackV1,
    protected_feedback: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<SuccessorResearchIntentSourceV1, SuccessorResearchIntentPostgresErrorV1> {
    let decision = readback.decision();
    let (experiment_identity, experiment_digest) = match decision.outcome() {
        IterationDecisionOutcomeV1::SuccessorExperiment {
            experiment_identity,
            experiment_digest,
        } => (experiment_identity, experiment_digest),
        _ => return Err(storage("Decision does not admit a successor Intent")),
    };
    let mut selected = decision
        .candidate_evaluations()
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.candidate_identity == *experiment_identity
                && candidate.candidate_digest == *experiment_digest
        });
    let chosen = selected
        .next()
        .ok_or_else(|| storage("Decision-selected experiment content is missing"))?;
    if selected.next().is_some() {
        return Err(storage("Decision-selected experiment is not unique"));
    }
    let latest_intent = census.latest_intent_binding()?;
    let predecessor = Box::pin(load_predecessor_context(
        transaction,
        census,
        latest_intent.intent_identity,
        latest_intent.intent_digest,
    ))
    .await?;
    let evidence = decision.evidence_cut();
    if predecessor.trial_family_identity != evidence.trial_family_identity
        || predecessor.trial_family_policy_digest != census.legacy_family.root().policy_digest()
    {
        return Err(storage("predecessor Intent family custody mismatch"));
    }
    Ok(SuccessorResearchIntentSourceV1 {
        predecessor_intent_identity: predecessor.intent_identity,
        predecessor_intent_digest: predecessor.intent_digest,
        source_frontier: predecessor.source_frontier,
        decision_identity: decision.decision_identity().to_string(),
        decision_digest: decision.decision_digest().to_string(),
        decision_receipt_identity: readback.receipt().receipt_identity().to_string(),
        result_identity: evidence.result_identity.clone(),
        trial_family_identity: evidence.trial_family_identity.clone(),
        trial_family_policy_digest: predecessor.trial_family_policy_digest,
        census_frontier_identity: evidence.census_frontier_identity.clone(),
        census_frontier_digest: evidence.census_frontier_digest.clone(),
        independence_basis_identity: predecessor.independence_basis_identity,
        independence_basis_digest: predecessor.independence_basis_digest,
        protected_feedback_projection_identity: protected_feedback.projection_identity().to_owned(),
        protected_feedback_projection_digest: protected_feedback.projection_digest().to_owned(),
        experiment_identity: experiment_identity.clone(),
        experiment_digest: experiment_digest.clone(),
        experiment: chosen.experiment.clone(),
    })
}

async fn load_predecessor_context(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    intent_identity: &str,
    intent_digest: &str,
) -> Result<PredecessorContextV1, SuccessorResearchIntentPostgresErrorV1> {
    if intent_identity == census.legacy_family.initial_intent_member().fact_identity() {
        let custody = admit_research_custody_in_transaction(
            transaction,
            ResearchCustodyLookupV1::Intent(intent_identity),
        )
        .await?
        .ok_or_else(|| storage("predecessor Research Intent custody is missing"))?;
        let FrozenResearchGoalIntent::V2(intent) = custody
            .intent()
            .ok_or_else(|| storage("predecessor Research Intent is missing"))?
        else {
            return Err(storage("predecessor Research Intent V2 is required"));
        };

        if intent.semantic_digest != intent_digest {
            return Err(storage("predecessor Research Intent digest mismatch"));
        }
        return Ok(PredecessorContextV1 {
            intent_identity: intent.intent_identity.clone(),
            intent_digest: intent.semantic_digest.clone(),
            source_frontier: intent.source_frontier.clone(),
            trial_family_identity: intent.trial_family_identity.clone(),
            trial_family_policy_digest: intent.trial_family_policy_digest.clone(),
            independence_basis_identity: intent.independence_basis_identity.clone(),
            independence_basis_digest: intent.independence_basis_digest.clone(),
        });
    }
    let successor = load_by_intent_in_transaction(transaction, intent_identity)
        .await?
        .ok_or_else(|| storage("predecessor successor Intent custody is missing"))?;
    let intent = successor.intent();
    if intent.intent_digest() != intent_digest {
        return Err(storage("predecessor successor Intent digest mismatch"));
    }
    Ok(PredecessorContextV1 {
        intent_identity: intent.intent_identity().to_string(),
        intent_digest: intent.intent_digest().to_string(),
        source_frontier: intent.goal().sources.clone(),
        trial_family_identity: intent.trial_family_identity().to_string(),
        trial_family_policy_digest: intent.trial_family_policy_digest().to_string(),
        independence_basis_identity: intent.independence_basis_identity().to_string(),
        independence_basis_digest: intent.independence_basis_digest().to_string(),
    })
}

async fn persist(
    transaction: &mut Transaction<'_, Postgres>,
    request: &SuccessorResearchIntentCompositionRequestV1,
    readback: &SuccessorResearchIntentReadbackV1,
    custody: &SuccessorArtifactCustodyV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let request_bytes = serde_json::to_vec(request).map_err(storage)?;
    let intent_bytes = serde_json::to_vec(readback.intent()).map_err(storage)?;
    let receipt_bytes = serde_json::to_vec(readback.receipt()).map_err(storage)?;
    let request_json =
        serde_json::from_slice::<serde_json::Value>(&request_bytes).map_err(storage)?;
    let intent_json =
        serde_json::from_slice::<serde_json::Value>(&intent_bytes).map_err(storage)?;
    let receipt_json =
        serde_json::from_slice::<serde_json::Value>(&receipt_bytes).map_err(storage)?;
    let view_json = serde_json::to_value(&custody.view).map_err(storage)?;
    let artifact_evidence_json = serde_json::to_value(&custody.evidence).map_err(storage)?;
    let intent = readback.intent();
    let receipt = readback.receipt();
    sqlx::query("INSERT INTO rd_successor_research_intents_v1 (intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms,request_semantic_digest,admission_lineage_digest,effective_principal,authorized_scope_json,view_json,artifact_evidence_digest,artifact_evidence_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)")
        .bind(intent.intent_identity())
        .bind(intent.intent_digest())
        .bind(request.request_identity.as_str())
        .bind(intent.decision_identity())
        .bind(intent.result_identity())
        .bind(intent.trial_family_identity())
        .bind(intent.predecessor_intent_identity())
        .bind(request_json)
        .bind(intent_json)
        .bind(receipt_json)
        .bind(&request_bytes)
        .bind(storage_digest("rd.successor-research-intent-request.storage.v1", &request_bytes))
        .bind(&intent_bytes)
        .bind(storage_digest("rd.successor-research-intent.storage.v1", &intent_bytes))
        .bind(&receipt_bytes)
        .bind(storage_digest("rd.successor-research-intent-receipt.storage.v1", &receipt_bytes))
        .bind(i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?)
        .bind(&custody.request_semantic_digest)
        .bind(&custody.admission_lineage_digest)
        .bind(&custody.evidence.effective_principal)
        .bind(serde_json::to_value(&custody.evidence.authorized_scope).map_err(storage)?)
        .bind(view_json)
        .bind(&custody.evidence_digest)
        .bind(artifact_evidence_json)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    persist_outbox(transaction, readback).await
}

async fn verify_persisted_product_edge_custody(
    transaction: &mut Transaction<'_, Postgres>,
    request: &SuccessorResearchIntentCompositionRequestV1,
    readback: &SuccessorResearchIntentReadbackV1,
    admission: &ProductEdgeAdmissionReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let expected = issue_successor_artifact_custody(request, readback, admission)?;
    let rows = sqlx::query("SELECT request_semantic_digest,admission_lineage_digest,effective_principal,authorized_scope_json,view_json,artifact_evidence_digest,artifact_evidence_json FROM rd_successor_research_intents_v1 WHERE decision_identity=$1 FOR SHARE")
        .bind(&request.decision_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Product Edge custody is incomplete"));
    }
    let row = &rows[0];
    let persisted_view: ResearchViewV1 = serde_json::from_value(
        row.try_get::<Option<serde_json::Value>, _>("view_json")
            .map_err(storage)?
            .ok_or_else(|| storage("successor Product Edge Research View is missing"))?,
    )
    .map_err(storage)?;

    if row
        .try_get::<Option<String>, _>("request_semantic_digest")
        .map_err(storage)?
        .as_deref()
        != Some(expected.request_semantic_digest.as_str())
        || row
            .try_get::<Option<String>, _>("admission_lineage_digest")
            .map_err(storage)?
            .as_deref()
            != Some(expected.admission_lineage_digest.as_str())
        || row
            .try_get::<Option<String>, _>("effective_principal")
            .map_err(storage)?
            .as_deref()
            != Some(expected.evidence.effective_principal.as_str())
        || row
            .try_get::<Option<serde_json::Value>, _>("authorized_scope_json")
            .map_err(storage)?
            != Some(serde_json::to_value(&expected.evidence.authorized_scope).map_err(storage)?)
        || row
            .try_get::<Option<String>, _>("artifact_evidence_digest")
            .map_err(storage)?
            .as_deref()
            != Some(expected.evidence_digest.as_str())
        || row
            .try_get::<Option<serde_json::Value>, _>("artifact_evidence_json")
            .map_err(storage)?
            != Some(serde_json::to_value(&expected.evidence).map_err(storage)?)
    {
        return Err(storage("successor Product Edge custody changed"));
    }
    validate_historical_view(&persisted_view, &expected.view)?;
    Ok(())
}

async fn load_by_decision_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    composition: Option<&SuccessorResearchIntentCompositionRequestV1>,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_successor_research_intents_v1 WHERE decision_identity=$1 FOR SHARE")
        .bind(decision_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    admit_rows(transaction, rows, composition).await
}

pub(crate) async fn load_by_intent_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_successor_research_intents_v1 WHERE intent_identity=$1 FOR SHARE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    admit_rows(transaction, rows, None).await
}

pub(crate) async fn lock_by_intent_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT intent_identity,intent_digest,request_identity,decision_identity,result_identity,trial_family_identity,predecessor_intent_identity,request_json,intent_json,receipt_json,request_storage_bytes,request_storage_digest,intent_storage_bytes,intent_storage_digest,receipt_storage_bytes,receipt_storage_digest,committed_at_epoch_ms FROM rd_successor_research_intents_v1 WHERE intent_identity=$1 FOR UPDATE")
        .bind(intent_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    admit_rows(transaction, rows, None).await
}

async fn admit_rows(
    transaction: &mut Transaction<'_, Postgres>,
    rows: Vec<sqlx::postgres::PgRow>,
    composition: Option<&SuccessorResearchIntentCompositionRequestV1>,
) -> Result<Option<SuccessorResearchIntentReadbackV1>, SuccessorResearchIntentPostgresErrorV1> {
    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() != 1 {
        return Err(storage("successor Intent identity is not unique"));
    }
    let row = &rows[0];
    let request_bytes: Vec<u8> = row.try_get("request_storage_bytes").map_err(storage)?;
    let intent_bytes: Vec<u8> = row.try_get("intent_storage_bytes").map_err(storage)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_storage_bytes").map_err(storage)?;
    if row
        .try_get::<String, _>("request_storage_digest")
        .map_err(storage)?
        != storage_digest(
            "rd.successor-research-intent-request.storage.v1",
            &request_bytes,
        )
        || row
            .try_get::<String, _>("intent_storage_digest")
            .map_err(storage)?
            != storage_digest("rd.successor-research-intent.storage.v1", &intent_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(storage)?
            != storage_digest(
                "rd.successor-research-intent-receipt.storage.v1",
                &receipt_bytes,
            )
    {
        return Err(storage("successor Intent storage digest mismatch"));
    }
    let stored_request: SuccessorResearchIntentCompositionRequestV1 =
        serde_json::from_slice(&request_bytes).map_err(storage)?;
    if composition.is_some_and(|request| request != &stored_request) {
        return Err(storage("successor Intent composition retry mismatch"));
    }
    let readback =
        admit_stored_successor_research_intent_v1(&request_bytes, &intent_bytes, &receipt_bytes)?;
    let intent = readback.intent();
    let receipt = readback.receipt();

    if row
        .try_get::<serde_json::Value, _>("request_json")
        .map_err(storage)?
        != serde_json::to_value(&stored_request).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("intent_json")
            .map_err(storage)?
            != serde_json::to_value(intent).map_err(storage)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(receipt).map_err(storage)?
        || row
            .try_get::<String, _>("intent_identity")
            .map_err(storage)?
            != intent.intent_identity()
        || row.try_get::<String, _>("intent_digest").map_err(storage)? != intent.intent_digest()
        || row
            .try_get::<String, _>("request_identity")
            .map_err(storage)?
            != intent.request_identity()
        || row
            .try_get::<String, _>("decision_identity")
            .map_err(storage)?
            != intent.decision_identity()
        || row
            .try_get::<String, _>("result_identity")
            .map_err(storage)?
            != intent.result_identity()
        || row
            .try_get::<String, _>("trial_family_identity")
            .map_err(storage)?
            != intent.trial_family_identity()
        || row
            .try_get::<String, _>("predecessor_intent_identity")
            .map_err(storage)?
            != intent.predecessor_intent_identity()
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(receipt.committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("successor Intent row/readback mismatch"));
    }
    verify_outbox(transaction, &readback).await?;
    Ok(Some(readback))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SuccessorIntentCommittedOutboxV1 {
    schema_version: u16,
    intent_identity: String,
    intent_digest: String,
    receipt_identity: String,
    request_identity: String,
    predecessor_intent_identity: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    trial_family_identity: String,
    census_frontier_identity: String,
    experiment_identity: String,
    experiment_digest: String,
}

fn outbox_payload(
    readback: &SuccessorResearchIntentReadbackV1,
) -> SuccessorIntentCommittedOutboxV1 {
    let intent = readback.intent();
    SuccessorIntentCommittedOutboxV1 {
        schema_version: 1,
        intent_identity: intent.intent_identity().to_string(),
        intent_digest: intent.intent_digest().to_string(),
        receipt_identity: readback.receipt().receipt_identity().to_string(),
        request_identity: intent.request_identity().to_string(),
        predecessor_intent_identity: intent.predecessor_intent_identity().to_string(),
        decision_identity: intent.decision_identity().to_string(),
        decision_digest: intent.decision_digest().to_string(),
        result_identity: intent.result_identity().to_string(),
        trial_family_identity: intent.trial_family_identity().to_string(),
        census_frontier_identity: intent.census_frontier_identity().to_string(),
        experiment_identity: intent.experiment_identity().to_string(),
        experiment_digest: intent.experiment_digest().to_string(),
    }
}

async fn persist_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let payload = outbox_payload(readback);
    let payload_json = serde_json::to_value(&payload).map_err(storage)?;
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let payload_digest = storage_digest(
        "rd.owner-outbox.successor-research-intent.v1",
        &payload_bytes,
    );
    let event_identity = format!(
        "rd-owner-outbox-successor-research-intent-v1-{}",
        payload_digest.trim_start_matches("sha256:")
    );
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(readback.intent().intent_identity())
        .bind(SUCCESSOR_INTENT_COMMITTED_EVENT_V1)
        .bind(payload_digest)
        .bind(payload_json)
        .bind(i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn verify_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &SuccessorResearchIntentReadbackV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2 FOR SHARE")
        .bind(readback.intent().intent_identity())
        .bind(SUCCESSOR_INTENT_COMMITTED_EVENT_V1)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Intent outbox custody is incomplete"));
    }
    let payload = outbox_payload(readback);
    let payload_bytes = serde_json::to_vec(&payload).map_err(storage)?;
    let row = &rows[0];
    if row
        .try_get::<String, _>("aggregate_identity")
        .map_err(storage)?
        != readback.intent().intent_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)?
            != SUCCESSOR_INTENT_COMMITTED_EVENT_V1
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != storage_digest(
                "rd.owner-outbox.successor-research-intent.v1",
                &payload_bytes,
            )
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != serde_json::to_value(payload).map_err(storage)?
        || row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?
            != i64::try_from(readback.receipt().committed_at_epoch_ms()).map_err(storage)?
    {
        return Err(storage("successor Intent outbox/readback mismatch"));
    }
    Ok(())
}

async fn load_decision_family_identity(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
    result_identity: &str,
) -> Result<String, SuccessorResearchIntentPostgresErrorV1> {
    let rows = sqlx::query("SELECT trial_family_identity FROM rd_iteration_decisions_v1 WHERE decision_identity=$1 AND result_identity=$2 FOR SHARE")
        .bind(decision_identity)
        .bind(result_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    if rows.len() != 1 {
        return Err(storage("successor Decision custody is incomplete"));
    }
    rows[0].try_get("trial_family_identity").map_err(storage)
}

async fn lock_composition_key(
    transaction: &mut Transaction<'_, Postgres>,
    decision_identity: &str,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(decision_identity)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn validate_composition_request(
    request: &SuccessorResearchIntentCompositionRequestV1,
) -> Result<(), SuccessorResearchIntentPostgresErrorV1> {
    if is_valid_iteration_decision_locator_v1(&request.request_identity)
        && is_valid_iteration_decision_locator_v1(&request.decision_identity)
        && is_valid_iteration_decision_locator_v1(&request.result_identity)
    {
        Ok(())
    } else {
        Err(SuccessorResearchIntentPostgresErrorV1::InvalidLocator)
    }
}

fn valid_identity(value: &str) -> bool {
    is_valid_iteration_decision_locator_v1(value)
}

async fn owner_clock_epoch_ms_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, SuccessorResearchIntentPostgresErrorV1> {
    crate::rd_owner_clock::owner_clock_epoch_ms_in_transaction(transaction)
        .await
        .map_err(storage)
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    crate::native_replay_rd_sources_v2::owner_storage_digest(domain, bytes)
}

fn storage(error: impl Display) -> SuccessorResearchIntentPostgresErrorV1 {
    SuccessorResearchIntentPostgresErrorV1::Storage(error.to_string())
}

#[allow(dead_code)]
fn _assert_serialize_only(_: &FrozenSuccessorResearchIntentV1) {}
