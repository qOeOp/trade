//! What the ordered chain proves about the first COMPOSER_V3 Replay once the prefix, in the same
//! entry, has committed it: that R&D's own universe Design produced it, that the production
//! execution preparation runs it as the one-member, one-frame universe it is, and that the report
//! states it.
//!
//! Each step says what it rules out. A green here before the universe sample projection is attached
//! in production is a false green: until then the host refuses a coordinate Plan's frame as
//! `InputCoverage`, so a run that succeeds did not run the R&D-authored universe Design.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Request;
use rust_decimal::Decimal;
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
use vibe_model::data::Data;
use vibe_model::instruments::Instrument as _;
use vibe_postgres_connect::PgPoolOptionsExt as _;
use vibe_strategy_factory::{
    TrialFamilyAttemptCountV2,
    backtest_run_report_read_v1::{BacktestRunReportStateV1, resolve_backtest_run_report_v1},
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
    FIRST_COMPOSER_V3_TARGET_UNITS_V1, FirstComposerV3ReplayV1,
};
use crate::first_composer_v3_replay_oracle::{FillOracleInputsV1, fill_oracle_v1};
use crate::native_replay_scheduling_acceptance::composed_native_replay_scheduling_resolver;

/// The one attempt the body runs the Replay under. A second run of the same request and attempt
/// is an exact replay, which joins the committed Result rather than making another.
const FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1: &str = "f-first-composer-v3-replay-attempt-1";

pub(crate) async fn assert_the_first_composer_v3_replay_runs_as_its_universe_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    replay: &FirstComposerV3ReplayV1,
) {
    let rd_pool = sqlx::postgres::PgPoolOptions::new()
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
            vibe_postgres_connect::PostgresTls::Disabled,
        )
        .await
        .expect("the R&D Owner pool");

    assert_the_design_is_rd_authored_over_universe_members(&rd_pool, replay).await;
    // Store Admission (`B3`) admits no scheduling resolver in any deployment, so this entry
    // composes the sealed acceptance one and passes it where production passes its own.
    let scheduling = composed_native_replay_scheduling_resolver(test_database).await;
    let owners = production_execution_owners(test_database, scheduling.resolver()).await;
    let oracle_inputs =
        assert_the_production_preparation_executes_one_member_one_frame(&owners, replay).await;
    let uncounted = read_trial_family_census(&rd_pool, &replay.trial_family_identity).await;
    let result_identity = run_over_http(test_database, &owners, replay).await;
    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &result_identity,
        request_identity: &replay.replay_request.request_identity,
        attempt_identity: FIRST_COMPOSER_V3_REPLAY_ATTEMPT_V1,
    };
    // The route answers only once the census counts the Result, and the report refuses an
    // uncounted one; the census is read before the report so the order is stated, not implied.
    let counted = read_trial_family_census(&rd_pool, &replay.trial_family_identity).await;
    assert_the_census_counts_the_run_once(&uncounted, &counted, &result_identity);
    assert_the_report_states_the_run(&rd_pool, locator, replay, oracle_inputs).await;
    assert_an_exact_replay_joins_and_changes_nothing(
        test_database,
        &rd_pool,
        &owners,
        locator,
        replay,
        &counted,
    )
    .await;
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
) -> FillOracleInputsV1 {
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
    oracle_inputs_from_the_bundle(&bundle)
}

/// The fill oracle's inputs, read from the bundle the engine runs rather than restated: the
/// Quote's bid and ask, the instrument's multiplier and size increment, the Owner's taker fee, and
/// the venue's starting balance. Only the target's grid units come from the prefix's authoring.
fn oracle_inputs_from_the_bundle(
    bundle: &vibe_strategy_factory::replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
) -> FillOracleInputsV1 {
    let [instrument] = bundle.instruments_for_acceptance() else {
        panic!("F's bundle runs exactly one instrument");
    };
    let quote = bundle
        .native_data_for_acceptance()
        .iter()
        .find_map(|datum| match datum {
            Data::Quote(quote) => Some(quote),
            _ => None,
        })
        .expect("F's bundle carries the frame's Quote");
    let taker = bundle.census().instrument_terms()[0].taker_fee();
    let starting_balance = bundle
        .starting_balance_for_acceptance()
        .expect("the venue starts with one balance");
    FillOracleInputsV1 {
        bid: quote.bid_price.as_decimal(),
        ask: quote.ask_price.as_decimal(),
        quantity: Decimal::from(FIRST_COMPOSER_V3_TARGET_UNITS_V1)
            * instrument.size_increment().as_decimal(),
        multiplier: instrument.multiplier().as_decimal(),
        taker_fee: Decimal::from_i128_with_scale(taker.mantissa, u32::from(taker.scale)),
        starting_balance: starting_balance.as_decimal(),
        currency_precision: u32::from(starting_balance.currency.precision),
    }
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
    oracle_inputs: FillOracleInputsV1,
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
    let result = &report.result;
    assert_eq!(result.state, BacktestRunReportStateV1::Available);
    assert_eq!(result.series.len(), 1, "one frame records one point");
    assert_eq!((result.fill_count, result.fills.len()), (1, 1), "one fill");
    let fill = &result.fills[0];
    // The fill is at the quote cut's instant, after the frame's decision. The frame is a daily
    // bar closed at midnight UTC, so a fill at an instant whose `% 86_400_000_000_000` is zero
    // would be the bar's own close: the run would have traded on the bar it decided from.
    assert!(
        !fill.at.ends_with("T00:00:00.000000000Z"),
        "the fill falls after the frame's close, not on it: {}",
        fill.at
    );
    assert_eq!(fill.side, "BUY");
    assert_eq!(
        Decimal::from_str_exact(&fill.price).expect("a canonical fill price"),
        oracle_inputs.ask,
        "the marketable limit fills at the Quote's ask"
    );
    assert_eq!(
        Decimal::from_str_exact(&fill.quantity).expect("a canonical fill quantity"),
        oracle_inputs.quantity,
    );
    let oracle = fill_oracle_v1(oracle_inputs)
        .unwrap_or_else(|e| panic!("the oracle states the fill: {e:?}"));
    // The point is the engine's f64: equity_day / equity_before - 1, with each equity read as
    // Money::as_f64 (correctly rounded, so error <= u = 2^-53 each), one f64 division (<= u) and
    // one subtraction that is exact by Sterbenz. Its relative error is bounded by
    // (1 + u)^2 / (1 - u) - 1, about 3u, and the oracle widens it by Decimal slack only.
    oracle
        .admits_point(result.series[0].value)
        .unwrap_or_else(|e| {
            panic!("the report's point is the oracle's within its derived bound: {e:?}")
        });
}

/// The TrialFamily census rows the Replay's Result is counted in, read from canonical storage in a
/// transaction that is rolled back.
#[derive(Debug, PartialEq)]
struct TrialFamilyCensusReadV1 {
    schema_version: i64,
    consumed_trial_budget: i64,
    head: (String, String, Vec<u8>),
    members: Vec<(i32, serde_json::Value, Vec<u8>)>,
    attempt_cuts: Vec<(i32, serde_json::Value, Vec<u8>)>,
}

async fn read_trial_family_census(rd_pool: &PgPool, family: &str) -> TrialFamilyCensusReadV1 {
    let mut transaction = rd_pool.begin().await.expect("an R&D transaction");
    let (frontier_identity, frontier_digest, frontier_bytes, frontier_json): (
        String,
        String,
        Vec<u8>,
        String,
    ) = sqlx::query_as(
        "SELECT frontier_identity, frontier_digest, frontier_storage_bytes, frontier_json::text
           FROM rd_trial_family_heads_v1 WHERE trial_family_identity=$1",
    )
    .bind(family)
    .fetch_one(&mut *transaction)
    .await
    .expect("the family has one census head");
    let frontier: serde_json::Value =
        serde_json::from_str(&frontier_json).expect("the census head is JSON");
    let members: Vec<(i32, String, Vec<u8>)> = sqlx::query_as(
        "SELECT ordinal, member_json::text, member_storage_bytes
           FROM rd_trial_family_members_v1 WHERE trial_family_identity=$1 ORDER BY ordinal",
    )
    .bind(family)
    .fetch_all(&mut *transaction)
    .await
    .expect("the family's census members");
    let attempt_cuts: Vec<(i32, String, Vec<u8>)> = sqlx::query_as(
        "SELECT attempt_ordinal, attempt_frontier_json::text, attempt_frontier_storage_bytes
           FROM rd_trial_family_attempt_cuts_v2 WHERE trial_family_identity=$1
          ORDER BY attempt_ordinal",
    )
    .bind(family)
    .fetch_all(&mut *transaction)
    .await
    .expect("the family's attempt cuts");
    transaction
        .rollback()
        .await
        .expect("the read writes nothing");
    let json = |text: String| serde_json::from_str(&text).expect("canonical census JSON");
    TrialFamilyCensusReadV1 {
        schema_version: frontier["schema_version"]
            .as_i64()
            .expect("a schema version"),
        consumed_trial_budget: frontier["consumed_trial_budget"]
            .as_i64()
            .expect("a consumed trial budget"),
        head: (frontier_identity, frontier_digest, frontier_bytes),
        members: members
            .into_iter()
            .map(|(ordinal, member, bytes)| (ordinal, json(member), bytes))
            .collect(),
        attempt_cuts: attempt_cuts
            .into_iter()
            .map(|(ordinal, frontier, bytes)| (ordinal, json(frontier), bytes))
            .collect(),
    }
}

fn terminal_member_count(census: &TrialFamilyCensusReadV1) -> usize {
    census.attempt_cuts.last().map_or(0, |(_, frontier, _)| {
        frontier["terminal_member_digests"]
            .as_array()
            .expect("an attempt frontier names its terminal members")
            .len()
    })
}

/// The run is counted once: the census moves from schema 1 to 2, gains the Request and Result
/// members, records one terminal member, and its latest member names this Result as a terminal
/// result. Counting does not consume trial budget the formation already consumed.
fn assert_the_census_counts_the_run_once(
    uncounted: &TrialFamilyCensusReadV1,
    counted: &TrialFamilyCensusReadV1,
    result_identity: &str,
) {
    assert_eq!(
        (uncounted.schema_version, counted.schema_version),
        (1, 2),
        "census schema before -> after"
    );
    assert_eq!(
        (uncounted.members.len(), counted.members.len()),
        (1, 3),
        "census members before -> after: the Intent, then its Request and Result"
    );
    assert_eq!(
        (
            terminal_member_count(uncounted),
            terminal_member_count(counted)
        ),
        (0, 1),
        "terminal members before -> after"
    );
    assert_eq!(
        (
            uncounted.consumed_trial_budget,
            counted.consumed_trial_budget
        ),
        (1, 1),
        "consumed trial budget before -> after"
    );
    let (_, latest, _) = counted.members.last().expect("a latest member");
    assert_eq!(
        (
            latest["member_kind"].as_str(),
            latest["fact_identity"].as_str(),
            latest["terminal_disposition"].as_str(),
        ),
        (
            Some("RESULT"),
            Some(result_identity),
            Some("TERMINAL_RESULT")
        ),
        "the latest member names this Result as a terminal result"
    );
}

/// Counting the same Result again is an exact replay: the census answers Joined and keeps every
/// stored byte. The positive control is that Backtest holds exactly one Result for the request,
/// so Joined is an answer about that one Result rather than about an empty store.
async fn assert_an_exact_replay_joins_and_changes_nothing(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    rd_pool: &PgPool,
    owners: &ProductionExecutionOwnersV1,
    locator: ExploratoryReplayResultLocatorV2<'_>,
    replay: &FirstComposerV3ReplayV1,
    counted: &TrialFamilyCensusReadV1,
) {
    let count = owners
        .research
        .count_exploratory_replay_result_v2(locator)
        .await
        .expect("the census counts the Result again");
    assert_eq!(count, TrialFamilyAttemptCountV2::Joined);
    assert_eq!(
        &read_trial_family_census(rd_pool, &replay.trial_family_identity).await,
        counted,
        "an exact replay changes no census byte"
    );
    let backtest = sqlx::postgres::PgPoolOptions::new()
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::BacktestOwner),
            vibe_postgres_connect::PostgresTls::Disabled,
        )
        .await
        .expect("the Backtest Owner pool");
    let results: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.count(*) FROM public.backtest_replay_results_v2 WHERE request_identity=$1",
    )
    .bind(&replay.replay_request.request_identity)
    .fetch_one(&backtest)
    .await
    .expect("Backtest answers how many Results the request has");
    assert_eq!(
        results, 1,
        "Backtest holds exactly one Result for the request"
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
