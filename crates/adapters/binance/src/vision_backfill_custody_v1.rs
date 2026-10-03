//! Turns one perpetual's fetched bars into a T0 PIT window custody request, and names what each
//! custody refusal means for the backfill.
//!
//! The governing text is `docs/owners/market-data.md`, "Binance USD-M history for T0". A custody
//! holds one member: its execution bars, its other input timeframes, and the fill bars the
//! fetcher found for each gap. The whole custody is committed once; resuming lives in the
//! fetcher's shards, not here.
//!
//! Values cross as the venue published them. Every price and volume string becomes the exact
//! mantissa and scale it spells, and Market Data's custody commit rescales it to the member's
//! Instrument Master precision or refuses it by name. That commit is where external market data
//! enters Market Data, so it is the one place a value is checked; repeating the check here would
//! be a second definition of it.

use rust_decimal::Decimal;
use vibe_data::owner::{
    pit_window_custody_v1::{
        CrossSectionVersionKindV1, PitWindowCustodyRefusalV1, UntrustedCrossSectionVersionV1,
        UntrustedCustodyRowV1, UntrustedPitWindowCustodyRequestV1,
    },
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

use crate::vision_backfill_v1::FetchedBarV1;

const NANOS_PER_MILLI: u64 = 1_000_000;

/// What one member's custody is committed under, stated by the operator who admitted them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackfillCustodyBasisV1 {
    pub source_binding: UntrustedSourceBindingLocator,
    pub market_semantics_identity: BindingDigest,
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

/// Every fetched bar of one timeframe, under the label its Source Binding declares.
#[derive(Clone, Debug, PartialEq)]
pub struct BackfillTimeframeBarsV1 {
    pub label: String,
    pub bars: Vec<FetchedBarV1>,
}

/// Why a custody request could not be built from the fetched bars.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum BackfillCustodyErrorV1 {
    /// A price or volume the venue published is not a decimal number.
    #[error("the venue published {value:?}, which is not a decimal number")]
    ValueNotDecimal { value: String },
    /// A bar's open or close lies before the Unix epoch.
    #[error("a bar opening at {open_time_ms} ms lies before the Unix epoch")]
    InstantBeforeEpoch { open_time_ms: i64 },
}

/// The custody request for one member: every bar of every input timeframe and every fill bar
/// that lies wholly inside the window, as one original version each.
///
/// A bar is labelled by its interval-close instant, the instant after the venue's inclusive close
/// time. A gap the fetcher found no fill bar for is simply absent, and the custody's derived view
/// refuses a run over it as `QuoteCutMissing`.
///
/// # Errors
///
/// Returns [`BackfillCustodyErrorV1`] for a value that is not a decimal number or a bar before
/// the Unix epoch.
pub fn custody_request_v1(
    basis: BackfillCustodyBasisV1,
    inputs: &[BackfillTimeframeBarsV1],
    fill_bars: &[FetchedBarV1],
) -> Result<UntrustedPitWindowCustodyRequestV1, BackfillCustodyErrorV1> {
    let mut cross_sections = Vec::new();

    for timeframe in inputs {
        for bar in &timeframe.bars {
            if let Some(version) = cross_section(&basis, &timeframe.label, bar)? {
                cross_sections.push(version);
            }
        }
    }

    for bar in fill_bars {
        if let Some(version) = cross_section(&basis, &basis.fill_timeframe, bar)? {
            cross_sections.push(version);
        }
    }
    cross_sections.sort_by(|a, b| {
        (a.event_effective_ns, &a.timeframe).cmp(&(b.event_effective_ns, &b.timeframe))
    });

    Ok(UntrustedPitWindowCustodyRequestV1 {
        source_binding: basis.source_binding,
        market_semantics_identity: basis.market_semantics_identity,
        universe_selection: basis.universe_selection,
        members: vec![basis.member],
        window_start_ns: basis.window_start_ns,
        window_end_ns_exclusive: basis.window_end_ns_exclusive,
        execution_timeframe: basis.execution_timeframe,
        input_timeframes: inputs.iter().map(|input| input.label.clone()).collect(),
        fill_timeframe: Some(basis.fill_timeframe),
        predecessor: None,
        cross_sections,
    })
}

/// One bar as an original version, or `None` for a bar not wholly inside the window.
fn cross_section(
    basis: &BackfillCustodyBasisV1,
    timeframe: &str,
    bar: &FetchedBarV1,
) -> Result<Option<UntrustedCrossSectionVersionV1>, BackfillCustodyErrorV1> {
    let kline = &bar.kline;
    let before_epoch = BackfillCustodyErrorV1::InstantBeforeEpoch {
        open_time_ms: kline.open_time,
    };
    let open_ns = millis_to_nanos(kline.open_time).ok_or_else(|| before_epoch.clone())?;
    let close_ns = kline
        .close_time
        .checked_add(1)
        .and_then(millis_to_nanos)
        .ok_or(before_epoch)?;

    if open_ns < basis.window_start_ns || close_ns > basis.window_end_ns_exclusive {
        return Ok(None);
    }
    let mut rows = Vec::with_capacity(5);

    for (field, value) in [
        ("OPEN", &kline.open),
        ("HIGH", &kline.high),
        ("LOW", &kline.low),
        ("CLOSE", &kline.close),
        ("VOLUME", &kline.volume),
    ] {
        let decimal = Decimal::from_str_exact(value).map_err(|_| {
            BackfillCustodyErrorV1::ValueNotDecimal {
                value: value.clone(),
            }
        })?;
        rows.push(UntrustedCustodyRowV1 {
            instrument: basis.member.clone(),
            field: field.to_string(),
            value_mantissa: decimal.mantissa(),
            // A `Decimal` scale is at most 28.
            value_scale: decimal.scale() as u8,
            retrieval_ns: bar.retrieval_ns,
            retrieval_route: bar.route.to_string(),
        });
    }
    Ok(Some(UntrustedCrossSectionVersionV1 {
        timeframe: timeframe.to_string(),
        event_effective_ns: close_ns,
        kind: CrossSectionVersionKindV1::Original,
        correction_sequence: 1,
        predecessor_version: None,
        publication_ns: None,
        rows,
    }))
}

fn millis_to_nanos(millis: i64) -> Option<u64> {
    u64::try_from(millis).ok()?.checked_mul(NANOS_PER_MILLI)
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
        AvailabilityLagNotBelowBarInterval, CrossSectionBranch,
        CrossSectionCorrectionNotPublishedBySource, ExecutionTimeframeNotFixedInterval,
        FillTimeframeIsAnInputTimeframe, FillTimeframeNotFinerThanExecution, IdentityConflict,
        InvalidRequest, MarketSemanticsMismatch, RetrievalAfterMintingCut,
        SourceBindingDeclaresNoAvailabilityRule, SourceBindingUnavailable, StoreUnavailable,
        SuccessorBasisChanged, WindowMemberNotValidThroughout,
    };

    match refusal {
        // The Owner mints the cut inside the commit, so a later attempt finds it past every
        // retrieval this writer stated.
        StoreUnavailable | RetrievalAfterMintingCut => RetryLater,
        InvalidRequest
        | CrossSectionBranch
        | CrossSectionCorrectionNotPublishedBySource
        | SuccessorBasisChanged => WriterDefect,
        SourceBindingUnavailable
        | SourceBindingDeclaresNoAvailabilityRule
        | MarketSemanticsMismatch
        | WindowMemberNotValidThroughout
        | ExecutionTimeframeNotFixedInterval
        | AvailabilityLagNotBelowBarInterval
        | FillTimeframeNotFinerThanExecution
        | FillTimeframeIsAnInputTimeframe
        | IdentityConflict => BasisRefused,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rstest::rstest;
    use vibe_data::owner::source_binding::{
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf,
        UntrustedSourceBindingLocatorFields,
    };

    use super::*;
    use crate::{
        futures::http::models::BinanceFuturesKline,
        vision_backfill_v1::{ARCHIVE_ROUTE, ENDPOINT_ROUTE},
    };

    const MINUTE_MS: i64 = 60_000;
    const FOUR_HOURS_MS: i64 = 14_400_000;
    const DAY_MS: i64 = 86_400_000;
    /// 2021-06-01T00:00:00Z.
    const JUNE_2021_MS: i64 = 1_622_505_600_000;
    const RETRIEVED_NS: u64 = 1_791_000_000_000_000_000;
    const MEMBER: &str = "BTCUSDT-PERP.BINANCE";

    /// A bar whose prices and volume are the first row of the real BTCUSDT `1d` 2021-06 archive.
    fn bar(open_time: i64, interval_ms: i64, route: &'static str) -> FetchedBarV1 {
        FetchedBarV1 {
            kline: BinanceFuturesKline {
                open_time,
                open: "37244.36".to_string(),
                high: "37893.76".to_string(),
                low: "35500.00".to_string(),
                close: "36693.41".to_string(),
                volume: "590822.540".to_string(),
                close_time: open_time + interval_ms - 1,
                quote_volume: "21609364827.08958".to_string(),
                num_trades: 5_297_320,
                taker_buy_base_volume: "291774.994".to_string(),
                taker_buy_quote_volume: "10673866023.68145".to_string(),
            },
            retrieval_ns: RETRIEVED_NS,
            route,
        }
    }

    fn nanos(millis: i64) -> u64 {
        millis_to_nanos(millis).unwrap()
    }

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn source_binding() -> UntrustedSourceBindingLocator {
        UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
            owner: "MARKET_DATA".to_owned(),
            lineage_root: digest(1),
            lineage_version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
            binding_id: digest(1),
            fact_digest: digest(2),
            credential_handle_identity: digest(3),
            credential_audience: UntrustedCredentialAudienceClaim::MarketData,
            credential_capabilities: BTreeSet::from([
                UntrustedCredentialCapabilityClaim::MarketDataRead,
            ]),
            source_frontier: UntrustedCompleteFrontier {
                stream_identity: "source-stream".to_owned(),
                cut_identity: "source-cut".to_owned(),
                sequence: 1,
                digest: digest(4),
            },
            correction_frontier: UntrustedCompleteFrontier {
                stream_identity: "correction-stream".to_owned(),
                cut_identity: "correction-cut".to_owned(),
                sequence: 1,
                digest: digest(5),
            },
            time_evidence: UntrustedMarketDataAsOf {
                claimed_evidence_identity: digest(6),
                clock_identity: "clock".to_owned(),
                clock_epoch: "epoch-1".to_owned(),
                monotonic_sequence: 1,
                restart_continuity_digest: digest(7),
                skew_bound: 2,
                uncertainty_bound: 1,
                event_effective: 1,
                provider_available: 2,
                retrieval: 3,
                correction_publication: 2,
                observed_at: 4,
                effective_at: 4,
                valid_through: 5,
            },
        })
    }

    fn basis() -> BackfillCustodyBasisV1 {
        BackfillCustodyBasisV1 {
            source_binding: source_binding(),
            market_semantics_identity: digest(8),
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(
                digest(9),
                digest(10),
            ),
            member: MEMBER.to_string(),
            window_start_ns: nanos(JUNE_2021_MS),
            window_end_ns_exclusive: nanos(JUNE_2021_MS + 2 * DAY_MS),
            execution_timeframe: "1d".to_string(),
            fill_timeframe: "1m".to_string(),
        }
    }

    fn daily(bars: Vec<FetchedBarV1>) -> BackfillTimeframeBarsV1 {
        BackfillTimeframeBarsV1 {
            label: "1d".to_string(),
            bars,
        }
    }

    #[rstest]
    fn a_members_bars_become_one_custody_of_original_versions_labelled_by_their_close() {
        let inputs = [
            daily(vec![
                bar(JUNE_2021_MS, DAY_MS, ARCHIVE_ROUTE),
                bar(JUNE_2021_MS + DAY_MS, DAY_MS, ARCHIVE_ROUTE),
            ]),
            BackfillTimeframeBarsV1 {
                label: "4h".to_string(),
                bars: vec![bar(JUNE_2021_MS, FOUR_HOURS_MS, ARCHIVE_ROUTE)],
            },
        ];
        let fill = bar(JUNE_2021_MS + DAY_MS + MINUTE_MS, MINUTE_MS, ENDPOINT_ROUTE);

        let request = custody_request_v1(basis(), &inputs, &[fill]).unwrap();

        assert_eq!(request.members, vec![MEMBER.to_string()]);
        assert_eq!(request.execution_timeframe, "1d");
        assert_eq!(request.input_timeframes, vec!["1d", "4h"]);
        assert_eq!(request.fill_timeframe.as_deref(), Some("1m"));
        assert_eq!(request.predecessor, None);
        assert_eq!(request.source_binding, source_binding());
        assert_eq!(
            request
                .cross_sections
                .iter()
                .map(|version| (version.timeframe.as_str(), version.event_effective_ns))
                .collect::<Vec<_>>(),
            vec![
                ("4h", nanos(JUNE_2021_MS + FOUR_HOURS_MS)),
                ("1d", nanos(JUNE_2021_MS + DAY_MS)),
                ("1m", nanos(JUNE_2021_MS + DAY_MS + 2 * MINUTE_MS)),
                ("1d", nanos(JUNE_2021_MS + 2 * DAY_MS)),
            ],
        );

        let first_day = &request.cross_sections[1];
        assert_eq!(first_day.kind, CrossSectionVersionKindV1::Original);
        assert_eq!(first_day.correction_sequence, 1);
        assert_eq!(first_day.predecessor_version, None);
        assert_eq!(first_day.publication_ns, None);
        assert_eq!(
            first_day
                .rows
                .iter()
                .map(|row| (row.field.as_str(), row.value_mantissa, row.value_scale))
                .collect::<Vec<_>>(),
            vec![
                ("OPEN", 3_724_436, 2),
                ("HIGH", 3_789_376, 2),
                ("LOW", 3_550_000, 2),
                ("CLOSE", 3_669_341, 2),
                ("VOLUME", 590_822_540, 3),
            ],
            "each value keeps the exact digits the venue published"
        );
        assert!(first_day.rows.iter().all(|row| row.instrument == MEMBER
            && row.retrieval_ns == RETRIEVED_NS
            && row.retrieval_route == ARCHIVE_ROUTE));
        assert!(
            request.cross_sections[2]
                .rows
                .iter()
                .all(|row| row.retrieval_route == ENDPOINT_ROUTE)
        );
    }

    #[rstest]
    fn a_bar_not_wholly_inside_the_window_is_left_out() {
        let inputs = [daily(vec![
            bar(JUNE_2021_MS - DAY_MS, DAY_MS, ARCHIVE_ROUTE),
            bar(JUNE_2021_MS, DAY_MS, ARCHIVE_ROUTE),
            bar(JUNE_2021_MS + 2 * DAY_MS, DAY_MS, ARCHIVE_ROUTE),
        ])];

        let request = custody_request_v1(basis(), &inputs, &[]).unwrap();

        assert_eq!(
            request
                .cross_sections
                .iter()
                .map(|version| version.event_effective_ns)
                .collect::<Vec<_>>(),
            vec![nanos(JUNE_2021_MS + DAY_MS)],
        );
    }

    #[rstest]
    fn a_value_that_is_not_decimal_is_refused() {
        let mut unreadable = bar(JUNE_2021_MS, DAY_MS, ARCHIVE_ROUTE);
        unreadable.kline.volume = "590,822.540".to_string();

        assert_eq!(
            custody_request_v1(basis(), &[daily(vec![unreadable])], &[]),
            Err(BackfillCustodyErrorV1::ValueNotDecimal {
                value: "590,822.540".to_string()
            }),
        );
    }

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
    fn each_refusal_names_what_the_backfill_does(
        #[case] refusal: PitWindowCustodyRefusalV1,
        #[case] disposition: BackfillRefusalDispositionV1,
    ) {
        assert_eq!(refusal_disposition_v1(refusal), disposition);
    }
}
