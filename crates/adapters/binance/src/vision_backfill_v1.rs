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
use vibe_network::http::HttpClient;

use crate::{
    common::{
        enums::{BinanceKlineInterval, BinanceProductType},
        offline::{
            BinanceVisionArchiveBinding, archive_digest, authenticate_monthly_klines,
            sidecar_digest,
        },
    },
    futures::http::{
        client::BinanceFuturesHttpClient, models::BinanceFuturesKline, query::BinanceKlinesParams,
    },
};

/// The route a row fetched from the public archive names in its custody evidence.
pub const ARCHIVE_ROUTE: &str = "binance-vision-archive";
/// The route a row fetched from the public `klines` endpoint names in its custody evidence.
pub const ENDPOINT_ROUTE: &str = "binance-usdm-endpoint";
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
}

impl Display for VisionBackfillErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
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
        Ok(klines
            .iter()
            .map(|kline| FetchedBarV1 {
                kline: kline.clone(),
                retrieval_ns,
                route: ARCHIVE_ROUTE,
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
    /// after the bar's close plus `availability_lag_ms`, and strictly before the next execution
    /// bar's close, or before `window_end_ms` for the last. A gap the venue has no bar in is left
    /// out. `availability_lag_ms` must be the lag the Source Binding's availability rule declares.
    ///
    /// # Errors
    ///
    /// Returns the first [`VisionBackfillErrorV1`] a gap's [`Self::fill_bar`] call returns.
    pub async fn fill_bars(
        &self,
        symbol: &str,
        execution: &[FetchedBarV1],
        availability_lag_ms: i64,
        window_end_ms: i64,
    ) -> Result<Vec<FetchedBarV1>, VisionBackfillErrorV1> {
        let mut closes: Vec<i64> = execution
            .iter()
            .map(|bar| bar.kline.close_time.saturating_add(1))
            .collect();
        closes.sort_unstable();
        let mut fills = Vec::new();

        for (index, close) in closes.iter().enumerate() {
            let before = closes.get(index + 1).copied().unwrap_or(window_end_ms);

            if let Some(fill) = self
                .fill_bar(symbol, close.saturating_add(availability_lag_ms), before)
                .await?
            {
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
            .fill_bars("BTCUSDT", &execution, lag_ms, JUNE_2021_MS + 3 * DAY_MS)
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
