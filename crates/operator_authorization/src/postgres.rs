use std::{
    fmt::Display,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::{
    AuthorizationReadModeV1, ExpiredManifestRecoveryEpochV1, GENESIS_REVOCATION_FRONTIER,
    OPERATOR_AUTHORIZATION_SCHEMA_V1, OperatorAuthorizationError,
    OperatorAuthorizationExpiredManifestRecoveryProposalV1,
    OperatorAuthorizationIssuanceProposalV1, OperatorAuthorizationIssuanceReceiptV1,
    OperatorAuthorizationLocatorV1, OperatorAuthorizationReadbackV1,
    OperatorAuthorizationRevocationFrontierV1, OperatorAuthorizationRevocationProposalV1,
    OperatorAuthorizationSuccessorIssuanceProposalV1, UntrustedCanonicalAuthorizationEvidenceV1,
    UntrustedCanonicalPortfolioResourceGrantEvidenceV1, canonical_digest, identity,
};

pub use portfolio_resource_grant::{
    parse_untrusted_portfolio_resource_grant_envelope_v1,
    resolve_portfolio_resource_grant_in_transaction,
};

const ISSUED_EVENT: &str = "OPERATOR_AUTHORIZATION_ISSUED_V1";
const FRONTIER_EVENT: &str = "OPERATOR_AUTHORIZATION_REVOCATION_FRONTIER_V1";
const EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS: [&str; 4] = [
    "CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 (recovery_epoch_identity TEXT PRIMARY KEY CHECK (recovery_epoch_identity <> ''), recovery_epoch_digest TEXT NOT NULL UNIQUE CHECK (recovery_epoch_digest <> ''), predecessor_authorization_identity TEXT NOT NULL CHECK (predecessor_authorization_identity <> ''), successor_authorization_identity TEXT NOT NULL UNIQUE REFERENCES operator_authorization_private.operator_authorization_issuances_v1(authorization_identity) CHECK (successor_authorization_identity <> '' AND successor_authorization_identity <> predecessor_authorization_identity), recovery_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms >= 0))",
    "ALTER TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 OWNER TO operator_authorization_owner",
    "REVOKE ALL ON TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 FROM PUBLIC, operator_authorization_writer, rd_owner, product_edge_owner, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 TO operator_authorization_writer",
];
const VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA: &str = "SELECT relation.relowner = pg_catalog.to_regrole('operator_authorization_owner')::oid
   AND relation.relpersistence = 'p'
   AND (
     SELECT pg_catalog.count(*) = 6
        AND pg_catalog.bool_and(CASE attribute.attname
          WHEN 'recovery_epoch_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'recovery_epoch_digest' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'predecessor_authorization_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'successor_authorization_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'recovery_json' THEN attribute.atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'committed_at_epoch_ms' THEN attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
          ELSE false
        END AND NOT attribute.atthasdef AND attribute.attidentity = '' AND attribute.attgenerated = '')
       FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
   )
   AND (
     SELECT pg_catalog.count(*) = 9
        AND pg_catalog.bool_and(constraint_entry.convalidated)
        AND pg_catalog.array_agg(
              constraint_entry.contype::pg_catalog.text || ':' || pg_catalog.pg_get_constraintdef(constraint_entry.oid, true)
              ORDER BY constraint_entry.contype, pg_catalog.pg_get_constraintdef(constraint_entry.oid, true)
            ) = ARRAY[
              'c:CHECK (committed_at_epoch_ms >= 0)',
              'c:CHECK (predecessor_authorization_identity <> ''''::text)',
              'c:CHECK (recovery_epoch_digest <> ''''::text)',
              'c:CHECK (recovery_epoch_identity <> ''''::text)',
              'c:CHECK (successor_authorization_identity <> ''''::text AND successor_authorization_identity <> predecessor_authorization_identity)',
              'f:FOREIGN KEY (successor_authorization_identity) REFERENCES operator_authorization_private.operator_authorization_issuances_v1(authorization_identity)',
              'p:PRIMARY KEY (recovery_epoch_identity)',
              'u:UNIQUE (recovery_epoch_digest)',
              'u:UNIQUE (successor_authorization_identity)'
            ]::pg_catalog.text[]
       FROM pg_catalog.pg_constraint constraint_entry
      WHERE constraint_entry.conrelid = relation.oid
   )
   AND (
     SELECT pg_catalog.count(*) = 11
        AND pg_catalog.count(*) FILTER (WHERE acl.grantee = pg_catalog.to_regrole('operator_authorization_owner')::oid) = 7
        AND pg_catalog.count(*) FILTER (WHERE acl.grantee = pg_catalog.to_regrole('operator_authorization_writer')::oid AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE') AND NOT acl.is_grantable) = 4
       FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
   )
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'operator_authorization_private'
   AND relation.relname = 'operator_authorization_expired_manifest_recoveries_v1'
   AND relation.relkind = 'r'
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredIssuanceV1 {
    schema_version: u32,
    proposal: OperatorAuthorizationIssuanceProposalV1,
    #[serde(default)]
    predecessor_authorization: Option<OperatorAuthorizationLocatorV1>,
    #[serde(default)]
    admitted_frontier_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recovery_epoch: Option<ExpiredManifestRecoveryEpochV1>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredExpiredManifestRecoveryV1 {
    schema_version: u32,
    proposal: OperatorAuthorizationExpiredManifestRecoveryProposalV1,
    proposal_digest: String,
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

    /// Connects the issuer for expired-manifest recovery and prepares only the
    /// recovery sidecar schema. Existing Owner tables must already exist.
    pub async fn connect_for_expired_manifest_recovery(
        database_url: &str,
    ) -> Result<Self, OperatorAuthorizationError> {
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        let owner = Self { pool };
        owner.prepare_expired_manifest_recovery_schema().await?;
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
            "REVOKE ALL ON SCHEMA operator_authorization_api FROM product_edge_custodian",
            "GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_custodian",
            "REVOKE ALL ON FUNCTION operator_authorization_api.lock_current_authorization_v1(text,text) FROM product_edge_custodian",
            "GRANT EXECUTE ON FUNCTION operator_authorization_api.lock_current_authorization_v1(text,text) TO product_edge_custodian",
        ] {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        }
        self.prepare_expired_manifest_recovery_schema().await?;
        portfolio_resource_grant::migrate(&self.pool).await?;
        Ok(())
    }

    async fn prepare_expired_manifest_recovery_schema(
        &self,
    ) -> Result<(), OperatorAuthorizationError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;

        for statement in EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        let verified = sqlx::query_scalar::<_, bool>(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?
            .unwrap_or(false);

        if !verified {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        transaction.commit().await.map_err(storage)?;
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
            recovery_epoch: None,
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
        let committed_at = now_ms()?;

        if history.issuance_head()? != &predecessor
            || current.frontier_identity != proposal.expected_current_frontier_identity
            || current.revocations.iter().any(|entry| {
                entry.authorization_identity == predecessor.proposal.authorization_identity
            })
            || committed_at >= predecessor.proposal.valid_through_epoch_ms
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
            recovery_epoch: None,
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

    pub async fn recover_expired_manifests(
        &self,
        proposal: OperatorAuthorizationExpiredManifestRecoveryProposalV1,
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
                || existing.recovery_epoch != Some(proposal.recovery_epoch.clone())
                || existing.issuance_digest != semantic_digest
            {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            let recovery = load_expired_manifest_recovery(
                &mut transaction,
                &proposal.recovery_epoch.recovery_epoch_identity,
            )
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;
            if recovery.proposal != proposal || recovery.proposal_digest != semantic_digest {
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
        let committed_at = now_ms()?;

        if history.issuance_head()? != &predecessor
            || current.frontier_identity != proposal.expected_current_frontier_identity
            || current.revocations.iter().any(|entry| {
                entry.authorization_identity == predecessor.proposal.authorization_identity
            })
            || committed_at < predecessor.proposal.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }

        if proposal.recovery_epoch.predecessor_operation_manifests()
            != predecessor.proposal.operation_manifests
            || proposal.successor.issuer_identity != predecessor.proposal.issuer_identity
            || proposal.successor.issuer_key_version != predecessor.proposal.issuer_key_version
            || proposal.successor.scope != predecessor.proposal.scope
            || proposal.successor.request_proof_digest != predecessor.proposal.request_proof_digest
            || proposal.successor.not_before_epoch_ms != predecessor.proposal.valid_through_epoch_ms
            || proposal.successor.valid_through_epoch_ms
                <= predecessor.proposal.valid_through_epoch_ms
            || committed_at >= proposal.successor.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }

        let stored = StoredIssuanceV1 {
            schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
            proposal: proposal.successor.clone(),
            predecessor_authorization: Some(proposal.predecessor_authorization.clone()),
            admitted_frontier_identity: Some(proposal.expected_current_frontier_identity.clone()),
            recovery_epoch: Some(proposal.recovery_epoch.clone()),
            issuance_digest: semantic_digest.clone(),
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
        let recovery = StoredExpiredManifestRecoveryV1 {
            schema_version: OPERATOR_AUTHORIZATION_SCHEMA_V1,
            proposal: proposal.clone(),
            proposal_digest: semantic_digest.clone(),
            committed_at_epoch_ms: committed_at,
        };
        sqlx::query("INSERT INTO operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 (recovery_epoch_identity, recovery_epoch_digest, predecessor_authorization_identity, successor_authorization_identity, recovery_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&proposal.recovery_epoch.recovery_epoch_identity)
            .bind(&proposal.recovery_epoch.recovery_epoch_digest)
            .bind(&proposal.predecessor_authorization.authorization_identity)
            .bind(&proposal.successor.authorization_identity)
            .bind(json(&recovery)?)
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
        recovery_epoch: evidence.recovery_epoch,
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
        recovery_epoch: issuance.recovery_epoch,
    })
}

async fn load_expired_manifest_recovery(
    transaction: &mut Transaction<'_, Postgres>,
    recovery_epoch_identity: &str,
) -> Result<Option<StoredExpiredManifestRecoveryV1>, OperatorAuthorizationError> {
    let rows = sqlx::query("SELECT recovery_epoch_identity, recovery_epoch_digest, predecessor_authorization_identity, successor_authorization_identity, recovery_json, committed_at_epoch_ms FROM operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 WHERE recovery_epoch_identity=$1 FOR SHARE")
        .bind(recovery_epoch_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredExpiredManifestRecoveryV1 =
        from_json(row.try_get("recovery_json").map_err(storage)?)?;

    if stored.schema_version != OPERATOR_AUTHORIZATION_SCHEMA_V1
        || stored.proposal.validate().is_err()
        || stored.proposal.semantic_digest()? != stored.proposal_digest
        || row
            .try_get::<String, _>("recovery_epoch_identity")
            .map_err(storage)?
            != stored.proposal.recovery_epoch.recovery_epoch_identity
        || row
            .try_get::<String, _>("recovery_epoch_digest")
            .map_err(storage)?
            != stored.proposal.recovery_epoch.recovery_epoch_digest
        || row
            .try_get::<String, _>("predecessor_authorization_identity")
            .map_err(storage)?
            != stored
                .proposal
                .predecessor_authorization
                .authorization_identity
        || row
            .try_get::<String, _>("successor_authorization_identity")
            .map_err(storage)?
            != stored.proposal.successor.authorization_identity
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
    {
        return Err(OperatorAuthorizationError::Unavailable);
    }
    Ok(Some(stored))
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
        recovery_epoch: issuance.recovery_epoch,
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
            if let Some(recovery_epoch) = &stored.recovery_epoch {
                OperatorAuthorizationExpiredManifestRecoveryProposalV1 {
                    recovery_epoch: recovery_epoch.clone(),
                    predecessor_authorization: predecessor_authorization.clone(),
                    expected_current_frontier_identity: expected_current_frontier_identity.clone(),
                    successor: stored.proposal.clone(),
                }
                .semantic_digest()
            } else {
                OperatorAuthorizationSuccessorIssuanceProposalV1 {
                    predecessor_authorization: predecessor_authorization.clone(),
                    expected_current_frontier_identity: expected_current_frontier_identity.clone(),
                    successor: stored.proposal.clone(),
                }
                .semantic_digest()
            }
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
        || genesis.recovery_epoch.is_some()
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
        let valid_manifest_transition = if let Some(epoch) = &successor.recovery_epoch {
            epoch.validate().is_ok()
                && epoch.predecessor_operation_manifests()
                    == predecessor.proposal.operation_manifests
                && epoch.successor_operation_manifests() == successor.proposal.operation_manifests
                && successor.proposal.not_before_epoch_ms
                    == predecessor.proposal.valid_through_epoch_ms
        } else {
            successor.proposal.operation_manifests == predecessor.proposal.operation_manifests
                && successor.proposal.not_before_epoch_ms
                    >= predecessor.proposal.not_before_epoch_ms
                && successor.committed_at_epoch_ms < predecessor.proposal.valid_through_epoch_ms
        };

        if successor.schema_version != OPERATOR_AUTHORIZATION_SCHEMA_V1
            || successor.proposal.authorization_identity
                == predecessor.proposal.authorization_identity
            || successor.proposal.issuer_identity != predecessor.proposal.issuer_identity
            || successor.proposal.issuer_key_version != predecessor.proposal.issuer_key_version
            || successor.proposal.scope != predecessor.proposal.scope
            || successor.proposal.request_proof_digest != predecessor.proposal.request_proof_digest
            || !valid_manifest_transition
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

mod portfolio_resource_grant {
    use super::*;
    use crate::{
        PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1, PortfolioResourceGrantContentV1,
        PortfolioResourceGrantIssuanceProposalV1, PortfolioResourceGrantIssuanceReceiptV1,
        PortfolioResourceGrantLocatorV1, PortfolioResourceGrantReadRequestV1,
        PortfolioResourceGrantReadbackV1, PortfolioResourceGrantResolutionV1,
        PortfolioResourceGrantRevocationFrontierV1, PortfolioResourceGrantRevocationProposalV1,
        PortfolioResourceGrantSuccessorProposalV1, PortfolioResourceGrantUnavailableReasonV1,
        PortfolioResourceV1, ProductEdgeManifestBindingV1,
    };
    const GRANT_ISSUED_EVENT: &str = "PORTFOLIO_RESOURCE_GRANT_ISSUED_V1";
    const GRANT_FRONTIER_EVENT: &str = "PORTFOLIO_RESOURCE_GRANT_REVOCATION_FRONTIER_V1";
    const GRANT_ADVISORY_LOCK_NAMESPACE: &str =
        "operator-authorization.portfolio-resource-grant.resource.v1";

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredGrantOutboxV1 {
        schema_version: u32,
        event_identity: String,
        aggregate_identity: String,
        event_kind: String,
        payload_digest: String,
        committed_at_epoch_ms: u64,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredGrantIssuanceV1 {
        schema_version: u32,
        proposal: PortfolioResourceGrantIssuanceProposalV1,
        predecessor: Option<PortfolioResourceGrantLocatorV1>,
        issuance_digest: String,
        committed_at_epoch_ms: u64,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredGrantReceiptV1 {
        schema_version: u32,
        receipt_identity: String,
        grant_identity: String,
        issuance_digest: String,
        committed_at_epoch_ms: u64,
    }

    impl From<StoredGrantReceiptV1> for PortfolioResourceGrantIssuanceReceiptV1 {
        fn from(value: StoredGrantReceiptV1) -> Self {
            Self {
                schema_version: value.schema_version,
                receipt_identity: value.receipt_identity,
                grant_identity: value.grant_identity,
                issuance_digest: value.issuance_digest,
                committed_at_epoch_ms: value.committed_at_epoch_ms,
            }
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredGrantRevocationV1 {
        grant_identity: String,
        reason_code: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredGrantFrontierV1 {
        schema_version: u32,
        frontier_identity: String,
        resource_digest: String,
        sequence: u64,
        predecessor_frontier_identity: Option<String>,
        revocations: Vec<StoredGrantRevocationV1>,
        committed_at_epoch_ms: u64,
    }

    impl StoredGrantFrontierV1 {
        fn public(&self) -> PortfolioResourceGrantRevocationFrontierV1 {
            PortfolioResourceGrantRevocationFrontierV1 {
                schema_version: self.schema_version,
                frontier_identity: self.frontier_identity.clone(),
                resource_digest: self.resource_digest.clone(),
                sequence: self.sequence,
                predecessor_frontier_identity: self.predecessor_frontier_identity.clone(),
                revoked_grant_identities: self
                    .revocations
                    .iter()
                    .map(|entry| entry.grant_identity.clone())
                    .collect(),
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            }
        }
    }

    #[derive(Deserialize)]
    #[cfg_attr(test, derive(Serialize))]
    #[serde(deny_unknown_fields)]
    struct LockedGrantIssuanceRowV1 {
        grant_identity: String,
        issuer_identity: String,
        principal: String,
        audience: String,
        permission: String,
        account_identity: String,
        execution_scope_identity: String,
        mode: String,
        resource_digest: String,
        semantic_digest: String,
        issuance_json: serde_json::Value,
        receipt_json: serde_json::Value,
        committed_at_epoch_ms: i64,
    }

    #[derive(Deserialize)]
    #[cfg_attr(test, derive(Serialize))]
    #[serde(deny_unknown_fields)]
    struct LockedGrantFrontierRowV1 {
        frontier_identity: String,
        resource_digest: String,
        sequence: i64,
        predecessor_frontier_identity: Option<String>,
        frontier_digest: String,
        frontier_json: serde_json::Value,
        committed_at_epoch_ms: i64,
    }

    #[derive(Deserialize)]
    #[cfg_attr(test, derive(Serialize))]
    #[serde(deny_unknown_fields)]
    struct LockedGrantHeadRowV1 {
        resource_digest: String,
        frontier_identity: String,
        sequence: i64,
        frontier_digest: String,
        committed_at_epoch_ms: i64,
    }

    #[derive(Deserialize)]
    #[cfg_attr(test, derive(Serialize))]
    #[serde(deny_unknown_fields)]
    struct LockedGrantOutboxRowV1 {
        event_identity: String,
        aggregate_identity: String,
        event_kind: String,
        payload_digest: String,
        payload_json: serde_json::Value,
        committed_at_epoch_ms: i64,
    }

    #[derive(Deserialize)]
    #[cfg_attr(test, derive(Serialize))]
    #[serde(deny_unknown_fields)]
    struct LockedGrantEnvelopeV1 {
        issuances: Vec<LockedGrantIssuanceRowV1>,
        head: LockedGrantHeadRowV1,
        frontiers: Vec<LockedGrantFrontierRowV1>,
        outboxes: Vec<LockedGrantOutboxRowV1>,
        observed_at_epoch_ms: i64,
    }

    struct VerifiedGrantHistoryV1 {
        issuances: Vec<StoredGrantIssuanceV1>,
        frontiers: Vec<StoredGrantFrontierV1>,
    }

    impl VerifiedGrantHistoryV1 {
        fn current(&self) -> Result<&StoredGrantFrontierV1, OperatorAuthorizationError> {
            self.frontiers
                .last()
                .ok_or(OperatorAuthorizationError::Unavailable)
        }

        fn issuance(
            &self,
            grant_identity: &str,
        ) -> Result<&StoredGrantIssuanceV1, OperatorAuthorizationError> {
            self.issuances
                .iter()
                .find(|item| item.proposal.grant_identity == grant_identity)
                .ok_or(OperatorAuthorizationError::Unavailable)
        }

        fn issuance_head(&self) -> Result<&StoredGrantIssuanceV1, OperatorAuthorizationError> {
            self.issuances
                .last()
                .ok_or(OperatorAuthorizationError::Unavailable)
        }
    }

    pub(super) async fn migrate(pool: &PgPool) -> Result<(), OperatorAuthorizationError> {
        let mut transaction = pool.begin().await.map_err(storage)?;
        sqlx::query("SET LOCAL ROLE operator_authorization_owner")
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;

        for statement in [
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.portfolio_resource_grant_issuances_v1 (grant_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, principal TEXT NOT NULL, audience TEXT NOT NULL, permission TEXT NOT NULL, account_identity TEXT NOT NULL, execution_scope_identity TEXT NOT NULL, mode TEXT NOT NULL, resource_digest TEXT NOT NULL, semantic_digest TEXT NOT NULL, issuance_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 (frontier_identity TEXT PRIMARY KEY, resource_digest TEXT NOT NULL, sequence BIGINT NOT NULL, predecessor_frontier_identity TEXT, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(resource_digest, sequence))",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 (resource_digest TEXT PRIMARY KEY, frontier_identity TEXT NOT NULL REFERENCES operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1(frontier_identity), sequence BIGINT NOT NULL, frontier_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS portfolio_resource_grant_issuance_resource_v1 ON operator_authorization_private.portfolio_resource_grant_issuances_v1(resource_digest, grant_identity)",
            "CREATE INDEX IF NOT EXISTS portfolio_resource_grant_outbox_aggregate_v1 ON operator_authorization_private.portfolio_resource_grant_owner_outbox_v1(aggregate_identity)",
            "REVOKE ALL ON TABLE operator_authorization_private.portfolio_resource_grant_issuances_v1, operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1, operator_authorization_private.portfolio_resource_grant_revocation_heads_v1, operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 FROM PUBLIC, product_edge_owner, rd_owner, qualification_writer",
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE operator_authorization_private.portfolio_resource_grant_issuances_v1, operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1, operator_authorization_private.portfolio_resource_grant_revocation_heads_v1, operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 TO operator_authorization_writer",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        sqlx::query(
            "CREATE OR REPLACE FUNCTION operator_authorization_api.lock_current_portfolio_resource_grant_v1(requested_grant_identity text, requested_issuance_receipt_identity text)
RETURNS jsonb
LANGUAGE plpgsql
STRICT VOLATILE PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog, operator_authorization_private
AS $function$
DECLARE
  hinted_resource_digest text;
  issuance operator_authorization_private.portfolio_resource_grant_issuances_v1%ROWTYPE;
  head operator_authorization_private.portfolio_resource_grant_revocation_heads_v1%ROWTYPE;
BEGIN
  SELECT item.resource_digest INTO hinted_resource_digest
    FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 item
    WHERE item.grant_identity=requested_grant_identity;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(
    'operator-authorization.portfolio-resource-grant.resource.v1:' || hinted_resource_digest,
    0
  ));
  PERFORM 1 FROM operator_authorization_private.portfolio_resource_grant_issuances_v1
    WHERE resource_digest=hinted_resource_digest ORDER BY grant_identity FOR SHARE;
  SELECT * INTO issuance FROM operator_authorization_private.portfolio_resource_grant_issuances_v1
    WHERE grant_identity=requested_grant_identity
      AND resource_digest=hinted_resource_digest;
  IF NOT FOUND OR issuance.receipt_json->>'receipt_identity' <> requested_issuance_receipt_identity THEN
    RETURN NULL;
  END IF;
  SELECT * INTO head FROM operator_authorization_private.portfolio_resource_grant_revocation_heads_v1
    WHERE resource_digest=issuance.resource_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1
    WHERE resource_digest=issuance.resource_digest ORDER BY sequence, frontier_identity FOR SHARE;
  PERFORM 1 FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 outbox
    WHERE outbox.aggregate_identity IN
      (SELECT grant_identity FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE resource_digest=issuance.resource_digest)
       OR outbox.aggregate_identity IN
      (SELECT frontier_identity FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 WHERE resource_digest=issuance.resource_digest)
    ORDER BY outbox.event_identity FOR SHARE;
  RETURN jsonb_build_object(
    'issuances', COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.grant_identity) FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 item WHERE item.resource_digest=issuance.resource_digest), '[]'::jsonb),
    'head', to_jsonb(head),
    'frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.sequence, item.frontier_identity) FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 item WHERE item.resource_digest=issuance.resource_digest), '[]'::jsonb),
    'outboxes', COALESCE((SELECT jsonb_agg(to_jsonb(outbox) ORDER BY outbox.event_identity) FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 outbox WHERE outbox.aggregate_identity IN (SELECT grant_identity FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE resource_digest=issuance.resource_digest) OR outbox.aggregate_identity IN (SELECT frontier_identity FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 WHERE resource_digest=issuance.resource_digest)), '[]'::jsonb),
    'observed_at_epoch_ms', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  );
END
$function$",
        )
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        for statement in [
            "ALTER FUNCTION operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text) OWNER TO operator_authorization_owner",
            "REVOKE ALL ON FUNCTION operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text) FROM PUBLIC, rd_owner, qualification_writer",
            "GRANT EXECUTE ON FUNCTION operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text) TO product_edge_owner, operator_authorization_writer",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        transaction.commit().await.map_err(storage)
    }

    impl OperatorAuthorizationIssuerPostgresV1 {
        pub async fn issue_portfolio_resource_grant_genesis(
            &self,
            proposal: PortfolioResourceGrantIssuanceProposalV1,
        ) -> Result<PortfolioResourceGrantReadbackV1, OperatorAuthorizationError> {
            proposal.validate()?;
            if proposal.expected_revocation_frontier_identity != "EMPTY" {
                return Err(OperatorAuthorizationError::InvalidProposal(
                    "portfolio resource grant genesis frontier",
                ));
            }
            let semantic_digest = proposal.semantic_digest()?;
            let resource_digest = proposal.content.resource.digest()?;
            let mut transaction = self.pool.begin().await.map_err(storage)?;
            lock_grant_resource_for_write(&mut transaction, &resource_digest).await?;
            if let Some(history) =
                verify_grant_history(&mut transaction, &resource_digest, true).await?
            {
                let existing = history
                    .issuances
                    .iter()
                    .find(|item| item.proposal.grant_identity == proposal.grant_identity)
                    .ok_or(OperatorAuthorizationError::ConflictingReplay)?;
                if existing.proposal != proposal || existing.issuance_digest != semantic_digest {
                    return Err(OperatorAuthorizationError::ConflictingReplay);
                }
                let result = resolve_locked_grant_readback(
                    &mut transaction,
                    &history,
                    &existing.proposal.grant_identity,
                )
                .await?;
                transaction.commit().await.map_err(storage)?;
                return Ok(result);
            }

            let committed_at = database_now(&mut transaction).await?;
            ensure_grant_current(&proposal.content, committed_at)?;
            let stored = StoredGrantIssuanceV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                proposal,
                predecessor: None,
                issuance_digest: semantic_digest,
                committed_at_epoch_ms: committed_at,
            };
            let receipt = grant_receipt(&stored);
            let frontier = grant_genesis_frontier(&stored)?;
            insert_grant_issuance(&mut transaction, &stored, &receipt).await?;
            insert_grant_frontier(&mut transaction, &frontier).await?;
            let frontier_digest = grant_frontier_digest(&frontier)?;
            sqlx::query("INSERT INTO operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 (resource_digest,frontier_identity,sequence,frontier_digest,committed_at_epoch_ms) VALUES ($1,$2,0,$3,$4)")
                .bind(&resource_digest).bind(&frontier.frontier_identity).bind(&frontier_digest)
                .bind(to_i64(committed_at)?).execute(&mut *transaction).await.map_err(storage)?;
            insert_grant_outbox(
                &mut transaction,
                &receipt.receipt_identity,
                &stored.proposal.grant_identity,
                GRANT_ISSUED_EVENT,
                &receipt,
                committed_at,
            )
            .await?;
            insert_grant_outbox(
                &mut transaction,
                &frontier.frontier_identity,
                &frontier.frontier_identity,
                GRANT_FRONTIER_EVENT,
                &frontier,
                committed_at,
            )
            .await?;
            let history = verify_grant_history(&mut transaction, &resource_digest, true)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let result = resolve_locked_grant_readback(
                &mut transaction,
                &history,
                &stored.proposal.grant_identity,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            Ok(result)
        }

        pub async fn issue_portfolio_resource_grant_successor(
            &self,
            proposal: PortfolioResourceGrantSuccessorProposalV1,
        ) -> Result<PortfolioResourceGrantReadbackV1, OperatorAuthorizationError> {
            proposal.validate()?;
            let mut transaction = self.pool.begin().await.map_err(storage)?;
            let resource_digest = load_grant_resource_digest_hint(
                &mut transaction,
                &proposal.predecessor.grant_identity,
            )
            .await?
            .ok_or(OperatorAuthorizationError::Unavailable)?;
            lock_grant_resource_for_write(&mut transaction, &resource_digest).await?;
            let history = verify_grant_history(&mut transaction, &resource_digest, true)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let predecessor = history
                .issuance(&proposal.predecessor.grant_identity)?
                .clone();

            if grant_receipt(&predecessor).receipt_identity
                != proposal.predecessor.issuance_receipt_identity
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            let current = history.current()?;
            let digest = proposal.semantic_digest()?;

            if let Some(existing) = history
                .issuances
                .iter()
                .find(|item| item.proposal.grant_identity == proposal.successor.grant_identity)
            {
                if existing.predecessor.as_ref() != Some(&proposal.predecessor)
                    || existing.proposal != proposal.successor
                    || existing.issuance_digest != digest
                    || history.issuance_head()? != existing
                {
                    return Err(OperatorAuthorizationError::ConflictingReplay);
                }
                let grant_identity = existing.proposal.grant_identity.clone();
                let result =
                    resolve_locked_grant_readback(&mut transaction, &history, &grant_identity)
                        .await?;
                transaction.commit().await.map_err(storage)?;
                return Ok(result);
            }

            if history.issuance_head()? != &predecessor
                || current.frontier_identity != proposal.expected_current_frontier_identity
                || current
                    .revocations
                    .iter()
                    .any(|item| item.grant_identity == predecessor.proposal.grant_identity)
                || proposal.successor.content.issuer_identity
                    != predecessor.proposal.content.issuer_identity
                || proposal.successor.content.issuer_key_version
                    != predecessor.proposal.content.issuer_key_version
                || proposal.successor.content.resource != predecessor.proposal.content.resource
                || proposal.successor.content.effective_at_epoch_ms
                    < predecessor.proposal.content.effective_at_epoch_ms
                || proposal.successor.content.valid_through_epoch_ms
                    <= predecessor.proposal.content.valid_through_epoch_ms
            {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            let committed_at = database_now(&mut transaction).await?;
            ensure_grant_current(&proposal.successor.content, committed_at)?;
            let stored = StoredGrantIssuanceV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                proposal: proposal.successor,
                predecessor: Some(proposal.predecessor),
                issuance_digest: digest,
                committed_at_epoch_ms: committed_at,
            };
            let receipt = grant_receipt(&stored);
            insert_grant_issuance(&mut transaction, &stored, &receipt).await?;
            insert_grant_outbox(
                &mut transaction,
                &receipt.receipt_identity,
                &stored.proposal.grant_identity,
                GRANT_ISSUED_EVENT,
                &receipt,
                committed_at,
            )
            .await?;
            let verified = verify_grant_history(&mut transaction, &resource_digest, true)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let result = resolve_locked_grant_readback(
                &mut transaction,
                &verified,
                &stored.proposal.grant_identity,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            Ok(result)
        }

        pub async fn revoke_portfolio_resource_grant(
            &self,
            proposal: PortfolioResourceGrantRevocationProposalV1,
        ) -> Result<PortfolioResourceGrantRevocationFrontierV1, OperatorAuthorizationError>
        {
            proposal.validate()?;
            let mut transaction = self.pool.begin().await.map_err(storage)?;
            let resource_digest =
                load_grant_resource_digest_hint(&mut transaction, &proposal.grant.grant_identity)
                    .await?
                    .ok_or(OperatorAuthorizationError::Unavailable)?;
            lock_grant_resource_for_write(&mut transaction, &resource_digest).await?;
            let history = verify_grant_history(&mut transaction, &resource_digest, true)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let issuance = history.issuance(&proposal.grant.grant_identity)?.clone();

            if grant_receipt(&issuance).receipt_identity != proposal.grant.issuance_receipt_identity
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            let current = history.current()?;
            if let Some(existing) = current
                .revocations
                .iter()
                .find(|item| item.grant_identity == proposal.grant.grant_identity)
            {
                if existing.reason_code == proposal.reason_code
                    && current.predecessor_frontier_identity.as_deref()
                        == Some(&proposal.expected_frontier_identity)
                {
                    transaction.commit().await.map_err(storage)?;
                    return Ok(current.public());
                }
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }

            if current.frontier_identity != proposal.expected_frontier_identity {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            let committed_at = database_now(&mut transaction).await?;
            let mut revocations = current.revocations.clone();
            revocations.push(StoredGrantRevocationV1 {
                grant_identity: proposal.grant.grant_identity,
                reason_code: proposal.reason_code,
            });
            revocations.sort_by(|left, right| left.grant_identity.cmp(&right.grant_identity));
            let next = StoredGrantFrontierV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                frontier_identity: identity(
                    "operator-authorization-portfolio-resource-grant-frontier-v1",
                    &[
                        &resource_digest,
                        &current.frontier_identity,
                        &canonical_digest(
                            "operator-authorization.portfolio-resource-grant-revocations.v1",
                            &revocations,
                        )?,
                        &committed_at.to_string(),
                    ],
                ),
                resource_digest: resource_digest.clone(),
                sequence: current.sequence.saturating_add(1),
                predecessor_frontier_identity: Some(current.frontier_identity.clone()),
                revocations,
                committed_at_epoch_ms: committed_at,
            };
            insert_grant_frontier(&mut transaction, &next).await?;
            let next_digest = grant_frontier_digest(&next)?;
            let updated = sqlx::query("UPDATE operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 SET frontier_identity=$1,sequence=$2,frontier_digest=$3,committed_at_epoch_ms=$4 WHERE resource_digest=$5 AND frontier_identity=$6 AND sequence=$7")
                .bind(&next.frontier_identity).bind(to_i64(next.sequence)?).bind(&next_digest)
                .bind(to_i64(committed_at)?).bind(&resource_digest).bind(&current.frontier_identity)
                .bind(to_i64(current.sequence)?).execute(&mut *transaction).await.map_err(storage)?;

            if updated.rows_affected() != 1 {
                return Err(OperatorAuthorizationError::ConflictingReplay);
            }
            insert_grant_outbox(
                &mut transaction,
                &next.frontier_identity,
                &next.frontier_identity,
                GRANT_FRONTIER_EVENT,
                &next,
                committed_at,
            )
            .await?;
            let verified = verify_grant_history(&mut transaction, &resource_digest, true)
                .await?
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            if verified.current()? != &next {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            transaction.commit().await.map_err(storage)?;
            Ok(next.public())
        }
    }

    pub async fn resolve_portfolio_resource_grant_in_transaction(
        transaction: &mut Transaction<'_, Postgres>,
        request: &PortfolioResourceGrantReadRequestV1,
    ) -> PortfolioResourceGrantResolutionV1 {
        let unavailable = |reason| PortfolioResourceGrantResolutionV1::Unavailable { reason };

        if request.validate().is_err() {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::InvalidRequest);
        }

        if ensure_read_committed(transaction).await.is_err() {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::OwnerUnavailable);
        }
        let envelope = sqlx::query_scalar::<_, Option<serde_json::Value>>(
            "SELECT operator_authorization_api.lock_current_portfolio_resource_grant_v1($1,$2)",
        )
        .bind(&request.locator.grant_identity)
        .bind(&request.locator.issuance_receipt_identity)
        .fetch_one(&mut **transaction)
        .await;
        let Ok(Some(value)) = envelope else {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::OwnerUnavailable);
        };
        let observed_at = value
            .get("observed_at_epoch_ms")
            .and_then(serde_json::Value::as_i64)
            .ok_or(OperatorAuthorizationError::Unavailable)
            .and_then(from_i64);
        let evidence = serde_json::to_vec(&value)
            .map_err(storage)
            .and_then(|bytes| {
                parse_untrusted_portfolio_resource_grant_envelope_v1(&bytes, &request.locator)
            });
        let (Ok(observed_at), Ok(evidence)) = (observed_at, evidence) else {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::OwnerUnavailable);
        };

        resolve_verified_grant_evidence(
            &evidence,
            observed_at,
            Some((&request.expected_resource, &request.expected_manifest)),
        )
    }

    fn ensure_grant_current(
        content: &PortfolioResourceGrantContentV1,
        observed_at: u64,
    ) -> Result<(), OperatorAuthorizationError> {
        if observed_at < content.effective_at_epoch_ms
            || observed_at >= content.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant validity",
            ));
        }
        Ok(())
    }

    fn grant_receipt(stored: &StoredGrantIssuanceV1) -> StoredGrantReceiptV1 {
        let committed = stored.committed_at_epoch_ms.to_string();
        StoredGrantReceiptV1 {
            schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
            receipt_identity: identity(
                "operator-authorization-portfolio-resource-grant-receipt-v1",
                &[
                    &stored.proposal.grant_identity,
                    &stored.issuance_digest,
                    &committed,
                ],
            ),
            grant_identity: stored.proposal.grant_identity.clone(),
            issuance_digest: stored.issuance_digest.clone(),
            committed_at_epoch_ms: stored.committed_at_epoch_ms,
        }
    }

    fn grant_genesis_frontier(
        stored: &StoredGrantIssuanceV1,
    ) -> Result<StoredGrantFrontierV1, OperatorAuthorizationError> {
        let resource_digest = stored.proposal.content.resource.digest()?;
        Ok(StoredGrantFrontierV1 {
            schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
            frontier_identity: identity(
                "operator-authorization-portfolio-resource-grant-frontier-v1",
                &[
                    &resource_digest,
                    GENESIS_REVOCATION_FRONTIER,
                    &stored.committed_at_epoch_ms.to_string(),
                ],
            ),
            resource_digest,
            sequence: 0,
            predecessor_frontier_identity: None,
            revocations: Vec::new(),
            committed_at_epoch_ms: stored.committed_at_epoch_ms,
        })
    }

    fn grant_frontier_digest(
        frontier: &StoredGrantFrontierV1,
    ) -> Result<String, OperatorAuthorizationError> {
        canonical_digest(
            "operator-authorization.portfolio-resource-grant-frontier.v1",
            frontier,
        )
    }

    fn stored_grant_digest(
        stored: &StoredGrantIssuanceV1,
    ) -> Result<String, OperatorAuthorizationError> {
        match &stored.predecessor {
            None => stored.proposal.semantic_digest(),
            Some(predecessor) => PortfolioResourceGrantSuccessorProposalV1 {
                predecessor: predecessor.clone(),
                expected_current_frontier_identity: stored
                    .proposal
                    .expected_revocation_frontier_identity
                    .clone(),
                successor: stored.proposal.clone(),
            }
            .semantic_digest(),
        }
    }

    fn resolve_verified_grant(
        stored: &StoredGrantIssuanceV1,
        frontier: &StoredGrantFrontierV1,
        observed_at: u64,
        expected: Option<(&PortfolioResourceV1, &ProductEdgeManifestBindingV1)>,
    ) -> PortfolioResourceGrantResolutionV1 {
        let evidence = UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {
            schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
            issuance_receipt: grant_receipt(stored).into(),
            frontier: frontier.public(),
            content: stored.proposal.content.clone(),
        };
        resolve_verified_grant_evidence(&evidence, observed_at, expected)
    }

    fn resolve_verified_grant_evidence(
        evidence: &UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
        observed_at: u64,
        expected: Option<(&PortfolioResourceV1, &ProductEdgeManifestBindingV1)>,
    ) -> PortfolioResourceGrantResolutionV1 {
        let unavailable = |reason| PortfolioResourceGrantResolutionV1::Unavailable { reason };

        if let Some((resource, manifest)) = expected {
            if !evidence.matches_resource(resource) {
                return unavailable(PortfolioResourceGrantUnavailableReasonV1::ResourceMismatch);
            }

            if !evidence.matches_product_edge_manifest(manifest) {
                return unavailable(PortfolioResourceGrantUnavailableReasonV1::ManifestMismatch);
            }
        }

        if observed_at < evidence.content.effective_at_epoch_ms {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::NotEffective);
        }

        if observed_at >= evidence.content.valid_through_epoch_ms {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::Expired);
        }

        if !evidence.is_current_at(observed_at) {
            return unavailable(PortfolioResourceGrantUnavailableReasonV1::Revoked);
        }
        PortfolioResourceGrantResolutionV1::Available {
            grant: Box::new(PortfolioResourceGrantReadbackV1 {
                issuance_receipt: evidence.issuance_receipt.clone(),
                frontier: evidence.frontier.clone(),
                content: evidence.content.clone(),
                observed_at_epoch_ms: observed_at,
            }),
        }
    }

    async fn database_now(
        transaction: &mut Transaction<'_, Postgres>,
    ) -> Result<u64, OperatorAuthorizationError> {
        let observed: i64 = sqlx::query_scalar(
            "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;
        from_i64(observed)
    }

    async fn resolve_locked_grant_readback(
        transaction: &mut Transaction<'_, Postgres>,
        history: &VerifiedGrantHistoryV1,
        grant_identity: &str,
    ) -> Result<PortfolioResourceGrantReadbackV1, OperatorAuthorizationError> {
        let observed_at = database_now(transaction).await?;

        match resolve_verified_grant(
            history.issuance(grant_identity)?,
            history.current()?,
            observed_at,
            None,
        ) {
            PortfolioResourceGrantResolutionV1::Available { grant } => Ok(*grant),
            PortfolioResourceGrantResolutionV1::Unavailable { .. } => {
                Err(OperatorAuthorizationError::Unavailable)
            }
        }
    }

    async fn insert_grant_issuance(
        transaction: &mut Transaction<'_, Postgres>,
        stored: &StoredGrantIssuanceV1,
        receipt: &StoredGrantReceiptV1,
    ) -> Result<(), OperatorAuthorizationError> {
        let resource = &stored.proposal.content.resource;
        sqlx::query("INSERT INTO operator_authorization_private.portfolio_resource_grant_issuances_v1 (grant_identity,issuer_identity,principal,audience,permission,account_identity,execution_scope_identity,mode,resource_digest,semantic_digest,issuance_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
            .bind(&stored.proposal.grant_identity).bind(&stored.proposal.content.issuer_identity)
            .bind(&resource.principal).bind(&resource.audience).bind(&resource.permission)
            .bind(&resource.account_identity).bind(&resource.execution_scope_identity)
            .bind(mode_text(resource)).bind(resource.digest()?).bind(&stored.issuance_digest)
            .bind(json(stored)?).bind(json(receipt)?).bind(to_i64(stored.committed_at_epoch_ms)?)
            .execute(&mut **transaction).await.map_err(storage)?;
        Ok(())
    }

    async fn insert_grant_frontier(
        transaction: &mut Transaction<'_, Postgres>,
        frontier: &StoredGrantFrontierV1,
    ) -> Result<(), OperatorAuthorizationError> {
        sqlx::query("INSERT INTO operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 (frontier_identity,resource_digest,sequence,predecessor_frontier_identity,frontier_digest,frontier_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&frontier.frontier_identity).bind(&frontier.resource_digest).bind(to_i64(frontier.sequence)?)
            .bind(&frontier.predecessor_frontier_identity).bind(grant_frontier_digest(frontier)?)
            .bind(json(frontier)?).bind(to_i64(frontier.committed_at_epoch_ms)?)
            .execute(&mut **transaction).await.map_err(storage)?;
        Ok(())
    }

    pub(super) fn grant_advisory_lock_identity(resource_digest: &str) -> String {
        format!("{GRANT_ADVISORY_LOCK_NAMESPACE}:{resource_digest}")
    }

    pub(super) async fn lock_grant_resource_for_write(
        transaction: &mut Transaction<'_, Postgres>,
        resource_digest: &str,
    ) -> Result<(), OperatorAuthorizationError> {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(grant_advisory_lock_identity(resource_digest))
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
        Ok(())
    }

    async fn load_grant_resource_digest_hint(
        transaction: &mut Transaction<'_, Postgres>,
        grant_identity: &str,
    ) -> Result<Option<String>, OperatorAuthorizationError> {
        sqlx::query_scalar(
            "SELECT resource_digest FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE grant_identity=$1",
        )
            .bind(grant_identity)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(storage)
    }

    fn verify_grant_issuance_row(
        row: &sqlx::postgres::PgRow,
    ) -> Result<StoredGrantIssuanceV1, OperatorAuthorizationError> {
        verify_locked_grant_issuance_row(LockedGrantIssuanceRowV1 {
            grant_identity: row.try_get("grant_identity").map_err(storage)?,
            issuer_identity: row.try_get("issuer_identity").map_err(storage)?,
            principal: row.try_get("principal").map_err(storage)?,
            audience: row.try_get("audience").map_err(storage)?,
            permission: row.try_get("permission").map_err(storage)?,
            account_identity: row.try_get("account_identity").map_err(storage)?,
            execution_scope_identity: row.try_get("execution_scope_identity").map_err(storage)?,
            mode: row.try_get("mode").map_err(storage)?,
            resource_digest: row.try_get("resource_digest").map_err(storage)?,
            semantic_digest: row.try_get("semantic_digest").map_err(storage)?,
            issuance_json: row.try_get("issuance_json").map_err(storage)?,
            receipt_json: row.try_get("receipt_json").map_err(storage)?,
            committed_at_epoch_ms: row.try_get("committed_at_epoch_ms").map_err(storage)?,
        })
    }

    async fn verify_grant_history(
        transaction: &mut Transaction<'_, Postgres>,
        resource_digest: &str,
        lock: bool,
    ) -> Result<Option<VerifiedGrantHistoryV1>, OperatorAuthorizationError> {
        let issuance_sql = if lock {
            "SELECT grant_identity,issuer_identity,principal,audience,permission,account_identity,execution_scope_identity,mode,resource_digest,semantic_digest,issuance_json,receipt_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE resource_digest=$1 ORDER BY grant_identity FOR UPDATE"
        } else {
            "SELECT grant_identity,issuer_identity,principal,audience,permission,account_identity,execution_scope_identity,mode,resource_digest,semantic_digest,issuance_json,receipt_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE resource_digest=$1 ORDER BY grant_identity"
        };
        let issuance_rows = sqlx::query(issuance_sql)
            .bind(resource_digest)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;

        if issuance_rows.is_empty() {
            return Ok(None);
        }
        let issuances = order_grant_issuances(
            issuance_rows
                .into_iter()
                .map(|row| verify_grant_issuance_row(&row))
                .collect::<Result<Vec<_>, _>>()?,
        )?;
        let frontier_sql = if lock {
            "SELECT frontier_identity,resource_digest,sequence,predecessor_frontier_identity,frontier_digest,frontier_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 WHERE resource_digest=$1 ORDER BY sequence,frontier_identity FOR UPDATE"
        } else {
            "SELECT frontier_identity,resource_digest,sequence,predecessor_frontier_identity,frontier_digest,frontier_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 WHERE resource_digest=$1 ORDER BY sequence,frontier_identity"
        };
        let frontier_rows = sqlx::query(frontier_sql)
            .bind(resource_digest)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;
        let mut frontiers = Vec::new();
        for row in frontier_rows {
            frontiers.push(verify_locked_grant_frontier_row(
                LockedGrantFrontierRowV1 {
                    frontier_identity: row.try_get("frontier_identity").map_err(storage)?,
                    resource_digest: row.try_get("resource_digest").map_err(storage)?,
                    sequence: row.try_get("sequence").map_err(storage)?,
                    predecessor_frontier_identity: row
                        .try_get("predecessor_frontier_identity")
                        .map_err(storage)?,
                    frontier_digest: row.try_get("frontier_digest").map_err(storage)?,
                    frontier_json: row.try_get("frontier_json").map_err(storage)?,
                    committed_at_epoch_ms: row.try_get("committed_at_epoch_ms").map_err(storage)?,
                },
            )?);
        }
        verify_grant_frontier_chain(&issuances[0], &frontiers)?;
        let head_sql = if lock {
            "SELECT resource_digest,frontier_identity,sequence,frontier_digest,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 WHERE resource_digest=$1 FOR UPDATE"
        } else {
            "SELECT resource_digest,frontier_identity,sequence,frontier_digest,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 WHERE resource_digest=$1"
        };
        let head = sqlx::query(head_sql)
            .bind(resource_digest)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
        let current = frontiers
            .last()
            .ok_or(OperatorAuthorizationError::Unavailable)?;

        if head
            .try_get::<String, _>("resource_digest")
            .map_err(storage)?
            != resource_digest
            || head
                .try_get::<String, _>("frontier_identity")
                .map_err(storage)?
                != current.frontier_identity
            || head.try_get::<i64, _>("sequence").map_err(storage)? != to_i64(current.sequence)?
            || head
                .try_get::<String, _>("frontier_digest")
                .map_err(storage)?
                != grant_frontier_digest(current)?
            || from_i64(head.try_get("committed_at_epoch_ms").map_err(storage)?)?
                != current.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        verify_grant_outboxes(transaction, &issuances, &frontiers, lock).await?;
        Ok(Some(VerifiedGrantHistoryV1 {
            issuances,
            frontiers,
        }))
    }

    pub fn parse_untrusted_portfolio_resource_grant_envelope_v1(
        bytes: &[u8],
        locator: &PortfolioResourceGrantLocatorV1,
    ) -> Result<UntrustedCanonicalPortfolioResourceGrantEvidenceV1, OperatorAuthorizationError>
    {
        let envelope: LockedGrantEnvelopeV1 =
            serde_json::from_slice(bytes).map_err(|_| OperatorAuthorizationError::Unavailable)?;
        from_i64(envelope.observed_at_epoch_ms)?;
        if envelope
            .issuances
            .windows(2)
            .any(|pair| pair[0].grant_identity >= pair[1].grant_identity)
            || envelope.frontiers.windows(2).any(|pair| {
                (pair[0].sequence, &pair[0].frontier_identity)
                    >= (pair[1].sequence, &pair[1].frontier_identity)
            })
            || envelope
                .outboxes
                .windows(2)
                .any(|pair| pair[0].event_identity >= pair[1].event_identity)
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let issuances = order_grant_issuances(
            envelope
                .issuances
                .into_iter()
                .map(verify_locked_grant_issuance_row)
                .collect::<Result<Vec<_>, _>>()?,
        )?;
        let issuance = issuances
            .iter()
            .find(|item| item.proposal.grant_identity == locator.grant_identity)
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        if grant_receipt(issuance).receipt_identity != locator.issuance_receipt_identity {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let frontiers = envelope
            .frontiers
            .into_iter()
            .map(verify_locked_grant_frontier_row)
            .collect::<Result<Vec<_>, _>>()?;
        verify_grant_frontier_chain(&issuances[0], &frontiers)?;
        let current = frontiers
            .last()
            .ok_or(OperatorAuthorizationError::Unavailable)?;

        if envelope.head.resource_digest != current.resource_digest
            || envelope.head.frontier_identity != current.frontier_identity
            || envelope.head.sequence != to_i64(current.sequence)?
            || envelope.head.frontier_digest != grant_frontier_digest(current)?
            || from_i64(envelope.head.committed_at_epoch_ms)? != current.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        verify_locked_grant_outboxes(&issuances, &frontiers, &envelope.outboxes)?;
        Ok(UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {
            schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
            issuance_receipt: grant_receipt(issuance).into(),
            frontier: current.public(),
            content: issuance.proposal.content.clone(),
        })
    }

    fn verify_locked_grant_issuance_row(
        row: LockedGrantIssuanceRowV1,
    ) -> Result<StoredGrantIssuanceV1, OperatorAuthorizationError> {
        let stored: StoredGrantIssuanceV1 = from_json(row.issuance_json)?;
        stored
            .proposal
            .validate()
            .map_err(|_| OperatorAuthorizationError::Unavailable)?;
        let receipt: StoredGrantReceiptV1 = from_json(row.receipt_json)?;
        let resource = &stored.proposal.content.resource;
        let expected_digest = stored_grant_digest(&stored)?;
        if stored.schema_version != PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1
            || row.grant_identity != stored.proposal.grant_identity
            || row.issuer_identity != stored.proposal.content.issuer_identity
            || row.principal != resource.principal
            || row.audience != resource.audience
            || row.permission != resource.permission
            || row.account_identity != resource.account_identity
            || row.execution_scope_identity != resource.execution_scope_identity
            || row.mode != mode_text(resource)
            || row.resource_digest != resource.digest()?
            || row.semantic_digest != expected_digest
            || stored.issuance_digest != expected_digest
            || receipt != grant_receipt(&stored)
            || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        Ok(stored)
    }

    fn verify_locked_grant_frontier_row(
        row: LockedGrantFrontierRowV1,
    ) -> Result<StoredGrantFrontierV1, OperatorAuthorizationError> {
        let frontier: StoredGrantFrontierV1 = from_json(row.frontier_json)?;
        if frontier.schema_version != PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1
            || row.frontier_identity != frontier.frontier_identity
            || row.resource_digest != frontier.resource_digest
            || row.sequence != to_i64(frontier.sequence)?
            || row.predecessor_frontier_identity != frontier.predecessor_frontier_identity
            || row.frontier_digest != grant_frontier_digest(&frontier)?
            || from_i64(row.committed_at_epoch_ms)? != frontier.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        Ok(frontier)
    }

    fn order_grant_issuances(
        mut remaining: Vec<StoredGrantIssuanceV1>,
    ) -> Result<Vec<StoredGrantIssuanceV1>, OperatorAuthorizationError> {
        if remaining
            .iter()
            .filter(|item| item.predecessor.is_none())
            .count()
            != 1
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let genesis_index = remaining
            .iter()
            .position(|item| item.predecessor.is_none())
            .ok_or(OperatorAuthorizationError::Unavailable)?;
        let genesis = remaining.remove(genesis_index);
        if genesis.proposal.expected_revocation_frontier_identity != "EMPTY"
            || stored_grant_digest(&genesis)? != genesis.issuance_digest
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        let resource = genesis.proposal.content.resource.clone();
        let issuer = genesis.proposal.content.issuer_identity.clone();
        let key = genesis.proposal.content.issuer_key_version.clone();
        let mut ordered = vec![genesis];
        while !remaining.is_empty() {
            let predecessor = ordered
                .last()
                .ok_or(OperatorAuthorizationError::Unavailable)?;
            let locator = PortfolioResourceGrantLocatorV1 {
                grant_identity: predecessor.proposal.grant_identity.clone(),
                issuance_receipt_identity: grant_receipt(predecessor).receipt_identity,
            };
            let matches = remaining
                .iter()
                .enumerate()
                .filter(|(_, item)| item.predecessor.as_ref() == Some(&locator))
                .map(|(index, _)| index)
                .collect::<Vec<_>>();

            if matches.len() != 1 {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            let successor = remaining.remove(matches[0]);
            if successor.proposal.content.resource != resource
                || successor.proposal.content.issuer_identity != issuer
                || successor.proposal.content.issuer_key_version != key
                || successor.proposal.content.effective_at_epoch_ms
                    < predecessor.proposal.content.effective_at_epoch_ms
                || successor.proposal.content.valid_through_epoch_ms
                    <= predecessor.proposal.content.valid_through_epoch_ms
                || successor.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
                || stored_grant_digest(&successor)? != successor.issuance_digest
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            ordered.push(successor);
        }
        Ok(ordered)
    }

    fn verify_grant_frontier_chain(
        genesis: &StoredGrantIssuanceV1,
        frontiers: &[StoredGrantFrontierV1],
    ) -> Result<(), OperatorAuthorizationError> {
        if frontiers.first() != Some(&grant_genesis_frontier(genesis)?) {
            return Err(OperatorAuthorizationError::Unavailable);
        }

        for (index, frontier) in frontiers.iter().enumerate() {
            if frontier.sequence != u64::try_from(index).map_err(storage)?
                || frontier
                    .revocations
                    .windows(2)
                    .any(|pair| pair[0].grant_identity >= pair[1].grant_identity)
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
        }

        for pair in frontiers.windows(2) {
            let previous = &pair[0];
            let next = &pair[1];
            let added = next
                .revocations
                .iter()
                .filter(|entry| !previous.revocations.contains(entry))
                .count();

            if next.predecessor_frontier_identity.as_deref() != Some(&previous.frontier_identity)
                || next.sequence != previous.sequence.saturating_add(1)
                || next.committed_at_epoch_ms < previous.committed_at_epoch_ms
                || next.revocations.len() != previous.revocations.len().saturating_add(1)
                || previous
                    .revocations
                    .iter()
                    .any(|entry| !next.revocations.contains(entry))
                || added != 1
            {
                return Err(OperatorAuthorizationError::Unavailable);
            }
        }
        Ok(())
    }

    fn grant_outbox_record<T: Serialize>(
        seed: &str,
        aggregate: &str,
        kind: &str,
        payload: &T,
        committed_at: u64,
    ) -> Result<StoredGrantOutboxV1, OperatorAuthorizationError> {
        let payload_digest = canonical_digest(
            "operator-authorization.portfolio-resource-grant-outbox-payload.v1",
            payload,
        )?;
        Ok(StoredGrantOutboxV1 {
            schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
            event_identity: identity(
                "operator-authorization-portfolio-resource-grant-owner-event-v1",
                &[
                    seed,
                    aggregate,
                    kind,
                    &payload_digest,
                    &committed_at.to_string(),
                ],
            ),
            aggregate_identity: aggregate.to_string(),
            event_kind: kind.to_string(),
            payload_digest,
            committed_at_epoch_ms: committed_at,
        })
    }

    async fn insert_grant_outbox<T: Serialize>(
        transaction: &mut Transaction<'_, Postgres>,
        seed: &str,
        aggregate: &str,
        kind: &str,
        payload: &T,
        committed_at: u64,
    ) -> Result<(), OperatorAuthorizationError> {
        let record = grant_outbox_record(seed, aggregate, kind, payload, committed_at)?;
        sqlx::query("INSERT INTO operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&record.event_identity).bind(&record.aggregate_identity).bind(&record.event_kind)
            .bind(&record.payload_digest).bind(json(&record)?).bind(to_i64(committed_at)?)
            .execute(&mut **transaction).await.map_err(storage)?;
        Ok(())
    }

    fn verify_grant_outbox_row<T: Serialize>(
        row: &LockedGrantOutboxRowV1,
        seed: &str,
        aggregate: &str,
        kind: &str,
        payload: &T,
        committed_at: u64,
    ) -> Result<(), OperatorAuthorizationError> {
        let expected = grant_outbox_record(seed, aggregate, kind, payload, committed_at)?;
        let stored: StoredGrantOutboxV1 = from_json(row.payload_json.clone())?;
        if stored != expected
            || row.event_identity != expected.event_identity
            || row.aggregate_identity != expected.aggregate_identity
            || row.event_kind != expected.event_kind
            || row.payload_digest != expected.payload_digest
            || from_i64(row.committed_at_epoch_ms)? != expected.committed_at_epoch_ms
        {
            return Err(OperatorAuthorizationError::Unavailable);
        }
        Ok(())
    }

    async fn verify_grant_outboxes(
        transaction: &mut Transaction<'_, Postgres>,
        issuances: &[StoredGrantIssuanceV1],
        frontiers: &[StoredGrantFrontierV1],
        lock: bool,
    ) -> Result<(), OperatorAuthorizationError> {
        for issuance in issuances {
            let receipt = grant_receipt(issuance);
            let rows = load_grant_outbox_rows(transaction, &issuance.proposal.grant_identity, lock)
                .await?;

            if rows.len() != 1 {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            verify_grant_outbox_row(
                &rows[0],
                &receipt.receipt_identity,
                &issuance.proposal.grant_identity,
                GRANT_ISSUED_EVENT,
                &receipt,
                issuance.committed_at_epoch_ms,
            )?;
        }

        for frontier in frontiers {
            let rows =
                load_grant_outbox_rows(transaction, &frontier.frontier_identity, lock).await?;

            if rows.len() != 1 {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            verify_grant_outbox_row(
                &rows[0],
                &frontier.frontier_identity,
                &frontier.frontier_identity,
                GRANT_FRONTIER_EVENT,
                frontier,
                frontier.committed_at_epoch_ms,
            )?;
        }
        Ok(())
    }

    fn verify_locked_grant_outboxes(
        issuances: &[StoredGrantIssuanceV1],
        frontiers: &[StoredGrantFrontierV1],
        rows: &[LockedGrantOutboxRowV1],
    ) -> Result<(), OperatorAuthorizationError> {
        if rows.len() != issuances.len().saturating_add(frontiers.len()) {
            return Err(OperatorAuthorizationError::Unavailable);
        }

        for issuance in issuances {
            let receipt = grant_receipt(issuance);
            let matches = rows
                .iter()
                .filter(|row| row.aggregate_identity == issuance.proposal.grant_identity)
                .collect::<Vec<_>>();

            if matches.len() != 1 {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            verify_grant_outbox_row(
                matches[0],
                &receipt.receipt_identity,
                &issuance.proposal.grant_identity,
                GRANT_ISSUED_EVENT,
                &receipt,
                issuance.committed_at_epoch_ms,
            )?;
        }

        for frontier in frontiers {
            let matches = rows
                .iter()
                .filter(|row| row.aggregate_identity == frontier.frontier_identity)
                .collect::<Vec<_>>();

            if matches.len() != 1 {
                return Err(OperatorAuthorizationError::Unavailable);
            }
            verify_grant_outbox_row(
                matches[0],
                &frontier.frontier_identity,
                &frontier.frontier_identity,
                GRANT_FRONTIER_EVENT,
                frontier,
                frontier.committed_at_epoch_ms,
            )?;
        }
        Ok(())
    }

    async fn load_grant_outbox_rows(
        transaction: &mut Transaction<'_, Postgres>,
        aggregate_identity: &str,
        lock: bool,
    ) -> Result<Vec<LockedGrantOutboxRowV1>, OperatorAuthorizationError> {
        let sql = if lock {
            "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 WHERE aggregate_identity=$1 FOR SHARE"
        } else {
            "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 WHERE aggregate_identity=$1"
        };
        sqlx::query(sql)
            .bind(aggregate_identity)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?
            .into_iter()
            .map(|row| {
                Ok(LockedGrantOutboxRowV1 {
                    event_identity: row.try_get("event_identity").map_err(storage)?,
                    aggregate_identity: row.try_get("aggregate_identity").map_err(storage)?,
                    event_kind: row.try_get("event_kind").map_err(storage)?,
                    payload_digest: row.try_get("payload_digest").map_err(storage)?,
                    payload_json: row.try_get("payload_json").map_err(storage)?,
                    committed_at_epoch_ms: row.try_get("committed_at_epoch_ms").map_err(storage)?,
                })
            })
            .collect()
    }

    fn mode_text(resource: &PortfolioResourceV1) -> &'static str {
        match resource.mode {
            crate::PortfolioResourceModeV1::Paper => "PAPER",
            crate::PortfolioResourceModeV1::Live => "LIVE",
        }
    }

    #[cfg(test)]
    mod parser_tests {
        use rstest::rstest;

        use super::*;

        fn issuance_row(stored: &StoredGrantIssuanceV1) -> LockedGrantIssuanceRowV1 {
            let resource = &stored.proposal.content.resource;
            LockedGrantIssuanceRowV1 {
                grant_identity: stored.proposal.grant_identity.clone(),
                issuer_identity: stored.proposal.content.issuer_identity.clone(),
                principal: resource.principal.clone(),
                audience: resource.audience.clone(),
                permission: resource.permission.clone(),
                account_identity: resource.account_identity.clone(),
                execution_scope_identity: resource.execution_scope_identity.clone(),
                mode: mode_text(resource).into(),
                resource_digest: resource.digest().unwrap(),
                semantic_digest: stored_grant_digest(stored).unwrap(),
                issuance_json: serde_json::to_value(stored).unwrap(),
                receipt_json: serde_json::to_value(grant_receipt(stored)).unwrap(),
                committed_at_epoch_ms: to_i64(stored.committed_at_epoch_ms).unwrap(),
            }
        }

        fn frontier_row(frontier: &StoredGrantFrontierV1) -> LockedGrantFrontierRowV1 {
            LockedGrantFrontierRowV1 {
                frontier_identity: frontier.frontier_identity.clone(),
                resource_digest: frontier.resource_digest.clone(),
                sequence: to_i64(frontier.sequence).unwrap(),
                predecessor_frontier_identity: frontier.predecessor_frontier_identity.clone(),
                frontier_digest: grant_frontier_digest(frontier).unwrap(),
                frontier_json: serde_json::to_value(frontier).unwrap(),
                committed_at_epoch_ms: to_i64(frontier.committed_at_epoch_ms).unwrap(),
            }
        }

        fn outbox_row(
            seed: &str,
            aggregate: &str,
            kind: &str,
            payload: &impl Serialize,
            committed_at: u64,
        ) -> LockedGrantOutboxRowV1 {
            let record = grant_outbox_record(seed, aggregate, kind, payload, committed_at).unwrap();
            LockedGrantOutboxRowV1 {
                event_identity: record.event_identity.clone(),
                aggregate_identity: record.aggregate_identity.clone(),
                event_kind: record.event_kind.clone(),
                payload_digest: record.payload_digest.clone(),
                payload_json: serde_json::to_value(record).unwrap(),
                committed_at_epoch_ms: to_i64(committed_at).unwrap(),
            }
        }

        fn canonical_envelope() -> (
            serde_json::Value,
            PortfolioResourceGrantLocatorV1,
            PortfolioResourceGrantLocatorV1,
            PortfolioResourceGrantContentV1,
            String,
        ) {
            let content = PortfolioResourceGrantContentV1 {
                issuer_identity: "issuer-v1".into(),
                issuer_key_version: "key-v1".into(),
                resource: PortfolioResourceV1 {
                    principal: "principal-v1".into(),
                    audience: crate::PORTFOLIO_OWNER_AUDIENCE_V1.into(),
                    permission: crate::PORTFOLIO_VIEW_PERMISSION_V1.into(),
                    account_identity: "account-v1".into(),
                    execution_scope_identity: "execution-scope-v1".into(),
                    mode: crate::PortfolioResourceModeV1::Paper,
                },
                product_edge_manifest: ProductEdgeManifestBindingV1 {
                    manifest_locator: "manifest-v1".into(),
                    manifest_digest: format!("sha256:{}", "a".repeat(64)),
                },
                effective_at_epoch_ms: 10,
                valid_through_epoch_ms: 1_000,
            };
            let genesis_proposal = PortfolioResourceGrantIssuanceProposalV1 {
                grant_identity: content.grant_identity().unwrap(),
                content: content.clone(),
                expected_revocation_frontier_identity: "EMPTY".into(),
            };
            let genesis = StoredGrantIssuanceV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                issuance_digest: genesis_proposal.semantic_digest().unwrap(),
                proposal: genesis_proposal,
                predecessor: None,
                committed_at_epoch_ms: 100,
            };
            let genesis_locator = PortfolioResourceGrantLocatorV1 {
                grant_identity: genesis.proposal.grant_identity.clone(),
                issuance_receipt_identity: grant_receipt(&genesis).receipt_identity,
            };
            let genesis_frontier = grant_genesis_frontier(&genesis).unwrap();

            let mut successor_content = content;
            successor_content.valid_through_epoch_ms = 2_000;
            successor_content.product_edge_manifest.manifest_locator = "manifest-v2".into();
            successor_content.product_edge_manifest.manifest_digest =
                format!("sha256:{}", "b".repeat(64));
            let successor_proposal = PortfolioResourceGrantIssuanceProposalV1 {
                grant_identity: successor_content.grant_identity().unwrap(),
                content: successor_content.clone(),
                expected_revocation_frontier_identity: genesis_frontier.frontier_identity.clone(),
            };
            let mut successor = StoredGrantIssuanceV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                proposal: successor_proposal,
                predecessor: Some(genesis_locator.clone()),
                issuance_digest: String::new(),
                committed_at_epoch_ms: 110,
            };
            successor.issuance_digest = stored_grant_digest(&successor).unwrap();
            let successor_locator = PortfolioResourceGrantLocatorV1 {
                grant_identity: successor.proposal.grant_identity.clone(),
                issuance_receipt_identity: grant_receipt(&successor).receipt_identity,
            };

            let revocations = vec![StoredGrantRevocationV1 {
                grant_identity: genesis_locator.grant_identity.clone(),
                reason_code: "ADMIN_REVOKED".into(),
            }];
            let current_frontier = StoredGrantFrontierV1 {
                schema_version: PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1,
                frontier_identity: identity(
                    "operator-authorization-portfolio-resource-grant-frontier-v1",
                    &[
                        &genesis_frontier.resource_digest,
                        &genesis_frontier.frontier_identity,
                        &canonical_digest(
                            "operator-authorization.portfolio-resource-grant-revocations.v1",
                            &revocations,
                        )
                        .unwrap(),
                        "120",
                    ],
                ),
                resource_digest: genesis_frontier.resource_digest.clone(),
                sequence: 1,
                predecessor_frontier_identity: Some(genesis_frontier.frontier_identity.clone()),
                revocations,
                committed_at_epoch_ms: 120,
            };

            let mut issuances = vec![issuance_row(&genesis), issuance_row(&successor)];
            issuances.sort_by(|left, right| left.grant_identity.cmp(&right.grant_identity));
            let frontiers = vec![
                frontier_row(&genesis_frontier),
                frontier_row(&current_frontier),
            ];
            let mut outboxes = vec![
                outbox_row(
                    &genesis_locator.issuance_receipt_identity,
                    &genesis_locator.grant_identity,
                    GRANT_ISSUED_EVENT,
                    &grant_receipt(&genesis),
                    genesis.committed_at_epoch_ms,
                ),
                outbox_row(
                    &successor_locator.issuance_receipt_identity,
                    &successor_locator.grant_identity,
                    GRANT_ISSUED_EVENT,
                    &grant_receipt(&successor),
                    successor.committed_at_epoch_ms,
                ),
                outbox_row(
                    &genesis_frontier.frontier_identity,
                    &genesis_frontier.frontier_identity,
                    GRANT_FRONTIER_EVENT,
                    &genesis_frontier,
                    genesis_frontier.committed_at_epoch_ms,
                ),
                outbox_row(
                    &current_frontier.frontier_identity,
                    &current_frontier.frontier_identity,
                    GRANT_FRONTIER_EVENT,
                    &current_frontier,
                    current_frontier.committed_at_epoch_ms,
                ),
            ];
            outboxes.sort_by(|left, right| left.event_identity.cmp(&right.event_identity));
            let current_frontier_identity = current_frontier.frontier_identity.clone();
            let envelope = LockedGrantEnvelopeV1 {
                issuances,
                head: LockedGrantHeadRowV1 {
                    resource_digest: current_frontier.resource_digest.clone(),
                    frontier_identity: current_frontier.frontier_identity.clone(),
                    sequence: to_i64(current_frontier.sequence).unwrap(),
                    frontier_digest: grant_frontier_digest(&current_frontier).unwrap(),
                    committed_at_epoch_ms: to_i64(current_frontier.committed_at_epoch_ms).unwrap(),
                },
                frontiers,
                outboxes,
                observed_at_epoch_ms: 130,
            };
            (
                serde_json::to_value(envelope).unwrap(),
                genesis_locator,
                successor_locator,
                successor_content,
                current_frontier_identity,
            )
        }

        fn parse(
            value: &serde_json::Value,
            locator: &PortfolioResourceGrantLocatorV1,
        ) -> Result<UntrustedCanonicalPortfolioResourceGrantEvidenceV1, OperatorAuthorizationError>
        {
            parse_untrusted_portfolio_resource_grant_envelope_v1(
                &serde_json::to_vec(value).unwrap(),
                locator,
            )
        }

        #[rstest]
        fn parser_returns_non_authoritative_evidence_for_a_later_cut() {
            let (envelope, genesis, successor, content, frontier_identity) = canonical_envelope();
            let evidence = parse(&envelope, &successor).unwrap();
            assert_eq!(evidence.locator(), successor);
            assert_eq!(evidence.frontier_identity(), frontier_identity);
            assert!(evidence.matches_resource(&content.resource));
            assert!(evidence.matches_product_edge_manifest(&content.product_edge_manifest));
            assert!(evidence.is_current_at(130));
            assert!(!evidence.is_current_at(content.valid_through_epoch_ms));

            let revoked = parse(&envelope, &genesis).unwrap();
            assert!(!revoked.is_current_at(130));
            assert!(parse(&serde_json::to_value(&evidence).unwrap(), &successor).is_err());
        }

        #[rstest]
        fn parser_binds_every_grant_coordinate_and_complete_locked_history() {
            let (envelope, _, successor, _, _) = canonical_envelope();
            let selected_index = envelope["issuances"]
                .as_array()
                .unwrap()
                .iter()
                .position(|row| row["grant_identity"] == successor.grant_identity)
                .unwrap();
            let current_frontier_index = envelope["frontiers"].as_array().unwrap().len() - 1;
            let paths = [
                format!("/issuances/{selected_index}/grant_identity"),
                format!("/issuances/{selected_index}/issuer_identity"),
                format!("/issuances/{selected_index}/principal"),
                format!("/issuances/{selected_index}/audience"),
                format!("/issuances/{selected_index}/permission"),
                format!("/issuances/{selected_index}/account_identity"),
                format!("/issuances/{selected_index}/execution_scope_identity"),
                format!("/issuances/{selected_index}/mode"),
                format!("/issuances/{selected_index}/resource_digest"),
                format!("/issuances/{selected_index}/semantic_digest"),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/issuer_identity"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/issuer_key_version"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/resource/principal"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/resource/audience"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/resource/permission"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/resource/account_identity"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/resource/execution_scope_identity"
                ),
                format!("/issuances/{selected_index}/issuance_json/proposal/content/resource/mode"),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/product_edge_manifest/manifest_locator"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/product_edge_manifest/manifest_digest"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/effective_at_epoch_ms"
                ),
                format!(
                    "/issuances/{selected_index}/issuance_json/proposal/content/valid_through_epoch_ms"
                ),
                format!("/issuances/{selected_index}/receipt_json/receipt_identity"),
                format!("/issuances/{selected_index}/committed_at_epoch_ms"),
                format!("/frontiers/{current_frontier_index}/frontier_identity"),
                format!("/frontiers/{current_frontier_index}/resource_digest"),
                format!("/frontiers/{current_frontier_index}/frontier_digest"),
                format!(
                    "/frontiers/{current_frontier_index}/frontier_json/revocations/0/reason_code"
                ),
                "/head/frontier_identity".into(),
                "/head/frontier_digest".into(),
                "/outboxes/0/payload_digest".into(),
                "/outboxes/0/payload_json/event_kind".into(),
            ];

            for path in paths {
                let mut changed = envelope.clone();
                let target = changed.pointer_mut(&path).unwrap();
                *target = match target {
                    serde_json::Value::String(_) => serde_json::json!("tampered"),
                    serde_json::Value::Number(number) => {
                        serde_json::json!(number.as_i64().unwrap() + 1)
                    }
                    _ => unreachable!("mutation path must name a scalar"),
                };
                assert!(parse(&changed, &successor).is_err(), "accepted {path}");
            }

            for key in ["issuances", "frontiers", "outboxes"] {
                let mut reordered = envelope.clone();
                reordered[key].as_array_mut().unwrap().reverse();
                assert!(
                    parse(&reordered, &successor).is_err(),
                    "accepted {key} reorder"
                );

                let mut duplicated = envelope.clone();
                let duplicate = duplicated[key].as_array().unwrap()[0].clone();
                duplicated[key].as_array_mut().unwrap().push(duplicate);
                assert!(
                    parse(&duplicated, &successor).is_err(),
                    "accepted duplicate {key}"
                );
            }

            let mut invalid_observation = envelope;
            invalid_observation["observed_at_epoch_ms"] = serde_json::json!(-1);
            assert!(parse(&invalid_observation, &successor).is_err());
            assert!(
                parse_untrusted_portfolio_resource_grant_envelope_v1(b"{}", &successor).is_err()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::portfolio_resource_grant::{
        grant_advisory_lock_identity, lock_grant_resource_for_write,
    };
    use super::*;
    use crate::{
        OperationManifestBindingV1, OperatorAuthorizationScopeV1, PORTFOLIO_OWNER_AUDIENCE_V1,
        PORTFOLIO_VIEW_PERMISSION_V1, PortfolioResourceGrantContentV1,
        PortfolioResourceGrantIssuanceProposalV1, PortfolioResourceGrantLocatorV1,
        PortfolioResourceGrantReadRequestV1, PortfolioResourceGrantReadbackV1,
        PortfolioResourceGrantResolutionV1, PortfolioResourceGrantRevocationProposalV1,
        PortfolioResourceGrantSuccessorProposalV1, PortfolioResourceGrantUnavailableReasonV1,
        PortfolioResourceModeV1, PortfolioResourceV1, ProductEdgeManifestBindingV1,
        UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
    };
    use rstest::rstest;
    use vibe_testkit::postgres::{
        CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1,
        DedicatedPostgresTestDatabase,
    };

    #[rstest]
    fn expired_manifest_recovery_schema_preparation_is_exactly_bounded() {
        assert_eq!(EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS.len(), 4);
        assert!(EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS.iter().all(|statement| {
            statement.contains(
                "operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1",
            )
        }));
        assert_eq!(
            EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS
                .map(|statement| { statement.split_ascii_whitespace().next().unwrap() }),
            ["CREATE", "ALTER", "REVOKE", "GRANT"]
        );
        assert_eq!(
            EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS[1],
            "ALTER TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 OWNER TO operator_authorization_owner"
        );
        assert!(
            !EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS
                .iter()
                .any(|statement| statement.starts_with("UPDATE "))
        );
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.starts_with("SELECT "));
        assert!(
            VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA
                .contains("namespace.nspname = 'operator_authorization_private'")
        );
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(
            "relation.relname = 'operator_authorization_expired_manifest_recoveries_v1'"
        ));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.pg_attribute"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.count(*) = 6"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.pg_constraint"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(
            "FOREIGN KEY (successor_authorization_identity) REFERENCES operator_authorization_private.operator_authorization_issuances_v1(authorization_identity)"
        ));
        assert!(!VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(" UPDATE "));
        assert!(!VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(" ALTER "));
    }

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

    fn portfolio_grant_proposal(
        suffix: &str,
        now: u64,
        account_suffix: &str,
        valid_for_ms: u64,
    ) -> PortfolioResourceGrantIssuanceProposalV1 {
        let content = PortfolioResourceGrantContentV1 {
            issuer_identity: "operator-authorization-owner-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            resource: PortfolioResourceV1 {
                principal: format!("principal-{suffix}"),
                audience: PORTFOLIO_OWNER_AUDIENCE_V1.into(),
                permission: PORTFOLIO_VIEW_PERMISSION_V1.into(),
                account_identity: format!("account-{account_suffix}-{suffix}"),
                execution_scope_identity: format!("execution-scope-{suffix}"),
                mode: PortfolioResourceModeV1::Paper,
            },
            product_edge_manifest: ProductEdgeManifestBindingV1 {
                manifest_locator: format!("product-edge-manifest-{suffix}"),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            },
            effective_at_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(valid_for_ms),
        };
        PortfolioResourceGrantIssuanceProposalV1 {
            grant_identity: content.grant_identity().unwrap(),
            content,
            expected_revocation_frontier_identity: "EMPTY".into(),
        }
    }

    async fn oa_table_fingerprint(pool: &PgPool) -> String {
        let value: serde_json::Value = sqlx::query_scalar(
            "SELECT jsonb_build_object(
              'authorization_issuances', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.authorization_identity) FROM operator_authorization_private.operator_authorization_issuances_v1 row), '[]'::jsonb),
              'authorization_frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.frontier_identity) FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 row), '[]'::jsonb),
              'authorization_heads', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scope_digest) FROM operator_authorization_private.operator_authorization_revocation_heads_v1 row), '[]'::jsonb),
              'resource_issuances', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.grant_identity) FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 row), '[]'::jsonb),
              'resource_frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.frontier_identity) FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 row), '[]'::jsonb),
              'resource_heads', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.resource_digest) FROM operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 row), '[]'::jsonb),
              'authorization_outbox', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_identity) FROM operator_authorization_private.operator_authorization_owner_outbox_v1 row), '[]'::jsonb),
              'resource_outbox', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_identity) FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 row), '[]'::jsonb)
            )",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        canonical_digest("operator-authorization.test-table-fingerprint.v1", &value).unwrap()
    }

    fn assert_same_grant_authority(
        left: &PortfolioResourceGrantReadbackV1,
        right: &PortfolioResourceGrantReadbackV1,
    ) {
        assert_eq!(left.locator(), right.locator());
        assert_eq!(left.content(), right.content());
        assert_eq!(left.frontier(), right.frontier());
    }

    async fn resolve_grant(
        pool: &PgPool,
        request: &PortfolioResourceGrantReadRequestV1,
    ) -> PortfolioResourceGrantResolutionV1 {
        let mut transaction = pool.begin().await.unwrap();
        let resolution =
            resolve_portfolio_resource_grant_in_transaction(&mut transaction, request).await;
        transaction.rollback().await.unwrap();
        resolution
    }

    async fn wait_for_advisory_lock(pool: &PgPool, role: &str) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND wait_event='advisory'",
                )
                .bind(role)
                .fetch_one(pool)
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
    }

    async fn parse_locked_grant_evidence(
        pool: &PgPool,
        locator: &PortfolioResourceGrantLocatorV1,
    ) -> Result<UntrustedCanonicalPortfolioResourceGrantEvidenceV1, OperatorAuthorizationError>
    {
        let mut transaction = pool.begin().await.unwrap();
        let envelope: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT operator_authorization_api.lock_current_portfolio_resource_grant_v1($1,$2)",
        )
        .bind(&locator.grant_identity)
        .bind(&locator.issuance_receipt_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let result = parse_untrusted_portfolio_resource_grant_envelope_v1(
            &serde_json::to_vec(&envelope.ok_or(OperatorAuthorizationError::Unavailable)?)
                .map_err(storage)?,
            locator,
        );
        transaction.rollback().await.unwrap();
        result
    }

    #[tokio::test]
    #[ignore = "requires admitted OA and Product Edge PostgreSQL test URLs"]
    async fn portfolio_resource_grant_advisory_lock_serializes_distinct_grants() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let owner = Arc::new(
            OperatorAuthorizationIssuerPostgresV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            )
            .await
            .unwrap(),
        );
        let consumer = mutation
            .pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
            .clone();
        let suffix = format!("advisory-{}-{}", std::process::id(), now_ms().unwrap());
        let now = now_ms().unwrap();
        let proposal = portfolio_grant_proposal(&suffix, now, "serialization", 600_000);
        let resource_digest = proposal.content.resource.digest().unwrap();
        let rust_lock_identity = grant_advisory_lock_identity(&resource_digest);
        let mut genesis_gate = consumer.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))")
            .bind(&rust_lock_identity)
            .execute(&mut *genesis_gate)
            .await
            .unwrap();
        let genesis_owner = Arc::clone(&owner);
        let genesis_proposal = proposal.clone();

        let genesis_task = tokio::spawn(async move {
            genesis_owner
                .issue_portfolio_resource_grant_genesis(genesis_proposal)
                .await
        });
        wait_for_advisory_lock(owner.pool(), "operator_authorization_writer").await;
        assert!(!genesis_task.is_finished());
        genesis_gate.rollback().await.unwrap();
        let genesis = genesis_task.await.unwrap().unwrap();
        let mut successor_content = proposal.content.clone();
        successor_content.valid_through_epoch_ms += 600_000;
        successor_content
            .product_edge_manifest
            .manifest_locator
            .push_str("-successor");
        successor_content.product_edge_manifest.manifest_digest =
            format!("sha256:{}", "b".repeat(64));
        let successor_proposal = PortfolioResourceGrantSuccessorProposalV1 {
            predecessor: genesis.locator(),
            expected_current_frontier_identity: genesis.frontier().frontier_identity().into(),
            successor: PortfolioResourceGrantIssuanceProposalV1 {
                grant_identity: successor_content.grant_identity().unwrap(),
                content: successor_content.clone(),
                expected_revocation_frontier_identity: genesis
                    .frontier()
                    .frontier_identity()
                    .into(),
            },
        };
        let mut successor_gate = consumer.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))")
            .bind(&rust_lock_identity)
            .execute(&mut *successor_gate)
            .await
            .unwrap();
        let successor_owner = Arc::clone(&owner);
        let successor_task = tokio::spawn(async move {
            successor_owner
                .issue_portfolio_resource_grant_successor(successor_proposal)
                .await
        });
        wait_for_advisory_lock(owner.pool(), "operator_authorization_writer").await;
        assert!(!successor_task.is_finished());
        successor_gate.rollback().await.unwrap();
        let successor = successor_task.await.unwrap().unwrap();
        let matching_key: bool = sqlx::query_scalar(
            "SELECT hashtextextended($1, 0) = hashtextextended('operator-authorization.portfolio-resource-grant.resource.v1:' || $2, 0)",
        )
        .bind(&rust_lock_identity)
        .bind(&resource_digest)
        .fetch_one(owner.pool())
        .await
        .unwrap();
        assert!(matching_key, "Rust and PL/pgSQL advisory keys diverged");

        let function_definition: String = sqlx::query_scalar(
            "SELECT pg_get_functiondef('operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text)'::regprocedure)",
        )
        .fetch_one(owner.pool())
        .await
        .unwrap();
        let advisory_position = function_definition
            .find("pg_advisory_xact_lock_shared")
            .unwrap();
        let first_row_lock_position = function_definition
            .find("ORDER BY grant_identity FOR SHARE")
            .unwrap();
        assert!(advisory_position < first_row_lock_position);

        let request_for = |grant: &PortfolioResourceGrantReadbackV1,
                           content: &PortfolioResourceGrantContentV1| {
            PortfolioResourceGrantReadRequestV1 {
                locator: grant.locator(),
                expected_resource: content.resource.clone(),
                expected_manifest: content.product_edge_manifest.clone(),
            }
        };
        let (earlier, later_request) =
            if genesis.locator().grant_identity < successor.locator().grant_identity {
                (
                    genesis.locator(),
                    request_for(&successor, &successor_content),
                )
            } else {
                (
                    successor.locator(),
                    request_for(&genesis, &proposal.content),
                )
            };

        let before_schedule = oa_table_fingerprint(owner.pool()).await;
        let mut reader_first = consumer.begin().await.unwrap();
        assert!(matches!(
            resolve_portfolio_resource_grant_in_transaction(&mut reader_first, &later_request)
                .await,
            PortfolioResourceGrantResolutionV1::Available { .. }
        ));
        let revoke_owner = Arc::clone(&owner);
        let expected_frontier_identity = successor.frontier().frontier_identity().to_string();

        let revoke_task = tokio::spawn(async move {
            revoke_owner
                .revoke_portfolio_resource_grant(PortfolioResourceGrantRevocationProposalV1 {
                    grant: earlier,
                    expected_frontier_identity,
                    reason_code: "SERIALIZATION_TEST".into(),
                })
                .await
        });
        wait_for_advisory_lock(owner.pool(), "operator_authorization_writer").await;
        assert!(!revoke_task.is_finished());
        reader_first.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), revoke_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_ne!(oa_table_fingerprint(owner.pool()).await, before_schedule);

        let reverse_proposal =
            portfolio_grant_proposal(&suffix, now_ms().unwrap(), "reverse", 600_000);
        let reverse = owner
            .issue_portfolio_resource_grant_genesis(reverse_proposal.clone())
            .await
            .unwrap();
        let reverse_request = request_for(&reverse, &reverse_proposal.content);
        let reverse_digest = reverse_proposal.content.resource.digest().unwrap();
        let mut writer_first = owner.pool().begin().await.unwrap();
        lock_grant_resource_for_write(&mut writer_first, &reverse_digest)
            .await
            .unwrap();
        let reverse_consumer = consumer.clone();
        let reverse_reader = tokio::spawn(async move {
            let mut transaction = reverse_consumer.begin().await.unwrap();
            let resolution =
                resolve_portfolio_resource_grant_in_transaction(&mut transaction, &reverse_request)
                    .await;
            transaction.rollback().await.unwrap();
            resolution
        });
        wait_for_advisory_lock(&consumer, "product_edge_owner").await;
        assert!(!reverse_reader.is_finished());
        writer_first.rollback().await.unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(5), reverse_reader)
                .await
                .unwrap()
                .unwrap(),
            PortfolioResourceGrantResolutionV1::Available { .. }
        ));

        let before_invalid_locator = oa_table_fingerprint(owner.pool()).await;
        let mut invalid_request = request_for(&reverse, &reverse_proposal.content);
        invalid_request.locator.grant_identity.push_str("-missing");
        assert!(matches!(
            resolve_grant(&consumer, &invalid_request).await,
            PortfolioResourceGrantResolutionV1::Unavailable { .. }
        ));
        assert_eq!(
            oa_table_fingerprint(owner.pool()).await,
            before_invalid_locator
        );

        sqlx::query("UPDATE operator_authorization_private.portfolio_resource_grant_issuances_v1 SET resource_digest='sha256:invalid-hint' WHERE grant_identity=$1")
            .bind(&reverse.locator().grant_identity)
            .execute(owner.pool())
            .await
            .unwrap();
        let invalid_hint_fingerprint = oa_table_fingerprint(owner.pool()).await;
        assert!(matches!(
            resolve_grant(&consumer, &request_for(&reverse, &reverse_proposal.content)).await,
            PortfolioResourceGrantResolutionV1::Unavailable { .. }
        ));
        assert_eq!(
            oa_table_fingerprint(owner.pool()).await,
            invalid_hint_fingerprint
        );
        sqlx::query("UPDATE operator_authorization_private.portfolio_resource_grant_issuances_v1 SET resource_digest=$1 WHERE grant_identity=$2")
            .bind(&reverse_digest)
            .bind(&reverse.locator().grant_identity)
            .execute(owner.pool())
            .await
            .unwrap();
        assert_eq!(
            oa_table_fingerprint(owner.pool()).await,
            before_invalid_locator
        );
    }

    #[tokio::test]
    #[ignore = "requires admitted OA and Product Edge PostgreSQL test URLs"]
    async fn portfolio_resource_grant_issue_read_replay_successor_revoke_restart_acl_and_expiry() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let owner = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let consumer = mutation
            .pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
            .clone();
        let suffix = format!("{}-{}", std::process::id(), now_ms().unwrap());
        let now = now_ms().unwrap();
        let proposal = portfolio_grant_proposal(&suffix, now, "primary", 600_000);
        let issued = owner
            .issue_portfolio_resource_grant_genesis(proposal.clone())
            .await
            .unwrap();
        let genesis_replay = owner
            .issue_portfolio_resource_grant_genesis(proposal.clone())
            .await
            .unwrap();
        assert_same_grant_authority(&genesis_replay, &issued);
        assert!(genesis_replay.observed_at_epoch_ms() >= issued.observed_at_epoch_ms());
        let issued_evidence = parse_locked_grant_evidence(&consumer, &issued.locator())
            .await
            .unwrap();
        assert_eq!(issued_evidence.locator(), issued.locator());
        assert_eq!(
            issued_evidence.frontier_identity(),
            issued.frontier().frontier_identity()
        );
        assert!(issued_evidence.matches_resource(&proposal.content.resource));
        assert!(
            issued_evidence.matches_product_edge_manifest(&proposal.content.product_edge_manifest)
        );
        assert!(issued_evidence.is_current_at(now));
        let parser_fingerprint = oa_table_fingerprint(owner.pool()).await;
        let mut parser_transaction = consumer.begin().await.unwrap();
        let locked_envelope: serde_json::Value = sqlx::query_scalar(
            "SELECT operator_authorization_api.lock_current_portfolio_resource_grant_v1($1,$2)",
        )
        .bind(&issued.locator().grant_identity)
        .bind(&issued.locator().issuance_receipt_identity)
        .fetch_one(&mut *parser_transaction)
        .await
        .unwrap();

        for path in [
            "/issuances/0/principal",
            "/issuances/0/account_identity",
            "/issuances/0/execution_scope_identity",
            "/issuances/0/semantic_digest",
            "/frontiers/0/frontier_digest",
            "/head/frontier_identity",
            "/outboxes/0/payload_digest",
        ] {
            let mut tampered = locked_envelope.clone();
            *tampered.pointer_mut(path).unwrap() = serde_json::json!("caller-authored");
            assert!(
                parse_untrusted_portfolio_resource_grant_envelope_v1(
                    &serde_json::to_vec(&tampered).unwrap(),
                    &issued.locator(),
                )
                .is_err(),
                "accepted tampered database envelope at {path}"
            );
        }
        parser_transaction.rollback().await.unwrap();
        assert_eq!(oa_table_fingerprint(owner.pool()).await, parser_fingerprint);

        let request = PortfolioResourceGrantReadRequestV1 {
            locator: issued.locator(),
            expected_resource: proposal.content.resource.clone(),
            expected_manifest: proposal.content.product_edge_manifest.clone(),
        };

        let legacy_proposal = OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: issued.locator().grant_identity,
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            scope: OperatorAuthorizationScopeV1 {
                principal: format!("legacy-principal-{suffix}"),
                audience: "PRODUCT_EDGE".into(),
                permissions: vec!["provider:invoke".into()],
            },
            request_proof_digest: "sha256:test-proof".into(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: format!("legacy-manifest-{suffix}"),
                manifest_digest: format!("sha256:{}", "c".repeat(64)),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            expected_revocation_head: "EMPTY".into(),
        };
        let legacy = owner.issue_genesis(legacy_proposal.clone()).await.unwrap();
        assert_eq!(owner.issue_genesis(legacy_proposal).await.unwrap(), legacy);
        let collision_grant_replay = owner
            .issue_portfolio_resource_grant_genesis(proposal.clone())
            .await
            .unwrap();
        assert_same_grant_authority(&collision_grant_replay, &issued);
        let mut historical_transaction = owner.pool().begin().await.unwrap();
        assert_eq!(
            resolve_authorization_in_transaction(
                &mut historical_transaction,
                &legacy.locator(),
                AuthorizationReadModeV1::Historical {
                    frontier_identity: legacy.frontier().frontier_identity().into(),
                },
            )
            .await
            .unwrap(),
            legacy
        );
        historical_transaction.rollback().await.unwrap();
        assert!(matches!(
            resolve_grant(&consumer, &request).await,
            PortfolioResourceGrantResolutionV1::Available { .. }
        ));

        let collision_baseline = oa_table_fingerprint(owner.pool()).await;

        for (select_sql, corrupt_sql, restore_sql, insert_sql, delete_sql, legacy_must_fail) in [
            (
                "SELECT payload_digest FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE aggregate_identity=$1",
                "UPDATE operator_authorization_private.operator_authorization_owner_outbox_v1 SET payload_digest='sha256:corrupt' WHERE aggregate_identity=$1",
                "UPDATE operator_authorization_private.operator_authorization_owner_outbox_v1 SET payload_digest=$1 WHERE aggregate_identity=$2",
                "INSERT INTO operator_authorization_private.operator_authorization_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'UNEXPECTED_V1','sha256:corrupt','{}'::jsonb,$3)",
                "DELETE FROM operator_authorization_private.operator_authorization_owner_outbox_v1 WHERE event_identity=$1",
                true,
            ),
            (
                "SELECT payload_digest FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 WHERE aggregate_identity=$1",
                "UPDATE operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 SET payload_digest='sha256:corrupt' WHERE aggregate_identity=$1",
                "UPDATE operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 SET payload_digest=$1 WHERE aggregate_identity=$2",
                "INSERT INTO operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'UNEXPECTED_V1','sha256:corrupt','{}'::jsonb,$3)",
                "DELETE FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 WHERE event_identity=$1",
                false,
            ),
        ] {
            let original_digest: String = sqlx::query_scalar(select_sql)
                .bind(&legacy.locator().authorization_identity)
                .fetch_one(owner.pool())
                .await
                .unwrap();
            sqlx::query(corrupt_sql)
                .bind(&legacy.locator().authorization_identity)
                .execute(owner.pool())
                .await
                .unwrap();
            let corrupted = oa_table_fingerprint(owner.pool()).await;
            assert_eq!(
                resolve_current(&owner, &legacy, now_ms().unwrap())
                    .await
                    .is_err(),
                legacy_must_fail
            );
            assert_eq!(
                matches!(
                    resolve_grant(&consumer, &request).await,
                    PortfolioResourceGrantResolutionV1::Unavailable { .. }
                ),
                !legacy_must_fail
            );
            assert_eq!(oa_table_fingerprint(owner.pool()).await, corrupted);
            sqlx::query(restore_sql)
                .bind(&original_digest)
                .bind(&legacy.locator().authorization_identity)
                .execute(owner.pool())
                .await
                .unwrap();
            assert_eq!(oa_table_fingerprint(owner.pool()).await, collision_baseline);

            let duplicate_identity = format!("duplicate-{legacy_must_fail}-{suffix}");
            sqlx::query(insert_sql)
                .bind(&duplicate_identity)
                .bind(&legacy.locator().authorization_identity)
                .bind(to_i64(now).unwrap())
                .execute(owner.pool())
                .await
                .unwrap();
            let duplicated = oa_table_fingerprint(owner.pool()).await;
            assert_eq!(
                resolve_current(&owner, &legacy, now_ms().unwrap())
                    .await
                    .is_err(),
                legacy_must_fail
            );
            assert_eq!(
                matches!(
                    resolve_grant(&consumer, &request).await,
                    PortfolioResourceGrantResolutionV1::Unavailable { .. }
                ),
                !legacy_must_fail
            );
            assert_eq!(oa_table_fingerprint(owner.pool()).await, duplicated);
            sqlx::query(delete_sql)
                .bind(&duplicate_identity)
                .execute(owner.pool())
                .await
                .unwrap();
            assert_eq!(oa_table_fingerprint(owner.pool()).await, collision_baseline);
        }
        let before_read_cut: i64 = sqlx::query_scalar(
            "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        let mut transaction = consumer.begin().await.unwrap();
        let PortfolioResourceGrantResolutionV1::Available { grant } =
            resolve_portfolio_resource_grant_in_transaction(&mut transaction, &request).await
        else {
            panic!("expected sealed Portfolio resource grant");
        };
        assert_eq!(grant.locator(), issued.locator());
        let after_read_cut: i64 = sqlx::query_scalar(
            "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        assert!(grant.observed_at_epoch_ms() >= u64::try_from(before_read_cut).unwrap());
        assert!(grant.observed_at_epoch_ms() <= u64::try_from(after_read_cut).unwrap());
        transaction.rollback().await.unwrap();

        let before_negative_reads = oa_table_fingerprint(owner.pool()).await;

        for index in 0..8 {
            let mut changed = request.clone();
            match index {
                0 => changed.expected_resource.principal.push_str("-other"),
                1 => changed.expected_resource.audience.push_str("-other"),
                2 => changed.expected_resource.permission.push_str("-other"),
                3 => changed
                    .expected_resource
                    .account_identity
                    .push_str("-other"),
                4 => changed
                    .expected_resource
                    .execution_scope_identity
                    .push_str("-other"),
                5 => changed.expected_resource.mode = PortfolioResourceModeV1::Live,
                6 => changed
                    .expected_manifest
                    .manifest_locator
                    .push_str("-other"),
                7 => changed
                    .expected_manifest
                    .manifest_digest
                    .replace_range(7..8, "b"),
                _ => unreachable!(),
            }
            let mut transaction = consumer.begin().await.unwrap();
            assert!(matches!(
                resolve_portfolio_resource_grant_in_transaction(&mut transaction, &changed).await,
                PortfolioResourceGrantResolutionV1::Unavailable { .. }
            ));
            transaction.rollback().await.unwrap();
        }
        assert_eq!(
            oa_table_fingerprint(owner.pool()).await,
            before_negative_reads
        );

        let mut changed_validity = proposal.clone();
        changed_validity.content.valid_through_epoch_ms += 1;
        changed_validity.grant_identity = changed_validity.content.grant_identity().unwrap();
        assert!(matches!(
            owner
                .issue_portfolio_resource_grant_genesis(changed_validity)
                .await,
            Err(OperatorAuthorizationError::ConflictingReplay)
        ));
        assert_eq!(
            oa_table_fingerprint(owner.pool()).await,
            before_negative_reads
        );

        let mut successor_content = proposal.content.clone();
        successor_content.valid_through_epoch_ms += 600_000;
        successor_content
            .product_edge_manifest
            .manifest_locator
            .push_str("-successor");
        successor_content.product_edge_manifest.manifest_digest =
            format!("sha256:{}", "b".repeat(64));
        let successor_issuance = PortfolioResourceGrantIssuanceProposalV1 {
            grant_identity: successor_content.grant_identity().unwrap(),
            content: successor_content.clone(),
            expected_revocation_frontier_identity: issued.frontier().frontier_identity().into(),
        };
        let successor = PortfolioResourceGrantSuccessorProposalV1 {
            predecessor: issued.locator(),
            expected_current_frontier_identity: issued.frontier().frontier_identity().into(),
            successor: successor_issuance,
        };
        let renewed = owner
            .issue_portfolio_resource_grant_successor(successor.clone())
            .await
            .unwrap();
        let successor_replay = owner
            .issue_portfolio_resource_grant_successor(successor.clone())
            .await
            .unwrap();
        assert_same_grant_authority(&successor_replay, &renewed);
        assert!(successor_replay.observed_at_epoch_ms() >= renewed.observed_at_epoch_ms());

        drop(owner);
        let restarted = Arc::new(
            OperatorAuthorizationIssuerPostgresV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            )
            .await
            .unwrap(),
        );
        let renewed_request = PortfolioResourceGrantReadRequestV1 {
            locator: renewed.locator(),
            expected_resource: successor_content.resource.clone(),
            expected_manifest: successor_content.product_edge_manifest.clone(),
        };
        let mut transaction = consumer.begin().await.unwrap();
        assert!(matches!(
            resolve_portfolio_resource_grant_in_transaction(&mut transaction, &renewed_request)
                .await,
            PortfolioResourceGrantResolutionV1::Available { .. }
        ));
        transaction.rollback().await.unwrap();
        let restarted_evidence = parse_locked_grant_evidence(&consumer, &renewed.locator())
            .await
            .unwrap();
        assert_eq!(restarted_evidence.locator(), renewed.locator());
        assert!(restarted_evidence.matches_resource(&successor_content.resource));
        assert!(
            restarted_evidence
                .matches_product_edge_manifest(&successor_content.product_edge_manifest)
        );

        let mut revocation_gate = restarted.pool().begin().await.unwrap();
        sqlx::query("SELECT grant_identity FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE grant_identity=$1 FOR UPDATE")
            .bind(&renewed.locator().grant_identity).fetch_one(&mut *revocation_gate).await.unwrap();
        let revoke_owner = Arc::clone(&restarted);
        let revoke_proposal = PortfolioResourceGrantRevocationProposalV1 {
            grant: renewed.locator(),
            expected_frontier_identity: renewed.frontier().frontier_identity().into(),
            reason_code: "ADMIN_REVOKED".into(),
        };

        let revoke_task = tokio::spawn(async move {
            revoke_owner
                .revoke_portfolio_resource_grant(revoke_proposal)
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pg_stat_activity WHERE usename='operator_authorization_writer' AND wait_event_type='Lock' AND query LIKE '%portfolio_resource_grant_issuances_v1%FOR UPDATE%'")
                    .fetch_one(restarted.pool()).await.unwrap();

                if waiting > 0 { break; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        let crossing_consumer = consumer.clone();
        let crossing_request = renewed_request.clone();

        let crossing_reader = tokio::spawn(async move {
            let mut transaction = crossing_consumer.begin().await.unwrap();
            let resolution = resolve_portfolio_resource_grant_in_transaction(
                &mut transaction,
                &crossing_request,
            )
            .await;
            transaction.rollback().await.unwrap();
            resolution
        });
        tokio::task::yield_now().await;
        assert!(!revoke_task.is_finished());
        assert!(!crossing_reader.is_finished());
        revocation_gate.rollback().await.unwrap();
        let revoked = tokio::time::timeout(Duration::from_secs(5), revoke_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let after_authorized_revoke = oa_table_fingerprint(restarted.pool()).await;
        let PortfolioResourceGrantResolutionV1::Unavailable { reason } =
            tokio::time::timeout(Duration::from_secs(5), crossing_reader)
                .await
                .unwrap()
                .unwrap()
        else {
            panic!("reader queued behind revocation must fail closed");
        };
        assert_eq!(reason, PortfolioResourceGrantUnavailableReasonV1::Revoked);
        assert_eq!(
            oa_table_fingerprint(restarted.pool()).await,
            after_authorized_revoke
        );
        assert!(
            revoked
                .revoked_grant_identities()
                .contains(&renewed.locator().grant_identity)
        );
        let before_revoked_replay = oa_table_fingerprint(restarted.pool()).await;
        assert!(matches!(
            restarted
                .issue_portfolio_resource_grant_successor(successor.clone())
                .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        let PortfolioResourceGrantResolutionV1::Unavailable { reason } =
            resolve_grant(&consumer, &renewed_request).await
        else {
            panic!("revoked successor replay and canonical resolve must fail closed");
        };
        assert_eq!(reason, PortfolioResourceGrantUnavailableReasonV1::Revoked);
        let revoked_evidence = parse_locked_grant_evidence(&consumer, &renewed.locator())
            .await
            .unwrap();
        assert_eq!(
            revoked_evidence.frontier_identity(),
            revoked.frontier_identity()
        );
        assert!(!revoked_evidence.is_current_at(now_ms().unwrap()));
        assert_eq!(
            oa_table_fingerprint(restarted.pool()).await,
            before_revoked_replay
        );

        let executable: bool = sqlx::query_scalar("SELECT has_function_privilege(current_user, 'operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text)', 'EXECUTE')")
            .fetch_one(&consumer).await.unwrap();
        let private_usage: bool = sqlx::query_scalar(
            "SELECT has_schema_privilege(current_user, 'operator_authorization_private', 'USAGE')",
        )
        .fetch_one(&consumer)
        .await
        .unwrap();
        assert!(executable);
        assert!(!private_usage);

        for table in [
            "operator_authorization_private.portfolio_resource_grant_issuances_v1",
            "operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1",
            "operator_authorization_private.portfolio_resource_grant_revocation_heads_v1",
            "operator_authorization_private.portfolio_resource_grant_owner_outbox_v1",
        ] {
            let relation_oid: i64 = sqlx::query_scalar("SELECT to_regclass($1)::oid::bigint")
                .bind(table)
                .fetch_one(restarted.pool())
                .await
                .unwrap();

            for privilege in ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] {
                let granted: bool =
                    sqlx::query_scalar("SELECT has_table_privilege(current_user, $1::oid, $2)")
                        .bind(relation_oid)
                        .bind(privilege)
                        .fetch_one(&consumer)
                        .await
                        .unwrap();
                assert!(!granted, "Product Edge has {privilege} on {table}");
            }
        }

        let expiry_proposal = portfolio_grant_proposal(&suffix, now_ms().unwrap(), "expiry", 2_000);
        let expiring = restarted
            .issue_portfolio_resource_grant_genesis(expiry_proposal.clone())
            .await
            .unwrap();
        let expiry_request = PortfolioResourceGrantReadRequestV1 {
            locator: expiring.locator(),
            expected_resource: expiry_proposal.content.resource.clone(),
            expected_manifest: expiry_proposal.content.product_edge_manifest.clone(),
        };
        let mut expiry_gate = restarted.pool().begin().await.unwrap();
        sqlx::query("SELECT grant_identity FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE grant_identity=$1 FOR UPDATE")
            .bind(&expiring.locator().grant_identity).fetch_one(&mut *expiry_gate).await.unwrap();
        let expiry_consumer = consumer.clone();
        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
        let expiry_replay_owner = Arc::clone(&restarted);
        let expiry_replay_proposal = expiry_proposal.clone();
        let (replay_started_sender, replay_started_receiver) = tokio::sync::oneshot::channel();
        let expiry_replay = tokio::spawn(async move {
            replay_started_sender.send(()).unwrap();
            expiry_replay_owner
                .issue_portfolio_resource_grant_genesis(expiry_replay_proposal)
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), replay_started_receiver)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pg_stat_activity WHERE usename='operator_authorization_writer' AND wait_event_type='Lock' AND query LIKE '%portfolio_resource_grant_issuances_v1%FOR UPDATE%'")
                    .fetch_one(restarted.pool()).await.unwrap();

                if waiting > 0 { break; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();

        let expiry_reader = tokio::spawn(async move {
            let mut transaction = expiry_consumer.begin().await.unwrap();
            let started_at: i64 = sqlx::query_scalar(
                "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
            )
            .fetch_one(&mut *transaction)
            .await
            .unwrap();
            started_sender
                .send(u64::try_from(started_at).unwrap())
                .unwrap();
            let resolution =
                resolve_portfolio_resource_grant_in_transaction(&mut transaction, &expiry_request)
                    .await;
            transaction.rollback().await.unwrap();
            resolution
        });
        let started_at = tokio::time::timeout(Duration::from_secs(2), started_receiver)
            .await
            .unwrap()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!expiry_reader.is_finished());
        assert!(!expiry_replay.is_finished());
        let database_now: i64 = sqlx::query_scalar(
            "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint",
        )
        .fetch_one(restarted.pool())
        .await
        .unwrap();
        let remaining = expiry_proposal
            .content
            .valid_through_epoch_ms
            .saturating_sub(u64::try_from(database_now).unwrap());
        tokio::time::sleep(Duration::from_millis(remaining.saturating_add(50))).await;
        let before_expired_read = oa_table_fingerprint(restarted.pool()).await;
        expiry_gate.rollback().await.unwrap();
        let resolution = tokio::time::timeout(Duration::from_secs(5), expiry_reader)
            .await
            .unwrap()
            .unwrap();
        assert!(started_at < expiry_proposal.content.valid_through_epoch_ms);
        let PortfolioResourceGrantResolutionV1::Unavailable { reason } = resolution else {
            panic!("reader begun before expiry but released after expiry must fail closed");
        };
        assert_eq!(reason, PortfolioResourceGrantUnavailableReasonV1::Expired);
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(5), expiry_replay)
                .await
                .unwrap()
                .unwrap(),
            Err(OperatorAuthorizationError::Unavailable)
        ));
        let expired_evidence = parse_locked_grant_evidence(&consumer, &expiring.locator())
            .await
            .unwrap();
        assert!(!expired_evidence.is_current_at(now_ms().unwrap()));
        assert_eq!(
            oa_table_fingerprint(restarted.pool()).await,
            before_expired_read
        );
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
            ("product_edge_custodian", true),
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
