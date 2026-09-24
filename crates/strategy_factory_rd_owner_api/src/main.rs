#![expect(
    clippy::large_futures,
    reason = "the read-only HTTP handlers retain complete typed Owner readbacks across preflight and resolve awaits"
)]

use std::{env, future::Future, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use vibe_binance::{
    common::enums::{BinanceEnvironment, BinanceProductType},
    futures::http::client::BinanceFuturesHttpClient,
    futures_pit_observation_source_v1::BinanceFuturesBarObservationSourceV1,
    pit_observation_source_v1::BinanceSpotBarObservationSourceV1,
    spot::http::client::BinanceSpotHttpClient,
};
use vibe_core::time::get_atomic_clock_realtime;
// `ReplayCompositionOwnerV1` is imported without the gate because `--materialize-schema` calls it
// in every build; the two locator types below it are only used by the acceptance surface.
use vibe_data::owner::replay_market_facts_v2::ReplayCompositionOwnerV1;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::replay_market_facts_v2::{
    ReplayCompositionBindingErrorV1, ReplayCompositionIssuanceLocatorV1,
    ReplayCompositionLocatorOnlyIssuanceRequestV1,
};
#[cfg(test)]
use vibe_data::owner::{
    ResearchPitTerminalBootstrapError, ResearchPitTerminalBootstrapFailure,
    research_pit_terminal_resolver_from_store_admission_lookup,
};
use vibe_data::owner::{
    instrument_master_admission_v1::{
        InstrumentMasterAdmissionV1, instrument_master_admission_from_environment_v1,
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
use vibe_databento::{
    common::Credential, historical::DatabentoHistoricalClient,
    pit_observation_source_v1::DatabentoBboObservationSourceV1,
};

/// The stable correlation every Market Data probe attempt repeats.
const MARKET_DATA_PROBE_CORRELATION_V1: [u8; 32] = *b"vibe.market-data.pit-probe.v1\0\0\0";
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::{
    instrument_economic_terms_postgres_owner_from_environment_v1,
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    instrument_master_v2_postgres_owner_from_environment,
    native_replay_scheduling_resolver_v1_from_store_admission_environment,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    shared_time_evidence_resolver_from_store_admission_environment_v1,
};
use vibe_data::owner::{
    research_pit_terminal::ResearchPitTerminalResolver,
    research_pit_terminal_resolver_from_store_admission_environment,
};
use vibe_product_edge::{
    ARTIFACT_BUILD_REQUIRED_EFFECTS_V1, ProductEdgeAdmissionLocatorV1,
    ProductEdgeAdmissionReadbackV1, ProductEdgeAdmissionRequestV1, ProductEdgeAuthorizationTrustV1,
    ProductEdgeError, ProductEdgeInvocationClaimReadbackV1, ProductEdgeInvocationClaimRequestV1,
    ProductEdgeInvocationStateV1, ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
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
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchDirectoryCursorV1,
        ResearchDirectoryOwnerPort, ResearchGoalOwnerError, ResearchGoalOwnerPortV2,
        ResearchReadbackOwnerPortV1, SourcedResearchGoalV2, TrialFamilyProposalV1,
        identity_conflict_result, identity_conflict_result_v2, rejected_result, unresolved_result,
        unresolved_result_v2,
    },
    product_edge_postgres::{PostgresResearchGoalOwnerV1, ResearchRequestIdentityPreflightV1},
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    rd_historical_custody::{HistoricalCustodyErrorV1, HistoricalCustodyOwnerPortV1},
    rd_historical_custody_postgres::PostgresHistoricalCustodyOwnerV1,
    trial_family::{TrialFamilyDirectResultV1, TrialFamilyError},
};

use vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerOperationDispositionV2;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerSealedReadPortV2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    not(feature = "sealed-source-intake-composer-acceptance")
))]
use vibe_strategy_factory::develop_composer_postgres_v2::SealedDevelopComposerAcceptanceReadPortV2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    any(test, not(feature = "sealed-source-intake-composer-acceptance"))
))]
use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2;
#[cfg(all(
    feature = "sealed-develop-composer-acceptance",
    not(feature = "sealed-source-intake-composer-acceptance")
))]
use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::develop_composer_sealed_acceptance_v2::submitted_or_unknown_response;
#[cfg(not(feature = "sealed-develop-composer-acceptance"))]
use vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_strategy_factory::source_research_composer_postgres_v2::{
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
struct SourceResearchComposerLocatorV2 {
    #[serde(deserialize_with = "deserialize_research_locator_v2")]
    research_request_locator: String,
}

#[cfg(any(
    not(feature = "sealed-develop-composer-acceptance"),
    feature = "sealed-source-intake-composer-acceptance"
))]
fn deserialize_research_locator_v2<'de, D>(deserializer: D) -> Result<String, D::Error>
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
struct SourceResearchComposerAcceptanceRunV2 {
    research_request_locator: String,
    control: SourceResearchComposerAcceptanceControlV2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceResearchComposerAcceptanceResolveV2 {
    tamper: SourceResearchComposerAcceptanceTamperV2,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopComposerA0ExecutionsV1 {
    schema_version: u16,
    a0_executions: u64,
}

use vibe_strategy_factory_rd_owner_api::required_env;

mod bounded_feature_program;
mod exploratory_replay;
mod iteration_analysis;
mod iteration_decision;
mod iteration_result_admission;
#[cfg(test)]
mod log_capture;
mod market_data_pit;
#[cfg(feature = "sealed-develop-composer-acceptance")]
mod market_data_repair;
mod source_intake;
mod source_intake_research;

#[derive(Clone)]
struct ApiState {
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    artifact_owner: Arc<dyn ArtifactBuildOwnerPort>,
    artifact_source_owner: Arc<dyn ArtifactSourceOwnerPort>,
    artifact_directory_owner: Arc<dyn ArtifactDirectoryOwnerPort>,
    research_directory_owner: Arc<dyn ResearchDirectoryOwnerPort>,
    research_readback_owner: Arc<dyn ResearchReadbackOwnerPortV1>,
    historical_custody_owner: Arc<dyn HistoricalCustodyOwnerPortV1>,
    token_digest: [u8; 32],
    request_proof_digest: String,
    allow_acceptance_faults: bool,
    _market_data_research_pit: Option<Arc<dyn ResearchPitTerminalResolver>>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    native_replay_scheduling: Option<Arc<dyn NativeReplaySchedulingResolverV1>>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    instrument_master_v2: Option<Arc<InstrumentMasterV2PostgresOwner>>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    instrument_economic_terms: Option<Arc<InstrumentEconomicTermsPostgresOwnerV1>>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    develop_composer_read: Option<Arc<dyn DevelopComposerSealedReadPortV2>>,
    #[cfg(all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    ))]
    develop_composer: Arc<SealedDevelopComposerAcceptanceV2>,
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    develop_composer: Arc<SealedPostgresSourceResearchComposerV2>,
    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    develop_composer: Arc<PostgresSourceResearchComposerProductionV2>,
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    replay_composition: Option<Arc<ReplayCompositionOwnerV1>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProductEdgeOperationRequestV2 {
    request_identity: String,
    channel: ProductEdgeChannel,
    goal: SourcedResearchGoalV2,
    trial_family_proposal: TrialFamilyProposalV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactFamilyResolveRequestV1 {
    artifact_identity: String,
    build_receipt_identity: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildOperationRequestV1 {
    build_request_identity: String,
    attempt_identity: String,
    intent_identity: String,
    channel: ProductEdgeChannel,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildCandidateOperationV1 {
    request: ArtifactBuildOperationRequestV1,
    candidate: ArtifactBuildCandidateV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildFailureOperationV1 {
    request: ArtifactBuildOperationRequestV1,
    failure_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildInvocationStartOperationV1 {
    build_request_identity: String,
    attempt_identity: String,
    research_request_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactDirectoryQueryV1 {
    limit: Option<u32>,
    after_prepared_at_epoch_ms: Option<u64>,
    after_build_request_identity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchDirectoryQueryV1 {
    limit: Option<u32>,
    after_committed_at_epoch_ms: Option<u64>,
    after_request_identity: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBuildInvocationStartApiResultV1 {
    invocation_start: vibe_product_edge::ProductEdgeInvocationStartReadbackV1,
    execution_custody: ArtifactBuildInvocationCustodyV1,
}

#[derive(Debug, Serialize)]
struct ArtifactBuildApiResultV1 {
    #[serde(flatten)]
    owner_result: ArtifactBuildResultV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_invocation: Option<ProductEdgeInvocationClaimReadbackV1>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
    let market_data_market_semantics_admission =
        bootstrap_market_data_market_semantics_admission().await?;
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let native_replay_scheduling =
        native_replay_scheduling_resolver_v1_from_store_admission_environment().await?;
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let shared_time = shared_time_evidence_resolver_from_store_admission_environment_v1().await?;
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let instrument_master_v2 =
        Arc::new(instrument_master_v2_postgres_owner_from_environment().await?);
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let instrument_economic_terms =
        Arc::new(instrument_economic_terms_postgres_owner_from_environment_v1().await?);
    let database_url = required_env("RD_OWNER_DATABASE_URL")?;
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
    #[cfg(feature = "sealed-develop-composer-acceptance")]
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
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    let develop_composer_read: Arc<dyn DevelopComposerSealedReadPortV2> = develop_composer.clone();
    #[cfg(feature = "sealed-develop-composer-acceptance")]
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
                )
                .await?,
            ))
        }
    };
    #[cfg(feature = "sealed-develop-composer-acceptance")]
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
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        native_replay_scheduling,
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        instrument_master_v2: Some(instrument_master_v2),
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        instrument_economic_terms: Some(instrument_economic_terms),
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        develop_composer_read: Some(develop_composer_read),
        #[cfg(feature = "sealed-develop-composer-acceptance")]
        develop_composer,
        #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
        develop_composer,
        #[cfg(feature = "sealed-develop-composer-acceptance")]
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
        .route("/v2/research-goals", post(submit_v2))
        .route(
            "/v2/research-goals/{request_identity}/resolve",
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
            "/v2/develop-composer/runs/{request_identity}/readback",
            get(read_develop_composer),
        )
        .route(
            "/v2/develop-composer/runs/{request_identity}/resolve",
            post(resolve_develop_composer),
        );
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let app = app.route(
        "/v2/exploratory-replay/execution-input-bindings",
        post(exploratory_replay::issue_execution_input_binding),
    );
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    let app = app
        .route(
            "/v3/exploratory-replay-requests/composer-backed",
            post(exploratory_replay::submit_composer_backed_v3),
        )
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
        .merge(bounded_feature_program::router(
            bounded_feature_program_owner,
            token_digest,
        ))
        .merge(iteration_result_admission::router(
            product_edge.clone(),
            owner.clone(),
            token_digest,
            request_proof_digest.clone(),
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
            market_data_pit_intake,
            market_data_source_binding_admission,
            market_data_universe_selection,
            market_data_strategy_input_bindings,
            market_data_instrument_master_admission,
            market_data_market_semantics_admission,
            token_digest,
        ));
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let app = app.merge(exploratory_replay::execution_router(
        native_replay_execution,
        token_digest,
    ));
    // The Market Data repair loop is a separate surface with its own admission; keeping its merge
    // in its own statement is what lets the Native Replay route lose its gate on its own.
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    let app = app.merge(market_data_repair);
    let address = env_or("RD_OWNER_LISTEN", "0.0.0.0:8080");
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(listen = %address, "R&D Owner API ready");
    axum::serve(listener, app).await?;
    Ok(())
}

fn schema_materialization_requested(arguments: &[String]) -> anyhow::Result<bool> {
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
async fn bootstrap_market_data_pit_intake()
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
fn databento_observation_source() -> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
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
fn binance_member_mapping(
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
/// The public kline endpoint is unsigned, so no credential is read here.
fn binance_perpetual_observation_source() -> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
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
        BinanceFuturesBarObservationSourceV1::new(client, mapping, &interval)
            .map_err(|e| anyhow::anyhow!("the Binance USD-M Data Client is unusable: {e}"))?,
    ))
}

fn binance_spot_observation_source() -> anyhow::Result<Arc<dyn PitObservationSourceV1>> {
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
async fn bootstrap_market_data_universe_selection()
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
async fn bootstrap_market_data_strategy_input_bindings()
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
async fn bootstrap_market_data_market_semantics_admission()
-> anyhow::Result<Option<Arc<dyn MarketSemanticsAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        market_semantics_admission_from_environment_v1().await?,
    ))
}

/// Composes the Market Data Instrument Master V1 admission when its store is configured.
async fn bootstrap_market_data_instrument_master_admission()
-> anyhow::Result<Option<Arc<dyn InstrumentMasterAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(
        instrument_master_admission_from_environment_v1().await?,
    ))
}

/// Composes the Market Data Source Binding admission when its store is configured.
async fn bootstrap_market_data_source_binding_admission()
-> anyhow::Result<Option<Arc<dyn SourceBindingAdmissionV1>>> {
    if env::var("MARKET_DATA_OWNER_DATABASE_URL").is_err() {
        return Ok(None);
    }
    Ok(Some(source_binding_admission_from_environment_v1().await?))
}

async fn bootstrap_deployment_store_admission()
-> anyhow::Result<Option<Arc<dyn ResearchPitTerminalResolver>>> {
    Ok(research_pit_terminal_resolver_from_store_admission_environment().await?)
}

#[cfg(test)]
async fn bootstrap_deployment_store_admission_from_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> anyhow::Result<Option<Arc<dyn ResearchPitTerminalResolver>>> {
    Ok(research_pit_terminal_resolver_from_store_admission_lookup(lookup).await?)
}

async fn health() -> &'static str {
    "ok"
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
async fn develop_composer_a0_executions(
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
async fn read_sealed_develop_composer_for_acceptance(
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
async fn run_develop_composer_with_acceptance_control(
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
async fn resolve_develop_composer_with_acceptance_tamper(
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
fn admit_sealed_acceptance_fault_control(enabled: bool) -> Result<(), StatusCode> {
    enabled.then_some(()).ok_or(StatusCode::NOT_FOUND)
}

async fn issue_replay_composition(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        let _ = body;
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    {
        let command: ReplayCompositionLocatorOnlyIssuanceRequestV1 =
            match serde_json::from_slice(&body) {
                Ok(command) => command,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            };
        let Some(replay_composition) = &state.replay_composition else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };

        match replay_composition.issue_binding_v1(&command).await {
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
}

async fn resolve_replay_composition(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return StatusCode::FORBIDDEN.into_response();
    }
    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        let _ = body;
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
    #[cfg(feature = "sealed-develop-composer-acceptance")]
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

async fn run_develop_composer(
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
                    maybe_delay(&state, &headers).await;
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
async fn project_develop_composer_request(
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
async fn project_develop_composer_request() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

async fn resolve_develop_composer(
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

    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
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

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
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

async fn read_develop_composer(
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

    #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
    {
        let _ = state;
        composer_response(
            StatusCode::SERVICE_UNAVAILABLE,
            default_unavailable_response(&request_identity),
        )
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
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

fn composer_operation_response(response: DevelopComposerOperationResponseV2) -> Response {
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

fn composer_response(status: StatusCode, response: DevelopComposerOperationResponseV2) -> Response {
    (status, Json(response)).into_response()
}

#[cfg(any(
    test,
    all(
        feature = "sealed-develop-composer-acceptance",
        not(feature = "sealed-source-intake-composer-acceptance")
    )
))]
fn develop_composer_body_injects_evidence(body: &[u8]) -> bool {
    body.iter().any(|byte| !byte.is_ascii_whitespace())
}

#[cfg(test)]
mod develop_composer_api_contract_tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn default_unavailable_contract_maps_to_service_unavailable_without_positive_projection() {
        let contract = default_unavailable_response("request-1");
        assert!(contract.receipt_identity.is_none());
        assert!(contract.artifact.is_none());
        assert_eq!(
            composer_response(StatusCode::SERVICE_UNAVAILABLE, contract).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[rstest]
    fn caller_evidence_body_is_detected_while_an_empty_command_is_not() {
        assert!(!develop_composer_body_injects_evidence(b" \n\t"));
        assert!(develop_composer_body_injects_evidence(
            br#"{"module_bytes":"caller-selected"}"#
        ));
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest]
    fn a2_run_dto_accepts_only_the_research_locator() {
        let parsed: SourceResearchComposerLocatorV2 =
            serde_json::from_slice(br#"{"research_request_locator":"research-1"}"#)
                .expect("locator-only DTO");
        assert_eq!(parsed.research_request_locator, "research-1");
        assert!(
            serde_json::from_slice::<SourceResearchComposerLocatorV2>(
                br#"{"research_request_locator":"research-1","design":{}}"#,
            )
            .is_err()
        );
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest]
    fn a2_locator_decode_enforces_the_transport_byte_bound_without_rewriting_identity() {
        for locator in [
            "research/request v2".to_owned(),
            "x".repeat(256),
            "\u{754c}".repeat(85),
        ] {
            let request = serde_json::json!({"research_request_locator": locator});
            let parsed: SourceResearchComposerLocatorV2 =
                serde_json::from_value(request).expect("bounded locator");
            assert_eq!(parsed.research_request_locator, locator);
        }

        for locator in [
            String::new(),
            " \t\n".to_owned(),
            "x".repeat(257),
            "\u{754c}".repeat(86),
        ] {
            assert!(
                serde_json::from_value::<SourceResearchComposerLocatorV2>(
                    serde_json::json!({"research_request_locator": locator})
                )
                .is_err()
            );
        }
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest]
    fn a2_execution_count_json_has_only_the_exact_contract_keys() {
        let value = serde_json::to_value(DevelopComposerA0ExecutionsV1 {
            schema_version: 1,
            a0_executions: 7,
        })
        .expect("A0 execution response");
        assert_eq!(
            value,
            serde_json::json!({"schema_version": 1, "a0_executions": 7})
        );
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest::rstest]
    fn acceptance_routes_accept_only_closed_control_selectors() {
        let request: SourceResearchComposerAcceptanceRunV2 = serde_json::from_slice(
            br#"{"research_request_locator":"research-1","control":{"kind":"FailAfter","selector":"AfterDesign"}}"#,
        )
        .expect("closed write boundary");
        assert!(matches!(
            request.control,
            SourceResearchComposerAcceptanceControlV2::FailAfter(
                vibe_strategy_factory::develop_composer_postgres_v2::DevelopComposerAcceptanceWriteBoundaryV2::AfterDesign
            )
        ));
        assert!(
            serde_json::from_slice::<SourceResearchComposerAcceptanceRunV2>(
                br#"{"research_request_locator":"research-1","control":{"kind":"FailAfter","selector":"AfterArbitrarySql"}}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_slice::<SourceResearchComposerAcceptanceResolveV2>(
                br#"{"tamper":"ArbitraryField"}"#,
            )
            .is_err()
        );
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    #[rstest::rstest]
    fn acceptance_fault_controls_require_the_explicit_runtime_gate() {
        assert_eq!(
            admit_sealed_acceptance_fault_control(false),
            Err(StatusCode::NOT_FOUND)
        );
        assert_eq!(admit_sealed_acceptance_fault_control(true), Ok(()));

        let source = include_str!("main.rs");

        for (handler, next_item) in [
            (
                "async fn read_sealed_develop_composer_for_acceptance",
                "async fn run_develop_composer_with_acceptance_control",
            ),
            (
                "async fn run_develop_composer_with_acceptance_control",
                "async fn resolve_develop_composer_with_acceptance_tamper",
            ),
            (
                "async fn resolve_develop_composer_with_acceptance_tamper",
                "fn admit_sealed_acceptance_fault_control",
            ),
        ] {
            let body = source
                .split(handler)
                .nth(1)
                .expect("acceptance handler")
                .split(next_item)
                .next()
                .expect("bounded acceptance handler");
            assert!(
                body.contains(
                    "admit_sealed_acceptance_fault_control(state.allow_acceptance_faults)"
                )
            );
        }
    }

    #[rstest]
    fn default_readback_contract_is_unavailable_without_positive_projection() {
        let contract = default_unavailable_response("request-1");
        assert_eq!(contract.request_identity, "request-1");
        assert_eq!(
            contract.disposition,
            vibe_strategy_factory::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Unavailable
        );
        assert!(contract.receipt_identity.is_none());
        assert!(contract.artifact.is_none());
        assert_eq!(
            composer_response(StatusCode::SERVICE_UNAVAILABLE, contract).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[rstest]
    fn public_success_contract_maps_to_ok() {
        let response = DevelopComposerOperationResponseV2 {
            schema_version: 2,
            request_identity: SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2.to_owned(),
            disposition: DevelopComposerOperationDispositionV2::Success,
            receipt_identity: None,
            artifact: None,
            coordinate: None,
            reason: None,
        };
        assert_eq!(
            composer_operation_response(response).status(),
            StatusCode::OK
        );
    }
}

async fn resolve(
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

async fn submit_v2(State(state): State<ApiState>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return rejection_v2(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            "unbound",
        );
    }
    let operation: ProductEdgeOperationRequestV2 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return rejection_v2(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "unbound",
            );
        }
    };
    let request_identity = operation.request_identity.clone();

    if let Some(refusal) = research_preflight_refusal(
        state
            .owner
            .preflight_request_identity(&request_identity)
            .await,
        &request_identity,
    ) {
        return refusal;
    }
    let admission = match admit_product_edge_request(
        &state,
        &operation,
        &request_identity,
        RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2,
        vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
    )
    .await
    {
        Ok(admission) => admission,
        Err(e) => return product_edge_error(&e, &request_identity, true),
    };
    let request = ProductEdgeResearchGoalRequestV2 {
        request_identity: operation.request_identity,
        channel: operation.channel,
        admission: admission.locator().clone(),
        goal: operation.goal,
        trial_family_proposal: operation.trial_family_proposal,
    };
    let request_identity = request.request_identity.clone();
    let response = match state.owner.submit_v2(request).await {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => owner_error_v2(&e, &request_identity),
    };
    maybe_delay(&state, &headers).await;
    response
}

async fn resolve_v2(
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

async fn resolve_family_by_intent(
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

async fn resolve_family_by_artifact(
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

fn direct_family_response(result: Result<TrialFamilyDirectResultV1, TrialFamilyError>) -> Response {
    match result {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => direct_family_error(&e),
    }
}

fn direct_family_error(error: &TrialFamilyError) -> Response {
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

async fn prepare_artifact_build(
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

async fn submit_artifact_candidate(
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
    maybe_delay(&state, &headers).await;
    response
}

async fn claim_provider_invocation(
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

async fn start_provider_invocation(
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

fn invocation_start_recovery_state(state: ProductEdgeInvocationStateV1) -> bool {
    matches!(
        state,
        ProductEdgeInvocationStateV1::Claimed | ProductEdgeInvocationStateV1::InvocationStarted
    )
}

async fn fail_artifact_build(
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

async fn resolve_artifact_build(
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

async fn read_artifact_source(
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

fn artifact_source_router() -> Router<ApiState> {
    Router::new().route(
        "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/source",
        get(read_artifact_source),
    )
}

async fn read_artifact_directory(
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

async fn read_research_directory(
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

async fn read_research_v2(
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
async fn read_research_v2_through(
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

async fn read_historical_custodies(State(state): State<ApiState>, headers: HeaderMap) -> Response {
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

fn valid_research_readback_identity(value: &str) -> bool {
    (1..=192).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
        })
}

fn valid_directory_identity(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

async fn artifact_result_response(
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

async fn artifact_request(
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

async fn admit_artifact_product_edge_request(
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

async fn preflight_then_admit_artifact_request<T, Admit, AdmitFuture>(
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

fn artifact_preparation_error(
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

fn artifact_error(
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

fn artifact_error_parts(
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

fn artifact_preparation_rejection(
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

fn artifact_rejection(
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

fn artifact_unknown(
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

fn insert_rejection_code(response: &mut Response, code: &str) {
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
}

/// Answers a replay composition refusal with the status its cause supports.
///
/// A variant leaves 503 only when every site that constructs it on the issuance and recovery paths
/// is the caller's request or a fact the store declared, never a store failure. Three qualify.
/// `InvalidRequest` is raised only by validation of the caller's command, including a locator that
/// contradicts the composition it was sent with. `IssuanceIdentityConflict` is raised only where the
/// Owner has established that the identity and the request disagree with an issuance it holds -
/// the identity stores a different request, or the request is stored under another identity -
/// which is the conflict this file already answers as `CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY`.
/// `PriceAdjustmentUnknown` is raised only when a Market Semantics fact declares its price
/// adjustment unknown, a statement about the data that takes the 422 this file gives a well-formed
/// request the Owner declines on semantics.
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
#[cfg(feature = "sealed-develop-composer-acceptance")]
fn replay_composition_refusal(error: ReplayCompositionBindingErrorV1) -> Response {
    let (status, code) = match error {
        ReplayCompositionBindingErrorV1::InvalidRequest => (StatusCode::BAD_REQUEST, None),
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict => (
            StatusCode::CONFLICT,
            Some("CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY"),
        ),
        ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown => {
            (StatusCode::UNPROCESSABLE_ENTITY, None)
        }
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

fn owner_error(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
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
fn research_preflight_refusal(
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

fn owner_error_v2(error: &ResearchGoalOwnerError, request_identity: &str) -> Response {
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

fn rejection(status: StatusCode, code: &str, request_identity: &str) -> Response {
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

fn rejection_v2(status: StatusCode, code: &str, request_identity: &str) -> Response {
    // This boundary has no canonical R&D Owner receipt. Transport, authorization,
    // validation, and availability failures therefore cannot prove a no-write
    // terminal outcome or authorize a successor request.
    let result = unresolved_result_v2(request_identity);
    let mut response = (status, Json(result)).into_response();
    insert_rejection_code(&mut response, code);
    response
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
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

async fn maybe_delay(state: &ApiState, headers: &HeaderMap) {
    if !state.allow_acceptance_faults {
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

async fn admit_product_edge_request<T: Serialize>(
    state: &ApiState,
    typed_payload: &T,
    request_identity: &str,
    operation: &str,
    operation_schema: &str,
    requested_effects: Vec<String>,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    state
        .product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_string(),
            typed_payload: serde_json::to_value(typed_payload)
                .map_err(|e| ProductEdgeError::Storage(e.to_string()))?,
            operation: operation.to_string(),
            operation_schema: operation_schema.to_string(),
            target_owner: RESEARCH_OWNER_V1.to_string(),
            requested_effects,
            request_proof_digest: state.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
}

fn product_edge_error(error: &ProductEdgeError, request_identity: &str, v2: bool) -> Response {
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

fn artifact_product_edge_error(
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

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

#[cfg(test)]
mod tests {
    /// Installs a subscriber so the servers this module spawns can be heard.
    ///
    /// The acceptance harness serves `dashboard_read_api` and the Owner API in-process with
    /// `tokio::spawn`, and a test does not run `main`, which held the crate's only subscriber. The
    /// read API's thirteen `tracing::warn!` sites were therefore formatted and dropped, including
    /// the one that names why a Formation Catalog read answered 503. A line that is written and a
    /// line that is emitted are two different histories, and the log a reader greps looks the same
    /// under both, so the absence of that line was read as the handler not having run.
    ///
    /// It shares the process's one subscriber with the chain's warning collector. Installed as a
    /// subscriber of its own, it took that slot first and left the collector nowhere to go, so the
    /// ordered chain reported this entry as not observed. Installed once per process; a process may
    /// host more than one test.
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    fn install_acceptance_tracing() {
        use tracing_subscriber::Layer as _;

        let heard = tracing_subscriber::fmt::layer()
            .with_test_writer()
            .with_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .boxed();
        vibe_testkit::postgres::collect_warnings_into_test_log_alongside(Some(heard))
            .expect("the acceptance subscriber and the warning collector should install");
    }

    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use async_trait::async_trait;
    use rstest::rstest;
    use sqlx::Row;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use vibe_operator_authorization::{
        OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
        OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
    };
    use vibe_product_edge::{AgentOperationManifestProposalV1, ProductEdgeBootstrapProposalV1};
    use vibe_product_edge::{
        ProductEdgeSubjectKindV1, ProductEdgeUnavailableReasonV1, ProductEdgeUnavailableV1,
    };
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    use vibe_product_edge::{
        SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
        SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
    };
    use vibe_rd_artifact_invocation_custody::{
        ArtifactInvocationReservationMeaningV1, seal_invocation_reservation,
    };
    #[cfg(feature = "sealed-source-intake-acceptance")]
    use vibe_strategy_factory::replay_policy_catalog_sealed_acceptance_v2::ensure_replay_policy_catalog_fixture_v3;
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    use vibe_strategy_factory::source_intake::{
        ProductEdgeGatewayV1, SealedSourceIntakeEnvironmentV1, SourceIntakeOperationRequestV1,
        SourceIntakeOwnerV1, SourceInterpretationV1,
    };
    use vibe_strategy_factory::{
        ExploratoryReplayResultLocatorV2,
        artifact_build::{ARTIFACT_BUILD_SCOPE_V1, ReservedArtifactBuildInvocationV1},
        product_edge::{RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1, ResearchSourceV1},
    };
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    use vibe_strategy_factory_rd_owner_api::dashboard_read_api::{
        self, DashboardReadApiConfigV1, SourceIntakeReadConfigV1,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use super::*;
    use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV2;

    #[rstest]
    fn composer_startup_uses_two_owner_urls_without_preissued_native_join() {
        let source = include_str!("main.rs");
        assert!(source.contains("MARKET_DATA_OWNER_DATABASE_URL"));
        assert!(source.contains("MARKET_DATA_RD_ROLE_SET_DATABASE_URL"));
        let removed_native_env = ["MARKET_DATA_COMPOSER", "_NATIVE_JOIN_LOCATORS_V1"].concat();
        let removed_native_issue = ["issue_composer", "_native_join_v1"].concat();
        let removed_native_connect = ["connect_with_writer", "_and_native_join"].concat();
        assert!(!source.contains(&removed_native_env));
        assert!(!source.contains(&removed_native_issue));
        assert!(!source.contains(&removed_native_connect));
        let forbidden_route = ["/v1/strategy-design-role-sets", "/resolve"].concat();
        assert!(!source.contains(&forbidden_route));
    }

    #[rstest]
    fn startup_mode_admits_only_default_serve_or_exact_schema_materialization() {
        assert!(!schema_materialization_requested(&[]).unwrap());
        assert!(schema_materialization_requested(&["--materialize-schema".to_owned()]).unwrap());
        assert!(schema_materialization_requested(&["--unknown".to_owned()]).is_err());
        assert!(
            schema_materialization_requested(&[
                "--materialize-schema".to_owned(),
                "--unknown".to_owned(),
            ])
            .is_err()
        );
        let materializer = include_str!("main.rs")
            .split("if schema_materialization_requested(&arguments)?")
            .nth(1)
            .expect("materialization mode")
            .split("return Ok(())")
            .next()
            .expect("materialization boundary");
        assert!(materializer.contains("PostgresDevelopComposerStoreV2::materialize_schema"));
    }

    #[rstest]
    fn research_readback_identity_accepts_only_bounded_route_safe_values() {
        assert!(valid_research_readback_identity(
            "research-request-v2/example:attempt_1.2"
        ));
        assert!(!valid_research_readback_identity(""));
        assert!(!valid_research_readback_identity("request identity"));
        assert!(!valid_research_readback_identity("request?identity"));
        assert!(!valid_research_readback_identity(&"x".repeat(193)));
    }

    #[tokio::test]
    async fn deployment_store_consumer_seam_preserves_default_and_fails_closed_when_required() {
        assert!(
            bootstrap_deployment_store_admission_from_lookup(|_| None)
                .await
                .is_ok()
        );

        let invalid_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
            (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(|| "positive".to_string())
        })
        .await
        .err()
        .expect("invalid mode must fail closed");
        assert!(
            invalid_mode
                .downcast_ref::<ResearchPitTerminalBootstrapError>()
                .is_some_and(|e| e.failure() == ResearchPitTerminalBootstrapFailure::InvalidMode)
        );
        let empty_mode = bootstrap_deployment_store_admission_from_lookup(|name| {
            (name == "DEPLOYMENT_STORE_ADMISSION_MODE").then(String::new)
        })
        .await
        .err()
        .expect("empty mode must fail closed");
        assert!(
            empty_mode
                .downcast_ref::<ResearchPitTerminalBootstrapError>()
                .is_some_and(|e| e.failure() == ResearchPitTerminalBootstrapFailure::InvalidMode)
        );

        let missing_head = bootstrap_deployment_store_admission_from_lookup(|name| match name {
            "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
            "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
            "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
            _ => None,
        })
        .await
        .err()
        .expect("missing head must fail closed");
        assert!(
            missing_head
                .downcast_ref::<ResearchPitTerminalBootstrapError>()
                .is_some_and(|e| {
                    e.failure() == ResearchPitTerminalBootstrapFailure::MissingRequiredIdentity
                })
        );

        let unavailable = bootstrap_deployment_store_admission_from_lookup(|name| match name {
            "DEPLOYMENT_STORE_ADMISSION_MODE" => Some("required".to_string()),
            "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY" => Some("test-environment".to_string()),
            "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY" => Some("rd-workbench-test".to_string()),
            "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY" => Some(format!("sha256:{}", "a".repeat(64))),
            _ => None,
        })
        .await
        .err()
        .expect("unavailable production admission must fail closed");
        assert!(
            unavailable
                .downcast_ref::<ResearchPitTerminalBootstrapError>()
                .is_some_and(|e| {
                    e.failure() == ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected
                })
        );
    }

    async fn assert_receiptless_artifact_unknown(response: Response) {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["owner_receipt"], serde_json::Value::Null);
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    #[tokio::test]
    async fn receiptless_artifact_failures_require_same_attempt_resolution() {
        for response in [
            artifact_error(
                &ArtifactBuildError::Candidate("provider failure code"),
                "build-1",
                "attempt-1",
            ),
            artifact_error(
                &ArtifactBuildError::Unauthorized("lineage"),
                "build-1",
                "attempt-1",
            ),
            artifact_rejection(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                "build-1",
                "attempt-1",
            ),
            artifact_product_edge_error(
                &ProductEdgeError::InvalidProposal("request admission"),
                "build-1",
                "attempt-1",
            ),
        ] {
            assert_receiptless_artifact_unknown(response).await;
        }

        assert_receiptless_artifact_unknown(artifact_preparation_rejection(
            StatusCode::FORBIDDEN,
            "AUTHORIZATION_LINEAGE_REJECTED",
            "build-1",
            "attempt-1",
        ))
        .await;
    }

    #[rstest]
    fn invocation_start_recovery_accepts_claimed_and_started_custody() {
        assert!(invocation_start_recovery_state(
            ProductEdgeInvocationStateV1::Claimed
        ));
        assert!(invocation_start_recovery_state(
            ProductEdgeInvocationStateV1::InvocationStarted
        ));
    }

    async fn bootstrap_api_test_product_edge(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
        suffix: &str,
        request_proof_digest: &str,
    ) -> ProductEdgePostgresOwnerV1 {
        bootstrap_api_test_product_edge_with(
            test_database,
            suffix,
            request_proof_digest,
            Vec::new(),
            Vec::new(),
        )
        .await
    }

    /// Bootstraps the Research and Artifact manifests plus any extra operation manifests and
    /// Operator Authorization permissions one acceptance needs beyond that pair.
    async fn bootstrap_api_test_product_edge_with(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
        suffix: &str,
        request_proof_digest: &str,
        extra_manifests: Vec<AgentOperationManifestProposalV1>,
        extra_permissions: Vec<String>,
    ) -> ProductEdgePostgresOwnerV1 {
        let now: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .try_into()
            .unwrap();
        let principal = format!("rd-api-retry-principal-{suffix}");
        let mut manifests = vec![
            AgentOperationManifestProposalV1 {
                operation: RESEARCH_GOAL_OPERATION_V2.to_string(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V2.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "c".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
            AgentOperationManifestProposalV1 {
                operation: ARTIFACT_BUILD_OPERATION_V1.to_string(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                allowed_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                capability_policy_digest: format!("sha256:{}", "d".repeat(64)),
                effective_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
            },
        ];
        manifests.extend(extra_manifests);
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let operation_manifests = manifests
            .iter()
            .map(|manifest| OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().unwrap(),
                manifest_digest: manifest.manifest_digest().unwrap(),
            })
            .collect();
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("rd-api-retry-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: RESEARCH_OWNER_V1.to_string(),
                    permissions: {
                        let mut permissions = vec![
                            ARTIFACT_BUILD_SCOPE_V1.to_string(),
                            RESEARCH_SCOPE_V1.to_string(),
                            RESEARCH_VIEW_SCOPE_V1.to_string(),
                        ];
                        permissions.extend(extra_permissions);
                        permissions.sort();
                        permissions.dedup();
                        permissions
                    },
                },
                request_proof_digest: request_proof_digest.to_string(),
                operation_manifests,
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let deployment_identity = format!("rd-api-retry-deployment-{suffix}");
        let product_edge = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: RESEARCH_OWNER_V1.to_string(),
            },
        )
        .await
        .unwrap();
        product_edge
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity,
                binding_identity: format!("rd-api-retry-binding-{suffix}"),
                expected_history_head: "EMPTY".to_string(),
                generation: 1,
                effective_principal: principal,
                scope_policy_version: "research-scope-v1".to_string(),
                capability_policy_version: "capability-v1".to_string(),
                audit_policy_version: "audit-v1".to_string(),
                valid_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                authorization: authorization.locator(),
                manifests: vibe_product_edge::AgentOperationManifestSetV1::new(manifests).unwrap(),
            })
            .await
            .unwrap();
        product_edge
    }

    /// Every R&D and Product Edge relation the Dashboard browser acceptance may touch. The
    /// acceptance compares this snapshot before and after the browser journey, so a read that
    /// leaked a write into any of them fails the proof.
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    async fn dashboard_owner_readback_acceptance_snapshot(
        rd_owner_pool: &sqlx::PgPool,
        product_edge_pool: &sqlx::PgPool,
    ) -> serde_json::Value {
        const RD_RELATIONS: [(&str, &str); 7] = [
            ("rd_artifact_build_attempts_v1", "build_request_identity"),
            ("rd_strategy_artifacts_v1", "attempt_identity"),
            ("rd_owner_outbox_v1", "event_identity"),
            ("rd_research_request_receipts_v1", "request_identity"),
            ("rd_source_intake_bindings_v1", "request_identity"),
            ("rd_source_intake_receipts_v1", "receipt_identity"),
            (
                "rd_sealed_exploratory_replay_requests_v1",
                "request_identity",
            ),
        ];
        const PRODUCT_EDGE_RELATIONS: [(&str, &str); 2] = [
            ("product_edge_request_admissions_v1", "request_identity"),
            ("product_edge_owner_outbox_v1", "event_identity"),
        ];
        let mut snapshot = serde_json::Map::new();

        for (pool, relations) in [
            (rd_owner_pool, RD_RELATIONS.as_slice()),
            (product_edge_pool, PRODUCT_EDGE_RELATIONS.as_slice()),
        ] {
            for (relation, order) in relations {
                let rows: Vec<serde_json::Value> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT to_jsonb(row_value) FROM (SELECT * FROM public.{relation} ORDER BY {order}) row_value"
                )))
                .fetch_all(pool)
                .await
                .unwrap_or_else(|e| panic!("snapshot of {relation} must read: {e}"));
                snapshot.insert((*relation).to_owned(), serde_json::Value::Array(rows));
            }
        }
        serde_json::Value::Object(snapshot)
    }

    /// Serves every admitted Dashboard Owner read to a real browser from real Owner custody.
    ///
    /// The custody is committed through the write API handlers exactly as an operator would
    /// commit it; the browser then reads it through the production
    /// `strategy-factory-rd-dashboard-read-api` router plus the write API's historical custody
    /// route, which is the deployed topology. The chain entries before this one must already
    /// have sealed one Replay V2 request, because that custody cannot be created from this crate.
    #[cfg(all(
        feature = "sealed-artifact-source-browser-acceptance",
        feature = "sealed-source-intake-acceptance"
    ))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires explicit local PostgreSQL, Dashboard dependencies, and Chrome acceptance admission"]
    async fn strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody() {
        if env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE").as_deref() != Ok("1") {
            return;
        }

        install_acceptance_tracing();

        // Reported rather than assumed: this harness pins `worker_threads = 2`, and whether that
        // is a constraint or a restatement of the default depends on a number nobody here has
        // measured. Two sessions have carried "the runner has 2 vCPUs" as fact with no measurement
        // behind it, while `owner-chains.yml` says 4 for a public repository. This is the figure
        // tokio actually defaults to, read in the process that would use it.
        tracing::info!(
            available_parallelism = ?std::thread::available_parallelism(),
            pinned_worker_threads = 2,
            "acceptance harness runtime width"
        );

        let browser_executable = env::var("DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE")
            .expect("explicit browser executable is required");
        let acceptance_candidate = env::var("DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE")
            .expect("exact committed Dashboard candidate is required");
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        {
            let catalog_admin_pool = sqlx::PgPool::connect(
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
            )
            .await
            .unwrap();
            ensure_replay_policy_catalog_fixture_v3(&catalog_admin_pool)
                .await
                .unwrap();
        }

        let token = "rd-owner-strategy-source-browser-acceptance";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let manifest_now: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .try_into()
            .unwrap();
        let product_edge = Arc::new(
            bootstrap_api_test_product_edge_with(
                &test_database,
                &format!("strategy-source-{suffix}"),
                &request_proof_digest,
                vec![AgentOperationManifestProposalV1 {
                    operation: SOURCE_INTAKE_OPERATION_V1.to_string(),
                    operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.to_string(),
                    target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.to_string(),
                    allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                        .into_iter()
                        .map(ToString::to_string)
                        .collect(),
                    prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
                    capability_policy_digest: format!("sha256:{}", "e".repeat(64)),
                    // A manifest has to cover the binding that names it, and the binding's window
                    // is cut from a clock this function reads later. Deriving both from a reading
                    // taken here would leave the binding ending one millisecond past the manifest
                    // whenever anything at all happened in between, which is a coin flip on how
                    // fast the machine is rather than a property of the Owner. This window
                    // brackets the bootstrap's own.
                    effective_from_epoch_ms: manifest_now.saturating_sub(60_000),
                    valid_through_epoch_ms: manifest_now.saturating_add(7_200_000),
                }],
                vec!["research:source-intake".to_string()],
            )
            .await,
        );
        let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let owner = PostgresResearchGoalOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .unwrap();
        #[cfg(feature = "sealed-source-intake-acceptance")]
        let owner = owner.bind_sealed_source_intake_research_policy();
        let owner = Arc::new(owner);
        let artifact_owner = Arc::new(
            PostgresArtifactBuildOwnerV1::connect_with_sealed_artifact_source_acceptance(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                u64::MAX,
            )
            .await
            .unwrap(),
        );
        let historical_custody_owner = Arc::new(
            PostgresHistoricalCustodyOwnerV1::connect_read_only(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            )
            .await
            .unwrap(),
        );
        let state = ApiState {
            product_edge,
            owner: owner.clone(),
            artifact_owner: artifact_owner.clone(),
            artifact_source_owner: artifact_owner.clone(),
            artifact_directory_owner: artifact_owner,
            research_directory_owner: owner.clone(),
            research_readback_owner: owner,
            historical_custody_owner,
            token_digest,
            request_proof_digest,
            allow_acceptance_faults: false,
            _market_data_research_pit: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            native_replay_scheduling: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            instrument_master_v2: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            instrument_economic_terms: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            develop_composer_read: None,
            #[cfg(all(
                feature = "sealed-develop-composer-acceptance",
                not(feature = "sealed-source-intake-composer-acceptance")
            ))]
            develop_composer: Arc::new(
                SealedDevelopComposerAcceptanceV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(feature = "sealed-source-intake-composer-acceptance")]
            develop_composer: Arc::new(
                SealedPostgresSourceResearchComposerV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
            develop_composer: Arc::new(
                PostgresSourceResearchComposerProductionV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            replay_composition: None,
        };
        let headers = bearer_headers(token);
        let research = ProductEdgeOperationRequestV2 {
            request_identity: format!("strategy-source-research-{suffix}"),
            channel: ProductEdgeChannel::WindmillProductEdge,
            goal: SourcedResearchGoalV2 {
                hypothesis: "A bounded momentum effect persists after exact costs.".to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question: "Does the effect disappear after modeled costs?"
                    .to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact acceptance cost model.".to_string(),
                capacity_assumption: "Exact acceptance capacity model.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/strategy-source-acceptance".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-09-08T00:00:00Z".to_string(),
                    source_cut: "strategy-source-acceptance-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded strategy source browser acceptance fixture."
                        .to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 2,
                stop_rule: "Stop on falsifier or unavailable PIT input.".to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "Fresh isolated strategy source family.".to_string(),
            },
        };
        let research_response = Box::pin(submit_v2(
            State(state.clone()),
            headers.clone(),
            Bytes::from(serde_json::to_vec(&research).unwrap()),
        ))
        .await;
        assert_eq!(research_response.status(), StatusCode::OK);
        let research_json = response_json(research_response).await;
        let readback_response = read_research_v2(
            State(state.clone()),
            Path(research.request_identity.clone()),
            headers.clone(),
        )
        .await;
        assert_eq!(readback_response.status(), StatusCode::OK);
        assert_eq!(
            response_json(readback_response).await["request_identity"],
            research.request_identity
        );
        let intent_identity = research_json["owner_receipt"]["resulting_research_intent_identity"]
            .as_str()
            .unwrap_or_else(|| panic!("research custody unavailable: {research_json}"))
            .to_string();
        let build_request_identity = format!("strategy-source-build-{suffix}");
        let attempt_identity = format!("strategy-source-attempt-{suffix}");
        let build = serde_json::json!({
            "build_request_identity": build_request_identity,
            "attempt_identity": attempt_identity,
            "intent_identity": intent_identity,
            "channel": "WINDMILL_PRODUCT_EDGE",
        });
        let prepared = prepare_artifact_build(
            State(state.clone()),
            headers.clone(),
            Bytes::from(serde_json::to_vec(&build).unwrap()),
        )
        .await;
        assert_eq!(prepared.status(), StatusCode::OK);
        let prepared_json = response_json(prepared).await;
        assert_eq!(prepared_json["resolution"], "PREPARED");
        let intent_semantic_digest = prepared_json["intent_semantic_digest"]
            .as_str()
            .unwrap()
            .to_string();
        let candidate = serde_json::json!({
            "request": build,
            "candidate": {
                "schema_version": 1,
                "candidate_identity": format!("agent-program-candidate-v1-strategy-source-{suffix}"),
                "intent_identity": intent_identity,
                "intent_semantic_digest": intent_semantic_digest,
                "logic": {
                    "signal": "MOMENTUM",
                    "direction": "LONG_ONLY",
                    "lookback_bars": 24,
                    "entry_threshold_bps": 50,
                    "exit_threshold_bps": 10
                },
                "structured_logic_summary": "Bounded momentum source viewer acceptance.",
                "agent_change_explanation": "Produces canonical read-only source custody without provider execution."
            }
        });
        let submitted = submit_artifact_candidate(
            State(state.clone()),
            headers.clone(),
            Bytes::from(serde_json::to_vec(&candidate).unwrap()),
        )
        .await;
        assert_eq!(submitted.status(), StatusCode::OK);
        let submitted_json = response_json(submitted).await;
        assert_eq!(submitted_json["resolution"], "SUCCESS");
        assert!(submitted_json["provider_invocation"].is_null());

        // Source Intake custody through the sealed acceptance environment: the same Owner
        // workflow the production router runs, with the provider fixed instead of live.
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let source_intake_request_identity = format!("strategy-source-intake-{suffix}");
        let source_intake_owner = Arc::new(SourceIntakeOwnerV1::sealed_acceptance(
            SealedSourceIntakeEnvironmentV1::new(
                state.product_edge.clone(),
                rd_owner_pool.clone(),
                state.request_proof_digest.clone(),
            )
            .unwrap(),
        ));
        let source_intake_terminal = source_intake_owner
            .run(SourceIntakeOperationRequestV1 {
                request_identity: source_intake_request_identity.clone(),
                channel: ProductEdgeGatewayV1::WindmillProductEdge,
                normalized_doi: "10.5555/sealed-success".to_string(),
                interpretation: SourceInterpretationV1 {
                    bounded_explanation:
                        "A bounded momentum effect persists after exact costs in the sealed corpus."
                            .to_string(),
                    plausible_alternatives: vec![
                        "Cost model error".to_string(),
                        "Survivorship bias".to_string(),
                    ],
                    differentiating_prediction:
                        "Net continuation stays positive after the modeled costs.".to_string(),
                    falsifier: "Continuation vanishes once exact costs are applied.".to_string(),
                },
            })
            .await
            .unwrap()
            .expect("sealed Source Intake must reach a terminal");
        let source_intake_terminal = serde_json::to_value(&source_intake_terminal).unwrap();
        assert_eq!(source_intake_terminal["terminal"], "RETRIEVED");
        let source_intake_content_digest = source_intake_terminal["content_digest"]
            .as_str()
            .unwrap_or_else(|| {
                panic!(
                    "retrieved Source Intake must carry a content digest: {source_intake_terminal}"
                )
            })
            .to_string();

        // One pre-V2 rejection selector. Nothing in the repository materializes the legacy
        // `rd_exploratory_replay_rejections_v1` relation and the chain revokes CREATE on the
        // public schema, so the quarantine read is proven on its fail-closed path: the Owner port
        // reports the relation unavailable and the browser renders exactly that.
        let rejection_request_identity = format!("strategy-source-rejected-replay-{suffix}");
        let rejection_attempt_identity = format!("strategy-source-rejected-attempt-{suffix}");
        let rejection_semantic_digest = format!(
            "sha256:{}",
            hex_digest(&Sha256::digest(rejection_request_identity.as_bytes()))
        );

        // The sealed Replay V2 request the preceding chain entries committed. Its selector is
        // handed to the browser exactly as an operator would paste it.
        let replay_row = sqlx::query(
            "SELECT request_identity, v2_meaning_digest FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE v2_meaning_digest IS NOT NULL ORDER BY committed_at_epoch_ms DESC, request_identity DESC LIMIT 1",
        )
        .fetch_one(rd_owner_pool)
        .await
        .expect("a sealed Replay V2 request committed by the preceding chain entries must precede the Dashboard browser consumer");
        let replay_request_identity: String = replay_row.try_get("request_identity").unwrap();
        let replay_meaning_digest: String = replay_row.try_get("v2_meaning_digest").unwrap();

        let claim_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_effect_invocation_claims_v1 WHERE attempt_identity=$1",
        )
        .bind(&attempt_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(claim_count, 0);
        let before =
            dashboard_owner_readback_acceptance_snapshot(rd_owner_pool, product_edge_pool).await;

        let source_response = read_artifact_source(
            State(state.clone()),
            Path((build_request_identity.clone(), attempt_identity.clone())),
            headers,
        )
        .await;
        assert_eq!(source_response.status(), StatusCode::OK);
        let source = response_json(source_response).await;
        let artifact_identity = source["artifact_identity"].as_str().unwrap().to_string();
        let source_digest = source["source_digest"].as_str().unwrap().to_string();
        assert_eq!(source["wasm_preview_status"], "NOT_RUN");

        // The production Dashboard read API, composed exactly as its binary composes it, with a
        // credential of its own so the browser proves it never borrows the write credential.
        let read_token = "rd-dashboard-read-browser-acceptance";
        let mut read_state = dashboard_read_api::compose_state(&DashboardReadApiConfigV1 {
            owner_database_url: test_database
                .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                .to_string(),
            token: read_token.to_string(),
            source_intake: Some(SourceIntakeReadConfigV1 {
                product_edge_database_url: test_database
                    .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
                    .to_string(),
                request_proof: token.to_string(),
            }),
            bind: String::new(),
        })
        .await
        .unwrap();
        assert!(
            read_state.source_intake_readback.is_some(),
            "Source Intake readback must bind to the disposable topology"
        );
        // Sealed Source Intake custody carries the sealed authority class, which the production
        // readback port refuses by design because it binds live external authority. The sealed
        // Owner reads its own custody back exactly as the sealed write API router does; every
        // other port keeps the production composition bound above.
        read_state.source_intake_readback = Some(source_intake_owner.clone());
        let read_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let read_address = read_listener.local_addr().unwrap();
        let read_server = tokio::spawn(async move {
            axum::serve(read_listener, dashboard_read_api::router(read_state)).await
        });
        let owner_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let owner_address = owner_listener.local_addr().unwrap();

        let owner_server = tokio::spawn(async move {
            axum::serve(
                owner_listener,
                // Historical custody used to be bolted on here, because the read API had no such
                // route and the write API did. An acceptance that has to reproduce the write API's
                // shape to pass is not proving the production path; the read API serves it now.
                artifact_source_router().with_state(state),
            )
            .await
        });
        let preview_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let preview_port = preview_listener.local_addr().unwrap().port();
        drop(preview_listener);
        let dashboard_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../product/dashboard");
        // The browser run takes minutes, and this runtime has two worker threads with both API
        // servers spawned onto it. Waiting on the child with `Command::status` blocks the worker
        // this future sits on for the whole run, leaving one worker to serve every request the
        // page makes - on a runner already sharing two vCPUs with the Rust test process, node,
        // the Next server, Chrome and PostgreSQL. `spawn_blocking` moves the wait off the worker
        // pool, so both servers keep both workers.
        let mut browser = std::process::Command::new("node");
        browser
            .arg("--test")
            .arg("tests/dashboard-owner-readback.browser.test.mjs")
            .current_dir(&dashboard_root)
            .env("DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE", "1")
            // The Dashboard declares an eight second budget for an Owner read, and that is a
            // production promise about eleven operations. It is not a claim this harness can keep:
            // one runner runs Chrome, the Next server, this crate's two HTTP servers, PostgreSQL
            // and the Rust test process on two vCPUs, and the budget is an `AbortSignal.timeout`,
            // so it measures the client process's wall clock rather than the Owner's latency.
            //
            // The value is the harness's own `attemptTimeoutMs`, not a new number: the browser step
            // already gives an attempt twenty-five seconds, so a read that cannot finish inside the
            // attempt is the attempt's failure to report, and two nested budgets that disagree only
            // decide which one reports it. This says the acceptance measures the attempt, and says
            // nothing about how long an Owner read takes.
            .env("DASHBOARD_OWNER_READ_TIMEOUT_OVERRIDE_MS", "25000")
            .env(
                "DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE",
                acceptance_candidate,
            )
            .env(
                "DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE",
                browser_executable,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_PREVIEW_PORT",
                preview_port.to_string(),
            )
            .env(
                "DASHBOARD_OWNER_READBACK_RESEARCH_REQUEST_IDENTITY",
                &research.request_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_RESEARCH_HYPOTHESIS",
                &research.goal.hypothesis,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_BUILD_REQUEST_IDENTITY",
                &build_request_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_ATTEMPT_IDENTITY",
                &attempt_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_UNKNOWN_BUILD_REQUEST_IDENTITY",
                format!("strategy-source-unknown-build-{suffix}"),
            )
            .env(
                "DASHBOARD_OWNER_READBACK_MISMATCH_ATTEMPT_IDENTITY",
                format!("strategy-source-mismatch-{suffix}"),
            )
            .env(
                "DASHBOARD_OWNER_READBACK_ARTIFACT_IDENTITY",
                artifact_identity,
            )
            .env("DASHBOARD_OWNER_READBACK_SOURCE_DIGEST", source_digest)
            .env(
                "DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_REQUEST_IDENTITY",
                &source_intake_request_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_CONTENT_DIGEST",
                source_intake_content_digest,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_REPLAY_REQUEST_IDENTITY",
                replay_request_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_REPLAY_MEANING_DIGEST",
                replay_meaning_digest,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_REJECTION_REQUEST_IDENTITY",
                &rejection_request_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_REJECTION_ATTEMPT_IDENTITY",
                &rejection_attempt_identity,
            )
            .env(
                "DASHBOARD_OWNER_READBACK_REJECTION_SEMANTIC_DIGEST",
                &rejection_semantic_digest,
            )
            .env(
                "RD_DASHBOARD_OWNER_READ_API_URL",
                format!("http://{read_address}/"),
            )
            .env("RD_DASHBOARD_OWNER_READ_API_TOKEN", read_token)
            .env("RD_OWNER_API_URL", format!("http://{owner_address}/"))
            .env("RD_OWNER_API_TOKEN", token);
        let browser_status = tokio::task::spawn_blocking(move || browser.status())
            .await
            .expect("the browser acceptance wait joins")
            .unwrap();
        read_server.abort();
        let _ = read_server.await;
        owner_server.abort();
        let _ = owner_server.await;

        let after =
            dashboard_owner_readback_acceptance_snapshot(rd_owner_pool, product_edge_pool).await;
        assert!(browser_status.success());
        assert_eq!(after, before);
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE/R&D/Qualification PostgreSQL topology"]
    async fn same_identity_started_retry_returns_http_ok_with_exact_custody_once() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        #[cfg(feature = "sealed-source-intake-acceptance")]
        {
            let catalog_admin_pool = sqlx::PgPool::connect(
                test_database
                    .database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
            )
            .await
            .unwrap();
            ensure_replay_policy_catalog_fixture_v3(&catalog_admin_pool)
                .await
                .unwrap();
        }
        let token = "rd-owner-api-start-retry-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let request_proof_digest = format!("sha256:{}", hex_digest(&token_digest));
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let product_edge = Arc::new(
            bootstrap_api_test_product_edge(
                &test_database,
                &suffix.to_string(),
                &request_proof_digest,
            )
            .await,
        );
        let product_edge_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let owner = Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .unwrap(),
        );
        let artifact_owner = Arc::new(
            PostgresArtifactBuildOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                "/tmp/unused-rd-sandbox.sock",
                u64::MAX,
            )
            .await
            .unwrap(),
        );
        let historical_custody_owner = Arc::new(
            PostgresHistoricalCustodyOwnerV1::connect_read_only(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            )
            .await
            .unwrap(),
        );
        let state = ApiState {
            product_edge,
            owner: owner.clone(),
            artifact_owner: artifact_owner.clone(),
            artifact_source_owner: artifact_owner.clone(),
            artifact_directory_owner: artifact_owner,
            research_directory_owner: owner.clone(),
            research_readback_owner: owner.clone(),
            historical_custody_owner,
            token_digest,
            request_proof_digest,
            allow_acceptance_faults: false,
            _market_data_research_pit: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            native_replay_scheduling: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            instrument_master_v2: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            instrument_economic_terms: None,
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            develop_composer_read: None,
            #[cfg(all(
                feature = "sealed-develop-composer-acceptance",
                not(feature = "sealed-source-intake-composer-acceptance")
            ))]
            develop_composer: Arc::new(
                SealedDevelopComposerAcceptanceV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(feature = "sealed-source-intake-composer-acceptance")]
            develop_composer: Arc::new(
                SealedPostgresSourceResearchComposerV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(not(feature = "sealed-develop-composer-acceptance"))]
            develop_composer: Arc::new(
                PostgresSourceResearchComposerProductionV2::connect(
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                    test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
                )
                .await
                .unwrap(),
            ),
            #[cfg(feature = "sealed-develop-composer-acceptance")]
            replay_composition: None,
        };
        let headers = bearer_headers(token);
        let research_request_identity = format!("rd-api-retry-research-{suffix}");
        let research = ProductEdgeOperationRequestV2 {
            request_identity: research_request_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            goal: SourcedResearchGoalV2 {
                hypothesis: "A bounded point-in-time continuation effect remains after costs."
                    .to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question: "Does the effect disappear after exact modeled costs?"
                    .to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact test cost model identity.".to_string(),
                capacity_assumption: "Exact test capacity model identity.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/rd-api-retry".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-23T00:00:00Z".to_string(),
                    source_cut: "rd-api-retry-source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded API retry fixture only.".to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 2,
                stop_rule: "Stop on falsifier or unavailable PIT input.".to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "Fresh isolated API retry family.".to_string(),
            },
        };
        let research_response = Box::pin(submit_v2(
            State(state.clone()),
            headers.clone(),
            Bytes::from(serde_json::to_vec(&research).unwrap()),
        ))
        .await;
        assert_eq!(research_response.status(), StatusCode::OK);
        let research_json = response_json(research_response).await;
        let intent_identity = research_json["owner_receipt"]["resulting_research_intent_identity"]
            .as_str()
            .unwrap_or_else(|| {
                panic!("research API did not return accepted custody: {research_json}")
            })
            .to_string();

        let peeked_research: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT rd_owner_api.peek_current_research_for_artifact_v1($1)")
                .bind(&intent_identity)
                .fetch_one(product_edge_pool)
                .await
                .unwrap_or_else(|e| panic!("artifact research peek failed: {e:?}"));
        assert!(
            peeked_research.is_some(),
            "artifact research peek returned unavailable"
        );

        let build_request_identity = format!("rd-api-retry-build-{suffix}");
        let attempt_identity = format!("rd-api-retry-attempt-{suffix}");
        let build = ArtifactBuildOperationRequestV1 {
            build_request_identity: build_request_identity.clone(),
            attempt_identity: attempt_identity.clone(),
            intent_identity,
            channel: ProductEdgeChannel::WindmillProductEdge,
        };
        let build_body = Bytes::from(serde_json::to_vec(&build).unwrap());
        let prepared =
            prepare_artifact_build(State(state.clone()), headers.clone(), build_body.clone()).await;
        let prepared_status = prepared.status();
        let prepared_rejection_code = prepared
            .headers()
            .get("x-rd-rejection-code")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("none")
            .to_string();
        let prepared_json = response_json(prepared).await;
        assert_eq!(
            prepared_status,
            StatusCode::OK,
            "artifact preparation failed: rejection_code={prepared_rejection_code}, body={prepared_json}"
        );

        let custody_response =
            read_historical_custodies(State(state.clone()), headers.clone()).await;
        assert_eq!(custody_response.status(), StatusCode::OK);
        let custody_json = response_json(custody_response).await;
        assert_eq!(
            custody_json["operation"],
            "rd.historical_custody_quarantine.read.v1"
        );
        let research_candidates = custody_json["research"].as_array().unwrap();
        let research_candidate = research_candidates
            .iter()
            .find(|candidate| {
                candidate["request_identity"].as_str() == Some(research_request_identity.as_str())
            })
            .unwrap_or_else(|| {
                panic!("canonical Research custody candidate missing: {custody_json}")
            });
        assert_eq!(
            research_candidate["projection_state"],
            "POINT_READ_REQUIRED"
        );
        assert!(research_candidate.get("resolution").is_none());
        assert!(research_candidate.get("disposition").is_none());
        let attempt_candidates = custody_json["artifact_attempts"].as_array().unwrap();
        let attempt_candidate = attempt_candidates
            .iter()
            .find(|candidate| {
                candidate["build_request_identity"].as_str()
                    == Some(build_request_identity.as_str())
                    && candidate["attempt_identity"].as_str() == Some(attempt_identity.as_str())
            })
            .unwrap_or_else(|| {
                panic!("canonical Artifact custody candidate missing: {custody_json}")
            });
        assert_eq!(attempt_candidate["projection_state"], "POINT_READ_REQUIRED");
        assert!(attempt_candidate.get("resolution").is_none());
        assert!(attempt_candidate.get("disposition").is_none());

        let claimed =
            claim_provider_invocation(State(state.clone()), headers.clone(), build_body).await;
        assert_eq!(claimed.status(), StatusCode::OK);
        let claimed_json = response_json(claimed).await;
        let claim_identity = claimed_json["claim_identity"].as_str().unwrap().to_string();

        let product_edge_state_before_foreign_start: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let foreign_start_body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "build_request_identity": build_request_identity,
                "attempt_identity": attempt_identity,
                "research_request_identity": "foreign-research-request",
            }))
            .unwrap(),
        );
        let foreign_start =
            start_provider_invocation(State(state.clone()), headers.clone(), foreign_start_body)
                .await;
        assert_eq!(foreign_start.status(), StatusCode::CONFLICT);
        assert_eq!(
            foreign_start.headers().get("x-rd-rejection-code").unwrap(),
            "RESEARCH_REQUEST_IDENTITY_CONFLICT"
        );
        let product_edge_state_after_foreign_start: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let foreign_started_events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_foreign_start,
            product_edge_state_before_foreign_start
        );
        assert_eq!(foreign_started_events, 0);

        let start_body = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "build_request_identity": build_request_identity,
                "attempt_identity": attempt_identity,
                "research_request_identity": research_request_identity,
            }))
            .unwrap(),
        );
        let started =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(started.status(), StatusCode::OK);
        let started_json = response_json(started).await;
        assert_eq!(
            started_json["invocation_start"]["disposition"],
            "STARTED_NEW"
        );
        assert_exact_start_custody(&started_json, &build_request_identity, &attempt_identity);
        assert_eq!(
            started_json["execution_custody"]["claim_identity"],
            claim_identity
        );
        let started_events_after_first: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_first, 1);
        let rd_attempt_after_first: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();

        let retried =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(retried.status(), StatusCode::OK);
        let retried_json = response_json(retried).await;
        assert_eq!(
            retried_json["invocation_start"]["disposition"],
            "OUTCOME_UNKNOWN"
        );
        assert_exact_start_custody(&retried_json, &build_request_identity, &attempt_identity);
        assert_eq!(
            retried_json["execution_custody"],
            started_json["execution_custody"]
        );
        let started_events_after_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' AND aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        assert_eq!(started_events_after_retry, started_events_after_first);
        let rd_attempt_after_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();
        assert_eq!(rd_attempt_after_retry, rd_attempt_after_first);

        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let mut missing_snapshot_attempt = rd_attempt_after_retry.clone();
        missing_snapshot_attempt
            .as_object_mut()
            .unwrap()
            .remove("invocation_custody");
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&missing_snapshot_attempt)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();
        let product_edge_state_before_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_before_missing_snapshot: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let missing_snapshot_rejected =
            start_provider_invocation(State(state.clone()), headers.clone(), start_body.clone())
                .await;
        assert_eq!(
            missing_snapshot_rejected.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            missing_snapshot_rejected
                .headers()
                .get("x-rd-rejection-code")
                .unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let product_edge_state_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_after_missing_snapshot: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let rd_attempt_after_missing_snapshot: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_owner_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_missing_snapshot,
            product_edge_state_before_missing_snapshot
        );
        assert_eq!(
            product_edge_outbox_after_missing_snapshot,
            product_edge_outbox_before_missing_snapshot
        );
        assert_eq!(rd_attempt_after_missing_snapshot, missing_snapshot_attempt);
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&rd_attempt_after_retry)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();

        let mut tampered_attempt = rd_attempt_after_retry.clone();
        let reservation = tampered_attempt["invocation_claim"]
            .as_object_mut()
            .unwrap();
        let tampered_claimed_state_digest = format!("sha256:{}", "b".repeat(64));
        reservation.insert(
            "claimed_state_digest".to_string(),
            tampered_claimed_state_digest.clone().into(),
        );
        let request_identity = reservation["request_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let admission_identity = reservation["admission_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_attempt_identity = reservation["attempt_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_claim_identity = reservation["claim_identity"].as_str().unwrap().to_string();
        let claim_digest = reservation["claim_digest"].as_str().unwrap().to_string();
        let admission_receipt_identity = reservation["invocation_admission_receipt_identity"]
            .as_str()
            .unwrap()
            .to_string();
        let admission_receipt_digest = reservation["invocation_admission_receipt_digest"]
            .as_str()
            .unwrap()
            .to_string();
        let execution_custody_digest = reservation["execution_custody_digest"]
            .as_str()
            .unwrap()
            .to_string();
        let reserved_at_epoch_ms = reservation["reserved_at_epoch_ms"].as_u64().unwrap();
        let tampered_seal = seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
            request_identity: &request_identity,
            admission_identity: &admission_identity,
            attempt_identity: &reserved_attempt_identity,
            claim_identity: &reserved_claim_identity,
            claim_digest: &claim_digest,
            invocation_admission_receipt_identity: &admission_receipt_identity,
            invocation_admission_receipt_digest: &admission_receipt_digest,
            claimed_state_digest: &tampered_claimed_state_digest,
            execution_custody_digest: &execution_custody_digest,
            reserved_at_epoch_ms,
        })
        .unwrap();
        reservation.insert(
            "reservation_identity".to_string(),
            tampered_seal.reservation_identity().into(),
        );
        reservation.insert(
            "reservation_digest".to_string(),
            tampered_seal.reservation_digest().into(),
        );
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&tampered_attempt)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();
        let product_edge_state_before_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_before_tampered_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();

        let rejected = start_provider_invocation(State(state), headers, start_body).await;
        assert_eq!(rejected.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            rejected.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let product_edge_state_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let product_edge_outbox_after_tampered_retry: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1",
        )
        .bind(&claim_identity)
        .fetch_one(product_edge_pool)
        .await
        .unwrap();
        let rd_attempt_after_tampered_retry: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_owner_pool)
        .await
        .unwrap();
        assert_eq!(
            product_edge_state_after_tampered_retry,
            product_edge_state_before_tampered_retry
        );
        assert_eq!(
            product_edge_outbox_after_tampered_retry,
            product_edge_outbox_before_tampered_retry
        );
        assert_eq!(rd_attempt_after_tampered_retry, tampered_attempt);

        // The ordered chain shares one store: a later entry's directory read verifies every
        // recent attempt and would rightly refuse this tampered seal. Restore the exact custody
        // the proof found after its own legitimate retry, and prove the restoration reads back.
        sqlx::query(
            "UPDATE rd_artifact_build_attempts_v1 SET attempt_json=$1 WHERE build_request_identity=$2",
        )
        .bind(&rd_attempt_after_retry)
        .bind(&build_request_identity)
        .execute(rd_owner_pool)
        .await
        .unwrap();
        let rd_attempt_after_restore: serde_json::Value = sqlx::query_scalar(
            "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity=$1",
        )
        .bind(&build_request_identity)
        .fetch_one(rd_owner_pool)
        .await
        .unwrap();
        assert_eq!(rd_attempt_after_restore, rd_attempt_after_retry);
    }

    async fn rd_owned_relation_snapshot(pool: &sqlx::PgPool) -> Vec<(String, serde_json::Value)> {
        let relations: Vec<String> = sqlx::query_scalar(
            "SELECT class.relname
               FROM pg_catalog.pg_class class
               JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace
               JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=class.relowner
              WHERE namespace.nspname='public'
                AND class.relkind IN ('r','p')
                AND owner_role.rolname='rd_owner'
              ORDER BY class.relname",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let mut snapshot = Vec::with_capacity(relations.len());
        for relation in relations {
            let quoted = relation.replace('"', "\"\"");
            let rows: serde_json::Value = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COALESCE(jsonb_agg(row_value ORDER BY row_value::text),'[]'::jsonb)
                   FROM (SELECT to_jsonb(table_row) AS row_value
                           FROM public.\"{quoted}\" table_row) relation_snapshot"
            )))
            .fetch_one(pool)
            .await
            .unwrap();
            snapshot.push((relation, rows));
        }
        snapshot
    }

    async fn get_exploratory_result_target(
        address: std::net::SocketAddr,
        token: &str,
        target: &str,
    ) -> (StatusCode, Vec<u8>) {
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let request = format!(
            "GET {target} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("HTTP response headers")
            + 4;
        let status = std::str::from_utf8(&response[..header_end])
            .unwrap()
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .and_then(|value| StatusCode::from_u16(value).ok())
            .expect("HTTP response status");
        (status, response[header_end..].to_vec())
    }

    async fn get_exploratory_result(
        address: std::net::SocketAddr,
        token: &str,
        result_identity: &str,
        request_identity: &str,
        attempt_identity: &str,
        extra_query: Option<(&str, &str)>,
    ) -> (StatusCode, Vec<u8>) {
        let extra_query = extra_query
            .map(|(name, value)| format!("&{name}={value}"))
            .unwrap_or_default();
        get_exploratory_result_target(
            address,
            token,
            &format!(
                "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity={attempt_identity}{extra_query}"
            ),
        )
        .await
    }

    #[tokio::test]
    #[ignore = "requires the canonical Backtest result commit immediately before this R&D HTTP consumer"]
    async fn exploratory_replay_result_http_readback_is_exact_locked_and_rd_read_only() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
        let aggregate = sqlx::query(
            "SELECT result.result_identity, result.request_identity, result.attempt_identity,
                    result.canonical_bytes AS result_bytes,
                    receipt.canonical_bytes AS receipt_bytes,
                    outbox.canonical_bytes AS outbox_bytes
               FROM public.backtest_replay_results_v2 result
               JOIN public.backtest_replay_result_receipts_v1 receipt
                 ON receipt.result_identity=result.result_identity
               JOIN public.backtest_replay_result_outbox_v1 outbox
                 ON outbox.result_identity=result.result_identity
              WHERE result.request_identity='request' AND result.attempt_identity='attempt'",
        )
        .fetch_one(backtest_pool)
        .await
        .expect("canonical Backtest commit fixture must precede the R&D consumer");
        let result_identity: String = aggregate.try_get("result_identity").unwrap();
        let request_identity: String = aggregate.try_get("request_identity").unwrap();
        let attempt_identity: String = aggregate.try_get("attempt_identity").unwrap();
        let result_bytes: Vec<u8> = aggregate.try_get("result_bytes").unwrap();
        let receipt_bytes: Vec<u8> = aggregate.try_get("receipt_bytes").unwrap();
        let outbox_bytes: Vec<u8> = aggregate.try_get("outbox_bytes").unwrap();

        let owner = Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .unwrap(),
        );
        let rd_database_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
        let query_separator = if rd_database_url.contains('?') {
            '&'
        } else {
            '?'
        };
        let unavailable_owner = Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                &format!("{rd_database_url}{query_separator}options=-c%20lock_timeout%3D200ms"),
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .unwrap(),
        );
        let locked = owner
            .resolve_exploratory_replay_result_v2(ExploratoryReplayResultLocatorV2 {
                result_identity: &result_identity,
                request_identity: &request_identity,
                attempt_identity: &attempt_identity,
            })
            .await
            .expect("canonical Backtest aggregate must pass locked R&D resolution")
            .expect("exact result locator must resolve");
        assert_eq!(locked.result_canonical_bytes(), result_bytes);
        assert_eq!(locked.receipt_canonical_bytes(), receipt_bytes);
        assert_eq!(locked.outbox_canonical_bytes(), outbox_bytes);

        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let before = rd_owned_relation_snapshot(rd_pool).await;
        let token = "rd-exploratory-result-consumer-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                exploratory_replay::result_router(owner, token_digest),
            )
            .await
        });
        let (status, body) = get_exploratory_result(
            address,
            token,
            &result_identity,
            &request_identity,
            &attempt_identity,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, result_bytes);

        for (result, request, attempt) in [
            (
                "unknown-result",
                request_identity.as_str(),
                attempt_identity.as_str(),
            ),
            (
                result_identity.as_str(),
                "cross-spliced-request",
                attempt_identity.as_str(),
            ),
            (
                result_identity.as_str(),
                request_identity.as_str(),
                "cross-spliced-attempt",
            ),
        ] {
            assert_eq!(
                get_exploratory_result(address, token, result, request, attempt, None)
                    .await
                    .0,
                StatusCode::NOT_FOUND
            );
        }
        assert_eq!(
            get_exploratory_result(
                address,
                token,
                &result_identity,
                &request_identity,
                &attempt_identity,
                Some(("result_bytes", "caller-supplied")),
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let invalid_or_missing_targets = [
            format!(
                "/v2/exploratory-replay-results/%20?request_identity={request_identity}&attempt_identity={attempt_identity}"
            ),
            format!(
                "/v2/exploratory-replay-results/{result_identity}?request_identity=%20&attempt_identity={attempt_identity}"
            ),
            format!(
                "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity=%20"
            ),
            format!("/v2/exploratory-replay-results/{result_identity}"),
            format!(
                "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}"
            ),
            format!(
                "/v2/exploratory-replay-results/{result_identity}?attempt_identity={attempt_identity}"
            ),
        ];

        for target in invalid_or_missing_targets {
            let (status, body) = get_exploratory_result_target(address, token, &target).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
                "INVALID_EXPLORATORY_REPLAY_RESULT_LOCATOR"
            );
        }

        server.abort();
        let _ = server.await;

        let mut topology_fault = rd_pool.begin().await.unwrap();
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
            .bind("vibe.backtest.result-topology.v2")
            .execute(&mut *topology_fault)
            .await
            .unwrap();
        let unavailable_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let unavailable_address = unavailable_listener.local_addr().unwrap();

        let unavailable_server = tokio::spawn(async move {
            axum::serve(
                unavailable_listener,
                exploratory_replay::result_router(unavailable_owner, token_digest),
            )
            .await
        });
        let (status, body) = get_exploratory_result(
            unavailable_address,
            token,
            &result_identity,
            &request_identity,
            &attempt_identity,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
            "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE"
        );
        unavailable_server.abort();
        let _ = unavailable_server.await;
        topology_fault.rollback().await.unwrap();

        let after = rd_owned_relation_snapshot(rd_pool).await;
        assert_eq!(
            after, before,
            "R&D HTTP result readback must write no R&D fact"
        );
    }

    /// The columns a replay needs from a stored joint freeze: the Research locator it was
    /// committed under, the canonical Design identity and bytes, the joint freeze digest, and the
    /// commit time a replay has to rejoin rather than replace.
    type StoredJointFreeze = (String, Vec<u8>, Vec<u8>, Vec<u8>, i64);

    /// A frozen program replays over HTTP to the same freeze the in-process entry committed.
    ///
    /// `product_edge_postgres::tests::declared_bounded_feature_program_assembles_from_owner_custody_and_freezes`
    /// proves this path against the Owner directly. It cannot prove the transport, because it
    /// never crosses one, and `market_data_pit::router` is private to this binary, so nothing
    /// drove these routes in order. While nothing did, the declaration's refusal read as a
    /// missing capability rather than a missing call.
    ///
    /// The Design is read back rather than built. A Design that can carry Market Data custody is
    /// not a static document: it is a base bound at run time to live Research custody, so its
    /// identity differs every run and a committed copy matches no published intent. The bound
    /// bytes survive in the freeze the entry above committed, which is the only place they do.
    /// Declared meaning is committed, because none of the four bound fields are meaning.
    ///
    /// Publishing the role intent is therefore not driven here. That step needs a Design bound to
    /// custody that has not been frozen yet, and what this database holds is one already frozen.
    ///
    /// Sending the frozen pair again is a replay, and that is the stronger assertion: the receipt
    /// must name the freeze already stored, not merely answer 200. A route that reached some other
    /// freeze, or minted a second one, would still answer 200.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the ordered chain's PostgreSQL and the freeze an earlier entry commits"]
    async fn frozen_program_replays_over_http_to_the_same_joint_freeze() {
        use axum::body::Body;
        use axum::extract::Request;
        use tower::ServiceExt;
        use vibe_strategy_factory::{
            bounded_feature_program_derivation_v1::BoundedFeatureProgramMeaningV1,
            strategy_design_v2::StrategyDesignV2,
        };

        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();

        let bindings = composed_market_data_binding_admission(&test_database).await;

        let rd_pool =
            sqlx::PgPool::connect(test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner))
                .await
                .unwrap();
        let freezes_before: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1")
                .fetch_one(&rd_pool)
                .await
                .unwrap();
        let frozen: Option<StoredJointFreeze> = sqlx::query_as(
            "SELECT request_identity, design_identity, design_bytes, joint_freeze_digest,
                    committed_at_epoch_ms
               FROM public.rd_bounded_feature_program_freezes_v1
              ORDER BY committed_at_epoch_ms DESC
              LIMIT 1",
        )
        .fetch_optional(&rd_pool)
        .await
        .unwrap();
        // Zero rows is a statement about the entries before this one, not about these routes.
        // Reporting it as a route failure would send the next reader to the wrong place.
        let (locator, design_identity, design_bytes, stored_joint_freeze, _stored_committed_at) =
            frozen.expect(
            "an earlier ordered entry must have committed a Bounded Feature Program freeze: this \
             entry replays one rather than minting it, so no rows means that entry did not run",
        );

        let design: StrategyDesignV2 = serde_json::from_slice(&design_bytes)
            .expect("the stored Design bytes are the canonical Design");
        let meaning: BoundedFeatureProgramMeaningV1 = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/test_data/six_role_bar_bounded_feature/meaning.json"
            ))
            .unwrap(),
        )
        .expect("the committed declared meaning parses");

        let token = "rd-owner-api-http-replay-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(
            PostgresResearchBoundedFeatureProgramOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            )
            .await
            .unwrap(),
        );
        let app =
            bounded_feature_program::router(owner, token_digest).merge(market_data_pit::router(
                bootstrap_market_data_pit_intake().await.unwrap(),
                bootstrap_market_data_source_binding_admission()
                    .await
                    .unwrap(),
                bootstrap_market_data_universe_selection().await.unwrap(),
                bindings,
                bootstrap_market_data_instrument_master_admission()
                    .await
                    .unwrap(),
                bootstrap_market_data_market_semantics_admission()
                    .await
                    .unwrap(),
                token_digest,
            ));

        // Driven through the router rather than a socket: what is unproven is that these paths,
        // their bearer guard and their typed bodies compose in order, and the router is where all
        // three live. A listener would add the one layer nothing here doubts.
        let post =
            async |app: Router, path: &str, body: serde_json::Value| -> (StatusCode, String) {
                let response = app
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri(path)
                            .header("authorization", format!("Bearer {token}"))
                            .header("content-type", "application/json")
                            .body(Body::from(serde_json::to_vec(&body).unwrap()))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                let status = response.status();
                // The rejection code is a header, not a body field, and it is the only part that says
                // which refusal this is: two different 409s are spelled identically in the body.
                let code = response
                    .headers()
                    .get("x-rd-rejection-code")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("-")
                    .to_owned();
                let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap();
                (
                    status,
                    format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
                )
            };

        let (status, body) = post(
            app.clone(),
            "/v1/market-data/strategy-input-bindings/from-design-intent",
            // `BindingDigest` is a newtype over `[u8; 32]` with derived serde, so the wire shape
            // is an array of thirty-two numbers rather than a hex string.
            serde_json::json!({ "design_identity": design_identity }),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "admitting binding custody from the published intent: {body}",
        );

        let (status, body) = post(
            app,
            "/v1/bounded-feature-programs/declare",
            serde_json::json!({
                "research_request_locator": locator,
                "design": design,
                "meaning": meaning,
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "replaying the declaration: {body}");

        let receipt: serde_json::Value =
            serde_json::from_str(body.split_once("] ").expect("the code prefix").1)
                .expect("the freeze receipt parses");
        // The same freeze, not merely a freeze: a route that reached another one, or minted a
        // second, would also have answered 200.
        assert_eq!(
            receipt["joint_freeze_digest"].as_str().unwrap_or_default(),
            format!("sha256:{}", hex_digest(&stored_joint_freeze)),
            "the replay must name the stored joint freeze",
        );
        // Counted rather than compared against the stored commit time. Both receipt paths take
        // `committed_at_epoch_ms` from the Owner clock at the moment of the call rather than from
        // the row, so a rejoin reports when it was asked, not when the freeze was committed, and
        // the two agree only by coincidence. What a replay must not do is add a row.
        let freezes_after: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1")
                .fetch_one(&rd_pool)
                .await
                .unwrap();
        assert_eq!(
            freezes_after, freezes_before,
            "the replay must rejoin the stored freeze rather than commit a second one",
        );
    }

    /// Carries a Design this repository authored, not one an acceptance fixture committed, through
    /// the three routes that publish it, bind it and freeze it.
    ///
    /// `POST /v1/strategy-designs/publish-role-intent` had never been called by anything. The route
    /// is mounted and alive, and `author_single_threshold_program_v1` produces exactly the body it
    /// accepts, but nothing joined the two: the only producer reachable from a default build writes
    /// its JSON to stdout. Every other entry that reaches this area replays a Design read back from
    /// a freeze that `bounded_feature_program_six_role_bar_fixture_v1` committed, and that fixture
    /// exists only under `cfg(all(test, feature = "sealed-strategy-input-acceptance"))`.
    ///
    /// Everything the Research custody owns is taken from it rather than invented, and the two
    /// routes disagree about how much that is. `derive_design_role_intent_v1` compares three
    /// identities, so publication accepts a Design that carries its own falsifier;
    /// `freeze_research_bounded_feature_program_v1` compares four, the fourth being the falsifier,
    /// so the same Design is refused at declare with `RESEARCH_CUSTODY_MISMATCH`. Authoring one
    /// field freely is enough to pass the first route and fail the second. What is new here is the
    /// Design, not the Research.
    ///
    /// The authored channel is the daily close of `AAPL` because the binding admission resolves
    /// every role against this Owner's own PIT custody at the decision cut, and the only coordinates
    /// the ordered chain supplies are the six that
    /// `prepare_owner_bar_joined_cut_acceptance_basis_v1` commits at entry 32 - `MARKET`, `BAR`,
    /// scale 2, on that instrument. A freely chosen coordinate is refused with
    /// `STRATEGY_INPUT_SNAPSHOT_UNAVAILABLE`, which would be a true statement about what the chain
    /// stocks and no statement at all about the route under test.
    ///
    /// The declaration is asserted to add exactly one freeze rather than to answer 200. A Design
    /// that was already frozen rejoins its freeze and also answers 200, so the count is what
    /// separates a first declaration from a replay, and the stored bytes are compared against what
    /// was authored because some other Design's freeze would satisfy the count too.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the ordered chain's PostgreSQL and a Research request an earlier entry commits"]
    async fn an_authored_design_is_published_bound_and_frozen_over_http() {
        use axum::body::Body;
        use axum::extract::Request;
        use tower::ServiceExt;
        use vibe_strategy_factory::{
            bounded_feature_program_v1::BoundedFeaturePredicateV1,
            rd_bounded_feature_program_postgres_v1::{
                PostgresResearchBoundedFeatureProgramOwnerV1, ResearchAuthoringFactsV1,
            },
            single_threshold_authoring_v1::{
                SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1,
                SingleThresholdOutcomeV1, author_single_threshold_program_v1,
            },
        };

        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();

        let rd_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner))
            .await
            .unwrap();

        let token = "rd-owner-api-authored-design-test";
        let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let owner = Arc::new(
            PostgresResearchBoundedFeatureProgramOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            )
            .await
            .unwrap(),
        );

        // A Research identity accepts exactly one freeze, and answers every later, different
        // Design with JOINT_FREEZE_CHANGED_MEANING. This entry freezes, so it needs an accepted
        // custody that has not frozen yet - reading the identities off an already frozen Design,
        // as this entry first did, can only ever reach that conflict.
        //
        // Acceptance is necessary and not sufficient: the authoring facts also require the Intent
        // to be frozen and the custody to be current at the read cut. Those conditions are not
        // restated here, because `read_research_authoring_facts_v1` already enforces them on the
        // freeze path's own parser, and a copy of them in this query would be a second statement
        // of the same rule that drifts. Candidates are taken in bulk and the accessor decides.
        let candidates: Vec<String> = sqlx::query_scalar(
            "SELECT r.request_identity
               FROM public.rd_research_request_receipts_v1 r
              WHERE r.receipt_json->>'disposition'='ACCEPTED'
                AND NOT EXISTS (
                      SELECT 1
                        FROM public.rd_bounded_feature_program_freezes_v1 f
                       WHERE f.request_identity = r.request_identity)
              ORDER BY r.committed_at_epoch_ms DESC
              LIMIT 32",
        )
        .fetch_all(&rd_pool)
        .await
        .unwrap();
        // Zero rows is a statement about the entries before this one, not about these routes.
        assert!(
            !candidates.is_empty(),
            "no accepted Research custody is without a freeze, so this entry has nothing it is \
             allowed to freeze: that is about the entries before this one, not about these routes",
        );
        let mut chosen: Option<(String, ResearchAuthoringFactsV1)> = None;

        for candidate in &candidates {
            if let Ok(facts) = owner.read_research_authoring_facts_v1(candidate).await {
                chosen = Some((candidate.clone(), facts));
                break;
            }
        }
        let (locator, facts) = chosen.unwrap_or_else(|| {
            panic!(
                "none of the {} accepted, unfrozen Research identities carries current authoring \
                 facts: acceptance alone does not make custody current",
                candidates.len(),
            )
        });

        let (authored, meaning) =
            author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
                research_request_identity: facts.research_request_identity,
                intent_identity: facts.intent_identity,
                intent_digest: facts.intent_digest,
                channel: SingleThresholdChannelV1::ExactInstrument {
                    role_semantic_id: "research.input.close.daily.v1".to_owned(),
                    instrument: "AAPL".to_owned(),
                    field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                    timeframe: "1D".to_owned(),
                    unit: "PRICE".to_owned(),
                    scale: 2,
                },
                threshold_coefficient: 10_000,
                comparison: BoundedFeaturePredicateV1::Greater,
                when_true: SingleThresholdOutcomeV1 {
                    position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                    target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                    target_position_units: 1,
                },
                otherwise: SingleThresholdOutcomeV1 {
                    position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                    target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                    target_position_units: 0,
                },
                // From custody, not invented. The freeze compares four fields against the
                // accepted Research custody and the falsifier is the fourth: an authored one
                // publishes (that route derives the role intent from three identities) and then
                // refuses at declare with RESEARCH_CUSTODY_MISMATCH.
                falsifier: facts.falsifier.clone(),
            })
            .expect("the authoring surface must author this statement");

        let bindings = composed_market_data_binding_admission(&test_database).await;
        let app =
            bounded_feature_program::router(owner, token_digest).merge(market_data_pit::router(
                bootstrap_market_data_pit_intake().await.unwrap(),
                bootstrap_market_data_source_binding_admission()
                    .await
                    .unwrap(),
                bootstrap_market_data_universe_selection().await.unwrap(),
                bindings,
                bootstrap_market_data_instrument_master_admission()
                    .await
                    .unwrap(),
                bootstrap_market_data_market_semantics_admission()
                    .await
                    .unwrap(),
                token_digest,
            ));

        let post =
            async |app: Router, path: &str, body: serde_json::Value| -> (StatusCode, String) {
                let response = app
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri(path)
                            .header("authorization", format!("Bearer {token}"))
                            .header("content-type", "application/json")
                            .body(Body::from(serde_json::to_vec(&body).unwrap()))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                let status = response.status();
                // The rejection code is a header, not a body field, and it is the only part that
                // says which refusal this is: two different 409s are spelled identically in the
                // body.
                let code = response
                    .headers()
                    .get("x-rd-rejection-code")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("-")
                    .to_owned();
                let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap();
                (
                    status,
                    format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
                )
            };

        let (status, body) = post(
            app.clone(),
            "/v1/strategy-designs/publish-role-intent",
            serde_json::json!({
                "research_request_locator": locator,
                "design": authored,
            }),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "the first authored Design this repository ever sent must be published: {body}",
        );

        // 200 alone would also be the answer of a route that accepted the body and published the
        // Design it already had. The published intent must name the authored Design, so its identity
        // is compared against the frozen one whose Research identities this entry borrowed.
        let published: serde_json::Value =
            serde_json::from_str(body.split_once("] ").expect("the code prefix").1)
                .expect("the published role intent is JSON");
        let published_design_identity = published
            .get("design_identity")
            .expect("the published role intent names the Design it published")
            .clone();
        // A shape check rather than a comparison against another Design. This entry no longer
        // borrows a frozen Design's identities, so there is no second digest to be unequal to;
        // what the published intent names is settled at the end, by the bytes the freeze stores.
        let published_bytes = published_design_identity
            .as_array()
            .expect("a published design identity is a byte array");
        assert_eq!(
            published_bytes.len(),
            32,
            "a design identity is a 32-byte digest",
        );
        assert!(
            published
                .get("roles")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|roles| !roles.is_empty()),
            "a published role intent with no roles describes no Design: {body}",
        );

        // Publishing proves the Design is well formed and names its Research. It does not prove this
        // Owner can bind it: that route resolves every role against its own PIT custody at the
        // decision cut and refuses a coordinate it does not hold, which is why the authored channel
        // is the daily close of the instrument the ordered chain's basis supplies rather than a
        // coordinate chosen freely.
        let (status, body) = post(
            app.clone(),
            "/v1/market-data/strategy-input-bindings/from-design-intent",
            serde_json::json!({ "design_identity": published_design_identity }),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "the authored Design's roles must resolve to Owner-held snapshots: {body}",
        );

        // Counted for this Research identity rather than for the table, because other ordered
        // entries commit freezes of their own and a whole-table delta would be their count as
        // much as this one's. Zero here is also what makes the declaration below a first freeze
        // rather than a replay: a replay answers 200 and adds none.
        let freezes_before: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1
              WHERE request_identity = $1",
        )
        .bind(&locator)
        .fetch_one(&rd_pool)
        .await
        .unwrap();
        assert_eq!(
            freezes_before, 0,
            "the selected Research identity already has a freeze, so this entry would be asserting \
             a replay rather than a first freeze",
        );
        let (status, body) = post(
            app,
            "/v1/bounded-feature-programs/declare",
            serde_json::json!({
                "research_request_locator": locator,
                "design": authored,
                "meaning": meaning,
            }),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "declaring the authored Design must assemble and freeze it: {body}",
        );

        let freezes_after: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.rd_bounded_feature_program_freezes_v1
              WHERE request_identity = $1",
        )
        .bind(&locator)
        .fetch_one(&rd_pool)
        .await
        .unwrap();
        assert_eq!(
            freezes_after, 1,
            "an authored Design on an unfrozen Research identity must commit exactly one freeze",
        );

        // The count alone would also be satisfied by a freeze of some other Design committed by
        // this call, so the stored Design is compared against the one this entry published.
        //
        // By identity rather than by bytes. The Owner stores the canonical Design, and
        // `serde_json::to_vec` of the authored value is not that: canonicalization sorts
        // `reactions`, `plugins` and each node's `output_port_ids`, so the two encodings differ in
        // order while being the same Design, and comparing them failed while everything it was
        // meant to check was correct. The canonicalizer is `pub(crate)`, so this crate cannot
        // reproduce those bytes, and hand-rolling an order-insensitive comparison here would be a
        // second, weaker statement of the Owner's own notion of Design equality. The identity is
        // that notion: it is derived from the canonical bytes, the publication reported it for the
        // Design this entry authored, and the freeze row carries it for the Design it committed.
        let stored_design_identity: Vec<u8> = sqlx::query_scalar(
            "SELECT design_identity
               FROM public.rd_bounded_feature_program_freezes_v1
              WHERE request_identity = $1",
        )
        .bind(&locator)
        .fetch_one(&rd_pool)
        .await
        .unwrap();
        let published_identity_bytes: Vec<u8> = published_bytes
            .iter()
            .map(|byte| {
                u8::try_from(byte.as_u64().expect("a digest byte is a JSON number"))
                    .expect("a digest byte fits in u8")
            })
            .collect();
        assert_eq!(
            stored_design_identity.len(),
            32,
            "a stored design identity is a 32-byte digest",
        );
        assert_eq!(
            stored_design_identity, published_identity_bytes,
            "the freeze this entry committed must hold the Design this entry published",
        );
    }

    /// Composes the Market Data binding admission the ordered chain's entries drive their routes
    /// with, and refuses to hand back one that is absent.
    ///
    /// The admission is composed from the environment and the chain exports neither URL, so an
    /// entry that omits them receives `None`, and its routes then answer 503 about their own
    /// configuration rather than about the Design under test.
    ///
    /// The two variables and the check that they worked live in one function because separating
    /// them is how they came apart: an entry took the assertion from its neighbour without the
    /// block three hundred lines above that makes it hold, and failed on the assertion rather than
    /// on the omission. The comment there predicted that failure exactly and did not prevent it,
    /// because code is copied upward and comments are not read upward. Here the assertion cannot
    /// be taken without the setup.
    ///
    /// The roles are pinned in SQL rather than by convention: the composer cut lock refuses any
    /// `session_user` outside ('market_data_reader','market_data_owner'), and the reader's connect
    /// checks sixteen ACL flags exactly, including that it reaches a published intent only through
    /// a function and holds no direct table privilege. A wrong role fails the way a missing URL
    /// does.
    async fn composed_market_data_binding_admission(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    ) -> Option<Arc<dyn StrategyInputBindingAdmissionV1>> {
        unsafe {
            env::set_var(
                "MARKET_DATA_OWNER_DATABASE_URL",
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
            );
        }
        unsafe {
            env::set_var(
                "MARKET_DATA_RD_ROLE_SET_DATABASE_URL",
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
            );
        }
        let bindings = bootstrap_market_data_strategy_input_bindings()
            .await
            .unwrap();
        assert!(
            bindings.is_some(),
            "the strategy input binding admission must be composed before its routes are driven",
        );
        bindings
    }

    /// Runs the production Composer on a Design this repository authored, to a durable Artifact.
    ///
    /// The entry before this one authors a Design, carries it through publication and binding
    /// admission, and freezes it. Nothing then ran it. The chain's only Composer RUN is
    /// `frozen_program_runs_the_production_composer_to_a_durable_artifact`, which drives the same
    /// production code from `bounded_feature_program_six_role_bar_fixture_v1` behind
    /// `sealed-strategy-input-acceptance`: the production path was covered, its production input
    /// was not.
    ///
    /// The freeze is found by the Design's own shape rather than by ordering. Ordering would pick
    /// whatever froze last, and entries after the authoring one commit freezes of their own; the
    /// authored program declares exactly one input role, the daily close of `AAPL`, while every
    /// other frozen Design in this database carries the fixture's six. Exactly one match is
    /// asserted, so a second authored Design later would fail here rather than silently pick one.
    ///
    /// `Success` is asserted rather than `Ok`. A Research request with no verifiable joint freeze
    /// returns a terminal disposition and writes nothing, so the call returns `Ok` for five of the
    /// six dispositions and `.is_ok()` would hold for every refusal this entry exists to rule out.
    ///
    /// The Artifact's `design_digest` is then compared against the one stored on the freeze row.
    /// `Success` alone would also be the answer of a run that built the fixture's Artifact, and
    /// both digests are the Owner's own, derived from canonical bytes this crate cannot reproduce.
    ///
    /// It costs two real compiler invocations, so it sits immediately before the destructive
    /// drain, for the same reason the fixture run does: the most expensive entry with the least
    /// history behind it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the ordered chain's PostgreSQL, the freeze an earlier entry commits, and the pinned local wasm compiler"]
    async fn the_authored_frozen_program_runs_the_production_composer() {
        use vibe_strategy_factory::strategy_design_v2::StrategyDesignV2;

        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let rd_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner))
            .await
            .unwrap();

        let frozen: Vec<(String, Vec<u8>, Vec<u8>)> = sqlx::query_as(
            "SELECT request_identity, design_bytes, design_digest
               FROM public.rd_bounded_feature_program_freezes_v1",
        )
        .fetch_all(&rd_pool)
        .await
        .unwrap();
        let mut authored: Vec<(String, Vec<u8>)> = frozen
            .into_iter()
            .filter_map(|(locator, design_bytes, design_digest)| {
                let design: StrategyDesignV2 = serde_json::from_slice(&design_bytes).ok()?;
                let single_authored_role = design.inputs.len() == 1
                    && design.inputs[0].semantic_id == "research.input.close.daily.v1"
                    && design.inputs[0].instrument == "AAPL";
                single_authored_role.then_some((locator, design_digest))
            })
            .collect();
        // Zero is a statement about the entry that authors and freezes, not about the Composer.
        assert_eq!(
            authored.len(),
            1,
            "expected exactly one authored single-role freeze to run, found {}: with none there is \
             nothing this entry can run, and with several it would be picking one arbitrarily",
            authored.len(),
        );
        let (locator, stored_design_digest) = authored.pop().expect("the single authored freeze");

        let composer =
            vibe_strategy_factory::source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .expect("the production Composer opens against its two R&D roles");

        // Acceptance gate 6 (product-edge.md), on the production Composer's own path: each stored
        // Research column below, changed alone, must leave the Composer without a composition. The
        // source-ancestry evidence digest (a different well-formed sha256) is held to the request's
        // recorded source cut when the Research custody is admitted; the artifact evidence and its
        // digest are re-derived by the artifact readback the Composer's Research lock decodes. The
        // replay path never reads the artifact evidence, so this entry is where those two are
        // anchored. Each change is restored, and the entry goes on exactly as before.
        let (original_ancestry_digest, original_evidence_digest, original_evidence_json): (
            String,
            String,
            String,
        ) =
            sqlx::query_as(
                "SELECT source_ancestry_evidence_digest, artifact_evidence_digest, artifact_evidence_json::text
               FROM public.rd_research_request_receipts_v1
              WHERE request_identity=$1 AND source_ancestry_evidence_digest IS NOT NULL
                AND artifact_evidence_digest IS NOT NULL AND artifact_evidence_json IS NOT NULL",
            )
            .bind(&locator)
            .fetch_one(&rd_pool)
            .await
            .expect("the authored Research carries its ancestry and artifact evidence");
        let research_tampers = [
            (
                "source_ancestry_evidence_digest",
                "UPDATE public.rd_research_request_receipts_v1
                    SET source_ancestry_evidence_digest='sha256:'||encode(sha256('stored-tamper'::bytea),'hex')
                  WHERE request_identity=$1",
                "UPDATE public.rd_research_request_receipts_v1 SET source_ancestry_evidence_digest=$2
                  WHERE request_identity=$1",
                &original_ancestry_digest,
            ),
            (
                "artifact_evidence_digest",
                "UPDATE public.rd_research_request_receipts_v1
                    SET artifact_evidence_digest=artifact_evidence_digest||'-stored-tamper'
                  WHERE request_identity=$1",
                "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_digest=$2
                  WHERE request_identity=$1",
                &original_evidence_digest,
            ),
            (
                "artifact_evidence_json",
                "UPDATE public.rd_research_request_receipts_v1
                    SET artifact_evidence_json=artifact_evidence_json||'{\"stored_tamper\":true}'::jsonb
                  WHERE request_identity=$1",
                "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_json=$2::jsonb
                  WHERE request_identity=$1",
                &original_evidence_json,
            ),
        ];

        for (column, tamper, restore, original) in research_tampers {
            let tampered = sqlx::query(tamper)
                .bind(&locator)
                .execute(&rd_pool)
                .await
                .unwrap_or_else(|e| panic!("change {column}: {e}"))
                .rows_affected();
            assert_eq!(
                tampered, 1,
                "changing {column} must touch exactly the authored Research"
            );
            let refused = Box::pin(composer.run_bounded_feature_program(&locator)).await;
            eprintln!("stored tamper {column}: {refused:?}");
            assert!(
                !matches!(
                    &refused,
                    Ok(response) if response.disposition == DevelopComposerOperationDispositionV2::Success
                ),
                "the production Composer composed over a changed {column}: {refused:?}",
            );
            let restored = sqlx::query(restore)
                .bind(&locator)
                .bind(original)
                .execute(&rd_pool)
                .await
                .unwrap_or_else(|e| panic!("restore {column}: {e}"))
                .rows_affected();
            assert_eq!(
                restored, 1,
                "restoring {column} must touch exactly the authored Research"
            );
        }

        let response = Box::pin(composer.run_bounded_feature_program(&locator))
            .await
            .expect("the R&D transaction completes");
        assert_eq!(
            response.disposition,
            DevelopComposerOperationDispositionV2::Success,
            "the authored frozen program must compose to an Artifact: {:?} at {:?}",
            response.reason,
            response.coordinate,
        );

        let artifact = response
            .artifact
            .as_ref()
            .expect("a successful Composer operation carries its Artifact");
        assert_eq!(
            artifact.design_digest.as_bytes().as_slice(),
            stored_design_digest.as_slice(),
            "the Artifact must be built from the authored Design this entry selected",
        );
        // A disposition and an Artifact projection are what the call returned; a receipt is what
        // it committed. Without this the entry would accept a Success that wrote nothing.
        assert!(
            response.receipt_identity.is_some(),
            "a successful Composer operation must carry the receipt it committed",
        );

        // Replaying the same locator must resolve the operation already committed rather than
        // build a second Artifact for one frozen meaning. This is also what distinguishes a
        // durable commit from a call that merely answered: a response that can be resolved again,
        // identically, came from storage.
        let replay = Box::pin(composer.run_bounded_feature_program(&locator))
            .await
            .expect("the replay transaction completes");
        assert_eq!(
            replay, response,
            "replaying one frozen meaning must resolve the committed operation, not compose again",
        );
    }

    fn bearer_headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        headers
    }

    async fn response_json(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn assert_exact_start_custody(
        response: &serde_json::Value,
        build_request_identity: &str,
        attempt_identity: &str,
    ) {
        assert_eq!(
            response["execution_custody"]["request"]["build_request_identity"],
            build_request_identity
        );
        assert_eq!(
            response["execution_custody"]["request"]["attempt_identity"],
            attempt_identity
        );
        assert_eq!(
            response["execution_custody"]["claim_identity"],
            response["invocation_start"]["claim_identity"]
        );
        assert_eq!(
            response["execution_custody"]["claim_digest"],
            response["invocation_start"]["claim_digest"]
        );

        for field in [
            "reservation_identity",
            "reservation_digest",
            "execution_custody_digest",
            "canonical_intent_bytes",
            "trial_family_identity",
            "census_frontier_identity",
        ] {
            assert!(
                response["execution_custody"][field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }
    }

    #[tokio::test]
    async fn receiptless_v2_rejections_require_same_identity_resolution() {
        for (status, code) in [
            (StatusCode::FORBIDDEN, "UNAUTHORIZED_PRODUCT_EDGE"),
            (StatusCode::BAD_REQUEST, "MALFORMED_TYPED_REQUEST"),
            (StatusCode::SERVICE_UNAVAILABLE, "OWNER_UNAVAILABLE"),
        ] {
            let response = rejection_v2(status, code, "request-v2");
            assert_eq!(response.status(), status);
            assert_eq!(response.headers().get("x-rd-rejection-code").unwrap(), code);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
            assert_eq!(value["request_identity"], "request-v2");
            assert_eq!(value["owner_receipt"], serde_json::Value::Null);
            assert_eq!(value["next_legal_action"], "RESOLVE_SAME_REQUEST_IDENTITY");
        }
    }

    #[tokio::test]
    async fn product_edge_unavailable_projects_same_attempt_resolution() {
        let response = artifact_product_edge_error(
            &ProductEdgeError::unavailable(
                vibe_product_edge::ProductEdgeUnavailableReasonV1::Missing,
            ),
            "build-1",
            "attempt-1",
        );
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["build_request_identity"], "build-1");
        assert_eq!(value["attempt_identity"], "attempt-1");
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    #[tokio::test]
    async fn missing_artifact_admission_is_truthful_same_attempt_unknown() {
        let response = artifact_unknown(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            "build-1",
            "attempt-1",
        );
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_OUTCOME_UNKNOWN"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["build_request_identity"], "build-1");
        assert_eq!(value["attempt_identity"], "attempt-1");
        assert_eq!(value["owner_receipt"], serde_json::Value::Null);
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_ATTEMPT_IDENTITY");
    }

    #[cfg(feature = "sealed-develop-composer-acceptance")]
    #[rstest]
    #[case::invalid_request(
        ReplayCompositionBindingErrorV1::InvalidRequest,
        StatusCode::BAD_REQUEST,
        None
    )]
    #[case::issuance_identity_conflict(
        ReplayCompositionBindingErrorV1::IssuanceIdentityConflict,
        StatusCode::CONFLICT,
        Some("CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY")
    )]
    #[case::price_adjustment_unknown(
        ReplayCompositionBindingErrorV1::PriceAdjustmentUnknown,
        StatusCode::UNPROCESSABLE_ENTITY,
        None
    )]
    #[case::replay_v2_unavailable(
        ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::digest_mismatch(
        ReplayCompositionBindingErrorV1::DigestMismatch,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::unknown_binding(
        ReplayCompositionBindingErrorV1::UnknownBinding,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::non_canonical_order(
        ReplayCompositionBindingErrorV1::NonCanonicalOrder,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::incomplete_composition(
        ReplayCompositionBindingErrorV1::IncompleteComposition,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::dependency_mismatch(
        ReplayCompositionBindingErrorV1::DependencyMismatch,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::ambiguous_binding(
        ReplayCompositionBindingErrorV1::AmbiguousBinding,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    #[case::legacy_unbound(
        ReplayCompositionBindingErrorV1::LegacyUnbound,
        StatusCode::SERVICE_UNAVAILABLE,
        None
    )]
    fn replay_composition_refusal_follows_the_cause(
        #[case] error: ReplayCompositionBindingErrorV1,
        #[case] status: StatusCode,
        #[case] code: Option<&str>,
    ) {
        let response = replay_composition_refusal(error);
        assert_eq!(response.status(), status);
        assert_eq!(
            response
                .headers()
                .get("x-rd-rejection-code")
                .map(|value| value.to_str().expect("rejection code is ASCII")),
            code
        );
    }

    struct FailingResearchReadbackOwner(&'static str);

    #[async_trait]
    impl ResearchReadbackOwnerPortV1 for FailingResearchReadbackOwner {
        async fn read_research_v2(
            &self,
            _request_identity: &str,
        ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
            Err(ResearchGoalOwnerError::Storage(self.0.to_string()))
        }
    }

    /// The 503 is unchanged and says nothing, so the log is the only place the store's own error
    /// survives. The capture subscriber is thread-local, so the future runs on this thread.
    #[rstest]
    fn research_readback_store_failure_keeps_its_503_and_logs_the_cause() {
        let owner = FailingResearchReadbackOwner("readback store down");
        let (response, written) = crate::log_capture::capture(|| {
            tokio::runtime::Builder::new_current_thread()
                .build()
                .expect("current-thread runtime")
                .block_on(read_research_v2_through(
                    &owner,
                    "research-request-readback",
                ))
        });

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(
            written.contains("Research readback unavailable"),
            "{written}"
        );
        assert!(written.contains("readback store down"), "{written}");
        assert!(written.contains("research-request-readback"), "{written}");
    }

    struct MockArtifactBuildOwner {
        preflight: Result<ArtifactRequestIdentityPreflightV1, String>,
        preflight_calls: AtomicUsize,
    }

    #[async_trait]
    impl ArtifactBuildOwnerPort for MockArtifactBuildOwner {
        async fn preflight_request_identity(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<ArtifactRequestIdentityPreflightV1, ArtifactBuildError> {
            self.preflight_calls.fetch_add(1, Ordering::SeqCst);
            self.preflight.clone().map_err(ArtifactBuildError::Storage)
        }

        async fn prepare(
            &self,
            _request: ArtifactBuildRequestV1,
        ) -> Result<ArtifactBuildPreparationV1, ArtifactBuildError> {
            panic!("preflight test must not prepare")
        }

        async fn reserve_provider_invocation_custody(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
            _claim: ProductEdgeInvocationClaimReadbackV1,
        ) -> Result<ReservedArtifactBuildInvocationV1, ArtifactBuildError> {
            panic!("preflight test must not resolve invocation custody")
        }

        async fn submit_candidate(
            &self,
            _request: ArtifactBuildRequestV1,
            _candidate: ArtifactBuildCandidateV1,
            _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not submit a candidate")
        }

        async fn fail_no_artifact(
            &self,
            _request: ArtifactBuildRequestV1,
            _failure_code: &str,
            _invocation: Option<&ProductEdgeInvocationClaimReadbackV1>,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not terminalize")
        }

        async fn resolve(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
            _admission: &vibe_product_edge::ProductEdgeAdmissionLocatorV1,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not resolve")
        }

        async fn resolve_legacy_terminal_quarantined(
            &self,
            _build_request_identity: &str,
            _attempt_identity: &str,
        ) -> Result<ArtifactBuildResultV1, ArtifactBuildError> {
            panic!("preflight test must not resolve legacy custody")
        }
    }

    #[tokio::test]
    async fn legacy_collision_stops_before_product_edge_admission_through_owner_port() {
        let concrete = Arc::new(MockArtifactBuildOwner {
            preflight: Ok(ArtifactRequestIdentityPreflightV1::LegacyTerminalQuarantined),
            preflight_calls: AtomicUsize::new(0),
        });
        let artifact_owner: Arc<dyn ArtifactBuildOwnerPort> = concrete.clone();
        let product_edge_admission_calls = AtomicUsize::new(0);

        let result = preflight_then_admit_artifact_request(
            artifact_owner.as_ref(),
            "artifact-build-request-legacy",
            "artifact-build-attempt-legacy",
            || async {
                product_edge_admission_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;

        let Err((ProductEdgeError::Unavailable(detail), _, _)) = result else {
            panic!("a legacy collision must refuse as unavailable, was {result:?}");
        };
        assert_eq!(
            detail.reason(),
            &ProductEdgeUnavailableReasonV1::DownstreamCustodyMismatch
        );
        assert_eq!(concrete.preflight_calls.load(Ordering::SeqCst), 1);
        assert_eq!(product_edge_admission_calls.load(Ordering::SeqCst), 0);
    }

    /// The response is the same for both refusals, so the only thing that can be wrong is which
    /// error reaches the log. A store failure must reach it as storage, carrying its own text.
    #[tokio::test]
    async fn artifact_preflight_store_failure_is_storage_not_a_custody_mismatch() {
        let concrete = Arc::new(MockArtifactBuildOwner {
            preflight: Err("preflight store down".to_string()),
            preflight_calls: AtomicUsize::new(0),
        });
        let artifact_owner: Arc<dyn ArtifactBuildOwnerPort> = concrete.clone();
        let product_edge_admission_calls = AtomicUsize::new(0);

        let result = preflight_then_admit_artifact_request(
            artifact_owner.as_ref(),
            "artifact-build-request-store",
            "artifact-build-attempt-store",
            || async {
                product_edge_admission_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;

        let Err((ProductEdgeError::Storage(detail), build_request_identity, attempt_identity)) =
            result
        else {
            panic!("a store failure must refuse as storage, was {result:?}");
        };
        assert!(detail.contains("preflight store down"), "{detail}");
        assert_eq!(build_request_identity, "artifact-build-request-store");
        assert_eq!(attempt_identity, "artifact-build-attempt-store");
        assert_eq!(concrete.preflight_calls.load(Ordering::SeqCst), 1);
        assert_eq!(product_edge_admission_calls.load(Ordering::SeqCst), 0);
    }

    #[rstest]
    #[case::vacant(ResearchRequestIdentityPreflightV1::Vacant)]
    #[case::current(ResearchRequestIdentityPreflightV1::Current)]
    fn research_preflight_lets_a_vacant_or_current_identity_proceed(
        #[case] preflight: ResearchRequestIdentityPreflightV1,
    ) {
        assert!(research_preflight_refusal(Ok(preflight), "research-request").is_none());
    }

    #[tokio::test]
    async fn research_preflight_keeps_the_legacy_quarantine_answer() {
        let response = research_preflight_refusal(
            Ok(ResearchRequestIdentityPreflightV1::LegacyQuarantined),
            "research-request-legacy",
        )
        .expect("a legacy-quarantined identity must be refused");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(response.headers().get("x-rd-rejection-code").is_none());
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["resolution"], "SUBMITTED_OR_UNKNOWN");
        assert_eq!(value["next_legal_action"], "RESOLVE_SAME_REQUEST_IDENTITY");
        assert_eq!(value["request_identity"], "research-request-legacy");
    }

    #[rstest]
    fn research_preflight_store_failure_is_owner_unavailable_and_logs_its_cause() {
        let (response, written) = crate::log_capture::capture(|| {
            research_preflight_refusal(
                Err(ResearchGoalOwnerError::Storage(
                    "research preflight store down".to_string(),
                )),
                "research-request-store",
            )
        });
        let response = response.expect("a store failure must be refused");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers().get("x-rd-rejection-code").unwrap(),
            "OWNER_UNAVAILABLE"
        );
        assert!(
            written.contains("research preflight store down"),
            "{written}"
        );
        assert!(written.contains("research-request-store"), "{written}");
    }

    /// This response carries no rejection code at all, so the log is the only place the cause survives.
    #[rstest]
    #[case::authority(
        ProductEdgeError::Unavailable(ProductEdgeUnavailableV1::about(
            ProductEdgeUnavailableReasonV1::Missing,
            ProductEdgeSubjectKindV1::Admission,
            "product-edge-authority",
        )),
        "product-edge-authority",
        "Product Edge authority unavailable"
    )]
    #[case::storage(
        ProductEdgeError::Storage("product-edge-storage".to_string()),
        "product-edge-storage",
        "Product Edge storage unavailable",
    )]
    fn an_unresolved_result_names_its_cause_in_the_log(
        #[case] error: ProductEdgeError,
        #[case] detail: &str,
        #[case] message: &str,
    ) {
        let (response, written) =
            crate::log_capture::capture(|| product_edge_error(&error, "request-1", false));

        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "{written}"
        );
        assert!(written.contains("WARN"), "{written}");
        assert!(written.contains(detail), "{written}");
        assert!(written.contains(message), "{written}");
    }

    /// `OWNER_OUTCOME_UNKNOWN` is one code for both causes; the log is where they come apart.
    #[rstest]
    #[case::authority(
        ProductEdgeError::Unavailable(ProductEdgeUnavailableV1::about(
            ProductEdgeUnavailableReasonV1::Missing,
            ProductEdgeSubjectKindV1::Admission,
            "artifact-build-authority",
        )),
        "artifact-build-authority",
        "Product Edge authority unavailable"
    )]
    #[case::storage(
        ProductEdgeError::Storage("artifact-build-storage".to_string()),
        "artifact-build-storage",
        "Product Edge storage unavailable",
    )]
    fn an_unknown_artifact_outcome_names_its_cause_in_the_log(
        #[case] error: ProductEdgeError,
        #[case] detail: &str,
        #[case] message: &str,
    ) {
        let (response, written) = crate::log_capture::capture(|| {
            artifact_product_edge_error(&error, "build-1", "attempt-1")
        });

        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "{written}"
        );
        assert!(written.contains("WARN"), "{written}");
        assert!(written.contains(detail), "{written}");
        assert!(written.contains(message), "{written}");
    }
}
