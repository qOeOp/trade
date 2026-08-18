use std::fmt::Display;

use async_trait::async_trait;
use sqlx::{PgPool, Row};

use crate::product_edge::{
    FrozenResearchGoalIntentV1, ProductEdgeAdmissionPolicyV1, ProductEdgeResearchGoalRequestV1,
    ResearchGoalCommitV1, ResearchGoalOwnerError, ResearchGoalOwnerPort, ResearchGoalOwnerResultV1,
    ResearchRequestReceiptV1, ResearchViewV1, TrustedProductEdgeContextV1, decide_commit,
    result_from_commit, semantic_digest, unresolved_result, validate_context,
};

#[derive(Debug, Clone)]
pub struct PostgresResearchGoalOwnerV1 {
    pool: PgPool,
    policy: ProductEdgeAdmissionPolicyV1,
}

impl PostgresResearchGoalOwnerV1 {
    pub async fn connect(
        database_url: &str,
        policy: ProductEdgeAdmissionPolicyV1,
    ) -> Result<Self, ResearchGoalOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|e| storage(&e))?;
        let owner = Self { pool, policy };
        owner.migrate().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), ResearchGoalOwnerError> {
        sqlx::query(
            "
            CREATE TABLE IF NOT EXISTS rd_research_request_receipts_v1 (
                request_identity TEXT PRIMARY KEY,
                semantic_digest TEXT NOT NULL,
                receipt_json JSONB NOT NULL,
                intent_json JSONB,
                view_json JSONB,
                committed_at_epoch_ms BIGINT NOT NULL
            )
            ",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| storage(&e))?;
        Ok(())
    }

    async fn load(
        &self,
        request_identity: &str,
    ) -> Result<Option<ResearchGoalCommitV1>, ResearchGoalOwnerError> {
        let row = sqlx::query(
            "
            SELECT receipt_json, intent_json, view_json
            FROM rd_research_request_receipts_v1
            WHERE request_identity = $1
            ",
        )
        .bind(request_identity)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| storage(&e))?;
        row.as_ref().map(decode_commit).transpose()
    }
}

#[async_trait]
impl ResearchGoalOwnerPort for PostgresResearchGoalOwnerV1 {
    async fn submit(
        &self,
        request: ProductEdgeResearchGoalRequestV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        validate_context(&request.context, &self.policy)?;
        let digest = semantic_digest(&request)?;
        let now = current_epoch_ms()?;
        let mut transaction = self.pool.begin().await.map_err(|e| storage(&e))?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(&request.request_identity)
            .execute(&mut *transaction)
            .await
            .map_err(|e| storage(&e))?;
        let existing = sqlx::query(
            "
            SELECT semantic_digest, receipt_json, intent_json, view_json
            FROM rd_research_request_receipts_v1
            WHERE request_identity = $1
            ",
        )
        .bind(&request.request_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| storage(&e))?;
        if let Some(row) = existing {
            let existing_digest: String =
                row.try_get("semantic_digest").map_err(|e| storage(&e))?;
            if existing_digest != digest {
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
            let commit = decode_commit(&row)?;
            transaction.commit().await.map_err(|e| storage(&e))?;
            return Ok(result_from_commit(commit));
        }

        let commit = decide_commit(request, digest, now);
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
        sqlx::query(
            "
            INSERT INTO rd_research_request_receipts_v1 (
                request_identity, semantic_digest, receipt_json, intent_json, view_json,
                committed_at_epoch_ms
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ",
        )
        .bind(&commit.receipt.request_identity)
        .bind(&commit.receipt.semantic_digest)
        .bind(receipt_json)
        .bind(intent_json)
        .bind(view_json)
        .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut *transaction)
        .await
        .map_err(|e| storage(&e))?;
        transaction.commit().await.map_err(|e| storage(&e))?;
        Ok(result_from_commit(commit))
    }

    async fn resolve(
        &self,
        request_identity: &str,
        context: &TrustedProductEdgeContextV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        validate_context(context, &self.policy)?;
        Ok(match self.load(request_identity).await? {
            Some(commit) => result_from_commit(commit),
            None => unresolved_result(request_identity),
        })
    }
}

fn decode_commit(
    row: &sqlx::postgres::PgRow,
) -> Result<ResearchGoalCommitV1, ResearchGoalOwnerError> {
    let receipt: serde_json::Value = row.try_get("receipt_json").map_err(|e| storage(&e))?;
    let intent: Option<serde_json::Value> = row.try_get("intent_json").map_err(|e| storage(&e))?;
    let view: Option<serde_json::Value> = row.try_get("view_json").map_err(|e| storage(&e))?;
    Ok(ResearchGoalCommitV1 {
        receipt: serde_json::from_value::<ResearchRequestReceiptV1>(receipt)
            .map_err(json_storage)?,
        intent: intent
            .map(serde_json::from_value::<FrozenResearchGoalIntentV1>)
            .transpose()
            .map_err(json_storage)?,
        view: view
            .map(serde_json::from_value::<ResearchViewV1>)
            .transpose()
            .map_err(json_storage)?,
    })
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
