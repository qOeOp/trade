//! A Binance Spot Data Client that answers one Owner-issued PIT observation scope.
//!
//! Binance publishes its klines without a credential, so this client needs no key and spends
//! nothing. It states only what the exchange said and when, never what any of it is bound to;
//! Market Data stamps the Source Binding, Instrument Master, Universe Selection, Market Semantics
//! and correction bindings itself.
//!
//! A snapshot is one as-of cut rather than a series, so the answer for each member is the last bar
//! that had already closed at the scope's event-effective coordinate. A bar still open at that
//! coordinate is not yet a fact about it, and one that closed later cannot backfill it.

use std::{collections::BTreeMap, fmt::Debug};

use async_trait::async_trait;
use vibe_data::owner::pit_observation_source_v1::{
    PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1, VendorObservationV1,
};

use crate::spot::http::client::BinanceSpotHttpClient;

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

/// One bounded, keyless Binance Spot bar source for an admitted member set.
pub struct BinanceSpotBarObservationSourceV1 {
    client: BinanceSpotHttpClient,
    /// Owner member key to Binance symbol. A scope may name only these members.
    symbols: BTreeMap<String, String>,
    /// The Binance interval requested, such as `1m`.
    interval: String,
    /// The Owner timeframe that interval denotes, such as `1M`.
    timeframe: String,
}

impl Debug for BinanceSpotBarObservationSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(BinanceSpotBarObservationSourceV1))
            .field("members", &self.symbols.len())
            .field("interval", &self.interval)
            .finish_non_exhaustive()
    }
}

impl BinanceSpotBarObservationSourceV1 {
    /// Binds one client, the member-to-symbol mapping it may answer for, and one interval.
    ///
    /// # Errors
    ///
    /// Returns [`PitObservationSourceErrorV1::ScopeMismatch`] for an empty or oversized mapping,
    /// and for an interval with no Owner timeframe, because a client that guessed a timeframe
    /// would be describing a different fact than the one it fetched.
    pub fn new(
        client: BinanceSpotHttpClient,
        symbols: BTreeMap<String, String>,
        interval: &str,
    ) -> Result<Self, PitObservationSourceErrorV1> {
        if symbols.is_empty() || symbols.len() > MAX_MEMBERS {
            return Err(PitObservationSourceErrorV1::ScopeMismatch);
        }
        let timeframe =
            owner_timeframe(interval).ok_or(PitObservationSourceErrorV1::ScopeMismatch)?;
        Ok(Self {
            client,
            symbols,
            interval: interval.to_string(),
            timeframe: timeframe.to_string(),
        })
    }
}

#[async_trait]
impl PitObservationSourceV1 for BinanceSpotBarObservationSourceV1 {
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
                .klines(
                    &symbol,
                    &self.interval,
                    None,
                    Some(end_ms),
                    Some(KLINE_LIMIT),
                )
                .await
                .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;
            let scale = u8::try_from(-i16::from(klines.price_exponent))
                .map_err(|_| PitObservationSourceErrorV1::Unavailable)?;
            let Some(bar) = last_closed_bar(&klines.klines, scope.event_effective()) else {
                continue;
            };

            for (field, mantissa) in [
                ("OPEN", bar.open_price),
                ("HIGH", bar.high_price),
                ("LOW", bar.low_price),
                ("CLOSE", bar.close_price),
            ] {
                let (value_mantissa, value_scale) = canonical_decimal(i128::from(mantissa), scale);
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

/// Returns the last bar that had already closed at the coordinate.
///
/// A bar whose close time equals the coordinate counts: it was complete at that instant. One that
/// closes later is still open there and states nothing about it.
fn last_closed_bar(
    klines: &[crate::spot::http::models::BinanceKline],
    event_effective_ns: u64,
) -> Option<&crate::spot::http::models::BinanceKline> {
    klines
        .iter()
        .filter(|bar| {
            u64::try_from(bar.close_time)
                .ok()
                .and_then(|micros| micros.checked_mul(1_000))
                .is_some_and(|close_ns| close_ns <= event_effective_ns)
        })
        .max_by_key(|bar| bar.close_time)
}

/// The Owner timeframe one Binance interval denotes.
///
/// Only intervals with an exact Owner unit are admitted. Binance's `1M` is a calendar month, which
/// has no fixed-length unit here and would silently become one minute, so it is refused.
/// The Owner timeframe label one interval denotes, or `None` for an interval with no label.
///
/// These are free-form binding labels, not timeframes. The timeframe is `TimeframeSpecV1`, whose
/// kind and unit are closed sets with no DAY and no WEEK, and whose "where does the period start"
/// lives in an anchor identity that a label cannot carry. So only labels that transcribe a legal
/// `step` and `unit` belong here.
///
/// Two labels in particular must not be added back. `1D` already means one named exchange session
/// day, and the Owner's own equity fixtures use it that way - `AAPL.CLOSE.EXCHANGE_SESSION_1D` -
/// so attaching it to this venue's continuous 24-hour interval would give one label two different
/// spec shapes, with the older use being the correct one. `1W` would need an anchor stating which
/// day a week begins on, and nobody has made that decision; a week is expressible without a new
/// unit as `step = 168, unit = HOUR` once someone does.
const fn owner_timeframe(interval: &str) -> Option<&'static str> {
    Some(match interval.as_bytes() {
        b"1s" => "1S",
        b"1m" => "1M",
        b"3m" => "3M",
        b"5m" => "5M",
        b"15m" => "15M",
        b"30m" => "30M",
        b"1h" => "1H",
        b"2h" => "2H",
        b"4h" => "4H",
        b"6h" => "6H",
        b"8h" => "8H",
        b"12h" => "12H",
        b"1d" => "24H",
        b"3d" => "72H",
        _ => return None,
    })
}

/// Reduces a fixed-point value to the one canonical decimal that denotes it.
///
/// The Owner admits no trailing zero under a non-zero scale, because one price with two spellings
/// would give one fact two digests.
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

#[cfg(test)]
mod tests {
    /// Every interval this table accepts, so the absence assertions below cover the whole table
    /// rather than the entries someone remembered to list.
    const ALL_INTERVALS: [&str; 14] = [
        "1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d",
    ];

    use rstest::rstest;

    use super::*;
    use crate::spot::http::models::BinanceKline;

    const MINUTE_NS: u64 = 60_000_000_000;
    const AT: u64 = 1_700_000_000_000_000_000;

    fn bar(close_time_micros: i64, close_price: i64) -> BinanceKline {
        BinanceKline {
            open_time: close_time_micros - 59_999_999,
            open_price: 100,
            high_price: 200,
            low_price: 50,
            close_price,
            volume: [0; 16],
            close_time: close_time_micros,
            quote_volume: [0; 16],
            num_trades: 1,
            taker_buy_base_volume: [0; 16],
            taker_buy_quote_volume: [0; 16],
        }
    }

    #[rstest]
    fn a_bar_still_open_at_the_coordinate_states_nothing_about_it() {
        let micros = i64::try_from(AT / 1_000).unwrap();
        let bars = [bar(micros + 1, 999)];
        assert!(
            last_closed_bar(&bars, AT).is_none(),
            "a bar closing after the coordinate cannot answer for it"
        );
    }

    #[rstest]
    fn a_bar_closing_exactly_at_the_coordinate_counts() {
        let micros = i64::try_from(AT / 1_000).unwrap();
        let bars = [bar(micros, 777)];
        assert_eq!(last_closed_bar(&bars, AT).unwrap().close_price, 777);
    }

    #[rstest]
    fn the_latest_already_closed_bar_wins() {
        let micros = i64::try_from(AT / 1_000).unwrap();
        let minute = i64::try_from(MINUTE_NS / 1_000).unwrap();
        let bars = [
            bar(micros - 2 * minute, 1),
            bar(micros - minute, 2),
            bar(micros + minute, 3),
        ];
        assert_eq!(
            last_closed_bar(&bars, AT).unwrap().close_price,
            2,
            "the answer is the last bar complete at the coordinate, not the newest fetched"
        );
    }

    #[rstest]
    fn only_intervals_with_an_exact_owner_unit_are_admitted() {
        assert_eq!(owner_timeframe("1m"), Some("1M"));
        assert_eq!(owner_timeframe("4h"), Some("4H"));
        assert_eq!(owner_timeframe("1d"), Some("24H"));
        assert_eq!(owner_timeframe("3d"), Some("72H"));
        // The two labels that must never come back. `1D` is taken: the Owner's equity fixtures
        // bind it as one named exchange session day, which this venue does not have. `1W` has no
        // anchor to say which day a week starts on. Asserting their absence is cheap; noticing
        // that a continuous 24-hour interval had quietly acquired a session-day label is not.
        for taken in ["1D", "3D", "1W"] {
            assert!(
                !ALL_INTERVALS
                    .iter()
                    .filter_map(|interval| owner_timeframe(interval))
                    .any(|label| label == taken),
                "{taken} must not be produced for a continuous-clock venue"
            );
        }
        assert_eq!(
            owner_timeframe("1M"),
            None,
            "a calendar month has no fixed-length Owner unit and must not become one minute"
        );
        assert_eq!(owner_timeframe("1w"), None);
        assert_eq!(owner_timeframe(""), None);
    }

    #[rstest]
    fn a_value_has_exactly_one_canonical_spelling() {
        assert_eq!(canonical_decimal(4_312_050_000, 8), (431_205, 4));
        assert_eq!(canonical_decimal(1, 8), (1, 8));
        assert_eq!(canonical_decimal(0, 8), (0, 0));
    }
}

#[cfg(test)]
mod live_tests {
    use std::collections::BTreeMap;

    use vibe_core::time::get_atomic_clock_realtime;
    use vibe_data::owner::pit_observation_source_v1::PitObservationScopeV1;

    use super::*;
    use crate::common::enums::BinanceEnvironment;

    /// Answers one Owner scope from the live public Binance endpoint.
    ///
    /// Binance klines need no credential and cost nothing, so this is `#[ignore]` only because it
    /// reaches the network. Verified live on 2026-09-17.
    #[tokio::test]
    #[ignore = "reaches the live public Binance endpoint"]
    async fn live_binance_answers_the_owner_scope() {
        let client = BinanceSpotHttpClient::new_with_json_responses(
            BinanceEnvironment::Live,
            get_atomic_clock_realtime(),
            None,
            None,
            None,
            None,
            Some(30),
            None,
            true,
        )
        .expect("the keyless public client builds");
        let members = BTreeMap::from([("BTCUSDT.BINANCE".to_string(), "BTCUSDT".to_string())]);
        let source = BinanceSpotBarObservationSourceV1::new(client, members, "1m")
            .expect("one admitted member and a mapped interval");

        // An instant well in the past, so the bar covering it has long since closed.
        let effective = 1_735_830_000_000_000_000_u64;
        let scope = PitObservationScopeV1::from_owner_request(
            vec!["BTCUSDT.BINANCE".to_string()],
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
            assert_eq!(row.member_key, "BTCUSDT.BINANCE");
            assert_eq!(row.data_kind, DATA_KIND);
            assert_eq!(row.timeframe, "1M");
            assert!(row.value_mantissa > 0, "an admitted price is positive");
            assert_eq!(row.event_effective, effective);
            assert_eq!(row.retrieval, effective);
        }
        let keys = rows
            .iter()
            .map(|r| r.symbolic_key.clone())
            .collect::<Vec<_>>();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "the batch is strictly ascending by key");
        eprintln!("live binance rows: {keys:?}");
    }
}
