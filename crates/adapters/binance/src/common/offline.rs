//! Authenticated offline adapters for official Binance Vision archives.

use std::{
    fmt::Display,
    io::{Cursor, Read},
    path::Path,
    sync::Arc,
};

use anyhow::Context;
use aws_lc_rs::digest;
use rust_decimal::Decimal;
use serde::Serialize;
use time::{Date, Month};
use ustr::Ustr;
use vibe_core::{
    UnixNanos, hex,
    paths::custody::{open_custodied_directory, read_bounded_regular_at},
};
use vibe_data::dataset::CanonicalDatasetManifest;
use vibe_model::{
    data::{Bar, BarType, CustomData, CustomDataTrait, DataType, HasTsInit},
    enums::PriceType,
    identifiers::{InstrumentId, Symbol},
    instruments::{Instrument, InstrumentAny},
};
use zip::{CompressionMethod, ZipArchive};

use super::{
    enums::{BinanceKlineInterval, BinanceProductType},
    parse::{
        SpotKlineRow, bar_spec_to_binance_interval, millis_to_micros, normalize_spot_kline_rows,
        parse_klines_to_bars,
    },
    symbol::format_instrument_id,
};
use crate::spot::http::models::BinanceKlines;
use crate::{
    common::consts::BINANCE_VENUE,
    futures::http::{client::parse_futures_kline_binance_bar, models::BinanceFuturesKline},
};

const SHA256_BYTES: usize = 32;
const MAX_ARCHIVE_BYTES: usize = 1_048_576;
const MAX_MEMBER_BYTES: u64 = 4_194_304;
const MONTHLY_KLINE_DATASET_CONTRACT: &str = "binance-vision-monthly-klines-v1";
const DAY_MILLIS: i64 = 86_400_000;
const USD_M_HEADER: &str = "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore";
const BINANCE_VISION_NON_EXECUTABLE_KLINE_TYPE_NAME: &str = "BinanceVisionNonExecutableKlineV1";
#[cfg(test)]
const HOUR_MILLIS: i64 = 3_600_000;
#[cfg(test)]
const CLOSED_HOUR_MILLIS: i64 = HOUR_MILLIS - 1;

/// A validated SHA-256 digest used by the archive binding.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Sha256Digest([u8; SHA256_BYTES]);

impl Sha256Digest {
    /// Parses a canonical lowercase SHA-256 hex digest.
    ///
    /// # Errors
    ///
    /// Returns an error when `value` is not exactly 64 lowercase hexadecimal characters.
    pub fn parse(value: &str) -> Result<Self, BinanceVisionArchiveError> {
        if value.len() != SHA256_BYTES * 2
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(BinanceVisionArchiveError::InvalidDigest(value.to_string()));
        }
        let bytes = hex::decode(value)
            .map_err(|_| BinanceVisionArchiveError::InvalidDigest(value.to_string()))?;
        let bytes: [u8; SHA256_BYTES] = bytes
            .try_into()
            .map_err(|_| BinanceVisionArchiveError::InvalidDigest(value.to_string()))?;
        Ok(Self(bytes))
    }

    /// Returns the canonical lowercase hexadecimal representation.
    #[must_use]
    pub fn to_hex(self) -> String {
        hex::encode(self.0)
    }
}

impl Display for Sha256Digest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&hex::encode(self.0))
    }
}

/// Immutable trusted identity for one Binance Vision monthly kline archive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BinanceVisionArchiveBinding {
    archive_name: String,
    member_name: String,
    archive_sha256: Sha256Digest,
    sidecar_sha256: Option<Sha256Digest>,
    product: BinanceProductType,
    symbol: String,
    interval: BinanceKlineInterval,
    month_start_millis: i64,
    next_month_start_millis: i64,
}

impl BinanceVisionArchiveBinding {
    /// Constructs and validates an explicit archive binding.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed names, digests, symbols, or unsupported interval semantics.
    pub fn new(
        archive_name: impl Into<String>,
        member_name: impl Into<String>,
        archive_sha256: &str,
        sidecar_sha256: Option<&str>,
        product: BinanceProductType,
        symbol: impl Into<String>,
        interval: BinanceKlineInterval,
    ) -> Result<Self, BinanceVisionArchiveError> {
        if !matches!(product, BinanceProductType::Spot | BinanceProductType::UsdM) {
            return Err(BinanceVisionArchiveError::InvalidBinding(
                "Vision product must be Spot or USD-M".to_string(),
            ));
        }
        let archive_name = archive_name.into();
        let member_name = member_name.into();
        let symbol = symbol.into();
        let (month_start_millis, next_month_start_millis) =
            validate_binding_names(&archive_name, &member_name, &symbol, product, interval)?;

        Ok(Self {
            archive_name,
            member_name,
            archive_sha256: Sha256Digest::parse(archive_sha256)?,
            sidecar_sha256: sidecar_sha256.map(Sha256Digest::parse).transpose()?,
            product,
            symbol,
            interval,
            month_start_millis,
            next_month_start_millis,
        })
    }

    /// Returns the bound Binance product.
    #[must_use]
    pub const fn product(&self) -> BinanceProductType {
        self.product
    }

    /// Returns the expected archive filename.
    #[must_use]
    pub fn archive_name(&self) -> &str {
        &self.archive_name
    }

    /// Returns the expected CSV member filename.
    #[must_use]
    pub fn member_name(&self) -> &str {
        &self.member_name
    }

    /// Returns the bound venue symbol.
    #[must_use]
    pub fn symbol(&self) -> &str {
        &self.symbol
    }

    /// Returns the bound kline interval.
    #[must_use]
    pub const fn interval(&self) -> BinanceKlineInterval {
        self.interval
    }
}

/// One authenticated absence between consecutive source rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BinanceVisionKlineGap {
    /// Open time immediately before the gap, in microseconds.
    pub after_open_time_micros: i64,
    /// Open time of the next actual source row, in microseconds.
    pub next_open_time_micros: i64,
    /// Count of absent one-hour source rows.
    pub missing_intervals: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct BinanceVisionNonExecutableKlineV1 {
    archive_sha256: String,
    sidecar_sha256: String,
    product: String,
    symbol: String,
    interval: String,
    source_open_time_ns: u64,
    source_close_time_ns: u64,
    open: String,
    high: String,
    low: String,
    close: String,
    non_executable_reason: &'static str,
    availability_semantics: &'static str,
    execution_authority: &'static str,
}

impl HasTsInit for BinanceVisionNonExecutableKlineV1 {
    fn ts_init(&self) -> UnixNanos {
        UnixNanos::from(self.source_close_time_ns)
    }
}

impl CustomDataTrait for BinanceVisionNonExecutableKlineV1 {
    fn type_name(&self) -> &'static str {
        BINANCE_VISION_NON_EXECUTABLE_KLINE_TYPE_NAME
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn ts_event(&self) -> UnixNanos {
        UnixNanos::from(self.source_close_time_ns)
    }

    fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }

    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other.as_any().downcast_ref::<Self>() == Some(self)
    }
}

/// An authenticated zero-volume source row which confers no executable Bar authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BinanceVisionZeroVolumeObservation {
    open_time_micros: i64,
    close_time_micros: i64,
    open: String,
    high: String,
    low: String,
    close: String,
}

impl BinanceVisionZeroVolumeObservation {
    /// Returns the source row open time in microseconds.
    #[must_use]
    pub const fn open_time_micros(&self) -> i64 {
        self.open_time_micros
    }

    /// Returns the observed, possibly truncated, close time in microseconds.
    #[must_use]
    pub const fn close_time_micros(&self) -> i64 {
        self.close_time_micros
    }

    /// Returns the exact source OHLC decimal strings.
    #[must_use]
    pub fn ohlc(&self) -> (&str, &str, &str, &str) {
        (&self.open, &self.high, &self.low, &self.close)
    }
}

/// Provenance and source-shape observations authenticated before normalization.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BinanceVisionArchiveMetadata {
    binding: BinanceVisionArchiveBinding,
    sidecar_sha256: Sha256Digest,
    total_rows: usize,
    normalized_rows: usize,
    zero_volume_rows: usize,
    first_open_time_micros: i64,
    last_open_time_micros: i64,
    gaps: Vec<BinanceVisionKlineGap>,
}

impl BinanceVisionArchiveMetadata {
    /// Returns the immutable trusted binding authenticated by this result.
    #[must_use]
    pub const fn binding(&self) -> &BinanceVisionArchiveBinding {
        &self.binding
    }

    /// Returns the authenticated archive digest.
    #[must_use]
    pub const fn archive_sha256(&self) -> Sha256Digest {
        self.binding.archive_sha256
    }

    /// Returns the actual sidecar digest.
    #[must_use]
    pub const fn sidecar_sha256(&self) -> Sha256Digest {
        self.sidecar_sha256
    }

    /// Returns the authenticated member name.
    #[must_use]
    pub fn member_name(&self) -> &str {
        &self.binding.member_name
    }

    /// Returns the total authenticated source row count.
    #[must_use]
    pub const fn total_rows(&self) -> usize {
        self.total_rows
    }

    /// Returns the count of rows admitted to ordinary kline normalization.
    #[must_use]
    pub const fn normalized_rows(&self) -> usize {
        self.normalized_rows
    }

    /// Returns the count of separated non-executable zero-volume observations.
    #[must_use]
    pub const fn zero_volume_rows(&self) -> usize {
        self.zero_volume_rows
    }

    /// Returns the first source open time in microseconds.
    #[must_use]
    pub const fn first_open_time_micros(&self) -> i64 {
        self.first_open_time_micros
    }

    /// Returns the last source open time in microseconds.
    #[must_use]
    pub const fn last_open_time_micros(&self) -> i64 {
        self.last_open_time_micros
    }

    /// Returns authenticated missing intervals without synthesizing rows.
    #[must_use]
    pub fn gaps(&self) -> &[BinanceVisionKlineGap] {
        &self.gaps
    }
}

/// Authenticated ordinary klines and separately retained zero-volume observations.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthenticatedBinanceVisionKlines {
    metadata: BinanceVisionArchiveMetadata,
    klines: AuthenticatedKlines,
    zero_volume_observations: Vec<BinanceVisionZeroVolumeObservation>,
}

#[derive(Clone, Debug, PartialEq)]
enum AuthenticatedKlines {
    Spot(BinanceKlines),
    UsdM(Vec<BinanceFuturesKline>),
}

/// Non-constructible result of authenticating one dataset.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthenticatedBinanceVisionDataset {
    digest: String,
    archives: Vec<AuthenticatedBinanceVisionKlines>,
}

impl AuthenticatedBinanceVisionDataset {
    /// Returns the authenticated archives in manifest order.
    #[must_use]
    pub fn archives(&self) -> &[AuthenticatedBinanceVisionKlines] {
        &self.archives
    }

    /// Returns the validated source and consumer projection digest.
    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthlyKlineDatasetManifest {
    identity: String,
    objects: Vec<MonthlyKlineDatasetObject>,
    schema_version: u32,
    source_contract: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct MonthlyKlineDatasetObject {
    interval: BinanceKlineInterval,
    name: String,
    product: BinanceProductType,
    sha256: String,
    sidecar_sha256: String,
    symbol: String,
}

#[derive(Debug)]
struct BinanceVisionDatasetProjection {
    digest: String,
    objects: Vec<(String, BinanceVisionArchiveBinding)>,
}

fn project_monthly_kline_dataset(
    manifest: &CanonicalDatasetManifest,
    range: std::ops::Range<usize>,
) -> anyhow::Result<BinanceVisionDatasetProjection> {
    let range_identity = (range.start, range.end);
    let source: MonthlyKlineDatasetManifest = serde_json::from_slice(manifest.canonical_bytes())?;
    anyhow::ensure!(
        source.schema_version == 1
            && !source.identity.is_empty()
            && source.source_contract == MONTHLY_KLINE_DATASET_CONTRACT,
        "Binance Vision dataset contract mismatch"
    );
    let objects = source
        .objects
        .get(range)
        .context("Binance Vision dataset range is invalid")?;
    anyhow::ensure!(!objects.is_empty(), "Binance Vision dataset range is empty");
    let digest = format!(
        "blake3:{}",
        blake3::hash(&serde_json::to_vec(&(
            source.schema_version,
            &source.identity,
            &source.source_contract,
            range_identity,
            objects
        ))?)
        .to_hex()
    );
    anyhow::ensure!(
        objects.is_sorted_by(|a, b| a.name < b.name),
        "dataset objects are not strictly ordered"
    );
    let projected = objects
        .iter()
        .map(|object| -> anyhow::Result<_> {
            anyhow::ensure!(
                Path::new(&object.name)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_))),
                "unsafe dataset object path"
            );
            let archive_name = object.name.rsplit('/').next().unwrap_or(&object.name);
            let member_name = format!("{}.csv", archive_name.trim_end_matches(".zip"));
            Ok((
                object.name.clone(),
                BinanceVisionArchiveBinding::new(
                    archive_name,
                    member_name,
                    &object.sha256,
                    Some(&object.sidecar_sha256),
                    object.product,
                    &object.symbol,
                    object.interval,
                )?,
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(BinanceVisionDatasetProjection {
        digest,
        objects: projected,
    })
}

/// Returns a validated source and consumer digest without authenticating source bytes.
/// # Errors
/// Returns an error for invalid contract, range, path, order, or archive binding.
pub fn monthly_kline_dataset_digest(
    manifest: &CanonicalDatasetManifest,
    range: std::ops::Range<usize>,
) -> anyhow::Result<String> {
    Ok(project_monthly_kline_dataset(manifest, range)?.digest)
}

/// Authenticates one monthly-kline manifest range.
/// # Errors
/// Returns an error for any unavailable, unsafe, or unauthenticated object.
pub fn authenticate_monthly_kline_dataset(
    manifest: &CanonicalDatasetManifest,
    root: &Path,
    range: std::ops::Range<usize>,
) -> anyhow::Result<AuthenticatedBinanceVisionDataset> {
    let projection = project_monthly_kline_dataset(manifest, range)?;
    let root = open_custodied_directory(root)?;
    let mut archives = Vec::with_capacity(projection.objects.len());
    for (path, binding) in &projection.objects {
        let archive = read_bounded_regular_at(&root, Path::new(path), MAX_ARCHIVE_BYTES as u64)?;
        let sidecar = read_bounded_regular_at(&root, Path::new(&format!("{path}.CHECKSUM")), 256)?;
        archives.push(authenticate_monthly_klines(binding, &archive, &sidecar)?);
    }

    Ok(AuthenticatedBinanceVisionDataset {
        digest: projection.digest,
        archives,
    })
}

impl AuthenticatedBinanceVisionKlines {
    /// Returns authenticated archive metadata.
    #[must_use]
    pub const fn metadata(&self) -> &BinanceVisionArchiveMetadata {
        &self.metadata
    }

    /// Returns source rows deliberately excluded from executable Bar normalization.
    #[must_use]
    pub fn zero_volume_observations(&self) -> &[BinanceVisionZeroVolumeObservation] {
        &self.zero_volume_observations
    }

    /// Projects authenticated zero-volume observations into non-executable custom data.
    /// # Errors
    /// Returns an error when timestamp conversion or payload serialization fails.
    pub fn non_executable_kline_custom_data(&self) -> anyhow::Result<Vec<CustomData>> {
        self.zero_volume_observations
            .iter()
            .map(|observation| {
                let binding = self.metadata().binding();
                let source_open_time_ns =
                    UnixNanos::from_micros_checked(observation.open_time_micros())
                        .context("source open time does not fit nanoseconds")?
                        .as_u64();
                let source_close_time_ns =
                    UnixNanos::from_micros_checked(observation.close_time_micros())
                        .context("source close time does not fit nanoseconds")?
                        .as_u64();
                let (open, high, low, close) = observation.ohlc();
                let event = BinanceVisionNonExecutableKlineV1 {
                    archive_sha256: self.metadata().archive_sha256().to_hex(),
                    sidecar_sha256: self.metadata().sidecar_sha256().to_hex(),
                    product: binding.product().to_string(),
                    symbol: binding.symbol().to_string(),
                    interval: binding.interval().as_str().to_string(),
                    source_open_time_ns,
                    source_close_time_ns,
                    open: open.to_string(),
                    high: high.to_string(),
                    low: low.to_string(),
                    close: close.to_string(),
                    non_executable_reason: "ZERO_VOLUME",
                    availability_semantics: "NOT_PIT_ARCHIVE_REPLAY_SOURCE_CLOSE",
                    execution_authority: "NONE",
                };
                let mut metadata = vibe_core::Params::new();
                metadata.insert(
                    "provider".to_string(),
                    serde_json::Value::String("BINANCE_VISION".to_string()),
                );
                metadata.insert(
                    "product".to_string(),
                    serde_json::Value::String(binding.product().to_string()),
                );
                metadata.insert(
                    "symbol".to_string(),
                    serde_json::Value::String(binding.symbol().to_string()),
                );
                metadata.insert(
                    "interval".to_string(),
                    serde_json::Value::String(binding.interval().as_str().to_string()),
                );
                let data_type = DataType::new(
                    BINANCE_VISION_NON_EXECUTABLE_KLINE_TYPE_NAME,
                    Some(metadata),
                    Some(format!(
                        "BINANCE_VISION/{}/{}/{}",
                        binding.product(),
                        binding.symbol(),
                        binding.interval().as_str()
                    )),
                );
                Ok(CustomData::new(Arc::new(event), data_type))
            })
            .collect()
    }

    /// Converts authenticated ordinary rows through the existing Binance Bar owner.
    ///
    /// # Errors
    ///
    /// Returns an error unless the consumer instrument and externally aggregated standard Bar
    /// type exactly match the authenticated symbol and interval.
    pub fn parse_bars(
        &self,
        bar_type: BarType,
        instrument: &InstrumentAny,
        ts_init: UnixNanos,
    ) -> Result<Vec<Bar>, BinanceVisionArchiveError> {
        let binding = &self.metadata.binding;
        let expected_instrument_id = match binding.product {
            BinanceProductType::Spot => {
                InstrumentId::new(Symbol::from(binding.symbol.as_str()), *BINANCE_VENUE)
            }
            BinanceProductType::UsdM => format_instrument_id(
                &Ustr::from(binding.symbol.as_str()),
                BinanceProductType::UsdM,
            ),
            _ => unreachable!("binding constructor restricts Vision products"),
        };
        let compatible_product = matches!(
            (binding.product, instrument),
            (BinanceProductType::Spot, InstrumentAny::CurrencyPair(_))
                | (
                    BinanceProductType::UsdM,
                    InstrumentAny::CryptoPerpetual(_) | InstrumentAny::PerpetualContract(_)
                )
        );

        if !compatible_product || instrument.venue() != *BINANCE_VENUE {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(
                "instrument type must match the bound Binance product".to_string(),
            ));
        }

        if !bar_type.is_standard() || !bar_type.is_externally_aggregated() {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(
                "BarType must be standard and externally aggregated".to_string(),
            ));
        }

        if instrument.id() != expected_instrument_id
            || bar_type.instrument_id() != expected_instrument_id
        {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(
                "instrument and BarType IDs must match the authenticated Binance product symbol"
                    .to_string(),
            ));
        }

        if instrument.raw_symbol().as_str() != binding.symbol {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(format!(
                "instrument raw symbol {:?} does not match authenticated symbol {:?}",
                instrument.raw_symbol().as_str(),
                binding.symbol
            )));
        }

        if bar_type.spec().price_type != PriceType::Last {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(
                "Binance Vision klines require PriceType::Last".to_string(),
            ));
        }

        let consumer_would_round = match &self.klines {
            AuthenticatedKlines::Spot(klines) => klines.klines.iter().any(|kline| {
                [
                    kline.open_price,
                    kline.high_price,
                    kline.low_price,
                    kline.close_price,
                ]
                .into_iter()
                .any(|mantissa| {
                    !decimal_fits_precision(
                        i128::from(mantissa),
                        klines.price_exponent,
                        instrument.price_precision(),
                    )
                }) || !decimal_fits_precision(
                    i128::from_le_bytes(kline.volume),
                    klines.qty_exponent,
                    instrument.size_precision(),
                )
            }),
            AuthenticatedKlines::UsdM(klines) => klines.iter().any(|kline| {
                [&kline.open, &kline.high, &kline.low, &kline.close]
                    .into_iter()
                    .any(|value| !decimal_text_fits_precision(value, instrument.price_precision()))
                    || !decimal_text_fits_precision(&kline.volume, instrument.size_precision())
            }),
        };

        if consumer_would_round {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(
                "instrument precision would round authenticated price or volume data".to_string(),
            ));
        }
        let interval = bar_spec_to_binance_interval(bar_type.spec())
            .map_err(|e| BinanceVisionArchiveError::InvalidBarConsumer(e.to_string()))?;
        if interval != binding.interval {
            return Err(BinanceVisionArchiveError::InvalidBarConsumer(format!(
                "BarType interval {} does not match authenticated interval {}",
                interval.as_str(),
                binding.interval.as_str()
            )));
        }

        match &self.klines {
            AuthenticatedKlines::Spot(klines) => {
                parse_klines_to_bars(klines, bar_type, instrument, ts_init)
                    .map_err(|e| BinanceVisionArchiveError::BarConversion(e.to_string()))
            }
            AuthenticatedKlines::UsdM(klines) => klines
                .iter()
                .map(|kline| {
                    parse_futures_kline_binance_bar(
                        kline,
                        bar_type,
                        instrument.price_precision(),
                        instrument.size_precision(),
                        ts_init,
                    )
                    .map(|bar| bar.bar())
                    .map_err(|e| BinanceVisionArchiveError::BarConversion(e.to_string()))
                })
                .collect(),
        }
    }
}

fn decimal_fits_precision(mantissa: i128, exponent: i8, precision: u8) -> bool {
    let Ok(scale) = u32::try_from(-i32::from(exponent)) else {
        return false;
    };
    let decimal = Decimal::from_i128_with_scale(mantissa, scale);
    decimal.round_dp(u32::from(precision)) == decimal
}

fn decimal_text_fits_precision(value: &str, precision: u8) -> bool {
    value
        .parse::<Decimal>()
        .is_ok_and(|decimal| decimal.round_dp(u32::from(precision)) == decimal)
}

/// Fail-closed Binance Vision archive authentication and parsing errors.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BinanceVisionArchiveError {
    /// A bound SHA-256 digest is not canonical.
    #[error("invalid canonical SHA-256 digest: {0}")]
    InvalidDigest(String),
    /// The explicit trusted binding is internally inconsistent or unsupported.
    #[error("invalid archive binding: {0}")]
    InvalidBinding(String),
    /// The sidecar bytes do not match their optional trusted digest.
    #[error("sidecar SHA-256 mismatch: expected {expected}, actual {actual}")]
    SidecarDigestMismatch {
        /// Trusted sidecar digest.
        expected: Sha256Digest,
        /// Actual sidecar digest.
        actual: Sha256Digest,
    },
    /// The checksum sidecar is not one exact canonical entry for the archive.
    #[error("invalid checksum sidecar: {0}")]
    InvalidSidecar(String),
    /// The archive bytes do not match the trusted and sidecar-declared digest.
    #[error("archive SHA-256 mismatch: expected {expected}, actual {actual}")]
    ArchiveDigestMismatch {
        /// Trusted archive digest.
        expected: Sha256Digest,
        /// Actual archive digest.
        actual: Sha256Digest,
    },
    /// Compressed bytes exceed the bounded monthly archive limit.
    #[error("archive byte length {actual} exceeds limit {limit}")]
    ArchiveTooLarge {
        /// Observed archive byte length.
        actual: usize,
        /// Maximum archive byte length.
        limit: usize,
    },
    /// ZIP structure or decoding is invalid.
    #[error("invalid ZIP archive: {0}")]
    InvalidZip(String),
    /// ZIP member topology does not contain exactly one supported regular CSV member.
    #[error("unsupported ZIP topology: {0}")]
    UnsupportedZipTopology(String),
    /// Decompressed CSV exceeds the bounded monthly member limit.
    #[error("CSV member byte length {actual} exceeds limit {limit}")]
    MemberTooLarge {
        /// Observed or declared member byte length.
        actual: u64,
        /// Maximum member byte length.
        limit: u64,
    },
    /// CSV decoding or its exact 12-field schema failed.
    #[error("invalid CSV row {row}: {message}")]
    InvalidCsv {
        /// One-based source row, or zero for archive-level CSV failures.
        row: usize,
        /// Failure details.
        message: String,
    },
    /// A numeric field was malformed or negative.
    #[error("invalid numeric field {field} at row {row}: {value}")]
    InvalidNumeric {
        /// One-based source row.
        row: usize,
        /// Official field name.
        field: &'static str,
        /// Rejected source value.
        value: String,
    },
    /// Source event times violate the frozen hourly ordering or bounds.
    #[error("invalid temporal semantics at row {row}: {message}")]
    InvalidTemporalSemantics {
        /// One-based source row.
        row: usize,
        /// Failure details.
        message: String,
    },
    /// Source OHLC values are internally inconsistent.
    #[error("invalid OHLC invariants at row {row}")]
    InvalidOhlc {
        /// One-based source row.
        row: usize,
    },
    /// A zero-volume row contains contradictory executable evidence.
    #[error("ambiguous zero-volume observation at row {row}: {message}")]
    ZeroVolumeAmbiguity {
        /// One-based source row.
        row: usize,
        /// Contradictory evidence.
        message: String,
    },
    /// No authenticated source row can enter the executable kline path.
    #[error("archive contains no executable ordinary kline rows")]
    NoExecutableKlines,
    /// A Bar consumer attempts to relabel authenticated source authority.
    #[error("invalid authenticated Bar consumer: {0}")]
    InvalidBarConsumer(String),
    /// Existing Binance Bar conversion rejected bound authenticated rows.
    #[error("Binance Bar conversion failed: {0}")]
    BarConversion(String),
    /// Existing Binance kline normalization rejected the authenticated ordinary rows.
    #[error("Binance kline normalization failed: {0}")]
    Normalization(String),
}

/// Authenticates and parses one product-bound official Binance Vision monthly kline archive.
///
/// Zero-volume source rows are retained only as non-executable observations and are never passed
/// to the ordinary [`BinanceKlines`] normalization used by the existing Bar route.
///
/// # Errors
///
/// Returns a typed error for any binding, checksum, ZIP, CSV, ordering, temporal, numeric, or
/// normalization failure. No partial result is returned.
pub fn authenticate_monthly_klines(
    binding: &BinanceVisionArchiveBinding,
    archive_bytes: &[u8],
    sidecar_bytes: &[u8],
) -> Result<AuthenticatedBinanceVisionKlines, BinanceVisionArchiveError> {
    if archive_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(BinanceVisionArchiveError::ArchiveTooLarge {
            actual: archive_bytes.len(),
            limit: MAX_ARCHIVE_BYTES,
        });
    }

    let actual_sidecar_sha256 = sha256(sidecar_bytes);
    if let Some(expected) = binding.sidecar_sha256
        && actual_sidecar_sha256 != expected
    {
        return Err(BinanceVisionArchiveError::SidecarDigestMismatch {
            expected,
            actual: actual_sidecar_sha256,
        });
    }

    let declared_archive_sha256 = parse_sidecar(sidecar_bytes, &binding.archive_name)?;
    if declared_archive_sha256 != binding.archive_sha256 {
        return Err(BinanceVisionArchiveError::InvalidSidecar(format!(
            "declared digest {declared_archive_sha256} differs from trusted digest {}",
            binding.archive_sha256
        )));
    }

    let actual_archive_sha256 = sha256(archive_bytes);
    if actual_archive_sha256 != binding.archive_sha256 {
        return Err(BinanceVisionArchiveError::ArchiveDigestMismatch {
            expected: binding.archive_sha256,
            actual: actual_archive_sha256,
        });
    }

    let csv_bytes = read_single_csv_member(binding, archive_bytes)?;
    parse_authenticated_csv(binding, actual_sidecar_sha256, &csv_bytes)
}

fn validate_binding_names(
    archive_name: &str,
    member_name: &str,
    symbol: &str,
    product: BinanceProductType,
    interval: BinanceKlineInterval,
) -> Result<(i64, i64), BinanceVisionArchiveError> {
    if interval_millis(interval).is_none() {
        return Err(BinanceVisionArchiveError::InvalidBinding(format!(
            "only 15m, 1h, 4h, and 1d monthly contracts are supported, received {}",
            interval.as_str()
        )));
    }

    if symbol.is_empty()
        || !symbol
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
    {
        return Err(BinanceVisionArchiveError::InvalidBinding(format!(
            "invalid canonical Binance symbol {symbol:?}"
        )));
    }

    if !is_single_component(archive_name) || !is_single_component(member_name) {
        return Err(BinanceVisionArchiveError::InvalidBinding(
            "archive and member names must be single path components".to_string(),
        ));
    }
    let stem = archive_name.strip_suffix(".zip").ok_or_else(|| {
        BinanceVisionArchiveError::InvalidBinding("archive name must end in .zip".to_string())
    })?;

    if member_name != format!("{stem}.csv") {
        return Err(BinanceVisionArchiveError::InvalidBinding(
            "member name must equal the archive stem plus .csv".to_string(),
        ));
    }
    let prefix = format!("{symbol}-{}-", interval.as_str());
    let month = stem.strip_prefix(&prefix).ok_or_else(|| {
        BinanceVisionArchiveError::InvalidBinding(
            "archive name does not bind the declared symbol and interval".to_string(),
        )
    })?;
    let numeric_year = month.get(0..4).and_then(|value| value.parse::<i32>().ok());
    let numeric_month = month.get(5..7).and_then(|value| value.parse::<u8>().ok());
    let valid_month = month.len() == 7
        && month.as_bytes()[0..4].iter().all(u8::is_ascii_digit)
        && month.as_bytes()[4] == b'-'
        && month.as_bytes()[5..7].iter().all(u8::is_ascii_digit)
        && numeric_month.is_some_and(|value| (1..=12).contains(&value));

    if !valid_month {
        return Err(BinanceVisionArchiveError::InvalidBinding(
            "archive name must contain a canonical YYYY-MM month".to_string(),
        ));
    }

    if numeric_year.is_none_or(|year| product == BinanceProductType::Spot && year >= 2025) {
        return Err(BinanceVisionArchiveError::InvalidBinding(
            "millisecond Spot archive binding is limited to pre-2025 months".to_string(),
        ));
    }
    let year = numeric_year.ok_or_else(|| {
        BinanceVisionArchiveError::InvalidBinding("archive year is invalid".to_string())
    })?;
    let month = Month::try_from(numeric_month.expect("validated month number")).map_err(|_| {
        BinanceVisionArchiveError::InvalidBinding("archive month is invalid".to_string())
    })?;
    let start = Date::from_calendar_date(year, month, 1)
        .map_err(|e| BinanceVisionArchiveError::InvalidBinding(e.to_string()))?;
    let (next_year, next_month) = if month == Month::December {
        (
            year.checked_add(1).ok_or_else(|| {
                BinanceVisionArchiveError::InvalidBinding("archive year overflowed".to_string())
            })?,
            Month::January,
        )
    } else {
        (
            year,
            Month::try_from(u8::from(month) + 1).expect("next month is valid"),
        )
    };
    let next = Date::from_calendar_date(next_year, next_month, 1)
        .map_err(|e| BinanceVisionArchiveError::InvalidBinding(e.to_string()))?;
    let start_millis = i64::try_from(
        start.midnight().assume_utc().unix_timestamp_nanos() / 1_000_000,
    )
    .map_err(|_| {
        BinanceVisionArchiveError::InvalidBinding("archive month start overflowed".to_string())
    })?;
    let next_millis = i64::try_from(
        next.midnight().assume_utc().unix_timestamp_nanos() / 1_000_000,
    )
    .map_err(|_| {
        BinanceVisionArchiveError::InvalidBinding("archive month end overflowed".to_string())
    })?;
    Ok((start_millis, next_millis))
}

const fn interval_millis(interval: BinanceKlineInterval) -> Option<i64> {
    match interval {
        BinanceKlineInterval::Minute15 => Some(15 * 60 * 1_000),
        BinanceKlineInterval::Hour1 => Some(60 * 60 * 1_000),
        BinanceKlineInterval::Hour4 => Some(4 * 60 * 60 * 1_000),
        BinanceKlineInterval::Day1 => Some(DAY_MILLIS),
        _ => None,
    }
}

fn is_single_component(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(['/', '\\', '\0'])
        && Path::new(value).file_name().and_then(|name| name.to_str()) == Some(value)
}

fn sha256(bytes: &[u8]) -> Sha256Digest {
    let digest = digest::digest(&digest::SHA256, bytes);
    let bytes: [u8; SHA256_BYTES] = digest
        .as_ref()
        .try_into()
        .expect("SHA-256 output length is fixed");
    Sha256Digest(bytes)
}

fn parse_sidecar(
    bytes: &[u8],
    archive_name: &str,
) -> Result<Sha256Digest, BinanceVisionArchiveError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        BinanceVisionArchiveError::InvalidSidecar("sidecar is not UTF-8".to_string())
    })?;
    let line = text.strip_suffix('\n').unwrap_or(text);
    if line.contains(['\n', '\r']) {
        return Err(BinanceVisionArchiveError::InvalidSidecar(
            "sidecar must contain exactly one LF-terminated or unterminated entry".to_string(),
        ));
    }
    let (digest, name) = line.split_once("  ").ok_or_else(|| {
        BinanceVisionArchiveError::InvalidSidecar(
            "entry must use '<sha256><two spaces><archive name>'".to_string(),
        )
    })?;

    if name != archive_name || name.contains("  ") {
        return Err(BinanceVisionArchiveError::InvalidSidecar(format!(
            "entry names {name:?}, expected {archive_name:?}"
        )));
    }
    Sha256Digest::parse(digest).map_err(|_| {
        BinanceVisionArchiveError::InvalidSidecar("entry digest is not canonical".to_string())
    })
}

fn read_single_csv_member(
    binding: &BinanceVisionArchiveBinding,
    archive_bytes: &[u8],
) -> Result<Vec<u8>, BinanceVisionArchiveError> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|e| BinanceVisionArchiveError::InvalidZip(e.to_string()))?;
    if archive.len() != 1 {
        return Err(BinanceVisionArchiveError::UnsupportedZipTopology(format!(
            "expected exactly one member, found {}",
            archive.len()
        )));
    }

    {
        let member = archive
            .by_index_raw(0)
            .map_err(|e| BinanceVisionArchiveError::InvalidZip(e.to_string()))?;
        if member.name() != binding.member_name
            || member.enclosed_name().as_deref() != Some(Path::new(&binding.member_name))
        {
            return Err(BinanceVisionArchiveError::UnsupportedZipTopology(format!(
                "unexpected or unsafe member {:?}",
                member.name()
            )));
        }

        if !member.is_file() || member.is_symlink() || member.encrypted() {
            return Err(BinanceVisionArchiveError::UnsupportedZipTopology(
                "member must be a regular, unencrypted file".to_string(),
            ));
        }

        if !matches!(
            member.compression(),
            CompressionMethod::Deflated | CompressionMethod::Stored
        ) {
            return Err(BinanceVisionArchiveError::UnsupportedZipTopology(format!(
                "unsupported compression method {:?}",
                member.compression()
            )));
        }

        if member.size() > MAX_MEMBER_BYTES {
            return Err(BinanceVisionArchiveError::MemberTooLarge {
                actual: member.size(),
                limit: MAX_MEMBER_BYTES,
            });
        }
    }

    let mut member = archive
        .by_index(0)
        .map_err(|e| BinanceVisionArchiveError::InvalidZip(e.to_string()))?;
    let mut bytes = Vec::with_capacity(usize::try_from(member.size()).unwrap_or_default());
    member
        .by_ref()
        .take(MAX_MEMBER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| BinanceVisionArchiveError::InvalidZip(e.to_string()))?;
    if bytes.len() as u64 > MAX_MEMBER_BYTES {
        return Err(BinanceVisionArchiveError::MemberTooLarge {
            actual: bytes.len() as u64,
            limit: MAX_MEMBER_BYTES,
        });
    }
    Ok(bytes)
}

fn parse_authenticated_csv(
    binding: &BinanceVisionArchiveBinding,
    sidecar_sha256: Sha256Digest,
    csv_bytes: &[u8],
) -> Result<AuthenticatedBinanceVisionKlines, BinanceVisionArchiveError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(false)
        .from_reader(csv_bytes);
    let mut ordinary_rows = Vec::new();
    let mut zero_volume_observations = Vec::new();
    let mut gaps = Vec::new();
    let mut previous_open_millis = None;
    let mut first_open_micros = None;
    let mut last_open_micros = None;
    let mut total_rows = 0usize;
    let interval_millis = interval_millis(binding.interval).ok_or_else(|| {
        BinanceVisionArchiveError::InvalidBinding("unsupported interval".to_string())
    })?;
    let max_monthly_rows = usize::try_from(31 * DAY_MILLIS / interval_millis)
        .expect("supported interval row bound fits usize");

    for (index, record) in reader.records().enumerate() {
        let row = index + 1;
        let record = record.map_err(|e| BinanceVisionArchiveError::InvalidCsv {
            row,
            message: e.to_string(),
        })?;

        if index == 0 && binding.product == BinanceProductType::UsdM {
            if !record.iter().eq(USD_M_HEADER.split(',')) {
                return Err(BinanceVisionArchiveError::InvalidCsv {
                    row,
                    message: "USD-M archive must begin with the exact official header".to_string(),
                });
            }

            continue;
        }
        total_rows += 1;
        if total_rows > max_monthly_rows {
            return Err(BinanceVisionArchiveError::InvalidCsv {
                row,
                message: format!("monthly row count exceeds {max_monthly_rows}"),
            });
        }

        if record.len() != 12 {
            return Err(BinanceVisionArchiveError::InvalidCsv {
                row,
                message: format!("expected exactly 12 fields, found {}", record.len()),
            });
        }

        let open_millis = parse_i64(&record, row, 0, "open_time")?;
        let close_millis = parse_i64(&record, row, 6, "close_time")?;
        let num_trades = parse_i64(&record, row, 8, "num_trades")?;
        let ignored = parse_i64(&record, row, 11, "ignore")?;

        if open_millis < 0 || close_millis < 0 || num_trades < 0 || ignored != 0 {
            let (field, value) = if open_millis < 0 {
                ("open_time", record[0].to_string())
            } else if close_millis < 0 {
                ("close_time", record[6].to_string())
            } else if num_trades < 0 {
                ("num_trades", record[8].to_string())
            } else {
                ("ignore", record[11].to_string())
            };
            return Err(BinanceVisionArchiveError::InvalidNumeric { row, field, value });
        }

        if open_millis % interval_millis != 0 {
            return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "open time is not aligned to the bound UTC interval".to_string(),
            });
        }

        if open_millis < binding.month_start_millis
            || open_millis >= binding.next_month_start_millis
            || close_millis < binding.month_start_millis
            || close_millis >= binding.next_month_start_millis
        {
            return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "source row lies outside the bound archive month".to_string(),
            });
        }

        if let Some(previous) = previous_open_millis {
            let delta = open_millis.checked_sub(previous).ok_or_else(|| {
                BinanceVisionArchiveError::InvalidTemporalSemantics {
                    row,
                    message: "open times are not strictly increasing".to_string(),
                }
            })?;

            if delta <= 0 {
                return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                    row,
                    message: "open times are duplicate or out of order".to_string(),
                });
            }

            if delta % interval_millis != 0 {
                return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                    row,
                    message: "open-time delta is not a whole number of bound intervals".to_string(),
                });
            }

            if delta > interval_millis {
                gaps.push(BinanceVisionKlineGap {
                    after_open_time_micros: millis_to_micros(previous)
                        .map_err(|e| normalization_error(e.to_string()))?,
                    next_open_time_micros: millis_to_micros(open_millis)
                        .map_err(|e| normalization_error(e.to_string()))?,
                    missing_intervals: u64::try_from(delta / interval_millis - 1).map_err(
                        |_| BinanceVisionArchiveError::InvalidTemporalSemantics {
                            row,
                            message: "missing interval count overflowed".to_string(),
                        },
                    )?,
                });
            }
        }
        previous_open_millis = Some(open_millis);

        let full_close = open_millis
            .checked_add(interval_millis - 1)
            .ok_or_else(|| BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "interval close time overflowed".to_string(),
            })?;

        if close_millis < open_millis || close_millis > full_close {
            return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "close time lies outside its bound source interval".to_string(),
            });
        }

        let open = parse_decimal(&record, row, 1, "open")?;
        let high = parse_decimal(&record, row, 2, "high")?;
        let low = parse_decimal(&record, row, 3, "low")?;
        let close = parse_decimal(&record, row, 4, "close")?;
        let volume = parse_nonnegative_decimal(&record, row, 5, "volume")?;
        let quote_volume = parse_nonnegative_decimal(&record, row, 7, "quote_volume")?;
        let taker_buy_base_volume =
            parse_nonnegative_decimal(&record, row, 9, "taker_buy_base_volume")?;
        let taker_buy_quote_volume =
            parse_nonnegative_decimal(&record, row, 10, "taker_buy_quote_volume")?;

        if open.is_sign_negative()
            || high.is_sign_negative()
            || low.is_sign_negative()
            || close.is_sign_negative()
        {
            return Err(BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "OHLC",
                value: "negative price".to_string(),
            });
        }

        if high < open || high < close || high < low || low > open || low > close {
            return Err(BinanceVisionArchiveError::InvalidOhlc { row });
        }

        let open_time_micros = convert_timestamp(open_millis, row)?;
        let close_time_micros = convert_timestamp(close_millis, row)?;
        first_open_micros.get_or_insert(open_time_micros);
        last_open_micros = Some(open_time_micros);

        if volume.is_zero() {
            if !quote_volume.is_zero()
                || !taker_buy_base_volume.is_zero()
                || !taker_buy_quote_volume.is_zero()
                || num_trades != 0
                || open != high
                || open != low
                || open != close
            {
                return Err(BinanceVisionArchiveError::ZeroVolumeAmbiguity {
                    row,
                    message: "row contains trades, volume, or price movement".to_string(),
                });
            }
            zero_volume_observations.push(BinanceVisionZeroVolumeObservation {
                open_time_micros,
                close_time_micros,
                open: record[1].to_string(),
                high: record[2].to_string(),
                low: record[3].to_string(),
                close: record[4].to_string(),
            });
            continue;
        }

        if taker_buy_base_volume > volume || taker_buy_quote_volume > quote_volume {
            return Err(BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "taker_buy_volume",
                value: "taker-buy volume exceeds total volume".to_string(),
            });
        }

        if close_millis != full_close {
            return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "ordinary kline is not a fully closed source interval".to_string(),
            });
        }

        if num_trades == 0 {
            return Err(BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "num_trades",
                value: record[8].to_string(),
            });
        }
        ordinary_rows.push(SpotKlineRow {
            open_time_micros,
            open: record[1].to_string(),
            high: record[2].to_string(),
            low: record[3].to_string(),
            close: record[4].to_string(),
            volume: record[5].to_string(),
            close_time_micros,
            quote_volume: record[7].to_string(),
            num_trades,
            taker_buy_base_volume: record[9].to_string(),
            taker_buy_quote_volume: record[10].to_string(),
        });
    }

    let first_open_time_micros =
        first_open_micros.ok_or_else(|| BinanceVisionArchiveError::InvalidCsv {
            row: 0,
            message: "archive contains no source rows".to_string(),
        })?;
    let last_open_time_micros = last_open_micros.expect("nonempty rows set last open time");
    let normalized_rows = ordinary_rows.len();
    let zero_volume_rows = zero_volume_observations.len();

    if ordinary_rows.is_empty() {
        return Err(BinanceVisionArchiveError::NoExecutableKlines);
    }
    let klines = match binding.product {
        BinanceProductType::Spot => AuthenticatedKlines::Spot(
            normalize_spot_kline_rows(ordinary_rows)
                .map_err(|e| normalization_error(e.to_string()))?,
        ),
        BinanceProductType::UsdM => AuthenticatedKlines::UsdM(
            ordinary_rows
                .into_iter()
                .map(|row| BinanceFuturesKline {
                    open_time: row.open_time_micros / 1_000,
                    open: row.open,
                    high: row.high,
                    low: row.low,
                    close: row.close,
                    volume: row.volume,
                    close_time: row.close_time_micros / 1_000,
                    quote_volume: row.quote_volume,
                    num_trades: row.num_trades,
                    taker_buy_base_volume: row.taker_buy_base_volume,
                    taker_buy_quote_volume: row.taker_buy_quote_volume,
                })
                .collect(),
        ),
        _ => unreachable!("binding constructor restricts Vision products"),
    };

    Ok(AuthenticatedBinanceVisionKlines {
        metadata: BinanceVisionArchiveMetadata {
            binding: binding.clone(),
            sidecar_sha256,
            total_rows,
            normalized_rows,
            zero_volume_rows,
            first_open_time_micros,
            last_open_time_micros,
            gaps,
        },
        klines,
        zero_volume_observations,
    })
}

fn parse_i64(
    record: &csv::StringRecord,
    row: usize,
    index: usize,
    field: &'static str,
) -> Result<i64, BinanceVisionArchiveError> {
    record[index]
        .parse::<i64>()
        .map_err(|_| BinanceVisionArchiveError::InvalidNumeric {
            row,
            field,
            value: record[index].to_string(),
        })
}

fn parse_decimal(
    record: &csv::StringRecord,
    row: usize,
    index: usize,
    field: &'static str,
) -> Result<Decimal, BinanceVisionArchiveError> {
    Decimal::from_str_exact(&record[index]).map_err(|_| BinanceVisionArchiveError::InvalidNumeric {
        row,
        field,
        value: record[index].to_string(),
    })
}

fn parse_nonnegative_decimal(
    record: &csv::StringRecord,
    row: usize,
    index: usize,
    field: &'static str,
) -> Result<Decimal, BinanceVisionArchiveError> {
    let value = parse_decimal(record, row, index, field)?;
    if value.is_sign_negative() {
        return Err(BinanceVisionArchiveError::InvalidNumeric {
            row,
            field,
            value: record[index].to_string(),
        });
    }
    Ok(value)
}

fn convert_timestamp(value: i64, row: usize) -> Result<i64, BinanceVisionArchiveError> {
    millis_to_micros(value).map_err(|e| BinanceVisionArchiveError::InvalidTemporalSemantics {
        row,
        message: e.to_string(),
    })
}

fn normalization_error(message: String) -> BinanceVisionArchiveError {
    BinanceVisionArchiveError::Normalization(message)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use std::io::{Cursor, Write};

    use vibe_model::{
        data::{BarSpecification, BarType, HasTsInit},
        enums::{AggregationSource, BarAggregation, PriceType},
        identifiers::InstrumentId,
        instruments::{
            Instrument, InstrumentAny,
            stubs::{
                crypto_future_btcusdt, crypto_perpetual_ethusdt, currency_pair_btcusdt,
                currency_pair_ethusdt,
            },
        },
        types::{Price, Quantity},
    };
    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::*;

    const ARCHIVE_NAME: &str = "BTCUSDT-1h-2023-03.zip";
    const MEMBER_NAME: &str = "BTCUSDT-1h-2023-03.csv";
    const T0: i64 = 1_677_628_800_000;

    fn canonical_dataset(
        identity: &str,
        objects: &serde_json::Value,
        source_contract: &str,
    ) -> CanonicalDatasetManifest {
        let mut bytes = serde_json::to_vec(&serde_json::json!({
            "identity": identity,
            "objects": objects,
            "schema_version": 1,
            "source_contract": source_contract,
        }))
        .unwrap();
        bytes.push(b'\n');
        CanonicalDatasetManifest::parse(&bytes).unwrap()
    }

    fn dataset_object(name: &str, interval: &str) -> serde_json::Value {
        serde_json::json!({
            "interval": interval,
            "name": name,
            "product": "SPOT",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "sidecar_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "symbol": "BTCUSDT",
        })
    }

    #[rstest]
    fn dataset_projection_rejects_contract_order_and_cross_interval_binding() {
        let wrong_contract = canonical_dataset(
            "dataset-fixture-v1",
            &serde_json::json!([dataset_object(ARCHIVE_NAME, "1h")]),
            "another-source-v1",
        );
        assert!(project_monthly_kline_dataset(&wrong_contract, 0..1).is_err());

        let wrong_order = canonical_dataset(
            "dataset-fixture-v1",
            &serde_json::json!([
                dataset_object("BTCUSDT-1h-2023-04.zip", "1h"),
                dataset_object(ARCHIVE_NAME, "1h")
            ]),
            MONTHLY_KLINE_DATASET_CONTRACT,
        );
        assert!(project_monthly_kline_dataset(&wrong_order, 0..2).is_err());

        let wrong_interval = canonical_dataset(
            "dataset-fixture-v1",
            &serde_json::json!([dataset_object(ARCHIVE_NAME, "4h")]),
            MONTHLY_KLINE_DATASET_CONTRACT,
        );
        assert!(project_monthly_kline_dataset(&wrong_interval, 0..1).is_err());

        let first = canonical_dataset(
            "dataset-fixture-v1",
            &serde_json::json!([dataset_object(ARCHIVE_NAME, "1h")]),
            MONTHLY_KLINE_DATASET_CONTRACT,
        );
        let changed_identity = canonical_dataset(
            "dataset-fixture-v2",
            &serde_json::json!([dataset_object(ARCHIVE_NAME, "1h")]),
            MONTHLY_KLINE_DATASET_CONTRACT,
        );
        assert_ne!(
            monthly_kline_dataset_digest(&first, 0..1).unwrap(),
            monthly_kline_dataset_digest(&changed_identity, 0..1).unwrap()
        );
    }

    fn row(open_time: i64, close_time: i64, volume: &str) -> String {
        let (quote_volume, trades, taker_base, taker_quote) = if volume == "0.00000000" {
            ("0.00000000", "0", "0.00000000", "0.00000000")
        } else {
            ("101.25000000", "4", "0.50000000", "50.50000000")
        };
        format!(
            "{open_time},100.00000000,102.00000000,99.00000000,101.00000000,{volume},{close_time},{quote_volume},{trades},{taker_base},{taker_quote},0"
        )
    }

    fn zero_row(open_time: i64, close_time: i64) -> String {
        format!(
            "{open_time},100.00000000,100.00000000,100.00000000,100.00000000,0.00000000,{close_time},0.00000000,0,0.00000000,0.00000000,0"
        )
    }

    fn fixture_csv() -> String {
        [
            row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
            zero_row(T0 + HOUR_MILLIS, T0 + HOUR_MILLIS + 2_381_646),
            row(
                T0 + 3 * HOUR_MILLIS,
                T0 + 3 * HOUR_MILLIS + CLOSED_HOUR_MILLIS,
                "2.00000000",
            ),
        ]
        .join("\n")
    }

    fn zip_members(members: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, contents) in members {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn bound_fixture(csv: &str) -> (BinanceVisionArchiveBinding, Vec<u8>, Vec<u8>) {
        let archive = zip_members(&[(MEMBER_NAME, csv)]);
        let archive_digest = sha256(&archive).to_hex();
        let sidecar = format!("{archive_digest}  {ARCHIVE_NAME}").into_bytes();
        let sidecar_digest = sha256(&sidecar).to_hex();
        let binding = BinanceVisionArchiveBinding::new(
            ARCHIVE_NAME,
            MEMBER_NAME,
            &archive_digest,
            Some(&sidecar_digest),
            BinanceProductType::Spot,
            "BTCUSDT",
            BinanceKlineInterval::Hour1,
        )
        .unwrap();
        (binding, archive, sidecar)
    }

    fn bound_usdm_fixture(
        interval: BinanceKlineInterval,
        csv: &str,
    ) -> (BinanceVisionArchiveBinding, Vec<u8>, Vec<u8>) {
        let stem = format!("ETHUSDT-{}-2023-03", interval.as_str());
        let archive_name = format!("{stem}.zip");
        let member_name = format!("{stem}.csv");
        let csv = format!("{USD_M_HEADER}\n{csv}");
        let archive = zip_members(&[(&member_name, &csv)]);
        let archive_digest = sha256(&archive).to_hex();
        let sidecar = format!("{archive_digest}  {archive_name}").into_bytes();
        let binding = BinanceVisionArchiveBinding::new(
            archive_name,
            member_name,
            &archive_digest,
            Some(&sha256(&sidecar).to_hex()),
            BinanceProductType::UsdM,
            "ETHUSDT",
            interval,
        )
        .unwrap();
        (binding, archive, sidecar)
    }

    fn bar_type_with_price_type(
        instrument: &InstrumentAny,
        aggregation: BarAggregation,
        price_type: PriceType,
    ) -> BarType {
        BarType::new(
            instrument.id(),
            BarSpecification::new(1, aggregation, price_type),
            AggregationSource::External,
        )
    }

    fn bar_type(instrument: &InstrumentAny, aggregation: BarAggregation) -> BarType {
        bar_type_with_price_type(instrument, aggregation, PriceType::Last)
    }

    fn stepped_bar_type(
        instrument: &InstrumentAny,
        step: usize,
        aggregation: BarAggregation,
    ) -> BarType {
        BarType::new(
            instrument.id(),
            BarSpecification::new(step, aggregation, PriceType::Last),
            AggregationSource::External,
        )
    }

    #[rstest]
    #[case(BinanceKlineInterval::Minute15, 15, BarAggregation::Minute)]
    #[case(BinanceKlineInterval::Hour1, 1, BarAggregation::Hour)]
    #[case(BinanceKlineInterval::Hour4, 4, BarAggregation::Hour)]
    #[case(BinanceKlineInterval::Day1, 1, BarAggregation::Day)]
    fn authenticates_usdm_intervals_with_product_bound_native_consumer(
        #[case] interval: BinanceKlineInterval,
        #[case] step: usize,
        #[case] aggregation: BarAggregation,
    ) {
        let close = T0 + interval_millis(interval).unwrap() - 1;
        let csv = format!("{T0},100.00,102.00,99.00,101.00,1.000,{close},101.25,4,0.500,50.50,0");
        let (binding, archive, sidecar) = bound_usdm_fixture(interval, &csv);
        let authenticated = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let instrument = InstrumentAny::CryptoPerpetual(crypto_perpetual_ethusdt());
        let bars = authenticated
            .parse_bars(
                stepped_bar_type(&instrument, step, aggregation),
                &instrument,
                UnixNanos::default(),
            )
            .unwrap();

        assert_eq!(binding.product(), BinanceProductType::UsdM);
        assert_eq!(bars.len(), 1);
        assert_eq!(bars[0].bar_type.instrument_id(), instrument.id());
    }

    #[rstest]
    fn rejects_unsupported_product_cross_product_and_usdm_shape() {
        let (_, archive, sidecar) = bound_usdm_fixture(
            BinanceKlineInterval::Hour1,
            &row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
        );
        let digest = sha256(&archive).to_hex();

        for (product, interval) in [
            (BinanceProductType::CoinM, BinanceKlineInterval::Hour1),
            (BinanceProductType::UsdM, BinanceKlineInterval::Hour2),
        ] {
            assert!(
                BinanceVisionArchiveBinding::new(
                    "ETHUSDT-1h-2023-03.zip",
                    "ETHUSDT-1h-2023-03.csv",
                    &digest,
                    Some(&sha256(&sidecar).to_hex()),
                    product,
                    "ETHUSDT",
                    interval,
                )
                .is_err()
            );
        }

        let (binding, archive, sidecar) = bound_usdm_fixture(
            BinanceKlineInterval::Hour1,
            &row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
        );
        let authenticated = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let spot = InstrumentAny::CurrencyPair(currency_pair_ethusdt());
        assert!(matches!(
            authenticated.parse_bars(
                bar_type(&spot, BarAggregation::Hour),
                &spot,
                UnixNanos::default(),
            ),
            Err(BinanceVisionArchiveError::InvalidBarConsumer(_))
        ));

        let stem = "ETHUSDT-1h-2023-03";
        let member_name = format!("{stem}.csv");
        let headerless_archive = zip_members(&[(
            &member_name,
            &row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
        )]);
        let headerless_digest = sha256(&headerless_archive).to_hex();
        let headerless_sidecar = format!("{headerless_digest}  {stem}.zip").into_bytes();
        let headerless_binding = BinanceVisionArchiveBinding::new(
            format!("{stem}.zip"),
            member_name,
            &headerless_digest,
            Some(&sha256(&headerless_sidecar).to_hex()),
            BinanceProductType::UsdM,
            "ETHUSDT",
            BinanceKlineInterval::Hour1,
        )
        .unwrap();
        assert!(matches!(
            authenticate_monthly_klines(
                &headerless_binding,
                &headerless_archive,
                &headerless_sidecar,
            ),
            Err(BinanceVisionArchiveError::InvalidCsv { row: 1, .. })
        ));

        let nonzero_ignore = format!(
            "{T0},100.00,102.00,99.00,101.00,1.000,{},101.25,4,0.500,50.50,123",
            T0 + CLOSED_HOUR_MILLIS
        );
        let (binding, archive, sidecar) =
            bound_usdm_fixture(BinanceKlineInterval::Hour1, &nonzero_ignore);
        assert!(matches!(
            authenticate_monthly_klines(&binding, &archive, &sidecar),
            Err(BinanceVisionArchiveError::InvalidNumeric {
                row: 2,
                field: "ignore",
                ..
            })
        ));

        let csv = format!(
            "{T0},100.001,102.00,99.00,101.00,1.000,{},101.25,4,0.500,50.50,0",
            T0 + CLOSED_HOUR_MILLIS
        );
        let (binding, archive, sidecar) = bound_usdm_fixture(BinanceKlineInterval::Hour1, &csv);
        let authenticated = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let perpetual = InstrumentAny::CryptoPerpetual(crypto_perpetual_ethusdt());
        assert!(matches!(
            authenticated.parse_bars(
                bar_type(&perpetual, BarAggregation::Hour),
                &perpetual,
                UnixNanos::default(),
            ),
            Err(BinanceVisionArchiveError::InvalidBarConsumer(_))
        ));

        let (binding, archive, sidecar) = bound_usdm_fixture(
            BinanceKlineInterval::Hour1,
            &row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
        );
        assert!(authenticate_monthly_klines(&binding, &archive, &sidecar).is_ok());
    }

    #[rstest]
    fn authenticates_normalizes_and_separates_zero_volume_without_gap_fill() {
        let (binding, archive, sidecar) = bound_fixture(&fixture_csv());
        let result = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();

        assert_eq!(result.metadata().total_rows(), 3);
        assert_eq!(result.metadata().normalized_rows(), 2);
        assert_eq!(result.metadata().zero_volume_rows(), 1);
        let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let bars = result
            .parse_bars(
                bar_type(&instrument, BarAggregation::Hour),
                &instrument,
                UnixNanos::default(),
            )
            .unwrap();
        assert_eq!(bars.len(), 2);
        assert_eq!(result.zero_volume_observations().len(), 1);
        let custom_rows = result.non_executable_kline_custom_data().unwrap();
        assert_eq!(custom_rows.len(), 1);
        let custom = &custom_rows[0];
        assert_eq!(custom.data.ts_event(), custom.ts_init());
        assert_eq!(
            custom.data_type.type_name(),
            BINANCE_VISION_NON_EXECUTABLE_KLINE_TYPE_NAME
        );
        assert_eq!(
            custom.data_type.identifier(),
            Some("BINANCE_VISION/SPOT/BTCUSDT/1h")
        );
        assert_eq!(
            custom.data_type.metadata_str(),
            r#"{"interval":"1h","product":"SPOT","provider":"BINANCE_VISION","symbol":"BTCUSDT"}"#
        );
        let serialized = serde_json::to_value(custom).unwrap();
        let payload = serialized.get("payload").expect("payload");
        assert_eq!(payload["non_executable_reason"], "ZERO_VOLUME");
        assert_eq!(
            payload["availability_semantics"],
            "NOT_PIT_ARCHIVE_REPLAY_SOURCE_CLOSE"
        );
        assert_eq!(payload["execution_authority"], "NONE");
        assert!(payload.get("source_gap").is_none());
        let first = serde_json::to_vec(custom).unwrap();
        let second = serde_json::to_vec(custom).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            result.zero_volume_observations()[0].open_time_micros(),
            (T0 + HOUR_MILLIS) * 1_000
        );
        assert_eq!(result.metadata().gaps().len(), 1);
        assert_eq!(result.metadata().gaps()[0].missing_intervals, 1);
    }

    #[rstest]
    fn bar_conversion_rejects_unbound_instrument_and_interval() {
        let (binding, archive, sidecar) = bound_fixture(&fixture_csv());
        let result = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let btc = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let eth = InstrumentAny::CurrencyPair(currency_pair_ethusdt());

        for (bar_type, instrument) in [
            (bar_type(&btc, BarAggregation::Hour), &eth),
            (bar_type(&eth, BarAggregation::Hour), &eth),
            (bar_type(&btc, BarAggregation::Minute), &btc),
        ] {
            assert!(matches!(
                result.parse_bars(bar_type, instrument, UnixNanos::default()),
                Err(BinanceVisionArchiveError::InvalidBarConsumer(_))
            ));
        }
    }

    #[rstest]
    fn bar_conversion_rejects_non_spot_non_binance_and_non_last_consumers() {
        let (binding, archive, sidecar) = bound_fixture(&fixture_csv());
        let result = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let btc = InstrumentAny::CurrencyPair(currency_pair_btcusdt());
        let future = InstrumentAny::CryptoFuture(crypto_future_btcusdt(
            2,
            6,
            Price::from("0.01"),
            Quantity::from("0.000001"),
        ));
        let mut kraken_pair = currency_pair_btcusdt();
        kraken_pair.id = InstrumentId::from("BTCUSDT.KRAKEN");
        let kraken = InstrumentAny::CurrencyPair(kraken_pair);
        let mut mislabeled_pair = currency_pair_btcusdt();
        mislabeled_pair.id = InstrumentId::from("ETHUSDT.BINANCE");
        let mislabeled = InstrumentAny::CurrencyPair(mislabeled_pair);

        for (bar_type, instrument) in [
            (bar_type(&future, BarAggregation::Hour), &future),
            (bar_type(&kraken, BarAggregation::Hour), &kraken),
            (bar_type(&mislabeled, BarAggregation::Hour), &mislabeled),
            (
                bar_type_with_price_type(&btc, BarAggregation::Hour, PriceType::Bid),
                &btc,
            ),
        ] {
            assert!(matches!(
                result.parse_bars(bar_type, instrument, UnixNanos::default()),
                Err(BinanceVisionArchiveError::InvalidBarConsumer(_))
            ));
        }
    }

    #[rstest]
    fn bar_conversion_rejects_consumer_precision_that_would_round_source_values() {
        for csv in [
            fixture_csv().replacen("100.00000000", "100.00100000", 1),
            fixture_csv().replacen("1.00000000", "1.00000010", 1),
        ] {
            let (binding, archive, sidecar) = bound_fixture(&csv);
            let result = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
            let instrument = InstrumentAny::CurrencyPair(currency_pair_btcusdt());

            assert!(matches!(
                result.parse_bars(
                    bar_type(&instrument, BarAggregation::Hour),
                    &instrument,
                    UnixNanos::default(),
                ),
                Err(BinanceVisionArchiveError::InvalidBarConsumer(_))
            ));
        }
    }

    #[rstest]
    fn rejects_archive_hash_mismatch_before_zip() {
        let (binding, mut archive, sidecar) = bound_fixture(&fixture_csv());
        archive[0] ^= 1;
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert!(matches!(
            e,
            BinanceVisionArchiveError::ArchiveDigestMismatch { .. }
        ));
    }

    #[rstest]
    fn rejects_extra_zip_member() {
        let csv = fixture_csv();
        let archive = zip_members(&[(MEMBER_NAME, &csv), ("extra.csv", &csv)]);
        let archive_digest = sha256(&archive).to_hex();
        let sidecar = format!("{archive_digest}  {ARCHIVE_NAME}").into_bytes();
        let binding = BinanceVisionArchiveBinding::new(
            ARCHIVE_NAME,
            MEMBER_NAME,
            &archive_digest,
            Some(&sha256(&sidecar).to_hex()),
            BinanceProductType::Spot,
            "BTCUSDT",
            BinanceKlineInterval::Hour1,
        )
        .unwrap();
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert!(matches!(
            e,
            BinanceVisionArchiveError::UnsupportedZipTopology(_)
        ));
    }

    #[rstest]
    fn rejects_malformed_schema() {
        let (binding, archive, sidecar) = bound_fixture("1,2,3");
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert!(matches!(
            e,
            BinanceVisionArchiveError::InvalidCsv { row: 1, .. }
        ));
    }

    #[rstest]
    fn rejects_header_row_as_malformed_numeric_data() {
        let csv = "open_time,open,high,low,close,volume,close_time,quote_volume,num_trades,taker_buy_base_volume,taker_buy_quote_volume,ignore";
        let (binding, archive, sidecar) = bound_fixture(csv);
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert!(matches!(
            e,
            BinanceVisionArchiveError::InvalidNumeric {
                row: 1,
                field: "open_time",
                ..
            }
        ));
    }

    #[rstest]
    fn rejects_wrong_sidecar_member_and_multiple_entries() {
        let (_binding, archive, sidecar) = bound_fixture(&fixture_csv());
        let digest = std::str::from_utf8(&sidecar)
            .unwrap()
            .split_once("  ")
            .unwrap()
            .0;

        for invalid in [
            format!("{digest}  OTHER.zip"),
            format!("{digest}  {ARCHIVE_NAME}\n{digest}  {ARCHIVE_NAME}"),
        ] {
            let binding_without_sidecar_digest = BinanceVisionArchiveBinding::new(
                ARCHIVE_NAME,
                MEMBER_NAME,
                &sha256(&archive).to_hex(),
                None,
                BinanceProductType::Spot,
                "BTCUSDT",
                BinanceKlineInterval::Hour1,
            )
            .unwrap();
            assert!(matches!(
                authenticate_monthly_klines(
                    &binding_without_sidecar_digest,
                    &archive,
                    invalid.as_bytes(),
                ),
                Err(BinanceVisionArchiveError::InvalidSidecar(_))
            ));
        }
    }

    #[rstest]
    fn rejects_duplicate_and_out_of_order_timestamps() {
        for second_open in [T0, T0 - HOUR_MILLIS] {
            let csv = [
                row(T0, T0 + CLOSED_HOUR_MILLIS, "1.00000000"),
                row(second_open, second_open + CLOSED_HOUR_MILLIS, "1.00000000"),
            ]
            .join("\n");
            let (binding, archive, sidecar) = bound_fixture(&csv);
            let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
            assert!(matches!(
                e,
                BinanceVisionArchiveError::InvalidTemporalSemantics { row: 2, .. }
            ));
        }
    }

    #[rstest]
    fn rejects_invalid_ohlc() {
        let csv = format!(
            "{T0},100.0,99.0,98.0,101.0,1.0,{},100.0,1,0.5,50.0,0",
            T0 + CLOSED_HOUR_MILLIS
        );
        let (binding, archive, sidecar) = bound_fixture(&csv);
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert_eq!(e, BinanceVisionArchiveError::InvalidOhlc { row: 1 });
    }

    #[rstest]
    fn rejects_all_zero_out_of_month_and_excess_taker_volume() {
        let all_zero = zero_row(T0, T0 + 2_381_646);
        let (binding, archive, sidecar) = bound_fixture(&all_zero);
        assert_eq!(
            authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err(),
            BinanceVisionArchiveError::NoExecutableKlines
        );

        let february_open = T0 - HOUR_MILLIS;
        let outside = row(
            february_open,
            february_open + CLOSED_HOUR_MILLIS,
            "1.00000000",
        );
        let (binding, archive, sidecar) = bound_fixture(&outside);
        assert!(matches!(
            authenticate_monthly_klines(&binding, &archive, &sidecar),
            Err(BinanceVisionArchiveError::InvalidTemporalSemantics { .. })
        ));

        let excess_taker = format!(
            "{T0},100.0,101.0,99.0,100.0,1.0,{},100.0,1,2.0,101.0,0",
            T0 + CLOSED_HOUR_MILLIS
        );
        let (binding, archive, sidecar) = bound_fixture(&excess_taker);
        assert!(matches!(
            authenticate_monthly_klines(&binding, &archive, &sidecar),
            Err(BinanceVisionArchiveError::InvalidNumeric {
                field: "taker_buy_volume",
                ..
            })
        ));
    }

    #[rstest]
    fn rejects_ambiguous_zero_volume_row() {
        let csv = format!(
            "{T0},100.0,101.0,100.0,101.0,0.0,{},0.0,0,0.0,0.0,0",
            T0 + CLOSED_HOUR_MILLIS
        );
        let (binding, archive, sidecar) = bound_fixture(&csv);
        let e = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap_err();
        assert!(matches!(
            e,
            BinanceVisionArchiveError::ZeroVolumeAmbiguity { row: 1, .. }
        ));
    }

    #[rstest]
    fn sidecar_failure_has_no_state_and_original_recovers() {
        let (binding, archive, sidecar) = bound_fixture(&fixture_csv());
        let mut wrong_sidecar = sidecar.clone();
        wrong_sidecar[0] = b'0';
        assert!(matches!(
            authenticate_monthly_klines(&binding, &archive, &wrong_sidecar),
            Err(BinanceVisionArchiveError::SidecarDigestMismatch { .. })
        ));
        assert!(authenticate_monthly_klines(&binding, &archive, &sidecar).is_ok());
    }

    #[rstest]
    #[ignore = "requires the separately downloaded official Binance Vision archive"]
    fn accepts_official_btcusdt_march_2023_archive() {
        let archive_path = std::env::var("BINANCE_VISION_ARCHIVE_PATH").unwrap();
        let sidecar_path = std::env::var("BINANCE_VISION_SIDECAR_PATH").unwrap();
        let archive = std::fs::read(archive_path).unwrap();
        let sidecar = std::fs::read(sidecar_path).unwrap();
        let binding = BinanceVisionArchiveBinding::new(
            ARCHIVE_NAME,
            MEMBER_NAME,
            "7f2afb8e0179a57ac31eab5205660298ba5eb77039ac2e21aef9b715ff3d06ce",
            Some("0723db47f2c7d886dc8c832edeeb6e4d72c3b8e0da9404e12a718b19f8dbe21b"),
            BinanceProductType::Spot,
            "BTCUSDT",
            BinanceKlineInterval::Hour1,
        )
        .unwrap();

        let result = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        assert_eq!(
            result.metadata().archive_sha256().to_hex(),
            "7f2afb8e0179a57ac31eab5205660298ba5eb77039ac2e21aef9b715ff3d06ce"
        );
        assert_eq!(
            result.metadata().sidecar_sha256().to_hex(),
            "0723db47f2c7d886dc8c832edeeb6e4d72c3b8e0da9404e12a718b19f8dbe21b"
        );
        assert_eq!(result.metadata().member_name(), MEMBER_NAME);
        assert_eq!(result.metadata().total_rows(), 743);
        assert_eq!(result.metadata().normalized_rows(), 742);
        assert_eq!(result.metadata().zero_volume_rows(), 1);
        assert_eq!(
            result.metadata().first_open_time_micros(),
            1_677_628_800_000_000
        );
        assert_eq!(
            result.metadata().last_open_time_micros(),
            1_680_303_600_000_000
        );
        assert_eq!(result.metadata().gaps().len(), 1);
        assert_eq!(result.metadata().gaps()[0].missing_intervals, 1);
        assert_eq!(
            result.zero_volume_observations()[0].open_time_micros(),
            1_679_659_200_000_000
        );
        assert_eq!(
            result.zero_volume_observations()[0].close_time_micros(),
            1_679_661_581_646_000
        );
        assert_eq!(
            result.metadata().gaps()[0].next_open_time_micros,
            1_679_666_400_000_000
        );
    }

    #[rstest]
    #[ignore = "requires the separately downloaded official Binance Vision USD-M archive"]
    fn accepts_official_ethusdt_usdm_march_2023_archive() {
        let archive =
            std::fs::read(std::env::var("BINANCE_VISION_USDM_ARCHIVE_PATH").unwrap()).unwrap();
        let sidecar =
            std::fs::read(std::env::var("BINANCE_VISION_USDM_SIDECAR_PATH").unwrap()).unwrap();
        let binding = BinanceVisionArchiveBinding::new(
            "ETHUSDT-1h-2023-03.zip",
            "ETHUSDT-1h-2023-03.csv",
            "4d5266f12a8a3394ee23516de99fc380e928dbdb79cbf083fd3ddc3242073790",
            Some("74ccbf067fc4822a272e41bff88b02c25d4d7cff2f97eed3fb9530826da08fe9"),
            BinanceProductType::UsdM,
            "ETHUSDT",
            BinanceKlineInterval::Hour1,
        )
        .unwrap();
        let authenticated = authenticate_monthly_klines(&binding, &archive, &sidecar).unwrap();
        let instrument = InstrumentAny::CryptoPerpetual(crypto_perpetual_ethusdt());
        let bars = authenticated
            .parse_bars(
                bar_type(&instrument, BarAggregation::Hour),
                &instrument,
                UnixNanos::default(),
            )
            .unwrap();

        assert_eq!(authenticated.metadata().total_rows(), 744);
        assert_eq!(authenticated.metadata().gaps(), []);
        assert_eq!(bars.len(), 744);
    }
}
