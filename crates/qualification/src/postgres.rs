use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};

use crate::{
    ProtectedFeedbackFrontierReadbackV1, ProtectedFeedbackFrontierReceiptV1,
    ProtectedFeedbackResolutionV1, QualificationOwnerError, RdIndependenceBasisLocatorV1,
};

const CLOCK_EPOCH_V1: &str = "unix-epoch-ms-v1";
const PROJECTION_VALIDITY_MS: u64 = 600_000;
const PROJECTED_EVENT_KIND: &str = "QUALIFICATION_PROTECTED_FEEDBACK_PROJECTED_V1";

#[cfg(test)]
#[derive(Debug, Clone, Copy)]
struct CreateResponseTimingForTestV1 {
    projection_age_ms: u64,
    post_verify_delay_ms: i64,
}

#[derive(Debug, Clone)]
pub struct PostgresQualificationOwnerV1 {
    pool: PgPool,
}

impl PostgresQualificationOwnerV1 {
    pub async fn connect(database_url: &str) -> Result<Self, QualificationOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    /// Connects the runtime Qualification writer to deployment-provisioned custody.
    /// This path performs only read-only authority validation and never runs migration DDL.
    pub async fn connect_existing(database_url: &str) -> Result<Self, QualificationOwnerError> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(storage)?;
        let owner = Self { pool };
        owner.validate_existing().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), QualificationOwnerError> {
        self.validate_existing().await
    }

    async fn validate_existing(&self) -> Result<(), QualificationOwnerError> {
        let admitted: bool = sqlx::query_scalar(
            "WITH required(name,columns,index_count,constraint_count) AS (VALUES
               ('qualification_protected_feedback_projections_v1',ARRAY['projection_identity','basis_identity','principal','request_scope_json','resolution_state','source_sequence','source_cut','projection_digest','projection_json','receipt_json','committed_at_epoch_ms','valid_through_epoch_ms']::text[],2::bigint,1::bigint),
               ('qualification_protected_feedback_heads_v1',ARRAY['principal_scope_key','principal','request_scope_json','frontier_identity','frontier_digest','source_sequence','source_cut','committed_at_epoch_ms']::text[],2::bigint,3::bigint),
               ('qualification_owner_outbox_v1',ARRAY['event_identity','aggregate_identity','event_kind','payload_digest','payload_json','committed_at_epoch_ms']::text[],2::bigint,2::bigint)
             ) SELECT session_user='qualification_writer'
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname=session_user AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='qualification_owner' AND NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid IN (pg_catalog.to_regrole('qualification_writer')::oid,pg_catalog.to_regrole('qualification_owner')::oid) OR membership.member IN (pg_catalog.to_regrole('qualification_writer')::oid,pg_catalog.to_regrole('qualification_owner')::oid))
                AND pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CONNECT')
                AND NOT pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE,TEMPORARY')
                AND NOT pg_catalog.has_schema_privilege(session_user,'public','CREATE')
                AND pg_catalog.pg_get_userbyid((SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname='qualification_api'))='qualification_owner'
                AND (SELECT count(*)=4 AND count(*) FILTER (WHERE acl.grantee=namespace.nspowner AND NOT acl.is_grantable)=2 AND count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('qualification_writer')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 AND count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('rd_owner')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 FROM pg_catalog.pg_namespace namespace,LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl WHERE namespace.nspname='qualification_api')
                AND (SELECT pg_catalog.array_agg(namespace.nspname||':'||relation.relname||':'||relation.relkind::text||':'||relation.relpersistence::text||':'||pg_catalog.pg_get_userbyid(relation.relowner) ORDER BY namespace.nspname,relation.relname) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname LIKE 'qualification\\_%' ESCAPE '\\') IS NOT DISTINCT FROM ARRAY['public:qualification_owner_outbox_v1:r:p:qualification_owner','public:qualification_owner_outbox_v1_aggregate_identity_event_kind_key:i:p:qualification_owner','public:qualification_owner_outbox_v1_pkey:i:p:qualification_owner','public:qualification_protected_feedback_basis_history_v1:i:p:qualification_owner','public:qualification_protected_feedback_heads_v1:r:p:qualification_owner','public:qualification_protected_feedback_heads_v1_frontier_identity_key:i:p:qualification_owner','public:qualification_protected_feedback_heads_v1_pkey:i:p:qualification_owner','public:qualification_protected_feedback_projections_v1:r:p:qualification_owner','public:qualification_protected_feedback_projections_v1_pkey:i:p:qualification_owner']::text[]
                AND NOT EXISTS (SELECT 1 FROM required LEFT JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name) WHERE relation.oid IS NULL OR relation.relkind<>'r' OR relation.relpersistence<>'p' OR pg_catalog.pg_get_userbyid(relation.relowner)<>'qualification_owner' OR relation.relrowsecurity OR relation.relforcerowsecurity OR (SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)<>required.columns OR (SELECT count(*) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid=relation.oid)<>required.index_count OR (SELECT count(*) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid)<>required.constraint_count OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact LEFT JOIN pg_catalog.pg_depend dependency ON dependency.classid='pg_catalog.pg_trigger'::pg_catalog.regclass AND dependency.objid=trigger_fact.oid WHERE trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal) OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact WHERE rewrite_fact.ev_class=relation.oid) OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_fact WHERE policy_fact.polrelid=relation.oid) OR pg_catalog.obj_description(relation.oid,'pg_class') IS DISTINCT FROM 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object('columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid),'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(index_fact.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid=relation.oid))::text) OR (SELECT count(*)<>11 OR count(*) FILTER (WHERE acl.grantee=relation.relowner AND NOT acl.is_grantable)<>7 OR count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('qualification_writer')::oid AND NOT acl.is_grantable)<>4 FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl))
                AND NOT EXISTS (SELECT 1 FROM required JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name) WHERE (SELECT pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type) FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl WHERE acl.grantee=pg_catalog.to_regrole('qualification_writer')::oid AND NOT acl.is_grantable) IS DISTINCT FROM ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[])
                AND NOT EXISTS (SELECT 1 FROM required JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attnum>0 AND NOT attribute.attisdropped AND (attribute.attnum<>pg_catalog.array_position(required.columns,attribute.attname) OR pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)<>CASE WHEN attribute.attname IN ('request_scope_json','projection_json','receipt_json','payload_json') THEN 'jsonb' WHEN attribute.attname IN ('source_sequence','committed_at_epoch_ms','valid_through_epoch_ms') THEN 'bigint' ELSE 'text' END OR attribute.atttypmod<>-1 OR NOT attribute.attnotnull OR default_fact.oid IS NOT NULL OR attribute.attidentity<>'' OR attribute.attgenerated<>''))
                AND NOT EXISTS (SELECT 1 FROM required JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name) WHERE (SELECT pg_catalog.array_agg(constraint_fact.contype::text||':'||pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY constraint_fact.contype,pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid) IS DISTINCT FROM CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN ARRAY['p:PRIMARY KEY (projection_identity)']::text[] WHEN 'qualification_protected_feedback_heads_v1' THEN ARRAY['f:FOREIGN KEY (frontier_identity) REFERENCES qualification_protected_feedback_projections_v1(projection_identity)','p:PRIMARY KEY (principal_scope_key)','u:UNIQUE (frontier_identity)']::text[] ELSE ARRAY['p:PRIMARY KEY (event_identity)','u:UNIQUE (aggregate_identity, event_kind)']::text[] END)
                AND NOT EXISTS (SELECT 1 FROM required JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name) JOIN pg_catalog.pg_index index_fact ON index_fact.indrelid=relation.oid WHERE index_fact.indexprs IS NOT NULL OR index_fact.indpred IS NOT NULL OR (index_fact.indisprimary,index_fact.indisunique,ARRAY(SELECT pg_catalog.pg_get_indexdef(index_fact.indexrelid,ordinal,true) FROM pg_catalog.generate_series(1,index_fact.indnkeyatts) ordinal ORDER BY ordinal)) NOT IN ((true,true,ARRAY[CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN 'projection_identity' WHEN 'qualification_protected_feedback_heads_v1' THEN 'principal_scope_key' ELSE 'event_identity' END]::text[]),(false,CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN false ELSE true END,CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN ARRAY['basis_identity','committed_at_epoch_ms','projection_identity']::text[] WHEN 'qualification_protected_feedback_heads_v1' THEN ARRAY['frontier_identity']::text[] ELSE ARRAY['aggregate_identity','event_kind']::text[] END)) OR pg_catalog.pg_get_indexdef(index_fact.indexrelid) NOT IN (CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN 'CREATE UNIQUE INDEX qualification_protected_feedback_projections_v1_pkey ON public.qualification_protected_feedback_projections_v1 USING btree (projection_identity)' WHEN 'qualification_protected_feedback_heads_v1' THEN 'CREATE UNIQUE INDEX qualification_protected_feedback_heads_v1_pkey ON public.qualification_protected_feedback_heads_v1 USING btree (principal_scope_key)' ELSE 'CREATE UNIQUE INDEX qualification_owner_outbox_v1_pkey ON public.qualification_owner_outbox_v1 USING btree (event_identity)' END,CASE required.name WHEN 'qualification_protected_feedback_projections_v1' THEN 'CREATE INDEX qualification_protected_feedback_basis_history_v1 ON public.qualification_protected_feedback_projections_v1 USING btree (basis_identity, committed_at_epoch_ms, projection_identity)' WHEN 'qualification_protected_feedback_heads_v1' THEN 'CREATE UNIQUE INDEX qualification_protected_feedback_heads_v1_frontier_identity_key ON public.qualification_protected_feedback_heads_v1 USING btree (frontier_identity)' ELSE 'CREATE UNIQUE INDEX qualification_owner_outbox_v1_aggregate_identity_event_kind_key ON public.qualification_owner_outbox_v1 USING btree (aggregate_identity, event_kind)' END))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance WHERE inheritance.inhrelid IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required) OR inheritance.inhparent IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication publication WHERE publication.puballtables)
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_namespace publication_schema WHERE publication_schema.pnnspid=pg_catalog.to_regnamespace('public'))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint foreign_key WHERE foreign_key.contype='f' AND foreign_key.confrelid IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required) AND foreign_key.conrelid NOT IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency JOIN pg_catalog.pg_rewrite rewrite_fact ON dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass AND dependency.objid=rewrite_fact.oid WHERE dependency.refclassid='pg_catalog.pg_class'::pg_catalog.regclass AND dependency.refobjid IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required) AND rewrite_fact.ev_class NOT IN (SELECT pg_catalog.to_regclass('public.'||name) FROM required))
                AND NOT EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace
                    ON namespace.oid=relation.relnamespace
                  CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege_name
                  WHERE namespace.nspname='public'
                    AND relation.relkind IN ('r','p')
                    AND relation.relname LIKE 'rd\\_%' ESCAPE '\\'
                    AND pg_catalog.has_table_privilege(
                      current_user,
                      relation.oid,
                      privilege_name
                    )
                )
                AND pg_catalog.has_schema_privilege(current_user, 'rd_owner_api', 'USAGE')
                AND pg_catalog.has_function_privilege(current_user, 'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)', 'EXECUTE')
                AND NOT pg_catalog.pg_has_role(current_user, 'qualification_owner', 'MEMBER')
                AND NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE tableowner = current_user)
                AND NOT EXISTS (
                  SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = current_user
                    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
                )
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine WHERE routine.oid=pg_catalog.to_regprocedure('qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)') AND pg_catalog.pg_get_userbyid(routine.proowner)='qualification_owner' AND routine.prorettype=pg_catalog.to_regtype('jsonb') AND routine.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND routine.pronargs=6 AND routine.prosecdef AND routine.proisstrict AND routine.provolatile='v' AND routine.proparallel='u' AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_catalog.md5(routine.prosrc)='0df2d7dda2ac5d35a3711e0a4599ab99' AND pg_catalog.obj_description(routine.oid,'pg_proc')='vibe-source-md5:'||pg_catalog.md5(routine.prosrc) AND (SELECT pg_catalog.array_agg(role.rolname::text ORDER BY role.rolname) FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=ARRAY['qualification_owner','qualification_writer','rd_owner']::text[])",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;

        if !admitted {
            return Err(unavailable(
                "Qualification writer physical custody is unavailable",
            ));
        }
        Ok(())
    }

    /// Resolve the exact R&D basis and return its current Qualification-owned
    /// projection, appending one locked successor only when the latest exact
    /// projection is stale. The locator is never treated as evidence.
    ///
    /// Callers cannot supply the Qualification freshness cut:
    ///
    /// ```compile_fail
    /// use vibe_qualification::{PostgresQualificationOwnerV1, RdIndependenceBasisLocatorV1};
    /// fn caller_cut_is_rejected(
    ///     owner: &PostgresQualificationOwnerV1,
    ///     locator: &RdIndependenceBasisLocatorV1,
    /// ) {
    ///     let _ = owner.resolve_or_create_for_basis(locator, 1_u64);
    /// }
    /// ```
    pub async fn resolve_or_create_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        #[cfg(test)]
        return self.resolve_or_create_for_basis_inner(locator, None).await;

        #[cfg(not(test))]
        self.resolve_or_create_for_basis_inner(locator).await
    }

    async fn resolve_or_create_for_basis_inner(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
        #[cfg(test)] test_timing: Option<CreateResponseTimingForTestV1>,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let basis = load_rd_basis_in_transaction(&mut transaction, locator).await?;
        let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
        lock_principal_scope_in_transaction(&mut transaction, &principal_scope_key).await?;
        let history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;

        if let Some(existing) = history.projection_for_basis(&basis.basis_identity) {
            let owner_read_cut_epoch_ms =
                owner_clock_epoch_ms_in_transaction(&mut transaction).await?;

            if verify_projection_freshness(existing, owner_read_cut_epoch_ms).is_ok() {
                transaction.commit().await.map_err(storage)?;
                return Ok(existing.clone());
            }
        }

        let (
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
        ) = if let Some(head) = history.current_frontier.as_ref() {
            (
                ProtectedFeedbackResolutionV1::Frontier,
                head.source_sequence,
                head.source_cut.clone(),
                Some(head.projection_identity.clone()),
                Some(head.projection_digest.clone()),
            )
        } else {
            (
                ProtectedFeedbackResolutionV1::GenesisEmpty,
                0,
                "qualification-protected-feedback-cut-v1-0".to_string(),
                None,
                None,
            )
        };

        let owner_write_cut_epoch_ms =
            owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        #[cfg(test)]
        let projection_at_epoch_ms = if let Some(timing) = test_timing {
            owner_write_cut_epoch_ms
                .checked_sub(timing.projection_age_ms)
                .ok_or_else(|| unavailable("test projection age exceeds Owner write cut"))?
        } else {
            owner_write_cut_epoch_ms
        };
        #[cfg(not(test))]
        let projection_at_epoch_ms = owner_write_cut_epoch_ms;
        let projection = form_projection(
            &basis,
            resolution,
            source_sequence,
            source_cut,
            source_frontier_identity,
            source_frontier_digest,
            projection_at_epoch_ms,
        )?;
        persist_projection_in_transaction(
            &mut transaction,
            &projection,
            &principal_scope_key,
            resolution == ProtectedFeedbackResolutionV1::GenesisEmpty,
        )
        .await?;
        let verified_history = verify_scope_history_in_transaction(
            &mut transaction,
            &basis.principal,
            &basis.request_scope,
            &principal_scope_key,
        )
        .await?;
        let verified = verified_history
            .projection_for_basis(&basis.basis_identity)
            .ok_or_else(|| unavailable("committed Qualification projection missing"))?;

        #[cfg(test)]
        if let Some(timing) = test_timing
            && timing.post_verify_delay_ms > 0
        {
            sqlx::query("SELECT pg_catalog.pg_sleep($1::DOUBLE PRECISION / 1000.0)")
                .bind(timing.post_verify_delay_ms)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }

        let owner_response_cut_epoch_ms =
            owner_clock_epoch_ms_in_transaction(&mut transaction).await?;
        if let Err(e) = verify_projection_freshness(verified, owner_response_cut_epoch_ms) {
            transaction.rollback().await.map_err(storage)?;
            return Err(e);
        }
        let verified = verified.clone();
        transaction.commit().await.map_err(storage)?;
        Ok(verified)
    }

    #[cfg(test)]
    async fn resolve_or_create_for_basis_with_test_timing(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
        test_timing: CreateResponseTimingForTestV1,
    ) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
        self.resolve_or_create_for_basis_inner(locator, Some(test_timing))
            .await
    }

    pub async fn resolve_for_basis(
        &self,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let projection = admit_projection_in_transaction(&mut transaction, locator).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(projection)
    }

    pub async fn admit_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &RdIndependenceBasisLocatorV1,
    ) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
        admit_projection_in_transaction(transaction, locator).await
    }
}

/// Direct, locked Qualification Owner reread. The locator is never evidence;
/// only a sealed positive readback can leave this function.
pub async fn admit_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    let basis = load_rd_basis_in_transaction(transaction, locator).await?;
    let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_projection_for_basis_v1($1,$2,$3,$4,$5,$6)",
    )
    .bind(&basis.basis_identity)
    .bind(&basis.basis_digest)
    .bind(&basis.request_identity)
    .bind(&basis.principal)
    .bind(serde_json::to_value(&basis.request_scope).map_err(json_storage)?)
    .bind(&principal_scope_key)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let raw_envelope = raw_envelope
        .ok_or_else(|| unavailable("Qualification locked admission envelope unavailable"))?;
    let envelope: QualificationAdmissionEnvelopeV1 = decode_exact(&raw_envelope)?;
    verify_admission_envelope_in_transaction(
        transaction,
        &basis,
        &principal_scope_key,
        envelope,
        ProjectionSelectionV1::Current,
    )
    .await
}

/// Direct, locked historical Qualification Owner reread for terminal R&D
/// custody. The complete canonical history is still verified; only freshness
/// is deliberately not treated as authority for a new write.
pub async fn admit_historical_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
    projection_identity: &str,
    projection_digest: &str,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    let basis = load_rd_basis_in_transaction(transaction, locator).await?;
    let principal_scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_projection_for_basis_v1($1,$2,$3,$4,$5,$6)",
    )
    .bind(&basis.basis_identity)
    .bind(&basis.basis_digest)
    .bind(&basis.request_identity)
    .bind(&basis.principal)
    .bind(serde_json::to_value(&basis.request_scope).map_err(json_storage)?)
    .bind(&principal_scope_key)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let raw_envelope = raw_envelope
        .ok_or_else(|| unavailable("Qualification locked admission envelope unavailable"))?;
    let envelope: QualificationAdmissionEnvelopeV1 = decode_exact(&raw_envelope)?;
    verify_admission_envelope_in_transaction(
        transaction,
        &basis,
        &principal_scope_key,
        envelope,
        ProjectionSelectionV1::Historical {
            projection_identity,
            projection_digest,
        },
    )
    .await
}

enum ProjectionSelectionV1<'a> {
    Current,
    Historical {
        projection_identity: &'a str,
        projection_digest: &'a str,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationAdmissionEnvelopeV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    request_identity: String,
    principal: String,
    request_scope: Vec<String>,
    principal_scope_key: String,
    owner_cut_epoch_ms: i64,
    heads: Vec<QualificationHeadEnvelopeRowV1>,
    projections: Vec<QualificationProjectionEnvelopeRowV1>,
    outboxes: Vec<QualificationOutboxEnvelopeRowV1>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationProjectionEnvelopeRowV1 {
    projection_identity: String,
    basis_identity: String,
    principal: String,
    request_scope_json: serde_json::Value,
    resolution_state: String,
    source_sequence: i64,
    source_cut: String,
    projection_digest: String,
    projection_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
    valid_through_epoch_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationHeadEnvelopeRowV1 {
    principal_scope_key: String,
    principal: String,
    request_scope_json: serde_json::Value,
    frontier_identity: String,
    frontier_digest: String,
    source_sequence: i64,
    source_cut: String,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationOutboxEnvelopeRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

async fn verify_admission_envelope_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis: &StoredRdBasisV1,
    principal_scope_key: &str,
    envelope: QualificationAdmissionEnvelopeV1,
    selection: ProjectionSelectionV1<'_>,
) -> Result<Option<ProtectedFeedbackFrontierReadbackV1>, QualificationOwnerError> {
    if envelope.schema_version != 1
        || envelope.basis_identity != basis.basis_identity
        || envelope.basis_digest != basis.basis_digest
        || envelope.request_identity != basis.request_identity
        || envelope.principal != basis.principal
        || envelope.request_scope != basis.request_scope
        || envelope.principal_scope_key != principal_scope_key
    {
        return Err(unavailable(
            "Qualification admission envelope locator mismatch",
        ));
    }
    let owner_cut_epoch_ms = u64::try_from(envelope.owner_cut_epoch_ms).map_err(json_storage)?;
    let mut projections = Vec::with_capacity(envelope.projections.len());

    for row in &envelope.projections {
        projections.push(admit_projection_envelope_row_in_transaction(transaction, row).await?);
    }
    let projection_identities = projections
        .iter()
        .map(|projection| projection.projection_identity.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut outbox_aggregates = std::collections::BTreeSet::new();

    for row in &envelope.outboxes {
        let projection = projections
            .iter()
            .find(|projection| projection.projection_identity == row.aggregate_identity)
            .ok_or_else(|| unavailable("Qualification projection outbox is orphaned"))?;

        if !outbox_aggregates.insert(row.aggregate_identity.as_str()) {
            return Err(unavailable("Qualification projection outbox is ambiguous"));
        }
        verify_outbox_envelope_row(row, projection)?;
    }

    if outbox_aggregates != projection_identities {
        return Err(unavailable("Qualification projection outbox unavailable"));
    }

    if envelope.heads.len() > 1 {
        return Err(unavailable("Qualification feedback head is ambiguous"));
    }
    let current_frontier = envelope
        .heads
        .first()
        .map(|head| {
            verify_head_envelope_row(
                head,
                principal_scope_key,
                &basis.principal,
                &basis.request_scope,
                &projections,
            )
        })
        .transpose()?;

    if current_frontier.is_none() && !projections.is_empty() {
        return Err(unavailable(
            "Qualification feedback history exists without a head",
        ));
    }
    verify_projection_chain(&projections, current_frontier.as_ref())?;
    let history = VerifiedScopeHistoryV1 {
        projections,
        current_frontier,
    };
    let projection = match selection {
        ProjectionSelectionV1::Current => {
            let projection = history.projection_for_basis(&basis.basis_identity);

            if let Some(projection) = projection {
                verify_projection_freshness(projection, owner_cut_epoch_ms)?;
            }
            projection
        }
        ProjectionSelectionV1::Historical {
            projection_identity,
            projection_digest,
        } => {
            let mut matches = history.projections.iter().filter(|projection| {
                projection.basis_identity == basis.basis_identity
                    && projection.projection_identity == projection_identity
                    && projection.projection_digest == projection_digest
            });
            let projection = matches.next();

            if matches.next().is_some() {
                return Err(unavailable(
                    "Qualification historical projection is ambiguous",
                ));
            }
            projection
        }
    };
    Ok(projection.cloned())
}

async fn owner_clock_epoch_ms_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, QualificationOwnerError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::BIGINT",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)
    .and_then(|value| u64::try_from(value).map_err(json_storage))
}

async fn admit_projection_row_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    row: &PgRow,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let projection_json: serde_json::Value = row.try_get("projection_json").map_err(storage)?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(storage)?;
    let stored: StoredProjectionV1 = decode_exact(&projection_json)?;
    let basis = load_rd_basis_by_locator_fields_in_transaction(
        transaction,
        &stored.basis_identity,
        &stored.basis_digest,
        &stored.principal,
        &stored.request_scope,
    )
    .await?;
    let receipt: StoredProjectionReceiptV1 = decode_exact(&receipt_json)?;
    let expected = form_projection(
        &basis,
        stored.resolution,
        stored.source_sequence,
        stored.source_cut.clone(),
        stored.source_frontier_identity.clone(),
        stored.source_frontier_digest.clone(),
        stored.projection_at_epoch_ms,
    )?;

    if expected.as_stored() != stored || expected.receipt_as_stored() != receipt {
        return Err(unavailable(
            "Qualification projection canonical meaning mismatch",
        ));
    }

    let row_scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let row_sequence: i64 = row.try_get("source_sequence").map_err(storage)?;
    let row_committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    let row_valid_through: i64 = row.try_get("valid_through_epoch_ms").map_err(storage)?;
    if row
        .try_get::<String, _>("projection_identity")
        .map_err(storage)?
        != expected.projection_identity
        || row
            .try_get::<String, _>("basis_identity")
            .map_err(storage)?
            != basis.basis_identity
        || row.try_get::<String, _>("principal").map_err(storage)? != basis.principal
        || row_scope != basis.request_scope
        || row
            .try_get::<String, _>("resolution_state")
            .map_err(storage)?
            != resolution_name(expected.resolution)
        || u64::try_from(row_sequence).map_err(json_storage)? != expected.source_sequence
        || row.try_get::<String, _>("source_cut").map_err(storage)? != expected.source_cut
        || row
            .try_get::<String, _>("projection_digest")
            .map_err(storage)?
            != expected.projection_digest
        || u64::try_from(row_committed_at).map_err(json_storage)?
            != expected.receipt.committed_at_epoch_ms
        || u64::try_from(row_valid_through).map_err(json_storage)?
            != expected.valid_through_epoch_ms
    {
        return Err(unavailable("Qualification projection row mismatch"));
    }

    Ok(expected)
}

async fn admit_projection_envelope_row_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    row: &QualificationProjectionEnvelopeRowV1,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let stored: StoredProjectionV1 = decode_exact(&row.projection_json)?;
    let basis = load_rd_basis_by_locator_fields_in_transaction(
        transaction,
        &stored.basis_identity,
        &stored.basis_digest,
        &stored.principal,
        &stored.request_scope,
    )
    .await?;
    verify_projection_envelope_row(row, &basis)
}

fn verify_projection_envelope_row(
    row: &QualificationProjectionEnvelopeRowV1,
    basis: &StoredRdBasisV1,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let stored: StoredProjectionV1 = decode_exact(&row.projection_json)?;
    let receipt: StoredProjectionReceiptV1 = decode_exact(&row.receipt_json)?;
    let expected = form_projection(
        basis,
        stored.resolution,
        stored.source_sequence,
        stored.source_cut.clone(),
        stored.source_frontier_identity.clone(),
        stored.source_frontier_digest.clone(),
        stored.projection_at_epoch_ms,
    )?;
    let row_scope: Vec<String> = decode_exact(&row.request_scope_json)?;

    if expected.as_stored() != stored
        || expected.receipt_as_stored() != receipt
        || row.projection_identity != expected.projection_identity
        || row.basis_identity != basis.basis_identity
        || row.principal != basis.principal
        || row_scope != basis.request_scope
        || row.resolution_state != resolution_name(expected.resolution)
        || u64::try_from(row.source_sequence).map_err(json_storage)? != expected.source_sequence
        || row.source_cut != expected.source_cut
        || row.projection_digest != expected.projection_digest
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != expected.receipt.committed_at_epoch_ms
        || u64::try_from(row.valid_through_epoch_ms).map_err(json_storage)?
            != expected.valid_through_epoch_ms
    {
        return Err(unavailable(
            "Qualification admission envelope projection mismatch",
        ));
    }
    Ok(expected)
}

fn verify_head_envelope_row(
    row: &QualificationHeadEnvelopeRowV1,
    principal_scope_key: &str,
    principal: &str,
    request_scope: &[String],
    projections: &[ProtectedFeedbackFrontierReadbackV1],
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let scope: Vec<String> = decode_exact(&row.request_scope_json)?;
    let mut matching = projections
        .iter()
        .filter(|projection| projection.projection_identity == row.frontier_identity);
    let projection = matching
        .next()
        .ok_or_else(|| unavailable("Qualification feedback head projection unavailable"))?;

    if matching.next().is_some()
        || row.principal_scope_key != principal_scope_key
        || row.principal != principal
        || scope != request_scope
        || projection.principal != principal
        || projection.request_scope != request_scope
        || row.frontier_digest != projection.projection_digest
        || u64::try_from(row.source_sequence).map_err(json_storage)? != projection.source_sequence
        || row.source_cut != projection.source_cut
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification feedback head mismatch"));
    }
    Ok(projection.clone())
}

fn verify_outbox_envelope_row(
    row: &QualificationOutboxEnvelopeRowV1,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;

    if row.event_identity != identity("qualification-owner-event-v1", &payload_digest)
        || row.aggregate_identity != projection.projection_identity
        || row.event_kind != PROJECTED_EVENT_KIND
        || row.payload_digest != payload_digest
        || row.payload_json != projection_json
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification projection outbox mismatch"));
    }
    Ok(())
}

#[derive(Debug)]
pub(crate) struct VerifiedScopeHistoryV1 {
    projections: Vec<ProtectedFeedbackFrontierReadbackV1>,
    current_frontier: Option<ProtectedFeedbackFrontierReadbackV1>,
}

impl VerifiedScopeHistoryV1 {
    fn projection_for_basis(
        &self,
        basis_identity: &str,
    ) -> Option<&ProtectedFeedbackFrontierReadbackV1> {
        let mut cursor = self.current_frontier.as_ref();

        while let Some(projection) = cursor {
            if projection.basis_identity == basis_identity {
                return Some(projection);
            }
            cursor = projection
                .source_frontier_identity
                .as_deref()
                .and_then(|identity| {
                    self.projections
                        .iter()
                        .find(|candidate| candidate.projection_identity == identity)
                });
        }
        None
    }
}

pub(crate) async fn lock_principal_scope_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal_scope_key: &str,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(principal_scope_key)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

pub(crate) async fn verify_scope_history_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    principal: &str,
    request_scope: &[String],
    principal_scope_key: &str,
) -> Result<VerifiedScopeHistoryV1, QualificationOwnerError> {
    let head_rows = sqlx::query("SELECT principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1 FOR UPDATE")
        .bind(principal_scope_key)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if head_rows.len() > 1 {
        return Err(unavailable("Qualification feedback head is ambiguous"));
    }

    let projection_rows = sqlx::query("SELECT projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms FROM qualification_protected_feedback_projections_v1 ORDER BY projection_identity FOR SHARE")
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let mut all_projections = Vec::with_capacity(projection_rows.len());

    for row in &projection_rows {
        all_projections.push(admit_projection_row_in_transaction(transaction, row).await?);
    }

    let projection_identities = all_projections
        .iter()
        .map(|projection| projection.projection_identity.clone())
        .collect::<Vec<_>>();
    let outbox_rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM qualification_owner_outbox_v1 WHERE event_kind = $1 OR aggregate_identity = ANY($2) ORDER BY event_identity FOR SHARE")
        .bind(PROJECTED_EVENT_KIND)
        .bind(&projection_identities)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let mut outbox_aggregates = std::collections::BTreeSet::new();

    for row in &outbox_rows {
        let aggregate_identity: String = row.try_get("aggregate_identity").map_err(storage)?;
        let projection = all_projections
            .iter()
            .find(|projection| projection.projection_identity == aggregate_identity)
            .ok_or_else(|| unavailable("Qualification projection outbox is orphaned"))?;

        if !outbox_aggregates.insert(aggregate_identity) {
            return Err(unavailable("Qualification projection outbox is ambiguous"));
        }
        verify_outbox_row(row, projection)?;
    }

    if outbox_aggregates.len() != all_projections.len() {
        return Err(unavailable("Qualification projection outbox unavailable"));
    }

    let projections = all_projections
        .into_iter()
        .filter(|projection| {
            projection.principal == principal && projection.request_scope == request_scope
        })
        .collect::<Vec<_>>();
    let current_frontier = match head_rows.first() {
        Some(head) => Some(verify_head_row(
            head,
            principal,
            request_scope,
            &projections,
        )?),
        None if projections.is_empty() => None,
        None => {
            return Err(unavailable(
                "Qualification feedback history exists without a head",
            ));
        }
    };

    verify_projection_chain(&projections, current_frontier.as_ref())?;

    Ok(VerifiedScopeHistoryV1 {
        projections,
        current_frontier,
    })
}

fn verify_projection_chain(
    projections: &[ProtectedFeedbackFrontierReadbackV1],
    current_frontier: Option<&ProtectedFeedbackFrontierReadbackV1>,
) -> Result<(), QualificationOwnerError> {
    if let Some(frontier) = current_frontier {
        let mut visited = std::collections::BTreeSet::new();
        let mut cursor = frontier;
        loop {
            if !visited.insert(cursor.projection_identity.as_str()) {
                return Err(unavailable("Qualification projection history has a cycle"));
            }

            match cursor.resolution {
                ProtectedFeedbackResolutionV1::GenesisEmpty => {
                    if cursor.source_sequence != 0
                        || cursor.source_cut != "qualification-protected-feedback-cut-v1-0"
                        || cursor.source_frontier_identity.is_some()
                        || cursor.source_frontier_digest.is_some()
                    {
                        return Err(unavailable("Qualification genesis projection is malformed"));
                    }
                    break;
                }
                ProtectedFeedbackResolutionV1::Frontier => {
                    let predecessor_identity = cursor
                        .source_frontier_identity
                        .as_deref()
                        .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
                    let predecessor = projections
                        .iter()
                        .find(|projection| projection.projection_identity == predecessor_identity)
                        .ok_or_else(|| {
                            unavailable("Qualification frontier predecessor unavailable")
                        })?;

                    if cursor.source_frontier_digest.as_deref()
                        != Some(predecessor.projection_digest.as_str())
                        || cursor.source_sequence != predecessor.source_sequence
                        || cursor.source_cut != predecessor.source_cut
                    {
                        return Err(unavailable("Qualification frontier predecessor mismatch"));
                    }
                    cursor = predecessor;
                }
            }
        }

        if visited.len() != projections.len() {
            return Err(unavailable(
                "Qualification projection history has an orphan or duplicate branch",
            ));
        }
    }
    Ok(())
}

fn verify_projection_freshness(
    projection: &ProtectedFeedbackFrontierReadbackV1,
    owner_cut_epoch_ms: u64,
) -> Result<(), QualificationOwnerError> {
    if owner_cut_epoch_ms < projection.projection_at_epoch_ms
        || owner_cut_epoch_ms >= projection.valid_through_epoch_ms
    {
        return Err(unavailable("Qualification projection is stale"));
    }
    Ok(())
}

pub(crate) async fn load_rd_basis_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &RdIndependenceBasisLocatorV1,
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    let basis = load_rd_basis_by_locator_fields_in_transaction(
        transaction,
        &locator.basis_identity,
        &locator.basis_digest,
        &locator.principal,
        &locator.request_scope,
    )
    .await?;

    if locator.request_identity != basis.request_identity {
        return Err(unavailable("R&D Independence Basis locator mismatch"));
    }
    Ok(basis)
}

async fn load_rd_basis_by_locator_fields_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    basis_identity: &str,
    basis_digest: &str,
    principal: &str,
    request_scope: &[String],
) -> Result<StoredRdBasisV1, QualificationOwnerError> {
    let raw_envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT rd_owner_api.lock_independence_basis_for_qualification_v1($1,$2,$3,$4)",
    )
    .bind(basis_identity)
    .bind(basis_digest)
    .bind(principal)
    .bind(serde_json::to_value(request_scope).map_err(json_storage)?)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let envelope: LockedRdBasisEnvelopeV1 = decode_exact(
        &raw_envelope.ok_or_else(|| unavailable("R&D Independence Basis unavailable"))?,
    )?;

    if envelope.schema_version != 1 {
        return Err(unavailable("R&D Independence Basis envelope mismatch"));
    }
    let row = envelope.basis;
    let basis: StoredRdBasisV1 = decode_exact(&row.basis_json)?;
    let receipt: StoredRdBasisReceiptV1 = decode_exact(&row.receipt_json)?;
    verify_rd_basis(&basis, &receipt)?;
    let row_scope: Vec<String> = decode_exact(&row.request_scope_json)?;
    if row.basis_identity != basis.basis_identity
        || row.request_identity != basis.request_identity
        || row.principal != basis.principal
        || row_scope != basis.request_scope
        || row.lineage_digest != basis.lineage_digest
        || row.basis_digest != basis.basis_digest
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != receipt.committed_at_epoch_ms
    {
        return Err(unavailable("R&D Independence Basis row mismatch"));
    }
    verify_rd_basis_outbox(&envelope.outbox, &basis, &receipt)?;

    if basis_identity != basis.basis_identity
        || basis_digest != basis.basis_digest
        || principal != basis.principal
        || request_scope != basis.request_scope
    {
        return Err(unavailable("R&D Independence Basis locator mismatch"));
    }
    Ok(basis)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisEnvelopeV1 {
    schema_version: u32,
    basis: LockedRdBasisRowV1,
    outbox: LockedRdBasisOutboxRowV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisRowV1 {
    basis_identity: String,
    request_identity: String,
    principal: String,
    request_scope_json: serde_json::Value,
    lineage_digest: String,
    basis_digest: String,
    basis_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedRdBasisOutboxRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RdBasisOutboxPayloadV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    receipt_identity: String,
    principal: String,
    request_scope: Vec<String>,
    lineage_digest: String,
}

fn verify_rd_basis_outbox(
    row: &LockedRdBasisOutboxRowV1,
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let payload: RdBasisOutboxPayloadV1 = decode_exact(&row.payload_json)?;
    let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload)?;

    if payload.schema_version != 1
        || payload.basis_identity != basis.basis_identity
        || payload.basis_digest != basis.basis_digest
        || payload.receipt_identity != receipt.receipt_identity
        || payload.principal != basis.principal
        || payload.request_scope != basis.request_scope
        || payload.lineage_digest != basis.lineage_digest
        || row.event_identity != identity("rd-owner-event-v1", &payload_digest)
        || row.aggregate_identity != basis.basis_identity
        || row.event_kind != "INDEPENDENCE_BASIS_PRECOMMITTED_V1"
        || row.payload_digest != payload_digest
        || u64::try_from(row.committed_at_epoch_ms).map_err(json_storage)?
            != receipt.committed_at_epoch_ms
    {
        return Err(unavailable("R&D Independence Basis outbox mismatch"));
    }
    Ok(())
}

async fn persist_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
    principal_scope_key: &str,
    is_genesis: bool,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let receipt_json =
        serde_json::to_value(projection.receipt_as_stored()).map_err(json_storage)?;
    sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity, basis_identity, principal, request_scope_json, resolution_state, source_sequence, source_cut, projection_digest, projection_json, receipt_json, committed_at_epoch_ms, valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(&projection.projection_identity)
        .bind(&projection.basis_identity)
        .bind(&projection.principal)
        .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
        .bind(resolution_name(projection.resolution))
        .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
        .bind(&projection.source_cut)
        .bind(&projection.projection_digest)
        .bind(&projection_json)
        .bind(receipt_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .bind(i64::try_from(projection.valid_through_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;

    if is_genesis {
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key, principal, request_scope_json, frontier_identity, frontier_digest, source_sequence, source_cut, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(principal_scope_key)
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    } else {
        let predecessor_identity = projection
            .source_frontier_identity
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor missing"))?;
        let predecessor_digest = projection
            .source_frontier_digest
            .as_deref()
            .ok_or_else(|| unavailable("Qualification frontier predecessor digest missing"))?;
        let updated = sqlx::query("UPDATE qualification_protected_feedback_heads_v1 SET principal = $1, request_scope_json = $2, frontier_identity = $3, frontier_digest = $4, source_sequence = $5, source_cut = $6, committed_at_epoch_ms = $7 WHERE principal_scope_key = $8 AND frontier_identity = $9 AND frontier_digest = $10")
            .bind(&projection.principal)
            .bind(serde_json::to_value(&projection.request_scope).map_err(json_storage)?)
            .bind(&projection.projection_identity)
            .bind(&projection.projection_digest)
            .bind(i64::try_from(projection.source_sequence).map_err(json_storage)?)
            .bind(&projection.source_cut)
            .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
            .bind(principal_scope_key)
            .bind(predecessor_identity)
            .bind(predecessor_digest)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(unavailable("Qualification feedback head changed"));
        }
    }

    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let event_identity = identity("qualification-owner-event-v1", &payload_digest);
    sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(event_identity)
        .bind(&projection.projection_identity)
        .bind(PROJECTED_EVENT_KIND)
        .bind(payload_digest)
        .bind(projection_json)
        .bind(i64::try_from(projection.receipt.committed_at_epoch_ms).map_err(json_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn verify_head_row(
    row: &PgRow,
    principal: &str,
    request_scope: &[String],
    projections: &[ProtectedFeedbackFrontierReadbackV1],
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(storage)?,
    )?;
    let frontier_identity: String = row.try_get("frontier_identity").map_err(storage)?;
    let mut matching = projections
        .iter()
        .filter(|projection| projection.projection_identity == frontier_identity);
    let projection = matching
        .next()
        .ok_or_else(|| unavailable("Qualification feedback head projection unavailable"))?;

    if matching.next().is_some() {
        return Err(unavailable(
            "Qualification feedback head projection is ambiguous",
        ));
    }
    let sequence: i64 = row.try_get("source_sequence").map_err(storage)?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;

    if row.try_get::<String, _>("principal").map_err(storage)? != principal
        || scope != request_scope
        || projection.principal != principal
        || projection.request_scope != request_scope
        || row
            .try_get::<String, _>("frontier_digest")
            .map_err(storage)?
            != projection.projection_digest
        || u64::try_from(sequence).map_err(json_storage)? != projection.source_sequence
        || row.try_get::<String, _>("source_cut").map_err(storage)? != projection.source_cut
        || u64::try_from(committed_at).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification feedback head mismatch"));
    }
    Ok(projection.clone())
}

fn verify_outbox_row(
    row: &PgRow,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let projection_json = serde_json::to_value(projection.as_stored()).map_err(json_storage)?;
    let payload_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;
    let committed_at: i64 = row.try_get("committed_at_epoch_ms").map_err(storage)?;
    if row
        .try_get::<String, _>("event_identity")
        .map_err(storage)?
        != identity("qualification-owner-event-v1", &payload_digest)
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != projection.projection_identity
        || row.try_get::<String, _>("event_kind").map_err(storage)? != PROJECTED_EVENT_KIND
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || row
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(storage)?
            != projection_json
        || u64::try_from(committed_at).map_err(json_storage)?
            != projection.receipt.committed_at_epoch_ms
    {
        return Err(unavailable("Qualification projection outbox mismatch"));
    }
    Ok(())
}

fn form_projection(
    basis: &StoredRdBasisV1,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    form_projection_for_basis(
        &basis.principal,
        &basis.request_scope,
        &basis.basis_identity,
        &basis.basis_digest,
        resolution,
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        now_epoch_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_projection_for_basis(
    principal: &str,
    request_scope: &[String],
    basis_identity: &str,
    basis_digest: &str,
    resolution: ProtectedFeedbackResolutionV1,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    now_epoch_ms: u64,
) -> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let meaning = ProjectionMeaningV1 {
        schema_version: 1,
        resolution,
        principal,
        request_scope,
        basis_identity,
        basis_digest,
        source_sequence,
        source_cut: &source_cut,
        source_frontier_identity: source_frontier_identity.as_deref(),
        source_frontier_digest: source_frontier_digest.as_deref(),
        clock_epoch: CLOCK_EPOCH_V1,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
    };
    let projection_digest =
        canonical_digest("qualification.protected-feedback-frontier.v1", &meaning)?;
    let projection_identity = identity(
        "qualification-protected-feedback-frontier-v1",
        &projection_digest,
    );
    let receipt_meaning = ProjectionReceiptMeaningV1 {
        schema_version: 1,
        projection_identity: &projection_identity,
        projection_digest: &projection_digest,
        committed_at_epoch_ms: now_epoch_ms,
    };
    let receipt_digest = canonical_digest(
        "qualification.protected-feedback-frontier-receipt.v1",
        &receipt_meaning,
    )?;
    Ok(ProtectedFeedbackFrontierReadbackV1 {
        schema_version: 1,
        projection_identity: projection_identity.clone(),
        projection_digest: projection_digest.clone(),
        resolution,
        principal: principal.to_string(),
        request_scope: request_scope.to_vec(),
        basis_identity: basis_identity.to_string(),
        basis_digest: basis_digest.to_string(),
        source_sequence,
        source_cut,
        source_frontier_identity,
        source_frontier_digest,
        clock_epoch: CLOCK_EPOCH_V1.to_string(),
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(PROJECTION_VALIDITY_MS),
        receipt: ProtectedFeedbackFrontierReceiptV1 {
            schema_version: 1,
            receipt_identity: identity(
                "qualification-protected-feedback-frontier-receipt-v1",
                &receipt_digest,
            ),
            projection_identity,
            projection_digest,
            committed_at_epoch_ms: now_epoch_ms,
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisV1 {
    pub(crate) schema_version: u32,
    pub(crate) basis_identity: String,
    pub(crate) request_identity: String,
    pub(crate) principal: String,
    pub(crate) request_scope: Vec<String>,
    pub(crate) rationale_digest: String,
    pub(crate) independence_disposition: StoredIndependenceDispositionV1,
    pub(crate) lineage_resolution: StoredLineageResolutionV1,
    pub(crate) semantic_predecessor_frontier: Vec<String>,
    pub(crate) lineage_digest: String,
    pub(crate) basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredIndependenceDispositionV1 {
    Independent,
    Related,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StoredLineageResolutionV1 {
    GenesisEmpty,
    CompleteFrontier,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRdBasisReceiptV1 {
    pub(crate) schema_version: u32,
    pub(crate) receipt_identity: String,
    pub(crate) basis_identity: String,
    pub(crate) basis_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
}

fn verify_rd_basis(
    basis: &StoredRdBasisV1,
    receipt: &StoredRdBasisReceiptV1,
) -> Result<(), QualificationOwnerError> {
    let meaning = RdBasisMeaningV1 {
        schema_version: basis.schema_version,
        request_identity: &basis.request_identity,
        principal: &basis.principal,
        request_scope: &basis.request_scope,
        rationale_digest: &basis.rationale_digest,
        independence_disposition: &basis.independence_disposition,
        lineage_resolution: &basis.lineage_resolution,
        semantic_predecessor_frontier: &basis.semantic_predecessor_frontier,
        lineage_digest: &basis.lineage_digest,
    };
    let digest = canonical_digest("rd.independence-basis.v1", &meaning)?;
    let receipt_meaning = RdBasisReceiptMeaningV1 {
        schema_version: 1,
        basis_identity: &basis.basis_identity,
        basis_digest: &basis.basis_digest,
        committed_at_epoch_ms: receipt.committed_at_epoch_ms,
    };
    let receipt_digest = canonical_digest("rd.independence-basis-receipt.v1", &receipt_meaning)?;
    if basis.schema_version != 1
        || basis.basis_digest != digest
        || basis.basis_identity != identity("rd-independence-basis-v1", &digest)
        || receipt.schema_version != 1
        || receipt.basis_identity != basis.basis_identity
        || receipt.basis_digest != basis.basis_digest
        || receipt.receipt_identity != identity("rd-independence-basis-receipt-v1", &receipt_digest)
        || matches!(
            basis.lineage_resolution,
            StoredLineageResolutionV1::GenesisEmpty
        ) != basis.semantic_predecessor_frontier.is_empty()
        || matches!(
            basis.independence_disposition,
            StoredIndependenceDispositionV1::Independent
        ) != basis.semantic_predecessor_frontier.is_empty()
    {
        return Err(unavailable("R&D Independence Basis canonical mismatch"));
    }
    Ok(())
}

#[derive(Serialize)]
struct RdBasisMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    rationale_digest: &'a str,
    independence_disposition: &'a StoredIndependenceDispositionV1,
    lineage_resolution: &'a StoredLineageResolutionV1,
    semantic_predecessor_frontier: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Serialize)]
struct RdBasisReceiptMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionMeaningV1<'a> {
    schema_version: u32,
    resolution: ProtectedFeedbackResolutionV1,
    principal: &'a str,
    request_scope: &'a [String],
    basis_identity: &'a str,
    basis_digest: &'a str,
    source_sequence: u64,
    source_cut: &'a str,
    source_frontier_identity: Option<&'a str>,
    source_frontier_digest: Option<&'a str>,
    clock_epoch: &'a str,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Serialize)]
struct ProjectionReceiptMeaningV1<'a> {
    schema_version: u32,
    projection_identity: &'a str,
    projection_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionV1 {
    schema_version: u32,
    projection_identity: String,
    projection_digest: String,
    resolution: ProtectedFeedbackResolutionV1,
    principal: String,
    request_scope: Vec<String>,
    basis_identity: String,
    basis_digest: String,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    clock_epoch: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectionReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    projection_identity: String,
    projection_digest: String,
    committed_at_epoch_ms: u64,
}

impl ProtectedFeedbackFrontierReadbackV1 {
    pub(crate) fn as_stored(&self) -> StoredProjectionV1 {
        StoredProjectionV1 {
            schema_version: self.schema_version,
            projection_identity: self.projection_identity.clone(),
            projection_digest: self.projection_digest.clone(),
            resolution: self.resolution,
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
            basis_identity: self.basis_identity.clone(),
            basis_digest: self.basis_digest.clone(),
            source_sequence: self.source_sequence,
            source_cut: self.source_cut.clone(),
            source_frontier_identity: self.source_frontier_identity.clone(),
            source_frontier_digest: self.source_frontier_digest.clone(),
            clock_epoch: self.clock_epoch.clone(),
            projection_at_epoch_ms: self.projection_at_epoch_ms,
            valid_through_epoch_ms: self.valid_through_epoch_ms,
        }
    }

    pub(crate) fn receipt_as_stored(&self) -> StoredProjectionReceiptV1 {
        StoredProjectionReceiptV1 {
            schema_version: self.receipt.schema_version,
            receipt_identity: self.receipt.receipt_identity.clone(),
            projection_identity: self.receipt.projection_identity.clone(),
            projection_digest: self.receipt.projection_digest.clone(),
            committed_at_epoch_ms: self.receipt.committed_at_epoch_ms,
        }
    }
}

pub(crate) fn resolution_name(value: ProtectedFeedbackResolutionV1) -> &'static str {
    match value {
        ProtectedFeedbackResolutionV1::GenesisEmpty => "GENESIS_EMPTY",
        ProtectedFeedbackResolutionV1::Frontier => "FRONTIER",
    }
}

pub(crate) fn principal_scope_key(
    principal: &str,
    request_scope: &[String],
) -> Result<String, QualificationOwnerError> {
    canonical_digest(
        "qualification.principal-request-scope.v1",
        &(principal, request_scope),
    )
}

pub(crate) fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, QualificationOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub(crate) fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

pub(crate) fn decode_exact<T>(value: &serde_json::Value) -> Result<T, QualificationOwnerError>
where
    T: serde::de::DeserializeOwned + Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(unavailable("stored JSON is not canonical for its schema"));
    }
    Ok(decoded)
}

#[allow(clippy::needless_pass_by_value)] // exact `map_err` adapter keeps every SQL boundary uniform
fn storage(error: sqlx::Error) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn json_storage(error: impl Display) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn unavailable(error: impl Into<String>) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(error.into())
}

#[cfg(test)]
mod postgres_tests {
    use rstest::rstest;

    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[rstest]
    fn existing_connection_path_contains_no_migration_or_ddl() {
        let source = include_str!("postgres.rs");
        let existing = source
            .split("pub async fn connect_existing")
            .nth(1)
            .expect("existing Qualification connection")
            .split("async fn migrate")
            .next()
            .expect("existing connection boundary");
        assert!(existing.contains("validate_existing"));
        assert!(!existing.contains(".migrate()"));
        assert!(!existing.contains("CREATE "));
        assert!(!existing.contains("ALTER "));
        assert!(!existing.contains("DROP "));
        assert!(source.contains("vibe-closed-relation-v2:"));
        assert!(source.contains("pg_catalog.pg_trigger"));
        assert!(source.contains("pg_catalog.pg_rewrite"));
        assert!(source.contains("pg_catalog.pg_policy"));
        assert!(source.contains("pg_catalog.pg_depend"));
        assert!(source.contains("pg_catalog.format_type"));
        assert!(source.contains("pg_catalog.pg_get_constraintdef"));
        assert!(source.contains("pg_catalog.pg_get_indexdef"));
        assert!(source.contains("pg_catalog.pg_inherits"));
        assert!(source.contains("pg_catalog.pg_publication_rel"));
        assert!(source.contains("pg_catalog.pg_publication_namespace"));
        assert!(source.contains("public:qualification_owner_outbox_v1:r:p:qualification_owner"));
        assert!(source.contains("0df2d7dda2ac5d35a3711e0a4599ab99"));
        assert!(source.contains("relrowsecurity"));
        assert!(source.contains("pg_catalog.pg_auth_members"));
        assert!(source.contains("vibe-source-md5:"));

        let validation = source
            .split("async fn validate_existing")
            .nth(1)
            .expect("existing Qualification validation")
            .split("/// Resolve the exact R&D basis")
            .next()
            .expect("existing Qualification validation boundary");
        assert!(validation.contains("FROM pg_catalog.pg_class relation"));
        assert!(validation.contains("JOIN pg_catalog.pg_namespace namespace"));
        assert!(validation.contains("relation.relname LIKE 'rd\\\\_%' ESCAPE '\\\\'"));
        assert!(validation.contains("relation.oid,"));
        assert!(!validation.contains("pg_catalog.format('public.%I'"));
    }

    #[rstest]
    fn forged_raw_envelope_cannot_construct_a_positive_readback() {
        let basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: "basis-1".into(),
            request_identity: "request-1".into(),
            principal: "principal-1".into(),
            request_scope: vec!["research:submit".into()],
            rationale_digest: "sha256:rationale".into(),
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest: "sha256:lineage".into(),
            basis_digest: "sha256:basis".into(),
        };
        let projection = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::GenesisEmpty,
            0,
            "qualification-protected-feedback-cut-v1-0".into(),
            None,
            None,
            100,
        )
        .unwrap();
        assert!(projection.is_current_at(projection.valid_through_epoch_ms() - 1));
        assert!(!projection.is_current_at(projection.valid_through_epoch_ms()));
        let mut row = QualificationProjectionEnvelopeRowV1 {
            projection_identity: projection.projection_identity().into(),
            basis_identity: projection.basis_identity().into(),
            principal: projection.principal().into(),
            request_scope_json: serde_json::to_value(projection.request_scope()).unwrap(),
            resolution_state: resolution_name(projection.resolution()).into(),
            source_sequence: i64::try_from(projection.source_sequence()).unwrap(),
            source_cut: projection.source_cut().into(),
            projection_digest: projection.projection_digest().into(),
            projection_json: serde_json::to_value(projection.as_stored()).unwrap(),
            receipt_json: serde_json::to_value(projection.receipt_as_stored()).unwrap(),
            committed_at_epoch_ms: i64::try_from(projection.receipt().committed_at_epoch_ms())
                .unwrap(),
            valid_through_epoch_ms: i64::try_from(projection.valid_through_epoch_ms()).unwrap(),
        };
        row.projection_json["basis_digest"] = serde_json::json!("sha256:forged");

        assert!(verify_projection_envelope_row(&row, &basis).is_err());
    }

    #[rstest]
    fn same_basis_successor_is_latest_and_refuting_histories_fail_closed() {
        let basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: "basis-1".into(),
            request_identity: "request-1".into(),
            principal: "principal-1".into(),
            request_scope: vec!["research:submit".into()],
            rationale_digest: "sha256:rationale".into(),
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest: "sha256:lineage".into(),
            basis_digest: "sha256:basis".into(),
        };
        let first = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::GenesisEmpty,
            0,
            "qualification-protected-feedback-cut-v1-0".into(),
            None,
            None,
            100,
        )
        .unwrap();
        let successor = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::Frontier,
            first.source_sequence(),
            first.source_cut().into(),
            Some(first.projection_identity().into()),
            Some(first.projection_digest().into()),
            first.valid_through_epoch_ms(),
        )
        .unwrap();
        assert_eq!(
            successor,
            form_projection(
                &basis,
                ProtectedFeedbackResolutionV1::Frontier,
                first.source_sequence(),
                first.source_cut().into(),
                Some(first.projection_identity().into()),
                Some(first.projection_digest().into()),
                first.valid_through_epoch_ms(),
            )
            .unwrap()
        );
        let history = VerifiedScopeHistoryV1 {
            projections: vec![first.clone(), successor.clone()],
            current_frontier: Some(successor.clone()),
        };
        verify_projection_chain(&history.projections, history.current_frontier.as_ref()).unwrap();
        assert_eq!(
            history.projection_for_basis(&basis.basis_identity),
            Some(&successor)
        );

        let branch = form_projection(
            &basis,
            ProtectedFeedbackResolutionV1::Frontier,
            first.source_sequence(),
            first.source_cut().into(),
            Some(first.projection_identity().into()),
            Some(first.projection_digest().into()),
            first.valid_through_epoch_ms().saturating_add(1),
        )
        .unwrap();
        assert!(
            verify_projection_chain(
                &[first.clone(), successor.clone(), branch],
                Some(&successor),
            )
            .is_err()
        );
        let mut tampered = successor;
        tampered.source_frontier_digest = Some("sha256:tampered".into());
        assert!(verify_projection_chain(&[first, tampered.clone()], Some(&tampered)).is_err());
    }

    #[tokio::test]
    #[ignore = "requires explicit disposable QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL"]
    async fn response_cut_rolls_back_stale_create_and_history_corruption_fails_closed() {
        let database_url = std::env::var("QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL")
            .expect("database-backed test requires an explicit disposable database URL");
        let owner = PostgresQualificationOwnerV1::connect(&database_url)
            .await
            .unwrap();

        for statement in [
            "CREATE TABLE IF NOT EXISTS rd_independence_bases_v1 (basis_identity TEXT PRIMARY KEY, request_identity TEXT NOT NULL UNIQUE, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, lineage_digest TEXT NOT NULL, basis_digest TEXT NOT NULL, basis_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        ] {
            sqlx::query(statement).execute(&owner.pool).await.unwrap();
        }
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let now = u64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
        let request_identity = format!("qualification-test-request-{suffix}");
        let principal = format!("qualification-test-principal-{suffix}");
        let request_scope = vec!["research:submit".to_string(), "research:view".to_string()];
        let lineage_digest = canonical_digest(
            "rd.semantic-predecessor-frontier.v1",
            &(
                &principal,
                &request_scope,
                "GENESIS_EMPTY",
                Vec::<String>::new(),
            ),
        )
        .unwrap();
        let rationale_digest =
            canonical_digest("rd.independence-rationale.v1", &"bounded test rationale").unwrap();
        let mut basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: String::new(),
            request_identity: request_identity.clone(),
            principal: principal.clone(),
            request_scope: request_scope.clone(),
            rationale_digest,
            independence_disposition: StoredIndependenceDispositionV1::Independent,
            lineage_resolution: StoredLineageResolutionV1::GenesisEmpty,
            semantic_predecessor_frontier: vec![],
            lineage_digest,
            basis_digest: String::new(),
        };
        basis.basis_digest = canonical_digest(
            "rd.independence-basis.v1",
            &RdBasisMeaningV1 {
                schema_version: 1,
                request_identity: &basis.request_identity,
                principal: &basis.principal,
                request_scope: &basis.request_scope,
                rationale_digest: &basis.rationale_digest,
                independence_disposition: &basis.independence_disposition,
                lineage_resolution: &basis.lineage_resolution,
                semantic_predecessor_frontier: &basis.semantic_predecessor_frontier,
                lineage_digest: &basis.lineage_digest,
            },
        )
        .unwrap();
        basis.basis_identity = identity("rd-independence-basis-v1", &basis.basis_digest);
        let receipt_digest = canonical_digest(
            "rd.independence-basis-receipt.v1",
            &RdBasisReceiptMeaningV1 {
                schema_version: 1,
                basis_identity: &basis.basis_identity,
                basis_digest: &basis.basis_digest,
                committed_at_epoch_ms: now,
            },
        )
        .unwrap();
        let receipt = StoredRdBasisReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-independence-basis-receipt-v1", &receipt_digest),
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            committed_at_epoch_ms: now,
        };
        let payload = RdBasisOutboxPayloadV1 {
            schema_version: 1,
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            receipt_identity: receipt.receipt_identity.clone(),
            principal: principal.clone(),
            request_scope: request_scope.clone(),
            lineage_digest: basis.lineage_digest.clone(),
        };
        let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload).unwrap();
        sqlx::query("INSERT INTO rd_independence_bases_v1 (basis_identity,request_identity,principal,request_scope_json,lineage_digest,basis_digest,basis_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&basis.basis_identity).bind(&request_identity).bind(&principal)
            .bind(serde_json::to_value(&request_scope).unwrap()).bind(&basis.lineage_digest)
            .bind(&basis.basis_digest).bind(serde_json::to_value(&basis).unwrap())
            .bind(serde_json::to_value(&receipt).unwrap()).bind(i64::try_from(now).unwrap())
            .execute(&owner.pool).await.unwrap();
        sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'INDEPENDENCE_BASIS_PRECOMMITTED_V1',$3,$4,$5)")
            .bind(identity("rd-owner-event-v1", &payload_digest)).bind(&basis.basis_identity)
            .bind(&payload_digest).bind(serde_json::to_value(&payload).unwrap()).bind(i64::try_from(now).unwrap())
            .execute(&owner.pool).await.unwrap();
        let locator = RdIndependenceBasisLocatorV1 {
            basis_identity: basis.basis_identity.clone(),
            basis_digest: basis.basis_digest.clone(),
            request_identity,
            principal,
            request_scope,
        };

        let stale = owner
            .resolve_or_create_for_basis_with_test_timing(
                &locator,
                CreateResponseTimingForTestV1 {
                    projection_age_ms: PROJECTION_VALIDITY_MS - 100,
                    post_verify_delay_ms: 200,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            stale,
            QualificationOwnerError::Unavailable(message)
                if message == "Qualification projection is stale"
        ));
        let projection_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        let head_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM qualification_protected_feedback_heads_v1",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        let outbox_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM qualification_owner_outbox_v1")
                .fetch_one(&owner.pool)
                .await
                .unwrap();
        assert_eq!((projection_count, head_count, outbox_count), (0, 0, 0));

        let short_lived = owner
            .resolve_or_create_for_basis_with_test_timing(
                &locator,
                CreateResponseTimingForTestV1 {
                    projection_age_ms: PROJECTION_VALIDITY_MS - 100,
                    post_verify_delay_ms: 0,
                },
            )
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(101)).await;
        let renewed = owner.resolve_or_create_for_basis(&locator).await.unwrap();
        assert_eq!(
            renewed.resolution(),
            ProtectedFeedbackResolutionV1::Frontier
        );
        assert_eq!(
            renewed.source_frontier_identity(),
            Some(short_lived.projection_identity())
        );
        assert_eq!(
            renewed.source_frontier_digest(),
            Some(short_lived.projection_digest())
        );
        assert_eq!(renewed.source_sequence(), short_lived.source_sequence());
        assert_eq!(renewed.source_cut(), short_lived.source_cut());
        assert_eq!(
            owner.resolve_or_create_for_basis(&locator).await.unwrap(),
            renewed
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1 WHERE basis_identity = $1",
            )
            .bind(&locator.basis_identity)
            .fetch_one(&owner.pool)
            .await
            .unwrap(),
            2
        );
        let scope_key = principal_scope_key(&locator.principal, &locator.request_scope).unwrap();
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = ANY($1)")
            .bind(vec![
                short_lived.projection_identity(),
                renewed.projection_identity(),
            ])
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_projections_v1 WHERE basis_identity = $1",
        )
        .bind(&locator.basis_identity)
        .execute(&owner.pool)
        .await
        .unwrap();

        let db_cut_before = sqlx::query_scalar::<_, i64>(
            "SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::BIGINT",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        let caller_sentinel_epoch_ms = 1_u64;
        let first = owner.resolve_or_create_for_basis(&locator).await.unwrap();
        let db_cut_after = sqlx::query_scalar::<_, i64>(
            "SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::BIGINT",
        )
        .fetch_one(&owner.pool)
        .await
        .unwrap();
        let db_cut_before = u64::try_from(db_cut_before).unwrap();
        let db_cut_after = u64::try_from(db_cut_after).unwrap();
        assert!(db_cut_before <= first.projection_at_epoch_ms());
        assert!(first.projection_at_epoch_ms() <= db_cut_after);
        assert_ne!(first.projection_at_epoch_ms(), caller_sentinel_epoch_ms);
        assert_eq!(
            first.valid_through_epoch_ms(),
            first.projection_at_epoch_ms() + PROJECTION_VALIDITY_MS
        );
        assert_eq!(
            first.receipt().committed_at_epoch_ms(),
            first.projection_at_epoch_ms()
        );
        assert!(verify_projection_freshness(&first, first.projection_at_epoch_ms()).is_ok());
        assert!(verify_projection_freshness(&first, first.valid_through_epoch_ms()).is_err());
        assert_eq!(
            first.resolution(),
            ProtectedFeedbackResolutionV1::GenesisEmpty
        );
        assert_eq!(
            owner.resolve_for_basis(&locator).await.unwrap(),
            Some(first.clone())
        );
        assert_eq!(
            owner.resolve_or_create_for_basis(&locator).await.unwrap(),
            first
        );
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .unwrap();
        assert!(owner.resolve_for_basis(&locator).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1",
            )
            .bind(first.projection_identity())
            .fetch_one(&owner.pool)
            .await
            .unwrap(),
            1
        );
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key,principal,request_scope_json,frontier_identity,frontier_digest,source_sequence,source_cut,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&scope_key).bind(first.principal())
            .bind(serde_json::to_value(first.request_scope()).unwrap())
            .bind(first.projection_identity()).bind(first.projection_digest())
            .bind(i64::try_from(first.source_sequence()).unwrap()).bind(first.source_cut())
            .bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator).await.unwrap(),
            Some(first.clone())
        );

        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE principal_scope_key = $1",
        )
        .bind(&scope_key)
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1")
            .bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator).await.is_err());
        let stored = first.as_stored();
        sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity,basis_identity,principal,request_scope_json,resolution_state,source_sequence,source_cut,projection_digest,projection_json,receipt_json,committed_at_epoch_ms,valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(first.projection_identity()).bind(first.basis_identity()).bind(first.principal())
            .bind(serde_json::to_value(first.request_scope()).unwrap()).bind(resolution_name(first.resolution()))
            .bind(i64::try_from(first.source_sequence()).unwrap()).bind(first.source_cut()).bind(first.projection_digest())
            .bind(serde_json::to_value(&stored).unwrap()).bind(serde_json::to_value(first.receipt_as_stored()).unwrap())
            .bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .bind(i64::try_from(first.valid_through_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key,principal,request_scope_json,frontier_identity,frontier_digest,source_sequence,source_cut,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&scope_key).bind(first.principal()).bind(serde_json::to_value(first.request_scope()).unwrap())
            .bind(first.projection_identity()).bind(first.projection_digest()).bind(i64::try_from(first.source_sequence()).unwrap())
            .bind(first.source_cut()).bind(i64::try_from(first.receipt().committed_at_epoch_ms()).unwrap())
            .execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator).await.unwrap(),
            Some(first.clone())
        );

        sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'TAMPERED_KIND',$3,$4,$5)")
            .bind(format!("qualification-test-extra-event-{suffix}"))
            .bind(first.projection_identity()).bind("sha256:tampered")
            .bind(serde_json::json!({"tampered": true}))
            .bind(i64::try_from(now).unwrap()).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator).await.is_err());
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'TAMPERED_KIND'")
            .bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator).await.unwrap(),
            Some(first.clone())
        );
        sqlx::query("UPDATE rd_owner_outbox_v1 SET payload_digest = 'sha256:corrupt' WHERE aggregate_identity = $1")
            .bind(&basis.basis_identity).execute(&owner.pool).await.unwrap();
        assert!(owner.resolve_for_basis(&locator).await.is_err());
        sqlx::query(
            "UPDATE rd_owner_outbox_v1 SET payload_digest = $1 WHERE aggregate_identity = $2",
        )
        .bind(&payload_digest)
        .bind(&basis.basis_identity)
        .execute(&owner.pool)
        .await
        .unwrap();
        assert_eq!(
            owner.resolve_for_basis(&locator).await.unwrap(),
            Some(first.clone())
        );
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE frontier_identity = $1",
        )
        .bind(first.projection_identity())
        .execute(&owner.pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(first.projection_identity())
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1").bind(first.projection_identity()).execute(&owner.pool).await.unwrap();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&basis.basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_independence_bases_v1 WHERE basis_identity = $1")
            .bind(&basis.basis_identity)
            .execute(&owner.pool)
            .await
            .unwrap();

        for statement in [
            "DROP TABLE qualification_protected_feedback_heads_v1",
            "DROP TABLE qualification_owner_outbox_v1",
            "DROP TABLE qualification_protected_feedback_projections_v1",
            "DROP TABLE rd_owner_outbox_v1",
            "DROP TABLE rd_independence_bases_v1",
        ] {
            sqlx::query(statement).execute(&owner.pool).await.unwrap();
        }
    }
}
