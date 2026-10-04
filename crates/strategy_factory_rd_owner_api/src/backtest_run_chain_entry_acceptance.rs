//! The ordered chain's proof that `backtest.run`'s orchestration is driven, not merely structured:
//! this entry runs it from a catalogued strategy through authoring, role binding and freeze, up
//! to the exact point the replay step cannot proceed - nothing on `main` implements Market Data's
//! T0-5 derived view yet.
//!
//! Placed after F in the chain, so F's already-admitted perpetual (its Source Binding, Instrument
//! Master fact and historical membership) is this entry's precondition, not something it repeats.
//! F is the chain's only producer of that fixture; this entry only reads the state it left.
//!
//! `custody` is a synthetic chain claim, not a committed one: `BacktestRunOwnersV1::custody_frames`
//! is `None` today, so `run_backtest_v1` never calls a resolver with it. Once Market Data's T0-5
//! view lands, this entry gains a real custody commit to carry the test further - see the module
//! doc of `backtest_run_v1`.

use std::sync::Arc;

use vibe_data::owner::{
    market_semantics_admission_v1::market_semantics_admission_from_environment_v1,
    pit_market_snapshot_intake_v1::pit_market_snapshot_intake_from_environment_v1,
    pit_window_custody_v1::UntrustedPitWindowCustodyClaimV1, source_binding::BindingDigest,
    strategy_input_binding_admission_v1::strategy_input_binding_admission_from_environment_v1,
    universe_selection_admission_v1::universe_selection_admission_from_environment_v1,
};
use vibe_postgres_connect::{PgPoolOptionsExt as _, PostgresTls};
use vibe_product_edge::deployment_acceptance::{
    DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
    ensure_product_edge_deployment_acceptance_fixture_v1,
};
use vibe_strategy_factory::{
    backtest_run_dataset_ref_v1::BacktestRunDatasetRefV1,
    bounded_feature_program_v1::BoundedFeaturePredicateV1,
    product_edge::{RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3, RESEARCH_OWNER_V1},
    product_edge_postgres::{
        PostgresResearchGoalOwnerV1, research_initial_pit::MarketDataInitialPitPortsV1,
    },
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    single_threshold_authoring_v1::{SingleThresholdChannelV1, SingleThresholdOutcomeV1},
    strategy_catalog_postgres_v1::PostgresStrategyCatalogV1,
    strategy_catalog_v1::{
        SingleThresholdStrategySpecV1, StrategyStatementV1, canonical_strategy_statement_v1,
    },
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::backtest_run_v1::{
    BacktestRunErrorV1, BacktestRunOwnersV1, BacktestRunReplayUnavailableV1, BacktestRunRequestV1,
    run_backtest_v1,
};
use crate::first_composer_v3_replay_acceptance::{PERPETUAL_V1, UniverseMemberDailyBarsV1};

/// Market Data's registered semantic ids for a daily close and open - the same two F's own Design
/// authors against, since they name generic vocabulary, not anything F-specific.
const CLOSE_ROLE: &str = "research.input.close.daily.v1";
const OPEN_ROLE: &str = "research.input.open.daily.v1";

/// A minimal single-threshold catalog statement over the perpetual F already admitted.
fn backtest_run_chain_entry_spec_v1() -> SingleThresholdStrategySpecV1 {
    SingleThresholdStrategySpecV1 {
        channel: SingleThresholdChannelV1::UniverseMember {
            close_role_semantic_id: CLOSE_ROLE.to_owned(),
            open_role_semantic_id: OPEN_ROLE.to_owned(),
        },
        threshold: "100".to_owned(),
        comparison: BoundedFeaturePredicateV1::Greater,
        when_true: SingleThresholdOutcomeV1 {
            position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
            target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
            target_position_units: 100,
            target_weight_micros: 0,
        },
        otherwise: SingleThresholdOutcomeV1 {
            position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
            target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
            target_position_units: 0,
            target_weight_micros: 0,
        },
        stop_loss_fraction: None,
        take_profit_fraction: None,
        max_holding_bars: None,
        falsifier: "the chain entry's own statement, not a research claim".to_owned(),
    }
}

/// Runs `backtest.run`'s orchestration from a fresh catalog entry through to the replay step, and
/// asserts it stops there by exactly the one name the missing T0-5 dependency carries.
pub(crate) async fn assert_backtest_run_reaches_the_replay_step_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
) {
    crate::tests::composed_market_data_binding_admission(test_database).await;

    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let product_edge_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
        test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        product_edge_url,
        &DeploymentAcceptanceProposalV1 {
            fixture_key: "backtest-run-chain-entry-v1".to_owned(),
            audience: RESEARCH_OWNER_V1.to_owned(),
            permissions: vec!["research:submit".to_owned()],
            operations: vec![DeploymentAcceptanceOperationV1 {
                operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
                operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
                allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            }],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("the backtest.run chain entry's deployment: {e}"));

    let catalog = Arc::new(
        PostgresStrategyCatalogV1::connect(rd_url)
            .await
            .expect("the strategy catalog opens"),
    );
    let canonical = canonical_strategy_statement_v1(&StrategyStatementV1::SingleThreshold(
        Box::new(backtest_run_chain_entry_spec_v1()),
    ))
    .expect("the chain entry's own statement authors into a program");
    let strategy_id = canonical.identity();
    catalog
        .create(&canonical)
        .await
        .expect("the chain entry's strategy is new to this chain database");

    let owners = BacktestRunOwnersV1 {
        catalog,
        product_edge: Arc::new(
            deployment
                .connect_owner(product_edge_url)
                .await
                .expect("the deployment's Product Edge Owner opens"),
        ),
        research: Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                rd_url,
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .expect("the Research Owner opens"),
        ),
        bounded_feature_program: Arc::new(
            PostgresResearchBoundedFeatureProgramOwnerV1::connect(rd_url)
                .await
                .expect("the Bounded Feature Program Owner opens"),
        ),
        strategy_input_bindings: strategy_input_binding_admission_from_environment_v1()
            .await
            .expect("the strategy input binding admission port opens"),
        market_data_initial_pit: MarketDataInitialPitPortsV1::new(
            universe_selection_admission_from_environment_v1()
                .await
                .expect("Market Data's Universe Selection admission opens"),
            pit_market_snapshot_intake_from_environment_v1(Arc::new(UniverseMemberDailyBarsV1))
                .await
                .expect("Market Data's PIT intake opens"),
        ),
        market_semantics: market_semantics_admission_from_environment_v1()
            .await
            .expect("Market Data's Market Semantics admission opens"),
        rd_pool: sqlx::postgres::PgPoolOptions::new()
            .connect_url(rd_url, PostgresTls::Disabled)
            .await
            .expect("the R&D Owner pool opens"),
        custody_frames: None,
    };

    let request = BacktestRunRequestV1 {
        run_id: "backtest-run-chain-entry-v1".to_owned(),
        strategy_id,
        dataset_ref: BacktestRunDatasetRefV1::new(
            PERPETUAL_V1.to_owned(),
            "1d".to_owned(),
            0,
            86_400_000_000_000,
        )
        .expect("the chain entry's dataset_ref is well-formed"),
        // Synthetic: `custody_frames` is `None` above, so `run_backtest_v1` never resolves this
        // claim against real custody - see this file's module doc.
        custody: UntrustedPitWindowCustodyClaimV1 {
            chain_root: BindingDigest::from_untrusted_bytes([0x5a; 32]),
        },
        request_proof_digest: deployment.request_proof_digest.clone(),
    };

    match run_backtest_v1(&owners, request).await {
        Ok(reached) => {
            assert!(
                reached
                    .research_request_identity
                    .starts_with("backtest-run:"),
                "the Research request this run opened is namespaced: {}",
                reached.research_request_identity,
            );
            assert_ne!(
                reached.design_identity.as_bytes(),
                &[0_u8; 32],
                "the authored Design has a real identity"
            );
            assert!(
                !reached.freeze.joint_freeze_digest.is_empty(),
                "the program froze with a real joint-freeze digest"
            );
            assert!(
                matches!(
                    reached.reason,
                    BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable
                ),
                "backtest.run must stop at the replay step by this one name until Market Data's \
                 T0-5 view lands: {:?}",
                describe_replay_reason(&reached.reason),
            );
        }
        Err(e) => panic!(
            "backtest.run must reach the replay step: {}",
            describe_error(&e)
        ),
    }

    assert_backtest_runs_are_recorded_and_read_back_v1(
        test_database,
        &deployment
            .connect_owner(product_edge_url)
            .await
            .expect("the deployment's Product Edge Owner opens"),
        &deployment.request_proof_digest,
        strategy_id,
    )
    .await;
}

const TOKEN: &str = "backtest-run-chain-entry-token";

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (axum::http::StatusCode, serde_json::Value, Vec<u8>) {
    use tower::ServiceExt as _;

    let mut request = axum::http::Request::builder().method(method).uri(uri);

    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let request = match body {
        Some(body) => request
            .header("content-type", "application/json")
            .body(axum::body::Body::from(body.to_string())),
        None => request.body(axum::body::Body::empty()),
    }
    .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap()
        .to_vec();
    let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, value, bytes)
}

/// The run route over HTTP with the backtest run registry: a run carried to its replay step is
/// recorded once and read back as status, in the list and as a report that has no result yet; the
/// same request answers the recorded bytes, another under its run id is refused, and a submission
/// refused before its replay step records nothing.
async fn assert_backtest_runs_are_recorded_and_read_back_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    product_edge: &vibe_product_edge::ProductEdgePostgresOwnerV1,
    request_proof_digest: &str,
    strategy_id: vibe_strategy_factory::strategy_catalog_v1::StrategyIdentityV1,
) {
    use axum::http::StatusCode;
    use serde_json::json;
    use sha2::{Digest as _, Sha256};
    use vibe_strategy_factory::backtest_run_registry_postgres_v1::PostgresBacktestRunRegistryV1;

    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let state = crate::backtest_run_routes::BacktestRunRoutesApiState {
        catalog: Arc::new(
            PostgresStrategyCatalogV1::connect(rd_url)
                .await
                .expect("catalog"),
        ),
        registry: Arc::new(
            PostgresBacktestRunRegistryV1::connect(rd_url)
                .await
                .expect("the backtest run registry opens"),
        ),
        product_edge: Arc::new(product_edge.clone()),
        research: Arc::new(
            PostgresResearchGoalOwnerV1::connect(
                rd_url,
                test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
            )
            .await
            .expect("the Research Owner opens"),
        ),
        bounded_feature_program: Arc::new(
            PostgresResearchBoundedFeatureProgramOwnerV1::connect(rd_url)
                .await
                .expect("the Bounded Feature Program Owner opens"),
        ),
        strategy_input_bindings: Some(
            strategy_input_binding_admission_from_environment_v1()
                .await
                .expect("the strategy input binding admission port opens"),
        ),
        market_data_universe_selection: Some(
            universe_selection_admission_from_environment_v1()
                .await
                .expect("Market Data's Universe Selection admission opens"),
        ),
        market_data_pit_intake: Some(
            pit_market_snapshot_intake_from_environment_v1(Arc::new(UniverseMemberDailyBarsV1))
                .await
                .expect("Market Data's PIT intake opens"),
        ),
        market_semantics: Some(
            market_semantics_admission_from_environment_v1()
                .await
                .expect("Market Data's Market Semantics admission opens"),
        ),
        rd_pool: sqlx::postgres::PgPoolOptions::new()
            .connect_url(rd_url, PostgresTls::Disabled)
            .await
            .expect("the R&D Owner pool opens"),
        request_proof_digest: request_proof_digest.to_owned(),
        token_digest: Sha256::digest(TOKEN.as_bytes()).into(),
    };
    let app = crate::backtest_run_routes::router(state);
    // The chain's database outlives one run, so this run's id is its own.
    let run_id = format!(
        "backtest-run-chain-entry-http-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("after the epoch")
            .as_nanos()
    );
    let request = |run_id: &str, window_end_ns_exclusive: u64| {
        json!({
            "run_id": run_id,
            "strategy_id": strategy_id.to_string(),
            "instrument": PERPETUAL_V1,
            "execution_timeframe": "1d",
            "window_start_ns": 0,
            "window_end_ns_exclusive": window_end_ns_exclusive,
            "custody_chain_root": BindingDigest::from_untrusted_bytes([0x5a; 32]),
        })
    };
    let token = Some(TOKEN);

    let (status, body, _) = call(&app, "GET", "/v1/backtests", None, None).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("UNAUTHORIZED_PRODUCT_EDGE"))
    );

    // Recorded once its orchestration reaches the replay step, and answered byte for byte again.
    let (status, answer, answer_bytes) = call(
        &app,
        "POST",
        "/v1/backtests",
        token,
        Some(request(&run_id, 86_400_000_000_000)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{answer}");
    assert_eq!(answer["replay_state"], "CUSTODY_FRAMES_NOT_AVAILABLE");
    let (status, _, again) = call(
        &app,
        "POST",
        "/v1/backtests",
        token,
        Some(request(&run_id, 86_400_000_000_000)),
    )
    .await;
    assert_eq!((status, again), (StatusCode::OK, answer_bytes));
    let (status, body, _) = call(
        &app,
        "POST",
        "/v1/backtests",
        token,
        Some(request(&run_id, 2 * 86_400_000_000_000)),
    )
    .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("RUN_ID_CONFLICT"))
    );

    // Read back as status, in the list, and as a report that has no result yet.
    let path = |suffix: &str| format!("/v1/backtests/{run_id}{suffix}");
    let (status, run, _) = call(&app, "GET", &path(""), token, None).await;
    assert_eq!(status, StatusCode::OK, "{run}");
    assert_eq!(
        (run["run_id"].as_str(), &run["answer"]),
        (Some(run_id.as_str()), &answer)
    );
    assert_eq!(
        run["request"]["window_end_ns_exclusive"],
        86_400_000_000_000_u64
    );
    let (status, listed, _) = call(&app, "GET", "/v1/backtests?limit=500", token, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        listed["runs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|listed| listed["run_id"] == run_id.as_str()),
        "the run is listed"
    );
    let (status, body, _) = call(&app, "GET", "/v1/backtests?limit=0", token, None).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (
            StatusCode::BAD_REQUEST,
            Some("BACKTEST_RUN_LIST_LIMIT_OUT_OF_RANGE")
        )
    );
    let (status, report, _) = call(&app, "GET", &path("/report"), token, None).await;
    assert_eq!(
        (status, report["code"].as_str(), &report["replay_state"]),
        (
            StatusCode::CONFLICT,
            Some("RUN_HAS_NO_RESULT"),
            &json!("CUSTODY_FRAMES_NOT_AVAILABLE")
        )
    );

    // A submission refused before its replay step is not a run: it records nothing.
    let refused = format!("{run_id}-unknown-strategy");
    let mut unknown = request(&refused, 86_400_000_000_000);
    unknown["strategy_id"] = json!(format!("sha256:{}", "ab".repeat(32)));
    let (status, body, _) = call(&app, "POST", "/v1/backtests", token, Some(unknown)).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("STRATEGY_UNKNOWN"))
    );

    for suffix in ["", "/report"] {
        let (status, body, _) = call(
            &app,
            "GET",
            &format!("/v1/backtests/{refused}{suffix}"),
            token,
            None,
        )
        .await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::NOT_FOUND, Some("RUN_UNKNOWN"))
        );
    }
}

fn describe_replay_reason(reason: &BacktestRunReplayUnavailableV1) -> String {
    match reason {
        BacktestRunReplayUnavailableV1::CustodyFramesNotAvailable => {
            "custody frames not available".to_owned()
        }
        BacktestRunReplayUnavailableV1::CustodyFramesRefused(refusal) => {
            format!("custody frames refused: {refusal}")
        }
        BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(frames) => {
            format!("frames resolved, no consumer yet: {frames:?}")
        }
    }
}

fn describe_error(error: &BacktestRunErrorV1) -> String {
    match error {
        BacktestRunErrorV1::StrategyUnknown => "strategy unknown".to_owned(),
        BacktestRunErrorV1::StrategyArchived => "strategy archived".to_owned(),
        BacktestRunErrorV1::CatalogUnavailable(e) => format!("catalog unavailable: {e}"),
        BacktestRunErrorV1::StrategySpecUndecodable(e) => {
            format!("strategy spec undecodable: {e}")
        }
        BacktestRunErrorV1::AdmissionPreflightUnavailable(e) => {
            format!("admission preflight unavailable: {e}")
        }
        BacktestRunErrorV1::AdmissionFailed(e) => format!("admission failed: {e}"),
        BacktestRunErrorV1::AdmissionLegacyQuarantined => "admission legacy quarantined".to_owned(),
        BacktestRunErrorV1::GoalSubmissionFailed(e) => format!("goal submission failed: {e}"),
        BacktestRunErrorV1::GoalNotAccepted(resolution) => {
            format!("goal not accepted: {resolution:?}")
        }
        BacktestRunErrorV1::InitialPitFailed(e) => format!("initial PIT failed: {e}"),
        BacktestRunErrorV1::InitialPitNotAvailable(state) => {
            format!("initial PIT not available: {state:?}")
        }
        BacktestRunErrorV1::PitTerminalUnreadable(e) => format!("PIT terminal unreadable: {e}"),
        BacktestRunErrorV1::PitTerminalNotCommitted => "PIT terminal not committed".to_owned(),
        BacktestRunErrorV1::PitSnapshotNotLocatable => "PIT snapshot not locatable".to_owned(),
        BacktestRunErrorV1::MarketSemanticsScopeUnavailable(e) => {
            format!("Market Semantics scope unavailable: {e}")
        }
        BacktestRunErrorV1::MarketSemanticsAdmissionFailed(e) => {
            format!("Market Semantics admission failed: {e:?}")
        }
        BacktestRunErrorV1::AuthoringFactsUnavailable(e) => {
            format!("authoring facts unavailable: {e}")
        }
        BacktestRunErrorV1::AuthoringFailed(e) => format!("authoring failed: {e}"),
        BacktestRunErrorV1::RoleIntentPublicationFailed(e) => {
            format!("role intent publication failed: {e}")
        }
        BacktestRunErrorV1::StrategyInputBindingFailed(e) => {
            format!("strategy input binding failed: {e:?}")
        }
        BacktestRunErrorV1::FreezeFailed(e) => format!("freeze failed: {e}"),
    }
}
