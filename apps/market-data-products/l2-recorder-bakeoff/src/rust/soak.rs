use crossbeam_channel::{RecvTimeoutError, Sender, TrySendError, bounded};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tungstenite::Message;

use trade_l2_order_book_core::{FinalizedSegment, StreamingSegmentWriter};

const STREAM_BASE: &str = "wss://fstream.binance.com/public/stream?streams=";
const SNAPSHOT_URL: &str = "https://fapi.binance.com/fapi/v1/depth";

type Level = [String; 2];

#[derive(Debug)]
struct Arguments {
    symbol: String,
    duration_seconds: u64,
    queue_capacity: usize,
    segment_frames: usize,
    sync_every_frames: usize,
    max_book_levels: usize,
    force_disconnect_after: usize,
    output_base: PathBuf,
    yes_public_network: bool,
}

#[derive(Debug)]
struct RawMessage {
    raw: String,
    local_receive_time_ms: u64,
}

#[derive(Debug, Deserialize)]
struct CombinedEnvelope {
    data: DepthEvent,
}

#[derive(Debug, Deserialize)]
struct DepthEvent {
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

#[derive(Debug, Deserialize)]
struct Snapshot {
    #[serde(rename = "lastUpdateId")]
    last_update_id: u64,
    bids: Vec<Level>,
    asks: Vec<Level>,
}

#[derive(Serialize)]
struct PersistedFrame<'a> {
    schema_version: &'static str,
    local_receive_time_ms: u64,
    raw_payload: &'a str,
}

#[derive(Debug, Serialize)]
struct SoakEvidence {
    schema_version: &'static str,
    generated_at_ms: u64,
    run_id: String,
    symbol: String,
    verdict: &'static str,
    requested_duration_seconds: u64,
    elapsed_ms: u128,
    queue_capacity: usize,
    max_queue_depth: usize,
    segment_frames: usize,
    sync_every_frames: usize,
    max_book_levels: usize,
    force_disconnect_after: usize,
    connection_count: usize,
    resync_count: usize,
    total_received_messages: usize,
    total_recorded_events: usize,
    total_segments: usize,
    p95_event_lag_ms: u64,
    max_event_lag_ms: u64,
    incidents: Vec<Incident>,
    epochs: Vec<EpochEvidence>,
}

#[derive(Debug, Serialize)]
struct EpochEvidence {
    epoch: usize,
    started_at_ms: u64,
    snapshot: Option<SnapshotEvidence>,
    bridged: bool,
    received_messages: usize,
    recorded_events: usize,
    ignored_pre_snapshot_events: usize,
    last_update_id: Option<u64>,
    termination: String,
    segments: Vec<SegmentEvidence>,
}

#[derive(Debug, Serialize)]
struct SnapshotEvidence {
    path: String,
    sha256: String,
    last_update_id: u64,
    bid_levels: usize,
    ask_levels: usize,
}

#[derive(Debug, Serialize)]
struct SegmentEvidence {
    path: String,
    frame_count: usize,
    payload_bytes: usize,
    segment_bytes: usize,
    payload_hash: String,
    segment_hash: String,
    writer_elapsed_ns: u128,
}

#[derive(Clone, Debug, Serialize)]
struct Incident {
    epoch: usize,
    kind: String,
    detail: String,
}

#[derive(Debug)]
enum ReaderStop {
    DurationReached,
    ForcedDisconnect,
    QueueOverflow,
    ConsumerStopped,
    WebsocketClosed(String),
    ReadError(String),
}

enum SequenceDecision {
    Ignore,
    Accept,
    BridgeMiss {
        snapshot_last_update_id: u64,
        first_update_id: u64,
    },
    Gap {
        expected_previous_final_update_id: u64,
        actual_previous_final_update_id: u64,
    },
}

struct SequenceTracker {
    snapshot_last_update_id: u64,
    bridged: bool,
    last_update_id: u64,
}

struct LatencyHistogram {
    buckets: Vec<u64>,
    count: u64,
    maximum: u64,
}

impl LatencyHistogram {
    fn new() -> Self {
        Self {
            buckets: vec![0; 10_002],
            count: 0,
            maximum: 0,
        }
    }

    fn observe(&mut self, value_ms: u64) {
        let index = usize::try_from(value_ms)
            .unwrap_or(usize::MAX)
            .min(self.buckets.len() - 1);
        self.buckets[index] += 1;
        self.count += 1;
        self.maximum = self.maximum.max(value_ms);
    }

    fn percentile(&self, fraction: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        let target = (self.count as f64 * fraction).ceil() as u64;
        let mut cumulative = 0;
        for (index, count) in self.buckets.iter().enumerate() {
            cumulative += count;
            if cumulative >= target {
                return index as u64;
            }
        }
        self.maximum
    }
}

impl SequenceTracker {
    fn new(snapshot_last_update_id: u64) -> Self {
        Self {
            snapshot_last_update_id,
            bridged: false,
            last_update_id: snapshot_last_update_id,
        }
    }

    fn observe(&mut self, event: &DepthEvent) -> SequenceDecision {
        if !self.bridged {
            if event.final_update_id < self.snapshot_last_update_id {
                return SequenceDecision::Ignore;
            }
            if event.first_update_id > self.snapshot_last_update_id {
                return SequenceDecision::BridgeMiss {
                    snapshot_last_update_id: self.snapshot_last_update_id,
                    first_update_id: event.first_update_id,
                };
            }
            self.bridged = true;
            self.last_update_id = event.final_update_id;
            return SequenceDecision::Accept;
        }
        if event.pu != self.last_update_id {
            return SequenceDecision::Gap {
                expected_previous_final_update_id: self.last_update_id,
                actual_previous_final_update_id: event.pu,
            };
        }
        self.last_update_id = event.final_update_id;
        SequenceDecision::Accept
    }
}

struct RotatingWriter {
    output_directory: PathBuf,
    epoch: usize,
    segment_frames: usize,
    sync_every_frames: usize,
    next_segment: usize,
    current: Option<(String, StreamingSegmentWriter)>,
    completed: Vec<SegmentEvidence>,
}

impl RotatingWriter {
    fn new(
        output_directory: &Path,
        epoch: usize,
        segment_frames: usize,
        sync_every_frames: usize,
    ) -> Self {
        Self {
            output_directory: output_directory.to_path_buf(),
            epoch,
            segment_frames,
            sync_every_frames,
            next_segment: 1,
            current: None,
            completed: Vec::new(),
        }
    }

    fn append(&mut self, payload: &[u8]) -> Result<(), Box<dyn Error>> {
        if self.current.is_none() {
            let name = format!(
                "epoch-{:04}-segment-{:06}.tl2s",
                self.epoch, self.next_segment
            );
            let path = self.output_directory.join(&name);
            self.current = Some((
                name,
                StreamingSegmentWriter::create(path.to_str().ok_or("invalid segment path")?)?,
            ));
            self.next_segment += 1;
        }
        let (_, writer) = self.current.as_mut().ok_or("segment writer is missing")?;
        writer.append(payload)?;
        if writer.frame_count() % self.sync_every_frames == 0 {
            writer.sync()?;
        }
        if writer.frame_count() >= self.segment_frames {
            self.finalize_current()?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<SegmentEvidence>, Box<dyn Error>> {
        self.finalize_current()?;
        Ok(self.completed)
    }

    fn finalize_current(&mut self) -> Result<(), Box<dyn Error>> {
        if let Some((name, writer)) = self.current.take() {
            let finalized = writer.finalize()?;
            self.completed.push(segment_evidence(name, finalized));
        }
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    if !arguments.yes_public_network {
        return Err("public soak requires explicit --yes-public-network".into());
    }
    let run_started = Instant::now();
    let generated_at_ms = unix_time_ms()?;
    let run_id = format!(
        "{}-rust-soak-{}",
        arguments.symbol.to_lowercase(),
        generated_at_ms
    );
    fs::create_dir_all(&arguments.output_base)?;
    let output_directory = arguments.output_base.join(&run_id);
    fs::create_dir(&output_directory)?;
    let deadline = Instant::now() + Duration::from_secs(arguments.duration_seconds);
    let max_queue_depth = Arc::new(AtomicUsize::new(0));
    let mut epochs = Vec::new();
    let mut incidents = Vec::new();
    let mut event_lags = LatencyHistogram::new();
    let mut epoch_index = 0;
    while Instant::now() < deadline {
        epoch_index += 1;
        match run_epoch(
            &arguments,
            &output_directory,
            epoch_index,
            deadline,
            Arc::clone(&max_queue_depth),
            &mut event_lags,
        ) {
            Ok((epoch, incident)) => {
                if let Some(incident) = incident {
                    incidents.push(incident);
                }
                epochs.push(epoch);
            }
            Err(error) => {
                incidents.push(Incident {
                    epoch: epoch_index,
                    kind: "epoch_error".to_string(),
                    detail: error.to_string(),
                });
                epochs.push(EpochEvidence {
                    epoch: epoch_index,
                    started_at_ms: unix_time_ms()?,
                    snapshot: None,
                    bridged: false,
                    received_messages: 0,
                    recorded_events: 0,
                    ignored_pre_snapshot_events: 0,
                    last_update_id: None,
                    termination: "epoch_error".to_string(),
                    segments: Vec::new(),
                });
            }
        }
        if Instant::now() < deadline {
            thread::sleep(Duration::from_millis(200));
        }
    }
    let total_received_messages = epochs.iter().map(|epoch| epoch.received_messages).sum();
    let total_recorded_events = epochs.iter().map(|epoch| epoch.recorded_events).sum();
    let total_segments = epochs.iter().map(|epoch| epoch.segments.len()).sum();
    let hard_incident = incidents.iter().any(|incident| {
        matches!(
            incident.kind.as_str(),
            "queue_overflow" | "book_capacity_exceeded" | "sequence_gap" | "epoch_error"
        )
    });
    let verdict = if !hard_incident && total_recorded_events > 0 {
        "passed"
    } else {
        "failed"
    };
    let evidence = SoakEvidence {
        schema_version: "trade.l2-public-soak-evidence.v1",
        generated_at_ms,
        run_id: run_id.clone(),
        symbol: arguments.symbol.clone(),
        verdict,
        requested_duration_seconds: arguments.duration_seconds,
        elapsed_ms: run_started.elapsed().as_millis(),
        queue_capacity: arguments.queue_capacity,
        max_queue_depth: max_queue_depth.load(Ordering::Relaxed),
        segment_frames: arguments.segment_frames,
        sync_every_frames: arguments.sync_every_frames,
        max_book_levels: arguments.max_book_levels,
        force_disconnect_after: arguments.force_disconnect_after,
        connection_count: epochs.len(),
        resync_count: epochs.len().saturating_sub(1),
        total_received_messages,
        total_recorded_events,
        total_segments,
        p95_event_lag_ms: event_lags.percentile(0.95),
        max_event_lag_ms: event_lags.maximum,
        incidents,
        epochs,
    };
    let evidence_path = output_directory.join("evidence.json");
    write_create_new(&evidence_path, &serde_json::to_vec_pretty(&evidence)?)?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "output": evidence_path,
            "verdict": evidence.verdict,
            "connection_count": evidence.connection_count,
            "total_recorded_events": evidence.total_recorded_events,
            "total_segments": evidence.total_segments,
            "max_queue_depth": evidence.max_queue_depth,
            "incident_count": evidence.incidents.len(),
        }))?
    );
    if verdict != "passed" {
        return Err("public soak verdict failed; inspect evidence".into());
    }
    Ok(())
}

fn run_epoch(
    arguments: &Arguments,
    output_directory: &Path,
    epoch: usize,
    deadline: Instant,
    max_queue_depth: Arc<AtomicUsize>,
    event_lags: &mut LatencyHistogram,
) -> Result<(EpochEvidence, Option<Incident>), Box<dyn Error>> {
    let started_at_ms = unix_time_ms()?;
    let stream_url = format!(
        "{STREAM_BASE}{}@depth@100ms",
        arguments.symbol.to_lowercase()
    );
    let (socket, _) = tungstenite::connect(stream_url.as_str())?;
    let (sender, receiver) = bounded(arguments.queue_capacity);
    let stop = Arc::new(AtomicBool::new(false));
    let received = Arc::new(AtomicUsize::new(0));
    let reader = spawn_reader(
        socket,
        sender,
        Arc::clone(&stop),
        Arc::clone(&received),
        max_queue_depth,
        deadline,
        arguments.force_disconnect_after,
    );

    let (snapshot, snapshot_evidence) =
        match fetch_and_store_snapshot(arguments, output_directory, epoch) {
            Ok(value) => value,
            Err(error) => {
                stop.store(true, Ordering::Relaxed);
                let _ = reader.join();
                return Err(error);
            }
        };
    let mut book_bids: HashMap<String, String> = snapshot
        .bids
        .iter()
        .map(|[price, quantity]| (price.clone(), quantity.clone()))
        .collect();
    let mut book_asks: HashMap<String, String> = snapshot
        .asks
        .iter()
        .map(|[price, quantity]| (price.clone(), quantity.clone()))
        .collect();
    let mut tracker = SequenceTracker::new(snapshot.last_update_id);
    let mut writer = RotatingWriter::new(
        output_directory,
        epoch,
        arguments.segment_frames,
        arguments.sync_every_frames,
    );
    let mut recorded_events = 0;
    let mut ignored_pre_snapshot_events = 0;
    let mut incident = None;
    let mut requested_termination = None;

    loop {
        if Instant::now() >= deadline {
            requested_termination = Some("duration_reached".to_string());
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(raw) => {
                let event = parse_depth_message(&raw.raw, &arguments.symbol)?;
                match tracker.observe(&event) {
                    SequenceDecision::Ignore => ignored_pre_snapshot_events += 1,
                    SequenceDecision::Accept => {
                        apply_levels(&mut book_bids, &event.bids);
                        apply_levels(&mut book_asks, &event.asks);
                        let payload = serde_json::to_vec(&PersistedFrame {
                            schema_version: "trade.l2-raw-depth-frame.v1",
                            local_receive_time_ms: raw.local_receive_time_ms,
                            raw_payload: &raw.raw,
                        })?;
                        writer.append(&payload)?;
                        recorded_events += 1;
                        event_lags.observe(
                            raw.local_receive_time_ms
                                .saturating_sub(event.event_time_ms),
                        );
                        if book_bids.len() + book_asks.len() > arguments.max_book_levels {
                            incident = Some(Incident {
                                epoch,
                                kind: "book_capacity_exceeded".to_string(),
                                detail: format!(
                                    "book contains {} levels, limit is {}",
                                    book_bids.len() + book_asks.len(),
                                    arguments.max_book_levels
                                ),
                            });
                            requested_termination = Some("book_capacity_exceeded".to_string());
                            break;
                        }
                    }
                    SequenceDecision::BridgeMiss {
                        snapshot_last_update_id,
                        first_update_id,
                    } => {
                        incident = Some(Incident {
                            epoch,
                            kind: "snapshot_bridge_miss".to_string(),
                            detail: format!(
                                "snapshot lastUpdateId {snapshot_last_update_id} precedes first eligible U {first_update_id}"
                            ),
                        });
                        requested_termination = Some("snapshot_bridge_miss".to_string());
                        break;
                    }
                    SequenceDecision::Gap {
                        expected_previous_final_update_id,
                        actual_previous_final_update_id,
                    } => {
                        incident = Some(Incident {
                            epoch,
                            kind: "sequence_gap".to_string(),
                            detail: format!(
                                "expected previous u {expected_previous_final_update_id}, received pu {actual_previous_final_update_id}"
                            ),
                        });
                        requested_termination = Some("sequence_gap".to_string());
                        break;
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) if reader.is_finished() && receiver.is_empty() => break,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    stop.store(true, Ordering::Relaxed);
    let reader_stop = reader
        .join()
        .map_err(|_| "websocket reader thread panicked")?;
    let termination = requested_termination.unwrap_or_else(|| reader_stop_label(&reader_stop));
    if incident.is_none() {
        incident = reader_stop_incident(epoch, &reader_stop);
    }
    let segments = writer.finish()?;
    let _book_level_count = book_bids.len() + book_asks.len();
    Ok((
        EpochEvidence {
            epoch,
            started_at_ms,
            snapshot: Some(snapshot_evidence),
            bridged: tracker.bridged,
            received_messages: received.load(Ordering::Relaxed),
            recorded_events,
            ignored_pre_snapshot_events,
            last_update_id: tracker.bridged.then_some(tracker.last_update_id),
            termination,
            segments,
        },
        incident,
    ))
}

fn spawn_reader(
    mut socket: tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    sender: Sender<RawMessage>,
    stop: Arc<AtomicBool>,
    received: Arc<AtomicUsize>,
    max_queue_depth: Arc<AtomicUsize>,
    deadline: Instant,
    force_disconnect_after: usize,
) -> thread::JoinHandle<ReaderStop> {
    thread::spawn(move || {
        loop {
            if stop.load(Ordering::Relaxed) {
                let _ = socket.close(None);
                return ReaderStop::ConsumerStopped;
            }
            if Instant::now() >= deadline {
                let _ = socket.close(None);
                return ReaderStop::DurationReached;
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    let count = received.fetch_add(1, Ordering::Relaxed) + 1;
                    let message = RawMessage {
                        raw: text.to_string(),
                        local_receive_time_ms: unix_time_ms().unwrap_or(0),
                    };
                    match sender.try_send(message) {
                        Ok(()) => {}
                        Err(TrySendError::Full(_)) => {
                            let _ = socket.close(None);
                            return ReaderStop::QueueOverflow;
                        }
                        Err(TrySendError::Disconnected(_)) => {
                            let _ = socket.close(None);
                            return ReaderStop::ConsumerStopped;
                        }
                    }
                    update_max(&max_queue_depth, sender.len());
                    if force_disconnect_after > 0 && count >= force_disconnect_after {
                        let _ = socket.close(None);
                        return ReaderStop::ForcedDisconnect;
                    }
                }
                Ok(Message::Close(frame)) => {
                    return ReaderStop::WebsocketClosed(format!("{frame:?}"));
                }
                Ok(_) => {}
                Err(tungstenite::Error::ConnectionClosed) => {
                    return ReaderStop::WebsocketClosed("connection closed".to_string());
                }
                Err(error) => return ReaderStop::ReadError(error.to_string()),
            }
        }
    })
}

fn fetch_and_store_snapshot(
    arguments: &Arguments,
    output_directory: &Path,
    epoch: usize,
) -> Result<(Snapshot, SnapshotEvidence), Box<dyn Error>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;
    let raw = client
        .get(SNAPSHOT_URL)
        .query(&[("symbol", arguments.symbol.as_str()), ("limit", "1000")])
        .send()?
        .error_for_status()?
        .bytes()?;
    let snapshot: Snapshot = serde_json::from_slice(&raw)?;
    let name = format!("epoch-{epoch:04}-snapshot.json");
    write_create_new(&output_directory.join(&name), &raw)?;
    let evidence = SnapshotEvidence {
        path: name,
        sha256: format!("{:x}", Sha256::digest(&raw)),
        last_update_id: snapshot.last_update_id,
        bid_levels: snapshot.bids.len(),
        ask_levels: snapshot.asks.len(),
    };
    Ok((snapshot, evidence))
}

fn parse_depth_message(raw: &str, expected_symbol: &str) -> Result<DepthEvent, Box<dyn Error>> {
    let envelope: CombinedEnvelope = serde_json::from_str(raw)?;
    let event = envelope.data;
    if event.event_type != "depthUpdate" || event.symbol != expected_symbol {
        return Err("unexpected websocket depth message".into());
    }
    if event.transaction_time_ms > event.event_time_ms {
        return Err("transaction time exceeds event time".into());
    }
    Ok(event)
}

fn apply_levels(book: &mut HashMap<String, String>, levels: &[Level]) {
    for [price, quantity] in levels {
        if quantity.bytes().all(|value| value == b'0' || value == b'.') {
            book.remove(price);
        } else {
            book.insert(price.clone(), quantity.clone());
        }
    }
}

fn segment_evidence(path: String, value: FinalizedSegment) -> SegmentEvidence {
    SegmentEvidence {
        path,
        frame_count: value.frame_count,
        payload_bytes: value.payload_bytes,
        segment_bytes: value.segment_bytes,
        payload_hash: value.payload_hash,
        segment_hash: value.segment_hash,
        writer_elapsed_ns: value.elapsed_ns,
    }
}

fn reader_stop_label(stop: &ReaderStop) -> String {
    match stop {
        ReaderStop::DurationReached => "duration_reached",
        ReaderStop::ForcedDisconnect => "forced_disconnect",
        ReaderStop::QueueOverflow => "queue_overflow",
        ReaderStop::ConsumerStopped => "consumer_stopped",
        ReaderStop::WebsocketClosed(_) => "websocket_closed",
        ReaderStop::ReadError(_) => "read_error",
    }
    .to_string()
}

fn reader_stop_incident(epoch: usize, stop: &ReaderStop) -> Option<Incident> {
    match stop {
        ReaderStop::QueueOverflow => Some(Incident {
            epoch,
            kind: "queue_overflow".to_string(),
            detail: "bounded receiver queue reached capacity".to_string(),
        }),
        ReaderStop::WebsocketClosed(detail) => Some(Incident {
            epoch,
            kind: "websocket_closed".to_string(),
            detail: detail.clone(),
        }),
        ReaderStop::ReadError(detail) => Some(Incident {
            epoch,
            kind: "read_error".to_string(),
            detail: detail.clone(),
        }),
        ReaderStop::DurationReached
        | ReaderStop::ForcedDisconnect
        | ReaderStop::ConsumerStopped => None,
    }
}

fn write_create_new(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn update_max(maximum: &AtomicUsize, value: usize) {
    let mut current = maximum.load(Ordering::Relaxed);
    while value > current {
        match maximum.compare_exchange_weak(current, value, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break,
            Err(actual) => current = actual,
        }
    }
}

fn unix_time_ms() -> Result<u64, Box<dyn Error>> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}

fn parse_args(values: Vec<String>) -> Result<Arguments, Box<dyn Error>> {
    let mut symbol = "BTCUSDT".to_string();
    let mut duration_seconds = 60;
    let mut queue_capacity = 256;
    let mut segment_frames = 1000;
    let mut sync_every_frames = 100;
    let mut max_book_levels = 100_000;
    let mut force_disconnect_after = 0;
    let mut output_base = PathBuf::from("../../../tmp/l2-recorder-bakeoff/soak-rust");
    let mut yes_public_network = false;
    let mut index = 0;
    while index < values.len() {
        if values[index] == "--yes-public-network" {
            yes_public_network = true;
            index += 1;
            continue;
        }
        if index + 1 >= values.len() {
            return Err(format!("incomplete argument: {}", values[index]).into());
        }
        match values[index].as_str() {
            "--symbol" => symbol = values[index + 1].clone(),
            "--duration-seconds" => duration_seconds = values[index + 1].parse()?,
            "--queue-capacity" => queue_capacity = values[index + 1].parse()?,
            "--segment-frames" => segment_frames = values[index + 1].parse()?,
            "--sync-every-frames" => sync_every_frames = values[index + 1].parse()?,
            "--max-book-levels" => max_book_levels = values[index + 1].parse()?,
            "--force-disconnect-after" => force_disconnect_after = values[index + 1].parse()?,
            "--output-base" => output_base = PathBuf::from(&values[index + 1]),
            argument => return Err(format!("unknown argument: {argument}").into()),
        }
        index += 2;
    }
    if !symbol
        .bytes()
        .all(|value| value.is_ascii_uppercase() || value.is_ascii_digit())
        || symbol.len() < 5
        || symbol.len() > 20
    {
        return Err("symbol must be an uppercase Binance symbol".into());
    }
    if !(5..=86_400).contains(&duration_seconds) {
        return Err("duration-seconds must be between 5 and 86400".into());
    }
    if !(1..=1_000_000).contains(&queue_capacity)
        || !(1..=1_000_000).contains(&segment_frames)
        || !(1..=segment_frames).contains(&sync_every_frames)
        || !(2_000..=1_000_000).contains(&max_book_levels)
    {
        return Err("queue and segment bounds are invalid".into());
    }
    Ok(Arguments {
        symbol,
        duration_seconds,
        queue_capacity,
        segment_frames,
        sync_every_frames,
        max_book_levels,
        force_disconnect_after,
        output_base,
        yes_public_network,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_soak_default_book_capacity_supports_long_running_depth() {
        let arguments = parse_args(vec![]).expect("default arguments");
        assert_eq!(arguments.max_book_levels, 100_000);
    }

    fn event(first: u64, final_id: u64, previous: u64) -> DepthEvent {
        DepthEvent {
            event_type: "depthUpdate".to_string(),
            event_time_ms: 2,
            transaction_time_ms: 1,
            symbol: "BTCUSDT".to_string(),
            first_update_id: first,
            final_update_id: final_id,
            pu: previous,
            bids: Vec::new(),
            asks: Vec::new(),
        }
    }

    #[test]
    fn tracker_bridges_then_fails_closed_on_pu_gap() {
        let mut tracker = SequenceTracker::new(100);
        assert!(matches!(
            tracker.observe(&event(90, 99, 89)),
            SequenceDecision::Ignore
        ));
        assert!(matches!(
            tracker.observe(&event(99, 101, 98)),
            SequenceDecision::Accept
        ));
        assert!(matches!(
            tracker.observe(&event(102, 103, 101)),
            SequenceDecision::Accept
        ));
        assert!(matches!(
            tracker.observe(&event(104, 105, 999)),
            SequenceDecision::Gap { .. }
        ));
    }

    #[test]
    fn tracker_distinguishes_snapshot_bridge_miss_from_a_live_gap() {
        let mut tracker = SequenceTracker::new(100);
        assert!(matches!(
            tracker.observe(&event(101, 102, 99)),
            SequenceDecision::BridgeMiss { .. }
        ));
    }

    #[test]
    fn public_network_requires_an_explicit_flag() -> Result<(), Box<dyn Error>> {
        let arguments = parse_args(vec!["--duration-seconds".into(), "5".into()])?;
        assert!(!arguments.yes_public_network);
        Ok(())
    }
}
