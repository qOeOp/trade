//! The R&D Owner API's composition: its shared state, its routes and handlers, and the bootstrap
//! of every Owner port it serves, run by the `strategy-factory-rd-owner-api` binary.
pub(crate) use std::{env, future::Future, path::PathBuf, sync::Arc, time::Duration};

pub(crate) use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use sha2::{Digest, Sha256};
pub(crate) use tokio::net::TcpListener;
pub(crate) use vibe_binance::{
    common::enums::{BinanceEnvironment, BinanceProductType},
    futures::http::client::BinanceFuturesHttpClient,
    futures_pit_observation_source_v1::BinanceFuturesObservationSourceV1,
    pit_observation_source_v1::BinanceSpotBarObservationSourceV1,
    spot::http::client::BinanceSpotHttpClient,
};
pub(crate) use vibe_core::time::get_atomic_clock_realtime;
// `ReplayCompositionOwnerV1` is imported without the gate because `--materialize-schema` calls it
// in every build; the two locator types below it are only used by the acceptance surface.
pub(crate) use vibe_data::owner::replay_market_facts_v2::ReplayCompositionOwnerV1;
#[cfg(feature = "composer-replay-issuance")]
pub(crate) use vibe_data::owner::replay_market_facts_v2::{
    ReplayCompositionBindingErrorV1, ReplayCompositionDurableIssuanceResponseV1,
    ReplayCompositionIssuanceLocatorV1, ReplayCompositionLocatorOnlyIssuanceRequestV1,
    ReplayCompositionUniverseBindingIssuanceRequestV1,
};
#[cfg(test)]
pub(crate) use vibe_data::owner::{
    ResearchPitTerminalBootstrapError, ResearchPitTerminalBootstrapFailure,
    research_pit_terminal_resolver_from_store_admission_lookup,
};
pub(crate) use vibe_data::owner::{
    instrument_catalog_read_from_environment_v1, instrument_catalog_v1::InstrumentCatalogReadV1,
};
pub(crate) use vibe_data::owner::{
    instrument_economic_terms_intake_v1::{
        InstrumentEconomicTermsAdmissionV1, instrument_economic_terms_admission_from_environment_v1,
    },
    instrument_master_admission_v1::{
        InstrumentMasterAdmissionV1, instrument_master_admission_from_environment_v1,
    },
    instrument_master_admission_v2::{
        InstrumentMasterAdmissionV2, instrument_master_admission_from_environment_v2,
    },
    market_semantics_admission_v1::{
        MarketSemanticsAdmissionV1, market_semantics_admission_from_environment_v1,
    },
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotIntakeV1, pit_market_snapshot_intake_from_environment_v1,
    },
    pit_observation_source_v1::PitObservationSourceV1,
    source_binding_admission_v1::{
        SourceBindingAdmissionV1, source_binding_admission_from_environment_v1,
    },
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionV1, strategy_input_binding_admission_from_environment_v1,
    },
    universe_selection_admission_v1::{
        UniverseSelectionAdmissionV1, universe_selection_admission_from_environment_v1,
    },
};
pub(crate) use vibe_databento::{
    common::Credential, historical::DatabentoHistoricalClient,
    pit_observation_source_v1::DatabentoBboObservationSourceV1,
};

/// The stable correlation every Market Data probe attempt repeats.
pub(crate) const MARKET_DATA_PROBE_CORRELATION_V1: [u8; 32] =
    *b"vibe.market-data.pit-probe.v1\0\0\0";
#[cfg(feature = "composer-replay-issuance")]
pub(crate) use vibe_data::owner::{
    UniverseSampleProjectionOwnerV1, instrument_economic_terms_postgres_owner_from_environment_v1,
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    instrument_master_v2_postgres_owner_from_environment,
    native_replay_scheduling_resolver_v1_from_store_admission_environment,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    universe_sample_projection_owner_from_environment_v1,
};
// The Market Data repair loop is the only reader of the shared time evidence resolver.
#[cfg(feature = "native-replay-execution")]
pub(crate) use vibe_data::owner::shared_time_evidence_resolver_from_store_admission_environment_v1;
pub(crate) use vibe_data::owner::{
    research_pit_terminal::ResearchPitTerminalResolver,
    research_pit_terminal_resolver_from_store_admission_environment,
};
pub(crate) use vibe_postgres_connect::{PgPoolOptionsExt as _, PostgresTls};
pub(crate) use vibe_product_edge::{
    ARTIFACT_BUILD_REQUIRED_EFFECTS_V1, ProductEdgeAdmissionLocatorV1,
    ProductEdgeAdmissionReadbackV1, ProductEdgeAdmissionRequestV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeError, ProductEdgeInvocationClaimReadbackV1, ProductEdgeInvocationClaimRequestV1,
    ProductEdgeInvocationStateV1, ProductEdgePostgresOwnerV1,
};
pub(crate) use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
        ArtifactBuildError, ArtifactBuildInvocationCustodyV1, ArtifactBuildNextLegalAction,
        ArtifactBuildOwnerPort, ArtifactBuildPreparationV1, ArtifactBuildRequestV1,
        ArtifactBuildResolution, ArtifactBuildResultV1, ArtifactDirectoryCursorV1,
        ArtifactDirectoryOwnerPort, ArtifactRequestIdentityPreflightV1, ArtifactSourceOwnerPort,
        SANDBOX_SOCKET_DEFAULT,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    develop_composer_operation_v2::DevelopComposerOperationResponseV2,
    develop_composer_sealed_acceptance_v2::default_unavailable_response,
    product_edge::{
        ProductEdgeChannel, RESEARCH_OWNER_V1, ResearchDirectoryCursorV1,
        ResearchDirectoryOwnerPort, ResearchGoalOwnerError, ResearchGoalOwnerPortV2,
        ResearchReadbackOwnerPortV1, identity_conflict_result, identity_conflict_result_v2,
        rejected_result, unresolved_result, unresolved_result_v2,
    },
    product_edge_postgres::research_initial_pit::MarketDataInitialPitPortsV1,
    product_edge_postgres::{PostgresResearchGoalOwnerV1, ResearchRequestIdentityPreflightV1},
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    rd_historical_custody::{HistoricalCustodyErrorV1, HistoricalCustodyOwnerPortV1},
    rd_historical_custody_postgres::PostgresHistoricalCustodyOwnerV1,
    trial_family::{TrialFamilyDirectResultV1, TrialFamilyError},
};

pub(crate) use vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerOperationDispositionV2;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) use vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2;
#[cfg(feature = "composer-replay-issuance")]
pub(crate) use vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerSealedReadPortV2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    not(feature = "sealed-source-intake-composer-acceptance")
))]
pub(crate) use vibe_strategy_factory::develop_composer_postgres_v2::SealedDevelopComposerAcceptanceReadPortV2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    any(test, not(feature = "sealed-source-intake-composer-acceptance"))
))]
pub(crate) use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    not(feature = "sealed-source-intake-composer-acceptance")
))]
pub(crate) use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2;
#[cfg(feature = "composer-replay-issuance")]
pub(crate) use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::submitted_or_unknown_response;
#[cfg(not(feature = "sealed-develop-composer-acceptance"))]
pub(crate) use vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) use vibe_strategy_factory::source_research_composer_postgres_v2::{
    SealedPostgresSourceResearchComposerV2, SourceResearchComposerAcceptanceControlV2,
    SourceResearchComposerAcceptanceTamperV2,
    sealed_source_research_composer_a0_execution_count_v2,
};

// The locator is the whole public input on both paths that accept one: the production path,
// which reads the Design from the request's frozen program, and the sealed acceptance path.
// The middle configuration - sealed Develop Composer without the source-intake Composer - runs
// a corpus and takes no locator at all.
#[cfg(any(
    not(feature = "sealed-develop-composer-acceptance"),
    feature = "sealed-source-intake-composer-acceptance"
))]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceResearchComposerLocatorV2 {
    #[serde(deserialize_with = "deserialize_research_locator_v2")]
    pub(crate) research_request_locator: String,
}

#[cfg(any(
    not(feature = "sealed-develop-composer-acceptance"),
    feature = "sealed-source-intake-composer-acceptance"
))]
pub(crate) fn deserialize_research_locator_v2<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let locator = String::deserialize(deserializer)?;
    if locator.trim().is_empty() || locator.len() > 256 {
        return Err(serde::de::Error::custom(
            "a bounded Research request locator is required",
        ));
    }
    Ok(locator)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceResearchComposerAcceptanceRunV2 {
    pub(crate) research_request_locator: String,
    pub(crate) control: SourceResearchComposerAcceptanceControlV2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceResearchComposerAcceptanceResolveV2 {
    pub(crate) tamper: SourceResearchComposerAcceptanceTamperV2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopComposerA0ExecutionsV1 {
    pub(crate) schema_version: u16,
    pub(crate) a0_executions: u64,
}

pub(crate) use crate::required_env;
#[cfg(test)]
pub(crate) use crate::research_goal_submission::ProductEdgeOperationRequestV2;
#[allow(
    clippy::wildcard_imports,
    reason = "the composition reaches every sibling module by name, as the crate root it was did"
)]
use crate::*;
#[cfg(test)]
pub(crate) use vibe_strategy_factory::product_edge::{
    ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2,
    SourcedResearchGoalV2, TrialFamilyProposalV1,
};

#[derive(Clone)]
pub(crate) struct ApiState {
    pub(crate) product_edge: Arc<ProductEdgePostgresOwnerV1>,
    pub(crate) owner: Arc<PostgresResearchGoalOwnerV1>,
    pub(crate) artifact_owner: Arc<dyn ArtifactBuildOwnerPort>,
    pub(crate) artifact_source_owner: Arc<dyn ArtifactSourceOwnerPort>,
    pub(crate) artifact_directory_owner: Arc<dyn ArtifactDirectoryOwnerPort>,
    pub(crate) research_directory_owner: Arc<dyn ResearchDirectoryOwnerPort>,
    pub(crate) research_readback_owner: Arc<dyn ResearchReadbackOwnerPortV1>,
    pub(crate) historical_custody_owner: Arc<dyn HistoricalCustodyOwnerPortV1>,
    pub(crate) token_digest: [u8; 32],
    pub(crate) request_proof_digest: String,
    pub(crate) allow_acceptance_faults: bool,
    pub(crate) _market_data_research_pit: Option<Arc<dyn ResearchPitTerminalResolver>>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) native_replay_scheduling: Option<Arc<dyn NativeReplaySchedulingResolverV1>>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) instrument_master_v2: Option<Arc<InstrumentMasterV2PostgresOwner>>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) instrument_economic_terms: Option<Arc<InstrumentEconomicTermsPostgresOwnerV1>>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) universe_sample_projection: Option<Arc<UniverseSampleProjectionOwnerV1>>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) develop_composer_read: Option<Arc<dyn DevelopComposerSealedReadPortV2>>,
    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    pub(crate) develop_composer: Arc<SealedDevelopComposerAcceptanceV2>,
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) develop_composer: Arc<SealedPostgresSourceResearchComposerV2>,
    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    pub(crate) develop_composer: Arc<PostgresSourceResearchComposerProductionV2>,
    #[cfg(feature = "composer-replay-issuance")]
    pub(crate) replay_composition: Option<Arc<ReplayCompositionOwnerV1>>,
}

impl ApiState {
    /// The Research submission routes' own state, which needs only these five of the API's.
    pub(crate) fn research_goal_submission(
        &self,
    ) -> research_goal_submission::ResearchGoalSubmissionApiStateV1 {
        research_goal_submission::ResearchGoalSubmissionApiStateV1 {
            product_edge: self.product_edge.clone(),
            owner: self.owner.clone(),
            token_digest: self.token_digest,
            request_proof_digest: self.request_proof_digest.clone(),
            allow_acceptance_faults: self.allow_acceptance_faults,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactFamilyResolveRequestV1 {
    pub(crate) artifact_identity: String,
    pub(crate) build_receipt_identity: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactBuildOperationRequestV1 {
    pub(crate) build_request_identity: String,
    pub(crate) attempt_identity: String,
    pub(crate) intent_identity: String,
    pub(crate) channel: ProductEdgeChannel,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactBuildCandidateOperationV1 {
    pub(crate) request: ArtifactBuildOperationRequestV1,
    pub(crate) candidate: ArtifactBuildCandidateV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactBuildFailureOperationV1 {
    pub(crate) request: ArtifactBuildOperationRequestV1,
    pub(crate) failure_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactBuildInvocationStartOperationV1 {
    pub(crate) build_request_identity: String,
    pub(crate) attempt_identity: String,
    pub(crate) research_request_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactDirectoryQueryV1 {
    pub(crate) limit: Option<u32>,
    pub(crate) after_prepared_at_epoch_ms: Option<u64>,
    pub(crate) after_build_request_identity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResearchDirectoryQueryV1 {
    pub(crate) limit: Option<u32>,
    pub(crate) after_committed_at_epoch_ms: Option<u64>,
    pub(crate) after_request_identity: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ArtifactBuildInvocationStartApiResultV1 {
    pub(crate) invocation_start: vibe_product_edge::ProductEdgeInvocationStartReadbackV1,
    pub(crate) execution_custody: ArtifactBuildInvocationCustodyV1,
}

#[derive(Debug, Serialize)]
pub(crate) struct ArtifactBuildApiResultV1 {
    #[serde(flatten)]
    pub(crate) owner_result: ArtifactBuildResultV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) provider_invocation: Option<ProductEdgeInvocationClaimReadbackV1>,
}

/// Runs the R&D Owner API: reads its configuration, composes its router and serves it.
///
/// # Errors
///
/// Returns the first configuration, connection or serving failure.
pub async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if schema_materialization_requested(&arguments)? {
        let database_url = required_env("RD_OWNER_DATABASE_URL")?;
        PostgresResearchGoalOwnerV1::materialize_schema(&database_url).await?;
        PostgresArtifactBuildOwnerV1::materialize_schema(&database_url).await?;
        vibe_strategy_factory::develop_composer_postgres_v2::PostgresDevelopComposerStoreV2::materialize_schema(&database_url).await?;
        vibe_strategy_factory::iteration_analysis_postgres::materialize_schema(&database_url)
            .await?;
        // Ungated. The deployed image is built with default features
        // (`product/rd-workbench/Dockerfile.owner` runs `cargo build` with no `--features`), so
        // behind that gate this line did not exist in the binary that `schema-materialize` runs.
        // The service still exited 0, because it had nothing to do.
        //
        // What it installs is four private Market Data schemas - calendar, time zone, session and
        // the reference fact catalog. `rd-owner-api` then checks for the seven `time_zone_*`
        // relations on startup and refuses with "the Market Data store is unavailable" when they
        // are absent, which is every deployment: measured on a full local bring-up, the chain ran
        // to completion and the database held zero of the seven.
        //
        // Installing a schema is not an acceptance behaviour. The four `materialize_schema` calls
        // above it carry no gate, and this one differing was what made the Owner unable to start.
        // The gate stays off `source_intake::materialize_schema` below, which has the same shape
        // but no measurement behind it yet.
        ReplayCompositionOwnerV1::materialize_schema(&database_url).await?;
        #[cfg(feature = "sealed-source-intake-acceptance")]
        source_intake::materialize_schema(&database_url).await?;
        return Ok(());
    }
    let market_data_research_pit = bootstrap_deployment_store_admission().await?;
    let market_data_pit_intake = bootstrap_market_data_pit_intake().await?;
    let market_data_source_binding_admission =
        bootstrap_market_data_source_binding_admission().await?;
    let market_data_universe_selection = bootstrap_market_data_universe_selection().await?;
    let market_data_strategy_input_bindings =
        bootstrap_market_data_strategy_input_bindings().await?;
    let market_data_instrument_master_admission =
        bootstrap_market_data_instrument_master_admission().await?;
    let market_data_instrument_master_admission_v2 =
        bootstrap_market_data_instrument_master_admission_v2().await?;
    let instrument_economic_terms_admission =
        bootstrap_instrument_economic_terms_admission().await?;
    let market_data_instrument_catalog = bootstrap_market_data_instrument_catalog().await?;
    let market_data_binance_perpetual_admission =
        bootstrap_market_data_binance_perpetual_admission()?;
    let market_data_backfill_jobs = bootstrap_market_data_backfill_jobs().await?;
    let market_data_custody_commit = bootstrap_market_data_custody_commit().await?;
    let market_data_funding_commit = bootstrap_market_data_funding_settlement_commit().await?;
    let market_data_custody_frames = bootstrap_market_data_custody_frames().await?;
    let market_data_backfill_fetcher = market_data_binance_perpetual_admission
        .as_ref()
        .and_then(|client| binance_backfill_job::vision_backfill_fetcher_v1(client).ok())
        .map(Arc::new);
    let market_data_market_semantics_admission =
        bootstrap_market_data_market_semantics_admission().await?;
    #[cfg(feature = "composer-replay-issuance")]
    let native_replay_scheduling =
        native_replay_scheduling_resolver_v1_from_store_admission_environment().await?;
    #[cfg(feature = "native-replay-execution")]
    let shared_time = shared_time_evidence_resolver_from_store_admission_environment_v1().await?;
    #[cfg(feature = "composer-replay-issuance")]
    let instrument_master_v2 =
        Arc::new(instrument_master_v2_postgres_owner_from_environment().await?);
    #[cfg(feature = "composer-replay-issuance")]
    let instrument_economic_terms =
        Arc::new(instrument_economic_terms_postgres_owner_from_environment_v1().await?);
    // backtest.run's own in-process caller (H8) needs both Owners directly, cloned here before
    // `state` moves them.
    #[cfg(feature = "composer-v3-replay")]
    let backtest_run_instrument_master_v2 = Some(instrument_master_v2.clone());
    #[cfg(feature = "composer-v3-replay")]
    let backtest_run_instrument_economic_terms = Some(instrument_economic_terms.clone());
    #[cfg(feature = "composer-replay-issuance")]
    let universe_sample_projection =
        Arc::new(universe_sample_projection_owner_from_environment_v1().await?);
    let database_url = required_env("RD_OWNER_DATABASE_URL")?;
    // backtest.run's own orchestration reads its run's initial PIT terminal directly (no Owner
    // method wraps that read - see backtest_run_v1.rs's own doc), so it needs a raw pool on the
    // same database every other R&D Owner connection here opens from `database_url`.
    let backtest_run_rd_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(&database_url, PostgresTls::Disabled)
        .await?;
    let composer_writer_database_url = required_env("RD_FACT_WRITER_DATABASE_URL")?;
    let qualification_database_url = required_env("QUALIFICATION_OWNER_DATABASE_URL")?;
    let product_edge_database_url = required_env("PRODUCT_EDGE_DATABASE_URL")?;
    let token = required_env("RD_OWNER_API_TOKEN")?;
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
    let product_edge = Arc::new(
        ProductEdgePostgresOwnerV1::connect(
            &product_edge_database_url,
            required_env("PRODUCT_EDGE_DEPLOYMENT_IDENTITY")?,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: required_env("PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY")?,
                issuer_key_version: required_env("PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION")?,
                audience: required_env("PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE")?,
            },
        )
        .await?,
    );
    let owner =
        PostgresResearchGoalOwnerV1::connect(&database_url, &qualification_database_url).await?;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let owner = owner.bind_sealed_source_intake_research_policy();
    let owner = Arc::new(owner);
    let bounded_feature_program_owner =
        Arc::new(PostgresResearchBoundedFeatureProgramOwnerV1::connect(&database_url).await?);
    let strategy_catalog = Arc::new(
        vibe_strategy_factory::strategy_catalog_postgres_v1::PostgresStrategyCatalogV1::connect(
            &database_url,
        )
        .await?,
    );
    let backtest_run_registry = Arc::new(
        vibe_strategy_factory::backtest_run_registry_postgres_v1::PostgresBacktestRunRegistryV1::connect(
            &database_url,
        )
        .await?,
    );
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            &env_or("RD_SANDBOX_SOCKET", SANDBOX_SOCKET_DEFAULT),
            env_or("RD_ARTIFACT_ATTEMPT_TIMEOUT_MS", "600000").parse()?,
        )
        .await?,
    );
    let historical_custody_owner =
        Arc::new(PostgresHistoricalCustodyOwnerV1::connect_read_only(&database_url).await?);
    #[cfg(feature = "composer-replay-issuance")]
    let replay_composition = Arc::new(
        ReplayCompositionOwnerV1::connect(
            &required_env("MARKET_DATA_OWNER_DATABASE_URL")?,
            &required_env("MARKET_DATA_RD_ROLE_SET_DATABASE_URL")?,
        )
        .await?,
    );
    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    let develop_composer = Arc::new(
        SealedDevelopComposerAcceptanceV2::connect_with_writer(
            &database_url,
            &composer_writer_database_url,
        )
        .await?,
    );
    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    let develop_composer_read: Arc<dyn DevelopComposerSealedReadPortV2> = Arc::new(
        SealedDevelopComposerAcceptanceReadPortV2::connect_with_writer(
            &database_url,
            &composer_writer_database_url,
        )
        .await?,
    );
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    let develop_composer = Arc::new(
        SealedPostgresSourceResearchComposerV2::connect(
            &database_url,
            &composer_writer_database_url,
        )
        .await?,
    );
    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    let develop_composer = Arc::new(
        PostgresSourceResearchComposerProductionV2::connect(
            &database_url,
            &composer_writer_database_url,
        )
        .await?,
    );
    // backtest.run's own in-process caller (H5) needs the production Composer specifically, not
    // whatever acceptance-sealed stand-in `develop_composer` is under other feature configs.
    #[cfg(all(
        feature = "composer-v3-replay",
        not(feature = "sealed-develop-composer-acceptance")
    ))]
    let backtest_run_develop_composer = Some(develop_composer.clone());
    #[cfg(all(
        feature = "composer-v3-replay",
        feature = "sealed-develop-composer-acceptance"
    ))]
    let backtest_run_develop_composer: Option<
        Arc<vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2>,
    > = None;
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    let develop_composer_read: Arc<dyn DevelopComposerSealedReadPortV2> = develop_composer.clone();
    #[cfg(all(
        feature = "composer-replay-issuance",
        not(feature = "sealed-develop-composer-acceptance")
    ))]
    let develop_composer_read: Arc<dyn DevelopComposerSealedReadPortV2> = develop_composer.clone();
    #[cfg(feature = "native-replay-execution")]
    let native_replay_execution = match env::var("BACKTEST_OWNER_DATABASE_URL") {
        Err(env::VarError::NotPresent) => None,
        Err(e) => return Err(e.into()),
        Ok(backtest_database_url) => {
            if backtest_database_url.is_empty()
                || backtest_database_url.trim() != backtest_database_url
            {
                anyhow::bail!("BACKTEST_OWNER_DATABASE_URL must be a non-empty exact value");
            }
            let Some(market_data) = native_replay_scheduling.clone() else {
                anyhow::bail!("Native Replay execution requires admitted Market Data scheduling");
            };
            Some(Arc::new(
                exploratory_replay::NativeReplayExecutionServiceV2::connect(
                    &database_url,
                    &backtest_database_url,
                    owner.clone(),
                    develop_composer_read.clone(),
                    instrument_master_v2.clone(),
                    instrument_economic_terms.clone(),
                    market_data,
                    universe_sample_projection.clone(),
                    market_data_custody_frames.clone(),
                )
                .await?,
            ))
        }
    };
    #[cfg(feature = "native-replay-execution")]
    let market_data_repair = market_data_repair::production_router(
        owner.clone(),
        develop_composer_read.clone(),
        instrument_master_v2.clone(),
        native_replay_scheduling.clone(),
        shared_time,
        token_digest,
    );
    let allow_acceptance_faults =
        env::var("RD_OWNER_ENABLE_ACCEPTANCE_FAULTS").as_deref() == Ok("1");
    let state = ApiState {
        product_edge: product_edge.clone(),
        owner: owner.clone(),
        artifact_owner: artifact_owner.clone(),
        artifact_source_owner: artifact_owner.clone(),
        artifact_directory_owner: artifact_owner,
        research_directory_owner: owner.clone(),
        research_readback_owner: owner.clone(),
        historical_custody_owner,
        token_digest,
        request_proof_digest: request_proof_digest.clone(),
        allow_acceptance_faults,
        _market_data_research_pit: market_data_research_pit,
        #[cfg(feature = "composer-replay-issuance")]
        native_replay_scheduling,
        #[cfg(feature = "composer-replay-issuance")]
        instrument_master_v2: Some(instrument_master_v2),
        #[cfg(feature = "composer-replay-issuance")]
        instrument_economic_terms: Some(instrument_economic_terms),
        #[cfg(feature = "composer-replay-issuance")]
        universe_sample_projection: Some(universe_sample_projection),
        #[cfg(feature = "composer-replay-issuance")]
        develop_composer_read: Some(develop_composer_read),
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        develop_composer,
        #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
        develop_composer,
        #[cfg(feature = "composer-replay-issuance")]
        replay_composition: Some(replay_composition),
    };
    #[cfg(not(feature = "sealed-source-intake-acceptance"))]
    let source_intake = source_intake::production_router(
        product_edge.clone(),
        &database_url,
        token_digest,
        request_proof_digest.clone(),
    )
    .await?;
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let source_intake = source_intake::sealed_acceptance_router(
        product_edge.clone(),
        &database_url,
        token_digest,
        request_proof_digest.clone(),
    )
    .await?;
    let research_goal_submission = state.research_goal_submission();
    let app = owner_state_routes();
    let app = app
        .with_state(state)
        .merge(source_intake)
        .merge(exploratory_replay::result_router(
            owner.clone(),
            token_digest,
        ))
        .merge(iteration_analysis::router(
            product_edge.clone(),
            owner.clone(),
            token_digest,
            request_proof_digest.clone(),
        ))
        .merge(iteration_decision::router(
            product_edge.clone(),
            owner.clone(),
            token_digest,
            request_proof_digest.clone(),
        ))
        .merge(backtest_run_routes::router(
            backtest_run_routes::BacktestRunRoutesApiState {
                catalog: strategy_catalog.clone(),
                registry: backtest_run_registry,
                product_edge: product_edge.clone(),
                research: owner.clone(),
                bounded_feature_program: bounded_feature_program_owner.clone(),
                strategy_input_bindings: market_data_strategy_input_bindings.clone(),
                market_data_universe_selection: market_data_universe_selection.clone(),
                market_data_pit_intake: market_data_pit_intake.clone(),
                market_semantics: market_data_market_semantics_admission.clone(),
                custody_frames: market_data_custody_frames.clone(),
                #[cfg(feature = "composer-v3-replay")]
                develop_composer: backtest_run_develop_composer,
                #[cfg(feature = "composer-v3-replay")]
                instrument_master_v2: backtest_run_instrument_master_v2,
                #[cfg(feature = "composer-v3-replay")]
                instrument_economic_terms: backtest_run_instrument_economic_terms,
                #[cfg(all(feature = "composer-v3-replay", feature = "native-replay-execution"))]
                native_replay_execution: native_replay_execution.clone(),
                rd_pool: backtest_run_rd_pool,
                request_proof_digest: request_proof_digest.clone(),
                token_digest,
            },
        ))
        .merge(bounded_feature_program::router(
            bounded_feature_program_owner,
            token_digest,
        ))
        .merge(strategies::router(strategy_catalog, token_digest))
        .merge(iteration_result_admission::router(
            product_edge.clone(),
            owner.clone(),
            token_digest,
            request_proof_digest.clone(),
        ))
        .merge(research_goal_submission::router(research_goal_submission))
        // The issuance holds the same two Market Data ports its routes serve, not a second pair.
        .merge(research_initial_pit::router(
            owner.clone(),
            market_data_universe_selection
                .clone()
                .zip(market_data_pit_intake.clone())
                .map(|(universe, intake)| MarketDataInitialPitPortsV1::new(universe, intake)),
            token_digest,
        ))
        .merge(source_intake_research::router(
            product_edge,
            owner,
            token_digest,
            request_proof_digest,
            allow_acceptance_faults,
        ))
        // Market Data answers for itself on the default feature set: these routes ship in the
        // deployed binary rather than behind an acceptance feature.
        .merge(market_data_pit::router(
            market_data_pit::MarketDataAdmissions {
                intake: market_data_pit_intake,
                admission: market_data_source_binding_admission.clone(),
                universe: market_data_universe_selection.clone(),
                bindings: market_data_strategy_input_bindings,
                instruments: market_data_instrument_master_admission,
                instruments_v2: market_data_instrument_master_admission_v2,
                semantics: market_data_market_semantics_admission,
                economic_terms: instrument_economic_terms_admission,
                catalog: market_data_instrument_catalog,
                binance_perpetual_admission: market_data_binance_perpetual_admission,
            },
            token_digest,
        ))
        .merge(binance_backfill_job::router(
            binance_backfill_job::BinanceBackfillJobApiState {
                jobs: market_data_backfill_jobs,
                admission: market_data_source_binding_admission,
                universe: market_data_universe_selection,
                custody_commit: market_data_custody_commit,
                funding_commit: market_data_funding_commit,
                fetcher: market_data_backfill_fetcher,
                token_digest,
            },
        ));
    #[cfg(feature = "native-replay-execution")]
    let app = app.merge(exploratory_replay::execution_router(
        native_replay_execution,
        token_digest,
    ));
    // The Market Data repair loop is a separate surface with its own admission; keeping its merge
    // in its own statement is what lets the Native Replay route lose its gate on its own.
    #[cfg(feature = "native-replay-execution")]
    let app = app.merge(market_data_repair);
    let address = env_or("RD_OWNER_LISTEN", "0.0.0.0:8080");
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(listen = %address, "R&D Owner API ready");
    axum::serve(listener, app).await?;
    Ok(())
}

/// The routes served from the Owner API's shared state, exactly as `main` mounts them.
///
/// The ordered chain mounts this same table over the state it composes, so an entry that drives
/// one of these routes reaches the production path, handler and extractors rather than a copy of them.
pub(crate) fn owner_state_routes() -> Router<ApiState> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/research-goals/directory", get(read_research_directory))
        .route(
            "/v2/research-goals/{request_identity}/readback",
            get(read_research_v2),
        )
        .route("/v1/historical-custodies", get(read_historical_custodies))
        .route(
            "/v1/research-goals/{request_identity}/resolve",
            post(resolve),
        )
        .route(
            "/v2/research-goals/{request_identity}/resolve",
            post(resolve_v2),
        )
        // Resolution reads the stored request by identity, whichever schema admitted it.
        .route(
            "/v3/research-goals/{request_identity}/resolve",
            post(resolve_v2),
        )
        .route(
            "/v2/exploratory-replay-requests/identify",
            post(exploratory_replay::identify),
        )
        .route(
            "/v2/exploratory-replay-requests",
            post(exploratory_replay::submit),
        )
        .route(
            "/v2/exploratory-replay-requests/{request_identity}/resolve",
            post(exploratory_replay::resolve),
        )
        .route(
            "/v2/exploratory-replay-requests/readback",
            get(exploratory_replay::readback),
        )
        .route(
            "/v1/trial-families/by-intent/{intent_identity}",
            post(resolve_family_by_intent),
        )
        .route(
            "/v1/trial-families/by-artifact",
            post(resolve_family_by_artifact),
        )
        .route("/v1/artifact-builds/prepare", post(prepare_artifact_build))
        .route(
            "/v1/artifact-builds/claim-provider-invocation",
            post(claim_provider_invocation),
        )
        .route(
            "/v1/artifact-builds/start-provider-invocation",
            post(start_provider_invocation),
        )
        .route(
            "/v1/artifact-builds/candidate",
            post(submit_artifact_candidate),
        )
        .route("/v1/artifact-builds/fail", post(fail_artifact_build))
        .route(
            "/v1/artifact-builds/directory",
            get(read_artifact_directory),
        )
        .route(
            "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/resolve",
            post(resolve_artifact_build),
        )
        .merge(artifact_source_router())
        .route("/v2/develop-composer/runs", post(run_develop_composer))
        .route(
            "/v2/develop-composer/request-projections",
            get(project_develop_composer_request),
        )
        .route(
            "/v1/replay-compositions/issuances",
            post(issue_replay_composition),
        )
        .route(
            "/v1/replay-compositions/issuances/resolve",
            post(resolve_replay_composition),
        )
        .route(
            "/v1/replay-compositions/universe-member-issuances",
            post(issue_universe_member_replay_composition),
        )
        .route(
            "/v2/develop-composer/runs/{request_identity}/readback",
            get(read_develop_composer),
        )
        .route(
            "/v2/develop-composer/runs/{request_identity}/resolve",
            post(resolve_develop_composer),
        );
    #[cfg(feature = "composer-replay-issuance")]
    let app = app.route(
        "/v2/exploratory-replay/execution-input-bindings",
        post(exploratory_replay::issue_execution_input_binding),
    );
    #[cfg(feature = "composer-v3-replay")]
    let app = app.route(
        "/v3/exploratory-replay-requests/composer-backed",
        post(exploratory_replay::submit_composer_backed_v3),
    );
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    let app = app
        .route(
            "/_sealed-acceptance/v1/develop-composer/a0-executions",
            get(develop_composer_a0_executions),
        )
        .route(
            "/_sealed-acceptance/v1/develop-composer/sealed-read",
            post(read_sealed_develop_composer_for_acceptance),
        )
        .route(
            "/_sealed-acceptance/v1/develop-composer/runs",
            post(run_develop_composer_with_acceptance_control),
        )
        .route(
            "/_sealed-acceptance/v1/develop-composer/runs/{request_identity}/resolve",
            post(resolve_develop_composer_with_acceptance_tamper),
        );
    app
}

pub(crate) fn schema_materialization_requested(arguments: &[String]) -> anyhow::Result<bool> {
    match arguments {
        [] => Ok(false),
        [argument] if argument == "--materialize-schema" => Ok(true),
        _ => anyhow::bail!("unsupported strategy-factory-rd-owner-api arguments"),
    }
}

/// Composes the Market Data PIT intake when the deployment has configured a Data Client.
///
/// Absent configuration is not a startup failure: Market Data simply has no retrieval path, so the
/// intake is absent and its routes answer `503`. A named but unusable configuration is a startup
/// failure, because silently degrading to "no data source" would hide it.
///
/// The Data Client is named rather than inferred. Which venue a snapshot's rows come from changes
/// what the snapshot means, so it is not something a deployment should fall into by which
/// environment variables happen to be set.
pub(crate) async fn bootstrap_market_data_pit_intake()
-> anyhow::Result<Option<Arc<dyn PitMarketSnapshotIntakeV1>>> {
    let observations = match env::var("MARKET_DATA_OBSERVATION_SOURCE") {
        Err(env::VarError::NotPresent) => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(name) => match name.trim() {
            "" => return Ok(None),
            "databento" => databento_observation_source()?,
            "binance-spot" => binance_spot_observation_source()?,
            "binance-perpetual" => binance_perpetual_observation_source()?,
            other => anyhow::bail!(
                "MARKET_DATA_OBSERVATION_SOURCE must be databento, binance-spot or binance-perpetual, not {other}"
            ),
        },
    };
    Ok(Some(
        pit_market_snapshot_intake_from_environment_v1(observations).await?,
    ))
}

/// Builds the Databento Data Client under an explicit provider-cost allowance.
pub(crate) fn databento_observation_source() -> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
    let api_key = required_env("DATABENTO_API_KEY")?;
    let publishers = required_env("DATABENTO_PUBLISHERS_PATH")?;
    let client = DatabentoHistoricalClient::new(
        Credential::new(api_key),
        PathBuf::from(publishers),
        get_atomic_clock_realtime(),
        false,
    )?;
    // Nothing spends without an explicit allowance: the ceiling defaults to zero, under which the
    // probe refuses any range the provider charges for.
    let max_cost_usd = match env::var("DATABENTO_MAX_PROBE_COST_USD") {
        Err(env::VarError::NotPresent) => 0.0,
        Err(e) => return Err(e.into()),
        Ok(value) => value
            .parse::<f64>()
            .map_err(|_| anyhow::anyhow!("DATABENTO_MAX_PROBE_COST_USD must be a number"))?,
    };
    Ok(Arc::new(DatabentoBboObservationSourceV1::new(
        client,
        MARKET_DATA_PROBE_CORRELATION_V1,
        max_cost_usd,
    )))
}

/// Builds the keyless Binance Spot Data Client from its admitted member mapping.
///
/// The mapping is stated as `member=symbol` pairs so a deployment says exactly which Owner member
/// each venue symbol answers for; a client that guessed the mapping would be deciding what a
/// universe member is.
/// Parses one `member=symbol` mapping from the named variable.
///
/// Both Binance surfaces bind a universe member to a venue symbol the same way, and the two must
/// keep parsing it the same way: a member that resolved to different symbols on the two surfaces
/// would make the venue part of what a snapshot means without saying so.
pub(crate) fn binance_member_mapping(
    variable: &str,
) -> anyhow::Result<std::collections::BTreeMap<String, String>> {
    let members = required_env(variable)?;
    let mut mapping = std::collections::BTreeMap::new();

    for entry in members.split(',') {
        let (member, symbol) = entry
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("{variable} entries are member=symbol"))?;

        if member.trim().is_empty() || symbol.trim().is_empty() {
            anyhow::bail!("{variable} entries are member=symbol");
        }
        mapping.insert(member.trim().to_string(), symbol.trim().to_string());
    }
    Ok(mapping)
}

/// Builds the USD-M perpetual Data Client for the Owner's point-in-time path.
///
/// The base URL is named rather than discovered. Binance answers `451` to some networks on its
/// canonical `fapi.binance.com`, and a client that fell back to whichever host happened to answer
/// would let the deployment's network decide what a snapshot records as its provenance. A
/// deployment that must use another host says so, and that host is then what the binding carries.
///
/// The public kline and funding endpoints are unsigned, so no credential is read here, and the
/// Data Client refuses an HTTP client that holds one.
pub(crate) fn binance_perpetual_observation_source()
-> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
    let mapping = binance_member_mapping("BINANCE_PERPETUAL_PIT_MEMBERS")?;
    let interval = required_env("BINANCE_PERPETUAL_PIT_INTERVAL")?;
    let base_url = env::var("BINANCE_PERPETUAL_PIT_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let client = BinanceFuturesHttpClient::new(
        BinanceProductType::UsdM,
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        base_url,
        None,
        Some(30),
        None,
        false,
    )?;
    Ok(Arc::new(
        BinanceFuturesObservationSourceV1::new(client, mapping, &interval)
            .map_err(|e| anyhow::anyhow!("the Binance USD-M Data Client is unusable: {e}"))?,
    ))
}

pub(crate) fn binance_spot_observation_source() -> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
    let mapping = binance_member_mapping("BINANCE_PIT_MEMBERS")?;
    let interval = required_env("BINANCE_PIT_INTERVAL")?;
    let client = BinanceSpotHttpClient::new_with_json_responses(
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        None,
        None,
        Some(30),
        None,
        true,
    )?;
    Ok(Arc::new(
        BinanceSpotBarObservationSourceV1::new(client, mapping, &interval)
            .map_err(|e| anyhow::anyhow!("the Binance Data Client is unusable: {e}"))?,
    ))
}

/// Composes the Market Data universe-selection intake when its store is configured.
pub(crate) async fn bootstrap_market_data_universe_selection()
-> anyhow::Result<Option<Arc<dyn UniverseSelectionAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        universe_selection_admission_from_environment_v1().await?,
    ))
}

/// Composes the W3 Strategy Input Binding admission when both its principals are configured.
///
/// It needs two: the Owner URL writes the declarations and the R&D role-set URL reads the Composer
/// attestation. A deployment that names only one has not separated those duties, so the route stays
/// absent rather than running both halves as whichever principal it was given.
pub(crate) async fn bootstrap_market_data_strategy_input_bindings()
-> anyhow::Result<Option<Arc<dyn StrategyInputBindingAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err()
        || env::var("MARKET_DATA_RD_ROLE_SET_DATABASE_URL").is_err()
    {
        return Ok(None);
    }
    Ok(Some(
        strategy_input_binding_admission_from_environment_v1().await?,
    ))
}

/// Composes the Market Data Market Semantics admission when its store is configured.
pub(crate) async fn bootstrap_market_data_market_semantics_admission()
-> anyhow::Result<Option<Arc<dyn MarketSemanticsAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        market_semantics_admission_from_environment_v1().await?,
    ))
}

/// Composes the Market Data Instrument Master V1 admission when its store is configured.
pub(crate) async fn bootstrap_market_data_instrument_master_admission()
-> anyhow::Result<Option<Arc<dyn InstrumentMasterAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        instrument_master_admission_from_environment_v1().await?,
    ))
}

/// Composes the Market Data Instrument Master V2 baseline admission when its store is configured.
pub(crate) async fn bootstrap_market_data_instrument_master_admission_v2()
-> anyhow::Result<Option<Arc<dyn InstrumentMasterAdmissionV2>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        instrument_master_admission_from_environment_v2().await?,
    ))
}

/// Composes the Instrument Owner economic-terms intake when both stores it reads and writes are
/// configured: Market Data's, which holds the Instrument Master V2 fact and clock head the terms are
/// derived from, and the Instrument Owner's, which holds the terms.
pub(crate) async fn bootstrap_instrument_economic_terms_admission()
-> anyhow::Result<Option<Arc<dyn InstrumentEconomicTermsAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err()
        || env::var("INSTRUMENT_OWNER_DATABASE_URL").is_err()
    {
        return Ok(None);
    }
    Ok(Some(
        instrument_economic_terms_admission_from_environment_v1().await?,
    ))
}

/// Composes the instrument catalog `list_instruments` and `describe_instrument` read when both
/// stores it reads are configured: Market Data's Instrument Master V2 and the Instrument Owner's
/// economic terms.
pub(crate) async fn bootstrap_market_data_instrument_catalog()
-> anyhow::Result<Option<Arc<dyn InstrumentCatalogReadV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err()
        || env::var("INSTRUMENT_OWNER_DATABASE_URL").is_err()
    {
        return Ok(None);
    }
    Ok(Some(Arc::new(
        instrument_catalog_read_from_environment_v1().await?,
    )))
}

/// Builds the Binance USD-M client `admit_binance_perpetual` fetches `exchangeInfo` through.
///
/// The base URL is named rather than discovered, for the same reason the PIT Data Client's is: a
/// deployment that must reach another host than `fapi.binance.com` - a test's local stand-in, or a
/// network where the canonical host answers `451` - says so. The endpoint is public and unsigned,
/// so no credential is read here.
pub(crate) fn binance_perpetual_admission_client() -> anyhow::Result<Arc<BinanceFuturesHttpClient>>
{
    let base_url = env::var("BINANCE_PERPETUAL_ADMISSION_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    Ok(Arc::new(BinanceFuturesHttpClient::new(
        BinanceProductType::UsdM,
        BinanceEnvironment::Live,
        get_atomic_clock_realtime(),
        None,
        None,
        base_url,
        None,
        Some(30),
        None,
        false,
    )?))
}

/// Composes the Binance perpetual admission route's `exchangeInfo` client when Market Data's
/// store is configured.
pub(crate) fn bootstrap_market_data_binance_perpetual_admission()
-> anyhow::Result<Option<Arc<BinanceFuturesHttpClient>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(binance_perpetual_admission_client()?))
}

/// Composes the backfill job fact store when Market Data's store is configured.
pub(crate) async fn bootstrap_market_data_backfill_jobs()
-> anyhow::Result<Option<Arc<dyn vibe_data::owner::backfill_job_v1::BackfillJobV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        vibe_data::owner::backfill_job_v1::backfill_job_from_environment_v1().await?,
    ))
}

/// Composes the PIT window custody commit when Market Data's store is configured.
pub(crate) async fn bootstrap_market_data_custody_commit() -> anyhow::Result<
    Option<Arc<dyn vibe_data::owner::pit_window_custody_v1::PitWindowCustodyCommitV1>>,
> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        vibe_data::owner::pit_window_custody_v1::pit_window_custody_commit_from_environment_v1()
            .await?,
    ))
}

/// Composes the funding settlement commit when Market Data's store is configured.
pub(crate) async fn bootstrap_market_data_funding_settlement_commit() -> anyhow::Result<
    Option<Arc<dyn vibe_data::owner::funding_settlement_commit_v1::FundingSettlementCommitV1>>,
> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        vibe_data::owner::funding_settlement_commit_v1::funding_settlement_commit_from_environment_v1(
        )
        .await?,
    ))
}

/// Composes the PIT window custody frames port when Market Data's store admission environment
/// is configured.
pub(crate) async fn bootstrap_market_data_custody_frames() -> anyhow::Result<
    Option<Arc<dyn vibe_data::owner::pit_window_custody_v1::PitWindowCustodyFramesV1>>,
> {
    Ok(vibe_data::owner::pit_window_custody_frames_from_store_admission_environment_v1().await?)
}

/// Composes the Market Data Source Binding admission when its store is configured.
pub(crate) async fn bootstrap_market_data_source_binding_admission()
-> anyhow::Result<Option<Arc<dyn SourceBindingAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(source_binding_admission_from_environment_v1().await?))
}

pub(crate) async fn bootstrap_deployment_store_admission()
-> anyhow::Result<Option<Arc<dyn ResearchPitTerminalResolver>>> {
    Ok(research_pit_terminal_resolver_from_store_admission_environment().await?)
}

#[cfg(test)]
pub(crate) async fn bootstrap_deployment_store_admission_from_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> anyhow::Result<Option<Arc<dyn ResearchPitTerminalResolver>>> {
    Ok(research_pit_terminal_resolver_from_store_admission_lookup(lookup).await?)
}

pub(crate) async fn health() -> &'static str {
    "ok"
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn develop_composer_a0_executions(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    (
        StatusCode::OK,
        Json(DevelopComposerA0ExecutionsV1 {
            schema_version: 1,
            a0_executions: sealed_source_research_composer_a0_execution_count_v2(),
        }),
    )
        .into_response()
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn read_sealed_develop_composer_for_acceptance(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if let Err(status) = admit_sealed_acceptance_fault_control(state.allow_acceptance_faults) {
        return status.into_response();
    }
    let operation: DevelopComposerOperationResponseV2 = match serde_json::from_slice(&body) {
        Ok(operation) => operation,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let locator = match DevelopComposerSealedReadLocatorV2::from_accepted_response(&operation) {
        Ok(locator) => locator,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state.develop_composer.read_accepted(&locator).await {
        Ok(readback) => Json(serde_json::json!({
            "request_identity": readback.locator().request_identity,
            "artifact_identity": readback.locator().artifact_identity,
            "research_request_identity": readback.research_request_identity(),
            "intent_identity": readback.intent_identity(),
            "design_identity": readback.design_identity(),
            "plan_bytes_digest": readback.plan_bytes_digest(),
            "artifact_package_bytes_digest": readback.artifact_package_bytes_digest(),
            "module_bytes_digests": readback.module_bytes_digests(),
        }))
        .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, request_identity = %operation.request_identity, "Sealed Develop Composer read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn run_develop_composer_with_acceptance_control(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if let Err(status) = admit_sealed_acceptance_fault_control(state.allow_acceptance_faults) {
        return status.into_response();
    }
    let request: SourceResearchComposerAcceptanceRunV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .develop_composer
        .run_with_acceptance_control(&request.research_request_locator, request.control)
        .await
    {
        Ok(response) => composer_operation_response(response),
        Err(e) => {
            tracing::warn!(error = %e, research_request_locator = %request.research_request_locator, "Develop Composer acceptance run unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn resolve_develop_composer_with_acceptance_tamper(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if let Err(status) = admit_sealed_acceptance_fault_control(state.allow_acceptance_faults) {
        return status.into_response();
    }
    let request: SourceResearchComposerAcceptanceResolveV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .develop_composer
        .resolve_with_acceptance_tamper(&request_identity, request.tamper)
        .await
    {
        Ok(response) => composer_operation_response(response),
        Err(e) => {
            tracing::warn!(error = %e, %request_identity, "Develop Composer acceptance resolve unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) fn admit_sealed_acceptance_fault_control(enabled: bool) -> Result<(), StatusCode> {
    enabled.then_some(()).ok_or(StatusCode::NOT_FOUND)
}

pub(crate) async fn issue_replay_composition(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(not(feature = "composer-replay-issuance"))]
    {
        let _ = body;
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
    #[cfg(feature = "composer-replay-issuance")]
    {
        let command: ReplayCompositionLocatorOnlyIssuanceRequestV1 =
            match serde_json::from_slice(&body) {
                Ok(command) => command,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            };
        let Some(replay_composition) = &state.replay_composition else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };

        replay_composition_issuance_response(replay_composition.issue_binding_v1(&command).await)
    }
}

/// Issues a universe-member composition binding: the locator-only command names no Instrument
/// Master, census, joined cut or sample projection, and is recovered through the same resolve
/// route, since an issuance identity is one namespace whichever shape it issued.
pub(crate) async fn issue_universe_member_replay_composition(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(not(feature = "composer-replay-issuance"))]
    {
        let _ = body;
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
    #[cfg(feature = "composer-replay-issuance")]
    {
        let command: ReplayCompositionLocatorOnlyIssuanceRequestV1<
            ReplayCompositionUniverseBindingIssuanceRequestV1,
        > = match serde_json::from_slice(&body) {
            Ok(command) => command,
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        };
        let Some(replay_composition) = &state.replay_composition else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };
        replay_composition_issuance_response(
            replay_composition
                .issue_universe_member_binding_v1(&command)
                .await,
        )
    }
}

#[cfg(feature = "composer-replay-issuance")]
pub(crate) fn replay_composition_issuance_response(
    issued: Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1>,
) -> Response {
    match issued {
        Ok(response) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            response.canonical_bytes().to_vec(),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "Replay composition issuance refused");
            replay_composition_refusal(e)
        }
    }
}

pub(crate) async fn resolve_replay_composition(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(not(feature = "composer-replay-issuance"))]
    {
        let _ = body;
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
    #[cfg(feature = "composer-replay-issuance")]
    {
        let locator: ReplayCompositionIssuanceLocatorV1 = match serde_json::from_slice(&body) {
            Ok(locator) => locator,
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        };
        let Some(replay_composition) = &state.replay_composition else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };

        match replay_composition.recover_issuance_v1(locator).await {
            Ok(response) => (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                response.canonical_bytes().to_vec(),
            )
                .into_response(),
            Err(e) => {
                tracing::warn!(error = %e, "Replay composition issuance recovery refused");
                replay_composition_refusal(e)
            }
        }
    }
}

pub(crate) async fn run_develop_composer(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return composer_response(
            StatusCode::FORBIDDEN,
            default_unavailable_response("unbound"),
        );
    }

    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        // The whole public input is the Research request locator. The Design comes from that
        // request's frozen Bounded Feature Program, and its Market Data bindings are resolved
        // inside the Owner transaction, so a caller can supply neither.
        let request: SourceResearchComposerLocatorV2 = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(_) => {
                return composer_response(
                    StatusCode::BAD_REQUEST,
                    default_unavailable_response("unbound"),
                );
            }
        };

        match state
            .develop_composer
            .run_bounded_feature_program(&request.research_request_locator)
            .await
        {
            Ok(response) => composer_operation_response(response),
            Err(e) => {
                tracing::warn!(error = %e, research_request_locator = %request.research_request_locator, "Bounded feature program Composer run unavailable");
                composer_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    default_unavailable_response(&request.research_request_locator),
                )
            }
        }
    }

    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    {
        if develop_composer_body_injects_evidence(&body) {
            return composer_response(
                StatusCode::BAD_REQUEST,
                default_unavailable_response(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2),
            );
        }

        match state.develop_composer.run().await {
            Ok(response) => composer_operation_response(response),
            Err(_) => composer_response(
                StatusCode::ACCEPTED,
                submitted_or_unknown_response(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2),
            ),
        }
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    {
        let request: SourceResearchComposerLocatorV2 = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(_) => {
                return composer_response(
                    StatusCode::BAD_REQUEST,
                    default_unavailable_response("unbound"),
                );
            }
        };

        match state
            .develop_composer
            .run(&request.research_request_locator)
            .await
        {
            Ok(response) => {
                let delay_after_commit =
                    response.disposition == DevelopComposerOperationDispositionV2::Success;
                let response = composer_operation_response(response);

                if delay_after_commit {
                    maybe_delay(state.allow_acceptance_faults, &headers).await;
                }
                response
            }
            Err(e) => {
                tracing::warn!(error = %e, research_request_locator = %request.research_request_locator, "Develop Composer run unavailable");
                composer_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    default_unavailable_response(&request.research_request_locator),
                )
            }
        }
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn project_develop_composer_request(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(request): Query<SourceResearchComposerLocatorV2>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state
        .develop_composer
        .request_projection(&request.research_request_locator)
        .await
    {
        Ok(projection) => (StatusCode::OK, Json(projection)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, research_request_locator = %request.research_request_locator, "Develop Composer request projection unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(not(feature = "sealed-source-intake-composer-acceptance"))]
pub(crate) async fn project_develop_composer_request() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

pub(crate) async fn resolve_develop_composer(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return composer_response(
            StatusCode::FORBIDDEN,
            default_unavailable_response(&request_identity),
        );
    }

    #[cfg(not(feature = "composer-replay-issuance"))]
    {
        let _ = body;
        composer_response(
            StatusCode::SERVICE_UNAVAILABLE,
            default_unavailable_response(&request_identity),
        )
    }

    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    {
        if develop_composer_body_injects_evidence(&body) {
            return composer_response(
                StatusCode::BAD_REQUEST,
                default_unavailable_response(&request_identity),
            );
        }

        match state.develop_composer.resolve(&request_identity).await {
            Ok(response) => composer_operation_response(response),
            Err(_) => composer_response(
                StatusCode::ACCEPTED,
                submitted_or_unknown_response(&request_identity),
            ),
        }
    }

    #[cfg(all(
        feature = "composer-replay-issuance",
        any(
            feature = "sealed-source-intake-composer-acceptance",
            not(feature = "sealed-develop-composer-acceptance")
        )
    ))]
    {
        if !body.is_empty() {
            return composer_response(
                StatusCode::BAD_REQUEST,
                default_unavailable_response(&request_identity),
            );
        }

        match state.develop_composer.resolve(&request_identity).await {
            Ok(response) => composer_operation_response(response),
            Err(_) => composer_response(
                StatusCode::ACCEPTED,
                submitted_or_unknown_response(&request_identity),
            ),
        }
    }
}

pub(crate) async fn read_develop_composer(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return composer_response(
            StatusCode::FORBIDDEN,
            default_unavailable_response(&request_identity),
        );
    }

    #[cfg(not(feature = "composer-replay-issuance"))]
    {
        let _ = state;
        composer_response(
            StatusCode::SERVICE_UNAVAILABLE,
            default_unavailable_response(&request_identity),
        )
    }

    #[cfg(feature = "composer-replay-issuance")]
    {
        match state.develop_composer.resolve(&request_identity).await {
            Ok(response) => composer_operation_response(response),
            Err(e) => {
                tracing::warn!(error = %e, %request_identity, "Develop Composer read unavailable");
                composer_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    default_unavailable_response(&request_identity),
                )
            }
        }
    }
}

pub(crate) fn composer_operation_response(
    response: DevelopComposerOperationResponseV2,
) -> Response {
    let status = match response.disposition {
        DevelopComposerOperationDispositionV2::Success => StatusCode::OK,
        DevelopComposerOperationDispositionV2::Conflict => StatusCode::CONFLICT,
        DevelopComposerOperationDispositionV2::Unsupported
        | DevelopComposerOperationDispositionV2::NeedsResearchRefinement => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        DevelopComposerOperationDispositionV2::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        DevelopComposerOperationDispositionV2::SubmittedOrUnknown => StatusCode::ACCEPTED,
    };
    composer_response(status, response)
}

pub(crate) fn composer_response(
    status: StatusCode,
    response: DevelopComposerOperationResponseV2,
) -> Response {
    (status, Json(response)).into_response()
}

#[cfg(any(
    test,
    all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    )
))]
pub(crate) fn develop_composer_body_injects_evidence(body: &[u8]) -> bool {
    body.iter().any(|byte| !byte.is_ascii_whitespace())
}

pub(crate) async fn resolve(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    match state
        .owner
        .preflight_request_identity(&request_identity)
        .await
    {
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined) => {
            return match state
                .owner
                .resolve_legacy_quarantined_v1(&request_identity)
                .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err(e) => owner_error(&e, &request_identity),
            };
        }
        Err(e) => return owner_error(&e, &request_identity),
        Ok(
            ResearchRequestIdentityPreflightV1::Vacant
            | ResearchRequestIdentityPreflightV1::Current,
        ) => {}
    }
    let admission = match state
        .product_edge
        .resolve_admission(&request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return (
                StatusCode::ACCEPTED,
                Json(unresolved_result(&request_identity)),
            )
                .into_response();
        }
        Err(e) => return product_edge_error(&e, &request_identity, false),
    };

    match state
        .owner
        .resolve_historical_v1(&request_identity, admission.locator())
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error(&e, &request_identity),
    }
}

pub(crate) async fn resolve_v2(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    if let Some(refusal) = research_preflight_refusal(
        state
            .owner
            .preflight_request_identity(&request_identity)
            .await,
        &request_identity,
    ) {
        return refusal;
    }
    let admission = match state
        .product_edge
        .resolve_admission(&request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return (
                StatusCode::ACCEPTED,
                Json(unresolved_result_v2(&request_identity)),
            )
                .into_response();
        }
        Err(e) => return product_edge_error(&e, &request_identity, true),
    };

    match state
        .owner
        .resolve_v2(&request_identity, admission.locator())
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error_v2(&e, &request_identity),
    }
}

pub(crate) async fn resolve_family_by_intent(
    State(state): State<ApiState>,
    Path(intent_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    direct_family_response(
        state
            .owner
            .resolve_trial_family_by_intent(&intent_identity)
            .await,
    )
}

pub(crate) async fn resolve_family_by_artifact(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<ArtifactFamilyResolveRequestV1>,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state
        .owner
        .resolve_trial_family_by_artifact(
            &request.artifact_identity,
            &request.build_receipt_identity,
        )
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => direct_family_error(&e),
    }
}

pub(crate) fn direct_family_response(
    result: Result<TrialFamilyDirectResultV1, TrialFamilyError>,
) -> Response {
    match result {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => direct_family_error(&e),
    }
}

pub(crate) fn direct_family_error(error: &TrialFamilyError) -> Response {
    let (status, result) = match error {
        TrialFamilyError::LegacyUnavailable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            TrialFamilyDirectResultV1::legacy_unavailable(),
        ),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            TrialFamilyDirectResultV1::unavailable(),
        ),
    };
    (status, Json(result)).into_response()
}

pub(crate) async fn prepare_artifact_build(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_preparation_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_preparation_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = match artifact_request(&state, operation).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    match state.artifact_owner.prepare(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_preparation_error(&e, &build_request_identity, &attempt_identity),
    }
}

pub(crate) async fn submit_artifact_candidate(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildCandidateOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = match artifact_request(&state, operation.request).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    let admission = request.admission.clone();
    let invocation = match state
        .product_edge
        .resolve_provider_invocation_claim(&admission, &attempt_identity)
        .await
    {
        Ok(invocation) => invocation,
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };
    let started = invocation
        .as_ref()
        .filter(|claim| claim.state() == ProductEdgeInvocationStateV1::InvocationStarted);
    let response = match state
        .artifact_owner
        .submit_candidate(request, operation.candidate, started)
        .await
    {
        Ok(result) => artifact_result_response(&state, &admission, &attempt_identity, result).await,
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    };
    maybe_delay(state.allow_acceptance_faults, &headers).await;
    response
}

pub(crate) async fn claim_provider_invocation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let operation: ArtifactBuildOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let request = match artifact_request(&state, operation).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };

    match state
        .product_edge
        .resolve_provider_invocation_claim(&request.admission, &request.attempt_identity)
        .await
    {
        Ok(Some(existing)) => return (StatusCode::OK, Json(existing)).into_response(),
        Ok(None) => {}
        Err(e) => {
            return artifact_product_edge_error(
                &e,
                &request.build_request_identity,
                &request.attempt_identity,
            );
        }
    }
    let preparation = match state.artifact_owner.prepare(request.clone()).await {
        Ok(preparation) => preparation,
        Err(e) => {
            return artifact_preparation_error(
                &e,
                &request.build_request_identity,
                &request.attempt_identity,
            );
        }
    };

    if preparation.resolution() != ArtifactBuildResolution::Prepared {
        return (StatusCode::CONFLICT, Json(preparation)).into_response();
    }

    match state
        .product_edge
        .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
            admission: request.admission,
            attempt_identity: request.attempt_identity,
        })
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => artifact_product_edge_error(&e, &request.build_request_identity, "unavailable"),
    }
}

pub(crate) async fn start_provider_invocation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let operation: ArtifactBuildInvocationStartOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let build_request_identity = operation.build_request_identity;
    let attempt_identity = operation.attempt_identity;
    let research_request_identity = operation.research_request_identity;
    let claim = match state
        .product_edge
        .resolve_provider_invocation_claim_by_request(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(Some(claim)) => claim,
        Ok(None) => {
            return artifact_product_edge_error(
                &ProductEdgeError::unavailable_for(
                    vibe_product_edge::ProductEdgeUnavailableReasonV1::Missing,
                    vibe_product_edge::ProductEdgeSubjectKindV1::Request,
                    &build_request_identity,
                ),
                &build_request_identity,
                &attempt_identity,
            );
        }
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    if !invocation_start_recovery_state(claim.state()) {
        return artifact_unknown(
            StatusCode::CONFLICT,
            "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
            &build_request_identity,
            &attempt_identity,
        );
    }
    let reserved = match state
        .artifact_owner
        .reserve_provider_invocation_custody(&build_request_identity, &attempt_identity, claim)
        .await
    {
        Ok(custody) => custody,
        Err(e) => {
            return artifact_preparation_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    let (start_reservation, execution_custody) = reserved.into_parts();
    if execution_custody.research_request_identity() != research_request_identity {
        return artifact_unknown(
            StatusCode::CONFLICT,
            "RESEARCH_REQUEST_IDENTITY_CONFLICT",
            &build_request_identity,
            &attempt_identity,
        );
    }

    match state
        .product_edge
        .start_provider_invocation(start_reservation)
        .await
    {
        Ok(invocation_start) => (
            StatusCode::OK,
            Json(ArtifactBuildInvocationStartApiResultV1 {
                invocation_start,
                execution_custody,
            }),
        )
            .into_response(),
        Err(e) => artifact_product_edge_error(&e, &build_request_identity, &attempt_identity),
    }
}

pub(crate) fn invocation_start_recovery_state(state: ProductEdgeInvocationStateV1) -> bool {
    matches!(
        state,
        ProductEdgeInvocationStateV1::Claimed | ProductEdgeInvocationStateV1::InvocationStarted
    )
}

pub(crate) async fn fail_artifact_build(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "unbound",
            "unbound",
        );
    }
    let operation: ArtifactBuildFailureOperationV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
                "unbound",
            );
        }
    };
    let request = match artifact_request(&state, operation.request).await {
        Ok(request) => request,
        Err((error, request_identity, attempt_identity)) => {
            return artifact_product_edge_error(&error, &request_identity, &attempt_identity);
        }
    };
    let build_request_identity = request.build_request_identity.clone();
    let attempt_identity = request.attempt_identity.clone();
    let admission = request.admission.clone();
    let invocation = match state
        .product_edge
        .resolve_provider_invocation_claim(&admission, &attempt_identity)
        .await
    {
        Ok(invocation) => invocation,
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };
    let started = invocation
        .as_ref()
        .filter(|claim| claim.state() == ProductEdgeInvocationStateV1::InvocationStarted);

    match state
        .artifact_owner
        .fail_no_artifact(request, &operation.failure_code, started)
        .await
    {
        Ok(result) => artifact_result_response(&state, &admission, &attempt_identity, result).await,
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

pub(crate) async fn resolve_artifact_build(
    State(state): State<ApiState>,
    Path((build_request_identity, attempt_identity)): Path<(String, String)>,
    headers: HeaderMap,
    _body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            &build_request_identity,
            &attempt_identity,
        );
    }

    match state
        .artifact_owner
        .preflight_request_identity(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined) => {
            return match state
                .artifact_owner
                .resolve_legacy_terminal_quarantined(&build_request_identity, &attempt_identity)
                .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
            };
        }
        Ok(
            ArtifactRequestIdentityPreflightV1::Vacant
            | ArtifactRequestIdentityPreflightV1::Current,
        ) => {}
        Err(e) => {
            return artifact_error(&e, &build_request_identity, &attempt_identity);
        }
    }

    let admission = match state
        .product_edge
        .resolve_admission(&build_request_identity, &state.request_proof_digest)
        .await
    {
        Ok(Some(admission)) => admission,
        Ok(None) => {
            return artifact_unknown(
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_OUTCOME_UNKNOWN",
                &build_request_identity,
                &attempt_identity,
            );
        }
        Err(e) => {
            return artifact_product_edge_error(&e, &build_request_identity, &attempt_identity);
        }
    };

    match state
        .artifact_owner
        .resolve(
            &build_request_identity,
            &attempt_identity,
            admission.locator(),
        )
        .await
    {
        Ok(result) => {
            artifact_result_response(&state, admission.locator(), &attempt_identity, result).await
        }
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

pub(crate) async fn read_artifact_source(
    State(state): State<ApiState>,
    Path((build_request_identity, attempt_identity)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return artifact_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            &build_request_identity,
            &attempt_identity,
        );
    }

    match state
        .artifact_source_owner
        .read_source(&build_request_identity, &attempt_identity)
        .await
    {
        Ok(Some(readback)) => (StatusCode::OK, Json(readback)).into_response(),
        Ok(None) => artifact_rejection(
            StatusCode::NOT_FOUND,
            "ARTIFACT_SOURCE_UNAVAILABLE",
            &build_request_identity,
            &attempt_identity,
        ),
        Err(e) => artifact_error(&e, &build_request_identity, &attempt_identity),
    }
}

pub(crate) fn artifact_source_router() -> Router<ApiState> {
    Router::new().route(
        "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source",
        get(read_artifact_source),
    )
}

pub(crate) async fn read_artifact_directory(
    State(state): State<ApiState>,
    Query(query): Query<ArtifactDirectoryQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let after = match (
        query.after_prepared_at_epoch_ms,
        query.after_build_request_identity,
    ) {
        (None, None) => None,
        (Some(prepared_at_epoch_ms), Some(build_request_identity)) => {
            Some(ArtifactDirectoryCursorV1 {
                prepared_at_epoch_ms,
                build_request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .artifact_directory_owner
        .list_artifacts(after.as_ref(), query.limit.unwrap_or(20))
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(ArtifactBuildError::Candidate(_)) => StatusCode::BAD_REQUEST.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "Artifact directory read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub(crate) async fn read_research_directory(
    State(state): State<ApiState>,
    Query(query): Query<ResearchDirectoryQueryV1>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let limit = query.limit.unwrap_or(20);
    if !(1..=20).contains(&limit) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let after = match (
        query.after_committed_at_epoch_ms,
        query.after_request_identity,
    ) {
        (None, None) => None,
        (Some(committed_at_epoch_ms), Some(request_identity))
            if valid_directory_identity(&request_identity) =>
        {
            Some(ResearchDirectoryCursorV1 {
                committed_at_epoch_ms,
                request_identity,
            })
        }
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };

    match state
        .research_directory_owner
        .list_research(after.as_ref(), limit)
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "Research directory read unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub(crate) async fn read_research_v2(
    State(state): State<ApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if !valid_research_readback_identity(&request_identity) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    read_research_v2_through(state.research_readback_owner.as_ref(), &request_identity).await
}

/// Answers one authorized, well-formed Research readback through the Owner port.
///
/// Split from the handler so the refusal can be driven through the port alone: `ApiState` holds
/// two Postgres Owners that only an async `connect` can build, and `preflight_then_admit_artifact_request`
/// is the precedent for taking the port rather than the state.
pub(crate) async fn read_research_v2_through(
    owner: &dyn ResearchReadbackOwnerPortV1,
    request_identity: &str,
) -> Response {
    match owner.read_research_v2(request_identity).await {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, %request_identity, "Research readback unavailable");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub(crate) async fn read_historical_custodies(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match state
        .historical_custody_owner
        .read_historical_custodies()
        .await
    {
        Ok(readback) => (StatusCode::OK, Json(readback)).into_response(),
        Err(HistoricalCustodyErrorV1::Storage(_)) => {
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

pub(crate) fn valid_research_readback_identity(value: &str) -> bool {
    (1..=192).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
        })
}

pub(crate) fn valid_directory_identity(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

pub(crate) async fn artifact_result_response(
    state: &ApiState,
    admission: &ProductEdgeAdmissionLocatorV1,
    attempt_identity: &str,
    owner_result: ArtifactBuildResultV1,
) -> Response {
    if owner_result.owner_receipt().is_some() {
        return (
            StatusCode::OK,
            Json(ArtifactBuildApiResultV1 {
                owner_result,
                provider_invocation: None,
            }),
        )
            .into_response();
    }

    match state
        .product_edge
        .resolve_provider_invocation_claim(admission, attempt_identity)
        .await
    {
        Ok(provider_invocation) => (
            StatusCode::OK,
            Json(ArtifactBuildApiResultV1 {
                owner_result,
                provider_invocation,
            }),
        )
            .into_response(),
        Err(e) => artifact_product_edge_error(&e, &admission.request_identity, attempt_identity),
    }
}

pub(crate) async fn artifact_request(
    state: &ApiState,
    operation: ArtifactBuildOperationRequestV1,
) -> Result<ArtifactBuildRequestV1, (ProductEdgeError, String, String)> {
    let build_request_identity = operation.build_request_identity.clone();
    let attempt_identity = operation.attempt_identity.clone();
    let admission = preflight_then_admit_artifact_request(
        state.artifact_owner.as_ref(),
        &build_request_identity,
        &attempt_identity,
        || admit_artifact_product_edge_request(state, &operation, &build_request_identity),
    )
    .await?;
    Ok(ArtifactBuildRequestV1 {
        build_request_identity: operation.build_request_identity,
        attempt_identity: operation.attempt_identity,
        intent_identity: operation.intent_identity,
        channel: operation.channel,
        admission: admission.locator().clone(),
    })
}

pub(crate) async fn admit_artifact_product_edge_request(
    state: &ApiState,
    operation: &ArtifactBuildOperationRequestV1,
    build_request_identity: &str,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    state
        .product_edge
        .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
            request_identity: build_request_identity.to_string(),
            typed_payload: serde_json::to_value(operation)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
            operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects: ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
                .iter()
                .map(|effect| (*effect).to_string())
                .collect(),
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{build_request_identity}"),
        })
        .await
}

pub(crate) async fn preflight_then_admit_artifact_request<T, Admit, AdmitFuture>(
    artifact_owner: &dyn ArtifactBuildOwnerPort,
    build_request_identity: &str,
    attempt_identity: &str,
    admit: Admit,
) -> Result<T, (ProductEdgeError, String, String)>
where
    Admit: FnOnce() -> AdmitFuture,
    AdmitFuture: Future<Output = Result<T, ProductEdgeError>>,
{
    match artifact_owner
        .preflight_request_identity(build_request_identity, attempt_identity)
        .await
    {
        Ok(
            ArtifactRequestIdentityPreflightV1::Vacant
            | ArtifactRequestIdentityPreflightV1::Current,
        ) => {}
        Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined) => {
            return Err((
                ProductEdgeError::unavailable_for(
                    vibe_product_edge::ProductEdgeUnavailableReasonV1::DownstreamCustodyMismatch,
                    vibe_product_edge::ProductEdgeSubjectKindV1::Request,
                    build_request_identity,
                ),
                build_request_identity.to_string(),
                attempt_identity.to_string(),
            ));
        }
        // The caller sees the same `OWNER_OUTCOME_UNKNOWN` either way; what differs is the log. A
        // store failure reported as `DownstreamCustodyMismatch` names a custody problem that was
        // never observed and discards the error that was.
        Err(e) => {
            return Err((
                ProductEdgeError::Storage(e.to_string()),
                build_request_identity.to_string(),
                attempt_identity.to_string(),
            ));
        }
    }

    admit().await.map_err(|e| {
        (
            e,
            build_request_identity.to_string(),
            attempt_identity.to_string(),
        )
    })
}

pub(crate) fn artifact_preparation_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, _next) = artifact_error_parts(error);
    let preparation = match resolution {
        ArtifactBuildResolution::IdentityConflict => {
            ArtifactBuildPreparationV1::identity_conflict(build_request_identity, attempt_identity)
        }
        ArtifactBuildResolution::SubmittedOrUnknown => {
            ArtifactBuildPreparationV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            )
        }
        _ => ArtifactBuildPreparationV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        ),
    };
    let mut response = (status, Json(preparation)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn artifact_error(
    error: &ArtifactBuildError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, resolution, _next) = artifact_error_parts(error);
    let mut response = (
        status,
        Json(match resolution {
            ArtifactBuildResolution::IdentityConflict => {
                ArtifactBuildResultV1::identity_conflict(build_request_identity, attempt_identity)
            }
            ArtifactBuildResolution::SubmittedOrUnknown => {
                ArtifactBuildResultV1::submitted_or_unknown(
                    build_request_identity,
                    attempt_identity,
                )
            }
            _ => ArtifactBuildResultV1::submitted_or_unknown(
                build_request_identity,
                attempt_identity,
            ),
        }),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn artifact_error_parts(
    error: &ArtifactBuildError,
) -> (
    StatusCode,
    &'static str,
    ArtifactBuildResolution,
    ArtifactBuildNextLegalAction,
) {
    match error {
        ArtifactBuildError::ConflictingReplay => (
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            ArtifactBuildResolution::IdentityConflict,
            ArtifactBuildNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
        ArtifactBuildError::Unauthorized(_) => (
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
        ArtifactBuildError::Candidate(_) => (
            StatusCode::BAD_REQUEST,
            "CANDIDATE_REJECTED",
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
        ArtifactBuildError::Sandbox(_) | ArtifactBuildError::Storage(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            ArtifactBuildResolution::SubmittedOrUnknown,
            ArtifactBuildNextLegalAction::ResolveSameAttemptIdentity,
        ),
    }
}

pub(crate) fn artifact_preparation_rejection(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildPreparationV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn artifact_rejection(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildResultV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn artifact_unknown(
    status: StatusCode,
    code: &str,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let mut response = (
        status,
        Json(ArtifactBuildResultV1::submitted_or_unknown(
            build_request_identity,
            attempt_identity,
        )),
    )
        .into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn insert_rejection_code(response: &mut Response, code: &str) {
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
}

/// Answers a replay composition refusal with the status its cause supports.
///
/// A variant leaves 503 only when every site that constructs it on the issuance and recovery paths
/// is the caller's request or a fact the store declared, never a store failure. Seven qualify.
/// `InvalidRequest` is raised only by validation of the caller's command, including a locator that
/// contradicts the composition it was sent with. `IssuanceIdentityConflict` is raised only where the
/// Owner has established that the identity and the request disagree with an issuance it holds -
/// the identity stores a different request, or the request is stored under another identity -
/// which is the conflict this file already answers as `CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY`.
/// `PriceAdjustmentUnknown` is raised only when a Market Semantics fact declares its price
/// adjustment unknown, a statement about the data that takes the 422 this file gives a well-formed
/// request the Owner declines on semantics. `ExecutionRoleAmbiguous`,
/// `ExecutionTimeframeNotDeclared` and `ExecutionBarExceedsR0Window` are raised only while issuance
/// derives the Replay window from the Design's roles and the bars the Source Binding declares, and
/// `SessionOutsideReplayWindow` only while issuance composes the snapshot's sessions against that
/// window; each is a statement that the Design cannot be replayed over this snapshot as it stands.
///
/// The rest stay 503 because their sites are the store's, and a 4xx would tell a caller its request
/// is wrong when the store may be at fault. `DigestMismatch` now reports only stored bytes,
/// attestations or a just-built binding that fail to reproduce their own digest. `UnknownBinding`
/// also reports a stored issuance whose binding cannot be recovered. `NonCanonicalOrder`,
/// `IncompleteComposition` and `DependencyMismatch` are raised while decoding stored bytes or
/// validating evidence the Owner assembled itself. `CompositionShapeMismatch` reports stored custody
/// whose binding and facts disagree on their shape, and `UniverseFrameMismatch` a universe frame the
/// Owner assembled that does not match the request it issues for. `AmbiguousBinding` and
/// `LegacyUnbound` are not constructed at all. Moving any of these off 503 needs the variant split
/// where it is raised.
#[cfg(feature = "composer-replay-issuance")]
pub(crate) fn replay_composition_refusal(error: ReplayCompositionBindingErrorV1) -> Response {
    let (status, code) = match error {
        ReplayCompositionBindingErrorV1::InvalidRequest => (StatusCode::BAD_REQUEST, None),
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict => (
            StatusCode::CONFLICT,
            Some("CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY"),
        ),
        ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown => {
            (StatusCode::UNPROCESSABLE_ENTITY, None)
        }
        // The Design cannot be replayed over this snapshot as it stands; each names why, and no
        // retry changes it.
        ReplayCompositionBindingErrorV1::ExecutionRoleAmbiguous => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("EXECUTION_ROLE_AMBIGUOUS"),
        ),
        ReplayCompositionBindingErrorV1::ExecutionTimeframeNotDeclared => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("EXECUTION_TIMEFRAME_NOT_DECLARED"),
        ),
        ReplayCompositionBindingErrorV1::ExecutionBarExceedsR0Window => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("EXECUTION_BAR_EXCEEDS_R0_WINDOW"),
        ),
        ReplayCompositionBindingErrorV1::SessionOutsideReplayWindow => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("SESSION_OUTSIDE_REPLAY_WINDOW"),
        ),
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable
        | ReplayCompositionBindingErrorV1::DigestMismatch
        | ReplayCompositionBindingErrorV1::UnknownBinding
        | ReplayCompositionBindingErrorV1::NonCanonicalOrder
        | ReplayCompositionBindingErrorV1::IncompleteComposition
        | ReplayCompositionBindingErrorV1::DependencyMismatch
        | ReplayCompositionBindingErrorV1::AmbiguousBinding
        | ReplayCompositionBindingErrorV1::LegacyUnbound
        | ReplayCompositionBindingErrorV1::CompositionShapeMismatch
        | ReplayCompositionBindingErrorV1::UniverseFrameMismatch => {
            (StatusCode::SERVICE_UNAVAILABLE, None)
        }
    };
    let mut response = status.into_response();
    if let Some(code) = code {
        insert_rejection_code(&mut response, code);
    }
    response
}

pub(crate) fn owner_error(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
    match error {
        ResearchGoalOwnerError::ConflictingReplay => {
            let mut response = (
                StatusCode::CONFLICT,
                Json(identity_conflict_result(request_identity)),
            )
                .into_response();
            response.headers_mut().insert(
                "x-rd-rejection-code",
                "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY"
                    .parse()
                    .expect("static header value"),
            );
            response
        }
        ResearchGoalOwnerError::Unauthorized(_) => rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            request_identity,
        ),
        ResearchGoalOwnerError::Storage(_) => rejection(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
            request_identity,
        ),
    }
}

/// Answers a research request identity preflight, or returns `None` when the request may proceed.
///
/// A store failure and a legacy-quarantined identity are different answers. The quarantined
/// identity is a fact about the request, established by reading it. A failed preflight is a fact
/// about the store, reached before the request was read at all, so it gets the same
/// `OWNER_UNAVAILABLE` that `submit_v2` and `resolve_v2` each give for a store failure later in
/// their own paths. Folding the two together answered a store failure with the legacy-quarantine
/// result, `SUBMITTED_OR_UNKNOWN` and `RESOLVE_SAME_REQUEST_IDENTITY`: a statement about the request
/// that nothing had established.
pub(crate) fn research_preflight_refusal(
    preflight: Result<ResearchRequestIdentityPreflightV1, ResearchGoalOwnerError>,
    request_identity: &str,
) -> Option<Response> {
    match preflight {
        Ok(
            ResearchRequestIdentityPreflightV1::Vacant
            | ResearchRequestIdentityPreflightV1::Current,
        ) => None,
        Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined) => Some(
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(unresolved_result_v2(request_identity)),
            )
                .into_response(),
        ),
        Err(e) => {
            tracing::warn!(error = %e, %request_identity, "Research request identity preflight unavailable");
            Some(owner_error_v2(&e, request_identity))
        }
    }
}

pub(crate) fn owner_error_v2(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
    match error {
        ResearchGoalOwnerError::ConflictingReplay => {
            let result = identity_conflict_result_v2(request_identity);
            let mut response = (StatusCode::CONFLICT, Json(result)).into_response();
            insert_rejection_code(&mut response, "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY");
            response
        }
        ResearchGoalOwnerError::Unauthorized(_) => rejection_v2(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            request_identity,
        ),
        ResearchGoalOwnerError::Storage(_) => rejection_v2(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_UNAVAILABLE",
            request_identity,
        ),
    }
}

pub(crate) fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let result = if code == "OWNER_UNAVAILABLE" {
        unresolved_result(request_identity)
    } else {
        rejected_result(request_identity)
    };
    let mut response = (status, Json(result)).into_response();
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

pub(crate) fn rejection_v2(status: StatusCode, code: &str, request_identity: &str) -> Response {
    // This boundary has no canonical R&D Owner receipt. Transport, authorization,
    // validation, and availability failures therefore cannot prove a no-write
    // terminal outcome or authorize a successor request.
    let result = unresolved_result_v2(request_identity);
    let mut response = (status, Json(result)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let actual: [u8; 32] = Sha256::digest(value.as_bytes()).into();
    actual
        .iter()
        .zip(expected_digest)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

pub(crate) async fn maybe_delay(allow_acceptance_faults: bool, headers: &HeaderMap) {
    if !allow_acceptance_faults {
        return;
    }
    let delay = headers
        .get("x-rd-acceptance-delay-after-commit-ms")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        .min(30_000);

    if delay > 0 {
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
}

pub(crate) fn product_edge_error(
    error: &ProductEdgeError,
    request_identity: &str,
    v2: bool,
) -> Response {
    let status = match error {
        ProductEdgeError::ConflictingReplay => StatusCode::CONFLICT,
        ProductEdgeError::InvalidProposal(_) => StatusCode::BAD_REQUEST,
        // These two collapse into one status, and this response carries no rejection code at
        // all - it answers with `unresolved_result`, which names the request and nothing else.
        // So the log is the only place the cause can survive, and until now it did not: the `_`
        // was the whole answer. A deployment bring-up spent a pass on a 503 from here with
        // nothing in the response or the log to say whether the authority or the store was the
        // one unavailable.
        ProductEdgeError::Unavailable(detail) => {
            tracing::warn!(%detail, %request_identity, "Product Edge authority unavailable");
            StatusCode::SERVICE_UNAVAILABLE
        }
        ProductEdgeError::Storage(detail) => {
            tracing::warn!(%detail, %request_identity, "Product Edge storage unavailable");
            StatusCode::SERVICE_UNAVAILABLE
        }
    };

    if v2 {
        (status, Json(unresolved_result_v2(request_identity))).into_response()
    } else {
        (status, Json(unresolved_result(request_identity))).into_response()
    }
}

pub(crate) fn artifact_product_edge_error(
    error: &ProductEdgeError,
    build_request_identity: &str,
    attempt_identity: &str,
) -> Response {
    let (status, code, result) = match error {
        ProductEdgeError::ConflictingReplay => (
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            ArtifactBuildResultV1::identity_conflict(build_request_identity, attempt_identity),
        ),
        ProductEdgeError::InvalidProposal(_) => (
            StatusCode::BAD_REQUEST,
            "PRODUCT_EDGE_REQUEST_REJECTED",
            ArtifactBuildResultV1::submitted_or_unknown(build_request_identity, attempt_identity),
        ),
        // `OWNER_OUTCOME_UNKNOWN` is what the caller is told, and it is accurate: the outcome
        // is unknown to them either way. Which of the two made it unknown is not, and that is
        // what the log now carries.
        ProductEdgeError::Unavailable(detail) => {
            tracing::warn!(%detail, %build_request_identity, "Product Edge authority unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_OUTCOME_UNKNOWN",
                ArtifactBuildResultV1::submitted_or_unknown(
                    build_request_identity,
                    attempt_identity,
                ),
            )
        }
        ProductEdgeError::Storage(detail) => {
            tracing::warn!(%detail, %build_request_identity, "Product Edge storage unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "OWNER_OUTCOME_UNKNOWN",
                ArtifactBuildResultV1::submitted_or_unknown(
                    build_request_identity,
                    attempt_identity,
                ),
            )
        }
    };
    let mut response = (status, Json(result)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

pub(crate) fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}
