//! PostgreSQL custody shared by every grant kind.
//!
//! Each kind owns four tables (`issuances`, `revocation_frontiers`,
//! `revocation_heads`, `owner_outbox`) named after its table stem and one
//! `SECURITY DEFINER` lock function consumers call to read one grant's complete
//! resource history under the issuer's locks. The engine never learns what a
//! content means; the kind's [`GrantContentV1`] impl decides identity,
//! resource, and the mirrored columns.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};

use super::{
    OperatorAuthorizationIssuerPostgresV1, Reason, Subject, ensure_read_committed, from_i64,
    from_json, json, storage, to_i64, unavailable, unavailable_for,
};
use crate::{
    GrantContentV1, GrantIssuanceProposalV1, GrantIssuanceReceiptV1, GrantLocatorV1,
    GrantReadbackV1, GrantResolutionV1, GrantRevocationFrontierV1, GrantRevocationProposalV1,
    GrantSuccessorProposalV1, GrantUnavailableReasonV1, OperatorAuthorizationError,
    UntrustedCanonicalGrantEvidenceV1, canonical_digest, identity,
};

/// Marks SQL text assembled only from this crate's compile-time kind stems as
/// safe: no caller-supplied value ever reaches the statement text, and every
/// data value still travels through a bind parameter.
fn sql(text: String) -> sqlx::AssertSqlSafe<String> {
    sqlx::AssertSqlSafe(text)
}

/// The names one grant kind derives from its stems.
pub(crate) struct GrantSchemaV1 {
    pub(crate) issuances: String,
    pub(crate) frontiers: String,
    pub(crate) heads: String,
    pub(crate) outbox: String,
    pub(crate) lock_function: String,
    issued_event: String,
    frontier_event: String,
    lock_namespace: String,
    receipt_domain: String,
    frontier_identity_domain: String,
    frontier_digest_domain: String,
    revocations_domain: String,
    outbox_payload_domain: String,
    owner_event_domain: String,
}

impl GrantSchemaV1 {
    pub(crate) fn of<C: GrantContentV1>() -> Self {
        let table = |suffix: &str| {
            format!(
                "operator_authorization_private.{}_{suffix}_v1",
                C::TABLE_STEM
            )
        };
        let event_stem = C::TABLE_STEM.to_ascii_uppercase();
        Self {
            issuances: table("issuances"),
            frontiers: table("revocation_frontiers"),
            heads: table("revocation_heads"),
            outbox: table("owner_outbox"),
            lock_function: format!(
                "operator_authorization_api.lock_current_{}_v1",
                C::TABLE_STEM
            ),
            issued_event: format!("{event_stem}_ISSUED_V1"),
            frontier_event: format!("{event_stem}_REVOCATION_FRONTIER_V1"),
            lock_namespace: format!("operator-authorization.{}.resource.v1", C::KIND_STEM),
            receipt_domain: format!("operator-authorization-{}-receipt-v1", C::KIND_STEM),
            frontier_identity_domain: format!(
                "operator-authorization-{}-frontier-v1",
                C::KIND_STEM
            ),
            frontier_digest_domain: format!("operator-authorization.{}-frontier.v1", C::KIND_STEM),
            revocations_domain: format!("operator-authorization.{}-revocations.v1", C::KIND_STEM),
            outbox_payload_domain: format!(
                "operator-authorization.{}-outbox-payload.v1",
                C::KIND_STEM
            ),
            owner_event_domain: format!("operator-authorization-{}-owner-event-v1", C::KIND_STEM),
        }
    }

    pub(crate) fn advisory_lock_identity(&self, resource_digest: &str) -> String {
        format!("{}:{resource_digest}", self.lock_namespace)
    }
}

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
pub(crate) struct StoredGrantIssuanceV1<C> {
    schema_version: u32,
    pub(crate) proposal: GrantIssuanceProposalV1<C>,
    predecessor: Option<GrantLocatorV1>,
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

impl From<StoredGrantReceiptV1> for GrantIssuanceReceiptV1 {
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
pub(crate) struct StoredGrantFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    resource_digest: String,
    sequence: u64,
    predecessor_frontier_identity: Option<String>,
    revocations: Vec<StoredGrantRevocationV1>,
    committed_at_epoch_ms: u64,
}

impl StoredGrantFrontierV1 {
    fn public(&self) -> GrantRevocationFrontierV1 {
        GrantRevocationFrontierV1 {
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

/// One issuance row as the lock function returns it: the fixed columns plus
/// the kind-specific mirror columns, which `to_jsonb` flattens beside them.
#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct LockedGrantIssuanceRowV1 {
    grant_identity: String,
    issuer_identity: String,
    resource_digest: String,
    semantic_digest: String,
    issuance_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
    #[serde(flatten)]
    mirror: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(deny_unknown_fields)]
pub(crate) struct LockedGrantFrontierRowV1 {
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
pub(crate) struct LockedGrantHeadRowV1 {
    resource_digest: String,
    frontier_identity: String,
    sequence: i64,
    frontier_digest: String,
    committed_at_epoch_ms: i64,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(deny_unknown_fields)]
pub(crate) struct LockedGrantOutboxRowV1 {
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
pub(crate) struct LockedGrantEnvelopeV1 {
    issuances: Vec<LockedGrantIssuanceRowV1>,
    head: LockedGrantHeadRowV1,
    frontiers: Vec<LockedGrantFrontierRowV1>,
    outboxes: Vec<LockedGrantOutboxRowV1>,
    observed_at_epoch_ms: i64,
}

pub(crate) struct VerifiedGrantHistoryV1<C> {
    resource_digest: String,
    issuances: Vec<StoredGrantIssuanceV1<C>>,
    frontiers: Vec<StoredGrantFrontierV1>,
}

impl<C: GrantContentV1> VerifiedGrantHistoryV1<C> {
    fn current(&self) -> Result<&StoredGrantFrontierV1, OperatorAuthorizationError> {
        self.frontiers.last().ok_or_else(|| {
            unavailable_for(Reason::Missing, Subject::Resource, &self.resource_digest)
        })
    }

    fn issuance(
        &self,
        grant_identity: &str,
    ) -> Result<&StoredGrantIssuanceV1<C>, OperatorAuthorizationError> {
        self.issuances
            .iter()
            .find(|item| item.proposal.grant_identity == grant_identity)
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Grant, grant_identity))
    }

    fn issuance_head(&self) -> Result<&StoredGrantIssuanceV1<C>, OperatorAuthorizationError> {
        self.issuances.last().ok_or_else(|| {
            unavailable_for(Reason::Missing, Subject::Resource, &self.resource_digest)
        })
    }
}

/// Creates the kind's tables and consumer lock function. Idempotent.
pub(crate) async fn migrate<C: GrantContentV1>(
    pool: &PgPool,
) -> Result<(), OperatorAuthorizationError> {
    let schema = GrantSchemaV1::of::<C>();
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET LOCAL ROLE operator_authorization_owner")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    let mirror_columns = C::MIRROR_COLUMNS
        .iter()
        .map(|column| format!("{column} TEXT NOT NULL, "))
        .collect::<String>();
    let table_stem = C::TABLE_STEM;

    for statement in [
        format!(
            "CREATE TABLE IF NOT EXISTS {} (grant_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, {mirror_columns}resource_digest TEXT NOT NULL, semantic_digest TEXT NOT NULL, issuance_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            schema.issuances
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {} (frontier_identity TEXT PRIMARY KEY, resource_digest TEXT NOT NULL, sequence BIGINT NOT NULL, predecessor_frontier_identity TEXT, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(resource_digest, sequence))",
            schema.frontiers
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {} (resource_digest TEXT PRIMARY KEY, frontier_identity TEXT NOT NULL REFERENCES {}(frontier_identity), sequence BIGINT NOT NULL, frontier_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            schema.heads, schema.frontiers
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS {} (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            schema.outbox
        ),
        format!(
            "CREATE INDEX IF NOT EXISTS {table_stem}_issuance_resource_v1 ON {}(resource_digest, grant_identity)",
            schema.issuances
        ),
        format!(
            "CREATE INDEX IF NOT EXISTS {table_stem}_outbox_aggregate_v1 ON {}(aggregate_identity)",
            schema.outbox
        ),
        format!(
            "REVOKE ALL ON TABLE {}, {}, {}, {} FROM PUBLIC, product_edge_owner, rd_owner, qualification_writer",
            schema.issuances, schema.frontiers, schema.heads, schema.outbox
        ),
        format!(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {}, {}, {}, {} TO operator_authorization_writer",
            schema.issuances, schema.frontiers, schema.heads, schema.outbox
        ),
    ] {
        sqlx::query(sql(statement))
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
    }
    sqlx::query(sql(format!(
        "CREATE OR REPLACE FUNCTION {lock_function}(requested_grant_identity text, requested_issuance_receipt_identity text)
RETURNS jsonb
LANGUAGE plpgsql
STRICT VOLATILE PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog, operator_authorization_private, pg_temp
AS $function$
DECLARE
  hinted_resource_digest text;
  issuance {issuances}%ROWTYPE;
  head {heads}%ROWTYPE;
BEGIN
  SELECT item.resource_digest INTO hinted_resource_digest
    FROM {issuances} item
    WHERE item.grant_identity=requested_grant_identity;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(
    '{lock_namespace}:' || hinted_resource_digest,
    0
  ));
  PERFORM 1 FROM {issuances}
    WHERE resource_digest=hinted_resource_digest ORDER BY grant_identity FOR SHARE;
  SELECT * INTO issuance FROM {issuances}
    WHERE grant_identity=requested_grant_identity
      AND resource_digest=hinted_resource_digest;
  IF NOT FOUND OR issuance.receipt_json->>'receipt_identity' <> requested_issuance_receipt_identity THEN
    RETURN NULL;
  END IF;
  SELECT * INTO head FROM {heads}
    WHERE resource_digest=issuance.resource_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM {frontiers}
    WHERE resource_digest=issuance.resource_digest ORDER BY sequence, frontier_identity FOR SHARE;
  PERFORM 1 FROM {outbox} outbox
    WHERE outbox.aggregate_identity IN
      (SELECT grant_identity FROM {issuances} WHERE resource_digest=issuance.resource_digest)
       OR outbox.aggregate_identity IN
      (SELECT frontier_identity FROM {frontiers} WHERE resource_digest=issuance.resource_digest)
    ORDER BY outbox.event_identity FOR SHARE;
  RETURN jsonb_build_object(
    'issuances', COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.grant_identity) FROM {issuances} item WHERE item.resource_digest=issuance.resource_digest), '[]'::jsonb),
    'head', to_jsonb(head),
    'frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.sequence, item.frontier_identity) FROM {frontiers} item WHERE item.resource_digest=issuance.resource_digest), '[]'::jsonb),
    'outboxes', COALESCE((SELECT jsonb_agg(to_jsonb(outbox) ORDER BY outbox.event_identity) FROM {outbox} outbox WHERE outbox.aggregate_identity IN (SELECT grant_identity FROM {issuances} WHERE resource_digest=issuance.resource_digest) OR outbox.aggregate_identity IN (SELECT frontier_identity FROM {frontiers} WHERE resource_digest=issuance.resource_digest)), '[]'::jsonb),
    'observed_at_epoch_ms', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  );
END
$function$",
        lock_function = schema.lock_function,
        issuances = schema.issuances,
        heads = schema.heads,
        frontiers = schema.frontiers,
        outbox = schema.outbox,
        lock_namespace = schema.lock_namespace,
    )))
    .execute(&mut *transaction)
    .await
    .map_err(storage)?;

    for statement in [
        format!(
            "ALTER FUNCTION {}(text,text) OWNER TO operator_authorization_owner",
            schema.lock_function
        ),
        format!(
            "REVOKE ALL ON FUNCTION {}(text,text) FROM PUBLIC, rd_owner, qualification_writer",
            schema.lock_function
        ),
        format!(
            "GRANT EXECUTE ON FUNCTION {}(text,text) TO {}",
            schema.lock_function,
            C::CONSUMER_ROLES
        ),
    ] {
        sqlx::query(sql(statement))
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
    }
    transaction.commit().await.map_err(storage)
}

impl OperatorAuthorizationIssuerPostgresV1 {
    pub(crate) async fn issue_grant_genesis<C: GrantContentV1>(
        &self,
        proposal: GrantIssuanceProposalV1<C>,
    ) -> Result<GrantReadbackV1<C>, OperatorAuthorizationError> {
        proposal.validate()?;
        if proposal.expected_revocation_frontier_identity != "EMPTY" {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "grant genesis frontier",
            ));
        }
        let schema = GrantSchemaV1::of::<C>();
        let semantic_digest = proposal.semantic_digest()?;
        let resource_digest = proposal.content.resource_digest()?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        lock_grant_resource_for_write(&mut transaction, &schema, &resource_digest).await?;
        if let Some(history) =
            verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true).await?
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
                &schema,
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
            schema_version: C::SCHEMA_VERSION,
            proposal,
            predecessor: None,
            issuance_digest: semantic_digest,
            committed_at_epoch_ms: committed_at,
        };
        let receipt = grant_receipt(&schema, &stored);
        let frontier = grant_genesis_frontier(&schema, &stored)?;
        insert_grant_issuance(&mut transaction, &schema, &stored, &receipt).await?;
        insert_grant_frontier(&mut transaction, &schema, &frontier).await?;
        let frontier_digest = grant_frontier_digest(&schema, &frontier)?;
        sqlx::query(sql(format!(
            "INSERT INTO {} (resource_digest,frontier_identity,sequence,frontier_digest,committed_at_epoch_ms) VALUES ($1,$2,0,$3,$4)",
            schema.heads
        )))
        .bind(&resource_digest)
        .bind(&frontier.frontier_identity)
        .bind(&frontier_digest)
        .bind(to_i64(committed_at)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        insert_grant_outbox::<C, _>(
            &mut transaction,
            &schema,
            &receipt.receipt_identity,
            &stored.proposal.grant_identity,
            &schema.issued_event,
            &receipt,
            committed_at,
        )
        .await?;
        insert_grant_outbox::<C, _>(
            &mut transaction,
            &schema,
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            &schema.frontier_event,
            &frontier,
            committed_at,
        )
        .await?;
        let history = verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true)
            .await?
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Resource, &resource_digest))?;
        let result = resolve_locked_grant_readback(
            &mut transaction,
            &schema,
            &history,
            &stored.proposal.grant_identity,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result)
    }

    pub(crate) async fn issue_grant_successor<C: GrantContentV1>(
        &self,
        proposal: GrantSuccessorProposalV1<C>,
    ) -> Result<GrantReadbackV1<C>, OperatorAuthorizationError> {
        proposal.validate()?;
        let schema = GrantSchemaV1::of::<C>();
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let resource_digest = load_grant_resource_digest_hint(
            &mut transaction,
            &schema,
            &proposal.predecessor.grant_identity,
        )
        .await?
        .ok_or_else(|| {
            unavailable_for(
                Reason::Missing,
                Subject::Grant,
                &proposal.predecessor.grant_identity,
            )
        })?;
        lock_grant_resource_for_write(&mut transaction, &schema, &resource_digest).await?;
        let history = verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true)
            .await?
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Resource, &resource_digest))?;
        let predecessor = history
            .issuance(&proposal.predecessor.grant_identity)?
            .clone();

        if grant_receipt(&schema, &predecessor).receipt_identity
            != proposal.predecessor.issuance_receipt_identity
        {
            return Err(unavailable_for(
                Reason::LocatorMismatch,
                Subject::Grant,
                &proposal.predecessor.grant_identity,
            ));
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
                resolve_locked_grant_readback(&mut transaction, &schema, &history, &grant_identity)
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
            || proposal.successor.content.issuer_identity()
                != predecessor.proposal.content.issuer_identity()
            || proposal.successor.content.issuer_key_version()
                != predecessor.proposal.content.issuer_key_version()
            || !proposal
                .successor
                .content
                .same_resource(&predecessor.proposal.content)
            || proposal.successor.content.effective_at_epoch_ms()
                < predecessor.proposal.content.effective_at_epoch_ms()
            || proposal.successor.content.valid_through_epoch_ms()
                <= predecessor.proposal.content.valid_through_epoch_ms()
        {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }
        let committed_at = database_now(&mut transaction).await?;
        ensure_grant_current(&proposal.successor.content, committed_at)?;
        let stored = StoredGrantIssuanceV1 {
            schema_version: C::SCHEMA_VERSION,
            proposal: proposal.successor,
            predecessor: Some(proposal.predecessor),
            issuance_digest: digest,
            committed_at_epoch_ms: committed_at,
        };
        let receipt = grant_receipt(&schema, &stored);
        insert_grant_issuance(&mut transaction, &schema, &stored, &receipt).await?;
        insert_grant_outbox::<C, _>(
            &mut transaction,
            &schema,
            &receipt.receipt_identity,
            &stored.proposal.grant_identity,
            &schema.issued_event,
            &receipt,
            committed_at,
        )
        .await?;
        let verified = verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true)
            .await?
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Resource, &resource_digest))?;
        let result = resolve_locked_grant_readback(
            &mut transaction,
            &schema,
            &verified,
            &stored.proposal.grant_identity,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result)
    }

    pub(crate) async fn revoke_grant<C: GrantContentV1>(
        &self,
        proposal: GrantRevocationProposalV1,
    ) -> Result<GrantRevocationFrontierV1, OperatorAuthorizationError> {
        proposal.validate()?;
        let schema = GrantSchemaV1::of::<C>();
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let resource_digest = load_grant_resource_digest_hint(
            &mut transaction,
            &schema,
            &proposal.grant.grant_identity,
        )
        .await?
        .ok_or_else(|| {
            unavailable_for(
                Reason::Missing,
                Subject::Grant,
                &proposal.grant.grant_identity,
            )
        })?;
        lock_grant_resource_for_write(&mut transaction, &schema, &resource_digest).await?;
        let history = verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true)
            .await?
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Resource, &resource_digest))?;
        let issuance = history.issuance(&proposal.grant.grant_identity)?.clone();

        if grant_receipt(&schema, &issuance).receipt_identity
            != proposal.grant.issuance_receipt_identity
        {
            return Err(unavailable_for(
                Reason::LocatorMismatch,
                Subject::Grant,
                &proposal.grant.grant_identity,
            ));
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
            schema_version: C::SCHEMA_VERSION,
            frontier_identity: identity(
                &schema.frontier_identity_domain,
                &[
                    &resource_digest,
                    &current.frontier_identity,
                    &canonical_digest(&schema.revocations_domain, &revocations)?,
                    &committed_at.to_string(),
                ],
            ),
            resource_digest: resource_digest.clone(),
            sequence: current.sequence.saturating_add(1),
            predecessor_frontier_identity: Some(current.frontier_identity.clone()),
            revocations,
            committed_at_epoch_ms: committed_at,
        };
        insert_grant_frontier(&mut transaction, &schema, &next).await?;
        let next_digest = grant_frontier_digest(&schema, &next)?;
        let updated = sqlx::query(sql(format!(
            "UPDATE {} SET frontier_identity=$1,sequence=$2,frontier_digest=$3,committed_at_epoch_ms=$4 WHERE resource_digest=$5 AND frontier_identity=$6 AND sequence=$7",
            schema.heads
        )))
        .bind(&next.frontier_identity)
        .bind(to_i64(next.sequence)?)
        .bind(&next_digest)
        .bind(to_i64(committed_at)?)
        .bind(&resource_digest)
        .bind(&current.frontier_identity)
        .bind(to_i64(current.sequence)?)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(OperatorAuthorizationError::ConflictingReplay);
        }
        insert_grant_outbox::<C, _>(
            &mut transaction,
            &schema,
            &next.frontier_identity,
            &next.frontier_identity,
            &schema.frontier_event,
            &next,
            committed_at,
        )
        .await?;
        let verified = verify_grant_history::<C>(&mut transaction, &schema, &resource_digest, true)
            .await?
            .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Resource, &resource_digest))?;
        if verified.current()? != &next {
            return Err(unavailable_for(
                Reason::CustodyDrift,
                Subject::Resource,
                &resource_digest,
            ));
        }
        transaction.commit().await.map_err(storage)?;
        Ok(next.public())
    }
}

/// Resolves one grant under the issuer's locks on the caller's transaction.
pub(crate) async fn resolve_grant_in_transaction<C: GrantContentV1>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &GrantLocatorV1,
    expected: &C::Expected<'_>,
) -> GrantResolutionV1<C> {
    let refuse = |reason| GrantResolutionV1::Unavailable { reason };

    if locator.validate().is_err() {
        return refuse(GrantUnavailableReasonV1::InvalidRequest);
    }

    if ensure_read_committed(transaction).await.is_err() {
        return refuse(GrantUnavailableReasonV1::OwnerUnavailable);
    }
    let schema = GrantSchemaV1::of::<C>();
    let envelope = sqlx::query_scalar::<_, Option<serde_json::Value>>(sql(format!(
        "SELECT {}($1,$2)",
        schema.lock_function
    )))
    .bind(&locator.grant_identity)
    .bind(&locator.issuance_receipt_identity)
    .fetch_one(&mut **transaction)
    .await;
    let Ok(Some(value)) = envelope else {
        return refuse(GrantUnavailableReasonV1::OwnerUnavailable);
    };
    let observed_at = value
        .get("observed_at_epoch_ms")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| unavailable(Reason::Malformed))
        .and_then(from_i64);
    let evidence = serde_json::to_vec(&value)
        .map_err(storage)
        .and_then(|bytes| parse_untrusted_grant_envelope::<C>(&bytes, locator));
    let (Ok(observed_at), Ok(evidence)) = (observed_at, evidence) else {
        return refuse(GrantUnavailableReasonV1::OwnerUnavailable);
    };

    resolve_verified_grant_evidence(&evidence, observed_at, Some(expected))
}

fn ensure_grant_current<C: GrantContentV1>(
    content: &C,
    observed_at: u64,
) -> Result<(), OperatorAuthorizationError> {
    if observed_at < content.effective_at_epoch_ms()
        || observed_at >= content.valid_through_epoch_ms()
    {
        return Err(OperatorAuthorizationError::InvalidProposal(
            "grant validity",
        ));
    }
    Ok(())
}

fn grant_receipt<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    stored: &StoredGrantIssuanceV1<C>,
) -> StoredGrantReceiptV1 {
    let committed = stored.committed_at_epoch_ms.to_string();
    StoredGrantReceiptV1 {
        schema_version: C::SCHEMA_VERSION,
        receipt_identity: identity(
            &schema.receipt_domain,
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

fn grant_genesis_frontier<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    stored: &StoredGrantIssuanceV1<C>,
) -> Result<StoredGrantFrontierV1, OperatorAuthorizationError> {
    let resource_digest = stored.proposal.content.resource_digest()?;
    Ok(StoredGrantFrontierV1 {
        schema_version: C::SCHEMA_VERSION,
        frontier_identity: identity(
            &schema.frontier_identity_domain,
            &[
                &resource_digest,
                crate::GENESIS_REVOCATION_FRONTIER,
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
    schema: &GrantSchemaV1,
    frontier: &StoredGrantFrontierV1,
) -> Result<String, OperatorAuthorizationError> {
    canonical_digest(&schema.frontier_digest_domain, frontier)
}

fn stored_grant_digest<C: GrantContentV1>(
    stored: &StoredGrantIssuanceV1<C>,
) -> Result<String, OperatorAuthorizationError> {
    match &stored.predecessor {
        None => stored.proposal.semantic_digest(),
        Some(predecessor) => GrantSuccessorProposalV1 {
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

fn resolve_verified_grant<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    stored: &StoredGrantIssuanceV1<C>,
    frontier: &StoredGrantFrontierV1,
    observed_at: u64,
    expected: Option<&C::Expected<'_>>,
) -> GrantResolutionV1<C> {
    let evidence = UntrustedCanonicalGrantEvidenceV1 {
        schema_version: C::SCHEMA_VERSION,
        issuance_receipt: grant_receipt(schema, stored).into(),
        frontier: frontier.public(),
        content: stored.proposal.content.clone(),
    };
    resolve_verified_grant_evidence(&evidence, observed_at, expected)
}

fn resolve_verified_grant_evidence<C: GrantContentV1>(
    evidence: &UntrustedCanonicalGrantEvidenceV1<C>,
    observed_at: u64,
    expected: Option<&C::Expected<'_>>,
) -> GrantResolutionV1<C> {
    let refuse = |reason| GrantResolutionV1::Unavailable { reason };

    if let Some(expected) = expected {
        if !evidence.matches_expected_resource(expected) {
            return refuse(GrantUnavailableReasonV1::ResourceMismatch);
        }

        if !evidence.matches_expected_manifest(expected) {
            return refuse(GrantUnavailableReasonV1::ManifestMismatch);
        }
    }

    if observed_at < evidence.content.effective_at_epoch_ms() {
        return refuse(GrantUnavailableReasonV1::NotEffective);
    }

    if observed_at >= evidence.content.valid_through_epoch_ms() {
        return refuse(GrantUnavailableReasonV1::Expired);
    }

    if !evidence.is_current_at(observed_at) {
        return refuse(GrantUnavailableReasonV1::Revoked);
    }
    GrantResolutionV1::Available {
        grant: Box::new(GrantReadbackV1 {
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
    let observed: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint")
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    from_i64(observed)
}

async fn resolve_locked_grant_readback<C: GrantContentV1>(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    history: &VerifiedGrantHistoryV1<C>,
    grant_identity: &str,
) -> Result<GrantReadbackV1<C>, OperatorAuthorizationError> {
    let observed_at = database_now(transaction).await?;

    match resolve_verified_grant(
        schema,
        history.issuance(grant_identity)?,
        history.current()?,
        observed_at,
        None,
    ) {
        GrantResolutionV1::Available { grant } => Ok(*grant),
        GrantResolutionV1::Unavailable { reason } => Err(unavailable(Reason::Grant(reason))),
    }
}

async fn insert_grant_issuance<C: GrantContentV1>(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    stored: &StoredGrantIssuanceV1<C>,
    receipt: &StoredGrantReceiptV1,
) -> Result<(), OperatorAuthorizationError> {
    let mirror_values = stored.proposal.content.mirror_values()?;
    if mirror_values.len() != C::MIRROR_COLUMNS.len() {
        return Err(OperatorAuthorizationError::InvalidProposal(
            "grant mirror columns",
        ));
    }
    let fixed_before = ["grant_identity", "issuer_identity"];
    let fixed_after = [
        "resource_digest",
        "semantic_digest",
        "issuance_json",
        "receipt_json",
        "committed_at_epoch_ms",
    ];
    let columns = fixed_before
        .iter()
        .chain(C::MIRROR_COLUMNS.iter())
        .chain(fixed_after.iter())
        .copied()
        .collect::<Vec<_>>();
    let placeholders = (1..=columns.len())
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut query = sqlx::query(sql(format!(
        "INSERT INTO {} ({}) VALUES ({placeholders})",
        schema.issuances,
        columns.join(",")
    )))
    .bind(&stored.proposal.grant_identity)
    .bind(stored.proposal.content.issuer_identity());
    for value in mirror_values {
        query = query.bind(value);
    }
    query
        .bind(stored.proposal.content.resource_digest()?)
        .bind(&stored.issuance_digest)
        .bind(json(stored)?)
        .bind(json(receipt)?)
        .bind(to_i64(stored.committed_at_epoch_ms)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn insert_grant_frontier(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    frontier: &StoredGrantFrontierV1,
) -> Result<(), OperatorAuthorizationError> {
    sqlx::query(sql(format!(
        "INSERT INTO {} (frontier_identity,resource_digest,sequence,predecessor_frontier_identity,frontier_digest,frontier_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        schema.frontiers
    )))
    .bind(&frontier.frontier_identity)
    .bind(&frontier.resource_digest)
    .bind(to_i64(frontier.sequence)?)
    .bind(&frontier.predecessor_frontier_identity)
    .bind(grant_frontier_digest(schema, frontier)?)
    .bind(json(frontier)?)
    .bind(to_i64(frontier.committed_at_epoch_ms)?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

/// The private relations one grant kind's custody lives in, unqualified.
///
/// Admission derives its expected set from this rather than listing names, so
/// a third grant kind is covered the day it is registered. A list would have
/// to be remembered, and the one place in this repository that kept a list of
/// what a check should cover held six stale entries when it was last read.
pub(crate) fn relation_names_of<C: GrantContentV1>() -> [String; 4] {
    let schema = GrantSchemaV1::of::<C>();
    [
        schema.issuances,
        schema.frontiers,
        schema.heads,
        schema.outbox,
    ]
    .map(|qualified| {
        qualified
            .rsplit_once('.')
            .map_or(qualified.clone(), |(_, relation)| relation.to_string())
    })
}

pub(crate) async fn lock_grant_resource_for_write(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    resource_digest: &str,
) -> Result<(), OperatorAuthorizationError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(schema.advisory_lock_identity(resource_digest))
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn load_grant_resource_digest_hint(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    grant_identity: &str,
) -> Result<Option<String>, OperatorAuthorizationError> {
    sqlx::query_scalar(sql(format!(
        "SELECT resource_digest FROM {} WHERE grant_identity=$1",
        schema.issuances
    )))
    .bind(grant_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)
}

fn verify_grant_issuance_row<C: GrantContentV1>(
    row: &sqlx::postgres::PgRow,
) -> Result<StoredGrantIssuanceV1<C>, OperatorAuthorizationError> {
    let mut mirror = BTreeMap::new();
    for column in C::MIRROR_COLUMNS {
        mirror.insert(
            (*column).to_string(),
            serde_json::Value::String(row.try_get::<String, _>(column).map_err(storage)?),
        );
    }
    verify_locked_grant_issuance_row(LockedGrantIssuanceRowV1 {
        grant_identity: row.try_get("grant_identity").map_err(storage)?,
        issuer_identity: row.try_get("issuer_identity").map_err(storage)?,
        resource_digest: row.try_get("resource_digest").map_err(storage)?,
        semantic_digest: row.try_get("semantic_digest").map_err(storage)?,
        issuance_json: row.try_get("issuance_json").map_err(storage)?,
        receipt_json: row.try_get("receipt_json").map_err(storage)?,
        committed_at_epoch_ms: row.try_get("committed_at_epoch_ms").map_err(storage)?,
        mirror,
    })
}

async fn verify_grant_history<C: GrantContentV1>(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    resource_digest: &str,
    lock: bool,
) -> Result<Option<VerifiedGrantHistoryV1<C>>, OperatorAuthorizationError> {
    let lock_clause = if lock { " FOR UPDATE" } else { "" };
    let issuance_rows = sqlx::query(sql(format!(
        "SELECT * FROM {} WHERE resource_digest=$1 ORDER BY grant_identity{lock_clause}",
        schema.issuances
    )))
    .bind(resource_digest)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if issuance_rows.is_empty() {
        return Ok(None);
    }
    let issuances = order_grant_issuances::<C>(
        issuance_rows
            .iter()
            .map(verify_grant_issuance_row::<C>)
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    let frontier_rows = sqlx::query(sql(format!(
        "SELECT frontier_identity,resource_digest,sequence,predecessor_frontier_identity,frontier_digest,frontier_json,committed_at_epoch_ms FROM {} WHERE resource_digest=$1 ORDER BY sequence,frontier_identity{lock_clause}",
        schema.frontiers
    )))
    .bind(resource_digest)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let mut frontiers = Vec::new();
    for row in frontier_rows {
        frontiers.push(verify_locked_grant_frontier_row::<C>(
            schema,
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
    verify_grant_frontier_chain(schema, &issuances[0], &frontiers)?;
    let head = sqlx::query(sql(format!(
        "SELECT resource_digest,frontier_identity,sequence,frontier_digest,committed_at_epoch_ms FROM {} WHERE resource_digest=$1{lock_clause}",
        schema.heads
    )))
    .bind(resource_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let current = frontiers.last().ok_or_else(|| {
        unavailable_for(Reason::LineageBroken, Subject::Resource, resource_digest)
    })?;

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
            != grant_frontier_digest(schema, current)?
        || from_i64(head.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != current.committed_at_epoch_ms
    {
        return Err(unavailable_for(
            Reason::HeadMismatch,
            Subject::Resource,
            resource_digest,
        ));
    }
    verify_grant_outboxes(transaction, schema, &issuances, &frontiers, lock).await?;
    Ok(Some(VerifiedGrantHistoryV1 {
        resource_digest: resource_digest.to_string(),
        issuances,
        frontiers,
    }))
}

/// Parses the lock function's envelope into non-authoritative evidence.
pub(crate) fn parse_untrusted_grant_envelope<C: GrantContentV1>(
    bytes: &[u8],
    locator: &GrantLocatorV1,
) -> Result<UntrustedCanonicalGrantEvidenceV1<C>, OperatorAuthorizationError> {
    let schema = GrantSchemaV1::of::<C>();
    let envelope: LockedGrantEnvelopeV1 =
        serde_json::from_slice(bytes).map_err(|_| unavailable(Reason::Malformed))?;
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
        return Err(unavailable_for(
            Reason::CustodyDrift,
            Subject::Grant,
            &locator.grant_identity,
        ));
    }
    let issuances = order_grant_issuances::<C>(
        envelope
            .issuances
            .into_iter()
            .map(verify_locked_grant_issuance_row::<C>)
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    let issuance = issuances
        .iter()
        .find(|item| item.proposal.grant_identity == locator.grant_identity)
        .ok_or_else(|| unavailable_for(Reason::Missing, Subject::Grant, &locator.grant_identity))?;
    if grant_receipt(&schema, issuance).receipt_identity != locator.issuance_receipt_identity {
        return Err(unavailable_for(
            Reason::LocatorMismatch,
            Subject::Grant,
            &locator.grant_identity,
        ));
    }
    let frontiers = envelope
        .frontiers
        .into_iter()
        .map(|row| verify_locked_grant_frontier_row::<C>(&schema, row))
        .collect::<Result<Vec<_>, _>>()?;
    verify_grant_frontier_chain(&schema, &issuances[0], &frontiers)?;
    let current = frontiers.last().ok_or_else(|| {
        unavailable_for(
            Reason::LineageBroken,
            Subject::Grant,
            &locator.grant_identity,
        )
    })?;

    if envelope.head.resource_digest != current.resource_digest
        || envelope.head.frontier_identity != current.frontier_identity
        || envelope.head.sequence != to_i64(current.sequence)?
        || envelope.head.frontier_digest != grant_frontier_digest(&schema, current)?
        || from_i64(envelope.head.committed_at_epoch_ms)? != current.committed_at_epoch_ms
    {
        return Err(unavailable_for(
            Reason::HeadMismatch,
            Subject::Resource,
            &current.resource_digest,
        ));
    }
    verify_locked_grant_outboxes(&schema, &issuances, &frontiers, &envelope.outboxes)?;
    Ok(UntrustedCanonicalGrantEvidenceV1 {
        schema_version: C::SCHEMA_VERSION,
        issuance_receipt: grant_receipt(&schema, issuance).into(),
        frontier: current.public(),
        content: issuance.proposal.content.clone(),
    })
}

fn verify_locked_grant_issuance_row<C: GrantContentV1>(
    row: LockedGrantIssuanceRowV1,
) -> Result<StoredGrantIssuanceV1<C>, OperatorAuthorizationError> {
    let stored: StoredGrantIssuanceV1<C> = from_json(row.issuance_json)?;
    stored
        .proposal
        .validate()
        .map_err(|_| unavailable_for(Reason::CustodyDrift, Subject::Grant, &row.grant_identity))?;
    let receipt: StoredGrantReceiptV1 = from_json(row.receipt_json)?;
    let expected_digest = stored_grant_digest(&stored)?;
    let expected_mirror = C::MIRROR_COLUMNS
        .iter()
        .map(|column| (*column).to_string())
        .zip(
            stored
                .proposal
                .content
                .mirror_values()?
                .into_iter()
                .map(serde_json::Value::String),
        )
        .collect::<BTreeMap<_, _>>();
    let schema = GrantSchemaV1::of::<C>();
    if stored.schema_version != C::SCHEMA_VERSION
        || row.grant_identity != stored.proposal.grant_identity
        || row.issuer_identity != stored.proposal.content.issuer_identity()
        || row.mirror != expected_mirror
        || row.resource_digest != stored.proposal.content.resource_digest()?
        || row.semantic_digest != expected_digest
        || stored.issuance_digest != expected_digest
        || receipt != grant_receipt(&schema, &stored)
        || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
    {
        return Err(unavailable_for(
            Reason::CustodyDrift,
            Subject::Grant,
            &row.grant_identity,
        ));
    }
    Ok(stored)
}

fn verify_locked_grant_frontier_row<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    row: LockedGrantFrontierRowV1,
) -> Result<StoredGrantFrontierV1, OperatorAuthorizationError> {
    let frontier: StoredGrantFrontierV1 = from_json(row.frontier_json)?;
    if frontier.schema_version != C::SCHEMA_VERSION
        || row.frontier_identity != frontier.frontier_identity
        || row.resource_digest != frontier.resource_digest
        || row.sequence != to_i64(frontier.sequence)?
        || row.predecessor_frontier_identity != frontier.predecessor_frontier_identity
        || row.frontier_digest != grant_frontier_digest(schema, &frontier)?
        || from_i64(row.committed_at_epoch_ms)? != frontier.committed_at_epoch_ms
    {
        return Err(unavailable_for(
            Reason::CustodyDrift,
            Subject::Frontier,
            &row.frontier_identity,
        ));
    }
    Ok(frontier)
}

fn order_grant_issuances<C: GrantContentV1>(
    mut remaining: Vec<StoredGrantIssuanceV1<C>>,
) -> Result<Vec<StoredGrantIssuanceV1<C>>, OperatorAuthorizationError> {
    if remaining
        .iter()
        .filter(|item| item.predecessor.is_none())
        .count()
        != 1
    {
        return Err(unavailable(Reason::LineageBroken));
    }
    let genesis_index = remaining
        .iter()
        .position(|item| item.predecessor.is_none())
        .ok_or_else(|| unavailable(Reason::LineageBroken))?;
    let genesis = remaining.remove(genesis_index);
    if genesis.proposal.expected_revocation_frontier_identity != "EMPTY"
        || stored_grant_digest(&genesis)? != genesis.issuance_digest
    {
        return Err(unavailable_for(
            Reason::CustodyDrift,
            Subject::Grant,
            &genesis.proposal.grant_identity,
        ));
    }
    let mut ordered = vec![genesis];
    while !remaining.is_empty() {
        let predecessor = ordered
            .last()
            .ok_or_else(|| unavailable(Reason::LineageBroken))?;
        let schema = GrantSchemaV1::of::<C>();
        let locator = GrantLocatorV1 {
            grant_identity: predecessor.proposal.grant_identity.clone(),
            issuance_receipt_identity: grant_receipt(&schema, predecessor).receipt_identity,
        };
        let matches = remaining
            .iter()
            .enumerate()
            .filter(|(_, item)| item.predecessor.as_ref() == Some(&locator))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();

        if matches.len() != 1 {
            return Err(unavailable_for(
                Reason::LineageBroken,
                Subject::Grant,
                &predecessor.proposal.grant_identity,
            ));
        }
        let successor = remaining.remove(matches[0]);
        if !successor
            .proposal
            .content
            .same_resource(&predecessor.proposal.content)
            || successor.proposal.content.issuer_identity()
                != predecessor.proposal.content.issuer_identity()
            || successor.proposal.content.issuer_key_version()
                != predecessor.proposal.content.issuer_key_version()
            || successor.proposal.content.effective_at_epoch_ms()
                < predecessor.proposal.content.effective_at_epoch_ms()
            || successor.proposal.content.valid_through_epoch_ms()
                <= predecessor.proposal.content.valid_through_epoch_ms()
            || successor.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
            || stored_grant_digest(&successor)? != successor.issuance_digest
        {
            return Err(unavailable_for(
                Reason::LineageBroken,
                Subject::Grant,
                &successor.proposal.grant_identity,
            ));
        }
        ordered.push(successor);
    }
    Ok(ordered)
}

fn verify_grant_frontier_chain<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    genesis: &StoredGrantIssuanceV1<C>,
    frontiers: &[StoredGrantFrontierV1],
) -> Result<(), OperatorAuthorizationError> {
    if frontiers.first() != Some(&grant_genesis_frontier(schema, genesis)?) {
        return Err(unavailable_for(
            Reason::LineageBroken,
            Subject::Grant,
            &genesis.proposal.grant_identity,
        ));
    }

    for (index, frontier) in frontiers.iter().enumerate() {
        if frontier.sequence != u64::try_from(index).map_err(storage)?
            || frontier
                .revocations
                .windows(2)
                .any(|pair| pair[0].grant_identity >= pair[1].grant_identity)
        {
            return Err(unavailable_for(
                Reason::CustodyDrift,
                Subject::Frontier,
                &frontier.frontier_identity,
            ));
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
            return Err(unavailable_for(
                Reason::LineageBroken,
                Subject::Frontier,
                &next.frontier_identity,
            ));
        }
    }
    Ok(())
}

fn grant_outbox_record<C: GrantContentV1, T: Serialize>(
    schema: &GrantSchemaV1,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<StoredGrantOutboxV1, OperatorAuthorizationError> {
    let payload_digest = canonical_digest(&schema.outbox_payload_domain, payload)?;
    Ok(StoredGrantOutboxV1 {
        schema_version: C::SCHEMA_VERSION,
        event_identity: identity(
            &schema.owner_event_domain,
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

async fn insert_grant_outbox<C: GrantContentV1, T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), OperatorAuthorizationError> {
    let record = grant_outbox_record::<C, T>(schema, seed, aggregate, kind, payload, committed_at)?;
    sqlx::query(sql(format!(
        "INSERT INTO {} (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)",
        schema.outbox
    )))
    .bind(&record.event_identity)
    .bind(&record.aggregate_identity)
    .bind(&record.event_kind)
    .bind(&record.payload_digest)
    .bind(json(&record)?)
    .bind(to_i64(committed_at)?)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

fn verify_grant_outbox_row<C: GrantContentV1, T: Serialize>(
    schema: &GrantSchemaV1,
    row: &LockedGrantOutboxRowV1,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), OperatorAuthorizationError> {
    let expected =
        grant_outbox_record::<C, T>(schema, seed, aggregate, kind, payload, committed_at)?;
    let stored: StoredGrantOutboxV1 = from_json(row.payload_json.clone())?;
    if stored != expected
        || row.event_identity != expected.event_identity
        || row.aggregate_identity != expected.aggregate_identity
        || row.event_kind != expected.event_kind
        || row.payload_digest != expected.payload_digest
        || from_i64(row.committed_at_epoch_ms)? != expected.committed_at_epoch_ms
    {
        return Err(unavailable_for(
            Reason::CustodyDrift,
            Subject::Outbox,
            &row.aggregate_identity,
        ));
    }
    Ok(())
}

async fn verify_grant_outboxes<C: GrantContentV1>(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    issuances: &[StoredGrantIssuanceV1<C>],
    frontiers: &[StoredGrantFrontierV1],
    lock: bool,
) -> Result<(), OperatorAuthorizationError> {
    for issuance in issuances {
        let receipt = grant_receipt(schema, issuance);
        let rows =
            load_grant_outbox_rows(transaction, schema, &issuance.proposal.grant_identity, lock)
                .await?;

        if rows.len() != 1 {
            return Err(unavailable_for(
                if rows.is_empty() {
                    Reason::Missing
                } else {
                    Reason::Ambiguous
                },
                Subject::Outbox,
                &issuance.proposal.grant_identity,
            ));
        }
        verify_grant_outbox_row::<C, _>(
            schema,
            &rows[0],
            &receipt.receipt_identity,
            &issuance.proposal.grant_identity,
            &schema.issued_event,
            &receipt,
            issuance.committed_at_epoch_ms,
        )?;
    }

    for frontier in frontiers {
        let rows =
            load_grant_outbox_rows(transaction, schema, &frontier.frontier_identity, lock).await?;

        if rows.len() != 1 {
            return Err(unavailable_for(
                if rows.is_empty() {
                    Reason::Missing
                } else {
                    Reason::Ambiguous
                },
                Subject::Outbox,
                &frontier.frontier_identity,
            ));
        }
        verify_grant_outbox_row::<C, _>(
            schema,
            &rows[0],
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            &schema.frontier_event,
            frontier,
            frontier.committed_at_epoch_ms,
        )?;
    }
    Ok(())
}

fn verify_locked_grant_outboxes<C: GrantContentV1>(
    schema: &GrantSchemaV1,
    issuances: &[StoredGrantIssuanceV1<C>],
    frontiers: &[StoredGrantFrontierV1],
    rows: &[LockedGrantOutboxRowV1],
) -> Result<(), OperatorAuthorizationError> {
    if rows.len() != issuances.len().saturating_add(frontiers.len()) {
        return Err(unavailable(Reason::CustodyDrift));
    }

    for issuance in issuances {
        let receipt = grant_receipt(schema, issuance);
        let matches = rows
            .iter()
            .filter(|row| row.aggregate_identity == issuance.proposal.grant_identity)
            .collect::<Vec<_>>();

        if matches.len() != 1 {
            return Err(unavailable_for(
                if matches.is_empty() {
                    Reason::Missing
                } else {
                    Reason::Ambiguous
                },
                Subject::Outbox,
                &issuance.proposal.grant_identity,
            ));
        }
        verify_grant_outbox_row::<C, _>(
            schema,
            matches[0],
            &receipt.receipt_identity,
            &issuance.proposal.grant_identity,
            &schema.issued_event,
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
            return Err(unavailable_for(
                if matches.is_empty() {
                    Reason::Missing
                } else {
                    Reason::Ambiguous
                },
                Subject::Outbox,
                &frontier.frontier_identity,
            ));
        }
        verify_grant_outbox_row::<C, _>(
            schema,
            matches[0],
            &frontier.frontier_identity,
            &frontier.frontier_identity,
            &schema.frontier_event,
            frontier,
            frontier.committed_at_epoch_ms,
        )?;
    }
    Ok(())
}

async fn load_grant_outbox_rows(
    transaction: &mut Transaction<'_, Postgres>,
    schema: &GrantSchemaV1,
    aggregate_identity: &str,
    lock: bool,
) -> Result<Vec<LockedGrantOutboxRowV1>, OperatorAuthorizationError> {
    let lock_clause = if lock { " FOR SHARE" } else { "" };
    sqlx::query(sql(format!(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM {} WHERE aggregate_identity=$1{lock_clause}",
        schema.outbox
    )))
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

#[cfg(test)]
pub(crate) mod fixtures {
    //! Envelope builders shared by every kind's parser tests.
    use super::*;

    pub(crate) fn issuance_row<C: GrantContentV1>(
        stored: &StoredGrantIssuanceV1<C>,
    ) -> LockedGrantIssuanceRowV1 {
        let schema = GrantSchemaV1::of::<C>();
        LockedGrantIssuanceRowV1 {
            grant_identity: stored.proposal.grant_identity.clone(),
            issuer_identity: stored.proposal.content.issuer_identity().to_string(),
            resource_digest: stored.proposal.content.resource_digest().unwrap(),
            semantic_digest: stored_grant_digest(stored).unwrap(),
            issuance_json: serde_json::to_value(stored).unwrap(),
            receipt_json: serde_json::to_value(grant_receipt(&schema, stored)).unwrap(),
            committed_at_epoch_ms: to_i64(stored.committed_at_epoch_ms).unwrap(),
            mirror: C::MIRROR_COLUMNS
                .iter()
                .map(|column| (*column).to_string())
                .zip(
                    stored
                        .proposal
                        .content
                        .mirror_values()
                        .unwrap()
                        .into_iter()
                        .map(serde_json::Value::String),
                )
                .collect(),
        }
    }

    pub(crate) fn frontier_row(
        schema: &GrantSchemaV1,
        frontier: &StoredGrantFrontierV1,
    ) -> LockedGrantFrontierRowV1 {
        LockedGrantFrontierRowV1 {
            frontier_identity: frontier.frontier_identity.clone(),
            resource_digest: frontier.resource_digest.clone(),
            sequence: to_i64(frontier.sequence).unwrap(),
            predecessor_frontier_identity: frontier.predecessor_frontier_identity.clone(),
            frontier_digest: grant_frontier_digest(schema, frontier).unwrap(),
            frontier_json: serde_json::to_value(frontier).unwrap(),
            committed_at_epoch_ms: to_i64(frontier.committed_at_epoch_ms).unwrap(),
        }
    }

    pub(crate) fn outbox_row<C: GrantContentV1>(
        schema: &GrantSchemaV1,
        seed: &str,
        aggregate: &str,
        kind: &str,
        payload: &impl Serialize,
        committed_at: u64,
    ) -> LockedGrantOutboxRowV1 {
        let record =
            grant_outbox_record::<C, _>(schema, seed, aggregate, kind, payload, committed_at)
                .unwrap();
        LockedGrantOutboxRowV1 {
            event_identity: record.event_identity.clone(),
            aggregate_identity: record.aggregate_identity.clone(),
            event_kind: record.event_kind.clone(),
            payload_digest: record.payload_digest.clone(),
            payload_json: serde_json::to_value(record).unwrap(),
            committed_at_epoch_ms: to_i64(committed_at).unwrap(),
        }
    }

    /// A two-issuance, two-frontier history for `content` with the genesis
    /// grant revoked. Returns the envelope, the genesis and successor locators,
    /// the successor content and the current frontier identity.
    pub(crate) fn canonical_envelope<C: GrantContentV1>(
        content: C,
        successor_content: C,
    ) -> (serde_json::Value, GrantLocatorV1, GrantLocatorV1, C, String) {
        let schema = GrantSchemaV1::of::<C>();
        let genesis_proposal = GrantIssuanceProposalV1 {
            grant_identity: content.grant_identity().unwrap(),
            content,
            expected_revocation_frontier_identity: "EMPTY".into(),
        };
        let genesis = StoredGrantIssuanceV1 {
            schema_version: C::SCHEMA_VERSION,
            issuance_digest: genesis_proposal.semantic_digest().unwrap(),
            proposal: genesis_proposal,
            predecessor: None,
            committed_at_epoch_ms: 100,
        };
        let genesis_locator = GrantLocatorV1 {
            grant_identity: genesis.proposal.grant_identity.clone(),
            issuance_receipt_identity: grant_receipt(&schema, &genesis).receipt_identity,
        };
        let genesis_frontier = grant_genesis_frontier(&schema, &genesis).unwrap();
        let successor_proposal = GrantIssuanceProposalV1 {
            grant_identity: successor_content.grant_identity().unwrap(),
            content: successor_content.clone(),
            expected_revocation_frontier_identity: genesis_frontier.frontier_identity.clone(),
        };
        let mut successor = StoredGrantIssuanceV1 {
            schema_version: C::SCHEMA_VERSION,
            proposal: successor_proposal,
            predecessor: Some(genesis_locator.clone()),
            issuance_digest: String::new(),
            committed_at_epoch_ms: 110,
        };
        successor.issuance_digest = stored_grant_digest(&successor).unwrap();
        let successor_locator = GrantLocatorV1 {
            grant_identity: successor.proposal.grant_identity.clone(),
            issuance_receipt_identity: grant_receipt(&schema, &successor).receipt_identity,
        };

        let revocations = vec![StoredGrantRevocationV1 {
            grant_identity: genesis_locator.grant_identity.clone(),
            reason_code: "ADMIN_REVOKED".into(),
        }];
        let current_frontier = StoredGrantFrontierV1 {
            schema_version: C::SCHEMA_VERSION,
            frontier_identity: identity(
                &schema.frontier_identity_domain,
                &[
                    &genesis_frontier.resource_digest,
                    &genesis_frontier.frontier_identity,
                    &canonical_digest(&schema.revocations_domain, &revocations).unwrap(),
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
            frontier_row(&schema, &genesis_frontier),
            frontier_row(&schema, &current_frontier),
        ];
        let mut outboxes = vec![
            outbox_row::<C>(
                &schema,
                &genesis_locator.issuance_receipt_identity,
                &genesis_locator.grant_identity,
                &schema.issued_event,
                &grant_receipt(&schema, &genesis),
                genesis.committed_at_epoch_ms,
            ),
            outbox_row::<C>(
                &schema,
                &successor_locator.issuance_receipt_identity,
                &successor_locator.grant_identity,
                &schema.issued_event,
                &grant_receipt(&schema, &successor),
                successor.committed_at_epoch_ms,
            ),
            outbox_row::<C>(
                &schema,
                &genesis_frontier.frontier_identity,
                &genesis_frontier.frontier_identity,
                &schema.frontier_event,
                &genesis_frontier,
                genesis_frontier.committed_at_epoch_ms,
            ),
            outbox_row::<C>(
                &schema,
                &current_frontier.frontier_identity,
                &current_frontier.frontier_identity,
                &schema.frontier_event,
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
                frontier_digest: grant_frontier_digest(&schema, &current_frontier).unwrap(),
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
}
