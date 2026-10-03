//! The production Instrument Master V2 contract-status delta intake, proven through production
//! paths only.
//!
//! The baseline comes through the baseline intake from the recorded `exchangeInfo` fixture, and the
//! clock head moves only through the Owner's own Source Binding admission. The events are built in
//! the shape the provider documents for its `!contractInfo` stream (developers.binance.com,
//! "Contract Info Stream"): no captured event exists in this repository, so none is claimed.

use std::future::Future;

use super::{
    MarketDataOwnerPostgres,
    instrument_master_admission_v2_tests::{
        FIRST_CUT, SECOND, USDM, commit_binding, d, facts, research_decision_cut, selection,
        submission,
    },
};
use crate::owner::{
    instrument_master_admission_v2::{
        InstrumentMasterStatusDeltaErrorV2, InstrumentMasterStatusDeltaSubmissionV2,
        InstrumentTermsBasisWireV2,
    },
    instrument_master_v2::{FactValue, InstrumentMasterCutRequestV2},
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
};

/// A `!contractInfo` event for `BTCUSDT` in the provider's documented shape, at `event_ns`, stating
/// `status`, with `edit` applied.
fn event(event_ns: u64, status: &str, edit: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut event = serde_json::json!({
        "e": "contractInfo",
        "E": event_ns / 1_000_000,
        "s": "BTCUSDT",
        "ct": "PERPETUAL",
        "dt": 4_133_404_800_000_u64,
        "ot": 1_569_398_400_000_u64,
        "cs": status,
        "bks": [{"bs": 1, "bnf": 0, "bnc": 5000, "mmr": 0.01, "cf": 0, "mi": 21, "ma": 50}],
        "st": 1
    });
    edit(&mut event);
    serde_json::to_string(&event).unwrap()
}

fn delta(
    predecessor: BindingDigest,
    retrieval_time_ns: u64,
    raw_payload: String,
    source_binding: &UntrustedSourceBindingLocator,
) -> InstrumentMasterStatusDeltaSubmissionV2 {
    InstrumentMasterStatusDeltaSubmissionV2 {
        predecessor_fact_identity: predecessor,
        retrieval_time_ns: i128::from(retrieval_time_ns),
        raw_payload,
        source_binding: source_binding.clone(),
    }
}

/// A status delta extends the instrument's V2 fact as its direct successor, through the production
/// clock; a cut issued after it resolves it and one issued before keeps the baseline; a second delta
/// extends the first, a replay rejoins even after that, and every refusal a submission can reach is
/// driven once and writes nothing.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[expect(
    clippy::too_many_lines,
    reason = "one store, one clock: each step depends on the chain and head the one before left"
)]
async fn postgres_a_status_delta_extends_the_v2_fact_and_the_cut_after_it_resolves_it() {
    use InstrumentMasterStatusDeltaErrorV2 as Refused;

    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes and alters one row it restores; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    let instruments = InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");

    // The baseline, through the baseline intake, observed at the second head.
    let usdm = commit_binding(&owner, "usdm/exchangeInfo", 1, FIRST_CUT).await;
    let second_cut = FIRST_CUT + 2 * SECOND;
    let other = commit_binding(&owner, "coinm/exchangeInfo", 2, second_cut).await;
    let baseline = owner
        .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", FIRST_CUT + SECOND, USDM))
        .await
        .expect("the baseline intake admits the recorded payload");
    let locator = usdm.receipt().locator();
    let event_ns = second_cut + SECOND;
    let retrieval = second_cut + 2 * SECOND;
    let settling = || {
        delta(
            baseline.fact_identity(),
            retrieval,
            event(event_ns, "SETTLING", |_| {}),
            locator,
        )
    };

    // 1. Received after the head: refused by name until the head passes the retrieval.
    let before_head = facts(&owner).await;
    assert_eq!(
        owner
            .admit_instrument_master_status_delta_v2(settling())
            .await,
        Err(Refused::RetrievalAfterOwnerClock)
    );
    assert_eq!(
        facts(&owner).await,
        before_head,
        "the refusal wrote nothing"
    );

    // 2. The head advances through a production Source Binding admission, and a cut issued now,
    //    before the delta, resolves the baseline.
    let third_cut = FIRST_CUT + 4 * SECOND;
    commit_binding(&owner, "usdm/exchangeInfo", 3, third_cut).await;
    assert_eq!(research_decision_cut(&owner).await, third_cut);
    let before = selection(&owner, &usdm, 60, third_cut).await;
    let before_request = InstrumentMasterCutRequestV2::new(d(61), third_cut);
    let resolved_before = instruments
        .issue_cut(before_request, &before)
        .await
        .expect("the cut resolves the baseline");
    assert_eq!(
        resolved_before.cut().members()[0].fact().identity(),
        baseline.fact_identity()
    );

    // 3. Every refusal a submission can reach, each writing nothing.
    let mut unbound = locator.clone();
    unbound.fact_digest = d(98);
    let with = |edit: fn(&mut serde_json::Value)| {
        delta(
            baseline.fact_identity(),
            retrieval,
            event(event_ns, "SETTLING", edit),
            locator,
        )
    };
    let refusals = [
        (
            "an unknown predecessor",
            delta(
                d(99),
                retrieval,
                event(event_ns, "SETTLING", |_| {}),
                locator,
            ),
            Refused::PredecessorUnknown,
        ),
        (
            "a locator no binding is admitted under",
            delta(
                baseline.fact_identity(),
                retrieval,
                event(event_ns, "SETTLING", |_| {}),
                &unbound,
            ),
            Refused::SourceBindingUnavailable,
        ),
        (
            "an admitted binding that is not the baseline's",
            delta(
                baseline.fact_identity(),
                retrieval,
                event(event_ns, "SETTLING", |_| {}),
                other.receipt().locator(),
            ),
            Refused::SourceBindingMismatch,
        ),
        (
            "text that is not an event",
            delta(
                baseline.fact_identity(),
                retrieval,
                "contractInfo".to_owned(),
                locator,
            ),
            Refused::InvalidEvent,
        ),
        (
            "an event for another symbol",
            with(|e| e["s"] = serde_json::json!("ETHUSDT")),
            Refused::EventSymbolMismatch,
        ),
        (
            "a delivery contract",
            with(|e| e["ct"] = serde_json::json!("CURRENT_QUARTER")),
            Refused::ContractTypeUnsupported,
        ),
        (
            "a COIN-M event",
            with(|e| e["st"] = serde_json::json!(2)),
            Refused::DatasetMismatch,
        ),
        (
            "an event later than its retrieval",
            delta(
                baseline.fact_identity(),
                event_ns - SECOND,
                event(event_ns, "SETTLING", |_| {}),
                locator,
            ),
            Refused::EventAfterRetrieval,
        ),
        (
            "an event before the baseline's listing",
            with(|e| e["E"] = serde_json::json!(1_569_398_400_000_u64)),
            Refused::EventOutOfOrder,
        ),
        (
            "an event after the listing but no later than the baseline's retrieval",
            with(|e| e["E"] = serde_json::json!((FIRST_CUT + SECOND) / 1_000_000)),
            Refused::EventOutOfOrder,
        ),
        (
            "the status the fact already has",
            delta(
                baseline.fact_identity(),
                retrieval,
                event(event_ns, "TRADING", |_| {}),
                locator,
            ),
            Refused::StatusUnchanged,
        ),
    ];

    for (why, submission, refusal) in refusals {
        let before = facts(&owner).await;
        assert_eq!(
            owner
                .admit_instrument_master_status_delta_v2(submission)
                .await,
            Err(refusal),
            "{why}"
        );
        assert_eq!(facts(&owner).await, before, "{why}: nothing is written");
    }

    // 4. The delta extends the baseline under the current head.
    let admitted = owner
        .admit_instrument_master_status_delta_v2(settling())
        .await
        .expect("the delta extends the baseline");
    assert_eq!(admitted.canonical_identity(), "BTCUSDT-PERP.BINANCE");
    assert_eq!(
        admitted.predecessor_fact_identity(),
        baseline.fact_identity()
    );
    assert_eq!(admitted.correction_sequence(), 2);
    assert_eq!(admitted.contract_status(), "SETTLING");
    assert_eq!(admitted.owner_observation_time_ns(), i128::from(third_cut));
    assert_eq!(
        admitted.terms_basis(),
        InstrumentTermsBasisWireV2::RetrievedTermsAssumedSinceListing,
        "a status delta does not change the terms' basis"
    );
    assert_eq!(facts(&owner).await.len(), 2);

    // 5. A cut issued now resolves the delta; the cut issued before keeps the baseline.
    let after = selection(&owner, &usdm, 70, third_cut).await;
    let resolved_after = instruments
        .issue_cut(InstrumentMasterCutRequestV2::new(d(71), third_cut), &after)
        .await
        .expect("the cut resolves the delta");
    let member = resolved_after.cut().members()[0].fact();
    assert_eq!(member.identity(), admitted.fact_identity());
    assert_eq!(
        member.terms().contract_status,
        FactValue::Value("SETTLING".to_owned())
    );
    assert_eq!(
        member.terms().price_increment_from_filter,
        resolved_before.cut().members()[0]
            .fact()
            .terms()
            .price_increment_from_filter,
        "the tick is the baseline's"
    );
    assert_eq!(
        instruments
            .issue_cut(before_request, &before)
            .await
            .expect("the earlier cut is stored")
            .cut()
            .members()[0]
            .fact()
            .identity(),
        baseline.fact_identity(),
        "a cut is written once: the earlier request keeps its answer"
    );

    // 6. Another event naming the baseline is not a replay: the baseline already has a successor.
    let before_stale = facts(&owner).await;
    assert_eq!(
        owner
            .admit_instrument_master_status_delta_v2(delta(
                baseline.fact_identity(),
                retrieval,
                event(event_ns + SECOND / 2, "PRE_SETTLE", |_| {}),
                locator,
            ))
            .await,
        Err(Refused::PredecessorNotCurrent)
    );
    assert_eq!(facts(&owner).await, before_stale);

    // 7. A second delta, under a later head, extends the first.
    let fourth_cut = FIRST_CUT + 6 * SECOND;
    commit_binding(&owner, "usdm/exchangeInfo", 4, fourth_cut).await;
    let second = owner
        .admit_instrument_master_status_delta_v2(delta(
            admitted.fact_identity(),
            fourth_cut - SECOND,
            event(fourth_cut - 2 * SECOND, "TRADING", |_| {}),
            locator,
        ))
        .await
        .expect("the second delta extends the first");
    assert_eq!(second.correction_sequence(), 3);
    assert_eq!(second.predecessor_fact_identity(), admitted.fact_identity());
    assert_eq!(second.owner_observation_time_ns(), i128::from(fourth_cut));

    // 8. The first submission again, after the second delta and a later head, rejoins its fact.
    let before_replay = facts(&owner).await;
    assert_eq!(
        owner
            .admit_instrument_master_status_delta_v2(settling())
            .await,
        Ok(admitted),
        "a replay rejoins"
    );
    assert_eq!(
        facts(&owner).await,
        before_replay,
        "a replay writes nothing"
    );

    // 9. A stored row altered so its chain no longer decodes: refused, and restored.
    let (identity, original): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT fact_identity,fact_bytes FROM market_data_instrument_master_v2.facts WHERE correction_sequence=1",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap();
    let mut altered = original.clone();
    let last = altered.len() - 1;
    altered[last] ^= 1;
    sqlx::query(
        "UPDATE market_data_instrument_master_v2.facts SET fact_bytes=$1 WHERE fact_identity=$2",
    )
    .bind(&altered)
    .bind(&identity)
    .execute(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        owner
            .admit_instrument_master_status_delta_v2(delta(
                second.fact_identity(),
                fourth_cut,
                event(fourth_cut - SECOND, "SETTLING", |_| {}),
                locator,
            ))
            .await,
        Err(Refused::StoreUnavailable),
        "a chain that does not decode is not extended"
    );
    sqlx::query(
        "UPDATE market_data_instrument_master_v2.facts SET fact_bytes=$1 WHERE fact_identity=$2",
    )
    .bind(&original)
    .bind(&identity)
    .execute(owner.pool())
    .await
    .unwrap();
    assert_eq!(
        facts(&owner).await,
        before_replay,
        "the altered row is restored"
    );
}

/// Runs `first` and `second` at once, both held on the Owner's clock head row until both wait on
/// a lock, then lets them go. Each admission is passed boxed, since its state is larger than
/// clippy's `large_futures` bound.
///
/// Each intake reads the clock head `FOR UPDATE` after it has read the chain, so holding that row
/// makes both reach it: a read taken before the store's table locks would then have seen no fact
/// in either submission, and the later one would meet the earlier one's insert.
async fn at_once<A: Future, B: Future>(
    owner: &MarketDataOwnerPostgres,
    first: A,
    second: B,
) -> (A::Output, B::Output) {
    let mut holder = owner.pool().begin().await.unwrap();
    sqlx::query(
        "SELECT 1 FROM market_data_private.clock_handoff_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_one(&mut *holder)
    .await
    .unwrap();
    let release = async {
        let queued = tokio::time::timeout(std::time::Duration::from_secs(20), async {
            loop {
                let waiting: i64 = sqlx::query_scalar(
                    "SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity WHERE datname=pg_catalog.current_database() AND wait_event_type='Lock'",
                )
                .fetch_one(owner.pool())
                .await
                .unwrap();

                if waiting == 2 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await;
        holder.rollback().await.unwrap();
        queued
    };
    let (first, second, queued) = tokio::join!(first, second, release);
    assert!(queued.is_ok(), "both submissions wait before either ends");
    (first, second)
}

/// Two identical submissions at once, a baseline and then a status delta, each answer with the
/// one fact both mean: the intakes take the V2 store's table locks before they read, so the later
/// one reads what the earlier one committed and rejoins it rather than colliding with it.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_two_identical_v2_submissions_at_once_both_answer_with_the_one_fact() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes V2 facts; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");

    // An instrument no other proof admits: the recorded `BTCUSDT` entry under another symbol.
    let mut payload: serde_json::Value = serde_json::from_str(USDM).unwrap();
    let symbols = payload["symbols"].as_array_mut().unwrap();
    let mut entry = symbols
        .iter()
        .find(|entry| entry["symbol"] == "BTCUSDT")
        .unwrap()
        .clone();
    entry["symbol"] = serde_json::json!("CONCURRENTUSDT");
    symbols.push(entry);
    let payload = serde_json::to_string(&payload).unwrap();

    let usdm = commit_binding(&owner, "usdm/exchangeInfo", 1, FIRST_CUT).await;
    commit_binding(&owner, "usdm/exchangeInfo", 2, FIRST_CUT + 2 * SECOND).await;
    let baseline = || submission(&usdm, "CONCURRENTUSDT", FIRST_CUT + SECOND, &payload);
    let before = facts(&owner).await;
    let (first, second) = at_once(
        &owner,
        Box::pin(owner.admit_instrument_master_baseline_v2(baseline())),
        Box::pin(owner.admit_instrument_master_baseline_v2(baseline())),
    )
    .await;
    let first = first.expect("the first baseline is admitted");
    assert_eq!(second, Ok(first.clone()), "the second rejoins the first");
    assert_eq!(facts(&owner).await.len(), before.len() + 1);

    commit_binding(&owner, "usdm/exchangeInfo", 3, FIRST_CUT + 4 * SECOND).await;
    let settling = || {
        delta(
            first.fact_identity(),
            FIRST_CUT + 3 * SECOND,
            event(FIRST_CUT + 2 * SECOND, "SETTLING", |event| {
                event["s"] = serde_json::json!("CONCURRENTUSDT");
            }),
            usdm.receipt().locator(),
        )
    };
    let (first_delta, second_delta) = at_once(
        &owner,
        owner.admit_instrument_master_status_delta_v2(settling()),
        owner.admit_instrument_master_status_delta_v2(settling()),
    )
    .await;
    let first_delta = first_delta.expect("the first delta is admitted");
    assert_eq!(
        second_delta,
        Ok(first_delta),
        "the second rejoins the first"
    );
    assert_eq!(facts(&owner).await.len(), before.len() + 2);
}
