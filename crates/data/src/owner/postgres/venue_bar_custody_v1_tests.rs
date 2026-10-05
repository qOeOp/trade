//! Custody inputs built from the store (slice B7), proved on real PostgreSQL: a window the store
//! fully holds produces rows equal to the store's own bars and commits through the real PIT
//! window custody intake; an unresolved conflict, a grid hole, or a missing fill bar each refuse
//! by name, writing nothing further.

use std::collections::BTreeSet;

use super::{
    MarketDataClockAdmission, MarketDataOwnerPostgres, OWNER_CLOCK_EPOCH_V1,
    OWNER_CLOCK_IDENTITY_V1, OWNER_CLOCK_SKEW_BOUND_NS, OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
    OWNER_CLOCK_VALIDITY_WINDOW_NS, OwnerSourceBindingDecision, SourceBindingCommit,
    pit_intake_member_count_tests::source_proposal,
    pit_window_custody_v1_tests::{
        BTC, DAY, MINUTE, WINDOW_START, admit_members, after_close, commit, d, owner, universe,
    },
    seal_owner_clock_admission_v1,
};
use crate::owner::{
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::UntrustedPitWindowCustodyRequestV1,
    source_binding::{
        UntrustedSourceAvailabilityRuleV1, UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1,
        UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1,
        UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1,
        authority::{
            derive_binding_id, derive_market_semantics_compatibility_identity_v1,
            derive_time_evidence_identity,
        },
    },
    venue_bar_custody_v1::{VenueBarCustodyRefusalV1, custody_inputs_from_store_v1},
    venue_bar_store_v1::{VenueBarAvailabilityV1, VenueBarStoreV1, VenueBarV1},
};

/// 2026-09-21: the Owner clock's first head, on the real clock. A fixture of this file alone -
/// `pit_window_custody_v1_tests`'s own `commit_binding` declares timeframes that don't match the
/// production labels B7 reads the store by (`24H`/`1M`, not that fixture's `1D`/`1M`), so this
/// file mints its own binding rather than reusing it.
const FIRST_CUT: u64 = 1_790_000_000_000_000_000;

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

fn continuous(
    label: &str,
    step: u32,
    unit: UntrustedSourceBarUnitV1,
) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: label.to_owned(),
        cadence: UntrustedSourceBarCadenceV1::FixedInterval { step, unit },
        anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
        clock: UntrustedSourceBarClockV1::Continuous,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

/// The production row-timeframe labels B7 actually reads the store by: `24H` for `1d`, `1M` for
/// the fill timeframe `1m` (`bar_schedule.rs::served_timeframe_v1`,
/// `bar_schedule.rs::execution_timeframe_bar_label_v1`).
fn production_declarations() -> Vec<UntrustedSourceBarTimeframeV1> {
    // Declarations must be in strictly ascending row-timeframe order (`authority.rs`'s own "one
    // declaration per label, in one order" check): "1M" < "24H" by string comparison.
    vec![
        continuous("1M", 1, UntrustedSourceBarUnitV1::Minute),
        continuous("24H", 24, UntrustedSourceBarUnitV1::Hour),
    ]
}

fn market_semantics_value() -> MarketSemanticsValueSubmissionV1 {
    MarketSemanticsValueSubmissionV1 {
        normalization_identity: d(31),
        price_adjustment: "RAW".to_owned(),
        timestamp_basis: "INTERVAL_CLOSE".to_owned(),
        price_unit_identity: d(32),
        size_unit_identity: d(33),
    }
}

/// Commits one admitted schema-2 Source Binding declaring exactly the production labels
/// `custody_inputs_from_store_v1` reads the store by.
async fn commit_production_binding(
    owner: &MarketDataOwnerPostgres,
    dataset: &str,
    rule: UntrustedSourceAvailabilityRuleV1,
) -> SourceBindingCommit {
    let sequence = 1u64;
    let cut = FIRST_CUT;
    let clock = owner_clock(sequence, cut);
    let mut proposal = source_proposal();
    proposal.adapter.dataset_mapping = dataset.to_owned();
    let time = &mut proposal.time_evidence;
    time.clock_identity.clone_from(&clock.clock_identity);
    time.clock_epoch.clone_from(&clock.clock_epoch);
    time.restart_continuity_digest = clock.restart_continuity_digest;
    time.skew_bound = clock.skew_bound;
    time.uncertainty_bound = clock.uncertainty_bound;
    time.monotonic_sequence = sequence;
    time.event_effective = cut - 30;
    time.provider_available = cut - 20;
    time.correction_publication = cut - 15;
    time.retrieval = cut - 10;
    time.observed_at = cut;
    time.effective_at = cut;
    time.valid_through = clock.valid_through;
    proposal.schema_version = 2;
    proposal.availability_rule = Some(rule);
    proposal.bar_timeframes = production_declarations();
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    owner
        .commit_source_initial(
            proposal,
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &clock,
        )
        .await
        .expect("the Owner admits the binding and its clock")
}

/// A bar whose prices are internally consistent (low the minimum, high the maximum), for any
/// window: only `open_ns`/`close_ns_exclusive` ever distinguish one from another in these proofs.
fn bar(open_ns: u64, close_ns_exclusive: u64) -> VenueBarV1 {
    VenueBarV1 {
        open_ns,
        close_ns_exclusive,
        open: "100".parse().unwrap(),
        high: "110".parse().unwrap(),
        low: "90".parse().unwrap(),
        close: "105".parse().unwrap(),
        volume: "1000".parse().unwrap(),
        quote_volume: "105000".parse().unwrap(),
        trade_count: 42,
        taker_buy_volume: "500".parse().unwrap(),
        taker_buy_quote_volume: "52500".parse().unwrap(),
    }
}

async fn commit_bar(
    store: &dyn VenueBarStoreV1,
    instrument: &str,
    venue_interval: &str,
    bar: VenueBarV1,
    retrieval_ns: u64,
) {
    store
        .commit_venue_bars_v1(
            instrument,
            venue_interval,
            VenueBarAvailabilityV1::AtRetrieval,
            retrieval_ns,
            &[bar],
        )
        .await
        .expect("the bar commits");
}

/// Over a window the store fully holds, `custody_inputs_from_store_v1`'s rows equal the store's
/// own bars - values, `retrieval_ns` equal to the version's own availability, route equal to the
/// source - and the assembled request commits through the real intake. A stray bar opening in the
/// pad interval (the last gap's own interval, past the execution grid) changes nothing: it is not
/// a custody input.
///
/// Window `[WINDOW_START, WINDOW_START + 3*DAY)`: two execution bars (`WINDOW_START` to
/// `WINDOW_START + 2*DAY`) and a one-interval pad (`WINDOW_START + 2*DAY` to
/// `WINDOW_START + 3*DAY`) holding only the last gap's fill bar.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_store_inputs_equal_the_stores_own_bars_and_commit_through_the_real_intake() {
    let owner = owner().await;
    let store = owner.venue_bar_store_v1();
    let retrieval_ns = WINDOW_START + 4 * DAY;
    let window_end = WINDOW_START + 3 * DAY;

    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START, WINDOW_START + DAY),
        retrieval_ns,
    )
    .await;
    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START + DAY, WINDOW_START + 2 * DAY),
        retrieval_ns,
    )
    .await;
    // A stray bar opening exactly where the pad begins: not a custody input, since its close
    // lies past the execution grid's own end.
    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START + 2 * DAY, WINDOW_START + 3 * DAY),
        retrieval_ns,
    )
    .await;
    commit_bar(
        store.as_ref(),
        BTC,
        "1m",
        bar(
            WINDOW_START + DAY + 3 * MINUTE,
            WINDOW_START + DAY + 4 * MINUTE,
        ),
        retrieval_ns,
    )
    .await;
    commit_bar(
        store.as_ref(),
        BTC,
        "1m",
        bar(
            WINDOW_START + 2 * DAY + 3 * MINUTE,
            WINDOW_START + 2 * DAY + 4 * MINUTE,
        ),
        retrieval_ns,
    )
    .await;

    let availability = after_close(false);
    let inputs = custody_inputs_from_store_v1(
        store.as_ref(),
        BTC,
        "1d",
        WINDOW_START,
        window_end,
        &availability,
        retrieval_ns,
    )
    .await
    .expect("the window is fully held");

    assert_eq!(
        inputs.execution.len(),
        2,
        "the pad's own stray bar is not a custody input"
    );
    assert_eq!(inputs.fill.len(), 2, "both gaps' fill bars are in");

    for version in inputs.execution.iter().chain(inputs.fill.iter()) {
        assert!(!version.rows.is_empty());

        for row in &version.rows {
            assert_eq!(
                row.retrieval_ns, retrieval_ns,
                "AtRetrieval availability equals the retrieval instant"
            );
            assert_eq!(row.retrieval_route, "REST");
        }
    }
    let open_row = inputs.execution[0]
        .rows
        .iter()
        .find(|row| row.field == "OPEN")
        .expect("an OPEN row");
    assert_eq!(open_row.value_mantissa, 100);
    assert_eq!(open_row.value_scale, 0);
    assert_eq!(inputs.execution[0].timeframe, "24H");
    assert_eq!(inputs.fill[0].timeframe, "1M");

    let binding =
        commit_production_binding(&owner, "binance/um/klines", availability.clone()).await;
    admit_members(&owner, &binding).await;
    let universe_selection = universe(&owner, &binding, 10, None).await;
    let market_semantics_identity =
        derive_market_semantics_compatibility_identity_v1(&binding.fact().proposal().semantics);

    let mut cross_sections = inputs.execution;
    cross_sections.extend(inputs.fill);
    cross_sections.sort_by(|a, b| {
        (&a.timeframe, a.event_effective_ns).cmp(&(&b.timeframe, b.event_effective_ns))
    });

    let request = UntrustedPitWindowCustodyRequestV1 {
        source_binding: binding.receipt().locator().clone(),
        market_semantics_identity,
        market_semantics_value: market_semantics_value(),
        universe_selection,
        members: vec![BTC.to_owned()],
        window_start_ns: WINDOW_START,
        window_end_ns_exclusive: window_end,
        execution_timeframe: "24H".to_owned(),
        input_timeframes: vec!["24H".to_owned()],
        fill_timeframe: Some("1M".to_owned()),
        predecessor: None,
        cross_sections,
    };
    let intake = owner.pit_window_custody_commit_v1();
    commit(&intake, request)
        .await
        .expect("the assembled request commits through the real intake");
}

/// An unresolved conflict's bar closing inside the window refuses `ConflictOpen`, reading no
/// further.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_open_conflict_refuses_and_writes_nothing_further() {
    let owner = owner().await;
    let store = owner.venue_bar_store_v1();
    let retrieval_ns = WINDOW_START + 4 * DAY;
    let window_end = WINDOW_START + 3 * DAY;

    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START, WINDOW_START + DAY),
        retrieval_ns,
    )
    .await;
    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START + DAY, WINDOW_START + 2 * DAY),
        retrieval_ns,
    )
    .await;

    // A differing re-fetch of the first execution bar records a conflict rather than overwriting
    // it.
    let mut differing = bar(WINDOW_START, WINDOW_START + DAY);
    differing.volume = "9999".parse().unwrap();
    store
        .commit_venue_bars_v1(
            BTC,
            "1d",
            VenueBarAvailabilityV1::AtRetrieval,
            retrieval_ns + 1,
            &[differing],
        )
        .await
        .expect("the differing re-fetch records a conflict rather than overwriting");

    let availability = after_close(false);
    let result = custody_inputs_from_store_v1(
        store.as_ref(),
        BTC,
        "1d",
        WINDOW_START,
        window_end,
        &availability,
        retrieval_ns + 1,
    )
    .await;

    assert_eq!(result, Err(VenueBarCustodyRefusalV1::ConflictOpen));
}

/// A grid hole in the execution window refuses `WindowIncomplete`; a missing per-gap fill bar
/// refuses `FillBarMissing` - each writes nothing.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_grid_hole_and_a_missing_fill_bar_each_refuse_by_name() {
    const OTHER: &str = "ETHUSDT-PERP.BINANCE";

    let owner = owner().await;
    let store = owner.venue_bar_store_v1();
    let retrieval_ns = WINDOW_START + 5 * DAY;
    // Three execution bars plus the pad: WINDOW_START to WINDOW_START + 4*DAY.
    let window_end = WINDOW_START + 4 * DAY;
    let availability = after_close(false);

    // The window's middle execution bar is missing: the first and last are in the store, but the
    // chain is not contiguous.
    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START, WINDOW_START + DAY),
        retrieval_ns,
    )
    .await;
    commit_bar(
        store.as_ref(),
        BTC,
        "1d",
        bar(WINDOW_START + 2 * DAY, WINDOW_START + 3 * DAY),
        retrieval_ns,
    )
    .await;
    let hole = custody_inputs_from_store_v1(
        store.as_ref(),
        BTC,
        "1d",
        WINDOW_START,
        window_end,
        &availability,
        retrieval_ns,
    )
    .await;
    assert_eq!(hole, Err(VenueBarCustodyRefusalV1::WindowIncomplete));

    // A second instrument holds the whole execution grid, but no fill bar in either gap.
    for day in 0..3 {
        commit_bar(
            store.as_ref(),
            OTHER,
            "1d",
            bar(WINDOW_START + day * DAY, WINDOW_START + (day + 1) * DAY),
            retrieval_ns,
        )
        .await;
    }
    let missing_fill = custody_inputs_from_store_v1(
        store.as_ref(),
        OTHER,
        "1d",
        WINDOW_START,
        window_end,
        &availability,
        retrieval_ns,
    )
    .await;
    assert_eq!(missing_fill, Err(VenueBarCustodyRefusalV1::FillBarMissing));
}
