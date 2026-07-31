use serde::Serialize;
use std::env;
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{Duration, Instant};
use trade_l2_order_book_core::{StreamingSegmentWriter, recover_segment as recover_tl2s};

#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

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
    status: String,
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
    let recovered = recover_tl2s(path)?;
    if let Some(output) = salvage_output {
        let segment = fs::read(path)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)?;
        file.write_all(&segment[..recovered.valid_bytes])?;
        file.sync_all()?;
    }
    Ok(RecoveryResult {
        schema_version: "trade.l2-segment-recovery-result.v1",
        implementation: "rust",
        status: recovered.status,
        valid_frame_count: recovered.valid_frame_count,
        valid_bytes: recovered.valid_bytes,
        payload_bytes: recovered.payload_bytes,
        payload_hash: recovered.payload_hash,
        segment_bytes: recovered.segment_bytes,
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
