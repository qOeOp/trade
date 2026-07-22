use anyhow::{Context, Result};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use trade_l2_order_book_core::{SegmentDescriptor, recover_segment, salvage_segment};

#[derive(Debug, Serialize)]
pub struct EpochManifest {
    pub schema_version: &'static str,
    pub symbol: String,
    pub stream_epoch: String,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub continuity_status: String,
    pub termination_reason: String,
    pub snapshot_ref: String,
    pub snapshot_hash: String,
    pub last_update_id: Option<u64>,
    pub received_messages: usize,
    pub recorded_frames: usize,
    pub applied_events: usize,
    pub segments: Vec<SegmentDescriptor>,
}

#[derive(Debug, Serialize)]
pub struct RecoveryRecord {
    pub partial_ref: String,
    pub salvage_ref: String,
    pub source_status: String,
    pub valid_frame_count: usize,
    pub valid_bytes: usize,
    pub payload_hash: String,
}

pub fn create_run_directory(base: &Path, symbol: &str) -> Result<PathBuf> {
    fs::create_dir_all(base)?;
    let directory = base.join(format!(
        "{}-{}-{}",
        symbol.to_lowercase(),
        unix_time_ms()?,
        std::process::id()
    ));
    fs::create_dir(&directory)?;
    sync_parent(&directory)?;
    Ok(directory)
}

pub fn write_create_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync_parent(path)?;
    Ok(())
}

pub fn write_manifest(directory: &Path, epoch: u64, manifest: &EpochManifest) -> Result<PathBuf> {
    let path = directory.join(format!("epoch-{epoch:04}-manifest.json"));
    write_atomic_create_new(&path, &serde_json::to_vec_pretty(manifest)?)?;
    Ok(path)
}

fn write_atomic_create_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = PathBuf::from(format!(
        "{}.partial.{}.{}",
        path.display(),
        std::process::id(),
        unix_time_ms()?
    ));
    write_create_new(&temporary, bytes)?;
    match fs::hard_link(&temporary, path) {
        Ok(()) => {
            fs::remove_file(&temporary)?;
            sync_parent(path)?;
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error).with_context(|| format!("publish create-new {}", path.display()))
        }
    }
}

pub fn recover_orphan_partials(
    base: &Path,
    report_directory: &Path,
) -> Result<Vec<RecoveryRecord>> {
    let mut partials = Vec::new();
    collect_partials(base, &mut partials)?;
    let mut records = Vec::new();
    for partial in partials {
        let recovered = recover_segment(&partial)?;
        if recovered.valid_frame_count == 0 {
            anyhow::bail!(
                "orphan partial has no recoverable frame: {}",
                partial.display()
            );
        }
        let salvage = PathBuf::from(format!("{}.salvaged.tl2s", partial.display()));
        if salvage.exists() {
            let existing = recover_segment(&salvage)?;
            if existing.status != "complete"
                || existing.valid_frame_count != recovered.valid_frame_count
                || existing.payload_hash != recovered.payload_hash
            {
                anyhow::bail!(
                    "existing salvage differs from orphan partial: {}",
                    salvage.display()
                );
            }
        } else {
            salvage_segment(&partial, &salvage)?;
        }
        records.push(RecoveryRecord {
            partial_ref: partial.display().to_string(),
            salvage_ref: salvage.display().to_string(),
            source_status: recovered.status,
            valid_frame_count: recovered.valid_frame_count,
            valid_bytes: recovered.valid_bytes,
            payload_hash: recovered.payload_hash,
        });
    }
    if !records.is_empty() {
        write_create_new(
            &report_directory.join("startup-recovery-report.json"),
            &serde_json::to_vec_pretty(&serde_json::json!({
                "schema_version": "trade.l2-startup-recovery-report.v1",
                "recovered_at_ms": unix_time_ms()?,
                "records": records,
            }))?,
        )?;
    }
    Ok(records)
}

pub fn unix_time_ms() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}

fn sync_parent(path: &Path) -> Result<()> {
    File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
    Ok(())
}

fn collect_partials(directory: &Path, output: &mut Vec<PathBuf>) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_partials(&path, output)?;
        } else if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.contains(".tl2s.partial.") && !name.ends_with(".salvaged.tl2s")
            })
        {
            output.push(path);
        }
    }
    output.sort();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use trade_l2_order_book_core::StreamingSegmentWriter;

    #[test]
    fn startup_recovery_salvages_a_crashed_writer_prefix() {
        let base = std::env::temp_dir().join(format!(
            "trade-l2-service-recovery-{}",
            unix_time_ms().expect("time")
        ));
        let report = base.join("new-run");
        fs::create_dir_all(&report).expect("directories");
        let requested = base.join("epoch-0001-segment-000001.tl2s");
        let mut writer = StreamingSegmentWriter::create(&requested).expect("writer");
        writer.append(b"frame-one").expect("frame");
        writer.sync().expect("sync");
        drop(writer);

        let records = recover_orphan_partials(&base, &report).expect("recover");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].valid_frame_count, 1);
        assert!(Path::new(&records[0].salvage_ref).exists());
        assert!(report.join("startup-recovery-report.json").exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn manifest_is_published_create_new_without_visible_partial() {
        let base = std::env::temp_dir().join(format!(
            "trade-l2-service-manifest-{}",
            unix_time_ms().expect("time")
        ));
        fs::create_dir_all(&base).expect("directory");
        let manifest = EpochManifest {
            schema_version: "trade.l2-epoch-manifest-proposal.v1",
            symbol: "BTCUSDT".to_string(),
            stream_epoch: "test-0001".to_string(),
            started_at_ms: 1,
            finished_at_ms: 2,
            continuity_status: "complete".to_string(),
            termination_reason: "test".to_string(),
            snapshot_ref: "snapshot.json".to_string(),
            snapshot_hash: "a".repeat(64),
            last_update_id: Some(1),
            received_messages: 1,
            recorded_frames: 1,
            applied_events: 1,
            segments: Vec::new(),
        };
        let path = write_manifest(&base, 1, &manifest).expect("manifest");
        assert!(path.exists());
        assert!(fs::read_dir(&base).expect("read directory").all(|entry| {
            !entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .contains("partial")
        }));
        assert!(write_manifest(&base, 1, &manifest).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }
}
