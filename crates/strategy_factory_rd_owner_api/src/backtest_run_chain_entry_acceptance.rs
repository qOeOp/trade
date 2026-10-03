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
    pit_market_snapshot_intake_v1::pit_market_snapshot_intake_from_environment_v1,
    pit_window_custody_v1::UntrustedPitWindowCustodyClaimV1, source_binding::BindingDigest,
    strategy_input_binding_admission_v1::strategy_input_binding_admission_from_environment_v1,
    universe_selection_admission_v1::universe_selection_admission_from_environment_v1,
};
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
    strategy_catalog_v1::{SingleThresholdStrategySpecV1, canonical_strategy_spec_v1},
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
    let canonical = canonical_strategy_spec_v1(&backtest_run_chain_entry_spec_v1())
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
