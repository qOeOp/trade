use crc32fast::hash as crc32;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

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
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    match arguments.mode.as_str() {
        "write" => {
            let output = arguments.output.ok_or("write requires --output")?;
            let payloads = read_json_lines(&arguments.input)?;
            println!(
                "{}",
                serde_json::to_string(&write_segment(&output, &payloads)?)?
            );
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
            argument => return Err(format!("unknown argument: {argument}").into()),
        }
        index += 2;
    }
    Ok(Arguments {
        mode: mode.ok_or("--mode is required")?,
        input: input.ok_or("--input is required")?,
        output,
        salvage_output,
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
    if payloads.is_empty() {
        return Err("segment requires at least one payload".into());
    }
    if Path::new(output_path).exists() {
        return Err(format!("segment output already exists: {output_path}").into());
    }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let partial_path = format!("{output_path}.partial.{}.{nonce}", std::process::id());
    let started_at = Instant::now();
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial_path)?;
    file.write_all(&[b'T', b'L', b'2', b'S', 0, 1, 0, 0])?;
    let mut payload_hasher = Sha256::new();
    let mut payload_bytes = 0;
    for payload in payloads {
        if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
            return Err(format!("payload length out of bounds: {}", payload.len()).into());
        }
        file.write_all(&(payload.len() as u32).to_be_bytes())?;
        file.write_all(&crc32(payload).to_be_bytes())?;
        file.write_all(payload)?;
        payload_hasher.update(payload);
        payload_bytes += payload.len();
    }
    file.sync_all()?;
    drop(file);
    fs::rename(&partial_path, output_path)?;
    let parent = Path::new(output_path)
        .parent()
        .unwrap_or_else(|| Path::new("."));
    File::open(parent)?.sync_all()?;
    let segment = fs::read(output_path)?;
    Ok(WriteResult {
        schema_version: "trade.l2-segment-write-result.v1",
        implementation: "rust",
        frame_count: payloads.len(),
        payload_bytes,
        segment_bytes: segment.len(),
        payload_hash: format!("{:x}", payload_hasher.finalize()),
        segment_hash: hash_bytes(&segment),
        elapsed_ns: started_at.elapsed().as_nanos(),
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

fn hash_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
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
