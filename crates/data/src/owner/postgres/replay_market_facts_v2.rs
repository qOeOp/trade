//! Independent native dependency ports required before `ReplayMarketFactsV2` composition.
//!
//! No aggregate resolver or positive fallback is defined here. In particular, a sample projection
//! cannot authenticate its joined-cut or observation-census subjects.

#![allow(dead_code, reason = "W0 freezes the bounded Replay W1 dependency seam")]

use crate::owner::replay_market_facts_v2::{
    ReplayCompositionBindingErrorV1, ReplayCompositionBindingLocatorV1,
    ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionIssuanceLocatorV1,
    ReplayCompositionIssuanceResponseV1, ReplayCompositionLocatorOnlyIssuanceRequestV1,
    ReplayCompositionOwnerV1, ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2,
    ReplayMarketDependencyRefV2, ReplayPriceAdjustmentV2, ReplayReferenceFactKindV2,
    ReplayReferenceFactTimeV2, ReplayReferenceFactValueV2, ReplayTimestampBasisV2,
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
    calendar::UntrustedCalendarLocatorV1,
    corporate_action::{CorporateActionTermsV1, UntrustedCorporateActionLocatorV1},
    correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
    market_semantics::UntrustedMarketSemanticsLocatorV1,
    reference_fact_coordinates::r0::UntrustedReferenceFactR0LocatorV1,
    reference_fact_coordinates::{
        AdmittedReferenceFactSourceV1, ReferenceFactClockV1, ReferenceFactCoordinateClaimV1,
        ReferenceFactEffectiveTimeV1, ReferenceFactFrontierV1, ReferenceFactPitCutV1,
        VerifiedReferenceFactCoordinatesV1,
    },
    sample_projection_v4::{ScheduleDependencyV4, StrategyInputSampleProjectionKindV4},
    session::UntrustedSessionLocatorV1,
    source_binding::BindingDigest,
    strategy_design_role_set::{
        AuthenticatedStrategyDesignRoleSetV1, StrategyDesignNativeJoinReceiptV1,
        StrategyDesignRoleSetLocatorV1, authenticate_durable_strategy_design_role_set_v1,
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
use sqlx::{Row, postgres::PgPoolOptions};

const REPLAY_COMPOSITION_ISSUANCE_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_issuances_v1 (request_identity BYTEA PRIMARY KEY, request_meaning_digest BYTEA NOT NULL UNIQUE, request_bytes BYTEA NOT NULL, binding_identity BYTEA NOT NULL UNIQUE, binding_digest BYTEA NOT NULL, response_bytes BYTEA NOT NULL)",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_issuances_v1 FROM PUBLIC",
];
const COMPOSER_ROLE_SET_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_NATIVE_JOIN_RESOLVER_V1: &str = "composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)";
const COMPOSER_CUT_LOCK_V1: &str = "composer_owner_api.lock_replay_composition_cut_v1(text)";
const COMPOSER_READER_ACL_QUERY_V1: &str = "SELECT
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','USAGE') AS schema_usage,
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','CREATE') AS schema_create,
                pg_catalog.has_schema_privilege(current_user,'composer_private','USAGE') AS private_schema_usage,
                pg_catalog.has_schema_privilege(current_user,'composer_private','CREATE') AS private_schema_create,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS function_execute,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS native_function_execute,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE') AS cut_lock_execute,
                pg_catalog.has_table_privilege(current_user,'composer_private.rd_develop_strategy_design_role_set_attestations_v1','SELECT') AS raw_select,
                pg_catalog.has_table_privilege(current_user,'composer_private.rd_develop_strategy_design_role_set_attestations_v1','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS raw_write,
                pg_catalog.has_table_privilege(current_user,'composer_private.rd_develop_strategy_design_native_joins_v1','SELECT') AS native_raw_select,
                pg_catalog.has_table_privilege(current_user,'composer_private.rd_develop_strategy_design_native_joins_v1','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS native_raw_write,
                pg_catalog.pg_has_role(current_user,'composer_owner','MEMBER') AS composer_owner_member";
const COMPOSER_ROLE_SET_RESOLVE_QUERY_V1: &str =
    "SELECT attestation_identity, attestation_digest, canonical_bytes
       FROM composer_owner_api.resolve_strategy_design_role_set_attestation_v1($1,$2,$3,$4,$5,$6,$7)";
const COMPOSER_NATIVE_JOIN_RESOLVE_QUERY_V1: &str = "SELECT native_join_digest,canonical_bytes
       FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)";
const COMPOSER_CUT_LOCK_QUERY_V1: &str =
    "SELECT composer_owner_api.lock_replay_composition_cut_v1($1)";
const COMPOSER_CUT_LOCK_SOURCE_V1: &str = "BEGIN
  IF session_user NOT IN ('market_data_reader','market_data_owner') OR current_user<>'composer_owner' THEN
    RAISE EXCEPTION 'Replay composition cut caller mismatch' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0)
  );
  LOCK TABLE
    composer_private.rd_develop_designs_v2,
    composer_private.rd_develop_plans_v2,
    composer_private.rd_develop_artifacts_v2,
    composer_private.rd_develop_artifact_modules_v2,
    composer_private.rd_develop_build_receipts_v2,
    composer_private.rd_develop_composer_receipts_v2,
    composer_private.rd_develop_host_receipts_v2,
    composer_private.rd_develop_operations_v2,
    composer_private.rd_develop_strategy_design_role_set_attestations_v1,
    composer_private.rd_develop_strategy_design_native_joins_v1,
    composer_private.rd_develop_outbox_v2
  IN SHARE MODE;
  RETURN pg_catalog.pg_backend_pid();
END";
const MARKET_OWNER_COMPOSER_ACL_QUERY_V1: &str = "SELECT
                pg_catalog.has_schema_privilege(current_user,'composer_owner_api','USAGE') AS schema_usage,
                NOT pg_catalog.has_schema_privilege(current_user,'composer_owner_api','CREATE') AS no_schema_create,
                pg_catalog.has_function_privilege(current_user,'composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE') AS cut_lock_execute,
                NOT pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS no_role_resolve,
                NOT pg_catalog.has_function_privilege(current_user,'composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE') AS no_native_resolve,
                NOT pg_catalog.has_schema_privilege(current_user,'composer_private','USAGE,CREATE') AS no_private_schema,
                NOT pg_catalog.has_table_privilege(current_user,'composer_private.rd_develop_operations_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_raw";
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

async fn validate_native_join_v4(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    attestation: &StrategyDesignNativeJoinReceiptV1,
) -> Result<Vec<(BindingDigest, BindingDigest)>, ReplayCompositionBindingErrorV1> {
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
        || decoded.subject_identity() != *attestation.joined_cut_digest().as_bytes()
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
    Ok(dependencies
        .iter()
        .map(|dependency| {
            (
                BindingDigest::from_untrusted_bytes(dependency.role_identity),
                BindingDigest::from_untrusted_bytes(dependency.binding_receipt_digest),
            )
        })
        .collect())
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
            .begin()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *reader_transaction)
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
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
        let authenticated_role_set =
            Self::resolve_role_set_attestation(&mut reader_transaction, request.composer_locator())
                .await?;
        let receipt = authenticated_role_set.receipt();
        let native_join = Self::resolve_native_join_attestation(
            &mut reader_transaction,
            request.composer_locator(),
        )
        .await?;
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
        verify_owner_handoff_v1(
            &mut reader_transaction,
            &mut transaction,
            issuance_locator.request_identity(),
            reader_challenge,
        )
        .await?;
        lock_composer_cut_v1(
            &mut transaction,
            &request.composer_locator().request_identity,
        )
        .await?;
        lock_issuance_identity(&mut transaction, issuance_locator.request_identity()).await?;
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
            transaction
                .commit()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            reader_transaction
                .rollback()
                .await
                .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
            return Ok(response);
        }
        let native_join_roles = validate_native_join_v4(&mut transaction, &native_join).await?;

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
            || sample.identity() != native_join.projection_receipt_digest()
            || sample.digest() != native_join.projection_receipt_digest()
            || native_join_roles
                != roles
                    .iter()
                    .map(|role| (role.role_identity, role.binding_digest))
                    .collect::<Vec<_>>()
        {
            return Err(ReplayCompositionBindingErrorV1::IncompleteComposition);
        }

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
        let instrument_cut_identity =
            exact_instrument_cut_identity(&mut transaction, request.instrument_master_locator())
                .await?;
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
            instrument_cut_identity,
            source.binding_id(),
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
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        reader_transaction
            .rollback()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(ReplayCompositionDurableIssuanceResponseV1::from_exact_storage(response_bytes))
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
    let (key, backend, transaction_identity): (i64, i64, String) = sqlx::query_as(
        "SELECT pg_catalog.hashtextextended(pg_catalog.encode($1,'hex')||':'||$2||':'||pg_catalog.random()::text||':'||pg_catalog.clock_timestamp()::text,pg_catalog.pg_backend_pid()::bigint),pg_catalog.pg_backend_pid()::bigint,pg_catalog.txid_current()::text",
    )
    .bind(request_identity.as_bytes().as_slice())
    .bind(side)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    Ok(OwnerChallengeV1 {
        key,
        backend,
        transaction_identity,
    })
}

async fn verify_owner_handoff_v1(
    reader: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    market: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_identity: BindingDigest,
    reader_challenge: OwnerChallengeV1,
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
    let market_challenge = begin_owner_challenge_v1(market, request_identity, "market").await?;
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

async fn exact_instrument_cut_identity(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: crate::owner::replay_market_facts_v2::ReplayCompositionRequestLocatorV1,
) -> Result<crate::owner::source_binding::BindingDigest, ReplayCompositionBindingErrorV1> {
    let row = sqlx::query("SELECT request_meaning_digest,cut_identity FROM market_data_private.instrument_master_receipts_v1 WHERE request_identity=$1")
        .bind(locator.request_identity().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?
        .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?;
    if digest_column(&row, "request_meaning_digest")? != locator.request_meaning_digest() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    digest_column(&row, "cut_identity")
}

fn coordinates_from_r0(
    r0: &crate::owner::reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
) -> Result<VerifiedReferenceFactCoordinatesV1, ReplayCompositionBindingErrorV1> {
    let record = r0.record();
    let evidence = &record.evidence;
    let digest_from_bytes = |bytes: &[u8]| {
        <[u8; 32]>::try_from(bytes)
            .map(crate::owner::source_binding::BindingDigest::from_untrusted_bytes)
            .map_err(|_| ReplayCompositionBindingErrorV1::DigestMismatch)
    };
    let clock = ReferenceFactClockV1 {
        clock_identity: evidence.clock_identity.clone(),
        clock_epoch: evidence.clock_epoch.clone(),
        monotonic_sequence: evidence.clock_sequence,
        wall_observed: evidence.clock_wall_observed,
        decision_cut: evidence.clock_decision_cut,
        valid_through: evidence.clock_valid_through,
        head_identity: evidence.clock_head_identity,
        head_digest: evidence.clock_head_digest,
        restart_continuity_digest: evidence.restart_continuity_digest,
        uncertainty_bound: evidence.uncertainty_bound,
        skew_bound: evidence.skew_bound,
        comparison_rule: 1,
        epoch_proof_identity: None,
        epoch_proof_digest: None,
    };
    VerifiedReferenceFactCoordinatesV1::verify(ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: evidence.pit_snapshot_identity,
            fact_digest: evidence.pit_fact_digest,
            decision_cut: evidence.clock_decision_cut,
            observed_at: evidence.clock_wall_observed,
            valid_through: evidence.clock_valid_through,
            clock: clock.clone(),
        },
        replay_start_event_ns: record.replay_start_event_ns,
        replay_end_event_ns_exclusive: record.replay_end_event_ns_exclusive,
        source: AdmittedReferenceFactSourceV1 {
            binding_identity: evidence.source_binding_identity,
            binding_fact_digest: evidence.source_binding_fact_digest,
            lineage_root: evidence.source_binding_lineage_root,
            lineage_version: evidence.source_binding_lineage_version,
            admitted: true,
            frontier: ReferenceFactFrontierV1 {
                stream_identity: evidence.source_frontier_stream_identity.clone(),
                cut_identity: digest_from_bytes(&evidence.source_frontier_cut_identity)?,
                sequence: evidence.source_frontier_sequence,
                digest: evidence.source_frontier_digest,
            },
        },
        correction: ReferenceFactFrontierV1 {
            stream_identity: evidence.correction_frontier_stream_identity.clone(),
            cut_identity: digest_from_bytes(&evidence.correction_frontier_cut_identity)?,
            sequence: evidence.correction_frontier_sequence,
            digest: evidence.correction_frontier_digest,
        },
        time: ReferenceFactEffectiveTimeV1 {
            effective_from_ns: record.effective_from_ns,
            effective_until_ns: record.effective_until_ns,
            provider_available_ns: record.provider_available_ns,
            retrieval_ns: record.retrieval_ns,
            correction_publication_ns: record.correction_publication_ns,
            owner_observation_ns: record.owner_observation_ns,
            decision_cut: record.decision_cut,
        },
        fact_clock: clock,
        predecessor_identity: record.predecessor_identity,
        stable_correlation: record.stable_correlation,
    })
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)
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
    instrument_cut_identity: crate::owner::source_binding::BindingDigest,
    source_identity: crate::owner::source_binding::BindingDigest,
) -> Result<Vec<ReplayReferenceFactCutProposalV2>, ReplayCompositionBindingErrorV1> {
    let r0_record = r0.record();
    let r0_time = ReplayReferenceFactTimeV2 {
        effective_from_ns: r0_record.effective_from_ns,
        effective_until_ns: r0_record.effective_until_ns,
        provider_available_ns: r0_record.provider_available_ns,
        retrieval_ns: r0_record.retrieval_ns,
        correction_publication_ns: r0_record.correction_publication_ns,
        owner_observation_ns: r0_record.owner_observation_ns,
        decision_cut: r0_record.decision_cut,
    };
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
    let proposal = |value, time, correction_identity| ReplayReferenceFactProposalV2 {
        value,
        time,
        source_identity,
        correction_identity,
    };
    let calendar_facts = calendar
        .facts()
        .iter()
        .map(|fact| {
            proposal(
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
                fact.lineage_root(),
            )
        })
        .collect();
    let session_facts = session
        .facts()
        .iter()
        .map(|fact| {
            proposal(
                ReplayReferenceFactValueV2::Session {
                    session_identity: fact.session_identity.to_vec(),
                    calendar_identity: calendar.cut().calendar_identity().to_vec(),
                    opens_at_ns: fact.utc_open_ns,
                    closes_at_ns: fact.utc_close_ns,
                },
                r0_time,
                fact.lineage_root,
            )
        })
        .collect();
    let time_zone_facts = time_zone
        .facts()
        .iter()
        .map(|fact| {
            proposal(
                ReplayReferenceFactValueV2::TimeZone {
                    time_zone_identity: fact.time_zone_identity().to_vec(),
                    ruleset_identity: fact.ruleset_identity(),
                    offset_seconds: fact.utc_offset_seconds(),
                },
                ReplayReferenceFactTimeV2 {
                    effective_from_ns: fact.effective_from_ns(),
                    effective_until_ns: fact.effective_until_ns(),
                    ..r0_time
                },
                fact.lineage_root(),
            )
        })
        .collect();
    let semantics_facts = semantics
        .facts()
        .iter()
        .map(|fact| {
            let value = fact.value();
            proposal(
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
                fact.correction_identity,
            )
        })
        .collect();
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
        correction.identity(),
    )];
    let action_facts = corporate_action
        .facts()
        .iter()
        .map(|fact| {
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
            proposal(
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
                fact.correction_identity,
            )
        })
        .collect();
    let membership_facts = universe
        .record()
        .membership()
        .iter()
        .map(|member| {
            proposal(
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
                member.correction_frontier_digest(),
            )
        })
        .collect();
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
                source_identity,
            )?,
            facts: semantics_facts,
        },
        ReplayReferenceFactCutProposalV2 {
            kind: ReplayReferenceFactKindV2::CorrectionPolicy,
            scope: make_scope(
                ReplayMarketDependencyKindV2::SourceBindingV1,
                source_identity,
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
        assert!(COMPOSER_CUT_LOCK_QUERY_V1.contains(COMPOSER_CUT_LOCK_V1));
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
                .contains("composer_private.rd_develop_strategy_design_role_set_attestations_v1")
        );
        assert!(
            COMPOSER_READER_ACL_QUERY_V1
                .contains("composer_private.rd_develop_strategy_design_native_joins_v1")
        );
        assert!(COMPOSER_READER_ACL_QUERY_V1.contains("'composer_owner','MEMBER'"));
        assert!(!COMPOSER_READER_ACL_QUERY_V1.contains("public."));
        assert!(!COMPOSER_READER_ACL_QUERY_V1.contains("rd_owner_api"));
    }
}
