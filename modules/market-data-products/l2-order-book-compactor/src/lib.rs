use anyhow::{Context, Result, bail};
use arrow_array::{Array, RecordBatch, StringArray, UInt64Array};
use arrow_schema::{DataType, Field, Schema};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::arrow_writer::ArrowWriter;
use parquet::basic::{Compression, ZstdLevel};
use parquet::file::properties::WriterProperties;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use trade_l2_order_book_core::read_segment_frames;

pub const JOB_SCHEMA: &str = "trade.l2-compaction-job.v1";
pub const PROPOSAL_SCHEMA: &str = "trade.l2-compaction-proposal.v1";
pub const ROW_SCHEMA: &str = "trade.l2-parquet-row.v1";
pub const POLICY_VERSION: &str = "l2-raw-parquet-zstd-v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CompactionJob {
    pub schema_version: String,
    pub job_id: String,
    pub epoch_id: String,
    pub symbol: String,
    pub stream_epoch: String,
    pub source_manifest_path: String,
    pub source_manifest_hash: String,
    pub output_path: String,
    pub proposal_path: String,
    pub policy_version: String,
    pub batch_rows: usize,
}

#[derive(Clone, Debug, Deserialize)]
struct EpochManifest {
    schema_version: String,
    symbol: String,
    stream_epoch: String,
    continuity_status: String,
    recorded_frames: usize,
    segments: Vec<SegmentDescriptor>,
}

#[derive(Clone, Debug, Deserialize)]
struct SegmentDescriptor {
    path: String,
    frame_count: usize,
    segment_bytes: usize,
    segment_hash: String,
}

#[derive(Debug, Deserialize)]
struct PersistedFrame {
    schema_version: String,
    local_receive_time_ms: u64,
    raw_payload: String,
}

#[derive(Debug, Deserialize)]
struct CombinedEnvelope {
    data: DepthEvent,
}

#[derive(Debug, Deserialize)]
struct DepthEvent {
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct L2ParquetRow {
    pub schema_version: String,
    pub symbol: String,
    pub stream_epoch: String,
    pub frame_index: u64,
    pub local_receive_time_ms: u64,
    pub exchange_event_time_ms: u64,
    pub transaction_time_ms: u64,
    pub first_update_id: u64,
    pub final_update_id: u64,
    pub previous_final_update_id: u64,
    pub raw_payload_hash: String,
    pub raw_payload: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactionProposal {
    pub schema_version: String,
    pub job_id: String,
    pub epoch_id: String,
    pub symbol: String,
    pub stream_epoch: String,
    pub source_manifest_path: String,
    pub source_manifest_hash: String,
    pub policy_version: String,
    pub parquet_path: String,
    pub parquet_hash: String,
    pub parquet_bytes: u64,
    pub row_count: u64,
    pub first_local_receive_time_ms: u64,
    pub last_local_receive_time_ms: u64,
    pub first_final_update_id: u64,
    pub last_final_update_id: u64,
    pub created_at_ms: u64,
}

pub fn compact(
    repository_root: impl AsRef<Path>,
    job: &CompactionJob,
) -> Result<CompactionProposal> {
    validate_job(job)?;
    let root = repository_root.as_ref();
    let manifest_path = resolve_scoped(
        root,
        &job.source_manifest_path,
        &["data/l2", "tmp/l2-order-book-service"],
    )?;
    let manifest_bytes = fs::read(&manifest_path)?;
    if sha256_bytes(&manifest_bytes) != job.source_manifest_hash {
        bail!("source manifest hash mismatch");
    }
    let manifest: EpochManifest = serde_json::from_slice(&manifest_bytes)?;
    if manifest.schema_version != "trade.l2-epoch-manifest-proposal.v1"
        || manifest.continuity_status != "complete"
        || manifest.symbol != job.symbol
        || manifest.stream_epoch != job.stream_epoch
        || manifest.segments.is_empty()
    {
        bail!("source manifest is not the requested complete epoch");
    }
    let output = resolve_scoped(
        root,
        &job.output_path,
        &["data/l2-parquet", "tmp/l2-order-book-compactor"],
    )?;
    let proposal_path = resolve_scoped(
        root,
        &job.proposal_path,
        &["data/l2-parquet", "tmp/l2-order-book-compactor"],
    )?;
    if output.extension().and_then(|value| value.to_str()) != Some("parquet") {
        bail!("compaction output must use .parquet");
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = PathBuf::from(format!(
        "{}.partial.{}.{}",
        output.display(),
        std::process::id(),
        unix_ms()?
    ));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let schema = parquet_schema();
    let properties = WriterProperties::builder()
        .set_compression(Compression::ZSTD(ZstdLevel::try_new(3)?))
        .build();
    let mut writer = ArrowWriter::try_new(file, schema.clone(), Some(properties))?;
    let mut batch = RowBatch::default();
    let mut row_count = 0_u64;
    let mut first_receive = None;
    let mut last_receive = 0_u64;
    let mut first_update = None;
    let mut last_update = 0_u64;
    for descriptor in &manifest.segments {
        let segment_path = sibling(&manifest_path, &descriptor.path)?;
        let metadata = fs::metadata(&segment_path)?;
        if metadata.len() != descriptor.segment_bytes as u64
            || sha256_file(&segment_path)? != descriptor.segment_hash
        {
            bail!("segment evidence mismatch: {}", descriptor.path);
        }
        let frames = read_segment_frames(&segment_path)?;
        if frames.len() != descriptor.frame_count {
            bail!("segment frame count mismatch: {}", descriptor.path);
        }
        for frame in frames {
            let persisted: PersistedFrame = serde_json::from_slice(&frame)?;
            if persisted.schema_version != "trade.l2-raw-depth-frame.v1" {
                bail!("unsupported persisted frame schema");
            }
            let event: CombinedEnvelope = serde_json::from_str(&persisted.raw_payload)?;
            if event.data.symbol != job.symbol {
                bail!("frame symbol differs from compaction job");
            }
            row_count += 1;
            first_receive.get_or_insert(persisted.local_receive_time_ms);
            last_receive = persisted.local_receive_time_ms;
            first_update.get_or_insert(event.data.final_update_id);
            last_update = event.data.final_update_id;
            batch.push(L2ParquetRow {
                schema_version: ROW_SCHEMA.to_string(),
                symbol: job.symbol.clone(),
                stream_epoch: job.stream_epoch.clone(),
                frame_index: row_count,
                local_receive_time_ms: persisted.local_receive_time_ms,
                exchange_event_time_ms: event.data.event_time_ms,
                transaction_time_ms: event.data.transaction_time_ms,
                first_update_id: event.data.first_update_id,
                final_update_id: event.data.final_update_id,
                previous_final_update_id: event.data.pu,
                raw_payload_hash: sha256_bytes(persisted.raw_payload.as_bytes()),
                raw_payload: persisted.raw_payload,
            });
            if batch.len() >= job.batch_rows {
                writer.write(&batch.finish(schema.clone())?)?;
            }
        }
    }
    if !batch.is_empty() {
        writer.write(&batch.finish(schema)?)?;
    }
    if row_count != manifest.recorded_frames as u64 || row_count == 0 {
        bail!("compaction row count does not close source manifest");
    }
    writer.close()?;
    File::open(&temporary)?.sync_all()?;
    publish_create_new(&temporary, &output)?;
    let proposal = CompactionProposal {
        schema_version: PROPOSAL_SCHEMA.to_string(),
        job_id: job.job_id.clone(),
        epoch_id: job.epoch_id.clone(),
        symbol: job.symbol.clone(),
        stream_epoch: job.stream_epoch.clone(),
        source_manifest_path: job.source_manifest_path.clone(),
        source_manifest_hash: job.source_manifest_hash.clone(),
        policy_version: POLICY_VERSION.to_string(),
        parquet_path: job.output_path.clone(),
        parquet_hash: sha256_file(&output)?,
        parquet_bytes: fs::metadata(&output)?.len(),
        row_count,
        first_local_receive_time_ms: first_receive.context("first receive time")?,
        last_local_receive_time_ms: last_receive,
        first_final_update_id: first_update.context("first update id")?,
        last_final_update_id: last_update,
        created_at_ms: unix_ms()?,
    };
    let proposal_bytes = serde_json::to_vec_pretty(&proposal)?;
    write_atomic_create_new(&proposal_path, &proposal_bytes)?;
    Ok(proposal)
}

pub fn read_rows(path: impl AsRef<Path>, offset: usize, limit: usize) -> Result<Vec<L2ParquetRow>> {
    if limit == 0 || limit > 1_000 {
        bail!("read limit must be between 1 and 1000");
    }
    let file = File::open(path)?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(file)?
        .with_batch_size(limit.min(1_000))
        .build()?;
    let mut rows = Vec::new();
    let mut seen = 0_usize;
    for batch in reader {
        let batch = batch?;
        for index in 0..batch.num_rows() {
            if seen < offset {
                seen += 1;
                continue;
            }
            if rows.len() >= limit {
                return Ok(rows);
            }
            rows.push(row_from_batch(&batch, index)?);
            seen += 1;
        }
    }
    Ok(rows)
}

#[derive(Default)]
struct RowBatch {
    rows: Vec<L2ParquetRow>,
}

impl RowBatch {
    fn push(&mut self, row: L2ParquetRow) {
        self.rows.push(row);
    }
    fn len(&self) -> usize {
        self.rows.len()
    }
    fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
    fn finish(&mut self, schema: Arc<Schema>) -> Result<RecordBatch> {
        let rows = std::mem::take(&mut self.rows);
        Ok(RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| row.schema_version.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| row.symbol.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| row.stream_epoch.as_str()),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.frame_index),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.local_receive_time_ms),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.exchange_event_time_ms),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.transaction_time_ms),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.first_update_id),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.final_update_id),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|row| row.previous_final_update_id),
                )),
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| row.raw_payload_hash.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    rows.iter().map(|row| row.raw_payload.as_str()),
                )),
            ],
        )?)
    }
}

fn parquet_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("schema_version", DataType::Utf8, false),
        Field::new("symbol", DataType::Utf8, false),
        Field::new("stream_epoch", DataType::Utf8, false),
        Field::new("frame_index", DataType::UInt64, false),
        Field::new("local_receive_time_ms", DataType::UInt64, false),
        Field::new("exchange_event_time_ms", DataType::UInt64, false),
        Field::new("transaction_time_ms", DataType::UInt64, false),
        Field::new("first_update_id", DataType::UInt64, false),
        Field::new("final_update_id", DataType::UInt64, false),
        Field::new("previous_final_update_id", DataType::UInt64, false),
        Field::new("raw_payload_hash", DataType::Utf8, false),
        Field::new("raw_payload", DataType::Utf8, false),
    ]))
}

fn row_from_batch(batch: &RecordBatch, index: usize) -> Result<L2ParquetRow> {
    let text = |column: usize| -> Result<String> {
        Ok(batch
            .column(column)
            .as_any()
            .downcast_ref::<StringArray>()
            .context("Parquet string column type mismatch")?
            .value(index)
            .to_string())
    };
    let number = |column: usize| -> Result<u64> {
        Ok(batch
            .column(column)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .context("Parquet integer column type mismatch")?
            .value(index))
    };
    Ok(L2ParquetRow {
        schema_version: text(0)?,
        symbol: text(1)?,
        stream_epoch: text(2)?,
        frame_index: number(3)?,
        local_receive_time_ms: number(4)?,
        exchange_event_time_ms: number(5)?,
        transaction_time_ms: number(6)?,
        first_update_id: number(7)?,
        final_update_id: number(8)?,
        previous_final_update_id: number(9)?,
        raw_payload_hash: text(10)?,
        raw_payload: text(11)?,
    })
}

fn validate_job(job: &CompactionJob) -> Result<()> {
    if job.schema_version != JOB_SCHEMA
        || job.policy_version != POLICY_VERSION
        || job.job_id.is_empty()
        || job.epoch_id.is_empty()
        || job.symbol.is_empty()
        || job.stream_epoch.is_empty()
        || job.batch_rows == 0
        || job.batch_rows > 100_000
        || !is_hash(&job.source_manifest_hash)
    {
        bail!("invalid L2 compaction job");
    }
    Ok(())
}

fn resolve_scoped(root: &Path, value: &str, prefixes: &[&str]) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        bail!("compaction paths must be repository-relative without traversal");
    }
    if !prefixes
        .iter()
        .any(|prefix| value == *prefix || value.starts_with(&format!("{prefix}/")))
    {
        bail!("compaction path is outside its allowed roots");
    }
    Ok(root.join(path))
}

fn sibling(manifest: &Path, value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.components().count() != 1 {
        bail!("segment ref must be a sibling basename");
    }
    Ok(manifest.parent().context("manifest parent")?.join(path))
}

fn publish_create_new(temporary: &Path, output: &Path) -> Result<()> {
    match fs::hard_link(temporary, output) {
        Ok(()) => {
            fs::remove_file(temporary)?;
            sync_parent(output)?;
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(temporary);
            Err(error.into())
        }
    }
}

fn write_atomic_create_new(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = PathBuf::from(format!(
        "{}.partial.{}.{}",
        path.display(),
        std::process::id(),
        unix_ms()?
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    publish_create_new(&temporary, path)
}

fn sync_parent(path: &Path) -> Result<()> {
    File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
    Ok(())
}
fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn sha256_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn unix_ms() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use trade_l2_order_book_core::StreamingSegmentWriter;

    #[test]
    fn compact_and_read_preserves_ordered_raw_frames() {
        let root =
            std::env::temp_dir().join(format!("trade-l2-compactor-{}", unix_ms().expect("time")));
        let source_dir = root.join("tmp/l2-order-book-service/run");
        fs::create_dir_all(&source_dir).expect("source dir");
        let segment_path = source_dir.join("epoch-0001-segment-000001.tl2s");
        let mut writer = StreamingSegmentWriter::create(&segment_path).expect("writer");
        for id in [101_u64, 102] {
            let raw = serde_json::json!({"stream":"btcusdt@depth@100ms","data":{"E":1000+id,"T":999+id,"s":"BTCUSDT","U":id,"u":id,"pu":id-1,"b":[],"a":[]}}).to_string();
            writer.append(&serde_json::to_vec(&serde_json::json!({"schema_version":"trade.l2-raw-depth-frame.v1","local_receive_time_ms":2000+id,"raw_payload":raw})).expect("frame")).expect("append");
        }
        let descriptor = writer.finalize().expect("finalize");
        let manifest = serde_json::json!({
            "schema_version":"trade.l2-epoch-manifest-proposal.v1","symbol":"BTCUSDT","stream_epoch":"test-0001",
            "continuity_status":"complete","recorded_frames":2,"segments":[{"path":"epoch-0001-segment-000001.tl2s","frame_count":2,"segment_bytes":descriptor.segment_bytes,"segment_hash":descriptor.segment_hash}]
        });
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).expect("manifest");
        let manifest_path = source_dir.join("epoch-0001-manifest.json");
        fs::write(&manifest_path, &manifest_bytes).expect("write manifest");
        let job = CompactionJob {
            schema_version: JOB_SCHEMA.into(),
            job_id: "job-1".into(),
            epoch_id: "epoch-1".into(),
            symbol: "BTCUSDT".into(),
            stream_epoch: "test-0001".into(),
            source_manifest_path: "tmp/l2-order-book-service/run/epoch-0001-manifest.json".into(),
            source_manifest_hash: sha256_bytes(&manifest_bytes),
            output_path: "tmp/l2-order-book-compactor/BTCUSDT/test-0001.parquet".into(),
            proposal_path: "tmp/l2-order-book-compactor/BTCUSDT/test-0001.proposal.json".into(),
            policy_version: POLICY_VERSION.into(),
            batch_rows: 1,
        };
        let proposal = compact(&root, &job).expect("compact");
        assert_eq!(proposal.row_count, 2);
        let rows = read_rows(root.join(&proposal.parquet_path), 0, 10).expect("read");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].final_update_id, 101);
        assert_eq!(rows[1].frame_index, 2);
        assert!(compact(&root, &job).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
