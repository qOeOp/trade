use crc32fast::hash as crc32;
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

pub struct FinalizedSegment {
    pub frame_count: usize,
    pub payload_bytes: usize,
    pub segment_bytes: usize,
    pub payload_hash: String,
    pub segment_hash: String,
    pub elapsed_ns: u128,
}

pub struct StreamingSegmentWriter {
    file: Option<File>,
    output_path: String,
    partial_path: String,
    payload_hasher: Sha256,
    payload_bytes: usize,
    frame_count: usize,
    started_at: Instant,
}

impl StreamingSegmentWriter {
    pub fn create(output_path: &str) -> Result<Self, Box<dyn Error>> {
        if Path::new(output_path).exists() {
            return Err(format!("segment output already exists: {output_path}").into());
        }
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let partial_path = format!("{output_path}.partial.{}.{nonce}", std::process::id());
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)?;
        file.write_all(&[b'T', b'L', b'2', b'S', 0, 1, 0, 0])?;
        Ok(Self {
            file: Some(file),
            output_path: output_path.to_string(),
            partial_path,
            payload_hasher: Sha256::new(),
            payload_bytes: 0,
            frame_count: 0,
            started_at: Instant::now(),
        })
    }

    pub fn append(&mut self, payload: &[u8]) -> Result<(), Box<dyn Error>> {
        if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
            return Err(format!("payload length out of bounds: {}", payload.len()).into());
        }
        let file = self
            .file
            .as_mut()
            .ok_or("segment writer is already finalized")?;
        file.write_all(&(payload.len() as u32).to_be_bytes())?;
        file.write_all(&crc32(payload).to_be_bytes())?;
        file.write_all(payload)?;
        self.payload_hasher.update(payload);
        self.payload_bytes += payload.len();
        self.frame_count += 1;
        Ok(())
    }

    pub fn sync(&mut self) -> Result<(), Box<dyn Error>> {
        self.file
            .as_mut()
            .ok_or("segment writer is already finalized")?
            .sync_all()?;
        Ok(())
    }

    pub fn frame_count(&self) -> usize {
        self.frame_count
    }

    pub fn finalize(mut self) -> Result<FinalizedSegment, Box<dyn Error>> {
        let file = self
            .file
            .as_mut()
            .ok_or("segment writer is already finalized")?;
        file.sync_all()?;
        drop(self.file.take());
        fs::rename(&self.partial_path, &self.output_path)?;
        let parent = Path::new(&self.output_path)
            .parent()
            .unwrap_or_else(|| Path::new("."));
        File::open(parent)?.sync_all()?;
        let segment = fs::read(&self.output_path)?;
        Ok(FinalizedSegment {
            frame_count: self.frame_count,
            payload_bytes: self.payload_bytes,
            segment_bytes: segment.len(),
            payload_hash: format!("{:x}", self.payload_hasher.finalize()),
            segment_hash: format!("{:x}", Sha256::digest(&segment)),
            elapsed_ns: self.started_at.elapsed().as_nanos(),
        })
    }
}
