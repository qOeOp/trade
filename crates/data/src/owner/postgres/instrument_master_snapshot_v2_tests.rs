//! The production Instrument Master V2 snapshot intake, proven through production paths only.
//!
//! The baseline comes through the baseline intake from the recorded `exchangeInfo` fixture, and the
//! later snapshots are that recording, or it with one field edited, as the archiver would retrieve
//! it again. The Source Bindings are committed on the Owner's own clock, sealed by the production
//! sealer, so the clock the snapshot intake mints from the wall is their ordinary successor.

use std::future::Future;

use super::{
    CLOCK_STATE_LOCK_KEY, MarketDataClockAdmission, MarketDataOwnerPostgres, OWNER_CLOCK_EPOCH_V1,
    OWNER_CLOCK_IDENTITY_V1, OWNER_CLOCK_SKEW_BOUND_NS, OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
    OWNER_CLOCK_VALIDITY_WINDOW_NS, SourceBindingAdmissionPostgresV1,
    instrument_master_admission_v2_tests::{
        FIRST_CUT, SECOND, USDM, commit_binding, commit_binding_on, d, facts,
        research_decision_cut, selection, submission,
    },
    seal_owner_clock_admission_v1,
};
use crate::owner::{
    instrument_master_admission_v2::{
        InstrumentMasterSnapshotErrorV2, InstrumentMasterSnapshotSubmissionV2,
        InstrumentTermsBasisWireV2,
    },
    instrument_master_v2::{
        FactValue, InstrumentDecimalV2, InstrumentMasterCustodyErrorV2,
        InstrumentMasterCutRequestV2,
    },
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator, authority::derive_binding_id},
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1, SourceBindingAdmissionRequestV1,
        SourceBindingAdmissionV1,
    },
};

/// The Owner's own clock at `instant`, sealed as the Owner seals every cut it mints.
fn owner_clock(sequence: u64, instant: u64) -> MarketDataClockAdmission {
    seal_owner_clock_admission_v1(
        OWNER_CLOCK_IDENTITY_V1,
        OWNER_CLOCK_EPOCH_V1,
        sequence,
        instant,
        OWNER_CLOCK_VALIDITY_WINDOW_NS,
        OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
        OWNER_CLOCK_SKEW_BOUND_NS,
    )
    .expect("the instant seals on the Owner clock")
}

/// The recorded payload with `edit` applied to its `BTCUSDT` entry.
fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut root: serde_json::Value = serde_json::from_str(USDM).unwrap();
    let entry = root["symbols"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|entry| entry["symbol"] == "BTCUSDT")
        .unwrap();
    edit(entry);
    serde_json::to_string(&root).unwrap()
}

/// The recorded payload with `BTCUSDT`'s tick changed from `0.10` to `0.20`.
fn wider_tick() -> String {
    edited(|entry| {
        let filter = entry["filters"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|filter| filter["filterType"] == "PRICE_FILTER")
            .unwrap();
        filter["tickSize"] = serde_json::json!("0.20");
    })
}

fn snapshot(
    predecessor: BindingDigest,
    retrieval_time_ns: u64,
    raw_payload: &str,
    source_binding: &UntrustedSourceBindingLocator,
) -> InstrumentMasterSnapshotSubmissionV2 {
    InstrumentMasterSnapshotSubmissionV2 {
        predecessor_fact_identity: predecessor,
        retrieval_time_ns: i128::from(retrieval_time_ns),
        raw_payload: raw_payload.to_owned(),
        source_binding: source_binding.clone(),
    }
}

/// Every clock handoff and the head, for "the clock did not move".
async fn clock(owner: &MarketDataOwnerPostgres) -> (i64, u64) {
    let handoffs: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1")
            .fetch_one(owner.pool())
            .await
            .unwrap();
    (handoffs, research_decision_cut(owner).await)
}

/// Every cut row, for "the refused cut wrote nothing".
async fn cuts(owner: &MarketDataOwnerPostgres) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM market_data_instrument_master_v2.cuts")
        .fetch_one(owner.pool())
        .await
        .unwrap()
}

fn wall_now_ns() -> u64 {
    u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    )
    .unwrap()
}

/// A later snapshot extends the instrument's V2 fact. Retrieved after the head, it advances the
/// Owner's clock itself, in the transaction that appends it; retrieved before, it takes the head.
/// A replay rejoins and moves no clock, and every refusal a submission can reach is driven once and
/// writes neither a fact nor a clock. A snapshot later than the status the fact knows sets it. A
/// snapshot that changes the tick is recorded, and the cut refuses the member by name until it
/// selects by window, while a cut issued before keeps its answer.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
#[expect(
    clippy::too_many_lines,
    reason = "one store, one clock: each step depends on the chain and head the one before left"
)]
async fn postgres_a_snapshot_extends_the_v2_fact_and_advances_the_clock_it_needs() {
    use InstrumentMasterSnapshotErrorV2 as Refused;

    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes facts and clocks; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    let instruments = InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");

    // The baseline, through the baseline intake, on the Owner's clock.
    let usdm = commit_binding_on(&owner, "usdm/exchangeInfo", &owner_clock(1, FIRST_CUT)).await;
    let second_cut = FIRST_CUT + 2 * SECOND;
    let other = commit_binding_on(&owner, "coinm/exchangeInfo", &owner_clock(2, second_cut)).await;
    let baseline = owner
        .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", FIRST_CUT + SECOND, USDM))
        .await
        .expect("the baseline intake admits the recorded payload");
    let locator = usdm.receipt().locator();
    assert_eq!(research_decision_cut(&owner).await, second_cut);

    // 1. Retrieved after the head: the intake mints the next Owner clock from the wall and appends
    //    the snapshot at that cut, in one transaction.
    let first_retrieval = second_cut + SECOND;
    let (handoffs_before, _) = clock(&owner).await;
    let before_wall = wall_now_ns();
    let unchanged = owner
        .admit_instrument_master_snapshot_v2(snapshot(
            baseline.fact_identity(),
            first_retrieval,
            USDM,
            locator,
        ))
        .await
        .expect("the snapshot extends the baseline");
    let (handoffs_after, minted_cut) = clock(&owner).await;
    assert_eq!(handoffs_after, handoffs_before + 1, "one clock was minted");
    assert!(
        minted_cut >= before_wall && minted_cut > first_retrieval,
        "the minted cut is the Owner's wall observation"
    );
    assert_eq!(
        unchanged.owner_observation_time_ns(),
        i128::from(minted_cut)
    );
    assert_eq!(
        unchanged.predecessor_fact_identity(),
        baseline.fact_identity()
    );
    assert_eq!(unchanged.correction_sequence(), 2);
    assert_eq!(unchanged.contract_status(), "TRADING");
    assert!(!unchanged.terms_changed());
    assert_eq!(
        unchanged.terms_basis(),
        InstrumentTermsBasisWireV2::RetrievedTermsAssumedSinceListing,
        "a snapshot with the baseline's terms keeps their basis"
    );

    // 2. Every refusal a submission can reach, each writing neither a fact nor a clock.
    let mut unbound = locator.clone();
    unbound.fact_digest = d(98);
    let later = first_retrieval + SECOND;
    let refusals = [
        (
            "an unknown predecessor",
            snapshot(d(99), later, USDM, locator),
            Refused::PredecessorUnknown,
        ),
        (
            "a locator no binding is admitted under",
            snapshot(unchanged.fact_identity(), later, USDM, &unbound),
            Refused::SourceBindingUnavailable,
        ),
        (
            "an admitted binding that is not the baseline's",
            snapshot(
                unchanged.fact_identity(),
                later,
                USDM,
                other.receipt().locator(),
            ),
            Refused::SourceBindingMismatch,
        ),
        (
            "text that is not exchangeInfo",
            snapshot(unchanged.fact_identity(), later, "exchangeInfo", locator),
            Refused::InvalidSubmission,
        ),
        (
            "a payload without the instrument",
            snapshot(
                unchanged.fact_identity(),
                later,
                &edited(|entry| entry["symbol"] = serde_json::json!("OTHERUSDT")),
                locator,
            ),
            Refused::SymbolAbsent,
        ),
        (
            "another listing",
            snapshot(
                unchanged.fact_identity(),
                later,
                &edited(|entry| entry["onboardDate"] = serde_json::json!(1_569_398_400_001_u64)),
                locator,
            ),
            Refused::ListingDiffers,
        ),
        (
            "a retrieval no later than the latest snapshot",
            snapshot(unchanged.fact_identity(), first_retrieval, USDM, locator),
            Refused::SnapshotOutOfOrder,
        ),
        (
            "a retrieval later than the Owner's wall",
            snapshot(
                unchanged.fact_identity(),
                wall_now_ns() + 3_600 * SECOND,
                USDM,
                locator,
            ),
            Refused::RetrievalAfterOwnerClock,
        ),
        (
            "a fact that already has a successor",
            snapshot(baseline.fact_identity(), later, USDM, locator),
            Refused::PredecessorNotCurrent,
        ),
        (
            "another listing retrieved after the head, refused after the intake chose to mint",
            snapshot(
                unchanged.fact_identity(),
                wall_now_ns(),
                &edited(|entry| entry["onboardDate"] = serde_json::json!(1_569_398_400_001_u64)),
                locator,
            ),
            Refused::ListingDiffers,
        ),
    ];

    for (why, submission, refusal) in refusals {
        let before = (facts(&owner).await, clock(&owner).await);
        assert_eq!(
            owner.admit_instrument_master_snapshot_v2(submission).await,
            Err(refusal),
            "{why}"
        );
        assert_eq!(
            (facts(&owner).await, clock(&owner).await),
            before,
            "{why}: nothing is written, and the clock does not move"
        );
    }

    // 3. Retrieved before the head: a snapshot stating another status takes the head's cut, and
    //    being later than every status instant the fact knows, sets the status.
    let settling = edited(|entry| entry["status"] = serde_json::json!("SETTLING"));
    let head_before = clock(&owner).await;
    let status_set = owner
        .admit_instrument_master_snapshot_v2(snapshot(
            unchanged.fact_identity(),
            later,
            &settling,
            locator,
        ))
        .await
        .expect("a snapshot before the head takes its cut");
    assert_eq!(clock(&owner).await, head_before, "no clock is minted");
    assert_eq!(
        status_set.owner_observation_time_ns(),
        i128::from(minted_cut)
    );
    assert_eq!(status_set.contract_status(), "SETTLING");
    assert!(
        !status_set.terms_changed(),
        "the status is not a term the basis speaks for"
    );

    // 4. A cut issued now resolves the latest snapshot on the baseline's tick.
    let equal = selection(&owner, &usdm, 60, minted_cut).await;
    let equal_request = InstrumentMasterCutRequestV2::new(d(61), minted_cut);
    let resolved = instruments
        .issue_cut(equal_request, &equal)
        .await
        .expect("a member whose terms are still the baseline's resolves");
    let member = resolved.cut().members()[0].fact();
    assert_eq!(member.identity(), status_set.fact_identity());
    assert_eq!(
        member.terms().price_increment_from_filter,
        FactValue::Value(InstrumentDecimalV2 {
            mantissa: 1,
            scale: 1
        })
    );

    // 5. A snapshot that widens the tick is recorded and changes the basis for good.
    let changed = owner
        .admit_instrument_master_snapshot_v2(snapshot(
            status_set.fact_identity(),
            later + SECOND,
            &wider_tick(),
            locator,
        ))
        .await
        .expect("a snapshot that changes the terms is recorded");
    assert!(changed.terms_changed());
    assert_eq!(
        changed.terms_basis(),
        InstrumentTermsBasisWireV2::ObservedSinceTermsChange
    );
    assert_eq!(
        changed.contract_status(),
        "TRADING",
        "the recording states TRADING, and it is the newest status evidence"
    );

    // 6. The cut refuses that member by name and writes nothing; the cut issued before keeps its
    //    answer.
    let after = selection(&owner, &usdm, 70, minted_cut).await;
    let cuts_before = cuts(&owner).await;
    assert_eq!(
        instruments
            .issue_cut(InstrumentMasterCutRequestV2::new(d(71), minted_cut), &after)
            .await
            .map(|readback| readback.cut().identity()),
        Err(InstrumentMasterCustodyErrorV2::TermsChanged)
    );
    assert_eq!(
        cuts(&owner).await,
        cuts_before,
        "the refused cut wrote nothing"
    );
    assert_eq!(
        instruments
            .issue_cut(equal_request, &equal)
            .await
            .expect("the earlier cut is stored")
            .cut()
            .identity(),
        resolved.cut().identity(),
        "a cut is written once: the earlier request keeps its answer"
    );

    // 7. A replay of the first snapshot, after three later facts, rejoins and moves no clock.
    let before_replay = (facts(&owner).await, clock(&owner).await);
    assert_eq!(
        owner
            .admit_instrument_master_snapshot_v2(snapshot(
                baseline.fact_identity(),
                first_retrieval,
                USDM,
                locator,
            ))
            .await,
        Ok(unchanged),
        "a replay rejoins"
    );
    assert_eq!(
        (facts(&owner).await, clock(&owner).await),
        before_replay,
        "a replay writes nothing and mints no clock"
    );

    // 8. Once the wall has passed the head, a snapshot retrieved after it mints again.
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let (handoffs_before, head) = clock(&owner).await;
    let again = owner
        .admit_instrument_master_snapshot_v2(snapshot(
            changed.fact_identity(),
            head + 1,
            &wider_tick(),
            locator,
        ))
        .await
        .expect("a snapshot after the head mints the next clock");
    let (handoffs_after, next_head) = clock(&owner).await;
    assert_eq!(handoffs_after, handoffs_before + 1);
    assert!(next_head > head);
    assert_eq!(again.owner_observation_time_ns(), i128::from(next_head));
    assert!(!again.terms_changed());
    assert_eq!(
        again.terms_basis(),
        InstrumentTermsBasisWireV2::ObservedSinceTermsChange,
        "equal terms after a change keep the changed basis"
    );
}

/// A head the Owner's clock cannot succeed is refused by name when a snapshot needs the clock
/// advanced, and nothing is written. No production head is on another clock: every cut is minted
/// under the Owner's identity and epoch. The refusal is driven here with a head on a test clock.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_snapshot_past_a_head_on_another_clock_is_refused_and_writes_nothing() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes facts; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");
    let usdm = commit_binding(&owner, "usdm/exchangeInfo", 1, FIRST_CUT + 2 * SECOND).await;
    let baseline = owner
        .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", FIRST_CUT + SECOND, USDM))
        .await
        .expect("the baseline intake admits the recorded payload");
    let before = (facts(&owner).await, clock(&owner).await);

    assert_eq!(
        owner
            .admit_instrument_master_snapshot_v2(snapshot(
                baseline.fact_identity(),
                FIRST_CUT + 3 * SECOND,
                USDM,
                usdm.receipt().locator(),
            ))
            .await,
        Err(InstrumentMasterSnapshotErrorV2::ClockMismatch)
    );
    assert_eq!((facts(&owner).await, clock(&owner).await), before);
}

/// Runs `first` and then `second`, both held behind the Owner's clock-state lock: `second` is built
/// and started only once `first` waits on a lock, so `first` queues for the clock-state lock ahead
/// of it, and both are released once both wait.
async fn behind_the_clock_state<A: Future, B: Future>(
    owner: &MarketDataOwnerPostgres,
    first: A,
    second: impl FnOnce() -> B,
) -> (A::Output, B::Output) {
    let waiting = || async {
        let count: i64 = sqlx::query_scalar(
            "SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity WHERE datname=pg_catalog.current_database() AND wait_event_type='Lock'",
        )
        .fetch_one(owner.pool())
        .await
        .unwrap();
        count
    };
    let until = |at_least: i64| async move {
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            while waiting().await < at_least {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
    };
    let mut holder = owner.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CLOCK_STATE_LOCK_KEY)
        .execute(&mut *holder)
        .await
        .unwrap();
    let later = async {
        assert!(
            until(1).await.is_ok(),
            "the first waits before the second starts"
        );
        second().await
    };
    let release = async {
        let queued = until(2).await;
        holder.rollback().await.unwrap();
        queued
    };
    let (first, second, queued) = tokio::join!(first, later, release);
    assert!(queued.is_ok(), "both wait before either ends");
    (first, second)
}

/// A snapshot that mints the Owner's clock takes the clock-state lock before the head's row lock,
/// as every other clock writer does. With a Source Binding admission queued for the clock-state
/// lock ahead of it, both answer, one after the other, rather than one waiting on the other's row
/// while the other waits on its lock. Two identical minting snapshots at once answer with one fact,
/// and mint once.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_minting_snapshot_and_another_clock_writer_at_once_both_answer() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes facts and clocks; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    InstrumentMasterV2PostgresOwner::install(owner.pool().clone())
        .await
        .expect("the V2 store installs");
    let usdm = commit_binding_on(&owner, "usdm/exchangeInfo", &owner_clock(1, FIRST_CUT)).await;
    commit_binding_on(
        &owner,
        "usdm/exchangeInfo",
        &owner_clock(2, FIRST_CUT + 2 * SECOND),
    )
    .await;
    let baseline = owner
        .admit_instrument_master_baseline_v2(submission(&usdm, "BTCUSDT", FIRST_CUT + SECOND, USDM))
        .await
        .expect("the baseline intake admits the recorded payload");
    let locator = usdm.receipt().locator();

    // 1. A Source Binding admission, which mints the Owner's clock, queued ahead of a snapshot that
    //    mints it too: the snapshot is retrieved once the admission waits, so after the admission
    //    minted its cut, and the head the admission commits does not reach it.
    let admissions = SourceBindingAdmissionPostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&owner_url).await.unwrap(),
    };
    let mut proposal = super::pit_intake_member_count_tests::source_proposal();
    proposal.semantics.normalization = "normalization-clock-order".to_owned();
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    let (handoffs_before, _) = clock(&owner).await;
    let (admitted, snapshotted) = behind_the_clock_state(
        &owner,
        admissions.admit(SourceBindingAdmissionRequestV1 {
            proposal,
            rights: ProviderRightsEvidenceV1::Granted,
            reachability: ProviderReachabilityEvidenceV1::Reachable,
        }),
        || {
            owner.admit_instrument_master_snapshot_v2(snapshot(
                baseline.fact_identity(),
                wall_now_ns(),
                USDM,
                locator,
            ))
        },
    )
    .await;
    admitted.expect("the Source Binding admission answers with its binding");
    let snapshotted = snapshotted.expect("the snapshot answers with its fact");
    let (handoffs_after, head) = clock(&owner).await;
    assert_eq!(handoffs_after, handoffs_before + 2, "each minted one clock");
    assert_eq!(snapshotted.owner_observation_time_ns(), i128::from(head));

    // 2. Two identical snapshots that must mint, at once: one mints and appends, the other rejoins.
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let retrieval = wall_now_ns();
    let submit = || {
        owner.admit_instrument_master_snapshot_v2(snapshot(
            snapshotted.fact_identity(),
            retrieval,
            USDM,
            locator,
        ))
    };
    let before = facts(&owner).await.len();
    let (first, second) = behind_the_clock_state(&owner, submit(), submit).await;
    let first = first.expect("the first snapshot answers with its fact");
    assert_eq!(second, Ok(first), "the second rejoins the first");
    assert_eq!(facts(&owner).await.len(), before + 1);
    assert_eq!(
        clock(&owner).await.0,
        handoffs_after + 1,
        "one clock was minted"
    );
}
