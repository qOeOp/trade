//! A native Replay custody frame resolved on Owner custody (slice T0-5), proved on real
//! PostgreSQL: on the same rows it is the snapshot frame, it reads exactly the head its request
//! pins, and with no derived quote cut it is refused rather than given an invented one.
//!
//! Until T0-6 the quote cut is injected through the resolver's closure; the production resolver
//! refuses every gap, which the last proof drives.

use vibe_model::identifiers::InstrumentId;

use super::{
    MarketDataReadPostgres,
    native_replay_custody_frame_v1::resolve_native_replay_custody_frame_from_pool_v1,
    pit_window_custody_v1::ResolvedPitWindowViewV1,
    pit_window_custody_v1_tests::{
        BTC, DAY, ETH, MINUTE, WINDOW_START, admit_members, after_close, commit, commit_binding,
        original, owner, request, rows_of, successor, universe,
    },
    pit_window_view_v1_tests::{
        seal, two_day_correction, two_timeframe_request, version_at_timeframe,
    },
};
use crate::owner::{
    decimal_rescale_v1::MARKET_DATA_VALUE_SCALE_V1,
    native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2,
    native_replay_scheduling_v1::{
        NativeReplayCustodyFrameReadbackV1, NativeReplayInitialMarketReadbackV1,
        NativeReplayInitialMarketRequestV1, NativeReplayInitialUniverseRoleV1,
        NativeReplaySchedulingErrorV1, NativeReplaySchedulingResolverV1,
    },
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{
            CustodyQuoteCutInputsV1, CustodyQuoteRowV1, verify_custody_quote_cut_batch_v1,
        },
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, PitWindowCustodyReceiptV1, QuoteDerivationV1,
        UntrustedCrossSectionVersionV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowCustodyFrameV1, UntrustedPitWindowCustodyRequestV1,
        quote_cut::CustodyQuoteCutRequestV1, view::view_identity_v1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, derive_universe_selection,
    },
};

/// A daily bar: open, high, low and close to the cent, and its volume. Every price has a nonzero
/// cent, so the four state one canonical precision.
const BAR: [(&str, i128, u8); 5] = [
    ("OPEN", 6_500_012, 2),
    ("HIGH", 6_540_037, 2),
    ("LOW", 6_480_051, 2),
    ("CLOSE", 6_521_033, 2),
    ("VOLUME", 1_234, 0),
];

/// `request` with every row of every cross-section stating `bar`, so each one is a bar the engine
/// can hold.
/// A bar on today's BTCUSDT tick, 0.10: 65000.10, 65400.00, 64800.50 and 65210.30 state
/// precisions 1, 0, 1 and 1 once each is canonical.
const MIXED_PRECISION_BAR: [(&str, i128, u8); 5] = [
    ("OPEN", 6_500_010, 2),
    ("HIGH", 6_540_000, 2),
    ("LOW", 6_480_050, 2),
    ("CLOSE", 6_521_030, 2),
    ("VOLUME", 1_234, 0),
];

fn stating_bar(
    mut request: UntrustedPitWindowCustodyRequestV1,
    bar: [(&str, i128, u8); 5],
) -> UntrustedPitWindowCustodyRequestV1 {
    for version in &mut request.cross_sections {
        for row in &mut version.rows {
            let (_, mantissa, scale) = bar
                .iter()
                .find(|(field, _, _)| *field == row.field)
                .expect("a BAR field");
            row.value_mantissa = *mantissa;
            row.value_scale = *scale;
        }
    }
    request
}

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn frame_at(
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

/// A Research request for `frame` whose roles read the execution bar's close and open, on the
/// coordinates the custody's root records and the universe its view derives.
pub(in crate::owner) fn custody_request(
    view: &ResolvedPitWindowViewV1,
    frame: UntrustedPitWindowCustodyFrameV1,
    run_end_ns_exclusive: u64,
) -> NativeReplayInitialMarketRequestV1 {
    let root = &view.chain.root;
    let batch = seal(view).expect("the view seals");
    let selection = derive_universe_selection(&batch).expect("the view derives its universe");
    NativeReplayInitialMarketRequestV1::for_custody_frame(
        frame,
        d(1),
        d(2),
        selection.selection_identity(),
        selection.selection_digest(),
        root.universe.0,
        root.universe.1,
        root.instrument_master_key,
        root.lineage_root,
        root.market_semantics_identity,
        [
            (42, MarketDataFieldSemantic::BarClosePrice),
            (43, MarketDataFieldSemantic::BarOpenPrice),
        ]
        .into_iter()
        .map(|(identity, field)| {
            NativeReplayInitialUniverseRoleV1::new(
                d(identity),
                field,
                StrategyInputChannel::Market,
                root.execution.label.clone(),
                field.unit(),
                MARKET_DATA_VALUE_SCALE_V1,
            )
        })
        .collect(),
        root.members
            .iter()
            .map(|member| InstrumentId::from(member.as_str()))
            .collect(),
        run_end_ns_exclusive,
    )
}

/// An observed best bid and offer for each of `members`, in member order.
pub(in crate::owner) fn quote_rows(members: &[String]) -> Vec<CustodyQuoteRowV1> {
    members
        .iter()
        .flat_map(|member| {
            ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"]
                .into_iter()
                .zip([6_500_101, 6_500_103, 15, 17])
                .map(|(field, value_mantissa)| CustodyQuoteRowV1 {
                    instrument: member.clone(),
                    field,
                    value_mantissa,
                    value_scale: if field.ends_with("PRICE") { 2 } else { 0 },
                })
        })
        .collect()
}

/// The quote cut a derivation would seal for the gap, injected `after_d_k` past the decision cut.
pub(in crate::owner) fn injected_quote_cut(
    rows: &[CustodyQuoteRowV1],
    after_d_k: u64,
) -> impl FnOnce(
    &VerifiedPitObservationBatch,
    &CustodyQuoteCutRequestV1,
) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2>
+ Send
+ '_ {
    move |view, request| {
        let instant_ns = request.decision_cut_ns + after_d_k;
        verify_custody_quote_cut_batch_v1(
            view,
            CustodyQuoteCutInputsV1 {
                quote_cut_identity: d(90),
                instant_ns,
                available_ns: instant_ns,
                publication_ns: instant_ns,
                bound_ns_exclusive: request.bound_ns_exclusive,
                derivation: QuoteDerivationV1::ObservedBbo,
                rows,
            },
        )
        .map_err(|_| NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
    }
}

/// Resolves `frame` on the pool with an injected quote cut, and the request it was resolved for.
async fn custody_frame(
    owner: &super::MarketDataOwnerPostgres,
    frame: UntrustedPitWindowCustodyFrameV1,
    run_end_ns_exclusive: u64,
) -> (
    NativeReplayInitialMarketRequestV1,
    Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1>,
) {
    let view = owner
        .resolve_pit_window_view_v1(&frame)
        .await
        .expect("the view resolves");
    let request = custody_request(&view, frame, run_end_ns_exclusive);
    let rows = quote_rows(&view.chain.root.members);
    let readback = resolve_native_replay_custody_frame_from_pool_v1(
        owner.pool(),
        &request,
        injected_quote_cut(&rows, 1),
    )
    .await;
    (request, readback)
}

/// The frame's sample projection, derived from the custody rows its view read: it names the
/// frame, holds one component per (member, role) value, and each coordinate, read from its fixed
/// layout, states the stored custody row it names - that row's fact digest as its receipt, its
/// own row digest, its Owner event and sample identities, V1's logical time, its event and its
/// series position, lineage and Market Semantics.
fn assert_projection_states_custody_rows(
    custody: &NativeReplayCustodyFrameReadbackV1,
    view: &ResolvedPitWindowViewV1,
) {
    let frame = custody.universe_frame();
    let projection = custody.sample_projection();
    assert_eq!(projection.subject(), frame.digest());
    assert_eq!(projection.components().len(), frame.values().len());
    assert_eq!(
        projection.components().len(),
        view.chain.root.members.len() * 2,
        "one component per member and role"
    );
    assert!(projection.schedule_dependency_set_digest().is_some());

    for (component, value) in projection.components().iter().zip(frame.values()) {
        assert_eq!(component.member_key(), value.member_key());
        assert_eq!(component.value_receipt_digest(), value.digest());
        let stored = view
            .rows
            .iter()
            .find(|row| row.fact.fact_digest() == *component.sample_receipt_digest().as_bytes())
            .expect("each component names a stored custody row");
        let fact = &stored.fact;
        let row = fact.row();
        assert_eq!(row.instrument, component.instrument().as_bytes());
        assert_eq!(
            stored.field,
            if component.input_role_identity() == d(42) {
                "CLOSE"
            } else {
                "OPEN"
            }
        );
        let coordinate = component.coordinate();
        let at = |range: std::ops::Range<usize>| &coordinate[range];
        let u64_at =
            |offset: usize| u64::from_le_bytes(coordinate[offset..offset + 8].try_into().unwrap());
        assert_eq!(at(4..36), component.input_role_identity().as_bytes());
        assert_eq!(at(36..68), &row.timeframe_identity);
        assert_eq!(at(68..84), &fact.owner_event_identity());
        assert_eq!(at(84..116), &fact.sample_identity());
        assert_eq!(u64_at(116), row.available.max(row.publication));
        assert_eq!(u64_at(124), row.event_effective);
        assert_eq!(u64_at(132), fact.series_sequence());
        assert_eq!(at(140..172), value.binding_digest().as_bytes());
        assert_eq!(at(172..204), &row.canonical_row_digest);
        assert_eq!(at(204..236), row.source_binding_lineage_root.as_bytes());
        assert_eq!(u64_at(236), row.source_binding_lineage_version);
        assert_eq!(at(244..276), row.market_semantics_identity.as_bytes());
        assert_eq!(at(276..308), &fact.fact_digest());
    }
}

/// The custody frame and the snapshot frame over its rows are one frame: the same universe
/// members and role values, then the same native schedule - bar types, every value and instant,
/// in member order - and the same quote instant. Their receipts are not compared.
fn assert_same_frame(
    custody: NativeReplayCustodyFrameReadbackV1,
    snapshot: NativeReplayInitialMarketReadbackV1,
    members: &[&str],
) {
    let values =
        |frame: &crate::owner::strategy_input_binding::StrategyInputUniverseFrameReceipt| {
            (
                frame
                    .selection()
                    .members()
                    .iter()
                    .map(|member| member.instrument().to_owned())
                    .collect::<Vec<_>>(),
                frame
                    .values()
                    .iter()
                    .map(|value| {
                        (
                            value.member_key().to_owned(),
                            value.instrument().to_owned(),
                            value.input_role_identity(),
                            *value.value_bytes(),
                            value.value_scale(),
                            value.canonical_row_digest(),
                        )
                    })
                    .collect::<Vec<_>>(),
            )
        };
    let (custody_frame, custody) = custody.into_execution_parts().expect("the custody seals");
    let (snapshot_frame, snapshot) = snapshot.into_execution_parts().expect("the snapshot seals");
    let (custody_members, custody_values) = values(&custody_frame);
    assert_eq!(custody_members, members);
    assert_eq!(
        custody_values.len(),
        2 * members.len(),
        "two roles per member"
    );
    assert_eq!((custody_members, custody_values), values(&snapshot_frame));

    assert_eq!(
        custody
            .member_instruments()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        members
    );
    assert_eq!(custody.member_instruments(), snapshot.member_instruments());
    assert_eq!(custody.frame_time_ns(), snapshot.frame_time_ns());
    assert_eq!(
        custody.quote_cut().instant_ns(),
        snapshot.quote_cut().instant_ns()
    );
    assert!(matches!(
        custody.quote_cut().source(),
        PitObservationBatchSourceV1::CustodyQuoteCut { .. }
    ));
    let (custody_bars, custody_data) = custody.into_native_schedule();
    assert_eq!(custody_bars.len(), members.len());
    assert_eq!(
        custody_data.len(),
        2 * members.len(),
        "one bar and one quote per member"
    );
    assert_eq!(
        (custody_bars, custody_data),
        snapshot.into_native_schedule()
    );
}

/// N=1: a one-member custody frame is the snapshot frame over its rows.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_one_member_custody_frame_equals_its_snapshot_frame() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let first = universe(&owner, &binding, 10, None).await;
    let second = universe(&owner, &binding, 11, None).await;
    let one_member = |universe| {
        let mut one_member = request(&binding, universe);
        one_member.members = vec![BTC.to_owned()];
        one_member.fill_timeframe = None;
        one_member.cross_sections = [WINDOW_START + DAY, WINDOW_START + 2 * DAY]
            .into_iter()
            .map(|event| {
                let version = original("1D", event);
                UntrustedCrossSectionVersionV1 {
                    rows: rows_of(&[BTC], 0, version.rows[0].retrieval_ns),
                    ..version
                }
            })
            .collect::<Vec<_>>();
        one_member
    };
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, stating_bar(one_member(first), BAR))
        .await
        .expect("the custody");

    let (request, custody) = custody_frame(
        &owner,
        frame_at(&receipt, receipt.custody_identity(), WINDOW_START + DAY),
        WINDOW_START + 3 * DAY,
    )
    .await;
    let custody = custody.expect("the custody frame resolves");
    let view = owner
        .resolve_pit_window_view_v1(&frame_at(
            &receipt,
            receipt.custody_identity(),
            WINDOW_START + DAY,
        ))
        .await
        .unwrap();
    assert_projection_states_custody_rows(&custody, &view);
    let snapshot = custody
        .snapshot_twin_for_test(&request)
        .expect("the snapshot frame over the same rows issues");
    assert_same_frame(custody, snapshot, &[BTC]);

    // The view states each value canonically, so one field's trailing zero can canonicalize away
    // where another's does not: the native bar widens every price to the bar's own finest
    // precision before projection (appending a fractional zero only, never rounding), on both
    // paths alike, so a real bar of this shape still seals identically through either.
    let mixed = commit(
        &intake,
        stating_bar(one_member(second), MIXED_PRECISION_BAR),
    )
    .await
    .expect("the custody");
    let (request, custody) = custody_frame(
        &owner,
        frame_at(&mixed, mixed.custody_identity(), WINDOW_START + DAY),
        WINDOW_START + 3 * DAY,
    )
    .await;
    let custody = custody.expect("the custody frame resolves");
    let snapshot = custody
        .snapshot_twin_for_test(&request)
        .expect("the snapshot frame over the same rows issues");
    assert_same_frame(custody, snapshot, &[BTC]);
}

/// Both frames of a two-member, single-timeframe custody are the snapshot frames over their rows.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_two_single_timeframe_custody_frames_equal_their_snapshot_frames() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, stating_bar(request(&binding, universe), BAR))
        .await
        .expect("the custody");

    for event in [WINDOW_START + DAY, WINDOW_START + 2 * DAY] {
        let frame = frame_at(&receipt, receipt.custody_identity(), event);
        let (request, custody) = custody_frame(&owner, frame, WINDOW_START + 3 * DAY).await;
        let custody = custody.expect("the custody frame resolves");
        let view = owner.resolve_pit_window_view_v1(&frame).await.unwrap();
        assert_projection_states_custody_rows(&custody, &view);
        let snapshot = custody
            .snapshot_twin_for_test(&request)
            .expect("the snapshot frame over the same rows issues");
        assert_same_frame(custody, snapshot, &[BTC, ETH]);
    }
}

/// A frame reads the head its request pins and only it: pinned at the root it takes the root's
/// view, pinned at the head the head's, and a head of another chain, or none at all, is refused.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_custody_frame_refuses_a_foreign_head_and_never_mixes_two_heads() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "synthetic/corrections", 1, Some(after_close(true))).await;
    admit_members(&owner, &binding).await;
    let intake = owner.pit_window_custody_commit_v1();
    let template = two_timeframe_request(request(
        &binding,
        universe(&owner, &binding, 10, None).await,
    ));
    let root = commit(&intake, template.clone()).await.expect("the root");
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
    .expect("the correction");
    let event = WINDOW_START + 3 * DAY;
    let run_end = WINDOW_START + 4 * DAY;
    let mut read = Vec::new();

    for pinned in [root.custody_identity(), head.custody_identity()] {
        let frame = frame_at(&root, pinned, event);
        let view = owner.resolve_pit_window_view_v1(&frame).await.unwrap();
        let expected = view_identity_v1(view.chain.root.rule_digest, &view.selection);
        let (_, readback) = custody_frame(&owner, frame, run_end).await;
        let readback = readback.expect("the frame resolves at its pinned head");
        let PitObservationBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            event_ns,
            ..
        } = readback.source()
        else {
            panic!("a custody frame reads a custody view");
        };
        assert_eq!(
            (chain_root, view_identity, event_ns),
            (root.chain_root(), expected, event),
            "the frame reads the view at the head it pins"
        );
        let observation_batch = readback
            .universe_frame()
            .selection()
            .observation_batch_digest();
        assert_eq!(
            observation_batch,
            seal(&view).unwrap().digest(),
            "its values come from that view's batch alone"
        );
        read.push((view_identity, view.selection.selected));
    }
    assert_ne!(read[0].0, read[1].0, "the correction moved frame 3's view");
    assert!(
        read[0]
            .1
            .iter()
            .any(|version| version.identity == corrected),
        "the root reads the original two-day bar"
    );
    assert!(
        read[1]
            .1
            .iter()
            .all(|version| version.identity != corrected),
        "the head reads its correction, never the original beside it"
    );

    // A frame pinned to another chain's head, or to no custody, is refused before it reads.
    let other = commit(
        &intake,
        two_timeframe_request(request(
            &binding,
            universe(&owner, &binding, 11, None).await,
        )),
    )
    .await
    .expect("another chain");
    let template = owner
        .resolve_pit_window_view_v1(&frame_at(&root, root.custody_identity(), event))
        .await
        .unwrap();

    for foreign in [other.custody_identity(), d(7)] {
        let request = custody_request(&template, frame_at(&root, foreign, event), run_end);
        let rows = quote_rows(&template.chain.root.members);
        assert_eq!(
            resolve_native_replay_custody_frame_from_pool_v1(
                owner.pool(),
                &request,
                injected_quote_cut(&rows, 1)
            )
            .await
            .map(|_| ()),
            Err(NativeReplaySchedulingErrorV1::PitWindowHeadNotInChain)
        );
    }

    // A frame off the chain's grid has no execution cross-section to read.
    let request = custody_request(
        &template,
        frame_at(&root, head.custody_identity(), event + 1),
        run_end,
    );
    let rows = quote_rows(&template.chain.root.members);
    assert_eq!(
        resolve_native_replay_custody_frame_from_pool_v1(
            owner.pool(),
            &request,
            injected_quote_cut(&rows, 1)
        )
        .await
        .map(|_| ()),
        Err(NativeReplaySchedulingErrorV1::PitWindowFrameNotCovered)
    );
}

/// The read store resolves a custody frame with the production quote cut resolver, which has no
/// derivation until T0-6: the frame is refused for want of liquidity after its bar, never given a
/// Quote. The same frame with a quote cut resolves, so the refusal is the quote cut's alone, and a
/// quote at `d_k` itself is not one the gap holds.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_without_a_derived_quote_cut_a_custody_frame_is_refused_not_invented() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, stating_bar(request(&binding, universe), BAR))
        .await
        .expect("the custody");
    let frame = frame_at(&receipt, receipt.custody_identity(), WINDOW_START + DAY);
    let (request, injected) = custody_frame(&owner, frame, WINDOW_START + 3 * DAY).await;
    assert!(injected.is_ok(), "the frame resolves with a quote cut");

    let store = MarketDataReadPostgres {
        pool: owner.pool().clone(),
    };
    assert_eq!(
        store
            .resolve_native_replay_custody_frame_inputs_v1(&request)
            .await
            .map(|_| ()),
        Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable)
    );

    let view = owner.resolve_pit_window_view_v1(&frame).await.unwrap();
    let rows = quote_rows(&view.chain.root.members);
    assert_eq!(
        resolve_native_replay_custody_frame_from_pool_v1(
            owner.pool(),
            &request,
            injected_quote_cut(&rows, 0)
        )
        .await
        .map(|_| ()),
        Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable),
        "a quote at d_k is not after it"
    );

    // A snapshot frame is not the custody read's to resolve.
    let snapshot = request.for_frame(d(12), d(13), WINDOW_START + DAY);
    assert_eq!(
        store
            .resolve_native_replay_custody_frame_inputs_v1(&snapshot)
            .await
            .map(|_| ()),
        Err(NativeReplaySchedulingErrorV1::FrameSourceMismatch)
    );
}

/// The acceptance quote source states, for each gap it is asked about, every member's best bid and
/// offer at `d_k + after_d_k`.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn stated_quote(
    after_d_k: Option<u64>,
) -> impl Fn(
    &crate::owner::pit_window_custody_v1::sealed_acceptance::SealedAcceptanceCustodyQuoteGapV1,
) -> Option<
    crate::owner::pit_window_custody_v1::sealed_acceptance::SealedAcceptanceCustodyQuoteCutV1,
> + Send
+ Sync
+ 'static {
    use crate::owner::pit_window_custody_v1::sealed_acceptance::{
        SealedAcceptanceCustodyQuoteCutV1, SealedAcceptanceCustodyQuoteRowV1,
        SealedAcceptanceQuoteFieldV1 as Field,
    };

    move |gap| {
        let after_d_k = after_d_k?;
        let rows = gap
            .members()
            .iter()
            .flat_map(|member| {
                [
                    (Field::BidPrice, 6_500_101, 2),
                    (Field::AskPrice, 6_500_103, 2),
                    (Field::BidSize, 15, 0),
                    (Field::AskSize, 17, 0),
                ]
                .into_iter()
                .map(
                    |(field, value_mantissa, value_scale)| SealedAcceptanceCustodyQuoteRowV1 {
                        instrument: member.clone(),
                        field,
                        value_mantissa,
                        value_scale,
                    },
                )
            })
            .collect();
        Some(SealedAcceptanceCustodyQuoteCutV1 {
            instant_ns: gap.decision_cut_ns() + after_d_k,
            derivation: QuoteDerivationV1::ObservedBbo,
            rows,
        })
    }
}

/// The sealed acceptance custody frame resolver reads a custody frame with the Quotes its source
/// states for the gap, through the custody quote cut seal: an in-gap quote resolves the same frame
/// the pool read resolves with an injected one, while a quote at `d_k`, a quote at the gap's bound
/// and no quote at all are each refused as production refuses a missing quote cut. It reads no
/// snapshot frame.
#[cfg(feature = "sealed-strategy-input-acceptance")]
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_the_sealed_acceptance_custody_resolver_reads_a_frame_with_its_stated_quotes() {
    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, stating_bar(request(&binding, universe), BAR))
        .await
        .expect("the custody");
    let frame = frame_at(&receipt, receipt.custody_identity(), WINDOW_START + DAY);
    let (request, injected) = custody_frame(&owner, frame, WINDOW_START + 3 * DAY).await;
    let injected = injected.expect("the pool read resolves the frame with an injected quote cut");
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let resolver = |after_d_k| {
        crate::owner::native_replay_custody_frame_resolver_for_sealed_acceptance_v1(
            &owner_url,
            stated_quote(after_d_k),
        )
        .expect("a disposable Owner URL opens the resolver")
    };

    let resolved = resolver(Some(1))
        .resolve_native_replay_custody_frame_inputs_v1(&request)
        .await
        .expect("an in-gap quote resolves the frame");
    assert_eq!(resolved.universe_frame(), injected.universe_frame());
    assert_eq!(resolved.source(), injected.source());
    let (_, scheduling) = resolved
        .into_execution_parts()
        .expect("the frame seals its native schedule");
    let (_, injected_scheduling) = injected.into_execution_parts().unwrap();
    assert_eq!(
        scheduling.member_instruments(),
        injected_scheduling.member_instruments()
    );

    let view = owner.resolve_pit_window_view_v1(&frame).await.unwrap();
    let gap = view.selection.next_event_ns - view.selection.decision_cut_ns;

    for (after_d_k, case) in [
        (Some(0), "a quote at d_k is not after it"),
        (Some(gap), "a quote at the gap's bound is not inside it"),
        (None, "a gap the source states nothing for has no quote cut"),
    ] {
        assert_eq!(
            resolver(after_d_k)
                .resolve_native_replay_custody_frame_inputs_v1(&request)
                .await
                .map(|_| ()),
            Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable),
            "{case}"
        );
    }

    let snapshot = request.for_frame(d(12), d(13), WINDOW_START + DAY);
    assert_eq!(
        resolver(Some(1))
            .resolve_native_replay_initial_market_inputs_v1(&snapshot)
            .await
            .map(|_| ()),
        Err(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable),
        "a custody frame resolver reads no snapshot frame"
    );
}

/// The sealed acceptance custody resolver opens only on a disposable loopback `vibe_test_`
/// database.
#[cfg(feature = "sealed-strategy-input-acceptance")]
#[rstest::rstest]
#[case::empty("")]
#[case::a_remote_host("postgresql://owner@db.example/vibe_test_decoy")]
#[case::a_hostaddr_override("postgresql://owner@127.0.0.1/vibe_test_decoy?hostaddr=192.0.2.1")]
#[case::not_disposable("postgresql://owner@127.0.0.1/market_data")]
fn the_sealed_acceptance_custody_resolver_opens_only_on_a_disposable_database(#[case] url: &str) {
    let refused = crate::owner::native_replay_custody_frame_resolver_for_sealed_acceptance_v1(
        url,
        stated_quote(Some(1)),
    )
    .map(|_| ())
    .unwrap_err();
    assert_eq!(
        refused.failure(),
        crate::owner::ResearchPitTerminalBootstrapFailure::InvalidIdentity
    );
}

/// The production quote cut resolver (slice T0-6): a gap with a fill-timeframe bar that opens
/// strictly after `d_k` and before the next frame resolves the frame with that bar's open as both
/// bid and ask, its volume as both sizes, derivation `FillBarOpen` - the same derivation the fixed
/// fill bar the shared `request()` fixture carries is too early for (that one opens at `d_k`
/// itself, proved refused in the sibling test above).
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_fill_bar_that_opens_after_d_k_derives_the_gaps_quote_cut() {
    use crate::owner::pit_window_custody_v1::quote_cut::resolve_custody_quote_cut_v1;

    let owner = owner().await;
    let binding = commit_binding(&owner, "binance/um/klines", 1, Some(after_close(false))).await;
    admit_members(&owner, &binding).await;
    let universe = universe(&owner, &binding, 10, None).await;
    let mut pit_request = request(&binding, universe);
    // `d_1 = WINDOW_START + DAY + 2*MINUTE` (the `after_close` rule's lag). This bar's open is
    // `WINDOW_START + DAY + 4*MINUTE`, strictly after `d_1` and well before frame 2's event.
    // `stating_bar` below restates every cross-section's rows at the `BAR` constant, this one
    // included, so its own base value here is immaterial.
    let fill_event = WINDOW_START + DAY + 5 * MINUTE;
    pit_request.cross_sections[2] = original("1M", fill_event);
    let intake = owner.pit_window_custody_commit_v1();
    let receipt = commit(&intake, stating_bar(pit_request, BAR))
        .await
        .expect("the custody");
    let frame = frame_at(&receipt, receipt.custody_identity(), WINDOW_START + DAY);
    let view = owner.resolve_pit_window_view_v1(&frame).await.unwrap();
    let native_request = custody_request(&view, frame, WINDOW_START + 3 * DAY);

    let readback = resolve_native_replay_custody_frame_from_pool_v1(
        owner.pool(),
        &native_request,
        resolve_custody_quote_cut_v1,
    )
    .await
    .expect("a fill bar strictly after d_k derives the gap's quote cut");

    let quote_cut = readback.quote_cut_for_test();
    let PitObservationBatchSourceV1::CustodyQuoteCut { derivation, .. } = quote_cut.source() else {
        panic!("a custody frame's quote cut is a CustodyQuoteCut batch");
    };
    assert!(
        matches!(derivation, QuoteDerivationV1::FillBarOpen { .. }),
        "the derivation is the fill bar's open: {derivation:?}"
    );
    let open = 6_500_012_i128; // BAR's OPEN, scale 2
    let volume = 1_234_i128; // BAR's VOLUME, scale 0

    for member in [BTC, ETH] {
        for (field, expected) in [
            ("BID_PRICE", open),
            ("ASK_PRICE", open),
            ("BID_SIZE", volume),
            ("ASK_SIZE", volume),
        ] {
            let row = quote_cut
                .observations()
                .iter()
                .find(|row| row.instrument() == member && row.field() == field)
                .unwrap_or_else(|| panic!("{member} {field} is in the quote cut"));
            assert_eq!(
                row.value_mantissa(),
                expected,
                "{member} {field} is the fill bar's open or volume"
            );
        }
    }
}
