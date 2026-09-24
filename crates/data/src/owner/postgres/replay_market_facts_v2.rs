//! Independent native dependency ports required before `ReplayMarketFactsV2` composition.
//!
//! No aggregate resolver or positive fallback is defined here. In particular, a sample projection
//! cannot authenticate its joined-cut or observation-census subjects.

#![allow(dead_code, reason = "W0 freezes the bounded Replay W1 dependency seam")]

use crate::owner::replay_market_facts_v2::{
    AuthenticatedComposerNativeJoinV1, ReplayCompositionBindingErrorV1,
    ReplayCompositionBindingLocatorV1, ReplayCompositionBindingReadbackV1,
    ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionIssuanceCompositionV1,
    ReplayCompositionIssuanceLocatorV1, ReplayCompositionIssuanceResponseV1,
    ReplayCompositionLocatorOnlyIssuanceRequestV1, ReplayCompositionOwnerV1,
    ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2, ReplayMarketDependencyRefV2,
    ReplayMarketFactsReadbackV2, ReplayMarketFactsShapeV2, ReplayPriceAdjustmentV2,
    ReplayReferenceFactKindV2, ReplayReferenceFactTimeV2, ReplayReferenceFactValueV2,
    ReplayTimestampBasisV2, ResolvedReplayCompositionCutV1, UntrustedComposerNativeJoinRequestV1,
    UntrustedReplayMarketFactsCompositionRequestV1, UntrustedReplayMarketFactsRequestV2,
    authority::{
        ReplayMarketFactsEvidenceV2, ReplayNativeChainEvidenceV2, ReplayReferenceFactCutProposalV2,
        ReplayReferenceFactProposalV2, ReplayReferenceFactScopeProposalV2,
        ReplayUniverseMemberFactsEvidenceV2, ReplayVerifiedNativeDerivedRecordV2,
        ReplayVerifiedNativeRecordV2, issue_universe_member_replay_market_facts_v2,
        pit_clock_digest,
    },
    composition::{
        ReplayCompositionBindingEvidenceV1, ReplayCompositionNativeLocatorKindV1,
        ReplayCompositionNativeLocatorV1, ReplayCompositionRoleEvidenceV1,
        compose_replay_market_facts_v2, issue_replay_composition_binding_v1,
        require_universe_member_binding_v1,
    },
    postgres::{
        PreparedReplayMarketFactsStorageV2, REPLAY_MARKET_RD_CUT_API_SCHEMA_V1,
        persist_replay_composition_binding_in_transaction_v1,
        persist_replay_market_facts_in_transaction_v2,
        recover_bound_replay_market_facts_for_rd_in_transaction_v2,
        recover_bound_replay_market_facts_readback_in_transaction_v2,
        recover_replay_composition_binding_for_rd_in_transaction_v1,
        recover_replay_composition_binding_in_transaction_v1,
        recover_replay_market_facts_by_binding_in_transaction_v2,
    },
};
use crate::owner::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleUnitV1,
    },
    calendar::UntrustedCalendarLocatorV1,
    corporate_action::{CorporateActionTermsV1, UntrustedCorporateActionLocatorV1},
    correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
    market_semantics::UntrustedMarketSemanticsLocatorV1,
    reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1,
    reference_fact_coordinates::r0::UntrustedReferenceFactR0LocatorV1,
    sample_projection_v4::{
        ScheduleDependencyV4, StrategyInputSampleProjectionErrorV4,
        StrategyInputSampleProjectionKindV4, UntrustedStrategyInputSampleProjectionLocatorV4,
        VerifiedV3ProjectionSourceV4, prepare_joined_cut_v4,
    },
    session::UntrustedSessionLocatorV1,
    source_binding::BindingDigest,
    strategy_design_role_intent_v1::StrategyDesignRoleIntentV1,
    strategy_design_role_set::{
        AuthenticatedStrategyDesignRoleSetV1, StrategyDesignNativeJoinReceiptV1,
        StrategyDesignRoleSetLocatorV1, StrategyDesignRoleSetReceiptV1,
        authenticate_durable_strategy_design_role_set_v1,
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputScope, request_matches_authenticated_role_v1,
    },
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinedCutReceiptV1, UntrustedStrategyInputJoinClaimV1,
    },
    time_zone::UntrustedTimeZoneLocatorV1,
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row, postgres::PgPoolOptions};
use std::sync::atomic::{AtomicU64, Ordering};

mod universe_issuance;

const REPLAY_COMPOSITION_ISSUANCE_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_issuances_v1 (request_identity BYTEA PRIMARY KEY, request_meaning_digest BYTEA NOT NULL UNIQUE, request_bytes BYTEA NOT NULL, binding_identity BYTEA NOT NULL UNIQUE, binding_digest BYTEA NOT NULL, response_bytes BYTEA NOT NULL)",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_issuances_v1 FROM PUBLIC",
];
const COMPOSER_ROLE_SET_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_NATIVE_JOIN_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_CUT_LOCK_V1: &str = "composer_owner_api.lock_replay_composition_cut_v1(text)";
/// The one R&D function this reader may execute: what R&D published about a Design, before any
/// Composer operation exists to attest it.
const RD_DESIGN_ROLE_INTENT_RESOLVER_V1: &str =
    "rd_owner_api.resolve_design_role_intent_for_market_data_v1(bytea)";
const COMPOSER_READER_ACL_QUERY_V1: &str = "WITH role_set_relation AS (
                SELECT relation.oid
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
                 WHERE namespace.nspname='composer_private'
                   AND relation.relname='rd_develop_strategy_design_role_set_attestations_v1'
             ), native_join_relation AS (
                SELECT relation.oid
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
                 WHERE namespace.nspname='composer_private'
                   AND relation.relname='rd_develop_strategy_design_native_joins_v1'
             ), design_role_intent_relation AS (
                SELECT relation.oid
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
                 WHERE namespace.nspname='public'
                   AND relation.relname='rd_design_role_intents_v1'
             ) SELECT
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','USAGE') AS schema_usage,
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','CREATE') AS schema_create,
                pg_catalog.has_schema_privilege(current_user,'composer_private','USAGE') AS private_schema_usage,
                pg_catalog.has_schema_privilege(current_user,'composer_private','CREATE') AS private_schema_create,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS function_execute,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS native_function_execute,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE') AS cut_lock_execute,
                pg_catalog.has_table_privilege(current_user,role_set_relation.oid,'SELECT') AS raw_select,
                pg_catalog.has_table_privilege(current_user,role_set_relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS raw_write,
                pg_catalog.has_table_privilege(current_user,native_join_relation.oid,'SELECT') AS native_raw_select,
                pg_catalog.has_table_privilege(current_user,native_join_relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS native_raw_write,
                pg_catalog.pg_has_role(current_user,'composer_owner','MEMBER') AS composer_owner_member,
                pg_catalog.has_schema_privilege(current_user,'rd_owner_api','USAGE') AS rd_schema_usage,
                pg_catalog.has_schema_privilege(current_user,'rd_owner_api','CREATE') AS rd_schema_create,
                pg_catalog.has_function_privilege(current_user,'rd_owner_api.resolve_design_role_intent_for_market_data_v1(bytea)','EXECUTE') AS design_role_intent_execute,
                pg_catalog.has_table_privilege(current_user,design_role_intent_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS design_role_intent_raw
           FROM role_set_relation
           CROSS JOIN native_join_relation
           CROSS JOIN design_role_intent_relation";
const RD_DESIGN_ROLE_INTENT_RESOLVE_QUERY_V1: &str = "SELECT intent_digest, canonical_bytes
       FROM rd_owner_api.resolve_design_role_intent_for_market_data_v1($1)";
const COMPOSER_ROLE_SET_RESOLVE_QUERY_V1: &str =
    "SELECT attestation_identity, attestation_digest, canonical_bytes
       FROM composer_owner_api.resolve_strategy_design_role_set_attestation_v1($1,$2,$3,$4,$5,$6,$7)";
const COMPOSER_NATIVE_JOIN_RESOLVE_QUERY_V1: &str = "SELECT native_join_digest,canonical_bytes
       FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)";
const COMPOSER_CUT_LOCK_QUERY_V1: &str =
    "SELECT composer_owner_api.lock_replay_composition_cut_v1($1)";
const COMPOSER_CUT_LOCK_SOURCE_V1: &str = "
BEGIN
  IF session_user NOT IN ('market_data_reader','market_data_owner') OR current_user<>'composer_owner' THEN
    RAISE EXCEPTION 'Replay composition cut caller mismatch' USING ERRCODE='42501';
  END IF;
  IF session_user='market_data_owner' THEN
    IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(
      pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0)
    ) THEN
      RETURN 0;
    END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(
      pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0)
    );
  END IF;
  RETURN pg_catalog.pg_backend_pid();
END
";
const MARKET_OWNER_COMPOSER_ACL_QUERY_V1: &str = "WITH raw_relation AS (
                SELECT relation.oid
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
                 WHERE namespace.nspname='composer_private'
                   AND relation.relname='rd_develop_operations_v2'
             ) SELECT
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','USAGE') AS schema_usage,
                NOT pg_catalog.has_schema_privilege(current_user,'composer_owner_api','CREATE') AS no_schema_create,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE') AS cut_lock_execute,
                NOT pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS no_role_resolve,
                NOT pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS no_native_resolve,
                NOT pg_catalog.has_schema_privilege(current_user,'composer_private','USAGE,CREATE') AS no_private_schema,
                NOT pg_catalog.has_table_privilege(current_user,raw_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_raw,
                NOT pg_catalog.has_function_privilege(current_user,'rd_owner_api.resolve_design_role_intent_for_market_data_v1(bytea)','EXECUTE') AS no_design_role_intent_resolve
           FROM raw_relation";
const V4_CUSTODY_DOMAIN: &[u8] = b"market-data.sample-projection-postgres-custody.v4\0";

struct ComposerReaderAclV1 {
    schema_usage: bool,
    schema_create: bool,
    private_schema_usage: bool,
    private_schema_create: bool,
    function_execute: bool,
    native_function_execute: bool,
    cut_lock_execute: bool,
    raw_select: bool,
    raw_write: bool,
    native_raw_select: bool,
    native_raw_write: bool,
    composer_owner_member: bool,
    rd_schema_usage: bool,
    rd_schema_create: bool,
    design_role_intent_execute: bool,
    design_role_intent_raw: bool,
}

fn composer_reader_acl_values_are_exact(
    acl: &ComposerReaderAclV1,
    expected_cut_lock_execute: bool,
) -> bool {
    acl.schema_usage
        && !acl.schema_create
        && !acl.private_schema_usage
        && !acl.private_schema_create
        && acl.function_execute
        && acl.native_function_execute
        && acl.cut_lock_execute == expected_cut_lock_execute
        && !acl.raw_select
        && !acl.raw_write
        && !acl.native_raw_select
        && !acl.native_raw_write
        && !acl.composer_owner_member
        && acl.rd_schema_usage
        && !acl.rd_schema_create
        && acl.design_role_intent_execute
        && !acl.design_role_intent_raw
}

fn composer_reader_acl_is_exact(
    row: &sqlx::postgres::PgRow,
    expected_cut_lock_execute: bool,
) -> Result<bool, sqlx::Error> {
    Ok(composer_reader_acl_values_are_exact(
        &ComposerReaderAclV1 {
            schema_usage: row.try_get("schema_usage")?,
            schema_create: row.try_get("schema_create")?,
            private_schema_usage: row.try_get("private_schema_usage")?,
            private_schema_create: row.try_get("private_schema_create")?,
            function_execute: row.try_get("function_execute")?,
            native_function_execute: row.try_get("native_function_execute")?,
            cut_lock_execute: row.try_get("cut_lock_execute")?,
            raw_select: row.try_get("raw_select")?,
            raw_write: row.try_get("raw_write")?,
            native_raw_select: row.try_get("native_raw_select")?,
            native_raw_write: row.try_get("native_raw_write")?,
            composer_owner_member: row.try_get("composer_owner_member")?,
            rd_schema_usage: row.try_get("rd_schema_usage")?,
            rd_schema_create: row.try_get("rd_schema_create")?,
            design_role_intent_execute: row.try_get("design_role_intent_execute")?,
            design_role_intent_raw: row.try_get("design_role_intent_raw")?,
        },
        expected_cut_lock_execute,
    ))
}

struct ValidatedNativeJoinV4 {
    roles: Vec<(BindingDigest, BindingDigest)>,
    dependencies: Vec<ScheduleDependencyV4>,
}

const fn map_sample_projection_v4_error(
    error: StrategyInputSampleProjectionErrorV4,
) -> ReplayCompositionBindingErrorV1 {
    match error {
        StrategyInputSampleProjectionErrorV4::StoreUnavailable
        | StrategyInputSampleProjectionErrorV4::CommitInterrupted
        | StrategyInputSampleProjectionErrorV4::ResponseLost => {
            ReplayCompositionBindingErrorV1::ReplayV2Unavailable
        }
        _ => ReplayCompositionBindingErrorV1::DependencyMismatch,
    }
}

async fn validate_native_join_v4(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    attestation: &StrategyDesignNativeJoinReceiptV1,
) -> Result<ValidatedNativeJoinV4, ReplayCompositionBindingErrorV1> {
    let expected = *attestation.projection_receipt_digest().as_bytes();
    let row = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v4($1)",
    )
    .bind(expected.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
    .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    let bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let readback: Vec<u8> = row
        .try_get("readback_bytes")
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let outbox: Vec<u8> = row
        .try_get("outbox_payload")
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let decoded = crate::owner::sample_projection_v4::decode_v4(&bytes, expected)
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if decoded.kind() != StrategyInputSampleProjectionKindV4::JoinedCut
        || decoded.component_count() != 6
        || decoded.subject_identity() != *attestation.joined_cut_receipt_digest().as_bytes()
        || decoded.schedule_dependency_set_digest()
            != *attestation.schedule_dependency_set_digest().as_bytes()
        || readback != bytes
        || outbox != bytes
        || digest_column(&row, "receipt_digest")? != attestation.projection_receipt_digest()
        || digest_column(&row, "outbox_identity")? != attestation.projection_receipt_digest()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let dependencies = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_dependencies_v4($1)",
    )
    .bind(expected.as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
    .into_iter()
    .map(|row| {
        Ok(ScheduleDependencyV4 {
            source_projection_digest: *digest_column(&row, "source_projection_digest")?.as_bytes(),
            role_identity: *digest_column(&row, "role_identity")?.as_bytes(),
            binding_receipt_digest: *digest_column(&row, "binding_receipt_digest")?.as_bytes(),
            timeframe_projection_digest: *digest_column(&row, "timeframe_projection_digest")?.as_bytes(),
            schedule_readback_identity: *digest_column(&row, "schedule_readback_identity")?.as_bytes(),
            schedule_fact_digest: *digest_column(&row, "schedule_fact_digest")?.as_bytes(),
            schedule_cut_identity: *digest_column(&row, "schedule_cut_identity")?.as_bytes(),
            schedule_cut_digest: *digest_column(&row, "schedule_cut_digest")?.as_bytes(),
            schedule_receipt_identity: *digest_column(&row, "schedule_receipt_identity")?.as_bytes(),
        })
    })
    .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;

    if dependencies.len() != 6
        || crate::owner::sample_projection_v4::schedule_set_digest(&dependencies)
            != decoded.schedule_dependency_set_digest()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }

    for (exact, dependency) in decoded.canonical_bytes()
        [crate::owner::sample_projection_v4::HEADER_LEN_V4..]
        .chunks_exact(crate::owner::sample_projection_v4::COMPONENT_LEN_V4)
        .zip(&dependencies)
    {
        let stored = super::load_strategy_input_sample_projection_v3(
            transaction,
            dependency.source_projection_digest,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let stored_dependencies = super::load_sample_projection_schedule_dependencies_v3(
            transaction,
            dependency.source_projection_digest,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::validate_sample_projection_dependencies_v3(
            transaction,
            &stored.decoded,
            &stored_dependencies,
            true,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let Some(stored_dependency) = stored_dependencies.iter().find(|stored_dependency| {
            stored_dependency.role_identity == dependency.role_identity
                && stored_dependency.binding_receipt_digest == dependency.binding_receipt_digest
        }) else {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        };

        if stored_dependency.schedule_readback_identity.as_bytes()
            != &dependency.schedule_readback_identity
            || stored_dependency.schedule_fact_digest.as_bytes() != &dependency.schedule_fact_digest
            || stored_dependency.schedule_cut_identity.as_bytes()
                != &dependency.schedule_cut_identity
            || stored_dependency.schedule_cut_digest.as_bytes() != &dependency.schedule_cut_digest
            || stored_dependency.schedule_receipt_identity.as_bytes()
                != &dependency.schedule_receipt_identity
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        let index = stored
            .decoded
            .components()
            .iter()
            .position(|component| {
                component.role_identity() == dependency.role_identity
                    && component.binding_receipt_digest() == dependency.binding_receipt_digest
                    && component.timeframe_projection_digest()
                        == dependency.timeframe_projection_digest
            })
            .ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let start = crate::owner::sample_projection_v4::V3_HEADER_LEN
            + index * crate::owner::sample_projection_v4::COMPONENT_LEN_V4;

        if stored
            .decoded
            .canonical_bytes()
            .get(start..start + crate::owner::sample_projection_v4::COMPONENT_LEN_V4)
            != Some(exact)
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
    }
    let custody = {
        let mut hasher = Sha256::new();
        hasher.update(V4_CUSTODY_DOMAIN);
        hasher.update(expected);
        hasher.update(decoded.schedule_dependency_set_digest());
        hasher.update(&bytes);
        BindingDigest::from_untrusted_bytes(hasher.finalize().into())
    };

    if digest_column(&row, "receipt_custody_digest")? != custody
        || digest_column(&row, "readback_custody_digest")? != custody
        || digest_column(&row, "outbox_custody_digest")? != custody
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let roles = dependencies
        .iter()
        .map(|dependency| {
            (
                BindingDigest::from_untrusted_bytes(dependency.role_identity),
                BindingDigest::from_untrusted_bytes(dependency.binding_receipt_digest),
            )
        })
        .collect();
    Ok(ValidatedNativeJoinV4 {
        roles,
        dependencies,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReplayFirstCorpusRoleV1 {
    MinuteOpen,
    MinuteHigh,
    MinuteLow,
    MinuteClose,
    HourClose,
    ExchangeSessionDayClose,
}

fn replay_first_corpus_coordinate_v1(
    field_semantic: MarketDataFieldSemantic,
    kind: BarScheduleKindV1,
    step: u32,
    unit: BarScheduleUnitV1,
) -> Option<ReplayFirstCorpusRoleV1> {
    match (field_semantic, kind, step, unit) {
        (
            MarketDataFieldSemantic::BarOpenPrice,
            BarScheduleKindV1::FixedInterval,
            1,
            BarScheduleUnitV1::Minute,
        ) => Some(ReplayFirstCorpusRoleV1::MinuteOpen),
        (
            MarketDataFieldSemantic::BarHighPrice,
            BarScheduleKindV1::FixedInterval,
            1,
            BarScheduleUnitV1::Minute,
        ) => Some(ReplayFirstCorpusRoleV1::MinuteHigh),
        (
            MarketDataFieldSemantic::BarLowPrice,
            BarScheduleKindV1::FixedInterval,
            1,
            BarScheduleUnitV1::Minute,
        ) => Some(ReplayFirstCorpusRoleV1::MinuteLow),
        (
            MarketDataFieldSemantic::BarClosePrice,
            BarScheduleKindV1::FixedInterval,
            1,
            BarScheduleUnitV1::Minute,
        ) => Some(ReplayFirstCorpusRoleV1::MinuteClose),
        (
            MarketDataFieldSemantic::BarClosePrice,
            BarScheduleKindV1::FixedInterval,
            1,
            BarScheduleUnitV1::Hour,
        ) => Some(ReplayFirstCorpusRoleV1::HourClose),
        (
            MarketDataFieldSemantic::BarClosePrice,
            BarScheduleKindV1::ExchangeSession,
            1,
            BarScheduleUnitV1::ExchangeSessionDay,
        ) => Some(ReplayFirstCorpusRoleV1::ExchangeSessionDayClose),
        _ => None,
    }
}

fn replay_first_corpus_schedule_v1(
    field_semantic: MarketDataFieldSemantic,
    schedule: &crate::owner::bar_schedule::BarScheduleFactV1,
    label: BarScheduleLabelV1,
    completion: BarScheduleCompletionV1,
) -> Option<ReplayFirstCorpusRoleV1> {
    (label == BarScheduleLabelV1::IntervalClose
        && completion == BarScheduleCompletionV1::CompleteOnly)
        .then(|| {
            replay_first_corpus_coordinate_v1(
                field_semantic,
                schedule.kind(),
                schedule.step(),
                schedule.unit(),
            )
        })
        .flatten()
}

fn admit_replay_first_corpus_role_v1(
    seen: &mut [bool; 6],
    corpus_role: ReplayFirstCorpusRoleV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let corpus_index = corpus_role as usize;
    if std::mem::replace(&mut seen[corpus_index], true) {
        Err(ReplayCompositionBindingErrorV1::IncompleteComposition)
    } else {
        Ok(())
    }
}

fn verify_replay_first_corpus_complete_v1(
    seen: [bool; 6],
    trigger_is_minute_close: bool,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    if seen.into_iter().all(|present| present) && trigger_is_minute_close {
        Ok(())
    } else {
        Err(ReplayCompositionBindingErrorV1::IncompleteComposition)
    }
}

#[cfg(test)]
impl ReplayCompositionOwnerV1 {
    pub(crate) fn replay_first_corpus_coordinate_for_test_v1(
        field_semantic: MarketDataFieldSemantic,
        kind: BarScheduleKindV1,
        step: u32,
        unit: BarScheduleUnitV1,
    ) -> Option<u8> {
        replay_first_corpus_coordinate_v1(field_semantic, kind, step, unit).map(|role| role as u8)
    }

    pub(crate) fn replay_first_corpus_set_for_test_v1(
        roles: &[u8],
        trigger_is_minute_close: bool,
    ) -> Result<(), ReplayCompositionBindingErrorV1> {
        let mut seen = [false; 6];

        for role in roles {
            let role = match role {
                0 => ReplayFirstCorpusRoleV1::MinuteOpen,
                1 => ReplayFirstCorpusRoleV1::MinuteHigh,
                2 => ReplayFirstCorpusRoleV1::MinuteLow,
                3 => ReplayFirstCorpusRoleV1::MinuteClose,
                4 => ReplayFirstCorpusRoleV1::HourClose,
                5 => ReplayFirstCorpusRoleV1::ExchangeSessionDayClose,
                _ => return Err(ReplayCompositionBindingErrorV1::IncompleteComposition),
            };
            admit_replay_first_corpus_role_v1(&mut seen, role)?;
        }
        verify_replay_first_corpus_complete_v1(seen, trigger_is_minute_close)
    }
}

async fn validate_replay_first_corpus_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role_set: &StrategyDesignRoleSetReceiptV1,
    claim: &UntrustedStrategyInputJoinClaimV1,
    declarations: &[super::strategy_input_binding_registry::StrategyInputBindingDeclarationReadbackV1],
    joined: &StrategyInputJoinedCutReceiptV1,
    native_join: &ValidatedNativeJoinV4,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let [join] = role_set.joins.as_slice() else {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    };

    if role_set.roles.len() != 6
        || declarations.len() != 6
        || join.roles.len() != 6
        || claim.strategy_design_identity != role_set.design_identity
        || claim.join_semantic_id != join.semantic_id
        || claim.join_identity != join.join_identity
        || claim.alignment_semantic_id != join.alignment_semantic_id
        || claim.trigger_input_id != join.trigger_input_id
        || claim.max_staleness_ns != join.max_staleness_ns
        || claim.roles.len() != join.roles.len()
        || !join
            .roles
            .iter()
            .zip(&claim.roles)
            .all(|(expected, actual)| {
                expected.semantic_id == actual.semantic_id
                    && expected.role_identity == actual.input_role_identity
            })
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }

    let mut joined_role_identities = join
        .roles
        .iter()
        .map(|role| role.role_identity)
        .collect::<Vec<_>>();
    joined_role_identities.sort_unstable();
    if joined_role_identities
        != role_set
            .roles
            .iter()
            .map(|role| role.role_identity)
            .collect::<Vec<_>>()
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }

    validate_replay_first_corpus_claim_v1(transaction, claim, declarations, joined, native_join)
        .await
}

async fn validate_replay_first_corpus_claim_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    claim: &UntrustedStrategyInputJoinClaimV1,
    declarations: &[super::strategy_input_binding_registry::StrategyInputBindingDeclarationReadbackV1],
    joined: &StrategyInputJoinedCutReceiptV1,
    native_join: &ValidatedNativeJoinV4,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    if claim.roles.len() != 6
        || declarations.len() != 6
        || joined.components().len() != 6
        || native_join.dependencies.len() != 6
        || claim.alignment_semantic_id != "strategy.input-join.latest-not-after-trigger.v1"
        || joined.strategy_design_identity() != claim.strategy_design_identity
        || joined.join_identity() != claim.join_identity
        || joined.alignment_semantic_id() != claim.alignment_semantic_id
        || joined.trigger_input_id() != claim.trigger_input_id
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }

    let mut joined_role_identities = claim
        .roles
        .iter()
        .map(|role| role.input_role_identity)
        .collect::<Vec<_>>();
    joined_role_identities.sort_unstable();
    joined_role_identities.dedup();
    if joined_role_identities.len() != 6 {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }

    let first_request = declarations
        .first()
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?
        .request();
    let UntrustedStrategyInputScope::ExactInstrument {
        instrument: common_instrument,
    } = &first_request.scope
    else {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    };
    let common_scale = first_request.scale;
    let trigger_component = joined
        .components()
        .iter()
        .filter(|component| component.role_semantic_id() == claim.trigger_input_id)
        .collect::<Vec<_>>();
    let [trigger_component] = trigger_component.as_slice() else {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    };
    let trigger_logical_time = trigger_component
        .frame()
        .trigger()
        .lifecycle()
        .logical_time();

    let mut seen = [false; 6];
    let mut minute_schedule = None;
    let mut minute_event_effective = None;
    let mut minute_observation_batch = None;
    let mut trigger_is_minute_close = false;

    for declaration in declarations {
        let request = declaration.request();
        let join_role = claim
            .roles
            .iter()
            .find(|role| role.input_role_identity == request.input_role_identity)
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;

        if request.strategy_design_identity != claim.strategy_design_identity
            || request.channel != StrategyInputChannel::Market
            || request.unit != StrategyInputUnit::Price
            || request.scale != common_scale
            || !matches!(
                &request.scope,
                UntrustedStrategyInputScope::ExactInstrument { instrument }
                    if instrument == common_instrument
            )
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        let components = joined
            .components()
            .iter()
            .filter(|component| component.role_semantic_id() == join_role.semantic_id)
            .collect::<Vec<_>>();
        let [component] = components.as_slice() else {
            return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
        };
        let [value] = component.frame().values() else {
            return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
        };

        if value.input_role_identity() != request.input_role_identity
            || component.frame().trigger().lifecycle().logical_time() > trigger_logical_time
            || component.staleness_ns()
                != trigger_logical_time - component.frame().trigger().lifecycle().logical_time()
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }

        let dependency = native_join
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.role_identity == *request.input_role_identity.as_bytes()
                    && dependency.binding_receipt_digest == *declaration.binding_digest().as_bytes()
            })
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let schedule = super::load_bar_schedule_readback(
            transaction,
            BindingDigest::from_untrusted_bytes(dependency.schedule_readback_identity),
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let schedule_fact = schedule.fact();
        let corpus_role = replay_first_corpus_schedule_v1(
            request.field_semantic,
            schedule_fact,
            schedule_fact.label(),
            schedule_fact.completion(),
        )
        .ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        if schedule_fact.canonical_instrument() != common_instrument {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        admit_replay_first_corpus_role_v1(&mut seen, corpus_role)?;

        if join_role.semantic_id == claim.trigger_input_id {
            trigger_is_minute_close = corpus_role == ReplayFirstCorpusRoleV1::MinuteClose
                && joined.trigger_digest() == component.frame().trigger().digest();
        }

        if matches!(
            corpus_role,
            ReplayFirstCorpusRoleV1::MinuteOpen
                | ReplayFirstCorpusRoleV1::MinuteHigh
                | ReplayFirstCorpusRoleV1::MinuteLow
                | ReplayFirstCorpusRoleV1::MinuteClose
        ) {
            let schedule_coordinate = (
                dependency.schedule_readback_identity,
                dependency.schedule_cut_identity,
                dependency.schedule_cut_digest,
            );

            if minute_schedule.is_some_and(|expected| expected != schedule_coordinate)
                || minute_event_effective.is_some_and(|expected| {
                    expected != component.frame().trigger().lifecycle().event_time()
                })
                || minute_observation_batch.is_some_and(|expected| {
                    expected != component.frame().trigger().observation_batch_digest()
                })
            {
                return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
            }
            minute_schedule = Some(schedule_coordinate);
            minute_event_effective = Some(component.frame().trigger().lifecycle().event_time());
            minute_observation_batch = Some(component.frame().trigger().observation_batch_digest());
        }
    }

    verify_replay_first_corpus_complete_v1(seen, trigger_is_minute_close)
}

impl ReplayCompositionOwnerV1 {
    /// Materializes Market Data storage before authority custody is cut over.
    ///
    /// # Errors
    ///
    /// Returns an unavailable error when the fixed store cannot be opened or materialized.
    pub async fn materialize_schema(
        database_url: &str,
    ) -> Result<(), ReplayCompositionBindingErrorV1> {
        let owner = super::MarketDataOwnerPostgres::connect(database_url)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;

        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::calendar::install_calendar_schema_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::time_zone::install_time_zone_schema_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::session::install_session_schema_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::reference_fact_catalog::install_reference_fact_catalog_schema_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::corporate_action::install_corporate_action_schema_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;

        for statement in REPLAY_COMPOSITION_ISSUANCE_SCHEMA_V1 {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        }
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
    }

    /// Opens the isolated Market Data owner and Composer-reader pools after custody cutover.
    ///
    /// # Errors
    ///
    /// Returns unavailable unless both fixed principals and their bounded Composer capabilities
    /// are exact.
    pub async fn connect(
        market_data_database_url: &str,
        rd_role_set_database_url: &str,
    ) -> Result<Self, ReplayCompositionBindingErrorV1> {
        let owner = super::MarketDataOwnerPostgres::connect_existing(market_data_database_url)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::time_zone::verify_time_zone_custody_v1(&owner.pool)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let market_acl = sqlx::query(MARKET_OWNER_COMPOSER_ACL_QUERY_V1)
            .fetch_one(&owner.pool)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        if !(market_acl
            .try_get::<bool, _>("schema_usage")
            .unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("no_schema_create")
                .unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("cut_lock_execute")
                .unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("no_role_resolve")
                .unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("no_native_resolve")
                .unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("no_private_schema")
                .unwrap_or(false)
            && market_acl.try_get::<bool, _>("no_raw").unwrap_or(false)
            && market_acl
                .try_get::<bool, _>("no_design_role_intent_resolve")
                .unwrap_or(false))
        {
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        }
        let rd_role_set_pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(rd_role_set_database_url)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let rd_reader_role: String = sqlx::query_scalar("SELECT current_user::TEXT")
            .fetch_one(&rd_role_set_pool)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        if rd_reader_role != "market_data_reader" {
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        }
        let rd_reader_acl = sqlx::query(COMPOSER_READER_ACL_QUERY_V1)
            .fetch_one(&rd_role_set_pool)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let admitted_acl = composer_reader_acl_is_exact(&rd_reader_acl, true)
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        if !admitted_acl {
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        }
        verify_composer_cut_contract_v1(&rd_role_set_pool).await?;
        Ok(Self {
            owner,
            rd_role_set_pool,
        })
    }

    /// Issues or recovers the exact six-role BAR join selected for sealed Composer.
    ///
    /// The request contains untrusted locators only. Market Data resolves the unchanged joined cut
    /// and every V3 FRAME dependency, then writes and re-reads V4 in the same serializable Owner
    /// transaction.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed composition error when any locator, custody row, schedule dependency,
    /// exact component, V4 write, or readback is absent, conflicting, or corrupt.
    pub async fn issue_composer_native_join_v1(
        &self,
        request: &UntrustedComposerNativeJoinRequestV1,
    ) -> Result<AuthenticatedComposerNativeJoinV1, ReplayCompositionBindingErrorV1> {
        let joined_locator =
            crate::owner::observation_census::UntrustedStrategyInputJoinedCutLocatorV1::from_untrusted(
                request.joined_cut_identity,
                request.joined_cut_digest,
            );
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::time_zone::verify_time_zone_custody_in_transaction_v1(&mut transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;

        let (joined_request, joined_custody, joined_cut_receipt_digest) =
            super::observation_census::load_strategy_input_joined_cut_custody_v1(
                &mut transaction,
                &joined_locator,
                super::observation_census::ObservationCensusReadModeV1::LockRows,
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let (_, joined) = super::observation_census::resolve_and_commit_observation_census_v1(
            &mut transaction,
            &joined_request,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?;

        if joined.record().identity() != request.joined_cut_identity
            || joined.record().digest() != request.joined_cut_digest
            || joined.record().canonical_bytes() != joined_custody.as_ref()
            || joined.record().joined_cut_receipt().digest() != joined_cut_receipt_digest
            || joined_cut_receipt_digest == request.joined_cut_digest
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }

        let mut stored = Vec::with_capacity(request.frame_projection_digests.len());
        let mut dependencies = Vec::with_capacity(request.frame_projection_digests.len());
        for digest in request.frame_projection_digests {
            let projection = super::load_strategy_input_sample_projection_v3(
                &mut transaction,
                *digest.as_bytes(),
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
            let source_dependencies = super::load_sample_projection_schedule_dependencies_v3(
                &mut transaction,
                *digest.as_bytes(),
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            super::validate_sample_projection_dependencies_v3(
                &mut transaction,
                &projection.decoded,
                &source_dependencies,
                true,
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
            if projection.decoded.component_count() != 1 || source_dependencies.len() != 1 {
                return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
            }
            let component = &projection.decoded.components()[0];
            let dependency = &source_dependencies[0];
            dependencies.push(vec![ScheduleDependencyV4 {
                source_projection_digest: projection.decoded.receipt_digest(),
                role_identity: dependency.role_identity,
                binding_receipt_digest: dependency.binding_receipt_digest,
                timeframe_projection_digest: component.timeframe_projection_digest(),
                schedule_readback_identity: *dependency.schedule_readback_identity.as_bytes(),
                schedule_fact_digest: *dependency.schedule_fact_digest.as_bytes(),
                schedule_cut_identity: *dependency.schedule_cut_identity.as_bytes(),
                schedule_cut_digest: *dependency.schedule_cut_digest.as_bytes(),
                schedule_receipt_identity: *dependency.schedule_receipt_identity.as_bytes(),
            }]);
            stored.push(projection);
        }
        let sources = stored
            .iter()
            .zip(&dependencies)
            .map(|(projection, dependencies)| VerifiedV3ProjectionSourceV4 {
                projection: &projection.decoded,
                dependencies,
            })
            .collect::<Vec<_>>();
        let validated_native_join = ValidatedNativeJoinV4 {
            roles: dependencies
                .iter()
                .flatten()
                .map(|dependency| {
                    (
                        BindingDigest::from_untrusted_bytes(dependency.role_identity),
                        BindingDigest::from_untrusted_bytes(dependency.binding_receipt_digest),
                    )
                })
                .collect(),
            dependencies: dependencies.iter().flatten().copied().collect(),
        };
        let claim = joined_request.join_claim();
        let mut declarations = Vec::with_capacity(claim.roles.len());
        for role in &claim.roles {
            declarations.push(
                super::strategy_input_binding_registry::recover_strategy_input_binding_declaration_v1(
                    &mut transaction,
                    joined_request.pit_locator().request_identity,
                    claim.strategy_design_identity,
                    role.input_role_identity,
                )
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?,
            );
        }
        validate_replay_first_corpus_claim_v1(
            &mut transaction,
            claim,
            &declarations,
            joined.record().joined_cut_receipt(),
            &validated_native_join,
        )
        .await?;
        let prepared = prepare_joined_cut_v4(joined.record().joined_cut_receipt(), &sources)
            .map_err(map_sample_projection_v4_error)?;

        if prepared.kind() != StrategyInputSampleProjectionKindV4::JoinedCut
            || prepared.component_count() != 6
            || prepared.subject_identity() != *joined_cut_receipt_digest.as_bytes()
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        let readback =
            super::sample_projection_v4::persist_strategy_input_sample_projection_in_transaction_v4(
                &mut transaction,
                &prepared,
            )
            .await
            .map_err(map_sample_projection_v4_error)?;

        if readback.receipt_digest() != prepared.receipt_digest()
            || readback.kind() != prepared.kind()
            || readback.subject_identity() != prepared.subject_identity()
            || readback.schedule_dependency_set_digest()
                != prepared.schedule_dependency_set_digest()
            || readback.component_count() != prepared.component_count()
            || readback.canonical_bytes() != prepared.canonical_bytes()
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;

        Ok(AuthenticatedComposerNativeJoinV1::from_owner_readback(
            UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted(
                readback.receipt_digest(),
            ),
            request.joined_cut_digest,
            joined_cut_receipt_digest,
            BindingDigest::from_untrusted_bytes(readback.schedule_dependency_set_digest()),
            claim,
        ))
    }

    /// Exact response-loss recovery. No latest/history/full scan is admitted.
    ///
    /// # Errors
    ///
    /// Returns an error when the locator is unknown or any stored byte/cross-reference fails
    /// exact verification.
    pub async fn recover_binding_v1(
        &self,
        locator: ReplayCompositionBindingLocatorV1,
    ) -> Result<ReplayCompositionIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let readback =
            recover_replay_composition_binding_in_transaction_v1(&mut transaction, locator)
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::UnknownBinding)?;
        let replay = recover_replay_market_facts_by_binding_in_transaction_v2(
            &mut transaction,
            *locator.binding_identity().as_bytes(),
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(ReplayCompositionIssuanceResponseV1::from_exact_storage(
            &readback,
            crate::owner::source_binding::BindingDigest::from_untrusted_bytes(
                replay.facts_identity,
            ),
            crate::owner::source_binding::BindingDigest::from_untrusted_bytes(
                replay.receipt_identity,
            ),
            &replay.facts_bytes,
            &replay.frontier_bytes,
            &replay.receipt_bytes,
        ))
    }

    /// Recovers one exact binding, typed Replay facts, and Instrument Master cut from Owner custody.
    ///
    /// The binding identity is the only lookup coordinate. Market Data recovers the bound PIT
    /// aggregate, reuses its original complete locator, and reissues the typed readback from the
    /// byte-identical durable facts inside one transaction.
    ///
    /// # Errors
    ///
    /// Returns an error when the binding, PIT aggregate, facts, or transaction is unavailable.
    pub async fn resolve_bound_replay_cut_v1(
        &self,
        locator: ReplayCompositionBindingLocatorV1,
    ) -> Result<ResolvedReplayCompositionCutV1, ReplayCompositionBindingErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let resolved =
            resolve_bound_replay_cut_in_transaction_v1(&mut transaction, locator).await?;
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(resolved)
    }

    /// Recovers one exact bound Replay cut inside the caller's existing transaction.
    ///
    /// This facade neither opens nor terminalizes the transaction. The binding identity remains the
    /// only lookup coordinate, and Market Data performs the same sealed PIT, Replay facts, and
    /// Instrument Master verification as [`Self::resolve_bound_replay_cut_v1`].
    ///
    /// # Errors
    ///
    /// Returns an error when the binding, PIT aggregate, facts, or transaction is unavailable.
    pub async fn resolve_bound_replay_cut_in_transaction_v1(
        &self,
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        locator: ReplayCompositionBindingLocatorV1,
    ) -> Result<ResolvedReplayCompositionCutV1, ReplayCompositionBindingErrorV1> {
        resolve_bound_replay_cut_for_rd_in_transaction_v1(transaction, locator).await
    }

    /// Recovers the byte-identical issuance response by the identity known before first send.
    ///
    /// # Errors
    ///
    /// Returns an error when the identity is unknown, its meaning conflicts, or any bound custody
    /// bytes fail exact recovery.
    pub async fn recover_issuance_v1(
        &self,
        locator: ReplayCompositionIssuanceLocatorV1,
    ) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        lock_issuance_identity(&mut transaction, locator.request_identity()).await?;
        let response = recover_issuance_in_transaction(&mut transaction, locator).await?;
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(response)
    }

    /// Resolves exact R&D and Market Data custody and atomically stores the resulting binding.
    ///
    /// # Errors
    ///
    /// Returns an error when any locator, authenticated role coordinate, native dependency or
    /// durable custody row is absent, conflicting or corrupt.
    pub async fn issue_binding_v1(
        &self,
        command: &ReplayCompositionLocatorOnlyIssuanceRequestV1,
    ) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
        let request = command.composition();
        let issuance_locator = command.issuance_locator();
        let request_bytes = canonical_issuance_command_bytes_v1(command)?;
        let mut issuance = self
            .open_issuance_v1(
                issuance_locator,
                request.composer_locator(),
                ReplayMarketFactsShapeV2::FirstCorpus,
            )
            .await?;
        let outcome = Box::pin(issue_first_corpus_in_transaction_v1(
            &mut issuance,
            request,
            issuance_locator,
            &request_bytes,
        ))
        .await;
        self.close_issuance_v1(issuance, issuance_locator, outcome)
            .await
    }

    /// Opens the two transactions one issuance runs in and proves they are distinct sessions of one
    /// primary database, each holding its own challenge.
    ///
    /// The R&D reader is `REPEATABLE READ READ ONLY`; it takes the Composer cut lock and resolves
    /// the authenticated role set - and, for the first corpus, the Composer native join - before
    /// the Market Data Owner transaction begins. The Owner transaction is `SERIALIZABLE` and, once
    /// both challenges verify, holds the Composer cut lock and the issuance identity lock. A
    /// failure after the Owner transaction begins leaves it terminal before the reader is released.
    async fn open_issuance_v1(
        &self,
        issuance_locator: ReplayCompositionIssuanceLocatorV1,
        composer_locator: &StrategyDesignRoleSetLocatorV1,
        shape: ReplayMarketFactsShapeV2,
    ) -> Result<OpenIssuanceV1, ReplayCompositionBindingErrorV1> {
        let mut reader_transaction = self
            .rd_role_set_pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let reader_preflight = async {
            let (reader_isolation, reader_read_only): (String, String) = sqlx::query_as(
                "SELECT pg_catalog.current_setting('transaction_isolation'),
                        pg_catalog.current_setting('transaction_read_only')",
            )
            .fetch_one(&mut *reader_transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            if reader_isolation != "repeatable read" || reader_read_only != "on" {
                return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
            }
            let reader_challenge = begin_owner_challenge_v1(
                &mut reader_transaction,
                issuance_locator.request_identity(),
                "reader",
            )
            .await?;
            lock_composer_cut_v1(&mut reader_transaction, &composer_locator.request_identity)
                .await?;
            let authenticated_role_set =
                Self::resolve_role_set_attestation(&mut reader_transaction, composer_locator)
                    .await?;
            let native_join = match shape {
                ReplayMarketFactsShapeV2::FirstCorpus => Some(
                    Self::resolve_native_join_attestation(
                        &mut reader_transaction,
                        composer_locator,
                    )
                    .await?,
                ),
                ReplayMarketFactsShapeV2::UniverseMembers => None,
            };
            Ok((reader_challenge, authenticated_role_set, native_join))
        }
        .await;
        let (reader_challenge, role_set, native_join) = match reader_preflight {
            Ok(preflight) => preflight,
            Err(operation_error) => {
                reader_transaction
                    .rollback()
                    .await
                    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
                return Err(operation_error);
            }
        };
        let Ok(mut transaction) = self
            .owner
            .pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .await
        else {
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        };

        // Only the first corpus consumes Time Zone facts, so only it depends on their custody.
        if shape == ReplayMarketFactsShapeV2::FirstCorpus
            && super::time_zone::verify_time_zone_custody_in_transaction_v1(&mut transaction)
                .await
                .is_err()
        {
            transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        }
        let market_challenge_key =
            owner_challenge_key_v1(issuance_locator.request_identity(), "market");
        let Ok(market_challenge) =
            begin_owner_challenge_with_key_v1(&mut transaction, market_challenge_key).await
        else {
            terminalize_market_before_domain_v1(
                transaction,
                &self.owner.pool,
                market_challenge_key,
            )
            .await;
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        };

        if let Err(operation_error) = verify_owner_domain_and_reader_challenge_v1(
            &mut reader_transaction,
            &mut transaction,
            &reader_challenge,
        )
        .await
        {
            terminalize_market_before_domain_v1(
                transaction,
                &self.owner.pool,
                market_challenge.key,
            )
            .await;
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return Err(operation_error);
        }
        let mut issuance = OpenIssuanceV1 {
            reader_transaction,
            transaction,
            market_challenge,
            role_set,
            native_join,
        };
        let locked = Box::pin(async {
            lock_composer_cut_v1(
                &mut issuance.transaction,
                &composer_locator.request_identity,
            )
            .await?;
            verify_market_challenge_v1(
                &mut issuance.reader_transaction,
                &mut issuance.transaction,
                &reader_challenge,
                &issuance.market_challenge,
            )
            .await?;
            lock_issuance_identity(
                &mut issuance.transaction,
                issuance_locator.request_identity(),
            )
            .await
        })
        .await;

        match locked {
            Ok(()) => Ok(issuance),
            Err(operation_error) => Err(Self::abandon_issuance_v1(issuance, operation_error).await),
        }
    }

    /// Ends one issuance: commits the Owner transaction on success and rolls it back otherwise, and
    /// releases the reader only once the Owner transaction is proven terminal.
    ///
    /// A commit whose outcome is unknown is resolved by recovering the stored issuance, which is
    /// returned only if it is byte-identical to the response this call produced.
    async fn close_issuance_v1(
        &self,
        issuance: OpenIssuanceV1,
        issuance_locator: ReplayCompositionIssuanceLocatorV1,
        outcome: Result<
            ReplayCompositionDurableIssuanceResponseV1,
            ReplayCompositionBindingErrorV1,
        >,
    ) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
        let response = match outcome {
            Ok(response) => response,
            Err(operation_error) => {
                return Err(Self::abandon_issuance_v1(issuance, operation_error).await);
            }
        };
        let OpenIssuanceV1 {
            mut reader_transaction,
            transaction,
            market_challenge,
            ..
        } = issuance;
        let market_terminal = transaction.commit().await;
        if market_terminal.is_err() {
            prove_market_transaction_terminal_v1(&mut reader_transaction, &market_challenge)
                .await?;
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return match self.recover_issuance_v1(issuance_locator).await {
                Ok(recovered) if recovered.canonical_bytes() == response.canonical_bytes() => {
                    Ok(recovered)
                }
                _ => Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable),
            };
        }
        reader_transaction
            .rollback()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(response)
    }

    /// Rolls the Owner transaction back, proves it terminal, releases the reader, and returns the
    /// error the caller reports: the operation's own, or `ReplayV2Unavailable` when releasing
    /// either transaction fails.
    async fn abandon_issuance_v1(
        issuance: OpenIssuanceV1,
        operation_error: ReplayCompositionBindingErrorV1,
    ) -> ReplayCompositionBindingErrorV1 {
        let OpenIssuanceV1 {
            mut reader_transaction,
            transaction,
            market_challenge,
            ..
        } = issuance;
        let market_terminal = transaction.rollback().await;
        if market_terminal.is_err()
            && let Err(proof_error) =
                prove_market_transaction_terminal_v1(&mut reader_transaction, &market_challenge)
                    .await
        {
            return proof_error;
        }

        match reader_transaction.rollback().await {
            Ok(()) => operation_error,
            Err(_) => ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
        }
    }

    /// Declares every input role of the Design one published R&D role intent authenticates.
    ///
    /// This is the same work as declaring against an attestation, and the same separation of
    /// principals: the reader resolves what R&D published and can write nothing, the Owner resolves
    /// its own custody and can read nothing of R&D's. Only the authenticated shape differs, because
    /// the first cycle of a Design has no Composer operation to attest it yet - a program's identity
    /// folds in the very binding receipts this call issues.
    ///
    /// No cut lock is taken. A published intent is write-once by design identity, so there is no
    /// Composer commit for the read to be serialised against.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. A role set is declared whole or not at all, and a second
    /// admission of one Design rejoins its stored declarations or fails closed on a conflict.
    pub async fn declare_strategy_input_bindings_from_design_intent_v1(
        &self,
        design_identity: BindingDigest,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        let mut reader_transaction = self
            .rd_role_set_pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let published = async {
            let (isolation, read_only, session_user): (String, String, String) = sqlx::query_as(
                "SELECT pg_catalog.current_setting('transaction_isolation'),
                        pg_catalog.current_setting('transaction_read_only'),
                        session_user",
            )
            .fetch_one(&mut *reader_transaction)
            .await
            .map_err(|e| {
                // Nothing at compile time says this string is valid SQL. The first version of it
                // wrote `pg_catalog.session_user`, which PostgreSQL parses as a column of a table
                // named `pg_catalog`: the whole statement failed, this arm discarded the error,
                // and the chain reported `StoreUnavailable` from a connection that was in fact
                // perfectly healthy - the exact shape of discarded cause this call now refuses to
                // produce downstream.
                crate::owner::storage_diagnostic::refused_by_store(
                    "strategy_input_binding.design_intent.call_context_probe",
                    &e,
                );
                StrategyInputBindingAdmissionErrorV1::StoreUnavailable
            })?;

            if isolation != "repeatable read" || read_only != "on" {
                crate::owner::storage_diagnostic::refused_by_store(
                    "strategy_input_binding.design_intent.reader_transaction_mode",
                    &format!(
                        "the R&D role-intent reader must run repeatable read and read only, not \
                         {isolation} and read_only={read_only}"
                    ),
                );
                return Err(StrategyInputBindingAdmissionErrorV1::StoreUnavailable);
            }

            // The Owner's exact-locator function carries `AND session_user = 'market_data_reader'`
            // inside its `WHERE`, so a connection under any other principal reads zero rows - the
            // same zero rows a Design that was never published reads. Without this check, pointing
            // this pool at the wrong role is reported as `DESIGN_ROLE_INTENT_UNKNOWN`, which sends
            // a reader looking for a missing Design instead of a misconfigured connection.
            //
            // Checked here rather than changed there: the repository already answers this eight
            // times the other way round - `10-migrate-authority-custody.sh` has eight
            // `IF session_user <> ...` guards and exactly one function that folds the test into a
            // `WHERE`. That one is the odd one out, and its caller is what can still tell the two
            // apart.
            Self::admit_design_intent_reader_principal(&session_user)?;
            Self::resolve_design_role_intent(&mut reader_transaction, design_identity).await
        }
        .await;
        let intent = match published {
            Ok(intent) => intent,
            Err(reader_error) => {
                reader_transaction
                    .rollback()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                return Err(reader_error);
            }
        };
        let outcome = self.register_design_intent_declarations_v1(&intent).await;
        reader_transaction
            .rollback()
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        outcome
    }

    /// Refuses a connection that is not the admitted reader principal, and says so in the log.
    ///
    /// The Owner's exact-locator function carries `AND session_user = 'market_data_reader'` inside
    /// its `WHERE`, so a connection under any other principal reads zero rows - the same zero rows
    /// a Design that was never published reads. Unchecked, pointing this pool at the wrong role is
    /// reported as `DESIGN_ROLE_INTENT_UNKNOWN`, which sends a reader looking for a missing Design
    /// instead of a misconfigured connection.
    ///
    /// Checked here rather than changed there: the repository already answers this eight times the
    /// other way round - `10-migrate-authority-custody.sh` has eight `IF session_user <> ...`
    /// guards and exactly one function that folds the test into a `WHERE`. That one is the odd one
    /// out, and its caller is what can still tell the two apart.
    ///
    /// `StoreUnavailable` is the right code even so: the caller cannot change which principal this
    /// pool connects as, so its options are the same as for an unreachable store. What differs is
    /// what an operator should go and look at, and that is what the log line carries.
    fn admit_design_intent_reader_principal(
        session_user: &str,
    ) -> Result<(), StrategyInputBindingAdmissionErrorV1> {
        if session_user == "market_data_reader" {
            return Ok(());
        }

        crate::owner::storage_diagnostic::refused_by_store(
            "strategy_input_binding.design_intent.reader_principal",
            &format!(
                "the R&D role-intent reader must connect as market_data_reader, not {session_user}"
            ),
        );
        Err(StrategyInputBindingAdmissionErrorV1::StoreUnavailable)
    }

    /// The initial PIT request a universe-member Design's published role intent names.
    ///
    /// An attestation states roles but no PIT request, so a Design with a universe-member role
    /// takes it from its own published role intent, read in the same R&D reader transaction; one
    /// with no such role, or with no published intent, names none, and registration refuses its
    /// universe-member roles as unnamed.
    async fn attested_initial_pit_request(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        receipt: &StrategyDesignRoleSetReceiptV1,
    ) -> Result<
        Option<crate::owner::strategy_design_role_intent_v1::InitialPitRequestLocatorV1>,
        StrategyInputBindingAdmissionErrorV1,
    > {
        if !receipt.roles.iter().any(|role| {
            role.scope == crate::owner::strategy_input_binding::UNIVERSE_MEMBERS_ROLE_SCOPE_V1
        }) {
            return Ok(None);
        }
        let intent =
            match Self::resolve_design_role_intent(transaction, receipt.design_identity).await {
                Ok(intent) => Some(intent),
                Err(StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign) => None,
                Err(e) => return Err(e),
            };
        attested_initial_pit_request_from_intent_v1(receipt, intent.as_ref())
    }

    /// Reads one published intent through R&D's exact-locator function and re-derives its digest.
    ///
    /// The stored bytes are evidence and never authority: `from_durable_publication` rebuilds the
    /// projection and refuses it unless the rebuilt bytes reproduce the digest they were stored
    /// under, so a row edited in place authenticates nothing.
    async fn resolve_design_role_intent(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        design_identity: BindingDigest,
    ) -> Result<StrategyDesignRoleIntentV1, StrategyInputBindingAdmissionErrorV1> {
        let row = sqlx::query(RD_DESIGN_ROLE_INTENT_RESOLVE_QUERY_V1)
            .bind(design_identity.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?
            .ok_or(StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign)?;
        let stored_digest: Vec<u8> = row
            .try_get("intent_digest")
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let canonical_bytes: Vec<u8> = row
            .try_get("canonical_bytes")
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let stored_digest: [u8; 32] = stored_digest
            .try_into()
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted)?;
        let intent = StrategyDesignRoleIntentV1::from_durable_publication(
            &canonical_bytes,
            BindingDigest::from_untrusted_bytes(stored_digest),
        )
        .map_err(|_| StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted)?;

        if intent.design_identity() != design_identity {
            return Err(StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted);
        }
        Ok(intent)
    }

    /// Resolves and stores one published Design's roles inside a single Owner transaction.
    async fn register_design_intent_declarations_v1(
        &self,
        intent: &StrategyDesignRoleIntentV1,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let composed =
            super::authenticated_design_registration_v1::register_authenticated_design_roles_v1(
                &mut transaction,
                super::pit_role_resolution_v1::AuthenticatedDesignIdentityV1::from_role_intent(
                    intent,
                ),
                intent.roles(),
                intent.initial_pit_request(),
            )
            .await;

        match composed {
            Ok(terminal) => {
                transaction
                    .commit()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                Ok(terminal)
            }
            Err(operation_error) => {
                transaction
                    .rollback()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                Err(operation_error)
            }
        }
    }

    /// Declares every input role of the Design one Composer attestation authenticates.
    ///
    /// The two principals do exactly one thing each. The reader transaction holds the Composer cut
    /// shared lock and produces the authenticated role set, and nothing else; it stays open only so
    /// that the attestation cannot change underneath the write. The Owner transaction resolves each
    /// role against this Owner's own custody and registers the declarations, and can neither read
    /// nor name the attestation.
    ///
    /// Every role of one Design must resolve to the same PIT request. Roles that split across
    /// requests would give the Design two coordinates, and `resolve_pit_request_for_strategy_design_v1`
    /// answers with one; a split is therefore refused rather than reduced to whichever role is read
    /// first.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. A role set is declared whole or not at all, and nothing is
    /// stored unless every role resolved to one PIT request of this Owner's own custody.
    pub async fn declare_strategy_input_bindings_v1(
        &self,
        locator: &StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        let mut reader_transaction = self
            .rd_role_set_pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let attested = async {
            let (isolation, read_only): (String, String) = sqlx::query_as(
                "SELECT pg_catalog.current_setting('transaction_isolation'),
                        pg_catalog.current_setting('transaction_read_only')",
            )
            .fetch_one(&mut *reader_transaction)
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;

            if isolation != "repeatable read" || read_only != "on" {
                return Err(StrategyInputBindingAdmissionErrorV1::StoreUnavailable);
            }
            lock_composer_cut_v1(&mut reader_transaction, &locator.request_identity)
                .await
                .map_err(map_admission_reader_error)?;
            let authenticated =
                Self::resolve_role_set_attestation(&mut reader_transaction, locator)
                    .await
                    .map_err(map_admission_reader_error)?;
            let initial_pit_request = Self::attested_initial_pit_request(
                &mut reader_transaction,
                authenticated.receipt(),
            )
            .await?;
            Ok((authenticated, initial_pit_request))
        }
        .await;
        let (authenticated, initial_pit_request) = match attested {
            Ok(attested) => attested,
            Err(reader_error) => {
                reader_transaction
                    .rollback()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                return Err(reader_error);
            }
        };
        let outcome = self
            .register_declarations_v1(authenticated.receipt(), initial_pit_request)
            .await;
        reader_transaction
            .rollback()
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        outcome
    }

    /// Resolves and stores one authenticated role set inside a single Owner transaction.
    async fn register_declarations_v1(
        &self,
        receipt: &StrategyDesignRoleSetReceiptV1,
        initial_pit_request: Option<
            crate::owner::strategy_design_role_intent_v1::InitialPitRequestLocatorV1,
        >,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
        let composed =
            super::authenticated_design_registration_v1::register_authenticated_design_roles_v1(
                &mut transaction,
                super::pit_role_resolution_v1::AuthenticatedDesignIdentityV1::from_role_set(
                    receipt,
                ),
                &receipt.roles,
                initial_pit_request,
            )
            .await;

        match composed {
            Ok(terminal) => {
                transaction
                    .commit()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                Ok(terminal)
            }
            Err(operation_error) => {
                transaction
                    .rollback()
                    .await
                    .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
                Err(operation_error)
            }
        }
    }

    async fn resolve_role_set_attestation(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        locator: &StrategyDesignRoleSetLocatorV1,
    ) -> Result<AuthenticatedStrategyDesignRoleSetV1, ReplayCompositionBindingErrorV1> {
        let row = sqlx::query(COMPOSER_ROLE_SET_RESOLVE_QUERY_V1)
            .bind(&locator.request_identity)
            .bind(i32::from(locator.schema_version))
            .bind(locator.operation_receipt_identity.as_bytes().as_slice())
            .bind(&locator.artifact_locator)
            .bind(locator.artifact_identity.as_bytes().as_slice())
            .bind(locator.canonical_plan_digest.as_bytes().as_slice())
            .bind(locator.design_digest.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let bytes: Vec<u8> = row
            .try_get("canonical_bytes")
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let attestation_identity = digest_column(&row, "attestation_identity")?;
        let attestation_digest = digest_column(&row, "attestation_digest")?;
        if attestation_identity != attestation_digest {
            return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
        }
        authenticate_durable_strategy_design_role_set_v1(locator, &bytes, attestation_digest)
            .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)
    }

    async fn resolve_native_join_attestation(
        transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        locator: &StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyDesignNativeJoinReceiptV1, ReplayCompositionBindingErrorV1> {
        let row = sqlx::query(COMPOSER_NATIVE_JOIN_RESOLVE_QUERY_V1)
            .bind(&locator.request_identity)
            .bind(i32::from(locator.schema_version))
            .bind(locator.operation_receipt_identity.as_bytes().as_slice())
            .bind(&locator.artifact_locator)
            .bind(locator.artifact_identity.as_bytes().as_slice())
            .bind(locator.canonical_plan_digest.as_bytes().as_slice())
            .bind(locator.design_digest.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
        let digest = digest_column(&row, "native_join_digest")?;
        let bytes: Vec<u8> = row
            .try_get("canonical_bytes")
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        StrategyDesignNativeJoinReceiptV1::from_durable_attestation(locator, &bytes, digest)
            .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)
    }
}

async fn resolve_bound_replay_cut_in_transaction_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
) -> Result<ResolvedReplayCompositionCutV1, ReplayCompositionBindingErrorV1> {
    let binding = recover_replay_composition_binding_in_transaction_v1(transaction, locator)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::UnknownBinding)?;
    resolve_bound_replay_cut_from_binding_in_transaction_v1(
        transaction,
        locator,
        binding,
        ReplayCutReaderV1::MarketOwner,
    )
    .await
}

/// Reads one exact Market Data composition cut in the existing R&D transaction.
///
/// The database session must be the isolated `rd_owner` principal. The Market Data-owned
/// definer functions lock the binding, PIT, facts, and Instrument Master rows; this path
/// does not open a second connection or grant R&D raw-table access.
pub(in crate::owner) async fn resolve_bound_replay_cut_for_rd_in_transaction_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
) -> Result<ResolvedReplayCompositionCutV1, ReplayCompositionBindingErrorV1> {
    verify_rd_replay_cut_transport_v1(transaction).await?;
    let binding = recover_replay_composition_binding_for_rd_in_transaction_v1(transaction, locator)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::UnknownBinding)?;
    resolve_bound_replay_cut_from_binding_in_transaction_v1(
        transaction,
        locator,
        binding,
        ReplayCutReaderV1::RdOwner,
    )
    .await
}

pub(super) async fn verify_rd_replay_cut_transport_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let isolated: bool = sqlx::query_scalar(
        "SELECT session_user='rd_owner'
                AND current_user='rd_owner'
                AND pg_catalog.pg_get_userbyid(namespace.nspowner)='market_data_owner'
                AND pg_catalog.has_schema_privilege(current_user,namespace.oid,'USAGE')
                AND NOT pg_catalog.has_schema_privilege(current_user,namespace.oid,'CREATE')
                AND NOT EXISTS (
                    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl
                    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
                    WHERE acl.grantee<>namespace.nspowner
                      AND (role.rolname IS DISTINCT FROM 'rd_owner' OR acl.privilege_type<>'USAGE' OR acl.is_grantable)
                )
                AND NOT pg_catalog.has_schema_privilege(current_user,'market_data_private','USAGE')
                AND NOT EXISTS (
                    SELECT 1 FROM pg_catalog.pg_class relation
                    JOIN pg_catalog.pg_namespace private_namespace ON private_namespace.oid=relation.relnamespace
                    WHERE private_namespace.nspname='market_data_private'
                      AND relation.relkind IN ('r','p','v','m','f')
                      AND pg_catalog.has_table_privilege(current_user,relation.oid,'SELECT')
                )
           FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname='market_data_rd_api'",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
    .unwrap_or(false);

    if !isolated {
        return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
    }

    for function in [
        "market_data_rd_api.lock_replay_composition_binding_v1(bytea)",
        "market_data_rd_api.lock_pit_snapshot_for_replay_v1(bytea)",
        "market_data_rd_api.lock_instrument_master_for_replay_v1(bytea)",
        "market_data_rd_api.lock_replay_market_facts_for_replay_v1(bytea)",
        "market_data_rd_api.lock_replay_market_facts_for_replay_v2(bytea)",
        "market_data_rd_api.lock_strategy_input_declarations_v1(bytea,bytea)",
        "market_data_rd_api.lock_source_for_strategy_input_v1(bytea)",
        "market_data_rd_api.lock_pit_observation_batch_for_strategy_input_v1(bytea)",
        "market_data_rd_api.lock_pit_observation_rows_for_strategy_input_v1(bytea)",
        "market_data_rd_api.lock_universe_for_strategy_input_v1(bytea)",
        "market_data_rd_api.lock_market_semantics_scope_for_strategy_input_v1(bytea)",
        "market_data_rd_api.lock_market_semantics_readback_for_strategy_input_v1(bytea)",
    ] {
        let name = function
            .split_once('(')
            .map(|(name, _)| name)
            .ok_or(ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let source = REPLAY_MARKET_RD_CUT_API_SCHEMA_V1
            .iter()
            .chain(super::rd_strategy_input_custody::SCHEMA_V1.iter())
            .find_map(|statement| {
                statement
                    .strip_prefix("CREATE OR REPLACE FUNCTION ")
                    .filter(|definition| definition.starts_with(name))
                    .and_then(|definition| {
                        definition
                            .split_once(" AS $function$")
                            .map(|(_, source)| source)
                    })
                    .and_then(|source| source.strip_suffix("$function$"))
            })
            .ok_or(ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let exact: bool = sqlx::query_scalar(
            "SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='market_data_owner'
                    AND language.lanname='sql'
                    AND procedure.prosrc=$2
                    AND procedure.prosecdef AND procedure.provolatile='v'
                    AND procedure.proparallel='u' AND NOT procedure.proleakproof
                    AND procedure.prokind='f' AND procedure.proretset
                    AND procedure.pronargs=$3
                    AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
                    AND pg_catalog.has_function_privilege('rd_owner',procedure.oid,'EXECUTE')
                    AND (SELECT count(*)=2
                           AND count(*) FILTER (WHERE acl.grantee=procedure.proowner AND acl.privilege_type='EXECUTE')=1
                           AND count(*) FILTER (WHERE role.rolname='rd_owner' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=1
                           AND count(*) FILTER (WHERE acl.grantee=0 OR acl.privilege_type<>'EXECUTE' OR (acl.grantee<>procedure.proowner AND (role.rolname<>'rd_owner' OR acl.is_grantable)))=0
                         FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
                         LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee)
               FROM pg_catalog.pg_proc procedure
               JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
              WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
        )
        .bind(function)
        .bind(source)
        .bind(i16::from(function.contains("bytea,bytea")) + 1)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .unwrap_or(false);

        if !exact {
            return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum ReplayCutReaderV1 {
    MarketOwner,
    RdOwner,
}

async fn resolve_bound_replay_cut_from_binding_in_transaction_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
    binding: crate::owner::replay_market_facts_v2::ReplayCompositionBindingReadbackV1,
    reader: ReplayCutReaderV1,
) -> Result<ResolvedReplayCompositionCutV1, ReplayCompositionBindingErrorV1> {
    let record = binding.record();
    let pit = record
        .native_locator(ReplayCompositionNativeLocatorKindV1::PitSnapshot)
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    let aggregate = match reader {
        ReplayCutReaderV1::MarketOwner => {
            super::load_pit_for_update(transaction, pit.identity, false)
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        }
        ReplayCutReaderV1::RdOwner => {
            let row =
                sqlx::query("SELECT * FROM market_data_rd_api.lock_pit_snapshot_for_replay_v1($1)")
                    .bind(pit.identity.as_bytes().as_slice())
                    .fetch_optional(&mut **transaction)
                    .await
                    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            row.map(|row| super::decode_pit_row(&row, false))
                .transpose()
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        }
    }
    .ok_or(ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let market_data_scope_digest = aggregate.fact().request().scope_digest;
    let pit_locator = aggregate.receipt().locator().clone();
    if pit.digest != pit_locator.fact_digest
        || record.replay_request_identity() != pit_locator.request_identity
        || record.replay_request_digest() != pit_locator.request_digest
    {
        return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
    }
    let request = super::super::replay_market_facts_v2::UntrustedReplayMarketFactsRequestV2::new(
        pit_locator,
        record.replay_start_event_ns(),
        record.replay_end_event_ns_exclusive(),
    );
    let market_facts = match reader {
        ReplayCutReaderV1::MarketOwner => {
            recover_bound_replay_market_facts_readback_in_transaction_v2(
                transaction,
                &request,
                *locator.binding_identity().as_bytes(),
            )
            .await
        }
        ReplayCutReaderV1::RdOwner => {
            recover_bound_replay_market_facts_for_rd_in_transaction_v2(
                transaction,
                &request,
                *locator.binding_identity().as_bytes(),
            )
            .await
        }
    }
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    crate::owner::replay_market_facts_v2::composition::require_binding_facts_shape_v1(
        &binding,
        market_facts.facts(),
    )?;
    // A universe-member binding names no Instrument Master: its members' Instrument Master is
    // the request-keyed cut issued when R&D first binds the sealed request, never this cut's.
    let instrument_master = match record.shape() {
        crate::owner::replay_market_facts_v2::ReplayMarketFactsShapeV2::FirstCorpus => {
            let instrument = record
                .native_locator(ReplayCompositionNativeLocatorKindV1::InstrumentMaster)
                .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
            Some(
                Box::pin(resolve_first_corpus_instrument_master_v1(
                    transaction,
                    instrument,
                    reader,
                ))
                .await?,
            )
        }
        crate::owner::replay_market_facts_v2::ReplayMarketFactsShapeV2::UniverseMembers => None,
    };
    Ok(ResolvedReplayCompositionCutV1::from_owner_resolution(
        binding,
        market_data_scope_digest,
        market_facts,
        instrument_master,
    ))
}

/// The exact Instrument Master cut a first-corpus binding names, read by the binding's reader.
async fn resolve_first_corpus_instrument_master_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    instrument: crate::owner::replay_market_facts_v2::composition::ReplayCompositionNativeLocatorV1,
    reader: ReplayCutReaderV1,
) -> Result<
    crate::owner::instrument_master::InstrumentMasterReadbackV1,
    ReplayCompositionBindingErrorV1,
> {
    let instrument_master = match reader {
        ReplayCutReaderV1::MarketOwner => {
            let instrument_row = sqlx::query(
                "SELECT request_identity FROM market_data_private.instrument_master_cuts_v1 WHERE cut_identity=$1",
            )
            .bind(instrument.identity.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
            let request_identity = digest_column(&instrument_row, "request_identity")?;
            super::load_durable_instrument_readback(transaction, request_identity, false).await
        }
        ReplayCutReaderV1::RdOwner => {
            super::load_durable_instrument_readback_for_rd_replay(transaction, instrument.identity)
                .await
        }
    }
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
    .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;

    if instrument_master.cut().identity() != instrument.identity
        || instrument_master.cut().digest() != instrument.digest
    {
        return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
    }
    Ok(instrument_master)
}

async fn verify_composer_cut_contract_v1(
    pool: &sqlx::PgPool,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let exact: bool = sqlx::query_scalar(
        "SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='composer_owner' AND procedure.prosrc=$1 AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proretset AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND (SELECT count(*)=3 AND count(*) FILTER(WHERE acl.grantee=procedure.proowner AND acl.privilege_type='EXECUTE')=1 AND count(*) FILTER(WHERE role.rolname IN ('market_data_reader','market_data_owner') AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=2 AND count(*) FILTER(WHERE acl.grantee=0 OR acl.privilege_type<>'EXECUTE' OR (acl.grantee<>procedure.proowner AND (role.rolname NOT IN ('market_data_reader','market_data_owner') OR acl.is_grantable)))=0 FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE procedure.oid=pg_catalog.to_regprocedure('composer_owner_api.lock_replay_composition_cut_v1(text)')",
    )
    .bind(COMPOSER_CUT_LOCK_SOURCE_V1)
    .fetch_one(pool)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    exact
        .then_some(())
        .ok_or(ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
}

async fn lock_composer_cut_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: &str,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let owner_backend: i64 = sqlx::query_scalar(COMPOSER_CUT_LOCK_QUERY_V1)
        .bind(request_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let caller_backend: i64 = sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()::bigint")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    if owner_backend != caller_backend {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerDatabaseDomainV1 {
    system_identifier: String,
    database_name: String,
    database_oid: i64,
    postmaster_started_at_epoch: String,
}

/// The two open transactions of one issuance and what the R&D reader authenticated for it.
struct OpenIssuanceV1 {
    reader_transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    market_challenge: OwnerChallengeV1,
    role_set: AuthenticatedStrategyDesignRoleSetV1,
    /// The Composer native join, resolved only for the first corpus.
    native_join: Option<StrategyDesignNativeJoinReceiptV1>,
}

/// The canonical bytes of an issuance command whose locator's meaning digest is its composition's.
///
/// Both sides come from the caller's command, and nothing has been read yet: a locator whose
/// meaning digest disagrees with the composition beside it is a request that contradicts itself,
/// not a mismatch against anything this Owner holds.
fn canonical_issuance_command_bytes_v1<C: ReplayCompositionIssuanceCompositionV1>(
    command: &ReplayCompositionLocatorOnlyIssuanceRequestV1<C>,
) -> Result<Vec<u8>, ReplayCompositionBindingErrorV1> {
    let issuance_locator = command.issuance_locator();
    if issuance_locator.request_identity().as_bytes() == &[0; 32] {
        return Err(ReplayCompositionBindingErrorV1::InvalidRequest);
    }
    let request_bytes = serde_json::to_vec(command.composition())
        .map_err(|_| ReplayCompositionBindingErrorV1::InvalidRequest)?;
    let actual_meaning =
        crate::owner::replay_market_facts_v2::replay_composition_issuance_meaning_digest_v1(
            command.composition(),
        )?;

    if actual_meaning != issuance_locator.request_meaning_digest() {
        return Err(ReplayCompositionBindingErrorV1::InvalidRequest);
    }
    Ok(request_bytes)
}

/// The stored response when this identity was already issued, refusing it when the identity holds
/// another request.
async fn replayed_issuance_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    request_bytes: &[u8],
) -> Result<Option<ReplayCompositionDurableIssuanceResponseV1>, ReplayCompositionBindingErrorV1> {
    if !issuance_exists(transaction, issuance_locator.request_identity()).await? {
        return Ok(None);
    }
    let response = recover_issuance_in_transaction(transaction, issuance_locator).await?;
    let stored_request_bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT request_bytes FROM market_data_private.replay_composition_issuances_v1 WHERE request_identity=$1",
    )
    .bind(issuance_locator.request_identity().as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    if stored_request_bytes != request_bytes {
        return Err(ReplayCompositionBindingErrorV1::IssuanceIdentityConflict);
    }
    Ok(Some(response))
}

/// Records the issuance of one binding and its Replay facts, and returns the exact response bytes
/// every retry of this identity reads back.
async fn record_issuance_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    request_bytes: &[u8],
    binding: &ReplayCompositionBindingReadbackV1,
    replay_readback: &ReplayMarketFactsReadbackV2,
) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
    let response =
        ReplayCompositionIssuanceResponseV1::from_authenticated(binding, replay_readback);
    let response_bytes = serde_json::to_vec(&response)
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    sqlx::query("INSERT INTO market_data_private.replay_composition_issuances_v1 (request_identity, request_meaning_digest, request_bytes, binding_identity, binding_digest, response_bytes) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(issuance_locator.request_identity().as_bytes().as_slice())
        .bind(issuance_locator.request_meaning_digest().as_bytes().as_slice())
        .bind(request_bytes)
        .bind(binding.record().locator().binding_identity().as_bytes().as_slice())
        .bind(binding.record().locator().binding_digest().as_bytes().as_slice())
        .bind(&response_bytes)
        .execute(&mut **transaction)
        .await
        .map_err(|e| map_issuance_insert_error(&e))?;
    Ok(ReplayCompositionDurableIssuanceResponseV1::from_exact_storage(response_bytes))
}

/// Resolves the first corpus's exact custody in the Owner transaction and stores its binding and
/// Replay facts.
async fn issue_first_corpus_in_transaction_v1(
    issuance: &mut OpenIssuanceV1,
    request: &crate::owner::replay_market_facts_v2::ReplayCompositionBindingIssuanceRequestV1,
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    request_bytes: &[u8],
) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
    let transaction = &mut issuance.transaction;
    let receipt = issuance.role_set.receipt();
    let native_join = issuance
        .native_join
        .as_ref()
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    let replay = request.replay_request();
    let validated_native_join = validate_native_join_v4(transaction, native_join).await?;

    let r0_locator = request.reference_fact_r0_locator();
    let r0 = super::reference_fact_coordinates::recover_reference_fact_r0_in_transaction_v1(
        transaction,
        UntrustedReferenceFactR0LocatorV1 {
            request_identity: r0_locator.request_identity(),
            request_meaning_digest: r0_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let semantics_locator = request.market_semantics_locator();
    let semantics = super::market_semantics::recover_market_semantics_in_transaction_v1(
        transaction,
        UntrustedMarketSemanticsLocatorV1 {
            request_identity: semantics_locator.request_identity(),
            request_meaning_digest: semantics_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if semantics.cut().r0_cut_identity != r0.cut().identity()
        || semantics.cut().r0_cut_digest != r0.cut().digest()
        || semantics.facts().iter().any(|fact| {
            fact.pit_snapshot_identity != request.pit_locator().snapshot_identity
                || fact.pit_fact_digest != request.pit_locator().fact_digest
                || fact.source_binding_identity != request.source_binding_locator().binding_id
        })
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }

    let universe_locator = request.universe_selection_locator();
    let universe = super::universe_selection::recover_universe_selection_in_transaction_v1(
        transaction,
        &UntrustedUniverseSelectionLocatorV1::from_untrusted(
            universe_locator.request_identity(),
            universe_locator.request_meaning_digest(),
        ),
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    let mut roles = Vec::with_capacity(receipt.roles.len());
    let mut declarations = Vec::with_capacity(receipt.roles.len());
    let mut first_declaration_request = None;

    for role in &receipt.roles {
        let declaration =
            super::strategy_input_binding_registry::recover_strategy_input_binding_declaration_v1(
                transaction,
                request.pit_locator().request_identity,
                receipt.design_identity,
                role.role_identity,
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?;

        if declaration.request().research_request_identity != receipt.research_request_identity
            || declaration.request().strategy_design_identity != receipt.design_identity
            || declaration.request().input_role_identity != role.role_identity
            || !request_matches_authenticated_role_v1(declaration.request(), role)
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }

        if first_declaration_request.is_none() {
            first_declaration_request = Some(declaration.request().clone());
        }
        roles.push(ReplayCompositionRoleEvidenceV1 {
            role_identity: role.role_identity,
            declaration_identity: declaration.request_meaning_digest(),
            declaration_digest: declaration.request_meaning_digest(),
            binding_identity: declaration.binding_digest(),
            binding_digest: declaration.binding_digest(),
        });
        declarations.push(declaration);
    }
    let census_locator = request.observation_census_locator();
    let census_row = sqlx::query("SELECT request_meaning_digest,request_bytes,census_identity,census_bytes FROM market_data_private.observation_census_records_v1 WHERE request_identity=$1")
        .bind(census_locator.request_identity().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    let census_meaning = digest_column(&census_row, "request_meaning_digest")?;
    let census_identity = digest_column(&census_row, "census_identity")?;
    let census_bytes: Vec<u8> = census_row
        .try_get("census_bytes")
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let census_request_bytes: Vec<u8> = census_row
        .try_get("request_bytes")
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let census_request =
        crate::owner::observation_census::authority::decode_observation_census_request_v1(
            &census_request_bytes,
        )
        .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)?;
    let census = crate::owner::observation_census::authority::decode_observation_census_storage_v1(
        &census_bytes,
    )
    .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)?;
    if census_meaning != census_locator.request_meaning_digest() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let census_roles = census
        .record()
        .entries()
        .iter()
        .map(crate::owner::observation_census::ObservationCensusEntryV1::input_role_identity)
        .collect::<Vec<_>>();

    if census.record().identity() != census_identity
        || census_roles
            != receipt
                .roles
                .iter()
                .map(|role| role.role_identity)
                .collect::<Vec<_>>()
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }
    let joined = request.joined_cut_locator();
    let (authenticated_census, authenticated_joined) =
        super::observation_census::resolve_and_commit_authenticated_observation_census_v1(
            transaction,
            &census_request,
            receipt,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    let sample = request.sample_projection_locator();

    if authenticated_census.record().identity() != census_identity
        || authenticated_joined
            .record()
            .locator()
            .joined_cut_identity()
            != joined.identity()
        || authenticated_joined.record().locator().joined_cut_digest() != joined.digest()
        || native_join.joined_cut_digest() != joined.digest()
        || native_join.joined_cut_receipt_digest()
            != authenticated_joined.record().joined_cut_receipt().digest()
        || native_join.strategy_design_identity() != receipt.design_identity
        || native_join.join_identity() != census_request.join_claim().join_identity
        || native_join.join_claim_digest()
            != crate::owner::replay_market_facts_v2::composer_join_claim_digest_v1(
                census_request.join_claim(),
            )
        || sample.identity() != native_join.projection_receipt_digest()
        || sample.digest() != native_join.projection_receipt_digest()
        || validated_native_join.roles
            != roles
                .iter()
                .map(|role| (role.role_identity, role.binding_digest))
                .collect::<Vec<_>>()
    {
        return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
    }

    validate_replay_first_corpus_v1(
        transaction,
        receipt,
        census_request.join_claim(),
        &declarations,
        authenticated_joined.record().joined_cut_receipt(),
        &validated_native_join,
    )
    .await?;

    validate_exact_request_row(
        transaction,
        "instrument_master_receipts_v1",
        request.instrument_master_locator(),
    )
    .await?;

    let calendar_locator = request.calendar_locator();
    let calendar = super::calendar::recover_calendar_v1(
        transaction,
        UntrustedCalendarLocatorV1::from_untrusted(
            calendar_locator.request_identity(),
            calendar_locator.request_meaning_digest(),
        ),
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let session_locator = request.session_locator();
    let session = super::session::recover_session_in_transaction_v1(
        transaction,
        UntrustedSessionLocatorV1 {
            request_identity: session_locator.request_identity(),
            request_meaning_digest: session_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let time_zone_locator = request.time_zone_locator();
    let time_zone = super::time_zone::recover_time_zone_in_transaction_v1(
        transaction,
        UntrustedTimeZoneLocatorV1 {
            request_identity: time_zone_locator.request_identity(),
            request_meaning_digest: time_zone_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let action_locator = request.corporate_action_locator();
    let corporate_action = super::corporate_action::recover_corporate_action_in_transaction_v1(
        transaction,
        UntrustedCorporateActionLocatorV1 {
            request_identity: action_locator.request_identity(),
            request_meaning_digest: action_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let source = super::strategy_input_binding_registry::recover_strategy_input_binding_source_v1(
        transaction,
        first_declaration_request
            .as_ref()
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?,
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    if source.locator() != request.source_binding_locator() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let native_reference_r0s =
        recover_native_reference_r0s_v1(transaction, &calendar, &session, &time_zone).await?;
    let coordinates = coordinates_from_r0(&r0)?;
    let correction = project_first_v1(CorrectionPolicyAuthenticatedInputsV1 {
        source_binding: &source,
        coordinates: &coordinates,
        r0_coordinate_identity: r0.record().identity(),
        r0_coordinate_digest: r0.record().digest(),
    })
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if correction.identity() != request.correction_policy_locator().identity()
        || correction.identity() != request.correction_policy_locator().digest()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let instrument_master =
        exact_instrument_reference(transaction, request.instrument_master_locator()).await?;
    let instrument_cut_identity = instrument_master.cut_digest;

    if semantics
        .facts()
        .iter()
        .any(|fact| fact.instrument_master_cut_digest != instrument_cut_identity)
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    validate_exact_request_row(
        transaction,
        "calendar_receipts_v1",
        request.calendar_locator(),
    )
    .await?;
    validate_exact_request_row(
        transaction,
        "session_receipts_v1",
        request.session_locator(),
    )
    .await?;
    validate_exact_request_row(
        transaction,
        "time_zone_receipts_v1",
        request.time_zone_locator(),
    )
    .await?;
    validate_exact_request_row(
        transaction,
        "corporate_action_receipts_v1",
        request.corporate_action_locator(),
    )
    .await?;

    if let Some(response) =
        replayed_issuance_v1(transaction, issuance_locator, request_bytes).await?
    {
        return Ok(response);
    }
    let registry_digest = digest_registry(&roles);
    let role_ids = roles
        .iter()
        .map(|role| role.role_identity)
        .collect::<Vec<_>>();
    let role_bindings = roles
        .iter()
        .map(|role| (role.role_identity, role.binding_digest))
        .collect::<Vec<_>>();
    let binding = issue_replay_composition_binding_v1(
        &replay,
        ReplayCompositionBindingEvidenceV1 {
            authenticated_strategy_design_identity: receipt.design_identity,
            authenticated_strategy_design_digest: receipt.design_digest,
            registry_identity: registry_digest,
            registry_digest,
            native_locators: vec![
                ReplayCompositionNativeLocatorV1 {
                    kind: ReplayCompositionNativeLocatorKindV1::PitSnapshot,
                    identity: request.pit_locator().snapshot_identity,
                    digest: request.pit_locator().fact_digest,
                },
                ReplayCompositionNativeLocatorV1 {
                    kind: ReplayCompositionNativeLocatorKindV1::SourceBinding,
                    identity: request.source_binding_locator().binding_id,
                    digest: request.source_binding_locator().fact_digest,
                },
                ReplayCompositionNativeLocatorV1 {
                    kind: ReplayCompositionNativeLocatorKindV1::UniverseSelection,
                    identity: universe.record().identity(),
                    digest: universe.record().digest(),
                },
                ReplayCompositionNativeLocatorV1 {
                    kind: ReplayCompositionNativeLocatorKindV1::InstrumentMaster,
                    identity: instrument_cut_identity,
                    digest: instrument_cut_identity,
                },
                ReplayCompositionNativeLocatorV1 {
                    kind: ReplayCompositionNativeLocatorKindV1::MarketSemantics,
                    identity: semantics.cut().identity(),
                    digest: semantics.cut().digest(),
                },
            ],
            roles,
            census_identity,
            census_digest: census_identity,
            census_roles: role_ids,
            joined_cut_identity: joined.identity(),
            joined_cut_digest: joined.digest(),
            joined_cut_roles: role_bindings.clone(),
            sample_projection_identity: sample.identity(),
            sample_projection_digest: sample.digest(),
            sample_projection_roles: role_bindings,
            stable_correlation: receipt.intent_identity,
        },
    )?;
    persist_replay_composition_binding_in_transaction_v1(transaction, &binding)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let native_chain = ReplayNativeChainEvidenceV2::from_verified_native_records_v4(
        ReplayVerifiedNativeRecordV2::from_verified_native_record(census_identity, census_identity),
        ReplayVerifiedNativeDerivedRecordV2::from_verified_native_record(
            ReplayVerifiedNativeRecordV2::from_verified_native_record(
                joined.identity(),
                joined.digest(),
            ),
            ReplayVerifiedNativeRecordV2::from_verified_native_record(
                census_identity,
                census_identity,
            ),
        ),
        ReplayVerifiedNativeDerivedRecordV2::from_verified_native_record(
            ReplayVerifiedNativeRecordV2::from_verified_native_record(
                sample.identity(),
                sample.digest(),
            ),
            ReplayVerifiedNativeRecordV2::from_verified_native_record(
                joined.identity(),
                joined.digest(),
            ),
        ),
    );
    let base_dependencies = vec![
        ReplayMarketDependencyRefV2::from_verified_owner_record(
            ReplayMarketDependencyKindV2::PitSnapshotV1,
            request.pit_locator().snapshot_identity,
            request.pit_locator().fact_digest,
        ),
        ReplayMarketDependencyRefV2::from_verified_owner_record(
            ReplayMarketDependencyKindV2::SourceBindingV1,
            source.binding_id(),
            source.fact_digest(),
        ),
        ReplayMarketDependencyRefV2::from_verified_owner_record(
            ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
            instrument_cut_identity,
            instrument_cut_identity,
        ),
        ReplayMarketDependencyRefV2::from_verified_owner_record(
            ReplayMarketDependencyKindV2::UniverseSelectionV1,
            universe.record().identity(),
            universe.record().digest(),
        ),
    ];
    let reference_cuts = build_reference_cuts(
        request,
        &r0,
        &calendar,
        &session,
        &time_zone,
        &semantics,
        &correction,
        &corporate_action,
        &universe,
        &instrument_master,
        &source,
        &native_reference_r0s,
    )?;
    let composed_request =
        UntrustedReplayMarketFactsCompositionRequestV1::new(replay, binding.record().locator());
    let replay_readback = compose_replay_market_facts_v2(
        &composed_request,
        &binding,
        ReplayMarketFactsEvidenceV2 {
            base_dependencies,
            native_chain,
            reference_cuts,
            stable_correlation: receipt.intent_identity,
        },
    )?;
    let prepared =
        PreparedReplayMarketFactsStorageV2::from_verified_readback(&replay_readback, &binding)
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    persist_replay_market_facts_in_transaction_v2(transaction, &prepared)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    record_issuance_v1(
        transaction,
        issuance_locator,
        request_bytes,
        &binding,
        &replay_readback,
    )
    .await
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerChallengeV1 {
    key: i64,
    backend: i64,
    transaction_identity: String,
}

async fn owner_database_domain_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<OwnerDatabaseDomainV1, ReplayCompositionBindingErrorV1> {
    let (system_identifier, database_name, database_oid, postmaster_started_at_epoch, primary):
        (String, String, i64, String, bool) = sqlx::query_as(
            "SELECT (pg_catalog.pg_control_system()).system_identifier::text,pg_catalog.current_database()::text,database.oid::bigint,pg_catalog.date_part('epoch',pg_catalog.pg_postmaster_start_time())::text,NOT pg_catalog.pg_is_in_recovery() FROM pg_catalog.pg_database AS database WHERE database.datname=pg_catalog.current_database()",
        )
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    if !primary {
        return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
    }
    Ok(OwnerDatabaseDomainV1 {
        system_identifier,
        database_name,
        database_oid,
        postmaster_started_at_epoch,
    })
}

async fn begin_owner_challenge_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: BindingDigest,
    side: &str,
) -> Result<OwnerChallengeV1, ReplayCompositionBindingErrorV1> {
    begin_owner_challenge_with_key_v1(transaction, owner_challenge_key_v1(request_identity, side))
        .await
}

static OWNER_CHALLENGE_NONCE_V1: AtomicU64 = AtomicU64::new(1);

fn owner_challenge_key_v1(request_identity: BindingDigest, side: &str) -> i64 {
    let nonce = OWNER_CHALLENGE_NONCE_V1.fetch_add(1, Ordering::Relaxed);
    let observed_at = vibe_core::time::duration_since_unix_epoch().as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(b"market-data.owner-challenge.v1\0");
    hasher.update(request_identity.as_bytes());
    hasher.update(side.as_bytes());
    hasher.update(std::process::id().to_be_bytes());
    hasher.update(nonce.to_be_bytes());
    hasher.update(observed_at.to_be_bytes());
    let digest = hasher.finalize();
    let mut key = [0_u8; 8];
    key.copy_from_slice(&digest[..8]);
    i64::from_be_bytes(key)
}

async fn begin_owner_challenge_with_key_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: i64,
) -> Result<OwnerChallengeV1, ReplayCompositionBindingErrorV1> {
    let (backend, transaction_identity): (i64, String) = sqlx::query_as(
        "SELECT pg_catalog.pg_backend_pid()::bigint,pg_catalog.txid_current()::text
           FROM (SELECT pg_catalog.pg_advisory_xact_lock($1)) AS challenge_lock",
    )
    .bind(key)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    Ok(OwnerChallengeV1 {
        key,
        backend,
        transaction_identity,
    })
}

async fn verify_owner_domain_and_reader_challenge_v1(
    reader: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    market: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    reader_challenge: &OwnerChallengeV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    if owner_database_domain_v1(reader).await? != owner_database_domain_v1(market).await? {
        return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
    }
    let market_can_take_reader: bool =
        sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_xact_lock($1)")
            .bind(reader_challenge.key)
            .fetch_one(&mut **market)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    if market_can_take_reader {
        return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
    }
    Ok(())
}

async fn verify_market_challenge_v1(
    reader: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    market: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    reader_challenge: &OwnerChallengeV1,
    market_challenge: &OwnerChallengeV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let reader_can_take_market: bool =
        sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_xact_lock($1)")
            .bind(market_challenge.key)
            .fetch_one(&mut **reader)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let reader_backend_now: i64 = sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()::bigint")
        .fetch_one(&mut **reader)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let market_backend_now: i64 = sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()::bigint")
        .fetch_one(&mut **market)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;

    if reader_can_take_market
        || reader_challenge.key == market_challenge.key
        || reader_challenge.backend == market_challenge.backend
        || reader_challenge.transaction_identity == market_challenge.transaction_identity
        || reader_backend_now != reader_challenge.backend
        || market_backend_now != market_challenge.backend
    {
        return Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable);
    }
    Ok(())
}

async fn prove_market_transaction_terminal_v1(
    reader: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    market_challenge: &OwnerChallengeV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    loop {
        if try_acquire_market_challenge_v1(reader, market_challenge.key).await? {
            return Ok(());
        }
        sqlx::query("SELECT pg_catalog.pg_sleep(0.01)")
            .execute(&mut **reader)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    }
}

async fn prove_market_transaction_terminal_from_pool_v1(
    pool: &sqlx::PgPool,
    market_challenge_key: i64,
) {
    loop {
        let Ok(mut observer) = pool.acquire().await else {
            continue;
        };

        match try_acquire_market_challenge_v1(&mut observer, market_challenge_key).await {
            Ok(true) => return,
            Ok(false) => {
                let _ = sqlx::query("SELECT pg_catalog.pg_sleep(0.01)")
                    .execute(&mut *observer)
                    .await;
            }
            Err(_) => {}
        }
    }
}

async fn terminalize_market_before_domain_v1(
    transaction: sqlx::Transaction<'_, sqlx::Postgres>,
    pool: &sqlx::PgPool,
    market_challenge_key: i64,
) {
    if transaction.rollback().await.is_err() {
        prove_market_transaction_terminal_from_pool_v1(pool, market_challenge_key).await;
    }
}

async fn try_acquire_market_challenge_v1(
    observer: &mut PgConnection,
    market_challenge_key: i64,
) -> Result<bool, ReplayCompositionBindingErrorV1> {
    sqlx::query_scalar("SELECT pg_catalog.pg_try_advisory_xact_lock($1)")
        .bind(market_challenge_key)
        .fetch_one(observer)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
}

async fn lock_issuance_identity(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: crate::owner::source_binding::BindingDigest,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('market-data.replay-composition-issuance.v1:' || encode($1, 'hex'), 0))",
    )
        .bind(request_identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    Ok(())
}

async fn issuance_exists(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: crate::owner::source_binding::BindingDigest,
) -> Result<bool, ReplayCompositionBindingErrorV1> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM market_data_private.replay_composition_issuances_v1 WHERE request_identity=$1)",
    )
    .bind(request_identity.as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
}

async fn recover_issuance_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ReplayCompositionIssuanceLocatorV1,
) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
    let row = sqlx::query(
        "SELECT request_meaning_digest, binding_identity, binding_digest, response_bytes
           FROM market_data_private.replay_composition_issuances_v1
          WHERE request_identity=$1",
    )
    .bind(locator.request_identity().as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
    .ok_or(ReplayCompositionBindingErrorV1::UnknownBinding)?;
    if digest_column(&row, "request_meaning_digest")? != locator.request_meaning_digest() {
        return Err(ReplayCompositionBindingErrorV1::IssuanceIdentityConflict);
    }
    let binding_locator = ReplayCompositionBindingLocatorV1::from_untrusted(
        digest_column(&row, "binding_identity")?,
        digest_column(&row, "binding_digest")?,
    );
    let binding =
        recover_replay_composition_binding_in_transaction_v1(transaction, binding_locator)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::UnknownBinding)?;
    let replay = recover_replay_market_facts_by_binding_in_transaction_v2(
        transaction,
        *binding_locator.binding_identity().as_bytes(),
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let reconstructed = ReplayCompositionIssuanceResponseV1::from_exact_storage(
        &binding,
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes(replay.facts_identity),
        crate::owner::source_binding::BindingDigest::from_untrusted_bytes(replay.receipt_identity),
        &replay.facts_bytes,
        &replay.frontier_bytes,
        &replay.receipt_bytes,
    );
    let reconstructed = serde_json::to_vec(&reconstructed)
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let stored: Vec<u8> = row
        .try_get("response_bytes")
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    if stored != reconstructed {
        return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
    }
    Ok(ReplayCompositionDurableIssuanceResponseV1::from_exact_storage(stored))
}

fn digest_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<crate::owner::source_binding::BindingDigest, ReplayCompositionBindingErrorV1> {
    let bytes: Vec<u8> = row
        .try_get(name)
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)?;
    Ok(crate::owner::source_binding::BindingDigest::from_untrusted_bytes(bytes))
}

async fn validate_exact_request_row(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    table: &str,
    locator: crate::owner::replay_market_facts_v2::ReplayCompositionRequestLocatorV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let query = match table {
        "instrument_master_receipts_v1" => {
            "SELECT request_meaning_digest FROM market_data_private.instrument_master_receipts_v1 WHERE request_identity=$1"
        }
        "calendar_receipts_v1" => {
            "SELECT request_meaning_digest FROM market_data_private.calendar_cuts_v1 WHERE request_identity=$1"
        }
        "session_receipts_v1" => {
            "SELECT request_meaning_digest FROM market_data_private.session_receipts_v1 WHERE request_identity=$1"
        }
        "time_zone_receipts_v1" => {
            "SELECT request_meaning_digest FROM market_data_private.time_zone_receipts_v1 WHERE request_identity=$1"
        }
        "corporate_action_receipts_v1" => {
            "SELECT request_meaning_digest FROM market_data_private.corporate_action_cuts_v1 WHERE request_identity=$1"
        }
        _ => return Err(ReplayCompositionBindingErrorV1::InvalidRequest),
    };
    let row = sqlx::query(query)
        .bind(locator.request_identity().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    (digest_column(&row, "request_meaning_digest")? == locator.request_meaning_digest())
        .then_some(())
        .ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)
}

fn digest_registry(
    roles: &[ReplayCompositionRoleEvidenceV1],
) -> crate::owner::source_binding::BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(b"market-data.replay-composition-registry.v1\0");
    for role in roles {
        hasher.update(role.role_identity.as_bytes());
        hasher.update(role.declaration_digest.as_bytes());
        hasher.update(role.binding_digest.as_bytes());
    }
    crate::owner::source_binding::BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// Why the Universe Selection a composition binding bound could not be recovered.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::owner) enum BoundUniverseSelectionErrorV1 {
    /// No binding carries this exact identity and digest.
    BindingUnavailable,
    /// The binding, or the selection it names, is not what the store says it bound.
    CustodyMismatch,
    StoreUnavailable,
}

/// Recovers the Universe Selection one exact composition binding bound, taking no row lock.
///
/// The bound-replay Instrument Master cut issuance calls this from its own transaction while R&D
/// may hold `FOR SHARE` locks on the same binding rows in an open transaction of its own. Both
/// reads here are plain `SELECT`s, so they never wait on that transaction; the binding and the
/// selection are append-only, so the caller's snapshot is enough.
pub(in crate::owner) async fn recover_bound_universe_selection_in_transaction_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
) -> Result<
    crate::owner::universe_selection::UniverseSelectionReadbackV1,
    BoundUniverseSelectionErrorV1,
> {
    use crate::owner::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2 as Binding;
    use crate::owner::universe_selection::UniverseSelectionErrorV1 as Selection;

    let binding = recover_replay_composition_binding_in_transaction_v1(transaction, locator)
        .await
        .map_err(|e| match e {
            // A digest that disagrees with the stored binding names no binding either.
            Binding::BindingUnavailable | Binding::BindingConflict => {
                BoundUniverseSelectionErrorV1::BindingUnavailable
            }
            Binding::StoreUnavailable => BoundUniverseSelectionErrorV1::StoreUnavailable,
            Binding::InvalidPrepared
            | Binding::IdentityConflict
            | Binding::MeaningConflict
            | Binding::UnknownRecord
            | Binding::CorruptRecord
            | Binding::UnknownShape
            | Binding::UniverseSelectionUnavailable
            | Binding::JoinedCutUnavailable
            | Binding::SampleProjectionUnavailable => {
                BoundUniverseSelectionErrorV1::CustodyMismatch
            }
        })?;
    let universe = binding
        .record()
        .native_locator(ReplayCompositionNativeLocatorKindV1::UniverseSelection)
        .ok_or(BoundUniverseSelectionErrorV1::CustodyMismatch)?;
    super::universe_selection::recover_universe_selection_by_record_in_transaction_v1(
        transaction,
        universe.identity,
        universe.digest,
    )
    .await
    .map_err(|e| match e {
        Selection::StoreUnavailable => BoundUniverseSelectionErrorV1::StoreUnavailable,
        // Issuing the binding required this selection in the same store, and neither is ever
        // deleted, so every other answer means the store disagrees with what it bound.
        Selection::InvalidRequest
        | Selection::InvalidMembership
        | Selection::NonCanonicalOrder
        | Selection::CapacityExceeded
        | Selection::CodecMismatch
        | Selection::DigestMismatch
        | Selection::RequestConflict
        | Selection::UnknownIdentity
        | Selection::EvaluatorUnavailable
        | Selection::StoreUntrusted
        | Selection::CommitInterrupted
        | Selection::ResponseLost => BoundUniverseSelectionErrorV1::CustodyMismatch,
    })
}

async fn exact_instrument_reference(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: crate::owner::replay_market_facts_v2::ReplayCompositionRequestLocatorV1,
) -> Result<crate::owner::session::InstrumentMasterReferenceV1, ReplayCompositionBindingErrorV1> {
    let readback =
        super::load_durable_instrument_readback(transaction, locator.request_identity(), false)
            .await
            .map_err(|e| match e {
                crate::owner::instrument_master::InstrumentMasterError::StoreUnavailable => {
                    ReplayCompositionBindingErrorV1::ReplayV2Unavailable
                }
                _ => ReplayCompositionBindingErrorV1::DependencyMismatch,
            })?
            .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;

    if readback.request_meaning_digest != locator.request_meaning_digest()
        || readback.facts().len() != 1
        || readback.cut().expected_members().len() != 1
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let mut locator_bytes = Vec::with_capacity(64);
    locator_bytes.extend_from_slice(locator.request_identity().as_bytes());
    locator_bytes.extend_from_slice(locator.request_meaning_digest().as_bytes());
    Ok(crate::owner::session::InstrumentMasterReferenceV1 {
        locator_bytes: locator_bytes.into_boxed_slice(),
        readback_identity: readback.digest(),
        fact_digest: readback.facts()[0].digest(),
        cut_digest: readback.cut().digest(),
    })
}

fn coordinates_from_r0(
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
) -> Result<VerifiedReferenceFactCoordinatesV1, ReplayCompositionBindingErrorV1> {
    crate::owner::reference_fact_coordinates::verified_coordinates_from_r0_v1(r0)
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)
}

#[derive(Clone, Copy)]
struct NativeReferenceFactEvidenceV1 {
    source_binding_identity: crate::owner::source_binding::BindingDigest,
    source_binding_fact_digest: crate::owner::source_binding::BindingDigest,
    source_binding_lineage_root: crate::owner::source_binding::BindingDigest,
    source_binding_lineage_version: u64,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    r0_coordinate_identity: crate::owner::source_binding::BindingDigest,
    r0_coordinate_digest: crate::owner::source_binding::BindingDigest,
}

fn calendar_native_reference_evidence_v1(
    fact: &crate::owner::calendar::CalendarFactV1,
) -> NativeReferenceFactEvidenceV1 {
    NativeReferenceFactEvidenceV1 {
        source_binding_identity: fact.source_binding_identity,
        source_binding_fact_digest: fact.source_binding_fact_digest,
        source_binding_lineage_root: fact.source_binding_lineage_root,
        source_binding_lineage_version: fact.source_binding_lineage_version,
        provider_available_ns: fact.provider_available_ns,
        retrieval_ns: fact.retrieval_ns,
        correction_publication_ns: fact.correction_publication_ns,
        owner_observation_ns: fact.owner_observation_ns,
        decision_cut: fact.decision_cut,
        r0_coordinate_identity: fact.r0_coordinate_identity,
        r0_coordinate_digest: fact.r0_coordinate_digest,
    }
}

fn session_native_reference_evidence_v1(
    fact: &crate::owner::session::SessionFactV1,
) -> NativeReferenceFactEvidenceV1 {
    let evidence = fact.evidence();
    NativeReferenceFactEvidenceV1 {
        source_binding_identity: evidence.source_binding_identity,
        source_binding_fact_digest: evidence.source_binding_fact_digest,
        source_binding_lineage_root: evidence.source_binding_lineage_root,
        source_binding_lineage_version: evidence.source_binding_lineage_version,
        provider_available_ns: evidence.provider_available_ns,
        retrieval_ns: evidence.retrieval_ns,
        correction_publication_ns: evidence.correction_publication_ns,
        owner_observation_ns: evidence.owner_observation_ns,
        decision_cut: evidence.decision_cut,
        r0_coordinate_identity: evidence.r0_coordinate_identity,
        r0_coordinate_digest: evidence.r0_coordinate_digest,
    }
}

fn time_zone_native_reference_evidence_v1(
    fact: &crate::owner::time_zone::TimeZoneFactV1,
) -> NativeReferenceFactEvidenceV1 {
    let evidence = fact.evidence();
    NativeReferenceFactEvidenceV1 {
        source_binding_identity: evidence.source_binding_identity,
        source_binding_fact_digest: evidence.source_binding_fact_digest,
        source_binding_lineage_root: evidence.source_binding_lineage_root,
        source_binding_lineage_version: evidence.source_binding_lineage_version,
        provider_available_ns: evidence.provider_available_ns,
        retrieval_ns: evidence.retrieval_ns,
        correction_publication_ns: evidence.correction_publication_ns,
        owner_observation_ns: evidence.owner_observation_ns,
        decision_cut: evidence.decision_cut,
        r0_coordinate_identity: evidence.r0_coordinate_identity,
        r0_coordinate_digest: evidence.r0_coordinate_digest,
    }
}

async fn recover_native_reference_r0s_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    calendar: &crate::owner::calendar::CalendarReadbackV1,
    session: &crate::owner::session::SessionReadbackV1,
    time_zone: &crate::owner::time_zone::TimeZoneReadbackV1,
) -> Result<
    Vec<crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1>,
    ReplayCompositionBindingErrorV1,
> {
    let evidence = calendar
        .facts()
        .iter()
        .map(calendar_native_reference_evidence_v1)
        .chain(
            session
                .facts()
                .iter()
                .map(session_native_reference_evidence_v1),
        )
        .chain(
            time_zone
                .facts()
                .iter()
                .map(time_zone_native_reference_evidence_v1),
        )
        .collect::<Vec<_>>();
    let mut readbacks = Vec::new();

    for fact in evidence {
        if readbacks.iter().any(
            |readback: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1| {
                readback.record().identity() == fact.r0_coordinate_identity
            },
        ) {
            continue;
        }
        let readback = super::reference_fact_coordinates::load_reference_fact_r0_readback_by_record_v1(
            transaction,
            fact.r0_coordinate_identity,
        )
        .await
        .map_err(|e| match e {
            crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ErrorV1::StoreUnavailable => {
                ReplayCompositionBindingErrorV1::ReplayV2Unavailable
            }
            _ => ReplayCompositionBindingErrorV1::DependencyMismatch,
        })?
        .ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        if readback.record().digest() != fact.r0_coordinate_digest {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        readbacks.push(readback);
    }
    Ok(readbacks)
}

fn exact_native_reference_r0_v1(
    readbacks: &[crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1],
    fact: NativeReferenceFactEvidenceV1,
) -> Result<
    &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    ReplayCompositionBindingErrorV1,
> {
    let readback = readbacks
        .iter()
        .find(|readback| readback.record().identity() == fact.r0_coordinate_identity)
        .ok_or(ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    if readback.record().digest() != fact.r0_coordinate_digest {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    Ok(readback)
}

fn validate_native_reference_fact_evidence_v1(
    selected_r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    native_r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
    fact: NativeReferenceFactEvidenceV1,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let selected = selected_r0.record();
    let native = native_r0.record();

    if fact.source_binding_identity != source.binding_id()
        || fact.source_binding_fact_digest != source.fact_digest()
        || fact.source_binding_lineage_root != source.lineage_root()
        || fact.source_binding_lineage_version != source.lineage_version()
        || native.evidence.source_binding_identity != source.binding_id()
        || native.evidence.source_binding_fact_digest != source.fact_digest()
        || native.evidence.source_binding_lineage_root != source.lineage_root()
        || native.evidence.source_binding_lineage_version != source.lineage_version()
        || fact.r0_coordinate_identity != native.identity()
        || fact.r0_coordinate_digest != native.digest()
        || fact.provider_available_ns != native.provider_available_ns
        || fact.retrieval_ns != native.retrieval_ns
        || fact.correction_publication_ns != native.correction_publication_ns
        || fact.owner_observation_ns != native.owner_observation_ns
        || fact.decision_cut != native.decision_cut
        || native.owner_observation_ns > selected.owner_observation_ns
        || native.decision_cut > selected.decision_cut
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    Ok(())
}

#[allow(
    clippy::too_many_arguments,
    reason = "the fixed seven-authority composition keeps each authenticated readback explicit"
)]
fn build_reference_cuts(
    request: &crate::owner::replay_market_facts_v2::ReplayCompositionBindingIssuanceRequestV1,
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    calendar: &crate::owner::calendar::CalendarReadbackV1,
    session: &crate::owner::session::SessionReadbackV1,
    time_zone: &crate::owner::time_zone::TimeZoneReadbackV1,
    semantics: &crate::owner::market_semantics::MarketSemanticsReadbackV1,
    correction: &crate::owner::correction_policy_projection::CorrectionPolicyProjectionV1,
    corporate_action: &crate::owner::corporate_action::CorporateActionReadbackV1,
    universe: &crate::owner::universe_selection::UniverseSelectionReadbackV1,
    instrument_master: &crate::owner::session::InstrumentMasterReferenceV1,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
    native_reference_r0s: &[
        crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1
    ],
) -> Result<Vec<ReplayReferenceFactCutProposalV2>, ReplayCompositionBindingErrorV1> {
    let instrument_cut_identity = instrument_master.cut_digest;
    validate_r0_binds_request_v2(r0, request.pit_locator(), source)?;

    if session.cut.instrument_master_readback_identity != instrument_master.readback_identity
        || session.cut.instrument_master_fact_digest != instrument_master.fact_digest
        || session.cut.instrument_master_cut_digest != instrument_master.cut_digest
        || session.facts().iter().any(|fact| {
            fact.instrument_master_readback_identity != instrument_master.readback_identity
                || fact.instrument_master_fact_digest != instrument_master.fact_digest
                || fact.instrument_master_cut_digest != instrument_master.cut_digest
        })
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let make_scope = |kind, identity| {
        reference_scope_v2(
            request.pit_locator(),
            request.replay_start_event_ns(),
            request.replay_end_event_ns_exclusive(),
            kind,
            identity,
        )
    };
    let proposal = reference_fact_proposal_v2;
    let calendar_facts = calendar
        .facts()
        .iter()
        .map(|fact| {
            let evidence = calendar_native_reference_evidence_v1(fact);
            validate_native_reference_fact_evidence_v1(
                r0,
                exact_native_reference_r0_v1(native_reference_r0s, evidence)?,
                source,
                evidence,
            )?;
            Ok(proposal(
                ReplayReferenceFactValueV2::Calendar {
                    calendar_identity: fact.calendar_identity().to_vec(),
                    trading_day: fact.day(),
                    is_open: fact.is_open(),
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.effective_from_ns,
                    effective_until_ns: fact.effective_until_ns,
                    provider_available_ns: fact.provider_available_ns,
                    retrieval_ns: fact.retrieval_ns,
                    correction_publication_ns: fact.correction_publication_ns,
                    owner_observation_ns: fact.owner_observation_ns,
                    decision_cut: fact.decision_cut,
                },
                fact.source_binding_identity,
                fact.lineage_root(),
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
    let session_facts = session
        .facts()
        .iter()
        .map(|fact| {
            let evidence = fact.evidence();
            let native_evidence = session_native_reference_evidence_v1(fact);
            validate_native_reference_fact_evidence_v1(
                r0,
                exact_native_reference_r0_v1(native_reference_r0s, native_evidence)?,
                source,
                native_evidence,
            )?;
            Ok(proposal(
                ReplayReferenceFactValueV2::Session {
                    session_identity: fact.session_identity.to_vec(),
                    calendar_identity: calendar.cut().calendar_identity().to_vec(),
                    opens_at_ns: fact.utc_open_ns,
                    closes_at_ns: fact.utc_close_ns,
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.utc_open_ns,
                    effective_until_ns: Some(fact.utc_close_ns),
                    provider_available_ns: evidence.provider_available_ns,
                    retrieval_ns: evidence.retrieval_ns,
                    correction_publication_ns: evidence.correction_publication_ns,
                    owner_observation_ns: evidence.owner_observation_ns,
                    decision_cut: evidence.decision_cut,
                },
                evidence.source_binding_identity,
                fact.lineage_root,
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
    let time_zone_facts = time_zone
        .facts()
        .iter()
        .map(|fact| {
            let evidence = fact.evidence();
            let native_evidence = time_zone_native_reference_evidence_v1(fact);
            validate_native_reference_fact_evidence_v1(
                r0,
                exact_native_reference_r0_v1(native_reference_r0s, native_evidence)?,
                source,
                native_evidence,
            )?;
            Ok(proposal(
                ReplayReferenceFactValueV2::TimeZone {
                    time_zone_identity: fact.time_zone_identity().to_vec(),
                    ruleset_identity: fact.ruleset_identity(),
                    offset_seconds: fact.utc_offset_seconds(),
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.effective_from_ns(),
                    effective_until_ns: fact.effective_until_ns(),
                    provider_available_ns: evidence.provider_available_ns,
                    retrieval_ns: evidence.retrieval_ns,
                    correction_publication_ns: evidence.correction_publication_ns,
                    owner_observation_ns: evidence.owner_observation_ns,
                    decision_cut: evidence.decision_cut,
                },
                evidence.source_binding_identity,
                fact.lineage_root(),
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
    let semantics_facts = semantics_reference_facts_v2(r0, semantics, source)?;
    let correction_facts = correction_reference_facts_v2(r0, correction, source)?;
    let action_facts = corporate_action
        .facts()
        .iter()
        .map(|fact| {
            validate_native_reference_fact_evidence_v1(
                r0,
                r0,
                source,
                NativeReferenceFactEvidenceV1 {
                    source_binding_identity: fact.source_binding_identity,
                    source_binding_fact_digest: fact.source_binding_fact_digest,
                    source_binding_lineage_root: fact.source_binding_lineage_root,
                    source_binding_lineage_version: fact.source_binding_lineage_version,
                    provider_available_ns: fact.provider_available_ns,
                    retrieval_ns: fact.retrieval_ns,
                    correction_publication_ns: fact.correction_publication_ns,
                    owner_observation_ns: fact.owner_observation_ns,
                    decision_cut: fact.decision_cut,
                    r0_coordinate_identity: fact.coordinate_identity,
                    r0_coordinate_digest: fact.coordinate_digest,
                },
            )?;
            let terms = match &fact.terms {
                CorporateActionTermsV1::Split {
                    numerator,
                    denominator,
                } => ReplayCorporateActionTermsV2::Split {
                    numerator: *numerator,
                    denominator: *denominator,
                },
                CorporateActionTermsV1::CashDividend {
                    mantissa,
                    scale,
                    currency_identity,
                } => ReplayCorporateActionTermsV2::CashDividend {
                    mantissa: *mantissa,
                    scale: *scale,
                    currency_identity: currency_identity.to_vec(),
                },
                CorporateActionTermsV1::SymbolChange {
                    successor_instrument,
                } => ReplayCorporateActionTermsV2::SymbolChange {
                    successor_instrument: successor_instrument.to_vec(),
                },
                CorporateActionTermsV1::Expiry => ReplayCorporateActionTermsV2::Expiry,
                CorporateActionTermsV1::Roll {
                    successor_instrument,
                } => ReplayCorporateActionTermsV2::Roll {
                    successor_instrument: successor_instrument.to_vec(),
                },
            };
            Ok(proposal(
                ReplayReferenceFactValueV2::CorporateAction {
                    action_identity: fact.action_identity(),
                    instrument: fact.instrument().to_vec(),
                    terms,
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.effective_from_ns,
                    effective_until_ns: fact.effective_until_ns,
                    provider_available_ns: fact.provider_available_ns,
                    retrieval_ns: fact.retrieval_ns,
                    correction_publication_ns: fact.correction_publication_ns,
                    owner_observation_ns: fact.owner_observation_ns,
                    decision_cut: fact.decision_cut,
                },
                fact.source_binding_identity,
                fact.correction_identity,
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
    let membership_facts = membership_reference_facts_v2(universe, source)?;
    Ok(vec![
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::Calendar,
            scope: make_scope(
                ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
                instrument_cut_identity,
            )?,
            facts: calendar_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::Session,
            scope: make_scope(
                ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
                instrument_cut_identity,
            )?,
            facts: session_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::TimeZone,
            scope: make_scope(
                ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
                instrument_cut_identity,
            )?,
            facts: time_zone_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::MarketSemantics,
            scope: make_scope(
                ReplayMarketDependencyKindV2::SourceBindingV1,
                source.binding_id(),
            )?,
            facts: semantics_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::CorrectionPolicy,
            scope: make_scope(
                ReplayMarketDependencyKindV2::SourceBindingV1,
                source.binding_id(),
            )?,
            facts: correction_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::CorporateAction,
            scope: make_scope(
                ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
                instrument_cut_identity,
            )?,
            facts: action_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::HistoricalMembership,
            scope: make_scope(
                ReplayMarketDependencyKindV2::UniverseSelectionV1,
                universe.record().identity(),
            )?,
            facts: membership_facts,
        },
    ])
}

/// The Owner-verified inputs one universe-member Replay facts aggregate is issued from.
///
/// Every one is a readback or receipt only Market Data can construct: the caller hands over what it
/// resolved, never a digest standing for it.
pub(crate) struct UniverseMemberReplayFactsSourcesV2<'a> {
    pub(crate) r0: &'a crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    pub(crate) source: &'a crate::owner::source_binding::SourceBindingOwnerReadback,
    pub(crate) universe: &'a crate::owner::universe_selection::UniverseSelectionReadbackV1,
    pub(crate) semantics: &'a crate::owner::market_semantics::MarketSemanticsReadbackV1,
    pub(crate) correction:
        &'a crate::owner::correction_policy_projection::CorrectionPolicyProjectionV1,
    /// The frame Market Data derived over the Design's complete role set from the PIT batch.
    pub(crate) frame: &'a crate::owner::strategy_input_binding::StrategyInputUniverseFrameReceipt,
}

/// Issues and stores one universe-member Replay facts aggregate in the caller's transaction.
///
/// `binding` is the universe-member binding the caller issued in this same transaction. It must
/// be a universe-member binding of this request, name exactly these sources' native authorities
/// and bind this frame; the stored row is keyed by it and by nothing else. Nothing is written when
/// any check refuses.
///
/// # Errors
///
/// `CompositionShapeMismatch` for a first-corpus binding, `DependencyMismatch` for a binding of
/// another request or native authority, `UniverseFrameMismatch` when the frame is not the
/// binding's or not this request's, the reference-cut refusals of the first corpus for the three
/// cuts this shape carries, and `ReplayV2Unavailable` when the aggregate cannot be issued or
/// stored.
pub(crate) async fn persist_universe_member_replay_market_facts_in_transaction_v2(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &UntrustedReplayMarketFactsRequestV2,
    sources: &UniverseMemberReplayFactsSourcesV2<'_>,
    binding: &ReplayCompositionBindingReadbackV1,
    stable_correlation: BindingDigest,
) -> Result<ReplayMarketFactsReadbackV2, ReplayCompositionBindingErrorV1> {
    require_universe_member_binding_v1(
        request,
        binding,
        &universe_member_native_locators_v1(request.pit_locator(), sources),
        sources.frame.digest(),
    )?;
    let readback =
        compose_universe_member_replay_market_facts_v2(request, sources, stable_correlation)?;
    let prepared = PreparedReplayMarketFactsStorageV2::from_verified_universe_member_readback(
        &readback,
        binding.record().locator().binding_identity(),
    )
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    Box::pin(persist_replay_market_facts_in_transaction_v2(
        transaction,
        &prepared,
    ))
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    Ok(readback)
}

/// The native authorities a universe-member binding names: the PIT snapshot, the Source Binding,
/// the Universe Selection and the Market Semantics cut. It names no Instrument Master: each
/// member's facts are the request-keyed cut Market Data issues over the selection later.
pub(crate) fn universe_member_native_locators_v1(
    pit: &crate::owner::pit_snapshot::UntrustedPitSnapshotLocator,
    sources: &UniverseMemberReplayFactsSourcesV2<'_>,
) -> Vec<ReplayCompositionNativeLocatorV1> {
    vec![
        ReplayCompositionNativeLocatorV1 {
            kind: ReplayCompositionNativeLocatorKindV1::PitSnapshot,
            identity: pit.snapshot_identity,
            digest: pit.fact_digest,
        },
        ReplayCompositionNativeLocatorV1 {
            kind: ReplayCompositionNativeLocatorKindV1::SourceBinding,
            identity: sources.source.binding_id(),
            digest: sources.source.fact_digest(),
        },
        ReplayCompositionNativeLocatorV1 {
            kind: ReplayCompositionNativeLocatorKindV1::UniverseSelection,
            identity: sources.universe.record().identity(),
            digest: sources.universe.record().digest(),
        },
        ReplayCompositionNativeLocatorV1 {
            kind: ReplayCompositionNativeLocatorKindV1::MarketSemantics,
            identity: sources.semantics.cut().identity(),
            digest: sources.semantics.cut().digest(),
        },
    ]
}

/// Issues one universe-member aggregate: the PIT snapshot, Source Binding and Universe Selection the
/// request is bound to, the frame over its role set, and the Market Semantics, correction-policy and
/// historical-membership cuts those authorities scope.
pub(crate) fn compose_universe_member_replay_market_facts_v2(
    request: &UntrustedReplayMarketFactsRequestV2,
    sources: &UniverseMemberReplayFactsSourcesV2<'_>,
    stable_correlation: BindingDigest,
) -> Result<ReplayMarketFactsReadbackV2, ReplayCompositionBindingErrorV1> {
    let pit = request.pit_locator();
    let source = sources.source;
    let record = sources.universe.record();
    validate_universe_frame_binds_request_v2(pit, sources)?;
    validate_r0_binds_request_v2(sources.r0, pit, source)?;
    let scope = |kind, identity| {
        reference_scope_v2(
            pit,
            request.replay_start_event_ns(),
            request.replay_end_event_ns_exclusive(),
            kind,
            identity,
        )
    };
    let reference_cuts = vec![
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::MarketSemantics,
            scope: scope(
                ReplayMarketDependencyKindV2::SourceBindingV1,
                source.binding_id(),
            )?,
            facts: semantics_reference_facts_v2(sources.r0, sources.semantics, source)?,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::CorrectionPolicy,
            scope: scope(
                ReplayMarketDependencyKindV2::SourceBindingV1,
                source.binding_id(),
            )?,
            facts: correction_reference_facts_v2(sources.r0, sources.correction, source)?,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::HistoricalMembership,
            scope: scope(
                ReplayMarketDependencyKindV2::UniverseSelectionV1,
                record.identity(),
            )?,
            facts: membership_reference_facts_v2(sources.universe, source)?,
        },
    ];
    issue_universe_member_replay_market_facts_v2(
        request,
        ReplayUniverseMemberFactsEvidenceV2 {
            base_dependencies: vec![
                ReplayMarketDependencyRefV2::from_verified_owner_record(
                    ReplayMarketDependencyKindV2::PitSnapshotV1,
                    pit.snapshot_identity,
                    pit.fact_digest,
                ),
                ReplayMarketDependencyRefV2::from_verified_owner_record(
                    ReplayMarketDependencyKindV2::SourceBindingV1,
                    source.binding_id(),
                    source.fact_digest(),
                ),
                ReplayMarketDependencyRefV2::from_verified_owner_record(
                    ReplayMarketDependencyKindV2::UniverseSelectionV1,
                    record.identity(),
                    record.digest(),
                ),
            ],
            universe_frame: ReplayMarketDependencyRefV2::from_verified_owner_record(
                ReplayMarketDependencyKindV2::StrategyInputUniverseFrameV1,
                sources.frame.digest(),
                sources.frame.digest(),
            ),
            reference_cuts,
            stable_correlation,
        },
    )
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
}

/// The frame must be over this request's PIT snapshot, derived under its Source Binding lineage,
/// and hold exactly the members its Universe Selection includes.
fn validate_universe_frame_binds_request_v2(
    pit: &crate::owner::pit_snapshot::UntrustedPitSnapshotLocator,
    sources: &UniverseMemberReplayFactsSourcesV2<'_>,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let selected_members = sources
        .universe
        .record()
        .membership()
        .iter()
        .filter(|member| member.included())
        .map(|member| (member.member_key(), member.instrument()))
        .collect::<Vec<_>>();

    if crate::owner::replay_market_facts_v2::composition::universe_frame_binds_request_v2(
        sources.frame,
        pit.snapshot_identity,
        pit.fact_digest,
        sources.source.lineage_root(),
        &selected_members,
    ) {
        Ok(())
    } else {
        Err(ReplayCompositionBindingErrorV1::UniverseFrameMismatch)
    }
}

/// The one PIT, clock and replay-window scope every reference cut of one request repeats.
fn reference_scope_v2(
    pit: &crate::owner::pit_snapshot::UntrustedPitSnapshotLocator,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    kind: ReplayMarketDependencyKindV2,
    identity: BindingDigest,
) -> Result<ReplayReferenceFactScopeProposalV2, ReplayCompositionBindingErrorV1> {
    Ok(ReplayReferenceFactScopeProposalV2 {
        pit_snapshot_identity: pit.snapshot_identity,
        pit_decision_cut: pit.time_evidence.decision_cut.value,
        pit_observed_at: pit.time_evidence.observed_at,
        pit_valid_through: pit.time_evidence.valid_through,
        pit_clock_digest: pit_clock_digest(
            pit.time_evidence.decision_cut.clock_identity.as_bytes(),
            pit.time_evidence.decision_cut.clock_epoch.as_bytes(),
        )
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?,
        replay_start_event_ns,
        replay_end_event_ns_exclusive,
        authority_kind: kind,
        authority_identity: identity,
    })
}

fn reference_fact_proposal_v2(
    value: ReplayReferenceFactValueV2,
    time: ReplayReferenceFactTimeV2,
    source_identity: BindingDigest,
    correction_identity: BindingDigest,
) -> ReplayReferenceFactProposalV2 {
    ReplayReferenceFactProposalV2 {
        value,
        time,
        source_identity,
        correction_identity,
    }
}

/// The R0 record the reference facts are coordinated by must be this request's PIT and Source.
fn validate_r0_binds_request_v2(
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    pit: &crate::owner::pit_snapshot::UntrustedPitSnapshotLocator,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
) -> Result<(), ReplayCompositionBindingErrorV1> {
    let r0_record = r0.record();
    if r0_record.evidence.pit_snapshot_identity != pit.snapshot_identity
        || r0_record.evidence.pit_fact_digest != pit.fact_digest
        || r0_record.evidence.source_binding_identity != source.binding_id()
        || r0_record.evidence.source_binding_fact_digest != source.fact_digest()
        || r0_record.evidence.source_binding_lineage_root != source.lineage_root()
        || r0_record.evidence.source_binding_lineage_version != source.lineage_version()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    Ok(())
}

fn semantics_reference_facts_v2(
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    semantics: &crate::owner::market_semantics::MarketSemanticsReadbackV1,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
) -> Result<Vec<ReplayReferenceFactProposalV2>, ReplayCompositionBindingErrorV1> {
    let proposal = reference_fact_proposal_v2;
    semantics
        .facts()
        .iter()
        .map(|fact| {
            validate_native_reference_fact_evidence_v1(
                r0,
                r0,
                source,
                NativeReferenceFactEvidenceV1 {
                    source_binding_identity: fact.source_binding_identity,
                    source_binding_fact_digest: fact.source_binding_fact_digest,
                    source_binding_lineage_root: fact.source_binding_lineage_root,
                    source_binding_lineage_version: fact.source_binding_lineage_version,
                    provider_available_ns: fact.provider_available_ns,
                    retrieval_ns: fact.retrieval_ns,
                    correction_publication_ns: fact.correction_publication_ns,
                    owner_observation_ns: fact.owner_observation_ns,
                    decision_cut: fact.decision_cut,
                    r0_coordinate_identity: fact.coordinate_identity,
                    r0_coordinate_digest: fact.coordinate_digest,
                },
            )?;
            let value = fact.value();
            Ok(proposal(
                ReplayReferenceFactValueV2::MarketSemantics {
                    normalization_identity: value.normalization_identity,
                    price_adjustment: match value.price_adjustment {
                        crate::owner::market_semantics::MarketSemanticsPriceAdjustmentV1::Raw => ReplayPriceAdjustmentV2::Raw,
                        crate::owner::market_semantics::MarketSemanticsPriceAdjustmentV1::SplitAdjusted => ReplayPriceAdjustmentV2::SplitAdjusted,
                        crate::owner::market_semantics::MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted => ReplayPriceAdjustmentV2::TotalReturnAdjusted,
                        // A declared-unknown caliber has no V2 representation on purpose. Mapping
                        // it onto `Raw` would be the assertion the declaration exists to avoid,
                        // and admitting it to the replay would let prices of unknown caliber be
                        // compared with prices of known caliber without anything saying so.
                        crate::owner::market_semantics::MarketSemanticsPriceAdjustmentV1::Unknown => {
                            return Err(ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown);
                        }
                    },
                    timestamp_basis: match value.timestamp_basis {
                        crate::owner::market_semantics::MarketSemanticsTimestampBasisV1::EventEffective => ReplayTimestampBasisV2::EventEffective,
                        crate::owner::market_semantics::MarketSemanticsTimestampBasisV1::IntervalOpen => ReplayTimestampBasisV2::IntervalOpen,
                        crate::owner::market_semantics::MarketSemanticsTimestampBasisV1::IntervalClose => ReplayTimestampBasisV2::IntervalClose,
                    },
                    price_unit_identity: value.price_unit_identity,
                    size_unit_identity: value.size_unit_identity,
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.effective_from_ns,
                    effective_until_ns: fact.effective_until_ns,
                    provider_available_ns: fact.provider_available_ns,
                    retrieval_ns: fact.retrieval_ns,
                    correction_publication_ns: fact.correction_publication_ns,
                    owner_observation_ns: fact.owner_observation_ns,
                    decision_cut: fact.decision_cut,
                },
                fact.source_binding_identity,
                fact.correction_identity,
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()
}

fn correction_reference_facts_v2(
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    correction: &crate::owner::correction_policy_projection::CorrectionPolicyProjectionV1,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
) -> Result<Vec<ReplayReferenceFactProposalV2>, ReplayCompositionBindingErrorV1> {
    let proposal = reference_fact_proposal_v2;
    validate_native_reference_fact_evidence_v1(
        r0,
        r0,
        source,
        NativeReferenceFactEvidenceV1 {
            source_binding_identity: correction.source_binding_identity(),
            source_binding_fact_digest: correction.source_binding_fact_digest(),
            source_binding_lineage_root: correction.source_binding_lineage_root(),
            source_binding_lineage_version: correction.source_binding_lineage_version(),
            provider_available_ns: correction.provider_available_ns(),
            retrieval_ns: correction.retrieval_ns(),
            correction_publication_ns: correction.correction_publication_ns(),
            owner_observation_ns: correction.owner_observation_ns(),
            decision_cut: correction.decision_cut(),
            r0_coordinate_identity: correction.r0_coordinate_identity(),
            r0_coordinate_digest: correction.r0_coordinate_digest(),
        },
    )?;
    Ok(vec![proposal(
        ReplayReferenceFactValueV2::CorrectionPolicy {
            stream_identity: correction.stream_identity().to_vec(),
            sequence: correction.sequence(),
            successor_only: correction.successor_only(),
        },
        ReplayReferenceFactTimeV2 {
            effective_from_ns: correction.effective_from_ns(),
            effective_until_ns: correction.effective_until_ns(),
            provider_available_ns: correction.provider_available_ns(),
            retrieval_ns: correction.retrieval_ns(),
            correction_publication_ns: correction.correction_publication_ns(),
            owner_observation_ns: correction.owner_observation_ns(),
            decision_cut: correction.decision_cut(),
        },
        correction.source_binding_identity(),
        correction.identity(),
    )])
}

fn membership_reference_facts_v2(
    universe: &crate::owner::universe_selection::UniverseSelectionReadbackV1,
    source: &crate::owner::source_binding::SourceBindingOwnerReadback,
) -> Result<Vec<ReplayReferenceFactProposalV2>, ReplayCompositionBindingErrorV1> {
    let proposal = reference_fact_proposal_v2;

    if universe.record().source_binding_lineage_root() != source.lineage_root() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    universe
        .record()
        .membership()
        .iter()
        .map(|member| {
            if member.source_binding_lineage_root() != source.lineage_root() {
                return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
            }
            Ok(proposal(
                ReplayReferenceFactValueV2::HistoricalMembership {
                    selection_identity: universe.record().identity(),
                    member_key: member.member_key().to_vec(),
                    instrument: member.instrument().to_vec(),
                    included: member.included(),
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: member.effective_from_ns(),
                    effective_until_ns: member.effective_until_ns(),
                    provider_available_ns: member.provider_available_ns(),
                    retrieval_ns: member.retrieval_ns(),
                    correction_publication_ns: member.correction_publication_ns(),
                    owner_observation_ns: member.owner_observation_ns(),
                    decision_cut: member.decision_cut(),
                },
                source.binding_id(),
                member.correction_frontier_digest(),
            ))
        })
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()
}

/// Maps a reader-side failure onto the admission's own bounded categories.
///
/// The reader can only fail in three ways that matter to a caller: the locator names nothing, the
/// bytes do not authenticate, or the Composer side is unreachable. Everything else is a store
/// failure rather than a statement about the Design.
fn map_admission_reader_error(
    error: ReplayCompositionBindingErrorV1,
) -> StrategyInputBindingAdmissionErrorV1 {
    match error {
        ReplayCompositionBindingErrorV1::IncompleteComposition
        | ReplayCompositionBindingErrorV1::InvalidRequest => {
            StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign
        }
        ReplayCompositionBindingErrorV1::DigestMismatch => {
            StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted
        }
        // Named rather than left to the catch-all below, whose contract is that everything it
        // absorbs is a store failure. This one is not: a source declared that it does not know its
        // own adjustment rule, and the native re-derivation refused on that. Reporting it as
        // `StoreUnavailable` would send a reader to look at the database for something a source
        // said about itself.
        ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown => {
            StrategyInputBindingAdmissionErrorV1::BindingUnavailable
        }
        // Raised only by issuance and recovery, which this reader never calls. Named so that it is
        // classified by its meaning - an identity reused for a different request - if it ever
        // reaches here, rather than reported as the store being unreachable.
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict => {
            StrategyInputBindingAdmissionErrorV1::RequestConflict
        }
        // Stored custody that contradicts itself, like a digest that does not reproduce.
        ReplayCompositionBindingErrorV1::CompositionShapeMismatch => {
            StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted
        }
        // Raised only while issuing a universe-member aggregate, which this reader never does.
        ReplayCompositionBindingErrorV1::UniverseFrameMismatch => {
            StrategyInputBindingAdmissionErrorV1::BindingUnavailable
        }
        // Listed rather than left to a wildcard, so that a variant added later cannot become a
        // store failure without someone deciding that it is one.
        ReplayCompositionBindingErrorV1::NonCanonicalOrder
        | ReplayCompositionBindingErrorV1::DependencyMismatch
        | ReplayCompositionBindingErrorV1::UnknownBinding
        | ReplayCompositionBindingErrorV1::AmbiguousBinding
        | ReplayCompositionBindingErrorV1::LegacyUnbound
        | ReplayCompositionBindingErrorV1::ReplayV2Unavailable => {
            StrategyInputBindingAdmissionErrorV1::StoreUnavailable
        }
    }
}

/// PostgreSQL's default names for the three unique constraints of
/// `market_data_private.replay_composition_issuances_v1`. `map_issuance_insert_error` reads them,
/// so renaming a constraint changes that mapping; the ordered chain reads the live names back from
/// `pg_constraint` and fails if they drift from these.
pub(crate) const ISSUANCE_IDENTITY_CONSTRAINT: &str = "replay_composition_issuances_v1_pkey";
pub(crate) const ISSUANCE_MEANING_CONSTRAINT: &str =
    "replay_composition_issuances_v1_request_meaning_digest_key";
pub(crate) const ISSUANCE_BINDING_CONSTRAINT: &str =
    "replay_composition_issuances_v1_binding_identity_key";

/// Maps a failed issuance insert by the constraint that refused it.
///
/// The three unique constraints mean different things. The identity is locked and checked before
/// this write, so a unique violation on it is two sends of the same identity racing; the loser is
/// answered as unavailable, and its retry reaches the identity check, which knows the stored
/// request and says exactly whether this one conflicts or is the same. The meaning and binding are
/// not checked first, and the binding and market facts writes before this one accept identical
/// content, so a violation there is deterministic: this request is already stored under another
/// identity. That is `IssuanceIdentityConflict`, because a retry would meet it every time.
///
/// Anything else is the store's, including a unique violation on a constraint this does not name:
/// a constraint added later is not a statement about the caller until someone decides it is.
fn map_issuance_insert_error(error: &sqlx::Error) -> ReplayCompositionBindingErrorV1 {
    let constraint = error
        .as_database_error()
        .filter(|database| database.is_unique_violation())
        .and_then(sqlx::error::DatabaseError::constraint);
    match constraint {
        Some(ISSUANCE_MEANING_CONSTRAINT | ISSUANCE_BINDING_CONSTRAINT) => {
            ReplayCompositionBindingErrorV1::IssuanceIdentityConflict
        }
        // Two sends of the same identity racing; the retry reaches the identity check.
        Some(ISSUANCE_IDENTITY_CONSTRAINT) => ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
        // A constraint added later, or not a unique violation at all.
        Some(_) | None => ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
    }
}

#[cfg(test)]
mod issuance_insert_error_tests {
    use std::{borrow::Cow, error::Error, fmt::Display};

    use rstest::rstest;
    use sqlx::error::{DatabaseError, ErrorKind};

    use super::*;

    /// A database error of one chosen kind and constraint, because only PostgreSQL can raise a
    /// real one. The kind is copied out variant by variant: `ErrorKind` derives neither `Clone` nor
    /// `Copy`, and it is `#[non_exhaustive]`.
    #[derive(Debug)]
    struct Refusal(ErrorKind, Option<&'static str>);

    impl Display for Refusal {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(formatter, "{:?} on {:?}", self.0, self.1)
        }
    }

    impl Error for Refusal {}

    impl DatabaseError for Refusal {
        fn message(&self) -> &'static str {
            "database error of a chosen kind"
        }

        fn code(&self) -> Option<Cow<'_, str>> {
            None
        }

        fn constraint(&self) -> Option<&str> {
            self.1
        }

        fn as_error(&self) -> &(dyn Error + Send + Sync + 'static) {
            self
        }

        fn as_error_mut(&mut self) -> &mut (dyn Error + Send + Sync + 'static) {
            self
        }

        fn into_error(self: Box<Self>) -> Box<dyn Error + Send + Sync + 'static> {
            self
        }

        fn kind(&self) -> ErrorKind {
            match self.0 {
                ErrorKind::UniqueViolation => ErrorKind::UniqueViolation,
                ErrorKind::ForeignKeyViolation => ErrorKind::ForeignKeyViolation,
                ErrorKind::NotNullViolation => ErrorKind::NotNullViolation,
                ErrorKind::CheckViolation => ErrorKind::CheckViolation,
                _ => ErrorKind::Other,
            }
        }
    }

    #[rstest]
    #[case::identity_race(
        ErrorKind::UniqueViolation,
        Some(ISSUANCE_IDENTITY_CONSTRAINT),
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    #[case::request_under_another_identity(
        ErrorKind::UniqueViolation,
        Some(ISSUANCE_MEANING_CONSTRAINT),
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict
    )]
    #[case::binding_under_another_identity(
        ErrorKind::UniqueViolation,
        Some(ISSUANCE_BINDING_CONSTRAINT),
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict
    )]
    #[case::unnamed_constraint(
        ErrorKind::UniqueViolation,
        Some("replay_composition_issuances_v1_added_later_key"),
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    #[case::no_constraint(
        ErrorKind::UniqueViolation,
        None,
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    #[case::check_on_a_named_constraint(
        ErrorKind::CheckViolation,
        Some(ISSUANCE_MEANING_CONSTRAINT),
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    #[case::foreign_key(
        ErrorKind::ForeignKeyViolation,
        None,
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    #[case::other(
        ErrorKind::Other,
        None,
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
    )]
    fn an_issuance_refusal_follows_the_constraint_that_raised_it(
        #[case] kind: ErrorKind,
        #[case] constraint: Option<&'static str>,
        #[case] expected: ReplayCompositionBindingErrorV1,
    ) {
        let error = sqlx::Error::Database(Box::new(Refusal(kind, constraint)));
        assert_eq!(map_issuance_insert_error(&error), expected);
    }

    #[rstest]
    #[case::pool_timed_out(sqlx::Error::PoolTimedOut)]
    #[case::pool_closed(sqlx::Error::PoolClosed)]
    #[case::worker_crashed(sqlx::Error::WorkerCrashed)]
    fn a_failure_outside_the_database_is_the_store(#[case] error: sqlx::Error) {
        assert_eq!(
            map_issuance_insert_error(&error),
            ReplayCompositionBindingErrorV1::ReplayV2Unavailable
        );
    }
}

#[cfg(test)]
mod composer_facade_tests {
    use super::*;
    use rstest::rstest;

    /// The six variants that used to reach a wildcard are pinned to the answer the wildcard gave, so
    /// listing them changed nothing; the one new variant is pinned to its own meaning.
    #[rstest]
    #[case::incomplete(
        ReplayCompositionBindingErrorV1::IncompleteComposition,
        StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign
    )]
    #[case::invalid(
        ReplayCompositionBindingErrorV1::InvalidRequest,
        StrategyInputBindingAdmissionErrorV1::UnknownAuthenticatedDesign
    )]
    #[case::digest(
        ReplayCompositionBindingErrorV1::DigestMismatch,
        StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted
    )]
    #[case::price_adjustment(
        ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown,
        StrategyInputBindingAdmissionErrorV1::BindingUnavailable
    )]
    #[case::identity_conflict(
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict,
        StrategyInputBindingAdmissionErrorV1::RequestConflict
    )]
    #[case::non_canonical(
        ReplayCompositionBindingErrorV1::NonCanonicalOrder,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    #[case::dependency(
        ReplayCompositionBindingErrorV1::DependencyMismatch,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    #[case::unknown_binding(
        ReplayCompositionBindingErrorV1::UnknownBinding,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    #[case::ambiguous(
        ReplayCompositionBindingErrorV1::AmbiguousBinding,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    #[case::legacy(
        ReplayCompositionBindingErrorV1::LegacyUnbound,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    #[case::unavailable(
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
        StrategyInputBindingAdmissionErrorV1::StoreUnavailable
    )]
    fn every_reader_failure_has_a_named_admission_answer(
        #[case] error: ReplayCompositionBindingErrorV1,
        #[case] expected: StrategyInputBindingAdmissionErrorV1,
    ) {
        assert_eq!(map_admission_reader_error(error), expected);
    }

    #[rstest]
    fn composer_reads_use_only_the_exact_owner_facade() {
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains(COMPOSER_ROLE_SET_RESOLVER_V1));
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains(COMPOSER_NATIVE_JOIN_RESOLVER_V1));
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains(COMPOSER_CUT_LOCK_V1));
        assert!(
            COMPOSER_CUT_LOCK_QUERY_V1
                .contains("composer_owner_api.lock_replay_composition_cut_v1(")
        );
        assert!(COMPOSER_ROLE_SET_RESOLVE_QUERY_V1.contains(
            "FROM composer_owner_api.resolve_strategy_design_role_set_attestation_v1($1,$2,$3,$4,$5,$6,$7)"
        ));
        assert!(COMPOSER_NATIVE_JOIN_RESOLVE_QUERY_V1.contains(
            "FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)"
        ));

        for query in [
            COMPOSER_ROLE_SET_RESOLVE_QUERY_V1,
            COMPOSER_NATIVE_JOIN_RESOLVE_QUERY_V1,
        ] {
            assert!(!query.contains("composer_private"));
            assert!(!query.contains("public."));
            assert!(!query.contains("rd_owner_api"));
        }
    }

    #[rstest]
    fn composer_reader_requires_execute_only_without_owner_membership() {
        let exact = || ComposerReaderAclV1 {
            schema_usage: true,
            schema_create: false,
            private_schema_usage: false,
            private_schema_create: false,
            function_execute: true,
            native_function_execute: true,
            cut_lock_execute: false,
            raw_select: false,
            raw_write: false,
            native_raw_select: false,
            native_raw_write: false,
            composer_owner_member: false,
            rd_schema_usage: true,
            rd_schema_create: false,
            design_role_intent_execute: true,
            design_role_intent_raw: false,
        };
        assert!(composer_reader_acl_values_are_exact(&exact(), false));
        let mut owner = exact();
        owner.cut_lock_execute = true;
        assert!(composer_reader_acl_values_are_exact(&owner, true));

        let admitted = [
            true, false, false, false, true, true, false, false, false, false, false, false, true,
            false, true, false,
        ];

        for denied in 0..admitted.len() {
            let mut values = admitted;
            values[denied] = !values[denied];
            assert!(!composer_reader_acl_values_are_exact(
                &ComposerReaderAclV1 {
                    schema_usage: values[0],
                    schema_create: values[1],
                    private_schema_usage: values[2],
                    private_schema_create: values[3],
                    function_execute: values[4],
                    native_function_execute: values[5],
                    cut_lock_execute: values[6],
                    raw_select: values[7],
                    raw_write: values[8],
                    native_raw_select: values[9],
                    native_raw_write: values[10],
                    composer_owner_member: values[11],
                    rd_schema_usage: values[12],
                    rd_schema_create: values[13],
                    design_role_intent_execute: values[14],
                    design_role_intent_raw: values[15],
                },
                false,
            ));
        }
        assert!(
            COMPOSER_READER_ACL_QUERY_V1
                .contains("relation.relname='rd_develop_strategy_design_role_set_attestations_v1'")
        );
        assert!(
            COMPOSER_READER_ACL_QUERY_V1
                .contains("relation.relname='rd_develop_strategy_design_native_joins_v1'")
        );
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains("'composer_owner','MEMBER'"));
        assert!(!COMPOSER_READER_ACL_QUERY_V1.contains("public."));
        // The reader reaches exactly one R&D function and no other, so the ACL names that schema
        // once. A second name here would be a second R&D capability nobody proved bounded.
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains(RD_DESIGN_ROLE_INTENT_RESOLVER_V1));
        assert_eq!(
            COMPOSER_READER_ACL_QUERY_V1
                .matches("rd_owner_api.")
                .count(),
            1
        );
    }

    #[rstest]
    fn composer_private_acl_checks_resolve_relations_by_catalog_oid() {
        assert_eq!(
            COMPOSER_READER_ACL_QUERY_V1
                .matches("JOIN pg_catalog.pg_namespace")
                .count(),
            3
        );
        assert_eq!(
            COMPOSER_READER_ACL_QUERY_V1
                .matches("has_table_privilege(current_user,role_set_relation.oid,")
                .count(),
            2
        );
        assert_eq!(
            COMPOSER_READER_ACL_QUERY_V1
                .matches("has_table_privilege(current_user,native_join_relation.oid,")
                .count(),
            2
        );
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains("FROM role_set_relation"));
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains("CROSS JOIN native_join_relation"));

        assert_eq!(
            MARKET_OWNER_COMPOSER_ACL_QUERY_V1
                .matches("JOIN pg_catalog.pg_namespace")
                .count(),
            1
        );
        assert_eq!(
            MARKET_OWNER_COMPOSER_ACL_QUERY_V1
                .matches("has_table_privilege(current_user,raw_relation.oid,")
                .count(),
            1
        );
        assert!(MARKET_OWNER_COMPOSER_ACL_QUERY_V1.contains("FROM raw_relation"));

        for query in [
            COMPOSER_READER_ACL_QUERY_V1,
            MARKET_OWNER_COMPOSER_ACL_QUERY_V1,
        ] {
            assert!(!query.contains("has_table_privilege(current_user,'"));
        }
    }

    /// The admitted reader principal is admitted, and every other one is refused by name.
    ///
    /// Driven here rather than end to end: reaching the guard through the real path needs a
    /// connection under a principal other than `market_data_reader`, which is an ordered-chain
    /// entry of its own. That entry is constructible - point the reader at the `rd_owner` URL -
    /// and is not written yet, so this covers the decision and not its wiring.
    #[rstest]
    #[case::admitted("market_data_reader", true)]
    #[case::owner_principal("rd_owner", false)]
    #[case::composer("composer_reader", false)]
    #[case::empty("", false)]
    fn only_the_admitted_reader_principal_may_resolve_a_design_intent(
        #[case] session_user: &str,
        #[case] admitted: bool,
    ) {
        let outcome = ReplayCompositionOwnerV1::admit_design_intent_reader_principal(session_user);

        assert_eq!(outcome.is_ok(), admitted, "{session_user}");
        if !admitted {
            assert_eq!(
                outcome.unwrap_err(),
                StrategyInputBindingAdmissionErrorV1::StoreUnavailable,
                "a wrong principal is refused as an unusable store, not as a missing Design"
            );
        }
    }
}

/// Decides the initial PIT request an attested Design registers against, from its published role
/// intent.
///
/// A Design with no universe-member role, or with no published intent, names none. An intent of
/// another Design or another Research request authenticates nothing for this attestation and is
/// refused, so an attestation can never borrow a different Design's PIT request.
fn attested_initial_pit_request_from_intent_v1(
    receipt: &StrategyDesignRoleSetReceiptV1,
    intent: Option<&StrategyDesignRoleIntentV1>,
) -> Result<
    Option<crate::owner::strategy_design_role_intent_v1::InitialPitRequestLocatorV1>,
    StrategyInputBindingAdmissionErrorV1,
> {
    if !receipt.roles.iter().any(|role| {
        role.scope == crate::owner::strategy_input_binding::UNIVERSE_MEMBERS_ROLE_SCOPE_V1
    }) {
        return Ok(None);
    }
    let Some(intent) = intent else {
        return Ok(None);
    };

    if intent.design_identity() != receipt.design_identity
        || intent.research_request_identity() != receipt.research_request_identity
    {
        return Err(StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted);
    }
    Ok(intent.initial_pit_request())
}

#[cfg(test)]
mod attested_initial_pit_request_tests {
    use rstest::rstest;

    use super::attested_initial_pit_request_from_intent_v1;
    use crate::owner::{
        source_binding::BindingDigest,
        strategy_design_role_intent_v1::{InitialPitRequestLocatorV1, StrategyDesignRoleIntentV1},
        strategy_design_role_set::{
            StrategyDesignRoleEntryV1, StrategyDesignRoleSetLocatorV1,
            StrategyDesignRoleSetReceiptV1,
        },
        strategy_input_binding_admission_v1::StrategyInputBindingAdmissionErrorV1,
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn role(scope: &str, instrument: &str) -> StrategyDesignRoleEntryV1 {
        StrategyDesignRoleEntryV1 {
            role_identity: d(3),
            semantic_id: "close".into(),
            fact_class: "MARKET_DATA".into(),
            instrument: instrument.into(),
            scope: scope.into(),
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
            channel: "MARKET".into(),
            timeframe: "1M".into(),
            unit: "PRICE".into(),
            scale: 2,
            value_type: "I128".into(),
        }
    }

    fn receipt(role: StrategyDesignRoleEntryV1) -> StrategyDesignRoleSetReceiptV1 {
        StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
            StrategyDesignRoleSetLocatorV1 {
                schema_version: 2,
                request_identity: "composer-request".into(),
                operation_receipt_identity: d(20),
                artifact_locator: "artifact".into(),
                artifact_identity: d(21),
                canonical_plan_digest: d(22),
                design_digest: d(23),
            },
            d(1),
            d(24),
            d(2),
            d(23),
            d(25),
            vec![role],
            vec![],
        )
        .unwrap()
    }

    fn locator() -> InitialPitRequestLocatorV1 {
        InitialPitRequestLocatorV1 {
            pit_request_identity: d(40),
            pit_request_digest: d(41),
        }
    }

    fn intent(research: BindingDigest, design: BindingDigest) -> StrategyDesignRoleIntentV1 {
        StrategyDesignRoleIntentV1::from_rd_owner_projection_with_initial_pit(
            research,
            d(30),
            d(31),
            design,
            d(23),
            // The decision reads only the intent's Design, Research request and named request.
            vec![role(r#"{"kind":"EXACT_INSTRUMENT"}"#, "AAPL")],
            locator(),
        )
        .unwrap()
    }

    #[rstest]
    fn an_attestation_takes_only_its_own_designs_initial_pit_request() {
        let universe = receipt(role(r#"{"kind":"UNIVERSE_MEMBERS"}"#, ""));
        let exact = receipt(role(r#"{"kind":"EXACT_INSTRUMENT"}"#, "AAPL"));

        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&universe, Some(&intent(d(1), d(2)))),
            Ok(Some(locator()))
        );
        // Nothing to take: no universe-member role, or no published intent.
        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&exact, Some(&intent(d(1), d(2)))),
            Ok(None)
        );
        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&universe, None),
            Ok(None)
        );
        // An intent of another Design, or of the same Design under another Research request.
        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&universe, Some(&intent(d(1), d(9)))),
            Err(StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted)
        );
        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&universe, Some(&intent(d(8), d(2)))),
            Err(StrategyInputBindingAdmissionErrorV1::AuthenticatedDesignUntrusted)
        );
        // A schema 1 intent names no request.
        let schema_one = StrategyDesignRoleIntentV1::from_rd_owner_projection(
            d(1),
            d(30),
            d(31),
            d(2),
            d(23),
            vec![role(r#"{"kind":"EXACT_INSTRUMENT"}"#, "AAPL")],
        )
        .unwrap();
        assert_eq!(
            attested_initial_pit_request_from_intent_v1(&universe, Some(&schema_one)),
            Ok(None)
        );
    }
}
