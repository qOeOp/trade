//! A Binance USD-M futures Data Client that answers one Owner-issued PIT observation scope.
//!
//! Binance publishes its futures klines without a credential - `klines` calls its transport with
//! `signed = false` - so this client needs no key and spends nothing. It states only what the
//! exchange said and when, never what any of it is bound to; Market Data stamps the Source Binding,
//! Instrument Master, Universe Selection, Market Semantics and correction bindings itself.
//!
//! A snapshot is one as-of cut rather than a series, so the answer for each member is the last bar
//! that had already closed at the scope's event-effective coordinate. A bar still open at that
//! coordinate is not yet a fact about it, and one that closed later cannot backfill it.
//!
//! This venue quotes its klines as decimal strings rather than as a mantissa and an exponent, so
//! the prices are read from those digits directly. Parsing them through `f64` would round the
//! vendor's own number to the nearest double and make this client the author of a price it was only
//! meant to repeat.

use std::{collections::BTreeMap, fmt::Debug};

use async_trait::async_trait;
use rust_decimal::Decimal;
use vibe_data::owner::pit_observation_source_v1::{
    PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1, VendorObservationV1,
};

use crate::futures::http::{
    client::BinanceFuturesHttpClient, models::BinanceFuturesKline, query::BinanceKlinesParams,
};

/// The channel every bar on this client belongs to.
const CHANNEL: &str = "MARKET";
/// The data kind a kline is, in the Owner's admitted vocabulary.
const DATA_KIND: &str = "BAR";
/// How many klines one member request may return.
///
/// The client needs only the last closed bar, but asks for a few so a quiet interval at the
/// coordinate still has a predecessor to answer with.
const KLINE_LIMIT: u32 = 16;
/// The largest number of members one scope may name.
const MAX_MEMBERS: usize = 64;

/// Answers an Owner-issued scope from this venue's perpetual futures klines.
pub struct BinanceFuturesBarObservationSourceV1 {
    client: BinanceFuturesHttpClient,
    /// Owner member key to Binance symbol. A scope may name only these members.
    symbols: BTreeMap<String, String>,
    /// The Binance interval requested, such as `4h`.
    interval: String,
    /// The Owner timeframe that interval denotes, such as `4H`.
    timeframe: String,
}

impl Debug for BinanceFuturesBarObservationSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(BinanceFuturesBarObservationSourceV1))
            .field("members", &self.symbols.len())
            .field("interval", &self.interval)
            .finish_non_exhaustive()
    }
}

impl BinanceFuturesBarObservationSourceV1 {
    /// Binds one client to the exact universe members it may be asked for.
    ///
    /// # Errors
    ///
    /// Returns [`PitObservationSourceErrorV1::ScopeMismatch`] for an empty or oversized mapping,
    /// and for an interval this Owner has no timeframe label for. A client that guessed one would
    /// be authoring a coordinate the Owner owns.
    pub fn new(
        client: BinanceFuturesHttpClient,
        symbols: BTreeMap<String, String>,
        interval: &str,
    ) -> Result<Self, PitObservationSourceErrorV1> {
        if symbols.is_empty() || symbols.len() > MAX_MEMBERS {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }
        // The label table is the spot client's, because it is the Owner's vocabulary rather than
        // one product's: the same `4h` denotes the same timeframe whichever venue surface served
        // the bar. A second copy here would be a second place for the two to drift apart.
        let timeframe = crate::pit_observation_source_v1::owner_timeframe(interval)
            .ok_or(PitObservationSourceErrorV1::ScopeMismatch)?;

        Ok(Self {
            client,
            symbols,
            interval: interval.to_string(),
            timeframe: timeframe.to_string(),
        })
    }
}

#[async_trait]
impl PitObservationSourceV1 for BinanceFuturesBarObservationSourceV1 {
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

            for (field, quoted) in [
                ("OPEN", &bar.open),
                ("HIGH", &bar.high),
                ("LOW", &bar.low),
                ("CLOSE", &bar.close),
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
        let source = BinanceFuturesBarObservationSourceV1::new(client, members, "4h")
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
            4,
            "one closed bar yields open, high, low and close"
        );

        for row in &rows {
            assert_eq!(row.member_key, "BTCUSDT-PERP.BINANCE");
            assert_eq!(row.data_kind, DATA_KIND);
            assert_eq!(row.channel, CHANNEL);
            assert_eq!(
                row.timeframe, "4H",
                "a continuous-clock venue's four hours, not a session bar"
            );
            assert!(row.value_mantissa > 0, "an admitted price is positive");
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
