use crate::config::Config;
use crate::persistence::{
    EpochManifest, create_run_directory, recover_orphan_partials, unix_time_ms, write_create_new,
    write_manifest,
};
use crate::state::SharedState;
use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep};
use tokio_tungstenite::tungstenite::Message;
use trade_l2_order_book_core::{
    DepthUpdate, RotatingSegmentWriter, SequenceDecision, SequenceTracker, Snapshot,
};

const STREAM_BASE: &str = "wss://fstream.binance.com/public/stream?streams=";
const SNAPSHOT_URL: &str = "https://fapi.binance.com/fapi/v1/depth";

type Level = [String; 2];

#[derive(Debug)]
struct RawMessage {
    raw: String,
    local_receive_time_ms: u64,
}

#[derive(Debug, Deserialize)]
struct CombinedEnvelope {
    data: BinanceDepthEvent,
}

#[derive(Debug, Deserialize)]
struct BinanceDepthEvent {
    #[serde(rename = "e")]
    event_type: String,
    #[serde(rename = "E")]
    event_time_ms: u64,
    #[serde(rename = "T")]
    transaction_time_ms: u64,
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "U")]
    first_update_id: u64,
    #[serde(rename = "u")]
    final_update_id: u64,
    pu: u64,
    #[serde(rename = "b")]
    bids: Vec<Level>,
    #[serde(rename = "a")]
    asks: Vec<Level>,
}

#[derive(Serialize)]
struct PersistedFrame<'a> {
    schema_version: &'static str,
    local_receive_time_ms: u64,
    raw_payload: &'a str,
}

pub async fn run(
    config: Config,
    state: SharedState,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let run_directory = create_run_directory(&config.output_base, &config.symbol)?;
    let recovered = recover_orphan_partials(&config.output_base, &run_directory)?;
    if !recovered.is_empty() {
        tracing::warn!(
            count = recovered.len(),
            "recovered orphan TL2S partial segments"
        );
    }
    let mut epoch = 0;
    let mut backoff_ms = 200_u64;
    while !*shutdown.borrow() {
        epoch += 1;
        match run_epoch(&config, &state, &run_directory, epoch, shutdown.clone()).await {
            Ok(EpochResult::Shutdown) => return Ok(()),
            Ok(EpochResult::Reconnect) => backoff_ms = 200,
            Err(error) => {
                let now = unix_time_ms()?;
                state
                    .mark_not_live("degraded", &error.to_string(), true, now)
                    .await;
                tracing::error!(epoch, error = %error, "L2 epoch failed");
                backoff_ms = (backoff_ms * 2).min(10_000);
            }
        }
        tokio::select! {
            _ = sleep(Duration::from_millis(backoff_ms)) => {}
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() { return Ok(()); }
            }
        }
    }
    Ok(())
}

enum EpochResult {
    Reconnect,
    Shutdown,
}

async fn run_epoch(
    config: &Config,
    state: &SharedState,
    run_directory: &Path,
    epoch: u64,
    mut shutdown: watch::Receiver<bool>,
) -> Result<EpochResult> {
    let started_at_ms = unix_time_ms()?;
    let stream_epoch = format!("{}-{:04}", started_at_ms, epoch);
    let stream_url = format!("{STREAM_BASE}{}@depth@100ms", config.symbol.to_lowercase());
    let (socket, _) = tokio_tungstenite::connect_async(&stream_url)
        .await
        .context("connect Binance public depth stream")?;
    let (reader_stop_tx, reader_stop_rx) = watch::channel(false);
    let (sender, mut receiver) = mpsc::channel(config.queue_capacity);
    let reader = spawn_reader(socket, sender, reader_stop_rx);

    let snapshot_result = fetch_snapshot(config, run_directory, epoch).await;
    let (snapshot, snapshot_ref, snapshot_hash) = match snapshot_result {
        Ok(value) => value,
        Err(error) => {
            reader_stop_tx.send_replace(true);
            let _ = reader.await;
            return Err(error);
        }
    };
    state
        .begin_epoch(
            stream_epoch.clone(),
            &snapshot,
            config.max_book_levels,
            unix_time_ms()?,
        )
        .await?;
    let mut tracker = SequenceTracker::new(snapshot.last_update_id);
    let mut writer = RotatingSegmentWriter::new(
        run_directory,
        epoch,
        config.segment_frames,
        config.sync_every_frames,
    )?;
    let epoch_deadline = Instant::now() + Duration::from_secs(config.epoch_seconds);
    let mut received_messages = 0;
    let mut recorded_frames = 0;
    let mut applied_events = 0;
    let mut termination_reason = "websocket_closed".to_string();
    let mut continuity_status = "complete".to_string();
    let mut shutdown_requested = false;

    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    termination_reason = "shutdown".to_string();
                    shutdown_requested = true;
                    break;
                }
            }
            _ = tokio::time::sleep_until(epoch_deadline) => {
                termination_reason = "scheduled_rotation".to_string();
                break;
            }
            message = receiver.recv() => {
                let Some(raw) = message else { break; };
                received_messages += 1;
                let persisted = serde_json::to_vec(&PersistedFrame {
                    schema_version: "trade.l2-raw-depth-frame.v1",
                    local_receive_time_ms: raw.local_receive_time_ms,
                    raw_payload: &raw.raw,
                })?;
                if let Err(error) = writer.append(&persisted) {
                    state.mark_writer_failed(&error.to_string(), unix_time_ms()?).await;
                    return Err(error.into());
                }
                recorded_frames += 1;
                let update = match parse_depth_message(
                    &raw.raw,
                    &config.symbol,
                    raw.local_receive_time_ms,
                ) {
                    Ok(value) => value,
                    Err(error) => {
                        termination_reason = "parse_failure".to_string();
                        continuity_status = "incomplete".to_string();
                        state.mark_not_live("resyncing", &error.to_string(), true, unix_time_ms()?).await;
                        break;
                    }
                };
                match tracker.observe(&update) {
                    SequenceDecision::Ignore => {}
                    SequenceDecision::Accept => {
                        match state.apply(&update, unix_time_ms()?).await {
                            Ok(()) => applied_events += 1,
                            Err(error) => {
                                termination_reason = format!("projection_failure:{error}");
                                continuity_status = "incomplete".to_string();
                                state.mark_not_live("resyncing", &termination_reason, true, unix_time_ms()?).await;
                                break;
                            }
                        }
                    }
                    SequenceDecision::BridgeMiss { snapshot_last_update_id, first_update_id } => {
                        termination_reason = format!("snapshot_bridge_miss:{snapshot_last_update_id}:{first_update_id}");
                        continuity_status = "incomplete".to_string();
                        state.mark_not_live("resyncing", &termination_reason, true, unix_time_ms()?).await;
                        break;
                    }
                    SequenceDecision::Gap { expected_previous_final_update_id, actual_previous_final_update_id } => {
                        termination_reason = format!("sequence_gap:{expected_previous_final_update_id}:{actual_previous_final_update_id}");
                        continuity_status = "incomplete".to_string();
                        state.mark_not_live("resyncing", &termination_reason, true, unix_time_ms()?).await;
                        break;
                    }
                }
            }
        }
    }
    reader_stop_tx.send_replace(true);
    let reader_reason = reader.await.context("reader task join")??;
    if receiver.is_closed() && termination_reason == "websocket_closed" {
        termination_reason = reader_reason;
        if termination_reason == "queue_overflow" || termination_reason.starts_with("read_error:") {
            continuity_status = "incomplete".to_string();
            state
                .mark_not_live("resyncing", &termination_reason, true, unix_time_ms()?)
                .await;
        }
    }
    let segments = writer.finish()?;
    if segments.is_empty() {
        continuity_status = "incomplete".to_string();
        termination_reason = format!("no_recorded_frames:{termination_reason}");
    }
    let finished_at_ms = unix_time_ms()?;
    let manifest = EpochManifest {
        schema_version: "trade.l2-epoch-manifest-proposal.v1",
        symbol: config.symbol.clone(),
        stream_epoch,
        started_at_ms,
        finished_at_ms,
        continuity_status: continuity_status.clone(),
        termination_reason: termination_reason.clone(),
        snapshot_ref,
        snapshot_hash,
        last_update_id: tracker.bridged().then_some(tracker.last_update_id()),
        received_messages,
        recorded_frames,
        applied_events,
        segments,
    };
    let path = write_manifest(run_directory, epoch, &manifest)?;
    tracing::info!(epoch, manifest = %path.display(), %continuity_status, %termination_reason, "L2 epoch finalized");
    state
        .mark_not_live(
            if shutdown_requested {
                "stopped"
            } else {
                "resyncing"
            },
            &termination_reason,
            false,
            finished_at_ms,
        )
        .await;
    Ok(if shutdown_requested {
        EpochResult::Shutdown
    } else {
        EpochResult::Reconnect
    })
}

fn spawn_reader(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    sender: mpsc::Sender<RawMessage>,
    mut stop: watch::Receiver<bool>,
) -> JoinHandle<Result<String>> {
    tokio::spawn(async move {
        let (_, mut reader) = socket.split();
        loop {
            tokio::select! {
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() { return Ok("consumer_stopped".to_string()); }
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            let raw = RawMessage {
                                raw: text.to_string(),
                                local_receive_time_ms: unix_time_ms()?,
                            };
                            match sender.try_send(raw) {
                                Ok(()) => {}
                                Err(mpsc::error::TrySendError::Full(_)) => return Ok("queue_overflow".to_string()),
                                Err(mpsc::error::TrySendError::Closed(_)) => return Ok("consumer_stopped".to_string()),
                            }
                        }
                        Some(Ok(Message::Close(frame))) => return Ok(format!("websocket_closed:{frame:?}")),
                        Some(Ok(_)) => {}
                        Some(Err(error)) => return Ok(format!("read_error:{error}")),
                        None => return Ok("websocket_closed:eof".to_string()),
                    }
                }
            }
        }
    })
}

async fn fetch_snapshot(
    config: &Config,
    run_directory: &Path,
    epoch: u64,
) -> Result<(Snapshot, String, String)> {
    let response = reqwest::Client::new()
        .get(SNAPSHOT_URL)
        .query(&[("symbol", config.symbol.as_str()), ("limit", "1000")])
        .send()
        .await?
        .error_for_status()?;
    let raw = response.bytes().await?;
    let snapshot: Snapshot = serde_json::from_slice(&raw)?;
    let snapshot_ref = format!("epoch-{epoch:04}-snapshot.json");
    write_create_new(&run_directory.join(&snapshot_ref), &raw)?;
    let snapshot_hash = format!("{:x}", Sha256::digest(&raw));
    Ok((snapshot, snapshot_ref, snapshot_hash))
}

fn parse_depth_message(
    raw: &str,
    expected_symbol: &str,
    receive_time_ms: u64,
) -> Result<DepthUpdate> {
    let event = serde_json::from_str::<CombinedEnvelope>(raw)?.data;
    if event.event_type != "depthUpdate" || event.symbol != expected_symbol {
        bail!("unexpected websocket depth message");
    }
    if event.transaction_time_ms > event.event_time_ms {
        bail!("transaction time exceeds event time");
    }
    if receive_time_ms == 0 {
        return Err(anyhow!("local receive time is missing"));
    }
    Ok(DepthUpdate {
        event_time_ms: event.event_time_ms,
        transaction_time_ms: event.transaction_time_ms,
        local_receive_time_ms: receive_time_ms,
        first_update_id: event.first_update_id,
        final_update_id: event.final_update_id,
        previous_final_update_id: event.pu,
        bids: event.bids,
        asks: event.asks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binance_event_maps_without_numeric_loss() {
        let update = parse_depth_message(
            r#"{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","E":2,"T":1,"s":"BTCUSDT","U":10,"u":11,"pu":9,"b":[["100.10","0.500"]],"a":[]}}"#,
            "BTCUSDT",
            3,
        )
        .expect("event");
        assert_eq!(update.first_update_id, 10);
        assert_eq!(update.bids[0][0], "100.10");
        assert_eq!(update.bids[0][1], "0.500");
    }
}
