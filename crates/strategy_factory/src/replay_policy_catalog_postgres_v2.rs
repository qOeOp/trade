//! Private PostgreSQL authority for the R&D Replay Policy Catalog.

use std::fmt::Display;

use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{AssertSqlSafe, PgPool, Postgres, Row, Transaction};

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
const CATALOG_ADMIN_GUARD_SETTING_V2: &str = "vibe.replay_policy_catalog_admin_v2";
const CATALOG_MUTATION_GUARD_SOURCE_V2: &str = "
DECLARE
  guard_token text;
  guarded_event_kind text;
BEGIN
  IF TG_TABLE_NAME = 'rd_owner_outbox_v1' THEN
    guarded_event_kind := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.event_kind
      WHEN TG_OP = 'UPDATE' AND OLD.event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2' THEN OLD.event_kind
      ELSE NEW.event_kind
    END;
    IF guarded_event_kind NOT LIKE 'REPLAY_POLICY_CATALOG_%_V2' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  END IF;
  guard_token := pg_catalog.current_setting('vibe.replay_policy_catalog_admin_v2', true);
  IF SESSION_USER <> 'rd_owner'
     OR guard_token IS NULL
     OR guard_token !~ '^sha256:[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Replay Policy Catalog mutation requires the private audited administration port';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
";

const CATALOG_TABLES_V2: [&str; 4] = [
    "rd_replay_policy_catalog_records_v2",
    "rd_replay_policy_catalog_head_v2",
    "rd_replay_policy_catalog_revocations_v2",
    "rd_replay_policy_catalog_audit_v2",
];

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let role: String = sqlx::query_scalar("SELECT SESSION_USER")
        .fetch_one(pool)
        .await
        .map_err(unavailable)?;
    if role != "rd_owner" {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog migration requires the canonical rd_owner role".to_owned(),
        ));
    }
    for statement in [
        "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_records_v2 (catalog_record_id TEXT PRIMARY KEY, catalog_version NUMERIC(20,0) NOT NULL UNIQUE CHECK (catalog_version > 0 AND catalog_version <= 18446744073709551615), owner_identity TEXT NOT NULL, predecessor_record_id TEXT UNIQUE REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), policy_grammar_parser_id TEXT NOT NULL, policy_grammar_parser_digest BYTEA NOT NULL CHECK (octet_length(policy_grammar_parser_digest) = 32), policy_canonical_bytes BYTEA NOT NULL, policy_digest BYTEA NOT NULL CHECK (octet_length(policy_digest) = 32), catalog_record_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(catalog_record_digest) = 32), created_by TEXT NOT NULL, created_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_head_v2 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), catalog_record_id TEXT NOT NULL UNIQUE REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, advanced_by TEXT NOT NULL, advanced_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_revocations_v2 (catalog_record_id TEXT PRIMARY KEY REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, revoked_by TEXT NOT NULL, revoked_at_epoch_ms BIGINT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_audit_v2 (command_identity TEXT PRIMARY KEY, administrator_identity TEXT NOT NULL, authentication_fact_digest TEXT NOT NULL, command_kind TEXT NOT NULL, predecessor_record_id TEXT, predecessor_head_record_id TEXT, result_record_id TEXT, content_identity TEXT NOT NULL, audit_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(unavailable)?;
    }
    for table in CATALOG_TABLES_V2 {
        // `table` comes only from the fixed private Catalog table allowlist above.
        sqlx::query(AssertSqlSafe(format!(
            "ALTER TABLE public.{table} OWNER TO rd_owner"
        )))
        .execute(pool)
        .await
        .map_err(unavailable)?;
        sqlx::query(AssertSqlSafe(format!(
            "REVOKE ALL ON TABLE public.{table} FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer, backtest_owner"
        )))
        .execute(pool)
        .await
        .map_err(unavailable)?;
    }
    sqlx::query(
        "DO $catalog_acl$ DECLARE catalog_table text; grantee_name text; BEGIN FOREACH catalog_table IN ARRAY ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'] LOOP FOR grantee_name IN SELECT DISTINCT role.rolname FROM pg_catalog.pg_class relation CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl JOIN pg_catalog.pg_roles role ON role.oid = acl.grantee WHERE relation.oid = pg_catalog.to_regclass('public.' || catalog_table) AND role.rolname <> 'rd_owner' LOOP EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM %I', catalog_table, grantee_name); END LOOP; END LOOP; END $catalog_acl$",
    )
    .execute(pool)
    .await
    .map_err(unavailable)?;
    let create_guard = format!(
        "CREATE OR REPLACE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2() RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SET search_path = pg_catalog AS $catalog_guard${CATALOG_MUTATION_GUARD_SOURCE_V2}$catalog_guard$"
    );
    // The generated statement interpolates only the compile-time guard body above.
    sqlx::query(AssertSqlSafe(create_guard))
        .execute(pool)
        .await
        .map_err(unavailable)?;
    for statement in [
        "ALTER FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2() OWNER TO rd_owner",
        "REVOKE ALL ON FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2() FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_writer, backtest_owner",
        "DO $catalog_function_acl$ DECLARE grantee_name text; BEGIN FOR grantee_name IN SELECT DISTINCT role.rolname FROM pg_catalog.pg_proc procedure CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl JOIN pg_catalog.pg_roles role ON role.oid = acl.grantee JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace WHERE namespace.nspname = 'rd_owner_api' AND procedure.proname = 'guard_replay_policy_catalog_mutation_v2' AND role.rolname <> 'rd_owner' LOOP EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2() FROM %I', grantee_name); END LOOP; END $catalog_function_acl$",
        "CREATE OR REPLACE TRIGGER rd_replay_policy_catalog_records_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON rd_replay_policy_catalog_records_v2 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2()",
        "CREATE OR REPLACE TRIGGER rd_replay_policy_catalog_head_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON rd_replay_policy_catalog_head_v2 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2()",
        "CREATE OR REPLACE TRIGGER rd_replay_policy_catalog_revocations_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON rd_replay_policy_catalog_revocations_v2 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2()",
        "CREATE OR REPLACE TRIGGER rd_replay_policy_catalog_audit_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON rd_replay_policy_catalog_audit_v2 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2()",
        "CREATE OR REPLACE TRIGGER rd_replay_policy_catalog_outbox_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON rd_owner_outbox_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_replay_policy_catalog_mutation_v2()",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(unavailable)?;
    }
    verify_catalog_storage_authority(pool).await
}

/// Proof carried only inside the private R&D administration boundary.
pub(crate) struct AuthenticatedCatalogAdministratorV2 {
    identity: String,
    authentication_fact_digest: String,
}

impl AuthenticatedCatalogAdministratorV2 {
    #[cfg(test)]
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
        let existing: i64 =
            sqlx::query_scalar("SELECT count(*) FROM rd_replay_policy_catalog_records_v2")
                .fetch_one(&mut **transaction)
                .await
                .map_err(unavailable)?;
        if existing != 0 {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let record = ReplayPolicyCatalogBindingV2::from_policy(catalog_record_id, 1, policy)?;
        open_catalog_admin_guard(transaction, administrator, command_identity).await?;
        insert_record(transaction, administrator, &record, None, now_epoch_ms).await?;
        persist_admin_fact(
            transaction,
            administrator,
            command_identity,
            CREATE_EVENT_V2,
            None,
            None,
            Some(record.catalog_record_id()),
            content_identity(&record),
            now_epoch_ms,
        )
        .await?;
        close_catalog_admin_guard(transaction).await?;
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
        let row = sqlx::query("SELECT catalog_record_id, catalog_version FROM rd_replay_policy_catalog_records_v2 ORDER BY catalog_version DESC LIMIT 1")
            .fetch_optional(&mut **transaction)
            .await
            .map_err(unavailable)?
            .ok_or(ReplayPolicyCatalogErrorV2::Conflict)?;
        let predecessor: String = row.try_get("catalog_record_id").map_err(unavailable)?;
        let predecessor_version =
            decimal_version(row.try_get("catalog_version").map_err(unavailable)?)?;
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
        open_catalog_admin_guard(transaction, administrator, command_identity).await?;
        insert_record(
            transaction,
            administrator,
            &record,
            Some(&predecessor),
            now_epoch_ms,
        )
        .await?;
        let predecessor_head = current_head_id(transaction).await?;
        persist_admin_fact(
            transaction,
            administrator,
            command_identity,
            APPEND_EVENT_V2,
            Some(&predecessor),
            predecessor_head.as_deref(),
            Some(record.catalog_record_id()),
            content_identity(&record),
            now_epoch_ms,
        )
        .await?;
        close_catalog_admin_guard(transaction).await?;
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
        open_catalog_admin_guard(transaction, administrator, command_identity).await?;
        sqlx::query("INSERT INTO rd_replay_policy_catalog_head_v2 (singleton, catalog_record_id, catalog_version, advanced_by, advanced_at_epoch_ms) VALUES (TRUE,$1,$2,$3,$4) ON CONFLICT (singleton) DO UPDATE SET catalog_record_id=EXCLUDED.catalog_record_id, catalog_version=EXCLUDED.catalog_version, advanced_by=EXCLUDED.advanced_by, advanced_at_epoch_ms=EXCLUDED.advanced_at_epoch_ms")
            .bind(target.catalog_record_id())
            .bind(Decimal::from(target.catalog_version()))
            .bind(&administrator.identity)
            .bind(epoch_i64(now_epoch_ms)?)
            .execute(&mut **transaction)
            .await
            .map_err(unavailable)?;
        persist_admin_fact(
            transaction,
            administrator,
            command_identity,
            ADVANCE_EVENT_V2,
            None,
            current.as_ref().map(|head| head.0.as_str()),
            Some(target.catalog_record_id()),
            content_identity(&target),
            now_epoch_ms,
        )
        .await?;
        close_catalog_admin_guard(transaction).await
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
        open_catalog_admin_guard(transaction, administrator, command_identity).await?;
        sqlx::query("INSERT INTO rd_replay_policy_catalog_revocations_v2 (catalog_record_id, catalog_version, revoked_by, revoked_at_epoch_ms) VALUES ($1,$2,$3,$4)")
            .bind(record.catalog_record_id())
            .bind(Decimal::from(record.catalog_version()))
            .bind(&administrator.identity)
            .bind(epoch_i64(now_epoch_ms)?)
            .execute(&mut **transaction)
            .await
            .map_err(unavailable)?;
        let head = current_head_id(transaction).await?;
        persist_admin_fact(
            transaction,
            administrator,
            command_identity,
            REVOKE_EVENT_V2,
            None,
            head.as_deref(),
            Some(record.catalog_record_id()),
            content_identity(&record),
            now_epoch_ms,
        )
        .await?;
        close_catalog_admin_guard(transaction).await
    }
}

/// Locks and validates the exact current unrevoked Catalog fact on the caller's transaction.
pub(crate) async fn resolve_current_for_trial_family_formation(
    transaction: &mut Transaction<'_, Postgres>,
    family_policy: &TrialFamilyPolicyV1,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    lock_catalog(transaction).await?;
    let rows = sqlx::query("SELECT r.catalog_record_id, r.catalog_version, r.owner_identity, r.policy_grammar_parser_id, r.policy_grammar_parser_digest, r.policy_canonical_bytes, r.policy_digest, r.catalog_record_digest, h.catalog_record_id AS head_record_id, h.catalog_version AS head_version, v.catalog_record_id AS revoked_record_id FROM rd_replay_policy_catalog_head_v2 h JOIN rd_replay_policy_catalog_records_v2 r ON r.catalog_record_id = h.catalog_record_id AND r.catalog_version = h.catalog_version LEFT JOIN rd_replay_policy_catalog_revocations_v2 v ON v.catalog_record_id = r.catalog_record_id FOR UPDATE OF h, r")
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;
    if rows.len() != 1 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "current Catalog head is missing".to_owned(),
        ));
    }
    let row = &rows[0];
    if row
        .try_get::<Option<String>, _>("revoked_record_id")
        .map_err(unavailable)?
        .is_some()
    {
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

async fn insert_record(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    record: &ReplayPolicyCatalogBindingV2,
    predecessor_record_id: Option<&str>,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    record.verify()?;
    sqlx::query("INSERT INTO rd_replay_policy_catalog_records_v2 (catalog_record_id, catalog_version, owner_identity, predecessor_record_id, policy_grammar_parser_id, policy_grammar_parser_digest, policy_canonical_bytes, policy_digest, catalog_record_digest, created_by, created_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(record.catalog_record_id())
        .bind(Decimal::from(record.catalog_version()))
        .bind(RD_OWNER_IDENTITY_V2)
        .bind(predecessor_record_id)
        .bind(record.policy_grammar_parser_id())
        .bind(record.policy_grammar_parser_digest().as_slice())
        .bind(record.policy_canonical_bytes())
        .bind(record.policy_digest().as_slice())
        .bind(record.catalog_record_digest().as_slice())
        .bind(&administrator.identity)
        .bind(epoch_i64(now_epoch_ms)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

async fn load_record_by_id(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query("SELECT catalog_record_id, catalog_version, owner_identity, policy_grammar_parser_id, policy_grammar_parser_digest, policy_canonical_bytes, policy_digest, catalog_record_digest FROM rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = $1 FOR UPDATE")
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
    let rows = sqlx::query("SELECT catalog_record_id, catalog_version FROM rd_replay_policy_catalog_head_v2 WHERE singleton = TRUE FOR UPDATE")
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
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM rd_replay_policy_catalog_revocations_v2 WHERE catalog_record_id = $1)")
        .bind(catalog_record_id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)
}

#[allow(clippy::too_many_arguments)]
async fn persist_admin_fact(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    command_identity: &str,
    command_kind: &str,
    predecessor_record_id: Option<&str>,
    predecessor_head_record_id: Option<&str>,
    result_record_id: Option<&str>,
    content_identity: String,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let audit = CatalogAdminAuditV2 {
        schema_version: 2,
        command_identity: command_identity.to_owned(),
        administrator_identity: administrator.identity.clone(),
        authentication_fact_digest: administrator.authentication_fact_digest.clone(),
        command_kind: command_kind.to_owned(),
        predecessor_record_id: predecessor_record_id.map(str::to_owned),
        predecessor_head_record_id: predecessor_head_record_id.map(str::to_owned),
        result_record_id: result_record_id.map(str::to_owned),
        content_identity: content_identity.clone(),
        committed_at_epoch_ms: now_epoch_ms,
    };
    let audit_json = serde_json::to_value(&audit).map_err(unavailable)?;
    sqlx::query("INSERT INTO rd_replay_policy_catalog_audit_v2 (command_identity, administrator_identity, authentication_fact_digest, command_kind, predecessor_record_id, predecessor_head_record_id, result_record_id, content_identity, audit_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(command_identity)
        .bind(&administrator.identity)
        .bind(&administrator.authentication_fact_digest)
        .bind(command_kind)
        .bind(predecessor_record_id)
        .bind(predecessor_head_record_id)
        .bind(result_record_id)
        .bind(&content_identity)
        .bind(&audit_json)
        .bind(epoch_i64(now_epoch_ms)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    let payload_digest = canonical_json_digest("rd.replay-policy-catalog.audit.v2", &audit)?;
    sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(format!("rd-replay-policy-catalog-outbox-v2-{}", &payload_digest[7..]))
        .bind(command_identity)
        .bind(command_kind)
        .bind(payload_digest)
        .bind(audit_json)
        .bind(epoch_i64(now_epoch_ms)?)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
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
    let authority_is_exact: bool = sqlx::query_scalar(
        "SELECT SESSION_USER = 'rd_owner' AND (SELECT count(*) = 4 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND relation.relname = ANY($1) AND pg_catalog.pg_get_userbyid(relation.relowner) = 'rd_owner') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl WHERE namespace.nspname = 'public' AND relation.relname = ANY($1) AND acl.grantee <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'rd_owner'))",
    )
    .bind(CATALOG_TABLES_V2.as_slice())
    .fetch_one(pool)
    .await
    .map_err(unavailable)?;
    if !authority_is_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog PostgreSQL owner or ACL readback mismatch".to_owned(),
        ));
    }
    let guard = sqlx::query(
        "SELECT pg_catalog.pg_get_userbyid(procedure.proowner) AS owner, procedure.prosecdef, procedure.prosrc, procedure.proconfig, NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl WHERE acl.grantee <> procedure.proowner) AS acl_exact FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace WHERE namespace.nspname = 'rd_owner_api' AND procedure.proname = 'guard_replay_policy_catalog_mutation_v2' AND procedure.pronargs = 0",
    )
    .fetch_optional(pool)
    .await
    .map_err(unavailable)?
    .ok_or_else(|| {
        ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog mutation guard function is missing".to_owned(),
        )
    })?;
    let guard_owner: String = guard.try_get("owner").map_err(unavailable)?;
    let guard_is_security_definer: bool = guard.try_get("prosecdef").map_err(unavailable)?;
    let guard_acl_is_exact: bool = guard.try_get("acl_exact").map_err(unavailable)?;
    let guard_source: String = guard.try_get("prosrc").map_err(unavailable)?;
    let guard_configuration: Option<Vec<String>> =
        guard.try_get("proconfig").map_err(unavailable)?;
    if guard_owner != "rd_owner"
        || guard_is_security_definer
        || !guard_acl_is_exact
        || guard_source != CATALOG_MUTATION_GUARD_SOURCE_V2
        || guard_configuration.as_deref() != Some(&["search_path=pg_catalog".to_owned()])
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog mutation guard source readback mismatch".to_owned(),
        ));
    }
    let trigger_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_catalog.pg_trigger trigger_fact JOIN pg_catalog.pg_class relation ON relation.oid = trigger_fact.tgrelid JOIN pg_catalog.pg_proc procedure ON procedure.oid = trigger_fact.tgfoid JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace WHERE NOT trigger_fact.tgisinternal AND trigger_fact.tgenabled = 'O' AND trigger_fact.tgtype = 31 AND namespace.nspname = 'rd_owner_api' AND procedure.proname = 'guard_replay_policy_catalog_mutation_v2' AND relation.relname || ':' || trigger_fact.tgname = ANY($1)",
    )
    .bind([
        "rd_replay_policy_catalog_records_v2:rd_replay_policy_catalog_records_guard_v2",
        "rd_replay_policy_catalog_head_v2:rd_replay_policy_catalog_head_guard_v2",
        "rd_replay_policy_catalog_revocations_v2:rd_replay_policy_catalog_revocations_guard_v2",
        "rd_replay_policy_catalog_audit_v2:rd_replay_policy_catalog_audit_guard_v2",
        "rd_owner_outbox_v1:rd_replay_policy_catalog_outbox_guard_v2",
    ])
    .fetch_one(pool)
    .await
    .map_err(unavailable)?;
    if trigger_count != 5 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog mutation guard trigger readback mismatch".to_owned(),
        ));
    }
    Ok(())
}

async fn open_catalog_admin_guard(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    command_identity: &str,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let token = canonical_json_digest(
        "rd.replay-policy-catalog.mutation-guard.v2",
        &(
            &administrator.identity,
            &administrator.authentication_fact_digest,
            command_identity,
        ),
    )?;
    sqlx::query("SELECT pg_catalog.set_config($1, $2, true)")
        .bind(CATALOG_ADMIN_GUARD_SETTING_V2)
        .bind(token)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

async fn close_catalog_admin_guard(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    sqlx::query("SELECT pg_catalog.set_config($1, '', true)")
        .bind(CATALOG_ADMIN_GUARD_SETTING_V2)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

async fn lock_catalog(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
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
    use super::*;
    use crate::{
        product_edge::{ResearchRequestDisposition, ResearchRequestReceiptV1},
        trial_family::{TrialFamilyIndependenceDispositionV1, form_initial_family, verify_family},
        trial_family_postgres::{load_trial_family_in_transaction, persist_initial_family},
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };
    use vibe_testkit::postgres::{DedicatedPostgresTestDatabase, DedicatedPostgresTestMutation};

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_admin_and_family_formation_are_atomic_and_fail_closed() {
        let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
            .await
            .unwrap();
        let mutation = database.mutation();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(3)
            .connect(database.database_url())
            .await
            .unwrap();
        crate::trial_family_postgres::migrate(&pool).await.unwrap();

        verify_catalog_storage_authority(&pool).await.unwrap();
        let external_write_grants: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = ANY($1) AND grantee <> 'rd_owner'",
        )
        .bind(CATALOG_TABLES_V2.as_slice())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(external_write_grants, 0);

        for (table, query) in [
            (
                "rd_replay_policy_catalog_records_v2",
                "SELECT count(*) FROM rd_replay_policy_catalog_records_v2",
            ),
            (
                "rd_replay_policy_catalog_head_v2",
                "SELECT count(*) FROM rd_replay_policy_catalog_head_v2",
            ),
            (
                "rd_replay_policy_catalog_revocations_v2",
                "SELECT count(*) FROM rd_replay_policy_catalog_revocations_v2",
            ),
            (
                "rd_replay_policy_catalog_audit_v2",
                "SELECT count(*) FROM rd_replay_policy_catalog_audit_v2",
            ),
        ] {
            let count: i64 = sqlx::query_scalar(query).fetch_one(&pool).await.unwrap();
            assert_eq!(count, 0, "migration must not seed {table}");
        }

        let admin = AuthenticatedCatalogAdministratorV2::admit(
            "rd-catalog-test-administrator-v2",
            &format!("sha256:{}", "a".repeat(64)),
        )
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
        assert_direct_catalog_mutations_are_rejected(&pool).await;

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

        assert_zero_family_write_on_cross_splice(&pool).await;
        assert_zero_family_write_on_tamper(&mutation, &pool, second.catalog_record_id()).await;
        assert_zero_family_write_on_wrong_owner(&mutation, &pool, second.catalog_record_id()).await;
        assert_zero_family_write_on_wrong_head(&mutation, &pool).await;

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
        let before = family_row_counts(&pool).await;
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(&pool).await, before);

        let audit_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM rd_replay_policy_catalog_audit_v2")
                .fetch_one(&pool)
                .await
                .unwrap();
        let outbox_count: i64 = sqlx::query_scalar("SELECT count(*) FROM rd_owner_outbox_v1 WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(audit_count, 6);
        assert_eq!(outbox_count, 6);
        cleanup_catalog_for_disposable_test_only(&mutation, &pool).await;
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
        mutation: &DedicatedPostgresTestMutation<'_>,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let mut transaction = pool.begin().await.unwrap();
        open_disposable_poison_guard_for_test_only(mutation, &mut transaction).await;
        sqlx::query("UPDATE rd_replay_policy_catalog_records_v2 SET policy_digest = decode(repeat('00',32),'hex') WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_wrong_owner(
        mutation: &DedicatedPostgresTestMutation<'_>,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let mut transaction = pool.begin().await.unwrap();
        open_disposable_poison_guard_for_test_only(mutation, &mut transaction).await;
        sqlx::query("UPDATE rd_replay_policy_catalog_records_v2 SET owner_identity = 'wrong-owner' WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_wrong_head(
        mutation: &DedicatedPostgresTestMutation<'_>,
        pool: &PgPool,
    ) {
        let before = family_row_counts(pool).await;
        let mut transaction = pool.begin().await.unwrap();
        open_disposable_poison_guard_for_test_only(mutation, &mut transaction).await;
        sqlx::query("UPDATE rd_replay_policy_catalog_head_v2 SET catalog_version = 1 WHERE singleton = TRUE")
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_direct_catalog_mutations_are_rejected(pool: &PgPool) {
        for statement in [
            "UPDATE rd_replay_policy_catalog_records_v2 SET owner_identity = 'raw-writer' WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "DELETE FROM rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "UPDATE rd_replay_policy_catalog_head_v2 SET advanced_by = 'raw-writer' WHERE singleton = TRUE",
            "INSERT INTO rd_replay_policy_catalog_revocations_v2 (catalog_record_id, catalog_version, revoked_by, revoked_at_epoch_ms) VALUES ('catalog-policy-record-v2-1',1,'raw-writer',1)",
            "INSERT INTO rd_replay_policy_catalog_audit_v2 (command_identity, administrator_identity, authentication_fact_digest, command_kind, content_identity, audit_json, committed_at_epoch_ms) VALUES ('raw-command','raw-writer','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','RAW_WRITE','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',1)",
            "INSERT INTO rd_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ('raw-catalog-event','raw-command','REPLAY_POLICY_CATALOG_RAW_WRITE_V2','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',1)",
            "UPDATE rd_owner_outbox_v1 SET event_kind = 'RAW_WRITE' WHERE aggregate_identity = 'catalog-command-create-v2'",
            "DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = 'catalog-command-create-v2'",
        ] {
            let mut transaction = pool.begin().await.unwrap();
            let error = sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .expect_err("raw Catalog mutation must be rejected");
            assert_eq!(
                error.as_database_error().and_then(|error| error.code()),
                Some(std::borrow::Cow::Borrowed("42501"))
            );
            transaction.rollback().await.unwrap();
        }
    }

    /// Opens the poison capability only inside this disposable PostgreSQL test module. This is not
    /// an administration port and is absent from non-test builds.
    async fn open_disposable_poison_guard_for_test_only(
        _mutation: &DedicatedPostgresTestMutation<'_>,
        transaction: &mut Transaction<'_, Postgres>,
    ) {
        sqlx::query("SELECT pg_catalog.set_config($1, $2, true)")
            .bind(CATALOG_ADMIN_GUARD_SETTING_V2)
            .bind(format!("sha256:{}", "f".repeat(64)))
            .execute(&mut **transaction)
            .await
            .unwrap();
    }

    async fn cleanup_catalog_for_disposable_test_only(
        mutation: &DedicatedPostgresTestMutation<'_>,
        pool: &PgPool,
    ) {
        let mut transaction = pool.begin().await.unwrap();
        open_disposable_poison_guard_for_test_only(mutation, &mut transaction).await;
        for statement in [
            "DELETE FROM rd_replay_policy_catalog_revocations_v2",
            "DELETE FROM rd_replay_policy_catalog_head_v2",
            "DELETE FROM rd_replay_policy_catalog_audit_v2",
            "DELETE FROM rd_owner_outbox_v1 WHERE event_kind LIKE 'REPLAY_POLICY_CATALOG_%_V2'",
            "DELETE FROM rd_replay_policy_catalog_records_v2",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .unwrap();
        }
        transaction.commit().await.unwrap();
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
