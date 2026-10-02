//! A Binance USD-M futures Data Client that answers one Owner-issued PIT observation scope.
//!
//! Binance publishes its futures klines and its funding history without a credential - `klines`
//! and `funding_rate` call their transport with `signed = false` - so this client needs no key and
//! spends nothing. It refuses to be built over an HTTP client that holds one, because that client
//! puts the key in the default headers of every request, signed or not. It states only what the
//! exchange said and when, never what any of it is bound to; Market Data stamps the Source Binding,
//! Instrument Master, Universe Selection, Market Semantics and correction bindings itself.
//!
//! A snapshot is one as-of cut rather than a series, so the answer for each member is the last bar
//! that had already closed at the scope's event-effective coordinate. A bar still open at that
//! coordinate is not yet a fact about it, and one that closed later cannot backfill it.
//!
//! Beside that bar the member's last settled funding is stated as two `SCALAR` rows on timeframe
//! `TICK`: the rate as published, and the settlement instant. A settled rate is knowable at its
//! own settlement, so a settlement at exactly the coordinate counts and one a millisecond later
//! does not. The endpoint never states the settlement interval, so no row claims one. Where no
//! settlement applies at the coordinate the member has no funding rows: a zero rate in their place
//! would be this client's invention.
//!
//! Beside them stands the open interest last published at the coordinate, as three `SCALAR` rows
//! on `TICK`: contracts, notional, and the snapshot instant. The venue samples it every five
//! minutes and publishes a sample about two minutes late, so a snapshot is visible five minutes
//! after its instant. The endpoint serves the last 30 days; older coordinates are read from the
//! public archive's daily `metrics` file, which stamps the same snapshot five minutes earlier.
//!
//! This venue quotes its klines as decimal strings rather than as a mantissa and an exponent, so
//! the prices are read from those digits directly. Parsing them through `f64` would round the
//! vendor's own number to the nearest double and make this client the author of a price it was only
//! meant to repeat.

use std::{
    collections::{BTreeMap, HashMap},
    fmt::{Debug, Display},
};

use async_trait::async_trait;
use rust_decimal::Decimal;
use vibe_core::{AtomicTime, time::get_atomic_clock_realtime};
use vibe_data::owner::pit_observation_source_v1::{
    PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1, VendorObservationV1,
};
use vibe_network::http::HttpClient;

use crate::{
    common::offline::checksummed_single_member,
    futures::http::{
        client::BinanceFuturesHttpClient,
        models::{BinanceFundingRate, BinanceFuturesKline},
        query::{BinanceFundingRateParams, BinanceKlinesParams, BinanceOpenInterestHistParams},
    },
};

/// The channel every row on this client belongs to.
const CHANNEL: &str = "MARKET";
/// The data kind a kline is, in the Owner's admitted vocabulary.
const DATA_KIND: &str = "BAR";
/// The data kind funding and open interest are: vendor-stated numbers, not part of any bar.
const SCALAR_DATA_KIND: &str = "SCALAR";
/// A settlement or a sample is one instant, not an aggregate over an interval.
const SCALAR_TIMEFRAME: &str = "TICK";
/// The settled rate, as the venue published its decimal.
const FUNDING_RATE_FIELD: &str = "FUNDING_RATE";
/// The settlement instant, in nanoseconds since the Unix epoch.
const FUNDING_TIME_FIELD: &str = "FUNDING_TIME";
/// How many settlements one member request asks for: the one in force and the one before it,
/// whose spacing says when the next was due.
const FUNDING_LIMIT: u32 = 2;
const NANOS_PER_MILLI: i128 = 1_000_000;
/// Contracts open at the snapshot.
const OPEN_INTEREST_FIELD: &str = "OPEN_INTEREST";
/// Their notional, in the quote asset.
const OPEN_INTEREST_VALUE_FIELD: &str = "OPEN_INTEREST_VALUE";
/// The snapshot instant in nanoseconds, in the endpoint's convention.
const OPEN_INTEREST_TIME_FIELD: &str = "OPEN_INTEREST_TIME";
const FIVE_MINUTES_MS: i64 = 300_000;
const DAY_MS: i64 = 86_400_000;
/// A sample is published about two minutes after its instant (104-144 s measured on 2026-10-02),
/// so one whole sampling period passes before a snapshot counts as known.
const OPEN_INTEREST_VISIBLE_AFTER_MS: i64 = FIVE_MINUTES_MS;
/// The oldest visible snapshot still stated as the one in force: one missed sample is a delay,
/// more is a gap.
const OPEN_INTEREST_STALE_AFTER_MS: i64 = 3 * FIVE_MINUTES_MS;
/// The endpoint serves the last 30 days; a day of margin keeps a coordinate near that edge off it.
const OPEN_INTEREST_ENDPOINT_REACH_MS: i64 = 29 * DAY_MS;
/// The venue's public archive host.
const ARCHIVE_BASE_URL: &str = "https://data.binance.vision";
/// The daily `metrics` file's header, exactly. Its taker ratio column is stamped in the other
/// convention from its open interest, so only the open interest columns are read.
const METRICS_HEADER: &str = "create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio";
/// How many klines one member request may return.
///
/// The client needs only the last closed bar, but asks for a few so a quiet interval at the
/// coordinate still has a predecessor to answer with.
const KLINE_LIMIT: u32 = 16;
/// The largest number of members one scope may name.
const MAX_MEMBERS: usize = 64;

/// Why this client could not be built.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinanceFuturesObservationSourceBuildErrorV1 {
    /// The member mapping is empty or larger than one scope admits.
    MemberMapping,
    /// The interval has no Owner timeframe label.
    UnmappedInterval,
    /// The HTTP client holds a credential. Every call this client makes is public, and the HTTP
    /// client sends its key in the default headers of every request, signed or not.
    CredentialPresent,
    /// The client for the public archive host could not be built.
    ArchiveClient,
}

impl Display for BinanceFuturesObservationSourceBuildErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::MemberMapping => "the member mapping is empty or exceeds one scope",
            Self::UnmappedInterval => "the interval has no Owner timeframe label",
            Self::CredentialPresent => {
                "the HTTP client holds a credential this public client never uses"
            }
            Self::ArchiveClient => "the public archive client could not be built",
        })
    }
}

impl std::error::Error for BinanceFuturesObservationSourceBuildErrorV1 {}

/// Answers an Owner-issued scope from this venue's perpetual futures klines and funding history.
pub struct BinanceFuturesObservationSourceV1 {
    client: BinanceFuturesHttpClient,
    /// Owner member key to Binance symbol. A scope may name only these members.
    symbols: BTreeMap<String, String>,
    /// The Binance interval requested, such as `4h`.
    interval: String,
    /// The Owner timeframe that interval denotes, such as `4H`.
    timeframe: String,
    /// Reads the public archive, keyless.
    archive: HttpClient,
    archive_base_url: String,
    /// Decides which open interest route can still answer a coordinate.
    clock: &'static AtomicTime,
}

impl Debug for BinanceFuturesObservationSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(BinanceFuturesObservationSourceV1))
            .field("members", &self.symbols.len())
            .field("interval", &self.interval)
            .finish_non_exhaustive()
    }
}

impl BinanceFuturesObservationSourceV1 {
    /// Binds one client to the exact universe members it may be asked for.
    ///
    /// # Errors
    ///
    /// Returns [`BinanceFuturesObservationSourceBuildErrorV1::MemberMapping`] for an empty or
    /// oversized mapping, [`BinanceFuturesObservationSourceBuildErrorV1::UnmappedInterval`] for an
    /// interval this Owner has no timeframe label for - a client that guessed one would be
    /// authoring a coordinate the Owner owns - and
    /// [`BinanceFuturesObservationSourceBuildErrorV1::CredentialPresent`] for an HTTP client that
    /// holds a credential.
    pub fn new(
        client: BinanceFuturesHttpClient,
        symbols: BTreeMap<String, String>,
        interval: &str,
    ) -> Result<Self, BinanceFuturesObservationSourceBuildErrorV1> {
        if client.has_credentials() {
            return Err(BinanceFuturesObservationSourceBuildErrorV1::CredentialPresent);
        }

        if symbols.is_empty() || symbols.len() > MAX_MEMBERS {
            return Err(BinanceFuturesObservationSourceBuildErrorV1::MemberMapping);
        }
        // The label table is the spot client's, because it is the Owner's vocabulary rather than
        // one product's: the same `4h` denotes the same timeframe whichever venue surface served
        // the bar. A second copy here would be a second place for the two to drift apart.
        let timeframe = crate::pit_observation_source_v1::owner_timeframe(interval)
            .ok_or(BinanceFuturesObservationSourceBuildErrorV1::UnmappedInterval)?;

        let archive = HttpClient::new(HashMap::new(), Vec::new(), Vec::new(), None, Some(30), None)
            .map_err(|_| BinanceFuturesObservationSourceBuildErrorV1::ArchiveClient)?;

        Ok(Self {
            client,
            symbols,
            interval: interval.to_string(),
            timeframe: timeframe.to_string(),
            archive,
            archive_base_url: ARCHIVE_BASE_URL.to_string(),
            clock: get_atomic_clock_realtime(),
        })
    }

    /// Points the archive reads and the route clock at stand-ins.
    #[cfg(test)]
    fn with_stand_ins(mut self, archive_base_url: String, clock: &'static AtomicTime) -> Self {
        self.archive_base_url = archive_base_url;
        self.clock = clock;
        self
    }

    /// The open interest in force at `cut_ms`, from whichever route can still answer it.
    async fn open_interest_at(
        &self,
        symbol: &str,
        cut_ms: i64,
    ) -> Result<Option<OpenInterestSnapshotV1>, PitObservationSourceErrorV1> {
        let now_ms = i64::try_from(self.clock.get_time_ms())
            .map_err(|_| PitObservationSourceErrorV1::ScopeMismatch)?;
        let latest_visible_ms = cut_ms - OPEN_INTEREST_VISIBLE_AFTER_MS;

        let snapshots = if now_ms.saturating_sub(cut_ms) < OPEN_INTEREST_ENDPOINT_REACH_MS {
            let records = self
                .client
                .inner()
                .open_interest_hist(&BinanceOpenInterestHistParams {
                    symbol: Some(symbol.to_string()),
                    pair: None,
                    contract_type: None,
                    period: "5m".to_string(),
                    start_time: None,
                    end_time: Some(latest_visible_ms),
                    limit: Some(1),
                })
                .await
                .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

            if records
                .iter()
                .any(|record| record.timestamp > latest_visible_ms)
            {
                return Err(PitObservationSourceErrorV1::ScopeMismatch);
            }
            records
                .into_iter()
                .map(|record| OpenInterestSnapshotV1 {
                    instant_ms: record.timestamp,
                    contracts: record.sum_open_interest,
                    notional: record.sum_open_interest_value,
                })
                .collect()
        } else {
            self.archived_open_interest(symbol, latest_visible_ms)
                .await?
        };
        Ok(open_interest_in_force(snapshots, cut_ms))
    }

    /// Every open interest snapshot one archived day holds, in the endpoint's convention.
    ///
    /// The day is the one holding the stamp of the latest snapshot visible at the coordinate. A
    /// missing file or one that fails its checksum refuses: an archived day is published or it is
    /// not, and a coordinate this old is past the endpoint's reach.
    async fn archived_open_interest(
        &self,
        symbol: &str,
        latest_visible_ms: i64,
    ) -> Result<Vec<OpenInterestSnapshotV1>, PitObservationSourceErrorV1> {
        // The archive stamps a snapshot five minutes before the instant the endpoint states.
        let stamp_ms = latest_visible_ms - FIVE_MINUTES_MS;
        let day = utc_date(stamp_ms).ok_or(PitObservationSourceErrorV1::ScopeMismatch)?;
        let archive_name = format!("{symbol}-metrics-{day}.zip");
        let member_name = format!("{symbol}-metrics-{day}.csv");
        let url = format!(
            "{}/data/futures/um/daily/metrics/{symbol}/{archive_name}",
            self.archive_base_url
        );
        let archive = self.fetch_archive_file(url.clone()).await?;
        let sidecar = self.fetch_archive_file(format!("{url}.CHECKSUM")).await?;
        let csv = checksummed_single_member(&archive_name, &member_name, &archive, &sidecar)
            .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;
        parse_metrics_open_interest(&csv, symbol)
    }

    async fn fetch_archive_file(
        &self,
        url: String,
    ) -> Result<Vec<u8>, PitObservationSourceErrorV1> {
        let response = self
            .archive
            .get(url, None, None, None, None)
            .await
            .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

        if !response.status.is_success() {
            return Err(PitObservationSourceErrorV1::Unavailable);
        }
        Ok(response.body.to_vec())
    }
}

#[async_trait]
impl PitObservationSourceV1 for BinanceFuturesObservationSourceV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        if scope.members().is_empty() || scope.members().len() > MAX_MEMBERS {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }

        if scope.provider_available() < scope.event_effective()
            || scope.decision_cut() < scope.event_effective()
        {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }

        // A member outside the admitted mapping is refused rather than skipped: answering part of
        // a universe reads downstream as incomplete coverage of one this client never served.
        let mut requests = Vec::with_capacity(scope.members().len());

        for member in scope.members() {
            let symbol = self
                .symbols
                .get(member)
                .ok_or(PitObservationSourceErrorV1::ScopeMismatch)?;
            requests.push((member.clone(), symbol.clone()));
        }

        let end_ms = i64::try_from(scope.event_effective() / 1_000_000)
            .map_err(|_| PitObservationSourceErrorV1::ScopeMismatch)?;
        let mut rows = Vec::new();

        for (member, symbol) in requests {
            let klines = self
                .client
                .inner()
                .klines(&BinanceKlinesParams {
                    symbol: symbol.clone(),
                    interval: self.interval.clone(),
                    start_time: None,
                    end_time: Some(end_ms),
                    limit: Some(KLINE_LIMIT),
                })
                .await
                .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

            let Some(bar) = last_closed_bar(&klines, end_ms) else {
                continue;
            };

            // Volume and taker buy volume are base-asset quantities from the same response, and a
            // native Replay frame cannot project a bar without the volume.
            for (field, quoted) in [
                ("OPEN", &bar.open),
                ("HIGH", &bar.high),
                ("LOW", &bar.low),
                ("CLOSE", &bar.close),
                ("VOLUME", &bar.volume),
                ("TAKER_BUY_VOLUME", &bar.taker_buy_base_volume),
            ] {
                let (value_mantissa, value_scale) = exact_decimal(quoted)?;
                rows.push(VendorObservationV1 {
                    symbolic_key: format!("{member}.{field}.{}", self.timeframe),
                    member_key: member.clone(),
                    instrument: member.clone(),
                    channel: CHANNEL.to_string(),
                    data_kind: DATA_KIND.to_string(),
                    timeframe: self.timeframe.clone(),
                    field: field.to_string(),
                    value_mantissa,
                    value_scale,
                    event_effective: scope.event_effective(),
                    provider_available: scope.provider_available(),
                    retrieval: scope.retrieval(),
                    correction_publication: scope.correction_publication(),
                });
            }

            let funding = self
                .client
                .inner()
                .funding_rate(&BinanceFundingRateParams {
                    symbol: Some(symbol.clone()),
                    start_time: None,
                    end_time: Some(end_ms),
                    limit: Some(FUNDING_LIMIT),
                })
                .await
                .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

            // Each kind's absence is its own: a member with no settlement yet still states its
            // open interest, and one with no visible snapshot still states its funding.
            if let FundingAtCutV1::Settled(settlement) = funding_at_cut(&funding, end_ms)? {
                let (rate_mantissa, rate_scale) = exact_decimal(&settlement.funding_rate)?;
                let time = i128::from(settlement.funding_time) * NANOS_PER_MILLI;
                rows.push(scalar_row(
                    scope,
                    &member,
                    FUNDING_RATE_FIELD,
                    rate_mantissa,
                    rate_scale,
                ));
                rows.push(scalar_row(scope, &member, FUNDING_TIME_FIELD, time, 0));
            }

            if let Some(snapshot) = self.open_interest_at(&symbol, end_ms).await? {
                let (contracts, contracts_scale) = exact_decimal(&snapshot.contracts)?;
                let (notional, notional_scale) = exact_decimal(&snapshot.notional)?;
                let time = i128::from(snapshot.instant_ms) * NANOS_PER_MILLI;
                rows.push(scalar_row(
                    scope,
                    &member,
                    OPEN_INTEREST_FIELD,
                    contracts,
                    contracts_scale,
                ));
                rows.push(scalar_row(
                    scope,
                    &member,
                    OPEN_INTEREST_VALUE_FIELD,
                    notional,
                    notional_scale,
                ));
                rows.push(scalar_row(
                    scope,
                    &member,
                    OPEN_INTEREST_TIME_FIELD,
                    time,
                    0,
                ));
            }
        }
        rows.sort_by(|left, right| {
            (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
        });
        Ok(rows)
    }
}

/// The last bar whose own close time is at or before the coordinate.
///
/// The venue states the close time rather than leaving it to be derived from the open time and the
/// interval, so this asks the bar when it closed instead of computing it. A derived close would
/// have to assume the interval's length, which is the one thing a label cannot be trusted for.
fn last_closed_bar(
    klines: &[BinanceFuturesKline],
    coordinate_ms: i64,
) -> Option<&BinanceFuturesKline> {
    klines
        .iter()
        .filter(|bar| bar.close_time <= coordinate_ms)
        .max_by_key(|bar| bar.close_time)
}

/// One vendor-stated number about a member at an instant rather than over a bar.
fn scalar_row(
    scope: &PitObservationScopeV1,
    member: &str,
    field: &str,
    value_mantissa: i128,
    value_scale: u8,
) -> VendorObservationV1 {
    VendorObservationV1 {
        symbolic_key: format!("{member}.{field}.{SCALAR_TIMEFRAME}"),
        member_key: member.to_string(),
        instrument: member.to_string(),
        channel: CHANNEL.to_string(),
        data_kind: SCALAR_DATA_KIND.to_string(),
        timeframe: SCALAR_TIMEFRAME.to_string(),
        field: field.to_string(),
        value_mantissa,
        value_scale,
        event_effective: scope.event_effective(),
        provider_available: scope.provider_available(),
        retrieval: scope.retrieval(),
        correction_publication: scope.correction_publication(),
    }
}

/// One open interest sample, in the endpoint's convention: the instant it was taken.
#[derive(Clone, Debug, Eq, PartialEq)]
struct OpenInterestSnapshotV1 {
    instant_ms: i64,
    contracts: String,
    notional: String,
}

/// The latest snapshot visible at `cut_ms`, unless the latest one is too old to be in force.
fn open_interest_in_force(
    snapshots: Vec<OpenInterestSnapshotV1>,
    cut_ms: i64,
) -> Option<OpenInterestSnapshotV1> {
    snapshots
        .into_iter()
        .filter(|snapshot| snapshot.instant_ms + OPEN_INTEREST_VISIBLE_AFTER_MS <= cut_ms)
        .max_by_key(|snapshot| snapshot.instant_ms)
        .filter(|snapshot| snapshot.instant_ms >= cut_ms - OPEN_INTEREST_STALE_AFTER_MS)
}

/// The UTC calendar date holding `instant_ms`, spelled as the archive names its files.
fn utc_date(instant_ms: i64) -> Option<String> {
    let date = time::OffsetDateTime::from_unix_timestamp(instant_ms.div_euclid(1_000))
        .ok()?
        .date();
    Some(format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    ))
}

/// The open interest a daily `metrics` file states, moved to the endpoint's convention.
///
/// The file stamps each row five minutes before the instant the endpoint gives the same numbers
/// (287 of 288 BTCUSDT rows on 2026-10-01 agree only after that move), so each instant here is the
/// row's `create_time` plus five minutes. A file for another symbol is a mismatch; a malformed row
/// refuses the file rather than being skipped.
fn parse_metrics_open_interest(
    csv: &[u8],
    symbol: &str,
) -> Result<Vec<OpenInterestSnapshotV1>, PitObservationSourceErrorV1> {
    let text = std::str::from_utf8(csv).map_err(|_| PitObservationSourceErrorV1::Unavailable)?;
    let mut lines = text.lines();

    if lines.next() != Some(METRICS_HEADER) {
        return Err(PitObservationSourceErrorV1::Unavailable);
    }
    let mut snapshots = Vec::new();

    for line in lines.filter(|line| !line.is_empty()) {
        let columns = line.split(',').collect::<Vec<_>>();
        let [create_time, row_symbol, contracts, notional, ..] = columns.as_slice() else {
            return Err(PitObservationSourceErrorV1::Unavailable);
        };

        if *row_symbol != symbol {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }
        let stamp_ms =
            archive_stamp_ms(create_time).ok_or(PitObservationSourceErrorV1::Unavailable)?;
        snapshots.push(OpenInterestSnapshotV1 {
            instant_ms: stamp_ms + FIVE_MINUTES_MS,
            contracts: (*contracts).to_string(),
            notional: (*notional).to_string(),
        });
    }
    Ok(snapshots)
}

/// A `create_time` such as `2024-01-01 00:05:00`, read as UTC milliseconds.
fn archive_stamp_ms(create_time: &str) -> Option<i64> {
    let (date, clock) = create_time.split_once(' ')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = time::Month::try_from(date_parts.next()?.parse::<u8>().ok()?).ok()?;
    let day = date_parts.next()?.parse::<u8>().ok()?;
    let mut clock_parts = clock.split(':');
    let hour = clock_parts.next()?.parse::<u8>().ok()?;
    let minute = clock_parts.next()?.parse::<u8>().ok()?;
    let second = clock_parts.next()?.parse::<u8>().ok()?;

    if date_parts.next().is_some() || clock_parts.next().is_some() {
        return None;
    }
    let instant = time::PrimitiveDateTime::new(
        time::Date::from_calendar_date(year, month, day).ok()?,
        time::Time::from_hms(hour, minute, second).ok()?,
    )
    .assume_utc();
    i64::try_from(instant.unix_timestamp_nanos() / 1_000_000).ok()
}

/// What a member's funding is at one coordinate, read from the settlements at or before it.
#[derive(Debug, Eq, PartialEq)]
enum FundingAtCutV1<'a> {
    /// The settlement in force at the coordinate.
    Settled(&'a BinanceFundingRate),
    /// The member had not settled yet: no funding exists to state.
    BeforeFirstSettlement,
    /// The settlement the last two imply was due at or before the coordinate and the venue states
    /// none. The last one is no longer the one in force, and the one that is cannot be named.
    SettlementOverdue,
}

/// Classifies the settlements the venue returned for a coordinate.
///
/// A settlement after the coordinate means the venue answered a different window, which is a
/// mismatch rather than a fact about this one. So are two settlements at one instant, which leave
/// no spacing to judge the next one by.
///
/// The spacing of the last two is the only interval this endpoint lets a client see. When the
/// venue lengthens a member's interval, a coordinate between the old and the new due time reads as
/// overdue: the error falls on the side of stating nothing rather than a rate no longer in force.
fn funding_at_cut(
    settlements: &[BinanceFundingRate],
    coordinate_ms: i64,
) -> Result<FundingAtCutV1<'_>, PitObservationSourceErrorV1> {
    if settlements
        .iter()
        .any(|settlement| settlement.funding_time > coordinate_ms)
    {
        return Err(PitObservationSourceErrorV1::ScopeMismatch);
    }
    let mut ordered = settlements.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|settlement| std::cmp::Reverse(settlement.funding_time));

    let Some(last) = ordered.first() else {
        return Ok(FundingAtCutV1::BeforeFirstSettlement);
    };

    if let Some(previous) = ordered.get(1) {
        let spacing = last.funding_time - previous.funding_time;

        if spacing <= 0 {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }

        if coordinate_ms >= last.funding_time.saturating_add(spacing) {
            return Ok(FundingAtCutV1::SettlementOverdue);
        }
    }
    Ok(FundingAtCutV1::Settled(last))
}

/// The vendor's quoted digits as a mantissa and scale, with trailing zeros removed.
///
/// `Decimal::from_str_exact` refuses rather than rounds, so a quote this Owner cannot represent
/// becomes a refusal instead of a nearby number. The refusal is reported as
/// [`PitObservationSourceErrorV1::Unavailable`] because that taxonomy has no category for "the
/// provider answered, with a number this Owner cannot carry"; the collapse is deliberate and
/// recorded, not an assertion that the venue was unreachable.
/// A [`Decimal`] keeps its scale in `0..=Decimal::MAX_SCALE`, so narrowing it to a `u8` is total.
///
/// The bound is asserted at compile time rather than mapped to an error at run time, because a
/// failure here would be this crate's own bug and reporting it as
/// [`PitObservationSourceErrorV1::Unavailable`] would blame the exchange for it.
const _: () = assert!(Decimal::MAX_SCALE <= u8::MAX as u32);

fn exact_decimal(quoted: &str) -> Result<(i128, u8), PitObservationSourceErrorV1> {
    let value =
        Decimal::from_str_exact(quoted).map_err(|_| PitObservationSourceErrorV1::Unavailable)?;
    let mut mantissa = value.mantissa();
    let mut scale = value.scale() as u8;

    while scale > 0 && mantissa != 0 && mantissa % 10 == 0 {
        mantissa /= 10;
        scale -= 1;
    }

    if mantissa == 0 {
        scale = 0;
    }

    Ok((mantissa, scale))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const AT_MS: i64 = 1_700_000_000_000;
    const HOUR_MS: i64 = 3_600_000;

    fn bar(close_time_ms: i64, close: &str) -> BinanceFuturesKline {
        BinanceFuturesKline {
            open_time: close_time_ms - HOUR_MS + 1,
            open: "100.0".to_string(),
            high: "200.0".to_string(),
            low: "50.0".to_string(),
            close: close.to_string(),
            volume: "1".to_string(),
            close_time: close_time_ms,
            quote_volume: "1".to_string(),
            num_trades: 1,
            taker_buy_base_volume: "1".to_string(),
            taker_buy_quote_volume: "1".to_string(),
        }
    }

    #[rstest]
    fn a_bar_still_open_at_the_coordinate_states_nothing_about_it() {
        let bars = [bar(AT_MS + 1, "999")];
        assert!(
            last_closed_bar(&bars, AT_MS).is_none(),
            "a bar closing after the coordinate cannot answer for it"
        );
    }

    #[rstest]
    fn a_bar_closing_exactly_at_the_coordinate_counts() {
        let bars = [bar(AT_MS, "777")];
        assert_eq!(last_closed_bar(&bars, AT_MS).unwrap().close, "777");
    }

    #[rstest]
    fn the_latest_already_closed_bar_wins() {
        let bars = [
            bar(AT_MS - 2 * HOUR_MS, "1"),
            bar(AT_MS - HOUR_MS, "2"),
            bar(AT_MS + HOUR_MS, "3"),
        ];
        assert_eq!(
            last_closed_bar(&bars, AT_MS).unwrap().close,
            "2",
            "the answer is the last bar complete at the coordinate, not the newest fetched"
        );
    }

    #[rstest]
    fn the_perpetual_labels_resolve_through_the_shared_table() {
        // These two are what a perpetual universe is bound at. They are asserted here rather than
        // only in the spot module's tests because this module reaches across to that table: if the
        // reach were to break, or the table to move, this is where a perpetual scope stops being
        // answerable.
        assert_eq!(
            crate::pit_observation_source_v1::owner_timeframe("4h"),
            Some("4H")
        );
        assert_eq!(
            crate::pit_observation_source_v1::owner_timeframe("1d"),
            Some("24H"),
            "a continuous-clock venue's day is 24 hours, never a named exchange session day"
        );
    }

    #[rstest]
    fn the_venue_digits_survive_unrounded() {
        assert_eq!(exact_decimal("234.56").unwrap(), (23_456, 2));
        // A quote with more significant digits than an `f64` carries. Parsing through a double
        // would land on the nearest representable value; this asserts the digits arrive intact,
        // which is the whole claim the module header makes.
        assert_eq!(
            exact_decimal("123456789.123456789").unwrap(),
            (123_456_789_123_456_789, 9)
        );
        assert_ne!(
            "123456789.123456789".parse::<f64>().unwrap().to_string(),
            "123456789.123456789",
            "the control: this venue's own spelling does not survive an f64 round trip"
        );
    }

    #[rstest]
    fn a_value_has_exactly_one_canonical_spelling() {
        // 43120.5, however this venue chose to pad it: one number, one spelling.
        assert_eq!(exact_decimal("43120.50000000").unwrap(), (431_205, 1));
        assert_eq!(exact_decimal("43120.5").unwrap(), (431_205, 1));
        assert_eq!(exact_decimal("0.00000001").unwrap(), (1, 8));
        assert_eq!(exact_decimal("0.00000000").unwrap(), (0, 0));
        assert_eq!(exact_decimal("100").unwrap(), (100, 0));
    }

    #[rstest]
    fn a_quote_that_is_not_a_number_is_refused_rather_than_guessed() {
        // A vendor that answers with a challenge page, an error document, or a sentinel is stating
        // that it has no price. Reading a zero or a nearby number out of that would put this
        // client's own invention into the Owner's custody.
        for quoted in ["", "  ", "n/a", "null", "<html>", "1.2.3", "NaN"] {
            assert_eq!(
                exact_decimal(quoted),
                Err(PitObservationSourceErrorV1::Unavailable),
                "{quoted:?} is not a price"
            );
        }
    }
}

#[cfg(test)]
mod funding_tests {
    use std::{
        collections::BTreeMap,
        net::SocketAddr,
        sync::{Arc, Mutex},
    };

    use axum::{
        Router,
        extract::{RawQuery, State},
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::get,
    };
    use rstest::rstest;
    use serde_json::{Value, json};
    use vibe_core::{UnixNanos, time::get_atomic_clock_realtime};

    use super::*;
    use crate::common::enums::{BinanceEnvironment, BinanceProductType};

    const HOUR_MS: i64 = 3_600_000;
    const EIGHT_HOURS_MS: i64 = 8 * HOUR_MS;
    /// 2024-01-01T08:00:00Z, a BTCUSDT settlement.
    const SETTLED_MS: i64 = 1_704_096_000_000;
    const MEMBER: &str = "BTCUSDT-PERP.BINANCE";

    fn settlement(funding_time: i64, rate: &str) -> BinanceFundingRate {
        BinanceFundingRate {
            symbol: "BTCUSDT".into(),
            funding_rate: rate.to_string(),
            funding_time,
            mark_price: None,
            index_price: None,
        }
    }

    #[rstest]
    fn a_settlement_at_the_coordinate_is_the_one_in_force() {
        let settlements = [
            settlement(SETTLED_MS - EIGHT_HOURS_MS, "0.00037409"),
            settlement(SETTLED_MS, "0.00027213"),
        ];
        assert_eq!(
            funding_at_cut(&settlements, SETTLED_MS),
            Ok(FundingAtCutV1::Settled(&settlements[1]))
        );
        assert_eq!(
            funding_at_cut(&settlements[..1], SETTLED_MS - 1),
            Ok(FundingAtCutV1::Settled(&settlements[0])),
            "a millisecond before a settlement, the previous one is in force"
        );
    }

    #[rstest]
    fn no_settlement_yet_is_absence_not_zero() {
        assert_eq!(
            funding_at_cut(&[], SETTLED_MS),
            Ok(FundingAtCutV1::BeforeFirstSettlement)
        );
    }

    #[rstest]
    fn a_settlement_the_last_two_imply_and_the_venue_omits_is_overdue() {
        let settlements = [
            settlement(SETTLED_MS - EIGHT_HOURS_MS, "0.0001"),
            settlement(SETTLED_MS, "0.0001"),
        ];
        assert_eq!(
            funding_at_cut(&settlements, SETTLED_MS + EIGHT_HOURS_MS - 1),
            Ok(FundingAtCutV1::Settled(&settlements[1])),
            "until the next one is due, the last one is in force"
        );
        assert_eq!(
            funding_at_cut(&settlements, SETTLED_MS + EIGHT_HOURS_MS),
            Ok(FundingAtCutV1::SettlementOverdue),
            "once it is due and absent, the last one is no longer the one in force"
        );
    }

    #[rstest]
    fn an_answer_for_another_window_is_a_mismatch() {
        assert_eq!(
            funding_at_cut(&[settlement(SETTLED_MS + 1, "0.0001")], SETTLED_MS),
            Err(PitObservationSourceErrorV1::ScopeMismatch),
            "a settlement after the coordinate is not a fact about it"
        );
        assert_eq!(
            funding_at_cut(
                &[
                    settlement(SETTLED_MS, "0.0001"),
                    settlement(SETTLED_MS, "0.0002")
                ],
                SETTLED_MS
            ),
            Err(PitObservationSourceErrorV1::ScopeMismatch),
            "two settlements at one instant leave no spacing to judge the next one by"
        );
    }

    /// What the venue stand-in answers, and every request it saw.
    #[derive(Clone)]
    struct Venue {
        funding_status: StatusCode,
        funding: Value,
        open_interest: Value,
        /// The archived day's zip and its `.CHECKSUM` text, or the status the archive answers.
        archive: Result<(Vec<u8>, String), StatusCode>,
        seen: Arc<Mutex<Vec<(String, HeaderMap, String)>>>,
    }

    /// What one observation is asked against: the venue's answers and how long ago the cut was.
    struct Stand {
        funding_status: StatusCode,
        funding: Value,
        open_interest: Value,
        archive: Result<(Vec<u8>, String), StatusCode>,
        now_after_cut_ms: i64,
    }

    impl Stand {
        fn recent(funding_status: StatusCode, funding: Value) -> Self {
            Self {
                funding_status,
                funding,
                open_interest: json!([{"symbol": "BTCUSDT", "sumOpenInterest": "74006.26600000",
                    "sumOpenInterestValue": "3131493738.89740000",
                    "timestamp": SETTLED_MS - FIVE_MINUTES_MS}]),
                archive: Err(StatusCode::NOT_FOUND),
                now_after_cut_ms: HOUR_MS,
            }
        }
    }

    async fn open_interest_hist(
        State(venue): State<Venue>,
        headers: HeaderMap,
        RawQuery(query): RawQuery,
    ) -> Response {
        venue.seen.lock().unwrap().push((
            "openInterestHist".to_string(),
            headers,
            query.unwrap_or_default(),
        ));
        (
            StatusCode::OK,
            [("content-type", "application/json")],
            venue.open_interest.to_string(),
        )
            .into_response()
    }

    async fn archive_zip(State(venue): State<Venue>, headers: HeaderMap) -> Response {
        venue
            .seen
            .lock()
            .unwrap()
            .push(("archive".to_string(), headers, String::new()));
        match venue.archive {
            Ok((zip, _)) => (StatusCode::OK, zip).into_response(),
            Err(status) => status.into_response(),
        }
    }

    async fn archive_checksum(State(venue): State<Venue>, headers: HeaderMap) -> Response {
        venue
            .seen
            .lock()
            .unwrap()
            .push(("checksum".to_string(), headers, String::new()));
        match venue.archive {
            Ok((_, checksum)) => (StatusCode::OK, checksum).into_response(),
            Err(status) => status.into_response(),
        }
    }

    /// The archived day `2024-01-01` for BTCUSDT, holding `rows` after the header.
    fn archived_day(rows: &[&str]) -> (Vec<u8>, String) {
        use std::io::Write;

        let mut csv = format!("{METRICS_HEADER}\n");
        for row in rows {
            csv.push_str(row);
            csv.push('\n');
        }
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(
            "BTCUSDT-metrics-2024-01-01.csv",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(csv.as_bytes()).unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, &bytes);
        let hex = digest
            .as_ref()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        (bytes, format!("{hex}  BTCUSDT-metrics-2024-01-01.zip\n"))
    }

    async fn klines(
        State(venue): State<Venue>,
        headers: HeaderMap,
        RawQuery(query): RawQuery,
    ) -> Response {
        venue
            .seen
            .lock()
            .unwrap()
            .push(("klines".to_string(), headers, query.unwrap_or_default()));
        // One 4h bar closing exactly at the coordinate.
        let close = SETTLED_MS;
        let open = close - 4 * HOUR_MS + 1;
        (
            StatusCode::OK,
            [("content-type", "application/json")],
            json!([[
                open,
                "42314.0",
                "42603.2",
                "42289.6",
                "42503.5",
                "8459.477",
                close,
                "359196345.08716",
                88278,
                "4687.976",
                "199033806.82405",
                "0"
            ]])
            .to_string(),
        )
            .into_response()
    }

    async fn funding(
        State(venue): State<Venue>,
        headers: HeaderMap,
        RawQuery(query): RawQuery,
    ) -> Response {
        venue.seen.lock().unwrap().push((
            "fundingRate".to_string(),
            headers,
            query.unwrap_or_default(),
        ));
        (
            venue.funding_status,
            [("content-type", "application/json")],
            venue.funding.to_string(),
        )
            .into_response()
    }

    async fn observe_against(
        funding_status: StatusCode,
        funding_body: Value,
    ) -> (
        Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1>,
        Vec<(String, HeaderMap, String)>,
    ) {
        observe_with(Stand::recent(funding_status, funding_body)).await
    }

    async fn observe_with(
        stand: Stand,
    ) -> (
        Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1>,
        Vec<(String, HeaderMap, String)>,
    ) {
        let venue = Venue {
            funding_status: stand.funding_status,
            funding: stand.funding,
            open_interest: stand.open_interest,
            archive: stand.archive,
            seen: Arc::new(Mutex::new(Vec::new())),
        };
        let day = "/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-2024-01-01.zip";
        let router = Router::new()
            .route("/fapi/v1/klines", get(klines))
            .route("/fapi/v1/fundingRate", get(funding))
            .route("/futures/data/openInterestHist", get(open_interest_hist))
            .route(day, get(archive_zip))
            .route(&format!("{day}.CHECKSUM"), get(archive_checksum))
            .with_state(venue.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let client = BinanceFuturesHttpClient::new(
            BinanceProductType::UsdM,
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            None,
            None,
            Some(format!("http://{address}")),
            None,
            Some(10),
            None,
            false,
        )
        .expect("the keyless client builds");
        let now_ns = u64::try_from(SETTLED_MS + stand.now_after_cut_ms).unwrap() * 1_000_000;
        let clock: &'static AtomicTime =
            Box::leak(Box::new(AtomicTime::new(false, UnixNanos::from(now_ns))));
        let source = BinanceFuturesObservationSourceV1::new(
            client,
            BTreeMap::from([(MEMBER.to_string(), "BTCUSDT".to_string())]),
            "4h",
        )
        .expect("one member and a mapped interval")
        .with_stand_ins(format!("http://{address}"), clock);
        let at = u64::try_from(SETTLED_MS).unwrap() * 1_000_000;
        let scope =
            PitObservationScopeV1::from_owner_request(vec![MEMBER.to_string()], at, at, at, at, at);
        let result = source.observe(&scope).await;
        let seen = venue.seen.lock().unwrap().clone();
        (result, seen)
    }

    #[tokio::test]
    async fn a_settlement_is_stated_beside_the_bar_from_requests_that_carry_no_credential() {
        let (result, seen) = observe_against(
            StatusCode::OK,
            json!([
                {"symbol": "BTCUSDT", "fundingTime": SETTLED_MS - EIGHT_HOURS_MS,
                 "fundingRate": "0.00037409", "markPrice": "42313.9"},
                {"symbol": "BTCUSDT", "fundingTime": SETTLED_MS,
                 "fundingRate": "0.00027213", "markPrice": "42503.5"}
            ]),
        )
        .await;
        let rows = result.expect("the stand-in answers both endpoints");

        let funding = rows
            .iter()
            .filter(|row| row.field.starts_with("FUNDING"))
            .map(|row| {
                (
                    row.symbolic_key.as_str(),
                    row.timeframe.as_str(),
                    row.value_mantissa,
                    row.value_scale,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            funding,
            [
                ("BTCUSDT-PERP.BINANCE.FUNDING_RATE.TICK", "TICK", 27_213, 8),
                (
                    "BTCUSDT-PERP.BINANCE.FUNDING_TIME.TICK",
                    "TICK",
                    i128::from(SETTLED_MS) * 1_000_000,
                    0
                ),
            ],
            "the settlement in force, as published, at its own instant"
        );
        let bar = rows
            .iter()
            .filter(|row| row.data_kind == DATA_KIND)
            .map(|row| (row.field.as_str(), row.value_mantissa, row.value_scale))
            .collect::<Vec<_>>();
        assert_eq!(
            bar,
            [
                ("CLOSE", 425_035, 1),
                ("HIGH", 426_032, 1),
                ("LOW", 422_896, 1),
                ("OPEN", 42_314, 0),
                ("TAKER_BUY_VOLUME", 4_687_976, 3),
                ("VOLUME", 8_459_477, 3),
            ],
            "the bar beside it, its volumes as the venue spelled them"
        );
        assert!(rows.iter().all(|row| row.channel == CHANNEL));

        let requests = seen
            .iter()
            .map(|(endpoint, _, _)| endpoint.as_str())
            .collect::<Vec<_>>();
        assert_eq!(requests, ["klines", "fundingRate", "openInterestHist"]);
        let (_, _, funding_query) = &seen[1];
        assert!(
            funding_query.contains(&format!("endTime={SETTLED_MS}"))
                && funding_query.contains("limit=2")
                && !funding_query.contains("startTime"),
            "the last two settlements at or before the coordinate: {funding_query}"
        );

        for (endpoint, headers, query) in &seen {
            assert!(
                !headers.contains_key("x-mbx-apikey"),
                "{endpoint} carried an API key header"
            );
            assert!(
                !query.contains("signature") && !query.contains("timestamp"),
                "{endpoint} was signed: {query}"
            );
        }
    }

    #[tokio::test]
    async fn a_member_with_no_settlement_has_no_funding_rows_rather_than_a_zero() {
        let (result, _) = observe_against(StatusCode::OK, json!([])).await;
        let rows = result.expect("an empty funding history is an answer, not a failure");
        assert!(
            !rows.iter().any(|row| row.field.starts_with("FUNDING")),
            "no funding row is invented for a member that never settled"
        );
        assert_eq!(
            rows.len(),
            9,
            "the bar and the open interest are still stated"
        );
    }

    #[tokio::test]
    async fn a_refusing_funding_endpoint_refuses_the_whole_retrieval() {
        let (result, _) = observe_against(
            StatusCode::from_u16(451).unwrap(),
            json!({"code": 0, "msg": "Service unavailable from a restricted location"}),
        )
        .await;
        assert_eq!(result, Err(PitObservationSourceErrorV1::Unavailable));
    }

    #[tokio::test]
    async fn a_rate_that_is_not_a_decimal_refuses_the_whole_retrieval() {
        let (result, _) = observe_against(
            StatusCode::OK,
            json!([{"symbol": "BTCUSDT", "fundingTime": SETTLED_MS, "fundingRate": ""}]),
        )
        .await;
        assert_eq!(result, Err(PitObservationSourceErrorV1::Unavailable));
    }

    fn open_interest_rows(rows: &[VendorObservationV1]) -> Vec<(&str, i128, u8)> {
        rows.iter()
            .filter(|row| row.field.starts_with("OPEN_INTEREST"))
            .map(|row| (row.field.as_str(), row.value_mantissa, row.value_scale))
            .collect()
    }

    fn snapshot(instant_ms: i64) -> OpenInterestSnapshotV1 {
        OpenInterestSnapshotV1 {
            instant_ms,
            contracts: "1".to_string(),
            notional: "1".to_string(),
        }
    }

    #[rstest]
    fn a_snapshot_counts_five_minutes_after_its_instant() {
        let taken = SETTLED_MS - FIVE_MINUTES_MS;
        assert_eq!(
            open_interest_in_force(vec![snapshot(taken)], SETTLED_MS),
            Some(snapshot(taken)),
            "published by then"
        );
        assert_eq!(
            open_interest_in_force(vec![snapshot(taken)], SETTLED_MS - 1),
            None,
            "a millisecond earlier it may not have been published yet"
        );
        assert_eq!(
            open_interest_in_force(
                vec![snapshot(taken - FIVE_MINUTES_MS), snapshot(taken)],
                SETTLED_MS
            ),
            Some(snapshot(taken)),
            "the latest visible one is in force"
        );
    }

    #[rstest]
    fn a_snapshot_older_than_a_missed_sample_is_not_in_force() {
        let limit = SETTLED_MS - OPEN_INTEREST_STALE_AFTER_MS;
        assert_eq!(
            open_interest_in_force(vec![snapshot(limit)], SETTLED_MS),
            Some(snapshot(limit))
        );
        assert_eq!(
            open_interest_in_force(vec![snapshot(limit - 1)], SETTLED_MS),
            None
        );
        assert_eq!(open_interest_in_force(Vec::new(), SETTLED_MS), None);
    }

    #[tokio::test]
    async fn a_recent_coordinate_reads_the_endpoint_for_the_last_visible_sample() {
        let (result, seen) = observe_with(Stand::recent(StatusCode::OK, json!([]))).await;
        let rows = result.expect("the stand-in answers");
        assert_eq!(
            open_interest_rows(&rows),
            [
                ("OPEN_INTEREST", 74_006_266, 3),
                (
                    "OPEN_INTEREST_TIME",
                    i128::from(SETTLED_MS - FIVE_MINUTES_MS) * 1_000_000,
                    0
                ),
                ("OPEN_INTEREST_VALUE", 31_314_937_388_974, 4),
            ]
        );
        let (_, _, query) = seen
            .iter()
            .find(|(endpoint, _, _)| endpoint == "openInterestHist")
            .expect("the endpoint was asked");
        assert!(
            query.contains(&format!("endTime={}", SETTLED_MS - FIVE_MINUTES_MS))
                && query.contains("limit=1")
                && query.contains("period=5m"),
            "the last sample published by the coordinate: {query}"
        );
        assert!(
            !seen.iter().any(|(endpoint, _, _)| endpoint == "archive"),
            "a recent coordinate never reads the archive"
        );
    }

    #[tokio::test]
    async fn an_old_coordinate_reads_the_checksummed_archive_moved_to_the_endpoint_convention() {
        // The cut is 08:00. The archive stamps the 07:55 sample at 07:50, so the last one visible
        // at the cut is the row stamped 07:50; the 07:55 row is the sample taken at 08:00.
        let mut stand = Stand::recent(StatusCode::OK, json!([]));
        stand.now_after_cut_ms = 60 * DAY_MS;
        stand.archive = Ok(archived_day(&[
            "2024-01-01 07:55:00,BTCUSDT,999.0,999.0,1,1,1,1",
            "2024-01-01 07:45:00,BTCUSDT,73900.000,3100000000.00,1,1,1,9.99",
            "2024-01-01 07:50:00,BTCUSDT,74006.26600000,3131493738.89740000,1,1,1,9.99",
        ]));
        let (result, seen) = observe_with(stand).await;
        let rows = result.expect("the archived day answers");
        assert_eq!(
            open_interest_rows(&rows),
            [
                ("OPEN_INTEREST", 74_006_266, 3),
                (
                    "OPEN_INTEREST_TIME",
                    i128::from(SETTLED_MS - FIVE_MINUTES_MS) * 1_000_000,
                    0
                ),
                ("OPEN_INTEREST_VALUE", 31_314_937_388_974, 4),
            ],
            "the row stamped 07:50 is the sample taken at 07:55"
        );
        assert!(
            !seen
                .iter()
                .any(|(endpoint, _, _)| endpoint == "openInterestHist"),
            "a coordinate past the endpoint's reach never asks it"
        );

        for (endpoint, headers, _) in &seen {
            assert!(
                !headers.contains_key("x-mbx-apikey"),
                "{endpoint} carried an API key header"
            );
        }
    }

    #[tokio::test]
    async fn an_archived_day_that_is_missing_or_altered_refuses_the_whole_retrieval() {
        let mut missing = Stand::recent(StatusCode::OK, json!([]));
        missing.now_after_cut_ms = 60 * DAY_MS;
        assert_eq!(
            observe_with(missing).await.0,
            Err(PitObservationSourceErrorV1::Unavailable)
        );

        let mut altered = Stand::recent(StatusCode::OK, json!([]));
        altered.now_after_cut_ms = 60 * DAY_MS;
        let (zip, _) = archived_day(&["2024-01-01 07:50:00,BTCUSDT,1,1,1,1,1,1"]);
        let (_, other_checksum) = archived_day(&["2024-01-01 07:50:00,BTCUSDT,2,2,1,1,1,1"]);
        altered.archive = Ok((zip, other_checksum));
        assert_eq!(
            observe_with(altered).await.0,
            Err(PitObservationSourceErrorV1::Unavailable),
            "a zip that does not match its checksum is not read"
        );
    }

    #[rstest]
    fn a_metrics_file_for_another_symbol_or_shape_is_not_read() {
        let row =
            |symbol: &str| format!("{METRICS_HEADER}\n2024-01-01 07:50:00,{symbol},1,1,1,1,1,1\n");
        assert_eq!(
            parse_metrics_open_interest(row("ETHUSDT").as_bytes(), "BTCUSDT"),
            Err(PitObservationSourceErrorV1::ScopeMismatch)
        );
        assert_eq!(
            parse_metrics_open_interest(b"create_time,symbol\n", "BTCUSDT"),
            Err(PitObservationSourceErrorV1::Unavailable),
            "a header that is not the archive's is refused"
        );
        assert_eq!(
            parse_metrics_open_interest(
                format!("{METRICS_HEADER}\n2024-01-01T07:50:00,BTCUSDT,1,1,1,1,1,1\n").as_bytes(),
                "BTCUSDT"
            ),
            Err(PitObservationSourceErrorV1::Unavailable),
            "a stamp in another spelling is refused"
        );
    }

    #[rstest]
    fn a_client_holding_a_credential_is_refused() {
        let client = BinanceFuturesHttpClient::new(
            BinanceProductType::UsdM,
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            Some("key".to_string()),
            Some("secret".to_string()),
            Some("http://127.0.0.1:9".to_string()),
            None,
            Some(1),
            None,
            false,
        )
        .expect("a credentialed client builds");
        assert_eq!(
            BinanceFuturesObservationSourceV1::new(
                client,
                BTreeMap::from([(MEMBER.to_string(), "BTCUSDT".to_string())]),
                "4h",
            )
            .unwrap_err(),
            BinanceFuturesObservationSourceBuildErrorV1::CredentialPresent
        );
    }
}

#[cfg(test)]
mod live_tests {
    use std::collections::BTreeMap;

    use vibe_core::time::get_atomic_clock_realtime;
    use vibe_data::owner::pit_observation_source_v1::PitObservationScopeV1;

    use super::*;
    use crate::common::enums::{BinanceEnvironment, BinanceProductType};

    /// Answers one Owner scope for a perpetual from the live public USD-M endpoint.
    ///
    /// `klines` calls its transport with `signed = false`, so this reaches Binance without a
    /// credential and spends nothing. It is `#[ignore]` only because it reaches the network.
    #[tokio::test]
    #[ignore = "reaches the live public Binance USD-M endpoint"]
    async fn live_binance_futures_answers_the_owner_scope() {
        let client = BinanceFuturesHttpClient::new(
            BinanceProductType::UsdM,
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            None,
            None,
            None,
            None,
            Some(30),
            None,
            false,
        )
        .expect("the keyless public client builds");
        let members = BTreeMap::from([("BTCUSDT-PERP.BINANCE".to_string(), "BTCUSDT".to_string())]);
        let source = BinanceFuturesObservationSourceV1::new(client, members, "4h")
            .expect("one admitted member and a mapped interval");

        // An instant well in the past, so the bar covering it has long since closed.
        let effective = 1_735_830_000_000_000_000_u64;
        let scope = PitObservationScopeV1::from_owner_request(
            vec!["BTCUSDT-PERP.BINANCE".to_string()],
            effective,
            effective,
            effective,
            effective,
            effective,
        );

        let rows = source.observe(&scope).await.expect("the endpoint answers");
        assert_eq!(
            rows.len(),
            11,
            "one closed bar's prices and volumes, a settlement, and an archived open interest sample"
        );
        let scalar_fields = rows
            .iter()
            .filter(|row| row.data_kind == SCALAR_DATA_KIND)
            .map(|row| row.field.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            scalar_fields,
            [
                "FUNDING_RATE",
                "FUNDING_TIME",
                "OPEN_INTEREST",
                "OPEN_INTEREST_TIME",
                "OPEN_INTEREST_VALUE"
            ],
            "a coordinate this old reads its open interest from the archive"
        );
        let rows = rows
            .into_iter()
            .filter(|row| row.data_kind == DATA_KIND)
            .collect::<Vec<_>>();

        for row in &rows {
            assert_eq!(row.member_key, "BTCUSDT-PERP.BINANCE");
            assert_eq!(row.data_kind, DATA_KIND);
            assert_eq!(row.channel, CHANNEL);
            assert_eq!(
                row.timeframe, "4H",
                "a continuous-clock venue's four hours, not a session bar"
            );

            if row.field.ends_with("VOLUME") {
                assert!(row.value_mantissa >= 0, "a volume is never negative");
            } else {
                assert!(row.value_mantissa > 0, "an admitted price is positive");
            }
            assert_eq!(row.event_effective, effective);
            assert_eq!(row.retrieval, effective);
        }
        let high = rows
            .iter()
            .find(|row| row.field == "HIGH")
            .expect("the batch states a high");
        let low = rows
            .iter()
            .find(|row| row.field == "LOW")
            .expect("the batch states a low");
        assert_eq!(
            high.value_scale, low.value_scale,
            "one bar's prices share one scale"
        );
        assert!(
            high.value_mantissa >= low.value_mantissa,
            "the venue's own high is not below its own low"
        );

        let keys = rows
            .iter()
            .map(|row| row.symbolic_key.clone())
            .collect::<Vec<_>>();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "the batch is strictly ascending by key");
        eprintln!("live binance usd-m rows: {keys:?}");
        eprintln!(
            "live binance usd-m high: {} scale {}",
            high.value_mantissa, high.value_scale
        );
    }
}
