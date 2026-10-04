//! The venue bar store on the Market Data Owner's store (slice B1): three append-only tables -
//! bar versions, content conflicts and archive verifications (written by slice B2).

use std::{fmt::Debug, sync::Arc};

use rust_decimal::Decimal;
use sha2::{Digest as _, Sha256};
use sqlx::{Postgres, Row, Transaction};

use super::MarketDataOwnerPostgres;
use crate::owner::{
    bar_schedule::{ServedTimeframeV1, served_timeframe_v1},
    source_binding::BindingDigest,
    venue_bar_store_v1::{
        VENUE_BAR_SETTLE_DELAY_NS_V1, VenueBarArchiveV1, VenueBarAvailabilityV1,
        VenueBarCommitSummaryV1, VenueBarConflictV1, VenueBarCorrectionErrorV1,
        VenueBarOpenConflictV1, VenueBarReadErrorV1, VenueBarReadV1, VenueBarSourceV1,
        VenueBarStoreV1, VenueBarV1, VenueBarVerificationErrorV1, VenueBarVerificationSummaryV1,
        VenueBarWriteErrorV1, sealed,
    },
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.venue_bar_versions_v1 (instrument TEXT NOT NULL CHECK (instrument<>''), timeframe TEXT NOT NULL CHECK (timeframe<>''), open_ns BIGINT NOT NULL CHECK (open_ns>=0), version INTEGER NOT NULL CHECK (version>0), close_ns BIGINT NOT NULL CHECK (close_ns>open_ns), open NUMERIC NOT NULL, high NUMERIC NOT NULL, low NUMERIC NOT NULL, close NUMERIC NOT NULL, volume NUMERIC NOT NULL, quote_volume NUMERIC NOT NULL, trade_count BIGINT NOT NULL CHECK (trade_count>=0), taker_buy_volume NUMERIC NOT NULL, taker_buy_quote_volume NUMERIC NOT NULL, content_digest BYTEA NOT NULL CHECK (octet_length(content_digest)=32), source TEXT NOT NULL CHECK (source IN ('REST','CORRECTION')), retrieval_ns BIGINT NOT NULL CHECK (retrieval_ns>0), availability_ns BIGINT NOT NULL CHECK (availability_ns>0), corrects_conflict BYTEA CHECK (corrects_conflict IS NULL OR octet_length(corrects_conflict)=32), PRIMARY KEY (instrument, timeframe, open_ns, version), CHECK ((version=1)=(corrects_conflict IS NULL)))",
    "REVOKE ALL ON TABLE market_data_private.venue_bar_versions_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.venue_bar_conflicts_v1 (conflict_identity BYTEA PRIMARY KEY CHECK (octet_length(conflict_identity)=32), instrument TEXT NOT NULL, timeframe TEXT NOT NULL, open_ns BIGINT NOT NULL, stored_version INTEGER NOT NULL CHECK (stored_version>0), stored_digest BYTEA NOT NULL CHECK (octet_length(stored_digest)=32), offered_digest BYTEA NOT NULL CHECK (octet_length(offered_digest)=32), offered_side TEXT NOT NULL CHECK (offered_side<>''), offered_values TEXT NOT NULL, recorded_ns BIGINT NOT NULL CHECK (recorded_ns>0), FOREIGN KEY (instrument, timeframe, open_ns, stored_version) REFERENCES market_data_private.venue_bar_versions_v1(instrument, timeframe, open_ns, version))",
    "REVOKE ALL ON TABLE market_data_private.venue_bar_conflicts_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.venue_bar_verifications_v1 (instrument TEXT NOT NULL, timeframe TEXT NOT NULL, open_ns BIGINT NOT NULL, version INTEGER NOT NULL, archive_kind TEXT NOT NULL CHECK (archive_kind<>''), archive_identity BYTEA NOT NULL CHECK (octet_length(archive_identity)=32), verified_ns BIGINT NOT NULL CHECK (verified_ns>0), PRIMARY KEY (instrument, timeframe, open_ns, version, archive_kind), FOREIGN KEY (instrument, timeframe, open_ns, version) REFERENCES market_data_private.venue_bar_versions_v1(instrument, timeframe, open_ns, version))",
    "REVOKE ALL ON TABLE market_data_private.venue_bar_verifications_v1 FROM PUBLIC",
];

const CONTENT_DOMAIN: &[u8] = b"market-data.venue-bar-content.v1\0";
const CONFLICT_DOMAIN: &[u8] = b"market-data.venue-bar-conflict.v1\0";
const FIELDS: [&str; 10] = [
    "close_ns_exclusive",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "quote_volume",
    "trade_count",
    "taker_buy_volume",
    "taker_buy_quote_volume",
];

/// A bar's columns in canonical text, each decimal at its one normalized spelling, so one value
/// has one digest however the venue printed it.
fn canonical_columns(bar: &VenueBarV1) -> [String; 10] {
    let decimal = |value: Decimal| value.normalize().to_string();
    [
        bar.close_ns_exclusive.to_string(),
        decimal(bar.open),
        decimal(bar.high),
        decimal(bar.low),
        decimal(bar.close),
        decimal(bar.volume),
        decimal(bar.quote_volume),
        bar.trade_count.to_string(),
        decimal(bar.taker_buy_volume),
        decimal(bar.taker_buy_quote_volume),
    ]
}

fn digest(domain: &[u8], parts: &[&[u8]]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);

    for part in parts {
        hasher.update(u64::try_from(part.len()).unwrap_or(u64::MAX).to_be_bytes());
        hasher.update(part);
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn content_digest(bar: &VenueBarV1) -> BindingDigest {
    let columns = canonical_columns(bar);
    let parts: Vec<&[u8]> = columns.iter().map(String::as_bytes).collect();
    digest(CONTENT_DOMAIN, &parts)
}

/// Whether a bar's prices and volumes can be a bar: the low at or below the open, close and high,
/// the high at or above the open and close, a positive low, and volumes no smaller than their
/// taker-buy parts and never negative.
fn bar_is_consistent(bar: &VenueBarV1) -> bool {
    bar.low <= bar.open.min(bar.close)
        && bar.high >= bar.open.max(bar.close)
        && bar.low <= bar.high
        && bar.low > Decimal::ZERO
        && bar.volume >= Decimal::ZERO
        && bar.quote_volume >= Decimal::ZERO
        && bar.taker_buy_volume >= Decimal::ZERO
        && bar.taker_buy_quote_volume >= Decimal::ZERO
        && bar.taker_buy_volume <= bar.volume
        && bar.taker_buy_quote_volume <= bar.quote_volume
}

/// Every refusal a page can earn before any write, in the order a reader of its doc expects.
fn check_page(
    instrument: &str,
    timeframe: Option<ServedTimeframeV1>,
    retrieval_ns: u64,
    bars: &[VenueBarV1],
) -> Result<ServedTimeframeV1, VenueBarWriteErrorV1> {
    use VenueBarWriteErrorV1 as Refused;

    let timeframe = timeframe.ok_or(Refused::InvalidRequest)?;

    if instrument.is_empty()
        || bars.is_empty()
        || retrieval_ns == 0
        || bars
            .windows(2)
            .any(|pair| pair[0].open_ns >= pair[1].open_ns)
    {
        return Err(Refused::InvalidRequest);
    }

    for bar in bars {
        if timeframe.close_of(bar.open_ns) != Some(bar.close_ns_exclusive) {
            return Err(Refused::BarOffGrid {
                open_ns: bar.open_ns,
            });
        }

        if bar
            .close_ns_exclusive
            .checked_add(VENUE_BAR_SETTLE_DELAY_NS_V1)
            .is_none_or(|settled| settled > retrieval_ns)
        {
            return Err(Refused::BarNotSettled {
                open_ns: bar.open_ns,
            });
        }

        if !bar_is_consistent(bar) {
            return Err(Refused::BarInconsistent {
                open_ns: bar.open_ns,
            });
        }
    }
    Ok(timeframe)
}

fn to_i64(value: u64) -> Result<i64, VenueBarWriteErrorV1> {
    i64::try_from(value).map_err(|_| VenueBarWriteErrorV1::InvalidRequest)
}

/// The stored head version of one bar: its number and its columns.
struct StoredHeadV1 {
    version: u32,
    digest: BindingDigest,
    columns: [String; 10],
}

async fn load_head(
    transaction: &mut Transaction<'_, Postgres>,
    instrument: &str,
    timeframe: &str,
    open_ns: i64,
) -> Result<Option<StoredHeadV1>, sqlx::Error> {
    let Some(row) = sqlx::query(
        "SELECT version, close_ns, open, high, low, close, volume, quote_volume, trade_count, taker_buy_volume, taker_buy_quote_volume, content_digest FROM market_data_private.venue_bar_versions_v1 WHERE instrument=$1 AND timeframe=$2 AND open_ns=$3 ORDER BY version DESC LIMIT 1",
    )
    .bind(instrument)
    .bind(timeframe)
    .bind(open_ns)
    .fetch_optional(&mut **transaction)
    .await?
    else {
        return Ok(None);
    };
    let bar = bar_from_row(&row).map_err(|()| sqlx::Error::RowNotFound)?;
    let digest_bytes: Vec<u8> = row.try_get("content_digest")?;
    let digest = <[u8; 32]>::try_from(digest_bytes.as_slice())
        .map(BindingDigest::from_untrusted_bytes)
        .map_err(|_| sqlx::Error::RowNotFound)?;
    let version: i32 = row.try_get("version")?;
    Ok(Some(StoredHeadV1 {
        version: u32::try_from(version).map_err(|_| sqlx::Error::RowNotFound)?,
        digest,
        columns: canonical_columns(&bar),
    }))
}

/// Records, once per stored and offered content pair, that `offered` states the bar `key` names
/// differently from its stored `head`; nothing is overwritten.
async fn record_conflict(
    transaction: &mut Transaction<'_, Postgres>,
    (instrument, timeframe, open_ns): (&str, &str, u64),
    head: &StoredHeadV1,
    offered: &VenueBarV1,
    offered_side: &str,
    recorded_ns: u64,
) -> Result<VenueBarConflictV1, sqlx::Error> {
    let offered_digest = content_digest(offered);
    let columns = canonical_columns(offered);
    let conflict_identity = digest(
        CONFLICT_DOMAIN,
        &[
            instrument.as_bytes(),
            timeframe.as_bytes(),
            &open_ns.to_be_bytes(),
            head.digest.as_bytes(),
            offered_digest.as_bytes(),
        ],
    );
    let number = |value: u64| i64::try_from(value).map_err(|_| sqlx::Error::RowNotFound);
    sqlx::query(
        "INSERT INTO market_data_private.venue_bar_conflicts_v1 (conflict_identity, instrument, timeframe, open_ns, stored_version, stored_digest, offered_digest, offered_side, offered_values, recorded_ns) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (conflict_identity) DO NOTHING",
    )
    .bind(conflict_identity.as_bytes().as_slice())
    .bind(instrument)
    .bind(timeframe)
    .bind(number(open_ns)?)
    .bind(i32::try_from(head.version).map_err(|_| sqlx::Error::RowNotFound)?)
    .bind(head.digest.as_bytes().as_slice())
    .bind(offered_digest.as_bytes().as_slice())
    .bind(offered_side)
    .bind(columns.join(","))
    .bind(number(recorded_ns)?)
    .execute(&mut **transaction)
    .await?;
    Ok(VenueBarConflictV1 {
        conflict_identity,
        open_ns,
        stored_version: head.version,
        fields: FIELDS
            .iter()
            .zip(head.columns.iter().zip(columns.iter()))
            .filter(|(_, (stored, offered))| stored != offered)
            .map(|(field, _)| *field)
            .collect(),
    })
}

fn bar_from_row(row: &sqlx::postgres::PgRow) -> Result<VenueBarV1, ()> {
    let number = |column: &str| -> Result<u64, ()> {
        u64::try_from(row.try_get::<i64, _>(column).map_err(|_| ())?).map_err(|_| ())
    };
    let decimal = |column: &str| -> Result<Decimal, ()> { row.try_get(column).map_err(|_| ()) };
    Ok(VenueBarV1 {
        open_ns: number("open_ns").unwrap_or_default(),
        close_ns_exclusive: number("close_ns")?,
        open: decimal("open")?,
        high: decimal("high")?,
        low: decimal("low")?,
        close: decimal("close")?,
        volume: decimal("volume")?,
        quote_volume: decimal("quote_volume")?,
        trade_count: number("trade_count")?,
        taker_buy_volume: decimal("taker_buy_volume")?,
        taker_buy_quote_volume: decimal("taker_buy_quote_volume")?,
    })
}

impl MarketDataOwnerPostgres {
    async fn commit_venue_bars_in_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        availability: VenueBarAvailabilityV1,
        retrieval_ns: u64,
        bars: &[VenueBarV1],
    ) -> Result<VenueBarCommitSummaryV1, VenueBarWriteErrorV1> {
        use VenueBarWriteErrorV1 as Refused;

        let timeframe = check_page(
            instrument,
            served_timeframe_v1(venue_interval),
            retrieval_ns,
            bars,
        )?;
        let store = |_: sqlx::Error| Refused::StoreUnavailable;
        let mut transaction = self.pool.begin().await.map_err(store)?;
        sqlx::query(
            "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('market-data.venue-bars.v1:'||$1||'/'||$2,0))",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .execute(&mut *transaction)
        .await
        .map_err(store)?;
        let mut summary = VenueBarCommitSummaryV1::default();

        for bar in bars {
            let open_ns = to_i64(bar.open_ns)?;
            let offered = content_digest(bar);

            match load_head(&mut transaction, instrument, timeframe.label, open_ns)
                .await
                .map_err(store)?
            {
                None => {
                    let availability_ns = match availability {
                        VenueBarAvailabilityV1::AtRetrieval => retrieval_ns,
                        VenueBarAvailabilityV1::AfterClose { lag_ns } => bar
                            .close_ns_exclusive
                            .checked_add(lag_ns)
                            .ok_or(Refused::InvalidRequest)?,
                    };
                    sqlx::query(
                        "INSERT INTO market_data_private.venue_bar_versions_v1 (instrument, timeframe, open_ns, version, close_ns, open, high, low, close, volume, quote_volume, trade_count, taker_buy_volume, taker_buy_quote_volume, content_digest, source, retrieval_ns, availability_ns) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'REST',$15,$16)",
                    )
                    .bind(instrument)
                    .bind(timeframe.label)
                    .bind(open_ns)
                    .bind(to_i64(bar.close_ns_exclusive)?)
                    .bind(bar.open)
                    .bind(bar.high)
                    .bind(bar.low)
                    .bind(bar.close)
                    .bind(bar.volume)
                    .bind(bar.quote_volume)
                    .bind(to_i64(bar.trade_count)?)
                    .bind(bar.taker_buy_volume)
                    .bind(bar.taker_buy_quote_volume)
                    .bind(offered.as_bytes().as_slice())
                    .bind(to_i64(retrieval_ns)?)
                    .bind(to_i64(availability_ns)?)
                    .execute(&mut *transaction)
                    .await
                    .map_err(store)?;
                    summary.written += 1;
                }
                Some(head) if head.digest == offered => summary.rejoined += 1,
                Some(head) => {
                    summary.conflicts.push(
                        record_conflict(
                            &mut transaction,
                            (instrument, timeframe.label, bar.open_ns),
                            &head,
                            bar,
                            "REST",
                            retrieval_ns,
                        )
                        .await
                        .map_err(store)?,
                    );
                }
            }
        }
        transaction.commit().await.map_err(store)?;
        Ok(summary)
    }

    async fn read_venue_bars_in_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        window: (u64, u64),
        cut_ns: u64,
        verified_only: bool,
    ) -> Result<Vec<VenueBarReadV1>, VenueBarReadErrorV1> {
        use VenueBarReadErrorV1 as Refused;

        let timeframe = served_timeframe_v1(venue_interval).ok_or(Refused::InvalidRequest)?;
        let number = |value: u64| i64::try_from(value).map_err(|_| Refused::InvalidRequest);

        if instrument.is_empty() || window.0 >= window.1 {
            return Err(Refused::InvalidRequest);
        }
        let rows = sqlx::query(
            "SELECT DISTINCT ON (v.open_ns) v.open_ns, v.version, v.close_ns, v.open, v.high, v.low, v.close, v.volume, v.quote_volume, v.trade_count, v.taker_buy_volume, v.taker_buy_quote_volume, v.source, v.retrieval_ns, v.availability_ns, EXISTS (SELECT 1 FROM market_data_private.venue_bar_verifications_v1 AS c WHERE c.instrument=v.instrument AND c.timeframe=v.timeframe AND c.open_ns=v.open_ns AND c.version=v.version) AS verified FROM market_data_private.venue_bar_versions_v1 AS v WHERE v.instrument=$1 AND v.timeframe=$2 AND v.close_ns>=$3 AND v.close_ns<$4 AND v.availability_ns<=$5 ORDER BY v.open_ns, v.version DESC",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .bind(number(window.0)?)
        .bind(number(window.1)?)
        .bind(number(cut_ns)?)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
        let mut bars = Vec::with_capacity(rows.len());

        for row in &rows {
            let unavailable = |_| Refused::StoreUnavailable;
            let mut bar = bar_from_row(row).map_err(|()| Refused::StoreUnavailable)?;
            bar.open_ns = u64::try_from(row.try_get::<i64, _>("open_ns").map_err(unavailable)?)
                .map_err(|_| Refused::StoreUnavailable)?;
            let verified: bool = row.try_get("verified").map_err(unavailable)?;

            if verified_only && !verified {
                return Err(Refused::NotVerified {
                    open_ns: bar.open_ns,
                });
            }
            let source: String = row.try_get("source").map_err(unavailable)?;
            let instant = |column: &str| -> Result<u64, VenueBarReadErrorV1> {
                u64::try_from(row.try_get::<i64, _>(column).map_err(unavailable)?)
                    .map_err(|_| Refused::StoreUnavailable)
            };
            bars.push(VenueBarReadV1 {
                bar,
                version: u32::try_from(row.try_get::<i32, _>("version").map_err(unavailable)?)
                    .map_err(|_| Refused::StoreUnavailable)?,
                source: match source.as_str() {
                    "REST" => VenueBarSourceV1::Rest,
                    "CORRECTION" => VenueBarSourceV1::Correction,
                    _ => return Err(Refused::StoreUnavailable),
                },
                retrieval_ns: instant("retrieval_ns")?,
                availability_ns: instant("availability_ns")?,
                verified,
            });
        }
        Ok(bars)
    }
}

impl MarketDataOwnerPostgres {
    async fn verify_venue_bars_in_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        archive: &VenueBarArchiveV1,
        verified_ns: u64,
    ) -> Result<VenueBarVerificationSummaryV1, VenueBarVerificationErrorV1> {
        use VenueBarVerificationErrorV1 as Refused;

        let timeframe = served_timeframe_v1(venue_interval).ok_or(Refused::InvalidRequest)?;
        let window = (archive.window_start_ns, archive.window_end_ns_exclusive);

        if instrument.is_empty()
            || window.0 >= window.1
            || verified_ns == 0
            || archive
                .bars
                .windows(2)
                .any(|pair| pair[0].open_ns >= pair[1].open_ns)
        {
            return Err(Refused::InvalidRequest);
        }

        for bar in &archive.bars {
            if timeframe.close_of(bar.open_ns) != Some(bar.close_ns_exclusive) {
                return Err(Refused::BarOffGrid {
                    open_ns: bar.open_ns,
                });
            }

            if bar.close_ns_exclusive < window.0 || bar.close_ns_exclusive >= window.1 {
                return Err(Refused::InvalidRequest);
            }
        }
        let number = |value: u64| i64::try_from(value).map_err(|_| Refused::InvalidRequest);
        let store = |_: sqlx::Error| Refused::StoreUnavailable;
        let mut transaction = self.pool.begin().await.map_err(store)?;
        sqlx::query(
            "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('market-data.venue-bars.v1:'||$1||'/'||$2,0))",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .execute(&mut *transaction)
        .await
        .map_err(store)?;
        let mut summary = VenueBarVerificationSummaryV1::default();

        for bar in &archive.bars {
            let Some(head) = load_head(
                &mut transaction,
                instrument,
                timeframe.label,
                number(bar.open_ns)?,
            )
            .await
            .map_err(store)?
            else {
                summary.archive_only.push(bar.open_ns);
                continue;
            };

            if head.digest == content_digest(bar) {
                sqlx::query(
                    "INSERT INTO market_data_private.venue_bar_verifications_v1 (instrument, timeframe, open_ns, version, archive_kind, archive_identity, verified_ns) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
                )
                .bind(instrument)
                .bind(timeframe.label)
                .bind(number(bar.open_ns)?)
                .bind(i32::try_from(head.version).map_err(|_| Refused::StoreUnavailable)?)
                .bind(archive.kind.as_str())
                .bind(archive.identity.as_bytes().as_slice())
                .bind(number(verified_ns)?)
                .execute(&mut *transaction)
                .await
                .map_err(store)?;
                summary.verified += 1;
            } else {
                summary.conflicts.push(
                    record_conflict(
                        &mut transaction,
                        (instrument, timeframe.label, bar.open_ns),
                        &head,
                        bar,
                        archive.kind.as_str(),
                        verified_ns,
                    )
                    .await
                    .map_err(store)?,
                );
            }
        }
        let stored: Vec<i64> = sqlx::query_scalar(
            "SELECT DISTINCT open_ns FROM market_data_private.venue_bar_versions_v1 WHERE instrument=$1 AND timeframe=$2 AND close_ns>=$3 AND close_ns<$4 ORDER BY open_ns",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .bind(number(window.0)?)
        .bind(number(window.1)?)
        .fetch_all(&mut *transaction)
        .await
        .map_err(store)?;
        summary.store_only = stored
            .into_iter()
            .filter_map(|open_ns| u64::try_from(open_ns).ok())
            .filter(|open_ns| archive.bars.iter().all(|bar| bar.open_ns != *open_ns))
            .collect();
        transaction.commit().await.map_err(store)?;
        Ok(summary)
    }

    async fn open_venue_bar_conflicts_in_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
    ) -> Result<Vec<VenueBarOpenConflictV1>, VenueBarReadErrorV1> {
        let timeframe =
            served_timeframe_v1(venue_interval).ok_or(VenueBarReadErrorV1::InvalidRequest)?;
        let rows = sqlx::query(
            "SELECT c.conflict_identity, c.open_ns, c.stored_version, c.offered_side, c.offered_values FROM market_data_private.venue_bar_conflicts_v1 AS c WHERE c.instrument=$1 AND c.timeframe=$2 AND NOT EXISTS (SELECT 1 FROM market_data_private.venue_bar_versions_v1 AS v WHERE v.corrects_conflict=c.conflict_identity) ORDER BY c.open_ns, c.conflict_identity",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| VenueBarReadErrorV1::StoreUnavailable)?;
        rows.iter()
            .map(|row| {
                let identity: Vec<u8> = row.try_get("conflict_identity").map_err(|_| ())?;
                Ok(VenueBarOpenConflictV1 {
                    conflict_identity: <[u8; 32]>::try_from(identity.as_slice())
                        .map(BindingDigest::from_untrusted_bytes)
                        .map_err(|_| ())?,
                    open_ns: u64::try_from(row.try_get::<i64, _>("open_ns").map_err(|_| ())?)
                        .map_err(|_| ())?,
                    stored_version: u32::try_from(
                        row.try_get::<i32, _>("stored_version").map_err(|_| ())?,
                    )
                    .map_err(|_| ())?,
                    offered_side: row.try_get("offered_side").map_err(|_| ())?,
                    offered_values: row.try_get("offered_values").map_err(|_| ())?,
                })
            })
            .collect::<Result<Vec<_>, ()>>()
            .map_err(|()| VenueBarReadErrorV1::StoreUnavailable)
    }

    async fn correct_venue_bar_in_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        conflict_identity: BindingDigest,
        corrected: VenueBarV1,
        available_ns: u64,
    ) -> Result<u32, VenueBarCorrectionErrorV1> {
        use VenueBarCorrectionErrorV1 as Refused;

        let timeframe = served_timeframe_v1(venue_interval).ok_or(Refused::InvalidRequest)?;

        if instrument.is_empty() || available_ns == 0 {
            return Err(Refused::InvalidRequest);
        }

        if timeframe.close_of(corrected.open_ns) != Some(corrected.close_ns_exclusive)
            || !bar_is_consistent(&corrected)
        {
            return Err(Refused::BarRefused);
        }
        let number = |value: u64| i64::try_from(value).map_err(|_| Refused::InvalidRequest);
        let store = |_: sqlx::Error| Refused::StoreUnavailable;
        let mut transaction = self.pool.begin().await.map_err(store)?;
        sqlx::query(
            "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('market-data.venue-bars.v1:'||$1||'/'||$2,0))",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .execute(&mut *transaction)
        .await
        .map_err(store)?;
        let conflict: Option<i32> = sqlx::query_scalar(
            "SELECT stored_version FROM market_data_private.venue_bar_conflicts_v1 WHERE conflict_identity=$1 AND instrument=$2 AND timeframe=$3 AND open_ns=$4",
        )
        .bind(conflict_identity.as_bytes().as_slice())
        .bind(instrument)
        .bind(timeframe.label)
        .bind(number(corrected.open_ns)?)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(store)?;
        let stored_version = conflict.ok_or(Refused::UnknownConflict)?;
        let head = load_head(
            &mut transaction,
            instrument,
            timeframe.label,
            number(corrected.open_ns)?,
        )
        .await
        .map_err(store)?
        .ok_or(Refused::StoreUnavailable)?;

        if i32::try_from(head.version).ok() != Some(stored_version) {
            return Err(Refused::ConflictSuperseded);
        }
        let version = head
            .version
            .checked_add(1)
            .ok_or(Refused::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO market_data_private.venue_bar_versions_v1 (instrument, timeframe, open_ns, version, close_ns, open, high, low, close, volume, quote_volume, trade_count, taker_buy_volume, taker_buy_quote_volume, content_digest, source, retrieval_ns, availability_ns, corrects_conflict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CORRECTION',$16,$16,$17)",
        )
        .bind(instrument)
        .bind(timeframe.label)
        .bind(number(corrected.open_ns)?)
        .bind(i32::try_from(version).map_err(|_| Refused::StoreUnavailable)?)
        .bind(number(corrected.close_ns_exclusive)?)
        .bind(corrected.open)
        .bind(corrected.high)
        .bind(corrected.low)
        .bind(corrected.close)
        .bind(corrected.volume)
        .bind(corrected.quote_volume)
        .bind(number(corrected.trade_count)?)
        .bind(corrected.taker_buy_volume)
        .bind(corrected.taker_buy_quote_volume)
        .bind(content_digest(&corrected).as_bytes().as_slice())
        .bind(number(available_ns)?)
        .bind(conflict_identity.as_bytes().as_slice())
        .execute(&mut *transaction)
        .await
        .map_err(store)?;
        transaction.commit().await.map_err(store)?;
        Ok(version)
    }
}

/// The durable venue bar store. It retains the Owner and exposes no pool.
pub(crate) struct VenueBarStorePostgresV1 {
    pub(crate) owner: MarketDataOwnerPostgres,
}

impl Debug for VenueBarStorePostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(VenueBarStorePostgresV1))
            .finish_non_exhaustive()
    }
}

impl sealed::Sealed for VenueBarStorePostgresV1 {}

#[async_trait::async_trait]
impl VenueBarStoreV1 for VenueBarStorePostgresV1 {
    async fn commit_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        availability: VenueBarAvailabilityV1,
        retrieval_ns: u64,
        bars: &[VenueBarV1],
    ) -> Result<VenueBarCommitSummaryV1, VenueBarWriteErrorV1> {
        self.owner
            .commit_venue_bars_in_v1(instrument, venue_interval, availability, retrieval_ns, bars)
            .await
    }

    async fn read_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
        cut_ns: u64,
        verified_only: bool,
    ) -> Result<Vec<VenueBarReadV1>, VenueBarReadErrorV1> {
        self.owner
            .read_venue_bars_in_v1(
                instrument,
                venue_interval,
                (window_start_ns, window_end_ns_exclusive),
                cut_ns,
                verified_only,
            )
            .await
    }

    async fn verify_venue_bars_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        archive: &VenueBarArchiveV1,
        verified_ns: u64,
    ) -> Result<VenueBarVerificationSummaryV1, VenueBarVerificationErrorV1> {
        self.owner
            .verify_venue_bars_in_v1(instrument, venue_interval, archive, verified_ns)
            .await
    }

    async fn open_venue_bar_conflicts_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
    ) -> Result<Vec<VenueBarOpenConflictV1>, VenueBarReadErrorV1> {
        self.owner
            .open_venue_bar_conflicts_in_v1(instrument, venue_interval)
            .await
    }

    async fn correct_venue_bar_v1(
        &self,
        instrument: &str,
        venue_interval: &str,
        conflict_identity: BindingDigest,
        corrected: VenueBarV1,
        available_ns: u64,
    ) -> Result<u32, VenueBarCorrectionErrorV1> {
        self.owner
            .correct_venue_bar_in_v1(
                instrument,
                venue_interval,
                conflict_identity,
                corrected,
                available_ns,
            )
            .await
    }
}

/// Opens the sole configured venue bar store, named by `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// [`VenueBarWriteErrorV1::StoreUnavailable`] when the URL is missing or the store cannot be
/// opened.
pub(in crate::owner) async fn venue_bar_store_from_environment_v1()
-> Result<Arc<dyn VenueBarStoreV1>, VenueBarWriteErrorV1> {
    let url = std::env::var(
        crate::owner::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV,
    )
    .map_err(|_| VenueBarWriteErrorV1::StoreUnavailable)?;

    if url.is_empty() || url.trim() != url {
        return Err(VenueBarWriteErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        crate::owner::storage_diagnostic::refused_by_store(
            "venue-bar-store.environment.connect",
            &e,
        );
        VenueBarWriteErrorV1::StoreUnavailable
    })?;
    Ok(Arc::new(VenueBarStorePostgresV1 { owner }))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{VenueBarV1, bar_is_consistent, canonical_columns, check_page, content_digest};
    use crate::owner::{
        bar_schedule::served_timeframe_v1,
        venue_bar_store_v1::{VENUE_BAR_SETTLE_DELAY_NS_V1, VenueBarWriteErrorV1},
    };

    const DAY: u64 = 86_400_000_000_000;

    fn bar(open_ns: u64) -> VenueBarV1 {
        VenueBarV1 {
            open_ns,
            close_ns_exclusive: open_ns + DAY,
            open: "100.50".parse().unwrap(),
            high: "101".parse().unwrap(),
            low: "99".parse().unwrap(),
            close: "100".parse().unwrap(),
            volume: "10".parse().unwrap(),
            quote_volume: "1000".parse().unwrap(),
            trade_count: 7,
            taker_buy_volume: "4".parse().unwrap(),
            taker_buy_quote_volume: "400".parse().unwrap(),
        }
    }

    /// One value has one digest however it is spelled; any changed column changes it.
    #[rstest]
    fn a_bar_has_one_digest_per_value() {
        let mut respelled = bar(0);
        respelled.open = "100.500".parse().unwrap();
        assert_eq!(content_digest(&respelled), content_digest(&bar(0)));
        let mut moved = bar(0);
        moved.trade_count = 8;
        assert_ne!(content_digest(&moved), content_digest(&bar(0)));
        assert_eq!(canonical_columns(&bar(0))[1], "100.5");
    }

    /// A page is refused, by name, for an unserved interval, disorder, a bar off its grid, a bar
    /// not yet settled at retrieval, or a bar that cannot be a bar.
    #[rstest]
    fn each_page_refusal_is_named() {
        let daily = served_timeframe_v1("1d");
        let settled = 2 * DAY + VENUE_BAR_SETTLE_DELAY_NS_V1;
        assert!(check_page("BTC", daily, settled, &[bar(0), bar(DAY)]).is_ok());
        assert_eq!(
            check_page("BTC", served_timeframe_v1("3d"), settled, &[bar(0)]),
            Err(VenueBarWriteErrorV1::InvalidRequest)
        );
        assert_eq!(
            check_page("BTC", daily, settled, &[bar(DAY), bar(0)]),
            Err(VenueBarWriteErrorV1::InvalidRequest)
        );
        assert_eq!(
            check_page("BTC", daily, settled, &[bar(1)]),
            Err(VenueBarWriteErrorV1::BarOffGrid { open_ns: 1 })
        );
        assert_eq!(
            check_page("BTC", daily, settled - 1, &[bar(DAY)]),
            Err(VenueBarWriteErrorV1::BarNotSettled { open_ns: DAY })
        );
        let mut inverted = bar(0);
        inverted.low = "102".parse().unwrap();
        assert!(!bar_is_consistent(&inverted));
        assert_eq!(
            check_page("BTC", daily, settled, &[inverted]),
            Err(VenueBarWriteErrorV1::BarInconsistent { open_ns: 0 })
        );
    }

    /// A week opens Monday 00:00 UTC, a month on the 1st, and the close is the next open.
    #[rstest]
    fn the_week_and_month_grids_follow_their_anchors() {
        let week = served_timeframe_v1("1w").unwrap();
        let monday_2024_01_01 = 1_704_067_200_000_000_000;
        assert_eq!(
            week.close_of(monday_2024_01_01),
            Some(monday_2024_01_01 + 7 * DAY)
        );
        assert_eq!(week.close_of(monday_2024_01_01 + DAY), None);
        let month = served_timeframe_v1("1M").unwrap();
        let feb_2024 = 1_706_745_600_000_000_000;
        assert_eq!(month.close_of(feb_2024), Some(feb_2024 + 29 * DAY));
        assert_eq!(month.close_of(feb_2024 + DAY), None);
        assert_eq!(month.label, "1MO");
        assert_eq!(served_timeframe_v1("1m").unwrap().label, "1M");
    }
}
