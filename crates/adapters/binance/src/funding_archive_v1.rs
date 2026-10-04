//! Fetches a Binance USD-M perpetual's settled funding history from the public Vision archive.
//!
//! Each monthly archive is `<SYMBOL>-fundingRate-<YYYY>-<MM>.zip` under
//! `data/futures/um/monthly/fundingRate/<SYMBOL>/`, checked against the `.CHECKSUM` sidecar the
//! same host serves, exactly as the kline archive is in `vision_backfill_v1.rs`. Its one CSV
//! member carries three columns: `calc_time` (the settlement instant, milliseconds since the
//! Unix epoch), `funding_interval_hours` (the venue's own stated interval for that settlement,
//! not a guess this reader makes), and `last_funding_rate` (the venue's decimal as published).
//! Verified empirically against the real archive: `BTCUSDT-fundingRate-2024-01.zip`'s header is
//! exactly `calc_time,funding_interval_hours,last_funding_rate`.

use std::io::{Cursor, Read};

use rust_decimal::Decimal;
use zip::{CompressionMethod, ZipArchive};

use crate::common::offline::{BinanceVisionArchiveError, archive_digest, sidecar_digest};

/// One settlement as the public monthly funding-rate archive publishes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FundingArchiveRowV1 {
    /// The settlement instant, in nanoseconds since the Unix epoch.
    pub settlement_ns: u64,
    /// The venue's own stated interval for this settlement, in hours.
    pub interval_hours: u8,
    /// The venue's funding rate for this settlement, exact and as published.
    pub rate: Decimal,
}

const MAX_ARCHIVE_BYTES: u64 = 1_048_576;
const MAX_MEMBER_BYTES: u64 = 4_194_304;
const FUNDING_HEADER: &str = "calc_time,funding_interval_hours,last_funding_rate";

/// Authenticates and parses one product-bound official Binance Vision monthly funding-rate
/// archive for `symbol` over `year`/`month`.
///
/// # Errors
///
/// Returns a typed error for a malformed symbol, a checksum mismatch, invalid ZIP topology, or a
/// row that is not the archive's own exact three-column schema. No partial result is returned.
pub fn authenticate_monthly_funding(
    symbol: &str,
    year: i32,
    month: u8,
    archive_bytes: &[u8],
    sidecar_bytes: &[u8],
) -> Result<Vec<FundingArchiveRowV1>, BinanceVisionArchiveError> {
    if symbol.is_empty()
        || !symbol
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
    {
        return Err(BinanceVisionArchiveError::InvalidBinding(format!(
            "invalid canonical Binance symbol {symbol:?}"
        )));
    }

    if !(1..=12).contains(&month) {
        return Err(BinanceVisionArchiveError::InvalidBinding(format!(
            "invalid calendar month {month}"
        )));
    }

    if archive_bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(BinanceVisionArchiveError::ArchiveTooLarge {
            actual: archive_bytes.len(),
            limit: MAX_ARCHIVE_BYTES as usize,
        });
    }
    let archive_name = format!("{symbol}-fundingRate-{year:04}-{month:02}.zip");
    let member_name = format!("{symbol}-fundingRate-{year:04}-{month:02}.csv");

    let declared = sidecar_digest(sidecar_bytes, &archive_name)?;
    if archive_digest(archive_bytes) != declared {
        return Err(BinanceVisionArchiveError::ArchiveDigestMismatch {
            expected: declared,
            actual: archive_digest(archive_bytes),
        });
    }
    let csv_bytes = read_single_funding_csv_member(&member_name, archive_bytes)?;
    parse_funding_csv(&csv_bytes)
}

fn read_single_funding_csv_member(
    member_name: &str,
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
        if member.name() != member_name
            || member.enclosed_name().as_deref() != Some(std::path::Path::new(member_name))
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

fn parse_funding_csv(
    csv_bytes: &[u8],
) -> Result<Vec<FundingArchiveRowV1>, BinanceVisionArchiveError> {
    let text =
        std::str::from_utf8(csv_bytes).map_err(|_| BinanceVisionArchiveError::InvalidCsv {
            row: 0,
            message: "CSV is not valid UTF-8".to_string(),
        })?;
    let mut lines = text.lines();
    let header = lines.next().ok_or(BinanceVisionArchiveError::InvalidCsv {
        row: 0,
        message: "archive CSV member is empty".to_string(),
    })?;

    if header.trim() != FUNDING_HEADER {
        return Err(BinanceVisionArchiveError::InvalidCsv {
            row: 0,
            message: format!("unexpected header {header:?}"),
        });
    }
    let mut rows = Vec::new();
    let mut previous_settlement_ns: Option<u64> = None;

    for (index, line) in lines.enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let row = index + 2; // one-based, past the header
        let mut fields = line.split(',');
        let (Some(calc_time), Some(interval_hours), Some(rate), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Err(BinanceVisionArchiveError::InvalidCsv {
                row,
                message: "expected exactly three fields".to_string(),
            });
        };
        let calc_time_ms: i64 =
            calc_time
                .parse()
                .map_err(|_| BinanceVisionArchiveError::InvalidNumeric {
                    row,
                    field: "calc_time",
                    value: calc_time.to_string(),
                })?;
        let settlement_ns = u64::try_from(calc_time_ms)
            .ok()
            .and_then(|millis| millis.checked_mul(1_000_000))
            .ok_or(BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "calc_time",
                value: calc_time.to_string(),
            })?;
        let interval_hours: u8 =
            interval_hours
                .parse()
                .map_err(|_| BinanceVisionArchiveError::InvalidNumeric {
                    row,
                    field: "funding_interval_hours",
                    value: interval_hours.to_string(),
                })?;

        if interval_hours == 0 {
            return Err(BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "funding_interval_hours",
                value: "0".to_string(),
            });
        }
        let rate =
            parse_funding_rate(rate).ok_or_else(|| BinanceVisionArchiveError::InvalidNumeric {
                row,
                field: "last_funding_rate",
                value: rate.to_string(),
            })?;

        if previous_settlement_ns.is_some_and(|previous| settlement_ns <= previous) {
            return Err(BinanceVisionArchiveError::InvalidTemporalSemantics {
                row,
                message: "settlements are not in strictly ascending time".to_string(),
            });
        }
        previous_settlement_ns = Some(settlement_ns);
        rows.push(FundingArchiveRowV1 {
            settlement_ns,
            interval_hours,
            rate,
        });
    }
    Ok(rows)
}

/// The archive's `last_funding_rate` field, read exactly: plain decimal notation
/// (`-0.00012359`) the common way, and scientific notation (`8.4E-7`, verified empirically
/// against the real `BTCUSDT-fundingRate-2020-01.zip` archive, row 12 - a near-zero rate the
/// venue prints this way rather than as a leading-zero decimal) through [`Decimal::from_scientific`],
/// which is exact rather than rounding. `Decimal::from_str_exact` alone rejects the scientific
/// form outright, so a real archive month containing one near-zero rate would otherwise refuse
/// the whole month.
fn parse_funding_rate(value: &str) -> Option<Decimal> {
    Decimal::from_str_exact(value)
        .ok()
        .or_else(|| Decimal::from_scientific(value).ok())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// `BTCUSDT-fundingRate-2024-01.zip`'s first three real rows, fetched and verified against
    /// this archive's own published `.CHECKSUM` sidecar: the header and every field's shape.
    #[rstest]
    fn the_real_archive_header_and_row_shape_parse() {
        let csv = "calc_time,funding_interval_hours,last_funding_rate\n\
                    1704067200000,8,0.00037409\n\
                    1704096000000,8,0.00027213\n\
                    1704124800000,8,0.00033601\n";
        let rows = parse_funding_csv(csv.as_bytes()).expect("parses");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].settlement_ns, 1_704_067_200_000_000_000);
        assert_eq!(rows[0].interval_hours, 8);
        assert_eq!(rows[0].rate, Decimal::from_str_exact("0.00037409").unwrap());
        // Every settlement is exactly one 8-hour interval after its predecessor.
        assert_eq!(
            rows[1].settlement_ns - rows[0].settlement_ns,
            8 * 3_600 * 1_000_000_000
        );
    }

    /// `BTCUSDT-fundingRate-2020-01.zip`'s real row 12: a near-zero rate the venue prints in
    /// scientific notation rather than as a leading-zero decimal.
    #[rstest]
    fn a_scientific_notation_rate_parses_exactly() {
        let csv = "calc_time,funding_interval_hours,last_funding_rate\n\
                    1704067200000,8,8.4E-7\n";
        let rows = parse_funding_csv(csv.as_bytes()).expect("parses");
        assert_eq!(rows[0].rate, Decimal::from_scientific("8.4E-7").unwrap());
        assert_eq!(rows[0].rate.to_string(), "0.00000084");
    }

    #[rstest]
    fn a_non_ascending_settlement_is_refused() {
        let csv = "calc_time,funding_interval_hours,last_funding_rate\n\
                    1704096000000,8,0.00027213\n\
                    1704067200000,8,0.00037409\n";
        assert!(matches!(
            parse_funding_csv(csv.as_bytes()),
            Err(BinanceVisionArchiveError::InvalidTemporalSemantics { .. })
        ));
    }

    #[rstest]
    fn a_zero_interval_is_refused() {
        let csv = "calc_time,funding_interval_hours,last_funding_rate\n\
                    1704067200000,0,0.00037409\n";
        assert!(matches!(
            parse_funding_csv(csv.as_bytes()),
            Err(BinanceVisionArchiveError::InvalidNumeric {
                field: "funding_interval_hours",
                ..
            })
        ));
    }

    #[rstest]
    fn a_wrong_header_is_refused() {
        let csv = "calc_time,funding_interval_hours,wrong_column\n1704067200000,8,0.1\n";
        assert!(matches!(
            parse_funding_csv(csv.as_bytes()),
            Err(BinanceVisionArchiveError::InvalidCsv { row: 0, .. })
        ));
    }
}
