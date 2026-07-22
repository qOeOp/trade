use anyhow::{Context, Result};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use trade_l2_order_book_core::SegmentDescriptor;

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
    write_create_new(&path, &serde_json::to_vec_pretty(manifest)?)?;
    Ok(path)
}

pub fn unix_time_ms() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}

fn sync_parent(path: &Path) -> Result<()> {
    File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
    Ok(())
}
