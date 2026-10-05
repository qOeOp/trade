//! Turns the Market Data Owner's own store reads into PIT window custody cross-sections (slice
//! B7, `docs/owners/market-data.md`), and the shared gap math a fill timeframe's per-gap read
//! needs.
//!
//! The Owner already holds `VenueBarV1`'s prices and volumes as exact [`Decimal`] values, so
//! unlike the archive path (`vision_backfill_custody_v1.rs` in the Binance adapter, which parses
//! the venue's published strings) this conversion cannot fail.

use rust_decimal::Decimal;

use super::{
    bar_schedule::{
        execution_timeframe_bar_label_v1, execution_timeframe_interval_ns_v1, served_timeframe_v1,
    },
    pit_window_custody_v1::{
        CrossSectionVersionKindV1, UntrustedCrossSectionVersionV1, UntrustedCustodyRowV1,
    },
    source_binding::{UntrustedSourceAvailabilityRuleV1, UntrustedSourceVisibilityV1},
    venue_bar_store_v1::VenueBarReadV1,
};
use crate::owner::venue_bar_store_v1::VenueBarStoreV1;

/// The venue interval the store serves a custody's fill rows under.
const FILL_VENUE_INTERVAL_V1: &str = "1m";

/// The store's own fixed grid interval for [`FILL_VENUE_INTERVAL_V1`].
const FILL_INTERVAL_NS_V1: u64 = 60_000_000_000;

/// One stored bar read as an original cross-section version for `member` at `timeframe`.
///
/// Each row's `retrieval_ns` is the version's own `availability_ns` and its `retrieval_route` is
/// the version's own source (`REST`, `CORRECTION`, ...), never the caller's wall clock: a backfill
/// rerun on another day reads the same versions and so builds the same request, which rejoins the
/// custody already committed rather than drifting its evidence.
#[must_use]
pub fn cross_section_from_venue_bar_v1(
    member: &str,
    timeframe: &str,
    read: &VenueBarReadV1,
) -> UntrustedCrossSectionVersionV1 {
    let bar = &read.bar;
    let mut rows = Vec::with_capacity(5);

    for (field, value) in [
        ("OPEN", bar.open),
        ("HIGH", bar.high),
        ("LOW", bar.low),
        ("CLOSE", bar.close),
        ("VOLUME", bar.volume),
    ] {
        rows.push(row(member, field, value, read));
    }
    UntrustedCrossSectionVersionV1 {
        timeframe: timeframe.to_owned(),
        event_effective_ns: bar.close_ns_exclusive,
        kind: CrossSectionVersionKindV1::Original,
        correction_sequence: 1,
        predecessor_version: None,
        publication_ns: None,
        rows,
    }
}

fn row(member: &str, field: &str, value: Decimal, read: &VenueBarReadV1) -> UntrustedCustodyRowV1 {
    UntrustedCustodyRowV1 {
        instrument: member.to_owned(),
        field: field.to_owned(),
        value_mantissa: value.mantissa(),
        // A `Decimal` scale is at most 28.
        value_scale: value.scale() as u8,
        retrieval_ns: read.availability_ns,
        retrieval_route: read.source.as_str().to_owned(),
    }
}

/// Each execution bar's own forward gap: the half-open window of fill-bar opens eligible for that
/// bar's fill row, computed from `execution_closes_ns` (each execution bar's own
/// `close_ns_exclusive`, any order) and `lag_ns` (the fill timeframe's availability lag after an
/// execution bar's close). One gap per execution close, in ascending close order: strictly after
/// its availability instant (close plus `lag_ns`), strictly before the next execution bar's close
/// or `window_end_ns` for the last. Shared by the live endpoint fetch
/// (`vision_backfill_v1.rs::fill_bars`, at millisecond precision) and the store-backed read
/// (slice B7, at the store's own nanosecond precision), so both choose the same gap from the same
/// rule.
#[must_use]
pub fn fill_bar_gaps_ns_v1(
    execution_closes_ns: &[u64],
    lag_ns: u64,
    window_end_ns: u64,
) -> Vec<(u64, u64)> {
    let mut closes = execution_closes_ns.to_vec();
    closes.sort_unstable();
    closes
        .iter()
        .enumerate()
        .map(|(index, close)| {
            let before = closes.get(index + 1).copied().unwrap_or(window_end_ns);
            (close.saturating_add(lag_ns), before)
        })
        .collect()
}

/// Why a custody's bar inputs could not be built from the store. Every refusal reads nothing
/// further and writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum VenueBarCustodyRefusalV1 {
    /// An execution timeframe the store does not serve, or an availability rule that is not a lag
    /// after a bar's close.
    #[error("the custody's bar inputs cannot be read as requested")]
    InvalidRequest,
    /// An unresolved conflict's bar closes inside the execution window, or is the bar a fill gap
    /// would otherwise choose.
    #[error("an unresolved conflict's bar lies in the custody's input")]
    ConflictOpen,
    /// The store holds fewer execution bars than the window's fixed grid requires.
    #[error("the execution window is not fully held")]
    WindowIncomplete,
    /// A gap after an execution bar's availability instant has no bar in the store.
    #[error("a fill gap has no bar")]
    FillBarMissing,
    #[error("the venue bar store is unavailable")]
    StoreUnavailable,
}

/// One member's custody inputs, read from the store: its execution bars and the fill bar chosen
/// for each of their gaps, each as an original cross-section version.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreCustodyInputsV1 {
    pub execution: Vec<UntrustedCrossSectionVersionV1>,
    pub fill: Vec<UntrustedCrossSectionVersionV1>,
}

/// Builds `instrument`'s custody inputs over `[window_start_ns, window_end_ns_exclusive)` at
/// `execution_timeframe`, from the Market Data Owner's own venue bar store (slice B7,
/// `docs/owners/market-data.md`) - never from an archive or endpoint fetch. A window the store
/// does not fully hold, or a bar an unresolved conflict still covers, is refused by name; there is
/// no fallback.
///
/// Every row's custody evidence is the stored version's own: `retrieval_route` is its source
/// (`REST`, `CORRECTION`, ...) and `retrieval_ns` is its own `availability_ns`, never this call's
/// wall clock, so a rerun over the same window reads the same versions and rejoins the custody
/// already committed rather than drifting its evidence.
///
/// # Errors
///
/// The refusal that names why nothing was read further.
pub async fn custody_inputs_from_store_v1(
    store: &dyn VenueBarStoreV1,
    instrument: &str,
    execution_timeframe: &str,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    availability: &UntrustedSourceAvailabilityRuleV1,
    cut_ns: u64,
) -> Result<StoreCustodyInputsV1, VenueBarCustodyRefusalV1> {
    use VenueBarCustodyRefusalV1 as Refused;

    let row_timeframe =
        execution_timeframe_bar_label_v1(execution_timeframe).ok_or(Refused::InvalidRequest)?;
    let execution_interval_ns =
        execution_timeframe_interval_ns_v1(execution_timeframe).ok_or(Refused::InvalidRequest)?;
    let UntrustedSourceVisibilityV1::AfterBarClose { lag_ns } = availability.visibility else {
        return Err(Refused::InvalidRequest);
    };

    refuse_open_conflicts_in_window(
        store,
        instrument,
        execution_timeframe,
        execution_interval_ns,
        window_start_ns,
        window_end_ns_exclusive,
    )
    .await?;
    let execution_bars = store
        .read_venue_bars_v1(
            instrument,
            execution_timeframe,
            window_start_ns,
            window_end_ns_exclusive,
            cut_ns,
            false,
        )
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
    let expected = window_end_ns_exclusive.saturating_sub(window_start_ns) / execution_interval_ns;

    if (execution_bars.len() as u64) < expected {
        return Err(Refused::WindowIncomplete);
    }

    let execution_closes_ns: Vec<u64> = execution_bars
        .iter()
        .map(|read| read.bar.close_ns_exclusive)
        .collect();
    let fill_bars = read_fill_bars_v1(
        store,
        instrument,
        &execution_closes_ns,
        lag_ns,
        window_end_ns_exclusive,
        cut_ns,
    )
    .await?;
    let fill_label = served_timeframe_v1(FILL_VENUE_INTERVAL_V1)
        .ok_or(Refused::InvalidRequest)?
        .label;

    Ok(StoreCustodyInputsV1 {
        execution: execution_bars
            .iter()
            .map(|read| cross_section_from_venue_bar_v1(instrument, row_timeframe, read))
            .collect(),
        fill: fill_bars
            .iter()
            .map(|read| cross_section_from_venue_bar_v1(instrument, fill_label, read))
            .collect(),
    })
}

/// Refuses [`VenueBarCustodyRefusalV1::ConflictOpen`] when `instrument`'s `venue_interval` has an
/// unresolved conflict whose bar closes inside `[window_start_ns, window_end_ns_exclusive)`.
async fn refuse_open_conflicts_in_window(
    store: &dyn VenueBarStoreV1,
    instrument: &str,
    venue_interval: &str,
    interval_ns: u64,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<(), VenueBarCustodyRefusalV1> {
    let conflicts = store
        .open_venue_bar_conflicts_v1(instrument, venue_interval)
        .await
        .map_err(|_| VenueBarCustodyRefusalV1::StoreUnavailable)?;
    let conflict_in_window = conflicts.iter().any(|conflict| {
        let close_ns = conflict.open_ns.saturating_add(interval_ns);
        close_ns >= window_start_ns && close_ns < window_end_ns_exclusive
    });

    if conflict_in_window {
        return Err(VenueBarCustodyRefusalV1::ConflictOpen);
    }
    Ok(())
}

/// `instrument`'s fill bar for each execution bar's own gap: the first `1m` store bar opening
/// strictly after that execution bar's availability instant (close plus `lag_ns`) and strictly
/// before the next execution bar's close, or `window_end_ns_exclusive` for the last
/// ([`fill_bar_gaps_ns_v1`]). A gap with no bar in the store, or whose chosen bar an unresolved
/// conflict still covers, is refused by name.
async fn read_fill_bars_v1(
    store: &dyn VenueBarStoreV1,
    instrument: &str,
    execution_closes_ns: &[u64],
    lag_ns: u64,
    window_end_ns_exclusive: u64,
    cut_ns: u64,
) -> Result<Vec<VenueBarReadV1>, VenueBarCustodyRefusalV1> {
    use VenueBarCustodyRefusalV1 as Refused;

    let conflicts = store
        .open_venue_bar_conflicts_v1(instrument, FILL_VENUE_INTERVAL_V1)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
    let mut fills = Vec::with_capacity(execution_closes_ns.len());

    for (after_ns, before_ns) in
        fill_bar_gaps_ns_v1(execution_closes_ns, lag_ns, window_end_ns_exclusive)
    {
        // The gap is stated in opens; the store's read filters by close, one grid interval later.
        let gap_start = after_ns
            .saturating_add(FILL_INTERVAL_NS_V1)
            .saturating_add(1);
        let gap_end = before_ns.saturating_add(FILL_INTERVAL_NS_V1);
        let bars = store
            .read_venue_bars_v1(
                instrument,
                FILL_VENUE_INTERVAL_V1,
                gap_start,
                gap_end,
                cut_ns,
                false,
            )
            .await
            .map_err(|_| Refused::StoreUnavailable)?;
        let Some(chosen) = bars.into_iter().next() else {
            return Err(Refused::FillBarMissing);
        };

        if conflicts
            .iter()
            .any(|conflict| conflict.open_ns == chosen.bar.open_ns)
        {
            return Err(Refused::ConflictOpen);
        }
        fills.push(chosen);
    }
    Ok(fills)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{FILL_VENUE_INTERVAL_V1, cross_section_from_venue_bar_v1, fill_bar_gaps_ns_v1};
    use crate::owner::{
        bar_schedule::{
            SUPPORTED_EXECUTION_TIMEFRAMES_V1, execution_timeframe_bar_label_v1,
            served_timeframe_v1,
        },
        pit_window_custody_v1::CrossSectionVersionKindV1,
        venue_bar_store_v1::{VenueBarReadV1, VenueBarSourceV1, VenueBarV1},
    };

    fn read(open_ns: u64, close_ns_exclusive: u64) -> VenueBarReadV1 {
        VenueBarReadV1 {
            bar: VenueBarV1 {
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
            },
            version: 1,
            source: VenueBarSourceV1::Rest,
            retrieval_ns: 999,
            availability_ns: 777,
            verified: false,
        }
    }

    #[rstest]
    fn a_cross_section_carries_the_versions_own_availability_and_source_never_a_wall_clock() {
        let version = cross_section_from_venue_bar_v1("BTCUSDT-PERP.BINANCE", "1H", &read(0, 3600));

        assert_eq!(version.timeframe, "1H");
        assert_eq!(version.event_effective_ns, 3600);
        assert_eq!(version.kind, CrossSectionVersionKindV1::Original);
        assert_eq!(version.rows.len(), 5);

        for custody_row in &version.rows {
            assert_eq!(custody_row.instrument, "BTCUSDT-PERP.BINANCE");
            assert_eq!(custody_row.retrieval_ns, 777);
            assert_eq!(custody_row.retrieval_route, "REST");
        }
    }

    #[rstest]
    fn a_correction_source_names_its_own_route() {
        let mut corrected = read(0, 3600);
        corrected.source = VenueBarSourceV1::Correction;

        let version = cross_section_from_venue_bar_v1("BTCUSDT-PERP.BINANCE", "1H", &corrected);

        assert!(
            version
                .rows
                .iter()
                .all(|custody_row| custody_row.retrieval_route == "CORRECTION")
        );
    }

    #[rstest]
    fn each_gap_is_strictly_after_its_own_availability_and_before_the_next_close() {
        let gaps = fill_bar_gaps_ns_v1(&[3600, 7200], 30, 10_800);

        assert_eq!(gaps, vec![(3630, 7200), (7230, 10_800)]);
    }

    #[rstest]
    fn gaps_sort_by_close_regardless_of_input_order() {
        let gaps = fill_bar_gaps_ns_v1(&[7200, 3600], 0, 10_800);

        assert_eq!(gaps, vec![(3600, 7200), (7200, 10_800)]);
    }

    #[rstest]
    fn a_single_execution_close_gaps_to_the_window_end() {
        let gaps = fill_bar_gaps_ns_v1(&[3600], 0, 9000);

        assert_eq!(gaps, vec![(3600, 9000)]);
    }

    /// `custody_inputs_from_store_v1` reads the store by the served-timeframe label and labels
    /// the custody's cross-sections by the row-timeframe label; this keeps the two from silently
    /// drifting apart.
    #[rstest]
    fn the_served_label_and_the_custody_row_label_agree_for_every_execution_timeframe() {
        for execution_timeframe in SUPPORTED_EXECUTION_TIMEFRAMES_V1 {
            let served = served_timeframe_v1(execution_timeframe).unwrap().label;
            let custody_row = execution_timeframe_bar_label_v1(execution_timeframe).unwrap();
            assert_eq!(served, custody_row, "{execution_timeframe} disagrees");
        }
        assert_eq!(
            served_timeframe_v1(FILL_VENUE_INTERVAL_V1).unwrap().label,
            "1M"
        );
    }
}
