//! Connects to the Bybit public WebSocket feed and streams specified market data topics.
//! Useful when manually validating the Rust WebSocket client implementation.

use std::error::Error;

use futures_util::StreamExt;
use tokio::{pin, signal};
use vibe_bybit::{
    common::enums::{BybitEnvironment, BybitProductType},
    websocket::{client::BybitWebSocketClient, messages::BybitWsMessage},
};
use vibe_network::websocket::TransportBackend;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let mut client = BybitWebSocketClient::new_public_with(
        BybitProductType::Linear,
        BybitEnvironment::Mainnet,
        None,
        20,
        TransportBackend::default(),
        None,
    );
    client.connect().await?;

    client
        .subscribe(vec![
            "orderbook.1.BTCUSDT".to_string(),
            "publicTrade.BTCUSDT".to_string(),
            "tickers.BTCUSDT".to_string(),
        ])
        .await?;

    let stream = client.stream();
    let shutdown = signal::ctrl_c();
    pin!(stream);
    pin!(shutdown);

    log::info!("Streaming Bybit market data; press Ctrl+C to exit");

    loop {
        tokio::select! {
            Some(event) = stream.next() => {
                match event {
                    BybitWsMessage::Orderbook(msg) => {
                        log::info!(
                            "orderbook: topic={}, type={}, count={}",
                            msg.topic, msg.msg_type, msg.data.b.len() + msg.data.a.len()
                        );
                    }
                    BybitWsMessage::Trade(msg) => {
                        for trade in &msg.data {
                            log::info!(
                                "trade: symbol={}, price={}, size={}, side={:?}",
                                trade.s, trade.p, trade.v, trade.taker_side
                            );
                        }
                    }
                    BybitWsMessage::Kline(msg) => {
                        for kline in &msg.data {
                            log::info!(
                                "kline: topic={}, close={}, confirm={}",
                                msg.topic, kline.close, kline.confirm
                            );
                        }
                    }
                    BybitWsMessage::TickerLinear(msg) => {
                        log::info!(
                            "ticker linear: symbol={}, last_price={:?}, mark_price={:?}",
                            msg.data.symbol, msg.data.last_price, msg.data.mark_price
                        );
                    }
                    BybitWsMessage::TickerOption(msg) => {
                        log::info!(
                            "ticker option: symbol={}, bid={}, ask={}",
                            msg.data.symbol, msg.data.bid_price, msg.data.ask_price
                        );
                    }
                    BybitWsMessage::Error(err) => {
                        log::warn!("WebSocket error: code={}, message={}", err.code, err.message);
                    }
                    BybitWsMessage::Reconnected => {
                        log::warn!("WebSocket reconnected");
                    }
                    BybitWsMessage::Auth(result) => {
                        log::info!("Auth result: success={:?}", result.success);
                    }
                    _ => {
                        log::trace!("Other message received");
                    }
                }
            }
            _ = &mut shutdown => {
                log::info!("Received Ctrl+C, closing connection");
                client.close().await?;
                break;
            }
            else => break,
        }
    }

    Ok(())
}
