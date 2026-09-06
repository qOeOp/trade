//! PostgreSQL custody for the durable Composer V2 positive terminal.
//!
//! Every authoritative value is private BYTEA. No JSON column participates in readback or hashing.

use std::{
    collections::BTreeSet,
    fmt::Display,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_data::owner::replay_market_facts_v2::AuthenticatedComposerNativeJoinV1;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_data::owner::strategy_design_role_set::{
    StrategyDesignNativeJoinReceiptV1, StrategyDesignRoleSetErrorV1,
    StrategyDesignRoleSetLocatorV1, StrategyDesignRoleSetReceiptV1,
};
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::strategy_design_role_set::{
    StrategyDesignRoleSetReadbackV1, StrategyDesignRoleSetResolverV1,
};

use crate::develop_composer_operation_v2::{
    DevelopComposerA0BuildPortV2, DevelopComposerDurableEvidenceLocatorV2,
    DevelopComposerFinalEvidencePortV2, DevelopComposerLockedEvidenceV2,
    DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
    DevelopComposerPreflightV2, DevelopComposerRunRequestV2, StoredDevelopComposerPositiveV2,
    build_positive_record_from_preflight_v2, conflict_response, preflight_develop_composer_v2,
    request_digest, resolve_positive_record_v2,
};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::develop_composer_operation_v2::{
    PreparedDevelopComposerA0V2, finish_positive_record_from_prepared_a0_v2,
    prepare_develop_composer_a0_v2,
};
use crate::strategy_plan_v2::project_strategy_design_role_set_v1;

const SEALED_READ_SCHEMA_V2: u16 = 2;
const SEALED_READ_FUNCTION_V2: &str = "composer_owner_api.lock_accepted_develop_composer_v2(text)";
const SEALED_READ_UNAVAILABLE_PROTOCOL_V2: &str = "Composer sealed readback is unavailable";
const COMMIT_FUNCTION_V2: &str = "composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)";
const COMMIT_QUERY_V2: &str = "SELECT composer_owner_api.commit_develop_composer_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const ACCEPTANCE_COMMIT_FUNCTION_V2: &str = "composer_owner_api.commit_develop_composer_acceptance_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const ACCEPTANCE_COMMIT_QUERY_V2: &str = "SELECT composer_owner_api.commit_develop_composer_acceptance_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const COMPOSER_OWNER_API_FUNCTION_COUNT_V2: i64 = 7;
#[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
const COMPOSER_OWNER_API_FUNCTION_COUNT_V2: i64 = 6;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const COMMIT_CUT_FUNCTION_V2: &str = "composer_owner_api.lock_develop_composer_commit_cut_v2(text)";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub const SEALED_COMPOSER_FAIL_AFTER_GUC_V2: &str = "vibe.sealed_acceptance.composer_fail_after";

/// Closed acceptance-only names for the ordered A1 persistence boundaries.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DevelopComposerAcceptanceWriteBoundaryV2 {
    AfterDesign,
    AfterPlan,
    AfterArtifact,
    AfterEachModule,
    AfterEachNewIntrinsicBuildReceipt,
    AfterEachBuildUse,
    AfterComposerReceipt,
    AfterHostReceipt,
    AfterOperation,
    AfterRoleSetAttestation,
    AfterNativeJoin,
    AfterOutbox,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl DevelopComposerAcceptanceWriteBoundaryV2 {
    pub const ALL: [Self; 12] = [
        Self::AfterDesign,
        Self::AfterPlan,
        Self::AfterArtifact,
        Self::AfterEachModule,
        Self::AfterEachNewIntrinsicBuildReceipt,
        Self::AfterEachBuildUse,
        Self::AfterComposerReceipt,
        Self::AfterHostReceipt,
        Self::AfterOperation,
        Self::AfterRoleSetAttestation,
        Self::AfterNativeJoin,
        Self::AfterOutbox,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AfterDesign => "AfterDesign",
            Self::AfterPlan => "AfterPlan",
            Self::AfterArtifact => "AfterArtifact",
            Self::AfterEachModule => "AfterEachModule",
            Self::AfterEachNewIntrinsicBuildReceipt => "AfterEachNewIntrinsicBuildReceipt",
            Self::AfterEachBuildUse => "AfterEachBuildUse",
            Self::AfterComposerReceipt => "AfterComposerReceipt",
            Self::AfterHostReceipt => "AfterHostReceipt",
            Self::AfterOperation => "AfterOperation",
            Self::AfterRoleSetAttestation => "AfterRoleSetAttestation",
            Self::AfterNativeJoin => "AfterNativeJoin",
            Self::AfterOutbox => "AfterOutbox",
        }
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
type DevelopComposerFaultBoundaryV2 = DevelopComposerAcceptanceWriteBoundaryV2;
#[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
type DevelopComposerFaultBoundaryV2 = usize;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const fn composer_commit_query_v2(
    fail_after_boundary: Option<DevelopComposerAcceptanceWriteBoundaryV2>,
) -> &'static str {
    match fail_after_boundary {
        Some(_) => ACCEPTANCE_COMMIT_QUERY_V2,
        None => COMMIT_QUERY_V2,
    }
}

#[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
fn composer_commit_query_v2(fail_after_boundary: Option<usize>) -> &'static str {
    debug_assert!(fail_after_boundary.is_none());
    COMMIT_QUERY_V2
}
const ROLE_SET_READ_FUNCTION_V1: &str = "composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const NATIVE_JOIN_READ_FUNCTION_V1: &str = "composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const ROLE_SET_READ_FUNCTION_SOURCE_V1: &str = "SELECT attestation.attestation_identity,attestation.attestation_digest,attestation.canonical_bytes FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 attestation WHERE attestation.request_identity=p_request_identity AND attestation.composer_schema_version=p_composer_schema_version AND attestation.operation_receipt_identity=p_operation_receipt_identity AND attestation.artifact_locator=p_artifact_locator AND attestation.artifact_identity=p_artifact_identity AND attestation.canonical_plan_digest=p_canonical_plan_digest AND attestation.design_digest=p_design_digest";
const NATIVE_JOIN_READ_FUNCTION_SOURCE_V1: &str = "SELECT native_join.native_join_digest,native_join.projection_receipt_digest,native_join.joined_cut_digest,native_join.schedule_dependency_set_digest,native_join.canonical_bytes FROM composer_private.rd_develop_strategy_design_native_joins_v1 native_join JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 attestation USING(request_identity) WHERE native_join.request_identity=p_request_identity AND attestation.composer_schema_version=p_composer_schema_version AND attestation.operation_receipt_identity=p_operation_receipt_identity AND attestation.artifact_locator=p_artifact_locator AND attestation.artifact_identity=p_artifact_identity AND attestation.canonical_plan_digest=p_canonical_plan_digest AND attestation.design_digest=p_design_digest";
const COMMIT_FUNCTION_SOURCE_V2: &str = "DECLARE ordinal integer;
BEGIN
  IF SESSION_USER NOT IN ('rd_fact_writer','rd_owner') THEN RAISE EXCEPTION 'R&D Composer writer required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_receipt_identities)<>cardinality(p_attempt_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_capsule_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_build_bytes) THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0));
  PERFORM operation.request_identity FROM composer_private.rd_develop_operations_v2 operation WHERE operation.request_identity=p_request_identity FOR UPDATE;
  IF FOUND THEN
    RETURN EXISTS (
      SELECT 1
        FROM composer_private.rd_develop_operations_v2 operation
        JOIN composer_private.rd_develop_artifacts_v2 artifact ON artifact.artifact_identity=operation.artifact_identity
        JOIN composer_private.rd_develop_plans_v2 plan ON plan.plan_digest=artifact.plan_digest
        JOIN composer_private.rd_develop_designs_v2 design ON design.design_identity=plan.design_identity
        JOIN composer_private.rd_develop_composer_receipts_v2 composer ON composer.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_host_receipts_v2 host ON host.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 role_set ON role_set.request_identity=operation.request_identity
        JOIN composer_private.rd_develop_outbox_v2 outbox ON outbox.request_identity=operation.request_identity
        LEFT JOIN composer_private.rd_develop_strategy_design_native_joins_v1 native_join ON native_join.request_identity=operation.request_identity
        LEFT JOIN LATERAL (SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_modules_v2 module WHERE module.artifact_identity=artifact.artifact_identity) modules ON true
        LEFT JOIN LATERAL (SELECT array_agg(receipt_use.ordinal ORDER BY receipt_use.ordinal) AS ordinals,array_agg(receipt.receipt_identity ORDER BY receipt_use.ordinal) AS identities,array_agg(receipt.build_attempt_identity ORDER BY receipt_use.ordinal) AS attempts,array_agg(receipt.capsule_identity ORDER BY receipt_use.ordinal) AS capsules,array_agg(receipt.canonical_bytes ORDER BY receipt_use.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use JOIN composer_private.rd_develop_build_receipts_v2 receipt ON receipt.receipt_identity=receipt_use.receipt_identity WHERE receipt_use.artifact_identity=artifact.artifact_identity) builds ON true
       WHERE operation.request_identity=p_request_identity
         AND operation.request_digest=p_request_digest AND operation.research_request_identity=p_research_identity AND operation.intent_identity=p_intent_identity AND operation.artifact_identity=p_artifact_identity AND operation.canonical_receipt_bytes=p_operation_bytes AND operation.response_bytes=p_response_bytes
         AND artifact.plan_digest=p_plan_digest AND artifact.package_bytes=p_package_bytes
         AND plan.design_identity=p_design_identity AND plan.canonical_bytes=p_plan_bytes AND design.canonical_bytes=p_design_bytes
         AND COALESCE(modules.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_module_bytes)-1) value)
         AND COALESCE(modules.canonical_bytes,ARRAY[]::bytea[])=p_module_bytes
         AND COALESCE(builds.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_receipt_identities)-1) value)
         AND COALESCE(builds.identities,ARRAY[]::bytea[])=p_receipt_identities AND COALESCE(builds.attempts,ARRAY[]::bytea[])=p_attempt_identities AND COALESCE(builds.capsules,ARRAY[]::bytea[])=p_capsule_identities AND COALESCE(builds.canonical_bytes,ARRAY[]::bytea[])=p_build_bytes
         AND composer.canonical_bytes=p_composer_bytes AND host.canonical_bytes=p_host_bytes AND outbox.canonical_bytes=p_outbox_bytes
         AND role_set.composer_schema_version=p_role_schema_version AND role_set.operation_receipt_identity=p_role_operation_receipt_identity AND role_set.artifact_locator=p_role_artifact_locator AND role_set.artifact_identity=p_artifact_identity AND role_set.canonical_plan_digest=p_plan_digest AND role_set.design_digest=p_role_design_digest AND role_set.attestation_identity=p_role_attestation_identity AND role_set.attestation_digest=p_role_attestation_digest AND role_set.canonical_bytes=p_role_bytes
         AND ((octet_length(p_native_join_bytes)=0 AND native_join.request_identity IS NULL) OR (octet_length(p_native_join_bytes)>0 AND native_join.native_join_digest=p_native_join_digest AND native_join.projection_receipt_digest=p_projection_receipt_digest AND native_join.joined_cut_digest=p_joined_cut_digest AND native_join.schedule_dependency_set_digest=p_schedule_dependency_set_digest AND native_join.canonical_bytes=p_native_join_bytes))
    );
  END IF;
  INSERT INTO composer_private.rd_develop_designs_v2 VALUES (p_design_identity,p_design_bytes);
  INSERT INTO composer_private.rd_develop_plans_v2 VALUES (p_plan_digest,p_design_identity,p_plan_bytes);
  INSERT INTO composer_private.rd_develop_artifacts_v2 VALUES (p_artifact_identity,p_plan_digest,p_package_bytes);
  FOR ordinal IN SELECT generate_subscripts(p_module_bytes,1) LOOP INSERT INTO composer_private.rd_develop_artifact_modules_v2 VALUES (p_artifact_identity,ordinal-1,p_module_bytes[ordinal]); END LOOP;
  FOR ordinal IN SELECT generate_subscripts(p_receipt_identities,1) LOOP
    INSERT INTO composer_private.rd_develop_build_receipts_v2 VALUES (p_receipt_identities[ordinal],p_attempt_identities[ordinal],p_capsule_identities[ordinal],p_build_bytes[ordinal]) ON CONFLICT (receipt_identity) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM composer_private.rd_develop_build_receipts_v2 receipt WHERE receipt.receipt_identity=p_receipt_identities[ordinal] AND receipt.build_attempt_identity=p_attempt_identities[ordinal] AND receipt.capsule_identity=p_capsule_identities[ordinal] AND receipt.canonical_bytes=p_build_bytes[ordinal]) THEN RETURN false; END IF;
    INSERT INTO composer_private.rd_develop_artifact_build_receipt_uses_v2 VALUES (p_artifact_identity,ordinal-1,p_receipt_identities[ordinal]);
  END LOOP;
  INSERT INTO composer_private.rd_develop_composer_receipts_v2 VALUES (p_artifact_identity,p_composer_bytes);
  INSERT INTO composer_private.rd_develop_host_receipts_v2 VALUES (p_artifact_identity,p_host_bytes);
  INSERT INTO composer_private.rd_develop_operations_v2 VALUES (p_request_identity,p_request_digest,p_research_identity,p_intent_identity,p_artifact_identity,p_operation_bytes,p_response_bytes);
  INSERT INTO composer_private.rd_develop_strategy_design_role_set_attestations_v1 VALUES (p_request_identity,p_role_schema_version,p_role_operation_receipt_identity,p_role_artifact_locator,p_artifact_identity,p_plan_digest,p_role_design_digest,p_role_attestation_identity,p_role_attestation_digest,p_role_bytes);
  IF octet_length(p_native_join_bytes)>0 THEN
    INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1 VALUES (p_request_identity,p_native_join_digest,p_projection_receipt_digest,p_joined_cut_digest,p_schedule_dependency_set_digest,p_native_join_bytes);
  END IF;
  INSERT INTO composer_private.rd_develop_outbox_v2 VALUES (p_request_identity,p_outbox_bytes);
  RETURN true;
END";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const ACCEPTANCE_COMMIT_FUNCTION_SOURCE_V2: &str = r#"DECLARE ordinal integer; inserted_rows bigint; fail_after text;
BEGIN
  IF SESSION_USER<>'rd_owner' THEN RAISE EXCEPTION 'R&D Composer acceptance writer required' USING ERRCODE='42501'; END IF;
  fail_after := pg_catalog.current_setting('vibe.sealed_acceptance.composer_fail_after',true);
  IF fail_after IS NOT NULL AND fail_after<>'' AND fail_after NOT IN ('AfterDesign','AfterPlan','AfterArtifact','AfterEachModule','AfterEachNewIntrinsicBuildReceipt','AfterEachBuildUse','AfterComposerReceipt','AfterHostReceipt','AfterOperation','AfterRoleSetAttestation','AfterNativeJoin','AfterOutbox') THEN
    RAISE EXCEPTION 'Unknown Composer acceptance boundary' USING ERRCODE='22023';
  END IF;
  IF cardinality(p_receipt_identities)<>cardinality(p_attempt_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_capsule_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_build_bytes) THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0));
  PERFORM operation.request_identity FROM composer_private.rd_develop_operations_v2 operation WHERE operation.request_identity=p_request_identity FOR UPDATE;
  IF FOUND THEN
    RETURN EXISTS (
      SELECT 1
        FROM composer_private.rd_develop_operations_v2 operation
        JOIN composer_private.rd_develop_artifacts_v2 artifact ON artifact.artifact_identity=operation.artifact_identity
        JOIN composer_private.rd_develop_plans_v2 plan ON plan.plan_digest=artifact.plan_digest
        JOIN composer_private.rd_develop_designs_v2 design ON design.design_identity=plan.design_identity
        JOIN composer_private.rd_develop_composer_receipts_v2 composer ON composer.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_host_receipts_v2 host ON host.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 role_set ON role_set.request_identity=operation.request_identity
        JOIN composer_private.rd_develop_outbox_v2 outbox ON outbox.request_identity=operation.request_identity
        LEFT JOIN composer_private.rd_develop_strategy_design_native_joins_v1 native_join ON native_join.request_identity=operation.request_identity
        LEFT JOIN LATERAL (SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_modules_v2 module WHERE module.artifact_identity=artifact.artifact_identity) modules ON true
        LEFT JOIN LATERAL (SELECT array_agg(receipt_use.ordinal ORDER BY receipt_use.ordinal) AS ordinals,array_agg(receipt.receipt_identity ORDER BY receipt_use.ordinal) AS identities,array_agg(receipt.build_attempt_identity ORDER BY receipt_use.ordinal) AS attempts,array_agg(receipt.capsule_identity ORDER BY receipt_use.ordinal) AS capsules,array_agg(receipt.canonical_bytes ORDER BY receipt_use.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use JOIN composer_private.rd_develop_build_receipts_v2 receipt ON receipt.receipt_identity=receipt_use.receipt_identity WHERE receipt_use.artifact_identity=artifact.artifact_identity) builds ON true
       WHERE operation.request_identity=p_request_identity
         AND operation.request_digest=p_request_digest AND operation.research_request_identity=p_research_identity AND operation.intent_identity=p_intent_identity AND operation.artifact_identity=p_artifact_identity AND operation.canonical_receipt_bytes=p_operation_bytes AND operation.response_bytes=p_response_bytes
         AND artifact.plan_digest=p_plan_digest AND artifact.package_bytes=p_package_bytes
         AND plan.design_identity=p_design_identity AND plan.canonical_bytes=p_plan_bytes AND design.canonical_bytes=p_design_bytes
         AND COALESCE(modules.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_module_bytes)-1) value)
         AND COALESCE(modules.canonical_bytes,ARRAY[]::bytea[])=p_module_bytes
         AND COALESCE(builds.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_receipt_identities)-1) value)
         AND COALESCE(builds.identities,ARRAY[]::bytea[])=p_receipt_identities AND COALESCE(builds.attempts,ARRAY[]::bytea[])=p_attempt_identities AND COALESCE(builds.capsules,ARRAY[]::bytea[])=p_capsule_identities AND COALESCE(builds.canonical_bytes,ARRAY[]::bytea[])=p_build_bytes
         AND composer.canonical_bytes=p_composer_bytes AND host.canonical_bytes=p_host_bytes AND outbox.canonical_bytes=p_outbox_bytes
         AND role_set.composer_schema_version=p_role_schema_version AND role_set.operation_receipt_identity=p_role_operation_receipt_identity AND role_set.artifact_locator=p_role_artifact_locator AND role_set.artifact_identity=p_artifact_identity AND role_set.canonical_plan_digest=p_plan_digest AND role_set.design_digest=p_role_design_digest AND role_set.attestation_identity=p_role_attestation_identity AND role_set.attestation_digest=p_role_attestation_digest AND role_set.canonical_bytes=p_role_bytes
         AND ((octet_length(p_native_join_bytes)=0 AND native_join.request_identity IS NULL) OR (octet_length(p_native_join_bytes)>0 AND native_join.native_join_digest=p_native_join_digest AND native_join.projection_receipt_digest=p_projection_receipt_digest AND native_join.joined_cut_digest=p_joined_cut_digest AND native_join.schedule_dependency_set_digest=p_schedule_dependency_set_digest AND native_join.canonical_bytes=p_native_join_bytes))
    );
  END IF;
  INSERT INTO composer_private.rd_develop_designs_v2 VALUES (p_design_identity,p_design_bytes);
  IF fail_after='AfterDesign' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  INSERT INTO composer_private.rd_develop_plans_v2 VALUES (p_plan_digest,p_design_identity,p_plan_bytes);
  IF fail_after='AfterPlan' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  INSERT INTO composer_private.rd_develop_artifacts_v2 VALUES (p_artifact_identity,p_plan_digest,p_package_bytes);
  IF fail_after='AfterArtifact' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  FOR ordinal IN SELECT generate_subscripts(p_module_bytes,1) LOOP
    INSERT INTO composer_private.rd_develop_artifact_modules_v2 VALUES (p_artifact_identity,ordinal-1,p_module_bytes[ordinal]);
    IF fail_after='AfterEachModule' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  END LOOP;
  FOR ordinal IN SELECT generate_subscripts(p_receipt_identities,1) LOOP
    INSERT INTO composer_private.rd_develop_build_receipts_v2 VALUES (p_receipt_identities[ordinal],p_attempt_identities[ordinal],p_capsule_identities[ordinal],p_build_bytes[ordinal]) ON CONFLICT (receipt_identity) DO NOTHING;
    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    IF inserted_rows>0 AND fail_after='AfterEachNewIntrinsicBuildReceipt' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
    IF NOT EXISTS (SELECT 1 FROM composer_private.rd_develop_build_receipts_v2 receipt WHERE receipt.receipt_identity=p_receipt_identities[ordinal] AND receipt.build_attempt_identity=p_attempt_identities[ordinal] AND receipt.capsule_identity=p_capsule_identities[ordinal] AND receipt.canonical_bytes=p_build_bytes[ordinal]) THEN RETURN false; END IF;
    INSERT INTO composer_private.rd_develop_artifact_build_receipt_uses_v2 VALUES (p_artifact_identity,ordinal-1,p_receipt_identities[ordinal]);
    IF fail_after='AfterEachBuildUse' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  END LOOP;
  INSERT INTO composer_private.rd_develop_composer_receipts_v2 VALUES (p_artifact_identity,p_composer_bytes);
  IF fail_after='AfterComposerReceipt' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  INSERT INTO composer_private.rd_develop_host_receipts_v2 VALUES (p_artifact_identity,p_host_bytes);
  IF fail_after='AfterHostReceipt' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  INSERT INTO composer_private.rd_develop_operations_v2 VALUES (p_request_identity,p_request_digest,p_research_identity,p_intent_identity,p_artifact_identity,p_operation_bytes,p_response_bytes);
  IF fail_after='AfterOperation' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  INSERT INTO composer_private.rd_develop_strategy_design_role_set_attestations_v1 VALUES (p_request_identity,p_role_schema_version,p_role_operation_receipt_identity,p_role_artifact_locator,p_artifact_identity,p_plan_digest,p_role_design_digest,p_role_attestation_identity,p_role_attestation_digest,p_role_bytes);
  IF fail_after='AfterRoleSetAttestation' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  IF octet_length(p_native_join_bytes)>0 THEN
    INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1 VALUES (p_request_identity,p_native_join_digest,p_projection_receipt_digest,p_joined_cut_digest,p_schedule_dependency_set_digest,p_native_join_bytes);
    IF fail_after='AfterNativeJoin' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  ELSIF fail_after='AfterNativeJoin' THEN
    INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1 VALUES (
      p_request_identity,
      pg_catalog.sha256(pg_catalog.convert_to('rd.develop.composer.acceptance.native-join.receipt.v1:'||p_request_identity,'UTF8')),
      pg_catalog.sha256(pg_catalog.convert_to('rd.develop.composer.acceptance.native-join.projection.v1:'||p_request_identity,'UTF8')),
      pg_catalog.sha256(pg_catalog.convert_to('rd.develop.composer.acceptance.native-join.cut.v1:'||p_request_identity,'UTF8')),
      pg_catalog.sha256(pg_catalog.convert_to('rd.develop.composer.acceptance.native-join.schedule.v1:'||p_request_identity,'UTF8')),
      pg_catalog.convert_to('rd.develop.composer.acceptance.native-join.rollback-only.v1','UTF8')
    );
    RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after;
  END IF;
  INSERT INTO composer_private.rd_develop_outbox_v2 VALUES (p_request_identity,p_outbox_bytes);
  IF fail_after='AfterOutbox' THEN RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after; END IF;
  RETURN true;
END"#;
const COMPOSER_TABLES_V2: [&str; 12] = [
    "rd_develop_designs_v2",
    "rd_develop_plans_v2",
    "rd_develop_artifacts_v2",
    "rd_develop_artifact_modules_v2",
    "rd_develop_build_receipts_v2",
    "rd_develop_artifact_build_receipt_uses_v2",
    "rd_develop_composer_receipts_v2",
    "rd_develop_host_receipts_v2",
    "rd_develop_operations_v2",
    "rd_develop_strategy_design_role_set_attestations_v1",
    "rd_develop_strategy_design_native_joins_v1",
    "rd_develop_outbox_v2",
];
macro_rules! composer_table {
    ($name:literal, [$(($column:literal, $data_type:literal)),* $(,)?], [$($constraint:literal),* $(,)?], [$($kind:ident $keys:literal),* $(,)?]) => {
        crate::schema_materialization::PublicTableSpec {
            name: $name,
            runtime_read_grantees: &[],
            columns: &[$(crate::schema_materialization::required($column, $data_type)),*],
            constraints: &[$($constraint),*],
            indexes: &[$(composer_table!(@index $kind $keys)),*],
        }
    };
    (@index primary $keys:literal) => { crate::schema_materialization::primary_index($keys) };
    (@index unique $keys:literal) => { crate::schema_materialization::unique_index($keys) };
}
const COMPOSER_PUBLIC_TABLE_SPECS_V2: &[crate::schema_materialization::PublicTableSpec] = &[
    composer_table!("rd_develop_designs_v2", [("design_identity", "bytea"), ("canonical_bytes", "bytea")],
        ["p:design_identity:::false:false:true:"], [primary "design_identity"]),
    composer_table!("rd_develop_plans_v2", [("plan_digest", "bytea"), ("design_identity", "bytea"), ("canonical_bytes", "bytea")], [
        "f:design_identity:public.rd_develop_designs_v2(design_identity):a:a:s:false:false:true:",
        "p:plan_digest:::false:false:true:", "u:design_identity:::false:false:true:"
    ], [primary "plan_digest", unique "design_identity"]),
    composer_table!("rd_develop_artifacts_v2", [("artifact_identity", "bytea"), ("plan_digest", "bytea"), ("package_bytes", "bytea")], [
        "f:plan_digest:public.rd_develop_plans_v2(plan_digest):a:a:s:false:false:true:",
        "p:artifact_identity:::false:false:true:", "u:plan_digest:::false:false:true:"
    ], [primary "artifact_identity", unique "plan_digest"]),
    composer_table!("rd_develop_artifact_modules_v2", [("artifact_identity", "bytea"), ("ordinal", "integer"), ("module_bytes", "bytea")], [
        "f:artifact_identity:public.rd_develop_artifacts_v2(artifact_identity):a:a:s:false:false:true:",
        "p:artifact_identity,ordinal:::false:false:true:"
    ], [primary "artifact_identity,ordinal"]),
    composer_table!("rd_develop_build_receipts_v2", [
        ("receipt_identity", "bytea"), ("build_attempt_identity", "bytea"),
        ("capsule_identity", "bytea"), ("canonical_bytes", "bytea")
    ], [
        "p:receipt_identity:::false:false:true:",
        "u:build_attempt_identity:::false:false:true:", "u:capsule_identity:::false:false:true:"
    ], [primary "receipt_identity", unique "build_attempt_identity", unique "capsule_identity"]),
    composer_table!("rd_develop_artifact_build_receipt_uses_v2", [
        ("artifact_identity", "bytea"), ("ordinal", "integer"), ("receipt_identity", "bytea")
    ], [
        "f:artifact_identity:public.rd_develop_artifacts_v2(artifact_identity):a:a:s:false:false:true:",
        "f:receipt_identity:public.rd_develop_build_receipts_v2(receipt_identity):a:a:s:false:false:true:",
        "p:artifact_identity,ordinal:::false:false:true:", "u:artifact_identity,receipt_identity:::false:false:true:"
    ], [primary "artifact_identity,ordinal", unique "artifact_identity,receipt_identity"]),
    composer_table!("rd_develop_composer_receipts_v2", [("artifact_identity", "bytea"), ("canonical_bytes", "bytea")], [
        "f:artifact_identity:public.rd_develop_artifacts_v2(artifact_identity):a:a:s:false:false:true:",
        "p:artifact_identity:::false:false:true:"
    ], [primary "artifact_identity"]),
    composer_table!("rd_develop_host_receipts_v2", [("artifact_identity", "bytea"), ("canonical_bytes", "bytea")], [
        "f:artifact_identity:public.rd_develop_artifacts_v2(artifact_identity):a:a:s:false:false:true:",
        "p:artifact_identity:::false:false:true:"
    ], [primary "artifact_identity"]),
    composer_table!("rd_develop_operations_v2", [
        ("request_identity", "text"), ("request_digest", "bytea"),
        ("research_request_identity", "bytea"), ("intent_identity", "bytea"),
        ("artifact_identity", "bytea"), ("canonical_receipt_bytes", "bytea"),
        ("response_bytes", "bytea")
    ], [
        "f:artifact_identity:public.rd_develop_artifacts_v2(artifact_identity):a:a:s:false:false:true:",
        "p:request_identity:::false:false:true:", "u:artifact_identity:::false:false:true:",
        "u:intent_identity:::false:false:true:", "u:research_request_identity:::false:false:true:"
    ], [primary "request_identity", unique "artifact_identity", unique "intent_identity", unique "research_request_identity"]),
    composer_table!("rd_develop_strategy_design_role_set_attestations_v1", [
        ("request_identity", "text"), ("composer_schema_version", "integer"),
        ("operation_receipt_identity", "bytea"), ("artifact_locator", "text"),
        ("artifact_identity", "bytea"), ("canonical_plan_digest", "bytea"),
        ("design_digest", "bytea"), ("attestation_identity", "bytea"),
        ("attestation_digest", "bytea"), ("canonical_bytes", "bytea")
    ], [
        "f:request_identity:public.rd_develop_operations_v2(request_identity):a:a:s:false:false:true:",
        "p:request_identity:::false:false:true:", "u:artifact_identity:::false:false:true:",
        "u:attestation_digest:::false:false:true:", "u:attestation_identity:::false:false:true:",
        "u:canonical_plan_digest:::false:false:true:", "u:operation_receipt_identity:::false:false:true:",
        "u:request_identity,composer_schema_version,operation_receipt_identity,artifact_locator,artifact_identity,canonical_plan_digest,design_digest:::false:false:true:"
    ], [
        primary "request_identity", unique "artifact_identity", unique "attestation_digest",
        unique "attestation_identity", unique "canonical_plan_digest", unique "operation_receipt_identity",
        unique "request_identity,composer_schema_version,operation_receipt_identity,artifact_locator,artifact_identity,canonical_plan_digest,design_digest"
    ]),
    composer_table!("rd_develop_strategy_design_native_joins_v1", [
        ("request_identity", "text"), ("native_join_digest", "bytea"),
        ("projection_receipt_digest", "bytea"), ("joined_cut_digest", "bytea"),
        ("schedule_dependency_set_digest", "bytea"), ("canonical_bytes", "bytea")
    ], [
        "f:request_identity:public.rd_develop_operations_v2(request_identity):a:a:s:false:false:true:",
        "p:request_identity:::false:false:true:", "u:native_join_digest:::false:false:true:",
        "u:projection_receipt_digest:::false:false:true:"
    ], [primary "request_identity", unique "native_join_digest", unique "projection_receipt_digest"]),
    composer_table!("rd_develop_outbox_v2", [("request_identity", "text"), ("canonical_bytes", "bytea")], [
        "f:request_identity:public.rd_develop_operations_v2(request_identity):a:a:s:false:false:true:",
        "p:request_identity:::false:false:true:"
    ], [primary "request_identity"]),
];
const SEALED_READ_FUNCTION_SOURCE_V2: &str = "BEGIN
  LOCK TABLE
    composer_private.rd_develop_designs_v2,
    composer_private.rd_develop_plans_v2,
    composer_private.rd_develop_artifacts_v2,
    composer_private.rd_develop_artifact_modules_v2,
    composer_private.rd_develop_build_receipts_v2,
    composer_private.rd_develop_artifact_build_receipt_uses_v2,
    composer_private.rd_develop_composer_receipts_v2,
    composer_private.rd_develop_host_receipts_v2,
    composer_private.rd_develop_operations_v2,
    composer_private.rd_develop_strategy_design_role_set_attestations_v1,
    composer_private.rd_develop_strategy_design_native_joins_v1,
    composer_private.rd_develop_outbox_v2
  IN SHARE MODE;
  RETURN QUERY
  SELECT operation.request_digest,
         operation.research_request_identity,
         operation.intent_identity,
         operation.artifact_identity,
         operation.canonical_receipt_bytes,
         operation.response_bytes,
         artifact.plan_digest,
         artifact.package_bytes,
         plan.design_identity,
         plan.canonical_bytes,
         design.canonical_bytes,
         COALESCE(modules.ordinals, ARRAY[]::integer[]),
         COALESCE(modules.canonical_bytes, ARRAY[]::bytea[]),
         COALESCE(builds.ordinals, ARRAY[]::integer[]),
         COALESCE(builds.receipt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.attempt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.capsule_identities, ARRAY[]::bytea[]),
         COALESCE(builds.canonical_bytes, ARRAY[]::bytea[]),
         composer.canonical_bytes,
         host.canonical_bytes,
         outbox.canonical_bytes
    FROM composer_private.rd_develop_operations_v2 operation
    JOIN composer_private.rd_develop_artifacts_v2 artifact
      ON artifact.artifact_identity=operation.artifact_identity
    JOIN composer_private.rd_develop_plans_v2 plan
      ON plan.plan_digest=artifact.plan_digest
    JOIN composer_private.rd_develop_designs_v2 design
      ON design.design_identity=plan.design_identity
    JOIN composer_private.rd_develop_composer_receipts_v2 composer
      ON composer.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_host_receipts_v2 host
      ON host.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_outbox_v2 outbox
      ON outbox.request_identity=operation.request_identity
    LEFT JOIN LATERAL (
      SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,
             array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_artifact_modules_v2 module
       WHERE module.artifact_identity=artifact.artifact_identity
    ) modules ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(receipt_use.ordinal ORDER BY receipt_use.ordinal) AS ordinals,
             array_agg(receipt.receipt_identity ORDER BY receipt_use.ordinal) AS receipt_identities,
             array_agg(receipt.build_attempt_identity ORDER BY receipt_use.ordinal) AS attempt_identities,
             array_agg(receipt.capsule_identity ORDER BY receipt_use.ordinal) AS capsule_identities,
             array_agg(receipt.canonical_bytes ORDER BY receipt_use.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use
        JOIN composer_private.rd_develop_build_receipts_v2 receipt
          ON receipt.receipt_identity=receipt_use.receipt_identity
       WHERE receipt_use.artifact_identity=artifact.artifact_identity
    ) builds ON TRUE
   WHERE operation.request_identity=p_request_identity;
END";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const COMMIT_CUT_FUNCTION_SOURCE_V2: &str = "BEGIN
  IF SESSION_USER<>'rd_owner' OR CURRENT_USER<>'composer_owner' THEN RAISE EXCEPTION 'R&D Owner required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0));
  PERFORM operation.request_identity
    FROM composer_private.rd_develop_operations_v2 operation
   WHERE operation.request_identity=p_request_identity
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM artifact.artifact_identity
    FROM composer_private.rd_develop_operations_v2 operation
    JOIN composer_private.rd_develop_artifacts_v2 artifact ON artifact.artifact_identity=operation.artifact_identity
    JOIN composer_private.rd_develop_plans_v2 plan ON plan.plan_digest=artifact.plan_digest
    JOIN composer_private.rd_develop_designs_v2 design ON design.design_identity=plan.design_identity
    JOIN composer_private.rd_develop_composer_receipts_v2 composer ON composer.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_host_receipts_v2 host ON host.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 role_set ON role_set.request_identity=operation.request_identity
    JOIN composer_private.rd_develop_outbox_v2 outbox ON outbox.request_identity=operation.request_identity
   WHERE operation.request_identity=p_request_identity
   FOR SHARE OF artifact,plan,design,composer,host,role_set,outbox;
  PERFORM native_join.request_identity FROM composer_private.rd_develop_strategy_design_native_joins_v1 native_join WHERE native_join.request_identity=p_request_identity FOR SHARE;
  PERFORM module.ordinal FROM composer_private.rd_develop_artifact_modules_v2 module JOIN composer_private.rd_develop_operations_v2 operation ON operation.artifact_identity=module.artifact_identity WHERE operation.request_identity=p_request_identity FOR SHARE OF module;
  PERFORM receipt_use.ordinal FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use JOIN composer_private.rd_develop_operations_v2 operation ON operation.artifact_identity=receipt_use.artifact_identity WHERE operation.request_identity=p_request_identity FOR SHARE OF receipt_use;
  PERFORM receipt.receipt_identity FROM composer_private.rd_develop_build_receipts_v2 receipt JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use ON receipt_use.receipt_identity=receipt.receipt_identity JOIN composer_private.rd_develop_operations_v2 operation ON operation.artifact_identity=receipt_use.artifact_identity WHERE operation.request_identity=p_request_identity FOR SHARE OF receipt;
  RETURN QUERY
  SELECT operation.request_digest,operation.research_request_identity,operation.intent_identity,operation.artifact_identity,operation.canonical_receipt_bytes,operation.response_bytes,
         artifact.plan_digest,artifact.package_bytes,plan.design_identity,plan.canonical_bytes,design.canonical_bytes,
         COALESCE(modules.ordinals,ARRAY[]::integer[]),COALESCE(modules.canonical_bytes,ARRAY[]::bytea[]),
         COALESCE(builds.ordinals,ARRAY[]::integer[]),COALESCE(builds.receipt_identities,ARRAY[]::bytea[]),COALESCE(builds.attempt_identities,ARRAY[]::bytea[]),COALESCE(builds.capsule_identities,ARRAY[]::bytea[]),COALESCE(builds.canonical_bytes,ARRAY[]::bytea[]),
         composer.canonical_bytes,host.canonical_bytes,outbox.canonical_bytes
    FROM composer_private.rd_develop_operations_v2 operation
    JOIN composer_private.rd_develop_artifacts_v2 artifact ON artifact.artifact_identity=operation.artifact_identity
    JOIN composer_private.rd_develop_plans_v2 plan ON plan.plan_digest=artifact.plan_digest
    JOIN composer_private.rd_develop_designs_v2 design ON design.design_identity=plan.design_identity
    JOIN composer_private.rd_develop_composer_receipts_v2 composer ON composer.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_host_receipts_v2 host ON host.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_outbox_v2 outbox ON outbox.request_identity=operation.request_identity
    LEFT JOIN LATERAL (SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_modules_v2 module WHERE module.artifact_identity=artifact.artifact_identity) modules ON TRUE
    LEFT JOIN LATERAL (SELECT array_agg(receipt_use.ordinal ORDER BY receipt_use.ordinal) AS ordinals,array_agg(receipt.receipt_identity ORDER BY receipt_use.ordinal) AS receipt_identities,array_agg(receipt.build_attempt_identity ORDER BY receipt_use.ordinal) AS attempt_identities,array_agg(receipt.capsule_identity ORDER BY receipt_use.ordinal) AS capsule_identities,array_agg(receipt.canonical_bytes ORDER BY receipt_use.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 receipt_use JOIN composer_private.rd_develop_build_receipts_v2 receipt ON receipt.receipt_identity=receipt_use.receipt_identity WHERE receipt_use.artifact_identity=artifact.artifact_identity) builds ON TRUE
   WHERE operation.request_identity=p_request_identity;
END";

/// Untrusted exact claim for one accepted durable Composer operation.
///
/// Constructing or changing this locator grants no authority. The R&D-owned read port resolves the
/// complete claim against one persisted positive operation and returns only a sealed readback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DevelopComposerSealedReadLocatorV2 {
    pub schema_version: u16,
    pub request_identity: String,
    pub operation_receipt_identity: BindingDigest,
    pub artifact_locator: String,
    pub artifact_identity: BindingDigest,
    pub canonical_plan_digest: BindingDigest,
    pub design_digest: BindingDigest,
}

impl DevelopComposerSealedReadLocatorV2 {
    /// Projects an untrusted locator from a public positive operation response.
    ///
    /// The returned value becomes authoritative only after exact R&D Owner resolution.
    pub fn from_accepted_response(
        response: &DevelopComposerOperationResponseV2,
    ) -> Result<Self, DevelopComposerSealedReadErrorV2> {
        let receipt_identity = response
            .receipt_identity
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
        let artifact = response
            .artifact
            .as_ref()
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;

        if response.schema_version != SEALED_READ_SCHEMA_V2
            || response.disposition != DevelopComposerOperationDispositionV2::Success
            || response.coordinate.is_some()
            || response.reason.is_some()
            || response.request_identity.is_empty()
            || artifact.artifact_locator.is_empty()
        {
            return Err(DevelopComposerSealedReadErrorV2::Unavailable);
        }
        Ok(Self {
            schema_version: SEALED_READ_SCHEMA_V2,
            request_identity: response.request_identity.clone(),
            operation_receipt_identity: receipt_identity,
            artifact_locator: artifact.artifact_locator.clone(),
            artifact_identity: artifact.artifact_digest,
            canonical_plan_digest: artifact.canonical_plan_digest,
            design_digest: artifact.design_digest,
        })
    }
}

/// Uniform fail-closed result for missing, mismatched, corrupt, or unreadable R&D custody.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DevelopComposerSealedReadErrorV2 {
    Unavailable,
}

impl Display for DevelopComposerSealedReadErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("sealed Composer readback is unavailable")
    }
}

impl std::error::Error for DevelopComposerSealedReadErrorV2 {}

/// R&D-sealed canonical Composer package readback.
///
/// Private fields and the absence of `Deserialize` or a public constructor prevent callers from
/// upgrading arbitrary DTOs or bytes into an R&D Owner fact. The bytes remain immutable historical
/// Composer custody; they are not Backtest actual-consumption or replay-result evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedDevelopComposerReadbackV2 {
    locator: DevelopComposerSealedReadLocatorV2,
    request_digest: BindingDigest,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    design_identity: BindingDigest,
    design_bytes: Box<[u8]>,
    design_bytes_digest: BindingDigest,
    plan_bytes: Box<[u8]>,
    plan_bytes_digest: BindingDigest,
    artifact_package_bytes: Box<[u8]>,
    artifact_package_bytes_digest: BindingDigest,
    module_bytes: Vec<Box<[u8]>>,
    module_bytes_digests: Vec<BindingDigest>,
    build_receipt_identities: Vec<BindingDigest>,
    build_receipt_bytes: Vec<Box<[u8]>>,
    build_receipt_bytes_digests: Vec<BindingDigest>,
    composer_receipt_bytes: Box<[u8]>,
    composer_receipt_bytes_digest: BindingDigest,
    host_receipt_bytes: Box<[u8]>,
    host_receipt_bytes_digest: BindingDigest,
}

impl SealedDevelopComposerReadbackV2 {
    pub const fn locator(&self) -> &DevelopComposerSealedReadLocatorV2 {
        &self.locator
    }

    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }

    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    pub fn design_bytes(&self) -> &[u8] {
        &self.design_bytes
    }

    pub const fn design_bytes_digest(&self) -> BindingDigest {
        self.design_bytes_digest
    }

    pub fn plan_bytes(&self) -> &[u8] {
        &self.plan_bytes
    }

    pub const fn plan_bytes_digest(&self) -> BindingDigest {
        self.plan_bytes_digest
    }

    pub fn artifact_package_bytes(&self) -> &[u8] {
        &self.artifact_package_bytes
    }

    pub const fn artifact_package_bytes_digest(&self) -> BindingDigest {
        self.artifact_package_bytes_digest
    }

    pub fn module_bytes(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.module_bytes.iter().map(|bytes| bytes.as_ref())
    }

    pub fn module_bytes_digests(&self) -> &[BindingDigest] {
        &self.module_bytes_digests
    }

    pub fn build_receipt_identities(&self) -> &[BindingDigest] {
        &self.build_receipt_identities
    }

    pub fn build_receipt_bytes(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.build_receipt_bytes.iter().map(|bytes| bytes.as_ref())
    }

    pub fn build_receipt_bytes_digests(&self) -> &[BindingDigest] {
        &self.build_receipt_bytes_digests
    }

    pub fn composer_receipt_bytes(&self) -> &[u8] {
        &self.composer_receipt_bytes
    }

    pub const fn composer_receipt_bytes_digest(&self) -> BindingDigest {
        self.composer_receipt_bytes_digest
    }

    pub fn host_receipt_bytes(&self) -> &[u8] {
        &self.host_receipt_bytes
    }

    pub const fn host_receipt_bytes_digest(&self) -> BindingDigest {
        self.host_receipt_bytes_digest
    }
}

fn project_role_set_from_record(
    record: &StoredDevelopComposerPositiveV2,
    response: &DevelopComposerOperationResponseV2,
) -> Result<StrategyDesignRoleSetReceiptV1, StrategyDesignRoleSetErrorV1> {
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(response)
        .map_err(|_| StrategyDesignRoleSetErrorV1::InvalidProjection)?;
    project_strategy_design_role_set_v1(
        &record.plan_bytes,
        &record.design_bytes,
        canonical_blob_digest(
            b"rd.develop.design.canonical-bytes.v2\0",
            &record.design_bytes,
        ),
        StrategyDesignRoleSetLocatorV1 {
            schema_version: locator.schema_version,
            request_identity: locator.request_identity,
            operation_receipt_identity: locator.operation_receipt_identity,
            artifact_locator: locator.artifact_locator,
            artifact_identity: locator.artifact_identity,
            canonical_plan_digest: locator.canonical_plan_digest,
            design_digest: locator.design_digest,
        },
        record.research_request_identity,
        record.intent_identity,
    )
}

mod sealed_read_port {
    pub trait RdOwned {}
}

/// Query-only boundary that only an R&D-owned implementation can provide.
#[async_trait]
pub trait DevelopComposerSealedReadPortV2: sealed_read_port::RdOwned + Send + Sync {
    /// Resolves one exact accepted Composer locator without creating or mutating custody.
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2>;
}

/// R&D composition-root implementation. Its evidence seam and constructor remain crate-private so
/// a downstream caller cannot substitute its own current-custody authority.
#[allow(
    dead_code,
    reason = "the future R&D composition root injects this port into the Backtest-owned runner"
)]
pub(crate) struct PostgresDevelopComposerSealedReadPortV2<E> {
    store: PostgresDevelopComposerStoreV2,
    evidence: E,
    read_cut_epoch_ms: u64,
}

#[allow(
    dead_code,
    reason = "the future R&D composition root owns construction of the sealed read port"
)]
impl<E> PostgresDevelopComposerSealedReadPortV2<E> {
    pub(crate) const fn new(
        store: PostgresDevelopComposerStoreV2,
        evidence: E,
        read_cut_epoch_ms: u64,
    ) -> Self {
        Self {
            store,
            evidence,
            read_cut_epoch_ms,
        }
    }
}

impl<E> sealed_read_port::RdOwned for PostgresDevelopComposerSealedReadPortV2<E> {}

#[async_trait]
impl<E> DevelopComposerSealedReadPortV2 for PostgresDevelopComposerSealedReadPortV2<E>
where
    E: DevelopComposerFinalEvidencePortV2 + Send + Sync,
{
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
        let mut transaction = self
            .store
            .begin_read_transaction()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let record = load_record_via_sealed_routine_in_transaction(
            &mut transaction,
            &locator.request_identity,
        )
        .await?
        .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
        if !locator_matches_record_keys(locator, &record) {
            return Err(DevelopComposerSealedReadErrorV2::Unavailable);
        }
        let current = self
            .evidence
            .lock_and_reread_durable(
                &DevelopComposerDurableEvidenceLocatorV2::from_record(&record),
                self.read_cut_epoch_ms,
            )
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let readback = read_accepted_in_transaction(&mut transaction, locator, current).await?;
        transaction
            .commit()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        Ok(readback)
    }
}

fn locator_matches_record_keys(
    locator: &DevelopComposerSealedReadLocatorV2,
    record: &StoredDevelopComposerPositiveV2,
) -> bool {
    locator.schema_version == SEALED_READ_SCHEMA_V2
        && !locator.request_identity.is_empty()
        && locator.request_identity == record.request_identity
        && locator.artifact_identity == record.artifact_identity
        && locator.canonical_plan_digest == record.plan_digest
}

fn accepted_response_matches_locator(
    locator: &DevelopComposerSealedReadLocatorV2,
    response: &DevelopComposerOperationResponseV2,
) -> bool {
    response.schema_version == SEALED_READ_SCHEMA_V2
        && response.disposition == DevelopComposerOperationDispositionV2::Success
        && response.request_identity == locator.request_identity
        && response.receipt_identity == Some(locator.operation_receipt_identity)
        && response.coordinate.is_none()
        && response.reason.is_none()
        && response.artifact.as_ref().is_some_and(|artifact| {
            artifact.artifact_locator == locator.artifact_locator
                && artifact.artifact_digest == locator.artifact_identity
                && artifact.canonical_plan_digest == locator.canonical_plan_digest
                && artifact.design_digest == locator.design_digest
        })
}

fn seal_readback(
    locator: &DevelopComposerSealedReadLocatorV2,
    record: StoredDevelopComposerPositiveV2,
    response: &DevelopComposerOperationResponseV2,
) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
    if !locator_matches_record_keys(locator, &record)
        || !accepted_response_matches_locator(locator, response)
        || record.response_bytes != response.canonical_bytes()
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }

    let module_bytes_digests = record
        .module_bytes
        .iter()
        .map(|bytes| {
            canonical_blob_digest(b"rd.develop.artifact-module.canonical-bytes.v2\0", bytes)
        })
        .collect();
    let build_receipt_bytes_digests = record
        .build_receipt_bytes
        .iter()
        .map(|bytes| canonical_blob_digest(b"rd.develop.build-receipt.canonical-bytes.v2\0", bytes))
        .collect();

    Ok(SealedDevelopComposerReadbackV2 {
        locator: locator.clone(),
        request_digest: record.request_digest,
        research_request_identity: record.research_request_identity,
        intent_identity: record.intent_identity,
        design_identity: record.design_identity,
        design_bytes_digest: canonical_blob_digest(
            b"rd.develop.design.canonical-bytes.v2\0",
            &record.design_bytes,
        ),
        design_bytes: record.design_bytes.into_boxed_slice(),
        plan_bytes_digest: canonical_blob_digest(
            b"rd.develop.plan.canonical-bytes.v2\0",
            &record.plan_bytes,
        ),
        plan_bytes: record.plan_bytes.into_boxed_slice(),
        artifact_package_bytes_digest: canonical_blob_digest(
            b"rd.develop.artifact-package.canonical-bytes.v2\0",
            &record.artifact_package_bytes,
        ),
        artifact_package_bytes: record.artifact_package_bytes.into_boxed_slice(),
        module_bytes: record.module_bytes,
        module_bytes_digests,
        build_receipt_identities: record.build_receipt_identities,
        build_receipt_bytes: record
            .build_receipt_bytes
            .into_iter()
            .map(Vec::into_boxed_slice)
            .collect(),
        build_receipt_bytes_digests,
        composer_receipt_bytes_digest: canonical_blob_digest(
            b"rd.develop.composer-receipt.canonical-bytes.v2\0",
            &record.composer_receipt_bytes,
        ),
        composer_receipt_bytes: record.composer_receipt_bytes.into_boxed_slice(),
        host_receipt_bytes_digest: canonical_blob_digest(
            b"rd.develop.host-receipt.canonical-bytes.v2\0",
            &record.host_receipt_bytes,
        ),
        host_receipt_bytes: record.host_receipt_bytes.into_boxed_slice(),
    })
}

fn canonical_blob_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// Fixed-corpus dynamic acceptance adapter for the sealed read port. It exists only under the
/// repository's non-default Composer acceptance feature and supplies no runtime-selectable R&D
/// evidence authority.
#[cfg(feature = "sealed-develop-composer-acceptance")]
pub struct SealedDevelopComposerAcceptanceReadPortV2 {
    owner: crate::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2,
    store: PostgresDevelopComposerStoreV2,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl SealedDevelopComposerAcceptanceReadPortV2 {
    #[doc(hidden)]
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let rd_owner_database_url = std::env::var("RD_OWNER_TEST_DATABASE_URL")?;
        Self::connect_with_writer(&rd_owner_database_url, database_url).await
    }

    pub async fn connect_with_writer(
        rd_owner_database_url: &str,
        rd_fact_writer_database_url: &str,
    ) -> anyhow::Result<Self> {
        let owner = crate::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2::connect_with_writer(
            rd_owner_database_url,
            rd_fact_writer_database_url,
        )
        .await?;
        let store = PostgresDevelopComposerStoreV2::connect(
            rd_owner_database_url,
            rd_fact_writer_database_url,
        )
        .await?;
        Ok(Self { owner, store })
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl sealed_read_port::RdOwned for SealedDevelopComposerAcceptanceReadPortV2 {}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[async_trait]
impl DevelopComposerSealedReadPortV2 for SealedDevelopComposerAcceptanceReadPortV2 {
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
        let mut transaction = self
            .store
            .begin_read_transaction()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let readback = self
            .owner
            .read_accepted_in_transaction(&mut transaction, locator)
            .await?;
        transaction
            .commit()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        Ok(readback)
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[async_trait]
impl StrategyDesignRoleSetResolverV1 for SealedDevelopComposerAcceptanceReadPortV2 {
    async fn resolve_strategy_design_role_set_v1(
        &self,
        locator: &StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyDesignRoleSetReadbackV1, StrategyDesignRoleSetErrorV1> {
        if locator.schema_version != SEALED_READ_SCHEMA_V2
            || locator.request_identity.is_empty()
            || locator.artifact_locator.is_empty()
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidLocator);
        }
        let mut transaction = self
            .store
            .begin_read_transaction()
            .await
            .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?;
        let receipt = read_role_set_in_transaction(&mut transaction, locator).await?;
        transaction
            .commit()
            .await
            .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?;
        StrategyDesignRoleSetReadbackV1::from_fixed_resolver(locator.clone(), receipt)
    }
}

async fn read_role_set_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &StrategyDesignRoleSetLocatorV1,
) -> Result<StrategyDesignRoleSetReceiptV1, StrategyDesignRoleSetErrorV1> {
    let row = sqlx::query(
            "SELECT attestation_identity,attestation_digest,canonical_bytes
               FROM composer_owner_api.resolve_strategy_design_role_set_attestation_v1($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&locator.request_identity)
        .bind(i32::from(locator.schema_version))
        .bind(locator.operation_receipt_identity.as_bytes().as_slice())
        .bind(&locator.artifact_locator)
        .bind(locator.artifact_identity.as_bytes().as_slice())
        .bind(locator.canonical_plan_digest.as_bytes().as_slice())
        .bind(locator.design_digest.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?
        .ok_or(StrategyDesignRoleSetErrorV1::Unavailable)?;
    let attestation_identity = digest_column(&row, "attestation_identity")
        .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?;
    let attestation_digest = digest_column(&row, "attestation_digest")
        .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?;
    if attestation_identity != attestation_digest {
        return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
    }
    StrategyDesignRoleSetReceiptV1::from_durable_attestation(
        locator,
        &row.try_get::<Vec<u8>, _>("canonical_bytes")
            .map_err(|_| StrategyDesignRoleSetErrorV1::Unavailable)?,
        attestation_digest,
    )
}

async fn validate_record_role_set(
    transaction: &mut Transaction<'_, Postgres>,
    record: &StoredDevelopComposerPositiveV2,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    let response: DevelopComposerOperationResponseV2 =
        crate::strategy_plan_v2::durable_decode(&record.response_bytes)
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if response.canonical_bytes() != record.response_bytes {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let expected = project_role_set_from_record(record, &response)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let stored = read_role_set_in_transaction(transaction, &expected.composer_locator)
        .await
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;

    if stored.canonical_bytes() != expected.canonical_bytes()
        || stored.receipt_identity() != expected.receipt_identity()
        || stored.receipt_digest() != expected.receipt_digest()
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    Ok(())
}

/// Resolves one accepted Composer fact using exactly the caller's transaction and Owner-locked
/// evidence. This function opens no connection or transaction and performs no writes.
pub(crate) async fn read_accepted_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &DevelopComposerSealedReadLocatorV2,
    locked_evidence: DevelopComposerLockedEvidenceV2,
) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
    let record =
        load_record_via_sealed_routine_in_transaction(transaction, &locator.request_identity)
            .await?
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !locator_matches_record_keys(locator, &record) {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let response = resolve_positive_record_v2(&record, locked_evidence)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    seal_readback(locator, record, &response)
}

async fn load_record_via_sealed_routine_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, DevelopComposerSealedReadErrorV2> {
    verify_composer_read_authority_in_transaction(transaction).await?;
    let Some(row) = sqlx::query(
        "SELECT *
           FROM composer_owner_api.lock_accepted_develop_composer_v2($1)",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
    else {
        return Ok(None);
    };

    let record = decode_record_row(&row, request_identity)?;
    if let Some(record) = &record {
        validate_record_role_set(transaction, record).await?;
    }
    Ok(record)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn load_record_via_commit_cut_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, sqlx::Error> {
    verify_composer_commit_cut_authority_in_transaction(transaction).await?;
    let Some(row) = sqlx::query(
        "SELECT *
           FROM composer_owner_api.lock_develop_composer_commit_cut_v2($1)",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await?
    else {
        return Ok(None);
    };
    let record = decode_record_row(&row, request_identity).map_err(|_| {
        sqlx::Error::Protocol("Composer commit-cut custody is malformed".to_owned())
    })?;

    if let Some(record) = &record {
        validate_record_role_set(transaction, record)
            .await
            .map_err(|_| {
                sqlx::Error::Protocol("Composer commit-cut custody is malformed".to_owned())
            })?;
    }
    Ok(record)
}

fn decode_record_row(
    row: &sqlx::postgres::PgRow,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, DevelopComposerSealedReadErrorV2> {
    let module_ordinals: Vec<i32> = row
        .try_get("module_ordinals")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let module_bytes: Vec<Vec<u8>> = row
        .try_get("module_bytes")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    exact_ordinal_array(&module_ordinals, module_bytes.len())?;
    let build_ordinals: Vec<i32> = row
        .try_get("build_ordinals")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let build_receipt_bytes: Vec<Vec<u8>> = row
        .try_get("build_receipt_bytes")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    exact_ordinal_array(&build_ordinals, build_receipt_bytes.len())?;

    Ok(Some(StoredDevelopComposerPositiveV2 {
        request_identity: request_identity.to_owned(),
        request_digest: sealed_digest_column(row, "request_digest")?,
        research_request_identity: sealed_digest_column(row, "research_request_identity")?,
        intent_identity: sealed_digest_column(row, "intent_identity")?,
        design_identity: sealed_digest_column(row, "design_identity")?,
        plan_digest: sealed_digest_column(row, "plan_digest")?,
        artifact_identity: sealed_digest_column(row, "artifact_identity")?,
        build_attempt_identities: sealed_digest_array(row, "build_attempt_identities")?,
        capsule_identities: sealed_digest_array(row, "capsule_identities")?,
        build_receipt_identities: sealed_digest_array(row, "build_receipt_identities")?,
        design_bytes: sealed_bytes_column(row, "design_bytes")?,
        plan_bytes: sealed_bytes_column(row, "plan_bytes")?,
        artifact_package_bytes: sealed_bytes_column(row, "artifact_package_bytes")?,
        module_bytes: module_bytes
            .into_iter()
            .map(Vec::into_boxed_slice)
            .collect(),
        build_receipt_bytes,
        composer_receipt_bytes: sealed_bytes_column(row, "composer_receipt_bytes")?,
        host_receipt_bytes: sealed_bytes_column(row, "host_receipt_bytes")?,
        operation_receipt_bytes: sealed_bytes_column(row, "operation_receipt_bytes")?,
        outbox_bytes: sealed_bytes_column(row, "outbox_bytes")?,
        response_bytes: sealed_bytes_column(row, "response_bytes")?,
    }))
}

async fn verify_composer_read_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    let authority_is_exact: bool = sqlx::query_scalar(
        "WITH target AS (
           SELECT procedure.oid,
                  procedure.proowner,
                  procedure.proacl,
                  procedure.prosrc,
                  procedure.prolang,
                  procedure.prokind,
                  procedure.proretset,
                  procedure.prosecdef,
                  procedure.provolatile,
                  procedure.proparallel,
                  procedure.proisstrict,
                  procedure.proconfig,
                  namespace.oid AS namespace_oid,
                  namespace.nspowner,
                  namespace.nspacl,
                  object_owner.rolcanlogin,
                  object_owner.rolsuper,
                  object_owner.rolcreatedb,
                  object_owner.rolcreaterole,
                  object_owner.rolreplication,
                  object_owner.rolbypassrls,
                  caller.oid AS caller_oid,
                  rd_owner.oid AS rd_owner_oid,
                  fact_writer.oid AS fact_writer_oid,
                  market_reader.oid AS market_reader_oid,
                  market_owner.oid AS market_owner_oid
             FROM pg_catalog.pg_proc procedure
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid=procedure.pronamespace
              AND namespace.nspname='composer_owner_api'
             JOIN pg_catalog.pg_roles caller ON caller.rolname=current_user
             JOIN pg_catalog.pg_roles object_owner ON object_owner.oid=procedure.proowner AND object_owner.rolname='composer_owner'
             LEFT JOIN pg_catalog.pg_roles rd_owner ON rd_owner.rolname='rd_owner'
             LEFT JOIN pg_catalog.pg_roles fact_writer ON fact_writer.rolname='rd_fact_writer'
             LEFT JOIN pg_catalog.pg_roles market_reader ON market_reader.rolname='market_data_reader'
             LEFT JOIN pg_catalog.pg_roles market_owner ON market_owner.rolname='market_data_owner'
            WHERE procedure.oid=pg_catalog.to_regprocedure($1)
              AND procedure.proname='lock_accepted_develop_composer_v2'
         ), required(table_name) AS (
           VALUES
             ('rd_develop_designs_v2'),
             ('rd_develop_plans_v2'),
             ('rd_develop_artifacts_v2'),
             ('rd_develop_artifact_modules_v2'),
             ('rd_develop_build_receipts_v2'),
             ('rd_develop_artifact_build_receipt_uses_v2'),
             ('rd_develop_composer_receipts_v2'),
             ('rd_develop_host_receipts_v2'),
             ('rd_develop_operations_v2'),
             ('rd_develop_strategy_design_role_set_attestations_v1'),
             ('rd_develop_strategy_design_native_joins_v1'),
             ('rd_develop_outbox_v2')
         ), relations AS (
           SELECT relation.oid, relation.relowner, relation.relacl, relation.relpersistence, target.proowner
             FROM required
             CROSS JOIN target
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.nspname='composer_private'
             JOIN pg_catalog.pg_class relation
               ON relation.relnamespace=namespace.oid
              AND relation.relname=required.table_name
              AND relation.relkind IN ('r','p')
         )
         SELECT count(*)=12
            AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
            AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname='rd_owner' OR member.rolname='rd_owner')
            AND (
              SELECT count(*)=2
                 AND bool_and(procedure.oid IN (
                   pg_catalog.to_regprocedure($1),
                   pg_catalog.to_regprocedure($3)
                 ))
                 AND bool_and((
                   SELECT count(*)=CASE procedure.proname WHEN 'commit_develop_composer_v2' THEN 3 ELSE 2 END
                      AND count(*) FILTER (
                        WHERE acl.grantee=procedure.proowner
                          AND acl.privilege_type='EXECUTE'
                      )=1
                      AND count(*) FILTER (
                        WHERE acl.grantee=(
                          SELECT oid FROM pg_catalog.pg_roles
                           WHERE rolname='rd_fact_writer'
                        )
                          AND acl.privilege_type='EXECUTE'
                          AND NOT acl.is_grantable
                      )=CASE procedure.proname
                          WHEN 'commit_develop_composer_v2' THEN 1 ELSE 0 END
                      AND count(*) FILTER (
                        WHERE acl.grantee=(
                          SELECT oid FROM pg_catalog.pg_roles
                           WHERE rolname='rd_owner'
                        )
                          AND acl.privilege_type='EXECUTE'
                          AND NOT acl.is_grantable
                      )=1
                      AND count(*) FILTER (WHERE acl.grantee=0)=0
                      AND count(*) FILTER (
                        WHERE acl.privilege_type<>'EXECUTE'
                           OR acl.grantee NOT IN (
                             procedure.proowner,
                             (SELECT oid FROM pg_catalog.pg_roles
                               WHERE rolname='rd_owner'),
                             (SELECT oid FROM pg_catalog.pg_roles
                               WHERE rolname='rd_fact_writer')
                           )
                           OR (acl.grantee<>procedure.proowner AND acl.is_grantable)
                      )=0
                     FROM pg_catalog.aclexplode(COALESCE(
                            procedure.proacl,
                            pg_catalog.acldefault('f',procedure.proowner)
                          )) acl
                 ))
               FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid=procedure.pronamespace
               WHERE namespace.nspname='composer_owner_api'
                 AND procedure.proname IN ('lock_accepted_develop_composer_v2','commit_develop_composer_v2')
            )
            AND bool_and(relpersistence='p' AND relowner=relations.proowner)
            AND NOT bool_or(EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                       relacl,
                       pg_catalog.acldefault('r', relowner)
                     )) acl
               WHERE acl.grantee<>relowner
            ))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=relations.oid AND NOT trigger_fact.tgisinternal))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy WHERE policy.polrelid=relations.oid))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=relations.oid AND rewrite.rulename<>'_RETURN'))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance WHERE inheritance.inhrelid=relations.oid OR inheritance.inhparent=relations.oid))
            AND (SELECT nspowner=proowner FROM target)
            AND (SELECT prosrc=$2
                   AND prolang=(
                     SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql'
                   )
                   AND prokind='f'
                   AND proretset
                   AND prosecdef
                   AND provolatile='v'
                   AND proparallel='u'
                   AND proisstrict
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                   AND NOT rolreplication AND NOT rolbypassrls
                   AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
                   AND (
                     caller_oid=proowner
                     OR (
                       caller_oid=rd_owner_oid
                       AND NOT pg_catalog.pg_has_role(caller_oid, proowner, 'MEMBER')
                       AND NOT pg_catalog.pg_has_role(proowner, caller_oid, 'MEMBER')
                       AND pg_catalog.has_schema_privilege(caller_oid, namespace_oid, 'USAGE')
                       AND pg_catalog.has_function_privilege(caller_oid, oid, 'EXECUTE')
                     )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                             proacl,
                             pg_catalog.acldefault('f', proowner)
                            )) acl
                      WHERE acl.privilege_type<>'EXECUTE'
                         OR acl.grantee NOT IN (proowner, rd_owner_oid)
                         OR (acl.grantee=rd_owner_oid AND acl.is_grantable)
                   )
                   AND NOT EXISTS (
                     SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                             nspacl,
                             pg_catalog.acldefault('n', nspowner)
                            )) acl
                      WHERE acl.privilege_type NOT IN ('USAGE','CREATE')
                         OR (acl.grantee NOT IN (nspowner, rd_owner_oid, fact_writer_oid)
                             AND acl.grantee IS DISTINCT FROM market_reader_oid
                             AND acl.grantee IS DISTINCT FROM market_owner_oid)
                         OR ((acl.grantee IN (rd_owner_oid,fact_writer_oid)
                              OR acl.grantee IS NOT DISTINCT FROM market_reader_oid
                              OR acl.grantee IS NOT DISTINCT FROM market_owner_oid)
                             AND (acl.privilege_type<>'USAGE' OR acl.is_grantable))
                   )
                 FROM target)
            AND NOT bool_or(
              (SELECT caller_oid<>proowner FROM target)
              AND pg_catalog.has_table_privilege(
                (SELECT caller_oid FROM target),
                relations.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
            )
           FROM relations",
    )
    .bind(SEALED_READ_FUNCTION_V2)
    .bind(SEALED_READ_FUNCTION_SOURCE_V2)
    .bind(COMMIT_FUNCTION_V2)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !authority_is_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let column_shape = sqlx::query_scalar::<_, String>("SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||attribute.attnotnull||':'||COALESCE(pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),'') FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=relation.oid AND default_fact.adnum=attribute.attnum WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1) ORDER BY relation.relname,attribute.attnum")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_all(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let expected_column_shape = [
        "rd_develop_artifact_build_receipt_uses_v2:1:artifact_identity:bytea:true:",
        "rd_develop_artifact_build_receipt_uses_v2:2:ordinal:integer:true:",
        "rd_develop_artifact_build_receipt_uses_v2:3:receipt_identity:bytea:true:",
        "rd_develop_artifact_modules_v2:1:artifact_identity:bytea:true:",
        "rd_develop_artifact_modules_v2:2:ordinal:integer:true:",
        "rd_develop_artifact_modules_v2:3:module_bytes:bytea:true:",
        "rd_develop_artifacts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_artifacts_v2:2:plan_digest:bytea:true:",
        "rd_develop_artifacts_v2:3:package_bytes:bytea:true:",
        "rd_develop_build_receipts_v2:1:receipt_identity:bytea:true:",
        "rd_develop_build_receipts_v2:2:build_attempt_identity:bytea:true:",
        "rd_develop_build_receipts_v2:3:capsule_identity:bytea:true:",
        "rd_develop_build_receipts_v2:4:canonical_bytes:bytea:true:",
        "rd_develop_composer_receipts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_composer_receipts_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_designs_v2:1:design_identity:bytea:true:",
        "rd_develop_designs_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_host_receipts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_host_receipts_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_operations_v2:1:request_identity:text:true:",
        "rd_develop_operations_v2:2:request_digest:bytea:true:",
        "rd_develop_operations_v2:3:research_request_identity:bytea:true:",
        "rd_develop_operations_v2:4:intent_identity:bytea:true:",
        "rd_develop_operations_v2:5:artifact_identity:bytea:true:",
        "rd_develop_operations_v2:6:canonical_receipt_bytes:bytea:true:",
        "rd_develop_operations_v2:7:response_bytes:bytea:true:",
        "rd_develop_outbox_v2:1:request_identity:text:true:",
        "rd_develop_outbox_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_plans_v2:1:plan_digest:bytea:true:",
        "rd_develop_plans_v2:2:design_identity:bytea:true:",
        "rd_develop_plans_v2:3:canonical_bytes:bytea:true:",
        "rd_develop_strategy_design_native_joins_v1:1:request_identity:text:true:",
        "rd_develop_strategy_design_native_joins_v1:2:native_join_digest:bytea:true:",
        "rd_develop_strategy_design_native_joins_v1:3:projection_receipt_digest:bytea:true:",
        "rd_develop_strategy_design_native_joins_v1:4:joined_cut_digest:bytea:true:",
        "rd_develop_strategy_design_native_joins_v1:5:schedule_dependency_set_digest:bytea:true:",
        "rd_develop_strategy_design_native_joins_v1:6:canonical_bytes:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:1:request_identity:text:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:2:composer_schema_version:integer:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:3:operation_receipt_identity:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:4:artifact_locator:text:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:5:artifact_identity:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:6:canonical_plan_digest:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:7:design_digest:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:8:attestation_identity:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:9:attestation_digest:bytea:true:",
        "rd_develop_strategy_design_role_set_attestations_v1:10:canonical_bytes:bytea:true:",
    ];

    if column_shape
        .iter()
        .map(String::as_str)
        .ne(expected_column_shape)
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let dependency_shape_is_exact: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1)) SELECT (SELECT count(*)=28 AND NOT bool_or((family.relname,constraint_fact.contype::text,pg_catalog.array_to_string(constraint_fact.conkey,' ')) NOT IN (VALUES ('rd_develop_designs_v2','p','1'),('rd_develop_plans_v2','p','1'),('rd_develop_plans_v2','u','2'),('rd_develop_artifacts_v2','p','1'),('rd_develop_artifacts_v2','u','2'),('rd_develop_artifact_modules_v2','p','1 2'),('rd_develop_build_receipts_v2','p','1'),('rd_develop_build_receipts_v2','u','2'),('rd_develop_build_receipts_v2','u','3'),('rd_develop_artifact_build_receipt_uses_v2','p','1 2'),('rd_develop_artifact_build_receipt_uses_v2','u','1 3'),('rd_develop_composer_receipts_v2','p','1'),('rd_develop_host_receipts_v2','p','1'),('rd_develop_operations_v2','p','1'),('rd_develop_operations_v2','u','3'),('rd_develop_operations_v2','u','4'),('rd_develop_operations_v2','u','5'),('rd_develop_strategy_design_role_set_attestations_v1','p','1'),('rd_develop_strategy_design_role_set_attestations_v1','u','3'),('rd_develop_strategy_design_role_set_attestations_v1','u','5'),('rd_develop_strategy_design_role_set_attestations_v1','u','6'),('rd_develop_strategy_design_role_set_attestations_v1','u','8'),('rd_develop_strategy_design_role_set_attestations_v1','u','9'),('rd_develop_strategy_design_role_set_attestations_v1','u','1 2 3 4 5 6 7'),('rd_develop_strategy_design_native_joins_v1','p','1'),('rd_develop_strategy_design_native_joins_v1','u','2'),('rd_develop_strategy_design_native_joins_v1','u','3'),('rd_develop_outbox_v2','p','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family ON family.oid=constraint_fact.conrelid WHERE constraint_fact.contype IN ('p','u')) AND (SELECT count(*)=11 AND NOT bool_or((source.relname,pg_catalog.array_to_string(constraint_fact.conkey,' '),target.relname,pg_catalog.array_to_string(constraint_fact.confkey,' ')) NOT IN (VALUES ('rd_develop_plans_v2','2','rd_develop_designs_v2','1'),('rd_develop_artifacts_v2','2','rd_develop_plans_v2','1'),('rd_develop_artifact_modules_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_artifact_build_receipt_uses_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_artifact_build_receipt_uses_v2','3','rd_develop_build_receipts_v2','1'),('rd_develop_composer_receipts_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_host_receipts_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_operations_v2','5','rd_develop_artifacts_v2','1'),('rd_develop_strategy_design_role_set_attestations_v1','1','rd_develop_operations_v2','1'),('rd_develop_strategy_design_native_joins_v1','1','rd_develop_operations_v2','1'),('rd_develop_outbox_v2','1','rd_develop_operations_v2','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family source ON source.oid=constraint_fact.conrelid JOIN family target ON target.oid=constraint_fact.confrelid WHERE constraint_fact.contype='f') AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid IN (SELECT oid FROM family) AND constraint_fact.contype NOT IN ('p','u','f')) AND (SELECT count(*)=28 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint inbound WHERE inbound.confrelid IN (SELECT oid FROM family) AND inbound.conrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint outbound WHERE outbound.conrelid IN (SELECT oid FROM family) AND outbound.contype='f' AND outbound.confrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family) AND rewrite.rulename='_RETURN')")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !dependency_shape_is_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let constraint_options_are_exact: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1) AND (NOT constraint_fact.convalidated OR constraint_fact.condeferrable OR constraint_fact.condeferred OR constraint_fact.connoinherit<>(constraint_fact.contype IN ('p','u','f')) OR (constraint_fact.contype='f' AND (constraint_fact.confupdtype<>'a' OR constraint_fact.confdeltype<>'a' OR constraint_fact.confmatchtype<>'s'))))")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !constraint_options_are_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let index_options_are_exact: bool = sqlx::query_scalar("SELECT count(*)=28 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.relpersistence='p' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner)='composer_owner' AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation)) FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1)")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !index_options_are_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let locator_functions_are_exact: bool = sqlx::query_scalar(
        "WITH required(signature,source) AS (VALUES ($1::text,$2::text),($3::text,$4::text)),
         protected_relations AS (
           SELECT relation.relname,relation.oid
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
           WHERE namespace.nspname='composer_private'
             AND relation.relname IN (
               'rd_develop_strategy_design_role_set_attestations_v1',
               'rd_develop_strategy_design_native_joins_v1'
             )
             AND relation.relkind IN ('r','p')
         ),
         routines AS (
           SELECT procedure.*,required.source
           FROM required
           JOIN pg_catalog.pg_proc procedure ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
         )
         SELECT (SELECT count(*)=$5 FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='composer_owner_api')
            AND (SELECT count(*)=2 FROM protected_relations)
            AND count(*)=2
            AND bool_and(pg_catalog.pg_get_userbyid(proowner)='composer_owner' AND prosrc=source AND prokind='f' AND proretset AND prosecdef AND proisstrict AND provolatile='s' AND proparallel='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[])
            AND bool_and(pg_catalog.has_function_privilege('rd_owner',oid,'EXECUTE')=(oid=pg_catalog.to_regprocedure($1)))
            AND bool_and(pg_catalog.has_function_privilege('market_data_reader',oid,'EXECUTE'))
            AND bool_and(NOT pg_catalog.has_function_privilege('rd_fact_writer',oid,'EXECUTE'))
            AND bool_and((SELECT count(*)=CASE WHEN routines.oid=pg_catalog.to_regprocedure($1) THEN 3 ELSE 2 END
                AND count(*) FILTER (WHERE acl.grantee=routines.proowner AND acl.privilege_type='EXECUTE')=1
                AND count(*) FILTER (WHERE role.rolname='market_data_reader' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=1
                AND count(*) FILTER (WHERE role.rolname='rd_owner' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=CASE WHEN routines.oid=pg_catalog.to_regprocedure($1) THEN 1 ELSE 0 END
                AND count(*) FILTER (WHERE acl.grantee=0 OR acl.privilege_type<>'EXECUTE'
                    OR (acl.grantee<>routines.proowner AND (acl.is_grantable
                        OR NOT (role.rolname='market_data_reader' OR (role.rolname='rd_owner' AND routines.oid=pg_catalog.to_regprocedure($1))))))=0
                FROM pg_catalog.aclexplode(COALESCE(routines.proacl,pg_catalog.acldefault('f',routines.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee))
            AND bool_and(NOT pg_catalog.has_table_privilege('rd_owner',(SELECT oid FROM protected_relations WHERE relname='rd_develop_strategy_design_role_set_attestations_v1'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
            AND bool_and(NOT pg_catalog.has_table_privilege('rd_owner',(SELECT oid FROM protected_relations WHERE relname='rd_develop_strategy_design_native_joins_v1'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
         FROM routines",
    )
    .bind(ROLE_SET_READ_FUNCTION_V1)
    .bind(ROLE_SET_READ_FUNCTION_SOURCE_V1)
    .bind(NATIVE_JOIN_READ_FUNCTION_V1)
    .bind(NATIVE_JOIN_READ_FUNCTION_SOURCE_V1)
    .bind(COMPOSER_OWNER_API_FUNCTION_COUNT_V2)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !locator_functions_are_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    Ok(())
}

async fn verify_composer_commit_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "SELECT SESSION_USER IN ('rd_fact_writer','rd_owner')
            AND pg_catalog.pg_get_userbyid(procedure.proowner)='composer_owner'
            AND language.lanname='plpgsql' AND procedure.prokind='f'
            AND NOT procedure.proretset AND procedure.prosecdef AND procedure.proisstrict
            AND procedure.provolatile='v' AND procedure.proparallel='u'
            AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
            AND procedure.prosrc=$2
            AND pg_catalog.strpos(procedure.prosrc,'vibe.sealed_acceptance.composer_fail_after')=0
            AND pg_catalog.strpos(procedure.prosrc,'Sealed Composer acceptance fault')=0
            AND (
              SELECT count(*)=3
                 AND count(*) FILTER (
                   WHERE acl.grantee=procedure.proowner
                     AND acl.privilege_type='EXECUTE'
                 )=1
                 AND count(*) FILTER (
                   WHERE acl.grantee=(
                     SELECT oid FROM pg_catalog.pg_roles
                      WHERE rolname='rd_owner'
                   )
                     AND acl.privilege_type='EXECUTE'
                     AND NOT acl.is_grantable
                 )=1
                 AND count(*) FILTER (
                   WHERE acl.grantee=(
                     SELECT oid FROM pg_catalog.pg_roles
                      WHERE rolname='rd_fact_writer'
                   )
                     AND acl.privilege_type='EXECUTE'
                     AND NOT acl.is_grantable
                 )=1
                 AND count(*) FILTER (WHERE acl.grantee=0)=0
                 AND count(*) FILTER (
                   WHERE acl.privilege_type<>'EXECUTE'
                      OR acl.grantee NOT IN (
                        procedure.proowner,
                        (SELECT oid FROM pg_catalog.pg_roles
                          WHERE rolname='rd_owner'),
                        (SELECT oid FROM pg_catalog.pg_roles
                          WHERE rolname='rd_fact_writer')
                      )
                      OR (acl.grantee<>procedure.proowner AND acl.is_grantable)
                 )=0
                FROM pg_catalog.aclexplode(COALESCE(
                       procedure.proacl,
                       pg_catalog.acldefault('f',procedure.proowner)
                     )) acl
            )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(COMMIT_FUNCTION_V2)
    .bind(COMMIT_FUNCTION_SOURCE_V2)
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer commit authority is unavailable".to_owned(),
        ))
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn verify_composer_acceptance_commit_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "SELECT SESSION_USER='rd_owner'
            AND CURRENT_USER='rd_owner'
            AND pg_catalog.pg_get_userbyid(procedure.proowner)='composer_owner'
            AND language.lanname='plpgsql' AND procedure.prokind='f'
            AND NOT procedure.proretset AND procedure.prosecdef AND procedure.proisstrict
            AND procedure.provolatile='v' AND procedure.proparallel='u'
            AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
            AND procedure.prosrc=$2
            AND pg_catalog.strpos(procedure.prosrc,'vibe.sealed_acceptance.composer_fail_after')>0
            AND (
              SELECT count(*)=2
                 AND count(*) FILTER (
                   WHERE acl.grantee=procedure.proowner
                     AND acl.privilege_type='EXECUTE'
                 )=1
                 AND count(*) FILTER (
                   WHERE acl.grantee=(
                     SELECT oid FROM pg_catalog.pg_roles
                      WHERE rolname='rd_owner'
                   )
                     AND acl.privilege_type='EXECUTE'
                     AND NOT acl.is_grantable
                 )=1
                 AND count(*) FILTER (WHERE acl.grantee=0)=0
                 AND count(*) FILTER (
                   WHERE acl.privilege_type<>'EXECUTE'
                      OR acl.grantee NOT IN (
                        procedure.proowner,
                        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rd_owner')
                      )
                      OR (acl.grantee<>procedure.proowner AND acl.is_grantable)
                 )=0
                FROM pg_catalog.aclexplode(COALESCE(
                       procedure.proacl,
                       pg_catalog.acldefault('f',procedure.proowner)
                     )) acl
            )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(ACCEPTANCE_COMMIT_FUNCTION_V2)
    .bind(ACCEPTANCE_COMMIT_FUNCTION_SOURCE_V2)
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer acceptance commit authority is unavailable".to_owned(),
        ))
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn verify_composer_commit_cut_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "SELECT SESSION_USER='rd_owner'
            AND CURRENT_USER='rd_owner'
            AND pg_catalog.pg_get_userbyid(procedure.proowner)='composer_owner'
            AND language.lanname='plpgsql'
            AND procedure.prokind='f'
            AND procedure.proretset
            AND procedure.prosecdef
            AND procedure.proisstrict
            AND procedure.provolatile='v'
            AND procedure.proparallel='u'
            AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
            AND procedure.prosrc=$2
            AND NOT pg_catalog.pg_has_role('rd_owner','composer_owner','MEMBER')
            AND NOT pg_catalog.pg_has_role('composer_owner','rd_owner','MEMBER')
            AND pg_catalog.has_schema_privilege('rd_owner',namespace.oid,'USAGE')
            AND pg_catalog.has_function_privilege('rd_owner',procedure.oid,'EXECUTE')
            AND NOT pg_catalog.has_function_privilege('rd_fact_writer',procedure.oid,'EXECUTE')
            AND NOT pg_catalog.has_function_privilege('market_data_reader',procedure.oid,'EXECUTE')
            AND (
              SELECT count(*)=2
                 AND count(*) FILTER (WHERE acl.grantee=procedure.proowner AND acl.privilege_type='EXECUTE')=1
                 AND count(*) FILTER (WHERE role.rolname='rd_owner' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=1
                 AND count(*) FILTER (WHERE acl.grantee=0 OR acl.privilege_type<>'EXECUTE' OR (acl.grantee<>procedure.proowner AND (role.rolname<>'rd_owner' OR acl.is_grantable)))=0
                FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
                LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.pg_class relation
                JOIN pg_catalog.pg_namespace private_namespace ON private_namespace.oid=relation.relnamespace
               WHERE private_namespace.nspname='composer_private'
                 AND relation.relname=ANY($3)
                 AND pg_catalog.has_table_privilege('rd_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(COMMIT_CUT_FUNCTION_V2)
    .bind(COMMIT_CUT_FUNCTION_SOURCE_V2)
    .bind(COMPOSER_TABLES_V2.as_slice())
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer request-scoped commit-cut authority is unavailable".to_owned(),
        ))
    }
}

async fn verify_composer_writer_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "WITH writer AS (
           SELECT role.oid,
                  role.rolcanlogin,
                  role.rolinherit,
                  role.rolsuper,
                  role.rolcreatedb,
                  role.rolcreaterole,
                  role.rolreplication,
                  role.rolbypassrls
             FROM pg_catalog.pg_roles role
            WHERE role.rolname='rd_fact_writer'
         ), private_relations AS (
           SELECT relation.oid
             FROM pg_catalog.pg_class relation
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid=relation.relnamespace
              AND namespace.nspname='composer_private'
            WHERE relation.relname=ANY($1)
              AND relation.relkind IN ('r','p')
         ), private_columns AS (
           SELECT relation.oid AS relation_oid, attribute.attnum
             FROM private_relations relation
             JOIN pg_catalog.pg_attribute attribute
               ON attribute.attrelid=relation.oid
              AND attribute.attnum>0
              AND NOT attribute.attisdropped
         )
         SELECT SESSION_USER='rd_fact_writer'
            AND CURRENT_USER='rd_fact_writer'
            AND (SELECT rolcanlogin AND rolinherit
                        AND NOT rolsuper
                        AND NOT rolcreatedb
                        AND NOT rolcreaterole
                        AND NOT rolreplication
                        AND NOT rolbypassrls
                   FROM writer)
            AND NOT EXISTS (
              SELECT 1
                FROM writer
                JOIN pg_catalog.pg_auth_members membership
                  ON membership.member=writer.oid
                  OR membership.roleid=writer.oid
            )
            AND (SELECT count(*)=cardinality($1) FROM private_relations)
            AND NOT EXISTS (
              SELECT 1
                FROM writer
                CROSS JOIN private_relations relation
               WHERE pg_catalog.has_table_privilege(
                 writer.oid,
                 relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               )
            )
            AND NOT EXISTS (
              SELECT 1
                FROM writer
                CROSS JOIN private_columns column_fact
               WHERE pg_catalog.has_column_privilege(
                 writer.oid,
                 column_fact.relation_oid,
                 column_fact.attnum,
                 'SELECT,INSERT,UPDATE,REFERENCES'
               )
            )
            AND (SELECT pg_catalog.has_schema_privilege(
                          writer.oid,
                          private_namespace.oid,
                          'USAGE'
                        ) IS FALSE
                        AND pg_catalog.has_schema_privilege(
                          writer.oid,
                          private_namespace.oid,
                          'CREATE'
                        ) IS FALSE
                   FROM writer
                   JOIN pg_catalog.pg_namespace private_namespace
                     ON private_namespace.nspname='composer_private')
            AND (SELECT pg_catalog.has_schema_privilege(
                          writer.oid,
                          api_namespace.oid,
                          'USAGE'
                        )
                        AND pg_catalog.has_schema_privilege(
                          writer.oid,
                          api_namespace.oid,
                          'CREATE'
                        ) IS FALSE
                   FROM writer
                   JOIN pg_catalog.pg_namespace api_namespace
                     ON api_namespace.nspname='composer_owner_api')
            AND (SELECT pg_catalog.has_database_privilege(
                          writer.oid,
                          database.oid,
                          'CONNECT'
                        )
                        AND pg_catalog.has_database_privilege(
                          writer.oid,
                          database.oid,
                          'CREATE'
                        ) IS FALSE
                        AND pg_catalog.has_database_privilege(
                          writer.oid,
                          database.oid,
                          'TEMPORARY'
                        ) IS FALSE
                   FROM writer
                   JOIN pg_catalog.pg_database database
                     ON database.datname=pg_catalog.current_database())
            AND (SELECT count(*)=1
                        AND bool_and(procedure.oid=pg_catalog.to_regprocedure($2))
                   FROM writer
                   JOIN pg_catalog.pg_proc procedure
                     ON pg_catalog.has_function_privilege(writer.oid,procedure.oid,'EXECUTE')
                   JOIN pg_catalog.pg_namespace namespace
                     ON namespace.oid=procedure.pronamespace
                    AND namespace.nspname='composer_owner_api')",
    )
    .bind(COMPOSER_TABLES_V2.as_slice())
    .bind(COMMIT_FUNCTION_V2)
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer writer authority is unavailable".to_owned(),
        ))
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn verify_rd_owner_composer_writer_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "WITH caller AS (
           SELECT role.oid,role.rolcanlogin,role.rolinherit,role.rolsuper,role.rolcreatedb,
                  role.rolcreaterole,role.rolreplication,role.rolbypassrls
             FROM pg_catalog.pg_roles role
            WHERE role.rolname='rd_owner'
         ), private_relations AS (
           SELECT relation.oid
             FROM pg_catalog.pg_class relation
             JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
            WHERE namespace.nspname='composer_private'
              AND relation.relname=ANY($1)
              AND relation.relkind IN ('r','p')
         )
         SELECT SESSION_USER='rd_owner' AND CURRENT_USER='rd_owner'
            AND (SELECT rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb
                        AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls FROM caller)
            AND NOT EXISTS (SELECT 1 FROM caller JOIN pg_catalog.pg_auth_members membership ON membership.member=caller.oid OR membership.roleid=caller.oid)
            AND (SELECT count(*)=cardinality($1) FROM private_relations)
            AND NOT EXISTS (
              SELECT 1 FROM caller CROSS JOIN private_relations relation
               WHERE pg_catalog.has_table_privilege(caller.oid,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            )
            AND pg_catalog.has_function_privilege('rd_owner',$2,'EXECUTE')",
    )
    .bind(COMPOSER_TABLES_V2.as_slice())
    .bind(COMMIT_FUNCTION_V2)
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "R&D Owner Composer write authority is unavailable".to_owned(),
        ))
    }
}

fn exact_ordinal_array(
    ordinals: &[i32],
    values_len: usize,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    if ordinals.len() != values_len
        || ordinals
            .iter()
            .enumerate()
            .any(|(expected, actual)| usize::try_from(*actual).ok() != Some(expected))
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    Ok(())
}

fn sealed_digest_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, DevelopComposerSealedReadErrorV2> {
    let bytes = sealed_bytes_column(row, name)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn sealed_digest_array(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<Vec<BindingDigest>, DevelopComposerSealedReadErrorV2> {
    row.try_get::<Vec<Vec<u8>>, _>(name)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
        .into_iter()
        .map(|bytes| {
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
            Ok(BindingDigest::from_untrusted_bytes(bytes))
        })
        .collect()
}

fn sealed_bytes_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<Vec<u8>, DevelopComposerSealedReadErrorV2> {
    row.try_get(name)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)
}

async fn verify_pool_role(pool: &PgPool, expected_role: &str) -> Result<(), sqlx::Error> {
    let role_is_exact: bool = sqlx::query_scalar("SELECT SESSION_USER=$1 AND CURRENT_USER=$1")
        .bind(expected_role)
        .fetch_one(pool)
        .await?;

    if role_is_exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(format!(
            "Composer {expected_role} connection role is unavailable"
        )))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ComposerDatabaseFingerprintV2 {
    system_identifier: String,
    timeline_id: i64,
    postmaster_started_at_epoch: String,
    database_name: String,
    database_oid: i64,
}

async fn database_fingerprint(pool: &PgPool) -> Result<ComposerDatabaseFingerprintV2, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let (fingerprint, is_primary) = transaction_database_fingerprint(&mut transaction).await?;
    transaction.rollback().await?;

    if is_primary {
        Ok(fingerprint)
    } else {
        Err(sqlx::Error::Protocol(
            "Composer connection does not target a writable primary".to_owned(),
        ))
    }
}

async fn transaction_database_fingerprint(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(ComposerDatabaseFingerprintV2, bool), sqlx::Error> {
    let (
        system_identifier,
        timeline_id,
        postmaster_started_at_epoch,
        database_name,
        database_oid,
        is_primary,
    ): (String, i64, String, String, i64, bool) = sqlx::query_as(
        "SELECT (pg_catalog.pg_control_system()).system_identifier::text, checkpoint.timeline_id::bigint, pg_catalog.date_part('epoch',pg_catalog.pg_postmaster_start_time())::text, pg_catalog.current_database()::text, database.oid::bigint, NOT pg_catalog.pg_is_in_recovery() FROM pg_catalog.pg_database AS database CROSS JOIN LATERAL pg_catalog.pg_control_checkpoint() AS checkpoint WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(&mut **transaction)
    .await?;
    Ok((
        ComposerDatabaseFingerprintV2 {
            system_identifier,
            timeline_id,
            postmaster_started_at_epoch,
            database_name,
            database_oid,
        },
        is_primary,
    ))
}

async fn verify_transaction_database(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &ComposerDatabaseFingerprintV2,
) -> Result<(), sqlx::Error> {
    let (actual, is_primary) = transaction_database_fingerprint(transaction).await?;

    if is_primary && actual == *expected {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer connection physical database changed after startup".to_owned(),
        ))
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn transaction_identity(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT pg_catalog.pg_current_xact_id()::text")
        .fetch_one(&mut **transaction)
        .await
}

async fn verify_same_live_primary(
    read_pool: &PgPool,
    mutation_pool: &PgPool,
) -> Result<ComposerDatabaseFingerprintV2, sqlx::Error> {
    static PROBE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let mut read_transaction = read_pool.begin().await?;
    let (read_identity, read_is_primary) =
        transaction_database_fingerprint(&mut read_transaction).await?;
    let mut mutation_transaction = mutation_pool.begin().await?;
    let (mutation_identity, mutation_is_primary) =
        transaction_database_fingerprint(&mut mutation_transaction).await?;
    if !read_is_primary || !mutation_is_primary || read_identity != mutation_identity {
        mutation_transaction.rollback().await?;
        read_transaction.rollback().await?;
        return Err(sqlx::Error::Protocol(
            "Composer read and mutation connections do not target the same live primary".to_owned(),
        ));
    }

    let sequence = PROBE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| {
        sqlx::Error::Protocol("Composer primary probe clock is unavailable".to_owned())
    })?;
    let mut hasher = Sha256::new();
    hasher.update(b"rd.develop.same-live-primary.probe.v2\0");
    hasher.update(std::process::id().to_be_bytes());
    hasher.update(now.as_nanos().to_be_bytes());
    hasher.update(sequence.to_be_bytes());
    let probe_key = i64::from_be_bytes(hasher.finalize()[..8].try_into().map_err(|_| {
        sqlx::Error::Protocol("Composer primary probe identity is unavailable".to_owned())
    })?);
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock($1)")
        .bind(probe_key)
        .execute(&mut *read_transaction)
        .await?;
    let mutation_acquired: bool =
        sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_xact_lock($1)")
            .bind(probe_key)
            .fetch_one(&mut *mutation_transaction)
            .await?;
    mutation_transaction.rollback().await?;
    read_transaction.rollback().await?;

    if mutation_acquired {
        Err(sqlx::Error::Protocol(
            "Composer read and mutation connections do not share one lock manager".to_owned(),
        ))
    } else {
        Ok(read_identity)
    }
}

#[derive(Clone)]
pub struct PostgresDevelopComposerStoreV2 {
    read_pool: PgPool,
    mutation_pool: PgPool,
    database_fingerprint: ComposerDatabaseFingerprintV2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) enum PreparedDevelopComposerRunInTransactionV2 {
    Complete(DevelopComposerOperationResponseV2),
    Prepared(PreparedPostgresDevelopComposerRunV2),
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) struct PreparedPostgresDevelopComposerRunV2 {
    database_fingerprint: ComposerDatabaseFingerprintV2,
    transaction_identity: String,
    request_identity: String,
    request_digest: BindingDigest,
    a0: PreparedDevelopComposerA0V2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl PreparedPostgresDevelopComposerRunV2 {
    fn design_identity(&self) -> BindingDigest {
        self.a0.design_identity()
    }
}

impl PostgresDevelopComposerStoreV2 {
    /// Materializes the complete public Composer family before its atomic custody cutover.
    pub async fn materialize_schema(database_url: &str) -> Result<(), sqlx::Error> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(database_url)
            .await?;

        if !crate::schema_materialization::pre_cutover_materialization_is_admitted(&pool).await? {
            return Self::migrate(&pool).await;
        }

        for (relation_name, statement) in [
            (
                "rd_develop_designs_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_designs_v2 (design_identity BYTEA PRIMARY KEY, canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_plans_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_plans_v2 (plan_digest BYTEA PRIMARY KEY, design_identity BYTEA NOT NULL UNIQUE REFERENCES public.rd_develop_designs_v2(design_identity), canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_artifacts_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_artifacts_v2 (artifact_identity BYTEA PRIMARY KEY, plan_digest BYTEA NOT NULL UNIQUE REFERENCES public.rd_develop_plans_v2(plan_digest), package_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_artifact_modules_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_artifact_modules_v2 (artifact_identity BYTEA NOT NULL REFERENCES public.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, module_bytes BYTEA NOT NULL, PRIMARY KEY (artifact_identity, ordinal))",
            ),
            (
                "rd_develop_build_receipts_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_build_receipts_v2 (receipt_identity BYTEA PRIMARY KEY, build_attempt_identity BYTEA NOT NULL UNIQUE, capsule_identity BYTEA NOT NULL UNIQUE, canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_artifact_build_receipt_uses_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_artifact_build_receipt_uses_v2 (artifact_identity BYTEA NOT NULL REFERENCES public.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, receipt_identity BYTEA NOT NULL REFERENCES public.rd_develop_build_receipts_v2(receipt_identity), PRIMARY KEY (artifact_identity, ordinal), UNIQUE (artifact_identity, receipt_identity))",
            ),
            (
                "rd_develop_composer_receipts_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_composer_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES public.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_host_receipts_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_host_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES public.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_operations_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_operations_v2 (request_identity TEXT PRIMARY KEY, request_digest BYTEA NOT NULL, research_request_identity BYTEA NOT NULL UNIQUE, intent_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL UNIQUE REFERENCES public.rd_develop_artifacts_v2(artifact_identity), canonical_receipt_bytes BYTEA NOT NULL, response_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_strategy_design_role_set_attestations_v1",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_strategy_design_role_set_attestations_v1 (request_identity TEXT PRIMARY KEY REFERENCES public.rd_develop_operations_v2(request_identity), composer_schema_version INTEGER NOT NULL, operation_receipt_identity BYTEA NOT NULL UNIQUE, artifact_locator TEXT NOT NULL, artifact_identity BYTEA NOT NULL UNIQUE, canonical_plan_digest BYTEA NOT NULL UNIQUE, design_digest BYTEA NOT NULL, attestation_identity BYTEA NOT NULL UNIQUE, attestation_digest BYTEA NOT NULL UNIQUE, canonical_bytes BYTEA NOT NULL, UNIQUE (request_identity, composer_schema_version, operation_receipt_identity, artifact_locator, artifact_identity, canonical_plan_digest, design_digest))",
            ),
            (
                "rd_develop_strategy_design_native_joins_v1",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_strategy_design_native_joins_v1 (request_identity TEXT PRIMARY KEY REFERENCES public.rd_develop_operations_v2(request_identity), native_join_digest BYTEA NOT NULL UNIQUE, projection_receipt_digest BYTEA NOT NULL UNIQUE, joined_cut_digest BYTEA NOT NULL, schedule_dependency_set_digest BYTEA NOT NULL, canonical_bytes BYTEA NOT NULL)",
            ),
            (
                "rd_develop_outbox_v2",
                "CREATE TABLE IF NOT EXISTS public.rd_develop_outbox_v2 (request_identity TEXT PRIMARY KEY REFERENCES public.rd_develop_operations_v2(request_identity), canonical_bytes BYTEA NOT NULL)",
            ),
        ] {
            crate::schema_materialization::materialize_public_table(
                &pool,
                relation_name,
                statement,
            )
            .await?;
        }
        crate::schema_materialization::verify_materialized_public_tables(
            &pool,
            COMPOSER_PUBLIC_TABLE_SPECS_V2,
        )
        .await
    }

    pub async fn connect(
        rd_owner_database_url: &str,
        rd_fact_writer_database_url: &str,
    ) -> Result<Self, sqlx::Error> {
        let read_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(rd_owner_database_url)
            .await?;
        verify_pool_role(&read_pool, "rd_owner").await?;

        let mutation_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(rd_fact_writer_database_url)
            .await?;
        verify_pool_role(&mutation_pool, "rd_fact_writer").await?;
        let database_fingerprint = verify_same_live_primary(&read_pool, &mutation_pool).await?;

        Self::migrate(&read_pool).await?;
        let mut transaction = mutation_pool.begin().await?;
        verify_transaction_database(&mut transaction, &database_fingerprint).await?;
        verify_composer_writer_authority_in_transaction(&mut transaction).await?;
        verify_composer_commit_authority_in_transaction(&mut transaction).await?;
        transaction.rollback().await?;

        Ok(Self {
            read_pool,
            mutation_pool,
            database_fingerprint,
        })
    }

    pub(crate) async fn begin_read_transaction(
        &self,
    ) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
        let mut transaction = self.read_pool.begin().await?;
        verify_transaction_database(&mut transaction, &self.database_fingerprint).await?;
        Ok(transaction)
    }

    async fn begin_mutation_transaction(&self) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
        let mut transaction = self.mutation_pool.begin().await?;
        verify_transaction_database(&mut transaction, &self.database_fingerprint).await?;
        Ok(transaction)
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[doc(hidden)]
    pub async fn reconnect_mutation_pool_for_acceptance(
        &mut self,
        database_url: &str,
    ) -> Result<(), sqlx::Error> {
        self.mutation_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(database_url)
            .await?;
        let transaction = self.begin_mutation_transaction().await?;
        transaction.rollback().await
    }

    pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
        let database_fingerprint = database_fingerprint(pool).await?;
        let mut transaction = pool.begin().await?;
        verify_transaction_database(&mut transaction, &database_fingerprint).await?;
        verify_composer_read_authority_in_transaction(&mut transaction)
            .await
            .map_err(|_| {
                sqlx::Error::Protocol("Composer authority topology is unavailable".to_owned())
            })?;
        transaction.rollback().await
    }

    pub async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        Ok(unavailable_response(
            request_identity,
            "current Owner evidence is unavailable for public durable RESOLVE",
        ))
    }

    /// Reads only the immutable identities needed to re-establish final Owner evidence.
    ///
    /// The returned value contains no caller-supplied Research locator. A composition root must
    /// match it against canonical Research Owner custody before calling durable `RESOLVE`.
    pub(crate) async fn durable_evidence_locator(
        &self,
        request_identity: &str,
    ) -> Result<Option<DevelopComposerDurableEvidenceLocatorV2>, sqlx::Error> {
        load_record(self, request_identity).await.map(|record| {
            record
                .as_ref()
                .map(DevelopComposerDurableEvidenceLocatorV2::from_record)
        })
    }

    pub(crate) async fn resolve_with_evidence(
        &self,
        request_identity: &str,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let record = match load_record(self, request_identity).await {
            Ok(Some(record)) => record,
            Ok(None) => {
                return Ok(unavailable_response(
                    request_identity,
                    "terminal is unavailable",
                ));
            }
            Err(e) if is_record_integrity_error(&e) => {
                return Ok(unavailable_response(
                    request_identity,
                    "stored terminal custody is incomplete or malformed",
                ));
            }
            Err(e) => return Err(e),
        };
        Ok(resolve_loaded_record_with_evidence(
            &record,
            evidence,
            read_cut_epoch_ms,
        ))
    }

    pub(crate) async fn resolve_with_native_join(
        &self,
        request_identity: &str,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        read_cut_epoch_ms: u64,
        native_join: &AuthenticatedComposerNativeJoinV1,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let record = match load_record(self, request_identity).await {
            Ok(Some(record)) => record,
            Ok(None) => {
                return Ok(unavailable_response(
                    request_identity,
                    "terminal is unavailable",
                ));
            }
            Err(e) if is_record_integrity_error(&e) => {
                return Ok(unavailable_response(
                    request_identity,
                    "stored terminal custody is incomplete or malformed",
                ));
            }
            Err(e) => return Err(e),
        };
        let response = resolve_loaded_record_with_evidence(&record, evidence, read_cut_epoch_ms);
        if response.disposition != DevelopComposerOperationDispositionV2::Success {
            return Ok(response);
        }
        let role_set = project_role_set_from_record(&record, &response)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        let expected = StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, native_join)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if !native_join_matches_owner_port(self, &role_set.composer_locator, &expected).await? {
            return Ok(unavailable_response(
                request_identity,
                "stored native join custody is absent, mismatched, or malformed",
            ));
        }
        Ok(response)
    }

    pub(crate) async fn run(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_with_fault(builder, evidence, request, read_cut_epoch_ms, None)
            .await
    }

    /// Runs one Composer decision entirely inside the caller-owned R&D transaction.
    ///
    /// The caller owns commit/rollback. This path never checks out the fact-writer pool and uses
    /// only the request-scoped sealed aggregate lock before the final positive commit.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn run_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_in_transaction_with_fault_for_test(
            transaction,
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            None,
        )
        .await
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn run_in_transaction_with_fault_for_test(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        fail_after_boundary: Option<usize>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        match self
            .prepare_run_in_transaction(transaction, builder, evidence, request, read_cut_epoch_ms)
            .await?
        {
            PreparedDevelopComposerRunInTransactionV2::Complete(response) => Ok(response),
            PreparedDevelopComposerRunInTransactionV2::Prepared(prepared) => {
                let final_locked = match evidence.lock_and_reread(
                    request,
                    prepared.design_identity(),
                    read_cut_epoch_ms,
                ) {
                    Ok(locked) => locked,
                    Err(terminal) => return Ok(terminal_response(request, terminal)),
                };
                self.commit_prepared_run_in_transaction_with_fault_for_test(
                    transaction,
                    request,
                    prepared,
                    final_locked,
                    fail_after_boundary.and_then(|index| {
                        DevelopComposerAcceptanceWriteBoundaryV2::ALL
                            .get(index)
                            .copied()
                    }),
                )
                .await
            }
        }
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn prepare_run_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<PreparedDevelopComposerRunInTransactionV2, sqlx::Error> {
        verify_transaction_database(transaction, &self.database_fingerprint).await?;
        let prepared_transaction_identity = transaction_identity(transaction).await?;
        acquire_advisory_locks(transaction, &[request_lock_key(&request.request_identity)]).await?;
        let existing =
            match load_record_via_commit_cut_in_transaction(transaction, &request.request_identity)
                .await
            {
                Ok(existing) => existing,
                Err(e) if is_record_integrity_error(&e) => {
                    return Ok(PreparedDevelopComposerRunInTransactionV2::Complete(
                        unavailable_response(
                            &request.request_identity,
                            "stored terminal custody is incomplete or malformed",
                        ),
                    ));
                }
                Err(e) => return Err(e),
            };

        if let Some(existing) = existing {
            return Ok(PreparedDevelopComposerRunInTransactionV2::Complete(
                if existing.request_digest == request_digest(request) {
                    evidence
                        .lock_and_reread(request, existing.design_identity, read_cut_epoch_ms)
                        .and_then(|current| resolve_positive_record_v2(&existing, current))
                        .unwrap_or_else(|terminal| terminal_response(request, terminal))
                } else {
                    DevelopComposerOperationResponseV2 {
                        schema_version: 2,
                        request_identity: request.request_identity.clone(),
                        disposition: DevelopComposerOperationDispositionV2::Conflict,
                        receipt_identity: None,
                        artifact: None,
                        coordinate: Some("request_identity".to_owned()),
                        reason: Some(
                            "identity is already bound to different canonical meaning".to_owned(),
                        ),
                    }
                },
            ));
        }

        let preflight = match preflight_develop_composer_v2(evidence, request, read_cut_epoch_ms) {
            Ok(preflight) => preflight,
            Err(terminal) => {
                return Ok(PreparedDevelopComposerRunInTransactionV2::Complete(
                    terminal_response(request, terminal),
                ));
            }
        };
        acquire_advisory_locks(transaction, &preflight_lock_keys(&preflight)).await?;
        let a0 = match prepare_develop_composer_a0_v2(builder, request, preflight) {
            Ok(prepared) => prepared,
            Err(terminal) => {
                return Ok(PreparedDevelopComposerRunInTransactionV2::Complete(
                    terminal_response(request, terminal),
                ));
            }
        };
        Ok(PreparedDevelopComposerRunInTransactionV2::Prepared(
            PreparedPostgresDevelopComposerRunV2 {
                database_fingerprint: self.database_fingerprint.clone(),
                transaction_identity: prepared_transaction_identity,
                request_identity: request.request_identity.clone(),
                request_digest: request_digest(request),
                a0,
            },
        ))
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn commit_prepared_run_in_transaction(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        prepared: PreparedPostgresDevelopComposerRunV2,
        final_locked: DevelopComposerLockedEvidenceV2,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.commit_prepared_run_in_transaction_with_fault_for_test(
            transaction,
            request,
            prepared,
            final_locked,
            None,
        )
        .await
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn commit_prepared_run_in_transaction_with_acceptance_boundary(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        prepared: PreparedPostgresDevelopComposerRunV2,
        final_locked: DevelopComposerLockedEvidenceV2,
        boundary: DevelopComposerAcceptanceWriteBoundaryV2,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.commit_prepared_run_in_transaction_with_fault_for_test(
            transaction,
            request,
            prepared,
            final_locked,
            Some(boundary),
        )
        .await
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    async fn commit_prepared_run_in_transaction_with_fault_for_test(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        prepared: PreparedPostgresDevelopComposerRunV2,
        final_locked: DevelopComposerLockedEvidenceV2,
        fail_after_boundary: Option<DevelopComposerAcceptanceWriteBoundaryV2>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        verify_transaction_database(transaction, &self.database_fingerprint).await?;
        let current_transaction_identity = transaction_identity(transaction).await?;
        if prepared.database_fingerprint != self.database_fingerprint
            || prepared.transaction_identity != current_transaction_identity
            || prepared.request_identity != request.request_identity
            || prepared.request_digest != request_digest(request)
        {
            return Err(sqlx::Error::Protocol(
                "prepared Composer A0 state does not bind this transaction and request".to_owned(),
            ));
        }
        let (record, current) =
            match finish_positive_record_from_prepared_a0_v2(request, prepared.a0, final_locked) {
                Ok(record) => record,
                Err(terminal) => return Ok(terminal_response(request, terminal)),
            };
        acquire_advisory_locks(transaction, &postbuild_lock_keys(&record)).await?;
        let response =
            resolve_positive_record_v2(&record, current.clone()).map_err(|terminal| {
                sqlx::Error::Protocol(format!(
                    "fresh Composer record failed readback: {}",
                    terminal.reason
                ))
            })?;
        let role_set = project_role_set_from_record(&record, &response)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if let Err(e) = persist_record(
            transaction,
            &self.database_fingerprint,
            &record,
            &role_set,
            None,
            current.bindings.clone(),
            fail_after_boundary,
        )
        .await
        {
            if e.as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                return Ok(conflict_response(
                    &request.request_identity,
                    "operation.semantic_identity",
                ));
            }
            return Err(e);
        }
        Ok(response)
    }

    pub(crate) async fn run_with_native_join(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        native_join: &AuthenticatedComposerNativeJoinV1,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_inner(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            None,
            Some(native_join),
        )
        .await
    }

    async fn run_with_fault(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        fail_after_boundary: Option<DevelopComposerFaultBoundaryV2>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_inner(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            fail_after_boundary,
            None,
        )
        .await
    }

    async fn run_inner(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        fail_after_boundary: Option<DevelopComposerFaultBoundaryV2>,
        native_join: Option<&AuthenticatedComposerNativeJoinV1>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let existing = match load_record(self, &request.request_identity).await {
            Ok(existing) => existing,
            Err(sqlx::Error::Protocol(message))
                if message == SEALED_READ_UNAVAILABLE_PROTOCOL_V2 =>
            {
                return Ok(unavailable_response(
                    &request.request_identity,
                    SEALED_READ_UNAVAILABLE_PROTOCOL_V2,
                ));
            }
            Err(e) if is_record_integrity_error(&e) => {
                return Ok(unavailable_response(
                    &request.request_identity,
                    "stored terminal custody is incomplete or malformed",
                ));
            }
            Err(e) => return Err(e),
        };

        if let Some(existing) = existing {
            let mut response = if existing.request_digest == request_digest(request) {
                evidence
                    .lock_and_reread(request, existing.design_identity, read_cut_epoch_ms)
                    .and_then(|current| resolve_positive_record_v2(&existing, current))
                    .unwrap_or_else(|terminal| terminal_response(request, terminal))
            } else {
                DevelopComposerOperationResponseV2 {
                    schema_version: 2,
                    request_identity: request.request_identity.clone(),
                    disposition: DevelopComposerOperationDispositionV2::Conflict,
                    receipt_identity: None,
                    artifact: None,
                    coordinate: Some("request_identity".to_owned()),
                    reason: Some(
                        "identity is already bound to different canonical meaning".to_owned(),
                    ),
                }
            };

            if response.disposition == DevelopComposerOperationDispositionV2::Success
                && let Some(native_join) = native_join
            {
                let role_set = project_role_set_from_record(&existing, &response)
                    .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
                let expected =
                    StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, native_join)
                        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
                if !native_join_matches_owner_port(self, &role_set.composer_locator, &expected)
                    .await?
                {
                    response = unavailable_response(
                        &request.request_identity,
                        "stored native join custody is absent, mismatched, or malformed",
                    );
                }
            }
            return Ok(response);
        }
        let mut transaction = self.begin_mutation_transaction().await?;
        acquire_advisory_locks(
            &mut transaction,
            &[request_lock_key(&request.request_identity)],
        )
        .await?;
        let preflight = match preflight_develop_composer_v2(evidence, request, read_cut_epoch_ms) {
            Ok(preflight) => preflight,
            Err(terminal) => {
                transaction.rollback().await?;
                return Ok(terminal_response(request, terminal));
            }
        };
        acquire_advisory_locks(&mut transaction, &preflight_lock_keys(&preflight)).await?;
        let (record, current) = match build_positive_record_from_preflight_v2(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            preflight,
        ) {
            Ok(record) => record,
            Err(terminal) => {
                transaction.rollback().await?;
                return Ok(terminal_response(request, terminal));
            }
        };
        acquire_advisory_locks(&mut transaction, &postbuild_lock_keys(&record)).await?;

        let response = match resolve_positive_record_v2(&record, current.clone()) {
            Ok(response) => response,
            Err(terminal) => {
                transaction.rollback().await?;
                return Err(sqlx::Error::Protocol(format!(
                    "fresh Composer record failed readback: {}",
                    terminal.reason
                )));
            }
        };
        let role_set = project_role_set_from_record(&record, &response)
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        let native_join_receipt = native_join
            .map(|native_join| {
                StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, native_join)
            })
            .transpose()
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        if let Err(e) = persist_record(
            &mut transaction,
            &self.database_fingerprint,
            &record,
            &role_set,
            native_join_receipt.as_ref(),
            current.bindings.clone(),
            fail_after_boundary,
        )
        .await
        {
            let unique_violation = e
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation());
            transaction.rollback().await?;

            if unique_violation {
                return Ok(conflict_response(
                    &request.request_identity,
                    "operation.semantic_identity",
                ));
            }
            return Err(e);
        }

        match transaction.commit().await {
            Ok(()) => Ok(response),
            Err(_) => Ok(DevelopComposerOperationResponseV2::submitted_or_unknown(
                &request.request_identity,
            )),
        }
    }
}

pub(crate) fn resolve_loaded_record_with_evidence(
    record: &StoredDevelopComposerPositiveV2,
    evidence: &impl DevelopComposerFinalEvidencePortV2,
    read_cut_epoch_ms: u64,
) -> DevelopComposerOperationResponseV2 {
    evidence
        .lock_and_reread_durable(
            &DevelopComposerDurableEvidenceLocatorV2::from_record(record),
            read_cut_epoch_ms,
        )
        .and_then(|current| resolve_positive_record_v2(record, current))
        .unwrap_or_else(|terminal| DevelopComposerOperationResponseV2 {
            schema_version: 2,
            request_identity: record.request_identity.clone(),
            disposition: DevelopComposerOperationDispositionV2::Unavailable,
            receipt_identity: None,
            artifact: None,
            coordinate: Some(terminal.coordinate),
            reason: Some(terminal.reason),
        })
}

async fn acquire_advisory_locks(
    transaction: &mut Transaction<'_, Postgres>,
    keys: &[String],
) -> Result<(), sqlx::Error> {
    let keys = keys.iter().collect::<BTreeSet<_>>();
    for key in keys {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(key)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

fn preflight_lock_keys(preflight: &DevelopComposerPreflightV2) -> Vec<String> {
    let mut keys = vec![
        lock_key(
            "10:rd.develop.research.v2",
            preflight.research_request_identity,
        ),
        lock_key("20:rd.develop.intent.v2", preflight.intent_identity),
        lock_key("30:rd.develop.design.v2", preflight.design_identity),
    ];
    keys.extend(
        preflight
            .build_attempt_identities
            .iter()
            .map(|identity| lock_key("40:rd.develop.build-attempt.v2", *identity)),
    );
    keys.extend(
        preflight
            .capsule_identities
            .iter()
            .map(|identity| lock_key("50:rd.develop.capsule.v2", *identity)),
    );
    keys.sort();
    keys
}

fn postbuild_lock_keys(record: &StoredDevelopComposerPositiveV2) -> Vec<String> {
    let mut keys = vec![lock_key(
        "60:rd.develop.artifact.v2",
        record.artifact_identity,
    )];
    keys.extend(
        record
            .build_receipt_identities
            .iter()
            .map(|identity| lock_key("70:rd.develop.build-receipt.v2", *identity)),
    );
    keys.sort();
    keys
}

fn lock_key(domain: &str, identity: BindingDigest) -> String {
    let suffix = identity
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{domain}:{suffix}")
}

fn request_lock_key(request_identity: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"rd.develop.request-lock.identity.v2\0");
    hasher.update(request_identity.as_bytes());
    lock_key(
        "00:rd.develop.request.v2",
        BindingDigest::from_untrusted_bytes(hasher.finalize().into()),
    )
}

fn terminal_response(
    request: &DevelopComposerRunRequestV2,
    terminal: crate::develop_composer_v2::DevelopComposerTerminalV2,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request.request_identity.clone(),
        disposition: match terminal.kind {
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Conflict => {
                DevelopComposerOperationDispositionV2::Conflict
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unsupported => {
                DevelopComposerOperationDispositionV2::Unsupported
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::NeedsResearchRefinement => {
                DevelopComposerOperationDispositionV2::NeedsResearchRefinement
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable => {
                DevelopComposerOperationDispositionV2::Unavailable
            }
        },
        receipt_identity: None,
        artifact: None,
        coordinate: Some(terminal.coordinate),
        reason: Some(terminal.reason),
    }
}

async fn native_join_matches_owner_port(
    store: &PostgresDevelopComposerStoreV2,
    locator: &StrategyDesignRoleSetLocatorV1,
    expected: &StrategyDesignNativeJoinReceiptV1,
) -> Result<bool, sqlx::Error> {
    let mut transaction = store.begin_read_transaction().await?;
    let row = sqlx::query(
        "SELECT native_join_digest,projection_receipt_digest,joined_cut_digest,schedule_dependency_set_digest,canonical_bytes
           FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&locator.request_identity)
    .bind(i32::from(locator.schema_version))
    .bind(locator.operation_receipt_identity.as_bytes().as_slice())
    .bind(&locator.artifact_locator)
    .bind(locator.artifact_identity.as_bytes().as_slice())
    .bind(locator.canonical_plan_digest.as_bytes().as_slice())
    .bind(locator.design_digest.as_bytes().as_slice())
    .fetch_optional(&mut *transaction)
    .await?;
    let matches = if let Some(row) = row {
        let digest = composer_native_join_digest_column(&row, "native_join_digest")?;
        let projection = composer_native_join_digest_column(&row, "projection_receipt_digest")?;
        let joined_cut = composer_native_join_digest_column(&row, "joined_cut_digest")?;
        let schedule = composer_native_join_digest_column(&row, "schedule_dependency_set_digest")?;
        let canonical_bytes: Vec<u8> = row.try_get("canonical_bytes")?;
        StrategyDesignNativeJoinReceiptV1::from_durable_attestation(
            locator,
            &canonical_bytes,
            digest,
        )
        .is_ok_and(|decoded| {
            decoded == *expected
                && projection == expected.projection_receipt_digest()
                && joined_cut == expected.joined_cut_digest()
                && schedule == expected.schedule_dependency_set_digest()
        })
    } else {
        false
    };
    transaction.commit().await?;
    Ok(matches)
}

fn composer_native_join_digest_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, sqlx::Error> {
    let bytes: Vec<u8> = row.try_get(name)?;
    let exact: [u8; 32] = bytes
        .try_into()
        .map_err(|_| sqlx::Error::Protocol(format!("Composer native join {name} is malformed")))?;
    Ok(BindingDigest::from_untrusted_bytes(exact))
}

async fn persist_record(
    transaction: &mut Transaction<'_, Postgres>,
    database_fingerprint: &ComposerDatabaseFingerprintV2,
    record: &StoredDevelopComposerPositiveV2,
    role_set: &StrategyDesignRoleSetReceiptV1,
    native_join: Option<&StrategyDesignNativeJoinReceiptV1>,
    current_bindings: crate::strategy_plan_v2::VerifiedStrategyInputBindingsV2,
    #[cfg(feature = "sealed-source-intake-composer-acceptance")] fail_after_boundary: Option<
        DevelopComposerAcceptanceWriteBoundaryV2,
    >,
    #[cfg(not(feature = "sealed-source-intake-composer-acceptance"))] fail_after_boundary: Option<
        usize,
    >,
) -> Result<(), sqlx::Error> {
    verify_transaction_database(transaction, database_fingerprint).await?;
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    {
        let session_user: String = sqlx::query_scalar("SELECT SESSION_USER")
            .fetch_one(&mut **transaction)
            .await?;

        if session_user == "rd_owner" {
            verify_rd_owner_composer_writer_authority_in_transaction(transaction).await?;
        } else {
            verify_composer_writer_authority_in_transaction(transaction).await?;
        }
    }
    #[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
    verify_composer_writer_authority_in_transaction(transaction).await?;
    verify_composer_commit_authority_in_transaction(transaction).await?;
    let plan = crate::strategy_plan_v2::StrategyPlanV2::parse_and_revalidate_durable(
        &record.plan_bytes,
        current_bindings,
    )
    .map_err(sqlx::Error::Protocol)?;
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    if let Some(boundary) = fail_after_boundary {
        verify_composer_acceptance_commit_authority_in_transaction(transaction).await?;
        sqlx::query("SELECT pg_catalog.set_config($1,$2,true)")
            .bind(SEALED_COMPOSER_FAIL_AFTER_GUC_V2)
            .bind(boundary.as_str())
            .execute(&mut **transaction)
            .await?;
    }
    #[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
    debug_assert!(fail_after_boundary.is_none());
    let module_bytes = record
        .module_bytes
        .iter()
        .map(|bytes| bytes.to_vec())
        .collect::<Vec<_>>();
    let receipt_identities = record
        .build_receipt_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let attempt_identities = record
        .build_attempt_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let capsule_identities = record
        .capsule_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let (
        native_join_digest,
        projection_receipt_digest,
        joined_cut_digest,
        schedule_digest,
        native_bytes,
    ) = native_join.map_or_else(
        || {
            (
                vec![0; 32],
                vec![0; 32],
                vec![0; 32],
                vec![0; 32],
                Vec::new(),
            )
        },
        |receipt| {
            (
                receipt.receipt_digest().as_bytes().to_vec(),
                receipt.projection_receipt_digest().as_bytes().to_vec(),
                receipt.joined_cut_digest().as_bytes().to_vec(),
                receipt.schedule_dependency_set_digest().as_bytes().to_vec(),
                receipt.canonical_bytes().to_vec(),
            )
        },
    );
    let commit_query = sqlx::query_scalar(composer_commit_query_v2(fail_after_boundary));
    let committed: bool = commit_query
        .bind(&record.request_identity)
        .bind(record.request_digest.as_bytes().as_slice())
        .bind(record.research_request_identity.as_bytes().as_slice())
        .bind(record.intent_identity.as_bytes().as_slice())
        .bind(record.artifact_identity.as_bytes().as_slice())
        .bind(plan.design_identity().as_bytes().as_slice())
        .bind(plan.canonical_plan_digest().as_bytes().as_slice())
        .bind(&record.design_bytes)
        .bind(&record.plan_bytes)
        .bind(&record.artifact_package_bytes)
        .bind(&module_bytes)
        .bind(&receipt_identities)
        .bind(&attempt_identities)
        .bind(&capsule_identities)
        .bind(&record.build_receipt_bytes)
        .bind(&record.composer_receipt_bytes)
        .bind(&record.host_receipt_bytes)
        .bind(&record.operation_receipt_bytes)
        .bind(&record.response_bytes)
        .bind(&record.outbox_bytes)
        .bind(i32::from(role_set.composer_locator.schema_version))
        .bind(role_set.operation_receipt_identity.as_bytes().as_slice())
        .bind(&role_set.composer_locator.artifact_locator)
        .bind(role_set.design_digest.as_bytes().as_slice())
        .bind(role_set.receipt_identity().as_bytes().as_slice())
        .bind(role_set.receipt_digest().as_bytes().as_slice())
        .bind(role_set.canonical_bytes())
        .bind(&native_join_digest)
        .bind(&projection_receipt_digest)
        .bind(&joined_cut_digest)
        .bind(&schedule_digest)
        .bind(&native_bytes)
        .fetch_one(&mut **transaction)
        .await?;

    if committed {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer owner rejected commit envelope".to_owned(),
        ))
    }
}

async fn load_record(
    store: &PostgresDevelopComposerStoreV2,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, sqlx::Error> {
    let mut transaction = store.begin_read_transaction().await?;
    let record = load_record_in_transaction(&mut transaction, request_identity).await?;
    transaction.commit().await?;
    Ok(record)
}

async fn load_record_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, sqlx::Error> {
    load_record_via_sealed_routine_in_transaction(transaction, request_identity)
        .await
        .map_err(|_| sqlx::Error::Protocol(SEALED_READ_UNAVAILABLE_PROTOCOL_V2.to_owned()))
}

fn exact_ordinal(row: &sqlx::postgres::PgRow, expected: usize) -> Result<(), sqlx::Error> {
    let expected = i32::try_from(expected)
        .map_err(|_| sqlx::Error::Protocol("Composer ordinal overflow".to_owned()))?;
    let actual = row.try_get::<i32, _>("ordinal")?;
    if actual != expected {
        return Err(sqlx::Error::Protocol(format!(
            "Composer ordinal mismatch: expected {expected}, found {actual}"
        )));
    }
    Ok(())
}

fn digest_column(row: &sqlx::postgres::PgRow, name: &str) -> Result<BindingDigest, sqlx::Error> {
    let bytes: Vec<u8> = row.try_get(name)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| sqlx::Error::Protocol(format!("{name} is not an exact 32-byte digest")))?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn unavailable_response(
    request_identity: &str,
    reason: &str,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request_identity.to_owned(),
        disposition: DevelopComposerOperationDispositionV2::Unavailable,
        receipt_identity: None,
        artifact: None,
        coordinate: Some("operation".to_owned()),
        reason: Some(reason.to_owned()),
    }
}

fn is_record_integrity_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::RowNotFound => true,
        sqlx::Error::Protocol(message) => {
            message == SEALED_READ_UNAVAILABLE_PROTOCOL_V2
                || message.starts_with("Composer ordinal mismatch:")
                || message.ends_with(" is not an exact 32-byte digest")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use sha2::{Digest, Sha256};
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    fn sha256_hex(value: &str) -> String {
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }

    #[rstest]
    fn sealed_read_failure_is_typed_without_swallowing_unrelated_errors() {
        assert!(super::is_record_integrity_error(&sqlx::Error::Protocol(
            super::SEALED_READ_UNAVAILABLE_PROTOCOL_V2.to_owned()
        )));
        assert!(!super::is_record_integrity_error(&sqlx::Error::Protocol(
            "unrelated protocol failure".to_owned()
        )));
        assert!(!super::is_record_integrity_error(&sqlx::Error::PoolClosed));
    }

    #[rstest]
    fn public_materializer_covers_the_complete_composer_family() {
        assert_eq!(super::COMPOSER_TABLES_V2.len(), 12);
        assert_eq!(super::COMPOSER_PUBLIC_TABLE_SPECS_V2.len(), 12);
        assert!(super::COMPOSER_TABLES_V2.iter().all(|name| {
            super::COMPOSER_PUBLIC_TABLE_SPECS_V2
                .iter()
                .any(|spec| spec.name == *name)
        }));
        let source = include_str!("develop_composer_postgres_v2.rs");
        assert!(source.contains("pg_catalog.array_to_string(constraint_fact.conkey,' ')"));
        assert!(
            source.contains(
                "constraint_fact.connoinherit<>(constraint_fact.contype IN ('p','u','f'))"
            )
        );
    }

    #[rstest]
    fn composer_authority_requires_permanent_tables_and_indexes() {
        let source = include_str!("develop_composer_postgres_v2.rs");
        let read_authority = source
            .split("async fn verify_composer_read_authority_in_transaction")
            .nth(1)
            .expect("Composer read authority")
            .split("async fn verify_composer_commit_authority_in_transaction")
            .next()
            .expect("bounded Composer read authority");

        assert!(read_authority.contains("relation.relpersistence"));
        assert!(read_authority.contains("relpersistence='p'"));
        assert!(read_authority.contains("index_relation.relpersistence='p'"));
        assert!(read_authority.contains("market_owner_oid"));
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn composer_unlogged_drift_is_unavailable_to_migration_and_runtime() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let topology_admin_pool = database.owner_topology_admin_pool();
        super::PostgresDevelopComposerStoreV2::migrate(pool)
            .await
            .unwrap();

        sqlx::query("ALTER TABLE composer_private.rd_develop_outbox_v2 SET UNLOGGED")
            .execute(topology_admin_pool)
            .await
            .unwrap();
        assert!(
            super::PostgresDevelopComposerStoreV2::migrate(pool)
                .await
                .is_err()
        );
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            super::load_record_via_sealed_routine_in_transaction(
                &mut transaction,
                "unknown-composer-operation",
            )
            .await
            .is_err()
        );
        transaction.rollback().await.unwrap();

        sqlx::query("ALTER TABLE composer_private.rd_develop_outbox_v2 SET LOGGED")
            .execute(topology_admin_pool)
            .await
            .unwrap();
        super::PostgresDevelopComposerStoreV2::migrate(pool)
            .await
            .unwrap();
    }

    #[rstest]
    fn composer_authority_rejects_public_execute_on_commit() {
        assert_eq!(
            super::composer_commit_query_v2(None),
            super::COMMIT_QUERY_V2
        );
        assert_eq!(
            sha256_hex(super::COMMIT_FUNCTION_SOURCE_V2),
            "ed9b2945a114c2ffc846b780022fca57df6e0448076ac3520e00074597de3b38"
        );
        assert!(!super::COMMIT_FUNCTION_SOURCE_V2.contains("composer_fail_after"));
        let source = include_str!("develop_composer_postgres_v2.rs");
        let read_authority = source
            .split("async fn verify_composer_read_authority_in_transaction")
            .nth(1)
            .expect("Composer read authority")
            .split("async fn verify_composer_commit_authority_in_transaction")
            .next()
            .expect("bounded Composer read authority");
        assert!(read_authority.contains("pg_catalog.to_regprocedure($3)"));
        assert!(read_authority.contains(".bind(COMMIT_FUNCTION_V2)"));
        assert!(read_authority.contains("SELECT count(*)=2"));
        assert!(read_authority.contains("WHEN 'commit_develop_composer_v2' THEN 1 ELSE 0 END"));
        assert!(read_authority.contains("rolname='rd_owner'"));
        assert!(read_authority.contains("count(*) FILTER (WHERE acl.grantee=0)=0"));

        let commit_authority = source
            .split("async fn verify_composer_commit_authority_in_transaction")
            .nth(1)
            .expect("Composer commit authority")
            .split("fn exact_ordinal_array")
            .next()
            .expect("bounded Composer commit authority");
        assert!(commit_authority.contains("SESSION_USER IN ('rd_fact_writer','rd_owner')"));
        assert!(commit_authority.contains("SELECT count(*)=3"));
        assert!(commit_authority.contains("count(*) FILTER (WHERE acl.grantee=0)=0"));
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest::rstest]
    fn acceptance_write_boundaries_are_closed_and_in_persistence_order() {
        let migration = include_str!(
            "../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh"
        );
        let installed_source = migration
            .split_once("SET search_path = pg_catalog, pg_temp AS $composer_acceptance_commit$")
            .expect("installed Composer acceptance commit source")
            .1
            .split_once("$composer_acceptance_commit$;")
            .expect("bounded installed Composer acceptance commit source")
            .0;
        assert_eq!(
            installed_source,
            super::ACCEPTANCE_COMMIT_FUNCTION_SOURCE_V2
        );
        assert_eq!(
            super::COMMIT_FUNCTION_V2.split_once('(').unwrap().1,
            super::ACCEPTANCE_COMMIT_FUNCTION_V2
                .split_once('(')
                .unwrap()
                .1
        );
        assert_eq!(
            sha256_hex(super::ACCEPTANCE_COMMIT_FUNCTION_SOURCE_V2),
            "f5c0f1ba53d2225b40d8242a555b462fc947db250c990388fac1aee8b11d76e2"
        );
        assert_eq!(
            super::DevelopComposerAcceptanceWriteBoundaryV2::ALL.map(|value| value.as_str()),
            [
                "AfterDesign",
                "AfterPlan",
                "AfterArtifact",
                "AfterEachModule",
                "AfterEachNewIntrinsicBuildReceipt",
                "AfterEachBuildUse",
                "AfterComposerReceipt",
                "AfterHostReceipt",
                "AfterOperation",
                "AfterRoleSetAttestation",
                "AfterNativeJoin",
                "AfterOutbox",
            ]
        );
        assert_eq!(
            super::SEALED_COMPOSER_FAIL_AFTER_GUC_V2,
            "vibe.sealed_acceptance.composer_fail_after"
        );
        assert_eq!(
            super::composer_commit_query_v2(None),
            super::COMMIT_QUERY_V2
        );

        for boundary in super::DevelopComposerAcceptanceWriteBoundaryV2::ALL {
            assert_eq!(
                super::composer_commit_query_v2(Some(boundary)),
                super::ACCEPTANCE_COMMIT_QUERY_V2
            );
        }
        let rollback_only = super::ACCEPTANCE_COMMIT_FUNCTION_SOURCE_V2
            .split_once("ELSIF fail_after='AfterNativeJoin' THEN")
            .expect("rollback-only native-join branch")
            .1
            .split_once("END IF;")
            .expect("bounded rollback-only native-join branch")
            .0;
        let insert = rollback_only
            .find("INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1")
            .expect("rollback-only native-join insertion");
        let unconditional_raise = rollback_only
            .find("RAISE EXCEPTION 'Sealed Composer acceptance fault after %',fail_after;")
            .expect("unconditional rollback-only native-join raise");
        assert!(insert < unconditional_raise);
        assert!(rollback_only.contains("rollback-only.v1"));
    }
}
