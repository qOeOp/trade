//! What one member's PIT window custody is committed under, and what each custody refusal means
//! for the backfill.
//!
//! The governing text is `docs/owners/market-data.md`, "Binance USD-M history for T0" and
//! "PIT window custody". The basis names the operator's binding, semantics, selection, window and
//! timeframes; the custody request itself is built from the Market Data Owner's own venue bar
//! store (slice B7, `vibe_data::owner::venue_bar_custody_v1`), never from fetched archive or
//! endpoint bars - that path retired once the store became the backfill's source of bars.

use vibe_data::owner::{
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::PitWindowCustodyRefusalV1,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

/// What one member's custody is committed under, stated by the operator who admitted them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackfillCustodyBasisV1 {
    pub source_binding: UntrustedSourceBindingLocator,
    pub market_semantics_identity: BindingDigest,
    /// The typed Market Semantics value the custody claims for that scope.
    pub market_semantics_value: MarketSemanticsValueSubmissionV1,
    pub universe_selection: UntrustedUniverseSelectionLocatorV1,
    /// The member's canonical instrument.
    pub member: String,
    /// Inclusive start of the window, its warm-up included.
    pub window_start_ns: u64,
    /// Exclusive end of the window.
    pub window_end_ns_exclusive: u64,
    /// The label of the timeframe a run's frames are enumerated from, among the inputs.
    pub execution_timeframe: String,
    /// The label of the fill timeframe, which serves quote cuts only.
    pub fill_timeframe: String,
}

/// What the backfill does about one custody refusal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BackfillRefusalDispositionV1 {
    /// Nothing is wrong with the request; submit the same custody again later.
    RetryLater,
    /// The request this writer built is malformed: a defect here, not in the data.
    WriterDefect,
    /// The operator's basis - binding, semantics, selection, window or timeframes - is refused;
    /// a new basis is needed before anything is committed.
    BasisRefused,
}

/// The disposition of one custody refusal.
#[must_use]
pub const fn refusal_disposition_v1(
    refusal: PitWindowCustodyRefusalV1,
) -> BackfillRefusalDispositionV1 {
    use BackfillRefusalDispositionV1::{BasisRefused, RetryLater, WriterDefect};
    use PitWindowCustodyRefusalV1::{
        AvailabilityLagNotBelowBarInterval, BarOhlcInconsistent, CrossSectionBranch,
        CrossSectionCorrectionNotPublishedBySource, ExecutionTimeframeNotFixedInterval,
        FillTimeframeIsAnInputTimeframe, FillTimeframeNotFinerThanExecution,
        FillTimeframeNotOneMinute, IdentityConflict, InvalidRequest, MarketSemanticsMismatch,
        MarketSemanticsScopeValueConflict, RetrievalAfterMintingCut, RowRetrievedBeforeBarClose,
        SourceBindingDeclaresNoAvailabilityRule, SourceBindingUnavailable, StoreUnavailable,
        SuccessorBasisChanged, UniverseSelectionLineageMismatch, ValueFinerThanSeriesScale,
        VersionNotAvailableAtMintingCut, WindowMemberNotValidThroughout,
    };

    match refusal {
        // The Owner mints the cut inside the commit, so a later attempt finds it past every
        // retrieval this writer stated.
        // A bar the rule makes visible later than this cut is visible to a later one.
        StoreUnavailable | RetrievalAfterMintingCut | VersionNotAvailableAtMintingCut => RetryLater,
        // A bar retrieved before it closed is today's open bar, and a value past nine places is
        // one this writer passed unchecked: the same request is refused again.
        RowRetrievedBeforeBarClose | ValueFinerThanSeriesScale => WriterDefect,
        // The fill timeframe is this writer's own constant: a non-minute one is a writer defect.
        FillTimeframeNotOneMinute => WriterDefect,
        // A bar whose prices cannot be a bar is the venue's inconsistency or this writer's
        // misreading; the same request is refused again, so it is never retried.
        BarOhlcInconsistent => WriterDefect,
        InvalidRequest
        | CrossSectionBranch
        | CrossSectionCorrectionNotPublishedBySource
        | SuccessorBasisChanged => WriterDefect,
        SourceBindingUnavailable
        | SourceBindingDeclaresNoAvailabilityRule
        | MarketSemanticsMismatch
        | UniverseSelectionLineageMismatch
        | WindowMemberNotValidThroughout
        | ExecutionTimeframeNotFixedInterval
        | AvailabilityLagNotBelowBarInterval
        | FillTimeframeNotFinerThanExecution
        | FillTimeframeIsAnInputTimeframe
        | IdentityConflict
        | MarketSemanticsScopeValueConflict => BasisRefused,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case(
        PitWindowCustodyRefusalV1::StoreUnavailable,
        BackfillRefusalDispositionV1::RetryLater
    )]
    #[case(
        PitWindowCustodyRefusalV1::RetrievalAfterMintingCut,
        BackfillRefusalDispositionV1::RetryLater
    )]
    #[case(
        PitWindowCustodyRefusalV1::VersionNotAvailableAtMintingCut,
        BackfillRefusalDispositionV1::RetryLater
    )]
    #[case(
        PitWindowCustodyRefusalV1::RowRetrievedBeforeBarClose,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::ValueFinerThanSeriesScale,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::FillTimeframeNotOneMinute,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::BarOhlcInconsistent,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::InvalidRequest,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::CrossSectionBranch,
        BackfillRefusalDispositionV1::WriterDefect
    )]
    #[case(
        PitWindowCustodyRefusalV1::WindowMemberNotValidThroughout,
        BackfillRefusalDispositionV1::BasisRefused
    )]
    #[case(
        PitWindowCustodyRefusalV1::FillTimeframeIsAnInputTimeframe,
        BackfillRefusalDispositionV1::BasisRefused
    )]
    #[case(
        PitWindowCustodyRefusalV1::MarketSemanticsScopeValueConflict,
        BackfillRefusalDispositionV1::BasisRefused
    )]
    fn each_refusal_names_what_the_backfill_does(
        #[case] refusal: PitWindowCustodyRefusalV1,
        #[case] disposition: BackfillRefusalDispositionV1,
    ) {
        assert_eq!(refusal_disposition_v1(refusal), disposition);
    }
}
