//! The ordered chain's proof that `backtest.run`'s orchestration is driven, not merely structured:
//! this entry runs it from a catalogued strategy through authoring, role binding and freeze, all
//! the way to a real custody-run execution-input binding (H8), over a real sealed-acceptance
//! custody chain.
//!
//! Placed after F in the chain, so F's already-admitted perpetual (its Source Binding, Instrument
//! Master fact and historical membership) is this entry's precondition, not something it repeats.
//! F is the chain's only producer of that fixture; this entry only reads the state it left.
//!
//! The custody chain itself is committed fresh by this entry
//! (`commit_sealed_acceptance_custody_chain_v1`, #1348), over the SAME canonical instrument F
//! already admitted, and named implicitly: `run_backtest_v1` resolves it itself from the
//! dataset_ref's instrument, execution timeframe and window (`resolve_custody_run_v1`, #1400) -
//! whether that chain's own Universe Selection turns out to be the same record the Design's
//! role-binding (H4) resolves is exactly the open question this entry answers empirically: if it
//! is not, `run_backtest_v1` refuses by name (`CUSTODY_RUN_UNIVERSE_DIFFERS_FROM_DESIGN`), and the
//! right answer is Lane 3's ruling, not a softer assertion here.

use std::sync::Arc;

use vibe_data::owner::{
    grant_pit_window_custody_acceptance_reads_v1,
    instrument_economic_terms_postgres_owner_from_environment_v1,
    instrument_master_v2_postgres_owner_from_environment,
    market_semantics_admission_v1::market_semantics_admission_from_environment_v1,
    pit_market_snapshot_intake_v1::pit_market_snapshot_intake_from_environment_v1,
    pit_window_custody_frames_for_sealed_acceptance_v1,
    pit_window_custody_v1::sealed_acceptance_chain::{
        SealedAcceptanceBarV1, SealedAcceptanceCustodyChainSpecV1, SealedAcceptanceDecimalV1,
        SealedAcceptanceOhlcvV1, SealedAcceptanceTimeframeV1,
        commit_sealed_acceptance_custody_chain_v1,
    },
    revoke_pit_window_custody_acceptance_reads_v1,
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
    source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2,
    strategy_catalog_postgres_v1::PostgresStrategyCatalogV1,
    strategy_catalog_v1::{
        SingleThresholdStrategySpecV1, StrategyIdentityV1, StrategyStatementV1,
        canonical_strategy_statement_v1,
    },
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::backtest_run_v1::{
    BacktestRunErrorV1, BacktestRunOwnersV1, BacktestRunReplayUnavailableV1, BacktestRunRequestV1,
    run_backtest_v1,
};
use crate::first_composer_v3_replay_acceptance::{PERPETUAL_V1, UniverseMemberDailyBarsV1};

const SECOND_NS: u64 = 1_000_000_000;
const MINUTE_NS: u64 = 60 * SECOND_NS;
const DAY_NS: u64 = 24 * 60 * MINUTE_NS;
/// Daily frames, enough that a short-window run comfortably sits inside the TrialFamily's sealed
/// Replay policy window; this entry never executes bars, so it needs no warm-up length.
const CUSTODY_FRAMES: u64 = 5;
const CUSTODY_LAG_NS: u64 = 2 * MINUTE_NS;
/// The harness's own disposable-database reader role, granted the sealed custody reads this
/// entry needs and nothing else; revoked again once the entry finishes.
const SEALED_ACCEPTANCE_READER_PRINCIPAL: &str = "vibe_test_role_market_data_reader";

fn chain_entry_decimal(text: &str) -> SealedAcceptanceDecimalV1 {
    SealedAcceptanceDecimalV1::parse(text).expect("a decimal")
}

/// One daily bar on the perpetual's own tick, at `open_ns`.
fn chain_entry_bar(open_ns: u64) -> SealedAcceptanceBarV1 {
    SealedAcceptanceBarV1 {
        open_ns,
        members: vec![SealedAcceptanceOhlcvV1 {
            open: chain_entry_decimal("65000.1"),
            high: chain_entry_decimal("65400.0"),
            low: chain_entry_decimal("64800.5"),
            close: chain_entry_decimal("65210.3"),
            volume: chain_entry_decimal("1234"),
        }],
    }
}

/// The first UTC day boundary at or after `effective_ns` - F's own perpetual admits its economic
/// terms at Market Data's current decision cut (that instant), so the chain's own window must
/// start no earlier than it, and the sealed Replay policy window (`[1, 2^63)`) separately refuses
/// a start of zero outright. Starting the chain itself a day after this boundary, with the run
/// window then starting a further day in (`chain_entry_run_window`), keeps every bar's open and
/// close inside both.
const fn chain_entry_start(effective_ns: u64) -> u64 {
    (effective_ns / DAY_NS + 1) * DAY_NS
}

/// The custody chain's own window, `[start, end)` in nanoseconds - `CUSTODY_FRAMES` daily bars
/// from [`chain_entry_start`], plus its warm-up day.
const fn chain_entry_window(start: u64) -> (u64, u64) {
    (start, start + (CUSTODY_FRAMES + 1) * DAY_NS)
}

/// The run's own requested window: the first frame's own instant (`e_1`, the execution bundle
/// requires the request window's start to equal it) through the chain's own end.
const fn chain_entry_run_window(start: u64) -> (u64, u64) {
    (start + DAY_NS, start + (CUSTODY_FRAMES + 1) * DAY_NS)
}

/// A real sealed-acceptance custody chain over the same perpetual F already admitted, anchored at
/// `start` (see [`chain_entry_start`]): `CUSTODY_FRAMES` daily execution bars, with a one-minute
/// fill timeframe and a two-minute lag, matching the custody intake's own requirements.
fn chain_entry_spec_v1(start: u64) -> SealedAcceptanceCustodyChainSpecV1 {
    let fill_open = |event_ns: u64| event_ns + CUSTODY_LAG_NS + MINUTE_NS;
    SealedAcceptanceCustodyChainSpecV1 {
        members: vec![PERPETUAL_V1.to_owned()],
        execution_timeframe: SealedAcceptanceTimeframeV1 {
            label: "24H".to_owned(),
            interval_seconds: 86_400,
            bars: (0..CUSTODY_FRAMES)
                .map(|day| chain_entry_bar(start + day * DAY_NS))
                .collect(),
        },
        fill_timeframe: SealedAcceptanceTimeframeV1 {
            label: "1M".to_owned(),
            interval_seconds: 60,
            bars: (1..=CUSTODY_FRAMES)
                .map(|day| chain_entry_bar(fill_open(start + day * DAY_NS)))
                .collect(),
        },
        lag_ns: CUSTODY_LAG_NS,
        instrument_increments: None,
        market_semantics_value: None,
    }
}

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

    // F admits the perpetual's economic terms at Market Data's current decision cut; the
    // custody chain's own window must start no earlier than that instant, so this entry anchors
    // it on the next UTC day boundary after it.
    let effective_ns =
        pit_market_snapshot_intake_from_environment_v1(Arc::new(UniverseMemberDailyBarsV1))
            .await
            .expect("Market Data's PIT intake opens")
            .current_decision_cut()
            .await
            .expect("Market Data states its decision cut")
            .decision_cut
            .as_epoch_nanos();
    let chain_start_ns = chain_entry_start(effective_ns);

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
    let single_threshold = canonical_strategy_statement_v1(&StrategyStatementV1::SingleThreshold(
        Box::new(backtest_run_chain_entry_spec_v1()),
    ))
    .expect("the chain entry's own statement authors into a program");
    let authored = canonical_strategy_statement_v1(&StrategyStatementV1::Authored(
        serde_json::from_str(include_str!(
            "../../strategy_factory/test_data/strategy_authoring_v1/t0-daily-trend.json"
        ))
        .expect("T0's document decodes"),
    ))
    .expect("T0's document authors into a program");
    let strategy_id = single_threshold.identity();

    for canonical in [&single_threshold, &authored] {
        catalog
            .create(canonical)
            .await
            .expect("the chain entry's strategies are new to this chain database");
    }

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
        custody_frames: Some(
            pit_window_custody_frames_for_sealed_acceptance_v1(
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
            )
            .expect("the sealed-acceptance custody frames port opens"),
        ),
        #[cfg(feature = "composer-v3-replay")]
        develop_composer: Some(Arc::new(
            PostgresSourceResearchComposerProductionV2::connect(
                rd_url,
                test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
            )
            .await
            .expect("the production Composer opens"),
        )),
        #[cfg(feature = "composer-v3-replay")]
        instrument_master_v2: Some(Arc::new(
            instrument_master_v2_postgres_owner_from_environment()
                .await
                .expect("the Instrument Master V2 Owner opens"),
        )),
        #[cfg(feature = "composer-v3-replay")]
        instrument_economic_terms: Some(Arc::new(
            instrument_economic_terms_postgres_owner_from_environment_v1()
                .await
                .expect("the Instrument Economic Terms Owner opens"),
        )),
    };

    let market_data_owner_url =
        test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner);
    grant_pit_window_custody_acceptance_reads_v1(
        market_data_owner_url,
        SEALED_ACCEPTANCE_READER_PRINCIPAL,
    )
    .await
    .expect("the harness reader role is granted the sealed custody reads it needs");

    let chain = commit_sealed_acceptance_custody_chain_v1(
        market_data_owner_url,
        &chain_entry_spec_v1(chain_start_ns),
    )
    .await
    .expect("the sealed-acceptance custody chain commits over the production intakes");
    assert_eq!(
        chain.window(),
        chain_entry_window(chain_start_ns),
        "the committed chain's own window is the one this entry anchored it at"
    );
    let (window_start_ns, window_end_ns_exclusive) = chain_entry_run_window(chain_start_ns);
    assert!(
        window_start_ns >= effective_ns,
        "the run window starts no earlier than the terms' own effective instant: {window_start_ns} \
         < {effective_ns}"
    );

    // Both statement families run through the one orchestration: each is authored by its own
    // family into the Design the freeze takes.
    for (run_id, strategy_id) in [
        ("backtest-run-chain-entry-v1", strategy_id),
        (
            "backtest-run-chain-entry-authored-t0-v1",
            authored.identity(),
        ),
    ] {
        assert_run_reaches_the_replay_step_v1(
            &owners,
            run_id,
            strategy_id,
            &deployment.request_proof_digest,
            window_start_ns,
            window_end_ns_exclusive,
        )
        .await;
    }

    revoke_pit_window_custody_acceptance_reads_v1(
        market_data_owner_url,
        SEALED_ACCEPTANCE_READER_PRINCIPAL,
    )
    .await
    .expect("the harness reader role's sealed custody grant is revoked");

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

async fn assert_run_reaches_the_replay_step_v1(
    owners: &BacktestRunOwnersV1,
    run_id: &str,
    strategy_id: StrategyIdentityV1,
    request_proof_digest: &str,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) {
    let request = BacktestRunRequestV1 {
        run_id: run_id.to_owned(),
        strategy_id,
        dataset_ref: BacktestRunDatasetRefV1::new(
            PERPETUAL_V1.to_owned(),
            "1d".to_owned(),
            window_start_ns,
            window_end_ns_exclusive,
        )
        .expect("the chain entry's dataset_ref is well-formed"),
        request_proof_digest: request_proof_digest.to_owned(),
    };

    match run_backtest_v1(owners, request).await {
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
            // This entire file compiles only under `sealed-source-intake-composer-acceptance`,
            // which requires `composer-v3-replay` - `custody_binding` always exists here.
            assert!(
                reached.custody_binding.is_some(),
                "backtest.run {run_id} must issue a real custody-run execution-input binding \
                 (H8) over a committed custody chain naming the Design's own instrument: {:?}",
                describe_replay_reason(&reached.reason),
            );
        }
        Err(e) => panic!(
            "backtest.run {run_id} must reach the replay step: {}",
            describe_error(&e)
        ),
    }
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
    strategy_id: StrategyIdentityV1,
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
        // This entry's fixture binds a PIT snapshot, not a custody run, so the orchestration
        // never reaches the custody frames step; the asserted refusal is CustodyFramesNotAvailable
        // regardless of this value.
        custody_frames: None,
        #[cfg(feature = "composer-v3-replay")]
        develop_composer: None,
        #[cfg(feature = "composer-v3-replay")]
        instrument_master_v2: None,
        #[cfg(feature = "composer-v3-replay")]
        instrument_economic_terms: None,
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
        #[cfg(not(feature = "composer-v3-replay"))]
        BacktestRunReplayUnavailableV1::FramesResolvedNoConsumerYet(frames) => {
            format!("frames resolved, no consumer yet: {frames:?}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerNotAvailable => "composer not available".to_owned(),
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerBuildUnavailable(e) => {
            format!("composer build unavailable: {e}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerBuildRefused(disposition) => {
            format!("composer build refused: {disposition:?}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ComposerArtifactLocatorUnavailable(e) => {
            format!("composer artifact locator unavailable: {e}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::TrialFamilyUnavailable => {
            "trial family unavailable".to_owned()
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayAdmissionFailed(e) => {
            format!("replay admission failed: {e}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayCommitFailed(e) => {
            format!("replay commit failed: {e}")
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::ReplayCommitted(result) => {
            format!("replay committed: {:?}", result.locator())
        }
        #[cfg(feature = "composer-v3-replay")]
        BacktestRunReplayUnavailableV1::CustodyIssuanceFailed(e) => {
            format!("custody issuance failed: {e}")
        }
    }
}

fn describe_error(error: &BacktestRunErrorV1) -> String {
    match error {
        BacktestRunErrorV1::ExecutionTimeframeUndeclared => {
            "execution timeframe undeclared".to_owned()
        }
        BacktestRunErrorV1::CustodyCoverageRefused(refusal) => {
            format!("custody coverage refused: {refusal}")
        }
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
