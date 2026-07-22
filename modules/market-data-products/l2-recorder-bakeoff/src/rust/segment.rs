use crc32fast::hash as crc32;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::time::{Duration, Instant};

#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

mod segment_core;
use segment_core::StreamingSegmentWriter;

const MAGIC: &[u8; 4] = b"TL2S";
const HEADER_BYTES: usize = 8;
const FRAME_HEADER_BYTES: usize = 8;
const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct WriteResult {
    schema_version: &'static str,
    implementation: &'static str,
    frame_count: usize,
    payload_bytes: usize,
    segment_bytes: usize,
    payload_hash: String,
    segment_hash: String,
    elapsed_ns: u128,
}

#[derive(Debug, Serialize)]
struct RecoveryResult {
    schema_version: &'static str,
    implementation: &'static str,
    status: &'static str,
    valid_frame_count: usize,
    valid_bytes: usize,
    payload_bytes: usize,
    payload_hash: String,
    segment_bytes: usize,
    elapsed_ns: u128,
}

struct Arguments {
    mode: String,
    input: String,
    output: Option<String>,
    salvage_output: Option<String>,
    delay_ms: u64,
    sync_every_frames: usize,
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    match arguments.mode.as_str() {
        "write" => {
            let output = arguments.output.ok_or("write requires --output")?;
            let payloads = read_json_lines(&arguments.input)?;
            let result = if arguments.delay_ms == 0 && arguments.sync_every_frames == 0 {
                write_segment(&output, &payloads)?
            } else {
                write_segment_with_options(
                    &output,
                    &payloads,
                    arguments.delay_ms,
                    arguments.sync_every_frames,
                )?
            };
            println!("{}", serde_json::to_string(&result)?);
        }
        "recover" => println!(
            "{}",
            serde_json::to_string(&recover_segment(
                &arguments.input,
                arguments.salvage_output.as_deref()
            )?)?
        ),
        _ => return Err("--mode must be write or recover".into()),
    }
    Ok(())
}

fn parse_args(values: Vec<String>) -> Result<Arguments, Box<dyn Error>> {
    let mut mode = None;
    let mut input = None;
    let mut output = None;
    let mut salvage_output = None;
    let mut delay_ms = 0;
    let mut sync_every_frames = 0;
    let mut index = 0;
    while index < values.len() {
        if index + 1 >= values.len() {
            return Err(format!("incomplete argument: {}", values[index]).into());
        }
        let value = values[index + 1].clone();
        match values[index].as_str() {
            "--mode" => mode = Some(value),
            "--input" => input = Some(value),
            "--output" => output = Some(value),
            "--salvage-output" => salvage_output = Some(value),
            "--delay-ms" => delay_ms = value.parse()?,
            "--sync-every-frames" => sync_every_frames = value.parse()?,
            argument => return Err(format!("unknown argument: {argument}").into()),
        }
        index += 2;
    }
    Ok(Arguments {
        mode: mode.ok_or("--mode is required")?,
        input: input.ok_or("--input is required")?,
        output,
        salvage_output,
        delay_ms,
        sync_every_frames,
    })
}

fn read_json_lines(path: &str) -> Result<Vec<Vec<u8>>, Box<dyn Error>> {
    let bytes = fs::read(path)?;
    let mut payloads: Vec<Vec<u8>> = bytes
        .split(|byte| *byte == b'\n')
        .map(<[u8]>::to_vec)
        .collect();
    if payloads.last().is_some_and(Vec::is_empty) {
        payloads.pop();
    }
    if payloads.is_empty() || payloads.iter().any(Vec::is_empty) {
        return Err("input JSONL must contain non-empty lines".into());
    }
    Ok(payloads)
}

fn write_segment(output_path: &str, payloads: &[Vec<u8>]) -> Result<WriteResult, Box<dyn Error>> {
    write_segment_with_options(output_path, payloads, 0, 0)
}

fn write_segment_with_options(
    output_path: &str,
    payloads: &[Vec<u8>],
    delay_ms: u64,
    sync_every_frames: usize,
) -> Result<WriteResult, Box<dyn Error>> {
    if payloads.is_empty() {
        return Err("segment requires at least one payload".into());
    }
    let mut writer = StreamingSegmentWriter::create(output_path)?;
    for payload in payloads {
        writer.append(payload)?;
        if sync_every_frames > 0 && writer.frame_count() % sync_every_frames == 0 {
            writer.sync()?;
        }
        if delay_ms > 0 {
            std::thread::sleep(Duration::from_millis(delay_ms));
        }
    }
    let finalized = writer.finalize()?;
    Ok(WriteResult {
        schema_version: "trade.l2-segment-write-result.v1",
        implementation: "rust",
        frame_count: finalized.frame_count,
        payload_bytes: finalized.payload_bytes,
        segment_bytes: finalized.segment_bytes,
        payload_hash: finalized.payload_hash,
        segment_hash: finalized.segment_hash,
        elapsed_ns: finalized.elapsed_ns,
    })
}

fn recover_segment(
    path: &str,
    salvage_output: Option<&str>,
) -> Result<RecoveryResult, Box<dyn Error>> {
    let started_at = Instant::now();
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
            let length = u32::from_be_bytes(segment[offset..offset + 4].try_into()?) as usize;
            let expected_crc = u32::from_be_bytes(segment[offset + 4..offset + 8].try_into()?);
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
    if let Some(output) = salvage_output {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)?;
        file.write_all(&segment[..offset])?;
        file.sync_all()?;
    }
    Ok(RecoveryResult {
        schema_version: "trade.l2-segment-recovery-result.v1",
        implementation: "rust",
        status,
        valid_frame_count,
        valid_bytes: offset,
        payload_bytes,
        payload_hash: format!("{:x}", payload_hasher.finalize()),
        segment_bytes: segment.len(),
        elapsed_ns: started_at.elapsed().as_nanos(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_accepts_only_the_valid_prefix() -> Result<(), Box<dyn Error>> {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let directory = env::temp_dir().join(format!("trade-l2-rust-segment-{nonce}"));
        fs::create_dir(&directory)?;
        let complete_path = directory.join("complete.tl2s");
        let payloads = vec![b"first".to_vec(), b"second-payload".to_vec()];
        let written = write_segment(complete_path.to_str().ok_or("invalid path")?, &payloads)?;
        assert_eq!(written.frame_count, 2);
        assert_eq!(
            recover_segment(complete_path.to_str().ok_or("invalid path")?, None)?.status,
            "complete"
        );

        let mut segment = fs::read(&complete_path)?;
        let truncated_path = directory.join("truncated.tl2s");
        fs::write(&truncated_path, &segment[..segment.len() - 3])?;
        let truncated = recover_segment(truncated_path.to_str().ok_or("invalid path")?, None)?;
        assert_eq!(truncated.status, "truncated_payload");
        assert_eq!(truncated.valid_frame_count, 1);

        let last = segment.len() - 1;
        segment[last] ^= 0xff;
        let corrupt_path = directory.join("corrupt.tl2s");
        fs::write(&corrupt_path, segment)?;
        let corrupt = recover_segment(corrupt_path.to_str().ok_or("invalid path")?, None)?;
        assert_eq!(corrupt.status, "checksum_mismatch");
        assert_eq!(corrupt.valid_frame_count, 1);
        fs::remove_dir_all(directory)?;
        Ok(())
    }
}
