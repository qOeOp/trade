//! What a committed PIT snapshot is to a Native Replay frame, and which quote cut a frame takes.
//!
//! A PIT snapshot is one instant, so a frame's BAR cut cannot also hold the Quotes that follow its
//! BAR. `docs/owners/market-data.md` therefore takes each frame's liquidity from a quote cut: an
//! Owner-verified snapshot of its own, strictly after the frame's BAR cut and before the next
//! frame's. A quote cut is not a frame and takes no frame ordinal. The Owner tells the two apart
//! from the batch it verified, never from the requester's scope claim.
//!
//! Nothing here assumes a member count. A frame's members are the instruments its BAR rows name,
//! and a quote cut serves that frame only when its Quote rows name exactly the same instruments.

#![allow(
    dead_code,
    reason = "quote cut selection and verification wait for the frame readback that consumes them"
)]

use std::collections::{BTreeMap, BTreeSet};

use super::{
    pit_snapshot::{VerifiedPitObservation, VerifiedPitObservationBatch},
    source_binding::BindingDigest,
};

/// Which census, if any, a committed snapshot belongs to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeReplayCutKindV2 {
    /// The batch holds BAR rows: it is a frame and takes the next frame ordinal in its scope.
    Frame,
    /// The batch holds Quote rows and nothing else: it is a quote cut and takes no frame ordinal.
    QuoteCut,
    /// No batch, or one that is neither: it belongs to no Native Replay census.
    Neither,
}

/// Classifies a snapshot by the rows the Owner verified for it.
///
/// A batch holding any BAR row is a frame, whatever else it holds; a batch whose every row is a
/// Quote is a quote cut; anything else, including a snapshot without rows, is neither.
pub(crate) fn classify_native_replay_cut_v2(
    rows: &[VerifiedPitObservation],
) -> NativeReplayCutKindV2 {
    if rows.iter().any(|row| row.data_kind() == "BAR") {
        NativeReplayCutKindV2::Frame
    } else if !rows.is_empty() && rows.iter().all(|row| row.data_kind() == "QUOTE") {
        NativeReplayCutKindV2::QuoteCut
    } else {
        NativeReplayCutKindV2::Neither
    }
}

/// One quote cut the census holds, with the coordinates its request declared.
///
/// The coordinates are what the Owner admitted for that snapshot, carried on the census row so a
/// frame can ignore quote cuts that could never serve it before asking whether one is unique.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NativeReplayQuoteCutCandidateV2 {
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) snapshot_fact_digest: BindingDigest,
    pub(crate) scope_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) universe_selection_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) event_effective_ns: u64,
    pub(crate) decision_cut_ns: u64,
    /// The quote cut's own PIT correction lineage: a correction shares its original's root.
    pub(crate) correction_lineage_root: BindingDigest,
    pub(crate) correction_lineage_version: u64,
}

/// Why a frame has no quote cut to take its liquidity from.
///
/// Every variant refuses: a frame is never given a nearby, partial or guessed quote cut.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeReplayQuoteCutRefusalV2 {
    /// The census or the quote cut's batch could not be read; nothing is claimed.
    CustodyUnavailable,
    /// No quote cut lies strictly after the frame's BAR and before its bound.
    QuoteCutMissing,
    /// More than one does, and the census cannot choose between them.
    AmbiguousQuoteCut,
    /// The quote cut's batch is not a quote cut.
    NotAQuoteCut,
    /// The quote cut rests on another scope, Instrument Master, universe selection, Market
    /// Semantics or Source Binding lineage than the frame.
    CoordinateMismatch,
    /// The quote cut does not quote exactly the frame's members.
    MemberMismatch,
}

/// Picks the one quote cut on `frame`'s coordinates in `(frame BAR, bound_ns_exclusive)`, as the
/// Owner could see the census at the request's decision cut.
///
/// A candidate on other coordinates is not this frame's, and is set aside before uniqueness is
/// asked. The census is partitioned by the scope a requester declared, so without this a quote cut
/// another requester committed under the same scope but on its own Instrument Master, universe
/// selection, Market Semantics or Source Binding lineage would make a lawful frame ambiguous. A
/// collision on every one of those coordinates still does: that refuses the frame (a denial of
/// service) and can never hand it a quote cut the Owner did not verify for it.
///
/// A candidate observed after the decision cut is not yet visible and is set aside. Within one
/// quote cut's correction lineage the latest visible correction stands for the lineage, the same
/// rule PIT corrections follow everywhere else, so a corrected quote cut resolves to its correction
/// and one corrected only after the cut resolves to its original. Two lineages left are ambiguous.
///
/// The census query already bounds the interval; the rules are applied again here so that they
/// are stated, and tested, in one place rather than trusted to a `WHERE` clause.
///
/// # Errors
///
/// Returns the refusal for the first violated rule.
pub(crate) fn select_native_replay_quote_cut_v2<'a>(
    candidates: &'a [NativeReplayQuoteCutCandidateV2],
    frame: &NativeReplayCutCoordinatesV2,
    bound_ns_exclusive: u64,
    request_decision_cut_ns: u64,
) -> Result<&'a NativeReplayQuoteCutCandidateV2, NativeReplayQuoteCutRefusalV2> {
    let mut latest_by_lineage =
        BTreeMap::<BindingDigest, &'a NativeReplayQuoteCutCandidateV2>::new();

    for candidate in candidates.iter().filter(|candidate| {
        candidate.event_effective_ns > frame.event_effective_ns
            && candidate.event_effective_ns < bound_ns_exclusive
            && candidate.decision_cut_ns <= request_decision_cut_ns
            && candidate.scope_digest == frame.scope_digest
            && candidate.instrument_master_digest == frame.instrument_master_digest
            && candidate.universe_selection_digest == frame.universe_selection_digest
            && candidate.market_semantics_identity == frame.market_semantics_identity
            && candidate.source_binding_lineage_root == frame.source_binding_lineage_root
    }) {
        latest_by_lineage
            .entry(candidate.correction_lineage_root)
            .and_modify(|latest| {
                if candidate.correction_lineage_version > latest.correction_lineage_version {
                    *latest = candidate;
                }
            })
            .or_insert(candidate);
    }
    let mut lineages = latest_by_lineage.into_values();

    match (lineages.next(), lineages.next()) {
        (None, _) => Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing),
        (Some(only), None) => Ok(only),
        (Some(_), Some(_)) => Err(NativeReplayQuoteCutRefusalV2::AmbiguousQuoteCut),
    }
}

/// The coordinates a frame and its quote cut must share, and the members each names.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NativeReplayCutCoordinatesV2 {
    pub(crate) kind: NativeReplayCutKindV2,
    pub(crate) scope_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) universe_selection_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) event_effective_ns: u64,
    /// The instruments the cut's rows of its own kind name: BAR rows for a frame, Quote rows for
    /// a quote cut.
    pub(crate) members: BTreeSet<String>,
}

impl NativeReplayCutCoordinatesV2 {
    /// Reads the coordinates of an Owner-verified batch.
    pub(crate) fn of(batch: &VerifiedPitObservationBatch) -> Self {
        let kind = classify_native_replay_cut_v2(batch.observations());
        let member_kind = match kind {
            NativeReplayCutKindV2::QuoteCut => "QUOTE",
            NativeReplayCutKindV2::Frame | NativeReplayCutKindV2::Neither => "BAR",
        };
        Self {
            kind,
            scope_digest: batch.scope_digest(),
            instrument_master_digest: batch.instrument_master_digest(),
            universe_selection_digest: batch.universe_selection_digest(),
            market_semantics_identity: batch.market_semantics_identity(),
            source_binding_lineage_root: batch.source_binding_lineage_root(),
            event_effective_ns: batch.time_evidence().event_effective.value,
            members: batch
                .observations()
                .iter()
                .filter(|row| row.data_kind() == member_kind)
                .map(|row| row.instrument().to_owned())
                .collect(),
        }
    }
}

/// Verifies that `quote_cut` can serve as `frame`'s liquidity.
///
/// It must be a quote cut, strictly later than the frame, on the frame's scope, Instrument Master,
/// universe selection, Market Semantics and Source Binding lineage, and quote exactly the frame's
/// members - no fewer, which would leave a member without liquidity, and no more, which would bring
/// in an instrument the frame does not trade.
///
/// Selection already set aside candidates on other coordinates, by what their census rows say.
/// Here the same coordinates are read from the batch the Owner verified, so a census row that
/// disagrees with its own snapshot is refused rather than trusted.
///
/// # Errors
///
/// Returns the refusal for the first violated rule.
pub(crate) fn verify_native_replay_quote_cut_v2(
    frame: &NativeReplayCutCoordinatesV2,
    quote_cut: &NativeReplayCutCoordinatesV2,
) -> Result<(), NativeReplayQuoteCutRefusalV2> {
    if frame.kind != NativeReplayCutKindV2::Frame
        || quote_cut.kind != NativeReplayCutKindV2::QuoteCut
    {
        return Err(NativeReplayQuoteCutRefusalV2::NotAQuoteCut);
    }

    if quote_cut.event_effective_ns <= frame.event_effective_ns {
        return Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing);
    }

    if quote_cut.scope_digest != frame.scope_digest
        || quote_cut.instrument_master_digest != frame.instrument_master_digest
        || quote_cut.universe_selection_digest != frame.universe_selection_digest
        || quote_cut.market_semantics_identity != frame.market_semantics_identity
        || quote_cut.source_binding_lineage_root != frame.source_binding_lineage_root
    {
        return Err(NativeReplayQuoteCutRefusalV2::CoordinateMismatch);
    }

    if quote_cut.members.is_empty() || quote_cut.members != frame.members {
        return Err(NativeReplayQuoteCutRefusalV2::MemberMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn row(instrument: &str, data_kind: &str) -> VerifiedPitObservation {
        VerifiedPitObservation {
            symbolic_key: format!("{instrument}.{data_kind}"),
            member_key: instrument.to_owned(),
            instrument: instrument.to_owned(),
            channel: "MARKET".to_owned(),
            data_kind: data_kind.to_owned(),
            timeframe: "1M".to_owned(),
            field: "CLOSE".to_owned(),
            value_mantissa: 1,
            value_scale: 0,
            event_effective: 10,
            provider_available: 10,
            retrieval: 10,
            correction_publication: 10,
            source_binding_identity: d(1),
            source_frontier_digest: d(2),
            instrument_master_digest: d(3),
            universe_selection_digest: d(4),
            market_semantics_identity: d(5),
            correction_stream_identity: "corrections".to_owned(),
            correction_sequence: 1,
            correction_frontier_digest: d(6),
        }
    }

    #[rstest]
    #[case::bar_only(&["BAR"], NativeReplayCutKindV2::Frame)]
    #[case::bar_with_quotes(&["BAR", "QUOTE"], NativeReplayCutKindV2::Frame)]
    #[case::quotes_only(&["QUOTE", "QUOTE"], NativeReplayCutKindV2::QuoteCut)]
    #[case::quotes_with_a_trade(&["QUOTE", "TRADE"], NativeReplayCutKindV2::Neither)]
    #[case::trades_only(&["TRADE"], NativeReplayCutKindV2::Neither)]
    #[case::scalars_only(&["SCALAR"], NativeReplayCutKindV2::Neither)]
    #[case::no_rows(&[], NativeReplayCutKindV2::Neither)]
    fn a_snapshot_is_classified_by_the_rows_it_holds(
        #[case] kinds: &[&str],
        #[case] expected: NativeReplayCutKindV2,
    ) {
        let rows = kinds
            .iter()
            .map(|kind| row("AAPL.XNAS", kind))
            .collect::<Vec<_>>();
        assert_eq!(classify_native_replay_cut_v2(&rows), expected);
    }

    /// A candidate on the frame's coordinates (see `coordinates`), in a lineage of its own.
    fn candidate(event_effective_ns: u64, decision_cut_ns: u64) -> NativeReplayQuoteCutCandidateV2 {
        let tag = u8::try_from(event_effective_ns).expect("small");
        NativeReplayQuoteCutCandidateV2 {
            snapshot_identity: d(tag),
            snapshot_fact_digest: d(99),
            scope_digest: d(10),
            instrument_master_digest: d(11),
            universe_selection_digest: d(12),
            market_semantics_identity: d(13),
            source_binding_lineage_root: d(14),
            event_effective_ns,
            decision_cut_ns,
            correction_lineage_root: d(tag.wrapping_add(100)),
            correction_lineage_version: 1,
        }
    }

    fn frame_at(event_effective_ns: u64) -> NativeReplayCutCoordinatesV2 {
        coordinates(
            NativeReplayCutKindV2::Frame,
            event_effective_ns,
            &["BTCUSDT-PERP.BINANCE"],
        )
    }

    #[rstest]
    fn a_frame_takes_the_one_quote_cut_strictly_inside_its_interval() {
        let census = [candidate(10, 40), candidate(15, 40), candidate(20, 40)];

        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 40),
            Ok(&census[1]),
            "the cut on the frame's own instant and the one on its bound are both outside"
        );
        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 15, 40),
            Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );
        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(5), 20, 40),
            Err(NativeReplayQuoteCutRefusalV2::AmbiguousQuoteCut),
            "two lineages, each on the frame's coordinates: the census does not choose"
        );
    }

    #[rstest]
    fn a_quote_cut_the_owner_could_not_yet_see_at_the_decision_cut_is_not_a_candidate() {
        let census = [candidate(15, 50), candidate(16, 40)];
        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 40),
            Ok(&census[1])
        );
        assert_eq!(
            select_native_replay_quote_cut_v2(&census[..1], &frame_at(10), 20, 40),
            Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );
        assert_eq!(
            select_native_replay_quote_cut_v2(&census[..1], &frame_at(10), 20, 50),
            Ok(&census[0])
        );
    }

    /// Another requester can declare this frame's scope; a quote cut it commits on any coordinate
    /// of its own is set aside instead of making this frame ambiguous.
    #[rstest]
    fn a_quote_cut_on_other_coordinates_does_not_make_a_frame_ambiguous() {
        for drift in [
            |cut: &mut NativeReplayQuoteCutCandidateV2| cut.scope_digest = d(90),
            |cut: &mut NativeReplayQuoteCutCandidateV2| cut.instrument_master_digest = d(91),
            |cut: &mut NativeReplayQuoteCutCandidateV2| cut.universe_selection_digest = d(92),
            |cut: &mut NativeReplayQuoteCutCandidateV2| cut.market_semantics_identity = d(93),
            |cut: &mut NativeReplayQuoteCutCandidateV2| cut.source_binding_lineage_root = d(94),
        ] {
            let mut foreign = candidate(16, 40);
            drift(&mut foreign);
            let census = [candidate(15, 40), foreign];
            assert_eq!(
                select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 40),
                Ok(&census[0])
            );
        }
        // On every coordinate the frame's, a second lineage still collides: the frame is refused,
        // and nothing but a quote cut on its own coordinates is ever handed to it.
        let census = [candidate(15, 40), candidate(16, 40)];
        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 40),
            Err(NativeReplayQuoteCutRefusalV2::AmbiguousQuoteCut)
        );
    }

    #[rstest]
    fn a_corrected_quote_cut_resolves_to_its_latest_correction_visible_at_the_cut() {
        let original = candidate(15, 40);
        let mut correction = candidate(15, 50);
        correction.snapshot_identity = d(115);
        correction.correction_lineage_root = original.correction_lineage_root;
        correction.correction_lineage_version = 2;
        let census = [original, correction];

        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 50),
            Ok(&census[1]),
            "the correction stands for its lineage"
        );
        assert_eq!(
            select_native_replay_quote_cut_v2(&census, &frame_at(10), 20, 45),
            Ok(&census[0]),
            "a correction the Owner could not yet see leaves the original"
        );
    }

    fn coordinates(
        kind: NativeReplayCutKindV2,
        event_effective_ns: u64,
        members: &[&str],
    ) -> NativeReplayCutCoordinatesV2 {
        NativeReplayCutCoordinatesV2 {
            kind,
            scope_digest: d(10),
            instrument_master_digest: d(11),
            universe_selection_digest: d(12),
            market_semantics_identity: d(13),
            source_binding_lineage_root: d(14),
            event_effective_ns,
            members: members.iter().map(|member| (*member).to_owned()).collect(),
        }
    }

    /// One member and two are the same rule: the quote cut names exactly the frame's instruments.
    #[rstest]
    #[case::one_member(&["BTCUSDT-PERP.BINANCE"])]
    #[case::two_members(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"])]
    fn a_quote_cut_serves_a_frame_only_on_its_coordinates_and_members(#[case] members: &[&str]) {
        let frame = coordinates(NativeReplayCutKindV2::Frame, 10, members);
        let quote_cut = coordinates(NativeReplayCutKindV2::QuoteCut, 15, members);
        assert_eq!(
            verify_native_replay_quote_cut_v2(&frame, &quote_cut),
            Ok(())
        );

        let mut not_later = quote_cut.clone();
        not_later.event_effective_ns = 10;
        assert_eq!(
            verify_native_replay_quote_cut_v2(&frame, &not_later),
            Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );

        let mut another_frame = quote_cut.clone();
        another_frame.kind = NativeReplayCutKindV2::Frame;
        assert_eq!(
            verify_native_replay_quote_cut_v2(&frame, &another_frame),
            Err(NativeReplayQuoteCutRefusalV2::NotAQuoteCut)
        );

        for drift in [
            |cut: &mut NativeReplayCutCoordinatesV2| cut.scope_digest = d(90),
            |cut: &mut NativeReplayCutCoordinatesV2| cut.instrument_master_digest = d(91),
            |cut: &mut NativeReplayCutCoordinatesV2| cut.universe_selection_digest = d(92),
            |cut: &mut NativeReplayCutCoordinatesV2| cut.market_semantics_identity = d(93),
            |cut: &mut NativeReplayCutCoordinatesV2| cut.source_binding_lineage_root = d(94),
        ] {
            let mut drifted = quote_cut.clone();
            drift(&mut drifted);
            assert_eq!(
                verify_native_replay_quote_cut_v2(&frame, &drifted),
                Err(NativeReplayQuoteCutRefusalV2::CoordinateMismatch)
            );
        }

        let mut extra = quote_cut.clone();
        extra.members.insert("SOLUSDT-PERP.BINANCE".to_owned());
        assert_eq!(
            verify_native_replay_quote_cut_v2(&frame, &extra),
            Err(NativeReplayQuoteCutRefusalV2::MemberMismatch),
            "a quote for an instrument the frame does not trade"
        );

        let mut missing = quote_cut;
        let first = missing.members.first().cloned().expect("a member");
        missing.members.remove(&first);
        assert_eq!(
            verify_native_replay_quote_cut_v2(&frame, &missing),
            Err(NativeReplayQuoteCutRefusalV2::MemberMismatch),
            "a member left without liquidity"
        );
    }
}
