//! Private PostgreSQL authority for the R&D Replay Policy Catalog.

use std::fmt::Display;

use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
};

use crate::{
    replay_execution_policy_v2::ReplayExecutionPolicyV2,
    replay_policy_catalog_v2::{ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2},
    trial_family::TrialFamilyPolicyV1,
};

const CATALOG_ADMIN_LOCK_V2: i64 = 7_246_450_332_882_419_842;
const RD_OWNER_IDENTITY_V2: &str = "vibe-strategy-factory/rd-owner";
const CREATE_EVENT_V2: &str = "REPLAY_POLICY_CATALOG_CREATED_V2";
const APPEND_EVENT_V2: &str = "REPLAY_POLICY_CATALOG_VERSION_APPENDED_V2";
const ADVANCE_EVENT_V2: &str = "REPLAY_POLICY_CATALOG_HEAD_ADVANCED_V2";
const REVOKE_EVENT_V2: &str = "REPLAY_POLICY_CATALOG_VERSION_REVOKED_V2";
const AUTHORITY_MIGRATION_SQL: &str =
    include_str!("../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh");

const CATALOG_TABLES_V2: [&str; 4] = [
    "rd_replay_policy_catalog_records_v2",
    "rd_replay_policy_catalog_head_v2",
    "rd_replay_policy_catalog_revocations_v2",
    "rd_replay_policy_catalog_audit_v2",
];

const CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL: &str = "SELECT count(*)=4 AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
        WHERE namespace.nspname='replay_policy_catalog_private'
          AND relation.relname=ANY($1)
          AND relation.relkind='r'
          AND attribute.attnum>0
          AND NOT attribute.attisdropped
          AND acl.grantee<>relation.relowner
     )
       FROM pg_catalog.pg_class relation
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='replay_policy_catalog_private'
        AND relation.relname=ANY($1)
        AND relation.relkind='r'";
const CATALOG_EXTERNAL_REWRITE_DEPENDENCIES_ABSENT_SQL: &str = "WITH family AS (
       SELECT relation.oid
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='replay_policy_catalog_private'
          AND relation.relname=ANY($1)
     )
     SELECT NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_depend dependency
         JOIN pg_catalog.pg_rewrite rewrite_fact
           ON dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass
          AND dependency.objid=rewrite_fact.oid
        WHERE dependency.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency.refobjid IN (SELECT oid FROM family)
          AND rewrite_fact.ev_class NOT IN (SELECT oid FROM family)
     )";

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ReplayPolicyCatalogErrorV2> {
    migrate_and_verify(pool, false).await
}

pub(crate) async fn migrate_with_legacy_migration_lease(
    pool: &PgPool,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    migrate_and_verify(pool, true).await
}

async fn migrate_and_verify(
    pool: &PgPool,
    legacy_migration_lease: bool,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    verify_catalog_storage_authority_for_migration(pool, legacy_migration_lease).await
}

/// Proof carried only inside the private R&D administration boundary.
pub(crate) struct AuthenticatedCatalogAdministratorV2 {
    identity: String,
    authentication_fact_digest: String,
}

impl AuthenticatedCatalogAdministratorV2 {
    #[cfg(any(test, feature = "sealed-develop-composer-acceptance"))]
    pub(crate) fn admit(
        identity: &str,
        authentication_fact_digest: &str,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        require_identity(identity, "administrator identity")?;
        require_sha256(
            authentication_fact_digest,
            "administrator authentication fact",
        )?;
        Ok(Self {
            identity: identity.to_owned(),
            authentication_fact_digest: authentication_fact_digest.to_owned(),
        })
    }
}

/// Installs the one fixed Catalog fact used by the compile-time sealed acceptance composition.
#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(crate) async fn ensure_sealed_acceptance_fixture(
    pool: &PgPool,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    const RECORD_ID: &str = "sealed-acceptance-replay-policy-v2";

    verify_catalog_storage_authority(pool).await?;
    let policy = sealed_acceptance_policy()?;
    let expected = ReplayPolicyCatalogBindingV2::from_policy(RECORD_ID, 1, &policy)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;

    match current_head(&mut transaction).await? {
        None => {
            let administrator = AuthenticatedCatalogAdministratorV2::admit(
                "sealed-acceptance-catalog-administrator-v2",
                &format!("sha256:{}", "a".repeat(64)),
            )?;
            let created = ReplayPolicyCatalogAdministrationPortV2::create_policy(
                &mut transaction,
                &administrator,
                "sealed-acceptance-catalog-create-v2",
                RECORD_ID,
                &policy,
                1,
            )
            .await?;
            ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
                &mut transaction,
                &administrator,
                "sealed-acceptance-catalog-head-v2",
                None,
                created.catalog_record_id(),
                2,
            )
            .await?;
        }
        Some((record_id, version)) if record_id == RECORD_ID && version == 1 => {
            if load_record_by_id(&mut transaction, RECORD_ID).await? != expected
                || is_revoked(&mut transaction, RECORD_ID).await?
            {
                return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                    "sealed acceptance Catalog fixture mismatch".to_owned(),
                ));
            }
        }
        Some(_) => {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "sealed acceptance Catalog head mismatch".to_owned(),
            ));
        }
    }

    transaction.commit().await.map_err(unavailable)
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn sealed_acceptance_policy() -> Result<ReplayExecutionPolicyV2, ReplayPolicyCatalogErrorV2> {
    fn opaque(value: &str) -> Result<OpaqueIdentityV2, ReplayPolicyCatalogErrorV2> {
        OpaqueIdentityV2::try_from(value.to_owned())
            .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))
    }
    fn versioned(value: &str) -> Result<VersionedIdentityV2, ReplayPolicyCatalogErrorV2> {
        Ok(VersionedIdentityV2 {
            identity: opaque(value)?,
            version: opaque("v1")?,
        })
    }
    fn content(value: &str) -> Result<ContentIdentityV2, ReplayPolicyCatalogErrorV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(value)?,
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", "b".repeat(64)))
                .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?,
        })
    }

    Ok(ReplayExecutionPolicyV2 {
        runtime_kernel: versioned("runtime-kernel-v2")?,
        simulator: versioned("simulator-v2")?,
        cost: versioned("cost-model-v1")?,
        slippage: versioned("slippage-model-v1")?,
        capacity: versioned("capacity-model-v1")?,
        runner_operational_profile: versioned("runner-profile-v2")?,
        diagnostic_policy: versioned("diagnostic-policy-v2")?,
        deterministic_seed: 1,
        window: ReplayWindowV2 {
            start_event_ns: 1,
            end_event_ns_exclusive: 2,
        },
        calendar: versioned("calendar-v2")?,
        session: versioned("session-v2")?,
        time_zone: versioned("time-zone-v2")?,
        correction_rule: versioned("correction-rule-v2")?,
        market_semantics: versioned("market-semantics-v2")?,
        replay_configuration: content("replay-configuration-v2")?,
        corporate_action_cut: content("corporate-action-cut-v2")?,
        historical_membership_cut: content("historical-membership-cut-v2")?,
    })
}

/// Sole private writer for Catalog records, head, revocations, audit, and outbox.
pub(crate) struct ReplayPolicyCatalogAdministrationPortV2;

impl ReplayPolicyCatalogAdministrationPortV2 {
    pub(crate) async fn create_policy(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        catalog_record_id: &str,
        policy: &ReplayExecutionPolicyV2,
        now_epoch_ms: u64,
    ) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;

        if load_record_by_id(transaction, "").await.is_ok() {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let record = ReplayPolicyCatalogBindingV2::from_policy(catalog_record_id, 1, policy)?;
        apply_admin_fact(
            transaction,
            administrator,
            "create",
            command_identity,
            CREATE_EVENT_V2,
            &record,
            None,
            None,
            now_epoch_ms,
        )
        .await?;

        if load_record_by_id(transaction, record.catalog_record_id()).await? != record {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog create readback mismatch".to_owned(),
            ));
        }
        Ok(record)
    }

    pub(crate) async fn append_version(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        expected_predecessor_record_id: &str,
        catalog_record_id: &str,
        policy: &ReplayExecutionPolicyV2,
        now_epoch_ms: u64,
    ) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let latest = load_record_by_id(transaction, "").await?;
        let predecessor = latest.catalog_record_id().to_owned();
        let predecessor_version = latest.catalog_version();

        if predecessor != expected_predecessor_record_id {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let version =
            predecessor_version
                .checked_add(1)
                .ok_or(ReplayPolicyCatalogErrorV2::InvalidRecord(
                    "catalog version overflow",
                ))?;
        let record = ReplayPolicyCatalogBindingV2::from_policy(catalog_record_id, version, policy)?;
        let predecessor_head = current_head_id(transaction).await?;
        apply_admin_fact(
            transaction,
            administrator,
            "append",
            command_identity,
            APPEND_EVENT_V2,
            &record,
            Some(&predecessor),
            predecessor_head.as_deref(),
            now_epoch_ms,
        )
        .await?;

        if load_record_by_id(transaction, record.catalog_record_id()).await? != record {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog append readback mismatch".to_owned(),
            ));
        }
        Ok(record)
    }

    pub(crate) async fn advance_current_head(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        expected_head_record_id: Option<&str>,
        target_record_id: &str,
        now_epoch_ms: u64,
    ) -> Result<(), ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let current = current_head(transaction).await?;
        if current.as_ref().map(|head| head.0.as_str()) != expected_head_record_id {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let target = load_record_by_id(transaction, target_record_id).await?;
        if is_revoked(transaction, target_record_id).await?
            || current
                .as_ref()
                .is_some_and(|head| target.catalog_version() <= head.1)
        {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        apply_admin_fact(
            transaction,
            administrator,
            "advance",
            command_identity,
            ADVANCE_EVENT_V2,
            &target,
            None,
            current.as_ref().map(|head| head.0.as_str()),
            now_epoch_ms,
        )
        .await?;

        if current_head(transaction).await?.as_ref()
            != Some(&(
                target.catalog_record_id().to_owned(),
                target.catalog_version(),
            ))
        {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog head readback mismatch".to_owned(),
            ));
        }
        Ok(())
    }

    pub(crate) async fn revoke_version(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        catalog_record_id: &str,
        now_epoch_ms: u64,
    ) -> Result<(), ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let record = load_record_by_id(transaction, catalog_record_id).await?;
        if is_revoked(transaction, catalog_record_id).await? {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let head = current_head_id(transaction).await?;
        apply_admin_fact(
            transaction,
            administrator,
            "revoke",
            command_identity,
            REVOKE_EVENT_V2,
            &record,
            None,
            head.as_deref(),
            now_epoch_ms,
        )
        .await?;

        if !is_revoked(transaction, record.catalog_record_id()).await? {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog revocation readback mismatch".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Locks and validates the exact current unrevoked Catalog fact on the caller's transaction.
pub(crate) async fn resolve_current_for_trial_family_formation(
    transaction: &mut Transaction<'_, Postgres>,
    family_policy: &TrialFamilyPolicyV1,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    lock_catalog(transaction).await?;
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;

    if rows.len() != 1 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "current Catalog head is missing".to_owned(),
        ));
    }
    let row = &rows[0];
    if row.try_get::<bool, _>("revoked").map_err(unavailable)? {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "current Catalog head is revoked".to_owned(),
        ));
    }
    let record = decode_record(row)?;
    let head_record_id: String = row.try_get("head_record_id").map_err(unavailable)?;
    let head_version = decimal_version(row.try_get("head_version").map_err(unavailable)?)?;
    if head_record_id != record.catalog_record_id() || head_version != record.catalog_version() {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog head cross-binding mismatch".to_owned(),
        ));
    }
    let replay_policy = record.verify()?;
    if replay_policy.cost.identity.as_str() != family_policy.cost_model_identity
        || replay_policy.slippage.identity.as_str() != family_policy.slippage_model_identity
        || replay_policy.capacity.identity.as_str() != family_policy.capacity_model_identity
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog policy model profile does not match TrialFamily policy".to_owned(),
        ));
    }
    Ok(record)
}

async fn load_record_by_id(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_replay_policy_catalog_record_v2($1)",
    )
    .bind(catalog_record_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;

    if rows.len() != 1 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog record is missing".to_owned(),
        ));
    }
    decode_record(&rows[0])
}

fn decode_record(
    row: &sqlx::postgres::PgRow,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    let catalog_record_id: String = row.try_get("catalog_record_id").map_err(unavailable)?;
    let catalog_version = decimal_version(row.try_get("catalog_version").map_err(unavailable)?)?;
    let owner_identity: String = row.try_get("owner_identity").map_err(unavailable)?;
    if owner_identity != RD_OWNER_IDENTITY_V2 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog record owner identity mismatch".to_owned(),
        ));
    }
    let grammar_id: String = row
        .try_get("policy_grammar_parser_id")
        .map_err(unavailable)?;
    let grammar_digest: Vec<u8> = row
        .try_get("policy_grammar_parser_digest")
        .map_err(unavailable)?;
    let policy_bytes: Vec<u8> = row.try_get("policy_canonical_bytes").map_err(unavailable)?;
    let policy_digest: Vec<u8> = row.try_get("policy_digest").map_err(unavailable)?;
    let record_digest: Vec<u8> = row.try_get("catalog_record_digest").map_err(unavailable)?;
    let binding = ReplayPolicyCatalogBindingV2::from_canonical_bytes(
        &catalog_record_id,
        catalog_version,
        &grammar_id,
        digest_array(grammar_digest, "grammar/parser digest")?,
        policy_bytes,
    )?;

    if binding.policy_digest().as_slice() != policy_digest
        || binding.catalog_record_digest().as_slice() != record_digest
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog relational/content digest mismatch".to_owned(),
        ));
    }
    Ok(binding)
}

async fn current_head(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<(String, u64)>, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query("SELECT catalog_record_id, catalog_version FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()")
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;

    match rows.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some((
            row.try_get("catalog_record_id").map_err(unavailable)?,
            decimal_version(row.try_get("catalog_version").map_err(unavailable)?)?,
        ))),
        _ => Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog has multiple current heads".to_owned(),
        )),
    }
}

async fn current_head_id(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<String>, ReplayPolicyCatalogErrorV2> {
    Ok(current_head(transaction).await?.map(|head| head.0))
}

async fn is_revoked(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<bool, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT revoked FROM replay_policy_catalog_api.lock_replay_policy_catalog_record_v2($1)",
    )
    .bind(catalog_record_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;
    rows.as_slice()
        .first()
        .ok_or_else(|| {
            ReplayPolicyCatalogErrorV2::Unavailable("Catalog record is missing".to_owned())
        })?
        .try_get("revoked")
        .map_err(unavailable)
}

#[allow(clippy::too_many_arguments)]
async fn apply_admin_fact(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    action: &str,
    command_identity: &str,
    command_kind: &str,
    record: &ReplayPolicyCatalogBindingV2,
    predecessor_record_id: Option<&str>,
    predecessor_head_record_id: Option<&str>,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let writer_session: bool = sqlx::query_scalar("SELECT SESSION_USER='rd_fact_writer'")
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)?;

    if !writer_session {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog mutation requires the R&D fact writer".to_owned(),
        ));
    }
    let content_identity = content_identity(record);
    let audit = CatalogAdminAuditV2 {
        schema_version: 2,
        command_identity: command_identity.to_owned(),
        administrator_identity: administrator.identity.clone(),
        authentication_fact_digest: administrator.authentication_fact_digest.clone(),
        command_kind: command_kind.to_owned(),
        predecessor_record_id: predecessor_record_id.map(str::to_owned),
        predecessor_head_record_id: predecessor_head_record_id.map(str::to_owned),
        result_record_id: Some(record.catalog_record_id().to_owned()),
        content_identity: content_identity.clone(),
        committed_at_epoch_ms: now_epoch_ms,
    };
    let audit_json = serde_json::to_value(&audit).map_err(unavailable)?;
    let payload_digest = canonical_json_digest("rd.replay-policy-catalog.audit.v2", &audit)?;
    let accepted: bool = sqlx::query_scalar("SELECT replay_policy_catalog_api.apply_replay_policy_catalog_command_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(action)
        .bind(command_identity)
        .bind(&administrator.identity)
        .bind(&administrator.authentication_fact_digest)
        .bind(record.catalog_record_id())
        .bind(Decimal::from(record.catalog_version()))
        .bind(predecessor_record_id)
        .bind(record.policy_grammar_parser_id())
        .bind(record.policy_grammar_parser_digest().as_slice())
        .bind(record.policy_canonical_bytes())
        .bind(record.policy_digest().as_slice())
        .bind(record.catalog_record_digest().as_slice())
        .bind(predecessor_head_record_id.unwrap_or(""))
        .bind(&content_identity)
        .bind(&audit_json)
        .bind(format!("rd-replay-policy-catalog-outbox-v2-{}", &payload_digest[7..]))
        .bind(payload_digest)
        .bind(epoch_i64(now_epoch_ms)?)
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)?;

    if accepted {
        Ok(())
    } else {
        Err(ReplayPolicyCatalogErrorV2::Conflict)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CatalogAdminAuditV2 {
    schema_version: u16,
    command_identity: String,
    administrator_identity: String,
    authentication_fact_digest: String,
    command_kind: String,
    predecessor_record_id: Option<String>,
    predecessor_head_record_id: Option<String>,
    result_record_id: Option<String>,
    content_identity: String,
    committed_at_epoch_ms: u64,
}

async fn verify_catalog_storage_authority(pool: &PgPool) -> Result<(), ReplayPolicyCatalogErrorV2> {
    verify_catalog_storage_authority_for_migration(pool, false).await
}

async fn verify_catalog_storage_authority_for_migration(
    pool: &PgPool,
    legacy_migration_lease: bool,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let authority_is_exact: bool = sqlx::query_scalar(
        "WITH owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='replay_policy_catalog_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls), callers AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('rd_owner','rd_fact_writer')), relations AS (SELECT relation.oid, relation.relowner, relation.relacl FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND relation.relkind='r'), routines AS (SELECT procedure.proname,procedure.proowner,procedure.prosecdef,procedure.provolatile,procedure.proparallel,procedure.proconfig,procedure.proacl FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname IN ('lock_replay_policy_catalog_record_v2','lock_current_replay_policy_catalog_v2','apply_replay_policy_catalog_command_v2')), catalog_memberships AS (SELECT membership.roleid FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer') OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')), lease_memberships AS (SELECT membership.*,granted.rolname AS granted_role,member.rolname AS member_role,grantor.rolname AS grantor_role FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor WHERE granted.rolname IN ('rd_custodian','replay_policy_catalog_owner','rd_owner','rd_fact_writer') OR member.rolname IN ('rd_custodian','replay_policy_catalog_owner','rd_owner','rd_fact_writer')) SELECT SESSION_USER IN ('rd_owner','rd_fact_writer') AND (NOT $2 OR SESSION_USER='rd_owner') AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_fact_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND (SELECT count(*)=4 AND bool_and(relowner=(SELECT oid FROM owner)) AND NOT bool_or(EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl WHERE acl.grantee<>relowner)) FROM relations) AND (SELECT count(*)=3 AND bool_and(proowner=(SELECT oid FROM owner) AND prosecdef AND provolatile='v' AND proparallel='u' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND (SELECT pg_catalog.array_agg(pg_catalog.pg_get_userbyid(acl.grantee)||':'||acl.privilege_type||':'||acl.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(acl.grantee),acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl) IS NOT DISTINCT FROM CASE proname WHEN 'apply_replay_policy_catalog_command_v2' THEN ARRAY['rd_fact_writer:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[] ELSE ARRAY['rd_fact_writer:EXECUTE:false','rd_owner:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[] END) FROM routines) AND NOT EXISTS (SELECT 1 FROM callers WHERE pg_catalog.pg_has_role(callers.oid,(SELECT oid FROM owner),'MEMBER') OR pg_catalog.pg_has_role((SELECT oid FROM owner),callers.oid,'MEMBER')) AND (($2 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_custodian' AND NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND (SELECT count(*)=1 AND bool_and(granted_role='rd_custodian' AND member_role='rd_owner' AND grantor_role='postgres' AND NOT admin_option AND inherit_option AND set_option) FROM lease_memberships)) OR (NOT $2 AND NOT EXISTS(SELECT 1 FROM catalog_memberships)))",
    )
    .bind(CATALOG_TABLES_V2.as_slice())
    .bind(legacy_migration_lease)
    .fetch_one(pool)
    .await
    .map_err(unavailable)?;

    if !authority_is_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog PostgreSQL owner or ACL readback mismatch".to_owned(),
        ));
    }
    let column_acl_is_owner_only: bool = sqlx::query_scalar(CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL)
        .bind(CATALOG_TABLES_V2.as_slice())
        .fetch_one(pool)
        .await
        .map_err(unavailable)?;

    if !column_acl_is_owner_only {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog PostgreSQL column ACL readback mismatch".to_owned(),
        ));
    }
    let column_shape = sqlx::query_scalar::<_, String>("SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||attribute.attnotnull||':'||COALESCE(pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),'') FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=relation.oid AND default_fact.adnum=attribute.attnum WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) ORDER BY relation.relname,attribute.attnum")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_all(pool).await.map_err(unavailable)?;
    let expected_column_shape = [
        "rd_replay_policy_catalog_audit_v2:1:command_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:2:administrator_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:3:authentication_fact_digest:text:true:",
        "rd_replay_policy_catalog_audit_v2:4:command_kind:text:true:",
        "rd_replay_policy_catalog_audit_v2:5:predecessor_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:6:predecessor_head_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:7:result_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:8:content_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:9:audit_json:jsonb:true:",
        "rd_replay_policy_catalog_audit_v2:10:committed_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_head_v2:1:singleton:boolean:true:true",
        "rd_replay_policy_catalog_head_v2:2:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_head_v2:3:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_head_v2:4:advanced_by:text:true:",
        "rd_replay_policy_catalog_head_v2:5:advanced_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_records_v2:1:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_records_v2:2:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_records_v2:3:owner_identity:text:true:",
        "rd_replay_policy_catalog_records_v2:4:predecessor_record_id:text:false:",
        "rd_replay_policy_catalog_records_v2:5:policy_grammar_parser_id:text:true:",
        "rd_replay_policy_catalog_records_v2:6:policy_grammar_parser_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:7:policy_canonical_bytes:bytea:true:",
        "rd_replay_policy_catalog_records_v2:8:policy_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:9:catalog_record_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:10:created_by:text:true:",
        "rd_replay_policy_catalog_records_v2:11:created_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_revocations_v2:1:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_revocations_v2:2:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_revocations_v2:3:revoked_by:text:true:",
        "rd_replay_policy_catalog_revocations_v2:4:revoked_at_epoch_ms:bigint:true:",
    ];

    if column_shape
        .iter()
        .map(String::as_str)
        .ne(expected_column_shape)
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog column shape readback mismatch".to_owned(),
        ));
    }
    let dependency_shape_is_exact: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1)) SELECT (SELECT count(*)=10 AND NOT bool_or((family.relname,constraint_fact.contype::text,constraint_fact.conkey) NOT IN (VALUES ('rd_replay_policy_catalog_records_v2','p',ARRAY[1]::smallint[]),('rd_replay_policy_catalog_records_v2','u',ARRAY[2]::smallint[]),('rd_replay_policy_catalog_records_v2','u',ARRAY[4]::smallint[]),('rd_replay_policy_catalog_records_v2','u',ARRAY[9]::smallint[]),('rd_replay_policy_catalog_head_v2','p',ARRAY[1]::smallint[]),('rd_replay_policy_catalog_head_v2','u',ARRAY[2]::smallint[]),('rd_replay_policy_catalog_head_v2','u',ARRAY[3]::smallint[]),('rd_replay_policy_catalog_revocations_v2','p',ARRAY[1]::smallint[]),('rd_replay_policy_catalog_revocations_v2','u',ARRAY[2]::smallint[]),('rd_replay_policy_catalog_audit_v2','p',ARRAY[1]::smallint[]))) FROM pg_catalog.pg_constraint constraint_fact JOIN family ON family.oid=constraint_fact.conrelid WHERE constraint_fact.contype IN ('p','u')) AND (SELECT count(*)=3 AND NOT bool_or((source.relname,constraint_fact.conkey,target.relname,constraint_fact.confkey) NOT IN (VALUES ('rd_replay_policy_catalog_records_v2',ARRAY[4]::smallint[],'rd_replay_policy_catalog_records_v2',ARRAY[1]::smallint[]),('rd_replay_policy_catalog_head_v2',ARRAY[2]::smallint[],'rd_replay_policy_catalog_records_v2',ARRAY[1]::smallint[]),('rd_replay_policy_catalog_revocations_v2',ARRAY[1]::smallint[],'rd_replay_policy_catalog_records_v2',ARRAY[1]::smallint[]))) FROM pg_catalog.pg_constraint constraint_fact JOIN family source ON source.oid=constraint_fact.conrelid JOIN family target ON target.oid=constraint_fact.confrelid WHERE constraint_fact.contype='f') AND (SELECT count(*)=5 AND bool_and(pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid) IN ('singleton','(octet_length(policy_grammar_parser_digest) = 32)','(octet_length(policy_digest) = 32)','(octet_length(catalog_record_digest) = 32)','((catalog_version > (0)::numeric) AND (catalog_version <= ''18446744073709551615''::numeric))')) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid IN (SELECT oid FROM family) AND constraint_fact.contype='c') AND (SELECT count(*)=10 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint inbound WHERE inbound.confrelid IN (SELECT oid FROM family) AND inbound.conrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint outbound WHERE outbound.conrelid IN (SELECT oid FROM family) AND outbound.contype='f' AND outbound.confrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family))")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !dependency_shape_is_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog constraint or dependency readback mismatch".to_owned(),
        ));
    }
    let external_rewrite_dependencies_absent: bool =
        sqlx::query_scalar(CATALOG_EXTERNAL_REWRITE_DEPENDENCIES_ABSENT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .fetch_one(pool)
            .await
            .map_err(unavailable)?;

    if !external_rewrite_dependencies_absent {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog external rewrite dependency readback mismatch".to_owned(),
        ));
    }
    let constraint_options_are_exact: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND (NOT constraint_fact.convalidated OR constraint_fact.condeferrable OR constraint_fact.condeferred OR NOT CASE WHEN constraint_fact.contype IN ('p','u','f') THEN constraint_fact.connoinherit WHEN constraint_fact.contype='c' THEN NOT constraint_fact.connoinherit ELSE false END OR (constraint_fact.contype='f' AND (constraint_fact.confupdtype<>'a' OR constraint_fact.confdeltype<>'a' OR constraint_fact.confmatchtype<>'s'))))")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !constraint_options_are_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog constraint option manifest mismatch".to_owned(),
        ));
    }
    let index_options_are_exact: bool = sqlx::query_scalar("SELECT count(*)=10 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner)='replay_policy_catalog_owner' AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation)) FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1)")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !index_options_are_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog index option manifest mismatch".to_owned(),
        ));
    }
    let routines = sqlx::query("SELECT procedure.proname, procedure.prosrc, language.lanname, procedure.prokind='f' AS kind_exact, procedure.proretset, procedure.prosecdef, procedure.provolatile='v' AS volatile_exact, procedure.proparallel='u' AS parallel_exact, procedure.proisstrict, procedure.proconfig FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1) ORDER BY procedure.proname")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_record_v2"])
        .fetch_all(pool).await.map_err(unavailable)?;
    let expected = [
        (
            "apply_replay_policy_catalog_command_v2",
            "catalog_apply",
            "plpgsql",
            false,
            false,
        ),
        (
            "lock_current_replay_policy_catalog_v2",
            "catalog_current",
            "sql",
            true,
            false,
        ),
        (
            "lock_replay_policy_catalog_record_v2",
            "catalog_read",
            "sql",
            true,
            true,
        ),
    ];

    if routines.len() != expected.len()
        || routines
            .iter()
            .zip(expected)
            .any(|(row, (name, tag, language, returns_set, strict))| {
                row.try_get::<String, _>("proname").ok().as_deref() != Some(name)
                    || row.try_get::<String, _>("prosrc").ok().as_deref()
                        != migration_function_source(tag)
                    || row.try_get::<String, _>("lanname").ok().as_deref() != Some(language)
                    || row.try_get::<bool, _>("kind_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("proretset").ok() != Some(returns_set)
                    || row.try_get::<bool, _>("prosecdef").ok() != Some(true)
                    || row.try_get::<bool, _>("volatile_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("parallel_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("proisstrict").ok() != Some(strict)
                    || row
                        .try_get::<Option<Vec<String>>, _>("proconfig")
                        .ok()
                        .flatten()
                        .as_deref()
                        != Some(&["search_path=pg_catalog, pg_temp".to_owned()])
            })
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog function source or metadata readback mismatch".to_owned(),
        ));
    }
    Ok(())
}

fn migration_function_source(tag: &str) -> Option<&'static str> {
    let delimiter = format!("${tag}$");
    let (_, suffix) = AUTHORITY_MIGRATION_SQL.split_once(&delimiter)?;
    let (source, _) = suffix.split_once(&delimiter)?;
    Some(source)
}

async fn lock_catalog(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let exact: bool = sqlx::query_scalar("WITH owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='replay_policy_catalog_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls), callers AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('rd_owner','rd_fact_writer')) SELECT SESSION_USER IN ('rd_owner','rd_fact_writer') AND EXISTS(SELECT 1 FROM owner) AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_fact_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND count(*)=3 AND bool_and(pg_catalog.pg_get_userbyid(procedure.proowner)='replay_policy_catalog_owner' AND procedure.prosecdef AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND (SELECT pg_catalog.array_agg(pg_catalog.pg_get_userbyid(acl.grantee)||':'||acl.privilege_type||':'||acl.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(acl.grantee),acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl) IS NOT DISTINCT FROM CASE procedure.proname WHEN 'apply_replay_policy_catalog_command_v2' THEN ARRAY['rd_fact_writer:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[] ELSE ARRAY['rd_fact_writer:EXECUTE:false','rd_owner:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[] END) AND NOT EXISTS (SELECT 1 FROM callers WHERE pg_catalog.pg_has_role(callers.oid,(SELECT oid FROM owner),'MEMBER') OR pg_catalog.pg_has_role((SELECT oid FROM owner),callers.oid,'MEMBER')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer') OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1)")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_record_v2"]).fetch_one(&mut **transaction).await.map_err(unavailable)?;

    if !exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime ACL drift".to_owned(),
        ));
    }
    let column_acl_is_owner_only: bool = sqlx::query_scalar(CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL)
        .bind(CATALOG_TABLES_V2.as_slice())
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)?;

    if !column_acl_is_owner_only {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime column ACL drift".to_owned(),
        ));
    }
    let table_shape: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relowner,relation.relacl FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND relation.relkind='r') SELECT count(*)=4 AND bool_and(pg_catalog.pg_get_userbyid(relowner)='replay_policy_catalog_owner' AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl WHERE acl.grantee<>relowner) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=family.oid AND NOT trigger_fact.tgisinternal) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=family.oid)) FROM family")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(unavailable)?;

    if !table_shape {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime table drift".to_owned(),
        ));
    }
    let external_rewrite_dependencies_absent: bool =
        sqlx::query_scalar(CATALOG_EXTERNAL_REWRITE_DEPENDENCIES_ABSENT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .fetch_one(&mut **transaction)
            .await
            .map_err(unavailable)?;

    if !external_rewrite_dependencies_absent {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime external rewrite dependency drift".to_owned(),
        ));
    }
    let sources = sqlx::query("SELECT procedure.proname, procedure.prosrc FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1) ORDER BY procedure.proname")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_record_v2"])
        .fetch_all(&mut **transaction).await.map_err(unavailable)?;
    let expected = [
        ("apply_replay_policy_catalog_command_v2", "catalog_apply"),
        ("lock_current_replay_policy_catalog_v2", "catalog_current"),
        ("lock_replay_policy_catalog_record_v2", "catalog_read"),
    ];

    if sources.len() != expected.len()
        || sources.iter().zip(expected).any(|(row, (name, tag))| {
            row.try_get::<String, _>("proname").ok().as_deref() != Some(name)
                || row.try_get::<String, _>("prosrc").ok().as_deref()
                    != migration_function_source(tag)
        })
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime authority drift".to_owned(),
        ));
    }
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CATALOG_ADMIN_LOCK_V2)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

fn require_command(
    command_identity: &str,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    require_identity(command_identity, "command identity")?;

    if now_epoch_ms == 0 {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "command time must be nonzero",
        ));
    }
    Ok(())
}

fn require_identity(value: &str, label: &'static str) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if value.is_empty() || value.len() > 256 || !value.is_ascii() || value.trim() != value {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(())
}

fn require_sha256(value: &str, label: &'static str) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if value.len() != 71
        || !value.starts_with("sha256:")
        || !value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(())
}

fn content_identity(record: &ReplayPolicyCatalogBindingV2) -> String {
    format!("sha256:{}", bytes_hex(record.catalog_record_digest()))
}

fn bytes_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn digest_array(
    value: Vec<u8>,
    label: &'static str,
) -> Result<[u8; 32], ReplayPolicyCatalogErrorV2> {
    value.try_into().map_err(|_| {
        ReplayPolicyCatalogErrorV2::Unavailable(format!("Catalog {label} has invalid width"))
    })
}

fn decimal_version(value: Decimal) -> Result<u64, ReplayPolicyCatalogErrorV2> {
    value.to_u64().ok_or_else(|| {
        ReplayPolicyCatalogErrorV2::Unavailable("Catalog version is outside u64".to_owned())
    })
}

fn epoch_i64(value: u64) -> Result<i64, ReplayPolicyCatalogErrorV2> {
    i64::try_from(value).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("epoch milliseconds exceed PostgreSQL bigint")
    })
}

fn canonical_json_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, ReplayPolicyCatalogErrorV2> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(unavailable)?;
    Ok(format!("sha256:{}", bytes_hex(&Sha256::digest(bytes))))
}

fn unavailable(error: impl Display) -> ReplayPolicyCatalogErrorV2 {
    ReplayPolicyCatalogErrorV2::Unavailable(error.to_string())
}

#[cfg(test)]
mod postgres_tests {
    use rstest::rstest;

    use super::*;
    use crate::{
        product_edge::{ResearchRequestDisposition, ResearchRequestReceiptV1},
        trial_family::{TrialFamilyIndependenceDispositionV1, form_initial_family, verify_family},
        trial_family_postgres::{load_trial_family_in_transaction, persist_initial_family},
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    #[rstest]
    fn catalog_rule_manifest_is_closed_across_migration_connect_and_runtime() {
        let source = include_str!("replay_policy_catalog_postgres_v2.rs");
        let production = source
            .split("#[cfg(test)]\nmod postgres_tests")
            .next()
            .expect("Catalog production source");
        let reader_acl = "ARRAY['rd_fact_writer:EXECUTE:false','rd_owner:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[]";
        let writer_acl = "ARRAY['rd_fact_writer:EXECUTE:false','replay_policy_catalog_owner:EXECUTE:false']::text[]";
        assert_eq!(production.matches(reader_acl).count(), 2);
        assert_eq!(production.matches(writer_acl).count(), 2);
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "pg_catalog.pg_rewrite rewrite JOIN pg_catalog.pg_class relation ON relation.oid=rewrite.ev_class"
        ));
        let pre_cutover = AUTHORITY_MIGRATION_SQL
            .split("DO $private_owner_cutover$")
            .nth(1)
            .expect("Catalog/Composer private-owner cutover")
            .split("$private_owner_cutover$;")
            .next()
            .expect("bounded Catalog/Composer private-owner cutover");
        assert_eq!(
            pre_cutover
                .matches("dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass")
                .count(),
            2
        );
        let post_cutover = AUTHORITY_MIGRATION_SQL
            .split("DO $catalog_composer_constraint_manifest$")
            .nth(1)
            .expect("Catalog/Composer post-cutover manifest")
            .split("$catalog_composer_constraint_manifest$;")
            .next()
            .expect("bounded Catalog/Composer post-cutover manifest");
        assert!(
            post_cutover
                .contains("dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass")
        );
        assert!(
            CATALOG_EXTERNAL_REWRITE_DEPENDENCIES_ABSENT_SQL
                .contains("rewrite_fact.ev_class NOT IN (SELECT oid FROM family)")
        );
        assert_eq!(
            production
                .matches("CATALOG_EXTERNAL_REWRITE_DEPENDENCIES_ABSENT_SQL")
                .count(),
            3
        );
        let connect_check = source
            .split("let dependency_shape_is_exact")
            .nth(1)
            .expect("Catalog connect dependency check")
            .split("let constraint_options_are_exact")
            .next()
            .expect("bounded Catalog connect dependency check");
        assert!(connect_check.contains(
            "pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family))"
        ));
        let runtime_check = source
            .split("let table_shape")
            .nth(1)
            .expect("Catalog runtime table check")
            .split("if !table_shape")
            .next()
            .expect("bounded Catalog runtime table check");
        assert!(
            runtime_check
                .contains("pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=family.oid")
        );
        let runtime_authority_check = source
            .split("async fn lock_catalog")
            .nth(1)
            .expect("Catalog runtime authority check")
            .split("let table_shape")
            .next()
            .expect("bounded Catalog runtime authority check");
        assert!(runtime_authority_check.contains("NOT rolcanlogin AND NOT rolsuper"));
        assert!(
            runtime_authority_check
                .contains("pg_catalog.pg_has_role(callers.oid,(SELECT oid FROM owner),'MEMBER')")
        );
        let rd_owner_role = "role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls";
        let writer_role = "role.rolname='rd_fact_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls";
        let closed_membership = "WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer') OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')";
        assert_eq!(production.matches(rd_owner_role).count(), 2);
        assert_eq!(production.matches(writer_role).count(), 2);
        assert_eq!(production.matches(closed_membership).count(), 2);
        assert_eq!(
            production
                .matches("sqlx::query_scalar(CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL)")
                .count(),
            2
        );
        assert!(
            CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL
                .contains("pg_catalog.aclexplode(attribute.attacl) acl")
        );
        assert!(CATALOG_COLUMN_ACL_IS_OWNER_ONLY_SQL.contains("acl.grantee<>relation.relowner"));
        let migration_authority = source
            .split_once("async fn verify_catalog_storage_authority_for_migration")
            .expect("Catalog migration authority validator")
            .1
            .split_once("let column_shape")
            .expect("Catalog migration authority validator boundary")
            .0;

        for required in [
            "(NOT $2 OR SESSION_USER='rd_owner')",
            "count(*)=1 AND bool_and(granted_role='rd_custodian' AND member_role='rd_owner'",
            "grantor_role='postgres' AND NOT admin_option AND inherit_option AND set_option",
            "(NOT $2 AND NOT EXISTS(SELECT 1 FROM catalog_memberships))",
        ] {
            assert!(
                migration_authority.contains(required),
                "missing Catalog migration lease check: {required}"
            );
        }
        assert_eq!(
            production
                .matches("migrate_with_legacy_migration_lease")
                .count(),
            1
        );
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_runtime_rejects_nonowner_column_acl_and_restores() {
        const FINGERPRINT_SQL: &str = "WITH facts(fact) AS (
          SELECT 'relation:'||relation.relname||':'||relation.relowner::text||':'||
                 COALESCE(relation.relacl::text,'<NULL>')
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           WHERE namespace.nspname='replay_policy_catalog_private'
             AND relation.relname=ANY($1)
          UNION ALL
          SELECT 'column:'||relation.relname||':'||attribute.attnum::text||':'||
                 attribute.attname||':'||COALESCE(attribute.attacl::text,'<NULL>')
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
            JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
           WHERE namespace.nspname='replay_policy_catalog_private'
             AND relation.relname=ANY($1)
             AND attribute.attnum>0 AND NOT attribute.attisdropped
        ) SELECT pg_catalog.md5(pg_catalog.string_agg(fact,E'\\n' ORDER BY fact)) FROM facts";
        const WRITE_COUNTS_SQL: &str = "SELECT
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2),
          (SELECT count(*) FROM public.rd_owner_outbox_v1
            WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2')";
        const GRANT_SQL: &str = "GRANT SELECT (catalog_record_id)
          ON replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 TO rd_owner";
        const REVOKE_SQL: &str = "REVOKE SELECT (catalog_record_id)
          ON replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 FROM rd_owner";

        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let before_fingerprint: String = sqlx::query_scalar(FINGERPRINT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .fetch_one(lease.pool())
            .await
            .unwrap();
        let before_writes: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query(GRANT_SQL).execute(lease.pool()).await.unwrap();
        if let Err(e) = lease.release().await {
            let lease = e.into_capability();
            let rollback_fault = sqlx::query(REVOKE_SQL).execute(lease.pool()).await;
            let release_retry = lease.release().await;
            rollback_fault.expect("column ACL rollback after lease release failure");
            release_retry.expect("fault authority release retry after column ACL rollback");
            panic!("fault authority release failed after column ACL injection");
        }

        let connect_result = verify_catalog_storage_authority(rd_owner_pool).await;
        let runtime_result = match rd_owner_pool.begin().await {
            Ok(mut transaction) => {
                let result = lock_catalog(&mut transaction).await;
                transaction.rollback().await.map(|()| result).ok()
            }
            Err(_) => None,
        };

        let cleanup_lease = match database
            .acquire_replay_policy_catalog_fault_authority()
            .await
        {
            Ok(lease) => Ok(lease),
            Err(e) => e
                .into_capability()
                .retry_acquire()
                .await
                .map_err(|retry| retry.source().to_string()),
        };
        let cleanup_result = match cleanup_lease {
            Ok(lease) => {
                let during_writes =
                    sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(WRITE_COUNTS_SQL)
                        .fetch_one(lease.pool())
                        .await;
                let revoke = sqlx::query(REVOKE_SQL).execute(lease.pool()).await;
                let release = lease.release().await;
                match (during_writes, revoke, release) {
                    (Ok(writes), Ok(_), Ok(_)) => Ok(writes),
                    (writes, revoke, release) => Err(format!(
                        "column ACL cleanup failed: writes={writes:?}; revoke={revoke:?}; release={release:?}"
                    )),
                }
            }
            Err(e) => Err(e),
        };
        let readback_lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .expect("Catalog post-cleanup fingerprint authority");
        let after_fingerprint = sqlx::query_scalar::<_, String>(FINGERPRINT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .fetch_one(readback_lease.pool())
            .await;
        let readback_release = readback_lease.release().await;

        let during_writes =
            cleanup_result.expect("column ACL cleanup must restore fault authority");
        assert!(matches!(
            connect_result,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert!(matches!(
            runtime_result,
            Some(Err(ReplayPolicyCatalogErrorV2::Unavailable(_)))
        ));
        assert_eq!(during_writes, before_writes);
        readback_release.expect("release Catalog post-cleanup fingerprint authority");
        assert_eq!(
            after_fingerprint.expect("post-cleanup Catalog fingerprint"),
            before_fingerprint
        );
        verify_catalog_storage_authority(rd_owner_pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_runtime_rejects_external_view_dependency_and_restores() {
        const VIEW_NAME: &str = "vibe_test_catalog_external_dependency_v2";
        const FINGERPRINT_SQL: &str = "WITH family AS (
          SELECT relation.oid
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           WHERE namespace.nspname='replay_policy_catalog_private'
             AND relation.relname=ANY($1)
        ), facts(fact) AS (
          SELECT 'view:'||relation.oid::text||':'||relation.relkind::text
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           WHERE namespace.nspname='public' AND relation.relname=$2
          UNION ALL
          SELECT 'dependency:'||dependency.classid::text||':'||dependency.objid::text||':'||
                 dependency.objsubid::text||':'||dependency.refobjid::text||':'||
                 dependency.refobjsubid::text||':'||dependency.deptype::text||':'||
                 rewrite_fact.ev_class::text
            FROM pg_catalog.pg_depend dependency
            JOIN pg_catalog.pg_rewrite rewrite_fact
              ON dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass
             AND dependency.objid=rewrite_fact.oid
           WHERE dependency.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
             AND dependency.refobjid IN (SELECT oid FROM family)
             AND rewrite_fact.ev_class NOT IN (SELECT oid FROM family)
        ) SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(fact,E'\\n' ORDER BY fact),'')) FROM facts";
        const WRITE_COUNTS_SQL: &str = "SELECT
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2),
          (SELECT count(*) FROM public.rd_owner_outbox_v1
            WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2')";

        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let before_fingerprint: String = sqlx::query_scalar(FINGERPRINT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .bind(VIEW_NAME)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        let before_writes: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        let create = sqlx::query(
            "CREATE VIEW public.vibe_test_catalog_external_dependency_v2 AS
             SELECT catalog_record_id
             FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2",
        )
        .execute(lease.pool())
        .await;

        if let Err(e) = create {
            lease
                .release()
                .await
                .expect("release Catalog fault authority");
            panic!("inject Catalog external view dependency: {e}");
        }

        if let Err(e) = lease.release().await {
            let lease = e.into_capability();
            let drop_view =
                sqlx::query("DROP VIEW IF EXISTS public.vibe_test_catalog_external_dependency_v2")
                    .execute(lease.pool())
                    .await;
            let release_retry = lease.release().await;
            drop_view.expect("drop Catalog external view after lease release failure");
            release_retry.expect("retry Catalog fault authority release after cleanup");
            panic!("Catalog fault authority release failed after external view injection");
        }

        let connect_result = verify_catalog_storage_authority(rd_owner_pool).await;
        let runtime_result = match rd_owner_pool.begin().await {
            Ok(mut transaction) => {
                let result = lock_catalog(&mut transaction).await;
                transaction.rollback().await.map(|()| result).ok()
            }
            Err(_) => None,
        };

        let cleanup_lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .expect("acquire Catalog fault authority for cleanup readback");
        let cleanup =
            sqlx::query("DROP VIEW IF EXISTS public.vibe_test_catalog_external_dependency_v2")
                .execute(cleanup_lease.pool())
                .await;
        let after_fingerprint = sqlx::query_scalar::<_, String>(FINGERPRINT_SQL)
            .bind(CATALOG_TABLES_V2.as_slice())
            .bind(VIEW_NAME)
            .fetch_one(cleanup_lease.pool())
            .await;
        let after_writes = sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(WRITE_COUNTS_SQL)
            .fetch_one(cleanup_lease.pool())
            .await;
        let cleanup_release = cleanup_lease.release().await;

        cleanup.expect("drop Catalog external view dependency");
        cleanup_release.expect("release Catalog cleanup readback authority");
        assert!(matches!(
            connect_result,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert!(matches!(
            runtime_result,
            Some(Err(ReplayPolicyCatalogErrorV2::Unavailable(_)))
        ));
        assert_eq!(
            after_writes.expect("post-cleanup Catalog writes"),
            before_writes
        );
        assert_eq!(
            after_fingerprint.expect("post-cleanup Catalog dependency fingerprint"),
            before_fingerprint
        );
        verify_catalog_storage_authority(rd_owner_pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn revoked_required_catalog_execute_is_unavailable_and_writes_nothing() {
        const WRITE_COUNTS_SQL: &str = "SELECT
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2),
          (SELECT count(*) FROM public.rd_owner_outbox_v1
            WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2')";

        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let before: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();

        sqlx::query(
            "REVOKE EXECUTE ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() FROM rd_owner",
        )
        .execute(lease.pool())
        .await
        .unwrap();
        lease.release().await.unwrap();
        let startup = verify_catalog_storage_authority(rd_owner_pool).await;
        let mut transaction = rd_owner_pool.begin().await.unwrap();
        let consumer =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy()).await;
        transaction.rollback().await.unwrap();
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let after: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query(
            "GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() TO rd_owner",
        )
        .execute(lease.pool())
        .await
        .unwrap();
        lease.release().await.unwrap();

        verify_catalog_storage_authority(rd_owner_pool)
            .await
            .unwrap();
        assert!(matches!(
            startup,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert!(matches!(
            consumer,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert_eq!(after, before);
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_rule_injection_is_unavailable_and_writes_nothing() {
        const WRITE_COUNTS_SQL: &str = "SELECT
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
          (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2),
          (SELECT count(*) FROM public.rd_owner_outbox_v1
            WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2')";

        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdFactWriter);
        verify_catalog_storage_authority(pool).await.unwrap();
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let before: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();

        sqlx::query(
            "CREATE RULE suppress_catalog_audit_v2 AS
             ON INSERT TO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2
             DO INSTEAD NOTHING",
        )
        .execute(lease.pool())
        .await
        .unwrap();
        lease.release().await.unwrap();
        let startup = migrate(pool).await;

        let administrator = AuthenticatedCatalogAdministratorV2::admit(
            "rd-catalog-rule-test-administrator-v2",
            &format!("sha256:{}", "a".repeat(64)),
        )
        .unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let result = ReplayPolicyCatalogAdministrationPortV2::create_policy(
            &mut transaction,
            &administrator,
            "catalog-rule-injection-command-v2",
            "catalog-rule-injection-record-v2",
            &replay_policy(9_001),
            9_001,
        )
        .await;
        transaction.rollback().await.unwrap();

        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let observed: (i64, i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query(
            "DROP RULE suppress_catalog_audit_v2
             ON replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
        )
        .execute(lease.pool())
        .await
        .unwrap();
        lease.release().await.unwrap();
        assert!(matches!(
            startup,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert!(matches!(
            result,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        assert_eq!(observed, before);
        verify_catalog_storage_authority(pool).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_admin_and_family_formation_are_atomic_and_fail_closed() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdFactWriter);
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

        verify_catalog_storage_authority(pool).await.unwrap();
        let external_write_grants: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = ANY($1) AND grantee <> 'rd_owner'",
        )
        .bind(CATALOG_TABLES_V2.as_slice())
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(external_write_grants, 0);

        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let mut seed_counts = Vec::new();

        for (table, query) in [
            (
                "rd_replay_policy_catalog_records_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2",
            ),
            (
                "rd_replay_policy_catalog_head_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2",
            ),
            (
                "rd_replay_policy_catalog_revocations_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2",
            ),
            (
                "rd_replay_policy_catalog_audit_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
            ),
        ] {
            let count: i64 = sqlx::query_scalar(query)
                .fetch_one(lease.pool())
                .await
                .unwrap();
            seed_counts.push((table, count));
        }
        lease.release().await.unwrap();

        for (table, count) in seed_counts {
            assert_eq!(count, 0, "migration must not seed {table}");
        }

        let admin = AuthenticatedCatalogAdministratorV2::admit(
            "rd-catalog-test-administrator-v2",
            &format!("sha256:{}", "a".repeat(64)),
        )
        .unwrap();
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let before_third_party_owner_edge = catalog_and_family_write_counts(lease.pool()).await;
        let injected = lease.inject_third_party_owner_edge().await.unwrap();
        let mut transaction = rd_owner_pool.begin().await.unwrap();
        let third_party_owner_edge =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy()).await;
        transaction.rollback().await.unwrap();
        injected.restore().await.unwrap();
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let after_third_party_owner_edge = catalog_and_family_write_counts(lease.pool()).await;
        lease.release().await.unwrap();
        assert!(matches!(
            third_party_owner_edge,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(reason))
                if reason == "Catalog runtime ACL drift"
        ));
        assert_eq!(after_third_party_owner_edge, before_third_party_owner_edge);
        verify_catalog_storage_authority(rd_owner_pool)
            .await
            .unwrap();

        let mut transaction = pool.begin().await.unwrap();
        let first = ReplayPolicyCatalogAdministrationPortV2::create_policy(
            &mut transaction,
            &admin,
            "catalog-command-create-v2",
            "catalog-policy-record-v2-1",
            &replay_policy(1),
            1_000,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
            &mut transaction,
            &admin,
            "catalog-command-head-v2-1",
            None,
            first.catalog_record_id(),
            1_001,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        assert_direct_catalog_mutations_are_rejected(pool).await;

        let mut policy = family_policy();
        let mut transaction = pool.begin().await.unwrap();
        policy.replay_execution_policy_v2 = Some(
            resolve_current_for_trial_family_formation(&mut transaction, &policy)
                .await
                .unwrap(),
        );
        let family = form_initial_family(
            "rd-research-intent-v2-catalog-formation",
            &format!("sha256:{}", "b".repeat(64)),
            policy,
            1_002,
        )
        .unwrap();
        let receipt = receipt("catalog-formation", 1_002);
        persist_initial_family(&mut transaction, &family, &receipt)
            .await
            .unwrap();
        transaction.commit().await.unwrap();

        let sealed_record = family
            .root()
            .policy()
            .replay_execution_policy_v2()
            .unwrap()
            .clone();
        assert_eq!(sealed_record, first);

        let mut transaction = pool.begin().await.unwrap();
        let second = ReplayPolicyCatalogAdministrationPortV2::append_version(
            &mut transaction,
            &admin,
            "catalog-command-append-v2-2",
            first.catalog_record_id(),
            "catalog-policy-record-v2-2",
            &replay_policy(2),
            1_003,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
            &mut transaction,
            &admin,
            "catalog-command-head-v2-2",
            Some(first.catalog_record_id()),
            second.catalog_record_id(),
            1_004,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::revoke_version(
            &mut transaction,
            &admin,
            "catalog-command-revoke-v2-1",
            first.catalog_record_id(),
            1_005,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let mut transaction = pool.begin().await.unwrap();
        let loaded = load_trial_family_in_transaction(
            &mut transaction,
            "rd-research-intent-v2-catalog-formation",
            &receipt.receipt_identity,
        )
        .await
        .unwrap();
        verify_family(&loaded).unwrap();
        assert_eq!(
            loaded.root().policy().replay_execution_policy_v2(),
            Some(&sealed_record),
            "later Catalog changes cannot replace or invalidate a formed family"
        );
        transaction.rollback().await.unwrap();

        assert_zero_family_write_on_cross_splice(pool).await;
        assert_zero_family_write_on_tamper(&database, pool, second.catalog_record_id()).await;
        assert_zero_family_write_on_wrong_owner(&database, pool, second.catalog_record_id()).await;
        assert_zero_family_write_on_wrong_head(&database, pool).await;

        let mut transaction = pool.begin().await.unwrap();
        ReplayPolicyCatalogAdministrationPortV2::revoke_version(
            &mut transaction,
            &admin,
            "catalog-command-revoke-v2-2",
            second.catalog_record_id(),
            1_006,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        let before = family_row_counts(pool).await;
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);

        // Leave the shared disposable harness on an authenticated, unrevoked canonical head.
        let mut transaction = pool.begin().await.unwrap();
        let third = ReplayPolicyCatalogAdministrationPortV2::append_version(
            &mut transaction,
            &admin,
            "catalog-command-append-v2-3",
            second.catalog_record_id(),
            "catalog-policy-record-v2-3",
            &replay_policy(3),
            1_007,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
            &mut transaction,
            &admin,
            "catalog-command-head-v2-3",
            Some(second.catalog_record_id()),
            third.catalog_record_id(),
            1_008,
        )
        .await
        .unwrap();
        let current =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .unwrap();
        assert_eq!(current, third);
        transaction.commit().await.unwrap();

        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
        )
        .fetch_one(lease.pool())
        .await
        .unwrap();
        lease.release().await.unwrap();
        let outbox_count: i64 = sqlx::query_scalar("SELECT count(*) FROM rd_owner_outbox_v1 WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2'")
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(audit_count, 8);
        assert_eq!(outbox_count, 8);
    }

    async fn assert_zero_family_write_on_cross_splice(pool: &PgPool) {
        let before = family_row_counts(pool).await;
        let mut wrong = family_policy();
        wrong.cost_model_identity = "wrong-cost-model".to_owned();
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &wrong)
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_tamper(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let original: Vec<u8> = sqlx::query_scalar("SELECT policy_digest FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = $1")
            .bind(record_id)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET policy_digest = decode(repeat('00',32),'hex') WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let consumer =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy()).await;
        transaction.rollback().await.unwrap();
        let after = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET policy_digest = $2 WHERE catalog_record_id = $1")
            .bind(record_id)
            .bind(original)
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        assert!(consumer.is_err());
        assert_eq!(after, before);
    }

    async fn assert_zero_family_write_on_wrong_owner(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let original: String = sqlx::query_scalar("SELECT owner_identity FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = $1")
            .bind(record_id)
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET owner_identity = 'wrong-owner' WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let consumer =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy()).await;
        transaction.rollback().await.unwrap();
        let after = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET owner_identity = $2 WHERE catalog_record_id = $1")
            .bind(record_id)
            .bind(original)
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        assert!(consumer.is_err());
        assert_eq!(after, before);
    }

    async fn assert_zero_family_write_on_wrong_head(
        database: &CanonicalOwnerPostgresTestDatabaseV1,
        pool: &PgPool,
    ) {
        let before = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        let original: Decimal = sqlx::query_scalar("SELECT catalog_version FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 WHERE singleton = TRUE")
            .fetch_one(lease.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET catalog_version = 1 WHERE singleton = TRUE")
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let consumer =
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy()).await;
        transaction.rollback().await.unwrap();
        let after = family_row_counts(pool).await;
        let lease = database
            .acquire_replay_policy_catalog_fault_authority()
            .await
            .unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET catalog_version = $1 WHERE singleton = TRUE")
            .bind(original)
            .execute(lease.pool())
            .await
            .unwrap();
        lease.release().await.unwrap();
        assert!(consumer.is_err());
        assert_eq!(after, before);
    }

    async fn assert_direct_catalog_mutations_are_rejected(pool: &PgPool) {
        for statement in [
            "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET owner_identity = 'raw-writer' WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_by = 'raw-writer' WHERE singleton = TRUE",
            "INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 (catalog_record_id, catalog_version, revoked_by, revoked_at_epoch_ms) VALUES ('catalog-policy-record-v2-1',1,'raw-writer',1)",
            "INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 (command_identity, administrator_identity, authentication_fact_digest, command_kind, content_identity, audit_json, committed_at_epoch_ms) VALUES ('raw-command','raw-writer','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','RAW_WRITE','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',1)",
        ] {
            let mut transaction = pool.begin().await.unwrap();
            let error = sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .expect_err("raw Catalog mutation must be rejected");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()),
                Some(std::borrow::Cow::Borrowed("42501"))
            );
            transaction.rollback().await.unwrap();
        }
    }

    async fn family_row_counts(pool: &PgPool) -> (i64, i64, i64, i64) {
        (
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_families_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_family_members_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_family_heads_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_owner_outbox_v1 WHERE event_kind = 'TRIAL_FAMILY_FROZEN_V1'")
                .fetch_one(pool)
                .await
                .unwrap(),
        )
    }

    async fn catalog_and_family_write_counts(pool: &PgPool) -> Vec<i64> {
        let row = sqlx::query(
            "SELECT
              (SELECT count(*) FROM public.rd_trial_families_v1) AS families,
              (SELECT count(*) FROM public.rd_trial_family_members_v1) AS members,
              (SELECT count(*) FROM public.rd_trial_family_heads_v1) AS heads,
              (SELECT count(*) FROM public.rd_owner_outbox_v1) AS outbox,
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2) AS catalog_records,
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2) AS catalog_head,
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2) AS catalog_revocations,
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2) AS catalog_audit",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        [
            "families",
            "members",
            "heads",
            "outbox",
            "catalog_records",
            "catalog_head",
            "catalog_revocations",
            "catalog_audit",
        ]
        .into_iter()
        .map(|column| row.try_get(column).unwrap())
        .collect()
    }

    fn family_policy() -> TrialFamilyPolicyV1 {
        TrialFamilyPolicyV1 {
            trial_budget: 2,
            stop_rule: "stop after bounded falsifier".to_owned(),
            pit_rule_identity: "pit-rule-v1".to_owned(),
            cost_model_identity: "cost-model".to_owned(),
            slippage_model_identity: "slippage-model".to_owned(),
            capacity_model_identity: "capacity-model".to_owned(),
            semantic_predecessor_frontier: Vec::new(),
            protected_feedback_frontier: "qualification-frontier-v1".to_owned(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".to_owned(),
            frozen_falsifier_binding: format!("sha256:{}", "c".repeat(64)),
            replay_execution_policy_v2: None,
        }
    }

    fn receipt(suffix: &str, committed_at_epoch_ms: u64) -> ResearchRequestReceiptV1 {
        ResearchRequestReceiptV1 {
            schema_version: 2,
            receipt_identity: format!("rd-research-receipt-v2-{suffix}"),
            request_identity: format!("rd-research-request-v2-{suffix}"),
            semantic_digest: format!("sha256:{}", "b".repeat(64)),
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(
                "rd-research-intent-v2-catalog-formation".to_owned(),
            ),
            committed_at_epoch_ms,
            rejection_code: None,
        }
    }

    fn replay_policy(seed: u64) -> ReplayExecutionPolicyV2 {
        ReplayExecutionPolicyV2 {
            runtime_kernel: versioned("runtime-kernel"),
            simulator: versioned("simulator"),
            cost: versioned("cost-model"),
            slippage: versioned("slippage-model"),
            capacity: versioned("capacity-model"),
            runner_operational_profile: versioned("runner"),
            diagnostic_policy: versioned("diagnostic"),
            deterministic_seed: seed,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: versioned("calendar"),
            session: versioned("session"),
            time_zone: versioned("timezone"),
            correction_rule: versioned("correction"),
            market_semantics: versioned("semantics"),
            replay_configuration: content("configuration"),
            corporate_action_cut: content("corporate-actions"),
            historical_membership_cut: content("membership"),
        }
    }

    fn versioned(identity: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            version: OpaqueIdentityV2::try_from("v1".to_owned()).unwrap(),
        }
    }

    fn content(identity: &str) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", "d".repeat(64))).unwrap(),
        }
    }
}
