//! The derived view of a PIT window custody chain (slice T0-5), proved on real PostgreSQL: a
//! run's frames read from its chain's head, and one frame's view read at the head a run pinned.

use super::{
    MarketDataOwnerPostgres,
    pit_window_custody_v1::PitWindowViewRefusalV1,
    pit_window_custody_v1_tests::{
        BTC, DAY, ETH, MINUTE, WINDOW_START, admit_members, after_close, commit, commit_binding,
        correction, original, owner, request, successor, universe, version_at,
    },
};
use crate::owner::{
    pit_window_custody_v1::{
        PitWindowCustodyReceiptV1, PitWindowRunRefusalV1, UntrustedCrossSectionVersionV1,
        UntrustedPitWindowCustodyClaimV1, UntrustedPitWindowCustodyFrameV1,
        UntrustedPitWindowCustodyRequestV1, UntrustedPitWindowRunV1, view::view_identity_v1,
    },
    source_binding::{
        BindingDigest, UntrustedSourceAvailabilityRuleV1, UntrustedSourceVisibilityV1,
    },
};

/// A committed custody chain whose run from day 1 to day 3 is covered, for proofs outside this
/// module: its root receipt, its correction successor's, and the run.
pub(in crate::owner) async fn corrected_custody_chain_fixture_v1(
    owner: &MarketDataOwnerPostgres,
) -> (
    PitWindowCustodyReceiptV1,
    PitWindowCustodyReceiptV1,
    UntrustedPitWindowRunV1,
) {
    let binding = commit_binding(owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(owner, &binding).await;
    let universe = universe(owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let template = two_timeframe_request(request(&binding, universe));
    let root = commit(&intake, template.clone()).await.expect("the root");
    let two_day_bar = WINDOW_START + 2 * DAY;
    let corrected = version_at_timeframe(owner, root.custody_identity(), two_day_bar).await;
    let head = commit(
        &intake,
        successor(
            &root,
            &template,
            vec![two_day_correction(corrected, two_day_bar + DAY / 2)],
        ),
    )
    .await
    .expect("the correction");
    let run = run(
        root.chain_root(),
        WINDOW_START + 2 * DAY,
        WINDOW_START + 4 * DAY,
    );
    (root, head, run)
}

pub(in crate::owner) fn run(
    chain_root: BindingDigest,
    start: u64,
    end: u64,
) -> UntrustedPitWindowRunV1 {
    UntrustedPitWindowRunV1 {
        custody: UntrustedPitWindowCustodyClaimV1 { chain_root },
        run_start_ns: start,
        run_end_ns_exclusive: end,
    }
}

fn frame(
    receipt: &PitWindowCustodyReceiptV1,
    head: BindingDigest,
    event_ns: u64,
) -> UntrustedPitWindowCustodyFrameV1 {
    UntrustedPitWindowCustodyFrameV1 {
        custody: UntrustedPitWindowCustodyClaimV1 {
            chain_root: receipt.chain_root(),
        },
        head_identity: head,
        event_ns,
    }
}

/// The identity of the view of `frame`, and the BTC CLOSE value of its execution bar.
async fn view_of(
    owner: &MarketDataOwnerPostgres,
    frame: &UntrustedPitWindowCustodyFrameV1,
) -> Result<(BindingDigest, Vec<BindingDigest>), PitWindowViewRefusalV1> {
    let view = owner.resolve_pit_window_view_v1(frame).await?;
    Ok((
        view_identity_v1(view.chain.root.rule_digest, &view.selection),
        view.selection
            .selected
            .iter()
            .map(|version| version.identity)
            .collect(),
    ))
}

/// A run reads dense frames, ordinal from 1, from its chain's head: each at a daily close with the
/// `d_k` its rule derives, two minutes later.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_run_reads_dense_frames_from_its_chain_head() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(
        &intake,
        with_gap_fill_bars(
            request(&binding, universe),
            &[WINDOW_START + DAY, WINDOW_START + 2 * DAY],
        ),
    )
    .await
    .unwrap();
    let frames = owner.pit_window_custody_frames_v1();

    let read = frames
        .resolve_pit_window_frames_v1(run(
            receipt.chain_root(),
            WINDOW_START + DAY,
            WINDOW_START + 3 * DAY,
        ))
        .await
        .expect("the run's frames are covered");
    assert_eq!(read.chain_root(), receipt.chain_root());
    assert_eq!(read.head_identity(), receipt.custody_identity());
    assert_eq!(read.head_digest(), receipt.custody_digest());
    assert_eq!(read.head_version(), 1);
    assert_eq!(
        read.frames()
            .iter()
            .map(|frame| (frame.ordinal(), frame.event_ns(), frame.decision_cut_ns()))
            .collect::<Vec<_>>(),
        [
            (1, WINDOW_START + DAY, WINDOW_START + DAY + 2 * MINUTE),
            (
                2,
                WINDOW_START + 2 * DAY,
                WINDOW_START + 2 * DAY + 2 * MINUTE
            ),
        ]
    );

    // Each frame's view reads the execution bar at its event, and nothing of the fill timeframe.
    let view = owner
        .resolve_pit_window_view_v1(&frame(&receipt, read.head_identity(), WINDOW_START + DAY))
        .await
        .unwrap();
    assert_eq!(view.selection.selected.len(), 1);
    assert_eq!(
        view.selection.selected[0].identity,
        version_at(&owner, receipt.custody_identity(), WINDOW_START + DAY).await
    );
    assert_eq!(view.rows.len(), 10);
    assert_eq!(view.schedules.len(), 2);
}

/// A run outside its window, naming no chain, empty, or holding no frame is refused by name.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_run_outside_its_window_or_chain_is_refused() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, request(&binding, universe)).await.unwrap();
    let frames = owner.pit_window_custody_frames_v1();
    let root = receipt.chain_root();
    let refused = |run| {
        let frames = frames.clone();
        async move { frames.resolve_pit_window_frames_v1(run).await.map(|_| ()) }
    };

    assert_eq!(
        refused(run(root, WINDOW_START + DAY, WINDOW_START + 4 * DAY)).await,
        Err(PitWindowRunRefusalV1::RunOutsideCustodyWindow)
    );
    assert_eq!(
        refused(run(root, WINDOW_START - 1, WINDOW_START + 2 * DAY)).await,
        Err(PitWindowRunRefusalV1::RunOutsideCustodyWindow)
    );
    assert_eq!(
        refused(run(
            BindingDigest::from_untrusted_bytes([7; 32]),
            WINDOW_START + DAY,
            WINDOW_START + 2 * DAY
        ))
        .await,
        Err(PitWindowRunRefusalV1::CustodyUnknown)
    );
    assert_eq!(
        refused(run(root, WINDOW_START + DAY, WINDOW_START + DAY)).await,
        Err(PitWindowRunRefusalV1::InvalidRequest)
    );
    assert_eq!(
        refused(run(root, WINDOW_START + DAY + 1, WINDOW_START + 2 * DAY)).await,
        Err(PitWindowRunRefusalV1::InvalidRequest),
        "a run between two closes holds no frame"
    );
}

/// A frame with no complete cross-section, here the window's first close, refuses the run.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_frame_without_a_complete_cross_section_refuses_the_run() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, request(&binding, universe)).await.unwrap();

    assert_eq!(
        owner
            .pit_window_custody_frames_v1()
            .resolve_pit_window_frames_v1(run(
                receipt.chain_root(),
                WINDOW_START,
                WINDOW_START + 3 * DAY
            ))
            .await
            .map(|_| ()),
        Err(PitWindowRunRefusalV1::FrameNotCovered)
    );
    assert_eq!(
        view_of(
            &owner,
            &frame(&receipt, receipt.custody_identity(), WINDOW_START)
        )
        .await
        .map(|_| ()),
        Err(PitWindowViewRefusalV1::FrameNotCovered)
    );
}

/// The falsifier of the minting instant: under a rule set to the retrieval instant, every
/// backfilled bar is available at the minting cut, long after the next frame, so no frame is
/// covered.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_availability_rule_at_the_minting_instant_hides_every_frame() {
    let owner = owner().await;
    let binding = commit_binding(
        &owner,
        "synthetic/at-retrieval",
        1,
        Some(UntrustedSourceAvailabilityRuleV1 {
            visibility: UntrustedSourceVisibilityV1::AtRetrieval,
            publishes_corrections: false,
        }),
    )
    .await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, request(&binding, universe)).await.unwrap();
    let frames = owner.pit_window_custody_frames_v1();

    for event in [WINDOW_START + DAY, WINDOW_START + 2 * DAY] {
        assert_eq!(
            frames
                .resolve_pit_window_frames_v1(run(receipt.chain_root(), event, event + 1))
                .await
                .map(|_| ()),
            Err(PitWindowRunRefusalV1::FrameNotCovered)
        );
    }
}

/// `request` with its minute fill bars replaced by one closing five minutes after each of
/// `events`: it opens at `e_k + 4 minutes`, strictly after the `after_close` rule's `d_k`, so each
/// frame at those events has a quote for its gap. Cross-sections stay in canonical order.
pub(in crate::owner) fn with_gap_fill_bars(
    mut request: UntrustedPitWindowCustodyRequestV1,
    events: &[u64],
) -> UntrustedPitWindowCustodyRequestV1 {
    request.fill_timeframe = Some("1M".to_owned());
    request
        .cross_sections
        .retain(|version| version.timeframe != "1M");
    request.cross_sections.extend(
        events
            .iter()
            .map(|event| original("1M", event + 5 * MINUTE)),
    );
    in_canonical_order(request)
}

/// `request` with its cross-sections in the canonical order a commit requires: by timeframe label,
/// event and sequence.
pub(in crate::owner) fn in_canonical_order(
    mut request: UntrustedPitWindowCustodyRequestV1,
) -> UntrustedPitWindowCustodyRequestV1 {
    request.cross_sections.sort_by(|left, right| {
        (
            &left.timeframe,
            left.event_effective_ns,
            left.correction_sequence,
        )
            .cmp(&(
                &right.timeframe,
                right.event_effective_ns,
                right.correction_sequence,
            ))
    });
    request
}

/// Daily execution bars at days 1 to 3, two-day input bars at days 0 and 2, and a fill bar in
/// each daily frame's gap, over four days.
pub(super) fn two_timeframe_request(
    template: UntrustedPitWindowCustodyRequestV1,
) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = template;
    request.window_end_ns_exclusive = WINDOW_START + 4 * DAY;
    request.input_timeframes = vec!["1D".to_owned(), "2D".to_owned()];
    request.cross_sections = vec![
        original("1D", WINDOW_START + DAY),
        original("1D", WINDOW_START + 2 * DAY),
        original("1D", WINDOW_START + 3 * DAY),
        original("2D", WINDOW_START),
        original("2D", WINDOW_START + 2 * DAY),
    ];
    with_gap_fill_bars(
        request,
        &[
            WINDOW_START + DAY,
            WINDOW_START + 2 * DAY,
            WINDOW_START + 3 * DAY,
        ],
    )
}

/// The run-level half of T0-5 ruling Q1: a run whose middle frame's gap holds no fill bar is
/// refused as `QuoteCutMissing` by the frames port itself, before any frame is read, by the
/// predicate each frame's quote cut applies. Runs of frame 1 or frame 3 alone, each gap bounded by
/// the next frame or the run's end, and the same run over a custody with that gap's fill bar, read
/// their frames, so the refusal is that gap's alone.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_run_with_a_gap_without_a_quote_is_refused_before_any_frame_is_read() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let intake = owner.pit_window_custody_commit_v1();
    let frames = owner.pit_window_custody_frames_v1();
    let days = [
        WINDOW_START + DAY,
        WINDOW_START + 2 * DAY,
        WINDOW_START + 3 * DAY,
    ];
    let mut missing_middle = two_timeframe_request(request(
        &binding,
        universe(&owner, &binding, 10, None).await,
    ));
    missing_middle = with_gap_fill_bars(missing_middle, &[days[0], days[2]]);
    let gapped = commit(&intake, missing_middle).await.expect("the custody");
    let complete = commit(
        &intake,
        two_timeframe_request(request(
            &binding,
            universe(&owner, &binding, 11, None).await,
        )),
    )
    .await
    .expect("the custody with every gap's fill bar");
    let read = |root, start, end| {
        let frames = frames.clone();
        async move {
            frames
                .resolve_pit_window_frames_v1(run(root, start, end))
                .await
                .map(|read| read.frames().len())
        }
    };
    let run_end = WINDOW_START + 4 * DAY;

    assert_eq!(
        read(gapped.chain_root(), days[0], run_end).await,
        Err(PitWindowRunRefusalV1::QuoteCutMissing),
        "frame 2's gap has no quote, so the run is refused"
    );
    assert_eq!(
        read(gapped.chain_root(), days[1], days[2]).await,
        Err(PitWindowRunRefusalV1::QuoteCutMissing),
        "a run of frame 2 alone is refused for the same gap"
    );
    assert_eq!(
        read(gapped.chain_root(), days[0], days[1]).await,
        Ok(1),
        "a run of frame 1 alone has its quote"
    );
    assert_eq!(
        read(gapped.chain_root(), days[2], run_end).await,
        Ok(1),
        "and so does a run of frame 3 alone"
    );
    assert_eq!(
        read(complete.chain_root(), days[0], run_end).await,
        Ok(3),
        "the same run over a custody holding frame 2's fill bar reads all three frames"
    );
}

/// A correction of the two-day bar of day 2, published at `publication_ns`.
pub(super) fn two_day_correction(
    predecessor: BindingDigest,
    publication_ns: u64,
) -> UntrustedCrossSectionVersionV1 {
    let mut version = correction(WINDOW_START + 2 * DAY, predecessor, 2, publication_ns);
    version.timeframe = "2D".to_owned();
    version
}

/// The correction falsifier (ruling Q10): two custodies differing only in whether one correction
/// publishes before frame 3's `d_k` yield different frame 3 views and the same views elsewhere.
/// Frame 2 decides before either correction is published, so removing the publication condition
/// turns it red.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_correction_published_before_d_k_changes_only_frame_k() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(&owner, &binding).await;
    let intake = owner.pit_window_custody_commit_v1();
    let two_day_bar = WINDOW_START + 2 * DAY;
    let d_3 = WINDOW_START + 3 * DAY + 2 * MINUTE;
    let mut heads = Vec::new();

    // Two roots that differ only in their Universe Selection record, so each is a chain of its
    // own; each corrects the same two-day bar, once before frame 3's `d_k` and once after.
    for (frontier, publication) in [(10, two_day_bar + DAY / 2), (11, d_3 + MINUTE)] {
        let universe = universe(&owner, &binding, frontier, None).await;
        let template = two_timeframe_request(request(&binding, universe));
        let root = commit(&intake, template.clone()).await.expect("the root");
        let corrected = version_at_timeframe(&owner, root.custody_identity(), two_day_bar).await;
        let head = commit(
            &intake,
            successor(
                &root,
                &template,
                vec![two_day_correction(corrected, publication)],
            ),
        )
        .await
        .expect("the correction");
        heads.push((root, head));
    }
    let (early_root, early_head) = &heads[0];
    let (late_root, late_head) = &heads[1];

    for day in 1..=3 {
        let event = WINDOW_START + day * DAY;
        let early = view_of(
            &owner,
            &frame(early_root, early_head.custody_identity(), event),
        )
        .await
        .unwrap();
        let late = view_of(
            &owner,
            &frame(late_root, late_head.custody_identity(), event),
        )
        .await
        .unwrap();

        if day == 3 {
            assert_ne!(
                early.0, late.0,
                "frame 3 reads the correction only where it was published before d_3"
            );
            assert_eq!(early.1[0], late.1[0], "its execution bar is the same");
        } else {
            assert_eq!(early, late, "frame {day} decides before either correction");
        }
    }
}

/// The two-day version a custody holds at `event`: the one at `event` whose timeframe is not the
/// daily bar's, which alone closes at day 1.
pub(super) async fn version_at_timeframe(
    owner: &MarketDataOwnerPostgres,
    custody: BindingDigest,
    event: u64,
) -> BindingDigest {
    let daily: Vec<u8> = sqlx::query_scalar(
        "SELECT timeframe_identity FROM market_data_private.pit_window_cross_section_versions_v1 WHERE custody_identity=$1 AND event_ns=$2",
    )
    .bind(custody.as_bytes().as_slice())
    .bind(i64::try_from(WINDOW_START + DAY).unwrap())
    .fetch_one(owner.pool())
    .await
    .unwrap();
    let bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT version_identity FROM market_data_private.pit_window_cross_section_versions_v1 WHERE custody_identity=$1 AND event_ns=$2 AND timeframe_identity<>$3",
    )
    .bind(custody.as_bytes().as_slice())
    .bind(i64::try_from(event).unwrap())
    .bind(daily)
    .fetch_one(owner.pool())
    .await
    .unwrap();
    BindingDigest::from_untrusted_bytes(bytes.try_into().unwrap())
}

/// A frame read at a pinned head reads the view at that head; a head of another chain is refused.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_pinned_head_reads_the_view_at_that_head_and_a_foreign_head_is_refused() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(&owner, &binding).await;
    let intake = owner.pit_window_custody_commit_v1();
    let universe_a = universe(&owner, &binding, 10, None).await;
    let template = two_timeframe_request(request(&binding, universe_a));
    let root = commit(&intake, template.clone()).await.unwrap();
    let two_day_bar = WINDOW_START + 2 * DAY;
    let original_version = version_at_timeframe(&owner, root.custody_identity(), two_day_bar).await;
    let frames = owner.pit_window_custody_frames_v1();
    let pinned = frames
        .resolve_pit_window_frames_v1(run(
            root.chain_root(),
            WINDOW_START + 2 * DAY,
            WINDOW_START + 4 * DAY,
        ))
        .await
        .expect("the run reads at the root");
    assert_eq!(pinned.head_identity(), root.custody_identity());

    let head = commit(
        &intake,
        successor(
            &root,
            &template,
            vec![two_day_correction(original_version, two_day_bar + DAY / 2)],
        ),
    )
    .await
    .unwrap();
    let event = WINDOW_START + 3 * DAY;
    let at_root = view_of(&owner, &frame(&root, pinned.head_identity(), event))
        .await
        .unwrap();
    let at_head = view_of(&owner, &frame(&root, head.custody_identity(), event))
        .await
        .unwrap();
    assert!(
        at_root.1.contains(&original_version),
        "the pinned root reads the original"
    );
    assert!(
        !at_head.1.contains(&original_version),
        "the head reads the correction"
    );
    assert_eq!(
        frames
            .resolve_pit_window_frames_v1(run(
                root.chain_root(),
                WINDOW_START + 2 * DAY,
                WINDOW_START + 4 * DAY
            ))
            .await
            .unwrap()
            .head_identity(),
        head.custody_identity(),
        "a new run reads the moved head"
    );

    let universe_b = universe(&owner, &binding, 11, None).await;
    let other = commit(
        &intake,
        two_timeframe_request(request(&binding, universe_b)),
    )
    .await
    .unwrap();
    assert_eq!(
        view_of(&owner, &frame(&root, other.custody_identity(), event))
            .await
            .map(|_| ()),
        Err(PitWindowViewRefusalV1::HeadNotInChain)
    );
}

/// Seals a resolved view as the native resolver does; a refused seal is the store's.
pub(super) fn seal(
    view: &super::pit_window_custody_v1::ResolvedPitWindowViewV1,
) -> Result<crate::owner::pit_snapshot::VerifiedPitObservationBatch, PitWindowViewRefusalV1> {
    crate::owner::pit_snapshot::custody_view::verify_custody_view_batch_v1(
        crate::owner::pit_snapshot::custody_view::CustodyViewInputsV1 {
            chain_root: view.chain.chain_root,
            record: &view.chain.root,
            clock: &view.chain.root_clock,
            selection: &view.selection,
            rows: &view.rows,
        },
    )
    .map_err(|_| PitWindowViewRefusalV1::StoreUnavailable)
}

/// A stored custody whose record, versions or rows were edited behind its digests is refused, and
/// the untouched one seals: its prices, stored at the fixed value scale, read back canonical.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_tampered_custody_row_refuses_the_view() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, request(&binding, universe)).await.unwrap();
    let at = frame(&receipt, receipt.custody_identity(), WINDOW_START + DAY);
    let view = owner
        .resolve_pit_window_view_v1(&at)
        .await
        .expect("the view resolves");
    let close = view
        .rows
        .iter()
        .find(|row| row.member_ordinal == 0 && row.field == "CLOSE")
        .expect("BTC's close")
        .fact
        .row();
    assert_eq!(
        (close.value_mantissa, close.value_scale),
        (6_500_003 * 10_i128.pow(7), 9),
        "custody stores 65000.03 at the fixed value scale"
    );
    let batch = seal(&view).expect("a custody of real prices seals its view");
    let value = |field: &str| {
        let row = batch
            .select(&format!("{BTC}.{field}.1D"), BTC)
            .expect("the field");
        (row.value_mantissa(), row.value_scale())
    };
    assert_eq!(value("CLOSE"), (6_500_003, 2), "65000.03");
    assert_eq!(value("OPEN"), (65_000, 0), "65000.00, canonically 65000");
    assert_eq!(value("VOLUME"), (6_500_004, 0));
    let tampers = [
        "UPDATE market_data_private.pit_window_cross_section_versions_v1 SET availability_ns=availability_ns+1 WHERE custody_identity=$1",
        "UPDATE market_data_private.pit_window_custodies_v1 SET minting_clock_sequence=minting_clock_sequence+1 WHERE custody_identity=$1",
        "UPDATE market_data_private.pit_window_custody_rows_v1 SET field='OPEN' WHERE custody_identity=$1 AND field='CLOSE' AND member_ordinal=0",
    ];

    for tamper in tampers {
        let mut transaction = owner.pool().begin().await.unwrap();
        sqlx::query(tamper)
            .bind(receipt.custody_identity().as_bytes().as_slice())
            .execute(&mut *transaction)
            .await
            .unwrap();
        // Read inside the tampering transaction, then discard it, so each tamper stands alone.
        let view = super::pit_window_custody_v1::resolve_pit_window_view_in_transaction_v1(
            &mut transaction,
            &at,
        )
        .await;
        let sealed = view.and_then(|view| seal(&view).map(|_| ()));
        assert_eq!(
            sealed,
            Err(PitWindowViewRefusalV1::StoreUnavailable),
            "{tamper}"
        );
        transaction.rollback().await.unwrap();
    }
    let view = owner.resolve_pit_window_view_v1(&at).await.unwrap();
    assert!(seal(&view).is_ok(), "every tamper was discarded");
}

/// A run's frames carry the basis their chain's records hold: the root custody's Universe
/// Selection, its Instrument Master cut and its Market Semantics fact and value, its members and
/// window. The basis is pinned to the head the frames were read from, and it is the root's: a
/// successor, which restates that basis, moves the head and leaves the basis the root committed.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_run_carries_its_root_chain_basis_at_the_head_it_read() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(&owner, &binding).await;
    let intake = owner.pit_window_custody_commit_v1();
    let universe_a = universe(&owner, &binding, 10, None).await;
    let template = two_timeframe_request(request(&binding, universe_a));
    let root = commit(&intake, template.clone()).await.unwrap();
    let frames = owner.pit_window_custody_frames_v1();
    let read = |run| {
        let frames = frames.clone();
        async move { frames.resolve_pit_window_frames_v1(run).await }
    };
    let at_root = read(run(
        root.chain_root(),
        WINDOW_START + 2 * DAY,
        WINDOW_START + 4 * DAY,
    ))
    .await
    .expect("the run reads at the root");
    let basis = at_root.basis();

    let mut transaction = owner.pool().begin().await.unwrap();
    let (_, _, (link, cut), (market_semantics, _)) =
        super::pit_window_custody_v1::read_pit_window_chain_basis_v1(
            &mut transaction,
            root.chain_root(),
        )
        .await
        .unwrap()
        .expect("the root committed its chain records");
    transaction.rollback().await.unwrap();
    assert_eq!(basis.chain_root(), root.chain_root());
    assert_eq!(basis.head_identity(), root.custody_identity());
    assert_eq!(basis.universe_selection(), universe_a);
    assert_eq!(basis.instrument_master_cut(), &cut);
    assert_eq!(
        basis.instrument_master_cut().cut().identity(),
        link.cut_identity
    );
    assert_eq!(
        basis.market_semantics_identity(),
        template.market_semantics_identity
    );
    assert_eq!(
        basis.market_semantics_identity(),
        market_semantics.compatibility_scope_identity
    );
    assert_eq!(basis.market_semantics_value(), &market_semantics.value);
    assert_eq!(basis.members(), [BTC, ETH]);
    assert_eq!(basis.window(), (WINDOW_START, WINDOW_START + 4 * DAY));

    // The basis's Instrument Master key is the root record's, the chain link's, and the digest
    // every frame's view batch carries.
    assert_eq!(basis.instrument_master_key(), link.instrument_master_key);
    assert!(!at_root.frames().is_empty());

    for coordinate in at_root.frames() {
        let view = owner
            .resolve_pit_window_view_v1(&frame(
                &root,
                root.custody_identity(),
                coordinate.event_ns(),
            ))
            .await
            .expect("each frame's view resolves");
        let batch = seal(&view).expect("each frame's view seals");
        assert_eq!(
            batch.instrument_master_digest(),
            basis.instrument_master_key(),
            "frame {} carries the basis's Instrument Master key",
            coordinate.ordinal()
        );
    }

    // The root's locator resolves to the record the universe intake stored for it, and R&D's read
    // by that record returns exactly the custody's members.
    let mut transaction = owner.pool().begin().await.unwrap();
    let stored = super::universe_selection::recover_universe_selection_in_transaction_v1(
        &mut transaction,
        &universe_a,
    )
    .await
    .expect("the universe intake stored the root's selection");
    transaction.rollback().await.unwrap();
    assert_eq!(
        basis.universe_selection_record(),
        (stored.record().identity(), stored.record().digest()),
        "the basis names the universe intake's record"
    );
    let (record_identity, record_digest) = basis.universe_selection_record();
    let mut transaction = owner.pool().begin().await.unwrap();
    let members = crate::owner::read_universe_selection_members_for_rd_v1(
        &mut transaction,
        record_identity,
        record_digest,
    )
    .await
    .expect("R&D reads the custody's members by the basis's record");
    transaction.rollback().await.unwrap();
    assert_eq!(
        members
            .members()
            .iter()
            .map(crate::owner::universe_selection::UniverseSelectionMemberForRdV1::instrument)
            .collect::<Vec<_>>(),
        basis.members(),
        "the record's members are exactly the custody's"
    );

    // A successor restating its root's basis, the same Universe Selection record included.
    let two_day_bar = WINDOW_START + 2 * DAY;
    let corrected = version_at_timeframe(&owner, root.custody_identity(), two_day_bar).await;
    let head = commit(
        &intake,
        successor(
            &root,
            &template,
            vec![two_day_correction(corrected, two_day_bar + DAY / 2)],
        ),
    )
    .await
    .expect("a successor restating its root's basis extends the chain");
    let at_head = read(run(
        root.chain_root(),
        WINDOW_START + 2 * DAY,
        WINDOW_START + 4 * DAY,
    ))
    .await
    .expect("the run reads at the head");
    assert_eq!(at_head.head_identity(), head.custody_identity());
    assert_eq!(at_head.basis().head_identity(), head.custody_identity());
    assert_eq!(at_head.basis().universe_selection(), universe_a);
    assert_eq!(
        at_head.basis().universe_selection_record(),
        basis.universe_selection_record()
    );
    assert_eq!(
        at_head.basis().instrument_master_key(),
        basis.instrument_master_key()
    );
    assert_eq!(at_head.basis().chain_root(), basis.chain_root());
    assert_eq!(
        at_head.basis().instrument_master_cut(),
        basis.instrument_master_cut()
    );
    assert_eq!(
        at_head.basis().market_semantics_value(),
        basis.market_semantics_value()
    );
    assert_eq!(at_head.basis().members(), basis.members());
    assert_eq!(at_head.basis().window(), basis.window());
    assert_eq!(
        at_root.basis().head_identity(),
        root.custody_identity(),
        "frames read before the successor keep the head they were read from"
    );
}

/// An in-memory edit of a chain readback, made after every record's own readback accepted it.
type ReadbackEdit = fn(&mut super::pit_window_custody_v1::ChainBasisReadbackV1, BindingDigest);

/// A run whose chain holds no basis record, whose root's Universe Selection the read does not hold
/// or holds another one, a basis record edited behind its identity, or a Market
/// Semantics fact forged consistently - restated under another value, with its registry entry and
/// basis record re-sealed so every record's own readback accepts it - is refused rather than
/// answered in part: the forged value differs from the one the root custody's record binds. Every
/// edit is made in a transaction that is discarded, and none removes a row.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_run_without_its_verified_chain_basis_is_refused() {
    use super::{
        pit_window_custody_v1::{
            frames_from_evidence_v1, load_chain_evidence_v1, read_pit_window_chain_basis_v1,
            resolve_pit_window_frames_in_transaction_v1,
        },
        universe_selection::read_universe_selection_by_request_v1,
    };
    use crate::owner::pit_window_custody_v1::chain_records::{
        issue_chain_basis_record_v1, issue_market_semantics_chain_registry_entry_v1,
        restate_market_semantics_chain_fact_v1,
    };

    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    // Both frames' gaps hold a fill bar, so the run is answered unless its basis is not verified.
    let template = with_gap_fill_bars(
        request(&binding, universe),
        &[WINDOW_START + DAY, WINDOW_START + 2 * DAY],
    );
    let receipt = commit(&intake, template.clone()).await.unwrap();
    let chain_root = receipt.chain_root();
    let covered = run(chain_root, WINDOW_START + DAY, WINDOW_START + 3 * DAY);
    let root = chain_root.as_bytes().as_slice();

    // A chain holding no basis record - one the T0-4c commit did not complete - is refused, where
    // the same evidence with its basis is answered; so is a chain whose root's Universe Selection
    // the read does not hold, or whose read holds a selection the root's locator does not name.
    let read = |request_identity| {
        let pool = owner.pool().clone();
        async move {
            let mut transaction = pool.begin().await.unwrap();
            let evidence = load_chain_evidence_v1(&mut transaction, chain_root)
                .await
                .unwrap();
            let readback = read_pit_window_chain_basis_v1(&mut transaction, chain_root)
                .await
                .unwrap();
            let selection =
                read_universe_selection_by_request_v1(&mut transaction, request_identity)
                    .await
                    .unwrap();
            transaction.rollback().await.unwrap();
            (evidence, readback, selection)
        }
    };
    let (evidence, readback, selection) = read(universe.request_identity()).await;
    assert!(frames_from_evidence_v1(covered, evidence, readback, selection).is_ok());
    let (evidence, _, selection) = read(universe.request_identity()).await;
    assert_eq!(
        frames_from_evidence_v1(covered, evidence, None, selection).map(|_| ()),
        Err(PitWindowRunRefusalV1::StoreUnavailable),
        "a chain without a basis gets no partial answer"
    );
    let (evidence, readback, _) = read(universe.request_identity()).await;
    assert_eq!(
        frames_from_evidence_v1(covered, evidence, readback, None).map(|_| ()),
        Err(PitWindowRunRefusalV1::StoreUnavailable),
        "a root whose selection record is missing is refused"
    );
    let other = super::pit_window_custody_v1_tests::universe(&owner, &binding, 20, None).await;
    let (evidence, readback, foreign) = read(other.request_identity()).await;
    assert!(foreign.is_some(), "the other selection is stored");
    assert_eq!(
        frames_from_evidence_v1(covered, evidence, readback, foreign).map(|_| ()),
        Err(PitWindowRunRefusalV1::StoreUnavailable),
        "a selection the root's locator does not name is refused"
    );

    // Records that each verify on their own but disagree with each other: the universe evaluated
    // over another lineage than the R0 record's binding (the Market Semantics fact moved with it,
    // so only the universe check sees it), and a Market Semantics fact naming another R0 record,
    // R0 cut, Instrument Master cut, binding or frontier than the chain's.
    let other_digest = BindingDigest::from_untrusted_bytes([0xEE; 32]);
    let edits: [(&str, ReadbackEdit); 8] = [
        ("universe lineage", |r, d| {
            r.1.0.source_binding_lineage_root = d;
            r.3.0.source_binding_lineage_root = d;
        }),
        ("universe correction frontier", |r, d| {
            r.1.0.correction_frontier.digest = d;
            r.3.0.correction_frontier_digest = d;
        }),
        ("Market Semantics R0 record", |r, d| {
            r.3.0.r0_record_identity = d;
        }),
        ("Market Semantics R0 cut", |r, d| {
            r.3.0.r0_cut_identity = d;
        }),
        ("Market Semantics Instrument Master cut", |r, d| {
            r.3.0.instrument_master_cut_identity = d;
        }),
        ("Market Semantics binding", |r, d| {
            r.3.0.source_binding_identity = d;
        }),
        ("Market Semantics binding fact", |r, d| {
            r.3.0.source_binding_fact_digest = d;
        }),
        ("Market Semantics source frontier", |r, d| {
            r.3.0.source_frontier_digest = d;
        }),
    ];

    for (name, edit) in edits {
        let (evidence, readback, selection) = read(universe.request_identity()).await;
        let mut readback = readback.expect("the chain holds its basis");
        edit(&mut readback, other_digest);
        assert_eq!(
            frames_from_evidence_v1(covered, evidence, Some(readback), selection).map(|_| ()),
            Err(PitWindowRunRefusalV1::StoreUnavailable),
            "a basis whose {name} disagrees is refused"
        );
    }

    // A basis record edited behind its identity.
    let mut transaction = owner.pool().begin().await.unwrap();
    sqlx::query("UPDATE market_data_private.pit_window_chain_basis_records_v1 SET basis_bytes=basis_bytes||'\\x00'::bytea WHERE chain_root=$1")
        .bind(root)
        .execute(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(
        resolve_pit_window_frames_in_transaction_v1(&mut transaction, covered)
            .await
            .map(|_| ()),
        Err(PitWindowRunRefusalV1::StoreUnavailable)
    );
    transaction.rollback().await.unwrap();

    // The forgery: the chain's Market Semantics fact restated under another normalisation.
    let mut transaction = owner.pool().begin().await.unwrap();
    let (basis, (r0_record, r0_cut), (link, _), (fact, registry)) =
        read_pit_window_chain_basis_v1(&mut transaction, chain_root)
            .await
            .unwrap()
            .expect("the root committed its chain records");
    let mut value = fact.value;
    value.normalization_identity = BindingDigest::from_untrusted_bytes([99; 32]);
    let forged_registry = issue_market_semantics_chain_registry_entry_v1(
        [
            fact.compatibility_scope_identity,
            chain_root,
            link.identity(),
            r0_record.identity(),
            r0_cut.identity(),
        ],
        value,
    )
    .unwrap();
    assert_eq!(
        forged_registry.key_identity, registry.key_identity,
        "the forged entry takes the committed one's key"
    );
    let forged_fact =
        restate_market_semantics_chain_fact_v1(&fact, value, forged_registry.identity()).unwrap();
    let forged_basis = issue_chain_basis_record_v1(
        chain_root,
        basis.root_custody_identity,
        basis.r0_record_identity,
        basis.r0_cut_identity,
        basis.instrument_master_link_identity,
        forged_fact.identity(),
    )
    .unwrap();

    // Nothing is removed: the committed fact and registry entry step aside - the entry under
    // another key, the fact under another chain root - and the forged ones take their places, which
    // the chain's head and basis record are moved to.
    let aside = BindingDigest::from_untrusted_bytes([98; 32]);
    sqlx::query("UPDATE market_data_private.market_semantics_chain_registry_v1 SET registry_key_identity=$2,registry_key_bytes=$2 WHERE record_identity=$1")
        .bind(registry.identity().as_bytes().as_slice())
        .bind(aside.as_bytes().as_slice())
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("UPDATE market_data_private.market_semantics_chain_facts_v1 SET chain_root=$2 WHERE chain_root=$1")
        .bind(root)
        .bind(aside.as_bytes().as_slice())
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("INSERT INTO market_data_private.market_semantics_chain_registry_v1(registry_key_identity,registry_key_bytes,record_identity,record_bytes) VALUES($1,$2,$3,$4)")
        .bind(forged_registry.key_identity.as_bytes().as_slice())
        .bind(forged_registry.key_bytes.as_slice())
        .bind(forged_registry.identity().as_bytes().as_slice())
        .bind(forged_registry.canonical_bytes())
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("INSERT INTO market_data_private.market_semantics_chain_facts_v1(fact_identity,compatibility_scope_identity,chain_root,registry_record_identity,fact_bytes) VALUES($1,$2,$3,$4,$5)")
        .bind(forged_fact.identity().as_bytes().as_slice())
        .bind(forged_fact.compatibility_scope_identity.as_bytes().as_slice())
        .bind(root)
        .bind(forged_registry.identity().as_bytes().as_slice())
        .bind(forged_fact.canonical_bytes())
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("UPDATE market_data_private.market_semantics_chain_heads_v1 SET fact_identity=$2 WHERE chain_root=$1")
        .bind(root)
        .bind(forged_fact.identity().as_bytes().as_slice())
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("UPDATE market_data_private.pit_window_chain_basis_records_v1 SET basis_identity=$2,basis_bytes=$3,market_semantics_fact_identity=$4 WHERE chain_root=$1")
        .bind(root)
        .bind(forged_basis.identity().as_bytes().as_slice())
        .bind(forged_basis.canonical_bytes())
        .bind(forged_fact.identity().as_bytes().as_slice())
        .execute(&mut *transaction)
        .await
        .unwrap();
    let (_, _, _, (read_back, _)) = read_pit_window_chain_basis_v1(&mut transaction, chain_root)
        .await
        .expect("every record's own readback accepts the forgery")
        .expect("the forged records are held");
    assert_eq!(
        read_back.value, value,
        "the chain records now state the forged value"
    );
    assert_eq!(
        resolve_pit_window_frames_in_transaction_v1(&mut transaction, covered)
            .await
            .map(|_| ()),
        Err(PitWindowRunRefusalV1::StoreUnavailable),
        "the root custody's record binds the committed value"
    );
    transaction.rollback().await.unwrap();

    let frames = owner
        .pit_window_custody_frames_v1()
        .resolve_pit_window_frames_v1(covered)
        .await
        .expect("every tamper was discarded");
    assert_eq!(frames.basis().market_semantics_value(), &fact.value);
}
