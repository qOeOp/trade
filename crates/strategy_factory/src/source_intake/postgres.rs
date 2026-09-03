//! Unwired PostgreSQL design for the existing R&D Owner.
//!
//! These statements intentionally reuse `rd_owner`, `rd_owner_api`, and
//! `rd_owner_outbox_v1`.  They create neither another Owner nor a caller-selected
//! pool/DSN.  Integration and migration execution belong to the continuation.

use std::fmt::Display;

use serde::Deserialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1,
    ProductEdgeSourceInvocationStartRequestV1, SOURCE_INTAKE_OPERATION_SCHEMA_V1,
    SOURCE_INTAKE_OPERATION_V1, SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
    resolve_admission_for_downstream_in_transaction,
    resolve_source_invocation_claim_for_downstream_in_transaction,
    resolve_source_invocation_started_for_downstream_in_transaction,
};
use vibe_rd_source_intake_invocation_custody::{
    SourceInvocationReservationMeaningV1, SourceInvocationStartedCustodyV1,
    seal_source_invocation_reservation,
};

use super::research_handoff::{
    DurableSourceIntakeResearchSnapshotV1, LockedSourceIntakeResearchHandoffV1,
    PeekedSourceIntakeResearchHandoffV1, SourceIntakeResearchAncestryProposalV1,
    SourceIntakeResearchHandoffErrorV1, lock_durable_source_intake_research_handoff_v1,
    peek_durable_source_intake_research_handoff_v1,
};
use super::{
    AcquisitionTerminalV1, InvocationPermitV1, ResearchSourceProvenanceV1,
    SourceAcquisitionBindingV1, SourceAcquisitionReceiptV1, SourceCandidateV1, SourceIntakeError,
    SourceIntakeInvocationPolicyEvidenceV1, SourceIntakeOutboxV1, SourceIntakePublicReadbackV1,
    SourceIntakeRetrievalTimeEvidenceV1, SourceInterpretationV1, domain_identity, openalex_http,
    validate_current_policy, validate_retrieval_time,
};
use super::{OpenAlexWorkByDoiRequestV1, SourceIntakePolicyEvidenceV1};

/// Validates the deployment-installed Source Intake custody without acquiring
/// topology administration authority. This query is intentionally catalog-only.
pub async fn validate_existing_source_intake_topology(
    pool: &PgPool,
) -> Result<(), SourceIntakeError> {
    validate_existing_source_intake_topology_for(pool, true).await
}

/// Validates only the immutable Source Intake object manifest.
///
/// Migration callers use this catalog-only projection to recognize an already sealed deployment
/// without pretending that their topology-administration connection is the runtime `rd_owner`.
pub async fn validate_existing_source_intake_object_topology(
    pool: &PgPool,
) -> Result<(), SourceIntakeError> {
    validate_existing_source_intake_topology_for(pool, false).await
}

async fn validate_existing_source_intake_topology_for(
    pool: &PgPool,
    require_runtime_authority: bool,
) -> Result<(), SourceIntakeError> {
    let exact: bool = sqlx::query_scalar(
        "WITH required_relations(name,runtime_privileges) AS (
           VALUES
             ('rd_source_intake_bindings_v1',ARRAY['INSERT','SELECT','UPDATE']::text[]),
             ('rd_source_intake_receipts_v1',ARRAY['INSERT','REFERENCES','SELECT','UPDATE']::text[]),
             ('rd_source_raw_payloads_v1',ARRAY['INSERT','REFERENCES','SELECT','UPDATE']::text[]),
             ('rd_source_raw_receipt_links_v1',ARRAY['INSERT','REFERENCES','SELECT','UPDATE']::text[]),
             ('rd_research_source_provenance_v1',ARRAY['INSERT','REFERENCES','SELECT','UPDATE']::text[]),
             ('rd_source_candidates_v1',ARRAY['INSERT','REFERENCES','SELECT','UPDATE']::text[])
         ), required_routines(signature,is_strict,is_security_definer,volatility,parallel_mode,configuration,product_edge_execute) AS (
           VALUES
             ('rd_owner_api.derive_source_intake_identity_v1(text,text[])',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.canonical_source_intake_json_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],false),
             ('rd_owner_api.derive_openalex_location_rights_v1(jsonb,text)',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],false),
             ('rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],false),
             ('rd_owner_api.lock_source_acquisition_binding_v1(text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog']::text[],true),
             ('rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog']::text[],true),
             ('rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb)',false,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.guard_source_intake_binding_v1()',false,true,'v','u',ARRAY['search_path=pg_catalog, public, pg_temp']::text[],false),
             ('rd_owner_api.reject_source_intake_terminal_mutation_v1()',false,true,'v','u',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.valid_source_intake_binding_contract_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint)',false,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],false),
             ('rd_owner_api.canonical_source_intake_custody_v1(text)',true,true,'s','s',ARRAY['search_path=pg_catalog, public, pg_temp']::text[],false),
             ('rd_owner_api.read_source_intake_v1(text)',true,true,'s','s',ARRAY['search_path=pg_catalog, rd_owner_api, pg_temp']::text[],false),
             ('rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text)',true,true,'s','s',ARRAY['search_path=pg_catalog, public, rd_owner_api, pg_temp']::text[],false),
             ('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog, public, rd_owner_api, pg_temp']::text[],false)
         ), required_triggers(name,relation_name,routine_signature,trigger_type,definition) AS (
           VALUES
             ('rd_source_intake_binding_guard_v1','rd_source_intake_bindings_v1','rd_owner_api.guard_source_intake_binding_v1()',19::smallint,'CREATE TRIGGER rd_source_intake_binding_guard_v1 BEFORE UPDATE ON rd_source_intake_bindings_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_source_intake_binding_v1()'),
             ('rd_source_intake_receipt_immutable_v1','rd_source_intake_receipts_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_intake_receipt_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_intake_receipts_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
             ('rd_source_raw_payload_immutable_v1','rd_source_raw_payloads_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_raw_payload_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_raw_payloads_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
             ('rd_source_raw_receipt_link_immutable_v1','rd_source_raw_receipt_links_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_raw_receipt_link_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_raw_receipt_links_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
             ('rd_research_source_provenance_immutable_v1','rd_research_source_provenance_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_research_source_provenance_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_research_source_provenance_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
             ('rd_source_candidate_immutable_v1','rd_source_candidates_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_candidate_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_candidates_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()')
         )
         SELECT (NOT $1 OR (
             session_user='rd_owner'
             AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname=session_user AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid=pg_catalog.to_regrole(session_user)::oid OR membership.member=pg_catalog.to_regrole(session_user)::oid)
             AND NOT pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE,TEMPORARY')
             AND NOT pg_catalog.pg_has_role(session_user,'rd_custodian','MEMBER')
             AND pg_catalog.has_schema_privilege(session_user,'rd_owner_api','USAGE')
             AND NOT pg_catalog.has_schema_privilege(session_user,'public','CREATE')
             AND NOT pg_catalog.has_schema_privilege(session_user,'rd_owner_api','CREATE')
           ))
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_custodian' AND NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
           AND pg_catalog.pg_get_userbyid((SELECT namespace.nspowner FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname='rd_owner_api'))='rd_custodian'
           AND NOT EXISTS (
             SELECT 1 FROM required_relations required
             LEFT JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||required.name)
             WHERE relation.oid IS NULL OR relation.relkind<>'r' OR relation.relpersistence<>'p'
                OR relation.relrowsecurity OR relation.relforcerowsecurity
                OR pg_catalog.pg_get_userbyid(relation.relowner)<>'rd_custodian'
                OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped AND acl.grantee<>relation.relowner)
                OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact WHERE rewrite_fact.ev_class=relation.oid)
                OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_fact WHERE policy_fact.polrelid=relation.oid)
                OR pg_catalog.obj_description(relation.oid,'pg_class') IS DISTINCT FROM 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object('columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)),'[]'::jsonb) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid),'acl',COALESCE(relation.relacl::text,'<NULL>'))::text)
                OR (SELECT pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('rd_owner')::oid AND NOT acl.is_grantable)
                      FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl) IS DISTINCT FROM required.runtime_privileges
                OR (SELECT pg_catalog.count(*)<>7+pg_catalog.cardinality(required.runtime_privileges)
                         OR pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type) FILTER (WHERE acl.grantee=relation.relowner AND NOT acl.is_grantable) IS DISTINCT FROM ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]
                         OR pg_catalog.bool_or(acl.grantee NOT IN (relation.relowner,pg_catalog.to_regrole('rd_owner')::oid))
                         OR pg_catalog.bool_or(acl.is_grantable)
                      FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl)
           )
           AND NOT EXISTS (
             SELECT 1 FROM required_routines required
             LEFT JOIN pg_catalog.pg_proc routine ON routine.oid=pg_catalog.to_regprocedure(required.signature)
             WHERE routine.oid IS NULL OR pg_catalog.pg_get_userbyid(routine.proowner)<>'rd_custodian'
                OR routine.proisstrict<>required.is_strict OR routine.prosecdef<>required.is_security_definer
                OR routine.provolatile::text<>required.volatility OR routine.proparallel::text<>required.parallel_mode
                OR routine.proconfig IS DISTINCT FROM required.configuration
                OR pg_catalog.obj_description(routine.oid,'pg_proc') IS DISTINCT FROM 'vibe-source-md5:'||pg_catalog.md5(routine.prosrc)
                OR (SELECT pg_catalog.array_agg(role.rolname||':'||acl.privilege_type||':'||acl.is_grantable::text ORDER BY role.rolname,acl.privilege_type,acl.is_grantable)
                      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
                      JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee) IS DISTINCT FROM CASE WHEN required.product_edge_execute
                        THEN ARRAY['product_edge_owner:EXECUTE:false','rd_custodian:EXECUTE:false','rd_owner:EXECUTE:false']::text[]
                        ELSE ARRAY['rd_custodian:EXECUTE:false','rd_owner:EXECUTE:false']::text[] END
           )
           AND (SELECT pg_catalog.count(*)=6 AND pg_catalog.bool_and(
                  trigger_fact.tgenabled='O' AND trigger_fact.tgnargs=0 AND trigger_fact.tgargs=''::bytea
                  AND trigger_fact.tgqual IS NULL AND trigger_fact.tgtype=required.trigger_type
                  AND pg_catalog.pg_get_triggerdef(trigger_fact.oid,true)=required.definition
                  AND trigger_fact.tgfoid=pg_catalog.to_regprocedure(required.routine_signature)
                  AND trigger_fact.tgrelid=pg_catalog.to_regclass('public.'||required.relation_name)
                  AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency WHERE dependency.classid='pg_catalog.pg_trigger'::pg_catalog.regclass AND dependency.objid=trigger_fact.oid AND dependency.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass AND dependency.refobjid=trigger_fact.tgfoid AND dependency.deptype='n')
                ) FROM required_triggers required JOIN pg_catalog.pg_trigger trigger_fact ON trigger_fact.tgname=required.name AND NOT trigger_fact.tgisinternal)
           AND (SELECT pg_catalog.count(*)=6 FROM pg_catalog.pg_trigger trigger_fact WHERE NOT trigger_fact.tgisinternal AND trigger_fact.tgrelid IN (SELECT pg_catalog.to_regclass('public.'||required.name) FROM required_relations required))",
    )
    .bind(require_runtime_authority)
    .fetch_one(pool)
    .await
    .map_err(source_storage)?;

    if !exact {
        return Err(SourceIntakeError::Serialization(
            "existing Source Intake custody or runtime authority is unavailable".into(),
        ));
    }
    Ok(())
}

#[derive(Debug)]
pub struct SourceIntakeTermsBlockedCommitV1<'a> {
    pub reservation_identity: &'a str,
    pub reservation_digest: &'a str,
    pub decision: SourceIntakeInvocationPolicyEvidenceV1,
    pub retrieval_time: &'a SourceIntakeRetrievalTimeEvidenceV1,
    pub receipt: &'a SourceAcquisitionReceiptV1,
    pub outbox: &'a SourceIntakeOutboxV1,
}

/// Commits the Owner-only terms-blocked terminal after locking the exact
/// binding and consuming sealed current rights/retention/Shared Time custody.
pub async fn commit_source_intake_terms_blocked_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    commit: SourceIntakeTermsBlockedCommitV1<'_>,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    let binding_json: serde_json::Value = sqlx::query_scalar(
        "SELECT binding_json FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1 AND binding_identity=$2 AND state='PREPARED' FOR UPDATE",
    )
    .bind(&admission_locator.request_identity)
    .bind(binding_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;
    let binding: SourceAcquisitionBindingV1 =
        serde_json::from_value(binding_json).map_err(|_| SourceIntakeError::CustodyMismatch)?;
    validate_current_policy(&binding, &commit.decision)?;
    validate_retrieval_time(&commit.decision, commit.retrieval_time)?;
    if commit.decision.decision != super::SourceAcquisitionAdmissionV1::Rejected
        || commit.receipt.terminal != AcquisitionTerminalV1::TermsOrLicenseBlocked
        || commit.receipt.policy_decision_identity != commit.decision.decision_identity
        || commit.receipt.policy_decision_digest != commit.decision.decision_digest
        || commit.receipt.retrieval_time.decision_cut_epoch_ms
            < commit.decision.current_time.decision_cut_epoch_ms
        || !sealed_retrieval_matches(commit.receipt, commit.retrieval_time)
    {
        return Err(SourceIntakeError::EffectNotAdmitted);
    }
    let updated = sqlx::query(PRE_INVOCATION_TERMS_BLOCKED_TRANSACTION_SQL_V1)
        .bind(&admission_locator.request_identity)
        .bind(commit.reservation_identity)
        .bind(commit.reservation_digest)
        .bind(&commit.receipt.receipt_identity)
        .bind(serde_json::to_value(commit.receipt).map_err(source_storage)?)
        .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(source_storage)?)
        .bind(&commit.outbox.event_identity)
        .bind(&commit.outbox.payload_digest)
        .bind(serde_json::to_value(commit.outbox).map_err(source_storage)?)
        .bind(&commit.decision.decision_identity)
        .bind(&commit.decision.decision_digest)
        .bind(serde_json::to_value(&commit.decision.current_time).map_err(source_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(source_storage)?;

    if updated.rows_affected() != 1 {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&admission_locator.request_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(source_storage)?;
    serde_json::from_value(value.ok_or(SourceIntakeError::CustodyMismatch)?).map_err(source_storage)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CanonicalSourceAdmissionPayloadV1 {
    request_identity: String,
    gateway: String,
    normalized_doi: String,
    interpretation: SourceInterpretationV1,
}

pub async fn prepare_source_invocation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    reserved_at_epoch_ms: u64,
) -> Result<ProductEdgeSourceInvocationStartRequestV1, SourceIntakeError> {
    let admission = resolve_admission_for_downstream_in_transaction(
        transaction,
        admission_locator,
        DownstreamAdmissionModeV1::Historical,
    )
    .await
    .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let payload: CanonicalSourceAdmissionPayloadV1 =
        serde_json::from_value(admission.request().typed_payload.clone())
            .map_err(|_| SourceIntakeError::CustodyMismatch)?;

    if admission.request().operation != SOURCE_INTAKE_OPERATION_V1
        || admission.request().operation_schema != SOURCE_INTAKE_OPERATION_SCHEMA_V1
        || admission.request().target_owner != SOURCE_INTAKE_TARGET_OWNER_V1
        || admission.request().requested_effects.as_slice() != SOURCE_INTAKE_REQUIRED_EFFECTS_V1
        || payload.request_identity != admission_locator.request_identity
        || payload.gateway != "WINDMILL_PRODUCT_EDGE"
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    payload.validate()?;
    let claim = resolve_source_invocation_claim_for_downstream_in_transaction(
        transaction,
        &admission_locator.request_identity,
        &admission_locator.admission_identity,
        binding_identity,
    )
    .await
    .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let row = sqlx::query("SELECT binding_identity,binding_commit_identity,binding_json,state,product_edge_started_receipt_identity,product_edge_started_json FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1 AND binding_identity=$2 FOR UPDATE")
        .bind(&admission_locator.request_identity)
        .bind(binding_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(source_storage)?
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let stored_binding_identity: String =
        row.try_get("binding_identity").map_err(source_storage)?;
    let binding_commit_identity: String = row
        .try_get("binding_commit_identity")
        .map_err(source_storage)?;
    let binding_json: serde_json::Value = row.try_get("binding_json").map_err(source_storage)?;
    let binding: SourceAcquisitionBindingV1 = serde_json::from_value(binding_json.clone())
        .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let state: String = row.try_get("state").map_err(source_storage)?;

    if stored_binding_identity != binding_identity
        || claim.request_identity() != admission_locator.request_identity
        || claim.admission_identity() != admission_locator.admission_identity
        || claim.attempt_identity() != binding_identity
        || binding_json["request_identity"] != admission_locator.request_identity
        || binding_json["product_edge_admission"]["request_identity"]
            != admission_locator.request_identity
        || binding_json["product_edge_admission"]["admission_identity"]
            != admission_locator.admission_identity
        || binding_json["product_edge_admission"]["admission_digest"]
            != admission_locator.admission_digest
        || binding_json["operation_manifest_identity"] != admission.manifest_identity()
        || binding_json["operation_manifest_digest"] != admission.manifest_digest()
        || binding_json["normalized_doi"] != payload.normalized_doi
        || binding_json["admission"] != "ADMITTED"
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    if state == "PREPARED" {
        let existing_identity: Option<String> = row
            .try_get("product_edge_started_receipt_identity")
            .map_err(source_storage)?;
        let existing: Option<serde_json::Value> = row
            .try_get("product_edge_started_json")
            .map_err(source_storage)?;
        let existing = existing.ok_or(SourceIntakeError::CustodyMismatch)?;
        if existing["claim_identity"] != claim.claim_identity()
            || existing["claim_digest"] != claim.claim_digest()
            || existing["claimed_state_digest"] != claim.claimed_state_digest()
            || existing["interpretation"]
                != serde_json::to_value(&payload.interpretation).map_err(source_storage)?
            || existing["authority"]
                != serde_json::to_value(&binding.authority).map_err(source_storage)?
            || existing_identity.as_deref() != existing["reservation_identity"].as_str()
        {
            return Err(SourceIntakeError::CustodyMismatch);
        }
        return source_start_request_from_reservation(&existing);
    }

    if state != "BINDING_CLOSED" || reserved_at_epoch_ms == 0 {
        return Err(SourceIntakeError::InvalidTransition);
    }
    let seal = seal_source_invocation_reservation(SourceInvocationReservationMeaningV1 {
        request_identity: &admission_locator.request_identity,
        binding_identity,
        binding_commit_identity: &binding_commit_identity,
        admission_identity: &admission_locator.admission_identity,
        attempt_identity: binding_identity,
        claim_identity: claim.claim_identity(),
        claim_digest: claim.claim_digest(),
        invocation_admission_receipt_identity: claim.invocation_admission_receipt_identity(),
        invocation_admission_receipt_digest: claim.invocation_admission_receipt_digest(),
        claimed_state_digest: claim.claimed_state_digest(),
        reserved_at_epoch_ms,
    })
    .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let reservation = serde_json::json!({
        "schema_version": 1,
        "request_identity": admission_locator.request_identity,
        "binding_identity": binding_identity,
        "binding_commit_identity": binding_commit_identity,
        "admission_identity": admission_locator.admission_identity,
        "attempt_identity": binding_identity,
        "claim_identity": claim.claim_identity(),
        "claim_digest": claim.claim_digest(),
        "invocation_admission_receipt_identity": claim.invocation_admission_receipt_identity(),
        "invocation_admission_receipt_digest": claim.invocation_admission_receipt_digest(),
        "claimed_state_digest": claim.claimed_state_digest(),
        "reservation_identity": seal.reservation_identity(),
        "reservation_digest": seal.reservation_digest(),
        "reserved_at_epoch_ms": reserved_at_epoch_ms,
        "authority": binding.authority,
        "interpretation": payload.interpretation,
    });
    let updated = sqlx::query("UPDATE public.rd_source_intake_bindings_v1 SET state='PREPARED',product_edge_started_receipt_identity=$2,product_edge_started_json=$3 WHERE request_identity=$1 AND state='BINDING_CLOSED'")
        .bind(&admission_locator.request_identity)
        .bind(seal.reservation_identity())
        .bind(&reservation)
        .execute(&mut **transaction)
        .await
        .map_err(source_storage)?;

    if updated.rows_affected() != 1 {
        return Err(SourceIntakeError::InvalidTransition);
    }
    source_start_request_from_reservation(&reservation)
}

pub async fn reserve_started_source_invocation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    evidence: SourceIntakeInvocationPolicyEvidenceV1,
) -> Result<InvocationPermitV1, SourceIntakeError> {
    let started = resolve_source_invocation_started_for_downstream_in_transaction(
        transaction,
        &admission_locator.request_identity,
        &admission_locator.admission_identity,
        binding_identity,
    )
    .await
    .map_err(|_| SourceIntakeError::EffectNotAdmitted)?;
    let row = sqlx::query("SELECT binding_commit_identity,binding_json,state,product_edge_started_json FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1 AND binding_identity=$2 FOR UPDATE")
        .bind(&admission_locator.request_identity)
        .bind(binding_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(source_storage)?
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let binding_commit_identity: String = row
        .try_get("binding_commit_identity")
        .map_err(source_storage)?;
    let binding_json: serde_json::Value = row.try_get("binding_json").map_err(source_storage)?;
    let binding: SourceAcquisitionBindingV1 = serde_json::from_value(binding_json.clone())
        .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    validate_current_policy(&binding, &evidence)?;
    if !evidence.admits_invocation() {
        return Err(SourceIntakeError::EffectNotAdmitted);
    }
    let state: String = row.try_get("state").map_err(source_storage)?;
    let mut reservation: serde_json::Value = row
        .try_get::<Option<serde_json::Value>, _>("product_edge_started_json")
        .map_err(source_storage)?
        .ok_or(SourceIntakeError::CustodyMismatch)?;

    if state != "PREPARED"
        || started.request_identity() != admission_locator.request_identity
        || started.admission_identity() != admission_locator.admission_identity
        || started.attempt_identity() != binding_identity
        || reservation["claim_identity"] != started.claim_identity()
        || reservation["claim_digest"] != started.claim_digest()
        || reservation["binding_commit_identity"] != binding_commit_identity
        || reservation["authority"]
            != serde_json::to_value(&binding.authority).map_err(source_storage)?
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    reservation["started_state_digest"] = serde_json::json!(started.started_state_digest());
    reservation["started_at_epoch_ms"] = serde_json::json!(started.started_at_epoch_ms());
    reservation["policy_decision_identity"] = serde_json::json!(evidence.decision_identity);
    reservation["policy_decision_digest"] = serde_json::json!(evidence.decision_digest);
    reservation["policy_time"] =
        serde_json::to_value(&evidence.current_time).map_err(source_storage)?;
    let invocation_identity = domain_identity(
        "rd.source-intake.openalex.invocation.v1",
        &[
            &admission_locator.request_identity,
            binding_identity,
            &binding_commit_identity,
            started.started_state_digest(),
            &evidence.decision_identity,
            &evidence.decision_digest,
            &evidence.current_time.head_digest,
            binding.authority.authority_class.as_str(),
            &binding.authority.environment_identity,
            &binding.authority.provider_profile_digest,
            binding
                .authority
                .fixture_corpus_digest
                .as_deref()
                .unwrap_or("ABSENT"),
        ],
    );
    let updated = sqlx::query("UPDATE public.rd_source_intake_bindings_v1 SET state='INVOCATION_RESERVED',product_edge_started_receipt_identity=$2,product_edge_started_json=$3,invocation_identity=$4 WHERE request_identity=$1 AND state='PREPARED'")
        .bind(&admission_locator.request_identity)
        .bind(started.started_state_digest())
        .bind(&reservation)
        .bind(&invocation_identity)
        .execute(&mut **transaction)
        .await
        .map_err(source_storage)?;

    if updated.rows_affected() != 1 {
        return Err(SourceIntakeError::InvalidTransition);
    }
    let resolved_addresses = serde_json::from_value(binding_json["resolved_addresses"].clone())
        .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let timeout_ms = binding_json["timeout_ms"]
        .as_u64()
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let byte_limit = binding_json["byte_limit"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    Ok(InvocationPermitV1 {
        invocation_identity,
        binding_identity: binding_identity.to_string(),
        request_identity: admission_locator.request_identity.clone(),
        method: openalex_http::METHOD,
        origin: openalex_http::ORIGIN,
        path: binding_json["endpoint_path"]
            .as_str()
            .ok_or(SourceIntakeError::CustodyMismatch)?
            .to_string(),
        resolved_addresses,
        timeout_ms,
        byte_limit,
        policy_decision_identity: evidence.decision_identity,
        policy_decision_digest: evidence.decision_digest,
        policy_time: evidence.current_time,
    })
}

struct LockedTerminalSourceCustodyV1 {
    started: SourceInvocationStartedCustodyV1,
    state: String,
    invocation_identity: String,
    terminal_receipt_identity: Option<String>,
}

/// Product Edge is always locked and verified before the R&D reservation.
async fn lock_and_verify_terminal_source_custody(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    invocation_identity: &str,
) -> Result<LockedTerminalSourceCustodyV1, SourceIntakeError> {
    let started = resolve_source_invocation_started_for_downstream_in_transaction(
        transaction,
        &admission_locator.request_identity,
        &admission_locator.admission_identity,
        binding_identity,
    )
    .await
    .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let row = sqlx::query("SELECT binding_commit_identity,binding_json,product_edge_started_receipt_identity,product_edge_started_json,invocation_identity,state,terminal_receipt_identity FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1 AND binding_identity=$2 FOR UPDATE")
        .bind(&admission_locator.request_identity)
        .bind(binding_identity)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(source_storage)?
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let binding_commit_identity: String = row
        .try_get("binding_commit_identity")
        .map_err(source_storage)?;
    let binding_json: serde_json::Value = row.try_get("binding_json").map_err(source_storage)?;
    let binding: SourceAcquisitionBindingV1 =
        serde_json::from_value(binding_json).map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let stored_started_digest: String = row
        .try_get("product_edge_started_receipt_identity")
        .map_err(source_storage)?;
    let reservation: serde_json::Value = row
        .try_get("product_edge_started_json")
        .map_err(source_storage)?;
    let stored_invocation_identity: String =
        row.try_get("invocation_identity").map_err(source_storage)?;
    let state: String = row.try_get("state").map_err(source_storage)?;
    let terminal_receipt_identity: Option<String> = row
        .try_get("terminal_receipt_identity")
        .map_err(source_storage)?;
    let string = |name: &str| {
        reservation[name]
            .as_str()
            .ok_or(SourceIntakeError::CustodyMismatch)
    };
    let seal = seal_source_invocation_reservation(SourceInvocationReservationMeaningV1 {
        request_identity: string("request_identity")?,
        binding_identity: string("binding_identity")?,
        binding_commit_identity: string("binding_commit_identity")?,
        admission_identity: string("admission_identity")?,
        attempt_identity: string("attempt_identity")?,
        claim_identity: string("claim_identity")?,
        claim_digest: string("claim_digest")?,
        invocation_admission_receipt_identity: string("invocation_admission_receipt_identity")?,
        invocation_admission_receipt_digest: string("invocation_admission_receipt_digest")?,
        claimed_state_digest: string("claimed_state_digest")?,
        reserved_at_epoch_ms: reservation["reserved_at_epoch_ms"]
            .as_u64()
            .ok_or(SourceIntakeError::CustodyMismatch)?,
    })
    .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let expected_invocation_identity = domain_identity(
        "rd.source-intake.openalex.invocation.v1",
        &[
            &admission_locator.request_identity,
            binding_identity,
            &binding_commit_identity,
            started.started_state_digest(),
            string("policy_decision_identity")?,
            string("policy_decision_digest")?,
            reservation["policy_time"]["head_digest"]
                .as_str()
                .ok_or(SourceIntakeError::CustodyMismatch)?,
            binding.authority.authority_class.as_str(),
            &binding.authority.environment_identity,
            &binding.authority.provider_profile_digest,
            binding
                .authority
                .fixture_corpus_digest
                .as_deref()
                .unwrap_or("ABSENT"),
        ],
    );

    if !matches!(state.as_str(), "INVOCATION_RESERVED" | "TERMINAL")
        || started.request_identity() != admission_locator.request_identity
        || started.admission_identity() != admission_locator.admission_identity
        || started.attempt_identity() != binding_identity
        || string("request_identity")? != started.request_identity()
        || string("binding_identity")? != binding_identity
        || string("binding_commit_identity")? != binding_commit_identity
        || string("admission_identity")? != started.admission_identity()
        || string("attempt_identity")? != started.attempt_identity()
        || string("claim_identity")? != started.claim_identity()
        || string("claim_digest")? != started.claim_digest()
        || string("invocation_admission_receipt_identity")?
            != started.invocation_admission_receipt_identity()
        || string("invocation_admission_receipt_digest")?
            != started.invocation_admission_receipt_digest()
        || string("claimed_state_digest")? != started.claimed_state_digest()
        || string("started_state_digest")? != started.started_state_digest()
        || reservation["authority"]
            != serde_json::to_value(&binding.authority).map_err(source_storage)?
        || stored_started_digest != started.started_state_digest()
        || string("reservation_identity")? != seal.reservation_identity()
        || string("reservation_digest")? != seal.reservation_digest()
        || stored_invocation_identity != invocation_identity
        || expected_invocation_identity != invocation_identity
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    Ok(LockedTerminalSourceCustodyV1 {
        started,
        state,
        invocation_identity: stored_invocation_identity,
        terminal_receipt_identity,
    })
}

#[derive(Debug)]
pub struct SourceIntakeSuccessTerminalCommitV1<'a> {
    pub invocation_identity: &'a str,
    pub receipt: &'a SourceAcquisitionReceiptV1,
    pub retrieval_time: &'a SourceIntakeRetrievalTimeEvidenceV1,
    pub raw_payload: &'a [u8],
    pub provenance: &'a ResearchSourceProvenanceV1,
    pub candidate: &'a SourceCandidateV1,
    pub outbox: &'a SourceIntakeOutboxV1,
}

pub async fn commit_source_intake_success_terminal_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    commit: SourceIntakeSuccessTerminalCommitV1<'_>,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    if !sealed_retrieval_matches(commit.receipt, commit.retrieval_time) {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    let locked = lock_and_verify_terminal_source_custody(
        transaction,
        admission_locator,
        binding_identity,
        commit.invocation_identity,
    )
    .await?;

    if locked.state == "TERMINAL" {
        return read_locked_source_intake_success_terminal(transaction, &locked, &commit).await;
    }
    let content_digest = commit
        .receipt
        .content_digest
        .as_deref()
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let updated = sqlx::query(TERMINAL_SUCCESS_TRANSACTION_SQL_V1)
        .bind(&admission_locator.request_identity)
        .bind(commit.invocation_identity)
        .bind(&commit.receipt.receipt_identity)
        .bind(serde_json::to_value(commit.receipt).map_err(source_storage)?)
        .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(source_storage)?)
        .bind(content_digest)
        .bind(commit.raw_payload)
        .bind(&commit.provenance.provenance_identity)
        .bind(serde_json::to_value(commit.provenance).map_err(source_storage)?)
        .bind(&commit.candidate.candidate_identity)
        .bind(serde_json::to_value(commit.candidate).map_err(source_storage)?)
        .bind(&commit.outbox.event_identity)
        .bind(&commit.outbox.payload_digest)
        .bind(serde_json::to_value(commit.outbox).map_err(source_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(source_storage)?;

    if updated.rows_affected() != 1 {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    read_locked_source_intake_success_terminal(transaction, &locked, &commit).await
}

#[derive(Debug)]
pub struct SourceIntakeFailureTerminalCommitV1<'a> {
    pub invocation_identity: &'a str,
    pub receipt: &'a SourceAcquisitionReceiptV1,
    pub retrieval_time: &'a SourceIntakeRetrievalTimeEvidenceV1,
    pub outbox: &'a SourceIntakeOutboxV1,
}

pub async fn commit_source_intake_failure_terminal_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    commit: SourceIntakeFailureTerminalCommitV1<'_>,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    if commit.receipt.terminal == AcquisitionTerminalV1::Retrieved
        || !sealed_retrieval_matches(commit.receipt, commit.retrieval_time)
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    let locked = lock_and_verify_terminal_source_custody(
        transaction,
        admission_locator,
        binding_identity,
        commit.invocation_identity,
    )
    .await?;

    if locked.state == "TERMINAL" {
        return read_locked_source_intake_failure_terminal(transaction, &locked, &commit).await;
    }
    let updated = sqlx::query(TERMINAL_FAILURE_TRANSACTION_SQL_V1)
        .bind(&admission_locator.request_identity)
        .bind(&commit.receipt.receipt_identity)
        .bind(serde_json::to_value(commit.receipt).map_err(source_storage)?)
        .bind(i64::try_from(commit.receipt.committed_at_epoch_ms).map_err(source_storage)?)
        .bind(&commit.outbox.event_identity)
        .bind(&commit.outbox.payload_digest)
        .bind(serde_json::to_value(commit.outbox).map_err(source_storage)?)
        .execute(&mut **transaction)
        .await
        .map_err(source_storage)?;

    if updated.rows_affected() != 1 {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    read_locked_source_intake_failure_terminal(transaction, &locked, &commit).await
}

fn sealed_retrieval_matches(
    receipt: &SourceAcquisitionReceiptV1,
    evidence: &SourceIntakeRetrievalTimeEvidenceV1,
) -> bool {
    receipt.retrieval_time_evidence_identity == evidence.evidence_identity
        && receipt.retrieval_time_evidence_digest == evidence.evidence_digest
        && receipt.retrieval_time == evidence.current_time
}

pub async fn read_source_intake_terminal_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission_locator: &ProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    invocation_identity: &str,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    let locked = lock_and_verify_terminal_source_custody(
        transaction,
        admission_locator,
        binding_identity,
        invocation_identity,
    )
    .await?;

    if locked.state != "TERMINAL" {
        return Err(SourceIntakeError::InvalidTransition);
    }
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&admission_locator.request_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(source_storage)?;
    serde_json::from_value(value.ok_or(SourceIntakeError::CustodyMismatch)?).map_err(source_storage)
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DurableSourceIntakeResearchRowV1 {
    request_identity: String,
    attempt_identity: String,
    terminal_receipt_identity: String,
    binding: SourceAcquisitionBindingV1,
    receipt: SourceAcquisitionReceiptV1,
    provenance: ResearchSourceProvenanceV1,
    candidate: SourceCandidateV1,
    transition: SourceIntakeOutboxV1,
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
pub(crate) async fn peek_source_intake_research_handoff_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &SourceIntakeResearchAncestryProposalV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
) -> Result<PeekedSourceIntakeResearchHandoffV1, SourceIntakeResearchHandoffErrorV1> {
    let row = query_source_intake_research_handoff_v1(
        transaction,
        "SELECT rd_owner_api.peek_source_intake_research_handoff_v1($1,$2,$3)",
        proposal,
    )
    .await?;
    let snapshot = durable_source_intake_research_snapshot_v1(proposal, row)?;
    peek_durable_source_intake_research_handoff_v1(proposal, &snapshot, verification_policy)
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
pub(crate) async fn lock_source_intake_research_handoff_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: SourceIntakeResearchAncestryProposalV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
    expected_evidence_digest: &str,
) -> Result<LockedSourceIntakeResearchHandoffV1, SourceIntakeResearchHandoffErrorV1> {
    let row = query_source_intake_research_handoff_v1(
        transaction,
        "SELECT rd_owner_api.lock_source_intake_research_handoff_v1($1,$2,$3)",
        &proposal,
    )
    .await?;
    let snapshot = durable_source_intake_research_snapshot_v1(&proposal, row)?;
    lock_durable_source_intake_research_handoff_v1(
        proposal,
        snapshot,
        verification_policy,
        expected_evidence_digest,
    )
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
impl SourceIntakeResearchAncestryProposalV1 {
    pub(crate) async fn peek_source_intake_research_handoff_v1(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        verification_policy: SourceIntakePolicyEvidenceV1,
    ) -> Result<(String, String, String, String, String, String, String), SourceIntakeError> {
        peek_source_intake_research_handoff_v1(transaction, self, verification_policy)
            .await
            .map(PeekedSourceIntakeResearchHandoffV1::into_research_source_fields)
            .map_err(source_research_handoff)
    }

    pub(crate) async fn lock_source_intake_research_handoff_v1(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        verification_policy: SourceIntakePolicyEvidenceV1,
        expected_evidence_digest: &str,
    ) -> Result<super::VerifiedSourceIntakeResearchAncestryV1, SourceIntakeError> {
        lock_source_intake_research_handoff_v1(
            transaction,
            self.clone(),
            verification_policy,
            expected_evidence_digest,
        )
        .await
        .map_err(source_research_handoff)?
        .mint()
        .map_err(source_research_handoff)
    }
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
fn source_research_handoff(error: SourceIntakeResearchHandoffErrorV1) -> SourceIntakeError {
    match error {
        SourceIntakeResearchHandoffErrorV1::Stale
        | SourceIntakeResearchHandoffErrorV1::NotRetrieved => SourceIntakeError::EffectNotAdmitted,
        SourceIntakeResearchHandoffErrorV1::Serialization => {
            SourceIntakeError::Serialization(error.to_string())
        }
        SourceIntakeResearchHandoffErrorV1::InvalidReference
        | SourceIntakeResearchHandoffErrorV1::AncestryMismatch
        | SourceIntakeResearchHandoffErrorV1::OwnerUnavailable => {
            SourceIntakeError::CustodyMismatch
        }
    }
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
async fn query_source_intake_research_handoff_v1(
    transaction: &mut Transaction<'_, Postgres>,
    statement: &'static str,
    proposal: &SourceIntakeResearchAncestryProposalV1,
) -> Result<DurableSourceIntakeResearchRowV1, SourceIntakeResearchHandoffErrorV1> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(statement)
        .bind(&proposal.request_identity)
        .bind(&proposal.attempt_identity)
        .bind(&proposal.terminal_receipt_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| SourceIntakeResearchHandoffErrorV1::OwnerUnavailable)?;
    serde_json::from_value(value.ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?)
        .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
fn durable_source_intake_research_snapshot_v1(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    row: DurableSourceIntakeResearchRowV1,
) -> Result<DurableSourceIntakeResearchSnapshotV1, SourceIntakeResearchHandoffErrorV1> {
    if row.request_identity != proposal.request_identity
        || row.attempt_identity != proposal.attempt_identity
        || row.terminal_receipt_identity != proposal.terminal_receipt_identity
        || row.binding.request_identity != proposal.request_identity
        || row.binding.binding_identity != proposal.attempt_identity
        || row.receipt.receipt_identity != proposal.terminal_receipt_identity
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    let request = OpenAlexWorkByDoiRequestV1 {
        request_identity: row.binding.request_identity.clone(),
        gateway: row.binding.gateway,
        admission: row.binding.product_edge_admission.clone(),
        operation_manifest_identity: row.binding.operation_manifest_identity.clone(),
        operation_manifest_digest: row.binding.operation_manifest_digest.clone(),
        normalized_doi: row.binding.normalized_doi.clone(),
    };
    Ok(DurableSourceIntakeResearchSnapshotV1 {
        request,
        binding: row.binding,
        receipt: row.receipt,
        provenance: row.provenance,
        candidate: row.candidate,
        transition: row.transition,
    })
}

async fn read_locked_source_intake_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    locked: &LockedTerminalSourceCustodyV1,
    expected_receipt: &SourceAcquisitionReceiptV1,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(locked.started.request_identity())
            .fetch_one(&mut **transaction)
            .await
            .map_err(source_storage)?;
    let readback: SourceIntakePublicReadbackV1 =
        serde_json::from_value(value.ok_or(SourceIntakeError::CustodyMismatch)?)
            .map_err(source_storage)?;

    if readback.receipt.as_ref() != Some(expected_receipt)
        || expected_receipt.invocation_identity.as_deref() != Some(&locked.invocation_identity)
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    Ok(readback)
}

async fn read_locked_source_intake_success_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    locked: &LockedTerminalSourceCustodyV1,
    commit: &SourceIntakeSuccessTerminalCommitV1<'_>,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    verify_locked_terminal_receipt_and_outbox(transaction, locked, commit.receipt, commit.outbox)
        .await?;

    let content_digest = commit
        .receipt
        .content_digest
        .as_deref()
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let raw = sqlx::query(
        "SELECT content_digest,raw_payload FROM public.rd_source_raw_payloads_v1 WHERE content_digest=$1 FOR SHARE",
    )
    .bind(content_digest)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;

    if raw
        .try_get::<String, _>("content_digest")
        .map_err(source_storage)?
        != content_digest
        || raw
            .try_get::<Vec<u8>, _>("raw_payload")
            .map_err(source_storage)?
            != commit.raw_payload
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    let raw_link = sqlx::query(
        "SELECT receipt_identity,terminal,content_digest FROM public.rd_source_raw_receipt_links_v1 WHERE receipt_identity=$1 FOR SHARE",
    )
    .bind(&commit.receipt.receipt_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;

    if raw_link
        .try_get::<String, _>("receipt_identity")
        .map_err(source_storage)?
        != commit.receipt.receipt_identity
        || raw_link
            .try_get::<String, _>("terminal")
            .map_err(source_storage)?
            != "RETRIEVED"
        || raw_link
            .try_get::<String, _>("content_digest")
            .map_err(source_storage)?
            != content_digest
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    let expected_provenance = serde_json::to_value(commit.provenance).map_err(source_storage)?;
    let provenance = sqlx::query(
        "SELECT provenance_identity,receipt_identity,content_digest,provenance_json FROM public.rd_research_source_provenance_v1 WHERE receipt_identity=$1 FOR SHARE",
    )
    .bind(&commit.receipt.receipt_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;

    if provenance
        .try_get::<String, _>("provenance_identity")
        .map_err(source_storage)?
        != commit.provenance.provenance_identity
        || provenance
            .try_get::<String, _>("receipt_identity")
            .map_err(source_storage)?
            != commit.receipt.receipt_identity
        || provenance
            .try_get::<String, _>("content_digest")
            .map_err(source_storage)?
            != content_digest
        || provenance
            .try_get::<serde_json::Value, _>("provenance_json")
            .map_err(source_storage)?
            != expected_provenance
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    let expected_candidate = serde_json::to_value(commit.candidate).map_err(source_storage)?;
    let candidate = sqlx::query(
        "SELECT candidate_identity,provenance_identity,candidate_json FROM public.rd_source_candidates_v1 WHERE provenance_identity=$1 FOR SHARE",
    )
    .bind(&commit.provenance.provenance_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;

    if candidate
        .try_get::<String, _>("candidate_identity")
        .map_err(source_storage)?
        != commit.candidate.candidate_identity
        || candidate
            .try_get::<String, _>("provenance_identity")
            .map_err(source_storage)?
            != commit.provenance.provenance_identity
        || candidate
            .try_get::<serde_json::Value, _>("candidate_json")
            .map_err(source_storage)?
            != expected_candidate
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    read_locked_source_intake_terminal(transaction, locked, commit.receipt).await
}

async fn read_locked_source_intake_failure_terminal(
    transaction: &mut Transaction<'_, Postgres>,
    locked: &LockedTerminalSourceCustodyV1,
    commit: &SourceIntakeFailureTerminalCommitV1<'_>,
) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
    verify_locked_terminal_receipt_and_outbox(transaction, locked, commit.receipt, commit.outbox)
        .await?;
    read_locked_source_intake_terminal(transaction, locked, commit.receipt).await
}

async fn verify_locked_terminal_receipt_and_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    locked: &LockedTerminalSourceCustodyV1,
    expected_receipt: &SourceAcquisitionReceiptV1,
    expected_outbox: &SourceIntakeOutboxV1,
) -> Result<(), SourceIntakeError> {
    if locked.state == "TERMINAL"
        && locked.terminal_receipt_identity.as_deref()
            != Some(expected_receipt.receipt_identity.as_str())
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    let expected_receipt_json = serde_json::to_value(expected_receipt).map_err(source_storage)?;
    let expected_terminal = expected_receipt_json["terminal"]
        .as_str()
        .ok_or(SourceIntakeError::CustodyMismatch)?;
    let expected_response_status = expected_receipt
        .response_status
        .map(i16::try_from)
        .transpose()
        .map_err(|_| SourceIntakeError::CustodyMismatch)?;
    let receipt = sqlx::query(
        "SELECT receipt_identity,request_identity,terminal,response_status,response_header_digest,content_digest,receipt_json,committed_at_epoch_ms FROM public.rd_source_intake_receipts_v1 WHERE request_identity=$1 FOR SHARE",
    )
    .bind(locked.started.request_identity())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(source_storage)?
    .ok_or(SourceIntakeError::CustodyMismatch)?;

    if receipt
        .try_get::<String, _>("receipt_identity")
        .map_err(source_storage)?
        != expected_receipt.receipt_identity
        || receipt
            .try_get::<String, _>("request_identity")
            .map_err(source_storage)?
            != expected_receipt.request_identity
        || receipt
            .try_get::<String, _>("terminal")
            .map_err(source_storage)?
            != expected_terminal
        || receipt
            .try_get::<Option<i16>, _>("response_status")
            .map_err(source_storage)?
            != expected_response_status
        || receipt
            .try_get::<Option<String>, _>("response_header_digest")
            .map_err(source_storage)?
            != expected_receipt.response_header_digest
        || receipt
            .try_get::<Option<String>, _>("content_digest")
            .map_err(source_storage)?
            != expected_receipt.content_digest
        || receipt
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(source_storage)?
            != expected_receipt_json
        || u64::try_from(
            receipt
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(source_storage)?,
        )
        .map_err(|_| SourceIntakeError::CustodyMismatch)?
            != expected_receipt.committed_at_epoch_ms
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }

    let rows = sqlx::query(
        "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='SOURCE_INTAKE_TERMINATED_V1' FOR SHARE",
    )
    .bind(locked.started.request_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(source_storage)?;

    if rows.len() != 1 {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    let outbox = &rows[0];
    if outbox
        .try_get::<String, _>("event_identity")
        .map_err(source_storage)?
        != expected_outbox.event_identity
        || outbox
            .try_get::<String, _>("aggregate_identity")
            .map_err(source_storage)?
            != expected_outbox.aggregate_identity
        || outbox
            .try_get::<String, _>("event_kind")
            .map_err(source_storage)?
            != expected_outbox.event_kind
        || outbox
            .try_get::<String, _>("payload_digest")
            .map_err(source_storage)?
            != expected_outbox.payload_digest
        || outbox
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(source_storage)?
            != serde_json::to_value(expected_outbox).map_err(source_storage)?
        || u64::try_from(
            outbox
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(source_storage)?,
        )
        .map_err(|_| SourceIntakeError::CustodyMismatch)?
            != expected_receipt.committed_at_epoch_ms
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    Ok(())
}

fn source_start_request_from_reservation(
    reservation: &serde_json::Value,
) -> Result<ProductEdgeSourceInvocationStartRequestV1, SourceIntakeError> {
    let required = |name: &str| {
        reservation[name]
            .as_str()
            .map(ToString::to_string)
            .ok_or(SourceIntakeError::CustodyMismatch)
    };
    Ok(ProductEdgeSourceInvocationStartRequestV1 {
        request_identity: required("request_identity")?,
        admission_identity: required("admission_identity")?,
        attempt_identity: required("attempt_identity")?,
        claim_identity: required("claim_identity")?,
        reservation_identity: required("reservation_identity")?,
        reservation_digest: required("reservation_digest")?,
    })
}

fn source_storage(error: impl Display) -> SourceIntakeError {
    SourceIntakeError::Serialization(error.to_string())
}

#[cfg(test)]
impl super::SourceIntakeAttemptV1 {
    pub async fn replay_success_terminal_in_transaction_for_test(
        transaction: &mut Transaction<'_, Postgres>,
        admission_locator: &ProductEdgeAdmissionLocatorV1,
        binding_identity: &str,
        commit: (
            &str,
            &SourceAcquisitionReceiptV1,
            &[u8],
            &ResearchSourceProvenanceV1,
            &SourceCandidateV1,
            &SourceIntakeOutboxV1,
        ),
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let (invocation_identity, receipt, raw_payload, provenance, candidate, outbox) = commit;
        let retrieval_time = SourceIntakeRetrievalTimeEvidenceV1::from_receipt_fixture(receipt);
        commit_source_intake_success_terminal_in_transaction(
            transaction,
            admission_locator,
            binding_identity,
            SourceIntakeSuccessTerminalCommitV1 {
                invocation_identity,
                receipt,
                retrieval_time: &retrieval_time,
                raw_payload,
                provenance,
                candidate,
                outbox,
            },
        )
        .await
    }

    pub async fn replay_failure_terminal_in_transaction_for_test(
        transaction: &mut Transaction<'_, Postgres>,
        admission_locator: &ProductEdgeAdmissionLocatorV1,
        binding_identity: &str,
        invocation_identity: &str,
        receipt: &SourceAcquisitionReceiptV1,
        outbox: &SourceIntakeOutboxV1,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let retrieval_time = SourceIntakeRetrievalTimeEvidenceV1::from_receipt_fixture(receipt);
        commit_source_intake_failure_terminal_in_transaction(
            transaction,
            admission_locator,
            binding_identity,
            SourceIntakeFailureTerminalCommitV1 {
                invocation_identity,
                receipt,
                retrieval_time: &retrieval_time,
                outbox,
            },
        )
        .await
    }
}

impl CanonicalSourceAdmissionPayloadV1 {
    fn validate(&self) -> Result<(), SourceIntakeError> {
        super::validate_normalized_doi(&self.normalized_doi)?;
        self.interpretation.validate()
    }
}

const DERIVE_SOURCE_INTAKE_IDENTITY_SQL_V1: &str =
    "CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_intake_identity_v1(domain text, parts text[])
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.array_to_string(pg_catalog.array_prepend(domain, parts), pg_catalog.chr(31)),
          'UTF8'
        )), 'hex')
      $function$";
const OWN_SOURCE_INTAKE_IDENTITY_SQL_V1: &str =
    "ALTER FUNCTION rd_owner_api.derive_source_intake_identity_v1(text,text[]) OWNER TO rd_owner";
const REVOKE_SOURCE_INTAKE_IDENTITY_SQL_V1: &str = "REVOKE ALL ON FUNCTION rd_owner_api.derive_source_intake_identity_v1(text,text[]) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer";

pub const SOURCE_INTAKE_IDENTITY_PREREQUISITE_SQL_V1: &[&str] = &[
    DERIVE_SOURCE_INTAKE_IDENTITY_SQL_V1,
    OWN_SOURCE_INTAKE_IDENTITY_SQL_V1,
    REVOKE_SOURCE_INTAKE_IDENTITY_SQL_V1,
];

pub const SOURCE_INTAKE_MIGRATION_SQL_V1: &[&str] = &[
    DERIVE_SOURCE_INTAKE_IDENTITY_SQL_V1,
    OWN_SOURCE_INTAKE_IDENTITY_SQL_V1,
    REVOKE_SOURCE_INTAKE_IDENTITY_SQL_V1,
    "CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_json_v1(value jsonb)
      RETURNS text LANGUAGE plpgsql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
      DECLARE result text;
      DECLARE entry record;
      DECLARE first_entry boolean := true;
      BEGIN
        CASE pg_catalog.jsonb_typeof(value)
          WHEN 'object' THEN
            result := '{';
            FOR entry IN SELECT key, child FROM pg_catalog.jsonb_each(value) item(key, child) ORDER BY key LOOP
              IF NOT first_entry THEN result := result || ','; END IF;
              result := result || pg_catalog.to_json(entry.key)::text || ':' ||
                rd_owner_api.canonical_source_intake_json_v1(entry.child);
              first_entry := false;
            END LOOP;
            RETURN result || '}';
          WHEN 'array' THEN
            result := '[';
            FOR entry IN SELECT child FROM pg_catalog.jsonb_array_elements(value) WITH ORDINALITY item(child, ordinality) ORDER BY ordinality LOOP
              IF NOT first_entry THEN result := result || ','; END IF;
              result := result || rd_owner_api.canonical_source_intake_json_v1(entry.child);
              first_entry := false;
            END LOOP;
            RETURN result || ']';
          ELSE RETURN value::text;
        END CASE;
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.canonical_source_intake_json_v1(jsonb) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.canonical_source_intake_json_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.derive_openalex_location_rights_v1(body jsonb, normalized_doi text)
      RETURNS jsonb LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        WITH locations AS (
          SELECT value AS location, ordinality - 1 AS location_index
          FROM pg_catalog.jsonb_array_elements(COALESCE(body->'locations', '[]'::jsonb))
               WITH ORDINALITY AS source(value, ordinality)
        ), locators AS (
          SELECT location, location_index,
            CASE WHEN location->>'landing_page_url' IS NULL THEN NULL ELSE
              'sha256:' || pg_catalog.encode(pg_catalog.sha256(
                pg_catalog.int8send(pg_catalog.octet_length('rd.source-intake.location.landing-page.v1')) ||
                pg_catalog.convert_to('rd.source-intake.location.landing-page.v1', 'UTF8') ||
                pg_catalog.int8send(pg_catalog.octet_length(location->>'landing_page_url')) ||
                pg_catalog.convert_to(location->>'landing_page_url', 'UTF8')
              ), 'hex') END AS landing_digest,
            CASE WHEN location->>'pdf_url' IS NULL THEN NULL ELSE
              'sha256:' || pg_catalog.encode(pg_catalog.sha256(
                pg_catalog.int8send(pg_catalog.octet_length('rd.source-intake.location.pdf.v1')) ||
                pg_catalog.convert_to('rd.source-intake.location.pdf.v1', 'UTF8') ||
                pg_catalog.int8send(pg_catalog.octet_length(location->>'pdf_url')) ||
                pg_catalog.convert_to(location->>'pdf_url', 'UTF8')
              ), 'hex') END AS pdf_digest
          FROM locations
        ), rights AS (
          SELECT location_index, pg_catalog.jsonb_build_object(
            'location_identity', rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.location-rights.v1', ARRAY[
                normalized_doi, location_index::text, COALESCE(landing_digest, 'ABSENT'),
                COALESCE(pdf_digest, 'ABSENT'), COALESCE(location->>'license', 'UNREPORTED')
              ]::text[]
            ),
            'is_open_access_metadata', location->'is_oa',
            'reported_license', location->'license',
            'landing_page_locator_digest', pg_catalog.to_jsonb(landing_digest),
            'pdf_locator_digest', pg_catalog.to_jsonb(pdf_digest),
            'posture', 'MUTABLE_METADATA_NOT_REUSE_GRANT'
          ) AS value
          FROM locators
        )
        SELECT COALESCE(pg_catalog.jsonb_agg(value ORDER BY location_index), '[]'::jsonb)
        FROM rights
      $function$",
    "ALTER FUNCTION rd_owner_api.derive_openalex_location_rights_v1(jsonb,text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.derive_openalex_location_rights_v1(jsonb,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(binding jsonb)
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
        SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          rd_owner_api.canonical_source_intake_json_v1(binding - 'binding_identity' - 'binding_digest'),
          'UTF8')), 'hex')
      $function$",
    "ALTER FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(binding jsonb)
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
        SELECT rd_owner_api.derive_source_intake_identity_v1(
          'rd.source-acquisition-binding-identity.v1',
          ARRAY[rd_owner_api.derive_source_acquisition_binding_digest_v1(binding)]::text[])
      $function$",
    "ALTER FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE TABLE public.rd_source_intake_bindings_v1 (
        request_identity text PRIMARY KEY,
        binding_identity text NOT NULL UNIQUE,
        binding_commit_identity text NOT NULL UNIQUE,
        binding_json jsonb NOT NULL,
        state text NOT NULL CHECK (state IN ('BINDING_CLOSED','PREPARED','INVOCATION_RESERVED','TERMINAL')),
        binding_committed_at_epoch_ms bigint NOT NULL CHECK (binding_committed_at_epoch_ms >= 0),
        product_edge_started_receipt_identity text,
        product_edge_started_json jsonb,
        invocation_identity text UNIQUE,
        terminal_receipt_identity text UNIQUE,
        CHECK (
          (state = 'BINDING_CLOSED' AND product_edge_started_receipt_identity IS NULL AND product_edge_started_json IS NULL AND invocation_identity IS NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'PREPARED' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND invocation_identity IS NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'INVOCATION_RESERVED' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND invocation_identity IS NOT NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'TERMINAL' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND terminal_receipt_identity IS NOT NULL)
        )
      )",
    "CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(
        requested_request_identity text,
        requested_binding_identity text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$
      DECLARE locked record;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT request_identity, binding_identity, binding_commit_identity, binding_json,
               state, binding_committed_at_epoch_ms
          INTO locked
          FROM public.rd_source_intake_bindings_v1
         WHERE request_identity = requested_request_identity
           AND binding_identity = requested_binding_identity
         FOR SHARE;
        IF NOT FOUND
           OR locked.binding_json->>'request_identity' <> locked.request_identity
           OR locked.binding_json->>'binding_identity' <> locked.binding_identity
           OR rd_owner_api.valid_source_intake_binding_contract_v1(locked.binding_json) IS NOT TRUE
           OR locked.binding_json->>'gateway' <> 'WINDMILL_PRODUCT_EDGE'
           OR locked.binding_json#>>'{product_edge_admission,request_identity}' <> locked.request_identity
           OR locked.binding_json#>>'{product_edge_admission,admission_identity}' IS NULL
           OR locked.binding_json#>>'{product_edge_admission,admission_digest}' IS NULL
           OR locked.binding_json->>'operation_manifest_identity' IS NULL
           OR locked.binding_json->>'operation_manifest_digest' IS NULL
           OR locked.binding_json->>'policy_evidence_identity' IS NULL
           OR locked.binding_json->>'policy_evidence_digest' IS NULL
           OR locked.binding_json->>'normalized_doi' IS NULL
           OR locked.binding_json->>'admission' <> 'ADMITTED'
           OR locked.binding_json->>'connector_version' <> 'v1'
           OR locked.binding_json->>'tls_stack_identity' <> 'rustls-only-v1'
           OR locked.binding_json->>'method' <> 'GET'
           OR locked.binding_json->>'endpoint_path' <> '/works/doi:' || (locked.binding_json->>'normalized_doi')
           OR locked.binding_json->>'media_type' <> 'application/json'
           OR (locked.binding_json->>'retry_budget')::smallint <> 0
           OR (locked.binding_json->>'redirect_hop_limit')::smallint <> 0
           OR locked.binding_identity <> rd_owner_api.derive_source_acquisition_binding_identity_v1(locked.binding_json)
        THEN RETURN NULL; END IF;
        RETURN pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'request_identity', locked.request_identity,
          'binding_identity', locked.binding_identity,
          'binding_digest', locked.binding_json->>'binding_digest',
          'admission_identity', locked.binding_json#>>'{product_edge_admission,admission_identity}',
          'admission_digest', locked.binding_json#>>'{product_edge_admission,admission_digest}',
          'operation_manifest_identity', locked.binding_json->>'operation_manifest_identity',
          'operation_manifest_digest', locked.binding_json->>'operation_manifest_digest',
          'normalized_doi', locked.binding_json->>'normalized_doi',
          'binding_commit_identity', locked.binding_commit_identity
        );
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) TO product_edge_owner",
    "CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(
        requested_request_identity text,
        requested_attempt_identity text,
        requested_claim_identity text,
        requested_reservation_identity text,
        requested_reservation_digest text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$
      DECLARE locked record;
      DECLARE reservation jsonb;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT request_identity, binding_identity, binding_commit_identity, binding_json,
               product_edge_started_receipt_identity, product_edge_started_json
          INTO locked
          FROM public.rd_source_intake_bindings_v1
         WHERE request_identity = requested_request_identity
           AND binding_identity = requested_attempt_identity
           AND state = 'PREPARED'
         FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        reservation := locked.product_edge_started_json;
        IF reservation->>'schema_version' <> '1'
           OR reservation->>'request_identity' <> locked.request_identity
           OR reservation->>'binding_identity' <> locked.binding_identity
           OR reservation->>'binding_commit_identity' <> locked.binding_commit_identity
           OR reservation->>'admission_identity' <>
              locked.binding_json#>>'{product_edge_admission,admission_identity}'
           OR reservation->>'attempt_identity' <> locked.binding_identity
           OR reservation->>'claim_identity' <> requested_claim_identity
           OR reservation->>'reservation_identity' <> requested_reservation_identity
           OR reservation->>'reservation_digest' <> requested_reservation_digest
           OR locked.product_edge_started_receipt_identity <> requested_reservation_identity
           OR reservation->>'reserved_at_epoch_ms' IS NULL
           OR pg_catalog.jsonb_typeof(reservation->'interpretation') <> 'object'
        THEN RETURN NULL; END IF;
        RETURN pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'request_identity', reservation->>'request_identity',
          'binding_identity', reservation->>'binding_identity',
          'binding_commit_identity', reservation->>'binding_commit_identity',
          'admission_identity', reservation->>'admission_identity',
          'attempt_identity', reservation->>'attempt_identity',
          'claim_identity', reservation->>'claim_identity',
          'claim_digest', reservation->>'claim_digest',
          'invocation_admission_receipt_identity', reservation->>'invocation_admission_receipt_identity',
          'invocation_admission_receipt_digest', reservation->>'invocation_admission_receipt_digest',
          'claimed_state_digest', reservation->>'claimed_state_digest',
          'reservation_identity', reservation->>'reservation_identity',
          'reservation_digest', reservation->>'reservation_digest',
          'reserved_at_epoch_ms', (reservation->>'reserved_at_epoch_ms')::bigint
        );
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) TO product_edge_owner",
    "CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(
        p_request_identity text,
        p_admission_identity text,
        p_started_receipt_identity text,
        p_started jsonb
      ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(p_started) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started) AS keys(key)) IN (
                 ARRAY['admission_identity','attempt_identity','authority','binding_commit_identity','binding_identity',
                       'claim_digest','claim_identity','claimed_state_digest','interpretation',
                       'invocation_admission_receipt_digest','invocation_admission_receipt_identity',
                       'request_identity','reservation_digest','reservation_identity',
                       'reserved_at_epoch_ms','schema_version']::text[],
                 ARRAY['admission_identity','attempt_identity','authority','binding_commit_identity','binding_identity',
                       'claim_digest','claim_identity','claimed_state_digest','interpretation',
                       'invocation_admission_receipt_digest','invocation_admission_receipt_identity',
                       'policy_decision_digest','policy_decision_identity','policy_time',
                       'request_identity','reservation_digest','reservation_identity',
                       'reserved_at_epoch_ms','schema_version','started_at_epoch_ms',
                       'started_state_digest']::text[]
               )
          AND pg_catalog.jsonb_typeof(p_started->'request_identity') = 'string'
          AND pg_catalog.jsonb_typeof(p_started->'admission_identity') = 'string'
          AND p_started->>'request_identity' = p_request_identity
          AND p_started->>'admission_identity' = p_admission_identity
          AND p_started->>'schema_version' = '1'
          AND p_started->>'attempt_identity' = p_started->>'binding_identity'
          AND p_started->>'claim_identity' IS NOT NULL
          AND p_started->>'claim_digest' IS NOT NULL
          AND p_started->>'claimed_state_digest' IS NOT NULL
          AND p_started->>'invocation_admission_receipt_identity' IS NOT NULL
          AND p_started->>'invocation_admission_receipt_digest' IS NOT NULL
          AND p_started->>'reservation_identity' IS NOT NULL
          AND p_started->>'reservation_digest' IS NOT NULL
          AND p_started->>'reserved_at_epoch_ms' IS NOT NULL
          AND pg_catalog.jsonb_typeof(p_started->'authority') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started->'authority') AS keys(key)) = ARRAY[
                 'authority_class','environment_identity','fixture_corpus_digest','provider_profile_digest'
               ]::text[]
          AND p_started#>>'{authority,authority_class}' IN ('LIVE_EXTERNAL','SEALED_ACCEPTANCE')
          AND p_started#>>'{authority,environment_identity}' <> ''
          AND p_started#>>'{authority,provider_profile_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND (
            p_started->>'started_state_digest' IS NULL
            OR (p_started->>'policy_decision_identity' IS NOT NULL
                AND p_started->>'policy_decision_digest' ~ '^sha256:[0-9a-f]{64}$'
                AND pg_catalog.jsonb_typeof(p_started->'policy_time') = 'object')
          )
          AND p_started_receipt_identity = COALESCE(
                p_started->>'started_state_digest', p_started->>'reservation_identity'
              )
          AND pg_catalog.octet_length(p_started_receipt_identity) BETWEEN 1 AND 256
          AND p_started_receipt_identity !~ '[[:cntrl:]]'
          AND pg_catalog.jsonb_typeof(p_started->'interpretation') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started->'interpretation') AS keys(key)) = ARRAY[
                 'bounded_explanation','differentiating_prediction','falsifier','plausible_alternatives'
               ]::text[]
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,bounded_explanation}') = 'string'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,differentiating_prediction}') = 'string'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,falsifier}') = 'string'
          AND pg_catalog.btrim(p_started#>>'{interpretation,bounded_explanation}') <> ''
          AND pg_catalog.btrim(p_started#>>'{interpretation,differentiating_prediction}') <> ''
          AND pg_catalog.btrim(p_started#>>'{interpretation,falsifier}') <> ''
          AND pg_catalog.octet_length(p_started#>>'{interpretation,bounded_explanation}') <= 8192
          AND pg_catalog.octet_length(p_started#>>'{interpretation,differentiating_prediction}') <= 8192
          AND pg_catalog.octet_length(p_started#>>'{interpretation,falsifier}') <= 8192
          AND (p_started#>>'{interpretation,bounded_explanation}') !~ '[[:cntrl:]]'
          AND (p_started#>>'{interpretation,differentiating_prediction}') !~ '[[:cntrl:]]'
          AND (p_started#>>'{interpretation,falsifier}') !~ '[[:cntrl:]]'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,plausible_alternatives}') = 'array'
          AND pg_catalog.jsonb_array_length(p_started#>'{interpretation,plausible_alternatives}') BETWEEN 1 AND 16
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(
              p_started#>'{interpretation,plausible_alternatives}'
            ) AS alternative(value)
            WHERE pg_catalog.jsonb_typeof(value) <> 'string'
               OR pg_catalog.btrim(value#>>'{}') = ''
               OR pg_catalog.octet_length(value#>>'{}') > 8192
               OR (value#>>'{}') ~ '[[:cntrl:]]'
          )
          AND (SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT value)
               FROM pg_catalog.jsonb_array_elements_text(
                 p_started#>'{interpretation,plausible_alternatives}'
               ) AS alternative(value))
      $function$",
    "ALTER FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.guard_source_intake_binding_v1()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
      BEGIN
        IF OLD.request_identity IS DISTINCT FROM NEW.request_identity
           OR OLD.binding_identity IS DISTINCT FROM NEW.binding_identity
           OR OLD.binding_commit_identity IS DISTINCT FROM NEW.binding_commit_identity
           OR OLD.binding_json IS DISTINCT FROM NEW.binding_json
           OR OLD.binding_committed_at_epoch_ms IS DISTINCT FROM NEW.binding_committed_at_epoch_ms THEN
          RAISE EXCEPTION 'immutable Source Intake binding changed';
        END IF;
        IF OLD.state IN ('INVOCATION_RESERVED','TERMINAL')
           AND (OLD.product_edge_started_receipt_identity IS DISTINCT FROM NEW.product_edge_started_receipt_identity
                OR OLD.product_edge_started_json IS DISTINCT FROM NEW.product_edge_started_json) THEN
          RAISE EXCEPTION 'committed Product Edge started custody changed';
        END IF;
        IF OLD.state = 'BINDING_CLOSED'
           AND NEW.state = 'PREPARED'
           AND rd_owner_api.valid_source_intake_started_custody_v1(
             NEW.request_identity,
             NEW.binding_json#>>'{product_edge_admission,admission_identity}',
             NEW.product_edge_started_receipt_identity,
             NEW.product_edge_started_json
           ) IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'invalid Product Edge started custody';
        END IF;
        IF OLD.state = 'PREPARED'
           AND NEW.state = 'INVOCATION_RESERVED'
           AND (
             rd_owner_api.valid_source_intake_started_custody_v1(
               NEW.request_identity,
               NEW.binding_json#>>'{product_edge_admission,admission_identity}',
               NEW.product_edge_started_receipt_identity,
               NEW.product_edge_started_json
             ) IS DISTINCT FROM true
             OR NEW.product_edge_started_json->>'started_state_digest' IS NULL
             OR OLD.product_edge_started_json - 'interpretation'
                IS DISTINCT FROM NEW.product_edge_started_json - 'interpretation'
                                                       - 'started_state_digest'
                                                       - 'started_at_epoch_ms'
                                                       - 'policy_decision_identity'
                                                       - 'policy_decision_digest'
                                                       - 'policy_time'
             OR OLD.product_edge_started_json->'interpretation'
                IS DISTINCT FROM NEW.product_edge_started_json->'interpretation'
           ) THEN
          RAISE EXCEPTION 'invalid Product Edge started transition custody';
        END IF;
        IF NOT ((OLD.state = 'BINDING_CLOSED' AND NEW.state = 'PREPARED')
                OR (OLD.state = 'PREPARED' AND NEW.state = 'INVOCATION_RESERVED'
                    AND OLD.invocation_identity IS NULL AND NEW.invocation_identity IS NOT NULL)
                OR (OLD.state = 'PREPARED' AND NEW.state = 'TERMINAL'
                    AND OLD.invocation_identity IS NULL AND NEW.invocation_identity IS NULL)
                OR (OLD.state = 'INVOCATION_RESERVED' AND NEW.state = 'TERMINAL'
                    AND OLD.invocation_identity = NEW.invocation_identity)) THEN
          RAISE EXCEPTION 'invalid Source Intake lifecycle transition';
        END IF;
        RETURN NEW;
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.guard_source_intake_binding_v1() OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.guard_source_intake_binding_v1() FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE TRIGGER rd_source_intake_binding_guard_v1 BEFORE UPDATE ON public.rd_source_intake_bindings_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_source_intake_binding_v1()",
    "CREATE TABLE public.rd_source_intake_receipts_v1 (
        receipt_identity text PRIMARY KEY,
        request_identity text NOT NULL UNIQUE REFERENCES public.rd_source_intake_bindings_v1(request_identity),
        terminal text NOT NULL CHECK (terminal IN ('RETRIEVED','NOT_FOUND','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','TERMS_OR_LICENSE_BLOCKED','MALFORMED','UNAVAILABLE')),
        response_status smallint,
        response_header_digest text,
        content_digest text,
        receipt_json jsonb NOT NULL,
        attempt_identity text GENERATED ALWAYS AS (receipt_json->>'attempt_identity') STORED,
        terminal_evidence_identity text GENERATED ALWAYS AS (receipt_json->>'terminal_evidence_identity') STORED,
        terminal_evidence_digest text GENERATED ALWAYS AS (receipt_json->>'terminal_evidence_digest') STORED,
        connected_address inet GENERATED ALWAYS AS ((receipt_json->>'connected_address')::inet) STORED,
        response_media_type text GENERATED ALWAYS AS (receipt_json->>'response_media_type') STORED,
        response_size_bytes bigint GENERATED ALWAYS AS ((receipt_json->>'response_size_bytes')::bigint) STORED,
        shared_time_head_digest text GENERATED ALWAYS AS (receipt_json#>>'{retrieval_time,head_digest}') STORED,
        committed_at_epoch_ms bigint NOT NULL CHECK (committed_at_epoch_ms >= 0),
        CHECK (
          (terminal = 'RETRIEVED' AND response_status = 200 AND response_header_digest IS NOT NULL AND content_digest IS NOT NULL)
          OR (terminal <> 'RETRIEVED' AND content_digest IS NULL)
        ),
        UNIQUE (receipt_identity, terminal)
      )",
    "CREATE TABLE public.rd_source_raw_payloads_v1 (
        content_digest text PRIMARY KEY,
        raw_payload bytea NOT NULL CHECK (octet_length(raw_payload) BETWEEN 1 AND 1048576)
      )",
    "CREATE TABLE public.rd_source_raw_receipt_links_v1 (
        receipt_identity text PRIMARY KEY,
        terminal text NOT NULL DEFAULT 'RETRIEVED' CHECK (terminal = 'RETRIEVED'),
        content_digest text NOT NULL REFERENCES public.rd_source_raw_payloads_v1(content_digest),
        UNIQUE (receipt_identity, content_digest),
        FOREIGN KEY (receipt_identity, terminal)
          REFERENCES public.rd_source_intake_receipts_v1(receipt_identity, terminal)
      )",
    "CREATE TABLE public.rd_research_source_provenance_v1 (
        provenance_identity text PRIMARY KEY,
        receipt_identity text NOT NULL UNIQUE,
        content_digest text NOT NULL,
        provenance_json jsonb NOT NULL,
        predecessor_provenance_identity text GENERATED ALWAYS AS (provenance_json->>'predecessor_provenance_identity') STORED,
        canonical_source_origin text GENERATED ALWAYS AS (provenance_json->>'canonical_source_origin') STORED,
        source_class text GENERATED ALWAYS AS (provenance_json->>'source_class') STORED,
        author_or_originating_system text GENERATED ALWAYS AS (provenance_json->>'author_or_originating_system') STORED,
        publication_time_epoch_ms bigint GENERATED ALWAYS AS ((provenance_json->>'publication_time_epoch_ms')::bigint) STORED,
        revision_identity text GENERATED ALWAYS AS (provenance_json->>'revision_identity') STORED,
        raw_content_digest text GENERATED ALWAYS AS (provenance_json->>'raw_content_digest') STORED,
        retrieval_time_head_digest text GENERATED ALWAYS AS (provenance_json#>>'{retrieval_time,head_digest}') STORED,
        rights_policy_version text GENERATED ALWAYS AS (provenance_json->>'rights_policy_version') STORED,
        retention_policy_version text GENERATED ALWAYS AS (provenance_json->>'retention_policy_version') STORED,
        interpretation_status text GENERATED ALWAYS AS (provenance_json->>'interpretation_status') STORED,
        FOREIGN KEY (receipt_identity, content_digest)
          REFERENCES public.rd_source_raw_receipt_links_v1(receipt_identity, content_digest)
      )",
    "CREATE TABLE public.rd_source_candidates_v1 (
        candidate_identity text PRIMARY KEY,
        provenance_identity text NOT NULL UNIQUE REFERENCES public.rd_research_source_provenance_v1(provenance_identity),
        candidate_json jsonb NOT NULL
      )",
    "ALTER TABLE public.rd_source_intake_bindings_v1
       ADD CONSTRAINT rd_source_intake_terminal_receipt_v1
       FOREIGN KEY (terminal_receipt_identity)
       REFERENCES public.rd_source_intake_receipts_v1(receipt_identity)",
    "ALTER TABLE public.rd_source_intake_bindings_v1 OWNER TO rd_owner",
    "ALTER TABLE public.rd_source_intake_receipts_v1 OWNER TO rd_owner",
    "ALTER TABLE public.rd_source_raw_payloads_v1 OWNER TO rd_owner",
    "ALTER TABLE public.rd_source_raw_receipt_links_v1 OWNER TO rd_owner",
    "ALTER TABLE public.rd_research_source_provenance_v1 OWNER TO rd_owner",
    "ALTER TABLE public.rd_source_candidates_v1 OWNER TO rd_owner",
    "CREATE OR REPLACE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
      AS $function$
      BEGIN
        RAISE EXCEPTION 'immutable Source Intake terminal custody changed';
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1() OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1() FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE TRIGGER rd_source_intake_receipt_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_intake_receipts_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()",
    "CREATE TRIGGER rd_source_raw_payload_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_raw_payloads_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()",
    "CREATE TRIGGER rd_source_raw_receipt_link_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_raw_receipt_links_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()",
    "CREATE TRIGGER rd_research_source_provenance_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_research_source_provenance_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()",
    "CREATE TRIGGER rd_source_candidate_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_candidates_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()",
    "REVOKE ALL ON public.rd_source_intake_bindings_v1, public.rd_source_intake_receipts_v1, public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1, public.rd_research_source_provenance_v1, public.rd_source_candidates_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "GRANT SELECT, INSERT, UPDATE ON public.rd_source_intake_bindings_v1 TO rd_owner",
    "GRANT SELECT, INSERT, UPDATE, REFERENCES ON public.rd_source_intake_receipts_v1, public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1, public.rd_research_source_provenance_v1, public.rd_source_candidates_v1 TO rd_owner",
    "CREATE OR REPLACE FUNCTION rd_owner_api.read_source_intake_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
        WITH observed AS (
          SELECT binding.*,
                 receipt.receipt_identity, receipt.request_identity AS receipt_request_identity,
                 receipt.terminal, receipt.response_status, receipt.response_header_digest,
                 receipt.content_digest AS receipt_content_digest, receipt.receipt_json,
                 receipt.committed_at_epoch_ms,
                 raw_link.receipt_identity AS raw_link_receipt_identity,
                 raw_link.content_digest AS raw_link_content_digest,
                 raw.content_digest AS raw_content_digest, raw.raw_payload,
                 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex') AS observed_content_digest,
                 provenance.provenance_identity, provenance.receipt_identity AS provenance_receipt_identity,
                 provenance.content_digest AS provenance_content_digest, provenance.provenance_json,
                 candidate.candidate_identity, candidate.provenance_identity AS candidate_provenance_identity,
                 candidate.candidate_json,
                 outbox.event_identity, outbox.aggregate_identity, outbox.event_kind,
                 outbox.payload_digest, outbox.payload_json,
                 outbox.committed_at_epoch_ms AS outbox_committed_at_epoch_ms
          FROM public.rd_source_intake_bindings_v1 binding
          LEFT JOIN public.rd_source_intake_receipts_v1 receipt
            ON receipt.request_identity = binding.request_identity
          LEFT JOIN public.rd_source_raw_receipt_links_v1 raw_link
            ON raw_link.receipt_identity = receipt.receipt_identity
          LEFT JOIN public.rd_source_raw_payloads_v1 raw
            ON raw.content_digest = raw_link.content_digest
          LEFT JOIN public.rd_research_source_provenance_v1 provenance
            ON provenance.receipt_identity = raw_link.receipt_identity
           AND provenance.content_digest = raw_link.content_digest
          LEFT JOIN public.rd_source_candidates_v1 candidate
            ON candidate.provenance_identity = provenance.provenance_identity
          LEFT JOIN public.rd_owner_outbox_v1 outbox
            ON outbox.aggregate_identity = binding.request_identity
           AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          WHERE binding.request_identity = p_request_identity
        ), interpreted AS (
          SELECT observed.*,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     observed.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(
                          observed.product_edge_started_json#>'{interpretation,plausible_alternatives}'
                        ) WITH ORDINALITY AS alternative(value, ordinality)),
                     observed.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     observed.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[]
                 ) AS observed_interpretation_digest
          FROM observed
        ), derived AS (
          SELECT interpreted.*,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-interpretation.v1',
                   ARRAY[interpreted.observed_interpretation_digest]::text[]
                 ) AS observed_interpretation_identity
          FROM interpreted
        )
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'binding_identity', binding.binding_identity,
          'authority', binding.binding_json->'authority',
          'state', binding.state,
          'terminal', binding.terminal,
          'receipt', CASE WHEN binding.receipt_identity IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'receipt_identity', binding.receipt_identity,
            'request_identity', binding.receipt_request_identity,
            'binding_identity', binding.binding_identity,
            'invocation_identity', binding.invocation_identity,
            'terminal', binding.terminal,
            'response_status', binding.response_status,
            'response_header_digest', binding.response_header_digest,
            'content_digest', binding.receipt_content_digest,
            'committed_at_epoch_ms', binding.committed_at_epoch_ms
          ) END,
          'content_locator', CASE WHEN binding.raw_content_digest IS NULL THEN NULL ELSE 'rd-owner://source-payload/sha256/' || binding.raw_content_digest END,
          'content_digest', binding.raw_content_digest,
          'provenance_identity', binding.provenance_identity,
          'source_candidate_identity', binding.candidate_identity,
          'outbox_event_identity', binding.event_identity
        )
        FROM derived binding
        WHERE binding.state = 'TERMINAL'
          AND binding.terminal_receipt_identity = binding.receipt_identity
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('binding_identity'), ('request_identity'), ('channel'), ('admission_identity'),
              ('operation_manifest_identity'), ('normalized_doi'), ('connector_identity'),
              ('connector_version'), ('tls_stack_identity'), ('method'), ('https_origin'),
              ('endpoint_path'), ('absent_body_digest'), ('allowed_header_digest'), ('media_type'),
              ('rights_basis_identity'), ('retention_policy_identity'), ('time_evidence_identity'),
              ('admission')
            ) AS field(key)
            WHERE pg_catalog.jsonb_typeof(binding.binding_json->field.key)
                  IS DISTINCT FROM 'string'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('byte_limit'), ('timeout_ms'), ('retry_budget'), ('redirect_hop_limit'),
              ('observed_at_epoch_ms')
            ) AS field(key)
            WHERE pg_catalog.jsonb_typeof(binding.binding_json->field.key)
                  IS DISTINCT FROM 'number'
          )
          AND pg_catalog.jsonb_typeof(binding.binding_json->'resolved_addresses') = 'array'
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(binding.binding_json->'resolved_addresses') AS address(value)
            WHERE pg_catalog.jsonb_typeof(value) <> 'string'
          )
          AND binding.binding_json = pg_catalog.jsonb_build_object(
            'binding_identity', binding.binding_identity,
            'request_identity', binding.request_identity,
            'channel', binding.binding_json->>'channel',
            'admission_identity', binding.binding_json->>'admission_identity',
            'operation_manifest_identity', binding.binding_json->>'operation_manifest_identity',
            'normalized_doi', binding.binding_json->>'normalized_doi',
            'connector_identity', 'rd.openalex-work-by-doi',
            'connector_version', 'v1',
            'tls_stack_identity', 'rustls-only-v1',
            'method', 'GET',
            'https_origin', 'https://api.openalex.org',
            'endpoint_path', ('/works/doi:' || (binding.binding_json->>'normalized_doi')),
            'resolved_addresses', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'resolved_addresses') = 'array'
               AND NOT EXISTS (
                 SELECT 1
                 FROM pg_catalog.jsonb_array_elements(binding.binding_json->'resolved_addresses') AS address(value)
                 WHERE pg_catalog.jsonb_typeof(value) <> 'string'
               )
              THEN binding.binding_json->'resolved_addresses'
              ELSE NULL
            END,
            'absent_body_digest', binding.binding_json->>'absent_body_digest',
            'allowed_header_digest', binding.binding_json->>'allowed_header_digest',
            'media_type', 'application/json',
            'byte_limit', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'byte_limit') = 'number'
              THEN binding.binding_json->'byte_limit' ELSE NULL
            END,
            'timeout_ms', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'timeout_ms') = 'number'
              THEN binding.binding_json->'timeout_ms' ELSE NULL
            END,
            'retry_budget', 0,
            'redirect_hop_limit', 0,
            'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
            'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
            'time_evidence_identity', binding.binding_json->>'time_evidence_identity',
            'observed_at_epoch_ms', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'observed_at_epoch_ms') = 'number'
              THEN binding.binding_json->'observed_at_epoch_ms' ELSE NULL
            END,
            'admission', binding.binding_json->>'admission'
          )
          AND binding.binding_identity = rd_owner_api.derive_source_acquisition_binding_identity_v1(binding.binding_json)
          AND rd_owner_api.valid_source_intake_started_custody_v1(
            binding.request_identity,
            binding.binding_json->>'admission_identity',
            binding.product_edge_started_receipt_identity,
            binding.product_edge_started_json
          )
          AND (
            binding.invocation_identity IS NULL
            OR binding.invocation_identity = rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.openalex.invocation.v1', ARRAY[
                binding.request_identity, binding.binding_identity,
                binding.binding_commit_identity,
                binding.product_edge_started_receipt_identity
              ]::text[]
            )
          )
          AND binding.receipt_request_identity = binding.request_identity
          AND binding.receipt_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.source-intake.receipt.v1', ARRAY[
              binding.request_identity, binding.binding_identity,
              COALESCE(binding.invocation_identity, rd_owner_api.derive_source_intake_identity_v1(
                'rd.source-intake.pre-invocation.v1', ARRAY[
                  binding.request_identity, binding.binding_identity,
                  binding.binding_commit_identity,
                  binding.product_edge_started_receipt_identity
                ]::text[]
              )), binding.terminal,
              COALESCE(binding.receipt_content_digest, 'ABSENT'),
              COALESCE(binding.response_status::text, 'ABSENT'),
              COALESCE(binding.response_header_digest, 'ABSENT'),
              binding.committed_at_epoch_ms::text
            ]::text[]
          )
          AND binding.receipt_json = pg_catalog.jsonb_build_object(
            'receipt_identity', binding.receipt_identity,
            'request_identity', binding.request_identity,
            'binding_identity', binding.binding_identity,
            'invocation_identity', binding.invocation_identity,
            'terminal', binding.terminal,
            'response_status', binding.response_status,
            'response_header_digest', binding.response_header_digest,
            'content_digest', binding.receipt_content_digest,
            'committed_at_epoch_ms', binding.committed_at_epoch_ms
          )
          AND binding.aggregate_identity = binding.request_identity
          AND binding.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          AND binding.event_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.owner-outbox.source-intake-terminated.v1',
            ARRAY[binding.request_identity, binding.receipt_identity]::text[]
          )
          AND binding.payload_digest = rd_owner_api.derive_source_intake_identity_v1(
            'rd.owner-outbox.payload.v1', ARRAY[
              binding.request_identity, binding.receipt_identity,
              COALESCE(binding.provenance_identity, 'ABSENT'),
              COALESCE(binding.candidate_identity, 'ABSENT')
            ]::text[]
          )
          AND binding.payload_json = pg_catalog.jsonb_build_object(
            'event_identity', binding.event_identity,
            'aggregate_identity', binding.aggregate_identity,
            'event_kind', binding.event_kind,
            'payload_digest', binding.payload_digest
          )
          AND binding.outbox_committed_at_epoch_ms = binding.committed_at_epoch_ms
          AND (
            binding.terminal <> 'RETRIEVED'
            OR (
             binding.invocation_identity IS NOT NULL
             AND binding.raw_link_receipt_identity = binding.receipt_identity
             AND binding.raw_link_content_digest = binding.receipt_content_digest
             AND binding.raw_content_digest = binding.observed_content_digest
             AND binding.raw_content_digest = binding.receipt_content_digest
             AND binding.provenance_receipt_identity = binding.receipt_identity
             AND binding.provenance_content_digest = binding.observed_content_digest
             AND binding.provenance_json = pg_catalog.jsonb_build_object(
               'provenance_identity', binding.provenance_identity,
               'canonical_source_identity',
                 ('doi:' || (binding.binding_json->>'normalized_doi')),
               'content_digest', binding.observed_content_digest,
               'connector_identity', 'rd.openalex-work-by-doi',
               'connector_version', 'v1',
               'acquisition_receipt_identity', binding.receipt_identity,
               'time_evidence_identity', binding.binding_json->>'time_evidence_identity',
               'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
               'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
               'bounded_interpretation_identity',
                 binding.observed_interpretation_identity,
               'bounded_interpretation_digest',
                 binding.observed_interpretation_digest,
               'interpretation', binding.product_edge_started_json->'interpretation',
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA',
               'location_rights', rd_owner_api.derive_openalex_location_rights_v1(
                 pg_catalog.convert_from(binding.raw_payload, 'UTF8')::jsonb,
                 binding.binding_json->>'normalized_doi'
               )
             )
             AND binding.provenance_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.research-source-provenance.v1', ARRAY[
                 binding.binding_json->>'normalized_doi', binding.observed_content_digest,
                 binding.receipt_identity, binding.binding_json->>'time_evidence_identity',
                 binding.observed_interpretation_identity,
                 binding.observed_interpretation_digest
               ]::text[]
             )
             AND binding.candidate_provenance_identity = binding.provenance_identity
             AND binding.candidate_json = pg_catalog.jsonb_build_object(
               'candidate_identity', binding.candidate_identity,
               'provenance_identity', binding.provenance_identity,
               'interpretation_digest', binding.observed_interpretation_digest,
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             )
             AND binding.candidate_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.source-candidate.v1', ARRAY[
                 binding.provenance_identity,
                 binding.observed_interpretation_digest
               ]::text[]
             )
            )
          )
      $function$",
    "ALTER FUNCTION rd_owner_api.read_source_intake_v1(text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(binding jsonb)
      RETURNS boolean LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(binding) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding) keys(key)) = ARRAY[
            'absent_body_digest','acquisition_scope','admission','allowed_header_digest','authority',
            'binding_digest','binding_identity','body_media_type','body_size_bytes','byte_limit',
            'connector_identity','connector_policy_identity','connector_policy_version','connector_version',
            'credential_audience','credential_handle_identity','credential_placement',
            'credential_policy_identity','credential_scope','dns_observation_digest',
            'dns_observation_identity','dns_policy_identity','dns_policy_version',
            'egress_policy_identity','egress_policy_version','endpoint_path','endpoint_query',
            'gateway','header_byte_limit','header_count_limit','host','https_origin','media_type',
            'method','network_policy_identity','network_policy_version','normalized_doi',
            'operation_manifest_digest','operation_manifest_identity','policy_evidence_digest',
            'policy_evidence_identity','predecessor_binding_identity','product_edge_admission',
            'redirect_hop_index','redirect_hop_limit','redirect_policy_identity',
            'redirect_policy_version','redirect_predecessor_binding_identity','request_identity',
            'resolved_addresses',
            'retention_effective_at_epoch_ms','retention_policy_identity','retention_policy_version',
            'retention_scope','retention_valid_through_epoch_ms','retry_budget','rights_basis_identity',
            'rights_effective_at_epoch_ms','rights_policy_version','rights_valid_through_epoch_ms',
            'schema_version','scheme','shared_time','timeout_ms','tls_policy_identity','tls_policy_version',
            'tls_stack_identity'
          ]::text[]
          AND binding->>'schema_version' = '1'
          AND binding->>'gateway' = 'WINDMILL_PRODUCT_EDGE'
          AND binding->>'predecessor_binding_identity' IS NULL
          AND pg_catalog.jsonb_typeof(binding->'authority') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'authority') keys(key)) = ARRAY[
            'authority_class','environment_identity','fixture_corpus_digest','provider_profile_digest'
          ]::text[]
          AND binding#>>'{authority,authority_class}' IN ('LIVE_EXTERNAL','SEALED_ACCEPTANCE')
          AND binding#>>'{authority,environment_identity}' <> ''
          AND binding#>>'{authority,provider_profile_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND (
            (binding#>>'{authority,authority_class}' = 'LIVE_EXTERNAL'
             AND binding#>>'{authority,environment_identity}' = 'PRODUCTION_LIVE_EXTERNAL'
             AND binding#>>'{authority,provider_profile_digest}' = 'sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b'
             AND binding#>>'{authority,fixture_corpus_digest}' IS NULL)
            OR
            (binding#>>'{authority,authority_class}' = 'SEALED_ACCEPTANCE'
             AND binding#>>'{authority,environment_identity}' = 'source-intake-sealed-acceptance-environment-v1'
             AND binding#>>'{authority,provider_profile_digest}' = 'sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15'
             AND binding#>>'{authority,fixture_corpus_digest}' = 'sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18')
          )
          AND pg_catalog.jsonb_typeof(binding->'product_edge_admission') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'product_edge_admission') keys(key))
              = ARRAY['admission_digest','admission_identity','request_identity']::text[]
          AND binding#>>'{product_edge_admission,request_identity}' = binding->>'request_identity'
          AND binding#>>'{product_edge_admission,admission_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'operation_manifest_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'policy_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'connector_policy_identity' <> ''
          AND binding->>'connector_policy_version' <> ''
          AND binding->>'network_policy_identity' <> ''
          AND binding->>'network_policy_version' <> ''
          AND binding->>'dns_policy_identity' <> ''
          AND binding->>'dns_policy_version' <> ''
          AND binding->>'dns_observation_identity' <> ''
          AND binding->>'dns_observation_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'redirect_policy_identity' <> ''
          AND binding->>'redirect_policy_version' <> ''
          AND binding->>'credential_policy_identity' <> ''
          AND binding->>'credential_handle_identity' <> ''
          AND binding->>'credential_audience' <> ''
          AND binding->>'credential_scope' <> ''
          AND binding->>'egress_policy_identity' <> ''
          AND binding->>'egress_policy_version' <> ''
          AND binding->>'connector_version' = 'v1'
          AND binding->>'tls_stack_identity' = 'rustls-only-v1'
          AND binding->>'method' = 'GET'
          AND (
            (binding#>>'{authority,authority_class}' = 'LIVE_EXTERNAL'
             AND binding->>'connector_identity' = 'rd.openalex-work-by-doi'
             AND binding->>'scheme' = 'https'
             AND binding->>'host' = 'api.openalex.org'
             AND binding->>'https_origin' = 'https://api.openalex.org')
            OR
            (binding#>>'{authority,authority_class}' = 'SEALED_ACCEPTANCE'
             AND binding->>'connector_identity' = 'rd.openalex-work-by-doi.sealed-acceptance'
             AND binding->>'scheme' = 'sealed-acceptance'
             AND binding->>'host' = 'openalex-fixture.source-intake.invalid'
             AND binding->>'https_origin' = 'sealed-acceptance://openalex-fixture.source-intake.invalid'
             AND binding->>'credential_handle_identity' = 'NO_CREDENTIAL_CAPABILITY'
             AND binding->>'egress_policy_identity' = 'NO_EXTERNAL_NETWORK')
          )
          AND binding->>'endpoint_path' = '/works/doi:' || (binding->>'normalized_doi')
          AND binding->>'endpoint_query' = ''
          AND binding->>'redirect_predecessor_binding_identity' IS NULL
          AND binding->>'redirect_hop_index' = '0'
          AND binding->>'redirect_hop_limit' = '0'
          AND binding->>'retry_budget' = '0'
          AND binding->>'body_media_type' IS NULL
          AND binding->>'body_size_bytes' = '0'
          AND binding->>'credential_placement' = 'ABSENT_BODY_AND_HEADERS'
          AND binding->>'media_type' = 'application/json'
          AND pg_catalog.jsonb_typeof(binding->'resolved_addresses') = 'array'
          AND pg_catalog.jsonb_array_length(binding->'resolved_addresses') BETWEEN 1 AND 8
          AND pg_catalog.jsonb_typeof(binding->'shared_time') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'shared_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND binding#>>'{shared_time,comparison_rule}' = 'EXCLUSIVE_VALID_THROUGH'
          AND (binding#>>'{shared_time,monotonic_sequence}')::bigint > 0
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding#>>'{shared_time,valid_through_epoch_ms}')::bigint
          AND (binding->>'rights_effective_at_epoch_ms')::bigint
                <= (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding->>'rights_valid_through_epoch_ms')::bigint
          AND (binding->>'retention_effective_at_epoch_ms')::bigint
                <= (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding->>'retention_valid_through_epoch_ms')::bigint
          AND binding->>'admission' IN ('ADMITTED','REJECTED','POLICY_UNAVAILABLE')
          AND (binding->>'header_count_limit')::bigint = 64
          AND (binding->>'header_byte_limit')::bigint = 32768
          AND (binding->>'byte_limit')::bigint BETWEEN 1 AND 1048576
          AND (binding->>'timeout_ms')::bigint BETWEEN 1 AND 5000
          AND binding->>'binding_digest'
                = rd_owner_api.derive_source_acquisition_binding_digest_v1(binding)
          AND binding->>'binding_identity'
                = rd_owner_api.derive_source_acquisition_binding_identity_v1(binding)
      $function$",
    "ALTER FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(jsonb) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_receipt_v1(
        receipt jsonb, row_receipt_identity text, row_request_identity text, row_binding_identity text,
        row_invocation_identity text, row_terminal text, row_response_status smallint,
        row_response_header_digest text, row_content_digest text, row_committed_at_epoch_ms bigint
      ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(receipt) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt) keys(key)) = ARRAY[
            'attempt_identity','binding_identity','committed_at_epoch_ms','connected_address',
            'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
            'policy_decision_time','receipt_identity','request_identity','response_header_digest',
            'response_media_type','response_size_bytes','response_status','retrieval_time',
            'retrieval_time_evidence_digest','retrieval_time_evidence_identity','schema_version',
            'terminal','terminal_evidence_digest','terminal_evidence_identity'
          ]::text[]
          AND receipt->>'schema_version' = '1'
          AND receipt->>'receipt_identity' = row_receipt_identity
          AND receipt->>'request_identity' = row_request_identity
          AND receipt->>'binding_identity' = row_binding_identity
          AND receipt->>'attempt_identity' = row_binding_identity
          AND receipt->>'invocation_identity' IS NOT DISTINCT FROM row_invocation_identity
          AND receipt->>'terminal' = row_terminal
          AND (receipt->>'response_status')::smallint IS NOT DISTINCT FROM row_response_status
          AND receipt->>'response_header_digest' IS NOT DISTINCT FROM row_response_header_digest
          AND receipt->>'content_digest' IS NOT DISTINCT FROM row_content_digest
          AND (receipt->>'committed_at_epoch_ms')::bigint = row_committed_at_epoch_ms
          AND receipt->>'terminal_evidence_identity' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'terminal_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'policy_decision_identity' <> ''
          AND receipt->>'policy_decision_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'retrieval_time_evidence_identity' <> ''
          AND receipt->>'retrieval_time_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND pg_catalog.jsonb_typeof(receipt->'policy_decision_time') = 'object'
          AND pg_catalog.jsonb_typeof(receipt->'retrieval_time') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt->'policy_decision_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt->'retrieval_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND (receipt#>>'{policy_decision_time,decision_cut_epoch_ms}')::bigint
                <= (receipt#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
          AND (receipt#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
                < (receipt#>>'{retrieval_time,valid_through_epoch_ms}')::bigint
      $function$",
    "ALTER FUNCTION rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_custody_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'binding_identity', binding.binding_identity,
          'authority', binding.binding_json->'authority',
          'state', binding.state,
          'terminal', receipt.terminal,
          'receipt', receipt.receipt_json,
          'content_locator', CASE WHEN receipt.terminal = 'RETRIEVED'
            THEN 'rd-owner://source-payload/sha256/' || receipt.content_digest ELSE NULL END,
          'content_digest', receipt.content_digest,
          'provenance_identity', provenance.provenance_identity,
          'source_candidate_identity', candidate.candidate_identity,
          'outbox_event_identity', outbox.event_identity
        )
        FROM public.rd_source_intake_bindings_v1 binding
        JOIN public.rd_source_intake_receipts_v1 receipt
          ON receipt.request_identity = binding.request_identity
         AND receipt.receipt_identity = binding.terminal_receipt_identity
        JOIN public.rd_owner_outbox_v1 outbox
          ON outbox.aggregate_identity = binding.request_identity
         AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
        LEFT JOIN public.rd_research_source_provenance_v1 provenance
          ON provenance.receipt_identity = receipt.receipt_identity
         AND provenance.content_digest = receipt.content_digest
        LEFT JOIN public.rd_source_candidates_v1 candidate
          ON candidate.provenance_identity = provenance.provenance_identity
        WHERE binding.request_identity = p_request_identity
          AND binding.state = 'TERMINAL'
          AND rd_owner_api.valid_source_intake_binding_contract_v1(binding.binding_json) IS TRUE
          AND binding.binding_json->>'request_identity' = binding.request_identity
          AND binding.binding_json->>'binding_identity' = binding.binding_identity
          AND binding.binding_json->>'admission' = 'ADMITTED'
          AND rd_owner_api.valid_source_intake_receipt_v1(
                receipt.receipt_json, receipt.receipt_identity, receipt.request_identity,
                binding.binding_identity, binding.invocation_identity, receipt.terminal,
                receipt.response_status, receipt.response_header_digest, receipt.content_digest,
                receipt.committed_at_epoch_ms
              ) IS TRUE
          AND (
            binding.invocation_identity IS NULL
            OR binding.invocation_identity = rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.openalex.invocation.v1', ARRAY[
                binding.request_identity, binding.binding_identity, binding.binding_commit_identity,
                binding.product_edge_started_receipt_identity,
                binding.product_edge_started_json->>'policy_decision_identity',
                binding.product_edge_started_json->>'policy_decision_digest',
                binding.product_edge_started_json#>>'{policy_time,head_digest}',
                binding.binding_json#>>'{authority,authority_class}',
                binding.binding_json#>>'{authority,environment_identity}',
                binding.binding_json#>>'{authority,provider_profile_digest}',
                COALESCE(binding.binding_json#>>'{authority,fixture_corpus_digest}', 'ABSENT')
              ]::text[])
          )
          AND receipt.receipt_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.source-intake.receipt.v1', ARRAY[
              binding.request_identity, binding.binding_identity,
              COALESCE(binding.invocation_identity,
                rd_owner_api.derive_source_intake_identity_v1(
                  'rd.source-intake.pre-invocation.v1', ARRAY[
                    binding.request_identity, binding.binding_identity,
                    binding.binding_commit_identity, binding.product_edge_started_receipt_identity
                  ]::text[])),
              receipt.terminal, COALESCE(receipt.content_digest, 'ABSENT'),
              COALESCE(receipt.response_status::text, 'ABSENT'),
              COALESCE(receipt.response_header_digest, 'ABSENT'),
              COALESCE(receipt.receipt_json->>'connected_address', 'ABSENT'),
              COALESCE(receipt.receipt_json->>'response_media_type', 'ABSENT'),
              COALESCE(receipt.receipt_json->>'response_size_bytes', 'ABSENT'),
              receipt.receipt_json->>'policy_decision_identity',
              receipt.receipt_json->>'policy_decision_digest',
              receipt.receipt_json->>'retrieval_time_evidence_identity',
              receipt.receipt_json->>'retrieval_time_evidence_digest',
              receipt.receipt_json#>>'{retrieval_time,head_digest}',
              receipt.committed_at_epoch_ms::text
            ]::text[])
          AND receipt.receipt_json->>'terminal_evidence_digest' =
            rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.terminal-evidence.v1', ARRAY[
                binding.binding_identity,
                COALESCE(binding.invocation_identity,
                  rd_owner_api.derive_source_intake_identity_v1(
                    'rd.source-intake.pre-invocation.v1', ARRAY[
                      binding.request_identity, binding.binding_identity,
                      binding.binding_commit_identity, binding.product_edge_started_receipt_identity
                    ]::text[])),
                receipt.terminal, COALESCE(receipt.response_header_digest, 'ABSENT'),
                COALESCE(receipt.content_digest, 'ABSENT'),
                receipt.receipt_json->>'policy_decision_identity',
                receipt.receipt_json->>'policy_decision_digest',
                receipt.receipt_json->>'retrieval_time_evidence_identity',
                receipt.receipt_json->>'retrieval_time_evidence_digest',
                receipt.receipt_json#>>'{retrieval_time,head_digest}'
              ]::text[])
          AND receipt.receipt_json->>'terminal_evidence_identity' =
            rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.terminal-evidence-identity.v1',
              ARRAY[receipt.receipt_json->>'terminal_evidence_digest']::text[])
          AND (SELECT pg_catalog.count(*) FROM public.rd_source_intake_receipts_v1 singleton
               WHERE singleton.request_identity = binding.request_identity) = 1
          AND (SELECT pg_catalog.count(*) FROM public.rd_owner_outbox_v1 singleton
               WHERE singleton.aggregate_identity = binding.request_identity
                 AND singleton.event_kind = 'SOURCE_INTAKE_TERMINATED_V1') = 1
          AND outbox.event_identity = rd_owner_api.derive_source_intake_identity_v1(
                'rd.owner-outbox.source-intake-terminated.v1',
                ARRAY[binding.request_identity, receipt.receipt_identity]::text[])
          AND outbox.payload_digest = rd_owner_api.derive_source_intake_identity_v1(
                'rd.owner-outbox.payload.v1', ARRAY[binding.request_identity,
                  receipt.receipt_identity, COALESCE(provenance.provenance_identity, 'ABSENT'),
                  COALESCE(candidate.candidate_identity, 'ABSENT')]::text[])
          AND outbox.payload_json = pg_catalog.jsonb_build_object(
            'event_identity', outbox.event_identity,
            'aggregate_identity', outbox.aggregate_identity,
            'event_kind', outbox.event_kind,
            'payload_digest', outbox.payload_digest
          )
          AND outbox.committed_at_epoch_ms = receipt.committed_at_epoch_ms
          AND (
            (receipt.terminal = 'RETRIEVED'
             AND receipt.content_digest IS NOT NULL
             AND provenance.provenance_identity IS NOT NULL
             AND candidate.candidate_identity IS NOT NULL
             AND provenance.provenance_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.research-source-provenance.v1', ARRAY[
                 binding.binding_json->>'normalized_doi', receipt.content_digest,
                 receipt.receipt_identity, receipt.receipt_json#>>'{retrieval_time,head_digest}',
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-interpretation.v1', ARRAY[
                     rd_owner_api.derive_source_intake_identity_v1(
                       'rd.source-intake.interpretation.v1', ARRAY[
                         binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                         (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                            FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                                 WITH ORDINALITY AS alternative(value, ordinality)),
                         binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                         binding.product_edge_started_json#>>'{interpretation,falsifier}'
                       ]::text[])
                   ]::text[]),
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                             WITH ORDINALITY AS alternative(value, ordinality)),
                     binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     binding.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[])
               ]::text[])
             AND provenance.provenance_json = pg_catalog.jsonb_build_object(
               'schema_version', 1,
               'provenance_identity', provenance.provenance_identity,
               'predecessor_provenance_identity', NULL,
               'canonical_source_identity', 'doi:' || (binding.binding_json->>'normalized_doi'),
               'canonical_source_origin', binding.binding_json->>'https_origin',
               'source_class', 'ACADEMIC_IDENTITY_AND_CITATION_GRAPH',
               'author_or_originating_system', 'OPENALEX',
               'publication_time_epoch_ms', NULL,
               'revision_identity', NULL,
               'linked_reference_identities', pg_catalog.jsonb_build_array(),
               'content_digest', receipt.content_digest,
               'raw_content_digest', receipt.content_digest,
               'connector_identity', binding.binding_json->>'connector_identity',
               'connector_version', binding.binding_json->>'connector_version',
               'acquisition_receipt_identity', receipt.receipt_identity,
               'retrieval_time', receipt.receipt_json->'retrieval_time',
               'valid_through_epoch_ms', (receipt.receipt_json#>>'{retrieval_time,valid_through_epoch_ms}')::bigint,
               'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
               'rights_policy_version', binding.binding_json->>'rights_policy_version',
               'license_basis', binding.binding_json->>'rights_basis_identity',
               'attribution_basis', 'OPENALEX_METADATA_ATTRIBUTION',
               'acquisition_scope', binding.binding_json->>'acquisition_scope',
               'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
               'retention_policy_version', binding.binding_json->>'retention_policy_version',
               'retention_scope', binding.binding_json->>'retention_scope',
               'location_rights', rd_owner_api.derive_openalex_location_rights_v1(
                 pg_catalog.convert_from((SELECT raw_value.raw_payload
                   FROM public.rd_source_raw_payloads_v1 raw_value
                   WHERE raw_value.content_digest = receipt.content_digest), 'UTF8')::jsonb,
                 binding.binding_json->>'normalized_doi'),
               'bounded_interpretation_identity', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-interpretation.v1', ARRAY[
                   rd_owner_api.derive_source_intake_identity_v1(
                     'rd.source-intake.interpretation.v1', ARRAY[
                       binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                       (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                          FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                               WITH ORDINALITY AS alternative(value, ordinality)),
                       binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                       binding.product_edge_started_json#>>'{interpretation,falsifier}'
                     ]::text[])
                 ]::text[]),
               'bounded_interpretation_digest', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-intake.interpretation.v1', ARRAY[
                   binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                   (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                      FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                           WITH ORDINALITY AS alternative(value, ordinality)),
                   binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                   binding.product_edge_started_json#>>'{interpretation,falsifier}'
                 ]::text[]),
               'interpretation', binding.product_edge_started_json->'interpretation',
               'interpretation_status', 'BOUNDED_RESEARCH_INTERPRETATION',
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             )
             AND candidate.candidate_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.source-candidate.v1', ARRAY[
                 provenance.provenance_identity,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                             WITH ORDINALITY AS alternative(value, ordinality)),
                     binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     binding.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[])
               ]::text[])
             AND candidate.candidate_json = pg_catalog.jsonb_build_object(
               'candidate_identity', candidate.candidate_identity,
               'provenance_identity', provenance.provenance_identity,
               'interpretation_digest', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-intake.interpretation.v1', ARRAY[
                   binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                   (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                      FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                           WITH ORDINALITY AS alternative(value, ordinality)),
                   binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                   binding.product_edge_started_json#>>'{interpretation,falsifier}'
                 ]::text[]),
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             ))
             AND EXISTS (
               SELECT 1 FROM public.rd_source_raw_payloads_v1 raw
               JOIN public.rd_source_raw_receipt_links_v1 raw_link
                 ON raw_link.receipt_identity = receipt.receipt_identity
                AND raw_link.terminal = 'RETRIEVED'
                AND raw_link.content_digest = raw.content_digest
               WHERE raw.content_digest = receipt.content_digest
                 AND raw.content_digest = 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex')
             )
            OR
            (receipt.terminal <> 'RETRIEVED'
             AND receipt.content_digest IS NULL
             AND provenance.provenance_identity IS NULL
             AND candidate.candidate_identity IS NULL)
          )
      $function$",
    "ALTER FUNCTION rd_owner_api.canonical_source_intake_custody_v1(text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.canonical_source_intake_custody_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.read_source_intake_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, rd_owner_api, pg_temp
      AS $function$
        SELECT rd_owner_api.canonical_source_intake_custody_v1(p_request_identity)
      $function$",
    "ALTER FUNCTION rd_owner_api.read_source_intake_v1(text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(
        p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text
      ) RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, rd_owner_api, pg_temp
      AS $function$
        WITH canonical AS (
          SELECT rd_owner_api.canonical_source_intake_custody_v1(p_request_identity) AS readback
        )
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'attempt_identity', binding.binding_identity,
          'terminal_receipt_identity', receipt.receipt_identity,
          'binding', binding.binding_json,
          'receipt', receipt.receipt_json,
          'provenance', provenance.provenance_json,
          'candidate', candidate.candidate_json,
          'transition', outbox.payload_json
        )
        FROM canonical
        JOIN public.rd_source_intake_bindings_v1 binding
          ON binding.request_identity = canonical.readback->>'request_identity'
         AND binding.binding_identity = canonical.readback->>'binding_identity'
        JOIN public.rd_source_intake_receipts_v1 receipt
          ON receipt.request_identity = binding.request_identity
         AND receipt.receipt_identity = canonical.readback#>>'{receipt,receipt_identity}'
        JOIN public.rd_source_raw_receipt_links_v1 raw_link
          ON raw_link.receipt_identity = receipt.receipt_identity
         AND raw_link.terminal = 'RETRIEVED'
         AND raw_link.content_digest = canonical.readback->>'content_digest'
        JOIN public.rd_source_raw_payloads_v1 raw
          ON raw.content_digest = raw_link.content_digest
        JOIN public.rd_research_source_provenance_v1 provenance
          ON provenance.receipt_identity = receipt.receipt_identity
         AND provenance.content_digest = raw.content_digest
         AND provenance.provenance_identity = canonical.readback->>'provenance_identity'
        JOIN public.rd_source_candidates_v1 candidate
          ON candidate.provenance_identity = provenance.provenance_identity
         AND candidate.candidate_identity = canonical.readback->>'source_candidate_identity'
        JOIN public.rd_owner_outbox_v1 outbox
          ON outbox.aggregate_identity = binding.request_identity
         AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
         AND outbox.event_identity = canonical.readback->>'outbox_event_identity'
        WHERE canonical.readback->>'terminal' = 'RETRIEVED'
          AND binding.request_identity = p_request_identity
          AND binding.binding_identity = p_attempt_identity
          AND receipt.receipt_identity = p_terminal_receipt_identity
          AND raw.content_digest = 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex')
      $function$",
    "ALTER FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(
        p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, rd_owner_api, pg_temp
      AS $function$
      DECLARE locked_count bigint; sealed jsonb;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT pg_catalog.count(*) INTO locked_count FROM (
          SELECT 1
          FROM public.rd_source_intake_bindings_v1 binding
          JOIN public.rd_source_intake_receipts_v1 receipt
            ON receipt.request_identity = binding.request_identity
           AND receipt.receipt_identity = binding.terminal_receipt_identity
          JOIN public.rd_source_raw_receipt_links_v1 raw_link
            ON raw_link.receipt_identity = receipt.receipt_identity
           AND raw_link.terminal = 'RETRIEVED'
           AND raw_link.content_digest = receipt.content_digest
          JOIN public.rd_source_raw_payloads_v1 raw
            ON raw.content_digest = raw_link.content_digest
          JOIN public.rd_research_source_provenance_v1 provenance
            ON provenance.receipt_identity = receipt.receipt_identity
           AND provenance.content_digest = raw.content_digest
          JOIN public.rd_source_candidates_v1 candidate
            ON candidate.provenance_identity = provenance.provenance_identity
          JOIN public.rd_owner_outbox_v1 outbox
            ON outbox.aggregate_identity = binding.request_identity
           AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          WHERE binding.request_identity = p_request_identity
            AND binding.binding_identity = p_attempt_identity
            AND receipt.receipt_identity = p_terminal_receipt_identity
          FOR SHARE OF binding, receipt, raw_link, raw, provenance, candidate, outbox
        ) locked;
        IF locked_count <> 1 THEN RETURN NULL; END IF;
        SELECT rd_owner_api.peek_source_intake_research_handoff_v1(
          p_request_identity, p_attempt_identity, p_terminal_receipt_identity
        ) INTO sealed;
        RETURN sealed;
      END
      $function$",
    "ALTER FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) OWNER TO rd_owner",
    "REVOKE ALL ON FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer",
    "REVOKE ALL ON public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1 FROM product_edge_owner",
];

/// This parameterized statement is executed only inside an R&D-owner transaction
/// after the exact request row has been locked and revalidated.  The negative
/// terminal path has a separate receipt-plus-outbox transaction and no positive
/// Source Intake records.
/// The `RETRIEVED` path supplies every positive row and the existing owner outbox
/// together, so partial provenance is not representable.
pub(super) const TERMINAL_SUCCESS_TRANSACTION_SQL_V1: &str = "
WITH decoded AS (
  SELECT pg_catalog.convert_from($7, 'UTF8') AS value
), body AS (
  SELECT decoded.value::json AS raw_value, decoded.value::jsonb AS value
  FROM decoded
), locked AS (
  SELECT request_identity, binding_identity, invocation_identity, binding_json,
         product_edge_started_json
  FROM public.rd_source_intake_bindings_v1, body
  WHERE request_identity = $1
    AND state = 'INVOCATION_RESERVED'
    AND invocation_identity = $2
    AND pg_catalog.jsonb_typeof($4) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($4) AS keys(key)) = ARRAY[
      'attempt_identity','binding_identity','committed_at_epoch_ms','connected_address',
      'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
      'policy_decision_time','receipt_identity','request_identity',
      'response_header_digest','response_media_type','response_size_bytes','response_status',
      'retrieval_time','retrieval_time_evidence_digest','retrieval_time_evidence_identity',
      'schema_version','terminal','terminal_evidence_digest',
      'terminal_evidence_identity'
    ]::text[]
    AND pg_catalog.jsonb_typeof($4->'receipt_identity') = 'string'
    AND pg_catalog.jsonb_typeof($4->'request_identity') = 'string'
    AND pg_catalog.jsonb_typeof($4->'binding_identity') = 'string'
    AND pg_catalog.jsonb_typeof($4->'invocation_identity') = 'string'
    AND pg_catalog.jsonb_typeof($4->'terminal') = 'string'
    AND pg_catalog.jsonb_typeof($4->'response_status') = 'number'
    AND pg_catalog.jsonb_typeof($4->'response_header_digest') = 'string'
    AND pg_catalog.jsonb_typeof($4->'content_digest') = 'string'
    AND pg_catalog.jsonb_typeof($4->'committed_at_epoch_ms') = 'number'
    AND $4->>'receipt_identity' = $3
    AND $4->>'request_identity' = $1
    AND $4->>'binding_identity' = binding_identity
    AND $4->>'attempt_identity' = binding_identity
    AND $4->>'invocation_identity' = $2
    AND $4->>'schema_version' = '1'
    AND $4->>'terminal' = 'RETRIEVED'
    AND $4->>'response_status' = '200'
    AND $4->>'response_header_digest' IS NOT NULL
    AND $4->>'content_digest' = $6
    AND $4->>'connected_address' = ANY(
      SELECT pg_catalog.jsonb_array_elements_text(binding_json->'resolved_addresses')
    )
    AND $4->>'response_media_type' = binding_json->>'media_type'
    AND ($4->>'response_size_bytes')::bigint = pg_catalog.octet_length($7)
    AND $4->>'policy_decision_identity' = product_edge_started_json->>'policy_decision_identity'
    AND $4->>'policy_decision_digest' = product_edge_started_json->>'policy_decision_digest'
    AND $4->'policy_decision_time' = product_edge_started_json->'policy_time'
    AND ($4#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
          >= ($4#>>'{policy_decision_time,decision_cut_epoch_ms}')::bigint
    AND $4->>'committed_at_epoch_ms' = $5::text
    AND pg_catalog.octet_length($7) BETWEEN 1 AND (binding_json->>'byte_limit')::integer
    AND pg_catalog.jsonb_typeof(body.value) = 'object'
    AND (SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT key)
         FROM pg_catalog.json_object_keys(body.raw_value) AS top_level(key))
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.json_array_elements(COALESCE(body.raw_value->'locations', '[]'::json)) AS locations(location)
      WHERE (SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT key)
             FROM pg_catalog.json_object_keys(location) AS location_keys(key))
    )
    AND body.value->>'doi' = ('https://doi.org/' || (binding_json->>'normalized_doi'))
    AND COALESCE(pg_catalog.jsonb_typeof(body.value->'locations'), 'array') = 'array'
    AND pg_catalog.jsonb_array_length(COALESCE(body.value->'locations', '[]'::jsonb)) <= 128
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(COALESCE(body.value->'locations', '[]'::jsonb)) AS locations(location)
      WHERE pg_catalog.jsonb_typeof(location) <> 'object'
         OR (location ? 'is_oa' AND pg_catalog.jsonb_typeof(location->'is_oa') NOT IN ('boolean','null'))
         OR (location ? 'license' AND pg_catalog.jsonb_typeof(location->'license') NOT IN ('string','null'))
         OR (location ? 'landing_page_url' AND pg_catalog.jsonb_typeof(location->'landing_page_url') NOT IN ('string','null'))
         OR (location ? 'pdf_url' AND pg_catalog.jsonb_typeof(location->'pdf_url') NOT IN ('string','null'))
         OR pg_catalog.octet_length(location->>'license') > 128
         OR pg_catalog.octet_length(location->>'landing_page_url') > 2048
         OR pg_catalog.octet_length(location->>'pdf_url') > 2048
    )
    AND $6 = 'sha256:' || pg_catalog.encode(pg_catalog.sha256($7), 'hex')
    AND $3 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.receipt.v1', ARRAY[
        $1, binding_identity, $2, 'RETRIEVED', $6, '200',
        $4->>'response_header_digest', $4->>'connected_address',
        $4->>'response_media_type', $4->>'response_size_bytes',
        $4->>'policy_decision_identity', $4->>'policy_decision_digest',
        $4->>'retrieval_time_evidence_identity', $4->>'retrieval_time_evidence_digest',
        $4#>>'{retrieval_time,head_digest}', $5::text
      ]::text[]
    )
    AND $4->>'terminal_evidence_digest' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence.v1', ARRAY[
        binding_identity, $2, 'RETRIEVED', $4->>'response_header_digest', $6,
        $4->>'policy_decision_identity', $4->>'policy_decision_digest',
        $4->>'retrieval_time_evidence_identity', $4->>'retrieval_time_evidence_digest',
        $4#>>'{retrieval_time,head_digest}'
      ]::text[]
    )
    AND $4->>'terminal_evidence_identity' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence-identity.v1',
      ARRAY[$4->>'terminal_evidence_digest']::text[]
    )
    AND pg_catalog.jsonb_typeof($9) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($9) AS keys(key)) = ARRAY[
      'acquisition_receipt_identity','acquisition_scope','attribution_basis',
      'author_or_originating_system','bounded_interpretation_digest',
      'bounded_interpretation_identity','canonical_source_identity','canonical_source_origin',
      'connector_identity','connector_version','content_digest','interpretation',
      'interpretation_status','license_basis','linked_reference_identities','location_rights',
      'predecessor_provenance_identity','provenance_identity','publication_time_epoch_ms',
      'raw_content_digest','retention_policy_identity','retention_policy_version',
      'retention_scope','retrieval_time','revision_identity','rights_basis_identity',
      'rights_policy_version','schema_version','source_class','trust_class',
      'valid_through_epoch_ms'
    ]::text[]
    AND pg_catalog.jsonb_typeof($9->'provenance_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'canonical_source_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'content_digest') = 'string'
    AND pg_catalog.jsonb_typeof($9->'connector_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'connector_version') = 'string'
    AND pg_catalog.jsonb_typeof($9->'acquisition_receipt_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'retrieval_time') = 'object'
    AND pg_catalog.jsonb_typeof($9->'rights_basis_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'retention_policy_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'bounded_interpretation_identity') = 'string'
    AND pg_catalog.jsonb_typeof($9->'bounded_interpretation_digest') = 'string'
    AND pg_catalog.jsonb_typeof($9->'interpretation') = 'object'
    AND pg_catalog.jsonb_typeof($9->'trust_class') = 'string'
    AND $9->>'provenance_identity' = $8
    AND $9->>'acquisition_receipt_identity' = $3
    AND $9->>'content_digest' = $6
    AND $9->>'canonical_source_identity' = ('doi:' || (binding_json->>'normalized_doi'))
    AND $9->>'connector_identity' = binding_json->>'connector_identity'
    AND $9->>'connector_version' = binding_json->>'connector_version'
    AND $9->'retrieval_time' = $4->'retrieval_time'
    AND $9->>'valid_through_epoch_ms' = $4#>>'{retrieval_time,valid_through_epoch_ms}'
    AND $9->>'rights_basis_identity' = binding_json->>'rights_basis_identity'
    AND $9->>'rights_policy_version' = binding_json->>'rights_policy_version'
    AND $9->>'acquisition_scope' = binding_json->>'acquisition_scope'
    AND $9->>'retention_policy_identity' = binding_json->>'retention_policy_identity'
    AND $9->>'retention_policy_version' = binding_json->>'retention_policy_version'
    AND $9->>'retention_scope' = binding_json->>'retention_scope'
    AND $9->>'raw_content_digest' = $6
    AND $9->>'canonical_source_origin' = binding_json->>'https_origin'
    AND $9->>'source_class' = 'ACADEMIC_IDENTITY_AND_CITATION_GRAPH'
    AND $9->>'interpretation_status' = 'BOUNDED_RESEARCH_INTERPRETATION'
    AND $9->>'trust_class' = 'UNTRUSTED_EXTERNAL_DATA'
    AND pg_catalog.jsonb_typeof($9->'location_rights') = 'array'
    AND $9->'location_rights' = rd_owner_api.derive_openalex_location_rights_v1(
      body.value, binding_json->>'normalized_doi'
    )
    AND pg_catalog.jsonb_typeof($11) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($11) AS keys(key)) = ARRAY[
      'candidate_identity','interpretation_digest','provenance_identity','trust_class'
    ]::text[]
    AND pg_catalog.jsonb_typeof($11->'candidate_identity') = 'string'
    AND pg_catalog.jsonb_typeof($11->'provenance_identity') = 'string'
    AND pg_catalog.jsonb_typeof($11->'interpretation_digest') = 'string'
    AND pg_catalog.jsonb_typeof($11->'trust_class') = 'string'
    AND $11->>'candidate_identity' = $10
    AND $11->>'provenance_identity' = $8
    AND $11->>'interpretation_digest' IS NOT NULL
    AND $11->>'trust_class' = 'UNTRUSTED_EXTERNAL_DATA'
    AND $11->>'interpretation_digest' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.interpretation.v1', ARRAY[
        product_edge_started_json#>>'{interpretation,bounded_explanation}',
        (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
           FROM pg_catalog.jsonb_array_elements_text(product_edge_started_json#>'{interpretation,plausible_alternatives}')
                WITH ORDINALITY AS alternative(value, ordinality)),
        product_edge_started_json#>>'{interpretation,differentiating_prediction}',
        product_edge_started_json#>>'{interpretation,falsifier}'
      ]::text[]
    )
    AND $9->'interpretation' = product_edge_started_json->'interpretation'
    AND $9->>'bounded_interpretation_digest' = $11->>'interpretation_digest'
    AND $9->>'bounded_interpretation_identity' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-interpretation.v1', ARRAY[$11->>'interpretation_digest']::text[]
    )
    AND $8 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.research-source-provenance.v1', ARRAY[
        binding_json->>'normalized_doi', $6, $3, $4#>>'{retrieval_time,head_digest}',
        $9->>'bounded_interpretation_identity', $9->>'bounded_interpretation_digest'
      ]::text[]
    )
    AND $10 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-candidate.v1', ARRAY[$8, $11->>'interpretation_digest']::text[]
    )
    AND pg_catalog.jsonb_typeof($14) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($14) AS keys(key)) = ARRAY[
      'aggregate_identity','event_identity','event_kind','payload_digest'
    ]::text[]
    AND pg_catalog.jsonb_typeof($14->'event_identity') = 'string'
    AND pg_catalog.jsonb_typeof($14->'aggregate_identity') = 'string'
    AND pg_catalog.jsonb_typeof($14->'event_kind') = 'string'
    AND pg_catalog.jsonb_typeof($14->'payload_digest') = 'string'
    AND $14->>'event_identity' = $12
    AND $14->>'aggregate_identity' = $1
    AND $14->>'event_kind' = 'SOURCE_INTAKE_TERMINATED_V1'
    AND $14->>'payload_digest' = $13
    AND $12 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.source-intake-terminated.v1', ARRAY[$1, $3]::text[]
    )
    AND $13 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.payload.v1', ARRAY[$1, $3, $8, $10]::text[]
    )
  FOR UPDATE
), receipt AS (
  INSERT INTO public.rd_source_intake_receipts_v1
    (receipt_identity, request_identity, terminal, response_status, response_header_digest,
     content_digest, receipt_json, committed_at_epoch_ms)
  SELECT $3, request_identity, 'RETRIEVED', ($4->>'response_status')::smallint,
         $4->>'response_header_digest', $6, $4, $5 FROM locked
  RETURNING receipt_identity, request_identity
), raw_insert AS (
  INSERT INTO public.rd_source_raw_payloads_v1 (content_digest, raw_payload)
  SELECT $6, $7 FROM receipt
  ON CONFLICT (content_digest) DO NOTHING
  RETURNING content_digest
), raw AS (
  SELECT content_digest FROM raw_insert
  UNION ALL
  SELECT CASE WHEN stored.raw_payload = $7 THEN stored.content_digest ELSE NULL END
  FROM public.rd_source_raw_payloads_v1 stored, receipt
  WHERE stored.content_digest = $6
    AND NOT EXISTS (SELECT 1 FROM raw_insert)
), raw_link AS (
  INSERT INTO public.rd_source_raw_receipt_links_v1 (receipt_identity, content_digest)
  SELECT receipt.receipt_identity, raw.content_digest FROM receipt, raw
  RETURNING receipt_identity, content_digest
), provenance AS (
  INSERT INTO public.rd_research_source_provenance_v1
    (provenance_identity, receipt_identity, content_digest, provenance_json)
  SELECT $8, raw_link.receipt_identity, raw_link.content_digest, $9 FROM raw_link
  RETURNING provenance_identity, receipt_identity
), candidate AS (
  INSERT INTO public.rd_source_candidates_v1
    (candidate_identity, provenance_identity, candidate_json)
  SELECT $10, provenance_identity, $11 FROM provenance
  RETURNING candidate_identity, provenance_identity
), outbox AS (
  INSERT INTO public.rd_owner_outbox_v1
    (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms)
  SELECT $12, receipt.request_identity, 'SOURCE_INTAKE_TERMINATED_V1', $13, $14, $5
  FROM receipt
  RETURNING event_identity
)
UPDATE public.rd_source_intake_bindings_v1 binding
SET state = 'TERMINAL', terminal_receipt_identity = receipt.receipt_identity
FROM receipt, provenance, candidate, outbox
WHERE binding.request_identity = receipt.request_identity
RETURNING binding.request_identity, binding.binding_identity, receipt.receipt_identity,
          provenance.provenance_identity, candidate.candidate_identity, outbox.event_identity
";

/// Every non-`RETRIEVED` terminal atomically commits only its receipt, the
/// lifecycle transition, and the bounded terminal outbox event.  It has no raw,
/// provenance, or Source Candidate inputs or write path.
pub(super) const TERMINAL_FAILURE_TRANSACTION_SQL_V1: &str = "
WITH locked AS (
  SELECT request_identity, binding_identity, binding_commit_identity,
         product_edge_started_receipt_identity, invocation_identity, state, binding_json
  FROM public.rd_source_intake_bindings_v1
  WHERE request_identity = $1
    AND state = 'INVOCATION_RESERVED'
    AND rd_owner_api.valid_source_intake_started_custody_v1(
      request_identity, binding_json#>>'{product_edge_admission,admission_identity}',
      product_edge_started_receipt_identity, product_edge_started_json
    )
    AND invocation_identity = rd_owner_api.derive_source_intake_identity_v1(
        'rd.source-intake.openalex.invocation.v1', ARRAY[
          request_identity, binding_identity, binding_commit_identity,
          product_edge_started_receipt_identity,
          product_edge_started_json->>'policy_decision_identity',
          product_edge_started_json->>'policy_decision_digest',
          product_edge_started_json#>>'{policy_time,head_digest}',
          binding_json#>>'{authority,authority_class}',
          binding_json#>>'{authority,environment_identity}',
          binding_json#>>'{authority,provider_profile_digest}',
          COALESCE(binding_json#>>'{authority,fixture_corpus_digest}', 'ABSENT')
        ]::text[]
      )
    AND pg_catalog.jsonb_typeof($3) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($3) AS keys(key)) = ARRAY[
      'attempt_identity','binding_identity','committed_at_epoch_ms','connected_address',
      'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
      'policy_decision_time','receipt_identity','request_identity',
      'response_header_digest','response_media_type','response_size_bytes','response_status',
      'retrieval_time','retrieval_time_evidence_digest','retrieval_time_evidence_identity',
      'schema_version','terminal','terminal_evidence_digest',
      'terminal_evidence_identity'
    ]::text[]
    AND pg_catalog.jsonb_typeof($3->'receipt_identity') = 'string'
    AND pg_catalog.jsonb_typeof($3->'request_identity') = 'string'
    AND pg_catalog.jsonb_typeof($3->'binding_identity') = 'string'
    AND pg_catalog.jsonb_typeof($3->'invocation_identity') IN ('string','null')
    AND pg_catalog.jsonb_typeof($3->'terminal') = 'string'
    AND pg_catalog.jsonb_typeof($3->'response_status') IN ('number','null')
    AND pg_catalog.jsonb_typeof($3->'response_header_digest') IN ('string','null')
    AND pg_catalog.jsonb_typeof($3->'content_digest') = 'null'
    AND pg_catalog.jsonb_typeof($3->'committed_at_epoch_ms') = 'number'
    AND ($3->'response_status' = 'null'::jsonb
         OR $3->>'response_status' ~ '^(0|[1-9][0-9]{0,2})$')
    AND $3->>'receipt_identity' = $2
    AND $3->>'request_identity' = request_identity
    AND $3->>'binding_identity' = binding_identity
    AND $3->>'attempt_identity' = binding_identity
    AND $3->>'schema_version' = '1'
    AND COALESCE($3->>'invocation_identity', 'NO_INVOCATION') = COALESCE(invocation_identity, 'NO_INVOCATION')
    AND $3->'content_digest' = 'null'::jsonb
    AND $3->>'policy_decision_identity' = product_edge_started_json->>'policy_decision_identity'
    AND $3->>'policy_decision_digest' = product_edge_started_json->>'policy_decision_digest'
    AND $3->'policy_decision_time' = product_edge_started_json->'policy_time'
    AND ($3#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
          >= ($3#>>'{policy_decision_time,decision_cut_epoch_ms}')::bigint
    AND $3->>'committed_at_epoch_ms' = $4::text
    AND $3->>'terminal' IN (
      'NOT_FOUND','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED',
      'TERMS_OR_LICENSE_BLOCKED','MALFORMED','UNAVAILABLE'
    )
    AND invocation_identity IS NOT NULL
    AND (
        ($3->>'terminal' = 'NOT_FOUND' AND ($3->>'response_status')::smallint = 404
         AND $3->>'response_header_digest' IS NOT NULL)
        OR ($3->>'terminal' = 'AUTH_REQUIRED' AND ($3->>'response_status')::smallint = 401
            AND $3->>'response_header_digest' IS NOT NULL)
        OR ($3->>'terminal' = 'ACCESS_DENIED' AND ($3->>'response_status')::smallint = 403
            AND $3->>'response_header_digest' IS NOT NULL)
        OR ($3->>'terminal' = 'RATE_LIMITED' AND ($3->>'response_status')::smallint = 429
            AND $3->>'response_header_digest' IS NOT NULL)
        OR ($3->>'terminal' = 'MALFORMED'
            AND ($3->>'response_status')::smallint BETWEEN 100 AND 999
            AND (
              ($3->>'response_status')::smallint = 200
              OR (($3->>'response_status')::smallint NOT IN (401, 403, 404, 429)
                  AND ($3->>'response_status')::smallint NOT BETWEEN 500 AND 599)
              OR $3->'response_header_digest' = 'null'::jsonb
            ))
        OR ($3->>'terminal' = 'UNAVAILABLE'
            AND (($3->'response_status' = 'null'::jsonb
                  AND $3->'response_header_digest' = 'null'::jsonb)
                 OR (($3->>'response_status')::smallint BETWEEN 500 AND 599
                     AND $3->>'response_header_digest' IS NOT NULL)))
    )
    AND $2 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.receipt.v1', ARRAY[
        request_identity, binding_identity, COALESCE(invocation_identity,
          rd_owner_api.derive_source_intake_identity_v1(
            'rd.source-intake.pre-invocation.v1', ARRAY[
              request_identity, binding_identity, binding_commit_identity,
              product_edge_started_receipt_identity
            ]::text[]
          )
        ),
        $3->>'terminal', 'ABSENT', COALESCE($3->>'response_status', 'ABSENT'),
        COALESCE($3->>'response_header_digest', 'ABSENT'),
        COALESCE($3->>'connected_address', 'ABSENT'),
        COALESCE($3->>'response_media_type', 'ABSENT'),
        COALESCE($3->>'response_size_bytes', 'ABSENT'),
        $3->>'policy_decision_identity', $3->>'policy_decision_digest',
        $3->>'retrieval_time_evidence_identity', $3->>'retrieval_time_evidence_digest',
        $3#>>'{retrieval_time,head_digest}', $4::text
      ]::text[]
    )
    AND $3->>'terminal_evidence_digest' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence.v1', ARRAY[
        binding_identity, invocation_identity, $3->>'terminal',
        COALESCE($3->>'response_header_digest', 'ABSENT'), 'ABSENT',
        $3->>'policy_decision_identity', $3->>'policy_decision_digest',
        $3->>'retrieval_time_evidence_identity', $3->>'retrieval_time_evidence_digest',
        $3#>>'{retrieval_time,head_digest}'
      ]::text[]
    )
    AND $3->>'terminal_evidence_identity' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence-identity.v1',
      ARRAY[$3->>'terminal_evidence_digest']::text[]
    )
    AND pg_catalog.jsonb_typeof($7) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($7) AS keys(key)) = ARRAY[
      'aggregate_identity','event_identity','event_kind','payload_digest'
    ]::text[]
    AND pg_catalog.jsonb_typeof($7->'event_identity') = 'string'
    AND pg_catalog.jsonb_typeof($7->'aggregate_identity') = 'string'
    AND pg_catalog.jsonb_typeof($7->'event_kind') = 'string'
    AND pg_catalog.jsonb_typeof($7->'payload_digest') = 'string'
    AND $7->>'event_identity' = $5
    AND $7->>'aggregate_identity' = request_identity
    AND $7->>'event_kind' = 'SOURCE_INTAKE_TERMINATED_V1'
    AND $7->>'payload_digest' = $6
    AND $5 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.source-intake-terminated.v1', ARRAY[request_identity, $2]::text[]
    )
    AND $6 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.payload.v1', ARRAY[request_identity, $2, 'ABSENT', 'ABSENT']::text[]
    )
  FOR UPDATE
), receipt AS (
  INSERT INTO public.rd_source_intake_receipts_v1
    (receipt_identity, request_identity, terminal, response_status, response_header_digest,
     content_digest, receipt_json, committed_at_epoch_ms)
  SELECT $2, request_identity, $3->>'terminal', ($3->>'response_status')::smallint,
         $3->>'response_header_digest', NULL, $3, $4 FROM locked
  RETURNING receipt_identity, request_identity
), outbox AS (
  INSERT INTO public.rd_owner_outbox_v1
    (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms)
  SELECT $5, receipt.request_identity, 'SOURCE_INTAKE_TERMINATED_V1', $6, $7, $4
  FROM receipt
  RETURNING event_identity
)
UPDATE public.rd_source_intake_bindings_v1 binding
SET state = 'TERMINAL', terminal_receipt_identity = receipt.receipt_identity
FROM receipt, outbox
WHERE binding.request_identity = receipt.request_identity
RETURNING binding.request_identity, binding.binding_identity, receipt.receipt_identity,
          outbox.event_identity
";

/// A rights decision can close the already-canonical R&D reservation before
/// Product Edge starts the provider invocation. The reservation identity and
/// digest are explicit inputs, and the only admitted terminal has no provider
/// invocation, response evidence, raw payload, provenance, or candidate.
const PRE_INVOCATION_TERMS_BLOCKED_TRANSACTION_SQL_V1: &str = "
WITH locked AS (
  SELECT request_identity, binding_identity, binding_commit_identity,
         product_edge_started_receipt_identity, product_edge_started_json, binding_json
  FROM public.rd_source_intake_bindings_v1
  WHERE request_identity = $1
    AND state = 'PREPARED'
    AND invocation_identity IS NULL
    AND terminal_receipt_identity IS NULL
    AND product_edge_started_receipt_identity = $2
    AND product_edge_started_json->>'reservation_identity' = $2
    AND product_edge_started_json->>'reservation_digest' = $3
    AND product_edge_started_json->>'started_state_digest' IS NULL
    AND rd_owner_api.valid_source_intake_started_custody_v1(
      request_identity, binding_json#>>'{product_edge_admission,admission_identity}',
      product_edge_started_receipt_identity, product_edge_started_json
    )
    AND pg_catalog.jsonb_typeof($5) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($5) AS keys(key)) = ARRAY[
      'attempt_identity','binding_identity','committed_at_epoch_ms','connected_address',
      'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
      'policy_decision_time','receipt_identity','request_identity',
      'response_header_digest','response_media_type','response_size_bytes','response_status',
      'retrieval_time','retrieval_time_evidence_digest','retrieval_time_evidence_identity',
      'schema_version','terminal','terminal_evidence_digest',
      'terminal_evidence_identity'
    ]::text[]
    AND $5->>'receipt_identity' = $4
    AND $5->>'request_identity' = request_identity
    AND $5->>'binding_identity' = binding_identity
    AND $5->>'attempt_identity' = binding_identity
    AND $5->>'schema_version' = '1'
    AND $5->'invocation_identity' = 'null'::jsonb
    AND $5->>'terminal' = 'TERMS_OR_LICENSE_BLOCKED'
    AND $5->>'policy_decision_identity' = $10
    AND $5->>'policy_decision_digest' = $11
    AND $5->'policy_decision_time' = $12
    AND $5->'response_status' = 'null'::jsonb
    AND $5->'response_header_digest' = 'null'::jsonb
    AND $5->'content_digest' = 'null'::jsonb
    AND ($5#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
          >= ($12->>'decision_cut_epoch_ms')::bigint
    AND $5->>'committed_at_epoch_ms' = $6::text
    AND $4 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.receipt.v1', ARRAY[
        request_identity, binding_identity,
        rd_owner_api.derive_source_intake_identity_v1(
          'rd.source-intake.pre-invocation.v1', ARRAY[
            request_identity, binding_identity, binding_commit_identity,
            product_edge_started_receipt_identity
          ]::text[]
        ),
        'TERMS_OR_LICENSE_BLOCKED', 'ABSENT', 'ABSENT', 'ABSENT',
        'ABSENT', 'ABSENT', 'ABSENT', $10, $11,
        $5->>'retrieval_time_evidence_identity', $5->>'retrieval_time_evidence_digest',
        $5#>>'{retrieval_time,head_digest}', $6::text
      ]::text[]
    )
    AND $5->>'terminal_evidence_digest' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence.v1', ARRAY[
        binding_identity,
        rd_owner_api.derive_source_intake_identity_v1(
          'rd.source-intake.pre-invocation.v1', ARRAY[
            request_identity, binding_identity, binding_commit_identity,
            product_edge_started_receipt_identity
          ]::text[]
        ),
        'TERMS_OR_LICENSE_BLOCKED', 'ABSENT', 'ABSENT', $10, $11,
        $5->>'retrieval_time_evidence_identity', $5->>'retrieval_time_evidence_digest',
        $5#>>'{retrieval_time,head_digest}'
      ]::text[]
    )
    AND $5->>'terminal_evidence_identity' = rd_owner_api.derive_source_intake_identity_v1(
      'rd.source-intake.terminal-evidence-identity.v1',
      ARRAY[$5->>'terminal_evidence_digest']::text[]
    )
    AND pg_catalog.jsonb_typeof($9) = 'object'
    AND (SELECT pg_catalog.array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys($9) AS keys(key)) = ARRAY[
      'aggregate_identity','event_identity','event_kind','payload_digest'
    ]::text[]
    AND $9->>'event_identity' = $7
    AND $9->>'aggregate_identity' = request_identity
    AND $9->>'event_kind' = 'SOURCE_INTAKE_TERMINATED_V1'
    AND $9->>'payload_digest' = $8
    AND $7 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.source-intake-terminated.v1', ARRAY[request_identity, $4]::text[]
    )
    AND $8 = rd_owner_api.derive_source_intake_identity_v1(
      'rd.owner-outbox.payload.v1', ARRAY[request_identity, $4, 'ABSENT', 'ABSENT']::text[]
    )
  FOR UPDATE
), receipt AS (
  INSERT INTO public.rd_source_intake_receipts_v1
    (receipt_identity, request_identity, terminal, response_status, response_header_digest,
     content_digest, receipt_json, committed_at_epoch_ms)
  SELECT $4, request_identity, 'TERMS_OR_LICENSE_BLOCKED', NULL, NULL, NULL, $5, $6
  FROM locked
  RETURNING receipt_identity, request_identity
), outbox AS (
  INSERT INTO public.rd_owner_outbox_v1
    (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms)
  SELECT $7, receipt.request_identity, 'SOURCE_INTAKE_TERMINATED_V1', $8, $9, $6
  FROM receipt
  RETURNING event_identity
)
UPDATE public.rd_source_intake_bindings_v1 binding
SET state = 'TERMINAL', terminal_receipt_identity = receipt.receipt_identity
FROM receipt, outbox
WHERE binding.request_identity = receipt.request_identity
RETURNING binding.request_identity, binding.binding_identity, receipt.receipt_identity,
          outbox.event_identity
";

#[cfg(test)]
mod terminal_wrapper_tests {
    use rstest::rstest;
    use sqlx::postgres::PgPoolOptions;

    use super::*;

    #[rstest]
    fn terminal_wrappers_share_one_pe_first_custody_gate() {
        let _ = commit_source_intake_success_terminal_in_transaction;
        let _ = commit_source_intake_failure_terminal_in_transaction;
        let _ = read_source_intake_terminal_in_transaction;
        let source = include_str!("postgres.rs");
        let gate = source
            .split("async fn lock_and_verify_terminal_source_custody")
            .nth(1)
            .unwrap();
        assert!(
            gate.find("resolve_source_invocation_started_for_downstream_in_transaction")
                < gate.find("FOR UPDATE")
        );
        assert!(source.contains("REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner"));
    }

    #[rstest]
    #[tokio::test]
    #[ignore = "requires an injected non-owner Source Intake column ACL"]
    async fn existing_topology_rejects_nonowner_column_acl() {
        let database_url = std::env::var("RD_SOURCE_INTAKE_COLUMN_ACL_TEST_DATABASE_URL")
            .expect("Source Intake column ACL test URL");
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("Source Intake runtime connection");
        assert!(
            validate_existing_source_intake_topology(&pool)
                .await
                .is_err()
        );
    }

    #[rstest]
    fn authority_class_is_bound_through_persistence_and_public_readback() {
        let source = include_str!("postgres.rs");
        assert!(source.contains("'authority', binding.binding_json->'authority'"));
        assert!(source.contains("\"authority\": binding.authority"));
        assert!(source.contains("binding_json#>>'{authority,authority_class}'"));
        assert!(source.contains("binding_json#>>'{authority,provider_profile_digest}'"));
        assert!(source.contains("binding_json#>>'{authority,fixture_corpus_digest}'"));
        assert!(source.contains("'LIVE_EXTERNAL','SEALED_ACCEPTANCE'"));
    }
}
