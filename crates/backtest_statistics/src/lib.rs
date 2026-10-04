//! Exploratory report statistics as pure functions over values (`docs/owners/backtest.md`,
//! "Exploratory matched-entry control and clustered interval").
//!
//! [`matched_entry_control_v1`] measures a run's round trips against random entries of the same
//! side, year and holding period on the same bars, and bootstraps the edge over whole ISO weeks.
//! [`round_trips_from_fills`] pairs a run's fills into those round trips. Nothing here reads an
//! Owner, a database or a clock: the same values and seed give the same bytes on every host.

mod calendar;
mod fills;
mod random;

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use fills::{
    FillSideV1, FillV1, RoundTripsFromFillsErrorV1, RoundTripsV1, round_trips_from_fills,
};

use crate::{
    calendar::{iso_week_of_ns, utc_year_of_ns},
    random::SplitMix64,
};

/// The method a Result names for this control.
pub const MATCHED_ENTRY_CONTROL_METHOD_V1: &str =
    "backtest.control.matched-entry.holding-period.v1";
/// Random entries drawn for each round trip.
pub const DRAWS_PER_ENTRY_V1: u32 = 20;
/// Bootstrap resamples of the edge.
pub const INTERVAL_RESAMPLES_V1: u32 = 4_000;
/// The interval's level, in percent.
pub const INTERVAL_LEVEL_PERCENT_V1: u32 = 95;
/// The unit whole clusters of trades are resampled in.
pub const INTERVAL_CLUSTER_V1: &str = "ISO_WEEK";

const INPUT_DOMAIN: &[u8] = b"backtest.statistics.matched-entry-control.v1\0";
const DRAW_STREAM: u64 = 0x6472_6177_7331_0000;
const BOOTSTRAP_STREAM: u64 = 0x626f_6f74_3100_0000;

/// One bar of the execution timeframe: when it opens and its open price.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BarOpenV1 {
    /// The bar's open, in nanoseconds since the Unix epoch, UTC.
    pub open_ns: i64,
    /// Its open price.
    pub open: f64,
}

/// The side a round trip held.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TradeSideV1 {
    Long,
    Short,
}

impl TradeSideV1 {
    const fn sign(self) -> f64 {
        match self {
            Self::Long => 1.0,
            Self::Short => -1.0,
        }
    }

    const fn byte(self) -> u8 {
        match self {
            Self::Long => 1,
            Self::Short => 2,
        }
    }
}

/// One round trip: entered at one bar's open and left at a later one's.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct RoundTripV1 {
    pub side: TradeSideV1,
    /// The bar whose open filled the entry.
    pub entry_bar: usize,
    /// The bar whose open filled the exit.
    pub exit_bar: usize,
    pub entry_price: f64,
    pub exit_price: f64,
}

/// The values one control is measured over.
#[derive(Clone, Copy, Debug)]
pub struct MatchedEntryControlInputV1<'a> {
    /// The execution timeframe's bars, ascending by open.
    pub bars: &'a [BarOpenV1],
    /// The funding paid for holding each bar, as a fraction of notional, positive when a long
    /// pays; one per bar. `None` when the run's funding is not stated, which the Result says
    /// rather than pricing it as zero.
    pub funding_per_bar: Option<&'a [f64]>,
    /// Fee and slippage for one side of a trade, as a fraction of notional.
    pub cost_per_side: f64,
    /// The run's round trips.
    pub trades: &'a [RoundTripV1],
    /// The draw's seed; see [`seed_from_request_identity`].
    pub seed: u64,
}

/// One round trip's result and its control.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EntryControlV1 {
    /// The trade's return net of cost and funding.
    pub result: f64,
    /// The mean of its matched entries' results. Every round trip has one: its own entry bar is
    /// in its year and leaves room for its hold, so its pool is never empty.
    pub control_mean: f64,
    /// Each matched entry's result, in draw order.
    pub control_draws: Vec<f64>,
}

/// The edge's interval.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ClusteredIntervalV1 {
    /// The cluster unit, [`INTERVAL_CLUSTER_V1`].
    pub cluster: &'static str,
    pub resamples: u32,
    pub level_percent: u32,
    /// The number of distinct clusters resampled.
    pub clusters: usize,
    pub low: f64,
    pub high: f64,
}

/// A run's matched-entry control and the clustered interval of its edge.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MatchedEntryControlV1 {
    /// [`MATCHED_ENTRY_CONTROL_METHOD_V1`].
    pub method: &'static str,
    pub draws_per_entry: u32,
    pub seed: u64,
    /// Whether funding was priced; a control without it is not a perpetual's full control.
    pub funding_stated: bool,
    /// SHA-256 of the inputs measured, in their canonical encoding.
    pub input_digest: [u8; 32],
    /// One per round trip, in input order.
    pub entries: Vec<EntryControlV1>,
    /// The mean over round trips of result minus control, or `None` with no round trip.
    pub edge: Option<f64>,
    /// The edge's interval, or `None` with no round trip.
    pub interval: Option<ClusteredIntervalV1>,
}

/// Why the inputs were not measured.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MatchedEntryControlErrorV1 {
    #[error("STATISTICS_BARS_EMPTY: no bar was given")]
    BarsEmpty,
    #[error("STATISTICS_BARS_NOT_ASCENDING: bar {0} does not open after the bar before it")]
    BarsNotAscending(usize),
    #[error("STATISTICS_PRICE_INVALID: bar {0}'s open is not a positive finite price")]
    BarPriceInvalid(usize),
    #[error("STATISTICS_FUNDING_LENGTH: funding is given for {funding} bars, not the {bars} bars")]
    FundingLength { funding: usize, bars: usize },
    #[error("STATISTICS_FUNDING_INVALID: bar {0}'s funding is not finite")]
    FundingInvalid(usize),
    #[error("STATISTICS_COST_INVALID: the cost per side is not a finite fraction of at least zero")]
    CostInvalid,
    #[error(
        "STATISTICS_TRADE_BARS_INVALID: round trip {0} does not exit after it enters, inside the bars"
    )]
    TradeBarsInvalid(usize),
    #[error("STATISTICS_PRICE_INVALID: round trip {0}'s prices are not positive and finite")]
    TradePriceInvalid(usize),
}

/// The draw's seed for one request: the first eight bytes of its identity, little-endian, so the
/// requester chooses nothing and a replay of the same request draws the same entries.
#[must_use]
pub fn seed_from_request_identity(identity: &[u8; 32]) -> u64 {
    let mut bytes = [0; 8];
    bytes.copy_from_slice(&identity[..8]);
    u64::from_le_bytes(bytes)
}

/// Measures the round trips against matched random entries and bootstraps the edge.
///
/// # Errors
///
/// Returns the first input that is not a measurable value, by name.
pub fn matched_entry_control_v1(
    input: &MatchedEntryControlInputV1<'_>,
) -> Result<MatchedEntryControlV1, MatchedEntryControlErrorV1> {
    validate(input)?;
    let bars = input.bars;
    let years: Vec<i32> = bars.iter().map(|bar| utc_year_of_ns(bar.open_ns)).collect();
    let mut draws = SplitMix64::new(input.seed ^ DRAW_STREAM);
    let no_funding = vec![0.0; bars.len()];
    let funding = input.funding_per_bar.unwrap_or(&no_funding);
    let mut entries = Vec::with_capacity(input.trades.len());
    let mut edges = Vec::new();

    for trade in input.trades {
        let hold = trade.exit_bar - trade.entry_bar;
        let result = round_trip_result(
            trade.side,
            trade.entry_price,
            trade.exit_price,
            &funding[trade.entry_bar..trade.exit_bar],
            input.cost_per_side,
        );
        let year = years[trade.entry_bar];
        let first = years.partition_point(|&bar_year| bar_year < year);
        let end = years
            .partition_point(|&bar_year| bar_year <= year)
            .min(bars.len() - hold);

        debug_assert!(first <= trade.entry_bar && trade.entry_bar < end);
        let control_draws: Vec<f64> = (0..DRAWS_PER_ENTRY_V1)
            .map(|_| {
                let entry = first + draws.below(end - first);
                round_trip_result(
                    trade.side,
                    bars[entry].open,
                    bars[entry + hold].open,
                    &funding[entry..entry + hold],
                    input.cost_per_side,
                )
            })
            .collect();
        let control_mean = control_draws.iter().sum::<f64>() / f64::from(DRAWS_PER_ENTRY_V1);
        edges.push((
            iso_week_of_ns(bars[trade.entry_bar].open_ns),
            result - control_mean,
        ));
        entries.push(EntryControlV1 {
            result,
            control_mean,
            control_draws,
        });
    }
    let edge = (!edges.is_empty())
        .then(|| edges.iter().map(|(_, edge)| edge).sum::<f64>() / edges.len() as f64);
    let interval = (!edges.is_empty()).then(|| week_clustered_interval(&edges, input.seed));
    Ok(MatchedEntryControlV1 {
        method: MATCHED_ENTRY_CONTROL_METHOD_V1,
        draws_per_entry: DRAWS_PER_ENTRY_V1,
        seed: input.seed,
        funding_stated: input.funding_per_bar.is_some(),
        input_digest: input_digest(input),
        entries,
        edge,
        interval,
    })
}

/// A round trip's return net of cost on both sides and of the funding over the bars it held.
fn round_trip_result(side: TradeSideV1, entry: f64, exit: f64, funding: &[f64], cost: f64) -> f64 {
    side.sign() * (exit / entry - 1.0) - 2.0 * cost - side.sign() * funding.iter().sum::<f64>()
}

/// Resamples whole clusters with replacement; each resample's statistic is its edges' sum over
/// its edges' count, and the interval is the resamples' percentiles, interpolated linearly.
fn week_clustered_interval(edges: &[(i64, f64)], seed: u64) -> ClusteredIntervalV1 {
    let mut clusters: Vec<(i64, f64, u32)> = Vec::new();

    for &(week, edge) in edges {
        match clusters.binary_search_by_key(&week, |cluster| cluster.0) {
            Ok(index) => {
                clusters[index].1 += edge;
                clusters[index].2 += 1;
            }
            Err(index) => clusters.insert(index, (week, edge, 1)),
        }
    }
    let mut random = SplitMix64::new(seed ^ BOOTSTRAP_STREAM);
    let mut statistics: Vec<f64> = (0..INTERVAL_RESAMPLES_V1)
        .map(|_| {
            let (mut sum, mut count) = (0.0, 0_u64);

            for _ in 0..clusters.len() {
                let (_, cluster_sum, cluster_count) = clusters[random.below(clusters.len())];
                sum += cluster_sum;
                count += u64::from(cluster_count);
            }
            sum / count as f64
        })
        .collect();
    statistics.sort_by(f64::total_cmp);
    let tail = f64::from(100 - INTERVAL_LEVEL_PERCENT_V1) / 2.0;
    ClusteredIntervalV1 {
        cluster: INTERVAL_CLUSTER_V1,
        resamples: INTERVAL_RESAMPLES_V1,
        level_percent: INTERVAL_LEVEL_PERCENT_V1,
        clusters: clusters.len(),
        low: percentile(&statistics, tail),
        high: percentile(&statistics, 100.0 - tail),
    }
}

/// The `q`th percentile of sorted values, interpolated linearly between the closest ranks.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    let rank = q / 100.0 * (sorted.len() - 1) as f64;
    let below = rank.floor();
    let index = below as usize;
    let above = sorted[(index + 1).min(sorted.len() - 1)];
    sorted[index] + (above - sorted[index]) * (rank - below)
}

fn validate(input: &MatchedEntryControlInputV1<'_>) -> Result<(), MatchedEntryControlErrorV1> {
    let bars = input.bars;

    if bars.is_empty() {
        return Err(MatchedEntryControlErrorV1::BarsEmpty);
    }

    for (index, bar) in bars.iter().enumerate() {
        if !(bar.open.is_finite() && bar.open > 0.0) {
            return Err(MatchedEntryControlErrorV1::BarPriceInvalid(index));
        }

        if index > 0 && bar.open_ns <= bars[index - 1].open_ns {
            return Err(MatchedEntryControlErrorV1::BarsNotAscending(index));
        }
    }

    if let Some(funding) = input.funding_per_bar {
        if funding.len() != bars.len() {
            return Err(MatchedEntryControlErrorV1::FundingLength {
                funding: funding.len(),
                bars: bars.len(),
            });
        }

        if let Some(index) = funding.iter().position(|rate| !rate.is_finite()) {
            return Err(MatchedEntryControlErrorV1::FundingInvalid(index));
        }
    }

    if !(input.cost_per_side.is_finite() && input.cost_per_side >= 0.0) {
        return Err(MatchedEntryControlErrorV1::CostInvalid);
    }

    for (index, trade) in input.trades.iter().enumerate() {
        if trade.entry_bar >= trade.exit_bar || trade.exit_bar >= bars.len() {
            return Err(MatchedEntryControlErrorV1::TradeBarsInvalid(index));
        }

        if ![trade.entry_price, trade.exit_price]
            .iter()
            .all(|price| price.is_finite() && *price > 0.0)
        {
            return Err(MatchedEntryControlErrorV1::TradePriceInvalid(index));
        }
    }
    Ok(())
}

/// SHA-256 over a domain and every input, lengths first, numbers little-endian.
fn input_digest(input: &MatchedEntryControlInputV1<'_>) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(INPUT_DOMAIN);
    hasher.update((input.bars.len() as u64).to_le_bytes());

    for bar in input.bars {
        hasher.update(bar.open_ns.to_le_bytes());
        hasher.update(bar.open.to_bits().to_le_bytes());
    }

    match input.funding_per_bar {
        None => hasher.update([0]),
        Some(funding) => {
            hasher.update([1]);

            for rate in funding {
                hasher.update(rate.to_bits().to_le_bytes());
            }
        }
    }
    hasher.update(input.cost_per_side.to_bits().to_le_bytes());
    hasher.update((input.trades.len() as u64).to_le_bytes());

    for trade in input.trades {
        hasher.update([trade.side.byte()]);
        hasher.update((trade.entry_bar as u64).to_le_bytes());
        hasher.update((trade.exit_bar as u64).to_le_bytes());
        hasher.update(trade.entry_price.to_bits().to_le_bytes());
        hasher.update(trade.exit_price.to_bits().to_le_bytes());
    }
    hasher.update(input.seed.to_le_bytes());
    hasher.finalize().into()
}

#[cfg(test)]
mod tests;
