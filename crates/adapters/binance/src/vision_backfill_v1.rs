//! Fetches a Binance USD-M perpetual's history for T0 window custody.
//!
//! Execution bars come from the public monthly kline archive, each file checked against the
//! `.CHECKSUM` sidecar the same host serves and read through [`authenticate_monthly_klines`]. A
//! sidecar from the same host proves the bytes arrived as that host published them, not who
//! published them. Fill bars come from the public `klines` endpoint, one call per gap. Neither
//! route signs a request, and the fetcher refuses an HTTP client that holds a credential, because
//! that client sends its key in the default headers of every request.
//!
//! Each archive month is kept as a shard - the zip, its sidecar and the instant it was retrieved -
//! so a rerun reads the shards that still verify and fetches only the rest. A shard is written
//! through a temporary file and a rename, so an interrupted fetch leaves no shard that looks whole.
//! The retrieval instant stated for every row is the wall clock when its bytes were fetched, never
//! a historical coordinate.

use std::{
    collections::HashMap,
    fmt::{Debug, Display},
    path::{Path, PathBuf},
};

use vibe_core::{AtomicTime, time::get_atomic_clock_realtime};
use vibe_data::owner::bar_schedule::{ServedBarGridV1, served_timeframe_v1};
use vibe_data::owner::source_binding::{
    UntrustedSourceAvailabilityRuleV1, UntrustedSourceVisibilityV1,
};
use vibe_network::http::HttpClient;

use crate::{
    common::{
        enums::{BinanceKlineInterval, BinanceProductType},
        offline::{
            BinanceVisionArchiveBinding, Sha256Digest, archive_digest, authenticate_daily_klines,
            authenticate_monthly_klines, is_valid_binance_symbol, sidecar_digest,
        },
    },
    funding_archive_v1::{FundingArchiveRowV1, authenticate_monthly_funding},
    futures::http::{
        client::BinanceFuturesHttpClient, models::BinanceFuturesKline, query::BinanceKlinesParams,
    },
};

/// The route a row fetched from the public archive names in its custody evidence.
pub const ARCHIVE_ROUTE: &str = "binance-vision-archive";
/// The route a row fetched from the public daily archive names in its custody evidence: Market
/// Data's B5 verifier reads a bar earlier this way, or covers a day a monthly file omits.
pub const DAILY_ARCHIVE_ROUTE: &str = "binance-vision-daily-archive";
/// The route a row fetched from the public `klines` endpoint names in its custody evidence.
pub const ENDPOINT_ROUTE: &str = "binance-usdm-endpoint";
/// The route a settlement fetched from the public monthly funding-rate archive names in its
/// custody evidence.
pub const FUNDING_ARCHIVE_ROUTE: &str = "binance-vision-funding-archive";
/// The venue's public archive host.
const ARCHIVE_BASE_URL: &str = "https://data.binance.vision";
/// The fill timeframe's venue interval.
const FILL_INTERVAL: &str = "1m";

/// Why a fetch could not produce its rows.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VisionBackfillErrorV1 {
    /// The HTTP client holds a credential; every call here is public.
    CredentialPresent,
    /// The client for the archive host could not be built.
    ArchiveClient,
    /// The archive host did not answer, or answered without the file.
    ArchiveUnavailable,
    /// The archive's bytes do not match the digest its sidecar declares.
    ArchiveMismatch,
    /// The archive verified but is not a USD-M kline month the reader admits.
    ArchiveUnreadable,
    /// The shard directory could not be read or written.
    ShardStoreUnavailable,
    /// The `klines` endpoint did not answer.
    EndpointUnavailable,
    /// The fill bar the endpoint returned had not closed when it was retrieved: its gap reaches
    /// past the present, and the custody would refuse the row as retrieved before its close.
    FillBarNotClosed,
    /// The binding's availability rule does not make rows visible a lag after their bar closes,
    /// so no gap after a bar's availability can be located.
    AvailabilityNotAfterBarClose,
    /// A requested window's start or end lies before the Unix epoch, so it names no calendar
    /// month an archive could serve.
    WindowBeforeEpoch,
    /// `PRIOR_BAR_UNAVAILABLE`: the bar closing at a grid-aligned window's start - the window's
    /// first frame - is in neither the archive nor the public endpoint. `open_ms` names it.
    PriorBarUnavailable { open_ms: i64 },
    /// Not a canonical Binance symbol (non-empty, every byte an ASCII uppercase letter or
    /// digit). Refused before a shard path or an archive URL is built from it - the archive
    /// binding would refuse it too, but only after both already exist.
    InvalidSymbol,
}

impl Display for VisionBackfillErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Self::PriorBarUnavailable { open_ms } = self {
            return write!(
                formatter,
                "the bar opening at {open_ms} ms, which closes at the window's start, is in neither the archive nor the endpoint"
            );
        }
        formatter.write_str(match self {
            Self::PriorBarUnavailable { .. } => unreachable!("answered above"),
            Self::CredentialPresent => {
                "the HTTP client holds a credential this public fetch never uses"
            }
            Self::ArchiveClient => "the public archive client could not be built",
            Self::ArchiveUnavailable => "the public archive did not serve the file",
            Self::ArchiveMismatch => "the archive does not match its sidecar's digest",
            Self::ArchiveUnreadable => "the archive is not a USD-M kline month the reader admits",
            Self::ShardStoreUnavailable => "the shard directory could not be read or written",
            Self::EndpointUnavailable => "the klines endpoint did not answer",
            Self::FillBarNotClosed => "the fill bar had not closed when it was retrieved",
            Self::AvailabilityNotAfterBarClose => {
                "the binding's availability rule is not a lag after the bar's close"
            }
            Self::WindowBeforeEpoch => "the requested window lies before the Unix epoch",
            Self::InvalidSymbol => "not a canonical Binance symbol",
        })
    }
}

impl std::error::Error for VisionBackfillErrorV1 {}

/// One fetched bar with the evidence its custody row carries.
#[derive(Clone, Debug, PartialEq)]
pub struct FetchedBarV1 {
    /// The bar as the venue published it.
    pub kline: BinanceFuturesKline,
    /// When its bytes were fetched, in nanoseconds since the Unix epoch.
    pub retrieval_ns: u64,
    /// Which route produced it: [`ARCHIVE_ROUTE`] or [`ENDPOINT_ROUTE`].
    pub route: &'static str,
}

/// One calendar month's settlements from the public monthly funding-rate archive, with the
/// evidence a funding settlement commit carries and the archive's own calendar window - never the
/// request's own window, so two overlapping requests commit the exact same coverage range for a
/// shared month and genuinely rejoin.
#[derive(Clone, Debug, PartialEq)]
pub struct FetchedFundingMonthV1 {
    /// The settlements this calendar month's archive states, in ascending settlement order.
    pub rows: Vec<FundingArchiveRowV1>,
    /// Inclusive start of this calendar month, in nanoseconds since the Unix epoch.
    pub month_start_ns: u64,
    /// Exclusive end of this calendar month, in nanoseconds since the Unix epoch.
    pub month_end_ns_exclusive: u64,
    /// When this month's bytes were fetched, in nanoseconds since the Unix epoch.
    pub retrieval_ns: u64,
}

/// Fetches execution bars from the archive and fill bars from the endpoint, keeping verified
/// archive shards under one directory.
pub struct VisionBackfillFetcherV1 {
    endpoint: BinanceFuturesHttpClient,
    archive: HttpClient,
    archive_base_url: String,
    shard_dir: PathBuf,
    clock: &'static AtomicTime,
}

impl Debug for VisionBackfillFetcherV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(VisionBackfillFetcherV1))
            .field("archive_base_url", &self.archive_base_url)
            .field("shard_dir", &self.shard_dir)
            .finish_non_exhaustive()
    }
}

impl VisionBackfillFetcherV1 {
    /// Builds a fetcher over a keyless endpoint client and a shard directory.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1::CredentialPresent`] for a client holding a credential, and
    /// [`VisionBackfillErrorV1::ArchiveClient`] if the archive client cannot be built.
    pub fn new(
        endpoint: BinanceFuturesHttpClient,
        shard_dir: impl Into<PathBuf>,
    ) -> Result<Self, VisionBackfillErrorV1> {
        if endpoint.has_credentials() {
            return Err(VisionBackfillErrorV1::CredentialPresent);
        }
        let archive = HttpClient::new(HashMap::new(), Vec::new(), Vec::new(), None, Some(60), None)
            .map_err(|_| VisionBackfillErrorV1::ArchiveClient)?;
        Ok(Self {
            endpoint,
            archive,
            archive_base_url: ARCHIVE_BASE_URL.to_string(),
            shard_dir: shard_dir.into(),
            clock: get_atomic_clock_realtime(),
        })
    }

    /// Points archive reads and the retrieval clock at stand-ins.
    #[cfg(test)]
    fn with_stand_ins(mut self, archive_base_url: String, clock: &'static AtomicTime) -> Self {
        self.archive_base_url = archive_base_url;
        self.clock = clock;
        self
    }

    /// Every ordinary bar of one archived month, from its shard or from the archive.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1`] for an archive that is unavailable, does not match its
    /// sidecar, or is not a USD-M kline month the reader admits, and for a shard directory that
    /// cannot be read or written.
    pub async fn execution_month(
        &self,
        symbol: &str,
        interval: BinanceKlineInterval,
        year: i32,
        month: u8,
    ) -> Result<Vec<FetchedBarV1>, VisionBackfillErrorV1> {
        self.execution_month_with_digest(symbol, interval, year, month)
            .await
            .map(|(_, bars)| bars)
    }

    /// The archive's own verified content digest, and every ordinary bar of one archived month,
    /// from its shard or from the archive. Market Data's B5 verifier carries the digest as
    /// `VenueBarArchiveV1::identity`.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1`] for an archive that is unavailable, does not match its
    /// sidecar, or is not a USD-M kline month the reader admits, and for a shard directory that
    /// cannot be read or written.
    pub async fn execution_month_with_digest(
        &self,
        symbol: &str,
        interval: BinanceKlineInterval,
        year: i32,
        month: u8,
    ) -> Result<(Sha256Digest, Vec<FetchedBarV1>), VisionBackfillErrorV1> {
        if !is_valid_binance_symbol(symbol) {
            return Err(VisionBackfillErrorV1::InvalidSymbol);
        }
        let stem = format!("{symbol}-{}-{year:04}-{month:02}", interval.as_str());
        let archive_name = format!("{stem}.zip");
        let shard = self.shard_dir.join(symbol).join(interval.as_str());

        let (archive, sidecar, retrieval_ns) =
            if let Some(found) = verified_shard(&shard, &archive_name)? {
                found
            } else {
                let url = format!(
                    "{}/data/futures/um/monthly/klines/{symbol}/{}/{archive_name}",
                    self.archive_base_url,
                    interval.as_str()
                );
                let retrieval_ns = self.clock.get_time_ns().as_u64();
                let archive = self.fetch(url.clone()).await?;
                let sidecar = self.fetch(format!("{url}.CHECKSUM")).await?;
                let declared = sidecar_digest(&sidecar, &archive_name)
                    .map_err(|_| VisionBackfillErrorV1::ArchiveMismatch)?;

                if archive_digest(&archive) != declared {
                    return Err(VisionBackfillErrorV1::ArchiveMismatch);
                }
                write_shard(&shard, &archive_name, &archive, &sidecar, retrieval_ns)?;
                (archive, sidecar, retrieval_ns)
            };
        let declared = sidecar_digest(&sidecar, &archive_name)
            .map_err(|_| VisionBackfillErrorV1::ArchiveMismatch)?;
        let binding = BinanceVisionArchiveBinding::new(
            archive_name,
            format!("{stem}.csv"),
            &declared.to_hex(),
            None,
            BinanceProductType::UsdM,
            symbol,
            interval,
        )
        .map_err(|_| VisionBackfillErrorV1::ArchiveUnreadable)?;
        let read = authenticate_monthly_klines(&binding, &archive, &sidecar)
            .map_err(|_| VisionBackfillErrorV1::ArchiveUnreadable)?;
        let klines = read
            .usdm_klines()
            .ok_or(VisionBackfillErrorV1::ArchiveUnreadable)?;
        Ok((
            declared,
            klines
                .iter()
                .map(|kline| FetchedBarV1 {
                    kline: kline.clone(),
                    retrieval_ns,
                    route: ARCHIVE_ROUTE,
                })
                .collect(),
        ))
    }

    /// The archive's own verified content digest, and every ordinary bar of one archived UTC
    /// day, from its shard or from the archive. Market Data's B5 verifier calls this for a bar
    /// earlier than its month's own file is published, and for a day a monthly file omits, and
    /// carries the digest as `VenueBarArchiveV1::identity`.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1`] for an archive that is unavailable, does not match its
    /// sidecar, or is not a USD-M kline day the reader admits, and for a shard directory that
    /// cannot be read or written.
    pub async fn execution_day(
        &self,
        symbol: &str,
        interval: BinanceKlineInterval,
        year: i32,
        month: u8,
        day: u8,
    ) -> Result<(Sha256Digest, Vec<FetchedBarV1>), VisionBackfillErrorV1> {
        if !is_valid_binance_symbol(symbol) {
            return Err(VisionBackfillErrorV1::InvalidSymbol);
        }
        let stem = format!(
            "{symbol}-{}-{year:04}-{month:02}-{day:02}",
            interval.as_str()
        );
        let archive_name = format!("{stem}.zip");
        let shard = self.shard_dir.join(symbol).join(interval.as_str());

        let (archive, sidecar, retrieval_ns) =
            if let Some(found) = verified_shard(&shard, &archive_name)? {
                found
            } else {
                let url = format!(
                    "{}/data/futures/um/daily/klines/{symbol}/{}/{archive_name}",
                    self.archive_base_url,
                    interval.as_str()
                );
                let retrieval_ns = self.clock.get_time_ns().as_u64();
                let archive = self.fetch(url.clone()).await?;
                let sidecar = self.fetch(format!("{url}.CHECKSUM")).await?;
                let declared = sidecar_digest(&sidecar, &archive_name)
                    .map_err(|_| VisionBackfillErrorV1::ArchiveMismatch)?;

                if archive_digest(&archive) != declared {
                    return Err(VisionBackfillErrorV1::ArchiveMismatch);
                }
                write_shard(&shard, &archive_name, &archive, &sidecar, retrieval_ns)?;
                (archive, sidecar, retrieval_ns)
            };
        let declared = sidecar_digest(&sidecar, &archive_name)
            .map_err(|_| VisionBackfillErrorV1::ArchiveMismatch)?;
        let binding = BinanceVisionArchiveBinding::new_daily(
            archive_name,
            format!("{stem}.csv"),
            &declared.to_hex(),
            None,
            BinanceProductType::UsdM,
            symbol,
            interval,
        )
        .map_err(|_| VisionBackfillErrorV1::ArchiveUnreadable)?;
        let (identity, read) = authenticate_daily_klines(&binding, &archive, &sidecar)
            .map_err(|_| VisionBackfillErrorV1::ArchiveUnreadable)?;
        let klines = read
            .usdm_klines()
            .ok_or(VisionBackfillErrorV1::ArchiveUnreadable)?;
        Ok((
            identity,
            klines
                .iter()
                .map(|kline| FetchedBarV1 {
                    kline: kline.clone(),
                    retrieval_ns,
                    route: DAILY_ARCHIVE_ROUTE,
                })
                .collect(),
        ))
    }

    /// Every ordinary bar whose interval-close instant lies in `[window_start_ns,
    /// window_end_ns_exclusive)`, in ascending order: the window's bars by the rule the custody
    /// request builder applies (`vision_backfill_custody_v1.rs::cross_section`) and the window
    /// schedule enumerates frames by.
    ///
    /// The archive files a bar by its open, so the bar that closes exactly at the window's start
    /// opens one interval earlier, often in the previous month. The months read therefore start one
    /// interval before the window, or the window's first frame would have no cross-section and
    /// every run starting at it would be refused as not covered. Filtering to the window here also
    /// keeps the per-bar fill lookups to the window's own bars.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1::WindowBeforeEpoch`] for a window before the Unix epoch,
    /// and otherwise the first error [`Self::execution_month`] returns for any covered month.
    pub async fn execution_window(
        &self,
        symbol: &str,
        interval: BinanceKlineInterval,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<Vec<FetchedBarV1>, VisionBackfillErrorV1> {
        let mut bars = Vec::new();
        let first_open_ns = window_start_ns.saturating_sub(longest_interval_ns(interval));
        let window_months = calendar_months(window_start_ns, window_end_ns_exclusive)?;

        for (year, month) in calendar_months(first_open_ns, window_end_ns_exclusive)? {
            match self.execution_month(symbol, interval, year, month).await {
                Ok(month_bars) => bars.extend(month_bars),
                // A month before the window's own holds only the bar closing at its start. The
                // archive may not publish that month at all (the USD-M monthly archive starts at
                // 2020-01), so that bar comes from the public endpoint instead; a month of the
                // window itself still has to be archived.
                Err(VisionBackfillErrorV1::ArchiveUnavailable)
                    if !window_months.contains(&(year, month)) =>
                {
                    bars.extend(
                        self.endpoint_bars_before(symbol, interval, window_start_ns)
                            .await?,
                    );
                }
                Err(e) => return Err(e),
            }
        }
        // A window whose start is a bar close of its grid has its first frame there, so the bar
        // closing at the start must be held; a start between closes needs no such bar.
        if let Some(prior_open_ns) = grid_bar_closing_at_v1(interval, window_start_ns) {
            let held = bars.iter().any(|bar| {
                bar.kline
                    .close_time
                    .checked_add(1)
                    .and_then(|close_ms| u64::try_from(close_ms).ok())
                    .is_some_and(|close_ms| close_ms * 1_000_000 == window_start_ns)
            });

            if !held {
                return Err(VisionBackfillErrorV1::PriorBarUnavailable {
                    open_ms: i64::try_from(prior_open_ns / 1_000_000).unwrap_or(i64::MAX),
                });
            }
        }
        bars.retain(|bar| {
            bar.kline
                .close_time
                .checked_add(1)
                .and_then(|close_ms| u64::try_from(close_ms).ok())
                .and_then(|close_ms| close_ms.checked_mul(1_000_000))
                .is_some_and(|close_ns| {
                    close_ns >= window_start_ns && close_ns < window_end_ns_exclusive
                })
        });
        Ok(bars)
    }

    /// Every settlement of one archived month, from its shard or from the archive.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1`] for an archive that is unavailable, does not match its
    /// sidecar, or is not a USD-M funding-rate month the reader admits, and for a shard directory
    /// that cannot be read or written.
    pub async fn funding_month(
        &self,
        symbol: &str,
        year: i32,
        month: u8,
    ) -> Result<FetchedFundingMonthV1, VisionBackfillErrorV1> {
        if !is_valid_binance_symbol(symbol) {
            return Err(VisionBackfillErrorV1::InvalidSymbol);
        }
        let archive_name = format!("{symbol}-fundingRate-{year:04}-{month:02}.zip");
        let shard = self.shard_dir.join(symbol).join("funding");

        let (archive, sidecar, retrieval_ns) =
            if let Some(found) = verified_shard(&shard, &archive_name)? {
                found
            } else {
                let url = format!(
                    "{}/data/futures/um/monthly/fundingRate/{symbol}/{archive_name}",
                    self.archive_base_url
                );
                let retrieval_ns = self.clock.get_time_ns().as_u64();
                let archive = self.fetch(url.clone()).await?;
                let sidecar = self.fetch(format!("{url}.CHECKSUM")).await?;
                let declared = sidecar_digest(&sidecar, &archive_name)
                    .map_err(|_| VisionBackfillErrorV1::ArchiveMismatch)?;

                if archive_digest(&archive) != declared {
                    return Err(VisionBackfillErrorV1::ArchiveMismatch);
                }
                write_shard(&shard, &archive_name, &archive, &sidecar, retrieval_ns)?;
                (archive, sidecar, retrieval_ns)
            };
        let rows = authenticate_monthly_funding(symbol, year, month, &archive, &sidecar)
            .map_err(|_| VisionBackfillErrorV1::ArchiveUnreadable)?;
        let (month_start_ns, month_end_ns_exclusive) = month_bounds_ns(year, month)?;
        Ok(FetchedFundingMonthV1 {
            rows,
            month_start_ns,
            month_end_ns_exclusive,
            retrieval_ns,
        })
    }

    /// Every calendar month [`Self::funding_month`] could read that overlaps `[window_start_ns,
    /// window_end_ns_exclusive)`, in month order - one entry per month, each carrying its own
    /// calendar window and retrieval instant, never the request's own window: a funding
    /// settlement commit's coverage must name the exact window its rows were read for, so a
    /// caller committing month by month commits the same coverage range every time it re-reads a
    /// month, and genuinely rejoins.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1::WindowBeforeEpoch`] for a window before the Unix epoch,
    /// and otherwise the first error [`Self::funding_month`] returns for any covered month.
    pub async fn funding_window(
        &self,
        symbol: &str,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<Vec<FetchedFundingMonthV1>, VisionBackfillErrorV1> {
        let mut months = Vec::new();

        for (year, month) in calendar_months(window_start_ns, window_end_ns_exclusive)? {
            months.push(self.funding_month(symbol, year, month).await?);
        }
        Ok(months)
    }

    /// The closed bars of `interval` that open within one interval before `window_start_ns`, from
    /// the public endpoint: the bar closing at the window's start, when its month is not archived.
    ///
    /// # Errors
    ///
    /// [`VisionBackfillErrorV1::EndpointUnavailable`] when the endpoint does not answer.
    async fn endpoint_bars_before(
        &self,
        symbol: &str,
        interval: BinanceKlineInterval,
        window_start_ns: u64,
    ) -> Result<Vec<FetchedBarV1>, VisionBackfillErrorV1> {
        let retrieval_ns = self.clock.get_time_ns().as_u64();
        let start_ms = window_start_ns / 1_000_000;
        let first_open_ms = start_ms.saturating_sub(longest_interval_ns(interval) / 1_000_000);
        let millis = |value: u64| i64::try_from(value).unwrap_or(i64::MAX);
        let klines = self
            .endpoint
            .inner()
            .klines(&BinanceKlinesParams {
                symbol: symbol.to_string(),
                interval: interval.as_str().to_string(),
                start_time: Some(millis(first_open_ms)),
                end_time: Some(millis(start_ms).saturating_sub(1)),
                limit: None,
            })
            .await
            .map_err(|_| VisionBackfillErrorV1::EndpointUnavailable)?;
        let closed_by_ms = millis(retrieval_ns / 1_000_000);
        Ok(klines
            .into_iter()
            .filter(|kline| kline.close_time < closed_by_ms)
            .map(|kline| FetchedBarV1 {
                kline,
                retrieval_ns,
                route: ENDPOINT_ROUTE,
            })
            .collect())
    }

    /// The first `1m` bar opening strictly after `after_ms` and strictly before `before_ms`, or
    /// `None` when the venue has none in that gap.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1::EndpointUnavailable`] when the endpoint does not answer,
    /// and [`VisionBackfillErrorV1::FillBarNotClosed`] for a bar still open when it was retrieved:
    /// the venue serves the current bar as its last, and it is never a custody row.
    pub async fn fill_bar(
        &self,
        symbol: &str,
        after_ms: i64,
        before_ms: i64,
    ) -> Result<Option<FetchedBarV1>, VisionBackfillErrorV1> {
        let retrieval_ns = self.clock.get_time_ns().as_u64();
        let klines = self
            .endpoint
            .inner()
            .klines(&BinanceKlinesParams {
                symbol: symbol.to_string(),
                interval: FILL_INTERVAL.to_string(),
                start_time: Some(after_ms + 1),
                end_time: None,
                limit: Some(1),
            })
            .await
            .map_err(|_| VisionBackfillErrorV1::EndpointUnavailable)?;
        let Some(kline) = klines
            .into_iter()
            .find(|kline| kline.open_time > after_ms && kline.open_time < before_ms)
        else {
            return Ok(None);
        };
        // The venue's close time is the last millisecond of the bar, so it has closed once the
        // millisecond after it has passed.
        let closed_by_ms = i64::try_from(retrieval_ns / 1_000_000).unwrap_or(i64::MAX);

        if kline.close_time >= closed_by_ms {
            return Err(VisionBackfillErrorV1::FillBarNotClosed);
        }
        Ok(Some(FetchedBarV1 {
            kline,
            retrieval_ns,
            route: ENDPOINT_ROUTE,
        }))
    }

    /// The fill bar of every gap after an execution bar: the first `1m` bar opening strictly
    /// after the bar's availability - its close plus the lag `availability` declares - and
    /// strictly before the next execution bar's close, or before `window_end_ms` for the last. A
    /// gap the venue has no bar in is left out.
    ///
    /// `availability` must be the rule of the Source Binding proposal the custody is committed
    /// under, and nothing else. A smaller lag selects a bar the custody refuses, but a larger one
    /// selects a later bar still inside the gap, which nothing downstream can tell from the right
    /// one: the fill price would be silently wrong.
    ///
    /// # Errors
    ///
    /// Returns [`VisionBackfillErrorV1::AvailabilityNotAfterBarClose`] for a rule that is not a
    /// lag after the bar's close, and otherwise the first error a gap's [`Self::fill_bar`] call
    /// returns.
    pub async fn fill_bars(
        &self,
        symbol: &str,
        execution: &[FetchedBarV1],
        availability: &UntrustedSourceAvailabilityRuleV1,
        window_end_ms: i64,
    ) -> Result<Vec<FetchedBarV1>, VisionBackfillErrorV1> {
        let UntrustedSourceVisibilityV1::AfterBarClose { lag_ns } = availability.visibility else {
            return Err(VisionBackfillErrorV1::AvailabilityNotAfterBarClose);
        };
        let mut closes: Vec<i64> = execution
            .iter()
            .map(|bar| bar.kline.close_time.saturating_add(1))
            .collect();
        closes.sort_unstable();
        let mut fills = Vec::new();

        for (index, close) in closes.iter().enumerate() {
            let before = closes.get(index + 1).copied().unwrap_or(window_end_ms);
            // A bar opening at a whole millisecond strictly after the availability instant opens
            // strictly after its whole-millisecond floor.
            let available_ns = u64::try_from(*close)
                .unwrap_or(0)
                .saturating_mul(1_000_000)
                .saturating_add(lag_ns);
            let after = i64::try_from(available_ns / 1_000_000).unwrap_or(i64::MAX);

            if let Some(fill) = self.fill_bar(symbol, after, before).await? {
                fills.push(fill);
            }
        }
        Ok(fills)
    }

    async fn fetch(&self, url: String) -> Result<Vec<u8>, VisionBackfillErrorV1> {
        let response = self
            .archive
            .get(url, None, None, None, None)
            .await
            .map_err(|_| VisionBackfillErrorV1::ArchiveUnavailable)?;

        if !response.status.is_success() {
            return Err(VisionBackfillErrorV1::ArchiveUnavailable);
        }
        Ok(response.body.to_vec())
    }
}

/// The open of the bar of `interval` that closes exactly at `instant_ns`, when `instant_ns` is a
/// bar close of the interval's grid (the Unix epoch, or Monday 00:00 UTC for a week); `None`
/// otherwise.
fn grid_bar_closing_at_v1(interval: BinanceKlineInterval, instant_ns: u64) -> Option<u64> {
    let timeframe = served_timeframe_v1(interval.as_str())?;
    let ServedBarGridV1::Fixed { interval_ns, .. } = timeframe.grid;
    let open_ns = instant_ns.checked_sub(interval_ns)?;
    (timeframe.close_of(open_ns) == Some(instant_ns)).then_some(open_ns)
}

/// The longest one bar of `interval` can be: its fixed length, or 31 days for a calendar month.
const fn longest_interval_ns(interval: BinanceKlineInterval) -> u64 {
    const MINUTE: u64 = 60_000_000_000;

    match interval {
        BinanceKlineInterval::Second1 => 1_000_000_000,
        BinanceKlineInterval::Minute1 => MINUTE,
        BinanceKlineInterval::Minute3 => 3 * MINUTE,
        BinanceKlineInterval::Minute5 => 5 * MINUTE,
        BinanceKlineInterval::Minute15 => 15 * MINUTE,
        BinanceKlineInterval::Minute30 => 30 * MINUTE,
        BinanceKlineInterval::Hour1 => 60 * MINUTE,
        BinanceKlineInterval::Hour2 => 120 * MINUTE,
        BinanceKlineInterval::Hour4 => 240 * MINUTE,
        BinanceKlineInterval::Hour6 => 360 * MINUTE,
        BinanceKlineInterval::Hour8 => 480 * MINUTE,
        BinanceKlineInterval::Hour12 => 720 * MINUTE,
        BinanceKlineInterval::Day1 => 1_440 * MINUTE,
        BinanceKlineInterval::Day3 => 3 * 1_440 * MINUTE,
        BinanceKlineInterval::Week1 => 7 * 1_440 * MINUTE,
        BinanceKlineInterval::Month1 => 31 * 1_440 * MINUTE,
    }
}

/// Every UTC calendar `(year, month)` `[window_start_ns, window_end_ns_exclusive)` touches, in
/// ascending order: the archive month an instant falls in, for the first instant and for every
/// instant strictly before the exclusive end.
fn calendar_months(
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<Vec<(i32, u8)>, VisionBackfillErrorV1> {
    if window_end_ns_exclusive <= window_start_ns {
        return Ok(Vec::new());
    }
    let start = jiff::Timestamp::from_nanosecond(i128::from(window_start_ns))
        .map_err(|_| VisionBackfillErrorV1::WindowBeforeEpoch)?
        .to_zoned(jiff::tz::TimeZone::UTC);
    let last_ns = window_end_ns_exclusive - 1;
    let end = jiff::Timestamp::from_nanosecond(i128::from(last_ns))
        .map_err(|_| VisionBackfillErrorV1::WindowBeforeEpoch)?
        .to_zoned(jiff::tz::TimeZone::UTC);

    let mut months = Vec::new();
    let mut year: i16 = start.year();
    let mut month = start.month();
    loop {
        months.push((i32::from(year), u8::try_from(month).unwrap_or(1)));
        if year == end.year() && month == end.month() {
            break;
        }

        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }
    Ok(months)
}

/// The half-open UTC calendar window `[month_start_ns, month_end_ns_exclusive)` of one calendar
/// month, in nanoseconds since the Unix epoch, computed from the Howard Hinnant civil calendar
/// algorithm (the same one `chrono`/C++20 `<chrono>` use) rather than a calendar library, so this
/// stays exact at the far past and far future years an archive backfill can name.
///
/// # Errors
///
/// Returns [`VisionBackfillErrorV1::WindowBeforeEpoch`] for a month entirely before the Unix
/// epoch.
pub(crate) fn month_bounds_ns(year: i32, month: u8) -> Result<(u64, u64), VisionBackfillErrorV1> {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let start_day = days_from_civil(i64::from(year), u32::from(month), 1);
    let end_day = days_from_civil(i64::from(next_year), u32::from(next_month), 1);
    let start_ns = start_day
        .checked_mul(86_400_000_000_000)
        .and_then(|ns| u64::try_from(ns).ok())
        .ok_or(VisionBackfillErrorV1::WindowBeforeEpoch)?;
    let end_ns = end_day
        .checked_mul(86_400_000_000_000)
        .and_then(|ns| u64::try_from(ns).ok())
        .ok_or(VisionBackfillErrorV1::WindowBeforeEpoch)?;
    Ok((start_ns, end_ns))
}

/// The `[start, end)` UTC day window a daily archive covers, in nanoseconds since the Unix epoch.
pub(crate) fn day_bounds_ns(
    year: i32,
    month: u8,
    day: u8,
) -> Result<(u64, u64), VisionBackfillErrorV1> {
    let start_day = days_from_civil(i64::from(year), u32::from(month), u32::from(day));
    let start_ns = start_day
        .checked_mul(86_400_000_000_000)
        .and_then(|ns| u64::try_from(ns).ok())
        .ok_or(VisionBackfillErrorV1::WindowBeforeEpoch)?;
    let end_ns = start_ns
        .checked_add(86_400_000_000_000)
        .ok_or(VisionBackfillErrorV1::WindowBeforeEpoch)?;
    Ok((start_ns, end_ns))
}

/// Days since the Unix epoch (1970-01-01) for a proleptic Gregorian civil date. Howard Hinnant's
/// `days_from_civil`: <https://howardhinnant.github.io/date_algorithms.html>.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let year_of_era = y - era * 400;
    let month_index = (i64::from(month) + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod calendar_months_tests {
    use rstest::rstest;

    use super::{calendar_months, month_bounds_ns};

    /// 2021-06-01T00:00:00Z, the same instant `JUNE_2021_MS` names in the fetcher tests below,
    /// converted to nanoseconds: an independent check that `month_bounds_ns` and the live archive
    /// tests' own hand-verified epoch instant agree.
    const JUNE_2021_START_NS: u64 = 1_622_505_600_000_000_000;

    #[rstest]
    fn a_months_bounds_match_the_independently_known_epoch_instant() {
        let (start, end) = month_bounds_ns(2021, 6).unwrap();
        assert_eq!(start, JUNE_2021_START_NS);
        assert_eq!(end, JUNE_2021_START_NS + 30 * 86_400_000_000_000);
    }

    #[rstest]
    fn decembers_bounds_roll_into_the_next_year() {
        let (_, december_end) = month_bounds_ns(2023, 12).unwrap();
        let (january_start, _) = month_bounds_ns(2024, 1).unwrap();
        assert_eq!(december_end, january_start);
    }

    #[rstest]
    fn februarys_length_follows_the_leap_year_rule() {
        let (leap_start, leap_end) = month_bounds_ns(2024, 2).unwrap();
        assert_eq!(leap_end - leap_start, 29 * 86_400_000_000_000);
        let (common_start, common_end) = month_bounds_ns(2023, 2).unwrap();
        assert_eq!(common_end - common_start, 28 * 86_400_000_000_000);
    }

    const fn nanos_per_day() -> u64 {
        24 * 60 * 60 * 1_000_000_000
    }

    #[rstest]
    fn a_window_inside_one_month_names_that_month() {
        // 2024-01-15T00:00:00Z through 2024-01-16T00:00:00Z (exclusive).
        let start = 1_705_276_800_000_000_000;
        let months = calendar_months(start, start + nanos_per_day()).unwrap();
        assert_eq!(months, vec![(2024, 1)]);
    }

    #[rstest]
    fn a_window_crossing_a_month_boundary_names_both_months() {
        // 2024-01-31T00:00:00Z through 2024-02-01T00:00:00Z + 1 day (exclusive end inside Feb).
        let jan_31 = 1_706_659_200_000_000_000;
        let months = calendar_months(jan_31, jan_31 + 2 * nanos_per_day()).unwrap();
        assert_eq!(months, vec![(2024, 1), (2024, 2)]);
    }

    #[rstest]
    fn a_window_crossing_a_year_boundary_names_both_years() {
        // 2023-12-31T00:00:00Z through 2024-01-01T00:00:00Z + 1 day (exclusive end inside Jan).
        let dec_31 = 1_703_980_800_000_000_000;
        let months = calendar_months(dec_31, dec_31 + 2 * nanos_per_day()).unwrap();
        assert_eq!(months, vec![(2023, 12), (2024, 1)]);
    }

    #[rstest]
    fn an_empty_window_names_no_month() {
        assert_eq!(calendar_months(10, 10).unwrap(), Vec::new());
        assert_eq!(calendar_months(10, 5).unwrap(), Vec::new());
    }
}

/// One shard's zip, its sidecar, and the instant they were retrieved.
type ShardV1 = (Vec<u8>, Vec<u8>, u64);

/// The shard, if all three files are present and the zip still matches the digest its sidecar
/// declares. Anything else is a shard to fetch again.
fn verified_shard(
    shard: &Path,
    archive_name: &str,
) -> Result<Option<ShardV1>, VisionBackfillErrorV1> {
    let read = |name: String| match std::fs::read(shard.join(name)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(VisionBackfillErrorV1::ShardStoreUnavailable),
    };
    let (Some(archive), Some(sidecar), Some(retrieved)) = (
        read(archive_name.to_string())?,
        read(format!("{archive_name}.CHECKSUM"))?,
        read(format!("{archive_name}.retrieved"))?,
    ) else {
        return Ok(None);
    };
    let Some(retrieval_ns) = std::str::from_utf8(&retrieved)
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
    else {
        return Ok(None);
    };

    match sidecar_digest(&sidecar, archive_name) {
        Ok(declared) if declared == archive_digest(&archive) => {
            Ok(Some((archive, sidecar, retrieval_ns)))
        }
        _ => Ok(None),
    }
}

/// Writes the three shard files, each through a temporary file and a rename. The retrieval
/// instant goes last, so a shard missing it is fetched again rather than trusted.
fn write_shard(
    shard: &Path,
    archive_name: &str,
    archive: &[u8],
    sidecar: &[u8],
    retrieval_ns: u64,
) -> Result<(), VisionBackfillErrorV1> {
    std::fs::create_dir_all(shard).map_err(|_| VisionBackfillErrorV1::ShardStoreUnavailable)?;
    let retrieved = retrieval_ns.to_string();

    for (name, bytes) in [
        (archive_name.to_string(), archive),
        (format!("{archive_name}.CHECKSUM"), sidecar),
        (format!("{archive_name}.retrieved"), retrieved.as_bytes()),
    ] {
        let target = shard.join(&name);
        let partial = shard.join(format!("{name}.partial"));
        std::fs::write(&partial, bytes)
            .and_then(|()| std::fs::rename(&partial, &target))
            .map_err(|_| VisionBackfillErrorV1::ShardStoreUnavailable)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        net::SocketAddr,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use axum::{
        Router,
        extract::{RawQuery, State},
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::get,
    };
    use rstest::rstest;
    use serde_json::json;
    use vibe_core::UnixNanos;

    use super::*;
    use crate::common::enums::BinanceEnvironment;

    const DAY_MS: i64 = 86_400_000;
    /// 2021-06-01T00:00:00Z.
    const JUNE_2021_MS: i64 = 1_622_505_600_000;
    const NOW_NS: u64 = 1_791_000_000_000_000_000;
    const STEM: &str = "BTCUSDT-1d-2021-06";

    /// The first two rows of the real BTCUSDT `1d` 2021-06 trade archive, which has no header.
    fn june_rows() -> String {
        format!(
            "{JUNE_2021_MS},37244.36,37893.76,35500.00,36693.41,590822.540,{},21609364827.08958,5297320,291774.994,10673866023.68145,0\n\
             {},36693.42,38234.00,35920.00,37568.68,579547.269,{},21343318547.22311,5110813,290013.110,10686151697.05829,0\n",
            JUNE_2021_MS + DAY_MS - 1,
            JUNE_2021_MS + DAY_MS,
            JUNE_2021_MS + 2 * DAY_MS - 1
        )
    }

    /// A shard directory of its own, removed when the test ends.
    struct ShardDir(PathBuf);

    impl ShardDir {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "vision-backfill-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ShardDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn zipped(csv: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(
            format!("{STEM}.csv"),
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(csv.as_bytes()).unwrap();
        zip.finish().unwrap().into_inner()
    }

    fn checksum(archive: &[u8]) -> Vec<u8> {
        format!("{}  {STEM}.zip\n", archive_digest(archive).to_hex()).into_bytes()
    }

    #[derive(Clone)]
    struct Archive {
        zip: Option<Vec<u8>>,
        checksum: Vec<u8>,
        requests: Arc<AtomicUsize>,
        seen: Arc<Mutex<Vec<(HeaderMap, String)>>>,
        fill: serde_json::Value,
    }

    async fn serve_zip(State(archive): State<Archive>) -> Response {
        archive.requests.fetch_add(1, Ordering::SeqCst);
        match archive.zip {
            Some(zip) => (StatusCode::OK, zip).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        }
    }

    async fn serve_checksum(State(archive): State<Archive>) -> Response {
        archive.requests.fetch_add(1, Ordering::SeqCst);
        (StatusCode::OK, archive.checksum).into_response()
    }

    async fn serve_klines(
        State(archive): State<Archive>,
        headers: HeaderMap,
        RawQuery(query): RawQuery,
    ) -> Response {
        archive
            .seen
            .lock()
            .unwrap()
            .push((headers, query.unwrap_or_default()));
        (
            StatusCode::OK,
            [("content-type", "application/json")],
            archive.fill.to_string(),
        )
            .into_response()
    }

    async fn fetcher(archive: Archive, shard_dir: &Path) -> VisionBackfillFetcherV1 {
        let path = format!("/data/futures/um/monthly/klines/BTCUSDT/1d/{STEM}.zip");
        let router = Router::new()
            .route(&path, get(serve_zip))
            .route(&format!("{path}.CHECKSUM"), get(serve_checksum))
            .route("/fapi/v1/klines", get(serve_klines))
            .with_state(archive);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let endpoint = BinanceFuturesHttpClient::new(
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
        .unwrap();
        let clock: &'static AtomicTime =
            Box::leak(Box::new(AtomicTime::new(false, UnixNanos::from(NOW_NS))));
        VisionBackfillFetcherV1::new(endpoint, shard_dir)
            .unwrap()
            .with_stand_ins(format!("http://{address}"), clock)
    }

    fn archive(zip: Option<Vec<u8>>, checksum: Vec<u8>) -> Archive {
        Archive {
            zip,
            checksum,
            requests: Arc::new(AtomicUsize::new(0)),
            seen: Arc::new(Mutex::new(Vec::new())),
            fill: json!([]),
        }
    }

    #[tokio::test]
    async fn a_month_is_fetched_once_and_its_verified_shard_is_reused() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let stand = archive(Some(zip.clone()), checksum(&zip));
        let requests = stand.requests.clone();
        let fetcher = fetcher(stand, shards.path()).await;

        let first = fetcher
            .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
            .await
            .expect("a headerless 2021 month is read");
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].kline.open_time, JUNE_2021_MS);
        assert_eq!(first[0].kline.close, "36693.41");
        assert!(
            first
                .iter()
                .all(|bar| bar.route == ARCHIVE_ROUTE && bar.retrieval_ns == NOW_NS)
        );
        assert_eq!(
            requests.load(Ordering::SeqCst),
            2,
            "the zip and its sidecar"
        );

        let again = fetcher
            .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
            .await
            .unwrap();
        assert_eq!(
            again, first,
            "the shard answers, with the instant it was retrieved"
        );
        assert_eq!(
            requests.load(Ordering::SeqCst),
            2,
            "a verified shard is not fetched again"
        );
    }

    #[tokio::test]
    async fn a_day_is_fetched_once_and_its_verified_shard_is_reused() {
        const DAY_STEM: &str = "BTCUSDT-1h-2021-06-01";
        let csv = format!(
            "{JUNE_2021_MS},36000.00,36100.00,35900.00,36050.00,10.000,{},900000.00,100,5.000,450000.00,0\n",
            JUNE_2021_MS + 3_600_000 - 1
        );
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(
            format!("{DAY_STEM}.csv"),
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(csv.as_bytes()).unwrap();
        let zip = zip.finish().unwrap().into_inner();
        let sidecar = format!("{}  {DAY_STEM}.zip\n", archive_digest(&zip).to_hex()).into_bytes();

        let shards = ShardDir::new();
        let requests = Arc::new(AtomicUsize::new(0));
        let path = format!("/data/futures/um/daily/klines/BTCUSDT/1h/{DAY_STEM}.zip");
        let router = Router::new()
            .route(
                &path,
                get({
                    let zip = zip.clone();
                    let requests = requests.clone();
                    move || {
                        let zip = zip.clone();
                        let requests = requests.clone();
                        async move {
                            requests.fetch_add(1, Ordering::SeqCst);
                            (StatusCode::OK, zip).into_response()
                        }
                    }
                }),
            )
            .route(
                &format!("{path}.CHECKSUM"),
                get({
                    let sidecar = sidecar.clone();
                    let requests = requests.clone();
                    move || {
                        let sidecar = sidecar.clone();
                        let requests = requests.clone();
                        async move {
                            requests.fetch_add(1, Ordering::SeqCst);
                            (StatusCode::OK, sidecar).into_response()
                        }
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let endpoint = BinanceFuturesHttpClient::new(
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
        .unwrap();
        let clock: &'static AtomicTime =
            Box::leak(Box::new(AtomicTime::new(false, UnixNanos::from(NOW_NS))));
        let fetcher = VisionBackfillFetcherV1::new(endpoint, shards.path())
            .unwrap()
            .with_stand_ins(format!("http://{address}"), clock);

        let (identity, first) = fetcher
            .execution_day("BTCUSDT", BinanceKlineInterval::Hour1, 2021, 6, 1)
            .await
            .expect("a headerless 2021 day is read");
        assert_eq!(identity, archive_digest(&zip));
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].kline.open_time, JUNE_2021_MS);
        assert!(
            first
                .iter()
                .all(|bar| bar.route == DAILY_ARCHIVE_ROUTE && bar.retrieval_ns == NOW_NS)
        );
        assert_eq!(
            requests.load(Ordering::SeqCst),
            2,
            "the zip and its sidecar"
        );

        let (again_identity, again) = fetcher
            .execution_day("BTCUSDT", BinanceKlineInterval::Hour1, 2021, 6, 1)
            .await
            .unwrap();
        assert_eq!(again_identity, identity);
        assert_eq!(
            again, first,
            "the shard answers, with the instant it was retrieved"
        );
        assert_eq!(
            requests.load(Ordering::SeqCst),
            2,
            "a verified shard is not fetched again"
        );
    }

    /// A window holds exactly the bars whose close lies in it: the bar closing at the window's
    /// start is its first frame's cross-section and is held, the bar closing at its exclusive end
    /// is not.
    #[tokio::test]
    async fn a_window_holds_the_bar_closing_at_its_start_and_not_the_one_closing_at_its_end() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let fetcher = fetcher(archive(Some(zip.clone()), checksum(&zip)), shards.path()).await;
        let nanos = |ms: i64| u64::try_from(ms).unwrap() * 1_000_000;

        let bars = fetcher
            .execution_window(
                "BTCUSDT",
                BinanceKlineInterval::Day1,
                nanos(JUNE_2021_MS + DAY_MS),
                nanos(JUNE_2021_MS + 2 * DAY_MS),
            )
            .await
            .expect("the window's month is read");
        assert_eq!(
            bars.iter()
                .map(|bar| bar.kline.open_time)
                .collect::<Vec<_>>(),
            [JUNE_2021_MS],
            "the bar opening a day before the window closes at its start"
        );
    }

    /// The bar closing at a window's start, in a month the archive does not publish (the USD-M
    /// monthly archive starts 2020-01), comes from the public endpoint; the window's own months
    /// still come from the archive.
    #[tokio::test]
    async fn the_bar_closing_at_the_start_of_an_unarchived_month_comes_from_the_endpoint() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let mut stand = archive(Some(zip.clone()), checksum(&zip));
        let mut prior_day = one_minute(JUNE_2021_MS - DAY_MS);
        prior_day[0][6] = json!(JUNE_2021_MS - 1);
        stand.fill = prior_day;
        let seen = stand.seen.clone();
        let fetcher = fetcher(stand, shards.path()).await;
        let nanos = |ms: i64| u64::try_from(ms).unwrap() * 1_000_000;

        let bars = fetcher
            .execution_window(
                "BTCUSDT",
                BinanceKlineInterval::Day1,
                nanos(JUNE_2021_MS),
                nanos(JUNE_2021_MS + 2 * DAY_MS),
            )
            .await
            .expect("the window backfills although 2021-05 is not archived");
        assert_eq!(
            bars.iter()
                .map(|bar| (bar.kline.open_time, bar.route))
                .collect::<Vec<_>>(),
            [
                (JUNE_2021_MS - DAY_MS, ENDPOINT_ROUTE),
                (JUNE_2021_MS, ARCHIVE_ROUTE)
            ]
        );
        let (_, query) = seen.lock().unwrap()[0].clone();
        assert!(
            query.contains("interval=1d")
                && query.contains(&format!("startTime={}", JUNE_2021_MS - DAY_MS))
                && query.contains(&format!("endTime={}", JUNE_2021_MS - 1)),
            "{query}"
        );
    }

    /// A grid-aligned window whose first frame's bar is in neither the archive nor the endpoint
    /// is refused by name, naming that bar, rather than backfilled without its first frame.
    #[tokio::test]
    async fn a_first_frame_bar_found_nowhere_is_refused_by_name() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let fetcher = fetcher(archive(Some(zip.clone()), checksum(&zip)), shards.path()).await;
        let nanos = |ms: i64| u64::try_from(ms).unwrap() * 1_000_000;

        assert_eq!(
            fetcher
                .execution_window(
                    "BTCUSDT",
                    BinanceKlineInterval::Day1,
                    nanos(JUNE_2021_MS),
                    nanos(JUNE_2021_MS + 2 * DAY_MS),
                )
                .await,
            Err(VisionBackfillErrorV1::PriorBarUnavailable {
                open_ms: JUNE_2021_MS - DAY_MS
            })
        );
    }

    #[tokio::test]
    async fn a_damaged_shard_is_fetched_again() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let stand = archive(Some(zip.clone()), checksum(&zip));
        let requests = stand.requests.clone();
        let fetcher = fetcher(stand, shards.path()).await;
        fetcher
            .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
            .await
            .unwrap();
        std::fs::write(
            shards.path().join("BTCUSDT/1d").join(format!("{STEM}.zip")),
            b"truncated",
        )
        .unwrap();

        fetcher
            .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
            .await
            .expect("the damaged shard is replaced");
        assert_eq!(requests.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn an_archive_that_does_not_match_its_sidecar_is_refused_and_not_kept() {
        let shards = ShardDir::new();
        let zip = zipped(&june_rows());
        let other = checksum(&zipped("not this month"));
        let fetcher = fetcher(archive(Some(zip), other), shards.path()).await;
        assert_eq!(
            fetcher
                .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
                .await,
            Err(VisionBackfillErrorV1::ArchiveMismatch)
        );
        assert!(
            !shards.path().join("BTCUSDT").exists(),
            "nothing unverified is kept"
        );
    }

    #[tokio::test]
    async fn a_month_the_archive_does_not_serve_is_unavailable() {
        let shards = ShardDir::new();
        let fetcher = fetcher(archive(None, Vec::new()), shards.path()).await;
        assert_eq!(
            fetcher
                .execution_month("BTCUSDT", BinanceKlineInterval::Day1, 2021, 6)
                .await,
            Err(VisionBackfillErrorV1::ArchiveUnavailable)
        );
    }

    #[tokio::test]
    async fn funding_month_refuses_an_invalid_symbol_before_building_any_path() {
        let shards = ShardDir::new();
        let fetcher = fetcher(archive(None, Vec::new()), shards.path()).await;

        assert_eq!(
            fetcher.funding_month("../x", 2021, 6).await,
            Err(VisionBackfillErrorV1::InvalidSymbol)
        );
    }

    fn one_minute(open_time: i64) -> serde_json::Value {
        json!([[
            open_time,
            "37000.0",
            "37010.0",
            "36990.0",
            "37005.0",
            "12.5",
            open_time + 59_999,
            "462500.0",
            300,
            "6.0",
            "222000.0",
            "0"
        ]])
    }

    #[tokio::test]
    async fn a_fill_bar_opens_strictly_inside_its_gap_and_is_fetched_without_a_credential() {
        let shards = ShardDir::new();
        let after = JUNE_2021_MS + DAY_MS - 1;
        let before = JUNE_2021_MS + 2 * DAY_MS - 1;

        let mut stand = archive(None, Vec::new());
        stand.fill = one_minute(JUNE_2021_MS + DAY_MS);
        let seen = stand.seen.clone();
        let inside = fetcher(stand, shards.path()).await;
        let fill = inside
            .fill_bar("BTCUSDT", after, before)
            .await
            .unwrap()
            .expect("the first minute after the close");
        assert_eq!(fill.kline.open_time, JUNE_2021_MS + DAY_MS);
        assert_eq!(fill.route, ENDPOINT_ROUTE);
        assert_eq!(fill.retrieval_ns, NOW_NS);
        let (headers, query) = seen.lock().unwrap()[0].clone();
        assert!(
            query.contains(&format!("startTime={}", after + 1))
                && query.contains("limit=1")
                && query.contains("interval=1m"),
            "{query}"
        );
        assert!(!headers.contains_key("x-mbx-apikey"));
        assert!(!query.contains("signature"));

        let mut late = archive(None, Vec::new());
        late.fill = one_minute(before);
        let at_next = fetcher(late, shards.path()).await;
        assert_eq!(
            at_next.fill_bar("BTCUSDT", after, before).await.unwrap(),
            None,
            "a bar opening at the next frame's event is not inside the gap"
        );

        let mut at_availability = archive(None, Vec::new());
        at_availability.fill = one_minute(after);
        let at_d = fetcher(at_availability, shards.path()).await;
        assert_eq!(
            at_d.fill_bar("BTCUSDT", after, before).await.unwrap(),
            None,
            "a bar opening at the availability instant itself is not strictly after it"
        );
    }

    #[tokio::test]
    async fn the_gap_follows_the_bindings_lag_to_the_nanosecond_and_needs_a_lag_after_close() {
        let shards = ShardDir::new();
        let execution = vec![FetchedBarV1 {
            kline: serde_json::from_value::<Vec<BinanceFuturesKline>>(one_minute(JUNE_2021_MS))
                .map(|mut klines| {
                    let mut kline = klines.remove(0);
                    kline.close_time = JUNE_2021_MS + DAY_MS - 1;
                    kline
                })
                .unwrap(),
            retrieval_ns: NOW_NS,
            route: ARCHIVE_ROUTE,
        }];
        let stand = archive(None, Vec::new());
        let seen = stand.seen.clone();
        let fetcher = fetcher(stand, shards.path()).await;
        let rule = |visibility| UntrustedSourceAvailabilityRuleV1 {
            visibility,
            publishes_corrections: false,
        };

        // 1.5 ms after the close: the first whole millisecond strictly after it is close + 2.
        fetcher
            .fill_bars(
                "BTCUSDT",
                &execution,
                &rule(UntrustedSourceVisibilityV1::AfterBarClose { lag_ns: 1_500_000 }),
                JUNE_2021_MS + 2 * DAY_MS,
            )
            .await
            .unwrap();
        let query = seen.lock().unwrap()[0].1.clone();
        assert!(
            query.contains(&format!("startTime={}", JUNE_2021_MS + DAY_MS + 2)),
            "{query}"
        );

        assert_eq!(
            fetcher
                .fill_bars(
                    "BTCUSDT",
                    &execution,
                    &rule(UntrustedSourceVisibilityV1::AtRetrieval),
                    JUNE_2021_MS + 2 * DAY_MS,
                )
                .await,
            Err(VisionBackfillErrorV1::AvailabilityNotAfterBarClose),
        );
    }

    #[tokio::test]
    async fn a_fill_bar_still_open_when_retrieved_is_refused() {
        let shards = ShardDir::new();
        let now_ms = i64::try_from(NOW_NS / 1_000_000).unwrap();

        let mut stand = archive(None, Vec::new());
        stand.fill = one_minute(now_ms - 30_000);
        let fetcher = fetcher(stand, shards.path()).await;

        assert_eq!(
            fetcher
                .fill_bar("BTCUSDT", now_ms - 60_000, now_ms + 60_000)
                .await,
            Err(VisionBackfillErrorV1::FillBarNotClosed),
        );
    }

    #[tokio::test]
    async fn each_gap_asks_for_the_first_bar_after_its_close_and_lag_and_a_gap_without_one_is_left_out()
     {
        let shards = ShardDir::new();
        let lag_ms = 300_000;
        let availability = UntrustedSourceAvailabilityRuleV1 {
            visibility: UntrustedSourceVisibilityV1::AfterBarClose {
                lag_ns: 300_000_000_000,
            },
            publishes_corrections: false,
        };
        let execution: Vec<FetchedBarV1> = [JUNE_2021_MS, JUNE_2021_MS + DAY_MS]
            .into_iter()
            .map(|open_time| FetchedBarV1 {
                kline: serde_json::from_value::<Vec<BinanceFuturesKline>>(one_minute(open_time))
                    .map(|mut klines| {
                        let mut kline = klines.remove(0);
                        kline.close_time = open_time + DAY_MS - 1;
                        kline
                    })
                    .unwrap(),
                retrieval_ns: NOW_NS,
                route: ARCHIVE_ROUTE,
            })
            .collect();

        let mut stand = archive(None, Vec::new());
        stand.fill = one_minute(JUNE_2021_MS + DAY_MS + lag_ms + 60_000);
        let seen = stand.seen.clone();
        let fetcher = fetcher(stand, shards.path()).await;

        let fills = fetcher
            .fill_bars(
                "BTCUSDT",
                &execution,
                &availability,
                JUNE_2021_MS + 3 * DAY_MS,
            )
            .await
            .unwrap();

        assert_eq!(
            fills
                .iter()
                .map(|fill| fill.kline.open_time)
                .collect::<Vec<_>>(),
            vec![JUNE_2021_MS + DAY_MS + lag_ms + 60_000],
            "the second gap, bounded by the window's end, has no bar"
        );
        let starts: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|(_, query)| query.clone())
            .collect();
        assert_eq!(starts.len(), 2);
        assert!(starts[0].contains(&format!("startTime={}", JUNE_2021_MS + DAY_MS + lag_ms + 1)));
        assert!(starts[1].contains(&format!(
            "startTime={}",
            JUNE_2021_MS + 2 * DAY_MS + lag_ms + 1
        )));
    }

    #[rstest]
    fn a_client_holding_a_credential_is_refused() {
        let endpoint = BinanceFuturesHttpClient::new(
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
        .unwrap();
        assert_eq!(
            VisionBackfillFetcherV1::new(endpoint, "/nonexistent").unwrap_err(),
            VisionBackfillErrorV1::CredentialPresent
        );
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::common::enums::BinanceEnvironment;

    /// Reads one real month of settled funding, including a near-zero rate the venue prints in
    /// scientific notation (`BTCUSDT-fundingRate-2020-01.zip`'s row 12, `8.4E-7`) -
    /// `funding_archive_v1.rs`'s own `parse_funding_rate` must accept both notations or this
    /// whole month would be refused.
    #[tokio::test]
    #[ignore = "reaches the live public Binance archive"]
    async fn live_funding_month() {
        let shards =
            std::env::temp_dir().join(format!("funding-backfill-live-{}", std::process::id()));
        let endpoint = BinanceFuturesHttpClient::new(
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
        .unwrap();
        let fetcher = VisionBackfillFetcherV1::new(endpoint, &shards).unwrap();
        let month = fetcher
            .funding_month("BTCUSDT", 2020, 1)
            .await
            .expect("a real archived month, including its scientific-notation rows, is read");
        assert_eq!(month.rows.len(), 93);
        let _ = std::fs::remove_dir_all(&shards);
    }

    /// Reads a headerless and a headed month from the real archive, and one real fill bar.
    #[tokio::test]
    #[ignore = "reaches the live public Binance archive and endpoint"]
    async fn live_archive_months_and_a_fill_bar() {
        let shards =
            std::env::temp_dir().join(format!("vision-backfill-live-{}", std::process::id()));
        let endpoint = BinanceFuturesHttpClient::new(
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
        .unwrap();
        let fetcher = VisionBackfillFetcherV1::new(endpoint, &shards).unwrap();

        for (year, month, days) in [(2021, 6, 30), (2025, 12, 31)] {
            let bars = fetcher
                .execution_month("BTCUSDT", BinanceKlineInterval::Day1, year, month)
                .await
                .unwrap_or_else(|e| panic!("{year}-{month:02}: {e}"));
            assert_eq!(bars.len(), days, "{year}-{month:02} has one bar per day");
            eprintln!(
                "live {year}-{month:02}: {} bars, first close {}",
                bars.len(),
                bars[0].kline.close
            );
        }
        // The first minute after 2021-06-01's daily close.
        let close = 1_622_591_999_999;
        let fill = fetcher
            .fill_bar("BTCUSDT", close, close + 86_400_000)
            .await
            .unwrap()
            .expect("the venue traded in the minute after the close");
        assert_eq!(fill.kline.open_time, close + 1);
        eprintln!(
            "live fill bar open {} at {}",
            fill.kline.open, fill.kline.open_time
        );
        let _ = std::fs::remove_dir_all(&shards);
    }
}
