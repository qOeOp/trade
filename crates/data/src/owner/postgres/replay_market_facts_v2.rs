//! Independent native dependency ports required before `ReplayMarketFactsV2` composition.
//!
//! No aggregate resolver or positive fallback is defined here. In particular, a sample projection
//! cannot authenticate its joined-cut or observation-census subjects.

#![allow(dead_code, reason = "W0 freezes the bounded Replay W1 dependency seam")]

use crate::owner::replay_market_facts_v2::{
    AuthenticatedComposerNativeJoinV1, ReplayCompositionBindingErrorV1,
    ReplayCompositionBindingLocatorV1, ReplayCompositionDurableIssuanceResponseV1,
    ReplayCompositionIssuanceLocatorV1, ReplayCompositionIssuanceResponseV1,
    ReplayCompositionLocatorOnlyIssuanceRequestV1, ReplayCompositionOwnerV1,
    ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2, ReplayMarketDependencyRefV2,
    ReplayPriceAdjustmentV2, ReplayReferenceFactKindV2, ReplayReferenceFactTimeV2,
    ReplayReferenceFactValueV2, ReplayTimestampBasisV2, UntrustedComposerNativeJoinRequestV1,
    UntrustedReplayMarketFactsCompositionRequestV1,
    authority::{
        ReplayMarketFactsEvidenceV2, ReplayNativeChainEvidenceV2, ReplayReferenceFactCutProposalV2,
        ReplayReferenceFactProposalV2, ReplayReferenceFactScopeProposalV2,
        ReplayVerifiedNativeDerivedRecordV2, ReplayVerifiedNativeRecordV2, pit_clock_digest,
    },
    composition::{
        ReplayCompositionBindingEvidenceV1, ReplayCompositionNativeLocatorKindV1,
        ReplayCompositionNativeLocatorV1, ReplayCompositionRoleEvidenceV1,
        compose_replay_market_facts_v2, issue_replay_composition_binding_v1,
    },
    postgres::{
        PreparedReplayMarketFactsStorageV2, persist_replay_composition_binding_in_transaction_v1,
        persist_replay_market_facts_in_transaction_v2,
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
    strategy_design_role_set::{
        AuthenticatedStrategyDesignRoleSetV1, StrategyDesignNativeJoinReceiptV1,
        StrategyDesignRoleSetLocatorV1, StrategyDesignRoleSetReceiptV1,
        authenticate_durable_strategy_design_role_set_v1,
    },
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputScope, request_matches_authenticated_role_v1,
    },
    strategy_input_joined_cut::{
        StrategyInputJoinedCutReceiptV1, UntrustedStrategyInputJoinClaimV1,
    },
    time_zone::UntrustedTimeZoneLocatorV1,
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};
use crate::owner::{
    observation_census::{ObservationCensusResolverV1, StrategyInputJoinedCutOwnerResolverV1},
    sample_projection::StrategyInputSampleProjectionResolverV2,
    universe_selection::UniverseSelectionResolverV1,
};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row, postgres::PgPoolOptions};
use std::sync::atomic::{AtomicU64, Ordering};

const REPLAY_COMPOSITION_ISSUANCE_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_issuances_v1 (request_identity BYTEA PRIMARY KEY, request_meaning_digest BYTEA NOT NULL UNIQUE, request_bytes BYTEA NOT NULL, binding_identity BYTEA NOT NULL UNIQUE, binding_digest BYTEA NOT NULL, response_bytes BYTEA NOT NULL)",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_issuances_v1 FROM PUBLIC",
];
const COMPOSER_ROLE_SET_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_NATIVE_JOIN_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_CUT_LOCK_V1: &str = "composer_owner_api.lock_replay_composition_cut_v1(text)";
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
                pg_catalog.pg_has_role(current_user,'composer_owner','MEMBER') AS composer_owner_member
           FROM role_set_relation
           CROSS JOIN native_join_relation";
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
                NOT pg_catalog.has_table_privilege(current_user,raw_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_raw
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
                    && dependency.binding_receipt_digest
                        == *declaration.binding().digest().as_bytes()
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

        for statement in REPLAY_COMPOSITION_ISSUANCE_SCHEMA_V1 {
            sqlx::query(*statement)
                .execute(&owner.pool)
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        }
        Ok(())
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
            && market_acl.try_get::<bool, _>("no_raw").unwrap_or(false))
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

        let (joined_request, joined_custody, joined_cut_receipt_digest) =
            super::observation_census::load_strategy_input_joined_cut_custody_v1(
                &mut transaction,
                &joined_locator,
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
        if issuance_locator.request_identity().as_bytes() == &[0; 32] {
            return Err(ReplayCompositionBindingErrorV1::InvalidRequest);
        }
        let request_bytes = serde_json::to_vec(request)
            .map_err(|_| ReplayCompositionBindingErrorV1::InvalidRequest)?;
        let actual_meaning =
            crate::owner::replay_market_facts_v2::replay_composition_issuance_meaning_digest_v1(
                request,
            )?;

        if actual_meaning != issuance_locator.request_meaning_digest() {
            return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
        }
        let replay = request.replay_request();
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
            lock_composer_cut_v1(
                &mut reader_transaction,
                &request.composer_locator().request_identity,
            )
            .await?;
            let authenticated_role_set = Self::resolve_role_set_attestation(
                &mut reader_transaction,
                request.composer_locator(),
            )
            .await?;
            let native_join = Self::resolve_native_join_attestation(
                &mut reader_transaction,
                request.composer_locator(),
            )
            .await?;
            Ok((reader_challenge, authenticated_role_set, native_join))
        }
        .await;
        let (reader_challenge, authenticated_role_set, native_join) = match reader_preflight {
            Ok(preflight) => preflight,
            Err(operation_error) => {
                reader_transaction
                    .rollback()
                    .await
                    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
                return Err(operation_error);
            }
        };
        let receipt = authenticated_role_set.receipt();
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
        let outcome = Box::pin(async {
        lock_composer_cut_v1(
            &mut transaction,
            &request.composer_locator().request_identity,
        )
        .await?;
        verify_market_challenge_v1(
            &mut reader_transaction,
            &mut transaction,
            &reader_challenge,
            &market_challenge,
        )
        .await?;
        lock_issuance_identity(&mut transaction, issuance_locator.request_identity()).await?;
        let validated_native_join = validate_native_join_v4(&mut transaction, &native_join).await?;

        let r0_locator = request.reference_fact_r0_locator();
        let r0 = super::reference_fact_coordinates::recover_reference_fact_r0_in_transaction_v1(
            &mut transaction,
            UntrustedReferenceFactR0LocatorV1 {
                request_identity: r0_locator.request_identity(),
                request_meaning_digest: r0_locator.request_meaning_digest(),
            },
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let semantics_locator = request.market_semantics_locator();
        let semantics = super::market_semantics::recover_market_semantics_in_transaction_v1(
            &mut transaction,
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
            &mut transaction,
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
            let declaration = super::strategy_input_binding_registry::recover_strategy_input_binding_declaration_v1(
                &mut transaction,
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
                binding_identity: declaration.binding().digest(),
                binding_digest: declaration.binding().digest(),
            });
            declarations.push(declaration);
        }
        let census_locator = request.observation_census_locator();
        let census_row = sqlx::query("SELECT request_meaning_digest,request_bytes,census_identity,census_bytes FROM market_data_private.observation_census_records_v1 WHERE request_identity=$1")
            .bind(census_locator.request_identity().as_bytes().as_slice())
            .fetch_optional(&mut *transaction)
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
        let census =
            crate::owner::observation_census::authority::decode_observation_census_storage_v1(
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
                &mut transaction,
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
            &mut transaction,
            receipt,
            census_request.join_claim(),
            &declarations,
            authenticated_joined.record().joined_cut_receipt(),
            &validated_native_join,
        )
        .await?;

        validate_exact_request_row(
            &mut transaction,
            "instrument_master_receipts_v1",
            request.instrument_master_locator(),
        )
        .await?;

        let calendar_locator = request.calendar_locator();
        let calendar = super::calendar::recover_calendar_v1(
            &mut transaction,
            UntrustedCalendarLocatorV1::from_untrusted(
                calendar_locator.request_identity(),
                calendar_locator.request_meaning_digest(),
            ),
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let session_locator = request.session_locator();
        let session = super::session::recover_session_in_transaction_v1(
            &mut transaction,
            UntrustedSessionLocatorV1 {
                request_identity: session_locator.request_identity(),
                request_meaning_digest: session_locator.request_meaning_digest(),
            },
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let time_zone_locator = request.time_zone_locator();
        let time_zone = super::time_zone::recover_time_zone_in_transaction_v1(
            &mut transaction,
            UntrustedTimeZoneLocatorV1 {
                request_identity: time_zone_locator.request_identity(),
                request_meaning_digest: time_zone_locator.request_meaning_digest(),
            },
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let action_locator = request.corporate_action_locator();
        let corporate_action = super::corporate_action::recover_corporate_action_in_transaction_v1(
            &mut transaction,
            UntrustedCorporateActionLocatorV1 {
                request_identity: action_locator.request_identity(),
                request_meaning_digest: action_locator.request_meaning_digest(),
            },
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        let source =
            super::strategy_input_binding_registry::recover_strategy_input_binding_source_v1(
                &mut transaction,
                first_declaration_request
                    .as_ref()
                    .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?,
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
        if source.locator() != request.source_binding_locator() {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        let native_reference_r0s = recover_native_reference_r0s_v1(
            &mut transaction,
            &calendar,
            &session,
            &time_zone,
        )
        .await?;
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
            exact_instrument_reference(&mut transaction, request.instrument_master_locator())
                .await?;
        let instrument_cut_identity = instrument_master.cut_digest;

        if semantics
            .facts()
            .iter()
            .any(|fact| fact.instrument_master_cut_digest != instrument_cut_identity)
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }
        validate_exact_request_row(
            &mut transaction,
            "calendar_receipts_v1",
            request.calendar_locator(),
        )
        .await?;
        validate_exact_request_row(
            &mut transaction,
            "session_receipts_v1",
            request.session_locator(),
        )
        .await?;
        validate_exact_request_row(
            &mut transaction,
            "time_zone_receipts_v1",
            request.time_zone_locator(),
        )
        .await?;
        validate_exact_request_row(
            &mut transaction,
            "corporate_action_receipts_v1",
            request.corporate_action_locator(),
        )
        .await?;

        if issuance_exists(&mut transaction, issuance_locator.request_identity()).await? {
            let response =
                recover_issuance_in_transaction(&mut transaction, issuance_locator).await?;
            let stored_request_bytes: Vec<u8> = sqlx::query_scalar(
                "SELECT request_bytes FROM market_data_private.replay_composition_issuances_v1 WHERE request_identity=$1",
            )
            .bind(issuance_locator.request_identity().as_bytes().as_slice())
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            if stored_request_bytes != request_bytes {
                return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
            }
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
        persist_replay_composition_binding_in_transaction_v1(&mut transaction, &binding)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let native_chain = ReplayNativeChainEvidenceV2::from_verified_native_records_v4(
            ReplayVerifiedNativeRecordV2::from_verified_native_record(
                census_identity,
                census_identity,
            ),
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
        persist_replay_market_facts_in_transaction_v2(&mut transaction, &prepared)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let response =
            ReplayCompositionIssuanceResponseV1::from_authenticated(&binding, &replay_readback);
        let response_bytes = serde_json::to_vec(&response)
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        sqlx::query("INSERT INTO market_data_private.replay_composition_issuances_v1 (request_identity, request_meaning_digest, request_bytes, binding_identity, binding_digest, response_bytes) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(issuance_locator.request_identity().as_bytes().as_slice())
            .bind(issuance_locator.request_meaning_digest().as_bytes().as_slice())
            .bind(&request_bytes)
            .bind(binding.record().locator().binding_identity().as_bytes().as_slice())
            .bind(binding.record().locator().binding_digest().as_bytes().as_slice())
            .bind(&response_bytes)
            .execute(&mut *transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)?;
            Ok(ReplayCompositionDurableIssuanceResponseV1::from_exact_storage(response_bytes))
        })
        .await;

        match outcome {
            Ok(response) => {
                let market_terminal = transaction.commit().await;
                if market_terminal.is_err() {
                    prove_market_transaction_terminal_v1(
                        &mut reader_transaction,
                        &market_challenge,
                    )
                    .await?;
                    reader_transaction
                        .rollback()
                        .await
                        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
                    return match self.recover_issuance_v1(issuance_locator).await {
                        Ok(recovered)
                            if recovered.canonical_bytes() == response.canonical_bytes() =>
                        {
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
            Err(operation_error) => {
                let market_terminal = transaction.rollback().await;
                if market_terminal.is_err() {
                    prove_market_transaction_terminal_v1(
                        &mut reader_transaction,
                        &market_challenge,
                    )
                    .await?;
                }
                reader_transaction
                    .rollback()
                    .await
                    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
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
        return Err(ReplayCompositionBindingErrorV1::DigestMismatch);
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
    let r0_record = r0.record();
    if r0_record.evidence.pit_snapshot_identity != request.pit_locator().snapshot_identity
        || r0_record.evidence.pit_fact_digest != request.pit_locator().fact_digest
        || r0_record.evidence.source_binding_identity != source.binding_id()
        || r0_record.evidence.source_binding_fact_digest != source.fact_digest()
        || r0_record.evidence.source_binding_lineage_root != source.lineage_root()
        || r0_record.evidence.source_binding_lineage_version != source.lineage_version()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }

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
    let make_scope = |kind, identity| -> Result<_, ReplayCompositionBindingErrorV1> {
        Ok(ReplayReferenceFactScopeProposalV2 {
            pit_snapshot_identity: request.pit_locator().snapshot_identity,
            pit_decision_cut: request.pit_locator().time_evidence.decision_cut.value,
            pit_observed_at: request.pit_locator().time_evidence.observed_at,
            pit_valid_through: request.pit_locator().time_evidence.valid_through,
            pit_clock_digest: pit_clock_digest(
                request
                    .pit_locator()
                    .time_evidence
                    .decision_cut
                    .clock_identity
                    .as_bytes(),
                request
                    .pit_locator()
                    .time_evidence
                    .decision_cut
                    .clock_epoch
                    .as_bytes(),
            )
            .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?,
            replay_start_event_ns: request.replay_start_event_ns(),
            replay_end_event_ns_exclusive: request.replay_end_event_ns_exclusive(),
            authority_kind: kind,
            authority_identity: identity,
        })
    };
    let proposal =
        |value, time, source_identity, correction_identity| ReplayReferenceFactProposalV2 {
            value,
            time,
            source_identity,
            correction_identity,
        };
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
    let semantics_facts = semantics
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
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
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
    let correction_facts = vec![proposal(
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
    )];
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
    if universe.record().source_binding_lineage_root() != source.lineage_root() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let membership_facts = universe
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
        .collect::<Result<Vec<_>, ReplayCompositionBindingErrorV1>>()?;
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

pub(super) struct ReplayMarketFactsDependencyPortsV2<'a> {
    pub(super) universe_selection: &'a dyn UniverseSelectionResolverV1,
    pub(super) observation_census: &'a dyn ObservationCensusResolverV1,
    pub(super) joined_cut: &'a dyn StrategyInputJoinedCutOwnerResolverV1,
    pub(super) sample_projection: &'a dyn StrategyInputSampleProjectionResolverV2,
}

impl<'a> ReplayMarketFactsDependencyPortsV2<'a> {
    pub(super) const fn new(
        universe_selection: &'a dyn UniverseSelectionResolverV1,
        observation_census: &'a dyn ObservationCensusResolverV1,
        joined_cut: &'a dyn StrategyInputJoinedCutOwnerResolverV1,
        sample_projection: &'a dyn StrategyInputSampleProjectionResolverV2,
    ) -> Self {
        Self {
            universe_selection,
            observation_census,
            joined_cut,
            sample_projection,
        }
    }
}

#[cfg(test)]
mod composer_facade_tests {
    use super::*;
    use rstest::rstest;

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
        };
        assert!(composer_reader_acl_values_are_exact(&exact(), false));
        let mut owner = exact();
        owner.cut_lock_execute = true;
        assert!(composer_reader_acl_values_are_exact(&owner, true));

        for denied in 0..12 {
            let mut values = [
                true, false, false, false, true, true, false, false, false, false, false, false,
            ];
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
        assert!(!COMPOSER_READER_ACL_QUERY_V1.contains("rd_owner_api"));
    }

    #[rstest]
    fn composer_private_acl_checks_resolve_relations_by_catalog_oid() {
        assert_eq!(
            COMPOSER_READER_ACL_QUERY_V1
                .matches("JOIN pg_catalog.pg_namespace")
                .count(),
            2
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
}
