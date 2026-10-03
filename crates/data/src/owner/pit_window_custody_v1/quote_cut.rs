//! The quote cut a custody frame's gap takes its Quotes from (the hook slice T0-6 fills).
//!
//! T0-5 fixes what a derivation is asked and how far a gap reaches; the derivation itself - the
//! observed best bid and offer, or the open of the first fill bar after the decision cut - is
//! T0-6's. Until it exists, every request for one fails closed as `QuoteCutMissing`: no quote is
//! invented.

use super::authority::RecordedTimeframeV1;
use crate::owner::source_binding::BindingDigest;

/// What a quote cut derivation is asked for one gap.
#[expect(dead_code, reason = "asked of the quote cut derivation (T0-6)")]
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

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::custody_quote_cut_bound_v1;

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
