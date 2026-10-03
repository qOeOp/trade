//! The derived view's selection rules, decided without a store.

use rstest::rstest;

use super::*;

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SECOND;
/// Two minutes after a bar closes, as the binding's rule states.
const LAG: u64 = 120 * SECOND;
/// The day a backfill minted the custody, long after every bar it holds.
const MINTED: u64 = 1_790_000_000_000_000_000;

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

/// The daily execution timeframe, a two-day input timeframe and a minute fill timeframe.
const EXECUTION: u8 = 1;
const TWO_DAY: u8 = 2;
const FILL: u8 = 3;

fn timeframes(inputs: &[u8]) -> ViewTimeframesV1 {
    ViewTimeframesV1 {
        execution: d(EXECUTION),
        inputs: inputs.iter().map(|byte| d(*byte)).collect(),
        interval_ns: DAY,
    }
}

/// A version whose identity names its timeframe, event and sequence.
fn version(
    timeframe: u8,
    event_ns: u64,
    correction_sequence: u64,
    kind: CrossSectionVersionKindV1,
    availability_ns: u64,
    publication_ns: u64,
) -> ChainVersionV1 {
    let mut seed = Vec::new();
    seed.push(timeframe);
    seed.extend_from_slice(&event_ns.to_be_bytes());
    seed.extend_from_slice(&correction_sequence.to_be_bytes());
    seed.push(kind as u8);
    let identity = sha256(b"test-version\0", &seed);
    ChainVersionV1 {
        identity,
        custody_identity: d(90),
        chain_version: 1,
        timeframe_identity: d(timeframe),
        event_ns,
        kind,
        correction_sequence,
        predecessor: None,
        availability_ns,
        publication_ns,
    }
}

/// The original of the bar closing at `event_ns`, available and published `LAG` after it.
fn original(timeframe: u8, event_ns: u64) -> ChainVersionV1 {
    version(
        timeframe,
        event_ns,
        1,
        CrossSectionVersionKindV1::Original,
        event_ns + LAG,
        event_ns + LAG,
    )
}

/// The next version after `prior`, published at `publication_ns` and available at
/// `availability_ns`.
fn next(
    prior: &ChainVersionV1,
    kind: CrossSectionVersionKindV1,
    availability_ns: u64,
    publication_ns: u64,
) -> ChainVersionV1 {
    let mut next = version(
        timeframe_byte(prior),
        prior.event_ns,
        prior.correction_sequence + 1,
        kind,
        availability_ns,
        publication_ns,
    );
    next.predecessor = Some(prior.identity);
    next.chain_version = prior.chain_version + 1;
    next
}

fn timeframe_byte(version: &ChainVersionV1) -> u8 {
    version.timeframe_identity.as_bytes()[0]
}

fn correction(prior: &ChainVersionV1, publication_ns: u64) -> ChainVersionV1 {
    next(
        prior,
        CrossSectionVersionKindV1::Correction,
        prior.availability_ns,
        publication_ns,
    )
}

fn withdrawal(prior: &ChainVersionV1, publication_ns: u64) -> ChainVersionV1 {
    next(
        prior,
        CrossSectionVersionKindV1::Withdrawal,
        prior.availability_ns,
        publication_ns,
    )
}

/// Daily bars closing at days 1 to 5, two-day bars closing at days 2 and 4, and minute fill bars
/// after day 1 and day 2.
fn chain() -> Vec<ChainVersionV1> {
    let mut versions = (1..=5)
        .map(|day| original(EXECUTION, day * DAY))
        .collect::<Vec<_>>();
    versions.push(original(TWO_DAY, 2 * DAY));
    versions.push(original(TWO_DAY, 4 * DAY));
    versions.push(original(FILL, DAY + 60 * SECOND));
    versions.push(original(FILL, 2 * DAY + 60 * SECOND));
    versions
}

fn select(
    versions: &[ChainVersionV1],
    inputs: &[u8],
    event_ns: u64,
) -> Result<ViewSelectionV1, ViewRefusalV1> {
    select_view_v1(
        &cross_sections_v1(versions).unwrap(),
        &timeframes(inputs),
        event_ns,
    )
}

fn selected_identities(selection: &ViewSelectionV1) -> Vec<BindingDigest> {
    selection
        .selected
        .iter()
        .map(|version| version.identity)
        .collect()
}

#[rstest]
fn the_execution_cross_section_at_e_k_fixes_d_k() {
    let view = select(&chain(), &[EXECUTION], 2 * DAY).unwrap();

    assert_eq!(view.event_ns, 2 * DAY);
    assert_eq!(view.decision_cut_ns, 2 * DAY + LAG);
    assert_eq!(view.next_event_ns, 3 * DAY);
    assert_eq!(
        selected_identities(&view),
        [original(EXECUTION, 2 * DAY).identity]
    );
}

/// A higher timeframe contributes its latest cross-section available by `d_k`: at day 3 that is
/// the two-day bar that closed at day 2, and at day 4 the one that closed at day 4.
#[rstest]
fn a_higher_timeframe_contributes_its_latest_cross_section_available_by_d_k() {
    let versions = chain();
    let at_day_three = select(&versions, &[EXECUTION, TWO_DAY], 3 * DAY).unwrap();
    assert_eq!(
        selected_identities(&at_day_three),
        [
            original(EXECUTION, 3 * DAY).identity,
            original(TWO_DAY, 2 * DAY).identity
        ],
        "selected in ascending timeframe identity"
    );

    let at_day_four = select(&versions, &[EXECUTION, TWO_DAY], 4 * DAY).unwrap();
    assert_eq!(at_day_four.selected[1], original(TWO_DAY, 4 * DAY));

    // A two-day bar not yet available at `d_k` is not read, even when it closed at `e_k`.
    let mut late = chain();
    let late_bar = late
        .iter_mut()
        .find(|version| version.timeframe_identity == d(TWO_DAY) && version.event_ns == 4 * DAY)
        .unwrap();
    late_bar.availability_ns = 4 * DAY + LAG + 1;
    late_bar.publication_ns = 4 * DAY + LAG + 1;
    assert_eq!(
        select(&late, &[EXECUTION, TWO_DAY], 4 * DAY)
            .unwrap()
            .selected[1],
        original(TWO_DAY, 2 * DAY)
    );
}

/// The two-day bar of day 2, corrected: read at day 3, whose `d_k` is `3 * DAY + LAG`.
#[rstest]
fn a_correction_published_by_d_k_is_selected_and_one_published_after_is_not() {
    let bar = original(TWO_DAY, 2 * DAY);
    let mut versions = chain();
    let on_time = correction(&bar, 3 * DAY + LAG);
    versions.push(on_time.clone());
    assert_eq!(
        select(&versions, &[EXECUTION, TWO_DAY], 3 * DAY)
            .unwrap()
            .selected[1],
        on_time,
        "published at d_k exactly, it is the effective version"
    );

    let mut versions = chain();
    versions.push(correction(&bar, 3 * DAY + LAG + 1));
    assert_eq!(
        select(&versions, &[EXECUTION, TWO_DAY], 3 * DAY)
            .unwrap()
            .selected[1],
        bar,
        "published after d_k, it is not"
    );
}

/// A correction or a withdrawal of the execution bar is published after its original, so after
/// the `d_k` that original fixes: it never reaches the frame at its own event.
#[rstest]
fn a_correction_or_withdrawal_of_the_execution_bar_never_reaches_its_own_frame() {
    let bar = original(EXECUTION, 2 * DAY);

    for later in [
        correction(&bar, 2 * DAY + LAG + 1),
        withdrawal(&bar, 2 * DAY + LAG + 1),
    ] {
        let mut versions = chain();
        versions.push(later);
        assert_eq!(
            select(&versions, &[EXECUTION], 2 * DAY).unwrap().selected,
            std::slice::from_ref(&bar)
        );
    }
}

/// A correction changes the view of every frame that selects it and of no other.
#[rstest]
fn a_correction_changes_only_the_views_that_select_it() {
    let rule = d(70);
    let base = chain();
    let mut corrected = chain();
    corrected.push(correction(&original(TWO_DAY, 2 * DAY), 2 * DAY + DAY / 2));

    for day in 1..=5 {
        let inputs = [EXECUTION, TWO_DAY];
        let identity = |versions: &[ChainVersionV1]| {
            select(versions, &inputs, day * DAY).map(|view| view_identity_v1(rule, &view))
        };

        if day == 3 {
            assert_ne!(identity(&corrected), identity(&base), "frame {day}");
        } else {
            assert_eq!(identity(&corrected), identity(&base), "frame {day}");
        }
    }
}

#[rstest]
fn a_successor_correction_with_a_later_availability_keeps_d_k() {
    let root_cut = 2 * DAY + LAG;
    let mut bar = original(EXECUTION, 2 * DAY);
    bar.availability_ns = root_cut;
    bar.publication_ns = root_cut;
    let mut later = next(
        &bar,
        CrossSectionVersionKindV1::Correction,
        root_cut + DAY,
        root_cut + DAY,
    );
    later.chain_version = 2;
    let versions = vec![bar.clone(), later];
    let view = select(&versions, &[EXECUTION], 2 * DAY).unwrap();

    assert_eq!(view.decision_cut_ns, root_cut);
    assert_eq!(view.selected, [bar]);
}

/// A withdrawn latest cross-section of a higher timeframe leaves the frame uncovered: an older bar
/// is never read in its place.
#[rstest]
fn a_withdrawn_latest_higher_timeframe_bar_is_never_replaced_by_an_older_one() {
    let mut versions = chain();
    versions.push(withdrawal(&original(TWO_DAY, 4 * DAY), 4 * DAY + 2 * LAG));

    assert_eq!(
        select(&versions, &[EXECUTION, TWO_DAY], 5 * DAY),
        Err(ViewRefusalV1::FrameNotCovered)
    );
    assert_eq!(
        select(&versions, &[EXECUTION, TWO_DAY], 4 * DAY)
            .unwrap()
            .selected[1],
        original(TWO_DAY, 4 * DAY),
        "before the withdrawal was published, the frame reads the bar it withdraws"
    );
}

/// During warm-up a declared timeframe has no cross-section yet, and an execution cross-section
/// missing at `e_k` leaves its frame uncovered too.
#[rstest]
fn a_timeframe_with_no_cross_section_yet_leaves_the_frame_uncovered() {
    assert_eq!(
        select(&chain(), &[EXECUTION, TWO_DAY], DAY),
        Err(ViewRefusalV1::FrameNotCovered),
        "no two-day bar has closed by day 1"
    );
    assert_eq!(
        select(&chain(), &[EXECUTION], 6 * DAY),
        Err(ViewRefusalV1::FrameNotCovered),
        "no daily bar at day 6"
    );
}

/// `d_k < e_{k+1}`, strictly: a decision cut at the next frame's event, or after it, leaves the
/// frame uncovered. An availability rule at the minting instant puts every backfilled frame there.
#[rstest]
#[case::at_the_next_frame(3 * DAY, Err(ViewRefusalV1::FrameNotCovered))]
#[case::one_before(3 * DAY - 1, Ok(3 * DAY - 1))]
#[case::the_minting_instant(MINTED, Err(ViewRefusalV1::FrameNotCovered))]
fn d_k_at_or_after_the_next_frame_leaves_it_uncovered(
    #[case] availability_ns: u64,
    #[case] expected: Result<u64, ViewRefusalV1>,
) {
    let mut versions = chain();

    for version in &mut versions {
        if version.timeframe_identity == d(EXECUTION) && version.event_ns == 2 * DAY {
            version.availability_ns = availability_ns;
            version.publication_ns = availability_ns;
        }
    }
    assert_eq!(
        select(&versions, &[EXECUTION], 2 * DAY).map(|view| view.decision_cut_ns),
        expected
    );
}

#[rstest]
fn a_branch_is_refused() {
    let bar = original(EXECUTION, 2 * DAY);
    let refused = |extra: Vec<ChainVersionV1>| {
        let mut versions = chain();
        versions.extend(extra);
        cross_sections_v1(&versions)
    };
    let first = correction(&bar, 2 * DAY + LAG + 5);

    // Two versions at one sequence.
    let mut twin = correction(&bar, 2 * DAY + LAG + 6);
    twin.identity = d(77);
    assert_eq!(
        refused(vec![first.clone(), twin]),
        Err(ViewRefusalV1::Branch)
    );

    // A version naming another than the one before it.
    let mut astray = correction(&first, 2 * DAY + LAG + 9);
    astray.predecessor = Some(d(78));
    assert_eq!(refused(vec![first, astray]), Err(ViewRefusalV1::Branch));

    // A publication that does not increase with the sequence.
    assert_eq!(
        refused(vec![correction(&bar, 2 * DAY + LAG)]),
        Err(ViewRefusalV1::Branch)
    );

    // A version after a withdrawal, and a second original.
    let withdrawn = withdrawal(&bar, 2 * DAY + LAG + 5);
    assert_eq!(
        refused(vec![
            withdrawn.clone(),
            correction(&withdrawn, 2 * DAY + LAG + 9)
        ]),
        Err(ViewRefusalV1::Branch)
    );
    let mut second_original = original(EXECUTION, 2 * DAY);
    second_original.identity = d(79);
    assert_eq!(refused(vec![second_original]), Err(ViewRefusalV1::Branch));

    // A skipped sequence.
    let mut skipped = correction(&bar, 2 * DAY + LAG + 5);
    skipped.correction_sequence = 3;
    assert_eq!(refused(vec![skipped]), Err(ViewRefusalV1::Branch));
}

/// Fill rows are never strategy inputs: the fill timeframe's versions are present in the chain,
/// never selected, and do not move the view identity.
#[rstest]
fn the_fill_timeframe_is_never_selected() {
    let rule = d(70);
    let with_fill = chain();
    let without_fill = chain()
        .into_iter()
        .filter(|version| version.timeframe_identity != d(FILL))
        .collect::<Vec<_>>();
    let view = select(&with_fill, &[EXECUTION, TWO_DAY], 2 * DAY).unwrap();

    assert!(
        view.selected
            .iter()
            .all(|version| version.timeframe_identity != d(FILL))
    );
    assert_eq!(
        view_identity_v1(rule, &view),
        view_identity_v1(
            rule,
            &select(&without_fill, &[EXECUTION, TWO_DAY], 2 * DAY).unwrap()
        )
    );
}

#[rstest]
fn the_view_identity_binds_each_part_of_its_preimage() {
    let view = select(&chain(), &[EXECUTION, TWO_DAY], 3 * DAY).unwrap();
    let base = view_identity_v1(d(70), &view);
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&1_u16.to_be_bytes());
    bytes.extend_from_slice(d(70).as_bytes());
    bytes.extend_from_slice(&(3 * DAY).to_be_bytes());
    bytes.extend_from_slice(&2_u64.to_be_bytes());
    bytes.extend_from_slice(view.selected[0].identity.as_bytes());
    bytes.extend_from_slice(view.selected[1].identity.as_bytes());
    assert_eq!(base, sha256(b"market-data.pit-window-view.v1\0", &bytes));

    assert_ne!(view_identity_v1(d(71), &view), base, "the rule");
    let mut moved = view.clone();
    moved.event_ns += 1;
    assert_ne!(view_identity_v1(d(70), &moved), base, "e_k");
    let mut other = view.clone();
    other.selected[1].identity = d(72);
    assert_ne!(view_identity_v1(d(70), &other), base, "a selected version");
    let mut fewer = view.clone();
    fewer.selected.pop();
    assert_ne!(
        view_identity_v1(d(70), &fewer),
        base,
        "the selection's size"
    );
    let mut later = view;
    later.decision_cut_ns += 1;
    assert_eq!(
        view_identity_v1(d(70), &later),
        base,
        "d_k follows from the selection and is not bound twice"
    );
}

#[rstest]
fn the_derived_frontier_binds_every_uniform_field() {
    let frontier = ViewFrontierV1 {
        chain_root: d(1),
        binding_id: d(2),
        binding_fact_digest: d(3),
        lineage_root: d(4),
        lineage_version: 5,
        source_frontier_digest: d(6),
        correction_stream: b"stream".to_vec(),
        correction_frontier_digest: d(7),
        instrument_master_key: d(8),
        market_semantics_identity: d(9),
        universe: (d(10), d(11)),
        clock_identity: "clock".to_owned(),
        clock_epoch: "epoch".to_owned(),
    };
    let base = derived_frontier_digest_v1(&frontier);
    let edits: [fn(&mut ViewFrontierV1); 14] = [
        |f| f.chain_root = d(99),
        |f| f.binding_id = d(99),
        |f| f.binding_fact_digest = d(99),
        |f| f.lineage_root = d(99),
        |f| f.lineage_version += 1,
        |f| f.source_frontier_digest = d(99),
        |f| f.correction_stream.push(b'x'),
        |f| f.correction_frontier_digest = d(99),
        |f| f.instrument_master_key = d(99),
        |f| f.market_semantics_identity = d(99),
        |f| f.universe.0 = d(99),
        |f| f.universe.1 = d(99),
        |f| f.clock_identity.push('x'),
        |f| f.clock_epoch.push('x'),
    ];

    for edit in edits {
        let mut edited = frontier.clone();
        edit(&mut edited);
        assert_ne!(derived_frontier_digest_v1(&edited), base);
    }
}

/// A run's frames are the window schedules' bar closes inside the run, each with the `d_k` its
/// view selects; a frame no view covers refuses the run, and schedules that disagree are refused.
#[rstest]
fn a_run_enumerates_the_frames_its_schedules_and_views_agree_on() {
    let window = (0, 7 * DAY);
    let btc = PitWindowScheduleFactV1::hourly_for_test(0, "BTCUSDT-PERP.BINANCE", 24, window);
    let eth = PitWindowScheduleFactV1::hourly_for_test(1, "ETHUSDT-PERP.BINANCE", 24, window);
    let sections = cross_sections_v1(&chain()).unwrap();
    let daily = timeframes(&[EXECUTION]);

    assert_eq!(
        enumerate_run_frames_v1(&[btc.clone(), eth], &sections, &daily, DAY, 4 * DAY),
        Ok(vec![
            (DAY, DAY + LAG),
            (2 * DAY, 2 * DAY + LAG),
            (3 * DAY, 3 * DAY + LAG)
        ])
    );
    assert_eq!(
        enumerate_run_frames_v1(
            std::slice::from_ref(&btc),
            &sections,
            &daily,
            DAY + 1,
            2 * DAY
        ),
        Ok(Vec::new()),
        "a run between two closes has no frame"
    );
    assert_eq!(
        enumerate_run_frames_v1(
            std::slice::from_ref(&btc),
            &sections,
            &daily,
            DAY,
            6 * DAY + 1
        ),
        Err(ViewRefusalV1::FrameNotCovered),
        "day 6 has no daily bar"
    );
    assert_eq!(
        enumerate_run_frames_v1(
            std::slice::from_ref(&btc),
            &sections,
            &timeframes(&[EXECUTION, TWO_DAY]),
            DAY,
            3 * DAY
        ),
        Err(ViewRefusalV1::FrameNotCovered),
        "during warm-up the two-day timeframe has no cross-section"
    );
    let four_hourly =
        PitWindowScheduleFactV1::hourly_for_test(1, "ETHUSDT-PERP.BINANCE", 4, window);
    assert_eq!(
        enumerate_run_frames_v1(&[btc, four_hourly], &sections, &daily, DAY, 3 * DAY),
        Err(ViewRefusalV1::Malformed)
    );
    assert_eq!(
        enumerate_run_frames_v1(&[], &sections, &daily, DAY, 3 * DAY),
        Err(ViewRefusalV1::Malformed)
    );
}
