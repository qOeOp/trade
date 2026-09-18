//! The venue side of one live market fact channel: Bybit's public trade stream.
//!
//! This client states what the venue publishes and nothing else. It holds no Source Binding, no
//! lineage, no Market Semantics identity and no sequence, because Market Data stamps all of those
//! and a client that could state them could place a value under a binding it was never admitted
//! for. The public stream needs no credential, which is why this is the one channel a deployment
//! can open without handing a secret to an adapter.
//!
//! Decoding a price is deliberately strict. The venue sends decimals as strings, and the Owner's
//! value is an exact mantissa and scale, so anything that is not a plain signed decimal is refused
//! rather than rounded: a price this client could not read exactly is not a price it may report.

use std::fmt::Debug;

use async_trait::async_trait;
use futures_util::StreamExt;
use vibe_data::owner::live_market_fact_v1::{
    LiveMarketFactSourceErrorV1, LiveMarketFactSourceV1, LiveMarketSubscriptionV1,
    VendorLiveObservationV1,
};

use vibe_network::websocket::config::TransportBackend;

use crate::{
    common::enums::{BybitEnvironment, BybitProductType},
    websocket::{
        client::BybitWebSocketClient,
        messages::{BybitWsMessage, BybitWsTradeMsg},
    },
};

/// The suffix the Owner's canonical identity carries for an instrument on this venue.
const VENUE_SUFFIX: &str = ".BYBIT";

/// Nanoseconds per millisecond; the venue timestamps in milliseconds.
const NANOS_PER_MILLI: u64 = 1_000_000;

/// The largest scale the Owner's fixed-point value admits.
const MAX_SCALE: u32 = 38;

/// Reads one venue decimal string as an exact mantissa and scale.
///
/// Trailing fractional zeroes are removed, because the same price must have one spelling: two
/// spellings would give one fact two identities and a consumer no way to tell them apart.
fn decimal_from_venue_v1(value: &str) -> Result<(i128, u8), LiveMarketFactSourceErrorV1> {
    let value = value.trim();
    if value.is_empty() {
        return Err(LiveMarketFactSourceErrorV1::Undecodable);
    }
    let (negative, digits) = match value.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, value),
    };
    let (whole, fraction) = match digits.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (digits, ""),
    };

    if whole.is_empty() && fraction.is_empty() {
        return Err(LiveMarketFactSourceErrorV1::Undecodable);
    }

    if !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(LiveMarketFactSourceErrorV1::Undecodable);
    }
    let fraction = fraction.trim_end_matches('0');
    let scale =
        u32::try_from(fraction.len()).map_err(|_| LiveMarketFactSourceErrorV1::Undecodable)?;

    if scale > MAX_SCALE {
        return Err(LiveMarketFactSourceErrorV1::Undecodable);
    }
    let mut mantissa: i128 = 0;

    for byte in whole.bytes().chain(fraction.bytes()) {
        mantissa = mantissa
            .checked_mul(10)
            .and_then(|value| value.checked_add(i128::from(byte - b'0')))
            .ok_or(LiveMarketFactSourceErrorV1::Undecodable)?;
    }

    if negative {
        mantissa = mantissa
            .checked_neg()
            .ok_or(LiveMarketFactSourceErrorV1::Undecodable)?;
    }
    let scale = u8::try_from(scale).map_err(|_| LiveMarketFactSourceErrorV1::Undecodable)?;
    Ok((mantissa, scale))
}

/// Maps one canonical Instrument Master identity to this venue's own symbol.
///
/// The rule is the client's, not the Owner's: the Owner never learns a venue symbol and the venue
/// never learns a canonical identity. An identity this client cannot map is refused rather than
/// guessed at, because subscribing to the wrong symbol would answer a question nobody asked.
fn venue_symbol_v1(instrument: &str) -> Option<&str> {
    let base = instrument.strip_suffix(VENUE_SUFFIX)?;
    (!base.is_empty()).then_some(base)
}

/// Turns one public trade message into the observations the Owner's subscription admits.
///
/// A trade for a symbol outside the subscription is refused, not dropped. This connection carries
/// exactly the subscription the Owner issued, so anything else on it is the venue answering a
/// question nobody asked, and trimming it away would hide that. A trade this client cannot read
/// exactly is an error too, because that is a defect in the decoding rather than in the market.
fn observations_from_trades_v1(
    message: &BybitWsTradeMsg,
    subscription: &LiveMarketSubscriptionV1,
) -> Result<Vec<VendorLiveObservationV1>, LiveMarketFactSourceErrorV1> {
    // The envelope stamp is when the venue published the batch. It is the only provider-available
    // instant the venue actually states; reusing the trade's own instant for it would assert that
    // the venue published each trade at the moment it happened, which is not what it said.
    let provider_available = millis_to_nanos_v1(message.ts)?;
    let mut observations = Vec::with_capacity(message.data.len());

    for trade in &message.data {
        let venue_symbol = trade.s.as_str();
        let Some(instrument) = subscription
            .instruments()
            .iter()
            .find(|instrument| venue_symbol_v1(instrument) == Some(venue_symbol))
        else {
            return Err(LiveMarketFactSourceErrorV1::ScopeMismatch);
        };
        let (value_mantissa, value_scale) = decimal_from_venue_v1(&trade.p)?;
        observations.push(VendorLiveObservationV1 {
            instrument: instrument.clone(),
            value_mantissa,
            value_scale,
            event_effective: millis_to_nanos_v1(trade.t)?,
            provider_available,
        });
    }
    Ok(observations)
}

fn millis_to_nanos_v1(millis: i64) -> Result<u64, LiveMarketFactSourceErrorV1> {
    u64::try_from(millis)
        .map_err(|_| LiveMarketFactSourceErrorV1::Undecodable)?
        .checked_mul(NANOS_PER_MILLI)
        .ok_or(LiveMarketFactSourceErrorV1::Undecodable)
}

/// One Bybit public trade stream, already connected and subscribed.
///
/// The client is held for the life of the source, so the feed task it spawned ends when the source
/// is closed rather than outliving it for the life of the process.
pub struct BybitPublicTradeSourceV1 {
    client: tokio::sync::Mutex<BybitWebSocketClient>,
    stream: tokio::sync::Mutex<
        Option<std::pin::Pin<Box<dyn futures_util::Stream<Item = BybitWsMessage> + Send>>>,
    >,
    instruments: Vec<String>,
}

impl Debug for BybitPublicTradeSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(BybitPublicTradeSourceV1))
            .field("instruments", &self.instruments.len())
            .finish_non_exhaustive()
    }
}

impl BybitPublicTradeSourceV1 {
    /// Connects the public stream and subscribes to exactly the Owner's subscription.
    ///
    /// The topics come from the subscription the Owner issued, so this connection carries what the
    /// Owner vouched for and nothing else. That is what lets a symbol outside it be treated as the
    /// venue answering wrongly rather than as another channel's traffic.
    ///
    /// # Errors
    ///
    /// `ScopeUnusable` when an instrument carries no symbol this venue could serve, `Unavailable`
    /// when the venue refuses the connection or the subscription.
    pub async fn connect(
        product_type: BybitProductType,
        environment: BybitEnvironment,
        subscription: &LiveMarketSubscriptionV1,
        heartbeat_secs: u64,
    ) -> Result<Self, LiveMarketFactSourceErrorV1> {
        let mut topics = Vec::with_capacity(subscription.instruments().len());

        for instrument in subscription.instruments() {
            let symbol =
                venue_symbol_v1(instrument).ok_or(LiveMarketFactSourceErrorV1::ScopeUnusable)?;
            topics.push(format!("publicTrade.{symbol}"));
        }

        if topics.is_empty() {
            return Err(LiveMarketFactSourceErrorV1::ScopeUnusable);
        }
        let mut client = BybitWebSocketClient::new_public_with(
            product_type,
            environment,
            None,
            heartbeat_secs,
            TransportBackend::default(),
            None,
        );
        client
            .connect()
            .await
            .map_err(|_| LiveMarketFactSourceErrorV1::Unavailable)?;
        client
            .subscribe(topics)
            .await
            .map_err(|_| LiveMarketFactSourceErrorV1::Unavailable)?;
        let stream = client.stream();
        Ok(Self {
            client: tokio::sync::Mutex::new(client),
            stream: tokio::sync::Mutex::new(Some(Box::pin(stream))),
            instruments: subscription.instruments().to_vec(),
        })
    }

    /// Closes the venue connection and stops the feed task it spawned.
    ///
    /// # Errors
    ///
    /// `Unavailable` when the venue connection could not be shut down cleanly.
    pub async fn close(&self) -> Result<(), LiveMarketFactSourceErrorV1> {
        self.stream.lock().await.take();
        self.client
            .lock()
            .await
            .close()
            .await
            .map_err(|_| LiveMarketFactSourceErrorV1::Unavailable)
    }
}

#[async_trait]
impl LiveMarketFactSourceV1 for BybitPublicTradeSourceV1 {
    async fn next_batch(
        &self,
        subscription: &LiveMarketSubscriptionV1,
    ) -> Result<Vec<VendorLiveObservationV1>, LiveMarketFactSourceErrorV1> {
        // The connection was made for one exact scope. Answering a different one would report
        // trades nobody subscribed to, so it is refused rather than served from the wrong socket.
        if subscription.instruments() != self.instruments.as_slice() {
            return Err(LiveMarketFactSourceErrorV1::ScopeMismatch);
        }
        let mut guard = self.stream.lock().await;
        let stream = guard
            .as_mut()
            .ok_or(LiveMarketFactSourceErrorV1::Unavailable)?;

        loop {
            let Some(message) = stream.next().await else {
                // The venue closed the stream. Dropping it here means a later call says
                // unavailable rather than waiting forever on a receiver nobody feeds.
                *guard = None;
                return Err(LiveMarketFactSourceErrorV1::Unavailable);
            };

            if let BybitWsMessage::Trade(trades) = message {
                let observations = observations_from_trades_v1(&trades, subscription)?;

                if !observations.is_empty() {
                    return Ok(observations);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use ustr::Ustr;
    use vibe_data::owner::strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel};

    use super::*;

    fn subscription() -> LiveMarketSubscriptionV1 {
        LiveMarketSubscriptionV1::issue_v1(
            vec!["BTCUSDT.BYBIT".to_string()],
            StrategyInputChannel::Market,
            MarketDataFieldSemantic::TradeLastPrice,
        )
        .expect("one instrument is a usable scope")
    }

    fn trade(symbol: &str, price: &str, millis: i64) -> crate::websocket::messages::BybitWsTrade {
        crate::websocket::messages::BybitWsTrade {
            t: millis,
            s: Ustr::from(symbol),
            taker_side: crate::common::enums::BybitOrderSide::Buy,
            v: "0.01".to_string(),
            p: price.to_string(),
            i: "trade-1".to_string(),
            bt: false,
            l: None,
            id: None,
            m_p: None,
            i_p: None,
            m_iv: None,
            iv: None,
        }
    }

    fn message(trades: Vec<crate::websocket::messages::BybitWsTrade>, ts: i64) -> BybitWsTradeMsg {
        BybitWsTradeMsg {
            topic: Ustr::from("publicTrade.BTCUSDT"),
            msg_type: Ustr::from("snapshot"),
            ts,
            data: trades,
        }
    }

    #[rstest]
    #[case("80306.99", 8_030_699_i128, 2_u8)]
    #[case("80306.990", 8_030_699_i128, 2_u8)]
    #[case("80306", 80_306_i128, 0_u8)]
    #[case("-0.5", -5_i128, 1_u8)]
    #[case("0.00000001", 1_i128, 8_u8)]
    fn a_venue_decimal_reads_as_one_exact_mantissa_and_scale(
        #[case] value: &str,
        #[case] mantissa: i128,
        #[case] scale: u8,
    ) {
        assert_eq!(decimal_from_venue_v1(value), Ok((mantissa, scale)));
    }

    #[rstest]
    #[case("")]
    #[case("8e4")]
    #[case("80,306.99")]
    #[case("80306.99.1")]
    #[case("abc")]
    #[case(".")]
    fn anything_this_client_cannot_read_exactly_is_refused(#[case] value: &str) {
        assert_eq!(
            decimal_from_venue_v1(value),
            Err(LiveMarketFactSourceErrorV1::Undecodable)
        );
    }

    #[rstest]
    fn a_trade_becomes_one_observation_with_the_venue_instants_and_nothing_owner_side() {
        let observations = observations_from_trades_v1(
            &message(
                vec![trade("BTCUSDT", "80306.99", 1_700_000_000_123)],
                1_700_000_000_456,
            ),
            &subscription(),
        )
        .expect("an in-scope trade decodes");
        let [observation] = observations.as_slice() else {
            panic!("exactly one observation");
        };
        assert_eq!(observation.instrument, "BTCUSDT.BYBIT");
        assert_eq!(observation.value_mantissa, 8_030_699);
        assert_eq!(observation.value_scale, 2);
        assert_eq!(observation.event_effective, 1_700_000_000_123_000_000);
        assert_eq!(
            observation.provider_available, 1_700_000_000_456_000_000,
            "publication is the venue's own envelope stamp, not the trade instant"
        );
    }

    #[rstest]
    fn a_symbol_outside_the_subscription_refuses_the_batch() {
        assert_eq!(
            observations_from_trades_v1(
                &message(
                    vec![trade("ETHUSDT", "3000.5", 1_700_000_000_123)],
                    1_700_000_000_456,
                ),
                &subscription(),
            ),
            Err(LiveMarketFactSourceErrorV1::ScopeMismatch),
            "this connection carries the Owner's scope, so anything else is the venue answering wrongly"
        );
    }

    #[rstest]
    fn a_price_that_cannot_be_read_exactly_fails_the_batch() {
        assert_eq!(
            observations_from_trades_v1(
                &message(
                    vec![trade("BTCUSDT", "8e4", 1_700_000_000_123)],
                    1_700_000_000_456,
                ),
                &subscription(),
            ),
            Err(LiveMarketFactSourceErrorV1::Undecodable)
        );
    }

    #[rstest]
    fn a_venue_stamp_this_client_cannot_place_in_time_fails_the_batch() {
        assert_eq!(
            observations_from_trades_v1(
                &message(vec![trade("BTCUSDT", "80306.99", -1)], 1_700_000_000_456),
                &subscription(),
            ),
            Err(LiveMarketFactSourceErrorV1::Undecodable)
        );
        assert_eq!(
            observations_from_trades_v1(
                &message(vec![trade("BTCUSDT", "80306.99", 1_700_000_000_123)], -1),
                &subscription(),
            ),
            Err(LiveMarketFactSourceErrorV1::Undecodable)
        );
    }

    #[rstest]
    #[case("BTCUSDT.BYBIT", Some("BTCUSDT"))]
    #[case("BTCUSDT.BINANCE", None)]
    #[case(".BYBIT", None)]
    #[case("BTCUSDT", None)]
    fn only_a_canonical_identity_for_this_venue_maps_to_a_symbol(
        #[case] instrument: &str,
        #[case] symbol: Option<&str>,
    ) {
        assert_eq!(venue_symbol_v1(instrument), symbol);
    }
}
