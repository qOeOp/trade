//! The quote cut a custody frame's gap takes its Quotes from (slice T0-6).
//!
//! T0-5 fixed what a derivation is asked and how far a gap reaches. T0-6's derivation is the open
//! of the first fill-timeframe bar that opens strictly after the frame's decision cut, before the
//! gap's bound: bid and ask both that open, both sizes the bar's traded volume
//! ([`QuoteDerivationV1::FillBarOpen`]). The candidate bars themselves are read and verified by
//! the caller (`postgres/pit_window_custody_v1.rs`, alongside the view), since reading custody
//! needs a store; this module picks the first qualifying one and seals it. Each candidate is the
//! version visible at its bar's own availability (`view::select_fill_candidates_v1`, the selection
//! a frame's inputs make at `d_k`), so a correction published after that never reaches the quote,
//! and the quote cut states that version's availability and publication. A gap with no qualifying
//! bar, or whose bar is available only at or after the gap's bound, fails closed as
//! `QuoteCutMissing`: no quote is invented.

use sha2::{Digest as _, Sha256};

use super::{QuoteDerivationV1, authority::RecordedTimeframeV1};
use crate::owner::{
    native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2,
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{
            CustodyQuoteCutInputsV1, CustodyQuoteRowV1, FillBarRowV1,
            verify_custody_quote_cut_batch_v1,
        },
    },
    source_binding::BindingDigest,
};

const QUOTE_CUT_IDENTITY_DOMAIN: &[u8] = b"market-data.pit-window-fill-quote-cut.v1\0";

/// The fill timeframe's own interval: a fixed one minute, `IntervalClose`-labeled like every other
/// bar this Owner commits, never parsed from the label (`docs/owners/market-data.md`, "PIT window
/// custody"). The fill timeframe serves quote cuts only and is always this one grain, so the
/// derivation fixes it rather than reading a declaration no custody record carries for it.
pub(crate) const FILL_BAR_INTERVAL_NS_V1: u64 = 60_000_000_000;

/// One fill-timeframe cross-section the gap could take its quote from, read and verified by the
/// caller before the derivation runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FillBarCandidateV1 {
    /// The version this bar was verified at: the quote cut's identity binds it, so a later
    /// correction of the same bar seals a different quote cut rather than silently replacing one
    /// already issued.
    pub(crate) version_identity: BindingDigest,
    /// The bar's open, the quote's instant. Strictly inside the gap, checked when the candidate is
    /// read.
    pub(crate) open_ns: u64,
    /// The selected version's availability: the version visible at the bar's own availability,
    /// never a later correction of it.
    pub(crate) available_ns: u64,
    /// The selected version's publication: at or before its bar's availability.
    pub(crate) publication_ns: u64,
    /// One row per member, each the bar's open and traded volume.
    pub(crate) rows: Vec<FillBarRowV1>,
}

/// What a quote cut derivation is asked for one gap.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CustodyQuoteCutRequestV1 {
    pub(crate) chain_root: BindingDigest,
    /// The head the run's frames were read from.
    pub(crate) head_identity: BindingDigest,
    /// The view of the frame the gap follows.
    pub(crate) view_identity: BindingDigest,
    /// `d_k`: the gap opens strictly after it.
    pub(crate) decision_cut_ns: u64,
    /// The gap's exclusive end: [`custody_quote_cut_bound_v1`].
    pub(crate) bound_ns_exclusive: u64,
    /// The custody's members, in member order.
    pub(crate) members: Vec<String>,
    /// The custody's fill timeframe, which serves quote cuts only.
    pub(crate) fill_timeframe: Option<RecordedTimeframeV1>,
    /// Every fill-timeframe bar whose open lies in the gap, ascending by open, each at the version
    /// visible at its own availability. The caller selects, reads and verifies these against the
    /// custody's store; this module trusts them as given and picks the first.
    pub(crate) fill_candidates: Vec<FillBarCandidateV1>,
}

/// The exclusive end of the gap after the frame at `event_ns`: the next frame's event,
/// `event_ns + interval_ns`, or the run's end when that comes first, so the last gap is bounded by
/// the run. `None` when the next event does not fit an instant.
pub(crate) const fn custody_quote_cut_bound_v1(
    event_ns: u64,
    interval_ns: u64,
    run_end_ns_exclusive: u64,
) -> Option<u64> {
    match event_ns.checked_add(interval_ns) {
        Some(next) if next < run_end_ns_exclusive => Some(next),
        Some(_) => Some(run_end_ns_exclusive),
        None => None,
    }
}

fn quote_cut_identity_v1(
    view_identity: BindingDigest,
    version_identity: BindingDigest,
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(QUOTE_CUT_IDENTITY_DOMAIN);
    hasher.update(view_identity.as_bytes());
    hasher.update(version_identity.as_bytes());
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// The fill bar the gap's quote cut takes: the first of `request.fill_candidates` whose open lies
/// strictly inside `(d_k, bound)`. A bar that is not available before the gap's bound gives the gap
/// no quote: its price would be one the run could not have known before the next frame.
///
/// # Errors
///
/// [`NativeReplayQuoteCutRefusalV2::QuoteCutMissing`] when no candidate opens inside the gap, or
/// the first that does is available only at or after the gap's bound.
pub(crate) fn fill_bar_of_gap_v1(
    request: &CustodyQuoteCutRequestV1,
) -> Result<&FillBarCandidateV1, NativeReplayQuoteCutRefusalV2> {
    let candidate = request
        .fill_candidates
        .iter()
        .find(|candidate| {
            candidate.open_ns > request.decision_cut_ns
                && candidate.open_ns < request.bound_ns_exclusive
        })
        .ok_or(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)?;

    if candidate.available_ns >= request.bound_ns_exclusive {
        return Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing);
    }
    Ok(candidate)
}

/// The quote cut of the gap after `view`'s frame: [`fill_bar_of_gap_v1`]'s bar (already selected,
/// read and verified by the caller), sealed as Quote rows bid = ask = open, both sizes the bar's
/// traded volume, at the bar's open and stating the selected version's availability and
/// publication.
///
/// # Errors
///
/// [`NativeReplayQuoteCutRefusalV2::QuoteCutMissing`] when no candidate qualifies, or the chosen
/// one does not carry exactly the frame's members.
pub(crate) fn resolve_custody_quote_cut_v1(
    view: &VerifiedPitObservationBatch,
    request: &CustodyQuoteCutRequestV1,
) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2> {
    let Some(fill) = request.fill_timeframe.as_ref() else {
        return Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing);
    };
    let candidate = fill_bar_of_gap_v1(request)?;
    let mut rows = candidate.rows.clone();
    rows.sort_by(|left, right| left.instrument.cmp(&right.instrument));
    let quote_rows = rows
        .iter()
        .flat_map(|row| {
            [
                CustodyQuoteRowV1 {
                    instrument: row.instrument.clone(),
                    field: "BID_PRICE",
                    value_mantissa: row.open_mantissa,
                    value_scale: row.open_scale,
                },
                CustodyQuoteRowV1 {
                    instrument: row.instrument.clone(),
                    field: "ASK_PRICE",
                    value_mantissa: row.open_mantissa,
                    value_scale: row.open_scale,
                },
                CustodyQuoteRowV1 {
                    instrument: row.instrument.clone(),
                    field: "BID_SIZE",
                    value_mantissa: row.volume_mantissa,
                    value_scale: row.volume_scale,
                },
                CustodyQuoteRowV1 {
                    instrument: row.instrument.clone(),
                    field: "ASK_SIZE",
                    value_mantissa: row.volume_mantissa,
                    value_scale: row.volume_scale,
                },
            ]
        })
        .collect::<Vec<_>>();
    verify_custody_quote_cut_batch_v1(
        view,
        CustodyQuoteCutInputsV1 {
            quote_cut_identity: quote_cut_identity_v1(
                request.view_identity,
                candidate.version_identity,
            ),
            instant_ns: candidate.open_ns,
            available_ns: candidate.available_ns,
            publication_ns: candidate.publication_ns,
            bound_ns_exclusive: request.bound_ns_exclusive,
            derivation: QuoteDerivationV1::FillBarOpen {
                fill_timeframe_identity: fill.identity,
            },
            rows: &quote_rows,
        },
    )
    .map_err(|_| NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{
        BindingDigest, CustodyQuoteCutRequestV1, FillBarCandidateV1, custody_quote_cut_bound_v1,
        fill_bar_of_gap_v1,
    };
    use crate::owner::native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2;

    fn candidate(open_ns: u64, available_ns: u64) -> FillBarCandidateV1 {
        FillBarCandidateV1 {
            version_identity: BindingDigest::from_untrusted_bytes(
                [u8::try_from(open_ns).unwrap(); 32],
            ),
            open_ns,
            available_ns,
            publication_ns: available_ns,
            rows: Vec::new(),
        }
    }

    fn gap(candidates: Vec<FillBarCandidateV1>) -> CustodyQuoteCutRequestV1 {
        let d = BindingDigest::from_untrusted_bytes([1; 32]);
        CustodyQuoteCutRequestV1 {
            chain_root: d,
            head_identity: d,
            view_identity: d,
            decision_cut_ns: 100,
            bound_ns_exclusive: 200,
            members: Vec::new(),
            fill_timeframe: None,
            fill_candidates: candidates,
        }
    }

    /// The gap takes the first bar opening strictly inside `(d_k, bound)`, and none at all when
    /// that bar is available only at or after the bound.
    #[rstest]
    #[case::the_first_inside(vec![candidate(100, 150), candidate(120, 150), candidate(130, 150)], Ok(120))]
    #[case::available_just_before_the_bound(vec![candidate(120, 199)], Ok(120))]
    #[case::available_at_the_bound(vec![candidate(120, 200), candidate(130, 150)], Err(()))]
    #[case::available_after_the_bound(vec![candidate(120, 250)], Err(()))]
    #[case::opening_at_the_bound(vec![candidate(200, 210)], Err(()))]
    #[case::none(vec![], Err(()))]
    fn a_gap_takes_the_first_fill_bar_inside_it_available_before_its_bound(
        #[case] candidates: Vec<FillBarCandidateV1>,
        #[case] expected: Result<u64, ()>,
    ) {
        let request = gap(candidates);
        assert_eq!(
            fill_bar_of_gap_v1(&request).map(|candidate| candidate.open_ns),
            expected.map_err(|()| NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );
    }

    #[rstest]
    #[case::the_next_frame(100, 10, 200, Some(110))]
    #[case::the_run_end(100, 10, 105, Some(105))]
    #[case::equal(100, 10, 110, Some(110))]
    #[case::overflow(u64::MAX, 1, u64::MAX, None)]
    fn a_gap_ends_at_the_next_frame_or_the_run_end(
        #[case] event: u64,
        #[case] interval: u64,
        #[case] run_end: u64,
        #[case] expected: Option<u64>,
    ) {
        assert_eq!(
            custody_quote_cut_bound_v1(event, interval, run_end),
            expected
        );
    }
}
