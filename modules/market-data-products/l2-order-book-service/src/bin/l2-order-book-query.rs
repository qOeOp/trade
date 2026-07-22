use anyhow::{Result, bail};
use serde_json::json;
use std::env;
use std::time::Duration;
use trade_l2_order_book_service::proto::l2_order_book_client::L2OrderBookClient;
use trade_l2_order_book_service::proto::{
    BookRequest, BookSnapshot, BookWatermark, HealthRequest, WatchRequest,
};

#[derive(Debug)]
struct Arguments {
    endpoint: String,
    symbol: String,
    action: String,
    depth: u32,
    max_events: usize,
    watch_ms: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    let mut client = L2OrderBookClient::connect(arguments.endpoint).await?;
    match arguments.action.as_str() {
        "health" => {
            let value = client
                .get_health(HealthRequest {
                    symbol: arguments.symbol,
                })
                .await?
                .into_inner();
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "schema_version": value.schema_version,
                    "symbol": value.symbol,
                    "service_status": value.service_status,
                    "stream_epoch": value.stream_epoch,
                    "continuity_status": value.continuity_status,
                    "source_ready": value.source_ready,
                    "raw_writer_ready": value.raw_writer_ready,
                    "projector_ready": value.projector_ready,
                    "read_ready": value.read_ready,
                    "broker_enabled": value.broker_enabled,
                    "broker_ready": value.broker_ready,
                    "last_update_id": value.last_update_id,
                    "last_receive_time_ms": value.last_receive_time_ms,
                    "freshness_ms": value.freshness_ms,
                    "incident_count": value.incident_count,
                    "last_incident": value.last_incident,
                }))?
            );
        }
        "book" => {
            let value = client
                .get_current_book(BookRequest {
                    symbol: arguments.symbol,
                    depth: arguments.depth,
                })
                .await?
                .into_inner();
            println!("{}", serde_json::to_string(&current_book_json(value))?);
        }
        "watch" => {
            let mut stream = client
                .watch_book(WatchRequest {
                    symbol: arguments.symbol.clone(),
                })
                .await?
                .into_inner();
            let deadline = tokio::time::Instant::now() + Duration::from_millis(arguments.watch_ms);
            let mut events = Vec::new();
            let mut timed_out = false;
            while events.len() < arguments.max_events {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    timed_out = true;
                    break;
                }
                match tokio::time::timeout(remaining, stream.message()).await {
                    Ok(Ok(Some(value))) => events.push(watermark_json(value)),
                    Ok(Ok(None)) => break,
                    Ok(Err(error)) => return Err(error.into()),
                    Err(_) => {
                        timed_out = true;
                        break;
                    }
                }
            }
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "schema_version": "trade.l2-book-watch-batch.v1",
                    "symbol": arguments.symbol,
                    "max_events": arguments.max_events,
                    "watch_ms": arguments.watch_ms,
                    "timed_out": timed_out,
                    "events": events,
                }))?
            );
        }
        value => bail!("action must be health, book, or watch, received {value}"),
    }
    Ok(())
}

fn watermark_json(value: BookWatermark) -> serde_json::Value {
    json!({
        "schema_version": value.schema_version,
        "symbol": value.symbol,
        "stream_epoch": value.stream_epoch,
        "last_update_id": value.last_update_id,
        "local_receive_time_ms": value.local_receive_time_ms,
        "published_at_ms": value.published_at_ms,
        "continuity_status": value.continuity_status,
        "resync_required": value.resync_required,
    })
}

fn current_book_json(value: BookSnapshot) -> serde_json::Value {
    let bids: Vec<[String; 2]> = value
        .bids
        .into_iter()
        .map(|level| [level.price, level.quantity])
        .collect();
    let asks: Vec<[String; 2]> = value
        .asks
        .into_iter()
        .map(|level| [level.price, level.quantity])
        .collect();
    json!({
        "schema_version": value.schema_version,
        "symbol": value.symbol,
        "stream_epoch": value.stream_epoch,
        "last_update_id": value.last_update_id,
        "exchange_event_time_ms": value.exchange_event_time_ms,
        "exchange_transaction_time_ms": value.exchange_transaction_time_ms,
        "local_receive_time_ms": value.local_receive_time_ms,
        "published_at_ms": value.published_at_ms,
        "freshness_ms": value.freshness_ms,
        "continuity_status": value.continuity_status,
        "book_hash": value.book_hash,
        "bid_levels": bids.len(),
        "ask_levels": asks.len(),
        "best_bid": bids.first(),
        "best_ask": asks.first(),
        "bids": bids,
        "asks": asks,
    })
}

fn parse_args(values: Vec<String>) -> Result<Arguments> {
    let mut arguments = Arguments {
        endpoint: "http://127.0.0.1:50061".to_string(),
        symbol: "BTCUSDT".to_string(),
        action: "health".to_string(),
        depth: 20,
        max_events: 20,
        watch_ms: 1_000,
    };
    let mut index = 0;
    while index < values.len() {
        if index + 1 >= values.len() {
            bail!("incomplete argument: {}", values[index]);
        }
        match values[index].as_str() {
            "--endpoint" => arguments.endpoint = values[index + 1].clone(),
            "--symbol" => arguments.symbol = values[index + 1].clone(),
            "--action" => arguments.action = values[index + 1].clone(),
            "--depth" => arguments.depth = values[index + 1].parse()?,
            "--max-events" => arguments.max_events = values[index + 1].parse()?,
            "--watch-ms" => arguments.watch_ms = values[index + 1].parse()?,
            argument => bail!("unknown argument: {argument}"),
        }
        index += 2;
    }
    if arguments.depth > 5_000 {
        bail!("depth must not exceed 5000");
    }
    if arguments.max_events == 0 || arguments.max_events > 100 {
        bail!("max-events must be between 1 and 100");
    }
    if !(100..=5_000).contains(&arguments.watch_ms) {
        bail!("watch-ms must be between 100 and 5000");
    }
    Ok(arguments)
}

#[cfg(test)]
mod tests {
    use super::*;
    use trade_l2_order_book_service::proto::PriceLevel;

    #[test]
    fn query_defaults_to_bounded_local_health() {
        let value = parse_args(Vec::new()).expect("arguments");
        assert_eq!(value.endpoint, "http://127.0.0.1:50061");
        assert_eq!(value.action, "health");
        assert_eq!(value.depth, 20);
        assert_eq!(value.max_events, 20);
        assert_eq!(value.watch_ms, 1_000);
    }

    #[test]
    fn current_book_output_preserves_bounded_levels_and_times() {
        let value = current_book_json(BookSnapshot {
            schema_version: "trade.l2-current-book.v1".to_string(),
            symbol: "BTCUSDT".to_string(),
            stream_epoch: "epoch-1".to_string(),
            last_update_id: 42,
            exchange_event_time_ms: 10,
            exchange_transaction_time_ms: 9,
            local_receive_time_ms: 11,
            published_at_ms: 12,
            freshness_ms: 2,
            continuity_status: "live".to_string(),
            book_hash: "a".repeat(64),
            bids: vec![PriceLevel {
                price: "100".to_string(),
                quantity: "2".to_string(),
            }],
            asks: vec![PriceLevel {
                price: "101".to_string(),
                quantity: "3".to_string(),
            }],
        });
        assert_eq!(value["exchange_event_time_ms"], 10);
        assert_eq!(value["published_at_ms"], 12);
        assert_eq!(value["bids"][0][0], "100");
        assert_eq!(value["asks"][0][1], "3");
        assert_eq!(value["best_bid"][0], "100");
    }

    #[test]
    fn query_bounds_watch_controls() {
        let value = parse_args(vec![
            "--action".to_string(),
            "watch".to_string(),
            "--max-events".to_string(),
            "5".to_string(),
            "--watch-ms".to_string(),
            "250".to_string(),
        ])
        .expect("watch arguments");
        assert_eq!(value.action, "watch");
        assert_eq!(value.max_events, 5);
        assert_eq!(value.watch_ms, 250);
        assert!(parse_args(vec!["--max-events".to_string(), "101".to_string()]).is_err());
        assert!(parse_args(vec!["--watch-ms".to_string(), "99".to_string()]).is_err());
    }
}
