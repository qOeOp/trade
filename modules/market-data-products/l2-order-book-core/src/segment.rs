use crc32fast::hash as crc32;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const MAGIC: &[u8; 4] = b"TL2S";
const HEADER: [u8; 8] = [b'T', b'L', b'2', b'S', 0, 1, 0, 0];
const HEADER_BYTES: usize = 8;
const FRAME_HEADER_BYTES: usize = 8;
const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum SegmentError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("segment output already exists: {0}")]
    OutputExists(String),
    #[error("payload length out of bounds: {0}")]
    InvalidPayloadLength(usize),
    #[error("segment writer is already finalized")]
    AlreadyFinalized,
    #[error("segment frames and sync interval must be positive")]
    InvalidRotation,
    #[error("segment is not complete: {0}")]
    IncompleteSegment(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FinalizedSegment {
    pub frame_count: usize,
    pub payload_bytes: usize,
    pub segment_bytes: usize,
    pub payload_hash: String,
    pub segment_hash: String,
    pub elapsed_ns: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RecoveredSegment {
    pub status: String,
    pub valid_frame_count: usize,
    pub valid_bytes: usize,
    pub payload_bytes: usize,
    pub payload_hash: String,
    pub segment_bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SegmentDescriptor {
    pub path: String,
    pub frame_count: usize,
    pub payload_bytes: usize,
    pub segment_bytes: usize,
    pub payload_hash: String,
    pub segment_hash: String,
    pub writer_elapsed_ns: u128,
}

pub struct StreamingSegmentWriter {
    file: Option<File>,
    output_path: PathBuf,
    partial_path: PathBuf,
    payload_hasher: Sha256,
    payload_bytes: usize,
    frame_count: usize,
    started_at: Instant,
}

impl StreamingSegmentWriter {
    pub fn create(output_path: impl AsRef<Path>) -> Result<Self, SegmentError> {
        let output_path = output_path.as_ref().to_path_buf();
        if output_path.exists() {
            return Err(SegmentError::OutputExists(
                output_path.display().to_string(),
            ));
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let partial_path = PathBuf::from(format!(
            "{}.partial.{}.{nonce}",
            output_path.display(),
            std::process::id()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)?;
        file.write_all(&HEADER)?;
        Ok(Self {
            file: Some(file),
            output_path,
            partial_path,
            payload_hasher: Sha256::new(),
            payload_bytes: 0,
            frame_count: 0,
            started_at: Instant::now(),
        })
    }

    pub fn append(&mut self, payload: &[u8]) -> Result<(), SegmentError> {
        if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
            return Err(SegmentError::InvalidPayloadLength(payload.len()));
        }
        let file = self.file.as_mut().ok_or(SegmentError::AlreadyFinalized)?;
        file.write_all(&(payload.len() as u32).to_be_bytes())?;
        file.write_all(&crc32(payload).to_be_bytes())?;
        file.write_all(payload)?;
        self.payload_hasher.update(payload);
        self.payload_bytes += payload.len();
        self.frame_count += 1;
        Ok(())
    }

    pub fn sync(&mut self) -> Result<(), SegmentError> {
        self.file
            .as_mut()
            .ok_or(SegmentError::AlreadyFinalized)?
            .sync_all()?;
        Ok(())
    }

    pub fn frame_count(&self) -> usize {
        self.frame_count
    }

    pub fn finalize(mut self) -> Result<FinalizedSegment, SegmentError> {
        self.file
            .as_mut()
            .ok_or(SegmentError::AlreadyFinalized)?
            .sync_all()?;
        drop(self.file.take());
        fs::rename(&self.partial_path, &self.output_path)?;
        File::open(self.output_path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
        let segment = fs::read(&self.output_path)?;
        Ok(FinalizedSegment {
            frame_count: self.frame_count,
            payload_bytes: self.payload_bytes,
            segment_bytes: segment.len(),
            payload_hash: format!("{:x}", self.payload_hasher.finalize()),
            segment_hash: format!("{:x}", Sha256::digest(segment)),
            elapsed_ns: self.started_at.elapsed().as_nanos(),
        })
    }
}

pub struct RotatingSegmentWriter {
    directory: PathBuf,
    epoch: u64,
    segment_frames: usize,
    sync_every_frames: usize,
    next_segment: usize,
    current: Option<(String, StreamingSegmentWriter)>,
    completed: Vec<SegmentDescriptor>,
}

impl RotatingSegmentWriter {
    pub fn new(
        directory: impl AsRef<Path>,
        epoch: u64,
        segment_frames: usize,
        sync_every_frames: usize,
    ) -> Result<Self, SegmentError> {
        if segment_frames == 0 || sync_every_frames == 0 || sync_every_frames > segment_frames {
            return Err(SegmentError::InvalidRotation);
        }
        Ok(Self {
            directory: directory.as_ref().to_path_buf(),
            epoch,
            segment_frames,
            sync_every_frames,
            next_segment: 1,
            current: None,
            completed: Vec::new(),
        })
    }

    pub fn append(&mut self, payload: &[u8]) -> Result<(), SegmentError> {
        if self.current.is_none() {
            let name = format!(
                "epoch-{:04}-segment-{:06}.tl2s",
                self.epoch, self.next_segment
            );
            self.next_segment += 1;
            self.current = Some((
                name.clone(),
                StreamingSegmentWriter::create(self.directory.join(&name))?,
            ));
        }
        let (_, writer) = self.current.as_mut().expect("writer initialized");
        writer.append(payload)?;
        if writer.frame_count() % self.sync_every_frames == 0 {
            writer.sync()?;
        }
        if writer.frame_count() >= self.segment_frames {
            self.finalize_current()?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<SegmentDescriptor>, SegmentError> {
        self.finalize_current()?;
        Ok(self.completed)
    }

    fn finalize_current(&mut self) -> Result<(), SegmentError> {
        if let Some((path, writer)) = self.current.take() {
            let value = writer.finalize()?;
            self.completed.push(SegmentDescriptor {
                path,
                frame_count: value.frame_count,
                payload_bytes: value.payload_bytes,
                segment_bytes: value.segment_bytes,
                payload_hash: value.payload_hash,
                segment_hash: value.segment_hash,
                writer_elapsed_ns: value.elapsed_ns,
            });
        }
        Ok(())
    }
}

pub fn recover_segment(path: impl AsRef<Path>) -> Result<RecoveredSegment, SegmentError> {
    let mut segment = Vec::new();
    File::open(path)?.read_to_end(&mut segment)?;
    let mut status = "complete";
    let mut offset = 0;
    let mut valid_frame_count = 0;
    let mut payload_bytes = 0;
    let mut payload_hasher = Sha256::new();
    if segment.len() < HEADER_BYTES
        || &segment[0..4] != MAGIC
        || u16::from_be_bytes([segment[4], segment[5]]) != 1
        || u16::from_be_bytes([segment[6], segment[7]]) != 0
    {
        status = "invalid_header";
    } else {
        offset = HEADER_BYTES;
        while offset < segment.len() {
            if segment.len() - offset < FRAME_HEADER_BYTES {
                status = "truncated_frame_header";
                break;
            }
            let length = u32::from_be_bytes(
                segment[offset..offset + 4]
                    .try_into()
                    .expect("four-byte length"),
            ) as usize;
            let expected_crc = u32::from_be_bytes(
                segment[offset + 4..offset + 8]
                    .try_into()
                    .expect("four-byte crc"),
            );
            if length == 0 || length > MAX_PAYLOAD_BYTES {
                status = "invalid_length";
                break;
            }
            if segment.len() - offset - FRAME_HEADER_BYTES < length {
                status = "truncated_payload";
                break;
            }
            let payload =
                &segment[offset + FRAME_HEADER_BYTES..offset + FRAME_HEADER_BYTES + length];
            if crc32(payload) != expected_crc {
                status = "checksum_mismatch";
                break;
            }
            payload_hasher.update(payload);
            payload_bytes += payload.len();
            valid_frame_count += 1;
            offset += FRAME_HEADER_BYTES + length;
        }
    }
    Ok(RecoveredSegment {
        status: status.to_string(),
        valid_frame_count,
        valid_bytes: offset,
        payload_bytes,
        payload_hash: format!("{:x}", payload_hasher.finalize()),
        segment_bytes: segment.len(),
    })
}

pub fn salvage_segment(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
) -> Result<RecoveredSegment, SegmentError> {
    let input = input.as_ref();
    let output = output.as_ref();
    let recovered = recover_segment(input)?;
    if recovered.valid_frame_count == 0 {
        return Err(SegmentError::InvalidPayloadLength(0));
    }
    let bytes = fs::read(input)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    file.write_all(&bytes[..recovered.valid_bytes])?;
    file.sync_all()?;
    File::open(output.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()?;
    Ok(recovered)
}

pub fn read_segment_frames(path: impl AsRef<Path>) -> Result<Vec<Vec<u8>>, SegmentError> {
    let segment = fs::read(path)?;
    if segment.len() < HEADER_BYTES
        || &segment[0..4] != MAGIC
        || u16::from_be_bytes([segment[4], segment[5]]) != 1
        || u16::from_be_bytes([segment[6], segment[7]]) != 0
    {
        return Err(SegmentError::IncompleteSegment(
            "invalid_header".to_string(),
        ));
    }
    let mut offset = HEADER_BYTES;
    let mut frames = Vec::new();
    while offset < segment.len() {
        if segment.len() - offset < FRAME_HEADER_BYTES {
            return Err(SegmentError::IncompleteSegment(
                "truncated_frame_header".to_string(),
            ));
        }
        let length = u32::from_be_bytes(
            segment[offset..offset + 4]
                .try_into()
                .expect("four-byte length"),
        ) as usize;
        let expected_crc = u32::from_be_bytes(
            segment[offset + 4..offset + 8]
                .try_into()
                .expect("four-byte crc"),
        );
        if length == 0 || length > MAX_PAYLOAD_BYTES {
            return Err(SegmentError::IncompleteSegment(
                "invalid_length".to_string(),
            ));
        }
        let end = offset + FRAME_HEADER_BYTES + length;
        if end > segment.len() {
            return Err(SegmentError::IncompleteSegment(
                "truncated_payload".to_string(),
            ));
        }
        let payload = &segment[offset + FRAME_HEADER_BYTES..end];
        if crc32(payload) != expected_crc {
            return Err(SegmentError::IncompleteSegment(
                "checksum_mismatch".to_string(),
            ));
        }
        frames.push(payload.to_vec());
        offset = end;
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_accepts_only_the_valid_prefix() {
        let directory = std::env::temp_dir().join(format!(
            "trade-l2-core-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir(&directory).expect("directory");
        let path = directory.join("complete.tl2s");
        let mut writer = StreamingSegmentWriter::create(&path).expect("writer");
        writer.append(b"first").expect("first");
        writer.append(b"second").expect("second");
        writer.finalize().expect("finalize");
        assert_eq!(recover_segment(&path).expect("recover").status, "complete");
        let bytes = fs::read(&path).expect("read");
        let truncated = directory.join("truncated.tl2s");
        fs::write(&truncated, &bytes[..bytes.len() - 2]).expect("truncate");
        let recovered = recover_segment(&truncated).expect("recover truncated");
        assert_eq!(recovered.status, "truncated_payload");
        assert_eq!(recovered.valid_frame_count, 1);
        assert_eq!(read_segment_frames(&path).expect("frames").len(), 2);
        assert!(read_segment_frames(&truncated).is_err());
        let salvage = directory.join("salvaged.tl2s");
        let salvaged =
            salvage_segment(directory.join("truncated.tl2s"), &salvage).expect("salvage prefix");
        assert_eq!(salvaged.valid_frame_count, 1);
        assert_eq!(
            recover_segment(salvage).expect("verify salvage").status,
            "complete"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
