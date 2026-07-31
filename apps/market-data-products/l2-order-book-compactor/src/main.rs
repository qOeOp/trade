use anyhow::{Result, bail};
use std::env;
use std::fs;
use trade_l2_order_book_compactor::{CompactionJob, compact, read_rows};

fn main() -> Result<()> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    match arguments.action.as_str() {
        "compact" => {
            let raw = if let Some(raw) = arguments.job_json {
                raw
            } else if let Some(path) = arguments.job_file {
                fs::read_to_string(path)?
            } else {
                bail!("--job-json or --job-file is required");
            };
            let job: CompactionJob = serde_json::from_str(&raw)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&compact(env::current_dir()?, &job)?)?
            );
        }
        "read" => {
            let path = arguments
                .parquet
                .ok_or_else(|| anyhow::anyhow!("--parquet is required"))?;
            println!(
                "{}",
                serde_json::to_string(
                    &serde_json::json!({"schema_version":"trade.l2-parquet-read-result.v1","offset":arguments.offset,"rows":read_rows(path, arguments.offset, arguments.limit)?})
                )?
            );
        }
        value => bail!("action must be compact or read, received {value}"),
    }
    Ok(())
}

struct Arguments {
    action: String,
    job_json: Option<String>,
    job_file: Option<String>,
    parquet: Option<String>,
    offset: usize,
    limit: usize,
}
fn parse_args(values: Vec<String>) -> Result<Arguments> {
    let mut result = Arguments {
        action: "compact".into(),
        job_json: None,
        job_file: None,
        parquet: None,
        offset: 0,
        limit: 100,
    };
    let mut index = 0;
    while index < values.len() {
        if index + 1 >= values.len() {
            bail!("incomplete argument: {}", values[index]);
        }
        let value = values[index + 1].clone();
        match values[index].as_str() {
            "--action" => result.action = value,
            "--job-json" => result.job_json = Some(value),
            "--job-file" => result.job_file = Some(value),
            "--parquet" => result.parquet = Some(value),
            "--offset" => result.offset = value.parse()?,
            "--limit" => result.limit = value.parse()?,
            argument => bail!("unknown argument: {argument}"),
        }
        index += 2;
    }
    Ok(result)
}
