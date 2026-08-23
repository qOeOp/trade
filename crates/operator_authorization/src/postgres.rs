use std::{
    fmt::Display,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::{
    AuthorizationReadModeV1, GENESIS_REVOCATION_FRONTIER, OPERATOR_AUTHORIZATION_SCHEMA_V1,
    OperatorAuthorizationError, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuanceReceiptV1, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationReadbackV1, OperatorAuthorizationRevocationFrontierV1,
    OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationSuccessorIssuanceProposalV1,
    UntrustedCanonicalAuthorizationEvidenceV1, canonical_digest, identity,
};

const ISSUED_EVENT: &str = "OPERATOR_AUTHORIZATION_ISSUED_V1";
const FRONTIER_EVENT: &str = "OPERATOR_AUTHORIZATION_REVOCATION_FRONTIER_V1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIssuanceV1 {
    schema_version: u32,
    proposal: OperatorAuthorizationIssuanceProposalV1,
    #[serde(default)]
    predecessor_authorization: Option<OperatorAuthorizationLocatorV1>,
    #[serde(default)]
    admitted_frontier_identity: Option<String>,
    issuance_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIssuanceReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    authorization_identity: String,
    issuance_digest: String,
    committed_at_epoch_ms: u64,
}

impl From<StoredIssuanceReceiptV1> for OperatorAuthorizationIssuanceReceiptV1 {
    fn from(value: StoredIssuanceReceiptV1) -> Self {
        Self {
            schema_version: value.schema_version,
            receipt_identity: value.receipt_identity,
            authorization_identity: value.authorization_identity,
            issuance_digest: value.issuance_digest,
            committed_at_epoch_ms: value.committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredRevocationEntryV1 {
    authorization_identity: String,
    reason_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredRevocationFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    scope_digest: String,
    sequence: u64,
    predecessor_frontier_identity: Option<String>,
    revocations: Vec<StoredRevocationEntryV1>,
    committed_at_epoch_ms: u64,
}

impl StoredRevocationFrontierV1 {
    fn public(&self) -> OperatorAuthorizationRevocationFrontierV1 {
        OperatorAuthorizationRevocationFrontierV1 {
            schema_version: self.schema_version,
            frontier_identity: self.frontier_identity.clone(),
            scope_digest: self.scope_digest.clone(),
            sequence: self.sequence,
            predecessor_frontier_identity: self.predecessor_frontier_identity.clone(),
            revoked_authorization_identities: self
                .revocations
                .iter()
                .map(|entry| entry.authorization_identity.clone())
                .collect(),
            committed_at_epoch_ms: self.committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    schema_version: u32,
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedIssuanceRowV1 {
    authorization_identity: String,
    issuer_identity: String,
    principal: String,
    audience: String,
    scope_digest: String,
    semantic_digest: String,
    issuance_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedFrontierRowV1 {
    frontier_identity: String,
    issuer_identity: String,
    principal: String,
    audience: String,
    scope_digest: String,
    sequence: i64,
    predecessor_frontier_identity: Option<String>,
    frontier_digest: String,
    frontier_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedHeadRowV1 {
    scope_digest: String,
    frontier_identity: String,
    sequence: i64,
    frontier_digest: String,
    committed_at_epoch_ms: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedAuthorizationEnvelopeV1 {
    issuance: LockedIssuanceRowV1,
    issuances: Vec<LockedIssuanceRowV1>,
    head: LockedHeadRowV1,
    current_frontier: LockedFrontierRowV1,
    frontiers: Vec<LockedFrontierRowV1>,
    outboxes: Vec<LockedOutboxRowV1>,
}

#[derive(Debug)]
struct VerifiedScopeHistoryV1 {
    issuances: Vec<StoredIssuanceV1>,
    frontiers: Vec<StoredRevocationFrontierV1>,
}

impl VerifiedScopeHistoryV1 {
    fn current(&self) -> Result<&StoredRevocationFrontierV1, OperatorAuthorizationError> {
        self.frontiers
            .last()
            .ok_or(OperatorAuthorizationError::Unavailable)
    }

    fn issuance(
        &self,
        authorization_identity: &str,
    ) -> Result<&StoredIssuanceV1, OperatorAuthorizationError> {
        self.issuances
            .iter()
            .find(|issuance| issuance.proposal.authorization_identity == authorization_identity)
            .ok_or(OperatorAuthorizationError::Unavailable)
    }

    fn issuance_head(&self) -> Result<&StoredIssuanceV1, OperatorAuthorizationError> {
        self.issuances
            .last()
            .ok_or(OperatorAuthorizationError::Unavailable)
    }
}

/// PostgreSQL Operator Authorization issuer boundary.
///
/// The writer pool is deliberately not part of the consumer API:
/// ```compile_fail
/// use vibe_operator_authorization::OperatorAuthorizationIssuerPostgresV1;
/// fn raw_writer(owner: &OperatorAuthorizationIssuerPostgresV1) {
///     let _ = owner.pool();
/// }
/// ```
pub struct OperatorAuthorizationIssuerPostgresV1 {
    pool: PgPool,
}

impl OperatorAuthorizationIssuerPostgresV1 {
    pub async fn connect(database_url: &str) -> Result<Self, OperatorAuthorizationError> {
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    #[cfg(test)]
    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }

    async fn migrate(&self) -> Result<(), OperatorAuthorizationError> {
        for statement in [
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_issuances_v1 (authorization_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, principal TEXT NOT NULL, audience TEXT NOT NULL, scope_digest TEXT NOT NULL, semantic_digest TEXT NOT NULL, issuance_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_revocation_frontiers_v1 (frontier_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, principal TEXT NOT NULL, audience TEXT NOT NULL, scope_digest TEXT NOT NULL, sequence BIGINT NOT NULL, predecessor_frontier_identity TEXT, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(scope_digest, sequence))",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_revocation_heads_v1 (scope_digest TEXT PRIMARY KEY, frontier_identity TEXT NOT NULL REFERENCES operator_authorization_private.operator_authorization_revocation_frontiers_v1(frontier_identity), sequence BIGINT NOT NULL, frontier_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS operator_authorization_issuance_scope_v1 ON operator_authorization_private.operator_authorization_issuances_v1(scope_digest, authorization_identity)",
            "CREATE INDEX IF NOT EXISTS operator_authorization_outbox_aggregate_v1 ON operator_authorization_private.operator_authorization_owner_outbox_v1(aggregate_identity, event_kind)",
        ] {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        }
        Ok(())
    }

    pub async fn issue_genesis(
        &self,
        proposal: OperatorAuthorizationIssuanceProposalV1,
    ) -> Result<OperatorAuthorizationReadbackV1, OperatorAuthorizationError> {
        proposal.validate()?;
        let semantic_digest = proposal.semantic_digest()?;
        let scope_digest = proposal.scope.digest()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        if let Some(existing) = load_issuance_row(
            &mut transaction,
            &proposal.authorization_identity,
            CanonicalRowLockV1::Update,
        )
        .await?
        {
            if existing.issuance_digest != semantic_digest || existing.proposal != proposal {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            lock_current_rows_for_update(&mut transaction, &existing).await?;
            let verified = verify_scope_history(&mut transaction, &scope_digest, false, false)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            if verified.issuance(&existing.proposal.authorization_identity)? != &existing {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            let result = load_verified(
                &mut transaction,
                &OperatorAuthorizationLocatorV1 {
                    authorization_identity: existing.proposal.authorization_identity.clone(),
                    issuance_receipt_identity: issuance_receipt(&existing).receipt_identity,
                },
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now_ms()?,
                },
                false,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(result);
        }

        if verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .is_some()
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }

        let committed_at = now_ms()?;
        if committed_at < proposal.not_before_epoch_ms
            || committed_at >= proposal.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "issuance validity",
            ));
        }
        let stored = StoredIssuanceV1 {
            schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
            proposal,
            predecessor_authorization: None,
            admitted_frontier_identity: None,
            issuance_digest: semantic_digest,
            committed_at_epoch_ms: committed_at,
        };
        let receipt = issuance_receipt(&stored);
        let frontier = genesis_frontier(&stored)?;
        let frontier_digest =
            canonical_digest("operator-authorization.revocation-frontier.v1", &frontier)?;

        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_issuances_v1 (authorization_identity, issuer_identity, principal, audience, scope_digest, semantic_digest, issuance_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&stored.proposal.authorization_identity)
            .bind(&stored.proposal.issuer_identity)
            .bind(&stored.proposal.scope.principal)
            .bind(&stored.proposal.scope.audience)
            .bind(&scope_digest)
            .bind(&stored.issuance_digest)
            .bind(json(&stored)?)
            .bind(json(&receipt)?)
            .bind(to_i64(committed_at)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_revocation_frontiers_v1 (frontier_identity, issuer_identity, principal, audience, scope_digest, sequence, predecessor_frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9)")
            .bind(&frontier.frontier_identity)
            .bind(&stored.proposal.issuer_identity)
            .bind(&stored.proposal.scope.principal)
            .bind(&stored.proposal.scope.audience)
            .bind(&scope_digest)
            .bind(0_i64)
            .bind(&frontier_digest)
            .bind(json(&frontier)?)
            .bind(to_i64(committed_at)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_revocation_heads_v1 (scope_digest, frontier_identity, sequence, frontier_digest, committed_at_epoch_ms) VALUES ($1,$2,0,$3,$4)")
            .bind(&scope_digest).bind(&frontier.frontier_identity).bind(&frontier_digest)
            .bind(to_i64(committed_at)?).execute(&mut *transaction).await.map_err(storage)?;
        insert_outbox(
            &mut transaction,
            &receipt.receipt_identity,
            &stored.proposal.authorization_identity,
            ISSUED_EVENT,
            &receipt,
            committed_at,
        )
        .await?;
        insert_outbox(
            &mut transaction,
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            FRONTIER_EVENT,
            &frontier,
            committed_at,
        )
        .await?;

        let verified = verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;

        if verified.issuance(&stored.proposal.authorization_identity)? != &stored
            || verified.current()? != &frontier
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }

        let result = load_verified(
            &mut transaction,
            &OperatorAuthorizationLocatorV1 {
                authorization_identity: stored.proposal.authorization_identity.clone(),
                issuance_receipt_identity: receipt.receipt_identity,
            },
            AuthorizationReadModeV1::Current {
                read_cut_epoch_ms: committed_at,
            },
            false,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result)
    }

    pub async fn revoke(
        &self,
        proposal: OperatorAuthorizationRevocationProposalV1,
    ) -> Result<OperatorAuthorizationRevocationFrontierV1, OperatorAuthorizationError> {
        if proposal.reason_code.trim().is_empty() || proposal.expected_frontier_identity.is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal("revocation"));
        }
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let issuance = load_issuance_row(
            &mut transaction,
            &proposal.authorization.authorization_identity,
            CanonicalRowLockV1::Update,
        )
        .await?
        .ok_or(OperatorAuthorizationError::Unavailable)?;
        let receipt = issuance_receipt(&issuance);
        if receipt.receipt_identity != proposal.authorization.issuance_receipt_identity {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let scope_digest = issuance.proposal.scope.digest()?;
        lock_current_rows_for_update(&mut transaction, &issuance).await?;
        let history = verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        if history.issuance(&issuance.proposal.authorization_identity)? != &issuance {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let current = history.current()?.clone();

        if current.revocations.iter().any(|entry| {
            entry.authorization_identity == proposal.authorization.authorization_identity
        }) {
            if let Some(original) = exact_revocation_transition(&history.frontiers, &proposal) {
                transaction.commit().await.map_err(storage)?;
                return Ok(original.public());
            }
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }

        if current.frontier_identity != proposal.expected_frontier_identity {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }
        let committed_at = now_ms()?;
        let mut revocations = current.revocations.clone();
        revocations.push(StoredRevocationEntryV1 {
            authorization_identity: proposal.authorization.authorization_identity.clone(),
            reason_code: proposal.reason_code,
        });
        revocations.sort_by(|left, right| {
            (&left.authorization_identity, &left.reason_code)
                .cmp(&(&right.authorization_identity, &right.reason_code))
        });
        let sequence = current
            .sequence
            .checked_add(1)
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let frontier_identity = identity(
            "operator-authorization-revocation-frontier-v1",
            &[
                &scope_digest,
                &current.frontier_identity,
                &sequence.to_string(),
                &canonical_digest("operator-authorization.revocations.v1", &revocations)?,
                &committed_at.to_string(),
            ],
        );
        let next = StoredRevocationFrontierV1 {
            schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
            frontier_identity,
            scope_digest: scope_digest.clone(),
            sequence,
            predecessor_frontier_identity: Some(current.frontier_identity.clone()),
            revocations,
            committed_at_epoch_ms: committed_at,
        };
        let frontier_digest =
            canonical_digest("operator-authorization.revocation-frontier.v1", &next)?;
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_revocation_frontiers_v1 (frontier_identity, issuer_identity, principal, audience, scope_digest, sequence, predecessor_frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&next.frontier_identity).bind(&issuance.proposal.issuer_identity)
            .bind(&issuance.proposal.scope.principal).bind(&issuance.proposal.scope.audience)
            .bind(&scope_digest).bind(to_i64(sequence)?).bind(&current.frontier_identity)
            .bind(&frontier_digest).bind(json(&next)?).bind(to_i64(committed_at)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        let updated = sqlx::query("UPDATE operator_authorization_private.operator_authorization_revocation_heads_v1 SET frontier_identity = $1, sequence = $2, frontier_digest = $3, committed_at_epoch_ms = $4 WHERE scope_digest = $5 AND frontier_identity = $6 AND sequence = $7")
            .bind(&next.frontier_identity).bind(to_i64(sequence)?).bind(&frontier_digest)
            .bind(to_i64(committed_at)?).bind(&scope_digest).bind(&current.frontier_identity)
            .bind(to_i64(current.sequence)?).execute(&mut *transaction).await.map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        insert_outbox(
            &mut transaction,
            &next.frontier_identity,
            &next.frontier_identity,
            FRONTIER_EVENT,
            &next,
            committed_at,
        )
        .await?;
        let verified = verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;

        if verified.issuance(&issuance.proposal.authorization_identity)? != &issuance
            || verified.current()? != &next
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        transaction.commit().await.map_err(storage)?;
        Ok(next.public())
    }

    pub async fn issue_successor(
        &self,
        proposal: OperatorAuthorizationSuccessorIssuanceProposalV1,
    ) -> Result<OperatorAuthorizationReadbackV1, OperatorAuthorizationError> {
        proposal.validate()?;
        let semantic_digest = proposal.semantic_digest()?;
        let scope_digest = proposal.successor.scope.digest()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let mut lock_keys = [
            format!(
                "operator-authorization-identity:{}",
                proposal.successor.authorization_identity
            ),
            format!("operator-authorization-scope:{scope_digest}"),
        ];
        lock_keys.sort();
        for lock_key in lock_keys {
            sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
                .bind(lock_key)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }

        if let Some(existing) = load_issuance_row(
            &mut transaction,
            &proposal.successor.authorization_identity,
            CanonicalRowLockV1::Update,
        )
        .await?
        {
            if existing.proposal != proposal.successor
                || existing.predecessor_authorization
                    != Some(proposal.predecessor_authorization.clone())
                || existing.admitted_frontier_identity
                    != Some(proposal.expected_current_frontier_identity.clone())
                || existing.issuance_digest != semantic_digest
            {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            lock_current_rows_for_update(&mut transaction, &existing).await?;
            let history = verify_scope_history(&mut transaction, &scope_digest, false, false)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            if history.issuance(&existing.proposal.authorization_identity)? != &existing {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            let result = load_verified(
                &mut transaction,
                &OperatorAuthorizationLocatorV1 {
                    authorization_identity: existing.proposal.authorization_identity.clone(),
                    issuance_receipt_identity: issuance_receipt(&existing).receipt_identity,
                },
                AuthorizationReadModeV1::CurrentAtLock,
                false,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(result);
        }

        let predecessor = load_issuance_row(
            &mut transaction,
            &proposal.predecessor_authorization.authorization_identity,
            CanonicalRowLockV1::Update,
        )
        .await?
        .ok_or(OperatorAuthorizationError::Unavailable)?;

        if issuance_receipt(&predecessor).receipt_identity
            != proposal.predecessor_authorization.issuance_receipt_identity
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }

        if predecessor.proposal.scope.digest()? != scope_digest {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }
        lock_current_rows_for_update(&mut transaction, &predecessor).await?;
        let history = verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let current = history.current()?.clone();
        if history.issuance_head()? != &predecessor
            || current.frontier_identity != proposal.expected_current_frontier_identity
            || current.revocations.iter().any(|entry| {
                entry.authorization_identity == predecessor.proposal.authorization_identity
            })
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }

        if proposal.successor.issuer_identity != predecessor.proposal.issuer_identity
            || proposal.successor.issuer_key_version != predecessor.proposal.issuer_key_version
            || proposal.successor.scope != predecessor.proposal.scope
            || proposal.successor.request_proof_digest != predecessor.proposal.request_proof_digest
            || proposal.successor.operation_manifests != predecessor.proposal.operation_manifests
            || proposal.successor.not_before_epoch_ms < predecessor.proposal.not_before_epoch_ms
            || proposal.successor.valid_through_epoch_ms
                <= predecessor.proposal.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }
        let committed_at = now_ms()?;
        if committed_at < proposal.successor.not_before_epoch_ms
            || committed_at >= proposal.successor.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "successor issuance validity",
            ));
        }
        let stored = StoredIssuanceV1 {
            schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
            proposal: proposal.successor,
            predecessor_authorization: Some(proposal.predecessor_authorization),
            admitted_frontier_identity: Some(proposal.expected_current_frontier_identity),
            issuance_digest: semantic_digest,
            committed_at_epoch_ms: committed_at,
        };
        let receipt = issuance_receipt(&stored);
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_issuances_v1 (authorization_identity, issuer_identity, principal, audience, scope_digest, semantic_digest, issuance_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&stored.proposal.authorization_identity)
            .bind(&stored.proposal.issuer_identity)
            .bind(&stored.proposal.scope.principal)
            .bind(&stored.proposal.scope.audience)
            .bind(&scope_digest)
            .bind(&stored.issuance_digest)
            .bind(json(&stored)?)
            .bind(json(&receipt)?)
            .bind(to_i64(committed_at)?)
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        insert_outbox(
            &mut transaction,
            &receipt.receipt_identity,
            &stored.proposal.authorization_identity,
            ISSUED_EVENT,
            &receipt,
            committed_at,
        )
        .await?;
        let verified = verify_scope_history(&mut transaction, &scope_digest, false, false)
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        if verified.issuance_head()? != &stored || verified.current()? != &current {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let result = load_verified(
            &mut transaction,
            &OperatorAuthorizationLocatorV1 {
                authorization_identity: stored.proposal.authorization_identity.clone(),
                issuance_receipt_identity: receipt.receipt_identity,
            },
            AuthorizationReadModeV1::Current {
                read_cut_epoch_ms: committed_at,
            },
            false,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result)
    }
}

async fn lock_current_rows_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    issuance: &StoredIssuanceV1,
) -> Result<StoredRevocationFrontierV1, OperatorAuthorizationError> {
    let scope_digest = issuance.proposal.scope.digest()?;
    let head = sqlx::query("SELECT scope_digest, frontier_identity, sequence, frontier_digest, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest=$1 FOR UPDATE")
        .bind(&scope_digest)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    let frontier_identity: String = head.try_get("frontier_identity").map_err(storage)?;
    let frontier =
        load_frontier_row(transaction, &frontier_identity, CanonicalRowLockV1::Update).await?;
    let frontier_digest =
        canonical_digest("operator-authorization.revocation-frontier.v1", &frontier)?;
    if head.try_get::<String, _>("scope_digest").map_err(storage)? != scope_digest
        || frontier.scope_digest != scope_digest
        || head.try_get::<i64, _>("sequence").map_err(storage)? != to_i64(frontier.sequence)?
        || head
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != frontier_digest
        || from_i64(head.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != frontier.committed_at_epoch_ms
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(frontier)
}

async fn ensure_read_committed(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), OperatorAuthorizationError> {
    let isolation: String = sqlx::query_scalar("SHOW transaction_isolation")
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;

    if isolation != "read committed" {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(())
}

pub async fn resolve_authorization_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &OperatorAuthorizationLocatorV1,
    mode: AuthorizationReadModeV1,
) -> Result<OperatorAuthorizationReadbackV1, OperatorAuthorizationError> {
    ensure_read_committed(transaction).await?;
    let envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT operator_authorization_api.lock_current_authorization_v1($1, $2)",
    )
    .bind(&locator.authorization_identity)
    .bind(&locator.issuance_receipt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let evidence = parse_untrusted_authorization_envelope_v1(
        envelope.ok_or(OperatorAuthorizationError::Unavailable)?,
        locator,
        mode,
    )?;
    Ok(OperatorAuthorizationReadbackV1 {
        issuance_receipt: evidence.issuance_receipt,
        frontier: evidence.frontier,
        issuer_identity: evidence.issuer_identity,
        issuer_key_version: evidence.issuer_key_version,
        scope: evidence.scope,
        request_proof_digest: evidence.request_proof_digest,
        operation_manifests: evidence.operation_manifests,
        not_before_epoch_ms: evidence.not_before_epoch_ms,
        valid_through_epoch_ms: evidence.valid_through_epoch_ms,
    })
}

pub fn parse_untrusted_authorization_envelope_v1(
    value: serde_json::Value,
    locator: &OperatorAuthorizationLocatorV1,
    mode: AuthorizationReadModeV1,
) -> Result<UntrustedCanonicalAuthorizationEvidenceV1, OperatorAuthorizationError> {
    let history = verify_locked_envelope(value, locator)?;
    let issuance = history.issuance(&locator.authorization_identity)?.clone();
    let frontier = match mode {
        AuthorizationReadModeV1::CurrentAtLock => history.current()?.clone(),
        AuthorizationReadModeV1::Current { read_cut_epoch_ms } => {
            let frontier = history.current()?.clone();

            if read_cut_epoch_ms < issuance.proposal.not_before_epoch_ms
                || read_cut_epoch_ms >= issuance.proposal.valid_through_epoch_ms
                || frontier.revocations.iter().any(|entry| {
                    entry.authorization_identity == issuance.proposal.authorization_identity
                })
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            frontier
        }
        AuthorizationReadModeV1::Historical { frontier_identity } => {
            let frontier = history
                .frontiers
                .iter()
                .find(|frontier| frontier.frontier_identity == frontier_identity)
                .cloned()
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let admitted_sequence = match issuance.admitted_frontier_identity.as_deref() {
                Some(identity) => history
                    .frontiers
                    .iter()
                    .find(|candidate| candidate.frontier_identity == identity)
                    .map(|candidate| candidate.sequence)
                    .ok_or(OperatorAuthorizationError::Unavailable)?,
                None => 0,
            };

            if frontier.sequence < admitted_sequence
                || frontier.revocations.iter().any(|entry| {
                    entry.authorization_identity == issuance.proposal.authorization_identity
                })
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            frontier
        }
    };
    Ok(UntrustedCanonicalAuthorizationEvidenceV1 {
        issuance_receipt: issuance_receipt(&issuance).into(),
        frontier: frontier.public(),
        issuer_identity: issuance.proposal.issuer_identity,
        issuer_key_version: issuance.proposal.issuer_key_version,
        scope: issuance.proposal.scope,
        request_proof_digest: issuance.proposal.request_proof_digest,
        operation_manifests: issuance.proposal.operation_manifests,
        not_before_epoch_ms: issuance.proposal.not_before_epoch_ms,
        valid_through_epoch_ms: issuance.proposal.valid_through_epoch_ms,
    })
}

fn verify_locked_envelope(
    value: serde_json::Value,
    locator: &OperatorAuthorizationLocatorV1,
) -> Result<VerifiedScopeHistoryV1, OperatorAuthorizationError> {
    let envelope: LockedAuthorizationEnvelopeV1 = from_json(value)?;
    let selected_identity = envelope.issuance.authorization_identity.clone();
    let mut issuances = envelope
        .issuances
        .into_iter()
        .map(verify_locked_issuance_row)
        .collect::<Result<Vec<_>, _>>()?;
    issuances = order_and_verify_issuances(issuances)?;
    let issuance = issuances
        .iter()
        .find(|candidate| candidate.proposal.authorization_identity == selected_identity)
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    let selected = verify_locked_issuance_row(envelope.issuance)?;
    let receipt = issuance_receipt(issuance);
    if &selected != issuance
        || issuance.proposal.authorization_identity != locator.authorization_identity
        || receipt.receipt_identity != locator.issuance_receipt_identity
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }

    let genesis = issuances
        .first()
        .ok_or(OperatorAuthorizationError::Unavailable)?;

    let mut frontiers = Vec::with_capacity(envelope.frontiers.len());
    for (index, row) in envelope.frontiers.into_iter().enumerate() {
        let frontier: StoredRevocationFrontierV1 = from_json(row.frontier_json)?;
        if row.frontier_identity != frontier.frontier_identity
            || row.issuer_identity != genesis.proposal.issuer_identity
            || row.principal != genesis.proposal.scope.principal
            || row.audience != genesis.proposal.scope.audience
            || row.scope_digest != frontier.scope_digest
            || row.sequence != to_i64(frontier.sequence)?
            || row.sequence != i64::try_from(index).map_err(storage)?
            || row.predecessor_frontier_identity != frontier.predecessor_frontier_identity
            || row.frontier_digest
                != canonical_digest("operator-authorization.revocation-frontier.v1", &frontier)?
            || from_i64(row.committed_at_epoch_ms)? != frontier.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        frontiers.push(frontier);
    }
    verify_frontier_chain(genesis, &frontiers)?;
    verify_successor_frontiers(&issuances, &frontiers)?;
    let current = frontiers
        .last()
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    let current_digest =
        canonical_digest("operator-authorization.revocation-frontier.v1", current)?;
    if envelope.head.scope_digest != current.scope_digest
        || envelope.head.frontier_identity != current.frontier_identity
        || envelope.head.sequence != to_i64(current.sequence)?
        || envelope.head.frontier_digest != current_digest
        || from_i64(envelope.head.committed_at_epoch_ms)? != current.committed_at_epoch_ms
        || envelope.current_frontier.frontier_identity != current.frontier_identity
        || envelope.current_frontier.frontier_json
            != serde_json::to_value(current).map_err(storage)?
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    verify_locked_outboxes(&issuances, &frontiers, &envelope.outboxes)?;
    Ok(VerifiedScopeHistoryV1 {
        issuances,
        frontiers,
    })
}

fn verify_locked_issuance_row(
    row: LockedIssuanceRowV1,
) -> Result<StoredIssuanceV1, OperatorAuthorizationError> {
    let issuance: StoredIssuanceV1 = from_json(row.issuance_json)?;
    issuance
        .proposal
        .validate()
        .map_err(|_| OperatorAuthorizationError::Unavailable)?;
    let receipt: StoredIssuanceReceiptV1 = from_json(row.receipt_json)?;
    let expected_digest = stored_issuance_digest(&issuance)?;
    if row.authorization_identity != issuance.proposal.authorization_identity
        || row.issuer_identity != issuance.proposal.issuer_identity
        || row.principal != issuance.proposal.scope.principal
        || row.audience != issuance.proposal.scope.audience
        || row.scope_digest != issuance.proposal.scope.digest()?
        || row.semantic_digest != expected_digest
        || issuance.issuance_digest != expected_digest
        || from_i64(row.committed_at_epoch_ms)? != issuance.committed_at_epoch_ms
        || receipt != issuance_receipt(&issuance)
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(issuance)
}

fn verify_frontier_chain(
    issuance: &StoredIssuanceV1,
    frontiers: &[StoredRevocationFrontierV1],
) -> Result<(), OperatorAuthorizationError> {
    if frontiers.first() != Some(&genesis_frontier(issuance)?) {
        return Err(OperatorAuthorizationError::Unavailable);
    }

    for pair in frontiers.windows(2) {
        let predecessor = &pair[0];
        let successor = &pair[1];
        let added = successor
            .revocations
            .iter()
            .filter(|entry| !predecessor.revocations.contains(entry))
            .count();

        if successor.predecessor_frontier_identity.as_deref()
            != Some(predecessor.frontier_identity.as_str())
            || successor.sequence != predecessor.sequence.saturating_add(1)
            || successor.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
            || successor.revocations.len() != predecessor.revocations.len().saturating_add(1)
            || predecessor
                .revocations
                .iter()
                .any(|entry| !successor.revocations.contains(entry))
            || added != 1
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
    }
    Ok(())
}

fn verify_successor_frontiers(
    issuances: &[StoredIssuanceV1],
    frontiers: &[StoredRevocationFrontierV1],
) -> Result<(), OperatorAuthorizationError> {
    for issuance in issuances.iter().skip(1) {
        let admitted_frontier_identity = issuance
            .admitted_frontier_identity
            .as_deref()
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let admitted_frontier = frontiers
            .iter()
            .find(|frontier| frontier.frontier_identity == admitted_frontier_identity)
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let predecessor_identity = &issuance
            .predecessor_authorization
            .as_ref()
            .ok_or(OperatorAuthorizationError::Unavailable)?
            .authorization_identity;

        if admitted_frontier.committed_at_epoch_ms > issuance.committed_at_epoch_ms
            || admitted_frontier
                .revocations
                .iter()
                .any(|entry| &entry.authorization_identity == predecessor_identity)
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
    }
    Ok(())
}

fn verify_locked_outboxes(
    issuances: &[StoredIssuanceV1],
    frontiers: &[StoredRevocationFrontierV1],
    rows: &[LockedOutboxRowV1],
) -> Result<(), OperatorAuthorizationError> {
    if rows.len() != frontiers.len().saturating_add(issuances.len()) {
        return Err(OperatorAuthorizationError::Unavailable);
    }

    for issuance in issuances {
        let receipt = issuance_receipt(issuance);
        verify_locked_outbox_row(
            rows,
            &receipt.receipt_identity,
            &issuance.proposal.authorization_identity,
            ISSUED_EVENT,
            &receipt,
            issuance.committed_at_epoch_ms,
        )?;
    }

    for frontier in frontiers {
        verify_locked_outbox_row(
            rows,
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            FRONTIER_EVENT,
            frontier,
            frontier.committed_at_epoch_ms,
        )?;
    }
    Ok(())
}

fn verify_locked_outbox_row<T: Serialize>(
    rows: &[LockedOutboxRowV1],
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), OperatorAuthorizationError> {
    let payload_digest = canonical_digest("operator-authorization.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "operator-authorization-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let matches: Vec<_> = rows
        .iter()
        .filter(|row| row.aggregate_identity == aggregate)
        .collect();

    if matches.len() != 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let row = matches[0];
    let record: StoredOutboxV1 = from_json(row.payload_json.clone())?;
    if row.event_identity != event_identity
        || row.event_kind != kind
        || row.payload_digest != payload_digest
        || from_i64(row.committed_at_epoch_ms)? != committed_at
        || record
            != (StoredOutboxV1 {
                schema_version: 1,
                event_identity,
                aggregate_identity: aggregate.to_string(),
                event_kind: kind.to_string(),
                payload_digest,
                committed_at_epoch_ms: committed_at,
            })
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(())
}

async fn load_verified(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &OperatorAuthorizationLocatorV1,
    mode: AuthorizationReadModeV1,
    lock_rows: bool,
) -> Result<OperatorAuthorizationReadbackV1, OperatorAuthorizationError> {
    let issuance = load_issuance_row(
        transaction,
        &locator.authorization_identity,
        if lock_rows {
            CanonicalRowLockV1::Share
        } else {
            CanonicalRowLockV1::None
        },
    )
    .await?
    .ok_or(OperatorAuthorizationError::Unavailable)?;
    let receipt = issuance_receipt(&issuance);
    if receipt.receipt_identity != locator.issuance_receipt_identity {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let scope_digest = issuance.proposal.scope.digest()?;
    let history = verify_scope_history(transaction, &scope_digest, false, lock_rows)
        .await?
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    if history.issuance(&locator.authorization_identity)? != &issuance {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let frontier = match mode {
        AuthorizationReadModeV1::CurrentAtLock => history.current()?.clone(),
        AuthorizationReadModeV1::Current { read_cut_epoch_ms } => {
            let frontier = history.current()?.clone();

            if read_cut_epoch_ms < issuance.proposal.not_before_epoch_ms
                || read_cut_epoch_ms >= issuance.proposal.valid_through_epoch_ms
                || frontier.revocations.iter().any(|entry| {
                    entry.authorization_identity == issuance.proposal.authorization_identity
                })
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            frontier
        }
        AuthorizationReadModeV1::Historical { frontier_identity } => {
            let frontier = history
                .frontiers
                .iter()
                .find(|frontier| frontier.frontier_identity == frontier_identity)
                .cloned()
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let admitted_sequence = match issuance.admitted_frontier_identity.as_deref() {
                Some(identity) => history
                    .frontiers
                    .iter()
                    .find(|candidate| candidate.frontier_identity == identity)
                    .map(|candidate| candidate.sequence)
                    .ok_or(OperatorAuthorizationError::Unavailable)?,
                None => 0,
            };

            if frontier.sequence < admitted_sequence
                || frontier.revocations.iter().any(|entry| {
                    entry.authorization_identity == issuance.proposal.authorization_identity
                })
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            frontier
        }
    };

    if frontier.scope_digest != scope_digest {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(OperatorAuthorizationReadbackV1 {
        issuance_receipt: receipt.into(),
        frontier: frontier.public(),
        issuer_identity: issuance.proposal.issuer_identity,
        issuer_key_version: issuance.proposal.issuer_key_version,
        scope: issuance.proposal.scope,
        request_proof_digest: issuance.proposal.request_proof_digest,
        operation_manifests: issuance.proposal.operation_manifests,
        not_before_epoch_ms: issuance.proposal.not_before_epoch_ms,
        valid_through_epoch_ms: issuance.proposal.valid_through_epoch_ms,
    })
}

#[derive(Clone, Copy)]
enum CanonicalRowLockV1 {
    None,
    Share,
    Update,
}

async fn load_issuance_row(
    transaction: &mut Transaction<'_, Postgres>,
    identity_value: &str,
    row_lock: CanonicalRowLockV1,
) -> Result<Option<StoredIssuanceV1>, OperatorAuthorizationError> {
    let query = match row_lock {
        CanonicalRowLockV1::None => {
            "SELECT authorization_identity, issuer_identity, principal, audience, scope_digest, semantic_digest, issuance_json, receipt_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity = $1"
        }
        CanonicalRowLockV1::Share => {
            "SELECT authorization_identity, issuer_identity, principal, audience, scope_digest, semantic_digest, issuance_json, receipt_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity = $1 FOR SHARE"
        }
        CanonicalRowLockV1::Update => {
            "SELECT authorization_identity, issuer_identity, principal, audience, scope_digest, semantic_digest, issuance_json, receipt_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity = $1 FOR UPDATE"
        }
    };
    let rows = sqlx::query(query)
        .bind(identity_value)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredIssuanceV1 = from_json(row.try_get("issuance_json").map_err(storage)?)?;
    stored
        .proposal
        .validate()
        .map_err(|_| OperatorAuthorizationError::Unavailable)?;
    let expected_digest = stored_issuance_digest(&stored)?;
    let receipt: StoredIssuanceReceiptV1 =
        from_json(row.try_get("receipt_json").map_err(storage)?)?;
    if row
        .try_get::<String, _>("authorization_identity")
        .map_err(storage)?
        != stored.proposal.authorization_identity
        || row
            .try_get::<String, _>("issuer_identity")
            .map_err(storage)?
            != stored.proposal.issuer_identity
        || row.try_get::<String, _>("principal").map_err(storage)?
            != stored.proposal.scope.principal
        || row.try_get::<String, _>("audience").map_err(storage)? != stored.proposal.scope.audience
        || row.try_get::<String, _>("scope_digest").map_err(storage)?
            != stored.proposal.scope.digest()?
        || row
            .try_get::<String, _>("semantic_digest")
            .map_err(storage)?
            != expected_digest
        || stored.issuance_digest != expected_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
        || receipt != issuance_receipt(&stored)
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(Some(stored))
}

async fn verify_scope_history(
    transaction: &mut Transaction<'_, Postgres>,
    scope_digest: &str,
    update_head: bool,
    lock_rows: bool,
) -> Result<Option<VerifiedScopeHistoryV1>, OperatorAuthorizationError> {
    let issuance_query = if lock_rows {
        "SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE scope_digest = $1 ORDER BY authorization_identity FOR SHARE"
    } else {
        "SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE scope_digest = $1 ORDER BY authorization_identity"
    };
    let issuance_rows = sqlx::query(issuance_query)
        .bind(scope_digest)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let frontier_query = if lock_rows {
        "SELECT frontier_identity, issuer_identity, principal, audience, sequence FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE scope_digest = $1 ORDER BY sequence, frontier_identity FOR SHARE"
    } else {
        "SELECT frontier_identity, issuer_identity, principal, audience, sequence FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE scope_digest = $1 ORDER BY sequence, frontier_identity"
    };
    let frontier_rows = sqlx::query(frontier_query)
        .bind(scope_digest)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let head_query = match (update_head, lock_rows) {
        (true, _) => {
            "SELECT scope_digest, frontier_identity, sequence, frontier_digest, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest = $1 FOR UPDATE"
        }
        (false, true) => {
            "SELECT scope_digest, frontier_identity, sequence, frontier_digest, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest = $1 FOR SHARE"
        }
        (false, false) => {
            "SELECT scope_digest, frontier_identity, sequence, frontier_digest, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest = $1"
        }
    };
    let head_rows = sqlx::query(head_query)
        .bind(scope_digest)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if issuance_rows.is_empty() {
        if frontier_rows.is_empty() && head_rows.is_empty() {
            return Ok(None);
        }
        return Err(OperatorAuthorizationError::Unavailable);
    }

    if frontier_rows.is_empty() || head_rows.len() != 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let mut issuances = Vec::with_capacity(issuance_rows.len());
    for row in &issuance_rows {
        let authorization_identity: String =
            row.try_get("authorization_identity").map_err(storage)?;
        let issuance = load_issuance_row(
            transaction,
            &authorization_identity,
            if lock_rows {
                CanonicalRowLockV1::Share
            } else {
                CanonicalRowLockV1::None
            },
        )
        .await?
        .ok_or(OperatorAuthorizationError::Unavailable)?;
        if issuance.proposal.scope.digest()? != scope_digest {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let receipt = issuance_receipt(&issuance);
        verify_outbox(
            transaction,
            &receipt.receipt_identity,
            &issuance.proposal.authorization_identity,
            ISSUED_EVENT,
            &receipt,
            issuance.committed_at_epoch_ms,
            lock_rows,
        )
        .await?;
        issuances.push(issuance);
    }
    let issuances = order_and_verify_issuances(issuances)?;
    let genesis = issuances
        .first()
        .ok_or(OperatorAuthorizationError::Unavailable)?;

    let mut frontiers = Vec::with_capacity(frontier_rows.len());
    for (index, row) in frontier_rows.iter().enumerate() {
        let frontier_identity: String = row.try_get("frontier_identity").map_err(storage)?;
        let frontier = load_frontier_row(
            transaction,
            &frontier_identity,
            if lock_rows {
                CanonicalRowLockV1::Share
            } else {
                CanonicalRowLockV1::None
            },
        )
        .await?;

        if row
            .try_get::<String, _>("issuer_identity")
            .map_err(storage)?
            != genesis.proposal.issuer_identity
            || row.try_get::<String, _>("principal").map_err(storage)?
                != genesis.proposal.scope.principal
            || row.try_get::<String, _>("audience").map_err(storage)?
                != genesis.proposal.scope.audience
            || row.try_get::<i64, _>("sequence").map_err(storage)?
                != i64::try_from(index).map_err(storage)?
            || frontier.sequence != u64::try_from(index).map_err(storage)?
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        verify_outbox(
            transaction,
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            FRONTIER_EVENT,
            &frontier,
            frontier.committed_at_epoch_ms,
            lock_rows,
        )
        .await?;
        frontiers.push(frontier);
    }

    if frontiers.first() != Some(&genesis_frontier(genesis)?) {
        return Err(OperatorAuthorizationError::Unavailable);
    }

    for issuance in issuances.iter().skip(1) {
        let admitted_frontier_identity = issuance
            .admitted_frontier_identity
            .as_deref()
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let admitted_frontier = frontiers
            .iter()
            .find(|frontier| frontier.frontier_identity == admitted_frontier_identity)
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let predecessor_identity = issuance
            .predecessor_authorization
            .as_ref()
            .ok_or(OperatorAuthorizationError::Unavailable)?
            .authorization_identity
            .as_str();

        if admitted_frontier.committed_at_epoch_ms > issuance.committed_at_epoch_ms
            || admitted_frontier
                .revocations
                .iter()
                .any(|entry| entry.authorization_identity == predecessor_identity)
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
    }

    for pair in frontiers.windows(2) {
        let predecessor = &pair[0];
        let successor = &pair[1];
        let added = successor
            .revocations
            .iter()
            .filter(|entry| !predecessor.revocations.contains(entry))
            .count();

        if successor.predecessor_frontier_identity.as_deref()
            != Some(predecessor.frontier_identity.as_str())
            || successor.sequence != predecessor.sequence.saturating_add(1)
            || successor.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
            || successor.revocations.len() != predecessor.revocations.len().saturating_add(1)
            || predecessor
                .revocations
                .iter()
                .any(|entry| !successor.revocations.contains(entry))
            || added != 1
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
    }

    let current = frontiers
        .last()
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    let head = &head_rows[0];
    let current_digest =
        canonical_digest("operator-authorization.revocation-frontier.v1", current)?;
    if head.try_get::<String, _>("scope_digest").map_err(storage)? != current.scope_digest
        || head
            .try_get::<String, _>("frontier_identity")
            .map_err(storage)?
            != current.frontier_identity
        || head.try_get::<i64, _>("sequence").map_err(storage)? != to_i64(current.sequence)?
        || head
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != current_digest
        || from_i64(head.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != current.committed_at_epoch_ms
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }

    Ok(Some(VerifiedScopeHistoryV1 {
        issuances,
        frontiers,
    }))
}

fn exact_revocation_transition<'a>(
    frontiers: &'a [StoredRevocationFrontierV1],
    proposal: &OperatorAuthorizationRevocationProposalV1,
) -> Option<&'a StoredRevocationFrontierV1> {
    frontiers.windows(2).find_map(|pair| {
        let predecessor = &pair[0];
        let successor = &pair[1];
        let added: Vec<_> = successor
            .revocations
            .iter()
            .filter(|entry| !predecessor.revocations.contains(entry))
            .collect();
        (predecessor.frontier_identity == proposal.expected_frontier_identity
            && added.len() == 1
            && added[0].authorization_identity == proposal.authorization.authorization_identity
            && added[0].reason_code == proposal.reason_code)
            .then_some(successor)
    })
}

async fn load_frontier_row(
    transaction: &mut Transaction<'_, Postgres>,
    frontier_identity: &str,
    row_lock: CanonicalRowLockV1,
) -> Result<StoredRevocationFrontierV1, OperatorAuthorizationError> {
    let query = match row_lock {
        CanonicalRowLockV1::None => {
            "SELECT frontier_identity, scope_digest, sequence, predecessor_frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE frontier_identity = $1"
        }
        CanonicalRowLockV1::Share => {
            "SELECT frontier_identity, scope_digest, sequence, predecessor_frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE frontier_identity = $1 FOR SHARE"
        }
        CanonicalRowLockV1::Update => {
            "SELECT frontier_identity, scope_digest, sequence, predecessor_frontier_identity, frontier_digest, frontier_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE frontier_identity = $1 FOR UPDATE"
        }
    };
    let rows = sqlx::query(query)
        .bind(frontier_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let row = &rows[0];
    let frontier: StoredRevocationFrontierV1 =
        from_json(row.try_get("frontier_json").map_err(storage)?)?;
    let digest = canonical_digest("operator-authorization.revocation-frontier.v1", &frontier)?;
    if frontier.schema_version != OPERATOR_AUTHORIZATION_SCHEMA_V1
        || row
            .try_get::<String, _>("frontier_identity")
            .map_err(storage)?
            != frontier.frontier_identity
        || row.try_get::<String, _>("scope_digest").map_err(storage)? != frontier.scope_digest
        || row.try_get::<i64, _>("sequence").map_err(storage)? != to_i64(frontier.sequence)?
        || row
            .try_get::<Option<String>, _>("predecessor_frontier_identity")
            .map_err(storage)?
            != frontier.predecessor_frontier_identity
        || row
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != frontier.committed_at_epoch_ms
        || frontier
            .revocations
            .windows(2)
            .any(|pair| pair[0].authorization_identity >= pair[1].authorization_identity)
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(frontier)
}

fn issuance_receipt(stored: &StoredIssuanceV1) -> StoredIssuanceReceiptV1 {
    let committed = stored.committed_at_epoch_ms.to_string();
    StoredIssuanceReceiptV1 {
        schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
        receipt_identity: identity(
            "operator-authorization-issuance-receipt-v1",
            &[
                &stored.proposal.authorization_identity,
                &stored.issuance_digest,
                &committed,
            ],
        ),
        authorization_identity: stored.proposal.authorization_identity.clone(),
        issuance_digest: stored.issuance_digest.clone(),
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn stored_issuance_digest(stored: &StoredIssuanceV1) -> Result<String, OperatorAuthorizationError> {
    match (
        &stored.predecessor_authorization,
        &stored.admitted_frontier_identity,
    ) {
        (None, None) => stored.proposal.semantic_digest(),
        (Some(predecessor_authorization), Some(expected_current_frontier_identity)) => {
            OperatorAuthorizationSuccessorIssuanceProposalV1 {
                predecessor_authorization: predecessor_authorization.clone(),
                expected_current_frontier_identity: expected_current_frontier_identity.clone(),
                successor: stored.proposal.clone(),
            }
            .semantic_digest()
        }
        _ => Err(OperatorAuthorizationError::Unavailable),
    }
}

fn order_and_verify_issuances(
    issuances: Vec<StoredIssuanceV1>,
) -> Result<Vec<StoredIssuanceV1>, OperatorAuthorizationError> {
    if issuances.is_empty() {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let genesis_matches = issuances
        .iter()
        .filter(|issuance| issuance.predecessor_authorization.is_none())
        .count();

    if genesis_matches != 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let mut remaining = issuances;
    let genesis_index = remaining
        .iter()
        .position(|issuance| issuance.predecessor_authorization.is_none())
        .ok_or(OperatorAuthorizationError::Unavailable)?;
    let genesis = remaining.remove(genesis_index);
    if genesis.admitted_frontier_identity.is_some()
        || stored_issuance_digest(&genesis)? != genesis.issuance_digest
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let mut ordered = vec![genesis];

    while !remaining.is_empty() {
        let predecessor = ordered
            .last()
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let predecessor_locator = OperatorAuthorizationLocatorV1 {
            authorization_identity: predecessor.proposal.authorization_identity.clone(),
            issuance_receipt_identity: issuance_receipt(predecessor).receipt_identity,
        };
        let matches = remaining
            .iter()
            .enumerate()
            .filter(|(_, issuance)| {
                issuance.predecessor_authorization.as_ref() == Some(&predecessor_locator)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();

        if matches.len() != 1 {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let successor = remaining.remove(matches[0]);
        if successor.schema_version != OPERATOR_AUTHORIZATION_SCHEMA_V1
            || successor.proposal.authorization_identity
                == predecessor.proposal.authorization_identity
            || successor.proposal.issuer_identity != predecessor.proposal.issuer_identity
            || successor.proposal.issuer_key_version != predecessor.proposal.issuer_key_version
            || successor.proposal.scope != predecessor.proposal.scope
            || successor.proposal.request_proof_digest != predecessor.proposal.request_proof_digest
            || successor.proposal.operation_manifests != predecessor.proposal.operation_manifests
            || successor.proposal.not_before_epoch_ms < predecessor.proposal.not_before_epoch_ms
            || successor.proposal.valid_through_epoch_ms
                <= predecessor.proposal.valid_through_epoch_ms
            || successor.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
            || stored_issuance_digest(&successor)? != successor.issuance_digest
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        ordered.push(successor);
    }
    Ok(ordered)
}

fn genesis_frontier(
    stored: &StoredIssuanceV1,
) -> Result<StoredRevocationFrontierV1, OperatorAuthorizationError> {
    let scope_digest = stored.proposal.scope.digest()?;
    Ok(StoredRevocationFrontierV1 {
        schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
        frontier_identity: identity(
            "operator-authorization-revocation-frontier-v1",
            &[
                &scope_digest,
                GENESIS_REVOCATION_FRONTIER,
                &stored.committed_at_epoch_ms.to_string(),
            ],
        ),
        scope_digest,
        sequence: 0,
        predecessor_frontier_identity: None,
        revocations: Vec::new(),
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    })
}

async fn insert_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), OperatorAuthorizationError> {
    let payload_digest = canonical_digest("operator-authorization.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "operator-authorization-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let record = StoredOutboxV1 {
        schema_version: 1,
        event_identity: event_identity.clone(),
        aggregate_identity: aggregate.to_string(),
        event_kind: kind.to_string(),
        payload_digest: payload_digest.clone(),
        committed_at_epoch_ms: committed_at,
    };
    sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&event_identity).bind(aggregate).bind(kind).bind(&payload_digest).bind(json(&record)?).bind(to_i64(committed_at)?)
        .execute(&mut **transaction).await.map_err(storage)?;
    Ok(())
}

async fn verify_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
    lock_rows: bool,
) -> Result<(), OperatorAuthorizationError> {
    let payload_digest = canonical_digest("operator-authorization.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "operator-authorization-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let query = if lock_rows {
        "SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE aggregate_identity = $1 FOR SHARE"
    } else {
        "SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE aggregate_identity = $1"
    };
    let rows = sqlx::query(query)
        .bind(aggregate)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let row = &rows[0];
    let record: StoredOutboxV1 = from_json(row.try_get("payload_json").map_err(storage)?)?;
    if record
        != (StoredOutboxV1 {
            schema_version: 1,
            event_identity: event_identity.clone(),
            aggregate_identity: aggregate.to_string(),
            event_kind: kind.to_string(),
            payload_digest: payload_digest.clone(),
            committed_at_epoch_ms: committed_at,
        })
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != aggregate
        || row.try_get::<String, _>("event_kind").map_err(storage)? != kind
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)? != committed_at
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(())
}

fn now_ms() -> Result<u64, OperatorAuthorizationError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| OperatorAuthorizationError::Storage(e.to_string()))?;
    u64::try_from(duration.as_millis())
        .map_err(|e| OperatorAuthorizationError::Storage(e.to_string()))
}

fn json<T: Serialize>(value: &T) -> Result<serde_json::Value, OperatorAuthorizationError> {
    serde_json::to_value(value).map_err(|e| OperatorAuthorizationError::Storage(e.to_string()))
}

fn from_json<T: for<'de> Deserialize<'de>>(
    value: serde_json::Value,
) -> Result<T, OperatorAuthorizationError> {
    serde_json::from_value(value).map_err(|_| OperatorAuthorizationError::Unavailable)
}

fn to_i64(value: u64) -> Result<i64, OperatorAuthorizationError> {
    i64::try_from(value).map_err(|e| OperatorAuthorizationError::Storage(e.to_string()))
}

fn from_i64(value: i64) -> Result<u64, OperatorAuthorizationError> {
    u64::try_from(value).map_err(|_| OperatorAuthorizationError::Unavailable)
}

fn storage(error: impl Display) -> OperatorAuthorizationError {
    OperatorAuthorizationError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::{OperationManifestBindingV1, OperatorAuthorizationScopeV1};
    use vibe_testkit::postgres::DedicatedPostgresTestDatabase;

    async fn resolve_current(
        owner: &OperatorAuthorizationIssuerPostgresV1,
        admitted: &OperatorAuthorizationReadbackV1,
        read_cut_epoch_ms: u64,
    ) -> Result<OperatorAuthorizationReadbackV1, OperatorAuthorizationError> {
        let mut transaction = owner.pool().begin().await.unwrap();
        let result = resolve_authorization_in_transaction(
            &mut transaction,
            &admitted.locator(),
            AuthorizationReadModeV1::Current { read_cut_epoch_ms },
        )
        .await;
        transaction.rollback().await.unwrap();
        result
    }

    #[tokio::test]
    #[ignore = "requires an admitted OPERATOR_AUTHORIZATION_TEST_DATABASE_URL"]
    async fn postgres_successor_is_append_only_replay_safe_and_preserves_history() {
        let test_database =
            DedicatedPostgresTestDatabase::admit("OPERATOR_AUTHORIZATION_TEST_DATABASE_URL")
                .await
                .unwrap();
        let _mutation = test_database.mutation();
        let owner = OperatorAuthorizationIssuerPostgresV1::connect(test_database.database_url())
            .await
            .unwrap();
        let suffix = format!("{}-{}", std::process::id(), now_ms().unwrap());
        let now = now_ms().unwrap();
        let genesis_proposal = OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("authorization-old-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            scope: OperatorAuthorizationScopeV1 {
                principal: format!("principal-{suffix}"),
                audience: "PRODUCT_EDGE".into(),
                permissions: vec!["provider:invoke".into()],
            },
            request_proof_digest: "sha256:test-proof".into(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: format!("manifest-{suffix}"),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            expected_revocation_head: "EMPTY".into(),
        };
        let old = owner.issue_genesis(genesis_proposal.clone()).await.unwrap();
        let successor = OperatorAuthorizationSuccessorIssuanceProposalV1 {
            predecessor_authorization: old.locator(),
            expected_current_frontier_identity: old.frontier().frontier_identity().into(),
            successor: OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("authorization-new-{suffix}"),
                valid_through_epoch_ms: now.saturating_add(1_200_000),
                ..genesis_proposal
            },
        };
        let before: (i64, i64) = (
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE scope_digest=$1")
                .bind(old.frontier().scope_digest()).fetch_one(owner.pool()).await.unwrap(),
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_owner_outbox_v1")
                .fetch_one(owner.pool()).await.unwrap(),
        );
        let renewed = owner.issue_successor(successor.clone()).await.unwrap();
        assert_eq!(
            owner.issue_successor(successor.clone()).await.unwrap(),
            renewed
        );
        assert_eq!(
            (
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE scope_digest=$1")
                    .bind(old.frontier().scope_digest()).fetch_one(owner.pool()).await.unwrap(),
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_owner_outbox_v1")
                    .fetch_one(owner.pool()).await.unwrap(),
            ),
            (before.0 + 1, before.1 + 1)
        );

        let mut historical_transaction = owner.pool().begin().await.unwrap();
        let historical = resolve_authorization_in_transaction(
            &mut historical_transaction,
            &old.locator(),
            AuthorizationReadModeV1::Historical {
                frontier_identity: old.frontier().frontier_identity().into(),
            },
        )
        .await
        .unwrap();
        historical_transaction.rollback().await.unwrap();
        assert_eq!(historical.locator(), old.locator());
        assert_eq!(
            resolve_current(&owner, &renewed, now).await.unwrap(),
            renewed
        );

        let mut stale = successor;
        stale.successor.authorization_identity.push_str("-stale");
        stale.expected_current_frontier_identity.push_str("-stale");
        assert!(matches!(
            owner.issue_successor(stale).await,
            Err(OperatorAuthorizationError::ConflictingReplay)
        ));
    }

    #[tokio::test]
    #[ignore = "requires an admitted OPERATOR_AUTHORIZATION_TEST_DATABASE_URL"]
    async fn postgres_history_mutations_fail_closed_and_restore_exactly() {
        let test_database =
            DedicatedPostgresTestDatabase::admit("OPERATOR_AUTHORIZATION_TEST_DATABASE_URL")
                .await
                .unwrap();
        let _mutation = test_database.mutation();
        let database_url = test_database.database_url();
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let now = now_ms().unwrap();
        let owner = OperatorAuthorizationIssuerPostgresV1::connect(database_url)
            .await
            .unwrap();
        let proposal = OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("operator-authorization-history-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
            issuer_key_version: "test-key-v1".to_string(),
            scope: OperatorAuthorizationScopeV1 {
                principal: format!("principal-{suffix}"),
                audience: "R_AND_D".to_string(),
                permissions: vec!["research:submit".to_string()],
            },
            request_proof_digest: "sha256:test-proof".to_string(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: format!("manifest-{suffix}"),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
            expected_revocation_head: "EMPTY".to_string(),
        };
        let admitted = owner.issue_genesis(proposal.clone()).await.unwrap();
        assert_eq!(owner.issue_genesis(proposal).await.unwrap(), admitted);

        assert_eq!(
            resolve_current(&owner, &admitted, now).await.unwrap(),
            admitted
        );

        let before_forged: (i64, i64) = (
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE scope_digest=$1")
                .bind(admitted.frontier().scope_digest()).fetch_one(owner.pool()).await.unwrap(),
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE aggregate_identity=$1")
                .bind(admitted.frontier().frontier_identity()).fetch_one(owner.pool()).await.unwrap(),
        );
        let mut forged = admitted.locator();
        forged.issuance_receipt_identity.push_str("-forged");
        assert!(matches!(
            owner
                .revoke(OperatorAuthorizationRevocationProposalV1 {
                    authorization: forged,
                    expected_frontier_identity: admitted.frontier().frontier_identity().to_string(),
                    reason_code: "ADMIN_REVOKED".to_string(),
                })
                .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        let after_forged: (i64, i64) = (
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE scope_digest=$1")
                .bind(admitted.frontier().scope_digest()).fetch_one(owner.pool()).await.unwrap(),
            sqlx::query_scalar("SELECT COUNT(*) FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE aggregate_identity=$1")
                .bind(admitted.frontier().frontier_identity()).fetch_one(owner.pool()).await.unwrap(),
        );
        assert_eq!(after_forged, before_forged);

        let scope_digest = admitted.frontier().scope_digest().to_string();
        let original_head_digest: String = sqlx::query_scalar(
            "SELECT frontier_digest FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest=$1",
        )
        .bind(&scope_digest)
        .fetch_one(owner.pool())
        .await
        .unwrap();
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_revocation_heads_v1 SET frontier_digest='sha256:corrupt' WHERE scope_digest=$1")
            .bind(&scope_digest).execute(owner.pool()).await.unwrap();
        assert!(matches!(
            resolve_current(&owner, &admitted, now).await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_revocation_heads_v1 SET frontier_digest=$1 WHERE scope_digest=$2")
            .bind(&original_head_digest).bind(&scope_digest).execute(owner.pool()).await.unwrap();
        assert_eq!(
            resolve_current(&owner, &admitted, now).await.unwrap(),
            admitted
        );

        let frontier_identity = admitted.frontier().frontier_identity().to_string();
        let original_frontier_json: serde_json::Value = sqlx::query_scalar(
            "SELECT frontier_json FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE frontier_identity=$1",
        )
        .bind(&frontier_identity).fetch_one(owner.pool()).await.unwrap();
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_revocation_frontiers_v1 SET frontier_json=jsonb_set(frontier_json, '{unexpected}', 'true'::jsonb) WHERE frontier_identity=$1")
            .bind(&frontier_identity).execute(owner.pool()).await.unwrap();
        assert!(matches!(
            resolve_current(&owner, &admitted, now).await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_revocation_frontiers_v1 SET frontier_json=$1 WHERE frontier_identity=$2")
            .bind(&original_frontier_json).bind(&frontier_identity).execute(owner.pool()).await.unwrap();
        assert_eq!(
            resolve_current(&owner, &admitted, now).await.unwrap(),
            admitted
        );

        let authorization_identity = admitted.locator().authorization_identity;
        let original_issuance_digest: String = sqlx::query_scalar(
            "SELECT semantic_digest FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1",
        )
        .bind(&authorization_identity).fetch_one(owner.pool()).await.unwrap();
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET semantic_digest='sha256:corrupt' WHERE authorization_identity=$1")
            .bind(&authorization_identity).execute(owner.pool()).await.unwrap();
        assert!(matches!(
            resolve_current(&owner, &admitted, now).await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        sqlx::query("UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET semantic_digest=$1 WHERE authorization_identity=$2")
            .bind(&original_issuance_digest).bind(&authorization_identity).execute(owner.pool()).await.unwrap();
        assert_eq!(
            resolve_current(&owner, &admitted, now).await.unwrap(),
            admitted
        );

        let original_issuance_row: (
            String,
            String,
            String,
            String,
            serde_json::Value,
            serde_json::Value,
            i64,
        ) = sqlx::query_as(
            "SELECT issuer_identity, principal, audience, scope_digest, issuance_json, receipt_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1",
        )
        .bind(&authorization_identity)
        .fetch_one(owner.pool())
        .await
        .unwrap();

        for mutation in [
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuer_identity=issuer_identity || '-corrupt' WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET principal=principal || '-corrupt' WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET audience=audience || '-corrupt' WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET scope_digest=scope_digest || '-corrupt' WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,issuer_key_version}', '\"corrupt-key\"'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,scope,principal}', '\"corrupt-principal\"'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,scope,audience}', '\"corrupt-audience\"'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,scope,permissions}', '[]'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,request_proof_digest}', '\"sha256:corrupt\"'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuance_json=jsonb_set(issuance_json, '{proposal,operation_manifests}', '[]'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET receipt_json=jsonb_set(receipt_json, '{receipt_identity}', '\"forged-receipt\"'::jsonb) WHERE authorization_identity=$1",
            "UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET committed_at_epoch_ms=committed_at_epoch_ms + 1 WHERE authorization_identity=$1",
        ] {
            sqlx::query(mutation)
                .bind(&authorization_identity)
                .execute(owner.pool())
                .await
                .unwrap();
            assert!(matches!(
                resolve_current(&owner, &admitted, now).await,
                Err(OperatorAuthorizationError::Unavailable)
            ));
            sqlx::query("UPDATE operator_authorization_private.operator_authorization_issuances_v1 SET issuer_identity=$2, principal=$3, audience=$4, scope_digest=$5, issuance_json=$6, receipt_json=$7, semantic_digest=$8, committed_at_epoch_ms=$9 WHERE authorization_identity=$1")
                .bind(&authorization_identity)
                .bind(&original_issuance_row.0)
                .bind(&original_issuance_row.1)
                .bind(&original_issuance_row.2)
                .bind(&original_issuance_row.3)
                .bind(&original_issuance_row.4)
                .bind(&original_issuance_row.5)
                .bind(&original_issuance_digest)
                .bind(original_issuance_row.6)
                .execute(owner.pool())
                .await
                .unwrap();
            assert_eq!(
                resolve_current(&owner, &admitted, now).await.unwrap(),
                admitted
            );
        }

        let extra_event = format!("operator-authorization-extra-event-{suffix}");
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,'UNEXPECTED_V1','sha256:corrupt','{}'::jsonb,$3)")
            .bind(&extra_event).bind(&authorization_identity).bind(to_i64(now).unwrap())
            .execute(owner.pool()).await.unwrap();
        assert!(matches!(
            resolve_current(&owner, &admitted, now).await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        sqlx::query("DELETE FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE event_identity=$1")
            .bind(&extra_event)
            .execute(owner.pool())
            .await
            .unwrap();
        assert_eq!(
            resolve_current(&owner, &admitted, now).await.unwrap(),
            admitted
        );

        let revocation = OperatorAuthorizationRevocationProposalV1 {
            authorization: admitted.locator(),
            expected_frontier_identity: frontier_identity,
            reason_code: "ADMIN_REVOKED".to_string(),
        };
        let first_revocation = owner.revoke(revocation.clone()).await.unwrap();
        assert_eq!(owner.revoke(revocation).await.unwrap(), first_revocation);
    }

    #[tokio::test]
    #[ignore = "requires an admitted OPERATOR_AUTHORIZATION_TEST_DATABASE_URL"]
    async fn shared_resolver_blocks_revoke_update_lock() {
        let test_database =
            DedicatedPostgresTestDatabase::admit("OPERATOR_AUTHORIZATION_TEST_DATABASE_URL")
                .await
                .unwrap();
        let _mutation = test_database.mutation();
        let database_url = test_database.database_url();
        let suffix = format!("{}-{}", std::process::id(), now_ms().unwrap());
        let now = now_ms().unwrap();
        let owner = Arc::new(
            OperatorAuthorizationIssuerPostgresV1::connect(database_url)
                .await
                .unwrap(),
        );
        let admitted = owner
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-lock-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-lock-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: format!("manifest-lock-{suffix}"),
                    manifest_digest: format!("sha256:{}", "a".repeat(64)),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let mut shared_holder = owner.pool().begin().await.unwrap();
        resolve_authorization_in_transaction(
            &mut shared_holder,
            &admitted.locator(),
            AuthorizationReadModeV1::Current {
                read_cut_epoch_ms: now,
            },
        )
        .await
        .unwrap();

        let proposal = OperatorAuthorizationRevocationProposalV1 {
            authorization: admitted.locator(),
            expected_frontier_identity: admitted.frontier().frontier_identity().to_string(),
            reason_code: "ADMIN_REVOKED".to_string(),
        };
        let revoke_owner = Arc::clone(&owner);
        let revoke_task = tokio::spawn(async move { revoke_owner.revoke(proposal).await });
        tokio::task::yield_now().await;

        // The resolver's SECURITY DEFINER function holds the exact issuance
        // row FOR SHARE in this caller transaction, so the OA writer cannot
        // acquire its conflicting update lock.
        let mut row_probe = owner.pool().begin().await.unwrap();
        let blocked = sqlx::query("SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1 FOR UPDATE NOWAIT")
            .bind(&admitted.locator().authorization_identity)
            .fetch_one(&mut *row_probe).await;
        assert!(blocked.is_err());
        row_probe.rollback().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), async {
                while !revoke_task.is_finished() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .is_err()
        );

        shared_holder.commit().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), revoke_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires OPERATOR_AUTHORIZATION_TEST_DATABASE_URL and PRODUCT_EDGE_TEST_DATABASE_URL"]
    async fn select_only_consumer_resolve_serializes_with_revoke() {
        let test_database = DedicatedPostgresTestDatabase::admit_cross_owner(&[
            "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
            "PRODUCT_EDGE_TEST_DATABASE_URL",
        ])
        .await
        .unwrap();
        let _mutation = test_database.mutation();
        let issuer_database_url = test_database.database_url();
        let consumer_database_url = test_database.database_url();
        let suffix = format!("{}-{}", std::process::id(), now_ms().unwrap());
        let now = now_ms().unwrap();
        let owner = Arc::new(
            OperatorAuthorizationIssuerPostgresV1::connect(issuer_database_url)
                .await
                .unwrap(),
        );
        let admitted = owner
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-select-only-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-select-only-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: format!("manifest-select-only-{suffix}"),
                    manifest_digest: format!("sha256:{}", "a".repeat(64)),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let consumer = PgPool::connect(consumer_database_url).await.unwrap();
        let consumer_role: String = sqlx::query_scalar("SELECT current_user")
            .fetch_one(&consumer)
            .await
            .unwrap();
        assert_eq!(consumer_role, "product_edge_owner");
        let function_catalog: (String, bool, String, String, bool, Option<Vec<String>>) =
            sqlx::query_as(
                "SELECT owner.rolname, procedure.prosecdef, procedure.provolatile::text, procedure.proparallel::text, procedure.proisstrict, procedure.proconfig FROM pg_proc procedure JOIN pg_roles owner ON owner.oid=procedure.proowner WHERE procedure.oid=to_regprocedure('operator_authorization_api.lock_current_authorization_v1(text,text)')",
            )
            .fetch_one(owner.pool())
            .await
            .unwrap();
        assert_eq!(function_catalog.0, "operator_authorization_owner");
        assert!(function_catalog.1, "resolver must be SECURITY DEFINER");
        assert_eq!(function_catalog.2, "v", "resolver must be VOLATILE");
        assert_eq!(function_catalog.3, "u", "resolver must be PARALLEL UNSAFE");
        assert!(function_catalog.4, "resolver must be STRICT");
        assert_eq!(
            function_catalog.5,
            Some(vec![
                "search_path=pg_catalog, operator_authorization_private".to_string()
            ])
        );

        for schema in [
            "operator_authorization_private",
            "operator_authorization_api",
        ] {
            let owner_name: String = sqlx::query_scalar(
                "SELECT owner.rolname FROM pg_namespace namespace JOIN pg_roles owner ON owner.oid=namespace.nspowner WHERE namespace.nspname=$1",
            )
            .bind(schema)
            .fetch_one(owner.pool())
            .await
            .unwrap();
            assert_eq!(owner_name, "operator_authorization_owner");
        }
        let public_execute: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM pg_proc procedure CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) privilege WHERE procedure.oid=to_regprocedure('operator_authorization_api.lock_current_authorization_v1(text,text)') AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE')",
        )
        .fetch_one(owner.pool())
        .await
        .unwrap();
        assert!(!public_execute);

        for (role, expected) in [
            ("product_edge_owner", true),
            ("operator_authorization_writer", true),
            ("rd_owner", false),
        ] {
            let executable: bool = sqlx::query_scalar(
                "SELECT has_function_privilege($1::name, to_regprocedure('operator_authorization_api.lock_current_authorization_v1(text,text)'), 'EXECUTE')",
            )
            .bind(role)
            .fetch_one(owner.pool())
            .await
            .unwrap();
            assert_eq!(executable, expected, "unexpected function ACL for {role}");
        }
        let api_usage: bool = sqlx::query_scalar(
            "SELECT has_schema_privilege(current_user, 'operator_authorization_api', 'USAGE')",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        let api_create: bool = sqlx::query_scalar(
            "SELECT has_schema_privilege(current_user, 'operator_authorization_api', 'CREATE')",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        let private_usage: bool = sqlx::query_scalar(
            "SELECT has_schema_privilege(current_user, 'operator_authorization_private', 'USAGE')",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        assert!(api_usage);
        assert!(!api_create);
        assert!(!private_usage);
        let direct_lock = sqlx::query("SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1 FOR SHARE")
            .bind(&admitted.locator().authorization_identity)
            .fetch_one(&consumer)
            .await;
        assert!(direct_lock.is_err());
        assert!(
            sqlx::query("SET ROLE operator_authorization_owner")
                .execute(&consumer)
                .await
                .is_err()
        );

        for table in [
            "operator_authorization_private.operator_authorization_issuances_v1",
            "operator_authorization_private.operator_authorization_revocation_frontiers_v1",
            "operator_authorization_private.operator_authorization_revocation_heads_v1",
            "operator_authorization_private.operator_authorization_owner_outbox_v1",
        ] {
            let relation_oid: i64 = sqlx::query_scalar("SELECT to_regclass($1)::oid::bigint")
                .bind(table)
                .fetch_one(owner.pool())
                .await
                .unwrap();

            for privilege in [
                "INSERT",
                "UPDATE",
                "DELETE",
                "TRUNCATE",
                "REFERENCES",
                "TRIGGER",
            ] {
                let granted: bool =
                    sqlx::query_scalar("SELECT has_table_privilege(current_user, $1::oid, $2)")
                        .bind(relation_oid)
                        .bind(privilege)
                        .fetch_one(&consumer)
                        .await
                        .unwrap();
                assert!(
                    !granted,
                    "{consumer_role} unexpectedly has {privilege} on {table}"
                );
            }
        }

        let mut forged = admitted.locator();
        forged.issuance_receipt_identity.push_str("-forged");
        let mut forged_transaction = consumer.begin().await.unwrap();
        assert!(matches!(
            resolve_authorization_in_transaction(
                &mut forged_transaction,
                &forged,
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            )
            .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        forged_transaction.rollback().await.unwrap();

        let mut expired_transaction = consumer.begin().await.unwrap();
        assert!(matches!(
            resolve_authorization_in_transaction(
                &mut expired_transaction,
                &admitted.locator(),
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: admitted.valid_through_epoch_ms(),
                },
            )
            .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        expired_transaction.rollback().await.unwrap();

        let mut wrong_isolation = consumer.begin().await.unwrap();
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *wrong_isolation)
            .await
            .unwrap();
        assert!(matches!(
            resolve_authorization_in_transaction(
                &mut wrong_isolation,
                &admitted.locator(),
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            )
            .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        wrong_isolation.rollback().await.unwrap();

        let mut shared_left = consumer.begin().await.unwrap();
        resolve_authorization_in_transaction(
            &mut shared_left,
            &admitted.locator(),
            AuthorizationReadModeV1::Current {
                read_cut_epoch_ms: now,
            },
        )
        .await
        .unwrap();
        let mut shared_right = consumer.begin().await.unwrap();
        tokio::time::timeout(
            Duration::from_secs(1),
            resolve_authorization_in_transaction(
                &mut shared_right,
                &admitted.locator(),
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            ),
        )
        .await
        .unwrap()
        .unwrap();
        shared_left.rollback().await.unwrap();
        shared_right.rollback().await.unwrap();

        let other = owner
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-other-scope-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-other-scope-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: format!("manifest-other-scope-{suffix}"),
                    manifest_digest: format!("sha256:{}", "b".repeat(64)),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();

        let mut admitted_cut = consumer.begin().await.unwrap();
        assert_eq!(
            resolve_authorization_in_transaction(
                &mut admitted_cut,
                &admitted.locator(),
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            )
            .await
            .unwrap(),
            admitted
        );

        tokio::time::timeout(
            Duration::from_secs(1),
            owner.revoke(OperatorAuthorizationRevocationProposalV1 {
                authorization: other.locator(),
                expected_frontier_identity: other.frontier().frontier_identity().to_string(),
                reason_code: "ADMIN_REVOKED".to_string(),
            }),
        )
        .await
        .unwrap()
        .unwrap();

        let proposal = OperatorAuthorizationRevocationProposalV1 {
            authorization: admitted.locator(),
            expected_frontier_identity: admitted.frontier().frontier_identity().to_string(),
            reason_code: "ADMIN_REVOKED".to_string(),
        };
        let revoke_owner = Arc::clone(&owner);
        let revoke_task = tokio::spawn(async move { revoke_owner.revoke(proposal).await });
        tokio::task::yield_now().await;

        let mut lock_probe = owner.pool().begin().await.unwrap();
        let blocked = sqlx::query("SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1 FOR UPDATE NOWAIT")
            .bind(&admitted.locator().authorization_identity)
            .fetch_one(&mut *lock_probe)
            .await;
        assert!(blocked.is_err());
        lock_probe.rollback().await.unwrap();
        assert!(!revoke_task.is_finished());

        admitted_cut.commit().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), revoke_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let mut after_revoke = consumer.begin().await.unwrap();
        assert!(matches!(
            resolve_authorization_in_transaction(
                &mut after_revoke,
                &admitted.locator(),
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            )
            .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        after_revoke.rollback().await.unwrap();

        // A resolver rollback releases the shared issuance/head/frontier locks;
        // the queued writer must then finish without a retry or deadlock.
        let rollback_authorization = owner
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-rollback-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-rollback-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: format!("manifest-rollback-{suffix}"),
                    manifest_digest: format!("sha256:{}", "c".repeat(64)),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let mut rollback_holder = consumer.begin().await.unwrap();
        resolve_authorization_in_transaction(
            &mut rollback_holder,
            &rollback_authorization.locator(),
            AuthorizationReadModeV1::Current {
                read_cut_epoch_ms: now,
            },
        )
        .await
        .unwrap();
        let rollback_owner = Arc::clone(&owner);
        let rollback_proposal = OperatorAuthorizationRevocationProposalV1 {
            authorization: rollback_authorization.locator(),
            expected_frontier_identity: rollback_authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            reason_code: "ADMIN_REVOKED".to_string(),
        };
        let rollback_future = async move { rollback_owner.revoke(rollback_proposal).await };

        let rollback_revoke = tokio::spawn(rollback_future);
        tokio::task::yield_now().await;
        assert!(!rollback_revoke.is_finished());
        rollback_holder.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), rollback_revoke)
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        // Queue the OA writer first behind a test-held update lock, then queue
        // the PE resolver. PostgreSQL's row-lock queue must let revoke commit
        // first; the waiting resolver then reconstructs the new frontier and
        // fails closed as revoked.
        let revoke_first = owner
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-revoke-first-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-revoke-first-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: format!("manifest-revoke-first-{suffix}"),
                    manifest_digest: format!("sha256:{}", "d".repeat(64)),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let mut writer_gate = owner.pool().begin().await.unwrap();
        sqlx::query("SELECT authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity=$1 FOR UPDATE")
            .bind(&revoke_first.locator().authorization_identity)
            .fetch_one(&mut *writer_gate)
            .await
            .unwrap();
        let revoke_first_owner = Arc::clone(&owner);
        let revoke_first_proposal = OperatorAuthorizationRevocationProposalV1 {
            authorization: revoke_first.locator(),
            expected_frontier_identity: revoke_first.frontier().frontier_identity().to_string(),
            reason_code: "ADMIN_REVOKED".to_string(),
        };
        let revoke_first_future =
            async move { revoke_first_owner.revoke(revoke_first_proposal).await };

        let revoke_first_task = tokio::spawn(revoke_first_future);
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE usename=current_user AND wait_event_type='Lock' AND query LIKE '%operator_authorization_issuances_v1%FOR UPDATE%'",
                )
                .fetch_one(owner.pool())
                .await
                .unwrap();

                if waiting > 0 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let revoke_first_consumer = consumer.clone();
        let revoke_first_locator = revoke_first.locator();

        let waiting_resolver = tokio::spawn(async move {
            let mut transaction = revoke_first_consumer.begin().await.unwrap();
            let result = resolve_authorization_in_transaction(
                &mut transaction,
                &revoke_first_locator,
                AuthorizationReadModeV1::Current {
                    read_cut_epoch_ms: now,
                },
            )
            .await;
            transaction.rollback().await.unwrap();
            result
        });
        tokio::task::yield_now().await;
        assert!(!revoke_first_task.is_finished());
        assert!(!waiting_resolver.is_finished());
        writer_gate.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), revoke_first_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(5), waiting_resolver)
                .await
                .unwrap()
                .unwrap(),
            Err(OperatorAuthorizationError::Unavailable)
        ));

        // Repeated concurrent reader/writer starts exercise the single fixed
        // issuance -> head -> frontier order. Either the reader observes the
        // pre-revoke cut or it fails closed after revoke; neither may deadlock.
        for index in 0..4 {
            let stress = owner
                .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                    authorization_identity: format!(
                        "operator-authorization-lock-stress-{index}-{suffix}"
                    ),
                    issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                    issuer_key_version: "test-key-v1".to_string(),
                    scope: OperatorAuthorizationScopeV1 {
                        principal: format!("principal-lock-stress-{index}-{suffix}"),
                        audience: "R_AND_D".to_string(),
                        permissions: vec!["research:submit".to_string()],
                    },
                    request_proof_digest: "sha256:test-proof".to_string(),
                    operation_manifests: vec![OperationManifestBindingV1 {
                        manifest_identity: format!("manifest-lock-stress-{index}-{suffix}"),
                        manifest_digest: format!("sha256:{}", "e".repeat(64)),
                    }],
                    not_before_epoch_ms: now.saturating_sub(1_000),
                    valid_through_epoch_ms: now.saturating_add(3_600_000),
                    expected_revocation_head: "EMPTY".to_string(),
                })
                .await
                .unwrap();
            let stress_consumer = consumer.clone();
            let stress_locator = stress.locator();
            let resolve = async move {
                let mut transaction = stress_consumer.begin().await.unwrap();
                let result = resolve_authorization_in_transaction(
                    &mut transaction,
                    &stress_locator,
                    AuthorizationReadModeV1::Current {
                        read_cut_epoch_ms: now,
                    },
                )
                .await;
                transaction.rollback().await.unwrap();
                result
            };
            let revoke = owner.revoke(OperatorAuthorizationRevocationProposalV1 {
                authorization: stress.locator(),
                expected_frontier_identity: stress.frontier().frontier_identity().to_string(),
                reason_code: "ADMIN_REVOKED".to_string(),
            });
            let (resolved, revoked) =
                Box::pin(tokio::time::timeout(Duration::from_secs(5), async {
                    tokio::join!(resolve, revoke)
                }))
                .await
                .unwrap();
            assert!(matches!(
                resolved,
                Ok(_) | Err(OperatorAuthorizationError::Unavailable)
            ));
            revoked.unwrap();
        }
    }
}
