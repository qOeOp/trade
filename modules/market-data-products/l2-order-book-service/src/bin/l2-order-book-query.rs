use anyhow::{Result, bail};
use serde_json::json;
use std::env;
use trade_l2_order_book_service::proto::l2_order_book_client::L2OrderBookClient;
use trade_l2_order_book_service::proto::{BookRequest, HealthRequest};

#[derive(Debug)]
struct Arguments {
    endpoint: String,
    symbol: String,
    action: String,
    depth: u32,
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
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "schema_version": value.schema_version,
                    "symbol": value.symbol,
                    "stream_epoch": value.stream_epoch,
                    "last_update_id": value.last_update_id,
                    "freshness_ms": value.freshness_ms,
                    "continuity_status": value.continuity_status,
                    "book_hash": value.book_hash,
                    "bid_levels": value.bids.len(),
                    "ask_levels": value.asks.len(),
                    "best_bid": value.bids.first().map(|level| [&level.price, &level.quantity]),
                    "best_ask": value.asks.first().map(|level| [&level.price, &level.quantity]),
                }))?
            );
        }
        value => bail!("action must be health or book, received {value}"),
    }
    Ok(())
}

fn parse_args(values: Vec<String>) -> Result<Arguments> {
    let mut arguments = Arguments {
        endpoint: "http://127.0.0.1:50061".to_string(),
        symbol: "BTCUSDT".to_string(),
        action: "health".to_string(),
        depth: 20,
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
            argument => bail!("unknown argument: {argument}"),
        }
        index += 2;
    }
    if arguments.depth > 5_000 {
        bail!("depth must not exceed 5000");
    }
    Ok(arguments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_defaults_to_bounded_local_health() {
        let value = parse_args(Vec::new()).expect("arguments");
        assert_eq!(value.endpoint, "http://127.0.0.1:50061");
        assert_eq!(value.action, "health");
        assert_eq!(value.depth, 20);
    }
}
