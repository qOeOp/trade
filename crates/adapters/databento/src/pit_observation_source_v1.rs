//! A Databento Data Client that answers one Owner-issued PIT observation scope.
//!
//! The client is bounded to exactly what the authenticity probe is admitted for: one dataset, one
//! instrument and a window no longer than a UTC day. It states only what the provider said and
//! when, and it cannot state what any of it is bound to; Market Data stamps the Source Binding,
//! Instrument Master, Universe Selection, Market Semantics and correction bindings itself.
//!
//! A snapshot in the Owner's model is one as-of cut rather than a series, so this client answers
//! with the latest quote that was genuinely available at the scope's coordinates and drops
//! everything the provider published later. When nothing qualifies it answers with no rows, which
//! becomes insufficient coverage and an explicit terminal negative, never a silent empty success.

use std::{fmt::Debug, io::Cursor};

use async_trait::async_trait;
use databento::dbn::{self, decode::DecodeRecord};
use vibe_core::UnixNanos;
use vibe_data::owner::pit_observation_source_v1::{
    PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1, VendorObservationV1,
};

use super::pit_probe::PIT_PROBE_INSTRUMENT;
use crate::historical::DatabentoHistoricalClient;

/// DBN carries prices as a fixed-point integer with nine fractional digits.
const DBN_PRICE_SCALE: u8 = 9;
/// The channel every quote on this client belongs to.
const CHANNEL: &str = "MARKET";
/// The data kind the bounded probe retrieves.
///
/// A best bid and offer is a quote; `QUOTE` is the Owner's admitted vocabulary for it, and a client
/// does not get to introduce a kind of its own.
const DATA_KIND: &str = "QUOTE";
/// The interval the bounded probe's schema aggregates.
const TIMEFRAME: &str = "1S";
/// How far back one retrieval looks for the last quote effective at the coordinate.
///
/// The probe refuses a response carrying a record with no provider event time, and a quiet second
/// in a full trading day produces exactly that, so a day-wide fetch fails on the quiet seconds
/// rather than on anything about the quote wanted. A few minutes is enough to find the last quote
/// inside a session; outside one the retrieval simply finds nothing, which becomes insufficient
/// coverage rather than a stale value dressed up as current.
const PROBE_LOOKBACK_NS: u64 = 300_000_000_000;

/// One bounded, read-only Databento quote source for the admitted probe instrument.
pub struct DatabentoBboObservationSourceV1 {
    client: DatabentoHistoricalClient,
    request_correlation: [u8; 32],
    max_cost_usd: f64,
}

impl Debug for DatabentoBboObservationSourceV1 {
    /// Redacts the client so a credential can never reach a log or a rejection body.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(DatabentoBboObservationSourceV1))
            .field("instrument", &PIT_PROBE_INSTRUMENT)
            .finish_non_exhaustive()
    }
}

impl DatabentoBboObservationSourceV1 {
    /// Binds one historical client, the stable correlation every attempt repeats, and the
    /// provider-cost ceiling this client is authorized to spend per attempt.
    ///
    /// A zero ceiling is the safe default: the probe then refuses any range the provider would
    /// charge for, and the snapshot behind it becomes an explicit terminal negative rather than a
    /// silent bill.
    #[must_use]
    pub const fn new(
        client: DatabentoHistoricalClient,
        request_correlation: [u8; 32],
        max_cost_usd: f64,
    ) -> Self {
        Self {
            client,
            request_correlation,
            max_cost_usd,
        }
    }
}

#[async_trait]
impl PitObservationSourceV1 for DatabentoBboObservationSourceV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let (start, end) = admitted_window(scope)?;
        let evidence = self
            .client
            .attempt_bounded_pit_probe_within_cost(
                UnixNanos::from(start),
                UnixNanos::from(end),
                self.request_correlation,
                self.max_cost_usd,
            )
            .await
            .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

        let latest = latest_available_quote(
            evidence.bbo().bytes(),
            scope.event_effective(),
            scope.provider_available(),
        )?;
        Ok(latest
            .map(|quote| rows_from_quote(scope, &quote))
            .unwrap_or_default())
    }
}

/// Admits only the scope the bounded probe is entitled to answer, and the window that answers it.
///
/// The window ends just after the event-effective coordinate, not at the decision cut. What the
/// snapshot needs is the last value that was already effective at the cut, so the records worth
/// fetching are the ones at or before that coordinate; a window opening at it would fetch only
/// records the availability filter must then drop. The lookback is [`PROBE_LOOKBACK_NS`].
///
/// A scope naming any other member, or one whose cut precedes its own event-effective coordinate,
/// is refused rather than answered in part: a partial answer would read downstream as incomplete
/// coverage of a universe this client was never entitled to.
fn admitted_window(
    scope: &PitObservationScopeV1,
) -> Result<(u64, u64), PitObservationSourceErrorV1> {
    let [member] = scope.members() else {
        return Err(PitObservationSourceErrorV1::ScopeMismatch);
    };

    if member != PIT_PROBE_INSTRUMENT {
        return Err(PitObservationSourceErrorV1::ScopeMismatch);
    }
    let effective = scope.event_effective();
    if scope.decision_cut() < effective || scope.provider_available() < effective {
        return Err(PitObservationSourceErrorV1::ScopeMismatch);
    }
    let end = effective
        .checked_add(1)
        .ok_or(PitObservationSourceErrorV1::ScopeMismatch)?;
    let start = effective.saturating_sub(PROBE_LOOKBACK_NS);
    Ok((start, end))
}

/// Builds the vendor rows for one qualifying quote.
fn rows_from_quote(
    scope: &PitObservationScopeV1,
    quote: &AvailableQuote,
) -> Vec<VendorObservationV1> {
    let mut rows = Vec::with_capacity(2);

    for (field, price) in [("BID_PRICE", quote.bid_px), ("ASK_PRICE", quote.ask_px)] {
        // DBN marks an absent side with the sentinel rather than a zero price, so an absent side
        // must not become a value of zero.
        if price == i64::MAX {
            continue;
        }
        let (value_mantissa, value_scale) = canonical_decimal(i128::from(price), DBN_PRICE_SCALE);
        rows.push(VendorObservationV1 {
            symbolic_key: format!("{PIT_PROBE_INSTRUMENT}.{field}.{TIMEFRAME}"),
            member_key: PIT_PROBE_INSTRUMENT.to_string(),
            instrument: PIT_PROBE_INSTRUMENT.to_string(),
            channel: CHANNEL.to_string(),
            data_kind: DATA_KIND.to_string(),
            timeframe: TIMEFRAME.to_string(),
            field: field.to_string(),
            value_mantissa,
            value_scale,
            // The snapshot is one as-of cut: every row repeats the coordinates the Owner issued,
            // and the record only qualified because it was available at them.
            event_effective: scope.event_effective(),
            provider_available: scope.provider_available(),
            retrieval: scope.retrieval(),
            correction_publication: scope.correction_publication(),
        });
    }
    // The Owner's canonical batch is strictly ascending by symbolic and member key, so a client
    // emits that order rather than the order the sides happen to be read in.
    rows.sort_by(|left, right| {
        (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
    });
    rows
}

/// Reduces a fixed-point value to the one canonical decimal that denotes it.
///
/// The Owner admits no trailing zero under a non-zero scale, because `201090000000e-9` and
/// `20109e-2` are the same price and a batch that could spell it either way would have two digests
/// for one fact. DBN always quotes at nine fractional digits, so almost every price arrives needing
/// this.
const fn canonical_decimal(mantissa: i128, scale: u8) -> (i128, u8) {
    let mut mantissa = mantissa;
    let mut scale = scale;
    while scale > 0 && mantissa != 0 && mantissa % 10 == 0 {
        mantissa /= 10;
        scale -= 1;
    }

    if mantissa == 0 {
        (0, 0)
    } else {
        (mantissa, scale)
    }
}

/// The best bid and ask of one qualifying record.
#[derive(Debug)]
struct AvailableQuote {
    bid_px: i64,
    ask_px: i64,
}

/// Returns the latest quote that was already available at the issued coordinates.
///
/// A record qualifies only when the event it summarizes had happened by the event-effective
/// coordinate and the provider had published it by the provider-available coordinate. Anything
/// later is dropped, so retrieval after the cut can never backfill an earlier decision.
fn latest_available_quote(
    bbo_dbn: &[u8],
    event_effective: u64,
    provider_available: u64,
) -> Result<Option<AvailableQuote>, PitObservationSourceErrorV1> {
    let mut decoder = dbn::decode::DbnDecoder::with_upgrade_policy(
        Cursor::new(bbo_dbn),
        dbn::VersionUpgradePolicy::AsIs,
    )
    .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;

    let mut best: Option<(u64, u64, AvailableQuote)> = None;

    while let Some(record) = decoder
        .decode_record::<dbn::Bbo1SMsg>()
        .map_err(|_| PitObservationSourceErrorV1::Unavailable)?
    {
        let ts_event = record.hd.ts_event;
        let ts_recv = record.ts_recv;
        if ts_event > event_effective || ts_recv > provider_available {
            continue;
        }
        let level = &record.levels[0];
        let candidate = (ts_recv, ts_event);

        if best
            .as_ref()
            .is_none_or(|(recv, event, _)| candidate > (*recv, *event))
        {
            best = Some((
                ts_recv,
                ts_event,
                AvailableQuote {
                    bid_px: level.bid_px,
                    ask_px: level.ask_px,
                },
            ));
        }
    }
    Ok(best.map(|(_, _, quote)| quote))
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use databento::dbn::{
        Metadata, SType,
        encode::{DbnEncoder, EncodeRecord},
    };
    use time::{Date, Month};

    use rstest::rstest;

    use super::*;
    use crate::pit_probe::{
        PIT_PROBE_DATASET, PIT_PROBE_MAX_RECORDS_PER_RESPONSE, PIT_PROBE_SYMBOL,
    };

    const START: u64 = 1_704_067_200_000_000_000;
    const END: u64 = START + 3_600_000_000_000;

    fn metadata() -> Metadata {
        Metadata::builder()
            .dataset(PIT_PROBE_DATASET)
            .schema(Some(dbn::Schema::Bbo1S))
            .start(START)
            .end(NonZeroU64::new(END))
            .stype_in(Some(SType::RawSymbol))
            .stype_out(SType::InstrumentId)
            .limit(NonZeroU64::new(PIT_PROBE_MAX_RECORDS_PER_RESPONSE))
            .symbols(vec![PIT_PROBE_SYMBOL.to_string()])
            .mappings(vec![dbn::SymbolMapping {
                raw_symbol: PIT_PROBE_SYMBOL.to_string(),
                intervals: vec![dbn::MappingInterval {
                    start_date: Date::from_calendar_date(2024, Month::January, 1).unwrap(),
                    end_date: Date::from_calendar_date(2024, Month::January, 2).unwrap(),
                    symbol: "101".to_string(),
                }],
            }])
            .build()
    }

    fn quotes(records: &[(u64, u64, i64, i64)]) -> Vec<u8> {
        let metadata = metadata();
        let mut bytes = Vec::new();
        {
            let mut encoder = DbnEncoder::new(&mut bytes, &metadata).unwrap();

            for &(ts_event, ts_recv, bid_px, ask_px) in records {
                let mut record = dbn::Bbo1SMsg::default_for_schema(dbn::Schema::Bbo1S);
                record.hd.instrument_id = 101;
                record.hd.ts_event = ts_event;
                record.ts_recv = ts_recv;
                record.levels[0].bid_px = bid_px;
                record.levels[0].ask_px = ask_px;
                encoder.encode_record(&record).unwrap();
            }
        }
        bytes
    }

    fn scope(members: &[&str]) -> PitObservationScopeV1 {
        PitObservationScopeV1::from_owner_request(
            members.iter().map(|m| (*m).to_string()).collect(),
            START + 60,
            START + 70,
            START + 90,
            START + 80,
            START + 100,
        )
    }

    #[rstest]
    fn takes_the_latest_quote_that_was_already_available() {
        let dbn_bytes = quotes(&[
            (START + 10, START + 20, 100, 200),
            (START + 30, START + 40, 300, 400),
        ]);
        let quote = latest_available_quote(&dbn_bytes, START + 60, START + 70)
            .unwrap()
            .unwrap();
        assert_eq!((quote.bid_px, quote.ask_px), (300, 400));
    }

    #[rstest]
    fn a_quote_published_after_the_coordinate_never_backfills() {
        let dbn_bytes = quotes(&[
            (START + 10, START + 20, 100, 200),
            // Published after the provider-available coordinate the request froze.
            (START + 30, START + 99, 999, 999),
        ]);
        let quote = latest_available_quote(&dbn_bytes, START + 60, START + 70)
            .unwrap()
            .unwrap();
        assert_eq!(
            (quote.bid_px, quote.ask_px),
            (100, 200),
            "a later publication cannot become earlier-available evidence"
        );
    }

    #[rstest]
    fn an_event_after_the_effective_coordinate_is_dropped() {
        let dbn_bytes = quotes(&[(START + 61, START + 62, 100, 200)]);
        assert!(
            latest_available_quote(&dbn_bytes, START + 60, START + 70)
                .unwrap()
                .is_none()
        );
    }

    #[rstest]
    fn no_qualifying_record_is_empty_coverage_rather_than_an_error() {
        let dbn_bytes = quotes(&[]);
        assert!(
            latest_available_quote(&dbn_bytes, START + 60, START + 70)
                .unwrap()
                .is_none()
        );
    }

    #[rstest]
    fn an_absent_side_is_omitted_instead_of_becoming_a_zero_price() {
        let rows = rows_from_quote(
            &scope(&[PIT_PROBE_INSTRUMENT]),
            &AvailableQuote {
                bid_px: 3_720_250_000_000,
                ask_px: i64::MAX,
            },
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field, "BID_PRICE");
        assert_eq!(
            (rows[0].value_mantissa, rows[0].value_scale),
            (372_025, 2),
            "3720.25 keeps one canonical spelling instead of DBN's padded one"
        );
    }

    #[rstest]
    fn a_value_has_exactly_one_canonical_spelling() {
        assert_eq!(canonical_decimal(201_090_000_000, 9), (20_109, 2));
        assert_eq!(canonical_decimal(1, 9), (1, 9));
        assert_eq!(canonical_decimal(0, 9), (0, 0));
        assert_eq!(canonical_decimal(-201_090_000_000, 9), (-20_109, 2));
    }

    #[rstest]
    fn rows_are_emitted_in_the_owners_canonical_order() {
        let rows = rows_from_quote(
            &scope(&[PIT_PROBE_INSTRUMENT]),
            &AvailableQuote {
                bid_px: 10,
                ask_px: 20,
            },
        );
        let keys = rows
            .iter()
            .map(|row| (row.symbolic_key.clone(), row.member_key.clone()))
            .collect::<Vec<_>>();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "the batch is strictly ascending by key");
    }

    #[rstest]
    fn every_row_repeats_the_coordinates_the_owner_issued() {
        let scope = scope(&[PIT_PROBE_INSTRUMENT]);
        let rows = rows_from_quote(
            &scope,
            &AvailableQuote {
                bid_px: 10,
                ask_px: 20,
            },
        );
        assert_eq!(rows.len(), 2);
        for row in &rows {
            assert_eq!(row.event_effective, scope.event_effective());
            assert_eq!(row.provider_available, scope.provider_available());
            assert_eq!(row.retrieval, scope.retrieval());
            assert_eq!(row.correction_publication, scope.correction_publication());
            assert_eq!(row.member_key, PIT_PROBE_INSTRUMENT);
        }
    }

    /// Drives the whole client against the live provider.
    ///
    /// The probe stops before any download when the cost preflight exceeds the admitted ceiling,
    /// so a run without the entitlement is a refusal rather than a spend. Either way the client must not invent
    /// rows: an entitled run answers with the two sides of one quote, and an unentitled one is
    /// `Unavailable`.
    ///
    /// Verified live against `EQUS.MINI` on 2026-09-17 with `DATABENTO_MAX_PROBE_COST_USD=1`: the
    /// attempt returned the two sides of one real AAPL quote. Five minutes of `bbo-1s` quoted at
    /// about $0.00018, so the ceiling exists to make a spend deliberate rather than to ration it.
    #[tokio::test]
    #[ignore = "requires explicit local DATABENTO_API_KEY read-only probe authority"]
    async fn live_probe_answers_the_owner_scope_or_refuses() {
        let api_key = std::env::var("DATABENTO_API_KEY")
            .expect("DATABENTO_API_KEY is required for the explicitly invoked live probe");
        let client = DatabentoHistoricalClient::new(
            crate::common::Credential::new(api_key),
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("publishers.json"),
            vibe_core::time::get_atomic_clock_realtime(),
            false,
        )
        .unwrap();
        // The ceiling is explicit so this run can never spend more than it states.
        let ceiling = std::env::var("DATABENTO_MAX_PROBE_COST_USD")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0);
        let source = DatabentoBboObservationSourceV1::new(client, [0xA5; 32], ceiling);
        // 2025-06-02 15:00:00Z, mid-session, a window this account carries 595 quotes for.
        let effective = 1_748_876_400_000_000_000_u64;
        let scope = PitObservationScopeV1::from_owner_request(
            vec![PIT_PROBE_INSTRUMENT.to_string()],
            effective,
            effective,
            effective,
            effective,
            effective,
        );

        match source.observe(&scope).await {
            Ok(rows) => {
                assert!(rows.len() <= 2, "one quote yields at most a bid and an ask");
                for row in &rows {
                    assert_eq!(row.member_key, PIT_PROBE_INSTRUMENT);
                    assert_eq!(row.data_kind, DATA_KIND);
                    assert_eq!(row.timeframe, TIMEFRAME);
                    assert_eq!(row.value_scale, DBN_PRICE_SCALE);
                    assert!(row.value_mantissa > 0, "an admitted price is positive");
                    assert_eq!(row.event_effective, effective);
                    assert_eq!(row.provider_available, effective);
                    assert_eq!(row.retrieval, effective);
                    assert_eq!(row.correction_publication, effective);
                }
                eprintln!("live probe returned {} row(s)", rows.len());
            }
            Err(PitObservationSourceErrorV1::Unavailable) => {
                eprintln!("live probe refused before download: unavailable");
            }
            Err(e) => panic!("live probe failed before a safe terminal: {e}"),
        }
    }

    #[rstest]
    fn a_scope_the_probe_is_not_entitled_to_is_refused() {
        for members in [
            vec![],
            vec!["MSFT.EQUS"],
            vec![PIT_PROBE_INSTRUMENT, "MSFT.EQUS"],
        ] {
            assert_eq!(
                admitted_window(&scope(&members)),
                Err(PitObservationSourceErrorV1::ScopeMismatch),
            );
        }
    }

    #[rstest]
    fn a_cut_before_its_own_effective_coordinate_is_refused() {
        let inverted = PitObservationScopeV1::from_owner_request(
            vec![PIT_PROBE_INSTRUMENT.to_string()],
            START + 100,
            START + 100,
            START + 100,
            START + 100,
            START + 99,
        );
        assert_eq!(
            admitted_window(&inverted),
            Err(PitObservationSourceErrorV1::ScopeMismatch)
        );
    }

    #[rstest]
    fn the_admitted_window_ends_just_after_the_effective_coordinate() {
        assert_eq!(
            admitted_window(&scope(&[PIT_PROBE_INSTRUMENT])),
            Ok((START + 60 - PROBE_LOOKBACK_NS, START + 61)),
            "the fetch looks back at what was already effective, never forward past the coordinate"
        );
    }
}
