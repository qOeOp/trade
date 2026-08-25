use std::fmt::Display;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};
use vibe_qualification::PostgresQualificationOwnerV1;

use crate::exploratory_replay::{
    ExploratoryReplayCommitResultV1, ExploratoryReplayOwnerError, ExploratoryReplayReadResultV1,
    ExploratoryReplayRequestLocatorV1, ExploratoryReplayRequestProposalV1,
};
use crate::product_edge::{
    FrozenResearchGoalIntent, IndependenceBasisReadbackV1, IndependenceBasisReceiptV1,
    ProductEdgeResearchGoalRequestV2, ProductEdgeResolution, ResearchGoalOwnerError,
    ResearchGoalOwnerPortV2, ResearchGoalOwnerResultV1, ResearchGoalOwnerResultV2,
    ResearchLineageResolutionV1, ResearchRequestReceiptV1, StoredAdmittedResearchRequestV2,
    StoredIndependenceBasisV1, StoredProtectedFeedbackProjectionV1,
    StoredRejectedResearchRequestV2, ValidatedResearchGoalRequestV2, decide_commit_v2,
    decide_rejected_commit_v2, semantic_digest_v2, unresolved_result, unresolved_result_v2,
    validate_goal_request_v2, verify_research_admission_v2,
};
use crate::rd_owner_postgres_custody::{
    ResearchCustodyLookupV1, admit_all_research_custodies_in_transaction,
    admit_independence_basis_by_identity_in_transaction, admit_research_custody_in_transaction,
    require_rd_owner_api_schema, resolve_verified_artifact_family,
};
use crate::{
    trial_family::{
        TrialFamilyDirectResultV1, TrialFamilyError, TrialFamilyIndependenceDispositionV1,
        TrialFamilyPolicyV1,
    },
    trial_family_postgres::{migrate as migrate_trial_family, persist_initial_family},
};

#[derive(Debug, Clone)]
pub struct PostgresResearchGoalOwnerV1 {
    pool: PgPool,
    qualification: PostgresQualificationOwnerV1,
    backtest: Option<crate::exploratory_replay::postgres::BoundBacktestReadV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResearchRequestIdentityPreflightV1 {
    Vacant,
    Current,
    LegacyQuarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct CurrentResearchArtifactEvidenceV1 {
    schema_version: u32,
    evidence_identity: String,
    request_identity: String,
    semantic_digest: String,
    source_admission: ProductEdgeAdmissionLocatorV1,
    effective_principal: String,
    authorized_scope: Vec<String>,
    receipt_identity: String,
    intent_identity: String,
    view_identity: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

fn current_research_artifact_evidence_digest(
    evidence: &CurrentResearchArtifactEvidenceV1,
) -> Result<String, ResearchGoalOwnerError> {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd-owner.current-research-artifact-evidence.v1",
        "evidence": evidence,
    }))
    .map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
pub(crate) fn reseal_current_research_artifact_evidence_for_test(
    view_json: serde_json::Value,
    evidence_json: serde_json::Value,
    valid_through_epoch_ms: u64,
) -> Result<(serde_json::Value, serde_json::Value, String), ResearchGoalOwnerError> {
    let mut view: crate::product_edge::ResearchViewV1 =
        serde_json::from_value(view_json).map_err(json_storage)?;
    let mut evidence: CurrentResearchArtifactEvidenceV1 =
        serde_json::from_value(evidence_json).map_err(json_storage)?;
    view.valid_through_epoch_ms = valid_through_epoch_ms;
    evidence.valid_through_epoch_ms = valid_through_epoch_ms;
    let digest = current_research_artifact_evidence_digest(&evidence)?;
    Ok((
        serde_json::to_value(view).map_err(json_storage)?,
        serde_json::to_value(evidence).map_err(json_storage)?,
        digest,
    ))
}

impl PostgresResearchGoalOwnerV1 {
    pub async fn connect(
        database_url: &str,
        qualification_database_url: &str,
    ) -> Result<Self, ResearchGoalOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|e| storage(&e))?;
        Self::migrate_rd_storage(&pool).await?;
        let qualification = PostgresQualificationOwnerV1::connect(qualification_database_url)
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
        Ok(Self {
            pool,
            qualification,
            backtest: None,
        })
    }

    pub async fn connect_with_backtest(
        database_url: &str,
        qualification_database_url: &str,
        backtest_database_url: &str,
    ) -> Result<Self, ResearchGoalOwnerError> {
        let mut owner = Self::connect(database_url, qualification_database_url).await?;
        owner.backtest = Some(
            crate::exploratory_replay::postgres::bind_backtest_read(
                &owner.pool,
                backtest_database_url,
            )
            .await
            .map_err(json_storage)?,
        );
        Ok(owner)
    }

    async fn migrate_rd_storage(pool: &PgPool) -> Result<(), ResearchGoalOwnerError> {
        require_rd_owner_api_schema(pool)
            .await
            .map_err(|e| storage(&e))?;
        sqlx::query(
            "
            CREATE TABLE IF NOT EXISTS rd_research_request_receipts_v1 (
                request_identity TEXT PRIMARY KEY,
                semantic_digest TEXT NOT NULL,
                request_json JSONB,
                receipt_json JSONB NOT NULL,
                intent_json JSONB,
                view_json JSONB,
                committed_at_epoch_ms BIGINT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await
        .map_err(|e| storage(&e))?;
        sqlx::query("ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS request_json JSONB")
            .execute(pool)
            .await
            .map_err(|e| storage(&e))?;

        for statement in [
            "ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_digest TEXT",
            "ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_json JSONB",
            "CREATE UNIQUE INDEX IF NOT EXISTS rd_research_intent_identity_v1 ON rd_research_request_receipts_v1 ((intent_json->>'intent_identity')) WHERE intent_json IS NOT NULL",
            "REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC",
            "GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner, qualification_writer",
            "REVOKE ALL ON TABLE public.rd_research_request_receipts_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .map_err(|e| storage(&e))?;
        }
        sqlx::query(
            "
            CREATE OR REPLACE FUNCTION rd_owner_api.peek_current_research_for_artifact_v1(requested_intent_identity text)
            RETURNS jsonb LANGUAGE plpgsql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
            SET search_path = pg_catalog
            AS $function$
            DECLARE sealed record;
            BEGIN
              SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json,
                     view_json, artifact_evidence_digest, artifact_evidence_json
                INTO sealed
                FROM public.rd_research_request_receipts_v1
               WHERE intent_json->>'intent_identity' = requested_intent_identity;
              IF NOT FOUND OR sealed.artifact_evidence_json IS NULL OR sealed.artifact_evidence_digest IS NULL
                 OR sealed.artifact_evidence_json->>'schema_version' <> '1'
                 OR sealed.request_json->>'schema_version' <> '1'
                 OR sealed.request_json->'request'->>'request_identity' <> sealed.request_identity
                 OR sealed.receipt_json->>'request_identity' <> sealed.request_identity
                 OR sealed.receipt_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.receipt_json->>'disposition' <> 'ACCEPTED'
                 OR sealed.intent_json->>'request_identity' <> sealed.request_identity
                 OR sealed.intent_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.view_json->>'request_identity' <> sealed.request_identity
                 OR sealed.view_json->>'intent_identity' <> requested_intent_identity
                 OR sealed.view_json->>'availability' <> 'AVAILABLE'
                 OR sealed.view_json->>'phase' <> 'INTENT_FROZEN'
                 OR sealed.artifact_evidence_json->>'request_identity' <> sealed.request_identity
                 OR sealed.artifact_evidence_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.artifact_evidence_json->>'intent_identity' <> requested_intent_identity
                 OR sealed.artifact_evidence_json->>'receipt_identity' <> sealed.receipt_json->>'receipt_identity'
                 OR sealed.artifact_evidence_json->>'view_identity' <> sealed.view_json->>'projection_identity'
                 OR sealed.artifact_evidence_json->>'projection_at_epoch_ms' <> sealed.view_json->>'projection_at_epoch_ms'
                 OR sealed.artifact_evidence_json->>'valid_through_epoch_ms' <> sealed.view_json->>'valid_through_epoch_ms'
                 OR sealed.artifact_evidence_json->'source_admission' <> sealed.request_json->'request'->'admission'
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
        .map_err(|e| storage(&e))?;
        sqlx::query(
            "
            CREATE OR REPLACE FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(
              requested_intent_identity text, requested_evidence_identity text, requested_evidence_digest text
            ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
            SET search_path = pg_catalog
            AS $function$
            DECLARE sealed record;
            BEGIN
              IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
              SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json,
                     view_json, artifact_evidence_digest, artifact_evidence_json
                INTO sealed
                FROM public.rd_research_request_receipts_v1
               WHERE intent_json->>'intent_identity' = requested_intent_identity
               FOR SHARE;
              IF NOT FOUND OR sealed.artifact_evidence_json IS NULL
                 OR sealed.artifact_evidence_json->>'schema_version' <> '1'
                 OR sealed.request_json->>'schema_version' <> '1'
                 OR sealed.artifact_evidence_digest <> requested_evidence_digest
                 OR sealed.artifact_evidence_json->>'evidence_identity' <> requested_evidence_identity
                 OR sealed.request_json->'request'->>'request_identity' <> sealed.request_identity
                 OR sealed.receipt_json->>'request_identity' <> sealed.request_identity
                 OR sealed.receipt_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.receipt_json->>'disposition' <> 'ACCEPTED'
                 OR sealed.intent_json->>'request_identity' <> sealed.request_identity
                 OR sealed.intent_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.view_json->>'request_identity' <> sealed.request_identity
                 OR sealed.view_json->>'intent_identity' <> requested_intent_identity
                 OR sealed.view_json->>'availability' <> 'AVAILABLE'
                 OR sealed.view_json->>'phase' <> 'INTENT_FROZEN'
                 OR sealed.artifact_evidence_json->>'request_identity' <> sealed.request_identity
                 OR sealed.artifact_evidence_json->>'semantic_digest' <> sealed.semantic_digest
                 OR sealed.artifact_evidence_json->>'intent_identity' <> requested_intent_identity
                 OR sealed.artifact_evidence_json->>'receipt_identity' <> sealed.receipt_json->>'receipt_identity'
                 OR sealed.artifact_evidence_json->>'view_identity' <> sealed.view_json->>'projection_identity'
                 OR sealed.artifact_evidence_json->>'projection_at_epoch_ms' <> sealed.view_json->>'projection_at_epoch_ms'
                 OR sealed.artifact_evidence_json->>'valid_through_epoch_ms' <> sealed.view_json->>'valid_through_epoch_ms'
                 OR sealed.artifact_evidence_json->'source_admission' <> sealed.request_json->'request'->'admission'
              THEN RETURN NULL; END IF;
              RETURN pg_catalog.jsonb_build_object(
                'owner_cut_epoch_ms', pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint,
                'evidence_digest', sealed.artifact_evidence_digest,
                'evidence', sealed.artifact_evidence_json
              );
            END
            $function$
            ",
        )
        .execute(pool)
        .await
        .map_err(|e| storage(&e))?;

        for statement in [
            "ALTER FUNCTION rd_owner_api.peek_current_research_for_artifact_v1(text) OWNER TO rd_owner",
            "ALTER FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(text,text,text) OWNER TO rd_owner",
            "REVOKE ALL ON FUNCTION rd_owner_api.peek_current_research_for_artifact_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
            "REVOKE ALL ON FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer",
            "GRANT EXECUTE ON FUNCTION rd_owner_api.peek_current_research_for_artifact_v1(text) TO product_edge_owner",
            "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(text,text,text) TO product_edge_owner",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .map_err(|e| storage(&e))?;
        }

        for statement in [
            "CREATE TABLE IF NOT EXISTS rd_independence_bases_v1 (basis_identity TEXT PRIMARY KEY, request_identity TEXT NOT NULL UNIQUE, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, lineage_digest TEXT NOT NULL, basis_digest TEXT NOT NULL, basis_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rd_independence_basis_admissions_v1 (basis_identity TEXT PRIMARY KEY REFERENCES rd_independence_bases_v1(basis_identity) ON DELETE CASCADE, request_identity TEXT NOT NULL UNIQUE, request_semantic_digest TEXT NOT NULL, admission_json JSONB NOT NULL, admission_lineage_digest TEXT NOT NULL, custody_digest TEXT NOT NULL, custody_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rd_independence_basis_heads_v1 (principal_scope_key TEXT PRIMARY KEY, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, basis_identity TEXT NOT NULL REFERENCES rd_independence_bases_v1(basis_identity), lineage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .map_err(|e| storage(&e))?;
        }
        migrate_trial_family(pool)
            .await
            .map_err(|e| trial_family_storage(&e))?;
        crate::exploratory_replay::postgres::migrate(pool)
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
        let mut publication = pool.begin().await.map_err(|e| storage(&e))?;
        sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS rd_owner_outbox_aggregate_kind_v1 ON public.rd_owner_outbox_v1 (aggregate_identity, event_kind)")
            .execute(&mut *publication)
            .await
            .map_err(|e| storage(&e))?;
        sqlx::query("DROP FUNCTION IF EXISTS rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,text,jsonb)")
            .execute(&mut *publication)
            .await
            .map_err(|e| storage(&e))?;
        sqlx::query(
            "
            CREATE OR REPLACE FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(
              requested_basis_identity text,
              requested_basis_digest text,
              requested_principal text,
              requested_request_scope jsonb
            ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
            SET search_path = pg_catalog
            AS $function$
            DECLARE
              locked_basis record;
              locked_outbox record;
            BEGIN
              IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
              SELECT basis_identity, request_identity, principal, request_scope_json, lineage_digest,
                     basis_digest, basis_json, receipt_json, committed_at_epoch_ms
                INTO locked_basis
                FROM public.rd_independence_bases_v1
               WHERE basis_identity = requested_basis_identity
                 AND basis_digest = requested_basis_digest
                 AND principal = requested_principal
                 AND request_scope_json = requested_request_scope
               FOR SHARE;
              IF NOT FOUND THEN RETURN NULL; END IF;
              SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
                     committed_at_epoch_ms
                INTO STRICT locked_outbox
                FROM public.rd_owner_outbox_v1
               WHERE aggregate_identity = requested_basis_identity
                 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1'
               FOR SHARE;
              RETURN pg_catalog.jsonb_build_object(
                'schema_version', 1,
                'basis', pg_catalog.jsonb_build_object(
                  'basis_identity', locked_basis.basis_identity,
                  'request_identity', locked_basis.request_identity,
                  'principal', locked_basis.principal,
                  'request_scope_json', locked_basis.request_scope_json,
                  'lineage_digest', locked_basis.lineage_digest,
                  'basis_digest', locked_basis.basis_digest,
                  'basis_json', locked_basis.basis_json,
                  'receipt_json', locked_basis.receipt_json,
                  'committed_at_epoch_ms', locked_basis.committed_at_epoch_ms
                ),
                'outbox', pg_catalog.jsonb_build_object(
                  'event_identity', locked_outbox.event_identity,
                  'aggregate_identity', locked_outbox.aggregate_identity,
                  'event_kind', locked_outbox.event_kind,
                  'payload_digest', locked_outbox.payload_digest,
                  'payload_json', locked_outbox.payload_json,
                  'committed_at_epoch_ms', locked_outbox.committed_at_epoch_ms
                )
              );
            END
            $function$
            ",
        )
        .execute(&mut *publication)
        .await
        .map_err(|e| storage(&e))?;

        for statement in [
            "ALTER FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) OWNER TO rd_owner",
            "REVOKE ALL ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner",
            "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) TO qualification_writer",
            "REVOKE ALL ON TABLE rd_independence_bases_v1, rd_owner_outbox_v1 FROM qualification_owner, qualification_writer",
        ] {
            sqlx::query(statement)
                .execute(&mut *publication)
                .await
                .map_err(|e| storage(&e))?;
        }
        publication.commit().await.map_err(|e| storage(&e))?;
        Ok(())
    }

    /// Freezes one request only after the complete current R&D lineage is locked and revalidated.
    pub async fn commit_exploratory_replay_request_v1(
        &self,
        proposal: ExploratoryReplayRequestProposalV1,
    ) -> Result<ExploratoryReplayCommitResultV1, ExploratoryReplayOwnerError> {
        Box::pin(crate::exploratory_replay::postgres::commit(
            &self.pool, proposal,
        ))
        .await
    }

    /// Uses a canonical `backtest_owner` session to consume only the sealed R&D lock API.
    pub async fn lock_exploratory_replay_request_for_backtest_v1(
        &self,
        locator: &ExploratoryReplayRequestLocatorV1,
    ) -> Result<ExploratoryReplayReadResultV1, ExploratoryReplayOwnerError> {
        let backtest = self.backtest.as_ref().ok_or_else(|| {
            ExploratoryReplayOwnerError::Unavailable(
                "R&D Owner has no bound Backtest read capability".into(),
            )
        })?;
        crate::exploratory_replay::postgres::lock_for_backtest(&self.pool, backtest, locator).await
    }

    pub async fn preflight_request_identity(
        &self,
        request_identity: &str,
    ) -> Result<ResearchRequestIdentityPreflightV1, ResearchGoalOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let custody = admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestAny(request_identity),
        )
        .await?;
        transaction.commit().await.map_err(|e| storage(&e))?;
        Ok(match custody {
            None => ResearchRequestIdentityPreflightV1::Vacant,
            Some(custody) if custody.product_edge_admission().is_some() => {
                ResearchRequestIdentityPreflightV1::Current
            }
            Some(_) => ResearchRequestIdentityPreflightV1::LegacyQuarantined,
        })
    }

    pub async fn resolve_legacy_quarantined_v1(
        &self,
        request_identity: &str,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let custody = admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestAny(request_identity),
        )
        .await?
        .ok_or_else(|| ResearchGoalOwnerError::Storage("legacy research custody missing".into()))?;
        if custody.product_edge_admission().is_some() || custody.request_schema_version() != 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "research custody is not legacy quarantined".into(),
            ));
        }
        let result = custody.into_legacy_quarantined_v1_result()?;
        transaction.commit().await.map_err(|e| storage(&e))?;
        Ok(result)
    }

    pub async fn resolve_historical_v1(
        &self,
        request_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        let read_cut = current_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let custody = Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestV1(request_identity),
        ))
        .await?;
        transaction.commit().await.map_err(|e| storage(&e))?;

        match custody {
            Some(custody)
                if custody
                    .product_edge_admission()
                    .map(ProductEdgeAdmissionReadbackV1::locator)
                    == Some(admission) =>
            {
                custody.into_v1_result(read_cut)
            }
            Some(_) => Err(ResearchGoalOwnerError::ConflictingReplay),
            None => Ok(unresolved_result(request_identity)),
        }
    }

    pub async fn resolve_trial_family_by_intent(
        &self,
        intent_identity: &str,
    ) -> Result<TrialFamilyDirectResultV1, TrialFamilyError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
        let custody = Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::Intent(intent_identity),
        ))
        .await
        .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?
        .ok_or_else(|| TrialFamilyError::Unavailable("research custody missing".to_string()))?;
        if !custody
            .intent()
            .is_some_and(FrozenResearchGoalIntent::is_v2)
        {
            return Err(TrialFamilyError::LegacyUnavailable);
        }
        let family = custody
            .family()
            .cloned()
            .ok_or_else(|| TrialFamilyError::Unavailable("family custody missing".to_string()))?;
        transaction
            .commit()
            .await
            .map_err(|e| TrialFamilyError::Unavailable(e.to_string()))?;
        Ok(TrialFamilyDirectResultV1::available_by_intent(family))
    }

    pub async fn resolve_trial_family_by_artifact(
        &self,
        artifact_identity: &str,
        build_receipt_identity: &str,
    ) -> Result<TrialFamilyDirectResultV1, TrialFamilyError> {
        let readback = Box::pin(resolve_verified_artifact_family(
            &self.pool,
            artifact_identity,
            build_receipt_identity,
        ))
        .await?;
        Ok(TrialFamilyDirectResultV1::available_by_artifact(readback))
    }

    async fn resolve_v2_at(
        &self,
        request_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
        read_cut: u64,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let policy_current = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            admission,
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: read_cut,
            },
        )
        .await
        .ok()
        .is_some_and(|current| current.authorizes_first_mutation_at(read_cut));
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(request_identity)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        let custody = match Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestV2(request_identity),
        ))
        .await
        {
            Ok(custody) => custody,
            Err(_) => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(request_identity));
            }
        };
        let Some(custody) = custody else {
            transaction.commit().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(request_identity));
        };

        if custody
            .product_edge_admission()
            .map(ProductEdgeAdmissionReadbackV1::locator)
            != Some(admission)
        {
            return Err(ResearchGoalOwnerError::ConflictingReplay);
        }
        transaction.commit().await.map_err(|e| storage(&e))?;
        custody.into_v2_result_with_policy_current(read_cut, policy_current)
    }
}

#[derive(Serialize)]
struct BasisMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    rationale_digest: &'a str,
    independence_disposition: &'a TrialFamilyIndependenceDispositionV1,
    lineage_resolution: &'a ResearchLineageResolutionV1,
    semantic_predecessor_frontier: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Serialize)]
struct BasisReceiptMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct BasisOutboxPayloadV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    receipt_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredBasisStageCustodyV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    request_identity: String,
    request_semantic_digest: String,
    request: ProductEdgeResearchGoalRequestV2,
    admission: ProductEdgeAdmissionLocatorV1,
    admission_lineage_digest: String,
    committed_at_epoch_ms: u64,
    custody_digest: String,
}

#[derive(Serialize)]
struct BasisStageCustodyMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    request_identity: &'a str,
    request_semantic_digest: &'a str,
    request: &'a ProductEdgeResearchGoalRequestV2,
    admission: &'a ProductEdgeAdmissionLocatorV1,
    admission_lineage_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Debug)]
struct VerifiedBasisStageCustodyV1 {
    basis: IndependenceBasisReadbackV1,
    request_semantic_digest: String,
    request: ProductEdgeResearchGoalRequestV2,
    admission: ProductEdgeAdmissionLocatorV1,
    admission_lineage_digest: String,
}

async fn lock_principal_scope(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal: &str,
    scope: &[String],
) -> Result<String, ResearchGoalOwnerError> {
    let key = canonical_digest("rd.principal-request-scope.v1", &(principal, scope))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&key)
        .execute(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    Ok(key)
}

async fn resolve_lineage_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal: &str,
    scope: &[String],
) -> Result<(ResearchLineageResolutionV1, Vec<String>, String), ResearchGoalOwnerError> {
    let custodies = admit_all_research_custodies_in_transaction(transaction).await?;
    let mut ordered = Vec::new();
    let mut unique = std::collections::BTreeSet::new();

    for custody in custodies {
        if custody.receipt().disposition
            != crate::product_edge::ResearchRequestDisposition::Accepted
            || custody.effective_principal() != principal
            || custody.authorized_scope() != scope
        {
            continue;
        }

        if custody.request_schema_version() == 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "canonical V1 research lineage is unavailable for TrialFamily formation".into(),
            ));
        }
        let intent = custody.intent().ok_or_else(|| {
            ResearchGoalOwnerError::Storage("accepted R&D lineage intent missing".into())
        })?;

        if !intent.is_v2() || !unique.insert(intent.intent_identity().to_string()) {
            return Err(ResearchGoalOwnerError::Storage(
                "R&D lineage intent is ambiguous".into(),
            ));
        }
        ordered.push((
            custody.receipt().committed_at_epoch_ms,
            custody.receipt().request_identity.clone(),
            intent.intent_identity().to_string(),
        ));
    }
    ordered.sort();
    let frontier: Vec<String> = ordered
        .into_iter()
        .map(|(_, _, intent_identity)| intent_identity)
        .collect();
    let resolution = if frontier.is_empty() {
        ResearchLineageResolutionV1::GenesisEmpty
    } else {
        ResearchLineageResolutionV1::CompleteFrontier
    };
    let lineage_digest = canonical_digest(
        "rd.semantic-predecessor-frontier.v1",
        &(principal, scope, resolution, &frontier),
    )?;
    Ok((resolution, frontier, lineage_digest))
}

async fn load_or_create_basis_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &ProductEdgeResearchGoalRequestV2,
    request_semantic_digest: &str,
    admission: &ProductEdgeAdmissionReadbackV1,
    now_epoch_ms: u64,
) -> Result<IndependenceBasisReadbackV1, ResearchGoalOwnerError> {
    let principal = admission.effective_principal();
    let scope = admission.authorized_scope();
    let key = lock_principal_scope(transaction, principal, scope).await?;

    if let Some(existing_row) = sqlx::query(
        "SELECT basis_identity FROM rd_independence_bases_v1 WHERE request_identity = $1 FOR SHARE",
    )
    .bind(&request.request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?
    {
        let basis_identity: String = existing_row
            .try_get("basis_identity")
            .map_err(|e| storage(&e))?;
        let existing = load_basis_stage_custody_for_request_in_transaction(
            transaction,
            &request.request_identity,
        )
        .await?
        .ok_or_else(|| ResearchGoalOwnerError::Storage("R&D basis-stage custody missing".into()))?;
        let stored = existing.basis.stored();
        if stored.principal != *principal
            || stored.request_scope != *scope
            || existing.request_semantic_digest != request_semantic_digest
            || &existing.admission != admission.locator()
            || existing.basis.basis_identity() != basis_identity
            || stored.rationale_digest
                != canonical_digest(
                    "rd.independence-rationale.v1",
                    &request.trial_family_proposal.independence_rationale,
                )?
        {
            return Err(ResearchGoalOwnerError::ConflictingReplay);
        }
        return Ok(existing.basis);
    }
    let (lineage_resolution, frontier, lineage_digest) =
        resolve_lineage_in_transaction(transaction, principal, scope).await?;
    let head = sqlx::query("SELECT basis_identity, lineage_digest, principal, request_scope_json FROM rd_independence_basis_heads_v1 WHERE principal_scope_key = $1 FOR UPDATE")
        .bind(&key)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    if let Some(head) = head {
        let head_lineage: String = head.try_get("lineage_digest").map_err(|e| storage(&e))?;
        let head_basis: String = head.try_get("basis_identity").map_err(|e| storage(&e))?;
        let head_principal: String = head.try_get("principal").map_err(|e| storage(&e))?;
        let head_scope: Vec<String> = serde_json::from_value(
            head.try_get("request_scope_json")
                .map_err(|e| storage(&e))?,
        )
        .map_err(json_storage)?;

        if head_principal != *principal || head_scope != *scope {
            return Err(ResearchGoalOwnerError::Storage(
                "R&D basis head scope mismatch".into(),
            ));
        }

        if head_lineage == lineage_digest {
            let existing = load_basis_stage_custody_for_request_in_transaction(
                transaction,
                &request.request_identity,
            )
            .await?
            .ok_or_else(|| {
                ResearchGoalOwnerError::Storage("R&D basis-stage custody missing".into())
            })?;

            if existing.basis.basis_identity() != head_basis
                || existing.basis.stored().request_identity != request.request_identity
                || existing.request_semantic_digest != request_semantic_digest
                || &existing.admission != admission.locator()
                || existing.basis.stored().rationale_digest
                    != canonical_digest(
                        "rd.independence-rationale.v1",
                        &request.trial_family_proposal.independence_rationale,
                    )?
            {
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
            return Ok(existing.basis);
        }
    }

    let rationale_digest = canonical_digest(
        "rd.independence-rationale.v1",
        &request.trial_family_proposal.independence_rationale,
    )?;
    let disposition = if frontier.is_empty() {
        TrialFamilyIndependenceDispositionV1::Independent
    } else {
        TrialFamilyIndependenceDispositionV1::Related
    };
    let mut stored = StoredIndependenceBasisV1 {
        schema_version: 1,
        basis_identity: String::new(),
        request_identity: request.request_identity.clone(),
        principal: principal.to_string(),
        request_scope: scope.to_vec(),
        rationale_digest,
        independence_disposition: disposition,
        lineage_resolution,
        semantic_predecessor_frontier: frontier,
        lineage_digest,
        basis_digest: String::new(),
    };
    stored.basis_digest = canonical_digest(
        "rd.independence-basis.v1",
        &BasisMeaningV1 {
            schema_version: 1,
            request_identity: &stored.request_identity,
            principal: &stored.principal,
            request_scope: &stored.request_scope,
            rationale_digest: &stored.rationale_digest,
            independence_disposition: &stored.independence_disposition,
            lineage_resolution: &stored.lineage_resolution,
            semantic_predecessor_frontier: &stored.semantic_predecessor_frontier,
            lineage_digest: &stored.lineage_digest,
        },
    )?;
    stored.basis_identity = identity("rd-independence-basis-v1", &stored.basis_digest);
    let receipt_digest = canonical_digest(
        "rd.independence-basis-receipt.v1",
        &BasisReceiptMeaningV1 {
            schema_version: 1,
            basis_identity: &stored.basis_identity,
            basis_digest: &stored.basis_digest,
            committed_at_epoch_ms: now_epoch_ms,
        },
    )?;
    let receipt = IndependenceBasisReceiptV1::new(
        identity("rd-independence-basis-receipt-v1", &receipt_digest),
        stored.basis_identity.clone(),
        stored.basis_digest.clone(),
        now_epoch_ms,
    );
    let mut stage_custody = StoredBasisStageCustodyV1 {
        schema_version: 1,
        basis_identity: stored.basis_identity.clone(),
        basis_digest: stored.basis_digest.clone(),
        request_identity: stored.request_identity.clone(),
        request_semantic_digest: request_semantic_digest.to_string(),
        request: request.clone(),
        admission: admission.locator().clone(),
        admission_lineage_digest: canonical_digest(
            "rd.product-edge-admission-lineage.v1",
            admission,
        )?,
        committed_at_epoch_ms: now_epoch_ms,
        custody_digest: String::new(),
    };
    stage_custody.custody_digest = canonical_digest(
        "rd.independence-basis-stage-custody.v1",
        &BasisStageCustodyMeaningV1 {
            schema_version: stage_custody.schema_version,
            basis_identity: &stage_custody.basis_identity,
            basis_digest: &stage_custody.basis_digest,
            request_identity: &stage_custody.request_identity,
            request_semantic_digest: &stage_custody.request_semantic_digest,
            request: &stage_custody.request,
            admission: &stage_custody.admission,
            admission_lineage_digest: &stage_custody.admission_lineage_digest,
            committed_at_epoch_ms: stage_custody.committed_at_epoch_ms,
        },
    )?;
    let basis_json = serde_json::to_value(&stored).map_err(json_storage)?;
    let receipt_json = serde_json::to_value(&receipt).map_err(json_storage)?;
    sqlx::query("INSERT INTO rd_independence_bases_v1 (basis_identity, request_identity, principal, request_scope_json, lineage_digest, basis_digest, basis_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&stored.basis_identity).bind(&stored.request_identity).bind(&stored.principal)
        .bind(serde_json::to_value(&stored.request_scope).map_err(json_storage)?)
        .bind(&stored.lineage_digest).bind(&stored.basis_digest).bind(basis_json).bind(receipt_json)
        .bind(i64::try_from(now_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction).await.map_err(|e| storage(&e))?;
    sqlx::query("INSERT INTO rd_independence_basis_admissions_v1 (basis_identity, request_identity, request_semantic_digest, admission_json, admission_lineage_digest, custody_digest, custody_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&stage_custody.basis_identity)
        .bind(&stage_custody.request_identity)
        .bind(&stage_custody.request_semantic_digest)
        .bind(serde_json::to_value(&stage_custody.admission).map_err(json_storage)?)
        .bind(&stage_custody.admission_lineage_digest)
        .bind(&stage_custody.custody_digest)
        .bind(serde_json::to_value(&stage_custody).map_err(json_storage)?)
        .bind(i64::try_from(stage_custody.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    sqlx::query("INSERT INTO rd_independence_basis_heads_v1 (principal_scope_key, principal, request_scope_json, basis_identity, lineage_digest, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (principal_scope_key) DO UPDATE SET basis_identity=EXCLUDED.basis_identity, lineage_digest=EXCLUDED.lineage_digest, committed_at_epoch_ms=EXCLUDED.committed_at_epoch_ms")
        .bind(&key).bind(principal).bind(serde_json::to_value(scope).map_err(json_storage)?)
        .bind(&stored.basis_identity).bind(&stored.lineage_digest)
        .bind(i64::try_from(now_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction).await.map_err(|e| storage(&e))?;
    let payload = BasisOutboxPayloadV1 {
        schema_version: 1,
        basis_identity: &stored.basis_identity,
        basis_digest: &stored.basis_digest,
        receipt_identity: receipt.receipt_identity(),
        principal,
        request_scope: scope,
        lineage_digest: &stored.lineage_digest,
    };
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,'INDEPENDENCE_BASIS_PRECOMMITTED_V1',$3,$4,$5)")
        .bind(identity("rd-owner-event-v1", &payload_digest)).bind(&stored.basis_identity)
        .bind(payload_digest).bind(serde_json::to_value(payload).map_err(json_storage)?)
        .bind(i64::try_from(now_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction).await.map_err(|e| storage(&e))?;
    Ok(IndependenceBasisReadbackV1::from_stored(stored, receipt))
}

async fn load_basis_stage_custody_for_request_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: &str,
) -> Result<Option<VerifiedBasisStageCustodyV1>, ResearchGoalOwnerError> {
    let basis_rows = sqlx::query(
        "SELECT basis_identity FROM rd_independence_bases_v1 WHERE request_identity = $1 FOR SHARE",
    )
    .bind(request_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    if basis_rows.is_empty() {
        return Ok(None);
    }

    if basis_rows.len() != 1 {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis request custody is ambiguous".into(),
        ));
    }
    let basis_identity: String = basis_rows[0]
        .try_get("basis_identity")
        .map_err(|e| storage(&e))?;
    let basis =
        admit_independence_basis_by_identity_in_transaction(transaction, &basis_identity).await?;
    let rows = sqlx::query("SELECT basis_identity, request_identity, request_semantic_digest, admission_json, admission_lineage_digest, custody_digest, custody_json, committed_at_epoch_ms FROM rd_independence_basis_admissions_v1 WHERE request_identity = $1 FOR SHARE")
        .bind(request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    if rows.len() != 1 {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis-stage admission custody unavailable".into(),
        ));
    }
    let row = &rows[0];
    let stored: StoredBasisStageCustodyV1 =
        serde_json::from_value(row.try_get("custody_json").map_err(|e| storage(&e))?)
            .map_err(json_storage)?;
    let admission_json: ProductEdgeAdmissionLocatorV1 =
        serde_json::from_value(row.try_get("admission_json").map_err(|e| storage(&e))?)
            .map_err(json_storage)?;
    let expected_digest = canonical_digest(
        "rd.independence-basis-stage-custody.v1",
        &BasisStageCustodyMeaningV1 {
            schema_version: stored.schema_version,
            basis_identity: &stored.basis_identity,
            basis_digest: &stored.basis_digest,
            request_identity: &stored.request_identity,
            request_semantic_digest: &stored.request_semantic_digest,
            request: &stored.request,
            admission: &stored.admission,
            admission_lineage_digest: &stored.admission_lineage_digest,
            committed_at_epoch_ms: stored.committed_at_epoch_ms,
        },
    )?;
    let row_time: i64 = row
        .try_get("committed_at_epoch_ms")
        .map_err(|e| storage(&e))?;
    if stored.schema_version != 1
        || stored.custody_digest != expected_digest
        || stored.basis_identity != basis.basis_identity()
        || stored.basis_digest != basis.basis_digest()
        || stored.request_identity != request_identity
        || stored.request.request_identity != stored.request_identity
        || stored.request.admission != stored.admission
        || semantic_digest_v2(&stored.request)? != stored.request_semantic_digest
        || stored.committed_at_epoch_ms != basis.receipt().committed_at_epoch_ms()
        || admission_json != stored.admission
        || row
            .try_get::<String, _>("basis_identity")
            .map_err(|e| storage(&e))?
            != stored.basis_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(|e| storage(&e))?
            != stored.request_identity
        || row
            .try_get::<String, _>("request_semantic_digest")
            .map_err(|e| storage(&e))?
            != stored.request_semantic_digest
        || row
            .try_get::<String, _>("admission_lineage_digest")
            .map_err(|e| storage(&e))?
            != stored.admission_lineage_digest
        || row
            .try_get::<String, _>("custody_digest")
            .map_err(|e| storage(&e))?
            != stored.custody_digest
        || u64::try_from(row_time).map_err(json_storage)? != stored.committed_at_epoch_ms
    {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis-stage admission custody mismatch".into(),
        ));
    }
    Ok(Some(VerifiedBasisStageCustodyV1 {
        basis,
        request_semantic_digest: stored.request_semantic_digest,
        request: stored.request,
        admission: stored.admission,
        admission_lineage_digest: stored.admission_lineage_digest,
    }))
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

#[async_trait]
impl ResearchGoalOwnerPortV2 for PostgresResearchGoalOwnerV1 {
    async fn submit_v2(
        &self,
        request: ProductEdgeResearchGoalRequestV2,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        let digest = semantic_digest_v2(&request)?;
        let request_identity = request.request_identity.clone();
        let validation = validate_goal_request_v2(request);
        let now = current_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let request = validation.as_ref().map_or_else(
            |rejected| rejected.request(),
            ValidatedResearchGoalRequestV2::request,
        );
        let existing_row = sqlx::query(
            "SELECT semantic_digest, receipt_json, committed_at_epoch_ms FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
        )
        .bind(&request_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| storage(&e))?;
        let existing_hint = existing_row.is_some();
        if let Some(row) = existing_row {
            let receipt_json: serde_json::Value =
                row.try_get("receipt_json").map_err(|e| storage(&e))?;
            let receipt: ResearchRequestReceiptV1 =
                serde_json::from_value(receipt_json.clone()).map_err(json_storage)?;
            let row_digest: String = row.try_get("semantic_digest").map_err(|e| storage(&e))?;
            let row_committed_at: i64 = row
                .try_get("committed_at_epoch_ms")
                .map_err(|e| storage(&e))?;
            if serde_json::to_value(&receipt).map_err(json_storage)? != receipt_json
                || receipt.request_identity != request_identity
                || receipt.semantic_digest != row_digest
                || i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)?
                    != row_committed_at
            {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }

            if receipt.semantic_digest != digest {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
        }
        let basis_stage = if existing_hint {
            None
        } else {
            match load_basis_stage_custody_for_request_in_transaction(
                &mut transaction,
                &request_identity,
            )
            .await
            {
                Ok(custody) => custody,
                Err(_) => {
                    transaction.rollback().await.map_err(|e| storage(&e))?;
                    return Ok(unresolved_result_v2(&request_identity));
                }
            }
        };

        if let Some(custody) = basis_stage.as_ref()
            && (custody.request_semantic_digest != digest || custody.admission != request.admission)
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Err(ResearchGoalOwnerError::ConflictingReplay);
        }
        let admission_mode = if existing_hint || basis_stage.is_some() {
            DownstreamAdmissionModeV1::Historical
        } else {
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: now,
            }
        };
        let product_edge_admission = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &request.admission,
            admission_mode,
        )
        .await
        .map_err(|_| ResearchGoalOwnerError::Unauthorized("Product Edge admission unavailable"))?;
        verify_research_admission_v2(&product_edge_admission, request)?;

        if basis_stage.as_ref().is_some_and(|custody| {
            canonical_digest(
                "rd.product-edge-admission-lineage.v1",
                &product_edge_admission,
            )
            .map_or(true, |digest| digest != custody.admission_lineage_digest)
        }) {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let principal = product_edge_admission.effective_principal().to_string();
        let scope = product_edge_admission.authorized_scope().to_vec();
        lock_principal_scope(&mut transaction, &principal, &scope).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(&request_identity)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        let existing = match Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestV2(&request_identity),
        ))
        .await
        {
            Ok(existing) => existing,
            Err(_) => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
        };

        if let Some(custody) = existing {
            if custody.receipt().semantic_digest != digest {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
            transaction.commit().await.map_err(|e| storage(&e))?;
            return custody.into_v2_result(current_epoch_ms()?);
        }

        let validated = match validation {
            Ok(validated) => validated,
            Err(rejected) => {
                let (request, rejection_code) = rejected.into_parts();
                let write_cut = current_epoch_ms()?;
                if !product_edge_admission.authorizes_first_mutation_at(write_cut) {
                    transaction.rollback().await.map_err(|e| storage(&e))?;
                    return Ok(unresolved_result_v2(&request_identity));
                }
                verify_research_admission_v2(&product_edge_admission, &request)?;
                let stored_request = StoredRejectedResearchRequestV2 {
                    schema_version: 1,
                    request: request.clone(),
                    rejection_code: rejection_code.to_string(),
                };
                let commit =
                    decide_rejected_commit_v2(request, digest.clone(), rejection_code, write_cut);
                sqlx::query("INSERT INTO rd_research_request_receipts_v1 (request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,NULL,NULL,$5)")
                    .bind(&commit.receipt.request_identity)
                    .bind(&commit.receipt.semantic_digest)
                    .bind(serde_json::to_value(stored_request).map_err(json_storage)?)
                    .bind(serde_json::to_value(&commit.receipt).map_err(json_storage)?)
                    .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(json_storage)?)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|e| storage(&e))?;
                let custody = Box::pin(admit_research_custody_in_transaction(
                    &mut transaction,
                    ResearchCustodyLookupV1::RequestV2(&request_identity),
                ))
                .await?
                .ok_or_else(|| {
                    ResearchGoalOwnerError::Storage(
                        "committed rejected S1 V2 custody missing".to_string(),
                    )
                })?;
                transaction.commit().await.map_err(|e| storage(&e))?;
                return custody.into_v2_result(write_cut);
            }
        };
        let basis = if let Some(custody) = basis_stage {
            custody.basis
        } else {
            let basis_cut = current_epoch_ms()?;
            if !product_edge_admission.authorizes_first_mutation_at(basis_cut) {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
            verify_research_admission_v2(&product_edge_admission, validated.request())?;

            match load_or_create_basis_in_transaction(
                &mut transaction,
                validated.request(),
                &digest,
                &product_edge_admission,
                basis_cut,
            )
            .await
            {
                Ok(basis) => basis,
                Err(ResearchGoalOwnerError::ConflictingReplay) => {
                    transaction.rollback().await.map_err(|e| storage(&e))?;
                    return Err(ResearchGoalOwnerError::ConflictingReplay);
                }
                Err(_) => {
                    transaction.rollback().await.map_err(|e| storage(&e))?;
                    return Ok(unresolved_result_v2(&request_identity));
                }
            }
        };
        transaction.commit().await.map_err(|e| storage(&e))?;

        let protected_feedback = match self
            .qualification
            .resolve_or_create_for_basis(&basis.locator())
            .await
        {
            Ok(readback) => readback,
            Err(_) => {
                return Ok(unresolved_result_v2(&request_identity));
            }
        };
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        let final_authority_read_cut = current_epoch_ms()?;
        let final_admission = match resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &validated.request().admission,
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: final_authority_read_cut,
            },
        )
        .await
        {
            Ok(admission) => admission,
            Err(_) => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
        };

        if !final_admission.has_same_admission_lineage(&product_edge_admission) {
            return Err(ResearchGoalOwnerError::Unauthorized(
                "Product Edge admission lineage changed before final R&D custody",
            ));
        }
        verify_research_admission_v2(&final_admission, validated.request())?;
        let principal_scope_key =
            lock_principal_scope(&mut transaction, &principal, &scope).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(&request_identity)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        let existing = match Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestV2(&request_identity),
        ))
        .await
        {
            Ok(existing) => existing,
            Err(_) => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
        };

        if let Some(custody) = existing {
            if custody.receipt().semantic_digest != digest {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
            transaction.commit().await.map_err(|e| storage(&e))?;
            return custody.into_v2_result(current_epoch_ms()?);
        }

        let admitted_basis_stage = match load_basis_stage_custody_for_request_in_transaction(
            &mut transaction,
            &request_identity,
        )
        .await
        {
            Ok(Some(custody)) => custody,
            _ => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
        };

        if admitted_basis_stage.request_semantic_digest != digest
            || admitted_basis_stage.admission != validated.request().admission
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Err(ResearchGoalOwnerError::ConflictingReplay);
        }

        if admitted_basis_stage.admission_lineage_digest
            != canonical_digest("rd.product-edge-admission-lineage.v1", &final_admission)?
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let admitted_basis = admitted_basis_stage.basis;

        if admitted_basis != basis {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let (lineage_resolution, predecessor_frontier, lineage_digest) =
            match resolve_lineage_in_transaction(&mut transaction, &principal, &scope).await {
                Ok(lineage) => lineage,
                Err(_) => {
                    transaction.rollback().await.map_err(|e| storage(&e))?;
                    return Ok(unresolved_result_v2(&request_identity));
                }
            };
        let admitted_stored = admitted_basis.stored();
        if admitted_stored.lineage_resolution != lineage_resolution
            || admitted_stored.semantic_predecessor_frontier != predecessor_frontier
            || admitted_stored.lineage_digest != lineage_digest
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let head = sqlx::query("SELECT basis_identity FROM rd_independence_basis_heads_v1 WHERE principal_scope_key = $1 FOR SHARE")
            .bind(principal_scope_key).fetch_optional(&mut *transaction).await.map_err(|e| storage(&e))?;
        if head
            .as_ref()
            .and_then(|row| row.try_get::<String, _>("basis_identity").ok())
            .as_deref()
            != Some(basis.basis_identity())
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let admitted_feedback = match self
            .qualification
            .admit_in_transaction(&mut transaction, &basis.locator())
            .await
        {
            Ok(feedback) => feedback,
            Err(_) => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(unresolved_result_v2(&request_identity));
            }
        };
        let Some(admitted_feedback) = admitted_feedback else {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        };

        if admitted_feedback != protected_feedback {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        let refreshed_feedback = self
            .qualification
            .admit_in_transaction(&mut transaction, &basis.locator())
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
        if refreshed_feedback.as_ref() != Some(&admitted_feedback) {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }

        // The sealed historical admission, R&D basis/lineage, and Qualification
        // custody are all locked. The terminal receipt/Intent/TrialFamily are
        // new writes, so Product Edge must independently re-admit the original
        // request against the current authority at this final write cut.
        let write_cut = current_epoch_ms()?;
        if !admitted_feedback.is_current_at(write_cut)
            || !final_admission.authorizes_first_mutation_at(write_cut)
        {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Ok(unresolved_result_v2(&request_identity));
        }
        verify_research_admission_v2(&final_admission, validated.request())?;
        let request = validated.request();
        let proposal = &request.trial_family_proposal;
        let canonical_policy = TrialFamilyPolicyV1 {
            trial_budget: proposal.trial_budget,
            stop_rule: proposal.stop_rule.clone(),
            pit_rule_identity: proposal.pit_rule_identity.clone(),
            cost_model_identity: proposal.cost_model_identity.clone(),
            slippage_model_identity: proposal.slippage_model_identity.clone(),
            capacity_model_identity: proposal.capacity_model_identity.clone(),
            semantic_predecessor_frontier: predecessor_frontier,
            protected_feedback_frontier: admitted_feedback.projection_identity().to_string(),
            independence_disposition: admitted_stored.independence_disposition,
            independence_basis_identity: admitted_stored.basis_identity.clone(),
            frozen_falsifier_binding: TrialFamilyPolicyV1::expected_falsifier_binding(
                &request.goal.falsification_question,
            )
            .map_err(|e| trial_family_storage(&e))?,
        };
        let stored_request = StoredAdmittedResearchRequestV2 {
            schema_version: 1,
            request: request.clone(),
            independence_basis: admitted_stored,
            protected_feedback: StoredProtectedFeedbackProjectionV1 {
                projection_identity: admitted_feedback.projection_identity().to_string(),
                projection_digest: admitted_feedback.projection_digest().to_string(),
                source_cut: admitted_feedback.source_cut().to_string(),
                valid_through_epoch_ms: admitted_feedback.valid_through_epoch_ms(),
            },
            canonical_trial_family_policy: canonical_policy.clone(),
        };
        let request_json = serde_json::to_value(&stored_request).map_err(json_storage)?;
        let commit = decide_commit_v2(
            validated,
            digest.clone(),
            canonical_policy,
            admitted_basis,
            admitted_feedback,
            &final_admission,
            write_cut,
        )?;
        let receipt_json = serde_json::to_value(&commit.receipt).map_err(json_storage)?;
        let intent_json = commit
            .intent
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(json_storage)?;
        let view_json = commit
            .view
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(json_storage)?;
        let intent = commit.intent.as_ref().ok_or_else(|| {
            ResearchGoalOwnerError::Storage("accepted S1 intent missing".to_string())
        })?;
        let view = commit.view.as_ref().ok_or_else(|| {
            ResearchGoalOwnerError::Storage("accepted S1 Research View missing".to_string())
        })?;
        let evidence_identity = identity(
            "rd-current-research-artifact-evidence-v1",
            &format!(
                "{}:{}:{}",
                commit.receipt.receipt_identity, intent.intent_identity, view.projection_identity
            ),
        );
        let artifact_evidence = CurrentResearchArtifactEvidenceV1 {
            schema_version: 1,
            evidence_identity,
            request_identity: commit.receipt.request_identity.clone(),
            semantic_digest: commit.receipt.semantic_digest.clone(),
            source_admission: final_admission.locator().clone(),
            effective_principal: final_admission.effective_principal().to_string(),
            authorized_scope: final_admission.authorized_scope().to_vec(),
            receipt_identity: commit.receipt.receipt_identity.clone(),
            intent_identity: intent.intent_identity.clone(),
            view_identity: view.projection_identity.clone(),
            projection_at_epoch_ms: view.projection_at_epoch_ms,
            valid_through_epoch_ms: view.valid_through_epoch_ms,
        };
        let artifact_evidence_digest =
            current_research_artifact_evidence_digest(&artifact_evidence)?;
        let artifact_evidence_json =
            serde_json::to_value(&artifact_evidence).map_err(json_storage)?;
        sqlx::query("INSERT INTO rd_research_request_receipts_v1 (request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, artifact_evidence_digest, artifact_evidence_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&commit.receipt.request_identity)
            .bind(&commit.receipt.semantic_digest)
            .bind(request_json)
            .bind(receipt_json)
            .bind(intent_json)
            .bind(view_json)
            .bind(artifact_evidence_digest)
            .bind(artifact_evidence_json)
            .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        if let Some(family) = &commit.initial_family {
            persist_initial_family(&mut transaction, family, &commit.receipt)
                .await
                .map_err(|e| trial_family_storage(&e))?;
        }
        let custody = Box::pin(admit_research_custody_in_transaction(
            &mut transaction,
            ResearchCustodyLookupV1::RequestV2(&commit.receipt.request_identity),
        ))
        .await?
        .ok_or_else(|| {
            ResearchGoalOwnerError::Storage("committed S1 V2 custody missing".to_string())
        })?;

        if custody.receipt().semantic_digest != digest {
            return Err(ResearchGoalOwnerError::Storage(
                "committed S1 V2 semantic digest mismatch".to_string(),
            ));
        }
        transaction.commit().await.map_err(|e| storage(&e))?;
        custody.into_v2_result(write_cut)
    }

    async fn resolve_v2(
        &self,
        request_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        let read_cut = current_epoch_ms()?;
        let terminal = self
            .resolve_v2_at(request_identity, admission, read_cut)
            .await?;

        if terminal.resolution() != ProductEdgeResolution::SubmittedOrUnknown {
            return Ok(terminal);
        }
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(request_identity)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        let stage = match load_basis_stage_custody_for_request_in_transaction(
            &mut transaction,
            request_identity,
        )
        .await
        {
            Ok(Some(stage)) => stage,
            _ => {
                transaction.rollback().await.map_err(|e| storage(&e))?;
                return Ok(terminal);
            }
        };

        if &stage.admission != admission || stage.request.admission != *admission {
            transaction.rollback().await.map_err(|e| storage(&e))?;
            return Err(ResearchGoalOwnerError::ConflictingReplay);
        }
        let request = stage.request;
        transaction.commit().await.map_err(|e| storage(&e))?;
        let completed = self.submit_v2(request).await?;

        if completed.resolution() == ProductEdgeResolution::Accepted {
            return self
                .resolve_v2_at(request_identity, admission, current_epoch_ms()?)
                .await;
        }
        Ok(completed)
    }
}

fn current_epoch_ms() -> Result<u64, ResearchGoalOwnerError> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(json_storage)?;
    u64::try_from(duration.as_millis()).map_err(json_storage)
}

fn storage(error: &sqlx::Error) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

fn json_storage(error: impl Display) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

fn trial_family_storage(error: &TrialFamilyError) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use rstest::rstest;

    use super::*;
    use crate::product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1,
        ResearchNextLegalAction, ResearchSourceV1, ResearchViewAvailability,
    };
    use vibe_operator_authorization::{
        OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
        OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
    };
    use vibe_product_edge::{
        AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1,
        ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
        ProductEdgePostgresOwnerV1,
    };
    use vibe_testkit::postgres::DedicatedPostgresTestDatabase;

    #[rstest]
    fn basis_stage_custody_seals_complete_request_meaning_and_rejects_extensions() {
        let admission = ProductEdgeAdmissionLocatorV1 {
            request_identity: "request-stage-1".into(),
            admission_identity: "admission-stage-1".into(),
            admission_digest: "sha256:admission-stage-1".into(),
        };
        let request = request("request-stage-1", admission.clone());
        let digest = semantic_digest_v2(&request).unwrap();
        let custody = StoredBasisStageCustodyV1 {
            schema_version: 1,
            basis_identity: "basis-stage-1".into(),
            basis_digest: "sha256:basis-stage-1".into(),
            request_identity: request.request_identity.clone(),
            request_semantic_digest: digest.clone(),
            request,
            admission,
            admission_lineage_digest: "sha256:admission-lineage-stage-1".into(),
            committed_at_epoch_ms: 100,
            custody_digest: "sha256:custody-stage-1".into(),
        };
        let mut extended = serde_json::to_value(&custody).unwrap();
        extended["caller_authority"] = serde_json::json!(true);
        assert!(serde_json::from_value::<StoredBasisStageCustodyV1>(extended).is_err());

        let mut changed = custody.request;
        changed.goal.hypothesis.push_str(" changed");
        assert_ne!(semantic_digest_v2(&changed).unwrap(), digest);
    }

    #[tokio::test]
    #[ignore = "requires a fresh isolated four-role PostgreSQL topology"]
    async fn fresh_rd_owner_migrates_before_qualification_writer_validates() {
        let rd_database_url =
            std::env::var("RD_OWNER_FRESH_TEST_DATABASE_URL").expect("fresh rd_owner URL");
        let qualification_database_url =
            std::env::var("QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL")
                .expect("fresh qualification_writer URL");

        let owner = PostgresResearchGoalOwnerV1::connect(&rd_database_url, &qualification_database_url)
            .await
            .expect("fresh R&D storage migration and Qualification validation must be atomic in startup order");
        let catalog: (String, bool, String, String, bool, Option<Vec<String>>) = sqlx::query_as(
            "SELECT role.rolname, procedure.prosecdef, procedure.provolatile::text, procedure.proparallel::text, procedure.proisstrict, procedure.proconfig FROM pg_proc procedure JOIN pg_roles role ON role.oid=procedure.proowner WHERE procedure.oid=to_regprocedure('rd_owner_api.lock_current_research_for_artifact_v1(text,text,text)')",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(catalog.0, "rd_owner");
        assert!(catalog.1);
        assert_eq!(catalog.2, "v");
        assert_eq!(catalog.3, "u");
        assert!(catalog.4);
        assert_eq!(catalog.5, Some(vec!["search_path=pg_catalog".into()]));
        let privileges: (bool, bool, bool, bool) = sqlx::query_as(
            "SELECT has_function_privilege('product_edge_owner', to_regprocedure('rd_owner_api.lock_current_research_for_artifact_v1(text,text,text)'), 'EXECUTE'), has_function_privilege('public', to_regprocedure('rd_owner_api.lock_current_research_for_artifact_v1(text,text,text)'), 'EXECUTE'), has_table_privilege('product_edge_owner', 'public.rd_research_request_receipts_v1', 'SELECT'), pg_has_role('product_edge_owner', 'rd_owner', 'MEMBER')",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(privileges, (true, false, false, false));

        let basis_catalog: (String, bool, String, String, bool, Option<Vec<String>>) =
            sqlx::query_as(
                "SELECT role.rolname, procedure.prosecdef, procedure.provolatile::text, procedure.proparallel::text, procedure.proisstrict, procedure.proconfig FROM pg_proc procedure JOIN pg_roles role ON role.oid=procedure.proowner WHERE procedure.oid=to_regprocedure('rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)')",
            )
            .fetch_one(&owner.pool)
            .await
            .unwrap();
        assert_eq!(basis_catalog.0, "rd_owner");
        assert!(basis_catalog.1);
        assert_eq!(basis_catalog.2, "v");
        assert_eq!(basis_catalog.3, "u");
        assert!(basis_catalog.4);
        assert_eq!(basis_catalog.5, Some(vec!["search_path=pg_catalog".into()]));
        let basis_privileges: (bool, bool, bool, bool, bool, bool, bool) = sqlx::query_as(
            "SELECT has_schema_privilege('qualification_writer', 'rd_owner_api', 'USAGE'), has_function_privilege('qualification_writer', to_regprocedure('rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'), 'EXECUTE'), has_function_privilege('qualification_owner', to_regprocedure('rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'), 'EXECUTE'), has_function_privilege('public', to_regprocedure('rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'), 'EXECUTE'), has_table_privilege('qualification_writer', 'public.rd_independence_bases_v1', 'SELECT'), has_table_privilege('qualification_writer', 'public.rd_owner_outbox_v1', 'SELECT'), to_regprocedure('rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,text,jsonb)') IS NULL",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        assert_eq!(
            basis_privileges,
            (true, true, false, false, false, false, true)
        );
    }

    #[tokio::test]
    #[ignore = "requires admitted OA/PE/R&D test database URLs"]
    async fn postgres_v2_resolve_uses_exclusive_owner_validity_cut() {
        let test_database = DedicatedPostgresTestDatabase::admit_cross_owner(&[
            "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
            "PRODUCT_EDGE_TEST_DATABASE_URL",
            "RD_OWNER_TEST_DATABASE_URL",
        ])
        .await
        .unwrap();
        let _mutation = test_database.mutation();
        let database_url = test_database.database_url().to_string();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let request_identity = format!("research-request-v2-read-cut-{suffix}");
        let admission = bootstrap_admission(&database_url, &request_identity, suffix).await;
        let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
            .await
            .unwrap();
        let accepted = owner
            .submit_v2(request(&request_identity, admission.clone()))
            .await
            .unwrap();
        let historical = accepted.research_view().unwrap();
        let cut = historical.valid_through_epoch_ms;
        let family_identity = accepted
            .trial_family()
            .unwrap()
            .root
            .trial_family_identity()
            .to_string();
        let basis_identity = accepted
            .independence_basis()
            .unwrap()
            .basis_identity()
            .to_string();
        let projection_identity = accepted
            .protected_feedback()
            .unwrap()
            .projection_identity()
            .to_string();

        let current = owner
            .resolve_v2_at(&request_identity, &admission, cut.saturating_sub(1))
            .await
            .unwrap();
        assert_eq!(
            current.research_view().unwrap().availability,
            ResearchViewAvailability::Available
        );
        assert_eq!(
            current.next_legal_action(),
            ResearchNextLegalAction::WaitForRAndDExecution
        );

        let stale = owner
            .resolve_v2_at(&request_identity, &admission, cut)
            .await
            .unwrap();
        assert_eq!(
            stale.resolution(),
            crate::product_edge::ProductEdgeResolution::Accepted
        );
        assert_eq!(
            stale.research_view().unwrap().availability,
            ResearchViewAvailability::Stale
        );
        assert_eq!(
            stale.owner_receipt().unwrap().receipt_identity,
            accepted.owner_receipt().unwrap().receipt_identity
        );
        assert_eq!(
            stale.independence_basis().unwrap().basis_identity(),
            basis_identity
        );
        assert_eq!(
            stale.protected_feedback().unwrap().projection_identity(),
            projection_identity
        );
        assert_eq!(
            stale.trial_family().unwrap().root.trial_family_identity(),
            family_identity
        );
        assert_eq!(
            stale.next_legal_action(),
            ResearchNextLegalAction::ResolveSameRequestIdentity
        );

        for statement in [
            "DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1",
            "DELETE FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1",
            "DELETE FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1",
            "DELETE FROM rd_trial_families_v1 WHERE trial_family_identity = $1",
        ] {
            sqlx::query(statement)
                .bind(&family_identity)
                .execute(&owner.pool)
                .await
                .unwrap();
        }
        sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
            .bind(request_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE frontier_identity = $1",
        )
        .bind(&projection_identity)
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&projection_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1")
            .bind(&projection_identity).execute(&owner.pool).await.unwrap();
        sqlx::query("DELETE FROM rd_independence_basis_heads_v1 WHERE basis_identity = $1")
            .bind(&basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_independence_bases_v1 WHERE basis_identity = $1")
            .bind(&basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
    }

    fn request(
        request_identity: &str,
        admission: ProductEdgeAdmissionLocatorV1,
    ) -> ProductEdgeResearchGoalRequestV2 {
        ProductEdgeResearchGoalRequestV2 {
            request_identity: request_identity.to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission,
            goal: crate::product_edge::SourcedResearchGoalV2 {
                hypothesis: "A bounded PIT effect persists after exact costs.".to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question: "Does the effect disappear after exact modeled costs?"
                    .to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact cost model identity below.".to_string(),
                capacity_assumption: "Capacity model identity below.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/read-cut".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-21T00:00:00Z".to_string(),
                    source_cut: "read-cut-source-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded source interpretation only.".to_string(),
                }],
            },
            trial_family_proposal: crate::product_edge::TrialFamilyProposalV1 {
                trial_budget: 8,
                stop_rule: "Stop on falsifier or exhausted budget.".to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "No known local predecessor before Owner resolution."
                    .to_string(),
            },
        }
    }

    async fn bootstrap_admission(
        database_url: &str,
        request_identity: &str,
        suffix: u128,
    ) -> ProductEdgeAdmissionLocatorV1 {
        let now = current_epoch_ms().unwrap();
        let principal = format!("admin-{suffix}");
        let manifest = AgentOperationManifestProposalV1 {
            operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
        };
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(database_url)
            .await
            .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: RESEARCH_OWNER_V1.to_string(),
                    permissions: vec![
                        RESEARCH_SCOPE_V1.to_string(),
                        RESEARCH_VIEW_SCOPE_V1.to_string(),
                    ],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: manifest.manifest_identity().unwrap(),
                    manifest_digest: manifest.manifest_digest().unwrap(),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let deployment_identity = format!("product-edge-deployment-{suffix}");
        let edge = ProductEdgePostgresOwnerV1::connect(
            database_url,
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: RESEARCH_OWNER_V1.to_string(),
            },
        )
        .await
        .unwrap();
        edge.bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("product-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "research-scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest],
        })
        .await
        .unwrap();
        let payload = request(
            request_identity,
            ProductEdgeAdmissionLocatorV1 {
                request_identity: request_identity.to_string(),
                admission_identity: String::new(),
                admission_digest: String::new(),
            },
        );
        let typed_payload = serde_json::json!({
            "request_identity": payload.request_identity,
            "channel": payload.channel,
            "goal": payload.goal,
            "trial_family_proposal": payload.trial_family_proposal,
        });
        edge.admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_string(),
            typed_payload,
            operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            request_proof_digest: "sha256:test-proof".to_string(),
            audit_correlation: format!("test:{request_identity}"),
        })
        .await
        .unwrap()
        .locator()
        .clone()
    }
}
