//! What the ordered chain proves about the first COMPOSER_V3 Replay once the prefix has committed
//! it: that R&D's own universe Design produced it, that the production execution preparation runs
//! it as the one-member, one-frame universe it is, and that the report states it.
//!
//! The rest of the body needs this crate's view inside the claim read, which the report and the
//! locking readback each open their own transaction for: the lock-free read holding no row lock,
//! and each stored change to the claim refused by name inside the transaction that made it. That
//! half is `the_first_composer_v3_claim_reads_without_a_lock_and_refuses_each_stored_change_by_name`
//! in `vibe-strategy-factory`, the chain entry after this one.
//!
//! Each step says what it rules out. A green here before the universe sample projection is attached
//! in production is a false green: until then the host refuses a coordinate Plan's frame as
//! `InputCoverage`, so a run that succeeds did not run the R&D-authored universe Design.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Request;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use vibe_backtest_owner_contracts::{OpaqueIdentityV2, ReplayResultDtoV2};
use vibe_backtest_result_custody::ExploratoryReplayResultLocatorV2;
use vibe_data::owner::{
    UniverseSampleProjectionOwnerV1, instrument_economic_terms_postgres_owner_from_environment_v1,
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    instrument_master_v2_postgres_owner_from_environment,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    universe_sample_projection_owner_from_environment_v1,
};
use vibe_strategy_factory::{
    backtest_run_report_read_v1::resolve_backtest_run_report_v1,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    native_replay_execution_preparation_resolver_v2::PostgresNativeReplayExecutionPreparationResolverV2,
    native_replay_preparation_owner_v2::NativeReplayExecutionPreparationResolverV2,
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    source_research_composer_postgres_v2::SealedPostgresSourceResearchComposerV2,
    strategy_design_v2::{InputScopeV2, StrategyDesignV2},
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::exploratory_replay::{NativeReplayExecutionServiceV2, execution_router};
use crate::first_composer_v3_replay_acceptance::{
    FIRST_COMPOSER_V3_REPLAY_FIXTURE_KEY_V1, FirstComposerV3ReplayV1,
    ensure_first_composer_v3_replay_acceptance_v1,
};
use crate::native_replay_scheduling_acceptance::composed_native_replay_scheduling_resolver;

/// The one attempt the body runs the Replay under. A second run of the same request and attempt
/// is an exact replay, which joins the committed Result rather than making another.
const FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1: &str = "f-first-composer-v3-replay-attempt-1";

pub(crate) async fn assert_the_first_composer_v3_replay_runs_as_its_universe_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
) {
    let replay = ensure_first_composer_v3_replay_acceptance_v1(
        test_database,
        FIRST_COMPOSER_V3_REPLAY_FIXTURE_KEY_V1,
    )
    .await;
    // A second call that created is a statement about the prefix entry: it did not run, or it
    // committed under another key, and every step below would then prove a Replay this entry made.
    assert!(
        !replay.created,
        "the body joins the Replay the prefix committed; it created one, so the prefix did not run"
    );
    let rd_pool = PgPool::connect(test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .expect("the R&D Owner pool");

    assert_the_design_is_rd_authored_over_universe_members(&rd_pool, &replay).await;
    // Store Admission (`B3`) admits no scheduling resolver in any deployment, so this entry
    // composes the sealed acceptance one and passes it where production passes its own.
    let scheduling = composed_native_replay_scheduling_resolver(test_database).await;
    let owners = production_execution_owners(test_database, scheduling.resolver()).await;
    assert_the_production_preparation_executes_one_member_one_frame(&owners, &replay).await;
    let result_identity = run_over_http(test_database, &owners, &replay).await;
    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &result_identity,
        request_identity: &replay.replay_request.request_identity,
        attempt_identity: FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1,
    };
    assert_the_report_states_the_run(&rd_pool, locator, &replay).await;
    scheduling.revoke().await;
}

/// G5b, on the production registration chain rather than on an oracle-built Design.
///
/// Every input of the frozen Design is over universe members, and the Composer ran it: the exact
/// branch of `design_input_custody_v1` refuses a universe Design by name, so a Plan exists for this
/// Design only if its custody was read through the UNIVERSE branch.
async fn assert_the_design_is_rd_authored_over_universe_members(
    rd_pool: &PgPool,
    replay: &FirstComposerV3ReplayV1,
) {
    let (design_identity, design_bytes): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT design_identity, design_bytes
           FROM public.rd_bounded_feature_program_freezes_v1
          WHERE request_identity=$1",
    )
    .bind(&replay.research_request_identity)
    .fetch_one(rd_pool)
    .await
    .expect("the Research request the Replay names froze one Design");
    assert_eq!(design_identity, replay.design_identity.as_bytes());
    let design: StrategyDesignV2 =
        serde_json::from_slice(&design_bytes).expect("the stored Design bytes are canonical");
    assert!(
        !design.inputs.is_empty(),
        "a Design with no inputs is not the one F runs"
    );
    assert!(
        design
            .inputs
            .iter()
            .all(|input| input.scope == InputScopeV2::UniverseMembers),
        "every input of the Design F runs is over universe members: {:?}",
        design.inputs,
    );
}

/// The consumer, driven through the production execution preparation, not a test-only path.
///
/// It is the check that the Replay is the one-member universe it claims to be. A bundle in the
/// first corpus's two-member layout would pass every digest comparison that does not count members.
async fn assert_the_production_preparation_executes_one_member_one_frame(
    owners: &ProductionExecutionOwnersV1,
    replay: &FirstComposerV3ReplayV1,
) {
    let resolver = PostgresNativeReplayExecutionPreparationResolverV2::new(
        owners.research.clone(),
        owners.composer.clone(),
        owners.instrument_master.clone(),
        owners.instrument_terms.clone(),
        owners.market_data.clone(),
        owners.sample_projections.clone(),
    );
    let attempt = OpaqueIdentityV2::try_from(FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1.to_owned())
        .expect("the body's attempt identity is opaque");
    let preparation = resolver
        .resolve_native_replay_execution_preparation_v2(&replay.replay_request, &attempt)
        .await
        .expect("the production preparation resolves the Replay the prefix committed");
    let (_request, bundle, _observations, _trace, _seed, _instance) = preparation.into_parts();
    let census = bundle.census();

    assert_eq!(bundle.request_locator(), &replay.replay_request);
    assert_eq!(
        census.canonical_plan_digest(),
        *replay.plan_canonical_digest.as_bytes()
    );
    // One frame: the V2 input binding needs at least two, so F's single frame runs through
    // `new_from_single_frame_v1`, and a frame width of 400 bytes is not observable here.
    assert_eq!(bundle.frame_count(), 1);
    assert_eq!(
        census.member_instruments(),
        std::slice::from_ref(&replay.member_instrument)
    );
    assert_eq!(census.instrument_terms().len(), 1);
    assert_eq!(
        census.instrument_terms()[0].instrument_identity(),
        replay.member_instrument
    );
    // One BAR and one Quote per frame.
    assert_eq!(census.bar_count(), bundle.frame_count());
    assert_eq!(census.event_count(), bundle.frame_count());
    assert_eq!(census.scheduling_data_count(), 2 * bundle.frame_count());
}

/// Runs the Replay through `/v2/exploratory-replays`, the one production route that drives the
/// consumer, and returns the identity of the result it committed.
async fn run_over_http(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    owners: &ProductionExecutionOwnersV1,
    replay: &FirstComposerV3ReplayV1,
) -> String {
    let token = "rd-owner-api-first-composer-v3-replay";
    let service = NativeReplayExecutionServiceV2::connect(
        test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        test_database.database_url(CanonicalOwnerTestRoleV1::BacktestOwner),
        owners.research.clone(),
        owners.composer.clone(),
        owners.instrument_master.clone(),
        owners.instrument_terms.clone(),
        owners.market_data.clone(),
        owners.sample_projections.clone(),
    )
    .await
    .expect("the production execution service opens");
    let token_digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let response = execution_router(Some(Arc::new(service)), token_digest)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v2/exploratory-replays")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "request_locator": replay.replay_request,
                        "attempt_identity": FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1,
                    })
                    .to_string(),
                ))
                .expect("the run request"),
        )
        .await
        .expect("the execution router answers");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("the run's answer is read");
    assert_eq!(
        status,
        axum::http::StatusCode::OK,
        "the run commits and counts its Result: {}",
        String::from_utf8_lossy(&bytes)
    );
    // The route answers a committed and counted Result with its canonical bytes, and nothing else.
    let result = ReplayResultDtoV2::from_canonical_bytes(&bytes)
        .expect("the run answers with the Result's canonical bytes");
    assert_eq!(
        result.request_identity.as_str(),
        replay.replay_request.request_identity
    );
    assert_eq!(
        result.attempt_identity.as_str(),
        FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1
    );
    result.result_identity.as_str().to_owned()
}

/// The report states the run through its COMPOSER_V3 branch, the lock-free self-verified claim
/// read; without the Composer-backed Replay feature it would refuse the request as not yet
/// reported, so an answer here is the branch this entry exists to drive.
///
/// The Design is the single-threshold family's universe-member form, so the report also has to
/// state a channel whose instrument the run's universe selected. Until it reads that selection it
/// refuses the form as `UniverseMemberNotYetReported`, and this step waits for the report to take
/// the selection's one member.
async fn assert_the_report_states_the_run(
    rd_pool: &PgPool,
    locator: ExploratoryReplayResultLocatorV2<'_>,
    replay: &FirstComposerV3ReplayV1,
) {
    let report = resolve_backtest_run_report_v1(rd_pool, locator)
        .await
        .expect("the report answers for the first COMPOSER_V3 run")
        .expect("the run the route committed is there to report");
    assert_eq!(
        report.run.request_identity,
        replay.replay_request.request_identity
    );
    assert_eq!(
        report.run.attempt_identity,
        FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1
    );
}

/// The Owners the production execution preparation reads, opened the way `main` opens them.
struct ProductionExecutionOwnersV1 {
    research: Arc<PostgresResearchGoalOwnerV1>,
    composer: Arc<dyn DevelopComposerSealedReadPortV2>,
    instrument_master: Arc<InstrumentMasterV2PostgresOwner>,
    instrument_terms: Arc<InstrumentEconomicTermsPostgresOwnerV1>,
    market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
    sample_projections: Arc<UniverseSampleProjectionOwnerV1>,
}

/// Opens each Owner through the constructor `main` calls, over this chain's canonical roles.
///
/// The Market Data and Instrument Owners are opened only from their environment, so the
/// environment is pointed at this database first, as `composed_market_data_binding_admission`
/// does for the binding admission.
async fn production_execution_owners(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
) -> ProductionExecutionOwnersV1 {
    // SAFETY: nextest runs each test in its own process, so nothing reads the environment
    // concurrently.
    unsafe {
        std::env::set_var(
            "MARKET_DATA_OWNER_DATABASE_URL",
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
        );
    }
    // SAFETY: as above.
    unsafe {
        std::env::set_var(
            "INSTRUMENT_OWNER_DATABASE_URL",
            test_database.database_url(CanonicalOwnerTestRoleV1::InstrumentOwner),
        );
    }
    let research = PostgresResearchGoalOwnerV1::connect(
        test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
    )
    .await
    .expect("the Research Owner opens")
    .bind_sealed_source_intake_research_policy();
    let composer: Arc<dyn DevelopComposerSealedReadPortV2> = Arc::new(
        SealedPostgresSourceResearchComposerV2::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
        )
        .await
        .expect("the Composer opens against its two R&D roles"),
    );
    ProductionExecutionOwnersV1 {
        research: Arc::new(research),
        composer,
        instrument_master: Arc::new(
            instrument_master_v2_postgres_owner_from_environment()
                .await
                .expect("the Instrument Master V2 Owner opens"),
        ),
        instrument_terms: Arc::new(
            instrument_economic_terms_postgres_owner_from_environment_v1()
                .await
                .expect("the economic terms Owner opens"),
        ),
        sample_projections: Arc::new(
            universe_sample_projection_owner_from_environment_v1()
                .await
                .expect("the universe sample projection Owner opens"),
        ),
        market_data,
    }
}
